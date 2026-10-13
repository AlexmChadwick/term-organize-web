import { NextResponse } from "next/server";
import { refreshWatched } from "@/lib/banner-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { term?: string; courses?: { subject: string; number: string }[] } | null;
  const term = body?.term ?? "";
  const courses = (body?.courses ?? []).slice(0, 40);
  if (!/^\d{6}$/.test(term) || !courses.length) return NextResponse.json({ error: "Nothing to check." }, { status: 400 });
  try {
    const sections = await refreshWatched(term, courses);
    return NextResponse.json({ sections });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't check seats.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
