"use client";

import { courseHref } from "@/components/bits";
import { Button, Select, TextInput } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { ruleResults, runDegreeAudit } from "@/lib/degree/audit";
import { archivedEditions, currentEdition, parseProgramPage, parseUniversitywide, programURL, programsFromIndex, universitywideLink } from "@/lib/degree/catalog-parser";
import { courseAttributes } from "@/lib/degree/nupath";
import { duplicateKeys, newDegreePlanDraft, prerequisiteStatus, termCreditTotal } from "@/lib/degree-logic";
import { degreePlanText, parseDegreePlanText, DegreeImportError } from "@/lib/degree-format";
import { downloadBytes, renderDegreePlanPDF } from "@/lib/degree-pdf";
import { equivalencesFromDeclarations } from "@/lib/equivalences";
import { keyId, parseCourseKey } from "@/lib/models";
import { catalogYearLabel, completedCredits, concentrationName, editionsAll, estimatedEditions, plannedCredits, type CatalogProgram, type CatalogYear, type DegreePlan, type DegreePlanCourse, type PlanSeason, type ProgramRequirements, PLAN_SEASON_SHORT } from "@/lib/requirements";
import { keepOnePrimaryDegree, newId } from "@/lib/user";
import Link from "next/link";
import { useMemo, useState } from "react";

const SEASONS: PlanSeason[] = ["fall", "spring", "summerA", "summerFull", "summerB", "winter"];

export default function DegreePage() {
  const { user, updateUser, index, termCode } = useApp();
  const plan = user.degreePlans.find((item) => item.isPrimary) ?? user.degreePlans[0] ?? null;
  const [notice, setNotice] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<ProgramRequirements | null>(null);
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [editions, setEditions] = useState(estimatedEditions());
  const [programQuery, setProgramQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  function save(next: DegreePlan) {
    updateUser((prev) => ({
      ...prev,
      degreePlans: prev.degreePlans.some((item) => item.id === next.id)
        ? prev.degreePlans.map((item) => (item.id === next.id ? { ...next, updatedAt: Date.now() } : item))
        : [...prev.degreePlans, { ...next, updatedAt: Date.now() }],
    }));
  }

  function createPlan() {
    const draft = newDegreePlanDraft("My degree plan", null, user.plans, (term, key) => {
      if (!index || index.catalog.term.code !== term) return null;
      const course = index.course(key);
      return course ? { title: course.title, credits: course.maxCredits } : null;
    });
    draft.isPrimary = true;
    updateUser((prev) => ({ ...prev, degreePlans: keepOnePrimaryDegree([...prev.degreePlans, draft], draft.id) }));
  }

  async function onFile(file: File) {
    try {
      let text = await file.text();
      if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
        const { textFromPDF } = await import("@/lib/pdf-text");
        text = await textFromPDF(await file.arrayBuffer());
      }
      const parsed = parseDegreePlanText(text, file.name);
      parsed.plan.isPrimary = true;
      updateUser((prev) => ({ ...prev, degreePlans: keepOnePrimaryDegree([...prev.degreePlans, parsed.plan], parsed.plan.id) }));
      setNotice(parsed.skippedLines.length ? `Imported with ${parsed.skippedLines.length} skipped lines.` : "Imported the degree audit plan.");
    } catch (error) {
      setNotice(error instanceof DegreeImportError ? error.message : "Could not read that file.");
    }
  }

  const duplicates = plan ? duplicateKeys(plan) : new Set<string>();
  const audit = useMemo(() => {
    if (!plan || !requirements) return null;
    const table: Record<string, string[]> = {};
    if (index) {
      const keys = [...plan.completed, ...plan.terms.flatMap((term) => term.courses)];
      for (const course of keys) {
        if (!course.key) continue;
        const listed = index.course(course.key);
        if (listed) table[keyId(course.key)] = listed.attributes;
      }
    }
    return runDegreeAudit(plan, requirements, equivalencesFromDeclarations(plan.courseEquivalences), courseAttributes(table));
  }, [plan, requirements, index]);

  const visiblePrograms = programs.filter((program) => program.title.toLowerCase().includes(programQuery.toLowerCase())).slice(0, 40);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Degree plan</h1>
          <p className="text-muted">Import the degree audit’s View Plan PDF, edit it, and check it against the academic catalog.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={createPlan}>New plan</Button>
          <label className="btn ghost cursor-pointer">
            Import PDF or text
            <input
              className="hidden"
              type="file"
              accept="application/pdf,text/plain,.pdf,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </header>
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      {user.degreePlans.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {user.degreePlans.map((item) => (
            <button key={item.id} className={`chip ${item.id === plan?.id ? "border-accent text-accent" : ""}`} type="button" onClick={() => updateUser((prev) => ({ ...prev, degreePlans: keepOnePrimaryDegree(prev.degreePlans, item.id) }))}>
              {item.name}
            </button>
          ))}
        </div>
      ) : null}

      {!plan ? <p className="text-muted">No degree plan yet. Import a View Plan PDF or start a blank one. A blank plan can pull courses from your primary schedule.</p> : null}

      {plan ? (
        <PlanEditor
          plan={plan}
          duplicates={duplicates}
          termCode={termCode}
          onChange={save}
          onDelete={() => updateUser((prev) => ({ ...prev, degreePlans: prev.degreePlans.filter((item) => item.id !== plan.id) }))}
          onExportText={() => {
            const text = degreePlanText(plan, new Date(), true);
            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${plan.name || "degree-plan"}.txt`;
            link.click();
            URL.revokeObjectURL(url);
          }}
          onExportPDF={() => {
            void renderDegreePlanPDF(plan, new Date(), true).then((bytes) => downloadBytes(`${plan.name || "degree-plan"}.pdf`, bytes, "application/pdf"));
          }}
          onAutofill={() => {
            const draft = newDegreePlanDraft(plan.name, plan, user.plans, (term, key) => {
              if (!index || index.catalog.term.code !== term) return null;
              const course = index.course(key);
              return course ? { title: course.title, credits: course.maxCredits } : null;
            });
            save({ ...plan, terms: draft.terms, updatedAt: Date.now() });
            setNotice("Added courses from your primary schedules into matching semesters.");
          }}
          lookupPrereq={(key, termIndex) => prerequisiteStatus(key, termIndex, plan, index)}
        />
      ) : null}

      <section className="card grid gap-3 p-5">
        <h2 className="text-xl font-semibold">Requirements</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setLoading("Loading catalog years…");
              void fetch("/api/catalog-site?url=" + encodeURIComponent("https://catalog.northeastern.edu/"))
                .then(async (res) => {
                  const html = await res.text();
                  if (!res.ok) throw new Error("The catalog site did not respond.");
                  const current = currentEdition(html) ?? estimatedEditions().current;
                  const archived = archivedEditions(html);
                  setEditions({ current, archived, fetchedAt: Date.now(), isEstimated: archived.length === 0 });
                  setLoading(null);
                })
                .catch((error: Error) => setLoading(error.message));
            }}
          >
            Load catalog years
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              const year = plan?.catalogYear ? { startYear: plan.catalogYear } : editions.current;
              const base = year.startYear === editions.current.startYear ? "https://catalog.northeastern.edu/" : `https://catalog.northeastern.edu/archive/${year.startYear}-${year.startYear + 1}/`;
              setLoading("Loading programs…");
              void fetch("/api/catalog-site?url=" + encodeURIComponent(new URL("azindex/", base).toString()))
                .then(async (res) => {
                  const html = await res.text();
                  if (!res.ok) throw new Error("Could not read the program index.");
                  setPrograms(programsFromIndex(html));
                  setLoading(null);
                })
                .catch((error: Error) => setLoading(error.message));
            }}
          >
            Load programs
          </Button>
        </div>
        {loading ? <p className="text-sm text-muted">{loading}</p> : null}
        <label className="label">
          Catalog year
          <Select
            value={String(plan?.catalogYear ?? editions.current.startYear)}
            onChange={(event) => plan && save({ ...plan, catalogYear: Number(event.target.value) })}
          >
            {editionsAll(editions).map((year) => (
              <option key={year.startYear} value={year.startYear}>
                {catalogYearLabel(year)}
              </option>
            ))}
          </Select>
        </label>
        <label className="label">
          Find a program
          <TextInput value={programQuery} onChange={(event) => setProgramQuery(event.target.value)} placeholder="Computer Science, BS" />
        </label>
        {visiblePrograms.length ? (
          <ul className="max-h-48 overflow-auto text-sm">
            {visiblePrograms.map((program) => (
              <li key={program.path}>
                <button
                  className="w-full rounded-lg px-2 py-1 text-left hover:bg-surface-2"
                  type="button"
                  onClick={() => {
                    if (!plan) return;
                    const year: CatalogYear = { startYear: plan.catalogYear ?? editions.current.startYear };
                    const base = year.startYear === editions.current.startYear ? "https://catalog.northeastern.edu/" : `https://catalog.northeastern.edu/archive/${year.startYear}-${year.startYear + 1}/`;
                    const url = programURL(base, program.path);
                    setLoading(`Reading ${program.title}…`);
                    void fetch("/api/catalog-site?url=" + encodeURIComponent(url))
                      .then(async (res) => {
                        const html = await res.text();
                        if (!res.ok) throw new Error("Could not read that program page.");
                        const parsed = parseProgramPage(html, year, program);
                        if (!parsed) throw new Error("That page has no course-list tables.");
                        const link = universitywideLink(html);
                        if (link) {
                          const wide = programURL(base, link);
                          const wideRes = await fetch("/api/catalog-site?url=" + encodeURIComponent(wide));
                          if (wideRes.ok) parsed.universitywide = parseUniversitywide(await wideRes.text());
                        }
                        setRequirements(parsed);
                        save({ ...plan, catalogYear: year.startYear, catalogProgramPath: program.path, catalogProgramTitle: program.title, program: plan.program || program.title });
                        setLoading(null);
                      })
                      .catch((error: Error) => setLoading(error.message));
                  }}
                >
                  {program.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {requirements ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">
              {requirements.program.title}
              {requirements.totalHours ? ` · ${requirements.totalHours} semester hours in the catalog` : ""}
            </p>
            {requirements.sections.some((section) => section.isConcentration) ? (
              <label className="label">
                Concentration
                <Select value={plan?.concentrationID ?? ""} onChange={(event) => plan && save({ ...plan, concentrationID: event.target.value || null })}>
                  <option value="">None selected</option>
                  {requirements.sections
                    .filter((section) => section.isConcentration)
                    .map((section) => (
                      <option key={section.id} value={section.id}>
                        {concentrationName(section.title) || section.title}
                      </option>
                    ))}
                </Select>
              </label>
            ) : null}
            {audit ? (
              <ul className="grid gap-2">
                <li className="text-sm text-muted">
                  {audit.completedHours} completed credits · {audit.plannedHours} planned
                  {audit.requiredHours != null ? ` · ${audit.requiredHours} required` : ""}
                </li>
                {audit.noteChecks.map((check) => (
                  <li key={check.id} className="text-sm">
                    <span className={check.status === "complete" || check.status === "waived" ? "text-good" : check.status === "missing" ? "text-bad" : "text-warn"}>{check.status}</span> {check.title}
                    {check.detail ? <span className="text-muted"> — {check.detail}</span> : null}
                  </li>
                ))}
                {ruleResults(audit).map((rule) => (
                  <li key={rule.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <strong>{rule.rule.label.replace(/:$/, "")}</strong>
                      <span className={rule.status === "complete" || rule.status === "waived" ? "text-good" : rule.status === "missing" ? "text-bad" : "text-warn"}>{rule.status}</span>
                    </div>
                    {rule.used.length ? <p className="text-muted">{rule.used.map((use) => keyId(use.key)).join(", ")}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Open or import a plan to run the audit.</p>
            )}
            {plan && requirements ? <SubstitutionForm plan={plan} requirements={requirements} onChange={save} /> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PlanEditor({
  plan,
  duplicates,
  termCode,
  onChange,
  onDelete,
  onExportText,
  onExportPDF,
  onAutofill,
  lookupPrereq,
}: {
  plan: DegreePlan;
  duplicates: Set<string>;
  termCode: string;
  onChange: (plan: DegreePlan) => void;
  onDelete: () => void;
  onExportText: () => void;
  onExportPDF: () => void;
  onAutofill: () => void;
  lookupPrereq: (key: ReturnType<typeof parseCourseKey> & object, termIndex: number) => { kind: string; text?: string };
}) {
  const [draft, setDraft] = useState("CS 3000");
  const total = completedCredits(plan) + plannedCredits(plan);

  function addCourse(where: "completed" | number) {
    const key = parseCourseKey(draft);
    const course: DegreePlanCourse = {
      id: newId(),
      key,
      label: key ? keyId(key) : draft.trim(),
      title: key ? keyId(key) : draft.trim(),
      credits: 4,
    };
    if (where === "completed") onChange({ ...plan, completed: [...plan.completed, course] });
    else onChange({ ...plan, terms: plan.terms.map((term, index) => (index === where ? { ...term, courses: [...term.courses, course] } : term)) });
  }

  return (
    <section className="card grid gap-4 p-5">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="label">
          Plan name
          <TextInput value={plan.name} onChange={(event) => onChange({ ...plan, name: event.target.value })} />
        </label>
        <label className="label">
          Program code
          <TextInput value={plan.program ?? ""} onChange={(event) => onChange({ ...plan, program: event.target.value })} placeholder="CS-B-CSCI-BSCS" />
        </label>
      </div>
      <p className="text-sm">
        {completedCredits(plan)} completed · {plannedCredits(plan)} planned · {total} total credits
      </p>
      {duplicates.size ? <p className="text-sm text-bad">Repeated courses: {[...duplicates].join(", ")}. Topics with different titles can count separately.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" type="button" onClick={onExportPDF}>Export PDF</Button>
        <Button variant="ghost" type="button" onClick={onExportText}>Export text</Button>
        <Button variant="soft" type="button" onClick={onAutofill}>Autofill from schedules</Button>
        <Button variant="ghost" type="button" onClick={onDelete}>Delete plan</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <TextInput className="max-w-xs" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="CS 2500" />
        <Button variant="soft" type="button" onClick={() => addCourse("completed")}>Add completed</Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() =>
            onChange({
              ...plan,
              terms: [...plan.terms, { id: newId(), season: "fall", year: new Date().getFullYear(), courses: [] }],
            })
          }
        >
          Add semester
        </Button>
      </div>
      <div>
        <h3 className="font-semibold">Completed</h3>
        <CourseList courses={plan.completed} termCode={termCode} onChange={(courses) => onChange({ ...plan, completed: courses })} />
      </div>
      {plan.terms.map((term, termIndex) => (
        <div key={term.id} className="rounded-2xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={term.season} onChange={(event) => onChange({ ...plan, terms: plan.terms.map((item) => (item.id === term.id ? { ...item, season: event.target.value as PlanSeason } : item)) })}>
              {SEASONS.map((season) => (
                <option key={season} value={season}>
                  {PLAN_SEASON_SHORT[season]}
                </option>
              ))}
            </Select>
            <TextInput className="w-28" value={String(term.year)} onChange={(event) => onChange({ ...plan, terms: plan.terms.map((item) => (item.id === term.id ? { ...item, year: Number(event.target.value) || item.year } : item)) })} />
            <span className="text-sm text-muted">{termCreditTotal(term.courses)} credits</span>
            <Button className="tiny" variant="ghost" type="button" onClick={() => addCourse(termIndex)}>
              Add course
            </Button>
            <Button className="tiny" variant="ghost" type="button" onClick={() => onChange({ ...plan, terms: plan.terms.filter((item) => item.id !== term.id) })}>
              Remove semester
            </Button>
          </div>
          <CourseList courses={term.courses} termCode={termCode} onChange={(courses) => onChange({ ...plan, terms: plan.terms.map((item) => (item.id === term.id ? { ...item, courses } : item)) })} />
          <ul className="mt-2 text-sm">
            {term.courses.map((course) => {
              if (!course.key) return null;
              const status = lookupPrereq(course.key, termIndex);
              if (status.kind !== "missing") return null;
              return (
                <li key={course.id} className="text-warn">
                  {keyId(course.key)} is missing {status.text}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function CourseList({ courses, onChange, termCode }: { courses: DegreePlanCourse[]; onChange: (courses: DegreePlanCourse[]) => void; termCode: string }) {
  if (!courses.length) return <p className="mt-2 text-sm text-muted">None yet.</p>;
  return (
    <ul className="mt-2 grid gap-2">
      {courses.map((course) => (
        <li key={course.id} className="flex flex-wrap items-center gap-2 text-sm">
          {course.key ? (
            <Link className="font-semibold underline" href={courseHref(termCode, course.key)}>
              {course.label}
            </Link>
          ) : (
            <span className="font-semibold">{course.label}</span>
          )}
          <TextInput className="max-w-[220px] py-1" value={course.title} onChange={(event) => onChange(courses.map((item) => (item.id === course.id ? { ...item, title: event.target.value } : item)))} />
          <TextInput className="w-20 py-1" value={String(course.credits)} onChange={(event) => onChange(courses.map((item) => (item.id === course.id ? { ...item, credits: Number(event.target.value) || 0 } : item)))} />
          <button type="button" className="text-muted" onClick={() => onChange(courses.filter((item) => item.id !== course.id))}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

function SubstitutionForm({ plan, requirements, onChange }: { plan: DegreePlan; requirements: ProgramRequirements; onChange: (plan: DegreePlan) => void }) {
  const rules = requirements.sections.flatMap((section) => section.groups.flatMap((group) => group.rules));
  const [ruleID, setRuleID] = useState(rules[0]?.id ?? "");
  const [kind, setKind] = useState<"waive" | "countCourse" | "replace">("waive");
  const [courseText, setCourseText] = useState("");
  const [note, setNote] = useState("");
  const [equivFrom, setEquivFrom] = useState("");
  const [equivTo, setEquivTo] = useState("");

  return (
    <div className="grid gap-3 rounded-2xl border border-line p-3">
      <h3 className="font-semibold">Substitutions, petitions, and waivers</h3>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="label">
          Requirement
          <Select value={ruleID} onChange={(event) => setRuleID(event.target.value)}>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.label.replace(/:$/, "")}
              </option>
            ))}
          </Select>
        </label>
        <label className="label">
          Change
          <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="waive">Waiver</option>
            <option value="countCourse">Count a course</option>
            <option value="replace">Petition (replace the rule)</option>
          </Select>
        </label>
        {kind !== "waive" ? (
          <label className="label md:col-span-2">
            Courses
            <TextInput value={courseText} onChange={(event) => setCourseText(event.target.value)} placeholder="CS 2500, CS 2510" />
          </label>
        ) : null}
        <label className="label md:col-span-2">
          Note
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Approved by the advisor" />
        </label>
      </div>
      <Button
        variant="soft"
        type="button"
        onClick={() => {
          const rule = rules.find((item) => item.id === ruleID);
          if (!rule) return;
          const keys = courseText.split(/[,;\n]/).flatMap((part) => {
            const key = parseCourseKey(part.trim());
            return key ? [key] : [];
          });
          const change =
            kind === "waive"
              ? { type: "waive" as const }
              : kind === "countCourse"
                ? { type: "countCourse" as const, course: keys[0] ?? { subject: "CS", number: "0000" } }
                : { type: "replace" as const, replacement: { courses: keys, count: keys.length || 1, hours: null } };
          onChange({
            ...plan,
            substitutions: [
              ...plan.substitutions,
              { id: newId(), ruleID: rule.id, ruleTitle: rule.label, change, note, createdAt: Date.now() },
            ],
          });
          setNote("");
          setCourseText("");
        }}
      >
        Add to the plan
      </Button>
      <ul className="text-sm">
        {plan.substitutions.map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span>
              {item.change.type} · {item.ruleTitle} {item.note ? `· ${item.note}` : ""}
            </span>
            <button type="button" className="text-muted" onClick={() => onChange({ ...plan, substitutions: plan.substitutions.filter((entry) => entry.id !== item.id) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <h3 className="font-semibold">Equivalences</h3>
      <p className="text-sm text-muted">A renumbered course can count as the one in the catalog. Older terms use the same declaration when the snapshot does not list both numbers.</p>
      <div className="flex flex-wrap gap-2">
        <TextInput className="max-w-[140px]" value={equivFrom} onChange={(event) => setEquivFrom(event.target.value)} placeholder="CS 2500" />
        <span className="self-center text-sm">counts as</span>
        <TextInput className="max-w-[140px]" value={equivTo} onChange={(event) => setEquivTo(event.target.value)} placeholder="CS 2510" />
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            const course = parseCourseKey(equivFrom);
            const countsAs = parseCourseKey(equivTo);
            if (!course || !countsAs) return;
            onChange({ ...plan, courseEquivalences: [...plan.courseEquivalences, { id: newId(), course, countsAs, note: "" }] });
            setEquivFrom("");
            setEquivTo("");
          }}
        >
          Add equivalence
        </Button>
      </div>
      <ul className="text-sm">
        {plan.courseEquivalences.map((item) => (
          <li key={item.id}>
            {keyId(item.course)} counts as {keyId(item.countsAs)}{" "}
            <button type="button" className="text-muted" onClick={() => onChange({ ...plan, courseEquivalences: plan.courseEquivalences.filter((entry) => entry.id !== item.id) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
