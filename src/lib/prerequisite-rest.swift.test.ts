import { describe, expect, it } from "vitest";
import { parseTitle, titleSimilarity } from "@/lib/degree/title-matcher";
import {
  declareEquivalence,
  equivalenceSuggestions,
  suggestionConfidence,
  suggestionEvidence,
  suggestionId,
  suggestionIsListedTogether,
  type EquivalenceSuggestion,
  type PrerequisiteListing,
} from "@/lib/degree/suggestions";
import {
  MAX_REORDER_SUGGESTIONS,
  OfferingHistory,
  applyReorderSuggestion,
  reorderSuggestions,
  type ReorderSuggestion,
} from "@/lib/degree/reordering";
import { CourseEquivalences } from "@/lib/equivalences";
import { keyId, parseCourseKey, reqAnd, reqCourse, reqOr, sameKey, type CourseKey, type Requisite } from "@/lib/models";
import {
  PLAN_SEASON_EXPORT,
  sortPlanTerms,
  type DegreePlan,
  type DegreePlanCourse,
  type DegreePlanTerm,
  type PlanSeason,
} from "@/lib/requirements";

function key(code: string): CourseKey {
  const parsed = parseCourseKey(code);
  if (!parsed) throw new Error(code);
  return parsed;
}

function requisite(code: string): Requisite {
  return reqCourse(key(code));
}

function either(...codes: string[]): Requisite {
  return reqOr(codes.map(requisite));
}

function sortedWords(title: string): string[] {
  return [...parseTitle(title).words].sort();
}

function sortedParts(title: string): string[] {
  return [...parseTitle(title).parts].sort();
}

describe("CourseTitleMatcherTests", () => {
  function similarity(a: string, b: string): number | null {
    return titleSimilarity(a, b);
  }

  it("titlesAreReducedToTheirTellingWords", () => {
    expect(sortedWords("Principles of Human-Computer Interaction")).toEqual(["computer", "human", "interaction"]);
    expect(sortedWords("PRNCPLES of Human Computer Interaction")).toEqual(["computer", "human", "interaction"]);
    expect(sortedWords("Intr to Data Structures & Algorithms")).toEqual(["algorithm", "data", "structure"]);
    expect(sortedWords("Introduction to Women\u2019s Studies")).toEqual(["study", "women"]);
    expect(sortedWords("Fundamentals of Software Engineering")).toEqual(["engineering", "software"]);
    expect(sortedParts("Fundamentals of Computer Science 2")).toEqual(["2"]);
    const second = parseTitle("Computer Science II");
    expect(sortedParts("Computer Science II").join(",") === "2" && [...second.words].sort().join(",") === "computer,science").toBe(true);
    expect(parseTitle("Topics").words.size).toBe(0);
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
    expect(Math.abs((studio ?? 0) - 0.75) < 0.0001).toBe(true);
    const theory = similarity("Machine Learning", "Machine Learning Theory");
    expect(theory).not.toBeNull();
    expect(Math.abs((theory ?? 0) - 2 / 3) < 0.0001).toBe(true);
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
    expect([...parseTitle("Lab for Computer Systems").qualifiers].sort()).toEqual(["lab"]);
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
    expect(!parseTitle("Seminar").isDistinctive && !parseTitle("Directed Study").isDistinctive && parseTitle("Machine Learning").isDistinctive).toBe(true);
    expect(similarity("Machine Learning", "Machine Learning")).toBe(1);
    expect(similarity("Seminar in Human Computer Interaction", "Human Computer Interaction")).toBe(0.75);
  });

  it("cutOffAuditTitlesStillMatch", () => {
    expect(similarity("Fundamentals of Software Engin", "Fundamentals of Software Engineering")).toBe(1);
    expect(similarity("Fundamentals of Software Engineering", "Fundamentals of Software Engin")).toBe(1);
    const cut = similarity("Principles of Human-Computer I", "Human Computer Interaction");
    expect(cut != null && (cut ?? 0) > 0.66).toBe(true);
    expect(similarity("Fundamentals of Software Engin", "Fundamentals of Software Testing")).toBeNull();
    expect(parseTitle("Fundamentals of Software Engin").cutOffWord).toBe("engin");
    expect(parseTitle("Software Engineering").cutOffWord).toBeNull();
  });
});

describe("EquivalenceSuggesterTests", () => {
  function prerequisites(items: [string, Requisite][]): PrerequisiteListing[] {
    return items.map(([code, requisiteTree]) => ({ course: key(code), requisite: requisiteTree }));
  }

  const catalog = prerequisites([
    ["CS 3000", reqAnd([either("CS 2100", "CS 2510", "DS 2500"), either("CS 1800", "MATH 1365")])],
    ["CS 3200", either("CS 2100", "CS 2510")],
    ["CS 3386", reqAnd([reqOr([reqOr([requisite("CS 2100"), requisite("CS 201M")]), requisite("CS 2510")]), either("CS 2386", "CS 3540")])],
    ["CS 4100", requisite("CS 2510")],
    ["CS 4200", reqAnd([requisite("CS 2510"), requisite("MATH 1365")])],
    ["ANTH 2000", either("ANTH 1101", "POLS 1160")],
  ]);

  const current = new Set(["CS 2100", "DS 2500", "CS 3000", "ANTH 1101"]);

  const titles: Record<string, string> = {
    [keyId(key("IS 4300"))]: "Human Computer Interaction",
    [keyId(key("CS 2484"))]: "Principles of Human-Computer Interaction",
    [keyId(key("CS 3000"))]: "Algorithms and Data",
    [keyId(key("CS 3650"))]: "Computer Systems",
    [keyId(key("CS 2510"))]: "Fundamentals of Computer Science 2",
    [keyId(key("CS 2515"))]: "Computer Science 2 Honors",
    [keyId(key("CS 2100"))]: "Program Design and Implementation 1",
    [keyId(key("CS 4550"))]: "Web Development",
  };

  function byTitle(
    retired: string,
    candidates: string[],
    options?: {
      titles?: Record<string, string>;
      prerequisites?: PrerequisiteListing[];
      isCurrent?: (course: CourseKey) => boolean;
      known?: CourseEquivalences;
      limit?: number;
    },
  ): EquivalenceSuggestion[] {
    const table = options?.titles ?? titles;
    return equivalenceSuggestions({
      retired: key(retired),
      prerequisites: options?.prerequisites ?? [],
      isCurrent: options?.isCurrent ?? (() => true),
      known: options?.known,
      limit: options?.limit,
      title: (course) => table[keyId(course)],
      titleCandidates: candidates.map((code) => key(code)),
    });
  }

  it("suggestsTheCurrentCoursesListedBesideTheRetiredOne", () => {
    const found = equivalenceSuggestions({
      retired: key("CS 2510"),
      prerequisites: catalog,
      isCurrent: (course) => current.has(keyId(course)),
    });
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2100")]);
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) throw new Error("missing suggestion");
    expect(sameKey(suggestion.course, key("CS 2510"))).toBe(true);
    expect(suggestion.together === 3 && suggestion.total === 5).toBe(true);
    expect(suggestionConfidence(suggestion)).toBe(0.6);
    expect(suggestionEvidence(suggestion)).toBe("Listed together in 3 of the 5 prerequisites that name CS 2510");
    expect(suggestionId(suggestion)).toBe("CS 2510|CS 2100");
  });

  it("thresholdsAndLimitsApply", () => {
    const wide = equivalenceSuggestions({
      retired: key("CS 2510"),
      prerequisites: catalog,
      isCurrent: (course) => current.has(keyId(course)),
      minimumTogether: 1,
      minimumShare: 0.2,
    });
    expect(wide.map((item) => item.candidate)).toEqual([key("CS 2100"), key("DS 2500")]);
    expect(
      equivalenceSuggestions({
        retired: key("CS 2510"),
        prerequisites: catalog,
        isCurrent: (course) => current.has(keyId(course)),
        minimumTogether: 1,
        minimumShare: 0.2,
        limit: 1,
      }).map((item) => item.candidate),
    ).toEqual([key("CS 2100")]);
    expect(
      equivalenceSuggestions({
        retired: key("CS 2510"),
        prerequisites: catalog,
        isCurrent: (course) => current.has(keyId(course)),
        minimumShare: 0.8,
      }),
    ).toEqual([]);
  });

  it("leavesOutWhatIsKnownOrNotCurrent", () => {
    const known = CourseEquivalences.fromPairs([[key("CS 2510"), key("CS 2100")]]);
    expect(
      equivalenceSuggestions({
        retired: key("CS 2510"),
        prerequisites: catalog,
        isCurrent: (course) => current.has(keyId(course)),
        known,
      }),
    ).toEqual([]);
    expect(equivalenceSuggestions({ retired: key("CS 2510"), prerequisites: catalog, isCurrent: () => false })).toEqual([]);
    expect(equivalenceSuggestions({ retired: key("CS 9999"), prerequisites: catalog, isCurrent: () => true })).toEqual([]);
    expect(equivalenceSuggestions({ retired: key("CS 4100"), prerequisites: catalog, isCurrent: () => true })).toEqual([]);
    const own = prerequisites([["CS 2510", either("CS 2510", "CS 2100")]]);
    expect(equivalenceSuggestions({ retired: key("CS 2510"), prerequisites: own, isCurrent: () => true })).toEqual([]);
  });

  it("aSingleDependentReadsNaturally", () => {
    const one = prerequisites([
      ["CS 3000", either("CS 2100", "CS 2510")],
      ["CS 3001", either("CS 2100", "CS 2510")],
    ]);
    const found = equivalenceSuggestions({ retired: key("CS 2510"), prerequisites: one, isCurrent: () => true });
    expect(found[0] ? suggestionEvidence(found[0]) : undefined).toBe("Listed together in 2 of the 2 prerequisites that name CS 2510");
    const lone: EquivalenceSuggestion = { course: key("CS 2510"), candidate: key("CS 2100"), together: 1, total: 1 };
    expect(suggestionEvidence(lone)).toBe("Listed together in the prerequisites of the 1 course that names CS 2510");
  });

  it("suggestsAStudentCourseWithASimilarTitle", () => {
    const found = byTitle("IS 4300", ["CS 3000", "CS 2484", "CS 3650", "CS 2510"]);
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484")]);
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) throw new Error("missing suggestion");
    expect(sameKey(suggestion.course, key("IS 4300"))).toBe(true);
    expect(suggestion.together === 0 && suggestion.total === 0 && !suggestionIsListedTogether(suggestion) && suggestionConfidence(suggestion) === 0).toBe(true);
    expect(suggestion.similarTitle === "Principles of Human-Computer Interaction" && suggestion.titleScore === 1).toBe(true);
    expect(suggestionEvidence(suggestion)).toBe("Similar title: Principles of Human-Computer Interaction");
    expect(suggestionId(suggestion)).toBe("IS 4300|CS 2484");
  });

  it("aTrueNegativeIsNotSuggested", () => {
    expect(byTitle("IS 4300", ["CS 3650", "CS 3000", "CS 4550"])).toEqual([]);
  });

  it("genericTitlesGiveNoTitleEvidence", () => {
    function suggestions(retiredTitle: string, candidateTitle: string): EquivalenceSuggestion[] {
      return byTitle("IS 4300", ["CS 3000"], {
        titles: { [keyId(key("IS 4300"))]: retiredTitle, [keyId(key("CS 3000"))]: candidateTitle },
      });
    }
    for (const generic of ["Seminar", "Special Topics", "Directed Study", "Topics", "Introduction to", ""]) {
      expect(suggestions(generic, generic)).toEqual([]);
      expect(suggestions(generic, "Human Computer Interaction")).toEqual([]);
      expect(suggestions("Human Computer Interaction", generic)).toEqual([]);
    }
    expect(byTitle("IS 4300", ["CS 3000"], { titles: { [keyId(key("CS 3000"))]: "Human Computer Interaction" } })).toEqual([]);
    expect(byTitle("IS 4300", ["CS 3000"], { titles: { [keyId(key("IS 4300"))]: "Human Computer Interaction" } })).toEqual([]);
    expect(
      byTitle("CS 2510", ["CS 2501"], {
        titles: {
          [keyId(key("CS 2510"))]: "Fundamentals of Computer Science 2",
          [keyId(key("CS 2501"))]: "Fundamentals of Computer Science 1",
        },
      }),
    ).toEqual([]);
  });

  it("leavesOutTheRetiredCourseAndWhatIsKnown", () => {
    expect(byTitle("IS 4300", ["IS 4300"])).toEqual([]);
    const known = CourseEquivalences.fromPairs([[key("IS 4300"), key("CS 2484")]]);
    expect(byTitle("IS 4300", ["CS 2484"], { known })).toEqual([]);
    const chain = CourseEquivalences.fromPairs([
      [key("IS 4300"), key("CS 9000")],
      [key("CS 9000"), key("CS 2484")],
    ]);
    expect(byTitle("IS 4300", ["CS 2484"], { known: chain })).toEqual([]);
  });

  it("titleCandidatesNeedNotBeCurrent", () => {
    expect(byTitle("IS 4300", ["CS 2484"], { isCurrent: () => false }).map((item) => item.candidate)).toEqual([key("CS 2484")]);
  });

  it("titleSuggestionsAreRankedByHowAlikeTheTitlesAre", () => {
    const table = {
      ...titles,
      [keyId(key("CS 5100"))]: "Human Computer Interaction Methods and Practice",
      [keyId(key("CS 5200"))]: "Human-Computer Interaction Studio",
    };
    const found = byTitle("IS 4300", ["CS 5100", "CS 2484", "CS 5200"], { titles: table });
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484"), key("CS 5200"), key("CS 5100")]);
    expect(found.map((item) => item.titleScore)).toEqual([1, 0.75, 0.6]);
  });

  it("titlesRankBelowListedTogetherAndBothKindsAreReturned", () => {
    const listed = prerequisites([
      ["CS 4520", either("IS 4300", "CS 2484", "CS 4550")],
      ["CS 4540", either("IS 4300", "CS 2484", "CS 4550")],
      ["CS 4600", requisite("IS 4300")],
    ]);
    const table = { ...titles, [keyId(key("CS 5100"))]: "Human Computer Interaction Studio" };
    const found = byTitle("IS 4300", ["CS 5100", "CS 2484"], { titles: table, prerequisites: listed });
    expect(found.map((item) => item.candidate)).toEqual([key("CS 2484"), key("CS 4550"), key("CS 5100")]);
    const both = found[0];
    expect(both).toBeTruthy();
    if (!both) throw new Error("missing suggestion");
    expect(both.together === 2 && both.total === 3 && suggestionIsListedTogether(both)).toBe(true);
    expect(both.similarTitle === "Principles of Human-Computer Interaction" && both.titleScore === 1).toBe(true);
    expect(suggestionEvidence(both)).toBe("Listed together in 2 of the 3 prerequisites that name IS 4300 \u00b7 similar title");
    expect(found[1]?.similarTitle == null && (found[1] ? suggestionEvidence(found[1]) : "") === "Listed together in 2 of the 3 prerequisites that name IS 4300").toBe(true);
    expect(found[2]?.together === 0 && found[2]?.total === 3 && (found[2] ? suggestionEvidence(found[2]) : "") === "Similar title: Human Computer Interaction Studio").toBe(true);
  });

  it("aTitleSuggestionKeepsAPlaceWhenThePrerequisitesWouldFillTheList", () => {
    const listing: PrerequisiteListing[] = [1, 2, 3, 4].map((number) => ({
      course: key(`CS 40${number}0`),
      requisite: either("IS 4300", "CS 2110", "CS 2210", "CS 2310"),
    }));
    const all = [...listing, { course: key("CS 4500"), requisite: either("IS 4300", "CS 2484") }];
    const found = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 3 });
    expect(found).toHaveLength(3);
    expect(sameKey(found.at(-1)?.candidate ?? key("CS 0"), key("CS 2484")) && found.at(-1)?.together === 0).toBe(true);
    expect(found.slice(0, -1).every((item) => suggestionIsListedTogether(item))).toBe(true);
    const one = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 1 });
    expect(one.length === 1 && (one[0] ? suggestionIsListedTogether(one[0]) : false)).toBe(true);
    const two = byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 2 });
    expect(two.map((item) => suggestionIsListedTogether(item))).toEqual([true, false]);
    expect(byTitle("IS 4300", ["CS 2484"], { prerequisites: all, limit: 0 })).toEqual([]);
  });
});

const allTerms = ["202710", "202650", "202630", "202610", "202550", "202530", "202510"];

function history(offered: Record<string, string[]>, options?: { checked?: string[]; keys?: string[] }): OfferingHistory {
  return new OfferingHistory({
    checkedTerms: options?.checked ?? allTerms,
    offered: Object.entries(offered).map(([code, terms]) => ({ key: key(code), terms })),
    checkedKeys: options?.keys ? options.keys.map((code) => key(code)) : null,
  });
}

function termSet(record: OfferingHistory, code: string): Set<string> {
  return new Set(record.offeredTermSet(key(code)));
}

describe("OfferingHistoryTests", () => {
  it("seasonsAndLikelyOfferings", () => {
    const record = history({
      "CS 3386": ["202630", "202530"],
      "CS 3800": ["202710", "202610", "202510"],
      "CS 2500": ["202650", "202550"],
    });
    expect(new Set(record.seasons(key("CS 3386")))).toEqual(new Set(["spring"]));
    expect(new Set(record.seasons(key("CS 2500")))).toEqual(new Set(["summerFull"]));
    expect(record.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(record.isLikelyOffered(key("CS 3386"), "fall")).toBe(false);
    expect(record.isLikelyOffered(key("CS 2500"), "summerA")).toBe(true);
    expect(record.isLikelyOffered(key("CS 2500"), "summerB")).toBe(true);
    expect(record.isLikelyOffered(key("CS 3386"), "summerA")).toBe(false);
    expect(record.isLikelyOffered(key("CS 3386"), "winter")).toBeNull();
    expect(record.isLikelyOffered(key("CS 9999"), "spring")).toBe(false);
  });

  it("unknownWhenNothingWasChecked", () => {
    expect(OfferingHistory.empty().isLikelyOffered(key("CS 3386"), "spring")).toBeNull();
    expect(OfferingHistory.empty().summary(key("CS 3386"))).toBe("Offering history unknown");
    const partial = history({ "CS 3386": ["202630"] }, { keys: ["CS 3386"] });
    expect(partial.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(partial.isLikelyOffered(key("CS 3800"), "spring")).toBeNull();
    expect(partial.summary(key("CS 3800"))).toBe("Offering history unknown");
    expect(partial.summaryIn(key("CS 3800"), "spring")).toBe("Offering history unknown");
  });

  it("summaries", () => {
    const record = history({
      "CS 3386": ["202630", "202530"],
      "CS 3800": ["202710", "202610", "202510", "202630", "202530"],
      "CS 4100": ["202530"],
      "CS 2500": ["202650", "202550"],
      "CS 2510": ["202650", "202630"],
    });
    expect(record.summary(key("CS 3386"))).toBe("Offered every spring");
    expect(record.summary(key("CS 3800"))).toBe("Offered every fall and spring");
    expect(record.summary(key("CS 4100"))).toBe("Last offered Spring 2025");
    expect(record.summary(key("CS 2500"))).toBe("Offered every summer");
    expect(record.summary(key("CS 2510"))).toBe("Last offered Summer 2026");
    expect(record.summary(key("CS 9999"))).toBe("Not offered in the last 2 years");

    const mixed = history({ "CS 3800": ["202710", "202610", "202510", "202630"] });
    expect(mixed.summary(key("CS 3800"))).toBe("Offered every fall, and sometimes in the spring");
    expect(history({ "CS 3800": ["202710", "202610", "202510", "202630", "202550"] }).summary(key("CS 3800"))).toBe(
      "Offered every fall, and sometimes in the spring and summer",
    );

    expect(record.summaryIn(key("CS 3386"), "spring")).toBe("Offered every spring");
    expect(record.summaryIn(key("CS 4100"), "spring")).toBe("Offered in Spring 2025");
    expect(record.summaryIn(key("CS 3386"), "fall")).toBe("Not offered in a fall term in the last 2 years");
    expect(record.summaryIn(key("CS 2500"), "summerA")).toBe("Offered every summer");
  });

  it("historiesMergeAndRoundTrip", () => {
    const first = history({ "CS 3386": ["202630"] }, { checked: ["202710", "202630"], keys: ["CS 3386"] });
    const second = history({ "CS 3800": ["202710"] }, { checked: ["202710", "202610"], keys: ["CS 3800"] });
    const merged = first.merging(second);
    expect(merged.checkedTerms).toEqual(["202710", "202630", "202610"]);
    expect(termSet(merged, "CS 3386")).toEqual(new Set(["202630"]));
    expect(termSet(merged, "CS 3800")).toEqual(new Set(["202710"]));
    expect(new Set(merged.checkedKeys()?.map((item) => keyId(item)))).toEqual(new Set(["CS 3386", "CS 3800"]));
    expect(first.merging(history({})).checkedKeys()).toBeNull();

    for (const original of [merged, history({ "CS 3386": ["202630", "202530"] }), OfferingHistory.empty()]) {
      const decoded = OfferingHistory.fromJSON(JSON.parse(JSON.stringify(original.toJSON())) as ReturnType<OfferingHistory["toJSON"]>);
      expect(decoded.toJSON()).toEqual(original.toJSON());
    }
  });
});

const fall = ["202710", "202610", "202510"];
const spring = ["202630", "202530"];

let courseN = 0;
function planned(code: string, credits = 4, title = code): DegreePlanCourse {
  courseN += 1;
  return { id: `c${courseN}`, key: key(code), label: code, title, credits };
}

function emptyPlan(): DegreePlan {
  return {
    id: "plan",
    name: "Plan",
    completed: [],
    terms: [],
    isPrimary: false,
    createdAt: 0,
    updatedAt: 0,
    substitutions: [],
    courseEquivalences: [],
  };
}

function semester(season: PlanSeason, year: number, codes: string[], credits = 4): DegreePlanTerm {
  return { id: `${season}-${year}`, season, year, courses: codes.map((code) => planned(code, credits)) };
}

function plan(terms: DegreePlanTerm[], completed: string[] = []): DegreePlan {
  const result = emptyPlan();
  result.completed = completed.map((code) => planned(code));
  result.terms = terms;
  return result;
}

function taught(codes: string[], terms: string[]): Record<string, string[]> {
  return Object.fromEntries(codes.map((code) => [code, terms]));
}

function and(first: Record<string, string[]>, second: Record<string, string[]>): Record<string, string[]> {
  return { ...first, ...second };
}

function needs(table: Record<string, Requisite>): (course: CourseKey) => Requisite | null {
  return (course) => {
    const id = keyId(course);
    return Object.prototype.hasOwnProperty.call(table, id) ? (table[id] ?? null) : null;
  };
}

function suggestions(
  source: DegreePlan,
  blocking: string[],
  record: OfferingHistory,
  options?: {
    term?: number;
    prerequisites?: (course: CourseKey) => Requisite | null | undefined;
    equivalences?: CourseEquivalences;
    maxCredits?: number;
  },
): ReorderSuggestion[] {
  const sorted = structuredClone(source);
  sortPlanTerms(sorted);
  const term = sorted.terms[options?.term ?? 0];
  if (!term) return [];
  return reorderSuggestions({
    plan: source,
    termID: term.id,
    blocking: blocking.map((code) => key(code)),
    history: record,
    prerequisites: options?.prerequisites ?? (() => null),
    equivalences: options?.equivalences,
    maxCreditsPerTerm: options?.maxCredits,
  });
}

function titles(found: ReorderSuggestion[]): string[] {
  return found.map((item) => item.title);
}

function termName(term: DegreePlanTerm): string {
  return `${PLAN_SEASON_EXPORT[term.season]} ${term.year}`;
}

describe("DegreePlanReorderingTests", () => {
  it("aCourseOnlyMovesToASeasonItIsTaughtIn", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386", "CS 3800"]),
      semester("spring", 2027, ["CS 4100"]),
      semester("fall", 2027, []),
      semester("spring", 2028, []),
    ]);
    const record = history({ "CS 3386": spring, "CS 3800": fall, "CS 4100": [...fall, ...spring] });
    const found = suggestions(degree, ["CS 3386"], record);
    expect(found[0]?.title).toBe("Move CS 3386 to Spring 2027");
    expect(found[0]?.moves).toEqual([{ course: key("CS 3386"), from: degree.terms[0]!.id, to: degree.terms[1]!.id }]);
    expect(titles(found).some((title) => title.includes("Fall 2027"))).toBe(false);
    const singles = found.filter((item) => item.moves.length === 1);
    expect(titles(singles)).toEqual(["Move CS 3386 to Spring 2027", "Move CS 3386 to Spring 2028"]);
    expect(found[0]?.reasons[0]).toBe("Offered every spring");
    expect(found[0]?.reasons.at(-1)).toBe("Spring 2027 would have 8 credits");
    expect(found[0]?.addsSemester).toBeNull();
  });

  it("aCourseNeverTaughtAnywhereHasNoSuggestions", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, [])]);
    expect(suggestions(degree, ["CS 3386"], history({}))).toEqual([]);
  });

  it("unknownHistoryIsAllowedButRankedLower", () => {
    const degree = plan([semester("fall", 2026, ["CS 9001", "CS 3386"]), semester("spring", 2027, [])]);
    const record = history({ "CS 3386": spring }, { keys: ["CS 3386"] });
    const found = suggestions(degree, ["CS 9001", "CS 3386"], record);
    expect(titles(found)).toEqual(["Move CS 3386 to Spring 2027", "Move CS 9001 to Spring 2027"]);
    expect(found).toHaveLength(2);
    expect(found[1]?.reasons[0]).toBe("Offering history unknown");
    expect(found[0]?.reasons[0]).toBe("Offered every spring");
  });

  it("aCourseNeedsItsPrerequisitesBeforeTheSemester", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386"]),
      semester("spring", 2027, ["CS 2386"]),
      semester("fall", 2027, []),
      semester("spring", 2028, []),
    ]);
    const record = history({ "CS 3386": spring, "CS 2386": [...fall, ...spring] });
    const found = suggestions(degree, ["CS 3386"], record, { prerequisites: needs({ "CS 3386": requisite("CS 2386") }) });
    const singles = found.filter((item) => item.moves.length === 1);
    expect(titles(singles)).toEqual(["Move CS 3386 to Spring 2028"]);
    expect(singles[0]?.reasons.includes("Prerequisites met by then")).toBe(true);
    expect(titles(found).includes("Move CS 3386 to Spring 2027 and CS 2386 to Fall 2026")).toBe(true);
  });

  it("nothingThatNeedsACourseMayBePlannedAtOrBeforeItsNewSemester", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386"]),
      semester("spring", 2027, []),
      semester("fall", 2027, []),
      semester("spring", 2028, ["CS 4500"]),
    ]);
    const record = history({ "CS 3386": spring, "CS 4500": spring });
    const found = suggestions(degree, ["CS 3386"], record, { prerequisites: needs({ "CS 4500": requisite("CS 3386") }) });
    expect(titles(found)).toEqual(["Move CS 3386 to Spring 2027"]);

    const tight = plan([
      semester("fall", 2026, ["CS 3386"]),
      semester("spring", 2027, ["CS 4500"]),
      semester("fall", 2027, []),
      semester("spring", 2028, []),
    ]);
    expect(suggestions(tight, ["CS 3386"], record, { prerequisites: needs({ "CS 4500": requisite("CS 3386") }) })).toEqual([]);
  });

  it("equivalentCoursesCountForPrerequisites", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, [])], ["CS 2510"]);
    const record = history({ "CS 3386": spring });
    const prerequisites = needs({ "CS 3386": requisite("CS 2100") });
    expect(suggestions(degree, ["CS 3386"], record, { prerequisites })).toEqual([]);
    const renumbered = CourseEquivalences.fromPairs([[key("CS 2100"), key("CS 2510")]]);
    const found = suggestions(degree, ["CS 3386"], record, { prerequisites, equivalences: renumbered });
    expect(titles(found)).toEqual(["Move CS 3386 to Spring 2027"]);
    expect(found[0]?.reasons.includes("Prerequisites still met")).toBe(true);

    const declared = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, [])], ["CS 2510"]);
    declareEquivalence(declared, key("CS 2510"), key("CS 2100"));
    expect(suggestions(declared, ["CS 3386"], record, { prerequisites })).toHaveLength(1);
  });

  it("unknownPrerequisitesAreAllowedButRankedLower", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386", "CS 3387"]), semester("spring", 2027, [])]);
    const record = history({ "CS 3386": spring, "CS 3387": spring });
    const prerequisites = (course: CourseKey): Requisite | null | undefined => (sameKey(course, key("CS 3386")) ? undefined : null);
    const found = suggestions(degree, ["CS 3386", "CS 3387"], record, { prerequisites });
    expect(titles(found)).toEqual(["Move CS 3387 to Spring 2027", "Move CS 3386 to Spring 2027"]);
    expect(found).toHaveLength(2);
    expect(found[1]?.reasons.includes("Prerequisites couldn\u2019t be checked")).toBe(true);
  });

  it("aSemesterStaysUnderTheCreditLimit", () => {
    const full = ["CS 4100", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const degree = plan([
      semester("fall", 2026, ["CS 3386"]),
      semester("spring", 2027, full),
      semester("fall", 2027, []),
      semester("spring", 2028, []),
    ]);
    const record = history(and({ "CS 3386": spring }, taught(full, [...fall, ...spring])));
    const found = suggestions(degree, ["CS 3386"], record);
    const singles = found.filter((item) => item.moves.length === 1);
    expect(titles(singles)).toEqual(["Move CS 3386 to Spring 2028"]);

    const relaxed = suggestions(degree, ["CS 3386"], record, { maxCredits: 24 });
    expect(titles(relaxed.filter((item) => item.moves.length === 1))[0]).toBe("Move CS 3386 to Spring 2027");
    expect(relaxed[0]?.reasons.at(-1)).toBe("Spring 2027 would have 24 credits");
  });

  it("swapsTradeACourseThatIsTaughtNow", () => {
    const full = ["CS 3800", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, full)]);
    const record = history(and({ "CS 3386": spring, "CS 3800": [...fall, ...spring] }, taught(full.slice(1), spring)));
    const found = suggestions(degree, ["CS 3386"], record);
    expect(titles(found)).toEqual(["Move CS 3386 to Spring 2027 and CS 3800 to Fall 2026"]);
    const swap = found[0];
    expect(swap).toBeTruthy();
    if (!swap) throw new Error("missing suggestion");
    expect(swap.moves).toEqual([
      { course: key("CS 3386"), from: degree.terms[0]!.id, to: degree.terms[1]!.id },
      { course: key("CS 3800"), from: degree.terms[1]!.id, to: degree.terms[0]!.id },
    ]);
    expect(swap.reasons.includes("CS 3386: offered every spring")).toBe(true);
    expect(swap.reasons.includes("CS 3800: offered every fall")).toBe(true);
    expect(swap.reasons.includes("Fall 2026 would have 4 credits")).toBe(true);
    expect(swap.reasons.includes("Spring 2027 would have 20 credits")).toBe(true);
  });

  it("swapsRankAfterSingleMoves", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386", "CS 3800"]),
      semester("spring", 2027, ["CS 4100"]),
      semester("spring", 2028, []),
    ]);
    const record = history({ "CS 3386": spring, "CS 3800": fall, "CS 4100": [...fall, ...spring] });
    const found = suggestions(degree, ["CS 3386"], record);
    expect(titles(found)).toEqual([
      "Move CS 3386 to Spring 2027",
      "Move CS 3386 to Spring 2028",
      "Move CS 3386 to Spring 2027 and CS 4100 to Fall 2026",
    ]);
    expect(found.map((item) => item.moves.length)).toEqual([1, 1, 2]);
  });

  it("swapPartnersMustBeTaughtInTheSemesterTheyMoveTo", () => {
    const full = ["CS 4100", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, full)]);
    const record = history(and({ "CS 3386": spring }, taught(full, spring)));
    expect(suggestions(degree, ["CS 3386"], record).filter((item) => item.moves.length === 2)).toEqual([]);
  });

  it("swapPartnersKeepTheirOwnPrerequisites", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, ["CS 3800", "CS 3700"])]);
    const record = history({ "CS 3386": spring, "CS 3800": [...fall, ...spring], "CS 3700": [...fall, ...spring] });
    const found = suggestions(degree, ["CS 3386"], record, {
      prerequisites: needs({ "CS 3800": requisite("CS 3700") }),
      maxCredits: 8,
    });
    expect(titles(found)).toEqual(["Move CS 3386 to Spring 2027 and CS 3700 to Fall 2026"]);
  });

  it("aSemesterIsAddedWhenNoExistingOneWorks", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("fall", 2027, ["CS 3800"])]);
    const record = history({ "CS 3386": spring, "CS 3800": fall });
    const found = suggestions(degree, ["CS 3386"], record);
    expect(found).toHaveLength(1);
    const suggestion = found[0];
    if (!suggestion) throw new Error("missing suggestion");
    const added = suggestion.addsSemester;
    expect(added?.season === "spring" && added?.year === 2028).toBe(true);
    expect(suggestion.title).toBe("Move CS 3386 to a new Spring 2028 semester");
    expect(suggestion.moves).toEqual([{ course: key("CS 3386"), from: degree.terms[0]!.id, to: added?.id ?? "" }]);
    expect(suggestion.reasons.at(-1)).toBe("Adds Spring 2028 to your plan, with 4 credits");
    const again = suggestions(degree, ["CS 3386"], record);
    expect(again[0]?.id === suggestion.id && again[0]?.addsSemester?.id === added?.id).toBe(true);
  });

  it("theAddedSemesterIsInASeasonTheCourseIsTaughtIn", () => {
    const degree = plan([semester("spring", 2027, ["CS 3800"])]);
    const found = suggestions(degree, ["CS 3800"], history({ "CS 3800": fall }));
    expect(found[0]?.addsSemester?.season === "fall" && found[0]?.addsSemester?.year === 2027).toBe(true);
  });

  it("applyingAMoveChangesThePlan", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386", "CS 3800"]),
      semester("spring", 2027, ["CS 4100"]),
      semester("spring", 2028, []),
    ]);
    const found = suggestions(degree, ["CS 3386"], history({ "CS 3386": spring, "CS 3800": fall, "CS 4100": [...fall, ...spring] }));
    const move = found[0];
    expect(move).toBeTruthy();
    if (!move) throw new Error("missing suggestion");
    const movedId = degree.terms[0]?.courses[0]?.id;
    applyReorderSuggestion(move, degree);
    expect(degree.terms[0]?.courses.map((item) => item.label)).toEqual(["CS 3800"]);
    expect(degree.terms[1]?.courses.map((item) => item.label)).toEqual(["CS 4100", "CS 3386"]);
    expect(degree.terms[1]?.courses.at(-1)?.id).toBe(movedId);
    expect(degree.terms).toHaveLength(3);

    const before = structuredClone(degree);
    applyReorderSuggestion(move, degree);
    expect(degree).toEqual(before);
  });

  it("applyingASwapMovesBothCourses", () => {
    const full = ["CS 3800", "CS 4200", "CS 4300", "CS 4400", "CS 4500"];
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, full)]);
    const found = suggestions(degree, ["CS 3386"], history(and({ "CS 3386": spring, "CS 3800": fall }, taught(full.slice(1), spring))));
    const swap = found[0];
    expect(swap).toBeTruthy();
    if (!swap) throw new Error("missing suggestion");
    applyReorderSuggestion(swap, degree);
    expect(degree.terms[0]?.courses.map((item) => item.label)).toEqual(["CS 3800"]);
    expect(degree.terms[1]?.courses.map((item) => item.label)).toEqual(["CS 4200", "CS 4300", "CS 4400", "CS 4500", "CS 3386"]);
  });

  it("applyingAddsTheNewSemester", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386", "CS 3800"]), semester("fall", 2027, [])]);
    const original = structuredClone(degree);
    const found = suggestions(degree, ["CS 3386"], history({ "CS 3386": spring, "CS 3800": fall }));
    const suggestion = found[0];
    expect(suggestion).toBeTruthy();
    if (!suggestion) throw new Error("missing suggestion");
    applyReorderSuggestion(suggestion, degree);
    expect(degree.terms.map(termName)).toEqual(["Fall 2026", "Fall 2027", "Spring 2028"]);
    expect(degree.terms.at(-1)?.courses.map((item) => item.label)).toEqual(["CS 3386"]);
    expect(degree.terms[0]?.courses.map((item) => item.label)).toEqual(["CS 3800"]);

    const other = structuredClone(original);
    other.terms.push(semester("spring", 2028, ["CS 4100"]));
    applyReorderSuggestion(suggestion, other);
    expect(other.terms).toHaveLength(3);
    expect(other.terms.at(-1)?.courses.map((item) => item.label)).toEqual(["CS 4100", "CS 3386"]);
  });

  it("staleOrUnknownRequestsAreIgnored", () => {
    const degree = plan([semester("fall", 2026, ["CS 3386"]), semester("spring", 2027, [])]);
    const record = history({ "CS 3386": spring });
    const none = (): Requisite | null => null;
    expect(
      reorderSuggestions({
        plan: degree,
        termID: "not-a-semester",
        blocking: [key("CS 3386")],
        history: record,
        prerequisites: none,
        equivalences: CourseEquivalences.none(),
      }),
    ).toEqual([]);
    expect(suggestions(degree, ["CS 1234"], record)).toEqual([]);
    expect(suggestions(degree, [], record)).toEqual([]);
  });

  it("atMostAFewSuggestionsAreReturned", () => {
    const degree = plan([
      semester("fall", 2026, ["CS 3386"]),
      semester("spring", 2027, []),
      semester("spring", 2028, []),
      semester("spring", 2029, []),
      semester("spring", 2030, []),
      semester("spring", 2031, []),
      semester("spring", 2032, []),
    ]);
    const found = suggestions(degree, ["CS 3386"], history({ "CS 3386": spring }));
    expect(found).toHaveLength(MAX_REORDER_SUGGESTIONS);
    expect(titles(found)[0]).toBe("Move CS 3386 to Spring 2027");
  });
});
