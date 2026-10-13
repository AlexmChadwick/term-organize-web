import { describe, expect, it } from "vitest";
import { meetingFromBanner, parseCatalogDetails, parseCorequisites, parseDescription, parsePrerequisites, subjectLookup } from "./banner";
import { decodeEntities } from "./html";
import { dayCompactLabel, isFinalExam, isReqAnd, isReqOr, keyId, meetingLocation, referencedCourses, reqCourse, reqOr, reqTest } from "./models";

const subjects = subjectLookup([
  { code: "CS", name: "Computer Science" },
  { code: "DS", name: "Data Science" },
  { code: "MATH", name: "Mathematics" },
  { code: "EECE", name: "Electrical and Comp Engineerng" },
]);

function row(andOr = "", open = false, test = "", score = "", subject = "", number = "", close = false): string {
  return `<tr><td>${andOr}</td><td>${open ? "(" : ""}</td><td>${test}</td><td>${score}</td><td>${subject}</td><td>${number}</td><td>Undergraduate</td><td>D-</td><td>${close ? ")" : ""}</td></tr>`;
}

function table(rows: string[]): string {
  return `<section><table class="basePreqTable"><thead><tr><th>And/Or</th></tr></thead><tbody>${rows.join("")}</tbody></table></section>`;
}

describe("BannerParserTests", () => {
  it("parsesNestedPrerequisites", () => {
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
    expect.soft(requisite != null && isReqOr(requisite)).toBe(true);
    if (requisite && isReqOr(requisite)) {
      expect.soft(requisite.or.length).toBe(2);
      expect.soft(requisite.or.at(-1)).toEqual(reqCourse({ subject: "CS", number: "2700" }));
      const first = requisite.or[0];
      expect.soft(first != null && isReqAnd(first)).toBe(true);
      if (first && isReqAnd(first)) expect.soft(first.and.length).toBe(2);
    }
    const keys = referencedCourses(requisite ?? { and: [] }).map(keyId);
    expect.soft(keys).toContain("EECE 2160");
    expect.soft(keys).toContain("CS 201M");
  });

  it("parsesSingleCourseAndTests", () => {
    const single = table([row("", false, "", "", "Computer Science", "2100")]);
    expect.soft(parsePrerequisites(single, subjects)).toEqual(reqCourse({ subject: "CS", number: "2100" }));
    const withTest = table([row("", false, "", "", "Mathematics", "1341"), row("Or", false, "Graduate Admission")]);
    expect.soft(parsePrerequisites(withTest, subjects)).toEqual(
      reqOr([reqCourse({ subject: "MATH", number: "1341" }), reqTest("Graduate Admission")]),
    );
  });

  it("emptyPrerequisitesAreNil", () => {
    const html = `<section aria-labelledby="preReqs"><h3>Catalog Prerequisites</h3> No prerequisite information available.</section>`;
    expect.soft(parsePrerequisites(html, subjects)).toBeNull();
  });

  it("parsesCorequisites", () => {
    const html = `<section><table class="basePreqTable"><thead><tr><th>Subject</th></tr></thead><tbody>
        <tr><td>Computer Science</td><td>3001</td><td>Recitation for CS 3000</td></tr>
        </tbody></table></section>`;
    expect.soft(parseCorequisites(html, subjects)).toEqual(reqCourse({ subject: "CS", number: "3001" }));
  });

  it("parsesDescriptionAndCatalogDetails", () => {
    const description = `<section aria-labelledby="courseDescription">
            <!--display course description-->
            Covers the derivative &amp; integration.<br/>
        </section>`;
    expect.soft(parseDescription(description)).toBe("Covers the derivative & integration.");
    const details = `<section aria-labelledby="catalog">
         <span class="status-bold">Title:</span>Algorithms and Data<br/>
         <span class="status-bold">College:</span>
         <span>Khoury Coll of Comp Sciences CS</span><br/>
         <span class="status-bold">Department:</span>
         <span>Computer Science CS</span><br/>
        </section>`;
    const parsed = parseCatalogDetails(details);
    expect.soft(parsed.title).toBe("Algorithms and Data");
    expect.soft(parsed.college).toBe("Khoury College of Computer Sciences");
    expect.soft(parsed.department).toBe("Computer Science");
  });

  it("decodesEntities", () => {
    expect.soft(decodeEntities("Fin Accounting &amp; Reporting")).toBe("Fin Accounting & Reporting");
    expect.soft(decodeEntities("O&#39;Brien &#x2014; &quot;Hi&quot;")).toBe("O'Brien — \"Hi\"");
    expect.soft(decodeEntities("AT&T")).toBe("AT&T");
  });

  it("convertsBannerMeetingTimes", () => {
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
      tuesday: false,
      wednesday: true,
      thursday: true,
      friday: false,
      saturday: false,
      sunday: false,
    });
    expect.soft(meeting.start).toBe(480);
    expect.soft(meeting.end).toBe(545);
    expect.soft(dayCompactLabel(meeting.days)).toBe("MWR");
    expect.soft(meetingLocation(meeting)).toBe("DG 070");
    expect.soft(meeting.startDate).toBe("2026-09-09");
    expect.soft(isFinalExam(meeting)).toBe(false);
  });
});
