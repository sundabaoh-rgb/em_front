"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTaskStore } from "@/store/taskStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RecordingOverlay from "@/components/upload/RecordingOverlay";
import { Separator } from "@/components/ui/separator";
import { Mic, Upload, FileAudio2, X, Download, Play, Pause, Volume2, VolumeX, Settings2 } from "lucide-react";

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
  } catch {
  }

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
      } catch {
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

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
    } catch {
    }
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
    } catch {
    }
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

  // drag handlers
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

      <Card className="rounded-3xl border bg-background shadow-sm overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Аудио</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">Загрузка/запись → настрой параметры → отправь на обработку.</div>
            </div>

            <Badge variant={isBusy ? "secondary" : statusTone(String(status || "ready"))} className="shrink-0">
              {isBusy ? "обработка…" : String(status || "ready")}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-5 space-y-4">
          {/* Settings */}
          <div className="rounded-2xl border bg-background p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border bg-muted/30">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Параметры обработки</div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Модель</span>
                <select
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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

              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Окно анализа (ms)</span>

                <input
                  className="h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  value={windowMsInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, "");
                    setWindowMsInput(raw);
                  }}
                  onBlur={() => {
                    const n = windowMsInput ? Number(windowMsInput) : NaN;
                    const next = Number.isFinite(n) ? clamp(Math.round(n), 5, 200) : windowMs;
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
                  placeholder="20–40"
                />
              </label>

            </div>
          </div>

          {/* Dropzone */}
          <div
            className={[
              "rounded-2xl border border-dashed transition overflow-hidden",
              dragActive ? "border-foreground/50 bg-muted/40" : "border-muted-foreground/25 bg-muted/20",
            ].join(" ")}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 rounded-2xl border bg-background p-2 shrink-0">
                    {file ? <FileAudio2 className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{file ? "Файл выбран" : "Перетащи аудио сюда"}</div>
                    <div className="text-xs text-muted-foreground">
                      {file ? "Можно заменить файл или записать новый." : "или выбери файл кнопкой ниже / запиши микрофон."}
                    </div>
                  </div>
                </div>

                <Badge variant="outline" className="hidden sm:inline shrink-0">
                  drag & drop
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => inputRef.current?.click()} className="gap-2">
                  <Upload className="h-4 w-4" />
                  Выбрать файл
                </Button>

                <input
                  ref={inputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />

                <Button variant="outline" onClick={() => setRecOpen(true)} className="gap-2">
                  <Mic className="h-4 w-4" />
                  Запись
                </Button>
              </div>

              <div className="mt-4">
                {dragActive && !file ? (
                  <div className="rounded-2xl border bg-background/60 p-3 text-sm">
                    <span className="font-medium">Отпусти файл</span>{" "}
                    <span className="text-muted-foreground">— выберем его для отправки.</span>
                  </div>
                ) : file ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="max-w-full truncate">
                        {file.name}
                      </Badge>
                      <Badge variant="outline">{formatBytes(file.size)}</Badge>
                      <Badge variant="outline">{file.type || "audio"}</Badge>

                      <Badge variant="outline">
                        ⏱{" "}
                        {duration === null ? (
                          <span className="cursor-pointer" onClick={onStartComputeIfNeeded} title="Нажми, чтобы пересчитать">
                            считаем…
                          </span>
                        ) : duration === -1 ? (
                          "неизвестно"
                        ) : (
                          formatDuration(duration)
                        )}
                      </Badge>

                      <div className="ml-auto flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={clearAll} title="Убрать">
                          <X className="h-4 w-4" />
                        </Button>

                        <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={downloadAudio} title="Скачать">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {audioUrl ? (
                      <div
                        className={["rounded-2xl border bg-background shadow-sm", "px-4 py-3", "focus:outline-none focus:ring-2 focus:ring-ring/50"].join(" ")}
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

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            onClick={togglePlay}
                            className="h-10 w-10 rounded-full shrink-0"
                            title={isPlaying ? "Пауза (Space)" : "Пуск (Space)"}
                          >
                            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                          </Button>

                          <div className="shrink-0 text-sm tabular-nums">
                            <span className="font-medium">{formatDuration(curTime)}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {duration === null ? "…" : duration === -1 ? "—" : formatDuration(duration)}
                            </span>
                          </div>

                          <div className="ml-auto flex items-center gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground"
                              onClick={() => setMuted((m) => !m)}
                              title={muted ? "Включить звук" : "Выключить звук"}
                            >
                              {muted || volume <= 0.001 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                            </Button>

                            <div className="hidden sm:flex items-center">
                              <div
                                ref={volBarRef}
                                className="relative h-2 w-28 rounded-full bg-muted/60 cursor-pointer"
                                {...volDrag}
                                role="slider"
                                aria-label="Volume"
                                aria-valuemin={0}
                                aria-valuemax={1}
                                aria-valuenow={muted ? 0 : volume}
                              >
                                <div className="absolute left-0 top-0 h-2 rounded-full bg-foreground/60" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
                                <div
                                  className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background shadow ring-1 ring-border"
                                  style={{ left: `calc(${(muted ? 0 : volume) * 100}% - 8px)` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="truncate">{isPlaying ? "воспроизведение" : "пауза"}</span>
                            <span className="tabular-nums">{remainingText}</span>
                          </div>

                          <div
                            ref={seekBarRef}
                            className="mt-2 relative h-3 rounded-full bg-muted/60 cursor-pointer"
                            {...seekDrag}
                            role="slider"
                            aria-label="Seek"
                            aria-valuemin={0}
                            aria-valuemax={totalTime || 0}
                            aria-valuenow={curTime}
                          >
                            <div className="absolute left-0 top-0 h-3 rounded-full bg-primary" style={{ width: `${progress01 * 100}%` }} />
                            <div
                              className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-background shadow-md ring-1 ring-border"
                              style={{ left: `calc(${progress01 * 100}% - 10px)` }}
                            />
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                            <span>← 5s / → 5s</span>
                            <span>{formatDuration(totalTime)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Готовим плеер…</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Поддерживаются любые аудио форматы браузера. После выбора появится плеер.</div>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {!isBusy ? (
            <Button className="w-full" onClick={onStart} disabled={!file}>
              Отправить на обработку
            </Button>
          ) : (
            <div className="grid gap-2">
              <Button className="w-full" disabled>
                Обработка…
              </Button>
              <Button className="w-full" variant="secondary" onClick={cancel}>
                Отменить
              </Button>
            </div>
          )}

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        </CardContent>
      </Card>
    </>
  );
}