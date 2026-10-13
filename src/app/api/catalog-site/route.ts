import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED = /^https:\/\/catalog\.northeastern\.edu(\/|$)/;

const cache = new Map<string, { at: number; html: string }>();

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url") ?? "";
  if (!ALLOWED.test(target)) return NextResponse.json({ error: "Only catalog.northeastern.edu can be fetched." }, { status: 400 });
  const hit = cache.get(target);
  const week = 7 * 24 * 3600 * 1000;
  if (hit && Date.now() - hit.at < week) {
    return new NextResponse(hit.html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Cache": "hit" } });
  }
  try {
    const res = await fetch(target, { headers: { Accept: "text/html" }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `Catalog site returned HTTP ${res.status}.` }, { status: 502 });
    const html = await res.text();
    cache.set(target, { at: Date.now(), html });
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the academic catalog." }, { status: 502 });
  }
}
