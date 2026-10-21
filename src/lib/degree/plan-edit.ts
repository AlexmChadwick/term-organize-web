/**
 * Edits a degree plan and the schedule built from one of its semesters.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreePlanEditing.swift (move and add),
 * DegreePlanSchedule.swift, and the overview lines in DegreePlanText.swift.
 */

import { bannerCodeForSeason } from "@/lib/degree-format";
import { creditNumber, keyId, termApproximateWindow, type CourseKey } from "@/lib/models";
import { canPlacePlanCourse } from "@/lib/schedule/pins";
import { PLAN_SEASON_EXPORT, termCredits, type DegreePlan, type DegreePlanCourse, type DegreePlanTerm } from "@/lib/requirements";
import { emptyPlanFilters, newId, nextColorIndex, type SchedulePlan } from "@/lib/user";

/** Appends a course to a semester. No-op when that semester is gone. */
export function addToTerm(plan: DegreePlan, course: DegreePlanCourse, termId: string): void {
  const term = plan.terms.find((item) => item.id === termId);
  if (!term) return;
  term.courses.push(course);
}

/**
 * Moves a planned course to a semester at a position (0 is the top). The course
 * may already be in that semester, which reorders it. A missing course or
 * semester leaves the plan unchanged.
 */
export function moveToPosition(plan: DegreePlan, courseId: string, termId: string, position: number): void {
  const destination = plan.terms.findIndex((term) => term.id === termId);
  if (destination < 0) return;
  let index = position;
  const current = plan.terms[destination]!.courses.findIndex((course) => course.id === courseId);
  if (current >= 0 && current < position) index -= 1;
  const moved = takePlannedCourse(plan, courseId);
  if (!moved) return;
  const courses = plan.terms[destination]!.courses;
  courses.splice(Math.min(Math.max(0, index), courses.length), 0, moved);
}

function takePlannedCourse(plan: DegreePlan, courseId: string): DegreePlanCourse | null {
  for (const term of plan.terms) {
    const position = term.courses.findIndex((course) => course.id === courseId);
    if (position >= 0) return term.courses.splice(position, 1)[0] ?? null;
  }
  return null;
}

export function termExportName(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`;
}

/** `base`, or `base 2`, `base 3`… when the name is taken (ignoring case). */
export function uniqueName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  const wanted = base.trim();
  if (!taken.has(wanted.toLowerCase())) return wanted;
  let number = 2;
  while (taken.has(`${wanted} ${number}`.toLowerCase())) number += 1;
  return `${wanted} ${number}`;
}

/** The name of a schedule built from a semester: `Spring 2027 plan`. */
export function scheduleName(semester: DegreePlanTerm, existing: readonly string[]): string {
  return uniqueName(`${termExportName(semester)} plan`, existing);
}

export interface SemesterSchedule {
  plan: SchedulePlan;
  isNew: boolean;
  courseCount: number;
}

/**
 * The schedule for a degree-plan semester in a Banner term: one of that term
 * that already holds exactly those courses, else a new one named like the
 * semester. Null when the semester has no catalog courses. Mutates `plans`
 * when it creates a schedule, the way `UserDataStore.scheduleForDegreePlan` does.
 */
export function scheduleForDegreePlan(plans: SchedulePlan[], semester: DegreePlanTerm, termCode: string): SemesterSchedule | null {
  const seen = new Set<string>();
  const entries: { key: CourseKey; crn: string | null }[] = [];
  for (const course of semester.courses) {
    if (!course.key) continue;
    const id = course.crn ? `${keyId(course.key)}#${course.crn}` : keyId(course.key);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ key: course.key, crn: course.crn ?? null });
  }
  if (entries.length === 0) return null;
  const wanted = new Set(entries.map((entry) => (entry.crn ? `${keyId(entry.key)}#${entry.crn}` : keyId(entry.key))));
  const existing = plansInTerm(plans, termCode).find((plan) => sameCourseSet(plan, wanted));
  if (existing) return { plan: existing, isNew: false, courseCount: entries.length };
  const schedule = createSchedulePlan(plans, scheduleName(semester, plansInTerm(plans, termCode).map((plan) => plan.name)), termCode);
  for (const entry of entries) addScheduleCourse(schedule, entry.key, entry.crn);
  return { plan: schedule, isNew: true, courseCount: entries.length };
}

function plansInTerm(plans: readonly SchedulePlan[], termCode: string): SchedulePlan[] {
  return plans
    .filter((plan) => plan.termCode === termCode)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.updatedAt - a.updatedAt);
}

function sameCourseSet(plan: SchedulePlan, wanted: ReadonlySet<string>): boolean {
  const have = new Set(plan.courses.map((course) => (course.pinnedCRN ? `${keyId(course.key)}#${course.pinnedCRN}` : keyId(course.key))));
  if (have.size !== wanted.size) return false;
  for (const id of wanted) if (!have.has(id)) return false;
  return true;
}

function createSchedulePlan(plans: SchedulePlan[], name: string, termCode: string): SchedulePlan {
  const now = Date.now();
  const plan: SchedulePlan = {
    id: newId(),
    name,
    termCode,
    courses: [],
    selectedCRNs: [],
    filters: emptyPlanFilters(),
    favoriteCombinations: [],
    isPrimary: !plans.some((item) => item.termCode === termCode),
    createdAt: now,
    updatedAt: now,
  };
  plans.push(plan);
  return plan;
}

function addScheduleCourse(plan: SchedulePlan, key: CourseKey, pinnedCRN?: string | null): void {
  if (!canPlacePlanCourse(plan.courses, key, pinnedCRN)) return;
  plan.courses.push({
    key,
    isRequired: true,
    excludedCRNs: [],
    colorIndex: nextColorIndex(plan),
    ...(pinnedCRN ? { pinnedCRN } : {}),
  });
  if (pinnedCRN && !plan.selectedCRNs.includes(pinnedCRN)) plan.selectedCRNs.push(pinnedCRN);
  plan.updatedAt = Date.now();
}

function creditsPhrase(value: number): string {
  return `${creditNumber(value)} ${value === 1 ? "credit" : "credits"}`;
}

function coursesPhrase(count: number): string {
  return count === 1 ? "1 course" : `${count} courses`;
}

function termHasEnded(term: DegreePlanTerm, now: Date): boolean {
  const window = termApproximateWindow(bannerCodeForSeason(term.season, term.year));
  if (!window) return false;
  return window.end < now.getTime();
}

function upcomingTerms(plan: DegreePlan, now: Date): DegreePlanTerm[] {
  return plan.terms.filter((term) => !termHasEnded(term, now));
}

function nextPlannedTerm(plan: DegreePlan, now: Date): DegreePlanTerm | null {
  return upcomingTerms(plan, now).find((term) => term.courses.length > 0) ?? null;
}

/** `68 credits completed`, or `No completed courses yet`. */
export function degreePlanCompletedLine(plan: DegreePlan): string {
  if (plan.completed.length === 0) return "No completed courses yet";
  return `${creditsPhrase(plan.completed.reduce((sum, course) => sum + course.credits, 0))} completed`;
}

/** `Spring 2027 · 13 credits · 4 courses`, or null when nothing upcoming has courses. */
export function degreePlanNextSummary(plan: DegreePlan, now = new Date()): string | null {
  const next = nextPlannedTerm(plan, now);
  if (!next) return null;
  return `${termExportName(next)} · ${creditsPhrase(termCredits(next))} · ${coursesPhrase(next.courses.length)}`;
}

/** `Next: Spring 2027 · …`, or why there is no next semester. */
export function degreePlanNextLine(plan: DegreePlan, now = new Date()): string {
  const summary = degreePlanNextSummary(plan, now);
  if (summary) return `Next: ${summary}`;
  if (plan.terms.length === 0) return "No semesters planned yet";
  if (upcomingTerms(plan, now).length === 0) return "No upcoming semesters";
  return "No courses planned yet";
}
