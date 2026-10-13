import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseKey, Term } from "@/lib/models";
import { keyId, parseCourseKey } from "@/lib/models";
import { OfferingHistoryRepository, type OfferingFetcher, type OfferingIndex } from "@/lib/offering-history";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function key(code: string): CourseKey {
  const parsed = parseCourseKey(code);
  if (!parsed) throw new Error(code);
  return parsed;
}

function terms(codes: string[]): Term[] {
  return codes.map((code) => ({ code, bannerDescription: code }));
}

const bannerTerms = terms(["202710", "202655", "202650", "202632", "202630", "202610", "202560", "202550", "202540", "202530", "202510", "202460"]);

class Clock {
  constructor(private ms = Date.now()) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(days: number) {
    this.ms += days * 86_400_000;
  }
}

class FakeBanner implements OfferingFetcher {
  calls: { term: string; courses: string[] }[] = [];
  private readonly offered = new Map<string, Set<string>>();
  private readonly down = new Set<string>();
  private readonly failWhenIncludes = new Map<string, string>();

  constructor(
    private readonly clock: Clock,
    public termList: Term[] = bannerTerms,
  ) {
    void this.clock;
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
    this.calls = [];
  }

  setTerms(next: Term[]) {
    this.termList = next;
  }

  async terms(): Promise<Term[]> {
    return this.termList;
  }

  async offeredCourses(term: string, courses: CourseKey[]): Promise<CourseKey[]> {
    this.calls.push({ term, courses: courses.map((course) => keyId(course)) });
    if (this.down.has(term)) throw new Error(`${term} is down`);
    const needle = this.failWhenIncludes.get(term);
    if (needle && courses.some((course) => keyId(course) === needle)) throw new Error(`${term} batch failed`);
    const have = this.offered.get(term) ?? new Set<string>();
    return courses.filter((course) => have.has(keyId(course)));
  }
}

async function directory(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), "offerings-"));
  directories.push(created);
  return created;
}

function repository(banner: FakeBanner, filePath: string, now: () => Date) {
  return new OfferingHistoryRepository({ fetcher: banner, filePath, now });
}

describe("OfferingHistoryRepository", () => {
  it("asks once per term about the courses and caches the past", async () => {
    const clock = new Clock();
    const banner = new FakeBanner(clock);
    for (const term of ["202710", "202610", "202510"]) banner.offer(term, ["CS 3800", "MATH 2331"]);
    for (const term of ["202630", "202530"]) banner.offer(term, ["CS 3386", "MATH 2331"]);
    banner.offer("202650", ["CS 2500"]);
    const file = path.join(await directory(), "offering-history.json");
    const keys = [key("CS 3386"), key("CS 3800"), key("MATH 2331"), key("CS 2500")];
    const history = await repository(banner, file, () => clock.now()).history(keys);
    expect(history.checkedTerms).toEqual(["202710", "202650", "202630", "202610", "202560", "202550", "202540", "202530", "202510"]);
    expect(banner.calls).toHaveLength(9);
    expect(banner.calls.every((call) => new Set(call.courses).size === keys.length && keys.every((item) => call.courses.includes(keyId(item))))).toBe(true);
    expect(history.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);
    expect(history.isLikelyOffered(key("CS 3386"), "fall")).toBe(false);
    expect(history.isLikelyOffered(key("CS 3800"), "fall")).toBe(true);
    expect(history.isLikelyOffered(key("CS 2500"), "summerA")).toBe(true);
    expect(history.summary(key("MATH 2331"))).toBe("Offered every fall and spring");
    expect(history.checkedKeys()?.map((item) => keyId(item)).sort()).toEqual(keys.map((item) => keyId(item)).sort());

    banner.resetCalls();
    await repository(banner, file, () => clock.now()).history(keys);
    expect(banner.calls).toEqual([]);
    clock.advance(30);
    const relaunched = repository(banner, file, () => clock.now());
    await relaunched.history(keys);
    expect(banner.calls.map((call) => call.term)).toEqual(["202710"]);

    banner.resetCalls();
    await relaunched.history([key("PHYS 1151"), key("CS 3386")]);
    expect(banner.calls).toHaveLength(9);
    expect(banner.calls.every((call) => call.courses.join(",") === "PHYS 1151")).toBe(true);
  });

  it("batches large questions and keeps what an earlier batch found", async () => {
    const clock = new Clock();
    const banner = new FakeBanner(clock);
    const numbers = Array.from({ length: 12 }, (_, index) => `CS ${3010 + index + 1}`);
    banner.offer("202630", numbers);
    const file = path.join(await directory(), "offering-history.json");
    const keys = numbers.map((code) => key(code));
    banner.failQuestions("202630", "CS 3022");
    const partial = await repository(banner, file, () => clock.now()).history(keys);
    expect(partial.checkedTerms.includes("202630")).toBe(false);
    expect(partial.checkedTerms.includes("202530")).toBe(true);
    expect(banner.calls.filter((call) => call.term === "202630").map((call) => call.courses.length)).toEqual([10, 2]);
    expect(banner.calls.filter((call) => call.term === "202710").map((call) => call.courses.length)).toEqual([10, 2]);

    banner.failQuestions("202630", null);
    banner.resetCalls();
    const full = await repository(banner, file, () => clock.now()).history(keys);
    expect(banner.calls.map((call) => call.term)).toEqual(["202630"]);
    expect(banner.calls[0]?.courses).toEqual(["CS 3021", "CS 3022"]);
    expect(full.checkedTerms.includes("202630")).toBe(true);
    expect(keys.every((item) => full.isLikelyOffered(item, "spring") === true)).toBe(true);
  });

  it("refreshes the current term weekly", async () => {
    const clock = new Clock();
    const banner = new FakeBanner(clock);
    const file = path.join(await directory(), "offering-history.json");
    const store = repository(banner, file, () => clock.now());
    await store.history([key("CS 3800")]);
    banner.resetCalls();
    clock.advance(6);
    await store.history([key("CS 3800")]);
    expect(banner.calls).toEqual([]);
    clock.advance(2);
    await store.history([key("CS 3800")]);
    expect(banner.calls.map((call) => call.term)).toEqual(["202710"]);
  });

  it("reads a term again when the first read was before classes began", async () => {
    const clock = new Clock(1_780_000_000_000);
    const banner = new FakeBanner(clock);
    banner.offer("202710", ["CS 3800"]);
    const file = path.join(await directory(), "offering-history.json");
    await repository(banner, file, () => clock.now()).history([key("CS 3800")]);
    expect(banner.calls.some((call) => call.term === "202710")).toBe(true);

    clock.advance(230);
    banner.resetCalls();
    banner.setTerms([...terms(["202730"]), ...bannerTerms]);
    await repository(banner, file, () => clock.now()).history([key("CS 3800")]);
    const asked = new Set(banner.calls.map((call) => call.term));
    expect(asked.has("202730")).toBe(true);
    expect(asked.has("202710")).toBe(true);
    expect(asked.has("202630")).toBe(false);
    expect(asked.has("202610")).toBe(false);

    clock.advance(60);
    banner.resetCalls();
    banner.setTerms([...terms(["202750", "202730"]), ...bannerTerms]);
    await repository(banner, file, () => clock.now()).history([key("CS 3800")]);
    expect(banner.calls.some((call) => call.term === "202710")).toBe(false);
  });

  it("omits a term that could not be reached", async () => {
    const clock = new Clock();
    const banner = new FakeBanner(clock);
    for (const term of ["202630", "202530"]) banner.offer(term, ["CS 3386"]);
    banner.fail("202630");
    const history = await repository(banner, path.join(await directory(), "offering-history.json"), () => clock.now()).history([key("CS 3386")]);
    expect(history.checkedTerms.includes("202630")).toBe(false);
    expect(history.checkedTerms.includes("202530")).toBe(true);
    expect(history.isLikelyOffered(key("CS 3386"), "spring")).toBe(true);

    const offline = new FakeBanner(clock);
    for (const term of bannerTerms) offline.fail(term.code);
    const none = await repository(offline, path.join(await directory(), "offering-history.json"), () => clock.now()).history([key("CS 3386")]);
    expect(none.checkedTerms).toEqual([]);
    expect(none.isLikelyOffered(key("CS 3386"), "spring")).toBeNull();
  });

  it("answers from a loaded catalog without a request", async () => {
    const clock = new Clock();
    const banner = new FakeBanner(clock);
    const index: OfferingIndex = {
      term: { code: "202710", bannerDescription: "Fall 2026" },
      sectionsFor: (course) => (keyId(course) === "CS 3800" ? [{}] : []),
    };
    const history = await repository(banner, path.join(await directory(), "offering-history.json"), () => clock.now()).history(
      [key("CS 3386"), key("CS 3800")],
      [index],
    );
    expect(banner.calls.some((call) => call.term === "202710")).toBe(false);
    expect(history.checkedTerms.includes("202710")).toBe(true);
    expect(history.offeredTerms(key("CS 3800")).includes("202710")).toBe(true);
    expect(history.offeredTerms(key("CS 3386")).includes("202710")).toBe(false);
  });
});
