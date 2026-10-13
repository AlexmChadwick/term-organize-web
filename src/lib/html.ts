/**
 * Minimal HTML helpers for Banner fragments and catalog pages.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/Banner/HTMLText.swift.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
  frac12: "½",
};

export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  let output = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch !== "&") {
      output += ch;
      continue;
    }
    const window = input.slice(i, Math.min(input.length, i + 12));
    const semi = window.indexOf(";");
    if (semi < 0) {
      output += ch;
      continue;
    }
    const entity = input.slice(i + 1, i + semi);
    let replacement: string | undefined;
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const v = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(v)) replacement = String.fromCodePoint(v);
    } else if (entity.startsWith("#")) {
      const v = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(v)) replacement = String.fromCodePoint(v);
    } else {
      replacement = NAMED[entity.toLowerCase()];
    }
    if (replacement != null) {
      output += replacement;
      i += semi;
    } else {
      output += ch;
    }
  }
  return output;
}

export function plainText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(decodeEntities(s));
  const lines = s.split(/\r?\n/).map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim());
  const result: string[] = [];
  for (const line of lines) {
    if (line === "" && (result.length === 0 || result[result.length - 1] === "")) continue;
    result.push(line);
  }
  return result.join("\n").trim();
}

function captures(pattern: RegExp, text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const match of text.matchAll(re)) {
    if (match[1] != null) out.push(match[1]);
  }
  return out;
}

export function tableRows(html: string): string[][] | null {
  const bodyStart = html.search(/<tbody/i);
  if (bodyStart < 0) return null;
  const openEnd = html.indexOf(">", bodyStart);
  if (openEnd < 0) return null;
  const bodyEnd = html.toLowerCase().indexOf("</tbody>", openEnd);
  if (bodyEnd < 0) return null;
  const body = html.slice(openEnd + 1, bodyEnd);
  return captures(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, body).map((row) =>
    captures(/<td[^>]*>([\s\S]*?)<\/td>/gi, row).map(plainText),
  );
}

/** Anchor href + inner HTML, in document order. */
export function linksIn(html: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const href = match[1] ?? match[2] ?? match[3] ?? "";
    out.push({ href, label: match[4] ?? "" });
  }
  return out;
}
