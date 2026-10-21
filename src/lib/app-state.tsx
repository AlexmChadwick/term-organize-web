"use client";

import { CatalogIndex } from "@/lib/catalog-index";
import { idbGetCatalog, idbSetCatalog } from "@/lib/idb";
import type { Course, CourseKey, CourseSection, Term, TermCatalog } from "@/lib/models";
import { catalogIsNewer, courseKeyOf, keyId, sameKey, termName } from "@/lib/models";
import { emptyPreferences } from "@/lib/preferences";
import {
  emptyPlanFilters,
  emptyUserData,
  keepOnePrimaryDegree,
  keepOnePrimaryPlan,
  loadUserData,
  mergeUserData,
  newId,
  nextColorIndex,
  saveUserData,
  type SchedulePlan,
  type UserData,
  type WatchItem,
} from "@/lib/user";
import { canPlacePlanCourse, mergeRefreshedSections } from "@/lib/schedule/pins";
import { syncClosedAlerts } from "@/lib/push-client";
import { compareWatchlist } from "@/lib/watchlist";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

function missingDetails(catalog: TermCatalog): boolean {
  return catalog.courses.some((course) => !course.detailsLoaded);
}

/* eslint-disable react-hooks/exhaustive-deps -- setUser is a stable wrapper around useState. */

export type ThemeChoice = "light" | "dark" | "system";

export interface TermOption {
  code: string;
  name: string;
  bundled: boolean;
}

interface AppContextValue {
  ready: boolean;
  user: UserData;
  updateUser: (fn: (user: UserData) => UserData) => void;
  replaceUser: (user: UserData) => void;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  termCode: string;
  setTermCode: (code: string) => void;
  terms: TermOption[];
  index: CatalogIndex | null;
  catalogStatus: "loading" | "building" | "ready" | "missing" | "error";
  catalogDetail: string | null;
  catalogError: string | null;
  rebuildTerm: () => Promise<void>;
  plan: SchedulePlan | null;
  ensurePlan: () => SchedulePlan;
  updatePlan: (id: string, fn: (plan: SchedulePlan) => SchedulePlan) => void;
  addCourseToPlan: (key: CourseKey, planId?: string) => void;
  toggleSaved: (key: CourseKey) => void;
  isSaved: (key: CourseKey) => boolean;
  rememberCourse: (key: CourseKey) => void;
  rememberSearch: (query: string) => void;
  watchSection: (section: CourseSection) => void;
  unwatch: (crn: string) => void;
  isWatched: (crn: string) => boolean;
  applyLive: (key: CourseKey, patch: Partial<Course>, sections: CourseSection[]) => void;
  refreshWatchlist: () => Promise<string | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

const THEME_KEY = "term-organize.theme";
const BUNDLED = "202710";

function makePlan(termCode: string, name = "My schedule"): SchedulePlan {
  const now = Date.now();
  return {
    id: newId(),
    name,
    termCode,
    courses: [],
    selectedCRNs: [],
    filters: emptyPlanFilters(),
    preferences: emptyPreferences(),
    favoriteCombinations: [],
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
    manualPinsMigrated: true,
  };
}

function applyTheme(theme: ThemeChoice) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [user, setUserState] = useState<UserData>(emptyUserData());
  const setUser = useCallback((updater: UserData | ((prev: UserData) => UserData)) => {
    setUserState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (readyRef.current) saveUserData(next);
      return next;
    });
  }, []);
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<AppContextValue["catalogStatus"]>("loading");
  const [catalogDetail, setCatalogDetail] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermOption[]>([{ code: BUNDLED, name: "Fall 2026", bundled: true }]);

  const termCode = user.preferences.selectedTermCode || BUNDLED;

  useEffect(() => {
    const stored = loadUserData();
    if (!stored.preferences.selectedTermCode) stored.preferences.selectedTermCode = BUNDLED;
    readyRef.current = true;
    setUser(stored);
    const savedTheme = (localStorage.getItem(THEME_KEY) as ThemeChoice | null) ?? "system";
    setThemeState(savedTheme);
    applyTheme(savedTheme);
    setReady(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveUserData(user);
  }, [user, ready]);

  async function fillDescriptions(code: string, isCancelled: () => boolean) {
    let previous = Number.POSITIVE_INFINITY;
    for (let guard = 0; guard < 400; guard += 1) {
      if (isCancelled()) return;
      const res = await fetch(`/api/catalog/${code}/details`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; remaining?: number; catalog?: TermCatalog };
      if (isCancelled()) return;
      if (!res.ok || !body.catalog) {
        setCatalogDetail(body.error ?? "Could not load this term's course descriptions.");
        return;
      }
      await idbSetCatalog(code, body.catalog);
      if (isCancelled()) return;
      setIndex(CatalogIndex.build(body.catalog));
      const remaining = body.remaining ?? 0;
      if (remaining <= 0) {
        setCatalogDetail(null);
        return;
      }
      if (remaining >= previous) {
        setCatalogDetail("Some course descriptions could not be read from Banner.");
        return;
      }
      previous = remaining;
      setCatalogDetail(`Loading this term's course descriptions from Banner… ${remaining} left`);
    }
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setCatalogStatus("loading");
    setCatalogDetail(null);
    setCatalogError(null);
    setIndex(null);
    (async () => {
      try {
        const cached = await idbGetCatalog(termCode);
        if (cancelled) return;
        if (cached) {
          setIndex(CatalogIndex.build(cached));
          setCatalogStatus("ready");
        }
        let remote: TermCatalog | null = null;
        try {
          remote = await fetchCatalog(termCode);
        } catch (error) {
          if (!cached) throw error;
        }
        if (cancelled) return;
        if (remote && (!cached || catalogIsNewer(remote, cached))) {
          setIndex(CatalogIndex.build(remote));
          setCatalogStatus("ready");
          void idbSetCatalog(termCode, remote);
          if (missingDetails(remote)) void fillDescriptions(termCode, cancelledCheck);
          return;
        }
        const shown = remote ?? cached;
        if (shown) {
          if (missingDetails(shown)) void fillDescriptions(termCode, cancelledCheck);
          return;
        }
        await installBuiltCatalog(termCode, cancelledCheck);
      } catch (error) {
        if (cancelled) return;
        setCatalogStatus("error");
        setCatalogError(error instanceof Error ? error.message : "Couldn't load the catalog.");
      }

      function cancelledCheck() {
        return cancelled;
      }

      async function installBuiltCatalog(code: string, isCancelled: () => boolean) {
        setCatalogStatus("building");
        setCatalogDetail("Downloading every section of this term from Banner…");
        const res = await fetch(`/api/catalog/${code}`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as TermCatalog & { error?: string };
        if (isCancelled()) return;
        if (!res.ok) throw new Error(body.error ?? "Couldn't download that term.");
        await idbSetCatalog(code, body);
        if (isCancelled()) return;
        setIndex(CatalogIndex.build(body));
        setCatalogStatus("ready");
        setCatalogDetail(null);
        if (missingDetails(body)) void fillDescriptions(code, isCancelled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [termCode, ready]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/banner/terms")
      .then((res) => res.json())
      .then((body: { terms?: { code: string; name: string }[]; bundled?: string[] }) => {
        if (cancelled || !body.terms?.length) return;
        const bundled = new Set(body.bundled ?? [BUNDLED]);
        const options = body.terms.map((term) => ({ code: term.code, name: term.name, bundled: bundled.has(term.code) }));
        if (!options.some((term) => term.code === BUNDLED)) options.unshift({ code: BUNDLED, name: "Fall 2026", bundled: true });
        setTerms(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const updateUser = useCallback((fn: (user: UserData) => UserData) => {
    setUser((prev) => fn(prev));
  }, []);

  const replaceUser = useCallback((next: UserData) => {
    setUser(mergeUserData(next));
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }, []);

  const setTermCode = useCallback((code: string) => {
    setUser((prev) => ({ ...prev, preferences: { ...prev.preferences, selectedTermCode: code } }));
  }, []);

  const rebuildTerm = useCallback(async () => {
    setCatalogStatus("building");
    setCatalogDetail("Downloading every section of this term from Banner…");
    setCatalogError(null);
    try {
      const res = await fetch(`/api/catalog/${termCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshDetails: true }),
      });
      const body = (await res.json().catch(() => ({}))) as TermCatalog & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't download that term.");
      await idbSetCatalog(termCode, body);
      setIndex(CatalogIndex.build(body));
      setCatalogStatus("ready");
      setCatalogDetail(null);
      if (missingDetails(body)) void fillDescriptions(termCode, () => false);
    } catch (error) {
      setCatalogStatus("error");
      setCatalogError(error instanceof Error ? error.message : "Couldn't download that term.");
    }
  }, [termCode]);

  const plan = useMemo(
    () => user.plans.find((item) => item.termCode === termCode && item.isPrimary) ?? user.plans.find((item) => item.termCode === termCode) ?? null,
    [user.plans, termCode],
  );

  const ensurePlan = useCallback(() => {
    let created: SchedulePlan | null = null;
    setUser((prev) => {
      const existing = prev.plans.find((item) => item.termCode === termCode && item.isPrimary) ?? prev.plans.find((item) => item.termCode === termCode);
      if (existing) {
        created = existing;
        return prev;
      }
      const fresh = makePlan(termCode);
      created = fresh;
      return { ...prev, plans: keepOnePrimaryPlan([...prev.plans, fresh], termCode, fresh.id) };
    });
    return created ?? makePlan(termCode);
  }, [termCode]);

  const updatePlan = useCallback((id: string, fn: (plan: SchedulePlan) => SchedulePlan) => {
    setUser((prev) => ({
      ...prev,
      plans: prev.plans.map((item) => (item.id === id ? { ...fn(item), updatedAt: Date.now() } : item)),
    }));
  }, []);

  const addCourseToPlan = useCallback(
    (key: CourseKey, planId?: string) => {
      setUser((prev) => {
        let plans = prev.plans;
        let target = planId ? plans.find((item) => item.id === planId) : plans.find((item) => item.termCode === termCode && item.isPrimary) ?? plans.find((item) => item.termCode === termCode);
        if (!target) {
          target = makePlan(termCode);
          plans = keepOnePrimaryPlan([...plans, target], termCode, target.id);
        }
        if (!canPlacePlanCourse(target.courses, key, null)) return { ...prev, plans };
        const next: SchedulePlan = {
          ...target,
          updatedAt: Date.now(),
          courses: [...target.courses, { key, isRequired: true, excludedCRNs: [], colorIndex: nextColorIndex(target) }],
        };
        return { ...prev, plans: plans.map((item) => (item.id === target!.id ? next : item)) };
      });
    },
    [termCode],
  );

  const toggleSaved = useCallback(
    (key: CourseKey) => {
      setUser((prev) => {
        const id = `${termCode}|${keyId(key)}`;
        const exists = prev.saved.some((item) => `${item.termCode}|${keyId(item.key)}` === id);
        return {
          ...prev,
          saved: exists ? prev.saved.filter((item) => `${item.termCode}|${keyId(item.key)}` !== id) : [{ termCode, key, savedAt: Date.now() }, ...prev.saved],
        };
      });
    },
    [termCode],
  );

  const isSaved = useCallback(
    (key: CourseKey) => user.saved.some((item) => item.termCode === termCode && sameKey(item.key, key)),
    [user.saved, termCode],
  );

  const rememberCourse = useCallback(
    (key: CourseKey) => {
      setUser((prev) => {
        const rest = prev.recents.filter((item) => !(item.termCode === termCode && sameKey(item.key, key)));
        return { ...prev, recents: [{ termCode, key, viewedAt: Date.now() }, ...rest].slice(0, 24) };
      });
    },
    [termCode],
  );

  const rememberSearch = useCallback((query: string) => {
    const text = query.trim();
    if (text.length < 2) return;
    setUser((prev) => ({ ...prev, searchHistory: [text, ...prev.searchHistory.filter((item) => item.toLowerCase() !== text.toLowerCase())].slice(0, 12) }));
  }, []);

  const watchSection = useCallback((section: CourseSection) => {
    const item: WatchItem = {
      termCode,
      crn: section.crn,
      courseKey: { subject: section.subject, number: section.number },
      courseTitle: section.title,
      sectionLabel: `${section.classType} ${section.sectionNumber}`.trim(),
      addedAt: Date.now(),
      lastSeatsRemaining: section.seatsRemaining,
      lastWaitlistRemaining: section.waitlistRemaining,
      seatCapacity: section.seatCapacity,
      lastCheckedAt: Date.now(),
      notifyOnWaitlist: true,
    };
    setUser((prev) => {
      const rest = prev.watchlist.filter((watched) => !(watched.termCode === termCode && watched.crn === section.crn));
      return { ...prev, watchlist: [item, ...rest] };
    });
  }, [termCode]);

  const unwatch = useCallback(
    (crn: string) => {
      setUser((prev) => ({ ...prev, watchlist: prev.watchlist.filter((item) => !(item.termCode === termCode && item.crn === crn)) }));
    },
    [termCode],
  );

  const isWatched = useCallback(
    (crn: string) => user.watchlist.some((item) => item.termCode === termCode && item.crn === crn),
    [user.watchlist, termCode],
  );

  const userRef = useRef(user);
  userRef.current = user;

  const applyLive = useCallback((key: CourseKey, patch: Partial<Course>, sections: CourseSection[]) => {
    setIndex((prev) => {
      if (!prev) return prev;
      const pins = userRef.current.plans.flatMap((plan) => {
        if (plan.termCode !== prev.catalog.term.code) return [];
        const pinned = plan.courses.flatMap((course) => (course.pinnedCRN && sameKey(course.key, key) ? [course.pinnedCRN] : []));
        const selected = plan.selectedCRNs.filter((crn) => {
          const section = prev.sectionByCRN(crn);
          return section != null && sameKey({ subject: section.subject, number: section.number }, key);
        });
        return [...pinned, ...selected];
      });
      const merged = mergeRefreshedSections(prev.sectionsOf(key), sections, pins);
      const existing = prev.course(key);
      const course = existing ? { ...existing, ...patch, postreqs: patch.postreqs ?? existing.postreqs } : null;
      return prev.replaceCourse(key, course, merged);
    });
  }, []);

  const refreshWatchlist = useCallback(async () => {
    const groups = new Map<string, { subject: string; number: string }[]>();
    for (const item of user.watchlist) {
      const list = groups.get(item.termCode) ?? [];
      if (!list.some((course) => course.subject === item.courseKey.subject && course.number === item.courseKey.number)) {
        list.push({ subject: item.courseKey.subject, number: item.courseKey.number });
      }
      groups.set(item.termCode, list);
    }
    if (!groups.size) return null;
    const live: Record<string, Record<string, CourseSection[]>> = {};
    try {
      for (const [term, courses] of groups) {
        const res = await fetch("/api/banner/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, courses }),
        });
        const body = (await res.json()) as { sections?: CourseSection[]; error?: string };
        if (!res.ok) throw new Error(body.error || "Seat check failed.");
        const byCourse: Record<string, CourseSection[]> = {};
        for (const section of body.sections ?? []) {
          const id = keyId(courseKeyOf(section));
          byCourse[id] = [...(byCourse[id] ?? []), section];
        }
        live[term] = byCourse;
      }
    } catch (error) {
      return error instanceof Error ? error.message : "Seat check failed.";
    }
    const outcome = compareWatchlist(user.watchlist, live);
    setUser((prev) => ({ ...prev, watchlist: outcome.items }));
    if (outcome.alerts.length && user.preferences.notificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const registration = await navigator.serviceWorker?.ready.catch(() => null);
      for (const alert of outcome.alerts) {
        if (registration) await registration.showNotification(alert.title, { body: alert.body, data: { url: alert.url } });
        else new Notification(alert.title, { body: alert.body });
      }
    }
    return outcome.alerts.length ? `${outcome.alerts.length} seat alert${outcome.alerts.length === 1 ? "" : "s"}.` : null;
  }, [user.watchlist, user.preferences.notificationsEnabled]);

  useEffect(() => {
    if (!ready || !user.preferences.autoRefreshSeats || !user.watchlist.length) return;
    const minutes = Math.max(1, user.preferences.watchlistIntervalMinutes || 15);
    const id = window.setInterval(() => {
      void refreshWatchlist();
    }, minutes * 60_000);
    return () => window.clearInterval(id);
  }, [ready, user.preferences.autoRefreshSeats, user.preferences.watchlistIntervalMinutes, user.watchlist.length, refreshWatchlist]);

  useEffect(() => {
    if (!ready || !user.preferences.backgroundRefreshEnabled) return;
    void syncClosedAlerts(user.watchlist, user.preferences.watchlistIntervalMinutes);
  }, [ready, user.preferences.backgroundRefreshEnabled, user.preferences.watchlistIntervalMinutes, user.watchlist]);

  const value: AppContextValue = {
    ready,
    user,
    updateUser,
    replaceUser,
    theme,
    setTheme,
    termCode,
    setTermCode,
    terms,
    index,
    catalogStatus,
    catalogDetail,
    catalogError,
    rebuildTerm,
    plan,
    ensurePlan,
    updatePlan,
    addCourseToPlan,
    toggleSaved,
    isSaved,
    rememberCourse,
    rememberSearch,
    watchSection,
    unwatch,
    isWatched,
    applyLive,
    refreshWatchlist,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

async function fetchCatalog(term: string): Promise<TermCatalog | null> {
  const res = await fetch(`/api/catalog/${term}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("The catalog did not load. Refresh the page.");
  return (await res.json()) as TermCatalog;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function termLabel(terms: TermOption[], code: string, catalogTerm?: Term | null): string {
  return terms.find((term) => term.code === code)?.name ?? (catalogTerm ? termName(catalogTerm) : code);
}

export { keepOnePrimaryDegree, keepOnePrimaryPlan, makePlan };
