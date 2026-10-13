/**
 * Schedule preferences ("your ideal week").
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/Schedule/SchedulePreferences.swift.
 */

import type { CourseSection, DaySet } from "./models";
import { sectionIsOnline } from "./models";

export type PreferenceStrength = "preferred" | "required";

export type TimeBand = "earlyMorning" | "morning" | "midday" | "afternoon" | "evening" | "night";

export const TIME_BANDS: TimeBand[] = ["earlyMorning", "morning", "midday", "afternoon", "evening", "night"];

export const TIME_BAND_RANGE: Record<TimeBand, { start: number; end: number; title: string; detail: string }> = {
  earlyMorning: { start: 0, end: 9 * 60, title: "Early morning", detail: "Before 9 AM" },
  morning: { start: 9 * 60, end: 12 * 60, title: "Morning", detail: "9 AM – noon" },
  midday: { start: 12 * 60, end: 14 * 60, title: "Midday", detail: "Noon – 2 PM" },
  afternoon: { start: 14 * 60, end: 17 * 60, title: "Afternoon", detail: "2 – 5 PM" },
  evening: { start: 17 * 60, end: 19 * 60, title: "Evening", detail: "5 – 7 PM" },
  night: { start: 19 * 60, end: 24 * 60, title: "Night", detail: "After 7 PM" },
};

export type TimePreference = "avoid" | "okay" | "prefer";

export function bandOverlap(band: TimeBand, start: number, end: number): number {
  const r = TIME_BAND_RANGE[band];
  return Math.max(0, Math.min(end, r.end) - Math.max(start, r.start));
}

export interface TimeLimit {
  minutes: number;
  strength: PreferenceStrength;
}

export type DayLayout = "noPreference" | "fewerDays" | "spreadOut";
export type GapPreference = "compact" | "noPreference" | "fine";
export type BreakPreference = "fine" | "avoidBackToBack" | "atLeast";

export interface LunchBreak {
  start: number;
  end: number;
  minutes: number;
}

export function defaultLunch(): LunchBreak {
  return { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
}

export interface BlockedTime {
  id: string;
  label: string;
  days: DaySet;
  start: number;
  end: number;
  strength: PreferenceStrength;
  isEnabled: boolean;
}

export function blockedTimeIsValid(b: BlockedTime): boolean {
  return b.days !== 0 && b.end > b.start && b.start >= 0 && b.end <= 24 * 60;
}

export function blockedTimeIsActive(b: BlockedTime): boolean {
  return b.isEnabled && blockedTimeIsValid(b);
}

export function blockedOverlaps(b: Pick<BlockedTime, "days" | "start" | "end">, days: DaySet, start: number, end: number): boolean {
  return (b.days & days) !== 0 && start < b.end && b.start < end;
}

export type FormatPreference = "noPreference" | "inPerson" | "hybrid" | "online";
export type SeatPolicy = "any" | "waitlistOK" | "openOnly";

export interface CreditTarget {
  lower: number;
  upper: number;
}

export type SectionFormat = "inPerson" | "hybrid" | "online" | "other";

export function sectionFormat(section: CourseSection): SectionFormat {
  if (sectionIsOnline(section)) return "online";
  const method = (section.instructionMethod ?? "").toLowerCase();
  if (method.includes("hybrid")) return "hybrid";
  if (method.includes("live cast") || method.includes("video") || method.includes("remote")) return "online";
  if (method.includes("traditional")) return "inPerson";
  return "other";
}

export function formatMismatch(format: SectionFormat, preference: FormatPreference): number {
  if (preference === "noPreference" || format === "other") return 0;
  if (
    (preference === "inPerson" && format === "inPerson") ||
    (preference === "online" && format === "online") ||
    (preference === "hybrid" && format === "hybrid")
  )
    return 0;
  if (
    (preference === "inPerson" && format === "hybrid") ||
    (preference === "online" && format === "hybrid") ||
    (preference === "hybrid" && format === "inPerson") ||
    (preference === "hybrid" && format === "online")
  )
    return 0.5;
  return 1;
}

export interface SchedulePreferences {
  timeOfDay: Partial<Record<TimeBand, TimePreference>>;
  earliestStart?: TimeLimit | null;
  latestEnd?: TimeLimit | null;
  daysOff: DaySet;
  daysOffStrength: PreferenceStrength;
  dayLayout: DayLayout;
  maxClassesPerDay?: number | null;
  maxMinutesPerDay?: number | null;
  gaps: GapPreference;
  breaks: BreakPreference;
  minimumBreakMinutes: number;
  minimumBreakStrength: PreferenceStrength;
  lunch?: LunchBreak | null;
  blockedTimes: BlockedTime[];
  format: FormatPreference;
  formatStrength: PreferenceStrength;
  campus?: string | null;
  campusStrength: PreferenceStrength;
  seats: SeatPolicy;
  preferredInstructors: string[];
  avoidedInstructors: string[];
  creditTarget?: CreditTarget | null;
}

export const BACK_TO_BACK_MINUTES = 30;

export function emptyPreferences(): SchedulePreferences {
  return {
    timeOfDay: {},
    daysOff: 0,
    daysOffStrength: "preferred",
    dayLayout: "noPreference",
    gaps: "noPreference",
    breaks: "fine",
    minimumBreakMinutes: 15,
    minimumBreakStrength: "preferred",
    blockedTimes: [],
    format: "noPreference",
    formatStrength: "preferred",
    campusStrength: "preferred",
    seats: "any",
    preferredInstructors: [],
    avoidedInstructors: [],
  };
}

export function bandPreference(p: SchedulePreferences, band: TimeBand): TimePreference {
  return p.timeOfDay[band] ?? "okay";
}

export function setBandPreference(p: SchedulePreferences, band: TimeBand, value: TimePreference): SchedulePreferences {
  const timeOfDay = { ...p.timeOfDay };
  if (value === "okay") delete timeOfDay[band];
  else timeOfDay[band] = value;
  return { ...p, timeOfDay };
}

export function preferencesAreDefault(p: SchedulePreferences): boolean {
  const e = emptyPreferences();
  return JSON.stringify(normalizeForCompare(p)) === JSON.stringify(normalizeForCompare(e));
}

function normalizeForCompare(p: SchedulePreferences): unknown {
  return {
    ...p,
    timeOfDay: p.timeOfDay,
    blockedTimes: p.blockedTimes.map((block) => ({ label: block.label, days: block.days, start: block.start, end: block.end, strength: block.strength, isEnabled: block.isEnabled })),
  };
}

export function activeBlockedTimes(p: SchedulePreferences): BlockedTime[] {
  return p.blockedTimes.filter(blockedTimeIsActive);
}

export function preferenceActiveCount(p: SchedulePreferences): number {
  let n = 0;
  if (Object.keys(p.timeOfDay).length) n++;
  if (p.earliestStart) n++;
  if (p.latestEnd) n++;
  if (p.daysOff) n++;
  if (p.dayLayout !== "noPreference") n++;
  if (p.maxClassesPerDay != null || p.maxMinutesPerDay != null) n++;
  if (p.gaps !== "noPreference") n++;
  if (p.breaks !== "fine") n++;
  if (p.lunch) n++;
  n += activeBlockedTimes(p).length;
  if (p.format !== "noPreference") n++;
  if (p.campus) n++;
  if (p.seats !== "any") n++;
  if (p.preferredInstructors.length || p.avoidedInstructors.length) n++;
  if (p.creditTarget) n++;
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export function normalizePreferences(input: SchedulePreferences): SchedulePreferences {
  const p: SchedulePreferences = {
    ...input,
    timeOfDay: { ...input.timeOfDay },
    blockedTimes: input.blockedTimes.map((b) => ({ ...b })),
    preferredInstructors: [...input.preferredInstructors],
    avoidedInstructors: [...input.avoidedInstructors],
  };
  if (p.earliestStart) p.earliestStart = { ...p.earliestStart, minutes: clamp(p.earliestStart.minutes, 0, 23 * 60 + 45) };
  if (p.latestEnd) p.latestEnd = { ...p.latestEnd, minutes: clamp(p.latestEnd.minutes, 30, 24 * 60) };
  if (p.maxClassesPerDay != null && (p.maxClassesPerDay < 1 || p.maxClassesPerDay > 8)) p.maxClassesPerDay = null;
  if (p.maxMinutesPerDay != null && (p.maxMinutesPerDay < 60 || p.maxMinutesPerDay > 12 * 60)) p.maxMinutesPerDay = null;
  p.minimumBreakMinutes = clamp(p.minimumBreakMinutes, 5, 90);
  if (p.lunch) {
    const start = clamp(p.lunch.start, 9 * 60, 15 * 60);
    const end = clamp(p.lunch.end, start + 30, 17 * 60);
    const minutes = clamp(p.lunch.minutes, 15, end - start);
    p.lunch = { start, end, minutes };
  }
  const seen = new Set<string>();
  p.blockedTimes = p.blockedTimes
    .map((block) => {
      const label = block.label.trim() || "Blocked time";
      return {
        ...block,
        label,
        start: clamp(block.start, 0, 24 * 60),
        end: clamp(block.end, 0, 24 * 60),
      };
    })
    .filter((block) => {
      if (!blockedTimeIsValid(block)) return false;
      const key = `${block.label.toLowerCase()}|${block.days}|${block.start}|${block.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
  if (p.campus != null) {
    const campus = p.campus.trim();
    p.campus = campus ? campus : null;
  }
  const clean = (names: string[]) => {
    const seenNames = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seenNames.has(k)) continue;
      seenNames.add(k);
      out.push(name);
      if (out.length >= 30) break;
    }
    return out;
  };
  p.preferredInstructors = clean(p.preferredInstructors);
  const preferred = new Set(p.preferredInstructors.map((n) => n.toLowerCase()));
  p.avoidedInstructors = clean(p.avoidedInstructors).filter((n) => !preferred.has(n.toLowerCase()));
  if (p.creditTarget) {
    const lower = clamp(p.creditTarget.lower, 1, 30);
    const upper = clamp(Math.max(p.creditTarget.upper, lower), lower, 30);
    p.creditTarget = { lower, upper };
  }
  return p;
}

export type PreferenceField =
  | "timeOfDay"
  | "earliestStart"
  | "latestEnd"
  | "daysOff"
  | "dayLayout"
  | "maxClassesPerDay"
  | "maxMinutesPerDay"
  | "gaps"
  | "breaks"
  | "lunch"
  | "blockedTimes"
  | "format"
  | "campus"
  | "seats"
  | "instructors"
  | "creditTarget";

export function changedPreferenceFields(next: SchedulePreferences, prev: SchedulePreferences): PreferenceField[] {
  const fields: PreferenceField[] = [];
  const diff = (field: PreferenceField, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) fields.push(field);
  };
  diff("timeOfDay", next.timeOfDay, prev.timeOfDay);
  diff("earliestStart", next.earliestStart ?? null, prev.earliestStart ?? null);
  diff("latestEnd", next.latestEnd ?? null, prev.latestEnd ?? null);
  diff("daysOff", { days: next.daysOff, strength: next.daysOffStrength }, { days: prev.daysOff, strength: prev.daysOffStrength });
  diff("dayLayout", next.dayLayout, prev.dayLayout);
  diff("maxClassesPerDay", next.maxClassesPerDay ?? null, prev.maxClassesPerDay ?? null);
  diff("maxMinutesPerDay", next.maxMinutesPerDay ?? null, prev.maxMinutesPerDay ?? null);
  diff("gaps", next.gaps, prev.gaps);
  diff(
    "breaks",
    { breaks: next.breaks, minutes: next.minimumBreakMinutes, strength: next.minimumBreakStrength },
    { breaks: prev.breaks, minutes: prev.minimumBreakMinutes, strength: prev.minimumBreakStrength },
  );
  diff("lunch", next.lunch ?? null, prev.lunch ?? null);
  diff(
    "blockedTimes",
    next.blockedTimes.map((block) => ({ label: block.label, days: block.days, start: block.start, end: block.end, strength: block.strength, isEnabled: block.isEnabled })),
    prev.blockedTimes.map((block) => ({ label: block.label, days: block.days, start: block.start, end: block.end, strength: block.strength, isEnabled: block.isEnabled })),
  );
  diff("format", { format: next.format, strength: next.formatStrength }, { format: prev.format, strength: prev.formatStrength });
  diff("campus", { campus: next.campus ?? null, strength: next.campusStrength }, { campus: prev.campus ?? null, strength: prev.campusStrength });
  diff("seats", next.seats, prev.seats);
  diff(
    "instructors",
    { preferred: next.preferredInstructors, avoided: next.avoidedInstructors },
    { preferred: prev.preferredInstructors, avoided: prev.avoidedInstructors },
  );
  diff("creditTarget", next.creditTarget ?? null, prev.creditTarget ?? null);
  return fields;
}
