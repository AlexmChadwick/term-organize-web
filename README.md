# Term Organize

A browser version of [Term Organize](https://github.com/AlexmChadwick/Northeastern-Term-Organize), the unofficial Northeastern course search, schedule builder, and degree planner.

**Not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.**

Course titles, descriptions, seats, and instructor names come from Northeastern’s public class search and academic catalog. That data is © Northeastern University and is not covered by this project’s license. The Fall 2026 and Spring 2027 snapshots in `data/` were converted from the app’s bundled catalogs.

## Install

Term Organize is an early beta. It is unofficial and not affiliated with Northeastern University. There is no hosted version yet, so you run it on your own computer.

- **From source:** follow "Run locally" below (Node.js 22 and npm).
- **Standalone build:** when available, the [Releases page](https://github.com/AlexmChadwick/term-organize-web/releases) has `term-organize-web-<version>.tar.gz`. Unpack it and run `node server.js`. `RUN.md` in the archive has the details.

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:43123.

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

`npm run e2e` starts the dev server if it is not already running and drives the main flows in Chromium. Install the browser once with `npx playwright install chromium`.

## What it does

- Search any term Banner lists. Fall 2026 and Spring 2027 ship with the site. Another term is downloaded the first time you open it, including that term’s own course descriptions, cached in IndexedDB, and searched the same way, including shorthand (`fundies`, `linalg`), small typos, and CRNs.
- Course pages with descriptions, prerequisite and corequisite trees, “prerequisite for,” and a live Banner refresh of sections and seats.
- A week calendar, conflict checks, a constraint search with a preferences survey and a deterministic reading of plain-language wishes, ranked options with reasons, an explanation when nothing fits, `.ics` export, a PNG of the week, and copyable CRNs.
- Degree plans: import a degree-audit View Plan PDF or text file, edit it, flag duplicates and missing prerequisites, total the credits, export the same A4 layout, and pull courses in from a schedule. When a course is missing a prerequisite, the page suggests a semester to move it to, using about two years of offering history.
- A catalog audit for a year, program, and concentration, including substitutions, petitions, waivers, equivalences, NUpath, and university-wide minimums.
- Free rooms and professor teaching calendars from the snapshot.
- A seat watch that refreshes while a tab is open and can post a browser notification. With Web Push configured, the same alert is sent after the browser is closed.
- Deep links: `/search?q=`, `/course/202710/CS/3000`, `/section/202710/<crn>`, `/schedule`.
- Settings, the AGPL text, and JSON export/import. Schedules and plans stay in `localStorage`. The catalog snapshot is cached in IndexedDB.

Banner and the academic catalog do not send CORS headers, so Next.js route handlers proxy them and cache course refreshes for a minute and catalog HTML for a week.

See [PARITY.md](PARITY.md) for how each part of the Swift app maps onto this site, including what stays on iOS (widgets, Siri, Spotlight, Live Activities, iCloud).

## Web Push seat alerts

Closed-browser alerts are off until the server has a VAPID key pair. Generate one and put it in `.env.local` (that file is not committed):

```bash
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Restart the server, open Seat alerts, and turn on “Also alert when this browser is closed.” The server stores that browser’s push subscription and the CRNs you are watching in `data/built/push-subscriptions.json`, and checks Banner about once a minute for subscriptions that are due. It uses them only to send those alerts. There is no account.

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Portions of the schedule search, Banner parsing, and requisite handling derive from [SearchNEU](https://github.com/sandboxnu/searchneu) and stay under the same license.
