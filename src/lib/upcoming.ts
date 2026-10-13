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

function campusNow(date: Date): { weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return { weekday: weekday < 0 ? 0 : weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function upcomingClasses(sections: CourseSection[], now = new Date(), limit = 3): UpcomingClass[] {
  const { weekday, minutes } = campusNow(now);
  const rows: UpcomingClass[] = [];
  for (const section of sections) {
    for (const meeting of weeklyMeetings(section)) {
      if (meeting.start == null || meeting.end == null) continue;
      for (const day of dayIndices(meeting.days)) {
        rows.push({
          crn: section.crn,
          code: keyId(sectionKey(section)),
          title: section.title,
          location: meetingLocation(meeting),
          classType: section.classType,
          start: meeting.start,
          end: meeting.end,
          dayOffset: 0,
          weekday: day,
          happening: false,
        });
      }
    }
  }
  const ranked: UpcomingClass[] = [];
  for (let offset = 0; offset < 8; offset++) {
    const day = (weekday + offset) % 7;
    const todays = rows
      .filter((row) => row.weekday === day)
      .filter((row) => offset > 0 || row.end > minutes)
      .map((row) => ({ ...row, dayOffset: offset, happening: offset === 0 && row.start <= minutes && minutes < row.end }))
      .sort((a, b) => a.start - b.start);
    ranked.push(...todays);
    if (ranked.length >= limit) break;
  }
  return ranked.slice(0, limit);
}
