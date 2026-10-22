/**
 * Server-side Banner client. The browser cannot call nubanner.neu.edu (no CORS).
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Endpoint usage follows SearchNEU's scraper and the Swift BannerClient.
 */

import path from "node:path";
import { catalogCodesContain, mergeCatalog, parseCatalogDetails, parseCorequisites, parseDescription, parseMutualExclusions, parsePrerequisites, sectionsFromBanner, subjectLookup, type BannerSection } from "./banner";
import { parseRestrictions } from "./restrictions";
import { listStoredTermCodes, loadBestCatalog, saveBuiltCatalog } from "./catalog-store";
import type { CourseInfo } from "./course-info";
import { OfferingHistory } from "./degree/reordering";
import { decodeEntities } from "./html";
import type { AttributeInfo, Campus, Course, CourseKey, CourseSection, Subject, Term, TermCatalog } from "./models";
import { HONORS_ATTRIBUTE, keyId, recomputePostreqs, termCollege } from "./models";
import { OfferingHistoryRepository, type OfferingIndex } from "./offering-history";

const BASE = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb/";

export class BannerHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "Northeastern's registration system is busy. Please try again shortly." : `Northeastern's registration system returned an error (HTTP ${status}).`);
  }
}

function endpoint(path: string, query?: Record<string, string>): string {
  const url = new URL(path, BASE);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

async function bannerFetch(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json, text/html;q=0.9, */*;q=0.8",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        last = new BannerHttpError(res.status);
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new BannerHttpError(res.status);
      return res;
    } catch (error) {
      last = error;
      if (error instanceof BannerHttpError && error.status < 500 && error.status !== 429) throw error;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Couldn't reach Northeastern's registration system.");
}

export async function fetchTerms(max = 40): Promise<Term[]> {
  const res = await bannerFetch(endpoint("classSearch/getTerms", { offset: "1", max: String(max), searchTerm: "" }));
  const terms = (await res.json()) as { code: string; description: string }[];
  return terms.map((t) => ({ code: t.code, bannerDescription: decodeEntities(t.description) }));
}

export async function fetchSubjects(term: string): Promise<{ code: string; name: string }[]> {
  const res = await bannerFetch(endpoint("classSearch/get_subject", { searchTerm: "", term, offset: "1", max: "900" }));
  const items = (await res.json()) as { code: string; description: string }[];
  return items.map((s) => ({ code: s.code, name: decodeEntities(s.description).trim() }));
}

async function openSession(term: string): Promise<string> {
  const body = new URLSearchParams({ term, studyPath: "", studyPathText: "", startDatepicker: "", endDatepicker: "" });
  const res = await bannerFetch(endpoint("term/search", { mode: "search" }), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const header = cookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!header) throw new Error("Couldn't start a search session with Northeastern's registration system.");
  return header;
}

async function searchPage(
  cookie: string,
  term: string,
  offset: number,
  pageSize: number,
  subject?: string,
  courseNumber?: string,
): Promise<{ totalCount: number; data: BannerSection[] }> {
  const query: Record<string, string> = {
    txt_term: term,
    pageOffset: String(offset),
    pageMaxSize: String(pageSize),
    sortColumn: "subjectDescription",
    sortDirection: "asc",
  };
  if (subject) query.txt_subject = subject;
  if (courseNumber) query.txt_courseNumber = courseNumber;
  const res = await bannerFetch(endpoint("searchResults/searchResults", query), { headers: { Cookie: cookie } });
  const page = (await res.json()) as { totalCount?: number; data?: BannerSection[] };
  return { totalCount: page.totalCount ?? 0, data: page.data ?? [] };
}

async function searchSections(cookie: string, term: string, subject?: string, courseNumber?: string): Promise<BannerSection[]> {
  return (await searchPage(cookie, term, 0, 500, subject, courseNumber)).data;
}

export async function fetchCampuses(term: string): Promise<Campus[]> {
  const res = await bannerFetch(endpoint("classSearch/get_campus", { searchTerm: "", term, offset: "1", max: "200" }));
  const items = (await res.json()) as { code: string; description: string }[];
  return items.map((item) => ({ code: item.code, name: decodeEntities(item.description).trim() }));
}

export async function fetchAttributes(term: string): Promise<AttributeInfo[]> {
  const res = await bannerFetch(endpoint("classSearch/get_attribute", { searchTerm: "", term, offset: "1", max: "500" }));
  const items = (await res.json()) as { code: string; description: string }[];
  return items.map((item) => ({ code: item.code, name: decodeEntities(item.description).trim() }));
}

/**
 * Every section in a term. Pages are fetched with a few independent sessions,
 * the same way SearchNEU and `BannerClient.fetchAllSections` do it.
 */
export async function fetchAllSections(term: string, parallelism = 4): Promise<BannerSection[]> {
  const pageSize = 500;
  const first = await openSession(term);
  const probe = await searchPage(first, term, 0, 1);
  const total = probe.totalCount;
  if (total <= 0) return [];
  const pageCount = Math.ceil(total / pageSize);
  const sessions = [first];
  const workers = Math.max(1, Math.min(parallelism, pageCount));
  for (let i = 1; i < workers; i++) sessions.push(await openSession(term));

  const pages: BannerSection[][] = new Array(pageCount);
  let nextPage = 0;
  async function worker(slot: number) {
    let cookie = sessions[slot]!;
    while (nextPage < pageCount) {
      const page = nextPage;
      nextPage += 1;
      const load = async (header: string) => searchPage(header, term, page * pageSize, pageSize);
      try {
        pages[page] = (await load(cookie)).data;
      } catch {
        cookie = await openSession(term);
        sessions[slot] = cookie;
        pages[page] = (await load(cookie)).data;
      }
    }
  }
  await Promise.all(sessions.map((_, slot) => worker(slot)));

  const seen = new Set<string>();
  const all: BannerSection[] = [];
  for (const page of pages) {
    for (const section of page ?? []) {
      if (!seen.has(section.courseReferenceNumber)) {
        seen.add(section.courseReferenceNumber);
        all.push(section);
      }
    }
  }
  return all;
}

const builds = new Map<string, Promise<TermCatalog>>();

/**
 * Downloads every section of a term. Descriptions already stored for this term are kept.
 * Pass `refreshDetails` to drop them so the next detail pass reads this term's catalog pages.
 * Other terms' descriptions are not copied in.
 */
export function buildTermCatalog(termCode: string, refreshDetails = false): Promise<TermCatalog> {
  const running = builds.get(termCode);
  if (running) return running;
  const job = buildTermCatalogOnce(termCode, refreshDetails).finally(() => {
    builds.delete(termCode);
  });
  builds.set(termCode, job);
  return job;
}

function clearCourseDetails(catalog: TermCatalog): TermCatalog {
  return {
    ...catalog,
    courses: catalog.courses.map((course) => ({
      ...course,
      description: "",
      prereqs: null,
      coreqs: null,
      postreqs: [],
      college: null,
      department: null,
      detailsLoaded: false,
    })),
    sections: catalog.sections.map((section) => ({ ...section, description: null, prereqs: null, coreqs: null, restrictions: null })),
  };
}

async function buildTermCatalogOnce(termCode: string, refreshDetails: boolean): Promise<TermCatalog> {
  const listed = await fetchTerms(80).catch(() => [] as Term[]);
  const term = listed.find((item) => item.code === termCode) ?? { code: termCode, bannerDescription: termCode };
  const [subjects, campuses, attributes] = await Promise.all([
    fetchSubjects(termCode).catch(() => null as Subject[] | null),
    fetchCampuses(termCode).catch(() => null as Campus[] | null),
    fetchAttributes(termCode).catch(() => null as AttributeInfo[] | null),
  ]);
  const sections = await fetchAllSections(termCode);
  const stored = await loadBestCatalog(termCode);
  const catalog = mergeCatalog({
    existing: refreshDetails && stored ? clearCourseDetails(stored) : stored,
    fresh: sections,
    term,
    subjects,
    campuses,
    attributes,
  });
  await saveBuiltCatalog(catalog);
  return catalog;
}

const DETAIL_BATCH = 24;
const detailQueues = new Map<string, Promise<unknown>>();

function enqueueDetail<T>(termCode: string, job: () => Promise<T>): Promise<T> {
  const previous = detailQueues.get(termCode) ?? Promise.resolve();
  const run = previous.then(job, job);
  detailQueues.set(
    termCode,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Description, requisites, and catalog title for one section, from this term's Banner pages. */
async function loadCourseDetailPatch(term: string, crn: string, lookup: ReturnType<typeof subjectLookup>, specialTopics: boolean): Promise<Partial<Course>> {
  const [descriptionHTML, prereqHTML, coreqHTML, detailsHTML] = await Promise.all([
    postForm("searchResults/getCourseDescription", term, crn).catch(() => ""),
    postForm("searchResults/getSectionPrerequisites", term, crn).catch(() => ""),
    postForm("searchResults/getCorequisites", term, crn).catch(() => ""),
    postForm("searchResults/getSectionCatalogDetails", term, crn).catch(() => ""),
  ]);
  const patch: Partial<Course> = { detailsLoaded: true, description: parseDescription(descriptionHTML) };
  patch.prereqs = parsePrerequisites(prereqHTML, lookup);
  patch.coreqs = parseCorequisites(coreqHTML, lookup);
  const details = parseCatalogDetails(detailsHTML);
  if (details.title && !specialTopics) patch.title = details.title;
  if (details.college) patch.college = details.college;
  if (details.department) patch.department = details.department;
  if (details.minCredits != null) patch.minCredits = details.minCredits;
  if (details.maxCredits != null) patch.maxCredits = details.maxCredits;
  return patch;
}

async function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/**
 * Reads this term's own course descriptions from Banner for courses that are still stubs.
 * One call covers a batch so the request stays short; call again until `remaining` is 0.
 */
export function fillTermCourseDetails(termCode: string, limit = DETAIL_BATCH): Promise<{ filled: number; remaining: number; catalog: TermCatalog } | null> {
  return enqueueDetail(termCode, () => fillTermCourseDetailsOnce(termCode, limit));
}

/** One restriction page at a time, with a short pause, so a detail batch does not hammer Banner. */
async function loadSectionRestrictions(term: string, sections: CourseSection[]): Promise<void> {
  for (const section of sections) {
    if (section.restrictions != null) continue;
    try {
      const html = await postForm("searchResults/getRestrictions", term, section.crn);
      section.restrictions = parseRestrictions(html);
    } catch {
      // Unknown stays hidden.
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

async function fillTermCourseDetailsOnce(termCode: string, limit: number): Promise<{ filled: number; remaining: number; catalog: TermCatalog } | null> {
  const source = await loadBestCatalog(termCode);
  if (!source) return null;
  const catalog: TermCatalog = {
    ...source,
    courses: source.courses.map((course) => ({ ...course, postreqs: [...course.postreqs] })),
    sections: source.sections.map((section) => ({ ...section, meetings: section.meetings.map((meeting) => ({ ...meeting })) })),
  };
  const pending = catalog.courses.filter((course) => !course.detailsLoaded);
  const batch = pending.slice(0, Math.max(1, limit));
  if (!batch.length) return { filled: 0, remaining: 0, catalog };
  const subjects = catalog.subjects.length ? catalog.subjects : await fetchSubjects(termCode).catch(() => [] as Subject[]);
  const lookup = subjectLookup(subjects);
  if (!catalog.subjects.length && subjects.length) catalog.subjects = subjects;
  await mapPool(batch, 4, async (course) => {
    const sections = catalog.sections.filter((section) => section.subject === course.subject && section.number === course.number);
    const crn = sections[0]?.crn;
    if (!crn) {
      course.detailsLoaded = true;
      return;
    }
    try {
      Object.assign(course, await loadCourseDetailPatch(termCode, crn, lookup, course.specialTopics));
      if (course.specialTopics) {
        for (const section of sections) {
          if (section.description != null) continue;
          const html = await postForm("searchResults/getCourseDescription", termCode, section.crn).catch(() => "");
          section.description = parseDescription(html);
        }
      }
      await loadSectionRestrictions(termCode, sections);
    } catch {
      course.detailsLoaded = true;
    }
  });
  recomputePostreqs(catalog);
  await saveBuiltCatalog(catalog);
  const remaining = catalog.courses.filter((course) => !course.detailsLoaded).length;
  return { filled: batch.length, remaining, catalog };
}

async function fetchOfferedCourses(term: string, courses: CourseKey[]): Promise<CourseKey[]> {
  if (!courses.length) return [];
  const cookie = await openSession(term);
  const offered: CourseKey[] = [];
  for (let i = 0; i < courses.length; i++) {
    if (i > 0) {
      await bannerFetch(endpoint("classSearch/resetDataForm"), { method: "POST", headers: { Cookie: cookie } });
    }
    const key = courses[i]!;
    const page = await searchPage(cookie, term, 0, 20, key.subject, key.number);
    if (page.data.some((section) => section.subject === key.subject && section.courseNumber === key.number)) offered.push(key);
  }
  return offered;
}

const subjectNames = new Map<string, { code: string; name: string }[]>();

async function subjectsFor(term: string): Promise<{ code: string; name: string }[]> {
  const cached = subjectNames.get(term);
  if (cached) return cached;
  const subjects = await fetchSubjects(term);
  subjectNames.set(term, subjects);
  return subjects;
}

async function postCourseForm(path: string, term: string, course: CourseKey): Promise<string> {
  const res = await bannerFetch(endpoint(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ term, subjectCode: course.subject, courseNumber: course.number }),
  });
  return res.text();
}

/** Whether `term`'s course catalog lists `course`. The typeahead needs no session cookie. */
export async function catalogLists(course: CourseKey, term: string): Promise<boolean> {
  const res = await bannerFetch(
    endpoint("courseSearch/get_subjectcoursecombo", {
      searchTerm: `${course.subject} ${course.number}`,
      term,
      offset: "1",
      max: "10",
    }),
  );
  const items = (await res.json()) as { code: string; description?: string }[];
  return catalogCodesContain(items, course);
}

/**
 * A course's catalog entry as of `term`: title, credits, prerequisites, corequisites, and
 * mutual exclusions. Null when that term's catalog does not list the course.
 */
export async function fetchCatalogEntry(course: CourseKey, term: string): Promise<CourseInfo | null> {
  if (!(await catalogLists(course, term))) return null;
  const [detailsHTML, prerequisitesHTML, corequisitesHTML, exclusionsHTML, subjects] = await Promise.all([
    postCourseForm("courseSearchResults/getCourseCatalogDetails", term, course),
    postCourseForm("courseSearchResults/getPrerequisites", term, course),
    postCourseForm("courseSearchResults/getCorequisites", term, course),
    postCourseForm("courseSearchResults/getCourseMutuallyExclusions", term, course),
    subjectsFor(term),
  ]);
  const lookup = subjectLookup(subjects);
  const details = parseCatalogDetails(detailsHTML);
  return {
    key: course,
    title: details.title ?? "",
    minCredits: details.minCredits ?? null,
    maxCredits: details.maxCredits ?? null,
    prerequisites: parsePrerequisites(prerequisitesHTML, lookup),
    corequisites: parseCorequisites(corequisitesHTML, lookup),
    equivalents: parseMutualExclusions(exclusionsHTML, lookup),
    sourceTerm: term,
    isRetired: null,
    fetchedAt: Date.now(),
  };
}

/** Attribute codes of courses that have sections in `term`. Courses with no sections are omitted. */
export async function fetchSectionAttributes(term: string, courses: CourseKey[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (!courses.length) return result;
  const cookie = await openSession(term);
  for (let i = 0; i < courses.length; i++) {
    if (i > 0) {
      await bannerFetch(endpoint("classSearch/resetDataForm"), { method: "POST", headers: { Cookie: cookie } });
    }
    const key = courses[i]!;
    const raw = (await searchSections(cookie, term, key.subject, key.number)).filter(
      (section) => section.subject === key.subject && section.courseNumber === key.number,
    );
    if (!raw.length) continue;
    const codes = new Set<string>();
    for (const section of raw) {
      for (const attribute of section.sectionAttributes ?? []) {
        if (attribute.code && attribute.code !== HONORS_ATTRIBUTE) codes.add(attribute.code);
      }
    }
    result.set(keyId(key), codes);
  }
  return result;
}

export const offeringRepository = new OfferingHistoryRepository({
  fetcher: {
    terms: () => fetchTerms(80),
    offeredCourses: fetchOfferedCourses,
  },
  filePath: path.join(process.cwd(), "data", "built", "offering-history.json"),
});

async function offeringIndexes(): Promise<OfferingIndex[]> {
  const indexes: OfferingIndex[] = [];
  for (const code of await listStoredTermCodes()) {
    const catalog = await loadBestCatalog(code);
    if (!catalog || termCollege(code) !== "neu") continue;
    const offered = new Set(catalog.sections.map((section) => `${section.subject} ${section.number}`));
    indexes.push({
      term: catalog.term,
      sectionsFor: (key) => (offered.has(keyId(key)) ? [key] : []),
    });
  }
  return indexes;
}

/** Offering history for a handful of courses, using stored catalogs before Banner. */
export async function offeringHistoryFor(keys: readonly CourseKey[]): Promise<OfferingHistory> {
  return offeringRepository.history(keys, await offeringIndexes());
}

async function postForm(path: string, term: string, crn: string): Promise<string> {
  const res = await bannerFetch(endpoint(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ term, courseReferenceNumber: crn }),
  });
  return res.text();
}

export interface LiveCourse {
  sections: CourseSection[];
  coursePatch: Partial<Course>;
}

const cache = new Map<string, { at: number; value: LiveCourse }>();

export async function refreshCourse(term: string, subject: string, number: string, subjects: { code: string; name: string }[]): Promise<LiveCourse> {
  const key = `${term}|${subject}|${number}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const cookie = await openSession(term);
  const raw = (await searchSections(cookie, term, subject, number)).filter((s) => s.subject === subject && s.courseNumber === number);
  const sections = sectionsFromBanner(raw);
  const lookup = subjectLookup(subjects);
  const crn = sections[0]?.crn;
  const patch: Partial<Course> = {};
  if (crn) {
    const [detail, facultyRes] = await Promise.all([
      loadCourseDetailPatch(term, crn, lookup, false),
      bannerFetch(endpoint("searchResults/getFacultyMeetingTimes", { term, courseReferenceNumber: crn }))
        .then((r) => r.json())
        .catch(() => null),
    ]);
    Object.assign(patch, detail);
    if (!patch.description) delete patch.description;
    const faculty = facultyRes as { fmt?: { faculty?: { displayName?: string; emailAddress?: string; primaryIndicator?: boolean }[] }[] } | null;
    if (faculty?.fmt) {
      const seen = new Set<string>();
      const instructors = faculty.fmt.flatMap((m) => m.faculty ?? []).flatMap((f) => {
        const name = f.displayName?.trim();
        if (!name || seen.has(name)) return [];
        seen.add(name);
        return [{ name: decodeEntities(decodeEntities(name)), primary: !!f.primaryIndicator, email: f.emailAddress ?? null }];
      });
      if (instructors.length) {
        for (const section of sections) {
          if (!section.instructors?.length) section.instructors = instructors;
        }
      }
    }
  }
  const value = { sections, coursePatch: patch };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function refreshCRNs(term: string, crns: string[]): Promise<CourseSection[]> {
  if (!crns.length) return [];
  const cookie = await openSession(term);
  const wanted = new Set(crns);
  // Banner has no CRN filter that is reliable across versions; search is by course when the caller groups them.
  // This helper searches the whole first page only when given courses via refreshCourse. For watchlist we search each subject.
  const res = await bannerFetch(
    endpoint("searchResults/searchResults", {
      txt_term: term,
      pageOffset: "0",
      pageMaxSize: "500",
      sortColumn: "subjectDescription",
      sortDirection: "asc",
    }),
    { headers: { Cookie: cookie } },
  );
  void res;
  void wanted;
  return [];
}

export async function refreshWatched(term: string, courses: { subject: string; number: string }[]): Promise<CourseSection[]> {
  if (!courses.length) return [];
  const cookie = await openSession(term);
  const all: CourseSection[] = [];
  for (let i = 0; i < courses.length; i++) {
    if (i > 0) {
      await bannerFetch(endpoint("classSearch/resetDataForm"), { method: "POST", headers: { Cookie: cookie } }).catch(() => undefined);
    }
    const course = courses[i]!;
    const raw = (await searchSections(cookie, term, course.subject, course.number)).filter(
      (s) => s.subject === course.subject && s.courseNumber === course.number,
    );
    all.push(...sectionsFromBanner(raw));
  }
  return all;
}
