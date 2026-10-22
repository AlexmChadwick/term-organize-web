"use client";

import { WeekCalendar, blocksFromSections, courseHref, type CalendarBlock } from "@/components/bits";
import { CreditStepper } from "@/components/credit-stepper";
import { setScheduleRowCredits } from "@/lib/credit-sync";
import { courseCpsNote } from "@/lib/restrictions";
import { defaultChosenCredits, isVariableCredit, rowIsVariable } from "@/lib/variable-credits";
import { SemesterMoves } from "@/components/semester-moves";
import { Button, TextArea, TextInput } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { planTermMatches, scheduleSuggestions } from "@/lib/degree-logic";
import { sectionsToICS, downloadText } from "@/lib/ics";
import { interpretPreferences } from "@/lib/nl";
import type { CourseKey, CourseSection } from "@/lib/models";
import { DAY_SHORT, courseColorAt, courseColorIndex, dayIndices, keyId, scheduleSummary, sectionsConflict, termName, timeLabel } from "@/lib/models";
import { searchCatalog as runSearch } from "@/lib/search";
import { blockedTimeIsValid, emptyPreferences, schedulePreferencesContext, TIME_BANDS, TIME_BAND_RANGE, bandPreference, setBandPreference, type BlockedTime, type TimeBand, type TimePreference } from "@/lib/preferences";
import { ScheduleSurveyExtras } from "@/components/schedule-survey";
import { generateOffThread } from "@/lib/schedule/generate-client";
import { courseInputsFor, ScheduleNoResultsText, type ScheduleGenerationResult, type ScheduleNoResults, type ScheduleSortOption } from "@/lib/schedule";
import { applyCourseMoves, applyGeneratedCRNs, ensureManualPins, placePlanCourse, removePlanEntry, selectSectionOnPlan } from "@/lib/schedule/pins";
import { applyMoveToPlan, type MoveOption } from "@/lib/semester-moves";
import { newId } from "@/lib/user";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

export default function SchedulePage() {
  const app = useApp();
  const { index, plan, ensurePlan, updatePlan, user, updateUser, termCode, catalogStatus, catalogDetail, catalogError } = app;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ScheduleSortOption>("best");
  const [message, setMessage] = useState<string | null>(null);
  const [emptyHelp, setEmptyHelp] = useState<ScheduleNoResults | null>(null);
  const [wish, setWish] = useState("");
  const [results, setResults] = useState<ScheduleGenerationResult | null>(null);
  const [picked, setPicked] = useState(0);
  const [generating, setGenerating] = useState(false);
  const generation = useRef(0);
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
    return runSearch(index, query, { subjects: [], nupaths: [], levels: [], campuses: [], classTypes: [], honorsOnly: false, openSeatsOnly: false, noPrerequisites: false, noCorequisites: false, instruction: "any" }, "relevance").results.slice(0, 6);
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
    const course =
      active?.courses.find((item) => item.pinnedCRN === section.crn) ??
      active?.courses.find((item) => item.key.subject === section.subject && item.key.number === section.number && !item.pinnedCRN) ??
      active?.courses.find((item) => item.key.subject === section.subject && item.key.number === section.number);
    return course?.colorIndex ?? courseColorIndex(keyId({ subject: section.subject, number: section.number }));
  }

  function add(key: CourseKey, pinnedCRN?: string | null) {
    const target = current();
    const listed = index?.course(key);
    const chosen =
      listed && isVariableCredit(listed.minCredits, listed.maxCredits)
        ? {
            credits: defaultChosenCredits({ low: listed.minCredits, high: listed.maxCredits, creditHours: listed.defaultCredits }),
            creditLow: listed.minCredits,
            creditHigh: listed.maxCredits,
          }
        : undefined;
    updatePlan(target.id, (item) => placePlanCourse(item, key, pinnedCRN, chosen));
    setQuery("");
  }

  function run() {
    if (!index || generating) return;
    const target = ensureManualPins(current(), (crn) => index.sectionByCRN(crn));
    if (target !== current()) updatePlan(target.id, () => target);
    const inputs = courseInputsFor(target.courses, {
      course: (key) => index.course(key) ?? null,
      sectionsFor: (key) => index.sectionsOf(key),
      sectionByCrn: (crn) => index.sectionByCRN(crn),
    });
    const id = ++generation.current;
    setGenerating(true);
    setMessage("Generating schedules…");
    setEmptyHelp(null);
    void generateOffThread({
      courses: inputs,
      filters: target.filters,
      preferences: target.preferences ?? emptyPreferences(),
      sort,
      termLabel: termName(index.catalog.term),
    }).then((outcome) => {
      if (id !== generation.current) return;
      setResults(outcome.result);
      setPicked(0);
      setEmptyHelp(outcome.empty);
      setMessage(outcome.message);
      setGenerating(false);
    });
  }

  if (!index) {
    return (
      <p className="text-muted">
        {catalogStatus === "building"
          ? (catalogDetail ?? "Downloading every section of this term from Banner…")
          : catalogStatus === "error"
            ? (catalogError ?? "The catalog did not load.")
            : "Loading the catalog for the schedule builder…"}
      </p>
    );
  }

  const prefs = active?.preferences ?? emptyPreferences();
  const hours = { start: user.preferences.calendarStartHour, end: user.preferences.calendarEndHour };
  const degreePlan = user.degreePlans.find((item) => item.isPrimary) ?? user.degreePlans[0] ?? null;
  const matchingSemester = degreePlan?.terms.find((term) => planTermMatches(term, index.catalog.term)) ?? null;

  function makeOptional(keys: CourseKey[]) {
    const ids = new Set(keys.map((key) => keyId(key)));
    updatePlan(current().id, (item) => ({
      ...item,
      courses: item.courses.map((course) => (ids.has(keyId(course.key)) ? { ...course, isRequired: false } : course)),
    }));
  }

  function applyScheduleMove(option: MoveOption) {
    if (!degreePlan) return;
    const next = applyMoveToPlan(option.suggestion, degreePlan);
    if (JSON.stringify(next.terms) === JSON.stringify(degreePlan.terms)) {
      setMessage("Your degree plan changed. Check the updated suggestions.");
      return;
    }
    updateUser((prev) => ({
      ...prev,
      degreePlans: prev.degreePlans.map((item) => (item.id === degreePlan.id ? { ...next, updatedAt: Date.now() } : item)),
    }));
    const catalog = index;
    if (!catalog) return;
    updatePlan(current().id, (item) =>
      applyCourseMoves(item, option.movedAway, option.movedIn, (key) => catalog.sectionsOf(key), option.movedAwayCRNs),
    );
    setMessage(option.scheduleEffect ? `${option.appliedText} ${option.scheduleEffect}` : option.appliedText);
    setEmptyHelp(null);
    setResults(null);
  }

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
                manualPinsMigrated: true,
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

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
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
                  suggestions[0]!.courses.forEach((key, index) => add(key, suggestions[0]!.crns?.[index]));
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
              {(active?.courses ?? []).map((course, courseIndex) => {
                const listed = index.course(course.key);
                const sections = index.sectionsOf(course.key);
                const chosen = sections.find((section) => section.crn === course.pinnedCRN) ?? sections.find((section) => active?.selectedCRNs.includes(section.crn) && !active.courses.some((entry, index) => index !== courseIndex && entry.pinnedCRN === section.crn));
                const color = courseColorAt(course.colorIndex);
                return (
                  <li key={`${keyId(course.key)}-${course.pinnedCRN ?? courseIndex}`} className="rounded-2xl border border-line p-3" style={{ borderColor: color.stroke }}>
                    <div className="flex items-start justify-between gap-2">
                      <Link className="font-semibold underline" href={courseHref(termCode, course.key)}>
                        {keyId(course.key)}
                        {course.pinnedCRN ? <span className="text-muted"> · CRN {course.pinnedCRN}</span> : null}
                      </Link>
                      <button className="text-sm text-muted" type="button" onClick={() => updatePlan(active!.id, (item) => removePlanEntry(item, courseIndex, sections))}>
                        Remove
                      </button>
                    </div>
                    <p className="text-sm text-muted">{listed?.title}</p>
                    {courseCpsNote(sections) ? <p className="text-xs text-muted">{courseCpsNote(sections)}</p> : null}
                    {rowIsVariable(course) ? (
                      <CreditStepper
                        credits={course.credits ?? course.creditLow!}
                        low={course.creditLow!}
                        high={course.creditHigh!}
                        onChange={(value) => updateUser((prev) => setScheduleRowCredits(prev, active!.id, courseIndex, value))}
                      />
                    ) : null}
                    <label className="mt-1 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={course.isRequired}
                        onChange={(event) => updatePlan(active!.id, (item) => ({ ...item, courses: item.courses.map((entry, index) => (index === courseIndex ? { ...entry, isRequired: event.target.checked } : entry)) }))}
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
                          updatePlan(active!.id, (item) => selectSectionOnPlan(item, courseIndex, crn, sections));
                        }}
                      >
                        <option value="">Not chosen</option>
                        {sections.map((section) => (
                          <option key={section.crn} value={section.crn}>
                            {sectionChoice(section)}
                          </option>
                        ))}
                      </select>
                    </label>
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
              blocks={[...blocksFromSections(selected, colorFor, termCode), ...blocksFromBlocked(prefs.blockedTimes)]}
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
            <Button type="button" variant="ghost" onClick={() => void shareImage(selected, active?.name ?? "Schedule", colorFor, hours.start, hours.end, user.preferences.showWeekends, prefs.blockedTimes)}>
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
              {prefs.earliestStart ? (
                <label className="label">
                  Early classes
                  <select className="select" value={prefs.earliestStart.strength} onChange={(event) => setLimitStrength("earliestStart", event.target.value as "preferred" | "required")}>
                    <option value="required">Always</option>
                    <option value="preferred">If possible</option>
                  </select>
                </label>
              ) : null}
              {prefs.latestEnd ? (
                <label className="label">
                  Late classes
                  <select className="select" value={prefs.latestEnd.strength} onChange={(event) => setLimitStrength("latestEnd", event.target.value as "preferred" | "required")}>
                    <option value="required">Always</option>
                    <option value="preferred">If possible</option>
                  </select>
                </label>
              ) : null}
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
            <BlockedTimesEditor
              blocks={prefs.blockedTimes}
              onChange={(blockedTimes) =>
                updatePlan(current().id, (item) => ({
                  ...item,
                  preferences: { ...(item.preferences ?? emptyPreferences()), blockedTimes },
                }))
              }
            />
            <InstructorNames
              label="Prefer these professors"
              placeholder="Last, First — press Enter"
              names={prefs.preferredInstructors}
              onChange={(preferredInstructors) =>
                updatePlan(current().id, (item) => ({
                  ...item,
                  preferences: { ...(item.preferences ?? emptyPreferences()), preferredInstructors },
                }))
              }
            />
            <InstructorNames
              label="Avoid these professors"
              placeholder="Last, First — press Enter"
              names={prefs.avoidedInstructors}
              onChange={(avoidedInstructors) =>
                updatePlan(current().id, (item) => ({
                  ...item,
                  preferences: { ...(item.preferences ?? emptyPreferences()), avoidedInstructors },
                }))
              }
            />
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
            <ScheduleSurveyExtras
              prefs={prefs}
              credits={schedulePreferencesContext(active ?? { courses: [] }, index)}
              onChange={(preferences) => updatePlan(current().id, (item) => ({ ...item, preferences }))}
            />
            <label className="label flex-row items-center gap-2">
              <input type="checkbox" checked={active?.filters.hideFullSections ?? false} onChange={(event) => updatePlan(current().id, (item) => ({ ...item, filters: { ...item.filters, hideFullSections: event.target.checked } }))} />
              Hide full sections
            </label>
            <Button type="button" onClick={run} disabled={generating}>
              {generating ? "Generating schedules…" : "Generate schedules"}
            </Button>
            {message ? <p className="text-sm text-muted">{message}</p> : null}
            {emptyHelp && results && results.schedules.length === 0 ? (
              <EmptyGeneration help={emptyHelp} termLabel={termName(index.catalog.term)} onOptional={makeOptional} degree={degreePlan} semesterID={matchingSemester?.id ?? null} index={index} onMove={applyScheduleMove} />
            ) : null}
            {results && results.schedules.length ? (
              <ScheduleOption
                schedule={results.schedules[Math.min(picked, results.schedules.length - 1)]!}
                rank={Math.min(picked, results.schedules.length - 1)}
                total={results.schedules.length}
                onPick={setPicked}
                onUse={(crns) => updatePlan(current().id, (item) => applyGeneratedCRNs(item, crns, (crn) => index.sectionByCRN(crn)))}
              />
            ) : null}
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

  function setLimitStrength(field: "earliestStart" | "latestEnd", strength: "preferred" | "required") {
    updatePlan(current().id, (item) => {
      const base = item.preferences ?? emptyPreferences();
      const limit = base[field];
      if (!limit) return item;
      return { ...item, preferences: { ...base, [field]: { ...limit, strength } } };
    });
  }

  function setLimit(field: "earliestStart" | "latestEnd", value: string) {
    updatePlan(current().id, (item) => {
      const base = item.preferences ?? emptyPreferences();
      const minutes = timeToMinutes(value);
      const previous = base[field];
      return { ...item, preferences: { ...base, [field]: minutes == null ? null : { minutes, strength: previous?.strength ?? "required" } } };
    });
  }
}

function ScheduleOption({
  schedule,
  rank,
  total,
  onPick,
  onUse,
}: {
  schedule: ScheduleGenerationResult["schedules"][number];
  rank: number;
  total: number;
  onPick: (index: number) => void;
  onUse: (crns: string[]) => void;
}) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>
          Option {rank + 1} of {total}
        </strong>
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
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="tiny" type="button" onClick={() => onPick(Math.max(0, rank - 1))} disabled={rank === 0}>
          Previous
        </Button>
        <Button className="tiny" type="button" onClick={() => onPick(Math.min(total - 1, rank + 1))} disabled={rank >= total - 1}>
          Next
        </Button>
        <Button className="tiny" type="button" onClick={() => onUse(schedule.crns)}>
          Use this week
        </Button>
        <Button className="tiny" variant="ghost" type="button" onClick={() => copyCrns(schedule.sections)}>
          Copy CRNs
        </Button>
      </div>
    </div>
  );
}

function EmptyGeneration({
  help,
  termLabel,
  onOptional,
  degree,
  semesterID,
  index,
  onMove,
}: {
  help: ScheduleNoResults;
  termLabel: string;
  onOptional: (keys: CourseKey[]) => void;
  degree: import("@/lib/requirements").DegreePlan | null;
  semesterID: string | null;
  index: import("@/lib/catalog-index").CatalogIndex;
  onMove: (option: MoveOption) => void;
}) {
  const blocking = help.blockers.allBlockingCourses.slice(0, 4);
  return (
    <div className="grid gap-3">
      {help.blockers.options.slice(0, 4).map((option) => (
        <div key={option.id} className="rounded-2xl border border-line p-3">
          <strong className="text-sm">Works without {ScheduleNoResultsText.list(option.courses)}</strong>
          <p className="mt-1 text-sm text-muted">{ScheduleNoResultsText.detail(option, help.blockers, termLabel)}</p>
          <Button className="tiny mt-2" type="button" onClick={() => onOptional(option.courses)}>
            {option.courses.length === 1 ? "Make optional" : "Make all optional"}
          </Button>
        </div>
      ))}
      {!degree && blocking.length ? <p className="text-sm text-muted">Import a degree plan to get suggestions for moving a course to another semester.</p> : null}
      {degree && semesterID && blocking.length ? <SemesterMoves plan={degree} termID={semesterID} blocking={blocking} index={index} onApply={onMove} /> : null}
    </div>
  );
}

function sectionChoice(section: CourseSection): string {
  const when = scheduleSummary(section).replaceAll(" – ", "–");
  return `${section.crn} · ${when} · ${Math.max(0, section.seatsRemaining)} open`;
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

const BLOCKED_PAINT = { fill: "var(--blocked-fill)", stroke: "var(--blocked-stroke)", text: "var(--blocked-ink)" };
const NAME_IDEAS = ["Club meeting", "Work", "Commute", "Team practice", "Appointment", "Study group"];

function blocksFromBlocked(blocks: BlockedTime[]) {
  const out: CalendarBlock[] = [];
  for (const block of blocks) {
    if (!blockedTimeIsValid(block) || !block.isEnabled) continue;
    for (const day of dayIndices(block.days)) {
      out.push({
        id: `${block.id}-${day}`,
        day,
        start: block.start,
        end: block.end,
        title: block.label.trim() || "Blocked",
        detail: block.strength === "preferred" ? "If I must" : "Blocked",
        colorIndex: 0,
        paint: BLOCKED_PAINT,
      });
    }
  }
  return out;
}

function BlockedTimesEditor({ blocks, onChange }: { blocks: BlockedTime[]; onChange: (next: BlockedTime[]) => void }) {
  function patch(id: string, change: Partial<BlockedTime>) {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...change } : block)));
  }
  return (
    <div className="grid gap-2">
      <div>
        <h3 className="font-semibold">Blocked times</h3>
        <p className="text-sm text-muted">Classes won’t be scheduled over these. Think club meetings, work, a commute, or practice.</p>
      </div>
      {blocks.map((block) => (
        <div key={block.id} className="grid gap-2 rounded-xl border border-line p-3">
          <TextInput aria-label="Blocked time name" value={block.label} placeholder="Name" onChange={(event) => patch(block.id, { label: event.target.value })} />
          <div className="flex flex-wrap gap-1">
            {NAME_IDEAS.map((idea) => (
              <button key={idea} className="chip" type="button" onClick={() => patch(block.id, { label: idea })}>
                {idea}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {DAY_SHORT.map((label, day) => {
              const on = (block.days & (1 << day)) !== 0;
              return (
                <button key={label} className={`chip ${on ? "border-accent text-accent" : ""}`} type="button" onClick={() => patch(block.id, { days: (block.days ^ (1 << day)) as BlockedTime["days"] })}>
                  {on ? `${label} blocked` : label}
                </button>
              );
            })}
          </div>
          {block.days === 0 ? <p className="text-sm text-warn">Choose at least one day.</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="label">
              Starts
              <input
                className="field"
                type="time"
                value={minutesToTime(block.start)}
                onChange={(event) => {
                  const minutes = timeToMinutes(event.target.value);
                  if (minutes == null) return;
                  const end = block.end <= minutes ? Math.min(minutes + 60, 24 * 60 - 1) : block.end;
                  patch(block.id, { start: minutes, end });
                }}
              />
            </label>
            <label className="label">
              Ends
              <input
                className="field"
                type="time"
                value={minutesToTime(block.end)}
                onChange={(event) => {
                  const minutes = timeToMinutes(event.target.value);
                  if (minutes == null) return;
                  patch(block.id, { end: minutes });
                }}
              />
            </label>
          </div>
          {block.end <= block.start ? <p className="text-sm text-warn">It has to end after it starts.</p> : null}
          <label className="label">
            Classes during this time
            <select className="select" value={block.strength} onChange={(event) => patch(block.id, { strength: event.target.value as BlockedTime["strength"] })}>
              <option value="required">Never</option>
              <option value="preferred">If I must</option>
            </select>
          </label>
          <p className="text-sm text-muted">
            {block.strength === "required"
              ? "Sections that meet during this time are left out of your schedules."
              : "Schedules that avoid this time come first, but sections that overlap it can still show up."}
          </p>
          <label className="label flex-row items-center gap-2">
            <input type="checkbox" checked={block.isEnabled} onChange={(event) => patch(block.id, { isEnabled: event.target.checked })} />
            Use this blocked time
          </label>
          {!block.isEnabled ? <p className="text-sm text-muted">Turned off, it is kept but ignored.</p> : null}
          <Button variant="ghost" type="button" onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}>
            Delete blocked time
          </Button>
        </div>
      ))}
      <Button
        variant="soft"
        type="button"
        onClick={() => onChange([...blocks, { id: newId(), label: "", days: 0, start: 17 * 60, end: 19 * 60, strength: "required", isEnabled: true }])}
      >
        Add blocked time
      </Button>
    </div>
  );
}

function InstructorNames({
  label,
  placeholder,
  names,
  onChange,
}: {
  label: string;
  placeholder: string;
  names: string[];
  onChange: (names: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="grid gap-1">
      <span className="label">{label}</span>
      {names.length ? (
        <div className="flex flex-wrap gap-1">
          {names.map((name) => (
            <button key={name} className="chip" type="button" onClick={() => onChange(names.filter((item) => item !== name))}>
              {name} ×
            </button>
          ))}
        </div>
      ) : null}
      <TextInput
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const name = draft.trim();
          if (!name || names.some((item) => item.toLowerCase() === name.toLowerCase())) return;
          onChange([...names, name]);
          setDraft("");
        }}
      />
    </div>
  );
}

async function shareImage(
  sections: CourseSection[],
  title: string,
  colorFor: (section: CourseSection) => number,
  startHour: number,
  endHour: number,
  weekends: boolean,
  blocked: BlockedTime[] = [],
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
  for (const block of blocked) {
    if (!blockedTimeIsValid(block) || !block.isEnabled) continue;
    for (const day of dayIndices(block.days)) {
      const column = days.indexOf(day);
      if (column < 0) continue;
      const x = 70 + column * 160;
      const y = top + 8 + ((block.start - startHour * 60) / span) * ((endHour - startHour) * 36);
      const h = Math.max(18, ((block.end - block.start) / span) * ((endHour - startHour) * 36));
      ctx.fillStyle = "#6e6164";
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x, y, 150, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#3d3336";
      ctx.fillText(block.label.trim() || "Blocked", x + 6, y + 14);
    }
  }
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
