import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog, normalizeBundledCatalog } from "./catalog-store";
import { publishedInstructorEmail } from "./instructor-email";
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

/** Literal address candidate: keeps non-ASCII characters in the domain. */
const CANDIDATE = /[^\s@<>,;"'()[\]]+@[^\s@<>,;"'()[\]]+/g;
/** Escaped forms such as name [at] example [dot] com or name(at)example(dot)com. */
const BRACKETED = /[\[({]\s*(?:at|dot)\s*[\])}]/i;
/** Plain word forms: "jo at example dot org", "jo at example.org", "example dot org". */
const WORDED = [/\bat\s+[\w-]+\s+dot\s+[a-z]{2,}/i, /\w\s+at\s+(?![^\s@]*@)[\w-]+\.[a-z]{2,}\b/i, /\w\s+dot\s+(?:edu|com|org|net|gov|io)\b/i];
const ALLOWED = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

function allowedAddress(candidate: string): boolean {
  const domain = candidate.slice(candidate.lastIndexOf("@") + 1);
  return /^[\x21-\x7e]+$/.test(domain) && ALLOWED.test(candidate);
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", commat: "@", period: ".", nbsp: " " };

function unescapeHtml(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : parseInt(hex!, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name!.toLowerCase()] ?? whole;
  });
}

function percentDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }
}

/** Decode layers until stable (bounded), then NFKC, so entity, percent and fullwidth forms are scanned as plain text. */
function canonicalText(text: string): string {
  let current = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = percentDecode(unescapeHtml(current)).normalize("NFKC");
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Problems in a parsed catalog payload, found without the runtime sanitizer. */
function emailProblems(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => emailProblems(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([name, item]) => emailProblems(item, name));
  }
  if (typeof value !== "string") return [];
  if (key === "email") {
    // Strict: no leading or trailing whitespace, exactly one space between addresses.
    return value.split(" ").filter((part) => !allowedAddress(part)).map((part) => `email field: ${JSON.stringify(part)} in ${JSON.stringify(value)}`);
  }
  const text = canonicalText(value);
  // Prose: one sentence-ending period is punctuation; anything else must pass the strict validator.
  const problems = (text.match(CANDIDATE) ?? [])
    .filter((part) => !allowedAddress(part.replace(/^mailto:/i, "").replace(/\.$/, "")))
    .map((part) => `${key}: ${part}`);
  if (BRACKETED.test(text) || WORDED.some((pattern) => pattern.test(text))) problems.push(`${key}: obfuscated ${text.slice(0, 60)}`);
  return problems;
}

describe("raw catalog email check", () => {
  const record = (email: string, extra: Record<string, unknown> = {}) => ({ sections: [{ instructors: [{ name: "X", email }], ...extra }] });
  const prose = (description: string) => emailProblems(record("a@neu.edu", { description }));

  it("accepts allowed addresses", () => {
    expect(emailProblems(record("A.b+c!d@Northeastern.EDU neu@neu.edu", { description: "Write to info@northeastern.edu." }))).toEqual([]);
    expect(prose("Meets at the library. Ask at the desk.")).toEqual([]);
  });

  it("catches a student-domain address", () => {
    expect(emailProblems(record("person@husky.neu.edu"))).toHaveLength(1);
  });

  it("catches an obfuscated external address in a non-email string", () => {
    expect(prose("Contact jo [at] example [dot] org").length).toBeGreaterThan(0);
    expect(emailProblems(record("a@neu.edu", { notes: "jo(at)example(dot)org" })).length).toBeGreaterThan(0);
  });

  it("catches plain ' at ' / ' dot ' obfuscation", () => {
    expect(prose("mail jo at example dot org").length).toBeGreaterThan(0);
    expect(prose("mail jo at example.org").length).toBeGreaterThan(0);
  });

  it("catches entity, percent and fullwidth encoded addresses", () => {
    expect(prose("jo&#64;example.org").length).toBeGreaterThan(0);
    expect(prose("jo&#x40;example.org").length).toBeGreaterThan(0);
    expect(prose("jo%40example.org").length).toBeGreaterThan(0);
    expect(prose("jo\uff20example.org").length).toBeGreaterThan(0);
    expect(prose("jo@example&period;org").length).toBeGreaterThan(0);
  });

  it("allows encoded allowed addresses", () => {
    expect(prose("jo&#64;neu.edu and jo%40northeastern.edu.")).toEqual([]);
  });

  it("catches an allowed domain with a trailing dot or non-ASCII suffix", () => {
    expect(emailProblems(record("person@northeastern.edu."))).toHaveLength(1);
    expect(emailProblems(record("person@neu.edu.", {}))).toHaveLength(1);
    expect(emailProblems(record("person@neu.edué"))).toHaveLength(1);
    expect(prose("mail person@northeastern.edu.evil.com today").length).toBeGreaterThan(0);
  });

  it("strips exactly one sentence period in prose and nothing else", () => {
    expect(prose("mail x@neu.edu.")).toEqual([]);
    expect(prose("mail x@neu.edu..").length).toBeGreaterThan(0);
    expect(prose("mail x@neu.edu!").length).toBeGreaterThan(0);
  });

  it("rejects whitespace around email field values", () => {
    for (const bad of ["x@neu.edu\n", "x@neu.edu ", " x@neu.edu", "\nx@neu.edu", "x@neu.edu\t", "x@neu.edu  y@neu.edu", "x@neu.edu\ny@neu.edu"]) {
      expect(emailProblems(record(bad)).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(emailProblems(record("x@neu.edu y@neu.edu"))).toEqual([]);
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
