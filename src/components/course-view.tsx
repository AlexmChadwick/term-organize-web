"use client";

import { NuChips, RequisiteTree, SeatText, courseHref, meetingLabel, sectionHref } from "@/components/bits";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { courseInfoCreditsLabel } from "@/lib/degree-logic";
import type { Course, CourseKey, CourseSection } from "@/lib/models";
import { courseKeyOf, creditsLabel, instructorLabel, keyId, nupathsFromAttributes, offeringTermLabel, referencedCourses, requisiteSummary, scheduleSummary, seatsLabel } from "@/lib/models";
import { retryCourseFacts, useCourseFacts, type CatalogEntry } from "@/lib/plan-course-info";
import { sortedSections as sortSections, type CatalogIndex } from "@/lib/catalog-index";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export function CourseView({ term, subject, number }: { term: string; subject: string; number: string }) {
  const { index, termCode, terms, setTermCode, addCourseToPlan, toggleSaved, isSaved, rememberCourse, watchSection, unwatch, isWatched, applyLive } = useApp();
  const key = useMemo(() => ({ subject, number }), [subject, number]);
  const catalogCourse = index?.course(key);
  const catalogSections = index?.sectionsOf(key) ?? [];
  const [liveCourse, setLiveCourse] = useState<Partial<Course> | null>(null);
  const [liveSections, setLiveSections] = useState<CourseSection[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "live">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (term !== termCode) setTermCode(term);
  }, [term, termCode, setTermCode]);

  useEffect(() => {
    rememberCourse(key);
  }, [key, rememberCourse]);

  const indexMatches = index?.catalog.term.code === term;
  const missingFromTerm = indexMatches && !catalogCourse;
  const facts = useCourseFacts(missingFromTerm ? { keys: [key], attributes: false, suggest: false } : null);
  const entry = facts.info(key);
  const entryState = facts.state(key);

  const course = catalogCourse ? { ...catalogCourse, ...liveCourse } : liveCourse;
  const sections = sortSections(liveSections ?? catalogSections);
  const termLabel = terms.find((item) => item.code === term)?.name ?? term;

  async function refresh() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/banner/course?term=${term}&subject=${subject}&number=${number}`);
      const body = (await res.json()) as { sections?: CourseSection[]; coursePatch?: Partial<Course>; error?: string };
      if (!res.ok) throw new Error(body.error || "Banner did not return this course.");
      setLiveSections(body.sections ?? []);
      setLiveCourse(body.coursePatch ?? {});
      if (index) applyLive(key, body.coursePatch ?? {}, body.sections ?? []);
      setStatus("live");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't refresh seats.");
    }
  }

  useEffect(() => {
    void refresh();
    // Refresh once when the course opens so seats are current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, subject, number]);

  const hasLiveSections = (liveSections?.length ?? 0) > 0;
  if (missingFromTerm && !hasLiveSections) {
    if (status === "idle" || status === "loading") return <p className="text-muted">Asking Banner for {subject} {number}…</p>;
    return (
      <CatalogEntry
        courseKey={key}
        term={term}
        termLabel={termLabel}
        entry={entry}
        state={entryState}
        sectionError={status === "error" ? error : null}
        dependents={dependentsOf(key, index)}
        onRetry={() => {
          void retryCourseFacts({ keys: [key], attributes: false, suggest: false });
          void refresh();
        }}
      />
    );
  }
  if (!course && status === "loading") return <p className="text-muted">Asking Banner for {subject} {number}…</p>;
  if (!course && status === "error") {
    return (
      <div className="card p-5">
        <h1 className="text-2xl font-semibold">{subject} {number}</h1>
        <p className="mt-2 text-bad">{error}</p>
        <Button className="mt-3" type="button" onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  }
  if (!course) return <p className="text-muted">Looking up {subject} {number}…</p>;

  const title = course.title || `${subject} ${number}`;
  const description = course.description || "No description in this snapshot yet.";

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-accent">{subject} {number}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">
            {course.minCredits != null && course.maxCredits != null ? creditsLabel(course.minCredits, course.maxCredits) : null}
            {course.college ? ` · ${course.college}` : ""}
            {course.department ? ` · ${course.department}` : ""}
          </p>
          <div className="mt-2">
            <NuChips attributes={course.attributes ?? []} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => addCourseToPlan(key)}>Add to schedule</Button>
          <Button variant="ghost" type="button" onClick={() => toggleSaved(key)}>{isSaved(key) ? "Saved" : "Save"}</Button>
          <Button variant="soft" type="button" onClick={() => void refresh()} disabled={status === "loading"}>
            {status === "loading" ? "Refreshing…" : "Refresh seats"}
          </Button>
        </div>
      </header>
      {error ? <p className="text-sm text-bad">{error} Showing the snapshot until Banner answers.</p> : null}
      {status === "live" ? <p className="text-sm text-good">Seats refreshed from Banner.</p> : null}

      <section className="card p-5">
        <h2 className="font-semibold">Description</h2>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{description}</p>
        {nupathsFromAttributes(course.attributes ?? []).length ? (
          <p className="mt-3 text-sm text-muted">{nupathsFromAttributes(course.attributes ?? []).map((path) => path.name).join(" · ")}</p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold">Prerequisites</h2>
          {course.prereqs ? (
            <>
              <p className="mt-2 text-sm text-muted">{requisiteSummary(course.prereqs)}</p>
              <div className="mt-3">
                <RequisiteTree node={course.prereqs} term={term} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">None listed.</p>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Corequisites</h2>
          {course.coreqs ? (
            <>
              <p className="mt-2 text-sm text-muted">{requisiteSummary(course.coreqs)}</p>
              <div className="mt-3">
                <RequisiteTree node={course.coreqs} term={term} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">None listed.</p>
          )}
          <h3 className="mt-5 font-semibold">Prerequisite for</h3>
          {course.postreqs?.length ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {course.postreqs.map((item) => (
                <li key={keyId(item)}>
                  <Link className="underline" href={courseHref(term, item)}>
                    {keyId(item)} {index?.course(item)?.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No later course in this snapshot lists it.</p>
          )}
        </section>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Sections</h2>
        {sections.length === 0 ? <p className="text-muted">No sections for this term.</p> : null}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>CRN</th>
                <th>Section</th>
                <th>When</th>
                <th>Instructor</th>
                <th>Seats</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.crn}>
                  <td>
                    <Link className="font-semibold underline" href={sectionHref(term, section.crn)}>
                      {section.crn}
                    </Link>
                  </td>
                  <td>
                    {section.classType} {section.sectionNumber}
                    {section.honors ? " · Honors" : ""}
                    <div className="text-xs text-muted">{section.campus}</div>
                  </td>
                  <td className="max-w-xs">{scheduleSummary(section)}<div className="text-xs text-muted">{meetingLabel(section)}</div></td>
                  <td>
                    {section.instructors?.[0] ? (
                      <Link className="underline" href={`/professor/${encodeURIComponent(section.instructors[0].name)}`}>
                        {instructorLabel(section)}
                      </Link>
                    ) : (
                      instructorLabel(section)
                    )}
                  </td>
                  <td>
                    <SeatText remaining={section.seatsRemaining} capacity={section.seatCapacity} />
                    <div className="text-xs text-muted">{seatsLabel(section)}</div>
                  </td>
                  <td>
                    <Button
                      className="tiny"
                      variant={isWatched(section.crn) ? "soft" : "ghost"}
                      type="button"
                      onClick={() => (isWatched(section.crn) ? unwatch(section.crn) : watchSection(section))}
                    >
                      {isWatched(section.crn) ? "Watching" : "Watch seats"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function dependentsOf(key: CourseKey, index: CatalogIndex | null): CourseKey[] {
  if (!index) return [];
  const id = keyId(key);
  return index.courses.flatMap((course) => {
    if (!course.prereqs || !referencedCourses(course.prereqs).some((item) => keyId(item) === id)) return [];
    return [courseKeyOf(course)];
  });
}

function CatalogEntry({
  courseKey,
  term,
  termLabel,
  entry,
  state,
  sectionError,
  dependents,
  onRetry,
}: {
  courseKey: CourseKey;
  term: string;
  termLabel: string;
  entry: CatalogEntry | null;
  state: "unknown" | "loading" | "found" | "notFound" | "failed";
  sectionError: string | null;
  dependents: CourseKey[];
  onRetry: () => void;
}) {
  const [stillFailing, setStillFailing] = useState(false);
  const code = `${courseKey.subject} ${courseKey.number}`;

  if (state === "unknown" || state === "loading") {
    return <p className="text-muted">Checking Banner&apos;s catalog…</p>;
  }
  if (state === "found" && entry) {
    const credits = courseInfoCreditsLabel(entry.minCredits, entry.maxCredits);
    const availability = entry.isRetired === true ? `No longer offered; last listed ${offeringTermLabel(entry.sourceTerm)}` : `Not offered in ${termLabel}`;
    return (
      <div className="grid gap-5">
        <header>
          <p className="text-sm font-semibold text-accent">{code}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{entry.title || code}</h1>
          <p className="mt-1 text-muted">{[credits, availability].filter(Boolean).join(" · ")}</p>
        </header>
        {sectionError ? <p className="text-sm text-muted">{sectionError}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card p-5">
            <h2 className="font-semibold">Prerequisites</h2>
            {entry.prerequisites ? (
              <>
                <p className="mt-2 text-sm text-muted">{requisiteSummary(entry.prerequisites)}</p>
                <div className="mt-3">
                  <RequisiteTree node={entry.prerequisites} term={term} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">None listed.</p>
            )}
          </section>
          <section className="card p-5">
            <h2 className="font-semibold">Corequisites</h2>
            {entry.corequisites ? (
              <>
                <p className="mt-2 text-sm text-muted">{requisiteSummary(entry.corequisites)}</p>
                <div className="mt-3">
                  <RequisiteTree node={entry.corequisites} term={term} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">None listed.</p>
            )}
            <h3 className="mt-5 font-semibold">Prerequisite for</h3>
            {dependents.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {dependents.map((item) => (
                  <li key={keyId(item)}>
                    <Link className="underline" href={courseHref(term, item)}>
                      {keyId(item)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No later course in this snapshot lists it.</p>
            )}
          </section>
        </div>
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="card p-5">
        <h1 className="text-2xl font-semibold">{code} isn&apos;t offered in {termLabel}</h1>
        <p className="mt-2 text-muted">
          {stillFailing
            ? "Banner's course catalog still isn't answering. Try again in a minute."
            : "Banner's course catalog didn't answer, so the course's details couldn't be checked."}
        </p>
        <Button
          className="mt-3"
          type="button"
          onClick={() => {
            onRetry();
            setStillFailing(true);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <h1 className="text-2xl font-semibold">{code} isn&apos;t offered in {termLabel}</h1>
      <p className="mt-2 text-muted">Banner&apos;s recent course catalogs don&apos;t list it either, so the course code may have changed.</p>
      <Link className="btn mt-3 inline-flex" href={`/search?q=${encodeURIComponent(code)}`}>
        Search for {code}
      </Link>
    </div>
  );
}
