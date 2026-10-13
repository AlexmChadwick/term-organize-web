"use client";

import { courseHref } from "@/components/bits";
import { useApp } from "@/lib/app-state";
import { UNOFFICIAL_NOTICE } from "@/lib/legal";
import { keyId, timeLabel } from "@/lib/models";
import { popularSubjects } from "@/lib/catalog-index";
import { upcomingClasses } from "@/lib/upcoming";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function HomePage() {
  const { index, catalogStatus, user, updateUser, plan, termCode } = useApp();
  const [query, setQuery] = useState("");
  const subjects = index ? popularSubjects(index, 8) : [];
  const sections = useMemo(() => {
    if (!index || !plan) return [];
    return plan.selectedCRNs.flatMap((crn) => {
      const section = index.sectionByCRN(crn);
      return section ? [section] : [];
    });
  }, [index, plan]);
  const upcoming = upcomingClasses(sections, new Date(), 3);

  return (
    <div className="grid gap-6">
      <section className="card p-6 md:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Northeastern course search</p>
        <h1 className="mt-2 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">Build the term before Banner does it for you.</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Search the catalog, compare open seats, generate a conflict-free week, and check it against your degree plan. {UNOFFICIAL_NOTICE}
        </p>
        <form className="mt-6 flex flex-col gap-2 sm:flex-row" action="/search">
          <label className="sr-only" htmlFor="home-q">
            Search courses
          </label>
          <input id="home-q" name="q" className="field" placeholder="CS 3000, fundies, linear algebra, a CRN" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        {catalogStatus === "loading" ? <p className="mt-3 text-sm text-muted">Loading the Fall 2026 snapshot…</p> : null}
        {catalogStatus === "missing" ? (
          <p className="mt-3 text-sm text-muted">This term has no bundled snapshot. Search still opens a course by subject and number, and live seats come from Banner.</p>
        ) : null}
        {catalogStatus === "error" ? <p className="mt-3 text-sm text-bad">The catalog did not load. Refresh the page.</p> : null}
      </section>

      {!user.preferences.hasCompletedOnboarding ? (
        <section className="card p-5">
          <h2 className="text-lg font-semibold">Before you register</h2>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            <li>Unofficial tool. It reads public Banner and catalog pages. It cannot enroll you.</li>
            <li>Schedules, plans, and seat alerts stay in this browser until you export them.</li>
            <li>The bundled snapshot is Fall 2026. Other terms refresh one course at a time.</li>
          </ul>
          <button className="btn mt-4" type="button" onClick={() => updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, hasCompletedOnboarding: true } }))}>
            Got it
          </button>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <section className="card p-5">
          <h2 className="font-semibold">Up next</h2>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Pick sections on a schedule and the next meeting shows up here. Widgets and Live Activities stay on the iOS app.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {upcoming.map((item) => (
                <li key={`${item.crn}-${item.dayOffset}-${item.start}`}>
                  <Link href={`/section/${termCode}/${item.crn}`} className="block">
                    <div className="font-semibold">
                      {item.code} {item.happening ? "· now" : item.dayOffset === 0 ? "· today" : item.dayOffset === 1 ? "· tomorrow" : ""}
                    </div>
                    <div className="text-sm text-muted">
                      {timeLabel(item.start)} – {timeLabel(item.end)} · {item.location}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Your schedule</h2>
          {plan && plan.courses.length ? (
            <div className="mt-2 text-sm">
              <p className="font-semibold">{plan.name}</p>
              <p className="text-muted">{plan.courses.map((course) => keyId(course.key)).join(", ")}</p>
              <Link className="mt-3 inline-block underline" href="/schedule">
                Open the week
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No courses in the primary plan for this term yet.</p>
          )}
          <p className="mt-3 text-sm text-muted">{user.watchlist.length ? `${user.watchlist.length} section${user.watchlist.length === 1 ? "" : "s"} on the seat watch.` : "Seat alerts refresh while this tab is open."}</p>
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Recent</h2>
          {user.recents.filter((item) => item.termCode === termCode).length === 0 ? (
            <p className="mt-2 text-sm text-muted">Courses you open land here.</p>
          ) : (
            <ul className="mt-2 grid gap-1 text-sm">
              {user.recents
                .filter((item) => item.termCode === termCode)
                .slice(0, 6)
                .map((item) => (
                  <li key={keyId(item.key)}>
                    <Link className="underline" href={courseHref(termCode, item.key)}>
                      {keyId(item.key)}
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {subjects.length ? (
        <section>
          <h2 className="mb-2 font-semibold">Busy subjects</h2>
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <Link key={subject.code} className="chip" href={`/search?q=${encodeURIComponent(subject.code)}`}>
                {subject.code}
                <span className="text-muted">{subject.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
