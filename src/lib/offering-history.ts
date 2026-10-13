/**
 * Which recent terms a course had sections in.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Port of Services/OfferingHistoryRepository.swift. Past terms are cached forever.
 * The newest term is read again after a week. A term that could not be reached is
 * left out of `checkedTerms` rather than reported as "not offered".
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { OfferingHistory, monthIndexOfTermCode } from "@/lib/degree/reordering";
import type { CourseKey, Term } from "@/lib/models";
import { keyId, termApproximateWindow, termCollege } from "@/lib/models";

export interface OfferingFetcher {
  terms(): Promise<Term[]>;
  /** Courses among `courses` that have at least one section. Throws when the term cannot be read. */
  offeredCourses(term: string, courses: CourseKey[]): Promise<readonly CourseKey[]>;
}

/** A loaded catalog. A term that has one is answered without a network call. */
export interface OfferingIndex {
  term: Term;
  sectionsFor(key: CourseKey): readonly unknown[];
}

interface Entry {
  fetchedAt: number;
  offered: boolean;
}

interface Stored {
  version: number;
  terms: Record<string, Record<string, Entry>>;
}

const STORED_VERSION = 2;
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * The Northeastern terms within `months` of the newest one, newest first.
 * Comparison is Banner's term code, matching `Term`'s ordering.
 */
export function offeringWindow(terms: readonly Term[], months: number): Term[] {
  const sorted = [...terms].sort((a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0));
  const newest = sorted[0];
  if (!newest) return [];
  const oldest = monthIndexOfTermCode(newest.code) - months;
  return sorted.filter((term) => monthIndexOfTermCode(term.code) >= oldest);
}

/** The newest term expires after a week. An older term read before its classes began is read again. */
export function isOfferingEntryFresh(fetchedAtSeconds: number, term: string, isNewest: boolean, nowMs: number, lifetimeMs = WEEK_MS): boolean {
  if (isNewest) return nowMs - fetchedAtSeconds * 1000 < lifetimeMs;
  const window = termApproximateWindow(term);
  if (!window) return true;
  return fetchedAtSeconds * 1000 >= window.start;
}

export class OfferingHistoryRepository {
  static readonly batchSize = 10;

  private readonly fetcher: OfferingFetcher;
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly windowMonths: number;
  private readonly lifetimeMs: number;
  private readonly concurrency: number;
  private cache: Record<string, Record<string, Entry>> = {};
  private didLoad = false;
  private dirty = false;

  constructor(options: {
    fetcher: OfferingFetcher;
    filePath: string;
    now?: () => Date;
    windowMonths?: number;
    currentTermLifetimeMs?: number;
    concurrency?: number;
  }) {
    this.fetcher = options.fetcher;
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date());
    this.windowMonths = options.windowMonths ?? 24;
    this.lifetimeMs = options.currentTermLifetimeMs ?? WEEK_MS;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  async history(keys: readonly CourseKey[], indexes: readonly OfferingIndex[] = []): Promise<OfferingHistory> {
    await this.loadIfNeeded();
    const seen = new Set<string>();
    const unique = keys.filter((key) => {
      const id = keyId(key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!unique.length) return OfferingHistory.empty();

    let terms: Term[] = [];
    try {
      terms = (await this.fetcher.terms()).filter((term) => termCollege(term.code) === "neu");
    } catch {
      terms = [];
    }
    for (const index of indexes) {
      if (termCollege(index.term.code) !== "neu") continue;
      if (!terms.some((term) => term.code === index.term.code)) terms.push(index.term);
    }
    const window = offeringWindow(terms, this.windowMonths);
    const newest = window[0]?.code;
    if (!newest) {
      return new OfferingHistory({ checkedTerms: [], offered: [], checkedKeys: unique });
    }
    const indexByTerm = new Map(indexes.map((index) => [index.term.code, index]));
    const answers = new Map<string, Set<string> | null>();
    await mapPool(window, Math.min(this.concurrency, window.length), async (term) => {
      const offered = await this.offered(unique, term.code, term.code === newest, indexByTerm.get(term.code));
      answers.set(term.code, offered);
    });
    await this.saveIfNeeded();

    const checked = window.map((term) => term.code).filter((code) => answers.get(code) != null);
    const offered: { key: CourseKey; terms: string[] }[] = unique.map((key) => ({
      key,
      terms: checked.filter((code) => answers.get(code)?.has(keyId(key))),
    }));
    return new OfferingHistory({
      checkedTerms: checked,
      offered: offered.filter((entry) => entry.terms.length > 0),
      checkedKeys: unique,
    });
  }

  async clear(): Promise<void> {
    this.cache = {};
    this.didLoad = true;
    this.dirty = false;
    await rm(this.filePath, { force: true });
  }

  private async offered(keys: readonly CourseKey[], term: string, isNewest: boolean, index?: OfferingIndex): Promise<Set<string> | null> {
    if (index) {
      return new Set(keys.filter((key) => index.sectionsFor(key).length > 0).map((key) => keyId(key)));
    }
    const missing = keys.filter((key) => !this.isFresh(term, key, isNewest));
    for (let start = 0; start < missing.length; start += OfferingHistoryRepository.batchSize) {
      const batch = missing.slice(start, start + OfferingHistoryRepository.batchSize);
      try {
        const found = new Set((await this.fetcher.offeredCourses(term, batch)).map((key) => keyId(key)));
        const stamp = this.now().getTime() / 1000;
        const bucket = (this.cache[term] ??= {});
        for (const key of batch) bucket[keyId(key)] = { fetchedAt: stamp, offered: found.has(keyId(key)) };
        this.dirty = true;
      } catch {
        return null;
      }
    }
    const bucket = this.cache[term] ?? {};
    return new Set(keys.filter((key) => bucket[keyId(key)]?.offered).map((key) => keyId(key)));
  }

  private isFresh(term: string, key: CourseKey, isNewest: boolean): boolean {
    const entry = this.cache[term]?.[keyId(key)];
    if (!entry) return false;
    return isOfferingEntryFresh(entry.fetchedAt, term, isNewest, this.now().getTime(), this.lifetimeMs);
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.didLoad) return;
    this.didLoad = true;
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8")) as Stored;
      if (stored.version !== STORED_VERSION || !stored.terms) return;
      this.cache = stored.terms;
    } catch {
      /* a missing cache just means Banner is asked */
    }
  }

  private async saveIfNeeded(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const stored: Stored = { version: STORED_VERSION, terms: this.cache };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stored));
  }
}

async function mapPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
