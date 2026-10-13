/**
 * Schedule measurements and the "best overall" score.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The interval and measurement code is derived from SearchNEU
 * (https://github.com/sandboxnu/searchneu), apps/searchneu/lib/scheduler/binaryMeetingTime.ts
 * and filters.ts, Copyright (C) Sandbox at Northeastern University and the SearchNEU
 * contributors, licensed under the GNU Affero General Public License v3.
 * Modified 2026-10-04: split out of ScheduleGenerator; intervals know their building;
 * measurements also count back-to-back classes, tight walks, lunch breaks and heavy days;
 * the score takes weights derived from the student's preferences.
 * Modified 2026-10-13: ported from Swift to TypeScript for the web.
 */

import type { CourseSection, DaySet, Meeting } from "@/lib/models";
import { dayIndices, meetingIsOnline, sectionIsOnline, weeklyMeetings } from "@/lib/models";
import type { GapPreference, LunchBreak, SchedulePreferences } from "@/lib/preferences";
import { BACK_TO_BACK_MINUTES } from "@/lib/preferences";

/** Sentinel: the measured week has no timed start. */
export const NO_START = Number.MAX_SAFE_INTEGER;
/** Sentinel: the measured week has no timed end. */
export const NO_END = Number.MIN_SAFE_INTEGER;

/** Breaks shorter than this are passing time, not gaps. */
export const GAP_THRESHOLD_MINUTES = 20;

/**
 * Maps building codes to small numbers so intervals can say "same building" cheaply.
 * 0 means unknown (no building listed).
 */
export class ScheduleBuildingTable {
  private ids = new Map<string, number>();

  idFor(meeting: Meeting): number {
    const code = meeting.buildingCode ?? meeting.building;
    if (!code) return 0;
    const known = this.ids.get(code);
    if (known != null) return known;
    // UInt16(truncatingIfNeeded: count + 1). 0 is reserved for unknown.
    const next = (this.ids.size + 1) & 0xffff;
    this.ids.set(code, next);
    return next;
  }
}

/** A weekly time block of a section on a single day. */
export interface ScheduleInterval {
  day: number;
  inPerson: boolean;
  start: number;
  end: number;
  /** Which building (see `ScheduleBuildingTable`); 0 when unknown. */
  building: number;
}

function clampInt16(value: number): number {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return Math.trunc(value);
}

function intervalKey(interval: ScheduleInterval): string {
  return `${interval.day}|${interval.inPerson ? 1 : 0}|${interval.start}|${interval.end}|${interval.building}`;
}

/**
 * The section's weekly time blocks, one per day. Sections often list several
 * records for the same weekday and time (one per date range); those are folded.
 */
export function intervalsFor(section: CourseSection, buildings?: ScheduleBuildingTable): ScheduleInterval[] {
  const result: ScheduleInterval[] = [];
  const seen = new Set<string>();
  const sectionOnline = sectionIsOnline(section);
  for (const meeting of weeklyMeetings(section)) {
    if (meeting.start == null || meeting.end == null) continue;
    const inPerson = !(sectionOnline || meetingIsOnline(meeting));
    const place = inPerson && buildings ? buildings.idFor(meeting) : 0;
    const start = clampInt16(meeting.start);
    const end = clampInt16(meeting.end);
    for (const day of dayIndices(meeting.days)) {
      const interval: ScheduleInterval = { day, inPerson, start, end, building: place };
      const key = intervalKey(interval);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(interval);
    }
  }
  return result;
}

/** What to count besides the basics when measuring a schedule. The defaults count nothing extra. */
export interface ScheduleMeasureOptions {
  /** Count classes with less than this many minutes between them (0 = don't). */
  backToBackBelow: number;
  /** Count in-person classes in different buildings with less than this many minutes between them (0 = don't). */
  travelMinutes: number;
  /** Count class days on which the window has no free stretch of `minutes`. */
  lunch?: LunchBreak | null;
}

export function emptyMeasureOptions(): ScheduleMeasureOptions {
  return { backToBackBelow: 0, travelMinutes: 0, lunch: null };
}

/** The raw numbers measured from a set of weekly intervals. */
export interface ScheduleMeasure {
  classDays: number;
  campusDays: number;
  earliestStart: number;
  latestEnd: number;
  gapMinutes: number;
  /** Bit 0 is Sunday: the days with any timed class. */
  classDayMask: DaySet;
  /** Class minutes on the heaviest day, and over the week. */
  maxDayMinutes: number;
  totalMinutes: number;
  /** Consecutive classes closer than `backToBackBelow`. */
  backToBack: number;
  /** Consecutive in-person classes in different buildings closer than `travelMinutes`. */
  tightTransitions: number;
  /** Class days without the lunch break. */
  lunchMisses: number;
}

export function emptyMeasure(): ScheduleMeasure {
  return {
    classDays: 0,
    campusDays: 0,
    earliestStart: NO_START,
    latestEnd: NO_END,
    gapMinutes: 0,
    classDayMask: 0,
    maxDayMinutes: 0,
    totalMinutes: 0,
    backToBack: 0,
    tightTransitions: 0,
    lunchMisses: 0,
  };
}

/**
 * Whether the (start-sorted) intervals of one day leave `lunch.minutes` free
 * in one piece inside the window.
 */
function hasFreeStretch(dayIntervals: readonly ScheduleInterval[], lunch: LunchBreak): boolean {
  let cursor = lunch.start;
  for (const interval of dayIntervals) {
    const start = interval.start;
    const end = interval.end;
    if (!(end > lunch.start && start < lunch.end)) continue;
    if (start > cursor && Math.min(start, lunch.end) - cursor >= lunch.minutes) return true;
    cursor = Math.max(cursor, Math.min(end, lunch.end));
  }
  return lunch.end - cursor >= lunch.minutes;
}

/**
 * Sorts `intervals` by day and start (stable, matching the Swift insertion sort)
 * and measures them. The caller's array is not modified.
 */
export function measureIntervals(
  intervals: readonly ScheduleInterval[],
  options: ScheduleMeasureOptions = emptyMeasureOptions(),
): ScheduleMeasure {
  const sorted = intervals.slice();
  sorted.sort((a, b) => a.day - b.day || a.start - b.start);

  const result = emptyMeasure();
  const n = sorted.length;
  let k = 0;
  while (k < n) {
    const day = sorted[k]!.day;
    let runEnd = sorted[k]!.end;
    let onCampus = sorted[k]!.inPerson;
    let dayMinutes = sorted[k]!.end - sorted[k]!.start;
    let previous = sorted[k]!;
    result.earliestStart = Math.min(result.earliestStart, sorted[k]!.start);
    result.latestEnd = Math.max(result.latestEnd, sorted[k]!.end);
    let m = k + 1;
    while (m < n && sorted[m]!.day === day) {
      const current = sorted[m]!;
      const start = current.start;
      const gap = start - runEnd;
      if (gap >= GAP_THRESHOLD_MINUTES) result.gapMinutes += gap;
      if (gap >= 0) {
        if (gap < options.backToBackBelow) result.backToBack += 1;
        if (
          gap < options.travelMinutes &&
          previous.inPerson &&
          current.inPerson &&
          (previous.building === 0 || current.building === 0 || previous.building !== current.building)
        ) {
          result.tightTransitions += 1;
        }
      }
      runEnd = Math.max(runEnd, current.end);
      dayMinutes += current.end - start;
      result.earliestStart = Math.min(result.earliestStart, start);
      result.latestEnd = Math.max(result.latestEnd, current.end);
      if (current.inPerson) onCampus = true;
      previous = current;
      m += 1;
    }
    const daySlice = sorted.slice(k, m);
    if (options.lunch && !hasFreeStretch(daySlice, options.lunch)) result.lunchMisses += 1;
    result.classDays += 1;
    result.classDayMask |= 1 << day;
    if (onCampus) result.campusDays += 1;
    result.maxDayMinutes = Math.max(result.maxDayMinutes, dayMinutes);
    result.totalMinutes += dayMinutes;
    k = m;
  }
  return result;
}

function popcount7(mask: number): number {
  let n = 0;
  let v = mask & 0x7f;
  while (v) {
    n += v & 1;
    v >>= 1;
  }
  return n;
}

/** The weights of the leaf-level score. The defaults are the original, preference-free formula. */
export interface ScoreWeights {
  base: number;
  /** Points lost per day with an in-person class. */
  perCampusDay: number;
  /** Points lost per day with only online classes at fixed times. */
  perOnlineDay: number;
  /** Idle minutes (breaks of 20 minutes or more) are divided by this; Infinity ignores gaps. */
  gapDivisor: number;
  /** Penalize starting before 9 AM (1 point per 15 minutes) and ending after 5 PM (1 point per 20). */
  comfortHours: boolean;
  perFullSection: number;
  /** Lost when no section is full but the tightest has 3 seats or fewer. */
  lowSeatsPenalty: number;
  /** Points gained per day with classes (spread out evenly). */
  perClassDayBonus: number;
  /** Points lost per minute the heaviest day exceeds the average class day. */
  perImbalanceMinute: number;
  /** Points lost per class day that falls on a day the student wants free. */
  perDayOffMissed: number;
  daysOff: DaySet;
  perBackToBack: number;
  perTightTransition: number;
  perLunchMiss: number;
}

export function defaultScoreWeights(): ScoreWeights {
  return {
    base: 100,
    perCampusDay: 8,
    perOnlineDay: 2,
    gapDivisor: 10,
    comfortHours: true,
    perFullSection: 6,
    lowSeatsPenalty: 2,
    perClassDayBonus: 0,
    perImbalanceMinute: 0,
    perDayOffMissed: 0,
    daysOff: 0,
    perBackToBack: 0,
    perTightTransition: 0,
    perLunchMiss: 0,
  };
}

function hasTimeOfDayPreference(p: SchedulePreferences): boolean {
  return Object.keys(p.timeOfDay).length > 0;
}

/**
 * The weights for a student's wishes. Wishes that contradict a default nudge replace it:
 * time-of-day wishes switch off the "avoid before 9 / after 5" nudges, "spread out" replaces
 * the fewer-days nudge, "keep gaps short" triples the gap penalty, and so on.
 */
export function scoreWeightsFor(p: SchedulePreferences): ScoreWeights {
  const w = defaultScoreWeights();
  if (hasTimeOfDayPreference(p) || p.earliestStart != null || p.latestEnd != null) w.comfortHours = false;
  switch (p.dayLayout) {
    case "noPreference":
      break;
    case "fewerDays":
      w.perCampusDay = 14;
      break;
    case "spreadOut":
      w.perCampusDay = 0;
      w.perOnlineDay = 0;
      w.perClassDayBonus = 6;
      w.perImbalanceMinute = 0.1;
      break;
  }
  const gaps: GapPreference = p.gaps;
  switch (gaps) {
    case "noPreference":
      // A protected lunch break is idle time on purpose: it shouldn't cost as much as other gaps.
      if (p.lunch != null) w.gapDivisor = 20;
      break;
    case "compact":
      w.gapDivisor = 10 / 3;
      break;
    case "fine":
      w.gapDivisor = Number.POSITIVE_INFINITY;
      break;
  }
  if (p.seats === "waitlistOK") w.perFullSection = 3;
  if (p.daysOff !== 0 && p.daysOffStrength === "preferred") {
    w.daysOff = p.daysOff;
    w.perDayOffMissed = 12;
  }
  switch (p.breaks) {
    case "fine":
      break;
    case "avoidBackToBack":
      w.perBackToBack = 10;
      break;
    case "atLeast":
      if (p.minimumBreakStrength === "preferred") w.perTightTransition = 10;
      break;
  }
  if (p.lunch != null) w.perLunchMiss = 8;
  return w;
}

export function scoreWithWeights(
  w: ScoreWeights,
  m: ScheduleMeasure,
  fullSections: number,
  minSeats: number,
): number {
  let score = w.base;
  score -= w.perCampusDay * m.campusDays;
  score -= w.perOnlineDay * Math.max(0, m.classDays - m.campusDays);
  score -= m.gapMinutes / w.gapDivisor;
  if (w.comfortHours) {
    if (m.earliestStart !== NO_START && m.earliestStart < 9 * 60) {
      score -= (9 * 60 - m.earliestStart) / 15;
    }
    if (m.latestEnd !== NO_END && m.latestEnd > 17 * 60) {
      score -= (m.latestEnd - 17 * 60) / 20;
    }
  }
  score -= w.perFullSection * fullSections;
  if (fullSections === 0 && minSeats <= 3) score -= w.lowSeatsPenalty;

  if (w.perClassDayBonus !== 0) score += w.perClassDayBonus * m.classDays;
  if (w.perImbalanceMinute !== 0 && m.classDays > 0) {
    const average = m.totalMinutes / m.classDays;
    score -= w.perImbalanceMinute * Math.max(0, m.maxDayMinutes - average);
  }
  if (w.perDayOffMissed !== 0) {
    score -= w.perDayOffMissed * popcount7(m.classDayMask & w.daysOff);
  }
  if (w.perBackToBack !== 0) score -= w.perBackToBack * m.backToBack;
  if (w.perTightTransition !== 0) score -= w.perTightTransition * m.tightTransitions;
  if (w.perLunchMiss !== 0) score -= w.perLunchMiss * m.lunchMisses;
  return score;
}

/** The "best overall" composite without preferences. */
export function scoreMeasurement(measure: ScheduleMeasure, fullSections: number, minSeats: number): number {
  return scoreWithWeights(defaultScoreWeights(), measure, fullSections, minSeats);
}

/** What the preferences ask `measureIntervals` to count. */
export function measureOptionsFor(p: SchedulePreferences): ScheduleMeasureOptions {
  const options = emptyMeasureOptions();
  switch (p.breaks) {
    case "fine":
      break;
    case "avoidBackToBack":
      options.backToBackBelow = BACK_TO_BACK_MINUTES;
      break;
    case "atLeast":
      if (p.minimumBreakStrength === "preferred") options.travelMinutes = p.minimumBreakMinutes;
      break;
  }
  options.lunch = p.lunch ?? null;
  return options;
}

/** Points per weekly class hour in a band the student prefers. */
export const PREFERRED_BAND_PER_HOUR = 3;
/** Points per weekly class hour in a band the student wants to avoid. */
export const AVOIDED_BAND_PER_HOUR = -6;
/**
 * A class meeting outside a soft earliest/latest limit costs `SOFT_LIMIT_BASE` plus one point per
 * 10 minutes it is outside, at most `SOFT_LIMIT_CAP`.
 */
export const SOFT_LIMIT_BASE = 4;
export const SOFT_LIMIT_CAP = 20;
/** Per class meeting that overlaps a block that is only preferred. */
export const SOFT_BLOCKED_PER_MEETING = 15;
/** Per section, times how far its format is from the wish (0, 0.5 or 1). */
export const FORMAT_MISMATCH_PER_SECTION = 8;
/** Per in-person section on another campus than the preferred one. */
export const CAMPUS_MISMATCH_PER_SECTION = 10;
export const PREFERRED_INSTRUCTOR_PER_SECTION = 5;
export const AVOIDED_INSTRUCTOR_PER_SECTION = -15;

export const ScheduleScoring = {
  score: scoreMeasurement,
  measureOptions: measureOptionsFor,
  weights: scoreWeightsFor,
  defaultWeights: defaultScoreWeights,
  scoreWithWeights,
  preferredBandPerHour: PREFERRED_BAND_PER_HOUR,
  avoidedBandPerHour: AVOIDED_BAND_PER_HOUR,
  softLimitBase: SOFT_LIMIT_BASE,
  softLimitCap: SOFT_LIMIT_CAP,
  softBlockedPerMeeting: SOFT_BLOCKED_PER_MEETING,
  formatMismatchPerSection: FORMAT_MISMATCH_PER_SECTION,
  campusMismatchPerSection: CAMPUS_MISMATCH_PER_SECTION,
  preferredInstructorPerSection: PREFERRED_INSTRUCTOR_PER_SECTION,
  avoidedInstructorPerSection: AVOIDED_INSTRUCTOR_PER_SECTION,
  gapThresholdMinutes: GAP_THRESHOLD_MINUTES,
};
