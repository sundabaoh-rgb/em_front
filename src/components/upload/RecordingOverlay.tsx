"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { AlertCircle, Mic, RotateCcw } from "lucide-react";

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function softPulse(t: number) {
  return (Math.sin(t) + 1) / 2;
}

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

function humanizeMicError(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Браузер блокирует микрофон на небезопасном соединении. Откройте фронтенд по адресу http://localhost:3000.";
  }
  const name = (err as { name?: string })?.name || "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Микрофон не найден. Проверьте, подключена ли гарнитура/микрофон и выбран ли вход в настройках звука Linux.";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Доступ к микрофону запрещён. Разрешите использование микрофона в адресной строке браузера (значок слева от URL).";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Микрофон занят другим приложением или недоступен для чтения.";
  }
  return "Не удалось получить доступ к микрофону. Проверьте настройки звука и разрешения браузера.";
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
  const canceledRef = useRef(false);
  const stoppingRef = useRef(false);

  // Храним колбэки в ref, чтобы ререндер родителя не перезапускал useEffect
  const onCloseRef = useRef(onClose);
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onCloseRef.current = onClose;
    onRecordedRef.current = onRecorded;
  }, [onClose, onRecorded]);

  const [sec, setSec] = useState(0);
  const [levelRaw, setLevelRaw] = useState(0);
  const levelSmoothRef = useRef(0);
  const [phaseTick, setPhaseTick] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);

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
    canceledRef.current = false;
    setRecError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecError(humanizeMicError(new Error("MediaDevices unavailable")));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      // Фоллбэк на базовые настройки, если драйвер на Linux не принял флаги
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    // Если окно успели закрыть, пока ждали разрешение от браузера
    if (!mountedRef.current || canceledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

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

      if (canceledRef.current || chunksRef.current.length === 0) return;

      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type });

      onRecordedRef.current(file);
    };

    mr.start();
    startMeter(stream);
    startTimer();
  }, [hardStopStream, startMeter, startTimer, stopMeter, stopTimer]);

  const stop = useCallback(
    (isCancel = false) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      canceledRef.current = isCancel;

      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        } else {
          hardStopStream();
          void stopMeter();
          stopTimer();
        }
      } catch {
        hardStopStream();
        void stopMeter();
        stopTimer();
      } finally {
        recorderRef.current = null;
      }
    },
    [hardStopStream, stopMeter, stopTimer]
  );

  const finishRecording = useCallback(() => {
    stop(false);
    onCloseRef.current();
  }, [stop]);

  const cancelRecording = useCallback(() => {
    stop(true);
    onCloseRef.current();
  }, [stop]);

  useEffect(() => {
    mountedRef.current = true;
    setPortalEl(document.body);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Зависим ТОЛЬКО от `open`, чтобы никакие ререндеры не сбрасывали запись
  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      stopTimer();
      return;
    }

    document.body.style.overflow = "hidden";

    start().catch((err) => {
      console.error("Microphone error:", err);
      if (mountedRef.current) {
        setRecError(humanizeMicError(err));
      }
    });

    return () => {
      document.body.style.overflow = "";
      stopTimer();

      canceledRef.current = true;
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {}
      recorderRef.current = null;

      hardStopStream();
      void stopMeter();
      stoppingRef.current = false;
    };
  }, [open, start, hardStopStream, stopMeter, stopTimer]);

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
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={cancelRecording} />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-xl">
          <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-background/95 backdrop-blur-xl shadow-2xl">
            <button
              type="button"
              onClick={cancelRecording}
              className="cursor-pointer absolute right-4 top-4 z-20 h-9 w-9 rounded-full border bg-background/80 hover:bg-background grid place-items-center text-muted-foreground hover:text-foreground shadow-2xs transition"
              aria-label="Закрыть"
            >
              ✕
            </button>

            <div className="relative p-6 md:p-8">
              <div className="flex items-start justify-between gap-3 pr-10">
                <div>
                  <div className="text-lg font-semibold tracking-tight">Запись с микрофона</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {recError
                      ? "Не удалось начать запись"
                      : "Говорите в микрофон и нажмите «Готово» для сохранения"}
                  </div>
                </div>

                {!recError ? (
                  <div className="flex items-center gap-2.5">
                    <div
                      className="relative inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs border shadow-2xs select-none"
                      style={{
                        background: "rgba(239,68,68,0.10)",
                        borderColor: `rgba(239,68,68,${0.25 + amp * 0.30})`,
                      }}
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                      </span>

                      <span className="font-semibold text-red-600 tracking-wider">REC</span>

                      <span className="ml-0.5 inline-flex items-end gap-0.5 h-3.5">
                        {eq.map((v, i) => (
                          <span
                            key={`eq-${i}`}
                            className="w-0.5 rounded-full bg-red-500"
                            style={{
                              height: `${Math.round(4 + v * 10)}px`,
                              transition: "height 70ms linear",
                            }}
                          />
                        ))}
                      </span>
                    </div>

                    <span className="font-mono text-sm font-medium text-foreground tabular-nums">
                      {mmss(sec)}
                    </span>
                  </div>
                ) : null}
              </div>

              {recError ? (
                <div className="my-8 rounded-2xl border border-red-200 bg-red-50/90 p-5 text-red-900 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-sm leading-relaxed">{recError}</div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white gap-1.5"
                      onClick={() => {
                        start().catch((err) => setRecError(humanizeMicError(err)));
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Попробовать снова
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelRecording}>
                      Закрыть
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="my-10 grid place-items-center">
                    <div className="relative h-44 w-44 grid place-items-center">
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{ boxShadow: `0 0 80px rgba(99,102,241,${rings.glow})` }}
                      />
                      <div
                        className="absolute inset-0 rounded-full border"
                        style={{
                          transform: `scale(${rings.r3})`,
                          borderColor: `rgba(99,102,241,${0.18 + amp * 0.22})`,
                        }}
                      />
                      <div
                        className="absolute inset-0 rounded-full border"
                        style={{
                          transform: `scale(${rings.r2})`,
                          borderColor: `rgba(236,72,153,${0.14 + amp * 0.18})`,
                        }}
                      />
                      <div
                        className="absolute inset-0 rounded-full border"
                        style={{
                          transform: `scale(${rings.r1})`,
                          borderColor: `rgba(239,68,68,${0.12 + amp * 0.16})`,
                        }}
                      />

                      <button
                        type="button"
                        onClick={finishRecording}
                        className="relative h-24 w-24 rounded-full bg-background border shadow-lg grid place-items-center cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                        aria-label="Остановить и сохранить"
                      >
                        <Mic className="h-8 w-8 text-foreground" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={cancelRecording} className="rounded-xl px-6">
                      Отмена
                    </Button>
                    <Button variant="default" onClick={finishRecording} className="rounded-xl px-8">
                      Готово (Сохранить)
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    portalEl
  );
}