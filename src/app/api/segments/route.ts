import { NextResponse } from "next/server";

/**
 * Указываем runtime для Next.js Route Handler.
 * Используем nodejs, так как есть server-side fetch
 * и потенциальная работа с backend-сервисом.
 */
export const runtime = "nodejs";

/**
 * URL backend-сервиса, принимающего сегменты.
 * Может отсутствовать в env (например, в dev / mock-режиме).
 */
const SEGMENTS_URL = process.env.BACKEND_SEGMENTS_URL;

/**
 * POST /api/segments
 *
 * Принимает сегменты аудио/данных от клиента
 * и проксирует их в backend-сервис (если он настроен).
 *
 * Ожидаемый payload:
 * {
 *   taskId: string;
 *   segments: any[];
 * }
 *
 * Поведение:
 * - если payload некорректен → 400
 * - если backend URL не задан → считаем успешным (noop)
 * - если backend ответил ошибкой → 502
 * - при непредвиденной ошибке → 500
 */
export async function POST(req: Request) {
  try {
    /**
     * Пытаемся распарсить JSON-тело запроса.
     * Если body невалидный — считаем payload некорректным.
     */
    const body = await req.json().catch(() => null);

    // Валидация минимально необходимых полей
    if (!body?.taskId || !Array.isArray(body?.segments)) {
      return NextResponse.json(
        { ok: false, error: "Bad payload" },
        { status: 400 }
      );
    }

    /**
     * Если backend не настроен (например, локальная разработка),
     * не считаем это ошибкой — просто подтверждаем успех.
     */
    if (!SEGMENTS_URL) {
      return NextResponse.json({ ok: true });
    }

    /**
     * Проксируем сегменты в backend-сервис.
     */
    const res = await fetch(SEGMENTS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    /**
     * Backend ответил, но со статусом ошибки —
     * пробрасываем это как Bad Gateway.
     */
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Backend segments failed (${res.status})`,
        },
        { status: 502 }
      );
    }

    // Успешная обработка
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    /**
     * Защита от непредвиденных ошибок:
     * - ошибки сети
     * - ошибки сериализации
     * - runtime-исключения
     */
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
