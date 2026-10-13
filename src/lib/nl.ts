/**
 * Deterministic stand-in for the on-device schedule assistant.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Apple Intelligence is not available in the browser. This parser reads the same
 * wishes the survey stores (times of day, limits, days off, breaks, blocked
 * times, format, seats) using the grounding cues in ScheduleAssistant.swift, and
 * only keeps a field when the student's words mention it.
 */

import { dayMask, parseDayName, rangeLabel } from "./models";
import type { SchedulePreferences, TimeBand } from "./preferences";
import { emptyPreferences, normalizePreferences, setBandPreference } from "./preferences";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface PreferenceDraft {
  preferredTimes: TimeBand[];
  avoidedTimes: TimeBand[];
  earliestStart?: string;
  latestEnd?: string;
  timeLimitsAreFlexible?: boolean;
  daysOff: number[];
  daysOffAreRequired?: boolean;
  layout?: "fewerDays" | "spreadOut";
  maxClassesPerDay?: number;
  maxHoursPerDay?: number;
  breaks?: "avoidBackToBack" | "timeToWalk";
  wantsLunchBreak?: boolean;
  blockedTimes: { label: string; days: number[]; start: string; end: string }[];
  format?: "inPerson" | "online" | "hybrid";
  seats?: "openSeatsOnly" | "waitlistOK";
  notes: string[];
}

export function emptyDraft(): PreferenceDraft {
  return { preferredTimes: [], avoidedTimes: [], daysOff: [], blockedTimes: [], notes: [] };
}

function mentions(text: string, cues: string[]): boolean {
  return cues.some((c) => text.includes(c));
}

const CUES = {
  format: ["online", "remote", "virtual", "zoom", "in person", "in-person", "on campus", "on-campus", "hybrid", "face to face", "face-to-face"],
  seats: ["seat", "waitlist", "wait list", "wait-list", "capacity", "full class", "full section", "open section", "open class", "closed class"],
  breaks: ["back to back", "back-to-back", "walk", "between class", "between building", "break between", "gap", "rush", "far apart", "time to get", "travel"],
  lunch: ["lunch", "meal", " eat "],
  perDay: ["per day", "a day", "each day", "every day", "in a day", "in one day", "daily", "same day"],
  layout: ["few days", "fewer days", "fewest days", "spread", "evenly", "compact", "long weekend", "bunch", "pack ", "cram", "consolidat", "days a week", "days per week", "days on campus"],
  firm: ["must", "have to", "has to", "need to", "i need", "can't", "cannot", "can not", "no way", "never", "always", "required", "i work", "my job", "my shift", "shifts", "only available"],
  soft: ["ideally", "prefer", "if possible", "if i can", "would like", "i'd like", "id like", "rather", "hopefully", "try to", "nice if", "would be nice", "wish"],
};

const BAND_CUES: { band: TimeBand; cues: string[] }[] = [
  { band: "earlyMorning", cues: ["early morning", "before 9", "8am", "8 am", "7am", "7 am", "dawn"] },
  { band: "morning", cues: ["morning", "before noon", "9am", "9 am", "10am", "10 am", "11am", "11 am"] },
  { band: "midday", cues: ["midday", "noon", "lunchtime", "12pm", "12 pm", "1pm", "1 pm"] },
  { band: "afternoon", cues: ["afternoon", "after lunch", "2pm", "2 pm", "3pm", "3 pm", "4pm", "4 pm"] },
  { band: "evening", cues: ["evening", "after 5", "5pm", "5 pm", "6pm", "6 pm"] },
  { band: "night", cues: ["night", "after 7", "late class", "7pm", "7 pm", "8pm", "8 pm", "9pm", "9 pm"] },
];

function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (hour > 24 || minute > 59) return null;
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (!ap && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

function clockFromPhrase(phrase: string): number | null {
  const m = phrase.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i);
  if (!m) return null;
  return parseClock(m[0]);
}

function clauses(text: string): string[] {
  return text
    .split(/,|;|\.|\n| and | but /)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

function quantity(text: string): number | null {
  const digit = text.match(/(\d+)/);
  if (digit) return Number(digit[1]);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) if (text.includes(word)) return n;
  return null;
}

export function interpretPreferences(description: string, base: SchedulePreferences = emptyPreferences()): { preferences: SchedulePreferences; draft: PreferenceDraft; summary: string[] } {
  const draft = emptyDraft();
  const text = ` ${description.toLowerCase().replace(/\s+/g, " ")} `;
  const parts = clauses(text);

  for (const part of parts) {
    const avoid = /\b(avoid|no|not|don't|dont|hate|without|skip)\b/.test(part);
    for (const { band, cues } of BAND_CUES) {
      if (!cues.some((c) => part.includes(c))) continue;
      if (avoid) draft.avoidedTimes.push(band);
      else if (/\b(prefer|like|love|want|morning|afternoon|evening|night)\b/.test(part) || part.includes(cues[0]!)) {
        if (avoid) draft.avoidedTimes.push(band);
        else if (/\b(prefer|like|only|want)\b/.test(part) || part.includes("classes in the") || part.includes("classes in")) draft.preferredTimes.push(band);
      }
    }
  }
  // Bare "mornings" / "no evenings" even without "prefer".
  if (/\bmorning/.test(text) && !draft.preferredTimes.includes("morning") && !/\bno morning|avoid morning|not morning/.test(text)) {
    if (/\bprefer|\blike|\bwant|\bonly\b|classes in the morning/.test(text)) draft.preferredTimes.push("morning");
  }
  if (/no evening|avoid evening|not at night|no night|avoid night/.test(text)) draft.avoidedTimes.push("evening", "night");
  if (/no morning|avoid morning|not in the morning|no early/.test(text)) draft.avoidedTimes.push("earlyMorning", "morning");
  if (/prefer afternoon|afternoons|in the afternoon/.test(text) && !/no afternoon|avoid afternoon/.test(text)) draft.preferredTimes.push("afternoon");
  if (/prefer morning|mornings|in the morning/.test(text) && !/no morning|avoid morning/.test(text)) draft.preferredTimes.push("morning");

  const start = text.match(/(?:no classes before|nothing before|not before|start(?:ing)? (?:after|at)|after|no earlier than)\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  const end = text.match(/(?:done by|out by|end by|finish by|before|no later than|no classes after|nothing after)\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  if (start) draft.earliestStart = start[1]!.replace(/\s+/g, "");
  if (end && !/before \d/.test(end[0]!) || (end && /done by|out by|end by|finish by|no later|no classes after|nothing after/.test(end[0]!))) {
    if (end) draft.latestEnd = end[1]!.replace(/\s+/g, "");
  }
  // "before 10" without am, when it's a start limit, is ambiguous; "no classes before 10" is a start.
  const before = text.match(/no classes before\s+(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)/);
  if (before) draft.earliestStart = before[1]!.replace(/\s+/g, "");
  const done = text.match(/(?:done|out|home|finished|finish|end) by\s+(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)/);
  if (done) draft.latestEnd = done[1]!.replace(/\s+/g, "");

  const limitClauses = parts.filter((c) => /before|after|start|finish|end by|done by|out by|no classes|nothing/.test(c));
  draft.timeLimitsAreFlexible = limitClauses.length > 0 && limitClauses.every((c) => mentions(c, CUES.soft) && !mentions(c, CUES.firm));

  for (const name of WEEKDAYS) {
    const re = new RegExp(`\\b${name.slice(0, 3)}\\w*\\b`);
    if (!re.test(text)) continue;
    const off = parts.some((c) => re.test(c) && / off|free|no class|without class|nothing on|don't have|dont have/.test(c));
    if (off || new RegExp(`no classes on ${name.slice(0, 3)}|${name.slice(0, 3)}\\w* off`).test(text)) {
      const idx = parseDayName(name);
      if (idx != null) draft.daysOff.push(idx);
    }
  }
  if (/weekends? off|no weekends|free weekends/.test(text)) draft.daysOff.push(0, 6);
  if (/fridays off|friday off|no friday|free friday/.test(text) && !draft.daysOff.includes(5)) draft.daysOff.push(5);
  const offClauses = parts.filter((c) => /mon|tue|wed|thu|fri|sat|sun/.test(c) && / off|free|no class|without class|skip|nothing on/.test(c));
  draft.daysOffAreRequired = offClauses.some((c) => mentions(c, CUES.firm) || /no class on|no classes on|nothing on/.test(c));

  if (mentions(text, CUES.layout)) {
    if (/spread|evenly|all week/.test(text)) draft.layout = "spreadOut";
    else draft.layout = "fewerDays";
  }
  if (mentions(text, CUES.perDay) && /class/.test(text)) {
    const n = quantity(text.match(/.{0,24}class.{0,24}/)?.[0] ?? text);
    if (n && n <= 8) draft.maxClassesPerDay = n;
  }
  if (mentions(text, CUES.perDay) && /hour/.test(text)) {
    const n = quantity(text.match(/.{0,24}hour.{0,24}/)?.[0] ?? text);
    if (n && n <= 12) draft.maxHoursPerDay = n;
  }
  if (mentions(text, CUES.breaks)) {
    if (/walk|between building|travel|time to get/.test(text)) draft.breaks = "timeToWalk";
    else draft.breaks = "avoidBackToBack";
  }
  if (mentions(text, CUES.lunch)) draft.wantsLunchBreak = true;
  if (mentions(text, CUES.format)) {
    if (/hybrid/.test(text)) draft.format = "hybrid";
    else if (/online|remote|virtual|zoom/.test(text) && !/in person|in-person|on campus/.test(text)) draft.format = "online";
    else draft.format = "inPerson";
  }
  if (mentions(text, CUES.seats)) {
    if (/waitlist|wait list|wait-list/.test(text)) draft.seats = "waitlistOK";
    else draft.seats = "openSeatsOnly";
  }

  const blockRe = /(?:my |the )?([a-z][a-z0-9 ]{1,32}?)\s+(?:is |meets |happens |on |from )?((?:(?:mon|tue|wed|thu|fri|sat|sun)\w*(?:,| and | )?)+)\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:to|-|–|until)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/gi;
  for (const match of description.matchAll(blockRe)) {
    const label = match[1]!.trim();
    const dayText = match[2]!.toLowerCase();
    const days: number[] = [];
    for (const name of WEEKDAYS) if (dayText.includes(name.slice(0, 3))) {
      const idx = parseDayName(name);
      if (idx != null) days.push(idx);
    }
    const startM = clockFromPhrase(match[3]!);
    const endM = clockFromPhrase(match[4]!);
    if (!days.length || startM == null || endM == null) continue;
    draft.blockedTimes.push({ label: label.replace(/^(i have|i've got)\s+/i, ""), days, start: match[3]!.replace(/\s+/g, ""), end: match[4]!.replace(/\s+/g, "") });
  }

  let preferences = { ...base, timeOfDay: { ...base.timeOfDay }, blockedTimes: [...base.blockedTimes] };
  for (const band of [...new Set(draft.preferredTimes)]) preferences = setBandPreference(preferences, band, "prefer");
  for (const band of [...new Set(draft.avoidedTimes)]) preferences = setBandPreference(preferences, band, "avoid");
  const strength = draft.timeLimitsAreFlexible ? "preferred" : "required";
  const startMin = draft.earliestStart ? parseClock(draft.earliestStart) : null;
  const endMin = draft.latestEnd ? parseClock(draft.latestEnd) : null;
  if (startMin != null && startMin < 24 * 60) preferences.earliestStart = { minutes: startMin, strength };
  if (endMin != null && endMin > (preferences.earliestStart?.minutes ?? 0)) preferences.latestEnd = { minutes: endMin, strength };
  if (draft.daysOff.length) {
    preferences.daysOff = dayMask(draft.daysOff);
    preferences.daysOffStrength = draft.daysOffAreRequired ? "required" : "preferred";
  }
  if (draft.layout) preferences.dayLayout = draft.layout;
  if (draft.maxClassesPerDay) preferences.maxClassesPerDay = draft.maxClassesPerDay;
  if (draft.maxHoursPerDay) preferences.maxMinutesPerDay = draft.maxHoursPerDay * 60;
  if (draft.breaks === "avoidBackToBack") preferences.breaks = "avoidBackToBack";
  if (draft.breaks === "timeToWalk") {
    preferences.breaks = "atLeast";
    preferences.minimumBreakMinutes = 15;
    preferences.minimumBreakStrength = "preferred";
  }
  if (draft.wantsLunchBreak && !preferences.lunch) preferences.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
  for (const block of draft.blockedTimes.slice(0, 8)) {
    const startB = parseClock(block.start);
    let endB = parseClock(block.end);
    if (startB == null || endB == null) continue;
    if (endB <= startB && endB < 12 * 60 && endB + 12 * 60 <= 24 * 60) endB += 12 * 60;
    preferences.blockedTimes.push({
      id: `block-${preferences.blockedTimes.length + 1}`,
      label: block.label || "Blocked time",
      days: dayMask(block.days),
      start: startB,
      end: endB,
      strength: "required",
      isEnabled: true,
    });
  }
  if (draft.format) preferences.format = draft.format;
  if (draft.seats === "openSeatsOnly") preferences.seats = "openOnly";
  if (draft.seats === "waitlistOK") preferences.seats = "waitlistOK";
  preferences = normalizePreferences(preferences);

  const summary: string[] = [];
  if (draft.preferredTimes.length) summary.push(`Prefer ${[...new Set(draft.preferredTimes)].join(", ")}`);
  if (draft.avoidedTimes.length) summary.push(`Avoid ${[...new Set(draft.avoidedTimes)].join(", ")}`);
  if (preferences.earliestStart) summary.push(`No classes before ${rangeLabel(preferences.earliestStart.minutes, preferences.earliestStart.minutes).split(" – ")[0]}`);
  if (preferences.latestEnd) summary.push(`Done by ${rangeLabel(preferences.latestEnd.minutes, preferences.latestEnd.minutes).split(" – ")[0]}`);
  if (draft.daysOff.length) summary.push("Days off noted");
  if (draft.blockedTimes.length) summary.push(`${draft.blockedTimes.length} blocked time${draft.blockedTimes.length === 1 ? "" : "s"}`);
  if (draft.format) summary.push(draft.format === "inPerson" ? "In person" : draft.format === "online" ? "Online" : "Hybrid");
  if (!summary.length) summary.push("Nothing specific was recognized. Try “no classes before 10am, Fridays off, lunch break”.");
  draft.notes = summary;
  return { preferences, draft, summary };
}
