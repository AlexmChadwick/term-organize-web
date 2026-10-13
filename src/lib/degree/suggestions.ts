/**
 * Guesses at which course a retired course became, and the questions that confirm them.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/Models/EquivalenceSuggestions.swift, Logic/Course/EquivalencePrompt.swift,
 * and the pure parts of Logic/DegreePlan/DegreePlanEquivalences.swift.
 */

import { equivalencesFromDeclarations, type CourseEquivalences } from "@/lib/equivalences";
import type { CourseKey, Requisite } from "@/lib/models";
import {
  compareCourseKeys,
  isReqAnd,
  isReqCourse,
  isReqOr,
  keyId,
  referencedCourses,
  reqKey,
  requisiteSatisfied,
  sameKey,
  simplifyRequisite,
} from "@/lib/models";
import type { CourseEquivalenceDeclaration, DegreePlan } from "@/lib/requirements";
import { minimumTitleSimilarity, parseTitle, titleSimilarity } from "@/lib/degree/title-matcher";

export interface EquivalenceSuggestion {
  course: CourseKey;
  candidate: CourseKey;
  together: number;
  total: number;
  similarTitle?: string | null;
  titleScore?: number | null;
}

export function suggestionId(suggestion: Pick<EquivalenceSuggestion, "course" | "candidate">): string {
  return `${keyId(suggestion.course)}|${keyId(suggestion.candidate)}`;
}

export function suggestionConfidence(suggestion: EquivalenceSuggestion): number {
  return suggestion.total > 0 ? suggestion.together / suggestion.total : 0;
}

export function suggestionEvidence(suggestion: EquivalenceSuggestion): string {
  let listing: string | null = null;
  if (suggestion.together > 0) {
    listing = suggestion.total === 1
      ? `Listed together in the prerequisites of the 1 course that names ${keyId(suggestion.course)}`
      : `Listed together in ${suggestion.together} of the ${suggestion.total} prerequisites that name ${keyId(suggestion.course)}`;
  }
  if (listing && suggestion.similarTitle) return `${listing} \u00b7 similar title`;
  if (listing) return listing;
  if (suggestion.similarTitle) return `Similar title: ${suggestion.similarTitle}`;
  return "";
}

export function suggestionIsListedTogether(suggestion: EquivalenceSuggestion): boolean {
  return suggestion.together > 0;
}

export interface PrerequisiteListing {
  course: CourseKey;
  requisite: Requisite;
}

function visitListed(
  node: Requisite,
  retired: CourseKey,
  course: CourseKey,
  listed: Map<string, { key: CourseKey; courses: Set<string> }>,
  mentions: { value: boolean },
): void {
  if (isReqCourse(node)) {
    if (sameKey(reqKey(node), retired)) mentions.value = true;
    return;
  }
  if (isReqAnd(node)) {
    for (const item of node.and) visitListed(item, retired, course, listed, mentions);
    return;
  }
  if (isReqOr(node)) {
    const alternatives = node.or.filter(isReqCourse).map(reqKey);
    if (alternatives.some((key) => sameKey(key, retired))) {
      for (const other of alternatives) {
        if (sameKey(other, retired)) continue;
        const id = keyId(other);
        const bucket = listed.get(id) ?? { key: other, courses: new Set<string>() };
        bucket.courses.add(keyId(course));
        listed.set(id, bucket);
      }
    }
    for (const item of node.or) visitListed(item, retired, course, listed, mentions);
  }
}

function listedTogether(
  retired: CourseKey,
  prerequisites: readonly PrerequisiteListing[],
  isCurrent: (key: CourseKey) => boolean,
  known: CourseEquivalences,
  minimumTogether: number,
  minimumShare: number,
): { suggestions: EquivalenceSuggestion[]; dependents: number } {
  const dependents = new Set<string>();
  const listed = new Map<string, { key: CourseKey; courses: Set<string> }>();
  for (const entry of prerequisites) {
    if (sameKey(entry.course, retired)) continue;
    const flat = simplifyRequisite(entry.requisite);
    if (!flat) continue;
    const mentions = { value: false };
    visitListed(flat, retired, entry.course, listed, mentions);
    if (mentions.value) dependents.add(keyId(entry.course));
  }
  const total = dependents.size;
  if (total === 0) return { suggestions: [], dependents: 0 };
  const found: EquivalenceSuggestion[] = [];
  for (const bucket of listed.values()) {
    if (!isCurrent(bucket.key) || known.areEquivalent(retired, bucket.key)) continue;
    if (bucket.courses.size < minimumTogether) continue;
    if (bucket.courses.size / total < minimumShare) continue;
    found.push({ course: retired, candidate: bucket.key, together: bucket.courses.size, total });
  }
  return { suggestions: found, dependents: total };
}

function similarTitles(
  retired: CourseKey,
  candidates: readonly CourseKey[],
  known: CourseEquivalences,
  title: (key: CourseKey) => string | null | undefined,
  minimum: number,
): Map<string, { key: CourseKey; title: string; score: number }> {
  const found = new Map<string, { key: CourseKey; title: string; score: number }>();
  if (candidates.length === 0) return found;
  const retiredText = title(retired);
  if (!retiredText) return found;
  const retiredTitle = parseTitle(retiredText);
  if (!retiredTitle.isDistinctive) return found;
  for (const candidate of candidates) {
    const id = keyId(candidate);
    if (sameKey(candidate, retired) || found.has(id) || known.areEquivalent(retired, candidate)) continue;
    const text = title(candidate)?.trim();
    if (!text) continue;
    const score = titleSimilarity(retiredTitle, parseTitle(text), minimum);
    if (score == null) continue;
    found.set(id, { key: candidate, title: text, score });
  }
  return found;
}

/**
 * Courses a retired course may count as, most likely first. Prerequisite evidence ranks
 * above titles, and a title suggestion keeps a place when the list would otherwise be full.
 */
export function equivalenceSuggestions(options: {
  retired: CourseKey;
  prerequisites: readonly PrerequisiteListing[];
  isCurrent: (key: CourseKey) => boolean;
  known?: CourseEquivalences;
  minimumTogether?: number;
  minimumShare?: number;
  limit?: number;
  title?: (key: CourseKey) => string | null | undefined;
  titleCandidates?: readonly CourseKey[];
  minimumTitleSimilarity?: number;
}): EquivalenceSuggestion[] {
  const limit = options.limit ?? 3;
  if (limit <= 0) return [];
  const known = options.known ?? emptyEquivalences();
  const { suggestions: listed, dependents } = listedTogether(
    options.retired,
    options.prerequisites,
    options.isCurrent,
    known,
    options.minimumTogether ?? 2,
    options.minimumShare ?? 0.5,
  );
  const similar = similarTitles(
    options.retired,
    options.titleCandidates ?? [],
    known,
    options.title ?? (() => null),
    options.minimumTitleSimilarity ?? minimumTitleSimilarity,
  );
  const byPrerequisites = listed.map((suggestion) => {
    const match = similar.get(keyId(suggestion.candidate));
    if (!match) return suggestion;
    return { ...suggestion, similarTitle: match.title, titleScore: match.score };
  });
  byPrerequisites.sort((a, b) => {
    if (a.together !== b.together) return b.together - a.together;
    return compareCourseKeys(a.candidate, b.candidate);
  });
  const listedKeys = new Set(listed.map((suggestion) => keyId(suggestion.candidate)));
  const byTitle: EquivalenceSuggestion[] = [];
  for (const match of similar.values()) {
    if (listedKeys.has(keyId(match.key))) continue;
    byTitle.push({
      course: options.retired,
      candidate: match.key,
      together: 0,
      total: dependents,
      similarTitle: match.title,
      titleScore: match.score,
    });
  }
  byTitle.sort((a, b) => {
    const score = (b.titleScore ?? 0) - (a.titleScore ?? 0);
    if (score !== 0) return score;
    return compareCourseKeys(a.candidate, b.candidate);
  });
  const free = Math.max(0, limit - byPrerequisites.length);
  const reserved = limit >= 2 && byPrerequisites.length > 0 ? 1 : 0;
  const titleSlots = Math.min(byTitle.length, Math.max(free, reserved));
  return [...byPrerequisites.slice(0, limit - titleSlots), ...byTitle.slice(0, titleSlots)];
}

function emptyEquivalences(): CourseEquivalences {
  return equivalencesFromDeclarations([]);
}

/** The same pair either way: `CS 2100|CS 2510`. */
export function unorderedPairId(a: CourseKey, b: CourseKey): string {
  return compareCourseKeys(a, b) < 0 ? `${keyId(a)}|${keyId(b)}` : `${keyId(b)}|${keyId(a)}`;
}

export const DISMISSED_EQUIVALENCE_KEY = "degreePlan.dismissedEquivalenceSuggestions";
export const DISMISSED_EQUIVALENCE_LIMIT = 200;

export function decodeDismissed(raw: string): Set<string> {
  return new Set(raw.split("\n").filter((line) => line.length > 0));
}

export function isDismissedPair(a: CourseKey, b: CourseKey, raw: string): boolean {
  const id = unorderedPairId(a, b);
  return raw.split("\n").some((line) => line === id);
}

export function addingDismissal(id: string, raw: string, limit = DISMISSED_EQUIVALENCE_LIMIT): string {
  const ids = raw.split("\n").filter((line) => line.length > 0 && line !== id);
  ids.push(id);
  return ids.slice(-limit).join("\n");
}

export function dismissPair(a: CourseKey, b: CourseKey, raw: string): string {
  return addingDismissal(unorderedPairId(a, b), raw);
}

export interface EquivalencePrompt {
  taken: CourseKey;
  required: CourseKey;
  evidence: string;
  together: number;
}

export function equivalencePromptId(prompt: Pick<EquivalencePrompt, "taken" | "required">): string {
  return `${keyId(prompt.taken)}|${keyId(prompt.required)}`;
}

export interface CompletedCourseSet {
  taken: CourseKey[];
  covered: Set<string>;
  meets(requisite: Requisite): boolean;
}

export function completedCourseSet(taken: readonly CourseKey[], equivalences: CourseEquivalences): CompletedCourseSet {
  const ids = new Set(taken.map(keyId));
  const covered = equivalences.expanding(ids);
  return {
    taken: [...taken],
    covered,
    meets(requisite) {
      return requisiteSatisfied(requisite, covered, true);
    },
  };
}

/**
 * Questions a requirement calls for, likeliest first. A question is asked only when the
 * requirement is still unmet, names the candidate, and does not already name the course taken.
 */
export function chooseEquivalencePrompts(options: {
  requisite: Requisite;
  completed: CompletedCourseSet;
  dismissed?: ReadonlySet<string>;
  suggestions: (taken: CourseKey) => readonly EquivalenceSuggestion[];
  limit?: number;
}): EquivalencePrompt[] {
  const limit = options.limit ?? 2;
  const tree = simplifyRequisite(options.requisite);
  if (!tree || options.completed.meets(tree)) return [];
  const named = new Set(referencedCourses(tree).map(keyId));
  const unmet = new Set<string>();
  for (const id of named) if (!options.completed.covered.has(id)) unmet.add(id);
  if (unmet.size === 0) return [];
  const dismissed = options.dismissed ?? new Set<string>();
  const best = new Map<string, EquivalenceSuggestion>();
  const taken = [...options.completed.taken].sort(compareCourseKeys);
  for (const course of taken) {
    if (named.has(keyId(course))) continue;
    for (const suggestion of options.suggestions(course)) {
      if (!unmet.has(keyId(suggestion.candidate))) continue;
      if (dismissed.has(unorderedPairId(course, suggestion.candidate))) continue;
      const current = best.get(keyId(suggestion.candidate));
      if (current && current.together >= suggestion.together) continue;
      best.set(keyId(suggestion.candidate), suggestion);
    }
  }
  return [...best.values()]
    .sort((a, b) => {
      if (a.together !== b.together) return b.together - a.together;
      return compareCourseKeys(a.candidate, b.candidate);
    })
    .slice(0, limit)
    .map((suggestion) => ({
      taken: suggestion.course,
      required: suggestion.candidate,
      evidence: suggestionEvidence(suggestion),
      together: suggestion.together,
    }));
}

function unbroken(key: CourseKey): string {
  return `${key.subject}\u00A0${key.number}`;
}

export interface DegreeEquivalencePrompt {
  course: CourseKey;
  countsAs: CourseKey;
  evidence: string;
  id: string;
  question: string;
}

export function degreeEquivalencePrompt(course: CourseKey, countsAs: CourseKey, evidence: string): DegreeEquivalencePrompt {
  return {
    course,
    countsAs,
    evidence,
    id: unorderedPairId(course, countsAs),
    question: `Does ${unbroken(course)} count as ${unbroken(countsAs)}?`,
  };
}

export interface DegreeEquivalencePrompts {
  forPlanCourses: DegreeEquivalencePrompt[];
  forListed(key: CourseKey): DegreeEquivalencePrompt | null;
  forPlanCourse(key: CourseKey): DegreeEquivalencePrompt | null;
}

/**
 * Suggestions for retired courses of the plan and for courses a requirement lists.
 * `suggestions` is the catalog lookup; courses that aren't eligible should return none.
 */
export function buildDegreeEquivalencePrompts(options: {
  planKeys: readonly CourseKey[];
  listed: readonly CourseKey[];
  eligible: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
  suggestions: (course: CourseKey) => readonly EquivalenceSuggestion[];
}): DegreeEquivalencePrompts {
  const forPlanCourses: DegreeEquivalencePrompt[] = [];
  const byListed = new Map<string, DegreeEquivalencePrompt>();
  const inPlan = new Set(options.planKeys.map(keyId));
  const open = (course: CourseKey): EquivalenceSuggestion[] => {
    if (!options.eligible.has(keyId(course))) return [];
    return options.suggestions(course).filter((suggestion) => !options.dismissed.has(unorderedPairId(course, suggestion.candidate)));
  };
  for (const key of options.planKeys) {
    const found = open(key);
    const best = found[0];
    if (best) forPlanCourses.push(degreeEquivalencePrompt(key, best.candidate, suggestionEvidence(best)));
    for (const suggestion of found) {
      const id = keyId(suggestion.candidate);
      if (byListed.has(id)) continue;
      byListed.set(id, degreeEquivalencePrompt(key, suggestion.candidate, suggestionEvidence(suggestion)));
    }
  }
  for (const key of options.listed) {
    if (inPlan.has(keyId(key)) || byListed.has(keyId(key))) continue;
    const found = open(key);
    const best = found.find((suggestion) => inPlan.has(keyId(suggestion.candidate))) ?? found[0];
    if (!best) continue;
    byListed.set(keyId(key), degreeEquivalencePrompt(best.candidate, key, suggestionEvidence(best)));
  }
  return {
    forPlanCourses,
    forListed(key) {
      return byListed.get(keyId(key)) ?? null;
    },
    forPlanCourse(key) {
      return forPlanCourses.find((prompt) => sameKey(prompt.course, key)) ?? null;
    },
  };
}

export function uniquePlanKeys(keys: readonly (CourseKey | null | undefined)[]): CourseKey[] {
  const seen = new Set<string>();
  const result: CourseKey[] = [];
  for (const key of keys) {
    if (!key || seen.has(keyId(key))) continue;
    seen.add(keyId(key));
    result.push(key);
  }
  return result;
}

export function planCompletedKeys(plan: DegreePlan): CourseKey[] {
  return uniquePlanKeys(plan.completed.map((course) => course.key));
}

export function planPlannedKeys(plan: DegreePlan): CourseKey[] {
  return uniquePlanKeys(plan.terms.flatMap((term) => term.courses.map((course) => course.key)));
}

export function planCourseKeys(plan: DegreePlan): CourseKey[] {
  return uniquePlanKeys([...planCompletedKeys(plan), ...planPlannedKeys(plan)]);
}

export function degreeEquivalenceNote(plan: DegreePlan, key: CourseKey | null | undefined): string | null {
  if (!key) return null;
  const targets = plan.courseEquivalences.filter((item) => sameKey(item.course, key)).map((item) => keyId(item.countsAs));
  return targets.length === 0 ? null : `Counts as ${targets.join(", ")}`;
}

export function declareEquivalence(plan: DegreePlan, course: CourseKey, countsAs: CourseKey, note = ""): boolean {
  if (sameKey(course, countsAs)) return false;
  if (equivalencesFromDeclarations(plan.courseEquivalences).areEquivalent(course, countsAs)) return false;
  const declaration: CourseEquivalenceDeclaration = {
    id: crypto.randomUUID(),
    course,
    countsAs,
    note,
  };
  plan.courseEquivalences.push(declaration);
  return true;
}

export function removeEquivalence(plan: DegreePlan, id: string): void {
  plan.courseEquivalences = plan.courseEquivalences.filter((item) => item.id !== id);
}
