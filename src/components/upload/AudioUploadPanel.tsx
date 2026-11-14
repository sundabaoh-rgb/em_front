"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTaskStore } from "@/store/taskStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RecordingOverlay from "@/components/upload/RecordingOverlay";
import {
  Mic,
  Upload,
  FileAudio2,
  X,
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Settings2,
  Sparkles,
  Loader2,
} from "lucide-react";

/* ---------------- utils ---------------- */

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isValidDuration(d: number) {
  return Number.isFinite(d) && d > 0 && d !== Infinity;
}

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "destructive" as const;
  if (s.includes("done") || s.includes("success") || s.includes("complete")) return "secondary" as const;
  if (s.includes("run") || s.includes("process") || s.includes("progress")) return "default" as const;
  return "outline" as const;
}

function fileKey(f: File) {
  return `${f.name}|${f.size}|${f.type}|${f.lastModified}`;
}

function isFileDrag(e: React.DragEvent) {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes("Files");
}

async function computeDurationSec(file: File, signal?: AbortSignal): Promise<number | null> {
  try {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;

    const meta = await new Promise<number | null>((resolve) => {
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("error", onErr);
        URL.revokeObjectURL(url);
      };
      const onMeta = () => {
        const d = audio.duration;
        cleanup();
        resolve(isValidDuration(d) ? d : null);
      };
      const onErr = () => {
        cleanup();
        resolve(null);
      };
      audio.addEventListener("loadedmetadata", onMeta, { once: true });
      audio.addEventListener("error", onErr, { once: true });
    });

    if (signal?.aborted) return null;
    if (meta !== null) return meta;
  } catch {}

  try {
    const ab = await file.arrayBuffer();
    if (signal?.aborted) return null;

    const AudioCtx =
      (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    try {
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        const p = (ctx as any).decodeAudioData(ab, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve, reject);
      });
      const d = buf.duration;
      return isValidDuration(d) ? d : null;
    } finally {
      try {
        await ctx.close();
      } catch {}
    }
  } catch {
    return null;
  }
}

/* ---------------- IndexedDB persistence ---------------- */

const DB_NAME = "front-emotion";
const DB_VERSION = 1;
const STORE_NAME = "audio";
const AUDIO_KEY = "last-audio-v1";

type PersistedAudio = {
  name: string;
  type: string;
  lastModified: number;
  buf: ArrayBuffer;
  durationSec: number | null;
  size: number;
};

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idbOpen();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const st = tx.objectStore(STORE_NAME);
      const req = st.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const st = tx.objectStore(STORE_NAME);
      const req = st.put(value as any, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbDel(key: string): Promise<void> {
  const db = await idbOpen();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const st = tx.objectStore(STORE_NAME);
      const req = st.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/* ---------------- drag hooks ---------------- */

function useDragValue(opts: {
  get01FromClientX: (clientX: number) => number;
  onChange01: (v01: number) => void;
  onCommit01?: (v01: number) => void;
}) {
  const { get01FromClientX, onChange01, onCommit01 } = opts;
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      const v01 = clamp(get01FromClientX(e.clientX), 0, 1);
      onChange01(v01);
      e.preventDefault();
    },
    [get01FromClientX, onChange01]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const v01 = clamp(get01FromClientX(e.clientX), 0, 1);
      onChange01(v01);
      e.preventDefault();
    },
    [get01FromClientX, onChange01]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      const v01 = clamp(get01FromClientX(e.clientX), 0, 1);
      onCommit01?.(v01);
      e.preventDefault();
    },
    [get01FromClientX, onCommit01]
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/* ---------------- component ---------------- */

export default function AudioUploadPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const file = useTaskStore((s) => s.audioFile);
  const setAudioFile = useTaskStore((s) => s.setAudioFile);

  const { status, taskId, error, uploadAndStart, cancel } = useTaskStore();
  const resetTask = useTaskStore((s) => s.resetTask);

  const modelId = useTaskStore((s) => s.modelId);
  const setModelId = useTaskStore((s) => s.setModelId);
  const windowMs = useTaskStore((s) => s.windowMs);
  const setWindowMs = useTaskStore((s) => s.setWindowMs);

  const [windowMsInput, setWindowMsInput] = useState(String(windowMs));
  useEffect(() => setWindowMsInput(String(windowMs)), [windowMs]);

  const isBusy = !!taskId && (status === "queued" || status === "processing");

  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const [recOpen, setRecOpen] = useState(false);

  const [duration, setDuration] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);

  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);

  const durAbortRef = useRef<AbortController | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const volBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("indexedDB" in window)) return;
      if (file) return;

      try {
        const saved = await idbGet<PersistedAudio>(AUDIO_KEY);
        if (!alive || !saved) return;

        const restoredFile = new File([saved.buf], saved.name || "recording.webm", {
          type: saved.type || "audio/webm",
          lastModified: saved.lastModified || Date.now(),
        });

        setAudioFile(restoredFile);

        if (typeof saved.durationSec === "number" && saved.durationSec > 0) {
          setDuration(saved.durationSec);
          try {
            sessionStorage.setItem(`aud_dur:${fileKey(restoredFile)}`, String(saved.durationSec));
          } catch {}
        }
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [file, setAudioFile]);

  /* -------- create objectURL -------- */
  useEffect(() => {
    if (!file) {
      setAudioUrl(null);
      setDuration(null);
      setIsPlaying(false);
      setCurTime(0);
      return;
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* -------- persist file to IDB -------- */
  const persistFile = useCallback(async (f: File, durationSec: number | null) => {
    if (typeof window === "undefined") return;
    if (!("indexedDB" in window)) return;

    try {
      const buf = await f.arrayBuffer();
      const payload: PersistedAudio = {
        name: f.name || "recording.webm",
        type: f.type || "audio/webm",
        lastModified: f.lastModified || Date.now(),
        size: f.size,
        buf,
        durationSec,
      };
      await idbPut(AUDIO_KEY, payload);
    } catch {}
  }, []);

  const updatePersistedDuration = useCallback(async (f: File, durationSec: number) => {
    try {
      sessionStorage.setItem(`aud_dur:${fileKey(f)}`, String(durationSec));
    } catch {}

    if (typeof window === "undefined") return;
    if (!("indexedDB" in window)) return;

    try {
      const saved = await idbGet<PersistedAudio>(AUDIO_KEY);
      if (!saved) return;
      if (saved.name !== f.name || saved.size !== f.size || saved.lastModified !== f.lastModified) return;

      saved.durationSec = durationSec;
      await idbPut(AUDIO_KEY, saved);
    } catch {}
  }, []);

  /* -------- restore duration on remount -------- */
  useEffect(() => {
    if (!file) return;

    try {
      const raw = sessionStorage.getItem(`aud_dur:${fileKey(file)}`);
      const d = raw ? Number(raw) : NaN;
      if (isValidDuration(d)) {
        setDuration(d);
        return;
      }
    } catch {}

    (async () => {
      try {
        const saved = await idbGet<PersistedAudio>(AUDIO_KEY);
        if (!saved) return;
        if (saved.name !== file.name || saved.size !== file.size || saved.lastModified !== file.lastModified) return;
        if (typeof saved.durationSec === "number" && saved.durationSec > 0) {
          setDuration(saved.durationSec);
          try {
            sessionStorage.setItem(`aud_dur:${fileKey(file)}`, String(saved.durationSec));
          } catch {}
        }
      } catch {}
    })();
  }, [file]);

  /* -------- duration compute -------- */
  const startComputeDuration = useCallback(
    async (f: File) => {
      if (durAbortRef.current) durAbortRef.current.abort();
      const ac = new AbortController();
      durAbortRef.current = ac;

      setDuration(null);
      const d = await computeDurationSec(f, ac.signal);
      if (ac.signal.aborted) return;

      if (typeof d === "number" && d > 0) {
        setDuration(d);
        void updatePersistedDuration(f, d);
      } else {
        setDuration(-1);
      }
    },
    [updatePersistedDuration]
  );

  /* -------- audio events -------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onTime = () => setCurTime(a.currentTime || 0);

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTime);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTime);
    };
  }, [audioUrl]);

  /* -------- volume sync -------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = clamp(volume, 0, 1);
    a.muted = muted;
  }, [volume, muted, audioUrl]);

  const totalTime = useMemo(() => {
    if (typeof duration === "number" && duration > 0) return duration;
    const d = audioRef.current?.duration;
    return isValidDuration(d ?? NaN) ? (d as number) : 0;
  }, [duration, audioUrl]);

  const progress01 = totalTime > 0 ? clamp(curTime / totalTime, 0, 1) : 0;

  /* -------- синхронизация с WaveformPanel -------- */
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("em-audio-state", {
        detail: { progress01, isPlaying, curTime, totalTime },
      })
    );
  }, [progress01, isPlaying, curTime, totalTime]);

  useEffect(() => {
    const onExternalSeek = async (e: Event) => {
      const custom = e as CustomEvent<{ ratio?: number; autoPlay?: boolean }>;
      const ratio = custom.detail?.ratio;
      if (typeof ratio !== "number") return;

      const a = audioRef.current;
      if (!a) return;

      const maxT = totalTime > 0 ? totalTime : isValidDuration(a.duration) ? a.duration : 0;
      if (maxT <= 0) return;

      const nextTime = clamp(ratio, 0, 1) * maxT;
      a.currentTime = nextTime;
      setCurTime(nextTime);

      if (custom.detail?.autoPlay && a.paused) {
        try {
          await a.play();
        } catch {}
      }
    };

    window.addEventListener("em-audio-seek", onExternalSeek);
    return () => window.removeEventListener("em-audio-seek", onExternalSeek);
  }, [totalTime]);

  const remainingText = useMemo(() => {
    if (!(totalTime > 0)) return "";
    const left = Math.max(0, totalTime - curTime);
    return `${formatDuration(left)} осталось`;
  }, [totalTime, curTime]);

  const onPick = useCallback(
    (f: File | null) => {
      resetTask();
      setAudioFile(f);
      setDuration(null);
      setIsPlaying(false);
      setCurTime(0);

      if (inputRef.current) inputRef.current.value = "";

      if (f) {
        void persistFile(f, null);

        try {
          const raw = sessionStorage.getItem(`aud_dur:${fileKey(f)}`);
          const d = raw ? Number(raw) : NaN;
          if (isValidDuration(d)) setDuration(d);
        } catch {}

        void startComputeDuration(f);
      } else {
        if (durAbortRef.current) durAbortRef.current.abort();
      }
    },
    [resetTask, setAudioFile, persistFile, startComputeDuration]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();

      dragDepthRef.current = 0;
      setDragActive(false);

      const f = e.dataTransfer.files?.[0] ?? null;
      if (f) onPick(f);
    },
    [onPick]
  );

  const clearAll = useCallback(() => {
    setIsPlaying(false);
    setCurTime(0);
    setDuration(null);

    onPick(null);
    void idbDel(AUDIO_KEY);

    try {
      if (file) sessionStorage.removeItem(`aud_dur:${fileKey(file)}`);
    } catch {}
  }, [onPick, file]);

  const downloadAudio = useCallback(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || `audio-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [file]);

  const onStart = useCallback(() => {
    if (!file) return;
    uploadAndStart(file);
  }, [file, uploadAndStart]);

  const togglePlay = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      try {
        await a.play();
      } catch {}
    } else {
      a.pause();
    }
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const a = audioRef.current;
      if (!a) return;
      const maxT = totalTime > 0 ? totalTime : a.duration || 0;
      const next = clamp(t, 0, Math.max(0, maxT));
      a.currentTime = next;
      setCurTime(next);
    },
    [totalTime]
  );

  const seekDrag = useDragValue({
    get01FromClientX: (clientX) => {
      const el = seekBarRef.current;
      if (!el) return progress01;
      const r = el.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      return r.width ? x / r.width : progress01;
    },
    onChange01: (v01) => {
      if (!(totalTime > 0)) return;
      seekTo(v01 * totalTime);
    },
  });

  const volDrag = useDragValue({
    get01FromClientX: (clientX) => {
      const el = volBarRef.current;
      if (!el) return volume;
      const r = el.getBoundingClientRect();
      const x = clamp(clientX - r.left, 0, r.width);
      return r.width ? x / r.width : volume;
    },
    onChange01: (v01) => {
      const v = clamp(v01, 0, 1);
      setVolume(v);
      if (v > 0) setMuted(false);
    },
  });

  const onPlayerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!audioUrl) return;

      const k = e.key.toLowerCase();
      if (e.key === " " || k === "k") {
        e.preventDefault();
        void togglePlay();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(curTime - 5);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(curTime + 5);
      }
    },
    [audioUrl, togglePlay, seekTo, curTime]
  );

  const onStartComputeIfNeeded = useCallback(() => {
    if (!file) return;
    if (typeof duration === "number" && duration > 0) return;
    void startComputeDuration(file);
  }, [file, duration, startComputeDuration]);

  const MODEL_OPTIONS = useMemo(
    () => [
      { id: "base_like_vgg", label: "base_like_vgg" },
      { id: "base_like_vgg_v2", label: "base_like_vgg_v2" },
      { id: "opensmile_mfcc120", label: "opensmile_mfcc120" },
    ],
    []
  );

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  return (
    <>
      <RecordingOverlay
        open={recOpen}
        onClose={() => setRecOpen(false)}
        onRecorded={(f) => {
          setRecOpen(false);
          onPick(f);
        }}
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-slate-50/50 py-3.5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Источник и параметры</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Выберите аудиофайл или запишите голос с микрофона
              </p>
            </div>

            <Badge variant={isBusy ? "default" : statusTone(String(status || "ready"))} className="shrink-0">
              {isBusy ? "анализ…" : String(status || "ready")}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-5">
          {/* Компактный блок настроек */}
          <div className="rounded-xl bg-slate-100/70 p-3.5 border border-slate-200/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              <span>Параметры модели</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground/80">Архитектура</span>
                <select
                  className="h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium shadow-2xs outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/20"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  disabled={isBusy}
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground/80">Окно анализа (мс)</span>
                <input
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium tabular-nums shadow-2xs outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/20"
                  value={windowMsInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, "");
                    setWindowMsInput(raw);
                  }}
                  onBlur={() => {
                    const n = windowMsInput ? Number(windowMsInput) : NaN;
                    const next = Number.isFinite(n) ? clamp(Math.round(n), 500, 10000) : windowMs;
                    setWindowMs(next);
                    setWindowMsInput(String(next));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  inputMode="numeric"
                  disabled={isBusy}
                  placeholder="3000"
                />
              </label>
            </div>
          </div>

          {/* Зона загрузки файла */}
          <div
            className={[
              "rounded-xl border-2 border-dashed p-4 transition-all",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-slate-200 hover:border-slate-300 bg-slate-50/40",
            ].join(" ")}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200/80 shadow-2xs text-foreground">
                  {file ? <FileAudio2 className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {file ? "Аудиофайл готов" : "Перетащите аудио сюда"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {file ? "Можно заменить файл или записать заново" : "WAV, MP3, WebM, OGG"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="w-full bg-white"
              >
                <Upload className="h-3.5 w-3.5" />
                Выбрать файл
              </Button>

              <input
                ref={inputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRecOpen(true)}
                className="w-full bg-white"
              >
                <Mic className="h-3.5 w-3.5 text-red-500" />
                Записать
              </Button>
            </div>
          </div>

          {/* Карточка выбранного файла и двухрядный плеер */}
          {file ? (
            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate" title={file.name}>
                    {file.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                    <span>{formatBytes(file.size)}</span>
                    <span>•</span>
                    <span>{file.type || "audio"}</span>
                    <span>•</span>
                    <span
                      className="cursor-pointer hover:text-foreground"
                      onClick={onStartComputeIfNeeded}
                      title="Длительность"
                    >
                      {duration === null
                        ? "считаем…"
                        : duration === -1
                        ? "—"
                        : formatDuration(duration)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={downloadAudio}
                    title="Скачать исходник"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={clearAll}
                    title="Удалить файл"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {audioUrl ? (
                <div
                  className="rounded-xl bg-slate-50/90 p-3.5 border border-slate-200/70 space-y-3 focus:outline-none focus:ring-2 focus:ring-ring/40"
                  tabIndex={0}
                  onKeyDown={onPlayerKeyDown}
                >
                  <audio
                    ref={audioRef}
                    className="hidden"
                    src={audioUrl}
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration;
                      if (isValidDuration(d)) {
                        setDuration(d);
                        void updatePersistedDuration(file, d);
                      }
                    }}
                    onDurationChange={(e) => {
                      const d = e.currentTarget.duration;
                      if (isValidDuration(d)) {
                        setDuration(d);
                        void updatePersistedDuration(file, d);
                      }
                    }}
                  />

                  {/* Верхний ряд: Play + Таймер слева, Громкость справа */}
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      size="icon"
                      variant="default"
                      onClick={togglePlay}
                      className="h-9 w-9 rounded-full shrink-0 shadow-xs"
                      title={isPlaying ? "Пауза (Space)" : "Воспроизвести (Space)"}
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                    </Button>

                    <div className="flex items-center gap-2 text-xs tabular-nums">
                      <span className="font-semibold text-foreground">{formatDuration(curTime)}</span>
                      <span className="text-muted-foreground">
                        / {duration === null ? "…" : duration === -1 ? "—" : formatDuration(duration)}
                      </span>
                      {isPlaying ? (
                        <span className="inline-flex items-end gap-0.5 h-3 ml-0.5">
                          <span className="w-0.5 h-full bg-sky-500 rounded-full origin-bottom animate-eq-1" />
                          <span className="w-0.5 h-full bg-sky-500 rounded-full origin-bottom animate-eq-2" />
                          <span className="w-0.5 h-full bg-sky-500 rounded-full origin-bottom animate-eq-3" />
                        </span>
                      ) : null}
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setMuted((m) => !m)}
                        title={muted ? "Включить звук" : "Выключить звук"}
                      >
                        {muted || volume <= 0.001 ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </Button>

                      <div
                        ref={volBarRef}
                        className="relative h-1.5 w-20 rounded-full bg-slate-200 cursor-pointer"
                        {...volDrag}
                        role="slider"
                        aria-label="Volume"
                        aria-valuemin={0}
                        aria-valuemax={1}
                        aria-valuenow={muted ? 0 : volume}
                      >
                        <div
                          className="absolute left-0 top-0 h-1.5 rounded-full bg-slate-600"
                          style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                        />
                        <div
                          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white border border-slate-400 shadow-2xs"
                          style={{ left: `calc(${(muted ? 0 : volume) * 100}% - 7px)` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Нижний ряд: Полноширинная полоса перемотки */}
                  <div className="space-y-1.5">
                    <div
                      ref={seekBarRef}
                      className="relative h-2.5 w-full rounded-full bg-slate-200/90 cursor-pointer"
                      {...seekDrag}
                      role="slider"
                      aria-label="Seek"
                      aria-valuemin={0}
                      aria-valuemax={totalTime || 0}
                      aria-valuenow={curTime}
                    >
                      <div
                        className="absolute left-0 top-0 h-2.5 rounded-full bg-primary"
                        style={{ width: `${progress01 * 100}%` }}
                      />
                      <div
                        className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white border-2 border-primary shadow-sm"
                        style={{ left: `calc(${progress01 * 100}% - 8px)` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                      <span>{isPlaying ? "воспроизведение" : "пауза (клик по волне = старт)"}</span>
                      <span>{remainingText || formatDuration(totalTime)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Кнопка отправки */}
          {!isBusy ? (
            <Button
              className="group relative w-full h-10 gap-2 overflow-hidden shadow-sm transition-all hover:shadow-md"
              onClick={onStart}
              disabled={!file}
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Sparkles className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
              <span>Отправить на обработку</span>
            </Button>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button className="w-full h-10 gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Выполняется анализ…
              </Button>
              <Button variant="outline" className="h-10" onClick={cancel}>
                Отменить
              </Button>
            </div>
          )}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}