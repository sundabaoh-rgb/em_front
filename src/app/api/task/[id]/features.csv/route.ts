import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TASK_URL = process.env.BACKEND_TASK_URL;

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!TASK_URL) {
    return new NextResponse("Backend not configured", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }

  const upstreamUrl = `${TASK_URL}/${encodeURIComponent(id)}/features.csv`;

  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return new NextResponse(text || `Backend features failed (${res.status})`, {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }

    const buf = await res.arrayBuffer();
    const headers = new Headers();

    headers.set("cache-control", "no-store");

    headers.set("content-type", res.headers.get("content-type") || "text/csv; charset=utf-8");

    const cd = res.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);

    return new NextResponse(buf, { status: 200, headers });
  } catch (e: any) {
    return new NextResponse(e?.message ?? "Upstream fetch failed", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
}