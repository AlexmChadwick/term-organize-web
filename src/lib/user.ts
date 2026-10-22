/**
 * User data persisted in the browser.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/UserModels.swift. iCloud sync is omitted; export/import
 * JSON is the way to move data between browsers.
 */

import type { CourseKey, LevelBand } from "./models";
import { COURSE_PALETTE, keyId, sameKey } from "./models";
import { migrateDegreeCourse, migratePlanCourse } from "./variable-credits";
import type { SchedulePreferences } from "./preferences";
import type { DegreePlan } from "./requirements";

export interface SavedCourse {
  termCode: string;
  key: CourseKey;
  savedAt: number;
}

export interface RecentCourse {
  termCode: string;
  key: CourseKey;
  viewedAt: number;
}

export interface PlanCourse {
  key: CourseKey;
  isRequired: boolean;
  excludedCRNs: string[];
  colorIndex: number;
  /** Manual section choice. Identity is this CRN in the plan's term. */
  pinnedCRN?: string;
  /** Chosen credits for a variable-credit course. Each row has its own value. */
  credits?: number;
  creditLow?: number | null;
  creditHigh?: number | null;
}

export interface SchedulePlan {
  id: string;
  name: string;
  termCode: string;
  courses: PlanCourse[];
  selectedCRNs: string[];
  filters: {
    earliestStart?: number | null;
    latestEnd?: number | null;
    freeDays: number;
    includeHonors: boolean;
    includeOnline: boolean;
    hideFullSections: boolean;
    minSeats: number;
    campus?: string | null;
    courseCount?: number | null;
  };
  preferences?: SchedulePreferences | null;
  favoriteCombinations: string[][];
  isPrimary: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Set once existing selected CRNs have been copied onto `pinnedCRN`.
   * Generated weeks after that stay unpinned, so a later search can still change them.
   */
  manualPinsMigrated?: boolean;
}

export interface WatchItem {
  termCode: string;
  crn: string;
  courseKey: CourseKey;
  courseTitle: string;
  sectionLabel: string;
  addedAt: number;
  lastSeatsRemaining: number;
  lastWaitlistRemaining: number;
  seatCapacity: number;
  lastCheckedAt?: number | null;
  notifyOnWaitlist: boolean;
  lastNotifiedAt?: number | null;
}

export interface AppPreferences {
  selectedTermCode?: string | null;
  preferredCampus?: string | null;
  hasCompletedOnboarding: boolean;
  showWeekends: boolean;
  autoRefreshSeats: boolean;
  backgroundRefreshEnabled: boolean;
  calendarStartHour: number;
  calendarEndHour: number;
  /** Minutes between seat checks while the site is open. */
  watchlistIntervalMinutes: number;
  notificationsEnabled: boolean;
  /** Search level band. Omitted means all courses. */
  searchLevel?: LevelBand;
}

export interface UserData {
  version: number;
  preferences: AppPreferences;
  saved: SavedCourse[];
  recents: RecentCourse[];
  plans: SchedulePlan[];
  watchlist: WatchItem[];
  searchHistory: string[];
  degreePlans: DegreePlan[];
}

export function defaultPreferences(): AppPreferences {
  return {
    hasCompletedOnboarding: false,
    showWeekends: false,
    autoRefreshSeats: true,
    backgroundRefreshEnabled: true,
    calendarStartHour: 8,
    calendarEndHour: 21,
    watchlistIntervalMinutes: 15,
    notificationsEnabled: false,
  };
}

export function emptyUserData(): UserData {
  return {
    version: 1,
    preferences: defaultPreferences(),
    saved: [],
    recents: [],
    plans: [],
    watchlist: [],
    searchHistory: [],
    degreePlans: [],
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyPlanFilters(): SchedulePlan["filters"] {
  return { freeDays: 0, includeHonors: true, includeOnline: true, hideFullSections: false, minSeats: 0 };
}

export function nextColorIndex(plan: SchedulePlan): number {
  const used = new Set(plan.courses.map((c) => c.colorIndex));
  for (let i = 0; i < COURSE_PALETTE.length; i++) if (!used.has(i)) return i;
  return plan.courses.length % COURSE_PALETTE.length;
}

export function watchId(item: Pick<WatchItem, "termCode" | "crn">): string {
  return `${item.termCode}|${item.crn}`;
}

export function savedId(item: Pick<SavedCourse, "termCode" | "key">): string {
  return `${item.termCode}|${keyId(item.key)}`;
}

const STORAGE_KEY = "term-organize.user.v1";

export function loadUserData(): UserData {
  if (typeof localStorage === "undefined") return emptyUserData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyUserData();
    return mergeUserData(JSON.parse(raw));
  } catch {
    return emptyUserData();
  }
}

export function saveUserData(data: UserData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Degree-plan decode matching `DegreePlan.init(from:)`.
 * A present `completed` or `terms` value that is not an array fails the whole plan
 * (the entry is skipped). Missing substitutions and equivalences become empty lists.
 * A missing catalog year stays unset.
 */
export function decodeDegreePlan(raw: unknown): DegreePlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const plan = { ...(raw as DegreePlan) };
  if (plan.completed != null && !Array.isArray(plan.completed)) return null;
  if (plan.terms != null && !Array.isArray(plan.terms)) return null;
  if (plan.catalogYear != null && typeof plan.catalogYear !== "number") return null;
  if (typeof plan.name !== "string") plan.name = "Degree Plan";
  if (typeof plan.id !== "string") plan.id = newId();
  if (!Array.isArray(plan.completed)) plan.completed = [];
  if (!Array.isArray(plan.terms)) plan.terms = [];
  if (typeof plan.isPrimary !== "boolean") plan.isPrimary = false;
  if (typeof plan.createdAt !== "number") plan.createdAt = Date.now() / 1000;
  if (typeof plan.updatedAt !== "number") plan.updatedAt = Date.now() / 1000;
  if (!Array.isArray(plan.substitutions)) plan.substitutions = [];
  if (!Array.isArray(plan.courseEquivalences)) plan.courseEquivalences = [];
  plan.completed = plan.completed.map((course) => migrateDegreeCourse(course));
  plan.terms = plan.terms.map((term) => ({ ...term, courses: term.courses.map((course) => migrateDegreeCourse(course)) }));
  return plan;
}

/** Tolerant merge: unknown or broken entries are skipped. */
export function mergeUserData(raw: unknown): UserData {
  const base = emptyUserData();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<UserData>;
  base.version = typeof o.version === "number" ? o.version : 1;
  if (o.preferences && typeof o.preferences === "object") {
    base.preferences = { ...base.preferences, ...o.preferences };
  }
  base.saved = arrayOf(o.saved);
  base.recents = arrayOf(o.recents);
  base.plans = arrayOf<SchedulePlan>(o.plans).map((plan) =>
    plan && Array.isArray(plan.courses) ? { ...plan, courses: plan.courses.map((course) => migratePlanCourse(course)) } : plan,
  );
  base.watchlist = arrayOf(o.watchlist);
  base.searchHistory = arrayOf(o.searchHistory).filter((s) => typeof s === "string");
  base.degreePlans = arrayOf<unknown>(o.degreePlans).flatMap((plan) => {
    const decoded = decodeDegreePlan(plan);
    return decoded ? [decoded] : [];
  });
  return base;
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function keepOnePrimaryPlan(plans: SchedulePlan[], termCode: string, primaryId: string): SchedulePlan[] {
  return plans.map((p) => (p.termCode === termCode ? { ...p, isPrimary: p.id === primaryId } : p));
}

export function keepOnePrimaryDegree(plans: DegreePlan[], primaryId: string): DegreePlan[] {
  return plans.map((p) => ({ ...p, isPrimary: p.id === primaryId }));
}

/** Whether a plan for this term holds the course, or the given section when `crn` is set. */
export function courseIsInSchedule(data: UserData, termCode: string, key: CourseKey, crn?: string): boolean {
  const termPlans = data.plans.filter((plan) => plan.termCode === termCode);
  if (crn != null) return termPlans.some((plan) => plan.selectedCRNs.includes(crn));
  return termPlans.some((plan) => plan.courses.some((course) => sameKey(course.key, key)));
}
