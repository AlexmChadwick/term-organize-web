/**
 * Pure iCloud sync payloads, fingerprints, merging, and conflicts.
 *
 * Copyright (C) 2026 Term Organize contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Web port of Services/CloudSync (CloudSyncModel, CloudSyncState, CloudSyncStatus,
 * CloudSyncEntitlements). No CloudKit, network, or iCloud UI.
 */

import { createHash } from "node:crypto";

/** Swift `Date.distantPast` as seconds since 1970 (year 1). */
export const distantPast = -62_135_769_600;

export const CloudSyncConfig = {
  containerInfoKey: "NEUCloudKitContainerIdentifier",
  zoneName: "UserData",
  schemaVersion: 1,
  containerIdentifier(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const identifier = value.trim();
    if (!identifier.startsWith("iCloud.") || identifier.length <= "iCloud.".length) return null;
    if (identifier.includes("$(")) return null;
    return identifier;
  },
};

export type CloudSyncRecordType = "SchedulePlan" | "DegreePlan" | "WatchItem" | "SavedCourse" | "Preferences";

export interface CloudSyncKey {
  type: CloudSyncRecordType;
  recordName: string;
}

export function compareKeys(a: CloudSyncKey, b: CloudSyncKey): number {
  if (a.type < b.type) return -1;
  if (a.type > b.type) return 1;
  if (a.recordName < b.recordName) return -1;
  if (a.recordName > b.recordName) return 1;
  return 0;
}

export function sameSyncKey(a: CloudSyncKey, b: CloudSyncKey): boolean {
  return a.type === b.type && a.recordName === b.recordName;
}

export function keyId(key: CloudSyncKey): string {
  return `${key.type}\u0000${key.recordName}`;
}

export const preferencesKey: CloudSyncKey = { type: "Preferences", recordName: "preferences" };

export function recordNameForID(id: string): string {
  const bytes = new TextEncoder().encode(id);
  const usable =
    id.length > 0 &&
    bytes.length <= 255 &&
    !id.startsWith("_") &&
    [...id].every((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code < 0x7f;
    });
  if (usable) return id;
  return `sha256-${hexDigest(bytes)}`;
}

export function syncKey(type: CloudSyncRecordType, id: string): CloudSyncKey {
  return { type, recordName: recordNameForID(id) };
}

export interface CourseKey {
  subject: string;
  number: string;
}

export function courseKey(subject: string, number: string): CourseKey {
  return { subject, number };
}

export function courseKeyDescription(key: CourseKey): string {
  return `${key.subject} ${key.number}`;
}

export interface ScheduleFilters {
  earliestStart: number | null;
  latestEnd: number | null;
  freeDays: number;
  includeHonors: boolean;
  includeOnline: boolean;
  hideFullSections: boolean;
  minSeats: number;
  campus: string | null;
  courseCount: number | null;
}

export function defaultScheduleFilters(): ScheduleFilters {
  return {
    earliestStart: null,
    latestEnd: null,
    freeDays: 0,
    includeHonors: true,
    includeOnline: true,
    hideFullSections: false,
    minSeats: 0,
    campus: null,
    courseCount: null,
  };
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
  filters: ScheduleFilters;
  preferences: null;
  favoriteCombinations: string[][];
  isPrimary: boolean;
  createdAt: number;
  updatedAt: number;
}

export function makeSchedulePlan(partial: {
  id?: string;
  name?: string;
  termCode?: string;
  isPrimary?: boolean;
  updatedAt?: number;
  createdAt?: number;
  courses?: PlanCourse[];
  selectedCRNs?: string[];
}): SchedulePlan {
  const now = partial.createdAt ?? partial.updatedAt ?? 0;
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "My Schedule",
    termCode: partial.termCode ?? "202710",
    courses: partial.courses ?? [],
    selectedCRNs: partial.selectedCRNs ?? [],
    filters: defaultScheduleFilters(),
    preferences: null,
    favoriteCombinations: [],
    isPrimary: partial.isPrimary ?? false,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
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
  lastCheckedAt: number | null;
  notifyOnWaitlist: boolean;
  lastNotifiedAt: number | null;
}

export function watchItemId(item: Pick<WatchItem, "termCode" | "crn">): string {
  return `${item.termCode}|${item.crn}`;
}

export interface SavedCourse {
  termCode: string;
  key: CourseKey;
  savedAt: number;
}

export function savedCourseId(course: SavedCourse): string {
  return `${course.termCode}|${courseKeyDescription(course.key)}`;
}

export interface AppPreferences {
  selectedTermCode: string | null;
  preferredCampus: string | null;
  hasCompletedOnboarding: boolean;
  showWeekends: boolean;
  autoRefreshSeats: boolean;
  backgroundRefreshEnabled: boolean;
  calendarStartHour: number;
  calendarEndHour: number;
}

export function defaultPreferences(): AppPreferences {
  return {
    selectedTermCode: null,
    preferredCampus: null,
    hasCompletedOnboarding: false,
    showWeekends: false,
    autoRefreshSeats: true,
    backgroundRefreshEnabled: true,
    calendarStartHour: 8,
    calendarEndHour: 21,
  };
}

export interface DegreePlanCourse {
  id: string;
  key: CourseKey | null;
  label: string;
  title: string;
  credits: number;
}

export function makeDegreeCourse(key: CourseKey, title: string, credits: number, id = crypto.randomUUID()): DegreePlanCourse {
  return { id, key, label: courseKeyDescription(key), title, credits };
}

export interface DegreePlanTerm {
  id: string;
  season: string;
  year: number;
  courses: DegreePlanCourse[];
}

export interface DegreePlan {
  id: string;
  name: string;
  program: string | null;
  studentName: string | null;
  studentID: string | null;
  completed: DegreePlanCourse[];
  terms: DegreePlanTerm[];
  isPrimary: boolean;
  importedFrom: string | null;
  printedAt: number | null;
  createdAt: number;
  updatedAt: number;
  catalogYear: number | null;
  catalogProgramPath: string | null;
  catalogProgramTitle: string | null;
  concentrationID: string | null;
  substitutions: unknown[];
  courseEquivalences: unknown[];
}

export function makeDegreePlan(partial: { id?: string; name?: string; updatedAt?: number; createdAt?: number } = {}): DegreePlan {
  const now = partial.createdAt ?? partial.updatedAt ?? 0;
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "Degree Plan",
    program: null,
    studentName: null,
    studentID: null,
    completed: [],
    terms: [],
    isPrimary: false,
    importedFrom: null,
    printedAt: null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    catalogYear: null,
    catalogProgramPath: null,
    catalogProgramTitle: null,
    concentrationID: null,
    substitutions: [],
    courseEquivalences: [],
  };
}

export interface UserData {
  version: number;
  preferences: AppPreferences;
  saved: SavedCourse[];
  recents: unknown[];
  plans: SchedulePlan[];
  watchlist: WatchItem[];
  searchHistory: string[];
  degreePlans: DegreePlan[];
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

export type CloudSyncEntity =
  | { type: "schedulePlan"; plan: SchedulePlan }
  | { type: "degreePlan"; plan: DegreePlan }
  | { type: "watchItem"; item: WatchItem }
  | { type: "savedCourse"; course: SavedCourse }
  | { type: "preferences"; preferences: AppPreferences };

export function entityKey(entity: CloudSyncEntity): CloudSyncKey {
  switch (entity.type) {
    case "schedulePlan":
      return syncKey("SchedulePlan", entity.plan.id);
    case "degreePlan":
      return syncKey("DegreePlan", entity.plan.id);
    case "watchItem":
      return syncKey("WatchItem", watchItemId(entity.item));
    case "savedCourse":
      return syncKey("SavedCourse", savedCourseId(entity.course));
    case "preferences":
      return preferencesKey;
  }
}

export interface CloudSyncedPreferences {
  preferredCampus: string | null;
  showWeekends: boolean;
  calendarStartHour: number;
  calendarEndHour: number;
}

type PreferenceField = "preferredCampus" | "showWeekends" | "calendarStartHour" | "calendarEndHour";
const PREFERENCE_FIELDS: PreferenceField[] = ["preferredCampus", "showWeekends", "calendarStartHour", "calendarEndHour"];

export function syncedPreferences(preferences: AppPreferences): CloudSyncedPreferences {
  return {
    preferredCampus: preferences.preferredCampus,
    showWeekends: preferences.showWeekends,
    calendarStartHour: preferences.calendarStartHour,
    calendarEndHour: preferences.calendarEndHour,
  };
}

export function applySyncedPreferences(values: CloudSyncedPreferences, preferences: AppPreferences): AppPreferences {
  return {
    ...preferences,
    preferredCampus: values.preferredCampus,
    showWeekends: values.showWeekends,
    calendarStartHour: values.calendarStartHour,
    calendarEndHour: values.calendarEndHour,
  };
}

function fieldsDiffering(a: CloudSyncedPreferences, b: CloudSyncedPreferences): PreferenceField[] {
  return PREFERENCE_FIELDS.filter((field) => a[field] !== b[field]);
}

function copyField(base: CloudSyncedPreferences, field: PreferenceField, from: CloudSyncedPreferences): CloudSyncedPreferences {
  return { ...base, [field]: from[field] };
}

export interface PreferenceMerge {
  values: CloudSyncedPreferences;
  changedAt: Record<string, number>;
}

export function mergePreferences(
  local: CloudSyncedPreferences,
  localChangedAt: Record<string, number>,
  remote: CloudSyncedPreferences,
  remoteChangedAt: Record<string, number>,
): PreferenceMerge {
  const defaults = syncedPreferences(defaultPreferences());
  let values = { ...remote };
  const changedAt = { ...remoteChangedAt };
  for (const field of PREFERENCE_FIELDS) {
    const localTime = localChangedAt[field];
    const remoteTime = remoteChangedAt[field];
    let localWins: boolean;
    if (localTime != null && remoteTime != null) localWins = localTime > remoteTime;
    else if (localTime != null && remoteTime == null) localWins = true;
    else if (localTime == null && remoteTime != null) localWins = false;
    else {
      const localIsDefault = !fieldsDiffering(local, defaults).includes(field);
      const remoteIsDefault = !fieldsDiffering(remote, defaults).includes(field);
      localWins = remoteIsDefault && !localIsDefault;
    }
    if (!localWins) continue;
    values = copyField(values, field, local);
    if (localTime != null) changedAt[field] = localTime;
  }
  return { values, changedAt };
}

function decodeSyncedPreferences(raw: unknown): CloudSyncedPreferences {
  const defaults = syncedPreferences(defaultPreferences());
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const preferredCampus = typeof o.preferredCampus === "string" ? o.preferredCampus : null;
  const showWeekends = typeof o.showWeekends === "boolean" ? o.showWeekends : defaults.showWeekends;
  const start = typeof o.calendarStartHour === "number" ? o.calendarStartHour : defaults.calendarStartHour;
  const end = typeof o.calendarEndHour === "number" ? o.calendarEndHour : defaults.calendarEndHour;
  const hoursOk = start >= 0 && start <= 23 && end >= 1 && end <= 24 && start < end;
  return {
    preferredCampus,
    showWeekends,
    calendarStartHour: hoursOk ? start : defaults.calendarStartHour,
    calendarEndHour: hoursOk ? end : defaults.calendarEndHour,
  };
}

export type CloudSyncRemoteValue =
  | { type: "schedulePlan"; plan: SchedulePlan }
  | { type: "degreePlan"; plan: DegreePlan }
  | { type: "watchItem"; item: WatchItem }
  | { type: "savedCourse"; course: SavedCourse }
  | { type: "preferences"; values: CloudSyncedPreferences; changedAt: Record<string, number> };

export function remoteKey(value: CloudSyncRemoteValue): CloudSyncKey {
  switch (value.type) {
    case "schedulePlan":
      return syncKey("SchedulePlan", value.plan.id);
    case "degreePlan":
      return syncKey("DegreePlan", value.plan.id);
    case "watchItem":
      return syncKey("WatchItem", watchItemId(value.item));
    case "savedCourse":
      return syncKey("SavedCourse", savedCourseId(value.course));
    case "preferences":
      return preferencesKey;
  }
}

export function syncedForm(plan: DegreePlan): DegreePlan {
  return { ...plan, studentName: null, studentID: null };
}

function trackedForm(item: WatchItem): WatchItem {
  return {
    ...item,
    lastSeatsRemaining: 0,
    lastWaitlistRemaining: 0,
    seatCapacity: 0,
    lastCheckedAt: null,
    lastNotifiedAt: null,
  };
}

function iso(seconds: number): string {
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseIso(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms / 1000;
}

const UNORDERED = new Set(["excludedCRNs"]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const child = obj[key];
      if (child === undefined) continue;
      if (UNORDERED.has(key) && Array.isArray(child) && child.every((item) => typeof item === "string")) {
        out[key] = [...child].sort();
      } else out[key] = canonicalize(child);
    }
    return out;
  }
  return value;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalize(value)));
}

export function hexDigest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function omitNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

function courseJSON(key: CourseKey): Record<string, unknown> {
  return { number: key.number, subject: key.subject };
}

function filtersJSON(filters: ScheduleFilters): Record<string, unknown> {
  return omitNulls({
    campus: filters.campus,
    courseCount: filters.courseCount,
    earliestStart: filters.earliestStart,
    freeDays: filters.freeDays,
    hideFullSections: filters.hideFullSections,
    includeHonors: filters.includeHonors,
    includeOnline: filters.includeOnline,
    latestEnd: filters.latestEnd,
    minSeats: filters.minSeats,
  });
}

function planCourseJSON(course: PlanCourse): Record<string, unknown> {
  return {
    colorIndex: course.colorIndex,
    excludedCRNs: course.excludedCRNs,
    isRequired: course.isRequired,
    key: courseJSON(course.key),
  };
}

function scheduleJSON(plan: SchedulePlan): Record<string, unknown> {
  return omitNulls({
    courses: plan.courses.map(planCourseJSON),
    createdAt: iso(plan.createdAt),
    favoriteCombinations: plan.favoriteCombinations,
    filters: filtersJSON(plan.filters),
    id: plan.id,
    isPrimary: plan.isPrimary,
    name: plan.name,
    preferences: plan.preferences,
    selectedCRNs: plan.selectedCRNs,
    termCode: plan.termCode,
    updatedAt: iso(plan.updatedAt),
  });
}

function degreeCourseJSON(course: DegreePlanCourse): Record<string, unknown> {
  return omitNulls({
    credits: course.credits,
    id: course.id,
    key: course.key ? courseJSON(course.key) : null,
    label: course.label,
    title: course.title,
  });
}

function degreeTermJSON(term: DegreePlanTerm): Record<string, unknown> {
  return {
    courses: term.courses.map(degreeCourseJSON),
    id: term.id,
    season: term.season,
    year: term.year,
  };
}

function degreeJSON(plan: DegreePlan): Record<string, unknown> {
  return omitNulls({
    catalogProgramPath: plan.catalogProgramPath,
    catalogProgramTitle: plan.catalogProgramTitle,
    catalogYear: plan.catalogYear,
    completed: plan.completed.map(degreeCourseJSON),
    concentrationID: plan.concentrationID,
    courseEquivalences: plan.courseEquivalences,
    createdAt: iso(plan.createdAt),
    id: plan.id,
    importedFrom: plan.importedFrom,
    isPrimary: plan.isPrimary,
    name: plan.name,
    printedAt: plan.printedAt == null ? null : iso(plan.printedAt),
    program: plan.program,
    studentID: plan.studentID,
    studentName: plan.studentName,
    substitutions: plan.substitutions,
    terms: plan.terms.map(degreeTermJSON),
    updatedAt: iso(plan.updatedAt),
  });
}

function watchJSON(item: WatchItem): Record<string, unknown> {
  return omitNulls({
    addedAt: iso(item.addedAt),
    courseKey: courseJSON(item.courseKey),
    courseTitle: item.courseTitle,
    crn: item.crn,
    lastCheckedAt: item.lastCheckedAt == null ? null : iso(item.lastCheckedAt),
    lastNotifiedAt: item.lastNotifiedAt == null ? null : iso(item.lastNotifiedAt),
    lastSeatsRemaining: item.lastSeatsRemaining,
    lastWaitlistRemaining: item.lastWaitlistRemaining,
    notifyOnWaitlist: item.notifyOnWaitlist,
    seatCapacity: item.seatCapacity,
    sectionLabel: item.sectionLabel,
    termCode: item.termCode,
  });
}

function savedJSON(course: SavedCourse): Record<string, unknown> {
  return {
    key: courseJSON(course.key),
    savedAt: iso(course.savedAt),
    termCode: course.termCode,
  };
}

function syncedValuesJSON(values: CloudSyncedPreferences): Record<string, unknown> {
  return omitNulls({
    calendarEndHour: values.calendarEndHour,
    calendarStartHour: values.calendarStartHour,
    preferredCampus: values.preferredCampus,
    showWeekends: values.showWeekends,
  });
}

function preferencesJSON(values: CloudSyncedPreferences, changedAt: Record<string, number>): Record<string, unknown> {
  return {
    changedAt: Object.fromEntries(Object.entries(changedAt).map(([key, time]) => [key, iso(time)])),
    values: syncedValuesJSON(values),
  };
}

function fingerprintOfJSON(value: unknown): string {
  return hexDigest(canonicalBytes(value));
}

export const CloudSyncCoding = {
  payload(entity: CloudSyncEntity, preferenceChangedAt: Record<string, number> = {}): Uint8Array {
    switch (entity.type) {
      case "schedulePlan":
        return canonicalBytes(scheduleJSON(entity.plan));
      case "degreePlan":
        return canonicalBytes(degreeJSON(syncedForm(entity.plan)));
      case "watchItem":
        return canonicalBytes(watchJSON(entity.item));
      case "savedCourse":
        return canonicalBytes(savedJSON(entity.course));
      case "preferences":
        return canonicalBytes(preferencesJSON(syncedPreferences(entity.preferences), preferenceChangedAt));
    }
  },

  decode(payload: Uint8Array, type: CloudSyncRecordType): CloudSyncRemoteValue {
    const json = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    switch (type) {
      case "SchedulePlan":
        return { type: "schedulePlan", plan: decodeSchedule(json) };
      case "DegreePlan":
        return { type: "degreePlan", plan: syncedForm(decodeDegree(json)) };
      case "WatchItem":
        return { type: "watchItem", item: decodeWatch(json) };
      case "SavedCourse":
        return { type: "savedCourse", course: decodeSaved(json) };
      case "Preferences":
        return decodePreferencesPayload(json);
    }
  },

  fingerprint(entity: CloudSyncEntity): string {
    switch (entity.type) {
      case "schedulePlan":
        return fingerprintOfJSON(scheduleJSON(entity.plan));
      case "degreePlan":
        return fingerprintOfJSON(degreeJSON(syncedForm(entity.plan)));
      case "watchItem":
        return fingerprintOfJSON(watchJSON(trackedForm(entity.item)));
      case "savedCourse":
        return fingerprintOfJSON(savedJSON(entity.course));
      case "preferences":
        return fingerprintOfJSON(syncedValuesJSON(syncedPreferences(entity.preferences)));
    }
  },

  fingerprintOfRemote(value: CloudSyncRemoteValue): string {
    switch (value.type) {
      case "schedulePlan":
        return fingerprintOfJSON(scheduleJSON(value.plan));
      case "degreePlan":
        return fingerprintOfJSON(degreeJSON(syncedForm(value.plan)));
      case "watchItem":
        return fingerprintOfJSON(watchJSON(trackedForm(value.item)));
      case "savedCourse":
        return fingerprintOfJSON(savedJSON(value.course));
      case "preferences":
        return fingerprintOfJSON(syncedValuesJSON(value.values));
    }
  },

  modifiedAt(entity: CloudSyncEntity, localChangedAt: number | null, preferenceChangedAt: Record<string, number> = {}): number {
    switch (entity.type) {
      case "schedulePlan":
        return Math.max(entity.plan.updatedAt, localChangedAt ?? distantPast);
      case "degreePlan":
        return Math.max(entity.plan.updatedAt, localChangedAt ?? distantPast);
      case "watchItem":
        return localChangedAt ?? entity.item.addedAt;
      case "savedCourse":
        return localChangedAt ?? entity.course.savedAt;
      case "preferences": {
        const times = Object.values(preferenceChangedAt);
        if (times.length) return Math.max(...times);
        return localChangedAt ?? distantPast;
      }
    }
  },

  syncedForm,
};

function reqString(o: Record<string, unknown>, key: string, fallback = ""): string {
  return typeof o[key] === "string" ? (o[key] as string) : fallback;
}

function reqNumber(o: Record<string, unknown>, key: string, fallback: number): number {
  return typeof o[key] === "number" ? (o[key] as number) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function decodeKey(value: unknown): CourseKey {
  const o = asRecord(value);
  return { subject: reqString(o, "subject"), number: reqString(o, "number") };
}

function decodeFilters(value: unknown): ScheduleFilters {
  const o = asRecord(value);
  const base = defaultScheduleFilters();
  return {
    earliestStart: typeof o.earliestStart === "number" ? o.earliestStart : null,
    latestEnd: typeof o.latestEnd === "number" ? o.latestEnd : null,
    freeDays: typeof o.freeDays === "number" ? o.freeDays : base.freeDays,
    includeHonors: typeof o.includeHonors === "boolean" ? o.includeHonors : base.includeHonors,
    includeOnline: typeof o.includeOnline === "boolean" ? o.includeOnline : base.includeOnline,
    hideFullSections: typeof o.hideFullSections === "boolean" ? o.hideFullSections : base.hideFullSections,
    minSeats: typeof o.minSeats === "number" ? o.minSeats : base.minSeats,
    campus: typeof o.campus === "string" ? o.campus : null,
    courseCount: typeof o.courseCount === "number" ? o.courseCount : null,
  };
}

function decodeSchedule(value: unknown): SchedulePlan {
  const o = asRecord(value);
  const courses = Array.isArray(o.courses) ? o.courses.map((item) => {
    const c = asRecord(item);
    return {
      key: decodeKey(c.key),
      isRequired: c.isRequired !== false,
      excludedCRNs: Array.isArray(c.excludedCRNs) ? c.excludedCRNs.filter((crn): crn is string => typeof crn === "string") : [],
      colorIndex: reqNumber(c, "colorIndex", 0),
    };
  }) : [];
  return {
    id: reqString(o, "id"),
    name: reqString(o, "name"),
    termCode: reqString(o, "termCode"),
    courses,
    selectedCRNs: Array.isArray(o.selectedCRNs) ? o.selectedCRNs.filter((crn): crn is string => typeof crn === "string") : [],
    filters: decodeFilters(o.filters),
    preferences: null,
    favoriteCombinations: Array.isArray(o.favoriteCombinations) ? (o.favoriteCombinations as string[][]) : [],
    isPrimary: o.isPrimary === true,
    createdAt: parseIso(o.createdAt) ?? 0,
    updatedAt: parseIso(o.updatedAt) ?? 0,
  };
}

function decodeDegreeCourse(value: unknown): DegreePlanCourse {
  const o = asRecord(value);
  const key = o.key == null ? null : decodeKey(o.key);
  return {
    id: reqString(o, "id", crypto.randomUUID()),
    key,
    label: reqString(o, "label", key ? courseKeyDescription(key) : ""),
    title: reqString(o, "title"),
    credits: reqNumber(o, "credits", 0),
  };
}

function decodeDegree(value: unknown): DegreePlan {
  const o = asRecord(value);
  const plan = makeDegreePlan();
  plan.id = reqString(o, "id", plan.id);
  plan.name = reqString(o, "name", "Degree Plan");
  plan.program = typeof o.program === "string" ? o.program : null;
  plan.studentName = typeof o.studentName === "string" ? o.studentName : null;
  plan.studentID = typeof o.studentID === "string" ? o.studentID : null;
  plan.completed = Array.isArray(o.completed) ? o.completed.map(decodeDegreeCourse) : [];
  plan.terms = Array.isArray(o.terms)
    ? o.terms.map((item) => {
        const t = asRecord(item);
        return {
          id: reqString(t, "id", crypto.randomUUID()),
          season: reqString(t, "season"),
          year: reqNumber(t, "year", 0),
          courses: Array.isArray(t.courses) ? t.courses.map(decodeDegreeCourse) : [],
        };
      })
    : [];
  plan.isPrimary = o.isPrimary === true;
  plan.importedFrom = typeof o.importedFrom === "string" ? o.importedFrom : null;
  plan.printedAt = parseIso(o.printedAt);
  plan.createdAt = parseIso(o.createdAt) ?? plan.createdAt;
  plan.updatedAt = parseIso(o.updatedAt) ?? plan.updatedAt;
  plan.catalogYear = typeof o.catalogYear === "number" ? o.catalogYear : null;
  plan.catalogProgramPath = typeof o.catalogProgramPath === "string" ? o.catalogProgramPath : null;
  plan.catalogProgramTitle = typeof o.catalogProgramTitle === "string" ? o.catalogProgramTitle : null;
  plan.concentrationID = typeof o.concentrationID === "string" ? o.concentrationID : null;
  plan.substitutions = Array.isArray(o.substitutions) ? o.substitutions : [];
  plan.courseEquivalences = Array.isArray(o.courseEquivalences) ? o.courseEquivalences : [];
  return plan;
}

function decodeWatch(value: unknown): WatchItem {
  const o = asRecord(value);
  return {
    termCode: reqString(o, "termCode"),
    crn: reqString(o, "crn"),
    courseKey: decodeKey(o.courseKey),
    courseTitle: reqString(o, "courseTitle"),
    sectionLabel: reqString(o, "sectionLabel"),
    addedAt: parseIso(o.addedAt) ?? 0,
    lastSeatsRemaining: reqNumber(o, "lastSeatsRemaining", 0),
    lastWaitlistRemaining: reqNumber(o, "lastWaitlistRemaining", 0),
    seatCapacity: reqNumber(o, "seatCapacity", 0),
    lastCheckedAt: parseIso(o.lastCheckedAt),
    notifyOnWaitlist: o.notifyOnWaitlist === true,
    lastNotifiedAt: parseIso(o.lastNotifiedAt),
  };
}

function decodeSaved(value: unknown): SavedCourse {
  const o = asRecord(value);
  return { termCode: reqString(o, "termCode"), key: decodeKey(o.key), savedAt: parseIso(o.savedAt) ?? 0 };
}

function decodeDateMap(value: unknown): Record<string, number> {
  const o = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, time] of Object.entries(o)) {
    const parsed = parseIso(time);
    if (parsed != null) out[key] = parsed;
  }
  return out;
}

function decodePreferencesPayload(value: unknown): CloudSyncRemoteValue {
  const o = asRecord(value);
  return { type: "preferences", values: decodeSyncedPreferences(o.values), changedAt: decodeDateMap(o.changedAt) };
}

export interface CloudSyncSnapshotItem {
  entity: CloudSyncEntity;
  fingerprint: string;
  key: CloudSyncKey;
}

export interface CloudSyncSnapshot {
  items: Map<string, CloudSyncSnapshotItem>;
  preferences: AppPreferences;
  get(key: CloudSyncKey): CloudSyncSnapshotItem | undefined;
}

export function snapshotOf(data: UserData): CloudSyncSnapshot {
  const items = new Map<string, CloudSyncSnapshotItem>();
  const add = (entity: CloudSyncEntity) => {
    const key = entityKey(entity);
    const id = keyId(key);
    if (items.has(id)) return;
    items.set(id, { entity, fingerprint: CloudSyncCoding.fingerprint(entity), key });
  };
  add({ type: "preferences", preferences: data.preferences });
  for (const plan of data.plans) add({ type: "schedulePlan", plan });
  for (const plan of data.degreePlans) add({ type: "degreePlan", plan });
  for (const item of data.watchlist) add({ type: "watchItem", item });
  for (const course of data.saved) add({ type: "savedCourse", course });
  return {
    items,
    preferences: data.preferences,
    get(key) {
      return items.get(keyId(key));
    },
  };
}

export interface CloudSyncRecordState {
  localFingerprint: string | null;
  localChangedAt: number | null;
  serverFingerprint: string | null;
  systemFields: Uint8Array | null;
  isServerCopyUnreadable: boolean;
}

export function emptyRecordState(): CloudSyncRecordState {
  return {
    localFingerprint: null,
    localChangedAt: null,
    serverFingerprint: null,
    systemFields: null,
    isServerCopyUnreadable: false,
  };
}

export function isKnownInICloud(state: CloudSyncRecordState): boolean {
  return state.serverFingerprint != null || state.systemFields != null || state.isServerCopyUnreadable;
}

export interface CloudSyncMetadata {
  records: Map<string, { key: CloudSyncKey; state: CloudSyncRecordState }>;
  hasObservedLocalData: boolean;
  observedPreferences: CloudSyncedPreferences | null;
  preferenceChangedAt: Record<string, number>;
  accountRecordName: string | null;
  isZoneSaved: boolean;
  lastSyncDate: number | null;
}

export function emptyMetadata(): CloudSyncMetadata {
  return {
    records: new Map(),
    hasObservedLocalData: false,
    observedPreferences: null,
    preferenceChangedAt: {},
    accountRecordName: null,
    isZoneSaved: false,
    lastSyncDate: null,
  };
}

export function hasDataInICloud(metadata: CloudSyncMetadata): boolean {
  for (const { state } of metadata.records.values()) if (isKnownInICloud(state)) return true;
  return false;
}

export function cloneMetadata(metadata: CloudSyncMetadata): CloudSyncMetadata {
  return {
    records: new Map(
      [...metadata.records.entries()].map(([id, entry]) => [
        id,
        { key: { ...entry.key }, state: { ...entry.state, systemFields: entry.state.systemFields ? new Uint8Array(entry.state.systemFields) : null } },
      ]),
    ),
    hasObservedLocalData: metadata.hasObservedLocalData,
    observedPreferences: metadata.observedPreferences ? { ...metadata.observedPreferences } : null,
    preferenceChangedAt: { ...metadata.preferenceChangedAt },
    accountRecordName: metadata.accountRecordName,
    isZoneSaved: metadata.isZoneSaved,
    lastSyncDate: metadata.lastSyncDate,
  };
}

export function observeLocalData(metadata: CloudSyncMetadata, snapshot: CloudSyncSnapshot, now: number): void {
  const isFirstLook = !metadata.hasObservedLocalData;
  for (const item of snapshot.items.values()) {
    const id = keyId(item.key);
    const state = metadata.records.get(id)?.state ?? emptyRecordState();
    if (state.localFingerprint === item.fingerprint) continue;
    state.localFingerprint = item.fingerprint;
    state.localChangedAt = isFirstLook ? null : now;
    metadata.records.set(id, { key: item.key, state });
  }
  for (const [id, entry] of [...metadata.records.entries()]) {
    if (snapshot.get(entry.key) != null || entry.state.localFingerprint == null) continue;
    entry.state.localFingerprint = null;
    entry.state.localChangedAt = isFirstLook ? null : now;
    if (isKnownInICloud(entry.state)) metadata.records.set(id, entry);
    else metadata.records.delete(id);
  }
  const preferences = syncedPreferences(snapshot.preferences);
  if (metadata.observedPreferences && !isFirstLook) {
    for (const field of fieldsDiffering(preferences, metadata.observedPreferences)) metadata.preferenceChangedAt[field] = now;
  }
  metadata.observedPreferences = preferences;
  metadata.hasObservedLocalData = true;
}

export interface CloudSyncPendingChanges {
  saves: CloudSyncKey[];
  deletes: CloudSyncKey[];
  isEmpty: boolean;
}

export function pendingChanges(metadata: CloudSyncMetadata, snapshot: CloudSyncSnapshot): CloudSyncPendingChanges {
  const saves: CloudSyncKey[] = [];
  const deletes: CloudSyncKey[] = [];
  for (const item of snapshot.items.values()) {
    const state = metadata.records.get(keyId(item.key))?.state;
    if (state?.isServerCopyUnreadable) continue;
    if (state?.serverFingerprint !== item.fingerprint) saves.push(item.key);
  }
  for (const entry of metadata.records.values()) {
    if (snapshot.get(entry.key) == null && isKnownInICloud(entry.state) && !entry.state.isServerCopyUnreadable) deletes.push(entry.key);
  }
  saves.sort(compareKeys);
  deletes.sort(compareKeys);
  return { saves, deletes, isEmpty: saves.length === 0 && deletes.length === 0 };
}

export function forgetICloud(metadata: CloudSyncMetadata): void {
  for (const [id, entry] of [...metadata.records.entries()]) {
    entry.state.serverFingerprint = null;
    entry.state.systemFields = null;
    entry.state.isServerCopyUnreadable = false;
    if (entry.state.localFingerprint == null) metadata.records.delete(id);
    else metadata.records.set(id, entry);
  }
  metadata.isZoneSaved = false;
  metadata.lastSyncDate = null;
}

export function recordSaved(metadata: CloudSyncMetadata, key: CloudSyncKey, fingerprint: string | null, systemFields: Uint8Array | null): void {
  const id = keyId(key);
  const state = metadata.records.get(id)?.state ?? emptyRecordState();
  state.serverFingerprint = fingerprint;
  state.systemFields = systemFields;
  state.isServerCopyUnreadable = false;
  metadata.records.set(id, { key, state });
}

export function recordDeletedFromICloud(metadata: CloudSyncMetadata, key: CloudSyncKey): void {
  const id = keyId(key);
  const entry = metadata.records.get(id);
  if (!entry) return;
  entry.state.serverFingerprint = null;
  entry.state.systemFields = null;
  entry.state.isServerCopyUnreadable = false;
  if (entry.state.localFingerprint == null) metadata.records.delete(id);
}

function bytesJSON(data: Uint8Array | null): string | null {
  if (!data) return null;
  return Buffer.from(data).toString("base64");
}

function bytesFromJSON(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function encodeMetadata(metadata: CloudSyncMetadata): Uint8Array {
  const entries = [...metadata.records.values()]
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ key, state }) => ({
      key,
      state: omitNulls({
        isServerCopyUnreadable: state.isServerCopyUnreadable,
        localChangedAt: state.localChangedAt,
        localFingerprint: state.localFingerprint,
        serverFingerprint: state.serverFingerprint,
        systemFields: bytesJSON(state.systemFields),
      }),
    }));
  const body = omitNulls({
    accountRecordName: metadata.accountRecordName,
    hasObservedLocalData: metadata.hasObservedLocalData,
    isZoneSaved: metadata.isZoneSaved,
    lastSyncDate: metadata.lastSyncDate,
    observedPreferences: metadata.observedPreferences,
    preferenceChangedAt: metadata.preferenceChangedAt,
    records: entries,
  });
  return new TextEncoder().encode(JSON.stringify(body));
}

export function decodeMetadata(data: Uint8Array): CloudSyncMetadata {
  const o = asRecord(JSON.parse(new TextDecoder().decode(data)));
  const metadata = emptyMetadata();
  metadata.hasObservedLocalData = o.hasObservedLocalData === true;
  metadata.observedPreferences = o.observedPreferences ? decodeSyncedPreferences(o.observedPreferences) : null;
  metadata.preferenceChangedAt = {};
  for (const [key, time] of Object.entries(asRecord(o.preferenceChangedAt))) {
    if (typeof time === "number") metadata.preferenceChangedAt[key] = time;
  }
  metadata.accountRecordName = typeof o.accountRecordName === "string" ? o.accountRecordName : null;
  metadata.isZoneSaved = o.isZoneSaved === true;
  metadata.lastSyncDate = typeof o.lastSyncDate === "number" ? o.lastSyncDate : null;
  const entries = Array.isArray(o.records) ? o.records : [];
  for (const entry of entries) {
    const row = asRecord(entry);
    const keyRaw = asRecord(row.key);
    const key: CloudSyncKey = { type: reqString(keyRaw, "type") as CloudSyncRecordType, recordName: reqString(keyRaw, "recordName") };
    const stateRaw = asRecord(row.state);
    const state = emptyRecordState();
    state.localFingerprint = typeof stateRaw.localFingerprint === "string" ? stateRaw.localFingerprint : null;
    state.localChangedAt = typeof stateRaw.localChangedAt === "number" ? stateRaw.localChangedAt : null;
    state.serverFingerprint = typeof stateRaw.serverFingerprint === "string" ? stateRaw.serverFingerprint : null;
    state.systemFields = bytesFromJSON(stateRaw.systemFields);
    state.isServerCopyUnreadable = stateRaw.isServerCopyUnreadable === true;
    metadata.records.set(keyId(key), { key, state });
  }
  return metadata;
}

export function metadataEqual(a: CloudSyncMetadata, b: CloudSyncMetadata): boolean {
  return Buffer.from(encodeMetadata(a)).equals(Buffer.from(encodeMetadata(b)));
}

export interface CloudSyncIncomingRecord {
  key: CloudSyncKey;
  schemaVersion: number;
  modifiedAt: number;
  payload: Uint8Array | null;
  systemFields: Uint8Array | null;
}

export interface CloudSyncMergeResult {
  saves: CloudSyncEntity[];
  deletes: CloudSyncKey[];
  keptLocal: CloudSyncKey[];
  skipped: CloudSyncKey[];
  changesLocalData: boolean;
}

export function localValue(remote: CloudSyncRemoteValue, current: CloudSyncEntity | null): CloudSyncEntity {
  switch (remote.type) {
    case "schedulePlan":
      return { type: "schedulePlan", plan: remote.plan };
    case "degreePlan": {
      const plan = { ...remote.plan };
      if (current?.type === "degreePlan") {
        plan.studentName = current.plan.studentName;
        plan.studentID = current.plan.studentID;
      }
      return { type: "degreePlan", plan };
    }
    case "watchItem": {
      const item = { ...remote.item };
      if (current?.type === "watchItem") {
        item.lastSeatsRemaining = current.item.lastSeatsRemaining;
        item.lastWaitlistRemaining = current.item.lastWaitlistRemaining;
        item.seatCapacity = current.item.seatCapacity;
        item.lastCheckedAt = current.item.lastCheckedAt;
        item.lastNotifiedAt = current.item.lastNotifiedAt;
      }
      return { type: "watchItem", item };
    }
    case "savedCourse":
      return { type: "savedCourse", course: remote.course };
    case "preferences": {
      const base = current?.type === "preferences" ? current.preferences : defaultPreferences();
      return { type: "preferences", preferences: applySyncedPreferences(remote.values, base) };
    }
  }
}

function cloneEntity(entity: CloudSyncEntity): CloudSyncEntity {
  return structuredClone(entity);
}

export function mergeRecords(
  modifications: CloudSyncIncomingRecord[],
  deletions: CloudSyncKey[],
  snapshot: CloudSyncSnapshot,
  metadata: CloudSyncMetadata,
  now = Date.now() / 1000,
): CloudSyncMergeResult {
  const local = new Map<string, CloudSyncEntity>();
  for (const item of snapshot.items.values()) local.set(keyId(item.key), cloneEntity(item.entity));
  let preferences = structuredClone(snapshot.preferences);
  const written = new Map<string, CloudSyncEntity>();
  const deleted = new Map<string, CloudSyncKey>();
  const result: CloudSyncMergeResult = { saves: [], deletes: [], keptLocal: [], skipped: [], changesLocalData: false };
  const applied: CloudSyncKey[] = [];

  const write = (entity: CloudSyncEntity) => {
    const key = entityKey(entity);
    const id = keyId(key);
    local.set(id, entity);
    written.set(id, entity);
    deleted.delete(id);
    if (entity.type === "preferences") preferences = entity.preferences;
  };
  const remove = (key: CloudSyncKey) => {
    const id = keyId(key);
    local.delete(id);
    written.delete(id);
    deleted.set(id, key);
  };

  for (const record of modifications) {
    const key = record.key;
    const id = keyId(key);
    const state = metadata.records.get(id)?.state ?? emptyRecordState();
    const wasKnown = isKnownInICloud(state);
    const previousServerFingerprint = state.serverFingerprint;
    let remote: CloudSyncRemoteValue | null = null;
    if (record.schemaVersion <= CloudSyncConfig.schemaVersion && record.payload) {
      try {
        remote = CloudSyncCoding.decode(record.payload, key.type);
      } catch {
        remote = null;
      }
    }
    if (!remote || !sameSyncKey(remoteKey(remote), key)) {
      state.isServerCopyUnreadable = true;
      state.systemFields = record.systemFields;
      metadata.records.set(id, { key, state });
      result.skipped.push(key);
      continue;
    }
    const remoteFingerprint = CloudSyncCoding.fingerprintOfRemote(remote);
    state.isServerCopyUnreadable = false;
    state.systemFields = record.systemFields;
    state.serverFingerprint = remoteFingerprint;

    if (remote.type === "preferences") {
      const localPrefs = syncedPreferences(preferences);
      const merged = mergePreferences(localPrefs, metadata.preferenceChangedAt, remote.values, remote.changedAt);
      if (!sameSynced(merged.values, localPrefs)) write({ type: "preferences", preferences: applySyncedPreferences(merged.values, preferences) });
      metadata.preferenceChangedAt = merged.changedAt;
      metadata.observedPreferences = merged.values;
      state.localFingerprint = CloudSyncCoding.fingerprint({ type: "preferences", preferences });
      const times = Object.values(merged.changedAt);
      state.localChangedAt = times.length ? Math.max(...times) : null;
      metadata.records.set(id, { key, state });
      if (!sameSynced(merged.values, remote.values)) result.keptLocal.push(key);
      continue;
    }

    const current = local.get(id);
    if (!current) {
      if (wasKnown && state.localFingerprint == null && state.localChangedAt != null && state.localChangedAt > record.modifiedAt) {
        metadata.records.set(id, { key, state });
        result.keptLocal.push(key);
        continue;
      }
      const value = localValue(remote, null);
      write(value);
      state.localFingerprint = CloudSyncCoding.fingerprint(value);
      state.localChangedAt = record.modifiedAt;
      metadata.records.set(id, { key, state });
      applied.push(key);
      continue;
    }

    const localFingerprint = CloudSyncCoding.fingerprint(current);
    if (localFingerprint === remoteFingerprint) {
      state.localFingerprint = localFingerprint;
      metadata.records.set(id, { key, state });
      continue;
    }
    if (previousServerFingerprint !== localFingerprint) {
      const localTime = CloudSyncCoding.modifiedAt(current, state.localChangedAt);
      if (localTime > record.modifiedAt) {
        metadata.records.set(id, { key, state });
        result.keptLocal.push(key);
        continue;
      }
    }
    const value = localValue(remote, current);
    write(value);
    state.localFingerprint = CloudSyncCoding.fingerprint(value);
    state.localChangedAt = record.modifiedAt;
    metadata.records.set(id, { key, state });
    applied.push(key);
  }

  for (const key of deletions) {
    const id = keyId(key);
    const existing = metadata.records.get(id)?.state;
    if (key.type === "Preferences") {
      const kept = existing ?? emptyRecordState();
      kept.serverFingerprint = null;
      kept.systemFields = null;
      kept.isServerCopyUnreadable = false;
      metadata.records.set(id, { key, state: kept });
      result.keptLocal.push(key);
      continue;
    }
    const current = local.get(id);
    if (!current) {
      metadata.records.delete(id);
      continue;
    }
    const localFingerprint = CloudSyncCoding.fingerprint(current);
    if (existing && existing.serverFingerprint === localFingerprint) {
      remove(key);
      metadata.records.delete(id);
    } else {
      const kept = existing ?? emptyRecordState();
      kept.serverFingerprint = null;
      kept.systemFields = null;
      kept.isServerCopyUnreadable = false;
      kept.localFingerprint = localFingerprint;
      metadata.records.set(id, { key, state: kept });
      result.keptLocal.push(key);
    }
  }

  normalizePrimaries(applied, local, preferences, write, metadata, now);
  result.saves = [...written.values()].sort((a, b) => compareKeys(entityKey(a), entityKey(b)));
  result.deletes = [...deleted.values()].sort(compareKeys);
  result.changesLocalData = result.saves.length > 0 || result.deletes.length > 0;
  return result;
}

function sameSynced(a: CloudSyncedPreferences, b: CloudSyncedPreferences): boolean {
  return fieldsDiffering(a, b).length === 0;
}

function normalizePrimaries(
  applied: CloudSyncKey[],
  local: Map<string, CloudSyncEntity>,
  _preferences: AppPreferences,
  write: (entity: CloudSyncEntity) => void,
  metadata: CloudSyncMetadata,
  now: number,
): void {
  const rank = (key: CloudSyncKey, entity: CloudSyncEntity): [number, string] => [
    CloudSyncCoding.modifiedAt(entity, metadata.records.get(keyId(key))?.state.localChangedAt ?? null),
    key.recordName,
  ];
  const demote = (key: CloudSyncKey, value: CloudSyncEntity) => {
    write(value);
    const id = keyId(key);
    const state = metadata.records.get(id)?.state ?? emptyRecordState();
    state.localFingerprint = CloudSyncCoding.fingerprint(value);
    state.localChangedAt = now;
    metadata.records.set(id, { key, state });
  };
  const better = (a: [number, string], b: [number, string]) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);

  const terms = new Set<string>();
  let touchesDegree = false;
  for (const key of applied) {
    const entity = local.get(keyId(key));
    if (entity?.type === "schedulePlan") terms.add(entity.plan.termCode);
    else if (entity?.type === "degreePlan") touchesDegree = true;
  }
  for (const term of [...terms].sort()) {
    const primaries = [...local.entries()].filter(([, entity]) => entity.type === "schedulePlan" && entity.plan.termCode === term && entity.plan.isPrimary);
    if (primaries.length <= 1) continue;
    let keep = primaries[0]!;
    for (const entry of primaries.slice(1)) {
      const keepKey = metadataKey(keep[0], keep[1]);
      const entryKey = metadataKey(entry[0], entry[1]);
      if (better(rank(entryKey, entry[1]), rank(keepKey, keep[1]))) keep = entry;
    }
    const keepId = keep[0];
    for (const [id, entity] of primaries) {
      if (id === keepId || entity.type !== "schedulePlan") continue;
      const plan = { ...entity.plan, isPrimary: false };
      demote(metadataKey(id, entity), { type: "schedulePlan", plan });
    }
  }
  if (touchesDegree) {
    const primaries = [...local.entries()].filter(([, entity]) => entity.type === "degreePlan" && entity.plan.isPrimary);
    if (primaries.length > 1) {
      let keep = primaries[0]!;
      for (const entry of primaries.slice(1)) {
        if (better(rank(metadataKey(entry[0], entry[1]), entry[1]), rank(metadataKey(keep[0], keep[1]), keep[1]))) keep = entry;
      }
      for (const [id, entity] of primaries) {
        if (id === keep[0] || entity.type !== "degreePlan") continue;
        const plan = { ...entity.plan, isPrimary: false };
        demote(metadataKey(id, entity), { type: "degreePlan", plan });
      }
    }
  }
}

function metadataKey(id: string, entity: CloudSyncEntity): CloudSyncKey {
  return entityKey(entity).recordName ? entityKey(entity) : { type: "SchedulePlan", recordName: id };
}

export function applyingCloudChanges(data: UserData, saves: CloudSyncEntity[], deletes: CloudSyncKey[]): UserData {
  const next = structuredClone(data);
  if (deletes.length) {
    const removed = new Set(deletes.map(keyId));
    next.plans = next.plans.filter((plan) => !removed.has(keyId(entityKey({ type: "schedulePlan", plan }))));
    next.degreePlans = next.degreePlans.filter((plan) => !removed.has(keyId(entityKey({ type: "degreePlan", plan }))));
    next.watchlist = next.watchlist.filter((item) => !removed.has(keyId(entityKey({ type: "watchItem", item }))));
    next.saved = next.saved.filter((course) => !removed.has(keyId(entityKey({ type: "savedCourse", course }))));
  }
  for (const entity of saves) {
    switch (entity.type) {
      case "schedulePlan": {
        const index = next.plans.findIndex((plan) => plan.id === entity.plan.id);
        if (index >= 0) next.plans[index] = entity.plan;
        else next.plans.push(entity.plan);
        break;
      }
      case "degreePlan": {
        const index = next.degreePlans.findIndex((plan) => plan.id === entity.plan.id);
        if (index >= 0) next.degreePlans[index] = entity.plan;
        else next.degreePlans.push(entity.plan);
        break;
      }
      case "watchItem": {
        const index = next.watchlist.findIndex((item) => watchItemId(item) === watchItemId(entity.item));
        if (index >= 0) next.watchlist[index] = entity.item;
        else {
          const at = next.watchlist.findIndex((item) => item.addedAt < entity.item.addedAt);
          if (at < 0) next.watchlist.push(entity.item);
          else next.watchlist.splice(at, 0, entity.item);
        }
        break;
      }
      case "savedCourse": {
        const index = next.saved.findIndex((course) => savedCourseId(course) === savedCourseId(entity.course));
        if (index >= 0) next.saved[index] = entity.course;
        else {
          const at = next.saved.findIndex((course) => course.savedAt < entity.course.savedAt);
          if (at < 0) next.saved.push(entity.course);
          else next.saved.splice(at, 0, entity.course);
        }
        break;
      }
      case "preferences":
        next.preferences = entity.preferences;
        break;
    }
  }
  return next;
}

function encodeUserValue(data: UserData): unknown {
  return {
    degreePlans: data.degreePlans.map((plan) => degreeJSON(plan)),
    plans: data.plans.map(scheduleJSON),
    preferences: omitNulls({
      autoRefreshSeats: data.preferences.autoRefreshSeats,
      backgroundRefreshEnabled: data.preferences.backgroundRefreshEnabled,
      calendarEndHour: data.preferences.calendarEndHour,
      calendarStartHour: data.preferences.calendarStartHour,
      hasCompletedOnboarding: data.preferences.hasCompletedOnboarding,
      preferredCampus: data.preferences.preferredCampus,
      selectedTermCode: data.preferences.selectedTermCode,
      showWeekends: data.preferences.showWeekends,
    }),
    recents: data.recents,
    saved: data.saved.map(savedJSON),
    searchHistory: data.searchHistory,
    version: data.version,
    watchlist: data.watchlist.map(watchJSON),
  };
}

function decodePreferences(value: unknown): AppPreferences {
  const o = asRecord(value);
  const base = defaultPreferences();
  return {
    selectedTermCode: typeof o.selectedTermCode === "string" ? o.selectedTermCode : null,
    preferredCampus: typeof o.preferredCampus === "string" ? o.preferredCampus : null,
    hasCompletedOnboarding: typeof o.hasCompletedOnboarding === "boolean" ? o.hasCompletedOnboarding : base.hasCompletedOnboarding,
    showWeekends: typeof o.showWeekends === "boolean" ? o.showWeekends : base.showWeekends,
    autoRefreshSeats: typeof o.autoRefreshSeats === "boolean" ? o.autoRefreshSeats : base.autoRefreshSeats,
    backgroundRefreshEnabled: typeof o.backgroundRefreshEnabled === "boolean" ? o.backgroundRefreshEnabled : base.backgroundRefreshEnabled,
    calendarStartHour: typeof o.calendarStartHour === "number" ? o.calendarStartHour : base.calendarStartHour,
    calendarEndHour: typeof o.calendarEndHour === "number" ? o.calendarEndHour : base.calendarEndHour,
  };
}

export const userDataCodec = {
  encode(data: UserData): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(encodeUserValue(data)));
  },
  decode(raw: Uint8Array): UserData {
    const o = asRecord(JSON.parse(new TextDecoder().decode(raw)));
    const data = emptyUserData();
    data.version = typeof o.version === "number" ? o.version : 1;
    data.preferences = decodePreferences(o.preferences);
    data.saved = Array.isArray(o.saved) ? o.saved.flatMap((item) => {
      try {
        return [decodeSaved(item)];
      } catch {
        return [];
      }
    }) : [];
    data.plans = Array.isArray(o.plans) ? o.plans.flatMap((item) => {
      try {
        return [decodeSchedule(item)];
      } catch {
        return [];
      }
    }) : [];
    data.watchlist = Array.isArray(o.watchlist) ? o.watchlist.flatMap((item) => {
      try {
        return [decodeWatch(item)];
      } catch {
        return [];
      }
    }) : [];
    data.searchHistory = Array.isArray(o.searchHistory) ? o.searchHistory.filter((item): item is string => typeof item === "string") : [];
    data.degreePlans = Array.isArray(o.degreePlans) ? o.degreePlans.flatMap((item) => {
      try {
        return [decodeDegree(item)];
      } catch {
        return [];
      }
    }) : [];
    return data;
  },
};

export type UnavailableReason = "noAccount" | "restricted" | "notConfigured" | "temporarilyUnavailable";

export type CloudSyncStatusState =
  | { type: "off" }
  | { type: "unavailable"; reason: UnavailableReason }
  | { type: "syncing" }
  | { type: "upToDate"; lastSync: number | null }
  | { type: "error"; message: string };

function relativeLabel(date: number, now: number): string {
  const then = Math.min(date, now);
  const seconds = now - then;
  if (seconds < 60) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { style: "short", numeric: "always" });
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return format.format(-Math.round(seconds / 3600), "hour");
  return format.format(-Math.round(seconds / 86_400), "day");
}

export function statusSummary(state: CloudSyncStatusState, now = Date.now() / 1000): string {
  switch (state.type) {
    case "off":
      return "Off";
    case "unavailable":
      switch (state.reason) {
        case "noAccount":
          return "Sign in to iCloud in Settings to sync";
        case "restricted":
          return "iCloud is restricted on this device";
        case "notConfigured":
          return "iCloud sync isn't set up in this build";
        case "temporarilyUnavailable":
          return "Check your Apple Account in Settings to sync";
      }
    case "syncing":
      return "Syncing\u2026";
    case "upToDate":
      return state.lastSync == null ? "Up to date" : `Up to date \u00b7 ${relativeLabel(state.lastSync, now)}`;
    case "error":
      return state.message;
  }
}

export const CloudSyncEntitlements = {
  servicesKey: "com.apple.developer.icloud-services",
  containersKey: "com.apple.developer.icloud-container-identifiers",
  grantsCloudKit(entitlements: Record<string, unknown>, containerIdentifier: string): boolean {
    const raw = entitlements[CloudSyncEntitlements.servicesKey];
    const services = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : typeof raw === "string" ? [raw] : [];
    if (!services.includes("CloudKit") && !services.includes("*")) return false;
    const containers = entitlements[CloudSyncEntitlements.containersKey];
    return Array.isArray(containers) && containers.includes(containerIdentifier);
  },
  codeSignatureEntitlements(data: Uint8Array): Record<string, unknown> | null {
    const slice = machOSlice(data);
    if (!slice) return null;
    const signature = codeSignatureRange(data, slice);
    if (!signature) return null;
    return entitlementsInSuperBlob(data, signature);
  },
};

const FAT_MAGIC = 0xcafe_babe;
const FAT_MAGIC_64 = 0xcafe_babf;
const MACHO_MAGIC_64 = 0xfeed_facf;
const LC_CODE_SIGNATURE = 0x1d;
const SUPER_BLOB = 0xfa_de_0c_c0;
const ENTITLEMENTS_BLOB = 0xfa_de_71_71;
const ENTITLEMENTS_SLOT = 5;
const CPU_ARM64 = 0x0100_000c;
const CPU_X86_64 = 0x0100_0007;

function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u32(data: Uint8Array, offset: number, big: boolean): number | null {
  if (offset < 0 || offset > data.length - 4) return null;
  return viewOf(data).getUint32(offset, !big);
}

function u64(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > data.length - 8) return null;
  const view = viewOf(data);
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 2 ** 32 + lo;
}

function machOSlice(data: Uint8Array): [number, number] | null {
  const magic = u32(data, 0, true);
  if (magic == null) return null;
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    const is64 = magic === FAT_MAGIC_64;
    const count = u32(data, 4, true);
    if (count == null || count >= 64) return null;
    for (let index = 0; index < count; index++) {
      const entry = 8 + index * (is64 ? 32 : 20);
      const type = u32(data, entry, true);
      if (type == null) return null;
      if (type !== CPU_ARM64 && type !== CPU_X86_64) continue;
      const offset = is64 ? u64(data, entry + 8) : u32(data, entry + 8, true);
      const size = is64 ? u64(data, entry + 16) : u32(data, entry + 12, true);
      if (offset == null || size == null || size <= 0 || offset > data.length - size) return null;
      return [offset, offset + size];
    }
    return null;
  }
  if (u32(data, 0, false) !== MACHO_MAGIC_64) return null;
  return [0, data.length];
}

function codeSignatureRange(data: Uint8Array, slice: [number, number]): [number, number] | null {
  const base = slice[0];
  if (u32(data, base, false) !== MACHO_MAGIC_64) return null;
  const commandCount = u32(data, base + 16, false);
  if (commandCount == null) return null;
  let cursor = base + 32;
  for (let i = 0; i < Math.min(commandCount, 4096); i++) {
    const command = u32(data, cursor, false);
    const size = u32(data, cursor + 4, false);
    if (command == null || size == null || size < 8) return null;
    if (command === LC_CODE_SIGNATURE) {
      const offset = u32(data, cursor + 8, false);
      const length = u32(data, cursor + 12, false);
      if (offset == null || length == null) return null;
      const start = base + offset;
      const end = start + length;
      if (!(start < end && end <= slice[1])) return null;
      return [start, end];
    }
    cursor += size;
    if (cursor >= slice[1]) return null;
  }
  return null;
}

function entitlementsInSuperBlob(data: Uint8Array, range: [number, number]): Record<string, unknown> | null {
  const base = range[0];
  if (u32(data, base, true) !== SUPER_BLOB) return null;
  const count = u32(data, base + 8, true);
  if (count == null || count >= 64) return null;
  for (let index = 0; index < count; index++) {
    const entry = base + 12 + index * 8;
    if (entry + 8 > range[1]) return null;
    const type = u32(data, entry, true);
    const offset = u32(data, entry + 4, true);
    if (type == null || offset == null) return null;
    if (type !== ENTITLEMENTS_SLOT) continue;
    const blob = base + offset;
    if (u32(data, blob, true) !== ENTITLEMENTS_BLOB) return null;
    const length = u32(data, blob + 4, true);
    if (length == null || length < 8 || blob + length > range[1]) return null;
    const plist = new TextDecoder().decode(data.subarray(blob + 8, blob + length));
    return parsePlist(plist);
  }
  return {};
}

function parsePlist(xml: string): Record<string, unknown> | null {
  const start = xml.indexOf("<plist");
  if (start < 0) return null;
  const open = xml.indexOf(">", start);
  if (open < 0) return null;
  const value = readPlistValue(xml, open + 1);
  if (!value || value.kind !== "dict") return null;
  return value.value;
}

type PlistValue =
  | { kind: "dict"; value: Record<string, unknown>; end: number }
  | { kind: "array"; value: unknown[]; end: number }
  | { kind: "string"; value: string; end: number }
  | { kind: "bool"; value: boolean; end: number }
  | { kind: "number"; value: number; end: number };

function readPlistValue(xml: string, index: number): PlistValue | null {
  const i = skipSpace(xml, index);
  if (xml.startsWith("<dict", i)) return readDict(xml, i);
  if (xml.startsWith("<array", i)) return readArray(xml, i);
  if (xml.startsWith("<string", i)) return readTaggedString(xml, i, "string");
  if (xml.startsWith("<key", i)) return readTaggedString(xml, i, "key");
  if (xml.startsWith("<integer", i)) {
    const text = readTaggedString(xml, i, "integer");
    return text ? { kind: "number", value: Number(text.value), end: text.end } : null;
  }
  if (xml.startsWith("<true", i)) return { kind: "bool", value: true, end: xml.indexOf(">", i) + 1 };
  if (xml.startsWith("<false", i)) return { kind: "bool", value: false, end: xml.indexOf(">", i) + 1 };
  return null;
}

function skipSpace(xml: string, index: number): number {
  let i = index;
  while (i < xml.length && /\s/.test(xml[i]!)) i++;
  return i;
}

function readTaggedString(xml: string, index: number, tag: string): { kind: "string"; value: string; end: number } | null {
  const open = xml.indexOf(">", index);
  if (open < 0) return null;
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  return { kind: "string", value: decodeXml(xml.slice(open + 1, close)), end: close + tag.length + 3 };
}

function readDict(xml: string, index: number): PlistValue | null {
  const open = xml.indexOf(">", index);
  if (open < 0) return null;
  let i = open + 1;
  const value: Record<string, unknown> = {};
  while (i < xml.length) {
    i = skipSpace(xml, i);
    if (xml.startsWith("</dict>", i)) return { kind: "dict", value, end: i + 7 };
    if (!xml.startsWith("<key", i)) return null;
    const key = readTaggedString(xml, i, "key");
    if (!key) return null;
    const child = readPlistValue(xml, key.end);
    if (!child) return null;
    value[key.value] = child.kind === "dict" || child.kind === "array" ? child.value : child.value;
    i = child.end;
  }
  return null;
}

function readArray(xml: string, index: number): PlistValue | null {
  const open = xml.indexOf(">", index);
  if (open < 0) return null;
  let i = open + 1;
  const value: unknown[] = [];
  while (i < xml.length) {
    i = skipSpace(xml, i);
    if (xml.startsWith("</array>", i)) return { kind: "array", value, end: i + 8 };
    const child = readPlistValue(xml, i);
    if (!child) return null;
    value.push(child.value);
    i = child.end;
  }
  return null;
}

function decodeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
