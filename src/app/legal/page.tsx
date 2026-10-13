import { APP_COPYRIGHT, DATA_NOTICE, LICENSE_GRANT, NO_WARRANTY, PRIVACY_NOTICE, SEARCHNEU_SUMMARY, SEARCHNEU_URL, SOURCE_OFFER, SOURCE_URL, UNOFFICIAL_NOTICE, UPSTREAM_COPYRIGHT } from "@/lib/legal";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About and license" };

export default function LegalPage() {
  return (
    <article className="grid max-w-3xl gap-4 text-[15px] leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">About Term Organize</h1>
      <p className="font-semibold">{UNOFFICIAL_NOTICE}</p>
      <p>{APP_COPYRIGHT}</p>
      <p>{LICENSE_GRANT}</p>
      <p>{NO_WARRANTY}</p>
      <p>{SOURCE_OFFER}</p>
      <p>
        <a className="underline" href={SOURCE_URL}>
          {SOURCE_URL}
        </a>
      </p>
      <h2 className="text-xl font-semibold">SearchNEU</h2>
      <p>{SEARCHNEU_SUMMARY}</p>
      <p>{UPSTREAM_COPYRIGHT}</p>
      <p>
        <a className="underline" href={SEARCHNEU_URL}>
          {SEARCHNEU_URL}
        </a>
      </p>
      <h2 className="text-xl font-semibold">Privacy</h2>
      <p>{PRIVACY_NOTICE}</p>
      <h2 className="text-xl font-semibold">Course data</h2>
      <p>{DATA_NOTICE}</p>
      <p>
        <Link className="underline" href="/license">
          GNU Affero General Public License v3.0
        </Link>
      </p>
    </article>
  );
}
