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
    instructors: [{ name: "Prof Smith", primary: true, email: "smith@example.edu" }],
    ...overrides,
  };
}

describe("iCalendar export", () => {
  const now = new Date("2026-08-01T12:34:56.789Z");

  it("includes VTIMEZONE block for America/New_York", () => {
    const ics = sectionsToICS([makeSection()], "My Schedule", "plan-a", now);
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
    const ics = sectionsToICS([makeSection()], "My Schedule", "plan-a", now);
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260908T095000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260908T110500");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261210T045959Z");
    expect(ics).toContain("UID:plan-a-12345-0@termorganize.local");
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

    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain("UID:plan-a-12345-final@termorganize.local");
    expect(ics).toContain("SUMMARY:CS 3000 Final Exam");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20261214T080000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20261214T100000");
    expect(ics).toContain("LOCATION:Shillman Hall 105");
    expect(ics).toContain("DESCRIPTION:Final exam");
    // Final exam must not have a recurrence rule
    const finalEvent = ics.split("UID:plan-a-12345-final@termorganize.local")[1]?.split("END:VEVENT")[0];
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

    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain("UID:plan-a-12345-final@termorganize.local");
    expect(ics).toContain("SUMMARY:CS 3000 Final Exam");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261215");
    expect(ics).toContain("DTEND;VALUE=DATE:20261216");
  });

  it("folds long lines at 75 octets per RFC 5545", () => {
    const section = makeSection({
      title: "Extremely Long Course Title Designed To Exceed The RFC 5545 Line Folding Limit",
      instructors: [
        { name: "Professor Long Name With Multiple Affiliations", primary: true, email: "test@example.edu" },
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

  it("adds one injectable UTC DTSTAMP to every event", () => {
    const section = makeSection({
      meetings: [
        ...makeSection().meetings,
        {
          days: 0,
          start: 480,
          end: 600,
          startDate: "2026-12-14",
          kind: "Final Exam",
        },
      ],
    });
    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    const stamps = ics.split("\r\n").filter((line) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(line));
    expect(stamps).toEqual([
      "DTSTAMP:20260801T123456Z",
      "DTSTAMP:20260801T123456Z",
    ]);
  });

  it("uses the plan identity in weekly and final UIDs", () => {
    const section = makeSection({
      meetings: [
        ...makeSection().meetings,
        { days: 0, start: 480, end: 600, startDate: "2026-12-14", kind: "Final Exam" },
      ],
    });
    const fall = sectionsToICS([section], "Fall", "fall-plan", now);
    const spring = sectionsToICS([section], "Spring", "spring-plan", now);
    expect(fall).toContain("UID:fall-plan-12345-0@termorganize.local");
    expect(fall).toContain("UID:fall-plan-12345-final@termorganize.local");
    expect(spring).toContain("UID:spring-plan-12345-0@termorganize.local");
    expect(spring).toContain("UID:spring-plan-12345-final@termorganize.local");
  });

  it("folds emoji, CJK, and combining marks to at most 75 octets", () => {
    const ics = sectionsToICS(
      [makeSection({ title: `${"😀".repeat(30)}${"漢".repeat(40)}${"e\u0301".repeat(40)}` })],
      `Calendar ${"名".repeat(40)}`,
      "plan-a",
      now,
    );
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("computes UNTIL numerically on the EDT side of a term", () => {
    const section = makeSection({
      meetings: [{
        days: Day.monday | Day.wednesday,
        start: 600,
        end: 700,
        startDate: "2027-01-11",
        endDate: "2027-04-21",
        kind: "Class",
      }],
    });
    const ics = sectionsToICS([section], "Spring", "plan-a", now);
    expect(ics).toContain("UNTIL=20270422T035959Z");
  });

  it("uses CRLF for the whole file including its trailing newline", () => {
    const ics = sectionsToICS([makeSection()], "Schedule", "plan-a", now);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("skips meetings with TBA times, no days, or no end date", () => {
    const base = makeSection();
    const section = makeSection({
      meetings: [
        { ...base.meetings[0]!, start: null, end: null },
        { ...base.meetings[0]!, days: 0 },
        { ...base.meetings[0]!, endDate: undefined },
      ],
    });
    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("matches Swift summary, notes, and location rules", () => {
    const unknown = makeSection({ meetings: [{ ...makeSection().meetings[0]!, building: null, room: null }] });
    const unknownIcs = sectionsToICS([unknown], "Schedule", "plan-a", now);
    expect(unknownIcs).toContain("SUMMARY:CS 3000 Lecture");
    expect(unknownIcs.replace(/\r\n /g, "")).toContain("DESCRIPTION:Algorithms & Data\\nCRN 12345 · Lecture 01\\nInstructor: Prof Smith\\nAdded from Term Organize");
    expect(unknownIcs.split("\r\n")).not.toContainEqual(expect.stringMatching(/^LOCATION:/));

    const online = makeSection({ campus: "Online", meetings: [{ ...makeSection().meetings[0]!, building: null, room: null }] });
    expect(sectionsToICS([online], "Schedule", "plan-a", now)).toContain("LOCATION:Online");
  });
});
