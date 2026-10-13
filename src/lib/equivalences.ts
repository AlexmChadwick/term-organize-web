/**
 * Courses that count as one another (renumberings, cross-lists, student declarations).
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/Models/CourseEquivalences.swift. Groups are symmetric and transitive.
 */

import type { CatalogIndex } from "./catalog-index";
import type { CourseKey } from "./models";
import { compareCourseKeys, keyId, sameKey } from "./models";

function normalizeTitle(title: string): string {
  return title.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

class DisjointSets {
  private parent = new Map<string, string>();
  private keys = new Map<string, CourseKey>();

  add(key: CourseKey): void {
    const id = keyId(key);
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.keys.set(id, key);
    }
  }

  all(): CourseKey[] {
    return [...this.keys.values()];
  }

  find(key: CourseKey): string {
    this.add(key);
    let root = keyId(key);
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let node = keyId(key);
    while (this.parent.get(node) !== root) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a: CourseKey, b: CourseKey): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const ka = this.keys.get(rootA)!;
    const kb = this.keys.get(rootB)!;
    if (compareCourseKeys(ka, kb) < 0) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}

export class CourseEquivalences {
  readonly groups: CourseKey[][];
  private groupIndex = new Map<string, number>();

  constructor(groups: CourseKey[][] = []) {
    const sets = new DisjointSets();
    for (const group of groups) {
      const first = group[0];
      if (!first) continue;
      sets.add(first);
      for (const other of group.slice(1)) sets.union(first, other);
    }
    const buckets = new Map<string, CourseKey[]>();
    for (const key of sets.all()) {
      const root = sets.find(key);
      const list = buckets.get(root) ?? [];
      list.push(key);
      buckets.set(root, list);
    }
    const built = [...buckets.values()]
      .filter((g) => g.length > 1)
      .map((g) => [...g].sort(compareCourseKeys))
      .sort((a, b) => compareCourseKeys(a[0]!, b[0]!));
    this.groups = built;
    built.forEach((group, i) => {
      for (const key of group) this.groupIndex.set(keyId(key), i);
    });
  }

  static fromPairs(pairs: [CourseKey, CourseKey][]): CourseEquivalences {
    return new CourseEquivalences(pairs.map(([a, b]) => [a, b]));
  }

  /**
   * Same course listed under several subjects. Combined undergraduate and graduate sections
   * and special topics are cross-listed too, and are not interchangeable.
   * Port of `CourseEquivalences.init(crossListedIn:)`.
   */
  static crossListedIn(index: CatalogIndex): CourseEquivalences {
    const pairs: [CourseKey, CourseKey][] = [];
    const seen = new Set<string>();
    for (const section of index.catalog.sections) {
      if (!section.crossListCRNs.length) continue;
      const courseKey = { subject: section.subject, number: section.number };
      if (index.course(courseKey)?.specialTopics) continue;
      for (const crn of section.crossListCRNs) {
        const other = index.sectionByCRN(crn);
        if (!other) continue;
        const otherKey = { subject: other.subject, number: other.number };
        if (otherKey.number !== courseKey.number || otherKey.subject === courseKey.subject) continue;
        if (index.course(otherKey)?.specialTopics) continue;
        const title = normalizeTitle(index.course(courseKey)?.title || section.title);
        const otherTitle = normalizeTitle(index.course(otherKey)?.title || other.title);
        if (!title || title !== otherTitle) continue;
        const [first, second] = compareCourseKeys(courseKey, otherKey) <= 0 ? [courseKey, otherKey] : [otherKey, courseKey];
        const id = `${keyId(first)}|${keyId(second)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([first, second]);
      }
    }
    return CourseEquivalences.fromPairs(pairs);
  }

  static none(): CourseEquivalences {
    return new CourseEquivalences();
  }

  get isEmpty(): boolean {
    return this.groups.length === 0;
  }

  equivalentsOf(key: CourseKey): CourseKey[] {
    const i = this.groupIndex.get(keyId(key));
    if (i == null) return [];
    return this.groups[i]!.filter((k) => !sameKey(k, key));
  }

  groupOf(key: CourseKey): CourseKey[] {
    const i = this.groupIndex.get(keyId(key));
    return i == null ? [key] : this.groups[i]!;
  }

  areEquivalent(a: CourseKey, b: CourseKey): boolean {
    if (sameKey(a, b)) return true;
    const i = this.groupIndex.get(keyId(a));
    const j = this.groupIndex.get(keyId(b));
    return i != null && i === j;
  }

  /** Taken courses plus everything those courses count as. Returns key ids. */
  expanding(taken: Set<string>): Set<string> {
    if (this.isEmpty) return new Set(taken);
    const result = new Set(taken);
    const seen = new Set<number>();
    for (const id of taken) {
      const i = this.groupIndex.get(id);
      if (i == null || seen.has(i)) continue;
      seen.add(i);
      for (const key of this.groups[i]!) result.add(keyId(key));
    }
    return result;
  }

  satisfiers(required: CourseKey, taken: Set<string>): CourseKey[] {
    const result: CourseKey[] = [];
    if (taken.has(keyId(required))) result.push(required);
    const i = this.groupIndex.get(keyId(required));
    if (i != null) {
      for (const key of this.groups[i]!) {
        if (!sameKey(key, required) && taken.has(keyId(key))) result.push(key);
      }
    }
    return result;
  }

  satisfier(required: CourseKey, taken: Set<string>): CourseKey | null {
    if (taken.has(keyId(required))) return required;
    const i = this.groupIndex.get(keyId(required));
    if (i == null) return null;
    return this.groups[i]!.find((key) => taken.has(keyId(key))) ?? null;
  }

  merging(other: CourseEquivalences): CourseEquivalences {
    if (other.isEmpty) return this;
    if (this.isEmpty) return other;
    return new CourseEquivalences([...this.groups, ...other.groups]);
  }

  adding(a: CourseKey, b: CourseKey): CourseEquivalences {
    return this.merging(new CourseEquivalences([[a, b]]));
  }

  toJSON(): CourseKey[][] {
    return this.groups;
  }
}

export function equivalencesFromDeclarations(
  pairs: { course: CourseKey; countsAs: CourseKey }[],
): CourseEquivalences {
  return CourseEquivalences.fromPairs(pairs.map((p) => [p.course, p.countsAs]));
}
