"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Info, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useTaskStore } from "@/store/taskStore";

const BAR_H = 28;

const TIP_W = 260;
const TIP_OFFSET_X = 14;
const TIP_OFFSET_Y = 12;
const TIP_SHOW_DELAY_MS = 120;
const TIP_HIDE_DELAY_MS = 60;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}
function fmtSec(s: number) {
  if (!isFinite(s) || s < 0) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const ss = s - m * 60;
  return `${m}:${String(Math.floor(ss)).padStart(2, "0")}`;
}

function segHex(label: string) {
  const k = (label || "").toLowerCase().trim();

  // emotions
  if (k.includes("anger") || k.includes("rage") || k.includes("зл")) return "#EF4444";
  if (k.includes("joy") || k.includes("happy") || k.includes("рад")) return "#F59E0B";
  if (k.includes("sad") || k.includes("sadness") || k.includes("гру")) return "#3B82F6";
  if (k.includes("stress") || k.includes("fear") || k.includes("anx") || k.includes("стр") || k.includes("страх"))
    return "#A855F7";

  // neutral/calm
  if (k.includes("calm") || k.includes("neutral") || k.includes("нейт") || k.includes("спок")) return "#94A3B8";

  // truth / lie
  if (k.includes("truth") || k === "true" || k.includes("ист")) return "#22D3EE";
  if (k.includes("lie") || k === "false" || k.includes("лож")) return "#0F172A";

  return "#64748B";
}

function segText(label: string) {
  const k = (label || "").toLowerCase().trim();
  const map: Record<string, string> = {
    anger: "злость",
    rage: "злость",
    joy: "радость",
    happy: "радость",
    sadness: "грусть",
    sad: "грусть",
    neutral: "нейтр",
    calm: "спокойно",
    stress: "стресс",
    fear: "страх",
    anx: "тревога",
    truth: "истина",
    true: "истина",
    lie: "ложь",
    false: "ложь",
  };
  return map[k] ?? label ?? "";
}

type SegAny = {
  label: string;
  startFrame: number;
  endFrame: number;
  confidence?: number;
};

type Mode = "truth" | "emotion";


export type SpectrogramPanelProps = {
  variant?: "full" | "preview";

  interactive?: boolean; // wheel zoom + pan + minimap drag
  showHeader?: boolean; // badges + details
  showModeTabs?: boolean; // truth/emotion tabs
  showControls?: boolean; // zoom buttons + slider
  showMinimap?: boolean; // minimap
  showLegend?: boolean; // legend
  showSegmentsBar?: boolean; // top bar segments + tooltip
  showTimeRuler?: boolean; // ruler on spectrogram
  defaultMode?: Mode; // фиксируем, если tabs выключены

  heightClassName?: string;
};

function normLabel(label: string) {
  return (label || "").toLowerCase().trim();
}
function isTruthLabel(label: string) {
  const k = normLabel(label);
  return k.includes("truth") || k === "true" || k.includes("lie") || k === "false" || k.includes("ист") || k.includes("лож");
}
function isEmotionLabel(label: string) {
  const k = normLabel(label);
  return (
    k.includes("anger") ||
    k.includes("rage") ||
    k.includes("joy") ||
    k.includes("happy") ||
    k.includes("sad") ||
    k.includes("sadness") ||
    k.includes("neutral") ||
    k.includes("calm") ||
    k.includes("stress") ||
    k.includes("fear") ||
    k.includes("anx") ||
    // RU
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

/** Mock mel */
function genMel(frames: number, bins: number) {
  const arr = new Uint8Array(frames * bins);
  const gauss = (x: number, mu: number, sigma: number) => {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z);
  };

  const basePitch = 6;
  const pitchVar = 2.5;

  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const isPause = (t > 0.18 && t < 0.23) || (t > 0.58 && t < 0.62);
    const isFricative = (t > 0.33 && t < 0.38) || (t > 0.78 && t < 0.84);

    const F1 = 12 + 4 * Math.sin(2 * Math.PI * (t * 1.2 + 0.1));
    const F2 = 30 + 7 * Math.sin(2 * Math.PI * (t * 0.9 + 0.4));
    const F3 = 52 + 5 * Math.sin(2 * Math.PI * (t * 0.7 + 0.2));
    const pitch = basePitch + pitchVar * Math.sin(2 * Math.PI * (t * 1.6 + 0.15));

    for (let b = 0; b < bins; b++) {
      const k = b / (bins - 1);
      let energy = 16 + 150 * Math.exp(-3.6 * k);

      energy += 95 * gauss(b, F1, 3.0);
      energy += 80 * gauss(b, F2, 4.0);
      energy += 55 * gauss(b, F3, 4.5);

      if (!isFricative) {
        const harmonicStrength = 55 * Math.exp(-2.2 * k);
        const p = Math.max(1, pitch);
        const distToHarm = Math.abs((b % p) - p / 2) / (p / 2);
        const harmonic = harmonicStrength * Math.exp(-8 * distToHarm * distToHarm);
        energy += harmonic;
      }

      if (isFricative) energy += 95 * Math.pow(k, 1.7) + 30 * (Math.random() - 0.5);
      if (isPause) energy = 8 + 18 * Math.random();
      else energy += 10 * (Math.random() - 0.5);

      arr[f * bins + b] = clamp(Math.round(energy), 0, 255);
    }
  }
  return arr;
}

/** Inferno LUT */
function makeInfernoLUT() {
  const stops = [
    { t: 0.0, c: [0, 0, 4] },
    { t: 0.13, c: [31, 12, 72] },
    { t: 0.25, c: [85, 15, 109] },
    { t: 0.38, c: [136, 34, 106] },
    { t: 0.5, c: [186, 54, 85] },
    { t: 0.63, c: [227, 89, 51] },
    { t: 0.75, c: [249, 140, 10] },
    { t: 0.88, c: [252, 195, 60] },
    { t: 1.0, c: [252, 255, 164] },
  ];

  const lut = new Uint8Array(256 * 3);
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];

    for (let j = 0; j < stops.length - 1; j++) {
      if (x >= stops[j].t && x <= stops[j + 1].t) {
        s0 = stops[j];
        s1 = stops[j + 1];
        break;
      }
    }

    const kk = (x - s0.t) / ((s1.t - s0.t) || 1);
    lut[i * 3 + 0] = Math.round(lerp(s0.c[0], s1.c[0], kk));
    lut[i * 3 + 1] = Math.round(lerp(s0.c[1], s1.c[1], kk));
    lut[i * 3 + 2] = Math.round(lerp(s0.c[2], s1.c[2], kk));
  }

  return lut;
}
const INFERNO_LUT = makeInfernoLUT();

const LEGEND_EMOTION = [
  { key: "anger", label: "злость" },
  { key: "joy", label: "радость" },
  { key: "sadness", label: "грусть" },
  { key: "neutral", label: "нейтр" },
] as const;

const LEGEND_TRUTH = [
  { key: "truth", label: "истина" },
  { key: "lie", label: "ложь" },
] as const;

function toU8(mel: any, expected: number) {
  if (!mel) return null;
  if (mel instanceof Uint8Array) return mel.length === expected ? mel : null;

  if (Array.isArray(mel)) {
    if (mel.length !== expected) return null;
    const u8 = new Uint8Array(expected);
    for (let i = 0; i < expected; i++) u8[i] = clamp(Math.round(mel[i] ?? 0), 0, 255);
    return u8;
  }
  return null;
}

function findSegByFrameSorted(segments: SegAny[], frame: number): SegAny | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (frame < s.startFrame) hi = mid - 1;
    else if (frame >= s.endFrame) lo = mid + 1;
    else return s;
  }
  return null;
}

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "destructive" as const;
  if (s.includes("done") || s.includes("success") || s.includes("complete")) return "secondary" as const;
  if (s.includes("run") || s.includes("process") || s.includes("progress")) return "default" as const;
  return "outline" as const;
}

function clampViewStart(start: number, len: number, total: number) {
  const maxStart = Math.max(0, total - len);
  return clamp(start, 0, maxStart);
}


type SpectroCache = {
  canvas: HTMLCanvasElement;
  cacheW: number;
  cacheH: number; // melBins
  frames: number;
  melBins: number;
};

function buildSpectroCache(frames: number, melBins: number, mel: Uint8Array) {
  const MAX_CACHE_W = 2400;
  const cacheW = Math.min(frames, MAX_CACHE_W);
  const cacheH = melBins;

  const c = document.createElement("canvas");
  c.width = cacheW;
  c.height = cacheH;

  const ctx = c.getContext("2d", { willReadFrequently: false });
  if (!ctx) return null;

  const img = ctx.createImageData(cacheW, cacheH);
  const px = img.data;

  for (let x = 0; x < cacheW; x++) {
    const f = clamp(Math.floor(((x + 0.5) / cacheW) * frames), 0, frames - 1);
    for (let y = 0; y < cacheH; y++) {
      const b = clamp(Math.floor(((cacheH - 1 - y) / cacheH) * melBins), 0, melBins - 1);
      const v0 = mel[f * melBins + b] ?? 0;
      const v = clamp(Math.round((v0 - 10) * 1.25), 0, 255);

      const i = (y * cacheW + x) * 4;
      const j = v * 3;
      px[i + 0] = INFERNO_LUT[j + 0];
      px[i + 1] = INFERNO_LUT[j + 1];
      px[i + 2] = INFERNO_LUT[j + 2];
      px[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return { canvas: c, cacheW, cacheH, frames, melBins } satisfies SpectroCache;
}

export default function SpectrogramPanel(props: SpectrogramPanelProps) {
  const variant = props.variant ?? "full";
  const isPreview = variant === "preview";

  const interactive = props.interactive ?? !isPreview;
  const showHeader = props.showHeader ?? !isPreview;
  const showModeTabs = props.showModeTabs ?? !isPreview;
  const showControls = props.showControls ?? !isPreview;
  const showMinimap = props.showMinimap ?? !isPreview;
  const showLegend = props.showLegend ?? !isPreview;
  const showSegmentsBar = props.showSegmentsBar ?? !isPreview;
  const showTimeRuler = props.showTimeRuler ?? !isPreview;
  const defaultMode = props.defaultMode ?? "truth";
  const heightClassName = props.heightClassName ?? (isPreview ? "h-[220px]" : "h-[420px]");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [wrapW, setWrapW] = useState(0);

  const [mode, setMode] = useState<Mode>(defaultMode);
  useEffect(() => {
    if (!showModeTabs) setMode(defaultMode);
  }, [showModeTabs, defaultMode]);

  const status = useTaskStore((s) => s.status);
  const spectrogram = useTaskStore((s) => s.spectrogram);
  const segments = useTaskStore((s) => s.segments) as unknown as SegAny[] | undefined;

  const MOCK_FRAMES = 900;
  const MOCK_BINS = 80;
  const mockMel = useMemo(() => genMel(MOCK_FRAMES, MOCK_BINS), []);

  const source = useMemo(() => {
    if (spectrogram?.frames && spectrogram?.melBins && (spectrogram as any).mel) {
      const expected = spectrogram.frames * spectrogram.melBins;
      const melU8 = toU8((spectrogram as any).mel, expected);
      if (melU8) {
        return { kind: "server" as const, frames: spectrogram.frames, melBins: spectrogram.melBins, mel: melU8 };
      }
    }
    return { kind: "mock" as const, frames: MOCK_FRAMES, melBins: MOCK_BINS, mel: mockMel };
  }, [spectrogram, mockMel]);

  // TODO: если сервер даст hop_ms/frame_ms то добавить сюда
  const frameSec = 0.016;

  const segmentsSortedAll = useMemo(() => {
    if (!segments?.length) return [];
    return [...segments].sort((a, b) => a.startFrame - b.startFrame);
  }, [segments]);

  const segmentsSorted = useMemo(() => {
    if (!showSegmentsBar) return [];
    if (!segmentsSortedAll.length) return [];
    return mode === "truth" ? segmentsSortedAll.filter((s) => isTruthLabel(s.label)) : segmentsSortedAll.filter((s) => isEmotionLabel(s.label));
  }, [segmentsSortedAll, mode, showSegmentsBar]);

  const legend = mode === "truth" ? LEGEND_TRUTH : LEGEND_EMOTION;

  const MIN_VIEW_LEN = 120;
  const [viewStart, setViewStart] = useState(0);
  const [viewLen, setViewLen] = useState(() => Math.min(700, source.frames));

  useEffect(() => {
    setViewStart(0);
    setViewLen(Math.min(700, source.frames));
  }, [source.frames]);

  const viewEnd = viewStart + viewLen;

  const zoomTo = useCallback(
    (nextLen: number, anchor01: number) => {
      const total = source.frames || 1;
      nextLen = Math.round(clamp(nextLen, MIN_VIEW_LEN, total));
      const anchorFrame = viewStart + anchor01 * viewLen;
      let nextStart = Math.round(anchorFrame - anchor01 * nextLen);
      nextStart = clampViewStart(nextStart, nextLen, total);
      setViewLen(nextLen);
      setViewStart(nextStart);
    },
    [source.frames, viewStart, viewLen]
  );

  const panTo = useCallback(
    (nextStart: number) => {
      const total = source.frames || 1;
      nextStart = clampViewStart(Math.round(nextStart), viewLen, total);
      setViewStart(nextStart);
    },
    [viewLen, source.frames]
  );

  const resetView = useCallback(() => {
    setViewStart(0);
    setViewLen(Math.min(700, source.frames || 1));
  }, [source.frames]);

  // -------- tooltip --------
  const [hover, setHover] = useState<{ seg: SegAny; x: number; y: number } | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastNextRef = useRef<{ seg: SegAny; x: number; y: number } | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    showTimerRef.current = null;
    hideTimerRef.current = null;
  }, []);

  const scheduleHoverUpdate = useCallback(
    (next: { seg: SegAny; x: number; y: number } | null) => {
      lastNextRef.current = next;

      if (next) {
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }

        if (hover && hover.seg === next.seg) {
          setHover(next);
          return;
        }

        if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null;
          setHover(lastNextRef.current);
        }, TIP_SHOW_DELAY_MS);
        return;
      }

      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setHover(null);
      }, TIP_HIDE_DELAY_MS);
    },
    [hover]
  );

  useEffect(() => {
    clearTimers();
    setHover(null);
  }, [mode, clearTimers]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const tooltip = useMemo(() => {
    if (!showSegmentsBar) return null;
    if (!hover) return null;
    const conf = typeof hover.seg.confidence === "number" ? clamp(hover.seg.confidence, 0, 1) : null;
    const hex = segHex(hover.seg.label);
    return {
      title: segText(hover.seg.label),
      confText: conf === null ? "—" : `${Math.round(conf * 100)}%`,
      range: `[${hover.seg.startFrame}, ${hover.seg.endFrame})`,
      hex,
    };
  }, [hover, showSegmentsBar]);

  const statsText = useMemo(() => {
    const total = segmentsSortedAll.length;
    const shown = segmentsSorted.length;
    return total ? `${shown}/${total}` : "0";
  }, [segmentsSorted.length, segmentsSortedAll.length]);

  const findSegAt = useCallback(
    (t01: number) => {
      if (!segmentsSorted.length) return null;
      const frame = clamp(Math.floor(viewStart + t01 * viewLen), 0, (source.frames || 1) - 1);
      return findSegByFrameSorted(segmentsSorted, frame);
    },
    [segmentsSorted, viewStart, viewLen, source.frames]
  );

  const updateHoverFromClientXY = useCallback(
    (clientX: number, clientY: number) => {
      if (!showSegmentsBar) return;
      const wrap = wrapRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const y = clamp(clientY - rect.top, 0, rect.height);
      const t = rect.width ? x / rect.width : 0;

      if (y <= BAR_H + 10) {
        const seg = findSegAt(t);
        scheduleHoverUpdate(seg ? { seg, x, y } : null);
      } else {
        scheduleHoverUpdate(null);
      }
    },
    [findSegAt, scheduleHoverUpdate, showSegmentsBar]
  );

  const tooltipPos = useMemo(() => {
    if (!hover) return null;
    const left = clamp(hover.x + TIP_OFFSET_X, 12, Math.max(12, wrapW - TIP_W - 12));
    const top = clamp(hover.y + TIP_OFFSET_Y, 8, BAR_H + 12);
    return { left, top };
  }, [hover, wrapW]);

  const showTip = !!tooltip && !!hover && !!tooltipPos;

  const [panning, setPanning] = useState<null | { x0: number; start0: number }>(null);

  const onPanDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const wrap = wrapRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (showSegmentsBar && y <= BAR_H + 10) return;

      wrap.setPointerCapture(e.pointerId);
      setPanning({ x0: e.clientX, start0: viewStart });
      scheduleHoverUpdate(null);
      e.preventDefault();
    },
    [interactive, viewStart, scheduleHoverUpdate, showSegmentsBar]
  );

  const onPanMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      if (!panning) return;
      const wrap = wrapRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();
      const dx = e.clientX - panning.x0;
      const framesPerPx = viewLen / Math.max(1, rect.width);
      const shiftFrames = Math.round(dx * framesPerPx);

      panTo(panning.start0 - shiftFrames);
      e.preventDefault();
    },
    [interactive, panning, viewLen, panTo]
  );

  const onPanUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      if (!panning) return;
      const wrap = wrapRef.current;
      if (wrap) {
        try {
          wrap.releasePointerCapture(e.pointerId);
        } catch {}
      }
      setPanning(null);
      e.preventDefault();
    },
    [interactive, panning]
  );

  // -------- minimap / scrollbar --------
  const miniRef = useRef<HTMLDivElement | null>(null);
  const [miniDrag, setMiniDrag] = useState<null | { x0: number; start0: number }>(null);

  const miniSetByClientX = useCallback(
    (clientX: number) => {
      if (!interactive) return;
      const el = miniRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const center01 = rect.width ? x / rect.width : 0;

      const centerFrame = center01 * (source.frames || 1);
      const nextStart = Math.round(centerFrame - viewLen / 2);
      panTo(nextStart);
    },
    [interactive, source.frames, viewLen, panTo]
  );

  const onMiniDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const el = miniRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);

      miniSetByClientX(e.clientX);
      setMiniDrag({ x0: e.clientX, start0: viewStart });
      e.preventDefault();
    },
    [interactive, miniSetByClientX, viewStart]
  );

  const onMiniMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      if (!miniDrag) return;
      const el = miniRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      const dx = e.clientX - miniDrag.x0;
      const framesPerPx = (source.frames || 1) / Math.max(1, rect.width);
      const shiftFrames = Math.round(dx * framesPerPx);

      panTo(miniDrag.start0 + shiftFrames);
      e.preventDefault();
    },
    [interactive, miniDrag, source.frames, panTo]
  );

  const onMiniUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      if (!miniDrag) return;
      const el = miniRef.current;
      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {}
      }
      setMiniDrag(null);
      e.preventDefault();
    },
    [interactive, miniDrag]
  );

  const miniThumb = useMemo(() => {
    const total = source.frames || 1;
    const left01 = viewStart / total;
    const width01 = viewLen / total;
    return {
      leftPct: clamp(left01 * 100, 0, 100),
      widthPct: clamp(width01 * 100, 0.5, 100),
    };
  }, [source.frames, viewStart, viewLen]);

  useEffect(() => {
    if (!interactive) return;
    const el = wrapRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      // блокируем прокрутку страницы
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const anchor01 = rect.width ? x / rect.width : 0;

      const dir = Math.sign(e.deltaY);
      const factor = dir > 0 ? 1.15 : 0.87;

      zoomTo(Math.round(viewLen * factor), anchor01);
    };

    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheelNative as any);
    };
  }, [interactive, zoomTo, viewLen]);

  // -------- zoom slider --------
  const zoomValue = useMemo(() => {
    const total = source.frames || 1;
    const minLen = Math.min(MIN_VIEW_LEN, total);
    const maxLen = total;

    const k = Math.log(viewLen / minLen) / Math.log(maxLen / minLen || 1.00001);
    const inv = 1 - clamp(k, 0, 1);
    return Math.round(inv * 100);
  }, [viewLen, source.frames]);

  const onZoomSlider = useCallback(
    (v: number[]) => {
      const z = clamp(v?.[0] ?? 0, 0, 100);

      const total = source.frames || 1;
      const minLen = Math.min(MIN_VIEW_LEN, total);
      const maxLen = total;

      const t = 1 - z / 100;
      const nextLen = Math.round(minLen * Math.pow(maxLen / minLen || 1, t));

      zoomTo(nextLen, 0.5);
    },
    [source.frames, zoomTo]
  );

  // -------- cache build --------
  const [cache, setCache] = useState<SpectroCache | null>(null);
  useEffect(() => {
    const { frames, melBins, mel } = source;
    const built = buildSpectroCache(frames, melBins, mel);
    setCache(built);
  }, [source]);

  // -------- draw --------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastDpr = -1;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(160, Math.floor(rect.height));

      setWrapW(w);

      const bw = Math.floor(w * dpr);
      const bh = Math.floor(h * dpr);

      if (dpr !== lastDpr || canvas.width !== bw || canvas.height !== bh) {
        lastDpr = dpr;
        canvas.width = bw;
        canvas.height = bh;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.clearRect(0, 0, w, h);

      const specTop = showSegmentsBar ? BAR_H : 0;
      const specH = h - specTop;

      if (cache) {
        const cacheX1 = (viewStart / cache.frames) * cache.cacheW;
        const cacheX2 = (viewEnd / cache.frames) * cache.cacheW;
        const sx = clamp(Math.floor(cacheX1), 0, Math.max(0, cache.cacheW - 1));
        const sw = clamp(Math.ceil(cacheX2 - cacheX1), 1, cache.cacheW - sx);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cache.canvas, sx, 0, sw, cache.cacheH, 0, specTop, w, specH);
      } else {
        ctx.fillStyle = "rgba(2,6,23,0.06)";
        ctx.fillRect(0, specTop, w, specH);
      }

      if (showSegmentsBar) {
        // top bar bg
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(0, 0, w, BAR_H);

        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.beginPath();
        ctx.moveTo(0, BAR_H + 0.5);
        ctx.lineTo(w, BAR_H + 0.5);
        ctx.stroke();

        if (segmentsSorted.length) {
          ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

          const winA = viewStart;
          const winB = viewEnd;

          for (const s of segmentsSorted) {
            if (s.endFrame <= winA || s.startFrame >= winB) continue;

            const segA = clamp(s.startFrame, winA, winB);
            const segB = clamp(s.endFrame, winA, winB);
            const x1 = ((segA - winA) / viewLen) * w;
            const x2 = ((segB - winA) / viewLen) * w;
            const width = Math.max(1, x2 - x1);

            const hex = segHex(s.label);
            const conf = typeof s.confidence === "number" ? clamp(s.confidence, 0, 1) : 0.78;

            ctx.fillStyle = hexToRgba(hex, 0.10 + conf * 0.10);
            ctx.fillRect(x1, 0, width, BAR_H);

            ctx.fillStyle = hexToRgba(hex, 0.98);
            ctx.fillRect(x1, 0, width, 3);

            ctx.fillStyle = hexToRgba(hex, 0.92);
            ctx.fillRect(x1, BAR_H - 2, width, 2);

            ctx.strokeStyle = "rgba(0,0,0,0.10)";
            ctx.strokeRect(x1 + 0.5, 0.5, Math.max(0, width - 1), BAR_H - 1);

            const label = segText(s.label);
            const pad = 7;
            const maxTextW = Math.max(0, width - pad * 2);
            if (maxTextW > 34) {
              ctx.fillStyle = "rgba(15,23,42,0.78)";
              ctx.save();
              ctx.beginPath();
              ctx.rect(x1, 0, width, BAR_H);
              ctx.clip();
              ctx.fillText(label, x1 + pad, 18);
              ctx.restore();
            }
          }
        } else {
          ctx.fillStyle = "rgba(15,23,42,0.55)";
          ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.fillText(source.kind === "mock" ? "demo" : "нет сегментов для режима", 10, 18);
        }
      }

      if (showTimeRuler) {
        ctx.save();
        ctx.translate(0, specTop);
        ctx.strokeStyle = "rgba(0,0,0,0.10)";
        ctx.fillStyle = "rgba(15,23,42,0.55)";
        ctx.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

        const winSec = viewLen * frameSec;
        const approxTicks = clamp(Math.floor(w / 140), 3, 8);

        const rawStep = winSec / approxTicks;
        const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
        let step = niceSteps[niceSteps.length - 1];
        for (const s of niceSteps) {
          if (s >= rawStep) {
            step = s;
            break;
          }
        }

        const winStartSec = viewStart * frameSec;
        const firstTickSec = Math.ceil(winStartSec / step) * step;

        for (let tSec = firstTickSec; tSec <= winStartSec + winSec + 1e-6; tSec += step) {
          const f = tSec / frameSec;
          const x = ((f - viewStart) / viewLen) * w;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, 6);
          ctx.stroke();
          ctx.fillText(fmtSec(tSec), x + 2, 18);
        }

        ctx.restore();
      }
    };

    const resizeRaf = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => resizeRaf());
    ro.observe(wrap);

    const onWinResize = () => resizeRaf();
    window.addEventListener("resize", onWinResize);
    const vv = window.visualViewport;
    if (vv) vv.addEventListener("resize", onWinResize);

    resizeRaf();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      if (vv) vv.removeEventListener("resize", onWinResize);
    };
  }, [cache, source.kind, showSegmentsBar, showTimeRuler, segmentsSorted, viewStart, viewLen, viewEnd, frameSec]);

  // -------- UI helpers --------
  const viewInfo = useMemo(() => {
    const a = viewStart;
    const b = viewEnd;
    const aSec = a * frameSec;
    const bSec = b * frameSec;
    const wSec = viewLen * frameSec;
    return {
      frames: `[${a}, ${b})`,
      time: `${fmtSec(aSec)} - ${fmtSec(bSec)}`,
      window: fmtSec(wSec),
    };
  }, [viewStart, viewEnd, viewLen]);

  const legendText = mode === "truth" ? "Истинность" : "Эмоции";

  return (
    <div className="space-y-3">
      {showHeader ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusTone(String(status))}>{String(status)}</Badge>
            <Badge variant="outline">{source.kind === "mock" ? "demo" : "server"}</Badge>
            <Badge variant="outline">segments: {statsText}</Badge>

            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="gap-2 text-muted-foreground">
                  <Info className="h-4 w-4" />
                  Details
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px]">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Детали</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted-foreground">Источник</div>
                    <div className="text-right">{source.kind}</div>

                    <div className="text-muted-foreground">Frames</div>
                    <div className="text-right tabular-nums">{source.frames}</div>

                    <div className="text-muted-foreground">Mel bins</div>
                    <div className="text-right tabular-nums">{source.melBins}</div>

                    <div className="text-muted-foreground">Окно</div>
                    <div className="text-right tabular-nums">{viewInfo.frames}</div>

                    <div className="text-muted-foreground">Время</div>
                    <div className="text-right tabular-nums">{viewInfo.time}</div>

                    <div className="text-muted-foreground">Ширина окна</div>
                    <div className="text-right tabular-nums">{viewInfo.window}</div>
                  </div>

                  <Separator />

                  <div className="text-xs text-muted-foreground">
                    Wheel - zoom.
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {showModeTabs ? (
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full sm:w-auto">
              <TabsList className="grid w-full grid-cols-2 sm:w-[240px]">
                <TabsTrigger value="truth">Истинность</TabsTrigger>
                <TabsTrigger value="emotion">Эмоции</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
      ) : null}

      {showControls ? (
        <div className="flex flex-col gap-2 rounded-2xl border bg-background p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">Навигация</div>
            <Badge variant="outline" className="tabular-nums">
              {viewInfo.time}
            </Badge>
            <Badge variant="outline" className="tabular-nums">
              окно: {viewInfo.window}
            </Badge>

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => zoomTo(Math.round(viewLen * 0.87), 0.5)}
                className="gap-2"
                disabled={!interactive}
              >
                <ZoomIn className="h-4 w-4" />
                Zoom
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => zoomTo(Math.round(viewLen * 1.15), 0.5)}
                className="gap-2"
                disabled={!interactive}
              >
                <ZoomOut className="h-4 w-4" />
                Out
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={resetView} className="gap-2" disabled={!interactive}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr,280px] sm:items-center">
            <div className="text-xs text-muted-foreground">
              {legendText}. Колёсико - zoom, перетаскивай спектрограмму для прокрутки. Мини-карта снизу - быстро прыгать по записи.
            </div>

            <div className="flex items-center gap-3">
              <div className="w-full">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Zoom</span>
                  <span className="tabular-nums">{Math.round(((source.frames || 1) / viewLen) * 10) / 10}×</span>
                </div>
                <Slider value={[zoomValue]} onValueChange={onZoomSlider} min={0} max={100} step={1} disabled={!interactive} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-background shadow-sm overflow-hidden">
        <div
          ref={wrapRef}
          className={[
            "relative w-full select-none overscroll-contain",
            heightClassName,
          ].join(" ")}
          style={{ touchAction: "none" }}
          onMouseEnter={showSegmentsBar ? (e) => updateHoverFromClientXY(e.clientX, e.clientY) : undefined}
          onMouseMove={showSegmentsBar ? (e) => updateHoverFromClientXY(e.clientX, e.clientY) : undefined}
          onMouseLeave={showSegmentsBar ? () => scheduleHoverUpdate(null) : undefined}
          onPointerDown={interactive ? onPanDown : undefined}
          onPointerMove={interactive ? onPanMove : undefined}
          onPointerUp={interactive ? onPanUp : undefined}
          onPointerCancel={interactive ? onPanUp : undefined}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {showSegmentsBar && tooltip ? (
            <div
              className={[
                "pointer-events-none absolute z-20 rounded-xl border bg-background/95 backdrop-blur px-3 py-2 shadow-md text-xs",
                "transition-all duration-150 ease-out will-change-transform will-change-opacity",
                showTip ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-1 scale-[0.98]",
              ].join(" ")}
              style={{
                left: tooltipPos?.left ?? 12,
                top: tooltipPos?.top ?? 8,
              }}
              aria-hidden={!showTip}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tooltip.hex }} />
                <span className="font-medium">{tooltip.title}</span>
                <span className="text-muted-foreground">{tooltip.confText}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">frames: {tooltip.range}</div>
            </div>
          ) : null}
        </div>

        {showMinimap ? (
          <>
            <Separator />
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Мини-карта: drag по окну = прокрутка. Клик по треку = прыгнуть.</div>
                <div className="text-xs text-muted-foreground tabular-nums">{fmtSec((source.frames || 1) * frameSec)}</div>
              </div>

              <div
                ref={miniRef}
                className="relative h-3 w-full rounded-full bg-muted/60 ring-1 ring-border overflow-hidden"
                style={{ touchAction: "none" }}
                onPointerDown={interactive ? onMiniDown : undefined}
                onPointerMove={interactive ? onMiniMove : undefined}
                onPointerUp={interactive ? onMiniUp : undefined}
                onPointerCancel={interactive ? onMiniUp : undefined}
              >
                <div
                  className="absolute top-0 h-full rounded-full bg-foreground/15 ring-1 ring-foreground/25"
                  style={{
                    left: `${miniThumb.leftPct}%`,
                    width: `${miniThumb.widthPct}%`,
                  }}
                />
              </div>
            </div>
          </>
        ) : null}

        {showLegend ? (
          <>
            <Separator />
            <div className="flex flex-wrap gap-2 p-3">
              {legend.map((l) => {
                const hex = segHex(l.key);
                return (
                  <span
                    key={l.key}
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1"
                    style={{
                      background: hexToRgba(hex, 0.10),
                      color: "#0F172A",
                      borderColor: hexToRgba(hex, 0.22),
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
                    {l.label}
                  </span>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {!isPreview ? (
        <p className="text-xs text-muted-foreground">
          Подсказка появляется при наведении на верхнюю полоску сегментов.
        </p>
      ) : null}
    </div>
  );
}
