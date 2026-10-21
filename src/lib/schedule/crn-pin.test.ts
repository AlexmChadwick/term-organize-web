/**
 * A picked section stays that CRN. Special topics share a course number, so two
 * entries are allowed only when each was chosen by hand and the CRNs differ.
 */

import { describe, expect, it } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import { runDegreeAudit } from "@/lib/degree/audit";
import { course as degreeCourse, emptyPlan, term } from "@/lib/degree/swift-fixtures";
import { duplicateKeys, entriesCountSeparately, prerequisiteStatus, termCreditTotal } from "@/lib/degree-logic";
import { courseAttributes } from "@/lib/degree/nupath";
import { applyReorderSuggestion } from "@/lib/degree/reordering";
import { CourseEquivalences } from "@/lib/equivalences";
import type { CourseKey, Requisite } from "@/lib/models";
import { keyId, parseCourseKey } from "@/lib/models";
import type { ProgramRequirements } from "@/lib/requirements";
import { courseInputsFor, generateSchedules } from "@/lib/schedule/generator";
import {
  applyCourseMoves,
  applyGeneratedCRNs,
  canPlacePlanCourse,
  ensureManualPins,
  mergeRefreshedSections,
  placePlanCourse,
  sectionIdentity,
  pinSectionOnPlan,
} from "@/lib/schedule/pins";
import { ResolvedPlan } from "@/lib/schedule/plan-edits";
import { course, generate, section } from "@/lib/schedule/swift-fixtures";
import { emptyPlanFilters, newId, type PlanCourse, type SchedulePlan } from "@/lib/user";

function schedule(courses: PlanCourse[], selected: string[] = []): SchedulePlan {
  const now = 0;
  return {
    id: newId(),
    name: "Plan",
    termCode: "202710",
    courses,
    selectedCRNs: selected,
    filters: emptyPlanFilters(),
    preferences: null,
    favoriteCombinations: [],
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
    manualPinsMigrated: true,
  };
}

function entry(subject: string, number: string, pinnedCRN?: string): PlanCourse {
  return { key: { subject, number }, isRequired: true, excludedCRNs: [], colorIndex: 0, ...(pinnedCRN ? { pinnedCRN } : {}) };
}

const topics = [
  section("111", "CS", "5976", [1], 10, 11, { seats: 1 }),
  section("222", "CS", "5976", [2], 10, 11, { seats: 30 }),
  section("333", "CS", "5976", [3], 10, 11, { seats: 30 }),
];

describe("CRN pins", () => {
  it("identifies a section by term and CRN", () => {
    expect(sectionIdentity("202710", "111")).toBe("202710:111");
    expect(sectionIdentity("202710", "111")).not.toBe(sectionIdentity("202730", "111"));
    expect(sectionIdentity("202710", "111")).not.toBe(sectionIdentity("202710", "222"));
  });

  it("generation never replaces a pinned section with another of the same number", () => {
    const pinned = { ...course("CS", "5976", topics), pinnedCRN: "111" };
    const result = generate([pinned]);
    expect(result.schedules.map((item) => item.crns)).toEqual([["111"]]);
    const inputs = courseInputsFor([entry("CS", "5976", "111")], {
      course: () => null,
      sectionsFor: () => topics,
    });
    expect(inputs[0]!.sections.map((item) => item.crn)).toEqual(["111"]);
    expect(generateSchedules(inputs, { freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0 }).schedules[0]?.crns).toEqual(["111"]);
  });

  it("regeneration keeps pins and only fills entries that have none", () => {
    const plan = schedule([entry("CS", "5976", "111"), entry("MATH", "2331")], ["111"]);
    const next = applyGeneratedCRNs(plan, ["333", "B2"], (crn) => {
      if (crn === "333") return { subject: "CS", number: "5976" };
      if (crn === "B2") return { subject: "MATH", number: "2331" };
      return null;
    });
    expect(next.courses[0]!.pinnedCRN).toBe("111");
    expect(next.selectedCRNs).toEqual(["111", "B2"]);
  });

  it("auto-pick does not trade a pin for a section with more seats", () => {
    const result = generate([{ ...course("CS", "5976", topics), pinnedCRN: "111" }]);
    expect(result.schedules.every((item) => item.crns.length === 1 && item.crns[0] === "111")).toBe(true);
    const open = pinSectionOnPlan(schedule([entry("CS", "5976")]), { subject: "CS", number: "5976" }, "222");
    expect(open.courses).toHaveLength(1);
    expect(open.courses[0]!.pinnedCRN).toBe("222");
    const second = pinSectionOnPlan(open, { subject: "CS", number: "5976" }, "111");
    expect(second.courses.map((item) => item.pinnedCRN)).toEqual(["222", "111"]);
  });

  it("conflict resolution does not swap the pin for a free section of the same course", () => {
    const math = course("MATH", "2331", [section("M1", "MATH", "2331", [1], 10, 11)]);
    const open = generate([course("CS", "5976", topics), math]);
    expect(open.schedules.some((item) => item.crns.includes("333") && item.crns.includes("M1"))).toBe(true);
    const pinned = generate([{ ...course("CS", "5976", topics), pinnedCRN: "111" }, math]);
    expect(pinned.totalFound).toBe(0);
    expect(pinned.schedules.some((item) => item.crns.includes("333") || item.crns.includes("222"))).toBe(false);
  });

  it("catalog refresh keeps the pinned CRN when the payload only has other sections", () => {
    const previous = topics;
    const incoming = [section("222", "CS", "5976", [2], 10, 11, { seats: 4 }), section("333", "CS", "5976", [3], 10, 11)];
    const merged = mergeRefreshedSections(previous, incoming, ["111"]);
    expect(merged.map((item) => item.crn)).toEqual(["222", "333", "111"]);
    expect(merged.find((item) => item.crn === "222")!.seatsRemaining).toBe(4);
    const plan = schedule([entry("CS", "5976", "111")], ["111"]);
    expect(plan.courses[0]!.pinnedCRN).toBe("111");
  });

  it("reorganize moves one pinned topics entry and leaves the other CRN", () => {
    const plan = schedule(
      [entry("CS", "5976", "111"), entry("CS", "5976", "222"), entry("MATH", "2331", "M1")],
      ["111", "222", "M1"],
    );
    const next = applyCourseMoves(
      plan,
      [parseCourseKey("CS 5976")!],
      [],
      (key) => (key.number === "5976" ? topics : [section("M1", "MATH", "2331", [4], 9, 10)]),
      ["111"],
    );
    expect(next.courses.map((item) => item.pinnedCRN)).toEqual(["222", "M1"]);
    expect(next.selectedCRNs).toEqual(["222", "M1"]);

    const degree = emptyPlan("Topics");
    const first = { ...degreeCourse("CS 5976", 4, "Graphics"), crn: "111" };
    const second = { ...degreeCourse("CS 5976", 4, "Security"), crn: "222" };
    degree.terms = [term("fall", "fall", 2026, [second, first]), term("spring", "spring", 2027, [])];
    applyReorderSuggestion(
      {
        id: "move-one",
        moves: [{ course: first.key!, from: "fall", to: "spring", entryID: first.id, crn: "111" }],
        title: "Move CS 5976 (CRN 111) to Spring 2027",
        reasons: [],
        addsSemester: null,
      },
      degree,
    );
    expect(degree.terms[0]!.courses.map((item) => item.crn)).toEqual(["222"]);
    expect(degree.terms[1]!.courses.map((item) => item.crn)).toEqual(["111"]);
  });

  it("allows the same course number only when each entry has a different manual CRN", () => {
    const courses = [entry("CS", "5976")];
    expect(canPlacePlanCourse(courses, courses[0]!.key, null)).toBe(false);
    expect(canPlacePlanCourse([entry("CS", "5976", "111")], courses[0]!.key, "111")).toBe(false);
    expect(canPlacePlanCourse([entry("CS", "5976", "111")], courses[0]!.key, null)).toBe(false);
    expect(canPlacePlanCourse([entry("CS", "5976", "111")], courses[0]!.key, "222")).toBe(true);
    const placed = placePlanCourse(schedule([entry("CS", "5976", "111")], ["111"]), { subject: "CS", number: "5976" }, "222");
    expect(placed.courses.map((item) => item.pinnedCRN)).toEqual(["111", "222"]);
    const again = placePlanCourse(placed, { subject: "CS", number: "5976" }, "222");
    expect(again.courses).toHaveLength(2);
    const stored = schedule([entry("CS", "5976")], ["111", "222"]);
    delete stored.manualPinsMigrated;
    const legacy = ensureManualPins(stored, () => ({ subject: "CS", number: "5976" }));
    expect(legacy.courses.map((item) => item.pinnedCRN)).toEqual(["111", "222"]);
    expect(legacy.manualPinsMigrated).toBe(true);
  });

  it("does not merge two pinned topics during generation, and counts each toward credits, audit, prereqs, and NUpath", () => {
    const both = generate([
      { ...course("CS", "5976", topics, { credits: 4 }), pinnedCRN: "111" },
      { ...course("CS", "5976", topics, { credits: 4 }), pinnedCRN: "222" },
    ]);
    expect(both.totalFound).toBe(1);
    expect(both.schedules[0]!.crns).toEqual(["111", "222"]);
    const same = generate([
      { ...course("CS", "5976", topics), pinnedCRN: "111" },
      { ...course("CS", "5976", topics), pinnedCRN: "111" },
    ]);
    expect(same.totalFound).toBe(0);

    const repeated = emptyPlan("Repeated");
    const plain = [
      { ...degreeCourse("CS 5976", 4, "Directed Study"), crn: "111" },
      { ...degreeCourse("CS 5976", 4, "Directed Study"), crn: "222" },
    ];
    repeated.completed = plain;
    expect(termCreditTotal(plain)).toBe(8);
    expect(duplicateKeys(repeated)).toEqual(new Set());
    const collapsed = emptyPlan("Collapsed");
    collapsed.completed = [degreeCourse("CS 5976", 4, "Directed Study")];
    collapsed.terms = [term("fall", "fall", 2026, [degreeCourse("CS 5976", 4, "Directed Study")])];
    expect(duplicateKeys(collapsed)).toEqual(new Set(["CS 5976"]));
    const twice = emptyPlan("Same CRN");
    twice.completed = [{ ...degreeCourse("CS 5976", 4, "Topics in Graphics"), crn: "111" }];
    twice.terms = [term("fall", "fall", 2026, [{ ...degreeCourse("CS 5976", 4, "Topics in Security"), crn: "111" }])];
    expect(duplicateKeys(twice)).toEqual(new Set(["CS 5976"]));
    expect(entriesCountSeparately(plain[0]!, plain[1]!)).toBe(true);

    const requirements: ProgramRequirements = {
      year: { startYear: 2024 },
      program: { title: "Test", path: "undergraduate/test/" },
      sections: [{ id: "major", title: "Major", isConcentration: false, groups: [], notes: ["Complete the NUpath requirements."] }],
      fetchedAt: 0,
      courseTitles: {},
    };
    const counted = runDegreeAudit(repeated, requirements, CourseEquivalences.none(), courseAttributes({ "CS 5976": ["NCWI"] }));
    expect(counted.completedHours).toBe(8);
    const nupath = counted.noteChecks.find((check) => check.kind.type === "nupath");
    const writing = nupath?.items?.find((item) => item.id === "NCWI");
    expect(writing?.courses).toEqual(["CS 5976", "CS 5976 (2)"]);
    const once = runDegreeAudit(collapsed, requirements);
    expect(once.completedHours).toBe(4);

    const lookup = (_key: CourseKey, crn?: string | null): Requisite | null => (crn === "111" ? { s: "CS", n: "2500" } : null);
    const planned = emptyPlan("Prereqs");
    planned.terms = [term("fall", "fall", 2026, plain)];
    expect(prerequisiteStatus(plain[0]!.key!, 0, planned, null, lookup, CourseEquivalences.none(), "111")).toEqual({ kind: "missing", text: "CS 2500" });
    expect(prerequisiteStatus(plain[1]!.key!, 0, planned, null, lookup, CourseEquivalences.none(), "222")).toEqual({ kind: "met" });
    expect(keyId(plain[0]!.key!)).toBe(keyId(plain[1]!.key!));
  });
});

describe("resolved pins", () => {
  it("attaches each selected CRN to its own entry", () => {
    const plan = schedule([entry("CS", "5976", "111"), entry("CS", "5976", "222")], ["111", "222"]);
    const catalogCourses = [
      {
        subject: "CS",
        number: "5976",
        title: "Special Topics",
        description: "",
        minCredits: 4,
        maxCredits: 4,
        attributes: [],
        prereqs: null,
        coreqs: null,
        postreqs: [],
        specialTopics: true,
        detailsLoaded: true,
      },
    ];
    const index = CatalogIndex.build({
      version: 1,
      term: { code: "202710", bannerDescription: "Fall 2026" },
      generatedAt: 0,
      sectionsUpdatedAt: 0,
      courses: catalogCourses,
      sections: [topics[0]!, topics[1]!],
      subjects: [],
      attributes: [],
      campuses: [],
    });
    const resolved = new ResolvedPlan(plan, index);
    expect(resolved.entries.map((item) => item.selected.map((section) => section.crn))).toEqual([["111"], ["222"]]);
    expect(resolved.credits).toEqual({ min: 8, max: 8 });
  });
});
