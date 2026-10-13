/**
 * Course attributes (NUpath and others) from loaded catalogs, a disk cache, and section searches.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/CourseAttributeRepository.swift.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogIndex } from "@/lib/catalog-index";
import type { CourseKey, Term } from "@/lib/models";
import { keyId, termCollege } from "@/lib/models";
import { monthIndexOfTermCode } from "@/lib/degree/reordering";

/** Banner attribute codes of a course, or why they could not be had. */
export type AttributeLookup =
  | { type: "found"; codes: Set<string>; term: string }
  | { type: "notFound" }
  | { type: "failed" };

/**
 * Where course attributes are read from. Tests answer without the network.
 * `sectionAttributes` returns attribute codes for courses that have sections in the term.
 */
export interface AttributeFetching {
  terms(): Promise<Term[]>;
  sectionAttributes(term: string, courses: CourseKey[]): Promise<Map<string, Set<string>>>;
}

interface Entry {
  codes: string[] | null;
  term: string | null;
  checkedAt: number;
}

interface Stored {
  version: number;
  entries: Record<string, Entry>;
}

const STORED_VERSION = 1;
const BATCH_SIZE = 10;
const FOUND_LIFETIME = 30 * 24 * 3600;
const NOT_FOUND_LIFETIME = 7 * 24 * 3600;
const WINDOW_MONTHS = 36;

/** Northeastern terms within `months` of the newest one, newest first. */
function termWindow(terms: readonly Term[], months: number): Term[] {
  const sorted = [...terms].sort((a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0));
  const newest = sorted[0];
  if (!newest) return [];
  const oldest = monthIndexOfTermCode(newest.code) - months;
  return sorted.filter((term) => monthIndexOfTermCode(term.code) >= oldest);
}

/**
 * Finds the attributes of courses by their key: loaded catalogs, then the disk cache,
 * then section searches of the last three years' terms, newest first, stopping at the
 * first term that has sections. Failures are not cached.
 */
export class CourseAttributeRepository {
  private readonly fetcher: AttributeFetching;
  private readonly fileURL: string;
  private readonly now: () => number;
  private readonly windowMonths: number;
  private readonly foundLifetime: number;
  private readonly notFoundLifetime: number;
  private entries: Record<string, Entry> = {};
  private didLoad = false;
  private isDirty = false;

  constructor(options: {
    fetcher: AttributeFetching;
    directory: string;
    now?: () => number;
    windowMonths?: number;
    foundLifetime?: number;
    notFoundLifetime?: number;
  }) {
    this.fetcher = options.fetcher;
    this.fileURL = path.join(options.directory, "course-attributes.json");
    this.now = options.now ?? (() => Date.now() / 1000);
    this.windowMonths = options.windowMonths ?? WINDOW_MONTHS;
    this.foundLifetime = options.foundLifetime ?? FOUND_LIFETIME;
    this.notFoundLifetime = options.notFoundLifetime ?? NOT_FOUND_LIFETIME;
  }

  /**
   * Attributes of `keys`. `indexes` are loaded catalogs, newest first; a course they have
   * sections of is answered from them.
   */
  async lookup(keys: readonly CourseKey[], indexes: readonly CatalogIndex[] = []): Promise<Map<string, AttributeLookup>> {
    await this.loadIfNeeded();
    const seen = new Set<string>();
    let remaining = keys.filter((course) => {
      const id = keyId(course);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const results = new Map<string, AttributeLookup>();
    remaining = remaining.filter((course) => {
      const found = CourseAttributeRepository.fromLoaded(course, indexes);
      if (found) {
        results.set(keyId(course), found);
        return false;
      }
      const cached = this.cached(course);
      if (cached) {
        results.set(keyId(course), cached);
        return false;
      }
      return true;
    });
    if (remaining.length === 0) return results;

    let terms: Term[] = [];
    try {
      terms = (await this.fetcher.terms()).filter((term) => termCollege(term.code) === "neu");
    } catch {
      terms = [];
    }
    for (const index of indexes) {
      const term = index.catalog.term;
      if (termCollege(term.code) === "neu" && !terms.some((item) => item.code === term.code)) terms.push(term);
    }
    const window = termWindow(terms, this.windowMonths);
    if (window.length === 0) {
      for (const course of remaining) results.set(keyId(course), { type: "failed" });
      return results;
    }
    const loaded = new Set(indexes.map((index) => index.catalog.term.code));
    for (const term of window) {
      if (loaded.has(term.code)) continue;
      let start = 0;
      while (start < remaining.length) {
        const batch = remaining.slice(start, Math.min(start + BATCH_SIZE, remaining.length));
        start += BATCH_SIZE;
        try {
          const found = await this.fetcher.sectionAttributes(term.code, batch);
          for (const [id, codes] of found) {
            results.set(id, { type: "found", codes: new Set(codes), term: term.code });
            this.store(id, { codes: [...codes].sort(), term: term.code, checkedAt: this.now() });
          }
        } catch {
          for (const course of remaining) {
            const id = keyId(course);
            if (!results.has(id)) results.set(id, { type: "failed" });
          }
          await this.saveIfNeeded();
          return results;
        }
      }
      remaining = remaining.filter((course) => !results.has(keyId(course)));
      if (remaining.length === 0) break;
    }
    for (const course of remaining) {
      const id = keyId(course);
      if (results.has(id)) continue;
      results.set(id, { type: "notFound" });
      this.store(id, { codes: null, term: null, checkedAt: this.now() });
    }
    await this.saveIfNeeded();
    return results;
  }

  /** Forgets the cache, in memory and on disk. */
  async clear(): Promise<void> {
    this.entries = {};
    this.didLoad = true;
    this.isDirty = false;
    await rm(this.fileURL, { force: true });
  }

  /** The course's attributes in the newest loaded term with sections of it. */
  static fromLoaded(course: CourseKey, indexes: readonly CatalogIndex[]): AttributeLookup | null {
    for (const index of indexes) {
      if (index.sectionsOf(course).length === 0) continue;
      return { type: "found", codes: new Set(index.course(course)?.attributes ?? []), term: index.catalog.term.code };
    }
    return null;
  }

  private cached(course: CourseKey): AttributeLookup | null {
    const entry = this.entries[keyId(course)];
    if (!entry) return null;
    const age = this.now() - entry.checkedAt;
    if (entry.codes && entry.term) {
      return age < this.foundLifetime ? { type: "found", codes: new Set(entry.codes), term: entry.term } : null;
    }
    return age < this.notFoundLifetime ? { type: "notFound" } : null;
  }

  private store(id: string, entry: Entry): void {
    this.entries[id] = entry;
    this.isDirty = true;
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.didLoad) return;
    this.didLoad = true;
    let data: string;
    try {
      data = await readFile(this.fileURL, "utf8");
    } catch {
      return;
    }
    let stored: Stored;
    try {
      stored = JSON.parse(data) as Stored;
    } catch {
      return;
    }
    if (stored.version !== STORED_VERSION || !stored.entries) return;
    this.entries = stored.entries;
  }

  private async saveIfNeeded(): Promise<void> {
    if (!this.isDirty) return;
    this.isDirty = false;
    const payload = JSON.stringify({ version: STORED_VERSION, entries: this.entries });
    await mkdir(path.dirname(this.fileURL), { recursive: true });
    const temporary = `${this.fileURL}.${process.pid}.tmp`;
    await writeFile(temporary, payload);
    await rename(temporary, this.fileURL);
  }
}
