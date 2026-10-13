import { NextResponse } from "next/server";
import { lookupCourseCatalog } from "@/lib/course-catalog-lookup";
import { parseCourseKey, type CourseKey } from "@/lib/models";
import type { DegreePlan } from "@/lib/requirements";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KEY_LIMIT = 80;

function courseKey(value: unknown): CourseKey | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { subject?: unknown; number?: unknown };
  if (typeof record.subject !== "string" || typeof record.number !== "string") return null;
  return parseCourseKey(`${record.subject} ${record.number}`);
}

function asPlan(value: unknown): DegreePlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as DegreePlan;
  if (!Array.isArray(plan.completed) || !Array.isArray(plan.terms)) return null;
  if (!Array.isArray(plan.courseEquivalences)) plan.courseEquivalences = [];
  return plan;
}

/** Catalog entries, NUpath attributes, and retired-course suggestions for courses the open term may not list. */
export async function POST(request: Request) {
  let body: {
    keys?: unknown;
    attributes?: unknown;
    suggest?: unknown;
    plan?: unknown;
    catalogTitles?: unknown;
    alsoComparing?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a list of courses." }, { status: 400 });
  }
  const keys: CourseKey[] = [];
  const seen = new Set<string>();
  const rawKeys = Array.isArray(body.keys) ? body.keys : [];
  for (const item of rawKeys) {
    const key = typeof item === "string" ? parseCourseKey(item) : courseKey(item);
    if (!key) continue;
    const id = `${key.subject} ${key.number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(key);
    if (keys.length >= KEY_LIMIT) break;
  }
  if (!keys.length) return NextResponse.json({ error: "Name at least one course." }, { status: 400 });

  const catalogTitles: Record<string, string> = {};
  if (body.catalogTitles && typeof body.catalogTitles === "object") {
    for (const [id, title] of Object.entries(body.catalogTitles as Record<string, unknown>)) {
      if (typeof title === "string" && title.trim()) catalogTitles[id] = title;
    }
  }
  const alsoComparing: CourseKey[] = [];
  if (Array.isArray(body.alsoComparing)) {
    for (const item of body.alsoComparing) {
      const key = typeof item === "string" ? parseCourseKey(item) : courseKey(item);
      if (key) alsoComparing.push(key);
      if (alsoComparing.length >= 200) break;
    }
  }

  try {
    const result = await lookupCourseCatalog({
      keys,
      withAttributes: body.attributes === true,
      suggest: body.suggest === true,
      plan: asPlan(body.plan),
      catalogTitles,
      alsoComparing,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't read Banner's course catalog.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
