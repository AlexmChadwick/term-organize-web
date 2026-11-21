import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCatalogArchive, encodeCatalogArchive, loadBuiltCatalog, loadBundledCatalog, saveBuiltCatalog } from "./catalog-store";
import type { CourseSection, TermCatalog } from "./models";

const DIRTY = ["ok@northeastern.edu", "stu@husky.neu.edu", "ext@gmail.com", "trail@neu.edu.", "ok@neu.edu ext@gmail.com"];
const EXPECTED = ["ok@northeastern.edu", undefined, undefined, undefined, "ok@neu.edu"];

function dirtyCatalog(code: string): TermCatalog {
  return {
    version: 1,
    term: { code, bannerDescription: "Test" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses: [],
    sections: [{ instructors: DIRTY.map((email, index) => ({ name: `P${index}`, primary: index === 0, email })) } as CourseSection],
    subjects: [],
    attributes: [],
    campuses: [],
  };
}

function emails(catalog: TermCatalog): (string | null | undefined)[] {
  return (catalog.sections[0]?.instructors ?? []).map((instructor) => instructor.email);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "catalog-store-"));
  mkdirSync(path.join(dir, "data", "built"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("catalog store normalizes dirty data on every path", () => {
  it("saveBuiltCatalog writes a clean file", async () => {
    await saveBuiltCatalog(dirtyCatalog("990001"));
    const onDisk = readFileSync(path.join(dir, "data", "built", "term-990001.json"), "utf8");
    expect(emails(JSON.parse(onDisk) as TermCatalog)).toEqual(EXPECTED);
    expect(onDisk).not.toMatch(/husky|gmail|neu\.edu\./);
  });

  it("loadBundledCatalog cleans a dirty bundled .gz", async () => {
    writeFileSync(path.join(dir, "data", "term-990002.json.gz"), gzipSync(JSON.stringify(dirtyCatalog("990002"))));
    const catalog = await loadBundledCatalog("990002");
    expect(catalog && emails(catalog)).toEqual(EXPECTED);
  });

  it("loadBuiltCatalog cleans a dirty built JSON", async () => {
    writeFileSync(path.join(dir, "data", "built", "term-990003.json"), JSON.stringify(dirtyCatalog("990003")));
    const catalog = await loadBuiltCatalog("990003");
    expect(catalog && emails(catalog)).toEqual(EXPECTED);
  });

  it("encode and decode round trip emit only clean emails", () => {
    const encoded = encodeCatalogArchive(dirtyCatalog("990004"));
    expect(emails(JSON.parse(new TextDecoder().decode(encoded)) as TermCatalog)).toEqual(EXPECTED);
    const dirtyBytes = new TextEncoder().encode(JSON.stringify(dirtyCatalog("990004")));
    expect(emails(decodeCatalogArchive(dirtyBytes))).toEqual(EXPECTED);
    expect(emails(decodeCatalogArchive(encoded))).toEqual(EXPECTED);
  });
});
