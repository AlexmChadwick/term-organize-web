/**
 * Assemble the self-hosted Next.js standalone archive.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const version = process.argv[2] ?? JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;

if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
  throw new Error(`Refusing version ${JSON.stringify(version)}.`);
}

const standalone = path.join(root, ".next", "standalone");
const folderName = `term-organize-web-${version}`;
const releaseDir = path.join(root, "release");
const stage = path.join(releaseDir, folderName);
const archive = path.join(releaseDir, `${folderName}.tar.gz`);

await rm(stage, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
await cp(standalone, stage, { recursive: true });

const serverJs = path.join(stage, "server.js");
await readFile(serverJs);

await cp(path.join(root, ".next", "static"), path.join(stage, ".next", "static"), { recursive: true });
await cp(path.join(root, "public"), path.join(stage, "public"), { recursive: true });

const dataDir = path.join(stage, "data");
await mkdir(dataDir, { recursive: true });
const bundled = (await readdir(path.join(root, "data"))).filter((name) => /^term-\d{6}\.json\.gz$/.test(name));
if (bundled.length === 0) throw new Error("No bundled catalogs in data/.");
for (const name of bundled) {
  await cp(path.join(root, "data", name), path.join(dataDir, name));
}

for (const name of ["LICENSE", "NOTICE.md"]) {
  await cp(path.join(root, name), path.join(stage, name));
}

await writeFile(path.join(stage, "RUN.md"), runInstructions(version), "utf8");
await rm(archive, { force: true });
execFileSync("tar", ["-czf", archive, "-C", releaseDir, folderName], { stdio: "inherit" });
console.log(archive);

function runInstructions(releaseVersion) {
  return `# Term Organize ${releaseVersion}

Next.js standalone server. The browser cannot call Banner directly, so this process proxies class search and serves the bundled catalogs from \`data/\`. It is not a static site.

Source for this website: https://github.com/AlexmChadwick/term-organize-web
Upstream app: https://github.com/AlexmChadwick/Northeastern-Term-Organize

## Run

Node.js 22.

\`\`\`bash
node server.js
\`\`\`

Open http://127.0.0.1:3000. \`PORT\` changes the port (\`PORT=43123 node server.js\`).

The server needs outbound HTTPS to nubanner.neu.edu and catalog.northeastern.edu. It creates \`data/built/\` for catalogs it downloads later.

Closed-browser seat alerts stay off until \`VAPID_PUBLIC_KEY\`, \`VAPID_PRIVATE_KEY\`, and \`VAPID_SUBJECT\` are set.
`;
}
