/**
 * Seat-alert comparison.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The open-seat rules follow SearchNEU's section updater
 * (packages/scraper/src/update/main.ts), © Sandbox at Northeastern University
 * and the SearchNEU contributors, AGPL-3.0. Web port of WatchlistComparison.swift:
 * a seat alert when a section goes from no seats to some, a waitlist alert when
 * a full waitlist gains room.
 */

import type { CourseKey, CourseSection } from "./models";
import { keyId } from "./models";
import type { WatchItem } from "./user";
import { watchId } from "./user";

export interface WatchAlert {
  kind: "seats" | "waitlist";
  termCode: string;
  crn: string;
  courseKey: CourseKey;
  courseTitle: string;
  sectionName: string;
  seatsRemaining: number;
  seatCapacity: number;
  waitlistRemaining: number;
  title: string;
  body: string;
  url: string;
}

export interface WatchOutcome {
  items: WatchItem[];
  alerts: WatchAlert[];
  missingIDs: string[];
  /** Terms for which fresh data was available. */
  checkedTermCodes: string[];
}

export function sectionName(section: CourseSection): string {
  const number = section.sectionNumber.trim();
  return number ? `${section.classType} ${number}` : section.classType;
}

export function compareWatchlist(
  items: WatchItem[],
  live: Record<string, Record<string, CourseSection[]>>,
  now = Date.now(),
): WatchOutcome {
  const updated = items.map((item) => ({ ...item }));
  const alerts: WatchAlert[] = [];
  const missingIDs: string[] = [];
  updated.forEach((item, index) => {
    const termSections = live[item.termCode];
    if (!termSections) return;
    const section = (termSections[keyId(item.courseKey)] ?? []).find((s) => s.crn === item.crn);
    if (!section) {
      missingIDs.push(watchId(item));
      updated[index] = { ...item, lastCheckedAt: now };
      return;
    }
    const seatsOpened = item.lastSeatsRemaining <= 0 && section.seatsRemaining > 0;
    const waitlistOpened =
      item.notifyOnWaitlist &&
      !seatsOpened &&
      section.seatsRemaining <= 0 &&
      item.lastWaitlistRemaining <= 0 &&
      section.waitlistRemaining > 0;
    const next: WatchItem = {
      ...item,
      lastSeatsRemaining: section.seatsRemaining,
      lastWaitlistRemaining: section.waitlistRemaining,
      seatCapacity: section.seatCapacity,
      lastCheckedAt: now,
    };
    if (seatsOpened || waitlistOpened) {
      next.lastNotifiedAt = now;
      const kind = seatsOpened ? "seats" : "waitlist";
      const code = keyId(item.courseKey);
      const name = sectionName(section);
      alerts.push({
        kind,
        termCode: item.termCode,
        crn: item.crn,
        courseKey: item.courseKey,
        courseTitle: item.courseTitle,
        sectionName: name,
        seatsRemaining: section.seatsRemaining,
        seatCapacity: section.seatCapacity,
        waitlistRemaining: section.waitlistRemaining,
        title: kind === "seats" ? `Seats open in ${code}` : `Waitlist spot open in ${code}`,
        body:
          kind === "seats"
            ? `${section.seatCapacity > 0 ? `${section.seatsRemaining} of ${section.seatCapacity} seats` : `${section.seatsRemaining} seats`} in ${name} (CRN ${item.crn}). Register soon!`
            : `${section.waitlistRemaining === 1 ? "1 waitlist spot" : `${section.waitlistRemaining} waitlist spots`} open in ${name} (CRN ${item.crn}). Join soon!`,
        url: `termorganize://section/${item.termCode}/${item.crn}`,
      });
    }
    updated[index] = next;
  });
  return { items: updated, alerts, missingIDs, checkedTermCodes: Object.keys(live) };
}

export type WatchStatus = "open" | "waitlist" | "full" | "missing";

/** Availability of a watched section as of its last check. Missing wins over the last numbers. */
export function watchlistStatus(item: WatchItem, isMissing: boolean): WatchStatus {
  if (isMissing) return "missing";
  if (item.lastSeatsRemaining > 0) return "open";
  if (item.lastWaitlistRemaining > 0) return "waitlist";
  return "full";
}

/** One line describing the numbers behind the status, e.g. `3 of 40 open`. */
export function watchlistDetail(status: WatchStatus, item: WatchItem): string {
  switch (status) {
    case "open":
      return item.seatCapacity > 0
        ? `${item.lastSeatsRemaining} of ${item.seatCapacity} open`
        : `${item.lastSeatsRemaining} open`;
    case "waitlist": {
      const spots = item.lastWaitlistRemaining;
      return `Full \u00b7 ${spots} waitlist ${spots === 1 ? "spot" : "spots"} open`;
    }
    case "full":
      return "Full";
    case "missing":
      return "No longer listed";
  }
}

/** The same numbers phrased for speech: `3 of 40 seats open`. */
export function watchlistSpokenDetail(status: WatchStatus, item: WatchItem): string {
  if (status !== "open") return watchlistDetail(status, item);
  const seats = item.lastSeatsRemaining;
  return item.seatCapacity > 0
    ? `${seats} of ${item.seatCapacity} seats open`
    : `${seats} ${seats === 1 ? "seat" : "seats"} open`;
}

/** `just now`, `5 min ago`, `3 hr ago`, `yesterday`, `4 days ago`. */
export function watchlistAgo(date: number, now: number): string {
  const seconds = Math.max(0, now - date);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr ago`;
  const days = Math.floor(seconds / 86_400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
