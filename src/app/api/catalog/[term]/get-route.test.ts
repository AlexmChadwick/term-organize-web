import { afterEach, describe, expect, it, vi } from "vitest";
import type { TermCatalog } from "@/lib/models";

let stored: TermCatalog | null = null;

vi.mock("@/lib/catalog-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/catalog-store")>()),
  loadBestCatalog: async () => stored,
}));

const context = (term: string) => ({ params: Promise.resolve({ term }) });
const request = (term: string) => new Request(`http://localhost/api/catalog/${term}`);

afterEach(() => {
  stored = null;
});

describe("GET /api/catalog/[term]", () => {
  it("rejects a term that is not six digits without loading anything", async () => {
    const { GET } = await import("./route");
    for (const term of ["2027", "20273a", "2027300", ""]) {
      const response = await GET(request(term), context(term));
      expect(response.status, term).toBe(404);
      expect(await response.json()).toEqual({ error: "Unknown term." });
    }
  });

  it("answers 404 naming the term when no catalog is stored", async () => {
    const { GET } = await import("./route");
    const response = await GET(request("209910"), context("209910"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No catalog for 209910." });
  });

  it("returns the stored catalog with a short private cache header", async () => {
    stored = { term: { code: "209910", description: "Test" }, sections: [] } as unknown as TermCatalog;
    const { GET } = await import("./route");
    const response = await GET(request("209910"), context("209910"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(await response.json()).toEqual(stored);
  });
});
