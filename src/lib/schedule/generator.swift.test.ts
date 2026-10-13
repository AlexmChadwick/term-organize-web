import { describe, expect, it } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import { loadBundledCatalog } from "@/lib/catalog-store";
import { Day, emptyScheduleFilters } from "@/lib/models";
import { ScheduleSlotMask, courseInputsFor } from "@/lib/schedule/generator";
import { course, crnSets, expectSets, generate, section } from "@/lib/schedule/swift-fixtures";

describe("ScheduleGeneratorTests", () => {
  it("slotMasksDetectOverlaps", () => {
    const a = new ScheduleSlotMask(section("1", "CS", "1", [1, 3], 10, 11));
    const b = new ScheduleSlotMask(section("2", "CS", "2", [3], 10.5, 12));
    const c = new ScheduleSlotMask(section("3", "CS", "3", [1, 3], 11, 12));
    expect(a.conflicts(b)).toBe(true);
    expect(a.conflicts(c)).toBe(false);
    expect(a.conflicts(new ScheduleSlotMask(section("4", "CS", "4", [2, 4], 10, 11)))).toBe(false);
  });

  it("generatesOnlyConflictFreeCombinations", () => {
    const courses = [
      course("CS", "3000", [
        section("A1", "CS", "3000", [1, 3, 4], 9, 10),
        section("A2", "CS", "3000", [1, 3, 4], 13, 14),
      ]),
      course("MATH", "2331", [
        section("B1", "MATH", "2331", [1, 3, 4], 9.5, 10.5),
        section("B2", "MATH", "2331", [2, 5], 9, 10.5),
      ]),
    ];
    const result = generate(courses);
    expect(result.totalFound).toBe(3);
    expect(result.schedules.some((schedule) => new Set(schedule.crns).size === 2 && schedule.crns.includes("A1") && schedule.crns.includes("B1"))).toBe(false);
    for (const schedule of result.schedules) {
      const masks = schedule.sections.map((item) => new ScheduleSlotMask(item));
      for (let i = 0; i < masks.length; i++) {
        for (let j = i + 1; j < masks.length; j++) expect(masks[i]!.conflicts(masks[j]!)).toBe(false);
      }
    }
  });

  it("respectsFilters", () => {
    const courses = [
      course("CS", "3000", [
        section("EARLY", "CS", "3000", [1, 3], 8, 9),
        section("FRI", "CS", "3000", [5], 12, 15),
        section("OK", "CS", "3000", [2, 4], 11, 12),
      ]),
    ];
    const filters = { ...emptyScheduleFilters(), earliestStart: 9 * 60, freeDays: Day.friday };
    const result = generate(courses, undefined, filters);
    expect(result.schedules.map((schedule) => schedule.crns)).toEqual([["OK"]]);
  });

  it("optionalCoursesFillInWhenTheyFit", () => {
    const courses = [
      course("CS", "3000", [section("R", "CS", "3000", [1, 3], 10, 11)]),
      course("ARTF", "1220", [section("O1", "ARTF", "1220", [1], 10.5, 12), section("O2", "ARTF", "1220", [2], 10, 12)], { required: false }),
    ];
    const result = generate(courses);
    expect(crnSets(result)).toEqual(expectSets([["R", "O2"]]));
    const single = generate(courses, undefined, { ...emptyScheduleFilters(), courseCount: 1 });
    expect(single.schedules.map((schedule) => schedule.crns)).toEqual([["R"]]);
  });

  it("realCatalogPlanGenerates", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    const index = CatalogIndex.build(catalog!);
    const keys = [
      { subject: "CS", number: "3000" },
      { subject: "CS", number: "3001" },
      { subject: "MATH", number: "2331" },
    ];
    const courses = courseInputsFor(
      keys.map((key) => ({ key, isRequired: true })),
      { course: (key) => index.course(key) ?? null, sectionsFor: (key) => index.sectionsOf(key) },
    );
    const result = generate(courses);
    expect(result.totalFound).toBeGreaterThan(0);
    expect(result.schedules.every((schedule) => schedule.crns.length === 3)).toBe(true);
  }, 60_000);
});
