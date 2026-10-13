/**
 * Port of NEUClassSearchTests/DegreeSubstitutionPresentationTests.swift.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { resultFor, runDegreeAudit, type DegreeAudit, type NoteCheck } from "@/lib/degree/audit";
import { parseProgramPage } from "@/lib/degree/catalog-parser";
import {
  convertRenumbering,
  coursesToLookUpForRenumbering,
  declareRenumbering,
  filterIncludesCheck,
  likelyRenumberingMap,
  likelyRenumberings,
  noteEntries,
  renumberableSubstitutionIDs,
  requirementName,
  rowCaption,
  splitUnlisted,
  substituteCaption,
  substituteNote,
  undoRenumbering,
  type DegreeCourseRowInfo,
  type DegreeNoteEntry,
} from "@/lib/degree/substitutions";
import { course, emptyPlan, key, must, requirements, samplePlan, term } from "@/lib/degree/swift-fixtures";
import { declareEquivalence, unorderedPairId } from "@/lib/degree/suggestions";
import type { CourseKey } from "@/lib/models";
import { keyId, sameKey } from "@/lib/models";
import type { CatalogProgram, DegreePlan, ProgramRequirements, RequirementRule, RequirementSubstitution } from "@/lib/requirements";
import { allRules, listedCourses } from "@/lib/requirements";

const cs3000 = key("CS 3000");
const cs3001 = key("CS 3001");
const cs4535 = key("CS 4535");
const cs4973 = key("CS 4973");
const cy3740 = key("CY 3740");

function ruleLabeled(parsed: ProgramRequirements, label: string): RequirementRule {
  return must(allRules(parsed).find((rule) => rule.label === label), label);
}

function substitution(rule: RequirementRule, title: string, courseKey: CourseKey, note = ""): RequirementSubstitution {
  return { id: `${rule.id}:${keyId(courseKey)}:${note}`, ruleID: rule.id, ruleTitle: title, change: { type: "countCourse", course: courseKey }, note, createdAt: 1 };
}

function renumberedPlan(parsed: ProgramRequirements): { plan: DegreePlan; renumbering: RequirementSubstitution; waiver: RequirementSubstitution } {
  const plan = samplePlan();
  plan.completed = plan.completed.filter((item) => !item.key || !sameKey(item.key, cs3000));
  plan.completed.push(course("CS 3001"));
  const required = ruleLabeled(parsed, "CS 3000");
  const security = ruleLabeled(parsed, "Complete one of the following:");
  const renumbering: RequirementSubstitution = { id: "renumbering", ruleID: required.id, ruleTitle: "CS 3000", change: { type: "countCourse", course: cs3001 }, note: "Approved", createdAt: 1 };
  const waiver: RequirementSubstitution = { id: "waiver", ruleID: security.id, ruleTitle: "Security Course", change: { type: "waive" }, note: "", createdAt: 2 };
  plan.substitutions = [renumbering, waiver];
  return { plan, renumbering, waiver };
}

const notesPage = `
    <div id="programrequirementstextcontainer" class="tab_content">
    <h2>Major Requirements</h2>
    <table class="sc_courselist"><tbody>
    <tr class="even firstrow"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
    <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS classes. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
    <tr class="even lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher</span></div></td><td class="hourscol"></td></tr>
    </tbody></table>
    <h2>GPA Requirement</h2>
    <p>Minimum 2.000 GPA required in the major.</p>
    <h2>Credit Requirement</h2>
    <p>Complete 12 semester hours in the major.</p>
    <h2>NUpath Requirements Satisfied</h2>
    <p>Integrating Knowledge and Skills Through Experience is satisfied through co-op.</p>
    <h2>Program Requirement</h2>
    <p>12 total semester hours required</p>
    </div>
    `;

function notesAudit(completed: string[], planned: string[] = []): { audit: DegreeAudit; requirements: ProgramRequirements } {
  const notesProgram: CatalogProgram = { title: "Notes, BS", path: "undergraduate/notes/" };
  const parsed = parseProgramPage(notesPage, { startYear: 2024 }, notesProgram);
  if (!parsed) throw new Error("notes page did not parse");
  const plan = emptyPlan("Notes");
  plan.completed = completed.map((code) => (code === "COOP 3946" ? course(code, 0, "Co-op Work Experience - HT") : course(code)));
  const fall = term("fall-2027", "fall", 2027, planned.map((code) => course(code)));
  plan.terms = [fall];
  return { audit: runDegreeAudit(plan, parsed), requirements: parsed };
}

function entries(filter: "all" | "remaining" | "done", audit: DegreeAudit, parsed: ProgramRequirements): Record<string, DegreeNoteEntry> {
  const found: Record<string, DegreeNoteEntry> = {};
  for (const section of parsed.sections) {
    for (const entry of noteEntries(section, audit, filter, parsed.totalHours != null)) found[section.title] = entry;
  }
  return found;
}

function noteCheck(counts: boolean): NoteCheck {
  return {
    sectionID: "nupath-requirements",
    note: "NUpath",
    kind: { type: "nupath" },
    status: "missing",
    detail: "looking up 2 courses",
    items: [],
    counts,
    id: "nupath-requirements|NUpath",
    title: "NUpath requirements",
  };
}

describe("DegreeSubstitutionPresentationTests", () => {
  it("onlyASubstitutionForOneNamedCourseIsARenumbering", () => {
    const parsed = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(parsed);
    const either = ruleLabeled(parsed, "CS 4500 or CS 4530");
    const other = structuredClone(plan);
    other.substitutions = [
      ...other.substitutions,
      substitution(either, "CS 4500 or CS 4530", cs4535),
      { id: "same", ruleID: renumbering.ruleID, ruleTitle: "CS 3000", change: { type: "countCourse", course: cs3000 }, note: "", createdAt: 3 },
    ];
    expect(renumberableSubstitutionIDs(other, parsed)).toEqual(new Set([renumbering.id]));
    expect(renumberableSubstitutionIDs(other, parsed).has(waiver.id)).toBe(false);
    expect(coursesToLookUpForRenumbering(other, parsed).map((item) => keyId(item))).toEqual(["CS 3000", "CS 3001"]);
    const none = structuredClone(plan);
    none.substitutions = [waiver];
    expect(coursesToLookUpForRenumbering(none, parsed)).toEqual([]);
  });

  it("turnsASubstitutionIntoTheEquivalenceItAmountsTo", () => {
    const parsed = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(parsed);
    const change = convertRenumbering(plan, renumbering, parsed);
    if (!change) throw new Error("convert");
    expect(sameKey(change.course, cs3001) && sameKey(change.countsAs, cs3000)).toBe(true);
    expect(change.message).toBe("CS 3001 now counts as CS 3000");
    expect(change.canUndo).toBe(true);
    expect(plan.substitutions.map((item) => item.id)).toEqual([waiver.id]);
    expect(plan.courseEquivalences.map((item) => keyId(item.course))).toEqual(["CS 3001"]);
    expect(plan.courseEquivalences[0] && sameKey(plan.courseEquivalences[0].countsAs, cs3000)).toBe(true);
    expect(plan.courseEquivalences[0]?.note).toBe("Renumbered");

    const audit = runDegreeAudit(plan, parsed);
    const result = resultFor(audit, renumbering.ruleID);
    if (!result) throw new Error("result");
    expect(result.status).toBe("complete");
    expect(result.used.map((use) => keyId(use.key))).toEqual(["CS 3001"]);
    expect(result.used[0]?.satisfies && sameKey(result.used[0].satisfies, cs3000)).toBe(true);
    expect(result.used[0]?.bySubstitution).toBe(false);
    expect(convertRenumbering(plan, renumbering, parsed)).toBeNull();
  });

  it("undoPutsTheSubstitutionBackWhereItWas", () => {
    const parsed = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(parsed);
    const change = convertRenumbering(plan, renumbering, parsed);
    if (!change) throw new Error("convert");
    const extra: RequirementSubstitution = { id: "extra", ruleID: "elsewhere", ruleTitle: "Elsewhere", change: { type: "waive" }, note: "", createdAt: 4 };
    plan.substitutions.push(extra);
    undoRenumbering(plan, change);
    expect(plan.substitutions.map((item) => item.id)).toEqual([renumbering.id, waiver.id, extra.id]);
    expect(plan.courseEquivalences).toEqual([]);
    undoRenumbering(plan, change);
    expect(plan.substitutions.length).toBe(3);
  });

  it("declaresARenumberingWithoutASubstitution", () => {
    const plan = emptyPlan("Plan");
    expect(declareRenumbering(plan, cs3000, cs3000)).toBeNull();
    const change = declareRenumbering(plan, cs3001, cs3000);
    if (!change) throw new Error("declare");
    expect(change.substitution == null && change.canUndo).toBe(true);
    expect(plan.courseEquivalences.map((item) => item.note)).toEqual(["Renumbered"]);
    const again = declareRenumbering(plan, cs3001, cs3000);
    if (!again) throw new Error("again");
    expect(again.canUndo).toBe(false);
    expect(plan.courseEquivalences.length).toBe(1);
    undoRenumbering(plan, change);
    expect(plan.courseEquivalences.length === 0).toBe(true);
  });

  it("asksAboutARetiredRequiredCourseOnly", () => {
    const parsed = requirements();
    const setup = renumberedPlan(parsed);
    const plan = setup.plan;
    const retired = likelyRenumberings(plan, parsed, (courseKey) => sameKey(courseKey, cs3000));
    expect(retired.map((item) => item.substitution.id)).toEqual([setup.renumbering.id]);
    expect(retired[0]?.question).toBe("Is CS 3001 the new number of CS 3000?");
    expect(likelyRenumberings(plan, parsed, () => null)).toEqual([]);
    expect(likelyRenumberings(plan, parsed, () => false)).toEqual([]);
    declareEquivalence(plan, cs3001, cs3000);
    expect(likelyRenumberings(plan, parsed, (courseKey) => sameKey(courseKey, cs3000))).toEqual([]);
  });

  it("aKeptSubstitutionIsNotAskedAboutAgain", () => {
    const parsed = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(parsed);
    const retired = (courseKey: CourseKey) => sameKey(courseKey, cs3000);
    const asked = likelyRenumberingMap(plan, parsed, new Set(), retired);
    expect(new Set(asked.keys())).toEqual(new Set([renumbering.id]));
    expect(asked.get(waiver.id)).toBeUndefined();
    expect(likelyRenumberingMap(plan, parsed, new Set([unorderedPairId(cs3001, cs3000)]), retired).size).toBe(0);
    const otherPair = unorderedPairId(cs3001, cs4535);
    expect(likelyRenumberingMap(plan, parsed, new Set([otherPair]), retired).size).toBe(1);
    expect(likelyRenumberingMap(plan, parsed, new Set(), () => null).size).toBe(0);
  });

  it("aSubstituteSitsUnderTheRequirementItReplaces", () => {
    const parsed = requirements();
    const plan = samplePlan();
    const either = ruleLabeled(parsed, "CS 4500 or CS 4530");
    const security = ruleLabeled(parsed, "Complete one of the following:");
    plan.substitutions = [
      substitution(either, "CS 4500 or CS 4530", cs4535, "Approved by advising"),
      substitution(security, "Security Course", cs4973),
    ];
    const audit = runDegreeAudit(plan, parsed);
    const eitherResult = must(resultFor(audit, either.id), "either");
    const split = splitUnlisted(eitherResult, new Set(listedCourses(either).map((item) => keyId(item))));
    expect(split.substitutes.map((use) => keyId(use.key))).toEqual(["CS 4535"]);
    expect(split.others).toEqual([]);
    expect(requirementName(eitherResult, parsed)).toBe("CS 4500 or CS 4530");
    expect(substituteNote(cs4535, eitherResult)).toBe("Approved by advising");
    expect(substituteCaption(cs4535, eitherResult, parsed)).toBe("Counts for CS 4500 or CS 4530 by substitution · Approved by advising");

    const securityResult = must(resultFor(audit, security.id), "security");
    expect(splitUnlisted(securityResult, new Set(listedCourses(security).map((item) => keyId(item)))).substitutes.map((use) => keyId(use.key))).toEqual(["CS 4973"]);
    expect(substituteCaption(cs4973, securityResult, parsed)).toBe("Counts for Security Course by substitution");

    const info: DegreeCourseRowInfo = { status: { type: "planned", term: "Spring 2027" }, isCountedHere: true, bySubstitution: true, caption: "ignored", addKey: null };
    expect(rowCaption(info, cs4535, eitherResult, parsed, true)).toBe("Approved by advising");
    expect(rowCaption(info, cs4535, eitherResult, parsed, false)).toBe("Counts for CS 4500 or CS 4530 by substitution · Approved by advising");
    const plain: DegreeCourseRowInfo = { status: { type: "notInPlan" }, isCountedHere: false, bySubstitution: false, caption: "No longer offered", addKey: null };
    expect(rowCaption(plain, cs4535, eitherResult, parsed, false)).toBe("No longer offered");

    const listed = samplePlan();
    listed.substitutions = [substitution(security, "Security Course", cy3740)];
    listed.completed.push(course("CY 3740"));
    const listedResult = must(resultFor(runDegreeAudit(listed, parsed), security.id), "listed");
    expect(splitUnlisted(listedResult, new Set(listedCourses(security).map((item) => keyId(item)))).substitutes).toEqual([]);
  });

  it("showsEachSentenceWithItsCheckForTheFilter", () => {
    const done = notesAudit(["CS 3000", "CS 3200", "CS 3500", "COOP 3946"]);
    const all = entries("all", done.audit, done.requirements);
    expect(new Set(Object.keys(all))).toEqual(new Set(["GPA Requirement", "Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(all["GPA Requirement"]?.check).toBeNull();
    expect(all["Credit Requirement"]?.check?.status).toBe("complete");
    expect(all["NUpath Requirements Satisfied"]?.check?.detail).toBe("COOP 3946 completed");
    expect(all["Program Requirement"]?.check != null).toBe(true);
    expect(new Set(Object.keys(entries("done", done.audit, done.requirements)))).toEqual(new Set(["Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(entries("remaining", done.audit, done.requirements)).toEqual({});

    const short = notesAudit(["CS 3000"], ["CS 3200"]);
    const remaining = entries("remaining", short.audit, short.requirements);
    expect(new Set(Object.keys(remaining))).toEqual(new Set(["Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(remaining["NUpath Requirements Satisfied"]?.check?.detail).toBe("No co-op in the plan");
    expect(remaining["GPA Requirement"]).toBeUndefined();
    expect(entries("done", short.audit, short.requirements)["NUpath Requirements Satisfied"]).toBeUndefined();
  });

  it("aCheckThatDoesNotCountYetShowsInAllOnly", () => {
    const check = noteCheck(false);
    expect(filterIncludesCheck("all", check)).toBe(true);
    expect(filterIncludesCheck("remaining", check)).toBe(false);
    expect(filterIncludesCheck("done", check)).toBe(false);
    check.counts = true;
    expect(filterIncludesCheck("remaining", check)).toBe(true);
    expect(filterIncludesCheck("done", check)).toBe(false);
  });
});
