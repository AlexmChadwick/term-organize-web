/**
 * Chosen credits for variable-credit courses.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Banner reports a range (`creditHourLow`/`creditHourHigh`) and a `creditHours`
 * default. The student picks a whole number in that range on each row.
 */

import type { CourseKey } from "@/lib/models";
import { keyId } from "@/lib/models";
import type { DegreePlanCourse } from "@/lib/requirements";
import type { PlanCourse } from "@/lib/user";

export interface CreditBounds {
  low: number;
  high: number;
  /** Banner `creditHours`. A default, not the range. */
  creditHours?: number | null;
}

export function isVariableCredit(low: number, high: number): boolean {
  return Number.isFinite(low) && Number.isFinite(high) && high !== low;
}

/** Low and high from one Banner section. A missing high means the section is fixed at low. */
export function bannerCreditBounds(section: {
  creditHourLow?: number | null;
  creditHourHigh?: number | null;
  creditHours?: number | null;
}): CreditBounds {
  const low = section.creditHourLow ?? section.creditHours ?? 0;
  const high = section.creditHourHigh ?? low;
  return { low, high, creditHours: section.creditHours ?? null };
}

/** `creditHours` when it sits in the range, otherwise the low end. Whole numbers. */
export function defaultChosenCredits(bounds: CreditBounds): number {
  const hours = bounds.creditHours;
  if (hours != null && hours >= bounds.low && hours <= bounds.high) return clampChosenCredits(hours, bounds.low, bounds.high);
  return clampChosenCredits(bounds.low, bounds.low, bounds.high);
}

/** Whole number inside low through high. */
export function clampChosenCredits(value: number, low: number, high: number): number {
  const least = Math.ceil(low);
  const most = Math.floor(high);
  const fallback = Number.isFinite(least) ? least : 0;
  if (!Number.isFinite(value)) return fallback;
  if (most < least) return least;
  return Math.min(most, Math.max(least, Math.round(value)));
}

export function creditsCaption(credits: number, low: number, high: number): string {
  return `Credits: ${credits} (${low} to ${high})`;
}

export function rowIsVariable(row: { creditLow?: number | null; creditHigh?: number | null }): boolean {
  return row.creditLow != null && row.creditHigh != null && isVariableCredit(row.creditLow, row.creditHigh);
}

/**
 * Keeps a chosen value and moves it into a new range.
 * A missing value takes the default. A fixed range drops the stepper fields.
 */
export function applyChosenCredits<T extends { credits?: number; creditLow?: number | null; creditHigh?: number | null }>(
  row: T,
  bounds: CreditBounds,
  options?: { fillMissing?: boolean },
): T {
  const variable = isVariableCredit(bounds.low, bounds.high);
  const had = typeof row.credits === "number" && Number.isFinite(row.credits);
  if (!variable) {
    const fixed = clampChosenCredits(bounds.low, bounds.low, bounds.high);
    const credits = had ? clampChosenCredits(row.credits as number, bounds.low, bounds.high) : options?.fillMissing ? fixed : row.credits;
    return { ...row, credits, creditLow: undefined, creditHigh: undefined };
  }
  const credits = had ? clampChosenCredits(row.credits as number, bounds.low, bounds.high) : options?.fillMissing ? defaultChosenCredits(bounds) : row.credits;
  return { ...row, credits, creditLow: bounds.low, creditHigh: bounds.high };
}

/** Catalog refresh: clamp rows that are variable now or already had a range. Leave other credit edits alone. */
export function refreshRowCredits<T extends { credits?: number; creditLow?: number | null; creditHigh?: number | null }>(
  row: T,
  course: { minCredits: number; maxCredits: number; defaultCredits?: number | null } | null | undefined,
): T {
  if (!course) return row;
  const variable = isVariableCredit(course.minCredits, course.maxCredits);
  if (!variable && !rowIsVariable(row)) return row;
  return applyChosenCredits(row, { low: course.minCredits, high: course.maxCredits, creditHours: course.defaultCredits }, { fillMissing: true });
}

export function creditMark(key: CourseKey, crn?: string | null): string {
  return crn ? `${keyId(key)}#${crn}` : keyId(key);
}

/** Pair rows with the same course number and CRN, in order. Unmatched rows stay unmatched. */
export function pairCreditRows<T, U>(left: readonly T[], right: readonly U[], leftMark: (item: T) => string | null, rightMark: (item: U) => string | null): [number, number][] {
  const pools = new Map<string, number[]>();
  right.forEach((item, index) => {
    const mark = rightMark(item);
    if (!mark) return;
    const list = pools.get(mark) ?? [];
    list.push(index);
    pools.set(mark, list);
  });
  const pairs: [number, number][] = [];
  left.forEach((item, index) => {
    const mark = leftMark(item);
    if (!mark) return;
    const match = pools.get(mark)?.shift();
    if (match != null) pairs.push([index, match]);
  });
  return pairs;
}

function degreeMark(course: DegreePlanCourse): string | null {
  return course.key ? creditMark(course.key, course.crn) : null;
}

function scheduleMark(course: PlanCourse): string {
  return creditMark(course.key, course.pinnedCRN);
}

/** Copy chosen credits from each degree row onto the matching schedule row. */
export function pushCreditsToSchedule(degreeCourses: readonly DegreePlanCourse[], scheduleCourses: PlanCourse[]): PlanCourse[] {
  const next = scheduleCourses.map((course) => ({ ...course }));
  for (const [from, to] of pairCreditRows(degreeCourses, next, degreeMark, scheduleMark)) {
    const source = degreeCourses[from]!;
    next[to] = {
      ...next[to]!,
      credits: source.credits,
      creditLow: source.creditLow,
      creditHigh: source.creditHigh,
    };
  }
  return next;
}

/** Copy chosen credits from each schedule row onto the matching degree row. */
export function pushCreditsToDegree(degreeCourses: DegreePlanCourse[], scheduleCourses: readonly PlanCourse[]): DegreePlanCourse[] {
  const next = degreeCourses.map((course) => ({ ...course }));
  for (const [to, from] of pairCreditRows(next, scheduleCourses, degreeMark, scheduleMark)) {
    const source = scheduleCourses[from]!;
    if (typeof source.credits !== "number") continue;
    next[to] = {
      ...next[to]!,
      credits: source.credits,
      ...(source.creditLow != null && source.creditHigh != null ? { creditLow: source.creditLow, creditHigh: source.creditHigh } : {}),
    };
  }
  return next;
}

export function migrateDegreeCourse(course: DegreePlanCourse): DegreePlanCourse {
  const credits = Number.isFinite(course.credits) ? course.credits : 4;
  if (course.creditLow == null || course.creditHigh == null) return { ...course, credits };
  return { ...course, credits: clampChosenCredits(credits, course.creditLow, course.creditHigh) };
}

export function migratePlanCourse(course: PlanCourse): PlanCourse {
  if (course.creditLow == null || course.creditHigh == null) return course;
  if (typeof course.credits === "number" && Number.isFinite(course.credits)) {
    return { ...course, credits: clampChosenCredits(course.credits, course.creditLow, course.creditHigh) };
  }
  return { ...course, credits: defaultChosenCredits({ low: course.creditLow, high: course.creditHigh, creditHours: null }) };
}
