# Feature parity

This site ports the user-facing behavior of Term Organize that a browser can do. The Swift test suites are ported assertion by assertion (see Tests). Native-only surfaces are called out below.

**Not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.**

| Swift area | Web | Status |
| --- | --- | --- |
| `Core/Models` (courses, sections, days, requisites, terms, colors) | `src/lib/models.ts` | Ported |
| `Core/Banner` client, parsers, catalog builder | `src/lib/banner.ts`, `src/lib/banner-server.ts`, `src/app/api/banner/*`, `src/app/api/catalog/[term]` | Ported. The server holds the Banner cookie. Course HTML is cached for 60 seconds. `POST /api/catalog/:term` downloads every section of any term Banner lists (`CatalogBuilder.merge` / `CatalogRepository.syncTerm`) and keeps it on disk. The browser keeps a copy in IndexedDB. |
| `Core/ProgramCatalog` | `src/lib/degree/catalog-parser.ts`, `src/app/api/catalog-site` | Ported. HTML is cached for a week. |
| `Logic/Search` (typos, shorthand, filters, index) | `src/lib/search.ts`, `src/lib/catalog-index.ts`, `/search` | Ported |
| Course page: description, requisite trees, postreqs, sections, seats | `/course/[term]/[subject]/[number]` | Ported. Opening a course refreshes seats from Banner. A course the open term does not list is read from Banner’s course catalog (`CourseCatalogEntryView`): title, credits, prerequisites, and corequisites, with a note when it is not offered this term or was retired. |
| Section page and CRN links | `/section/[term]/[crn]` | Ported. Opening a term that is not on disk builds that term’s catalog, then the CRN is resolved in it. |
| Schedule plans, week calendar, conflicts | `/schedule` | Ported |
| Constraint generator, scoring, reasons, empty explanations, relaxations | `src/lib/schedule/*` | Ported. The page uses the Swift limits (5,000 results, 0.9s exhaustive pass, then a sample) and runs the search in a Web Worker. The week is browsed one option at a time. Very large combinations can be sampled, and the page says when the search was not exhaustive. |
| Preferences survey | `/schedule` | Ported. Time of day, limits and how strict they are, days off, class-day layout, blocked times, breaks, gaps, lunch length, classes and hours per day, format, seats, campus, professors, a credit target, and hide-full. |
| Natural-language preferences (`ScheduleAssistant`, Apple Intelligence) | `src/lib/nl.ts` | Web substitute. A deterministic reader uses the same cues (times, days off, lunch, format, seats). It does not call a model. |
| Export `.ics`, copy CRNs, share image | `/schedule` | Ported. The image is a PNG download. |
| Degree-plan text import/export | `src/lib/degree-format.ts` | Ported, including the View Plan line layout. |
| Degree-plan PDF import | `src/lib/pdf-text.ts` (pdf.js) | Ported in the browser. |
| Degree-plan PDF export (A4, Helvetica 12 pt, dash bullets) | `src/lib/degree-pdf.ts` | Ported |
| Plan editing, credits, duplicate and prerequisite checks, autofill | `/degree` | Ported. Prerequisites the open term does not list come from Banner’s course catalog (`CourseInfoStore.requisiteLookup`). |
| Semester-move suggestions (`DegreePlanReordering`, offering history) | `src/lib/degree/reordering.ts`, `src/lib/offering-history.ts`, `/api/banner/offerings` | Ported. The degree plan lists a move when a course is missing a prerequisite or has no section in the open term. An empty schedule lists the same moves for the blocking courses when a degree-plan semester matches the term. History covers about two years of Northeastern terms, summers included, and is cached. |
| Degree audit, optimal matching, substitutions, petitions, waivers | `src/lib/degree/audit.ts` | Ported. A petition is a replacement on a requirement; a waiver removes it; “count a course” forces a placement. |
| NUpath and university-wide minimums | `src/lib/degree/nupath.ts`, catalog university-wide page, `CourseAttributeRepository` | Ported. Attributes for a course the open term has no sections of are looked up from recent terms. GPA and residency stay unchecked because a plan has no grades, matching the app. |
| Equivalences and renumbered courses | `src/lib/equivalences.ts`, `src/lib/degree/suggestions.ts`, degree plan editor | Ported. Declare “CS 2500 counts as CS 2510” on the plan. A course the newest catalog no longer lists can prompt “Does CS 2510 count as CS 2100?” (Confirm or Dismiss). A substitution that is likely a renumbering can become “Same course, new number.” |
| Older-term catalog checks | Catalog year picker on `/degree`, on-demand term catalogs, `POST /api/banner/course-info` | Ported. Catalog years come from catalog.northeastern.edu. Course sections for any Banner term are downloaded on demand, and each course’s description is read from that term. Catalog entries (prerequisites, credits, mutual exclusions) for a course the term does not list are fetched from Banner’s effective-dated catalog and cached on disk. |
| Seat watch | `/watchlist`, `src/lib/watchlist.ts`, `src/lib/push-sender.ts` | Ported. The tab polls Banner on a timer. With `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` set, a service worker and an in-process sender deliver the same alert after the browser is closed. Without those keys, closed-browser alerts stay off. |
| Free rooms | `/rooms` | Ported from the snapshot’s meetings, in campus time. |
| Professors and teaching calendars | `/professors`, `/professor/[name]` | Ported from section instructors in the snapshot. |
| Home, recents, saved courses, up next | `/` | Ported. Saving a course from its page lists it on the home page. Up next is the web stand-in for the widget. |
| Settings, onboarding, calendar hours, weekends, dark mode | `/settings` and the header | Ported |
| Legal text, AGPL, SearchNEU attribution | `/legal`, `/license`, `NOTICE.md` | Ported |
| Persistence | `localStorage` (`term-organize.user.v1`), IndexedDB catalog cache, JSON export/import | Web substitute for on-device storage. |
| Deep links (`AppLink`) | `/course/202710/CS/3000`, `/section/202710/<crn>`, `/schedule`, `/search?q=` | Ported as URLs. |
| `DesignSystem` (accent, course colors, radius, dark mode) | `src/app/globals.css`, `courseColorIndex` | Ported. Northeastern red `#C8102E` / `#F24555`, 22 px cards, and the same 64-bit djb2 course-color hash as `CourseColor.forCode`. |
| iCloud / CloudKit (`Services/CloudSync`) | JSON export/import | Omitted. There is no account and no cross-device sync. |
| Widgets (`NEUClassSearchWidgets`) | Up next on the home page | Omitted as home-screen widgets. |
| Live Activities | Up next while the tab is open | Omitted. |
| Siri / App Intents / Spotlight | Site search and URLs | Omitted. |
| Mac-only windows, menus, and multi-window course UI | Responsive pages | Omitted. The same tasks are pages. |
| Catalog snapshot tool (`Tools/CatalogSnapshot`) | `data/term-202710.json.gz`, `data/term-202730.json.gz`, `POST /api/catalog/[term]`, `POST /api/catalog/[term]/details` | Fall 2026 and Spring 2027 ship with descriptions. Another term’s sections are downloaded on demand, then each course’s description, requisites, and catalog title are read from that term’s Banner pages (a batch at a time) and stored. Catalog archives are JSON, not LZFSE. |

## Tests

The Swift suites are ported assertion by assertion under `src/lib/**/*.swift.test.ts` and `src/lib/prerequisite-data.test.ts` (472 tests). That includes core models, Banner parsers, search, catalog and shell support, schedule generation, preferences, degree plans and PDF round-trip, the audit, NUpath, substitutions, prerequisite and course-info lookup, offering history, and cloud-sync merge rules. Cloud sync itself is not in the product UI.

Playwright (`e2e/main.spec.ts`) covers home, search, a course, a section, a schedule, rooms, settings, legal text, professors, the watchlist, and a degree-plan PDF import/export plus an audit.

## Still not the iOS app

- No iCloud, widgets, Siri, Spotlight, or Live Activities.
- Natural-language preferences are a deterministic reader, not Apple Intelligence.
- Web Push seat alerts run only when the server has VAPID keys. The sender is an in-process timer, so the Next.js server has to be running.
- Catalog archives are JSON, not LZFSE.
- GPA and residency stay unchecked, matching the app, because a plan has no grades.
