import { describe, expect, it } from "vitest";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog, normalizeBundledCatalog } from "./catalog-store";
import type { CourseSection, Instructor, TermCatalog } from "./models";

const EXACT_WORK_EMAIL = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

function catalogWith(instructors: Instructor[]): TermCatalog {
  return {
    version: 1,
    term: { code: "202730", bannerDescription: "Spring 2027 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses: [],
    sections: [{ instructors } as CourseSection],
    subjects: [],
    attributes: [],
    campuses: [],
  };
}

describe("bundled catalog emails", () => {
  it("tolerates an omitted email and does not add another address", () => {
    const omitted: Instructor = { name: "No Email", primary: true };
    const explicitNull: Instructor = { name: "Null Email", primary: false, email: null };
    const work: Instructor = { name: "Work", primary: true, email: "person@northeastern.edu" };
    const neu: Instructor = { name: "Neu", primary: true, email: "person@neu.edu" };
    const mixed: Instructor = { name: "Mixed", primary: true, email: "other@gmail.com person@northeastern.edu" };
    const otherOnly: Instructor = { name: "Other", primary: true, email: "other@gmail.com extra@kent.edu" };
    const subdomain: Instructor = { name: "Subdomain", primary: true, email: "person@husky.neu.edu" };
    const catalog = normalizeBundledCatalog(catalogWith([omitted, explicitNull, work, neu, mixed, otherOnly, subdomain]));
    const instructors = catalog.sections[0]?.instructors ?? [];

    expect("email" in instructors[0]!).toBe(false);
    expect(instructors[1]?.email).toBeNull();
    expect(instructors[2]?.email).toBe("person@northeastern.edu");
    expect(instructors[3]?.email).toBe("person@neu.edu");
    expect(instructors[4]?.email).toBe("person@northeastern.edu");
    expect("email" in instructors[5]!).toBe(false);
    expect(instructors[6]?.email).toBe("person@husky.neu.edu");
  });
});

describe("Spring 2027 snapshot", () => {
  it("loads the bundled term when instructor emails are omitted", async () => {
    const catalog = await loadBundledCatalog("202730");
    expect(catalog).not.toBeNull();
    if (!catalog) return;
    expect(catalog.term).toEqual({ code: "202730", bannerDescription: "Spring 2027 Semester (View Only)" });
    expect(catalog.courses).toHaveLength(3076);
    expect(catalog.sections).toHaveLength(8326);
    expect(catalog.courses.every((course) => course.detailsLoaded)).toBe(true);

    let omitted = 0;
    const emails: string[] = [];
    for (const section of catalog.sections) {
      for (const instructor of section.instructors ?? []) {
        if (!("email" in instructor) || instructor.email == null) {
          omitted += 1;
          continue;
        }
        emails.push(instructor.email);
      }
    }
    expect(omitted).toBeGreaterThan(0);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => EXACT_WORK_EMAIL.test(email))).toBe(true);
    expect(emails.some((email) => /gmail|kent\.edu|husky\.|coe\.|ccs\.|ece\./i.test(email))).toBe(false);

    const index = CatalogIndex.build(catalog);
    expect(index.courses).toHaveLength(3076);
    expect(index.catalog.sections).toHaveLength(8326);
    expect(index.instructors.some((person) => person.email == null)).toBe(true);
    const indexedEmails = index.instructors.flatMap((person) => (person.email ? [person.email] : []));
    expect(indexedEmails.every((email) => EXACT_WORK_EMAIL.test(email))).toBe(true);
  }, 60_000);

  it("leaves the Fall 2026 snapshot's published emails in place", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).not.toBeNull();
    if (!catalog) return;
    expect(catalog.courses).toHaveLength(3103);
    expect(catalog.sections).toHaveLength(8472);
    const emails = catalog.sections.flatMap((section) =>
      (section.instructors ?? []).flatMap((instructor) => (typeof instructor.email === "string" ? [instructor.email] : [])),
    );
    expect(emails).toHaveLength(1554);
    expect(emails.some((email) => email.endsWith("@husky.neu.edu"))).toBe(true);
  }, 60_000);
});
