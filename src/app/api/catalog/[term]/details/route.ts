import { NextResponse } from "next/server";
import { fillTermCourseDetails } from "@/lib/banner-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Loads a batch of this term's course descriptions from Banner. */
export async function POST(_request: Request, context: { params: Promise<{ term: string }> }) {
  const { term } = await context.params;
  if (!/^\d{6}$/.test(term)) return NextResponse.json({ error: "Unknown term." }, { status: 404 });
  try {
    const result = await fillTermCourseDetails(term);
    if (!result) return NextResponse.json({ error: `No catalog for ${term}.` }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't read course descriptions.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
