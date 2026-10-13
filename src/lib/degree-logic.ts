/**
 * Prerequisite checks, duplicates, and schedule autofill for degree plans.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreePlanLogic.swift.
 */

import type { CatalogIndex } from "./catalog-index";
import { CourseEquivalences } from "./equivalences";
import type { CourseKey, Requisite, Term } from "./models";
import { compareCourseKeys, courseKeyOf, creditsLabel, keyId, referencedCourses, sameKey, termCalendarYear, termSeason } from "./models";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm, PlanSeason } from "./requirements";
import { seasonStartMonth, termSortKey } from "./requirements";
import type { SchedulePlan } from "./user";
import { newId } from "./user";

export type PrerequisiteStatus = { kind: "met" } | { kind: "missing"; text: string } | { kind: "unknown" };

export function countsSeparately(a: Pick<DegreePlanCourse, "title" | "credits">, b: Pick<DegreePlanCourse, "title" | "credits">): boolean {
  if (a.credits <= 0 || b.credits <= 0) return false;
  const first = normalizeTitle(a.title);
  const second = normalizeTitle(b.title);
  if (first && second && first !== second) return true;
  return first.includes("topic") || second.includes("topic");
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]/g, "");
}

export function coursesBefore(plan: DegreePlan, termIndex: number): Set<string> {
  const keys = new Set<string>();
  for (const course of plan.completed) if (course.key) keys.add(keyId(course.key));
  for (const term of plan.terms.slice(0, Math.max(0, termIndex))) {
    for (const course of term.courses) if (course.key) keys.add(keyId(course.key));
  }
  return keys;
}

export function planEquivalences(plan: DegreePlan, extra?: CourseEquivalences): CourseEquivalences {
  const declared = CourseEquivalences.fromPairs(plan.courseEquivalences.map((e) => [e.course, e.countsAs]));
  return extra ? extra.merging(declared) : declared;
}

/** Drops the course itself and repeats, then sorts. Port of `CourseInfo.init` equivalents. */
export function normalizeEquivalents(course: CourseKey, equivalents: readonly CourseKey[]): CourseKey[] {
  const seen = new Set<string>();
  const unique: CourseKey[] = [];
  for (const item of equivalents) {
    if (sameKey(item, course)) continue;
    const id = keyId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique.sort(compareCourseKeys);
}

/** `4 credits` or `1–4 credits`. Null when the catalog entry doesn't say. */
export function courseInfoCreditsLabel(min?: number | null, max?: number | null): string | null {
  const low = min ?? max;
  if (low == null) return null;
  return creditsLabel(low, max ?? low);
}

export function missingCount(requisite: Requisite, taken: Set<string>, equivalences = CourseEquivalences.none()): number {
  return missingCountNode(requisite, equivalences.expanding(taken));
}

/** Courses a requisite names that were covered by a different equivalent that was taken. */
export function coveringEquivalents(requisite: Requisite, taken: Set<string>, equivalences: CourseEquivalences): Record<string, CourseKey> {
  const covering: Record<string, CourseKey> = {};
  for (const course of referencedCourses(requisite)) {
    if (taken.has(keyId(course))) continue;
    const equivalent = equivalences.satisfier(course, taken);
    if (equivalent) covering[keyId(course)] = equivalent;
  }
  return covering;
}

export function unmetSummary(requisite: Requisite, takenIds: Set<string>, equivalences = CourseEquivalences.none()): string | null {
  return unmet(requisite, equivalences.expanding(takenIds));
}

function unmet(requisite: Requisite, covered: Set<string>): string | null {
  if ("s" in requisite && "n" in requisite) {
    const id = `${requisite.s} ${requisite.n}`;
    return covered.has(id) ? null : id;
  }
  if ("test" in requisite) return null;
  if ("and" in requisite) {
    const parts = unique(requisite.and.flatMap((item) => {
      const text = unmet(item, covered);
      return text ? [text] : [];
    }));
    if (parts.length <= 1) return parts[0] ?? null;
    if (parts.length <= 3) return parts.map(parenthesizedIfCompound).join(" and ");
    return `${parts.slice(0, 2).map(parenthesizedIfCompound).join(", ")} and ${parts.length - 2} more`;
  }
  if ("or" in requisite) {
    if (requisite.or.some((item) => unmet(item, covered) == null)) return null;
    const courses = requisite.or.flatMap((item) => ("s" in item && "n" in item ? [`${item.s} ${item.n}`] : []));
    if (courses.length === requisite.or.length) {
      const names = unique(courses);
      return names.length <= 3 ? names.join(" or ") : `${names[0]}, ${names[1]} or ${names.length - 2} others`;
    }
    let best = requisite.or[0];
    let bestCount = Infinity;
    for (const item of requisite.or) {
      const n = missingCountNode(item, covered);
      if (n < bestCount) {
        best = item;
        bestCount = n;
      }
    }
    if (!best) return null;
    const text = unmet(best, covered);
    if (!text) return null;
    return `${parenthesizedIfCompound(text)} or another option`;
  }
  return null;
}

function missingCountNode(requisite: Requisite, covered: Set<string>): number {
  if ("s" in requisite && "n" in requisite) return covered.has(`${requisite.s} ${requisite.n}`) ? 0 : 1;
  if ("test" in requisite) return 0;
  if ("and" in requisite) return requisite.and.reduce((s, item) => s + missingCountNode(item, covered), 0);
  if ("or" in requisite) return Math.min(...requisite.or.map((item) => missingCountNode(item, covered)));
  return 0;
}

function parenthesizedIfCompound(text: string): string {
  return text.includes(" or ") || text.includes(" and ") || text.endsWith(" more") ? `(${text})` : text;
}

function unique(texts: string[]): string[] {
  const seen = new Set<string>();
  return texts.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

export function prerequisiteStatus(
  key: CourseKey,
  termIndex: number,
  plan: DegreePlan,
  catalog: CatalogIndex | null,
  lookup?: (key: CourseKey) => Requisite | null | undefined,
  equivalences = CourseEquivalences.none(),
): PrerequisiteStatus {
  const taken = coursesBefore(plan, termIndex);
  const counting = planEquivalences(plan, equivalences);
  const listed = catalog?.course(key);
  if (listed?.detailsLoaded) {
    return statusOf(listed.prereqs, taken, counting);
  }
  if (lookup) {
    const known = lookup(key);
    if (known !== undefined) return statusOf(known, taken, counting);
  }
  return { kind: "unknown" };
}

export function statusOf(requisite: Requisite | null | undefined, taken: Set<string>, equivalences = CourseEquivalences.none()): PrerequisiteStatus {
  if (!requisite) return { kind: "met" };
  const missing = unmetSummary(requisite, taken, equivalences);
  return missing ? { kind: "missing", text: missing } : { kind: "met" };
}

export function duplicateKeys(plan: DegreePlan): Set<string> {
  const planned = plan.terms.flatMap((t) => t.courses);
  const duplicates = new Set<string>();
  planned.forEach((course, index) => {
    if (!course.key) return;
    const repeatsPlanned = planned.slice(0, index).some((other) => other.key && keyId(other.key) === keyId(course.key!) && !countsSeparately(other, course));
    const repeatsCompleted = plan.completed.some((other) => other.key && keyId(other.key) === keyId(course.key!) && !countsSeparately(other, course));
    if (repeatsPlanned || repeatsCompleted) duplicates.add(keyId(course.key));
  });
  return duplicates;
}

export function planTermMatches(term: DegreePlanTerm, banner: Term): boolean {
  if (termCalendarYear(banner.code) !== term.year) return false;
  const season = termSeason(banner.code);
  switch (term.season) {
    case "fall":
      return season === "fall";
    case "spring":
      return season === "spring";
    case "winter":
      return season === "winter";
    case "summerA":
      return season === "summer1" || season === "summerFull";
    case "summerB":
      return season === "summer2" || season === "summerFull";
    case "summerFull":
      return season === "summerFull" || season === "summer1" || season === "summer2";
  }
}

function planSeasonFromTerm(banner: Term): PlanSeason {
  switch (termSeason(banner.code)) {
    case "fall":
      return "fall";
    case "winter":
      return "winter";
    case "spring":
      return "spring";
    case "summer1":
      return "summerA";
    case "summer2":
      return "summerB";
    default:
      return "summerFull";
  }
}

export function monthIndexOfTerm(term: Term): number {
  const season = planSeasonFromTerm(term);
  return termCalendarYear(term.code) * 12 + seasonStartMonth(season) - 1;
}

export interface AutofillSuggestion {
  id: string;
  planName: string;
  semester?: string;
  title: string;
  detail: string;
  isExactTerm: boolean;
  courses: CourseKey[];
  unavailable: CourseKey[];
  source: { type: "degree"; planId: string; termId: string } | { type: "schedule"; planId: string };
}

export function scheduleSuggestions(options: {
  term: Term;
  degreePlans: DegreePlan[];
  schedulePlans: SchedulePlan[];
  excludingPlanID?: string;
  alreadyInPlan?: Set<string>;
  index?: CatalogIndex | null;
}): AutofillSuggestion[] {
  const { term, index } = options;
  const already = options.alreadyInPlan ?? new Set<string>();
  const target = monthIndexOfTerm(term);
  const exact: AutofillSuggestion[] = [];
  const closest: AutofillSuggestion[] = [];
  const split = (keys: CourseKey[]) => {
    if (!index || index.catalog.term.code !== term.code) return { offered: keys, unavailable: [] as CourseKey[] };
    const offered: CourseKey[] = [];
    const unavailable: CourseKey[] = [];
    for (const key of keys) {
      if (index.sectionsOf(key).length === 0) unavailable.push(key);
      else offered.push(key);
    }
    return { offered, unavailable };
  };
  const plans = [...options.degreePlans].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.updatedAt - a.updatedAt);
  for (const plan of plans) {
    const done = new Set(plan.completed.flatMap((c) => (c.key ? [keyId(c.key)] : [])));
    const candidates = plan.terms.flatMap((planTerm) => {
      const seen = new Set<string>();
      const keys = planTerm.courses.flatMap((c) => {
        if (!c.key) return [];
        const id = keyId(c.key);
        if (done.has(id) || already.has(id) || seen.has(id)) return [];
        seen.add(id);
        return [c.key];
      });
      if (!keys.length) return [];
      const month = planTerm.year * 12 + seasonStartMonth(planTerm.season) - 1;
      return [{ planTerm, keys, distance: Math.abs(month - target) }];
    });
    if (!candidates.length) continue;
    candidates.sort((a, b) => a.distance - b.distance || termSortKey(b.planTerm) - termSortKey(a.planTerm));
    const best = candidates[0]!;
    const parts = split(best.keys);
    if (!parts.offered.length && !parts.unavailable.length) continue;
    const isExact = planTermMatches(best.planTerm, term);
    const short = `${
      { winter: "Winter", spring: "Spring", summerA: "Summer A", summerFull: "Summer", summerB: "Summer B", fall: "Fall" }[best.planTerm.season]
    } ${best.planTerm.year}`;
    const suggestion: AutofillSuggestion = {
      id: `degree-${plan.id}-${best.planTerm.id}`,
      planName: plan.name,
      semester: short,
      title: `From “${plan.name}” · ${short}`,
      detail: isExact ? "Your plan for this term" : best.distance === 0 ? "Planned for this time" : "Closest semester you planned",
      isExactTerm: isExact,
      courses: parts.offered,
      unavailable: parts.unavailable,
      source: { type: "degree", planId: plan.id, termId: best.planTerm.id },
    };
    if (isExact) exact.push(suggestion);
    else closest.push(suggestion);
  }
  const copies: AutofillSuggestion[] = options.schedulePlans
    .filter((p) => p.termCode === term.code && p.id !== options.excludingPlanID && p.courses.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2)
    .flatMap((plan) => {
      const keys = plan.courses.map((c) => c.key).filter((k) => !already.has(keyId(k)));
      if (!keys.length) return [];
      return [
        {
          id: `schedule-${plan.id}`,
          planName: plan.name,
          title: `Copy “${plan.name}”`,
          detail: plan.isPrimary ? "Your schedule for this term" : "Another schedule for this term",
          isExactTerm: true,
          courses: keys,
          unavailable: [],
          source: { type: "schedule" as const, planId: plan.id },
        },
      ];
    });
  return [...exact, ...copies, ...closest];
}

export function newDegreePlanDraft(name: string, source: DegreePlan | null, schedulePlans: SchedulePlan[], courseLookup: (term: string, key: CourseKey) => { title: string; credits: number } | null): DegreePlan {
  const now = Date.now();
  const draft: DegreePlan = {
    id: newId(),
    name,
    completed: [],
    terms: [],
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
    substitutions: [],
    courseEquivalences: [],
  };
  if (source) {
    draft.program = source.program;
    draft.studentName = source.studentName;
    draft.studentID = source.studentID;
    draft.catalogYear = source.catalogYear;
    draft.catalogProgramPath = source.catalogProgramPath;
    draft.catalogProgramTitle = source.catalogProgramTitle;
    draft.concentrationID = source.concentrationID;
    draft.substitutions = source.substitutions.map((s) => ({ ...s, id: newId() }));
    draft.courseEquivalences = source.courseEquivalences.map((e) => ({ ...e, id: newId() }));
    draft.completed = source.completed.map((c) => ({ ...c, id: newId() }));
    draft.terms = source.terms.map((term) => ({ ...term, id: newId(), courses: term.courses.map((c) => ({ ...c, id: newId() })) }));
  }
  const done = new Set(draft.completed.flatMap((c) => (c.key ? [keyId(c.key)] : [])));
  for (const plan of schedulePlans) {
    if (!plan.isPrimary || !plan.courses.length) continue;
    const banner: Term = { code: plan.termCode, bannerDescription: "" };
    const season = planSeasonFromTerm(banner);
    const year = termCalendarYear(plan.termCode);
    let termPosition = draft.terms.findIndex((t) => t.season === season && t.year === year);
    if (termPosition < 0) {
      draft.terms.push({ id: newId(), season, year, courses: [] });
      termPosition = draft.terms.length - 1;
    }
    const present = new Set(draft.terms[termPosition]!.courses.flatMap((c) => (c.key ? [keyId(c.key)] : [])));
    for (const planCourse of plan.courses) {
      const id = keyId(planCourse.key);
      if (present.has(id) || done.has(id)) continue;
      const course = courseLookup(plan.termCode, planCourse.key);
      draft.terms[termPosition]!.courses.push({
        id: newId(),
        key: planCourse.key,
        label: keyId(planCourse.key),
        title: (course?.title ?? keyId(planCourse.key)).slice(0, 30),
        credits: course?.credits ?? 4,
      });
      present.add(id);
    }
  }
  draft.terms.sort((a, b) => termSortKey(a) - termSortKey(b));
  return draft;
}

export function nextSemesters(plan: DegreePlan, count = 4, now = new Date()): DegreePlanTerm[] {
  const order: PlanSeason[] = ["spring", "summerA", "summerB", "fall"];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  let year = Number(parts.year);
  const month = Number(parts.month);
  let seasonIndex = month < 5 ? 0 : month < 7 ? 1 : month < 9 ? 2 : 3;
  const last = plan.terms[plan.terms.length - 1];
  if (last) {
    const i = order.indexOf(last.season);
    if (i >= 0) {
      year = last.year;
      seasonIndex = i + 1;
    }
  }
  const existing = new Set(plan.terms.map((t) => `${t.season}-${t.year}`));
  const result: DegreePlanTerm[] = [];
  while (result.length < count) {
    if (seasonIndex >= order.length) {
      seasonIndex = 0;
      year += 1;
    }
    const season = order[seasonIndex]!;
    if (!existing.has(`${season}-${year}`)) result.push({ id: newId(), season, year, courses: [] });
    seasonIndex += 1;
  }
  return result;
}

export function termCreditTotal(courses: { credits: number }[]): number {
  return courses.reduce((s, c) => s + c.credits, 0);
}

export { courseKeyOf };
