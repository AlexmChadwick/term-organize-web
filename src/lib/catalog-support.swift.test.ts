import { beforeAll, describe, expect, it } from "vitest";
import { CatalogIndex, popularSubjects } from "@/lib/catalog-index";
import {
  CourseDegreePlanStanding,
  HomeQuickSearch,
  SearchDayPreset,
  SearchFilterTitles,
  browseLevelNoun,
  browseLevelTitle,
  browseSummaryText,
  courseIsInSchedule,
  professorCourseColors,
  professorSectionNote,
  professorSections,
  professorSummaryText,
  rateMyProfessorsURL,
  searchDateFromMinutes,
  searchExamples,
  searchMinutesFromDate,
} from "@/lib/catalog-support";
import { loadBundledCatalog } from "@/lib/catalog-store";
import {
  COURSE_PALETTE,
  Day,
  compareCourseKeys,
  emptySearchFilters,
  searchFilterCount,
  sectionKey,
  type CourseKey,
  type CourseSection,
} from "@/lib/models";
import { searchCatalog } from "@/lib/search";
import { emptyPlanFilters, emptyUserData, newId, type SchedulePlan, type UserData } from "@/lib/user";

let index: CatalogIndex;

beforeAll(async () => {
  const catalog = await loadBundledCatalog("202710");
  if (!catalog) throw new Error("Bundled catalog missing");
  index = CatalogIndex.build(catalog);
}, 60_000);

const MTWR = Day.monday | Day.tuesday | Day.wednesday | Day.thursday;

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

describe("CatalogSupportTests", () => {
  it("dayPresetsDescribeTheirDays", () => {
    expect(SearchDayPreset.selection(null)).toBe("any");
    expect(SearchDayPreset.selection(MTWR)).toBe("noFridays");
    expect(SearchDayPreset.selection(Day.tuesday | Day.friday)).toBe("tf");
    expect(SearchDayPreset.selection(Day.monday | Day.friday)).toBe("custom");
    expect(SearchDayPreset.matching(Day.monday | Day.friday)).toBeNull();
    for (const preset of SearchDayPreset.allCases) {
      if (preset.id === "custom") continue;
      expect(SearchDayPreset.selection(preset.days)).toBe(preset.id);
    }
  });

  it("filterChipTitles", () => {
    expect(SearchFilterTitles.days(null)).toBe("Days");
    expect(SearchFilterTitles.days(MTWR)).toBe("No Fridays");
    expect(SearchFilterTitles.days(Day.monday | Day.friday)).toBe("MF only");
    expect(SearchFilterTitles.days(0)).toBe("No set days");
    expect(SearchFilterTitles.subjects([])).toBe("Subject");
    expect(SearchFilterTitles.subjects(["CS"])).toBe("CS");
    expect(SearchFilterTitles.subjects(["CS", "DS", "MATH"])).toBe("3 subjects");
    expect(SearchFilterTitles.nupaths(["FQ", "WI"])).toBe("FQ, WI");
    expect(SearchFilterTitles.nupaths(["FQ", "WI", "CE"])).toBe("NUpath \u00b7 3");
    expect(SearchFilterTitles.level(0)).toBe("Under 1000");
    expect(SearchFilterTitles.level(3)).toBe("3000");
  });

  it("timeOfDayConversionRoundTrips", () => {
    for (const minutes of [0, 9 * 60, 12 * 60 + 35, 17 * 60, 23 * 60 + 59]) {
      expect(searchMinutesFromDate(searchDateFromMinutes(minutes))).toBe(minutes);
    }
    expect(searchMinutesFromDate(searchDateFromMinutes(-30))).toBe(0);
    expect(searchMinutesFromDate(searchDateFromMinutes(5_000))).toBe(24 * 60 - 1);
  });

  it("quickSearchesApplyExactlyOneFilter", () => {
    for (const preset of HomeQuickSearch.allCases) {
      expect(searchFilterCount(preset.filters), preset.title).toBe(1);
      expect(preset.symbol.length > 0).toBe(true);
    }
    expect(HomeQuickSearch.openSeats.filters.openSeatsOnly).toBe(true);
    expect(HomeQuickSearch.honors.filters.honorsOnly).toBe(true);
    expect(HomeQuickSearch.online.filters.instruction).toBe("online");
    expect(HomeQuickSearch.noFridays.filters.allowedDays).toBe(MTWR);
    expect(HomeQuickSearch.firstYear.filters.levels).toEqual([1]);
  });

  it("quickSearchesFindCourses", () => {
    for (const preset of HomeQuickSearch.allCases) {
      const response = searchCatalog(index, "", preset.filters, "relevance");
      expect(response.results.length > 0, `${preset.title} found nothing in the bundled catalog`).toBe(true);
    }
  });

  it("browseSummaryLines", () => {
    expect(browseSummaryText(42, 42, 0)).toBe("42 courses");
    expect(browseSummaryText(1, 1, 0)).toBe("1 course");
    expect(browseSummaryText(12, 42, 9)).toBe("12 of 42 courses \u00b7 9 with open seats");
    expect(browseSummaryText(9, 42, 9, true)).toBe("9 of 42 courses");
    expect(browseSummaryText(2, 2, 0, false, "professor")).toBe("2 professors");
    expect(browseLevelTitle(1)).toBe("1000-level");
    expect(browseLevelTitle(0)).toBe("Under 1000");
    expect(browseLevelNoun(3)).toBe("3000-level courses");
    expect(browseLevelNoun(0)).toBe("courses under 1000");
  });

  it("popularSubjectsAreTheBusiest", () => {
    const popular = popularSubjects(index, 12);
    expect(popular).toHaveLength(12);
    const counts = popular.map((subject) => index.courseCountBySubject.get(subject.code) ?? 0);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const outside = index.activeSubjects
      .filter((subject) => !popular.some((item) => item.code === subject.code))
      .map((subject) => index.courseCountBySubject.get(subject.code) ?? 0);
    const busiestOutside = outside.length === 0 ? 0 : Math.max(...outside);
    expect((counts.at(-1) ?? 0) >= busiestOutside).toBe(true);
    expect(popularSubjects(index, 3).map((subject) => subject.code)).toEqual(popular.slice(0, 3).map((subject) => subject.code));
  });

  it("searchExamplesAllFindSomething", () => {
    const examples = searchExamples(index);
    expect(examples.length >= 3).toBe(true);
    for (const example of examples) {
      const response = searchCatalog(index, example.title, emptySearchFilters(), "relevance");
      const found = response.results.length > 0 || response.crnMatch != null || response.instructors.length > 0;
      expect(found, `\u201c${example.title}\u201d (${example.caption}) found nothing`).toBe(true);
    }
  });

  it("professorPageOrdersSectionsAndGivesEachCourseItsOwnColor", () => {
    const summary = index.instructors.find((person) => person.courseKeys.length >= 3);
    if (!summary) throw new Error("expected an instructor who teaches at least 3 courses");
    const sections = professorSections(summary, index);
    expect(sections).toHaveLength(summary.crns.length);
    for (let i = 0; i < sections.length - 1; i++) {
      expect(compareCourseKeys(sectionKey(sections[i]!), sectionKey(sections[i + 1]!)) <= 0).toBe(true);
    }
    const keys = summary.courseKeys.slice(0, COURSE_PALETTE.length);
    const colors = professorCourseColors(keys);
    expect(colors.size).toBe(keys.length);
    expect(new Set(colors.values()).size).toBe(keys.length);
    expect(professorCourseColors(keys)).toEqual(colors);
  });

  it("professorPageTexts", () => {
    const a = { subject: "CS", number: "3000" };
    const b = { subject: "CS", number: "3001" };
    const sections = [section(a, "01"), section(a, "04"), section(b, "02")];
    expect(professorSummaryText(sections)).toBe("Teaches 3 sections across 2 courses");
    expect(professorSummaryText([sections[2]!])).toBe("Teaches 1 section across 1 course");
    expect(professorSectionNote(a, sections)).toBe("Sections 01, 04");
    expect(professorSectionNote(b, sections)).toBe("Section 02");
    expect(rateMyProfessorsURL("Jane Doe")).toBe("https://www.ratemyprofessors.com/search/professors/696?q=Jane%20Doe");
    expect(rateMyProfessorsURL("José O'Neil-Smith").includes("q=Jos%C3%A9%20O%27Neil-Smith")).toBe(true);
  });

  it("degreePlanStandingTexts", () => {
    const plan = "plan";
    const completed = new CourseDegreePlanStanding(plan, { type: "completed", via: null });
    expect(completed.text).toBe("Completed");
    expect(completed.symbol).toBe("checkmark.circle.fill");
    expect(completed.spokenText).toBe("Completed, in your degree plan");
    const via = { subject: "CS", number: "2510" };
    const completedVia = new CourseDegreePlanStanding(plan, { type: "completed", via });
    expect(completedVia.text).toBe("Completed via CS 2510");
    const planned = new CourseDegreePlanStanding(plan, { type: "planned", semester: "Spring 2027", via: null });
    expect(planned.text).toBe("Planned \u00b7 Spring 2027");
    expect(planned.symbol).toBe("calendar");
    const plannedVia = new CourseDegreePlanStanding(plan, { type: "planned", semester: "Spring 2027", via });
    expect(plannedVia.text).toBe("Planned via CS 2510 \u00b7 Spring 2027");
    expect(plannedVia.spokenText).toBe("Planned via CS 2510 for Spring 2027 in your degree plan");
  });

  it("courseIsInScheduleCountsOnlyThePlansOfTheTerm", () => {
    const key = { subject: "CS", number: "3000" };
    let data: UserData = emptyUserData();
    expect(courseIsInSchedule(data, "202710", key)).toBe(false);
    const schedule: SchedulePlan = {
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
    data = { ...data, plans: [schedule] };
    expect(courseIsInSchedule(data, "202710", key)).toBe(true);
    expect(courseIsInSchedule(data, "202630", key)).toBe(false);
    expect(courseIsInSchedule(data, "202710", key, "12726")).toBe(false);
    data = { ...data, plans: [{ ...schedule, selectedCRNs: ["12726"] }] };
    expect(courseIsInSchedule(data, "202710", key, "12726")).toBe(true);
  });
});
