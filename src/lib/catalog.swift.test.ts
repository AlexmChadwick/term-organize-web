import { beforeAll, describe, expect, it } from "vitest";
import { CatalogIndex, popularSubjects, type InstructorSummary } from "./catalog-index";
import { loadBundledCatalog } from "./catalog-store";
import { courseStatusLabel, courseStatusSpoken, type DegreeCourseStatus } from "./degree/substitutions";
import {
  COURSE_PALETTE,
  Day,
  compareCourseKeys,
  emptySearchFilters,
  searchFilterCount,
  sectionKey,
  type CourseKey,
  type CourseSection,
  type SearchFilters,
} from "./models";
import { searchCatalog } from "./search";
import { emptyPlanFilters, emptyUserData, newId, type SchedulePlan, type UserData } from "./user";
import * as catalogSupport from "./search";
import * as user from "./user";

let index: CatalogIndex;

beforeAll(async () => {
  const catalog = await loadBundledCatalog("202710");
  if (!catalog) throw new Error("Bundled catalog missing");
  index = CatalogIndex.build(catalog);
}, 60_000);

function optionalExport<T>(mod: object, name: string): T | undefined {
  if (!(name in mod)) return undefined;
  return (mod as Record<string, T>)[name];
}

type DayPreset = { id: string; days: number | null };
type DayPresetApi = {
  allCases: DayPreset[];
  selection(days: number | null): string;
  matching(days: number | null): string | null;
};

type FilterTitles = {
  days(days: number | null): string;
  subjects(subjects: string[]): string;
  nupaths(paths: string[]): string;
  level(level: number): string;
};

type TimeOfDay = {
  date(minutes: number): Date;
  minutes(date: Date): number;
};

type QuickPreset = { title: string; symbol: string; filters: SearchFilters };
type QuickSearch = {
  allCases: QuickPreset[];
  openSeats: QuickPreset;
  honors: QuickPreset;
  online: QuickPreset;
  noFridays: QuickPreset;
  firstYear: QuickPreset;
};

type SearchExample = { title: string; caption: string };
type ExampleCache = { examples(index: CatalogIndex): SearchExample[] };

type ProfessorPage = {
  sections(summary: InstructorSummary, index: CatalogIndex): CourseSection[];
  courseColors(keys: CourseKey[]): Map<string, unknown> | Record<string, unknown>;
  summaryText(sections: CourseSection[]): string;
  sectionNote(key: CourseKey, sections: CourseSection[]): string;
  rateMyProfessorsURL(name: string): string | { href?: string; toString(): string } | null;
};

const MTWR = Day.monday | Day.tuesday | Day.wednesday | Day.thursday;
const dayPresets: DayPreset[] = [
  { id: "any", days: null },
  { id: "noFridays", days: MTWR },
  { id: "mwr", days: Day.monday | Day.wednesday | Day.thursday },
  { id: "tf", days: Day.tuesday | Day.friday },
  { id: "mr", days: Day.monday | Day.thursday },
  { id: "wf", days: Day.wednesday | Day.friday },
  { id: "custom", days: null },
];

function section(key: CourseKey, number: string): CourseSection {
  return {
    crn: `${key.number}${number}`,
    subject: key.subject,
    number: key.number,
    title: "T",
    sectionNumber: number,
    partOfTerm: "1",
    seatCapacity: 10,
    seatsRemaining: 5,
    enrollment: 5,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    meetings: [],
    crossListCRNs: [],
    attributes: [],
  };
}

function colorList(colors: Map<string, unknown> | Record<string, unknown> | undefined): unknown[] {
  if (!colors) return [];
  if (colors instanceof Map) return [...colors.values()];
  return Object.values(colors);
}

function absoluteURL(value: string | { href?: string; toString(): string } | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return value.href ?? value.toString();
}

describe("CatalogSupportTests", () => {
  it("dayPresetsDescribeTheirDays", () => {
    const api = optionalExport<DayPresetApi>(catalogSupport, "SearchDayPreset");
    expect.soft(api?.selection(null)).toBe("any");
    expect.soft(api?.selection(MTWR)).toBe("noFridays");
    expect.soft(api?.selection(Day.tuesday | Day.friday)).toBe("tf");
    expect.soft(api?.selection(Day.monday | Day.friday)).toBe("custom");
    expect.soft(api?.matching(Day.monday | Day.friday)).toBeNull();
    for (const preset of api?.allCases ?? dayPresets) {
      if (preset.id === "custom") continue;
      expect.soft(api?.selection(preset.days)).toBe(preset.id);
    }
  });

  it("filterChipTitles", () => {
    const titles = optionalExport<FilterTitles>(catalogSupport, "SearchFilterTitles");
    expect.soft(titles?.days(null)).toBe("Days");
    expect.soft(titles?.days(MTWR)).toBe("No Fridays");
    expect.soft(titles?.days(Day.monday | Day.friday)).toBe("MF only");
    expect.soft(titles?.days(0)).toBe("No set days");
    expect.soft(titles?.subjects([])).toBe("Subject");
    expect.soft(titles?.subjects(["CS"])).toBe("CS");
    expect.soft(titles?.subjects(["CS", "DS", "MATH"])).toBe("3 subjects");
    expect.soft(titles?.nupaths(["FQ", "WI"])).toBe("FQ, WI");
    expect.soft(titles?.nupaths(["FQ", "WI", "CE"])).toBe("NUpath · 3");
    expect.soft(titles?.level(0)).toBe("Under 1000");
    expect.soft(titles?.level(3)).toBe("3000");
  });

  it("timeOfDayConversionRoundTrips", () => {
    const time = optionalExport<TimeOfDay>(catalogSupport, "SearchTimeOfDay");
    for (const minutes of [0, 9 * 60, 12 * 60 + 35, 17 * 60, 23 * 60 + 59]) {
      const date = time?.date(minutes);
      expect.soft(date == null ? undefined : time?.minutes(date)).toBe(minutes);
    }
    const below = time?.date(-30);
    const above = time?.date(5_000);
    expect.soft(below == null ? undefined : time?.minutes(below)).toBe(0);
    expect.soft(above == null ? undefined : time?.minutes(above)).toBe(24 * 60 - 1);
  });

  it("quickSearchesApplyExactlyOneFilter", () => {
    const quick = optionalExport<QuickSearch>(catalogSupport, "HomeQuickSearch");
    const cases = quick?.allCases ?? [];
    expect.soft(cases.length > 0).toBe(true);
    for (const preset of cases) {
      expect.soft(searchFilterCount(preset.filters)).toBe(1);
      expect.soft(preset.symbol.length > 0).toBe(true);
    }
    expect.soft(quick?.openSeats?.filters.openSeatsOnly).toBe(true);
    expect.soft(quick?.honors?.filters.honorsOnly).toBe(true);
    expect.soft(quick?.online?.filters.instruction).toBe("online");
    expect.soft(quick?.noFridays?.filters.allowedDays).toBe(MTWR);
    expect.soft(quick?.firstYear?.filters.levels).toEqual([1]);
  });

  it("quickSearchesFindCourses", () => {
    const quick = optionalExport<QuickSearch>(catalogSupport, "HomeQuickSearch");
    const cases = quick?.allCases ?? [];
    expect.soft(cases.length > 0).toBe(true);
    for (const preset of cases) {
      const response = searchCatalog(index, "", preset.filters, "relevance");
      expect.soft(response.results.length > 0).toBe(true);
    }
  });

  it("browseSummaryLines", () => {
    const browseSummaryText = optionalExport<
      (shown: number, total: number, open: number, openOnly?: boolean, noun?: string) => string
    >(catalogSupport, "browseSummaryText");
    const browseLevelTitle = optionalExport<(level: number) => string>(catalogSupport, "browseLevelTitle");
    const browseLevelNoun = optionalExport<(level: number) => string>(catalogSupport, "browseLevelNoun");
    expect.soft(browseSummaryText?.(42, 42, 0)).toBe("42 courses");
    expect.soft(browseSummaryText?.(1, 1, 0)).toBe("1 course");
    expect.soft(browseSummaryText?.(12, 42, 9)).toBe("12 of 42 courses · 9 with open seats");
    expect.soft(browseSummaryText?.(9, 42, 9, true)).toBe("9 of 42 courses");
    expect.soft(browseSummaryText?.(2, 2, 0, false, "professor")).toBe("2 professors");
    expect.soft(browseLevelTitle?.(1)).toBe("1000-level");
    expect.soft(browseLevelTitle?.(0)).toBe("Under 1000");
    expect.soft(browseLevelNoun?.(3)).toBe("3000-level courses");
    expect.soft(browseLevelNoun?.(0)).toBe("courses under 1000");
  });

  it("popularSubjectsAreTheBusiest", () => {
    const popular = popularSubjects(index, 12);
    expect.soft(popular.length).toBe(12);
    const counts = popular.map((subject) => index.courseCountBySubject.get(subject.code) ?? 0);
    expect.soft(counts).toEqual([...counts].sort((a, b) => b - a));
    const busiestOutside = Math.max(
      0,
      ...index.activeSubjects
        .filter((subject) => !popular.some((item) => item.code === subject.code))
        .map((subject) => index.courseCountBySubject.get(subject.code) ?? 0),
    );
    expect.soft((counts.at(-1) ?? 0) >= busiestOutside).toBe(true);
    expect.soft(popularSubjects(index, 3).map((subject) => subject.code)).toEqual(popular.slice(0, 3).map((subject) => subject.code));
  });

  it("searchExamplesAllFindSomething", () => {
    const cache = optionalExport<ExampleCache>(catalogSupport, "SearchExampleCache");
    const examples = cache?.examples(index) ?? [];
    expect.soft(examples.length >= 3).toBe(true);
    for (const example of examples) {
      const response = searchCatalog(index, example.title, emptySearchFilters(), "relevance");
      const found = response.results.length > 0 || response.crnMatch != null || response.instructors.length > 0;
      expect.soft(found).toBe(true);
    }
  });

  it("professorPageOrdersSectionsAndGivesEachCourseItsOwnColor", () => {
    const page = optionalExport<ProfessorPage>(catalogSupport, "ProfessorPage");
    const summary = index.instructors.find((person) => person.courseKeys.length >= 3);
    expect.soft(summary).toBeTruthy();
    if (!summary) return;
    const sections = page?.sections(summary, index);
    expect.soft(sections?.length).toBe(summary.crns.length);
    const ordered = sections ?? [];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect.soft(compareCourseKeys(sectionKey(ordered[i]!), sectionKey(ordered[i + 1]!)) <= 0).toBe(true);
    }
    const keys = summary.courseKeys.slice(0, COURSE_PALETTE.length);
    const colors = page?.courseColors(keys);
    const values = colorList(colors);
    expect.soft(values.length).toBe(keys.length);
    expect.soft(new Set(values.map((value) => JSON.stringify(value))).size).toBe(keys.length);
    expect.soft(colors == null ? undefined : page?.courseColors(keys)).toEqual(colors == null ? { missing: true } : colors);
  });

  it("professorPageTexts", () => {
    const page = optionalExport<ProfessorPage>(catalogSupport, "ProfessorPage");
    const a = { subject: "CS", number: "3000" };
    const b = { subject: "CS", number: "3001" };
    const sections = [section(a, "01"), section(a, "04"), section(b, "02")];
    expect.soft(page?.summaryText(sections)).toBe("Teaches 3 sections across 2 courses");
    expect.soft(page?.summaryText([sections[2]!])).toBe("Teaches 1 section across 1 course");
    expect.soft(page?.sectionNote(a, sections)).toBe("Sections 01, 04");
    expect.soft(page?.sectionNote(b, sections)).toBe("Section 02");
    expect.soft(absoluteURL(page?.rateMyProfessorsURL("Jane Doe"))).toBe(
      "https://www.ratemyprofessors.com/search/professors/696?q=Jane%20Doe",
    );
    expect.soft(absoluteURL(page?.rateMyProfessorsURL("José O'Neil-Smith"))?.includes("q=Jos%C3%A9%20O%27Neil-Smith")).toBe(true);
  });

  it("degreePlanStandingTexts", () => {
    const completed: DegreeCourseStatus = { type: "completed", term: null };
    const symbol = optionalExport<(status: DegreeCourseStatus) => string>(catalogSupport, "courseStatusSymbol");
    const viaText = optionalExport<(kind: "completed" | "planned", via: CourseKey | null, semester?: string) => string>(
      catalogSupport,
      "degreePlanStandingText",
    );
    const viaSpoken = optionalExport<(kind: "completed" | "planned", via: CourseKey | null, semester?: string) => string>(
      catalogSupport,
      "degreePlanStandingSpoken",
    );
    expect.soft(viaText?.("completed", null) ?? courseStatusLabel(completed)).toBe("Completed");
    expect.soft(symbol?.(completed)).toBe("checkmark.circle.fill");
    expect.soft(viaSpoken?.("completed", null) ?? courseStatusSpoken(completed)).toBe("Completed, in your degree plan");
    const via = { subject: "CS", number: "2510" };
    expect.soft(viaText?.("completed", via) ?? courseStatusLabel(completed)).toBe("Completed via CS 2510");
    const planned: DegreeCourseStatus = { type: "planned", term: "Spring 2027" };
    expect.soft(viaText?.("planned", null, "Spring 2027") ?? courseStatusLabel(planned)).toBe("Planned · Spring 2027");
    expect.soft(symbol?.(planned)).toBe("calendar");
    expect.soft(viaText?.("planned", via, "Spring 2027") ?? courseStatusLabel(planned)).toBe("Planned via CS 2510 · Spring 2027");
    expect.soft(viaSpoken?.("planned", via, "Spring 2027") ?? courseStatusSpoken(planned)).toBe(
      "Planned via CS 2510 for Spring 2027 in your degree plan",
    );
  });

  it("courseIsInScheduleCountsOnlyThePlansOfTheTerm", () => {
    const courseIsInSchedule = optionalExport<
      (data: UserData, termCode: string, key: CourseKey, crn?: string) => boolean
    >(user, "courseIsInSchedule");
    const key = { subject: "CS", number: "3000" };
    let data = emptyUserData();
    expect.soft(courseIsInSchedule?.(data, "202710", key)).toBe(false);
    const plan: SchedulePlan = {
      id: newId(),
      name: "Plan A",
      termCode: "202710",
      courses: [{ key, isRequired: true, excludedCRNs: [], colorIndex: 0 }],
      selectedCRNs: [],
      filters: emptyPlanFilters(),
      favoriteCombinations: [],
      isPrimary: true,
      createdAt: 0,
      updatedAt: 0,
    };
    data = { ...data, plans: [plan] };
    expect.soft(courseIsInSchedule?.(data, "202710", key)).toBe(true);
    expect.soft(courseIsInSchedule?.(data, "202630", key)).toBe(false);
    expect.soft(courseIsInSchedule?.(data, "202710", key, "12726")).toBe(false);
    data = { ...data, plans: [{ ...plan, selectedCRNs: ["12726"] }] };
    expect.soft(courseIsInSchedule?.(data, "202710", key, "12726")).toBe(true);
  });
});
