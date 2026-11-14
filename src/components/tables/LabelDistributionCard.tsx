"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useTaskStore } from "@/store/taskStore";
import { PieChart, Sparkles } from "lucide-react";

type Metric = "emotion" | "truth";

function fmtSec(s: number) {
  if (!Number.isFinite(s) || s < 0) return "—";
  if (s < 60) return `${s.toFixed(1)}с`;
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

function resolveLabelMeta(rawLabel: string): { key: string; title: string; color: string } {
  const k = normLabel(rawLabel);

  if (k.includes("angry") || k.includes("rage") || k.includes("зл"))
    return { key: "angry", title: "Злость", color: "#EF4444" };
  if (k.includes("positive") || k.includes("happy") || k.includes("рад"))
    return { key: "happy", title: "Радость", color: "#F59E0B" };
  if (k.includes("sad") || k.includes("sadness") || k.includes("гру"))
    return { key: "sad", title: "Грусть", color: "#3B82F6" };
  if (
    k.includes("stress") ||
    k.includes("fear") ||
    k.includes("anx") ||
    k.includes("стр") ||
    k.includes("трев") ||
    k.includes("страх")
  )
    return { key: "stress", title: "Стресс / Тревога", color: "#A855F7" };
  if (k.includes("calm") || k.includes("neutral") || k.includes("нейт") || k.includes("спок"))
    return { key: "neutral", title: "Спокойствие", color: "#64748B" };

  if (k.includes("truth") || k === "true" || k.includes("ист"))
    return { key: "truth", title: "Истина", color: "#06B6D4" };
  if (k.includes("lie") || k === "false" || k.includes("лож"))
    return { key: "lie", title: "Ложь", color: "#0F172A" };

  return { key: k || "other", title: rawLabel || "Прочее", color: "#94A3B8" };
}

type Row = {
  key: string;
  title: string;
  frames: number;
  count: number;
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
    title = "Распределение по классам",
  } = props;

  const segments = useTaskStore((s) => s.segments) as any[] | undefined;

  const [metric, setMetric] = useState<Metric>(defaultMetric);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const computed = useMemo(() => {
    const segs = (segments ?? []).filter((s) => {
      const label = String(s?.label ?? "");
      if (!label) return false;
      return metric === "emotion" ? isEmotionLabel(label) : isTruthLabel(label);
    });

    const byKey = new Map<string, { title: string; color: string; frames: number; count: number }>();

    for (const s of segs) {
      const label = String(s?.label ?? "");
      const a = Number(s?.startFrame ?? 0);
      const b = Number(s?.endFrame ?? 0);
      const len = Math.max(0, Math.floor(b) - Math.floor(a));
      if (!label || len <= 0) continue;

      const meta = resolveLabelMeta(label);
      const prev = byKey.get(meta.key);
      if (prev) {
        prev.frames += len;
        prev.count += 1;
      } else {
        byKey.set(meta.key, { title: meta.title, color: meta.color, frames: len, count: 1 });
      }
    }

    const rowsAll: Row[] = Array.from(byKey.entries())
      .map(([key, v]) => ({
        key,
        title: v.title,
        frames: v.frames,
        count: v.count,
        sec: v.frames * frameSec,
        color: v.color,
      }))
      .sort((a, b) => b.frames - a.frames);

    const totalFrames = rowsAll.reduce((acc, r) => acc + r.frames, 0);
    const base = Math.max(1, totalFrames);

    const top = rowsAll.slice(0, topN);
    const rest = rowsAll.slice(topN);
    const restFrames = rest.reduce((acc, r) => acc + r.frames, 0);
    const restCount = rest.reduce((acc, r) => acc + r.count, 0);

    const rows: Row[] =
      restFrames > 0
        ? [
            ...top,
            {
              key: "other",
              title: "Остальные",
              frames: restFrames,
              count: restCount,
              sec: restFrames * frameSec,
              color: "#CBD5E1",
            },
          ]
        : top;

    // Параметры кольцевой диаграммы (Donut)
    const size = 148;
    const stroke = 16;
    const r = (size - stroke - 8) / 2;
    const c = 2 * Math.PI * r;
    const padPx = rows.length > 1 ? 3 : 0;

    let acc = 0;
    const arcs = rows.map((p) => {
      const frac = p.frames / base;
      const rawDash = frac * c;
      const dash = Math.max(1, rawDash - padPx);
      const gap = Math.max(0, c - dash);
      const start = acc;
      acc += rawDash;
      return { ...p, pct: frac * 100, dash, gap, offset: -start };
    });

    const top1 = rowsAll[0] ?? null;

    return { segs, rowsAll, rows, totalFrames, base, arcs, top1, donut: { size, stroke, r, c } };
  }, [segments, metric, frameSec, topN]);

  const segCount = computed.segs.length;

  const activeItem = useMemo(() => {
    if (hoveredKey) {
      const found = computed.arcs.find((a) => a.key === hoveredKey);
      if (found) return found;
    }
    if (!computed.top1) return null;
    return {
      ...computed.top1,
      pct: (computed.top1.frames / computed.base) * 100,
    };
  }, [hoveredKey, computed]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-slate-50/50 py-3.5 px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <PieChart className="h-4 w-4 text-sky-600 shrink-0" />
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Суммарное время и доля каждого класса в аудиозаписи
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <TabsList className="rounded-xl bg-slate-200/70 p-1 h-8">
                <TabsTrigger value="emotion" className="rounded-lg px-3 text-xs">
                  Эмоции
                </TabsTrigger>
                <TabsTrigger value="truth" className="rounded-lg px-3 text-xs">
                  Истинность
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Badge variant="outline" className="bg-white tabular-nums">
              {segCount} сегм.
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {segCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 py-10 text-center text-xs text-muted-foreground">
            Нет размеченных сегментов для выбранного режима («{metric === "emotion" ? "Эмоции" : "Истинность"}»).
          </div>
        ) : (
          <div className="space-y-4">
            {/* Единая мульти-шкала баланса всех классов */}
            <div className="space-y-1.5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/70 gap-0.5">
                {computed.arcs.map((a) => (
                  <div
                    key={a.key}
                    onMouseEnter={() => setHoveredKey(a.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                    className="h-full first:rounded-l-full last:rounded-r-full transition-opacity cursor-pointer"
                    style={{
                      width: `${Math.max(1.5, a.pct)}%`,
                      backgroundColor: a.color,
                      opacity: hoveredKey && hoveredKey !== a.key ? 0.35 : 1,
                    }}
                    title={`${a.title}: ${a.pct.toFixed(1)}% (${fmtSec(a.sec)})`}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_300px] lg:items-stretch">
              {/* Список классов с контрастными прогресс-барами */}
              <div className="grid gap-2.5 sm:grid-cols-2 content-start">
                {computed.rows.map((r) => {
                  const pct = (r.frames / computed.base) * 100;
                  const isHovered = hoveredKey === r.key;

                  return (
                    <div
                      key={r.key}
                      onMouseEnter={() => setHoveredKey(r.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      className={`rounded-xl border p-3 transition-all cursor-default ${
                        isHovered
                          ? "border-slate-300 bg-slate-50/90 shadow-2xs"
                          : "border-slate-200/80 bg-white hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="h-3 w-3 rounded-full shrink-0 ring-2 ring-offset-1 ring-transparent"
                            style={{ backgroundColor: r.color }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate">
                              {r.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground tabular-nums">
                              {r.count} сегм. • {r.frames} кадр.
                            </div>
                          </div>
                        </div>

                        <div className="text-right tabular-nums shrink-0">
                          <div className="text-xs font-bold text-foreground">
                            {pct.toFixed(1)}%
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtSec(r.sec)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: r.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Правая карточка с интерактивной кольцевой диаграммой */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Сводная диаграмма
                  </span>
                  <Badge variant="outline" className="bg-white text-[11px] tabular-nums">
                    Всего: {fmtSec(computed.totalFrames * frameSec)}
                  </Badge>
                </div>

                <div className="my-3 flex items-center justify-center">
                  <div className="relative" style={{ width: computed.donut.size, height: computed.donut.size }}>
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
                        stroke="#e2e8f0"
                        strokeWidth={computed.donut.stroke}
                      />

                      {computed.arcs.map((a) => {
                        const isArcHovered = hoveredKey === a.key;
                        const isDimmed = hoveredKey !== null && !isArcHovered;

                        return (
                          <circle
                            key={a.key}
                            cx={computed.donut.size / 2}
                            cy={computed.donut.size / 2}
                            r={computed.donut.r}
                            fill="none"
                            stroke={a.color}
                            strokeWidth={isArcHovered ? computed.donut.stroke + 3 : computed.donut.stroke}
                            strokeDasharray={`${a.dash} ${a.gap}`}
                            strokeDashoffset={a.offset}
                            transform={`rotate(-90 ${computed.donut.size / 2} ${computed.donut.size / 2})`}
                            className="transition-all duration-200 cursor-pointer"
                            style={{ opacity: isDimmed ? 0.35 : 1 }}
                            onMouseEnter={() => setHoveredKey(a.key)}
                            onMouseLeave={() => setHoveredKey(null)}
                          />
                        );
                      })}
                    </svg>

                    {/* Центр бублика */}
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {hoveredKey ? "выбрано" : "лидер"}
                      </span>
                      <span className="mt-0.5 text-lg font-bold tracking-tight text-foreground tabular-nums leading-none">
                        {activeItem ? `${activeItem.pct.toFixed(0)}%` : "—"}
                      </span>
                      <span className="mt-1 max-w-[92px] truncate text-[11px] font-medium text-muted-foreground">
                        {activeItem?.title ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Нижняя плашка лидера */}
                <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="text-muted-foreground truncate">Доминирует:</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-semibold truncate">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: computed.top1?.color ?? "#94A3B8" }}
                    />
                    <span className="truncate">{computed.top1?.title ?? "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}