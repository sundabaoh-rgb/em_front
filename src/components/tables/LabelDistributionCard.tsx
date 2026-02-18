"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useTaskStore } from "@/store/taskStore";

type Metric = "emotion" | "truth";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function fmtSec(s: number) {
  if (!Number.isFinite(s) || s < 0) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s - m * 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function normLabel(label: string) {
  return (label || "").toLowerCase().trim();
}

function isTruthLabel(label: string) {
  const k = normLabel(label);
  return (
    k.includes("truth") ||
    k === "true" ||
    k.includes("lie") ||
    k === "false" ||
    k.includes("ист") ||
    k.includes("лож")
  );
}

function isEmotionLabel(label: string) {
  const k = normLabel(label);
  return (
    k.includes("angry") ||
    k.includes("rage") ||
    k.includes("positive") ||
    k.includes("happy") ||
    k.includes("sad") ||
    k.includes("sadness") ||
    k.includes("neutral") ||
    k.includes("calm") ||
    k.includes("stress") ||
    k.includes("fear") ||
    k.includes("anx") ||
    k.includes("зл") ||
    k.includes("рад") ||
    k.includes("гру") ||
    k.includes("нейт") ||
    k.includes("спок") ||
    k.includes("стр") ||
    k.includes("страх") ||
    k.includes("трев")
  );
}

function segColor(label: string) {
  const k = normLabel(label);

  if (k.includes("angry") || k.includes("rage") || k.includes("зл")) return "#EF4444";
  if (k.includes("positive") || k.includes("happy") || k.includes("рад")) return "#F59E0B";
  if (k.includes("sad") || k.includes("sadness") || k.includes("гру")) return "#3B82F6";
  if (k.includes("stress") || k.includes("fear") || k.includes("anx") || k.includes("стр") || k.includes("трев") || k.includes("страх"))
    return "#A855F7";
  if (k.includes("calm") || k.includes("neutral") || k.includes("нейт") || k.includes("спок")) return "#94A3B8";

  if (k.includes("truth") || k === "true" || k.includes("ист")) return "#22D3EE";
  if (k.includes("lie") || k === "false" || k.includes("лож")) return "#0F172A";

  return "#64748B";
}

type Row = {
  label: string;
  frames: number;
  sec: number;
  color: string;
};

export default function LabelDistributionCard(props: {
  defaultMetric?: Metric;
  frameSec?: number;
  topN?: number;
  title?: string;
}) {
  const {
    defaultMetric = "emotion",
    frameSec = 0.016,
    topN = 6,
    title = "Распределение по меткам",
  } = props;

  const segments = useTaskStore((s) => s.segments) as any[] | undefined;

  const [metric, setMetric] = useState<Metric>(defaultMetric);

  const computed = useMemo(() => {
    const segs = (segments ?? []).filter((s) => {
      const label = String(s?.label ?? "");
      if (!label) return false;
      return metric === "emotion" ? isEmotionLabel(label) : isTruthLabel(label);
    });

    const byLabel = new Map<string, number>();
    for (const s of segs) {
      const label = String(s?.label ?? "");
      const a = Number(s?.startFrame ?? 0);
      const b = Number(s?.endFrame ?? 0);
      const len = Math.max(0, Math.floor(b) - Math.floor(a));
      if (!label || len <= 0) continue;
      byLabel.set(label, (byLabel.get(label) ?? 0) + len);
    }

    const rowsAll: Row[] = Array.from(byLabel.entries())
      .map(([label, frames]) => ({ label, frames, sec: frames * frameSec, color: segColor(label) }))
      .sort((a, b) => b.frames - a.frames);

    const totalFrames = rowsAll.reduce((acc, r) => acc + r.frames, 0);
    const base = Math.max(1, totalFrames);

    const top = rowsAll.slice(0, topN);
    const rest = rowsAll.slice(topN);
    const restFrames = rest.reduce((acc, r) => acc + r.frames, 0);

    const rows: Row[] =
      restFrames > 0
        ? [
            ...top,
            {
              label: "other",
              frames: restFrames,
              sec: restFrames * frameSec,
              color: "#CBD5E1",
            },
          ]
        : top;

    // donut
    const size = 124;
    const stroke = 14;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;

    let acc = 0;
    const arcs = rows.map((p) => {
      const frac = p.frames / base;
      const dash = frac * c;
      const gap = c - dash;
      const start = acc;
      acc += dash;
      return { ...p, pct: frac * 100, dash, gap, offset: -start };
    });

    const top1 = rowsAll[0] ?? null;

    return { segs, rowsAll, rows, totalFrames, base, arcs, top1, donut: { size, stroke, r, c } };
  }, [segments, metric, frameSec, topN]);

  const segCount = computed.segs.length;

  return (
    <Card className="rounded-2xl border bg-background shadow-sm overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
          </div>

          <div className="flex items-center gap-2">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <TabsList className="rounded-xl bg-background/70 border p-1">
                <TabsTrigger value="emotion" className="rounded-lg px-3">
                  Эмоции
                </TabsTrigger>
                <TabsTrigger value="truth" className="rounded-lg px-3">
                  Истинность
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Badge variant="outline" className="tabular-nums">
              {segCount} сегм.
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-6">
        {segCount === 0 ? (
          <div className="text-sm text-muted-foreground">
            Нет сегментов для выбранной метрики.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px] lg:items-start">
            <div className="space-y-2">
              {computed.rows.map((r) => {
                const pct = (r.frames / computed.base) * 100;

                return (
                  <div key={r.label} className="rounded-2xl border bg-muted/10 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{r.label}</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">{r.frames} frames</div>
                        </div>
                      </div>

                      <div className="text-right tabular-nums">
                        <div className="text-sm font-medium">{fmtSec(r.sec)}</div>
                        <div className="text-[11px] text-muted-foreground">{pct.toFixed(1)}%</div>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${r.color} 0%, ${r.color}CC 100%)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border bg-muted/10 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Обзор</div>
                <Badge variant="outline" className="tabular-nums">
                  {fmtSec(computed.totalFrames * frameSec)}
                </Badge>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <div className="relative">
                  <svg
                    width={computed.donut.size}
                    height={computed.donut.size}
                    viewBox={`0 0 ${computed.donut.size} ${computed.donut.size}`}
                  >
                    <circle
                      cx={computed.donut.size / 2}
                      cy={computed.donut.size / 2}
                      r={computed.donut.r}
                      fill="none"
                      stroke="rgba(2,6,23,0.08)"
                      strokeWidth={computed.donut.stroke}
                    />

                    {computed.arcs.map((a) => (
                      <circle
                        key={a.label}
                        cx={computed.donut.size / 2}
                        cy={computed.donut.size / 2}
                        r={computed.donut.r}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={computed.donut.stroke}
                        strokeLinecap="round"
                        strokeDasharray={`${a.dash} ${a.gap}`}
                        strokeDashoffset={a.offset}
                        transform={`rotate(-90 ${computed.donut.size / 2} ${computed.donut.size / 2})`}
                      />
                    ))}
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-xs text-muted-foreground">топ</div>
                    <div className="text-lg font-semibold leading-none">{computed.top1?.label ?? "—"}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                      {computed.top1 ? `${((computed.top1.frames / computed.base) * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Доминирует</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: computed.top1?.color ?? "#94A3B8" }}
                    />
                    <div className="font-medium truncate">{computed.top1?.label ?? "—"}</div>
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground">
                    {computed.rowsAll.length} классов • {segCount} сегментов
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {computed.rows.slice(0, 5).map((r) => (
                  <span
                    key={r.label}
                    className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-2.5 py-1 text-[11px] backdrop-blur"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                    <span className="max-w-[120px] truncate">{r.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
