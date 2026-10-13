/**
 * Port of NEUClassSearchTests/PrerequisiteDataTests.swift.
 * One `it` per Swift `@Test`, with the Swift expected values left intact.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  catalogCodesContain,
  creditRange,
  parseCatalogDetails,
  parseCrossListed,
  parseMutualExclusions,
  parsePrerequisites,
  subjectLookup,
} from "./banner";
import { CatalogIndex } from "./catalog-index";
import { loadBundledCatalog } from "./catalog-store";
import {
  countsAsLabel,
  courseUseFor,
  courseUseIsCompleted,
  resultFor,
  ruleResults,
  runDegreeAudit,
  type DegreeAudit,
  type RuleResult,
} from "./degree/audit";
import { parseProgramPage } from "./degree/catalog-parser";
import { OfferingHistory, applyReorderSuggestion, reorderSuggestions, type PrerequisiteLookup, type ReorderSuggestion } from "./degree/reordering";
import {
  declareEquivalence,
  equivalenceSuggestions,
  removeEquivalence,
  suggestionConfidence,
  suggestionEvidence,
  suggestionId,
  suggestionIsListedTogether,
  type EquivalenceSuggestion,
  type PrerequisiteListing,
} from "./degree/suggestions";
import { parseTitle, titleSimilarity } from "./degree/title-matcher";
import { newDegreePlanDraft, prerequisiteStatus, statusOf, unmetSummary, type PrerequisiteStatus } from "./degree-logic";
import * as degreeLogic from "./degree-logic";
import { CourseEquivalences, equivalencesFromDeclarations } from "./equivalences";
import {
  creditsLabel,
  keyId,
  parseCourseKey,
  referencedCourses,
  reqAnd,
  reqCourse,
  reqOr,
  requisiteSatisfied,
  sameKey,
  termCollege,
  type Course,
  type CourseKey,
  type CourseSection,
  type Requisite,
  type Term,
  type TermCatalog,
} from "./models";
import { OfferingHistoryRepository, offeringWindow, type OfferingFetcher, type OfferingIndex } from "./offering-history";
import {
  PLAN_SEASON_EXPORT,
  allRules,
  sortPlanTerms,
  type CourseEquivalenceDeclaration,
  type DegreePlan,
  type DegreePlanCourse,
  type DegreePlanTerm,
  type PlanSeason,
  type ProgramRequirements,
} from "./requirements";
import { mergeUserData } from "./user";

function key(code: string): CourseKey {
  const parsed = parseCourseKey(code);
  if (!parsed) throw new Error(`bad course code ${code}`);
  return parsed;
}

function requisite(code: string): Requisite {
  return reqCourse(key(code));
}

function ids(keys: Iterable<CourseKey>): Set<string> {
  return new Set([...keys].map(keyId));
}

function catalogCourse(code: string, title = "", prereqs: Requisite | null = null, detailed = true, topics = false): Course {
  const parsed = key(code);
  return {
    subject: parsed.subject,
    number: parsed.number,
    title: title || code,
    description: "",
    minCredits: 4,
    maxCredits: 4,
    attributes: [],
    prereqs,
    coreqs: null,
    postreqs: [],
    specialTopics: topics,
    detailsLoaded: detailed,
  };
}

function section(crn: string, code: string, title = "", crossList: string[] = []): CourseSection {
  const parsed = key(code);
  return {
    crn,
    subject: parsed.subject,
    number: parsed.number,
    title: title || code,
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 40,
    seatsRemaining: 10,
    enrollment: 30,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    instructionMethod: "Traditional",
    meetings: [],
    instructors: [],
    crossListCRNs: crossList,
    attributes: [],
    description: null,
    prereqs: null,
    coreqs: null,
  };
}

function index(courses: Course[], sections: CourseSection[] = [], term = "202710"): CatalogIndex {
  const catalog: TermCatalog = {
    version: 1,
    term: { code: term, bannerDescription: "Fall 2026 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses,
    sections,
    subjects: [],
    attributes: [],
    campuses: [],
  };
  return CatalogIndex.build(catalog);
}

let courseN = 0;
function plannedCourse(code: string, credits = 4, title = code): DegreePlanCourse {
  courseN += 1;
  return { id: `c${courseN}`, key: key(code), label: code, title, credits };
}

function emptyPlan(name = "Plan"): DegreePlan {
  return {
    id: "plan",
    name,
    completed: [],
    terms: [],
    isPrimary: false,
    createdAt: 0,
    updatedAt: 0,
    substitutions: [],
    courseEquivalences: [],
  };
}

function expectStatus(actual: PrerequisiteStatus, expected: "met" | "unknown" | string) {
  if (expected === "met") expect(actual).toEqual({ kind: "met" });
  else if (expected === "unknown") expect(actual).toEqual({ kind: "unknown" });
  else expect(actual).toEqual({ kind: "missing", text: expected });
}

/** Swift `DegreePlanAnalysis.missingCount`. Not exported; undefined when absent. */
function missingCount(requisite: Requisite, taken: CourseKey[], equivalences = CourseEquivalences.none()): number | undefined {
  const fn = (degreeLogic as { missingCount?: (requisite: Requisite, taken: Set<string>, equivalences: CourseEquivalences) => number }).missingCount;
  return fn?.(requisite, ids(taken), equivalences);
}

/** Swift `DegreePlanAnalysis.coveringEquivalents`. Not exported; undefined when absent. */
function coveringEquivalents(requisite: Requisite, taken: CourseKey[], equivalences: CourseEquivalences): Record<string, CourseKey> | undefined {
  const fn = (degreeLogic as {
    coveringEquivalents?: (requisite: Requisite, taken: Set<string>, equivalences: CourseEquivalences) => Record<string, CourseKey>;
  }).coveringEquivalents;
  return fn?.(requisite, ids(taken), equivalences);
}

const subjects = subjectLookup([
  { code: "CS", name: "Computer Science" },
  { code: "ENGL", name: "English" },
  { code: "MATH", name: "Mathematics" },
]);

describe("CourseCatalogParserTests", () => {
  it("typeaheadCodesMustMatchExactly", () => {
    const json = `[{"code":"CS3386","description":"CS3386 Computer Science"},{"code":"CS33860","description":"CS33860 Computer Science"}]`;
    const items = JSON.parse(json) as { code: string }[];
    expect(catalogCodesContain(items, key("CS 3386"))).toBe(true);
    expect(catalogCodesContain(items, key("CS 338"))).toBe(false);
    expect(catalogCodesContain([], key("CS 3386"))).toBe(false);
  });

  it("readsCatalogDetailsAndCredits", () => {
    const html = `<section aria-labelledby="catalog">
        <span class="status-bold">Title:</span><span>Directed Study</span><br/>
        <span class="status-bold">College:</span>
        <span>Coll of Soc Sci &amp; Humanities  SH</span>
        <br/>
        <span class="status-bold">Department:</span>
        <span>Sociology and Anthropology  SOCL</span><br/>
        <span class="status-bold">Hours:</span><br/>
        <span class="indent-left">Credit Hours:</span><span
        class="credit-hours-direction">1 TO 4</span><br/>
        <div class="indent-left"><span class="credit-hours-direction">Lecture: 1 TO 4</span><br/></div>
        <span class="status-bold">Levels:</span><br/>
        </section>`;
    const details = parseCatalogDetails(html);
    expect(details.title).toBe("Directed Study");
    expect(details.department).toBe("Sociology and Anthropology");
    expect(details.minCredits === 1 && details.maxCredits === 4).toBe(true);

    const fixed = parseCatalogDetails(`<span class="indent-left">Credit Hours:</span><span class="credit-hours-direction">4</span><br/>`);
    expect(fixed.minCredits === 4 && fixed.maxCredits === 4).toBe(true);
    expect(creditRange("1.000 TO 4.000")?.high).toBe(4);
    expect(creditRange("0.5")?.low).toBe(0.5);
    expect(creditRange("TBA")).toBeNull();
  });

  it("readsCoursePrerequisites", () => {
    function row(andOr = "", open = false, subject = "", number = "", close = false) {
      return `<tr><td>${andOr}</td><td>${open ? "(" : ""}</td><td></td><td></td><td>${subject}</td><td>${number}</td><td>Undergraduate</td><td>D-</td><td>${close ? ")" : ""}</td></tr>`;
    }
    const html = `<section><table class="basePreqTable"><thead><tr><th>And/Or</th></tr></thead><tbody>${[
      row("", true),
      row("", true, "Computer Science", "2100"),
      row("Or", false, "Computer Science - MMC", "201M", true),
      row("Or", false, "Computer Science", "2510", true),
      row("And", true, "Computer Science", "2386"),
      row("Or", false, "Computer Science", "3540", true),
    ].join("")}</tbody></table></section>`;
    const parsed = parsePrerequisites(html, subjects);
    expect(parsed).toBeTruthy();
    if (!parsed) return;
    expect(referencedCourses(parsed).map(keyId)).toEqual(["CS 2100", "CS 201M", "CS 2510", "CS 2386", "CS 3540"]);
    expect(requisiteSatisfied(parsed, ids([key("CS 2510"), key("CS 3540")]))).toBe(true);
    expect(requisiteSatisfied(parsed, ids([key("CS 2510")]))).toBe(false);

    const empty = `<section aria-labelledby="preReqs"><h3>Catalog Prerequisites</h3> No prerequisite information available.</section>`;
    expect(parsePrerequisites(empty, subjects)).toBeNull();
  });

  it("readsMutualExclusions", () => {
    const none = `<section aria-labelledby="mexc">
            No Mutual Exclusion information available.
        </section>`;
    expect(parseMutualExclusions(none, subjects)).toEqual([]);

    const table = `<section aria-labelledby="mexc"><table><thead><tr><th>Subject</th><th>Course Number</th><th>Title</th></tr></thead><tbody>
        <tr><td>Computer Science</td><td>2510</td><td>Fundamentals of Computer Science 2</td></tr>
        <tr><td>Mathematics</td><td>1341</td><td>Calculus 1</td></tr>
        </tbody></table></section>`;
    expect(parseMutualExclusions(table, subjects)).toEqual([key("CS 2510"), key("MATH 1341")]);
    const withLeadingColumn = `<section><table><tbody><tr><td>Or</td><td>Computer Science</td><td>2500</td></tr></tbody></table></section>`;
    expect(parseMutualExclusions(withLeadingColumn, subjects)).toEqual([key("CS 2500")]);
    const text = `<section>Credit cannot be earned for both CS 2510 and CS 2100.</section>`;
    expect(parseMutualExclusions(text, subjects)).toEqual([key("CS 2510"), key("CS 2100")]);
  });

  it("readsCrossListedSections", () => {
    const html = `<section aria-labelledby="xlstSections">
            <span class="status-bold">Section Enrollment:</span> 4<br/>
            Sections:<br/>
        <table>
            <thead><tr><th>CRN</th><th>Subject</th><th>Course Number</th><th>Title</th><th>Section</th></tr></thead>
            <tbody>
                <tr><td>22773</td><td>English</td><td>2690</td><td>Boston in Literature</td><td>01</td></tr>
            </tbody>
        </table>
        </section>`;
    const sections = parseCrossListed(html, subjects);
    expect(sections).toEqual([{ crn: "22773", course: key("ENGL 2690"), title: "Boston in Literature", section: "01" }]);
    expect(parseCrossListed(`<section>No cross list sections</section>`, subjects)).toEqual([]);
  });

  it("courseInfoNormalizesEquivalents", () => {
    const normalize = (degreeLogic as { normalizeEquivalents?: (course: CourseKey, equivalents: CourseKey[]) => CourseKey[] }).normalizeEquivalents;
    const equivalents = normalize?.(key("CS 2100"), [key("CS 2510"), key("CS 2100"), key("CS 2510"), key("CS 2000")]);
    expect(equivalents).toEqual([key("CS 2000"), key("CS 2510")]);
    expect(creditsLabel(4, 4)).toBe("4 credits");
    expect(creditsLabel(1, 4)).toBe("1–4 credits");
    const creditsWhenUnknown = (degreeLogic as { courseInfoCreditsLabel?: (min?: number | null, max?: number | null) => string | null }).courseInfoCreditsLabel;
    expect(creditsWhenUnknown?.(null, null)).toBeNull();
  });
});

describe("CourseEquivalencesTests", () => {
  const cs2000 = key("CS 2000");
  const cs2100 = key("CS 2100");
  const cs2500 = key("CS 2500");
  const cs2510 = key("CS 2510");
  const cs3100 = key("CS 3100");
  const cs3500 = key("CS 3500");
  const engl1102 = key("ENGL 1102");
  const engw1102 = key("ENGW 1102");

  it("groupsAreSymmetric", () => {
    const equivalences = CourseEquivalences.fromPairs([[cs2100, cs2510], [engw1102, engl1102]]);
    expect(equivalences.equivalentsOf(cs2100)).toEqual([cs2510]);
    expect(equivalences.equivalentsOf(cs2510)).toEqual([cs2100]);
    expect(equivalences.areEquivalent(engl1102, engw1102)).toBe(true);
    expect(equivalences.areEquivalent(cs2100, cs2100)).toBe(true);
    expect(equivalences.areEquivalent(cs2100, engl1102)).toBe(false);
    expect(equivalences.equivalentsOf(cs2100).some((item) => sameKey(item, cs2100))).toBe(false);
    expect(equivalences.equivalentsOf(cs3100)).toEqual([]);
    expect(equivalences.groupOf(cs3100)).toEqual([cs3100]);
    expect(CourseEquivalences.none().isEmpty).toBe(true);
  });

  it("chainsAreOneGroup", () => {
    const forward = CourseEquivalences.fromPairs([[cs2500, cs2000], [cs2000, cs2100]]);
    const backward = CourseEquivalences.fromPairs([[cs2100, cs2000], [cs2000, cs2500]]);
    expect(forward.toJSON()).toEqual(backward.toJSON());
    expect(forward.groups).toHaveLength(1);
    expect(forward.equivalentsOf(cs2500)).toEqual([cs2000, cs2100]);
    expect(forward.areEquivalent(cs2500, cs2100)).toBe(true);
    expect(forward.groupOf(cs2100)).toEqual([cs2000, cs2100, cs2500]);
  });

  it("overlappingGroupsMergeAndSingletonsAreDropped", () => {
    const equivalences = new CourseEquivalences([[cs2500, cs2000], [cs3100, cs3500], [cs2000, cs2100], [cs2510], [], [cs2510, cs2510]]);
    expect(equivalences.groups).toEqual([[cs2000, cs2100, cs2500], [cs3100, cs3500]]);
    expect(equivalences.groups.flat()).toEqual([cs2000, cs2100, cs2500, cs3100, cs3500]);
    expect(equivalences.groups.flat().some((item) => sameKey(item, cs2510))).toBe(false);
  });

  it("expandingWhatWasTaken", () => {
    const equivalences = CourseEquivalences.fromPairs([[cs2100, cs2510], [cs3100, cs3500]]);
    const taken = ids([cs2510, engl1102]);
    expect(equivalences.expanding(taken)).toEqual(ids([cs2510, cs2100, engl1102]));
    expect(equivalences.expanding(new Set())).toEqual(new Set());
    expect(CourseEquivalences.none().expanding(taken)).toEqual(taken);
  });

  it("satisfierIsTheTakenCourse", () => {
    const equivalences = CourseEquivalences.fromPairs([[cs2500, cs2000], [cs2000, cs2100]]);
    expect(equivalences.satisfier(cs2100, ids([cs2100, cs2500]))).toEqual(cs2100);
    expect(equivalences.satisfier(cs2100, ids([cs2500]))).toEqual(cs2500);
    expect(equivalences.satisfier(cs2100, ids([cs2500, cs2000]))).toEqual(cs2000);
    expect(equivalences.satisfiers(cs2100, ids([cs2500, cs2000]))).toEqual([cs2000, cs2500]);
    expect(equivalences.satisfier(cs2100, ids([cs3100]))).toBeNull();
    expect(equivalences.satisfier(cs3100, ids([cs3100]))).toEqual(cs3100);
    expect(CourseEquivalences.none().satisfier(cs2100, ids([cs2510]))).toBeNull();
  });

  it("mergingTwoSources", () => {
    const banner = CourseEquivalences.fromPairs([[cs2100, cs2510]]);
    const student = CourseEquivalences.fromPairs([[cs2510, cs2500], [cs3100, cs3500]]);
    const merged = banner.merging(student);
    expect(merged.areEquivalent(cs2100, cs2500)).toBe(true);
    expect(merged.areEquivalent(cs3100, cs3500)).toBe(true);
    expect(banner.merging(CourseEquivalences.none()).toJSON()).toEqual(banner.toJSON());
    expect(CourseEquivalences.none().merging(student).toJSON()).toEqual(student.toJSON());
    expect(banner.adding(cs2000, cs2100).areEquivalent(cs2000, cs2510)).toBe(true);
  });

  it("roundTripsThroughJSON", () => {
    const equivalences = CourseEquivalences.fromPairs([[cs2100, cs2510], [cs3100, cs3500]]);
    const decoded = new CourseEquivalences(JSON.parse(JSON.stringify(equivalences.toJSON())) as CourseKey[][]);
    expect(decoded.toJSON()).toEqual(equivalences.toJSON());
  });

  it("studentDeclarationsBecomeGroups", () => {
    const declared = [
      { course: cs2510, countsAs: cs2100, note: "Renumbered" },
      { course: cs2500, countsAs: cs2000 },
      { course: cs2000, countsAs: cs2100 },
    ];
    const equivalences = equivalencesFromDeclarations(declared.map((item) => ({ ...item, note: item.note ?? "" })));
    expect(equivalences.groups).toEqual([[cs2000, cs2100, cs2500, cs2510]]);

    const plan = emptyPlan();
    const added = declareEquivalence(plan, cs2510, cs2100, "Renumbered");
    const reversed = declareEquivalence(plan, cs2100, cs2510);
    const same = declareEquivalence(plan, cs2100, cs2100);
    expect(added && !reversed && !same).toBe(true);
    expect(plan.courseEquivalences).toHaveLength(1);
    expect(equivalencesFromDeclarations(plan.courseEquivalences).areEquivalent(cs2100, cs2510)).toBe(true);
    removeEquivalence(plan, plan.courseEquivalences[0]!.id);
    expect(equivalencesFromDeclarations(plan.courseEquivalences).isEmpty).toBe(true);
  });

  it("plansKeepTheirEquivalences", () => {
    const plan = emptyPlan();
    declareEquivalence(plan, cs2510, cs2100, "Renumbered");
    const roundTrip = mergeUserData({ degreePlans: [JSON.parse(JSON.stringify(plan))] }).degreePlans[0]!;
    expect(roundTrip).toEqual(plan);
    expect(roundTrip.courseEquivalences[0]?.note).toBe("Renumbered");

    const json = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    delete json.courseEquivalences;
    const older = mergeUserData({ degreePlans: [json] }).degreePlans[0]!;
    expect(older.courseEquivalences).toEqual([]);
    expect(older.name).toBe("Plan");
    json.courseEquivalences = "not a list";
    const broken = mergeUserData({ degreePlans: [json] }).degreePlans[0]!;
    expect(broken.courseEquivalences).toEqual([]);
    expect(broken.name).toBe("Plan");

    const draft = newDegreePlanDraft("Draft", plan, [], () => null);
    expect(draft.courseEquivalences.map((item) => item.course)).toEqual([cs2510]);
    expect(draft.courseEquivalences[0]?.id).not.toBe(plan.courseEquivalences[0]?.id);
  });

  it("crossListedCoursesAreEquivalentOnlyWhenTheyAreTheSameCourse", () => {
    const courses = [
      catalogCourse("AFCS 1225", "Gender, Race, and Medicine"),
      catalogCourse("HIST 1225", "Gender, Race, and Medicine "),
      catalogCourse("WMNS 1225", "Gender, Race, and Medicine"),
      catalogCourse("ALY 6983", "Special Topics", null, true, true),
      catalogCourse("CS 6983", "Special Topics", null, true, true),
      catalogCourse("CS 3000", "Algorithms and Data"),
      catalogCourse("CS 5800", "Algorithms"),
      catalogCourse("ARCH 5310", "Design Tactics"),
      catalogCourse("LARC 5310", "Urban Landscape Seminar"),
    ];
    const sections = [
      section("1", "AFCS 1225", "", ["2", "3"]),
      section("2", "HIST 1225", "", ["1", "3"]),
      section("3", "WMNS 1225", "", ["1", "2"]),
      section("4", "ALY 6983", "", ["5"]),
      section("5", "CS 6983", "", ["4"]),
      section("6", "CS 3000", "", ["7"]),
      section("7", "CS 5800", "", ["6"]),
      section("8", "ARCH 5310", "", ["9"]),
      section("9", "LARC 5310", "", ["8"]),
    ];
    const built = index(courses, sections);
    const fromCrossList = (CourseEquivalences as unknown as { crossListedIn?: (catalog: CatalogIndex) => CourseEquivalences }).crossListedIn?.(built);
    expect(fromCrossList?.groups).toEqual([[key("AFCS 1225"), key("HIST 1225"), key("WMNS 1225")]]);
  });
});

describe("PrerequisiteCheckTests", () => {
  const cs1800 = key("CS 1800");
  const cs2100 = key("CS 2100");
  const cs2510 = key("CS 2510");
  const cs3386 = key("CS 3386");
  const cs4050 = key("CS 4050");
  const renumbered = CourseEquivalences.fromPairs([[cs2100, cs2510]]);

  function plan(completed: string[], planned: string[], declared: CourseEquivalenceDeclaration[] = []): DegreePlan {
    const next = emptyPlan();
    next.completed = completed.map((code) => plannedCourse(code));
    next.terms = [{ id: "spring-2027", season: "spring", year: 2027, courses: planned.map((code) => plannedCourse(code)) }];
    next.courseEquivalences = declared;
    return next;
  }

  it("equivalentCoursesSatisfyARequisite", () => {
    const needed = reqAnd([reqCourse(cs2100), reqCourse(cs1800)]);
    expectStatus(statusOf(needed, ids([cs2510, cs1800])), "CS 2100");
    expectStatus(statusOf(needed, ids([cs2510, cs1800]), renumbered), "met");
    expectStatus(statusOf(needed, ids([cs2510]), renumbered), "CS 1800");
    const chain = CourseEquivalences.fromPairs([
      [{ subject: "CS", number: "2500" }, { subject: "CS", number: "2000" }],
      [{ subject: "CS", number: "2000" }, cs2100],
    ]);
    expectStatus(statusOf(reqCourse(cs2100), ids([{ subject: "CS", number: "2500" }]), chain), "met");
  });

  it("summariesAndCountsKnowEquivalents", () => {
    const needed = reqAnd([reqOr([reqCourse(cs2100), requisite("CS 201M")]), reqCourse(cs1800)]);
    expect(unmetSummary(needed, ids([cs2510]))).toBe("(CS 2100 or CS 201M) and CS 1800");
    expect(unmetSummary(needed, ids([cs2510]), renumbered)).toBe("CS 1800");
    expect(unmetSummary(needed, ids([cs2510, cs1800]), renumbered)).toBeNull();
    expect(missingCount(needed, [cs2510])).toBe(2);
    expect(missingCount(needed, [cs2510], renumbered)).toBe(1);
  });

  it("saysWhichEquivalentCoveredACourse", () => {
    const needed = reqOr([reqCourse(cs2100), reqCourse(cs1800)]);
    const covering = coveringEquivalents(needed, [cs2510], renumbered);
    expect(covering).toEqual({ "CS 2100": cs2510 });
    expect(coveringEquivalents(needed, [cs2510, cs2100], renumbered)).toEqual({});
  });

  it("coursesTheTermDoesNotListAreCheckedThroughTheLookup", () => {
    const student = plan(["CS 1800", "CS 2510"], ["CS 3386", "CS 4050", "CS 2963"]);
    const needs3386 = reqAnd([reqOr([reqCourse(cs2100), reqCourse(cs2510)]), requisite("CS 2386")]);
    const table: Record<string, Requisite | null> = { "CS 3386": needs3386, "CS 4050": null };
    const lookup = (course: CourseKey) => (Object.prototype.hasOwnProperty.call(table, keyId(course)) ? table[keyId(course)] : undefined);
    const termIndex = index([catalogCourse("CS 1800")]);

    expectStatus(prerequisiteStatus(cs3386, 0, student, termIndex), "unknown");
    expectStatus(prerequisiteStatus(cs3386, 0, student, termIndex, lookup), "CS 2386");
    expectStatus(prerequisiteStatus(cs4050, 0, student, termIndex, lookup), "met");
    expectStatus(prerequisiteStatus(key("CS 2963"), 0, student, termIndex, lookup), "unknown");
    expectStatus(prerequisiteStatus(cs3386, 0, student, null, lookup), "CS 2386");
  });

  it("theTermsOwnRequisitesWinWhenItHasDetails", () => {
    const student = plan(["CS 1800"], ["CS 3000"]);
    const listed = index([catalogCourse("CS 3000", "", reqCourse(cs1800))]);
    const wrong = () => requisite("CS 9999");
    expectStatus(prerequisiteStatus(key("CS 3000"), 0, student, listed, wrong), "met");

    const stub = index([catalogCourse("CS 3000", "", null, false)]);
    expectStatus(prerequisiteStatus(key("CS 3000"), 0, student, stub), "unknown");
    expectStatus(prerequisiteStatus(key("CS 3000"), 0, student, stub, wrong), "CS 9999");
  });

  it("equivalencesApplyToPlannedCourses", () => {
    const needsRenumbered = reqCourse(cs2100);
    const student = plan(["CS 2510"], ["CS 3386"]);
    const lookup = (course: CourseKey) => (sameKey(course, cs3386) ? needsRenumbered : undefined);
    expectStatus(prerequisiteStatus(cs3386, 0, student, null, lookup), "CS 2100");
    expectStatus(prerequisiteStatus(cs3386, 0, student, null, lookup, renumbered), "met");

    const declaring = plan(["CS 2510"], ["CS 3386"]);
    declareEquivalence(declaring, cs2510, cs2100);
    expectStatus(prerequisiteStatus(cs3386, 0, declaring, null, lookup), "met");
  });

  it("theLoadedCatalogsPrerequisitesStillWorkWithoutNewArguments", () => {
    const student = plan(["CS 2510"], ["CS 3000"]);
    const listed = index([catalogCourse("CS 3000", "", reqOr([reqCourse(cs2100), reqCourse(cs2510)]))]);
    expectStatus(prerequisiteStatus(key("CS 3000"), 0, student, listed), "met");
  });
});

const program = { title: "Computer Science, BSCS (Boston)", path: "undergraduate/computer-information-science/computer-science/bscs/" };
const programPage = `
<html><body>
<div id="textcontainer" class="page_content"><p>About the program.</p></div>
<div id="programrequirementstextcontainer" class="tab_content">
<p>Complete all courses listed below unless otherwise indicated.</p>
<h2>Major Requirements</h2>
<table class="sc_courselist"><tbody>
<tr class="hidden noscript"><th scope="col">Code</th><th scope="col">Title</th><th scope="col" class="hourscol">Hours</th></tr>
<tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Required Courses</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a href="/search/?P=CS%201800" title="CS 1800" class="bubblelink code">CS&#160;1800</a><span style="margin-left:20px;" class="blockindent">and <a href="/search/?P=CS%201802" class="bubblelink code">CS&#160;1802</a></span></td><td>Discrete Structures</td><td class="hourscol">5</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4500</a></td><td>Software Development</td><td class="hourscol">4</td></tr>
<tr class="orclass odd"><td class="codecol orclass">or <a class="bubblelink code">CS&#160;4530</a></td><td colspan="2"> Fundamentals of Software Engineering</td></tr>
<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Security Course</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete one of the following:</span></td><td class="hourscol">4</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CY&#160;2550</a></td><td>Foundations of Cybersecurity</td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CY&#160;3740</a></td><td>Systems Security</td><td class="hourscol"></td></tr>
<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Khoury Elective Courses</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">With adviser approval, directed study may also be taken as an elective.</span></td><td class="hourscol"></td></tr>
<tr class="even"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS, CY, DS, or IS classes that are not already required. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
<tr class="odd"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher, except <a class="bubblelink code">CS&#160;5010</a></span></div></td><td class="hourscol"></td></tr>
<tr class="even lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">DS&#160;2500</a> to DS 4999 but not <a class="bubblelink code">DS&#160;4900</a></span></div></td><td class="hourscol"></td></tr>
</tbody></table>
<h2>Supporting Courses</h2>
<table class="sc_courselist"><tbody>
<tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Science Requirement</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete two courses (and any required labs) from the following science categories:</span></td><td class="hourscol">8</td></tr>
<tr class="even areasubheader undefined subheader "><td colspan="2"><span class="courselistcomment areasubheader undefined"><i>Biology</i></span></td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">BIOL&#160;1111</a><br/><span class="blockindent">and <a class="bubblelink code">BIOL&#160;1112</a></span></td><td>General Biology 1<br/><span class="blockindent">and Lab for BIOL 1111</span></td><td class="hourscol"></td></tr>
<tr class="even areasubheader undefined subheader "><td colspan="2"><span class="courselistcomment areasubheader undefined"><i>Mathematics</i></span></td><td class="hourscol"></td></tr>
<tr class="odd lastrow"><td class="codecol"><a class="bubblelink code">MATH&#160;2331</a></td><td>Linear Algebra</td><td class="hourscol"></td></tr>
</tbody></table>
<h2>Required General Electives</h2>
<table class="sc_courselist"><tbody>
<tr class="even lastrow firstrow"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of general electives.</span></td><td class="hourscol">8</td></tr>
</tbody></table>
<h2>Major GPA Requirement</h2>
<p>Minimum 2.000 GPA required in the major.</p>
<h2>Program Requirement</h2>
<p>52 total semester hours required</p>
<h2>Concentration in Human-Centered Computing*</h2>
<table class="sc_courselist"><tbody>
<tr class="even firstrow"><td class="codecol"><a class="bubblelink code">CS&#160;2484</a></td><td>Principles of Human-Computer Interaction</td><td class="hourscol">4</td></tr>
<tr class="odd"><td colspan="2"><span class="courselistcomment">Complete two of the following not already taken:</span></td><td class="hourscol">8</td></tr>
<tr class="even"><td class="codecol"><a class="bubblelink code">CS&#160;4520</a></td><td>Mobile Application Development</td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4550</a></td><td>Web Development</td><td class="hourscol"></td></tr>
<tr class="even lastrow"><td class="codecol"><a class="bubblelink code">DS&#160;4200</a></td><td>Information Presentation and Visualization</td><td class="hourscol"></td></tr>
</tbody></table>
<p>*This concentration requires a fall co-op pattern.</p>
<h2>Software Concentration</h2>
<table class="sc_courselist"><tbody>
<tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;4400</a></td><td>Programming Languages</td><td class="hourscol">4</td></tr>
</tbody></table>
</div>
<div id="planofstudytextcontainer" class="tab_content">
<table class="sc_courselist"><tbody><tr><td class="codecol"><a>CS&#160;9999</a></td><td>Not a requirement</td><td class="hourscol">4</td></tr></tbody></table>
</div>
</body></html>
`;

function requirements(): ProgramRequirements {
  const parsed = parseProgramPage(programPage, { startYear: 2023 }, program);
  if (!parsed) throw new Error("program page did not parse");
  return parsed;
}

function auditPlan(completed: string[], planned: string[] = []): DegreePlan {
  const next = emptyPlan();
  next.completed = completed.map((code) => plannedCourse(code, code === "CS 1802" ? 1 : 4, ""));
  if (planned.length) {
    next.terms = [{ id: "spring-2027", season: "spring", year: 2027, courses: planned.map((code) => plannedCourse(code, 4, "")) }];
  }
  next.catalogYear = 2023;
  next.catalogProgramPath = program.path;
  next.concentrationID = "concentration-in-human-centered-computing";
  return next;
}

function auditResult(audit: DegreeAudit, label: string): RuleResult | undefined {
  return ruleResults(audit).find((item) => item.rule.label === label);
}

describe("EquivalentCourseAuditTests", () => {
  const cs3000 = key("CS 3000");
  const cs3990 = key("CS 3990");
  const cs3991 = key("CS 3991");
  const cs4530 = key("CS 4530");
  const cs4999 = key("CS 4999");

  it("aRequirementIsMetByAnEquivalentCourse", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 3990"]);
    const without = runDegreeAudit(student, reqs);
    expect(auditResult(without, "CS 3000")?.status).toBe("missing");

    const renumbered = CourseEquivalences.fromPairs([[cs3000, cs3990]]);
    const audit = runDegreeAudit(student, reqs, renumbered);
    const rule = auditResult(audit, "CS 3000");
    expect(rule).toBeTruthy();
    if (!rule) return;
    expect(rule.status).toBe("complete");
    const use = rule.used[0];
    expect(use).toBeTruthy();
    if (!use) return;
    expect(use.key).toEqual(cs3990);
    expect(use.satisfies).toEqual(cs3000);
    expect(use.satisfies != null).toBe(true);
    expect(countsAsLabel(use)).toBe("counts as CS 3000");
    expect(courseUseIsCompleted(use)).toBe(true);
    expect(courseUseFor(rule, cs3000)?.key).toEqual(cs3990);
    expect(courseUseFor(rule, cs3990)?.key).toBeUndefined();
    const plainRule = auditResult(audit, "CS 1800 and CS 1802");
    expect(plainRule).toBeTruthy();
    if (!plainRule) return;
    expect(plainRule.used.every((item) => item.satisfies == null && countsAsLabel(item) == null)).toBe(true);
    expect(courseUseFor(plainRule, key("CS 1800"))?.key).toEqual(key("CS 1800"));
  });

  it("theStudentsDeclaredEquivalencesApplyOnTheirOwn", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 3990"]);
    declareEquivalence(student, cs3990, cs3000);
    const audit = runDegreeAudit(student, reqs);
    expect(auditResult(audit, "CS 3000")?.status).toBe("complete");
    expect(auditResult(audit, "CS 3000")?.used[0]?.satisfies).toEqual(cs3000);
  });

  it("plannedEquivalentsCountAsPlanned", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802"], ["CS 3990"]);
    const audit = runDegreeAudit(student, reqs, CourseEquivalences.fromPairs([[cs3000, cs3990]]));
    const rule = auditResult(audit, "CS 3000");
    expect(rule).toBeTruthy();
    if (!rule) return;
    expect(rule.status).toBe("planned");
    expect(courseUseIsCompleted(rule.used[0]!)).toBe(false);
    expect(rule.used[0]?.satisfies).toEqual(cs3000);
  });

  it("everyCourseStillCountsOnce", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 3000", "CS 3990"]);
    const audit = runDegreeAudit(student, reqs, CourseEquivalences.fromPairs([[cs3000, cs3990]]));
    const rule = auditResult(audit, "CS 3000");
    expect(rule).toBeTruthy();
    if (!rule) return;
    expect(rule.used.map((use) => use.key)).toEqual([cs3000]);
    expect(rule.used[0]?.satisfies).toBeUndefined();
    const counted = ruleResults(audit).flatMap((item) => item.used.map((use) => keyId(use.key)));
    expect(counted.length).toBe(new Set(counted).size);
    const elsewhere = [
      ...ruleResults(audit).filter((item) => item.rule.label !== "CS 3000").flatMap((item) => item.used.map((use) => use.key)),
      ...audit.generalElectives.map((use) => use.key),
      ...audit.unused.map((use) => use.key),
    ];
    expect(elsewhere.filter((item) => sameKey(item, cs3990))).toHaveLength(1);
  });

  it("aChainOfRenumberingsReachesTheRequirement", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 3991"]);
    const chain = CourseEquivalences.fromPairs([[cs3000, cs3990], [cs3990, cs3991]]);
    const audit = runDegreeAudit(student, reqs, chain);
    expect(auditResult(audit, "CS 3000")?.status).toBe("complete");
    expect(auditResult(audit, "CS 3000")?.used[0]?.key).toEqual(cs3991);
  });

  it("alternativesAcceptEquivalents", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 4999"]);
    const audit = runDegreeAudit(student, reqs, CourseEquivalences.fromPairs([[cs4530, cs4999]]));
    const rule = auditResult(audit, "CS 4500 or CS 4530");
    expect(rule).toBeTruthy();
    if (!rule) return;
    expect(rule.status).toBe("complete");
    expect(rule.used[0]?.satisfies).toEqual(cs4530);
  });

  it("rangesAcceptEquivalentsOfCoursesInThem", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 2100", "CS 4973"]);
    function electives(audit: DegreeAudit) {
      return ruleResults(audit).find((item) => item.rule.label.startsWith("Complete 8 semester hours of CS"));
    }
    const without = runDegreeAudit(student, reqs);
    expect(electives(without)?.status).toBe("partial");
    expect(electives(without)?.used.map((use) => use.key)).toEqual([{ subject: "CS", number: "4973" }]);

    const renumbered = CourseEquivalences.fromPairs([[{ subject: "CS", number: "2100" }, { subject: "CS", number: "2510" }]]);
    const audit = runDegreeAudit(student, reqs, renumbered);
    const rule = electives(audit);
    expect(rule).toBeTruthy();
    if (!rule) return;
    expect(rule.status).toBe("complete");
    const use = rule.used.find((item) => keyId(item.key) === "CS 2100");
    expect(use).toBeTruthy();
    expect(use?.satisfies ? keyId(use.satisfies) : undefined).toBe("CS 2510");
  });

  it("substitutionsAcceptEquivalentsToo", () => {
    const reqs = requirements();
    const student = auditPlan(["CS 1800", "CS 1802", "CS 3990"]);
    const rule = allRules(reqs).find((item) => item.label === "CS 4500 or CS 4530");
    expect(rule).toBeTruthy();
    if (!rule) return;
    student.substitutions = [{
      id: "sub-1",
      ruleID: rule.id,
      ruleTitle: "Software development",
      change: { type: "countCourse", course: cs3000 },
      note: "",
      createdAt: 0,
    }];
    const audit = runDegreeAudit(student, reqs, CourseEquivalences.fromPairs([[cs3000, cs3990]]));
    const result = resultFor(audit, rule.id);
    expect(result).toBeTruthy();
    if (!result) return;
    expect(result.used[0]?.key).toEqual(cs3990);
    expect(result.used[0]?.bySubstitution).toBe(true);
    expect(audit.unmatchedSubstitutions).toEqual([]);
  });
});

const bannerTermCodes = ["202710", "202655", "202650", "202632", "202630", "202610", "202560", "202550", "202540", "202530", "202510", "202460"];

function termList(codes: string[]): Term[] {
  return codes.map((code) => ({ code, bannerDescription: "" }));
}

class TestClock {
  private ms: number;
  constructor(startSeconds = 1_800_000_000) {
    this.ms = startSeconds * 1000;
  }
  now(): Date {
    return new Date(this.ms);
  }
  advance(days: number) {
    this.ms += days * 86_400_000;
  }
}

interface FoundCourseInfo {
  prerequisites?: Requisite | null;
  equivalents: CourseKey[];
  sourceTerm: string;
  isRetired?: boolean | null;
}
type CourseInfoResult = { type: "found"; info: FoundCourseInfo } | { type: "notFound" } | { type: "failed" };

interface CourseInfoRepositoryLike {
  catalogTerms(terms: Term[], maxBack: number): string[];
  lookupOne(course: CourseKey, indexes?: CatalogIndex[]): Promise<CourseInfoResult>;
  lookupMany(courses: CourseKey[], indexes?: CatalogIndex[]): Promise<Map<string, CourseInfoResult>>;
  cachedLookup(course: CourseKey): Promise<CourseInfoResult | null>;
}

interface CourseInfoStoreLike {
  state(course: CourseKey): string;
  info(course: CourseKey): { prerequisites?: Requisite | null; sourceTerm?: string; isRetired?: boolean | null } | null;
  load(courses: CourseKey[], indexes: CatalogIndex[]): Promise<void>;
  requisiteLookup(): (course: CourseKey) => Requisite | null | undefined;
  readonly version: number;
  equivalences(plan: DegreePlan | null): CourseEquivalences;
  equivalenceSuggestions(course: CourseKey, plan?: DegreePlan | null, catalogTitles?: Record<string, string>, alsoComparing?: CourseKey[]): EquivalenceSuggestion[];
}

/** Course-info lookup and its store are not exported. Calls stay undefined and the Swift values fail. */
function courseInfoRepository(): CourseInfoRepositoryLike | undefined {
  return (degreeLogic as { CourseInfoRepository?: CourseInfoRepositoryLike }).CourseInfoRepository;
}

function courseInfoStore(): CourseInfoStoreLike | undefined {
  return (degreeLogic as { CourseInfoStore?: CourseInfoStoreLike }).CourseInfoStore;
}

class CourseInfoBanner {
  entryCalls: { key: CourseKey; term: string }[] = [];
  maxInFlight = 0;
  terms: Term[];
  constructor(readonly clock: TestClock, termListIn: Term[]) {
    this.terms = termListIn;
  }
  list(code: string, term: string, _prerequisites?: Requisite | null, _equivalents: CourseKey[] = []) {
    void code;
    void term;
  }
  fail(term: string, failing = true) {
    void term;
    void failing;
  }
  resetCalls() {
    this.entryCalls = [];
  }
}

function foundInfo(result: CourseInfoResult | undefined): FoundCourseInfo | undefined {
  return result?.type === "found" ? result.info : undefined;
}

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "prerequisite-data-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class OfferingBanner implements OfferingFetcher {
  offeredCalls: { term: string; courses: CourseKey[] }[] = [];
  termList: Term[];
  private readonly offered = new Map<string, Set<string>>();
  private readonly down = new Set<string>();
  private readonly failWhenIncludes = new Map<string, string>();
  constructor(readonly clock: TestClock, termsIn: Term[] = termList(bannerTermCodes)) {
    this.termList = termsIn;
  }
  offer(term: string, courses: string[]) {
    const set = this.offered.get(term) ?? new Set<string>();
    for (const course of courses) set.add(course);
    this.offered.set(term, set);
  }
  fail(term: string) {
    this.down.add(term);
  }
  failQuestions(term: string, including: string | null) {
    if (including) this.failWhenIncludes.set(term, including);
    else this.failWhenIncludes.delete(term);
  }
  resetCalls() {
    this.offeredCalls = [];
  }
  setTerms(next: Term[]) {
    this.termList = next;
  }
  async terms(): Promise<Term[]> {
    return this.termList;
  }
  async offeredCourses(term: string, courses: CourseKey[]): Promise<CourseKey[]> {
    this.offeredCalls.push({ term, courses: [...courses] });
    if (this.down.has(term)) throw new Error(`${term} is down`);
    const needle = this.failWhenIncludes.get(term);
    if (needle && courses.some((course) => keyId(course) === needle)) throw new Error(`${term} batch failed`);
    const have = this.offered.get(term) ?? new Set<string>();
    return courses.filter((course) => have.has(keyId(course)));
  }
}

function offeringRepository(banner: OfferingBanner, directory: string, now: () => Date): OfferingHistoryRepository {
  return new OfferingHistoryRepository({ fetcher: banner, filePath: path.join(directory, "offering-history.json"), now });
}

function seededOfferingBanner(clock: TestClock): OfferingBanner {
  const banner = new OfferingBanner(clock);
  for (const term of ["202710", "202610", "202510"]) banner.offer(term, ["CS 3800", "MATH 2331"]);
  for (const term of ["202630", "202530"]) banner.offer(term, ["CS 3386", "MATH 2331"]);
  banner.offer("202650", ["CS 2500"]);
  return banner;
}

function sameKeyIds(actual: CourseKey[] | null | undefined, expected: CourseKey[]): boolean {
  const left = new Set((actual ?? []).map(keyId));
  const right = new Set(expected.map(keyId));
  if (left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
}

describe("CourseInfoRepositoryTests", () => {
  it("searchesTheNewestTermThenEarlierFallsAndSprings", () => {
    const exported = (degreeLogic as { catalogTerms?: (from: Term[], maxBack: number) => string[] }).catalogTerms;
    const repo = courseInfoRepository();
    const catalogTerms = exported ?? (repo ? (termsIn: Term[], maxBack: number) => repo.catalogTerms(termsIn, maxBack) : undefined);
    expect(catalogTerms?.(termList(bannerTermCodes), 3)).toEqual(["202710", "202630", "202610", "202530"]);
    expect(catalogTerms?.(termList(bannerTermCodes), 0)).toEqual(["202710"]);
    expect(catalogTerms?.(termList(["202650", "202630", "202610"]), 8)).toEqual(["202650", "202630", "202610"]);
    expect(catalogTerms?.(termList(["202655", "202632"]), 8)).toEqual([]);
  });

  it("looksInTheLoadedCatalogsFirst", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 3000", "202710");
    banner.list("CS 4050", "202630");
    const repo = courseInfoRepository();
    const loaded = index([
      catalogCourse("CS 3000", "CS 3000", requisite("CS 1800")),
      catalogCourse("CS 4050", "CS 4050", null, false),
    ]);
    const results = repo ? await repo.lookupMany([key("CS 3000"), key("CS 4050")], [loaded]) : undefined;
    const fromIndex = foundInfo(results?.get(keyId(key("CS 3000"))));
    expect(fromIndex?.prerequisites).toEqual(requisite("CS 1800"));
    expect(fromIndex?.sourceTerm).toBe("202710");
    expect(fromIndex?.isRetired).toBe(false);
    expect(banner.entryCalls.map((call) => call.key)).toEqual([key("CS 4050"), key("CS 4050")]);
    expect(banner.entryCalls.map((call) => call.term)).toEqual(["202710", "202630"]);
    const fromBanner = foundInfo(results?.get(keyId(key("CS 4050"))));
    expect(fromBanner?.sourceTerm).toBe("202630");
    expect(fromBanner?.isRetired).toBe(true);
  });

  it("walksBackThroughPreviousYearsAndRemembersTheTerm", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 2510", "202530", null, [key("CS 2100")]);
    const repo = courseInfoRepository();
    const result = repo ? await repo.lookupOne(key("CS 2510")) : undefined;
    const info = foundInfo(result);
    expect(info?.sourceTerm).toBe("202530");
    expect(info?.isRetired).toBe(true);
    expect(info?.equivalents).toEqual([key("CS 2100")]);
    expect(banner.entryCalls.map((call) => call.term)).toEqual(["202710", "202630", "202610", "202530"]);
  });

  it("foundCoursesAreCachedOnDiskForALongTime", async () => {
    await withTempDir(async () => {
      const clock = new TestClock();
      const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
      banner.list("CS 3386", "202710", requisite("CS 2386"));
      const first = courseInfoRepository();
      if (first) await first.lookupOne(key("CS 3386"));
      expect(banner.entryCalls).toHaveLength(1);

      clock.advance(30);
      const second = courseInfoRepository();
      const cached = second ? await second.cachedLookup(key("CS 3386")) : undefined;
      const cachedInfo = foundInfo(cached ?? undefined);
      expect(cachedInfo?.prerequisites).toEqual(requisite("CS 2386"));
      expect(cachedInfo?.isRetired).toBe(false);
      const again = second ? await second.lookupOne(key("CS 3386")) : undefined;
      expect(again).toEqual(cached);
      expect(banner.entryCalls).toHaveLength(1);

      clock.advance(200);
      const failing = new CourseInfoBanner(clock, termList(bannerTermCodes));
      failing.fail("202710");
      const third = courseInfoRepository();
      expect(third ? await third.cachedLookup(key("CS 3386")) : "missing-cache").toBeNull();
      const stale = foundInfo(third ? await third.lookupOne(key("CS 3386")) : undefined);
      expect(stale?.prerequisites).toEqual(requisite("CS 2386"));
      banner.list("CS 3386", "202710", requisite("CS 2000"));
      const fresh = foundInfo(courseInfoRepository() ? await courseInfoRepository()!.lookupOne(key("CS 3386")) : undefined);
      expect(fresh?.prerequisites).toEqual(requisite("CS 2000"));
    });
  });

  it("missingCoursesAreRememberedForAWeek", async () => {
    await withTempDir(async () => {
      const clock = new TestClock();
      const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
      const repo = courseInfoRepository();
      const first = repo ? await repo.lookupOne(key("CS 2963")) : undefined;
      expect(first?.type).toBe("notFound");
      expect(banner.entryCalls.map((call) => call.term)).toEqual(["202710", "202630", "202610", "202530"]);
      banner.resetCalls();

      clock.advance(6);
      const withinWeek = repo ? await repo.lookupOne(key("CS 2963")) : undefined;
      expect(withinWeek?.type).toBe("notFound");
      expect(banner.entryCalls).toEqual([]);
      const relaunched = courseInfoRepository();
      expect(relaunched ? await relaunched.cachedLookup(key("CS 2963")) : "missing-cache").toEqual({ type: "notFound" });

      clock.advance(2);
      expect(repo ? await repo.cachedLookup(key("CS 2963")) : "missing-cache").toBeNull();
      const after = repo ? await repo.lookupOne(key("CS 2963")) : undefined;
      expect(after?.type).toBe("notFound");
      expect(banner.entryCalls).toHaveLength(4);

      clock.advance(8);
      banner.list("CS 2963", "202710");
      const appeared = repo ? await repo.lookupOne(key("CS 2963")) : undefined;
      expect(appeared?.type).toBe("found");
    });
  });

  it("failuresAreNotCached", async () => {
    await withTempDir(async () => {
      const clock = new TestClock();
      const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
      banner.list("CS 4050", "202630");
      banner.fail("202630");
      const repo = courseInfoRepository();
      const failed = repo ? await repo.lookupOne(key("CS 4050")) : undefined;
      expect(failed?.type).toBe("failed");
      expect(repo ? await repo.cachedLookup(key("CS 4050")) : "missing-cache").toBeNull();

      banner.fail("202630", false);
      const info = foundInfo(repo ? await repo.lookupOne(key("CS 4050")) : undefined);
      expect(info?.sourceTerm).toBe("202630");
    });
  });

  it("termListFailureIsAFailureToo", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, []);
    void banner;
    const repo = courseInfoRepository();
    const result = repo ? await repo.lookupOne(key("CS 3386")) : undefined;
    expect(result?.type).toBe("failed");
  });

  it("fewCoursesAreLookedUpAtATime", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    const codes = [1, 2, 3, 4, 5, 6].map((n) => `CS 30${10 + n}`);
    for (const code of codes) banner.list(code, "202710");
    const repo = courseInfoRepository();
    const results = repo ? await repo.lookupMany(codes.map((code) => key(code))) : undefined;
    expect(results?.size).toBe(6);
    expect(results ? [...results.values()].every((item) => item.type === "found") : false).toBe(true);
    expect(banner.maxInFlight).toBe(2);
    banner.resetCalls();
    if (repo) await repo.lookupMany([key("CS 9001"), key("CS 9001")]);
    expect(banner.entryCalls.filter((call) => call.term === "202710")).toHaveLength(1);
  });
});

describe("CourseInfoStoreTests", () => {
  it("loadsInfoForCoursesTheTermDoesNotList", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 3386", "202710", requisite("CS 2386"));
    banner.list("CS 4050", "202630");
    const store = courseInfoStore();
    const loaded = index([catalogCourse("CS 3000", "CS 3000", requisite("CS 1800"))]);

    expect(store ? store.state(key("CS 3386")) : undefined).toBe("unknown");
    expect(store ? store.info(key("CS 3386")) : "missing-store").toBeNull();
    if (store) await store.load([key("CS 3386"), key("CS 4050"), key("CS 2963"), key("CS 3000")], [loaded]);

    expect(store?.info(key("CS 3386"))?.prerequisites).toEqual(requisite("CS 2386"));
    expect(store?.info(key("CS 4050"))?.sourceTerm).toBe("202630");
    expect(store?.info(key("CS 3000"))?.prerequisites).toEqual(requisite("CS 1800"));
    expect(store ? store.state(key("CS 2963")) : undefined).toBe("notFound");
    expect(store ? store.info(key("CS 2963")) : "missing-store").toBeNull();

    const lookup = store?.requisiteLookup();
    expect(lookup ? lookup(key("CS 3386")) : "missing-lookup").toEqual(requisite("CS 2386"));
    expect(lookup ? lookup(key("CS 4050")) : "missing-lookup").toBeNull();
    expect(lookup ? lookup(key("CS 2963")) : "missing-lookup").toBeUndefined();
    expect(lookup ? lookup(key("MATH 1")) : "missing-lookup").toBeUndefined();

    const plan = emptyPlan();
    plan.completed = [plannedCourse("CS 2386", 4, "")];
    plan.terms = [{ id: "spring-2027", season: "spring", year: 2027, courses: [plannedCourse("CS 3386", 4, "")] }];
    expectStatus(prerequisiteStatus(key("CS 3386"), 0, plan, loaded, lookup), "met");
  });

  it("loadingAgainChangesNothing", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 3386", "202710");
    const store = courseInfoStore();
    const keys = [key("CS 3386"), key("CS 2963")];
    if (store) await store.load(keys, []);
    const version = store?.version;
    expect(version ?? 0).toBeGreaterThan(0);
    const calls = banner.entryCalls.length;
    if (store) await store.load(keys, []);
    expect(store?.version).toBe(version);
    expect(banner.entryCalls).toHaveLength(calls);
  });

  it("failedLoadsCanBeRetried", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 3386", "202710");
    banner.fail("202710");
    const store = courseInfoStore();
    if (store) await store.load([key("CS 3386")], []);
    expect(store ? store.state(key("CS 3386")) : undefined).toBe("failed");
    banner.fail("202710", false);
    if (store) await store.load([key("CS 3386")], []);
    expect(store ? store.state(key("CS 3386")) : undefined).toBe("failed");
    const again = courseInfoStore();
    if (again) await again.load([key("CS 3386")], []);
    expect(again ? again.state(key("CS 3386")) : undefined).toBe("found");
  });

  it("equivalencesMergeBannerDeclaredAndCrossListed", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 2100", "202710", null, [key("CS 2510")]);
    const store = courseInfoStore();
    const loaded = index(
      [catalogCourse("HIST 1225", "Gender, Race, and Medicine"), catalogCourse("WMNS 1225", "Gender, Race, and Medicine")],
      [section("1", "HIST 1225", "", ["2"]), section("2", "WMNS 1225", "", ["1"])],
    );
    if (store) await store.load([key("CS 2100")], [loaded]);

    const fromBanner = store?.equivalences(null);
    expect(fromBanner?.areEquivalent(key("CS 2100"), key("CS 2510"))).toBe(true);
    expect(fromBanner?.areEquivalent(key("HIST 1225"), key("WMNS 1225"))).toBe(true);
    expect(fromBanner ? fromBanner.areEquivalent(key("CS 3100"), key("CS 3500")) : true).toBe(false);

    const plan = emptyPlan();
    declareEquivalence(plan, key("CS 3500"), key("CS 3100"));
    declareEquivalence(plan, key("CS 2500"), key("CS 2510"));
    const merged = store?.equivalences(plan);
    expect(merged?.areEquivalent(key("CS 3100"), key("CS 3500"))).toBe(true);
    expect(merged?.areEquivalent(key("CS 2500"), key("CS 2100"))).toBe(true);
    expect(merged?.areEquivalent(key("HIST 1225"), key("WMNS 1225"))).toBe(true);
  });
});

describe("ReportedCasesTests", () => {
  it("coursesTheTermDoesNotOfferAreCheckedFromPreviousYears", async () => {
    const catalog = await loadBundledCatalog("202710");
    expect(catalog).toBeTruthy();
    if (!catalog) return;
    const loaded = CatalogIndex.build(catalog);
    const cs3386 = key("CS 3386");
    const cs4050 = key("CS 4050");
    const cs2963 = key("CS 2963");
    expect(loaded.course(cs3386) == null && loaded.course(cs4050) == null && loaded.course(cs2963) == null).toBe(true);

    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    const needs3386 = reqAnd([
      reqOr([requisite("CS 2100"), requisite("CS 201M"), requisite("CS 2510")]),
      reqOr([requisite("CS 2386"), requisite("CS 3540")]),
    ]);
    banner.list("CS 3386", "202710", needs3386);
    banner.list("CS 4050", "202630");
    const store = courseInfoStore();
    const plan = emptyPlan();
    plan.completed = ["CS 1800", "CS 2000", "CS 2386"].map((code) => plannedCourse(code, 4, code));
    plan.terms = [{
      id: "spring-2027",
      season: "spring",
      year: 2027,
      courses: ["CS 3386", "CS 4050", "CS 2963"].map((code) => plannedCourse(code, 4, code)),
    }];
    if (store) await store.load([cs3386, cs4050, cs2963], [loaded]);

    const statusOfCourse = (course: CourseKey, current: DegreePlan) => prerequisiteStatus(
      course,
      0,
      current,
      loaded,
      store?.requisiteLookup(),
      store ? store.equivalences(current) : CourseEquivalences.none(),
    );
    expectStatus(statusOfCourse(cs3386, plan), "CS 2100 or CS 201M or CS 2510");
    expectStatus(statusOfCourse(cs4050, plan), "met");
    expect(store?.info(cs4050)?.isRetired).toBe(true);
    expectStatus(statusOfCourse(cs2963, plan), "unknown");
    expect(store ? store.state(cs2963) : undefined).toBe("notFound");

    declareEquivalence(plan, key("CS 2000"), key("CS 2100"), "Curriculum change");
    expectStatus(statusOfCourse(cs3386, plan), "met");
    const taken = ids(plan.completed.flatMap((course) => (course.key ? [course.key] : [])));
    expect(store ? store.equivalences(plan).satisfier(key("CS 2100"), taken) : undefined).toEqual(key("CS 2000"));
  });
});

function sortedSet(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe("CourseTitleMatcherTests", () => {
  function similarity(a: string, b: string): number | null {
    return titleSimilarity(a, b);
  }

  it("titlesAreReducedToTheirTellingWords", () => {
    expect(sortedSet(parseTitle("Principles of Human-Computer Interaction").words)).toEqual(["computer", "human", "interaction"]);
    expect(sortedSet(parseTitle("PRNCPLES of Human Computer Interaction").words)).toEqual(["computer", "human", "interaction"]);
    expect(sortedSet(parseTitle("Intr to Data Structures & Algorithms").words)).toEqual(["algorithm", "data", "structure"]);
    expect(sortedSet(parseTitle("Introduction to Women\u2019s Studies").words)).toEqual(["study", "women"]);
    expect(sortedSet(parseTitle("Fundamentals of Software Engineering").words)).toEqual(["engineering", "software"]);
    expect(sortedSet(parseTitle("Fundamentals of Computer Science 2").parts)).toEqual(["2"]);
    const roman = parseTitle("Computer Science II");
    expect(sortedSet(roman.parts)).toEqual(["2"]);
    expect(sortedSet(roman.words)).toEqual(["computer", "science"]);
    expect(sortedSet(parseTitle("Topics").words)).toEqual([]);
  });

  it("aRenumberedCourseKeepsItsTitleAlike", () => {
    expect(similarity("Human Computer Interaction", "Principles of Human-Computer Interaction")).toBe(1);
    expect(similarity("Principles of Human-Computer Interaction", "Human Computer Interaction")).toBe(1);
    expect(similarity("Prncples of Human-Computer Interaction", "Human Computer Interaction")).toBe(1);
    expect(similarity("First-Year Writing", "First Year Writing")).toBe(1);
  });

  it("titlesThatOnlyShareAWordAreNotAlike", () => {
    expect(similarity("Human Computer Interaction", "Computer Systems")).toBeNull();
    expect(similarity("Human Computer Interaction", "Human Factors in Computing")).toBeNull();
    expect(similarity("Data Science", "Data Structures")).toBeNull();
    expect(similarity("Cell Biology", "Cell Culture Techniques")).toBeNull();
    expect(similarity("Computer Systems", "Computer Networks")).toBeNull();
  });

  it("similarityIsTheShareOfWordsOrContainment", () => {
    const studio = similarity("Object-Oriented Design", "Object-Oriented Design Studio");
    expect(studio).not.toBeNull();
    expect(Math.abs((studio ?? 0) - 0.75)).toBeLessThan(0.0001);
    const theory = similarity("Machine Learning", "Machine Learning Theory");
    expect(theory).not.toBeNull();
    expect(Math.abs((theory ?? 0) - 2 / 3)).toBeLessThan(0.0001);
    expect(similarity("Machine Learning Theory", "Machine Learning Practice")).toBeNull();
    expect(similarity("Cell Biology", "Cell Biology of Cancer Metastasis")).toBe(0.6);
    expect(titleSimilarity("Cell Biology", "Cell Biology of Cancer Metastasis", 0.8)).toBe(0.8);
    expect(titleSimilarity("Machine Learning Theory", "Machine Learning Practice", 0.4)).toBe(0.5);
  });

  it("courseSequencesAreNotAlike", () => {
    expect(similarity("Fundamentals of Computer Science 1", "Fundamentals of Computer Science 2")).toBeNull();
    expect(similarity("Calculus 1 for Science and Engineering", "Calculus 2 for Science and Engineering")).toBeNull();
    expect(similarity("General Chemistry I", "General Chemistry II")).toBeNull();
    expect(similarity("Physics for Engineering 1", "Physics for Engineering 3")).toBeNull();
    expect(similarity("Fundamentals of Computer Science 2", "Computer Science 2")).toBe(1);
    expect(similarity("Computer Science I", "Computer Science")).toBe(1);
    expect(similarity("Computer Science 1", "Computer Science I")).toBe(1);
    expect(similarity("Computer Science 2", "Computer Science I")).toBeNull();
  });

  it("aCourseAndItsLabOrAdvancedVersionAreNotAlike", () => {
    expect(similarity("Sensation and Perception", "Laboratory in Sensation and Perception")).toBeNull();
    expect(similarity("General Chemistry 1", "General Chemistry 1 Lab")).toBeNull();
    expect(similarity("Fundamentals of Computer Science 2", "Lab for Fundamentals of Computer Science 2")).toBeNull();
    expect(similarity("Machine Learning", "Advanced Machine Learning")).toBeNull();
    expect(similarity("Advanced Machine Learning", "Advanced Machine Learning Methods")).not.toBeNull();
    expect(similarity("General Chemistry Lab", "General Chemistry Laboratory")).toBe(1);
    expect(sortedSet(parseTitle("Lab for Computer Systems").qualifiers)).toEqual(["lab"]);
  });

  it("shortAndGenericTitlesAreNeverAlike", () => {
    expect(similarity("Seminar", "Seminar")).toBeNull();
    expect(similarity("Algorithms", "Algorithms and Data")).toBeNull();
    expect(similarity("Calculus", "Calculus for Engineers")).toBeNull();
    expect(similarity("Special Topics", "Special Topics")).toBeNull();
    expect(similarity("Directed Study", "Directed Study")).toBeNull();
    expect(similarity("Research Seminar", "Research Seminar")).toBeNull();
    expect(similarity("Co-op Work Experience", "Co-op Work Experience")).toBeNull();
    expect(similarity("Topics", "Topics in Computer Science")).toBeNull();
    expect(similarity("Introduction to", "Introduction to Computer Science")).toBeNull();
    expect(similarity("", "Human Computer Interaction")).toBeNull();
    expect(similarity("", "")).toBeNull();
    expect(parseTitle("Seminar").isDistinctive).toBe(false);
    expect(parseTitle("Directed Study").isDistinctive).toBe(false);
    expect(parseTitle("Machine Learning").isDistinctive).toBe(true);
    expect(similarity("Machine Learning", "Machine Learning")).toBe(1);
    expect(similarity("Seminar in Human Computer Interaction", "Human Computer Interaction")).toBe(0.75);
  });

  it("cutOffAuditTitlesStillMatch", () => {
    expect(similarity("Fundamentals of Software Engin", "Fundamentals of Software Engineering")).toBe(1);
    expect(similarity("Fundamentals of Software Engineering", "Fundamentals of Software Engin")).toBe(1);
    const cut = similarity("Principles of Human-Computer I", "Human Computer Interaction");
    expect(cut != null && cut > 0.66).toBe(true);
    expect(similarity("Fundamentals of Software Engin", "Fundamentals of Software Testing")).toBeNull();
    expect(parseTitle("Fundamentals of Software Engin").cutOffWord).toBe("engin");
    expect(parseTitle("Software Engineering").cutOffWord).toBeNull();
  });
});

function either(...codes: string[]): Requisite {
  return reqOr(codes.map((code) => requisite(code)));
}

function listings(items: [string, Requisite][]): PrerequisiteListing[] {
  return items.map(([code, req]) => ({ course: key(code), requisite: req }));
}

const suggesterCatalog = listings([
  ["CS 3000", reqAnd([either("CS 2100", "CS 2510", "DS 2500"), either("CS 1800", "MATH 1365")])],
  ["CS 3200", either("CS 2100", "CS 2510")],
  ["CS 3386", reqAnd([reqOr([reqOr([requisite("CS 2100"), requisite("CS 201M")]), requisite("CS 2510")]), either("CS 2386", "CS 3540")])],
  ["CS 4100", requisite("CS 2510")],
  ["CS 4200", reqAnd([requisite("CS 2510"), requisite("MATH 1365")])],
  ["ANTH 2000", either("ANTH 1101", "POLS 1160")],
]);

const currentCourseIds = new Set(["CS 2100", "DS 2500", "CS 3000", "ANTH 1101"]);

const titleTable = new Map<string, string>([
  ["IS 4300", "Human Computer Interaction"],
  ["CS 2484", "Principles of Human-Computer Interaction"],
  ["CS 3000", "Algorithms and Data"],
  ["CS 3650", "Computer Systems"],
  ["CS 2510", "Fundamentals of Computer Science 2"],
  ["CS 2515", "Computer Science 2 Honors"],
  ["CS 2100", "Program Design and Implementation 1"],
  ["CS 4550", "Web Development"],
]);

function byTitle(
  retired: string,
  candidates: string[],
  options?: {
    titles?: Map<string, string>;
    prerequisites?: PrerequisiteListing[];
    isCurrent?: (course: CourseKey) => boolean;
    known?: CourseEquivalences;
    limit?: number;
  },
): EquivalenceSuggestion[] {
  const table = options?.titles ?? titleTable;
  return equivalenceSuggestions({
    retired: key(retired),
    prerequisites: options?.prerequisites ?? [],
    isCurrent: options?.isCurrent ?? (() => true),
    known: options?.known,
    limit: options?.limit ?? 3,
    title: (course) => table.get(keyId(course)),
    titleCandidates: candidates.map((code) => key(code)),
  });
}

describe("EquivalenceSuggesterTests", () => {
  function suggest(retired: string, options?: {
    prerequisites?: PrerequisiteListing[];
    isCurrent?: (course: CourseKey) => boolean;
    known?: CourseEquivalences;
    minimumTogether?: number;
    minimumShare?: number;
    limit?: number;
  }): EquivalenceSuggestion[] {
    return equivalenceSuggestions({
      retired: key(retired),
      prerequisites: options?.prerequisites ?? suggesterCatalog,
      isCurrent: options?.isCurrent ?? ((course) => currentCourseIds.has(keyId(course))),
      known: options?.known,
      minimumTogether: options?.minimumTogether,
      minimumShare: options?.minimumShare,
      limit: options?.limit,
    });
  }

  it("suggestsTheCurrentCoursesListedBesideTheRetiredOne", () => {
    const found = suggest("CS 2510");
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2100")]);
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) return;
    expect(suggestion.course).toEqual(key("CS 2510"));
    expect(suggestion.together === 3 && suggestion.total === 5).toBe(true);
    expect(suggestionConfidence(suggestion)).toBe(0.6);
    expect(suggestionEvidence(suggestion)).toBe("Listed together in 3 of the 5 prerequisites that name CS 2510");
    expect(suggestionId(suggestion)).toBe("CS 2510|CS 2100");
  });

  it("thresholdsAndLimitsApply", () => {
    const wide = suggest("CS 2510", { minimumTogether: 1, minimumShare: 0.2 });
    expect(wide.map((item) => item.candidate)).toEqual([key("CS 2100"), key("DS 2500")]);
    expect(suggest("CS 2510", { minimumTogether: 1, minimumShare: 0.2, limit: 1 }).map((item) => item.candidate)).toEqual([key("CS 2100")]);
    expect(suggest("CS 2510", { minimumShare: 0.8 })).toEqual([]);
  });

  it("leavesOutWhatIsKnownOrNotCurrent", () => {
    const known = CourseEquivalences.fromPairs([[key("CS 2510"), key("CS 2100")]]);
    expect(suggest("CS 2510", { known })).toEqual([]);
    expect(suggest("CS 2510", { isCurrent: () => false })).toEqual([]);
    expect(suggest("CS 9999", { isCurrent: () => true })).toEqual([]);
    expect(suggest("CS 4100", { isCurrent: () => true })).toEqual([]);
    const own = listings([["CS 2510", either("CS 2510", "CS 2100")]]);
    expect(suggest("CS 2510", { prerequisites: own, isCurrent: () => true })).toEqual([]);
  });

  it("aSingleDependentReadsNaturally", () => {
    const one = listings([
      ["CS 3000", either("CS 2100", "CS 2510")],
      ["CS 3001", either("CS 2100", "CS 2510")],
    ]);
    const found = suggest("CS 2510", { prerequisites: one, isCurrent: () => true });
    expect(found[0] ? suggestionEvidence(found[0]) : undefined).toBe("Listed together in 2 of the 2 prerequisites that name CS 2510");
    const lone: EquivalenceSuggestion = { course: key("CS 2510"), candidate: key("CS 2100"), together: 1, total: 1 };
    expect(suggestionEvidence(lone)).toBe("Listed together in the prerequisites of the 1 course that names CS 2510");
  });

  it("suggestsAStudentCourseWithASimilarTitle", () => {
    const found = byTitle("IS 4300", ["CS 3000", "CS 2484", "CS 3650", "CS 2510"]);
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484")]);
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) return;
    expect(suggestion.course).toEqual(key("IS 4300"));
    expect(suggestion.together === 0 && suggestion.total === 0 && !suggestionIsListedTogether(suggestion) && suggestionConfidence(suggestion) === 0).toBe(true);
    expect(suggestion.similarTitle === "Principles of Human-Computer Interaction" && suggestion.titleScore === 1).toBe(true);
    expect(suggestionEvidence(suggestion)).toBe("Similar title: Principles of Human-Computer Interaction");
    expect(suggestionId(suggestion)).toBe("IS 4300|CS 2484");
  });

  it("aTrueNegativeIsNotSuggested", () => {
    expect(byTitle("IS 4300", ["CS 3650", "CS 3000", "CS 4550"])).toEqual([]);
  });

  it("genericTitlesGiveNoTitleEvidence", () => {
    function titled(retiredTitle: string, candidateTitle: string): EquivalenceSuggestion[] {
      return byTitle("IS 4300", ["CS 3000"], {
        titles: new Map([
          ["IS 4300", retiredTitle],
          ["CS 3000", candidateTitle],
        ]),
      });
    }
    for (const generic of ["Seminar", "Special Topics", "Directed Study", "Topics", "Introduction to", ""]) {
      expect(titled(generic, generic)).toEqual([]);
      expect(titled(generic, "Human Computer Interaction")).toEqual([]);
      expect(titled("Human Computer Interaction", generic)).toEqual([]);
    }
    expect(byTitle("IS 4300", ["CS 3000"], { titles: new Map([["CS 3000", "Human Computer Interaction"]]) })).toEqual([]);
    expect(byTitle("IS 4300", ["CS 3000"], { titles: new Map([["IS 4300", "Human Computer Interaction"]]) })).toEqual([]);
    expect(byTitle("CS 2510", ["CS 2501"], {
      titles: new Map([
        ["CS 2510", "Fundamentals of Computer Science 2"],
        ["CS 2501", "Fundamentals of Computer Science 1"],
      ]),
    })).toEqual([]);
  });

  it("leavesOutTheRetiredCourseAndWhatIsKnown", () => {
    expect(byTitle("IS 4300", ["IS 4300"])).toEqual([]);
    const known = CourseEquivalences.fromPairs([[key("IS 4300"), key("CS 2484")]]);
    expect(byTitle("IS 4300", ["CS 2484"], { known })).toEqual([]);
    const chain = CourseEquivalences.fromPairs([[key("IS 4300"), key("CS 9000")], [key("CS 9000"), key("CS 2484")]]);
    expect(byTitle("IS 4300", ["CS 2484"], { known: chain })).toEqual([]);
  });

  it("titleCandidatesNeedNotBeCurrent", () => {
    expect(byTitle("IS 4300", ["CS 2484"], { isCurrent: () => false }).map((item) => item.candidate)).toEqual([key("CS 2484")]);
  });

  it("titleSuggestionsAreRankedByHowAlikeTheTitlesAre", () => {
    const table = new Map(titleTable);
    table.set("CS 5100", "Human Computer Interaction Methods and Practice");
    table.set("CS 5200", "Human-Computer Interaction Studio");
    const found = byTitle("IS 4300", ["CS 5100", "CS 2484", "CS 5200"], { titles: table });
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484"), key("CS 5200"), key("CS 5100")]);
    expect(found.map((item) => item.titleScore)).toEqual([1, 0.75, 0.6]);
  });

  it("titlesRankBelowListedTogetherAndBothKindsAreReturned", () => {
    const prerequisites = listings([
      ["CS 4520", either("IS 4300", "CS 2484", "CS 4550")],
      ["CS 4540", either("IS 4300", "CS 2484", "CS 4550")],
      ["CS 4600", requisite("IS 4300")],
    ]);
    const table = new Map(titleTable);
    table.set("CS 5100", "Human Computer Interaction Studio");
    const found = byTitle("IS 4300", ["CS 5100", "CS 2484"], { titles: table, prerequisites });
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484"), key("CS 4550"), key("CS 5100")]);
    const both = found[0];
    expect(both).toBeTruthy();
    if (!both) return;
    expect(both.together === 2 && both.total === 3 && suggestionIsListedTogether(both)).toBe(true);
    expect(both.similarTitle === "Principles of Human-Computer Interaction" && both.titleScore === 1).toBe(true);
    expect(suggestionEvidence(both)).toBe("Listed together in 2 of the 3 prerequisites that name IS 4300 \u00b7 similar title");
    expect(found[1]?.similarTitle ?? null).toBeNull();
    expect(found[1] ? suggestionEvidence(found[1]) : undefined).toBe("Listed together in 2 of the 3 prerequisites that name IS 4300");
    expect(found[2]?.together === 0 && found[2]?.total === 3).toBe(true);
    expect(found[2] ? suggestionEvidence(found[2]) : undefined).toBe("Similar title: Human Computer Interaction Studio");
  });

  it("aTitleSuggestionKeepsAPlaceWhenThePrerequisitesWouldFillTheList", () => {
    const listing = [1, 2, 3, 4].map((number): [string, Requisite] => [`CS 40${number}0`, either("IS 4300", "CS 2110", "CS 2210", "CS 2310")]);
    const all = [...listings(listing), ...listings([["CS 4500", either("IS 4300", "CS 2484")]])];
    const found = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 3 });
    expect(found).toHaveLength(3);
    expect(found.at(-1)?.candidate).toEqual(key("CS 2484"));
    expect(found.at(-1)?.together).toBe(0);
    expect(found.slice(0, -1).every((item) => suggestionIsListedTogether(item))).toBe(true);
    const one = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 1 });
    expect(one).toHaveLength(1);
    expect(one[0] ? suggestionIsListedTogether(one[0]) : false).toBe(true);
    const two = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 2 });
    expect(two.map((item) => suggestionIsListedTogether(item))).toEqual([true, false]);
    expect(byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 0 })).toEqual([]);
  });
});

function newestSuggestionIndex(): CatalogIndex {
  const alternatives = reqOr([requisite("CS 2100"), requisite("CS 2510")]);
  return index([
    catalogCourse("CS 2100"),
    catalogCourse("CS 3000", "CS 3000", alternatives),
    catalogCourse("CS 3200", "CS 3200", alternatives),
    catalogCourse("CS 3300", "CS 3300", reqOr([requisite("CS 2100"), requisite("CS 2510"), requisite("DS 2500")])),
  ]);
}

describe("EquivalenceSuggestionStoreTests", () => {
  it("suggestsReplacementsForRetiredCoursesOnly", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 2510", "202530");
    banner.list("CS 3386", "202710");
    const store = courseInfoStore();
    const loaded = newestSuggestionIndex();
    expect(store ? store.equivalenceSuggestions(key("CS 2510")) : undefined).toEqual([]);
    if (store) await store.load([key("CS 2510"), key("CS 3386"), key("CS 3000"), key("CS 2963")], [loaded]);
    expect(store?.info(key("CS 2510"))?.isRetired).toBe(true);
    const found = store?.equivalenceSuggestions(key("CS 2510"));
    expect(found?.map((item) => item.candidate)).toEqual([key("CS 2100")]);
    expect(found?.[0]?.together === 3 && found?.[0]?.total === 3).toBe(true);
    expect(store ? store.equivalenceSuggestions(key("CS 3000")) : undefined).toEqual([]);
    expect(store ? store.equivalenceSuggestions(key("CS 3386")) : undefined).toEqual([]);
    expect(store ? store.state(key("CS 2963")) : undefined).toBe("notFound");
    expect(store ? store.equivalenceSuggestions(key("CS 2963")) : undefined).toEqual([]);
    const plan = emptyPlan();
    declareEquivalence(plan, key("CS 2510"), key("CS 2100"));
    expect(store ? store.equivalenceSuggestions(key("CS 2510"), plan) : undefined).toEqual([]);
  });

  it("suggestsTheStudentsCourseWithASimilarTitle", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("IS 4300", "202530");
    const store = courseInfoStore();
    const plan = emptyPlan();
    plan.completed = [
      plannedCourse("CS 2484", 4, "Principles of Human-Computer I"),
      plannedCourse("CS 3650", 4, "Computer Systems"),
    ];
    plan.terms = [{ id: "spring-2027", season: "spring", year: 2027, courses: [plannedCourse("CS 4550", 4, "Web Development")] }];
    if (store) await store.load([key("IS 4300"), key("CS 2484"), key("CS 3650")], [newestSuggestionIndex()]);
    expect(store?.info(key("IS 4300"))?.isRetired).toBe(true);
    const found = store?.equivalenceSuggestions(key("IS 4300"), plan);
    expect(found?.map((item) => item.candidate)).toEqual([key("CS 2484")]);
    const suggestion = found?.[0];
    expect(suggestion?.similarTitle === "Principles of Human-Computer I" && suggestion != null && !suggestionIsListedTogether(suggestion)).toBe(true);
    expect(suggestion ? suggestionEvidence(suggestion) : undefined).toBe("Similar title: Principles of Human-Computer I");
    expect(store ? store.equivalenceSuggestions(key("IS 4300")) : undefined).toEqual([]);
    const catalog = { "CS 2484": "Principles of Human-Computer Interaction", "CS 4550": "Web Development" };
    const listed = store?.equivalenceSuggestions(key("IS 4300"), null, catalog, [key("CS 2484"), key("CS 4550")]);
    expect(listed?.map((item) => item.candidate)).toEqual([key("CS 2484")]);
    expect(listed?.[0]?.similarTitle).toBe("Principles of Human-Computer Interaction");
    const titled = store?.equivalenceSuggestions(key("IS 4300"), plan, { "IS 4300": "Computer Systems" });
    expect(titled?.map((item) => item.candidate)).toEqual([key("CS 3650")]);
    declareEquivalence(plan, key("CS 2484"), key("IS 4300"));
    expect(store ? store.equivalenceSuggestions(key("IS 4300"), plan) : undefined).toEqual([]);
  });

  it("titlesComeFromTheBestSource", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("IS 4300", "202530");
    banner.list("CS 2484", "202710");
    const store = courseInfoStore();
    const plan = emptyPlan();
    plan.completed = [plannedCourse("CS 2484", 4, "Principles of Human-Computer I")];
    if (store) await store.load([key("IS 4300"), key("CS 2484")], [newestSuggestionIndex()]);
    expect(store?.equivalenceSuggestions(key("IS 4300"), plan)?.[0]?.similarTitle).toBe("Principles of Human-Computer Interaction (Banner)");
    const catalog = { "CS 2484": "Human-Computer Interaction Principles (catalog)" };
    expect(store?.equivalenceSuggestions(key("IS 4300"), plan, catalog)?.[0]?.similarTitle).toBe("Human-Computer Interaction Principles (catalog)");
  });

  it("currentCoursesGetNoTitleSuggestions", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("IS 4300", "202710");
    const store = courseInfoStore();
    const plan = emptyPlan();
    plan.completed = [plannedCourse("CS 2484", 4, "Principles of Human-Computer Interaction")];
    if (store) await store.load([key("IS 4300"), key("CS 2484")], [newestSuggestionIndex()]);
    expect(store?.info(key("IS 4300"))?.isRetired).toBe(false);
    expect(store ? store.equivalenceSuggestions(key("IS 4300"), plan) : undefined).toEqual([]);
  });

  it("loadedCatalogsDoNotDropBannerEquivalents", async () => {
    const clock = new TestClock();
    const banner = new CourseInfoBanner(clock, termList(bannerTermCodes));
    banner.list("CS 2100", "202710", null, [key("CS 2510")]);
    const store = courseInfoStore();
    if (store) await store.load([key("CS 2100")], []);
    expect(store?.equivalences(null)?.areEquivalent(key("CS 2100"), key("CS 2510"))).toBe(true);
    if (store) await store.load([key("CS 2100")], [index([catalogCourse("CS 2100", "CS 2100", requisite("CS 1800"))])]);
    expect(store?.info(key("CS 2100"))?.prerequisites).toEqual(requisite("CS 1800"));
    expect(store?.info(key("CS 2100"))?.isRetired).toBe(false);
    expect(store?.equivalences(null)?.areEquivalent(key("CS 2100"), key("CS 2510"))).toBe(true);
    if (store) await store.load([key("CS 2100")], [index([catalogCourse("CS 2100", "CS 2100", requisite("CS 1000"))], [], "202610")]);
    expect(store?.info(key("CS 2100"))?.prerequisites).toEqual(requisite("CS 1800"));
  });
});

const offeringChecked = ["202710", "202650", "202630", "202610", "202550", "202530", "202510"];

function offeringHistory(offered: Record<string, string[]>, checked?: string[], keys?: string[]): OfferingHistory {
  return new OfferingHistory({
    checkedTerms: checked ?? offeringChecked,
    offered: Object.entries(offered).map(([code, terms]) => ({ key: key(code), terms })),
    checkedKeys: keys === undefined ? null : keys.map((code) => key(code)),
  });
}

describe("OfferingHistoryTests", () => {
  it("seasonsAndLikelyOfferings", () => {
    const history = offeringHistory({
      "CS 3386": ["202630", "202530"],
      "CS 3800": ["202710", "202610", "202510"],
      "CS 2500": ["202650", "202550"],
    });
    expect(history.seasons(key("CS 3386"))).toEqual(["spring"]);
    expect(history.seasons(key("CS 2500"))).toEqual(["summerFull"]);
    expect(history.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(history.isLikelyOffered(key("CS 3386"), "fall")).toBe(false);
    expect(history.isLikelyOffered(key("CS 2500"), "summerA")).toBe(true);
    expect(history.isLikelyOffered(key("CS 2500"), "summerB")).toBe(true);
    expect(history.isLikelyOffered(key("CS 3386"), "summerA")).toBe(false);
    expect(history.isLikelyOffered(key("CS 3386"), "winter")).toBeNull();
    expect(history.isLikelyOffered(key("CS 9999"), "spring")).toBe(false);
  });

  it("unknownWhenNothingWasChecked", () => {
    expect(OfferingHistory.empty().isLikelyOffered(key("CS 3386"), "spring")).toBeNull();
    expect(OfferingHistory.empty().summary(key("CS 3386"))).toBe("Offering history unknown");
    const partial = offeringHistory({ "CS 3386": ["202630"] }, undefined, ["CS 3386"]);
    expect(partial.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(partial.isLikelyOffered(key("CS 3800"), "spring")).toBeNull();
    expect(partial.summary(key("CS 3800"))).toBe("Offering history unknown");
    expect(partial.summaryIn(key("CS 3800"), "spring")).toBe("Offering history unknown");
  });

  it("summaries", () => {
    const history = offeringHistory({
      "CS 3386": ["202630", "202530"],
      "CS 3800": ["202710", "202610", "202510", "202630", "202530"],
      "CS 4100": ["202530"],
      "CS 2500": ["202650", "202550"],
      "CS 2510": ["202650", "202630"],
    });
    expect(history.summary(key("CS 3386"))).toBe("Offered every spring");
    expect(history.summary(key("CS 3800"))).toBe("Offered every fall and spring");
    expect(history.summary(key("CS 4100"))).toBe("Last offered Spring 2025");
    expect(history.summary(key("CS 2500"))).toBe("Offered every summer");
    expect(history.summary(key("CS 2510"))).toBe("Last offered Summer 2026");
    expect(history.summary(key("CS 9999"))).toBe("Not offered in the last 2 years");
    const mixed = offeringHistory({ "CS 3800": ["202710", "202610", "202510", "202630"] });
    expect(mixed.summary(key("CS 3800"))).toBe("Offered every fall, and sometimes in the spring");
    expect(offeringHistory({ "CS 3800": ["202710", "202610", "202510", "202630", "202550"] }).summary(key("CS 3800")))
      .toBe("Offered every fall, and sometimes in the spring and summer");
    expect(history.summaryIn(key("CS 3386"), "spring")).toBe("Offered every spring");
    expect(history.summaryIn(key("CS 4100"), "spring")).toBe("Offered in Spring 2025");
    expect(history.summaryIn(key("CS 3386"), "fall")).toBe("Not offered in a fall term in the last 2 years");
    expect(history.summaryIn(key("CS 2500"), "summerA")).toBe("Offered every summer");
  });

  it("historiesMergeAndRoundTrip", () => {
    const first = offeringHistory({ "CS 3386": ["202630"] }, ["202710", "202630"], ["CS 3386"]);
    const second = offeringHistory({ "CS 3800": ["202710"] }, ["202710", "202610"], ["CS 3800"]);
    const merged = first.merging(second);
    expect(merged.checkedTerms).toEqual(["202710", "202630", "202610"]);
    expect(merged.offeredTerms(key("CS 3386"))).toEqual(["202630"]);
    expect(merged.offeredTerms(key("CS 3800"))).toEqual(["202710"]);
    expect(sameKeyIds(merged.checkedKeys(), [key("CS 3386"), key("CS 3800")])).toBe(true);
    expect(first.merging(offeringHistory({})).checkedKeys()).toBeNull();
    for (const original of [merged, offeringHistory({ "CS 3386": ["202630", "202530"] }), OfferingHistory.empty()]) {
      const decoded = OfferingHistory.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
      expect(decoded.toJSON()).toEqual(original.toJSON());
    }
  });
});

describe("OfferingHistoryRepositoryTests", () => {
  it("coversTwoYearsOfTermsSummersIncluded", () => {
    const neu = termList(bannerTermCodes).filter((term) => termCollege(term.code) === "neu");
    expect(offeringWindow(neu, 24).map((term) => term.code)).toEqual([
      "202710", "202650", "202630", "202610", "202560", "202550", "202540", "202530", "202510",
    ]);
    expect(offeringWindow([], 24)).toEqual([]);
  });

  it("asksOncePerTermAboutTheCoursesAndCachesThePast", async () => {
    await withTempDir(async (directory) => {
      const clock = new TestClock();
      const banner = seededOfferingBanner(clock);
      const repository = offeringRepository(banner, directory, () => clock.now());
      const keys = [key("CS 3386"), key("CS 3800"), key("MATH 2331"), key("CS 2500")];
      const history = await repository.history(keys);
      expect(history.checkedTerms).toEqual(["202710", "202650", "202630", "202610", "202560", "202550", "202540", "202530", "202510"]);
      expect(banner.offeredCalls).toHaveLength(9);
      expect(banner.offeredCalls.every((call) => sameKeyIds(call.courses, keys))).toBe(true);
      expect(history.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
      expect(history.isLikelyOffered(key("CS 3386"), "fall")).toBe(false);
      expect(history.isLikelyOffered(key("CS 3800"), "fall")).toBe(true);
      expect(history.isLikelyOffered(key("CS 2500"), "summerA")).toBe(true);
      expect(history.summary(key("MATH 2331"))).toBe("Offered every fall and spring");
      expect(sameKeyIds(history.checkedKeys(), keys)).toBe(true);

      banner.resetCalls();
      await repository.history(keys);
      expect(banner.offeredCalls).toEqual([]);
      clock.advance(30);
      const relaunched = offeringRepository(banner, directory, () => clock.now());
      await relaunched.history(keys);
      expect(banner.offeredCalls.map((call) => call.term)).toEqual(["202710"]);

      banner.resetCalls();
      await relaunched.history([key("PHYS 1151"), key("CS 3386")]);
      expect(banner.offeredCalls).toHaveLength(9);
      expect(banner.offeredCalls.every((call) => call.courses.length === 1 && keyId(call.courses[0]!) === "PHYS 1151")).toBe(true);
    });
  });

  it("bigQuestionsAreBatchedAndKeepWhatWasFound", async () => {
    await withTempDir(async (directory) => {
      const clock = new TestClock();
      const banner = seededOfferingBanner(clock);
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `CS 30${10 + n}`);
      banner.offer("202630", numbers);
      const repository = offeringRepository(banner, directory, () => clock.now());
      const keys = numbers.map((code) => key(code));
      banner.failQuestions("202630", "CS 3022");
      const partial = await repository.history(keys);
      expect(partial.checkedTerms.includes("202630")).toBe(false);
      expect(partial.checkedTerms.includes("202530")).toBe(true);
      expect(banner.offeredCalls.filter((call) => call.term === "202630").map((call) => call.courses.length)).toEqual([10, 2]);
      expect(banner.offeredCalls.filter((call) => call.term === "202710").map((call) => call.courses.length)).toEqual([10, 2]);

      banner.failQuestions("202630", null);
      banner.resetCalls();
      const full = await repository.history(keys);
      expect(banner.offeredCalls.map((call) => call.term)).toEqual(["202630"]);
      expect(banner.offeredCalls[0]?.courses).toEqual([key("CS 3021"), key("CS 3022")]);
      expect(full.checkedTerms.includes("202630")).toBe(true);
      expect(keys.every((course) => full.isLikelyOffered(course, "spring") === true)).toBe(true);
    });
  });

  it("theCurrentTermIsRefreshedWeekly", async () => {
    await withTempDir(async (directory) => {
      const clock = new TestClock();
      const banner = seededOfferingBanner(clock);
      const repository = offeringRepository(banner, directory, () => clock.now());
      await repository.history([key("CS 3800")]);
      banner.resetCalls();
      clock.advance(6);
      await repository.history([key("CS 3800")]);
      expect(banner.offeredCalls).toEqual([]);
      clock.advance(2);
      await repository.history([key("CS 3800")]);
      expect(banner.offeredCalls.map((call) => call.term)).toEqual(["202710"]);
    });
  });

  it("aTermReadBeforeItStartedIsReadAgain", async () => {
    await withTempDir(async (directory) => {
      const early = new TestClock(1_780_000_000);
      const banner = new OfferingBanner(early, termList(bannerTermCodes));
      banner.offer("202710", ["CS 3800"]);
      const first = offeringRepository(banner, directory, () => early.now());
      await first.history([key("CS 3800")]);
      expect(banner.offeredCalls.some((call) => call.term === "202710")).toBe(true);

      early.advance(230);
      banner.resetCalls();
      banner.setTerms([...termList(["202730"]), ...termList(bannerTermCodes)]);
      const second = offeringRepository(banner, directory, () => early.now());
      await second.history([key("CS 3800")]);
      const asked = new Set(banner.offeredCalls.map((call) => call.term));
      expect(asked.has("202730") && asked.has("202710")).toBe(true);
      expect(asked.has("202630") || asked.has("202610")).toBe(false);

      early.advance(60);
      banner.resetCalls();
      banner.setTerms([...termList(["202750", "202730"]), ...termList(bannerTermCodes)]);
      await offeringRepository(banner, directory, () => early.now()).history([key("CS 3800")]);
      expect(banner.offeredCalls.some((call) => call.term === "202710")).toBe(false);
    });
  });

  it("aTermThatCouldNotBeReachedIsNotReportedAsNotOffered", async () => {
    await withTempDir(async (directory) => {
      const clock = new TestClock();
      const banner = seededOfferingBanner(clock);
      banner.fail("202630");
      const history = await offeringRepository(banner, directory, () => clock.now()).history([key("CS 3386")]);
      expect(history.checkedTerms.includes("202630")).toBe(false);
      expect(history.checkedTerms.includes("202530")).toBe(true);
      expect(history.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);

      const offline = new OfferingBanner(clock, termList(bannerTermCodes));
      for (const term of termList(bannerTermCodes)) offline.fail(term.code);
      const offlineDir = path.join(directory, "offline");
      await mkdir(offlineDir);
      const none = await offeringRepository(offline, offlineDir, () => clock.now()).history([key("CS 3386")]);
      expect(none.checkedTerms).toEqual([]);
      expect(none.isLikelyOffered(key("CS 3386"), "spring")).toBeNull();
    });
  });

  it("loadedCatalogsAnswerWithoutARequest", async () => {
    await withTempDir(async (directory) => {
      const clock = new TestClock();
      const banner = seededOfferingBanner(clock);
      const fall2026 = index([catalogCourse("CS 3386"), catalogCourse("CS 3800")], [section("1", "CS 3800")], "202710");
      const loaded: OfferingIndex = {
        term: fall2026.catalog.term,
        sectionsFor: (course) => fall2026.sectionsOf(course),
      };
      const history = await offeringRepository(banner, directory, () => clock.now()).history([key("CS 3386"), key("CS 3800")], [loaded]);
      expect(banner.offeredCalls.some((call) => call.term === "202710")).toBe(false);
      expect(history.checkedTerms.includes("202710")).toBe(true);
      expect(history.offeredTerms(key("CS 3800")).includes("202710")).toBe(true);
      expect(history.offeredTerms(key("CS 3386")).includes("202710")).toBe(false);
    });
  });
});

const reorderFall = ["202710", "202610", "202510"];
const reorderSpring = ["202630", "202530"];
let reorderTermSerial = 0;

function reorderSemester(season: PlanSeason, year: number, codes: string[], credits = 4): DegreePlanTerm {
  reorderTermSerial += 1;
  return {
    id: `reorder-${reorderTermSerial}`,
    season,
    year,
    courses: codes.map((code) => plannedCourse(code, credits, code)),
  };
}

function reorderPlan(termListIn: DegreePlanTerm[], completed: string[] = []): DegreePlan {
  const plan = emptyPlan();
  plan.completed = completed.map((code) => plannedCourse(code));
  plan.terms = termListIn;
  return plan;
}

function taught(codes: string[], terms: string[]): Record<string, string[]> {
  return Object.fromEntries(codes.map((code) => [code, terms]));
}

function reorderHistory(offered: Record<string, string[]>, keys?: string[]): OfferingHistory {
  return new OfferingHistory({
    checkedTerms: ["202710", "202650", "202630", "202610", "202550", "202530", "202510"],
    offered: Object.entries(offered).map(([code, terms]) => ({ key: key(code), terms })),
    checkedKeys: keys === undefined ? null : keys.map((code) => key(code)),
  });
}

function needs(table: Record<string, Requisite>): PrerequisiteLookup {
  const byId = new Map(Object.entries(table).map(([code, req]) => [keyId(key(code)), req]));
  return (course) => {
    const found = byId.get(keyId(course));
    return found === undefined ? null : found;
  };
}

function moveSuggestions(
  plan: DegreePlan,
  blocking: string[],
  history: OfferingHistory,
  options?: { term?: number; prerequisites?: PrerequisiteLookup; equivalences?: CourseEquivalences; maxCredits?: number },
): ReorderSuggestion[] {
  const sorted = { ...plan, terms: [...plan.terms] };
  sortPlanTerms(sorted);
  const term = sorted.terms[options?.term ?? 0];
  if (!term) return [];
  return reorderSuggestions({
    plan,
    termID: term.id,
    blocking: blocking.map((code) => key(code)),
    history,
    prerequisites: options?.prerequisites ?? (() => null),
    equivalences: options?.equivalences,
    maxCreditsPerTerm: options?.maxCredits,
  });
}

function moveTitles(found: ReorderSuggestion[]): string[] {
  return found.map((item) => item.title);
}

describe("DegreePlanReorderingTests", () => {
  it("aCourseOnlyMovesToASeasonItIsTaughtIn", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386", "CS 3800"]),
      reorderSemester("spring", 2027, ["CS 4100"]),
      reorderSemester("fall", 2027, []),
      reorderSemester("spring", 2028, []),
    ]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 3800": reorderFall, "CS 4100": [...reorderFall, ...reorderSpring] });
    const found = moveSuggestions(plan, ["CS 3386"], history);
    expect(found[0]?.title).toBe("Move CS 3386 to Spring 2027");
    expect(found[0]?.moves).toEqual([{ course: key("CS 3386"), from: plan.terms[0]!.id, to: plan.terms[1]!.id }]);
    expect(moveTitles(found).some((title) => title.includes("Fall 2027"))).toBe(false);
    const singles = found.filter((item) => item.moves.length === 1);
    expect(moveTitles(singles)).toEqual(["Move CS 3386 to Spring 2027", "Move CS 3386 to Spring 2028"]);
    expect(found[0]?.reasons[0]).toBe("Offered every spring");
    expect(found[0]?.reasons.at(-1)).toBe("Spring 2027 would have 8 credits");
    expect(found[0]?.addsSemester).toBeNull();
  });

  it("aCourseNeverTaughtAnywhereHasNoSuggestions", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, [])]);
    expect(moveSuggestions(plan, ["CS 3386"], reorderHistory({}))).toEqual([]);
  });

  it("unknownHistoryIsAllowedButRankedLower", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 9001", "CS 3386"]), reorderSemester("spring", 2027, [])]);
    const history = reorderHistory({ "CS 3386": reorderSpring }, ["CS 3386"]);
    const found = moveSuggestions(plan, ["CS 9001", "CS 3386"], history);
    expect(moveTitles(found)).toEqual(["Move CS 3386 to Spring 2027", "Move CS 9001 to Spring 2027"]);
    expect(found).toHaveLength(2);
    expect(found[1]?.reasons[0]).toBe("Offering history unknown");
    expect(found[0]?.reasons[0]).toBe("Offered every spring");
  });

  it("aCourseNeedsItsPrerequisitesBeforeTheSemester", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386"]),
      reorderSemester("spring", 2027, ["CS 2386"]),
      reorderSemester("fall", 2027, []),
      reorderSemester("spring", 2028, []),
    ]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 2386": [...reorderFall, ...reorderSpring] });
    const found = moveSuggestions(plan, ["CS 3386"], history, { prerequisites: needs({ "CS 3386": requisite("CS 2386") }) });
    const singles = found.filter((item) => item.moves.length === 1);
    expect(moveTitles(singles)).toEqual(["Move CS 3386 to Spring 2028"]);
    expect(singles[0]?.reasons.includes("Prerequisites met by then")).toBe(true);
    expect(moveTitles(found).includes("Move CS 3386 to Spring 2027 and CS 2386 to Fall 2026")).toBe(true);
  });

  it("nothingThatNeedsACourseMayBePlannedAtOrBeforeItsNewSemester", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386"]),
      reorderSemester("spring", 2027, []),
      reorderSemester("fall", 2027, []),
      reorderSemester("spring", 2028, ["CS 4500"]),
    ]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 4500": reorderSpring });
    const prerequisites = needs({ "CS 4500": requisite("CS 3386") });
    const found = moveSuggestions(plan, ["CS 3386"], history, { prerequisites });
    expect(moveTitles(found)).toEqual(["Move CS 3386 to Spring 2027"]);
    const tight = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386"]),
      reorderSemester("spring", 2027, ["CS 4500"]),
      reorderSemester("fall", 2027, []),
      reorderSemester("spring", 2028, []),
    ]);
    expect(moveSuggestions(tight, ["CS 3386"], history, { prerequisites })).toEqual([]);
  });

  it("equivalentCoursesCountForPrerequisites", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, [])], ["CS 2510"]);
    const history = reorderHistory({ "CS 3386": reorderSpring });
    const prerequisites = needs({ "CS 3386": requisite("CS 2100") });
    expect(moveSuggestions(plan, ["CS 3386"], history, { prerequisites })).toEqual([]);
    const renumbered = CourseEquivalences.fromPairs([[key("CS 2100"), key("CS 2510")]]);
    const found = moveSuggestions(plan, ["CS 3386"], history, { prerequisites, equivalences: renumbered });
    expect(moveTitles(found)).toEqual(["Move CS 3386 to Spring 2027"]);
    expect(found[0]?.reasons.includes("Prerequisites still met")).toBe(true);
    const declared = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, [])], ["CS 2510"]);
    declareEquivalence(declared, key("CS 2510"), key("CS 2100"));
    expect(moveSuggestions(declared, ["CS 3386"], history, { prerequisites })).toHaveLength(1);
  });

  it("unknownPrerequisitesAreAllowedButRankedLower", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386", "CS 3387"]), reorderSemester("spring", 2027, [])]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 3387": reorderSpring });
    const prerequisites: PrerequisiteLookup = (course) => (keyId(course) === "CS 3386" ? undefined : null);
    const found = moveSuggestions(plan, ["CS 3386", "CS 3387"], history, { prerequisites });
    expect(moveTitles(found)).toEqual(["Move CS 3387 to Spring 2027", "Move CS 3386 to Spring 2027"]);
    expect(found).toHaveLength(2);
    expect(found[1]?.reasons.includes("Prerequisites couldn\u2019t be checked")).toBe(true);
  });

  it("aSemesterStaysUnderTheCreditLimit", () => {
    const full = ["CS 4100", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386"]),
      reorderSemester("spring", 2027, full),
      reorderSemester("fall", 2027, []),
      reorderSemester("spring", 2028, []),
    ]);
    const history = reorderHistory({ ...{ "CS 3386": reorderSpring }, ...taught(full, [...reorderFall, ...reorderSpring]) });
    const found = moveSuggestions(plan, ["CS 3386"], history);
    expect(moveTitles(found.filter((item) => item.moves.length === 1))).toEqual(["Move CS 3386 to Spring 2028"]);
    const relaxed = moveSuggestions(plan, ["CS 3386"], history, { maxCredits: 24 });
    expect(moveTitles(relaxed.filter((item) => item.moves.length === 1))[0]).toBe("Move CS 3386 to Spring 2027");
    expect(relaxed[0]?.reasons.at(-1)).toBe("Spring 2027 would have 24 credits");
  });

  it("swapsTradeACourseThatIsTaughtNow", () => {
    const full = ["CS 3800", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, full)]);
    const history = reorderHistory({
      "CS 3386": reorderSpring,
      "CS 3800": [...reorderFall, ...reorderSpring],
      ...taught(full.slice(1), reorderSpring),
    });
    const found = moveSuggestions(plan, ["CS 3386"], history);
    expect(moveTitles(found)).toEqual(["Move CS 3386 to Spring 2027 and CS 3800 to Fall 2026"]);
    const swap = found[0];
    expect(swap).toBeTruthy();
    if (!swap) return;
    expect(swap.moves).toEqual([
      { course: key("CS 3386"), from: plan.terms[0]!.id, to: plan.terms[1]!.id },
      { course: key("CS 3800"), from: plan.terms[1]!.id, to: plan.terms[0]!.id },
    ]);
    expect(swap.reasons.includes("CS 3386: offered every spring")).toBe(true);
    expect(swap.reasons.includes("CS 3800: offered every fall")).toBe(true);
    expect(swap.reasons.includes("Fall 2026 would have 4 credits")).toBe(true);
    expect(swap.reasons.includes("Spring 2027 would have 20 credits")).toBe(true);
  });

  it("swapsRankAfterSingleMoves", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386", "CS 3800"]),
      reorderSemester("spring", 2027, ["CS 4100"]),
      reorderSemester("spring", 2028, []),
    ]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 3800": reorderFall, "CS 4100": [...reorderFall, ...reorderSpring] });
    const found = moveSuggestions(plan, ["CS 3386"], history);
    expect(moveTitles(found)).toEqual([
      "Move CS 3386 to Spring 2027",
      "Move CS 3386 to Spring 2028",
      "Move CS 3386 to Spring 2027 and CS 4100 to Fall 2026",
    ]);
    expect(found.map((item) => item.moves.length)).toEqual([1, 1, 2]);
  });

  it("swapPartnersMustBeTaughtInTheSemesterTheyMoveTo", () => {
    const full = ["CS 4100", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, full)]);
    const history = reorderHistory({ "CS 3386": reorderSpring, ...taught(full, reorderSpring) });
    expect(moveSuggestions(plan, ["CS 3386"], history).filter((item) => item.moves.length === 2)).toEqual([]);
  });

  it("swapPartnersKeepTheirOwnPrerequisites", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, ["CS 3800", "CS 3700"])]);
    const history = reorderHistory({
      "CS 3386": reorderSpring,
      "CS 3800": [...reorderFall, ...reorderSpring],
      "CS 3700": [...reorderFall, ...reorderSpring],
    });
    const found = moveSuggestions(plan, ["CS 3386"], history, {
      prerequisites: needs({ "CS 3800": requisite("CS 3700") }),
      maxCredits: 8,
    });
    expect(moveTitles(found)).toEqual(["Move CS 3386 to Spring 2027 and CS 3700 to Fall 2026"]);
  });

  it("aSemesterIsAddedWhenNoExistingOneWorks", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("fall", 2027, ["CS 3800"])]);
    const history = reorderHistory({ "CS 3386": reorderSpring, "CS 3800": reorderFall });
    const found = moveSuggestions(plan, ["CS 3386"], history);
    expect(found).toHaveLength(1);
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) return;
    expect(suggestion.addsSemester?.season).toBe("spring");
    expect(suggestion.addsSemester?.year).toBe(2028);
    expect(suggestion.title).toBe("Move CS 3386 to a new Spring 2028 semester");
    expect(suggestion.moves).toEqual([{ course: key("CS 3386"), from: plan.terms[0]!.id, to: suggestion.addsSemester?.id }]);
    expect(suggestion.reasons.at(-1)).toBe("Adds Spring 2028 to your plan, with 4 credits");
    const again = moveSuggestions(plan, ["CS 3386"], history);
    expect(again[0]?.id).toBe(suggestion.id);
    expect(again[0]?.addsSemester?.id).toBe(suggestion.addsSemester?.id);
  });

  it("theAddedSemesterIsInASeasonTheCourseIsTaughtIn", () => {
    const plan = reorderPlan([reorderSemester("spring", 2027, ["CS 3800"])]);
    const found = moveSuggestions(plan, ["CS 3800"], reorderHistory({ "CS 3800": reorderFall }));
    expect(found[0]?.addsSemester?.season).toBe("fall");
    expect(found[0]?.addsSemester?.year).toBe(2027);
  });

  it("applyingAMoveChangesThePlan", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386", "CS 3800"]),
      reorderSemester("spring", 2027, ["CS 4100"]),
      reorderSemester("spring", 2028, []),
    ]);
    const found = moveSuggestions(plan, ["CS 3386"], reorderHistory({
      "CS 3386": reorderSpring,
      "CS 3800": reorderFall,
      "CS 4100": [...reorderFall, ...reorderSpring],
    }));
    const move = found[0];
    expect(move).toBeTruthy();
    if (!move) return;
    const moved = plan.terms[0]!.courses[0];
    applyReorderSuggestion(move, plan);
    expect(plan.terms[0]!.courses.map((course) => course.label)).toEqual(["CS 3800"]);
    expect(plan.terms[1]!.courses.map((course) => course.label)).toEqual(["CS 4100", "CS 3386"]);
    expect(plan.terms[1]!.courses.at(-1)?.id).toBe(moved?.id);
    expect(plan.terms).toHaveLength(3);
    const before = JSON.stringify(plan);
    applyReorderSuggestion(move, plan);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("applyingASwapMovesBothCourses", () => {
    const full = ["CS 3800", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, full)]);
    const found = moveSuggestions(plan, ["CS 3386"], reorderHistory({
      "CS 3386": reorderSpring,
      "CS 3800": [...reorderFall, ...reorderSpring],
      ...taught(full.slice(1), reorderSpring),
    }));
    const swap = found[0];
    expect(swap).toBeTruthy();
    if (!swap) return;
    applyReorderSuggestion(swap, plan);
    expect(plan.terms[0]!.courses.map((course) => course.label)).toEqual(["CS 3800"]);
    expect(plan.terms[1]!.courses.map((course) => course.label)).toEqual(["CS 4200", "CS 4300", "CS 4400", "CS 4500", "CS 3386"]);
  });

  it("applyingAddsTheNewSemester", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386", "CS 3800"]), reorderSemester("fall", 2027, [])]);
    const originalTerms = plan.terms.map((term) => ({ ...term, courses: [...term.courses] }));
    const found = moveSuggestions(plan, ["CS 3386"], reorderHistory({ "CS 3386": reorderSpring, "CS 3800": reorderFall }));
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) return;
    applyReorderSuggestion(suggestion, plan);
    expect(plan.terms.map((term) => `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`)).toEqual(["Fall 2026", "Fall 2027", "Spring 2028"]);
    expect(plan.terms.at(-1)?.courses.map((course) => course.label)).toEqual(["CS 3386"]);
    expect(plan.terms[0]!.courses.map((course) => course.label)).toEqual(["CS 3800"]);

    const other = emptyPlan();
    other.completed = [];
    other.terms = originalTerms.map((term) => ({ ...term, courses: term.courses.map((course) => ({ ...course })) }));
    other.terms.push(reorderSemester("spring", 2028, ["CS 4100"]));
    applyReorderSuggestion(suggestion, other);
    expect(other.terms).toHaveLength(3);
    expect(other.terms.at(-1)?.courses.map((course) => course.label)).toEqual(["CS 4100", "CS 3386"]);
  });

  it("staleOrUnknownRequestsAreIgnored", () => {
    const plan = reorderPlan([reorderSemester("fall", 2026, ["CS 3386"]), reorderSemester("spring", 2027, [])]);
    const history = reorderHistory({ "CS 3386": reorderSpring });
    expect(reorderSuggestions({
      plan,
      termID: "not-a-semester",
      blocking: [key("CS 3386")],
      history,
      prerequisites: () => null,
      equivalences: CourseEquivalences.none(),
    })).toEqual([]);
    expect(moveSuggestions(plan, ["CS 1234"], history)).toEqual([]);
    expect(moveSuggestions(plan, [], history)).toEqual([]);
  });

  it("atMostAFewSuggestionsAreReturned", () => {
    const plan = reorderPlan([
      reorderSemester("fall", 2026, ["CS 3386"]),
      reorderSemester("spring", 2027, []),
      reorderSemester("spring", 2028, []),
      reorderSemester("spring", 2029, []),
      reorderSemester("spring", 2030, []),
      reorderSemester("spring", 2031, []),
      reorderSemester("spring", 2032, []),
    ]);
    const found = moveSuggestions(plan, ["CS 3386"], reorderHistory({ "CS 3386": reorderSpring }));
    expect(found).toHaveLength(5);
    expect(moveTitles(found)[0]).toBe("Move CS 3386 to Spring 2027");
  });
});
