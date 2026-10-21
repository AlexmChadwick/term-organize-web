/**
 * A chosen section is the term plus the CRN. Course number is not an identity:
 * special topics share a number, and a pin must not be swapped for another section.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseKey, CourseSection } from "@/lib/models";
import { keyId, sameKey } from "@/lib/models";
import type { PlanCourse, SchedulePlan } from "@/lib/user";
import { nextColorIndex } from "@/lib/user";

export function sectionIdentity(termCode: string, crn: string): string {
  return `${termCode}:${crn}`;
}

/** A second copy of a course number is allowed only when every copy has its own CRN. */
export function canPlacePlanCourse(courses: readonly PlanCourse[], key: CourseKey, pinnedCRN?: string | null): boolean {
  const same = courses.filter((course) => sameKey(course.key, key));
  if (same.length === 0) return true;
  if (!pinnedCRN) return false;
  return same.every((course) => course.pinnedCRN != null && course.pinnedCRN !== pinnedCRN);
}

export function placePlanCourse(plan: SchedulePlan, key: CourseKey, pinnedCRN?: string | null): SchedulePlan {
  if (!canPlacePlanCourse(plan.courses, key, pinnedCRN)) return plan;
  const course: PlanCourse = {
    key,
    isRequired: true,
    excludedCRNs: [],
    colorIndex: nextColorIndex(plan),
    ...(pinnedCRN ? { pinnedCRN } : {}),
  };
  const selectedCRNs = pinnedCRN && !plan.selectedCRNs.includes(pinnedCRN) ? [...plan.selectedCRNs, pinnedCRN] : plan.selectedCRNs;
  return { ...plan, courses: [...plan.courses, course], selectedCRNs };
}

/**
 * Points one plan entry at a CRN. Clearing the only entry unlocks it. A second
 * entry of the same number cannot be unlocked, and a CRN already used by
 * another entry is refused.
 */
export function selectSectionOnPlan(
  plan: SchedulePlan,
  courseIndex: number,
  crn: string,
  sectionsOfCourse: readonly Pick<CourseSection, "crn">[] = [],
): SchedulePlan {
  const current = plan.courses[courseIndex];
  if (!current) return plan;
  const siblingPins = new Set(
    plan.courses.flatMap((course, index) => (index !== courseIndex && course.pinnedCRN && sameKey(course.key, current.key) ? [course.pinnedCRN] : [])),
  );
  if (!crn) {
    if (siblingPins.size > 0) return plan;
    const drop = new Set<string>(sectionsOfCourse.map((section) => section.crn));
    if (current.pinnedCRN) drop.add(current.pinnedCRN);
    const courses = plan.courses.map((course, index) => (index === courseIndex ? { ...course, pinnedCRN: undefined } : course));
    return { ...plan, courses, selectedCRNs: plan.selectedCRNs.filter((id) => !drop.has(id)) };
  }
  if (siblingPins.has(crn)) return plan;
  const owned = new Set<string>(sectionsOfCourse.map((section) => section.crn));
  if (current.pinnedCRN) owned.add(current.pinnedCRN);
  const selectedCRNs = plan.selectedCRNs.filter((id) => siblingPins.has(id) || !owned.has(id));
  if (!selectedCRNs.includes(crn)) selectedCRNs.push(crn);
  const courses = plan.courses.map((course, index) => (index === courseIndex ? { ...course, pinnedCRN: crn } : course));
  return { ...plan, courses, selectedCRNs };
}

/** "Use this section": pin the open entry, or add another entry when the CRN is new. */
export function pinSectionOnPlan(plan: SchedulePlan, key: CourseKey, crn: string): SchedulePlan {
  if (plan.courses.some((course) => course.pinnedCRN === crn)) return plan;
  const same = plan.courses.filter((course) => sameKey(course.key, key));
  if (same.length === 1 && !same[0]!.pinnedCRN) {
    const index = plan.courses.indexOf(same[0]!);
    return selectSectionOnPlan(plan, index, crn);
  }
  return placePlanCourse(plan, key, crn);
}

export function removePlanEntry(
  plan: SchedulePlan,
  courseIndex: number,
  sectionsOfCourse: readonly Pick<CourseSection, "crn">[] = [],
): SchedulePlan {
  const entry = plan.courses[courseIndex];
  if (!entry) return plan;
  const siblingPins = new Set(
    plan.courses.flatMap((course, index) => (index !== courseIndex && course.pinnedCRN ? [course.pinnedCRN] : [])),
  );
  const drop = new Set<string>();
  if (entry.pinnedCRN) drop.add(entry.pinnedCRN);
  else for (const section of sectionsOfCourse) if (!siblingPins.has(section.crn)) drop.add(section.crn);
  return {
    ...plan,
    courses: plan.courses.filter((_, index) => index !== courseIndex),
    selectedCRNs: plan.selectedCRNs.filter((crn) => !drop.has(crn)),
    favoriteCombinations: plan.favoriteCombinations.filter((combo) => !combo.some((crn) => drop.has(crn))),
  };
}

/**
 * Older plans stored a manual choice only in `selectedCRNs`. Attach each of
 * those CRNs to its own entry once, then leave later generated choices unpinned.
 */
export function ensureManualPins(
  plan: SchedulePlan,
  sectionByCrn: (crn: string) => Pick<CourseSection, "subject" | "number"> | null | undefined,
): SchedulePlan {
  if (plan.manualPinsMigrated) return plan;
  const courses = plan.courses.map((course) => ({ ...course }));
  const used = new Set<number>();
  for (const crn of plan.selectedCRNs) {
    const section = sectionByCrn(crn);
    if (!section) continue;
    const key = { subject: section.subject, number: section.number };
    if (courses.some((course) => course.pinnedCRN === crn)) continue;
    const open = courses.findIndex((course, index) => !used.has(index) && !course.pinnedCRN && sameKey(course.key, key));
    if (open >= 0) {
      courses[open] = { ...courses[open]!, pinnedCRN: crn };
      used.add(open);
      continue;
    }
    if (!canPlacePlanCourse(courses, key, crn)) continue;
    courses.push({
      key,
      isRequired: true,
      excludedCRNs: [],
      colorIndex: nextColorIndex({ ...plan, courses }),
      pinnedCRN: crn,
    });
  }
  return { ...plan, courses, manualPinsMigrated: true };
}

/** Keeps every pin. Generated CRNs fill only entries that have no pin. */
export function applyGeneratedCRNs(
  plan: SchedulePlan,
  generated: readonly string[],
  sectionByCrn: (crn: string) => Pick<CourseSection, "subject" | "number"> | null | undefined,
): SchedulePlan {
  const locks = plan.courses.flatMap((course) => (course.pinnedCRN ? [course.pinnedCRN] : []));
  const lockSet = new Set(locks);
  const unlocked = plan.courses.filter((course) => !course.pinnedCRN);
  const selected = [...locks];
  const taken = new Map<string, number>();
  for (const crn of generated) {
    if (lockSet.has(crn)) continue;
    const section = sectionByCrn(crn);
    if (!section) continue;
    const id = keyId({ subject: section.subject, number: section.number });
    const slots = unlocked.filter((course) => keyId(course.key) === id).length;
    const used = taken.get(id) ?? 0;
    if (used >= slots) continue;
    selected.push(crn);
    taken.set(id, used + 1);
  }
  return { ...plan, selectedCRNs: selected };
}

/**
 * A refresh may update the section with this CRN. It may not drop that section
 * or retarget the pin onto a different CRN of the same course number.
 */
export function mergeRefreshedSections(
  previous: readonly CourseSection[],
  incoming: readonly CourseSection[],
  pinnedCRNs: readonly string[],
): CourseSection[] {
  const arrived = new Set(incoming.map((section) => section.crn));
  const kept = previous.filter((section) => pinnedCRNs.includes(section.crn) && !arrived.has(section.crn));
  return [...incoming, ...kept];
}

export function applyCourseMoves(
  plan: SchedulePlan,
  movedAway: readonly CourseKey[],
  movedIn: readonly CourseKey[],
  sectionsOf: (key: CourseKey) => readonly CourseSection[],
  movedAwayCRNs?: readonly (string | null | undefined)[],
): SchedulePlan {
  const courses = [...plan.courses];
  const removedCRNs = new Set<string>();
  movedAway.forEach((key, index) => {
    const crn = movedAwayCRNs?.[index] ?? null;
    let at = courses.findIndex((course) => sameKey(course.key, key) && (crn ? course.pinnedCRN === crn : !course.pinnedCRN));
    if (at < 0 && crn) at = courses.findIndex((course) => course.pinnedCRN === crn);
    if (at < 0 && !crn) at = courses.findIndex((course) => sameKey(course.key, key));
    if (at < 0) return;
    const entry = courses[at]!;
    courses.splice(at, 1);
    if (entry.pinnedCRN) {
      removedCRNs.add(entry.pinnedCRN);
      return;
    }
    const kept = new Set(courses.flatMap((course) => (sameKey(course.key, key) && course.pinnedCRN ? [course.pinnedCRN] : [])));
    for (const section of sectionsOf(key)) if (!kept.has(section.crn)) removedCRNs.add(section.crn);
  });
  let next = courses;
  for (const key of movedIn) {
    if (!sectionsOf(key).length || !canPlacePlanCourse(next, key, null)) continue;
    const added: PlanCourse = { key, isRequired: true, excludedCRNs: [], colorIndex: nextColorIndex({ ...plan, courses: next }) };
    next = [...next, added];
  }
  return {
    ...plan,
    courses: next,
    selectedCRNs: plan.selectedCRNs.filter((crn) => !removedCRNs.has(crn)),
    favoriteCombinations: plan.favoriteCombinations.filter((combo) => !combo.some((crn) => removedCRNs.has(crn))),
  };
}
