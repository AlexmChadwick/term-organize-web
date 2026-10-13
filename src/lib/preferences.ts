/**
 * Schedule preferences ("your ideal week").
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/Schedule/SchedulePreferences.swift.
 */

import type { CourseSection, DaySet } from "./models";
import { instructorDisplayName, sectionIsOnline } from "./models";

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

/** Swift `hasWishes`: a wish is in force. A switched-off block does not count. */
export function hasWishes(p: SchedulePreferences): boolean {
  return preferenceActiveCount(p) > 0;
}

const TIME_PREFERENCES = new Set<TimePreference>(["avoid", "okay", "prefer"]);
const STRENGTHS = new Set<PreferenceStrength>(["preferred", "required"]);
const DAY_LAYOUTS = new Set<DayLayout>(["noPreference", "fewerDays", "spreadOut"]);
const GAP_PREFERENCES = new Set<GapPreference>(["compact", "noPreference", "fine"]);
const BREAK_PREFERENCES = new Set<BreakPreference>(["fine", "avoidBackToBack", "atLeast"]);
const FORMAT_PREFERENCES = new Set<FormatPreference>(["noPreference", "inPerson", "hybrid", "online"]);
const SEAT_POLICIES = new Set<SeatPolicy>(["any", "waitlistOK", "openOnly"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decodeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function decodeEnum<T extends string>(value: unknown, allowed: Set<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

/** Swift `DaySet` is a `UInt8` masked to the seven weekdays. */
function decodeDaySet(value: unknown): number | null {
  const raw = decodeInt(value);
  if (raw == null || raw < 0 || raw > 255) return null;
  return raw & 0x7f;
}

function newBlockId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function decodeTimeLimit(value: unknown): TimeLimit | null {
  if (!isRecord(value)) return null;
  const minutes = decodeInt(value.minutes);
  if (minutes == null) return null;
  return { minutes, strength: decodeEnum(value.strength, STRENGTHS) ?? "required" };
}

function decodeLunch(value: unknown): LunchBreak | null {
  if (!isRecord(value)) return null;
  return {
    start: decodeInt(value.start) ?? 11 * 60 + 30,
    end: decodeInt(value.end) ?? 14 * 60,
    minutes: decodeInt(value.minutes) ?? 30,
  };
}

function decodeBlockedTime(value: unknown): BlockedTime | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : newBlockId();
  return {
    id,
    label: typeof value.label === "string" ? value.label : "",
    days: decodeDaySet(value.days) ?? 0,
    start: decodeInt(value.start) ?? 0,
    end: decodeInt(value.end) ?? 0,
    strength: decodeEnum(value.strength, STRENGTHS) ?? "required",
    isEnabled: typeof value.isEnabled === "boolean" ? value.isEnabled : true,
  };
}

function decodeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

function decodeCreditTarget(value: unknown): CreditTarget | null {
  if (!isRecord(value)) return null;
  const lower = decodeInt(value.lower);
  const upper = decodeInt(value.upper);
  if (lower == null || upper == null) return null;
  return { lower, upper: Math.max(lower, upper) };
}

/**
 * Swift `SchedulePreferences.init(from:)`. Missing, unknown, and damaged values fall back
 * to the defaults. A value that is not an object at all decodes as no preferences.
 */
export function decodeSchedulePreferences(value: unknown): SchedulePreferences {
  const p = emptyPreferences();
  if (!isRecord(value)) return p;
  if (isRecord(value.timeOfDay)) {
    const raw = value.timeOfDay;
    const entries = Object.entries(raw);
    if (entries.every(([, preference]) => typeof preference === "string")) {
      for (const [band, preference] of entries) {
        if (!TIME_BANDS.includes(band as TimeBand)) continue;
        const wish = decodeEnum(preference, TIME_PREFERENCES);
        if (!wish) continue;
        if (wish === "okay") delete p.timeOfDay[band as TimeBand];
        else p.timeOfDay[band as TimeBand] = wish;
      }
    }
  }
  const earliest = decodeTimeLimit(value.earliestStart);
  if (earliest) p.earliestStart = earliest;
  const latest = decodeTimeLimit(value.latestEnd);
  if (latest) p.latestEnd = latest;
  p.daysOff = decodeDaySet(value.daysOff) ?? 0;
  p.daysOffStrength = decodeEnum(value.daysOffStrength, STRENGTHS) ?? "preferred";
  p.dayLayout = decodeEnum(value.dayLayout, DAY_LAYOUTS) ?? "noPreference";
  const maxClasses = decodeInt(value.maxClassesPerDay);
  if (maxClasses != null) p.maxClassesPerDay = maxClasses;
  const maxMinutes = decodeInt(value.maxMinutesPerDay);
  if (maxMinutes != null) p.maxMinutesPerDay = maxMinutes;
  p.gaps = decodeEnum(value.gaps, GAP_PREFERENCES) ?? "noPreference";
  p.breaks = decodeEnum(value.breaks, BREAK_PREFERENCES) ?? "fine";
  const breakMinutes = decodeInt(value.minimumBreakMinutes);
  if (breakMinutes != null) p.minimumBreakMinutes = breakMinutes;
  p.minimumBreakStrength = decodeEnum(value.minimumBreakStrength, STRENGTHS) ?? "preferred";
  const lunch = decodeLunch(value.lunch);
  if (lunch) p.lunch = lunch;
  if (Array.isArray(value.blockedTimes)) {
    p.blockedTimes = value.blockedTimes.flatMap((item) => {
      const block = decodeBlockedTime(item);
      return block ? [block] : [];
    });
  }
  p.format = decodeEnum(value.format, FORMAT_PREFERENCES) ?? "noPreference";
  p.formatStrength = decodeEnum(value.formatStrength, STRENGTHS) ?? "preferred";
  if (typeof value.campus === "string") p.campus = value.campus;
  p.campusStrength = decodeEnum(value.campusStrength, STRENGTHS) ?? "preferred";
  p.seats = decodeEnum(value.seats, SEAT_POLICIES) ?? "any";
  p.preferredInstructors = decodeStringList(value.preferredInstructors) ?? [];
  p.avoidedInstructors = decodeStringList(value.avoidedInstructors) ?? [];
  const credits = decodeCreditTarget(value.creditTarget);
  if (credits) p.creditTarget = credits;
  return p;
}

/** Swift `SchedulePreferences.encode(to:)`. Nil optionals are omitted. */
export function encodeSchedulePreferences(p: SchedulePreferences): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const bands = Object.entries(p.timeOfDay).filter((entry): entry is [string, TimePreference] => entry[1] != null);
  if (bands.length) out.timeOfDay = Object.fromEntries(bands);
  if (p.earliestStart) out.earliestStart = { minutes: p.earliestStart.minutes, strength: p.earliestStart.strength };
  if (p.latestEnd) out.latestEnd = { minutes: p.latestEnd.minutes, strength: p.latestEnd.strength };
  out.daysOff = p.daysOff;
  out.daysOffStrength = p.daysOffStrength;
  out.dayLayout = p.dayLayout;
  if (p.maxClassesPerDay != null) out.maxClassesPerDay = p.maxClassesPerDay;
  if (p.maxMinutesPerDay != null) out.maxMinutesPerDay = p.maxMinutesPerDay;
  out.gaps = p.gaps;
  out.breaks = p.breaks;
  out.minimumBreakMinutes = p.minimumBreakMinutes;
  out.minimumBreakStrength = p.minimumBreakStrength;
  if (p.lunch) out.lunch = { start: p.lunch.start, end: p.lunch.end, minutes: p.lunch.minutes };
  out.blockedTimes = p.blockedTimes.map((block) => ({
    id: block.id,
    label: block.label,
    days: block.days,
    start: block.start,
    end: block.end,
    strength: block.strength,
    isEnabled: block.isEnabled,
  }));
  out.format = p.format;
  out.formatStrength = p.formatStrength;
  if (p.campus != null) out.campus = p.campus;
  out.campusStrength = p.campusStrength;
  out.seats = p.seats;
  out.preferredInstructors = [...p.preferredInstructors];
  out.avoidedInstructors = [...p.avoidedInstructors];
  if (p.creditTarget) out.creditTarget = { lower: p.creditTarget.lower, upper: p.creditTarget.upper };
  return out;
}

export interface DecodedStoredPlan {
  name: string;
  termCode: string;
  preferences: SchedulePreferences | null;
  courses: unknown[];
}

/**
 * The preferences half of `SchedulePlan`'s Codable. A missing or JSON-null `preferences`
 * stays unset. Any other value decodes as preferences (damaged values become the defaults)
 * so one odd field cannot drop the schedule.
 */
export function decodeStoredSchedulePlan(value: unknown): DecodedStoredPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || typeof value.termCode !== "string") return null;
  let preferences: SchedulePreferences | null = null;
  if ("preferences" in value && value.preferences != null) preferences = decodeSchedulePreferences(value.preferences);
  return {
    name: value.name,
    termCode: value.termCode,
    preferences,
    courses: Array.isArray(value.courses) ? value.courses : [],
  };
}

/** Omit `preferences` when it is unset, matching `encodeIfPresent`. */
export function encodeStoredSchedulePlan(plan: {
  name: string;
  termCode: string;
  courses: unknown[];
  preferences?: SchedulePreferences | null;
  id?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { name: plan.name, termCode: plan.termCode, courses: plan.courses };
  if (plan.id) out.id = plan.id;
  if (plan.preferences != null) out.preferences = encodeSchedulePreferences(plan.preferences);
  return out;
}

/** Swift `UserData` plan list: one unreadable plan is skipped, the rest stay. */
export function decodeStoredUserPlans(value: unknown): DecodedStoredPlan[] {
  if (!isRecord(value) || !Array.isArray(value.plans)) return [];
  return value.plans.flatMap((item) => {
    const decoded = decodeStoredSchedulePlan(item);
    return decoded ? [decoded] : [];
  });
}

export interface ScheduleInstructorOption {
  name: string;
  displayName: string;
  courses: { subject: string; number: string }[];
}

export interface PreferencesSurveyContext {
  campusNames: string[];
  instructors: ScheduleInstructorOption[];
  optionalCourseCount: number;
  requiredCredits: number;
  totalCredits: number;
}

/**
 * Swift `SchedulePreferencesContext`: campuses, instructors, and credits of the plan's courses.
 * A missing catalog yields an empty context.
 */
export function schedulePreferencesContext(
  plan: { courses: { key: { subject: string; number: string }; isRequired: boolean; excludedCRNs: readonly string[] }[] },
  index: {
    campusNames: readonly string[];
    course(key: { subject: string; number: string }): { minCredits: number; maxCredits: number } | null | undefined;
    sectionsOf(key: { subject: string; number: string }): { crn: string; instructors?: { name: string }[] | null }[];
  } | null,
): PreferencesSurveyContext {
  const empty: PreferencesSurveyContext = { campusNames: [], instructors: [], optionalCourseCount: 0, requiredCredits: 0, totalCredits: 0 };
  if (!index) return empty;
  const campusNames = index.campusNames.filter((name) => {
    const lower = name.toLowerCase();
    return !lower.includes("online") && !lower.includes("no campus");
  });
  const byName = new Map<string, ScheduleInstructorOption>();
  let optionalCourseCount = 0;
  let requiredCredits = 0;
  let totalCredits = 0;
  for (const planCourse of plan.courses) {
    const course = index.course(planCourse.key);
    const least = Math.ceil(course?.minCredits ?? 0);
    const most = Math.ceil(course?.maxCredits ?? 0);
    if (planCourse.isRequired) requiredCredits += least;
    else optionalCourseCount += 1;
    totalCredits += Math.max(least, most);
    const excluded = new Set(planCourse.excludedCRNs);
    for (const section of index.sectionsOf(planCourse.key)) {
      if (excluded.has(section.crn)) continue;
      for (const instructor of section.instructors ?? []) {
        const option = byName.get(instructor.name) ?? {
          name: instructor.name,
          displayName: instructorDisplayName(instructor.name),
          courses: [],
        };
        if (!option.courses.some((key) => key.subject === planCourse.key.subject && key.number === planCourse.key.number)) {
          option.courses.push(planCourse.key);
        }
        byName.set(instructor.name, option);
      }
    }
  }
  const instructors = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { campusNames, instructors, optionalCourseCount, requiredCredits, totalCredits };
}

/** One part of the survey, matching Swift `PreferenceField`. */
export type SurveyField =
  | { kind: "timeOfDay"; band: TimeBand }
  | { kind: "earliestStart" }
  | { kind: "latestEnd" }
  | { kind: "daysOff" }
  | { kind: "dayLayout" }
  | { kind: "workload" }
  | { kind: "gaps" }
  | { kind: "breaks" }
  | { kind: "lunch" }
  | { kind: "blockedTime"; id: string }
  | { kind: "format" }
  | { kind: "campus" }
  | { kind: "seats" }
  | { kind: "instructors" }
  | { kind: "credits" };

function sameLimit(a?: TimeLimit | null, b?: TimeLimit | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.minutes === b.minutes && a.strength === b.strength;
}

function sameBlock(a: BlockedTime, b: BlockedTime): boolean {
  return a.id === b.id && a.label === b.label && a.days === b.days && a.start === b.start && a.end === b.end && a.strength === b.strength && a.isEnabled === b.isEnabled;
}

/** Swift `changedFields(from:)`. Removed blocks are not listed; a new or edited block is. */
export function changedSurveyFields(next: SchedulePreferences, old: SchedulePreferences): SurveyField[] {
  const changed: SurveyField[] = [];
  for (const band of TIME_BANDS) {
    if (bandPreference(next, band) !== bandPreference(old, band)) changed.push({ kind: "timeOfDay", band });
  }
  if (!sameLimit(next.earliestStart, old.earliestStart)) changed.push({ kind: "earliestStart" });
  if (!sameLimit(next.latestEnd, old.latestEnd)) changed.push({ kind: "latestEnd" });
  if (next.daysOff !== old.daysOff || (next.daysOff !== 0 && next.daysOffStrength !== old.daysOffStrength)) changed.push({ kind: "daysOff" });
  if (next.dayLayout !== old.dayLayout) changed.push({ kind: "dayLayout" });
  if ((next.maxClassesPerDay ?? null) !== (old.maxClassesPerDay ?? null) || (next.maxMinutesPerDay ?? null) !== (old.maxMinutesPerDay ?? null)) {
    changed.push({ kind: "workload" });
  }
  if (next.gaps !== old.gaps) changed.push({ kind: "gaps" });
  if (
    next.breaks !== old.breaks ||
    (next.breaks === "atLeast" && (next.minimumBreakMinutes !== old.minimumBreakMinutes || next.minimumBreakStrength !== old.minimumBreakStrength))
  ) {
    changed.push({ kind: "breaks" });
  }
  if (JSON.stringify(next.lunch ?? null) !== JSON.stringify(old.lunch ?? null)) changed.push({ kind: "lunch" });
  const oldBlocks = new Map<string, BlockedTime>();
  for (const block of old.blockedTimes) if (!oldBlocks.has(block.id)) oldBlocks.set(block.id, block);
  for (const block of next.blockedTimes) {
    const prev = oldBlocks.get(block.id);
    if (!prev || !sameBlock(prev, block)) changed.push({ kind: "blockedTime", id: block.id });
  }
  if (next.format !== old.format || (next.format !== "noPreference" && next.formatStrength !== old.formatStrength)) changed.push({ kind: "format" });
  if ((next.campus ?? null) !== (old.campus ?? null) || (next.campus != null && next.campusStrength !== old.campusStrength)) changed.push({ kind: "campus" });
  if (next.seats !== old.seats) changed.push({ kind: "seats" });
  if (
    JSON.stringify(next.preferredInstructors) !== JSON.stringify(old.preferredInstructors) ||
    JSON.stringify(next.avoidedInstructors) !== JSON.stringify(old.avoidedInstructors)
  ) {
    changed.push({ kind: "instructors" });
  }
  if (JSON.stringify(next.creditTarget ?? null) !== JSON.stringify(old.creditTarget ?? null)) changed.push({ kind: "credits" });
  return changed;
}

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
