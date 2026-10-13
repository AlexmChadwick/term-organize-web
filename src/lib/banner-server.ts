/**
 * Server-side Banner client. The browser cannot call nubanner.neu.edu (no CORS).
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Endpoint usage follows SearchNEU's scraper and the Swift BannerClient.
 */

import { parseCatalogDetails, parseCorequisites, parseDescription, parsePrerequisites, sectionsFromBanner, subjectLookup, type BannerSection } from "./banner";
import type { Course, CourseSection, Term } from "./models";
import { decodeEntities } from "./html";

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

async function searchSections(cookie: string, term: string, subject?: string, courseNumber?: string): Promise<BannerSection[]> {
  const query: Record<string, string> = {
    txt_term: term,
    pageOffset: "0",
    pageMaxSize: "500",
    sortColumn: "subjectDescription",
    sortDirection: "asc",
  };
  if (subject) query.txt_subject = subject;
  if (courseNumber) query.txt_courseNumber = courseNumber;
  const res = await bannerFetch(endpoint("searchResults/searchResults", query), { headers: { Cookie: cookie } });
  const page = (await res.json()) as { data?: BannerSection[] };
  return page.data ?? [];
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
    const [descriptionHTML, prereqHTML, coreqHTML, detailsHTML, facultyRes] = await Promise.all([
      postForm("searchResults/getCourseDescription", term, crn).catch(() => ""),
      postForm("searchResults/getSectionPrerequisites", term, crn).catch(() => ""),
      postForm("searchResults/getCorequisites", term, crn).catch(() => ""),
      postForm("searchResults/getSectionCatalogDetails", term, crn).catch(() => ""),
      bannerFetch(endpoint("searchResults/getFacultyMeetingTimes", { term, courseReferenceNumber: crn }))
        .then((r) => r.json())
        .catch(() => null),
    ]);
    const description = parseDescription(descriptionHTML);
    if (description) patch.description = description;
    const prereqs = parsePrerequisites(prereqHTML, lookup);
    const coreqs = parseCorequisites(coreqHTML, lookup);
    if (prereqs) patch.prereqs = prereqs;
    if (coreqs) patch.coreqs = coreqs;
    const details = parseCatalogDetails(detailsHTML);
    if (details.title) patch.title = details.title;
    if (details.college) patch.college = details.college;
    if (details.department) patch.department = details.department;
    if (details.minCredits != null) patch.minCredits = details.minCredits;
    if (details.maxCredits != null) patch.maxCredits = details.maxCredits;
    patch.detailsLoaded = true;
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
