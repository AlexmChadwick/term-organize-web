/**
 * Keeps a chosen credit value on the matching degree-plan and schedule rows.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { planTermMatches } from "@/lib/degree-logic";
import type { CourseKey } from "@/lib/models";
import type { DegreePlanCourse, DegreePlanTerm } from "@/lib/requirements";
import type { PlanCourse, SchedulePlan, UserData } from "@/lib/user";
import { clampChosenCredits, creditMark, refreshRowCredits } from "@/lib/variable-credits";

function scheduleMark(course: PlanCourse): string {
  return creditMark(course.key, course.pinnedCRN);
}

function schedulesForTerm(plans: readonly SchedulePlan[], term: DegreePlanTerm): SchedulePlan[] {
  return plans.filter((plan) => planTermMatches(term, { code: plan.termCode, bannerDescription: "" }));
}

/** Set one degree-plan row and the matching schedule rows. Other copies are left alone. */
export function setDegreeRowCredits(data: UserData, planId: string, courseId: string, credits: number): UserData {
  const plan = data.degreePlans.find((item) => item.id === planId);
  if (!plan) return data;
  let term: DegreePlanTerm | null = null;
  let course: DegreePlanCourse | null = null;
  for (const item of plan.completed) if (item.id === courseId) course = item;
  for (const item of plan.terms) {
    const found = item.courses.find((row) => row.id === courseId);
    if (found) {
      term = item;
      course = found;
    }
  }
  if (!course) return data;
  const nextCredits = course.creditLow != null && course.creditHigh != null ? clampChosenCredits(credits, course.creditLow, course.creditHigh) : clampChosenCredits(credits, 0, 99);
  const degreePlans = data.degreePlans.map((item) => {
    if (item.id !== planId) return item;
    const write = (row: DegreePlanCourse) => (row.id === courseId ? { ...row, credits: nextCredits } : row);
    return {
      ...item,
      updatedAt: Date.now(),
      completed: item.completed.map(write),
      terms: item.terms.map((semester) => ({ ...semester, courses: semester.courses.map(write) })),
    };
  });
  if (!term || !course.key) return { ...data, degreePlans };
  const mark = creditMark(course.key, course.crn);
  const at = term.courses.findIndex((row) => row.id === courseId);
  const occurrence = term.courses.slice(0, at).filter((row) => row.key && creditMark(row.key, row.crn) === mark).length;
  const plans = data.plans.map((schedule) => {
    if (!schedulesForTerm([schedule], term).length) return schedule;
    const same = schedule.courses.flatMap((row, index) => (scheduleMark(row) === mark ? [index] : []));
    const index = same[occurrence];
    if (index == null) return schedule;
    const courses = schedule.courses.map((row, rowIndex) =>
      rowIndex === index ? { ...row, credits: nextCredits, creditLow: course.creditLow, creditHigh: course.creditHigh } : row,
    );
    return { ...schedule, courses, updatedAt: Date.now() };
  });
  return { ...data, degreePlans, plans };
}

/** Set one schedule row and the matching degree-plan rows. Other copies are left alone. */
export function setScheduleRowCredits(data: UserData, scheduleId: string, courseIndex: number, credits: number): UserData {
  const schedule = data.plans.find((item) => item.id === scheduleId);
  const course = schedule?.courses[courseIndex];
  if (!schedule || !course) return data;
  const nextCredits = course.creditLow != null && course.creditHigh != null ? clampChosenCredits(credits, course.creditLow, course.creditHigh) : clampChosenCredits(credits, 0, 99);
  const plans = data.plans.map((item) => {
    if (item.id !== scheduleId) return item;
    const courses = item.courses.map((row, index) => (index === courseIndex ? { ...row, credits: nextCredits } : row));
    return { ...item, courses, updatedAt: Date.now() };
  });
  const mark = scheduleMark(course);
  const occurrence = schedule.courses.slice(0, courseIndex).filter((row) => scheduleMark(row) === mark).length;
  const degreePlans = data.degreePlans.map((plan) => {
    let changed = false;
    const terms = plan.terms.map((term) => {
      if (!planTermMatches(term, { code: schedule.termCode, bannerDescription: "" })) return term;
      const same = term.courses.flatMap((row, index) => (row.key && creditMark(row.key, row.crn) === mark ? [index] : []));
      const index = same[occurrence];
      if (index == null) return term;
      changed = true;
      const courses = term.courses.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              credits: nextCredits,
              ...(course.creditLow != null && course.creditHigh != null ? { creditLow: course.creditLow, creditHigh: course.creditHigh } : {}),
            }
          : row,
      );
      return { ...term, courses };
    });
    return changed ? { ...plan, terms, updatedAt: Date.now() } : plan;
  });
  return { ...data, plans, degreePlans };
}

/** After a catalog refresh, clamp chosen credits for this term. Completed courses stay as recorded. */
export function refreshCreditsFromCatalog(
  data: UserData,
  termCode: string,
  courseOf: (key: CourseKey) => { minCredits: number; maxCredits: number; defaultCredits?: number | null } | null | undefined,
): UserData {
  const plans = data.plans.map((plan) => {
    if (plan.termCode !== termCode) return plan;
    return { ...plan, courses: plan.courses.map((course) => refreshRowCredits(course, courseOf(course.key))) };
  });
  const degreePlans = data.degreePlans.map((plan) => ({
    ...plan,
    terms: plan.terms.map((term) => {
      if (!planTermMatches(term, { code: termCode, bannerDescription: "" })) return term;
      return {
        ...term,
        courses: term.courses.map((course) => (course.key ? refreshRowCredits(course, courseOf(course.key)) : course)),
      };
    }),
  }));
  return { ...data, plans, degreePlans };
}
