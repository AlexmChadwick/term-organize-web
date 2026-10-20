import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Instructor, TermCatalog } from "./models";

const memory = new Map<string, TermCatalog>();

/** Whole address, exact domain. Subdomains such as husky.neu.edu do not match. */
const EXACT_WORK_EMAIL = /^[^\s@]+@(?:northeastern\.edu|neu\.edu)$/i;

/**
 * Banner sometimes stores several addresses in one instructor field. Keep only
 * addresses whose domain is exactly northeastern.edu or neu.edu. A single
 * published address is left as it is, so the Fall 2026 snapshot is unchanged.
 * An omitted email stays omitted: this never fills one in.
 */
export function publishedInstructorEmail(email: string): string | undefined {
  if (!/\s/.test(email)) return email;
  const kept = email.split(/\s+/).filter((part) => EXACT_WORK_EMAIL.test(part));
  return kept.length > 0 ? kept.join(" ") : undefined;
}

/** Accepts instructors that omit `email` instead of writing null. */
export function normalizeBundledCatalog(catalog: TermCatalog): TermCatalog {
  for (const section of catalog.sections) {
    for (const instructor of section.instructors ?? []) {
      acceptInstructorEmail(instructor);
    }
  }
  return catalog;
}

function acceptInstructorEmail(instructor: Instructor): void {
  if (!("email" in instructor)) return;
  const email = instructor.email;
  if (typeof email !== "string") return;
  const next = publishedInstructorEmail(email);
  if (next === undefined) delete instructor.email;
  else if (next !== email) instructor.email = next;
}

function bundledPath(term: string): string {
  return path.join(process.cwd(), "data", `term-${term}.json.gz`);
}

export function builtCatalogPath(term: string): string {
  return path.join(process.cwd(), "data", "built", `term-${term}.json`);
}

export async function loadBundledCatalog(term: string): Promise<TermCatalog | null> {
  const cached = memory.get(`bundled:${term}`);
  if (cached) return cached;
  try {
    const json = gunzipSync(await readFile(bundledPath(term))).toString("utf8");
    const catalog = normalizeBundledCatalog(JSON.parse(json) as TermCatalog);
    memory.set(`bundled:${term}`, catalog);
    return catalog;
  } catch {
    return null;
  }
}

export async function loadBuiltCatalog(term: string): Promise<TermCatalog | null> {
  const cached = memory.get(`built:${term}`);
  if (cached) return cached;
  try {
    const catalog = JSON.parse(await readFile(builtCatalogPath(term), "utf8")) as TermCatalog;
    memory.set(`built:${term}`, catalog);
    return catalog;
  } catch {
    return null;
  }
}

/** Term codes that have a bundled snapshot or a catalog built from Banner. */
export async function listStoredTermCodes(): Promise<string[]> {
  const codes = new Set<string>();
  const roots = [path.join(process.cwd(), "data"), path.join(process.cwd(), "data", "built")];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const match = name.match(/^term-(\d{6})\.json(?:\.gz)?$/);
      if (match?.[1]) codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

export async function saveBuiltCatalog(catalog: TermCatalog): Promise<void> {
  const file = builtCatalogPath(catalog.term.code);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(catalog));
  memory.set(`built:${catalog.term.code}`, catalog);
}

function freshness(catalog: TermCatalog): [number, number] {
  return [catalog.sectionsUpdatedAt ?? 0, catalog.courses.filter((course) => course.detailsLoaded).length];
}

/** The downloaded catalog when it is newer than the bundled snapshot, otherwise the snapshot. */
export async function loadBestCatalog(term: string): Promise<TermCatalog | null> {
  const bundled = await loadBundledCatalog(term);
  const built = await loadBuiltCatalog(term);
  if (bundled && built) {
    const [builtAt, builtDetails] = freshness(built);
    const [bundledAt, bundledDetails] = freshness(bundled);
    if (builtAt > bundledAt || (builtAt === bundledAt && builtDetails >= bundledDetails)) return built;
    return bundled;
  }
  return built ?? bundled;
}

/** `term-202710.catalog` → `202710`. Port of `CatalogArchive.termCode(fromFileName:)`. */
export function catalogTermCodeFromFileName(name: string): string | null {
  const extension = ".catalog";
  if (!name.startsWith("term-") || !name.endsWith(extension)) return null;
  const code = name.slice("term-".length, -extension.length);
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * Catalog archive round trip. The iOS app compresses with LZFSE; this port writes JSON,
 * which `CatalogArchive.decode` also accepts when the payload starts with `{`.
 */
export function encodeCatalogArchive(catalog: TermCatalog): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(catalog));
}

export function decodeCatalogArchive(data: Uint8Array): TermCatalog {
  if (data[0] !== 0x7b) throw new Error("Compressed catalog archives need the JSON form.");
  return JSON.parse(new TextDecoder().decode(data)) as TermCatalog;
}
