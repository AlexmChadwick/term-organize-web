import { afterEach, describe, expect, it, vi } from "vitest";
import type { TermCatalog } from "@/lib/models";

const saved: TermCatalog[] = [];

vi.mock("@/lib/catalog-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/catalog-store")>()),
  loadBestCatalog: async () => null,
  saveBuiltCatalog: async (catalog: TermCatalog) => {
    saved.push(catalog);
  },
}));

const FACULTY = [
  { displayName: "Kept, Ada", emailAddress: "Ada.Lovelace@Northeastern.EDU", primaryIndicator: true },
  { displayName: "Neu, Bo", emailAddress: "bo@neu.edu", primaryIndicator: false },
  { displayName: "Student, Cy", emailAddress: "cy@husky.neu.edu", primaryIndicator: false },
  { displayName: "External, Di", emailAddress: "di@gmail.com", primaryIndicator: false },
  { displayName: "Dot, Ed", emailAddress: "ed@northeastern.edu.", primaryIndicator: false },
  { displayName: "Sub, Flo", emailAddress: "flo@coe.northeastern.edu", primaryIndicator: false },
  { displayName: "Look, Gus", emailAddress: "gus@northeaſtern.edu", primaryIndicator: false },
  { displayName: "Mixed, Hy", emailAddress: "hy@gmail.com hy@neu.edu", primaryIndicator: false },
];

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
}

function mockBanner() {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("term/search")) return json({}, { "Set-Cookie": "JSESSIONID=abc; Path=/" });
    if (url.includes("searchResults/searchResults")) {
      return json({
        totalCount: 1,
        data: [
          {
            courseReferenceNumber: "12345",
            subject: "CS",
            courseNumber: "1000",
            courseTitle: "Test",
            meetingsFaculty: [{ faculty: FACULTY, meetingTime: null }],
          },
        ],
      });
    }
    return json([]);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  saved.length = 0;
});

describe("POST /api/catalog/[term]", () => {
  it("returns and saves only exact institutional instructor emails", async () => {
    mockBanner();
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/catalog/209910", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ term: "209910" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as TermCatalog;
    const returned = body.sections.flatMap((section) => section.instructors ?? []);
    expect(returned).toHaveLength(FACULTY.length);
    const emails = Object.fromEntries(returned.map((person) => [person.name, person.email]));
    expect(emails["Kept, Ada"]).toBe("Ada.Lovelace@Northeastern.EDU");
    expect(emails["Neu, Bo"]).toBe("bo@neu.edu");
    expect(emails["Mixed, Hy"]).toBe("hy@neu.edu");
    for (const name of ["Student, Cy", "External, Di", "Dot, Ed", "Sub, Flo", "Look, Gus"]) {
      expect(name in emails && emails[name] != null, name).toBe(false);
    }
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/husky|gmail|northeaſtern|coe\.|ed@/);
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0])).toBe(text);
  });
});
