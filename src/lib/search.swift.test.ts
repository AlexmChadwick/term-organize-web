import { beforeAll, describe, expect, it } from "vitest";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog } from "./catalog-store";
import {
  Day,
  courseMatchesFilters,
  emptySearchFilters,
  keyId,
  reqCourse,
  requisiteIsNone,
  searchFilterCount,
  sectionKey,
  sectionMatchesFilters,
  type Course,
  type CourseSection,
  type SearchFilters,
  type TermCatalog,
} from "./models";
import { searchCatalog } from "./search";

let index: CatalogIndex;

beforeAll(async () => {
  const catalog = await loadBundledCatalog("202710");
  if (!catalog) throw new Error("Bundled catalog missing");
  index = CatalogIndex.build(catalog);
}, 60_000);

function courseCode(subject: string, number: string): string {
  return keyId({ subject, number });
}

function top(text: string, filters: SearchFilters = emptySearchFilters()): string[] {
  return searchCatalog(index, text, filters, "relevance").results.slice(0, 5).map((result) => courseCode(result.course.subject, result.course.number));
}

describe("SearchEngineTests", () => {
  it("bundledCatalogIsComplete", () => {
    expect.soft(index.courses.length > 2_500).toBe(true);
    expect.soft(index.catalog.sections.length > 7_000).toBe(true);
    expect.soft(index.courses.every((course) => course.detailsLoaded)).toBe(true);
    expect.soft(index.instructors.length > 0).toBe(true);
    expect.soft(index.buildings.length > 0).toBe(true);
  });

  it("exactCourseCodes", () => {
    expect.soft(top("CS 3000")[0]).toBe("CS 3000");
    expect.soft(top("cs3000")[0]).toBe("CS 3000");
    expect.soft(top("cs 30")[0]).toBe("CS 3000");
  });

  it("titlesAndShorthand", () => {
    expect.soft(top("algorithms and data")[0]).toBe("CS 3000");
    expect.soft(top("linear algebra")[0]).toBe("MATH 2331");
    expect.soft(top("orgo").every((code) => code.startsWith("CHM") || code.startsWith("CHEM"))).toBe(true);
    expect.soft(top("linalg")[0]).toBe("MATH 2331");
    expect.soft(top("algoritms").includes("CS 3000")).toBe(true);
  });

  it("crnLookup", () => {
    const section = index.catalog.sections[0];
    expect.soft(section).toBeTruthy();
    const response = searchCatalog(index, section?.crn ?? "", emptySearchFilters(), "relevance");
    expect.soft(response.crnMatch?.crn).toBe(section?.crn);
  });

  it("subjectAndProfessorMatches", () => {
    expect.soft(searchCatalog(index, "cs", emptySearchFilters(), "relevance").subjects.map((subject) => subject.code)).toEqual(["CS"]);
    const instructor = index.instructors.find((person) => person.displayName.split(" ").length === 2);
    expect.soft(instructor).toBeTruthy();
    if (!instructor) return;
    const response = searchCatalog(index, instructor.displayName, emptySearchFilters(), "relevance");
    expect.soft(response.instructors.some((hit) => hit.name === instructor.name)).toBe(true);
  });

  it("filtersRequireAMatchingSection", () => {
    const filters: SearchFilters = {
      ...emptySearchFilters(),
      subjects: ["CS"],
      openSeatsOnly: true,
      allowedDays: Day.monday | Day.wednesday | Day.thursday,
    };
    const results = searchCatalog(index, "", filters, "relevance").results;
    expect.soft(results.length > 0).toBe(true);
    for (const result of results) {
      expect.soft(result.course.subject).toBe("CS");
      expect.soft(index.sectionsOf(sectionKey(result.course)).some((section) => sectionMatchesFilters(section, filters))).toBe(true);
    }
  });

  it("noRequisiteFiltersKeepLoadedEmptyCoursesOnly", () => {
    const filters = { ...emptySearchFilters(), noPrerequisites: true, noCorequisites: true };
    expect(searchFilterCount(filters)).toBe(2);
    expect(searchFilterCount(emptySearchFilters())).toBe(0);
    const results = searchCatalog(index, "", filters, "courseNumber").results;
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(requisiteIsNone(result.course, "prereqs")).toBe(true);
      expect(requisiteIsNone(result.course, "coreqs")).toBe(true);
    }
    const algorithms = index.course({ subject: "CS", number: "3000" });
    expect(algorithms?.detailsLoaded).toBe(true);
    expect(algorithms?.prereqs).toBeTruthy();
    expect(results.some((result) => result.course.subject === "CS" && result.course.number === "3000")).toBe(false);

    const none = listed({ subject: "CS", number: "1101", title: "None" });
    const hasPrereq = listed({ subject: "CS", number: "3000", title: "Needs one", prereqs: reqCourse({ subject: "CS", number: "2500" }) });
    const hasCoreq = listed({ subject: "CS", number: "3001", title: "Needs a lab", coreqs: reqCourse({ subject: "CS", number: "3000" }) });
    const unknown = listed({ subject: "CS", number: "1990", title: "Not loaded", detailsLoaded: false });
    const unknownNull = listed({ subject: "CS", number: "1991", title: "Null before load", detailsLoaded: false, prereqs: null, coreqs: null });
    expect(requisiteIsNone(none, "prereqs") && requisiteIsNone(none, "coreqs")).toBe(true);
    expect(requisiteIsNone(unknown, "prereqs")).toBe(false);
    expect(requisiteIsNone(unknownNull, "prereqs")).toBe(false);
    const noPrereq = { ...emptySearchFilters(), noPrerequisites: true };
    const noCoreq = { ...emptySearchFilters(), noCorequisites: true };
    expect(courseMatchesFilters(none, filters)).toBe(true);
    expect(courseMatchesFilters(hasPrereq, noPrereq)).toBe(false);
    expect(courseMatchesFilters(hasPrereq, noCoreq)).toBe(true);
    expect(courseMatchesFilters(hasCoreq, noCoreq)).toBe(false);
    expect(courseMatchesFilters(unknown, filters)).toBe(false);
    expect(courseMatchesFilters(unknownNull, filters)).toBe(false);

    const tiny = CatalogIndex.build(tinyCatalog([none, hasPrereq, hasCoreq, unknown, unknownNull]));
    const found = searchCatalog(tiny, "", filters, "courseNumber").results.map((result) => result.course.number);
    expect(found).toEqual(["1101"]);
  });
});

function listed(partial: Partial<Course> & Pick<Course, "subject" | "number" | "title">): Course {
  return {
    description: "",
    minCredits: 4,
    maxCredits: 4,
    attributes: [],
    postreqs: [],
    specialTopics: false,
    detailsLoaded: true,
    prereqs: null,
    coreqs: null,
    ...partial,
  };
}

function tinyCatalog(courses: Course[]): TermCatalog {
  const sections: CourseSection[] = courses.map((course, offset) => ({
    crn: String(10000 + offset),
    subject: course.subject,
    number: course.number,
    title: course.title,
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 20,
    seatsRemaining: 5,
    enrollment: 15,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    meetings: [],
    crossListCRNs: [],
    attributes: [],
  }));
  return {
    version: 1,
    term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses,
    sections,
    subjects: [{ code: "CS", name: "Computer Science" }],
    attributes: [],
    campuses: [],
  };
}
