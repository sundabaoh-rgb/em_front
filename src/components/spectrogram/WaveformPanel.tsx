"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskStore } from "@/store/taskStore";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function fmtSec(s: number) {
  if (!isFinite(s) || s < 0) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s - m * 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

type WaveformData = {
  peaks: Float32Array;
  durationSec: number;
};

async function decodeWaveform(file: File, points = 1400, signal?: AbortSignal): Promise<WaveformData | null> {
  const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AudioCtx) return null;

  const ab = await file.arrayBuffer();
  if (signal?.aborted) return null;

  const ctx = new AudioCtx();
  try {
    const buf = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = (ctx as any).decodeAudioData(ab, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });

    if (signal?.aborted) return null;

    const ch = buf.numberOfChannels > 0 ? buf.getChannelData(0) : null;
    if (!ch) return null;

    const n = ch.length;
    const step = Math.max(1, Math.floor(n / points));
    const peaks = new Float32Array(points);

    for (let i = 0; i < points; i++) {
      const a = i * step;
      const b = Math.min(n, a + step);
      let m = 0;
      for (let j = a; j < b; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      peaks[i] = clamp(m, 0, 1);
    }

    for (let i = 0; i < peaks.length; i++) peaks[i] = Math.pow(peaks[i], 0.58);

    return { peaks, durationSec: buf.duration };
  } catch {
    return null;
  } finally {
    try {
      await ctx.close();
    } catch {}
  }
}

export default function WaveformPanel(props: { height?: number; embedded?: boolean }) {
  const height = props.height ?? 88;
  const embedded = !!props.embedded;

  const file = useTaskStore((s) => s.audioFile);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [data, setData] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);

  const revealRef = useRef(0);
  const hoverXRef = useRef<number | null>(null);
  const rafDrawRef = useRef<number>(0);
  const playLoopRef = useRef<number>(0);
  const renderFnRef = useRef<(() => void) | null>(null);

  // Состояние воспроизведения для плавного 60fps движения курсора
  const audioStateRef = useRef({
    isPlaying: false,
    curTime: 0,
    totalTime: 0,
    syncStamp: 0,
  });

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    (async () => {
      if (!file) {
        setData(null);
        audioStateRef.current = { isPlaying: false, curTime: 0, totalTime: 0, syncStamp: 0 };
        return;
      }
      setLoading(true);
      const res = await decodeWaveform(file, 1400, ac.signal);
      if (!alive || ac.signal.aborted) return;
      setData(res);
      setLoading(false);
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [file]);

  // Слушаем состояние плеера и запускаем плавный цикл отрисовки бегунка
  useEffect(() => {
    const startPlayLoop = () => {
      cancelAnimationFrame(playLoopRef.current);
      const loop = () => {
        renderFnRef.current?.();
        if (audioStateRef.current.isPlaying) {
          playLoopRef.current = requestAnimationFrame(loop);
        }
      };
      playLoopRef.current = requestAnimationFrame(loop);
    };

    const onAudioState = (e: Event) => {
      const custom = e as CustomEvent<{
        progress01?: number;
        isPlaying?: boolean;
        curTime?: number;
        totalTime?: number;
      }>;
      const d = custom.detail;
      if (!d) return;

      audioStateRef.current = {
        isPlaying: !!d.isPlaying,
        curTime: typeof d.curTime === "number" ? d.curTime : 0,
        totalTime: typeof d.totalTime === "number" ? d.totalTime : 0,
        syncStamp: performance.now(),
      };

      if (d.isPlaying) {
        startPlayLoop();
      } else {
        cancelAnimationFrame(playLoopRef.current);
        renderFnRef.current?.();
      }
    };

    window.addEventListener("em-audio-state", onAudioState);
    return () => {
      cancelAnimationFrame(playLoopRef.current);
      window.removeEventListener("em-audio-state", onAudioState);
    };
  }, []);

  const durationText = useMemo(() => {
    if (!data?.durationSec) return "—";
    return fmtSec(data.durationSec);
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth || 600;
      const h = height;

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mid = h / 2;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.07)";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(w, mid + 0.5);
      ctx.stroke();

      if (!data?.peaks?.length) {
        ctx.fillStyle = "rgba(100, 116, 139, 0.75)";
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          file ? (loading ? "Строим осциллограмму…" : "Сигнал недоступен") : "Выберите аудиофайл слева",
          w / 2,
          mid + 4
        );
        ctx.textAlign = "start";
        return;
      }

      const peaks = data.peaks;
      const padX = 8;
      const usableW = Math.max(1, w - padX * 2);

      const stepPx = 3;
      const bars = Math.max(1, Math.floor(usableW / stepPx));

      // Вычисляем точное текущее время и прогресс (0..1)
      const st = audioStateRef.current;
      const dur = data.durationSec || st.totalTime || 0;
      let currentSec = st.curTime;
      if (st.isPlaying && st.syncStamp > 0) {
        currentSec += (performance.now() - st.syncStamp) / 1000;
      }
      currentSec = clamp(currentSec, 0, dur);
      const playProg = dur > 0 ? clamp(currentSec / dur, 0, 1) : 0;

      // Базовый голубой градиент для непроигранной части
      const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
      baseGrad.addColorStop(0, "rgba(14, 165, 233, 0.58)");
      baseGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.82)");
      baseGrad.addColorStop(1, "rgba(14, 165, 233, 0.58)");

      // Яркий насыщенный синий градиент для проигранной части и магнитного ховера
      const activeGrad = ctx.createLinearGradient(0, 0, 0, h);
      activeGrad.addColorStop(0, "rgba(2, 132, 199, 0.95)");
      activeGrad.addColorStop(0.5, "rgba(14, 165, 233, 1)");
      activeGrad.addColorStop(1, "rgba(2, 132, 199, 0.95)");

      ctx.lineCap = "round";
      const rev = revealRef.current;
      const hx = hoverXRef.current;

      for (let i = 0; i < bars; i++) {
        const t = i / (bars - 1 || 1);
        const x = padX + i * stepPx;

        const localProgress = easeOutCubic(rev * 1.35 - t * 0.35);
        if (localProgress <= 0.01) continue;

        const p = peaks[Math.floor(t * (peaks.length - 1))] || 0;

        // Магнитное увеличение столбиков волны вокруг курсора
        let hoverBoost = 1;
        let isHovered = false;
        if (hx !== null) {
          const dist = Math.abs(x - hx);
          if (dist < 46) {
            const k = Math.cos((dist / 46) * (Math.PI / 2));
            hoverBoost = 1 + k * 0.28;
            if (dist < 20) isHovered = true;
          }
        }

        const amp = Math.max(1.5, clamp(p * hoverBoost, 0, 1) * (h * 0.42) * localProgress);
        const isPlayed = playProg > 0.001 && t <= playProg;

        ctx.strokeStyle = isHovered || isPlayed ? activeGrad : baseGrad;
        ctx.lineWidth = isHovered ? 2.2 : 1.7;

        ctx.beginPath();
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
        ctx.stroke();
      }

      // 1. Курсор наведения мыши (пунктирная линия + светлый бейдж секунды сверху)
      if (hx !== null && hx >= padX && hx <= w - padX) {
        const ratio = clamp((hx - padX) / usableW, 0, 1);
        const hoverSec = ratio * dur;
        const label = fmtSec(hoverSec);

        ctx.save();
        ctx.strokeStyle = "rgba(2, 132, 199, 0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx + 0.5, 0);
        ctx.lineTo(hx + 0.5, h);
        ctx.stroke();
        ctx.restore();

        ctx.font = "600 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const tw = ctx.measureText(label).width + 10;
        const bx = clamp(hx - tw / 2, 4, w - tw - 4);

        ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
        ctx.strokeStyle = "rgba(14, 165, 233, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, 3, tw, 16, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.fillText(label, bx + 5, 14);
      }

      // 2. Курсор текущей позиции проигрывания (Playhead: сплошная линия + маркер + время)
      if (playProg > 0.0005 || st.isPlaying) {
        const px = padX + playProg * usableW;
        const playLabel = fmtSec(currentSec);

        ctx.save();
        ctx.strokeStyle = "#0284c7";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();

        // Круглая головка бегунка сверху
        ctx.fillStyle = "#0284c7";
        ctx.beginPath();
        ctx.arc(px, 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Компактный синий бейдж текущего времени снизу бегунка
        ctx.font = "600 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const ptw = ctx.measureText(playLabel).width + 10;
        const pbx = clamp(px - ptw / 2, 4, w - ptw - 4);

        ctx.fillStyle = "#0284c7";
        ctx.beginPath();
        ctx.roundRect(pbx, h - 19, ptw, 16, 5);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(playLabel, pbx + 5, h - 8);
        ctx.restore();
      }
    };

    renderFnRef.current = draw;

    if (data?.peaks?.length) {
      revealRef.current = 0;
      const startT = performance.now();
      const dur = 600;

      const tick = (now: number) => {
        const p = clamp((now - startT) / dur, 0, 1);
        revealRef.current = p;
        draw();
        if (p < 1) {
          rafDrawRef.current = requestAnimationFrame(tick);
        }
      };

      cancelAnimationFrame(rafDrawRef.current);
      rafDrawRef.current = requestAnimationFrame(tick);
    } else {
      draw();
    }

    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(rafDrawRef.current);
      ro.disconnect();
    };
  }, [data, height, loading, file]);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    hoverXRef.current = e.clientX - rect.left;
    renderFnRef.current?.();
  };

  const onMouseLeave = () => {
    hoverXRef.current = null;
    renderFnRef.current?.();
  };

  const onClickSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!data?.peaks?.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const padX = 8;
    const usableW = Math.max(1, rect.width - padX * 2);
    const x = e.clientX - rect.left;
    const ratio = clamp((x - padX) / usableW, 0, 1);

    const dur = data.durationSec || 0;
    audioStateRef.current = {
      isPlaying: true,
      curTime: ratio * dur,
      totalTime: dur,
      syncStamp: performance.now(),
    };
    renderFnRef.current?.();

    window.dispatchEvent(
      new CustomEvent("em-audio-seek", {
        detail: { ratio, autoPlay: true },
      })
    );
  };

  if (embedded) {
    return (
      <div
        ref={wrapRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClickSeek}
        className="relative w-full overflow-hidden rounded-xl bg-slate-50/80 border border-slate-200/60 cursor-pointer"
      >
        <canvas ref={canvasRef} className="block w-full" style={{ height }} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-background shadow-xs overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
        <div className="text-xs font-medium text-muted-foreground">Сигнал</div>
        <div className="text-xs text-muted-foreground tabular-nums">длина: {durationText}</div>
      </div>
      <div className="p-3">
        <div
          ref={wrapRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClickSeek}
          className="relative w-full overflow-hidden rounded-xl bg-slate-50/80 cursor-pointer"
        >
          <canvas ref={canvasRef} className="block w-full" style={{ height }} />
        </div>
      </div>
    </div>
  );
}