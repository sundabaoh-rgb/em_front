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

  // file
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
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

  const json = (await res.json().catch(() => null)) as { taskId?: string } | null;
  if (!json?.taskId) throw new Error("Upload failed: bad response");
  return { taskId: json.taskId };
}

async function apiTask(taskId: string, signal?: AbortSignal): Promise<TaskApiResponse> {
  const res = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`Task fetch failed: ${res.status}`);
  return (await res.json()) as TaskApiResponse;
}

export const useTaskStore = create<State>((set, get) => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let pollId = 0;
  let abort: AbortController | null = null;

  const stopPolling = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (abort) {
      abort.abort();
      abort = null;
    }
  };

  const saved = readSettings();
  const initialModelId = typeof saved.modelId === "string" && saved.modelId.trim() ? saved.modelId : "base_like_vgg";
  const initialWindowMs =
    typeof saved.windowMs === "number" && Number.isFinite(saved.windowMs)
      ? Math.max(5, Math.min(200, Math.round(saved.windowMs)))
      : 25;

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
      stopPolling();
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
      stopPolling();
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
      stopPolling();
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
      stopPolling();
      set({
        status: "idle",
        taskId: null,
        progress: undefined,
        error: null,
      });
    },

    uploadAndStart: async (file: File) => {
      if (!file) return;

      get().resetTask();

      pollId += 1;
      const myPollId = pollId;

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

      if (abort) abort.abort();
      abort = new AbortController();

      try {
        const { taskId } = await apiUpload(file, runModelId, runWindowMs, abort.signal);
        if (myPollId !== pollId) return;

        set({ taskId, status: "queued" });
        get().pollTask(taskId);
      } catch (e: any) {
        if (myPollId !== pollId) return;
        const msg = e?.name === "AbortError" ? "Upload cancelled" : e?.message ?? "Upload error";
        set({ status: "error", error: msg });
      }
    },

    pollTask: (taskId: string) => {
      if (!taskId) return;

      stopPolling();

      pollId += 1;
      const myPollId = pollId;

      const tick = async () => {
        if (myPollId !== pollId) return;

        if (abort) abort.abort();
        abort = new AbortController();

        try {
          const data = await apiTask(taskId, abort.signal);
          if (myPollId !== pollId) return;

          if (data.status === "queued" || data.status === "processing") {
            set({
              status: data.status,
              progress: typeof data.progress === "number" ? data.progress : get().progress,
              error: null,
            });
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
          if (myPollId !== pollId) return;

          stopPolling();
          const msg = e?.name === "AbortError" ? "Polling cancelled" : e?.message ?? "Polling error";
          set({ status: "error", error: msg });
        }
      };

      tick();
      timer = setInterval(tick, 800);
    },
  };
});
