"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SpectrogramPanel from "@/components/spectrogram/SpectrogramPanel";
import { useTaskStore } from "@/store/taskStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppFooter from "@/components/layout/AppFooter";
import LabelDistributionCard from "@/components/tables/LabelDistributionCard";
import ScrollToTopFab from "@/components/ui/ScrollToTopFab";
import FeaturesTablePanel from "@/components/features/FeaturesTablePanel";
import { Activity, Layers, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "destructive" as const;
  if (s.includes("done") || s.includes("success") || s.includes("complete")) return "secondary" as const;
  if (s.includes("run") || s.includes("process") || s.includes("progress")) return "default" as const;
  if (s.includes("queue")) return "default" as const;
  return "outline" as const;
}

function prettyModel(modelId: string | null) {
  if (!modelId) return "—";
  const map: Record<string, string> = {
    base_like_vgg: "base_like_vgg",
    base_like_vgg_v2: "base_like_vgg_v2",
    opensmile_mfcc120: "opensmile_mfcc120",
  };
  return map[modelId] ?? modelId;
}

type TabKey = "timeline" | "low";
const SCROLL_KEY = "timelineTabsScroll:v2";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function TimelinePage() {
  const spectrogram = useTaskStore((s) => s.spectrogram);
  const status = useTaskStore((s) => s.status);
  const pollTask = useTaskStore((s) => s.pollTask);
  const reset = useTaskStore((s) => s.reset);

  const mainEmotion = useTaskStore((s) => s.mainEmotion);
  const segments = useTaskStore((s) => s.segments);

  const featuresFile = useTaskStore((s) => s.featuresFile);
  const featuresCache = useTaskStore((s) => s.featuresCache);

  const runModelId = useTaskStore((s) => s.runModelId);
  const runWindowMs = useTaskStore((s) => s.runWindowMs);

  const [tab, setTab] = useState<TabKey>("timeline");
  const scrollByTabRef = useRef<Record<TabKey, number>>({ timeline: 0, low: 0 });
  const activeTabRef = useRef<TabKey>("timeline");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SCROLL_KEY);
      if (!raw) return;

      const j = JSON.parse(raw) as { tab?: TabKey; scroll?: Partial<Record<TabKey, number>> } | null;
      if (!j) return;

      scrollByTabRef.current = {
        timeline: typeof j.scroll?.timeline === "number" ? j.scroll.timeline : 0,
        low: typeof j.scroll?.low === "number" ? j.scroll.low : 0,
      };

      if (j.tab === "timeline" || j.tab === "low") {
        activeTabRef.current = j.tab;
        setTab(j.tab);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        scrollByTabRef.current[activeTabRef.current] = window.scrollY || 0;

        try {
          sessionStorage.setItem(
            SCROLL_KEY,
            JSON.stringify({ tab: activeTabRef.current, scroll: scrollByTabRef.current })
          );
        } catch {}
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const onTabChange = (nextValue: string) => {
    const nextTab: TabKey = nextValue === "low" ? "low" : "timeline";
    const prevTab = activeTabRef.current;

    scrollByTabRef.current[prevTab] = window.scrollY || 0;

    activeTabRef.current = nextTab;
    setTab(nextTab);

    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ tab: nextTab, scroll: scrollByTabRef.current }));
    } catch {}
  };

  useEffect(() => {
    const target = scrollByTabRef.current[tab] ?? 0;

    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const top = clamp(target, 0, max);
        window.scrollTo({ top, behavior: "auto" });
      });

      (window as unknown as { __tabScrollR2?: number }).__tabScrollR2 = r2;
    });

    return () => {
      cancelAnimationFrame(r1);
      const r2 = (window as unknown as { __tabScrollR2?: number }).__tabScrollR2;
      if (typeof r2 === "number") cancelAnimationFrame(r2);
    };
  }, [tab]);

  useEffect(() => {
    if (!spectrogram && status === "queued") pollTask("demo");
  }, [spectrogram, status, pollTask]);

  const kpi = useMemo(() => {
    const segCount = segments?.length ?? 0;
    const frames = spectrogram?.frames ?? "—";
    const bins = spectrogram?.melBins ?? "—";
    const hasCsv = Boolean(featuresFile?.url);
    const cachedKb = featuresCache?.blob?.size ? Math.round(featuresCache.blob.size / 1024) : null;

    return { segCount, frames, bins, hasCsv, cachedKb };
  }, [segments, spectrogram, featuresFile, featuresCache]);

  const sourceLabel = spectrogram ? "server" : "demo";

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="mx-auto w-full max-w-[92rem] px-4 py-6 md:px-6 md:py-8 2xl:px-10 space-y-6 flex-1">
        <AppHeader title="Во временном ряде" subtitle="Детальная мел-спектрограмма, разметка сегментов и низкоуровневые признаки" />

        <Tabs value={tab} onValueChange={onTabChange} className="space-y-5">
          <div
            id="timeline-tabs"
            className="sticky top-0 z-30 -mx-4 px-4 py-2.5 md:-mx-6 md:px-6 2xl:-mx-10 2xl:px-10 bg-background/85 backdrop-blur-md border-b border-slate-200/60"
          >
            <TabsList className="w-full sm:w-auto rounded-xl bg-slate-200/70 p-1">
              <TabsTrigger value="timeline" className="rounded-lg px-4 text-xs font-medium">
                Во временном ряде
              </TabsTrigger>
              <TabsTrigger value="low" className="rounded-lg px-4 text-xs font-medium">
                Низкоуровневые признаки
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="timeline" className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-slate-50/50 py-3.5 px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">Интерактивная мел-спектрограмма</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Наведите курсор на полосу сегментов сверху для просмотра уверенности модели
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={statusTone(String(status))}>{String(status)}</Badge>
                    <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 h-8 text-xs bg-white">
                      <RotateCcw className="h-3.5 w-3.5" />
                      Сброс
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5 space-y-5">
                <div className="w-full">
                  <SpectrogramPanel />
                </div>

                {/* Сетка KPI карточек */}
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Основная эмоция</span>
                      <Sparkles className="h-4 w-4 text-primary/70" />
                    </div>
                    <div className="mt-3">
                      <Badge variant="secondary" className="px-3 py-1 text-sm font-semibold">
                        {mainEmotion ?? "—"}
                      </Badge>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Сегментов найдено</span>
                      <Layers className="h-4 w-4 text-primary/70" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-bold tracking-tight tabular-nums">{kpi.segCount}</span>
                      <span className="text-xs text-muted-foreground">интервалов</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Размерность спектра</span>
                      <Activity className="h-4 w-4 text-primary/70" />
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Кадры (frames):</span>
                        <span className="font-semibold tabular-nums">{kpi.frames}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Частоты (bins):</span>
                        <span className="font-semibold tabular-nums">{kpi.bins} ({sourceLabel})</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Конфигурация</span>
                      <SlidersHorizontal className="h-4 w-4 text-primary/70" />
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Модель:</span>
                        <span className="font-semibold truncate">{prettyModel(runModelId)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Окно / CSV:</span>
                        <span className="font-semibold tabular-nums">
                          {typeof runWindowMs === "number" ? `${runWindowMs} мс` : "—"} •{" "}
                          {kpi.hasCsv ? (kpi.cachedKb ? `${kpi.cachedKb} KB` : "есть") : "нет"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <LabelDistributionCard defaultMetric="emotion" />
          </TabsContent>

          <TabsContent value="low">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-slate-50/50 py-3.5 px-5">
                <CardTitle className="text-base">Низкоуровневые акустические признаки</CardTitle>
              </CardHeader>

              <CardContent className="p-5">
                <FeaturesTablePanel />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ScrollToTopFab />

      <AppFooter
        brand="Emotion detection"
        meta="v0.1 • demo"
        githubUrl="#"
        email="support@example.com"
        links={[
          { label: "Документация", href: "#" },
          { label: "Приватность", href: "#" },
          { label: "Поддержка", href: "#" },
        ]}
      />
    </main>
  );
}