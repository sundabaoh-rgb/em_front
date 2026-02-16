import type { TaskResponse, UploadResponse, EmotionSegment } from "@/lib/types";

/**
 * api.ts
 *
 * Небольшой слой клиентских запросов к Next.js API routes:
 * - /api/upload   → загрузка аудио и старт задачи
 * - /api/task/:id → получение статуса/результата задачи
 * - /api/segments → сохранение сегментов (если нужно)
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Безопасно читает JSON-ответ.
 * Возвращает `null`, если тело пустое или это невалидный JSON.
 */
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Выполняет fetch с таймаутом (AbortController).
 * NOTE: В Next/браузере это работает нормально, но если запрос завершился
 * после abort — он просто будет проигнорирован.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;

  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Загружает аудио на /api/upload.
 *
 * Ожидает multipart/form-data:
 * - file: File
 *
 * Возвращает UploadResponse:
 * - { ok: true, taskId, status }
 * - { ok: false, error }
 */
export async function uploadAudio(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);

  try {
    const res = await fetchWithTimeout("/api/upload", {
      method: "POST",
      body: fd,
      timeoutMs: 60_000,
    });

    const json = await safeJson<UploadResponse & { error?: string }>(res);

    if (!res.ok || !json) {
      return { ok: false, error: `Upload failed (${res.status})` };
    }

    /**
     * Если backend/proxy вернул ok=false — просто отдаём как есть
     * (тип UploadResponse это допускает).
     */
    return json as UploadResponse;
  } catch (e: any) {
    /**
     * AbortError или сетевые ошибки:
     */
    const msg =
      e?.name === "AbortError"
        ? "Upload timeout"
        : e?.message ?? "Upload failed (network)";
    return { ok: false, error: msg };
  }
}

/**
 * Запрашивает состояние задачи /api/task/:id.
 *
 * Возвращает TaskResponse:
 * - в случае ошибок возвращаем status="error" (не бросаем исключения).
 */
export async function getTask(taskId: string): Promise<TaskResponse> {
  try {
    const res = await fetchWithTimeout(`/api/task/${encodeURIComponent(taskId)}`, {
      method: "GET",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    const json = await safeJson<TaskResponse & { error?: string }>(res);

    if (!res.ok || !json) {
      return {
        taskId,
        status: "error",
        error: `Task fetch failed (${res.status})`,
      };
    }

    return json as TaskResponse;
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Task fetch timeout"
        : e?.message ?? "Task fetch failed (network)";
    return { taskId, status: "error", error: msg };
  }
}

/**
 * Сохраняет сегменты на /api/segments.
 *
 * Возвращает boolean:
 * - true  → успешно
 * - false → ошибка
 */
export async function saveSegments(
  taskId: string,
  segments: EmotionSegment[]
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, segments }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    return res.ok;
  } catch {
    return false;
  }
}
