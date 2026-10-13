/**
 * Substitutions, petitions, requirement listing, and renumbering.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of DegreeSubstitutionSupport.swift, DegreePetitionQuestions.swift,
 * DegreeRequirementsListing.swift, the wording in DegreeRequirementsSupport.swift,
 * DegreeRenumbering.swift, DegreeNoteViews.swift (the note list), and the pure
 * row decisions in DegreeRequirementsAnnotation.swift and DegreeRequirementsCatalogSection.swift.
 * Schedule windows and course-info stores are not included: pass their answers in.
 */

import type { CourseKey } from "@/lib/models";
import { compareCourseKeys, creditNumber, keyId, sameKey, termCalendarYear, termSeason, termShortName } from "@/lib/models";
import type {
  CourseNumberLimit,
  CourseOption,
  CourseRange,
  DegreePlan,
  DegreePlanCourse,
  DegreePlanTerm,
  PlanSeason,
  ProgramRequirements,
  RequirementReplacement,
  RequirementRule,
  RequirementSection,
  RequirementSubstitution,
  SubstitutionChange,
} from "@/lib/requirements";
import {
  PLAN_SEASON_EXPORT,
  PLAN_SEASON_SHORT,
  catalogYearLabel,
  concentrationName,
  optionCourses,
  optionLabel,
  programParts,
  rangeContains,
  replacementSummary,
  ruleDisplayLabel,
  ruleTitle,
  sortedKeys,
  type CatalogYear,
} from "@/lib/requirements";
import { equivalencesFromDeclarations } from "@/lib/equivalences";
import type { CourseEquivalences } from "@/lib/equivalences";
import { nextSemesters } from "@/lib/degree-logic";
import {
  applyCourseNumberLimit,
  countedChecks,
  countsAsLabel,
  degreeCategories,
  degreeCountingName,
  degreeIsGeneralElectives,
  degreeNamesCourses,
  degreeRule,
  degreeShortName,
  rangeMinimumsText,
  rangeSubjectsText,
  resultFor,
  ruleCounting,
  ruleResults,
  runDegreeAudit,
  statusIsSatisfied,
  statusRank,
  courseUseFor,
  type AuditStatus,
  type CourseUse,
  type DegreeAudit,
  type NoteCheck,
  type RuleResult,
} from "@/lib/degree/audit";
import { declareEquivalence, removeEquivalence, unorderedPairId, type DegreeEquivalencePrompts } from "@/lib/degree/suggestions";

const DOT = " \u00b7 ";

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function nonBlank(text: string | null | undefined): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function planTermName(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`;
}

export function planTermShortName(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_SHORT[term.season]} ${term.year}`;
}

export function lowercasingFirst(text: string): string {
  const first = text[0];
  if (!first) return text;
  const upper = (ch: string) => ch.toLocaleUpperCase("en-US") === ch && ch.toLocaleLowerCase("en-US") !== ch;
  if (!upper(first)) return text;
  const second = text[1];
  if (second && upper(second)) return text;
  return first.toLocaleLowerCase("en-US") + text.slice(1);
}

/** `Oct 3, 2026`. */
export function abbreviatedDate(epochMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(epochMs));
}

export function degreeStatusLabel(status: AuditStatus): string {
  switch (status) {
    case "complete":
      return "complete";
    case "planned":
      return "planned";
    case "partial":
      return "partly done";
    case "missing":
      return "not in your plan";
    case "waived":
      return "waived";
  }
}

// MARK: - Filter

export type DegreeRequirementsFilter = "all" | "remaining" | "done";

export function filterTitle(filter: DegreeRequirementsFilter): string {
  if (filter === "remaining") return "Remaining";
  if (filter === "done") return "Done";
  return "All";
}

/** Remaining: missing, partial, or planned. Done: complete or waived. */
export function filterIncludesStatus(filter: DegreeRequirementsFilter, status: AuditStatus): boolean {
  if (filter === "all") return true;
  if (filter === "remaining") return statusRank(status) <= statusRank("planned");
  return statusRank(status) >= statusRank("complete");
}

/** A check that does not count yet shows in All only. */
export function filterIncludesCheck(filter: DegreeRequirementsFilter, check: NoteCheck): boolean {
  return check.counts ? filterIncludesStatus(filter, check.status) : filter === "all";
}

// MARK: - Substitution form

export type SubstitutionKind = "countCourse" | "replace" | "waive";

export function substitutionKind(change: SubstitutionChange): SubstitutionKind {
  return change.type;
}

export interface DegreeSubstitutionRequest {
  planID: string;
  ruleID: string;
  ruleTitle: string;
  existing: RequirementSubstitution | null;
  kind: SubstitutionKind;
  course: CourseKey | null;
  id: string;
}

export function substitutionRequest(input: {
  planID: string;
  ruleID: string;
  ruleTitle: string;
  existing?: RequirementSubstitution | null;
  kind?: SubstitutionKind | null;
  course?: CourseKey | null;
}): DegreeSubstitutionRequest {
  const existing = input.existing ?? null;
  const course = input.course ?? null;
  const kind = input.kind ?? (existing ? substitutionKind(existing.change) : "countCourse");
  const id = existing ? `edit-${existing.id}` : `new-${input.ruleID}-${kind}${course ? `-${keyId(course)}` : ""}`;
  return { planID: input.planID, ruleID: input.ruleID, ruleTitle: input.ruleTitle, existing, kind, course, id };
}

/** Courses or semester hours a petition starts with. Four credits a course when the rule doesn't say. */
export function initialSubstitutionAmount(rule: RequirementRule | null | undefined): { count: number; hours: number; inHours: boolean } {
  if (!rule) return { count: 1, hours: 4, inHours: false };
  const kind = rule.kind;
  if (kind.type === "choose") {
    if (kind.count != null) return { count: Math.max(1, kind.count), hours: kind.hours ?? kind.count * 4, inHours: false };
    if (kind.hours != null) return { count: Math.max(1, Math.trunc(kind.hours / 4)), hours: kind.hours, inHours: true };
  } else if (kind.type === "required") {
    const courses = Math.max(1, kind.option.alternatives[0]?.length ?? 1);
    return { count: courses, hours: rule.hours ?? courses * 4, inHours: false };
  } else {
    return { count: Math.max(1, Math.trunc(kind.hours / 4)), hours: kind.hours, inHours: true };
  }
  return { count: 1, hours: 4, inHours: false };
}

export function canSaveSubstitution(options: {
  kind: SubstitutionKind;
  course?: CourseKey | null;
  likeRuleID?: string | null;
  specificCourses: readonly CourseKey[];
  needsCourseNumbers?: boolean;
  courseNumbers?: CourseNumberLimit | null;
}): boolean {
  if (options.kind === "countCourse") return options.course != null;
  if (options.kind === "waive") return true;
  const needs = options.needsCourseNumbers ?? false;
  const hasSource = options.likeRuleID != null || options.specificCourses.length > 0;
  return hasSource && (!needs || options.likeRuleID == null || options.courseNumbers != null);
}

export function likeRanges(replacement: RequirementReplacement, requirements: ProgramRequirements): CourseRange[] {
  const like = degreeRule(requirements, replacement.likeRuleID, replacement.likeRuleTitle);
  if (!like || like.kind.type !== "choose") return [];
  return like.kind.ranges;
}

export function asksForCourseNumbers(replacement: RequirementReplacement, requirements: ProgramRequirements): boolean {
  return likeRanges(replacement, requirements).some((range) => range.lowest > 0);
}

export function needsCourseNumbers(likeRuleID: string | null | undefined, requirements: ProgramRequirements | null | undefined): boolean {
  if (!likeRuleID || !requirements) return false;
  return asksForCourseNumbers({ courses: [], likeRuleID }, requirements);
}

/** `Khoury Elective Courses`, or `General electives (any course)`. */
export function substitutionSourceName(rule: RequirementRule, requirements: ProgramRequirements | null): string {
  if (degreeIsGeneralElectives(rule)) return "General electives (any course)";
  return (requirements && degreeShortName(requirements, rule.id)) || ruleDisplayLabel(rule);
}

export function substitutionChange(options: {
  kind: SubstitutionKind;
  course?: CourseKey | null;
  amountInHours: boolean;
  count: number;
  hours: number;
  likeRuleID?: string | null;
  specificCourses: readonly CourseKey[];
  courseNumbers?: CourseNumberLimit | null;
  requirements: ProgramRequirements | null;
  ruleTitle: string;
}): SubstitutionChange | null {
  if (options.kind === "countCourse") {
    if (!options.course) return null;
    return { type: "countCourse", course: options.course };
  }
  if (options.kind === "waive") return { type: "waive" };
  const likeRuleID = options.likeRuleID ?? null;
  let likeRuleTitle: string | null = null;
  if (likeRuleID) {
    const rule = options.requirements ? degreeRule(options.requirements, likeRuleID, null) : null;
    likeRuleTitle = rule ? substitutionSourceName(rule, options.requirements) : options.ruleTitle;
  }
  const needs = needsCourseNumbers(likeRuleID, options.requirements);
  const replacement: RequirementReplacement = {
    count: options.amountInHours ? null : options.count,
    hours: options.amountInHours ? options.hours : null,
    likeRuleID,
    likeRuleTitle,
    courses: sortedKeys([...options.specificCourses]),
    courseNumbers: needs ? (options.courseNumbers ?? null) : null,
  };
  return { type: "replace", replacement };
}

export function substitutionToStore(
  request: DegreeSubstitutionRequest,
  change: SubstitutionChange,
  note: string,
  approvedOn?: number | null,
): RequirementSubstitution {
  const base: RequirementSubstitution = request.existing ?? {
    id: crypto.randomUUID(),
    ruleID: request.ruleID,
    ruleTitle: request.ruleTitle,
    change,
    note: "",
    createdAt: Date.now(),
  };
  return {
    ...base,
    ruleID: request.ruleID,
    change,
    note: note.trim(),
    approvedOn: approvedOn ?? null,
  };
}

export function storeSubstitution(plan: DegreePlan, substitution: RequirementSubstitution): void {
  const index = plan.substitutions.findIndex((item) => item.id === substitution.id);
  if (index >= 0) plan.substitutions[index] = substitution;
  else plan.substitutions.push(substitution);
}

export function choiceIsFree(countingRuleID: string | null | undefined, ruleID: string, requirements: ProgramRequirements | null): boolean {
  if (countingRuleID == null) return true;
  if (countingRuleID === ruleID) return true;
  const rule = requirements ? degreeRule(requirements, countingRuleID, null) : null;
  return rule != null && degreeIsGeneralElectives(rule);
}

export interface DegreePlanCourseChoice {
  key: CourseKey;
  title: string;
  credits: number;
  semester: string | null;
  semesterShortName: string | null;
  id: string;
  isCompleted: boolean;
  whenLine: string;
}

export function degreeCourseChoices(plan: DegreePlan): DegreePlanCourseChoice[] {
  const seen = new Set<string>();
  const choices: DegreePlanCourseChoice[] = [];
  const push = (course: DegreePlanCourse, semester: string | null, shortName: string | null) => {
    if (!course.key || seen.has(keyId(course.key))) return;
    seen.add(keyId(course.key));
    choices.push({
      key: course.key,
      title: course.title,
      credits: course.credits,
      semester,
      semesterShortName: shortName,
      id: keyId(course.key),
      isCompleted: semester == null,
      whenLine: shortName ?? "Completed",
    });
  };
  for (const course of plan.completed) push(course, null, null);
  for (const term of plan.terms) {
    for (const course of term.courses) push(course, planTermName(term), planTermShortName(term));
  }
  return choices;
}

export function semesterShortNames(plan: DegreePlan): Record<string, string> {
  const names: Record<string, string> = {};
  for (const term of plan.terms) {
    const name = planTermName(term);
    if (names[name] == null) names[name] = planTermShortName(term);
  }
  return names;
}

export function choiceCaption(
  choice: DegreePlanCourseChoice,
  countingRuleID: string | null | undefined,
  ruleID: string,
  requirements: ProgramRequirements | null,
): string | null {
  if (countingRuleID == null) return null;
  if (countingRuleID === ruleID) return "Counts toward this requirement";
  const rule = requirements ? degreeRule(requirements, countingRuleID, null) : null;
  if (rule && degreeIsGeneralElectives(rule)) return "Now a general elective";
  const name = requirements ? degreeCountingName(requirements, countingRuleID, choice.key) : null;
  return `Counts toward ${name ?? "another requirement"}`;
}

export function matchingCourseChoices(choices: readonly DegreePlanCourseChoice[], query: string): DegreePlanCourseChoice[] {
  const trimmed = query.trim();
  if (!trimmed) return [...choices];
  const lower = trimmed.toLocaleLowerCase("en-US");
  const compact = lower.replace(/ /g, "");
  return choices.filter((choice) => {
    const code = keyId(choice.key).toLocaleLowerCase("en-US");
    const tight = `${choice.key.subject}${choice.key.number}`.toLocaleLowerCase("en-US");
    return code.includes(lower) || tight.includes(compact) || choice.title.toLocaleLowerCase("en-US").includes(lower);
  });
}

// MARK: - Renumbering

export interface RenumberingEquivalence {
  course: CourseKey;
  countsAs: CourseKey;
  note: string;
}

/** A "count a course" substitution for a requirement that names exactly one other course. */
export function renumberingFor(substitution: RequirementSubstitution, requirements: ProgramRequirements | null): RenumberingEquivalence | null {
  if (substitution.change.type !== "countCourse" || !requirements) return null;
  const course = substitution.change.course;
  const rule = degreeRule(requirements, substitution.ruleID, substitution.ruleTitle);
  if (!rule || rule.kind.type !== "required" || rule.kind.option.alternatives.length !== 1) return null;
  const named = rule.kind.option.alternatives[0];
  if (!named || named.length !== 1 || sameKey(named[0]!, course)) return null;
  return { course, countsAs: named[0]!, note: "Renumbered" };
}

export function convertToEquivalence(plan: DegreePlan, substitution: RequirementSubstitution, requirements: ProgramRequirements | null): void {
  const equivalence = renumberingFor(substitution, requirements);
  if (!equivalence) return;
  plan.substitutions = plan.substitutions.filter((item) => item.id !== substitution.id);
  declareEquivalence(plan, equivalence.course, equivalence.countsAs, equivalence.note);
}

export interface LikelyRenumbering {
  substitution: RequirementSubstitution;
  course: CourseKey;
  countsAs: CourseKey;
  id: string;
  question: string;
  explanation: string;
}

function likelyRenumbering(substitution: RequirementSubstitution, course: CourseKey, countsAs: CourseKey): LikelyRenumbering {
  return {
    substitution,
    course,
    countsAs,
    id: substitution.id,
    question: `Is ${keyId(course)} the new number of ${keyId(countsAs)}?`,
    explanation: `${keyId(countsAs)} isn\u2019t offered anymore. If ${keyId(course)} is the same course under a new number, it counts as ${keyId(countsAs)} everywhere, prerequisites included, like other renumbered courses.`,
  };
}

/** `isRetired` is null when Banner hasn't said. The substitute must not look retired. */
export function likelyRenumberings(
  plan: DegreePlan,
  requirements: ProgramRequirements | null,
  isRetired: (key: CourseKey) => boolean | null | undefined,
): LikelyRenumbering[] {
  const declared = equivalencesFromDeclarations(plan.courseEquivalences);
  const found: LikelyRenumbering[] = [];
  for (const substitution of plan.substitutions) {
    const equivalence = renumberingFor(substitution, requirements);
    if (!equivalence) continue;
    if (isRetired(equivalence.countsAs) !== true || isRetired(equivalence.course) === true) continue;
    if (declared.areEquivalent(equivalence.course, equivalence.countsAs)) continue;
    found.push(likelyRenumbering(substitution, equivalence.course, equivalence.countsAs));
  }
  return found;
}

export interface DegreeRenumbering {
  course: CourseKey;
  countsAs: CourseKey;
  substitution: RequirementSubstitution | null;
  substitutionIndex: number;
  equivalenceID: string | null;
  message: string;
  canUndo: boolean;
}

function renumberingRecord(
  course: CourseKey,
  countsAs: CourseKey,
  substitution: RequirementSubstitution | null,
  substitutionIndex: number,
  equivalenceID: string | null,
): DegreeRenumbering {
  return {
    course,
    countsAs,
    substitution,
    substitutionIndex,
    equivalenceID,
    message: `${keyId(course)} now counts as ${keyId(countsAs)}`,
    canUndo: substitution != null || equivalenceID != null,
  };
}

export function convertRenumbering(
  plan: DegreePlan,
  substitution: RequirementSubstitution,
  requirements: ProgramRequirements | null,
): DegreeRenumbering | null {
  const index = plan.substitutions.findIndex((item) => item.id === substitution.id);
  if (index < 0) return null;
  const stored = plan.substitutions[index]!;
  const equivalence = renumberingFor(stored, requirements);
  if (!equivalence) return null;
  const known = new Set(plan.courseEquivalences.map((item) => item.id));
  convertToEquivalence(plan, stored, requirements);
  const declared = plan.courseEquivalences.find((item) => !known.has(item.id));
  return renumberingRecord(equivalence.course, equivalence.countsAs, stored, index, declared?.id ?? null);
}

/** Declares a renumbering that was never saved as a substitution. Null when the courses are the same. */
export function declareRenumbering(plan: DegreePlan, course: CourseKey, countsAs: CourseKey): DegreeRenumbering | null {
  if (sameKey(course, countsAs)) return null;
  const added = declareEquivalence(plan, course, countsAs, "Renumbered");
  const id = added ? (plan.courseEquivalences[plan.courseEquivalences.length - 1]?.id ?? null) : null;
  return renumberingRecord(course, countsAs, null, 0, id);
}

export function undoRenumbering(plan: DegreePlan, change: DegreeRenumbering): void {
  if (change.equivalenceID) removeEquivalence(plan, change.equivalenceID);
  if (change.substitution && !plan.substitutions.some((item) => item.id === change.substitution!.id)) {
    const index = Math.min(Math.max(0, change.substitutionIndex), plan.substitutions.length);
    plan.substitutions.splice(index, 0, change.substitution);
  }
}

export function likelyRenumberingMap(
  plan: DegreePlan,
  requirements: ProgramRequirements | null,
  dismissed: ReadonlySet<string>,
  isRetired: (key: CourseKey) => boolean | null | undefined,
): Map<string, LikelyRenumbering> {
  const map = new Map<string, LikelyRenumbering>();
  for (const item of likelyRenumberings(plan, requirements, isRetired)) {
    if (dismissed.has(unorderedPairId(item.course, item.countsAs))) continue;
    if (!map.has(item.substitution.id)) map.set(item.substitution.id, item);
  }
  return map;
}

export function renumberableSubstitutionIDs(plan: DegreePlan, requirements: ProgramRequirements | null): Set<string> {
  const ids = new Set<string>();
  for (const substitution of plan.substitutions) {
    if (renumberingFor(substitution, requirements)) ids.add(substitution.id);
  }
  return ids;
}

export function coursesToLookUpForRenumbering(plan: DegreePlan, requirements: ProgramRequirements | null): CourseKey[] {
  const seen = new Set<string>();
  const keys: CourseKey[] = [];
  for (const substitution of plan.substitutions) {
    const equivalence = renumberingFor(substitution, requirements);
    if (!equivalence) continue;
    for (const key of [equivalence.countsAs, equivalence.course]) {
      if (seen.has(keyId(key))) continue;
      seen.add(keyId(key));
      keys.push(key);
    }
  }
  return keys;
}

// MARK: - Course-number answers

export type CourseNumberChoice = "sameAsRequirement" | "anyNumber" | "atLeast";

export function courseNumberChoiceOf(limit: CourseNumberLimit | null | undefined): CourseNumberChoice | null {
  if (!limit) return null;
  return limit.type;
}

export function isValidCourseNumberMinimum(minimum: number): boolean {
  return minimum >= 1 && minimum <= 9999;
}

export function courseNumberLimit(choice: CourseNumberChoice, minimum: number): CourseNumberLimit | null {
  if (choice === "sameAsRequirement") return { type: "sameAsRequirement" };
  if (choice === "anyNumber") return { type: "anyNumber" };
  return isValidCourseNumberMinimum(minimum) ? { type: "atLeast", minimum } : null;
}

export function suggestedCourseNumberMinimum(ranges: readonly CourseRange[], saved?: CourseNumberLimit | null): number {
  if (saved?.type === "atLeast") return saved.minimum;
  const positive = ranges.map((range) => range.lowest).filter((lowest) => lowest > 0);
  const lowest = positive.length > 0 ? Math.min(...positive) : 2000;
  return Math.max(1000, Math.trunc(lowest / 1000) * 1000);
}

export function courseNumberChoiceTitle(choice: CourseNumberChoice, likeTitle: string): string {
  if (choice === "sameAsRequirement") return `Same as ${likeTitle}`;
  if (choice === "anyNumber") return "Any course number";
  return "A different minimum";
}

export function courseNumberChoiceDetail(choice: CourseNumberChoice, ranges: readonly CourseRange[], minimum: number): string {
  if (choice === "sameAsRequirement") return ranges.map((range) => range.label).join(DOT);
  if (choice === "anyNumber") return `Any ${rangeSubjectsText(ranges)} course`;
  if (!isValidCourseNumberMinimum(minimum)) return "Enter a course number, like 2000";
  return ranges.map((range) => applyCourseNumberLimit(range, { type: "atLeast", minimum }).label).join(DOT);
}

export function setCourseNumbers(plan: DegreePlan, limit: CourseNumberLimit | null, substitutionID: string): void {
  const index = plan.substitutions.findIndex((item) => item.id === substitutionID);
  if (index < 0) return;
  const substitution = plan.substitutions[index]!;
  if (substitution.change.type !== "replace") return;
  plan.substitutions[index] = {
    ...substitution,
    change: { type: "replace", replacement: { ...substitution.change.replacement, courses: [...substitution.change.replacement.courses], courseNumbers: limit } },
  };
}

function clonePlan(plan: DegreePlan): DegreePlan {
  return {
    ...plan,
    completed: plan.completed.map((course) => ({ ...course })),
    terms: plan.terms.map((term) => ({ ...term, courses: term.courses.map((course) => ({ ...course })) })),
    substitutions: plan.substitutions.map((substitution) =>
      substitution.change.type === "replace"
        ? { ...substitution, change: { type: "replace", replacement: { ...substitution.change.replacement, courses: [...substitution.change.replacement.courses] } } }
        : { ...substitution, change: substitution.change.type === "countCourse" ? { type: "countCourse", course: substitution.change.course } : { type: "waive" } },
    ),
    courseEquivalences: plan.courseEquivalences.map((item) => ({ ...item })),
  };
}

export function isUnansweredPetition(substitution: RequirementSubstitution, requirements: ProgramRequirements): boolean {
  if (substitution.change.type !== "replace") return false;
  return substitution.change.replacement.courseNumbers == null && asksForCourseNumbers(substitution.change.replacement, requirements);
}

export interface DegreePetitionQuestion {
  substitution: RequirementSubstitution;
  ruleID: string;
  ruleTitle: string;
  likeTitle: string;
  ranges: CourseRange[];
  courses: CourseKey[];
  satisfied: number;
  satisfiedWithoutMinimum: number;
  total: number;
  id: string;
  question: string;
  matters: boolean;
  explanation: string;
}

function petitionExplanation(question: Omit<DegreePetitionQuestion, "explanation" | "question" | "matters" | "id"> & { matters: boolean }): string {
  const parts: string[] = [];
  const minimums = rangeMinimumsText(question.ranges);
  if (minimums) parts.push(`${question.likeTitle} start at ${minimums}.`);
  if (!question.matters) {
    parts.push("Your petition decides whether that minimum applies here.");
    return parts.join(" ");
  }
  const gained = question.satisfiedWithoutMinimum - question.satisfied;
  const effect = question.satisfiedWithoutMinimum >= question.total ? "every requirement is met" : `${gained} more ${gained === 1 ? "requirement is" : "requirements are"} met`;
  if (question.courses.length === 0) parts.push(`With any number, ${effect}.`);
  else {
    const courseList = joinAnd(question.courses.map((key) => keyId(key)));
    parts.push(`With any number, ${courseList} ${question.courses.length === 1 ? "counts" : "count"} and ${effect}.`);
  }
  return parts.join(" ");
}

export function petitionQuestion(options: {
  substitution: RequirementSubstitution;
  plan: DegreePlan;
  requirements: ProgramRequirements;
  equivalences?: CourseEquivalences;
  audit: DegreeAudit;
}): DegreePetitionQuestion | null {
  const { substitution, requirements, audit } = options;
  const equivalences = options.equivalences ?? equivalencesFromDeclarations([]);
  const ruleID = audit.placements[substitution.id] ?? substitution.ruleID;
  if (!isUnansweredPetition(substitution, requirements) || substitution.change.type !== "replace" || !resultFor(audit, ruleID)) return null;
  const relaxed = clonePlan(options.plan);
  setCourseNumbers(relaxed, { type: "anyNumber" }, substitution.id);
  const without = runDegreeAudit(relaxed, requirements, equivalences, audit.attributes);
  const replacement = substitution.change.replacement;
  const ranges = likeRanges(replacement, requirements);
  const newlyCounted = (resultFor(without, ruleID)?.used ?? [])
    .map((use) => use.key)
    .filter((key) => !ranges.some((range) => rangeContains(range, key)) && !replacement.courses.some((course) => sameKey(course, key)));
  const satisfied = auditSatisfied(audit);
  const satisfiedWithoutMinimum = auditSatisfied(without);
  const total = auditTotal(audit);
  const likeTitle = replacement.likeRuleTitle ?? (replacement.likeRuleID ? ruleTitle(requirements, replacement.likeRuleID) : null) ?? "That requirement";
  const base = {
    substitution,
    ruleID,
    ruleTitle: ruleTitle(requirements, ruleID) ?? substitution.ruleTitle,
    likeTitle,
    ranges,
    courses: newlyCounted,
    satisfied,
    satisfiedWithoutMinimum,
    total,
    matters: satisfiedWithoutMinimum > satisfied,
  };
  return {
    ...base,
    id: substitution.id,
    question: `Does your ${base.ruleTitle} petition accept any ${rangeSubjectsText(ranges)} course?`,
    explanation: petitionExplanation(base),
  };
}

function auditSatisfied(audit: DegreeAudit): number {
  return ruleResults(audit).filter((result) => statusIsSatisfied(result.status)).length + countedChecks(audit).filter((check) => statusIsSatisfied(check.status)).length;
}

function auditTotal(audit: DegreeAudit): number {
  return ruleResults(audit).length + countedChecks(audit).length;
}

export function petitionQuestions(options: {
  plan: DegreePlan;
  requirements: ProgramRequirements;
  equivalences?: CourseEquivalences;
  audit?: DegreeAudit | null;
}): DegreePetitionQuestion[] {
  const candidates = options.plan.substitutions.filter((substitution) => isUnansweredPetition(substitution, options.requirements));
  if (candidates.length === 0) return [];
  const equivalences = options.equivalences ?? equivalencesFromDeclarations([]);
  const audit = options.audit ?? runDegreeAudit(options.plan, options.requirements, equivalences);
  const questions: DegreePetitionQuestion[] = [];
  for (const substitution of candidates) {
    const question = petitionQuestion({ substitution, plan: options.plan, requirements: options.requirements, equivalences, audit });
    if (question?.matters) questions.push(question);
  }
  return questions;
}

// MARK: - Wording

export function semesterHoursText(value: number): string {
  return `${creditNumber(value)} ${value === 1 ? "semester hour" : "semester hours"}`;
}

export function creditsLine(audit: DegreeAudit): string {
  const done = creditNumber(audit.completedHours);
  let line = audit.requiredHours != null ? `${done} of ${creditNumber(audit.requiredHours)} credits done` : `${done} credits done`;
  if (audit.plannedHours > 0) line += `${DOT}${creditNumber(audit.plannedHours)} planned`;
  return line;
}

export function coverageLine(audit: DegreeAudit): string {
  const total = auditTotal(audit);
  const satisfied = auditSatisfied(audit);
  if (total > 0 && satisfied === total) return total === 1 ? "Your plan covers the requirement" : `Your plan covers all ${total} requirements`;
  return `Your plan covers ${satisfied} of ${total} requirements`;
}

function usedKeyIds(result: RuleResult): Set<string> {
  const used = new Set<string>();
  for (const use of result.used) {
    used.add(keyId(use.key));
    if (use.satisfies) used.add(keyId(use.satisfies));
  }
  return used;
}

export function remainingText(result: RuleResult): string | null {
  const kind = result.effectiveKind;
  if (!kind || statusIsSatisfied(result.status)) return null;
  const used = usedKeyIds(result);
  if (kind.type === "required") {
    if (result.used.length === 0) return null;
    let best: CourseKey[] | null = null;
    for (const alternative of kind.option.alternatives) {
      const missing = alternative.filter((key) => !used.has(keyId(key)));
      if (!best || missing.length < best.length) best = missing;
    }
    if (!best || best.length === 0) return null;
    return `Still needs ${best.map((key) => keyId(key)).join(" and ")}`;
  }
  if (kind.type === "choose") {
    if (result.remainingCount != null && result.remainingCount > 0) {
      const count = result.remainingCount;
      const open = kind.options.filter((option) => !optionCourses(option).some((key) => used.has(keyId(key))));
      if (open.length > 0) {
        const names = open.slice(0, 3).map((option) => optionLabel(option)).join(", ");
        return `${count} more of: ${names}${open.length > 3 ? ", \u2026" : ""}`;
      }
      const range = kind.ranges[0];
      if (range) return `${count} more from ${range.label}`;
      return count === 1 ? "1 more course" : `${count} more courses`;
    }
    if (result.remainingHours != null && result.remainingHours > 0) return `${semesterHoursText(result.remainingHours)} more`;
    return null;
  }
  if (result.remainingHours != null && result.remainingHours > 0) return `${semesterHoursText(result.remainingHours)} more`;
  return null;
}

export function substitutionTitle(substitution: RequirementSubstitution, ruleName: string): string {
  if (substitution.change.type === "countCourse") return `${keyId(substitution.change.course)} counts toward ${ruleName}`;
  return ruleName;
}

export function substitutionDetail(substitution: RequirementSubstitution): string | null {
  if (substitution.change.type === "replace") return `Replaced by ${lowercasingFirst(replacementSummary(substitution.change.replacement))}`;
  if (substitution.change.type === "waive") return "Waived";
  return null;
}

export function substitutionCaption(substitution: RequirementSubstitution, timeZone?: string): string | null {
  const parts: string[] = [];
  const note = nonBlank(substitution.note);
  if (note) parts.push(note);
  if (substitution.approvedOn != null) parts.push(`Approved ${abbreviatedDate(substitution.approvedOn, timeZone)}`);
  return parts.length === 0 ? null : parts.join(DOT);
}

export function requirementProgress(result: RuleResult): string {
  const verb = result.status === "planned" ? "planned" : "done";
  const kind = result.effectiveKind;
  if (!kind) return "Waived";
  if (kind.type === "required") {
    if (statusIsSatisfied(result.status)) return result.status === "planned" ? "Planned" : "Done";
    return remainingText(result) ?? "Not in plan";
  }
  if (kind.type === "choose") {
    if (kind.count != null) {
      const left = result.remainingCount ?? 0;
      return left === 0 ? `${kind.count} of ${kind.count} ${verb}` : `Needs ${left} more`;
    }
    if (kind.hours != null) {
      const left = result.remainingHours ?? 0;
      return left === 0 ? `${creditNumber(kind.hours)} of ${semesterHoursText(kind.hours)} ${verb}` : `Needs ${semesterHoursText(left)} more`;
    }
    return statusIsSatisfied(result.status) ? verb[0]!.toLocaleUpperCase("en-US") + verb.slice(1) : "Needs 1 more";
  }
  const left = result.remainingHours ?? 0;
  return left === 0 ? `${creditNumber(kind.hours)} of ${semesterHoursText(kind.hours)} ${verb}` : `Needs ${semesterHoursText(left)} more`;
}

export function requirementNote(
  course: DegreePlanCourse,
  semester: DegreePlanTerm | null,
  audit: DegreeAudit,
  requirements: ProgramRequirements,
): string | null {
  if (!course.key) return null;
  const result = ruleCounting(audit, course.key);
  if (!result) return null;
  const semesterName = semester ? planTermName(semester) : null;
  const use = result.used.find((item) => sameKey(item.key, course.key!) && (item.semester ?? null) === semesterName && item.credits === course.credits);
  if (!use) return null;
  if (degreeIsGeneralElectives(result.rule)) return "Counts as a general elective";
  const name = degreeCountingName(requirements, result.rule.id, course.key) ?? ruleDisplayLabel(result.rule);
  if (use.bySubstitution) return `Counts toward ${name} by substitution`;
  if (use.satisfies) return degreeNamesCourses(result.rule) ? `Counts as ${keyId(use.satisfies)}` : `Counts toward ${name} as ${keyId(use.satisfies)}`;
  return `Counts toward ${name}`;
}

export function openResults(audit: DegreeAudit): RuleResult[] {
  return ruleResults(audit).filter((result) => !statusIsSatisfied(result.status));
}

export function openChecks(audit: DegreeAudit): NoteCheck[] {
  return countedChecks(audit).filter((check) => !statusIsSatisfied(check.status));
}

export function programTitle(plan: DegreePlan, requirements: ProgramRequirements | null): string {
  if (plan.catalogProgramTitle) return plan.catalogProgramTitle;
  if (!requirements) return "Your program";
  const parts = programParts(requirements.program.title);
  return parts.degree ? `${parts.name}, ${parts.degree}` : requirements.program.title;
}

export function catalogLine(year: CatalogYear | null | undefined, concentrationTitle: string | null | undefined): string {
  const parts: string[] = [];
  if (year) parts.push(`${catalogYearLabel(year)} catalog`);
  if (concentrationTitle) parts.push(concentrationName(concentrationTitle));
  return parts.join(DOT);
}

// MARK: - Listing

export const LIST_COLLAPSE_THRESHOLD = 6;
export const EXTRA_OPTIONS_WHEN_COLLAPSED = 3;
export const NOTE_INLINE_ITEM_LIMIT = 5;

export interface DegreeListEntry {
  id: number;
  alternatives: CourseKey[][];
  category: string | null;
  courses: CourseKey[];
}

export function hasHeaderRow(result: RuleResult): boolean {
  if (result.effectiveKind == null || result.effectiveKind.type === "choose" || result.effectiveKind.type === "generalElectives") return true;
  return isReplaced(result);
}

export function isReplaced(result: RuleResult): boolean {
  return result.substitutions.some((substitution) => substitution.change.type === "replace");
}

export function isShown(use: CourseUse, listed: ReadonlySet<string>): boolean {
  return listed.has(keyId(use.key)) || (use.satisfies != null && listed.has(keyId(use.satisfies)));
}

export function keyIdSet(keys: readonly CourseKey[]): Set<string> {
  return new Set(keys.map((key) => keyId(key)));
}

export type DegreeCourseStatus =
  | { type: "completed"; term: string | null }
  | { type: "inProgress"; term: string }
  | { type: "planned"; term: string }
  | { type: "notInPlan" }
  | { type: "notNeeded" };

export function courseStatusLabel(status: DegreeCourseStatus): string {
  switch (status.type) {
    case "completed":
      return status.term ? `Completed${DOT}${status.term}` : "Completed";
    case "inProgress":
      return `In progress${DOT}${status.term}`;
    case "planned":
      return `Planned${DOT}${status.term}`;
    case "notInPlan":
      return "Not in plan";
    case "notNeeded":
      return "Not needed";
  }
}

export function courseStatusSpoken(status: DegreeCourseStatus): string {
  switch (status.type) {
    case "completed":
      return status.term ? `completed, ${status.term}` : "completed";
    case "inProgress":
      return `in progress, ${status.term}`;
    case "planned":
      return `planned for ${status.term}`;
    case "notInPlan":
      return "not in plan";
    case "notNeeded":
      return "not needed";
  }
}

export function courseStatusInPlan(status: DegreeCourseStatus): boolean {
  return status.type !== "notInPlan" && status.type !== "notNeeded";
}

export interface DegreeCourseRowInfo {
  status: DegreeCourseStatus;
  isCountedHere: boolean;
  bySubstitution: boolean;
  caption: string | null;
  addKey: CourseKey | null;
}

export interface DegreeRowLookup {
  requirements: ProgramRequirements;
  rowInfo(key: CourseKey, result: RuleResult, counted?: CourseUse | null): DegreeCourseRowInfo;
}

export interface ListedPromptLookup {
  forListed(key: CourseKey): unknown | null;
}

const NO_PROMPTS: ListedPromptLookup = { forListed: () => null };

export function isRelevant(entry: DegreeListEntry, result: RuleResult, lookup: DegreeRowLookup, prompts: ListedPromptLookup = NO_PROMPTS): boolean {
  return entry.courses.some((key) => {
    const info = lookup.rowInfo(key, result);
    return info.isCountedHere || info.status.type !== "notInPlan" || (!statusIsSatisfied(result.status) && prompts.forListed(key) != null);
  });
}

export function collapsedEntries(entries: readonly DegreeListEntry[], extra: number, relevant: (entry: DegreeListEntry) => boolean): DegreeListEntry[] {
  let others = 0;
  return entries.filter((entry) => {
    if (relevant(entry)) return true;
    if (others >= extra) return false;
    others += 1;
    return true;
  });
}

export function visibleEntries(
  entries: readonly DegreeListEntry[],
  result: RuleResult,
  isExpanded: boolean,
  lookup: DegreeRowLookup,
  prompts: ListedPromptLookup = NO_PROMPTS,
): { shown: DegreeListEntry[]; isLong: boolean; showsCategories: boolean } {
  const isLong = entries.length > LIST_COLLAPSE_THRESHOLD;
  const shown = isLong && !isExpanded ? collapsedEntries(entries, statusIsSatisfied(result.status) ? 0 : EXTRA_OPTIONS_WHEN_COLLAPSED, (entry) => isRelevant(entry, result, lookup, prompts)) : [...entries];
  return { shown, isLong, showsCategories: !isLong || isExpanded };
}

function optionsEqual(left: readonly CourseOption[], right: readonly CourseOption[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!.alternatives;
    const b = right[i]!.alternatives;
    if (a.length !== b.length) return false;
    for (let j = 0; j < a.length; j += 1) {
      const altA = a[j]!;
      const altB = b[j]!;
      if (altA.length !== altB.length || altA.some((key, k) => !sameKey(key, altB[k]!))) return false;
    }
  }
  return true;
}

export function categoryStarts(options: readonly CourseOption[], categories: readonly string[], subjectName: (subject: string) => string | null | undefined): Record<number, string> {
  const first = categories[0];
  if (!first || options.length === 0) return {};
  const subjects = options.map((option) => optionCourses(option)[0]?.subject ?? "");
  const runs = subjects.map((_, index) => index).filter((index) => index === 0 || subjects[index] !== subjects[index - 1]);
  if (runs.length === categories.length) {
    const starts: Record<number, string> = {};
    runs.forEach((start, index) => {
      const category = categories[index];
      if (category) starts[start] = category;
    });
    return starts;
  }
  const starts: Record<number, string> = { 0: first };
  let current = 0;
  for (const start of runs.slice(1)) {
    if (current + 1 >= categories.length) break;
    const name = subjectName(subjects[start] ?? "") ?? subjects[start] ?? "";
    const next = categories[current + 1];
    if (next && sharesWord(name, next)) {
      current += 1;
      starts[start] = categories[current]!;
    }
  }
  return current === categories.length - 1 ? starts : {};
}

export function sharesWord(a: string, b: string): boolean {
  const words = (text: string) =>
    text
      .toLocaleLowerCase("en-US")
      .split(/[^a-zA-Z]+/)
      .filter((word) => word.length >= 4);
  const right = words(b);
  return words(a).some((left) => right.some((word) => left.startsWith(word) || word.startsWith(left)));
}

export function optionEntries(options: readonly CourseOption[], rule: RequirementRule, subjectName: (subject: string) => string | null | undefined): DegreeListEntry[] {
  let starts: Record<number, string>;
  if (rule.kind.type === "choose" && optionsEqual(rule.kind.options, options) && rule.optionCategories && rule.optionCategories.length === options.length) {
    const categories = rule.optionCategories;
    starts = {};
    categories.forEach((category, index) => {
      if (category == null) return;
      if (index !== 0 && categories[index - 1] === category) return;
      starts[index] = category;
    });
  } else {
    starts = categoryStarts(options, degreeCategories(rule), subjectName);
  }
  return options.map((option, index) => ({
    id: index,
    alternatives: option.alternatives,
    category: starts[index] ?? null,
    courses: option.alternatives.flat(),
  }));
}

export function alternativeEntries(option: CourseOption): DegreeListEntry[] {
  return option.alternatives.map((alternative, index) => ({
    id: index,
    alternatives: [alternative],
    category: null,
    courses: [...alternative],
  }));
}

export function listingOf(rule: RequirementRule): { options: CourseOption[]; ranges: CourseRange[] } {
  if (rule.kind.type === "required") return { options: [rule.kind.option], ranges: [] };
  if (rule.kind.type === "choose") return { options: rule.kind.options, ranges: rule.kind.ranges };
  return { options: [], ranges: [] };
}

export interface CourseRow {
  key: CourseKey;
  info: DegreeCourseRowInfo;
  caption: string | null;
  isWaived: boolean;
  canAct: boolean;
  isMissing: boolean;
}

export function courseRow(key: CourseKey, result: RuleResult, lookup: DegreeRowLookup, counted?: CourseUse | null): CourseRow {
  const info = lookup.rowInfo(key, result, counted);
  const name = degreeShortName(lookup.requirements, result.rule.id) ?? ruleDisplayLabel(result.rule);
  const countedKey = counted?.key ?? key;
  const matched = result.substitutions.find((substitution) => substitution.change.type === "countCourse" && sameKey(substitution.change.course, countedKey));
  const captionPart = matched ? substitutionCaption(matched) : null;
  const substitutionNote = info.bySubstitution ? ["Counts for " + name + " by substitution", captionPart].filter((part): part is string => part != null).join(DOT) : null;
  const canAct = !statusIsSatisfied(result.status);
  return {
    key,
    info,
    caption: info.bySubstitution ? substitutionNote : info.caption,
    isWaived: result.status === "waived",
    canAct,
    isMissing: canAct && info.status.type === "notInPlan",
  };
}

export function splitUnlisted(result: RuleResult, listed: ReadonlySet<string>): { substitutes: CourseUse[]; others: CourseUse[] } {
  const unlisted = result.used.filter((use) => !isShown(use, listed));
  return { substitutes: unlisted.filter((use) => use.bySubstitution), others: unlisted.filter((use) => !use.bySubstitution) };
}

export function substitutionCounting(key: CourseKey, result: RuleResult): RequirementSubstitution | null {
  return result.substitutions.find((substitution) => substitution.change.type === "countCourse" && sameKey(substitution.change.course, key)) ?? null;
}

export function requirementName(result: RuleResult, requirements: ProgramRequirements): string {
  return degreeShortName(requirements, result.rule.id) ?? ruleDisplayLabel(result.rule);
}

export function substituteNote(key: CourseKey, result: RuleResult, timeZone?: string): string | null {
  const substitution = substitutionCounting(key, result);
  return substitution ? substitutionCaption(substitution, timeZone) : null;
}

export function substituteCaption(key: CourseKey, result: RuleResult, requirements: ProgramRequirements, timeZone?: string): string {
  const note = substituteNote(key, result, timeZone);
  return [`Counts for ${requirementName(result, requirements)} by substitution`, note].filter((part): part is string => part != null).join(DOT);
}

export function rowCaption(info: DegreeCourseRowInfo, key: CourseKey, result: RuleResult, requirements: ProgramRequirements, isChild: boolean, timeZone?: string): string | null {
  if (!info.bySubstitution) return info.caption;
  return isChild ? substituteNote(key, result, timeZone) : substituteCaption(key, result, requirements, timeZone);
}

// MARK: - Notes

export interface DegreeNoteEntry {
  sectionID: string;
  text: string;
  check: NoteCheck | null;
  id: string;
}

export function noteEntries(section: RequirementSection, audit: DegreeAudit, filter: DegreeRequirementsFilter, statesTotalHours: boolean): DegreeNoteEntry[] {
  const seen = new Set<string>();
  const consider = (note: string, showsUnchecked: boolean): DegreeNoteEntry | null => {
    const entry: DegreeNoteEntry = {
      sectionID: section.id,
      text: note,
      check: noteCheckOf(audit, section.id, note),
      id: `${section.id}|${note}`,
    };
    if (seen.has(entry.id)) return null;
    seen.add(entry.id);
    if (entry.check) return filterIncludesCheck(filter, entry.check) ? entry : null;
    const restated = statesTotalHours && note.toLocaleLowerCase("en-US").includes("total semester hours");
    return filter === "all" && showsUnchecked && !restated ? entry : null;
  };
  const own = section.notes.flatMap((note) => {
    const entry = consider(note, true);
    return entry ? [entry] : [];
  });
  const grouped = section.groups
    .filter((group) => group.rules.length === 0)
    .flatMap((group) => group.notes)
    .flatMap((note) => {
      const entry = consider(note, false);
      return entry ? [entry] : [];
    });
  return [...own, ...grouped];
}

function noteCheckOf(audit: DegreeAudit, sectionID: string, note: string): NoteCheck | null {
  return audit.noteChecks.find((check) => check.sectionID === sectionID && check.note === note) ?? null;
}

export function checkedNoteEntries(section: RequirementSection, audit: DegreeAudit, filter: DegreeRequirementsFilter): DegreeNoteEntry[] {
  return noteEntries(section, audit, filter, false).filter((entry) => entry.check != null);
}

export function hasNoteChecks(audit: DegreeAudit, filter: DegreeRequirementsFilter): boolean {
  return audit.noteChecks.some((check) => filterIncludesCheck(filter, check));
}

// MARK: - Course lookup

export interface CourseInfoHint {
  title?: string | null;
  maxCredits?: number | null;
  retired?: boolean;
  retiredNote?: string | null;
  notFound?: boolean;
}

export interface BannerCourseHint {
  title?: string | null;
  maxCredits?: number | null;
}

/**
 * Where a catalog course stands in one plan. In-progress and completed term hints come from
 * schedules; this does not read a term calendar.
 */
export class DegreeCourseLookup implements DegreeRowLookup {
  readonly requirements: ProgramRequirements;
  readonly audit: DegreeAudit;
  readonly equivalences: CourseEquivalences;
  private readonly choices: Map<string, DegreePlanCourseChoice>;
  private readonly planKeyIds: Set<string>;
  private readonly countedBy = new Map<string, { ruleID: string; use: CourseUse }>();
  private readonly inProgress: ReadonlyMap<string, string>;
  private readonly completedTerms: ReadonlyMap<string, string>;
  private readonly semestersInSession: ReadonlySet<string>;
  private readonly bannerCourse: (key: CourseKey) => BannerCourseHint | null;
  private readonly info: ReadonlyMap<string, CourseInfoHint>;

  constructor(options: {
    plan: DegreePlan;
    requirements: ProgramRequirements;
    audit: DegreeAudit;
    equivalences?: CourseEquivalences;
    inProgress?: ReadonlyMap<string, string>;
    completedTerms?: ReadonlyMap<string, string>;
    semestersInSession?: ReadonlySet<string>;
    bannerCourse?: (key: CourseKey) => BannerCourseHint | null;
    info?: ReadonlyMap<string, CourseInfoHint>;
  }) {
    this.requirements = options.requirements;
    this.audit = options.audit;
    this.equivalences = (options.equivalences ?? equivalencesFromDeclarations([])).merging(equivalencesFromDeclarations(options.plan.courseEquivalences));
    this.choices = new Map(degreeCourseChoices(options.plan).map((choice) => [keyId(choice.key), choice]));
    this.planKeyIds = new Set(this.choices.keys());
    for (const result of ruleResults(options.audit)) {
      for (const use of result.used) {
        const id = keyId(use.key);
        if (!this.countedBy.has(id)) this.countedBy.set(id, { ruleID: result.rule.id, use });
      }
    }
    this.inProgress = options.inProgress ?? new Map();
    this.completedTerms = options.completedTerms ?? new Map();
    this.semestersInSession = options.semestersInSession ?? new Set();
    this.bannerCourse = options.bannerCourse ?? (() => null);
    this.info = options.info ?? new Map();
  }

  statusOf(key: CourseKey): DegreeCourseStatus {
    const choice = this.choices.get(keyId(key));
    if (!choice) return { type: "notInPlan" };
    if (choice.semester) {
      const name = choice.semesterShortName ?? choice.semester;
      return this.semestersInSession.has(choice.semester) ? { type: "inProgress", term: name } : { type: "planned", term: name };
    }
    const current = this.inProgress.get(keyId(key));
    if (current) return { type: "inProgress", term: current };
    return { type: "completed", term: this.completedTerms.get(keyId(key)) ?? null };
  }

  titleOf(key: CourseKey): string | null {
    return (
      nonBlank(this.requirements.courseTitles[keyId(key)]) ??
      nonBlank(this.bannerCourse(key)?.title) ??
      nonBlank(this.info.get(keyId(key))?.title) ??
      nonBlank(this.choices.get(keyId(key))?.title)
    );
  }

  creditsOf(key: CourseKey): number | null {
    const counted = this.countedBy.get(keyId(key))?.use.credits;
    if (counted != null && counted > 0) return counted;
    const planned = this.choices.get(keyId(key))?.credits;
    if (planned != null && planned > 0) return planned;
    const banner = this.bannerCourse(key)?.maxCredits;
    if (banner != null) return banner;
    const info = this.info.get(keyId(key))?.maxCredits;
    if (info != null) return info;
    return this.choices.get(keyId(key))?.credits ?? null;
  }

  isRetired(key: CourseKey): boolean {
    return this.info.get(keyId(key))?.retired ?? false;
  }

  offeringNote(key: CourseKey): string | null {
    const hint = this.info.get(keyId(key));
    if (!hint) return null;
    if (hint.retiredNote != null) return hint.retiredNote;
    return hint.notFound ? "Not in Banner\u2019s catalog for recent terms" : null;
  }

  equivalentInPlan(key: CourseKey): CourseKey | null {
    return this.equivalences.satisfiers(key, this.planKeyIds).find((other) => !sameKey(other, key)) ?? null;
  }

  currentEquivalent(key: CourseKey): CourseKey | null {
    return [...this.equivalences.equivalentsOf(key)].sort(compareCourseKeys).find((other) => !this.isRetired(other)) ?? null;
  }

  countingRuleID(key: CourseKey): string | null {
    return this.countedBy.get(keyId(key))?.ruleID ?? null;
  }

  isCountedBySubstitution(key: CourseKey): boolean {
    return this.countedBy.get(keyId(key))?.use.bySubstitution ?? false;
  }

  countingCaption(key: CourseKey, exceptRuleID?: string | null): string | null {
    if (!this.choices.has(keyId(key))) return null;
    const counting = this.countedBy.get(keyId(key))?.ruleID;
    if (!counting) return "Doesn\u2019t count toward a requirement";
    if (counting === exceptRuleID) return null;
    const rule = degreeRule(this.requirements, counting, null);
    if (rule && degreeIsGeneralElectives(rule)) return "Counts as a general elective";
    return `Counts toward ${degreeCountingName(this.requirements, counting, key) ?? "another requirement"}`;
  }

  rowInfo(key: CourseKey, result: RuleResult, counted?: CourseUse | null): DegreeCourseRowInfo {
    const use = counted ?? courseUseFor(result, key);
    if (use) {
      if (!sameKey(use.key, key)) {
        return {
          status: this.statusOf(use.key),
          isCountedHere: true,
          bySubstitution: use.bySubstitution,
          caption: `Via ${keyId(use.key)} (${countsAsLabel(use) ?? `counts as ${keyId(key)}`})`,
          addKey: null,
        };
      }
      return {
        status: this.statusOf(key),
        isCountedHere: true,
        bySubstitution: use.bySubstitution,
        caption: use.satisfies ? `Counts as ${keyId(use.satisfies)}` : null,
        addKey: null,
      };
    }
    if (!this.choices.has(keyId(key)) && result.effectiveKind?.type === "required" && statusIsSatisfied(result.status)) {
      const substitute = result.used.find((item) => item.bySubstitution);
      if (substitute) {
        return { status: { type: "notNeeded" }, isCountedHere: false, bySubstitution: false, caption: `${keyId(substitute.key)} counts instead`, addKey: null };
      }
    }
    if (this.choices.has(keyId(key))) {
      return { status: this.statusOf(key), isCountedHere: false, bySubstitution: false, caption: this.countingCaption(key, result.rule.id), addKey: null };
    }
    const equivalent = this.equivalentInPlan(key);
    if (equivalent) {
      let caption = `${keyId(equivalent)} counts as this course`;
      const elsewhere = this.countingCaption(equivalent, result.rule.id);
      if (elsewhere && this.countedBy.has(keyId(equivalent))) caption += `${DOT}${elsewhere}`;
      return { status: this.statusOf(equivalent), isCountedHere: false, bySubstitution: false, caption, addKey: null };
    }
    if (this.isRetired(key)) {
      const current = this.currentEquivalent(key);
      const caption = [this.offeringNote(key), current ? `${keyId(current)} counts as it` : null].filter((part): part is string => part != null).join(DOT);
      return { status: { type: "notInPlan" }, isCountedHere: false, bySubstitution: false, caption: caption || null, addKey: current };
    }
    return { status: { type: "notInPlan" }, isCountedHere: false, bySubstitution: false, caption: this.offeringNote(key), addKey: key };
  }

  /**
   * Semesters a course can still be added to. Terms that have already ended are not dropped:
   * that uses a term calendar this port does not include. With no semesters, the next three.
   */
  static addTargets(plan: DegreePlan, now = new Date()): DegreePlanTerm[] {
    if (plan.terms.length > 0) return [...plan.terms];
    return nextSemesters(plan, 3, now);
  }

  /** A Banner term code's short name: `Fall 2026`, `Summer A 2027`. */
  static termDisplayName(code: string, terms: readonly { code: string; bannerDescription: string }[]): string {
    const found = terms.find((term) => term.code === code);
    if (found && found.bannerDescription && !found.bannerDescription.startsWith("Term ")) return termShortName(found);
    const season = planSeasonFromBanner(termSeason(code));
    return `${PLAN_SEASON_SHORT[season]} ${termCalendarYear(code)}`;
  }
}

function planSeasonFromBanner(season: ReturnType<typeof termSeason>): PlanSeason {
  switch (season) {
    case "fall":
      return "fall";
    case "winter":
      return "winter";
    case "spring":
      return "spring";
    case "summer1":
      return "summerA";
    case "summer2":
      return "summerB";
    default:
      return "summerFull";
  }
}

/** Re-export so listing callers can pass the prompt index directly. */
export type { DegreeEquivalencePrompts };
