import { describe, expect, it } from "vitest";
import { resultFor, runDegreeAudit, type NoteCheck } from "@/lib/degree/audit";
import { declareEquivalence, unorderedPairId } from "@/lib/degree/suggestions";
import {
  convertRenumbering,
  coursesToLookUpForRenumbering,
  declareRenumbering,
  filterIncludesCheck,
  keyIdSet,
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
  type DegreeCourseStatus,
} from "@/lib/degree/substitutions";
import { course, emptyPlan, key, must, requirements, requirementsFrom, samplePlan, substitution, term } from "@/lib/degree/swift-fixtures";
import type { CourseKey } from "@/lib/models";
import { keyId } from "@/lib/models";
import type { DegreePlan, ProgramRequirements, RequirementRule } from "@/lib/requirements";
import { allRules, listedCourses } from "@/lib/requirements";

const cs3000 = key("CS 3000");
const cs3001 = key("CS 3001");
const cs4535 = key("CS 4535");
const cs4973 = key("CS 4973");
const cy3740 = key("CY 3740");

function ruleLabeled(req: ProgramRequirements, label: string): RequirementRule {
  return must(allRules(req).find((item) => item.label === label), label);
}

function renumberedPlan(req: ProgramRequirements): { plan: DegreePlan; renumbering: ReturnType<typeof substitution>; waiver: ReturnType<typeof substitution> } {
  const plan = samplePlan();
  plan.completed = plan.completed.filter((item) => !item.key || keyId(item.key) !== "CS 3000");
  plan.completed.push(course("CS 3001"));
  const required = ruleLabeled(req, "CS 3000");
  const security = ruleLabeled(req, "Complete one of the following:");
  const renumbering = substitution(required.id, "CS 3000", { type: "countCourse", course: cs3001 }, "Approved");
  const waiver = substitution(security.id, "Security Course", { type: "waive" });
  plan.substitutions = [renumbering, waiver];
  return { plan, renumbering, waiver };
}

const NOTES_PAGE = `
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

function notesAudit(completed: string[], planned: string[] = []) {
  const req = requirementsFrom(NOTES_PAGE, { startYear: 2024 }, { title: "Notes, BS", path: "undergraduate/notes/" });
  const plan = emptyPlan("Notes");
  plan.completed = completed.map((code) => (code === "COOP 3946" ? course(code, 0, "Co-op Work Experience - HT") : course(code)));
  plan.terms = [term("fall", "fall", 2027, planned.map((code) => course(code)))];
  return { audit: runDegreeAudit(plan, req), requirements: req };
}

function entries(filter: "all" | "remaining" | "done", audit: ReturnType<typeof runDegreeAudit>, req: ProgramRequirements) {
  const found = new Map<string, ReturnType<typeof noteEntries>[number]>();
  for (const section of req.sections) {
    for (const entry of noteEntries(section, audit, filter, req.totalHours != null)) found.set(section.title, entry);
  }
  return found;
}

describe("DegreeSubstitutionPresentationTests", () => {
  it("onlyASubstitutionForOneNamedCourseIsARenumbering", () => {
    const req = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(req);
    const either = ruleLabeled(req, "CS 4500 or CS 4530");
    const other = structuredClone(plan);
    other.substitutions = [
      ...plan.substitutions,
      substitution(either.id, "CS 4500 or CS 4530", { type: "countCourse", course: cs4535 }),
      substitution(renumbering.ruleID, "CS 3000", { type: "countCourse", course: cs3000 }),
    ];
    expect([...renumberableSubstitutionIDs(other, req)]).toEqual([renumbering.id]);
    expect(renumberableSubstitutionIDs(other, req).has(waiver.id)).toBe(false);
    expect(coursesToLookUpForRenumbering(other, req).map((item) => keyId(item))).toEqual(["CS 3000", "CS 3001"]);
    const none = structuredClone(plan);
    none.substitutions = [waiver];
    expect(coursesToLookUpForRenumbering(none, req)).toEqual([]);
  });

  it("turnsASubstitutionIntoTheEquivalenceItAmountsTo", () => {
    const req = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(req);
    const change = must(convertRenumbering(plan, renumbering, req), "change");
    expect(keyId(change.course) === "CS 3001" && keyId(change.countsAs) === "CS 3000").toBe(true);
    expect(change.message).toBe("CS 3001 now counts as CS 3000");
    expect(change.canUndo).toBe(true);
    expect(plan.substitutions.map((item) => item.id)).toEqual([waiver.id]);
    expect(plan.courseEquivalences.map((item) => keyId(item.course))).toEqual(["CS 3001"]);
    expect(plan.courseEquivalences[0] ? keyId(plan.courseEquivalences[0].countsAs) : null).toBe("CS 3000");
    expect(plan.courseEquivalences[0]?.note).toBe("Renumbered");

    const audit = runDegreeAudit(plan, req);
    const result = must(resultFor(audit, renumbering.ruleID), "result");
    expect(result.status).toBe("complete");
    expect(result.used.map((use) => keyId(use.key))).toEqual(["CS 3001"]);
    expect(result.used[0]?.satisfies ? keyId(result.used[0].satisfies) : null).toBe("CS 3000");
    expect(result.used[0]?.bySubstitution).toBe(false);
    expect(convertRenumbering(plan, renumbering, req) ?? null).toBeNull();
  });

  it("undoPutsTheSubstitutionBackWhereItWas", () => {
    const req = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(req);
    const change = must(convertRenumbering(plan, renumbering, req), "change");
    const extra = substitution("elsewhere", "Elsewhere", { type: "waive" });
    plan.substitutions.push(extra);
    undoRenumbering(plan, change);
    expect(plan.substitutions.map((item) => item.id)).toEqual([renumbering.id, waiver.id, extra.id]);
    expect(plan.courseEquivalences).toEqual([]);
    undoRenumbering(plan, change);
    expect(plan.substitutions.length).toBe(3);
  });

  it("declaresARenumberingWithoutASubstitution", () => {
    const plan = emptyPlan("Plan");
    expect(declareRenumbering(plan, cs3000, cs3000) ?? null).toBeNull();
    const change = must(declareRenumbering(plan, cs3001, cs3000), "change");
    expect(change.substitution == null && change.canUndo).toBe(true);
    expect(plan.courseEquivalences.map((item) => item.note)).toEqual(["Renumbered"]);
    const again = must(declareRenumbering(plan, cs3001, cs3000), "again");
    expect(again.canUndo).toBe(false);
    expect(plan.courseEquivalences.length).toBe(1);
    undoRenumbering(plan, change);
    expect(plan.courseEquivalences.length === 0).toBe(true);
  });

  it("asksAboutARetiredRequiredCourseOnly", () => {
    const req = requirements();
    const setup = renumberedPlan(req);
    const plan = setup.plan;
    const retired = likelyRenumberings(plan, req, (item) => keyId(item) === "CS 3000");
    expect(retired.map((item) => item.substitution.id)).toEqual([setup.renumbering.id]);
    expect(retired[0]?.question).toBe("Is CS 3001 the new number of CS 3000?");
    expect(likelyRenumberings(plan, req, () => null)).toEqual([]);
    expect(likelyRenumberings(plan, req, () => false)).toEqual([]);
    declareEquivalence(plan, cs3001, cs3000);
    expect(likelyRenumberings(plan, req, (item) => keyId(item) === "CS 3000")).toEqual([]);
  });

  it("aKeptSubstitutionIsNotAskedAboutAgain", () => {
    const req = requirements();
    const { plan, renumbering, waiver } = renumberedPlan(req);
    const retired = (item: CourseKey) => keyId(item) === "CS 3000";
    const asked = likelyRenumberingMap(plan, req, new Set(), retired);
    expect(new Set(asked.keys())).toEqual(new Set([renumbering.id]));
    expect(asked.get(waiver.id) ?? null).toBeNull();
    const kept = unorderedPairId(cs3001, cs3000);
    expect(likelyRenumberingMap(plan, req, new Set([kept]), retired).size).toBe(0);
    const other = unorderedPairId(cs3001, cs4535);
    expect(likelyRenumberingMap(plan, req, new Set([other]), retired).size).toBe(1);
    expect(likelyRenumberingMap(plan, req, new Set(), () => null).size).toBe(0);
  });

  it("aSubstituteSitsUnderTheRequirementItReplaces", () => {
    const req = requirements();
    const plan = samplePlan();
    const either = ruleLabeled(req, "CS 4500 or CS 4530");
    const security = ruleLabeled(req, "Complete one of the following:");
    plan.substitutions = [
      substitution(either.id, "CS 4500 or CS 4530", { type: "countCourse", course: cs4535 }, "Approved by advising"),
      substitution(security.id, "Security Course", { type: "countCourse", course: cs4973 }),
    ];
    const audit = runDegreeAudit(plan, req);
    const eitherResult = must(resultFor(audit, either.id), "either");
    const split = splitUnlisted(eitherResult, keyIdSet(listedCourses(either)));
    expect(split.substitutes.map((use) => keyId(use.key)).join() === "CS 4535" && split.others.length === 0).toBe(true);
    expect(requirementName(eitherResult, req)).toBe("CS 4500 or CS 4530");
    expect(substituteNote(cs4535, eitherResult)).toBe("Approved by advising");
    expect(substituteCaption(cs4535, eitherResult, req)).toBe("Counts for CS 4500 or CS 4530 by substitution \u00b7 Approved by advising");

    const securityResult = must(resultFor(audit, security.id), "security");
    expect(splitUnlisted(securityResult, keyIdSet(listedCourses(security))).substitutes.map((use) => keyId(use.key))).toEqual(["CS 4973"]);
    expect(substituteCaption(cs4973, securityResult, req)).toBe("Counts for Security Course by substitution");

    const info: DegreeCourseRowInfo = {
      status: { type: "planned", term: "Spring 2027" } satisfies DegreeCourseStatus,
      isCountedHere: true,
      bySubstitution: true,
      caption: "ignored",
      addKey: null,
    };
    expect(rowCaption(info, cs4535, eitherResult, req, true)).toBe("Approved by advising");
    expect(rowCaption(info, cs4535, eitherResult, req, false)).toBe("Counts for CS 4500 or CS 4530 by substitution \u00b7 Approved by advising");
    const plain: DegreeCourseRowInfo = { status: { type: "notInPlan" }, isCountedHere: false, bySubstitution: false, caption: "No longer offered", addKey: null };
    expect(rowCaption(plain, cs4535, eitherResult, req, false)).toBe("No longer offered");

    const listed = structuredClone(plan);
    listed.substitutions = [substitution(security.id, "Security Course", { type: "countCourse", course: cy3740 })];
    listed.completed.push(course("CY 3740"));
    const listedResult = must(resultFor(runDegreeAudit(listed, req), security.id), "listed");
    expect(splitUnlisted(listedResult, keyIdSet(listedCourses(security))).substitutes).toEqual([]);
  });

  it("showsEachSentenceWithItsCheckForTheFilter", () => {
    const done = notesAudit(["CS 3000", "CS 3200", "CS 3500", "COOP 3946"]);
    const all = entries("all", done.audit, done.requirements);
    expect(new Set(all.keys())).toEqual(new Set(["GPA Requirement", "Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(all.get("GPA Requirement")?.check ?? null).toBeNull();
    expect(all.get("Credit Requirement")?.check?.status).toBe("complete");
    expect(all.get("NUpath Requirements Satisfied")?.check?.detail).toBe("COOP 3946 completed");
    expect(all.get("Program Requirement")?.check != null).toBe(true);
    expect(new Set(entries("done", done.audit, done.requirements).keys())).toEqual(new Set(["Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(entries("remaining", done.audit, done.requirements).size).toBe(0);

    const short = notesAudit(["CS 3000"], ["CS 3200"]);
    const remaining = entries("remaining", short.audit, short.requirements);
    expect(new Set(remaining.keys())).toEqual(new Set(["Credit Requirement", "NUpath Requirements Satisfied", "Program Requirement"]));
    expect(remaining.get("NUpath Requirements Satisfied")?.check?.detail).toBe("No co-op in the plan");
    expect(remaining.get("GPA Requirement") ?? null).toBeNull();
    expect(entries("done", short.audit, short.requirements).get("NUpath Requirements Satisfied") ?? null).toBeNull();
  });

  it("aCheckThatDoesNotCountYetShowsInAllOnly", () => {
    const check: NoteCheck = {
      sectionID: "nupath-requirements",
      note: "NUpath",
      kind: { type: "nupath" },
      status: "missing",
      detail: "looking up 2 courses",
      items: [],
      counts: false,
      id: "nupath-requirements|NUpath",
      title: "NUpath",
    };
    expect(filterIncludesCheck("all", check)).toBe(true);
    expect(filterIncludesCheck("remaining", check)).toBe(false);
    expect(filterIncludesCheck("done", check)).toBe(false);
    check.counts = true;
    expect(filterIncludesCheck("remaining", check)).toBe(true);
    expect(filterIncludesCheck("done", check)).toBe(false);
  });
});
