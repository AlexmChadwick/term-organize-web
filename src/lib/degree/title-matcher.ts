/**
 * Course-title similarity for renumbering hints.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/Models/CourseTitleMatcher.swift.
 */

/** Least Jaccard similarity that counts as alike. */
export const minimumTitleSimilarity = 0.6;

const FILLER = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with",
  "principle", "introduction", "introductory", "intro", "fundamental", "topic",
  "prncple", "prncpl", "intr", "introd",
]);

const FORMATS = new Set([
  "special", "directed", "independent", "study", "research", "thesis", "dissertation", "seminar", "project",
  "practicum", "capstone", "continuation", "experience", "internship", "co", "op", "work", "term", "workshop",
  "lab", "reading", "tutorial", "residency", "preparation",
]);

const QUALIFIERS = new Set(["lab", "recitation", "advanced", "intermediate", "elementary"]);

const SYNONYMS: Record<string, string> = { laboratory: "lab" };

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};

/** A course title reduced to the words that tell courses apart. */
export interface ParsedTitle {
  words: Set<string>;
  parts: Set<string>;
  qualifiers: Set<string>;
  cutOffWord: string | null;
  /** Two or more telling words, not all of them words every kind of course has. */
  isDistinctive: boolean;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokensOf(text: string): string[] {
  const folded = fold(text.replace(/&/g, " and ").replace(/['’]/g, ""));
  const tokens: string[] = [];
  let current = "";
  for (const character of folded) {
    if (/[0-9a-z]/i.test(character)) current += character;
    else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function partOf(token: string): string | null {
  const first = token[0];
  if (first != null && first >= "0" && first <= "9") return token;
  const roman = ROMAN[token];
  return roman == null ? null : String(roman);
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

function isSubset(inner: Set<string>, outer: Set<string>): boolean {
  for (const word of inner) if (!outer.has(word)) return false;
  return true;
}

export function parseTitle(text: string): ParsedTitle {
  const words = new Set<string>();
  const parts = new Set<string>();
  let last: string | null = null;
  for (const raw of tokensOf(text)) {
    const part = partOf(raw);
    if (part != null) {
      parts.add(part);
      last = null;
      continue;
    }
    const base = singular(raw);
    const word = SYNONYMS[base] ?? base;
    if (FILLER.has(word)) {
      last = null;
      continue;
    }
    words.add(word);
    last = word;
  }
  const qualifiers = new Set<string>();
  for (const word of words) if (QUALIFIERS.has(word)) qualifiers.add(word);
  const trimmed = text.trim();
  const cutOffWord = trimmed.length >= 29 && last != null && last.length >= 3 ? last : null;
  return {
    words,
    parts,
    qualifiers,
    cutOffWord,
    isDistinctive: words.size >= 2 && !isSubset(words, FORMATS),
  };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function completing(title: ParsedTitle, other: Set<string>): Set<string> {
  const cut = title.cutOffWord;
  if (cut == null || other.has(cut)) return title.words;
  const full = [...other].sort().find((word) => word.startsWith(cut) && word.length > cut.length);
  if (!full) return title.words;
  const words = new Set(title.words);
  words.delete(cut);
  words.add(full);
  return words;
}

/**
 * How alike two titles are, from `minimum` to 1. Null when they are not alike.
 * Different part numbers never match, nor do a course and its lab or advanced version.
 */
export function titleSimilarity(a: string | ParsedTitle, b: string | ParsedTitle, minimum = minimumTitleSimilarity): number | null {
  const left = typeof a === "string" ? parseTitle(a) : a;
  const right = typeof b === "string" ? parseTitle(b) : b;
  if (left.parts.size > 0 && right.parts.size > 0 && !setsEqual(left.parts, right.parts)) return null;
  if (!setsEqual(left.qualifiers, right.qualifiers)) return null;
  const aWords = completing(left, right.words);
  const bWords = completing(right, left.words);
  if (aWords.size < 2 || bWords.size < 2) return null;
  let shared = 0;
  for (const word of aWords) if (bWords.has(word)) shared += 1;
  if (shared === 0) return null;
  if (isSubset(aWords, FORMATS) || isSubset(bWords, FORMATS)) return null;
  const union = new Set(aWords);
  for (const word of bWords) union.add(word);
  const score = shared / union.size;
  if (score >= minimum) return score;
  const contained = shared === aWords.size || shared === bWords.size;
  return contained ? minimum : null;
}
