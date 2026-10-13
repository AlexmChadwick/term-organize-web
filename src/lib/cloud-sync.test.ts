import { describe, expect, it } from "vitest";
import {
  CloudSyncCoding,
  CloudSyncConfig,
  CloudSyncEntitlements,
  applyingCloudChanges,
  cloneMetadata,
  courseKey,
  decodeMetadata,
  defaultPreferences,
  distantPast,
  emptyMetadata,
  emptyUserData,
  encodeMetadata,
  entityKey,
  forgetICloud,
  hasDataInICloud,
  keyId,
  localValue,
  makeDegreeCourse,
  makeDegreePlan,
  makeSchedulePlan,
  mergePreferences,
  mergeRecords,
  metadataEqual,
  observeLocalData,
  pendingChanges,
  preferencesKey,
  recordDeletedFromICloud,
  recordNameForID,
  recordSaved,
  snapshotOf,
  statusSummary,
  syncedForm,
  syncedPreferences,
  userDataCodec,
  type CloudSyncEntity,
  type CloudSyncIncomingRecord,
  type CloudSyncKey,
  type CloudSyncMetadata,
  type CloudSyncRecordState,
  type DegreePlan,
  type SavedCourse,
  type SchedulePlan,
  type UserData,
  type WatchItem,
} from "./cloud-sync";

const date = 1_790_000_000;
const container = "iCloud.com.alexchadwick.neuclasssearch";
const cs3000 = courseKey("CS", "3000");
const cs3500 = courseKey("CS", "3500");

function plan(name = "My Schedule", id = crypto.randomUUID(), termCode = "202710", isPrimary = false, updatedAt = date): SchedulePlan {
  return makeSchedulePlan({
    id,
    name,
    termCode,
    isPrimary,
    createdAt: date,
    updatedAt,
    courses: [{ key: cs3000, isRequired: true, excludedCRNs: ["10001", "10002", "10003"], colorIndex: 0 }],
    selectedCRNs: ["10004"],
  });
}

function degreePlan(id = crypto.randomUUID(), updatedAt = date): DegreePlan {
  const value = makeDegreePlan({ id, name: "BSCS", createdAt: date, updatedAt });
  value.program = "CS-B-CSCI-BSCS";
  value.studentName = "SAMPLE STUDENT";
  value.studentID = "000000000";
  value.completed = [makeDegreeCourse(cs3000, "Algorithms and Data", 4)];
  value.terms = [{ id: crypto.randomUUID(), season: "spring", year: 2027, courses: [makeDegreeCourse(cs3500, "OOD", 4)] }];
  value.isPrimary = true;
  return value;
}

function watchItem(crn = "12345", addedAt = date): WatchItem {
  return {
    termCode: "202710",
    crn,
    courseKey: cs3000,
    courseTitle: "Algorithms and Data",
    sectionLabel: "Lecture · Section 01",
    addedAt,
    lastSeatsRemaining: 0,
    lastWaitlistRemaining: 2,
    seatCapacity: 40,
    lastCheckedAt: date,
    notifyOnWaitlist: false,
    lastNotifiedAt: null,
  };
}

function saved(key = cs3000, savedAt = date): SavedCourse {
  return { termCode: "202710", key, savedAt };
}

function syncedMetadata(data: UserData): CloudSyncMetadata {
  const metadata = emptyMetadata();
  const snapshot = snapshotOf(data);
  observeLocalData(metadata, snapshot, date);
  for (const item of snapshot.items.values()) recordSaved(metadata, item.key, item.fingerprint, new Uint8Array([1]));
  return metadata;
}

function incoming(
  entity: CloudSyncEntity,
  modifiedAt: number,
  schemaVersion = CloudSyncConfig.schemaVersion,
  preferenceChangedAt: Record<string, number> = {},
): CloudSyncIncomingRecord {
  return {
    key: entityKey(entity),
    schemaVersion,
    modifiedAt,
    payload: CloudSyncCoding.payload(entity, preferenceChangedAt),
    systemFields: new Uint8Array([2]),
  };
}

function ids(keys: CloudSyncKey[]): string[] {
  return keys.map((key) => keyId(key)).sort();
}

function sortedExcluded(planValue: SchedulePlan): SchedulePlan {
  const copy = structuredClone(planValue);
  for (const course of copy.courses) course.excludedCRNs = [...course.excludedCRNs].sort();
  return copy;
}

describe("cloud sync", () => {
  it("payloadsRoundTrip", () => {
    const preferences = defaultPreferences();
    preferences.preferredCampus = "Boston";
    preferences.calendarStartHour = 9;
    const schedule = plan();
    const degree = degreePlan();
    const watch = watchItem();
    const course = saved();
    const changedAt = { preferredCampus: date };

    expect(CloudSyncCoding.decode(CloudSyncCoding.payload({ type: "schedulePlan", plan: schedule }), "SchedulePlan")).toEqual({
      type: "schedulePlan",
      plan: schedule,
    });
    expect(CloudSyncCoding.decode(CloudSyncCoding.payload({ type: "degreePlan", plan: degree }), "DegreePlan")).toEqual({
      type: "degreePlan",
      plan: syncedForm(degree),
    });
    expect(CloudSyncCoding.decode(CloudSyncCoding.payload({ type: "watchItem", item: watch }), "WatchItem")).toEqual({ type: "watchItem", item: watch });
    expect(CloudSyncCoding.decode(CloudSyncCoding.payload({ type: "savedCourse", course }), "SavedCourse")).toEqual({ type: "savedCourse", course });
    const preferencesPayload = CloudSyncCoding.payload({ type: "preferences", preferences }, changedAt);
    expect(CloudSyncCoding.decode(preferencesPayload, "Preferences")).toEqual({
      type: "preferences",
      values: syncedPreferences(preferences),
      changedAt,
    });
  });

  it("payloadsFromNewerVersionsWithExtraFieldsStillDecode", () => {
    const watch = watchItem();
    const json = JSON.parse(new TextDecoder().decode(CloudSyncCoding.payload({ type: "watchItem", item: watch }))) as Record<string, unknown>;
    json.fieldFromTheFuture = { nested: true };
    const payload = new TextEncoder().encode(JSON.stringify(json));
    expect(CloudSyncCoding.decode(payload, "WatchItem")).toEqual({ type: "watchItem", item: watch });
  });

  it("recordKeysUseStableIDs", () => {
    const schedule = plan();
    expect(entityKey({ type: "schedulePlan", plan: schedule })).toEqual({ type: "SchedulePlan", recordName: schedule.id });
    expect(entityKey({ type: "savedCourse", course: saved() }).recordName).toBe("202710|CS 3000");
    expect(entityKey({ type: "watchItem", item: watchItem() }).recordName).toBe("202710|12345");
    expect(entityKey({ type: "preferences", preferences: defaultPreferences() })).toEqual(preferencesKey);
    for (const unusable of ["", "_private", "Café", "x".repeat(256), "tab\there"]) {
      const name = recordNameForID(unusable);
      expect(name.startsWith("sha256-")).toBe(true);
      expect(name.length).toBeLessThanOrEqual(255);
      expect(name).toBe(recordNameForID(unusable));
    }
    expect(recordNameForID("a")).not.toBe(recordNameForID("_a"));
  });

  it("containerIdentifierComesFromInfoPlist", () => {
    expect(CloudSyncConfig.containerIdentifier(container)).toBe(container);
    expect(CloudSyncConfig.containerIdentifier(` ${container}\n`)).toBe(container);
    expect(CloudSyncConfig.containerIdentifier(null)).toBeNull();
    expect(CloudSyncConfig.containerIdentifier("")).toBeNull();
    expect(CloudSyncConfig.containerIdentifier("iCloud.")).toBeNull();
    expect(CloudSyncConfig.containerIdentifier("com.example.app")).toBeNull();
    expect(CloudSyncConfig.containerIdentifier("$(CLOUDKIT_CONTAINER)")).toBeNull();
    expect(CloudSyncConfig.containerIdentifier(42)).toBeNull();
  });

  it("devicePreferencesAreNotSynced", () => {
    const preferences = defaultPreferences();
    preferences.selectedTermCode = "202730";
    preferences.hasCompletedOnboarding = true;
    preferences.autoRefreshSeats = false;
    preferences.backgroundRefreshEnabled = false;
    preferences.preferredCampus = "Boston";
    const payload = CloudSyncCoding.payload({ type: "preferences", preferences });
    const json = JSON.parse(new TextDecoder().decode(payload)) as { values: Record<string, unknown> };
    expect(new Set(Object.keys(json.values))).toEqual(new Set(["preferredCampus", "showWeekends", "calendarStartHour", "calendarEndHour"]));
    const text = new TextDecoder().decode(payload);
    for (const deviceOnly of ["selectedTermCode", "hasCompletedOnboarding", "autoRefreshSeats", "backgroundRefreshEnabled", "202730"]) {
      expect(text.includes(deviceOnly)).toBe(false);
    }
    const other = { ...preferences, selectedTermCode: "202710", hasCompletedOnboarding: false, autoRefreshSeats: true, backgroundRefreshEnabled: true };
    expect(CloudSyncCoding.fingerprint({ type: "preferences", preferences: other })).toBe(CloudSyncCoding.fingerprint({ type: "preferences", preferences }));
    const remote = syncedPreferences(defaultPreferences());
    remote.preferredCampus = "Oakland";
    remote.showWeekends = true;
    const applied = { ...preferences, ...remote };
    expect(applied.preferredCampus).toBe("Oakland");
    expect(applied.showWeekends).toBe(true);
    expect(applied.selectedTermCode).toBe("202730");
    expect(applied.hasCompletedOnboarding).toBe(true);
    expect(applied.autoRefreshSeats).toBe(false);
    expect(applied.backgroundRefreshEnabled).toBe(false);
  });

  it("remotePreferencesMergeKeepsDeviceOnlyFields", () => {
    const data = emptyUserData();
    data.preferences.selectedTermCode = "202730";
    data.preferences.hasCompletedOnboarding = true;
    data.preferences.backgroundRefreshEnabled = false;
    const metadata = syncedMetadata(data);
    const remote = defaultPreferences();
    remote.preferredCampus = "Oakland";
    const result = mergeRecords([incoming({ type: "preferences", preferences: remote }, date + 60, CloudSyncConfig.schemaVersion, { preferredCampus: date + 60 })], [], snapshotOf(data), metadata);
    expect(result.saves[0]?.type).toBe("preferences");
    if (result.saves[0]?.type !== "preferences") return;
    expect(result.saves[0].preferences.preferredCampus).toBe("Oakland");
    expect(result.saves[0].preferences.selectedTermCode).toBe("202730");
    expect(result.saves[0].preferences.hasCompletedOnboarding).toBe(true);
    expect(result.saves[0].preferences.backgroundRefreshEnabled).toBe(false);
  });

  it("degreePlanStudentDetailsStayOnDevice", () => {
    const value = degreePlan();
    const text = new TextDecoder().decode(CloudSyncCoding.payload({ type: "degreePlan", plan: value }));
    expect(text.includes("SAMPLE STUDENT")).toBe(false);
    expect(text.includes("000000000")).toBe(false);
    expect(text.includes("studentName")).toBe(false);
    const withoutStudent = { ...value, studentName: null, studentID: null };
    expect(CloudSyncCoding.fingerprint({ type: "degreePlan", plan: withoutStudent })).toBe(CloudSyncCoding.fingerprint({ type: "degreePlan", plan: value }));
    const remote = syncedForm(value);
    remote.name = "BSCS (updated)";
    const merged = localValue({ type: "degreePlan", plan: remote }, { type: "degreePlan", plan: value });
    expect(merged.type).toBe("degreePlan");
    if (merged.type !== "degreePlan") return;
    expect(merged.plan.name).toBe("BSCS (updated)");
    expect(merged.plan.studentName).toBe("SAMPLE STUDENT");
    expect(merged.plan.studentID).toBe("000000000");
  });

  it("watchItemSeatChecksAreDeviceOnly", () => {
    const item = watchItem();
    const checked = { ...item, lastSeatsRemaining: 3, lastWaitlistRemaining: 0, seatCapacity: 45, lastCheckedAt: date + 600, lastNotifiedAt: date + 600 };
    expect(CloudSyncCoding.fingerprint({ type: "watchItem", item: checked })).toBe(CloudSyncCoding.fingerprint({ type: "watchItem", item }));
    const intent = { ...item, notifyOnWaitlist: true };
    expect(CloudSyncCoding.fingerprint({ type: "watchItem", item: intent })).not.toBe(CloudSyncCoding.fingerprint({ type: "watchItem", item }));
    const remote = { ...item, notifyOnWaitlist: true, lastSeatsRemaining: 0, lastCheckedAt: date - 600 };
    const merged = localValue({ type: "watchItem", item: remote }, { type: "watchItem", item: checked });
    expect(merged.type).toBe("watchItem");
    if (merged.type !== "watchItem") return;
    expect(merged.item.notifyOnWaitlist).toBe(true);
    expect(merged.item.lastSeatsRemaining).toBe(3);
    expect(merged.item.seatCapacity).toBe(45);
    expect(merged.item.lastCheckedAt).toBe(date + 600);
    expect(merged.item.lastNotifiedAt).toBe(date + 600);
  });

  it("fingerprintsIgnoreSetOrder", () => {
    const first = plan();
    const second = structuredClone(first);
    first.courses[0]!.excludedCRNs = [];
    second.courses[0]!.excludedCRNs = [];
    for (let n = 1; n <= 40; n++) first.courses[0]!.excludedCRNs.push(String(20_000 + n));
    for (let n = 40; n >= 1; n--) second.courses[0]!.excludedCRNs.push(String(20_000 + n));
    expect(sortedExcluded(first)).toEqual(sortedExcluded(second));
    expect(CloudSyncCoding.payload({ type: "schedulePlan", plan: first })).toEqual(CloudSyncCoding.payload({ type: "schedulePlan", plan: second }));
    expect(CloudSyncCoding.fingerprint({ type: "schedulePlan", plan: first })).toBe(CloudSyncCoding.fingerprint({ type: "schedulePlan", plan: second }));
    const json = JSON.parse(new TextDecoder().decode(CloudSyncCoding.payload({ type: "schedulePlan", plan: first }))) as {
      courses: { excludedCRNs: string[] }[];
    };
    const excluded = json.courses[0]!.excludedCRNs;
    expect(excluded).toHaveLength(40);
    expect(excluded).toEqual([...excluded].sort());
  });

  it("fingerprintsSurviveTheLocalFile", () => {
    const data = emptyUserData();
    data.plans = [plan("My Schedule", crypto.randomUUID(), "202710", false, date + 0.75)];
    data.saved = [saved(cs3000, date + 0.25)];
    data.watchlist = [watchItem("12345", date + 0.5)];
    const reloaded = userDataCodec.decode(userDataCodec.encode(data));
    const before = snapshotOf(data);
    const after = snapshotOf(reloaded);
    expect(ids([...before.items.values()].map((item) => item.key))).toEqual(ids([...after.items.values()].map((item) => item.key)));
    for (const item of before.items.values()) expect(after.get(item.key)?.fingerprint).toBe(item.fingerprint);
  });

  it("diffFindsAddsChangesAndDeletes", () => {
    const schedule = plan();
    const watch = watchItem();
    const course = saved();
    const data = emptyUserData();
    data.plans = [schedule];
    data.watchlist = [watch];
    data.saved = [course];
    const metadata = syncedMetadata(data);
    expect(pendingChanges(metadata, snapshotOf(data)).isEmpty).toBe(true);
    const added = plan("Plan B");
    data.plans.push(added);
    data.watchlist[0]!.notifyOnWaitlist = true;
    data.watchlist[0]!.lastSeatsRemaining = 7;
    data.saved = [];
    const snapshot = snapshotOf(data);
    observeLocalData(metadata, snapshot, date + 10);
    const changes = pendingChanges(metadata, snapshot);
    expect(ids(changes.saves)).toEqual(ids([entityKey({ type: "schedulePlan", plan: added }), entityKey({ type: "watchItem", item: watch })]));
    expect(changes.deletes).toEqual([entityKey({ type: "savedCourse", course })]);
    for (const key of changes.saves) recordSaved(metadata, key, snapshot.get(key)?.fingerprint ?? null, new Uint8Array([3]));
    for (const key of changes.deletes) recordDeletedFromICloud(metadata, key);
    expect(pendingChanges(metadata, snapshot).isEmpty).toBe(true);
    expect(metadata.records.get(keyId(entityKey({ type: "savedCourse", course })))).toBeUndefined();
  });

  it("freshDeviceUploadsEverything", () => {
    const data = emptyUserData();
    data.plans = [plan()];
    data.saved = [saved()];
    const metadata = emptyMetadata();
    const snapshot = snapshotOf(data);
    observeLocalData(metadata, snapshot, date);
    const changes = pendingChanges(metadata, snapshot);
    expect(ids(changes.saves)).toEqual(ids([...snapshot.items.values()].map((item) => item.key)));
    expect(changes.deletes).toEqual([]);
    expect(changes.saves).toContainEqual(preferencesKey);
  });

  it("journalDatesLocalChanges", () => {
    const data = emptyUserData();
    data.plans = [plan("My Schedule", crypto.randomUUID(), "202710", false)];
    const planKey = entityKey({ type: "schedulePlan", plan: data.plans[0]! });
    const metadata = emptyMetadata();
    observeLocalData(metadata, snapshotOf(data), date);
    expect(metadata.records.get(keyId(planKey))?.state.localChangedAt).toBeNull();
    expect(metadata.preferenceChangedAt).toEqual({});
    data.plans[0]!.isPrimary = true;
    data.preferences.showWeekends = true;
    observeLocalData(metadata, snapshotOf(data), date + 300);
    expect(metadata.records.get(keyId(planKey))?.state.localChangedAt).toBe(date + 300);
    expect(metadata.preferenceChangedAt).toEqual({ showWeekends: date + 300 });
    expect(CloudSyncCoding.modifiedAt({ type: "schedulePlan", plan: data.plans[0]! }, date + 300)).toBe(date + 300);
    expect(CloudSyncCoding.modifiedAt({ type: "preferences", preferences: data.preferences }, null, metadata.preferenceChangedAt)).toBe(date + 300);
    data.plans = [];
    observeLocalData(metadata, snapshotOf(data), date + 600);
    expect(metadata.records.get(keyId(planKey))).toBeUndefined();
  });

  it("modifiedAtRules", () => {
    const value = plan("My Schedule", crypto.randomUUID(), "202710", false, date + 100);
    expect(CloudSyncCoding.modifiedAt({ type: "schedulePlan", plan: value }, null)).toBe(date + 100);
    expect(CloudSyncCoding.modifiedAt({ type: "schedulePlan", plan: value }, date + 50)).toBe(date + 100);
    expect(CloudSyncCoding.modifiedAt({ type: "watchItem", item: watchItem() }, null)).toBe(date);
    expect(CloudSyncCoding.modifiedAt({ type: "savedCourse", course: saved() }, date + 9)).toBe(date + 9);
    expect(CloudSyncCoding.modifiedAt({ type: "preferences", preferences: defaultPreferences() }, null)).toBe(distantPast);
  });

  it("turningSyncOffForgetsICloudButNotLocalHistory", () => {
    const data = emptyUserData();
    data.plans = [plan()];
    data.saved = [saved()];
    const metadata = syncedMetadata(data);
    data.saved = [];
    observeLocalData(metadata, snapshotOf(data), date + 5);
    metadata.isZoneSaved = true;
    metadata.lastSyncDate = date;
    forgetICloud(metadata);
    expect(hasDataInICloud(metadata)).toBe(false);
    expect(metadata.isZoneSaved).toBe(false);
    expect(metadata.lastSyncDate).toBeNull();
    const planState = metadata.records.get(keyId(entityKey({ type: "schedulePlan", plan: data.plans[0]! })))?.state;
    expect(planState).toBeTruthy();
    expect(planState?.localFingerprint).not.toBeNull();
    expect(planState?.systemFields).toBeNull();
    expect(pendingChanges(metadata, snapshotOf(data)).deletes).toEqual([]);
  });

  it("metadataRoundTrips", () => {
    const data = emptyUserData();
    data.plans = [plan()];
    data.preferences.preferredCampus = "Boston";
    const metadata = syncedMetadata(data);
    metadata.accountRecordName = "_user";
    metadata.preferenceChangedAt = { preferredCampus: date };
    const watchKey: CloudSyncKey = { type: "WatchItem", recordName: "202710|1" };
    const state: CloudSyncRecordState = {
      localFingerprint: null,
      localChangedAt: null,
      serverFingerprint: null,
      systemFields: null,
      isServerCopyUnreadable: true,
    };
    metadata.records.set(keyId(watchKey), { key: watchKey, state });
    expect(metadataEqual(decodeMetadata(encodeMetadata(metadata)), metadata)).toBe(true);
  });

  it("remoteChangesApplyWithoutEcho", () => {
    const original = plan();
    let data = emptyUserData();
    data.plans = [original];
    const metadata = syncedMetadata(data);
    const remote = structuredClone(original);
    remote.name = "Renamed elsewhere";
    remote.updatedAt = date + 60;
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: remote }, date + 60)], [], snapshotOf(data), metadata, date + 120);
    expect(result.saves).toEqual([{ type: "schedulePlan", plan: remote }]);
    expect(result.keptLocal).toEqual([]);
    const key = entityKey({ type: "schedulePlan", plan: remote });
    expect(Array.from(metadata.records.get(keyId(key))?.state.systemFields ?? [])).toEqual([2]);
    expect(metadata.records.get(keyId(key))?.state.localChangedAt).toBe(date + 60);
    data = applyingCloudChanges(data, result.saves, result.deletes);
    expect(data.plans.map((item) => item.name)).toEqual(["Renamed elsewhere"]);
    const after = snapshotOf(data);
    observeLocalData(metadata, after, date + 180);
    expect(pendingChanges(metadata, after).isEmpty).toBe(true);
    expect(metadata.records.get(keyId(key))?.state.localChangedAt).toBe(date + 60);
  });

  it("identicalRemoteCopyChangesNothing", () => {
    const value = plan();
    const data = emptyUserData();
    data.plans = [value];
    const metadata = emptyMetadata();
    observeLocalData(metadata, snapshotOf(data), date);
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: value }, date)], [], snapshotOf(data), metadata);
    expect(result.changesLocalData).toBe(false);
    expect(pendingChanges(metadata, snapshotOf(data)).saves.some((key) => key.recordName === value.id && key.type === "SchedulePlan")).toBe(false);
  });

  it("newerLocalChangeWinsConflict", () => {
    const original = plan();
    const data = emptyUserData();
    data.plans = [original];
    const metadata = syncedMetadata(data);
    data.plans[0]!.name = "Edited here";
    data.plans[0]!.updatedAt = date + 100;
    observeLocalData(metadata, snapshotOf(data), date + 100);
    const remote = structuredClone(original);
    remote.name = "Edited elsewhere";
    remote.updatedAt = date + 50;
    const key = entityKey({ type: "schedulePlan", plan: original });
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: remote }, date + 50)], [], snapshotOf(data), metadata);
    expect(result.saves).toEqual([]);
    expect(result.keptLocal).toEqual([key]);
    expect(Array.from(metadata.records.get(keyId(key))?.state.systemFields ?? [])).toEqual([2]);
    expect(pendingChanges(metadata, snapshotOf(data)).saves).toEqual([key]);
  });

  it("newerRemoteChangeWinsConflict", () => {
    const original = plan();
    const data = emptyUserData();
    data.plans = [original];
    const metadata = syncedMetadata(data);
    data.plans[0]!.name = "Edited here";
    data.plans[0]!.updatedAt = date + 50;
    observeLocalData(metadata, snapshotOf(data), date + 50);
    const remote = structuredClone(original);
    remote.name = "Edited elsewhere";
    remote.updatedAt = date + 100;
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: remote }, date + 100)], [], snapshotOf(data), metadata);
    expect(result.saves).toEqual([{ type: "schedulePlan", plan: remote }]);
    expect(result.keptLocal).toEqual([]);
  });

  it("tiesGoToICloud", () => {
    const original = plan();
    const data = emptyUserData();
    data.plans = [original];
    const metadata = syncedMetadata(data);
    data.plans[0]!.name = "Edited here";
    data.plans[0]!.updatedAt = date + 50;
    observeLocalData(metadata, snapshotOf(data), date + 50);
    const remote = structuredClone(original);
    remote.name = "Edited elsewhere";
    remote.updatedAt = date + 50;
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: remote }, date + 50)], [], snapshotOf(data), metadata);
    expect(result.saves).toEqual([{ type: "schedulePlan", plan: remote }]);
  });

  it("remoteDeletionRemovesUnchangedValues", () => {
    const course = saved();
    let data = emptyUserData();
    data.saved = [course];
    const metadata = syncedMetadata(data);
    const key = entityKey({ type: "savedCourse", course });
    const result = mergeRecords([], [key], snapshotOf(data), metadata);
    expect(result.deletes).toEqual([key]);
    expect(metadata.records.get(keyId(key))).toBeUndefined();
    data = applyingCloudChanges(data, result.saves, result.deletes);
    expect(data.saved).toEqual([]);
    expect(pendingChanges(metadata, snapshotOf(data)).isEmpty).toBe(true);
  });

  it("remoteDeletionKeepsLocallyEditedValues", () => {
    const item = watchItem();
    const data = emptyUserData();
    data.watchlist = [item];
    const metadata = syncedMetadata(data);
    data.watchlist[0]!.notifyOnWaitlist = true;
    observeLocalData(metadata, snapshotOf(data), date + 30);
    const key = entityKey({ type: "watchItem", item });
    const result = mergeRecords([], [key], snapshotOf(data), metadata);
    expect(result.deletes).toEqual([]);
    expect(result.keptLocal).toEqual([key]);
    expect(metadata.records.get(keyId(key))?.state.systemFields).toBeNull();
    expect(pendingChanges(metadata, snapshotOf(data)).saves).toEqual([key]);
  });

  it("localDeletionNewerThanRemoteEditStands", () => {
    const original = plan();
    const data = emptyUserData();
    data.plans = [original];
    const metadata = syncedMetadata(data);
    data.plans = [];
    observeLocalData(metadata, snapshotOf(data), date + 100);
    const key = entityKey({ type: "schedulePlan", plan: original });
    const olderEdit = structuredClone(original);
    olderEdit.name = "Edited elsewhere, earlier";
    const newerEdit = structuredClone(original);
    newerEdit.name = "Edited elsewhere, later";
    newerEdit.updatedAt = date + 200;
    const keepDeleted = cloneMetadata(metadata);
    const stands = mergeRecords([incoming({ type: "schedulePlan", plan: olderEdit }, date + 50)], [], snapshotOf(data), keepDeleted);
    expect(stands.saves).toEqual([]);
    expect(pendingChanges(keepDeleted, snapshotOf(data)).deletes).toEqual([key]);
    const resurrected = mergeRecords([incoming({ type: "schedulePlan", plan: newerEdit }, date + 200)], [], snapshotOf(data), metadata);
    expect(resurrected.saves).toEqual([{ type: "schedulePlan", plan: newerEdit }]);
  });

  it("recordsFromNewerVersionsAreLeftAlone", () => {
    const value = plan();
    const data = emptyUserData();
    data.plans = [value];
    const metadata = syncedMetadata(data);
    const key = entityKey({ type: "schedulePlan", plan: value });
    const newer = structuredClone(value);
    newer.name = "Written by version 2";
    const record = incoming({ type: "schedulePlan", plan: newer }, date + 60, CloudSyncConfig.schemaVersion + 1);
    record.systemFields = new Uint8Array([9]);
    const result = mergeRecords([record], [], snapshotOf(data), metadata);
    expect(result.skipped).toEqual([key]);
    expect(result.changesLocalData).toBe(false);
    expect(metadata.records.get(keyId(key))?.state.isServerCopyUnreadable).toBe(true);
    data.plans[0]!.name = "Edited here";
    observeLocalData(metadata, snapshotOf(data), date + 120);
    expect(pendingChanges(metadata, snapshotOf(data)).isEmpty).toBe(true);
    data.plans = [];
    observeLocalData(metadata, snapshotOf(data), date + 180);
    expect(pendingChanges(metadata, snapshotOf(data)).isEmpty).toBe(true);
  });

  it("unreadablePayloadsAreSkippedNotDeleted", () => {
    const value = plan();
    const data = emptyUserData();
    data.plans = [value];
    const metadata = syncedMetadata(data);
    const key = entityKey({ type: "schedulePlan", plan: value });
    const garbage: CloudSyncIncomingRecord = { key, schemaVersion: 1, modifiedAt: date + 60, payload: new TextEncoder().encode("{ not json"), systemFields: null };
    const empty: CloudSyncIncomingRecord = {
      key: { type: "SavedCourse", recordName: "202710|CS 9999" },
      schemaVersion: 1,
      modifiedAt: date,
      payload: null,
      systemFields: null,
    };
    const mismatched = incoming({ type: "schedulePlan", plan: plan("Other") }, date + 60);
    mismatched.key = { type: "SchedulePlan", recordName: crypto.randomUUID() };
    const result = mergeRecords([garbage, empty, mismatched], [], snapshotOf(data), metadata);
    expect(ids(result.skipped)).toEqual(ids([key, empty.key, mismatched.key]));
    expect(result.changesLocalData).toBe(false);
    expect(applyingCloudChanges(data, result.saves, result.deletes).plans).toEqual([value]);
  });

  it("primaryPlanConflictKeepsOnePrimary", () => {
    const first = plan("First", crypto.randomUUID(), "202710", true);
    const second = plan("Second", crypto.randomUUID(), "202710", false);
    let data = emptyUserData();
    data.plans = [first, second];
    const metadata = syncedMetadata(data);
    const remote = structuredClone(second);
    remote.isPrimary = true;
    const result = mergeRecords([incoming({ type: "schedulePlan", plan: remote }, date + 60)], [], snapshotOf(data), metadata, date + 90);
    data = applyingCloudChanges(data, result.saves, result.deletes);
    expect(data.plans.filter((item) => item.isPrimary).map((item) => item.name)).toEqual(["Second"]);
    const firstKey = entityKey({ type: "schedulePlan", plan: first });
    expect(metadata.records.get(keyId(firstKey))?.state.localChangedAt).toBe(date + 90);
    expect(pendingChanges(metadata, snapshotOf(data)).saves).toEqual([firstKey]);
  });

  it("degreePlanPrimaryConflictKeepsOnePrimary", () => {
    const mine = degreePlan();
    mine.name = "Mine";
    let data = emptyUserData();
    data.degreePlans = [mine];
    const metadata = syncedMetadata(data);
    const theirs = syncedForm(degreePlan(crypto.randomUUID(), date + 60));
    theirs.name = "Theirs";
    const result = mergeRecords([incoming({ type: "degreePlan", plan: theirs }, date + 60)], [], snapshotOf(data), metadata, date + 90);
    data = applyingCloudChanges(data, result.saves, result.deletes);
    expect(data.degreePlans).toHaveLength(2);
    expect(data.degreePlans.filter((item) => item.isPrimary).map((item) => item.name)).toEqual(["Theirs"]);
    expect(data.degreePlans.find((item) => item.name === "Mine")?.studentName).toBe("SAMPLE STUDENT");
  });

  it("preferencesMergeFieldByField", () => {
    let data = emptyUserData();
    const metadata = syncedMetadata(data);
    data.preferences.preferredCampus = "Boston";
    observeLocalData(metadata, snapshotOf(data), date + 200);
    const remote = defaultPreferences();
    remote.calendarStartHour = 7;
    const result = mergeRecords(
      [incoming({ type: "preferences", preferences: remote }, date + 100, CloudSyncConfig.schemaVersion, { calendarStartHour: date + 100 })],
      [],
      snapshotOf(data),
      metadata,
    );
    expect(result.saves[0]?.type).toBe("preferences");
    if (result.saves[0]?.type !== "preferences") return;
    expect(result.saves[0].preferences.preferredCampus).toBe("Boston");
    expect(result.saves[0].preferences.calendarStartHour).toBe(7);
    expect(result.keptLocal).toEqual([preferencesKey]);
    data = applyingCloudChanges(data, result.saves, result.deletes);
    const snapshot = snapshotOf(data);
    observeLocalData(metadata, snapshot, date + 300);
    expect(pendingChanges(metadata, snapshot).saves).toEqual([preferencesKey]);
    expect(metadata.preferenceChangedAt.calendarStartHour).toBe(date + 100);
    expect(metadata.preferenceChangedAt.preferredCampus).toBe(date + 200);
  });

  it("customizedPreferencesBeatDefaultsOfUnknownAge", () => {
    const defaults = syncedPreferences(defaultPreferences());
    const custom = { ...defaults, calendarStartHour: 10, showWeekends: true };
    const keepCustom = mergePreferences(custom, {}, defaults, {});
    expect(keepCustom.values).toEqual(custom);
    const adoptCustom = mergePreferences(defaults, {}, custom, {});
    expect(adoptCustom.values).toEqual(custom);
    const dated = mergePreferences(defaults, { showWeekends: date }, custom, {});
    expect(dated.values.showWeekends).toBe(false);
    expect(dated.values.calendarStartHour).toBe(10);
  });

  it("invalidRemoteCalendarHoursFallBackToDefaults", () => {
    const json = '{"values":{"calendarStartHour":30,"calendarEndHour":2,"showWeekends":true},"changedAt":{}}';
    const decoded = CloudSyncCoding.decode(new TextEncoder().encode(json), "Preferences");
    expect(decoded.type).toBe("preferences");
    if (decoded.type !== "preferences") return;
    const defaults = defaultPreferences();
    expect(decoded.values.calendarStartHour).toBe(defaults.calendarStartHour);
    expect(decoded.values.calendarEndHour).toBe(defaults.calendarEndHour);
    expect(decoded.values.showWeekends).toBe(true);
    expect(decoded.values.preferredCampus).toBeNull();
  });

  it("applyingCloudChangesReplacesInsertsAndDeletes", () => {
    const newest = watchItem("3", date + 300);
    const oldest = watchItem("1", date + 100);
    const value = plan();
    const data = emptyUserData();
    data.watchlist = [newest, oldest];
    data.plans = [value];
    data.saved = [saved()];
    const renamed = structuredClone(value);
    renamed.name = "Renamed";
    const middle = watchItem("2", date + 200);
    const result = applyingCloudChanges(
      data,
      [
        { type: "schedulePlan", plan: renamed },
        { type: "watchItem", item: middle },
        { type: "savedCourse", course: saved(cs3500, date + 50) },
      ],
      [entityKey({ type: "savedCourse", course: saved() })],
    );
    expect(result.plans.map((item) => item.name)).toEqual(["Renamed"]);
    expect(result.watchlist.map((item) => item.crn)).toEqual(["3", "2", "1"]);
    expect(result.saved.map((item) => item.key)).toEqual([cs3500]);
    expect(result.preferences).toEqual(data.preferences);
  });

  it("statusLines", () => {
    const now = date;
    expect(statusSummary({ type: "upToDate", lastSync: now - 20 }, now)).toBe("Up to date · just now");
    expect(statusSummary({ type: "upToDate", lastSync: now + 20 }, now)).toBe("Up to date · just now");
    expect(statusSummary({ type: "upToDate", lastSync: now - 120 }, now).startsWith("Up to date · ")).toBe(true);
    expect(statusSummary({ type: "upToDate", lastSync: null }, now)).toBe("Up to date");
    expect(statusSummary({ type: "syncing" })).toBe("Syncing…");
    expect(statusSummary({ type: "unavailable", reason: "noAccount" })).toBe("Sign in to iCloud in Settings to sync");
    expect(statusSummary({ type: "unavailable", reason: "notConfigured" })).toBe("iCloud sync isn't set up in this build");
    expect(statusSummary({ type: "error", message: "Your iCloud storage is full." })).toBe("Your iCloud storage is full.");
  });

  it("entitlementCheck", () => {
    const services = CloudSyncEntitlements.servicesKey;
    const containers = CloudSyncEntitlements.containersKey;
    expect(CloudSyncEntitlements.grantsCloudKit({ [services]: ["CloudKit"], [containers]: [container] }, container)).toBe(true);
    expect(CloudSyncEntitlements.grantsCloudKit({ [services]: "*", [containers]: [container] }, container)).toBe(true);
    expect(CloudSyncEntitlements.grantsCloudKit({ [services]: ["CloudDocuments"], [containers]: [container] }, container)).toBe(false);
    expect(CloudSyncEntitlements.grantsCloudKit({ [services]: ["CloudKit"], [containers]: ["iCloud.com.example.other"] }, container)).toBe(false);
    expect(CloudSyncEntitlements.grantsCloudKit({ "com.apple.security.application-groups": ["group.x"] }, container)).toBe(false);
  });

  it("readsEntitlementsFromCodeSignature", () => {
    const entitlements: Record<string, unknown> = {
      [CloudSyncEntitlements.servicesKey]: ["CloudKit"],
      [CloudSyncEntitlements.containersKey]: [container],
    };
    const signed = CloudSyncEntitlements.codeSignatureEntitlements(machO(plist(entitlements)));
    expect(signed).toBeTruthy();
    expect(CloudSyncEntitlements.grantsCloudKit(signed ?? {}, container)).toBe(true);
    const bare = CloudSyncEntitlements.codeSignatureEntitlements(machO(null));
    expect(bare).toEqual({});
    expect(CloudSyncEntitlements.codeSignatureEntitlements(new TextEncoder().encode("not a binary"))).toBeNull();
    expect(CloudSyncEntitlements.codeSignatureEntitlements(new Uint8Array())).toBeNull();
    const full = machO(plist(entitlements));
    expect(CloudSyncEntitlements.codeSignatureEntitlements(full.subarray(0, 60))).toBeNull();
  });
});

function u32le(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return [...bytes];
}

function u32be(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return [...bytes];
}

function plist(entitlements: Record<string, unknown>): Uint8Array {
  const body = Object.entries(entitlements)
    .map(([key, value]) => {
      const items = (Array.isArray(value) ? value : [value]).map((item) => `<string>${String(item)}</string>`).join("");
      return `<key>${key}</key><array>${items}</array>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${body}</dict></plist>`;
  return new TextEncoder().encode(xml);
}

function machO(entitlements: Uint8Array | null): Uint8Array {
  let index: number[] = [];
  let blobs: number[] = [];
  let count = 0;
  if (entitlements) {
    index = [...u32be(5), ...u32be(12 + 8)];
    blobs = [...u32be(0xfa_de_71_71), ...u32be(8 + entitlements.length), ...entitlements];
    count = 1;
  }
  const superBlob = [...u32be(0xfa_de_0c_c0), ...u32be(12 + index.length + blobs.length), ...u32be(count), ...index, ...blobs];
  const headerSize = 32;
  const commandSize = 16;
  const bytes = [
    ...u32le(0xfe_ed_fa_cf),
    ...u32le(0x01_00_00_0c),
    ...u32le(0),
    ...u32le(2),
    ...u32le(1),
    ...u32le(commandSize),
    ...u32le(0),
    ...u32le(0),
    ...u32le(0x1d),
    ...u32le(commandSize),
    ...u32le(headerSize + commandSize),
    ...u32le(superBlob.length),
    ...superBlob,
  ];
  return new Uint8Array(bytes);
}
