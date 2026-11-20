import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog, normalizeBundledCatalog, publishedInstructorEmail } from "./catalog-store";
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
    expect("email" in instructors[6]!).toBe(false);
  });
});

/** Literal address candidate: keeps non-ASCII characters in the domain. A sentence-ending dot in prose is stripped before the domain check; email fields get no such leniency. */
const CANDIDATE = /[^\s@<>,;"'()[\]]+@[^\s@<>,;"'()[\]]+/g;
/** Escaped forms such as name [at] example [dot] com or name(at)example(dot)com. */
const OBFUSCATED = /[\[({]\s*(?:at|dot)\s*[\])}]/i;
const ALLOWED = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

function allowedAddress(candidate: string): boolean {
  const domain = candidate.slice(candidate.lastIndexOf("@") + 1);
  return /^[\x21-\x7e]+$/.test(domain) && ALLOWED.test(candidate);
}

/** Problems in a parsed catalog payload, found without the runtime sanitizer. */
function emailProblems(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => emailProblems(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([name, item]) => emailProblems(item, name));
  }
  if (typeof value !== "string") return [];
  if (key === "email") {
    return value.split(/[\s,;<>]+/).filter(Boolean).filter((part) => !allowedAddress(part)).map((part) => `email field: ${part}`);
  }
  const problems = (value.match(CANDIDATE) ?? []).filter((part) => !allowedAddress(part.replace(/^mailto:/i, "").replace(/[.:!?]+$/, ""))).map((part) => `${key}: ${part}`);
  if (OBFUSCATED.test(value)) problems.push(`${key}: obfuscated ${value.slice(0, 60)}`);
  return problems;
}

describe("raw catalog email check", () => {
  const record = (email: string, extra: Record<string, unknown> = {}) => ({ sections: [{ instructors: [{ name: "X", email }], ...extra }] });

  it("accepts allowed addresses", () => {
    expect(emailProblems(record("A.b+c!d@Northeastern.EDU neu@neu.edu", { description: "Write to info@northeastern.edu." }))).toEqual([]);
  });

  it("catches a student-domain address", () => {
    expect(emailProblems(record("person@husky.neu.edu"))).toHaveLength(1);
  });

  it("catches an obfuscated external address in a non-email string", () => {
    expect(emailProblems(record("a@neu.edu", { description: "Contact jo [at] example [dot] org" })).length).toBeGreaterThan(0);
    expect(emailProblems(record("a@neu.edu", { notes: "jo(at)example(dot)org" })).length).toBeGreaterThan(0);
  });

  it("catches an allowed domain with a trailing dot or non-ASCII suffix", () => {
    expect(emailProblems(record("person@northeastern.edu."))).toHaveLength(1);
    expect(emailProblems(record("person@neu.edu.", {}))).toHaveLength(1);
    expect(emailProblems(record("person@neu.edué"))).toHaveLength(1);
    expect(emailProblems(record("a@neu.edu", { description: "mail person@northeastern.edu.evil.com today" })).length).toBeGreaterThan(0);
  });
});

describe("runtime email validator", () => {
  it("rejects trailing-dot, non-ASCII and lookalike domains and keeps the full local part", () => {
    for (const bad of ["a@northeastern.edu.", "a@neu.edu.", "a@neu.edué", "a@northeaſtern.edu", "a@neu.edu\u212a", "a@xneu.edu", "a@neu.edu.evil.com", "a@@neu.edu", "@neu.edu"]) {
      expect(publishedInstructorEmail(bad), bad).toBeUndefined();
    }
    expect(publishedInstructorEmail("A!b#c'd+e@NEU.EDU")).toBe("A!b#c'd+e@NEU.EDU");
  });
});

describe("bundled snapshots", () => {
  it("stores only exact institutional email domains across all bundled catalogs", () => {
    const directory = path.join(process.cwd(), "data");
    const files = readdirSync(directory).filter((name) => /^term-\d{6}\.json(?:\.gz)?$/.test(name));
    expect(files).toEqual(expect.arrayContaining(["term-202710.json.gz", "term-202730.json.gz"]));
    for (const file of files) {
      const contents = readFileSync(path.join(directory, file));
      const text = (file.endsWith(".gz") ? gunzipSync(contents) : contents).toString("utf8");
      expect(emailProblems(JSON.parse(text)), file).toEqual([]);
      expect(text.match(CANDIDATE)?.length ?? 0, file).toBeGreaterThan(0);
    }
  });

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

  it("loads the Fall 2026 snapshot with institutional addresses", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).not.toBeNull();
    if (!catalog) return;
    expect(catalog.courses).toHaveLength(3103);
    expect(catalog.sections).toHaveLength(8472);
    const emails = catalog.sections.flatMap((section) =>
      (section.instructors ?? []).flatMap((instructor) => (typeof instructor.email === "string" ? [instructor.email] : [])),
    );
    expect(emails.length).toBeGreaterThan(1000);
    expect(emails.every((email) => email.split(/\s+/).every((address) => EXACT_WORK_EMAIL.test(address)))).toBe(true);
  }, 60_000);
});
