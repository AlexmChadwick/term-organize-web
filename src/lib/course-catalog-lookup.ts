/**
 * Server lookup of Banner catalog entries and section attributes.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The browser cannot import CourseInfoRepository (it reads the disk). This is what
 * `/api/banner/course-info` runs: loaded catalogs, then the disk cache, then Banner.
 */

import path from "node:path";
import { fetchCatalogEntry, fetchSectionAttributes, fetchTerms, offeringRepository } from "@/lib/banner-server";
import { CatalogIndex } from "@/lib/catalog-index";
import { listStoredTermCodes, loadBestCatalog } from "@/lib/catalog-store";
import { CourseAttributeRepository } from "@/lib/degree/attributes";
import type { EquivalenceSuggestion } from "@/lib/degree/suggestions";
import { CourseInfoRepository, CourseInfoStore, type CourseInfo } from "@/lib/course-info";
import type { CourseKey } from "@/lib/models";
import { keyId } from "@/lib/models";
import type { DegreePlan } from "@/lib/requirements";

const directory = path.join(process.cwd(), "data", "built");

const infoRepository = new CourseInfoRepository({
  fetcher: {
    terms: () => fetchTerms(80),
    catalogEntry: (key, term) => fetchCatalogEntry(key, term),
  },
  directory,
});

const infoStore = new CourseInfoStore(infoRepository, offeringRepository);

const attributeRepository = new CourseAttributeRepository({
  fetcher: {
    terms: () => fetchTerms(80),
    sectionAttributes: (term, courses) => fetchSectionAttributes(term, courses),
  },
  directory,
});

const indexCache = new Map<string, { stamp: string; index: CatalogIndex }>();

async function storedIndexes(): Promise<CatalogIndex[]> {
  const indexes: CatalogIndex[] = [];
  for (const code of await listStoredTermCodes()) {
    const catalog = await loadBestCatalog(code);
    if (!catalog) continue;
    const stamp = `${catalog.sectionsUpdatedAt}:${catalog.courses.length}:${catalog.sections.length}`;
    const hit = indexCache.get(code);
    const index = hit?.stamp === stamp ? hit.index : CatalogIndex.build(catalog);
    indexCache.set(code, { stamp, index });
    indexes.push(index);
  }
  indexes.sort((a, b) => (a.catalog.term.code < b.catalog.term.code ? 1 : a.catalog.term.code > b.catalog.term.code ? -1 : 0));
  return indexes;
}

export interface CatalogCourseAnswer {
  id: string;
  kind: "found" | "notFound" | "failed";
  info?: CourseInfo;
}

export interface CatalogAttributeAnswer {
  id: string;
  type: "found" | "notFound" | "failed";
  codes?: string[];
  term?: string;
}

export interface CourseCatalogLookup {
  courses: CatalogCourseAnswer[];
  attributes: CatalogAttributeAnswer[];
  equivalences: CourseKey[][];
  suggestions: { id: string; suggestions: EquivalenceSuggestion[] }[];
}

let tail: Promise<void> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Catalog entries, attributes, Banner equivalences, and retired-course suggestions.
 * `indexes` are every stored term, newest first, which is what the app's course store reads.
 */
export function lookupCourseCatalog(input: {
  keys: readonly CourseKey[];
  withAttributes: boolean;
  suggest: boolean;
  plan: DegreePlan | null;
  catalogTitles: Readonly<Record<string, string>>;
  alsoComparing: readonly CourseKey[];
}): Promise<CourseCatalogLookup> {
  return enqueue(() => lookupCourseCatalogOnce(input));
}

async function lookupCourseCatalogOnce(input: {
  keys: readonly CourseKey[];
  withAttributes: boolean;
  suggest: boolean;
  plan: DegreePlan | null;
  catalogTitles: Readonly<Record<string, string>>;
  alsoComparing: readonly CourseKey[];
}): Promise<CourseCatalogLookup> {
  const indexes = await storedIndexes();
  await infoStore.load(input.keys, indexes);
  const courses: CatalogCourseAnswer[] = input.keys.map((key) => {
    const id = keyId(key);
    const state = infoStore.state(key);
    if (state === "found") {
      const info = infoStore.info(key);
      return info ? { id, kind: "found", info } : { id, kind: "failed" };
    }
    if (state === "notFound") return { id, kind: "notFound" };
    return { id, kind: "failed" };
  });

  const attributes: CatalogAttributeAnswer[] = [];
  if (input.withAttributes && input.keys.length > 0) {
    const derived = infoStore.equivalences(input.plan);
    const seen = new Set<string>();
    const wanted: CourseKey[] = [];
    for (const key of input.keys) {
      for (const other of derived.groupOf(key)) {
        const id = keyId(other);
        if (seen.has(id)) continue;
        seen.add(id);
        wanted.push(other);
      }
      const id = keyId(key);
      if (!seen.has(id)) {
        seen.add(id);
        wanted.push(key);
      }
    }
    const found = await attributeRepository.lookup(wanted, indexes);
    for (const [id, lookup] of found) {
      if (lookup.type === "found") attributes.push({ id, type: "found", codes: [...lookup.codes].sort(), term: lookup.term });
      else attributes.push({ id, type: lookup.type });
    }
  }

  const suggestions: { id: string; suggestions: EquivalenceSuggestion[] }[] = [];
  if (input.suggest) {
    for (const key of input.keys) {
      const list = infoStore.equivalenceSuggestions(key, input.plan, input.catalogTitles, input.alsoComparing);
      if (list.length > 0) suggestions.push({ id: keyId(key), suggestions: list });
    }
  }

  return {
    courses,
    attributes,
    equivalences: infoStore.equivalences(null).groups,
    suggestions,
  };
}
