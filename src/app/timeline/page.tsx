"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SpectrogramPanel from "@/components/spectrogram/SpectrogramPanel";
import RightPanel from "@/components/spectrogram/RightPanel";
import { useTaskStore } from "@/store/taskStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppFooter from "@/components/layout/AppFooter";
import LabelDistributionCard from "@/components/tables/LabelDistributionCard";
import ScrollToTopFab from "@/components/ui/ScrollToTopFab";

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
  const features = useTaskStore((s) => s.features);
  const segments = useTaskStore((s) => s.segments) as any[] | undefined;

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
        timeline: typeof j.scroll?.timeline === "number" ? j.scroll!.timeline! : 0,
        low: typeof j.scroll?.low === "number" ? j.scroll!.low! : 0,
      };

      if (j.tab === "timeline" || j.tab === "low") {
        activeTabRef.current = j.tab;
        setTab(j.tab);
      }
    } catch {
    }
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

      (window as any).__tabScrollR2 = r2;
    });

    return () => {
      cancelAnimationFrame(r1);
      const r2 = (window as any).__tabScrollR2;
      if (typeof r2 === "number") cancelAnimationFrame(r2);
    };
  }, [tab]);

  useEffect(() => {
    if (!spectrogram && status === "queued") pollTask("demo");
  }, [spectrogram, status, pollTask]);

  const kpi = useMemo(() => {
    const segCount = segments?.length ?? 0;
    const cols = features?.columns?.length ?? 0;
    const rows = features?.rows?.length ?? 0;
    const frames = spectrogram?.frames ?? "—";
    const bins = spectrogram?.melBins ?? "—";
    return { segCount, cols, rows, frames, bins };
  }, [segments, features, spectrogram]);

  const sourceLabel = spectrogram ? "server" : "demo";

  return (
    <main className="min-h-screen bg-muted/30 flex flex-col">
      <div className="mx-auto w-full max-w-[92rem] px-3 py-6 md:px-6 md:py-8 2xl:px-10 space-y-6 flex-1">
        <AppHeader title="Во временном ряде" subtitle="Спектрограмма, сегменты и признаки" />

        <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
          <div
            id="timeline-tabs"
            className="sticky top-0 z-20 -mx-3 px-3 py-2 md:-mx-6 md:px-6 2xl:-mx-10 2xl:px-10 bg-muted/30 backdrop-blur supports-[backdrop-filter]:bg-muted/20"
          >
            <TabsList className="w-full sm:w-auto rounded-xl bg-background/70 border p-1 shadow-sm">
              <TabsTrigger value="timeline" className="rounded-lg px-3">
                Во временном ряде
              </TabsTrigger>
              <TabsTrigger value="low" className="rounded-lg px-3">
                Низкоуровневые
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="timeline" className="space-y-4">
            <Card className="rounded-2xl border bg-background shadow-sm overflow-hidden">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">MEL Спектрограмма</CardTitle>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Наведи на верхнюю полосу сегментов - увидишь детали. Переключай режимы внутри спектрограммы.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={statusTone(String(status))}>{String(status)}</Badge>
                    <Button variant="outline" size="sm" onClick={reset}>
                      Сброс
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 md:p-6 space-y-4">
                <div className="w-full">
                  <SpectrogramPanel />
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="text-xs text-muted-foreground">Основная эмоция</div>
                    <div className="mt-2">
                      <Badge variant="secondary" className="px-3 py-1 text-sm">
                        {mainEmotion ?? "—"}
                      </Badge>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="text-xs text-muted-foreground">Сегментов</div>
                    <div className="mt-2 text-2xl font-semibold tabular-nums">{kpi.segCount}</div>
                    <div className="text-xs text-muted-foreground mt-1">всего в payload</div>
                  </div>

                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="text-xs text-muted-foreground">Спектрограмма</div>
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">frames:</span>{" "}
                      <span className="font-medium tabular-nums">{kpi.frames}</span>
                      <span className="mx-2 text-muted-foreground">•</span>
                      <span className="text-muted-foreground">bins:</span>{" "}
                      <span className="font-medium tabular-nums">{kpi.bins}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">источник: {sourceLabel}</div>
                  </div>

                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="text-xs text-muted-foreground">Параметры обработки</div>

                    <div className="mt-2 grid gap-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">модель</span>
                        <span className="font-medium">{prettyModel(runModelId)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">окно</span>
                        <span className="font-medium tabular-nums">
                          {typeof runWindowMs === "number" ? `${runWindowMs} ms` : "—"}
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
            <Card className="rounded-2xl border bg-background shadow-sm overflow-hidden">
              <CardHeader className="border-b">
                <CardTitle>Низкоуровневые признаки</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground p-5">
                <RightPanel tableOnly title="Низкоуровневые дескрипторы" />
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
