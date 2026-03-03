"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useTaskStore } from "@/store/taskStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
        className="rounded px-0.5 py-[1px] bg-yellow-200/70 text-foreground"
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

const ROW_H = 36;
const OVERSCAN = 10;

const IDX_W_MIN = 64;
const IDX_W_MAX = 96;

const COL_W_MIN = 120;
const COL_W_MAX = 480;

function estimatePxForText(len: number) {
  return Math.round(len * 7.2 + 28);
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/* ---------------- theme (opaque) ---------------- */

type OpaqueTheme = {
  bg: string;
  muted: string;
  border: string;
};

function toOpaqueCssColor(rawVarValue: string, fallback: string): string {
  let v = (rawVarValue || "").trim();
  if (!v) return fallback;

  if (v.includes("/")) v = v.split("/")[0].trim();

  if (/^rgba\(/i.test(v)) {
    const m = v.match(
      /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*$/i
    );
    if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
    return v;
  }
  if (/^hsla\(/i.test(v)) {
    const m = v.match(
      /^hsla\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)\s*$/i
    );
    if (m) return `hsl(${m[1]}, ${m[2]}, ${m[3]})`;
    return v;
  }
  if (/^(rgb|hsl|oklch|lab|lch|color)\(/i.test(v) || v.startsWith("#")) {
    return v;
  }

  return `hsl(${v})`;
}

function readOpaqueTheme(): OpaqueTheme {
  const root = document.documentElement;
  const cs = getComputedStyle(root);

  const bgRaw = cs.getPropertyValue("--background");
  const mutedRaw = cs.getPropertyValue("--muted");
  const borderRaw = cs.getPropertyValue("--border");

  const bg = toOpaqueCssColor(bgRaw, "hsl(var(--background))");
  const muted = toOpaqueCssColor(mutedRaw, "hsl(var(--muted))");
  const border = toOpaqueCssColor(borderRaw, "hsl(var(--border))");

  return { bg, muted, border };
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

/* ---------- non-layout separators ---------- */

function rightDivider(border: string) {
  return `inset -1px 0 0 ${border}`;
}
function bottomDivider(border: string) {
  return `inset 0 -1px 0 ${border}`;
}

/* ---------- column groups (semantic, openSMILE-like) ---------- */

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
    title: "Formants",
    order: 20,
    test: (n) =>
      /^f[1-9]\d*(frequency|bandwidth|amplitudelogrelf0|amplitude|amplituderel|amplitudelog)/.test(
        n
      ) || n.includes("formant"),
  },
  {
    key: "pitch_f0",
    title: "Pitch / F0",
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
    title: "Voice quality",
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
    title: "Spectral",
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
    title: "Loudness / Intensity",
    order: 60,
    test: (n) => n.includes("loudness") || n.includes("intensity"),
  },
  {
    key: "energy",
    title: "Energy / ZCR",
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
    title: "Voicing",
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
    return { key: `misc_${prefix}`, title: `Misc: ${prefix}`, order: 900 };
  }
  return { key: "other", title: "Other", order: 999 };
}

/* ---------- active cell ---------- */

type ActiveCell = {
  rowIdx: number;
  colIdx: number;
  text: string;
};

/* ---------- smooth pointer drag ---------- */

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

  const [theme, setTheme] = useState<OpaqueTheme>({
    bg: "hsl(var(--background))",
    muted: "hsl(var(--muted))",
    border: "hsl(var(--border))",
  });

  useEffect(() => {
    const apply = () => setTheme(readOpaqueTheme());
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  }, []);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(200);
  const [page, setPage] = useState(0);

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [activeCol, setActiveCol] = useState<ColRef | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [colSheetOpen, setColSheetOpen] = useState(false);

  const [colOrder, setColOrder] = useState<number[]>([]);
  const [pinnedCols, setPinnedCols] = useState<number[]>([]);
  const [colWidth, setColWidth] = useState<Record<number, number>>({});

  const [selected, setSelected] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  const [colPickerQ, setColPickerQ] = useState("");

  const resizeRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const headerGridRef = useRef<HTMLDivElement | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [headerH, setHeaderH] = useState(40);

  const [hoverGroupKey, setHoverGroupKey] = useState<string | null>(null);

  const [activeGroupKeys, setActiveGroupKeys] = useState<string[]>([]);

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
        setParseError(res.errors[0]?.message || "CSV parse error");
        return;
      }

      const data = res.data as unknown as string[][];
      if (!data?.length) {
        setParseError("CSV is empty");
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
      setActiveCell(null);

      setPage(0);
      setColPickerQ("");
      setHoverGroupKey(null);
      setActiveGroupKeys([]);
      setDrag(null);
      setDragOverCol(null);
      dragRef.current = null;
      dragOverRef.current = null;

      scrollToTopOfGrid();
    }

    run().catch((e) => setParseError(e?.message ?? "Parse failed"));

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

    const ro = new ResizeObserver(() => setHeaderH(el.clientHeight || 40));
    ro.observe(el);
    setHeaderH(el.clientHeight || 40);
    return () => ro.disconnect();
  }, [parsed]);

  useEffect(() => {
    const root = document.documentElement;

    if (colSheetOpen) {
      root.setAttribute("data-ft-sheet-open", "1");
      setHoverGroupKey(null);
      setDrag(null);
      setDragOverCol(null);
      dragRef.current = null;
      dragOverRef.current = null;

      requestAnimationFrame(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el && typeof el.blur === "function") el.blur();
      });
    } else {
      root.removeAttribute("data-ft-sheet-open");
    }

    return () => {
      root.removeAttribute("data-ft-sheet-open");
    };
  }, [colSheetOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCopy = (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C");
      if (!isCopy) return;
      if (!selected || !parsed) return;

      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      e.preventDefault();
      const v = parsed.rows[selected.rowIdx]?.[selected.colIdx] ?? null;
      const text = v === null ? "" : String(v);

      copyToClipboard(text).then((ok) => {
        setCopiedToast(ok ? "Copied cell" : "Copy failed");
        window.setTimeout(() => setCopiedToast(null), 1200);
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, parsed]);

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
    return clamp(estimatePxForText(len), IDX_W_MIN, IDX_W_MAX);
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
      const px = clamp(estimatePxForText(Math.min(maxLen, 48)), COL_W_MIN, COL_W_MAX);
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

  const pinnedTotalW = useMemo(() => {
    return pinnedVisible.reduce((acc, c) => acc + widthOf(c.idx), 0);
  }, [pinnedVisible, colWidth, autoWidths]);

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
    setCopiedToast(ok ? "Copied cell" : "Copy failed");
    window.setTimeout(() => setCopiedToast(null), 1200);
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
    setCopiedToast(ok ? "Copied row (TSV)" : "Copy failed");
    window.setTimeout(() => setCopiedToast(null), 1200);
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
    setCopiedToast(ok ? "Copied page (TSV)" : "Copy failed");
    window.setTimeout(() => setCopiedToast(null), 1200);
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
      ({ key: "other", title: "Other", order: 999, idxs: [] as number[] } as ColGroup);

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

  const groupByColIdx = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of groups) for (const idx of g.idxs) m.set(idx, g.key);
    return m;
  }, [groups]);

  const activeGroupKeySet = useMemo(() => new Set(activeGroupKeys), [activeGroupKeys]);

  const hoverEnabled = !colSheetOpen;

  const isColInHoverGroup = (colIdx: number) => {
    if (!hoverEnabled) return false;
    if (!hoverGroupKey) return false;
    return groupByColIdx.get(colIdx) === hoverGroupKey;
  };

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

  /* ---------- top widgets ---------- */

  const TopPager = (
    <div className="ml-auto flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 0}
        onClick={() => {
          setPage((p) => Math.max(0, p - 1));
          setSelected(null);
          scrollToTopOfGrid();
        }}
      >
        ←
      </Button>
      <span className="text-sm tabular-nums min-w-[84px] text-center">
        {page + 1} / {pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page + 1 >= pageCount}
        onClick={() => {
          setPage((p) => Math.min(pageCount - 1, p + 1));
          setSelected(null);
          scrollToTopOfGrid();
        }}
      >
        →
      </Button>
    </div>
  );

  const RowsPerPage = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Rows/page:</span>
      <div className="inline-flex rounded-lg border p-1 bg-muted/30">
        {[100, 200, 500].map((n) => (
          <Button
            key={n}
            size="sm"
            variant={pageSize === n ? "default" : "ghost"}
            className="h-8 px-3"
            onClick={() => {
              setPageSize(n);
              setPage(0);
              setSelected(null);
              scrollToTopOfGrid();
            }}
          >
            {n}
          </Button>
        ))}
      </div>
    </div>
  );

  const headerRight = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {copiedToast ? <Badge variant="secondary">{copiedToast}</Badge> : null}
      <Button
        variant="secondary"
        disabled={status !== "done"}
        onClick={() => downloadFeatures().catch((e) => alert(e.message))}
      >
        Скачать CSV
      </Button>
    </div>
  );

  const Z_HEADER = 3000;
  const Z_HEADER_INDEX = 3100;
  const Z_HEADER_PINNED_BASE = 3200;
  const Z_HEADER_UNPINNED = 3050;

  const Z_BODY_ROW = 0;
  const Z_BODY_INDEX = 1200;
  const Z_BODY_PINNED_BASE = 1300;
  const Z_BODY_UNPINNED = 10;

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
    <Card className="w-full">
      <style jsx global>{`
        html[data-ft-sheet-open="1"] *:focus-visible {
          outline: none !important;
          box-shadow: none !important;
        }
        html[data-ft-sheet-open="1"] [data-ft-sheet="1"] *:focus-visible {
          outline: revert !important;
          box-shadow: revert !important;
        }
      `}</style>

      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle>Features (CSV)</CardTitle>

          <div className="mt-2 flex gap-2 flex-wrap items-center">
            <Badge variant={status === "done" ? "secondary" : "outline"}>{status}</Badge>
            {featuresCache ? (
              <Badge variant="outline">cached: {(featuresCache.blob.size / 1024).toFixed(1)} KB</Badge>
            ) : null}
            {featuresCacheError ? <Badge variant="destructive">{featuresCacheError}</Badge> : null}
            {parseError ? <Badge variant="destructive">{parseError}</Badge> : null}
          </div>

          {parsed ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Rows: <span className="text-foreground">{parsed.rows.length}</span>
              {anyFilter ? (
                <>
                  {" "}
                  • Matches: <span className="text-foreground">{filteredRowIndexes.length}</span>
                </>
              ) : null}{" "}
              • Visible columns:{" "}
              <span className="text-foreground">{orderedVisibleCols.length}</span>/
              <span className="text-foreground">{parsed.columns.length}</span> • Pinned:{" "}
              <span className="text-foreground">{pinnedVisible.length}</span>
            </div>
          ) : null}
        </div>

        {headerRight}
      </CardHeader>

      <CardContent className="space-y-4">
        {!parsed ? (
          <div className="text-sm text-muted-foreground">
            {status !== "done"
              ? "Дождитесь завершения задачи."
              : featuresCache
                ? "Парсю CSV…"
                : "Загружаю CSV…"}
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(0);
                      setSelected(null);
                      scrollToTopOfGrid();
                    }}
                    placeholder="Search in visible columns…"
                    className="sm:w-[360px]"
                  />
                  {q ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQ("");
                        setPage(0);
                        setSelected(null);
                        scrollToTopOfGrid();
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>

                {RowsPerPage}

                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={!selected} onClick={copyCell}>
                    Copy cell
                  </Button>
                  <Button size="sm" variant="outline" disabled={!selected} onClick={copyRowTSV}>
                    Copy row
                  </Button>
                  <Button size="sm" variant="ghost" onClick={copyVisiblePageTSV}>
                    Copy page TSV
                  </Button>
                </div>

                {TopPager}
              </div>

              {/* Column visibility + GROUPS */}
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="text-sm font-medium">Columns</div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-full sm:w-[320px]">
                      <Input
                        value={colPickerQ}
                        onChange={(e) => setColPickerQ(e.target.value)}
                        placeholder="Filter columns…"
                        className="h-9"
                      />
                    </div>

                    <Button size="sm" variant="outline" onClick={() => applyGroupFilter([])}>
                      All
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const c of parsed.columns) next[c] = false;
                        setVisibleCols(next);
                        setActiveGroupKeys([]);
                      }}
                    >
                      None
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const c of parsed.columns) next[c] = true;
                        setVisibleCols(next);
                        setColPickerQ("");
                        setPinnedCols([]);
                        setColWidth({});
                        setHoverGroupKey(null);
                        setActiveGroupKeys([]);
                      }}
                    >
                      Reset
                    </Button>
                  </div>
                </div>

                {/* Groups row: multi-select */}
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground">Groups:</span>

                  {groups
                    .filter((g) => g.idxs.length >= 2)
                    .map((g) => {
                      const active = activeGroupKeySet.has(g.key);
                      return (
                        <button
                          key={g.key}
                          type="button"
                          className={[
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs select-none",
                            active ? "bg-muted" : "bg-background hover:bg-muted/40",
                          ].join(" ")}
                          onClick={() => toggleGroup(g)}
                          onMouseEnter={() => hoverEnabled && setHoverGroupKey(g.key)}
                          onMouseLeave={() =>
                            hoverEnabled && setHoverGroupKey((prev) => (prev === g.key ? null : prev))
                          }
                          title={`Toggle: ${g.title}`}
                        >
                          <span className="font-medium">{g.title}</span>
                          <span className="text-muted-foreground tabular-nums">({g.idxs.length})</span>
                        </button>
                      );
                    })}
                </div>

                {/* Columns list */}
                <div className="mt-3 max-h-40 overflow-auto pr-2">
                  <div className="grid gap-x-4 gap-y-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {columnPickerList.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 hover:bg-muted"
                      >
                        <Checkbox
                          checked={visibleCols[name] !== false}
                          onCheckedChange={(v) =>
                            setVisibleCols((prev) => ({ ...prev, [name]: Boolean(v) }))
                          }
                        />
                        <span className="truncate" title={name}>
                          {highlightText(name, colPickerQ)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* GRID */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: theme.bg }}>
              <div
                ref={viewportRef}
                className="relative overflow-auto"
                style={{ maxHeight: "70vh" }}
                onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
              >
                {/* Header */}
                <div
                  ref={headerRef}
                  className="sticky top-0"
                  style={{
                    zIndex: Z_HEADER,
                    display: "grid",
                    gridTemplateColumns,
                    minWidth: totalGridW,
                    backgroundColor: theme.bg,
                    boxShadow: bottomDivider(theme.border),
                  }}
                >
                  {/* Index header */}
                  <div
                    className="px-3 py-2 text-sm font-medium whitespace-nowrap"
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: Z_HEADER_INDEX,
                      width: idxW,
                      backgroundColor: theme.bg,
                      boxShadow: rightDivider(theme.border),
                      overflow: "hidden",
                    }}
                  >
                    #
                  </div>

                  {/* grid container ref for overlay positioning */}
                  <div
                    ref={headerGridRef}
                    className="contents"
                    style={{ position: "relative" as any }}
                  >
                    {gridColsAll.map((c) => {
                      const isPinned = pinnedSet.has(c.idx);
                      const w = widthOf(c.idx);

                      const pIdx = pinnedIndexByCol.get(c.idx) ?? -1;
                      const z = isPinned ? Z_HEADER_PINNED_BASE + pIdx : Z_HEADER_UNPINNED;

                      const isDraggingThis = dragRef.current?.colIdx === c.idx;
                      const inHoverGroup = isColInHoverGroup(c.idx);
                      const shift = shiftForCol(c.idx);

                      return (
                        <div
                          key={c.idx}
                          ref={(el) => {
                            headerCellRef.current[c.idx] = el;
                          }}
                          className="group relative"
                          style={{
                            width: w,
                            position: isPinned ? "sticky" : "relative",
                            left: isPinned ? pinnedLeftOffsets[c.idx] : undefined,
                            zIndex: z,
                            backgroundColor: isPinned ? theme.muted : theme.bg,
                            boxShadow: rightDivider(theme.border),
                            overflow: "hidden",
                            transform: shift,
                            transition:
                              "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease",
                            willChange: shift ? "transform" : undefined,
                            opacity: isDraggingThis ? 0.15 : 1,
                            outline:
                              colSheetOpen || !hoverEnabled
                                ? undefined
                                : inHoverGroup
                                  ? `2px solid ${theme.border}`
                                  : undefined,
                            outlineOffset: -2,
                          }}
                          onMouseEnter={() => {
                            if (!hoverEnabled) return;
                            const gk = groupByColIdx.get(c.idx);
                            if (gk) setHoverGroupKey(gk);
                          }}
                          onMouseLeave={() => {
                            if (!hoverEnabled) return;
                            const gk = groupByColIdx.get(c.idx);
                            setHoverGroupKey((prev) => (prev === gk ? null : prev));
                          }}
                        >
                          <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap">
                            {/* Smooth drag handle */}
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
                              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted cursor-grab active:cursor-grabbing select-none text-muted-foreground"
                              title="Drag to reorder"
                              style={{ touchAction: "none" }}
                            >
                              ⋮⋮
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(c.idx);
                              }}
                              className={[
                                "inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted select-none",
                                pinnedSet.has(c.idx) ? "opacity-100" : "opacity-60",
                              ].join(" ")}
                              title={pinnedSet.has(c.idx) ? "Unpin" : "Pin"}
                            >
                              📌
                            </button>

                            <span className="truncate max-w-[240px]">
                              {q.trim() ? highlightText(c.name, q) : c.name}
                            </span>

                            {isPinned ? (
                              <span className="ml-auto text-[10px] text-muted-foreground">pinned</span>
                            ) : null}
                          </div>

                          <div
                            className="absolute top-0 right-0 h-full w-2 cursor-col-resize opacity-0 group-hover:opacity-100"
                            title="Drag to resize"
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
                  </div>

                  {/* Drag overlay (prod looking) */}
                  {overlayStyle && dragRef.current ? (
                    <div
                      className="pointer-events-none fixed"
                      style={{
                        left: overlayStyle.left,
                        top: overlayStyle.top,
                        width: overlayStyle.width,
                        height: overlayStyle.height,
                        zIndex: Z_HEADER_PINNED_BASE + 5000,
                        transform: "scale(1.02)",
                        transition: "transform 140ms ease",
                      }}
                    >
                      <div
                        className="h-full w-full rounded-xl border"
                        style={{
                          backgroundColor: theme.bg,
                          borderColor: theme.border,
                          boxShadow: "0 18px 60px rgba(0,0,0,0.22)",
                        }}
                      >
                        <div className="flex h-full items-center gap-2 px-3 py-2 text-sm font-semibold">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground">
                            ⋮⋮
                          </span>
                          <span className="truncate">
                            {gridColsAll.find((x) => x.idx === dragRef.current!.colIdx)?.name ?? ""}
                          </span>
                          {dragOverCol !== null && dragOverCol !== dragRef.current.colIdx ? (
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              move → {visualIndex.get(dragOverCol)! + 1}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Body */}
                <div
                  className="relative"
                  style={{
                    height: totalH,
                    minWidth: totalGridW,
                    backgroundColor: theme.bg,
                    zIndex: Z_BODY_ROW,
                  }}
                >
                  {visibleRowSlice.map(({ rowIdx, y, pageRowNumber }) => {
                    const row = parsed!.rows[rowIdx];

                    return (
                      <div
                        key={rowIdx}
                        className="absolute left-0 right-0 hover:bg-muted/10"
                        style={{
                          top: y,
                          height: ROW_H,
                          display: "grid",
                          gridTemplateColumns,
                          backgroundColor: theme.bg,
                          boxShadow: bottomDivider(theme.border),
                          zIndex: Z_BODY_ROW,
                        }}
                      >
                        {/* Index cell */}
                        <div
                          className="px-3 py-2 text-sm whitespace-nowrap tabular-nums overflow-hidden text-ellipsis"
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: Z_BODY_INDEX,
                            width: idxW,
                            backgroundColor: theme.bg,
                            boxShadow: rightDivider(theme.border),
                            overflow: "hidden",
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
                            !!selected && selected.rowIdx === rowIdx && selected.colIdx === c.idx;

                          const pIdx = pinnedIndexByCol.get(c.idx) ?? -1;
                          const z = isPinned ? Z_BODY_PINNED_BASE + pIdx : Z_BODY_UNPINNED;

                          const inHoverGroup = isColInHoverGroup(c.idx);

                          return (
                            <div
                              key={c.idx}
                              className="px-3 py-2 text-sm whitespace-nowrap cursor-default overflow-hidden text-ellipsis"
                              style={{
                                width: w,
                                position: isPinned ? "sticky" : "relative",
                                left: isPinned ? pinnedLeftOffsets[c.idx] : undefined,
                                zIndex: z,
                                backgroundColor: colSheetOpen
                                  ? isPinned
                                    ? theme.muted
                                    : theme.bg
                                  : isSelected
                                    ? theme.muted
                                    : isPinned
                                      ? theme.muted
                                      : theme.bg,
                                boxShadow: rightDivider(theme.border),
                                outline:
                                  colSheetOpen || !hoverEnabled
                                    ? undefined
                                    : inHoverGroup
                                      ? `2px solid ${theme.border}`
                                      : undefined,
                                outlineOffset: -2,
                                transition: "outline 120ms ease",
                              }}
                              onClick={() => setSelected({ rowIdx, colIdx: c.idx })}
                              onDoubleClick={() => {
                                setSelected({ rowIdx, colIdx: c.idx });
                                setActiveCol(c);
                                setActiveCell({ rowIdx, colIdx: c.idx, text });
                                setHoverGroupKey(null);
                                setColSheetOpen(true);
                              }}
                              title="Double click: open details"
                            >
                              {q.trim() ? highlightText(text, q) : text}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom toolbar */}
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                {RowsPerPage}
                {TopPager}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>
                  Total rows: <span className="text-foreground">{parsed.rows.length}</span>
                  {anyFilter ? (
                    <>
                      {" "}
                      • After filter:{" "}
                      <span className="text-foreground">{filteredRowIndexes.length}</span>
                    </>
                  ) : null}
                </div>

                <div className="tabular-nums">
                  Showing:{" "}
                  <span className="text-foreground">
                    {filteredRowIndexes.length === 0 ? 0 : page * pageSize + 1}
                  </span>
                  {"–"}
                  <span className="text-foreground">
                    {Math.min((page + 1) * pageSize, filteredRowIndexes.length)}
                  </span>{" "}
                  • Rendered now: <span className="text-foreground">{endRow - startRow}</span> • Pinned
                  width: <span className="text-foreground">{Math.round(pinnedTotalW)}px</span>
                </div>
              </div>

              {selected ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  Press <span className="text-foreground font-medium">Ctrl/Cmd+C</span> to copy cell
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Column / Cell details */}
        <Sheet
          open={colSheetOpen}
          onOpenChange={(open) => {
            setColSheetOpen(open);
            if (!open) setActiveCell(null);
          }}
        >
          <SheetContent data-ft-sheet="1" side="right" className="w-[420px] sm:w-[520px] z-3000">
            <SheetHeader>
              <SheetTitle>
                {activeCell
                  ? `Cell • row ${activeCell.rowIdx + 1}, col "${activeCol?.name ?? ""}"`
                  : `Column: ${activeCol?.name ?? ""}`}
              </SheetTitle>
            </SheetHeader>

            {!parsed || !activeCol ? (
              <div className="mt-4 text-sm text-muted-foreground">No selection</div>
            ) : (
              <div className="mt-4 space-y-4">
                {activeCell ? (
                  <div className="rounded-xl border p-3 space-y-2">
                    <div className="text-sm font-medium">Cell value</div>

                    <div className="rounded-lg border bg-muted/20 p-2 font-mono text-sm break-all">
                      {activeCell.text || <span className="text-muted-foreground">∅ empty</span>}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const ok = await copyToClipboard(activeCell.text ?? "");
                          setCopiedToast(ok ? "Copied cell" : "Copy failed");
                          window.setTimeout(() => setCopiedToast(null), 1200);
                        }}
                      >
                        Copy cell
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const gk = groupByColIdx.get(activeCol.idx);
                          if (!gk) return;
                          const g = groups.find((x) => x.key === gk);
                          if (!g) return;
                          toggleGroup(g);
                        }}
                        title="Toggle category of this column"
                      >
                        Toggle category
                      </Button>
                    </div>
                  </div>
                ) : null}

                {activeColStats ? (
                  <div className="rounded-xl border p-3 space-y-2">
                    <div className="text-sm font-medium">Column stats</div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-muted-foreground">Numeric</div>
                      <div className="text-right tabular-nums">{activeColStats.count}</div>

                      <div className="text-muted-foreground">Empty/NaN</div>
                      <div className="text-right tabular-nums">{activeColStats.empty}</div>

                      <div className="text-muted-foreground">Min</div>
                      <div className="text-right tabular-nums">{String(activeColStats.min)}</div>

                      <div className="text-muted-foreground">Max</div>
                      <div className="text-right tabular-nums">{String(activeColStats.max)}</div>

                      <div className="text-muted-foreground">Avg</div>
                      <div className="text-right tabular-nums">{String(activeColStats.avg)}</div>

                      <div className="text-muted-foreground">Median</div>
                      <div className="text-right tabular-nums">{String(activeColStats.median)}</div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border p-3">
                  <div className="text-sm font-medium mb-2">Values preview</div>
                  <div className="text-xs text-muted-foreground mb-2">
                    First 300 non-empty values.
                  </div>

                  <div className="max-h-[55vh] overflow-auto pr-2 space-y-1">
                    {activeColValues.slice(0, 300).map((v, i) => (
                      <div key={i} className="text-sm font-mono break-all">
                        {String(v)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}