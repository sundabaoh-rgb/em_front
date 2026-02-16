"use client";

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

    for (let i = 0; i < peaks.length; i++) peaks[i] = Math.pow(peaks[i], 0.55);

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
  const height = props.height ?? 92;
  const embedded = !!props.embedded;

  const file = useTaskStore((s) => s.audioFile);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [data, setData] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    (async () => {
      if (!file) {
        setData(null);
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

  const durationText = useMemo(() => {
    if (!data?.durationSec) return "—";
    return fmtSec(data.durationSec);
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = height;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(2,6,23,0.03)";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(15,23,42,0.10)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    if (!data?.peaks?.length) {
      ctx.fillStyle = "rgba(15,23,42,0.55)";
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(file ? (loading ? "строим waveform…" : "waveform недоступен") : "выбери аудио слева", 12, 20);
      return;
    }

    const peaks = data.peaks;
    const mid = h / 2;
    const padX = 10;
    const usableW = Math.max(1, w - padX * 2);

    ctx.strokeStyle = "rgba(2,132,199,0.45)";
    ctx.lineWidth = 1;

    const bars = Math.min(peaks.length, Math.floor(usableW));
    for (let i = 0; i < bars; i++) {
      const t = i / (bars - 1 || 1);
      const x = padX + t * usableW;
      const p = peaks[Math.floor(t * (peaks.length - 1))] || 0;
      const amp = clamp(p, 0, 1) * (h * 0.42);

      ctx.beginPath();
      ctx.moveTo(x + 0.5, mid - amp);
      ctx.lineTo(x + 0.5, mid + amp);
      ctx.stroke();
    }
  }, [data, height, loading, file]);

  return (
    <div className={embedded ? "" : "rounded-2xl border bg-background shadow-sm overflow-hidden"}>
      {!embedded ? (
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="text-xs text-muted-foreground">Сигнал</div>
          <div className="text-xs text-muted-foreground tabular-nums">длина: {durationText}</div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-2">
          <div className="text-xs text-muted-foreground">Сигнал</div>
          <div className="text-xs text-muted-foreground tabular-nums">длина: {durationText}</div>
        </div>
      )}

      <div className={embedded ? "px-3 pb-3" : "px-3 py-3"}>
        <div className="relative rounded-2xl border bg-background overflow-hidden">
          <canvas ref={canvasRef} className="block w-full" style={{ height }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />
        </div>
      </div>
    </div>
  );
}
