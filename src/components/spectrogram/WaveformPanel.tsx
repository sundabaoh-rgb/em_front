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
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth || 600;
      const h = height;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, w, h);

      // Центральная опорная линия
      const mid = h / 2;
      ctx.strokeStyle = "rgba(15,23,42,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(w, mid + 0.5);
      ctx.stroke();

      if (!data?.peaks?.length) {
        ctx.fillStyle = "rgba(100,116,139,0.75)";
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          file ? (loading ? "Строим осциллограмму…" : "Сигнал недоступен") : "Выберите аудиофайл для предпросмотра волны",
          w / 2,
          mid + 4
        );
        ctx.textAlign = "start";
        return;
      }

      const peaks = data.peaks;
      const padX = 6;
      const usableW = Math.max(1, w - padX * 2);

      // Рисуем современные скругленные столбики с шагом 3px
      const stepPx = 3;
      const bars = Math.max(1, Math.floor(usableW / stepPx));

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(14, 165, 233, 0.85)");
      grad.addColorStop(0.5, "rgba(56, 189, 248, 0.95)");
      grad.addColorStop(1, "rgba(14, 165, 233, 0.85)");

      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";

      for (let i = 0; i < bars; i++) {
        const t = i / (bars - 1 || 1);
        const x = padX + i * stepPx;
        const p = peaks[Math.floor(t * (peaks.length - 1))] || 0;
        const amp = Math.max(1.5, clamp(p, 0, 1) * (h * 0.44));

        ctx.beginPath();
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
        ctx.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [data, height, loading, file]);

  if (embedded) {
    return (
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl bg-background/60">
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
        <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl bg-muted/15">
          <canvas ref={canvasRef} className="block w-full" style={{ height }} />
        </div>
      </div>
    </div>
  );
}