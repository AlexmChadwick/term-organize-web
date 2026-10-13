"use client";

import type { CourseKey, CourseSection, DaySet, Requisite } from "@/lib/models";
import {
  DAY_SHORT,
  courseColorAt,
  creditsLabel,
  dayCompactLabel,
  dayIndices,
  hourAxisLabel,
  instructorLabel,
  timeLabel,
  isReqAnd,
  isReqCourse,
  isReqOr,
  isReqTest,
  keyId,
  meetingLocation,
  meetingTimeLabel,
  nupathsFromAttributes,
  scheduleSummary,
  seatTone,
  weeklyMeetings,
} from "@/lib/models";
import Link from "next/link";

export function courseHref(term: string, key: CourseKey): string {
  return `/course/${term}/${encodeURIComponent(key.subject)}/${encodeURIComponent(key.number)}`;
}

export function sectionHref(term: string, crn: string): string {
  return `/section/${term}/${encodeURIComponent(crn)}`;
}

export function SeatText({ remaining, capacity }: { remaining: number; capacity: number }) {
  const tone = seatTone(remaining, capacity);
  return <span className={tone === "open" ? "seat-open" : tone === "low" ? "seat-low" : "seat-full"}>{`${Math.max(0, remaining)} of ${capacity} open`}</span>;
}

export function NuChips({ attributes }: { attributes: string[] }) {
  const paths = nupathsFromAttributes(attributes);
  if (!paths.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {paths.map((path) => (
        <span key={path.code} className="chip" title={path.name}>
          {path.short}
        </span>
      ))}
    </span>
  );
}

export function RequisiteTree({ node, term }: { node: Requisite; term: string }) {
  if (isReqCourse(node)) {
    return (
      <Link className="font-semibold underline decoration-line underline-offset-2" href={courseHref(term, { subject: node.s, number: node.n })}>
        {node.s} {node.n}
      </Link>
    );
  }
  if (isReqTest(node)) return <span>{node.score == null ? node.test : `${node.test} (${node.score})`}</span>;
  const items = isReqAnd(node) ? node.and : isReqOr(node) ? node.or : [];
  return (
    <div className="req">
      <div className="req-kind">{isReqAnd(node) ? "All of" : "One of"}</div>
      <ul className="mt-1 grid gap-1">
        {items.map((item, index) => (
          <li key={index}>
            <RequisiteTree node={item} term={term} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CalendarBlock {
  id: string;
  day: number;
  start: number;
  end: number;
  title: string;
  detail: string;
  colorIndex: number;
  /** Overrides the course palette. Blocked times use a neutral fill. */
  paint?: { fill: string; stroke: string; text: string };
  href?: string;
  column?: number;
  columns?: number;
}

export function WeekCalendar({
  blocks,
  startHour,
  endHour,
  showWeekends,
}: {
  blocks: CalendarBlock[];
  startHour: number;
  endHour: number;
  showWeekends: boolean;
}) {
  const days = showWeekends ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const start = startHour * 60;
  const end = endHour * 60;
  const span = Math.max(60, end - start);
  const hours = [];
  for (let hour = startHour; hour < endHour; hour++) hours.push(hour);
  const placed = placeColumns(blocks.filter((block) => days.includes(block.day)));

  return (
    <div className="week" style={{ ["--days" as string]: days.length }}>
      <div>
        <div className="h-6" />
        <div className="relative hour-rail" style={{ height: hours.length * 40 }}>
          {hours.map((hour, index) => (
            <div key={hour} className="hour-label absolute right-0" style={{ top: index * 40 - 6 }}>
              {hourAxisLabel(hour)}
            </div>
          ))}
        </div>
      </div>
      {days.map((day) => (
        <div key={day}>
          <div className="mb-1 text-center text-xs font-semibold text-muted">{DAY_SHORT[day]}</div>
          <div className="week-col" style={{ height: hours.length * 40 }}>
            {placed
              .filter((block) => block.day === day)
              .map((block) => {
                const top = ((block.start - start) / span) * 100;
                const height = Math.max(4, ((block.end - block.start) / span) * 100);
                const color = block.paint ?? courseColorAt(block.colorIndex);
                const width = 100 / (block.columns || 1);
                const left = (block.column || 0) * width;
                const body = (
                  <div
                    className="week-block"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      left: `calc(${left}% + 2px)`,
                      right: "auto",
                      width: `calc(${width}% - 4px)`,
                      background: color.fill,
                      borderColor: color.stroke,
                      ["--block-ink" as string]: color.text,
                      ["--block-stroke" as string]: color.stroke,
                      ["--block-ink-light" as string]: readableInk(color.text, color.stroke, "#f7f1ea"),
                      ["--block-ink-dark" as string]: readableInk(color.text, color.stroke, "#261f23"),
                    }}
                  >
                    <div className="font-semibold">{block.title}</div>
                    <div>{weekRange(block.start, block.end)}</div>
                    <div>{block.detail}</div>
                  </div>
                );
                return block.href ? (
                  <Link key={block.id} href={block.href} className="contents">
                    {body}
                  </Link>
                ) : (
                  <div key={block.id} className="contents">
                    {body}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function placeColumns(blocks: CalendarBlock[]): CalendarBlock[] {
  const byDay = new Map<number, CalendarBlock[]>();
  for (const block of blocks) {
    const list = byDay.get(block.day) ?? [];
    list.push(block);
    byDay.set(block.day, list);
  }
  const out: CalendarBlock[] = [];
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
    const columns: CalendarBlock[][] = [];
    for (const block of sorted) {
      let placed = false;
      for (const column of columns) {
        const last = column[column.length - 1]!;
        if (last.end <= block.start) {
          column.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([block]);
    }
    sorted.forEach((block) => {
      const column = columns.findIndex((col) => col.includes(block));
      out.push({ ...block, column, columns: columns.length });
    });
  }
  return out;
}

export function blocksFromSections(sections: CourseSection[], colorFor: (section: CourseSection) => number, term: string): CalendarBlock[] {
  return sections.flatMap((section) =>
    weeklyMeetings(section).flatMap((meeting) => {
      if (meeting.start == null || meeting.end == null) return [];
      return dayIndices(meeting.days).map((day) => ({
        id: `${section.crn}-${day}-${meeting.start}`,
        day,
        start: meeting.start!,
        end: meeting.end!,
        title: keyId({ subject: section.subject, number: section.number }),
        detail: meetingLocation(meeting),
        colorIndex: colorFor(section),
        href: sectionHref(term, section.crn),
      }));
    }),
  );
}

export function SectionFacts({ section }: { section: CourseSection }) {
  return (
    <div className="text-sm text-muted">
      <div>{scheduleSummary(section)}</div>
      <div>{instructorLabel(section)}</div>
      <div>
        <SeatText remaining={section.seatsRemaining} capacity={section.seatCapacity} />
        {section.waitlistCapacity > 0 ? ` · waitlist ${section.waitlistRemaining} of ${section.waitlistCapacity}` : ""}
      </div>
    </div>
  );
}

export function creditsOf(min: number, max: number): string {
  return creditsLabel(min, max);
}

export function dayChips(days: DaySet, onToggle: (day: number) => void, labels = DAY_SHORT) {
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label, index) => {
        const on = (days & (1 << index)) !== 0;
        return (
          <button key={label} type="button" className={`chip ${on ? "border-accent text-accent" : ""}`} onClick={() => onToggle(index)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function weekRange(start: number, end: number): string {
  const samePeriod = start / 60 < 12 === end / 60 < 12;
  const startLabel = timeLabel(start, !samePeriod).replace(" ", "");
  const endLabel = timeLabel(end).replace(" ", "");
  return `${startLabel}–${endLabel}`;
}

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB | null {
  const match = /^#([\da-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: RGB): string {
  const channel = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixRgb(a: RGB, b: RGB, amount: number): RGB {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

function channelLum(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: RGB): number {
  return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2]);
}

function contrastRatio(a: RGB, b: RGB): number {
  const left = luminance(a);
  const right = luminance(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken or lighten palette ink until it clears the translucent block fill. CSS variables pass through. */
export function readableInk(text: string, stroke: string, surface: string): string {
  if (text.startsWith("var(") || stroke.startsWith("var(")) return text;
  const ink = hexToRgb(text);
  const line = hexToRgb(stroke);
  const ground = hexToRgb(surface);
  if (!ink || !line || !ground) return text;
  const background = mixRgb(ground, line, 0.18);
  if (contrastRatio(ink, background) >= 4.5) return text;
  const toward: RGB = luminance(background) > 0.4 ? [28, 20, 22] : [255, 252, 248];
  let best = ink;
  for (let step = 1; step <= 10; step++) {
    const next = mixRgb(ink, toward, step / 10);
    best = next;
    if (contrastRatio(next, background) >= 4.5) return rgbToHex(next);
  }
  return rgbToHex(best);
}

export function meetingLabel(section: CourseSection): string {
  const weekly = weeklyMeetings(section);
  if (!weekly.length) return scheduleSummary(section);
  return weekly.map((meeting) => `${dayCompactLabel(meeting.days)} ${meetingTimeLabel(meeting)} · ${meetingLocation(meeting)}`).join(" · ");
}
