/**
 * NUpath requirements and the matching of courses to areas.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreeNUpath.swift.
 */

import type { CourseKey } from "@/lib/models";
import { NU_PATHS, type NuPathInfo, keyId } from "@/lib/models";

/** NUpath attributes already looked up, keyed by course id (`CS 3000`). */
export interface DegreeCourseAttributes {
  /** Banner attribute codes (`NCND`) or short codes (`ND`). */
  nupaths: ReadonlyMap<string, ReadonlySet<string>>;
  /** Course ids still being looked up. */
  loading: ReadonlySet<string>;
}

export const EMPTY_ATTRIBUTES: DegreeCourseAttributes = { nupaths: new Map(), loading: new Set() };

export function attributesAreEmpty(attributes: DegreeCourseAttributes): boolean {
  return attributes.nupaths.size === 0 && attributes.loading.size === 0;
}

export function courseAttributes(
  table: Record<string, readonly string[]>,
  loading: readonly string[] = [],
): DegreeCourseAttributes {
  const nupaths = new Map<string, ReadonlySet<string>>();
  for (const [id, codes] of Object.entries(table)) nupaths.set(id, new Set(codes));
  return { nupaths, loading: new Set(loading) };
}

export function resolveNuPath(token: string): NuPathInfo | undefined {
  const lower = token.toLowerCase();
  return NU_PATHS.find((path) => path.code === token || path.short.toLowerCase() === lower);
}

export function nuPathSet(tokens: Iterable<string>): Set<NuPathInfo> {
  const paths = new Set<NuPathInfo>();
  for (const token of tokens) {
    const path = resolveNuPath(token);
    if (path) paths.add(path);
  }
  return paths;
}

export interface NUpathRequirement {
  path: NuPathInfo;
  count: number;
  /** One of the eight areas a course counts for at most two of. */
  isLimited: boolean;
}

const LIMITED = ["ND", "EI", "IC", "FQ", "SI", "AD", "DD", "ER"];
const UNLIMITED: { short: string; count: number }[] = [
  { short: "WF", count: 1 },
  { short: "WI", count: 2 },
  { short: "WD", count: 1 },
  { short: "EX", count: 1 },
  { short: "CE", count: 1 },
];

function requirement(short: string, count: number, isLimited: boolean): NUpathRequirement {
  const path = NU_PATHS.find((item) => item.short === short);
  if (!path) throw new Error(`Unknown NUpath ${short}`);
  return { path, count, isLimited };
}

/** Catalog order: eight areas, then writing, experience, and capstone. */
export const NUPATH_REQUIREMENTS: readonly NUpathRequirement[] = [
  ...LIMITED.map((short) => requirement(short, 1, true)),
  ...UNLIMITED.map((item) => requirement(item.short, item.count, false)),
];

/** How many of the limited areas one course can count for. */
export const AREAS_PER_COURSE = 2;

export function nupathTitle(requirement: NUpathRequirement): string {
  return `${requirement.path.name} (${requirement.path.short})`;
}

/** A sentence that says something is satisfied through co-op. */
export function isCoopNote(note: string): boolean {
  return /satisfied\s+(?:through|by|with)\s+(?:a\s+)?co-?op/i.test(note);
}

const COOP_NAMES: { short: string; names: string[] }[] = [
  { short: "EX", names: ["Integrating Knowledge and Skills Through Experience", "Integration Experience", "Integration of Experience"] },
  { short: "CE", names: ["Demonstrating Thought and Action in a Capstone", "Capstone Experience"] },
];

/** The requirement a co-op sentence names, by catalog name or code. */
export function satisfiedThroughCoop(note: string): NuPathInfo | null {
  if (!isCoopNote(note)) return null;
  const lower = note.toLowerCase();
  for (const entry of COOP_NAMES) {
    if (entry.names.some((name) => lower.includes(name.toLowerCase()))) {
      return NU_PATHS.find((path) => path.short === entry.short) ?? null;
    }
  }
  return NU_PATHS.find((path) => new RegExp(`\\b${path.short}\\b`).test(note)) ?? null;
}

export interface NUpathCourse {
  id: string;
  paths: ReadonlySet<NuPathInfo>;
  isCompleted: boolean;
}

/**
 * Which plan courses meet which NUpath requirements. Limited areas are matched with
 * augmenting paths, completed courses first, two areas a course at most.
 */
export class NUpathMatching {
  private assigned = new Map<string, string[]>();

  constructor(
    courses: readonly NUpathCourse[],
    requirements: readonly NUpathRequirement[] = NUPATH_REQUIREMENTS,
    coopCounts: ReadonlyMap<string, readonly NUpathCourse[]> = new Map(),
  ) {
    const limited = requirements.filter((item) => item.isLimited).map((item) => item.path);
    this.assigned = NUpathMatching.matchLimited(limited, courses);
    for (const requirement of requirements) {
      if (requirement.isLimited) continue;
      const candidates = [
        ...courses.filter((course) => course.paths.has(requirement.path)),
        ...(coopCounts.get(requirement.path.short) ?? []),
      ];
      const seen = new Set<string>();
      const ordered = [...candidates.filter((course) => course.isCompleted), ...candidates.filter((course) => !course.isCompleted)]
        .filter((course) => {
          if (seen.has(course.id)) return false;
          seen.add(course.id);
          return true;
        });
      this.assigned.set(requirement.path.short, ordered.slice(0, requirement.count).map((course) => course.id));
    }
  }

  coursesFor(path: NuPathInfo): string[] {
    return this.assigned.get(path.short) ?? [];
  }

  private static matchLimited(areas: readonly NuPathInfo[], courses: readonly NUpathCourse[]): Map<string, string[]> {
    const load: NuPathInfo[][] = courses.map(() => []);
    const owner = new Map<string, number>();

    const augment = (area: NuPathInfo, allowed: (index: number) => boolean, visited: Set<number>): boolean => {
      for (let index = 0; index < courses.length; index += 1) {
        const course = courses[index]!;
        if (!allowed(index) || !course.paths.has(area) || visited.has(index)) continue;
        visited.add(index);
        const taken = load[index]!;
        if (taken.length < AREAS_PER_COURSE) {
          taken.push(area);
          owner.set(area.short, index);
          return true;
        }
        for (const other of [...taken]) {
          if (!augment(other, allowed, visited)) continue;
          const next = load[index]!;
          const at = next.indexOf(other);
          if (at >= 0) next.splice(at, 1);
          next.push(area);
          owner.set(area.short, index);
          return true;
        }
      }
      return false;
    };

    const passes: ((index: number) => boolean)[] = [
      (index) => courses[index]!.isCompleted,
      () => true,
    ];
    for (const allowed of passes) {
      for (const area of areas) {
        if (owner.has(area.short)) continue;
        augment(area, allowed, new Set());
      }
    }
    const assigned = new Map<string, string[]>();
    for (const [short, index] of owner) assigned.set(short, [courses[index]!.id]);
    return assigned;
  }
}

export function attributeKey(key: CourseKey): string {
  return keyId(key);
}
