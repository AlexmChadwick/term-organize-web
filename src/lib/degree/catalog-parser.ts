/**
 * Academic catalog (catalog.northeastern.edu) HTML parser.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Core/ProgramCatalog/ProgramCatalogParser.swift, plus the pure program
 * suggestions from ProgramCatalogStore.
 */

import { decodeEntities, plainText } from "@/lib/html";
import type { CourseKey } from "@/lib/models";
import type {
  CatalogEditions,
  CatalogProgram,
  CatalogYear,
  CourseOption,
  CourseRange,
  ProgramRequirements,
  RequirementGroup,
  RequirementRule,
  RequirementSection,
  UniversitywideRequirements,
} from "@/lib/requirements";
import { editionBaseURL, editionsAll, parseCatalogYear, programParts } from "@/lib/requirements";

export function currentEdition(html: string): CatalogYear | null {
  const text = decodeEntities(html);
  const patterns = [/Academic Catalog\s+\d{4}\s*[-–]\s*\d{2,4}/, /\d{4}\s*[-–]\s*\d{2,4}\s+Edition/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = parseCatalogYear(match[0]);
    if (year) return year;
  }
  return null;
}

export function archivedEditions(html: string): CatalogYear[] {
  const years = new Map<number, CatalogYear>();
  for (const match of html.matchAll(/archive\/(\d{4})-(\d{4})/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end === start + 1) years.set(start, { startYear: start });
  }
  return [...years.values()].sort((a, b) => b.startYear - a.startYear);
}

/** `/archive/2023-2024/undergraduate/x/` → `undergraduate/x/`. */
export function editionRelativePath(href: string): string {
  let path = href;
  try {
    const url = new URL(href, "https://catalog.northeastern.edu/");
    if (url.host) path = url.pathname + (href.endsWith("/") && !url.pathname.endsWith("/") ? "/" : "");
  } catch {
    /* relative */
  }
  path = path.replace(/^\/?archive\/\d{4}-\d{4}\/?/, "");
  if (path.startsWith("/")) path = path.slice(1);
  return path;
}

export function editionURL(editions: CatalogEditions, year: CatalogYear, path: string): string {
  const base = editionBaseURL(editions, year);
  return new URL(path.replace(/^\/+/, ""), base).href;
}

function catalogLinks(html: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const re = /<a\s[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) out.push({ href: match[1] ?? "", label: match[2] ?? "" });
  return out;
}

function degreeCodeOk(degree: string | undefined): boolean {
  if (!degree || degree[0] !== degree[0]?.toUpperCase()) return false;
  let caps = 0;
  for (const character of degree) if (character >= "A" && character <= "Z") caps += 1;
  return caps >= 2;
}

export function programsFromIndex(html: string): CatalogProgram[] {
  const byPath = new Map<string, CatalogProgram>();
  for (const { href, label } of catalogLinks(html)) {
    const path = editionRelativePath(href);
    if (!(path.startsWith("undergraduate/") || path.startsWith("graduate/")) || !path.endsWith("/")) continue;
    const title = plainText(label);
    const program = { title, path };
    if (!degreeCodeOk(programParts(title).degree) || byPath.has(path)) continue;
    byPath.set(path, program);
  }
  return [...byPath.values()].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }));
}

/** Programs matching a degree-audit code such as `CS-B-CSCI-BSCS`, Boston and campus-less first. */
export function suggestedPrograms(code: string | null | undefined, programs: readonly CatalogProgram[]): CatalogProgram[] {
  const degree = code?.split("-").at(-1);
  if (!degree || degree.length < 2) return [];
  const rank = (program: CatalogProgram) => {
    const campus = programParts(program.title).campus;
    if (campus == null) return 0;
    if (campus === "Boston") return 1;
    return 2;
  };
  return programs
    .filter((program) => programParts(program.title).degree?.toLowerCase() === degree.toLowerCase())
    .sort((a, b) => {
      const delta = rank(a) - rank(b);
      if (delta !== 0) return delta;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
}

/** About 32 credits a year before the current edition. */
export function suggestedCatalogYear(completedCredits: number, editions: CatalogEditions): CatalogYear {
  const yearsDone = Math.max(0, Math.floor(completedCredits / 32));
  const guess = { startYear: editions.current.startYear - yearsDone };
  const all = editionsAll(editions);
  return all.some((year) => year.startYear === guess.startYear) ? guess : (all[all.length - 1] ?? editions.current);
}

export function requirementsContainer(html: string): string {
  const program = html.search(/<div[^>]*id="programrequirementstextcontainer"/);
  const text = html.search(/<div[^>]*id="textcontainer"/);
  const start = program >= 0 ? program : text;
  if (start < 0) return html;
  const matched = /^<div[^>]*id="(?:programrequirements)?textcontainer"/.exec(html.slice(start));
  const rest = html.slice(start + (matched?.[0].length ?? 0));
  const next = rest.search(/<div[^>]*id="[a-z]+textcontainer"/);
  if (next >= 0) return rest.slice(0, next);
  const footer = rest.search(/<footer/i);
  if (footer >= 0) return rest.slice(0, footer);
  return rest;
}

export function universitywideLink(html: string): string | null {
  for (const { href } of catalogLinks(html)) {
    if (!/university-?wide-?requirements/i.test(href)) continue;
    const path = editionRelativePath((href.split("#")[0] ?? href));
    if (path) return path.endsWith("/") ? path : `${path}/`;
  }
  return null;
}

export function parseUniversitywide(html: string, fetchedAt = Date.now()): UniversitywideRequirements | null {
  const text = plainText(requirementsContainer(html));
  const number = (pattern: RegExp): number | null => {
    const match = text.match(pattern);
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };
  const requirements: UniversitywideRequirements = {
    totalHours: number(/minimum\s+(?:of\s+)?(\d+(?:\.\d+)?)\s+total\s+semester\s+hours/i),
    gpa: number(/minimum\s+(?:cumulative\s+)?(\d\.\d+)\s+GPA/i),
    residencyHours: number(/minimum\s+of\s+(\d+(?:\.\d+)?)\s+Northeastern\s+University\s+semester\s+hours/i),
    requiresExperientialLearning: /experiential\s+learning\s+graduation\s+requirement/i.test(text),
    fetchedAt,
  };
  if (requirements.totalHours == null && requirements.gpa == null && requirements.residencyHours == null && !requirements.requiresExperientialLearning) {
    return null;
  }
  return requirements;
}

export function courseKeysIn(text: string): CourseKey[] {
  const keys: CourseKey[] = [];
  for (const match of text.matchAll(/\b([A-Z]{2,5})\s+(\d{4}[A-Z]?)\b/g)) {
    keys.push({ subject: match[1]!, number: match[2]! });
  }
  return keys;
}

/** `CS 1800 and CS 1802` → one set; `CS 4500 or CS 4530` → two. */
export function courseSetsIn(text: string): CourseKey[][] {
  let cleaned = text.replace(/\u00A0/g, " ");
  if (cleaned.toLowerCase().startsWith("or ")) cleaned = cleaned.slice(3);
  const sets: CourseKey[][] = [];
  for (const part of cleaned.split(" or ")) {
    const keys = courseKeysIn(part);
    if (keys.length > 0) sets.push(keys);
  }
  return sets;
}

export function hoursValue(text: string): number | null {
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** `CS 2500 or higher, except CS 5010`, `DS 2500 to DS 4999 but not DS 4900`. */
export function courseRangeIn(text: string): CourseRange | null {
  const cleaned = text.replace(/\u00A0/g, " ").trim();
  const higher = cleaned.match(/^([A-Z]{2,5}) (\d{4}) or (?:higher|above)(?:,? (?:except|excluding|but not) (.+?))?\.?$/);
  if (higher) {
    return {
      subject: higher[1]!,
      lowest: Number(higher[2]),
      highest: null,
      except: higher[3] ? courseKeysIn(higher[3]) : [],
      label: cleaned,
    };
  }
  const span = cleaned.match(/^([A-Z]{2,5}) (\d{4}) (?:to|through|-|–) (?:([A-Z]{2,5}) )?(\d{4})(?:,? (?:except|excluding|but not) (.+?))?\.?$/);
  if (span && (span[3] == null || span[3] === span[1])) {
    return {
      subject: span[1]!,
      lowest: Number(span[2]),
      highest: Number(span[4]),
      except: span[5] ? courseKeysIn(span[5]) : [],
      label: cleaned,
    };
  }
  return null;
}

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** What a "Complete …" line asks for: a number of options or of semester hours. */
export function chooseAmount(text: string): { count: number | null; hours: number | null } | null {
  const lower = text.toLowerCase();
  if (!/^(?:complete|choose|select|take)\b/.test(lower)) return null;
  const hours = lower.match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+)?\s+(?:semester hours?|credits?|credit hours?|sh)\b/);
  if (hours) return { count: null, hours: Number(hours[1]) };
  const count = lower.match(/^(?:complete|choose|select|take)\s+(?:any\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  if (!count) return null;
  const token = count[1]!;
  const value = Number(token);
  const parsed = Number.isFinite(value) && token.match(/^\d/) ? value : COUNT_WORDS[token];
  return parsed == null ? null : { count: parsed, hours: null };
}

export interface CatalogRow {
  kind:
    | { type: "skip" }
    | { type: "areaHeader"; title: string }
    | { type: "subheader"; title: string }
    | { type: "comment"; text: string }
    | { type: "courses"; sets: CourseKey[][]; isAlternative: boolean };
  hours: number | null;
  titles: string[];
}

function spacedText(html: string): string {
  return plainText(html.replace(/</g, " <"))
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function rowsInTable(html: string): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const match of html.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    rows.push(parseRow(match[1] ?? "", match[2] ?? ""));
  }
  return rows;
}

function parseRow(attributes: string, body: string): CatalogRow {
  const rowClass = attributes.match(/class="([^"]*)"/)?.[1] ?? "";
  const cells: { isHeader: boolean; cls: string; html: string }[] = [];
  for (const match of body.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
    const attrs = match[2] ?? "";
    cells.push({
      isHeader: (match[1] ?? "").toLowerCase() === "h",
      cls: attrs.match(/class="([^"]*)"/)?.[1] ?? "",
      html: match[3] ?? "",
    });
  }
  const hoursCell = cells.find((cell) => cell.cls.includes("hourscol"));
  const hours = hoursCell ? hoursValue(plainText(hoursCell.html)) : null;
  if (rowClass.includes("hidden") || cells.some((cell) => cell.isHeader)) return { kind: { type: "skip" }, hours, titles: [] };
  if (rowClass.includes("areasubheader") || body.includes("areasubheader")) {
    return { kind: { type: "subheader", title: plainText(body) }, hours, titles: [] };
  }
  if (rowClass.includes("areaheader") || body.includes("courselistcomment areaheader")) {
    return { kind: { type: "areaHeader", title: plainText(body) }, hours, titles: [] };
  }
  const code = cells.find((cell) => cell.cls.includes("codecol"));
  if (code) {
    const text = spacedText(code.html);
    const isAlternative = rowClass.includes("orclass") || code.cls.includes("orclass") || text.toLowerCase().startsWith("or ");
    const sets = courseSetsIn(text);
    if (sets.length > 0) {
      const titleCell = cells.find((cell) => !cell.cls.includes("codecol") && !cell.cls.includes("hourscol") && !cell.isHeader);
      const titles = titleCell
        ? plainText(titleCell.html)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .map((line) => (line.toLowerCase().startsWith("and ") ? line.slice(4) : line))
            .filter((line) => line.length > 0)
        : [];
      return { kind: { type: "courses", sets, isAlternative }, hours, titles };
    }
  }
  if (body.includes("courselistcomment")) {
    const text = spacedText(cells[0]?.html ?? body);
    return text ? { kind: { type: "comment", text }, hours, titles: [] } : { kind: { type: "skip" }, hours, titles: [] };
  }
  return { kind: { type: "skip" }, hours, titles: [] };
}

interface RuleDraft {
  kind:
    | { type: "required"; alternatives: CourseKey[][] }
    | { type: "choose"; count: number | null; hours: number | null; options: CourseKey[][][]; ranges: CourseRange[] }
    | { type: "general"; hours: number };
  label: string;
  hours: number | null;
  notes: string[];
  optionCategories: (string | null)[];
  currentCategory: string | null;
}

interface GroupDraft {
  title: string | null;
  rules: RuleDraft[];
  notes: string[];
}

interface SectionDraft {
  title: string;
  groups: GroupDraft[];
  notes: string[];
}

function slug(text: string): string {
  const lowered = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return lowered.slice(0, 60).replace(/^-+|-+$/g, "");
}

function uniqueId(id: string, used: Set<string>): string {
  let candidate = id === "" ? "item" : id;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${id}-${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function isChoosableSection(title: string): boolean {
  return /^(concentration|track|option|pathway)( in\b|\s*:)|\b(concentration|track|option|pathway)$/i.test(title);
}

interface Builder {
  sections: SectionDraft[];
  totalHours: number | null;
  courseTitles: Record<string, string>;
  chooseIndex: number | null;
}

function currentGroup(builder: Builder): GroupDraft {
  const section = builder.sections[builder.sections.length - 1]!;
  return section.groups[section.groups.length - 1]!;
}

function startSection(builder: Builder, title: string): void {
  builder.sections.push({ title: title.trim(), groups: [], notes: [] });
  builder.chooseIndex = null;
}

function appendGroup(builder: Builder, title: string | null): void {
  builder.sections[builder.sections.length - 1]!.groups.push({ title, rules: [], notes: [] });
  builder.chooseIndex = null;
}

function addComment(builder: Builder, text: string, hours: number | null): void {
  const group = currentGroup(builder);
  if (text.toLowerCase().includes("general elective")) {
    const amount = hours ?? chooseAmount(text)?.hours;
    if (amount != null) {
      group.rules.push({
        kind: { type: "general", hours: amount },
        label: text,
        hours: amount,
        notes: [],
        optionCategories: [],
        currentCategory: null,
      });
      builder.chooseIndex = null;
      return;
    }
  }
  const range = courseRangeIn(text);
  if (range && builder.chooseIndex != null) {
    const rule = group.rules[builder.chooseIndex];
    if (rule && rule.kind.type === "choose") {
      rule.kind.ranges.push(range);
      return;
    }
  }
  if (range) {
    group.notes.push(text);
    return;
  }
  const amount = chooseAmount(text);
  if (amount) {
    group.rules.push({
      kind: { type: "choose", count: amount.count, hours: amount.hours, options: [], ranges: [] },
      label: text,
      hours: hours ?? amount.hours,
      notes: [],
      optionCategories: [],
      currentCategory: null,
    });
    builder.chooseIndex = group.rules.length - 1;
    return;
  }
  if (builder.chooseIndex != null && group.rules[builder.chooseIndex]) {
    group.rules[builder.chooseIndex]!.notes.push(text);
  } else {
    group.notes.push(text);
  }
}

function addCourses(builder: Builder, sets: CourseKey[][], isAlternative: boolean, hours: number | null): void {
  const group = currentGroup(builder);
  if (isAlternative) {
    if (builder.chooseIndex != null) {
      const rule = group.rules[builder.chooseIndex];
      if (rule && rule.kind.type === "choose" && rule.kind.options.length > 0) {
        const last = rule.kind.options[rule.kind.options.length - 1]!;
        last.push(...sets);
        return;
      }
    }
    const last = group.rules[group.rules.length - 1];
    if (last && last.kind.type === "required") {
      last.kind.alternatives.push(...sets);
      return;
    }
  }
  if (builder.chooseIndex != null && hours == null) {
    const rule = group.rules[builder.chooseIndex];
    if (rule && rule.kind.type === "choose") {
      rule.kind.options.push(sets);
      rule.optionCategories.push(rule.currentCategory);
      return;
    }
  }
  group.rules.push({
    kind: { type: "required", alternatives: sets },
    label: "",
    hours,
    notes: [],
    optionCategories: [],
    currentCategory: null,
  });
  builder.chooseIndex = null;
}

function addTable(builder: Builder, html: string): void {
  if (builder.sections.length === 0) startSection(builder, "Program Requirements");
  builder.chooseIndex = null;
  let startedGroup = false;
  for (const row of rowsInTable(html)) {
    if (row.kind.type === "skip") continue;
    if (row.kind.type === "areaHeader") {
      appendGroup(builder, row.kind.title);
      startedGroup = true;
      continue;
    }
    if (row.kind.type === "subheader") {
      if (builder.chooseIndex != null) {
        const rule = currentGroup(builder).rules[builder.chooseIndex];
        if (rule) {
          rule.notes.push(row.kind.title);
          rule.currentCategory = row.kind.title;
        }
      } else {
        currentGroup(builder).notes.push(row.kind.title);
      }
      continue;
    }
    if (!startedGroup) {
      appendGroup(builder, null);
      startedGroup = true;
    }
    if (row.kind.type === "comment") {
      addComment(builder, row.kind.text, row.hours);
      continue;
    }
    addCourses(builder, row.kind.sets, row.kind.isAlternative, row.hours);
    const keys = row.kind.sets.flat();
    for (let i = 0; i < keys.length && i < row.titles.length; i += 1) {
      const id = `${keys[i]!.subject} ${keys[i]!.number}`;
      if (builder.courseTitles[id] == null && row.titles[i]) builder.courseTitles[id] = row.titles[i]!;
    }
  }
}

function finish(builder: Builder): RequirementSection[] {
  const sectionIDs = new Set<string>();
  return builder.sections.map((draft) => {
    const sectionID = uniqueId(slug(draft.title), sectionIDs);
    const groupIDs = new Set<string>();
    const groups: RequirementGroup[] = [];
    for (const group of draft.groups) {
      const groupID = uniqueId(`${sectionID}/${slug(group.title ?? "courses")}`, groupIDs);
      const ruleIDs = new Set<string>();
      const rules: RequirementRule[] = [];
      for (const rule of group.rules) {
        let kind: RequirementRule["kind"];
        let label = rule.label;
        if (rule.kind.type === "required") {
          if (rule.kind.alternatives.length === 0) continue;
          const option: CourseOption = { alternatives: rule.kind.alternatives };
          kind = { type: "required", option };
          label = option.alternatives.map((set) => set.map((key) => `${key.subject} ${key.number}`).join(" and ")).join(" or ");
        } else if (rule.kind.type === "choose") {
          kind = {
            type: "choose",
            count: rule.kind.count,
            hours: rule.kind.hours,
            options: rule.kind.options.map((alternatives) => ({ alternatives })),
            ranges: rule.kind.ranges,
          };
        } else {
          kind = { type: "generalElectives", hours: rule.kind.hours };
        }
        const categories = rule.optionCategories.some((category) => category != null) ? rule.optionCategories : null;
        rules.push({
          id: uniqueId(`${groupID}/${slug(label)}`, ruleIDs),
          kind,
          label,
          hours: rule.hours,
          notes: rule.notes,
          optionCategories: categories,
        });
      }
      if (rules.length === 0 && group.notes.length === 0) continue;
      groups.push({ id: groupID, title: group.title, rules, notes: group.notes });
    }
    const title = draft.title.replace(/^[* ]+|[* ]+$/g, "");
    return {
      id: sectionID,
      title,
      isConcentration: groups.length > 0 && isChoosableSection(title),
      groups,
      notes: draft.notes,
    };
  });
}

const TOKEN = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>|<table[^>]*class="[^"]*sc_courselist[^"]*"[^>]*>([\s\S]*?)<\/table>|<p[^>]*>([\s\S]*?)<\/p>/gi;

/** The requirements on a program page; null when the page has no requirement tables. */
export function parseProgramPage(
  html: string,
  year: CatalogYear,
  program: CatalogProgram,
  fetchedAt = Date.now(),
): ProgramRequirements | null {
  const builder: Builder = { sections: [], totalHours: null, courseTitles: {}, chooseIndex: null };
  const container = requirementsContainer(html);
  for (const match of container.matchAll(TOKEN)) {
    if (match[2] != null) {
      startSection(builder, plainText(match[2]));
      continue;
    }
    if (match[3] != null) {
      addTable(builder, match[3]);
      continue;
    }
    if (match[4] != null) {
      const text = plainText(match[4]);
      if (!text) continue;
      const hours = text.match(/(\d+(?:\.\d+)?)\s+total semester hours/);
      if (hours) builder.totalHours = Math.max(builder.totalHours ?? 0, Number(hours[1]));
      if (builder.sections.length > 0) builder.sections[builder.sections.length - 1]!.notes.push(text);
    }
  }
  const sections = finish(builder);
  if (!sections.some((section) => section.groups.length > 0)) return null;
  return {
    year,
    program,
    sections,
    totalHours: builder.totalHours,
    fetchedAt,
    courseTitles: builder.courseTitles,
  };
}

export function programURL(base: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).href;
}
