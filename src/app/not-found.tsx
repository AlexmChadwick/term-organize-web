import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto grid max-w-lg gap-3 p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">That page is not in the catalog.</h1>
      <p className="text-muted">The link may be old, or the course code was mistyped.</p>
      <div>
        <Link className="btn" href="/">
          Back home
        </Link>
      </div>
    </div>
  );
}
