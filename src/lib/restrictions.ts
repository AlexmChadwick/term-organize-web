/**
 * Banner section restrictions, and the CPS-only note derived from them.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { plainText } from "@/lib/html";

export type RestrictionKind = "must" | "cannot";

export interface SectionRestriction {
  kind: RestrictionKind;
  /** The Banner heading, such as "Levels" or "Colleges". */
  category: string;
  values: string[];
}

export const CPS_ONLY_NOTE = "Restricted to CPS (College of Professional Studies) students";
export const CPS_SOME_NOTE = "Some sections are CPS only";

const HEADING = /^(Must|Cannot) be enrolled in one of the following\s+(.+?):$/i;

/** Restriction categories from a `getRestrictions` HTML page. */
export function parseRestrictions(html: string): SectionRestriction[] {
  const prepared = html.replace(/<\/(li|div|tr|p|h\d|dt|dd)>/gi, "\n");
  const lines = plainText(prepared)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const restrictions: SectionRestriction[] = [];
  let current: SectionRestriction | null = null;
  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      if (current) restrictions.push(current);
      current = {
        kind: match[1]!.toLowerCase() === "must" ? "must" : "cannot",
        category: match[2]!.trim(),
        values: [],
      };
      continue;
    }
    if (current) current.values.push(line);
  }
  if (current) restrictions.push(current);
  return restrictions;
}

function mustValues(restrictions: readonly SectionRestriction[], category: string): string[] | null {
  const found = restrictions.find((item) => item.kind === "must" && item.category.toLowerCase() === category.toLowerCase());
  return found ? found.values : null;
}

function onlyCpsLevels(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().toLowerCase().startsWith("cps -"));
}

function onlyProfessionalStudies(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().toLowerCase().startsWith("college of professional studies"));
}

/**
 * True when a loaded restriction list is CPS-only.
 * Null when the list has not been loaded. "Cannot be enrolled" lists do not count.
 */
export function sectionIsCpsOnly(restrictions: readonly SectionRestriction[] | null | undefined): boolean | null {
  if (restrictions == null) return null;
  const levels = mustValues(restrictions, "Levels");
  const colleges = mustValues(restrictions, "Colleges");
  if (levels && onlyCpsLevels(levels)) return true;
  if (colleges && onlyProfessionalStudies(colleges)) return true;
  return false;
}

export function sectionCpsNote(restrictions: readonly SectionRestriction[] | null | undefined): string | null {
  return sectionIsCpsOnly(restrictions) === true ? CPS_ONLY_NOTE : null;
}

/** Course caption from the sections whose restrictions have been loaded. Unknown sections add nothing. */
export function courseCpsNote(sections: readonly { restrictions?: readonly SectionRestriction[] | null }[]): string | null {
  const known = sections.filter((section) => section.restrictions != null);
  if (known.length === 0) return null;
  const flags = known.map((section) => sectionIsCpsOnly(section.restrictions) === true);
  if (flags.every(Boolean)) return CPS_ONLY_NOTE;
  if (flags.some(Boolean)) return CPS_SOME_NOTE;
  return null;
}
