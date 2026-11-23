import { afterEach, describe, expect, it, vi } from "vitest";
import { idbGetCatalog, idbSetCatalog } from "./idb";
import type { CourseSection, Instructor, TermCatalog } from "./models";

const ALLOWED = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

const DIRTY: Instructor[] = [
  { name: "Work", primary: true, email: "person@northeastern.edu" },
  { name: "Neu", primary: false, email: "person@NEU.EDU" },
  { name: "Student", primary: false, email: "student@husky.neu.edu" },
  { name: "External", primary: false, email: "other@gmail.com" },
  { name: "Mixed", primary: false, email: "other@gmail.com person@neu.edu" },
  { name: "Dot", primary: false, email: "ed@northeastern.edu." },
  { name: "Sub", primary: false, email: "flo@coe.northeastern.edu" },
  { name: "Look", primary: false, email: "gus@northea\u017ftern.edu" },
  { name: "SmallAt", primary: false, email: "jo\uFE6Bneu.edu" },
  { name: "Omitted", primary: false },
  { name: "Null", primary: false, email: null },
];

function dirtyCatalog(): TermCatalog {
  return {
    version: 1,
    term: { code: "202730", bannerDescription: "Spring 2027 Semester" },
    generatedAt: 0,
    sectionsUpdatedAt: 0,
    courses: [],
    sections: [{ instructors: DIRTY.map((instructor) => ({ ...instructor })) } as CourseSection],
    subjects: [],
    attributes: [],
    campuses: [],
  };
}

function emailsOf(catalog: TermCatalog): (string | null | undefined)[] {
  return (catalog.sections[0]?.instructors ?? []).map((instructor) => instructor.email);
}

interface FakeRequest {
  result?: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

function later(run: () => void) {
  queueMicrotask(run);
}

/** In-memory IndexedDB. Seed the map directly to imitate a catalog cached before filtering. */
function installStub(records: Map<string, unknown> = new Map()): Map<string, unknown> {
  const db = {
    objectStoreNames: { contains: (name: string) => name === "catalogs" },
    createObjectStore() {
      return undefined;
    },
    transaction() {
      const tx = {
        error: null as unknown,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore() {
          return {
            get(key: string): FakeRequest {
              const request: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, error: null };
              later(() => {
                request.result = records.get(key);
                request.onsuccess?.();
              });
              return request;
            },
            put(value: unknown, key: string) {
              records.set(key, structuredClone(value));
            },
          };
        },
      };
      later(() => tx.oncomplete?.());
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open(): FakeRequest {
      const request: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, error: null };
      later(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  });
  return records;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IndexedDB catalog cache", () => {
  it("returns only allowed instructor addresses from a dirty cached catalog", async () => {
    const dirty = dirtyCatalog();
    installStub(new Map([["202730", dirty]]));

    const loaded = await idbGetCatalog("202730");

    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(JSON.stringify(dirty)).toContain("other@gmail.com");
    expect(emailsOf(loaded)).toEqual([
      "person@northeastern.edu",
      "person@NEU.EDU",
      undefined,
      undefined,
      "person@neu.edu",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    ]);
    const text = JSON.stringify(loaded);
    expect(text).not.toMatch(/gmail|husky|coe\.|northea\u017ftern|neu\.edu\.|\uFE6B/);
    const kept = emailsOf(loaded).filter((email): email is string => typeof email === "string");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((email) => email.split(" ").every((address) => ALLOWED.test(address)))).toBe(true);
  });

  it("stores only allowed instructor addresses", async () => {
    const records = installStub();
    await idbSetCatalog("202730", dirtyCatalog());
    const stored = records.get("202730") as TermCatalog;
    expect(emailsOf(stored)).toEqual([
      "person@northeastern.edu",
      "person@NEU.EDU",
      undefined,
      undefined,
      "person@neu.edu",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/gmail|husky/);
  });
});
