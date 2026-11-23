# Term Organize

A browser version of [Term Organize](https://github.com/AlexmChadwick/Northeastern-Term-Organize), an unofficial Northeastern course search, schedule builder, and degree planner.

**Term Organize is unofficial. It is not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.**

This repository does not include a hosted site. Run it locally.

Course titles, descriptions, seats, and instructor names come from Northeastern’s public class search at <https://nubanner.neu.edu/StudentRegistrationSsb>. Program text comes from the public academic catalog at <https://catalog.northeastern.edu>. That material is © Northeastern University and is not covered by this project’s license. Fall 2026 and Spring 2027 ship in this repo as `data/term-202710.json.gz` and `data/term-202730.json.gz`.

## Run locally

Node.js 22.13 or newer (see `engines` in `package.json`) and npm.

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:43123>.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm start` serves the production build on the same port. Next.js prints a warning because `next.config.ts` sets `output: "standalone"`. The server still answers. CI runs `npm ci`, `typecheck`, `lint`, `test`, and `build` (see `.github/workflows/ci.yml`).

`npm run e2e` drives the flows in Chromium, once at desktop size and once at phone size. It starts `npm run dev` when nothing is already listening on port 43123. CI does not run this suite. Install the browser once:

```bash
npx playwright install chromium
npm run e2e
```

## What it does

Search, a week schedule, a degree plan, free rooms, professor calendars, and seat alerts. The header picks the term. Fall 2026 and Spring 2027 are already on disk. Any other term Banner lists is downloaded the first time you open it, with that term’s course descriptions, then cached in this browser (IndexedDB).

### Seats and waitlists

The seat line reads **Full** or **N of M open**. A section with people waiting is treated as having no seats a student can take, so it reads Full, or `0 of M open` when Banner still reports leftover seats. The waitlist size is added only when the section has a waitlist: `Waitlist 7/10` when a capacity is reported, or `Waitlist 7` when people are waiting and no capacity was reported. Sections with no waitlist do not show one.

Search totals, the open-seats filter, and “Hide full sections” use that same rule. On a schedule you can ask for any section, “Waitlist is fine”, or “Open seats only”.

### Search

Search by course code, title, instructor, or CRN. Shorthand such as `fundies`, `linalg`, and `orgo` is expanded, and a small typo still matches a longer title word. Filters: All, Undergrad, or Grad (undergrad is a course number below 5000, grad is 5000 and up), plus subject, campus, level, in person or online, open seats, honors, no prerequisites, no corequisites, NUpath, meeting days, start and end times, and a credit range. Sort by relevance, course number, title, or open seats.

When restriction lists have been loaded, a CPS-only section is labeled “Restricted to CPS (College of Professional Studies) students”. A course whose loaded sections are mixed is labeled “Some sections are CPS only”.

Course pages show the description, prerequisite and corequisite trees, and “prerequisite for”, and can refresh that course’s sections from Banner.

### Schedules

A week calendar, overlap warnings, and a generator. The survey covers days, times, format, campus, professors, blocked times, breaks, and workload. A plain-language box is parsed in the browser and is not sent to an assistant. Results are ranked, with reasons, and the page says why nothing fits. Copy CRNs, export an `.ics` file (America/New_York, including a final when the section has one), or save a PNG with Share image.

A variable-credit course, where Banner’s low and high differ, gets a whole-number stepper on that row. The default is Banner’s `creditHours` when it falls inside the range, otherwise the low end.

### Degree plan

Import a degree-audit View Plan PDF or a text file, or start a blank plan. Edit it, flag duplicate rows and missing prerequisites, total the credits, and export the same A4 Helvetica layout as a PDF or as text. A blank plan can pull courses in from the primary schedule. The same credit stepper is on variable-credit rows.

A catalog audit loads a year, program, and concentration from the academic catalog. It checks substitutions, petitions, waivers, equivalences, NUpath, and university-wide minimums. When a course is missing a prerequisite, the page can suggest another semester, using about two years of offering history.

### Rooms, professors, and alerts

Free rooms are the classrooms with no meeting in the current snapshot at the time you pick. Times are Northeastern campus time. A professor page lists that person’s sections and a teaching calendar.

Watch a section from its course page. While a tab is open, the watchlist refreshes on a timer, or when you press Check now. Browser notifications are optional. Alerts after the browser is closed need Web Push, below.

Settings stores appearance and a JSON export and import of schedules, plans, and saved courses. Those stay in `localStorage`. The catalog snapshot stays in IndexedDB.

Deep links: `/search?q=`, `/course/202730/CS/3000`, `/section/202730/<crn>`, `/schedule`, `/degree`, `/rooms`, `/professors`, `/watchlist`, `/settings`, `/legal`.

Banner and the academic catalog do not send CORS headers, so Next.js route handlers proxy them. A live course refresh is cached for a minute. Catalog HTML is cached for a week.

See [PARITY.md](PARITY.md) for how this site lines up with the Swift app.

## Instructor emails

An instructor email is kept only when the domain is exactly `northeastern.edu` or `neu.edu`. The domain must be ASCII and match one of those names after case folding, so a subdomain (`husky.neu.edu`, `coe.northeastern.edu`), a trailing dot, a non-ASCII lookalike, and any other address are dropped. Several addresses in one Banner field are split, and only the allowed ones are kept. An obfuscated address, written with words or brackets instead of `@` and `.`, is not an exact address, so it is dropped. An omitted email stays omitted.

Live Banner responses go through that filter. Bundled snapshots and catalogs cached on disk are normalized with the same filter when they are loaded or saved.

No student personal data is collected. There are no accounts and no analytics. Student addresses such as `husky.neu.edu` are not stored with instructor emails. Schedules and degree plans stay in this browser. A name or student ID printed on a degree-audit file you import stays in that browser with the plan and is not uploaded. If you turn on closed-browser seat alerts, this server stores that browser’s push subscription and the sections you are watching, and uses them only to send those alerts.

## Web Push seat alerts

Closed-browser alerts stay off until the server has a VAPID key pair. Generate one and put it in `.env.local` (that file is not committed):

```bash
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Restart the server, reopen the site, open Seat alerts, and turn on “Also alert when this browser is closed.” After each server restart, reopen the site so the sender starts, and leave the server running. With VAPID configured, the sender starts on a request to `/api/banner/terms`, `/api/push/subscribe`, or `/api/push/vapid`. It wakes about once a minute and checks Banner for subscriptions whose interval has elapsed (the watchlist setting, from 1 to 120 minutes). Subscriptions are stored in `data/built/push-subscriptions.json`. There is no account.

## License

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Portions of the schedule search, Banner parsing, and requisite handling derive from [SearchNEU](https://github.com/sandboxnu/searchneu) and stay under the same license.
