import { describe, expect, it } from "vitest";
import { course as degreeCourse, emptyPlan, term } from "@/lib/degree/swift-fixtures";
import { applyReorderSuggestion } from "@/lib/degree/reordering";
import { moveToPosition } from "@/lib/degree/plan-edit";
import type { CourseSection } from "@/lib/models";
import {
  applySectionPick,
  commitCourseCRN,
  noSectionsMessage,
  openSectionPick,
  planTermLabel,
  removePlanCourse,
  sectionChoice,
} from "@/lib/degree/double-entry";

function section(crn: string, title: string): CourseSection {
  return {
    crn,
    subject: "CS",
    number: "1800",
    title,
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 40,
    seatsRemaining: 10,
    enrollment: 30,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    meetings: [{ days: 18, start: 705, end: 805, kind: "Class" }],
    instructors: [{ name: "Varma, Akshar", primary: true }],
    crossListCRNs: [],
    attributes: [],
  };
}

describe("degree plan double entry", () => {
  it("names the empty term in the section-picker message", () => {
    const fall = term("fall", "fall", 2026, []);
    expect(planTermLabel(fall)).toBe("Fall 2026");
    expect(noSectionsMessage(planTermLabel(fall))).toBe(
      "Pick a section to add this course twice. No sections are listed for Fall 2026 yet.",
    );
  });

  it("describes a section by title, instructor, and times", () => {
    const choice = sectionChoice(section("10264", "Discrete Structures"));
    expect(choice.title).toBe("Discrete Structures");
    expect(choice.instructor).toBe("Akshar Varma");
    expect(choice.times).toContain("11:45");
    expect(choice.crn).toBe("10264");
  });

  it("asks for a section on every unpinned row when the course is already planned", () => {
    const plan = emptyPlan("Audit");
    const existing = degreeCourse("CS 1800", 4, "CS 1800");
    plan.terms = [term("fall", "fall", 2026, [existing])];
    const pick = openSectionPick(plan, existing.key!);
    expect(pick?.unpinned.map((row) => row.id)).toEqual([existing.id]);
    expect(pick?.taken).toEqual([]);

    const pinned = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "10264" };
    plan.terms = [term("fall", "fall", 2026, [pinned])];
    const again = openSectionPick(plan, pinned.key!);
    expect(again?.unpinned).toEqual([]);
    expect(again?.taken).toEqual(["10264"]);
    expect(openSectionPick(plan, degreeCourse("CS 2500", 4, "Fundies").key!)).toBeNull();
  });

  it("pins the existing row and the new row to different sections", () => {
    const plan = emptyPlan("Audit");
    const existing = degreeCourse("CS 1800", 4, "CS 1800");
    const other = degreeCourse("CS 2500", 4, "Fundamentals of Computer Science 2");
    plan.terms = [term("fall", "fall", 2026, [other, existing])];
    const draft = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), id: "new-row" };
    const refused = applySectionPick(plan, 0, draft, [{ id: existing.id, crn: "111" }], { crn: "111" });
    expect(refused).toBe("Each row needs a different section.");
    const next = applySectionPick(
      plan,
      0,
      draft,
      [{ id: existing.id, crn: "111", title: "Discrete Structures" }],
      { crn: "222", title: "Discrete Structures" },
    );
    expect(typeof next).not.toBe("string");
    if (typeof next === "string") return;
    expect(next.terms[0]!.courses.map((course) => course.id)).toEqual([other.id, existing.id, draft.id]);
    expect(next.terms[0]!.courses.map((course) => course.crn ?? null)).toEqual([null, "111", "222"]);
    expect(next.terms[0]!.courses[1]!.title).toBe("Discrete Structures");

    const pinnedPlan = emptyPlan("Audit");
    const pinned = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "111" };
    pinnedPlan.terms = [term("fall", "fall", 2026, [pinned])];
    const second = applySectionPick(pinnedPlan, 0, { ...draft, id: "second-row" }, [], { crn: "222", title: "Discrete Structures" });
    expect(typeof second).not.toBe("string");
    if (typeof second === "string") return;
    expect(second.terms[0]!.courses.map((course) => course.crn)).toEqual(["111", "222"]);
    expect(applySectionPick(pinnedPlan, 0, draft, [], { crn: "111" })).toBe("Each row needs a different section.");
  });

  it("refuses a CRN that another row of the same course already uses", () => {
    const plan = emptyPlan("Audit");
    const first = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "111" };
    const second = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "222" };
    plan.terms = [term("fall", "fall", 2026, [first, second])];
    expect(commitCourseCRN(plan, second.id, "111")).toBe("CRN 111 is already on another row.");
    expect(commitCourseCRN(plan, second.id, "")).toBe("Each copy needs its own CRN.");
    const cleared = commitCourseCRN(removePlanCourse(plan, first.id), second.id, "");
    expect(typeof cleared).not.toBe("string");
    if (typeof cleared === "string") return;
    expect(cleared.terms[0]!.courses).toEqual([{ ...second, crn: null }]);
  });

  it("removes or moves one row and leaves the other copy", () => {
    const plan = emptyPlan("Audit");
    const first = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "111" };
    const second = { ...degreeCourse("CS 1800", 4, "Discrete Structures"), crn: "222" };
    const spring = term("spring", "spring", 2027, []);
    plan.terms = [term("fall", "fall", 2026, [first, second]), spring];
    const removed = removePlanCourse(plan, first.id);
    expect(removed.terms[0]!.courses.map((course) => course.crn)).toEqual(["222"]);

    moveToPosition(plan, first.id, spring.id, 0);
    expect(plan.terms[0]!.courses.map((course) => course.id)).toEqual([second.id]);
    expect(plan.terms[1]!.courses.map((course) => course.id)).toEqual([first.id]);

    const fresh = emptyPlan("Audit");
    fresh.terms = [term("fall", "fall", 2026, [second, first]), term("spring", "spring", 2027, [])];
    applyReorderSuggestion(
      {
        id: "move-one",
        moves: [{ course: first.key!, from: "fall", to: "spring", entryID: first.id, crn: "111" }],
        title: "Move one section",
        reasons: [],
        addsSemester: null,
      },
      fresh,
    );
    expect(fresh.terms[0]!.courses.map((course) => course.crn)).toEqual(["222"]);
    expect(fresh.terms[1]!.courses.map((course) => course.crn)).toEqual(["111"]);
  });
});
