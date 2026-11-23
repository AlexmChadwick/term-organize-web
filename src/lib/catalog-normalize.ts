/**
 * Filters instructor emails on a term catalog.
 *
 * Pure module: no IndexedDB and no Node filesystem APIs, so the browser cache
 * and the server catalog store can share it.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { publishedInstructorEmail } from "./instructor-email";
import { normalizeWaitlist, type Instructor, type TermCatalog } from "./models";

/** Filters instructor emails while preserving omitted and null fields. */
export function normalizeBundledCatalog(catalog: TermCatalog): TermCatalog {
  return normalizeWaitlist({
    ...catalog,
    sections: catalog.sections.map((section) => section.instructors
      ? { ...section, instructors: section.instructors.map(normalizeInstructor) }
      : section),
  });
}

function normalizeInstructor(instructor: Instructor): Instructor {
  const { email, ...fields } = instructor;
  if (typeof email !== "string") return instructor;
  const published = publishedInstructorEmail(email);
  return published === undefined ? fields : { ...fields, email: published };
}
