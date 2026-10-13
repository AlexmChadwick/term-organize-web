# Feature parity

This site ports the user-facing behavior of Term Organize that a browser can do. Logic that the Swift app tests (search, Banner HTML, degree-plan text, schedule search, degree audit, NUpath, rooms, watchlist comparison) lives in `src/lib` and is covered by `src/lib/core.test.ts` plus the ported modules’ own structure. Native-only surfaces are called out below.

**Not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.**

| Swift area | Web | Status |
| --- | --- | --- |
| `Core/Models` (courses, sections, days, requisites, terms, colors) | `src/lib/models.ts` | Ported |
| `Core/Banner` client, parsers, catalog builder | `src/lib/banner.ts`, `src/lib/banner-server.ts`, `src/app/api/banner/*` | Ported. The server holds the Banner cookie. Course HTML is cached for 60 seconds. |
| `Core/ProgramCatalog` | `src/lib/degree/catalog-parser.ts`, `src/app/api/catalog-site` | Ported. HTML is cached for a week. |
| `Logic/Search` (typos, shorthand, filters, index) | `src/lib/search.ts`, `src/lib/catalog-index.ts`, `/search` | Ported |
| Course page: description, requisite trees, postreqs, sections, seats | `/course/[term]/[subject]/[number]` | Ported. Opening a course refreshes seats from Banner. |
| Section page and CRN links | `/section/[term]/[crn]` | Ported for CRNs in the bundled snapshot. A CRN that exists only on Banner is reached from the refreshed course page. |
| Schedule plans, week calendar, conflicts | `/schedule` | Ported |
| Constraint generator, scoring, reasons, empty explanations, relaxations | `src/lib/schedule/*` | Ported. The page keeps 12 results and stops a search that runs past about a second so the tab stays responsive. Very large combinations can be sampled, and the page says when the search was not exhaustive. |
| Preferences survey | `/schedule` | Ported (time of day, limits, days off, format, seats, campus, hide-full). |
| Natural-language preferences (`ScheduleAssistant`, Apple Intelligence) | `src/lib/nl.ts` | Web substitute. A deterministic reader uses the same cues (times, days off, lunch, format, seats). It does not call a model. |
| Export `.ics`, copy CRNs, share image | `/schedule` | Ported. The image is a PNG download. |
| Degree-plan text import/export | `src/lib/degree-format.ts` | Ported, including the View Plan line layout. |
| Degree-plan PDF import | `src/lib/pdf-text.ts` (pdf.js) | Ported in the browser. |
| Degree-plan PDF export (A4, Helvetica 12 pt, dash bullets) | `src/lib/degree-pdf.ts` | Ported |
| Plan editing, credits, duplicate and prerequisite checks, autofill | `/degree` | Ported |
| Semester-move suggestions (`DegreePlanReordering`, offering history) | `src/lib/degree/reordering.ts` | Partial. The suggestions and stable semester ids are ported and tested. The page does not list them: a useful history needs several terms of Banner data, and this site ships one snapshot. Move a course by editing its semester. |
| Degree audit, optimal matching, substitutions, petitions, waivers | `src/lib/degree/audit.ts` | Ported. A petition is a replacement on a requirement; a waiver removes it; “count a course” forces a placement. |
| NUpath and university-wide minimums | `src/lib/degree/nupath.ts`, catalog university-wide page | Ported. GPA and residency stay unchecked because a plan has no grades, matching the app. |
| Equivalences and renumbered courses | `src/lib/equivalences.ts`, degree plan editor | Ported. Declare “CS 2500 counts as CS 2510” on the plan. |
| Older-term catalog checks | Catalog year picker on `/degree` | Ported when catalog.northeastern.edu answers. Only Fall 2026 has a full course snapshot; other terms refresh one course at a time from Banner. |
| Seat watch | `/watchlist`, `src/lib/watchlist.ts` | Partial. The tab polls Banner on a timer and can show a Web Notification (service worker in `public/sw.js`). A closed browser cannot poll. There is no VAPID push server. |
| Free rooms | `/rooms` | Ported from the snapshot’s meetings, in campus time. |
| Professors and teaching calendars | `/professors`, `/professor/[name]` | Ported from section instructors in the snapshot. |
| Home, recents, saved courses, up next | `/` | Ported. Up next is the web stand-in for the widget. |
| Settings, onboarding, calendar hours, weekends, dark mode | `/settings` and the header | Ported |
| Legal text, AGPL, SearchNEU attribution | `/legal`, `/license`, `NOTICE.md` | Ported |
| Persistence | `localStorage` (`term-organize.user.v1`), IndexedDB catalog cache, JSON export/import | Web substitute for on-device storage. |
| Deep links (`AppLink`) | `/course/202710/CS/3000`, `/section/202710/<crn>`, `/schedule`, `/search?q=` | Ported as URLs. |
| `DesignSystem` (accent, course colors, radius, dark mode) | `src/app/globals.css`, `COURSE_PALETTE` | Ported in spirit: Northeastern red `#C8102E` / `#F24555`, 22 px cards, the same course palette. |
| iCloud / CloudKit (`Services/CloudSync`) | JSON export/import | Omitted. There is no account and no cross-device sync. |
| Widgets (`NEUClassSearchWidgets`) | Up next on the home page | Omitted as home-screen widgets. |
| Live Activities | Up next while the tab is open | Omitted. |
| Siri / App Intents / Spotlight | Site search and URLs | Omitted. |
| Mac-only windows, menus, and multi-window course UI | Responsive pages | Omitted. The same tasks are pages. |
| Catalog snapshot tool (`Tools/CatalogSnapshot`) | `data/term-202710.json.gz` served by `/api/catalog/[term]` | The Fall 2026 snapshot ships with the site. Regenerating it is still the Swift tool. |

## Tests

Swift test files and what this repo runs:

| Swift tests | Web |
| --- | --- |
| `CoreModelTests` (terms, keys, days, times, requisites, instructor names) | `src/lib/core.test.ts` |
| `BannerParserTests` (nested prereqs, coreqs, description, catalog details, entities, meetings) | `src/lib/core.test.ts` |
| `SearchEngineTests` (aliases, typo, CRN) | A focused slice in `src/lib/core.test.ts`. The engine is `src/lib/search.ts`. |
| `DegreePlanTests` (View Plan import, rejection, text round-trip) | `src/lib/core.test.ts`, plus a PDF header check |
| `ScheduleGeneratorTests` / scoring / preferences | One conflict-free case and one overlap explanation in `src/lib/core.test.ts`. The generator is the Swift port in `src/lib/schedule/generator.ts`. |
| `DegreeRequirementsTests`, `DegreeAuditMatchingTests`, `DegreeNUpathTests`, substitution presentation, offering history | A representative slice in `src/lib/degree/port-check.test.ts` (program-page parse, audit matching, NUpath 13 of 13, equivalences, renumbering, reorder). The rest of those fixture files are not re-transcribed assertion by assertion. |
| `PrerequisiteDataTests` | Not re-transcribed (about two thousand lines of fixture HTML). The parser those tests lock is `parsePrerequisites`. Reorder cases from that file are covered in `port-check.test.ts`. |
| `CloudSyncTests` | Omitted with iCloud. `mergeUserData` still tolerates a broken JSON import. |
| Playwright | `e2e/main.spec.ts` covers home, search, a course, a section, the schedule, rooms, settings, and the legal notice. |
