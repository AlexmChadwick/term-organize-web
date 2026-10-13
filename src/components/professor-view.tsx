"use client";

import { WeekCalendar, blocksFromSections, courseHref, sectionHref } from "@/components/bits";
import { useApp } from "@/lib/app-state";
import { courseColorAt, distinctCourseColorIndexes, instructorDisplayName, keyId, scheduleSummary } from "@/lib/models";
import Link from "next/link";

export function ProfessorView({ name }: { name: string }) {
  const { index, termCode, user } = useApp();
  if (!index) return <p className="text-muted">Loading…</p>;
  const person = index.instructors.find((item) => item.name === name || instructorDisplayName(item.name) === name);
  if (!person) {
    return (
      <div className="card p-5">
        <h1 className="text-2xl font-semibold">Professor not in this snapshot</h1>
        <p className="mt-2 text-muted">Try the directory search. Names come from Banner’s section list.</p>
        <Link className="mt-3 inline-block underline" href="/professors">
          All professors
        </Link>
      </div>
    );
  }
  const sections = person.crns.flatMap((crn) => {
    const section = index.sectionByCRN(crn);
    return section ? [section] : [];
  });
  const colors = distinctCourseColorIndexes(person.courseKeys);
  function colorFor(section: { subject: string; number: string }) {
    return colors.get(keyId({ subject: section.subject, number: section.number })) ?? 0;
  }
  return (
    <div className="grid gap-4">
      <header>
        <p className="text-sm font-semibold text-accent">Instructor</p>
        <h1 className="text-3xl font-semibold tracking-tight">{person.displayName}</h1>
        {person.email ? (
          <a className="text-muted underline" href={`mailto:${person.email}`}>
            {person.email}
          </a>
        ) : null}
      </header>
      <section className="card overflow-x-auto p-3">
        <h2 className="mb-2 px-2 font-semibold">Teaching calendar</h2>
        <WeekCalendar
          blocks={blocksFromSections(sections, colorFor, termCode)}
          startHour={user.preferences.calendarStartHour}
          endHour={user.preferences.calendarEndHour}
          showWeekends={user.preferences.showWeekends}
        />
      </section>
      <ul className="grid gap-2">
        {person.courseKeys.map((key) => (
          <li key={keyId(key)} className="card p-4">
            <Link className="font-semibold underline" href={courseHref(termCode, key)}>
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: courseColorAt(colorFor(key)).stroke }} />
              {keyId(key)} {index.course(key)?.title}
            </Link>
            <ul className="mt-2 text-sm text-muted">
              {sections
                .filter((section) => section.subject === key.subject && section.number === key.number)
                .map((section) => (
                  <li key={section.crn}>
                    <Link className="underline" href={sectionHref(termCode, section.crn)}>
                      {section.crn}
                    </Link>{" "}
                    {section.classType} {section.sectionNumber} · {scheduleSummary(section)}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
