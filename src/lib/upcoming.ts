/**
 * The next classes on a saved schedule.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web stand-in for the iOS widget and Live Activity: the same “what’s next”
 * question, answered on the home page while the site is open.
 */

import type { CourseSection } from "./models";
import { dayIndices, keyId, meetingLocation, sectionKey, weeklyMeetings } from "./models";

export interface UpcomingClass {
  crn: string;
  code: string;
  title: string;
  location: string;
  classType: string;
  start: number;
  end: number;
  dayOffset: number;
  weekday: number;
  happening: boolean;
}

function campusNow(date: Date): { year: number; month: number; day: number; weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekday < 0 ? 0 : weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** `yyyy-MM-dd` for a campus calendar day `offset` days after `year-month-day`. */
function campusISO(year: number, month: number, day: number, offset: number): string {
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Half-term and one-off meetings only count on days inside their ISO window. */
function meetingIsActive(startDate: string | null | undefined, endDate: string | null | undefined, iso: string): boolean {
  if (!startDate && !endDate) return true;
  if (startDate && iso < startDate) return false;
  if (endDate && iso > endDate) return false;
  return true;
}

interface UpcomingRow extends UpcomingClass {
  startDate?: string | null;
  endDate?: string | null;
}

export function upcomingClasses(sections: CourseSection[], now = new Date(), limit = 3): UpcomingClass[] {
  const { year, month, day, weekday, minutes } = campusNow(now);
  const rows: UpcomingRow[] = [];
  for (const section of sections) {
    for (const meeting of weeklyMeetings(section)) {
      if (meeting.start == null || meeting.end == null) continue;
      for (const weekdayIndex of dayIndices(meeting.days)) {
        rows.push({
          crn: section.crn,
          code: keyId(sectionKey(section)),
          title: section.title,
          location: meetingLocation(meeting),
          classType: section.classType,
          start: meeting.start,
          end: meeting.end,
          dayOffset: 0,
          weekday: weekdayIndex,
          happening: false,
          startDate: meeting.startDate,
          endDate: meeting.endDate,
        });
      }
    }
  }
  const ranked: UpcomingClass[] = [];
  for (let offset = 0; offset < 14; offset++) {
    const iso = campusISO(year, month, day, offset);
    const dayIndex = (weekday + offset) % 7;
    const todays = rows
      .filter((row) => row.weekday === dayIndex && meetingIsActive(row.startDate, row.endDate, iso))
      .filter((row) => offset > 0 || row.end > minutes)
      .map((row) => ({ ...row, dayOffset: offset, happening: offset === 0 && row.start <= minutes && minutes < row.end }))
      .sort((a, b) => a.start - b.start);
    ranked.push(...todays);
    if (ranked.length >= limit) break;
  }
  return ranked.slice(0, limit).map((row) => ({
    crn: row.crn,
    code: row.code,
    title: row.title,
    location: row.location,
    classType: row.classType,
    start: row.start,
    end: row.end,
    dayOffset: row.dayOffset,
    weekday: row.weekday,
    happening: row.happening,
  }));
}
