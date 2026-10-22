import { describe, expect, it } from "vitest";
import { CPS_ONLY_NOTE, CPS_SOME_NOTE, courseCpsNote, parseRestrictions, sectionIsCpsOnly } from "@/lib/restrictions";

const uc = "CPS - Undergraduate Semester (UC)";

function page(heading: string, values: string[]): string {
  const items = values.map((value) => `<li>${value}</li>`).join("");
  return `<h3>${heading}</h3><ul>${items}</ul>`;
}

describe("section restrictions", () => {
  it("parses must and cannot lists", () => {
    const html = `${page("Must be enrolled in one of the following Levels:", [uc])}${page("Cannot be enrolled in one of the following Colleges:", ["College of Engineering"])}`;
    expect(parseRestrictions(html)).toEqual([
      { kind: "must", category: "Levels", values: [uc] },
      { kind: "cannot", category: "Colleges", values: ["College of Engineering"] },
    ]);
  });

  it("treats only-CPS levels or colleges as CPS-only and ignores cannot lists", () => {
    const onlyUc = parseRestrictions(page("Must be enrolled in one of the following Levels:", [uc]));
    const mixed = parseRestrictions(page("Must be enrolled in one of the following Levels:", [uc, "Undergraduate", "Graduate"]));
    const college = parseRestrictions(page("Must be enrolled in one of the following Colleges:", ["College of Professional Studies"]));
    const cannot = parseRestrictions(page("Cannot be enrolled in one of the following Levels:", [uc]));
    expect(sectionIsCpsOnly(onlyUc)).toBe(true);
    expect(sectionIsCpsOnly(mixed)).toBe(false);
    expect(sectionIsCpsOnly(college)).toBe(true);
    expect(sectionIsCpsOnly(cannot)).toBe(false);
    expect(sectionIsCpsOnly([])).toBe(false);
    expect(sectionIsCpsOnly(null)).toBeNull();
    expect(sectionIsCpsOnly(undefined)).toBeNull();
  });

  it("shows the full note only when every loaded section is CPS-only", () => {
    const cps = parseRestrictions(page("Must be enrolled in one of the following Levels:", [uc]));
    const open = parseRestrictions(page("Must be enrolled in one of the following Levels:", [uc, "Undergraduate"]));
    expect(courseCpsNote([])).toBeNull();
    expect(courseCpsNote([{ restrictions: null }, { restrictions: undefined }])).toBeNull();
    expect(courseCpsNote([{ restrictions: cps }, { restrictions: null }])).toBe(CPS_ONLY_NOTE);
    expect(courseCpsNote([{ restrictions: cps }, { restrictions: cps }])).toBe(CPS_ONLY_NOTE);
    expect(courseCpsNote([{ restrictions: cps }, { restrictions: open }])).toBe(CPS_SOME_NOTE);
    expect(courseCpsNote([{ restrictions: open }])).toBeNull();
  });
});
