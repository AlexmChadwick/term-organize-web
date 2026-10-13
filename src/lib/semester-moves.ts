/**
 * Semester-move suggestions for a degree plan, using offering history.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Port of Logic/Schedule/ScheduleReorderSuggestions.swift. The first request asks when the
 * blocking courses are taught. Later semesters are looked up only when a simple move is not enough.
 */

import {
  OfferingHistory,
  applyReorderSuggestion,
  reorderSuggestions,
  type PrerequisiteLookup,
  type ReorderSuggestion,
} from "@/lib/degree/reordering";
import type { CourseKey } from "@/lib/models";
import { keyId } from "@/lib/models";
import { sortPlanTerms, type DegreePlan, type DegreePlanTerm } from "@/lib/requirements";

export interface MoveOption {
  id: string;
  title: string;
  reasons: string[];
  addsSemester: boolean;
  movedAway: CourseKey[];
  movedIn: CourseKey[];
  suggestion: ReorderSuggestion;
  appliedText: string;
  scheduleEffect: string;
}

const historyCache = new Map<string, { at: number; history: OfferingHistory }>();

export async function fetchOfferingHistory(keys: readonly CourseKey[]): Promise<OfferingHistory> {
  const ids = [...new Set(keys.map((key) => keyId(key)))].sort();
  if (!ids.length) return OfferingHistory.empty();
  const cacheKey = ids.join("|");
  const hit = historyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.history;
  try {
    const res = await fetch("/api/banner/offerings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ids }),
    });
    if (!res.ok) return OfferingHistory.empty();
    const history = OfferingHistory.fromJSON(await res.json());
    historyCache.set(cacheKey, { at: Date.now(), history });
    return history;
  } catch {
    return OfferingHistory.empty();
  }
}

function listKeys(keys: readonly CourseKey[]): string {
  const names = keys.map((key) => keyId(key));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function optionFrom(suggestion: ReorderSuggestion, originID: string): MoveOption {
  const movedAway = suggestion.moves.filter((move) => move.from === originID).map((move) => move.course);
  const movedIn = suggestion.moves.filter((move) => move.to === originID).map((move) => move.course);
  const parts: string[] = [];
  if (movedAway.length) parts.push(`${listKeys(movedAway)} ${movedAway.length === 1 ? "comes" : "come"} out of this schedule.`);
  if (movedIn.length) {
    parts.push(`${listKeys(movedIn)} will be added to it if ${movedIn.length === 1 ? "it’s" : "they’re"} offered this term.`);
  }
  return {
    id: suggestion.id,
    title: suggestion.title,
    reasons: suggestion.reasons,
    addsSemester: suggestion.addsSemester != null,
    movedAway,
    movedIn,
    suggestion,
    appliedText: suggestion.title.startsWith("Move ") ? `Moved ${suggestion.title.slice("Move ".length)}` : "Updated your degree plan",
    scheduleEffect: parts.join(" "),
  };
}

export async function loadSemesterMoves(options: {
  plan: DegreePlan;
  termID: string;
  blocking: readonly CourseKey[];
  prerequisites: PrerequisiteLookup;
}): Promise<{ options: MoveOption[]; historyKnown: boolean }> {
  const plan = structuredClone(options.plan);
  sortPlanTerms(plan);
  const originIndex = plan.terms.findIndex((term) => term.id === options.termID);
  const origin = plan.terms[originIndex];
  if (!origin) return { options: [], historyKnown: true };
  const inSemester = new Set(origin.courses.flatMap((course) => (course.key ? [keyId(course.key)] : [])));
  const candidates = options.blocking.filter((key) => inSemester.has(keyId(key)));
  if (!candidates.length) return { options: [], historyKnown: true };

  let history = await fetchOfferingHistory(candidates);
  const later = plan.terms.slice(originIndex + 1).flatMap((term) => term.courses.flatMap((course) => (course.key ? [course.key] : [])));
  const ask = (known: OfferingHistory) =>
    reorderSuggestions({
      plan: options.plan,
      termID: options.termID,
      blocking: candidates,
      history: known,
      prerequisites: options.prerequisites,
    });
  let found = ask(history);
  if (found.some((suggestion) => suggestion.moves.length === 1)) found = found.filter((suggestion) => suggestion.moves.length === 1);
  else if (later.length) {
    history = history.merging(await fetchOfferingHistory(later));
    found = ask(history);
  }
  return { options: found.map((suggestion) => optionFrom(suggestion, origin.id)), historyKnown: history.checkedTerms.length > 0 };
}

export function applyMoveToPlan(suggestion: ReorderSuggestion, plan: DegreePlan): DegreePlan {
  const next = structuredClone(plan);
  applyReorderSuggestion(suggestion, next);
  return next;
}

export type { DegreePlanTerm };
