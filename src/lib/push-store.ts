/**
 * Push subscriptions kept on this server so seat alerts can be sent while no tab is open.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PushSubscriptionRecord } from "./push-logic";

const filePath = path.join(process.cwd(), "data", "built", "push-subscriptions.json");

export async function loadPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { subscriptions?: PushSubscriptionRecord[] };
    return Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
  } catch {
    return [];
  }
}

export async function savePushSubscriptions(subscriptions: PushSubscriptionRecord[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ subscriptions }));
}

export async function upsertPushSubscription(record: PushSubscriptionRecord): Promise<void> {
  const all = await loadPushSubscriptions();
  const index = all.findIndex((item) => item.endpoint === record.endpoint);
  if (index >= 0) {
    const previous = all[index]!;
    all[index] = { ...record, lastRunAt: previous.lastRunAt };
  } else all.push({ ...record, lastRunAt: 0 });
  await savePushSubscriptions(all);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const all = await loadPushSubscriptions();
  await savePushSubscriptions(all.filter((item) => item.endpoint !== endpoint));
}
