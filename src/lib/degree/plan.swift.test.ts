import { describe, expect, it } from "vitest";
import { CatalogIndex } from "@/lib/catalog-index";
import { loadBundledCatalog } from "@/lib/catalog-store";
import {
  DEGREE_SEPARATOR,
  DegreeImportError,
  courseLine,
  degreePlanText,
  parseDegreePlanText,
  termHeader,
} from "@/lib/degree-format";
import {
  coursesBefore,
  missingCount,
  newDegreePlanDraft,
  planTermMatches,
  scheduleSuggestions,
  statusOf,
  unmetSummary,
} from "@/lib/degree-logic";
import { renderDegreePlanPDF } from "@/lib/degree-pdf";
import { textFromPDF } from "@/lib/pdf-text";
import {
  keyId,
  reqAnd,
  reqCourse,
  reqOr,
  reqTest,
  type CourseKey,
  type Requisite,
  type Term,
} from "@/lib/models";
import { PLAN_SEASON_EXPORT, termCredits, type DegreePlan, type DegreePlanTerm } from "@/lib/requirements";
import { emptyPlanFilters, keepOnePrimaryDegree, newId, type SchedulePlan } from "@/lib/user";

const SEPARATOR = "-".repeat(115);

/** A synthetic degree audit "View Plan" export, as PDFKit extracts it. */
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
${SEPARATOR}
Spring 2027 (9.0 Hours)
-
CS 3650 (4.0 Hours) Computer Systems
-
CS 4530 (4.0 Hours) Fundamentals of Software Engin
-
CS 2963 (1.0 Hour) Topics
${SEPARATOR}
Summer Session A 2027 (4.0 Hours)
-
CS 4500 (4.0 Hours) Software Development
${SEPARATOR}
Summer Session B 2027 (0.0 Hours)
${SEPARATOR}
Fall 2027 (0.0 Hours)
`;

function termName(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`;
}

function taken(...keys: CourseKey[]): Set<string> {
  return new Set(keys.map((key) => keyId(key)));
}

function courseReq(code: string): Requisite {
  const parts = code.split(" ");
  return reqCourse({ subject: parts[0]!, number: parts[1]! });
}

function draftPlan(name: string): DegreePlan {
  const now = Date.now();
  return {
    id: newId(),
    name,
    completed: [],
    terms: [],
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
    substitutions: [],
    courseEquivalences: [],
  };
}

describe("DegreePlanTests", () => {
  it("parsesTheExport", () => {
    const result = parseDegreePlanText(sampleExport, "view-plan.pdf");
    const plan = result.plan;
    expect(plan.name).toBe("New Plan");
    expect(plan.program).toBe("CS-B-CSCI-BSCS");
    expect(plan.studentName).toBe("SAMPLE STUDENT");
    expect(plan.importedFrom).toBe("view-plan.pdf");
    expect(plan.printedAt != null).toBe(true);
    expect(plan.completed).toHaveLength(6);
    expect(plan.completed[1]!.credits).toBe(1);
    expect(plan.completed[2]!.key).toBeNull();
    expect(plan.completed[2]!.label).toBe("NO AP CREDIT");
    expect(plan.completed[0]!.key).toEqual({ subject: "CS", number: "1800" });
    expect(plan.terms.map(termName)).toEqual(["Spring 2027", "Summer Session A 2027", "Summer Session B 2027", "Fall 2027"]);
    expect(plan.terms[0]!.courses).toHaveLength(3);
    expect(termCredits(plan.terms[0]!)).toBe(9);
    expect(plan.terms[2]!.courses).toEqual([]);
    expect(result.skippedLines).toEqual([]);
  });

  it("parsesRawPaddedLines", () => {
    const raw =
      "Degree Audit Plan Name:\tMy Plan\nProgram:\t\tCS-B\nCompleted Courses:  \n" +
      "GAME1110 (4.0 Hours) Introduction to Video Game De\nCS  2500 (4.0 Hours) Fundamentals of Computer Sci \n" +
      "-".repeat(115) +
      "\nSpring  2027 (4.0 Hours) \nCS  3484 (4.0 Hours) GUI Programming\n";
    const plan = parseDegreePlanText(raw).plan;
    expect(plan.name).toBe("My Plan");
    expect(plan.completed.map((course) => course.label)).toEqual(["GAME 1110", "CS 2500"]);
    expect(plan.completed[1]!.title).toBe("Fundamentals of Computer Sci");
    expect(plan.terms[0]!.season).toBe("spring");
    expect(plan.terms[0]!.courses[0]!.key).toEqual({ subject: "CS", number: "3484" });
  });

  it("rejectsOtherDocuments", () => {
    let thrown: unknown;
    try {
      parseDegreePlanText("Hello world\nThis is a receipt\nTotal $4.00");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DegreeImportError);
    expect((thrown as DegreeImportError).code).toBe("notADegreePlan");
  });

  it("cleansUpExtractionArtifacts", () => {
    const text = [
      "Degree Audit Plan Name:\u0000New Plan",
      "Program:\u0000\u0000CS-B-CSCI-BSCS",
      "Student:\u0000\u0000SAMPLE STUDENT",
      "Completed Courses:",
      "-ENGW3302 (4.0 Hours) Advanced Writing in Tech Prof",
      "- CS 1800 (4.0 Hours) Discrete\u200B Structures",
      DEGREE_SEPARATOR,
      "-Spring 2027 (4.0 Hours)",
      "CS\u00A03484 (4.0 Hours) GUI Programming",
    ].join("\n");
    const plan = parseDegreePlanText(text).plan;
    expect(plan.name).toBe("New Plan");
    expect(plan.program).toBe("CS-B-CSCI-BSCS");
    expect(plan.studentName).toBe("SAMPLE STUDENT");
    expect(plan.completed.map((course) => course.label)).toEqual(["ENGW 3302", "CS 1800"]);
    expect(plan.completed[1]!.title).toBe("Discrete Structures");
    expect(plan.terms).toHaveLength(1);
    expect(plan.terms[0]!.courses.map((course) => course.label)).toEqual(["CS 3484"]);
  });

  it("formatsLikeTheAudit", () => {
    const plan = parseDegreePlanText(sampleExport).plan;
    expect(courseLine(plan.completed[0]!)).toBe("CS  1800 (4.0 Hours) Discrete Structures");
    expect(courseLine(plan.completed[1]!)).toBe("CS  1802 (1.0 Hour) Seminar for CS 1800");
    expect(courseLine(plan.completed[2]!)).toBe("NO AP CREDIT (0.0 Hours) No description");
    expect(termHeader(plan.terms[0]!)).toBe("Spring  2027 (9.0 Hours) ");
    expect(termHeader(plan.terms[1]!)).toBe("Summer Session A 2027 (4.0 Hours) ");
    expect(DEGREE_SEPARATOR).toHaveLength(115);
    const text = degreePlanText(plan, new Date(), false);
    expect(text.includes("StudentID")).toBe(false);
    expect(text).toContain("Degree Audit Plan Name:\tNew Plan");
    expect(text).toContain("Program:\t\tCS-B-CSCI-BSCS");
  });

  it("pdfRoundTrip", async () => {
    const original = parseDegreePlanText(sampleExport).plan;
    const pdf = await renderDegreePlanPDF(original, new Date(), true);
    const text = await textFromPDF(pdf);
    expect(text.length).toBeGreaterThan(0);
    const parsed = parseDegreePlanText(text).plan;
    expect(parsed.name).toBe(original.name);
    expect(parsed.program).toBe(original.program);
    expect(parsed.studentName).toBe(original.studentName);
    expect(parsed.completed.map((course) => course.label)).toEqual(original.completed.map((course) => course.label));
    expect(parsed.completed.map((course) => course.credits)).toEqual(original.completed.map((course) => course.credits));
    expect(parsed.terms.map(termName)).toEqual(original.terms.map(termName));
    expect(parsed.terms.map((term) => term.courses.map((course) => course.label))).toEqual(
      original.terms.map((term) => term.courses.map((course) => course.label)),
    );
  });

  it("longPlansSpanPages", async () => {
    const plan = parseDegreePlanText(sampleExport).plan;
    plan.completed = Array.from({ length: 60 }, (_, index) => ({
      id: newId(),
      key: { subject: "CS", number: String(1000 + index) },
      label: `CS ${1000 + index}`,
      title: `Course ${index}`,
      credits: 4,
    }));
    const pdf = await renderDegreePlanPDF(plan, new Date(), false);
    const text = await textFromPDF(pdf);
    expect(text.length).toBeGreaterThan(0);
    const parsed = parseDegreePlanText(text).plan;
    expect(parsed.completed).toHaveLength(60);
    expect(parsed.terms).toHaveLength(plan.terms.length);
  });

  it("prerequisiteChecks", () => {
    const cs2100 = { subject: "CS", number: "2100" };
    const cs2510 = { subject: "CS", number: "2510" };
    const cs1800 = { subject: "CS", number: "1800" };
    const requisite = reqAnd([reqOr([reqCourse(cs2100), reqCourse(cs2510)]), reqCourse(cs1800)]);
    expect(statusOf(requisite, taken(cs2510, cs1800))).toEqual({ kind: "met" });
    expect(statusOf(requisite, taken(cs2510))).toEqual({ kind: "missing", text: "CS 1800" });
    expect(statusOf(requisite, taken(cs1800))).toEqual({ kind: "missing", text: "CS 2100 or CS 2510" });
    expect(statusOf(requisite, taken())).toEqual({ kind: "missing", text: "(CS 2100 or CS 2510) and CS 1800" });
    expect(statusOf(null, taken())).toEqual({ kind: "met" });
    expect(statusOf(reqOr([reqTest("Placement", null), reqCourse(cs2100)]), taken())).toEqual({ kind: "met" });
  });

  it("unmetSummariesAreShort", () => {
    const programming = reqOr([courseReq("CS 2100"), courseReq("CS 201M"), courseReq("CS 2510"), courseReq("DS 2500")]);
    const discrete = reqOr([courseReq("CS 1800"), courseReq("MATH 209M"), courseReq("EECE 2160")]);
    const cs3000 = reqOr([reqAnd([programming, discrete]), courseReq("CS 2700")]);
    expect(unmetSummary(programming, taken())).toBe("CS 2100, CS 201M or 2 others");
    expect(unmetSummary(discrete, taken())).toBe("CS 1800 or MATH 209M or EECE 2160");
    expect(unmetSummary(cs3000, taken())).toBe("CS 2700 or another option");
    const cs1800 = taken({ subject: "CS", number: "1800" });
    expect(unmetSummary(cs3000, cs1800)).toBe("(CS 2100, CS 201M or 2 others) or another option");
    expect(missingCount(cs3000, taken())).toBe(1);
    expect(unmetSummary(cs3000, new Set([...cs1800, "CS 2510"]))).toBeNull();

    const nursing = reqAnd(
      ["NRSG 3344", "NRSG 3345", "NRSG 3400", "NRSG 3401", "NRSG 3420"].map((code) => reqOr([courseReq(code), courseReq(code), courseReq(code)])),
    );
    expect(unmetSummary(nursing, taken())).toBe("NRSG 3344, NRSG 3345 and 3 more");
    expect(unmetSummary(reqAnd([nursing, courseReq("CS 1800")]), taken())).toBe("(NRSG 3344, NRSG 3345 and 3 more) and CS 1800");
  });

  it("coursesBeforeATermIncludeEarlierTerms", () => {
    const plan = parseDegreePlanText(sampleExport).plan;
    const beforeSummer = coursesBefore(plan, 1);
    expect(beforeSummer.has("CS 3650")).toBe(true);
    expect(beforeSummer.has("CS 1800")).toBe(true);
    expect(beforeSummer.has("CS 4500")).toBe(false);
  });

  it("autofillPrefersTheExactTermThenTheClosest", () => {
    const plan = parseDegreePlanText(sampleExport).plan;
    plan.isPrimary = true;
    const spring: Term = { code: "202730", bannerDescription: "Spring 2027 Semester" };
    const exact = scheduleSuggestions({ term: spring, degreePlans: [plan], schedulePlans: [], index: null });
    expect(exact[0]?.isExactTerm).toBe(true);
    expect(exact[0]?.courses).toHaveLength(3);

    const fall: Term = { code: "202710", bannerDescription: "Fall 2026 Semester" };
    const closest = scheduleSuggestions({ term: fall, degreePlans: [plan], schedulePlans: [], index: null });
    expect(closest[0]?.isExactTerm).toBe(false);
    expect(closest[0]?.title.includes("Spring 2027")).toBe(true);

    const partial = scheduleSuggestions({
      term: spring,
      degreePlans: [plan],
      schedulePlans: [],
      alreadyInPlan: new Set(["CS 3650"]),
      index: null,
    });
    expect(partial[0]?.courses).toHaveLength(2);
  });

  it("autofillMarksCoursesNotOfferedThisTerm", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    const index = CatalogIndex.build(catalog!);
    const plan = draftPlan("Test");
    plan.terms = [
      {
        id: newId(),
        season: "fall",
        year: 2026,
        courses: [
          { id: newId(), key: { subject: "CS", number: "3000" }, label: "CS 3000", title: "Algorithms", credits: 4 },
          { id: newId(), key: { subject: "CS", number: "9999" }, label: "CS 9999", title: "Nope", credits: 4 },
        ],
      },
    ];
    const suggestions = scheduleSuggestions({ term: index.catalog.term, degreePlans: [plan], schedulePlans: [], index });
    expect(suggestions[0]?.courses).toEqual([{ subject: "CS", number: "3000" }]);
    expect(suggestions[0]?.unavailable).toEqual([{ subject: "CS", number: "9999" }]);
  });

  it("newPlanDraftCopiesTheLatestPlanAndAddsSchedules", () => {
    const source = parseDegreePlanText(sampleExport).plan;
    const schedule: SchedulePlan = {
      id: newId(),
      name: "Plan A",
      termCode: "202730",
      courses: [
        { key: { subject: "CS", number: "3650" }, isRequired: true, excludedCRNs: [], colorIndex: 0 },
        { key: { subject: "MATH", number: "2331" }, isRequired: true, excludedCRNs: [], colorIndex: 1 },
      ],
      selectedCRNs: [],
      filters: emptyPlanFilters(),
      favoriteCombinations: [],
      isPrimary: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const draft = newDegreePlanDraft("Draft", source, [schedule], () => null);
    expect(draft.completed).toHaveLength(source.completed.length);
    expect(draft.completed[0]?.id).not.toBe(source.completed[0]?.id);
    const spring = draft.terms.find((term) => term.season === "spring" && term.year === 2027);
    expect(spring).toBeTruthy();
    expect(spring!.courses.map((course) => course.label)).toEqual(["CS 3650", "CS 4530", "CS 2963", "MATH 2331"]);
  });

  it("termMatching", () => {
    const summerA: DegreePlanTerm = { id: "summer-a", season: "summerA", year: 2027, courses: [] };
    expect(planTermMatches(summerA, { code: "202740", bannerDescription: "" })).toBe(true);
    expect(planTermMatches(summerA, { code: "202750", bannerDescription: "" })).toBe(true);
    expect(planTermMatches(summerA, { code: "202760", bannerDescription: "" })).toBe(false);
    expect(planTermMatches({ id: "fall", season: "fall", year: 2026, courses: [] }, { code: "202710", bannerDescription: "" })).toBe(true);
  });

  it("storeKeepsOnePrimaryPlan", () => {
    let plans: DegreePlan[] = [];
    const add = (plan: DegreePlan): DegreePlan => {
      const stored = { ...plan, isPrimary: plans.length === 0 ? true : plan.isPrimary };
      if (stored.isPrimary) plans = keepOnePrimaryDegree(plans, stored.id);
      plans = [...plans, stored];
      return stored;
    };
    const primary = () => plans.find((plan) => plan.isPrimary) ?? [...plans].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const first = add(draftPlan("A"));
    const second = add(draftPlan("B"));
    expect(plans.find((plan) => plan.id === first.id)?.isPrimary).toBe(true);
    expect(plans.find((plan) => plan.id === second.id)?.isPrimary).toBe(false);
    plans = keepOnePrimaryDegree(plans, second.id);
    expect(primary()?.id).toBe(second.id);
    const wasPrimary = plans.find((plan) => plan.id === second.id)?.isPrimary ?? false;
    plans = plans.filter((plan) => plan.id !== second.id);
    if (wasPrimary && plans[0]) {
      const next = plans.reduce((best, plan) => (plan.updatedAt > best.updatedAt ? plan : best));
      plans = keepOnePrimaryDegree(plans, next.id);
    }
    expect(primary()?.id).toBe(first.id);
    expect(plans.find((plan) => plan.id === first.id)?.isPrimary).toBe(true);
  });
});
