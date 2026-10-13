"use client";

import type { ScheduleFilters } from "@/lib/models";
import type { SchedulePreferences } from "@/lib/preferences";
import {
  generateSchedules,
  reviveBlockerAnalysis,
  reviveDiagnostics,
  STANDARD_LIMITS,
  type GeneratorLimits,
  type ScheduleCourseInput,
  type ScheduleGenerationResult,
  type ScheduleSortOption,
} from "@/lib/schedule/generator";
import { analyzeEmptyResult, explainGeneration, type ScheduleNoResults } from "@/lib/schedule/no-results";
import type { GenerateRequest, GenerateResponse } from "@/lib/schedule/generator.worker";

export interface GenerateOutcome {
  result: ScheduleGenerationResult;
  empty: ScheduleNoResults | null;
  message: string;
}

let worker: Worker | null = null;
let nextId = 0;

function revive(response: GenerateResponse): GenerateOutcome {
  response.result.diagnostics = reviveDiagnostics(response.result.diagnostics);
  if (response.empty) {
    response.empty.diagnostics = reviveDiagnostics(response.empty.diagnostics);
    response.empty.blockers = reviveBlockerAnalysis(response.empty.blockers);
  }
  return response;
}

function onThisThread(request: GenerateRequest): GenerateOutcome {
  const result = generateSchedules(request.courses, request.filters, request.preferences, request.sort, request.limits);
  const empty = result.schedules.length ? null : analyzeEmptyResult(request.courses, request.filters, request.preferences, result.diagnostics);
  const message = result.schedules.length
    ? `${result.totalFound} schedule${result.totalFound === 1 ? "" : "s"} fit.${result.isExhaustive ? "" : " The search sampled a very large set of combinations."}`
    : explainGeneration(result, request.termLabel);
  return { result, empty, message };
}

/** Swift `Limits.standard`, on a worker so a 5,000-result search does not freeze the page. */
export function generateOffThread(input: {
  courses: ScheduleCourseInput[];
  filters: ScheduleFilters;
  preferences: SchedulePreferences;
  sort: ScheduleSortOption;
  termLabel: string;
  limits?: GeneratorLimits;
}): Promise<GenerateOutcome> {
  const id = ++nextId;
  const request: GenerateRequest = { ...input, limits: input.limits ?? STANDARD_LIMITS, id };
  if (typeof Worker === "undefined") return Promise.resolve(onThisThread(request));
  try {
    if (!worker) worker = new Worker(new URL("./generator.worker.ts", import.meta.url));
  } catch {
    return Promise.resolve(onThisThread(request));
  }
  const current = worker;
  return new Promise((resolve) => {
    const fail = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", fail);
      resolve(onThisThread(request));
    };
    const onMessage = (event: MessageEvent<GenerateResponse>) => {
      if (event.data?.id !== request.id) return;
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", fail);
      resolve(revive(event.data));
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("error", fail);
    current.postMessage(request);
  });
}
