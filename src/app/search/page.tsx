"use client";

import { courseHref, NuChips, SeatText } from "@/components/bits";
import { useRovingRows } from "@/components/roving-selection";
import { Button, TextInput } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { availabilityLabel } from "@/lib/catalog-index";
import type { CourseSection, LevelBand, SearchFilters, SearchSort } from "@/lib/models";
import { DAY_SHORT, NU_PATHS, creditsLabel, emptySearchFilters, instructorDisplayName, keyId, searchFilterCount } from "@/lib/models";
import { courseCpsNote } from "@/lib/restrictions";
import { searchCatalog, type SearchResult } from "@/lib/search";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

function SearchScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { index, catalogStatus, catalogDetail, catalogError, rememberSearch, user, updateUser, termCode } = useApp();
  const initial = params.get("q") ?? "";
  const [text, setText] = useState(initial);
  const [filters, setFilters] = useState<SearchFilters>(emptySearchFilters());
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => setText(initial), [initial]);

  useEffect(() => {
    const band = user.preferences.searchLevel;
    if (!band) return;
    setFilters((current) => (current.levelBand === band ? current : { ...current, levelBand: band }));
  }, [user.preferences.searchLevel]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = text.trim();
      const current = params.get("q") ?? "";
      if (next === current) return;
      const query = next ? `?q=${encodeURIComponent(next)}` : "";
      router.replace(`/search${query}`);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [text, params, router]);

  useEffect(() => {
    if (initial.trim().length >= 2) rememberSearch(initial.trim());
  }, [initial, rememberSearch]);

  const response = useMemo(() => {
    if (!index) return null;
    if (!text.trim() && searchFilterCount(filters) === 0) return null;
    return searchCatalog(index, text, filters, sort);
  }, [index, text, filters, sort]);

  const shown = response?.results.slice(0, 80) ?? [];
  const rows = useRovingRows(shown.length);
  const selectedCourse = rows.selected != null ? shown[rows.selected] : null;

  function chooseLevel(band: LevelBand) {
    setFilters((current) => ({ ...current, levelBand: band }));
    updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, searchLevel: band } }));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="label grow">
          Search
          <TextInput value={text} onChange={(event) => setText(event.target.value)} placeholder="fundies, orgo, CS 3000, 12345" />
        </label>
        <label className="label">
          Sort
          <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}>
            <option value="relevance">Relevance</option>
            <option value="courseNumber">Course number</option>
            <option value="title">Title</option>
            <option value="openSeats">Open seats</option>
          </select>
        </label>
        <Button variant="ghost" type="button" onClick={() => setShowFilters((value) => !value)}>
          Filters{searchFilterCount(filters) ? ` (${searchFilterCount(filters)})` : ""}
        </Button>
      </div>

      {showFilters && index ? (
        <div className="card grid gap-4 p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <div className="label">Undergrad or grad</div>
            <div role="radiogroup" aria-label="Undergrad or grad" className="mt-1 inline-flex rounded-full border border-line p-0.5">
              {(["all", "undergrad", "grad"] as const).map((band) => {
                const on = (filters.levelBand ?? "all") === band;
                const label = band === "all" ? "All" : band === "undergrad" ? "Undergrad" : "Grad";
                return (
                  <button
                    key={band}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`rounded-full px-3 py-1 text-sm ${on ? "bg-accent text-white" : "text-muted"}`}
                    onClick={() => chooseLevel(band)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="label">
            Subject
            <select
              className="select"
              value={filters.subjects[0] ?? ""}
              onChange={(event) => setFilters({ ...filters, subjects: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">Any subject</option>
              {index.activeSubjects.map((subject) => (
                <option key={subject.code} value={subject.code}>
                  {subject.code} — {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Campus
            <select
              className="select"
              value={filters.campuses[0] ?? ""}
              onChange={(event) => setFilters({ ...filters, campuses: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">Any campus</option>
              {index.campusNames.map((campus) => (
                <option key={campus}>{campus}</option>
              ))}
            </select>
          </label>
          <label className="label">
            Level
            <select
              className="select"
              value={filters.levels[0] ?? ""}
              onChange={(event) => setFilters({ ...filters, levels: event.target.value ? [Number(event.target.value)] : [] })}
            >
              <option value="">Any level</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => (
                <option key={level} value={level}>
                  {level}000
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Format
            <select className="select" value={filters.instruction} onChange={(event) => setFilters({ ...filters, instruction: event.target.value as SearchFilters["instruction"] })}>
              <option value="any">In person or online</option>
              <option value="inPerson">In person</option>
              <option value="online">Online</option>
            </select>
          </label>
          <label className="label flex-row items-center gap-2">
            <input type="checkbox" checked={filters.openSeatsOnly} onChange={(event) => setFilters({ ...filters, openSeatsOnly: event.target.checked })} />
            Open seats only
          </label>
          <label className="label flex-row items-center gap-2">
            <input type="checkbox" checked={filters.honorsOnly} onChange={(event) => setFilters({ ...filters, honorsOnly: event.target.checked })} />
            Honors sections
          </label>
          <label className="label flex-row items-center gap-2">
            <input type="checkbox" checked={filters.noPrerequisites} onChange={(event) => setFilters({ ...filters, noPrerequisites: event.target.checked })} />
            No prerequisites
          </label>
          <label className="label flex-row items-center gap-2">
            <input type="checkbox" checked={filters.noCorequisites} onChange={(event) => setFilters({ ...filters, noCorequisites: event.target.checked })} />
            No corequisites
          </label>
          <div className="label md:col-span-2">
            NUpath (every selected area)
            <div className="flex flex-wrap gap-1">
              {NU_PATHS.map((path) => {
                const on = filters.nupaths.includes(path.code);
                return (
                  <button
                    key={path.code}
                    type="button"
                    className={`chip ${on ? "border-accent text-accent" : ""}`}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        nupaths: on ? filters.nupaths.filter((code) => code !== path.code) : [...filters.nupaths, path.code],
                      })
                    }
                  >
                    {path.short}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="label md:col-span-2">
            Meets only on
            <div className="flex flex-wrap gap-1">
              {DAY_SHORT.map((label, index) => {
                return (
                  <button
                    key={label}
                    type="button"
                    className={`chip ${filters.allowedDays != null && (filters.allowedDays & (1 << index)) !== 0 ? "border-accent text-accent" : ""}`}
                    onClick={() => {
                      const current = filters.allowedDays ?? 0;
                      const next = current ^ (1 << index);
                      setFilters({ ...filters, allowedDays: next === 0 ? null : next });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <label className="label">
              Starts after
              <input className="field" type="time" value={minutesToTime(filters.startsAfter)} onChange={(event) => setFilters({ ...filters, startsAfter: timeToMinutes(event.target.value) })} />
            </label>
            <label className="label">
              Ends before
              <input className="field" type="time" value={minutesToTime(filters.endsBefore)} onChange={(event) => setFilters({ ...filters, endsBefore: timeToMinutes(event.target.value) })} />
            </label>
            <label className="label">
              Min credits
              <input className="field" inputMode="decimal" value={filters.minCredits ?? ""} onChange={(event) => setFilters({ ...filters, minCredits: event.target.value ? Number(event.target.value) : null })} />
            </label>
            <label className="label">
              Max credits
              <input className="field" inputMode="decimal" value={filters.maxCredits ?? ""} onChange={(event) => setFilters({ ...filters, maxCredits: event.target.value ? Number(event.target.value) : null })} />
            </label>
          </div>
          <Button
            className="justify-self-start md:col-span-2"
            variant="ghost"
            type="button"
            onClick={() => {
              setFilters(emptySearchFilters());
              updateUser((prev) => ({ ...prev, preferences: { ...prev.preferences, searchLevel: "all" } }));
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}

      {catalogStatus === "loading" && !index ? <p className="state text-muted">Loading the catalog…</p> : null}
      {catalogStatus === "building" ? <p className="state text-muted">{catalogDetail ?? "Downloading every section of this term from Banner…"}</p> : null}
      {catalogStatus === "ready" && catalogDetail ? <p className="text-sm text-muted">{catalogDetail}</p> : null}
      {catalogStatus === "error" ? <p className="state text-bad">{catalogError ?? "The catalog did not load. Refresh the page."}</p> : null}

      {!text.trim() && searchFilterCount(filters) === 0 ? (
        <div className="grid gap-3">
          <p className="state text-muted">Search by course, title, or a shorthand like fundies, orgo, or linalg. A CRN works too, and filters work on their own.</p>
          {user.searchHistory.length ? (
            <div className="flex flex-wrap gap-2">
              {user.searchHistory.map((item) => (
                <button key={item} className="chip" type="button" onClick={() => setText(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {response?.crnMatch ? (
        <Link className="card block p-4" href={`/section/${termCode}/${response.crnMatch.crn}`}>
          <div className="text-sm text-muted">CRN match</div>
          <div className="font-semibold">
            {keyId({ subject: response.crnMatch.subject, number: response.crnMatch.number })} · {response.crnMatch.crn}
          </div>
          <div className="text-sm">{response.crnMatch.title}</div>
        </Link>
      ) : null}

      {response && response.instructors.length ? (
        <div className="flex flex-wrap gap-2">
          {response.instructors.map((instructor) => (
            <Link key={instructor.name} className="chip" href={`/professor/${encodeURIComponent(instructor.name)}`}>
              {instructorDisplayName(instructor.name)}
            </Link>
          ))}
        </div>
      ) : null}

      {response ? (
        <p className="text-sm text-muted">
          {response.results.length.toLocaleString()} course{response.results.length === 1 ? "" : "s"}
          {response.results.length > shown.length ? ` · showing ${shown.length}` : ""}
        </p>
      ) : null}

      {shown.length ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div role="listbox" aria-label="Search results" className="grid gap-2">
            {shown.map((result, rowIndex) => {
              const key = { subject: result.course.subject, number: result.course.number };
              const note = index ? courseCpsNote(index.sectionsOf(key)) : null;
              const picked = rows.selected === rowIndex;
              return (
                <div
                  key={result.id}
                  role="option"
                  aria-selected={picked}
                  tabIndex={rows.tabIndex(rowIndex)}
                  ref={(node) => {
                    rows.itemRefs.current[rowIndex] = node;
                  }}
                  className={`card block w-full cursor-pointer p-4 text-left hover:border-accent ${picked ? "border-accent" : ""}`}
                  onClick={() => rows.select(rowIndex)}
                  onKeyDown={(event) => rows.move(event, rowIndex)}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold">
                      <Link className="underline" href={courseHref(termCode, key)}>
                        {keyId(key)}
                      </Link>{" "}
                      <span className="font-normal text-muted">{result.course.title}</span>
                    </div>
                    <div className="text-sm">{creditsLabel(result.course.minCredits, result.course.maxCredits)}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{availabilityLabel(result.stats)}</span>
                    <SeatText remaining={result.stats.seatsRemaining} capacity={result.stats.seatCapacity} />
                    <NuChips attributes={result.course.attributes} />
                  </div>
                  {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
                </div>
              );
            })}
          </div>
          <CourseDetails
            result={selectedCourse}
            termCode={termCode}
            sections={selectedCourse && index ? index.sectionsOf({ subject: selectedCourse.course.subject, number: selectedCourse.course.number }) : []}
          />
        </div>
      ) : null}
      {response && response.results.length === 0 ? <p className="state text-muted">Nothing matched. Check the subject code or loosen a filter.</p> : null}
    </div>
  );
}

function CourseDetails({
  result,
  termCode,
  sections,
}: {
  result: SearchResult | null;
  termCode: string;
  sections: CourseSection[];
}) {
  if (!result) {
    return (
      <aside className="card p-4 text-sm text-muted" aria-label="Course details">
        Select a course.
      </aside>
    );
  }
  const key = { subject: result.course.subject, number: result.course.number };
  const note = courseCpsNote(sections);
  return (
    <aside className="card grid gap-2 p-4" aria-label="Course details">
      <p className="text-sm font-semibold text-accent">{keyId(key)}</p>
      <h2 className="font-semibold">{result.course.title}</h2>
      <p className="text-sm text-muted">{creditsLabel(result.course.minCredits, result.course.maxCredits)}</p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {result.course.description ? <p className="line-clamp-6 text-sm leading-relaxed">{result.course.description}</p> : null}
      <Link className="text-sm underline" href={courseHref(termCode, key)}>
        Open course
      </Link>
    </aside>
  );
}

function minutesToTime(minutes?: number | null): string {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="state text-muted">Loading search…</p>}>
      <SearchScreen />
    </Suspense>
  );
}
