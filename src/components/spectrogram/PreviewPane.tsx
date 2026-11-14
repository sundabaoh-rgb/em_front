"use client";

import { useMemo } from "react";
import SpectrogramPanel from "@/components/spectrogram/SpectrogramPanel";
import WaveformPanel from "@/components/spectrogram/WaveformPanel";
import { useTaskStore } from "@/store/taskStore";
import { Activity,AudioLines, Sparkles } from "lucide-react";

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

  return (
    <div className="space-y-4">
      {/* Акцентная карточка эмоции */}
      <div
        className="relative rounded-2xl border p-4 transition-all duration-300 overflow-hidden"
        style={{
          background: isDone
            ? `linear-gradient(135deg, ${hexToRgba(em.hex, 0.08)} 0%, rgba(255,255,255,0.9) 65%)`
            : "hsl(var(--background))",
          borderColor: isDone ? hexToRgba(em.hex, 0.28) : "hsl(var(--border))",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
              style={{
                background: hexToRgba(em.hex, 0.14),
                color: em.hex,
              }}
            >
              <Sparkles className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Доминирующая эмоция
              </div>

              <div className="mt-0.5 flex items-center gap-2 min-w-0">
                <span className="text-base font-semibold tracking-tight truncate">
                  {em.label}
                </span>

                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: em.hex }}
                />

                <span className="text-xs text-muted-foreground truncate">
                  {status === "done"
                    ? "определена в записи"
                    : status === "processing" || status === "queued"
                    ? "идёт анализ..."
                    : "загрузите аудио"}
                </span>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border bg-background/80 backdrop-blur px-3 py-1.5 text-xs font-medium text-foreground shadow-2xs">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="tabular-nums">
              {showDuration ? fmtSec(totalSec) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Единый блок аудиоволны и спектрограммы без лишних вложенных рамок */}
      <div className="rounded-2xl border bg-card shadow-xs overflow-hidden">
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AudioLines className="h-3.5 w-3.5" />
            <span>Сигнал и мел-спектрограмма</span>
          </div>
          <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground border tabular-nums">
            {fmtSec(0)} – {fmtSec(totalSec)}
          </span>
        </div>

        <div className="divide-y">
          {/* Осциллограмма */}
          <div className="bg-slate-950/[0.02] p-3">
            <WaveformPanel height={84} embedded />
          </div>

          {/* Спектрограмма без белого градиента снизу */}
          <div className="relative bg-[#090A10]">
            <SpectrogramPanel
              variant="preview"
              heightClassName="h-[240px]"
              showTimeRuler
              showSegmentsBar={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}