import { describe, expect, it } from "vitest";
import { scheduleForDegreePlan } from "@/lib/degree/plan-edit";
import { courseCopyLabel, newDegreePlanDraft } from "@/lib/degree-logic";
import { runDegreeAudit } from "@/lib/degree/audit";
import { course, emptyPlan, requirements, term } from "@/lib/degree/swift-fixtures";
import { ResolvedPlan } from "@/lib/schedule/plan-edits";
import { courseInputsFor } from "@/lib/schedule/generator";
import { termCredits } from "@/lib/requirements";
import { emptyPlanFilters, emptyUserData, mergeUserData, type PlanCourse, type SchedulePlan, type UserData } from "@/lib/user";
import { refreshCreditsFromCatalog, setDegreeRowCredits, setScheduleRowCredits } from "@/lib/credit-sync";
import { clampChosenCredits, creditsCaption, defaultChosenCredits } from "@/lib/variable-credits";

describe("variable credits", () => {
  it("defaults to creditHours inside the range and otherwise the low end", () => {
    expect(defaultChosenCredits({ low: 1, high: 8, creditHours: 4 })).toBe(4);
    expect(defaultChosenCredits({ low: 2, high: 4, creditHours: 4 })).toBe(4);
    expect(defaultChosenCredits({ low: 2, high: 4, creditHours: 1 })).toBe(2);
    expect(defaultChosenCredits({ low: 1, high: 8, creditHours: null })).toBe(1);
  });

  it("clamps to a whole number inside the range", () => {
    expect(clampChosenCredits(4.2, 1, 8)).toBe(4);
    expect(clampChosenCredits(0, 1, 8)).toBe(1);
    expect(clampChosenCredits(9, 1, 8)).toBe(8);
    expect(clampChosenCredits(Number.NaN, 2, 4)).toBe(2);
    expect(creditsCaption(4, 1, 8)).toBe("Credits: 4 (1 to 8)");
  });

  it("counts each duplicate at its own chosen value", () => {
    const plan = emptyPlan("Readings");
    const first = { ...course("CS 8982", 1, "Readings"), creditLow: 1, creditHigh: 8 };
    const second = { ...course("CS 8982", 8, "Readings"), creditLow: 1, creditHigh: 8 };
    const fixed = course("CS 2500", 4, "Fundamentals");
    plan.terms = [term("fall", "fall", 2026, [first, second, fixed])];
    expect(courseCopyLabel(plan, first)).toBe("CS 8982");
    expect(courseCopyLabel(plan, second)).toBe("CS 8982 (2)");
    expect(termCredits(plan.terms[0]!)).toBe(13);
    expect(runDegreeAudit(plan, requirements()).plannedHours).toBe(13);

    const schedule = makeSchedule([row("8982", 1, [1, 8]), row("8982", 8, [1, 8])]);
    const user = withData(plan, [schedule]);
    const changed = setDegreeRowCredits(user, plan.id, second.id, 3);
    const degree = changed.degreePlans[0]!.terms[0]!.courses;
    expect(degree.map((item) => item.credits)).toEqual([1, 3, 4]);
    expect(changed.plans[0]!.courses.map((item) => item.credits)).toEqual([1, 3]);
    expect(termCredits(changed.degreePlans[0]!.terms[0]!)).toBe(8);
    expect(setDegreeRowCredits(user, plan.id, second.id, 40).degreePlans[0]!.terms[0]!.courses[1]!.credits).toBe(8);
  });

  it("syncs one matching row in either direction and does not merge copies", () => {
    const first = { ...course("CS 6966", 2, "Practicum"), creditLow: 2, creditHigh: 4 };
    const second = { ...course("CS 6966", 4, "Practicum"), creditLow: 2, creditHigh: 4 };
    const plan = emptyPlan("Practicum");
    plan.terms = [term("fall", "fall", 2026, [first, second])];
    const schedule = makeSchedule([row("6966", 2, [2, 4]), row("6966", 4, [2, 4])]);
    const fromSchedule = setScheduleRowCredits(withData(plan, [schedule]), schedule.id, 0, 3);
    expect(fromSchedule.plans[0]!.courses.map((item) => item.credits)).toEqual([3, 4]);
    expect(fromSchedule.degreePlans[0]!.terms[0]!.courses.map((item) => item.credits)).toEqual([3, 4]);

    const plans = [makeSchedule([row("6966", 1), row("6966", 1)])];
    const synced = scheduleForDegreePlan(plans, plan.terms[0]!, "202710");
    expect(synced?.isNew).toBe(false);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.courses.map((item) => item.credits)).toEqual([2, 4]);

    const created = scheduleForDegreePlan([], plan.terms[0]!, "202710");
    expect(created?.plan.courses.map((item) => item.credits)).toEqual([2, 4]);
    expect(created?.plan.courses.map((item) => item.creditHigh)).toEqual([4, 4]);

    const draft = newDegreePlanDraft("From schedule", null, [makeSchedule([row("8982", 6, [1, 8])])], () => ({
      title: "Readings",
      credits: 4,
      creditLow: 1,
      creditHigh: 8,
    }));
    expect(draft.terms[0]!.courses.map((item) => [item.credits, item.creditLow, item.creditHigh])).toEqual([[6, 1, 8]]);
  });

  it("uses the chosen value for schedule totals and overload", () => {
    const heavy = makeSchedule([row("8982", 8, [1, 8]), row("6966", 4, [2, 4]), row("2500", 8)]);
    const resolved = new ResolvedPlan(heavy, null);
    expect(resolved.credits).toEqual({ min: 20, max: 20 });
    expect(resolved.isOverCreditLimit).toBe(true);
    const inputs = courseInputsFor(heavy.courses, { course: () => null, sectionsFor: () => [] });
    expect(inputs.map((input) => [input.minCredits, input.maxCredits])).toEqual([
      [8, 8],
      [4, 4],
      [8, 8],
    ]);
  });

  it("migrates saved rows and still loads them", () => {
    const loaded = mergeUserData({
      version: 1,
      degreePlans: [
        {
          id: "plan-old",
          name: "Old",
          isPrimary: true,
          completed: [{ id: "done", label: "CS 8982", title: "Readings", credits: 5, creditLow: 1, creditHigh: 8 }],
          terms: [
            {
              id: "fall",
              season: "fall",
              year: 2026,
              courses: [
                { id: "kept", label: "CS 2500", title: "Fundamentals", credits: 4 },
                { id: "clamped", label: "CS 6966", title: "Practicum", credits: 9, creditLow: 2, creditHigh: 4 },
                { id: "missing", label: "CS 8982", title: "Readings", creditLow: 1, creditHigh: 8 },
              ],
            },
          ],
        },
      ],
      plans: [
        {
          id: "sched-old",
          name: "Fall",
          termCode: "202710",
          courses: [{ key: { subject: "CS", number: "8982" }, isRequired: true, excludedCRNs: [], colorIndex: 0, creditLow: 1, creditHigh: 8 }],
          selectedCRNs: [],
          filters: emptyPlanFilters(),
          favoriteCombinations: [],
          isPrimary: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(loaded.degreePlans[0]!.completed[0]!.credits).toBe(5);
    const rows = loaded.degreePlans[0]!.terms[0]!.courses;
    expect(rows.map((item) => item.credits)).toEqual([4, 4, 4]);
    expect(rows[0]!.creditLow).toBeUndefined();
    expect(loaded.plans[0]!.courses[0]!.credits).toBe(1);
  });

  it("clamps a chosen value into a new catalog range and leaves other edits alone", () => {
    const readings = { ...course("CS 8982", 8, "Readings"), creditLow: 1, creditHigh: 8 };
    const practicum = { ...course("CS 6966", 3, "Practicum"), creditLow: 2, creditHigh: 4 };
    const manual = course("CS 2500", 3, "Fundamentals");
    const done = { ...course("CS 8982", 7, "Readings"), creditLow: 1, creditHigh: 8 };
    const plan = emptyPlan("Refresh");
    plan.completed = [done];
    plan.terms = [
      term("fall", "fall", 2026, [readings, practicum, manual]),
      term("spring", "spring", 2027, [{ ...course("CS 8982", 8, "Readings"), creditLow: 1, creditHigh: 8 }]),
    ];
    const schedule = makeSchedule([row("8982", 8, [1, 8]), row("6966", 3, [2, 4])]);
    const other = makeSchedule([row("8982", 8, [1, 8])], "202730");
    other.id = "other";
    const refreshed = refreshCreditsFromCatalog(withData(plan, [schedule, other]), "202710", (key) => {
      if (key.number === "8982") return { minCredits: 1, maxCredits: 6, defaultCredits: 4 };
      if (key.number === "6966") return { minCredits: 2, maxCredits: 4, defaultCredits: 4 };
      if (key.number === "2500") return { minCredits: 4, maxCredits: 4, defaultCredits: 4 };
      return null;
    });
    const fall = refreshed.degreePlans[0]!.terms[0]!.courses;
    expect(fall.map((item) => item.credits)).toEqual([6, 3, 3]);
    expect(fall[0]!.creditHigh).toBe(6);
    expect(fall[2]!.creditLow).toBeUndefined();
    expect(refreshed.degreePlans[0]!.completed[0]!.credits).toBe(7);
    expect(refreshed.degreePlans[0]!.terms[1]!.courses[0]!.credits).toBe(8);
    expect(refreshed.plans[0]!.courses.map((item) => item.credits)).toEqual([6, 3]);
    expect(refreshed.plans[1]!.courses[0]!.credits).toBe(8);
  });
});

function row(number: string, credits?: number, range?: [number, number]): PlanCourse {
  return {
    key: { subject: "CS", number },
    isRequired: true,
    excludedCRNs: [],
    colorIndex: 0,
    ...(credits != null ? { credits } : {}),
    ...(range ? { creditLow: range[0], creditHigh: range[1] } : {}),
  };
}

function makeSchedule(courses: PlanCourse[], termCode = "202710"): SchedulePlan {
  return {
    id: "sched",
    name: "Fall",
    termCode,
    courses,
    selectedCRNs: [],
    filters: emptyPlanFilters(),
    favoriteCombinations: [],
    isPrimary: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function withData(plan: ReturnType<typeof emptyPlan>, plans: SchedulePlan[]): UserData {
  return { ...emptyUserData(), degreePlans: [plan], plans };
}
