import type { TaskResponse, UploadResponse, EmotionSegment } from "@/lib/types";

/**
 * api.ts
 *
 * Клиентский слой запросов к Next.js API routes:
 * - /api/upload   → загрузка аудио и старт задачи
 * - /api/task/:id → статус/результат задачи
 * - /api/segments → сохранение сегментов (опционально)
 *
 * Ключевая проблема старой версии:
 * - getTask() абортился по таймауту (30s). Когда backend отдаёт большой "done" payload
 *   (base64 спектрограмма + 6k фичей), ответ может занять дольше → AbortError → polling отменяется.
 *
 * Здесь:
 * - upload: таймаут есть (60s)
 * - getTask: по умолчанию БЕЗ abort (или с очень большим таймаутом через опцию)
 * - + cache: "no-store" для getTask
 */

const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_JSON_TIMEOUT_MS = 30_000;
// Для "done payload" (большой JSON) — лучше либо без abort, либо большой потолок:
const DEFAULT_TASK_TIMEOUT_MS = 180_000;

/**
 * Безопасно читает JSON-ответ.
 * Возвращает `null`, если тело пустое или это невалидный JSON.
 */
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    // res.json() падает на пустом body
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Пытается вытащить человекочитаемую ошибку из ответа.
 * Не гарантирует JSON, поэтому сначала пробуем текст.
 */
async function safeErrorText(res: Response): Promise<string | null> {
  try {
    const t = await res.text();
    const s = (t ?? "").trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

/**
 * fetch с таймаутом (AbortController).
 * Важно: НЕ использовать для long-poll / больших ответов,
 * иначе будем получать AbortError и "пустые" запросы в Network.
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = DEFAULT_JSON_TIMEOUT_MS, ...rest } = init;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Upload: таймаут полезен, т.к. сеть/бек может зависнуть.
 */
export async function uploadAudio(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);

  try {
    const res = await fetchWithTimeout("/api/upload", {
      method: "POST",
      body: fd,
      timeoutMs: DEFAULT_UPLOAD_TIMEOUT_MS,
    });

    const json = await safeJson<UploadResponse & { error?: string }>(res);

    if (!res.ok || !json) {
      const details = (await safeErrorText(res)) ?? "";
      return {
        ok: false,
        error: `Upload failed (${res.status})${details ? `: ${details}` : ""}`,
      };
    }

    return json as UploadResponse;
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "Upload timeout"
        : e?.message ?? "Upload failed (network)";
    return { ok: false, error: msg };
  }
}

/**
 * Task status/result:
 * ВАЖНО: по умолчанию НЕ абортим запрос, чтобы большой "done" payload не ломал polling.
 * Если тебе всё же нужен потолок — оставил опцию timeoutMs (по умолчанию 180s).
 */
export async function getTask(taskId: string, opts?: { timeoutMs?: number }): Promise<TaskResponse> {
  const url = `/api/task/${encodeURIComponent(taskId)}`;

  try {
    // Вариант A (рекомендую): без abort вообще.
    // const res = await fetch(url, { method: "GET", cache: "no-store" });

    // Вариант B: большой таймаут (если хочешь защититься от "вечных" зависаний):
    const res = await fetchWithTimeout(url, {
      method: "GET",
      cache: "no-store",
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
    });

    const json = await safeJson<TaskResponse & { error?: string }>(res);

    if (!res.ok || !json) {
      const details = (await safeErrorText(res)) ?? "";
      return {
        taskId,
        status: "error",
        error: `Task fetch failed (${res.status})${details ? `: ${details}` : ""}`,
      };
    }

    return json as TaskResponse;
  } catch (e: any) {
    // ВАЖНО: таймаут polling — это не "фатальная ошибка".
    // Но этот слой API не знает твою бизнес-логику, поэтому возвращаем status="error".
    // В сторе лучше трактовать "Task fetch timeout" как retry, а не cancel.
    const msg =
      e?.name === "AbortError"
        ? "Task fetch timeout"
        : e?.message ?? "Task fetch failed (network)";
    return { taskId, status: "error", error: msg };
  }
}

/**
 * Сохраняет сегменты на /api/segments.
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
      timeoutMs: DEFAULT_JSON_TIMEOUT_MS,
    });

    return res.ok;
  } catch {
    return false;
  }
}
