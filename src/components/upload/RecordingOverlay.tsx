"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Формат времени mm:ss.
 */
function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Ограничивает значение диапазоном [a, b].
 */
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Линейная интерполяция.
 */
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Мягкая пульсация 0..1 (для “дыхания” анимации).
 */
function softPulse(t: number) {
  return (Math.sin(t) + 1) / 2;
}

/**
 * Подбираем наиболее совместимый mimeType для MediaRecorder.
 * Это повышает шанс, что запись заработает в разных браузерах.
 */
function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) {
      return t;
    }
  }

  return undefined;
}

type RecordingOverlayProps = {
  open: boolean;
  onClose: () => void;
  onRecorded: (file: File) => void;
};

export default function RecordingOverlay({ open, onClose, onRecorded }: RecordingOverlayProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const mountedRef = useRef(false);

  const [sec, setSec] = useState(0);

  const [levelRaw, setLevelRaw] = useState(0);
  const levelSmoothRef = useRef(0);

  const [phaseTick, setPhaseTick] = useState(0);

  const stoppingRef = useRef(false);

  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  const stopMeter = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    if (mountedRef.current) setLevelRaw(0);
    levelSmoothRef.current = 0;

    try {
      await audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const AudioCtx =
      (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;

    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;

    source.connect(analyser);

    const timeData = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / timeData.length);

      const noiseFloor = 0.018;
      const gated = Math.max(0, rms - noiseFloor);
      const gained = clamp(gated * 6.5, 0, 1);

      if (mountedRef.current) {
        setLevelRaw(gained);
        setPhaseTick((x) => (x + 1) % 1_000_000);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    startedAtRef.current = Date.now();
    if (mountedRef.current) setSec(0);

    timerRef.current = window.setInterval(() => {
      const next = Math.floor((Date.now() - startedAtRef.current) / 1000);
      if (mountedRef.current) setSec(next);
    }, 250);
  }, [stopTimer]);

  const hardStopStream = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stoppingRef.current = false;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    streamRef.current = stream;

    const mimeType = pickMimeType();
    const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    recorderRef.current = mr;
    chunksRef.current = [];
    if (mountedRef.current) setSec(0);

    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    mr.onstop = async () => {
      hardStopStream();
      await stopMeter();
      stopTimer();

      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type });

      onRecorded(file);
    };

    mr.start();
    startMeter(stream);
    startTimer();
  }, [hardStopStream, onRecorded, startMeter, startTimer, stopMeter, stopTimer]);

  const stop = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    try {
      recorderRef.current?.stop();
    } catch {
      hardStopStream();
      stopMeter();
      stopTimer();
    } finally {
      recorderRef.current = null;
    }
  }, [hardStopStream, stopMeter, stopTimer]);

  const closeAll = useCallback(() => {
    stop();
    onClose();
  }, [onClose, stop]);

  useEffect(() => {
    mountedRef.current = true;
    setPortalEl(document.body);
    const prevOverflow = document.body.style.overflow;

    return () => {
      mountedRef.current = false;
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      stopTimer();
      return;
    }

    document.body.style.overflow = "hidden";

    start().catch(() => {
      onClose();
    });

    return () => {
      document.body.style.overflow = "";
      stopTimer();

      try {
        recorderRef.current?.stop();
      } catch {}
      recorderRef.current = null;

      hardStopStream();
      stopMeter();
      stoppingRef.current = false;
    };
  }, [open, onClose, start, hardStopStream, stopMeter, stopTimer, stopTimer]);

  const amp = useMemo(() => {
    const boosted = clamp(levelRaw * 1.25, 0, 1);
    const target = Math.pow(boosted, 0.72);

    const prev = levelSmoothRef.current;
    const next = lerp(prev, target, 0.18);
    levelSmoothRef.current = next;

    return next;
  }, [levelRaw, phaseTick]);

  const rings = useMemo(() => {
    return {
      r1: 1 + amp * 0.07,
      r2: 1 + amp * 0.14,
      r3: 1 + amp * 0.24,
      glow: 0.12 + amp * 0.22,
    };
  }, [amp]);

  const eq = useMemo(() => {
    const t = phaseTick * 0.16;
    const base = amp;

    return Array.from({ length: 5 }, (_, i) => {
      const wobble = softPulse(t + i * 0.85);
      const v = 0.22 + base * (0.85 + i * 0.1) + wobble * (0.14 + base * 0.22);
      return clamp(v, 0.18, 1);
    });
  }, [amp, phaseTick]);

  if (!open || !portalEl) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] isolate">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeAll} />

      {/* modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl border bg-background/65 backdrop-blur-xl shadow-2xl">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(1200px 600px at 50% 25%, rgba(99,102,241,0.22), transparent 58%), radial-gradient(900px 450px at 80% 60%, rgba(236,72,153,0.16), transparent 55%), radial-gradient(900px 500px at 20% 70%, rgba(34,197,94,0.08), transparent 55%)",
              }}
            />

            <div
              className="absolute inset-x-0 top-0 h-24"
              style={{
                background: "linear-gradient(to bottom, rgba(0,0,0,0.08), rgba(0,0,0,0))",
              }}
            />

            <button
              type="button"
              onClick={closeAll}
              className="absolute right-4 top-4 z-20 h-10 w-10 rounded-full border bg-background/75 hover:bg-background/90 grid place-items-center shadow-sm"
              aria-label="close"
            >
              ✕
            </button>

            <div className="relative p-6 md:p-10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg md:text-xl font-semibold">Запись</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Говори в микрофон. Нажми “Стоп”, когда закончишь.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className="relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border shadow-sm select-none"
                    style={{
                      background:
                        "linear-gradient(90deg, rgba(239,68,68,0.20), rgba(236,72,153,0.16), rgba(99,102,241,0.10))",
                      boxShadow: `0 10px 30px rgba(239,68,68,${0.10 + amp * 0.22})`,
                      borderColor: `rgba(239,68,68,${0.25 + amp * 0.30})`,
                    }}
                  >
                    <span className="relative flex h-2.5 w-2.5">
                      <span
                        className="absolute inline-flex h-full w-full rounded-full"
                        style={{
                          background: "rgba(239,68,68,0.55)",
                          transform: `scale(${1 + amp * 0.95})`,
                          filter: "blur(2px)",
                          opacity: 0.55 + amp * 0.3,
                        }}
                      />
                      <span
                        className="relative inline-flex h-2.5 w-2.5 rounded-full"
                        style={{
                          background: "rgb(239,68,68)",
                          boxShadow: `0 0 14px rgba(239,68,68,${0.35 + amp * 0.55})`,
                        }}
                      />
                    </span>

                    <span className="font-medium tracking-wide">REC</span>

                    <span className="ml-1 inline-flex items-end gap-1 h-4">
                      {eq.map((v, i) => (
                        <span
                          key={`eq-${i}`}
                          className="w-1 rounded-full"
                          style={{
                            height: `${Math.round(6 + v * 14)}px`,
                            background:
                              "linear-gradient(to top, rgba(239,68,68,0.95), rgba(236,72,153,0.85), rgba(99,102,241,0.75))",
                            opacity: 0.9,
                            boxShadow: `0 0 10px rgba(99,102,241,${0.10 + amp * 0.25})`,
                            transition: "height 70ms linear",
                          }}
                        />
                      ))}
                    </span>
                  </div>

                  <span className="font-mono text-sm text-muted-foreground tabular-nums">
                    {mmss(sec)}
                  </span>
                </div>
              </div>

              <div className="mt-8 md:mt-10 grid place-items-center">
                <div className="relative h-56 w-56 md:h-64 md:w-64 grid place-items-center">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: `0 0 95px rgba(99,102,241,${rings.glow})` }}
                  />

                  <div
                    className="absolute inset-0 rounded-full border bg-white/5"
                    style={{
                      transform: `scale(${rings.r3})`,
                      borderColor: `rgba(99,102,241,${0.18 + amp * 0.22})`,
                    }}
                  />
                  <div
                    className="absolute inset-0 rounded-full border bg-white/6"
                    style={{
                      transform: `scale(${rings.r2})`,
                      borderColor: `rgba(236,72,153,${0.14 + amp * 0.18})`,
                    }}
                  />
                  <div
                    className="absolute inset-0 rounded-full border bg-white/7"
                    style={{
                      transform: `scale(${rings.r1})`,
                      borderColor: `rgba(239,68,68,${0.12 + amp * 0.16})`,
                    }}
                  />

                  <button
                    type="button"
                    onClick={closeAll}
                    className="relative h-28 w-28 md:h-32 md:w-32 rounded-full bg-background/88 border shadow-xl grid place-items-center cursor-pointer active:scale-[0.99] transition-transform"
                    aria-label="stop recording"
                  >
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 32px rgba(99,102,241,${
                          0.10 + amp * 0.24
                        })`,
                      }}
                    />
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-foreground"
                      />
                      <path
                        d="M19 11a7 7 0 0 1-14 0"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-foreground"
                      />
                      <path
                        d="M12 18v3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-foreground"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-12 flex items-center justify-center gap-3">
                <Button variant="secondary" onClick={closeAll} className="rounded-full px-8">
                  Отмена
                </Button>
                <Button variant="destructive" onClick={closeAll} className="rounded-full px-10">
                  Стоп
                </Button>
              </div>

              <div className="mt-3 text-center text-xs text-muted-foreground">
                Запись остановится и файл автоматически появится в карточке.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    portalEl
  );
}
