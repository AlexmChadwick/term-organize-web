/**
 * Why a generation found nothing, and the words every screen uses to say so.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseKey, ScheduleFilters } from "@/lib/models";
import { keyId, sameKey, timeLabel } from "@/lib/models";
import type { SchedulePreferences } from "@/lib/preferences";
import { emptyPreferences } from "@/lib/preferences";
import {
  ScheduleBlockerAnalysis,
  analyzeBlockers,
  suggestRelaxations,
  type ConflictPair,
  type CountProblem,
  type CourseReport,
  type ScheduleBlockerOption,
  type ScheduleCourseInput,
  type ScheduleDiagnostics,
  type ScheduleGenerationResult,
  type ScheduleSuggestion,
} from "@/lib/schedule/generator";
import { formatTitle, type ScheduleFilterReason } from "@/lib/schedule/preference-rules";

/** Everything worth saying about an empty result: why, which courses block it, and what would help. */
export interface ScheduleNoResults {
  diagnostics: ScheduleDiagnostics;
  /** Loosening a filter or preference that would leave schedules. */
  suggestions: ScheduleSuggestion[];
  blockers: ScheduleBlockerAnalysis;
}

/**
 * Explains an empty result: the blocking courses and the single relaxations that would help.
 * The blocking courses already say which courses to let go of; without them, that is offered here.
 */
export function analyzeEmptyResult(
  courses: readonly ScheduleCourseInput[],
  filters: ScheduleFilters,
  preferences: SchedulePreferences = emptyPreferences(),
  diagnostics: ScheduleDiagnostics,
  includeBlockers = true,
  isCancelled?: () => boolean,
): ScheduleNoResults {
  const blockers = includeBlockers
    ? analyzeBlockers(courses, filters, preferences, diagnostics, 1.5, 60, isCancelled)
    : new ScheduleBlockerAnalysis();
  const suggestions = isCancelled?.()
    ? []
    : suggestRelaxations(courses, filters, preferences, !includeBlockers, isCancelled);
  return { diagnostics, suggestions, blockers };
}

/** One thing standing in the way of a schedule. */
export interface NoResultsReason {
  symbol: string;
  title: string;
  detail?: string;
}

const APOSTROPHE = "\u2019";

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function containsFold(text: string, needle: string): boolean {
  return text.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

/** The words of the "no schedules fit" help, shared by every screen that shows it. */
export const ScheduleNoResultsText = {
  requiredCount(diagnostics: ScheduleDiagnostics): number {
    return diagnostics.courses.filter((course) => course.isRequired).length;
  },

  title(diagnostics: ScheduleDiagnostics): string {
    const required = ScheduleNoResultsText.requiredCount(diagnostics);
    if (diagnostics.countProblem != null || required <= 1) return "No schedules fit";
    return diagnostics.courses.length > required
      ? `No schedule fits all ${required} required courses`
      : `No schedule fits all ${required} courses`;
  },

  headline(diagnostics: ScheduleDiagnostics, blockers?: ScheduleBlockerAnalysis | null): string {
    if (diagnostics.hasNoCourses) return "Add some courses to this schedule first.";
    if (blockers && blockers.options.length > 0) return `Here${APOSTROPHE}s what would work.`;
    if (
      diagnostics.countProblem != null ||
      diagnostics.blockedRequiredCourses.length > 0 ||
      diagnostics.conflictingPairs.length > 0
    ) {
      return `Here${APOSTROPHE}s what${APOSTROPHE}s getting in the way.`;
    }
    return `These courses can${APOSTROPHE}t all be taken together with the current rules.`;
  },

  /** `CS 3386`, `CS 3386 and MATH 2331`, `CS 3386, MATH 2331 and PHYS 1151`. */
  list(keys: readonly CourseKey[]): string {
    const names = keys.map((key) => keyId(key));
    if (names.length === 0) return "";
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  },

  /** The facts under a "Works without…" option: how many schedules, and what stops the courses. */
  detail(option: ScheduleBlockerOption, blockers: ScheduleBlockerAnalysis, termName: string): string {
    const parts: string[] = [];
    const count = formatCount(option.scheduleCount);
    const noun = option.scheduleCount === 1 && !option.isLowerBound ? "schedule" : "schedules";
    parts.push(option.isLowerBound ? `${count}+ ${noun}` : `${count} ${noun}`);
    for (const key of option.courses) {
      if (blockers.notOffered.some((offered) => sameKey(offered, key))) {
        parts.push(`${keyId(key)} isn${APOSTROPHE}t offered in ${termName}`);
      } else if (blockers.filteredOut.some((filtered) => sameKey(filtered, key))) {
        parts.push(`your rules rule out every ${keyId(key)} section`);
      }
    }
    const only = option.courses[0];
    if (option.courses.length === 1 && only) {
      const clashes = blockers.clashes(only);
      if (clashes.length > 0) parts.push(`overlaps ${ScheduleNoResultsText.list(clashes)}`);
    }
    return parts.join(" · ");
  },

  /** Reasons that say something couldn't be checked ("Offering history unknown") aren't good news. */
  isUncertain(reason: string): boolean {
    return containsFold(reason, "unknown") || containsFold(reason, `couldn${APOSTROPHE}t`);
  },

  /** `12 schedules`, `1,000+ schedules` for a loosened rule or an option. */
  countText(suggestion: ScheduleSuggestion): string {
    const count = formatCount(suggestion.scheduleCount);
    const noun = suggestion.scheduleCount === 1 && !suggestion.isLowerBound ? "schedule" : "schedules";
    return suggestion.isLowerBound ? `${count}+ ${noun}` : `${count} ${noun}`;
  },

  /** What's in the way: blocked courses, courses that always overlap, count and credit problems. */
  reasons(diagnostics: ScheduleDiagnostics, termName: string): NoResultsReason[] {
    const result: NoResultsReason[] = [];

    for (const report of diagnostics.courses) {
      if (!report.isBlocked || !report.isRequired) continue;
      if (report.totalSections === 0) {
        result.push({
          symbol: "questionmark.folder",
          title: `${keyId(report.key)} isn${APOSTROPHE}t offered in ${termName}`,
          detail: "Remove it from the schedule or make it optional.",
        });
      } else {
        result.push({
          symbol: "xmark.circle",
          title: `No ${keyId(report.key)} sections left`,
          detail: rejectionText(report, diagnostics),
        });
      }
    }

    for (const pair of diagnostics.conflictingPairs) {
      result.push(pairReason(pair, diagnostics));
    }

    const count = countReason(diagnostics.countProblem);
    if (count) result.push(count);

    for (const report of diagnostics.courses) {
      if (!report.isBlocked || report.isRequired || report.totalSections <= 0) continue;
      result.push({
        symbol: "minus.circle",
        title: `${keyId(report.key)} (optional) can${APOSTROPHE}t be added`,
        detail: rejectionText(report, diagnostics),
      });
    }
    return result;
  },

  /**
   * Why a course's sections were all rejected: `All 5 sections start before 10 AM.`
   * Public so screens can reuse the same sentence the reasons list uses.
   */
  rejectionText,
};

function pairReason(pair: ConflictPair, diagnostics: ScheduleDiagnostics): NoResultsReason {
  const first = keyId(pair.first);
  const second = keyId(pair.second);
  if (pair.reason === "travelTime") {
    const minutes = diagnostics.preferences.minimumBreakMinutes;
    return {
      symbol: "figure.walk",
      title: `${first} and ${second} are always too close together`,
      detail: `Every combination leaves less than ${minutes} minutes between them in different buildings. Lower the walking time or make one optional.`,
    };
  }
  return {
    symbol: "rectangle.on.rectangle.slash",
    title: `${first} and ${second} always overlap`,
    detail:
      "Every remaining section of one meets while a section of the other does. Make one optional or pick different sections.",
  };
}

function countReason(problem: CountProblem | null): NoResultsReason | null {
  if (!problem) return null;
  switch (problem.kind) {
    case "tooManyRequired":
      return {
        symbol: "number.circle",
        title: `${problem.required} courses are required, but schedules are limited to ${problem.wanted}`,
        detail: "Raise the number of courses or make some courses optional.",
      };
    case "tooFewCourses":
      return {
        symbol: "number.circle",
        title: `Only ${problem.available} ${problem.available === 1 ? "course has" : "courses have"} sections left, but ${problem.wanted} are wanted`,
        detail: "Lower the number of courses or relax a filter.",
      };
    case "creditsOverTarget":
      return {
        symbol: "number.circle",
        title: `The required courses are ${problem.required} credits, but your target stops at ${problem.limit}`,
        detail: "Raise the credit target or make a course optional.",
      };
    case "creditsUnderTarget":
      return {
        symbol: "number.circle",
        title: `Your courses add up to ${problem.available} credits, but you want ${problem.wanted}`,
        detail: "Lower the credit target or add a course.",
      };
  }
}

/** Why a course's sections were all rejected: `All 5 sections start before 10 AM.` */
export function rejectionText(report: CourseReport, diagnostics: ScheduleDiagnostics): string {
  const total = report.totalSections;
  const ordered = Object.entries(report.rejections)
    .filter((entry): entry is [ScheduleFilterReason, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : reasonOrder(a[0]) - reasonOrder(b[0])));
  if (ordered.length === 0) {
    return total === 1 ? "Its only section was filtered out." : `All ${total} sections were filtered out.`;
  }
  const filters = diagnostics.filters;
  const preferences = diagnostics.preferences;

  const phrase = (reason: ScheduleFilterReason, plural: boolean): string => {
    switch (reason) {
      case "excludedByUser":
        return plural ? "are skipped by you" : "is skipped by you";
      case "startsTooEarly":
        return `${plural ? "start" : "starts"} before ${filters.earliestStart != null ? timeLabel(filters.earliestStart) : "your limit"}`;
      case "endsTooLate":
        return `${plural ? "end" : "ends"} after ${filters.latestEnd != null ? timeLabel(filters.latestEnd) : "your limit"}`;
      case "freeDay":
        return `${plural ? "meet" : "meets"} on a day you want free`;
      case "honors":
        return plural ? "are honors sections" : "is an honors section";
      case "online":
        return plural ? "are online" : "is online";
      case "seats":
        return plural ? "are full or low on seats" : "is full or low on seats";
      case "campus":
        return plural ? "are on another campus" : "is on another campus";
      case "blockedTime":
        return plural ? "overlap a blocked time" : "overlaps a blocked time";
      case "prefStartsTooEarly":
        return `${plural ? "start" : "starts"} before ${preferences.earliestStart != null ? timeLabel(preferences.earliestStart.minutes) : "your earliest time"}`;
      case "prefEndsTooLate":
        return `${plural ? "end" : "ends"} after ${preferences.latestEnd != null ? timeLabel(preferences.latestEnd.minutes) : "your latest time"}`;
      case "prefDayOff":
        return `${plural ? "meet" : "meets"} on a day you want off`;
      case "prefFormat":
        return `${plural ? `aren${APOSTROPHE}t ` : `isn${APOSTROPHE}t `}${formatTitle(preferences.format).toLowerCase()}`;
      case "prefSeats":
        return plural ? "have no open seats" : "has no open seats";
      case "prefCampus":
        return plural ? "are on another campus" : "is on another campus";
      case "prefWorkload":
        return plural ? "run longer in a day than your limit" : "runs longer in a day than your limit";
    }
  };

  const only = ordered[0]!;
  if (ordered.length === 1 && only[1] === total) {
    if (total === 1) return `Its only section ${phrase(only[0], false)}.`;
    return `All ${total} sections ${phrase(only[0], true)}.`;
  }
  const parts = ordered.map(([reason, count]) => `${count} ${phrase(reason, count !== 1)}`);
  return `Of ${total} sections: ${parts.join(", ")}.`;
}

/**
 * Short sentences for an empty generation. The overlap case reads
 * "CS 3000 and CS 3500 always overlap".
 */
export function explainEmpty(result: ScheduleGenerationResult, termName = "this term"): string[] {
  const lines = ScheduleNoResultsText.reasons(result.diagnostics, termName).map((reason) =>
    reason.detail ? `${reason.title}. ${reason.detail}` : reason.title,
  );
  if (lines.length > 0) return lines;
  return [ScheduleNoResultsText.headline(result.diagnostics)];
}

/** One line for an empty generation, for a status message. */
export function explainGeneration(result: ScheduleGenerationResult, termName = "this term"): string {
  return explainEmpty(result, termName).join(" ");
}

function reasonOrder(reason: ScheduleFilterReason): number {
  const order: ScheduleFilterReason[] = [
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
  return order.indexOf(reason);
}
