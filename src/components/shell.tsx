"use client";

import { useApp } from "@/lib/app-state";
import { UNOFFICIAL_NOTICE } from "@/lib/legal";
import { Bell, CalendarDays, DoorOpen, GraduationCap, Moon, Search, Settings, Sun, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/degree", label: "Degree", icon: GraduationCap },
  { href: "/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/professors", label: "Professors", icon: Users },
  { href: "/watchlist", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { terms, termCode, setTermCode, theme, setTheme, index } = useApp();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="wordmark">
          <span className="mark">T</span>
          <span>Term Organize</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} data-active={active(link.href)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="term-select">
            Term
          </label>
          <select id="term-select" className="select w-auto py-2 text-sm" value={termCode} onChange={(event) => setTermCode(event.target.value)}>
            {terms.map((term) => (
              <option key={term.code} value={term.code}>
                {term.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost tiny"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
      <p className="footer-note">
        {UNOFFICIAL_NOTICE} Course data from Northeastern University’s public registration system
        {index ? ` · ${index.courses.length.toLocaleString()} courses in this snapshot` : ""}.{" "}
        <Link href="/legal" className="underline">
          About and license
        </Link>
      </p>
      <nav className="bottom-nav" aria-label="Mobile">
        {LINKS.slice(0, 4).map((link) => (
          <Link key={link.href} href={link.href} data-active={active(link.href)}>
            <link.icon size={16} className="mx-auto mb-0.5" />
            {link.label}
          </Link>
        ))}
        <Link href="/settings" data-active={active("/settings") || active("/watchlist") || active("/professors")}>
          <Settings size={16} className="mx-auto mb-0.5" />
          More
        </Link>
      </nav>
    </div>
  );
}
