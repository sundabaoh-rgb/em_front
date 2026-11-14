"use client";

import { useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/store/taskStore";
import { downloadCsvFile } from "@/lib/csv";
import { Download, TableProperties } from "lucide-react";

type RightPanelProps = {
  summaryOnly?: boolean;
  tableOnly?: boolean;
  title?: string;
};

type FeatureRow = {
  name?: string;
  values?: Array<string | number | null | undefined>;
};

type FeaturesData = {
  columns?: string[];
  rows?: FeatureRow[];
};

type TaskStoreWithFeatures = {
  mainEmotion?: string | null;
  status?: string;
  features?: FeaturesData | null;
};

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "destructive" as const;
  if (s.includes("done") || s.includes("success") || s.includes("complete")) return "secondary" as const;
  if (s.includes("run") || s.includes("process") || s.includes("progress")) return "default" as const;
  return "outline" as const;
}

function fmt(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(1);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

export default function RightPanel({ summaryOnly, tableOnly, title }: RightPanelProps) {
  const mainEmotion = useTaskStore((s) => (s as TaskStoreWithFeatures).mainEmotion);
  const features = useTaskStore((s) => (s as TaskStoreWithFeatures).features);
  const status = useTaskStore((s) => (s as TaskStoreWithFeatures).status);

  const { headerCols, rows, colSpan } = useMemo(() => {
    const cols = Array.isArray(features?.columns) ? features.columns : [];
    const safeCols = cols.length ? cols : ["Значение"];

    const safeRows = (Array.isArray(features?.rows) ? features.rows : []).map((r: FeatureRow) => {
      const vals = Array.isArray(r.values) ? r.values.map((v) => String(v ?? "—")) : [];
      const padded = Array.from({ length: safeCols.length }, (_, i) => vals[i] ?? "—");

      return {
        name: r.name ?? "—",
        values: padded,
      };
    });

    return {
      headerCols: safeCols,
      rows: safeRows,
      colSpan: 1 + safeCols.length,
    };
  }, [features]);

  const hasData =
    !!features &&
    (features.columns?.length ?? 0) > 0 &&
    (features.rows?.length ?? 0) > 0;

  const downloadCsv = useCallback(() => {
    if (!features?.columns?.length || !features?.rows?.length) return;

    const headers = ["name", ...features.columns];
    const rowsForCsv = features.rows.map((r: FeatureRow) => [
      r.name ?? "",
      ...(Array.isArray(r.values) ? r.values : []),
    ]);

    downloadCsvFile("features.csv", headers, rowsForCsv);
  }, [features]);

  const showSummary = !tableOnly;
  const showTable = !summaryOnly;

  return (
    <Card className="rounded-2xl border bg-background shadow-xs overflow-hidden">
      <CardHeader className="border-b bg-muted/15 py-3.5 px-5">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2.5">
            <TableProperties className="h-4 w-4 text-muted-foreground" />
            <span>{title ?? "Акустические признаки"}</span>
            {!tableOnly && status ? (
              <Badge variant={statusTone(String(status))} className="text-xs font-normal">
                {String(status)}
              </Badge>
            ) : null}
          </span>

          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!hasData} className="gap-2 h-8 text-xs">
            <Download className="h-3.5 w-3.5" />
            Скачать CSV
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className={showTable && !showSummary ? "p-0" : "p-5 space-y-5"}>
        {showSummary ? (
          <div className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Основная эмоция
            </span>
            <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
              {mainEmotion ?? "—"}
            </Badge>
          </div>
        ) : null}

        {showTable ? (
          <div className={showSummary ? "space-y-2.5" : ""}>
            {showSummary ? (
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Признаки ({rows.length})
                </p>
              </div>
            ) : null}

            <div className={showSummary ? "rounded-xl border overflow-hidden" : ""}>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr className="border-b">
                      <th className="text-left text-xs font-semibold uppercase tracking-wider px-4 py-2.5 text-muted-foreground">
                        Признак
                      </th>
                      {headerCols.map((c: string, i: number) => (
                        <th
                          key={`${c}-${i}`}
                          className="text-right text-xs font-semibold uppercase tracking-wider px-4 py-2.5 text-muted-foreground tabular-nums"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y">
                    {rows.map((r: { name: string; values: string[] }, ri: number) => (
                      <tr
                        key={`${r.name}-${ri}`}
                        className="transition-colors hover:bg-muted/30 even:bg-muted/10"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground/90">
                          {r.name}
                        </td>
                        {r.values.map((v: string, vi: number) => (
                          <td key={`${r.name}-${vi}`} className="px-4 py-2.5 text-right text-xs tabular-nums">
                            {v === "—" ? (
                              <span className="text-muted-foreground/50">—</span>
                            ) : (
                              fmt(v)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}

                    {!hasData ? (
                      <tr>
                        <td colSpan={colSpan} className="text-center text-muted-foreground py-12 text-xs">
                          Данные признаков появятся после завершения анализа
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}