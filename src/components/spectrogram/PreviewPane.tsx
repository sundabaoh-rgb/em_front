"use client";

import { useMemo } from "react";
import SpectrogramPanel from "@/components/spectrogram/SpectrogramPanel";
import WaveformPanel from "@/components/spectrogram/WaveformPanel";
import { useTaskStore } from "@/store/taskStore";
import { Activity, Clock3 } from "lucide-react";

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
    return { label: "Спокойно", hex: "#94A3B8" };

  return { label: em ? em : "—", hex: "#64748B" };
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

  const inactive = status !== "done";

    return (
    <div className="space-y-4">
        <div className="rounded-2xl border bg-background shadow-sm overflow-hidden">
        <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{
                    background: em.hex,
                    boxShadow: `0 0 0 4px ${hexToRgba(em.hex, 0.14)}`,
                }}
                />

                <div className="min-w-0">
                <div className="text-xs text-muted-foreground leading-none">
                    Доминирующая эмоция
                </div>

                <div className="mt-0.5 flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">
                    {em.label}
                    </span>

                    <span
                    className="h-1.5 w-1.5 rounded-full opacity-60"
                    style={{ background: em.hex }}
                    />

                    <span className="text-xs text-muted-foreground truncate">
                    {status === "done"
                        ? "в записи"
                        : status === "processing" || status === "queued"
                        ? "обработка..."
                        : "ожидаем результат"}
                    </span>
                </div>
                </div>
            </div>

            <div className="ml-auto inline-flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                {showDuration ? fmtSec(totalSec) : "—"}
                </span>
            </div>
            </div>
        </div>

        <div
            className="h-[2px]"
            style={{
            background: `linear-gradient(
                90deg,
                transparent 0%,
                ${hexToRgba(em.hex, 0.45)} 50%,
                transparent 100%
            )`,
            opacity: status === "done" ? 1 : 0.5,
            }}
        />
        </div>

        <div className="rounded-3xl border bg-background shadow-sm overflow-hidden">
        <div className="pointer-events-none h-10 bg-gradient-to-b from-muted/25 to-transparent" />

        <div className="px-4 pb-4 space-y-4">
            <div className="rounded-2xl border bg-muted/10 overflow-hidden">
            <WaveformPanel height={92} embedded />
            </div>

            <div className="relative rounded-2xl border bg-background overflow-hidden">
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-2">
                <span className="inline-flex items-center rounded-full border bg-background/60 px-3 py-1 text-xs backdrop-blur shadow-sm tabular-nums">
                {fmtSec(0)} - {fmtSec(totalSec)}
                </span>
            </div>

            <div className="h-[360px] overflow-hidden">
                <SpectrogramPanel
                variant="preview"
                heightClassName="h-[380px]"
                showTimeRuler
                showSegmentsBar={false}
                />
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
            </div>
        </div>
        </div>
    </div>
    );

}
