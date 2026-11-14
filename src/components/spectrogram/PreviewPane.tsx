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
    return { label: "Злость", hex: "#EF4444" };
  if (k.includes("positive") || k.includes("happy") || k.includes("рад"))
    return { label: "Радость", hex: "#F59E0B" };
  if (k.includes("sad") || k.includes("sadness") || k.includes("гру"))
    return { label: "Грусть", hex: "#3B82F6" };
  if (k.includes("stress") || k.includes("fear") || k.includes("anx") || k.includes("стр"))
    return { label: "Стресс", hex: "#A855F7" };
  if (k.includes("neutral") || k.includes("calm") || k.includes("нейт") || k.includes("спок"))
    return { label: "Спокойствие", hex: "#64748B" };

  return { label: em ? em : "Ожидание", hex: "#94A3B8" };
}

export default function PreviewPane() {
  const status = useTaskStore((s) => s.status);
  const spec = useTaskStore((s) => s.spectrogram);
  const mainEmotion = useTaskStore((s) => s.mainEmotion);

  const frameSec = 0.016;

  const totalSec = useMemo(() => {
    const frames = spec?.frames ?? 0;
    return frames > 0 ? frames * frameSec : 0;
  }, [spec?.frames]);

  const showDuration = totalSec > 0;
  const em = useMemo(() => emotionMeta(mainEmotion), [mainEmotion]);
  const isDone = status === "done";
  const isBusy = status === "processing" || status === "queued";

  return (
    <div className="space-y-4">
      {/* Акцентная карточка эмоции */}
      <div
        className="relative flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3.5 transition-all duration-500 overflow-hidden"
        style={{
          background: isDone ? hexToRgba(em.hex, 0.07) : "rgba(15, 23, 42, 0.025)",
          border: `1px solid ${isDone ? hexToRgba(em.hex, 0.26) : "rgba(15, 23, 42, 0.08)"}`,
        }}
      >
        <div className="relative flex items-center gap-3.5 min-w-0">
          <div
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
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

        <div className="relative inline-flex items-center gap-1.5 rounded-lg bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs ring-1 ring-black/5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="tabular-nums">{showDuration ? fmtSec(totalSec) : "—"}</span>
        </div>
      </div>

      {/* Светлый контейнер с голубой волной и спектрограммой */}
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
            <span>Сигнал (клик для прослушивания) и мел-спектрограмма</span>
          </div>
          <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-slate-200/70 tabular-nums">
            {fmtSec(0)} – {fmtSec(totalSec)}
          </span>
        </div>

        <div className="p-3 space-y-3">
          <WaveformPanel height={84} embedded />

          <div className="rounded-xl overflow-hidden bg-[#05050A] ring-1 ring-slate-900/10">
            <SpectrogramPanel
              variant="preview"
              heightClassName="h-[260px]"
              showTimeRuler
              showSegmentsBar={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}