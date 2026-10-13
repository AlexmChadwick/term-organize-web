/**
 * Sends seat alerts with VAPID Web Push. Optional: with no keys, nothing is sent.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT (a mailto: address)
 * in the environment. Generate a pair with `npx web-push generate-vapid-keys`.
 */

import "server-only";
import webpush from "web-push";
import { refreshWatched } from "./banner-server";
import { keyId, courseKeyOf } from "./models";
import type { CourseSection } from "./models";
import { pushPayload, subscriptionIsDue, type PushSubscriptionRecord } from "./push-logic";
import { loadPushSubscriptions, savePushSubscriptions } from "./push-store";
import { compareWatchlist } from "./watchlist";

export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:term-organize@localhost";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

let vapidReady = false;

function configureVapid(): boolean {
  const config = vapidConfig();
  if (!config) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidReady = true;
  }
  return true;
}

/** Checks due subscriptions and pushes seat or waitlist openings. */
export async function sendDuePushes(now = Date.now()): Promise<number> {
  if (!configureVapid()) return 0;
  const records = await loadPushSubscriptions();
  const due = records.filter((record) => record.watchlist.length > 0 && subscriptionIsDue(record, now));
  if (!due.length) return 0;
  let sent = 0;
  const gone = new Set<string>();
  for (const record of due) {
    sent += await pushOne(record, now, gone);
  }
  await savePushSubscriptions(records.filter((record) => !gone.has(record.endpoint)));
  return sent;
}

async function pushOne(record: PushSubscriptionRecord, now: number, gone: Set<string>): Promise<number> {
  const groups = new Map<string, { subject: string; number: string }[]>();
  for (const item of record.watchlist) {
    const list = groups.get(item.termCode) ?? [];
    if (!list.some((course) => course.subject === item.courseKey.subject && course.number === item.courseKey.number)) {
      list.push({ subject: item.courseKey.subject, number: item.courseKey.number });
    }
    groups.set(item.termCode, list);
  }
  const live: Record<string, Record<string, CourseSection[]>> = {};
  try {
    for (const [term, courses] of groups) {
      const sections = await refreshWatched(term, courses);
      const byCourse: Record<string, CourseSection[]> = {};
      for (const section of sections) {
        const id = keyId(courseKeyOf(section));
        byCourse[id] = [...(byCourse[id] ?? []), section];
      }
      live[term] = byCourse;
    }
  } catch {
    record.lastRunAt = now;
    return 0;
  }
  const outcome = compareWatchlist(record.watchlist, live, now);
  record.watchlist = outcome.items;
  record.lastRunAt = now;
  let sent = 0;
  for (const alert of outcome.alerts) {
    const payload = pushPayload(alert);
    try {
      await webpush.sendNotification(
        { endpoint: record.endpoint, keys: record.keys },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (error) {
      const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (status === 404 || status === 410) gone.add(record.endpoint);
    }
  }
  return sent;
}

const globalTimer = globalThis as { __termOrganizePushTimer?: ReturnType<typeof setInterval> };

/** Starts the sender once per process. Does nothing until VAPID keys are set. */
export function ensurePushSender(): void {
  if (globalTimer.__termOrganizePushTimer || !vapidConfig()) return;
  globalTimer.__termOrganizePushTimer = setInterval(() => {
    void sendDuePushes();
  }, 60_000);
}
