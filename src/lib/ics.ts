/**
 * iCalendar export for a chosen set of sections.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CourseSection, Meeting } from "./models";
import {
  dayIndices,
  finalExam,
  instructorLabel,
  keyId,
  meetingHasTime,
  meetingLocation,
  sectionKey,
  weeklyMeetings,
} from "./models";

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  let result = "";
  let current = "";
  let bytes = 0;
  let limit = 75;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (bytes + chBytes > limit) {
      result += current + "\r\n ";
      current = "";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += chBytes;
  }
  return result + current;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d!));
}

function icsDateTime(iso: string, minutes: number): string {
  const [y, m, d] = iso.split("-");
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function dateStamp(iso: string): string {
  return iso.replace(/-/g, "");
}

function nextDay(iso: string): string {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function firstMeetingDate(
  startIso: string,
  endIso: string | undefined | null,
  weekdays: number[],
): string | null {
  if (weekdays.length === 0) return null;
  const current = parseIso(startIso);
  const end = endIso ? parseIso(endIso) : null;

  for (let i = 0; i < 7; i++) {
    if (weekdays.includes(current.getUTCDay())) {
      if (end && current.getTime() > end.getTime()) return null;
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, "0");
      const d = String(current.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return null;
}

function untilStamp(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, (m ?? 1) - 1, d!, 12, 0, 0));
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  })
    .formatToParts(noonUtc)
    .find((p) => p.type === "timeZoneName")?.value;
  const offsetHours = tzPart === "EDT" ? 4 : 5;
  const targetUtc = new Date(Date.UTC(y!, (m ?? 1) - 1, d!, 23 + offsetHours, 59, 59));
  const yy = targetUtc.getUTCFullYear();
  const mm = String(targetUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(targetUtc.getUTCDate()).padStart(2, "0");
  const hh = String(targetUtc.getUTCHours()).padStart(2, "0");
  return `${yy}${mm}${dd}T${hh}5959Z`;
}

const DAY_ICS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function eventForWeekly(
  section: CourseSection,
  meeting: Meeting,
  index: number,
): string[] | null {
  if (
    !meetingHasTime(meeting) ||
    meeting.start == null ||
    meeting.end == null ||
    !meeting.startDate
  ) {
    return null;
  }

  const weekdays = dayIndices(meeting.days);
  if (weekdays.length === 0) return null;

  const firstDate = firstMeetingDate(meeting.startDate, meeting.endDate, weekdays);
  if (!firstDate) return null;

  const days = weekdays.map((d) => DAY_ICS[d]).join(",");
  const code = keyId(sectionKey(section));
  const uid = `${section.crn}-${index}@termorganize.local`;
  const summary = escapeText(`${code} ${section.title}`);
  const description = escapeText(
    `${section.classType} · CRN ${section.crn} · ${instructorLabel(section)}`,
  );
  const loc = escapeText(meetingLocation(meeting));

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTART;TZID=America/New_York:${icsDateTime(firstDate, meeting.start)}`,
    `DTEND;TZID=America/New_York:${icsDateTime(firstDate, meeting.end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days}${
      meeting.endDate ? `;UNTIL=${untilStamp(meeting.endDate)}` : ""
    }`,
    `LOCATION:${loc}`,
    `DESCRIPTION:${description}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
  ];
  return lines;
}

function eventForFinal(section: CourseSection, exam: Meeting): string[] | null {
  if (!exam.startDate) return null;
  const code = keyId(sectionKey(section));
  const uid = `${section.crn}-final@termorganize.local`;
  const summary = escapeText(`${code} Final Exam`);
  const description = escapeText(
    `Final exam\n${section.title}\nCRN ${section.crn} · ${section.classType} · ${instructorLabel(
      section,
    )}`,
  );
  const loc = escapeText(meetingLocation(exam));

  const timed = exam.start != null && exam.end != null;
  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `SUMMARY:${summary}`];

  if (timed) {
    lines.push(
      `DTSTART;TZID=America/New_York:${icsDateTime(exam.startDate, exam.start!)}`,
      `DTEND;TZID=America/New_York:${icsDateTime(exam.startDate, exam.end!)}`,
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${dateStamp(exam.startDate)}`,
      `DTEND;VALUE=DATE:${nextDay(exam.startDate)}`,
    );
  }

  lines.push(
    `LOCATION:${loc}`,
    `DESCRIPTION:${description}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
  );
  return lines;
}

export function sectionsToICS(
  sections: CourseSection[],
  calendarName: string,
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Term Organize//Web//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:America/New_York",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const section of sections) {
    const weekly = weeklyMeetings(section);
    weekly.forEach((m, i) => {
      const eventLines = eventForWeekly(section, m, i);
      if (eventLines) lines.push(...eventLines);
    });

    const exam = finalExam(section);
    if (exam && exam.startDate) {
      const examLines = eventForFinal(section, exam);
      if (examLines) lines.push(...examLines);
    }
  }

  lines.push("END:VCALENDAR");
  lines.push("");
  return lines.map(foldLine).join("\r\n");
}

export function downloadText(
  filename: string,
  contents: string,
  type: string,
): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
