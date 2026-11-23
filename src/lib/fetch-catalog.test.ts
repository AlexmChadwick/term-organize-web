import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCatalog } from "./app-state";
import type { CourseSection, TermCatalog } from "./models";

function dirtyCatalog(): TermCatalog {
  return {
    version: 1,
    term: { code: "202730", bannerDescription: "Spring 2027 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses: [],
    sections: [{
      instructors: [
        { name: "Work", primary: true, email: "person@northeastern.edu" },
        { name: "External", primary: false, email: "other@gmail.com" },
        { name: "Student", primary: false, email: "student@husky.neu.edu" },
      ],
    } as CourseSection],
    subjects: [],
    attributes: [],
    campuses: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCatalog", () => {
  it("returns only allowed instructor addresses from the catalog response", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(dirtyCatalog()), { status: 200, headers: { "Content-Type": "application/json" } }));
    const catalog = await fetchCatalog("202730");
    const emails = (catalog?.sections[0]?.instructors ?? []).map((instructor) => instructor.email);
    expect(emails).toEqual(["person@northeastern.edu", undefined, undefined]);
    expect(JSON.stringify(catalog)).not.toMatch(/gmail|husky/);
  });
});
