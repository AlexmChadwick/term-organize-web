import { describe, expect, it } from "vitest";
import { ruleResults, runDegreeAudit, type CourseUse } from "@/lib/degree/audit";
import { addToTerm, degreePlanCompletedLine, degreePlanNextLine, degreePlanNextSummary, moveToPosition, scheduleForDegreePlan } from "@/lib/degree/plan-edit";
import { requirements, samplePlan } from "@/lib/degree/swift-fixtures";
import {
  alternativeEntries,
  collapsedEntries,
  hasHeaderRow,
  isReplaced,
  isShown,
  listingOf,
  matchingCourseChoices,
  optionEntries,
  type DegreeListEntry,
  type DegreePlanCourseChoice,
} from "@/lib/degree/substitutions";
import { keyId, parseCourseKey, type CourseKey } from "@/lib/models";
import { optionCourses, type DegreePlan, type DegreePlanCourse, type DegreePlanTerm } from "@/lib/requirements";
import { newId, type SchedulePlan } from "@/lib/user";

function course(code: string, credits = 4): DegreePlanCourse {
  const key = parseCourseKey(code);
  return { id: newId(), key, label: key ? keyId(key) : code, title: code, credits };
}

function codes(term: DegreePlanTerm): string[] {
  return term.courses.map((item) => (item.key ? keyId(item.key) : item.label));
}

/** Spring 2027: CS 3000, CS 3500, CS 3650; Fall 2027: CS 4400. */
function plan(): DegreePlan {
  const now = Date.now();
  return {
    id: newId(),
    name: "Plan",
    completed: [],
    terms: [
      { id: newId(), season: "spring", year: 2027, courses: [course("CS 3000"), course("CS 3500"), course("CS 3650")] },
      { id: newId(), season: "fall", year: 2027, courses: [course("CS 4400")] },
    ],
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
    substitutions: [],
    courseEquivalences: [],
  };
}

function choice(key: CourseKey, title: string, extra: Partial<DegreePlanCourseChoice> = {}): DegreePlanCourseChoice {
  return {
    key,
    title,
    credits: 4,
    semester: null,
    semesterShortName: null,
    id: keyId(key),
    isCompleted: extra.semester == null,
    whenLine: extra.semester ?? "Completed",
    ...extra,
  };
}

function courseUse(key: CourseKey, credits: number, order: number): CourseUse {
  return { key, title: "", credits, semester: null, order, bySubstitution: false, instance: 0, id: keyId(key) };
}

describe("DegreePlanMacSupportTests", () => {
  it("reordersWithinASemester", () => {
    const degree = plan();
    const spring = degree.terms[0]!;
    const a = spring.courses[0]!.id;
    const b = spring.courses[1]!.id;
    const c = spring.courses[2]!.id;

    moveToPosition(degree, a, spring.id, 3);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3500", "CS 3650", "CS 3000"]);
    moveToPosition(degree, a, spring.id, 1);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3500", "CS 3000", "CS 3650"]);
    moveToPosition(degree, c, spring.id, 0);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3650", "CS 3500", "CS 3000"]);

    moveToPosition(degree, b, spring.id, 1);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3650", "CS 3500", "CS 3000"]);
    moveToPosition(degree, b, spring.id, 2);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3650", "CS 3500", "CS 3000"]);
  });

  it("movesToAPositionInAnotherSemester", () => {
    const degree = plan();
    const spring = degree.terms[0]!;
    const fall = degree.terms[1]!;
    const b = spring.courses[1]!.id;

    moveToPosition(degree, b, fall.id, 0);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3000", "CS 3650"]);
    expect(codes(degree.terms[1]!)).toEqual(["CS 3500", "CS 4400"]);

    const a = degree.terms[0]!.courses[0]!.id;
    moveToPosition(degree, a, fall.id, 99);
    expect(codes(degree.terms[1]!)).toEqual(["CS 3500", "CS 4400", "CS 3000"]);
    const c = degree.terms[0]!.courses[0]!.id;
    moveToPosition(degree, c, fall.id, -5);
    expect(codes(degree.terms[1]!)).toEqual(["CS 3650", "CS 3500", "CS 4400", "CS 3000"]);
    expect(degree.terms[0]!.courses).toEqual([]);
  });

  it("addsADraggedCourseAtAPosition", () => {
    const degree = plan();
    const springId = degree.terms[0]!.id;
    const drop = (code: string, position: number) => {
      const added = course(code);
      addToTerm(degree, added, springId);
      moveToPosition(degree, added.id, springId, position);
    };

    drop("CS 4500", 1);
    expect(codes(degree.terms[0]!)).toEqual(["CS 3000", "CS 4500", "CS 3500", "CS 3650"]);
    drop("CS 4530", 0);
    expect(codes(degree.terms[0]!)).toEqual(["CS 4530", "CS 3000", "CS 4500", "CS 3500", "CS 3650"]);
    drop("CS 4535", degree.terms[0]!.courses.length);
    expect(codes(degree.terms[0]!)).toEqual(["CS 4530", "CS 3000", "CS 4500", "CS 3500", "CS 3650", "CS 4535"]);
    expect(codes(degree.terms[1]!)).toEqual(["CS 4400"]);
  });

  it("ignoresACourseOrSemesterThatIsGone", () => {
    const degree = plan();
    const before = structuredClone(degree);
    moveToPosition(degree, newId(), degree.terms[1]!.id, 0);
    moveToPosition(degree, degree.terms[0]!.courses[0]!.id, newId(), 0);
    expect(degree).toEqual(before);
  });

  it("buildsAScheduleFromASemesterOnce", () => {
    const plans: SchedulePlan[] = [];
    const semester = plan().terms[0]!;

    const first = scheduleForDegreePlan(plans, semester, "202730");
    expect(first?.isNew).toBe(true);
    expect(first?.courseCount).toBe(3);
    expect(first?.plan.name).toBe("Spring 2027 plan");
    expect(plans.find((item) => item.id === first?.plan.id)?.courses.map((item) => keyId(item.key))).toEqual(["CS 3000", "CS 3500", "CS 3650"]);

    const again = scheduleForDegreePlan(plans, semester, "202730");
    expect(again?.isNew).toBe(false);
    expect(again?.plan.id).toBe(first?.plan.id);
    expect(plans).toHaveLength(1);

    const empty: DegreePlanTerm = {
      id: newId(),
      season: "summerA",
      year: 2027,
      courses: [{ id: newId(), key: null, label: "NO AP CREDIT", title: "", credits: 0 }],
    };
    expect(scheduleForDegreePlan(plans, empty, "202740")).toBeNull();
  });

  it("summarizesAPlanForTheOverview", () => {
    const degree = plan();
    degree.completed = [];
    degree.terms = [];
    expect(degreePlanCompletedLine(degree)).toBe("No completed courses yet");
    expect(degreePlanNextLine(degree)).toBe("No semesters planned yet");

    degree.completed = [course("CS 1800"), course("CS 1802", 1)];
    expect(degreePlanCompletedLine(degree)).toBe("5 credits completed");

    degree.terms = [{ id: newId(), season: "fall", year: 2001, courses: [course("CS 1800")] }];
    expect(degreePlanNextLine(degree)).toBe("No upcoming semesters");
    degree.terms.push({ id: newId(), season: "spring", year: 2099, courses: [] });
    expect(degreePlanNextLine(degree)).toBe("No courses planned yet");
    degree.terms[1]!.courses = [course("CS 3000"), course("CS 3500", 5)];
    expect(degreePlanNextSummary(degree)).toBe("Spring 2099 · 9 credits · 2 courses");
    expect(degreePlanNextLine(degree)).toBe("Next: Spring 2099 · 9 credits · 2 courses");
  });

  it("laysRequirementsOutLikeTheCatalog", () => {
    const program = requirements();
    const audit = runDegreeAudit(samplePlan(), program);

    const either = ruleResults(audit).find((result) => result.rule.label === "CS 4500 or CS 4530");
    expect(either).toBeTruthy();
    expect(hasHeaderRow(either!)).toBe(false);
    expect(isReplaced(either!)).toBe(false);
    expect(either!.rule.kind.type).toBe("required");
    if (either!.rule.kind.type !== "required") throw new Error("not a required course");
    const alternatives = alternativeEntries(either!.rule.kind.option);
    expect(alternatives.map((entry) => entry.courses)).toEqual([[{ subject: "CS", number: "4500" }], [{ subject: "CS", number: "4530" }]]);

    const security = ruleResults(audit).find((result) => result.rule.label.startsWith("Complete one of the following"));
    expect(security).toBeTruthy();
    expect(hasHeaderRow(security!)).toBe(true);
    const securityListing = listingOf(security!.rule);
    expect(securityListing.options.length === 2 && securityListing.ranges.length === 0).toBe(true);

    const science = ruleResults(audit).find((result) => result.rule.label.startsWith("Complete two courses"));
    expect(science).toBeTruthy();
    const scienceListing = listingOf(science!.rule);
    const listed = new Set(scienceListing.options.flatMap((option) => optionCourses(option).map((key) => keyId(key))));
    const entries = optionEntries(scienceListing.options, science!.rule, () => null);
    expect(entries.flatMap((entry) => (entry.category ? [`${entry.id} ${entry.category}`] : []))).toEqual(["0 Biology", "1 Mathematics"]);
    expect(isShown(courseUse({ subject: "BIOL", number: "1112" }, 1, 0), listed)).toBe(true);
    expect(isShown(courseUse({ subject: "CS", number: "4973" }, 4, 1), listed)).toBe(false);
  });

  it("longListsKeepTheOptionsThatMatter", () => {
    const entry = (id: number): DegreeListEntry => ({
      id,
      alternatives: [[{ subject: "CS", number: String(4000 + id) }]],
      category: null,
      courses: [{ subject: "CS", number: String(4000 + id) }],
    });
    const entries = Array.from({ length: 10 }, (_, id) => entry(id));
    const relevant = (item: DegreeListEntry) => [2, 7].includes(item.id);
    expect(collapsedEntries(entries, 3, relevant).map((item) => item.id)).toEqual([0, 1, 2, 3, 7]);
    expect(collapsedEntries(entries, 0, relevant).map((item) => item.id)).toEqual([2, 7]);
  });

  it("findsPlanCoursesByCodeOrTitle", () => {
    const choices = [
      choice({ subject: "CS", number: "3000" }, "Algorithms and Data"),
      choice({ subject: "MATH", number: "1341" }, "Calculus 1", { semester: "Spring 2027", semesterShortName: "Spring 2027" }),
    ];
    expect(matchingCourseChoices(choices, "")).toHaveLength(2);
    expect(matchingCourseChoices(choices, "cs 3000").map((item) => keyId(item.key))).toEqual(["CS 3000"]);
    expect(matchingCourseChoices(choices, "math1341").map((item) => keyId(item.key))).toEqual(["MATH 1341"]);
    expect(matchingCourseChoices(choices, "calculus").map((item) => keyId(item.key))).toEqual(["MATH 1341"]);
    expect(matchingCourseChoices(choices, "chemistry")).toEqual([]);
  });
});
