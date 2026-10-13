/**
 * Free-room status from weekly bookings.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Logic/Rooms/RoomAvailability.swift.
 */

import type { BuildingSummary, RoomBooking, RoomSchedule } from "./catalog-index";
import { DAY_FULL, dayHas, timeLabel } from "./models";
import { keyId } from "./models";

export const FIRST_CLASS_MINUTE = 7 * 60;
export const LAST_CLASS_MINUTE = 22 * 60;

export interface RoomMoment {
  weekday: number;
  minutes: number;
  /** yyyy-MM-dd when the moment is a real day. */
  date?: string;
}

export type RoomStatus =
  | { kind: "free"; until: number | null }
  | { kind: "busy"; booking: RoomBooking; until: number; freeUntil: number | null };

export function roomStatusSummary(status: RoomStatus): string {
  if (status.kind === "free") return status.until == null ? "Free for the rest of the day" : `Free until ${timeLabel(status.until)}`;
  return `In use until ${timeLabel(status.until)}`;
}

export function roomStatusDetail(status: RoomStatus): string {
  if (status.kind === "free") return roomStatusSummary(status);
  return `In use: ${keyId(status.booking.course)} until ${timeLabel(status.until)}`;
}

function isShort(booking: RoomBooking): boolean {
  if (!booking.startDate || !booking.endDate) return false;
  const a = Date.parse(`${booking.startDate}T00:00:00Z`);
  const b = Date.parse(`${booking.endDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b - a < 21 * 24 * 3600 * 1000;
}

function activeOn(booking: RoomBooking, date: string): boolean {
  if (booking.startDate && date < booking.startDate) return false;
  if (booking.endDate && date > booking.endDate) return false;
  return true;
}

export function bookingsOn(room: RoomSchedule, weekday: number, date?: string): RoomBooking[] {
  return room.bookings
    .filter((b) => dayHas(b.days, weekday) && b.end > b.start)
    .filter((b) => (date ? activeOn(b, date) : !isShort(b)))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function statusAt(day: RoomBooking[], minutes: number): RoomStatus {
  const current = day.find((b) => b.start <= minutes && minutes < b.end);
  if (!current) return { kind: "free", until: day.find((b) => b.start > minutes)?.start ?? null };
  let until = current.end;
  for (const booking of day) {
    if (booking.start <= until && booking.end > until) until = booking.end;
  }
  return { kind: "busy", booking: current, until, freeUntil: day.find((b) => b.start >= until)?.start ?? null };
}

export function statusOfRoom(room: RoomSchedule, moment: RoomMoment): RoomStatus {
  return statusAt(bookingsOn(room, moment.weekday, moment.date), moment.minutes);
}

export function minutesRemaining(status: RoomStatus, minutes: number): number {
  if (status.kind === "free") return (status.until ?? 24 * 60) - minutes;
  return status.until - minutes;
}

export interface RoomEntry {
  room: RoomSchedule;
  status: RoomStatus;
}

export interface BuildingAvailability {
  building: BuildingSummary;
  free: RoomEntry[];
  busy: RoomEntry[];
  freeCount: number;
  roomCount: number;
}

export function availabilityOf(building: BuildingSummary, moment: RoomMoment): BuildingAvailability {
  const free: { entry: RoomEntry; order: number }[] = [];
  const busy: { entry: RoomEntry; order: number }[] = [];
  building.rooms.forEach((room, order) => {
    const entry = { room, status: statusOfRoom(room, moment) };
    if (entry.status.kind === "free") free.push({ entry, order });
    else busy.push({ entry, order });
  });
  free.sort((a, b) => {
    const l = minutesRemaining(a.entry.status, moment.minutes);
    const r = minutesRemaining(b.entry.status, moment.minutes);
    return l !== r ? r - l : a.order - b.order;
  });
  busy.sort((a, b) => {
    const l = minutesRemaining(a.entry.status, moment.minutes);
    const r = minutesRemaining(b.entry.status, moment.minutes);
    return l !== r ? l - r : a.order - b.order;
  });
  return { building, free: free.map((f) => f.entry), busy: busy.map((f) => f.entry), freeCount: free.length, roomCount: building.rooms.length };
}

export function filterBuildings(items: BuildingAvailability[], query: string): BuildingAvailability[] {
  const tokens = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return items;
  return items.flatMap((item) => {
    const name = item.building.name.toLowerCase();
    const code = item.building.code.toLowerCase();
    const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
    const buildingHits = tokens.map((token) => code.startsWith(token) || nameWords.some((w) => w.startsWith(token)) || (token.length >= 3 && name.includes(token)));
    if (buildingHits.every(Boolean)) return [item];
    const matches = (entry: RoomEntry) => {
      const number = entry.room.room.toLowerCase();
      return tokens.every((token, i) => buildingHits[i] || number.startsWith(token) || (token.length >= 2 && number.includes(token)));
    };
    const free = item.free.filter(matches);
    const busy = item.busy.filter(matches);
    if (!free.length && !busy.length) return [];
    return [{ ...item, free, busy }];
  });
}

/** A clock the student picked, read as Northeastern's campus time (America/New_York). */
export function momentFromCampusClock(date: string, time: string): RoomMoment {
  const [hour, minute] = time.split(":").map((part) => Number(part));
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const probe = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 16, 0, 0));
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(probe);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { weekday: weekday < 0 ? 0 : weekday, minutes: (hour || 0) * 60 + (minute || 0), date };
}

/** A point in a typical week. Weekdays wrap, and minutes stay inside one day. */
export function roomMoment(weekday: number, minutes: number): RoomMoment {
  const wrapped = ((weekday % 7) + 7) % 7;
  return { weekday: wrapped, minutes: Math.min(Math.max(minutes, 0), 24 * 60 - 1) };
}

/** Classes run from 7 AM to 10 PM; outside that, buildings are usually locked. */
export function isWithinClassHours(moment: RoomMoment): boolean {
  return moment.minutes >= FIRST_CLASS_MINUTE && moment.minutes < LAST_CLASS_MINUTE;
}

/** `Tuesday at 2:30 PM`. */
export function momentLabel(moment: RoomMoment): string {
  return `${DAY_FULL[moment.weekday] ?? "Sunday"} at ${timeLabel(moment.minutes)}`;
}

/** A free room that will be taken within half an hour isn't much use. */
export function isFreeOnlyBriefly(status: RoomStatus, moment: RoomMoment): boolean {
  return status.kind === "free" && minutesRemaining(status, moment.minutes) < 30;
}

/**
 * Stretches of a day without a class between `start` and `end` (minutes after midnight).
 * Each pair is a half-open interval `[from, to)`.
 */
export function freeStretches(day: RoomBooking[], start: number, end: number): [number, number][] {
  if (start >= end) return [];
  const stretches: [number, number][] = [];
  let cursor = start;
  const sorted = [...day].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const booking of sorted) {
    if (booking.start >= end) break;
    if (booking.start > cursor) stretches.push([cursor, booking.start]);
    cursor = Math.max(cursor, booking.end);
    if (cursor >= end) return stretches;
  }
  if (cursor < end) stretches.push([cursor, end]);
  return stretches;
}

/**
 * How many rooms have no class during each whole hour from 7 AM to 10 PM.
 * `result[0]` is 7–8 AM.
 */
export function freeRoomCounts(rooms: RoomSchedule[], weekday: number, date?: string): number[] {
  const hours = (LAST_CLASS_MINUTE - FIRST_CLASS_MINUTE) / 60;
  const counts = Array.from({ length: hours }, () => 0);
  for (const room of rooms) {
    const day = bookingsOn(room, weekday, date);
    for (let hour = 0; hour < hours; hour++) {
      const start = FIRST_CLASS_MINUTE + hour * 60;
      const end = start + 60;
      if (!day.some((booking) => booking.start < end && booking.end > start)) counts[hour] = (counts[hour] ?? 0) + 1;
    }
  }
  return counts;
}

export function momentFromDate(date: Date, timeZone = "America/New_York"): RoomMoment {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!.slice(0, 3));
  return {
    weekday: weekday < 0 ? 0 : weekday,
    minutes: Math.min(24 * 60 - 1, Number(parts.hour) * 60 + Number(parts.minute)),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}
