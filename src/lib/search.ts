/**
 * On-device course search: codes, titles, shorthand, typos, instructors.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/SearchEngine.swift. Independent of SearchNEU's MiniSearch
 * client, with the same ideas: code boosts, prefixes, typo tolerance, every token
 * must match.
 */

import type { CatalogIndex } from "./catalog-index";
import type { Course, CourseKey, CourseSection, SearchFilters, SearchSort, Subject } from "./models";
import {
  compareCourseKeys,
  courseMatchesFilters,
  hasSectionFilters,
  keyId,
  numericValue,
  sectionMatchesFilters,
} from "./models";

export interface InstructorHit {
  name: string;
  displayName: string;
  email?: string | null;
}

export interface SearchResult {
  course: Course;
  stats: ReturnType<CatalogIndex["stats"]>;
  score: number;
  matchNote?: string;
  id: string;
}

export interface SearchResponse {
  results: SearchResult[];
  crnMatch?: CourseSection;
  instructors: InstructorHit[];
  subjects: Subject[];
}

const STOP = new Set(["and", "of", "the", "to", "in", "for", "a", "an", "with", "on", "at", "intro", "introduction"]);

const ALIASES: Record<string, string> = {
  orgo: "organic chemistry",
  ochem: "organic chemistry",
  linalg: "linear algebra",
  diffeq: "differential equations",
  diffeqs: "differential equations",
  stats: "statistics",
  stat: "statistics",
  econ: "economics",
  psych: "psychology",
  chem: "chemistry",
  ml: "machine learning",
  ai: "artificial intelligence",
  hci: "human computer interaction",
  ood: "object oriented",
  algo: "algorithms",
  algos: "algorithms",
  swe: "software engineering",
  nlp: "natural language processing",
  db: "databases",
  dbs: "databases",
  fundies: "program design",
  compsci: "computer science",
  cs1: "program design implementation 1",
  discrete: "discrete",
  theory: "theory",
  calc: "calculus",
  bio: "biology",
  phys: "physics",
  intl: "international",
  mgmt: "management",
  acct: "accounting",
  mktg: "marketing",
  philo: "philosophy",
  poli: "political",
  polisci: "political science",
  comm: "communication",
  comms: "communication",
  lab: "lab",
};

export function normalizeSearch(s: string): string {
  const folded = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  let out = "";
  let lastWasSpace = true;
  for (const ch of folded) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch;
      lastWasSpace = false;
    } else if (ch === "&") {
      if (!lastWasSpace) out += " ";
      out += "and ";
      lastWasSpace = true;
    } else if (!lastWasSpace) {
      out += " ";
      lastWasSpace = true;
    }
  }
  return out.trim();
}

export function searchWords(s: string): string[] {
  const n = normalizeSearch(s);
  return n ? n.split(" ") : [];
}

export function expandAliases(normalized: string, subjectCodes: Set<string>): string {
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => (subjectCodes.has(word.toUpperCase()) ? word : (ALIASES[word] ?? word)))
    .join(" ");
}

export function editDistance(a: string, b: string, limit: number): number {
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    if (rowMin > limit) return limit + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

function parseCourseCode(normalized: string, subjects: Map<string, Subject>): { subject: string; number: string } | null {
  const compact = normalized.replace(/ /g, "");
  let i = 0;
  while (i < compact.length && /[a-z]/i.test(compact[i]!)) i++;
  const letters = compact.slice(0, i);
  const rest = compact.slice(i);
  if (letters.length < 2 || letters.length > 5 || !subjects.has(letters.toUpperCase())) return null;
  if (rest.length > 4 || ![...rest].every((c) => /[a-z0-9]/i.test(c))) return null;
  if (!rest) return normalized === letters ? { subject: letters, number: "" } : null;
  if (!/[0-9]/.test(rest[0]!)) return null;
  return { subject: letters, number: rest };
}

function scoreTokens(
  tokens: string[],
  phrase: string,
  doc: CatalogIndex["documents"][number],
): { score: number; note?: string } | null {
  let total = 0;
  let titleHits = 0;
  let note: string | undefined;
  const meaningful = tokens.filter((t) => !STOP.has(t));
  const wantsIntro = tokens.some((t) => t === "intro" || t === "introduction" || t === "introductory");
  for (const token of meaningful.length ? meaningful : tokens) {
    let best = 0;
    let bestNote: string | undefined;
    if (token === doc.subjectLower) best = Math.max(best, 50);
    if (token === doc.numberLower) best = Math.max(best, 60);
    else if (/^\d+$/.test(token) && doc.numberLower.startsWith(token)) best = Math.max(best, 30);
    if (doc.titleWords.includes(token)) {
      best = Math.max(best, 40);
      titleHits++;
    } else if (token.length >= 2 && doc.titleWords.some((w) => w.startsWith(token))) {
      best = Math.max(best, 28);
      titleHits++;
    }
    if (doc.subjectWords.some((w) => w.startsWith(token))) best = Math.max(best, token.length >= 3 ? 20 : 8);
    if (doc.nupathShorts.has(token)) best = Math.max(best, 15);
    if (best === 0 && token.length >= 2 && doc.topicWords.some((w) => w.startsWith(token))) {
      best = 24;
      bestNote = "Topic match";
    }
    if (best === 0 && token.length >= 2 && doc.instructorWords.some((w) => w.startsWith(token))) {
      best = 22;
      const name = doc.instructorNames.find((n) => searchWords(n).some((w) => w.startsWith(token)));
      if (name) bestNote = `Taught by ${name}`;
    }
    if (
      best === 0 &&
      token.length >= 3 &&
      (doc.descriptionWords.has(token) || (token.length >= 5 && [...doc.descriptionWords].some((w) => w.startsWith(token))))
    ) {
      best = 6;
      bestNote = `Description mentions “${token}”`;
    }
    if (best === 0 && token.length >= 4) {
      const limit = token.length >= 7 ? 2 : 1;
      if (
        doc.titleWords.some(
          (w) =>
            editDistance(w, token, limit) <= limit ||
            (w.length > token.length && editDistance(w.slice(0, token.length), token, 1) <= 1),
        )
      ) {
        best = 12;
        titleHits++;
      }
    }
    if (best === 0) return null;
    total += best;
    if (!note) note = bestNote;
  }
  if (doc.titleNormalized === phrase) total += 150;
  else if (doc.titleNormalized.startsWith(phrase)) total += 80;
  else if (phrase.length >= 4 && doc.titleNormalized.includes(phrase)) total += 50;
  if (titleHits >= Math.max(1, meaningful.length)) {
    total += 25;
    note = undefined;
  }
  if (wantsIntro && doc.level != null) total += doc.level === 1 ? 15 : doc.level === 2 ? 6 : 0;
  total -= doc.numeric / 10_000;
  return { score: total, note };
}

function sortResults(results: SearchResult[], sort: SearchSort): SearchResult[] {
  const copy = [...results];
  if (sort === "relevance") {
    copy.sort((a, b) => (a.score !== b.score ? b.score - a.score : compareCourseKeys(courseKey(a.course), courseKey(b.course))));
  } else if (sort === "courseNumber") {
    copy.sort((a, b) => compareCourseKeys(courseKey(a.course), courseKey(b.course)));
  } else if (sort === "title") {
    copy.sort((a, b) => a.course.title.localeCompare(b.course.title, undefined, { sensitivity: "base", numeric: true }));
  } else {
    copy.sort((a, b) =>
      a.stats.seatsRemaining !== b.stats.seatsRemaining
        ? b.stats.seatsRemaining - a.stats.seatsRemaining
        : compareCourseKeys(courseKey(a.course), courseKey(b.course)),
    );
  }
  return copy;
}

function courseKey(course: Course): CourseKey {
  return { subject: course.subject, number: course.number };
}

export function searchCatalog(
  index: CatalogIndex,
  textRaw: string,
  filters: SearchFilters,
  sort: SearchSort,
): SearchResponse {
  const response: SearchResponse = { results: [], instructors: [], subjects: [] };
  const text = textRaw.trim();

  const passes = (course: Course) => {
    if (!courseMatchesFilters(course, filters)) return false;
    if (!hasSectionFilters(filters)) return true;
    return index.sectionsOf(courseKey(course)).some((s) => sectionMatchesFilters(s, filters));
  };
  const statsFor = (course: Course) => {
    if (!hasSectionFilters(filters)) return index.stats(courseKey(course));
    return index.statsFrom(index.sectionsOf(courseKey(course)).filter((s) => sectionMatchesFilters(s, filters)));
  };

  if (text.length === 5 && /^\d{5}$/.test(text)) {
    const section = index.sectionByCRN(text);
    if (section) response.crnMatch = section;
  }

  if (!text) {
    const scored = index.courses.flatMap((course) => {
      if (!passes(course)) return [];
      return [{ course, stats: statsFor(course), score: 0, id: keyId(courseKey(course)) }];
    });
    response.results = sortResults(scored, sort === "relevance" ? "courseNumber" : sort);
    return response;
  }

  const rawNormalized = normalizeSearch(text);
  const normalized = expandAliases(rawNormalized, index.subjectCodes);
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return response;

  response.subjects = index.activeSubjects.filter((subject) => {
    const name = normalizeSearch(subject.name);
    return (
      subject.code.toLowerCase() === rawNormalized ||
      name === rawNormalized ||
      name === normalized ||
      (rawNormalized.length >= 4 && name.startsWith(rawNormalized))
    );
  });

  const rawTokens = rawNormalized.split(" ").filter(Boolean);
  if (rawTokens.every((t) => t.length >= 2) && !rawTokens.every((t) => /^\d+$/.test(t))) {
    response.instructors = index.instructors
      .filter((instructor) => {
        const words = searchWords(instructor.displayName);
        return rawTokens.every((t) => words.some((w) => w.startsWith(t)));
      })
      .slice(0, 8)
      .map((i) => ({ name: i.name, displayName: i.displayName, email: i.email }));
  }

  const code = parseCourseCode(rawNormalized, index.subjectsByCode);
  const scored: SearchResult[] = [];
  for (const doc of index.documents) {
    const course = index.course(doc.key);
    if (!course) continue;
    let score = 0;
    let note: string | undefined;
    if (code) {
      if (doc.subjectLower !== code.subject) continue;
      if (!code.number) score = 600 - numericValue(doc.key) / 100;
      else if (doc.numberLower === code.number) score = 2000;
      else if (doc.numberLower.startsWith(code.number)) score = 1200 - (doc.numberLower.length - code.number.length);
      else continue;
    } else {
      const match = scoreTokens(tokens, normalized, doc);
      if (!match) continue;
      score = match.score;
      note = match.note;
    }
    if (!passes(course)) continue;
    scored.push({ course, stats: statsFor(course), score, matchNote: note, id: keyId(doc.key) });
  }
  response.results = sortResults(scored, sort);
  return response;
}
