import { NextResponse } from "next/server";
import { fetchSpectrogramMock } from "@/lib/mockApi";

export const runtime = "nodejs";

/**
 * Backend endpoint base that returns task status/result by id.
 * Example: https://.../api/task
 */
const TASK_URL = process.env.BACKEND_TASK_URL;

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await ctx.params;

  try {
    // Mock mode (backend not configured)
    if (!TASK_URL) {
      const mock = await fetchSpectrogramMock();
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
          minDb: -80,
          maxDb: 0,
          format: "uint8",
          data: b64,
        },
        summary: { mainEmotion: mock.mainEmotion },
        segments: mock.segments,

        // NEW: file link instead of inlined "features" table
        featuresFile: {
          type: "csv",
          url: `/api/task/${encodeURIComponent(taskId)}/features.csv`,
          filename: `${taskId}_features.csv`,
        },
      });
    }

    // Proxy to backend
    const res = await fetch(`${TASK_URL}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      return NextResponse.json(
        {
          taskId,
          status: "error",
          error: json?.error ?? `Backend task failed (${res.status})`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(json);
  } catch (e: any) {
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