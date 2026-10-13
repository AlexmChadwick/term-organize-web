"use client";

import type { SchedulePreferences, PreferenceStrength } from "@/lib/preferences";
import type { PreferencesSurveyContext } from "@/lib/preferences";

function hoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}

function StrengthSelect({ value, onChange }: { value: PreferenceStrength; onChange: (value: PreferenceStrength) => void }) {
  return (
    <label className="label">
      How strict
      <select className="select" value={value} onChange={(event) => onChange(event.target.value as PreferenceStrength)}>
        <option value="preferred">If possible</option>
        <option value="required">Always</option>
      </select>
    </label>
  );
}

/** The rest of the Swift preferences survey: days, breaks, lunch, workload, and credits. */
export function ScheduleSurveyExtras({
  prefs,
  onChange,
  credits,
}: {
  prefs: SchedulePreferences;
  onChange: (next: SchedulePreferences) => void;
  credits: PreferencesSurveyContext;
}) {
  const available = Math.max(credits.totalCredits, credits.requiredCredits);
  const defaultLower = Math.min(Math.max(credits.requiredCredits, 16), Math.max(1, available || 16));
  const defaultTarget = { lower: defaultLower, upper: Math.min(defaultLower + 2, Math.max(defaultLower, available || defaultLower)) };
  return (
    <div className="grid gap-3">
      <label className="label">
        Class days
        <select className="select" value={prefs.dayLayout} onChange={(event) => onChange({ ...prefs, dayLayout: event.target.value as SchedulePreferences["dayLayout"] })}>
          <option value="noPreference">No preference</option>
          <option value="fewerDays">Fewer days on campus</option>
          <option value="spreadOut">Spread out evenly</option>
        </select>
      </label>
      {prefs.daysOff ? (
        <div className="grid gap-1">
          <StrengthSelect value={prefs.daysOffStrength} onChange={(daysOffStrength) => onChange({ ...prefs, daysOffStrength })} />
          <p className="text-sm text-muted">Always leaves out any class on a day off. If possible puts schedules with those days free first.</p>
        </div>
      ) : null}
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer font-semibold">More preferences</summary>
        <div className="mt-3 grid gap-3">
          <h3 className="text-sm font-semibold text-muted">Breaks</h3>
          <label className="label">
            Back-to-back
            <select className="select" value={prefs.breaks} onChange={(event) => onChange({ ...prefs, breaks: event.target.value as SchedulePreferences["breaks"] })}>
              <option value="fine">Fine</option>
              <option value="avoidBackToBack">Avoid</option>
              <option value="atLeast">Time to walk</option>
            </select>
          </label>
          {prefs.breaks === "atLeast" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="label">
                At least {prefs.minimumBreakMinutes} minutes between buildings
                <input
                  className="field"
                  type="number"
                  min={5}
                  max={60}
                  step={5}
                  value={prefs.minimumBreakMinutes}
                  onChange={(event) => onChange({ ...prefs, minimumBreakMinutes: Math.min(60, Math.max(5, Number(event.target.value) || 5)) })}
                />
              </label>
              <StrengthSelect value={prefs.minimumBreakStrength} onChange={(minimumBreakStrength) => onChange({ ...prefs, minimumBreakStrength })} />
            </div>
          ) : null}
          <label className="label">
            Gaps
            <span className="text-xs font-normal text-muted">Idle time</span>
            <select className="select" value={prefs.gaps} onChange={(event) => onChange({ ...prefs, gaps: event.target.value as SchedulePreferences["gaps"] })}>
              <option value="compact">Keep short</option>
              <option value="noPreference">No preference</option>
              <option value="fine">Fine</option>
            </select>
          </label>
          <label className="label flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.lunch != null}
              onChange={(event) => onChange({ ...prefs, lunch: event.target.checked ? (prefs.lunch ?? { start: 11 * 60 + 30, end: 14 * 60, minutes: 30 }) : null })}
            />
            Protect a lunch break
          </label>
          {prefs.lunch ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="label">
                Window starts
                <input className="field" type="time" value={minutesToTime(prefs.lunch.start)} onChange={(event) => onChange({ ...prefs, lunch: { ...prefs.lunch!, start: timeToMinutes(event.target.value) ?? prefs.lunch!.start } })} />
              </label>
              <label className="label">
                Window ends
                <input className="field" type="time" value={minutesToTime(prefs.lunch.end)} onChange={(event) => onChange({ ...prefs, lunch: { ...prefs.lunch!, end: timeToMinutes(event.target.value) ?? prefs.lunch!.end } })} />
              </label>
              <label className="label">
                Keep free
                <select className="select" value={prefs.lunch.minutes} onChange={(event) => onChange({ ...prefs, lunch: { ...prefs.lunch!, minutes: Number(event.target.value) } })}>
                  {[15, 30, 45, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
              {prefs.lunch.end - prefs.lunch.start < prefs.lunch.minutes ? <p className="text-sm text-warn sm:col-span-3">The window is shorter than the time you want free.</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Schedules with lunch free on more days rank higher.</p>
          )}
          <h3 className="text-sm font-semibold text-muted">Workload</h3>
          <label className="label flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.maxClassesPerDay != null}
              onChange={(event) => onChange({ ...prefs, maxClassesPerDay: event.target.checked ? (prefs.maxClassesPerDay ?? 3) : null })}
            />
            Limit classes per day
          </label>
          {prefs.maxClassesPerDay != null ? (
            <label className="label">
              {prefs.maxClassesPerDay === 1 ? "At most 1 class a day" : `At most ${prefs.maxClassesPerDay} classes a day`}
              <input
                className="field"
                type="number"
                min={1}
                max={6}
                value={prefs.maxClassesPerDay}
                onChange={(event) => onChange({ ...prefs, maxClassesPerDay: Math.min(6, Math.max(1, Number(event.target.value) || 1)) })}
              />
            </label>
          ) : null}
          <label className="label flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.maxMinutesPerDay != null}
              onChange={(event) => onChange({ ...prefs, maxMinutesPerDay: event.target.checked ? (prefs.maxMinutesPerDay ?? 5 * 60) : null })}
            />
            Limit class hours per day
          </label>
          {prefs.maxMinutesPerDay != null ? (
            <label className="label">
              At most {hoursLabel(prefs.maxMinutesPerDay)} of class a day
              <input
                className="field"
                type="number"
                min={60}
                max={600}
                step={30}
                value={prefs.maxMinutesPerDay}
                onChange={(event) => onChange({ ...prefs, maxMinutesPerDay: Math.min(600, Math.max(60, Number(event.target.value) || 60)) })}
              />
            </label>
          ) : null}
          {prefs.format !== "noPreference" ? <StrengthSelect value={prefs.formatStrength} onChange={(formatStrength) => onChange({ ...prefs, formatStrength })} /> : null}
          {prefs.campus ? <StrengthSelect value={prefs.campusStrength} onChange={(campusStrength) => onChange({ ...prefs, campusStrength })} /> : null}
          {credits.optionalCourseCount > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-muted">Credit load</h3>
              <p className="text-sm text-muted">
                Required courses add up to {credits.requiredCredits} credits. Optional courses are worth up to {Math.max(0, credits.totalCredits - credits.requiredCredits)} more.
              </p>
              <label className="label flex-row items-center gap-2">
                <input
                  type="checkbox"
                  checked={prefs.creditTarget != null}
                  onChange={(event) => onChange({ ...prefs, creditTarget: event.target.checked ? (prefs.creditTarget ?? defaultTarget) : null })}
                />
                Aim for a credit total
              </label>
              {prefs.creditTarget ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="label">
                    At least {prefs.creditTarget.lower} credits
                    <input
                      className="field"
                      type="number"
                      min={1}
                      max={30}
                      value={prefs.creditTarget.lower}
                      onChange={(event) => {
                        const lower = Math.min(30, Math.max(1, Number(event.target.value) || 1));
                        onChange({ ...prefs, creditTarget: { lower, upper: Math.max(lower, prefs.creditTarget!.upper) } });
                      }}
                    />
                  </label>
                  <label className="label">
                    At most {prefs.creditTarget.upper} credits
                    <input
                      className="field"
                      type="number"
                      min={1}
                      max={30}
                      value={prefs.creditTarget.upper}
                      onChange={(event) => {
                        const upper = Math.min(30, Math.max(1, Number(event.target.value) || 1));
                        onChange({ ...prefs, creditTarget: { lower: Math.min(prefs.creditTarget!.lower, upper), upper } });
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
