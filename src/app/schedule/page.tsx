"use client";

import { WeekCalendar, blocksFromSections, courseHref } from "@/components/bits";
import { Button, TextArea, TextInput } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { sectionsToICS, downloadText } from "@/lib/ics";
import { interpretPreferences } from "@/lib/nl";
import type { CourseKey, CourseSection } from "@/lib/models";
import { DAY_SHORT, courseColorAt, creditsLabel, keyId, scheduleSummary, sectionsConflict, timeLabel } from "@/lib/models";
import { searchCatalog as runSearch } from "@/lib/search";
import { emptyPreferences, TIME_BANDS, TIME_BAND_RANGE, bandPreference, setBandPreference, type TimeBand, type TimePreference } from "@/lib/preferences";
import { courseInputsFor, generateSchedules, type ScheduleGenerationResult, type ScheduleSortOption } from "@/lib/schedule";
import { scheduleSuggestions } from "@/lib/degree-logic";
import { termName } from "@/lib/models";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function SchedulePage() {
  const app = useApp();
  const { index, plan, ensurePlan, updatePlan, user, updateUser, termCode } = app;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ScheduleSortOption>("best");
  const [message, setMessage] = useState<string | null>(null);
  const [wish, setWish] = useState("");
  const [results, setResults] = useState<ScheduleGenerationResult | null>(null);
  const active = plan;

  const suggestions = useMemo(() => {
    if (!index) return [];
    return scheduleSuggestions({
      term: index.catalog.term,
      degreePlans: user.degreePlans,
      schedulePlans: user.plans,
      excludingPlanID: active?.id,
      alreadyInPlan: new Set((active?.courses ?? []).map((course) => keyId(course.key))),
      index,
    });
  }, [index, user.degreePlans, user.plans, active]);

  const hits = useMemo(() => {
    if (!index || query.trim().length < 2) return [];
    return runSearch(index, query, { subjects: [], nupaths: [], levels: [], campuses: [], classTypes: [], honorsOnly: false, openSeatsOnly: false, instruction: "any" }, "relevance").results.slice(0, 6);
  }, [index, query]);

  const selected = useMemo(() => {
    if (!index || !active) return [] as CourseSection[];
    return active.selectedCRNs.flatMap((crn) => {
      const section = index.sectionByCRN(crn);
      return section ? [section] : [];
    });
  }, [index, active]);

  const conflicts = useMemo(() => {
    const pairs: string[] = [];
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        if (sectionsConflict(selected[i]!, selected[j]!)) pairs.push(`${selected[i]!.subject} ${selected[i]!.number} overlaps ${selected[j]!.subject} ${selected[j]!.number}.`);
      }
    }
    return pairs;
  }, [selected]);

  function current() {
    return active ?? ensurePlan();
  }

  function colorFor(section: CourseSection) {
    const course = active?.courses.find((item) => item.key.subject === section.subject && item.key.number === section.number);
    return course?.colorIndex ?? 0;
  }

  function add(key: CourseKey) {
    const target = current();
    if (target.courses.some((course) => keyId(course.key) === keyId(key))) return;
    updatePlan(target.id, (item) => ({
      ...item,
      courses: [...item.courses, { key, isRequired: true, excludedCRNs: [], colorIndex: item.courses.length % 10 }],
    }));
    setQuery("");
  }

  function run() {
    if (!index) return;
    const target = current();
    const inputs = courseInputsFor(target.courses, {
      course: (key) => index.course(key) ?? null,
      sectionsFor: (key) => index.sectionsOf(key),
    });
    const generated = generateSchedules(inputs, target.filters, target.preferences ?? emptyPreferences(), sort, {
      maxResults: 12,
      maxExhaustiveLeaves: 80_000,
      maxNodes: 250_000,
      timeBudget: 0.8,
      sampleLeaves: 20_000,
      sampleTimeBudget: 0.25,
      allowSampling: true,
    });
    setResults(generated);
    setMessage(generated.schedules.length ? `${generated.totalFound} schedule${generated.totalFound === 1 ? "" : "s"} fit.` : explainGeneration(generated));
  }

  if (!index) return <p className="text-muted">Loading the catalog for the schedule builder…</p>;

  const prefs = active?.preferences ?? emptyPreferences();
  const hours = { start: user.preferences.calendarStartHour, end: user.preferences.calendarEndHour };

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-muted">{index.catalog.term ? termName(index.catalog.term) : termCode}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              const fresh = {
                id: crypto.randomUUID(),
                name: `Plan ${user.plans.filter((item) => item.termCode === termCode).length + 1}`,
                termCode,
                courses: [],
                selectedCRNs: [],
                filters: { freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0 },
                preferences: emptyPreferences(),
                favoriteCombinations: [] as string[][],
                isPrimary: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              updateUser((prev) => ({
                ...prev,
                plans: prev.plans.map((item) => (item.termCode === termCode ? { ...item, isPrimary: false } : item)).concat(fresh),
              }));
            }}
          >
            New plan
          </Button>
        </div>
      </header>

      {user.plans.filter((item) => item.termCode === termCode).length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {user.plans
            .filter((item) => item.termCode === termCode)
            .map((item) => (
              <button
                key={item.id}
                className={`chip ${item.isPrimary ? "border-accent text-accent" : ""}`}
                type="button"
                onClick={() => updateUser((prev) => ({ ...prev, plans: prev.plans.map((plan) => (plan.termCode === termCode ? { ...plan, isPrimary: plan.id === item.id } : plan)) }))}
              >
                {item.name}
              </button>
            ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="grid content-start gap-3">
          <section className="card p-4">
            <label className="label">
              Plan name
              <TextInput
                value={active?.name ?? "My schedule"}
                onChange={(event) => {
                  const target = current();
                  updatePlan(target.id, (item) => ({ ...item, name: event.target.value }));
                }}
              />
            </label>
            <label className="label mt-3">
              Add a course
              <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="CS 3000 or fundies" />
            </label>
            {hits.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button className="w-full rounded-xl px-2 py-1 text-left hover:bg-surface-2" type="button" onClick={() => add({ subject: hit.course.subject, number: hit.course.number })}>
                      {hit.course.subject} {hit.course.number} · {hit.course.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {suggestions[0] ? (
              <button
                className="btn soft mt-3 w-full"
                type="button"
                onClick={() => {
                  const target = current();
                  for (const key of suggestions[0]!.courses) add(key);
                  updatePlan(target.id, (item) => item);
                }}
              >
                Autofill {suggestions[0].title}
              </button>
            ) : null}
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Courses</h2>
            {!active?.courses.length ? <p className="mt-2 text-sm text-muted">Add a course to start a week.</p> : null}
            <ul className="mt-2 grid gap-2">
              {(active?.courses ?? []).map((course) => {
                const listed = index.course(course.key);
                const sections = index.sectionsOf(course.key);
                const chosen = sections.find((section) => active?.selectedCRNs.includes(section.crn));
                const color = courseColorAt(course.colorIndex);
                return (
                  <li key={keyId(course.key)} className="rounded-2xl border border-line p-3" style={{ borderColor: color.stroke }}>
                    <div className="flex items-start justify-between gap-2">
                      <Link className="font-semibold underline" href={courseHref(termCode, course.key)}>
                        {keyId(course.key)}
                      </Link>
                      <button className="text-sm text-muted" type="button" onClick={() => updatePlan(active!.id, (item) => ({ ...item, courses: item.courses.filter((entry) => keyId(entry.key) !== keyId(course.key)), selectedCRNs: item.selectedCRNs.filter((crn) => !sections.some((section) => section.crn === crn)) }))}>
                        Remove
                      </button>
                    </div>
                    <p className="text-sm text-muted">{listed?.title}</p>
                    <label className="mt-1 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={course.isRequired}
                        onChange={(event) => updatePlan(active!.id, (item) => ({ ...item, courses: item.courses.map((entry) => (keyId(entry.key) === keyId(course.key) ? { ...entry, isRequired: event.target.checked } : entry)) }))}
                      />
                      Required
                    </label>
                    <label className="label mt-2">
                      Section
                      <select
                        className="select"
                        value={chosen?.crn ?? ""}
                        onChange={(event) => {
                          const crn = event.target.value;
                          updatePlan(active!.id, (item) => ({
                            ...item,
                            selectedCRNs: [...item.selectedCRNs.filter((id) => !sections.some((section) => section.crn === id)), ...(crn ? [crn] : [])],
                          }));
                        }}
                      >
                        <option value="">Not chosen</option>
                        {sections.map((section) => (
                          <option key={section.crn} value={section.crn}>
                            {section.crn} · {section.classType} {section.sectionNumber} · {scheduleSummary(section)} · {section.seatsRemaining} seats
                          </option>
                        ))}
                      </select>
                    </label>
                    {listed ? <p className="mt-1 text-xs text-muted">{creditsLabel(listed.minCredits, listed.maxCredits)}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="grid gap-4">
          {conflicts.length ? (
            <div className="card border-bad p-4 text-sm text-bad">
              {conflicts.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          <section className="card overflow-x-auto p-3">
            <WeekCalendar
              blocks={blocksFromSections(selected, colorFor, termCode)}
              startHour={hours.start}
              endHour={hours.end}
              showWeekends={user.preferences.showWeekends}
            />
          </section>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => copyCrns(selected)}>
              Copy CRNs
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => downloadText(`${active?.name ?? "schedule"}.ics`, sectionsToICS(selected, active?.name ?? "Term Organize"), "text/calendar")}
            >
              Export .ics
            </Button>
            <Button type="button" variant="ghost" onClick={() => void shareImage(selected, active?.name ?? "Schedule", colorFor, hours.start, hours.end, user.preferences.showWeekends)}>
              Share image
            </Button>
          </div>

          <section className="card grid gap-3 p-4">
            <h2 className="font-semibold">Generate</h2>
            <label className="label">
              Describe the week
              <TextArea value={wish} onChange={(event) => setWish(event.target.value)} placeholder="No classes before 10am, Fridays off, lunch break, prefer afternoons" />
            </label>
            <Button
              variant="soft"
              type="button"
              onClick={() => {
                const target = current();
                const read = interpretPreferences(wish, target.preferences ?? emptyPreferences());
                updatePlan(target.id, (item) => ({ ...item, preferences: read.preferences }));
                setMessage(read.summary.join(" · "));
              }}
            >
              Read that into preferences
            </Button>
            <div className="flex flex-wrap gap-1">
              {TIME_BANDS.map((band) => (
                <button key={band} className="chip" type="button" onClick={() => cycleBand(current().id, band)}>
                  {TIME_BAND_RANGE[band].title}: {bandPreference(prefs, band)}
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="label">
                No earlier than
                <input className="field" type="time" value={minutesToTime(prefs.earliestStart?.minutes)} onChange={(event) => setLimit("earliestStart", event.target.value)} />
              </label>
              <label className="label">
                Done by
                <input className="field" type="time" value={minutesToTime(prefs.latestEnd?.minutes)} onChange={(event) => setLimit("latestEnd", event.target.value)} />
              </label>
              <label className="label">
                Format
                <select className="select" value={prefs.format} onChange={(event) => updatePlan(current().id, (item) => ({ ...item, preferences: { ...(item.preferences ?? emptyPreferences()), format: event.target.value as typeof prefs.format } }))}>
                  <option value="noPreference">Any format</option>
                  <option value="inPerson">In person</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="online">Online</option>
                </select>
              </label>
              <label className="label">
                Seats
                <select className="select" value={prefs.seats} onChange={(event) => updatePlan(current().id, (item) => ({ ...item, preferences: { ...(item.preferences ?? emptyPreferences()), seats: event.target.value as typeof prefs.seats } }))}>
                  <option value="any">Any section</option>
                  <option value="waitlistOK">Waitlist is fine</option>
                  <option value="openOnly">Open seats only</option>
                </select>
              </label>
              <label className="label">
                Campus
                <select className="select" value={prefs.campus ?? ""} onChange={(event) => updatePlan(current().id, (item) => ({ ...item, preferences: { ...(item.preferences ?? emptyPreferences()), campus: event.target.value || null } }))}>
                  <option value="">Any campus</option>
                  {index.campusNames.map((campus) => (
                    <option key={campus}>{campus}</option>
                  ))}
                </select>
              </label>
              <label className="label">
                Sort
                <select className="select" value={sort} onChange={(event) => setSort(event.target.value as ScheduleSortOption)}>
                  <option value="best">Best match</option>
                  <option value="fewestDays">Fewest days</option>
                  <option value="latestStart">Latest start</option>
                  <option value="earliestFinish">Earliest finish</option>
                  <option value="fewestGaps">Fewest gaps</option>
                  <option value="mostSeats">Most seats</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {DAY_SHORT.map((label, day) => {
                const on = ((prefs.daysOff ?? 0) & (1 << day)) !== 0;
                return (
                  <button
                    key={label}
                    className={`chip ${on ? "border-accent text-accent" : ""}`}
                    type="button"
                    onClick={() =>
                      updatePlan(current().id, (item) => {
                        const base = item.preferences ?? emptyPreferences();
                        return { ...item, preferences: { ...base, daysOff: (base.daysOff ?? 0) ^ (1 << day) } };
                      })
                    }
                  >
                    {label} off
                  </button>
                );
              })}
            </div>
            <label className="label flex-row items-center gap-2">
              <input type="checkbox" checked={active?.filters.hideFullSections ?? false} onChange={(event) => updatePlan(current().id, (item) => ({ ...item, filters: { ...item.filters, hideFullSections: event.target.checked } }))} />
              Hide full sections
            </label>
            <Button type="button" onClick={run}>
              Generate schedules
            </Button>
            {message ? <p className="text-sm text-muted">{message}</p> : null}
            <ul className="grid gap-2">
              {results?.schedules.map((schedule, rank) => (
                <li key={schedule.id} className="rounded-2xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>Option {rank + 1}</strong>
                    <span className="text-sm text-muted">
                      score {Math.round(schedule.score)} · {schedule.classDays} days · {schedule.minSeats} min seats
                    </span>
                  </div>
                  <ul className="mt-1 text-sm">
                    {schedule.reasons.map((reason) => (
                      <li key={reason.text} className={reason.kind === "caveat" ? "text-warn" : "text-good"}>
                        {reason.text}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-sm text-muted">{schedule.sections.map((section) => `${section.subject} ${section.number} ${section.crn}`).join(" · ")}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      className="tiny"
                      type="button"
                      onClick={() => updatePlan(current().id, (item) => ({ ...item, selectedCRNs: schedule.crns }))}
                    >
                      Use this week
                    </Button>
                    <Button className="tiny" variant="ghost" type="button" onClick={() => copyCrns(schedule.sections)}>
                      Copy CRNs
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );

  function cycleBand(planId: string, band: TimeBand) {
    updatePlan(planId, (item) => {
      const base = item.preferences ?? emptyPreferences();
      const order: TimePreference[] = ["okay", "prefer", "avoid"];
      const next = order[(order.indexOf(bandPreference(base, band)) + 1) % order.length]!;
      return { ...item, preferences: setBandPreference(base, band, next) };
    });
  }

  function setLimit(field: "earliestStart" | "latestEnd", value: string) {
    updatePlan(current().id, (item) => {
      const base = item.preferences ?? emptyPreferences();
      const minutes = timeToMinutes(value);
      return { ...item, preferences: { ...base, [field]: minutes == null ? null : { minutes, strength: "required" as const } } };
    });
  }
}

function explainGeneration(result: ScheduleGenerationResult): string {
  const lines: string[] = [];
  const problem = result.diagnostics.countProblem;
  if (problem?.kind === "tooManyRequired") lines.push(`You marked ${problem.required} courses as required, but asked for schedules of ${problem.wanted}.`);
  if (problem?.kind === "tooFewCourses") lines.push(`Only ${problem.available} courses are available, and you asked for ${problem.wanted}.`);
  if (problem?.kind === "creditsOverTarget") lines.push(`Required courses are already ${problem.required} credits, over the ${problem.limit} credit limit.`);
  if (problem?.kind === "creditsUnderTarget") lines.push(`Those courses only add up to ${problem.available} credits. The target is ${problem.wanted}.`);
  for (const course of result.diagnostics.blockedRequiredCourses) {
    const bits = Object.entries(course.rejections)
      .filter((entry) => entry[1])
      .map(([reason, count]) => `${count} ${reason}`);
    lines.push(`${keyId(course.key)} has no section left${bits.length ? ` (${bits.join("; ")})` : ""}.`);
  }
  for (const pair of result.diagnostics.conflictingPairs) {
    lines.push(
      pair.reason === "travelTime"
        ? `${keyId(pair.first)} and ${keyId(pair.second)} don't leave enough time to walk between buildings.`
        : `${keyId(pair.first)} and ${keyId(pair.second)} overlap in every remaining combination.`,
    );
  }
  if (!lines.length) lines.push("Those courses don't share a conflict-free week under these constraints.");
  return lines.join(" ");
}

function minutesToTime(minutes?: number | null): string {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function copyCrns(sections: CourseSection[]) {
  const text = sections.map((section) => section.crn).join(", ");
  await navigator.clipboard.writeText(text);
}

async function shareImage(
  sections: CourseSection[],
  title: string,
  colorFor: (section: CourseSection) => number,
  startHour: number,
  endHour: number,
  weekends: boolean,
) {
  const days = weekends ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const width = 120 + days.length * 160;
  const height = 80 + (endHour - startHour) * 36;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);
  ctx.fillStyle = "#fffcf8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1c1416";
  ctx.font = "600 18px sans-serif";
  ctx.fillText(title, 16, 32);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#6e6164";
  ctx.fillText("Term Organize · unofficial", 16, 52);
  const top = 70;
  const span = (endHour - startHour) * 60;
  days.forEach((day, column) => {
    const x = 70 + column * 160;
    ctx.fillStyle = "#6e6164";
    ctx.fillText(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]!, x, top);
  });
  for (const section of sections) {
    const color = courseColorAt(colorFor(section));
    for (const meeting of section.meetings) {
      if (meeting.start == null || meeting.end == null) continue;
      for (let day = 0; day < 7; day++) {
        if ((meeting.days & (1 << day)) === 0) continue;
        const column = days.indexOf(day);
        if (column < 0) continue;
        const x = 70 + column * 160;
        const y = top + 8 + ((meeting.start - startHour * 60) / span) * ((endHour - startHour) * 36);
        const h = Math.max(18, ((meeting.end - meeting.start) / span) * ((endHour - startHour) * 36));
        ctx.fillStyle = color.stroke;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x, y, 150, h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color.text;
        ctx.fillText(`${section.subject} ${section.number}`, x + 6, y + 14);
        ctx.fillText(timeLabel(meeting.start), x + 6, y + 28);
      }
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^\w.-]+/g, "-")}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
