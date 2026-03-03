import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * URL backend-эндпоинта для загрузки аудиофайла.
 * Если переменная окружения не задана — работаем в mock-режиме,
 * чтобы UI мог жить без подключенного бэка.
 */
const UPLOAD_URL = process.env.BACKEND_UPLOAD_URL;

/**
 * POST /api/upload
 *
 * Принимает multipart/form-data с полем `file` (аудио) и:
 * - в mock-режиме возвращает фиктивный taskId
 * - в боевом режиме проксирует файл на backend upload endpoint
 *
 * Ожидаемый input:
 * - FormData:
 *   - file: File
 *
 * Ожидаемый ответ от backend (минимум):
 * - { taskId: string, status?: string, error?: string }
 *
 * Статусы/ошибки:
 * - 200: { ok: true, taskId, status }
 * - 400: если `file` отсутствует/невалиден
 * - 502: если backend ответил ошибкой или вернул неожидаемый payload
 * - 500: непредвиденная ошибка внутри обработчика
 */
export async function POST(req: Request) {
  try {
    /**
     * Если backend не настроен (локальная разработка/демо),
     * возвращаем мок taskId, чтобы фронт продолжал работать.
     */
    if (!UPLOAD_URL) {
      // пока бэка нет — возвращаем мок taskId, чтобы UI жил
      return NextResponse.json({
        ok: true,
        taskId: "mock-task-1",
        status: "processing",
      });
    }

    /**
     * Читаем multipart/form-data.
     * Важно: req.formData() работает в nodejs runtime.
     */
    const form = await req.formData();

    /**
     * Ожидаем поле `file`.
     * Если `file` пришёл строкой — значит это не File/Blob, а обычное значение.
     */
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 }
      );
    }

    /**
     * Формируем новый FormData для апстрима.
     * Прокидываем ровно то, что ждёт backend: поле `file`.
     */
    const upstream = new FormData();
    upstream.append("audio", file, (file as File).name || "recording.webm");
    
    upstream.append("test_mode", "false"); //! Тестовый режим

    const windowMs = form.get("window_ms");
    if (typeof windowMs === "string" && windowMs.trim() !== "") {
      upstream.append("window_ms", windowMs);
    }

    const model = form.get("model");
    if (typeof model === "string" && model.trim() !== "") {
      upstream.append("model_name", model);
    }

    const modelName = form.get("model_name");
    if (!model && typeof modelName === "string" && modelName.trim() !== "") {
      upstream.append("model_name", modelName);
    }


    /**
     * Проксируем загрузку на backend.
     * Заголовки multipart выставлять не нужно — fetch сделает это сам
     * (с boundary), если body = FormData.
     */
    const res = await fetch(UPLOAD_URL, { method: "POST", body: upstream });

    /**
     * Ожидаем стандартный JSON от backend: { taskId, status }.
     * Если backend вернёт не-JSON/пустое тело — json будет null.
     */
    const json = await res.json().catch(() => null);

    /**
     * Если backend ответил не-2xx или не вернул taskId — считаем это ошибкой шлюза.
     * В error стараемся прокинуть сообщение backend'а, если оно есть.
     */
    if (!res.ok || !json?.taskId) {
      return NextResponse.json(
        { ok: false, error: json?.error ?? `Backend upload failed (${res.status})` },
        { status: 502 }
      );
    }

    /**
     * Успешный ответ. status может отсутствовать — тогда дефолт "queued".
     */
    return NextResponse.json({
      ok: true,
      taskId: json.taskId,
      status: json.status ?? "queued",
    });
  } catch (e: any) {
    /**
     * Непредвиденная ошибка (ошибка парсинга formData, fetch, runtime и т.д.)
     */
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
