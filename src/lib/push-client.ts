"use client";

import type { WatchItem } from "@/lib/user";

export async function pushConfigured(): Promise<boolean> {
  const res = await fetch("/api/push/vapid");
  if (!res.ok) return false;
  const body = (await res.json()) as { configured?: boolean };
  return body.configured === true;
}

function urlBase64ToBytes(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Turns on Web Push and stores the watched sections on this server. Returns an error string, or null. */
export async function enableClosedAlerts(watchlist: WatchItem[], intervalMinutes: number): Promise<string | null> {
  const res = await fetch("/api/push/vapid");
  const body = (await res.json().catch(() => null)) as { configured?: boolean; publicKey?: string | null } | null;
  if (!body?.configured || !body.publicKey) return "Web Push is not configured on this server.";
  if (typeof Notification === "undefined") return "This browser cannot show notifications.";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "Notifications are blocked in this browser.";
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(body.publicKey) as BufferSource,
    }));
  return syncSubscription(subscription, watchlist, intervalMinutes);
}

export async function syncClosedAlerts(watchlist: WatchItem[], intervalMinutes: number): Promise<void> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  await syncSubscription(subscription, watchlist, intervalMinutes);
}

export async function disableClosedAlerts(): Promise<void> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

async function syncSubscription(subscription: PushSubscription, watchlist: WatchItem[], intervalMinutes: number): Promise<string | null> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), watchlist, intervalMinutes }),
  });
  if (!res.ok) return "Could not save the push subscription.";
  return null;
}
