import { describe, expect, it } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import type { Course, CourseKey, CourseSection, Term, TermCatalog } from "@/lib/models";
import { Day, keyId, parseCourseKey } from "@/lib/models";
import { emptyPreferences, type SchedulePreferences } from "@/lib/preferences";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm } from "@/lib/requirements";
import { GeneratedSchedule, courseInputsFor, generateSchedules } from "@/lib/schedule/generator";
import { ScheduleNoResultsText, analyzeEmptyResult } from "@/lib/schedule/no-results";
import {
  PlanDataStore,
  ResolvedPlan,
  addAutofill,
  addDismissal,
  applyPlanEdit,
  autofillSourceName,
  autofillSuggestions,
  blockedTimeListDetail,
  courseCountLabel,
  dismissalKey,
  isAutofillDismissed,
  makePlanCoursesOptional,
  parseDroppedCourses,
  removePlanCourse,
  reorderSemester,
  restorePlanCourse,
  scheduleCarouselLayout,
  scheduleClockDate,
  scheduleClockMinutes,
  scheduleNotices,
  undoAutofill,
} from "@/lib/schedule/plan-edits";
import { blockedTime, section } from "@/lib/schedule/swift-fixtures";
import { defaultPreferences, emptyPlanFilters, newId, type SchedulePlan } from "@/lib/user";

function catalogCourse(subject: string, number: string, credits = 4): Course {
  return {
    subject,
    number,
    title: `${subject} ${number}`,
    description: "",
    minCredits: credits,
    maxCredits: credits,
    attributes: [],
    prereqs: null,
    coreqs: null,
    postreqs: [],
    specialTopics: false,
    detailsLoaded: true,
  };
}

function indexOf(courses: Course[], sections: CourseSection[]): CatalogIndex {
  const catalog: TermCatalog = {
    version: 1,
    term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses,
    sections,
    subjects: [],
    attributes: [],
    campuses: [],
  };
  return CatalogIndex.build(catalog);
}

function plan(codes: string[], selected: string[] = []): SchedulePlan {
  const now = Date.now();
  return {
    id: newId(),
    name: "Plan A",
    termCode: "202710",
    courses: codes.map((code, offset) => {
      const key = parseCourseKey(code)!;
      return { key, isRequired: true, excludedCRNs: [], colorIndex: offset };
    }),
    selectedCRNs: selected,
    filters: emptyPlanFilters(),
    preferences: null,
    favoriteCombinations: [],
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  };
}

function clashingIndex(): CatalogIndex {
  return indexOf(
    [catalogCourse("CS", "3000"), catalogCourse("MATH", "2331"), catalogCourse("ENGW", "1111")],
    [
      section("A1", "CS", "3000", [1, 3], 10, 11.5),
      section("B1", "MATH", "2331", [1], 11, 12, { seats: 0, waitlist: 5 }),
      section("C1", "ENGW", "1111", [2, 4], 13, 14.5),
    ],
  );
}

function lookup(index: CatalogIndex) {
  return {
    course: (key: CourseKey) => index.course(key) ?? null,
    sectionsFor: (key: CourseKey) => index.sectionsOf(key),
    sectionByCrn: (crn: string) => index.sectionByCRN(crn) ?? null,
  };
}

function degreeCourse(code: string, title: string): DegreePlanCourse {
  return { id: code, key: parseCourseKey(code), label: code, title, credits: 4 };
}

describe("ScheduleSupportTests", () => {
  it("warningsListWhatNeedsAttention", () => {
    const index = clashingIndex();
    const resolved = new ResolvedPlan(plan(["CS 3000", "MATH 2331", "ENGW 1111"], ["A1", "B1"]), index);
    expect(resolved.warnings.map((item) => item.text)).toEqual(["1 conflict", "1 full section", "1 course needs a section"]);
    expect(resolved.warnings[0]?.severity).toBe("error");
    expect(resolved.warnings.at(-1)?.severity).toBe("neutral");
    expect(new ResolvedPlan(plan(["CS 3000"]), null).warnings).toEqual([]);
  });

  it("noticesExplainConflictsAndFullSections", () => {
    const index = clashingIndex();
    const resolved = new ResolvedPlan(plan(["CS 3000", "MATH 2331"], ["A1", "B1"]), index);
    const notices = scheduleNotices(resolved, "Fall 2026", false);
    expect(notices.map((item) => item.id)).toEqual(["conflicts", "full"]);
    expect(notices[0]?.severity).toBe("error");
    expect(notices[0]?.title).toBe("1 time conflict");
    expect(notices[0]?.lines[0]?.includes("CS 3000 overlaps MATH 2331")).toBe(true);
    expect(notices[1]?.lines).toEqual(["MATH 2331 Lecture 01 is full \u00b7 5 waitlist spots left"]);
    expect(notices.every((item) => item.fix == null)).toBe(true);
  });

  it("noticesOfferToForgetSectionsTheCatalogDoesNotList", () => {
    const index = clashingIndex();
    const resolved = new ResolvedPlan(plan(["CS 3000"], ["A1", "99999", "C1"]), index);
    const notices = scheduleNotices(resolved, "Fall 2026", false);
    const ids = notices.map((item) => item.id);
    expect(ids).toContain("unlisted");
    expect(ids).toContain("orphaned");
    expect(notices.find((item) => item.id === "unlisted")?.fix).toEqual({ kind: "removeSections", crns: ["99999"] });
    expect(notices.find((item) => item.id === "orphaned")?.fix).toEqual({ kind: "removeSections", crns: ["C1"] });
    expect(notices.find((item) => item.id === "orphaned")?.fixTitle).toBe("Remove");
  });

  it("aMissingCatalogIsReportedOnceItIsKnownToBeMissing", () => {
    const resolved = new ResolvedPlan(plan(["CS 3000"]), null);
    expect(scheduleNotices(resolved, "Spring 2027", false)).toEqual([]);
    const notices = scheduleNotices(resolved, "Spring 2027", true);
    expect(notices.map((item) => item.id)).toEqual(["catalog"]);
    expect(notices[0]?.title).toBe("Course data for Spring 2027 isn\u2019t on this device");
    expect(scheduleNotices(new ResolvedPlan(plan([]), null), "Spring 2027", true)).toEqual([]);
  });

  it("favoritesAreMeasuredAndSkipWhenTheyCanNoLongerBeApplied", () => {
    const index = clashingIndex();
    const item = plan(["CS 3000", "ENGW 1111"]);
    item.favoriteCombinations = [["A1", "C1"], ["A1", "GONE"], ["B1", "C1"]];
    const favorites = GeneratedSchedule.favorites(item.courses, item.favoriteCombinations, lookup(index), emptyPreferences());
    expect(favorites.map((schedule) => schedule.crns)).toEqual([["A1", "C1"]]);
    expect(favorites[0]?.sortedCRNs).toEqual(["A1", "C1"]);
  });

  it("favoritesComeNewestFirstInPlanOrder", () => {
    const index = clashingIndex();
    const item = plan(["ENGW 1111", "CS 3000"]);
    item.favoriteCombinations = [["A1"], ["C1", "A1"]];
    const favorites = GeneratedSchedule.favorites(item.courses, item.favoriteCombinations, lookup(index), emptyPreferences());
    expect(favorites.map((schedule) => new Set(schedule.crns))).toEqual([new Set(["A1", "C1"]), new Set(["A1"])]);
    expect(favorites[0]?.crns).toEqual(["C1", "A1"]);
  });

  it("courseInputsRoundCreditsUpAndKeepExclusions", () => {
    const index = indexOf(
      [catalogCourse("CS", "3000", 3.5), catalogCourse("MATH", "2331")],
      [section("A1", "CS", "3000", [1], 9, 10), section("A2", "CS", "3000", [2], 9, 10)],
    );
    const item = plan(["CS 3000", "MATH 2331"]);
    item.courses[0]!.excludedCRNs = ["A2"];
    item.courses[1]!.isRequired = false;
    const inputs = courseInputsFor(item.courses, lookup(index));
    expect(inputs.map((input) => keyId(input.key))).toEqual(["CS 3000", "MATH 2331"]);
    expect(inputs[0]?.minCredits).toBe(4);
    expect(inputs[0]?.sections).toHaveLength(2);
    expect(inputs[0]?.excludedCRNs).toEqual(new Set(["A2"]));
    expect(inputs[1]?.isRequired).toBe(false);
    expect(inputs[1]?.sections).toEqual([]);
  });

  it("looseningARuleEditsThePlanOrItsPreferences", () => {
    const item = plan(["CS 3000", "MATH 2331"]);
    item.filters.earliestStart = 10 * 60;
    item.filters.freeDays = Day.friday;
    const preferences: SchedulePreferences = { ...emptyPreferences(), daysOff: Day.friday, daysOffStrength: "required" };
    item.preferences = preferences;

    applyPlanEdit({ kind: "clearEarliestStart" }, item);
    expect(item.filters.earliestStart ?? null).toBeNull();
    expect(item.filters.freeDays).toBe(Day.friday);

    applyPlanEdit({ kind: "makeOptional", key: { subject: "CS", number: "3000" } }, item);
    expect(item.courses[0]?.isRequired).toBe(false);
    expect(item.courses[1]?.isRequired).toBe(true);

    applyPlanEdit({ kind: "preference", relaxation: { kind: "softenDaysOff" } }, item);
    expect(item.preferences?.daysOffStrength).toBe("preferred");

    const onlyBlock = plan(["CS 3000"]);
    onlyBlock.preferences = { ...emptyPreferences(), maxClassesPerDay: 2 };
    applyPlanEdit({ kind: "preference", relaxation: { kind: "clearMaxClassesPerDay" } }, onlyBlock);
    expect(onlyBlock.preferences).toBeNull();

    makePlanCoursesOptional(
      [
        { subject: "CS", number: "3000" },
        { subject: "MATH", number: "2331" },
      ],
      item,
    );
    expect(item.courses.every((course) => !course.isRequired)).toBe(true);
  });

  it("noResultsWordingNamesWhatBlocksAndWhatWouldWork", () => {
    const index = clashingIndex();
    const item = plan(["CS 3000", "MATH 2331"]);
    const courses = courseInputsFor(item.courses, lookup(index));
    const filters = emptyPlanFilters();
    const result = generateSchedules(courses, filters, emptyPreferences());
    expect(result.schedules).toEqual([]);
    expect(ScheduleNoResultsText.title(result.diagnostics)).toBe("No schedule fits all 2 courses");
    const analysis = analyzeEmptyResult(courses, filters, emptyPreferences(), result.diagnostics);
    expect(ScheduleNoResultsText.headline(result.diagnostics, analysis.blockers)).toBe("Here\u2019s what would work.");
    const reasons = ScheduleNoResultsText.reasons(result.diagnostics, "Fall 2026");
    expect(reasons.map((reason) => reason.title)).toEqual(["CS 3000 and MATH 2331 always overlap"]);
    const option = analysis.blockers.options[0];
    expect(option).toBeTruthy();
    if (!option) throw new Error("expected a way to make a schedule");
    expect(ScheduleNoResultsText.detail(option, analysis.blockers, "Fall 2026").startsWith("1 schedule")).toBe(true);
    expect(
      ScheduleNoResultsText.list([
        { subject: "CS", number: "3000" },
        { subject: "MATH", number: "2331" },
        { subject: "PHYS", number: "1151" },
      ]),
    ).toBe("CS 3000, MATH 2331 and PHYS 1151");
  });

  it("noResultsWordingSaysWhyEverySectionWasRuledOut", () => {
    const index = clashingIndex();
    const item = plan(["CS 3000"]);
    const filters = { ...emptyPlanFilters(), earliestStart: 20 * 60 };
    const result = generateSchedules(courseInputsFor(item.courses, lookup(index)), filters, emptyPreferences());
    const reasons = ScheduleNoResultsText.reasons(result.diagnostics, "Fall 2026");
    expect(reasons.map((reason) => reason.title)).toEqual(["No CS 3000 sections left"]);
    expect(reasons[0]?.detail).toBe("Its only section starts before 8:00 PM.");
  });

  it("uncertainReorderReasonsAreNotGoodNews", () => {
    expect(ScheduleNoResultsText.isUncertain("Offering history unknown")).toBe(true);
    expect(ScheduleNoResultsText.isUncertain("Couldn\u2019t check the catalog")).toBe(true);
    expect(ScheduleNoResultsText.isUncertain("Offered every spring")).toBe(false);
  });

  it("blockedTimesReadAsTheyAreConfigured", () => {
    const block = blockedTime("Club", Day.tuesday | Day.thursday, 18 * 60, 20 * 60);
    expect(blockedTimeListDetail(block)).toBe("Tue, Thu 6:00 – 8:00 PM");
    block.strength = "preferred";
    expect(blockedTimeListDetail(block)).toBe("Tue, Thu 6:00 – 8:00 PM \u00b7 If I must");
    block.isEnabled = false;
    expect(blockedTimeListDetail(block)).toBe("Tue, Thu 6:00 – 8:00 PM \u00b7 Off");
    expect(blockedTimeListDetail(blockedTime("", 0, 600, 660))).toBe("Choose the days");
    expect(blockedTimeListDetail(blockedTime("", Day.monday, 700, 660))).toBe("Check the times");
  });

  it("calendarLayoutFitsEverySchedule", () => {
    const early = GeneratedSchedule.fromSections([section("A", "CS", "1", [1], 8, 9)]);
    const late = GeneratedSchedule.fromSections([section("B", "CS", "2", [6], 17, 20)]);
    const layout = scheduleCarouselLayout([early, late], defaultPreferences());
    expect([layout.hours.lower, layout.hours.upper]).toEqual([8, 20]);
    expect(layout.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(scheduleCarouselLayout([], defaultPreferences()).days).toEqual([1, 2, 3, 4, 5]);
  });

  it("autofillSuggestionsComeFromTheDegreePlanAndOtherSchedules", () => {
    const index = clashingIndex();
    const target = plan([]);
    const sibling = plan(["CS 3000", "ENGW 1111"]);
    sibling.name = "Plan B";
    const suggestions = autofillSuggestions({
      plan: target,
      terms: [],
      degreePlans: [],
      schedulePlans: [sibling, target],
      index,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.courses.map((key) => keyId(key))).toEqual(["CS 3000", "ENGW 1111"]);
    expect(suggestions[0] && autofillSourceName(suggestions[0])).toBe("Copy \u201cPlan B\u201d");
    expect(
      autofillSuggestions({ plan: target, terms: [], degreePlans: [], schedulePlans: [target], index }),
    ).toEqual([]);
    expect(courseCountLabel(1)).toBe("1 course");
    expect(courseCountLabel(3)).toBe("3 courses");
    const suggestion = suggestions[0];
    if (!suggestion) throw new Error("expected a suggestion to dismiss");
    const key = dismissalKey(target.id, suggestion);
    const stored = addDismissal(key, "");
    expect(isAutofillDismissed(key, stored)).toBe(true);
    expect(isAutofillDismissed("other", stored)).toBe(false);
  });

  it("draggedTextNamesCoursesAndSections", () => {
    const parsed = parseDroppedCourses(["CS 3000", "math 2331 12345\nPHYS 1151 99\nCS 3000", "Dr. Smith", "John Smith"]);
    expect(parsed.map((item) => keyId(item.key))).toEqual(["CS 3000", "MATH 2331", "PHYS 1151"]);
    expect(parsed.map((item) => item.crn)).toEqual([null, "12345", null]);
    expect(parseDroppedCourses([])).toEqual([]);
    expect(parseDroppedCourses(["hello"])).toEqual([]);
  });

  it("clockConvertsMinutesAndPickerDates", () => {
    for (const minutes of [0, 9 * 60 + 15, 23 * 60 + 59]) {
      expect(scheduleClockMinutes(scheduleClockDate(minutes))).toBe(minutes);
    }
    expect(scheduleClockMinutes(scheduleClockDate(24 * 60))).toBe(24 * 60 - 1);
    expect(scheduleClockMinutes(scheduleClockDate(-5))).toBe(0);
  });

  it("removingACourseTakesItsSectionsAndFavoritesAndUndoPutsThemBack", () => {
    const store = new PlanDataStore();
    const index = clashingIndex();
    const created = store.createPlan("Plan A", "202710");
    for (const code of ["CS 3000", "MATH 2331", "ENGW 1111"]) store.addCourse(parseCourseKey(code)!, created.id);
    store.updatePlan(created.id, (current) => {
      current.selectedCRNs = ["A1", "C1"];
      current.favoriteCombinations = [
        ["A1", "C1"],
        ["B1", "C1"],
      ];
    });
    const current = store.plan(created.id);
    if (!current) throw new Error("expected the plan");
    const resolved = new ResolvedPlan(current, index);
    const entry = resolved.entryFor(parseCourseKey("CS 3000")!);
    if (!entry) throw new Error("expected CS 3000");

    const removal = removePlanCourse(entry, current, index, store);
    const after = store.plan(created.id);
    if (!after) throw new Error("expected the plan after removal");
    expect(after.courses.map((course) => keyId(course.key))).toEqual(["MATH 2331", "ENGW 1111"]);
    expect(after.selectedCRNs).toEqual(["C1"]);
    expect(after.favoriteCombinations).toEqual([["B1", "C1"]]);
    expect(removal.index).toBe(0);
    expect(removal.selectedCRNs).toEqual(["A1"]);

    store.updatePlan(created.id, (currentPlan) => {
      restorePlanCourse(removal, currentPlan);
    });
    const restored = store.plan(created.id);
    if (!restored) throw new Error("expected the restored plan");
    expect(restored.courses.map((course) => keyId(course.key))).toEqual(["CS 3000", "MATH 2331", "ENGW 1111"]);
    expect(new Set(restored.selectedCRNs)).toEqual(new Set(["A1", "C1"]));
    expect(restored.favoriteCombinations.some((combo) => combo.length === 2 && combo[0] === "A1" && combo[1] === "C1")).toBe(true);
  });

  it("autofillAddsRequiredCoursesOnceAndUndoTakesThemOut", () => {
    const store = new PlanDataStore();
    const created = store.createPlan("Plan A", "202710");
    store.addCourse(parseCourseKey("CS 3000")!, created.id);
    const added = addAutofill([parseCourseKey("CS 3000")!, parseCourseKey("ENGW 1111")!], created.id, store);
    expect(added.map((key) => keyId(key))).toEqual(["ENGW 1111"]);
    expect(store.plan(created.id)?.courses).toHaveLength(2);
    expect(store.plan(created.id)?.courses.find((course) => keyId(course.key) === "ENGW 1111")?.isRequired).toBe(true);
    undoAutofill(added, created.id, clashingIndex(), store);
    expect(store.plan(created.id)?.courses.map((course) => keyId(course.key))).toEqual(["CS 3000"]);
  });

  it("reorderingTheDegreePlanNeedsASemesterThatMatchesTheTerm", () => {
    const schedule = plan(["CS 3000"]);
    const term: DegreePlanTerm = {
      id: "fall-2026",
      season: "fall",
      year: 2026,
      courses: [degreeCourse("CS 3000", "Algorithms")],
    };
    const degree: DegreePlan = {
      id: "degree",
      name: "Plan",
      completed: [],
      terms: [term],
      isPrimary: false,
      createdAt: 0,
      updatedAt: 0,
      substitutions: [],
      courseEquivalences: [],
    };
    const terms: Term[] = [{ code: "202710", bannerDescription: "Fall 2026 Semester" }];
    const found = reorderSemester(schedule, degree, terms, null);
    expect(found?.term.code).toBe("202710");
    expect(found?.plan.id).toBe(degree.id);
    const spring = { ...schedule, termCode: "202730" };
    expect(reorderSemester(spring, degree, terms, null)).toBeNull();
    expect(reorderSemester(schedule, null, terms, null)).toBeNull();
  });
});
