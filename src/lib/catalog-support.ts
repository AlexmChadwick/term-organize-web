/**
 * Catalog screen logic shared by search, subjects, professors, and the course page.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of SearchFilterSupport, HomeQuickSearch, BrowseSummary, SearchExamples,
 * ProfessorPage, and CourseDegreePlanStanding.
 */

import type { CatalogIndex, InstructorSummary } from "@/lib/catalog-index";
import {
  COURSE_PALETTE,
  Day,
  NU_PATHS,
  compareCourseKeys,
  courseColorIndex,
  dayCompactLabel,
  emptySearchFilters,
  keyId,
  sameKey,
  sectionKey,
  type CourseKey,
  type CourseSection,
  type SearchFilters,
} from "@/lib/models";
import type { SchedulePlan, UserData } from "@/lib/user";

export interface DayPreset {
  id: string;
  days: number | null;
  menuTitle: string;
  chipTitle: string;
}

const DAY_PRESETS: readonly DayPreset[] = [
  { id: "any", days: null, menuTitle: "Any days", chipTitle: "Days" },
  {
    id: "noFridays",
    days: Day.monday | Day.tuesday | Day.wednesday | Day.thursday,
    menuTitle: "No Friday classes",
    chipTitle: "No Fridays",
  },
  { id: "mwr", days: Day.monday | Day.wednesday | Day.thursday, menuTitle: "Mon, Wed, Thu only", chipTitle: "MWR only" },
  { id: "tf", days: Day.tuesday | Day.friday, menuTitle: "Tue, Fri only", chipTitle: "TF only" },
  { id: "mr", days: Day.monday | Day.thursday, menuTitle: "Mon, Thu only", chipTitle: "MR only" },
  { id: "wf", days: Day.wednesday | Day.friday, menuTitle: "Wed, Fri only", chipTitle: "WF only" },
  { id: "custom", days: null, menuTitle: "Custom\u2026", chipTitle: "Custom days" },
];

/** Meeting-day presets offered by the filter bar's Days menu. */
export const SearchDayPreset = {
  allCases: DAY_PRESETS,

  /** The preset that describes exactly `days`, if any. Never `custom`. */
  matching(days: number | null): string | null {
    const found = DAY_PRESETS.find((preset) => preset.id !== "custom" && preset.days === days);
    return found?.id ?? null;
  },

  /** The preset to show as selected: a matching preset, or `custom`. */
  selection(days: number | null): string {
    return SearchDayPreset.matching(days) ?? "custom";
  },

  chipTitle(id: string): string {
    return DAY_PRESETS.find((preset) => preset.id === id)?.chipTitle ?? "Days";
  },
};

/** Short chip titles that summarize the active filters. */
export const SearchFilterTitles = {
  days(days: number | null): string {
    if (days == null) return "Days";
    const preset = SearchDayPreset.matching(days);
    if (preset) return SearchDayPreset.chipTitle(preset);
    return days === 0 ? "No set days" : `${dayCompactLabel(days)} only`;
  },

  subjects(subjects: readonly string[]): string {
    if (subjects.length === 0) return "Subject";
    if (subjects.length === 1) return subjects[0] ?? "Subject";
    return `${subjects.length} subjects`;
  },

  /** Short codes (`FQ`) or attribute codes (`NCFQ`), in NUpath order. */
  nupaths(codes: readonly string[]): string {
    if (codes.length === 0) return "NUpath";
    if (codes.length <= 2) {
      const wanted = new Set(codes);
      return NU_PATHS.filter((path) => wanted.has(path.short) || wanted.has(path.code))
        .map((path) => path.short)
        .join(", ");
    }
    return `NUpath \u00b7 ${codes.length}`;
  },

  level(level: number): string {
    return level === 0 ? "Under 1000" : `${level}000`;
  },
};

/** A fixed mid-January day, so a daylight-saving shift can never skip a time. */
export function searchDateFromMinutes(minutes: number): Date {
  const clamped = Math.min(Math.max(minutes, 0), 24 * 60 - 1);
  return new Date(2001, 0, 15, Math.floor(clamped / 60), clamped % 60, 0, 0);
}

export function searchMinutesFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Minutes within one day, clamped, on a fixed mid-January date. */
export const SearchTimeOfDay = {
  date: searchDateFromMinutes,
  minutes: searchMinutesFromDate,
};

export interface QuickSearchPreset {
  id: string;
  title: string;
  symbol: string;
  filters: SearchFilters;
}

function quickFilters(patch: Partial<SearchFilters>): SearchFilters {
  return { ...emptySearchFilters(), ...patch };
}

const QUICK_SEARCHES: readonly QuickSearchPreset[] = [
  { id: "openSeats", title: "Open seats", symbol: "chair", filters: quickFilters({ openSeatsOnly: true }) },
  { id: "honors", title: "Honors", symbol: "star", filters: quickFilters({ honorsOnly: true }) },
  { id: "online", title: "Online", symbol: "laptopcomputer", filters: quickFilters({ instruction: "online" }) },
  {
    id: "noFridays",
    title: "No Friday classes",
    symbol: "calendar.badge.minus",
    filters: quickFilters({ allowedDays: Day.monday | Day.tuesday | Day.wednesday | Day.thursday }),
  },
  { id: "firstYear", title: "1000-level", symbol: "1.circle", filters: quickFilters({ levels: [1] }) },
];

/** Preset searches offered on the catalog home screen. */
export const HomeQuickSearch = {
  allCases: QUICK_SEARCHES,
  openSeats: QUICK_SEARCHES[0]!,
  honors: QUICK_SEARCHES[1]!,
  online: QUICK_SEARCHES[2]!,
  noFridays: QUICK_SEARCHES[3]!,
  firstYear: QUICK_SEARCHES[4]!,
};

function formattedCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** A count line such as "12 of 42 courses · 9 with open seats". */
export function browseSummaryText(shown: number, total: number, open: number, openOnly = false, noun = "course"): string {
  const plural = (count: number) => (count === 1 ? noun : `${noun}s`);
  let text =
    shown === total
      ? `${formattedCount(total)} ${plural(total)}`
      : `${formattedCount(shown)} of ${formattedCount(total)} ${plural(total)}`;
  if (open > 0 && !openOnly) text += ` \u00b7 ${formattedCount(open)} with open seats`;
  return text;
}

/** "1000-level", or a neutral label for course numbers that do not start with 1…9. */
export function browseLevelTitle(level: number): string {
  return level === 0 ? "Under 1000" : `${level}000-level`;
}

/** "3000-level courses", or "courses under 1000". */
export function browseLevelNoun(level: number): string {
  return level === 0 ? "courses under 1000" : `${level}000-level courses`;
}

export interface SearchExample {
  title: string;
  caption: string;
  symbol: string;
}

/** Examples built from the loaded catalog, so every one of them finds something. */
export function searchExamples(index: CatalogIndex): SearchExample[] {
  const result: SearchExample[] = [];
  const preferred = ["CS 3000", "CS 2500", "MATH 1341", "ENGW 1111", "PHYS 1151"];
  const exampleKey =
    preferred
      .map((code) => {
        const [subject, number] = code.split(" ");
        return subject && number ? { subject, number } : null;
      })
      .find((key) => key != null && index.course(key) != null) ??
    (index.courses[0] ? { subject: index.courses[0].subject, number: index.courses[0].number } : null);

  if (exampleKey) {
    result.push({ title: keyId(exampleKey), caption: "Course code", symbol: "book.closed" });
  }

  const topics = ["machine learning", "data structures", "calculus", "psychology", "writing"];
  const topic = topics.find((candidate) => index.documents.some((doc) => doc.titleNormalized.includes(candidate)));
  if (topic) result.push({ title: topic, caption: "Topic or title", symbol: "lightbulb" });

  const crn =
    (exampleKey ? index.sectionsOf(exampleKey)[0]?.crn : undefined) ?? index.catalog.sections[0]?.crn;
  if (crn) result.push({ title: crn, caption: "CRN", symbol: "number" });

  const teacherName = exampleKey
    ? index.sectionsOf(exampleKey).flatMap((section) => {
        const instructor = section.instructors?.find((person) => person.primary) ?? section.instructors?.[0];
        return instructor ? [instructor.name] : [];
      })[0]
    : undefined;
  const named = teacherName ? index.instructors.find((person) => person.name === teacherName) : undefined;
  let busiest: InstructorSummary | undefined;
  if (!named) {
    for (const person of index.instructors) {
      if (!busiest || person.courseKeys.length > busiest.courseKeys.length) busiest = person;
    }
  }
  const professor = named ?? busiest;
  if (professor) result.push({ title: professor.displayName, caption: "Professor", symbol: "person.crop.circle" });
  return result;
}

/** Examples built from the loaded catalog, so every one of them finds something. */
export const SearchExampleCache = {
  examples: searchExamples,
};

/** Their sections, ordered by course and then section number. */
export function professorSections(summary: InstructorSummary, index: CatalogIndex): CourseSection[] {
  return summary.crns
    .flatMap((crn) => {
      const section = index.sectionByCRN(crn);
      return section ? [section] : [];
    })
    .sort((left, right) => {
      const byCourse = compareCourseKeys(sectionKey(left), sectionKey(right));
      if (byCourse !== 0) return byCourse;
      return left.sectionNumber.localeCompare(right.sectionNumber, undefined, { numeric: true, sensitivity: "base" });
    });
}

/** A stable color per course. A color already taken by another course shifts to the next free slot. */
export function professorCourseColors(keys: readonly CourseKey[]): Map<string, (typeof COURSE_PALETTE)[number]> {
  const used = new Set<number>();
  const colors = new Map<string, (typeof COURSE_PALETTE)[number]>();
  for (const key of keys) {
    let slot = courseColorIndex(keyId(key));
    if (used.size < COURSE_PALETTE.length) {
      while (used.has(slot)) slot = (slot + 1) % COURSE_PALETTE.length;
    }
    used.add(slot);
    const color = COURSE_PALETTE[slot];
    if (color) colors.set(keyId(key), color);
  }
  return colors;
}

const QUERY_SAFE = /^[A-Za-z0-9._~-]$/;

/** `https://www.ratemyprofessors.com/search/professors/696?q=First%20Last` (696 is Northeastern). */
export function rateMyProfessorsURL(displayName: string): string {
  let query = "";
  for (const byte of new TextEncoder().encode(displayName)) {
    const char = String.fromCharCode(byte);
    query += QUERY_SAFE.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `https://www.ratemyprofessors.com/search/professors/696?q=${query}`;
}

/** `Section 02` / `Sections 01, 04`. */
export function professorSectionNote(key: CourseKey, sections: readonly CourseSection[]): string {
  const numbers = sections.filter((section) => sameKey(sectionKey(section), key)).map((section) => section.sectionNumber);
  return `${numbers.length === 1 ? "Section" : "Sections"} ${numbers.join(", ")}`;
}

/** `Teaches 3 sections across 2 courses`. */
export function professorSummaryText(sections: readonly CourseSection[]): string {
  const courses = new Set(sections.map((section) => keyId(sectionKey(section))));
  const count = (value: number, noun: string) => `${value} ${value === 1 ? noun : `${noun}s`}`;
  return `Teaches ${count(sections.length, "section")} across ${count(courses.size, "course")}`;
}

/** Section order, distinct course colors, and the Rate My Professors link. */
export const ProfessorPage = {
  sections: professorSections,
  courseColors: professorCourseColors,
  summaryText: professorSummaryText,
  sectionNote: professorSectionNote,
  rateMyProfessorsURL,
};

/** Symbol shown beside a course's place in the degree plan. */
export function courseStatusSymbol(status: { type: string }): string {
  return status.type === "completed" ? "checkmark.circle.fill" : "calendar";
}

/** `Completed`, `Completed via CS 2510`, `Planned · Spring 2027`. */
export function degreePlanStandingText(kind: "completed" | "planned", via: CourseKey | null, semester?: string): string {
  const standing = new CourseDegreePlanStanding(
    "",
    kind === "completed" ? { type: "completed", via } : { type: "planned", semester: semester ?? "", via },
  );
  return standing.text;
}

/** The same standing, phrased for speech. */
export function degreePlanStandingSpoken(kind: "completed" | "planned", via: CourseKey | null, semester?: string): string {
  const standing = new CourseDegreePlanStanding(
    "",
    kind === "completed" ? { type: "completed", via } : { type: "planned", semester: semester ?? "", via },
  );
  return standing.spokenText;
}

export type DegreeStandingKind =
  | { type: "completed"; via: CourseKey | null }
  | { type: "planned"; semester: string; via: CourseKey | null };

/** What the primary degree plan does with a course, for the tag in the course header. */
export class CourseDegreePlanStanding {
  constructor(
    readonly planID: string,
    readonly kind: DegreeStandingKind,
  ) {}

  get text(): string {
    if (this.kind.type === "completed") {
      return this.kind.via ? `Completed via ${keyId(this.kind.via)}` : "Completed";
    }
    return this.kind.via
      ? `Planned via ${keyId(this.kind.via)} \u00b7 ${this.kind.semester}`
      : `Planned \u00b7 ${this.kind.semester}`;
  }

  get symbol(): string {
    return this.kind.type === "completed" ? "checkmark.circle.fill" : "calendar";
  }

  get spokenText(): string {
    if (this.kind.type === "completed") {
      return this.kind.via
        ? `Completed via ${keyId(this.kind.via)}, in your degree plan`
        : "Completed, in your degree plan";
    }
    return this.kind.via
      ? `Planned via ${keyId(this.kind.via)} for ${this.kind.semester} in your degree plan`
      : `Planned for ${this.kind.semester} in your degree plan`;
  }
}

/**
 * Whether a plan for the term already holds the course (`crn` omitted) or the given section
 * (a plan's selected CRNs). Another term's plans do not count.
 */
export function courseIsInSchedule(data: UserData, termCode: string, key: CourseKey, crn?: string): boolean {
  const termPlans = data.plans.filter((plan) => plan.termCode === termCode);
  if (crn != null) return termPlans.some((plan) => plan.selectedCRNs.includes(crn));
  return termPlans.some((plan) => planContains(plan, key));
}

function planContains(plan: SchedulePlan, key: CourseKey): boolean {
  return plan.courses.some((course) => sameKey(course.key, key));
}
