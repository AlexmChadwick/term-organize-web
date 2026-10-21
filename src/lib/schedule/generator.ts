/**
 * Conflict-free schedule search.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Portions of this file are derived from SearchNEU
 * (https://github.com/sandboxnu/searchneu), apps/searchneu/lib/scheduler/generateSchedules.ts,
 * binaryMeetingTime.ts and filters.ts, Copyright (C) Sandbox at Northeastern University
 * and the SearchNEU contributors, licensed under the GNU Affero General Public License v3.
 * Modified 2026-10-03: ported from TypeScript to Swift. Conflicts are still detected with
 * five-minute slot bitmasks, but the odometer was replaced by a depth-first search with
 * forward checking, optional courses keep only maximal combinations, every schedule is
 * scored and streamed through a bounded "best N" collector for the chosen sort order,
 * and very large search spaces are sampled instead of silently truncated.
 * Modified 2026-10-04: sections and schedules are also judged against the student's
 * SchedulePreferences (hard rules prune the search, soft rules add to the score),
 * credit targets replace the "only maximal combinations" rule, and an empty result
 * explains which courses block it.
 * Modified 2026-10-13: ported from Swift to TypeScript for the web.
 */

import type { Course, CourseKey, CourseSection, Meeting, ScheduleFilters } from "@/lib/models";
import {
  dayIndices,
  emptyScheduleFilters,
  keyId,
  meetingOverlaps,
  sameKey,
  sectionIsOnline,
  weeklyMeetings,
} from "@/lib/models";
import type { SchedulePreferences } from "@/lib/preferences";
import { activeBlockedTimes, emptyPreferences, normalizePreferences } from "@/lib/preferences";
import {
  filterReasonBit,
  isDefaultPreferences,
  preferenceRejectionBits,
  scheduleReasons,
  sectionHasNoCampus,
  sectionScore,
  sectionsTooClose,
  type ScheduleFilterReason,
  type ScheduleReason,
} from "@/lib/schedule/preference-rules";
import type { ScheduleInterval } from "@/lib/schedule/scoring";
import {
  NO_END,
  NO_START,
  ScheduleBuildingTable,
  intervalsFor,
  measureIntervals,
  measureOptionsFor,
  scoreWeightsFor,
  scoreWithWeights,
  type ScoreWeights,
  type ScheduleMeasureOptions,
} from "@/lib/schedule/scoring";
import { analyzeEmptyResult } from "@/lib/schedule/no-results";

// MARK: - Sorting

export type ScheduleSortOption =
  | "best"
  | "fewestDays"
  | "latestStart"
  | "earliestFinish"
  | "fewestGaps"
  | "mostSeats";

export const SORT_LABEL: Record<ScheduleSortOption, string> = {
  best: "Best overall",
  fewestDays: "Fewest days on campus",
  latestStart: "Latest start",
  earliestFinish: "Earliest finish",
  fewestGaps: "Fewest gaps",
  mostSeats: "Most open seats",
};

export const SORT_SHORT_LABEL: Record<ScheduleSortOption, string> = {
  best: "Best overall",
  fewestDays: "Fewest days",
  latestStart: "Latest start",
  earliestFinish: "Earliest finish",
  fewestGaps: "Fewest gaps",
  mostSeats: "Most seats",
};

export const SORT_SYMBOL: Record<ScheduleSortOption, string> = {
  best: "sparkles",
  fewestDays: "calendar.badge.minus",
  latestStart: "sunrise",
  earliestFinish: "sunset",
  fewestGaps: "rectangle.compress.vertical",
  mostSeats: "chair.lounge",
};

// MARK: - Slot masks

const MINUTES_PER_SLOT = 5;
const SLOTS_PER_DAY = (24 * 60) / MINUTES_PER_SLOT;
/** 32 uint64 words, stored as 64 uint32 words (7 × 288 five-minute slots). */
const MASK_U32 = 64;

/**
 * Meeting times as a bitmask: 7 days × 288 five-minute slots.
 * Two sections conflict when their masks share a set bit. Date windows are
 * checked separately (`Meeting.overlaps`), the same way the Swift generator does.
 */
export class ScheduleSlotMask {
  static readonly minutesPerSlot = MINUTES_PER_SLOT;
  static readonly slotsPerDay = SLOTS_PER_DAY;
  /** Swift `wordCount`: 64-bit words. */
  static readonly wordCount = 32;

  readonly words: Uint32Array;

  constructor(source?: CourseSection | readonly Meeting[]) {
    this.words = new Uint32Array(MASK_U32);
    if (!source) return;
    if (isSection(source)) {
      for (const meeting of weeklyMeetings(source)) this.insertMeeting(meeting);
    } else {
      for (const meeting of source) this.insertMeeting(meeting);
    }
  }

  insertMeeting(meeting: Meeting): void {
    if (meeting.start == null || meeting.end == null) return;
    for (const day of dayIndices(meeting.days)) this.insertSpan(day, meeting.start, meeting.end);
  }

  /** Marks every five-minute slot touched by `start..<end` on `day`. The end rounds up. */
  insertSpan(day: number, start: number, end: number): void {
    if (day < 0 || day > 6 || end <= start) return;
    const first = Math.max(0, Math.floor(start / MINUTES_PER_SLOT));
    const lastExclusive = Math.min(SLOTS_PER_DAY, Math.max(first + 1, Math.floor((end + MINUTES_PER_SLOT - 1) / MINUTES_PER_SLOT)));
    if (first >= lastExclusive) return;
    for (let slot = first; slot < lastExclusive; slot++) {
      const bit = day * SLOTS_PER_DAY + slot;
      this.words[bit >> 5] = (this.words[bit >> 5]! | (1 << (bit & 31))) >>> 0;
    }
  }

  get isEmpty(): boolean {
    for (let i = 0; i < MASK_U32; i++) if (this.words[i] !== 0) return false;
    return true;
  }

  conflicts(other: ScheduleSlotMask): boolean {
    const a = this.words;
    const b = other.words;
    for (let i = 0; i < MASK_U32; i++) {
      if ((a[i]! & b[i]!) !== 0) return true;
    }
    return false;
  }

  union(other: ScheduleSlotMask): ScheduleSlotMask {
    const copy = new ScheduleSlotMask();
    for (let i = 0; i < MASK_U32; i++) copy.words[i] = (this.words[i]! | other.words[i]!) >>> 0;
    return copy;
  }
}

function isSection(value: CourseSection | readonly Meeting[]): value is CourseSection {
  return !Array.isArray(value);
}

// MARK: - Filtering

const EMPTY_EXCLUSIONS: ReadonlySet<string> = new Set();

export function rejectionReasons(
  section: CourseSection,
  filters: ScheduleFilters,
  preferences: SchedulePreferences = emptyPreferences(),
  excluded: ReadonlySet<string> = EMPTY_EXCLUSIONS,
): number {
  let reasons = 0;
  if (excluded.has(section.crn)) reasons |= filterReasonBit("excludedByUser");
  const weekly = weeklyMeetings(section);
  if (filters.earliestStart != null && weekly.some((m) => (m.start ?? Number.MAX_SAFE_INTEGER) < filters.earliestStart!)) {
    reasons |= filterReasonBit("startsTooEarly");
  }
  if (filters.latestEnd != null && weekly.some((m) => (m.end ?? 0) > filters.latestEnd!)) {
    reasons |= filterReasonBit("endsTooLate");
  }
  if (filters.freeDays !== 0 && weekly.some((m) => (m.days & filters.freeDays) !== 0)) {
    reasons |= filterReasonBit("freeDay");
  }
  if (!filters.includeHonors && section.honors) reasons |= filterReasonBit("honors");
  if (!filters.includeOnline && sectionIsOnline(section)) reasons |= filterReasonBit("online");
  if (filters.hideFullSections && section.seatsRemaining <= 0) reasons |= filterReasonBit("seats");
  if (filters.minSeats > 0 && section.seatsRemaining < filters.minSeats) reasons |= filterReasonBit("seats");
  if (filters.campus != null && !sectionIsOnline(section) && !sectionHasNoCampus(section) && section.campus !== filters.campus) {
    reasons |= filterReasonBit("campus");
  }
  if (!isDefaultPreferences(preferences)) reasons |= preferenceRejectionBits(section, preferences);
  return reasons;
}

export function passesFilters(section: CourseSection, filters: ScheduleFilters): boolean {
  return rejectionReasons(section, filters) === 0;
}

// MARK: - Inputs and results

export interface ScheduleCourseInput {
  key: CourseKey;
  isRequired: boolean;
  sections: readonly CourseSection[];
  /** Omitted means every CRN is eligible. Swift defaults this to an empty set. */
  excludedCRNs?: ReadonlySet<string>;
  /** Whole credits. Omitted means 0, matching the Swift defaults. */
  minCredits?: number;
  maxCredits?: number;
  /** When set, this entry is that section. Other sections of the course number are not candidates. */
  pinnedCRN?: string | null;
}

export function courseInput(
  key: CourseKey,
  sections: readonly CourseSection[],
  options?: {
    isRequired?: boolean;
    excludedCRNs?: Iterable<string>;
    minCredits?: number;
    maxCredits?: number;
  },
): ScheduleCourseInput {
  return {
    key,
    isRequired: options?.isRequired ?? true,
    sections,
    excludedCRNs: new Set(options?.excludedCRNs ?? []),
    minCredits: options?.minCredits ?? 0,
    maxCredits: options?.maxCredits ?? 0,
  };
}

export interface ScheduleCatalogLookup {
  course(key: CourseKey): Course | null | undefined;
  sectionsFor(key: CourseKey): readonly CourseSection[];
  sectionByCrn(crn: string): CourseSection | null | undefined;
}

function roundCreditsUp(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.ceil(value);
}

/**
 * One entry per plan course, credits rounded up to whole credits.
 * A pin narrows that entry to its CRN. A pin that is no longer in the catalog
 * leaves the entry empty so generation stays locked to it and reports it unavailable.
 */
export function courseInputsFor(
  planCourses: readonly { key: CourseKey; isRequired: boolean; excludedCRNs?: Iterable<string>; pinnedCRN?: string | null }[],
  index: Pick<ScheduleCatalogLookup, "course" | "sectionsFor"> & {
    sectionByCrn?: (crn: string) => CourseSection | null | undefined;
  },
): ScheduleCourseInput[] {
  return planCourses.map((planCourse) => {
    const course = index.course(planCourse.key);
    const all = index.sectionsFor(planCourse.key);
    const pin = planCourse.pinnedCRN ?? null;
    const lookedUp = pin ? index.sectionByCrn?.(pin) : null;
    const pinned = pin
      ? (all.find((section) => section.crn === pin) ??
        (lookedUp && sameKey({ subject: lookedUp.subject, number: lookedUp.number }, planCourse.key) ? lookedUp : null))
      : null;
    const input = courseInput(planCourse.key, pin ? (pinned ? [pinned] : []) : all, {
      isRequired: planCourse.isRequired,
      excludedCRNs: planCourse.excludedCRNs,
      minCredits: roundCreditsUp(course?.minCredits ?? 0),
      maxCredits: roundCreditsUp(course?.maxCredits ?? 0),
    });
    input.pinnedCRN = pin;
    return input;
  });
}

export class GeneratedSchedule {
  crns: string[];
  sections: CourseSection[];
  daysOnCampus: number;
  classDays: number;
  earliestStart: number | null;
  latestEnd: number | null;
  totalGapMinutes: number;
  minSeats: number;
  totalSeats: number;
  fullSections: number;
  score: number;
  reasons: ScheduleReason[];
  sortedCRNs: string[];
  readonly id: string;

  constructor(fields: {
    crns: string[];
    sections: CourseSection[];
    daysOnCampus: number;
    classDays: number;
    earliestStart: number | null;
    latestEnd: number | null;
    totalGapMinutes: number;
    minSeats: number;
    totalSeats: number;
    fullSections: number;
    score: number;
    reasons?: ScheduleReason[];
  }) {
    this.crns = fields.crns;
    this.sections = fields.sections;
    this.daysOnCampus = fields.daysOnCampus;
    this.classDays = fields.classDays;
    this.earliestStart = fields.earliestStart;
    this.latestEnd = fields.latestEnd;
    this.totalGapMinutes = fields.totalGapMinutes;
    this.minSeats = fields.minSeats;
    this.totalSeats = fields.totalSeats;
    this.fullSections = fields.fullSections;
    this.score = fields.score;
    this.reasons = fields.reasons ?? [];
    this.sortedCRNs = [...fields.crns].sort();
    this.id = this.sortedCRNs.join("-");
  }

  /** Measures an arbitrary set of sections (favorites and the current schedule). */
  static fromSections(
    sections: readonly CourseSection[],
    preferences: SchedulePreferences = emptyPreferences(),
  ): GeneratedSchedule {
    const buildings = new ScheduleBuildingTable();
    const intervals: ScheduleInterval[] = [];
    let minSeats = Number.MAX_SAFE_INTEGER;
    let totalSeats = 0;
    let full = 0;
    let points = 0;
    const usePrefs = !isDefaultPreferences(preferences);
    for (const section of sections) {
      const own = intervalsFor(section, buildings);
      intervals.push(...own);
      if (usePrefs) points += sectionScore(section, own, preferences);
      const seats = Math.max(0, section.seatsRemaining);
      minSeats = Math.min(minSeats, seats);
      totalSeats += seats;
      if (seats === 0) full += 1;
    }
    const raw = measureIntervals(intervals, measureOptionsFor(preferences));
    const seatsFloor = minSeats === Number.MAX_SAFE_INTEGER ? 0 : minSeats;
    return new GeneratedSchedule({
      crns: sections.map((section) => section.crn),
      sections: [...sections],
      daysOnCampus: raw.campusDays,
      classDays: raw.classDays,
      earliestStart: raw.earliestStart === NO_START ? null : raw.earliestStart,
      latestEnd: raw.latestEnd === NO_END ? null : raw.latestEnd,
      totalGapMinutes: raw.gapMinutes,
      minSeats: seatsFloor,
      totalSeats,
      fullSections: full,
      score: scoreWithWeights(scoreWeightsFor(preferences), raw, full, seatsFloor) + points,
      reasons: scheduleReasons(sections, preferences),
    });
  }

  /**
   * Starred combinations, newest first. Skipped when a section is gone from the catalog
   * or its course was removed from the plan.
   */
  static favorites(
    planCourses: readonly { key: CourseKey }[],
    favoriteCombinations: readonly (readonly string[])[],
    index: Pick<ScheduleCatalogLookup, "sectionByCrn">,
    preferences: SchedulePreferences = emptyPreferences(),
  ): GeneratedSchedule[] {
    const order = new Map<string, number>();
    planCourses.forEach((course, indexInPlan) => {
      const id = keyId(course.key);
      if (!order.has(id)) order.set(id, indexInPlan);
    });
    const out: GeneratedSchedule[] = [];
    for (let i = favoriteCombinations.length - 1; i >= 0; i--) {
      const crns = favoriteCombinations[i]!;
      const sections: CourseSection[] = [];
      let complete = crns.length > 0;
      for (const crn of crns) {
        const section = index.sectionByCrn(crn);
        if (!section) {
          complete = false;
          break;
        }
        sections.push(section);
      }
      if (!complete || sections.length !== crns.length) continue;
      if (!sections.every((section) => order.has(keyId({ subject: section.subject, number: section.number })))) continue;
      sections.sort((a, b) => {
        const ao = order.get(keyId({ subject: a.subject, number: a.number })) ?? Number.MAX_SAFE_INTEGER;
        const bo = order.get(keyId({ subject: b.subject, number: b.number })) ?? Number.MAX_SAFE_INTEGER;
        return ao - bo;
      });
      out.push(GeneratedSchedule.fromSections(sections, preferences));
    }
    return out;
  }
}

export interface CourseReport {
  key: CourseKey;
  isRequired: boolean;
  totalSections: number;
  remainingSections: number;
  rejections: Partial<Record<ScheduleFilterReason, number>>;
  isBlocked: boolean;
  /** Set when a pinned CRN is not in this term's catalog. The row stays locked to it. */
  unavailableCRN?: string;
}

export type ConflictReason = "overlap" | "travelTime";

export interface ConflictPair {
  first: CourseKey;
  second: CourseKey;
  reason: ConflictReason;
}

export type CountProblem =
  | { kind: "tooManyRequired"; required: number; wanted: number }
  | { kind: "tooFewCourses"; available: number; wanted: number }
  | { kind: "creditsOverTarget"; required: number; limit: number }
  | { kind: "creditsUnderTarget"; available: number; wanted: number };

export class ScheduleDiagnostics {
  filters: ScheduleFilters;
  preferences: SchedulePreferences;
  courses: CourseReport[];
  conflictingPairs: ConflictPair[];
  countProblem: CountProblem | null;

  constructor(
    filters: ScheduleFilters = emptyScheduleFilters(),
    preferences: SchedulePreferences = emptyPreferences(),
    courses: CourseReport[] = [],
    conflictingPairs: ConflictPair[] = [],
    countProblem: CountProblem | null = null,
  ) {
    this.filters = filters;
    this.preferences = preferences;
    this.courses = courses;
    this.conflictingPairs = conflictingPairs;
    this.countProblem = countProblem;
  }

  get hasNoCourses(): boolean {
    return this.courses.length === 0;
  }

  get blockedRequiredCourses(): CourseReport[] {
    return this.courses.filter((course) => course.isRequired && course.isBlocked);
  }
}

export interface ScheduleGenerationResult {
  schedules: GeneratedSchedule[];
  totalFound: number;
  isExhaustive: boolean;
  wasCancelled: boolean;
  diagnostics: ScheduleDiagnostics;
  /** Seconds. */
  elapsed: number;
  isTruncated: boolean;
}

// MARK: - Relaxations

export type PreferenceRelaxation =
  | { kind: "softenEarliestStart" }
  | { kind: "softenLatestEnd" }
  | { kind: "softenDaysOff" }
  | { kind: "softenBlockedTime"; id: string; label: string }
  | { kind: "softenFormat" }
  | { kind: "softenCampus" }
  | { kind: "allowFullSections" }
  | { kind: "clearMaxClassesPerDay" }
  | { kind: "clearMaxMinutesPerDay" }
  | { kind: "softenMinimumBreak" }
  | { kind: "clearCreditTarget" };

export function preferenceRelaxationTitle(r: PreferenceRelaxation): string {
  switch (r.kind) {
    case "softenEarliestStart":
      return "Allow earlier classes if needed";
    case "softenLatestEnd":
      return "Allow later classes if needed";
    case "softenDaysOff":
      return "Allow classes on your days off if needed";
    case "softenBlockedTime":
      return `Allow classes during “${r.label}” if needed`;
    case "softenFormat":
      return "Allow other formats if needed";
    case "softenCampus":
      return "Allow other campuses if needed";
    case "allowFullSections":
      return "Include full sections";
    case "clearMaxClassesPerDay":
      return "Remove the classes-a-day limit";
    case "clearMaxMinutesPerDay":
      return "Remove the hours-a-day limit";
    case "softenMinimumBreak":
      return "Don’t require time to walk between classes";
    case "clearCreditTarget":
      return "Remove the credit target";
  }
}

export function preferenceRelaxationSymbol(r: PreferenceRelaxation): string {
  switch (r.kind) {
    case "softenEarliestStart":
      return "sunrise";
    case "softenLatestEnd":
      return "sunset";
    case "softenDaysOff":
      return "calendar";
    case "softenBlockedTime":
      return "calendar.badge.clock";
    case "softenFormat":
      return "wifi";
    case "softenCampus":
      return "building.2";
    case "allowFullSections":
      return "chair.lounge";
    case "clearMaxClassesPerDay":
    case "clearMaxMinutesPerDay":
      return "gauge.with.dots.needle.33percent";
    case "softenMinimumBreak":
      return "figure.walk";
    case "clearCreditTarget":
      return "number";
  }
}

export function availablePreferenceRelaxations(p: SchedulePreferences): PreferenceRelaxation[] {
  const result: PreferenceRelaxation[] = [];
  if (p.earliestStart?.strength === "required") result.push({ kind: "softenEarliestStart" });
  if (p.latestEnd?.strength === "required") result.push({ kind: "softenLatestEnd" });
  if (p.daysOff !== 0 && p.daysOffStrength === "required") result.push({ kind: "softenDaysOff" });
  for (const block of activeBlockedTimes(p)) {
    if (block.strength === "required") result.push({ kind: "softenBlockedTime", id: block.id, label: block.label });
  }
  if (p.format !== "noPreference" && p.formatStrength === "required") result.push({ kind: "softenFormat" });
  if (p.campus != null && p.campusStrength === "required") result.push({ kind: "softenCampus" });
  if (p.seats !== "any") result.push({ kind: "allowFullSections" });
  if (p.maxClassesPerDay != null) result.push({ kind: "clearMaxClassesPerDay" });
  if (p.maxMinutesPerDay != null) result.push({ kind: "clearMaxMinutesPerDay" });
  if (p.breaks === "atLeast" && p.minimumBreakStrength === "required") result.push({ kind: "softenMinimumBreak" });
  if (p.creditTarget != null) result.push({ kind: "clearCreditTarget" });
  return result;
}

export function applyPreferenceRelaxation(p: SchedulePreferences, r: PreferenceRelaxation): void {
  switch (r.kind) {
    case "softenEarliestStart":
      if (p.earliestStart) p.earliestStart.strength = "preferred";
      break;
    case "softenLatestEnd":
      if (p.latestEnd) p.latestEnd.strength = "preferred";
      break;
    case "softenDaysOff":
      p.daysOffStrength = "preferred";
      break;
    case "softenBlockedTime": {
      const index = p.blockedTimes.findIndex((block) => block.id === r.id);
      if (index >= 0) p.blockedTimes[index]!.strength = "preferred";
      break;
    }
    case "softenFormat":
      p.formatStrength = "preferred";
      break;
    case "softenCampus":
      p.campusStrength = "preferred";
      break;
    case "allowFullSections":
      p.seats = "any";
      break;
    case "clearMaxClassesPerDay":
      p.maxClassesPerDay = undefined;
      break;
    case "clearMaxMinutesPerDay":
      p.maxMinutesPerDay = undefined;
      break;
    case "softenMinimumBreak":
      p.minimumBreakStrength = "preferred";
      break;
    case "clearCreditTarget":
      p.creditTarget = undefined;
      break;
  }
}

export type ScheduleRelaxation =
  | { kind: "clearEarliestStart" }
  | { kind: "clearLatestEnd" }
  | { kind: "clearFreeDays" }
  | { kind: "allowHonors" }
  | { kind: "allowOnline" }
  | { kind: "allowFullSections" }
  | { kind: "clearCampus" }
  | { kind: "clearCourseCount" }
  | { kind: "makeOptional"; key: CourseKey }
  | { kind: "preference"; relaxation: PreferenceRelaxation };

function preferenceRelaxationKey(r: PreferenceRelaxation): string {
  return r.kind === "softenBlockedTime" ? `softenBlockedTime(${r.id}|${r.label})` : r.kind;
}

export function relaxationId(r: ScheduleRelaxation): string {
  if (r.kind === "makeOptional") return `optional-${keyId(r.key)}`;
  if (r.kind === "preference") return `preference-${preferenceRelaxationKey(r.relaxation)}`;
  return r.kind;
}

export function relaxationTitle(r: ScheduleRelaxation): string {
  switch (r.kind) {
    case "clearEarliestStart":
      return "Remove start time limit";
    case "clearLatestEnd":
      return "Remove end time limit";
    case "clearFreeDays":
      return "Allow classes on every day";
    case "allowHonors":
      return "Include honors sections";
    case "allowOnline":
      return "Include online sections";
    case "allowFullSections":
      return "Include full sections";
    case "clearCampus":
      return "Allow any campus";
    case "clearCourseCount":
      return "Use any number of courses";
    case "makeOptional":
      return `Make ${keyId(r.key)} optional`;
    case "preference":
      return preferenceRelaxationTitle(r.relaxation);
  }
}

export function relaxationSymbol(r: ScheduleRelaxation): string {
  switch (r.kind) {
    case "clearEarliestStart":
      return "sunrise";
    case "clearLatestEnd":
      return "sunset";
    case "clearFreeDays":
      return "calendar";
    case "allowHonors":
      return "star";
    case "allowOnline":
      return "wifi";
    case "allowFullSections":
      return "chair.lounge";
    case "clearCampus":
      return "building.2";
    case "clearCourseCount":
      return "number";
    case "makeOptional":
      return "questionmark.circle";
    case "preference":
      return preferenceRelaxationSymbol(r.relaxation);
  }
}

export function applyFilterRelaxation(filters: ScheduleFilters, r: ScheduleRelaxation): void {
  switch (r.kind) {
    case "clearEarliestStart":
      filters.earliestStart = undefined;
      break;
    case "clearLatestEnd":
      filters.latestEnd = undefined;
      break;
    case "clearFreeDays":
      filters.freeDays = 0;
      break;
    case "allowHonors":
      filters.includeHonors = true;
      break;
    case "allowOnline":
      filters.includeOnline = true;
      break;
    case "allowFullSections":
      filters.hideFullSections = false;
      filters.minSeats = 0;
      break;
    case "clearCampus":
      filters.campus = undefined;
      break;
    case "clearCourseCount":
      filters.courseCount = undefined;
      break;
    default:
      break;
  }
}

export function applyRelaxationToPreferences(preferences: SchedulePreferences, r: ScheduleRelaxation): void {
  if (r.kind === "preference") applyPreferenceRelaxation(preferences, r.relaxation);
}

export interface RelaxablePlan {
  courses: { key: CourseKey; isRequired: boolean }[];
  filters: ScheduleFilters;
  preferences?: SchedulePreferences | null;
}

function clonePreferences(p: SchedulePreferences): SchedulePreferences {
  return {
    ...p,
    timeOfDay: { ...p.timeOfDay },
    earliestStart: p.earliestStart ? { ...p.earliestStart } : p.earliestStart,
    latestEnd: p.latestEnd ? { ...p.latestEnd } : p.latestEnd,
    lunch: p.lunch ? { ...p.lunch } : p.lunch,
    blockedTimes: p.blockedTimes.map((block) => ({ ...block })),
    preferredInstructors: [...p.preferredInstructors],
    avoidedInstructors: [...p.avoidedInstructors],
    creditTarget: p.creditTarget ? { ...p.creditTarget } : p.creditTarget,
  };
}

/** Applies one "no schedules fit" suggestion to a plan-shaped object. */
export function applyRelaxation(relaxation: ScheduleRelaxation, plan: RelaxablePlan): void {
  if (relaxation.kind === "makeOptional") {
    const course = plan.courses.find((entry) => sameKey(entry.key, relaxation.key));
    if (course) course.isRequired = false;
    return;
  }
  if (relaxation.kind === "preference") {
    const preferences = clonePreferences(plan.preferences ?? emptyPreferences());
    applyPreferenceRelaxation(preferences, relaxation.relaxation);
    plan.preferences = isDefaultPreferences(preferences) ? null : preferences;
    return;
  }
  applyFilterRelaxation(plan.filters, relaxation);
}

export function makeCoursesOptional(
  keys: readonly CourseKey[],
  courses: { key: CourseKey; isRequired: boolean }[],
): void {
  for (const key of keys) {
    const course = courses.find((entry) => sameKey(entry.key, key));
    if (course) course.isRequired = false;
  }
}

export interface ScheduleSuggestion {
  relaxation: ScheduleRelaxation;
  scheduleCount: number;
  isLowerBound: boolean;
  id: string;
}

// MARK: - Limits

export interface GeneratorLimits {
  maxResults: number;
  maxExhaustiveLeaves: number;
  maxNodes: number;
  /** Seconds. */
  timeBudget: number;
  sampleLeaves: number;
  sampleTimeBudget: number;
  allowSampling: boolean;
}

export const STANDARD_LIMITS: GeneratorLimits = {
  maxResults: 5_000,
  maxExhaustiveLeaves: 2_500_000,
  maxNodes: 12_000_000,
  timeBudget: 0.9,
  sampleLeaves: 150_000,
  sampleTimeBudget: 0.35,
  allowSampling: true,
};

export const PROBE_LIMITS: GeneratorLimits = {
  maxResults: 1,
  maxExhaustiveLeaves: 300,
  maxNodes: 300_000,
  timeBudget: 0.25,
  sampleLeaves: 0,
  sampleTimeBudget: 0,
  allowSampling: false,
};

export const BLOCKER_PROBE_LIMITS: GeneratorLimits = {
  maxResults: 1,
  maxExhaustiveLeaves: 1_000,
  maxNodes: 250_000,
  timeBudget: 0.15,
  sampleLeaves: 0,
  sampleTimeBudget: 0,
  allowSampling: false,
};

const INT32_MAX = 2147483647;

// MARK: - Generate

export function generateSchedules(
  courses: readonly ScheduleCourseInput[],
  filters: ScheduleFilters,
  preferences: SchedulePreferences = emptyPreferences(),
  sort: ScheduleSortOption = "best",
  limits: GeneratorLimits = STANDARD_LIMITS,
  isCancelled?: () => boolean,
): ScheduleGenerationResult {
  const started = nowMs();
  const result = run(courses, filters, normalizePreferences(preferences), sort, limits, isCancelled);
  result.elapsed = (nowMs() - started) / 1000;
  result.isTruncated = !result.isExhaustive || result.schedules.length < result.totalFound;
  return result;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function run(
  courses: readonly ScheduleCourseInput[],
  filters: ScheduleFilters,
  preferences: SchedulePreferences,
  sort: ScheduleSortOption,
  limits: GeneratorLimits,
  isCancelled?: () => boolean,
): ScheduleGenerationResult {
  const result: ScheduleGenerationResult = {
    schedules: [],
    totalFound: 0,
    isExhaustive: true,
    wasCancelled: false,
    diagnostics: new ScheduleDiagnostics({ ...filters }, preferences),
    elapsed: 0,
    isTruncated: false,
  };
  const hasPreferences = !isDefaultPreferences(preferences);

  const kept: CourseSection[][] = [];
  const reports: CourseReport[] = [];
  const pinnedElsewhere = new Set(courses.flatMap((course) => (course.pinnedCRN ? [course.pinnedCRN] : [])));
  for (const course of courses) {
    if (course.pinnedCRN) {
      const pinned = course.sections.find((section) => section.crn === course.pinnedCRN) ?? null;
      kept.push(pinned ? [pinned] : []);
      reports.push({
        key: course.key,
        isRequired: course.isRequired,
        totalSections: pinned ? course.sections.length : 0,
        remainingSections: pinned ? 1 : 0,
        rejections: {},
        isBlocked: pinned == null,
        ...(pinned ? {} : { unavailableCRN: course.pinnedCRN }),
      });
      continue;
    }
    const remaining: CourseSection[] = [];
    const rejections: Partial<Record<ScheduleFilterReason, number>> = {};
    const excluded = course.excludedCRNs ?? EMPTY_EXCLUSIONS;
    for (const section of course.sections) {
      if (pinnedElsewhere.has(section.crn)) continue;
      const reasons = rejectionReasons(section, filters, preferences, excluded);
      if (reasons === 0) {
        remaining.push(section);
      } else {
        for (const reason of reasonList()) {
          if ((reasons & filterReasonBit(reason)) !== 0) rejections[reason] = (rejections[reason] ?? 0) + 1;
        }
      }
    }
    kept.push(remaining);
    reports.push({
      key: course.key,
      isRequired: course.isRequired,
      totalSections: course.sections.length,
      remainingSections: remaining.length,
      rejections,
      isBlocked: remaining.length === 0,
    });
  }
  result.diagnostics = new ScheduleDiagnostics({ ...filters }, preferences, reports);

  const requiredIndexes: number[] = [];
  const optionalIndexes: number[] = [];
  for (let i = 0; i < courses.length; i++) {
    if (courses[i]!.isRequired) requiredIndexes.push(i);
    else if (kept[i]!.length > 0) optionalIndexes.push(i);
  }
  const rawTarget = filters.courseCount;
  const target = rawTarget != null && rawTarget > 0 ? rawTarget : null;
  const credit = preferences.creditTarget;
  const creditWindow = credit ? { lower: credit.lower, upper: credit.upper } : null;

  if (courses.length === 0) return result;
  if (requiredIndexes.some((index) => kept[index]!.length === 0)) return result;
  if (target != null) {
    if (requiredIndexes.length > target) {
      result.diagnostics.countProblem = { kind: "tooManyRequired", required: requiredIndexes.length, wanted: target };
      return result;
    }
    if (requiredIndexes.length + optionalIndexes.length < target) {
      result.diagnostics.countProblem = {
        kind: "tooFewCourses",
        available: requiredIndexes.length + optionalIndexes.length,
        wanted: target,
      };
      return result;
    }
  }
  if (creditWindow) {
    let required = 0;
    for (const index of requiredIndexes) required += courses[index]!.minCredits ?? 0;
    if (required > creditWindow.upper) {
      result.diagnostics.countProblem = { kind: "creditsOverTarget", required, limit: creditWindow.upper };
      return result;
    }
    let available = 0;
    for (const index of requiredIndexes) available += courses[index]!.maxCredits ?? 0;
    for (const index of optionalIndexes) available += courses[index]!.maxCredits ?? 0;
    if (available < creditWindow.lower) {
      result.diagnostics.countProblem = { kind: "creditsUnderTarget", available, wanted: creditWindow.lower };
      return result;
    }
  }

  const ordered = (indexes: number[]) =>
    indexes.slice().sort((a, b) => {
      const diff = kept[a]!.length - kept[b]!.length;
      return diff !== 0 ? diff : a - b;
    });
  const searchOrder = [...ordered(requiredIndexes), ...ordered(optionalIndexes)];
  if (searchOrder.length === 0) return result;

  const sections: CourseSection[] = [];
  const masks: ScheduleSlotMask[] = [];
  const weekly: Meeting[][] = [];
  const intervalStart: number[] = [];
  const intervals: ScheduleInterval[] = [];
  const sectionPoints: number[] = [];
  const dayClasses: number[][] = [];
  const dayMinutes: number[][] = [];
  const buildings = new ScheduleBuildingTable();
  const slots: SearchSlot[] = [];
  const slotMinCredits: number[] = [];
  const slotMaxCredits: number[] = [];

  for (const courseIndex of searchOrder) {
    const first = sections.length;
    const candidates: { section: CourseSection; intervals: ScheduleInterval[]; points: number; offset: number }[] = [];
    kept[courseIndex]!.forEach((section, offset) => {
      const own = intervalsFor(section, buildings);
      const points = hasPreferences ? sectionScore(section, own, preferences) : 0;
      candidates.push({ section, intervals: own, points, offset });
    });
    if (hasPreferences) {
      candidates.sort((a, b) => (a.points !== b.points ? (a.points > b.points ? -1 : 1) : a.offset - b.offset));
    }
    for (const candidate of candidates) {
      sections.push(candidate.section);
      const meetings = weeklyMeetings(candidate.section);
      weekly.push(meetings);
      masks.push(new ScheduleSlotMask(meetings));
      intervalStart.push(intervals.length);
      intervals.push(...candidate.intervals);
      sectionPoints.push(candidate.points);
      const load = dayLoad(candidate.intervals);
      dayClasses.push(load.classes);
      dayMinutes.push(load.minutes);
    }
    slots.push({
      courseIndex,
      isRequired: courses[courseIndex]!.isRequired,
      start: first,
      size: sections.length - first,
    });
    const minCredits = courses[courseIndex]!.minCredits ?? 0;
    const maxCredits = courses[courseIndex]!.maxCredits ?? 0;
    slotMinCredits.push(minCredits);
    slotMaxCredits.push(Math.max(minCredits, maxCredits));
  }
  intervalStart.push(intervals.length);

  const rules: SearchRules = {
    maxClassesPerDay: preferences.maxClassesPerDay ?? INT32_MAX,
    maxMinutesPerDay: preferences.maxMinutesPerDay ?? INT32_MAX,
    dayClasses,
    dayMinutes,
    travelMinutes:
      preferences.breaks === "atLeast" && preferences.minimumBreakStrength === "required"
        ? preferences.minimumBreakMinutes
        : 0,
    creditWindow,
    slotMinCredits,
    slotMaxCredits,
  };

  const collector = new ScheduleCollector(
    sort,
    Math.max(1, limits.maxResults),
    slots.map((slot) => slot.start),
    intervalStart,
    intervals,
    sections.map((section) => Math.max(0, section.seatsRemaining)),
    sectionPoints,
    scoreWeightsFor(preferences),
    measureOptionsFor(preferences),
  );
  const search = new ScheduleSearch(
    slots,
    masks,
    weekly,
    sections,
    target,
    rules,
    limits,
    collector,
    fnvSeed(sections),
    isCancelled,
  );

  search.runExhaustive();
  if (search.cancelled) {
    result.wasCancelled = true;
    return result;
  }
  let totalFound = search.leafCount;
  let exhaustive = !search.hitLimit;
  if (search.hitLimit) {
    exhaustive = false;
    if (limits.allowSampling && limits.sampleLeaves > 0) {
      search.runSampled();
      if (search.cancelled) {
        result.wasCancelled = true;
        return result;
      }
      totalFound = Math.max(totalFound, search.leafCount);
    }
  }
  result.totalFound = totalFound;
  result.isExhaustive = exhaustive;
  if (totalFound === 0) {
    if (exhaustive) result.diagnostics.conflictingPairs = conflictingPairs(search, slots, courses);
    return result;
  }

  const schedules: GeneratedSchedule[] = [];
  for (const ranked of collector.ranked()) {
    const picked: { course: number; id: number }[] = [];
    for (let s = 0; s < slots.length; s++) {
      const pick = ranked.picks[s]!;
      if (pick === SKIP_MARKER) continue;
      picked.push({ course: slots[s]!.courseIndex, id: slots[s]!.start + pick });
    }
    picked.sort((a, b) => a.course - b.course);
    const chosen = picked.map((item) => sections[item.id]!);
    const m = ranked.metrics;
    schedules.push(
      new GeneratedSchedule({
        crns: chosen.map((section) => section.crn),
        sections: chosen,
        daysOnCampus: m.campusDays,
        classDays: m.classDays,
        earliestStart: m.earliest === NO_START ? null : m.earliest,
        latestEnd: m.classDays === 0 ? null : m.latest,
        totalGapMinutes: m.gap,
        minSeats: m.minSeats,
        totalSeats: m.totalSeats,
        fullSections: m.full,
        score: m.score,
        reasons: hasPreferences ? scheduleReasons(chosen, preferences) : [],
      }),
    );
  }
  result.schedules = schedules;
  return result;
}

function dayLoad(own: readonly ScheduleInterval[]): { classes: number[]; minutes: number[] } {
  const classes = [0, 0, 0, 0, 0, 0, 0, 0];
  const minutes = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const interval of own) {
    const day = interval.day;
    if (day < 0 || day > 6) continue;
    classes[day] = 1;
    minutes[day] = (minutes[day] ?? 0) + (interval.end - interval.start);
  }
  return { classes, minutes };
}

const FILTER_REASON_LIST: ScheduleFilterReason[] = [
  "excludedByUser",
  "startsTooEarly",
  "endsTooLate",
  "freeDay",
  "honors",
  "online",
  "seats",
  "campus",
  "blockedTime",
  "prefStartsTooEarly",
  "prefEndsTooLate",
  "prefDayOff",
  "prefFormat",
  "prefSeats",
  "prefCampus",
  "prefWorkload",
];

function reasonList(): readonly ScheduleFilterReason[] {
  return FILTER_REASON_LIST;
}

function conflictingPairs(
  search: ScheduleSearch,
  slots: readonly SearchSlot[],
  courses: readonly ScheduleCourseInput[],
): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let a = 0; a < slots.length; a++) {
    if (!slots[a]!.isRequired) continue;
    for (let b = a + 1; b < slots.length; b++) {
      if (!slots[b]!.isRequired) continue;
      if (search.hasCompatiblePair(a, b)) continue;
      pairs.push({
        first: courses[slots[a]!.courseIndex]!.key,
        second: courses[slots[b]!.courseIndex]!.key,
        reason: search.hasOverlapFreePair(a, b) ? "travelTime" : "overlap",
      });
    }
  }
  return pairs;
}

export function suggestRelaxations(
  courses: readonly ScheduleCourseInput[],
  filters: ScheduleFilters,
  preferences: SchedulePreferences = emptyPreferences(),
  includeCourseRelaxations = true,
  isCancelled?: () => boolean,
): ScheduleSuggestion[] {
  const candidates: {
    relaxation: ScheduleRelaxation;
    filters: ScheduleFilters;
    preferences: SchedulePreferences;
    courses: readonly ScheduleCourseInput[];
  }[] = [];

  const addFilter = (relaxation: ScheduleRelaxation, active: boolean) => {
    if (!active) return;
    const relaxed = { ...filters };
    applyFilterRelaxation(relaxed, relaxation);
    candidates.push({ relaxation, filters: relaxed, preferences, courses });
  };
  addFilter({ kind: "clearEarliestStart" }, filters.earliestStart != null);
  addFilter({ kind: "clearLatestEnd" }, filters.latestEnd != null);
  addFilter({ kind: "clearFreeDays" }, filters.freeDays !== 0);
  addFilter({ kind: "allowHonors" }, !filters.includeHonors);
  addFilter({ kind: "allowOnline" }, !filters.includeOnline);
  addFilter({ kind: "allowFullSections" }, filters.hideFullSections || filters.minSeats > 0);
  addFilter({ kind: "clearCampus" }, filters.campus != null);
  addFilter({ kind: "clearCourseCount" }, filters.courseCount != null);
  for (const relaxation of availablePreferenceRelaxations(preferences)) {
    const relaxed = clonePreferences(preferences);
    applyPreferenceRelaxation(relaxed, relaxation);
    candidates.push({ relaxation: { kind: "preference", relaxation }, filters, preferences: relaxed, courses });
  }
  if (includeCourseRelaxations) {
    courses.forEach((course, index) => {
      if (!course.isRequired || courses.length <= 1) return;
      const relaxedCourses = courses.map((entry, i) => (i === index ? { ...entry, isRequired: false } : entry));
      candidates.push({
        relaxation: { kind: "makeOptional", key: course.key },
        filters,
        preferences,
        courses: relaxedCourses,
      });
    });
  }

  const suggestions: ScheduleSuggestion[] = [];
  for (const candidate of candidates) {
    if (isCancelled?.()) break;
    const probe = generateSchedules(
      candidate.courses,
      candidate.filters,
      candidate.preferences,
      "best",
      PROBE_LIMITS,
      isCancelled,
    );
    if (probe.totalFound <= 0) continue;
    suggestions.push({
      relaxation: candidate.relaxation,
      scheduleCount: probe.totalFound,
      isLowerBound: !probe.isExhaustive,
      id: relaxationId(candidate.relaxation),
    });
  }
  suggestions.sort((a, b) => b.scheduleCount - a.scheduleCount);
  return suggestions;
}

// MARK: - Blockers

export interface ScheduleBlockerOption {
  courses: CourseKey[];
  scheduleCount: number;
  isLowerBound: boolean;
  id: string;
}

export class ScheduleBlockerAnalysis {
  requiredCount = 0;
  notOffered: CourseKey[] = [];
  filteredOut: CourseKey[] = [];
  /** Pinned CRNs that are no longer in the catalog. The row stays locked. */
  unavailable: { key: CourseKey; crn: string }[] = [];
  options: ScheduleBlockerOption[] = [];
  conflictingPairs: ConflictPair[] = [];
  isIncomplete = false;

  get unschedulable(): CourseKey[] {
    return [...this.notOffered, ...this.filteredOut];
  }

  get blockingCourses(): CourseKey[] {
    return this.options[0]?.courses ?? [];
  }

  get allBlockingCourses(): CourseKey[] {
    const seen = new Set<string>();
    const out: CourseKey[] = [];
    for (const option of this.options) {
      for (const key of option.courses) {
        const id = keyId(key);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(key);
      }
    }
    return out;
  }

  clashes(key: CourseKey): CourseKey[] {
    const out: CourseKey[] = [];
    for (const pair of this.conflictingPairs) {
      if (sameKey(pair.first, key)) out.push(pair.second);
      else if (sameKey(pair.second, key)) out.push(pair.first);
    }
    return out;
  }
}

/** Restores class methods after a schedule result crosses a worker boundary. */
export function reviveDiagnostics(raw: ScheduleDiagnostics): ScheduleDiagnostics {
  return new ScheduleDiagnostics(raw.filters, raw.preferences, raw.courses ?? [], raw.conflictingPairs ?? [], raw.countProblem ?? null);
}

export function reviveBlockerAnalysis(raw: ScheduleBlockerAnalysis): ScheduleBlockerAnalysis {
  const analysis = new ScheduleBlockerAnalysis();
  analysis.requiredCount = raw.requiredCount ?? 0;
  analysis.notOffered = raw.notOffered ?? [];
  analysis.filteredOut = raw.filteredOut ?? [];
  analysis.unavailable = raw.unavailable ?? [];
  analysis.options = raw.options ?? [];
  analysis.conflictingPairs = raw.conflictingPairs ?? [];
  analysis.isIncomplete = !!raw.isIncomplete;
  return analysis;
}

export function analyzeBlockers(
  courses: readonly ScheduleCourseInput[],
  filters: ScheduleFilters,
  preferences: SchedulePreferences = emptyPreferences(),
  diagnostics?: ScheduleDiagnostics,
  timeBudget = 1.5,
  maxProbes = 60,
  isCancelled?: () => boolean,
): ScheduleBlockerAnalysis {
  const started = nowMs();
  const analysis = new ScheduleBlockerAnalysis();
  const required: number[] = [];
  courses.forEach((course, index) => {
    if (course.isRequired) required.push(index);
  });
  analysis.requiredCount = required.length;
  if (required.length === 0) return analysis;

  const base =
    diagnostics ??
    generateSchedules(courses, filters, preferences, "best", PROBE_LIMITS, isCancelled).diagnostics;
  analysis.conflictingPairs = base.conflictingPairs;
  if (base.countProblem != null || base.courses.length !== courses.length) return analysis;

  const dead: number[] = [];
  for (const index of required) {
    const report = base.courses[index]!;
    if (!report.isBlocked) continue;
    dead.push(index);
    if (report.unavailableCRN) analysis.unavailable.push({ key: courses[index]!.key, crn: report.unavailableCRN });
    else if (report.totalSections === 0) analysis.notOffered.push(courses[index]!.key);
    else analysis.filteredOut.push(courses[index]!.key);
  }
  const deadSet = new Set(dead);
  const others = required.filter((index) => !deadSet.has(index));

  let probes = 0;
  const overBudget = () =>
    (isCancelled?.() ?? false) || probes >= maxProbes || nowMs() - started > timeBudget * 1000;

  const probe = (drop: number[]): ScheduleBlockerOption | null => {
    probes += 1;
    const dropSet = new Set(drop);
    const relaxed = courses.map((course, index) => (dropSet.has(index) ? { ...course, isRequired: false } : course));
    const found = generateSchedules(relaxed, filters, preferences, "best", BLOCKER_PROBE_LIMITS, isCancelled);
    if (found.totalFound <= 0) return null;
    const keys = [...drop].sort((a, b) => a - b).map((index) => courses[index]!.key);
    return {
      courses: keys,
      scheduleCount: found.totalFound,
      isLowerBound: !found.isExhaustive,
      id: keys.map((key) => keyId(key)).join("+"),
    };
  };

  const found: ScheduleBlockerOption[] = [];
  if (dead.length > 0) {
    const option = probe(dead);
    if (option) found.push(option);
  }
  if (found.length === 0) {
    for (const index of others) {
      if (overBudget()) {
        analysis.isIncomplete = true;
        break;
      }
      const option = probe([...dead, index]);
      if (option) found.push(option);
    }
  }
  if (found.length === 0 && !analysis.isIncomplete && others.length >= 2) {
    let stop = false;
    for (let i = 0; i < others.length && !stop; i++) {
      for (let j = i + 1; j < others.length; j++) {
        if (overBudget()) {
          analysis.isIncomplete = true;
          stop = true;
          break;
        }
        const option = probe([...dead, others[i]!, others[j]!]);
        if (option) found.push(option);
      }
    }
  }
  analysis.options = found.sort((a, b) => {
    if (a.courses.length !== b.courses.length) return a.courses.length - b.courses.length;
    return b.scheduleCount - a.scheduleCount;
  });
  return analysis;
}

// MARK: - Ranking

interface LeafMetrics {
  classDays: number;
  campusDays: number;
  earliest: number;
  latest: number;
  gap: number;
  minSeats: number;
  totalSeats: number;
  full: number;
  score: number;
}

function precedes(sort: ScheduleSortOption, a: LeafMetrics, b: LeafMetrics, tieBreak: boolean): boolean {
  switch (sort) {
    case "best":
      break;
    case "fewestDays":
      if (a.campusDays !== b.campusDays) return a.campusDays < b.campusDays;
      if (a.classDays !== b.classDays) return a.classDays < b.classDays;
      if (a.gap !== b.gap) return a.gap < b.gap;
      break;
    case "latestStart":
      if (a.earliest !== b.earliest) return a.earliest > b.earliest;
      if (a.campusDays !== b.campusDays) return a.campusDays < b.campusDays;
      break;
    case "earliestFinish":
      if (a.latest !== b.latest) return a.latest < b.latest;
      if (a.campusDays !== b.campusDays) return a.campusDays < b.campusDays;
      break;
    case "fewestGaps":
      if (a.gap !== b.gap) return a.gap < b.gap;
      if (a.campusDays !== b.campusDays) return a.campusDays < b.campusDays;
      break;
    case "mostSeats":
      if (a.minSeats !== b.minSeats) return a.minSeats > b.minSeats;
      if (a.totalSeats !== b.totalSeats) return a.totalSeats > b.totalSeats;
      break;
  }
  if (a.score !== b.score) return a.score > b.score;
  return tieBreak;
}

const SKIP_MARKER = 0xffff;

interface CollectorEntry {
  metrics: LeafMetrics;
  seq: number;
  hash: bigint;
  base: number;
}

class ScheduleCollector {
  private entries: CollectorEntry[] = [];
  private pickStore: number[] = [];
  private members = new Set<bigint>();
  private nextSeq = 0;
  private readonly slotCount: number;

  constructor(
    private readonly sort: ScheduleSortOption,
    private readonly capacity: number,
    private readonly slotStart: readonly number[],
    private readonly intervalStart: readonly number[],
    private readonly intervals: readonly ScheduleInterval[],
    private readonly seatsRemaining: readonly number[],
    private readonly sectionPoints: readonly number[],
    private readonly weights: ScoreWeights,
    private readonly options: ScheduleMeasureOptions,
  ) {
    this.slotCount = slotStart.length;
  }

  get count(): number {
    return this.entries.length;
  }

  offer(picks: readonly number[]): void {
    const scratch: ScheduleInterval[] = [];
    let minSeats = Number.MAX_SAFE_INTEGER;
    let totalSeats = 0;
    let full = 0;
    let points = 0;
    for (let s = 0; s < this.slotCount; s++) {
      const pick = picks[s]!;
      if (pick < 0) continue;
      const g = this.slotStart[s]! + pick;
      for (let k = this.intervalStart[g]!; k < this.intervalStart[g + 1]!; k++) scratch.push(this.intervals[k]!);
      const seats = this.seatsRemaining[g]!;
      minSeats = Math.min(minSeats, seats);
      totalSeats += seats;
      if (seats === 0) full += 1;
      points += this.sectionPoints[g]!;
    }
    const raw = measureIntervals(scratch, this.options);
    const seatsFloor = minSeats === Number.MAX_SAFE_INTEGER ? 0 : minSeats;
    const metrics: LeafMetrics = {
      classDays: raw.classDays,
      campusDays: raw.campusDays,
      earliest: raw.earliestStart,
      latest: raw.latestEnd === NO_END ? 0 : raw.latestEnd,
      gap: raw.gapMinutes,
      minSeats: seatsFloor,
      totalSeats,
      full,
      score: scoreWithWeights(this.weights, raw, full, seatsFloor) + points,
    };

    const seq = this.nextSeq;
    this.nextSeq += 1;
    if (this.entries.length === this.capacity) {
      if (!precedes(this.sort, metrics, this.entries[0]!.metrics, false)) return;
    }
    const hash = fnvPicks(picks);
    if (this.members.has(hash)) return;
    this.members.add(hash);
    if (this.entries.length < this.capacity) {
      const base = this.entries.length * this.slotCount;
      for (let s = 0; s < this.slotCount; s++) this.pickStore.push(0);
      this.store(picks, base);
      this.entries.push({ metrics, seq, hash, base });
      this.siftUp(this.entries.length - 1);
    } else {
      const base = this.entries[0]!.base;
      this.members.delete(this.entries[0]!.hash);
      this.store(picks, base);
      this.entries[0] = { metrics, seq, hash, base };
      this.siftDown(0);
    }
  }

  ranked(): { metrics: LeafMetrics; picks: number[] }[] {
    const sorted = this.entries.slice().sort((a, b) => {
      if (precedes(this.sort, a.metrics, b.metrics, a.seq < b.seq)) return -1;
      if (precedes(this.sort, b.metrics, a.metrics, b.seq < a.seq)) return 1;
      return 0;
    });
    return sorted.map((entry) => ({
      metrics: entry.metrics,
      picks: this.pickStore.slice(entry.base, entry.base + this.slotCount),
    }));
  }

  private store(picks: readonly number[], base: number): void {
    for (let s = 0; s < this.slotCount; s++) {
      const pick = picks[s]!;
      this.pickStore[base + s] = pick < 0 ? SKIP_MARKER : pick & 0xffff;
    }
  }

  private isWorse(a: CollectorEntry, b: CollectorEntry): boolean {
    return precedes(this.sort, b.metrics, a.metrics, b.seq < a.seq);
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!this.isWorse(this.entries[child]!, this.entries[parent]!)) return;
      const tmp = this.entries[child]!;
      this.entries[child] = this.entries[parent]!;
      this.entries[parent] = tmp;
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    const n = this.entries.length;
    while (true) {
      const left = 2 * parent + 1;
      const right = left + 1;
      let worst = parent;
      if (left < n && this.isWorse(this.entries[left]!, this.entries[worst]!)) worst = left;
      if (right < n && this.isWorse(this.entries[right]!, this.entries[worst]!)) worst = right;
      if (worst === parent) return;
      const tmp = this.entries[parent]!;
      this.entries[parent] = this.entries[worst]!;
      this.entries[worst] = tmp;
      parent = worst;
    }
  }
}

// MARK: - Search

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnvSeed(sections: readonly CourseSection[]): bigint {
  let hash = FNV_OFFSET;
  const encoder = new TextEncoder();
  for (const section of sections) {
    for (const byte of encoder.encode(section.crn)) {
      hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK64;
    }
  }
  return hash;
}

function fnvPicks(picks: readonly number[]): bigint {
  let hash = FNV_OFFSET;
  for (const pick of picks) {
    hash = ((hash ^ (BigInt(pick + 1) & MASK64)) * FNV_PRIME) & MASK64;
  }
  return hash;
}

class SplitMix64 {
  state: bigint;
  constructor(seed: bigint) {
    this.state = seed & MASK64;
  }
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  }
}

function mulFull(a: bigint, b: bigint): { high: bigint; low: bigint } {
  const product = a * b;
  return { high: product >> 64n, low: product & MASK64 };
}

/** Lemire's nearly-divisionless `RandomNumberGenerator.next(upperBound:)`. */
function nextBelow(rng: SplitMix64, upper: bigint): bigint {
  let random = rng.next();
  let m = mulFull(random, upper);
  if (m.low < upper) {
    const t = ((0n - upper) & MASK64) % upper;
    while (m.low < t) {
      random = rng.next();
      m = mulFull(random, upper);
    }
  }
  return m.high;
}

function shuffleWith(items: number[], rng: SplitMix64): void {
  let amount = items.length;
  let index = 0;
  while (amount > 1) {
    const random = Number(nextBelow(rng, BigInt(amount)));
    amount -= 1;
    const swapAt = index + random;
    const tmp = items[index]!;
    items[index] = items[swapAt]!;
    items[swapAt] = tmp;
    index += 1;
  }
}

interface SearchSlot {
  courseIndex: number;
  isRequired: boolean;
  start: number;
  size: number;
}

interface CreditWindow {
  lower: number;
  upper: number;
}

interface SearchRules {
  maxClassesPerDay: number;
  maxMinutesPerDay: number;
  dayClasses: number[][];
  dayMinutes: number[][];
  travelMinutes: number;
  creditWindow: CreditWindow | null;
  slotMinCredits: number[];
  slotMaxCredits: number[];
}

function wordsFor(size: number): number {
  return (size + 31) >> 5;
}

function maskLow(n: number): number {
  if (n >= 32) return 0xffffffff;
  if (n <= 0) return 0;
  return (0xffffffff >>> (32 - n)) >>> 0;
}

function meetingsConflict(a: readonly Meeting[], b: readonly Meeting[]): boolean {
  return a.some((first) => b.some((second) => meetingOverlaps(first, second)));
}

class ScheduleSearch {
  private readonly slotCount: number;
  private readonly slotWords: number[];
  private readonly domainOffset: number[];
  private readonly domainTotal: number;
  private readonly compatOffsets: Int32Array;
  private readonly compat: Uint32Array;
  private readonly domains: Uint32Array;
  private readonly limitsDays: boolean;
  private loadClasses = [0, 0, 0, 0, 0, 0, 0, 0];
  private loadMinutes = [0, 0, 0, 0, 0, 0, 0, 0];
  private creditsMin = 0;
  private creditsMax = 0;
  private maxLeaves = 0;
  private deadline = 0;
  private picks: number[];
  private chosen = 0;
  private nodes = 0;
  private readonly rng: SplitMix64;

  leafCount = 0;
  hitLimit = false;
  cancelled = false;
  private aborted = false;

  constructor(
    private readonly slots: readonly SearchSlot[],
    private readonly masks: readonly ScheduleSlotMask[],
    private readonly weekly: readonly Meeting[][],
    sections: readonly CourseSection[],
    private readonly target: number | null,
    private readonly rules: SearchRules,
    private readonly limits: GeneratorLimits,
    private readonly collector: ScheduleCollector,
    seed: bigint,
    private readonly isCancelled?: () => boolean,
  ) {
    this.slotCount = slots.length;
    this.limitsDays = rules.maxClassesPerDay !== INT32_MAX || rules.maxMinutesPerDay !== INT32_MAX;
    this.rng = new SplitMix64(seed);
    this.picks = Array.from({ length: slots.length }, () => -1);
    this.slotWords = slots.map((slot) => wordsFor(slot.size));
    this.domainOffset = [];
    let total = 0;
    for (const words of this.slotWords) {
      this.domainOffset.push(total);
      total += words;
    }
    this.domainTotal = Math.max(1, total);

    const sectionTotal = masks.length;
    this.compatOffsets = new Int32Array(Math.max(1, sectionTotal * this.slotCount));
    let cursor = 0;
    for (let g = 0; g < sectionTotal; g++) {
      for (let s = 0; s < this.slotCount; s++) {
        this.compatOffsets[g * this.slotCount + s] = cursor;
        cursor += this.slotWords[s]!;
      }
    }
    this.compat = new Uint32Array(Math.max(1, cursor));

    const slotOf = new Int32Array(sectionTotal);
    for (let s = 0; s < this.slotCount; s++) {
      const slot = slots[s]!;
      for (let g = slot.start; g < slot.start + slot.size; g++) slotOf[g] = s;
    }
    for (let g = 0; g < sectionTotal; g++) {
      const own = slotOf[g]!;
      for (let s = 0; s < this.slotCount; s++) {
        if (s === own) continue;
        const base = this.compatOffsets[g * this.slotCount + s]!;
        const slot = slots[s]!;
        for (let j = 0; j < slot.size; j++) {
          const h = slot.start + j;
          if (sections[g]!.crn === sections[h]!.crn) continue;
          if (masks[g]!.conflicts(masks[h]!) && meetingsConflict(weekly[g]!, weekly[h]!)) continue;
          if (
            rules.travelMinutes > 0 &&
            sectionsTooClose(sections[g]!, weekly[g]!, sections[h]!, weekly[h]!, rules.travelMinutes)
          ) {
            continue;
          }
          this.compat[base + (j >> 5)] = (this.compat[base + (j >> 5)]! | (1 << (j & 31))) >>> 0;
        }
      }
    }
    this.domains = new Uint32Array((this.slotCount + 1) * this.domainTotal);
  }

  hasCompatiblePair(slotA: number, slotB: number): boolean {
    const words = this.slotWords[slotB]!;
    const slot = this.slots[slotA]!;
    for (let j = 0; j < slot.size; j++) {
      const g = slot.start + j;
      const base = this.compatOffsets[g * this.slotCount + slotB]!;
      for (let k = 0; k < words; k++) if (this.compat[base + k] !== 0) return true;
    }
    return false;
  }

  hasOverlapFreePair(slotA: number, slotB: number): boolean {
    if (this.rules.travelMinutes <= 0) return this.hasCompatiblePair(slotA, slotB);
    const a = this.slots[slotA]!;
    const b = this.slots[slotB]!;
    for (let i = 0; i < a.size; i++) {
      for (let j = 0; j < b.size; j++) {
        const g = a.start + i;
        const h = b.start + j;
        if (!(this.masks[g]!.conflicts(this.masks[h]!) && meetingsConflict(this.weekly[g]!, this.weekly[h]!))) return true;
      }
    }
    return false;
  }

  private reset(maxLeaves: number, timeBudget: number): void {
    this.maxLeaves = Math.max(1, maxLeaves);
    this.leafCount = 0;
    this.hitLimit = false;
    this.aborted = false;
    this.nodes = 0;
    this.chosen = 0;
    this.loadClasses = [0, 0, 0, 0, 0, 0, 0, 0];
    this.loadMinutes = [0, 0, 0, 0, 0, 0, 0, 0];
    this.creditsMin = 0;
    this.creditsMax = 0;
    for (let i = 0; i < this.slotCount; i++) this.picks[i] = -1;
    this.deadline = nowMs() + Math.max(0.05, timeBudget) * 1000;
    for (let s = 0; s < this.slotCount; s++) {
      const off = this.domainOffset[s]!;
      const size = this.slots[s]!.size;
      const words = this.slotWords[s]!;
      for (let w = 0; w < words; w++) {
        const remaining = size - w * 32;
        this.domains[off + w] = remaining >= 32 ? 0xffffffff : maskLow(remaining);
      }
    }
  }

  runExhaustive(): void {
    this.reset(this.limits.maxExhaustiveLeaves, this.limits.timeBudget);
    this.descendExhaustive(0);
    if (this.cancelled) this.aborted = true;
  }

  runSampled(): void {
    this.reset(this.limits.sampleLeaves, this.limits.sampleTimeBudget);
    this.descendSampled(0, this.maxLeaves);
    if (this.cancelled) this.aborted = true;
  }

  private checkBudget(): void {
    if (this.isCancelled?.()) {
      this.cancelled = true;
      this.aborted = true;
    } else if (this.nodes >= this.limits.maxNodes || nowMs() >= this.deadline) {
      this.hitLimit = true;
      this.aborted = true;
    }
  }

  private choose(depth: number, local: number): boolean {
    const g = this.slots[depth]!.start + local;
    const srcBase = depth * this.domainTotal;
    const dstBase = (depth + 1) * this.domainTotal;
    for (let s = 0; s < this.slotCount; s++) {
      const off = this.domainOffset[s]!;
      const w = this.slotWords[s]!;
      if (s === depth) {
        for (let k = 0; k < w; k++) this.domains[dstBase + off + k] = this.domains[srcBase + off + k]!;
        continue;
      }
      const base = this.compatOffsets[g * this.slotCount + s]!;
      let any = 0;
      for (let k = 0; k < w; k++) {
        const v = (this.domains[srcBase + off + k]! & this.compat[base + k]!) >>> 0;
        this.domains[dstBase + off + k] = v;
        any = (any | v) >>> 0;
      }
      if (any === 0 && s > depth && this.slots[s]!.isRequired) return false;
    }
    return true;
  }

  private copyDomain(depth: number): void {
    const src = depth * this.domainTotal;
    this.domains.set(this.domains.subarray(src, src + this.domainTotal), src + this.domainTotal);
  }

  private canAdd(g: number, s: number): boolean {
    if (this.limitsDays) {
      const classes = this.rules.dayClasses[g]!;
      const minutes = this.rules.dayMinutes[g]!;
      for (let d = 0; d < 7; d++) {
        if (this.loadClasses[d]! + classes[d]! > this.rules.maxClassesPerDay) return false;
        if (this.loadMinutes[d]! + minutes[d]! > this.rules.maxMinutesPerDay) return false;
      }
    }
    if (this.rules.creditWindow && this.creditsMin + this.rules.slotMinCredits[s]! > this.rules.creditWindow.upper) {
      return false;
    }
    return true;
  }

  private take(g: number, s: number): void {
    if (this.limitsDays) {
      const classes = this.rules.dayClasses[g]!;
      const minutes = this.rules.dayMinutes[g]!;
      for (let d = 0; d < 7; d++) {
        this.loadClasses[d] = this.loadClasses[d]! + classes[d]!;
        this.loadMinutes[d] = this.loadMinutes[d]! + minutes[d]!;
      }
    }
    this.creditsMin += this.rules.slotMinCredits[s]!;
    this.creditsMax += this.rules.slotMaxCredits[s]!;
  }

  private release(g: number, s: number): void {
    if (this.limitsDays) {
      const classes = this.rules.dayClasses[g]!;
      const minutes = this.rules.dayMinutes[g]!;
      for (let d = 0; d < 7; d++) {
        this.loadClasses[d] = this.loadClasses[d]! - classes[d]!;
        this.loadMinutes[d] = this.loadMinutes[d]! - minutes[d]!;
      }
    }
    this.creditsMin -= this.rules.slotMinCredits[s]!;
    this.creditsMax -= this.rules.slotMaxCredits[s]!;
  }

  private canStillAdd(depth: number, s: number): boolean {
    const dom = depth * this.domainTotal;
    const off = this.domainOffset[s]!;
    const noExtra = !this.limitsDays && this.rules.creditWindow == null;
    for (let k = 0; k < this.slotWords[s]!; k++) {
      let bits = this.domains[dom + off + k]!;
      if (noExtra) {
        if (bits !== 0) return true;
        continue;
      }
      while (bits !== 0) {
        const local = k * 32 + (Math.clz32(bits & -bits) ^ 31);
        bits = (bits & (bits - 1)) >>> 0;
        if (this.canAdd(this.slots[s]!.start + local, s)) return true;
      }
    }
    return false;
  }

  private isFeasible(depth: number, first: number): boolean {
    if (this.target == null && this.rules.creditWindow == null) return true;
    let reachable = this.chosen;
    let most = this.creditsMax;
    let least = this.creditsMin;
    for (let s = first; s < this.slotCount; s++) {
      const required = this.slots[s]!.isRequired;
      if (required || this.canStillAdd(depth, s)) {
        reachable += 1;
        most += this.rules.slotMaxCredits[s]!;
      }
      if (required) least += this.rules.slotMinCredits[s]!;
    }
    if (this.target != null && reachable < this.target) return false;
    const window = this.rules.creditWindow;
    if (window && (most < window.lower || least > window.upper)) return false;
    return true;
  }

  private recordLeaf(depth: number): boolean {
    if (this.chosen === 0) return false;
    if (this.target != null && this.chosen !== this.target) return false;
    const window = this.rules.creditWindow;
    if (window && (this.creditsMin > window.upper || this.creditsMax < window.lower)) return false;
    if (this.target == null && window == null) {
      for (let s = 0; s < this.slotCount; s++) {
        if (!this.slots[s]!.isRequired && this.picks[s] === -1 && this.canStillAdd(depth, s)) return false;
      }
    }
    this.collector.offer(this.picks);
    this.leafCount += 1;
    return true;
  }

  private descendExhaustive(depth: number): void {
    if (this.aborted) return;
    this.nodes += 1;
    if ((this.nodes & 0x3ff) === 0) {
      this.checkBudget();
      if (this.aborted) return;
    }
    if (depth === this.slotCount) {
      if (this.recordLeaf(depth) && this.leafCount >= this.maxLeaves) {
        this.hitLimit = true;
        this.aborted = true;
      }
      return;
    }
    if (this.target != null && this.chosen === this.target) {
      for (let s = depth; s < this.slotCount; s++) this.picks[s] = -1;
      if (this.recordLeaf(depth) && this.leafCount >= this.maxLeaves) {
        this.hitLimit = true;
        this.aborted = true;
      }
      return;
    }
    if (!this.isFeasible(depth, depth)) return;

    const slot = this.slots[depth]!;
    if (!slot.isRequired && this.isFeasible(depth, depth + 1)) {
      this.picks[depth] = -1;
      this.copyDomain(depth);
      this.descendExhaustive(depth + 1);
      if (this.aborted) return;
    }

    const dom = depth * this.domainTotal;
    const off = this.domainOffset[depth]!;
    for (let word = 0; word < this.slotWords[depth]!; word++) {
      let bits = this.domains[dom + off + word]!;
      while (bits !== 0) {
        const local = word * 32 + (Math.clz32(bits & -bits) ^ 31);
        bits = (bits & (bits - 1)) >>> 0;
        const g = slot.start + local;
        if (!this.canAdd(g, depth) || !this.choose(depth, local)) continue;
        this.take(g, depth);
        this.picks[depth] = local;
        this.chosen += 1;
        this.descendExhaustive(depth + 1);
        this.chosen -= 1;
        this.picks[depth] = -1;
        this.release(g, depth);
        if (this.aborted) return;
      }
    }
  }

  private descendSampled(depth: number, budget: number): number {
    if (this.aborted) return 0;
    this.nodes += 1;
    if ((this.nodes & 0x3ff) === 0) {
      this.checkBudget();
      if (this.aborted) return 0;
    }
    if (depth === this.slotCount) return this.recordLeaf(depth) ? 1 : 0;
    if (this.target != null && this.chosen === this.target) {
      for (let s = depth; s < this.slotCount; s++) this.picks[s] = -1;
      return this.recordLeaf(depth) ? 1 : 0;
    }
    if (!this.isFeasible(depth, depth)) return 0;

    const slot = this.slots[depth]!;
    const options: number[] = [];
    if (!slot.isRequired && this.isFeasible(depth, depth + 1)) options.push(-1);
    const dom = depth * this.domainTotal;
    const off = this.domainOffset[depth]!;
    for (let word = 0; word < this.slotWords[depth]!; word++) {
      let bits = this.domains[dom + off + word]!;
      while (bits !== 0) {
        const local = word * 32 + (Math.clz32(bits & -bits) ^ 31);
        bits = (bits & (bits - 1)) >>> 0;
        if (this.canAdd(slot.start + local, depth)) options.push(local);
      }
    }
    if (options.length === 0) return 0;
    shuffleWith(options, this.rng);

    let remaining = budget;
    let left = options.length;
    let emitted = 0;
    for (const option of options) {
      if (this.aborted || remaining <= 0) break;
      const share = Math.max(1, Math.floor((remaining + left - 1) / left));
      left -= 1;
      let got = 0;
      if (option === -1) {
        this.picks[depth] = -1;
        this.copyDomain(depth);
        got = this.descendSampled(depth + 1, share);
      } else if (this.choose(depth, option)) {
        const g = slot.start + option;
        this.take(g, depth);
        this.picks[depth] = option;
        this.chosen += 1;
        got = this.descendSampled(depth + 1, share);
        this.chosen -= 1;
        this.picks[depth] = -1;
        this.release(g, depth);
      }
      emitted += got;
      remaining -= got;
    }
    return emitted;
  }
}

export const ScheduleGenerator = {
  Limits: {
    standard: STANDARD_LIMITS,
    probe: PROBE_LIMITS,
    blockerProbe: BLOCKER_PROBE_LIMITS,
  },
  generate: generateSchedules,
  rejectionReasons,
  hasNoCampus: sectionHasNoCampus,
  passesFilters,
  suggestRelaxations,
  analyzeBlockers,
  analyzeEmptyResult,
};
