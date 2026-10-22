/**
 * Plan warnings, notices, course-list edits, autofill wording, and schedule helpers.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of SchedulePlanSupport, ScheduleNotices, ScheduleGeneratorSupport's plan
 * actions, ScheduleAutofillSupport, ScheduleCarouselLayout, ScheduleDroppedCourse,
 * and ScheduleClock. Generation itself stays in generator.ts.
 */

import type { CatalogIndex } from "@/lib/catalog-index";
import { planTermMatches, scheduleSuggestions, type AutofillSuggestion } from "@/lib/degree-logic";
import type { Course, CourseKey, CourseSection, DaySet, Term } from "@/lib/models";
import {
  creditsLabel,
  dayIndices,
  dayShortLabel,
  isDigit,
  keyId,
  meetingOverlaps,
  parseCourseKey,
  rangeLabel,
  sameKey,
  weeklyMeetings,
} from "@/lib/models";
import type { BlockedTime } from "@/lib/preferences";
import { blockedTimeIsValid } from "@/lib/preferences";
import type { DegreePlan } from "@/lib/requirements";
import {
  applyRelaxation,
  makeCoursesOptional,
  type GeneratedSchedule,
  type ScheduleRelaxation,
} from "@/lib/schedule/generator";
import { sectionIsFull } from "@/lib/schedule/preference-rules";
import { canPlacePlanCourse } from "@/lib/schedule/pins";
import type { AppPreferences, PlanCourse, SchedulePlan } from "@/lib/user";
import { emptyPlanFilters, newId, nextColorIndex } from "@/lib/user";

const APOSTROPHE = "\u2019";
const DOT = "\u00b7";

export interface ScheduleWarning {
  text: string;
  symbol: string;
  severity: "error" | "warning" | "neutral";
}

export interface ScheduleConflict {
  first: CourseSection;
  second: CourseSection;
  days: DaySet;
  start: number;
  end: number;
  summary: string;
}

export interface ResolvedEntry {
  planCourse: PlanCourse;
  course: Course | null;
  allSections: CourseSection[];
  selected: CourseSection[];
  catalogAvailable: boolean;
  key: CourseKey;
  isMissing: boolean;
  hasNoSections: boolean;
  courseCRNs: Set<string>;
  countsTowardsCredits: boolean;
}

export interface ScheduleNoticeFix {
  kind: "removeSections";
  crns: string[];
}

export interface ScheduleNotice {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  lines: string[];
  fix: ScheduleNoticeFix | null;
  fixTitle: string | null;
}

function sectionTitle(section: CourseSection): string {
  return section.sectionNumber ? `${section.classType} ${section.sectionNumber}` : section.classType;
}

function overlap(a: CourseSection, b: CourseSection): { days: DaySet; start: number; end: number } | null {
  let days = 0;
  let window: { start: number; end: number } | null = null;
  for (const first of weeklyMeetings(a)) {
    for (const second of weeklyMeetings(b)) {
      if (!meetingOverlaps(first, second)) continue;
      if (first.start == null || first.end == null || second.start == null || second.end == null) continue;
      days |= first.days & second.days;
      const start = Math.max(first.start, second.start);
      const end = Math.min(first.end, second.end);
      if (!window || start < window.start) window = { start, end };
    }
  }
  return window ? { days, start: window.start, end: window.end } : null;
}

function conflictsAmong(sections: CourseSection[]): ScheduleConflict[] {
  const result: ScheduleConflict[] = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const first = sections[i]!;
      const second = sections[j]!;
      const found = overlap(first, second);
      if (!found) continue;
      result.push({
        first,
        second,
        days: found.days,
        start: found.start,
        end: found.end,
        summary: `${keyId({ subject: first.subject, number: first.number })} overlaps ${keyId({ subject: second.subject, number: second.number })} ${DOT} ${dayShortLabel(found.days)} ${rangeLabel(found.start, found.end)}`,
      });
    }
  }
  return result;
}

/** A plan resolved against a term's catalog: chosen sections and what needs attention. */
export class ResolvedPlan {
  readonly plan: SchedulePlan;
  readonly hasCatalog: boolean;
  readonly entries: ResolvedEntry[];
  readonly unlistedCRNs: string[];
  readonly orphanedCRNs: string[];
  readonly selectedSections: CourseSection[];
  readonly conflicts: ScheduleConflict[];
  readonly fullSections: { entry: ResolvedEntry; section: CourseSection }[];
  readonly missingCourses: CourseKey[];
  readonly credits: { min: number; max: number };

  constructor(plan: SchedulePlan, index: CatalogIndex | null) {
    this.plan = plan;
    this.hasCatalog = index != null;
    const bySection = new Map<string, CourseSection>();
    if (index) {
      for (const crn of plan.selectedCRNs) {
        const section = index.sectionByCRN(crn);
        if (section) bySection.set(crn, section);
      }
    }
    const claimed = new Set<string>();
    const entries: ResolvedEntry[] = [];
    for (const planCourse of plan.courses) {
      const all = index?.sectionsOf(planCourse.key) ?? [];
      const siblingPins = new Set(
        plan.courses.flatMap((course) => (course !== planCourse && course.pinnedCRN && sameKey(course.key, planCourse.key) ? [course.pinnedCRN] : [])),
      );
      const selected = plan.selectedCRNs.flatMap((crn) => {
        const section = bySection.get(crn);
        if (!section || !sameKey({ subject: section.subject, number: section.number }, planCourse.key)) return [];
        if (planCourse.pinnedCRN) {
          if (crn !== planCourse.pinnedCRN) return [];
        } else if (siblingPins.has(crn) || claimed.has(crn)) {
          return [];
        } else if (plan.courses.some((course) => course !== planCourse && !course.pinnedCRN && sameKey(course.key, planCourse.key))) {
          return [];
        }
        claimed.add(crn);
        return [section];
      });
      if (planCourse.pinnedCRN && !claimed.has(planCourse.pinnedCRN)) {
        const section = bySection.get(planCourse.pinnedCRN);
        if (section) {
          claimed.add(planCourse.pinnedCRN);
          selected.push(section);
        }
      }
      const course = index?.course(planCourse.key) ?? null;
      const catalogAvailable = index != null;
      entries.push({
        planCourse,
        course,
        allSections: all,
        selected,
        catalogAvailable,
        key: planCourse.key,
        isMissing: catalogAvailable && course == null && all.length === 0,
        hasNoSections: catalogAvailable && course != null && all.length === 0,
        courseCRNs: new Set(all.map((section) => section.crn)),
        countsTowardsCredits: planCourse.isRequired || selected.length > 0,
      });
    }
    this.entries = entries;
    const unclaimed = index == null ? [] : plan.selectedCRNs.filter((crn) => !claimed.has(crn));
    this.unlistedCRNs = unclaimed.filter((crn) => !bySection.has(crn));
    this.orphanedCRNs = unclaimed.filter((crn) => bySection.has(crn));
    const sections = entries.flatMap((entry) => entry.selected);
    this.selectedSections = sections;
    this.conflicts = conflictsAmong(sections);
    this.fullSections = entries.flatMap((entry) =>
      entry.selected.filter(sectionIsFull).map((section) => ({ entry, section })),
    );
    this.missingCourses = entries.filter((entry) => entry.isMissing || entry.hasNoSections).map((entry) => entry.key);
    let low = 0;
    let high = 0;
    for (const entry of entries) {
      if (!entry.countsTowardsCredits) continue;
      const chosen = entry.planCourse.credits;
      if (typeof chosen === "number") {
        low += chosen;
        high += chosen;
        continue;
      }
      if (!entry.course) continue;
      low += entry.course.minCredits;
      high += entry.course.maxCredits;
    }
    this.credits = { min: low, max: high };
  }

  get isOverCreditLimit(): boolean {
    return this.credits.min > 19;
  }

  /** Courses with no chosen section that could have one. */
  get coursesWithoutSection(): ResolvedEntry[] {
    return this.entries.filter((entry) => entry.selected.length === 0 && !entry.isMissing && !entry.hasNoSections);
  }

  entryFor(key: CourseKey): ResolvedEntry | undefined {
    return this.entries.find((entry) => sameKey(entry.key, key));
  }

  /** What needs attention, most serious first. Empty while the catalog isn't loaded. */
  get warnings(): ScheduleWarning[] {
    if (!this.hasCatalog) return [];
    const items: ScheduleWarning[] = [];
    if (this.conflicts.length > 0) {
      const count = this.conflicts.length;
      items.push({
        text: count === 1 ? "1 conflict" : `${count} conflicts`,
        symbol: "exclamationmark.triangle.fill",
        severity: "error",
      });
    }
    if (this.fullSections.length > 0) {
      const count = this.fullSections.length;
      items.push({
        text: count === 1 ? "1 full section" : `${count} full sections`,
        symbol: "chair",
        severity: "warning",
      });
    }
    if (this.missingCourses.length > 0) {
      const count = this.missingCourses.length;
      items.push({
        text: count === 1 ? "1 course not offered" : `${count} courses not offered`,
        symbol: "questionmark.folder",
        severity: "warning",
      });
    }
    if (this.isOverCreditLimit) {
      items.push({ text: "Over 19 credits", symbol: "exclamationmark.circle", severity: "warning" });
    }
    const missingSections = this.coursesWithoutSection.filter((entry) => entry.planCourse.isRequired).length;
    if (missingSections > 0 && this.plan.courses.length > 0) {
      items.push({
        text: missingSections === 1 ? "1 course needs a section" : `${missingSections} courses need sections`,
        symbol: "circle.dashed",
        severity: "neutral",
      });
    }
    return items;
  }
}

function noticeFix(crns: string[]): { fix: ScheduleNoticeFix; fixTitle: string } {
  return { fix: { kind: "removeSections", crns }, fixTitle: "Remove" };
}

/** The notices for a plan, most serious first. */
export function scheduleNotices(resolved: ResolvedPlan, termName: string, catalogUnavailable: boolean): ScheduleNotice[] {
  const items: ScheduleNotice[] = [];
  if (!resolved.hasCatalog && catalogUnavailable && resolved.plan.courses.length > 0) {
    items.push({
      id: "catalog",
      severity: "warning",
      title: `Course data for ${termName} isn${APOSTROPHE}t on this device`,
      lines: ["Switch to that term and download its catalog to see sections, times and seats."],
      fix: null,
      fixTitle: null,
    });
  }
  if (resolved.conflicts.length > 0) {
    const count = resolved.conflicts.length;
    const lines = resolved.conflicts.slice(0, 3).map((conflict) => conflict.summary);
    if (count > 3) lines.push(`and ${count - 3} more`);
    items.push({
      id: "conflicts",
      severity: "error",
      title: count === 1 ? "1 time conflict" : `${count} time conflicts`,
      lines,
      fix: null,
      fixTitle: null,
    });
  }
  if (resolved.fullSections.length > 0) {
    items.push({
      id: "full",
      severity: "warning",
      title: resolved.fullSections.length === 1 ? "1 section is full" : `${resolved.fullSections.length} sections are full`,
      lines: resolved.fullSections.map(({ section }) => {
        const waitlist = section.waitlistCapacity > 0 ? ` ${DOT} ${section.waitlistRemaining} waitlist spots left` : "";
        return `${keyId({ subject: section.subject, number: section.number })} ${sectionTitle(section)} is full${waitlist}`;
      }),
      fix: null,
      fixTitle: null,
    });
  }
  if (resolved.missingCourses.length > 0) {
    const count = resolved.missingCourses.length;
    items.push({
      id: "missing",
      severity: "warning",
      title:
        count === 1
          ? `1 course isn${APOSTROPHE}t offered in ${termName}`
          : `${count} courses aren${APOSTROPHE}t offered in ${termName}`,
      lines: resolved.missingCourses.map((key) => `${keyId(key)} has no sections this term.`),
      fix: null,
      fixTitle: null,
    });
  }
  if (resolved.isOverCreditLimit) {
    items.push({
      id: "credits",
      severity: "warning",
      title: `${creditsLabel(resolved.credits.min, resolved.credits.max)} is a heavy load`,
      lines: ["Above 19 credits you may need approval from your advisor or college."],
      fix: null,
      fixTitle: null,
    });
  }
  if (resolved.unlistedCRNs.length > 0) {
    const unlisted = resolved.unlistedCRNs;
    const labeled = noticeFix(unlisted);
    items.push({
      id: "unlisted",
      severity: "info",
      title: unlisted.length === 1 ? "A saved section is no longer listed" : `${unlisted.length} saved sections are no longer listed`,
      lines: [`CRN ${unlisted.join(", ")} isn${APOSTROPHE}t in the current ${termName} catalog.`],
      fix: labeled.fix,
      fixTitle: labeled.fixTitle,
    });
  }
  if (resolved.orphanedCRNs.length > 0) {
    const orphaned = resolved.orphanedCRNs;
    const labeled = noticeFix(orphaned);
    items.push({
      id: "orphaned",
      severity: "info",
      title:
        orphaned.length === 1
          ? "A section from a removed course is still selected"
          : `${orphaned.length} sections from removed courses are still selected`,
      lines: [`CRN ${orphaned.join(", ")} doesn${APOSTROPHE}t belong to any course in this schedule.`],
      fix: labeled.fix,
      fixTitle: labeled.fixTitle,
    });
  }
  return items;
}

/** Applies one "no schedules fit" suggestion to the plan's courses, filters, or preferences. */
export function applyPlanEdit(relaxation: ScheduleRelaxation, plan: SchedulePlan): void {
  applyRelaxation(relaxation, plan);
}

/** Makes courses optional, so they are only added to a schedule when they fit. */
export function makePlanCoursesOptional(keys: readonly CourseKey[], plan: SchedulePlan): void {
  makeCoursesOptional(keys, plan.courses);
}

/** How a blocked time reads in a list. */
export function blockedTimeListDetail(block: BlockedTime): string {
  if (!blockedTimeIsValid(block)) return block.days === 0 ? "Choose the days" : "Check the times";
  let text = `${dayShortLabel(block.days)} ${rangeLabel(block.start, block.end)}`;
  if (!block.isEnabled) text += ` ${DOT} Off`;
  else if (block.strength === "preferred") text += ` ${DOT} If I must`;
  return text;
}

/** Hour range and day columns shared by every carousel page. */
export function scheduleCarouselLayout(
  schedules: readonly GeneratedSchedule[],
  preferences: AppPreferences,
): { hours: { lower: number; upper: number }; days: number[] } {
  let earliest = Number.MAX_SAFE_INTEGER;
  let latest = 0;
  const weekdays = new Set<number>();
  for (const schedule of schedules) {
    if (schedule.earliestStart != null) earliest = Math.min(earliest, schedule.earliestStart);
    if (schedule.latestEnd != null) latest = Math.max(latest, schedule.latestEnd);
    for (const section of schedule.sections) {
      for (const meeting of weeklyMeetings(section)) {
        for (const day of dayIndices(meeting.days)) weekdays.add(day);
      }
    }
  }
  const hours =
    earliest === Number.MAX_SAFE_INTEGER
      ? {
          lower: Math.max(0, preferences.calendarStartHour),
          upper: Math.max(preferences.calendarStartHour + 5, Math.min(24, preferences.calendarEndHour)),
        }
      : {
          lower: Math.max(0, Math.floor(earliest / 60)),
          upper: Math.min(24, Math.max(Math.ceil(latest / 60), Math.max(0, Math.floor(earliest / 60)) + 5)),
        };
  const days = [1, 2, 3, 4, 5];
  if (preferences.showWeekends || weekdays.has(6)) days.push(6);
  if (preferences.showWeekends || weekdays.has(0)) days.unshift(0);
  return { hours, days };
}

export interface ScheduleDroppedCourse {
  key: CourseKey;
  crn: string | null;
}

/** Every course in dragged text, in order and without repeats. Non-courses are skipped. */
export function parseDroppedCourses(items: readonly string[]): ScheduleDroppedCourse[] {
  const seen = new Set<string>();
  const parsed: ScheduleDroppedCourse[] = [];
  for (const item of items) {
    for (const line of item.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const key = parseCourseKey(`${parts[0]} ${parts[1]}`);
      if (!key || ![...key.number].some((character) => isDigit(character))) continue;
      const third = parts[2];
      const crn = third && third.length === 5 && [...third].every((character) => isDigit(character)) ? third : null;
      const id = `${keyId(key)}|${crn ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      parsed.push({ key, crn });
    }
  }
  return parsed;
}

/** Today at `minutes` after midnight, for a time-only picker. Values outside the day are clamped. */
export function scheduleClockDate(minutes: number): Date {
  const clamped = Math.min(Math.max(minutes, 0), 24 * 60 - 1);
  const date = new Date();
  date.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
  return date;
}

export function scheduleClockMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** The Banner term a schedule belongs to, even when the term list hasn't loaded. */
export function termForPlan(code: string, terms: readonly Term[], index: CatalogIndex | null): Term {
  const known = terms.find((term) => term.code === code);
  if (known) return known;
  if (index && index.catalog.term.code === code) return index.catalog.term;
  return { code, bannerDescription: "" };
}

/** Courses worth starting a plan with: degree-plan semesters, then other schedules for the term. */
export function autofillSuggestions(options: {
  plan: SchedulePlan;
  terms: readonly Term[];
  degreePlans: readonly DegreePlan[];
  schedulePlans: readonly SchedulePlan[];
  index: CatalogIndex | null;
}): AutofillSuggestion[] {
  const { plan, terms, degreePlans, schedulePlans, index } = options;
  const hasSiblings = schedulePlans.some(
    (other) => other.termCode === plan.termCode && other.id !== plan.id && other.courses.length > 0,
  );
  if (degreePlans.length === 0 && !hasSiblings) return [];
  return scheduleSuggestions({
    term: termForPlan(plan.termCode, terms, index),
    degreePlans: [...degreePlans],
    schedulePlans: [...schedulePlans],
    excludingPlanID: plan.id,
    alreadyInPlan: new Set(plan.courses.map((course) => keyId(course.key))),
    index,
  });
}

/** `Copy “Name”`, or `“Name” · Spring 2027` for a degree-plan semester. */
export function autofillSourceName(suggestion: AutofillSuggestion): string {
  if (suggestion.source.type === "degree") {
    const name = `\u201c${suggestion.planName}\u201d`;
    return suggestion.semester ? `${name} ${DOT} ${suggestion.semester}` : name;
  }
  return `Copy \u201c${suggestion.planName}\u201d`;
}

/** `3 courses`, `1 course`. */
export function courseCountLabel(count: number): string {
  return count === 1 ? "1 course" : `${count} courses`;
}

export function dismissalKey(planID: string, suggestion: AutofillSuggestion): string {
  return `${planID}|${suggestion.id}`;
}

export function isAutofillDismissed(key: string, raw: string): boolean {
  return raw.split("\n").includes(key);
}

/** `raw` with `key` added. Only the most recent `limit` dismissals are kept. */
export function addDismissal(key: string, raw: string, limit = 200): string {
  const keys = raw.split("\n").filter((item) => item.length > 0 && item !== key);
  keys.push(key);
  return keys.slice(-limit).join("\n");
}

/**
 * The semester of a degree plan that matches a schedule's term: the one whose courses
 * can be rearranged to make the schedule work.
 */
export function reorderSemester(
  plan: SchedulePlan,
  degreePlan: DegreePlan | null,
  terms: readonly Term[],
  index: CatalogIndex | null,
): { plan: DegreePlan; term: Term } | null {
  if (!degreePlan) return null;
  const term = termForPlan(plan.termCode, terms, index);
  if (!degreePlan.terms.some((item) => planTermMatches(item, term))) return null;
  return { plan: degreePlan, term };
}

/** In-memory stand-in for the plan edits `UserDataStore` performs. */
export class PlanDataStore {
  plans: SchedulePlan[] = [];

  plan(id: string): SchedulePlan | undefined {
    return this.plans.find((item) => item.id === id);
  }

  createPlan(name: string, termCode: string): SchedulePlan {
    const now = Date.now();
    const created: SchedulePlan = {
      id: newId(),
      name,
      termCode,
      courses: [],
      selectedCRNs: [],
      filters: emptyPlanFilters(),
      preferences: null,
      favoriteCombinations: [],
      isPrimary: !this.plans.some((item) => item.termCode === termCode),
      createdAt: now,
      updatedAt: now,
    };
    this.plans.push(created);
    return created;
  }

  updatePlan(id: string, change: (plan: SchedulePlan) => void): void {
    const current = this.plans.find((item) => item.id === id);
    if (!current) return;
    change(current);
    current.updatedAt = Date.now();
  }

  /** Adds a course. A second copy is refused unless `pinnedCRN` is a new manual section. */
  addCourse(key: CourseKey, planID: string, required = true, pinnedCRN?: string | null): boolean {
    let added = false;
    this.updatePlan(planID, (plan) => {
      if (!canPlacePlanCourse(plan.courses, key, pinnedCRN)) return;
      plan.courses.push({
        key,
        isRequired: required,
        excludedCRNs: [],
        colorIndex: nextColorIndex(plan),
        ...(pinnedCRN ? { pinnedCRN } : {}),
      });
      if (pinnedCRN && !plan.selectedCRNs.includes(pinnedCRN)) plan.selectedCRNs.push(pinnedCRN);
      added = true;
    });
    return added;
  }

  /**
   * Removes the unpinned entry, or the entry pinned to `pinnedCRN`.
   * Other sections of the same course number stay.
   */
  removeCourse(key: CourseKey, planID: string, sectionsOfCourse: readonly string[] = [], pinnedCRN?: string | null): void {
    const crns = new Set(sectionsOfCourse);
    this.updatePlan(planID, (plan) => {
      const index = plan.courses.findIndex((course) => sameKey(course.key, key) && (pinnedCRN ? course.pinnedCRN === pinnedCRN : !course.pinnedCRN));
      if (index < 0) return;
      const removed = plan.courses[index]!;
      if (removed.pinnedCRN) {
        crns.clear();
        crns.add(removed.pinnedCRN);
      }
      plan.courses = plan.courses.filter((_, offset) => offset !== index);
      plan.selectedCRNs = plan.selectedCRNs.filter((crn) => !crns.has(crn));
      plan.favoriteCombinations = plan.favoriteCombinations.filter((combination) => !combination.some((crn) => crns.has(crn)));
    });
  }
}

/** A course taken out of a plan, kept so undo can put back just that course. */
export interface PlanCourseRemoval {
  course: PlanCourse;
  index: number;
  selectedCRNs: string[];
  favoriteCombinations: string[][];
}

export function removePlanCourse(
  entry: ResolvedEntry,
  plan: SchedulePlan,
  index: CatalogIndex | null,
  store: PlanDataStore,
): PlanCourseRemoval {
  const siblingPins = new Set(
    plan.courses.flatMap((course) => (course !== entry.planCourse && course.pinnedCRN ? [course.pinnedCRN] : [])),
  );
  const crns = new Set<string>();
  if (entry.planCourse.pinnedCRN) crns.add(entry.planCourse.pinnedCRN);
  else if (index) for (const section of index.sectionsOf(entry.key)) if (!siblingPins.has(section.crn)) crns.add(section.crn);
  for (const section of entry.selected) if (!siblingPins.has(section.crn)) crns.add(section.crn);
  const indexInPlan = plan.courses.indexOf(entry.planCourse);
  const removal: PlanCourseRemoval = {
    course: entry.planCourse,
    index: indexInPlan < 0 ? plan.courses.length : indexInPlan,
    selectedCRNs: plan.selectedCRNs.filter((crn) => crns.has(crn)),
    favoriteCombinations: plan.favoriteCombinations.filter((combination) => combination.some((crn) => crns.has(crn))),
  };
  store.removeCourse(entry.key, plan.id, [...crns], entry.planCourse.pinnedCRN);
  return removal;
}

/** Puts back exactly the course that was removed, with its sections and favorites. */
export function restorePlanCourse(removal: PlanCourseRemoval, plan: SchedulePlan): void {
  if (!canPlacePlanCourse(plan.courses, removal.course.key, removal.course.pinnedCRN)) return;
  const at = Math.min(Math.max(0, removal.index), plan.courses.length);
  plan.courses.splice(at, 0, removal.course);
  for (const crn of removal.selectedCRNs) {
    if (!plan.selectedCRNs.includes(crn)) plan.selectedCRNs.push(crn);
  }
  for (const combination of removal.favoriteCombinations) {
    const present = plan.favoriteCombinations.some(
      (existing) => existing.length === combination.length && existing.every((crn, offset) => crn === combination[offset]),
    );
    if (!present) plan.favoriteCombinations.push(combination);
  }
}

/** Adds every course of an autofill suggestion as required. Returns the ones that were new. */
export function addAutofill(courses: readonly CourseKey[], planID: string, store: PlanDataStore): CourseKey[] {
  const added: CourseKey[] = [];
  for (const key of courses) {
    if (store.addCourse(key, planID, true)) added.push(key);
  }
  return added;
}

/** Takes out just the courses an autofill added. */
export function undoAutofill(keys: readonly CourseKey[], planID: string, index: CatalogIndex | null, store: PlanDataStore): void {
  for (const key of keys) {
    const crns = index?.sectionsOf(key).map((section) => section.crn) ?? [];
    store.removeCourse(key, planID, crns);
  }
}
