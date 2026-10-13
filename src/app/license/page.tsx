import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "License" };

export default async function LicensePage() {
  const text = await readFile(path.join(process.cwd(), "LICENSE"), "utf8");
  return (
    <article className="grid gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">GNU Affero General Public License</h1>
      <p className="text-sm text-muted">The same license as the Term Organize iOS and Mac app, including the portions derived from SearchNEU.</p>
      <pre className="license">{text}</pre>
    </article>
  );
}
