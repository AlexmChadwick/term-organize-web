import { afterEach, describe, expect, it, vi } from "vitest";

type Filled = { filled: number; remaining: number; catalog: unknown } | null;

let outcome: () => Promise<Filled> = async () => null;
const fill = vi.fn<(term: string) => Promise<Filled>>(() => outcome());

vi.mock("@/lib/banner-server", () => ({ fillTermCourseDetails: (term: string) => fill(term) }));

const context = (term: string) => ({ params: Promise.resolve({ term }) });
const post = (term: string) => new Request(`http://localhost/api/catalog/${term}/details`, { method: "POST" });

afterEach(() => {
  fill.mockClear();
  outcome = async () => null;
});

describe("POST /api/catalog/[term]/details", () => {
  it("rejects a term that is not six digits without calling Banner", async () => {
    const { POST } = await import("./route");
    const response = await POST(post("abc"), context("abc"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Unknown term." });
    expect(fill).not.toHaveBeenCalled();
  });

  it("answers 404 naming the term when there is no catalog to fill", async () => {
    const { POST } = await import("./route");
    const response = await POST(post("209910"), context("209910"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No catalog for 209910." });
    expect(fill).toHaveBeenCalledWith("209910");
  });

  it("returns the batch result uncached", async () => {
    const result = { filled: 3, remaining: 2, catalog: { sections: [] } };
    outcome = async () => result;
    const { POST } = await import("./route");
    const response = await POST(post("209910"), context("209910"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
  });

  it("maps a Banner failure to 502 with its message, or a fallback", async () => {
    const { POST } = await import("./route");
    outcome = async () => {
      throw new Error("Banner is down.");
    };
    const failed = await POST(post("209910"), context("209910"));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Banner is down." });

    outcome = async () => {
      throw "boom";
    };
    const odd = await POST(post("209910"), context("209910"));
    expect(odd.status).toBe(502);
    expect(await odd.json()).toEqual({ error: "Couldn't read course descriptions." });
  });
});
