/**
 * Lookup structures for one term's catalog.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/CatalogIndex.swift.
 */

import { subjectLookup } from "./banner";
import type { Course, CourseKey, CourseSection, DaySet, Subject, TermCatalog } from "./models";
import {
  compareCourseKeys,
  courseKeyOf,
  instructorDisplayName,
  keyId,
  mapRequisiteCourses,
  meetingIsOnline,
  nupathsFromAttributes,
  numericValue,
  referencedCourses,
  recomputePostreqs,
  sameKey,
  sectionIsOnline,
  sectionIsOpen,
  sectionKey,
  weeklyMeetings,
} from "./models";
import { normalizeSearch, searchWords } from "./search";

export interface CourseStats {
  sectionCount: number;
  openSectionCount: number;
  seatsRemaining: number;
  seatCapacity: number;
  waitlistOpenCount: number;
  campuses: string[];
  classTypes: string[];
  hasHonors: boolean;
  hasOnline: boolean;
  hasInPerson: boolean;
  instructorNames: string[];
  meetingDays: DaySet;
}

export function emptyStats(): CourseStats {
  return {
    sectionCount: 0,
    openSectionCount: 0,
    seatsRemaining: 0,
    seatCapacity: 0,
    waitlistOpenCount: 0,
    campuses: [],
    classTypes: [],
    hasHonors: false,
    hasOnline: false,
    hasInPerson: false,
    instructorNames: [],
    meetingDays: 0,
  };
}

export function availabilityLabel(st: CourseStats): string {
  if (st.sectionCount === 0) return "No sections";
  if (st.sectionCount === 1) return st.openSectionCount === 1 ? "1 section · open" : "1 section · full";
  return `${st.openSectionCount} of ${st.sectionCount} sections open`;
}

export function makeStats(list: CourseSection[]): CourseStats {
  const st = emptyStats();
  const campuses = new Set<string>();
  const types = new Set<string>();
  const names: string[] = [];
  for (const s of list) {
    st.sectionCount++;
    if (sectionIsOpen(s)) st.openSectionCount++;
    st.seatsRemaining += Math.max(0, s.seatsRemaining);
    st.seatCapacity += s.seatCapacity;
    if (s.waitlistRemaining > 0) st.waitlistOpenCount++;
    if (s.campus) campuses.add(s.campus);
    types.add(s.classType);
    st.hasHonors = st.hasHonors || s.honors;
    if (sectionIsOnline(s)) st.hasOnline = true;
    else st.hasInPerson = true;
    for (const m of weeklyMeetings(s)) st.meetingDays |= m.days;
    const instructors = [...(s.instructors ?? [])].sort((a, b) => Number(b.primary) - Number(a.primary));
    for (const i of instructors) {
      const name = instructorDisplayName(i.name);
      if (!names.includes(name)) names.push(name);
    }
  }
  st.campuses = [...campuses];
  st.classTypes = [...types];
  st.instructorNames = names;
  return st;
}

export interface InstructorSummary {
  name: string;
  displayName: string;
  email?: string | null;
  crns: string[];
  courseKeys: CourseKey[];
}

export interface RoomBooking {
  crn: string;
  course: CourseKey;
  days: DaySet;
  start: number;
  end: number;
  startDate?: string | null;
  endDate?: string | null;
}

export interface RoomSchedule {
  buildingCode: string;
  buildingName: string;
  room: string;
  bookings: RoomBooking[];
  id: string;
  label: string;
}

export interface BuildingSummary {
  code: string;
  name: string;
  campusCode?: string | null;
  rooms: RoomSchedule[];
}

export interface SearchDocument {
  key: CourseKey;
  subjectLower: string;
  numberLower: string;
  titleNormalized: string;
  titleWords: string[];
  subjectWords: string[];
  instructorWords: string[];
  instructorNames: string[];
  descriptionWords: Set<string>;
  topicWords: string[];
  nupathShorts: Set<string>;
  level: number | null;
  numeric: number;
}

function makeDocument(course: Course, subjectName: string, stats: CourseStats | undefined, sections: CourseSection[]): SearchDocument {
  const titles = course.specialTopics ? [...new Set(sections.map((s) => s.title))] : [];
  const names = stats?.instructorNames ?? [];
  return {
    key: courseKeyOf(course),
    subjectLower: course.subject.toLowerCase(),
    numberLower: course.number.toLowerCase(),
    titleNormalized: normalizeSearch(course.title),
    titleWords: searchWords(course.title),
    subjectWords: searchWords(subjectName),
    instructorNames: names,
    instructorWords: names.flatMap(searchWords),
    descriptionWords: new Set(searchWords(course.description).filter((w) => w.length >= 3)),
    topicWords: titles.flatMap(searchWords),
    nupathShorts: new Set(nupathsFromAttributes(course.attributes).map((p) => p.short.toLowerCase())),
    level: course.number[0] && course.number[0] >= "0" && course.number[0] <= "9" ? Number(course.number[0]) : null,
    numeric: numericValue(courseKeyOf(course)),
  };
}

const TYPE_ORDER: Record<string, number> = { Lecture: 0, Lab: 1, "Recitation/Discussion": 2, Seminar: 3 };

export function sortedSections(list: CourseSection[]): CourseSection[] {
  return [...list].sort((a, b) => {
    const ao = TYPE_ORDER[a.classType] ?? 9;
    const bo = TYPE_ORDER[b.classType] ?? 9;
    if (ao !== bo) return ao - bo;
    if (a.classType !== b.classType) return a.classType < b.classType ? -1 : 1;
    return a.sectionNumber.localeCompare(b.sectionNumber, undefined, { numeric: true, sensitivity: "base" });
  });
}

function needsSubjectFix(course: Course): boolean {
  const check = (r: Course["prereqs"]) => referencedCourses(r ?? { and: [] }).some((k) => k.subject.includes(" ")) && !!r;
  return check(course.prereqs) || check(course.coreqs);
}

function normalizedCourse(course: Course, lookup: ReturnType<typeof subjectLookup>): Course {
  if (!needsSubjectFix(course)) return course;
  const normalized = (key: CourseKey) => (key.subject.includes(" ") ? { subject: lookup.code(key.subject), number: key.number } : key);
  return {
    ...course,
    prereqs: course.prereqs ? mapRequisiteCourses(course.prereqs, normalized) : course.prereqs,
    coreqs: course.coreqs ? mapRequisiteCourses(course.coreqs, normalized) : course.coreqs,
  };
}

export class CatalogIndex {
  readonly catalog: TermCatalog;
  readonly coursesByKey = new Map<string, Course>();
  readonly sectionsByCourse = new Map<string, CourseSection[]>();
  readonly sectionsByCRN = new Map<string, CourseSection>();
  readonly statsByKey = new Map<string, CourseStats>();
  readonly subjectsByCode = new Map<string, Subject>();
  readonly attributeNames = new Map<string, string>();
  readonly campusNames: string[];
  readonly classTypes: string[];
  readonly activeSubjects: Subject[];
  readonly courseCountBySubject = new Map<string, number>();
  readonly instructors: InstructorSummary[];
  readonly buildings: BuildingSummary[];
  readonly documents: SearchDocument[];
  readonly subjectCodes: Set<string>;

  private constructor(parts: {
    catalog: TermCatalog;
    campusNames: string[];
    classTypes: string[];
    activeSubjects: Subject[];
    instructors: InstructorSummary[];
    buildings: BuildingSummary[];
    documents: SearchDocument[];
  }) {
    this.catalog = parts.catalog;
    this.campusNames = parts.campusNames;
    this.classTypes = parts.classTypes;
    this.activeSubjects = parts.activeSubjects;
    this.instructors = parts.instructors;
    this.buildings = parts.buildings;
    this.documents = parts.documents;
    this.subjectCodes = new Set(parts.catalog.subjects.map((s) => s.code.toUpperCase()));
    for (const c of parts.catalog.courses) this.coursesByKey.set(keyId(courseKeyOf(c)), c);
    for (const s of parts.catalog.subjects) this.subjectsByCode.set(s.code, s);
    for (const a of parts.catalog.attributes) this.attributeNames.set(a.code, a.name);
  }

  get courses(): Course[] {
    return this.catalog.courses;
  }

  course(key: CourseKey): Course | undefined {
    return this.coursesByKey.get(keyId(key));
  }

  sectionsOf(key: CourseKey): CourseSection[] {
    return this.sectionsByCourse.get(keyId(key)) ?? [];
  }

  sectionByCRN(crn: string): CourseSection | undefined {
    return this.sectionsByCRN.get(crn);
  }

  stats(key: CourseKey): CourseStats {
    return this.statsByKey.get(keyId(key)) ?? emptyStats();
  }

  statsFrom(list: CourseSection[]): CourseStats {
    return makeStats(list);
  }

  coursesInSubject(code: string): Course[] {
    return this.catalog.courses.filter((c) => c.subject === code).sort((a, b) => compareCourseKeys(courseKeyOf(a), courseKeyOf(b)));
  }

  static build(input: TermCatalog): CatalogIndex {
    const catalog: TermCatalog = structuredClone(input);
    if (catalog.courses.some(needsSubjectFix)) {
      const lookup = subjectLookup(catalog.subjects);
      catalog.courses = catalog.courses.map((c) => normalizedCourse(c, lookup));
      recomputePostreqs(catalog);
    }
    const index = new CatalogIndex({
      catalog,
      campusNames: [],
      classTypes: [],
      activeSubjects: [],
      instructors: [],
      buildings: [],
      documents: [],
    });
    const campusCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const rooms = new Map<string, RoomSchedule>();
    const buildingNames = new Map<string, { name: string; campus?: string | null }>();

    for (const s of catalog.sections) {
      const id = keyId(sectionKey(s));
      const list = index.sectionsByCourse.get(id) ?? [];
      list.push(s);
      index.sectionsByCourse.set(id, list);
      index.sectionsByCRN.set(s.crn, s);
      if (s.campus) campusCounts.set(s.campus, (campusCounts.get(s.campus) ?? 0) + 1);
      typeCounts.set(s.classType, (typeCounts.get(s.classType) ?? 0) + 1);
      for (const m of weeklyMeetings(s)) {
        if (!m.buildingCode || !m.room || m.start == null || m.end == null || meetingIsOnline(m)) continue;
        const rid = `${m.buildingCode}|${m.room}`;
        const schedule =
          rooms.get(rid) ??
          ({
            buildingCode: m.buildingCode,
            buildingName: m.building || m.buildingCode,
            room: m.room,
            bookings: [],
            id: rid,
            label: `${m.buildingCode} ${m.room}`,
          } satisfies RoomSchedule);
        schedule.bookings.push({
          crn: s.crn,
          course: sectionKey(s),
          days: m.days,
          start: m.start,
          end: m.end,
          startDate: m.startDate,
          endDate: m.endDate,
        });
        rooms.set(rid, schedule);
        if (!buildingNames.has(m.buildingCode)) buildingNames.set(m.buildingCode, { name: m.building || m.buildingCode, campus: m.campusCode });
      }
    }
    for (const [id, list] of index.sectionsByCourse) {
      const sorted = sortedSections(list);
      index.sectionsByCourse.set(id, sorted);
      index.statsByKey.set(id, makeStats(sorted));
    }
    for (const c of catalog.courses) index.courseCountBySubject.set(c.subject, (index.courseCountBySubject.get(c.subject) ?? 0) + 1);
    const active = [...index.courseCountBySubject.keys()].sort().map((code) => index.subjectsByCode.get(code) ?? { code, name: code });
    const instructors = makeInstructors(catalog.sections);
    const byBuilding = new Map<string, RoomSchedule[]>();
    for (const room of rooms.values()) {
      const list = byBuilding.get(room.buildingCode) ?? [];
      list.push(room);
      byBuilding.set(room.buildingCode, list);
    }
    const buildings = [...byBuilding.entries()]
      .map(([code, list]) => ({
        code,
        name: buildingNames.get(code)?.name ?? code,
        campusCode: buildingNames.get(code)?.campus,
        rooms: list.sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const documents = catalog.courses.map((course) =>
      makeDocument(course, index.subjectsByCode.get(course.subject)?.name ?? "", index.stats(courseKeyOf(course)), index.sectionsOf(courseKeyOf(course))),
    );
    const campusNames = [...campusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .filter((name) => !name.toLowerCase().includes("no campus"));
    const classTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return Object.assign(index, { campusNames, classTypes, activeSubjects: active, instructors, buildings, documents });
  }

  replaceCourse(key: CourseKey, course: Course | null, sections: CourseSection[]): CatalogIndex {
    const catalog: TermCatalog = structuredClone(this.catalog);
    catalog.sections = catalog.sections.filter((s) => !sameKey(sectionKey(s), key));
    catalog.sections.push(...sections);
    if (course) {
      const i = catalog.courses.findIndex((c) => sameKey(courseKeyOf(c), key));
      if (i >= 0) catalog.courses[i] = course;
      else {
        catalog.courses.push(course);
        catalog.courses.sort((a, b) => compareCourseKeys(courseKeyOf(a), courseKeyOf(b)));
      }
    }
    return CatalogIndex.build(catalog);
  }
}

function makeInstructors(sections: CourseSection[]): InstructorSummary[] {
  const entries = new Map<string, InstructorSummary>();
  for (const s of sections) {
    for (const i of s.instructors ?? []) {
      const existing = entries.get(i.name) ?? {
        name: i.name,
        displayName: instructorDisplayName(i.name),
        email: i.email,
        crns: [],
        courseKeys: [],
      };
      existing.crns.push(s.crn);
      if (!existing.courseKeys.some((k) => sameKey(k, sectionKey(s)))) existing.courseKeys.push(sectionKey(s));
      if (!existing.email && i.email) existing.email = i.email;
      entries.set(i.name, existing);
    }
  }
  return [...entries.values()]
    .map((e) => ({ ...e, courseKeys: [...e.courseKeys].sort(compareCourseKeys) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

export function popularSubjects(index: CatalogIndex, limit = 8): Subject[] {
  return [...index.courseCountBySubject.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([code]) => index.subjectsByCode.get(code) ?? { code, name: code });
}
