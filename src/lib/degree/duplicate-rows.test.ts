/**
 * A repeated course number stays in the degree plan. Warned copies still count,
 * each row is numbered, substituted, and synced on its own.
 */

import { describe, expect, it } from "vitest";
import { courseUseName, resultFor, ruleResults, runDegreeAudit, type DegreeAudit } from "@/lib/degree/audit";
import { scheduleForDegreePlan } from "@/lib/degree/plan-edit";
import { applyReorderSuggestion } from "@/lib/degree/reordering";
import { course, emptyPlan, requirements, substitution, term } from "@/lib/degree/swift-fixtures";
import { courseCopyLabel, duplicateAddNote, duplicateAddPlace, duplicateKeys, duplicatePlanNote, newDegreePlanDraft } from "@/lib/degree-logic";
import { keyId, type CourseKey } from "@/lib/models";
import { allRules } from "@/lib/requirements";
import type { SchedulePlan } from "@/lib/user";

const seminarKey: CourseKey = { subject: "CS", number: "4973" };

function copyNames(audit: DegreeAudit, code: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const use of [...ruleResults(audit).flatMap((rule) => rule.used), ...audit.unused]) {
    if (seen.has(use.id) || keyId(use.key) !== code) continue;
    seen.add(use.id);
    names.push(courseUseName(use));
  }
  return names.sort();
}

describe("degree plan duplicate rows", () => {
  it("adds two CS 4973 rows with no CRN, warns, and counts both", () => {
    const req = requirements();
    const electives = allRules(req).find((rule) => rule.label.startsWith("Complete 8 semester hours of CS"));
    const plan = emptyPlan("Topics");
    const first = course("CS 4973", 4, "Seminar");
    const second = course("CS 4973", 4, "Seminar");
    plan.terms = [term("fall", "fall", 2026, [first, second])];

    expect(duplicateKeys(plan)).toEqual(new Set(["CS 4973"]));
    expect(duplicatePlanNote(1)).toBe("1 course appears more than once in this plan. Each copy still counts.");
    expect(duplicatePlanNote(2)).toBe("2 courses appear more than once in this plan. Each copy still counts.");
    expect(courseCopyLabel(plan, first)).toBe("CS 4973");
    expect(courseCopyLabel(plan, second)).toBe("CS 4973 (2)");
    expect(duplicateAddPlace(plan, seminarKey, 0)).toBe("Fall 2026");
    expect(duplicateAddNote("Fall 2026")).toBe("Already in Fall 2026. Adding it again keeps both copies.");
    expect(first.crn ?? null).toBeNull();
    expect(second.crn ?? null).toBeNull();

    const completedPair = emptyPlan("Completed");
    completedPair.completed = [course("CS 4973", 4, "Seminar"), course("CS 4973", 4, "Seminar")];
    expect(duplicateKeys(completedPair)).toEqual(new Set(["CS 4973"]));
    expect(duplicateAddPlace(completedPair, seminarKey, "completed")).toBe("completed courses");
    expect(runDegreeAudit(completedPair, req).completedHours).toBe(8);

    const mixed = emptyPlan("Mixed");
    mixed.completed = [course("CS 4973", 4, "Seminar")];
    mixed.terms = [term("spring", "spring", 2027, [course("CS 4973", 4, "Seminar")])];
    expect(duplicateKeys(mixed)).toEqual(new Set(["CS 4973"]));
    expect(duplicateAddPlace(mixed, seminarKey, 0)).toBe("Spring 2027");

    const audit = runDegreeAudit(plan, req);
    expect(audit.plannedHours).toBe(8);
    expect(copyNames(audit, "CS 4973")).toEqual(["CS 4973", "CS 4973 (2)"]);
    expect(resultFor(audit, electives!.id)?.used.map((use) => use.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("warns for the same CRN, and not for different CRNs or a topic title", () => {
    const req = requirements();
    const sameCrn = emptyPlan("Same CRN");
    sameCrn.completed = [
      { ...course("CS 4973", 4, "Seminar"), crn: "10001" },
      { ...course("CS 4973", 4, "Seminar"), crn: "10001" },
    ];
    expect(duplicateKeys(sameCrn)).toEqual(new Set(["CS 4973"]));
    expect(runDegreeAudit(sameCrn, req).completedHours).toBe(8);
    expect(copyNames(runDegreeAudit(sameCrn, req), "CS 4973")).toEqual(["CS 4973", "CS 4973 (2)"]);

    const differentCrn = emptyPlan("Different CRNs");
    const pinned = [
      { ...course("CS 4973", 4, "Seminar"), crn: "10001" },
      { ...course("CS 4973", 4, "Seminar"), crn: "10002" },
    ];
    differentCrn.terms = [term("fall", "fall", 2026, pinned)];
    expect(duplicateKeys(differentCrn)).toEqual(new Set());
    expect(runDegreeAudit(differentCrn, req).plannedHours).toBe(8);
    expect(copyNames(runDegreeAudit(differentCrn, req), "CS 4973")).toEqual(["CS 4973", "CS 4973 (2)"]);
    expect(courseCopyLabel(differentCrn, pinned[1]!)).toBe("CS 4973 (2)");

    const topical = emptyPlan("Topic title");
    topical.terms = [term("fall", "fall", 2026, [course("CS 4973", 4, "Special Topics"), course("CS 4973", 4, "Special Topics")])];
    expect(duplicateKeys(topical)).toEqual(new Set());
    expect(runDegreeAudit(topical, req).plannedHours).toBe(8);
    expect(copyNames(runDegreeAudit(topical, req), "CS 4973")).toEqual(["CS 4973", "CS 4973 (2)"]);
  });

  it("substitutes each row on its own and keeps the other when one row is removed", () => {
    const req = requirements();
    const rules = allRules(req);
    const hcc = rules.find((rule) => rule.label === "Complete two of the following not already taken:")!;
    const software = rules.find((rule) => rule.label === "CS 4500 or CS 4530")!;
    const plan = emptyPlan("Substituted");
    plan.concentrationID = "concentration-in-human-centered-computing";
    const first = course("CS 4973", 4, "Directed Study");
    const second = course("CS 4973", 4, "Directed Study");
    plan.terms = [term("fall", "fall", 2026, [first, second])];
    plan.substitutions = [
      substitution(hcc.id, "HCI", { type: "countCourse", course: first.key!, rowID: first.id }),
      substitution(software.id, "Software", { type: "countCourse", course: second.key!, rowID: second.id }),
    ];

    const audit = runDegreeAudit(plan, req);
    expect(resultFor(audit, hcc.id)?.used.map((use) => use.id)).toEqual([first.id]);
    expect(resultFor(audit, software.id)?.used.map((use) => use.id)).toEqual([second.id]);
    expect(resultFor(audit, hcc.id)?.used[0]?.bySubstitution).toBe(true);
    expect(resultFor(audit, software.id)?.used[0]?.bySubstitution).toBe(true);

    plan.terms = [term("fall", "fall", 2026, [second])];
    const after = runDegreeAudit(plan, req);
    expect(resultFor(after, software.id)?.used.map((use) => use.id)).toEqual([second.id]);
    expect(resultFor(after, hcc.id)?.used.some((use) => use.id === second.id)).toBe(false);
    expect(after.unmatchedSubstitutions.some((item) => item.change.type === "countCourse" && item.change.rowID === first.id)).toBe(true);
    expect(plan.terms[0]!.courses.map((course) => course.id)).toEqual([second.id]);
  });

  it("keeps both rows through a schedule sync and does not invent a CRN", () => {
    const first = course("CS 4973", 4, "Directed Study");
    const second = course("CS 4973", 4, "Directed Study");
    const semester = term("fall", "fall", 2026, [first, second]);
    const plans: SchedulePlan[] = [];
    const created = scheduleForDegreePlan(plans, semester, "202710");
    expect(created?.isNew).toBe(true);
    expect(created?.plan.courses).toHaveLength(2);
    expect(created?.plan.courses.map((course) => keyId(course.key))).toEqual(["CS 4973", "CS 4973"]);
    expect(created?.plan.courses.every((course) => course.pinnedCRN == null)).toBe(true);

    const back = newDegreePlanDraft("Back", null, plans, () => ({ title: "Directed Study", credits: 4 }));
    const rows = back.terms.flatMap((term) => term.courses);
    expect(rows.map((course) => course.label)).toEqual(["CS 4973", "CS 4973"]);
    expect(rows.every((course) => !course.crn)).toBe(true);

    const again = scheduleForDegreePlan(plans, semester, "202710");
    expect(again?.isNew).toBe(false);
    expect(plans).toHaveLength(1);
  });

  it("moves one duplicate row and leaves the other", () => {
    const plan = emptyPlan("Move");
    const first = course("CS 4973", 4, "Directed Study");
    const second = course("CS 4973", 4, "Directed Study");
    plan.terms = [term("fall", "fall", 2026, [first, second]), term("spring", "spring", 2027, [])];
    applyReorderSuggestion(
      {
        id: "move-one",
        moves: [{ course: first.key!, from: "fall", to: "spring", entryID: first.id }],
        title: "Move one CS 4973",
        reasons: [],
        addsSemester: null,
      },
      plan,
    );
    expect(plan.terms[0]!.courses.map((course) => course.id)).toEqual([second.id]);
    expect(plan.terms[1]!.courses.map((course) => course.id)).toEqual([first.id]);
  });
});
