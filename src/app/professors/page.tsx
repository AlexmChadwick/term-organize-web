"use client";

import { useApp } from "@/lib/app-state";
import { TextInput } from "@/components/ui";
import { instructorDisplayName } from "@/lib/models";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function ProfessorsPage() {
  const { index } = useApp();
  const [query, setQuery] = useState("");
  const people = useMemo(() => {
    if (!index) return [];
    const text = query.trim().toLowerCase();
    const list = text
      ? index.instructors.filter((person) => person.displayName.toLowerCase().includes(text) || person.name.toLowerCase().includes(text) || (person.email ?? "").toLowerCase().includes(text))
      : index.instructors;
    return list.slice(0, 80);
  }, [index, query]);

  if (!index) return <p className="text-muted">Loading instructors…</p>;

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Professors</h1>
        <p className="text-muted">{index.instructors.length.toLocaleString()} people listed on sections this term.</p>
      </header>
      <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" />
      <ul className="grid gap-2">
        {people.map((person) => (
          <li key={person.name}>
            <Link className="card block p-4 hover:border-accent" href={`/professor/${encodeURIComponent(person.name)}`}>
              <div className="font-semibold">{instructorDisplayName(person.name)}</div>
              <div className="text-sm text-muted">
                {person.courseKeys.length} course{person.courseKeys.length === 1 ? "" : "s"} · {person.crns.length} sections
                {person.email ? ` · ${person.email}` : ""}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {query && !people.length ? <p className="text-muted">No instructor matches that name.</p> : null}
      {!query ? <p className="text-sm text-muted">Showing the first 80. Type a name to narrow the list.</p> : null}
    </div>
  );
}
