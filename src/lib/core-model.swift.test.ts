import { describe, expect, it } from "vitest";
import { catalogTermCodeFromFileName, decodeCatalogArchive, encodeCatalogArchive } from "@/lib/catalog-store";
import {
  Day,
  compareCourseKeys,
  courseLevel,
  creditsLabel,
  dayCompactLabel,
  dayCount,
  dayHas,
  dayIsSubset,
  dayMask,
  instructorDisplayName,
  minutesFromHHMM,
  newYorkEpochMs,
  nupathsFromAttributes,
  parseCourseKey,
  rangeLabel,
  referencedCourses,
  reqAnd,
  reqCourse,
  reqOr,
  recomputePostreqs,
  requisiteSatisfied,
  requisiteSummary,
  simplifyRequisite,
  termCalendarYear,
  termCollege,
  termIsViewOnly,
  termName,
  termSeason,
  termShortName,
  timeLabel,
  type TermCatalog,
} from "@/lib/models";
import { widgetClassesOn, widgetOccurrences, type WidgetScheduleData } from "@/lib/widget-schedule";

describe("CoreModelTests", () => {
  it("termNames", () => {
    expect(termName({ code: "202710", bannerDescription: "Fall 2026 Semester" })).toBe("Fall 2026");
    expect(termName({ code: "202630", bannerDescription: "Spring 2026 Semester (View Only)" })).toBe("Spring 2026");
    const cps = { code: "202635", bannerDescription: "Spring 2026 CPS Quarter (View Only)" };
    expect(termName(cps)).toBe("Spring 2026 · CPS Quarter");
    expect(termShortName(cps)).toBe("Spring 2026");
    expect(termCollege(cps.code)).toBe("cps");
    expect(termIsViewOnly(cps)).toBe(true);
    expect(termSeason("202710")).toBe("fall");
    expect(termCalendarYear("202710")).toBe(2026);
    expect(termCalendarYear("202630")).toBe(2026);
  });

  it("courseKeyParsing", () => {
    expect(parseCourseKey("CS 3000")).toEqual({ subject: "CS", number: "3000" });
    expect(parseCourseKey("cs3000")).toEqual({ subject: "CS", number: "3000" });
    expect(parseCourseKey("math-209m")).toEqual({ subject: "MATH", number: "209M" });
    expect(parseCourseKey("3000")).toBeNull();
    expect(courseLevel({ subject: "CS", number: "3000" })).toBe(3);
    expect(compareCourseKeys({ subject: "CS", number: "2100" }, { subject: "CS", number: "3000" }) < 0).toBe(true);
    expect(compareCourseKeys({ subject: "CS", number: "900" }, { subject: "CS", number: "1800" }) < 0).toBe(true);
  });

  it("daySets", () => {
    const mwr = dayMask([1, 3, 4]);
    expect(dayCompactLabel(mwr)).toBe("MWR");
    expect(dayHas(mwr, 3)).toBe(true);
    expect(dayHas(mwr, 2)).toBe(false);
    expect(dayCount(mwr)).toBe(3);
    expect(dayIsSubset(mwr, Day.weekdays)).toBe(true);
    expect(dayIsSubset(dayMask([6]), Day.weekdays)).toBe(false);
  });

  it("timeFormatting", () => {
    expect(minutesFromHHMM(1435)).toBe(875);
    expect(timeLabel(875)).toBe("2:35 PM");
    expect(timeLabel(0)).toBe("12:00 AM");
    expect(rangeLabel(630, 695)).toBe("10:30 – 11:35 AM");
    expect(rangeLabel(705, 805)).toBe("11:45 AM – 1:25 PM");
    expect(creditsLabel(4, 4)).toBe("4 credits");
    expect(creditsLabel(1, 1)).toBe("1 credit");
    expect(creditsLabel(1, 4)).toBe("1–4 credits");
  });

  it("requisiteHelpers", () => {
    const a = { subject: "CS", number: "2100" };
    const b = { subject: "CS", number: "2510" };
    const c = { subject: "CS", number: "1800" };
    const nested = reqAnd([reqOr([reqCourse(a), reqOr([reqCourse(b)])]), reqAnd([reqCourse(c)])]);
    const simplified = simplifyRequisite(nested);
    expect(simplified).toEqual(reqAnd([reqOr([reqCourse(a), reqCourse(b)]), reqCourse(c)]));
    expect(referencedCourses(nested)).toEqual([a, b, c]);
    expect(simplified && requisiteSummary(simplified)).toBe("(CS 2100 or CS 2510) and CS 1800");
    expect(simplified != null && requisiteSatisfied(simplified, new Set(["CS 2100", "CS 1800"]))).toBe(true);
    expect(simplified != null && requisiteSatisfied(simplified, new Set(["CS 2100"]))).toBe(false);
  });

  it("instructorNames", () => {
    expect(instructorDisplayName("Ptitsyna, Natalia")).toBe("Natalia Ptitsyna");
    expect(instructorDisplayName("Staff")).toBe("Staff");
  });

  it("catalogArchiveRoundTrip", () => {
    const catalog: TermCatalog = {
      version: 1,
      term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
      generatedAt: 0,
      sectionsUpdatedAt: 0,
      courses: [
        {
          subject: "CS",
          number: "3000",
          title: "Algorithms and Data",
          description: "Introduces…",
          minCredits: 4,
          maxCredits: 4,
          attributes: ["NCFQ"],
          prereqs: reqCourse({ subject: "CS", number: "2100" }),
          coreqs: null,
          postreqs: [],
          specialTopics: false,
          college: null,
          department: null,
          detailsLoaded: true,
        },
      ],
      sections: [],
      subjects: [],
      attributes: [],
      campuses: [],
    };
    recomputePostreqs(catalog);
    const decoded = decodeCatalogArchive(encodeCatalogArchive(catalog));
    expect(decoded.courses[0]?.title).toBe("Algorithms and Data");
    expect(nupathsFromAttributes(decoded.courses[0]?.attributes ?? []).map((path) => path.short)).toEqual(["FQ"]);
    expect(decoded.courses[0]?.prereqs).toEqual(reqCourse({ subject: "CS", number: "2100" }));
    expect(catalogTermCodeFromFileName("term-202710.catalog")).toBe("202710");
  });

  it("widgetOccurrencesSkipFinishedClasses", () => {
    const now = new Date(newYorkEpochMs(2026, 9, 16, 10, 0));
    const data: WidgetScheduleData = {
      generatedAt: now,
      termCode: "202710",
      termName: "Fall 2026",
      planName: "Plan",
      meetings: [
        { id: "a", crn: "1", courseCode: "CS 3000", title: "Algo", location: "WVH 210", classType: "Lecture", weekday: 3, start: 9 * 60, end: 9 * 60 + 65, colorIndex: 0 },
        { id: "b", crn: "2", courseCode: "MATH 2331", title: "LinAlg", location: "RI 300", classType: "Lecture", weekday: 3, start: 13 * 60, end: 14 * 60 + 5, colorIndex: 1 },
      ],
    };
    const duringFirst = widgetOccurrences(data, now, 3);
    expect(duringFirst[0]?.meeting.courseCode).toBe("CS 3000");
    expect(duringFirst).toHaveLength(3);
    const afterFirst = widgetOccurrences(data, new Date(now.getTime() + 30 * 60 * 1000), 1);
    expect(afterFirst[0]?.meeting.courseCode).toBe("MATH 2331");
    expect(widgetClassesOn(data, now)).toHaveLength(2);
  });
});
