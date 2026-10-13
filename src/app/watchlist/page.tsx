"use client";

import { courseHref, sectionHref, SeatText } from "@/components/bits";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { keyId } from "@/lib/models";
import Link from "next/link";
import { useState } from "react";

export default function WatchlistPage() {
  const { user, updateUser, unwatch, refreshWatchlist, termCode } = useApp();
  const [status, setStatus] = useState<string | null>(null);
  const items = user.watchlist.filter((item) => item.termCode === termCode);
  const others = user.watchlist.filter((item) => item.termCode !== termCode);

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Seat alerts</h1>
          <p className="max-w-xl text-muted">
            While this tab is open, watched sections refresh on a timer. If you allow notifications, a seat or waitlist opening posts a browser notification. A closed tab cannot poll Banner; that needs the iOS app.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setStatus("Checking Banner…");
            void refreshWatchlist().then((message) => setStatus(message ?? "Checked. No new openings."));
          }}
        >
          Check now
        </Button>
      </header>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
      <label className="label flex-row items-center gap-2">
        <input
          type="checkbox"
          checked={user.preferences.notificationsEnabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            if (enabled && typeof Notification !== "undefined" && Notification.permission !== "granted") {
              void Notification.requestPermission().then((permission) => {
                updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, notificationsEnabled: permission === "granted" } }));
              });
              return;
            }
            updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, notificationsEnabled: enabled } }));
          }}
        />
        Browser notifications
      </label>
      {!items.length && !others.length ? <p className="text-muted">Open a section and choose Watch seats. Full sections are the useful ones.</p> : null}
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.crn} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <Link className="font-semibold underline" href={sectionHref(item.termCode, item.crn)}>
                {keyId(item.courseKey)} · CRN {item.crn}
              </Link>
              <div className="text-sm text-muted">
                {item.sectionLabel} · {item.courseTitle}
              </div>
              <div className="text-sm">
                <SeatText remaining={item.lastSeatsRemaining} capacity={item.seatCapacity} />
                {item.notifyOnWaitlist ? ` · waitlist spots last seen ${item.lastWaitlistRemaining}` : ""}
              </div>
              <Link className="text-sm underline" href={courseHref(item.termCode, item.courseKey)}>
                Course page
              </Link>
            </div>
            <Button variant="ghost" type="button" onClick={() => unwatch(item.crn)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {others.length ? <p className="text-sm text-muted">{others.length} watched sections belong to other terms. Switch the term in the header to see them.</p> : null}
    </div>
  );
}
