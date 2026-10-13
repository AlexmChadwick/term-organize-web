import { NextResponse } from "next/server";
import { normalizeSubscription } from "@/lib/push-logic";
import { ensurePushSender, vapidConfig } from "@/lib/push-sender";
import { upsertPushSubscription } from "@/lib/push-store";
import type { WatchItem } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Saves a browser push subscription and the sections it should watch. */
export async function POST(request: Request) {
  if (!vapidConfig()) return NextResponse.json({ error: "Web Push is not configured." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as {
    subscription?: unknown;
    watchlist?: WatchItem[];
    intervalMinutes?: number;
  } | null;
  const watchlist = Array.isArray(body?.watchlist) ? body.watchlist.slice(0, 40) : [];
  const record = normalizeSubscription(body?.subscription, watchlist, body?.intervalMinutes ?? 15);
  if (!record) return NextResponse.json({ error: "That push subscription is incomplete." }, { status: 400 });
  await upsertPushSubscription(record);
  ensurePushSender();
  return NextResponse.json({ ok: true });
}
