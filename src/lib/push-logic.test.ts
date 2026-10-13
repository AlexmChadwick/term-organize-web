import { describe, expect, it } from "vitest";
import { normalizeSubscription, pushPayload, subscriptionIsDue, type PushSubscriptionRecord } from "@/lib/push-logic";
import type { WatchAlert } from "@/lib/watchlist";

const record: PushSubscriptionRecord = {
  endpoint: "https://push.example/1",
  keys: { p256dh: "p", auth: "a" },
  watchlist: [],
  intervalMinutes: 15,
  lastRunAt: 1_000_000,
};

describe("push logic", () => {
  it("waits out the interval before the next seat check", () => {
    expect(subscriptionIsDue(record, record.lastRunAt + 14 * 60_000)).toBe(false);
    expect(subscriptionIsDue(record, record.lastRunAt + 15 * 60_000)).toBe(true);
  });

  it("points a push at the section page", () => {
    const alert = {
      title: "Seats open in CS 3000",
      body: "1 of 40 seats in Lecture 01 (CRN 12345). Register soon!",
      termCode: "202710",
      crn: "12345",
    } as WatchAlert;
    expect(pushPayload(alert).url).toBe("/section/202710/12345");
  });

  it("rejects a subscription that is not a push endpoint", () => {
    expect(normalizeSubscription({ endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } }, [], 15)).toBeNull();
    const saved = normalizeSubscription({ endpoint: "https://push.example/2", keys: { p256dh: "p", auth: "a" } }, [], 0);
    expect(saved?.intervalMinutes).toBe(15);
  });
});
