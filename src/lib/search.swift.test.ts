import { beforeAll, describe, expect, it } from "vitest";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog } from "./catalog-store";
import { Day, emptySearchFilters, keyId, sectionKey, sectionMatchesFilters, type SearchFilters } from "./models";
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
});
