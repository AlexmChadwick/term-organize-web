/**
 * Browser cache of Banner catalog entries for courses the open term does not list.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The lookup itself runs on the server (`/api/banner/course-info`). This module remembers
 * the answers and turns them into prerequisite lookups, NUpath attributes, and the
 * "counts as" questions the degree plan asks.
 */

"use client";

import { CourseEquivalences } from "@/lib/equivalences";
import {
  buildDegreeEquivalencePrompts,
  decodeDismissed,
  DISMISSED_EQUIVALENCE_KEY,
  dismissPair,
  planCourseKeys,
  type DegreeEquivalencePrompts,
  type EquivalenceSuggestion,
} from "@/lib/degree/suggestions";
import type { CourseKey, Requisite } from "@/lib/models";
import { keyId, offeringTermLabel } from "@/lib/models";
import type { DegreePlan } from "@/lib/requirements";
import { useEffect, useMemo, useState } from "react";

export interface CatalogEntry {
  key: CourseKey;
  title: string;
  minCredits: number | null;
  maxCredits: number | null;
  prerequisites: Requisite | null;
  corequisites: Requisite | null;
  equivalents: CourseKey[];
  sourceTerm: string;
  isRetired: boolean | null;
  fetchedAt: number;
}

export type CatalogCourseState = "unknown" | "loading" | "found" | "notFound" | "failed";

interface CourseAnswer {
  kind: "found" | "notFound" | "failed";
  info?: CatalogEntry;
}

interface AttributeAnswer {
  type: "found" | "notFound" | "failed";
  codes?: string[];
  term?: string;
}

export interface CourseFactsRequest {
  keys: readonly CourseKey[];
  attributes: boolean;
  suggest: boolean;
  plan?: DegreePlan | null;
  catalogTitles?: Readonly<Record<string, string>>;
  alsoComparing?: readonly CourseKey[];
}

interface Memory {
  courses: Map<string, CourseAnswer>;
  attributes: Map<string, AttributeAnswer>;
  suggestions: Map<string, EquivalenceSuggestion[]>;
  suggestionSignature: Map<string, string>;
  equivalenceGroups: CourseKey[][];
  at: Map<string, number>;
}

const memory: Memory = {
  courses: new Map(),
  attributes: new Map(),
  suggestions: new Map(),
  suggestionSignature: new Map(),
  equivalenceGroups: [],
  at: new Map(),
};

const listeners = new Set<() => void>();
let generation = 0;

function notify(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

function needsCourse(id: string, now: number): boolean {
  const answer = memory.courses.get(id);
  if (!answer) return true;
  const age = now - (memory.at.get(id) ?? 0);
  if (answer.kind === "failed") return age > 60_000;
  return age > 5 * 60_000;
}

export function factsSignature(request: CourseFactsRequest): string {
  const titles: Record<string, string> = {};
  if (request.plan) {
    for (const course of [...request.plan.completed, ...request.plan.terms.flatMap((term) => term.courses)]) {
      if (course.key && course.title.trim()) titles[keyId(course.key)] = course.title;
    }
  }
  return JSON.stringify({
    keys: request.keys.map((key) => keyId(key)).sort(),
    attributes: request.attributes,
    suggest: request.suggest,
    equiv: request.plan?.courseEquivalences ?? [],
    catalogTitles: request.catalogTitles ?? {},
    also: (request.alsoComparing ?? []).map((key) => keyId(key)).sort(),
    titles,
  });
}

const inflight = new Map<string, Promise<CourseFactsSnapshot>>();
const loadingIds = new Set<string>();

export interface CourseFactsSnapshot {
  tick: number;
  requisite(key: CourseKey): Requisite | null | undefined;
  state(key: CourseKey): CatalogCourseState;
  info(key: CourseKey): CatalogEntry | null;
  /** True only when an older catalog lists the course. Null when Banner has not said. */
  isRetired(key: CourseKey): boolean | null;
  retiredNote(key: CourseKey): string | null;
  attribute(key: CourseKey): AttributeAnswer | null;
  equivalences: CourseEquivalences;
  suggestions(key: CourseKey): readonly EquivalenceSuggestion[];
  dismissed: ReadonlySet<string>;
  dismiss(course: CourseKey, countsAs: CourseKey): void;
}

function dismissedSet(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  return decodeDismissed(localStorage.getItem(DISMISSED_EQUIVALENCE_KEY) ?? "");
}

export function snapshotCourseFacts(pending: ReadonlySet<string> = new Set()): CourseFactsSnapshot {
  const tick = generation;
  return {
    tick,
    requisite(key) {
      const answer = memory.courses.get(keyId(key));
      if (!answer || answer.kind !== "found" || !answer.info) return undefined;
      return answer.info.prerequisites;
    },
    state(key) {
      const id = keyId(key);
      const answer = memory.courses.get(id);
      if (answer?.kind === "found" && answer.info) return "found";
      if (answer?.kind === "notFound") return "notFound";
      if (answer?.kind === "failed") return "failed";
      if (pending.has(id) || loadingIds.has(id)) return "loading";
      return "unknown";
    },
    info(key) {
      const answer = memory.courses.get(keyId(key));
      return answer?.kind === "found" ? (answer.info ?? null) : null;
    },
    isRetired(key) {
      const answer = memory.courses.get(keyId(key));
      if (!answer || answer.kind !== "found" || !answer.info) return null;
      return answer.info.isRetired === true;
    },
    retiredNote(key) {
      const answer = memory.courses.get(keyId(key));
      if (!answer || answer.kind !== "found" || answer.info?.isRetired !== true) return null;
      return `No longer offered; last listed ${offeringTermLabel(answer.info.sourceTerm)}`;
    },
    attribute(key) {
      return memory.attributes.get(keyId(key)) ?? null;
    },
    equivalences: new CourseEquivalences(memory.equivalenceGroups),
    suggestions(key) {
      return memory.suggestions.get(keyId(key)) ?? [];
    },
    dismissed: dismissedSet(),
    dismiss(course, countsAs) {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(DISMISSED_EQUIVALENCE_KEY) ?? "";
      localStorage.setItem(DISMISSED_EQUIVALENCE_KEY, dismissPair(course, countsAs, raw));
      notify();
    },
  };
}

const emptyPending = new Set<string>();

/** Drops a failed answer so the next load asks Banner again. */
export function retryCourseFacts(request: CourseFactsRequest): Promise<CourseFactsSnapshot> {
  for (const key of request.keys) {
    const id = keyId(key);
    if (memory.courses.get(id)?.kind === "failed") {
      memory.courses.delete(id);
      memory.at.delete(id);
    }
  }
  return loadCourseFacts(request);
}

export function loadCourseFacts(request: CourseFactsRequest): Promise<CourseFactsSnapshot> {
  const signature = factsSignature(request);
  const running = inflight.get(signature);
  if (running) return running;
  const job = loadCourseFactsOnce(request, signature).finally(() => {
    inflight.delete(signature);
  });
  inflight.set(signature, job);
  return job;
}

async function loadCourseFactsOnce(request: CourseFactsRequest, signature: string): Promise<CourseFactsSnapshot> {
  const now = Date.now();
  const missing = request.keys.filter((key) => needsCourse(keyId(key), now));
  const suggestionsFresh = !request.suggest || request.keys.every((key) => memory.suggestionSignature.get(keyId(key)) === signature);
  const attributesFresh = !request.attributes || request.keys.every((key) => memory.attributes.has(keyId(key)));
  if (missing.length === 0 && suggestionsFresh && attributesFresh) return snapshotCourseFacts();

  for (const key of request.keys) loadingIds.add(keyId(key));
  notify();
  try {
    const res = await fetch("/api/banner/course-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: request.keys.map((key) => ({ subject: key.subject, number: key.number })),
        attributes: request.attributes,
        suggest: request.suggest,
        plan: request.plan ?? null,
        catalogTitles: request.catalogTitles ?? {},
        alsoComparing: (request.alsoComparing ?? []).map((key) => ({ subject: key.subject, number: key.number })),
      }),
    });
    if (!res.ok) throw new Error("Banner's course catalog did not answer.");
    const body = (await res.json()) as {
      courses?: { id: string; kind: CourseAnswer["kind"]; info?: CatalogEntry }[];
      attributes?: (AttributeAnswer & { id: string })[];
      equivalences?: CourseKey[][];
      suggestions?: { id: string; suggestions: EquivalenceSuggestion[] }[];
    };
    const stamp = Date.now();
    for (const course of body.courses ?? []) {
      memory.courses.set(course.id, { kind: course.kind, info: course.info });
      memory.at.set(course.id, stamp);
    }
    if (request.attributes) {
      for (const attribute of body.attributes ?? []) memory.attributes.set(attribute.id, attribute);
    }
    if (Array.isArray(body.equivalences)) memory.equivalenceGroups = body.equivalences;
    if (request.suggest) {
      const returned = new Map((body.suggestions ?? []).map((entry) => [entry.id, entry.suggestions]));
      for (const key of request.keys) {
        const id = keyId(key);
        memory.suggestions.set(id, returned.get(id) ?? []);
        memory.suggestionSignature.set(id, signature);
      }
    }
  } catch {
    const stamp = Date.now();
    for (const key of missing) {
      const id = keyId(key);
      if (!memory.courses.has(id)) memory.courses.set(id, { kind: "failed" });
      memory.at.set(id, stamp);
    }
  } finally {
    for (const key of request.keys) loadingIds.delete(keyId(key));
  }
  notify();
  return snapshotCourseFacts();
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** The degree plan's catalog facts. A null request reads whatever is already cached. */
export function useCourseFacts(request: CourseFactsRequest | null): CourseFactsSnapshot {
  const signature = request ? factsSignature(request) : "";
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((value) => value + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  useEffect(() => {
    if (!request || !signature) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      void loadCourseFacts(request).finally(() => {
        if (!cancel) setTick((value) => value + 1);
      });
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
    // The signature is the request. A new object with the same courses does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  // `tick` changes when the shared cache does. The snapshot reads that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => snapshotCourseFacts(emptyPending), [tick]);
}

export function promptsForPlan(options: {
  plan: DegreePlan;
  listed: readonly CourseKey[];
  suggestions: (key: CourseKey) => readonly EquivalenceSuggestion[];
  dismissed: ReadonlySet<string>;
}): DegreeEquivalencePrompts {
  const planKeys = planCourseKeys(options.plan);
  const eligible = new Set([...planKeys, ...options.listed].map((key) => keyId(key)));
  return buildDegreeEquivalencePrompts({
    planKeys,
    listed: options.listed,
    eligible,
    dismissed: options.dismissed,
    suggestions: options.suggestions,
  });
}
