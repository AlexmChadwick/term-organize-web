import { afterEach, describe, expect, it, vi } from "vitest";

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

const ANY_ADDRESS = /[^\s@"<>,;\\]+@[^\s@"<>,;\\]+/g;
const ALLOWED = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

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
        data: [{ courseReferenceNumber: "12345", subject: "CS", courseNumber: "1000", courseTitle: "Test", meetingsFaculty: [{ faculty: FACULTY, meetingTime: null }] }],
      });
    }
    if (url.includes("getFacultyMeetingTimes")) return json({ fmt: [{ faculty: FACULTY }] });
    return json([]);
  });
}

function expectOnlyAllowedAddresses(text: string) {
  const found = text.match(ANY_ADDRESS) ?? [];
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((address) => !ALLOWED.test(address))).toEqual([]);
  expect(text).not.toMatch(/husky|gmail|northeaſtern|coe\.|ed@/);
  expect(text).toContain("Ada.Lovelace@Northeastern.EDU");
  expect(text).toContain("bo@neu.edu");
}

afterEach(() => vi.unstubAllGlobals());

describe("Banner routes expose only exact institutional emails", () => {
  it("GET /api/banner/course", async () => {
    mockBanner();
    const { GET } = await import("./course/route");
    const response = await GET(new Request("http://localhost/api/banner/course?term=209911&subject=CS&number=1000"));
    expect(response.status).toBe(200);
    expectOnlyAllowedAddresses(await response.text());
  });

  it("POST /api/banner/watch", async () => {
    mockBanner();
    const { POST } = await import("./watch/route");
    const request = new Request("http://localhost/api/banner/watch", {
      method: "POST",
      body: JSON.stringify({ term: "209912", courses: [{ subject: "CS", number: "1000" }] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expectOnlyAllowedAddresses(await response.text());
  });
});
