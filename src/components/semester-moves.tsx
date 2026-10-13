"use client";

import { Button } from "@/components/ui";
import type { CatalogIndex } from "@/lib/catalog-index";
import { loadCourseFacts, snapshotCourseFacts, withTimeout } from "@/lib/plan-course-info";
import { loadSemesterMoves, type MoveOption } from "@/lib/semester-moves";
import type { CourseKey } from "@/lib/models";
import { keyId } from "@/lib/models";
import type { DegreePlan } from "@/lib/requirements";
import { useEffect, useState } from "react";

export function SemesterMoves({
  plan,
  termID,
  blocking,
  index,
  onApply,
}: {
  plan: DegreePlan;
  termID: string;
  blocking: readonly CourseKey[];
  index: CatalogIndex | null;
  onApply: (option: MoveOption) => void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [options, setOptions] = useState<MoveOption[]>([]);
  const [historyKnown, setHistoryKnown] = useState(true);
  const blockingKey = blocking.map((key) => keyId(key)).join("|");

  useEffect(() => {
    if (!blockingKey) return;
    let cancelled = false;
    setPhase("loading");
    const keys = [
      ...blocking,
      ...plan.completed.flatMap((course) => (course.key ? [course.key] : [])),
      ...plan.terms.flatMap((term) => term.courses.flatMap((course) => (course.key ? [course.key] : []))),
    ];
    const factsPromise = withTimeout(loadCourseFacts({ keys, attributes: false, suggest: false, plan }), 30_000, snapshotCourseFacts());
    void loadSemesterMoves({
      plan,
      termID,
      blocking,
      prerequisites: factsPromise.then((facts) => (key) => {
        const course = index?.course(key);
        if (course?.detailsLoaded) return course.prereqs ?? null;
        return facts.requisite(key);
      }),
      equivalences: factsPromise.then((facts) => facts.equivalences),
    }).then((result) => {
      if (cancelled) return;
      setOptions(result.options);
      setHistoryKnown(result.historyKnown);
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
    // The blocking list and the plan's revision identify a new question. The plan object is read once per question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockingKey, termID, plan.updatedAt, index]);

  if (!blocking.length) return null;
  if (phase === "ready" && options.length === 0) return null;

  return (
    <section className="mt-3 grid gap-2 rounded-2xl border border-line bg-surface-2/40 p-3" aria-label="Rearrange your degree plan">
      <h3 className="text-sm font-semibold">Rearrange your degree plan</h3>
      {phase === "loading" ? <p className="text-sm text-muted">Checking when these courses are usually offered…</p> : null}
      {options.map((option) => (
        <article key={option.id} className="grid gap-1">
          <strong className="text-sm">{option.title}</strong>
          <ul className="text-sm text-muted">
            {option.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            {option.addsSemester ? <li className="text-warn">Adds a semester to your degree plan</li> : null}
          </ul>
          <Button className="tiny justify-self-start" type="button" onClick={() => onApply(option)}>
            Apply to degree plan
          </Button>
        </article>
      ))}
      {phase === "ready" ? (
        <p className="text-xs text-muted">
          {historyKnown
            ? "Based on when these courses have been offered before."
            : "Couldn’t check when these courses are usually offered, so the suggestions can’t take that into account."}
        </p>
      ) : null}
    </section>
  );
}
