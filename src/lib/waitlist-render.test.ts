import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeatText, SectionFacts } from "@/components/bits";
import { sectionsFromBanner, type BannerSection } from "./banner";
import { makeStats } from "./catalog-index";
import { openSeats, sectionIsOpen, type CourseSection, type ScheduleFilters } from "./models";
import { emptyPreferences } from "./preferences";
import { generateSchedules, rejectionReasons } from "./schedule/generator";
import { preferenceRejectionBits, sectionIsFull } from "./schedule/preference-rules";
import { newWatchItem } from "./watchlist";

function sectionOf(partial: Partial<BannerSection>): CourseSection {
  return sectionsFromBanner(
    [{ courseReferenceNumber: "39766", courseNumber: "1925", subject: "INAM", maximumEnrollment: 15, enrollment: 15, seatsAvailable: 0, ...partial }],
    new Map(),
  )[0]!;
}

const full = sectionOf({ seatsAvailable: 0, waitCapacity: 10, waitCount: 7 });
const queued = sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 3 });
const queuedNoCap = sectionOf({ seatsAvailable: 2, waitCapacity: 0, waitCount: 3 });
const open = sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 0 });
const html = (section: CourseSection) => renderToStaticMarkup(createElement(SectionFacts, { section }));

describe("openSeats", () => {
  it("is 0 behind a waitlist and raw otherwise", () => {
    expect(openSeats(queued)).toBe(0);
    expect(openSeats(queuedNoCap)).toBe(0);
    expect(openSeats(open)).toBe(2);
    expect(sectionIsOpen(queued)).toBe(false);
  });
});

describe("rendered seat status", () => {
  it("INAM 1925 reads Full with Waitlist 7/10", () => {
    const out = html(full);
    expect(out).toContain("seat-full");
    expect(out).toContain(">Full<");
    expect(out).toContain("Waitlist 7/10");
  });

  it("a queued section with seats is orange, not open, and says Waitlist once", () => {
    const out = html(queued);
    expect(out).toContain("seat-waitlist");
    expect(out).not.toContain("seat-open");
    expect(out).toContain("0 of 15 open");
    expect(out.match(/Waitlist/g)).toHaveLength(1);
  });

  it("a queue with no capacity shows the count only", () => {
    const out = html(queuedNoCap);
    expect(out).toContain("seat-waitlist");
    expect(out).toContain("Waitlist 3");
    expect(out).not.toContain("Waitlist 3/");
  });

  it("an open section is not waitlist toned, and no fact shows without a waitlist", () => {
    expect(html(open)).toContain("2 of 15 open");
    expect(html(open)).toContain("seat-low");
    expect(html(open)).not.toContain("seat-waitlist");
    expect(html(sectionOf({ seatsAvailable: 2 }))).not.toContain("Waitlist");
  });

  it("SeatText takes the waitlisted flag", () => {
    const text = (waitlisted: boolean) => renderToStaticMarkup(createElement(SeatText, { remaining: 2, capacity: 15, waitlisted }));
    expect(text(true)).toContain("seat-waitlist");
    expect(text(false)).toContain("seat-low");
  });
});

describe("aggregates", () => {
  it("search seat totals and the Open seats sort ignore queued sections", () => {
    const stats = makeStats([queued]);
    expect(stats.seatsRemaining).toBe(0);
    expect(makeStats([queued, open]).seatsRemaining).toBe(2);
  });
});

describe("watch seeding", () => {
  it("seeds 0 behind a waitlist and the raw count otherwise", () => {
    expect(newWatchItem(queued, "202730", 1).lastSeatsRemaining).toBe(0);
    expect(newWatchItem(open, "202730", 1).lastSeatsRemaining).toBe(2);
  });
});

describe("generator and preferences", () => {
  const filters = (over: Partial<ScheduleFilters>): ScheduleFilters => ({ freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0, ...over });

  it("hide full sections drops a queued section with seats", () => {
    expect(rejectionReasons(queued, filters({ hideFullSections: true }))).not.toBe(0);
    expect(rejectionReasons(open, filters({ hideFullSections: true }))).toBe(0);
  });

  it("min seats counts a queued section as 0 seats", () => {
    expect(rejectionReasons(queued, filters({ minSeats: 1 }))).not.toBe(0);
    expect(rejectionReasons(open, filters({ minSeats: 1 }))).toBe(0);
  });

  it("the generator will not place a student in a queued section when hiding full", () => {
    const input = { key: { subject: "INAM", number: "1925" }, isRequired: true, sections: [queued] };
    expect(generateSchedules([input], filters({ hideFullSections: true })).schedules).toHaveLength(0);
    expect(generateSchedules([{ ...input, sections: [open] }], filters({ hideFullSections: true })).schedules).toHaveLength(1);
  });

  it("the Open seats only preference and isFull treat a queue as full", () => {
    const prefs = { ...emptyPreferences(), seats: "openOnly" as const };
    expect(preferenceRejectionBits(queued, prefs)).not.toBe(0);
    expect(preferenceRejectionBits(open, prefs)).toBe(0);
    expect(sectionIsFull(queued)).toBe(true);
    expect(sectionIsFull(open)).toBe(false);
  });
});
