/**
 * Tests for iCalendar export.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { calendarName, exportableEventCount, sectionsToICS } from "./ics";
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
        buildingCode: "WVH",
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
    expect(ics).toContain("UID:plan-a-12345-0@neuclasssearch");
    expect(ics).toContain("LOCATION:West Village H 108\r\n");
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
          buildingCode: "SH",
          building: "Shillman Hall",
          room: "105",
          kind: "Final Exam",
        },
      ],
    });

    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain("UID:plan-a-12345-final@neuclasssearch");
    expect(ics).toContain("SUMMARY:CS 3000 Final Exam");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20261214T080000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20261214T100000");
    expect(ics).toContain("LOCATION:Shillman Hall 105");
    expect(ics).toContain("DESCRIPTION:Final exam");
    // Final exam must not have a recurrence rule
    const finalEvent = ics.split("UID:plan-a-12345-final@neuclasssearch")[1]?.split("END:VEVENT")[0];
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
    expect(ics).toContain("UID:plan-a-12345-final@neuclasssearch");
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

    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    const rawLines = ics.split("\r\n");
    const encoder = new TextEncoder();
    for (const line of rawLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("handles empty sections gracefully", () => {
    const ics = sectionsToICS([], "Empty Schedule", "plan-a", now);
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
    const id = "123E4567-E89B-12D3-A456-426614174000";
    const fall = sectionsToICS([section], "Fall", id, now);
    const spring = sectionsToICS([section], "Spring", "spring-plan", now);
    expect(fall).toContain("UID:123e4567-e89b-12d3-a456-426614174000-12345-0@neuclasssearch");
    expect(fall).toContain("UID:123e4567-e89b-12d3-a456-426614174000-12345-final@neuclasssearch");
    expect(spring).toContain("UID:spring-plan-12345-0@neuclasssearch");
    expect(spring).toContain("UID:spring-plan-12345-final@neuclasssearch");
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
    const unknown = makeSection({ meetings: [{ ...makeSection().meetings[0]!, buildingCode: null, building: null, room: null }] });
    const unknownIcs = sectionsToICS([unknown], "Schedule", "plan-a", now);
    expect(unknownIcs).toContain("SUMMARY:CS 3000 Lecture");
    expect(unknownIcs.replace(/\r\n /g, "")).toContain("DESCRIPTION:Algorithms & Data\\nCRN 12345 · Lecture 01\\nInstructor: Prof Smith\\nAdded from Term Organize");
    expect(unknownIcs.split("\r\n")).not.toContainEqual(expect.stringMatching(/^LOCATION:/));

    const online = makeSection({ campus: "Online", meetings: [{ ...makeSection().meetings[0]!, buildingCode: null, building: null, room: null }] });
    expect(sectionsToICS([online], "Schedule", "plan-a", now)).toContain("LOCATION:Online");
  });

  it("uses the catalog title in weekly and final descriptions and falls back when empty", () => {
    const section = makeSection({
      title: "Special Topics Section",
      meetings: [
        ...makeSection().meetings,
        { days: 0, startDate: "2026-12-14", kind: "Final Exam" },
      ],
    });
    const catalog = sectionsToICS([section], "Schedule", "plan-a", now, () => "Catalog Course Title");
    expect(catalog).toContain("DESCRIPTION:Catalog Course Title\\n");
    expect(catalog).toContain("DESCRIPTION:Final exam\\nCatalog Course Title\\n");
    const fallback = sectionsToICS([section], "Schedule", "plan-a", now, () => "");
    expect(fallback).toContain("DESCRIPTION:Special Topics Section\\n");
    expect(fallback).toContain("DESCRIPTION:Final exam\\nSpecial Topics Section\\n");
  });

  it("exports a VTL meeting as Online for a Boston section", () => {
    const base = makeSection();
    const section = makeSection({
      meetings: [{ ...base.meetings[0]!, campusCode: "VTL" }],
    });
    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain("LOCATION:Online\r\n");
  });

  it.each([
    { label: "null", instructors: null },
    { label: "empty", instructors: [] },
  ])("omits the Instructor line for $label instructors", ({ instructors }) => {
    const section = makeSection({ instructors });
    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics.replace(/\r\n /g, "")).not.toContain("Instructor:");
  });

  it.each([
    ["2026-02-01", "2026-03-08", "20260309T035959Z"],
    ["2026-10-01", "2026-11-01", "20261102T045959Z"],
  ])("uses the end-of-day New York offset from %s through %s", (startDate, endDate, until) => {
    const base = makeSection();
    const section = makeSection({
      meetings: [{ ...base.meetings[0]!, startDate, endDate }],
    });
    const ics = sectionsToICS([section], "Schedule", "plan-a", now);
    expect(ics).toContain(`UNTIL=${until}\r\n`);
  });

  it("leaves no bare CR or LF in exported bytes for lone CR input", () => {
    const base = makeSection();
    const section = makeSection({
      classType: "Lec\rture",
      title: "Algo\rrithms\r\nand\nmore",
      meetings: [{ ...base.meetings[0]!, building: "West\rVillage", room: "1\r08" }],
    });
    const ics = sectionsToICS([section], "My\rPlan\r\nTwo\nThree", "plan-a", now);
    const bytes = new TextEncoder().encode(ics);
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0d) expect(bytes[i + 1]).toBe(0x0a);
      if (bytes[i] === 0x0a) expect(bytes[i - 1]).toBe(0x0d);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("X-WR-CALNAME:My\\nPlan\\nTwo\\nThree\r\n");
    expect(unfolded).toContain("SUMMARY:CS 3000 Lec\\nture\r\n");
    expect(unfolded).toContain("LOCATION:West\\nVillage 1\\n08\r\n");
    expect(unfolded).toContain("Algo\\nrithms\\nand\\nmore");
  });

  it("counts exportable events and reports zero for empty plans", () => {
    expect(exportableEventCount([])).toBe(0);
    expect(exportableEventCount([makeSection({ meetings: [] })])).toBe(0);
    expect(exportableEventCount([makeSection()])).toBeGreaterThan(0);
  });
});

describe("calendarName", () => {
  it("joins plan and term with a plain hyphen", () => {
    expect(calendarName("Primary", "Fall 2026")).toBe("Primary - Fall 2026");
    expect(calendarName("Primary", "Fall 2026")).not.toContain("\u2013");
  });

  it("falls back to the term name when the plan name is blank or whitespace", () => {
    expect(calendarName("", "Fall 2026")).toBe("Fall 2026");
    expect(calendarName("   ", "Fall 2026")).toBe("Fall 2026");
    expect(`${calendarName(" \t", "Fall 2026")}.ics`).toBe("Fall 2026.ics");
  });
});
