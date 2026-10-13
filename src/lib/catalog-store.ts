import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TermCatalog } from "./models";

const memory = new Map<string, TermCatalog>();

export async function loadBundledCatalog(term: string): Promise<TermCatalog | null> {
  const cached = memory.get(term);
  if (cached) return cached;
  try {
    const file = path.join(process.cwd(), "data", `term-${term}.json.gz`);
    const json = gunzipSync(await readFile(file)).toString("utf8");
    const catalog = JSON.parse(json) as TermCatalog;
    memory.set(term, catalog);
    return catalog;
  } catch {
    return null;
  }
}
