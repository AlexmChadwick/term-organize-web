/**
 * Runs schedule generation off the main thread.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ScheduleFilters } from "@/lib/models";
import type { SchedulePreferences } from "@/lib/preferences";
import { generateSchedules, type GeneratorLimits, type ScheduleCourseInput, type ScheduleGenerationResult, type ScheduleSortOption } from "@/lib/schedule/generator";
import { analyzeEmptyResult, explainGeneration, type ScheduleNoResults } from "@/lib/schedule/no-results";

export interface GenerateRequest {
  id: number;
  courses: ScheduleCourseInput[];
  filters: ScheduleFilters;
  preferences: SchedulePreferences;
  sort: ScheduleSortOption;
  limits: GeneratorLimits;
  termLabel: string;
}

export interface GenerateResponse {
  id: number;
  result: ScheduleGenerationResult;
  empty: ScheduleNoResults | null;
  message: string;
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
  postMessage: (message: GenerateResponse) => void;
};

scope.onmessage = (event) => {
  const request = event.data;
  const result = generateSchedules(request.courses, request.filters, request.preferences, request.sort, request.limits);
  const empty = result.schedules.length ? null : analyzeEmptyResult(request.courses, request.filters, request.preferences, result.diagnostics);
  const message = result.schedules.length
    ? `${result.totalFound} schedule${result.totalFound === 1 ? "" : "s"} fit.${result.isExhaustive ? "" : " The search sampled a very large set of combinations."}`
    : explainGeneration(result, request.termLabel);
  scope.postMessage({ id: request.id, result, empty, message });
};
