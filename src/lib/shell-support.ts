/**
 * Wording shared by the watchlist, free-room, and settings screens.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of SettingsFormat, LegalText.platform wording, and RoomsText.
 */

import type { RoomBooking } from "@/lib/catalog-index";
import { keyId, rangeLabel, timeLabel } from "@/lib/models";
import type { RoomStatus } from "@/lib/rooms";

/** `8 AM`, `12 PM`, `9 PM`. 24 is the midnight that ends the day. */
export function hourLabel(hour: number): string {
  const hour24 = ((hour % 24) + 24) % 24;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** The platform this build runs on, as the legal text names it. */
export const PLATFORM_NAME = "web";

export const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

export const SEARCHNEU_SUMMARY = `This app is an independent ${PLATFORM_NAME} adaptation of SearchNEU, the course search built by Sandbox at Northeastern University (sandboxnu). Portions of this app — including the Banner scraping logic, requisite parsing and schedule generation — are derived from SearchNEU's source code.`;

/** `12 of 40 rooms free`. */
export function freeSummary(free: number, total: number): string {
  return `${free} of ${total} ${total === 1 ? "room" : "rooms"} free`;
}

/**
 * What happens next: the following class for a free room, or when a busy room frees up.
 * `today` is the room's bookings on that day, sorted by start time.
 */
export function followUpNote(status: RoomStatus, today: RoomBooking[]): string {
  if (status.kind === "free") {
    const until = status.until;
    const next = until == null ? undefined : today.find((booking) => booking.start === until);
    if (until == null || !next) {
      return today.length === 0 ? "No classes are scheduled here today." : "No more classes today.";
    }
    return `Next: ${keyId(next.course)}, ${rangeLabel(next.start, next.end)}`;
  }
  if (status.freeUntil != null) return `Then free until ${timeLabel(status.freeUntil)}`;
  return "Then free for the rest of the day";
}
