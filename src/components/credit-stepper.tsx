"use client";

import { clampChosenCredits, creditsCaption } from "@/lib/variable-credits";

/** Native whole-number stepper for one variable-credit row. */
export function CreditStepper({
  credits,
  low,
  high,
  onChange,
}: {
  credits: number;
  low: number;
  high: number;
  onChange: (credits: number) => void;
}) {
  const caption = creditsCaption(credits, low, high);
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted">
      <span>{caption}</span>
      <input
        className="field w-20 py-1"
        type="number"
        inputMode="numeric"
        min={Math.ceil(low)}
        max={Math.floor(high)}
        step={1}
        value={credits}
        aria-label={caption}
        onChange={(event) => onChange(clampChosenCredits(Number(event.target.value), low, high))}
      />
    </label>
  );
}
