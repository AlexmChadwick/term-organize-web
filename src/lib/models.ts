/**
 * Catalog and course models.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of NEUClassSearch/Core/Models (Course, CourseSection, Requisite, Term,
 * TermCatalog). Requisite trees follow SearchNEU's requisite types
 * (packages/scraper/src/types.ts), © Sandbox at Northeastern University and the
 * SearchNEU contributors, AGPL-3.0, modified for this app.
 *
 * CourseKey identity is `subject + " " + number`. Use `keyId` / `sameKey` in sets
 * and maps — object identity is not value identity.
 */

export interface CourseKey {
  subject: string;
  number: string;
}

export function courseKey(subject: string, number: string): CourseKey {
  return { subject, number };
}

export function keyId(key: CourseKey): string {
  return `${key.subject} ${key.number}`;
}

export function sameKey(a: CourseKey, b: CourseKey): boolean {
  return a.subject === b.subject && a.number === b.number;
}

export function parseCourseKey(input: string): CourseKey | null {
  const cleaned = input.toUpperCase().replace(/-/g, " ");
  let i = 0;
  while (i < cleaned.length && isLetter(cleaned[i]!)) i++;
  const letters = cleaned.slice(0, i);
  const rest = cleaned.slice(i).trim();
  if (!letters || !rest || ![...rest].every((c) => isLetter(c) || isDigit(c))) return null;
  return { subject: letters, number: rest };
}

export function courseLevel(key: CourseKey): number | null {
  const d = key.number[0];
  if (!d || !isDigit(d)) return null;
  return Number(d);
}

export function numericValue(key: CourseKey): number {
  let i = 0;
  while (i < key.number.length && isDigit(key.number[i]!)) i++;
  return i === 0 ? 0 : Number(key.number.slice(0, i));
}

export function compareCourseKeys(a: CourseKey, b: CourseKey): number {
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  const an = numericValue(a);
  const bn = numericValue(b);
  if (an !== bn) return an - bn;
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

export function keyLess(a: CourseKey, b: CourseKey): boolean {
  return compareCourseKeys(a, b) < 0;
}

export class CourseKeySet {
  private inner = new Set<string>();

  constructor(keys?: Iterable<CourseKey>) {
    if (keys) for (const k of keys) this.add(k);
  }

  get size(): number {
    return this.inner.size;
  }

  has(key: CourseKey): boolean {
    return this.inner.has(keyId(key));
  }

  add(key: CourseKey): this {
    this.inner.add(keyId(key));
    return this;
  }

  delete(key: CourseKey): boolean {
    return this.inner.delete(keyId(key));
  }

  union(other: Iterable<CourseKey>): this {
    for (const k of other) this.add(k);
    return this;
  }

  keys(): CourseKey[] {
    return [...this.inner].map(parseKeyId);
  }

  [Symbol.iterator](): IterableIterator<CourseKey> {
    return this.keys()[Symbol.iterator]();
  }
}

export function parseKeyId(id: string): CourseKey {
  const space = id.indexOf(" ");
  if (space < 0) return { subject: id, number: "" };
  return { subject: id.slice(0, space), number: id.slice(space + 1) };
}

export function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

export function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

// MARK: - Days

/** Bit 0 Sunday … bit 6 Saturday. */
export type DaySet = number;

export const Day = {
  sunday: 1 << 0,
  monday: 1 << 1,
  tuesday: 1 << 2,
  wednesday: 1 << 3,
  thursday: 1 << 4,
  friday: 1 << 5,
  saturday: 1 << 6,
  weekdays: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5),
  all: 0x7f,
} as const;

export const DAY_LETTERS = ["U", "M", "T", "W", "R", "F", "S"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function dayMask(indices: Iterable<number>): DaySet {
  let raw = 0;
  for (const i of indices) if (i >= 0 && i <= 6) raw |= 1 << i;
  return raw & 0x7f;
}

export function dayIndices(days: DaySet): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 6; i++) if (days & (1 << i)) out.push(i);
  return out;
}

export function dayCount(days: DaySet): number {
  let n = 0;
  let v = days & 0x7f;
  while (v) {
    n += v & 1;
    v >>= 1;
  }
  return n;
}

export function dayHas(days: DaySet, index: number): boolean {
  return index >= 0 && index <= 6 && (days & (1 << index)) !== 0;
}

export function daysIntersect(a: DaySet, b: DaySet): boolean {
  return (a & b & 0x7f) !== 0;
}

export function daysDisjoint(a: DaySet, b: DaySet): boolean {
  return !daysIntersect(a, b);
}

export function dayIsSubset(a: DaySet, b: DaySet): boolean {
  return (a & ~b & 0x7f) === 0;
}

export function dayCompactLabel(days: DaySet): string {
  return dayIndices(days).map((i) => DAY_LETTERS[i]).join("");
}

export function dayShortLabel(days: DaySet): string {
  return dayIndices(days).map((i) => DAY_SHORT[i]).join(", ");
}

export function parseDayName(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  const table: Record<string, number> = {
    u: 0, su: 0, sun: 0, sunday: 0,
    m: 1, mo: 1, mon: 1, monday: 1,
    t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2,
    w: 3, we: 3, wed: 3, wednesday: 3,
    r: 4, th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
    f: 5, fr: 5, fri: 5, friday: 5,
    s: 6, sa: 6, sat: 6, saturday: 6,
  };
  return table[w] ?? null;
}

// MARK: - Time

export function minutesFromHHMM(value: number): number {
  return Math.floor(value / 100) * 60 + (value % 100);
}

export function hhmmFromMinutes(minutes: number): number {
  return Math.floor(minutes / 60) * 100 + (minutes % 60);
}

export function timeLabel(minutes: number, includePeriod = true): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 12 ? "AM" : "PM";
  const base = `${h12}:${String(m).padStart(2, "0")}`;
  return includePeriod ? `${base} ${period}` : base;
}

/** `10:30 – 11:35 AM` (en dash). */
export function rangeLabel(start: number, end: number): string {
  const samePeriod = start / 60 < 12 === end / 60 < 12;
  return `${timeLabel(start, !samePeriod)} – ${timeLabel(end)}`;
}

export function hourAxisLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 || hour === 24 ? "a" : "p"}`;
}

export function creditNumber(value: number): string {
  return value % 1 === 0 ? String(Math.trunc(value)) : value.toFixed(1);
}

export function creditsLabel(min: number, max: number): string {
  const text = min === max ? creditNumber(min) : `${creditNumber(min)}–${creditNumber(max)}`;
  return `${text} ${max === 1 && min === 1 ? "credit" : "credits"}`;
}

// MARK: - Requisites

export type Requisite =
  | { s: string; n: string }
  | { test: string; score?: number | null }
  | { and: Requisite[] }
  | { or: Requisite[] };

export function reqCourse(key: CourseKey): Requisite {
  return { s: key.subject, n: key.number };
}

export function reqTest(name: string, score?: number | null): Requisite {
  return score == null ? { test: name } : { test: name, score };
}

export function reqAnd(items: Requisite[]): Requisite {
  return { and: items };
}

export function reqOr(items: Requisite[]): Requisite {
  return { or: items };
}

export function isReqCourse(r: Requisite): r is { s: string; n: string } {
  return "s" in r && "n" in r;
}

export function isReqTest(r: Requisite): r is { test: string; score?: number | null } {
  return "test" in r;
}

export function isReqAnd(r: Requisite): r is { and: Requisite[] } {
  return "and" in r;
}

export function isReqOr(r: Requisite): r is { or: Requisite[] } {
  return "or" in r;
}

export function isReqCondition(r: Requisite): boolean {
  return isReqAnd(r) || isReqOr(r);
}

export function reqKey(r: { s: string; n: string }): CourseKey {
  return { subject: r.s, number: r.n };
}

export function referencedCourses(r: Requisite): CourseKey[] {
  const seen = new Set<string>();
  const out: CourseKey[] = [];
  const visit = (node: Requisite) => {
    if (isReqCourse(node)) {
      const id = keyId(reqKey(node));
      if (!seen.has(id)) {
        seen.add(id);
        out.push(reqKey(node));
      }
    } else if (isReqAnd(node)) node.and.forEach(visit);
    else if (isReqOr(node)) node.or.forEach(visit);
  };
  visit(r);
  return out;
}

export function requisiteSatisfied(
  r: Requisite,
  completed: Set<string> | CourseKeySet,
  assumeTestsMet = false,
): boolean {
  const has = (key: CourseKey) =>
    completed instanceof CourseKeySet ? completed.has(key) : completed.has(keyId(key));
  if (isReqCourse(r)) return has(reqKey(r));
  if (isReqTest(r)) return assumeTestsMet;
  if (isReqAnd(r)) return r.and.every((item) => requisiteSatisfied(item, completed, assumeTestsMet));
  if (isReqOr(r)) return r.or.some((item) => requisiteSatisfied(item, completed, assumeTestsMet));
  return false;
}

export function mapRequisiteCourses(r: Requisite, transform: (key: CourseKey) => CourseKey): Requisite {
  if (isReqCourse(r)) {
    const k = transform(reqKey(r));
    return reqCourse(k);
  }
  if (isReqTest(r)) return r;
  if (isReqAnd(r)) return { and: r.and.map((c) => mapRequisiteCourses(c, transform)) };
  if (isReqOr(r)) return { or: r.or.map((c) => mapRequisiteCourses(c, transform)) };
  return r;
}

export function simplifyRequisite(r: Requisite): Requisite | null {
  if (isReqCourse(r) || isReqTest(r)) return r;
  if (isReqAnd(r)) {
    const flat = r.and.flatMap((child) => {
      const s = simplifyRequisite(child);
      if (!s) return [];
      return isReqAnd(s) ? s.and : [s];
    });
    if (flat.length === 0) return null;
    return flat.length === 1 ? flat[0]! : { and: flat };
  }
  if (isReqOr(r)) {
    const flat = r.or.flatMap((child) => {
      const s = simplifyRequisite(child);
      if (!s) return [];
      return isReqOr(s) ? s.or : [s];
    });
    if (flat.length === 0) return null;
    return flat.length === 1 ? flat[0]! : { or: flat };
  }
  return r;
}

function formatScore(score: number): string {
  if (Number.isInteger(score)) return String(score);
  return String(score);
}

export function requisiteSummary(r: Requisite): string {
  if (isReqCourse(r)) return keyId(reqKey(r));
  if (isReqTest(r)) return r.score == null ? r.test : `${r.test} (${formatScore(r.score)})`;
  if (isReqAnd(r)) {
    return r.and.map((c) => (isReqCondition(c) ? `(${requisiteSummary(c)})` : requisiteSummary(c))).join(" and ");
  }
  if (isReqOr(r)) {
    return r.or.map((c) => (isReqCondition(c) ? `(${requisiteSummary(c)})` : requisiteSummary(c))).join(" or ");
  }
  return "";
}

export function requisitesEqual(a: Requisite | null | undefined, b: Requisite | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

// MARK: - Courses and sections

export interface Course {
  subject: string;
  number: string;
  title: string;
  description: string;
  minCredits: number;
  maxCredits: number;
  attributes: string[];
  prereqs?: Requisite | null;
  coreqs?: Requisite | null;
  postreqs: CourseKey[];
  specialTopics: boolean;
  college?: string | null;
  department?: string | null;
  detailsLoaded: boolean;
}

export function courseKeyOf(course: Pick<Course, "subject" | "number">): CourseKey {
  return { subject: course.subject, number: course.number };
}

export const HONORS_ATTRIBUTE = "GNHN";

export interface NuPathInfo {
  code: string;
  short: string;
  name: string;
  symbol: string;
}

export const NU_PATHS: readonly NuPathInfo[] = [
  { code: "NCND", short: "ND", name: "Natural & Designed World", symbol: "leaf" },
  { code: "NCEI", short: "EI", name: "Creative Expression & Innovation", symbol: "palette" },
  { code: "NCIC", short: "IC", name: "Interpreting Culture", symbol: "drama" },
  { code: "NCFQ", short: "FQ", name: "Formal & Quantitative Reasoning", symbol: "function" },
  { code: "NCSI", short: "SI", name: "Societies & Institutions", symbol: "landmark" },
  { code: "NCAD", short: "AD", name: "Analyzing & Using Data", symbol: "chart" },
  { code: "NCDD", short: "DD", name: "Difference & Diversity", symbol: "users" },
  { code: "NCER", short: "ER", name: "Ethical Reasoning", symbol: "scale" },
  { code: "NCW1", short: "WF", name: "First-Year Writing", symbol: "pencil" },
  { code: "NCWI", short: "WI", name: "Writing Intensive", symbol: "file-text" },
  { code: "NCW3", short: "WD", name: "Advanced Writing in the Disciplines", symbol: "book" },
  { code: "NCEX", short: "EX", name: "Integration Experience", symbol: "footprints" },
  { code: "NCCE", short: "CE", name: "Capstone Experience", symbol: "graduation-cap" },
] as const;

/** The eight NUpath areas a course may count toward (writing and experiences are separate). */
export const NUPATH_AREAS = ["ND", "EI", "IC", "FQ", "SI", "AD", "DD", "ER"] as const;

export function nupathsFromAttributes(codes: string[]): NuPathInfo[] {
  const set = new Set(codes);
  return NU_PATHS.filter((p) => set.has(p.code));
}

export function nupathFromShort(short: string): NuPathInfo | undefined {
  return NU_PATHS.find((p) => p.short.toLowerCase() === short.toLowerCase());
}

export interface Subject {
  code: string;
  name: string;
}

export interface AttributeInfo {
  code: string;
  name: string;
}

export interface Campus {
  code: string;
  name: string;
}

export interface Meeting {
  days: DaySet;
  start?: number | null;
  end?: number | null;
  buildingCode?: string | null;
  building?: string | null;
  room?: string | null;
  campusCode?: string | null;
  kind: string;
  startDate?: string | null;
  endDate?: string | null;
}

export function isFinalExam(m: Meeting): boolean {
  return m.kind.toLowerCase().includes("final");
}

export function meetingHasTime(m: Meeting): boolean {
  return m.start != null && m.end != null && m.days !== 0;
}

export function meetingTimeLabel(m: Meeting): string {
  if (m.start == null || m.end == null) return "Time TBA";
  return rangeLabel(m.start, m.end);
}

export function meetingLocation(m: Meeting): string {
  const b = m.buildingCode || m.building;
  if (b && m.room) return `${b} ${m.room}`;
  if (b) return b;
  return "Location TBA";
}

export function meetingLongLocation(m: Meeting): string {
  const b = m.building || m.buildingCode;
  if (b && m.room) return `${b} ${m.room}`;
  if (b) return b;
  return "Location TBA";
}

export function meetingIsOnline(m: Meeting): boolean {
  const b = `${m.building ?? ""}${m.buildingCode ?? ""}`;
  return b.toLowerCase().includes("online") || m.campusCode === "VTL";
}

export function dateWindowsOverlap(
  aStart?: string | null,
  aEnd?: string | null,
  bStart?: string | null,
  bEnd?: string | null,
): boolean {
  return (aStart ?? "0000-00-00") <= (bEnd ?? "9999-99-99") && (bStart ?? "0000-00-00") <= (aEnd ?? "9999-99-99");
}

export function meetingOverlaps(a: Meeting, b: Meeting): boolean {
  if (a.start == null || a.end == null || b.start == null || b.end == null) return false;
  if (!daysIntersect(a.days, b.days) || !(a.start < b.end && b.start < a.end)) return false;
  return dateWindowsOverlap(a.startDate, a.endDate, b.startDate, b.endDate);
}

export interface Instructor {
  name: string;
  primary: boolean;
  email?: string | null;
}

export function instructorDisplayName(raw: string): string {
  const parts = raw.split(",", 2).map((p) => p.trim());
  if (parts.length !== 2 || !parts[1]) return raw.trim();
  return `${parts[1]} ${parts[0]}`;
}

export interface CourseSection {
  crn: string;
  subject: string;
  number: string;
  title: string;
  sectionNumber: string;
  partOfTerm: string;
  seatCapacity: number;
  seatsRemaining: number;
  enrollment: number;
  waitlistCapacity: number;
  waitlistCount: number;
  waitlistRemaining: number;
  classType: string;
  honors: boolean;
  campus: string;
  instructionMethod?: string | null;
  meetings: Meeting[];
  instructors?: Instructor[] | null;
  crossListCRNs: string[];
  attributes: string[];
  description?: string | null;
  prereqs?: Requisite | null;
  coreqs?: Requisite | null;
}

export function sectionKey(s: Pick<CourseSection, "subject" | "number">): CourseKey {
  return { subject: s.subject, number: s.number };
}

export function sectionIsOpen(s: CourseSection): boolean {
  return s.seatsRemaining > 0;
}

export function sectionIsOnline(s: CourseSection): boolean {
  return (
    s.campus.toLowerCase().includes("online") ||
    (s.instructionMethod?.toLowerCase().includes("online") ?? false)
  );
}

export function weeklyMeetings(s: CourseSection): Meeting[] {
  return s.meetings.filter((m) => !isFinalExam(m) && meetingHasTime(m));
}

export function finalExam(s: CourseSection): Meeting | undefined {
  return s.meetings.find(isFinalExam);
}

export function meetingDays(s: CourseSection): DaySet {
  return weeklyMeetings(s).reduce((acc, m) => acc | m.days, 0);
}

export function instructorLabel(s: CourseSection): string {
  if (s.instructors == null) return "Instructor unavailable";
  if (s.instructors.length === 0) return "TBA";
  return [...s.instructors]
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .map((i) => instructorDisplayName(i.name))
    .join(", ");
}

export function scheduleSummary(s: CourseSection): string {
  const weekly = weeklyMeetings(s);
  if (weekly.length === 0) return sectionIsOnline(s) ? "Asynchronous / online" : "Times TBA";
  return weekly.map((m) => `${dayCompactLabel(m.days)} ${meetingTimeLabel(m)}`).join(" · ");
}

export function seatsLabel(s: CourseSection): string {
  return `${Math.max(0, s.seatsRemaining)} of ${s.seatCapacity} seats`;
}

export function sectionsConflict(a: CourseSection, b: CourseSection): boolean {
  const mine = weeklyMeetings(a);
  const theirs = weeklyMeetings(b);
  return mine.some((m) => theirs.some((o) => meetingOverlaps(m, o)));
}

export function seatTone(remaining: number, capacity: number): "open" | "low" | "full" {
  if (remaining <= 0) return "full";
  if (capacity <= 0) return "open";
  const fraction = remaining / capacity;
  return fraction <= 0.1 || remaining <= 2 ? "low" : "open";
}

// MARK: - Term

export type College = "neu" | "cps" | "law";

export interface Term {
  code: string;
  bannerDescription: string;
}

export type Season = "fall" | "winter" | "spring" | "summer1" | "summerFull" | "summer2";

export function termCollege(code: string): College {
  const last = code.at(-1);
  if (last === "4" || last === "5") return "cps";
  if (last === "2" || last === "8") return "law";
  return "neu";
}

export function termSeason(code: string): Season {
  if (code.length !== 6) return "fall";
  switch (code[4]) {
    case "1":
      return "fall";
    case "2":
      return "winter";
    case "3":
      return "spring";
    case "4":
      return "summer1";
    case "6":
      return "summer2";
    default:
      return "summerFull";
  }
}

export function termCalendarYear(code: string): number {
  const year = Number(code.slice(0, 4)) || 0;
  return termSeason(code) === "fall" ? year - 1 : year;
}

const SEASON_LABEL: Record<Season, string> = {
  fall: "Fall",
  winter: "Winter",
  spring: "Spring",
  summer1: "Summer 1",
  summerFull: "Summer",
  summer2: "Summer 2",
};

/** `Spring 2025`, `Summer 1 2025`, `Fall 2024`. Port of `OfferingHistory.label(ofTerm:)`. */
export function offeringTermLabel(code: string): string {
  return `${SEASON_LABEL[termSeason(code)]} ${termCalendarYear(code)}`;
}

/** UTC milliseconds for a wall-clock time in America/New_York. */
export function newYorkEpochMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  let y = pick("year");
  let m = pick("month");
  let d = pick("day");
  let h = pick("hour");
  const min = pick("minute");
  const sec = pick("second");
  if (h === 24) {
    h = 0;
    const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  const asUtc = Date.UTC(y, m - 1, d, h, min, sec);
  return guess - (asUtc - guess);
}

/**
 * Approximate first and last moments of classes, inclusive, in campus time.
 * Port of `TermCalendar.approximateWindow`.
 */
export function termApproximateWindow(termCode: string): { start: number; end: number } | null {
  if (!/^\d{6}$/.test(termCode)) return null;
  const year = termCalendarYear(termCode);
  const bounds: Record<Season, [[number, number], [number, number]]> = {
    fall: [[9, 1], [12, 23]],
    winter: [[1, 1], [3, 31]],
    spring: [[1, 3], [4, 30]],
    summer1: [[5, 1], [6, 30]],
    summerFull: [[5, 1], [8, 20]],
    summer2: [[6, 25], [8, 20]],
  };
  const [start, end] = bounds[termSeason(termCode)];
  const first = newYorkEpochMs(year, start[0], start[1]);
  const lastDay = newYorkEpochMs(year, end[0], end[1]);
  return { start: first, end: lastDay + 86_400_000 - 1000 };
}

/** Higher sectionsUpdatedAt wins; equal times keep the catalog with more loaded details. */
export function catalogIsNewer(candidate: TermCatalog, baseline: TermCatalog): boolean {
  const candidateDetails = candidate.courses.filter((course) => course.detailsLoaded).length;
  const baselineDetails = baseline.courses.filter((course) => course.detailsLoaded).length;
  const candidateAt = candidate.sectionsUpdatedAt ?? 0;
  const baselineAt = baseline.sectionsUpdatedAt ?? 0;
  return candidateAt > baselineAt || (candidateAt === baselineAt && candidateDetails > baselineDetails);
}

export function termIsViewOnly(term: Term): boolean {
  return term.bannerDescription.toLowerCase().includes("view only");
}

export function termName(term: Term): string {
  let s = term.bannerDescription.replace("(View Only)", "").trim();
  const college = termCollege(term.code);
  if (college === "neu") s = s.replace(" Semester", "");
  else {
    for (const marker of [" CPS ", " Law "]) {
      const i = s.indexOf(marker);
      if (i >= 0) {
        const head = s.slice(0, i);
        const tail = s.slice(i).trim();
        s = `${head} · ${tail}`;
        break;
      }
    }
  }
  return s.trim();
}

export function termShortName(term: Term): string {
  return termName(term).split(" · ")[0] ?? termName(term);
}

export interface TermCatalog {
  version: number;
  term: Term;
  generatedAt: number;
  sectionsUpdatedAt: number;
  courses: Course[];
  sections: CourseSection[];
  subjects: Subject[];
  attributes: AttributeInfo[];
  campuses: Campus[];
}

export function recomputePostreqs(catalog: TermCatalog): void {
  const map = new Map<string, CourseKey[]>();
  const push = (target: CourseKey, from: CourseKey) => {
    const id = keyId(target);
    const list = map.get(id) ?? [];
    if (!list.some((k) => sameKey(k, from))) list.push(from);
    map.set(id, list);
  };
  for (const course of catalog.courses) {
    if (!course.prereqs) continue;
    for (const key of referencedCourses(course.prereqs)) push(key, courseKeyOf(course));
  }
  for (const course of catalog.courses) {
    const list = map.get(keyId(courseKeyOf(course))) ?? [];
    course.postreqs = [...list].sort(compareCourseKeys);
  }
}

// MARK: - Course colors (Shared/CourseColor.swift)

export const COURSE_PALETTE = [
  { name: "blue", fill: "rgba(0,122,255,0.18)", stroke: "#007AFF", text: "#007AFF" },
  { name: "orange", fill: "rgba(255,149,0,0.18)", stroke: "#FF9500", text: "#C93400" },
  { name: "green", fill: "rgba(52,199,89,0.18)", stroke: "#34C759", text: "#248A3D" },
  { name: "purple", fill: "rgba(175,82,222,0.18)", stroke: "#AF52DE", text: "#8944AB" },
  { name: "pink", fill: "rgba(255,45,85,0.18)", stroke: "#FF2D55", text: "#D30F45" },
  { name: "teal", fill: "rgba(90,200,250,0.22)", stroke: "#32ADE6", text: "#0071A4" },
  { name: "indigo", fill: "rgba(88,86,214,0.18)", stroke: "#5856D6", text: "#3634A3" },
  { name: "brown", fill: "rgba(162,132,94,0.22)", stroke: "#A2845E", text: "#7A5C38" },
  { name: "mint", fill: "rgba(0,199,190,0.18)", stroke: "#00C7BE", text: "#0A7A74" },
  { name: "red", fill: "rgba(255,59,48,0.16)", stroke: "#FF3B30", text: "#D70015" },
] as const;

export function courseColorAt(index: number) {
  const n = COURSE_PALETTE.length;
  return COURSE_PALETTE[((index % n) + n) % n]!;
}

const HASH64 = (1n << 64n) - 1n;

/**
 * Stable palette index for a course code. Matches `CourseColor.forCode` in the iOS app:
 * a wrapping 64-bit djb2 over UTF-8 bytes, then modulo the palette length.
 */
export function courseColorIndex(code: string): number {
  let hash = 5381n;
  for (const byte of new TextEncoder().encode(code)) {
    hash = (hash * 33n + BigInt(byte)) & HASH64;
  }
  return Number(hash % BigInt(COURSE_PALETTE.length));
}

export function courseColorForCode(code: string) {
  return courseColorAt(courseColorIndex(code));
}

/**
 * One palette slot per course. Each course keeps its `courseColorIndex` unless another
 * course in the list already took it, matching `ProfessorPage.courseColors`.
 */
export function distinctCourseColorIndexes(keys: readonly CourseKey[]): Map<string, number> {
  const used = new Set<number>();
  const colors = new Map<string, number>();
  const count = COURSE_PALETTE.length;
  for (const key of keys) {
    let slot = courseColorIndex(keyId(key));
    if (used.size < count) {
      while (used.has(slot)) slot = (slot + 1) % count;
    }
    used.add(slot);
    colors.set(keyId(key), slot);
  }
  return colors;
}

// MARK: - Search filters

export type SearchSort = "relevance" | "courseNumber" | "title" | "openSeats";
export type InstructionFilter = "any" | "inPerson" | "online";

export interface SearchFilters {
  subjects: string[];
  nupaths: string[];
  levels: number[];
  minCredits?: number | null;
  maxCredits?: number | null;
  campuses: string[];
  classTypes: string[];
  honorsOnly: boolean;
  openSeatsOnly: boolean;
  instruction: InstructionFilter;
  allowedDays?: DaySet | null;
  startsAfter?: number | null;
  endsBefore?: number | null;
}

export function emptySearchFilters(): SearchFilters {
  return {
    subjects: [],
    nupaths: [],
    levels: [],
    campuses: [],
    classTypes: [],
    honorsOnly: false,
    openSeatsOnly: false,
    instruction: "any",
  };
}

export function searchFilterCount(f: SearchFilters): number {
  let n = 0;
  if (f.subjects.length) n++;
  if (f.nupaths.length) n++;
  if (f.levels.length) n++;
  if (f.minCredits != null || f.maxCredits != null) n++;
  if (f.campuses.length) n++;
  if (f.classTypes.length) n++;
  if (f.honorsOnly) n++;
  if (f.openSeatsOnly) n++;
  if (f.instruction !== "any") n++;
  if (f.allowedDays != null) n++;
  if (f.startsAfter != null || f.endsBefore != null) n++;
  return n;
}

export function hasSectionFilters(f: SearchFilters): boolean {
  return (
    f.campuses.length > 0 ||
    f.classTypes.length > 0 ||
    f.honorsOnly ||
    f.openSeatsOnly ||
    f.instruction !== "any" ||
    f.allowedDays != null ||
    f.startsAfter != null ||
    f.endsBefore != null
  );
}

export function courseMatchesFilters(course: Course, f: SearchFilters): boolean {
  if (f.subjects.length && !f.subjects.includes(course.subject)) return false;
  if (f.nupaths.length) {
    const attrs = new Set(course.attributes);
    if (!f.nupaths.every((code) => attrs.has(code))) return false;
  }
  if (f.levels.length) {
    const level = courseLevel(courseKeyOf(course));
    if (level == null || !f.levels.includes(level)) return false;
  }
  if (f.minCredits != null && course.maxCredits < f.minCredits) return false;
  if (f.maxCredits != null && course.minCredits > f.maxCredits) return false;
  return true;
}

export function sectionMatchesFilters(s: CourseSection, f: SearchFilters): boolean {
  if (f.campuses.length && !f.campuses.includes(s.campus)) return false;
  if (f.classTypes.length && !f.classTypes.includes(s.classType)) return false;
  if (f.honorsOnly && !s.honors) return false;
  if (f.openSeatsOnly && !sectionIsOpen(s)) return false;
  if (f.instruction === "online" && !sectionIsOnline(s)) return false;
  if (f.instruction === "inPerson" && sectionIsOnline(s)) return false;
  const weekly = weeklyMeetings(s);
  if (f.allowedDays != null) {
    for (const m of weekly) if (!dayIsSubset(m.days, f.allowedDays)) return false;
  }
  if (f.startsAfter != null) {
    for (const m of weekly) if ((m.start ?? 0) < f.startsAfter) return false;
  }
  if (f.endsBefore != null) {
    for (const m of weekly) if ((m.end ?? 0) > f.endsBefore) return false;
  }
  return true;
}

export interface ScheduleFilters {
  earliestStart?: number | null;
  latestEnd?: number | null;
  freeDays: DaySet;
  includeHonors: boolean;
  includeOnline: boolean;
  hideFullSections: boolean;
  minSeats: number;
  campus?: string | null;
  courseCount?: number | null;
}

export function emptyScheduleFilters(): ScheduleFilters {
  return {
    freeDays: 0,
    includeHonors: true,
    includeOnline: true,
    hideFullSections: false,
    minSeats: 0,
  };
}
