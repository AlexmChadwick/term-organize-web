import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import { loadBundledCatalog } from "@/lib/catalog-store";
import { planTermMatches } from "@/lib/degree-logic";
import { OfferingHistory, applyReorderSuggestion, reorderSuggestions, type ReorderSuggestion } from "@/lib/degree/reordering";
import type { CourseKey, CourseSection, ScheduleFilters, Term } from "@/lib/models";
import { Day, dayMask, emptyScheduleFilters, keyId, parseCourseKey, weeklyMeetings } from "@/lib/models";
import {
  applyDraft,
  assistantAvailabilityNote,
  assistantFailureMessage,
  draftFilledCount,
  draftIsEmpty,
  groundDraft,
  isEnglish,
  minutesFromClockText,
  type AssistantFailure,
  type SchedulePreferencesDraft,
} from "@/lib/nl";
import type { SchedulePreferences } from "@/lib/preferences";
import {
  activeBlockedTimes,
  bandPreference,
  changedSurveyFields,
  decodeSchedulePreferences,
  decodeStoredSchedulePlan,
  decodeStoredUserPlans,
  emptyPreferences,
  encodeSchedulePreferences,
  encodeStoredSchedulePlan,
  hasWishes,
  normalizePreferences,
  preferenceActiveCount,
  schedulePreferencesContext,
  setBandPreference,
} from "@/lib/preferences";
import { isDefaultPreferences } from "@/lib/schedule/preference-rules";
import {
  GeneratedSchedule,
  analyzeBlockers,
  applyPreferenceRelaxation,
  courseInputsFor,
  suggestRelaxations,
  type GeneratorLimits,
} from "@/lib/schedule/generator";
import { analyzeEmptyResult } from "@/lib/schedule/no-results";
import { scheduleReasons } from "@/lib/schedule/preference-rules";
import { intervalsFor, measureIntervals, scoreMeasurement } from "@/lib/schedule/scoring";
import {
  blockedTime,
  bruteForce,
  course,
  crnSets,
  expectSets,
  generate,
  limit,
  presetApplied,
  section,
  summary,
  summaryParts,
  togglePreset,
} from "@/lib/schedule/swift-fixtures";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm } from "@/lib/requirements";
import { emptyPlanFilters, emptyUserData, loadUserData, newId, saveUserData, type SchedulePlan } from "@/lib/user";

function pc(subject: string, number: string, sections: CourseSection[], options?: { required?: boolean; credits?: number }): ReturnType<typeof course> {
  return course(subject, number, sections, { credits: 4, required: options?.required ?? true, ...options });
}

function setsOf(result: ReturnType<typeof generate>): string[] {
  return crnSets(result);
}

function morningOrNight() {
  return pc("CS", "3000", [
    section("NIGHT", "CS", "3000", [2, 4], 19, 20.5),
    section("MORNING", "CS", "3000", [2, 4], 9.5, 11),
    section("AFTERNOON", "CS", "3000", [2, 4], 14.5, 16),
  ]);
}

function fullyLoaded(): SchedulePreferences {
  const p = emptyPreferences();
  p.timeOfDay = { earlyMorning: "avoid", afternoon: "prefer" };
  p.earliestStart = limit(600, "preferred");
  p.latestEnd = limit(1020);
  p.daysOff = Day.friday | Day.monday;
  p.daysOffStrength = "required";
  p.dayLayout = "spreadOut";
  p.maxClassesPerDay = 3;
  p.maxMinutesPerDay = 300;
  p.gaps = "compact";
  p.breaks = "atLeast";
  p.minimumBreakMinutes = 20;
  p.minimumBreakStrength = "required";
  p.lunch = { start: 690, end: 840, minutes: 45 };
  p.blockedTimes = [
    blockedTime("Robotics club", Day.tuesday | Day.thursday, 18 * 60, 20 * 60),
    blockedTime("Work", Day.monday, 13 * 60, 17 * 60, { strength: "preferred", isEnabled: false }),
  ];
  p.format = "hybrid";
  p.formatStrength = "required";
  p.campus = "Boston";
  p.campusStrength = "required";
  p.seats = "waitlistOK";
  p.preferredInstructors = ["Smith, Alex"];
  p.avoidedInstructors = ["Jones, Sam"];
  p.creditTarget = { lower: 16, upper: 18 };
  return p;
}

function installStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
    clear: () => mem.clear(),
    key: (index: number) => [...mem.keys()][index] ?? null,
    get length() {
      return mem.size;
    },
  });
}

function makePlan(name: string, termCode: string, preferences?: SchedulePreferences | null): SchedulePlan {
  const now = Date.now();
  return {
    id: newId(),
    name,
    termCode,
    courses: [{ key: { subject: "CS", number: "3000" }, isRequired: true, excludedCRNs: [], colorIndex: 0 }],
    selectedCRNs: [],
    filters: emptyPlanFilters(),
    preferences,
    favoriteCombinations: [],
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
  };
}

const briefsExample = "No classes before 10, I have robotics club Tuesdays and Thursdays 6\u20138pm, I\u2019d like Fridays off and a lunch break";

function fieldSet(fields: ReturnType<typeof changedSurveyFields>): string[] {
  return fields.map((field) => JSON.stringify(field)).sort();
}

function planned(code: string): DegreePlanCourse {
  const key = parseCourseKey(code)!;
  return { id: keyId(key), key, label: code, title: code, credits: 4 };
}

function degreePlan(terms: DegreePlanTerm[]): DegreePlan {
  return {
    id: "degree",
    name: "Plan",
    completed: [],
    terms,
    isPrimary: false,
    createdAt: 0,
    updatedAt: 0,
    substitutions: [],
    courseEquivalences: [],
  };
}

function history(): OfferingHistory {
  const terms = ["202710", "202630", "202610", "202530", "202510"];
  const spring = ["202630", "202530"];
  const fall = ["202710", "202610", "202510"];
  return new OfferingHistory({
    checkedTerms: terms,
    offered: [
      { key: parseCourseKey("CS 3386")!, terms: spring },
      { key: parseCourseKey("CS 3800")!, terms: fall },
      { key: parseCourseKey("CS 4100")!, terms: [...fall, ...spring] },
    ],
    checkedKeys: null,
  });
}

function reorderOption(suggestion: ReorderSuggestion, originId: string) {
  const movedAway = suggestion.moves.filter((move) => move.from === originId).map((move) => move.course);
  const movedIn = suggestion.moves.filter((move) => move.to === originId).map((move) => move.course);
  const names = (keys: CourseKey[]) => (keys.length <= 1 ? keys.map((key) => keyId(key)).join("") : `${keys.slice(0, -1).map((key) => keyId(key)).join(", ")} and ${keyId(keys[keys.length - 1]!)}`);
  const parts: string[] = [];
  if (movedAway.length) parts.push(`${names(movedAway)} ${movedAway.length === 1 ? "comes" : "come"} out of this schedule.`);
  if (movedIn.length) parts.push(`${names(movedIn)} will be added to it if ${movedIn.length === 1 ? "it\u2019s" : "they\u2019re"} offered this term.`);
  return {
    title: suggestion.title,
    reasons: suggestion.reasons,
    addsSemester: suggestion.addsSemester != null,
    movedAway,
    movedIn,
    appliedText: suggestion.title.startsWith("Move ") ? `Moved ${suggestion.title.slice("Move ".length)}` : "Updated your degree plan",
    scheduleEffect: parts.join(" "),
    suggestion,
  };
}

describe("SchedulePreferencesTests", () => {
describe("SchedulePreferencesModelTests", () => {
  it("defaultsHaveNoOpinions", () => {
    const p = emptyPreferences();
    expect(isDefaultPreferences(p)).toBe(true);
    expect(preferenceActiveCount(p)).toBe(0);
    expect(summaryParts(p)).toEqual([]);
    expect(summary(p)).toBe("No preferences yet");
  });

  it("settingABandBackToOkayRestoresTheDefault", () => {
    let p = setBandPreference(emptyPreferences(), "morning", "prefer");
    expect(isDefaultPreferences(p)).toBe(false);
    p = setBandPreference(p, "morning", "okay");
    expect(isDefaultPreferences(p)).toBe(true);
  });

  it("summaryReadsLikeTheBrief", () => {
    let p = emptyPreferences();
    p = setBandPreference(p, "earlyMorning", "prefer");
    p = setBandPreference(p, "morning", "prefer");
    p.daysOff = Day.friday;
    p.blockedTimes = [blockedTime("Club", Day.tuesday | Day.thursday, 18 * 60, 20 * 60), blockedTime("Work", Day.monday, 13 * 60, 17 * 60)];
    expect(summaryParts(p)).toEqual(["Mornings", "Fridays off", "2 blocked times"]);
    expect(summary(p)).toBe("Mornings · Fridays off · 2 blocked times");
    p.dayLayout = "fewerDays";
    expect(summary(p, 3)).toBe("Mornings · Fridays off · Fewer days · +1");
  });

  it("summaryNamesTheDaysAndTimes", () => {
    const p = emptyPreferences();
    p.daysOff = Day.monday | Day.friday;
    p.earliestStart = limit(10 * 60);
    p.latestEnd = limit(17 * 60 + 30, "preferred");
    expect(summaryParts(p)).toEqual(["Nothing before 10 AM", "Prefer done by 5:30 PM", "Mon & Fri off"]);
    const withNights = setBandPreference(setBandPreference(p, "evening", "avoid"), "night", "avoid");
    expect(summaryParts(withNights)[0]).toBe("No evenings");
  });

  it("disabledBlocksDontCount", () => {
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Work", Day.monday, 600, 700, { isEnabled: false })];
    expect(activeBlockedTimes(p)).toEqual([]);
    expect(preferenceActiveCount(p)).toBe(0);
    expect(summaryParts(p)).toEqual([]);
    expect(isDefaultPreferences(p)).toBe(false);
  });

  it("everyWishShowsUpInTheSummary", () => {
    const wishes: SchedulePreferences[] = [];
    const withChange = (change: (p: SchedulePreferences) => void) => {
      const p = emptyPreferences();
      change(p);
      wishes.push(p);
    };
    withChange((p) => {
      p.timeOfDay = { night: "avoid" };
    });
    withChange((p) => {
      p.earliestStart = limit(600);
    });
    withChange((p) => {
      p.latestEnd = limit(1020, "preferred");
    });
    withChange((p) => {
      p.daysOff = Day.friday;
    });
    withChange((p) => {
      p.dayLayout = "spreadOut";
    });
    withChange((p) => {
      p.maxClassesPerDay = 2;
    });
    withChange((p) => {
      p.maxMinutesPerDay = 240;
    });
    withChange((p) => {
      p.gaps = "fine";
    });
    withChange((p) => {
      p.gaps = "compact";
    });
    withChange((p) => {
      p.breaks = "avoidBackToBack";
    });
    withChange((p) => {
      p.breaks = "atLeast";
    });
    withChange((p) => {
      p.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
    });
    withChange((p) => {
      p.blockedTimes = [blockedTime("Work", Day.monday, 600, 700)];
    });
    withChange((p) => {
      p.format = "online";
    });
    withChange((p) => {
      p.campus = "Boston";
    });
    withChange((p) => {
      p.seats = "waitlistOK";
    });
    withChange((p) => {
      p.preferredInstructors = ["Smith, Alex"];
    });
    withChange((p) => {
      p.avoidedInstructors = ["Jones, Sam"];
    });
    withChange((p) => {
      p.creditTarget = { lower: 16, upper: 18 };
    });
    for (const p of wishes) {
      expect(hasWishes(p)).toBe(true);
      expect(summaryParts(p).length).toBeGreaterThan(0);
      expect(preferenceActiveCount(p)).toBeGreaterThan(0);
    }
    expect(hasWishes(emptyPreferences())).toBe(false);
  });

  it("presetsToggleAndCombine", () => {
    let p = togglePreset("morningPerson", emptyPreferences());
    expect(presetApplied("morningPerson", p)).toBe(true);
    expect(bandPreference(p, "morning")).toBe("prefer");
    expect(bandPreference(p, "night")).toBe("avoid");
    p = togglePreset("longWeekends", p);
    expect(presetApplied("longWeekends", p)).toBe(true);
    expect(presetApplied("morningPerson", p)).toBe(true);
    expect((p.daysOff & Day.friday) !== 0).toBe(true);
    expect(p.dayLayout).toBe("fewerDays");
    p = togglePreset("nightOwl", p);
    expect(presetApplied("nightOwl", p)).toBe(true);
    expect(presetApplied("morningPerson", p)).toBe(false);
    expect(bandPreference(p, "morning")).toBe("avoid");
    expect(bandPreference(p, "evening")).toBe("prefer");
    p = togglePreset("nightOwl", p);
    p = togglePreset("longWeekends", p);
    expect(isDefaultPreferences(p)).toBe(true);
  });

  it("compactDaysSetsLayoutAndGaps", () => {
    let p = togglePreset("compactDays", emptyPreferences());
    expect(p.dayLayout).toBe("fewerDays");
    expect(p.gaps).toBe("compact");
    p = togglePreset("compactDays", p);
    expect(isDefaultPreferences(p)).toBe(true);
  });

  it("normalizingDropsWhatCantBeApplied", () => {
    const p = emptyPreferences();
    p.earliestStart = limit(600);
    p.latestEnd = limit(540);
    p.maxClassesPerDay = 0;
    p.maxMinutesPerDay = 10;
    p.minimumBreakMinutes = 1000;
    p.lunch = { start: 700, end: 705, minutes: 600 };
    p.blockedTimes = [
      blockedTime("  ", Day.monday, 600, 700),
      blockedTime("No days", 0, 600, 700),
      blockedTime("Backwards", Day.monday, 700, 600),
      blockedTime("Club", Day.tuesday, 600, 700),
      blockedTime("club", Day.tuesday, 600, 700),
    ];
    p.preferredInstructors = ["Smith, Alex", " smith, alex ", ""];
    p.avoidedInstructors = ["Smith, Alex", "Jones, Sam"];
    p.creditTarget = { lower: 40, upper: 50 };
    const n = normalizePreferences(p);
    expect(n.latestEnd).toEqual(limit(540));
    expect(n.maxClassesPerDay ?? null).toBeNull();
    expect(n.maxMinutesPerDay ?? null).toBeNull();
    expect(n.minimumBreakMinutes).toBe(90);
    expect(n.lunch != null && n.lunch.end - n.lunch.start >= n.lunch.minutes).toBe(true);
    expect(n.blockedTimes.map((block) => block.label)).toEqual(["Blocked time", "Club"]);
    expect(n.preferredInstructors).toEqual(["Smith, Alex"]);
    expect(n.avoidedInstructors).toEqual(["Jones, Sam"]);
    expect(n.creditTarget?.upper).toBe(30);
  });

  it("changedFieldsListWhatDiffers", () => {
    const old = emptyPreferences();
    const next = emptyPreferences();
    next.timeOfDay = { morning: "avoid" };
    next.earliestStart = limit(600);
    next.daysOff = Day.friday;
    const block = blockedTime("Club", Day.tuesday, 1080, 1200);
    next.blockedTimes = [block];
    next.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
    expect(fieldSet(changedSurveyFields(next, old))).toEqual(
      fieldSet([
        { kind: "timeOfDay", band: "morning" },
        { kind: "earliestStart" },
        { kind: "daysOff" },
        { kind: "blockedTime", id: block.id },
        { kind: "lunch" },
      ]),
    );
    expect(changedSurveyFields(next, next)).toEqual([]);
  });
});

describe("SchedulePreferencesCodingTests", () => {
  beforeEach(() => installStorage());

  it("roundTrips", () => {
    const original = fullyLoaded();
    const decoded = decodeSchedulePreferences(encodeSchedulePreferences(original));
    expect(decoded).toEqual(original);
  });

  it("anEmptyObjectDecodesToTheDefaults", () => {
    const decoded = decodeSchedulePreferences(JSON.parse("{}"));
    expect(isDefaultPreferences(decoded)).toBe(true);
  });

  it("unknownAndDamagedValuesFallBackInsteadOfFailing", () => {
    const decoded = decodeSchedulePreferences(JSON.parse(`{
      "timeOfDay": {"morning": "prefer", "brunch": "prefer", "night": "sometimes"},
      "dayLayout": "teleport",
      "earliestStart": {"minutes": "soon"},
      "daysOff": 32,
      "maxClassesPerDay": 3,
      "blockedTimes": [
        {"label": "Club", "days": 20, "start": 1080, "end": 1200},
        "garbage",
        {"label": 7}
      ],
      "futureField": [1, 2, 3]
    }`));
    expect(decoded.timeOfDay.morning).toBe("prefer");
    expect(bandPreference(decoded, "night")).toBe("okay");
    expect(decoded.dayLayout).toBe("noPreference");
    expect(decoded.earliestStart ?? null).toBeNull();
    expect(decoded.daysOff).toBe(Day.friday);
    expect(decoded.maxClassesPerDay).toBe(3);
    const club = decoded.blockedTimes.find((block) => block.label === "Club");
    expect(club?.days).toBe(20);
    expect(activeBlockedTimes(decoded).map((block) => block.label)).toEqual(["Club"]);
  });

  it("plansSavedBeforePreferencesExistStillLoad", () => {
    const encoded = encodeStoredSchedulePlan({
      name: "Plan A",
      termCode: "202730",
      courses: [{ key: { subject: "CS", number: "3000" }, isRequired: true, excludedCRNs: [], colorIndex: 0 }],
    });
    expect(encoded.preferences ?? null).toBeNull();
    delete encoded.preferences;
    const decoded = decodeStoredSchedulePlan(encoded);
    expect(decoded?.name).toBe("Plan A");
    expect(decoded?.preferences ?? null).toBeNull();
    expect(decoded?.courses).toHaveLength(1);
  });

  it("planPreferencesSurviveASaveAndLoad", () => {
    const preferences = fullyLoaded();
    const data = emptyUserData();
    data.plans = [makePlan("Plan B", "202730", preferences)];
    saveUserData(data);
    const decoded = loadUserData();
    expect(decoded.plans).toHaveLength(1);
    expect(decoded.plans[0]?.preferences).toEqual(preferences);
  });

  it("theStoreSavesPreferencesWithThePlan", () => {
    const preferences = fullyLoaded();
    const data = emptyUserData();
    const first = makePlan("Fall", "202710", preferences);
    const other = makePlan("Other", "202710", null);
    data.plans = [first, other];
    saveUserData(data);
    const reloaded = loadUserData();
    expect(reloaded.plans.find((item) => item.id === first.id)?.preferences).toEqual(preferences);
    expect(reloaded.plans.find((item) => item.id === other.id)?.preferences ?? null).toBeNull();
    const source = reloaded.plans.find((item) => item.id === first.id);
    const copy: SchedulePlan = {
      ...source!,
      id: newId(),
      name: `${source!.name} Copy`,
      isPrimary: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      courses: source!.courses.map((item) => ({ ...item, excludedCRNs: [...item.excludedCRNs] })),
      selectedCRNs: [...source!.selectedCRNs],
      favoriteCombinations: source!.favoriteCombinations.map((row) => [...row]),
      filters: { ...source!.filters },
    };
    reloaded.plans.push(copy);
    saveUserData(reloaded);
    expect(loadUserData().plans.find((item) => item.id === copy.id)?.preferences).toEqual(preferences);
  });

  it("preferencesOfAnyShapeNeverTakeTheScheduleDown", () => {
    const base = { name: "Plan D", termCode: "202730", courses: [] as unknown[] };
    for (const garbage of [7, "text", [1, 2, 3], true]) {
      const decoded = decodeStoredSchedulePlan({ ...base, preferences: garbage });
      expect(decoded?.name).toBe("Plan D");
      expect(isDefaultPreferences(decoded?.preferences ?? emptyPreferences())).toBe(true);
    }
    const file = { version: 1, plans: [base, { ...base, preferences: "text" }] };
    expect(decodeStoredUserPlans(file)).toHaveLength(2);
  });

  it("damagedPreferencesNeverTakeTheScheduleDown", () => {
    const decoded = decodeStoredSchedulePlan({
      name: "Plan C",
      termCode: "202730",
      courses: [],
      preferences: { timeOfDay: 7, blockedTimes: "nope", campus: 3 },
    });
    expect(decoded?.name).toBe("Plan C");
    expect(isDefaultPreferences(decoded?.preferences ?? emptyPreferences())).toBe(true);
  });
});

describe("SchedulePreferencesFilterTests", () => {
  it("aBlockedTimeRemovesSectionsThatOverlapIt", () => {
    const input = pc("CS", "3000", [
      section("EVE", "CS", "3000", [2, 4], 18, 19.5),
      section("DAY", "CS", "3000", [1, 3, 5], 10, 11),
      section("LATE", "CS", "3000", [2, 4], 20, 21),
    ]);
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Club meeting", Day.tuesday | Day.thursday, 18 * 60, 20 * 60)];
    expect(setsOf(generate([input], p))).toEqual(expectSets([["DAY"], ["LATE"]]));
    expect(generate([input]).totalFound).toBe(3);
  });

  it("blockedTimesOnlyApplyOnTheirDaysAndHours", () => {
    const input = pc("CS", "3000", [
      section("MON", "CS", "3000", [1], 18, 19.5),
      section("TUE", "CS", "3000", [2], 18, 19.5),
      section("EARLY", "CS", "3000", [2], 16, 18),
      section("OVER", "CS", "3000", [2], 19.5, 21),
    ]);
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Club", Day.tuesday, 18 * 60, 20 * 60)];
    expect(setsOf(generate([input], p))).toEqual(expectSets([["MON"], ["EARLY"]]));
  });

  it("aSwitchedOffBlockIsIgnored", () => {
    const input = pc("CS", "3000", [section("A", "CS", "3000", [2], 18, 19)]);
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Club", Day.tuesday, 18 * 60, 20 * 60, { isEnabled: false })];
    expect(generate([input], p).totalFound).toBe(1);
  });

  it("aPreferredBlockOnlyRanksLower", () => {
    const input = pc("CS", "3000", [section("CLASH", "CS", "3000", [2], 18, 19), section("FREE", "CS", "3000", [3], 18, 19)]);
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Club", Day.tuesday, 18 * 60, 20 * 60, { strength: "preferred" })];
    const result = generate([input], p);
    expect(result.schedules.map((schedule) => schedule.crns)).toEqual([["FREE"], ["CLASH"]]);
    expect(result.schedules.at(-1)?.reasons.some((reason) => reason.isCaveat && reason.text === "Overlaps Club")).toBe(true);
  });

  it("daysOffAreHardOnlyWhenRequired", () => {
    const input = pc("CS", "3000", [section("FRI", "CS", "3000", [5], 10, 11), section("TUE", "CS", "3000", [2], 10, 11)]);
    const p = emptyPreferences();
    p.daysOff = Day.friday;
    p.daysOffStrength = "required";
    expect(generate([input], p).schedules.map((schedule) => schedule.crns)).toEqual([["TUE"]]);
    p.daysOffStrength = "preferred";
    expect(generate([input], p).schedules.map((schedule) => schedule.crns)).toEqual([["TUE"], ["FRI"]]);
  });

  it("earliestStartAndLatestEndFilterWhenRequired", () => {
    const input = pc("CS", "3000", [
      section("EARLY", "CS", "3000", [1], 8, 9.5),
      section("MID", "CS", "3000", [2], 10, 11.5),
      section("LATE", "CS", "3000", [3], 16, 18.5),
    ]);
    const p = emptyPreferences();
    p.earliestStart = limit(10 * 60);
    expect(setsOf(generate([input], p))).toEqual(expectSets([["MID"], ["LATE"]]));
    p.latestEnd = limit(17 * 60);
    expect(setsOf(generate([input], p))).toEqual(expectSets([["MID"]]));
  });

  it("softLimitsRankByHowFarOutsideTheyAre", () => {
    const input = pc("CS", "3000", [
      section("VERY", "CS", "3000", [1], 8, 9),
      section("SLIGHTLY", "CS", "3000", [2], 9.75, 11),
      section("OK", "CS", "3000", [3], 10, 11),
    ]);
    const p = emptyPreferences();
    p.earliestStart = limit(10 * 60, "preferred");
    expect(generate([input], p).schedules.map((schedule) => schedule.crns)).toEqual([["OK"], ["SLIGHTLY"], ["VERY"]]);
  });

  it("requiredFormatSeatsAndCampusFilter", () => {
    const input = pc("CS", "3000", [
      section("INPERSON", "CS", "3000", [1], 9, 10),
      section("HYBRID", "CS", "3000", [2], 9, 10, { method: "Hybrid" }),
      section("ONLINE", "CS", "3000", [3], 9, 10, { campus: "Online", method: "Online" }),
      section("FULL", "CS", "3000", [4], 9, 10, { seats: 0, waitlist: 5 }),
      section("FULLNOLIST", "CS", "3000", [5], 9, 10, { seats: 0 }),
      section("OAKLAND", "CS", "3000", [1], 12, 13, { campus: "Oakland, CA" }),
    ]);
    const p = emptyPreferences();
    p.format = "inPerson";
    p.formatStrength = "required";
    expect(setsOf(generate([input], p))).toEqual(expectSets([["INPERSON"], ["FULL"], ["FULLNOLIST"], ["OAKLAND"]]));
    p.seats = "openOnly";
    expect(setsOf(generate([input], p))).toEqual(expectSets([["INPERSON"], ["OAKLAND"]]));
    p.seats = "waitlistOK";
    expect(setsOf(generate([input], p))).toEqual(expectSets([["INPERSON"], ["FULL"], ["OAKLAND"]]));
    p.campus = "Boston";
    p.campusStrength = "required";
    expect(setsOf(generate([input], p))).toEqual(expectSets([["INPERSON"], ["FULL"]]));
  });

  it("sectionsWithoutASeatLimitAreNeverFull", () => {
    const input = pc("CS", "3000", [section("OPEN", "CS", "3000", [1], 9, 10, { seats: 0, capacity: 0 })]);
    const p = emptyPreferences();
    p.seats = "openOnly";
    expect(generate([input], p).totalFound).toBe(1);
  });

  it("maxClassesPerDayLimitsHowManySectionsShareADay", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 8, 9)]),
      pc("B", "1", [section("B1", "B", "1", [1], 10, 11), section("B2", "B", "1", [2], 10, 11)]),
      pc("C", "1", [section("C1", "C", "1", [1], 12, 13), section("C2", "C", "1", [3], 12, 13)]),
    ];
    expect(generate(courses).totalFound).toBe(4);
    const p = emptyPreferences();
    p.maxClassesPerDay = 2;
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1", "B1", "C2"], ["A1", "B2", "C1"], ["A1", "B2", "C2"]]));
    p.maxClassesPerDay = 1;
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1", "B2", "C2"]]));
  });

  it("maxMinutesPerDayLimitsClassTimeOnOneDay", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 11)]),
      pc("B", "1", [section("B1", "B", "1", [1], 13, 15), section("B2", "B", "1", [2], 13, 15)]),
    ];
    const p = emptyPreferences();
    p.maxMinutesPerDay = 3 * 60;
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1", "B2"]]));
    p.maxMinutesPerDay = 90;
    const blocked = generate(courses, p);
    expect(blocked.totalFound).toBe(0);
    expect(blocked.diagnostics.courses[0]?.rejections.prefWorkload).toBe(1);
  });

  it("requiredWalkingTimeOnlyMattersBetweenBuildings", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10, { building: "RY" })]),
      pc("B", "1", [
        section("SAME", "B", "1", [1], 10.1, 11, { building: "RY" }),
        section("NEAR", "B", "1", [1], 10.1, 11, { building: "SL" }),
        section("FAR", "B", "1", [1], 10.5, 11.5, { building: "SL" }),
        section("OTHERDAY", "B", "1", [2], 10.1, 11, { building: "SL" }),
      ]),
    ];
    const p = emptyPreferences();
    p.breaks = "atLeast";
    p.minimumBreakMinutes = 15;
    p.minimumBreakStrength = "required";
    const result = generate(courses, p);
    expect(setsOf(result)).toEqual(expectSets([["A1", "SAME"], ["A1", "FAR"], ["A1", "OTHERDAY"]]));
    expect(result.diagnostics.conflictingPairs).toEqual([]);
  });

  it("aTightWalkIsReportedWhenItIsTheOnlyProblem", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10, { building: "RY" })]),
      pc("B", "1", [section("B1", "B", "1", [1], 10.1, 11, { building: "SL" })]),
    ];
    const p = emptyPreferences();
    p.breaks = "atLeast";
    p.minimumBreakMinutes = 15;
    p.minimumBreakStrength = "required";
    const result = generate(courses, p);
    expect(result.totalFound).toBe(0);
    expect(result.diagnostics.conflictingPairs.map((pair) => pair.reason)).toEqual(["travelTime"]);
    p.minimumBreakStrength = "preferred";
    const relaxed = generate(courses, p);
    expect(relaxed.totalFound).toBe(1);
    expect(relaxed.schedules[0]?.reasons.some((reason) => reason.isCaveat && reason.text === "Tight between buildings")).toBe(true);
  });

  it("halfTermSectionsAtTheSameTimeStillDontConflictWithPreferences", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1, 3], 10, 11.5, { startDate: "2026-09-09", endDate: "2026-10-23" })]),
      pc("B", "1", [section("B1", "B", "1", [1, 3], 10, 11.5, { startDate: "2026-10-26", endDate: "2026-12-13" })]),
    ];
    const p = setBandPreference(emptyPreferences(), "morning", "prefer");
    p.maxClassesPerDay = 3;
    p.breaks = "atLeast";
    p.minimumBreakStrength = "required";
    expect(generate(courses, p).totalFound).toBe(1);
    expect(generate(courses).totalFound).toBe(1);
  });

  it("requiredCoursesAreStillRequired", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]), pc("B", "1", [section("B1", "B", "1", [1], 9, 10)])];
    const p = setBandPreference(emptyPreferences(), "morning", "prefer");
    expect(generate(courses, p).totalFound).toBe(0);
  });

  it("creditTargetsReplaceTheMaximalRule", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("B1", "B", "1", [2], 9, 10)], { required: false }),
      pc("C", "1", [section("C1", "C", "1", [3], 9, 10)], { required: false }),
    ];
    expect(setsOf(generate(courses))).toEqual(expectSets([["A1", "B1", "C1"]]));
    const p = emptyPreferences();
    p.creditTarget = { lower: 8, upper: 8 };
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1", "B1"], ["A1", "C1"]]));
    p.creditTarget = { lower: 4, upper: 8 };
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1"], ["A1", "B1"], ["A1", "C1"]]));
    p.creditTarget = { lower: 12, upper: 16 };
    expect(setsOf(generate(courses, p))).toEqual(expectSets([["A1", "B1", "C1"]]));
  });

  it("impossibleCreditTargetsAreExplained", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("B1", "B", "1", [2], 9, 10)], { required: false }),
    ];
    const p = emptyPreferences();
    p.creditTarget = { lower: 2, upper: 3 };
    expect(generate(courses, p).diagnostics.countProblem).toEqual({ kind: "creditsOverTarget", required: 4, limit: 3 });
    p.creditTarget = { lower: 12, upper: 14 };
    expect(generate(courses, p).diagnostics.countProblem).toEqual({ kind: "creditsUnderTarget", available: 8, wanted: 12 });
  });

  it("diagnosticsNameThePreferenceThatRemovedSections", () => {
    const input = pc("CS", "3000", [section("A", "CS", "3000", [2], 18, 19), section("B", "CS", "3000", [4], 18.5, 19.5)]);
    const p = emptyPreferences();
    p.blockedTimes = [blockedTime("Club", Day.tuesday | Day.thursday, 18 * 60, 20 * 60)];
    const result = generate([input], p);
    expect(result.totalFound).toBe(0);
    expect(result.diagnostics.courses[0]?.isBlocked).toBe(true);
    expect(result.diagnostics.courses[0]?.rejections.blockedTime).toBe(2);
  });

  it("relaxationsOfferToSoftenWhatIsInTheWay", () => {
    const input = pc("CS", "3000", [section("A", "CS", "3000", [2], 18, 19)]);
    const block = blockedTime("Club", Day.tuesday, 18 * 60, 20 * 60);
    const p = emptyPreferences();
    p.blockedTimes = [block];
    p.earliestStart = limit(20 * 60);
    expect(suggestRelaxations([input], emptyScheduleFilters(), p)).toEqual([]);
    p.earliestStart = null;
    const single = suggestRelaxations([input], emptyScheduleFilters(), p);
    expect(single.map((item) => item.relaxation)).toEqual([{ kind: "preference", relaxation: { kind: "softenBlockedTime", id: block.id, label: "Club" } }]);
    const relaxed = { ...p, blockedTimes: p.blockedTimes.map((item) => ({ ...item })), timeOfDay: { ...p.timeOfDay } };
    const relaxation = single[0]?.relaxation;
    if (relaxation?.kind === "preference") applyPreferenceRelaxation(relaxed, relaxation.relaxation);
    expect(relaxed.blockedTimes[0]?.strength).toBe("preferred");
    expect(generate([input], relaxed).totalFound).toBe(1);
  });
});

describe("SchedulePreferencesRankingTests", () => {
  it("withoutPreferencesTheDefaultOrderIsUnchanged", () => {
    const result = generate([morningOrNight()]);
    expect(result.schedules.at(-1)?.crns[0]).toBe("NIGHT");
    expect(result.schedules.every((schedule) => schedule.reasons.length === 0)).toBe(true);
  });

  it("aMorningPersonSeesMorningsFirstAndANightOwlSeesNightsFirst", () => {
    const morning = togglePreset("morningPerson", emptyPreferences());
    expect(generate([morningOrNight()], morning).schedules.map((schedule) => schedule.crns[0] ?? "")).toEqual(["MORNING", "AFTERNOON", "NIGHT"]);
    const night = togglePreset("nightOwl", emptyPreferences());
    const order = generate([morningOrNight()], night).schedules.map((schedule) => schedule.crns[0] ?? "");
    expect(order[0]).toBe("NIGHT");
    expect(order.at(-1)).toBe("MORNING");
  });

  it("avoidingEarlyMorningsPutsThemLast", () => {
    const input = pc("CS", "3000", [section("EIGHT", "CS", "3000", [1, 3, 5], 8, 9), section("NOON", "CS", "3000", [1, 3, 5], 12, 13)]);
    const avoiding = setBandPreference(emptyPreferences(), "earlyMorning", "avoid");
    expect(generate([input], avoiding).schedules.map((schedule) => schedule.crns[0] ?? "")).toEqual(["NOON", "EIGHT"]);
    const eightOnly = pc("CS", "3000", [
      section("EIGHT", "CS", "3000", [2], 8, 9),
      section("NINEFIFTEEN", "CS", "3000", [2, 4, 5], 9.25, 10.25),
    ]);
    const preferring = setBandPreference(emptyPreferences(), "earlyMorning", "prefer");
    expect(generate([eightOnly], preferring).schedules[0]?.crns).toEqual(["EIGHT"]);
  });

  it("aWishedForDayOffBeatsEverythingElseTheDefaultRankingLikes", () => {
    const input = pc("CS", "3000", [section("ONEDAY", "CS", "3000", [5], 9, 10), section("TWODAYS", "CS", "3000", [2, 4], 9, 10)]);
    expect(generate([input]).schedules[0]?.crns).toEqual(["ONEDAY"]);
    const p = emptyPreferences();
    p.daysOff = Day.friday;
    expect(generate([input], p).schedules[0]?.crns).toEqual(["TWODAYS"]);
  });

  it("fewerDaysAndSpreadOutPullInOppositeDirections", () => {
    const input = pc("CS", "3000", [section("TWO", "CS", "3000", [2, 4], 9, 11), section("FIVE", "CS", "3000", [1, 2, 3, 4, 5], 9, 9.8)]);
    const few = emptyPreferences();
    few.dayLayout = "fewerDays";
    expect(generate([input], few).schedules[0]?.crns).toEqual(["TWO"]);
    const spread = emptyPreferences();
    spread.dayLayout = "spreadOut";
    expect(generate([input], spread).schedules[0]?.crns).toEqual(["FIVE"]);
  });

  it("protectingLunchRanksFreeLunchesFirst", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1, 3], 9, 10.5)]),
      pc("B", "1", [section("BUSY", "B", "1", [1, 3], 11.75, 13.75), section("FREE", "B", "1", [1, 3], 14, 15.5)]),
    ];
    const p = emptyPreferences();
    p.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 45 };
    const result = generate(courses, p);
    expect(new Set(result.schedules[0]?.crns)).toEqual(new Set(["A1", "FREE"]));
    expect(result.schedules[0]?.reasons.some((reason) => reason.text === "Lunch free every day")).toBe(true);
    expect(result.schedules.at(-1)?.reasons.some((reason) => reason.text === "Lunch often busy")).toBe(true);
  });

  it("avoidingBackToBackPrefersRealBreaks", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("TIGHT", "B", "1", [1], 10.1, 11), section("SPACED", "B", "1", [1], 11, 12)]),
    ];
    const p = emptyPreferences();
    p.breaks = "avoidBackToBack";
    expect(new Set(generate(courses, p).schedules[0]?.crns)).toEqual(new Set(["A1", "SPACED"]));
  });

  it("keepingGapsShortPrefersCompactDays", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("GAP", "B", "1", [1], 13, 14), section("NOGAP", "B", "1", [1], 10.25, 11.25)]),
    ];
    const p = emptyPreferences();
    p.gaps = "compact";
    expect(new Set(generate(courses, p).schedules[0]?.crns)).toEqual(new Set(["A1", "NOGAP"]));
    p.gaps = "fine";
    expect(generate(courses, p).totalFound).toBe(2);
  });

  it("preferredAndAvoidedInstructorsMoveSchedules", () => {
    const input = pc("CS", "3000", [
      section("NEUTRAL", "CS", "3000", [1], 9, 10, { instructors: ["Lee, Kim"] }),
      section("LOVED", "CS", "3000", [2], 9, 10, { instructors: ["Smith, Alex"] }),
      section("AVOIDED", "CS", "3000", [3], 9, 10, { instructors: ["Jones, Sam"] }),
    ]);
    const p = emptyPreferences();
    p.preferredInstructors = ["Smith, Alex"];
    p.avoidedInstructors = ["jones, sam"];
    const result = generate([input], p);
    expect(result.schedules.map((schedule) => schedule.crns)).toEqual([["LOVED"], ["NEUTRAL"], ["AVOIDED"]]);
    expect(result.schedules[0]?.reasons.some((reason) => reason.text === "With Alex Smith")).toBe(true);
  });

  it("preferredFormatAndCampusRankWithoutRemoving", () => {
    const input = pc("CS", "3000", [
      section("ONLINE", "CS", "3000", [1], 9, 10, { campus: "Online", method: "Online" }),
      section("INPERSON", "CS", "3000", [2], 9, 10),
      section("OAKLAND", "CS", "3000", [3], 9, 10, { campus: "Oakland, CA" }),
    ]);
    const p = emptyPreferences();
    p.format = "inPerson";
    expect(generate([input], p).schedules[0]?.crns).toEqual(["INPERSON"]);
    expect(generate([input], p).totalFound).toBe(3);
    const inPerson = pc("CS", "3000", [section("BOSTON", "CS", "3000", [2], 9, 10), section("OAKLAND", "CS", "3000", [3], 9, 10, { campus: "Oakland, CA" })]);
    const campus = emptyPreferences();
    campus.campus = "Oakland, CA";
    expect(generate([inPerson], campus).schedules.map((schedule) => schedule.crns)).toEqual([["OAKLAND"], ["BOSTON"]]);
    campus.campus = "Boston";
    expect(generate([inPerson], campus).schedules.map((schedule) => schedule.crns)).toEqual([["BOSTON"], ["OAKLAND"]]);
  });

  it("aSearchThatRunsOutOfLeavesStillMeetsTheBestSectionsFirst", () => {
    const night = (crn: string, subject: string, day: number) => section(crn, subject, "1", [day], 19, 20);
    const a = pc("A", "1", [...Array.from({ length: 8 }, (_, index) => night(`A${index + 1}`, "A", 1)), section("AMORNING", "A", "1", [1], 9, 10)]);
    const b = pc("B", "1", [...Array.from({ length: 8 }, (_, index) => night(`B${index + 1}`, "B", 2)), section("BMORNING", "B", "1", [2], 9, 10)]);
    const p = setBandPreference(setBandPreference(emptyPreferences(), "morning", "prefer"), "night", "avoid");
    const tiny: GeneratorLimits = { maxResults: 100, maxExhaustiveLeaves: 3, maxNodes: 1_000_000, timeBudget: 5, sampleLeaves: 0, sampleTimeBudget: 0, allowSampling: false };
    const result = generate([a, b], p, emptyScheduleFilters(), "best", tiny);
    expect(result.isExhaustive).toBe(false);
    expect(new Set(result.schedules[0]?.crns)).toEqual(new Set(["AMORNING", "BMORNING"]));
  });

  it("otherSortOrdersStillWorkWithPreferences", () => {
    const p = setBandPreference(emptyPreferences(), "morning", "prefer");
    const result = generate([morningOrNight()], p, emptyScheduleFilters(), "latestStart");
    expect(result.schedules[0]?.crns).toEqual(["NIGHT"]);
  });

  it("theScoreOfADefaultScheduleMatchesTheOriginalFormula", () => {
    const sections = [
      section("A1", "A", "1", [1, 3], 8, 9.5),
      section("B1", "B", "1", [2, 4], 13, 14.5),
      section("C1", "C", "1", [1], 17, 18.5, { seats: 0 }),
    ];
    const schedule = GeneratedSchedule.fromSections(sections);
    const intervals = sections.flatMap((item) => intervalsFor(item));
    const measured = measureIntervals(intervals);
    let expected = 100;
    expected -= 8 * measured.campusDays;
    expected -= 2 * Math.max(0, measured.classDays - measured.campusDays);
    expected -= measured.gapMinutes / 10;
    if (measured.earliestStart < 9 * 60) expected -= (9 * 60 - measured.earliestStart) / 15;
    if (measured.latestEnd > 17 * 60) expected -= (measured.latestEnd - 17 * 60) / 20;
    expected -= 6;
    expect(schedule.score).toBe(expected);
    expect(scoreMeasurement(measured, 1, 0)).toBe(expected);
  });

  it("generatingWithEmptyPreferencesMatchesGeneratingWithout", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1, 3], 9, 10), section("A2", "A", "1", [2, 4], 11, 12)]),
      pc("B", "1", [section("B1", "B", "1", [1, 3], 9.5, 11), section("B2", "B", "1", [5], 14, 17)]),
    ];
    const plain = generate(courses);
    const withEmpty = generate(courses, emptyPreferences());
    expect(plain.schedules.map((schedule) => schedule.crns)).toEqual(withEmpty.schedules.map((schedule) => schedule.crns));
    expect(plain.schedules.map((schedule) => schedule.score)).toEqual(withEmpty.schedules.map((schedule) => schedule.score));
  });
});

describe("ScheduleReasonTests", () => {
  it("reasonsAreEmptyWithoutPreferences", () => {
    expect(scheduleReasons([section("A", "A", "1", [1], 9, 10)], emptyPreferences())).toEqual([]);
  });

  it("aScheduleThatMeetsTheWishesSaysSo", () => {
    const sections = [section("A", "A", "1", [2, 4], 10.5, 12), section("B", "B", "1", [1, 3], 14, 15.5)];
    const p = emptyPreferences();
    p.daysOff = Day.friday;
    p.earliestStart = limit(10 * 60);
    p.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
    const reasons = scheduleReasons(sections, p);
    expect(reasons.map((reason) => reason.text)).toEqual(["Fridays off", "No classes before 10 AM", "Lunch free every day"]);
    expect(reasons.every((reason) => !reason.isCaveat)).toBe(true);
  });

  it("wishesItMissesShowUpAsCaveats", () => {
    const sections = [section("A", "A", "1", [5], 8, 9)];
    const p = setBandPreference(emptyPreferences(), "earlyMorning", "avoid");
    p.daysOff = Day.friday;
    p.earliestStart = limit(10 * 60, "preferred");
    const reasons = scheduleReasons(sections, p);
    expect(reasons.filter((reason) => !reason.isCaveat)).toEqual([]);
    expect(reasons.filter((reason) => reason.isCaveat).map((reason) => reason.text)).toEqual(["Class on Fri", "Starts 8:00 AM"]);
    const all = scheduleReasons(sections, p, 4, 5);
    expect(all.filter((reason) => reason.isCaveat).map((reason) => reason.text)).toEqual(["Class on Fri", "Starts 8:00 AM", "Includes early mornings"]);
  });

  it("morningsAndFormatsAreDescribed", () => {
    const sections = [section("A", "A", "1", [1, 3], 9.5, 11), section("B", "B", "1", [2, 4], 10, 11.5)];
    let p = setBandPreference(emptyPreferences(), "morning", "prefer");
    p = setBandPreference(p, "evening", "avoid");
    p.format = "inPerson";
    p.dayLayout = "fewerDays";
    const reasons = scheduleReasons(sections, p).map((reason) => reason.text);
    expect(reasons).toContain("All mornings");
    expect(reasons).toContain("No evenings");
    expect(reasons).toContain("All in person");
  });

  it("favoritesGetTheSameTreatment", () => {
    const sections = [section("A", "A", "1", [2, 4], 11, 12.5)];
    const p = emptyPreferences();
    p.daysOff = Day.friday;
    expect(GeneratedSchedule.fromSections(sections, p).reasons.map((reason) => reason.text)).toEqual(["Fridays off"]);
    expect(GeneratedSchedule.fromSections(sections).reasons).toEqual([]);
  });

  it("theSameThingIsNeverSaidTwice", () => {
    const sections = [section("A", "A", "1", [2, 4], 18, 19.5)];
    const p = emptyPreferences();
    p.blockedTimes = [
      blockedTime("Club", Day.tuesday, 17 * 60, 19 * 60, { strength: "preferred" }),
      blockedTime("Club", Day.thursday, 17 * 60, 19 * 60, { strength: "preferred" }),
    ];
    const reasons = scheduleReasons(sections, p);
    expect(reasons.map((reason) => reason.text)).toEqual(["Overlaps Club"]);
    expect(new Set(reasons.map((reason) => reason.id)).size).toBe(reasons.length);
  });

  it("campusesAreNamedPlainly", () => {
    const sections = [section("A", "A", "1", [1], 9, 10, { campus: "Oakland, CA" })];
    const p = emptyPreferences();
    p.campus = "Oakland, CA";
    expect(scheduleReasons(sections, p).map((reason) => reason.text)).toEqual(["Oakland, CA campus"]);
  });

  it("cardTagsAreCapped", () => {
    const sections = [section("A", "A", "1", [2, 4], 11, 12.5)];
    const p = setBandPreference(emptyPreferences(), "morning", "prefer");
    p.daysOff = Day.friday;
    p.earliestStart = limit(600);
    p.latestEnd = limit(1020);
    p.dayLayout = "fewerDays";
    p.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
    p.format = "inPerson";
    expect(scheduleReasons(sections, p).filter((reason) => !reason.isCaveat)).toHaveLength(4);
  });
});

describe("ScheduleDraftTests", () => {
  it("timesAreReadTheWayAModelWritesThem", () => {
    expect(minutesFromClockText("18:00")).toBe(18 * 60);
    expect(minutesFromClockText("6:30 PM")).toBe(18 * 60 + 30);
    expect(minutesFromClockText("6pm")).toBe(18 * 60);
    expect(minutesFromClockText("6 p.m.")).toBe(18 * 60);
    expect(minutesFromClockText("10")).toBe(10 * 60);
    expect(minutesFromClockText("1800")).toBe(18 * 60);
    expect(minutesFromClockText("930")).toBe(9 * 60 + 30);
    expect(minutesFromClockText("12am")).toBe(0);
    expect(minutesFromClockText("12pm")).toBe(12 * 60);
    expect(minutesFromClockText("noon")).toBe(12 * 60);
    expect(minutesFromClockText("midnight")).toBe(24 * 60);
    expect(minutesFromClockText("24:00")).toBe(24 * 60);
    expect(minutesFromClockText("25:00")).toBeNull();
    expect(minutesFromClockText("13pm")).toBeNull();
    expect(minutesFromClockText("soon")).toBeNull();
    expect(minutesFromClockText("")).toBeNull();
    expect(minutesFromClockText("7:75")).toBeNull();
  });

  it("theBriefsExampleBecomesTheExpectedSurvey", () => {
    const applied = applyDraft(
      {
        earliestStart: "10:00",
        daysOff: ["friday"],
        wantsLunchBreak: true,
        blockedTimes: [{ label: "Robotics club", days: ["tuesday", "thursday"], start: "18:00", end: "20:00" }],
      },
      emptyPreferences(),
    );
    expect(applied.earliestStart).toEqual(limit(600, "required"));
    expect(applied.daysOff).toBe(Day.friday);
    expect(applied.daysOffStrength).toBe("preferred");
    expect(applied.lunch != null).toBe(true);
    expect(applied.blockedTimes).toHaveLength(1);
    const block = applied.blockedTimes[0];
    expect(block?.label).toBe("Robotics club");
    expect(block?.days).toBe(Day.tuesday | Day.thursday);
    expect(block?.start).toBe(18 * 60);
    expect(block?.end).toBe(20 * 60);
    expect(block?.strength).toBe("required");
    expect(summary(applied, 4)).toBe("Nothing before 10 AM · Fridays off · 1 blocked time · Lunch break");
  });

  it("bandsAndLayoutsMap", () => {
    const applied = applyDraft(
      {
        preferredTimes: ["morning", "earlyMorning"],
        avoidedTimes: ["night", "morning"],
        layout: "spreadOut",
        maxClassesPerDay: 3,
        maxHoursPerDay: 5,
        breaks: "timeToWalk",
        format: "hybrid",
        seats: "waitlistOK",
      },
      emptyPreferences(),
    );
    expect(bandPreference(applied, "earlyMorning")).toBe("prefer");
    expect(bandPreference(applied, "morning")).toBe("avoid");
    expect(bandPreference(applied, "night")).toBe("avoid");
    expect(applied.dayLayout).toBe("spreadOut");
    expect(applied.maxClassesPerDay).toBe(3);
    expect(applied.maxMinutesPerDay).toBe(300);
    expect(applied.breaks).toBe("atLeast");
    expect(applied.minimumBreakMinutes).toBe(15);
    expect(applied.minimumBreakStrength).toBe("preferred");
    expect(applied.format).toBe("hybrid");
    expect(applied.seats).toBe("waitlistOK");
  });

  it("flexibleLimitsAndRequiredDaysOff", () => {
    const applied = applyDraft(
      {
        earliestStart: "9:30",
        latestEnd: "5pm",
        timeLimitsAreFlexible: true,
        daysOff: ["monday", "friday"],
        daysOffAreRequired: true,
      },
      emptyPreferences(),
    );
    expect(applied.earliestStart).toEqual(limit(9 * 60 + 30, "preferred"));
    expect(applied.latestEnd).toEqual(limit(17 * 60, "preferred"));
    expect(applied.daysOff).toBe(Day.monday | Day.friday);
    expect(applied.daysOffStrength).toBe("required");
  });

  it("anEndBeforeTheStartIsRepairedAsTheAfternoonOrEvening", () => {
    const applied = applyDraft(
      {
        blockedTimes: [
          { label: "Lunch", days: ["monday"], start: "11:00", end: "01:00" },
          { label: "Choir", days: ["wednesday"], start: "18:00", end: "08:00" },
          { label: "Run", days: ["friday"], start: "06:00", end: "08:00" },
        ],
      },
      emptyPreferences(),
    );
    expect(applied.blockedTimes.map((block) => block.label)).toEqual(["Lunch", "Choir", "Run"]);
    expect(applied.blockedTimes[0]?.start).toBe(11 * 60);
    expect(applied.blockedTimes[0]?.end).toBe(13 * 60);
    expect(applied.blockedTimes[1]?.start).toBe(18 * 60);
    expect(applied.blockedTimes[1]?.end).toBe(20 * 60);
    expect(applied.blockedTimes[2]?.start).toBe(6 * 60);
    expect(applied.blockedTimes[2]?.end).toBe(8 * 60);
  });

  it("aFinishBeforeTheStartIsNotBelieved", () => {
    const applied = applyDraft({ earliestStart: "10:00", latestEnd: "09:00" }, emptyPreferences());
    expect(applied.earliestStart?.minutes).toBe(10 * 60);
    expect(applied.latestEnd ?? null).toBeNull();
    const current = emptyPreferences();
    current.latestEnd = limit(15 * 60);
    expect(applyDraft({ earliestStart: "16:00" }, current).latestEnd?.minutes).toBe(15 * 60);
  });

  it("unusableAnswersAreDroppedNotGuessedAt", () => {
    const applied = applyDraft(
      {
        earliestStart: "whenever",
        latestEnd: "26:00",
        maxClassesPerDay: 40,
        maxHoursPerDay: 0,
        blockedTimes: [
          { label: "No days", days: [], start: "10:00", end: "11:00" },
          { label: "No time", days: ["monday"], start: "later", end: "11:00" },
          { label: "Backwards", days: ["monday"], start: "17:00", end: "16:00" },
        ],
      },
      emptyPreferences(),
    );
    expect(isDefaultPreferences(applied)).toBe(true);
  });

  it("aDescriptionAddsToTheSurveyInsteadOfReplacingIt", () => {
    const current = setBandPreference(emptyPreferences(), "afternoon", "prefer");
    current.daysOff = Day.monday;
    current.blockedTimes = [blockedTime("Work", Day.wednesday, 13 * 60, 17 * 60)];
    const merged = applyDraft(
      {
        daysOff: ["friday"],
        blockedTimes: [
          { label: "work", days: ["wednesday"], start: "13:00", end: "17:00" },
          { label: "Choir", days: ["thursday"], start: "18:00", end: "19:30" },
        ],
      },
      current,
    );
    expect(bandPreference(merged, "afternoon")).toBe("prefer");
    expect(merged.daysOff).toBe(Day.friday);
    expect(merged.blockedTimes.map((block) => block.label)).toEqual(["Work", "Choir"]);
    const changed = changedSurveyFields(merged, current);
    expect(changed.some((field) => field.kind === "daysOff")).toBe(true);
    expect(changed.some((field) => field.kind === "timeOfDay" && field.band === "afternoon")).toBe(false);
    expect(changed).toHaveLength(2);
  });

  it("anEmptyDraftIsEmpty", () => {
    expect(draftIsEmpty({})).toBe(true);
    expect(draftIsEmpty({ wantsLunchBreak: false })).toBe(true);
    expect(draftIsEmpty({ wantsLunchBreak: true })).toBe(false);
    expect(isDefaultPreferences(applyDraft({}, emptyPreferences()))).toBe(true);
    expect(draftFilledCount({ preferredTimes: ["morning"], daysOff: ["friday"] })).toBe(2);
  });

  function overeagerDraft(): SchedulePreferencesDraft {
    return {
      earliestStart: "10:00",
      timeLimitsAreFlexible: true,
      daysOff: ["friday"],
      daysOffAreRequired: true,
      layout: "fewerDays",
      maxClassesPerDay: 3,
      maxHoursPerDay: 5,
      breaks: "avoidBackToBack",
      wantsLunchBreak: true,
      blockedTimes: [{ label: "Robotics club", days: ["tuesday", "thursday"], start: "18:00", end: "20:00" }],
      format: "online",
      seats: "openSeatsOnly",
    };
  }

  it("answersTheStudentNeverMentionedAreDropped", () => {
    const grounded = groundDraft(overeagerDraft(), briefsExample);
    expect(grounded.format).toBeUndefined();
    expect(grounded.seats).toBeUndefined();
    expect(grounded.breaks).toBeUndefined();
    expect(grounded.layout).toBeUndefined();
    expect(grounded.maxClassesPerDay).toBeUndefined();
    expect(grounded.maxHoursPerDay).toBeUndefined();
    expect(grounded.earliestStart).toBe("10:00");
    expect(grounded.wantsLunchBreak).toBe(true);
    expect(grounded.daysOff).toEqual(["friday"]);
    expect(grounded.blockedTimes).toHaveLength(1);
  });

  it("firmnessFollowsTheWordsNotTheModel", () => {
    const applied = applyDraft(groundDraft(overeagerDraft(), briefsExample), emptyPreferences());
    expect(applied.earliestStart).toEqual(limit(600, "required"));
    expect(applied.daysOffStrength).toBe("preferred");
    expect(summary(applied, 4)).toBe("Nothing before 10 AM · Fridays off · 1 blocked time · Lunch break");
  });

  it("commitmentsAndSoftenersAreRecognized", () => {
    expect(groundDraft({ daysOff: ["friday"], daysOffAreRequired: false }, "I work Fridays so I need them off").daysOffAreRequired).toBe(true);
    expect(groundDraft({ daysOff: ["monday"] }, "No classes on Mondays please").daysOffAreRequired).toBe(true);
    expect(groundDraft({ daysOff: ["monday"], daysOffAreRequired: true }, "Mondays off would be great").daysOffAreRequired).toBe(false);
    expect(groundDraft({ earliestStart: "10:00", timeLimitsAreFlexible: false }, "Ideally nothing before 10 in the morning").timeLimitsAreFlexible).toBe(true);
    expect(groundDraft({ earliestStart: "10:00", timeLimitsAreFlexible: true }, "I can’t do classes before 10").timeLimitsAreFlexible).toBe(false);
  });

  it("limitsNeedANumberAndADay", () => {
    const draft: SchedulePreferencesDraft = { maxClassesPerDay: 3, maxHoursPerDay: 5 };
    expect(groundDraft(draft, "I don’t want more than three classes a day").maxClassesPerDay).toBe(3);
    expect(groundDraft(draft, "I don’t want too many classes").maxClassesPerDay).toBeUndefined();
    expect(groundDraft(draft, "No more than 5 hours of class each day").maxHoursPerDay).toBe(5);
  });

  it("otherLanguagesAreLeftToTheModel", () => {
    const draft: SchedulePreferencesDraft = { timeLimitsAreFlexible: true, daysOff: ["friday"], daysOffAreRequired: true, format: "online" };
    const text = "Quiero las mañanas libres y los viernes sin clase, porque trabajo por las tardes";
    expect(isEnglish(text)).toBe(false);
    expect(groundDraft(draft, text)).toEqual(draft);
    expect(isEnglish(briefsExample)).toBe(true);
  });

  it("tooManyBlocksAreCapped", () => {
    const blocks = Array.from({ length: 20 }, (_, index) => ({
      label: `Block ${index}`,
      days: ["monday"],
      start: `${8 + (index % 10)}:00`,
      end: `${9 + (index % 10)}:00`,
    }));
    expect(applyDraft({ blockedTimes: blocks }, emptyPreferences()).blockedTimes.length <= 8).toBe(true);
  });

  it("failuresHaveHumanMessages", () => {
    const failures: AssistantFailure[] = [
      { kind: "emptyDescription" },
      { kind: "descriptionTooLong" },
      { kind: "guardrail" },
      { kind: "contextTooLarge" },
      { kind: "unsupportedLanguage" },
      { kind: "busy" },
      { kind: "timedOut" },
      { kind: "nothingFound" },
      { kind: "failed", detail: "x" },
      { kind: "unavailable", availability: "notEnabled" },
    ];
    expect(failures.every((failure) => assistantFailureMessage(failure).length > 0)).toBe(true);
    expect(assistantAvailabilityNote("deviceNotEligible")?.includes("survey")).toBe(true);
    expect(assistantAvailabilityNote("notEnabled")?.includes("Settings")).toBe(true);
    expect(assistantAvailabilityNote("notReady")?.includes("later")).toBe(true);
    expect(assistantAvailabilityNote("available")).toBeNull();
  });
});

describe("ScheduleBlockerTests", () => {
  it("findsTheCourseThatAlwaysClashes", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("B1", "B", "1", [1], 9.5, 10.5)]),
      pc("C", "1", [section("C1", "C", "1", [2], 9, 10)]),
    ];
    const result = generate(courses);
    expect(result.totalFound).toBe(0);
    const analysis = analyzeBlockers(courses, emptyScheduleFilters(), emptyPreferences(), result.diagnostics);
    expect(analysis.requiredCount).toBe(3);
    expect(new Set(analysis.options.map((option) => option.courses.map((key) => keyId(key)).join()))).toEqual(new Set(["A 1", "B 1"]));
    expect(new Set(analysis.allBlockingCourses.map((key) => keyId(key)))).toEqual(new Set(["A 1", "B 1"]));
    expect(analysis.clashes({ subject: "A", number: "1" }).map((key) => keyId(key))).toEqual(["B 1"]);
    expect(analysis.options.every((option) => option.scheduleCount === 1)).toBe(true);
  });

  it("aCourseWithNoSectionsAlwaysHasToGo", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]), pc("B", "1", []), pc("C", "1", [section("C1", "C", "1", [2], 9, 10)])];
    const analysis = analyzeBlockers(courses, emptyScheduleFilters());
    expect(analysis.notOffered.map((key) => keyId(key))).toEqual(["B 1"]);
    expect(analysis.options.map((option) => option.courses.map((key) => keyId(key)))).toEqual([["B 1"]]);
  });

  it("coursesTheRulesRuleOutAreReportedSeparately", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [5], 9, 10)]), pc("B", "1", [section("B1", "B", "1", [2], 9, 10)])];
    const p = emptyPreferences();
    p.daysOff = Day.friday;
    p.daysOffStrength = "required";
    const analysis = analyzeBlockers(courses, emptyScheduleFilters(), p);
    expect(analysis.filteredOut.map((key) => keyId(key))).toEqual(["A 1"]);
    expect(analysis.notOffered).toEqual([]);
    expect(analysis.options.map((option) => option.courses.map((key) => keyId(key)))).toEqual([["A 1"]]);
  });

  it("looksAtPairsWhenNoSingleCourseIsToBlame", () => {
    const courses = [
      pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]),
      pc("B", "1", [section("B1", "B", "1", [1], 9, 10)]),
      pc("C", "1", [section("C1", "C", "1", [2], 9, 10)]),
      pc("D", "1", [section("D1", "D", "1", [2], 9, 10)]),
    ];
    const analysis = analyzeBlockers(courses, emptyScheduleFilters());
    expect(analysis.options).toHaveLength(4);
    expect(analysis.options.every((option) => option.courses.length === 2)).toBe(true);
    const sets = analysis.options.map((option) => option.courses.map((key) => keyId(key)).sort().join("|")).sort();
    expect(sets).toEqual(["A 1|C 1", "A 1|D 1", "B 1|C 1", "B 1|D 1"].sort());
  });

  it("countProblemsAreNotCourseProblems", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]), pc("B", "1", [section("B1", "B", "1", [2], 9, 10)])];
    const filters: ScheduleFilters = { ...emptyScheduleFilters(), courseCount: 1 };
    const result = generate(courses, emptyPreferences(), filters);
    const analysis = analyzeBlockers(courses, filters, emptyPreferences(), result.diagnostics);
    expect(analysis.options).toEqual([]);
  });

  it("makingTheBlockersOptionalProducesSchedules", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]), pc("B", "1", [section("B1", "B", "1", [1], 9.5, 10.5)])];
    const analysis = analyzeBlockers(courses, emptyScheduleFilters());
    const drop = new Set(analysis.blockingCourses.map((key) => keyId(key)));
    const relaxed = courses.map((input) => (drop.has(keyId(input.key)) ? { ...input, isRequired: false } : input));
    expect(generate(relaxed).totalFound).toBeGreaterThan(0);
  });

  it("noResultsAnalysisCombinesBlockersAndRelaxations", () => {
    const courses = [pc("A", "1", [section("A1", "A", "1", [1], 9, 10)]), pc("B", "1", [section("B1", "B", "1", [1], 9.5, 10.5)])];
    const result = generate(courses);
    const analysis = analyzeEmptyResult(courses, emptyScheduleFilters(), emptyPreferences(), result.diagnostics);
    expect(analysis.blockers.options.length).toBeGreaterThan(0);
    expect(analysis.suggestions).toEqual([]);
  });
});

describe("SchedulePreferencesContextTests", () => {
  it("campusesInstructorsAndCreditsComeFromThePlansCourses", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    const index = CatalogIndex.build(catalog!);
    const item = makePlan("Plan", "202710");
    item.courses = [
      { key: { subject: "CS", number: "3000" }, isRequired: true, excludedCRNs: [], colorIndex: 0 },
      { key: { subject: "MATH", number: "2331" }, isRequired: false, excludedCRNs: [], colorIndex: 1 },
    ];
    const context = schedulePreferencesContext(item, index);
    expect(context.campusNames).toContain("Boston");
    expect(context.campusNames.every((name) => !name.toLowerCase().includes("online") && !name.toLowerCase().includes("no campus"))).toBe(true);
    expect(context.optionalCourseCount).toBe(1);
    expect(context.requiredCredits).toBeGreaterThan(0);
    expect(context.totalCredits).toBeGreaterThan(context.requiredCredits);
    expect(context.instructors.length).toBeGreaterThan(0);
    expect(context.instructors.every((instructor) => instructor.courses.length > 0)).toBe(true);
    const names = context.instructors.map((instructor) => instructor.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(schedulePreferencesContext(item, null).instructors).toEqual([]);
  }, 60_000);

  it("excludedSectionsDontOfferTheirInstructors", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    const index = CatalogIndex.build(catalog!);
    const key = { subject: "CS", number: "3000" };
    const item = makePlan("Plan", "202710");
    item.courses = [{ key, isRequired: true, excludedCRNs: [], colorIndex: 0 }];
    const everyone = schedulePreferencesContext(item, index).instructors;
    item.courses[0]!.excludedCRNs = index.sectionsOf(key).map((entry) => entry.crn);
    expect(schedulePreferencesContext(item, index).instructors).toEqual([]);
    expect(everyone.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("ScheduleReorderBridgeTests", () => {
  it("aSuggestionBecomesAnOptionThatMovesTheCourseOutOfTheSchedule", () => {
    const plan = degreePlan([
      { id: "fall", season: "fall", year: 2026, courses: [planned("CS 3386"), planned("CS 3800")] },
      { id: "spring", season: "spring", year: 2027, courses: [planned("CS 4100")] },
    ]);
    const found = reorderSuggestions({ plan, termID: "fall", blocking: [parseCourseKey("CS 3386")!], history: history(), prerequisites: () => null });
    const single = found.find((item) => item.moves.length === 1);
    expect(single).toBeTruthy();
    const option = reorderOption(single!, "fall");
    expect(option.title).toBe("Move CS 3386 to Spring 2027");
    expect(option.appliedText).toBe("Moved CS 3386 to Spring 2027");
    expect(option.movedAway.map((key) => keyId(key))).toEqual(["CS 3386"]);
    expect(option.movedIn).toEqual([]);
    expect(option.scheduleEffect).toBe("CS 3386 comes out of this schedule.");
    expect(option.reasons[0]).toBe("Offered every spring");
    expect(option.addsSemester).toBe(false);
    const changed = structuredClone(plan);
    applyReorderSuggestion(single!, changed);
    expect(changed.terms[0]?.courses.map((item) => (item.key ? keyId(item.key) : ""))).toEqual(["CS 3800"]);
    expect(changed.terms[1]?.courses.map((item) => (item.key ? keyId(item.key) : ""))).toEqual(["CS 4100", "CS 3386"]);
    expect(plan.terms[0]?.courses).toHaveLength(2);
  });

  it("aSwapAlsoBringsACourseIn", () => {
    const plan = degreePlan([
      { id: "fall", season: "fall", year: 2026, courses: [planned("CS 3386"), planned("CS 3800")] },
      { id: "spring", season: "spring", year: 2027, courses: [planned("CS 4100")] },
    ]);
    const found = reorderSuggestions({ plan, termID: "fall", blocking: [parseCourseKey("CS 3386")!], history: history(), prerequisites: () => null });
    const swap = found.find((item) => item.moves.length === 2);
    expect(swap).toBeTruthy();
    const option = reorderOption(swap!, "fall");
    expect(option.movedAway.map((key) => keyId(key))).toEqual(["CS 3386"]);
    expect(option.movedIn.map((key) => keyId(key))).toEqual(["CS 4100"]);
    expect(option.scheduleEffect).toBe("CS 3386 comes out of this schedule. CS 4100 will be added to it if it\u2019s offered this term.");
  });

  it("aNewSemesterIsFlagged", () => {
    const plan = degreePlan([{ id: "fall", season: "fall", year: 2026, courses: [planned("CS 3386")] }]);
    const found = reorderSuggestions({ plan, termID: "fall", blocking: [parseCourseKey("CS 3386")!], history: history(), prerequisites: () => null });
    expect(found[0]).toBeTruthy();
    const option = reorderOption(found[0]!, "fall");
    expect(option.addsSemester).toBe(true);
    const changed = structuredClone(plan);
    applyReorderSuggestion(found[0]!, changed);
    expect(changed.terms).toHaveLength(2);
    expect(changed.terms.at(-1)?.courses.map((item) => (item.key ? keyId(item.key) : ""))).toEqual(["CS 3386"]);
  });

  it("nothingIsLookedUpWhenNoBlockingCourseIsInTheSemester", () => {
    const plan = degreePlan([
      { id: "fall", season: "fall", year: 2026, courses: [planned("CS 3386"), planned("CS 3800")] },
      { id: "spring", season: "spring", year: 2027, courses: [planned("CS 4100")] },
    ]);
    const fall: Term = { code: "202710", bannerDescription: "Fall 2026 Semester" };
    const semester = plan.terms.find((term) => planTermMatches(term, fall));
    const missing = semester ? reorderSuggestions({ plan, termID: semester.id, blocking: [parseCourseKey("CS 9001")!], history: history(), prerequisites: () => null }) : [];
    expect(missing).toEqual([]);
    const summer: Term = { code: "202750", bannerDescription: "Summer Full 2027 Semester" };
    const summerTerm = plan.terms.find((term) => planTermMatches(term, summer));
    const summerOptions = summerTerm
      ? reorderSuggestions({ plan, termID: summerTerm.id, blocking: [parseCourseKey("CS 3386")!], history: history(), prerequisites: () => null })
      : [];
    expect(summerOptions).toEqual([]);
  });

  it("titlesThatAreNotMovesStillReadSensibly", () => {
    const option = reorderOption({ id: "x", title: "Something else", reasons: [], addsSemester: null, moves: [] }, "fall");
    expect(option.appliedText).toBe("Updated your degree plan");
    expect(option.scheduleEffect).toBe("");
  });
});

describe("ScheduleSearchAgainstBruteForceTests", () => {
  it("randomPlansMatchAnObviouslyCorrectEnumeration", () => {
    const mask = (1n << 64n) - 1n;
    let state = 20261004n;
    const next = () => {
      state = (state + 0x9e3779b97f4a7c15n) & mask;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
      return (z ^ (z >> 31n)) & mask;
    };
    const int = (lo: number, hi: number) => lo + Number(next() % BigInt(hi - lo + 1));
    const pick = <T>(values: readonly T[]) => values[Number(next() % BigInt(values.length))]!;
    const coin = () => (next() & 1n) === 1n;
    const starts = [8, 9.5, 11, 12.5, 14, 15.5, 17];
    const buildings = ["RY", "SL", "WVH"];
    const dayChoices = [[1, 3], [2, 4], [1, 3, 5], [1], [2], [3], [4], [5], [2, 5]];
    const windows: [string, string][] = [
      ["2026-09-09", "2026-12-13"],
      ["2026-09-09", "2026-10-23"],
      ["2026-10-26", "2026-12-13"],
    ];
    const lengths = [0.75, 1.25, 1.5, 2];
    let nonTrivial = 0;
    for (let round = 0; round < 400; round++) {
      const courseCount = int(2, 5);
      const courses = [];
      for (let c = 0; c < courseCount; c++) {
        const sections = [];
        const sectionCount = int(1, 4);
        for (let s = 0; s < sectionCount; s++) {
          const start = pick(starts);
          const window = pick(windows);
          sections.push(section(`C${c}S${s}`, `C${c}`, "1", pick(dayChoices), start, start + pick(lengths), { building: pick(buildings), startDate: window[0], endDate: window[1] }));
        }
        courses.push(course(`C${c}`, "1", sections, { required: coin() || c === 0, credits: int(1, 4) }));
      }
      const filters: ScheduleFilters = { ...emptyScheduleFilters() };
      if (int(0, 5) === 0) filters.courseCount = int(1, courseCount);
      const p = emptyPreferences();
      if (coin()) p.maxClassesPerDay = int(1, 3);
      if (coin()) p.maxMinutesPerDay = pick([90, 150, 210, 300]);
      if (coin()) {
        p.breaks = "atLeast";
        p.minimumBreakMinutes = pick([10, 20, 40]);
        p.minimumBreakStrength = "required";
      }
      if (int(0, 2) === 0) {
        const lower = int(2, 10);
        p.creditTarget = { lower, upper: lower + int(0, 5) };
      }
      if (int(0, 2) === 0) p.blockedTimes = [blockedTime("Block", dayMask(pick(dayChoices)), 11 * 60, 14 * 60)];
      const expected = bruteForce(courses, filters, p);
      const result = generate(courses, p, filters);
      expect(result.isExhaustive, `round ${round}`).toBe(true);
      const actual = new Set(crnSets(result));
      if (actual.size !== expected.size || [...expected].some((item) => !actual.has(item))) {
        const missing = [...expected].filter((item) => !actual.has(item)).slice(0, 3);
        const extra = [...actual].filter((item) => !expected.has(item)).slice(0, 3);
        expect.fail(`Round ${round}: generator found ${actual.size} schedules, enumeration found ${expected.size}. Missing: ${missing.join("; ")}, extra: ${extra.join("; ")}`);
      }
      expect(result.totalFound).toBe(expected.size);
      if (expected.size) nonTrivial += 1;
    }
    expect(nonTrivial).toBeGreaterThan(100);
  }, 120_000);
});

describe("SchedulePreferencesCatalogTests", () => {
  it("preferencesRankAndFilterARealPlanQuickly", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    const index = CatalogIndex.build(catalog!);
    const codes = ["CS 3000", "CS 3001", "MATH 2331", "PHYS 1151"];
    const courses = courseInputsFor(
      codes.map((code) => ({ key: parseCourseKey(code)!, isRequired: true })),
      { course: (key) => index.course(key) ?? null, sectionsFor: (key) => index.sectionsOf(key) },
    );
    const plain = generate(courses);
    expect(plain.totalFound).toBeGreaterThan(0);
    let p = togglePreset("longWeekends", emptyPreferences());
    p = togglePreset("morningPerson", p);
    p.blockedTimes = [blockedTime("Club", Day.tuesday | Day.thursday, 18 * 60, 20 * 60)];
    p.lunch = { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 };
    p.maxClassesPerDay = 3;
    const ranked = generate(courses, p);
    expect(ranked.totalFound).toBeLessThanOrEqual(plain.totalFound);
    expect(ranked.elapsed).toBeLessThan(10);
    const best = ranked.schedules[0];
    if (best) {
      for (const entry of best.sections) {
        for (const meeting of weeklyMeetings(entry)) {
          const overlapsClub = (meeting.days & (Day.tuesday | Day.thursday)) !== 0 && (meeting.start ?? 0) < 20 * 60 && (meeting.end ?? 0) > 18 * 60;
          expect(overlapsClub).toBe(false);
        }
      }
      expect(best.reasons.length).toBeGreaterThan(0);
    }
    const scores = ranked.schedules.map((schedule) => schedule.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  }, 60_000);
});
});
