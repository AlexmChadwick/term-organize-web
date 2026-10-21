/**
 * Port of NEUClassSearchTests/DegreeNUpathTests.swift.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import { CourseAttributeRepository, type AttributeFetching, type AttributeLookup } from "@/lib/degree/attributes";
import { countedChecks, hoursStatus, runDegreeAudit, satisfiedCount, statusIsSatisfied, totalCount, uncheckedReason, type DegreeAudit, type NoteCheck } from "@/lib/degree/audit";
import { parseProgramPage, parseUniversitywide, universitywideLink } from "@/lib/degree/catalog-parser";
import { creditsLine } from "@/lib/degree/substitutions";
import { NUPATH_REQUIREMENTS, NUpathMatching, type DegreeCourseAttributes, type NUpathCourse, type NUpathRequirement } from "@/lib/degree/nupath";
import { SeededGenerator, course, emptyPlan, key, term } from "@/lib/degree/swift-fixtures";
import type { Course, CourseKey, CourseSection, Term } from "@/lib/models";
import { NU_PATHS, keyId, type NuPathInfo } from "@/lib/models";
import type { CatalogProgram, CatalogYear, DegreePlan, ProgramRequirements, UniversitywideRequirements } from "@/lib/requirements";

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

const program: CatalogProgram = {
  title: "Computer Science, BSCS (Boston)",
  path: "undergraduate/computer-information-science/computer-science/bscs/",
};

const year: CatalogYear = { startYear: 2024 };

const page = `
    <div id="programrequirementstextcontainer" class="tab_content">
    <h2>Universitywide Requirements</h2>
    <p>All undergraduate students are required to complete the <a href="/archive/2024-2025/undergraduate/university-academics/university-wide-requirements/">Universitywide Requirements</a>.</p>
    <h2>NUpath Requirements</h2>
    <p>All undergraduate students are required to complete the <a href="/archive/2024-2025/undergraduate/university-academics/nupath/">NUpath Requirements</a>.</p>
    <h2>Major Requirements</h2>
    <table class="sc_courselist"><tbody>
    <tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
    </tbody></table>
    <h2>Khoury College GPA Requirement</h2>
    <p>Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses</p>
    <h2>NUpath Requirements Satisfied</h2>
    <p>Integrating Knowledge and Skills Through Experience is satisfied through co-op.</p>
    <h2>Program Requirement</h2>
    <p>134 total semester hours required</p>
    </div>
    `;

function requirements(universitywide?: UniversitywideRequirements | null): ProgramRequirements {
  const parsed = parseProgramPage(page, year, program);
  if (!parsed) throw new Error("program page did not parse");
  if (universitywide !== undefined) parsed.universitywide = universitywide;
  return parsed;
}

function nupathPlan(): DegreePlan {
  const plan = emptyPlan("NUpath");
  plan.completed = ["ENGW 1111", "MATH 1341", "PHYS 1151", "CS 3200", "PHIL 1145", "ARTH 1111", "HIST 1130", "CS 3000"].map((code) => course(code));
  plan.completed.push(course("COOP 3946", 0, "Co-op Work Experience - HT"));
  plan.terms = [term("spring-2027", "spring", 2027, [course("ENGW 3302"), course("CS 4535"), course("CS 3484")])];
  return plan;
}

const BASE_ATTRIBUTES: Record<string, readonly string[]> = {
  "ENGW 1111": ["WF"],
  "MATH 1341": ["FQ"],
  "PHYS 1151": ["ND"],
  "CS 3200": ["AD", "FQ"],
  "PHIL 1145": ["ER", "SI"],
  "ARTH 1111": ["IC", "EI"],
  "HIST 1130": ["DD", "SI"],
  "CS 3000": ["FQ"],
  "ENGW 3302": ["WD"],
  "CS 4535": ["CE", "EX", "WI"],
  "CS 3484": ["WI"],
};

function attributes(table: Record<string, readonly string[] | undefined> = BASE_ATTRIBUTES, loading: readonly string[] = []): DegreeCourseAttributes {
  const nupaths = new Map<string, ReadonlySet<string>>();
  for (const [id, codes] of Object.entries(table)) {
    if (codes == null) continue;
    nupaths.set(id, new Set(codes));
  }
  return { nupaths, loading: new Set(loading) };
}

function nupathCheck(audit: DegreeAudit): NoteCheck | undefined {
  return audit.noteChecks.find((check) => check.kind.type === "nupath");
}

function pathByShort(short: string): NuPathInfo {
  const found = NU_PATHS.find((item) => item.short === short);
  if (!found) throw new Error(short);
  return found;
}

function item(check: NoteCheck | undefined, short: string) {
  return check?.items.find((entry) => entry.id === pathByShort(short).code);
}

describe("DegreeNUpathTests", () => {
  it("everyNUpathRequirementIsChecked", () => {
    const audit = runDegreeAudit(nupathPlan(), requirements(), undefined, attributes());
    const check = nupathCheck(audit);
    if (!check) throw new Error("nupath");
    expect(check.items.map((entry) => entry.id)).toEqual(NUPATH_REQUIREMENTS.map((requirement) => requirement.path.code));
    expect(check.items.every((entry) => entry.status != null && statusIsSatisfied(entry.status))).toBe(true);
    expect(check.status).toBe("planned");
    expect(check.counts).toBe(true);
    expect(check.detail).toBe("13 of 13 met");
    expect(item(check, "WF")?.detail).toBe("ENGW 1111 completed");
    expect(item(check, "WI")?.courses).toEqual(["CS 4535", "CS 3484"]);
    expect(item(check, "WI")?.detail).toBe("CS 4535 planned · Spring 2027 · CS 3484 planned · Spring 2027");
    expect(item(check, "CE")?.courses).toEqual(["CS 4535"]);
    expect(item(check, "EX")?.courses).toEqual(["COOP 3946"]);
    expect(item(check, "EX")?.status).toBe("complete");
    const areas = new Map<string, number>();
    for (const requirement of NUPATH_REQUIREMENTS) {
      if (!requirement.isLimited) continue;
      for (const id of item(check, requirement.path.short)?.courses ?? []) areas.set(id, (areas.get(id) ?? 0) + 1);
    }
    expect([...areas.values()].every((count) => count <= 2)).toBe(true);
    expect(countedChecks(audit).some((check) => check.kind.type === "nupath" && statusIsSatisfied(check.status))).toBe(true);
  });

  it("aCourseCountsForTwoAreasAtMost", () => {
    const table: Record<string, readonly string[] | undefined> = { ...BASE_ATTRIBUTES };
    table["ARTH 1111"] = ["IC", "EI", "DD"];
    table["HIST 1130"] = [];
    const baseline = runDegreeAudit(nupathPlan(), requirements(), undefined, attributes());
    const audit = runDegreeAudit(nupathPlan(), requirements(), undefined, attributes(table));
    const check = nupathCheck(audit);
    if (!check) throw new Error("nupath");
    const open = check.items.filter((entry) => entry.status == null || !statusIsSatisfied(entry.status));
    expect(open.length).toBe(1);
    expect(open[0]?.status).toBe("missing");
    expect(open[0]?.detail).toBe("No course in the plan has it");
    expect(check.status === "partial" && check.counts).toBe(true);
    expect(check.detail.startsWith("12 of 13 met · missing ")).toBe(true);
    expect(satisfiedCount(audit)).toBe(satisfiedCount(baseline) - 1);
    expect(totalCount(audit)).toBe(totalCount(baseline));
  });

  it("unknownCoursesKeepAShortfallFromCounting", () => {
    const table: Record<string, readonly string[] | undefined> = { ...BASE_ATTRIBUTES };
    table["HIST 1130"] = undefined;
    const parsed = requirements();
    const audit = runDegreeAudit(nupathPlan(), parsed, undefined, attributes(table));
    const check = nupathCheck(audit);
    if (!check) throw new Error("nupath");
    expect(item(check, "DD")?.status).toBeNull();
    expect(item(check, "DD")?.detail).toBe("Not found among the courses with NUpath data");
    expect(check.counts).toBe(false);
    expect(check.detail).toBe("12 of 13 met · no NUpath data for HIST 1130");
    expect(countedChecks(audit).some((entry) => entry.kind.type === "nupath")).toBe(false);

    const loading = runDegreeAudit(nupathPlan(), parsed, undefined, attributes(table, ["HIST 1130"]));
    const pending = nupathCheck(loading);
    if (!pending) throw new Error("pending");
    expect(item(pending, "DD")?.detail).toBe("Looking up the plan’s courses…");
    expect(pending.detail).toBe("12 of 13 met · looking up 1 course");

    table["HIST 1130"] = undefined;
    table["ARTH 1111"] = ["IC", "DD"];
    table["CS 3000"] = ["EI"];
    const met = nupathCheck(runDegreeAudit(nupathPlan(), parsed, undefined, attributes(table)));
    if (!met) throw new Error("met");
    expect(met.counts && met.status === "planned").toBe(true);
  });

  it("withoutAttributesNUpathIsNotChecked", () => {
    const audit = runDegreeAudit(nupathPlan(), requirements());
    expect(nupathCheck(audit)).toBeUndefined();
  });

  it("aRenumberedCourseUsesItsReplacementsAttributes", () => {
    const plan = nupathPlan();
    plan.completed[2] = course("PHYS 1145");
    const table: Record<string, readonly string[] | undefined> = { ...BASE_ATTRIBUTES };
    table["PHYS 1151"] = undefined;
    table["PHYS 1149"] = ["ND"];
    plan.courseEquivalences = [{ id: "eq-phys", course: key("PHYS 1145"), countsAs: key("PHYS 1149"), note: "Renumbered" }];
    const check = nupathCheck(runDegreeAudit(plan, requirements(), undefined, attributes(table)));
    if (!check) throw new Error("nupath");
    expect(item(check, "ND")?.courses).toEqual(["PHYS 1145"]);
    expect(check.counts).toBe(true);
  });

  it("withoutACoopAnExperienceCourseCounts", () => {
    const plan = nupathPlan();
    plan.completed = plan.completed.filter((item) => item.key?.subject !== "COOP");
    const audit = runDegreeAudit(plan, requirements(), undefined, attributes());
    const coop = audit.noteChecks.find((check) => check.kind.type === "coop");
    if (!coop) throw new Error("coop");
    expect(coop.status).toBe("planned");
    expect(coop.detail).toBe("No co-op in the plan · CS 4535 (EX) planned");
    expect(item(nupathCheck(audit), "EX")?.courses).toEqual(["CS 4535"]);
  });

  it("matchingIsOptimal", () => {
    const gen = new SeededGenerator(2016);
    const areas = NUPATH_REQUIREMENTS.filter((requirement) => requirement.isLimited).map((requirement) => requirement.path);
    let samples = 0;
    while (samples < 600) {
      samples += 1;
      const wanted = swiftShuffled(areas, gen).slice(0, randomInt(gen, 1, 5));
      const courses: NUpathCourse[] = Array.from({ length: randomInt(gen, 1, 5) }, (_, index) => ({
        id: `C${index}`,
        paths: new Set(wanted.filter(() => randomInt(gen, 0, 9) < 4)),
        isCompleted: randomBool(gen),
      }));
      const requirementsFor: NUpathRequirement[] = wanted.map((path) => ({ path, count: 1, isLimited: true }));
      const matching = new NUpathMatching(courses, requirementsFor);
      const chosen = wanted.flatMap((area) => {
        const id = matching.coursesFor(area)[0];
        return id ? [{ area, id }] : [];
      });
      const completed = chosen.filter((pair) => courses.find((item) => item.id === pair.id)?.isCompleted === true).length;
      expect(chosen.every((pair) => courses.find((item) => item.id === pair.id)?.paths.has(pair.area) === true)).toBe(true);
      const byCourse = new Map<string, number>();
      for (const pair of chosen) byCourse.set(pair.id, (byCourse.get(pair.id) ?? 0) + 1);
      expect([...byCourse.values()].every((count) => count <= 2)).toBe(true);

      let best = { met: 0, completed: 0 };
      const search = (position: number, load: number[], met: number, done: number) => {
        if (position >= wanted.length) {
          if (met > best.met || (met === best.met && done > best.completed)) best = { met, completed: done };
          return;
        }
        search(position + 1, load, met, done);
        for (let index = 0; index < courses.length; index += 1) {
          const item = courses[index]!;
          if (!item.paths.has(wanted[position]!) || load[index]! >= 2) continue;
          const next = load.slice();
          next[index] = (next[index] ?? 0) + 1;
          search(position + 1, next, met + 1, done + (item.isCompleted ? 1 : 0));
        }
      };
      search(0, Array<number>(courses.length).fill(0), 0, 0);
      expect(chosen.length).toBe(best.met);
      expect(completed).toBe(best.completed);
    }
    expect(samples).toBe(600);
  });

  it("readsTheUniversitywideMinimums", () => {
    const archived = `
        <div id="textcontainer"><p>Note: Individual program requirements may exceed the following minima.</p>
        <ul><li>Minimum 128 total semester hours required</li><li>Minimum 2.000 GPA required</li></ul>
        <p>Students must earn a minimum of 64 Northeastern University semester hours in order to receive a bachelor’s degree.</p></div>
        `;
    const minimums = parseUniversitywide(archived);
    if (!minimums) throw new Error("minimums");
    expect(minimums.totalHours === 128 && minimums.gpa === 2 && minimums.residencyHours === 64).toBe(true);
    expect(minimums.requiresExperientialLearning).toBe(false);
    const current = archived.replace("</div>", "<p>Students must complete all university and program requirements, including the experiential learning graduation requirement.</p></div>");
    expect(parseUniversitywide(current)?.requiresExperientialLearning).toBe(true);
    expect(parseUniversitywide(`<div id="textcontainer"><p>Nothing here.</p></div>`)).toBeNull();
    expect(universitywideLink(page)).toBe("undergraduate/university-academics/university-wide-requirements/");
  });

  it("checksTheUniversitywideMinimumsItCan", () => {
    const minimums: UniversitywideRequirements = { totalHours: 128, gpa: 2, residencyHours: 64, requiresExperientialLearning: false, fetchedAt: Date.now() };
    const audit = runDegreeAudit(nupathPlan(), requirements(minimums), undefined, attributes());
    const check = audit.noteChecks.find((entry) => entry.kind.type === "universitywide");
    if (!check) throw new Error("universitywide");
    expect(check.items.map((entry) => entry.id)).toEqual(["total-hours", "gpa", "residency"]);
    expect(check.items[0]?.status).toBe("partial");
    expect(check.items[0]?.detail).toBe("32 of 128 semester hours · 12 planned");
    expect(check.items[1]?.status == null && check.items[1]?.detail === "Not checked: plans don’t include grades").toBe(true);
    expect(check.items[2]?.status).toBeNull();
    expect(check.status === "partial" && check.counts).toBe(true);
    expect(check.detail).toBe("32 of 128 semester hours · 12 planned · GPA and residency not checked");

    const unread = runDegreeAudit(nupathPlan(), requirements(), undefined, attributes());
    expect(unread.noteChecks.some((entry) => entry.kind.type === "universitywide")).toBe(false);
  });

  it("checksTheProgramsTotalHours", () => {
    const audit = runDegreeAudit(nupathPlan(), requirements());
    const check = audit.noteChecks.find((entry) => entry.kind.type === "totalHours");
    if (!check) throw new Error("total hours");
    expect(check.status).toBe("partial");
    expect(check.detail).toBe("32 of 134 semester hours · 12 planned");
  });

  it("hoursLinesKeepCompletedSeparateFromPlanned", () => {
    expect(hoursStatus(105, 30, 128)).toEqual({ status: "planned", detail: "105 of 128 semester hours · 30 planned" });
    expect(hoursStatus(105, 30, 134)).toEqual({ status: "planned", detail: "105 of 134 semester hours · 30 planned" });
    expect(hoursStatus(60, 22, 72)).toEqual({ status: "planned", detail: "60 of 72 semester hours · 22 planned" });
    expect(hoursStatus(128, 0, 128)).toEqual({ status: "complete", detail: "128 of 128 semester hours" });
    expect(hoursStatus(140, 10, 128)).toEqual({ status: "complete", detail: "140 of 128 semester hours · 10 planned" });
    expect(hoursStatus(90, 20, 128)).toEqual({ status: "partial", detail: "90 of 128 semester hours · 20 planned" });
    expect(hoursStatus(0, 0, 128)).toEqual({ status: "missing", detail: "0 of 128 semester hours" });
    expect(hoursStatus(0, 128, 128)).toEqual({ status: "planned", detail: "0 of 128 semester hours · 128 planned" });

    const hoursPage = `
        <div id="programrequirementstextcontainer" class="tab_content">
        <h2>Universitywide Requirements</h2>
        <p>All undergraduate students are required to complete the Universitywide Requirements.</p>
        <h2>Major Requirements</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even firstrow"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms</td><td class="hourscol">4</td></tr>
        <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS classes. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
        <tr class="even lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher</span></div></td><td class="hourscol"></td></tr>
        </tbody></table>
        <h2>Writing Requirement</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">ENGW&#160;1111</a></td><td>First-Year Writing</td><td class="hourscol">4</td></tr>
        </tbody></table>
        <h2>Required General Electives</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even lastrow firstrow"><td colspan="2"><span class="courselistcomment">Complete 4 semester hours of general electives.</span></td><td class="hourscol">4</td></tr>
        </tbody></table>
        <h2>Credit Requirement</h2>
        <p>Complete 72 semester hours in the major.</p>
        <h2>Program Requirement</h2>
        <p>134 total semester hours required</p>
        </div>
        `;
    const hoursRequirements = parseProgramPage(hoursPage, year, program);
    if (!hoursRequirements) throw new Error("hours page");
    hoursRequirements.universitywide = { totalHours: 128, gpa: 2, residencyHours: 64, requiresExperientialLearning: false, fetchedAt: Date.now() };
    const plan = emptyPlan("BS CS");
    plan.completed = [course("CS 3000", 40), course("CS 2500", 20), course("ENGW 1111", 4), course("PHIL 1102", 41)];
    plan.terms = [term("spring", "spring", 2027, [course("CS 3500", 22), course("MKTG 2201", 8)])];
    const audit = runDegreeAudit(plan, hoursRequirements);
    expect(audit.completedHours).toBe(105);
    expect(audit.plannedHours).toBe(30);
    expect(audit.requiredHours).toBe(134);
    expect(creditsLine(audit)).toBe("105 of 134 credits done · 30 planned");

    const university = audit.noteChecks.find((entry) => entry.kind.type === "universitywide");
    if (!university) throw new Error("universitywide");
    expect(university.status).toBe("planned");
    expect(university.items[0]?.status).toBe("planned");
    expect(university.items[0]?.detail).toBe("105 of 128 semester hours · 30 planned");
    expect(university.detail).toBe("105 of 128 semester hours · 30 planned · GPA and residency not checked");

    const total = audit.noteChecks.find((entry) => entry.kind.type === "totalHours");
    if (!total) throw new Error("total hours");
    expect(total.status).toBe("planned");
    expect(total.detail).toBe("105 of 134 semester hours · 30 planned");

    const major = audit.noteChecks.find((entry) => entry.kind.type === "majorHours");
    if (!major) throw new Error("major hours");
    expect(major.status).toBe("planned");
    expect(major.detail).toBe("60 of 72 semester hours · 22 planned");
  });

  it("saysWhySomeSentencesArentChecked", () => {
    expect(uncheckedReason("Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses")).toBe("Not checked: plans don’t include grades");
    expect(uncheckedReason("Students must earn a minimum of 64 Northeastern University semester hours.")).toBe("Not checked: a plan doesn’t say where credits were earned");
    expect(uncheckedReason("Pick one of the following concentrations and complete four courses in that concentration.")).toBe("Checked through the concentration you choose");
    expect(uncheckedReason("Courses may not be taken pass/fail.")).toBeNull();
  });
});

class FakeSections implements AttributeFetching {
  calls: { term: string; courses: CourseKey[] }[] = [];
  failing = new Set<string>();
  private readonly byTerm: Map<string, Map<string, Set<string>>>;

  constructor(byTerm: Record<string, Record<string, string[]>>) {
    this.byTerm = new Map(Object.entries(byTerm).map(([termCode, courses]) => [
      termCode,
      new Map(Object.entries(courses).map(([code, codes]) => [code, new Set(codes)])),
    ]));
  }

  async terms(): Promise<Term[]> {
    return ["202710", "202655", "202650", "202630", "202610", "202560", "202550", "202540", "202530", "202510"].map((code) => ({
      code,
      bannerDescription: "",
    }));
  }

  async sectionAttributes(termCode: string, courses: CourseKey[]): Promise<Map<string, Set<string>>> {
    this.calls.push({ term: termCode, courses });
    if (this.failing.has(termCode)) throw new Error("http 503");
    const found = this.byTerm.get(termCode) ?? new Map<string, Set<string>>();
    const result = new Map<string, Set<string>>();
    for (const courseKey of courses) {
      const codes = found.get(keyId(courseKey));
      if (codes) result.set(keyId(courseKey), codes);
    }
    return result;
  }
}

function loadedIndex(): CatalogIndex {
  const writing: Course = {
    subject: "ENGW",
    number: "1111",
    title: "First-Year Writing",
    description: "",
    minCredits: 4,
    maxCredits: 4,
    attributes: ["NCW1"],
    prereqs: null,
    coreqs: null,
    postreqs: [],
    specialTopics: false,
    college: null,
    department: null,
    detailsLoaded: true,
  };
  const section: CourseSection = {
    crn: "10001",
    subject: "ENGW",
    number: "1111",
    title: "First-Year Writing",
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 20,
    seatsRemaining: 2,
    enrollment: 18,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    instructionMethod: "Traditional",
    meetings: [],
    instructors: [],
    crossListCRNs: [],
    attributes: ["NCW1"],
    description: null,
    prereqs: null,
    coreqs: null,
  };
  return CatalogIndex.build({
    version: 1,
    term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses: [writing],
    sections: [section],
    subjects: [],
    attributes: [],
    campuses: [],
  });
}

function sameLookup(left: AttributeLookup, right: AttributeLookup): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== "found" || right.type !== "found") return true;
  if (left.term !== right.term || left.codes.size !== right.codes.size) return false;
  for (const code of left.codes) if (!right.codes.has(code)) return false;
  return true;
}

function lookupsEqual(left: Map<string, AttributeLookup>, right: Map<string, AttributeLookup>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, value] of left) {
    const other = right.get(id);
    if (!other || !sameLookup(value, other)) return false;
  }
  return true;
}

describe("CourseAttributeRepositoryTests", () => {
  it("searchesRecentTermsUntilACourseHasSections", async () => {
    const banner = new FakeSections({
      "202630": { "CS 3386": ["NCFQ", "NCEI"] },
      "202610": { "HIST 1130": ["NCDD", "NCSI"], "CS 3386": ["NCFQ"] },
    });
    const directory = await mkdtemp(path.join(tmpdir(), "attributes-"));
    try {
      const repository = new CourseAttributeRepository({ fetcher: banner, directory });
      const keys = [key("ENGW 1111"), key("CS 3386"), key("HIST 1130"), key("ZZZZ 9999")];
      const results = await repository.lookup(keys, [loadedIndex()]);
      expect(results.get(keyId(key("ENGW 1111")))).toEqual({ type: "found", codes: new Set(["NCW1"]), term: "202710" });
      expect(results.get(keyId(key("CS 3386")))).toEqual({ type: "found", codes: new Set(["NCFQ", "NCEI"]), term: "202630" });
      expect(results.get(keyId(key("HIST 1130")))).toEqual({ type: "found", codes: new Set(["NCDD", "NCSI"]), term: "202610" });
      expect(results.get(keyId(key("ZZZZ 9999")))).toEqual({ type: "notFound" });
      expect(banner.calls.some((call) => call.term === "202710" || call.term === "202655")).toBe(false);
      expect(banner.calls.find((call) => call.term === "202610")?.courses.map((courseKey) => keyId(courseKey))).toEqual(["HIST 1130", "ZZZZ 9999"]);
      expect(banner.calls.find((call) => call.term === "202560")?.courses.map((courseKey) => keyId(courseKey))).toEqual(["ZZZZ 9999"]);

      const again = new CourseAttributeRepository({ fetcher: banner, directory });
      const calls = banner.calls.length;
      expect(lookupsEqual(await again.lookup(keys, [loadedIndex()]), results)).toBe(true);
      expect(banner.calls.length).toBe(calls);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("failuresAreNotCached", async () => {
    const banner = new FakeSections({ "202610": { "HIST 1130": ["NCDD"] } });
    banner.failing = new Set(["202650"]);
    const directory = await mkdtemp(path.join(tmpdir(), "attributes-"));
    try {
      const repository = new CourseAttributeRepository({ fetcher: banner, directory });
      const first = await repository.lookup([key("HIST 1130")]);
      expect(first.get(keyId(key("HIST 1130")))).toEqual({ type: "failed" });
      banner.failing = new Set();
      const second = await repository.lookup([key("HIST 1130")]);
      expect(second.get(keyId(key("HIST 1130")))).toEqual({ type: "found", codes: new Set(["NCDD"]), term: "202610" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
