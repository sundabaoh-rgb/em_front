"use client";

import { create } from "zustand";

export type TaskStatus = "idle" | "queued" | "processing" | "done" | "error";

export type Segment = {
  label: string;
  startFrame: number;
  endFrame: number;
};

export type SpectrogramWire = {
  type?: string;
  frames: number;
  melBins: number;
  hopLength?: number;
  minDb?: number;
  maxDb?: number;
  format: "uint8";
  data: string;
};

export type Spectrogram = {
  frames: number;
  melBins: number;
  mel: Uint8Array;
};

export type FeaturesTable = {
  columns: string[];
  rows: { name: string; values: (number | string)[] }[];
};

export type TaskProgressResponse = {
  status: "queued" | "processing";
  progress?: number;
};

export type TaskDoneResponse = {
  status: "done";
  progress?: number;
  summary?: { mainEmotion?: string };
  segments?: Segment[];
  features?: FeaturesTable;
  spectrogram?: SpectrogramWire;
};

export type TaskErrorResponse = {
  status: "error";
  error: string;
};

export type TaskApiResponse = TaskProgressResponse | TaskDoneResponse | TaskErrorResponse;

type State = {
  status: TaskStatus;
  taskId: string | null;
  progress?: number;
  error: string | null;

  spectrogram: Spectrogram | null;
  segments: Segment[];
  features: FeaturesTable | null;
  mainEmotion: string | null;

  modelId: string;
  setModelId: (v: string) => void;

  windowMs: number;
  setWindowMs: (v: number) => void;

  runModelId: string | null;
  runWindowMs: number | null;

  audioFile: File | null;
  setAudioFile: (f: File | null) => void;

  uploadAndStart: (file: File) => Promise<void>;
  pollTask: (taskId: string) => void;

  resetTask: () => void;
  clearAudio: () => void;
  cancel: () => void;
  reset: () => void;
};

function b64ToU8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  // поддержим и urlsafe, и обычный base64
  let norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4;
  if (pad) norm += "=".repeat(4 - pad);

  const bin = atob(norm);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const LS_KEY = "taskSettings:v1";
function readSettings(): { modelId?: string; windowMs?: number } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw);
    return typeof j === "object" && j ? j : {};
  } catch {
    return {};
  }
}
function writeSettings(next: { modelId: string; windowMs: number }) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

async function apiUpload(
  file: File,
  modelId: string,
  windowMs: number,
  signal?: AbortSignal
): Promise<{ taskId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", modelId);
  fd.append("window_ms", String(windowMs));

  const res = await fetch("/api/upload", { method: "POST", body: fd, signal });
  const json = (await res.json().catch(() => null)) as { taskId?: string; error?: string } | null;

  if (!res.ok) throw new Error(json?.error || `Upload failed: ${res.status}`);
  if (!json?.taskId) throw new Error("Upload failed: bad response");

  return { taskId: json.taskId };
}

async function apiTask(taskId: string, signal?: AbortSignal): Promise<TaskApiResponse> {
  const res = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });

  // важно: при 502/500 тоже попробуем прочитать json с error
  const json = (await res.json().catch(() => null)) as any;

  if (!res.ok) {
    const msg = json?.error ? String(json.error) : `Task fetch failed: ${res.status}`;
    throw new Error(msg);
  }

  if (!json || typeof json !== "object") throw new Error("Task fetch failed: bad json");
  return json as TaskApiResponse;
}

export const useTaskStore = create<State>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  // общий “epoch” чтобы отсеивать старые async-ответы
  let pollEpoch = 0;

  // aborters
  let uploadAbort: AbortController | null = null;
  let pollAbort: AbortController | null = null;

  // защита от параллельных тиков
  let inFlight = false;

  const stopPolling = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (pollAbort) {
      pollAbort.abort();
      pollAbort = null;
    }
    inFlight = false;
  };

  const cancelUpload = () => {
    if (uploadAbort) {
      uploadAbort.abort();
      uploadAbort = null;
    }
  };

  const saved = readSettings();
  const initialModelId =
    typeof saved.modelId === "string" && saved.modelId.trim() ? saved.modelId : "base_like_vgg";
  const initialWindowMs =
    typeof saved.windowMs === "number" && Number.isFinite(saved.windowMs)
      ? Math.max(5, Math.min(200, Math.round(saved.windowMs)))
      : 25;

  const scheduleNext = (fn: () => void, ms: number) => {
    pollTimer = setTimeout(fn, ms);
  };

  return {
    status: "idle",
    taskId: null,
    progress: undefined,
    error: null,

    spectrogram: null,
    segments: [],
    features: null,
    mainEmotion: null,

    audioFile: null,

    modelId: initialModelId,
    setModelId: (v) => {
      const next = (v || "").trim() || "base_like_vgg";
      set({ modelId: next });
      writeSettings({ modelId: next, windowMs: get().windowMs });
    },

    windowMs: initialWindowMs,
    setWindowMs: (v) => {
      const n = Math.max(5, Math.min(200, Math.round(Number(v) || 0)));
      set({ windowMs: n });
      writeSettings({ modelId: get().modelId, windowMs: n });
    },

    runModelId: null,
    runWindowMs: null,

    setAudioFile: (f) => set({ audioFile: f }),

    resetTask: () => {
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({
        status: "idle",
        taskId: null,
        progress: undefined,
        error: null,
        spectrogram: null,
        segments: [],
        features: null,
        mainEmotion: null,
        runModelId: null,
        runWindowMs: null,
      });
    },

    clearAudio: () => {
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({
        audioFile: null,
        status: "idle",
        taskId: null,
        progress: undefined,
        error: null,
        spectrogram: null,
        segments: [],
        features: null,
        mainEmotion: null,
        runModelId: null,
        runWindowMs: null,
      });
    },

    reset: () => {
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({
        status: "idle",
        taskId: null,
        progress: undefined,
        error: null,
        spectrogram: null,
        segments: [],
        features: null,
        mainEmotion: null,
        audioFile: null,
        runModelId: null,
        runWindowMs: null,
      });
    },

    cancel: () => {
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({
        status: "idle",
        taskId: null,
        progress: undefined,
        error: null,
      });
    },

    uploadAndStart: async (file: File) => {
      if (!file) return;

      // новый прогон
      get().resetTask();

      const myEpoch = pollEpoch;

      const { modelId, windowMs } = get();
      const runModelId = modelId;
      const runWindowMs = windowMs;

      set({
        status: "queued",
        error: null,
        progress: 0,
        runModelId,
        runWindowMs,
      });

      cancelUpload();
      uploadAbort = new AbortController();

      try {
        const { taskId } = await apiUpload(file, runModelId, runWindowMs, uploadAbort.signal);
        if (myEpoch !== pollEpoch) return;

        set({ taskId, status: "queued" });
        get().pollTask(taskId);
      } catch (e: any) {
        if (myEpoch !== pollEpoch) return;
        const isAbort = e?.name === "AbortError";
        set({ status: "error", error: isAbort ? "Upload cancelled" : e?.message ?? "Upload error" });
      }
    },

    pollTask: (taskId: string) => {
      if (!taskId) return;

      // новый epoch для поллинга
      pollEpoch += 1;
      const myEpoch = pollEpoch;

      stopPolling();

      // один abort на всю сессию поллинга (только cancel/reset его убивает)
      pollAbort = new AbortController();

      const tick = async () => {
        if (myEpoch !== pollEpoch) return;
        if (inFlight) {
          scheduleNext(tick, 500);
          return;
        }

        inFlight = true;
        try {
          const data = await apiTask(taskId, pollAbort?.signal);
          if (myEpoch !== pollEpoch) return;

          if (data.status === "queued" || data.status === "processing") {
            set({
              status: data.status,
              progress: typeof data.progress === "number" ? data.progress : get().progress,
              error: null,
            });
            inFlight = false;
            scheduleNext(tick, 800);
            return;
          }

          if (data.status === "error") {
            stopPolling();
            set({ status: "error", error: data.error ?? "Task error" });
            return;
          }

          if (data.status === "done") {
            stopPolling();

            let spec: Spectrogram | null = null;
            const w = data.spectrogram;

            if (w?.format === "uint8" && typeof w.data === "string") {
              const mel = b64ToU8(w.data);
              const expected = w.frames * w.melBins;

              if (mel.length === expected) {
                spec = { frames: w.frames, melBins: w.melBins, mel };
              } else {
                // это уже НЕ про поллинг — это реально плохой payload
                set({
                  status: "error",
                  error: `Bad spectrogram payload: expected ${expected} bytes, got ${mel.length}`,
                });
                return;
              }
            }

            set({
              status: "done",
              progress: typeof data.progress === "number" ? data.progress : 1,
              mainEmotion: data.summary?.mainEmotion ?? null,
              segments: data.segments ?? [],
              features: data.features ?? null,
              spectrogram: spec,
              error: null,
            });
          }
        } catch (e: any) {
          if (myEpoch !== pollEpoch) return;

          const isAbort = e?.name === "AbortError";
          // AbortError = мы сами отменили (cancel/reset). Это НЕ ошибка UI.
          if (isAbort) {
            inFlight = false;
            return;
          }

          stopPolling();
          set({ status: "error", error: e?.message ?? "Polling error" });
        } finally {
          inFlight = false;
        }
      };

      // первый тик сразу
      tick();
    },
  };
});
