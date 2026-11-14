/**
 * Tests for iCalendar export.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { sectionsToICS } from "./ics";
import type { CourseSection } from "./models";
import { Day } from "./models";

function makeSection(overrides: Partial<CourseSection> = {}): CourseSection {
  return {
    crn: "12345",
    subject: "CS",
    number: "3000",
    title: "Algorithms & Data",
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 30,
    seatsRemaining: 5,
    enrollment: 25,
    waitlistCapacity: 10,
    waitlistCount: 0,
    waitlistRemaining: 10,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    crossListCRNs: [],
    attributes: [],
    meetings: [
      {
        days: Day.tuesday | Day.thursday,
        start: 590, // 9:50 AM
        end: 665, // 11:05 AM
        startDate: "2026-09-07", // Monday
        endDate: "2026-12-09",
        building: "West Village H",
        room: "108",
        kind: "Class",
      },
    ],
    instructors: [{ name: "Prof Smith", email: "smith@example.edu" }],
    ...overrides,
  };
}

describe("iCalendar export", () => {
  it("includes VTIMEZONE block for America/New_York", () => {
    const ics = sectionsToICS([makeSection()], "My Schedule");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Term Organize//Web//EN");
    expect(ics).toContain("X-WR-CALNAME:My Schedule");
    expect(ics).toContain("X-WR-TIMEZONE:America/New_York");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/New_York");
    expect(ics).toContain("BEGIN:DAYLIGHT");
    expect(ics).toContain("TZNAME:EDT");
    expect(ics).toContain("BEGIN:STANDARD");
    expect(ics).toContain("TZNAME:EST");
    expect(ics).toContain("END:VTIMEZONE");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("aligns weekly meeting DTSTART to the first matching class day", () => {
    // startDate is Monday 2026-09-07, but section meets Tuesday/Thursday.
    // The first meeting must start on Tuesday 2026-09-08.
    const ics = sectionsToICS([makeSection()], "My Schedule");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260908T095000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260908T110500");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261210T045959Z");
    expect(ics).toContain("UID:12345-0@termorganize.local");
  });

  it("exports timed final exams as distinct events", () => {
    const section = makeSection({
      meetings: [
        {
          days: Day.monday | Day.wednesday,
          start: 500,
          end: 565,
          startDate: "2026-09-09",
          endDate: "2026-12-09",
          building: "Ryder Hall",
          room: "100",
          kind: "Class",
        },
        {
          days: 0,
          start: 480, // 8:00 AM
          end: 600, // 10:00 AM
          startDate: "2026-12-14",
          building: "Shillman Hall",
          room: "105",
          kind: "Final Exam",
        },
      ],
    });

    const ics = sectionsToICS([section], "Schedule");
    expect(ics).toContain("UID:12345-final@termorganize.local");
    expect(ics).toContain("SUMMARY:CS 3000 Final Exam");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20261214T080000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20261214T100000");
    expect(ics).toContain("LOCATION:Shillman Hall 105");
    expect(ics).toContain("DESCRIPTION:Final exam");
    // Final exam must not have a recurrence rule
    const finalEvent = ics.split("UID:12345-final@termorganize.local")[1]?.split("END:VEVENT")[0];
    expect(finalEvent).toBeDefined();
    expect(finalEvent).not.toContain("RRULE:");
  });

  it("exports untimed (all-day) final exams with DATE values", () => {
    const section = makeSection({
      meetings: [
        {
          days: Day.friday,
          start: 600,
          end: 700,
          startDate: "2026-09-11",
          endDate: "2026-12-04",
          kind: "Class",
        },
        {
          days: 0,
          start: null,
          end: null,
          startDate: "2026-12-15",
          kind: "Final Exam",
        },
      ],
    });

    const ics = sectionsToICS([section], "Schedule");
    expect(ics).toContain("UID:12345-final@termorganize.local");
    expect(ics).toContain("SUMMARY:CS 3000 Final Exam");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261215");
    expect(ics).toContain("DTEND;VALUE=DATE:20261216");
  });

  it("folds long lines at 75 octets per RFC 5545", () => {
    const section = makeSection({
      title: "Extremely Long Course Title Designed To Exceed The RFC 5545 Line Folding Limit",
      instructors: [
        { name: "Professor Long Name With Multiple Affiliations", email: "test@example.edu" },
      ],
    });

    const ics = sectionsToICS([section], "Schedule");
    const rawLines = ics.split("\r\n");
    const encoder = new TextEncoder();
    for (const line of rawLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("handles empty sections gracefully", () => {
    const ics = sectionsToICS([], "Empty Schedule");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:Empty Schedule");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
