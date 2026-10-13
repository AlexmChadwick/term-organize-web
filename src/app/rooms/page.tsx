"use client";

import { useApp } from "@/lib/app-state";
import { courseHref } from "@/components/bits";
import { TextInput } from "@/components/ui";
import { availabilityOf, filterBuildings, momentFromCampusClock, momentFromDate, roomStatusDetail, roomStatusSummary } from "@/lib/rooms";
import { keyId } from "@/lib/models";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function RoomsPage() {
  const { index, termCode } = useApp();
  const now = momentFromDate(new Date());
  const [date, setDate] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return parts;
  });
  const [time, setTime] = useState(() => `${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}`);
  const [query, setQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const moment = momentFromCampusClock(date, time);
  const buildings = useMemo(() => {
    if (!index) return [];
    const rows = index.buildings.map((building) => availabilityOf(building, moment));
    return filterBuildings(rows, query).filter((row) => (onlyFree ? row.free.length > 0 : true));
  }, [index, moment, query, onlyFree]);

  if (!index) return <p className="text-muted">Loading rooms from the catalog…</p>;

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Free rooms</h1>
        <p className="text-muted">Open classrooms, using the meetings in this term’s snapshot. Times are Northeastern campus time.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <label className="label">
          Date
          <input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="label">
          Time
          <input className="field" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="label grow">
          Building or room
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Snell, WVH, 108" />
        </label>
        <label className="label flex-row items-center gap-2 self-end pb-2">
          <input type="checkbox" checked={onlyFree} onChange={(event) => setOnlyFree(event.target.checked)} />
          Free only
        </label>
      </div>
      <p className="text-sm text-muted">{buildings.length} buildings</p>
      <ul className="grid gap-3">
        {buildings.map((row) => (
          <li key={row.building.code} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                {row.building.name} <span className="text-muted">{row.building.code}</span>
              </h2>
              <span className="text-sm text-good">{row.free.length} free</span>
            </div>
            <ul className="mt-2 grid gap-1 text-sm md:grid-cols-2">
              {row.free.slice(0, 12).map((entry) => (
                <li key={entry.room.id}>
                  <span className="font-semibold">{entry.room.room}</span> <span className="text-good">{roomStatusSummary(entry.status)}</span>
                  <span className="text-muted"> · {roomStatusDetail(entry.status)}</span>
                </li>
              ))}
              {row.busy.slice(0, onlyFree ? 0 : 8).map((entry) => (
                <li key={entry.room.id}>
                  <span className="font-semibold">{entry.room.room}</span> <span className="text-bad">{roomStatusSummary(entry.status)}</span>
                  {entry.status.kind === "busy" ? (
                    <Link className="underline" href={courseHref(termCode, entry.status.booking.course)}>
                      {" "}
                      {keyId(entry.status.booking.course)}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {!buildings.length ? <p className="text-muted">No rooms match. Try another time or clear the building filter.</p> : null}
    </div>
  );
}
