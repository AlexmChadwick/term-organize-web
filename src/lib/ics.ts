/**
 * iCalendar export for a chosen set of sections.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseSection, Meeting } from "./models";
import { dayIndices, instructorLabel, meetingHasTime, meetingLocation, sectionKey, weeklyMeetings } from "./models";
import { keyId } from "./models";

function fold(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(iso: string, minutes: number): string {
  const [y, m, d] = iso.split("-");
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function untilDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}T000000Z`;
}

const DAY_ICS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function eventFor(section: CourseSection, meeting: Meeting, index: number): string | null {
  if (!meetingHasTime(meeting) || meeting.start == null || meeting.end == null || !meeting.startDate) return null;
  const days = dayIndices(meeting.days).map((d) => DAY_ICS[d]).join(",");
  const code = keyId(sectionKey(section));
  const uid = `${section.crn}-${index}@termorganize.local`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${fold(`${code} ${section.title}`)}`,
    `DTSTART;TZID=America/New_York:${icsDate(meeting.startDate, meeting.start)}`,
    `DTEND;TZID=America/New_York:${icsDate(meeting.startDate, meeting.end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days}${meeting.endDate ? `;UNTIL=${untilDate(meeting.endDate)}` : ""}`,
    `LOCATION:${fold(meetingLocation(meeting))}`,
    `DESCRIPTION:${fold(`${section.classType} · CRN ${section.crn} · ${instructorLabel(section)}`)}`,
    "END:VEVENT",
  ];
  return lines.join("\r\n");
}

export function sectionsToICS(sections: CourseSection[], calendarName: string): string {
  const events = sections.flatMap((section) => weeklyMeetings(section).map((m, i) => eventFor(section, m, i)).filter((e): e is string => !!e));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Term Organize//Web//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${fold(calendarName)}`,
    "X-WR-TIMEZONE:America/New_York",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function downloadText(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
