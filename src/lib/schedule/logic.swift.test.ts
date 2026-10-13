import { describe, expect, it } from "vitest";
import type { Meeting } from "@/lib/models";
import * as models from "@/lib/models";
import { dateWindowsOverlap, dayMask, meetingOverlaps, termCalendarYear, termSeason } from "@/lib/models";
import { upcomingClasses } from "@/lib/upcoming";
import { emptyPlanFilters, newId, type SchedulePlan } from "@/lib/user";
import { emptyPreferences } from "@/lib/preferences";
import { section } from "@/lib/schedule/swift-fixtures";

function meeting(days: number[], start: number, end: number, from: string | null, to: string | null): Meeting {
  return {
    days: dayMask(days),
    start,
    end,
    buildingCode: "RI",
    building: "Richards Hall",
    room: "300",
    campusCode: "BOS",
    kind: "Class",
    startDate: from,
    endDate: to,
  };
}

function approximateWindow(code: string): { start: number; end: number } | null {
  const fn = (models as { termApproximateWindow?: (termCode: string) => { start: number; end: number } | null }).termApproximateWindow;
  return fn ? fn(code) : null;
}

function nyParts(ms: number): { year: number; month: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month) };
}

function plan(name: string, termCode: string, selected: string[]): SchedulePlan {
  const now = Date.now();
  return {
    id: newId(),
    name,
    termCode,
    courses: [],
    selectedCRNs: selected,
    filters: emptyPlanFilters(),
    preferences: emptyPreferences(),
    favoriteCombinations: [],
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Swift `UserDataStore.activePrimaryPlan`, using the exported term window when it exists. */
function activePrimaryPlan(plans: SchedulePlan[], now: number): SchedulePlan | null {
  const candidates = plans.flatMap((item) => {
    if (!item.isPrimary || item.selectedCRNs.length === 0) return [];
    const window = approximateWindow(item.termCode);
    if (!window) return [];
    return [{ plan: item, window }];
  });
  const current = candidates.filter((item) => item.window.start <= now && now <= item.window.end);
  if (current.length) return [...current].sort((a, b) => b.plan.selectedCRNs.length - a.plan.selectedCRNs.length)[0]!.plan;
  const next = candidates.filter((item) => item.window.start > now).sort((a, b) => a.window.start - b.window.start)[0];
  if (next) return next.plan;
  const cutoff = now - 14 * 24 * 3600 * 1000;
  return candidates.filter((item) => item.window.end >= cutoff).sort((a, b) => b.window.end - a.window.end)[0]?.plan ?? null;
}

describe("ScheduleLogicTests", () => {
  it("halfTermSectionsDoNotConflict", () => {
    const firstHalf = meeting([1, 3], 600, 665, "2026-09-09", "2026-10-27");
    const secondHalf = meeting([1, 3], 600, 665, "2026-10-28", "2026-12-13");
    const fullTerm = meeting([3], 630, 700, "2026-09-09", "2026-12-13");
    expect(meetingOverlaps(firstHalf, secondHalf)).toBe(false);
    expect(meetingOverlaps(firstHalf, fullTerm)).toBe(true);
    expect(meetingOverlaps(secondHalf, fullTerm)).toBe(true);
    expect(meetingOverlaps(firstHalf, meeting([1], 640, 700, null, null))).toBe(true);
    expect(dateWindowsOverlap("2026-09-09", "2026-10-27", null, null)).toBe(true);
  });

  it("calendarConflictsRespectDates", () => {
    const a = meeting([1], 600, 665, "2026-09-09", "2026-10-27");
    const b = meeting([1], 600, 665, "2026-10-28", "2026-12-13");
    const c = meeting([1], 630, 700, null, null);
    const marking = (events: Meeting[]) =>
      events.map((event, index) => events.some((other, otherIndex) => otherIndex !== index && meetingOverlaps(event, other)));
    expect(marking([a, b, c]).every(Boolean)).toBe(true);
    expect(marking([a, b]).some(Boolean)).toBe(false);
  });

  it("widgetMeetingsHonorDateWindows", () => {
    const now = new Date("2026-11-02T14:00:00Z");
    const early = section("1", "ARTF", "1220", [1], 10, 11.083333333333334, { startDate: "2026-09-09", endDate: "2026-10-27" });
    const late = section("2", "ARTF", "1221", [1], 10, 11.083333333333334, { startDate: "2026-10-28", endDate: "2026-12-13" });
    early.meetings[0]!.start = 600;
    early.meetings[0]!.end = 665;
    late.meetings[0]!.start = 600;
    late.meetings[0]!.end = 665;
    const today = upcomingClasses([early, late], now).filter((item) => item.dayOffset === 0).map((item) => item.code);
    expect(today).toEqual(["ARTF 1221"]);
    expect(upcomingClasses([early, late], now, 1)[0]?.code).toBe("ARTF 1221");
  });

  it("termWindowsAreSensible", () => {
    const fall = approximateWindow("202710");
    const spring = approximateWindow("202730");
    expect(termCalendarYear("202710")).toBe(2026);
    expect(termSeason("202710")).toBe("fall");
    expect(termCalendarYear("202730")).toBe(2027);
    expect(termSeason("202730")).toBe("spring");
    expect(fall).toBeTruthy();
    expect(spring).toBeTruthy();
    expect(nyParts(fall!.start).year).toBe(2026);
    expect(nyParts(fall!.start).month).toBe(9);
    expect(nyParts(spring!.start).year).toBe(2027);
    expect(fall!.end < spring!.start).toBe(true);
  });

  it("activePlanFollowsTheTermInSession", () => {
    const fall = plan("Fall", "202710", ["10001"]);
    const spring = plan("Spring", "202730", ["20001"]);
    const midFall = Date.parse("2026-10-15T16:00:00Z");
    const winterBreak = Date.parse("2026-12-28T17:00:00Z");
    const longAfter = Date.parse("2027-07-01T16:00:00Z");
    expect(activePrimaryPlan([fall, spring], midFall)?.id).toBe(fall.id);
    expect(activePrimaryPlan([fall, spring], winterBreak)?.id).toBe(spring.id);
    expect(activePrimaryPlan([fall, spring], longAfter)).toBeNull();
  });
});
