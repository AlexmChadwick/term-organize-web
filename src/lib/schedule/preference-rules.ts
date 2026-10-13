/**
 * Hard and soft preference rules for one section, plus the phrases on result cards.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseSection, DaySet, Meeting } from "@/lib/models";
import {
  DAY_FULL,
  DAY_SHORT,
  dateWindowsOverlap,
  dayIndices,
  daysDisjoint,
  instructorDisplayName,
  meetingIsOnline,
  sectionIsOnline,
  timeLabel,
  weeklyMeetings,
} from "@/lib/models";
import type { FormatPreference, SchedulePreferences, TimeBand } from "@/lib/preferences";
import {
  BACK_TO_BACK_MINUTES,
  TIME_BANDS,
  bandOverlap,
  bandPreference,
  blockedOverlaps,
  blockedTimeIsActive,
  formatMismatch,
  sectionFormat,
} from "@/lib/preferences";
import type { ScheduleInterval, ScheduleMeasureOptions } from "@/lib/schedule/scoring";
import {
  AVOIDED_BAND_PER_HOUR,
  AVOIDED_INSTRUCTOR_PER_SECTION,
  CAMPUS_MISMATCH_PER_SECTION,
  FORMAT_MISMATCH_PER_SECTION,
  PREFERRED_BAND_PER_HOUR,
  PREFERRED_INSTRUCTOR_PER_SECTION,
  SOFT_BLOCKED_PER_MEETING,
  SOFT_LIMIT_BASE,
  SOFT_LIMIT_CAP,
  ScheduleBuildingTable,
  intervalsFor,
  measureIntervals,
} from "@/lib/schedule/scoring";

/**
 * One short phrase saying why a schedule suits the student's wishes ("Fridays off") or
 * where it falls short of them ("Starts 8:00 AM"). Shown as a tag on result cards.
 */
export type ScheduleReasonKind = "benefit" | "caveat";

export interface ScheduleReason {
  kind: ScheduleReasonKind;
  text: string;
  symbol: string;
  id: string;
  isCaveat: boolean;
}

export function scheduleReason(kind: ScheduleReasonKind, text: string, symbol: string): ScheduleReason {
  return {
    kind,
    text,
    symbol,
    id: `${kind === "benefit" ? "+" : "-"}${text}`,
    isCaveat: kind === "caveat",
  };
}

/** Why a section was left out. Raw order matches the Swift enum so bits stay stable. */
export const FILTER_REASONS = [
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
] as const;

export type ScheduleFilterReason = (typeof FILTER_REASONS)[number];

export function filterReasonBit(reason: ScheduleFilterReason): number {
  return 1 << FILTER_REASONS.indexOf(reason);
}

export function filterReasonRaw(reason: ScheduleFilterReason): number {
  return FILTER_REASONS.indexOf(reason);
}

/** Banner files sections that need no room under "No campus, no room needed". */
export function sectionHasNoCampus(section: CourseSection): boolean {
  return section.campus.toLowerCase().includes("no campus");
}

/**
 * A section with a seat limit and no seats left. Sections listed without any limit
 * (independent study) are never full.
 */
export function sectionIsFull(section: CourseSection): boolean {
  return section.seatCapacity > 0 && section.seatsRemaining <= 0;
}

/**
 * Swift `SchedulePreferences == SchedulePreferences()`. Field equality, not JSON key order.
 * Blocked-time ids count: any stored block means this is not the empty value.
 */
export function isDefaultPreferences(p: SchedulePreferences): boolean {
  if (Object.keys(p.timeOfDay).length > 0) return false;
  if (p.earliestStart != null || p.latestEnd != null) return false;
  if (p.daysOff !== 0) return false;
  if (p.daysOffStrength !== "preferred") return false;
  if (p.dayLayout !== "noPreference") return false;
  if (p.maxClassesPerDay != null || p.maxMinutesPerDay != null) return false;
  if (p.gaps !== "noPreference") return false;
  if (p.breaks !== "fine") return false;
  if (p.minimumBreakMinutes !== 15) return false;
  if (p.minimumBreakStrength !== "preferred") return false;
  if (p.lunch != null) return false;
  if (p.blockedTimes.length > 0) return false;
  if (p.format !== "noPreference") return false;
  if (p.formatStrength !== "preferred") return false;
  if (p.campus != null) return false;
  if (p.campusStrength !== "preferred") return false;
  if (p.seats !== "any") return false;
  if (p.preferredInstructors.length > 0 || p.avoidedInstructors.length > 0) return false;
  if (p.creditTarget != null) return false;
  return true;
}

function overlapsBlock(block: { days: DaySet; start: number; end: number }, meetings: readonly Meeting[]): boolean {
  return meetings.some((meeting) => {
    if (meeting.start == null || meeting.end == null) return false;
    return blockedOverlaps(block, meeting.days, meeting.start, meeting.end);
  });
}

/**
 * The preference rules that remove `section`, as `ScheduleFilterReason` bits (0 = it stays).
 * Callers OR these with the plan's filter bits.
 */
export function preferenceRejectionBits(section: CourseSection, p: SchedulePreferences): number {
  let reasons = 0;
  const weekly = weeklyMeetings(section);

  if (p.earliestStart != null && p.earliestStart.strength === "required") {
    const limit = p.earliestStart.minutes;
    if (weekly.some((m) => (m.start ?? Number.MAX_SAFE_INTEGER) < limit)) {
      reasons |= filterReasonBit("prefStartsTooEarly");
    }
  }
  if (p.latestEnd != null && p.latestEnd.strength === "required") {
    const limit = p.latestEnd.minutes;
    if (weekly.some((m) => (m.end ?? 0) > limit)) {
      reasons |= filterReasonBit("prefEndsTooLate");
    }
  }
  if (p.daysOffStrength === "required" && p.daysOff !== 0) {
    if (weekly.some((m) => !daysDisjoint(m.days, p.daysOff))) {
      reasons |= filterReasonBit("prefDayOff");
    }
  }
  for (const block of p.blockedTimes) {
    if (!blockedTimeIsActive(block) || block.strength !== "required") continue;
    if (overlapsBlock(block, weekly)) {
      reasons |= filterReasonBit("blockedTime");
      break;
    }
  }
  if (p.format !== "noPreference" && p.formatStrength === "required") {
    if (formatMismatch(sectionFormat(section), p.format) > 0) reasons |= filterReasonBit("prefFormat");
  }
  if (p.campus != null && p.campusStrength === "required") {
    if (!sectionIsOnline(section) && !sectionHasNoCampus(section) && section.campus !== p.campus) {
      reasons |= filterReasonBit("prefCampus");
    }
  }
  switch (p.seats) {
    case "any":
      break;
    case "openOnly":
      if (sectionIsFull(section)) reasons |= filterReasonBit("prefSeats");
      break;
    case "waitlistOK":
      if (sectionIsFull(section) && section.waitlistRemaining <= 0) reasons |= filterReasonBit("prefSeats");
      break;
  }
  if (p.maxMinutesPerDay != null) {
    const cap = p.maxMinutesPerDay;
    const perDay = [0, 0, 0, 0, 0, 0, 0];
    for (const interval of intervalsFor(section)) {
      perDay[interval.day] = (perDay[interval.day] ?? 0) + (interval.end - interval.start);
    }
    if (perDay.some((minutes) => minutes > cap)) reasons |= filterReasonBit("prefWorkload");
  }
  return reasons;
}

/**
 * Whether two sections have in-person meetings in different buildings (or unknown ones) on the same
 * day, in the same weeks, with fewer than `minutes` between them. Overlaps don't count: they are conflicts.
 */
export function sectionsTooClose(
  a: CourseSection,
  aMeetings: readonly Meeting[],
  b: CourseSection,
  bMeetings: readonly Meeting[],
  minutes: number,
): boolean {
  if (minutes <= 0 || sectionIsOnline(a) || sectionIsOnline(b)) return false;
  for (const x of aMeetings) {
    if (meetingIsOnline(x) || x.start == null || x.end == null) continue;
    for (const y of bMeetings) {
      if (meetingIsOnline(y) || y.start == null || y.end == null) continue;
      if (daysDisjoint(x.days, y.days)) continue;
      const gap = y.start >= x.end ? y.start - x.end : x.start >= y.end ? x.start - y.end : -1;
      if (gap < 0 || gap >= minutes) continue;
      if (!dateWindowsOverlap(x.startDate, x.endDate, y.startDate, y.endDate)) continue;
      const bx = x.buildingCode ?? x.building;
      const by = y.buildingCode ?? y.building;
      if (bx != null && by != null && bx === by) continue;
      return true;
    }
  }
  return false;
}

function softLimitPenalty(minutesOutside: number): number {
  return Math.min(SOFT_LIMIT_CAP, SOFT_LIMIT_BASE + minutesOutside / 10);
}

/**
 * Points (positive or negative) the preferences give a section on its own: time of day, soft limits,
 * soft blocked times, format, campus and instructors. Added to the schedule's score once per section.
 */
export function sectionScore(
  section: CourseSection,
  intervals: readonly ScheduleInterval[],
  p: SchedulePreferences,
): number {
  let score = 0;

  if (Object.keys(p.timeOfDay).length > 0) {
    for (const interval of intervals) {
      for (const band of TIME_BANDS) {
        const preference = bandPreference(p, band);
        if (preference === "okay") continue;
        const minutes = bandOverlap(band, interval.start, interval.end);
        if (minutes <= 0) continue;
        const perHour = preference === "prefer" ? PREFERRED_BAND_PER_HOUR : AVOIDED_BAND_PER_HOUR;
        score += (perHour * minutes) / 60;
      }
    }
  }

  if (p.earliestStart != null && p.earliestStart.strength === "preferred") {
    const limit = p.earliestStart.minutes;
    for (const interval of intervals) {
      if (interval.start < limit) score -= softLimitPenalty(limit - interval.start);
    }
  }
  if (p.latestEnd != null && p.latestEnd.strength === "preferred") {
    const limit = p.latestEnd.minutes;
    for (const interval of intervals) {
      if (interval.end > limit) score -= softLimitPenalty(interval.end - limit);
    }
  }

  for (const block of p.blockedTimes) {
    if (!blockedTimeIsActive(block) || block.strength !== "preferred") continue;
    for (const interval of intervals) {
      if (blockedOverlaps(block, 1 << interval.day, interval.start, interval.end)) {
        score -= SOFT_BLOCKED_PER_MEETING;
      }
    }
  }

  if (p.format !== "noPreference") {
    score -= FORMAT_MISMATCH_PER_SECTION * formatMismatch(sectionFormat(section), p.format);
  }
  if (
    p.campus != null &&
    p.campusStrength === "preferred" &&
    !sectionIsOnline(section) &&
    !sectionHasNoCampus(section) &&
    section.campus !== p.campus
  ) {
    score -= CAMPUS_MISMATCH_PER_SECTION;
  }

  if (p.preferredInstructors.length > 0 || p.avoidedInstructors.length > 0) {
    const names = new Set((section.instructors ?? []).map((instructor) => instructor.name.toLowerCase()));
    if (names.size > 0) {
      if (p.preferredInstructors.some((name) => names.has(name.toLowerCase()))) {
        score += PREFERRED_INSTRUCTOR_PER_SECTION;
      }
      if (p.avoidedInstructors.some((name) => names.has(name.toLowerCase()))) {
        score += AVOIDED_INSTRUCTOR_PER_SECTION;
      }
    }
  }
  return score;
}

const BAND_SYMBOL: Record<TimeBand, string> = {
  earlyMorning: "sunrise",
  morning: "sun.horizon",
  midday: "sun.max",
  afternoon: "sun.haze",
  evening: "sunset",
  night: "moon.stars",
};

const FORMAT_TITLE: Record<FormatPreference, string> = {
  noPreference: "No preference",
  inPerson: "In person",
  hybrid: "Hybrid",
  online: "Online",
};

export function formatTitle(format: FormatPreference): string {
  return FORMAT_TITLE[format];
}

function preferredBands(p: SchedulePreferences): TimeBand[] {
  return TIME_BANDS.filter((band) => bandPreference(p, band) === "prefer");
}

function avoidedBands(p: SchedulePreferences): TimeBand[] {
  return TIME_BANDS.filter((band) => bandPreference(p, band) === "avoid");
}

/** The bands in plain words: `mornings`, `early mornings`, `afternoons & evenings`. */
export function bandPhrase(bands: readonly TimeBand[]): string {
  const set = new Set(bands);
  const items: string[] = [];
  if (set.has("morning")) items.push("mornings");
  else if (set.has("earlyMorning")) items.push("early mornings");
  if (set.has("midday")) items.push("midday");
  if (set.has("afternoon")) items.push("afternoons");
  if (set.has("evening")) items.push("evenings");
  else if (set.has("night")) items.push("nights");
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`;
}

export function daysOffPhrase(days: DaySet): string {
  const indices = dayIndices(days);
  if (indices.length === 0) return "";
  if (indices.length === 1) return `${DAY_FULL[indices[0]!]}s off`;
  const names = indices.map((i) => DAY_SHORT[i]!);
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]} off`;
}

/** `10 AM`, `10:30 AM`. */
export function shortTime(minutes: number): string {
  return timeLabel(minutes).replaceAll(":00", "");
}

function minutesIn(intervals: readonly ScheduleInterval[], bands: readonly TimeBand[]): number {
  let total = 0;
  for (const interval of intervals) {
    for (const band of bands) total += bandOverlap(band, interval.start, interval.end);
  }
  return total;
}

function namesMatching(sections: readonly CourseSection[], wanted: readonly string[]): string[] {
  const set = new Set(wanted.map((name) => name.toLowerCase()));
  const result: string[] = [];
  for (const section of sections) {
    for (const instructor of section.instructors ?? []) {
      if (!set.has(instructor.name.toLowerCase())) continue;
      const display = instructorDisplayName(instructor.name);
      if (!result.includes(display)) result.push(display);
    }
  }
  return result;
}

function uniqueReasons(reasons: ScheduleReason[]): ScheduleReason[] {
  const seen = new Set<string>();
  const out: ScheduleReason[] = [];
  for (const reason of reasons) {
    if (seen.has(reason.id)) continue;
    seen.add(reason.id);
    out.push(reason);
  }
  return out;
}

/**
 * Short phrases saying how well `sections` match the wishes: up to `maxBenefits` things it gets right,
 * then up to `maxCaveats` things it doesn't. Empty when there are no preferences.
 */
export function scheduleReasons(
  sections: readonly CourseSection[],
  p: SchedulePreferences,
  maxBenefits = 4,
  maxCaveats = 2,
): ScheduleReason[] {
  if (isDefaultPreferences(p) || sections.length === 0) return [];

  const table = new ScheduleBuildingTable();
  const intervals: ScheduleInterval[] = [];
  for (const section of sections) intervals.push(...intervalsFor(section, table));
  const options: ScheduleMeasureOptions = { backToBackBelow: 0, travelMinutes: 0, lunch: p.lunch ?? null };
  if (p.breaks === "avoidBackToBack") options.backToBackBelow = BACK_TO_BACK_MINUTES;
  if (p.breaks === "atLeast") options.travelMinutes = p.minimumBreakMinutes;
  const measure = measureIntervals(intervals, options);
  const hasClasses = measure.classDays > 0;

  const good: ScheduleReason[] = [];
  const bad: ScheduleReason[] = [];
  const pro = (text: string, symbol: string) => {
    good.push(scheduleReason("benefit", text, symbol));
  };
  const con = (text: string, symbol: string) => {
    bad.push(scheduleReason("caveat", text, symbol));
  };

  if (hasClasses && p.daysOff !== 0) {
    const used = measure.classDayMask & p.daysOff;
    const free = p.daysOff & ~used & 0x7f;
    if (free !== 0) pro(daysOffPhrase(free), "calendar.badge.minus");
    if (used !== 0 && p.daysOffStrength === "preferred") {
      con(`Class on ${dayIndices(used).map((i) => DAY_SHORT[i]).join(", ")}`, "calendar.badge.exclamationmark");
    }
  }

  if (hasClasses && p.earliestStart != null) {
    const limit = p.earliestStart;
    if (measure.earliestStart >= limit.minutes) {
      pro(`No classes before ${shortTime(limit.minutes)}`, "sunrise");
    } else if (limit.strength === "preferred") {
      con(`Starts ${timeLabel(measure.earliestStart)}`, "sunrise");
    }
  }
  if (hasClasses && p.latestEnd != null) {
    const limit = p.latestEnd;
    if (measure.latestEnd <= limit.minutes) {
      pro(`Done by ${shortTime(limit.minutes)}`, "sunset");
    } else if (limit.strength === "preferred") {
      con(`Ends ${timeLabel(measure.latestEnd)}`, "sunset");
    }
  }

  if (hasClasses) {
    switch (p.dayLayout) {
      case "noPreference":
        break;
      case "fewerDays": {
        const days = measure.campusDays > 0 ? measure.campusDays : measure.classDays;
        if (days <= 3) pro(days === 1 ? "1 day on campus" : `${days} days on campus`, "calendar");
        break;
      }
      case "spreadOut":
        if (measure.classDays >= 4) pro(`Spread over ${measure.classDays} days`, "calendar");
        break;
    }
    if (p.gaps === "compact" && measure.gapMinutes <= 30) pro("Short gaps", "rectangle.compress.vertical");
  }

  if (hasClasses && measure.totalMinutes > 0) {
    const preferred = preferredBands(p);
    if (preferred.length > 0) {
      const share = minutesIn(intervals, preferred) / measure.totalMinutes;
      const name = bandPhrase(preferred);
      const symbol = BAND_SYMBOL[preferred[0]!] ?? "sun.max";
      if (share >= 0.999) pro(`All ${name}`, symbol);
      else if (share >= 0.6) pro(`Mostly ${name}`, symbol);
    }
    const avoided = avoidedBands(p);
    if (avoided.length > 0) {
      const name = bandPhrase(avoided);
      const symbol = BAND_SYMBOL[avoided[0]!] ?? "nosign";
      if (minutesIn(intervals, avoided) === 0) pro(`No ${name}`, symbol);
      else con(`Includes ${name}`, avoided[0] ? BAND_SYMBOL[avoided[0]] : "clock");
    }
  }

  if (hasClasses && p.lunch != null) {
    const free = measure.classDays - measure.lunchMisses;
    if (measure.lunchMisses === 0) pro("Lunch free every day", "fork.knife");
    else if (free * 2 >= measure.classDays) pro("Lunch free most days", "fork.knife");
    else con("Lunch often busy", "fork.knife");
  }
  if (hasClasses) {
    switch (p.breaks) {
      case "fine":
        break;
      case "avoidBackToBack":
        if (measure.backToBack === 0) pro("No back-to-back classes", "figure.walk");
        else con(measure.backToBack === 1 ? "1 back-to-back" : `${measure.backToBack} back-to-back`, "figure.walk");
        break;
      case "atLeast":
        if (measure.tightTransitions === 0) pro("Time to walk between classes", "figure.walk");
        else con("Tight between buildings", "figure.walk");
        break;
    }
  }

  if (p.preferredInstructors.length > 0 || p.avoidedInstructors.length > 0) {
    const liked = namesMatching(sections, p.preferredInstructors);
    if (liked.length === 1) pro(`With ${liked[0]}`, "person.fill");
    else if (liked.length > 1) pro(`With ${liked.length} preferred instructors`, "person.2.fill");
    const disliked = namesMatching(sections, p.avoidedInstructors);
    const first = disliked[0];
    if (first) {
      con(disliked.length === 1 ? `With ${first}` : `With ${disliked.length} avoided instructors`, "person.fill.xmark");
    }
  }

  if (p.format !== "noPreference") {
    const formats = sections.map((section) => sectionFormat(section));
    const deliveries = formats.filter((format) => format !== "other");
    if (deliveries.length > 0) {
      const title = FORMAT_TITLE[p.format].toLowerCase();
      if (deliveries.every((format) => formatMismatch(format, p.format) === 0)) {
        pro(`All ${title}`, p.format === "online" ? "wifi" : "building.2");
      } else if (p.formatStrength === "preferred") {
        con(`Not all ${title}`, "wifi");
      }
    }
  }
  if (p.campus != null) {
    const campus = p.campus;
    const onCampus = sections.filter((section) => !sectionIsOnline(section) && !sectionHasNoCampus(section));
    if (onCampus.length > 0) {
      if (onCampus.every((section) => section.campus === campus)) pro(`${campus} campus`, "mappin.and.ellipse");
      else if (p.campusStrength === "preferred") con("Includes another campus", "mappin.and.ellipse");
    }
  }

  switch (p.seats) {
    case "any":
      break;
    case "openOnly":
      pro("All sections open", "chair.lounge");
      break;
    case "waitlistOK": {
      const waitlisted = sections.filter((section) => sectionIsFull(section)).length;
      if (waitlisted === 0) pro("All sections open", "chair.lounge");
      else con(waitlisted === 1 ? "1 waitlisted section" : `${waitlisted} waitlisted sections`, "chair.lounge");
      break;
    }
  }

  for (const block of p.blockedTimes) {
    if (!blockedTimeIsActive(block) || block.strength !== "preferred") continue;
    const touches = intervals.some((interval) =>
      blockedOverlaps(block, 1 << interval.day, interval.start, interval.end),
    );
    if (touches) con(`Overlaps ${block.label}`, "calendar.badge.exclamationmark");
  }

  return [...uniqueReasons(good).slice(0, maxBenefits), ...uniqueReasons(bad).slice(0, maxCaveats)];
}

export const SchedulePreferenceRules = {
  rejectionReasons: preferenceRejectionBits,
  isFull: sectionIsFull,
  tooClose: sectionsTooClose,
  sectionScore,
  reasons: scheduleReasons,
  hasNoCampus: sectionHasNoCampus,
  isDefault: isDefaultPreferences,
};
