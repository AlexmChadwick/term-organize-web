/**
 * Banner snapshots shipped in `data/term-*.json.gz`.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface TermOption {
  code: string;
  name: string;
  bundled: boolean;
}

/** Oldest first. Names match `termName` for each snapshot's Banner description. */
export const BUNDLED_TERMS: readonly { code: string; name: string }[] = [
  { code: "202710", name: "Fall 2026" },
  { code: "202730", name: "Spring 2027" },
];

export function bundledTermCodes(): string[] {
  return BUNDLED_TERMS.map((term) => term.code);
}

/**
 * Newest bundled term. Banner codes sort chronologically the same way
 * `catalogTerms` orders Northeastern terms: a higher code is later.
 */
export function newestBundledTermCode(codes: readonly string[] = bundledTermCodes()): string {
  const sorted = [...codes].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return sorted[0] ?? BUNDLED_TERMS[0]?.code ?? "";
}

/** A session with no saved term opens the newest bundled snapshot. */
export function initialTermCode(selectedTermCode?: string | null, codes: readonly string[] = bundledTermCodes()): string {
  if (selectedTermCode) return selectedTermCode;
  return newestBundledTermCode(codes);
}

/** Picker options before Banner answers, newest snapshot first. */
export function bundledTermOptions(): TermOption[] {
  return [...BUNDLED_TERMS]
    .sort((a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0))
    .map((term) => ({ code: term.code, name: term.name, bundled: true }));
}

/**
 * Banner's term list, with every bundled snapshot marked and inserted when
 * Banner did not return it. Missing snapshots are added newest first.
 */
export function mergeTermOptions(
  remote: readonly { code: string; name: string }[] | undefined,
  bundledCodes: readonly string[] = bundledTermCodes(),
): TermOption[] {
  const bundled = new Set(bundledCodes);
  const options: TermOption[] = (remote ?? []).map((term) => ({
    code: term.code,
    name: term.name,
    bundled: bundled.has(term.code),
  }));
  const names = new Map(BUNDLED_TERMS.map((term) => [term.code, term.name]));
  const missing = [...bundled]
    .filter((code) => !options.some((option) => option.code === code))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  for (const code of missing.reverse()) {
    options.unshift({ code, name: names.get(code) ?? code, bundled: true });
  }
  return options;
}
