# Term Organize

A browser version of [Term Organize](https://github.com/AlexmChadwick/Northeastern-Term-Organize), the unofficial Northeastern course search, schedule builder, and degree planner.

**Not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.**

Course titles, descriptions, seats, and instructor names come from Northeastern’s public class search and academic catalog. That data is © Northeastern University and is not covered by this project’s license. The Fall 2026 snapshot in `data/` was converted from the app’s bundled catalog.

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

- Search the bundled term with shorthand (`fundies`, `linalg`) and small typos, plus subject, NUpath, level, campus, time, and seat filters.
- Course pages with descriptions, prerequisite and corequisite trees, “prerequisite for,” and a live Banner refresh of sections and seats.
- A week calendar, conflict checks, a constraint search with a preferences survey and a deterministic reading of plain-language wishes, ranked options with reasons, an explanation when nothing fits, `.ics` export, a PNG of the week, and copyable CRNs.
- Degree plans: import a degree-audit View Plan PDF or text file, edit it, flag duplicates and missing prerequisites, total the credits, export the same A4 layout, and pull courses in from a schedule.
- A catalog audit for a year, program, and concentration, including substitutions, petitions, waivers, equivalences, NUpath, and university-wide minimums.
- Free rooms and professor teaching calendars from the snapshot.
- A seat watch that refreshes while a tab is open and can post a browser notification.
- Deep links: `/search?q=`, `/course/202710/CS/3000`, `/section/202710/<crn>`, `/schedule`.
- Settings, the AGPL text, and JSON export/import. Schedules and plans stay in `localStorage`. The catalog snapshot is cached in IndexedDB.

Banner and the academic catalog do not send CORS headers, so Next.js route handlers proxy them and cache course refreshes for a minute and catalog HTML for a week.

See [PARITY.md](PARITY.md) for how each part of the Swift app maps onto this site, including what stays on iOS (widgets, Siri, Spotlight, Live Activities, iCloud).

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Portions of the schedule search, Banner parsing, and requisite handling derive from [SearchNEU](https://github.com/sandboxnu/searchneu) and stay under the same license.
