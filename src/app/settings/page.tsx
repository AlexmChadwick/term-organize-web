"use client";

import { Button, Select, TextInput } from "@/components/ui";
import { useApp, type ThemeChoice } from "@/lib/app-state";
import { UNOFFICIAL_NOTICE } from "@/lib/legal";
import { emptyUserData, mergeUserData } from "@/lib/user";
import Link from "next/link";
import { useState } from "react";

export default function SettingsPage() {
  const { user, updateUser, replaceUser, theme, setTheme, termCode, catalogStatus, rebuildTerm } = useApp();
  const [notice, setNotice] = useState<string | null>(null);
  const prefs = user.preferences;

  function download() {
    const blob = new Blob([JSON.stringify(user, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "term-organize-data.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted">{UNOFFICIAL_NOTICE}</p>
      </header>
      <section className="card grid gap-3 p-5">
        <label className="label">
          Appearance
          <Select value={theme} onChange={(event) => setTheme(event.target.value as ThemeChoice)}>
            <option value="system">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </label>
        <label className="label flex-row items-center gap-2">
          <input type="checkbox" checked={prefs.showWeekends} onChange={(event) => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, showWeekends: event.target.checked } }))} />
          Show Saturday and Sunday on calendars
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="label">
            Calendar starts
            <TextInput type="number" min={6} max={12} value={prefs.calendarStartHour} onChange={(event) => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, calendarStartHour: clampHour(event.target.value, 6, 12) } }))} />
          </label>
          <label className="label">
            Calendar ends
            <TextInput type="number" min={16} max={23} value={prefs.calendarEndHour} onChange={(event) => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, calendarEndHour: clampHour(event.target.value, 16, 23) } }))} />
          </label>
        </div>
        <label className="label flex-row items-center gap-2">
          <input type="checkbox" checked={prefs.autoRefreshSeats} onChange={(event) => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, autoRefreshSeats: event.target.checked } }))} />
          Refresh the watchlist while this tab is open
        </label>
        <label className="label">
          Minutes between seat checks
          <TextInput
            type="number"
            min={1}
            max={120}
            value={prefs.watchlistIntervalMinutes}
            onChange={(event) => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, watchlistIntervalMinutes: Math.min(120, Math.max(1, Number(event.target.value) || 15)) } }))}
          />
        </label>
        <p className="text-sm text-muted">Current term code {termCode}. Change it from the header. Fall 2026 ships with the site. Any other term is downloaded from Banner the first time you open it, including that term’s own course descriptions, then kept in this browser.</p>
        <Button variant="ghost" type="button" onClick={() => void rebuildTerm()} disabled={catalogStatus === "building"}>
          {catalogStatus === "building" ? "Downloading this term…" : "Rebuild this term from Banner"}
        </Button>
      </section>
      <section className="card grid gap-3 p-5">
        <h2 className="font-semibold">Your data</h2>
        <p className="text-sm text-muted">Schedules, degree plans, and saved courses live in this browser. Export a JSON file to move them. If you turn on closed-browser seat alerts, this server also keeps that push subscription and the sections you watch. iCloud sync is part of the iOS and Mac apps.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={download}>
            Export JSON
          </Button>
          <label className="btn ghost cursor-pointer">
            Import JSON
            <input
              className="hidden"
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  const parsed = mergeUserData(JSON.parse(await file.text()));
                  replaceUser(parsed);
                  setNotice("Imported your data.");
                } catch {
                  setNotice("That file is not a Term Organize export.");
                }
              }}
            />
          </label>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              if (!confirm("Erase schedules, plans, and alerts stored in this browser?")) return;
              replaceUser(emptyUserData());
              setNotice("Cleared local data.");
            }}
          >
            Erase local data
          </Button>
        </div>
        {notice ? <p className="text-sm">{notice}</p> : null}
      </section>
      <section className="card grid gap-2 p-5 text-sm">
        <h2 className="font-semibold">About</h2>
        <p>{UNOFFICIAL_NOTICE}</p>
        <Link className="underline" href="/legal">
          Acknowledgements, privacy, and the AGPL
        </Link>
        <Link className="underline" href="/license">
          Read the license
        </Link>
        <a className="underline" href="https://github.com/AlexmChadwick/Northeastern-Term-Organize">
          Source code
        </a>
      </section>
    </div>
  );
}

function clampHour(value: string, min: number, max: number): number {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.min(max, Math.max(min, number));
}
