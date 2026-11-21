import { describe, expect, it } from "vitest";
import { sectionsFromBanner, type BannerSection } from "./banner";
import { makeStats, availabilityLabel } from "./catalog-index";
import { decodeCatalogArchive } from "./catalog-store";
import { normalizeWaitlist, sectionIsOpen, waitlistLabel, seatTone, type CourseSection, type TermCatalog } from "./models";
import { compareWatchlist } from "./watchlist";
import type { WatchItem } from "./user";

function banner(partial: Partial<BannerSection>): BannerSection {
  return { courseReferenceNumber: "39766", courseNumber: "1925", subject: "INAM", maximumEnrollment: 15, enrollment: 15, seatsAvailable: 0, ...partial };
}

function sectionOf(partial: Partial<BannerSection>): CourseSection {
  return sectionsFromBanner([banner(partial)], new Map())[0]!;
}

describe("waitlist display and open state", () => {
  it("shows nothing new without a waitlist", () => {
    const s = sectionOf({ seatsAvailable: 3, waitCapacity: 0, waitCount: 0 });
    expect(waitlistLabel(s)).toBeNull();
    expect(sectionIsOpen(s)).toBe(true);
  });

  it("is full with a waitlist and no seats", () => {
    const s = sectionOf({ seatsAvailable: 0, waitCapacity: 10, waitCount: 7 });
    expect(waitlistLabel(s)).toBe("Waitlist 7/10");
    expect(sectionIsOpen(s)).toBe(false);
    expect(seatTone(s.seatsRemaining, s.seatCapacity, true)).toBe("full");
  });

  it("is not open with seats but people waiting", () => {
    const s = sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 3 });
    expect(sectionIsOpen(s)).toBe(false);
    expect(seatTone(s.seatsRemaining, s.seatCapacity, true)).toBe("waitlist");
    const stats = makeStats([s, sectionOf({ courseReferenceNumber: "2", seatsAvailable: 1 })]);
    expect(availabilityLabel(stats)).toBe("1 of 2 sections open");
  });

  it("is open with seats and an empty waitlist", () => {
    const s = sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 0 });
    expect(sectionIsOpen(s)).toBe(true);
    expect(waitlistLabel(s)).toBe("Waitlist 0/10");
  });

  it("seat alerts ignore seats freed behind a waitlist", () => {
    const item: WatchItem = {
      termCode: "202730",
      crn: "39766",
      courseKey: { subject: "INAM", number: "1925" },
      courseTitle: "T",
      sectionLabel: "Lecture 01",
      addedAt: 0,
      lastSeatsRemaining: 0,
      lastWaitlistRemaining: 0,
      seatCapacity: 15,
      notifyOnWaitlist: false,
    };
    const live = (s: CourseSection) => ({ "202730": { "INAM 1925": [s] } });
    const behind = compareWatchlist([item], live(sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 3 })));
    expect(behind.alerts).toHaveLength(0);
    expect(behind.items[0]!.lastSeatsRemaining).toBe(0);
    const open = compareWatchlist([item], live(sectionOf({ seatsAvailable: 2, waitCapacity: 10, waitCount: 0 })));
    expect(open.alerts).toHaveLength(1);
  });

  it("defaults waitlist numbers missing from cached catalogs to 0", () => {
    const old = { version: 1, sections: [{ crn: "1", seatsRemaining: 4 }] } as unknown as TermCatalog;
    const s = normalizeWaitlist(old).sections[0]!;
    expect([s.waitlistCapacity, s.waitlistCount, s.waitlistRemaining]).toEqual([0, 0, 0]);
    expect(sectionIsOpen(s)).toBe(true);
    const archived = decodeCatalogArchive(new TextEncoder().encode(JSON.stringify(old)));
    expect(archived.sections[0]!.waitlistCount).toBe(0);
  });
});
