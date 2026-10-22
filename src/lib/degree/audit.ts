/**
 * Degree-requirements audit. A course number counts once unless the entries are distinct manual sections.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreeAudit.swift, the naming and milestone parts of
 * DegreeRequirementsSupport.swift, and the range-limit helpers the audit applies.
 */

import { CourseEquivalences, equivalencesFromDeclarations } from "@/lib/equivalences";
import type { CourseKey } from "@/lib/models";
import { compareCourseKeys, creditNumber, keyId, sameKey, type NuPathInfo } from "@/lib/models";
import {
  NUpathMatching,
  NUPATH_REQUIREMENTS,
  EMPTY_ATTRIBUTES,
  attributesAreEmpty,
  isCoopNote,
  nuPathSet,
  nupathTitle,
  satisfiedThroughCoop,
  type DegreeCourseAttributes,
  type NUpathCourse,
} from "@/lib/degree/nupath";
import type {
  CourseNumberLimit,
  CourseOption,
  CourseRange,
  DegreePlan,
  DegreePlanCourse,
  ProgramRequirements,
  RequirementGroup,
  RequirementKind,
  RequirementReplacement,
  RequirementRule,
  RequirementSection,
  RequirementSubstitution,
} from "@/lib/requirements";
import {
  PLAN_SEASON_EXPORT,
  PLAN_SEASON_SHORT,
  applicableSections,
  concentrationName,
  optionCourses,
  rangeContains,
  ruleDisplayLabel,
  ruleTitle,
} from "@/lib/requirements";

export type AuditStatus = "missing" | "partial" | "planned" | "complete" | "waived";

const STATUS_RANK: Record<AuditStatus, number> = { missing: 0, partial: 1, planned: 2, complete: 3, waived: 4 };

export function statusRank(status: AuditStatus): number {
  return STATUS_RANK[status];
}

export function statusIsSatisfied(status: AuditStatus): boolean {
  return STATUS_RANK[status] >= STATUS_RANK.planned;
}

export function minStatus(statuses: readonly AuditStatus[]): AuditStatus {
  return statuses.reduce((best, status) => (STATUS_RANK[status] < STATUS_RANK[best] ? status : best));
}

const DOT = " \u00b7 ";

export interface CourseUse {
  key: CourseKey;
  title: string;
  credits: number;
  semester: string | null;
  order: number;
  bySubstitution: boolean;
  satisfies?: CourseKey;
  instance: number;
  id: string;
  crn?: string | null;
}

export function courseUseIsCompleted(use: CourseUse): boolean {
  return use.semester == null;
}

/** Course code shown for a row. A later copy of the same number gets “ (2)”, “ (3)”, … */
export function courseUseName(use: Pick<CourseUse, "key" | "instance">): string {
  return use.instance === 0 ? keyId(use.key) : `${keyId(use.key)} (${use.instance + 1})`;
}

export function countsAsLabel(use: CourseUse): string | null {
  return use.satisfies ? `counts as ${keyId(use.satisfies)}` : null;
}

export interface RuleResult {
  rule: RequirementRule;
  effectiveKind: RequirementKind | null;
  status: AuditStatus;
  used: CourseUse[];
  remainingCount?: number;
  remainingHours?: number;
  substitutions: RequirementSubstitution[];
  id: string;
}

export function courseUseFor(result: RuleResult, required: CourseKey): CourseUse | undefined {
  return result.used.find((use) => sameKey(use.key, required) && use.satisfies == null)
    ?? result.used.find((use) => use.satisfies != null && sameKey(use.satisfies, required));
}

export interface GroupResult {
  group: RequirementGroup;
  rules: RuleResult[];
  id: string;
  status: AuditStatus;
}

export interface SectionResult {
  section: RequirementSection;
  groups: GroupResult[];
  id: string;
  rules: RuleResult[];
  status: AuditStatus;
}

export type NoteKind =
  | { type: "majorHours"; required: number }
  | { type: "coop" }
  | { type: "nupath" }
  | { type: "universitywide" }
  | { type: "totalHours"; required: number };

export interface NoteItem {
  id: string;
  title: string;
  status: AuditStatus | null;
  detail: string;
  courses: string[];
}

export interface NoteCheck {
  sectionID: string;
  note: string;
  kind: NoteKind;
  status: AuditStatus;
  detail: string;
  items: NoteItem[];
  counts: boolean;
  id: string;
  title: string;
}

export interface DegreeAudit {
  requirements: ProgramRequirements;
  sections: SectionResult[];
  generalElectives: CourseUse[];
  unused: CourseUse[];
  completedHours: number;
  plannedHours: number;
  requiredHours: number | null;
  unmatchedSubstitutions: RequirementSubstitution[];
  placements: Record<string, string>;
  needsConcentration: boolean;
  noteChecks: NoteCheck[];
  attributes: DegreeCourseAttributes;
}

export interface NearMiss {
  course: CourseUse;
  range: CourseRange;
  reason: string;
  id: string;
}

export function ruleResults(audit: DegreeAudit): RuleResult[] {
  return audit.sections.flatMap((section) => section.rules);
}

export function resultFor(audit: DegreeAudit, ruleID: string): RuleResult | undefined {
  return ruleResults(audit).find((result) => result.rule.id === ruleID);
}

export function countedChecks(audit: DegreeAudit): NoteCheck[] {
  return audit.noteChecks.filter((check) => check.counts);
}

export function satisfiedCount(audit: DegreeAudit): number {
  return ruleResults(audit).filter((result) => statusIsSatisfied(result.status)).length
    + countedChecks(audit).filter((check) => statusIsSatisfied(check.status)).length;
}

export function completeCount(audit: DegreeAudit): number {
  return ruleResults(audit).filter((result) => result.status === "complete" || result.status === "waived").length
    + countedChecks(audit).filter((check) => check.status === "complete").length;
}

export function totalCount(audit: DegreeAudit): number {
  return ruleResults(audit).length + countedChecks(audit).length;
}

export function noteCheck(audit: DegreeAudit, sectionID: string, note: string): NoteCheck | undefined {
  return audit.noteChecks.find((check) => check.sectionID === sectionID && check.note === note);
}

export function ruleCounting(audit: DegreeAudit, key: CourseKey): RuleResult | undefined {
  return ruleResults(audit).find((result) => result.used.some((use) => sameKey(use.key, key)));
}

export function fewestCreditsChoice(uses: readonly CourseUse[], need: number): Set<string> | null {
  return fewestCredits(uses, need);
}

export function uncheckedReason(note: string): string | null {
  if (/(?:GPA\b|grade\s+point|minimum\s+grade|grade\s+of\s+[A-D])/i.test(note)) {
    return "Not checked: plans don\u2019t include grades";
  }
  if (/residen|(?:at|from)\s+Northeastern|Northeastern\s+University\s+semester\s+hours/i.test(note)) {
    return "Not checked: a plan doesn\u2019t say where credits were earned";
  }
  if (/(?:pick|choose|select|complete)\s+(?:one|a)\s+(?:of\s+the\s+following\s+)?concentrations?/i.test(note)) {
    return "Checked through the concentration you choose";
  }
  return null;
}

export function isMajorHoursNote(note: string): number | null {
  const match = note.match(/(\d+(?:\.\d+)?)\s+(?:semester\s+)?(?:credit\s+)?hours\s+(?:in|within)\s+the\s+major/i);
  return match?.[1] ? Number(match[1]) : null;
}

export function isNUpathNote(note: string): boolean {
  return /complete\s+(?:the\s+)?NUpath\s+requirements/i.test(note);
}

export function isUniversitywideNote(note: string): boolean {
  return /complete\s+(?:the\s+)?university-?\s?wide\s+requirements/i.test(note);
}

export function totalHoursIn(note: string): number | null {
  const match = note.match(/(\d+(?:\.\d+)?)\s+total\s+semester\s+hours\s+required/i);
  return match?.[1] ? Number(match[1]) : null;
}

export function isCoopCourse(use: Pick<CourseUse, "key" | "title">): boolean {
  return use.key.subject === "COOP" || /co-?op\s+(?:work\s+)?experience|cooperative\s+education/i.test(use.title);
}

export { isCoopNote };

export function courseCountsSeparately(
  title: string,
  credits: number,
  otherTitle: string,
  otherCredits: number,
): boolean {
  if (credits <= 0 || otherCredits <= 0) return false;
  const first = normalizedRepeatTitle(title);
  const second = normalizedRepeatTitle(otherTitle);
  if (first && second && first !== second) return true;
  return first.includes("topic") || second.includes("topic");
}

function normalizedRepeatTitle(title: string): string {
  return title.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");
}

export function describedRangeLabel(range: CourseRange): string {
  let text: string;
  if (range.lowest > 0 && range.highest != null) text = `${range.subject} ${range.lowest} to ${range.subject} ${range.highest}`;
  else if (range.lowest > 0) text = `${range.subject} ${range.lowest} or higher`;
  else if (range.highest != null) text = `${range.subject} courses up to ${range.subject} ${range.highest}`;
  else text = `Any ${range.subject} course`;
  if (range.except.length > 0) text += `, except ${range.except.map((key) => keyId(key)).join(", ")}`;
  return text;
}

export function applyCourseNumberLimit(range: CourseRange, limit?: CourseNumberLimit | null): CourseRange {
  if (limit == null || limit.type === "sameAsRequirement") return range;
  const next: CourseRange = { ...range, except: [...range.except] };
  if (limit.type === "anyNumber") next.lowest = 0;
  else next.lowest = limit.minimum;
  next.label = describedRangeLabel(next);
  return next;
}

export function reasonExcluding(range: CourseRange, key: CourseKey): string | null {
  if (key.subject !== range.subject || rangeContains(range, key)) return null;
  if (range.except.some((item) => sameKey(item, key))) return `${keyId(key)} is excluded`;
  let i = 0;
  while (i < key.number.length && key.number[i]! >= "0" && key.number[i]! <= "9") i += 1;
  if (i === 0) return null;
  const number = Number(key.number.slice(0, i));
  if (number < range.lowest) return `Below ${range.subject} ${range.lowest}`;
  if (range.highest != null && number > range.highest) return `Above ${range.subject} ${range.highest}`;
  return null;
}

export function rangeSubjectsText(ranges: readonly CourseRange[]): string {
  const seen = new Set<string>();
  const subjects = ranges.map((range) => range.subject).filter((subject) => {
    if (seen.has(subject)) return false;
    seen.add(subject);
    return true;
  });
  return joinOr(subjects);
}

export function rangeMinimumsText(ranges: readonly CourseRange[]): string | null {
  const minimums = ranges.filter((range) => range.lowest > 0).map((range) => `${range.subject} ${range.lowest}`);
  return minimums.length === 0 ? null : joinOr(minimums);
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function joinOr(items: readonly string[]): string {
  return joinAnd(items).replace(/ and /g, " or ");
}

export function degreeLocation(requirements: ProgramRequirements, id: string): { section: RequirementSection; group: RequirementGroup; rule: RequirementRule } | null {
  for (const section of requirements.sections) {
    for (const group of section.groups) {
      const rule = group.rules.find((item) => item.id === id);
      if (rule) return { section, group, rule };
    }
  }
  return null;
}

export function degreeNamesCourses(rule: RequirementRule): boolean {
  return /^[A-Z]{2,5}\s?\d{4}/.test(ruleDisplayLabel(rule));
}

export function degreeIsGeneralElectives(rule: RequirementRule): boolean {
  return rule.kind.type === "generalElectives";
}

export function degreeIsCategory(note: string): boolean {
  return note.length <= 48 && !note.includes(".") && !note.includes(":");
}

export function degreeCategories(rule: RequirementRule): string[] {
  return rule.notes.filter(degreeIsCategory);
}

export function degreeParagraphs(rule: RequirementRule): string[] {
  return rule.notes.filter((note) => !degreeIsCategory(note));
}

export function degreeShortName(requirements: ProgramRequirements, id: string): string | null {
  const location = degreeLocation(requirements, id);
  if (!location) return null;
  if (location.group.rules.length === 1) {
    const title = ruleTitle(requirements, id);
    if (title) {
      if (location.section.isConcentration && location.group.title == null && !degreeNamesCourses(location.rule)) {
        return `${concentrationName(location.section.title)} concentration`;
      }
      return title;
    }
  }
  if (degreeNamesCourses(location.rule)) return ruleDisplayLabel(location.rule);
  if (location.group.title) return location.group.title;
  if (location.section.isConcentration) return `${concentrationName(location.section.title)} concentration`;
  return location.section.title;
}

export function degreeCountingName(requirements: ProgramRequirements, id: string, course: CourseKey): string | null {
  const name = degreeShortName(requirements, id);
  if (!name) return null;
  if (!name.includes(keyId(course))) return name;
  const location = degreeLocation(requirements, id);
  if (!location) return name;
  if (location.group.title) return location.group.title;
  return location.section.isConcentration ? `${concentrationName(location.section.title)} concentration` : location.section.title;
}

export function degreeRowTitle(requirements: ProgramRequirements, rule: RequirementRule): string {
  return ruleTitle(requirements, rule.id) ?? ruleDisplayLabel(rule);
}

export function degreeListedCourses(requirements: ProgramRequirements, concentrationID?: string | null): CourseKey[] {
  const seen = new Set<string>();
  const courses: CourseKey[] = [];
  for (const section of applicableSections(requirements, concentrationID)) {
    for (const group of section.groups) {
      for (const rule of group.rules) {
        const listed = rule.kind.type === "required"
          ? optionCourses(rule.kind.option)
          : rule.kind.type === "choose"
            ? rule.kind.options.flatMap(optionCourses)
            : [];
        for (const key of listed) {
          const id = keyId(key);
          if (seen.has(id)) continue;
          seen.add(id);
          courses.push(key);
        }
      }
    }
  }
  return courses;
}

export function degreeReplacementSources(requirements: ProgramRequirements, excluding: string, concentrationID?: string | null): RequirementRule[] {
  return applicableSections(requirements, concentrationID).flatMap((section) => section.groups.flatMap((group) => group.rules)).filter((rule) => {
    if (rule.id === excluding) return false;
    if (rule.kind.type === "generalElectives") return true;
    if (rule.kind.type === "choose") return rule.kind.options.length > 0 || rule.kind.ranges.length > 0;
    return false;
  });
}

export function degreeRule(requirements: ProgramRequirements, id: string | null | undefined, name: string | null | undefined): RequirementRule | null {
  if (id) {
    for (const section of requirements.sections) {
      for (const group of section.groups) {
        const rule = group.rules.find((item) => item.id === id);
        if (rule) return rule;
      }
    }
  }
  const wanted = name?.toLowerCase();
  if (!wanted) return null;
  const matches: RequirementRule[] = [];
  for (const section of requirements.sections) {
    for (const group of section.groups) {
      for (const rule of group.rules) {
        const names = [degreeShortName(requirements, rule.id), ruleTitle(requirements, rule.id)];
        if (names.some((item) => item?.toLowerCase() === wanted)) matches.push(rule);
      }
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

export function degreeOpenListedCourses(audit: DegreeAudit, plan: DegreePlan): CourseKey[] {
  const inPlan = new Set<string>();
  for (const course of plan.completed) if (course.key) inPlan.add(keyId(course.key));
  for (const term of plan.terms) for (const course of term.courses) if (course.key) inPlan.add(keyId(course.key));
  const seen = new Set<string>();
  const open: CourseKey[] = [];
  for (const result of ruleResults(audit)) {
    if (statusIsSatisfied(result.status)) continue;
    const listed = result.rule.kind.type === "required"
      ? optionCourses(result.rule.kind.option)
      : result.rule.kind.type === "choose"
        ? result.rule.kind.options.flatMap(optionCourses)
        : [];
    for (const key of listed) {
      const id = keyId(key);
      if (inPlan.has(id) || seen.has(id)) continue;
      seen.add(id);
      open.push(key);
    }
  }
  return open;
}

export function nearMisses(audit: DegreeAudit, ruleID: string): NearMiss[] {
  const result = resultFor(audit, ruleID);
  if (!result || statusIsSatisfied(result.status) || result.effectiveKind?.type !== "choose" || result.effectiveKind.ranges.length === 0) {
    return [];
  }
  const count = result.effectiveKind.count;
  const ranges = result.effectiveKind.ranges;
  const candidates = [...audit.generalElectives, ...audit.unused].filter((use) => use.credits > 0 && (count == null || use.credits >= 2));
  const misses: NearMiss[] = [];
  for (const use of candidates) {
    if (ranges.some((range) => rangeContains(range, use.key))) continue;
    for (const range of ranges) {
      const reason = reasonExcluding(range, use.key);
      if (reason) {
        misses.push({ course: use, range, reason, id: use.id });
        break;
      }
    }
  }
  misses.sort((a, b) => (courseUseIsCompleted(a.course) ? 0 : 1) - (courseUseIsCompleted(b.course) ? 0 : 1) || a.course.order - b.course.order);
  return misses;
}

export interface DegreeMilestone {
  kind: "completed" | "after";
  termID?: string;
  name?: string;
  summaryLine: string;
}

export function findMilestone(
  plan: DegreePlan,
  requirements: ProgramRequirements,
  equivalences: CourseEquivalences = CourseEquivalences.none(),
  attributes: DegreeCourseAttributes = EMPTY_ATTRIBUTES,
): DegreeMilestone | null {
  const finished = (partial: DegreePlan) => {
    const audit = runDegreeAudit(partial, requirements, equivalences, attributes);
    if (totalCount(audit) <= 0 || audit.needsConcentration) return false;
    if (!ruleResults(audit).every((result) => statusIsSatisfied(result.status))) return false;
    if (!countedChecks(audit).every((check) => statusIsSatisfied(check.status))) return false;
    if (audit.requiredHours != null && audit.completedHours + audit.plannedHours < audit.requiredHours) return false;
    return true;
  };
  const completedOnly: DegreePlan = { ...plan, terms: [] };
  if (finished(completedOnly)) return { kind: "completed", summaryLine: "All degree requirements complete" };
  for (let index = 0; index < plan.terms.length; index += 1) {
    const term = plan.terms[index]!;
    if (term.courses.length === 0) continue;
    const partial: DegreePlan = { ...plan, terms: plan.terms.slice(0, index + 1) };
    if (finished(partial)) {
      const name = `${PLAN_SEASON_SHORT[term.season]} ${term.year}`;
      return { kind: "after", termID: term.id, name, summaryLine: `On track to finish after ${name}` };
    }
  }
  return null;
}

export function runDegreeAudit(
  plan: DegreePlan,
  requirements: ProgramRequirements,
  equivalences: CourseEquivalences = CourseEquivalences.none(),
  attributes: DegreeCourseAttributes = EMPTY_ATTRIBUTES,
): DegreeAudit {
  const engine = new AuditEngine(plan, requirements, equivalences.merging(equivalencesFromDeclarations(plan.courseEquivalences)), attributes);
  const audit = engine.run();
  audit.attributes = attributes;
  return audit;
}

type Effective = { type: "waived" } | { type: "kind"; kind: RequirementKind; anyCourse: boolean };

class AuditEngine {
  readonly plan: DegreePlan;
  readonly requirements: ProgramRequirements;
  readonly equivalences: CourseEquivalences;
  readonly attributes: DegreeCourseAttributes;
  readonly sections: RequirementSection[];
  readonly rules: RequirementRule[];
  readonly substitutionsByRule: Map<string, RequirementSubstitution[]>;
  readonly unplaced: RequirementSubstitution[];
  readonly rulesByName: Map<string, Set<string>>;
  readonly pool = new Map<string, CourseUse>();
  readonly instances = new Map<string, string[]>();
  available = new Set<string>();
  used = new Map<string, CourseUse[]>();
  optionsCounted = new Map<string, number>();
  effective = new Map<string, Effective>();
  demand = new Map<string, number>();
  singles = new Map<string, Set<string>>();
  unmatched: RequirementSubstitution[] = [];

  constructor(plan: DegreePlan, requirements: ProgramRequirements, equivalences: CourseEquivalences, attributes: DegreeCourseAttributes) {
    this.plan = plan;
    this.requirements = requirements;
    this.equivalences = equivalences;
    this.attributes = attributes;
    this.sections = applicableSections(requirements, plan.concentrationID);
    this.rules = this.sections.flatMap((section) => section.groups.flatMap((group) => group.rules));
    this.rulesByName = new Map();
    for (const rule of this.rules) {
      for (const name of [degreeShortName(requirements, rule.id), ruleTitle(requirements, rule.id)]) {
        if (!name) continue;
        const key = name.toLowerCase();
        const set = this.rulesByName.get(key) ?? new Set<string>();
        set.add(rule.id);
        this.rulesByName.set(key, set);
      }
    }
    const ids = new Set(this.rules.map((rule) => rule.id));
    this.substitutionsByRule = new Map();
    this.unplaced = [];
    for (const substitution of plan.substitutions) {
      if (ids.has(substitution.ruleID)) {
        pushMap(this.substitutionsByRule, substitution.ruleID, substitution);
      } else {
        const named = this.rulesByName.get(substitution.ruleTitle.toLowerCase());
        const only = named && named.size === 1 ? [...named][0] : undefined;
        if (only) pushMap(this.substitutionsByRule, only, substitution);
        else this.unplaced.push(substitution);
      }
    }
    let order = 0;
    const offer = (course: DegreePlanCourse, semester: string | null) => {
      const current = order;
      order += 1;
      if (!course.key) return;
      const key = course.key;
      const draft: CourseUse = {
        key,
        title: course.title,
        credits: course.credits,
        semester,
        order: current,
        bySubstitution: false,
        instance: 0,
        id: keyId(key),
        crn: course.crn ?? null,
      };
      const list = this.instances.get(keyId(key)) ?? [];
      draft.instance = list.length;
      draft.id = course.id;
      this.pool.set(draft.id, draft);
      list.push(draft.id);
      this.instances.set(keyId(key), list);
    };
    for (const course of plan.completed) offer(course, null);
    for (const term of plan.terms) {
      const name = `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`;
      for (const course of term.courses) offer(course, name);
    }
    this.available = new Set(this.pool.keys());
  }

  clone(): AuditEngine {
    const next = Object.assign(Object.create(AuditEngine.prototype) as AuditEngine, this);
    next.available = new Set(this.available);
    next.used = new Map([...this.used].map(([id, uses]) => [id, uses.slice()]));
    next.optionsCounted = new Map(this.optionsCounted);
    next.singles = new Map([...this.singles].map(([id, set]) => [id, new Set(set)]));
    next.unmatched = this.unmatched.slice();
    return next;
  }

  adopt(next: AuditEngine): void {
    this.available = next.available;
    this.used = next.used;
    this.optionsCounted = next.optionsCounted;
    this.singles = next.singles;
  }

  run(): DegreeAudit {
    this.resolveSubstitutions();
    this.applyCourseSubstitutions();
    const required = this.rules.flatMap((rule, index) => {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind" || current.kind.type !== "required") return [];
      return [{ index, rule, option: current.kind.option }];
    });
    required.sort((a, b) => a.option.alternatives.length - b.option.alternatives.length || a.index - b.index);
    for (const item of required) this.fillRequired(item.rule, item.option);

    const choices = this.rules.flatMap((rule, index) => {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind" || current.kind.type !== "choose") return [];
      return [{ index, rule, options: current.kind.options.length, ranged: current.kind.ranges.length > 0 || current.anyCourse }];
    });
    const lists = choices.filter((item) => !item.ranged).sort((a, b) => a.options - b.options || a.index - b.index);
    for (const item of lists) this.fillChoice(item.rule);
    const ranged = choices.filter((item) => item.ranged);
    const countsCourses = (rule: RequirementRule) => {
      const current = this.effective.get(rule.id);
      return current?.type === "kind" && current.kind.type === "choose" && current.kind.count != null;
    };
    for (const item of ranged) if (countsCourses(item.rule)) this.fillChoice(item.rule);
    for (const item of ranged) if (!countsCourses(item.rule)) this.fillChoice(item.rule);
    this.rebalance();
    if (this.ensureBestMatching()) {
      for (const rule of this.rules) {
        if (this.isMet(rule.id)) continue;
        const current = this.effective.get(rule.id);
        if (current?.type !== "kind") continue;
        if (current.kind.type === "required") this.fillRequired(rule, current.kind.option);
        else if (current.kind.type === "choose") this.fillChoice(rule);
      }
    }
    this.trimSurplusHours();
    const generalElectives: CourseUse[] = [];
    for (const rule of this.rules) {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind" || current.kind.type !== "generalElectives") continue;
      const counted = (this.used.get(rule.id) ?? []).reduce((sum, use) => sum + use.credits, 0);
      const candidates = this.remaining().filter((use) => use.credits > 0);
      const chosen = fewestCredits(candidates, current.kind.hours - counted) ?? new Set(candidates.map((use) => use.id));
      for (const use of candidates) if (chosen.has(use.id)) this.consume(use.id, rule.id);
      generalElectives.push(...(this.used.get(rule.id) ?? []));
    }
    const sections = this.sections.map((section) => {
      const groups = section.groups.map((group) => {
        const rules = group.rules.map((rule) => this.result(rule));
        return { group, rules, id: group.id, status: rules.length === 0 ? "complete" as AuditStatus : minStatus(rules.map((rule) => rule.status)) };
      });
      const rules = groups.flatMap((group) => group.rules);
      return {
        section,
        groups,
        id: section.id,
        rules,
        status: rules.length === 0 ? "complete" as AuditStatus : minStatus(rules.map((rule) => rule.status)),
      };
    });
    const courses = [...this.pool.values()];
    const concentrations = this.requirements.sections.filter((section) => section.isConcentration);
    const concentrationChosen = this.plan.concentrationID != null && concentrations.some((section) => section.id === this.plan.concentrationID);
    const placements: Record<string, string> = {};
    for (const [ruleID, substitutions] of this.substitutionsByRule) {
      for (const substitution of substitutions) placements[substitution.id] = ruleID;
    }
    return {
      requirements: this.requirements,
      sections,
      generalElectives,
      unused: this.remaining(),
      completedHours: courses.filter(courseUseIsCompleted).reduce((sum, use) => sum + Math.max(0, use.credits), 0),
      plannedHours: courses.filter((use) => !courseUseIsCompleted(use)).reduce((sum, use) => sum + Math.max(0, use.credits), 0),
      requiredHours: this.requirements.totalHours ?? null,
      unmatchedSubstitutions: this.unmatched,
      placements,
      needsConcentration: concentrations.length > 0 && !concentrationChosen,
      noteChecks: this.noteChecks(),
      attributes: this.attributes,
    };
  }

  private resolveSubstitutions(): void {
    this.unmatched = [...this.unplaced];
    for (const rule of this.rules) {
      const substitutions = this.substitutionsByRule.get(rule.id) ?? [];
      if (substitutions.some((substitution) => substitution.change.type === "waive")) {
        this.effective.set(rule.id, { type: "waived" });
        continue;
      }
      const replacement = [...substitutions].reverse().find((substitution) => substitution.change.type === "replace");
      if (replacement && replacement.change.type === "replace") this.effective.set(rule.id, this.replacementKind(replacement.change.replacement));
      else this.effective.set(rule.id, { type: "kind", kind: rule.kind, anyCourse: false });
    }
    for (const rule of this.rules) {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind") continue;
      const listed = current.kind.type === "required"
        ? optionCourses(current.kind.option)
        : current.kind.type === "choose"
          ? current.kind.options.flatMap(optionCourses)
          : [];
      for (const key of new Set(listed.map(keyId))) this.demand.set(key, (this.demand.get(key) ?? 0) + 1);
    }
  }

  private replacementKind(replacement: RequirementReplacement): Effective {
    let options: CourseOption[] = replacement.courses.map((course) => ({ alternatives: [[course]] }));
    let ranges: CourseRange[] = [];
    let anyCourse = false;
    const namedSet = replacement.likeRuleTitle ? this.rulesByName.get(replacement.likeRuleTitle.toLowerCase()) : undefined;
    const named = namedSet && namedSet.size === 1 ? [...namedSet][0] : undefined;
    const byId = replacement.likeRuleID ? degreeRule(this.requirements, replacement.likeRuleID, null) : null;
    if (!byId && !named && replacement.likeRuleTitle?.toLowerCase().startsWith("general electives")) anyCourse = true;
    const like = byId ?? (named ? degreeRule(this.requirements, named, null) : null);
    if (like) {
      if (like.kind.type === "required") options = [like.kind.option, ...options];
      else if (like.kind.type === "choose") {
        options = [...like.kind.options, ...options];
        ranges = like.kind.ranges.map((range) => applyCourseNumberLimit(range, replacement.courseNumbers));
      } else anyCourse = true;
    }
    const count = replacement.count ?? (replacement.hours == null ? 1 : null);
    return {
      type: "kind",
      kind: { type: "choose", count, hours: replacement.hours ?? null, options, ranges },
      anyCourse,
    };
  }

  private applyCourseSubstitutions(): void {
    for (const rule of this.rules) {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind") continue;
      for (const substitution of this.substitutionsByRule.get(rule.id) ?? []) {
        if (substitution.change.type !== "countCourse") continue;
        const taken = substitution.change.rowID
          ? this.rowStandIn(substitution.change.rowID, substitution.change.course)
          : this.standIn(substitution.change.course);
        if (!taken) {
          this.unmatched.push(substitution);
          continue;
        }
        this.consume(taken, rule.id, true, substitution.change.course);
        this.optionsCounted.set(rule.id, (this.optionsCounted.get(rule.id) ?? 0) + 1);
      }
    }
  }

  private fillRequired(rule: RequirementRule, option: CourseOption): void {
    if ((this.used.get(rule.id) ?? []).length > 0) return;
    const complete = option.alternatives.filter((alternative) => this.isComplete(alternative));
    const best = minBy(complete, (alternative) => this.score(alternative));
    if (best) {
      for (const pair of this.assign(best)) this.consume(pair.taken, rule.id, false, pair.required);
      return;
    }
    let partial: { required: CourseKey; taken: string }[] = [];
    let bestCount = -1;
    for (const alternative of option.alternatives) {
      const assigned = this.assign(alternative);
      if (assigned.length > bestCount) {
        bestCount = assigned.length;
        partial = assigned;
      }
    }
    for (const pair of partial) this.consume(pair.taken, rule.id, false, pair.required);
  }

  private fillChoice(rule: RequirementRule): void {
    const current = this.effective.get(rule.id);
    if (current?.type !== "kind" || current.kind.type !== "choose") return;
    const { count, hours, options, ranges } = current.kind;
    const anyCourse = current.anyCourse;
    const done = () => this.isSatisfied(rule.id, count, hours);
    const candidates = options.flatMap((option, index) => {
      const complete = option.alternatives.filter((alternative) => this.isComplete(alternative));
      const best = minBy(complete, (alternative) => this.score(alternative));
      if (!best) return [];
      const score = this.score(best);
      return [{ best, rank: [score[0], score[1], index] as const }];
    });
    candidates.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
    for (const candidate of candidates) {
      if (done()) break;
      if (!this.isComplete(candidate.best)) continue;
      const pairs = this.assign(candidate.best);
      for (const pair of pairs) this.consume(pair.taken, rule.id, false, pair.required);
      if (pairs.length === 1) this.addSingle(rule.id, pairs[0]!.taken);
      this.optionsCounted.set(rule.id, (this.optionsCounted.get(rule.id) ?? 0) + 1);
    }
    if (done() || (ranges.length === 0 && !anyCourse)) return;
    const matches = this.remaining().flatMap((use) => {
      if (use.credits <= 0 || (count != null && use.credits < 2)) return [];
      if (anyCourse) return [{ use, via: null as CourseKey | null }];
      const inRange = this.courseInRange(use.key, ranges);
      if (!inRange) return [];
      return [{ use, via: sameKey(inRange, use.key) ? null : inRange }];
    });
    for (const match of matches) {
      if (done()) break;
      this.consume(match.use.id, rule.id, false, match.via);
      this.optionsCounted.set(rule.id, (this.optionsCounted.get(rule.id) ?? 0) + 1);
      this.addSingle(rule.id, match.use.id);
    }
  }

  private noteChecks(): NoteCheck[] {
    const checks: NoteCheck[] = [];
    for (const section of this.sections) {
      const notes = [...section.notes, ...section.groups.filter((group) => group.rules.length === 0).flatMap((group) => group.notes)];
      for (const note of notes) {
        const major = isMajorHoursNote(note);
        if (major != null) checks.push(this.majorHoursCheck(section.id, note, major));
        else if (isCoopNote(note)) checks.push(this.coopCheck(section.id, note));
        else if (isNUpathNote(note)) {
          const check = this.nupathCheck(section.id, note);
          if (check) checks.push(check);
        } else if (isUniversitywideNote(note)) {
          const check = this.universitywideCheck(section.id, note);
          if (check) checks.push(check);
        } else {
          const total = totalHoursIn(note);
          if (total != null) checks.push(this.totalHoursCheck(section.id, note, total));
        }
      }
    }
    return checks;
  }

  private majorHoursCheck(sectionID: string, note: string, required: number): NoteCheck {
    const counted = new Map<string, CourseUse>();
    const ranges: CourseRange[] = [];
    for (const section of this.sections) {
      for (const group of section.groups) {
        const isWriting = [section.title, group.title ?? ""].some((title) => title.toLowerCase().includes("writing"));
        for (const rule of group.rules) {
          const current = this.effective.get(rule.id);
          if (current?.type !== "kind") continue;
          if (current.kind.type === "generalElectives") continue;
          if (current.kind.type === "choose") ranges.push(...current.kind.ranges);
          if (isWriting) continue;
          for (const use of this.used.get(rule.id) ?? []) counted.set(use.id, use);
        }
      }
    }
    for (const use of this.pool.values()) {
      if (counted.has(use.id)) continue;
      if (this.courseInRange(use.key, ranges)) counted.set(use.id, use);
    }
    const completed = [...counted.values()].filter(courseUseIsCompleted).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const planned = [...counted.values()].filter((use) => !courseUseIsCompleted(use)).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const standing = hoursStatus(completed, planned, required);
    return noteItem(sectionID, note, { type: "majorHours", required }, standing.status, standing.detail, "Semester hours in the major");
  }

  private coopCheck(sectionID: string, note: string): NoteCheck {
    const coops = [...this.pool.values()].filter(isCoopCourse).sort((a, b) => a.order - b.order);
    let status: AuditStatus;
    let detail: string;
    const done = coops.find(courseUseIsCompleted);
    const next = coops[0];
    if (done) {
      status = "complete";
      detail = `${keyId(done.key)} completed`;
    } else if (next) {
      status = "planned";
      detail = `${keyId(next.key)} planned${next.semester ? `${DOT}${next.semester}` : ""}`;
    } else {
      status = "missing";
      detail = "No co-op in the plan";
      const path = satisfiedThroughCoop(note);
      if (path) {
        const course = this.sortedPool()
          .filter((use) => this.nupaths(use)?.has(path))
          .sort((a, b) => (courseUseIsCompleted(a) ? 0 : 1) - (courseUseIsCompleted(b) ? 0 : 1) || a.order - b.order)[0];
        if (course) {
          status = courseUseIsCompleted(course) ? "complete" : "planned";
          detail = `No co-op in the plan${DOT}${keyId(course.key)} (${path.short}) ${courseUseIsCompleted(course) ? "completed" : "planned"}`;
        }
      }
    }
    return noteItem(sectionID, note, { type: "coop" }, status, detail, "Co-op");
  }

  private sortedPool(): CourseUse[] {
    return [...this.pool.values()].sort((a, b) => a.order - b.order);
  }

  private nupaths(use: CourseUse): Set<NuPathInfo> | null {
    if (use.crn) {
      const specific = this.attributes.nupaths.get(`${keyId(use.key)}#${use.crn}`);
      if (specific) return nuPathSet(specific);
    }
    const own = this.attributes.nupaths.get(keyId(use.key));
    if (own) return nuPathSet(own);
    if (isCoopCourse(use)) return new Set();
    for (const other of this.equivalences.groupOf(use.key)) {
      if (sameKey(other, use.key)) continue;
      const paths = this.attributes.nupaths.get(keyId(other));
      if (paths) return nuPathSet(paths);
    }
    return null;
  }

  private nupathCheck(sectionID: string, note: string): NoteCheck | null {
    if (attributesAreEmpty(this.attributes)) return null;
    const uses = this.sortedPool();
    const courses: NUpathCourse[] = [];
    const unknown: CourseUse[] = [];
    for (const use of uses) {
      const paths = this.nupaths(use);
      if (!paths) {
        unknown.push(use);
        continue;
      }
      if (paths.size > 0) courses.push({ id: use.id, paths, isCompleted: courseUseIsCompleted(use) });
    }
    const coops = uses.filter(isCoopCourse).map((use) => ({ id: use.id, paths: new Set<NuPathInfo>(), isCompleted: courseUseIsCompleted(use) }));
    const coopCounts = new Map<string, NUpathCourse[]>();
    if (coops.length > 0) {
      for (const section of this.requirements.sections) {
        for (const text of [...section.notes, ...section.groups.flatMap((group) => group.notes)]) {
          const path = satisfiedThroughCoop(text);
          if (path) coopCounts.set(path.short, coops);
        }
      }
    }
    const matching = new NUpathMatching(courses, NUPATH_REQUIREMENTS, coopCounts);
    const isLoading = unknown.some((use) => this.attributes.loading.has(keyId(use.key)));
    const items: NoteItem[] = [];
    for (const requirement of NUPATH_REQUIREMENTS) {
      const chosen = matching.coursesFor(requirement.path).flatMap((id) => {
        const use = this.pool.get(id);
        return use ? [use] : [];
      });
      let status: AuditStatus | null;
      let detail: string;
      if (chosen.length >= requirement.count) {
        status = chosen.every(courseUseIsCompleted) ? "complete" : "planned";
        detail = describeUses(chosen);
      } else {
        status = unknown.length === 0 ? (chosen.length === 0 ? "missing" : "partial") : null;
        const found = chosen.length === 0 ? "" : `${chosen.length} of ${requirement.count}${DOT}${describeUses(chosen)}`;
        if (status == null) detail = found || (isLoading ? "Looking up the plan\u2019s courses\u2026" : "Not found among the courses with NUpath data");
        else if (chosen.length === 0) detail = requirement.count === 1 ? "No course in the plan has it" : `Needs ${requirement.count} courses`;
        else detail = found;
      }
      items.push({ id: requirement.path.code, title: nupathTitle(requirement), status, detail, courses: chosen.map((use) => courseUseName(use)) });
    }
    const met = items.filter((item) => item.status != null && statusIsSatisfied(item.status));
    const open = items.filter((item) => item.status == null || !statusIsSatisfied(item.status));
    const status: AuditStatus = open.length === 0
      ? (met.every((item) => item.status === "complete") ? "complete" : "planned")
      : (met.length === 0 && items.every((item) => item.courses.length === 0) ? "missing" : "partial");
    let detail = `${met.length} of ${items.length} met`;
    const missing = items.filter((item) => item.status === "missing" || item.status === "partial");
    if (missing.length > 0 && missing.length <= 3) {
      detail += `${DOT}missing ${missing.map((item) => NU_SHORT.get(item.id) ?? item.title).join(", ")}`;
    }
    if (unknown.length > 0 && items.some((item) => item.status == null)) {
      const names = unknown.slice(0, 3).map((use) => keyId(use.key)).join(", ");
      detail += isLoading
        ? `${DOT}looking up ${unknown.length === 1 ? "1 course" : `${unknown.length} courses`}`
        : `${DOT}no NUpath data for ${names}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ""}`;
    }
    return {
      ...noteItem(sectionID, note, { type: "nupath" }, status, detail, "NUpath requirements"),
      items,
      counts: !items.some((item) => item.status == null),
    };
  }

  private universitywideCheck(sectionID: string, note: string): NoteCheck | null {
    const minimums = this.requirements.universitywide;
    if (!minimums) return null;
    const completed = [...this.pool.values()].filter(courseUseIsCompleted).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const planned = [...this.pool.values()].filter((use) => !courseUseIsCompleted(use)).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const items: NoteItem[] = [];
    if (minimums.totalHours != null) {
      const standing = hoursStatus(completed, planned, minimums.totalHours);
      items.push({ id: "total-hours", title: `${creditNumber(minimums.totalHours)} total semester hours`, status: standing.status, detail: standing.detail, courses: [] });
    }
    if (minimums.requiresExperientialLearning) {
      const coops = this.sortedPool().filter(isCoopCourse);
      const coop = coops.find(courseUseIsCompleted) ?? coops[0];
      items.push({
        id: "experiential",
        title: "Experiential learning",
        status: coop ? (courseUseIsCompleted(coop) ? "complete" : "planned") : null,
        detail: coop ? describeUses([coop]) : "Not checked: only co-ops are recognized",
        courses: coop ? [coop.id] : [],
      });
    }
    if (minimums.gpa != null) {
      items.push({
        id: "gpa",
        title: `${formatGpa(minimums.gpa)} GPA`,
        status: null,
        detail: "Not checked: plans don\u2019t include grades",
        courses: [],
      });
    }
    if (minimums.residencyHours != null) {
      items.push({
        id: "residency",
        title: `${creditNumber(minimums.residencyHours)} semester hours at Northeastern`,
        status: null,
        detail: "Not checked: a plan doesn\u2019t say where credits were earned",
        courses: [],
      });
    }
    const checked = items.filter((item) => item.status != null);
    const statuses = checked.flatMap((item) => (item.status ? [item.status] : []));
    if (statuses.length === 0) return null;
    const names: Record<string, string> = { experiential: "experiential learning", gpa: "GPA", residency: "residency" };
    const unchecked = items.filter((item) => item.status == null).flatMap((item) => (names[item.id] ? [names[item.id]!] : []));
    let detail = checked.map((item) => item.detail).join(DOT);
    if (unchecked.length > 0) detail += `${DOT}${joinAnd(unchecked)} not checked`;
    return {
      ...noteItem(sectionID, note, { type: "universitywide" }, minStatus(statuses), detail, "Universitywide requirements"),
      items,
    };
  }

  private totalHoursCheck(sectionID: string, note: string, required: number): NoteCheck {
    const completed = [...this.pool.values()].filter(courseUseIsCompleted).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const planned = [...this.pool.values()].filter((use) => !courseUseIsCompleted(use)).reduce((sum, use) => sum + Math.max(0, use.credits), 0);
    const standing = hoursStatus(completed, planned, required);
    return noteItem(sectionID, note, { type: "totalHours", required }, standing.status, standing.detail, "Total semester hours");
  }

  private trimSurplusHours(): void {
    for (const rule of this.rules) {
      const current = this.effective.get(rule.id);
      if (current?.type !== "kind" || current.kind.type !== "choose" || current.kind.count != null || current.kind.hours == null) continue;
      if (!this.choiceIsSatisfied(rule.id)) continue;
      const hours = current.kind.hours;
      const uses = this.used.get(rule.id) ?? [];
      const movable = uses.filter((use) => !use.bySubstitution && (this.singles.get(rule.id)?.has(use.id) ?? false));
      const movableIDs = new Set(movable.map((use) => use.id));
      const fixed = uses.filter((use) => !movableIDs.has(use.id)).reduce((sum, use) => sum + use.credits, 0);
      const unused = this.remaining().flatMap((use) => {
        const named = this.singleMatch(use, rule.id);
        return named ? [{ use, named }] : [];
      });
      const keep = fewestCredits([...movable, ...unused.map((item) => item.use)], hours - fixed);
      if (!keep) continue;
      for (const use of movable) if (!keep.has(use.id)) this.release(use.id, rule.id);
      for (const item of unused) if (keep.has(item.use.id)) this.place(item.use.id, rule.id, item.named);
    }
  }

  private rebalance(): void {
    for (const rule of this.rules) {
      if (this.choiceIsSatisfied(rule.id)) continue;
      const budget = { n: 2000 };
      moves: while (!this.choiceIsSatisfied(rule.id)) {
        for (const steps of [0, 1, 2, 3]) {
          const next = this.adding(rule.id, 0, steps, new Set([rule.id]), budget);
          if (next) {
            this.adopt(next);
            continue moves;
          }
        }
        break;
      }
    }
  }

  private adding(ruleID: string, minCredits: number, steps: number, avoiding: Set<string>, budget: { n: number }): AuditEngine | null {
    for (const use of this.remaining()) {
      if (use.credits < minCredits) continue;
      const named = this.singleMatch(use, ruleID);
      if (!named) continue;
      const next = this.clone();
      next.place(use.id, ruleID, named);
      return next;
    }
    if (steps <= 0) return null;
    for (const donor of this.rules) {
      if (avoiding.has(donor.id) || !this.choiceIsSatisfied(donor.id)) continue;
      for (const use of this.used.get(donor.id) ?? []) {
        if (use.credits < minCredits || !(this.singles.get(donor.id)?.has(use.id) ?? false)) continue;
        if (budget.n <= 0) return null;
        budget.n -= 1;
        const named = this.singleMatch(use, ruleID);
        if (!named) continue;
        const next = this.clone();
        next.release(use.id, donor.id);
        next.place(use.id, ruleID, named);
        if (next.choiceIsSatisfied(donor.id)) return next;
        const refilled = next.adding(donor.id, next.shortfall(donor.id), steps - 1, new Set([...avoiding, ruleID, donor.id]), budget);
        if (refilled && refilled.choiceIsSatisfied(donor.id)) return refilled;
      }
    }
    for (const donor of this.rules) {
      if (avoiding.has(donor.id)) continue;
      const current = this.effective.get(donor.id);
      if (current?.type !== "kind" || current.kind.type !== "required" || current.kind.option.alternatives.length <= 1) continue;
      const held = this.used.get(donor.id) ?? [];
      if (held.length === 0 || held.some((use) => use.bySubstitution)) continue;
      for (const use of held) {
        if (use.credits < minCredits) continue;
        if (budget.n <= 0) return null;
        budget.n -= 1;
        const named = this.singleMatch(use, ruleID);
        if (!named) continue;
        const next = this.clone();
        next.releaseAll(donor.id);
        next.available.delete(use.id);
        const complete = current.kind.option.alternatives.filter((alternative) => next.isComplete(alternative));
        const best = minBy(complete, (alternative) => next.score(alternative));
        if (!best) continue;
        const pairs = next.assign(best);
        next.available.add(use.id);
        for (const pair of pairs) next.consume(pair.taken, donor.id, false, pair.required);
        next.place(use.id, ruleID, named);
        return next;
      }
    }
    return null;
  }

  private singleMatch(use: CourseUse, ruleID: string): CourseKey | null {
    const current = this.effective.get(ruleID);
    if (current?.type !== "kind" || current.kind.type !== "choose") return null;
    const { count, options, ranges } = current.kind;
    if (count == null && use.credits <= 0) return null;
    const counted = new Set((this.used.get(ruleID) ?? []).map((item) => keyId(item.satisfies ?? item.key)));
    for (const option of options) {
      if (optionCourses(option).some((key) => counted.has(keyId(key)))) continue;
      for (const alternative of option.alternatives) {
        const only = alternative[0];
        if (alternative.length === 1 && only && this.equivalences.areEquivalent(only, use.key)) return only;
      }
    }
    if (use.credits <= 0 || (count != null && use.credits < 2)) return null;
    if (current.anyCourse) return use.key;
    return ranges.length === 0 ? null : this.courseInRange(use.key, ranges);
  }

  private choiceIsSatisfied(ruleID: string): boolean {
    const current = this.effective.get(ruleID);
    if (current?.type !== "kind" || current.kind.type !== "choose") return true;
    return this.isSatisfied(ruleID, current.kind.count, current.kind.hours);
  }

  private shortfall(ruleID: string): number {
    const current = this.effective.get(ruleID);
    if (current?.type !== "kind" || current.kind.type !== "choose" || current.kind.count != null || current.kind.hours == null) return 0;
    const have = (this.used.get(ruleID) ?? []).reduce((sum, use) => sum + use.credits, 0);
    return Math.max(0, current.kind.hours - have);
  }

  private place(id: string, ruleID: string, named: CourseKey): void {
    this.consume(id, ruleID, false, named);
    this.optionsCounted.set(ruleID, (this.optionsCounted.get(ruleID) ?? 0) + 1);
    this.addSingle(ruleID, id);
  }

  private release(id: string, ruleID: string): void {
    const list = this.used.get(ruleID);
    if (!list) return;
    const index = list.findIndex((use) => use.id === id);
    if (index < 0) return;
    list.splice(index, 1);
    this.optionsCounted.set(ruleID, (this.optionsCounted.get(ruleID) ?? 0) - 1);
    this.singles.get(ruleID)?.delete(id);
    this.available.add(id);
  }

  private releaseAll(ruleID: string): void {
    for (const use of this.used.get(ruleID) ?? []) this.available.add(use.id);
    this.used.set(ruleID, []);
    this.optionsCounted.set(ruleID, 0);
    this.singles.set(ruleID, new Set());
  }

  private isSatisfied(ruleID: string, count: number | null | undefined, hours: number | null | undefined): boolean {
    const counted = this.optionsCounted.get(ruleID) ?? 0;
    if (count != null) return counted >= count;
    if (hours != null) return (this.used.get(ruleID) ?? []).reduce((sum, use) => sum + use.credits, 0) >= hours;
    return counted >= 1;
  }

  private score(alternative: readonly CourseKey[]): [number, number] {
    const taken = this.assign(alternative).flatMap((pair) => {
      const use = this.pool.get(pair.taken);
      return use ? [use] : [];
    });
    const planned = taken.filter((use) => !courseUseIsCompleted(use)).length;
    const contested = taken.reduce((sum, use) => sum + this.contest(use.key), 0);
    return [planned, contested];
  }

  private contest(key: CourseKey): number {
    return this.equivalences.groupOf(key).reduce((sum, item) => sum + (this.demand.get(keyId(item)) ?? 0), 0);
  }

  private consume(id: string, ruleID: string, bySubstitution = false, required?: CourseKey | null): void {
    if (!this.available.has(id)) return;
    const use = this.pool.get(id);
    if (!use) return;
    const placed: CourseUse = {
      ...use,
      bySubstitution,
      satisfies: required && !sameKey(required, use.key) ? required : undefined,
    };
    this.available.delete(id);
    const list = this.used.get(ruleID) ?? [];
    list.push(placed);
    this.used.set(ruleID, list);
  }

  /** The named plan row, when it is still available and is that course. A sibling row is not a substitute. */
  private rowStandIn(rowID: string, course: CourseKey): string | null {
    if (!this.available.has(rowID)) return null;
    const use = this.pool.get(rowID);
    if (!use || !sameKey(use.key, course)) return null;
    return rowID;
  }

  private standIn(required: CourseKey, claimed: ReadonlySet<string> = new Set()): string | null {
    const free = (id: string) => this.available.has(id) && !claimed.has(id);
    const own = (this.instances.get(keyId(required)) ?? []).filter(free).sort((a, b) => (this.comesFirst(a, b) ? -1 : 1))[0];
    if (own) return own;
    if (this.equivalences.isEmpty) return null;
    const equivalents = this.equivalences.equivalentsOf(required).flatMap((key) => this.instances.get(keyId(key)) ?? []).filter(free);
    equivalents.sort((a, b) => (this.comesFirst(a, b) ? -1 : 1));
    return equivalents[0] ?? null;
  }

  private comesFirst(a: string, b: string): boolean {
    const left = this.pool.get(a);
    const right = this.pool.get(b);
    const first = [left && courseUseIsCompleted(left) ? 0 : 1, left?.order ?? Number.MAX_SAFE_INTEGER] as const;
    const second = [right && courseUseIsCompleted(right) ? 0 : 1, right?.order ?? Number.MAX_SAFE_INTEGER] as const;
    if (first[0] !== second[0]) return first[0] < second[0];
    if (first[1] !== second[1]) return first[1] < second[1];
    return a < b;
  }

  private assign(alternative: readonly CourseKey[]): { required: CourseKey; taken: string }[] {
    const named = new Set<string>();
    const claimed = new Set<string>();
    const matches: { required: CourseKey; taken: string }[] = [];
    for (const required of alternative) {
      const id = keyId(required);
      if (named.has(id)) continue;
      named.add(id);
      const taken = this.standIn(required, claimed);
      if (!taken) continue;
      claimed.add(taken);
      matches.push({ required, taken });
    }
    return matches;
  }

  private isComplete(alternative: readonly CourseKey[]): boolean {
    const unique = new Set(alternative.map(keyId));
    return this.assign(alternative).length === unique.size;
  }

  private courseInRange(key: CourseKey, ranges: readonly CourseRange[]): CourseKey | null {
    if (ranges.some((range) => rangeContains(range, key))) return key;
    return this.equivalences.equivalentsOf(key).find((equivalent) => ranges.some((range) => rangeContains(range, equivalent))) ?? null;
  }

  private remaining(): CourseUse[] {
    return [...this.available].flatMap((id) => {
      const use = this.pool.get(id);
      return use ? [use] : [];
    }).sort((a, b) => (courseUseIsCompleted(a) ? 0 : 1) - (courseUseIsCompleted(b) ? 0 : 1) || a.order - b.order);
  }

  private addSingle(ruleID: string, id: string): void {
    const set = this.singles.get(ruleID) ?? new Set<string>();
    set.add(id);
    this.singles.set(ruleID, set);
  }

  private result(rule: RequirementRule): RuleResult {
    const uses = this.used.get(rule.id) ?? [];
    const substitutions = this.substitutionsByRule.get(rule.id) ?? [];
    const current = this.effective.get(rule.id);
    if (current?.type !== "kind") {
      return { rule, effectiveKind: null, status: "waived", used: [], substitutions, id: rule.id };
    }
    const hoursDone = uses.reduce((sum, use) => sum + use.credits, 0);
    let satisfied = false;
    let remainingCount: number | undefined;
    let remainingHours: number | undefined;
    if (current.kind.type === "required") {
      const keys = new Set(uses.map((use) => keyId(use.satisfies ?? use.key)));
      satisfied = uses.some((use) => use.bySubstitution) || current.kind.option.alternatives.some((alternative) => alternative.every((key) => keys.has(keyId(key))));
    } else if (current.kind.type === "choose") {
      satisfied = this.isSatisfied(rule.id, current.kind.count, current.kind.hours);
      if (current.kind.count != null) remainingCount = Math.max(0, current.kind.count - (this.optionsCounted.get(rule.id) ?? 0));
      else if (current.kind.hours != null) remainingHours = Math.max(0, current.kind.hours - hoursDone);
      else remainingCount = satisfied ? 0 : 1;
    } else {
      satisfied = hoursDone >= current.kind.hours;
      remainingHours = Math.max(0, current.kind.hours - hoursDone);
    }
    const status: AuditStatus = satisfied ? (uses.every(courseUseIsCompleted) ? "complete" : "planned") : (uses.length === 0 ? "missing" : "partial");
    return { rule, effectiveKind: current.kind, status, used: uses, remainingCount, remainingHours, substitutions, id: rule.id };
  }

  private isMet(ruleID: string): boolean {
    const current = this.effective.get(ruleID);
    if (!current || current.type === "waived") return true;
    if (current.kind.type === "required") {
      const uses = this.used.get(ruleID) ?? [];
      const keys = new Set(uses.map((use) => keyId(use.satisfies ?? use.key)));
      return uses.some((use) => use.bySubstitution) || current.kind.option.alternatives.some((alternative) => alternative.every((key) => keys.has(keyId(key))));
    }
    if (current.kind.type === "choose") return this.isSatisfied(ruleID, current.kind.count, current.kind.hours);
    return (this.used.get(ruleID) ?? []).reduce((sum, use) => sum + use.credits, 0) >= current.kind.hours;
  }

  private ensureBestMatching(): boolean {
    const pinned = new Set([...this.used.values()].flatMap((uses) => uses.filter((use) => use.bySubstitution).map((use) => use.id)));
    const free = [...this.pool.keys()].filter((id) => !pinned.has(id)).sort((a, b) => (this.comesFirst(a, b) ? -1 : 1));
    if (free.length === 0 || free.length > CourseBits.capacity) return false;
    const index = new Map(free.map((id, position) => [id, position]));
    const credits = free.map((id) => Math.max(0, this.pool.get(id)?.credits ?? 0));
    let all = new CourseBits();
    for (let i = 0; i < free.length; i += 1) all = all.union(CourseBits.of(i));
    const needs: Need[] = [];
    const electives: number[] = [];
    for (const rule of this.rules) {
      const current = this.effective.get(rule.id);
      if (!current || current.type === "waived") continue;
      if (current.kind.type === "generalElectives") {
        const counted = (this.used.get(rule.id) ?? []).filter((use) => use.bySubstitution).reduce((sum, use) => sum + use.credits, 0);
        if (counted < current.kind.hours) electives.push(current.kind.hours - counted);
      } else {
        const need = this.need(rule.id, current.kind, current.anyCourse, free, index);
        if (need) needs.push(need);
      }
    }
    const electiveScale = this.rules.length + 1;
    const electivesMet = (available: CourseBits) => {
      if (electives.length === 0) return 0;
      let left = 0;
      for (let i = 0; i < free.length; i += 1) if (available.has(i)) left += credits[i]!;
      let met = 0;
      for (const hours of electives) {
        if (left < hours) continue;
        met += 1;
        left -= hours;
      }
      return met;
    };
    let now = new CourseBits();
    for (const id of this.available) {
      const position = index.get(id);
      if (position != null) now = now.union(CourseBits.of(position));
    }
    const currentSpecific = needs.filter((need) => this.isMet(need.ruleID)).length;
    const currentElectives = electivesMet(now);
    const current = currentSpecific * electiveScale + currentElectives;
    const mayImprove = needs.some((need) => !this.isMet(need.ruleID) && canStillMeet(need, all, credits)) || electivesMet(all) > electivesMet(now);
    if (!mayImprove) return false;
    const order = needs.map((_, position) => position).sort((a, b) => {
      const left = fillsFor(needs[a]!, all, 400).length;
      const right = fillsFor(needs[b]!, all, 400).length;
      return left - right || a - b;
    });
    let best: Map<number, number[]> | null = null;
    let bestScore = current;
    let bestSpecific = currentSpecific;
    let bestElectives = currentElectives;
    const chosen = new Map<number, number[]>();
    const visited = new Map<string, number>();
    let nodes = 0;
    const budget = 20_000;
    const visit = (depth: number, available: CourseBits, met: number) => {
      nodes += 1;
      if (nodes > budget) return;
      const key = `${depth}:${available.low}:${available.high}`;
      const earlier = visited.get(key);
      if (earlier != null && earlier >= met) return;
      visited.set(key, met);
      let optimistic = met;
      for (const later of order.slice(depth)) {
        if (canStillMeet(needs[later]!, available, credits)) optimistic += 1;
      }
      const electivesAtBest = electivesMet(available);
      if (optimistic * electiveScale + electivesAtBest <= bestScore) return;
      if (depth >= order.length) {
        bestScore = optimistic * electiveScale + electivesAtBest;
        bestSpecific = optimistic;
        bestElectives = electivesAtBest;
        best = new Map(chosen);
        return;
      }
      const n = order[depth]!;
      for (const fill of fillsFor(needs[n]!, available, 400)) {
        let taken = new CourseBits();
        for (const unit of fill) taken = taken.union(needs[n]!.units[unit]!.bits);
        chosen.set(n, fill);
        visit(depth + 1, available.subtracting(taken), met + 1);
        chosen.delete(n);
        if (nodes > budget) return;
      }
      visit(depth + 1, available, met);
    };
    visit(0, all, 0);
    if (!best) return false;
    const meetsEverything = bestSpecific === needs.length && bestElectives === electives.length;
    if (!(bestSpecific > currentSpecific || meetsEverything)) return false;
    this.adoptMatching(best, needs, free);
    return true;
  }

  private need(ruleID: string, kind: RequirementKind, anyCourse: boolean, free: readonly string[], index: Map<string, number>): Need | null {
    const pinned = (this.used.get(ruleID) ?? []).filter((use) => use.bySubstitution);
    if (kind.type === "required") {
      if (pinned.length > 0) return null;
      const units = kind.option.alternatives.flatMap((alternative) => this.assignments(alternative, free).map((pairs) => this.unit(pairs, 0, index)));
      units.sort(preferredUnit);
      return { ruleID, amount: { type: "alternative" }, units };
    }
    if (kind.type === "generalElectives") return null;
    const counted = new Set(pinned.map((use) => keyId(use.satisfies ?? use.key)));
    const units: Unit[] = [];
    kind.options.forEach((option, number) => {
      if (optionCourses(option).some((key) => counted.has(keyId(key)))) return;
      for (const alternative of option.alternatives) {
        for (const pairs of this.assignments(alternative, free)) units.push(this.unit(pairs, number, index));
      }
    });
    if (kind.ranges.length > 0 || anyCourse) {
      let tag = kind.options.length;
      for (const id of free) {
        const use = this.pool.get(id);
        if (!use || use.credits <= 0 || (kind.count != null && use.credits < 2)) continue;
        const named = anyCourse ? use.key : this.courseInRange(use.key, kind.ranges);
        if (!named) continue;
        units.push(this.unit([{ named, taken: id }], tag, index));
        tag += 1;
      }
    }
    let amount: NeedAmount;
    if (kind.count != null) {
      if (kind.count - pinned.length <= 0) return null;
      amount = { type: "count", count: kind.count - pinned.length };
    } else if (kind.hours != null) {
      const left = kind.hours - pinned.reduce((sum, use) => sum + use.credits, 0);
      if (left <= 0) return null;
      amount = { type: "hours", hours: left };
      for (let i = units.length - 1; i >= 0; i -= 1) if (units[i]!.credits <= 0) units.splice(i, 1);
    } else {
      if (pinned.length > 0) return null;
      amount = { type: "count", count: 1 };
    }
    units.sort(preferredUnit);
    return { ruleID, amount, units };
  }

  private assignments(alternative: readonly CourseKey[], free: readonly string[]): { named: CourseKey; taken: string }[][] {
    const freeSet = new Set(free);
    const seen = new Set<string>();
    const named = alternative.filter((key) => {
      const id = keyId(key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const results: { named: CourseKey; taken: string }[][] = [];
    const current: { named: CourseKey; taken: string }[] = [];
    const claimed = new Set<string>();
    const extend = (position: number) => {
      if (results.length >= 4) return;
      if (position >= named.length) {
        results.push(current.slice());
        return;
      }
      const key = named[position]!;
      const candidates = [
        ...(this.instances.get(keyId(key)) ?? []),
        ...this.equivalentsSorted(key).flatMap((equivalent) => this.instances.get(keyId(equivalent)) ?? []),
      ].filter((id) => freeSet.has(id) && !claimed.has(id));
      for (const id of candidates) {
        current.push({ named: key, taken: id });
        claimed.add(id);
        extend(position + 1);
        claimed.delete(id);
        current.pop();
      }
    };
    extend(0);
    return results;
  }

  private equivalentsSorted(key: CourseKey): CourseKey[] {
    return [...this.equivalences.equivalentsOf(key)].sort(compareCourseKeys);
  }

  private unit(pairs: { named: CourseKey; taken: string }[], option: number, index: Map<string, number>): Unit {
    const uses = pairs.flatMap((pair) => {
      const use = this.pool.get(pair.taken);
      return use ? [use] : [];
    });
    let bits = new CourseBits();
    for (const pair of pairs) {
      const position = index.get(pair.taken);
      if (position != null) bits = bits.union(CourseBits.of(position));
    }
    return {
      courses: pairs.map((pair) => pair.taken),
      named: pairs.map((pair) => pair.named),
      bits,
      option,
      credits: uses.reduce((sum, use) => sum + Math.max(0, use.credits), 0),
      isCompleted: uses.every(courseUseIsCompleted),
      order: uses.reduce((min, use) => Math.min(min, use.order), Number.MAX_SAFE_INTEGER),
    };
  }

  private adoptMatching(fills: Map<number, number[]>, needs: readonly Need[], free: readonly string[]): void {
    for (const need of needs) {
      const pinnedUses = (this.used.get(need.ruleID) ?? []).filter((use) => use.bySubstitution);
      this.used.set(need.ruleID, pinnedUses);
      this.optionsCounted.set(need.ruleID, pinnedUses.length);
      this.singles.set(need.ruleID, new Set());
    }
    this.available = new Set(free);
    for (const [n, chosen] of fills) {
      const need = needs[n];
      if (!need) continue;
      for (const position of chosen) {
        const unit = need.units[position];
        if (!unit) continue;
        for (let i = 0; i < unit.courses.length; i += 1) this.consume(unit.courses[i]!, need.ruleID, false, unit.named[i]);
        this.optionsCounted.set(need.ruleID, (this.optionsCounted.get(need.ruleID) ?? 0) + 1);
        if (unit.courses.length === 1 && unit.courses[0]) this.addSingle(need.ruleID, unit.courses[0]);
      }
    }
  }
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function minBy<T>(items: readonly T[], score: (item: T) => readonly [number, number]): T | null {
  let best: T | null = null;
  let bestScore: readonly [number, number] | null = null;
  for (const item of items) {
    const next = score(item);
    if (!bestScore || next[0] < bestScore[0] || (next[0] === bestScore[0] && next[1] < bestScore[1])) {
      best = item;
      bestScore = next;
    }
  }
  return best;
}

function hoursStanding(completed: number, planned: number, required: number): AuditStatus {
  if (completed >= required) return "complete";
  if (completed + planned >= required) return "planned";
  if (completed + planned > 0) return "partial";
  return "missing";
}

/**
 * How a semester-hour minimum stands, for the university minimum, the program total, and
 * hours in the major. The first number is `completed` alone. It is not `completed + planned`.
 */
export function hoursStatus(completed: number, planned: number, required: number): { status: AuditStatus; detail: string } {
  let detail = `${creditNumber(completed)} of ${creditNumber(required)} semester hours`;
  if (planned > 0) detail += `${DOT}${creditNumber(planned)} planned`;
  return { status: hoursStanding(completed, planned, required), detail };
}

function describeUses(uses: readonly CourseUse[]): string {
  return uses.map((use) => courseUseIsCompleted(use)
    ? `${keyId(use.key)} completed`
    : `${keyId(use.key)} planned${use.semester ? `${DOT}${use.semester}` : ""}`).join(DOT);
}

function noteItem(sectionID: string, note: string, kind: NoteKind, status: AuditStatus, detail: string, title: string): NoteCheck {
  return { sectionID, note, kind, status, detail, items: [], counts: true, id: `${sectionID}|${note}`, title };
}

function formatGpa(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const text = rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return text.includes(".") ? text : `${text}.0`;
}

const NU_SHORT = new Map(NUPATH_REQUIREMENTS.map((requirement) => [requirement.path.code, requirement.path.short]));

export function fewestCredits(uses: readonly CourseUse[], need: number): Set<string> | null {
  if (need <= 0) return new Set();
  const items = uses.filter((use) => use.credits > 0);
  const weights = items.map((use) => Math.max(1, Math.round(use.credits * 2)));
  const target = Math.ceil(need * 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const largest = weights.reduce((max, weight) => Math.max(max, weight), 0);
  if (total < target || largest === 0) return null;
  const cap = target + largest;
  interface Pick { completed: number; count: number; order: number; items: number[] }
  const best: (Pick | null)[] = Array.from({ length: cap + 1 }, () => null);
  best[0] = { completed: 0, count: 0, order: 0, items: [] };
  const better = (pick: Pick, other: Pick) => {
    if (pick.completed !== other.completed) return pick.completed > other.completed;
    if (pick.count !== other.count) return pick.count < other.count;
    return pick.order < other.order;
  };
  items.forEach((item, index) => {
    const weight = weights[index]!;
    if (weight > cap) return;
    for (let sum = cap; sum >= weight; sum -= 1) {
      const prev = best[sum - weight];
      if (!prev) continue;
      const pick: Pick = {
        completed: prev.completed + (courseUseIsCompleted(item) ? 1 : 0),
        count: prev.count + 1,
        order: prev.order + item.order,
        items: [...prev.items, index],
      };
      const current = best[sum];
      if (current && !better(pick, current)) continue;
      best[sum] = pick;
    }
  });
  for (let sum = target; sum <= cap; sum += 1) {
    const pick = best[sum];
    if (pick) return new Set(pick.items.map((index) => items[index]!.id));
  }
  return null;
}

class CourseBits {
  static readonly capacity = 128;
  low = 0n;
  high = 0n;

  static of(index: number): CourseBits {
    const bits = new CourseBits();
    if (index < 64) bits.low = 1n << BigInt(index);
    else bits.high = 1n << BigInt(index - 64);
    return bits;
  }

  contains(other: CourseBits): boolean {
    return (this.low & other.low) === other.low && (this.high & other.high) === other.high;
  }

  intersects(other: CourseBits): boolean {
    return (this.low & other.low) !== 0n || (this.high & other.high) !== 0n;
  }

  has(index: number): boolean {
    return index < 64 ? (this.low & (1n << BigInt(index))) !== 0n : (this.high & (1n << BigInt(index - 64))) !== 0n;
  }

  union(other: CourseBits): CourseBits {
    const result = new CourseBits();
    result.low = this.low | other.low;
    result.high = this.high | other.high;
    return result;
  }

  subtracting(other: CourseBits): CourseBits {
    const result = new CourseBits();
    result.low = this.low & ~other.low;
    result.high = this.high & ~other.high;
    return result;
  }
}

interface Unit {
  courses: string[];
  named: CourseKey[];
  bits: CourseBits;
  option: number;
  credits: number;
  isCompleted: boolean;
  order: number;
}

type NeedAmount = { type: "alternative" } | { type: "count"; count: number } | { type: "hours"; hours: number };

interface Need {
  ruleID: string;
  amount: NeedAmount;
  units: Unit[];
}

function preferredUnit(a: Unit, b: Unit): number {
  const left = [a.isCompleted ? 0 : 1, a.courses.length, a.order] as const;
  const right = [b.isCompleted ? 0 : 1, b.courses.length, b.order] as const;
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function fillsFor(need: Need, available: CourseBits, limit: number): number[][] {
  const usable = need.units.flatMap((unit, index) => (available.contains(unit.bits) ? [index] : []));
  const result: number[][] = [];
  const chosen: number[] = [];
  if (need.amount.type === "alternative") return usable.slice(0, limit).map((index) => [index]);
  if (need.amount.type === "count") {
    const wanted = need.amount.count;
    const pick = (start: number, taken: CourseBits, options: Set<number>) => {
      if (chosen.length === wanted) {
        result.push(chosen.slice());
        return;
      }
      if (usable.length - start < wanted - chosen.length) return;
      for (let position = start; position < usable.length && result.length < limit; position += 1) {
        const unit = need.units[usable[position]!]!;
        if (taken.intersects(unit.bits) || options.has(unit.option)) continue;
        chosen.push(usable[position]!);
        pick(position + 1, taken.union(unit.bits), new Set([...options, unit.option]));
        chosen.pop();
      }
    };
    pick(0, new CourseBits(), new Set());
    return result;
  }
  const wanted = need.amount.hours;
  const later = new Array<number>(usable.length + 1).fill(0);
  for (let position = usable.length - 1; position >= 0; position -= 1) {
    later[position] = later[position + 1]! + need.units[usable[position]!]!.credits;
  }
  const pick = (start: number, taken: CourseBits, options: Set<number>, earned: number) => {
    if (earned >= wanted) {
      if (chosen.every((index) => earned - need.units[index]!.credits < wanted)) result.push(chosen.slice());
      return;
    }
    if (earned + (later[start] ?? 0) < wanted) return;
    for (let position = start; position < usable.length && result.length < limit; position += 1) {
      const unit = need.units[usable[position]!]!;
      if (taken.intersects(unit.bits) || options.has(unit.option)) continue;
      chosen.push(usable[position]!);
      pick(position + 1, taken.union(unit.bits), new Set([...options, unit.option]), earned + unit.credits);
      chosen.pop();
    }
  };
  pick(0, new CourseBits(), new Set(), 0);
  return result;
}

function canStillMeet(need: Need, available: CourseBits, credits: readonly number[]): boolean {
  if (need.amount.type === "alternative") return need.units.some((unit) => available.contains(unit.bits));
  if (need.amount.type === "count") {
    const options = new Set<number>();
    for (const unit of need.units) {
      if (!available.contains(unit.bits)) continue;
      options.add(unit.option);
      if (options.size >= need.amount.count) return true;
    }
    return false;
  }
  let covered = new CourseBits();
  for (const unit of need.units) if (available.contains(unit.bits)) covered = covered.union(unit.bits);
  let sum = 0;
  for (let index = 0; index < credits.length; index += 1) if (covered.has(index)) sum += credits[index]!;
  return sum >= need.amount.hours;
}
