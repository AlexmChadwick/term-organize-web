import { describe, expect, it } from "vitest";
import { CourseEquivalences } from "@/lib/equivalences";
import { parseCourseKey, type CourseKey } from "@/lib/models";
import type { DegreePlan, DegreePlanCourse, DegreePlanTerm, PlanSeason } from "@/lib/requirements";
import { courseAttributes, NUPATH_REQUIREMENTS } from "@/lib/degree/nupath";
import { parseProgramPage } from "@/lib/degree/catalog-parser";
import { runDegreeAudit } from "@/lib/degree/audit";
import { OfferingHistory, applyReorderSuggestion, reorderSuggestions } from "@/lib/degree/reordering";

const program = { title: "Computer Science, BSCS (Boston)", path: "undergraduate/computer-information-science/computer-science/bscs/" };
const year = { startYear: 2023 };

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

function key(code: string): CourseKey {
  const parsed = parseCourseKey(code);
  if (!parsed) throw new Error(code);
  return parsed;
}

let courseN = 0;
function course(code: string, credits = 4, title = ""): DegreePlanCourse {
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

function semester(id: string, season: PlanSeason, year: number, codes: string[], credits = 4): DegreePlanTerm {
  return { id, season, year, courses: codes.map((code) => course(code, credits, code)) };
}

const checked = ["202710", "202650", "202630", "202610", "202550", "202530"];
const fall = ["202710", "202610"];
const spring = ["202630", "202530"];

function history(offered: Record<string, string[]>): OfferingHistory {
  return new OfferingHistory({
    checkedTerms: checked,
    offered: Object.entries(offered).map(([code, terms]) => ({ key: key(code), terms })),
    checkedKeys: Object.keys(offered).map((code) => key(code)),
  });
}

describe("catalog", () => {
  it("parses the program page and stable rule ids", () => {
    const req = parseProgramPage(programPage, year, program);
    expect(req).not.toBeNull();
    if (!req) return;
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
    expect(req.sections.filter((section) => section.isConcentration).map((section) => section.id)).toContain("concentration-in-human-centered-computing");
    const ids = req.sections.flatMap((section) => section.groups.flatMap((group) => group.rules.map((rule) => rule.id)));
    expect(ids).toContain("major-requirements/required-courses/cs-4500-or-cs-4530");
    expect(new Set(ids).size).toBe(ids.length);
    const electives = req.sections[0]!.groups[2]!.rules[0]!;
    expect(electives.kind.type).toBe("choose");
    if (electives.kind.type === "choose") {
      expect(electives.kind.ranges.map((range) => range.label)).toEqual([
        "CS 2500 or higher, except CS 5010",
        "DS 2500 to DS 4999 but not DS 4900",
      ]);
    }
    expect(req.courseTitles["CS 4530"]).toBe("Fundamentals of Software Engineering");
    expect(req.courseTitles["BIOL 1112"]).toBe("Lab for BIOL 1111");
    expect(JSON.stringify(req)).not.toContain("CS 9999");
  });
});

describe("nupath", () => {
  const page = `<div id="programrequirementstextcontainer">
    <h2>Major Requirements</h2>
    <table class="sc_courselist"><tbody>
    <tr class="even firstrow lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
    </tbody></table>
    <h2>NUpath Requirements</h2>
    <p>All undergraduate students are required to complete the NUpath Requirements.</p>
    <h2>NUpath Requirements Satisfied</h2>
    <p>Integrating Knowledge and Skills Through Experience is satisfied through co-op.</p>
    <h2>Program Requirement</h2><p>134 total semester hours required</p>
    <h2>Khoury College GPA Requirement</h2><p>Minimum cumulative 2.000 GPA required</p>
    </div>`;
  const attributes = courseAttributes({
    "ENGW 1111": ["WF"],
    "MATH 1341": ["FQ"],
    "PHYS 1151": ["ND"],
    "CS 3200": ["AD", "FQ"],
    "PHIL 1145": ["ER", "SI"],
    "ARTH 1111": ["IC", "EI"],
    "HIST 1130": ["DD", "SI"],
    "CS 3000": ["FQ"],
    "ENGW 3302": ["WD"],
    "CS 4535": ["CE", "EX", "WI"],
    "CS 3484": ["WI"],
  });

  it("meets 13 of 13 and assigns the co-op to experience", () => {
    const req = parseProgramPage(page, { startYear: 2024 }, program);
    expect(req).not.toBeNull();
    if (!req) return;
    const plan = emptyPlan("NUpath");
    plan.completed = ["ENGW 1111", "MATH 1341", "PHYS 1151", "CS 3200", "PHIL 1145", "ARTH 1111", "HIST 1130", "CS 3000"].map((code) => course(code));
    plan.completed.push(course("COOP 3946", 0, "Co-op Work Experience - HT"));
    plan.terms = [{ id: "s", season: "spring", year: 2027, courses: ["ENGW 3302", "CS 4535", "CS 3484"].map((code) => course(code)) }];
    const audit = runDegreeAudit(plan, req, CourseEquivalences.none(), attributes);
    const check = audit.noteChecks.find((item) => item.kind.type === "nupath");
    expect(check?.detail).toBe("13 of 13 met");
    expect(check?.counts).toBe(true);
    expect(check?.items.map((item) => item.id)).toEqual(NUPATH_REQUIREMENTS.map((item) => item.path.code));
    expect(check?.items.find((item) => item.id === "NCWI")?.courses).toEqual(["CS 4535", "CS 3484"]);
    expect(check?.items.find((item) => item.id === "NCEX")?.courses).toEqual(["COOP 3946"]);
  });
});

describe("offering history and reordering", () => {
  it("describes seasons", () => {
    const record = history({
      "CS 3386": spring,
      "CS 3800": [...fall, ...spring],
      "CS 4100": ["202530"],
      "CS 2500": ["202650", "202550"],
      "CS 2510": ["202650", "202630"],
      "CS 9999": [],
    });
    expect(record.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(record.isLikelyOffered(key("CS 3386"), "fall")).toBe(false);
    expect(record.isLikelyOffered(key("CS 2500"), "summerA")).toBe(true);
    expect(record.isLikelyOffered(key("CS 3386"), "winter")).toBeNull();
    expect(record.summary(key("CS 3386"))).toBe("Offered every spring");
    expect(record.summary(key("CS 3800"))).toBe("Offered every fall and spring");
    expect(record.summary(key("CS 4100"))).toBe("Last offered Spring 2025");
    expect(record.summary(key("CS 2510"))).toBe("Last offered Summer 2026");
    expect(record.summary(key("CS 9999"))).toBe("Not offered in the last 2 years");
    expect(record.summaryIn(key("CS 3386"), "fall")).toBe("Not offered in a fall term in the last 2 years");
    expect(OfferingHistory.empty().summary(key("CS 3386"))).toBe("Offering history unknown");
  });

  it("moves a spring course onto a new semester", () => {
    const addedPlan = emptyPlan();
    addedPlan.terms = [semester("fall26", "fall", 2026, ["CS 3386"]), semester("fall27", "fall", 2027, ["CS 3800"])];
    const added = reorderSuggestions({
      plan: addedPlan,
      termID: "fall26",
      blocking: [key("CS 3386")],
      history: history({ "CS 3386": spring, "CS 3800": fall }),
      prerequisites: () => null,
    });
    expect(added[0]?.title).toBe("Move CS 3386 to a new Spring 2028 semester");
    expect(added[0]?.addsSemester?.season).toBe("spring");
    expect(added[0]?.addsSemester?.year).toBe(2028);
    applyReorderSuggestion(added[0]!, addedPlan);
    expect(addedPlan.terms.map((term) => `${term.season} ${term.year}`)).toEqual(["fall 2026", "fall 2027", "spring 2028"]);
    expect(addedPlan.terms.at(-1)?.courses.map((item) => item.label)).toEqual(["CS 3386"]);
  });
});
