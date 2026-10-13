import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ term: string }> }) {
  const { term } = await context.params;
  if (!/^\d{6}$/.test(term)) return NextResponse.json({ error: "Unknown term." }, { status: 404 });
  const file = path.join(process.cwd(), "data", `term-${term}.json.gz`);
  try {
    const gz = await readFile(file);
    const json = gunzipSync(gz);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: `No bundled catalog for ${term}.` }, { status: 404 });
  }
}
