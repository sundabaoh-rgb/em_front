"use client";

import { create } from "zustand";

/* =========================
   Types
========================= */

export type TaskStatus = "idle" | "queued" | "processing" | "done" | "error";

export type Segment = {
  label: string;
  startFrame: number;
  endFrame: number;
  confidence?: number;
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

export type FeaturesFile = {
  type: "csv";
  url: string;
  filename?: string;
  sizeBytes?: number;
  expiresAt?: string;
};

export type FeaturesCache = {
  url: string;
  filename: string;
  sizeBytes?: number;
  mime: string;
  fetchedAt: number;
  blob: Blob;
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
  spectrogram?: SpectrogramWire;
  featuresFile?: FeaturesFile;
};

export type TaskErrorResponse = {
  status: "error";
  error: string;
};

export type TaskApiResponse = TaskProgressResponse | TaskDoneResponse | TaskErrorResponse;

/* =========================
   Store State
========================= */

type State = {
  status: TaskStatus;
  taskId: string | null;
  progress?: number;
  error: string | null;

  spectrogram: Spectrogram | null;
  segments: Segment[];
  mainEmotion: string | null;

  featuresFile: FeaturesFile | null;
  featuresCache: FeaturesCache | null;
  featuresCacheError: string | null;

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

  prefetchFeatures: () => Promise<void>;
  downloadFeatures: () => Promise<void>;

  resetTask: () => void;
  clearAudio: () => void;
  cancel: () => void;
  reset: () => void;
};

/* =========================
   Utils
========================= */

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

function safeApiPath(url: string): string {
  if (!url || typeof url !== "string") throw new Error("Empty features url");
  if (!url.startsWith("/api/")) throw new Error("Unsafe features url");
  if (url.includes("..")) throw new Error("Unsafe features url");
  if (/[^\x21-\x7E]/.test(url)) throw new Error("Unsafe features url");
  return url;
}

function safeFilename(name?: string, fallback = "features.csv"): string {
  if (!name || typeof name !== "string") return fallback;
  const base = name.split(/[\\/]/).pop() ?? fallback;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200);
  if (!cleaned) return fallback;
  if (!cleaned.toLowerCase().endsWith(".csv")) return `${cleaned}.csv`;
  return cleaned;
}

const MAX_FEATURES_BYTES = 25 * 1024 * 1024;

function triggerBrowserDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);

  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/* =========================
   LocalStorage settings
========================= */

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

/* =========================
   IndexedDB Task Persistence
========================= */

const TASK_DB_NAME = "front-emotion-task-db";
const TASK_DB_VERSION = 1;
const TASK_STORE_NAME = "task-store";
const TASK_STATE_KEY = "active-task-v1";

type PersistedTaskSnapshot = {
  status: TaskStatus;
  taskId: string | null;
  progress?: number;
  error: string | null;
  spectrogram: {
    frames: number;
    melBins: number;
    mel: Uint8Array;
  } | null;
  segments: Segment[];
  mainEmotion: string | null;
  featuresFile: FeaturesFile | null;
  featuresCache: FeaturesCache | null;
  runModelId: string | null;
  runWindowMs: number | null;
  audioMeta: {
    name: string;
    type: string;
    lastModified: number;
    blob: Blob;
  } | null;
};

function openTaskDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TASK_DB_NAME, TASK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TASK_STORE_NAME)) {
        db.createObjectStore(TASK_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadTaskSnapshot(): Promise<PersistedTaskSnapshot | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  const db = await openTaskDb();
  try {
    return await new Promise<PersistedTaskSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(TASK_STORE_NAME, "readonly");
      const st = tx.objectStore(TASK_STORE_NAME);
      const req = st.get(TASK_STATE_KEY);
      req.onsuccess = () => resolve((req.result as PersistedTaskSnapshot) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function saveTaskSnapshot(s: State): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;

  const audioMeta = s.audioFile
    ? {
        name: s.audioFile.name || "audio.webm",
        type: s.audioFile.type || "audio/webm",
        lastModified: s.audioFile.lastModified || Date.now(),
        blob: new Blob([s.audioFile], { type: s.audioFile.type || "audio/webm" }),
      }
    : null;

  const snapshot: PersistedTaskSnapshot = {
    status: s.status,
    taskId: s.taskId,
    progress: s.progress,
    error: s.error,
    spectrogram: s.spectrogram
      ? {
          frames: s.spectrogram.frames,
          melBins: s.spectrogram.melBins,
          mel: new Uint8Array(s.spectrogram.mel),
        }
      : null,
    segments: s.segments ?? [],
    mainEmotion: s.mainEmotion ?? null,
    featuresFile: s.featuresFile ?? null,
    featuresCache: s.featuresCache ?? null,
    runModelId: s.runModelId ?? null,
    runWindowMs: s.runWindowMs ?? null,
    audioMeta,
  };

  const db = await openTaskDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TASK_STORE_NAME, "readwrite");
      const st = tx.objectStore(TASK_STORE_NAME);
      const req = st.put(snapshot, TASK_STATE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function clearLegacyAudioIdb(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    const req = indexedDB.open("front-emotion", 1);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (db.objectStoreNames.contains("audio")) {
          const tx = db.transaction("audio", "readwrite");
          tx.objectStore("audio").delete("last-audio-v1");
        }
      } catch {}
      db.close();
    };
  } catch {}
}

/* =========================
   API calls
========================= */

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

  const json = (await res.json().catch(() => null)) as any;

  if (!res.ok) {
    const msg = json?.error ? String(json.error) : `Task fetch failed: ${res.status}`;
    throw new Error(msg);
  }

  if (!json || typeof json !== "object") throw new Error("Task fetch failed: bad json");
  return json as TaskApiResponse;
}

/* =========================
   Store
========================= */

export const useTaskStore = create<State>((set, get) => {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollEpoch = 0;

  let uploadAbort: AbortController | null = null;
  let pollAbort: AbortController | null = null;
  let featuresAbort: AbortController | null = null;

  let inFlight = false;
  let isHydrated = false;
  let userMutatedBeforeHydration = false;

  const cancelUpload = () => {
    if (uploadAbort) {
      uploadAbort.abort();
      uploadAbort = null;
    }
  };

  const cancelFeaturesPrefetch = () => {
    if (featuresAbort) {
      featuresAbort.abort();
      featuresAbort = null;
    }
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (pollAbort) {
      pollAbort.abort();
      pollAbort = null;
    }
    cancelFeaturesPrefetch();
    inFlight = false;
  };

  const saved = readSettings();
  const initialModelId =
    typeof saved.modelId === "string" && saved.modelId.trim() ? saved.modelId : "base_like_vgg";
  const initialWindowMs =
    typeof saved.windowMs === "number" && Number.isFinite(saved.windowMs)
      ? Math.max(5, Math.min(20000, Math.round(saved.windowMs)))
      : 3000;

  const scheduleNext = (fn: () => void, ms: number) => {
    pollTimer = setTimeout(fn, ms);
  };

  const hardResetState = (): Partial<State> => ({
    status: "idle",
    taskId: null,
    progress: undefined,
    error: null,
    spectrogram: null,
    segments: [],
    mainEmotion: null,
    featuresFile: null,
    featuresCache: null,
    featuresCacheError: null,
    runModelId: null,
    runWindowMs: null,
  });

  async function prefetchFeaturesImpl(myEpoch: number): Promise<void> {
    if (myEpoch !== pollEpoch) return;

    const ff = get().featuresFile;
    if (!ff?.url) return;

    const url = safeApiPath(ff.url);
    const filename = safeFilename(ff.filename, "features.csv");

    const cached = get().featuresCache;
    if (cached?.url === url && cached.blob && cached.blob.size > 0) {
      set({ featuresCacheError: null });
      return;
    }

    cancelFeaturesPrefetch();
    featuresAbort = new AbortController();

    set({ featuresCacheError: null });

    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/csv" },
      signal: featuresAbort.signal,
      cache: "no-store",
    });

    if (myEpoch !== pollEpoch) return;

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`CSV prefetch failed: ${res.status} ${msg || res.statusText}`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) {
      const text = await res.text().catch(() => "");
      throw new Error(`CSV prefetch got HTML (unexpected): ${text.slice(0, 200)}`);
    }

    const lenHeader = res.headers.get("content-length");
    const len = lenHeader ? Number(lenHeader) : NaN;
    if (Number.isFinite(len) && len > MAX_FEATURES_BYTES) {
      throw new Error(`CSV too large (${len} bytes). Limit is ${MAX_FEATURES_BYTES} bytes.`);
    }

    const blob = await res.blob();

    if (blob.size > MAX_FEATURES_BYTES) {
      throw new Error(`CSV too large (${blob.size} bytes). Limit is ${MAX_FEATURES_BYTES} bytes.`);
    }

    if (myEpoch !== pollEpoch) return;

    set({
      featuresCache: {
        url,
        filename,
        sizeBytes: ff.sizeBytes,
        mime: res.headers.get("content-type") || "text/csv",
        fetchedAt: Date.now(),
        blob,
      },
      featuresCacheError: null,
    });
  }

  // Восстановление состояния после F5
  if (typeof window !== "undefined") {
    loadTaskSnapshot()
      .then((snap) => {
        isHydrated = true;
        if (!snap || userMutatedBeforeHydration) return;

        let restoredAudio: File | null = get().audioFile;
        if (!restoredAudio && snap.audioMeta?.blob) {
          restoredAudio = new File([snap.audioMeta.blob], snap.audioMeta.name || "audio.webm", {
            type: snap.audioMeta.type || "audio/webm",
            lastModified: snap.audioMeta.lastModified || Date.now(),
          });
        }

        const restoredSpec: Spectrogram | null = snap.spectrogram
          ? {
              frames: snap.spectrogram.frames,
              melBins: snap.spectrogram.melBins,
              mel:
                snap.spectrogram.mel instanceof Uint8Array
                  ? snap.spectrogram.mel
                  : new Uint8Array(snap.spectrogram.mel),
            }
          : null;

        set({
          status: snap.status ?? "idle",
          taskId: snap.taskId ?? null,
          progress: snap.progress,
          error: snap.error ?? null,
          spectrogram: restoredSpec,
          segments: Array.isArray(snap.segments) ? snap.segments : [],
          mainEmotion: snap.mainEmotion ?? null,
          featuresFile: snap.featuresFile ?? null,
          featuresCache: snap.featuresCache ?? null,
          featuresCacheError: null,
          runModelId: snap.runModelId ?? null,
          runWindowMs: snap.runWindowMs ?? null,
          audioFile: restoredAudio,
        });

        // Если страницу обновили во время анализа — продолжаем опрос задачи
        if (snap.taskId && (snap.status === "queued" || snap.status === "processing")) {
          get().pollTask(snap.taskId);
        } else if (snap.status === "done" && snap.featuresFile?.url && !snap.featuresCache?.blob) {
          get().prefetchFeatures().catch(() => {});
        }
      })
      .catch(() => {
        isHydrated = true;
      });
  }

  return {
    status: "idle",
    taskId: null,
    progress: undefined,
    error: null,

    spectrogram: null,
    segments: [],
    mainEmotion: null,

    featuresFile: null,
    featuresCache: null,
    featuresCacheError: null,

    audioFile: null,

    modelId: initialModelId,
    setModelId: (v) => {
      const next = (v || "").trim() || "base_like_vgg";
      set({ modelId: next });
      writeSettings({ modelId: next, windowMs: get().windowMs });
    },

    windowMs: initialWindowMs,
    setWindowMs: (v) => {
      const n = Math.max(5, Math.min(20000, Math.round(Number(v) || 0)));
      set({ windowMs: n });
      writeSettings({ modelId: get().modelId, windowMs: n });
    },

    runModelId: null,
    runWindowMs: null,

    setAudioFile: (f) => set({ audioFile: f }),

    resetTask: () => {
      userMutatedBeforeHydration = true;
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set(hardResetState());
    },

    clearAudio: () => {
      userMutatedBeforeHydration = true;
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({ ...hardResetState(), audioFile: null });
      void clearLegacyAudioIdb();
    },

    reset: () => {
      userMutatedBeforeHydration = true;
      pollEpoch += 1;
      stopPolling();
      cancelUpload();
      set({ ...hardResetState(), audioFile: null });
      void clearLegacyAudioIdb();
    },

    cancel: () => {
      userMutatedBeforeHydration = true;
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

      userMutatedBeforeHydration = true;
      get().resetTask();

      const myEpoch = pollEpoch;

      const { modelId, windowMs } = get();
      const runModelId = modelId;
      const runWindowMs = windowMs;

      set({
        audioFile: file,
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

      pollEpoch += 1;
      const myEpoch = pollEpoch;

      stopPolling();

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
            const done = data;

            stopPolling();

            let spec: Spectrogram | null = null;
            const w = done.spectrogram;

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
              progress: typeof done.progress === "number" ? done.progress : 1,
              mainEmotion: done.summary?.mainEmotion ?? null,
              segments: done.segments ?? [],
              spectrogram: spec,
              featuresFile: done.featuresFile ?? null,
              featuresCache: null,
              featuresCacheError: null,
              error: null,
            });

            if (done.featuresFile?.url) {
              prefetchFeaturesImpl(myEpoch).catch((e: any) => {
                if (myEpoch !== pollEpoch) return;
                const isAbort = e?.name === "AbortError";
                if (isAbort) return;
                set({ featuresCacheError: e?.message ?? "CSV prefetch error" });
              });
            }

            return;
          }

          stopPolling();
          set({ status: "error", error: "Task fetch failed: unknown status" });
        } catch (e: any) {
          if (myEpoch !== pollEpoch) return;

          const isAbort = e?.name === "AbortError";
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

      tick();
    },

    prefetchFeatures: async () => {
      const myEpoch = pollEpoch;
      try {
        await prefetchFeaturesImpl(myEpoch);
      } catch (e: any) {
        if (myEpoch !== pollEpoch) return;
        const isAbort = e?.name === "AbortError";
        if (isAbort) return;
        set({ featuresCacheError: e?.message ?? "CSV prefetch error" });
        throw e;
      }
    },

    downloadFeatures: async () => {
      const ff = get().featuresFile;
      if (!ff?.url) throw new Error("No features file available");

      const url = safeApiPath(ff.url);
      const filename = safeFilename(ff.filename, "features.csv");

      const cached = get().featuresCache;
      if (cached?.url === url && cached.blob && cached.blob.size > 0) {
        triggerBrowserDownload(cached.blob, cached.filename || filename);
        return;
      }

      const myEpoch = pollEpoch;
      await prefetchFeaturesImpl(myEpoch);
      const cached2 = get().featuresCache;
      if (cached2?.url === url && cached2.blob && cached2.blob.size > 0) {
        triggerBrowserDownload(cached2.blob, cached2.filename || filename);
        return;
      }

      throw new Error("CSV download failed: file not cached");
    },
  };
});

// Автосохранение любых изменений стора в IndexedDB
if (typeof window !== "undefined") {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useTaskStore.subscribe((state, prevState) => {
    const changed =
      state.status !== prevState.status ||
      state.taskId !== prevState.taskId ||
      state.spectrogram !== prevState.spectrogram ||
      state.segments !== prevState.segments ||
      state.mainEmotion !== prevState.mainEmotion ||
      state.featuresFile !== prevState.featuresFile ||
      state.featuresCache !== prevState.featuresCache ||
      state.audioFile !== prevState.audioFile ||
      state.runModelId !== prevState.runModelId ||
      state.runWindowMs !== prevState.runWindowMs;

    if (!changed) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTaskSnapshot(useTaskStore.getState()).catch(() => {});
    }, 120);
  });
}