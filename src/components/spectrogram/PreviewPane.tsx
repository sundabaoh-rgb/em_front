"use client";

import { useMemo } from "react";
import SpectrogramPanel from "@/components/spectrogram/SpectrogramPanel";
import WaveformPanel from "@/components/spectrogram/WaveformPanel";
import { useTaskStore } from "@/store/taskStore";
import { Activity, AudioLines, Sparkles } from "lucide-react";

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

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

function emotionMeta(em: string | null) {
  const k = (em || "").toLowerCase();

  if (k.includes("angry") || k.includes("rage") || k.includes("зл"))
    return { key: "angry", label: "Злость", hex: "#EF4444" };
  if (k.includes("positive") || k.includes("happy") || k.includes("рад"))
    return { key: "happy", label: "Радость", hex: "#F59E0B" };
  if (k.includes("sad") || k.includes("sadness") || k.includes("гру"))
    return { key: "sad", label: "Грусть", hex: "#3B82F6" };
  if (k.includes("stress") || k.includes("fear") || k.includes("anx") || k.includes("стр"))
    return { key: "stress", label: "Стресс", hex: "#A855F7" };
  if (k.includes("neutral") || k.includes("calm") || k.includes("нейт") || k.includes("спок"))
    return { key: "neutral", label: "Спокойствие", hex: "#64748B" };

  return { key: "other", label: em ? em : "Ожидание", hex: "#94A3B8" };
}

function isTruthOrLie(label: string) {
  const k = (label || "").toLowerCase().trim();
  return k.includes("truth") || k === "true" || k.includes("lie") || k === "false" || k.includes("ист") || k.includes("лож");
}

export default function PreviewPane() {
  const status = useTaskStore((s) => s.status);
  const spec = useTaskStore((s) => s.spectrogram);
  const mainEmotion = useTaskStore((s) => s.mainEmotion);
  const segments = useTaskStore((s) => s.segments);

  const frameSec = 0.016;

  const totalSec = useMemo(() => {
    const frames = spec?.frames ?? 0;
    return frames > 0 ? frames * frameSec : 0;
  }, [spec?.frames]);

  const showDuration = totalSec > 0;
  const em = useMemo(() => emotionMeta(mainEmotion), [mainEmotion]);
  const isDone = status === "done";
  const isBusy = status === "processing" || status === "queued";

  // Считаем распределение эмоций по сегментам для мини-бара
  const breakdown = useMemo(() => {
    if (!segments?.length) return [];
    const totals = new Map<string, { label: string; hex: string; frames: number }>();
    let sumFrames = 0;

    for (const s of segments) {
      if (isTruthOrLie(s.label)) continue;
      const len = Math.max(0, (s.endFrame ?? 0) - (s.startFrame ?? 0));
      if (len <= 0) continue;

      const meta = emotionMeta(s.label);
      const prev = totals.get(meta.key);
      if (prev) {
        prev.frames += len;
      } else {
        totals.set(meta.key, { label: meta.label, hex: meta.hex, frames: len });
      }
      sumFrames += len;
    }

    if (sumFrames <= 0) return [];

    return Array.from(totals.values())
      .sort((a, b) => b.frames - a.frames)
      .map((item) => ({
        ...item,
        pct: Math.round((item.frames / sumFrames) * 100),
      }))
      .filter((x) => x.pct > 0);
  }, [segments]);

  return (
    <div className="space-y-4">
      {/* Акцентная карточка эмоции + мини-распределение по записи */}
      <div
        className="relative rounded-xl p-4 transition-all duration-500 overflow-hidden space-y-3"
        style={{
          background: isDone ? hexToRgba(em.hex, 0.06) : "rgba(15, 23, 42, 0.025)",
          border: `1px solid ${isDone ? hexToRgba(em.hex, 0.24) : "rgba(15, 23, 42, 0.08)"}`,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: hexToRgba(em.hex, 0.15),
                color: em.hex,
              }}
            >
              <Sparkles className={`h-5 w-5 ${isBusy ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Доминирующая эмоция
              </div>
              <div className="mt-0.5 flex items-center gap-2 min-w-0">
                <span className="text-base font-bold tracking-tight truncate">{em.label}</span>
                <span className="text-xs text-muted-foreground truncate">
                  • {isDone ? "определена в записи" : isBusy ? "идёт анализ…" : "ожидание анализа"}
                </span>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs ring-1 ring-black/5">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tabular-nums">{showDuration ? fmtSec(totalSec) : "—"}</span>
          </div>
        </div>

        {/* Полоска баланса эмоций (появляется, если есть сегменты) */}
        {isDone && breakdown.length > 0 ? (
          <div className="pt-1 space-y-1.5">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/80 p-0.5 ring-1 ring-black/5 gap-0.5">
              {breakdown.map((b) => (
                <div
                  key={b.label}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
                  style={{ width: `${b.pct}%`, backgroundColor: b.hex }}
                  title={`${b.label}: ${b.pct}%`}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {breakdown.slice(0, 4).map((b) => (
                <span key={b.label} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.hex }} />
                  <span className="font-medium text-foreground/85">{b.label}</span>
                  <span className="tabular-nums">{b.pct}%</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Контейнер с волной и спектрограммой */}
      <div className="relative rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        {isBusy ? (
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            <div
              className="h-full w-1/3 animate-spectro-scan"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(14, 165, 233, 0.15) 60%, rgba(56, 189, 248, 0.35) 100%)",
              }}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AudioLines className="h-3.5 w-3.5 text-sky-500" />
            <span>Сигнал и мел-спектрограмма (клик по графику — перемотка)</span>
          </div>
          <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-slate-200/70 tabular-nums">
            {fmtSec(0)} – {fmtSec(totalSec)}
          </span>
        </div>

        <div className="p-3 space-y-2.5">
          <WaveformPanel height={84} embedded />

          <div className="rounded-xl overflow-hidden bg-[#05050A] ring-1 ring-slate-900/10">
            <SpectrogramPanel
              variant="preview"
              heightClassName="h-[280px]"
              showTimeRuler
              showSegmentsBar={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}