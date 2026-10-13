/**
 * Offering history and semester-move suggestions.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/OfferingHistory.swift and Logic/DegreePlan/DegreePlanReordering.swift.
 * The offering repository (network and cache) is not included.
 */

import type { CourseKey, Requisite, Season } from "@/lib/models";
import { compareCourseKeys, creditNumber, keyId, parseCourseKey, sameKey, termCalendarYear, termSeason } from "@/lib/models";
import { CourseEquivalences, equivalencesFromDeclarations } from "@/lib/equivalences";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm, PlanSeason } from "@/lib/requirements";
import { PLAN_SEASON_SHORT, seasonStartMonth, sortPlanTerms, termCredits, termSortKey } from "@/lib/requirements";
import { statusOf } from "@/lib/degree-logic";

const MASK64 = (1n << 64n) - 1n;
const FNV_PRIME = 0x100000001b3n;

/**
 * A UUID that depends only on the text, so a semester a suggestion adds has the same id
 * every time. Uppercase, matching Foundation's UUID string.
 */
export function stableTermID(text: string): string {
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of new TextEncoder().encode(text)) {
    const value = BigInt(byte);
    first = ((first ^ value) * FNV_PRIME) & MASK64;
    second = (((((second + value) & MASK64) * FNV_PRIME) & MASK64) ^ first) & MASK64;
  }
  const hex = first.toString(16).padStart(16, "0") + second.toString(16).padStart(16, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

const SEASON_DISPLAY: Record<Season, string> = {
  fall: "Fall",
  winter: "Winter",
  spring: "Spring",
  summer1: "Summer 1",
  summerFull: "Summer",
  summer2: "Summer 2",
};

export function planSeasonMatches(season: PlanSeason, banner: Season): boolean {
  switch (season) {
    case "fall":
      return banner === "fall";
    case "spring":
      return banner === "spring";
    case "winter":
      return banner === "winter";
    case "summerA":
      return banner === "summer1" || banner === "summerFull";
    case "summerB":
      return banner === "summer2" || banner === "summerFull";
    case "summerFull":
      return banner === "summerFull" || banner === "summer1" || banner === "summer2";
  }
}

function planSeasonOfCode(code: string): PlanSeason {
  switch (termSeason(code)) {
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

export function monthIndexOfTermCode(code: string): number {
  return termCalendarYear(code) * 12 + seasonStartMonth(planSeasonOfCode(code)) - 1;
}

export function termCodeLabel(code: string): string {
  return `${SEASON_DISPLAY[termSeason(code)]} ${termCalendarYear(code)}`;
}

type Family = "fall" | "spring" | "summer";
const FAMILIES: readonly Family[] = ["fall", "spring", "summer"];

function familyOfBanner(season: Season): Family | null {
  if (season === "fall") return "fall";
  if (season === "spring") return "spring";
  if (season === "summer1" || season === "summerFull" || season === "summer2") return "summer";
  return null;
}

function familyOfPlan(season: PlanSeason): Family | null {
  if (season === "fall") return "fall";
  if (season === "spring") return "spring";
  if (season === "summerA" || season === "summerFull" || season === "summerB") return "summer";
  return null;
}

function proseList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface OfferingHistoryJSON {
  checkedTerms: string[];
  offered: Record<string, string[]>;
  checkedKeys?: string[];
}

/**
 * Recent Banner terms in which courses had sections. Null checked keys means every course
 * was checked, so a course missing from `offered` was not offered.
 */
export class OfferingHistory {
  readonly checkedTerms: string[];
  private readonly offered: Map<string, Set<string>>;
  private readonly courseKeys: Map<string, CourseKey>;
  /** Null when every course was checked. */
  private readonly checkedKeyIds: Set<string> | null;

  constructor(options?: {
    checkedTerms?: readonly string[];
    offered?: readonly { key: CourseKey; terms: readonly string[] }[];
    checkedKeys?: readonly CourseKey[] | null;
  }) {
    this.checkedTerms = [...(options?.checkedTerms ?? [])];
    this.offered = new Map();
    this.courseKeys = new Map();
    for (const entry of options?.offered ?? []) {
      const id = keyId(entry.key);
      this.courseKeys.set(id, entry.key);
      this.offered.set(id, new Set(entry.terms));
    }
    this.checkedKeyIds = options?.checkedKeys == null ? null : new Set(options.checkedKeys.map((key) => keyId(key)));
    if (options?.checkedKeys) {
      for (const key of options.checkedKeys) this.courseKeys.set(keyId(key), key);
    }
  }

  static empty(): OfferingHistory {
    return new OfferingHistory();
  }

  static fromJSON(raw: OfferingHistoryJSON): OfferingHistory {
    const offered: { key: CourseKey; terms: readonly string[] }[] = [];
    for (const [code, terms] of Object.entries(raw.offered)) {
      const key = parseCourseKey(code);
      if (key) offered.push({ key, terms });
    }
    const checked = raw.checkedKeys?.flatMap((code) => {
      const key = parseCourseKey(code);
      return key ? [key] : [];
    });
    return new OfferingHistory({
      checkedTerms: raw.checkedTerms,
      offered,
      checkedKeys: raw.checkedKeys == null ? null : checked,
    });
  }

  toJSON(): OfferingHistoryJSON {
    const offered: Record<string, string[]> = {};
    const ids = [...this.offered.keys()].sort((a, b) => a.localeCompare(b));
    for (const id of ids) {
      offered[id] = [...(this.offered.get(id) ?? [])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    }
    const json: OfferingHistoryJSON = { checkedTerms: [...this.checkedTerms], offered };
    if (this.checkedKeyIds) json.checkedKeys = [...this.checkedKeyIds].sort((a, b) => a.localeCompare(b));
    return json;
  }

  isChecked(key: CourseKey): boolean {
    return this.checkedTerms.length > 0 && (this.checkedKeyIds == null || this.checkedKeyIds.has(keyId(key)));
  }

  /** Checked keys, or null when every course was checked. */
  checkedKeys(): CourseKey[] | null {
    if (this.checkedKeyIds == null) return null;
    const keys: CourseKey[] = [];
    for (const id of this.checkedKeyIds) {
      const key = this.courseKeys.get(id);
      if (key) keys.push(key);
    }
    return keys.sort(compareCourseKeys);
  }

  offeredTerms(key: CourseKey): string[] {
    const terms = this.offered.get(keyId(key));
    if (!terms) return [];
    return this.checkedTerms.filter((code) => terms.has(code));
  }

  offeredTermSet(key: CourseKey): ReadonlySet<string> {
    return this.offered.get(keyId(key)) ?? new Set();
  }

  seasons(key: CourseKey): PlanSeason[] {
    const seen = new Set<PlanSeason>();
    const seasons: PlanSeason[] = [];
    for (const code of this.offeredTerms(key)) {
      const season = planSeasonOfCode(code);
      if (seen.has(season)) continue;
      seen.add(season);
      seasons.push(season);
    }
    return seasons;
  }

  isLikelyOffered(key: CourseKey, season: PlanSeason): boolean | null {
    if (!this.isChecked(key)) return null;
    const relevant = this.checkedTerms.filter((code) => planSeasonMatches(season, termSeason(code)));
    if (relevant.length === 0) return null;
    const terms = this.offered.get(keyId(key)) ?? new Set<string>();
    return relevant.some((code) => terms.has(code));
  }

  summary(key: CourseKey): string {
    if (!this.isChecked(key)) return "Offering history unknown";
    const terms = this.offeredTerms(key);
    const latest = terms[0];
    if (!latest) {
      const years = this.checkedYears();
      return years === 1 ? "Not offered in the last year" : `Not offered in the last ${years} years`;
    }
    const regular = FAMILIES.filter((family) => this.isRegular(family, key));
    if (regular.length === 0) return `Last offered ${termCodeLabel(latest)}`;
    const others = FAMILIES.filter((family) => !regular.includes(family) && terms.some((code) => familyOfBanner(termSeason(code)) === family));
    const regularly = `Offered every ${proseList(regular)}`;
    return others.length === 0 ? regularly : `${regularly}, and sometimes in the ${proseList(others)}`;
  }

  summaryIn(key: CourseKey, season: PlanSeason): string {
    if (this.isLikelyOffered(key, season) == null) return "Offering history unknown";
    const family = familyOfPlan(season);
    const relevant = this.checkedTerms.filter((code) => planSeasonMatches(season, termSeason(code)));
    const terms = this.offered.get(keyId(key)) ?? new Set<string>();
    const latest = relevant.find((code) => terms.has(code));
    if (!latest) {
      const years = this.checkedYears();
      const span = years === 1 ? "the last year" : `the last ${years} years`;
      const name = family ?? PLAN_SEASON_SHORT[season].toLocaleLowerCase("en-US");
      return `Not offered in a ${name} term in ${span}`;
    }
    if (family && this.isRegular(family, key)) return `Offered every ${family}`;
    return `Offered in ${termCodeLabel(latest)}`;
  }

  merging(other: OfferingHistory): OfferingHistory {
    const terms = [...new Set([...this.checkedTerms, ...other.checkedTerms])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const combined = new Map<string, { key: CourseKey; terms: Set<string> }>();
    const absorb = (history: OfferingHistory) => {
      for (const [id, codes] of history.offered) {
        const key = history.courseKeys.get(id);
        if (!key) continue;
        const existing = combined.get(id);
        if (existing) for (const code of codes) existing.terms.add(code);
        else combined.set(id, { key, terms: new Set(codes) });
      }
    };
    absorb(this);
    absorb(other);
    const checkedKeys = this.checkedKeyIds != null && other.checkedKeyIds != null ? [...this.checkedKeys()!, ...other.checkedKeys()!] : null;
    return new OfferingHistory({
      checkedTerms: terms,
      offered: [...combined.values()].map((entry) => ({ key: entry.key, terms: [...entry.terms] })),
      checkedKeys,
    });
  }

  private isRegular(family: Family, key: CourseKey): boolean {
    const offeredTerms = this.offered.get(keyId(key)) ?? new Set<string>();
    const periods = new Map<number, boolean>();
    for (const code of this.checkedTerms) {
      if (familyOfBanner(termSeason(code)) !== family) continue;
      const year = termCalendarYear(code);
      periods.set(year, (periods.get(year) ?? false) || offeredTerms.has(code));
    }
    return periods.size >= 2 && ![...periods.values()].includes(false);
  }

  private checkedYears(): number {
    const newest = this.checkedTerms[0];
    const oldest = this.checkedTerms[this.checkedTerms.length - 1];
    if (!newest || !oldest) return 1;
    const months = monthIndexOfTermCode(newest) - monthIndexOfTermCode(oldest);
    return Math.max(1, Math.round(months / 12));
  }
}

// MARK: - Reordering

/** Undefined: unknown. Null: no prerequisites. A requisite: what the course needs. */
export type PrerequisiteLookup = (key: CourseKey) => Requisite | null | undefined;

export interface ReorderMove {
  course: CourseKey;
  from: string;
  to: string;
}

export interface ReorderSuggestion {
  id: string;
  moves: ReorderMove[];
  title: string;
  reasons: string[];
  addsSemester: DegreePlanTerm | null;
}

export const MAX_REORDER_SUGGESTIONS = 5;

type Requirements = { type: "unknown" } | { type: "nothing" } | { type: "needs"; requisite: Requisite };
type Check = "met" | "missing" | "unknown";

interface Rank {
  moves: number;
  target: number;
  uncertainty: number;
  order: number;
  detail: number;
}

function rankCompare(a: Rank, b: Rank): number {
  return a.moves - b.moves || a.target - b.target || a.uncertainty - b.uncertainty || a.order - b.order || a.detail - b.detail;
}

function copyPlan(plan: DegreePlan): DegreePlan {
  return {
    ...plan,
    completed: [...plan.completed],
    terms: plan.terms.map((term) => ({ ...term, courses: [...term.courses] })),
  };
}

function performMove(plan: DegreePlan, course: CourseKey, from: string, to: string): boolean {
  const source = plan.terms.findIndex((term) => term.id === from);
  const target = plan.terms.findIndex((term) => term.id === to);
  if (source < 0 || target < 0) return false;
  const position = plan.terms[source]!.courses.findIndex((item) => item.key && sameKey(item.key, course));
  if (position < 0) return false;
  const [moved] = plan.terms[source]!.courses.splice(position, 1);
  if (!moved) return false;
  plan.terms[target]!.courses.push(moved);
  return true;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLocaleLowerCase("en-US") + text.slice(1);
}

function termShort(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_SHORT[term.season]} ${term.year}`;
}

function upcomingSemesters(plan: DegreePlan, count: number, now: Date): { season: PlanSeason; year: number; sortKey: number }[] {
  const order: PlanSeason[] = ["spring", "summerA", "summerB", "fall"];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  let year = Number(parts.year);
  const month = Number(parts.month);
  let seasonIndex = month < 5 ? 0 : month < 7 ? 1 : month < 9 ? 2 : 3;
  const last = plan.terms[plan.terms.length - 1];
  if (last) {
    const index = order.indexOf(last.season);
    if (index >= 0) {
      year = last.year;
      seasonIndex = index + 1;
    }
  }
  const existing = new Set(plan.terms.map((term) => `${term.season}-${term.year}`));
  const result: { season: PlanSeason; year: number; sortKey: number }[] = [];
  while (result.length < count) {
    if (seasonIndex >= order.length) {
      seasonIndex = 0;
      year += 1;
    }
    const season = order[seasonIndex]!;
    if (!existing.has(`${season}-${year}`)) {
      result.push({ season, year, sortKey: termSortKey({ id: "", season, year, courses: [] }) });
    }
    seasonIndex += 1;
  }
  return result;
}

class Engine {
  private readonly before: Map<string, Check>;

  constructor(
    private readonly plan: DegreePlan,
    private readonly origin: number,
    private readonly history: OfferingHistory,
    private readonly requirements: Map<string, Requirements>,
    private readonly equivalences: CourseEquivalences,
    private readonly maxCredits: number,
    private readonly now: Date,
  ) {
    this.before = Engine.evaluate(plan, requirements, equivalences);
  }

  static check(key: CourseKey, taken: Set<string>, requirements: Map<string, Requirements>, equivalences: CourseEquivalences): Check {
    const requirement = requirements.get(keyId(key)) ?? { type: "unknown" };
    if (requirement.type === "unknown") return "unknown";
    if (requirement.type === "nothing") return "met";
    return statusOf(requirement.requisite, taken, equivalences).kind === "met" ? "met" : "missing";
  }

  static evaluate(plan: DegreePlan, requirements: Map<string, Requirements>, equivalences: CourseEquivalences): Map<string, Check> {
    const taken = new Set<string>();
    for (const course of plan.completed) if (course.key) taken.add(keyId(course.key));
    const checks = new Map<string, Check>();
    for (const term of plan.terms) {
      for (const course of term.courses) {
        if (!course.key) continue;
        checks.set(course.id, Engine.check(course.key, taken, requirements, equivalences));
      }
      for (const course of term.courses) if (course.key) taken.add(keyId(course.key));
    }
    return checks;
  }

  private checksAfter(changed: DegreePlan, moved: ReadonlySet<string>): Map<string, Check> | null {
    const after = Engine.evaluate(changed, this.requirements, this.equivalences);
    for (const [id, check] of after) {
      if (moved.has(id)) {
        if (check === "missing") return null;
      } else if (this.before.get(id) === "met" && check === "missing") return null;
    }
    return after;
  }

  private creditsLabel(credits: number): string {
    return `${creditNumber(credits)} ${credits === 1 ? "credit" : "credits"}`;
  }

  private uncertainty(key: CourseKey, season: PlanSeason): number | null {
    const likely = this.history.isLikelyOffered(key, season);
    if (likely === false) return null;
    return likely === true ? 0 : 1;
  }

  private offeringReason(key: CourseKey, season: PlanSeason, named: boolean): string {
    const text = this.history.summaryIn(key, season);
    return named ? `${keyId(key)}: ${lowerFirst(text)}` : text;
  }

  private prerequisiteReason(key: CourseKey, check: Check, wasMet: boolean, named: boolean): string {
    const requirement = this.requirements.get(keyId(key)) ?? { type: "unknown" };
    let text: string;
    if (check === "unknown") text = "Prerequisites couldn\u2019t be checked";
    else if (requirement.type === "nothing") text = "No prerequisites";
    else if (check === "met") text = wasMet ? "Prerequisites still met" : "Prerequisites met by then";
    else text = "Prerequisites not met";
    return named ? `${keyId(key)}: ${lowerFirst(text)}` : text;
  }

  candidates(course: DegreePlanCourse, order: number, blocking: ReadonlySet<string>): { suggestion: ReorderSuggestion; rank: Rank }[] {
    if (!course.key) return [];
    const key = course.key;
    const found: { suggestion: ReorderSuggestion; rank: Rank }[] = [];
    for (let target = this.origin + 1; target < Math.max(this.origin + 1, this.plan.terms.length); target += 1) {
      const single = this.singleMove(course, key, target, order);
      if (single) found.push(single);
      this.plan.terms[target]!.courses.forEach((partner, position) => {
        if (!partner.key || blocking.has(keyId(partner.key)) || sameKey(partner.key, key)) return;
        const swap = this.swap(course, key, partner, partner.key, target, order, position);
        if (swap) found.push(swap);
      });
    }
    if (found.length === 0) {
      const appended = this.appendedSemester(course, key, order);
      if (appended) found.push(appended);
    }
    return found;
  }

  private singleMove(course: DegreePlanCourse, key: CourseKey, target: number, order: number): { suggestion: ReorderSuggestion; rank: Rank } | null {
    const semester = this.plan.terms[target]!;
    const offering = this.uncertainty(key, semester.season);
    if (offering == null) return null;
    const total = termCredits(semester) + course.credits;
    if (total > this.maxCredits) return null;
    const move: ReorderMove = { course: key, from: this.plan.terms[this.origin]!.id, to: semester.id };
    const changed = copyPlan(this.plan);
    if (!performMove(changed, key, move.from, move.to)) return null;
    const after = this.checksAfter(changed, new Set([course.id]));
    if (!after) return null;
    const check = after.get(course.id) ?? "unknown";
    const suggestion: ReorderSuggestion = {
      id: `move-${keyId(key)}-${semester.id}`,
      moves: [move],
      title: `Move ${keyId(key)} to ${termShort(semester)}`,
      reasons: [
        this.offeringReason(key, semester.season, false),
        this.prerequisiteReason(key, check, this.before.get(course.id) === "met", false),
        `${termShort(semester)} would have ${this.creditsLabel(total)}`,
      ],
      addsSemester: null,
    };
    return { suggestion, rank: { moves: 1, target, uncertainty: offering + (check === "unknown" ? 1 : 0), order, detail: 0 } };
  }

  private swap(
    course: DegreePlanCourse,
    key: CourseKey,
    partner: DegreePlanCourse,
    partnerKey: CourseKey,
    target: number,
    order: number,
    detail: number,
  ): { suggestion: ReorderSuggestion; rank: Rank } | null {
    const semester = this.plan.terms[target]!;
    const home = this.plan.terms[this.origin]!;
    const courseOffering = this.uncertainty(key, semester.season);
    const partnerOffering = this.uncertainty(partnerKey, home.season);
    if (courseOffering == null || partnerOffering == null) return null;
    const newHome = termCredits(home) - course.credits + partner.credits;
    const newTarget = termCredits(semester) - partner.credits + course.credits;
    if (newHome > Math.max(this.maxCredits, termCredits(home)) || newTarget > Math.max(this.maxCredits, termCredits(semester))) return null;
    const moves: ReorderMove[] = [
      { course: key, from: home.id, to: semester.id },
      { course: partnerKey, from: semester.id, to: home.id },
    ];
    const changed = copyPlan(this.plan);
    for (const move of moves) {
      if (!performMove(changed, move.course, move.from, move.to)) return null;
    }
    const after = this.checksAfter(changed, new Set([course.id, partner.id]));
    if (!after) return null;
    const courseCheck = after.get(course.id) ?? "unknown";
    const partnerCheck = after.get(partner.id) ?? "unknown";
    const suggestion: ReorderSuggestion = {
      id: `swap-${keyId(key)}-${semester.id}-${keyId(partnerKey)}`,
      moves,
      title: `Move ${keyId(key)} to ${termShort(semester)} and ${keyId(partnerKey)} to ${termShort(home)}`,
      reasons: [
        this.offeringReason(key, semester.season, true),
        this.offeringReason(partnerKey, home.season, true),
        this.prerequisiteReason(key, courseCheck, this.before.get(course.id) === "met", true),
        this.prerequisiteReason(partnerKey, partnerCheck, this.before.get(partner.id) === "met", true),
        `${termShort(home)} would have ${this.creditsLabel(newHome)}`,
        `${termShort(semester)} would have ${this.creditsLabel(newTarget)}`,
      ],
      addsSemester: null,
    };
    const unsure = courseOffering + partnerOffering + (courseCheck === "unknown" ? 1 : 0) + (partnerCheck === "unknown" ? 1 : 0);
    return { suggestion, rank: { moves: 2, target, uncertainty: unsure, order, detail } };
  }

  private appendedSemester(course: DegreePlanCourse, key: CourseKey, order: number): { suggestion: ReorderSuggestion; rank: Rank } | null {
    if (course.credits > this.maxCredits) return null;
    const home = this.plan.terms[this.origin]!;
    for (const upcoming of upcomingSemesters(this.plan, 8, this.now)) {
      if (upcoming.sortKey <= termSortKey(home)) continue;
      const offering = this.uncertainty(key, upcoming.season);
      if (offering == null) continue;
      const semester: DegreePlanTerm = {
        id: stableTermID(`degree-plan-term-${upcoming.season}-${upcoming.year}`),
        season: upcoming.season,
        year: upcoming.year,
        courses: [],
      };
      const changed = copyPlan(this.plan);
      changed.terms.push({ ...semester, courses: [] });
      sortPlanTerms(changed);
      const move: ReorderMove = { course: key, from: home.id, to: semester.id };
      if (!performMove(changed, key, move.from, move.to)) continue;
      const after = this.checksAfter(changed, new Set([course.id]));
      if (!after) continue;
      const check = after.get(course.id) ?? "unknown";
      const suggestion: ReorderSuggestion = {
        id: `move-${keyId(key)}-${semester.id}`,
        moves: [move],
        title: `Move ${keyId(key)} to a new ${termShort(semester)} semester`,
        reasons: [
          this.offeringReason(key, semester.season, false),
          this.prerequisiteReason(key, check, this.before.get(course.id) === "met", false),
          `Adds ${termShort(semester)} to your plan, with ${this.creditsLabel(course.credits)}`,
        ],
        addsSemester: semester,
      };
      return { suggestion, rank: { moves: 1, target: this.plan.terms.length, uncertainty: offering + (check === "unknown" ? 1 : 0), order, detail: 0 } };
    }
    return null;
  }
}

export function reorderSuggestions(options: {
  plan: DegreePlan;
  termID: string;
  blocking: readonly CourseKey[];
  history: OfferingHistory;
  prerequisites: PrerequisiteLookup;
  equivalences?: CourseEquivalences;
  maxCreditsPerTerm?: number;
  now?: Date;
}): ReorderSuggestion[] {
  const plan = copyPlan(options.plan);
  sortPlanTerms(plan);
  const origin = plan.terms.findIndex((term) => term.id === options.termID);
  if (origin < 0) return [];
  const requirements = new Map<string, Requirements>();
  for (const key of plan.terms.flatMap((term) => term.courses.flatMap((course) => (course.key ? [course.key] : [])))) {
    const id = keyId(key);
    if (requirements.has(id)) continue;
    const answer = options.prerequisites(key);
    if (answer === undefined) requirements.set(id, { type: "unknown" });
    else if (answer === null) requirements.set(id, { type: "nothing" });
    else requirements.set(id, { type: "needs", requisite: answer });
  }
  const engine = new Engine(
    plan,
    origin,
    options.history,
    requirements,
    (options.equivalences ?? CourseEquivalences.none()).merging(equivalencesFromDeclarations(plan.courseEquivalences)),
    options.maxCreditsPerTerm ?? 20,
    options.now ?? new Date(),
  );
  const candidates: { suggestion: ReorderSuggestion; rank: Rank }[] = [];
  const seen = new Set<string>();
  options.blocking.forEach((key, order) => {
    const id = keyId(key);
    if (seen.has(id)) return;
    seen.add(id);
    const course = plan.terms[origin]!.courses.find((item) => item.key && sameKey(item.key, key));
    if (!course) return;
    candidates.push(...engine.candidates(course, order, new Set(options.blocking.map((item) => keyId(item)))));
  });
  candidates.sort((a, b) => rankCompare(a.rank, b.rank));
  return candidates.slice(0, MAX_REORDER_SUGGESTIONS).map((candidate) => candidate.suggestion);
}

/** Adds the semester a suggestion needs, then moves each course. A stale suggestion changes nothing. */
export function applyReorderSuggestion(suggestion: ReorderSuggestion, plan: DegreePlan): void {
  const updated = copyPlan(plan);
  const semesterID = new Map<string, string>();
  if (suggestion.addsSemester) {
    const semester = suggestion.addsSemester;
    const existing = updated.terms.find((term) => term.season === semester.season && term.year === semester.year);
    if (existing) semesterID.set(semester.id, existing.id);
    else {
      updated.terms.push({ ...semester, courses: [...semester.courses] });
      sortPlanTerms(updated);
    }
  }
  for (const move of suggestion.moves) {
    if (!performMove(updated, move.course, move.from, semesterID.get(move.to) ?? move.to)) return;
  }
  plan.terms = updated.terms;
}
