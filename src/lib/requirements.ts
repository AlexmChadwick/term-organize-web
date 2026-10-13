/**
 * Academic-catalog requirement types and degree-plan records.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of ProgramCatalogModels.swift and the degree-plan half of UserModels.swift.
 */

import type { CourseKey } from "./models";
import { compareCourseKeys, keyId } from "./models";

export interface CatalogYear {
  startYear: number;
}

export function catalogYearSlug(year: CatalogYear): string {
  return `${year.startYear}-${year.startYear + 1}`;
}

export function catalogYearLabel(year: CatalogYear): string {
  return `${year.startYear}–${year.startYear + 1}`;
}

export function parseCatalogYear(input: string): CatalogYear | null {
  const m = input.match(/(\d{4})\s*[-–]\s*(\d{2,4})/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end === start + 1 || end === (start + 1) % 100) return { startYear: start };
  return null;
}

export function catalogYearContaining(date = new Date()): CatalogYear {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return { startYear: month >= 7 ? year : year - 1 };
}

export interface CatalogEditions {
  current: CatalogYear;
  archived: CatalogYear[];
  fetchedAt: number;
  isEstimated: boolean;
}

export function editionsAll(editions: CatalogEditions): CatalogYear[] {
  const map = new Map<number, CatalogYear>();
  map.set(editions.current.startYear, editions.current);
  for (const y of editions.archived) map.set(y.startYear, y);
  return [...map.values()].sort((a, b) => b.startYear - a.startYear);
}

export function estimatedEditions(now = new Date()): CatalogEditions {
  const current = catalogYearContaining(now);
  const archived: CatalogYear[] = [];
  for (let y = current.startYear - 1; y >= 2016; y--) archived.push({ startYear: y });
  return { current, archived, fetchedAt: 0, isEstimated: true };
}

export const CATALOG_SITE = "https://catalog.northeastern.edu/";

export function editionBaseURL(editions: CatalogEditions, year: CatalogYear): string {
  if (year.startYear === editions.current.startYear) return CATALOG_SITE;
  return `${CATALOG_SITE}archive/${catalogYearSlug(year)}/`;
}

export interface CatalogProgram {
  title: string;
  path: string;
}

export function programLevel(program: CatalogProgram): "undergraduate" | "graduate" | "other" {
  if (program.path.startsWith("undergraduate/")) return "undergraduate";
  if (program.path.startsWith("graduate/")) return "graduate";
  return "other";
}

export function programParts(title: string): { name: string; degree?: string; campus?: string } {
  const m = title.match(/^(.+?),\s*([A-Za-z][A-Za-z.]{1,9})(?:\s*\(([^)]+)\))?\s*$/);
  if (!m) return { name: title };
  return { name: m[1]!, degree: m[2], campus: m[3] };
}

export interface UniversitywideRequirements {
  totalHours?: number | null;
  gpa?: number | null;
  residencyHours?: number | null;
  requiresExperientialLearning: boolean;
  fetchedAt: number;
}

export interface CourseOption {
  /** Each inner list is courses taken together; outer list is alternatives. */
  alternatives: CourseKey[][];
}

export function optionCourses(option: CourseOption): CourseKey[] {
  const seen = new Set<string>();
  const out: CourseKey[] = [];
  for (const alt of option.alternatives) {
    for (const key of alt) {
      const id = keyId(key);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(key);
    }
  }
  return out;
}

export function optionLabel(option: CourseOption): string {
  return option.alternatives
    .map((set) => set.map((k) => keyId(k)).join(" and "))
    .join(" or ");
}

export interface CourseRange {
  subject: string;
  lowest: number;
  highest?: number | null;
  except: CourseKey[];
  label: string;
}

export function rangeContains(range: CourseRange, key: CourseKey): boolean {
  if (key.subject !== range.subject) return false;
  if (range.except.some((e) => e.subject === key.subject && e.number === key.number)) return false;
  let i = 0;
  while (i < key.number.length && key.number[i]! >= "0" && key.number[i]! <= "9") i++;
  if (i !== 4) return false;
  const number = Number(key.number.slice(0, 4));
  if (number < range.lowest) return false;
  if (range.highest != null && number > range.highest) return false;
  return true;
}

export type RequirementKind =
  | { type: "required"; option: CourseOption }
  | { type: "choose"; count?: number | null; hours?: number | null; options: CourseOption[]; ranges: CourseRange[] }
  | { type: "generalElectives"; hours: number };

export interface RequirementRule {
  id: string;
  kind: RequirementKind;
  label: string;
  hours?: number | null;
  notes: string[];
  optionCategories?: (string | null)[] | null;
}

export function ruleDisplayLabel(rule: RequirementRule): string {
  return rule.label.endsWith(":") ? rule.label.slice(0, -1) : rule.label;
}

export function listedCourses(rule: RequirementRule): CourseKey[] {
  if (rule.kind.type === "required") return optionCourses(rule.kind.option);
  if (rule.kind.type === "choose") return rule.kind.options.flatMap(optionCourses);
  return [];
}

export interface RequirementGroup {
  id: string;
  title?: string | null;
  rules: RequirementRule[];
  notes: string[];
}

export interface RequirementSection {
  id: string;
  title: string;
  isConcentration: boolean;
  groups: RequirementGroup[];
  notes: string[];
}

export function concentrationName(title: string): string {
  return title
    .replace(/^(Concentration|Track|Option|Pathway)(\s+in\s+|\s*:\s*)/i, "")
    .replace(/\s+(Concentration|Track|Option|Pathway)$/i, "")
    .replace(/[* ]+$/g, "")
    .replace(/^[* ]+/g, "")
    .trim();
}

export interface ProgramRequirements {
  year: CatalogYear;
  program: CatalogProgram;
  sections: RequirementSection[];
  totalHours?: number | null;
  fetchedAt: number;
  courseTitles: Record<string, string>;
  universitywide?: UniversitywideRequirements | null;
}

export function applicableSections(req: ProgramRequirements, concentrationID?: string | null): RequirementSection[] {
  return req.sections.filter((s) => !s.isConcentration || s.id === concentrationID);
}

export function allRules(req: ProgramRequirements): RequirementRule[] {
  return req.sections.flatMap((s) => s.groups.flatMap((g) => g.rules));
}

export function ruleTitle(req: ProgramRequirements, id: string): string | null {
  for (const section of req.sections) {
    for (const group of section.groups) {
      const rule = group.rules.find((r) => r.id === id);
      if (!rule) continue;
      if (group.rules.length === 1) {
        const title = group.title ?? (section.isConcentration ? section.title : null);
        if (title) return title;
      }
      return ruleDisplayLabel(rule);
    }
  }
  return null;
}

export type CourseNumberLimit =
  | { type: "sameAsRequirement" }
  | { type: "anyNumber" }
  | { type: "atLeast"; minimum: number };

export interface RequirementReplacement {
  count?: number | null;
  hours?: number | null;
  likeRuleID?: string | null;
  likeRuleTitle?: string | null;
  courses: CourseKey[];
  courseNumbers?: CourseNumberLimit | null;
}

export function replacementSummary(r: RequirementReplacement): string {
  let amount: string;
  if (r.count != null) amount = r.count === 1 ? "1 course" : `${r.count} courses`;
  else if (r.hours != null) amount = `${trimNumber(r.hours)} semester hours`;
  else amount = "Courses";
  const sources: string[] = [];
  if (r.likeRuleTitle) sources.push(`like ${r.likeRuleTitle}`);
  if (r.courses.length) sources.push(`from ${r.courses.map((c) => keyId(c)).join(", ")}`);
  let text = [amount, ...sources].join(" ");
  const numbers = courseNumberSummary(r.courseNumbers);
  if (r.likeRuleTitle && numbers) text += `, ${numbers}`;
  return text;
}

function courseNumberSummary(limit?: CourseNumberLimit | null): string | null {
  if (!limit || limit.type === "sameAsRequirement") return null;
  if (limit.type === "anyNumber") return "any course number";
  return `numbered ${limit.minimum} or higher`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

export type SubstitutionChange =
  | { type: "countCourse"; course: CourseKey }
  | { type: "replace"; replacement: RequirementReplacement }
  | { type: "waive" };

export interface RequirementSubstitution {
  id: string;
  ruleID: string;
  ruleTitle: string;
  change: SubstitutionChange;
  note: string;
  approvedOn?: number | null;
  createdAt: number;
}

export interface CourseEquivalenceDeclaration {
  id: string;
  course: CourseKey;
  countsAs: CourseKey;
  note: string;
}

export type PlanSeason = "winter" | "spring" | "summerA" | "summerFull" | "summerB" | "fall";

export const PLAN_SEASON_EXPORT: Record<PlanSeason, string> = {
  winter: "Winter",
  spring: "Spring",
  summerA: "Summer Session A",
  summerFull: "Summer Full",
  summerB: "Summer Session B",
  fall: "Fall",
};

export const PLAN_SEASON_SHORT: Record<PlanSeason, string> = {
  winter: "Winter",
  spring: "Spring",
  summerA: "Summer A",
  summerFull: "Summer",
  summerB: "Summer B",
  fall: "Fall",
};

export function seasonStartMonth(season: PlanSeason): number {
  switch (season) {
    case "winter":
    case "spring":
      return 1;
    case "summerA":
    case "summerFull":
      return 5;
    case "summerB":
      return 7;
    case "fall":
      return 9;
  }
}

export function seasonOrder(season: PlanSeason): number {
  if (season === "spring" || season === "summerFull") return 1;
  return 0;
}

export function parsePlanSeason(raw: string): PlanSeason | null {
  const s = raw.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  switch (s) {
    case "fall":
    case "autumn":
      return "fall";
    case "spring":
      return "spring";
    case "winter":
      return "winter";
    case "summer session a":
    case "summer a":
    case "summer 1":
    case "summer i":
    case "summer session 1":
      return "summerA";
    case "summer session b":
    case "summer b":
    case "summer 2":
    case "summer ii":
    case "summer session 2":
      return "summerB";
    case "summer full":
    case "summer":
    case "full summer":
    case "summer session full":
      return "summerFull";
    default:
      return null;
  }
}

export interface DegreePlanCourse {
  id: string;
  key?: CourseKey | null;
  label: string;
  title: string;
  credits: number;
}

export interface DegreePlanTerm {
  id: string;
  season: PlanSeason;
  year: number;
  courses: DegreePlanCourse[];
}

export function termSortKey(term: DegreePlanTerm): number {
  const month = term.year * 12 + seasonStartMonth(term.season) - 1;
  return month * 4 + seasonOrder(term.season);
}

export function termCredits(term: DegreePlanTerm): number {
  return term.courses.reduce((s, c) => s + c.credits, 0);
}

export interface DegreePlan {
  id: string;
  name: string;
  program?: string | null;
  studentName?: string | null;
  studentID?: string | null;
  completed: DegreePlanCourse[];
  terms: DegreePlanTerm[];
  isPrimary: boolean;
  importedFrom?: string | null;
  printedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  catalogYear?: number | null;
  catalogProgramPath?: string | null;
  catalogProgramTitle?: string | null;
  concentrationID?: string | null;
  substitutions: RequirementSubstitution[];
  courseEquivalences: CourseEquivalenceDeclaration[];
}

export function sortPlanTerms(plan: DegreePlan): void {
  plan.terms.sort((a, b) => termSortKey(a) - termSortKey(b));
}

export function completedCredits(plan: DegreePlan): number {
  return plan.completed.reduce((s, c) => s + c.credits, 0);
}

export function plannedCredits(plan: DegreePlan): number {
  return plan.terms.reduce((s, t) => s + termCredits(t), 0);
}

export function sortedKeys(keys: CourseKey[]): CourseKey[] {
  return [...keys].sort(compareCourseKeys);
}
