/**
 * Catalog entries for courses the loaded term does not list, and the UI store over them.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/Models/CourseInfo.swift, Services/CourseInfoRepository.swift,
 * and the lookup, equivalence, and suggestion parts of Services/CourseInfoStore.swift.
 * NUpath attribute lookups stay with CourseAttributeRepository and are not included.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CatalogIndex } from "@/lib/catalog-index";
import { normalizeEquivalents } from "@/lib/degree-logic";
import { OfferingHistoryRepository } from "@/lib/offering-history";
import { equivalenceSuggestions, type EquivalenceSuggestion, type PrerequisiteListing } from "@/lib/degree/suggestions";
import { CourseEquivalences, equivalencesFromDeclarations } from "@/lib/equivalences";
import {
  compareCourseKeys,
  courseKeyOf,
  keyId,
  requisitesEqual,
  sameKey,
  termCollege,
  termSeason,
  type Course,
  type CourseKey,
  type Requisite,
  type Term,
} from "@/lib/models";
import type { DegreePlan } from "@/lib/requirements";

/** What one term's catalog says about a course, whether or not it has sections. */
export interface CourseInfo {
  key: CourseKey;
  title: string;
  minCredits: number | null;
  maxCredits: number | null;
  prerequisites: Requisite | null;
  corequisites: Requisite | null;
  /** Mutual exclusions. Sorted, and never the course itself. */
  equivalents: CourseKey[];
  sourceTerm: string;
  /** True when only an older catalog lists it. Null when that was not checked. */
  isRetired: boolean | null;
  /** Epoch milliseconds. */
  fetchedAt: number;
}

export interface CourseInfoFetcher {
  terms(): Promise<Term[]>;
  /** Null when that term's catalog does not list the course. */
  catalogEntry(key: CourseKey, term: string): Promise<CourseInfo | null>;
}

export type CourseInfoResult = { kind: "found"; info: CourseInfo } | { kind: "notFound" } | { kind: "failed" };

export type CourseInfoState = "unknown" | "loading" | "found" | "notFound" | "failed";

const STORED_VERSION = 1;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

interface StoredMissing {
  key: CourseKey;
  checkedAt: number;
}

interface StoredCourseInfo {
  version: number;
  found: CourseInfo[];
  missing: StoredMissing[];
}

/**
 * Terms whose catalogs are searched, newest first: the newest Northeastern term, then
 * earlier fall and spring terms, at most `maxBack` of them. Summers are skipped unless
 * the newest term itself is a summer.
 */
export function catalogTerms(terms: readonly Term[], maxBack: number): string[] {
  const neu = terms
    .filter((term) => termCollege(term.code) === "neu")
    .sort((a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0));
  const newest = neu[0];
  if (!newest) return [];
  const codes = [newest.code];
  for (const term of neu.slice(1)) {
    const season = termSeason(term.code);
    if (season !== "fall" && season !== "spring") continue;
    if (codes.length > maxBack) break;
    codes.push(term.code);
  }
  return codes;
}

function courseInfoFromCourse(course: Course, index: CatalogIndex, isNewest: boolean): CourseInfo | null {
  if (!course.detailsLoaded) return null;
  return {
    key: courseKeyOf(course),
    title: course.title,
    minCredits: course.minCredits,
    maxCredits: course.maxCredits,
    prerequisites: course.prereqs ?? null,
    corequisites: course.coreqs ?? null,
    equivalents: [],
    sourceTerm: index.catalog.term.code,
    isRetired: isNewest ? false : null,
    fetchedAt: index.catalog.generatedAt,
  };
}

/** The entry from the loaded catalogs, newest first. A stub without details is skipped. */
export function courseInfoFromLoaded(key: CourseKey, indexes: readonly CatalogIndex[]): CourseInfo | null {
  for (let position = 0; position < indexes.length; position += 1) {
    const index = indexes[position];
    if (!index) continue;
    const listed = index.course(key);
    if (!listed) continue;
    const info = courseInfoFromCourse(listed, index, position === 0);
    if (info) return info;
  }
  return null;
}

function uniqueKeys(keys: readonly CourseKey[]): CourseKey[] {
  const seen = new Set<string>();
  const result: CourseKey[] = [];
  for (const key of keys) {
    const id = keyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(key);
  }
  return result;
}

function sameCourseInfo(a: CourseInfo, b: CourseInfo): boolean {
  return (
    sameKey(a.key, b.key) &&
    a.title === b.title &&
    a.minCredits === b.minCredits &&
    a.maxCredits === b.maxCredits &&
    requisitesEqual(a.prerequisites, b.prerequisites) &&
    requisitesEqual(a.corequisites, b.corequisites) &&
    a.equivalents.length === b.equivalents.length &&
    a.equivalents.every((item, index) => sameKey(item, b.equivalents[index]!)) &&
    a.sourceTerm === b.sourceTerm &&
    a.isRetired === b.isRetired &&
    a.fetchedAt === b.fetchedAt
  );
}

function nilIfBlank(text: string | null | undefined): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Finds prerequisites, corequisites, and equivalents for a course key: loaded catalogs,
 * then the disk cache, then Banner's newest term and earlier fall and spring terms.
 * Found courses are cached for 180 days. Courses no catalog lists are remembered for a week.
 * Failures are not cached. An expired entry is still used when the network fails.
 */
export class CourseInfoRepository {
  static catalogTerms(terms: readonly Term[], maxBack: number): string[] {
    return catalogTerms(terms, maxBack);
  }

  private readonly fetcher: CourseInfoFetcher;
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly maxTermsBack: number;
  private readonly notFoundLifetimeMs: number;
  private readonly foundLifetimeMs: number;
  private readonly concurrency: number;
  private readonly found = new Map<string, CourseInfo>();
  private readonly missing = new Map<string, StoredMissing>();
  private didLoad = false;
  private dirty = false;
  private termCache: { codes: string[]; at: number } | null = null;

  constructor(options: {
    fetcher: CourseInfoFetcher;
    directory: string;
    now?: () => Date;
    maxTermsBack?: number;
    notFoundLifetimeMs?: number;
    foundLifetimeMs?: number;
    concurrency?: number;
  }) {
    this.fetcher = options.fetcher;
    this.filePath = path.join(options.directory, "course-info.json");
    this.now = options.now ?? (() => new Date());
    this.maxTermsBack = options.maxTermsBack ?? 8;
    this.notFoundLifetimeMs = options.notFoundLifetimeMs ?? 7 * DAY_MS;
    this.foundLifetimeMs = options.foundLifetimeMs ?? 180 * DAY_MS;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  /** Memory and disk, without the network. Null when nothing is cached or it has expired. */
  cachedLookup(key: CourseKey): CourseInfoResult | null {
    this.loadIfNeeded();
    const info = this.found.get(keyId(key));
    if (info && this.isFresh(info)) return { kind: "found", info };
    const missing = this.missing.get(keyId(key));
    if (missing && this.now().getTime() - missing.checkedAt < this.notFoundLifetimeMs) return { kind: "notFound" };
    return null;
  }

  async lookupOne(key: CourseKey, indexes: readonly CatalogIndex[] = []): Promise<CourseInfoResult> {
    const results = await this.lookup([key], indexes);
    return results.get(keyId(key)) ?? { kind: "failed" };
  }

  /**
   * Looks up several courses. `indexes` are the loaded catalogs, newest first.
   * `onResult` runs as each course is answered.
   */
  async lookup(
    keys: readonly CourseKey[],
    indexes: readonly CatalogIndex[] = [],
    onResult?: (key: CourseKey, result: CourseInfoResult) => Promise<void> | void,
  ): Promise<Map<string, CourseInfoResult>> {
    this.loadIfNeeded();
    const results = new Map<string, CourseInfoResult>();
    const pending: CourseKey[] = [];
    for (const key of uniqueKeys(keys)) {
      const loaded = courseInfoFromLoaded(key, indexes);
      const known = loaded ? ({ kind: "found", info: loaded } satisfies CourseInfoResult) : this.cachedLookup(key);
      if (known) {
        results.set(keyId(key), known);
        await onResult?.(key, known);
      } else {
        pending.push(key);
      }
    }
    if (pending.length === 0) return results;

    let terms: string[];
    try {
      terms = await this.catalogTermCodes();
    } catch {
      for (const key of pending) {
        const answer = this.staleOrFailed(key);
        results.set(keyId(key), answer);
        await onResult?.(key, answer);
      }
      return results;
    }

    await this.mapLimited(pending, async (key) => {
      const resolved = await this.resolve(key, terms);
      const answer = resolved.kind === "failed" ? this.staleOrFailed(key) : resolved;
      results.set(keyId(key), answer);
      await onResult?.(key, answer);
    });
    this.saveIfNeeded();
    return results;
  }

  /** Forgets everything cached, in memory and on disk. */
  clear(): void {
    this.found.clear();
    this.missing.clear();
    this.termCache = null;
    this.didLoad = true;
    this.dirty = false;
    rmSync(this.filePath, { force: true });
  }

  private async catalogTermCodes(): Promise<string[]> {
    const cached = this.termCache;
    if (cached && this.now().getTime() - cached.at < HOUR_MS) return cached.codes;
    const codes = CourseInfoRepository.catalogTerms(await this.fetcher.terms(), this.maxTermsBack);
    if (codes.length === 0) throw new Error("No catalog terms");
    this.termCache = { codes, at: this.now().getTime() };
    return codes;
  }

  private async resolve(key: CourseKey, terms: readonly string[]): Promise<CourseInfoResult> {
    const result = await this.search(key, terms);
    const id = keyId(key);
    if (result.kind === "found") {
      this.found.set(id, result.info);
      this.missing.delete(id);
      this.dirty = true;
    } else if (result.kind === "notFound") {
      this.missing.set(id, { key, checkedAt: this.now().getTime() });
      this.dirty = true;
    }
    return result;
  }

  /** Asks each term, newest first. A course only an older catalog lists has been retired. */
  private async search(key: CourseKey, terms: readonly string[]): Promise<CourseInfoResult> {
    for (let position = 0; position < terms.length; position += 1) {
      const term = terms[position]!;
      try {
        const info = await this.fetcher.catalogEntry(key, term);
        if (!info) continue;
        return {
          kind: "found",
          info: {
            ...info,
            equivalents: normalizeEquivalents(info.key, info.equivalents),
            isRetired: position > 0,
          },
        };
      } catch {
        return { kind: "failed" };
      }
    }
    return { kind: "notFound" };
  }

  /** An expired cache entry beats nothing when the network fails. */
  private staleOrFailed(key: CourseKey): CourseInfoResult {
    const info = this.found.get(keyId(key));
    return info ? { kind: "found", info } : { kind: "failed" };
  }

  private isFresh(info: CourseInfo): boolean {
    return this.now().getTime() - info.fetchedAt < this.foundLifetimeMs;
  }

  private async mapLimited(items: readonly CourseKey[], run: (key: CourseKey) => Promise<void>): Promise<void> {
    const limit = Math.min(this.concurrency, items.length);
    let cursor = 0;
    const workers = Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const key = items[index];
        if (key) await run(key);
      }
    });
    await Promise.all(workers);
  }

  private loadIfNeeded(): void {
    if (this.didLoad) return;
    this.didLoad = true;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let stored: StoredCourseInfo;
    try {
      stored = JSON.parse(raw) as StoredCourseInfo;
    } catch {
      return;
    }
    if (stored.version !== STORED_VERSION || !Array.isArray(stored.found) || !Array.isArray(stored.missing)) return;
    for (const info of stored.found) {
      if (!info?.key?.subject || !info.key.number) continue;
      this.found.set(keyId(info.key), info);
    }
    for (const entry of stored.missing) {
      if (!entry?.key?.subject || !entry.key.number || typeof entry.checkedAt !== "number") continue;
      this.missing.set(keyId(entry.key), entry);
    }
  }

  private saveIfNeeded(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const current = this.now().getTime();
    const stored: StoredCourseInfo = {
      version: STORED_VERSION,
      found: [...this.found.values()].filter((info) => this.isFresh(info)).sort((a, b) => compareCourseKeys(a.key, b.key)),
      missing: [...this.missing.values()]
        .filter((entry) => current - entry.checkedAt < this.notFoundLifetimeMs)
        .sort((a, b) => compareCourseKeys(a.key, b.key)),
    };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored));
    renameSync(temporary, this.filePath);
  }
}

/**
 * Remembers catalog information for courses outside the loaded term, and the equivalences
 * Banner and cross-listed sections imply. `version` changes only when an answer does.
 */
export class CourseInfoStore {
  version = 0;

  private readonly infos = new Map<string, CourseInfo>();
  private readonly notFound = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private readonly loading = new Set<string>();
  private derived = CourseEquivalences.none();
  private indexes: CatalogIndex[] = [];
  private indexStamp = "[]";
  private prerequisiteCache: { term: string; stamp: number; list: PrerequisiteListing[] } | null = null;
  private readonly crossListed = new Map<string, { stamp: number; equivalences: CourseEquivalences }>();
  private readonly retryDelayMs: number;

  constructor(
    private readonly repository: CourseInfoRepository,
    private readonly offeringRepository: OfferingHistoryRepository,
    retryDelayMs = 60_000,
  ) {
    this.retryDelayMs = retryDelayMs;
  }

  info(key: CourseKey): CourseInfo | null {
    return this.infos.get(keyId(key)) ?? null;
  }

  /** `unknown`, `loading`, `found`, `notFound`, or `failed`. */
  state(key: CourseKey): "unknown" | "loading" | "found" | "notFound" | "failed" {
    const id = keyId(key);
    if (this.infos.has(id)) return "found";
    if (this.loading.has(id)) return "loading";
    if (this.notFound.has(id)) return "notFound";
    if (this.failedAt.has(id)) return "failed";
    return "unknown";
  }

  /**
   * Prerequisites by course. Undefined when the course is not known, null when it has none.
   * A snapshot, so later loads do not change a lookup already handed out.
   */
  requisiteLookup(): (key: CourseKey) => Requisite | null | undefined {
    const table = new Map<string, Requisite | null>();
    for (const [id, info] of this.infos) table.set(id, info.prerequisites);
    return (key) => {
      const id = keyId(key);
      if (!table.has(id)) return undefined;
      return table.get(id) ?? null;
    };
  }

  /** Banner and cross-listed equivalences, plus the ones `plan` declares. */
  equivalences(plan: DegreePlan | null): CourseEquivalences {
    if (!plan) return this.derived;
    return this.derived.merging(equivalencesFromDeclarations(plan.courseEquivalences));
  }

  /**
   * Catalog information for courses: loaded catalogs, the disk cache, then Banner.
   * Courses already known are skipped. A failed lookup is not retried for a minute.
   */
  async load(keys: readonly CourseKey[], indexes: readonly CatalogIndex[]): Promise<void> {
    this.indexes = [...indexes];
    const wanted = uniqueKeys(keys);
    let changed = false;
    for (const key of wanted) {
      const loaded = courseInfoFromLoaded(key, this.indexes);
      if (!loaded) continue;
      const id = keyId(key);
      const previous = this.infos.get(id);
      let info = loaded;
      if (previous) {
        if (info.sourceTerm < previous.sourceTerm) continue;
        info = { ...info, equivalents: previous.equivalents.map((item) => ({ ...item })) };
        if (sameCourseInfo(info, previous)) continue;
      }
      this.infos.set(id, info);
      this.notFound.delete(id);
      changed = true;
    }
    const stamp = this.stampOf(this.indexes);
    const indexesChanged = stamp !== this.indexStamp;
    this.indexStamp = stamp;
    if ((changed || indexesChanged) && this.rebuildEquivalences()) changed = true;
    if (changed) this.version += 1;

    const now = Date.now();
    const pending = wanted.filter((key) => {
      const id = keyId(key);
      if (this.infos.has(id) || this.notFound.has(id) || this.loading.has(id)) return false;
      const failed = this.failedAt.get(id);
      return failed == null || now - failed > this.retryDelayMs;
    });
    if (pending.length === 0) return;
    for (const key of pending) this.loading.add(keyId(key));
    this.version += 1;

    const results = await this.repository.lookup(pending, this.indexes, (key, result) => {
      this.receive(key, result);
    });
    for (const key of pending) {
      if (this.loading.has(keyId(key))) this.receive(key, results.get(keyId(key)) ?? { kind: "failed" });
    }
  }

  /**
   * Courses a retired course may count as. Empty when the newest catalog lists it, when Banner
   * still lists it, or when `load` has not finished with it.
   */
  equivalenceSuggestions(
    key: CourseKey,
    plan: DegreePlan | null = null,
    catalogTitles: Readonly<Record<string, string>> = {},
    alsoComparing: readonly CourseKey[] = [],
    limit = 3,
  ): EquivalenceSuggestion[] {
    const newest = this.indexes[0];
    if (!newest || newest.course(key)) return [];
    const status = this.state(key);
    if (status === "found" && this.infos.get(keyId(key))?.isRetired === false) return [];
    if (status !== "found" && status !== "notFound") return [];
    const planKeys = plan
      ? [
          ...plan.completed.flatMap((course) => (course.key ? [course.key] : [])),
          ...plan.terms.flatMap((term) => term.courses.flatMap((course) => (course.key ? [course.key] : []))),
        ]
      : [];
    return equivalenceSuggestions({
      retired: key,
      prerequisites: this.prerequisiteList(newest),
      isCurrent: (candidate) => newest.course(candidate) != null,
      known: this.equivalences(plan),
      limit,
      title: (candidate) => this.titleOf(candidate, catalogTitles, plan),
      titleCandidates: [...planKeys, ...alsoComparing],
    });
  }

  /** Recent terms in which the courses had sections. Loaded catalogs answer with no request. */
  offeringHistory(keys: readonly CourseKey[], indexes?: readonly CatalogIndex[]) {
    const source = indexes ?? this.indexes;
    return this.offeringRepository.history(
      keys,
      source.map((index) => ({
        term: index.catalog.term,
        sectionsFor: (course: CourseKey) => index.sectionsOf(course),
      })),
    );
  }

  private receive(key: CourseKey, result: CourseInfoResult): void {
    const id = keyId(key);
    this.loading.delete(id);
    if (result.kind === "found") {
      this.infos.set(id, result.info);
      this.notFound.delete(id);
      this.failedAt.delete(id);
      this.rebuildEquivalences();
    } else if (result.kind === "notFound") {
      this.notFound.add(id);
      this.failedAt.delete(id);
    } else {
      this.failedAt.set(id, Date.now());
    }
    this.version += 1;
  }

  private titleOf(key: CourseKey, catalogTitles: Readonly<Record<string, string>>, plan: DegreePlan | null): string | null {
    const fromCatalog = nilIfBlank(catalogTitles[keyId(key)]);
    if (fromCatalog) return fromCatalog;
    const fromInfo = nilIfBlank(this.infos.get(keyId(key))?.title);
    if (fromInfo) return fromInfo;
    for (const index of this.indexes) {
      const fromIndex = nilIfBlank(index.course(key)?.title);
      if (fromIndex) return fromIndex;
    }
    if (!plan) return null;
    for (const course of [...plan.completed, ...plan.terms.flatMap((term) => term.courses)]) {
      if (!course.key || !sameKey(course.key, key)) continue;
      const fromPlan = nilIfBlank(course.title);
      if (fromPlan) return fromPlan;
    }
    return null;
  }

  private prerequisiteList(index: CatalogIndex): PrerequisiteListing[] {
    const stamp = index.catalog.sectionsUpdatedAt;
    const term = index.catalog.term.code;
    if (this.prerequisiteCache && this.prerequisiteCache.term === term && this.prerequisiteCache.stamp === stamp) {
      return this.prerequisiteCache.list;
    }
    const list: PrerequisiteListing[] = [];
    for (const course of index.courses) {
      if (!course.prereqs) continue;
      list.push({ course: courseKeyOf(course), requisite: course.prereqs });
    }
    this.prerequisiteCache = { term, stamp, list };
    return list;
  }

  /** Recomputes `derived`. True when it changed. */
  private rebuildEquivalences(): boolean {
    const groups: CourseKey[][] = [];
    for (const info of this.infos.values()) {
      if (info.equivalents.length > 0) groups.push([info.key, ...info.equivalents]);
    }
    let result = new CourseEquivalences(groups);
    for (const index of this.indexes) result = result.merging(this.crossListEquivalences(index));
    if (JSON.stringify(result.groups) === JSON.stringify(this.derived.groups)) return false;
    this.derived = result;
    return true;
  }

  private crossListEquivalences(index: CatalogIndex): CourseEquivalences {
    const stamp = index.catalog.sectionsUpdatedAt;
    const code = index.catalog.term.code;
    const cached = this.crossListed.get(code);
    if (cached && cached.stamp === stamp) return cached.equivalences;
    const built = CourseEquivalences.crossListedIn(index);
    this.crossListed.set(code, { stamp, equivalences: built });
    return built;
  }

  private stampOf(indexes: readonly CatalogIndex[]): string {
    const unique: [string, number][] = [];
    const seen = new Set<string>();
    for (const index of indexes) {
      const code = index.catalog.term.code;
      if (seen.has(code)) continue;
      seen.add(code);
      unique.push([code, index.catalog.sectionsUpdatedAt]);
    }
    unique.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify(unique);
  }
}
