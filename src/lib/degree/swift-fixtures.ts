/**
 * Shared fixtures for the Swift degree-test ports.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseKey } from "@/lib/models";
import { keyId, parseCourseKey } from "@/lib/models";
import type {
  CatalogProgram,
  CatalogYear,
  DegreePlan,
  DegreePlanCourse,
  DegreePlanTerm,
  PlanSeason,
  ProgramRequirements,
  RequirementSubstitution,
  SubstitutionChange,
} from "@/lib/requirements";
import { parseProgramPage } from "@/lib/degree/catalog-parser";

export const program: CatalogProgram = {
  title: "Computer Science, BSCS (Boston)",
  path: "undergraduate/computer-information-science/computer-science/bscs/",
};

export const year: CatalogYear = { startYear: 2023 };

export const programPage = `
<html><body>
<div id="textcontainer" class="page_content"><p>About the program.</p></div>
<div id="programrequirementstextcontainer" class="tab_content">
<p>Complete all courses listed below unless otherwise indicated.</p>
<h2>Major Requirements</h2>
<table class="sc_courselist"><tbody>
<tr class="hidden noscript"><th scope="col">Code</th><th scope="col">Title</th><th scope="col" class="hourscol">Hours</th></tr>
<tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Required Courses</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a href="/search/?P=CS%201800" title="CS 1800" class="bubblelink code">CS&#160;1800</a><span style="margin-left:20px;" class="blockindent">and <a href="/search/?P=CS%201802" class="bubblelink code">CS&#160;1802</a></span></td><td>Discrete Structures</td><td class="hourscol">5</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4500</a></td><td>Software Development</td><td class="hourscol">4</td></tr>
<tr class="orclass odd"><td class="codecol orclass">or <a class="bubblelink code">CS&#160;4530</a></td><td colspan="2"> Fundamentals of Software Engineering</td></tr>
<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Security Course</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete one of the following:</span></td><td class="hourscol">4</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CY&#160;2550</a></td><td>Foundations of Cybersecurity</td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CY&#160;3740</a></td><td>Systems Security</td><td class="hourscol"></td></tr>
<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Khoury Elective Courses</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">With adviser approval, directed study may also be taken as an elective.</span></td><td class="hourscol"></td></tr>
<tr class="even"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS, CY, DS, or IS classes that are not already required. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
<tr class="odd"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher, except <a class="bubblelink code">CS&#160;5010</a></span></div></td><td class="hourscol"></td></tr>
<tr class="even lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">DS&#160;2500</a> to DS 4999 but not <a class="bubblelink code">DS&#160;4900</a></span></div></td><td class="hourscol"></td></tr>
</tbody></table>
<h2>Supporting Courses</h2>
<table class="sc_courselist"><tbody>
<tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Science Requirement</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete two courses (and any required labs) from the following science categories:</span></td><td class="hourscol">8</td></tr>
<tr class="even areasubheader undefined subheader "><td colspan="2"><span class="courselistcomment areasubheader undefined"><i>Biology</i></span></td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">BIOL&#160;1111</a><br/><span class="blockindent">and <a class="bubblelink code">BIOL&#160;1112</a></span></td><td>General Biology 1<br/><span class="blockindent">and Lab for BIOL 1111</span></td><td class="hourscol"></td></tr>
<tr class="even areasubheader undefined subheader "><td colspan="2"><span class="courselistcomment areasubheader undefined"><i>Mathematics</i></span></td><td class="hourscol"></td></tr>
<tr class="odd lastrow"><td class="codecol"><a class="bubblelink code">MATH&#160;2331</a></td><td>Linear Algebra</td><td class="hourscol"></td></tr>
</tbody></table>
<h2>Required General Electives</h2>
<table class="sc_courselist"><tbody>
<tr class="even lastrow firstrow"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of general electives.</span></td><td class="hourscol">8</td></tr>
</tbody></table>
<h2>Major GPA Requirement</h2>
<p>Minimum 2.000 GPA required in the major.</p>
<h2>Program Requirement</h2>
<p>52 total semester hours required</p>
<h2>Concentration in Human-Centered Computing*</h2>
<table class="sc_courselist"><tbody>
<tr class="even firstrow"><td class="codecol"><a class="bubblelink code">CS&#160;2484</a></td><td>Principles of Human-Computer Interaction</td><td class="hourscol">4</td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete two of the following not already taken:</span></td><td class="hourscol">8</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CS&#160;4520</a></td><td>Mobile Application Development</td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4550</a></td><td>Web Development</td><td class="hourscol"></td></tr>
<tr class="even lastrow"><td class="codecol"><a class="bubblelink code">DS&#160;4200</a></td><td>Information Presentation and Visualization</td><td class="hourscol"></td></tr>
</tbody></table>
<p>*This concentration requires a fall co-op pattern.</p>
<h2>Software Concentration</h2>
<table class="sc_courselist"><tbody>
<tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;4400</a></td><td>Programming Languages</td><td class="hourscol">4</td></tr>
</tbody></table>
</div>
<div id="planofstudytextcontainer" class="tab_content">
<table class="sc_courselist"><tbody><tr><td class="codecol"><a>CS&#160;9999</a></td><td>Not a requirement</td><td class="hourscol">4</td></tr></tbody></table>
</div>
</body></html>
`;

let courseN = 0;
let subN = 0;

export function key(code: string): CourseKey {
  const parsed = parseCourseKey(code);
  if (!parsed) throw new Error(code);
  return parsed;
}

export function course(code: string, credits = 4, title = ""): DegreePlanCourse {
  courseN += 1;
  const parsed = parseCourseKey(code);
  return { id: `c${courseN}`, key: parsed, label: parsed ? `${parsed.subject} ${parsed.number}` : code, title, credits };
}

export function emptyPlan(name = "Plan"): DegreePlan {
  return {
    id: `plan-${name}`,
    name,
    completed: [],
    terms: [],
    isPrimary: false,
    createdAt: 0,
    updatedAt: 0,
    substitutions: [],
    courseEquivalences: [],
  };
}

export function term(id: string, season: PlanSeason, yearNumber: number, courses: DegreePlanCourse[] = []): DegreePlanTerm {
  return { id, season, year: yearNumber, courses };
}

export function requirementsFrom(html: string, catalogYear: CatalogYear = year, catalogProgram: CatalogProgram = program): ProgramRequirements {
  const parsed = parseProgramPage(html, catalogYear, catalogProgram);
  if (!parsed) throw new Error("program page did not parse");
  return parsed;
}

export function requirements(): ProgramRequirements {
  return requirementsFrom(programPage);
}

/** The human-centered computing student from DegreeRequirementsTests.plan. */
export function samplePlan(): DegreePlan {
  const plan = emptyPlan("Plan");
  plan.completed = [
    course("CS 1800"),
    course("CS 1802", 1),
    course("CS 3000"),
    course("CY 2550"),
    course("CS 4973", 4, "Topics in Computer Science"),
    course("CS 2484"),
    course("CS 4520"),
    course("CS 4535", 4, "Prof Practicum Capstone"),
    course("CS 2501", 1),
    course("MATH 1341"),
    course("CS 3000", 0),
  ];
  plan.terms = [term("spring-2027", "spring", 2027, [course("CS 3800"), course("CS 4100"), course("DS 3000"), course("CS 4410")])];
  plan.catalogYear = 2023;
  plan.catalogProgramPath = program.path;
  plan.concentrationID = "concentration-in-human-centered-computing";
  return plan;
}

export function substitution(ruleID: string, ruleTitle: string, change: SubstitutionChange, note = ""): RequirementSubstitution {
  subN += 1;
  return { id: `sub-${subN}`, ruleID, ruleTitle, change, note, createdAt: subN };
}

export function must<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(label);
  return value;
}

export function sortedKeyIds(keys: readonly CourseKey[]): string[] {
  return keys.map((item) => keyId(item)).sort();
}

/** SplitMix64, matching the Swift test generators. */
export class SeededGenerator {
  state: bigint;

  constructor(seed: bigint | number) {
    this.state = BigInt(seed);
  }

  next(): bigint {
    const mask = (1n << 64n) - 1n;
    this.state = (this.state + 0x9e3779b97f4a7c15n) & mask;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return (z ^ (z >> 31n)) & mask;
  }
}

export function randInt(gen: SeededGenerator, min: number, maxInclusive: number): number {
  const span = maxInclusive - min + 1;
  return min + Number(gen.next() % BigInt(span));
}

export function randBool(gen: SeededGenerator): boolean {
  return (gen.next() & 1n) === 0n;
}

export function shuffled<T>(items: readonly T[], gen: SeededGenerator): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Number(gen.next() % BigInt(i + 1));
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy;
}

export function randomElement<T>(items: readonly T[], gen: SeededGenerator): T {
  return items[Number(gen.next() % BigInt(items.length))]!;
}
