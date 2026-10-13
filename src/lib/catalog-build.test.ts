import { describe, expect, it } from "vitest";
import { mergeCatalog, type BannerSection } from "@/lib/banner";
import { courseColorIndex, distinctCourseColorIndexes, termApproximateWindow, type Course } from "@/lib/models";
import { offeringWindow } from "@/lib/offering-history";
import type { Term } from "@/lib/models";

describe("course colors", () => {
  it("matches the iOS 64-bit djb2 palette index", () => {
    expect(courseColorIndex("CS 3000")).toBe(2);
    expect(courseColorIndex("CS 2500")).toBe(0);
    expect(courseColorIndex("CS 1800")).toBe(0);
    expect(courseColorIndex("MATH 1341")).toBe(6);
    expect(courseColorIndex("EECE 2160")).toBe(8);
    expect(courseColorIndex("DS 3000")).toBe(1);
    expect(courseColorIndex("CY 2550")).toBe(3);
    expect(courseColorIndex("ARTF 1122")).toBe(4);
    expect(courseColorIndex("ENGW 1111")).toBe(0);
    expect(courseColorIndex("PHIL 1145")).toBe(7);
    expect(courseColorIndex("CS3000")).toBe(4);
    expect(courseColorIndex("Honors")).toBe(2);
  });

  it("gives colliding course colors distinct slots on a professor page", () => {
    const colors = distinctCourseColorIndexes([
      { subject: "CS", number: "2500" },
      { subject: "CS", number: "1800" },
      { subject: "ENGW", number: "1111" },
    ]);
    expect(colors.get("CS 2500")).toBe(0);
    expect(colors.get("CS 1800")).toBe(1);
    expect(colors.get("ENGW 1111")).toBe(2);
    expect(new Set(colors.values()).size).toBe(3);
  });
});

describe("term windows", () => {
  it("places fall before the next spring", () => {
    const fall = termApproximateWindow("202710");
    const spring = termApproximateWindow("202730");
    expect(fall).not.toBeNull();
    expect(spring).not.toBeNull();
    const zone = { timeZone: "America/New_York", year: "numeric", month: "numeric" } as const;
    const fallParts = new Intl.DateTimeFormat("en-US", zone).formatToParts(new Date(fall!.start));
    const springParts = new Intl.DateTimeFormat("en-US", zone).formatToParts(new Date(spring!.start));
    const pick = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((part) => part.type === type)?.value;
    expect(pick(fallParts, "year")).toBe("2026");
    expect(pick(fallParts, "month")).toBe("9");
    expect(pick(springParts, "year")).toBe("2027");
    expect(fall!.end).toBeLessThan(spring!.start);
  });
});

describe("offering window", () => {
  it("covers two years of Northeastern terms, summers included", () => {
    const codes = ["202710", "202655", "202650", "202632", "202630", "202610", "202560", "202550", "202540", "202530", "202510", "202460"];
    const terms: Term[] = codes.filter((code) => !["2", "4", "5", "8"].includes(code.at(-1)!)).map((code) => ({ code, bannerDescription: code }));
    expect(offeringWindow(terms, 24).map((term) => term.code)).toEqual([
      "202710",
      "202650",
      "202630",
      "202610",
      "202560",
      "202550",
      "202540",
      "202530",
      "202510",
    ]);
    expect(offeringWindow([], 24)).toEqual([]);
  });
});

describe("mergeCatalog", () => {
  const section = (overrides: Partial<BannerSection> = {}): BannerSection => ({
    courseReferenceNumber: "10001",
    subject: "CS",
    courseNumber: "2510",
    sequenceNumber: "01",
    courseTitle: "Fundamentals of Computer Science 1",
    creditHourLow: 4,
    creditHours: 4,
    seatsAvailable: 8,
    maximumEnrollment: 40,
    ...overrides,
  });

  it("borrows details from another term and drops that term's postreqs", () => {
    const known: Course = {
      subject: "CS",
      number: "2510",
      title: "Fundamentals 1",
      description: "The earlier description.",
      minCredits: 4,
      maxCredits: 4,
      attributes: ["NCPR"],
      prereqs: null,
      postreqs: [{ subject: "CS", number: "2511" }],
      specialTopics: false,
      detailsLoaded: true,
    };
    const catalog = mergeCatalog({
      fresh: [section()],
      term: { code: "202630", bannerDescription: "Spring 2026 Semester" },
      knowledge: new Map([["CS 2510", known]]),
      now: 100,
    });
    expect(catalog.sectionsUpdatedAt).toBe(100);
    expect(catalog.courses).toHaveLength(1);
    expect(catalog.courses[0]?.description).toBe("The earlier description.");
    expect(catalog.courses[0]?.detailsLoaded).toBe(true);
    expect(catalog.courses[0]?.postreqs).toEqual([]);
    expect(catalog.sections[0]?.seatsRemaining).toBe(8);
  });

  it("keeps details already stored for the term", () => {
    const existing = mergeCatalog({
      fresh: [section({ courseTitle: "Stub" })],
      term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
      now: 1,
    });
    existing.courses[0]!.description = "Kept";
    existing.courses[0]!.detailsLoaded = true;
    existing.courses[0]!.prereqs = { s: "CS", n: "1800" };
    const again = mergeCatalog({
      existing,
      fresh: [section({ seatsAvailable: 1, creditHourLow: 1, creditHourHigh: undefined, creditHours: 4 })],
      term: existing.term,
      now: 2,
    });
    expect(again.courses[0]?.description).toBe("Kept");
    expect(again.courses[0]?.prereqs).toEqual({ s: "CS", n: "1800" });
    expect(again.courses[0]?.minCredits).toBe(1);
    expect(again.courses[0]?.maxCredits).toBe(1);
    expect(again.sections[0]?.seatsRemaining).toBe(1);
  });
});
