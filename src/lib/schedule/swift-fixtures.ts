/**
 * Shared builders for the Swift schedule-test ports.
 * Production modules are not modified; phrase assembly and presets live here
 * because the web app does not export SchedulePreferences.summary or SchedulePreset.
 */

import type { CourseKey, CourseSection, DaySet, Meeting, ScheduleFilters } from "@/lib/models";
import { dateWindowsOverlap, dayMask, keyId, meetingDays, sectionsConflict, weeklyMeetings } from "@/lib/models";
import type { BlockedTime, FormatPreference, SchedulePreferences, TimeBand, TimePreference } from "@/lib/preferences";
import { TIME_BANDS, activeBlockedTimes, bandPreference, emptyPreferences, normalizePreferences } from "@/lib/preferences";
import { bandPhrase, daysOffPhrase, formatTitle, shortTime } from "@/lib/schedule/preference-rules";
import {
  STANDARD_LIMITS,
  courseInput,
  generateSchedules,
  rejectionReasons,
  type GeneratorLimits,
  type ScheduleCourseInput,
  type ScheduleGenerationResult,
  type ScheduleSortOption,
} from "@/lib/schedule/generator";

export function hours(h: number): number {
  return Math.trunc(h * 60);
}

let blockSerial = 0;

export function blockedTime(
  label: string,
  days: DaySet,
  start: number,
  end: number,
  options?: { strength?: BlockedTime["strength"]; isEnabled?: boolean; id?: string },
): BlockedTime {
  blockSerial += 1;
  return {
    id: options?.id ?? `block-${blockSerial}`,
    label,
    days,
    start,
    end,
    strength: options?.strength ?? "required",
    isEnabled: options?.isEnabled ?? true,
  };
}

export function limit(minutes: number, strength: "preferred" | "required" = "required") {
  return { minutes, strength };
}

export function section(
  crn: string,
  subject: string,
  number: string,
  days: number[],
  start: number,
  end: number,
  options?: {
    seats?: number;
    capacity?: number;
    waitlist?: number;
    building?: string;
    campus?: string;
    method?: string;
    instructors?: string[];
    startDate?: string;
    endDate?: string;
    honors?: boolean;
    sectionNumber?: string;
    classType?: string;
  },
): CourseSection {
  const capacity = options?.capacity ?? 40;
  const seats = options?.seats ?? 10;
  const waitlist = options?.waitlist ?? 0;
  const building = options?.building ?? "WVH";
  const meeting: Meeting = {
    days: dayMask(days),
    start: hours(start),
    end: hours(end),
    buildingCode: building,
    building: building === "WVH" ? "West Village H" : `${building} Hall`,
    room: "210",
    campusCode: "BOS",
    kind: "Class",
    startDate: options?.startDate ?? "2026-09-09",
    endDate: options?.endDate ?? "2026-12-13",
  };
  return {
    crn,
    subject,
    number,
    title: `${subject} ${number}`,
    sectionNumber: options?.sectionNumber ?? "01",
    partOfTerm: "1",
    seatCapacity: capacity,
    seatsRemaining: seats,
    enrollment: capacity - seats,
    waitlistCapacity: waitlist,
    waitlistCount: 0,
    waitlistRemaining: waitlist,
    classType: options?.classType ?? "Lecture",
    honors: options?.honors ?? false,
    campus: options?.campus ?? "Boston",
    instructionMethod: options?.method ?? "Traditional",
    meetings: [meeting],
    instructors: (options?.instructors ?? []).map((name) => ({ name, primary: true })),
    crossListCRNs: [],
    attributes: [],
    description: null,
    prereqs: null,
    coreqs: null,
  };
}

/** Credits default to 0, matching `ScheduleCourseInput`'s Swift defaults. */
export function course(
  subject: string,
  number: string,
  sections: CourseSection[],
  options?: { required?: boolean; credits?: number; excludedCRNs?: Iterable<string> },
): ScheduleCourseInput {
  const credits = options?.credits ?? 0;
  return courseInput({ subject, number }, sections, {
    isRequired: options?.required ?? true,
    excludedCRNs: options?.excludedCRNs,
    minCredits: credits,
    maxCredits: credits,
  });
}

export function generate(
  courses: ScheduleCourseInput[],
  preferences: SchedulePreferences = emptyPreferences(),
  filters: ScheduleFilters = { freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0 },
  sort: ScheduleSortOption = "best",
  limits: GeneratorLimits = STANDARD_LIMITS,
): ScheduleGenerationResult {
  return generateSchedules(courses, filters, preferences, sort, limits);
}

export function crnSets(result: ScheduleGenerationResult): string[] {
  return result.schedules.map((schedule) => [...schedule.crns].sort().join("|")).sort();
}

export function expectSets(rows: string[][]): string[] {
  return rows.map((row) => [...row].sort().join("|")).sort();
}

function hoursLabel(minutes: number): string {
  const value = minutes / 60;
  return value % 1 === 0 ? `${value} h` : `${value.toFixed(1)} h`;
}

function timeOfDayPhrase(p: SchedulePreferences): string | null {
  const preferred = TIME_BANDS.filter((band) => bandPreference(p, band) === "prefer");
  const avoided = TIME_BANDS.filter((band) => bandPreference(p, band) === "avoid");
  if (preferred.length) {
    const text = bandPhrase(preferred);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
  }
  if (avoided.length) {
    const text = bandPhrase(avoided);
    return text ? `No ${text}` : null;
  }
  return null;
}

/** Swift `summaryParts`, built from the exported phrase helpers. */
export function summaryParts(p: SchedulePreferences): string[] {
  const parts: string[] = [];
  const time = timeOfDayPhrase(p);
  if (time) parts.push(time);
  if (p.earliestStart) {
    parts.push(
      p.earliestStart.strength === "required"
        ? `Nothing before ${shortTime(p.earliestStart.minutes)}`
        : `Prefer after ${shortTime(p.earliestStart.minutes)}`,
    );
  }
  if (p.latestEnd) {
    parts.push(
      p.latestEnd.strength === "required"
        ? `Done by ${shortTime(p.latestEnd.minutes)}`
        : `Prefer done by ${shortTime(p.latestEnd.minutes)}`,
    );
  }
  if (p.daysOff) parts.push(daysOffPhrase(p.daysOff));
  if (p.dayLayout === "fewerDays") parts.push("Fewer days");
  if (p.dayLayout === "spreadOut") parts.push("Spread out");
  const blocked = activeBlockedTimes(p).length;
  if (blocked > 0) parts.push(blocked === 1 ? "1 blocked time" : `${blocked} blocked times`);
  if (p.gaps === "compact") parts.push("Short gaps");
  if (p.gaps === "fine") parts.push("Gaps are fine");
  if (p.breaks === "avoidBackToBack") parts.push("No back-to-back");
  if (p.breaks === "atLeast") parts.push(`${p.minimumBreakMinutes} min to walk`);
  if (p.lunch) parts.push("Lunch break");
  if (p.maxClassesPerDay != null) parts.push(`Up to ${p.maxClassesPerDay} a day`);
  if (p.maxMinutesPerDay != null) parts.push(`Up to ${hoursLabel(p.maxMinutesPerDay)} a day`);
  if (p.format !== "noPreference") parts.push(formatTitle(p.format as FormatPreference));
  if (p.campus) parts.push(p.campus);
  if (p.seats === "waitlistOK") parts.push("Waitlists OK");
  if (p.seats === "openOnly") parts.push("Open seats");
  const instructors = p.preferredInstructors.length + p.avoidedInstructors.length;
  if (instructors > 0) parts.push(instructors === 1 ? "1 instructor" : `${instructors} instructors`);
  if (p.creditTarget) {
    const { lower, upper } = p.creditTarget;
    parts.push(lower === upper ? `${lower} credits` : `${lower}\u2013${upper} credits`);
  }
  return parts;
}

export function summary(p: SchedulePreferences, limit = 3): string {
  const parts = summaryParts(p);
  if (!parts.length) return "No preferences yet";
  if (parts.length <= limit) return parts.join(" · ");
  return [...parts.slice(0, limit), `+${parts.length - limit}`].join(" · ");
}

type Preset = "morningPerson" | "nightOwl" | "longWeekends" | "compactDays";

const PRESET_BANDS: Record<"morningPerson" | "nightOwl", Partial<Record<TimeBand, TimePreference>>> = {
  morningPerson: { earlyMorning: "prefer", morning: "prefer", evening: "avoid", night: "avoid" },
  nightOwl: { earlyMorning: "avoid", morning: "avoid", afternoon: "prefer", evening: "prefer", night: "prefer" },
};

function sameBands(a: Partial<Record<TimeBand, TimePreference>>, b: Partial<Record<TimeBand, TimePreference>>): boolean {
  const keys = TIME_BANDS.filter((band) => a[band] != null || b[band] != null);
  return keys.every((band) => (a[band] ?? "okay") === (b[band] ?? "okay")) && Object.keys(a).length === Object.keys(b).length;
}

export function presetApplied(preset: Preset, p: SchedulePreferences): boolean {
  if (preset === "morningPerson" || preset === "nightOwl") return sameBands(p.timeOfDay, PRESET_BANDS[preset]);
  if (preset === "longWeekends") return (p.daysOff & (1 << 5)) !== 0 && p.dayLayout === "fewerDays";
  return p.dayLayout === "fewerDays" && p.gaps === "compact";
}

/** Swift `SchedulePreset.toggled(in:)`. Presets are not exported by the web app. */
export function togglePreset(preset: Preset, p: SchedulePreferences): SchedulePreferences {
  const next: SchedulePreferences = {
    ...p,
    timeOfDay: { ...p.timeOfDay },
    blockedTimes: p.blockedTimes.map((block) => ({ ...block })),
    preferredInstructors: [...p.preferredInstructors],
    avoidedInstructors: [...p.avoidedInstructors],
  };
  if (presetApplied(preset, p)) {
    if (preset === "morningPerson" || preset === "nightOwl") next.timeOfDay = {};
    else if (preset === "longWeekends") {
      next.daysOff = p.daysOff & ~(1 << 5);
      if (p.gaps !== "compact") next.dayLayout = "noPreference";
    } else {
      next.gaps = "noPreference";
      if ((p.daysOff & (1 << 5)) === 0) next.dayLayout = "noPreference";
    }
    return next;
  }
  if (preset === "morningPerson" || preset === "nightOwl") next.timeOfDay = { ...PRESET_BANDS[preset] };
  else if (preset === "longWeekends") {
    next.daysOff = p.daysOff | (1 << 5);
    next.dayLayout = "fewerDays";
  } else {
    next.dayLayout = "fewerDays";
    next.gaps = "compact";
  }
  return next;
}

export function keyText(key: CourseKey): string {
  return keyId(key);
}

/** Swift walking-time rule: unknown buildings are the same building, so they are not "too close". */
export function swiftTooClose(a: CourseSection, b: CourseSection, minutes: number): boolean {
  for (const x of weeklyMeetings(a)) {
    for (const y of weeklyMeetings(b)) {
      if ((x.days & y.days) === 0) continue;
      if (x.start == null || x.end == null || y.start == null || y.end == null) continue;
      const gap = y.start >= x.end ? y.start - x.end : x.start >= y.end ? x.start - y.end : -1;
      if (gap < 0) continue;
      if (gap >= minutes) continue;
      if (!dateWindowsOverlap(x.startDate, x.endDate, y.startDate, y.endDate)) continue;
      if (x.buildingCode !== y.buildingCode) return true;
    }
  }
  return false;
}

export function swiftFits(section: CourseSection, picked: CourseSection[], p: SchedulePreferences): boolean {
  for (const other of picked) {
    if (sectionsConflict(section, other)) return false;
    if (p.breaks === "atLeast" && p.minimumBreakStrength === "required" && swiftTooClose(section, other, p.minimumBreakMinutes)) return false;
  }
  const all = [...picked, section];
  for (let day = 0; day < 7; day++) {
    const onDay = all.filter((item) => (meetingDays(item) & (1 << day)) !== 0);
    if (p.maxClassesPerDay != null && onDay.length > p.maxClassesPerDay) return false;
    if (p.maxMinutesPerDay != null) {
      let minutes = 0;
      for (const item of onDay) {
        const seen = new Set<string>();
        for (const meeting of weeklyMeetings(item)) {
          if ((meeting.days & (1 << day)) === 0) continue;
          const key = `${meeting.start ?? 0}-${meeting.end ?? 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          minutes += (meeting.end ?? 0) - (meeting.start ?? 0);
        }
      }
      if (minutes > p.maxMinutesPerDay) return false;
    }
  }
  return true;
}

export function bruteForce(courses: ScheduleCourseInput[], filters: ScheduleFilters, p: SchedulePreferences): Set<string> {
  const normalized = normalizePreferences(p);
  const kept = courses.map((entry) =>
    entry.sections.filter((item) => rejectionReasons(item, filters, normalized, entry.excludedCRNs ?? new Set()) === 0),
  );
  const result = new Set<string>();
  const target = filters.courseCount != null && filters.courseCount > 0 ? filters.courseCount : null;

  const finish = (picks: { course: number; section: CourseSection }[]) => {
    if (!picks.length) return;
    if (target != null && picks.length !== target) return;
    if (normalized.creditTarget) {
      const low = picks.reduce((sum, pick) => sum + (courses[pick.course]!.minCredits ?? 0), 0);
      const high = picks.reduce(
        (sum, pick) => sum + Math.max(courses[pick.course]!.minCredits ?? 0, courses[pick.course]!.maxCredits ?? 0),
        0,
      );
      if (low > normalized.creditTarget.upper || high < normalized.creditTarget.lower) return;
    } else if (target == null) {
      const chosen = new Set(picks.map((pick) => pick.course));
      const sections = picks.map((pick) => pick.section);
      for (let index = 0; index < courses.length; index++) {
        if (chosen.has(index)) continue;
        if (kept[index]!.some((item) => swiftFits(item, sections, normalized))) return;
      }
    }
    result.add([...picks.map((pick) => pick.section.crn)].sort().join("|"));
  };

  const walk = (index: number, picks: { course: number; section: CourseSection }[]) => {
    if (index === courses.length) {
      finish(picks);
      return;
    }
    if (!courses[index]!.isRequired) walk(index + 1, picks);
    for (const item of kept[index]!) {
      if (swiftFits(item, picks.map((pick) => pick.section), normalized)) walk(index + 1, [...picks, { course: index, section: item }]);
    }
  };
  walk(0, []);
  return result;
}
