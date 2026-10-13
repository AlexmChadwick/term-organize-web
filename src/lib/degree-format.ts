/**
 * Degree-audit "View Plan" text layout.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/DegreePlan/DegreePlanFormat.swift. The layout was
 * reimplemented from Northeastern's planner export; no audit-system code is included.
 */

import type { CourseKey } from "./models";
import { newId } from "./user";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm, PlanSeason } from "./requirements";
import { parsePlanSeason, seasonStartMonth, sortPlanTerms, termCredits } from "./requirements";

export const DEGREE_SEPARATOR = "-".repeat(115);
export const TITLE_LENGTH = 30;

export class DegreeImportError extends Error {
  constructor(readonly code: "unreadable" | "notADegreePlan", message: string) {
    super(message);
  }
}

export interface ParseResult {
  plan: DegreePlan;
  skippedLines: string[];
}

export function parseDegreePlanText(text: string, fileName?: string): ParseResult {
  const now = Date.now();
  const plan: DegreePlan = {
    id: newId(),
    name: "",
    completed: [],
    terms: [],
    isPrimary: false,
    importedFrom: fileName ?? null,
    createdAt: now,
    updatedAt: now,
    substitutions: [],
    courseEquivalences: [],
  };
  const skipped: string[] = [];
  let sawStructure = false;
  type Section = "header" | "completed" | "term" | "between";
  let section: Section = "header";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizePlanLine(rawLine);
    if (!line || line === "-" || line === "•") continue;
    const printed = headerValue(line, "Printed:");
    if (printed != null) {
      plan.printedAt = parsePrintedDate(printed) ?? undefined;
      continue;
    }
    const studentId = headerValue(line, "StudentID:") ?? headerValue(line, "Student ID:");
    if (studentId != null) {
      plan.studentID = studentId.trim() || null;
      continue;
    }
    const student = headerValue(line, "Student:");
    if (student != null) {
      plan.studentName = student.trim() || null;
      continue;
    }
    const name = headerValue(line, "Degree Audit Plan Name:") ?? headerValue(line, "Plan Name:");
    if (name != null) {
      plan.name = name;
      sawStructure = true;
      continue;
    }
    const program = headerValue(line, "Program:");
    if (program != null) {
      plan.program = program.trim() || null;
      continue;
    }
    if (line.toLowerCase().startsWith("completed courses")) {
      section = "completed";
      sawStructure = true;
      continue;
    }
    if (isSeparator(line)) {
      section = "between";
      continue;
    }
    const term = parseTermHeader(line);
    if (term) {
      plan.terms.push(term);
      section = "term";
      sawStructure = true;
      continue;
    }
    const course = parseCourseLine(line);
    if (course) {
      if (section === "term") plan.terms[plan.terms.length - 1]!.courses.push(course);
      else if (section === "between") {
        if (plan.terms.length === 0) plan.completed.push(course);
        else plan.terms[plan.terms.length - 1]!.courses.push(course);
      } else plan.completed.push(course);
      continue;
    }
    skipped.push(line);
  }

  if (!sawStructure || (plan.completed.length === 0 && plan.terms.length === 0 && !plan.name)) {
    throw new DegreeImportError(
      "notADegreePlan",
      "This doesn't look like a degree audit plan. In the degree audit planner, open your plan and choose View Plan, then import the PDF it creates.",
    );
  }
  if (!plan.name) plan.name = "Imported Plan";
  sortPlanTerms(plan);
  return { plan, skippedLines: skipped };
}

export function parseTermHeader(line: string): DegreePlanTerm | null {
  const match = line.match(/^(.+?)\s+(\d{4})\s*\(\s*\d+(?:\.\d+)?\s*Hours?\s*\)$/i);
  if (!match) return null;
  const season = parsePlanSeason(match[1]!);
  const year = Number(match[2]);
  if (!season || !year) return null;
  return { id: newId(), season, year, courses: [] };
}

export function parseCourseLine(line: string): DegreePlanCourse | null {
  const match = line.match(/^(.+?)\s*\(\s*(\d+(?:\.\d+)?)\s*Hours?\s*\)\s*(.*)$/i);
  if (!match) return null;
  const credits = Number(match[2]);
  if (Number.isNaN(credits)) return null;
  const code = match[1]!.trim();
  const title = match[3]!.trim();
  const key = parseAuditCourseCode(code);
  if (key) return { id: newId(), key, label: `${key.subject} ${key.number}`, title, credits };
  if (code.length > 40 || code.includes(":")) return null;
  return { id: newId(), key: null, label: code, title, credits };
}

export function parseAuditCourseCode(code: string): CourseKey | null {
  const match = code.toUpperCase().match(/^([A-Z]{2,5})\s*(\d{4}[A-Z]?)$/);
  if (!match) return null;
  return { subject: match[1]!, number: match[2]! };
}

export function normalizePlanLine(line: string): string {
  let text = "";
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || /\s/u.test(ch)) text += " ";
    else if (categoryFormat(ch)) continue;
    else text += ch;
  }
  text = text.replace(/ {2,}/g, " ").trim();
  const bullets = new Set(["-", "•", "–", "—"]);
  if (text && bullets.has(text[0]!) && !isSeparator(text)) {
    text = text.replace(/^[-•–—]+/, "").trim();
  }
  return text;
}

function categoryFormat(ch: string): boolean {
  return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(ch);
}

function headerValue(line: string, label: string): string | null {
  if (!line.toLowerCase().startsWith(label.toLowerCase())) return null;
  return line.slice(label.length).trim();
}

function isSeparator(line: string): boolean {
  return line.length >= 10 && [...line].every((c) => c === "-" || c === "_" || c === "=");
}

export function parsePrintedDate(value: string): number | null {
  const formats = [/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?)?$/i];
  const m = value.trim().match(formats[0]!);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = m[4] != null ? Number(m[4]) : 0;
  const minute = m[5] != null ? Number(m[5]) : 0;
  const ampm = m[6]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  // Interpret as America/New_York. Approximate with a fixed offset check via Intl.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const tz = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Find the UTC instant whose New York wall clock matches.
  for (const offset of [4, 5]) {
    const instant = Date.UTC(year, month - 1, day, hour + offset, minute);
    const parts = Object.fromEntries(tz.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    if (Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day && Number(parts.hour) === hour && Number(parts.minute) === minute) {
      return instant;
    }
  }
  return utcGuess;
}

export function hoursLabel(credits: number): string {
  const number = credits.toFixed(1);
  return `(${number} ${credits === 1 ? "Hour" : "Hours"})`;
}

export function exportCode(course: DegreePlanCourse): string {
  if (!course.key) return course.label;
  const subject = course.key.subject.length < 4 ? course.key.subject.padEnd(4, " ") : course.key.subject;
  return subject + course.key.number;
}

export function courseLine(course: DegreePlanCourse): string {
  return `${exportCode(course)} ${hoursLabel(course.credits)} ${course.title.slice(0, TITLE_LENGTH)}`;
}

export function termHeader(term: DegreePlanTerm): string {
  const name = {
    winter: "Winter",
    spring: "Spring",
    summerA: "Summer Session A",
    summerFull: "Summer Full",
    summerB: "Summer Session B",
    fall: "Fall",
  }[term.season];
  const gap = name.includes(" ") ? " " : "  ";
  return `${name}${gap}${term.year} ${hoursLabel(termCredits(term))} `;
}

export function printedLine(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `Printed:  ${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function headerLines(plan: DegreePlan, printedAt = new Date(), includeStudent = false): string[] {
  const header = [printedLine(printedAt)];
  if (includeStudent) {
    header.push(`Student:  ${plan.studentName ?? ""}`);
    header.push(`StudentID:  ${plan.studentID ?? ""}`);
  }
  header.push(`Degree Audit Plan Name:\t${plan.name}`);
  header.push(`Program:\t\t${plan.program ?? ""}`);
  return header;
}

/** Indent 1 is a section or separator; indent 2 is a course. */
export function bodyLines(plan: DegreePlan): { indent: number; text: string }[] {
  const lines: { indent: number; text: string }[] = [{ indent: 1, text: "Completed Courses:  " }];
  for (const course of plan.completed) lines.push({ indent: 2, text: courseLine(course) });
  for (const term of plan.terms) {
    lines.push({ indent: 1, text: DEGREE_SEPARATOR });
    lines.push({ indent: 1, text: termHeader(term) });
    for (const course of term.courses) lines.push({ indent: 2, text: courseLine(course) });
  }
  return lines;
}

export function degreePlanText(plan: DegreePlan, printedAt = new Date(), includeStudent = false): string {
  const header = headerLines(plan, printedAt, includeStudent);
  const body = bodyLines(plan).map((line) => `${"  ".repeat(line.indent)}${line.text}`);
  return [...header, ...body].join("\n");
}

export function bannerCodeForSeason(season: PlanSeason, year: number): string {
  switch (season) {
    case "fall":
      return `${year + 1}10`;
    case "winter":
      return `${year}20`;
    case "spring":
      return `${year}30`;
    case "summerA":
      return `${year}40`;
    case "summerFull":
      return `${year}50`;
    case "summerB":
      return `${year}60`;
  }
}

export { seasonStartMonth };
