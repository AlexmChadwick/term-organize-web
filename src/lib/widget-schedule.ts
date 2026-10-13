/**
 * Weekly meetings for Up Next.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Port of Shared/WidgetScheduleData.swift. Widgets themselves are iOS-only;
 * the same date-window rules answer “what’s next” in the browser.
 */

import { newYorkEpochMs } from "@/lib/models";

export interface WidgetMeeting {
  id: string;
  crn: string;
  courseCode: string;
  title: string;
  location: string;
  classType: string;
  weekday: number;
  start: number;
  end: number;
  colorIndex: number;
  startDate?: string | null;
  endDate?: string | null;
}

export interface WidgetScheduleData {
  generatedAt: Date;
  termCode: string;
  termName: string;
  planName: string;
  classesStart?: Date | null;
  classesEnd?: Date | null;
  meetings: WidgetMeeting[];
}

export interface WidgetOccurrence {
  meeting: WidgetMeeting;
  start: Date;
  end: Date;
}

function nyParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
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
  };
}

export function widgetISODay(date: Date): string {
  const { year, month, day } = nyParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfCampusDay(date: Date): Date {
  const { year, month, day } = nyParts(date);
  return new Date(newYorkEpochMs(year, month, day));
}

function addCampusDays(day: Date, offset: number): Date {
  const { year, month, day: date } = nyParts(day);
  return new Date(newYorkEpochMs(year, month, date + offset));
}

function meetingIsActive(meeting: WidgetMeeting, day: Date): boolean {
  if (!meeting.startDate && !meeting.endDate) return true;
  const iso = widgetISODay(day);
  if (meeting.startDate && iso < meeting.startDate) return false;
  if (meeting.endDate && iso > meeting.endDate) return false;
  return true;
}

function occurrence(meeting: WidgetMeeting, day: Date): WidgetOccurrence {
  return {
    meeting,
    start: new Date(day.getTime() + meeting.start * 60_000),
    end: new Date(day.getTime() + meeting.end * 60_000),
  };
}

/** Classes on the same campus day as `date`. */
export function widgetClassesOn(data: WidgetScheduleData, date: Date): WidgetOccurrence[] {
  const day = startOfCampusDay(date);
  if (data.classesStart && day < startOfCampusDay(data.classesStart)) return [];
  if (data.classesEnd && day > startOfCampusDay(data.classesEnd)) return [];
  const weekday = nyParts(day).weekday;
  return data.meetings
    .filter((meeting) => meeting.weekday === weekday && meetingIsActive(meeting, day))
    .sort((a, b) => a.start - b.start)
    .map((meeting) => occurrence(meeting, day));
}

/** Upcoming or in-progress classes, in order. Looks ahead two weeks. */
export function widgetOccurrences(data: WidgetScheduleData, date: Date, limit = 10): WidgetOccurrence[] {
  if (!data.meetings.length) return [];
  const results: WidgetOccurrence[] = [];
  const start = startOfCampusDay(date);
  for (let offset = 0; offset < 14; offset++) {
    const day = addCampusDays(start, offset);
    if (data.classesEnd && day > startOfCampusDay(data.classesEnd)) break;
    if (data.classesStart && day < startOfCampusDay(data.classesStart)) continue;
    const weekday = nyParts(day).weekday;
    const meetings = data.meetings.filter((meeting) => meeting.weekday === weekday && meetingIsActive(meeting, day)).sort((a, b) => a.start - b.start);
    for (const meeting of meetings) {
      const item = occurrence(meeting, day);
      if (item.end <= date) continue;
      results.push(item);
      if (results.length >= limit) return results;
    }
  }
  return results;
}
