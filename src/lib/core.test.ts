import { describe, expect, it } from "vitest";
import { meetingFromBanner, parseCatalogDetails, parseCorequisites, parseDescription, parsePrerequisites, subjectLookup } from "./banner";
import { CatalogIndex } from "./catalog-index";
import { bodyLines, degreePlanText, parseDegreePlanText, DegreeImportError } from "./degree-format";
import { renderDegreePlanPDF } from "./degree-pdf";
import { duplicateKeys } from "./degree-logic";
import { CourseEquivalences } from "./equivalences";
import { decodeEntities } from "./html";
import {
  compareCourseKeys,
  courseLevel,
  creditsLabel,
  dayCompactLabel,
  dayCount,
  dayHas,
  dayIsSubset,
  dayMask,
  Day,
  instructorDisplayName,
  keyId,
  minutesFromHHMM,
  nupathsFromAttributes,
  parseCourseKey,
  rangeLabel,
  referencedCourses,
  reqAnd,
  reqCourse,
  reqOr,
  reqTest,
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
  type Course,
  type CourseSection,
  type TermCatalog,
} from "./models";
import { interpretPreferences } from "./nl";
import { emptyPreferences } from "./preferences";
import { availabilityOf, momentFromCampusClock, statusAt } from "./rooms";
import { expandAliases, normalizeSearch, searchCatalog } from "./search";
import { courseInput, generateSchedules } from "./schedule";
import { upcomingClasses } from "./upcoming";
import { compareWatchlist } from "./watchlist";
import { emptyUserData, type WatchItem } from "./user";

const subjects = subjectLookup([
  { code: "CS", name: "Computer Science" },
  { code: "DS", name: "Data Science" },
  { code: "MATH", name: "Mathematics" },
  { code: "EECE", name: "Electrical and Comp Engineerng" },
]);

function row(andOr = "", open = false, test = "", score = "", subject = "", number = "", close = false) {
  return `<tr><td>${andOr}</td><td>${open ? "(" : ""}</td><td>${test}</td><td>${score}</td><td>${subject}</td><td>${number}</td><td>Undergraduate</td><td>D-</td><td>${close ? ")" : ""}</td></tr>`;
}

function table(rows: string[]) {
  return `<section><table class="basePreqTable"><thead><tr><th>And/Or</th></tr></thead><tbody>${rows.join("")}</tbody></table></section>`;
}

function course(partial: Partial<Course> & Pick<Course, "subject" | "number" | "title">): Course {
  return {
    description: "",
    minCredits: 4,
    maxCredits: 4,
    attributes: [],
    postreqs: [],
    specialTopics: false,
    detailsLoaded: true,
    ...partial,
  };
}

function section(partial: Partial<CourseSection> & Pick<CourseSection, "crn" | "subject" | "number">): CourseSection {
  return {
    title: "Title",
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 20,
    seatsRemaining: 5,
    enrollment: 15,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    meetings: [],
    crossListCRNs: [],
    attributes: [],
    ...partial,
  };
}

function catalog(courses: Course[], sections: CourseSection[]): TermCatalog {
  return {
    version: 1,
    term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses,
    sections,
    subjects: [{ code: "CS", name: "Computer Science" }, { code: "MATH", name: "Mathematics" }],
    attributes: [],
    campuses: [],
  };
}

describe("core models", () => {
  it("names terms the way the app does", () => {
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

  it("parses course keys", () => {
    expect(parseCourseKey("CS 3000")).toEqual({ subject: "CS", number: "3000" });
    expect(parseCourseKey("cs3000")).toEqual({ subject: "CS", number: "3000" });
    expect(parseCourseKey("math-209m")).toEqual({ subject: "MATH", number: "209M" });
    expect(parseCourseKey("3000")).toBeNull();
    expect(courseLevel({ subject: "CS", number: "3000" })).toBe(3);
    expect(compareCourseKeys({ subject: "CS", number: "2100" }, { subject: "CS", number: "3000" })).toBeLessThan(0);
    expect(compareCourseKeys({ subject: "CS", number: "900" }, { subject: "CS", number: "1800" })).toBeLessThan(0);
  });

  it("formats days, times, and credits", () => {
    const mwr = dayMask([1, 3, 4]);
    expect(dayCompactLabel(mwr)).toBe("MWR");
    expect(dayHas(mwr, 3)).toBe(true);
    expect(dayHas(mwr, 2)).toBe(false);
    expect(dayCount(mwr)).toBe(3);
    expect(dayIsSubset(mwr, Day.weekdays)).toBe(true);
    expect(dayIsSubset(1 << 6, Day.weekdays)).toBe(false);
    expect(minutesFromHHMM(1435)).toBe(875);
    expect(timeLabel(875)).toBe("2:35 PM");
    expect(timeLabel(0)).toBe("12:00 AM");
    expect(rangeLabel(630, 695)).toBe("10:30 – 11:35 AM");
    expect(rangeLabel(705, 805)).toBe("11:45 AM – 1:25 PM");
    expect(creditsLabel(4, 4)).toBe("4 credits");
    expect(creditsLabel(1, 1)).toBe("1 credit");
    expect(creditsLabel(1, 4)).toBe("1–4 credits");
  });

  it("simplifies requisites", () => {
    const a = { subject: "CS", number: "2100" };
    const b = { subject: "CS", number: "2510" };
    const c = { subject: "CS", number: "1800" };
    const nested = reqAnd([reqOr([reqCourse(a), reqOr([reqCourse(b)])]), reqAnd([reqCourse(c)])]);
    const simplified = simplifyRequisite(nested);
    expect(simplified).toEqual(reqAnd([reqOr([reqCourse(a), reqCourse(b)]), reqCourse(c)]));
    expect(referencedCourses(nested).map(keyId)).toEqual(["CS 2100", "CS 2510", "CS 1800"]);
    expect(requisiteSummary(simplified!)).toBe("(CS 2100 or CS 2510) and CS 1800");
    const taken = new Set(["CS 2100", "CS 1800"]);
    expect(requisiteSatisfied(simplified!, taken)).toBe(true);
    expect(requisiteSatisfied(simplified!, new Set(["CS 2100"]))).toBe(false);
    expect(instructorDisplayName("Ptitsyna, Natalia")).toBe("Natalia Ptitsyna");
    expect(instructorDisplayName("Staff")).toBe("Staff");
    expect(nupathsFromAttributes(["NCFQ"]).map((path) => path.short)).toEqual(["FQ"]);
  });
});

describe("banner parsers", () => {
  it("parses nested prerequisites", () => {
    const html = table([
      row("", true),
      row("", true, "", "", "Computer Science", "2100"),
      row("Or", false, "", "", "Computer Science - MMC", "201M"),
      row("Or", false, "", "", "Computer Science", "2510"),
      row("Or", false, "", "", "Data Science", "2500", true),
      row("And", true, "", "", "Computer Science", "1800"),
      row("Or", false, "", "", "Mathematics", "209M"),
      row("Or", false, "", "", "Electrical and Comp Engineerng", "2160", true),
      row("", false, "", "", "", "", true),
      row("Or", false, "", "", "Computer Science", "2700"),
    ]);
    const requisite = parsePrerequisites(html, subjects);
    expect(requisite && "or" in requisite).toBe(true);
    const keys = referencedCourses(requisite!).map(keyId);
    expect(keys).toContain("EECE 2160");
    expect(keys).toContain("CS 201M");
  });

  it("parses a single course, a test, coreqs, and empty text", () => {
    expect(parsePrerequisites(table([row("", false, "", "", "Computer Science", "2100")]), subjects)).toEqual(reqCourse({ subject: "CS", number: "2100" }));
    expect(
      parsePrerequisites(table([row("", false, "", "", "Mathematics", "1341"), row("Or", false, "Graduate Admission")]), subjects),
    ).toEqual(reqOr([reqCourse({ subject: "MATH", number: "1341" }), reqTest("Graduate Admission")]));
    expect(parsePrerequisites("<section>No prerequisite information available.</section>", subjects)).toBeNull();
    const coreq = `<section><table class="basePreqTable"><tbody><tr><td>Computer Science</td><td>3001</td><td>Recitation for CS 3000</td></tr></tbody></table></section>`;
    expect(parseCorequisites(coreq, subjects)).toEqual(reqCourse({ subject: "CS", number: "3001" }));
  });

  it("parses descriptions, catalog details, entities, and meetings", () => {
    expect(parseDescription(`<section aria-labelledby="courseDescription">Covers the derivative &amp; integration.<br/></section>`)).toBe(
      "Covers the derivative & integration.",
    );
    const details = parseCatalogDetails(`<section aria-labelledby="catalog">
      <span class="status-bold">Title:</span>Algorithms and Data<br/>
      <span class="status-bold">College:</span>
      <span>Khoury Coll of Comp Sciences CS</span><br/>
      <span class="status-bold">Department:</span>
      <span>Computer Science CS</span><br/>
    </section>`);
    expect(details.title).toBe("Algorithms and Data");
    expect(details.college).toBe("Khoury College of Computer Sciences");
    expect(details.department).toBe("Computer Science");
    expect(decodeEntities("Fin Accounting &amp; Reporting")).toBe("Fin Accounting & Reporting");
    expect(decodeEntities("O&#39;Brien &#x2014; &quot;Hi&quot;")).toBe(`O'Brien — "Hi"`);
    expect(decodeEntities("AT&T")).toBe("AT&T");
    const meeting = meetingFromBanner({
      beginTime: "0800",
      endTime: "0905",
      building: "DG",
      buildingDescription: "Dodge Hall",
      room: "070",
      campus: "BOS",
      startDate: "09/09/2026",
      endDate: "12/13/2026",
      meetingType: "CLAS",
      meetingTypeDescription: "Class",
      monday: true,
      wednesday: true,
      thursday: true,
    });
    expect(meeting.start).toBe(480);
    expect(meeting.end).toBe(545);
    expect(dayCompactLabel(meeting.days)).toBe("MWR");
    expect(meeting.startDate).toBe("2026-09-09");
  });
});

describe("search and schedules", () => {
  it("expands shorthand", () => {
    expect(expandAliases(normalizeSearch("fundies"), new Set(["CS"]))).toBe("program design");
    expect(expandAliases(normalizeSearch("linalg"), new Set())).toBe("linear algebra");
  });

  it("finds a course with a typo and a CRN", () => {
    const index = CatalogIndex.build(
      catalog(
        [course({ subject: "CS", number: "3000", title: "Algorithms and Data", description: "Design of efficient algorithms" })],
        [section({ crn: "12345", subject: "CS", number: "3000", meetings: [{ days: dayMask([1, 3, 4]), start: 600, end: 665, kind: "Class" }] })],
      ),
    );
    const typo = searchCatalog(index, "algorthms", { subjects: [], nupaths: [], levels: [], campuses: [], classTypes: [], honorsOnly: false, openSeatsOnly: false, instruction: "any" }, "relevance");
    expect(typo.results.map((result) => result.course.number)).toContain("3000");
    const crn = searchCatalog(index, "12345", { subjects: [], nupaths: [], levels: [], campuses: [], classTypes: [], honorsOnly: false, openSeatsOnly: false, instruction: "any" }, "relevance");
    expect(crn.crnMatch?.crn).toBe("12345");
  });

  it("builds a conflict-free week and explains an empty one", () => {
    const monday = section({
      crn: "1",
      subject: "CS",
      number: "3000",
      meetings: [{ days: dayMask([1]), start: 600, end: 700, kind: "Class", buildingCode: "WVH" }],
    });
    const clash = section({
      crn: "2",
      subject: "CS",
      number: "3500",
      meetings: [{ days: dayMask([1]), start: 630, end: 720, kind: "Class", buildingCode: "WVH" }],
    });
    const wednesday = section({
      crn: "3",
      subject: "CS",
      number: "3500",
      meetings: [{ days: dayMask([3]), start: 600, end: 700, kind: "Class", buildingCode: "WVH" }],
    });
    const filters = { freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0 };
    const limits = { maxResults: 8, maxExhaustiveLeaves: 1000, maxNodes: 20_000, timeBudget: 1, sampleLeaves: 0, sampleTimeBudget: 0, allowSampling: false };
    const ok = generateSchedules(
      [courseInput({ subject: "CS", number: "3000" }, [monday]), courseInput({ subject: "CS", number: "3500" }, [clash, wednesday])],
      filters,
      undefined,
      "best",
      limits,
    );
    expect(ok.schedules).toHaveLength(1);
    expect(ok.schedules[0]!.crns.sort()).toEqual(["1", "3"]);
    const blocked = generateSchedules(
      [courseInput({ subject: "CS", number: "3000" }, [monday]), courseInput({ subject: "CS", number: "3500" }, [clash])],
      filters,
      undefined,
      "best",
      limits,
    );
    expect(blocked.schedules).toHaveLength(0);
    expect(blocked.diagnostics.conflictingPairs.length + blocked.diagnostics.blockedRequiredCourses.length).toBeGreaterThan(0);
  });

  it("reads a plain-language preference", () => {
    const read = interpretPreferences("no classes before 10am, Fridays off, prefer afternoons, lunch break", emptyPreferences());
    expect(read.preferences.earliestStart?.minutes).toBe(10 * 60);
    expect(read.preferences.daysOff & (1 << 5)).not.toBe(0);
    expect(read.preferences.lunch).toBeTruthy();
    expect(read.summary.length).toBeGreaterThan(0);
  });
});

const sampleExport = `Printed: 10/03/2026 12:42
Student: SAMPLE STUDENT
StudentID: 000000000
Degree Audit Plan Name: New Plan
Program: CS-B-CSCI-BSCS
-
Completed Courses:
-
CS 1800 (4.0 Hours) Discrete Structures
-
CS 1802 (1.0 Hour) Seminar for CS 1800
-
NO AP CREDIT (0.0 Hours) No description
-
CS 2510 (4.0 Hours) Fundamentals of Computer Sci
-
CS 3500 (4.0 Hours) Object-Oriented Design
-
CS 3000 (4.0 Hours) Algorithms & Data
-
-
-------------------------------------------------------------------------------------------------------------------
Spring 2027 (9.0 Hours)
-
CS 3650 (4.0 Hours) Computer Systems
-
CS 4530 (4.0 Hours) Fundamentals of Software Engin
-
CS 2963 (1.0 Hour) Topics
-------------------------------------------------------------------------------------------------------------------
Summer Session A 2027 (4.0 Hours)
-
CS 4500 (4.0 Hours) Software Development
-------------------------------------------------------------------------------------------------------------------
Summer Session B 2027 (0.0 Hours)
-------------------------------------------------------------------------------------------------------------------
Fall 2027 (0.0 Hours)
`;

describe("degree plans", () => {
  it("parses a view-plan export", () => {
    const result = parseDegreePlanText(sampleExport, "view-plan.pdf");
    const plan = result.plan;
    expect(plan.name).toBe("New Plan");
    expect(plan.program).toBe("CS-B-CSCI-BSCS");
    expect(plan.studentName).toBe("SAMPLE STUDENT");
    expect(plan.completed).toHaveLength(6);
    expect(plan.completed[1]!.credits).toBe(1);
    expect(plan.completed[2]!.key).toBeNull();
    expect(plan.completed[2]!.label).toBe("NO AP CREDIT");
    expect(plan.completed[0]!.key).toEqual({ subject: "CS", number: "1800" });
    expect(plan.terms.map((term) => `${term.season} ${term.year}`)).toEqual(["spring 2027", "summerA 2027", "summerB 2027", "fall 2027"]);
    expect(plan.terms[0]!.courses).toHaveLength(3);
    expect(result.skippedLines).toEqual([]);
    expect(duplicateKeys(plan).size).toBe(0);
  });

  it("rejects a receipt", () => {
    expect(() => parseDegreePlanText("Hello world\nThis is a receipt\nTotal $4.00")).toThrow(DegreeImportError);
  });

  it("round-trips text and writes a PDF", async () => {
    const plan = parseDegreePlanText(sampleExport).plan;
    const text = degreePlanText(plan, new Date("2026-10-03T16:42:00Z"), true);
    expect(text).toContain("Degree Audit Plan Name:");
    expect(bodyLines(plan).some((line) => line.text.includes("CS 1800"))).toBe(true);
    const pdf = await renderDegreePlanPDF(plan, new Date("2026-10-03T16:42:00Z"), false);
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
  });
});

describe("watchlist, rooms, equivalences, upcoming", () => {
  it("alerts when a seat opens", () => {
    const item: WatchItem = {
      termCode: "202710",
      crn: "9",
      courseKey: { subject: "CS", number: "3000" },
      courseTitle: "Algorithms and Data",
      sectionLabel: "Lecture 01",
      addedAt: 0,
      lastSeatsRemaining: 0,
      lastWaitlistRemaining: 0,
      seatCapacity: 20,
      notifyOnWaitlist: true,
    };
    const liveSection = section({ crn: "9", subject: "CS", number: "3000", seatsRemaining: 2, seatCapacity: 20 });
    const outcome = compareWatchlist([item], { "202710": { "CS 3000": [liveSection] } });
    expect(outcome.alerts).toHaveLength(1);
    expect(outcome.alerts[0]!.kind).toBe("seats");
    expect(outcome.items[0]!.lastSeatsRemaining).toBe(2);
  });

  it("treats equivalent courses as one", () => {
    const equiv = CourseEquivalences.fromPairs([[{ subject: "CS", number: "2500" }, { subject: "CS", number: "2510" }]]);
    expect(equiv.areEquivalent({ subject: "CS", number: "2500" }, { subject: "CS", number: "2510" })).toBe(true);
  });

  it("marks a room busy during its booking", () => {
    const booking = {
      crn: "1",
      course: { subject: "CS", number: "3000" },
      days: dayMask([1]),
      start: 600,
      end: 700,
    };
    expect(statusAt([booking], 630).kind).toBe("busy");
    expect(statusAt([booking], 800).kind).toBe("free");
    const moment = momentFromCampusClock("2026-10-13", "14:30");
    expect(moment.minutes).toBe(14 * 60 + 30);
    const building = availabilityOf(
      { code: "WVH", name: "West Village H", rooms: [{ id: "WVH|108", buildingCode: "WVH", buildingName: "West Village H", room: "108", label: "WVH 108", bookings: [] }] },
      moment,
    );
    expect(building.free).toHaveLength(1);
  });

  it("keeps an in-progress class first", () => {
    const now = new Date("2026-09-16T14:00:00Z");
    const sections = [
      section({
        crn: "1",
        subject: "CS",
        number: "3000",
        title: "Algo",
        meetings: [{ days: dayMask([3]), start: 9 * 60, end: 9 * 60 + 65, kind: "Class", buildingCode: "WVH", room: "210" }],
      }),
      section({
        crn: "2",
        subject: "MATH",
        number: "2331",
        title: "LinAlg",
        meetings: [{ days: dayMask([3]), start: 13 * 60, end: 14 * 60 + 5, kind: "Class", buildingCode: "RI", room: "300" }],
      }),
    ];
    const during = upcomingClasses(sections, now, 3);
    expect(during[0]?.code).toBe("CS 3000");
    expect(during[0]?.happening).toBe(true);
    const after = upcomingClasses(sections, new Date(now.getTime() + 30 * 60 * 1000), 1);
    expect(after[0]?.code).toBe("MATH 2331");
  });

  it("merges broken user data", () => {
    expect(emptyUserData().preferences.hasCompletedOnboarding).toBe(false);
  });
});
