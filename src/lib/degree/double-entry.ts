/**
 * Adding the same course to a degree plan twice, each row with its own CRN.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseKey, CourseSection } from "@/lib/models";
import { instructorLabel, keyId, sameKey, scheduleSummary } from "@/lib/models";
import { PLAN_SEASON_SHORT, type DegreePlan, type DegreePlanCourse, type DegreePlanTerm } from "@/lib/requirements";

export interface PlanCoursePlace {
  course: DegreePlanCourse;
  /** `completed`, or the term the row sits in. */
  term: DegreePlanTerm | null;
}

export interface UnpinnedRow {
  id: string;
  label: string;
}

export interface OpenSectionPick {
  label: string;
  unpinned: UnpinnedRow[];
  taken: string[];
}

export interface SectionChoice {
  crn: string;
  title: string;
  instructor: string;
  times: string;
}

export function planTermLabel(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_SHORT[term.season]} ${term.year}`;
}

/** Shown when a second row needs a section and this term has none to offer. */
export function noSectionsMessage(termLabel: string): string {
  return `Pick a section to add this course twice. No sections are listed for ${termLabel} yet.`;
}

export function sectionChoice(section: CourseSection): SectionChoice {
  return {
    crn: section.crn,
    title: section.title,
    instructor: instructorLabel(section),
    times: scheduleSummary(section),
  };
}

export function courseEntries(plan: DegreePlan, key: CourseKey): PlanCoursePlace[] {
  const places: PlanCoursePlace[] = [];
  for (const course of plan.completed) {
    if (course.key && sameKey(course.key, key)) places.push({ course, term: null });
  }
  for (const term of plan.terms) {
    for (const course of term.courses) {
      if (course.key && sameKey(course.key, key)) places.push({ course, term });
    }
  }
  return places;
}

/** A second copy needs a section picker. The first copy of a course does not. */
export function openSectionPick(plan: DegreePlan, key: CourseKey): OpenSectionPick | null {
  const matches = courseEntries(plan, key);
  if (!matches.length) return null;
  const unpinned = matches.filter((place) => !place.course.crn);
  return {
    label: keyId(key),
    unpinned: unpinned.map((place, index) => ({
      id: place.course.id,
      label: unpinned.length > 1 ? `${place.course.label} (${index + 1})` : place.course.label,
    })),
    taken: matches.flatMap((place) => (place.course.crn ? [place.course.crn] : [])),
  };
}

export function addPlanCourse(plan: DegreePlan, where: "completed" | number, course: DegreePlanCourse): DegreePlan | null {
  if (where === "completed") return { ...plan, completed: [...plan.completed, course] };
  const term = plan.terms[where];
  if (!term) return null;
  return {
    ...plan,
    terms: plan.terms.map((item, index) => (index === where ? { ...item, courses: [...item.courses, course] } : item)),
  };
}

export function updatePlanCourse(
  plan: DegreePlan,
  id: string,
  patch: Partial<Pick<DegreePlanCourse, "title" | "credits" | "crn">>,
): DegreePlan {
  const apply = (course: DegreePlanCourse) => (course.id === id ? { ...course, ...patch } : course);
  return {
    ...plan,
    completed: plan.completed.map(apply),
    terms: plan.terms.map((term) => ({ ...term, courses: term.courses.map(apply) })),
  };
}

/** Drops one row. Another row with the same course number stays. */
export function removePlanCourse(plan: DegreePlan, id: string): DegreePlan {
  return {
    ...plan,
    completed: plan.completed.filter((course) => course.id !== id),
    terms: plan.terms.map((term) => ({ ...term, courses: term.courses.filter((course) => course.id !== id) })),
  };
}

function findCourse(plan: DegreePlan, id: string): DegreePlanCourse | null {
  for (const course of plan.completed) if (course.id === id) return course;
  for (const term of plan.terms) for (const course of term.courses) if (course.id === id) return course;
  return null;
}

/**
 * Changes one row's CRN. Clearing it is refused while another row shares the
 * course number, and a CRN already used by that course is refused.
 */
export function commitCourseCRN(plan: DegreePlan, courseId: string, crn: string | null, title?: string | null): DegreePlan | string {
  const course = findCourse(plan, courseId);
  if (!course) return "That row is no longer in the plan.";
  const trimmed = crn?.trim() || null;
  if (course.key) {
    const others = courseEntries(plan, course.key).filter((place) => place.course.id !== courseId);
    if (!trimmed && others.length > 0) return "Each copy needs its own CRN.";
    if (trimmed && others.some((place) => place.course.crn === trimmed)) return `CRN ${trimmed} is already on another row.`;
  }
  const patch: Partial<Pick<DegreePlanCourse, "title" | "credits" | "crn">> = { crn: trimmed };
  if (trimmed && title?.trim()) patch.title = title.trim();
  return updatePlanCourse(plan, courseId, patch);
}

export interface SectionAssignment {
  id: string;
  crn: string;
  title?: string | null;
}

/**
 * Pins every unpinned copy of this course, then appends the new row.
 * Every chosen CRN has to be non-empty and different.
 */
export function applySectionPick(
  plan: DegreePlan,
  where: "completed" | number,
  draft: DegreePlanCourse,
  assignments: readonly SectionAssignment[],
  next: { crn: string; title?: string | null },
): DegreePlan | string {
  if (!draft.key) return "Enter a course such as CS 1800.";
  const matches = courseEntries(plan, draft.key);
  if (!matches.length) return "This course is not in the plan yet.";
  const unpinned = matches.filter((place) => !place.course.crn);
  const taken = new Set(matches.flatMap((place) => (place.course.crn ? [place.course.crn] : [])));
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const chosen = [...unpinned.map((place) => byId.get(place.course.id)?.crn.trim() ?? ""), next.crn.trim()];
  if (chosen.some((crn) => !crn) || new Set(chosen).size !== chosen.length || chosen.some((crn) => taken.has(crn))) {
    return "Each row needs a different section.";
  }
  let updated = plan;
  for (const place of unpinned) {
    const assignment = byId.get(place.course.id)!;
    updated = updatePlanCourse(updated, place.course.id, {
      crn: assignment.crn.trim(),
      ...(assignment.title?.trim() ? { title: assignment.title.trim() } : {}),
    });
  }
  const added = addPlanCourse(updated, where, {
    ...draft,
    crn: next.crn.trim(),
    title: next.title?.trim() || draft.title,
  });
  return added ?? "That semester is no longer in the plan.";
}
