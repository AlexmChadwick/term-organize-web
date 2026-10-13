/**
 * Banner HTML parsers and wire-format conversion.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Portions derived from SearchNEU (https://github.com/sandboxnu/searchneu):
 * packages/scraper/src/generate/steps/reqs.ts, courseNames.ts, marshall.ts,
 * and schemas/banner. © Sandbox at Northeastern University and the SearchNEU
 * contributors, AGPL-3.0. Modified 2026-10-13: ported from the Swift port back
 * to TypeScript for the web app.
 */

import { decodeEntities, plainText, tableRows } from "./html";
import type { AttributeInfo, Campus, Course, CourseKey, CourseSection, Instructor, Meeting, Requisite, Subject, Term, TermCatalog } from "./models";
import { HONORS_ATTRIBUTE, compareCourseKeys, keyId, minutesFromHHMM, recomputePostreqs, reqAnd, reqCourse, simplifyRequisite } from "./models";

export interface SubjectLookup {
  code(name: string): string;
}

export function subjectLookup(subjects: { code: string; name: string }[]): SubjectLookup {
  const byName = new Map<string, string>();
  for (const s of subjects) {
    byName.set(s.name.toLowerCase(), s.code);
    byName.set(s.code.toLowerCase(), s.code);
  }
  return {
    code(name: string) {
      const trimmed = name.trim();
      const direct = byName.get(trimmed.toLowerCase());
      if (direct) return direct;
      const m = trimmed.match(/\s+-\s+[A-Z]{2,5}$/);
      if (m) {
        const base = trimmed.slice(0, trimmed.length - m[0].length).toLowerCase();
        const code = byName.get(base);
        if (code) return code;
      }
      return trimmed;
    },
  };
}

export function parsePrerequisites(html: string, subjects: SubjectLookup): Requisite | null {
  const rows = tableRows(html);
  if (!rows || rows.length === 0) return null;

  type Item = { leaf: Requisite } | { node: Condition };
  type Condition = { isAnd: boolean; items: Item[] };
  const root: Condition = { isAnd: false, items: [] };
  const stack: Condition[] = [root];
  let current = root;

  const build = (node: Condition): Requisite | null => {
    const built: Requisite[] = [];
    for (const item of node.items) {
      if ("leaf" in item) built.push(item.leaf);
      else {
        const child = build(item.node);
        if (child) built.push(child);
      }
    }
    if (built.length === 0) return null;
    return node.isAnd ? { and: built } : { or: built };
  };

  for (const cells of rows) {
    const cell = (i: number) => (i < cells.length ? cells[i]!.trim() : "");
    if (cells.length < 6) continue;
    const andOr = cell(0).toLowerCase();
    if (andOr === "and") current.isAnd = true;
    else if (andOr === "or") current.isAnd = false;
    if (cell(1)) {
      const child: Condition = { isAnd: false, items: [] };
      current.items.push({ node: child });
      stack.push(child);
      current = child;
    }
    const testName = cell(2);
    if (testName) {
      const score = cell(3) ? Number(cell(3)) : NaN;
      current.items.push({ leaf: { test: testName, ...(Number.isFinite(score) ? { score } : {}) } });
    }
    const subjectName = cell(4);
    const number = cell(5);
    if (subjectName && number) {
      current.items.push({ leaf: reqCourse({ subject: subjects.code(subjectName), number }) });
    }
    if (cell(8) && stack.length > 1) {
      stack.pop();
      current = stack[stack.length - 1]!;
    }
  }
  const built = build(root);
  return built ? simplifyRequisite(built) : null;
}

export function parseCorequisites(html: string, subjects: SubjectLookup): Requisite | null {
  const rows = tableRows(html);
  if (!rows) return null;
  const items: Requisite[] = [];
  for (const cells of rows) {
    let subjectName = "";
    let number = "";
    if (cells.length === 3) {
      subjectName = cells[0] ?? "";
      number = cells[1] ?? "";
    } else if (cells.length >= 4) {
      subjectName = cells[1] ?? "";
      number = cells[2] ?? "";
    } else continue;
    if (!subjectName || !number) continue;
    items.push(reqCourse({ subject: subjects.code(subjectName), number }));
  }
  if (items.length === 0) return null;
  if (items.length === 1) return items[0]!;
  return reqAnd(items);
}

export function parseDescription(html: string): string {
  const text = plainText(html);
  const lowered = text.toLowerCase();
  if (lowered.startsWith("no course description") || lowered.includes("no information available")) return "";
  return text;
}

export interface CatalogDetails {
  title?: string;
  college?: string;
  department?: string;
  minCredits?: number;
  maxCredits?: number;
}

export function creditRange(text: string): { low: number; high: number } | null {
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (!numbers.length || numbers[0] == null || Number.isNaN(numbers[0])) return null;
  const second = numbers.length > 1 ? numbers[1]! : numbers[0];
  return { low: Math.min(numbers[0], second), high: Math.max(numbers[0], second) };
}

export function expandCollegeName(s: string): string {
  let out = ` ${s} `;
  const replacements: [string, string][] = [
    [" Coll of ", " College of "],
    [" Col of ", " College of "],
    [" Coll ", " College "],
    [" Comp Sciences ", " Computer Sciences "],
    [" Hlth ", " Health "],
    [" Sci ", " Science "],
    [" Engr ", " Engineering "],
    [" Prof ", " Professional "],
    [" School Business ", " School of Business "],
    [" Soc Sci ", " Social Sciences "],
  ];
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out.trim();
}

export function parseCatalogDetails(html: string): CatalogDetails {
  const lines = plainText(html)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const value = (label: string): string | undefined => {
    const i = lines.findIndex((l) => l.startsWith(label));
    if (i < 0) return undefined;
    const inline = lines[i]!.slice(label.length).trim();
    if (inline) return inline;
    if (i + 1 >= lines.length || lines[i + 1]!.endsWith(":")) return undefined;
    return lines[i + 1];
  };
  const strip = (s?: string) => {
    if (!s) return undefined;
    const parts = s.split(" ");
    const last = parts[parts.length - 1];
    if (
      parts.length > 1 &&
      last &&
      last.length <= 4 &&
      last === last.toUpperCase() &&
      [...last].every((c) => /[A-Za-z0-9]/.test(c))
    ) {
      parts.pop();
    }
    return parts.join(" ");
  };
  const credits = value("Credit Hours:") ? creditRange(value("Credit Hours:")!) : null;
  return {
    title: value("Title:"),
    college: expandCollegeName(strip(value("College:")) ?? "") || undefined,
    department: expandCollegeName(strip(value("Department:")) ?? "") || undefined,
    minCredits: credits?.low,
    maxCredits: credits?.high,
  };
}

function isCourseNumber(text: string): boolean {
  return text.length >= 3 && text.length <= 5 && /^[0-9]/.test(text) && /^[A-Za-z0-9]+$/.test(text);
}

export function parseMutualExclusions(html: string, subjects: SubjectLookup): CourseKey[] {
  const text = plainText(html);
  if (text.toLowerCase().includes("no mutual exclusion")) return [];
  const keys: CourseKey[] = [];
  const add = (key: CourseKey) => {
    if (!keys.some((k) => k.subject === key.subject && k.number === key.number)) keys.push(key);
  };
  for (const cells of tableRows(html) ?? []) {
    const trimmed = cells.map((c) => c.trim());
    for (let i = 0; i < trimmed.length - 1; i++) {
      const a = trimmed[i]!;
      const b = trimmed[i + 1]!;
      if (/[A-Za-z]/.test(a) && !isCourseNumber(a) && isCourseNumber(b)) {
        add({ subject: subjects.code(a), number: b });
        break;
      }
    }
  }
  if (keys.length === 0) {
    for (const match of text.matchAll(/\b([A-Z]{2,6})\s?(\d{3,4}[A-Z]?)\b/g)) {
      add({ subject: match[1]!, number: match[2]! });
    }
  }
  return keys;
}

export interface CrossListedSection {
  crn: string;
  course: CourseKey;
  title: string;
  section: string;
}

export function parseCrossListed(html: string, subjects: SubjectLookup): CrossListedSection[] {
  const rows = tableRows(html);
  if (!rows) return [];
  const out: CrossListedSection[] = [];
  for (const cells of rows) {
    if (cells.length < 4) continue;
    const crn = cells[0]!.trim();
    const subject = cells[1]!.trim();
    const number = cells[2]!.trim();
    if (!crn || ![...crn].every((c) => c >= "0" && c <= "9") || !subject || !number) continue;
    out.push({
      crn,
      course: { subject: subjects.code(subject), number },
      title: cells[3]!.trim(),
      section: cells.length > 4 ? cells[4]!.trim() : "",
    });
  }
  return out;
}

export function catalogCodesContain(items: { code: string }[], course: CourseKey): boolean {
  const wanted = `${course.subject}${course.number}`.replace(/\s/g, "").toUpperCase();
  return items.some((item) => item.code.replace(/\s/g, "").toUpperCase() === wanted);
}

// MARK: - Wire format

export interface BannerSection {
  courseReferenceNumber: string;
  partOfTerm?: string | null;
  courseNumber: string;
  subject: string;
  sequenceNumber?: string | null;
  campusDescription?: string | null;
  scheduleTypeDescription?: string | null;
  courseTitle?: string | null;
  creditHours?: number | null;
  maximumEnrollment?: number | null;
  enrollment?: number | null;
  seatsAvailable?: number | null;
  waitCapacity?: number | null;
  waitCount?: number | null;
  waitAvailable?: number | null;
  crossList?: string | null;
  crossListCapacity?: number | null;
  crossListCount?: number | null;
  crossListAvailable?: number | null;
  creditHourHigh?: number | null;
  creditHourLow?: number | null;
  meetingsFaculty?: {
    faculty?: { displayName?: string | null; emailAddress?: string | null; primaryIndicator?: boolean | null }[] | null;
    meetingTime?: BannerMeeting | null;
  }[] | null;
  sectionAttributes?: { code: string; description?: string | null }[] | null;
  instructionalMethodDescription?: string | null;
}

export interface BannerMeeting {
  beginTime?: string | null;
  endTime?: string | null;
  building?: string | null;
  buildingDescription?: string | null;
  room?: string | null;
  campus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  meetingType?: string | null;
  meetingTypeDescription?: string | null;
  monday?: boolean | null;
  tuesday?: boolean | null;
  wednesday?: boolean | null;
  thursday?: boolean | null;
  friday?: boolean | null;
  saturday?: boolean | null;
  sunday?: boolean | null;
}

function blank(s?: string | null): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

export function bannerDateISO(banner: string): string | null {
  const parts = banner.split("/");
  if (parts.length !== 3) return null;
  const m = Number(parts[0]);
  const d = Number(parts[1]);
  const y = Number(parts[2]);
  if (!m || !d || !y) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function meetingFromBanner(mt: BannerMeeting): Meeting {
  const start = mt.beginTime != null && mt.beginTime !== "" ? minutesFromHHMM(Number(mt.beginTime)) : null;
  const end = mt.endTime != null && mt.endTime !== "" ? minutesFromHHMM(Number(mt.endTime)) : null;
  const roomRaw = mt.room?.trim();
  const room = roomRaw && roomRaw.toUpperCase() !== "ROOM" ? roomRaw : undefined;
  const kind = mt.meetingType === "FNEX" ? "Final Exam" : decodeEntities(mt.meetingTypeDescription ?? "Class");
  let days = 0;
  if (mt.sunday) days |= 1 << 0;
  if (mt.monday) days |= 1 << 1;
  if (mt.tuesday) days |= 1 << 2;
  if (mt.wednesday) days |= 1 << 3;
  if (mt.thursday) days |= 1 << 4;
  if (mt.friday) days |= 1 << 5;
  if (mt.saturday) days |= 1 << 6;
  return {
    days: days & 0x7f,
    start: Number.isFinite(start as number) ? start : null,
    end: Number.isFinite(end as number) ? end : null,
    buildingCode: blank(mt.building) ?? null,
    building: blank(mt.buildingDescription ? decodeEntities(mt.buildingDescription) : undefined) ?? null,
    room: room ?? null,
    campusCode: blank(mt.campus) ?? null,
    kind,
    startDate: mt.startDate ? bannerDateISO(mt.startDate) : null,
    endDate: mt.endDate ? bannerDateISO(mt.endDate) : null,
  };
}

// Fix dayMask misuse: I passed a bitmask not indices. Correct below in a helper.

function facultyToInstructor(f: {
  displayName?: string | null;
  emailAddress?: string | null;
  primaryIndicator?: boolean | null;
}): Instructor | null {
  const name = blank(f.displayName ? decodeEntities(decodeEntities(f.displayName)) : undefined);
  if (!name) return null;
  return { name, primary: f.primaryIndicator ?? false, email: blank(f.emailAddress) ?? null };
}

export function sectionsFromBanner(banner: BannerSection[], previous: Map<string, CourseSection> = new Map()): CourseSection[] {
  const crossLists = new Map<string, string[]>();
  for (const s of banner) {
    const x = blank(s.crossList);
    if (!x) continue;
    const list = crossLists.get(x) ?? [];
    list.push(s.courseReferenceNumber);
    crossLists.set(x, list);
  }
  return banner.map((s) => {
    const attributes = (s.sectionAttributes ?? []).map((a) => a.code);
    const honors = (s.sectionAttributes ?? []).some(
      (a) => a.code === HONORS_ATTRIBUTE || a.description?.trim() === "Honors",
    );
    const meetings = (s.meetingsFaculty ?? []).flatMap((m) => (m.meetingTime ? [meetingFromBanner(m.meetingTime)] : []));
    const bannerInstructors = (s.meetingsFaculty ?? [])
      .flatMap((m) => m.faculty ?? [])
      .map(facultyToInstructor)
      .filter((i): i is Instructor => i != null);
    const prior = previous.get(s.courseReferenceNumber);
    const group = blank(s.crossList);
    const crossList = (group ? crossLists.get(group) ?? [] : []).filter((crn) => crn !== s.courseReferenceNumber);
    return {
      crn: s.courseReferenceNumber,
      subject: s.subject,
      number: s.courseNumber,
      title: decodeEntities(decodeEntities(s.courseTitle ?? "")),
      sectionNumber: s.sequenceNumber ?? "",
      partOfTerm: s.partOfTerm ?? "1",
      seatCapacity: s.crossListCapacity ?? s.maximumEnrollment ?? 0,
      seatsRemaining: s.crossListAvailable ?? s.seatsAvailable ?? 0,
      enrollment: s.crossListCount ?? s.enrollment ?? 0,
      waitlistCapacity: s.waitCapacity ?? 0,
      waitlistCount: s.waitCount ?? 0,
      waitlistRemaining: s.waitAvailable ?? 0,
      classType: decodeEntities(s.scheduleTypeDescription ?? "Lecture"),
      honors,
      campus: decodeEntities(s.campusDescription ?? ""),
      instructionMethod: s.instructionalMethodDescription ? decodeEntities(s.instructionalMethodDescription) : null,
      meetings,
      instructors: bannerInstructors.length === 0 ? (prior?.instructors ?? null) : bannerInstructors,
      crossListCRNs: crossList,
      attributes,
      description: prior?.description ?? null,
      prereqs: prior?.prereqs ?? null,
      coreqs: prior?.coreqs ?? null,
    };
  });
}

export function stubCourses(banner: BannerSection[]): { courses: Course[]; attributes: { code: string; name: string }[] } {
  const courses = new Map<string, Course>();
  const order: string[] = [];
  const attributes = new Map<string, string>();
  for (const s of banner) {
    const key = `${s.subject} ${s.courseNumber}`;
    const title = decodeEntities(decodeEntities(s.courseTitle ?? ""));
    const sectionAttributes = s.sectionAttributes ?? [];
    for (const a of sectionAttributes) {
      attributes.set(a.code, decodeEntities(a.description ?? a.code).trim());
    }
    const isTopics = sectionAttributes.some((a) => a.code === "TOPC");
    const existing = courses.get(key);
    if (existing) {
      const codes = new Set([...existing.attributes, ...sectionAttributes.map((a) => a.code).filter((c) => c !== HONORS_ATTRIBUTE)]);
      existing.attributes = [...codes].sort();
      if (!existing.specialTopics && isTopics) {
        existing.specialTopics = true;
        existing.title = "Special Topics";
      }
    } else {
      const special = title.toLowerCase().includes("special topics") || isTopics;
      const low = s.creditHourLow ?? s.creditHours ?? 0;
      const high = s.creditHourHigh ?? low;
      courses.set(key, {
        subject: s.subject,
        number: s.courseNumber,
        title: special ? "Special Topics" : title,
        description: "",
        minCredits: low,
        maxCredits: high,
        attributes: sectionAttributes.map((a) => a.code).filter((c) => c !== HONORS_ATTRIBUTE).sort(),
        postreqs: [],
        specialTopics: special,
        detailsLoaded: false,
      });
      order.push(key);
    }
  }
  return {
    courses: order.map((id) => courses.get(id)!),
    attributes: [...attributes.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/**
 * Merges a fresh section scrape into an existing catalog.
 * Seats, times and locations come from `fresh`. Descriptions and requisites are kept,
 * or borrowed from `knowledge` (courses known from another term).
 * Port of `CatalogBuilder.merge`.
 */
export function mergeCatalog(options: {
  existing?: TermCatalog | null;
  fresh: BannerSection[];
  term: Term;
  subjects?: Subject[] | null;
  campuses?: Campus[] | null;
  attributes?: AttributeInfo[] | null;
  knowledge?: ReadonlyMap<string, Course>;
  now?: number;
}): TermCatalog {
  const now = options.now ?? Date.now() / 1000;
  const existing = options.existing ?? null;
  const previousSections = new Map((existing?.sections ?? []).map((section) => [section.crn, section]));
  const previousCourses = new Map((existing?.courses ?? []).map((course) => [keyId(course), course]));
  const sections = sectionsFromBanner(options.fresh, previousSections);
  const { courses: stubs, attributes: freshAttributes } = stubCourses(options.fresh);
  const courses = stubs.map((stub) => {
    const id = keyId(stub);
    const known = previousCourses.get(id);
    if (known) {
      return {
        ...known,
        minCredits: stub.minCredits,
        maxCredits: stub.maxCredits,
        attributes: stub.attributes,
        specialTopics: known.specialTopics || stub.specialTopics,
      };
    }
    const borrowed = options.knowledge?.get(id);
    if (borrowed) {
      return {
        ...borrowed,
        minCredits: stub.minCredits,
        maxCredits: stub.maxCredits,
        attributes: stub.attributes,
        specialTopics: borrowed.specialTopics || stub.specialTopics,
        postreqs: [],
      };
    }
    return stub;
  });
  const mergedAttributes = new Map((existing?.attributes ?? []).map((attribute) => [attribute.code, attribute]));
  for (const attribute of [...(options.attributes ?? []), ...freshAttributes]) mergedAttributes.set(attribute.code, attribute);
  const catalog: TermCatalog = {
    version: existing?.version ?? 1,
    term: options.term,
    generatedAt: existing?.generatedAt ?? now,
    sectionsUpdatedAt: now,
    courses: [...courses].sort((a, b) => compareCourseKeys(a, b)),
    sections: [...sections].sort((a, b) => compareCourseKeys(a, b) || a.sectionNumber.localeCompare(b.sectionNumber)),
    subjects: options.subjects ?? existing?.subjects ?? [],
    attributes: [...mergedAttributes.values()].sort((a, b) => a.code.localeCompare(b.code)),
    campuses: options.campuses ?? existing?.campuses ?? [],
  };
  recomputePostreqs(catalog);
  return catalog;
}
