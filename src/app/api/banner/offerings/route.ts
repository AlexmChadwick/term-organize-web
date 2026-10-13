import { NextResponse } from "next/server";
import { offeringHistoryFor } from "@/lib/banner-server";
import { parseCourseKey } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Recent terms in which the given courses had sections. */
export async function POST(request: Request) {
  let keys: string[] = [];
  try {
    const body = (await request.json()) as { keys?: unknown };
    if (Array.isArray(body.keys)) keys = body.keys.filter((key): key is string => typeof key === "string");
  } catch {
    return NextResponse.json({ error: "Expected a list of course codes." }, { status: 400 });
  }
  const courses = keys.flatMap((code) => {
    const key = parseCourseKey(code);
    return key ? [key] : [];
  });
  try {
    const history = await offeringHistoryFor(courses);
    return NextResponse.json(history.toJSON(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't check when these courses are offered.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
