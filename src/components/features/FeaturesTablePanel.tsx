"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useTaskStore } from "@/store/taskStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Copy,
  Download,
  Pin,
  GripVertical,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
  X,
  FileSpreadsheet,
  BarChart2,
} from "lucide-react";

type Parsed = {
  columns: string[];
  rows: (string | number | null)[][];
};

type ColRef = { name: string; idx: number };

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fmtStatNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 1000) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(3).replace(/\.?0+$/, "");
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function columnStats(rows: (string | number | null)[][], colIdx: number) {
  const nums: number[] = [];
  let empty = 0;

  for (const r of rows) {
    const n = asNumber(r[colIdx]);
    if (n === null) empty++;
    else nums.push(n);
  }

  nums.sort((a, b) => a - b);
  const count = nums.length;
  const min = count ? nums[0] : null;
  const max = count ? nums[count - 1] : null;
  const sum = count ? nums.reduce((a, b) => a + b, 0) : 0;
  const avg = count ? sum / count : null;
  const median = count
    ? count % 2
      ? nums[(count - 1) / 2]
      : (nums[count / 2 - 1] + nums[count / 2]) / 2
    : null;

  return { count, empty, min, max, avg, median };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;

  const re = new RegExp(escapeRegExp(q), "ig");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark
        key={`${start}-${end}`}
        className="rounded px-1 py-[1px] bg-amber-200 text-slate-900 font-semibold"
      >
        {text.slice(start, end)}
      </mark>
    );
    last = end;
    if (re.lastIndex === m.index) re.lastIndex++;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

/* ---------------- grid sizing ---------------- */

const ROW_H = 38;
const OVERSCAN = 12;

const IDX_W_MIN = 64;
const IDX_W_MAX = 92;

const COL_W_MIN = 165;
const COL_W_MAX = 480;

function estimateHeaderPx(len: number) {
  // Учитываем ширину иконок перетаскивания, закрепления и статистики (+76px)
  return Math.round(len * 7.6 + 76);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------- column groups ---------- */

type ColGroup = { key: string; title: string; idxs: number[]; order: number };

type GroupDef = {
  key: string;
  title: string;
  order: number;
  test: (n: string) => boolean;
};

function normName(name: string) {
  return (name || "").trim().toLowerCase();
}

const GROUP_DEFS: GroupDef[] = [
  { key: "mfcc", title: "MFCC", order: 10, test: (n) => n.startsWith("mfcc") },
  {
    key: "formants",
    title: "Форманты",
    order: 20,
    test: (n) =>
      /^f[1-9]\d*(frequency|bandwidth|amplitudelogrelf0|amplitude|amplituderel|amplitudelog)/.test(
        n
      ) || n.includes("formant"),
  },
  {
    key: "pitch_f0",
    title: "Тон / F0",
    order: 30,
    test: (n) =>
      n.startsWith("f0") ||
      n.includes("pitch") ||
      n.includes("fundamentalfrequency") ||
      n.includes("voicedf0") ||
      n.includes("f0final") ||
      n.includes("semitone"),
  },
  {
    key: "voice_quality",
    title: "Качество голоса",
    order: 40,
    test: (n) =>
      n.includes("jitter") ||
      n.includes("shimmer") ||
      n.startsWith("hnr") ||
      n.includes("harmonicsnoiseratio") ||
      n.includes("hnrdb"),
  },
  {
    key: "spectral",
    title: "Спектральные",
    order: 50,
    test: (n) =>
      n.includes("alpharatio") ||
      n.includes("hammarberg") ||
      n.includes("spectral") ||
      n.includes("spectrum") ||
      n.includes("centroid") ||
      n.includes("flux") ||
      n.includes("rolloff") ||
      n.includes("slope") ||
      n.includes("flatness") ||
      n.includes("entropy") ||
      n.includes("bandenergy") ||
      n.includes("logrelf0"),
  },
  {
    key: "loudness",
    title: "Громкость",
    order: 60,
    test: (n) => n.includes("loudness") || n.includes("intensity"),
  },
  {
    key: "energy",
    title: "Энергия / ZCR",
    order: 70,
    test: (n) =>
      n.includes("energy") ||
      n.includes("rms") ||
      n.includes("power") ||
      n.includes("zcr") ||
      n.includes("zerocross"),
  },
  {
    key: "voicing",
    title: "Вокализация",
    order: 80,
    test: (n) =>
      n.includes("voicing") ||
      n.includes("vuv") ||
      n.includes("probabilityvoicing") ||
      n.includes("voiced") ||
      n.includes("unvoiced"),
  },
];

function groupForColumn(name: string): { key: string; title: string; order: number } {
  const n = normName(name);
  for (const g of GROUP_DEFS) if (g.test(n)) return { key: g.key, title: g.title, order: g.order };

  const prefix = n.split(/[._:\-\/\s]+/g).filter(Boolean)[0] || "other";
  if (prefix && prefix.length >= 3 && !/^\d+$/.test(prefix)) {
    return { key: `misc_${prefix}`, title: `Прочее: ${prefix}`, order: 900 };
  }
  return { key: "other", title: "Прочее", order: 999 };
}

type DragState = {
  colIdx: number;
  startClientX: number;
  curClientX: number;
  pointerId: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
};

export default function FeaturesTablePanel() {
  const { status, featuresCache, featuresCacheError, downloadFeatures, prefetchFeatures } =
    useTaskStore();

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(200);
  const [page, setPage] = useState(0);

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [activeCol, setActiveCol] = useState<ColRef | null>(null);
  const [colSheetOpen, setColSheetOpen] = useState(false);
  const [showColPicker, setShowColPicker] = useState(false);

  const [colOrder, setColOrder] = useState<number[]>([]);
  const [pinnedCols, setPinnedCols] = useState<number[]>([]);
  const [colWidth, setColWidth] = useState<Record<number, number>>({});

  const [selected, setSelected] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  const [colPickerQ, setColPickerQ] = useState("");
  const [activeGroupKeys, setActiveGroupKeys] = useState<string[]>([]);

  const resizeRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [headerH, setHeaderH] = useState(42);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const headerCellRef = useRef<Record<number, HTMLDivElement | null>>({});

  const scrollToTopOfGrid = () => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  };

  useEffect(() => {
    if (status === "done" && !featuresCache) {
      prefetchFeatures().catch(() => {});
    }
  }, [status, featuresCache, prefetchFeatures]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setParseError(null);
      setParsed(null);

      if (!featuresCache?.blob) return;

      const text = await featuresCache.blob.text();
      const res = Papa.parse<string[]>(text, { skipEmptyLines: true });

      if (cancelled) return;

      if (res.errors?.length) {
        setParseError(res.errors[0]?.message || "Ошибка чтения CSV");
        return;
      }

      const data = res.data as unknown as string[][];
      if (!data?.length) {
        setParseError("CSV файл пуст");
        return;
      }

      const columns = data[0].map((x) => String(x ?? "").trim());
      const rows = data.slice(1).map((r) =>
        columns.map((_, i) => {
          const v = r[i];
          const s = v === undefined ? "" : String(v);
          const n = asNumber(s);
          return n !== null ? n : s.trim() ? s : null;
        })
      );

      setParsed({ columns, rows });

      const nextVisible: Record<string, boolean> = {};
      for (const c of columns) nextVisible[c] = true;
      setVisibleCols(nextVisible);

      setColOrder(columns.map((_, i) => i));
      setPinnedCols([]);
      setColWidth({});
      setSelected(null);
      setActiveCol(null);

      setPage(0);
      setColPickerQ("");
      setActiveGroupKeys([]);
      setDrag(null);
      setDragOverCol(null);
      dragRef.current = null;
      dragOverRef.current = null;

      scrollToTopOfGrid();
    }

    run().catch((e) => setParseError(e?.message ?? "Ошибка разбора CSV"));

    return () => {
      cancelled = true;
    };
  }, [featuresCache?.blob]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => setViewportH(el.clientHeight || 600));
    ro.observe(el);
    setViewportH(el.clientHeight || 600);
    return () => ro.disconnect();
  }, [parsed]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => setHeaderH(el.clientHeight || 42));
    ro.observe(el);
    setHeaderH(el.clientHeight || 42);
    return () => ro.disconnect();
  }, [parsed]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colIdx, startX, startW } = resizeRef.current;
      const dx = e.clientX - startX;
      const next = clamp(startW + dx, COL_W_MIN, COL_W_MAX);
      setColWidth((prev) => ({ ...prev, [colIdx]: next }));
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const allCols: ColRef[] = useMemo(() => {
    if (!parsed) return [];
    return parsed.columns.map((name, idx) => ({ name, idx }));
  }, [parsed]);

  const orderedVisibleCols: ColRef[] = useMemo(() => {
    if (!parsed) return [];
    const byIdx = new Map(allCols.map((c) => [c.idx, c]));
    return colOrder
      .map((idx) => byIdx.get(idx))
      .filter(Boolean)
      .filter((c) => visibleCols[(c as ColRef).name] !== false) as ColRef[];
  }, [parsed, allCols, colOrder, visibleCols]);

  const pinnedSet = useMemo(() => new Set(pinnedCols), [pinnedCols]);

  const pinnedVisible: ColRef[] = useMemo(() => {
    const byIdx = new Map(orderedVisibleCols.map((c) => [c.idx, c]));
    return pinnedCols.map((i) => byIdx.get(i)).filter(Boolean) as ColRef[];
  }, [orderedVisibleCols, pinnedCols]);

  const unpinnedVisible: ColRef[] = useMemo(() => {
    return orderedVisibleCols.filter((c) => !pinnedSet.has(c.idx));
  }, [orderedVisibleCols, pinnedSet]);

  const gridColsAll: ColRef[] = useMemo(() => {
    return [...pinnedVisible, ...unpinnedVisible];
  }, [pinnedVisible, unpinnedVisible]);

  const visualIndex = useMemo(() => {
    const m = new Map<number, number>();
    gridColsAll.forEach((c, i) => m.set(c.idx, i));
    return m;
  }, [gridColsAll]);

  const pinnedIndexByCol = useMemo(() => {
    const m = new Map<number, number>();
    pinnedVisible.forEach((c, i) => m.set(c.idx, i));
    return m;
  }, [pinnedVisible]);

  const idxW = useMemo(() => {
    if (!parsed) return IDX_W_MIN;
    const len = String(parsed.rows.length).length;
    return clamp(len * 8 + 36, IDX_W_MIN, IDX_W_MAX);
  }, [parsed]);

  const autoWidths = useMemo(() => {
    if (!parsed) return new Map<number, number>();

    const SAMPLE = 40;
    const start = page * pageSize;
    const sampleRowIdxs = Array.from({
      length: Math.min(SAMPLE, Math.max(0, parsed.rows.length - start)),
    })
      .map((_, k) => start + k)
      .filter((i) => i >= 0 && i < parsed.rows.length);

    const m = new Map<number, number>();
    for (const c of gridColsAll) {
      let maxLen = c.name.length;
      for (const ri of sampleRowIdxs) {
        const v = parsed.rows[ri]?.[c.idx] ?? null;
        if (v === null) continue;
        const s = String(v);
        if (s.length > maxLen) maxLen = s.length;
      }
      const px = clamp(estimateHeaderPx(Math.min(maxLen, 38)), COL_W_MIN, COL_W_MAX);
      m.set(c.idx, px);
    }
    return m;
  }, [parsed, gridColsAll, page, pageSize]);

  const widthOf = (colIdx: number) => colWidth[colIdx] ?? autoWidths.get(colIdx) ?? COL_W_MIN;

  const pinnedLeftOffsets = useMemo(() => {
    const offs: Record<number, number> = {};
    let acc = idxW;
    for (const c of pinnedVisible) {
      offs[c.idx] = acc;
      acc += widthOf(c.idx);
    }
    return offs;
  }, [pinnedVisible, idxW, colWidth, autoWidths]);

  const gridTemplateColumns = useMemo(() => {
    const parts = [idxW, ...gridColsAll.map((c) => widthOf(c.idx))].map((w) => `${w}px`);
    return parts.join(" ");
  }, [idxW, gridColsAll, colWidth, autoWidths]);

  const totalGridW = useMemo(() => {
    return idxW + gridColsAll.reduce((acc, c) => acc + widthOf(c.idx), 0);
  }, [idxW, gridColsAll, colWidth, autoWidths]);

  const filteredRowIndexes = useMemo(() => {
    if (!parsed) return [];
    const query = q.trim().toLowerCase();
    if (!query) return parsed.rows.map((_, i) => i);

    const idxs: number[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      let hit = false;
      for (const c of orderedVisibleCols) {
        const v = r[c.idx];
        if (v === null) continue;
        if (String(v).toLowerCase().includes(query)) {
          hit = true;
          break;
        }
      }
      if (hit) idxs.push(i);
    }
    return idxs;
  }, [parsed, q, orderedVisibleCols]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredRowIndexes.length / pageSize)),
    [filteredRowIndexes.length, pageSize]
  );

  useEffect(() => setPage((p) => Math.min(p, pageCount - 1)), [pageCount]);

  const pageRowIndexes = useMemo(() => {
    const start = page * pageSize;
    return filteredRowIndexes.slice(start, start + pageSize);
  }, [filteredRowIndexes, page, pageSize]);

  const totalRowsOnPage = pageRowIndexes.length;
  const totalH = totalRowsOnPage * ROW_H;

  const effectiveScrollTop = Math.max(0, scrollTop - headerH);
  const effectiveViewportH = Math.max(0, viewportH - headerH);

  const startRow = Math.max(0, Math.floor(effectiveScrollTop / ROW_H) - OVERSCAN);
  const endRow = Math.min(
    totalRowsOnPage,
    Math.ceil((effectiveScrollTop + effectiveViewportH) / ROW_H) + OVERSCAN
  );

  const visibleRowSlice = useMemo(() => {
    return pageRowIndexes.slice(startRow, endRow).map((rowIdx, i) => ({
      rowIdx,
      y: (startRow + i) * ROW_H,
      pageRowNumber: startRow + i,
    }));
  }, [pageRowIndexes, startRow, endRow]);

  // Клавиатурная навигация стрелками и копирование Ctrl+C
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selected || !parsed) return;

      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const isCopy = (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");
      if (isCopy) {
        e.preventDefault();
        const v = parsed.rows[selected.rowIdx]?.[selected.colIdx] ?? null;
        const text = v === null ? "" : String(v);
        copyToClipboard(text).then((ok) => {
          setCopiedToast(ok ? "Значение скопировано" : "Ошибка копирования");
          window.setTimeout(() => setCopiedToast(null), 1400);
        });
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const curPageRowPos = pageRowIndexes.indexOf(selected.rowIdx);
        const curColPos = gridColsAll.findIndex((c) => c.idx === selected.colIdx);
        if (curPageRowPos === -1 || curColPos === -1) return;

        let nextRowPos = curPageRowPos;
        let nextColPos = curColPos;

        if (e.key === "ArrowUp") nextRowPos = Math.max(0, curPageRowPos - 1);
        if (e.key === "ArrowDown") nextRowPos = Math.min(pageRowIndexes.length - 1, curPageRowPos + 1);
        if (e.key === "ArrowLeft") nextColPos = Math.max(0, curColPos - 1);
        if (e.key === "ArrowRight") nextColPos = Math.min(gridColsAll.length - 1, curColPos + 1);

        setSelected({
          rowIdx: pageRowIndexes[nextRowPos],
          colIdx: gridColsAll[nextColPos].idx,
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, parsed, pageRowIndexes, gridColsAll]);

  const anyFilter = q.trim().length > 0;

  const columnPickerList = useMemo(() => {
    if (!parsed) return [];
    const cq = colPickerQ.trim().toLowerCase();
    if (!cq) return parsed.columns;
    return parsed.columns.filter((c) => c.toLowerCase().includes(cq));
  }, [parsed, colPickerQ]);

  const togglePin = (colIdx: number) => {
    setPinnedCols((prev) => {
      if (prev.includes(colIdx)) return prev.filter((x) => x !== colIdx);
      return [...prev, colIdx];
    });
  };

  const reorder = (fromColIdx: number, toColIdx: number) => {
    if (fromColIdx === toColIdx) return;
    setColOrder((prev) => {
      const next = [...prev];
      const a = next.indexOf(fromColIdx);
      const b = next.indexOf(toColIdx);
      if (a === -1 || b === -1) return prev;
      next.splice(a, 1);
      next.splice(b, 0, fromColIdx);
      return next;
    });
  };

  const copyCell = async () => {
    if (!selected || !parsed) return;
    const v = parsed.rows[selected.rowIdx]?.[selected.colIdx] ?? null;
    const text = v === null ? "" : String(v);
    const ok = await copyToClipboard(text);
    setCopiedToast(ok ? "Значение скопировано" : "Ошибка копирования");
    window.setTimeout(() => setCopiedToast(null), 1400);
  };

  const copyRowTSV = async () => {
    if (!selected || !parsed) return;
    const r = parsed.rows[selected.rowIdx];
    const cols = orderedVisibleCols;
    const line = cols
      .map((c) => {
        const v = r?.[c.idx] ?? null;
        return v === null ? "" : String(v);
      })
      .join("\t");
    const ok = await copyToClipboard(line);
    setCopiedToast(ok ? "Строка скопирована" : "Ошибка копирования");
    window.setTimeout(() => setCopiedToast(null), 1400);
  };

  const copyVisiblePageTSV = async () => {
    if (!parsed) return;
    const cols = orderedVisibleCols;
    const header = cols.map((c) => c.name).join("\t");
    const lines = pageRowIndexes.map((rowIdx) => {
      const r = parsed.rows[rowIdx];
      return cols
        .map((c) => {
          const v = r?.[c.idx] ?? null;
          return v === null ? "" : String(v);
        })
        .join("\t");
    });

    const ok = await copyToClipboard([header, ...lines].join("\n"));
    setCopiedToast(ok ? "Страница скопирована" : "Ошибка копирования");
    window.setTimeout(() => setCopiedToast(null), 1400);
  };

  const openColStats = (colIdx: number) => {
    if (!parsed) return;
    const colName = parsed.columns[colIdx] ?? "";
    setActiveCol({ name: colName, idx: colIdx });
    setColSheetOpen(true);
  };

  const activeColStats = useMemo(() => {
    if (!parsed || !activeCol) return null;
    return columnStats(parsed.rows, activeCol.idx);
  }, [parsed, activeCol]);

  const activeColValues = useMemo(() => {
    if (!parsed || !activeCol) return [];
    const vals: (string | number)[] = [];
    for (const r of parsed.rows) {
      const v = r[activeCol.idx];
      if (v !== null) vals.push(v as any);
    }
    return vals;
  }, [parsed, activeCol]);

  /* ---------- groups ---------- */

  const groups: ColGroup[] = useMemo(() => {
    if (!parsed) return [];
    const m = new Map<string, ColGroup>();

    for (let i = 0; i < parsed.columns.length; i++) {
      const colName = parsed.columns[i];
      const g = groupForColumn(colName);
      const ex = m.get(g.key);
      if (ex) ex.idxs.push(i);
      else m.set(g.key, { key: g.key, title: g.title, order: g.order, idxs: [i] });
    }

    const other =
      m.get("other") ??
      ({ key: "other", title: "Прочее", order: 999, idxs: [] as number[] } as ColGroup);

    for (const [k, g] of Array.from(m.entries())) {
      if (k.startsWith("misc_") && g.idxs.length <= 1) {
        other.idxs.push(...g.idxs);
        m.delete(k);
      }
    }
    if (other.idxs.length) m.set("other", other);

    return Array.from(m.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (b.idxs.length !== a.idxs.length) return b.idxs.length - a.idxs.length;
      return a.title.localeCompare(b.title);
    });
  }, [parsed]);

  const activeGroupKeySet = useMemo(() => new Set(activeGroupKeys), [activeGroupKeys]);

  const applyGroupFilter = (nextKeys: string[]) => {
    if (!parsed) return;

    setActiveGroupKeys(nextKeys);

    if (nextKeys.length === 0) {
      const next: Record<string, boolean> = {};
      for (const c of parsed.columns) next[c] = true;
      setVisibleCols(next);
      return;
    }

    const keySet = new Set(nextKeys);
    const allowed = new Set<number>();
    for (const g of groups) {
      if (!keySet.has(g.key)) continue;
      for (const idx of g.idxs) allowed.add(idx);
    }

    const next: Record<string, boolean> = {};
    for (let i = 0; i < parsed.columns.length; i++) {
      next[parsed.columns[i]] = allowed.has(i);
    }
    setVisibleCols(next);
  };

  const toggleGroup = (g: ColGroup) => {
    if (!parsed) return;
    const set = new Set(activeGroupKeys);
    if (set.has(g.key)) set.delete(g.key);
    else set.add(g.key);
    applyGroupFilter(Array.from(set));
  };

  const pickOverCol = (clientX: number) => {
    let best: { colIdx: number; dist: number } | null = null;
    for (const c of gridColsAll) {
      const el = headerCellRef.current[c.idx];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const center = r.left + r.width / 2;
      const dist = Math.abs(center - clientX);
      if (!best || dist < best.dist) best = { colIdx: c.idx, dist };
    }
    return best?.colIdx ?? null;
  };

  const endDrag = () => {
    const d = dragRef.current;
    const to = dragOverRef.current;
    if (d && to !== null) reorder(d.colIdx, to);

    setDrag(null);
    setDragOverCol(null);
    dragRef.current = null;
    dragOverRef.current = null;

    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  useEffect(() => {
    if (!drag) return;

    let raf = 0;

    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (e.pointerId !== dragRef.current.pointerId) return;

      dragRef.current = { ...dragRef.current, curClientX: e.clientX };
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          const cur = dragRef.current;
          if (!cur) return;

          setDrag({ ...cur });

          const over = pickOverCol(cur.curClientX);
          if (over !== dragOverRef.current) {
            dragOverRef.current = over;
            setDragOverCol(over);
          }
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (e.pointerId !== dragRef.current.pointerId) return;
      endDrag();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [drag, gridColsAll]);

  const dragAnim = useMemo(() => {
    if (colSheetOpen) return null;
    if (!dragRef.current) return null;
    if (!dragOverCol) return null;

    const from = visualIndex.get(dragRef.current.colIdx);
    const to = visualIndex.get(dragOverCol);
    if (from === undefined || to === undefined) return null;
    if (from === to) return null;

    const draggedW = widthOf(dragRef.current.colIdx);
    return { from, to, draggedW, draggedCol: dragRef.current.colIdx };
  }, [colSheetOpen, dragOverCol, visualIndex, colWidth, autoWidths]);

  const shiftForCol = (colIdx: number) => {
    if (!dragAnim) return undefined;
    const { from, to, draggedW, draggedCol } = dragAnim;
    if (colIdx === draggedCol) return undefined;

    const i = visualIndex.get(colIdx);
    if (i === undefined) return undefined;

    if (from < to) {
      if (i > from && i <= to) return `translateX(${-draggedW}px)`;
    } else {
      if (i >= to && i < from) return `translateX(${draggedW}px)`;
    }
    return undefined;
  };

  /* ---------- данные выбранной ячейки для статус-бара ---------- */
  const selectedDetails = useMemo(() => {
    if (!selected || !parsed) return null;
    const colName = parsed.columns[selected.colIdx] ?? "";
    const val = parsed.rows[selected.rowIdx]?.[selected.colIdx];
    const text = val === null || val === undefined ? "—" : String(val);
    return {
      rowNumber: selected.rowIdx + 1,
      colIdx: selected.colIdx,
      colName,
      text,
    };
  }, [selected, parsed]);

  /* ---------- top widgets ---------- */

  const TopPager = (
    <div className="ml-auto flex items-center gap-1.5">
      <Button
        size="icon-sm"
        variant="outline"
        className="h-8 w-8 bg-white"
        disabled={page <= 0}
        onClick={() => {
          setPage((p) => Math.max(0, p - 1));
          setSelected(null);
          scrollToTopOfGrid();
        }}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs font-medium tabular-nums min-w-[74px] text-center">
        Стр. {page + 1} / {pageCount}
      </span>
      <Button
        size="icon-sm"
        variant="outline"
        className="h-8 w-8 bg-white"
        disabled={page + 1 >= pageCount}
        onClick={() => {
          setPage((p) => Math.min(pageCount - 1, p + 1));
          setSelected(null);
          scrollToTopOfGrid();
        }}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  const RowsPerPage = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Строк:</span>
      <div className="inline-flex rounded-lg border border-slate-200/80 p-0.5 bg-slate-100/80">
        {[100, 200, 500].map((n) => (
          <button
            key={n}
            type="button"
            className={[
              "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all tabular-nums",
              pageSize === n
                ? "bg-white text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            onClick={() => {
              setPageSize(n);
              setPage(0);
              setSelected(null);
              scrollToTopOfGrid();
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  const Z_HEADER = 30;
  const Z_HEADER_INDEX = 35;
  const Z_HEADER_PINNED_BASE = 40;
  const Z_HEADER_UNPINNED = 31;

  const Z_BODY_ROW = 1;
  const Z_BODY_INDEX = 15;
  const Z_BODY_PINNED_BASE = 20;
  const Z_BODY_UNPINNED = 2;

  const overlayStyle = useMemo(() => {
    if (!dragRef.current) return null;
    const d = dragRef.current;
    const dx = d.curClientX - d.startClientX;
    return {
      left: d.startLeft + dx,
      top: d.startTop,
      width: d.width,
      height: d.height,
    };
  }, [drag]);

  return (
    <div className="w-full space-y-3.5">
      {/* Нативный CSS-ховер строк без ререндеров React */}
      <style jsx global>{`
        .ft-row {
          --cell-bg: #ffffff;
          --sticky-bg: #f8fafc;
          --pinned-bg: #f1f5f9;
        }
        .ft-row-even {
          --cell-bg: #f8fafc;
          --sticky-bg: #f1f5f9;
          --pinned-bg: #eef2f6;
        }
        .ft-row:hover {
          --cell-bg: #f0f9ff;
          --sticky-bg: #e0f2fe;
          --pinned-bg: #e0f2fe;
        }
        .ft-row-selected {
          --cell-bg: #f0f9ff;
          --sticky-bg: #bae6fd;
          --pinned-bg: #e0f2fe;
        }
      `}</style>

      {/* Верхняя сводка */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={status === "done" ? "secondary" : "outline"}>{status}</Badge>
          {featuresCache ? (
            <Badge variant="outline" className="bg-white font-mono">
              CSV: {(featuresCache.blob.size / 1024).toFixed(1)} KB
            </Badge>
          ) : null}
          {featuresCacheError ? <Badge variant="destructive">{featuresCacheError}</Badge> : null}
          {parseError ? <Badge variant="destructive">{parseError}</Badge> : null}

          {parsed ? (
            <div className="ml-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>
                Строк: <strong className="font-semibold text-foreground tabular-nums">{parsed.rows.length}</strong>
              </span>
              {anyFilter ? (
                <>
                  <span>•</span>
                  <span>
                    Найдено: <strong className="font-semibold text-sky-600 tabular-nums">{filteredRowIndexes.length}</strong>
                  </span>
                </>
              ) : null}
              <span>•</span>
              <span>
                Столбцов:{" "}
                <strong className="font-semibold text-foreground tabular-nums">
                  {orderedVisibleCols.length} из {parsed.columns.length}
                </strong>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {copiedToast ? (
            <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
              <Check className="h-3 w-3" />
              {copiedToast}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="default"
            className="h-8 gap-1.5 text-xs shadow-2xs"
            disabled={status !== "done"}
            onClick={() => downloadFeatures().catch((e) => alert(e.message))}
          >
            <Download className="h-3.5 w-3.5" />
            Скачать CSV
          </Button>
        </div>
      </div>

      {!parsed ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 py-16 text-center">
          <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <div className="text-sm font-medium text-foreground">
            {status !== "done"
              ? "Таблица признаков появится после завершения анализа"
              : featuresCache
                ? "Разбираем CSV-таблицу…"
                : "Загружаем CSV с сервера…"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Здесь будут доступны все низкоуровневые характеристики openSMILE / MFCC
          </div>
        </div>
      ) : (
        <>
          {/* Панель инструментов */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-2.5 items-center">
              <div className="relative w-full sm:w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(0);
                    setSelected(null);
                    scrollToTopOfGrid();
                  }}
                  placeholder="Поиск числа или названия признака…"
                  className="h-8 pl-8 pr-8 text-xs bg-white"
                />
                {q ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      setPage(0);
                      setSelected(null);
                      scrollToTopOfGrid();
                    }}
                    className="cursor-pointer absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {RowsPerPage}

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 bg-white"
                onClick={copyVisiblePageTSV}
              >
                <Copy className="h-3 w-3" />
                Скопировать страницу
              </Button>

              {TopPager}
            </div>

            {/* Переключатели категорий столбцов */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-2.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    type="button"
                    onClick={() => applyGroupFilter([])}
                    className={[
                      "cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all select-none",
                      activeGroupKeys.length === 0
                        ? "border-slate-900 bg-slate-900 text-white shadow-2xs"
                        : "border-slate-200/80 bg-white text-foreground/80 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    <span>Все столбцы</span>
                    <span className="text-[11px] opacity-75 tabular-nums">({parsed.columns.length})</span>
                  </button>

                  {groups
                    .filter((g) => g.idxs.length >= 2)
                    .map((g) => {
                      const active = activeGroupKeySet.has(g.key);
                      return (
                        <button
                          key={g.key}
                          type="button"
                          className={[
                            "cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all select-none",
                            active
                              ? "border-sky-600 bg-sky-600 text-white shadow-2xs"
                              : "border-slate-200/80 bg-white text-foreground/80 hover:bg-slate-100",
                          ].join(" ")}
                          onClick={() => toggleGroup(g)}
                        >
                          <span>{g.title}</span>
                          <span className={`text-[11px] tabular-nums ${active ? "text-sky-100" : "text-muted-foreground"}`}>
                            ({g.idxs.length})
                          </span>
                        </button>
                      );
                    })}
                </div>

                <div className="flex items-center gap-1.5 ml-auto">
                  {activeGroupKeys.length > 0 || pinnedCols.length > 0 || Object.keys(colWidth).length > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const c of parsed.columns) next[c] = true;
                        setVisibleCols(next);
                        setColPickerQ("");
                        setPinnedCols([]);
                        setColWidth({});
                        setActiveGroupKeys([]);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Сброс
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant={showColPicker ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs gap-1.5 bg-white data-[variant=default]:bg-primary"
                    onClick={() => setShowColPicker((v) => !v)}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    Настроить ({orderedVisibleCols.length})
                  </Button>
                </div>
              </div>

              {showColPicker ? (
                <div className="border-t border-slate-200/70 pt-2.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative w-full sm:w-[280px]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={colPickerQ}
                        onChange={(e) => setColPickerQ(e.target.value)}
                        placeholder="Фильтр по названию столбца…"
                        className="h-8 pl-8 text-xs bg-white"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs bg-white" onClick={() => applyGroupFilter([])}>
                        Показать все
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs bg-white"
                        onClick={() => {
                          const next: Record<string, boolean> = {};
                          for (const c of parsed.columns) next[c] = false;
                          setVisibleCols(next);
                          setActiveGroupKeys([]);
                        }}
                      >
                        Скрыть все
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-44 overflow-auto rounded-lg border border-slate-200/70 bg-white p-2">
                    <div className="grid gap-x-3 gap-y-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {columnPickerList.map((name) => (
                        <label
                          key={name}
                          className="cursor-pointer flex items-center gap-2 text-xs rounded-md px-2 py-1.5 hover:bg-slate-50"
                        >
                          <Checkbox
                            checked={visibleCols[name] !== false}
                            onCheckedChange={(v) =>
                              setVisibleCols((prev) => ({ ...prev, [name]: Boolean(v) }))
                            }
                          />
                          <span className="truncate font-mono text-[11px]" title={name}>
                            {highlightText(name, colPickerQ)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Панель выбранной ячейки (Formula / Inspector Bar) */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 shadow-2xs min-h-[42px]">
              {selectedDetails ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                    <span className="inline-flex items-center rounded-md bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-800">
                      Строка #{selectedDetails.rowNumber}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-700 truncate">
                      {selectedDetails.colName}
                    </span>
                    <span className="text-muted-foreground">=</span>
                    <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-900 select-all">
                      {selectedDetails.text}
                    </code>
                  </div>

                  <div className="flex items-center gap-1.5 ml-auto">
                    <Button size="xs" variant="outline" className="gap-1 bg-white" onClick={copyCell}>
                      <Copy className="h-3 w-3" />
                      Копировать ячейку
                    </Button>
                    <Button size="xs" variant="outline" className="gap-1 bg-white" onClick={copyRowTSV}>
                      <Copy className="h-3 w-3" />
                      Всю строку
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      className="gap-1"
                      onClick={() => openColStats(selectedDetails.colIdx)}
                    >
                      <BarChart2 className="h-3 w-3" />
                      Статистика столбца
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
                  <span>
                    Нажмите на любую ячейку для просмотра точного значения и навигации стрелками клавиатуры (↑ ↓ ← →)
                  </span>
                  <span className="hidden sm:inline text-[11px]">
                    Иконка 📊 в шапке столбца открывает статистику (Min / Max / Avg)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ТАБЛИЦА (GRID) */}
          <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
            <div
              ref={viewportRef}
              className="relative overflow-auto"
              style={{ maxHeight: "66vh" }}
              onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            >
              {/* Шапка таблицы */}
              <div
                ref={headerRef}
                className="sticky top-0 border-b border-slate-200"
                style={{
                  zIndex: Z_HEADER,
                  display: "grid",
                  gridTemplateColumns,
                  minWidth: totalGridW,
                  backgroundColor: "#f8fafc",
                }}
              >
                {/* Индексный столбец # */}
                <div
                  className="px-3 py-2.5 text-xs font-semibold text-muted-foreground border-r border-slate-200 flex items-center"
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: Z_HEADER_INDEX,
                    width: idxW,
                    backgroundColor: "#f8fafc",
                  }}
                >
                  #
                </div>

                {gridColsAll.map((c) => {
                  const isPinned = pinnedSet.has(c.idx);
                  const isColSelected = selected?.colIdx === c.idx;
                  const w = widthOf(c.idx);

                  const pIdx = pinnedIndexByCol.get(c.idx) ?? -1;
                  const z = isPinned ? Z_HEADER_PINNED_BASE + pIdx : Z_HEADER_UNPINNED;

                  const isDraggingThis = dragRef.current?.colIdx === c.idx;
                  const shift = shiftForCol(c.idx);

                  return (
                    <div
                      key={c.idx}
                      ref={(el) => {
                        headerCellRef.current[c.idx] = el;
                      }}
                      className="group relative border-r border-slate-200/90 select-none"
                      style={{
                        width: w,
                        position: isPinned ? "sticky" : "relative",
                        left: isPinned ? pinnedLeftOffsets[c.idx] : undefined,
                        zIndex: z,
                        backgroundColor: isColSelected
                          ? "#e0f2fe"
                          : isPinned
                            ? "#f1f5f9"
                            : "#f8fafc",
                        transform: shift,
                        transition:
                          "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 150ms ease",
                        opacity: isDraggingThis ? 0.2 : 1,
                      }}
                    >
                      <div className="flex items-center gap-1 px-2 py-2 text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {/* Ручка перетаскивания */}
                        <span
                          onPointerDown={(e) => {
                            if (colSheetOpen) return;
                            const el = headerCellRef.current[c.idx];
                            if (!el) return;

                            const rect = el.getBoundingClientRect();
                            const st: DragState = {
                              colIdx: c.idx,
                              startClientX: e.clientX,
                              curClientX: e.clientX,
                              pointerId: e.pointerId,
                              startLeft: rect.left,
                              startTop: rect.top,
                              width: rect.width,
                              height: rect.height,
                            };

                            dragRef.current = st;
                            setDrag(st);
                            setDragOverCol(c.idx);
                            dragOverRef.current = c.idx;

                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

                            document.body.style.userSelect = "none";
                            document.body.style.cursor = "grabbing";
                          }}
                          className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded hover:bg-slate-200/80 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700"
                          title="Перетащите для смены порядка столбцов"
                          style={{ touchAction: "none" }}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>

                        {/* Название столбца */}
                        <span
                          className="flex-1 truncate font-mono text-[11px] cursor-pointer hover:text-sky-700"
                          onClick={() => openColStats(c.idx)}
                          title={`${c.name} — нажмите для просмотра статистики столбца`}
                        >
                          {q.trim() ? highlightText(c.name, q) : c.name}
                        </span>

                        {/* Кнопка статистики столбца */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openColStats(c.idx);
                          }}
                          className="cursor-pointer inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200/80 hover:text-sky-700 transition-opacity"
                          title="Статистика столбца (Min / Max / Avg)"
                        >
                          <BarChart2 className="h-3 w-3" />
                        </button>

                        {/* Кнопка закрепления */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePin(c.idx);
                          }}
                          className={[
                            "cursor-pointer inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-slate-200/80 transition-opacity",
                            isPinned
                              ? "text-sky-600 bg-sky-500/15 opacity-100"
                              : "text-slate-400 opacity-0 group-hover:opacity-100",
                          ].join(" ")}
                          title={isPinned ? "Открепить столбец" : "Закрепить столбец слева"}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Ползунок ресайза ширины */}
                      <div
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 hover:bg-sky-500 transition-opacity"
                        title="Потяните для изменения ширины столбца"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          resizeRef.current = { colIdx: c.idx, startX: e.clientX, startW: w };
                          document.body.style.cursor = "col-resize";
                          document.body.style.userSelect = "none";
                        }}
                      />
                    </div>
                  );
                })}

                {/* Карточка при перетаскивании столбца */}
                {overlayStyle && dragRef.current ? (
                  <div
                    className="pointer-events-none fixed"
                    style={{
                      left: overlayStyle.left,
                      top: overlayStyle.top,
                      width: overlayStyle.width,
                      height: overlayStyle.height,
                      zIndex: 5000,
                    }}
                  >
                    <div className="h-full w-full rounded-lg border-2 border-sky-500 bg-white shadow-xl flex items-center gap-2 px-3 text-xs font-semibold">
                      <GripVertical className="h-3.5 w-3.5 text-sky-600" />
                      <span className="truncate font-mono">
                        {gridColsAll.find((x) => x.idx === dragRef.current!.colIdx)?.name ?? ""}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Тело таблицы */}
              <div
                className="relative"
                style={{
                  height: totalH,
                  minWidth: totalGridW,
                  zIndex: Z_BODY_ROW,
                }}
              >
                {visibleRowSlice.map(({ rowIdx, y, pageRowNumber }) => {
                  const row = parsed!.rows[rowIdx];
                  const isEven = pageRowNumber % 2 === 1;
                  const isRowSelected = selected?.rowIdx === rowIdx;

                  return (
                    <div
                      key={rowIdx}
                      className={[
                        "ft-row absolute left-0 right-0 border-b border-slate-100",
                        isEven ? "ft-row-even" : "",
                        isRowSelected ? "ft-row-selected" : "",
                      ].join(" ")}
                      style={{
                        top: y,
                        height: ROW_H,
                        display: "grid",
                        gridTemplateColumns,
                      }}
                    >
                      {/* Ячейка номера строки */}
                      <div
                        className={[
                          "px-3 text-xs font-mono tabular-nums border-r border-slate-200 flex items-center select-none",
                          isRowSelected ? "font-bold text-sky-900" : "text-muted-foreground",
                        ].join(" ")}
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: Z_BODY_INDEX,
                          width: idxW,
                          backgroundColor: "var(--sticky-bg)",
                        }}
                      >
                        {page * pageSize + pageRowNumber + 1}
                      </div>

                      {gridColsAll.map((c) => {
                        const isPinned = pinnedSet.has(c.idx);
                        const w = widthOf(c.idx);

                        const raw = row?.[c.idx] ?? null;
                        const text = raw === null ? "" : String(raw);

                        const isSelected =
                          isRowSelected && selected?.colIdx === c.idx;

                        const pIdx = pinnedIndexByCol.get(c.idx) ?? -1;
                        const z = isPinned ? Z_BODY_PINNED_BASE + pIdx : Z_BODY_UNPINNED;

                        return (
                          <div
                            key={c.idx}
                            className={[
                              "px-3 text-xs font-mono tabular-nums whitespace-nowrap cursor-pointer overflow-hidden text-ellipsis border-r border-slate-100 flex items-center",
                              isSelected ? "font-semibold text-sky-950" : "text-slate-700",
                            ].join(" ")}
                            style={{
                              width: w,
                              position: isPinned ? "sticky" : "relative",
                              left: isPinned ? pinnedLeftOffsets[c.idx] : undefined,
                              zIndex: isSelected ? z + 5 : z,
                              backgroundColor: isSelected
                                ? "#bae6fd"
                                : isPinned
                                  ? "var(--pinned-bg)"
                                  : "var(--cell-bg)",
                              boxShadow: isSelected
                                ? "inset 0 0 0 2px #0284c7"
                                : undefined,
                            }}
                            onClick={() => setSelected({ rowIdx, colIdx: c.idx })}
                            onDoubleClick={() => {
                              setSelected({ rowIdx, colIdx: c.idx });
                              openColStats(c.idx);
                            }}
                          >
                            {raw === null ? (
                              <span className="text-slate-300">—</span>
                            ) : q.trim() ? (
                              highlightText(text, q)
                            ) : (
                              text
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Нижняя панель */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2 tabular-nums">
              <span>
                Показаны строки:{" "}
                <strong className="font-semibold text-foreground">
                  {filteredRowIndexes.length === 0 ? 0 : page * pageSize + 1}–
                  {Math.min((page + 1) * pageSize, filteredRowIndexes.length)}
                </strong>{" "}
                из <strong className="font-semibold text-foreground">{filteredRowIndexes.length}</strong>
              </span>
            </div>

            {TopPager}
          </div>
        </>
      )}

      {/* Боковая панель со статистикой столбца */}
      <Sheet open={colSheetOpen} onOpenChange={setColSheetOpen}>
        <SheetContent data-ft-sheet="1" side="right" className="w-[400px] sm:w-[460px] z-[4000] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm break-all pr-6">
              {activeCol?.name ?? "Статистика признака"}
            </SheetTitle>
          </SheetHeader>

          {!parsed || !activeCol ? (
            <div className="mt-4 text-xs text-muted-foreground">Столбец не выбран</div>
          ) : (
            <div className="mt-5 space-y-4">
              {selectedDetails && selectedDetails.colIdx === activeCol.idx ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Выбранная ячейка (строка #{selectedDetails.rowNumber})
                    </span>
                    <Button size="xs" variant="outline" className="bg-white gap-1" onClick={copyCell}>
                      <Copy className="h-3 w-3" />
                      Копировать
                    </Button>
                  </div>

                  <div className="rounded-lg border bg-white p-2.5 font-mono text-sm font-semibold break-all">
                    {selectedDetails.text}
                  </div>
                </div>
              ) : null}

              {activeColStats ? (
                <div className="rounded-xl border border-slate-200/80 p-3.5 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Сводная статистика столбца
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                      <div className="text-[11px] text-muted-foreground">Среднее (Avg)</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                        {fmtStatNum(activeColStats.avg)}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                      <div className="text-[11px] text-muted-foreground">Медиана</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                        {fmtStatNum(activeColStats.median)}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                      <div className="text-[11px] text-muted-foreground">Минимум</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                        {fmtStatNum(activeColStats.min)}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                      <div className="text-[11px] text-muted-foreground">Максимум</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                        {fmtStatNum(activeColStats.max)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                    <span>
                      Числовых значений: <strong className="text-foreground">{activeColStats.count}</strong>
                    </span>
                    <span>
                      Пустых / NaN: <strong className="text-foreground">{activeColStats.empty}</strong>
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200/80 p-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Первые значения ({Math.min(300, activeColValues.length)})
                </div>

                <div className="mt-2 max-h-[42vh] overflow-auto rounded-lg border bg-slate-50/50 p-2 space-y-1">
                  {activeColValues.slice(0, 300).map((v, i) => (
                    <div
                      key={i}
                      className="text-xs font-mono px-2 py-1 rounded hover:bg-white break-all flex justify-between"
                    >
                      <span className="text-muted-foreground select-none">#{i + 1}</span>
                      <span className="font-medium">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}