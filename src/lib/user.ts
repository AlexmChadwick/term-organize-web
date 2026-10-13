/**
 * User data persisted in the browser.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/UserModels.swift. iCloud sync is omitted; export/import
 * JSON is the way to move data between browsers.
 */

import type { CourseKey } from "./models";
import { COURSE_PALETTE, keyId } from "./models";
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
  base.plans = arrayOf(o.plans);
  base.watchlist = arrayOf(o.watchlist);
  base.searchHistory = arrayOf(o.searchHistory).filter((s) => typeof s === "string");
  base.degreePlans = arrayOf(o.degreePlans);
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
