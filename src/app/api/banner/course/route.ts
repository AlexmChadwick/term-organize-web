import { NextResponse } from "next/server";
import { refreshCourse } from "@/lib/banner-server";
import { loadBundledCatalog } from "@/lib/catalog-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const term = url.searchParams.get("term") ?? "";
  const subject = (url.searchParams.get("subject") ?? "").toUpperCase();
  const number = (url.searchParams.get("number") ?? "").toUpperCase();
  if (!/^\d{6}$/.test(term) || !/^[A-Z]{2,5}$/.test(subject) || !/^[0-9A-Z]{3,5}$/.test(number)) {
    return NextResponse.json({ error: "Provide term, subject, and number." }, { status: 400 });
  }
  try {
    const catalog = await loadBundledCatalog(term);
    const subjects = catalog?.subjects ?? [];
    const live = await refreshCourse(term, subject, number, subjects);
    return NextResponse.json(live);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't refresh this course.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
