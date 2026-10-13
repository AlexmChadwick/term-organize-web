import { APP_COPYRIGHT, DATA_NOTICE, LICENSE_GRANT, NO_WARRANTY, PRIVACY_NOTICE, SEARCHNEU_SUMMARY, SEARCHNEU_URL, SOURCE_OFFER, SOURCE_URL, UNOFFICIAL_NOTICE, UPSTREAM_COPYRIGHT } from "@/lib/legal";
import type { Metadata } from "next";
import Link from "next/link";

function UrlText({ href }: { href: string }) {
  const parts = href.split("/");
  return (
    <a className="url underline" href={href}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? "/" : null}
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </span>
      ))}
    </a>
  );
}

export const metadata: Metadata = { title: "About and license" };

export default function LegalPage() {
  return (
    <article className="card grid max-w-3xl gap-4 p-6 text-[15px] leading-relaxed md:p-8">
      <h1 className="text-3xl font-semibold tracking-tight">About Term Organize</h1>
      <p className="font-semibold">{UNOFFICIAL_NOTICE}</p>
      <p>{APP_COPYRIGHT}</p>
      <p>{LICENSE_GRANT}</p>
      <p>{NO_WARRANTY}</p>
      <p>
        {SOURCE_OFFER.split(SOURCE_URL).map((part, index, parts) => (
          <span key={index}>
            {part}
            {index < parts.length - 1 ? <UrlText href={SOURCE_URL} /> : null}
          </span>
        ))}
      </p>
      <p>
        <UrlText href={SOURCE_URL} />
      </p>
      <h2 className="text-xl font-semibold">SearchNEU</h2>
      <p>{SEARCHNEU_SUMMARY}</p>
      <p>{UPSTREAM_COPYRIGHT}</p>
      <p>
        <UrlText href={SEARCHNEU_URL} />
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
