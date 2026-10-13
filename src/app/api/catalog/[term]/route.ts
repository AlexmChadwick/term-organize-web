import { NextResponse } from "next/server";
import { BannerHttpError, buildTermCatalog } from "@/lib/banner-server";
import { loadBestCatalog } from "@/lib/catalog-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_request: Request, context: { params: Promise<{ term: string }> }) {
  const { term } = await context.params;
  if (!/^\d{6}$/.test(term)) return NextResponse.json({ error: "Unknown term." }, { status: 404 });
  const catalog = await loadBestCatalog(term);
  if (!catalog) return NextResponse.json({ error: `No catalog for ${term}.` }, { status: 404 });
  return NextResponse.json(catalog, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}

/** Builds a full catalog for any term Banner lists and stores it for later requests. */
export async function POST(_request: Request, context: { params: Promise<{ term: string }> }) {
  const { term } = await context.params;
  if (!/^\d{6}$/.test(term)) return NextResponse.json({ error: "Unknown term." }, { status: 404 });
  try {
    const catalog = await buildTermCatalog(term);
    return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof BannerHttpError || error instanceof Error ? error.message : "Couldn't download that term.";
    const status = error instanceof BannerHttpError ? error.status : 502;
    return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
