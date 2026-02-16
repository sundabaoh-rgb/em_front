"use client";

import { useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/store/taskStore";
import { downloadCsvFile } from "@/lib/csv";

type RightPanelProps = {
  summaryOnly?: boolean;
  tableOnly?: boolean;
  title?: string;
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
  const mainEmotion = useTaskStore((s) => s.mainEmotion);
  const features = useTaskStore((s) => s.features);
  const status = useTaskStore((s) => s.status);

  const { headerCols, rows, colSpan } = useMemo(() => {
    const cols = features?.columns ?? [];
    const safeCols = cols.length ? cols : ["—", "—", "—"];

    const safeRows =
      (features?.rows ?? []).map((r) => {
        const vals = Array.isArray(r.values) ? r.values.map(String) : [];
        const padded = Array.from({ length: safeCols.length }, (_, i) => vals[i] ?? "—");
        return { name: r.name ?? "—", values: padded };
      }) ?? [];

    return { headerCols: safeCols, rows: safeRows, colSpan: 1 + safeCols.length };
  }, [features]);

  const hasData =
    !!features &&
    (features.columns?.length ?? 0) > 0 &&
    (features.rows?.length ?? 0) > 0;

  const downloadCsv = useCallback(() => {
    if (!features?.columns?.length || !features?.rows?.length) return;
    const headers = ["name", ...features.columns];
    const rowsForCsv = features.rows.map((r) => [r.name ?? "", ...((r.values ?? []) as any[])]);
    downloadCsvFile("features.csv", headers, rowsForCsv);
  }, [features]);

  const showSummary = !tableOnly;
  const showTable = !summaryOnly;

  return (
    <Card className="rounded-2xl border bg-background shadow-sm overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            {title ?? "Анализ"}
            {!tableOnly ? <Badge variant={statusTone(String(status))}>{String(status)}</Badge> : null}
          </span>

          <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={!hasData}>
            Скачать CSV
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className={showTable && !showSummary ? "p-0" : "p-5 space-y-5"}>
        {showSummary ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Основная эмоция</p>
            <Badge variant="secondary" className="px-3 py-1 text-sm">
              {mainEmotion ?? "—"}
            </Badge>
          </div>
        ) : null}

        {showTable ? (
          <div className={showSummary ? "space-y-2" : ""}>
            {showSummary ? <p className="text-sm text-muted-foreground">Признаки</p> : null}

            <div className={showSummary ? "rounded-xl border overflow-hidden" : ""}>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="border-b">
                      <th className="text-left font-medium px-4 py-3 text-muted-foreground">
                        Feature
                      </th>
                      {headerCols.map((c, i) => (
                        <th
                          key={`${c}-${i}`}
                          className="text-right font-medium px-4 py-3 text-muted-foreground tabular-nums"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r, ri) => (
                      <tr
                        key={`${r.name}-${ri}`}
                        className="border-b last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        {r.values.map((v, vi) => (
                          <td key={`${r.name}-${vi}`} className="px-4 py-3 text-right tabular-nums">
                            {v === "—" ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              fmt(v)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}

                    {!hasData ? (
                      <tr>
                        <td colSpan={colSpan} className="text-center text-muted-foreground py-14">
                          Нет данных
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 text-xs text-muted-foreground border-t">
                ...
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
