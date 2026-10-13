"use client";

import { courseHref, NuChips, SeatText } from "@/components/bits";
import { Button, TextInput } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { availabilityLabel } from "@/lib/catalog-index";
import type { SearchFilters, SearchSort } from "@/lib/models";
import { DAY_SHORT, NU_PATHS, creditsLabel, emptySearchFilters, instructorDisplayName, keyId, searchFilterCount } from "@/lib/models";
import { searchCatalog } from "@/lib/search";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

function SearchScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { index, catalogStatus, catalogDetail, catalogError, rememberSearch, user, termCode } = useApp();
  const initial = params.get("q") ?? "";
  const [text, setText] = useState(initial);
  const [filters, setFilters] = useState<SearchFilters>(emptySearchFilters());
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => setText(initial), [initial]);

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

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="label grow">
          Search
          <TextInput value={text} onChange={(event) => setText(event.target.value)} placeholder="fundies, orgo, CS 3000, 12345" autoFocus />
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
            variant="ghost"
            type="button"
            onClick={() => setFilters(emptySearchFilters())}
          >
            Clear filters
          </Button>
        </div>
      ) : null}

      {catalogStatus === "loading" && !index ? <p className="text-muted">Loading the catalog…</p> : null}
      {catalogStatus === "building" ? <p className="text-muted">{catalogDetail ?? "Downloading every section of this term from Banner…"}</p> : null}
      {catalogStatus === "error" ? <p className="text-bad">{catalogError ?? "The catalog did not load."}</p> : null}

      {!text.trim() && searchFilterCount(filters) === 0 ? (
        <div className="grid gap-3">
          <p className="text-muted">Try a shorthand like fundies, orgo, or linalg. Typos within a small edit distance still match.</p>
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

      <ul className="grid gap-2">
        {shown.map((result) => {
          const key = { subject: result.course.subject, number: result.course.number };
          return (
            <li key={result.id}>
              <Link href={courseHref(termCode, key)} className="card block p-4 hover:border-accent">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">
                    {keyId(key)} <span className="font-normal text-muted">{result.course.title}</span>
                  </div>
                  <div className="text-sm">{creditsLabel(result.course.minCredits, result.course.maxCredits)}</div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{availabilityLabel(result.stats)}</span>
                  <SeatText remaining={result.stats.seatsRemaining} capacity={result.stats.seatCapacity} />
                  <NuChips attributes={result.course.attributes} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {response && response.results.length === 0 ? <p className="text-muted">Nothing matched. Check the subject code or loosen a filter.</p> : null}
    </div>
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
    <Suspense fallback={<p className="text-muted">Loading search…</p>}>
      <SearchScreen />
    </Suspense>
  );
}
