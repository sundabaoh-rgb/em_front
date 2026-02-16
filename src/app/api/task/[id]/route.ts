import { NextResponse } from "next/server";
import { fetchSpectrogramMock } from "@/lib/mockApi";

export const runtime = "nodejs";

/**
 * Базовый URL backend-эндпоинта, который возвращает статус/результат задачи.
 * Если переменная окружения не задана — работаем в mock-режиме.
 */
const TASK_URL = process.env.BACKEND_TASK_URL;

/**
 * GET /api/task/[id]
 *
 * Возвращает состояние задачи по `taskId` и, если задача завершена, результат
 * (спектрограмму, сегменты, фичи, summary и т.д.).
 *
 * Особенности Next.js:
 * - `ctx.params` здесь приходит как Promise → важно `await ctx.params`,
 *   иначе `id` будет undefined.
 *
 * Поведение:
 * - если backend URL не задан → возвращаем мок-ответ (готовый результат)
 * - если backend отвечает ошибкой/невалидным JSON → 502
 * - непредвиденная ошибка в хендлере → 500
 */
export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  /**
   * Важно: params в Route Handler может быть Promise.
   * Поэтому корректный способ: await ctx.params.
   */
  const { id: taskId } = await ctx.params;

  try {
    /**
     * Если backend не настроен (например, локальная разработка),
     * отдаём мок-результат "как будто задача уже готова".
     */
    if (!TASK_URL) {
      const mock = await fetchSpectrogramMock();

      /**
       * Передаём спектрограмму в base64, чтобы безопасно отдавать бинарные/байтовые данные в JSON.
       * Здесь `mock.mel` ожидается как Uint8Array/Buffer/ArrayBuffer-compatible структура.
       */
      const b64 = Buffer.from(mock.mel).toString("base64");

      return NextResponse.json({
        taskId,
        status: "done",
        audio: { sampleRate: mock.sampleRate },
        spectrogram: {
          type: "mel",
          frames: mock.frames,
          melBins: mock.melBins,
          hopLength: mock.hopLength,
          // Диапазон dB (может использоваться на фронте для нормализации/отображения)
          minDb: -80,
          maxDb: 0,
          // Формат данных после декодирования base64 на клиенте
          format: "uint8",
          data: b64,
        },
        summary: { mainEmotion: mock.mainEmotion },
        segments: mock.segments,
        features: mock.features,
      });
    }

    /**
     * Запрашиваем backend-сервис по taskId.
     * encodeURIComponent обязателен, чтобы избежать проблем с спецсимволами.
     */
    const res = await fetch(`${TASK_URL}?id=${encodeURIComponent(taskId)}`, {
      method: "GET",
    });

    /**
     * Пытаемся распарсить JSON. Если backend вернёт не-JSON (или пустое тело),
     * json станет null — это тоже считаем ошибкой (502).
     */
    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      return NextResponse.json(
        {
          taskId,
          status: "error",
          error: `Backend task failed (${res.status})`,
        },
        { status: 502 }
      );
    }

    // Успешно проксируем ответ backend'а как есть.
    return NextResponse.json(json);
  } catch (e: any) {
    /**
     * Непредвиденная ошибка (сетевые ошибки, runtime исключения и т.д.)
     * Возвращаем 500 и безопасное сообщение.
     */
    return NextResponse.json(
      {
        taskId: taskId ?? "unknown",
        status: "error",
        error: e?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
