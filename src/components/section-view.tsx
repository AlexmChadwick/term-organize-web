"use client";

import { SeatText, courseHref } from "@/components/bits";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { pinSectionOnPlan } from "@/lib/schedule/pins";
import { finalExam, instructorDisplayName, instructorLabel, keyId, meetingLocation, meetingLongLocation, meetingTimeLabel, dayShortLabel, scheduleSummary, seatsLabel, weeklyMeetings } from "@/lib/models";
import Link from "next/link";
import { useEffect } from "react";

export function SectionView({ term, crn }: { term: string; crn: string }) {
  const { index, termCode, setTermCode, addCourseToPlan, watchSection, unwatch, isWatched, plan, updatePlan, ensurePlan, catalogStatus, catalogDetail, catalogError } = useApp();
  useEffect(() => {
    if (term !== termCode) setTermCode(term);
  }, [term, termCode, setTermCode]);
  const section = index && index.catalog.term.code === term ? index.sectionByCRN(crn) : undefined;
  if (!index || index.catalog.term.code !== term) {
    return (
      <p className={catalogStatus === "error" ? "state text-bad" : "state text-muted"}>
        {catalogStatus === "building"
          ? (catalogDetail ?? "Downloading every section of this term from Banner…")
          : catalogStatus === "error"
            ? (catalogError ?? "The catalog did not load.")
            : "Loading the catalog…"}
      </p>
    );
  }
  if (!section) {
    return (
      <div className="card p-5">
        <h1 className="text-2xl font-semibold">CRN {crn}</h1>
        <p className="mt-2 text-muted">That CRN is not in this term’s catalog.</p>
      </div>
    );
  }
  const key = { subject: section.subject, number: section.number };
  const exam = finalExam(section);
  const selected = plan?.selectedCRNs.includes(crn);

  return (
    <div className="grid gap-4">
      <header>
        <p className="text-sm font-semibold text-accent">CRN {section.crn}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          <Link className="underline decoration-line underline-offset-4" href={courseHref(term, key)}>
            {keyId(key)}
          </Link>{" "}
          {section.title}
        </h1>
        <p className="mt-1 text-muted">
          {section.classType} {section.sectionNumber} · {section.campus}
          {section.honors ? " · Honors" : ""}
          {section.instructionMethod ? ` · ${section.instructionMethod}` : ""}
        </p>
      </header>
      <section className="card p-5">
        <p className="text-lg">{scheduleSummary(section)}</p>
        <p className="mt-1 text-sm text-muted">{weeklyMeetings(section).map((meeting) => meetingLocation(meeting)).join(" · ") || "Location TBA"}</p>
        <p className="mt-3">
          <SeatText remaining={section.seatsRemaining} capacity={section.seatCapacity} />
          <span className="text-muted"> · {seatsLabel(section)}</span>
        </p>
        {section.waitlistCapacity > 0 ? (
          <p className="text-sm text-muted">Waitlist {section.waitlistCount} enrolled, {section.waitlistRemaining} spots left of {section.waitlistCapacity}.</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => addCourseToPlan(key)}>Add course</Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              const current = plan ?? ensurePlan();
              updatePlan(current.id, (item) => pinSectionOnPlan(item, key, crn));
            }}
          >
            {selected ? "On your week" : "Use this section"}
          </Button>
          <Button variant="soft" type="button" onClick={() => (isWatched(crn) ? unwatch(crn) : watchSection(section))}>
            {isWatched(crn) ? "Stop watching" : "Watch seats"}
          </Button>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="font-semibold">Meetings</h2>
        <ul className="mt-2 grid gap-2 text-sm">
          {section.meetings.map((meeting, index) => (
            <li key={index}>
              {meeting.kind}: {dayShortLabel(meeting.days) || "No days"} {meeting.start != null && meeting.end != null ? meetingTimeLabel(meeting) : "Time TBA"} · {meetingLongLocation(meeting)}
            </li>
          ))}
        </ul>
        {exam ? <p className="mt-3 text-sm">Final: {dayShortLabel(exam.days)} {exam.start != null && exam.end != null ? meetingTimeLabel(exam) : ""} {meetingLongLocation(exam)}</p> : null}
      </section>
      <section className="card p-5">
        <h2 className="font-semibold">Instructors</h2>
        <ul className="mt-2 grid gap-1">
          {(section.instructors ?? []).map((instructor) => (
            <li key={instructor.name}>
              <Link className="underline" href={`/professor/${encodeURIComponent(instructor.name)}`}>
                {instructorDisplayName(instructor.name)}
              </Link>
              {instructor.email ? <span className="text-muted"> · {instructor.email}</span> : null}
            </li>
          ))}
          {!section.instructors?.length ? <li className="text-muted">{instructorLabel(section)}</li> : null}
        </ul>
      </section>
    </div>
  );
}
