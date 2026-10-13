/**
 * Port of NEUClassSearchTests/DegreeAuditMatchingTests.swift.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { degreeIsGeneralElectives, ruleResults, runDegreeAudit, satisfiedCount, statusIsSatisfied, totalCount } from "@/lib/degree/audit";
import { SeededGenerator, course, emptyPlan, key, term } from "@/lib/degree/swift-fixtures";
import type { CourseKey } from "@/lib/models";
import { creditNumber, keyId, sameKey } from "@/lib/models";
import type { CourseOption, CourseRange, ProgramRequirements, RequirementKind, RequirementRule } from "@/lib/requirements";
import { optionCourses, rangeContains } from "@/lib/requirements";

/**
 * Swift 6 `RandomNumberGenerator.next(upperBound:)` (Lemire) and the stdlib
 * `Int.random` / `Bool.random` / `Array.shuffle` that consume it. SplitMix64
 * itself is `SeededGenerator`.
 */
const MASK = (1n << 64n) - 1n;

function nextBelow(gen: SeededGenerator, upperBound: number): number {
  const bound = BigInt(upperBound);
  let random = gen.next();
  let product = random * bound;
  let high = product >> 64n;
  let low = product & MASK;
  if (low < bound) {
    const threshold = (1n << 64n) % bound;
    while (low < threshold) {
      random = gen.next();
      product = random * bound;
      high = product >> 64n;
      low = product & MASK;
    }
  }
  return Number(high);
}

function randomInt(gen: SeededGenerator, min: number, maxInclusive: number): number {
  return min + nextBelow(gen, maxInclusive - min + 1);
}

function randomBool(gen: SeededGenerator): boolean {
  return ((gen.next() >> 17n) & 1n) === 0n;
}

function swiftShuffled<T>(items: readonly T[], gen: SeededGenerator): T[] {
  const copy = [...items];
  let amount = copy.length;
  let index = 0;
  while (amount > 1) {
    const random = nextBelow(gen, amount);
    amount -= 1;
    const swapAt = index + random;
    const swap = copy[index]!;
    copy[index] = copy[swapAt]!;
    copy[swapAt] = swap;
    index += 1;
  }
  return copy;
}

function randomElement<T>(items: readonly T[], gen: SeededGenerator): T {
  return items[nextBelow(gen, items.length)]!;
}

interface PoolCourse {
  key: CourseKey;
  credits: number;
}

const CATALOG: readonly [string, number][] = [
  ["CS 1200", 1], ["CS 1800", 4], ["CS 1802", 1], ["CS 2500", 4], ["CS 2501", 1], ["CS 2510", 4],
  ["CS 3000", 4], ["CS 3200", 4], ["CS 3500", 4], ["CS 3501", 1], ["CS 3650", 4], ["CS 4100", 4],
  ["CS 4400", 4], ["CS 4530", 4], ["DS 3000", 4], ["DS 4400", 4], ["MATH 1341", 4], ["MATH 2331", 4],
];

const POOL: PoolCourse[] = CATALOG.map(([code, credits]) => ({ key: key(code), credits }));

function option(alternatives: CourseKey[][]): CourseOption {
  return { alternatives };
}

function range(subject: string, lowest: number, label: string): CourseRange {
  return { subject, lowest, highest: null, except: [], label };
}

function makeRule(id: string, kind: RequirementKind): RequirementRule {
  return { id, kind, label: id, hours: null, notes: [] };
}

function makeRequirements(rules: RequirementRule[]): ProgramRequirements {
  return {
    year: { startYear: 2024 },
    program: { title: "Random, BS", path: "undergraduate/random/" },
    sections: [{
      id: "major",
      title: "Major",
      isConcentration: false,
      groups: rules.map((rule) => ({ id: `group-${rule.id}`, title: rule.id, rules: [rule], notes: [] })),
      notes: [],
    }],
    totalHours: null,
    fetchedAt: 0,
    courseTitles: {},
  };
}

interface RandomPlan {
  courses: PoolCourse[];
  degreePlan: ReturnType<typeof emptyPlan>;
}

function randomPlan(gen: SeededGenerator): RandomPlan {
  const count = randomInt(gen, 3, 6);
  const courses = swiftShuffled(POOL, gen).slice(0, count);
  const plan = emptyPlan("Random");
  const semester = term("spring-2027", "spring", 2027);
  for (const item of courses) {
    const line = course(keyId(item.key), item.credits);
    if (randomBool(gen)) plan.completed.push(line);
    else semester.courses.push(line);
  }
  plan.terms = [semester];
  return { courses, degreePlan: plan };
}

function distinct(keys: CourseKey[]): CourseKey[] {
  const seen = new Set<string>();
  return keys.filter((item) => {
    const id = keyId(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function randomRules(courses: PoolCourse[], gen: SeededGenerator): RequirementRule[] {
  const keys = courses.map((item) => item.key);
  const someKey = () => (randomInt(gen, 0, 4) === 0 ? randomElement(POOL, gen).key : randomElement(keys, gen));
  const rules: RequirementRule[] = [];
  const total = randomInt(gen, 2, 4);
  const withElectives = randomBool(gen);
  const specific = withElectives ? total - 1 : total;
  for (let index = 0; index < specific; index += 1) {
    let kind: RequirementKind;
    switch (randomInt(gen, 0, 7)) {
      case 0:
        kind = { type: "required", option: option([[someKey()]]) };
        break;
      case 1:
        kind = { type: "required", option: option([distinct([someKey(), someKey()])]) };
        break;
      case 2:
        kind = { type: "required", option: option([[someKey()], [someKey()]]) };
        break;
      case 3: {
        const options = distinct(Array.from({ length: randomInt(gen, 2, 4) }, () => someKey()));
        kind = { type: "choose", count: randomInt(gen, 1, 2), hours: null, options: options.map((item) => option([[item]])), ranges: [] };
        break;
      }
      case 4: {
        const lowest = randomElement([2000, 3000], gen);
        kind = {
          type: "choose",
          count: randomInt(gen, 1, 2),
          hours: null,
          options: [],
          ranges: [range("CS", lowest, `CS ${lowest} or higher`)],
        };
        break;
      }
      case 5:
        kind = {
          type: "choose",
          count: null,
          hours: randomElement([5, 8], gen),
          options: [],
          ranges: [range("CS", 2000, "CS 2000 or higher"), range("DS", 2000, "DS 2000 or higher")],
        };
        break;
      case 6: {
        const pair = distinct([someKey(), someKey()]);
        const singles = distinct(Array.from({ length: randomInt(gen, 1, 2) }, () => someKey())).filter((item) => !pair.some((other) => sameKey(other, item)));
        kind = {
          type: "choose",
          count: randomInt(gen, 1, 2),
          hours: null,
          options: [option([pair]), ...singles.map((item) => option([[item]]))],
          ranges: [],
        };
        break;
      }
      default: {
        const approved = [someKey()];
        const ranges = [range("CS", 2500, "CS 2500 or higher")];
        kind = randomBool(gen)
          ? { type: "choose", count: randomInt(gen, 1, 2), hours: null, options: [option([approved])], ranges }
          : { type: "choose", count: null, hours: randomElement([4, 8], gen), options: [option([approved])], ranges };
        break;
      }
    }
    rules.push(makeRule(`rule-${index}`, kind));
  }
  if (withElectives) rules.push(makeRule("general", { type: "generalElectives", hours: randomElement([4, 8], gen) }));
  return rules;
}

function randomPins(rules: RequirementRule[], courses: PoolCourse[], gen: SeededGenerator): { course: number; rule: number }[] {
  if (randomInt(gen, 0, 9) >= 3) return [];
  return [{ course: randomInt(gen, 0, courses.length - 1), rule: randomInt(gen, 0, rules.length - 1) }];
}

function mostThatCanBeMet(
  rules: RequirementRule[],
  courses: PoolCourse[],
  pins: { course: number; rule: number }[],
): { specific: number; everything: boolean } {
  const assignment = Array<number>(courses.length).fill(rules.length);
  const pinned = new Map<number, number>();
  for (const pin of pins) if (!pinned.has(pin.course)) pinned.set(pin.course, pin.rule);
  let bestSpecific = 0;
  let everything = false;
  const isMet = (ruleIndex: number): boolean => {
    const rule = rules[ruleIndex]!;
    const mine = courses.filter((_, index) => assignment[index] === ruleIndex && !pinned.has(index));
    const placed = courses.filter((_, index) => pinned.get(index) === ruleIndex);
    const keys = new Set(mine.map((item) => keyId(item.key)));
    const placedKeys = new Set(placed.map((item) => keyId(item.key)));
    const complete = (alternative: CourseKey[]) => alternative.every((item) => keys.has(keyId(item)));
    if (rule.kind.type === "required") return placed.length > 0 || rule.kind.option.alternatives.some(complete);
    if (rule.kind.type === "generalElectives") {
      return [...mine, ...placed].reduce((sum, item) => sum + item.credits, 0) >= rule.kind.hours;
    }
    const { count, hours, options, ranges } = rule.kind;
    const open = options.filter((item) => optionCourses(item).every((courseKey) => !placedKeys.has(keyId(courseKey))));
    const listed = new Set(open.flatMap((item) => optionCourses(item).map((courseKey) => keyId(courseKey))));
    const optionUnits = open.filter((item) => item.alternatives.some(complete)).length;
    const inRanges = mine.filter((item) => !listed.has(keyId(item.key)) && ranges.some((span) => rangeContains(span, item.key)));
    if (count != null) return placed.length + optionUnits + inRanges.filter((item) => item.credits >= 2).length >= count;
    if (hours != null) {
      const fromOptions = mine.filter((item) => open.some((choice) => optionCourses(choice).some((courseKey) => sameKey(courseKey, item.key)) && choice.alternatives.some(complete)));
      return [...placed, ...fromOptions, ...inRanges].reduce((sum, item) => sum + item.credits, 0) >= hours;
    }
    return placed.length + optionUnits >= 1;
  };
  const assign = (position: number) => {
    if (position >= courses.length) {
      const met: number[] = [];
      for (let index = 0; index < rules.length; index += 1) if (isMet(index)) met.push(index);
      const specific = met.filter((index) => !degreeIsGeneralElectives(rules[index]!)).length;
      bestSpecific = Math.max(bestSpecific, specific);
      if (met.length === rules.length) everything = true;
      return;
    }
    const pinnedRule = pinned.get(position);
    if (pinnedRule != null) {
      assignment[position] = pinnedRule;
      assign(position + 1);
      return;
    }
    for (let bucket = 0; bucket <= rules.length; bucket += 1) {
      assignment[position] = bucket;
      assign(position + 1);
    }
  };
  assign(0);
  return { specific: bestSpecific, everything };
}

function describeCase(rules: RequirementRule[], courses: PoolCourse[]): string {
  const plan = courses.map((item) => `${keyId(item.key)} (${creditNumber(item.credits)})`).join(", ");
  const listed = rules.map((rule) => {
    if (rule.kind.type === "required") return `required ${optionCourses(rule.kind.option).map((item) => keyId(item)).join(" / ")}`;
    if (rule.kind.type === "generalElectives") return `general ${creditNumber(rule.kind.hours)}`;
    const count = rule.kind.count == null ? "-" : String(rule.kind.count);
    const hours = rule.kind.hours == null ? "-" : creditNumber(rule.kind.hours);
    const options = rule.kind.options.map((item) => optionCourses(item).map((courseKey) => keyId(courseKey)).join(" and ")).join(", ");
    const ranges = rule.kind.ranges.map((item) => item.label).join(", ");
    return `choose ${count}/${hours} of ${options} ${ranges}`;
  });
  return `plan: ${plan}; rules: ${listed.join("; ")}`;
}

describe("DegreeAuditMatchingTests", () => {
  it("matchesAsManyRequirementsAsPossible", () => {
    const gen = new SeededGenerator(2026);
    let checked = 0;
    for (let round = 0; round < 160; round += 1) {
      const plan = randomPlan(gen);
      const rules = randomRules(plan.courses, gen);
      const pins = randomPins(rules, plan.courses, gen);
      plan.degreePlan.substitutions = pins.map((pin, index) => ({
        id: `pin-${round}-${index}`,
        ruleID: rules[pin.rule]!.id,
        ruleTitle: rules[pin.rule]!.id,
        change: { type: "countCourse" as const, course: plan.courses[pin.course]!.key },
        note: "",
        createdAt: index,
      }));
      const requirements = makeRequirements(rules);
      const audit = runDegreeAudit(plan.degreePlan, requirements);
      const possible = mostThatCanBeMet(rules, plan.courses, pins);
      const context = `${describeCase(rules, plan.courses)}; pins: ${pins.map((pin) => `${keyId(plan.courses[pin.course]!.key)}→${rules[pin.rule]!.id}`).join(", ")}`;
      const specificMet = ruleResults(audit).filter((result) => !degreeIsGeneralElectives(result.rule) && statusIsSatisfied(result.status)).length;
      expect(specificMet, context).toBe(possible.specific);
      if (possible.everything) expect(satisfiedCount(audit), context).toBe(totalCount(audit));
      const counted = ruleResults(audit).flatMap((result) => result.used.map((use) => use.id));
      expect(counted.length).toBe(new Set(counted).size);
      checked += 1;
    }
    expect(checked).toBe(160);
  });

  it("largePlansStayFast", () => {
    const rules: RequirementRule[] = [];
    const cs = POOL.filter((item) => item.key.subject === "CS" && item.credits >= 4).map((item) => item.key);
    for (let index = 0; index < 6; index += 1) {
      const options = swiftShuffled(cs, new SeededGenerator(index)).slice(0, 5).map((item) => option([[item]]));
      rules.push(makeRule(`list-${index}`, { type: "choose", count: 2, hours: null, options, ranges: [] }));
    }
    rules.push(makeRule("electives", { type: "choose", count: null, hours: 12, options: [], ranges: [range("CS", 2000, "CS 2000 or higher")] }));
    rules.push(makeRule("petition", { type: "choose", count: 3, hours: null, options: [], ranges: [range("CS", 0, "Any CS course")] }));
    rules.push(makeRule("general", { type: "generalElectives", hours: 16 }));
    const plan = emptyPlan("Big");
    plan.completed = POOL.map((item) => course(keyId(item.key), item.credits));
    const start = Date.now();
    const audit = runDegreeAudit(plan, makeRequirements(rules));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(totalCount(audit)).toBe(rules.length);
  });
});
