import { describe, expect, it } from "vitest";
import type { BuildingSummary, RoomBooking, RoomSchedule } from "@/lib/catalog-index";
import { dayMask, keyId, parseCourseKey, type CourseKey, type CourseSection } from "@/lib/models";
import {
  availabilityOf,
  bookingsOn,
  filterBuildings,
  freeRoomCounts,
  freeStretches,
  isFreeOnlyBriefly,
  isWithinClassHours,
  momentLabel,
  roomMoment,
  roomStatusDetail,
  roomStatusSummary,
  statusAt,
  statusOfRoom,
  type RoomStatus,
} from "@/lib/rooms";
import { followUpNote, freeSummary, hourLabel, LICENSE_URL, PLATFORM_NAME, SEARCHNEU_SUMMARY } from "@/lib/shell-support";
import { watchId, type WatchItem } from "@/lib/user";
import {
  compareWatchlist,
  watchlistAgo,
  watchlistDetail,
  watchlistSpokenDetail,
  watchlistStatus,
} from "@/lib/watchlist";

const now = 1_790_000_000;
const cs3000: CourseKey = { subject: "CS", number: "3000" };

function watchItem(
  options: {
    crn?: string;
    seats?: number;
    waitlist?: number;
    capacity?: number;
    notifyOnWaitlist?: boolean;
    termCode?: string;
  } = {},
): WatchItem {
  return {
    termCode: options.termCode ?? "202710",
    crn: options.crn ?? "12345",
    courseKey: cs3000,
    courseTitle: "Algorithms and Data",
    sectionLabel: "Lecture · Section 02",
    addedAt: now,
    lastSeatsRemaining: options.seats ?? 0,
    lastWaitlistRemaining: options.waitlist ?? 0,
    seatCapacity: options.capacity ?? 40,
    notifyOnWaitlist: options.notifyOnWaitlist ?? false,
  };
}

function section(crn = "12345", seats = 0, waitlist = 0, capacity = 40): CourseSection {
  return {
    crn,
    subject: "CS",
    number: "3000",
    title: "Algorithms and Data",
    sectionNumber: "02",
    partOfTerm: "1",
    seatCapacity: capacity,
    seatsRemaining: seats,
    enrollment: capacity - seats,
    waitlistCapacity: 10,
    waitlistCount: 10 - waitlist,
    waitlistRemaining: waitlist,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    instructionMethod: "Traditional",
    meetings: [],
    instructors: [],
    crossListCRNs: [],
    attributes: [],
  };
}

function booking(code: string, start: number, end: number, days: number[] = [2], from?: string, to?: string): RoomBooking {
  return {
    crn: `1${start}`,
    course: parseCourseKey(code) ?? cs3000,
    days: dayMask(days),
    start,
    end,
    startDate: from,
    endDate: to,
  };
}

function room(bookings: RoomBooking[], number = "210", building = "WVH"): RoomSchedule {
  return {
    buildingCode: building,
    buildingName: building === "RY" ? "Ryder Hall" : building === "SL" ? "Snell Library" : "West Village H",
    room: number,
    bookings,
    id: `${building}|${number}`,
    label: `${building} ${number}`,
  };
}

function status(bookings: RoomBooking[], minutes: number, weekday = 2): RoomStatus {
  return statusOfRoom(room(bookings), roomMoment(weekday, minutes));
}

describe("ShellSupportTests", () => {
  it("aSectionThatGainsSeatsRaisesOneAlert", () => {
    const item = watchItem({ seats: 0 });
    const outcome = compareWatchlist([item], { "202710": { [keyId(cs3000)]: [section("12345", 3)] } }, now);
    const alert = outcome.alerts[0];
    expect(alert).toBeTruthy();
    expect(outcome.alerts).toHaveLength(1);
    expect(alert?.kind).toBe("seats");
    expect(alert?.title).toBe("Seats open in CS 3000");
    expect(alert?.body).toBe("3 of 40 seats in Lecture 02 (CRN 12345). Register soon!");
    expect(alert?.url).toBe("termorganize://section/202710/12345");
    expect(outcome.items[0]?.lastSeatsRemaining).toBe(3);
    expect(outcome.items[0]?.lastNotifiedAt).toBe(now);
    expect(outcome.items[0]?.lastCheckedAt).toBe(now);
  });

  it("aSectionThatAlreadyHadSeatsRaisesNoAlert", () => {
    const outcome = compareWatchlist([watchItem({ seats: 2 })], { "202710": { [keyId(cs3000)]: [section("12345", 5)] } }, now);
    expect(outcome.alerts).toEqual([]);
    expect(outcome.items[0]?.lastSeatsRemaining).toBe(5);
  });

  it("waitlistAlertsNeedTheOptIn", () => {
    const live = { "202710": { [keyId(cs3000)]: [section("12345", 0, 2)] } };
    const optedOut = compareWatchlist([watchItem()], live, now);
    expect(optedOut.alerts).toEqual([]);
    const optedIn = compareWatchlist([watchItem({ notifyOnWaitlist: true })], live, now);
    expect(optedIn.alerts.map((alert) => alert.kind)).toEqual(["waitlist"]);
    expect(optedIn.alerts[0]?.body).toBe("2 waitlist spots open in Lecture 02 (CRN 12345). Join soon!");
  });

  it("aSectionTheRegistrarNoLongerListsIsReportedMissing", () => {
    const item = watchItem({ crn: "99999", seats: 1 });
    const outcome = compareWatchlist([item], { "202710": { [keyId(cs3000)]: [section("12345", 3)] } }, now);
    expect(outcome.missingIDs).toEqual([watchId(item)]);
    expect(outcome.alerts).toEqual([]);
    expect(outcome.items[0]?.lastSeatsRemaining).toBe(1);
  });

  it("termsThatWereNotCheckedStayUntouched", () => {
    const other = watchItem({ seats: 0, termCode: "202730" });
    const outcome = compareWatchlist([other], { "202710": { [keyId(cs3000)]: [section("12345", 3)] } }, now);
    expect(outcome.items).toEqual([other]);
    expect(outcome.checkedTermCodes).toEqual(["202710"]);
  });

  it("statusesDescribeTheLastCheck", () => {
    const open = watchItem({ seats: 3 });
    expect(watchlistStatus(open, false)).toBe("open");
    expect(watchlistDetail("open", open)).toBe("3 of 40 open");
    expect(watchlistSpokenDetail("open", open)).toBe("3 of 40 seats open");

    const noLimit = watchItem({ seats: 1, capacity: 0 });
    expect(watchlistDetail("open", noLimit)).toBe("1 open");
    expect(watchlistSpokenDetail("open", noLimit)).toBe("1 seat open");

    const waitlist = watchItem({ seats: 0, waitlist: 1 });
    expect(watchlistStatus(waitlist, false)).toBe("waitlist");
    expect(watchlistDetail("waitlist", waitlist)).toBe("Full \u00b7 1 waitlist spot open");

    const full = watchItem({ seats: 0 });
    expect(watchlistStatus(full, false)).toBe("full");
    expect(watchlistDetail("full", full)).toBe("Full");
    expect(watchlistStatus(open, true)).toBe("missing");
    expect(watchlistDetail("missing", open)).toBe("No longer listed");
  });

  it("agoWordingGrowsWithTheTime", () => {
    expect(watchlistAgo(now - 30, now)).toBe("just now");
    expect(watchlistAgo(now - 5 * 60, now)).toBe("5 min ago");
    expect(watchlistAgo(now - 3 * 3_600, now)).toBe("3 hr ago");
    expect(watchlistAgo(now - 30 * 3_600, now)).toBe("yesterday");
    expect(watchlistAgo(now - 4 * 86_400, now)).toBe("4 days ago");
    expect(watchlistAgo(now + 60, now)).toBe("just now");
  });

  it("aClassOccupiesItsStartUpToButNotIncludingItsEnd", () => {
    const classes = [booking("CS 3000", 600, 665)];
    expect(status(classes, 599)).toEqual({ kind: "free", until: 600 });
    expect(status(classes, 600).kind === "free").toBe(false);
    expect(status(classes, 664).kind === "free").toBe(false);
    expect(status(classes, 665)).toEqual({ kind: "free", until: null });
    expect(status(classes, 620, 3)).toEqual({ kind: "free", until: null });
  });

  it("backToBackClassesAreOneStretchOfUse", () => {
    const classes = [booking("CS 3000", 600, 665), booking("MATH 1341", 665, 730)];
    const occupancy = status(classes, 620);
    expect(occupancy.kind).toBe("busy");
    if (occupancy.kind !== "busy") throw new Error("expected the room to be in use");
    expect(occupancy.until).toBe(730);
    expect(occupancy.freeUntil).toBeNull();
  });

  it("aGapBetweenClassesIsReported", () => {
    const classes = [booking("CS 3000", 600, 665), booking("MATH 1341", 720, 780)];
    const occupancy = status(classes, 620);
    expect(occupancy.kind).toBe("busy");
    if (occupancy.kind !== "busy") throw new Error("expected the room to be in use");
    expect(occupancy.until).toBe(665);
    expect(occupancy.freeUntil).toBe(720);
    expect(status(classes, 670)).toEqual({ kind: "free", until: 720 });
  });

  it("statusesReadAsSentences", () => {
    expect(roomStatusSummary({ kind: "free", until: 600 })).toBe("Free until 10:00 AM");
    expect(roomStatusSummary({ kind: "free", until: null })).toBe("Free for the rest of the day");
    const classes = [booking("CS 3000", 600, 665)];
    expect(roomStatusSummary(status(classes, 620))).toBe("In use until 11:05 AM");
    expect(roomStatusDetail(status(classes, 620))).toBe("In use: CS 3000 until 11:05 AM");
  });

  it("aRoomFreeForUnderHalfAnHourIsOnlyBrieflyFree", () => {
    const classes = [booking("CS 3000", 600, 665)];
    const soon = roomMoment(2, 580);
    const early = roomMoment(2, 500);
    expect(isFreeOnlyBriefly(status(classes, 580), soon)).toBe(true);
    expect(isFreeOnlyBriefly(status(classes, 500), early)).toBe(false);
  });

  it("shortSessionsOnlyCountOnTheirOwnDates", () => {
    const workshop = room([booking("CS 2500", 600, 665, [2], "2026-09-15", "2026-09-16")]);
    expect(bookingsOn(workshop, 2)).toEqual([]);
    expect(bookingsOn(workshop, 2, "2026-09-15")).toHaveLength(1);
    expect(bookingsOn(workshop, 2, "2026-10-06")).toEqual([]);
  });

  it("freeStretchesAreTheGapsBetweenClasses", () => {
    const day = [booking("CS 3000", 600, 665), booking("MATH 1341", 665, 730), booking("PHYS 1151", 780, 840)];
    expect(freeStretches(day, 420, 1_320)).toEqual([
      [420, 600],
      [730, 780],
      [840, 1_320],
    ]);
    expect(freeStretches(day, 620, 800)).toEqual([[730, 780]]);
    expect(freeStretches(day, 600, 730)).toEqual([]);
    expect(freeStretches([], 420, 1_320)).toEqual([[420, 1_320]]);
    expect(freeStretches([], 600, 600)).toEqual([]);
    const overlapping = [booking("CS 3000", 600, 700), booking("CS 3001", 650, 680)];
    expect(freeStretches(overlapping, 600, 800)).toEqual([[700, 800]]);
  });

  it("freeRoomCountsAreTheRoomsWithNoClassDuringTheWholeHour", () => {
    const busyMorning = room([booking("CS 3000", 9 * 60 + 50, 11 * 60 + 30)], "210", "RY");
    const busyAfternoon = room([booking("MATH 1341", 13 * 60, 14 * 60)], "300", "RY");
    const empty = room([], "400", "RY");
    const counts = freeRoomCounts([busyMorning, busyAfternoon, empty], 2);
    expect(counts).toHaveLength(15);
    expect(counts[0]).toBe(3);
    expect(counts[2]).toBe(2);
    expect(counts[3]).toBe(2);
    expect(counts[4]).toBe(2);
    expect(counts[5]).toBe(3);
    expect(counts[6]).toBe(2);
    expect(counts[7]).toBe(3);
    expect(freeRoomCounts([], 2)).toEqual(Array.from({ length: 15 }, () => 0));
    expect(freeRoomCounts([busyMorning], 0)).toEqual(Array.from({ length: 15 }, () => 1));
  });

  it("searchMatchesBuildingsAndRoomsByTheirWords", () => {
    const ryder: BuildingSummary = {
      code: "RY",
      name: "Ryder Hall",
      campusCode: "BOS",
      rooms: [room([], "210", "RY"), room([], "300", "RY")],
    };
    const snell: BuildingSummary = {
      code: "SL",
      name: "Snell Library",
      campusCode: "BOS",
      rooms: [room([], "210", "SL")],
    };
    const moment = roomMoment(2, 600);
    const all = [availabilityOf(ryder, moment), availabilityOf(snell, moment)];
    expect(filterBuildings(all, "ry").map((item) => item.building.code)).toEqual(["RY"]);
    expect(filterBuildings(all, "snell").map((item) => item.building.code)).toEqual(["SL"]);
    expect(filterBuildings(all, "ryder")[0]?.free).toHaveLength(2);
    const byRoom = filterBuildings(all, "210");
    expect(byRoom.map((item) => item.building.code)).toEqual(["RY", "SL"]);
    expect(byRoom[0]?.free.map((entry) => entry.room.room)).toEqual(["210"]);
    expect(filterBuildings(all, "  ")).toHaveLength(2);
  });

  it("momentsStayWithinTheWeek", () => {
    const wrapped = roomMoment(8, 99_999);
    expect(wrapped.weekday).toBe(1);
    expect(wrapped.minutes).toBe(24 * 60 - 1);
    expect(isWithinClassHours(roomMoment(2, 600))).toBe(true);
    expect(isWithinClassHours(roomMoment(2, 6 * 60))).toBe(false);
    expect(momentLabel(roomMoment(2, 14 * 60 + 30))).toBe("Tuesday at 2:30 PM");
  });

  it("followUpNotesSayWhatComesNext", () => {
    const today = [booking("CS 3000", 600, 665), booking("MATH 1341", 720, 780)];
    expect(followUpNote({ kind: "free", until: 600 }, today)).toBe("Next: CS 3000, 10:00 – 11:05 AM");
    expect(followUpNote({ kind: "free", until: null }, today)).toBe("No more classes today.");
    expect(followUpNote({ kind: "free", until: null }, [])).toBe("No classes are scheduled here today.");
    const occupancy = statusAt(today, 620);
    expect(occupancy.kind).toBe("busy");
    if (occupancy.kind !== "busy") throw new Error("expected the room to be in use");
    expect(followUpNote(occupancy, today)).toBe("Then free until 12:00 PM");
    expect(freeSummary(12, 40)).toBe("12 of 40 rooms free");
    expect(freeSummary(1, 1)).toBe("1 of 1 room free");
  });

  it("hourLabelsUseTheTwelveHourClock", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(8)).toBe("8 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(21)).toBe("9 PM");
    expect(hourLabel(24)).toBe("12 AM");
  });

  it("legalTextNamesTheLicenseAndWhereToReadIt", () => {
    expect(LICENSE_URL).toBe("https://www.gnu.org/licenses/agpl-3.0.html");
    expect(SEARCHNEU_SUMMARY.includes(`${PLATFORM_NAME} adaptation of SearchNEU`)).toBe(true);
  });
});
