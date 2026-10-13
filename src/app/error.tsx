"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-6">
      <h1 className="text-2xl font-semibold tracking-tight">This page hit a problem</h1>
      <p className="mt-2 text-muted">{error.message || "Try the page again."}</p>
      <button className="btn mt-4" type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
