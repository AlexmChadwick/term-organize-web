import { describe, expect, it } from "vitest";
import { courseUseName, fewestCreditsChoice, nearMisses, resultFor, ruleCounting, ruleResults, runDegreeAudit, satisfiedCount, totalCount, uncheckedReason } from "@/lib/degree/audit";
import { applyCourseNumberLimit } from "@/lib/degree/audit";
import { archivedEditions, currentEdition, editionURL, parseUniversitywide, programsFromIndex, suggestedPrograms, universitywideLink } from "@/lib/degree/catalog-parser";
import { petitionQuestions } from "@/lib/degree/substitutions";
import { likeRanges } from "@/lib/degree/substitutions";
import { duplicateKeys } from "@/lib/degree-logic";
import type { CourseKey } from "@/lib/models";
import { keyId, sameKey } from "@/lib/models";
import type { CourseNumberLimit, ProgramRequirements, RequirementRule } from "@/lib/requirements";
import {
  allRules,
  catalogYearContaining,
  catalogYearLabel,
  concentrationName,
  estimatedEditions,
  listedCourses,
  parseCatalogYear,
  programLevel,
  programParts,
  rangeContains,
  replacementSummary,
  ruleTitle,
} from "@/lib/requirements";
import { decodeDegreePlan, mergeUserData } from "@/lib/user";
import { course, emptyPlan, key, must, program, requirements, requirementsFrom, samplePlan, sortedKeyIds, substitution, term, year } from "@/lib/degree/swift-fixtures";

function ruleLabeled(req: ProgramRequirements, label: string): RequirementRule {
  return must(allRules(req).find((rule) => rule.label === label), label);
}

function rulePrefixed(req: ProgramRequirements, prefix: string): RequirementRule {
  return must(allRules(req).find((rule) => rule.label.startsWith(prefix)), prefix);
}

function keyIdsOf(uses: { key: CourseKey }[]): string[] {
  return uses.map((use) => keyId(use.key));
}

describe("DegreeRequirementsTests", () => {
  it("parsesRequirementTables", () => {
    const req = requirements();
    expect(req.totalHours).toBe(52);
    expect(req.sections.map((section) => section.title)).toEqual([
      "Major Requirements",
      "Supporting Courses",
      "Required General Electives",
      "Major GPA Requirement",
      "Program Requirement",
      "Concentration in Human-Centered Computing",
      "Software Concentration",
    ]);
    expect(req.sections.filter((section) => section.isConcentration).map((section) => concentrationName(section.title))).toEqual([
      "Human-Centered Computing",
      "Software",
    ]);
    expect(allRules(req).some((rule) => listedCourses(rule).some((item) => sameKey(item, key("CS 9999"))))).toBe(false);

    const major = must(req.sections[0], "major");
    expect(major.groups.map((group) => group.title)).toEqual(["Required Courses", "Security Course", "Khoury Elective Courses"]);
    const required = major.groups[0]!.rules;
    expect(required.map((rule) => rule.label)).toEqual(["CS 1800 and CS 1802", "CS 3000", "CS 4500 or CS 4530"]);
    expect(required[0]!.kind).toEqual({
      type: "required",
      option: { alternatives: [[key("CS 1800"), key("CS 1802")]] },
    });
    expect(required[2]!.hours).toBe(4);

    const security = must(major.groups[1]!.rules[0], "security");
    expect(security.kind.type).toBe("choose");
    if (security.kind.type === "choose") {
      expect(security.kind.count === 1 && security.kind.options.length === 2 && security.kind.ranges.length === 0).toBe(true);
    }

    const electives = must(major.groups[2]!.rules[0], "electives");
    expect(electives.kind.type).toBe("choose");
    if (electives.kind.type === "choose") {
      expect(electives.kind.hours).toBe(8);
      expect(electives.kind.ranges.map((range) => range.label)).toEqual([
        "CS 2500 or higher, except CS 5010",
        "DS 2500 to DS 4999 but not DS 4900",
      ]);
      expect(rangeContains(electives.kind.ranges[0]!, key("CS 4973"))).toBe(true);
      expect(rangeContains(electives.kind.ranges[0]!, key("CS 5010"))).toBe(false);
      expect(rangeContains(electives.kind.ranges[0]!, key("CS 2100"))).toBe(false);
      expect(rangeContains(electives.kind.ranges[1]!, key("DS 4900"))).toBe(false);
      expect(rangeContains(electives.kind.ranges[1]!, key("DS 5110"))).toBe(false);
    }
    expect(major.groups[2]!.notes.length).toBe(1);

    const science = must(req.sections[1]!.groups[0]?.rules[0], "science");
    expect(science.kind.type).toBe("choose");
    if (science.kind.type === "choose") {
      expect(science.kind.count).toBe(2);
      expect(science.kind.options.map((option) => option.alternatives.map((set) => set.map((item) => keyId(item)).join(" and ")).join(" or "))).toEqual([
        "BIOL 1111 and BIOL 1112",
        "MATH 2331",
      ]);
    }
    expect(science.notes).toEqual(["Biology", "Mathematics"]);
    expect(science.optionCategories).toEqual(["Biology", "Mathematics"]);
    expect(ruleTitle(req, science.id)).toBe("Science Requirement");

    const general = req.sections[2]!.groups[0]?.rules[0]?.kind;
    expect(general).toEqual({ type: "generalElectives", hours: 8 });
    expect(req.sections[3]!.notes).toEqual(["Minimum 2.000 GPA required in the major."]);

    expect(req.courseTitles[keyId(key("CS 3000"))]).toBe("Algorithms and Data");
    expect(req.courseTitles[keyId(key("CS 4530"))]).toBe("Fundamentals of Software Engineering");
    expect(req.courseTitles[keyId(key("BIOL 1111"))]).toBe("General Biology 1");
    expect(req.courseTitles[keyId(key("BIOL 1112"))]).toBe("Lab for BIOL 1111");
    expect(req.courseTitles[keyId(key("CS 4550"))]).toBe("Web Development");
  });

  it("ruleIDsAreStable", () => {
    const first = allRules(requirements()).map((rule) => rule.id);
    const second = allRules(requirements()).map((rule) => rule.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toContain("major-requirements/required-courses/cs-4500-or-cs-4530");
  });

  it("readsEditionsFromTheSite", () => {
    const page = `
        <header><span class="edition">Academic Catalog 2031-2032</span></header>
        <a href="/archive/2030-2031">2030-2031 Catalog</a>
        <a href="https://catalog.northeastern.edu/archive/2029-2030/">2029-2030 Catalog</a>
        <a href="https://catalog.northeastern.edu/pdf/2029-2030.pdf">PDF</a>
        `;
    expect(currentEdition(page)).toEqual({ startYear: 2031 });
    expect(archivedEditions(page)).toEqual([{ startYear: 2030 }, { startYear: 2029 }]);
  });

  it("editionURLsFollowTheSite", () => {
    const editions = { current: { startYear: 2031 }, archived: [{ startYear: 2030 }], fetchedAt: Date.now(), isEstimated: false };
    const path = "undergraduate/computer-information-science/computer-science/bscs/";
    expect(editionURL(editions, { startYear: 2031 }, path)).toBe(
      "https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/",
    );
    expect(editionURL(editions, { startYear: 2030 }, path)).toBe(
      "https://catalog.northeastern.edu/archive/2030-2031/undergraduate/computer-information-science/computer-science/bscs/",
    );
    expect(parseCatalogYear("2030–2031")).toEqual({ startYear: 2030 });
    expect(parseCatalogYear("2030-31") ? catalogYearLabel(parseCatalogYear("2030-31")!) : undefined).toBe("2030–2031");

    const june = new Date(2040, 5, 1);
    const october = new Date(2040, 9, 1);
    expect(catalogYearContaining(june)).toEqual({ startYear: 2039 });
    expect(catalogYearContaining(october)).toEqual({ startYear: 2040 });
    expect(estimatedEditions(october).archived.at(-1)).toEqual({ startYear: 2016 });
  });

  it("listsProgramsFromTheIndex", () => {
    const index = `
        <a href="/archive/2023-2024/undergraduate/computer-information-science/computer-science/bscs/">Computer Science, BSCS</a>
        <a href="/graduate/computer-information-science/computer-science/computer-science-ms/">Computer Science, MS (Boston)</a>
        <a href="/undergraduate/computer-information-science/computer-science/computer-science-minor/">Computer Science Minor</a>
        <a href="/undergraduate/about/">About, The University</a>
        <a href="#programs">Programs, AZ</a>
        `;
    const programs = programsFromIndex(index);
    expect(programs.map((item) => item.title)).toEqual(["Computer Science, BSCS", "Computer Science, MS (Boston)"]);
    expect(programs[0]!.path).toBe("undergraduate/computer-information-science/computer-science/bscs/");
    expect(programLevel(programs[1]!) === "graduate" && programParts(programs[1]!.title).degree === "MS" && programParts(programs[1]!.title).campus === "Boston").toBe(true);
    expect(suggestedPrograms("CS-B-CSCI-BSCS", programs).map((item) => programParts(item.title).degree)).toEqual(["BSCS"]);
  });

  it("auditMatchesCoursesToRequirements", () => {
    const audit = runDegreeAudit(samplePlan(), requirements());
    const status = (label: string) => ruleResults(audit).find((result) => result.rule.label === label)?.status;
    expect(audit.needsConcentration).toBe(false);
    expect(status("CS 1800 and CS 1802")).toBe("complete");
    expect(status("CS 3000")).toBe("complete");
    expect(status("CS 4500 or CS 4530")).toBe("missing");
    expect(status("Complete one of the following:")).toBe("complete");
    expect(status("CS 2484")).toBe("complete");
    const hcc = must(ruleResults(audit).find((result) => result.rule.label === "Complete two of the following not already taken:"), "hcc");
    expect(hcc.status === "partial" && hcc.remainingCount === 1).toBe(true);
    const electives = must(ruleResults(audit).find((result) => result.rule.label.startsWith("Complete 8 semester hours of CS")), "electives");
    expect(electives.status).toBe("complete");
    expect(new Set(keyIdsOf(electives.used))).toEqual(new Set(["CS 4973", "CS 4535"]));
    expect(status("Complete two courses (and any required labs) from the following science categories:")).toBe("missing");
    expect(audit.sections.some((section) => section.section.title === "Software Concentration")).toBe(false);
    expect(audit.completedHours).toBe(34);
    expect(audit.plannedHours).toBe(16);
    expect(audit.requiredHours).toBe(52);
  });

  it("substitutionsAndPetitions", () => {
    const req = requirements();
    const plan = samplePlan();
    const hccRule = ruleLabeled(req, "Complete two of the following not already taken:");
    const softwareEngineering = ruleLabeled(req, "CS 4500 or CS 4530");
    const science = rulePrefixed(req, "Complete two courses");
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    const softwareOnly = ruleLabeled(req, "CS 4400");
    plan.substitutions = [
      substitution(hccRule.id, "HCI electives", { type: "countCourse", course: key("CS 4973") }),
      substitution(softwareEngineering.id, "Software engineering", { type: "countCourse", course: key("CS 4535") }),
      substitution(
        science.id,
        "Science Requirement",
        { type: "replace", replacement: { count: 2, likeRuleID: electives.id, likeRuleTitle: "Khoury Elective Courses", courses: [] } },
        "Petition approved",
      ),
      substitution(softwareOnly.id, "CS 4400", { type: "waive" }),
      substitution(electives.id, "Electives", { type: "countCourse", course: key("CS 4999") }),
    ];
    const audit = runDegreeAudit(plan, req);

    const hcc = must(resultFor(audit, hccRule.id), "hcc");
    expect(hcc.status).toBe("complete");
    expect(hcc.used.some((use) => keyId(use.key) === "CS 4973" && use.bySubstitution)).toBe(true);

    const engineering = must(resultFor(audit, softwareEngineering.id), "engineering");
    expect(engineering.status === "complete" && keyIdsOf(engineering.used).join() === "CS 4535").toBe(true);

    const electiveResult = must(resultFor(audit, electives.id), "electives");
    expect(electiveResult.status).toBe("planned");
    expect(new Set(keyIdsOf(electiveResult.used))).toEqual(new Set(["CS 3000", "CS 3800"]));
    const scienceResult = must(resultFor(audit, science.id), "science");
    expect(scienceResult.status).toBe("planned");
    expect(new Set(keyIdsOf(scienceResult.used))).toEqual(new Set(["CS 4100", "DS 3000"]));
    expect(scienceResult.substitutions[0]?.note).toBe("Petition approved");

    expect(new Set(audit.unmatchedSubstitutions.map((item) => item.ruleTitle))).toEqual(new Set(["CS 4400", "Electives"]));
    const counted = ruleResults(audit).flatMap((result) => result.used.map((use) => use.id));
    expect(counted.length).toBe(new Set(counted).size);
  });

  it("shortfallLandsOnTheHoursRequirement", () => {
    const req = requirements();
    const plan = emptyPlan("Short");
    plan.completed = [course("CS 1800"), course("CS 1802", 1), course("CS 3000"), course("CY 2550")];
    plan.terms = [term("spring", "spring", 2027, [course("CS 3386"), course("CS 4050"), course("CS 2963", 1)])];
    plan.concentrationID = "concentration-in-human-centered-computing";
    const science = rulePrefixed(req, "Complete two courses");
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    plan.substitutions = [
      substitution(science.id, "Science Requirement", {
        type: "replace",
        replacement: { count: 2, likeRuleID: electives.id, likeRuleTitle: "Khoury Elective Courses", courses: [] },
      }),
    ];
    const audit = runDegreeAudit(plan, req);
    const scienceResult = must(resultFor(audit, science.id), "science");
    expect(scienceResult.status).toBe("planned");
    expect(new Set(keyIdsOf(scienceResult.used))).toEqual(new Set(["CS 3386", "CS 4050"]));
    const electiveResult = must(resultFor(audit, electives.id), "electives");
    expect(electiveResult.status).toBe("partial");
    expect(keyIdsOf(electiveResult.used)).toEqual(["CS 2963"]);
    expect(electiveResult.remainingHours).toBe(7);
  });

  it("rebalancesToMeetShortRequirements", () => {
    const page = `
        <div id="programrequirementstextcontainer" class="tab_content">
        <h2>Major Requirements</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Computing and Social Issues</span></td><td class="hourscol"></td></tr>
        <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete one of the following:</span></td><td class="hourscol">4</td></tr>
        <tr class="even"><td class="codecol"><a class="bubblelink code">CY&#160;4170</a></td><td>The Law, Ethics, and Policy of Data and Digital Technologies</td><td class="hourscol"></td></tr>
        <tr class="odd"><td class="codecol"><a class="bubblelink code">HIST&#160;2220</a></td><td>History of Technology</td><td class="hourscol"></td></tr>
        <tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Humanities</span></td><td class="hourscol"></td></tr>
        <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete one of the following:</span></td><td class="hourscol">4</td></tr>
        <tr class="even"><td class="codecol"><a class="bubblelink code">HIST&#160;2220</a></td><td>History of Technology</td><td class="hourscol"></td></tr>
        <tr class="odd"><td class="codecol"><a class="bubblelink code">PHIL&#160;1145</a></td><td>Technology and Human Values</td><td class="hourscol"></td></tr>
        <tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Khoury Elective Courses</span></td><td class="hourscol"></td></tr>
        <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS, CY, DS, or IS classes that are not already required. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
        <tr class="even"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher</span></div></td><td class="hourscol"></td></tr>
        <tr class="odd lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CY&#160;2000</a> or higher</span></div></td><td class="hourscol"></td></tr>
        </tbody></table>
        <h2>Required General Electives</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even lastrow firstrow"><td colspan="2"><span class="courselistcomment">Complete 4 semester hours of general electives.</span></td><td class="hourscol">4</td></tr>
        </tbody></table>
        </div>
        `;
    const req = requirementsFrom(page, { startYear: 2024 });
    const rules = allRules(req);
    expect(rules.length).toBe(4);
    const socialIssues = rules[0]!;
    const humanities = rules[1]!;
    const electives = rules[2]!;
    const auditOf = (completed: string[], planned: string[]) => {
      const plan = emptyPlan("Plan");
      plan.completed = completed.map((code) => course(code));
      plan.terms = [term("spring", "spring", 2027, planned.map((code) => course(code)))];
      return runDegreeAudit(plan, req);
    };
    const coursesOf = (audit: ReturnType<typeof runDegreeAudit>, rule: RequirementRule) => new Set(keyIdsOf(resultFor(audit, rule.id)?.used ?? []));

    const swap = auditOf(["CY 4170", "CS 3200", "PHIL 1145"], ["HIST 2220", "MKTG 4510"]);
    expect(satisfiedCount(swap)).toBe(totalCount(swap));
    expect(coursesOf(swap, electives)).toEqual(new Set(["CS 3200", "CY 4170"]));
    expect(coursesOf(swap, socialIssues)).toEqual(new Set(["HIST 2220"]));
    expect(coursesOf(swap, humanities)).toEqual(new Set(["PHIL 1145"]));
    expect(swap.generalElectives.map((use) => keyId(use.key))).toEqual(["MKTG 4510"]);

    const chain = auditOf(["CY 4170", "CS 3200", "HIST 2220"], ["PHIL 1145", "MKTG 4510"]);
    expect(satisfiedCount(chain)).toBe(totalCount(chain));
    expect(coursesOf(chain, electives)).toEqual(new Set(["CS 3200", "CY 4170"]));
    expect(resultFor(chain, electives.id)?.status).toBe("complete");
    expect(coursesOf(chain, socialIssues)).toEqual(new Set(["HIST 2220"]));
    expect(coursesOf(chain, humanities)).toEqual(new Set(["PHIL 1145"]));
    const counted = ruleResults(chain).flatMap((result) => result.used.map((use) => keyId(use.key)));
    expect(counted.length).toBe(new Set(counted).size);

    const short = auditOf(["CY 4170", "CS 3200"], ["MKTG 4510"]);
    expect(resultFor(short, socialIssues.id)?.status).toBe("complete");
    expect(resultFor(short, electives.id)?.remainingHours).toBe(4);
  });

  it("petitionsAskWhetherCourseNumberMinimumsApply", () => {
    const req = requirements();
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    const science = rulePrefixed(req, "Complete two courses");
    const plan = emptyPlan("Petition");
    plan.completed = [
      course("CS 1800"),
      course("CS 1802", 1),
      course("CS 3000"),
      course("CS 4500"),
      course("CY 2550"),
      course("CS 2386", 4, "Game Programming 1"),
      course("CS 2484"),
      course("CS 4520"),
      course("CS 4550"),
    ];
    plan.terms = [term("spring", "spring", 2027, [course("CS 3386", 4, "Game Programming 2"), course("CS 3200"), course("CS 4100"), course("MKTG 2602"), course("PHIL 1102")])];
    plan.concentrationID = "concentration-in-human-centered-computing";
    const petition = (limit: CourseNumberLimit | null) =>
      substitution(science.id, "Science Requirement", {
        type: "replace",
        replacement: { count: 2, likeRuleID: electives.id, likeRuleTitle: "Khoury Elective Courses", courses: [], courseNumbers: limit },
      });

    plan.substitutions = [petition(null)];
    const unanswered = runDegreeAudit(plan, req);
    expect(resultFor(unanswered, electives.id)?.status).toBe("partial");
    const questions = petitionQuestions({ plan, requirements: req, audit: unanswered });
    const question = must(questions[0], "question");
    expect(questions.length).toBe(1);
    expect(question.courses).toEqual([key("CS 2386")]);
    expect(question.question).toBe("Does your Science Requirement petition accept any CS or DS course?");
    expect(question.explanation.includes("start at CS 2500 or DS 2500")).toBe(true);
    expect(question.explanation.includes("CS 2386 counts")).toBe(true);

    plan.substitutions = [petition({ type: "anyNumber" })];
    const anyNumber = runDegreeAudit(plan, req);
    expect(resultFor(anyNumber, science.id)?.used.some((use) => keyId(use.key) === "CS 2386")).toBe(true);
    expect(resultFor(anyNumber, electives.id)?.status).toBe("planned");
    expect(petitionQuestions({ plan, requirements: req })).toEqual([]);
    const effective = resultFor(anyNumber, science.id)?.effectiveKind;
    expect(effective?.type).toBe("choose");
    if (effective?.type === "choose") {
      expect(effective.ranges.map((range) => range.label)).toEqual(["Any CS course, except CS 5010", "DS courses up to DS 4999, except DS 4900"]);
    }

    plan.substitutions = [petition({ type: "atLeast", minimum: 2000 })];
    expect(resultFor(runDegreeAudit(plan, req), electives.id)?.status).toBe("planned");
    plan.substitutions = [petition({ type: "atLeast", minimum: 3000 })];
    expect(resultFor(runDegreeAudit(plan, req), electives.id)?.status).toBe("partial");

    plan.substitutions = [petition({ type: "sameAsRequirement" })];
    expect(petitionQuestions({ plan, requirements: req })).toEqual([]);
    const same = runDegreeAudit(plan, req);
    const miss = must(nearMisses(same, electives.id)[0], "near miss");
    expect(keyId(miss.course.key) === "CS 2386" && miss.reason === "Below CS 2500").toBe(true);

    const old = JSON.parse(`{"count":2,"likeRuleID":"x","likeRuleTitle":"Khoury Elective Courses","courses":[]}`) as { courseNumbers?: CourseNumberLimit | null };
    expect(old.courseNumbers ?? null).toBeNull();
    expect(replacementSummary({ count: 1, likeRuleTitle: "Khoury Elective Courses", courses: [], courseNumbers: { type: "anyNumber" } })).toBe(
      "1 course like Khoury Elective Courses, any course number",
    );
    // applyCourseNumberLimit is what the petition's effective ranges use; keep it referenced for the any-number labels above.
    expect(applyCourseNumberLimit({ subject: "CS", lowest: 2500, highest: null, except: [], label: "x" }, { type: "anyNumber" }).lowest).toBe(0);
  });

  it("topicsCoursesCountEachTime", () => {
    const req = requirements();
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    const plan = emptyPlan("Topics");
    plan.completed = [
      course("CS 1800"),
      course("CS 1802", 1),
      course("CS 3000"),
      course("CS 4500"),
      course("CY 2550"),
      course("CS 4973", 4, "Topics in Computer Science"),
      course("MKTG 2602", 4, "Marketing Management"),
    ];
    plan.terms = [term("spring", "spring", 2027, [course("CS 4973", 4, "Topics in Computer Science"), course("MKTG 2602", 4, "Marketing Management")])];
    const audit = runDegreeAudit(plan, req);
    const result = must(resultFor(audit, electives.id), "electives");
    expect(result.status).toBe("planned");
    expect(result.used.map((use) => courseUseName(use)).sort()).toEqual(["CS 4973", "CS 4973 (2)"]);
    const counted = [...ruleResults(audit).flatMap((item) => item.used), ...audit.unused];
    expect(counted.filter((use) => keyId(use.key) === "MKTG 2602").length).toBe(2);
    expect(new Set(counted.map((use) => use.id)).size).toBe(counted.length);
    expect(duplicateKeys(plan)).toEqual(new Set(["MKTG 2602"]));
  });

  it("requiredAlternativesMakeRoom", () => {
    const page = `
        <div id="programrequirementstextcontainer" class="tab_content">
        <h2>Major Requirements</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Software Engineering</span></td><td class="hourscol"></td></tr>
        <tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4500</a></td><td>Software Development</td><td class="hourscol">4</td></tr>
        <tr class="orclass even"><td class="codecol orclass">or <a class="bubblelink code">CS&#160;4530</a></td><td colspan="2">Fundamentals of Software Engineering</td></tr>
        <tr class="odd areaheader"><td colspan="2"><span class="courselistcomment areaheader">Concentration Courses</span></td><td class="hourscol"></td></tr>
        <tr class="even"><td colspan="2"><span class="courselistcomment">Complete two of the following:</span></td><td class="hourscol">8</td></tr>
        <tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;4530</a></td><td>Fundamentals of Software Engineering</td><td class="hourscol"></td></tr>
        <tr class="even lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;4550</a></td><td>Web Development</td><td class="hourscol"></td></tr>
        </tbody></table>
        </div>
        `;
    const req = requirementsFrom(page, { startYear: 2024 });
    const rules = allRules(req);
    expect(rules.length).toBe(2);
    const plan = emptyPlan("Plan");
    plan.completed = [course("CS 4530"), course("CS 4550")];
    plan.terms = [term("spring", "spring", 2027, [course("CS 4500")])];
    const audit = runDegreeAudit(plan, req);
    expect(satisfiedCount(audit)).toBe(2);
    expect(keyIdsOf(resultFor(audit, rules[0]!.id)?.used ?? [])).toEqual(["CS 4500"]);
    expect(new Set(keyIdsOf(resultFor(audit, rules[1]!.id)?.used ?? []))).toEqual(new Set(["CS 4530", "CS 4550"]));
  });

  it("substitutionsFollowRequirementsAcrossCatalogYears", () => {
    const req = requirements();
    const science = rulePrefixed(req, "Complete two courses");
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    const plan = samplePlan();
    plan.substitutions = [
      substitution("supporting-courses/science-requirement/complete-any-two-courses-from-last-year", "Science Requirement", {
        type: "replace",
        replacement: {
          count: 2,
          likeRuleID: "major-requirements/khoury-elective-courses/older-wording",
          likeRuleTitle: "Khoury Elective Courses",
          courses: [],
          courseNumbers: { type: "sameAsRequirement" },
        },
      }),
      substitution("gone", "A requirement this year doesn't have", { type: "waive" }),
    ];
    const audit = runDegreeAudit(plan, req);
    const result = must(resultFor(audit, science.id), "science");
    expect(result.substitutions.length).toBe(1);
    expect(result.status).toBe("complete");
    expect(new Set(keyIdsOf(result.used))).toEqual(new Set(["CS 4973", "CS 4535"]));
    expect(audit.placements[plan.substitutions[0]!.id]).toBe(science.id);
    expect(audit.unmatchedSubstitutions.map((item) => item.ruleTitle)).toEqual(["A requirement this year doesn't have"]);
    const change = plan.substitutions[0]!.change;
    expect(change.type).toBe("replace");
    if (change.type === "replace") expect(likeRanges(change.replacement, req).length).toBe(2);
    expect(resultFor(audit, electives.id)?.status).toBe("planned");
  });

  it("hourRequirementsKeepOnlyWhatTheyNeed", () => {
    const req = requirements();
    const electives = rulePrefixed(req, "Complete 8 semester hours of CS");
    const plan = emptyPlan("Hours");
    plan.completed = [course("CS 1800"), course("CS 1802", 1), course("CS 3000"), course("CS 4500"), course("CY 2550"), course("CS 4100"), course("MATH 1341"), course("PHIL 1102")];
    plan.terms = [
      term("spring", "spring", 2027, [course("CS 2963", 1, "Topics")]),
      term("summer", "summerB", 2027, [course("CS 3200")]),
    ];
    const audit = runDegreeAudit(plan, req);
    const result = must(resultFor(audit, electives.id), "electives");
    expect(result.status).toBe("planned");
    expect(new Set(keyIdsOf(result.used))).toEqual(new Set(["CS 4100", "CS 3200"]));
    expect(result.used.reduce((sum, use) => sum + use.credits, 0)).toBe(8);
    expect(new Set(audit.generalElectives.map((use) => keyId(use.key)))).toEqual(new Set(["MATH 1341", "PHIL 1102"]));
    expect(audit.unused.map((use) => keyId(use.key))).toEqual(["CS 2963"]);

    const uses = [
      { title: "A", credits: 5, completed: true },
      { title: "B", credits: 4, completed: false },
      { title: "C", credits: 4, completed: false },
    ].map((item, index) => ({
      key: key(`CS ${4000 + index}`),
      title: item.title,
      credits: item.credits,
      semester: item.completed ? null : "Spring 2027",
      order: index,
      bySubstitution: false,
      instance: 0,
      id: `CS ${4000 + index}`,
    }));
    expect(fewestCreditsChoice(uses, 8)).toEqual(new Set(["CS 4001", "CS 4002"]));
  });

  it("checksHoursInTheMajorAndCoop", () => {
    const page = `
        <div id="programrequirementstextcontainer" class="tab_content">
        <h2>Major Requirements</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even firstrow"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
        <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete 8 semester hours of CS classes. Choose courses within the following ranges:</span></td><td class="hourscol">8</td></tr>
        <tr class="even lastrow"><td colspan="2"><div style="margin-left:20px;" class="blockindent"><span class="courselistcomment commentindent"><a class="bubblelink code">CS&#160;2500</a> or higher</span></div></td><td class="hourscol"></td></tr>
        </tbody></table>
        <h2>Writing Requirement</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">ENGW&#160;1111</a></td><td>First-Year Writing</td><td class="hourscol">4</td></tr>
        </tbody></table>
        <h2>Required General Electives</h2>
        <table class="sc_courselist"><tbody>
        <tr class="even lastrow firstrow"><td colspan="2"><span class="courselistcomment">Complete 4 semester hours of general electives.</span></td><td class="hourscol">4</td></tr>
        </tbody></table>
        <h2>GPA Requirement</h2>
        <p>Minimum 2.000 GPA required in the major.</p>
        <h2>Credit Requirement</h2>
        <p>Complete 16 semester hours in the major.</p>
        <h2>NUpath Requirements Satisfied</h2>
        <p>Integrating Knowledge and Skills Through Experience is satisfied through co-op.</p>
        </div>
        `;
    const req = requirementsFrom(page, { startYear: 2024 });
    const auditOf = (completed: string[], planned: string[] = []) => {
      const plan = emptyPlan("Checks");
      plan.completed = completed.map((code) => (code === "COOP 3946" ? course(code, 0, "Co-op Work Experience - HT") : course(code)));
      plan.terms = [term("fall", "fall", 2027, planned.map((code) => course(code)))];
      return runDegreeAudit(plan, req);
    };
    const done = auditOf(["CS 3000", "CS 3200", "CS 3500", "CS 4100", "ENGW 1111", "MKTG 2602", "COOP 3946", "CS 1210"]);
    expect(done.noteChecks.length).toBe(2);
    const hours = must(done.noteChecks.find((check) => check.kind.type === "majorHours"), "hours");
    expect(hours.status).toBe("complete");
    expect(hours.detail).toBe("16 of 16 semester hours");
    const coop = must(done.noteChecks.find((check) => check.kind.type === "coop"), "coop");
    expect(coop.status === "complete" && coop.detail === "COOP 3946 completed").toBe(true);
    expect(satisfiedCount(done)).toBe(totalCount(done));

    const short = auditOf(["CS 3000", "CS 3200", "CS 1210"], ["CS 3500"]);
    const shortHours = must(short.noteChecks.find((check) => check.kind.type === "majorHours"), "short hours");
    expect(shortHours.status).toBe("partial");
    expect(shortHours.detail).toBe("8 of 16 semester hours · 4 planned");
    expect(short.noteChecks.find((check) => check.kind.type === "coop")?.detail).toBe("No co-op in the plan");
    expect(satisfiedCount(short) < totalCount(short)).toBe(true);
  });

  it("waiversAndConcentrationChoice", () => {
    const req = requirements();
    const plan = samplePlan();
    const security = ruleLabeled(req, "Complete one of the following:");
    plan.substitutions = [substitution(security.id, "Security Course", { type: "waive" })];
    plan.concentrationID = null;
    const audit = runDegreeAudit(plan, req);
    expect(resultFor(audit, security.id)?.status).toBe("waived");
    expect(audit.needsConcentration).toBe(true);
    expect(audit.sections.some((section) => section.section.isConcentration)).toBe(false);
    expect(ruleCounting(audit, key("CY 2550"))?.rule.id).not.toBe(security.id);
  });

  it("userDataSkipsUnreadableEntries", () => {
    const data = {
      degreePlans: [{ ...samplePlan(), completed: "not a list" }, emptyPlan("Second")],
      searchHistory: ["cs 3000", 42, "orgo"],
    };
    const decoded = mergeUserData(data);
    expect(decoded.degreePlans.map((plan) => plan.name)).toEqual(["Second"]);
    expect(decoded.searchHistory).toEqual(["cs 3000", "orgo"]);
  });

  it("olderSavedPlansStillDecode", () => {
    const plan = samplePlan();
    plan.substitutions = [substitution("x", "X", { type: "waive" })];
    const json = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    for (const field of ["substitutions", "catalogYear", "catalogProgramPath", "catalogProgramTitle", "concentrationID"]) delete json[field];
    const decoded = decodeDegreePlan(json);
    expect(decoded != null && decoded.name === "Plan" && decoded.completed.length === plan.completed.length).toBe(true);
    expect(decoded != null && (decoded.substitutions ?? []).length === 0 && (decoded.substitutions?.length ?? -1) === 0).toBe(true);
    expect(decoded?.substitutions).toEqual([]);
    expect(decoded?.catalogYear ?? null).toBeNull();
    const roundTrip = decodeDegreePlan(JSON.parse(JSON.stringify(plan)));
    expect(roundTrip).toEqual(plan);
  });
});

void universitywideLink;
void parseUniversitywide;
void uncheckedReason;
void sortedKeyIds;
void program;
void year;
