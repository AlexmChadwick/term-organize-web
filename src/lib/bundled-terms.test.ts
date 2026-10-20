import { describe, expect, it } from "vitest";
import { bundledTermOptions, initialTermCode, mergeTermOptions, newestBundledTermCode } from "./bundled-terms";

describe("bundled term selection", () => {
  it("defaults a fresh session to the newest bundled term", () => {
    expect(newestBundledTermCode()).toBe("202730");
    expect(newestBundledTermCode(["202710", "202730"])).toBe("202730");
    expect(newestBundledTermCode(["202730", "202710"])).toBe("202730");
    expect(initialTermCode(undefined)).toBe("202730");
    expect(initialTermCode(null)).toBe("202730");
    expect(initialTermCode("")).toBe("202730");
    expect(initialTermCode("202710")).toBe("202710");
  });

  it("lists both bundled snapshots in the term picker", () => {
    expect(bundledTermOptions().map((term) => term.code)).toEqual(["202730", "202710"]);
    expect(bundledTermOptions().every((term) => term.bundled)).toBe(true);

    const fromBanner = mergeTermOptions(
      [
        { code: "202730", name: "Spring 2027" },
        { code: "202710", name: "Fall 2026" },
        { code: "202650", name: "Summer 2026" },
      ],
      ["202710", "202730"],
    );
    expect(fromBanner.map((term) => term.code)).toEqual(["202730", "202710", "202650"]);
    expect(fromBanner.filter((term) => term.bundled).map((term) => term.code)).toEqual(["202730", "202710"]);

    const missingSpring = mergeTermOptions(
      [
        { code: "202710", name: "Fall 2026" },
        { code: "202650", name: "Summer 2026" },
      ],
      ["202710", "202730"],
    );
    expect(missingSpring.map((term) => term.code)).toEqual(["202730", "202710", "202650"]);
    expect(missingSpring[0]).toEqual({ code: "202730", name: "Spring 2027", bundled: true });
  });
});
