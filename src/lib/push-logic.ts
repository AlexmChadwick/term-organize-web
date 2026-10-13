/**
 * Web Push payloads and when a stored subscription is due for a seat check.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { WatchAlert } from "./watchlist";
import type { WatchItem } from "./user";

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: PushSubscriptionKeys;
  watchlist: WatchItem[];
  intervalMinutes: number;
  lastRunAt: number;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
}

export function subscriptionIsDue(record: PushSubscriptionRecord, now: number): boolean {
  const minutes = Math.max(1, record.intervalMinutes || 15);
  return now - (record.lastRunAt || 0) >= minutes * 60_000;
}

/** A site path the service worker can open. The comparison helper still uses the app's own scheme. */
export function pushPayload(alert: WatchAlert): PushNotificationPayload {
  return {
    title: alert.title,
    body: alert.body,
    url: `/section/${alert.termCode}/${encodeURIComponent(alert.crn)}`,
  };
}

export function normalizeSubscription(input: unknown, watchlist: WatchItem[], intervalMinutes: number, now = Date.now()): PushSubscriptionRecord | null {
  if (!input || typeof input !== "object") return null;
  const body = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://")) return null;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth) return null;
  return {
    endpoint: body.endpoint,
    keys: { p256dh, auth },
    watchlist,
    intervalMinutes: Math.min(120, Math.max(1, intervalMinutes || 15)),
    lastRunAt: now,
  };
}
