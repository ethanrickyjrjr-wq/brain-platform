"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { LoginModal } from "@/components/landing/LoginModal";

/**
 * The ONE global top navigation bar. Mounted once in the root layout and shown on
 * every page EXCEPT the home marketing page (which keeps its own fancy fixed
 * Header), the auth screens, and embedded widgets. Before this, only `/` had a
 * nav — every other page was a dead end ("people can't get anywhere").
 *
 * Labels are human words only ("Search", "Projects", "Market Trends"); the routes
 * behind them are plumbing the visitor never sees. Auth/identity + sign-out mirror
 * the proven pattern in components/landing/Header.tsx (read the user's own session
 * client-side; no new server PII surface, /api/me untouched).
 */

/** Paths that must NOT show the bar. Home has its own header; /login + /auth are
 *  focused auth screens; /embed/* are iframe fragments meant to live in other sites. */
function isHiddenPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/embed")
  );
}

/** Data ▾ menu — real, distinct user-facing data pages (Charts and "Market Trends"
 *  are the same page, merged to one item). */
const DATA_ITEMS: { href: string; label: string }[] = [
  { href: "/charts", label: "Market Trends" },
  { href: "/map", label: "Map" },
  { href: "/ops/data-inventory", label: "Data Inventory" },
];

export function GlobalNav() {
  const pathname = usePathname();
  const hidden = isHiddenPath(pathname);

  const [user, setUser] = useState<User | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Read the visitor's own session client-side (same shape as the home Header) so
  // the account menu can show their email and we know logged-in vs out. Skipped on
  // hidden pages so we don't spin up a Supabase client where the bar never renders.
  useEffect(() => {
    if (hidden) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [hidden]);

  const closeMenus = useCallback(() => {
    setDataOpen(false);
    setAccountOpen(false);
  }, []);

  // Close the open dropdown on an outside click or Escape. (State is set inside the
  // event handlers, never synchronously in the effect body — keeps the
  // react-hooks/set-state-in-effect lint happy.)
  useEffect(() => {
    if (!dataOpen && !accountOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) closeMenus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [dataOpen, accountOpen, closeMenus]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  if (hidden) return null;

  const isActive = (href: string) => !!pathname && pathname.startsWith(href);
  const dataActive = DATA_ITEMS.some((d) => isActive(d.href));
  const email = user?.email ?? "";
  const initial = (email[0] ?? "?").toUpperCase();

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-white/10 bg-navy-dark/95 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo (→ home) + primary tabs */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2" aria-label="SWFL Data Gulf — home">
            <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="hidden text-base font-semibold tracking-tight text-white sm:inline">
              SWFL Data Gulf
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <TabLink href="/r" active={isActive("/r")} onClick={closeMenus}>
              Search
            </TabLink>
            <TabLink href="/project" active={isActive("/project")} onClick={closeMenus}>
              Projects
            </TabLink>

            {/* Data ▾ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(false);
                  setDataOpen((o) => !o);
                }}
                aria-expanded={dataOpen}
                aria-haspopup="menu"
                className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                  dataActive ? "text-white" : "text-gray-300 hover:text-white"
                }`}
              >
                Data
                <Caret open={dataOpen} />
              </button>
              {dataOpen && (
                <div
                  role="menu"
                  className="absolute left-0 z-50 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-navy-dark p-1 shadow-2xl"
                >
                  {DATA_ITEMS.map((d) => (
                    <MenuLink key={d.href} href={d.href} onClick={closeMenus}>
                      {d.label}
                    </MenuLink>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Right: account (desktop) */}
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setDataOpen(false);
                  setAccountOpen((o) => !o);
                }}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-full border border-white/15 py-1 pl-1 pr-2 text-sm text-white transition-colors hover:bg-white/10"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0a8078] text-xs font-semibold text-white">
                  {initial}
                </span>
                <span className="hidden max-w-[14rem] truncate text-gray-200 lg:inline">
                  {email}
                </span>
                <Caret open={accountOpen} />
              </button>
              {accountOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-navy-dark p-1 shadow-2xl"
                >
                  <div className="truncate border-b border-white/10 px-3 py-2 text-xs text-gray-400">
                    {email}
                  </div>
                  <MenuLink href="/project" onClick={closeMenus}>
                    My Projects
                  </MenuLink>
                  <MenuLink href="/billing" onClick={closeMenus}>
                    Billing
                  </MenuLink>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      void signOut();
                    }}
                    role="menuitem"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                Log In
              </button>
              <Link
                href="/#waitlist"
                className="btn-gradient rounded-xl px-5 py-2 text-sm font-medium text-navy-dark"
              >
                Get Access
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="p-2 text-white md:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-white/10 bg-navy-dark px-4 py-3 md:hidden">
          <MobileLink href="/r" onClick={() => setMobileOpen(false)}>
            Search
          </MobileLink>
          <MobileLink href="/project" onClick={() => setMobileOpen(false)}>
            Projects
          </MobileLink>
          <p className="px-3 pt-3 text-[10px] uppercase tracking-wider text-gray-500">Data</p>
          {DATA_ITEMS.map((d) => (
            <MobileLink key={d.href} href={d.href} onClick={() => setMobileOpen(false)}>
              {d.label}
            </MobileLink>
          ))}
          <div className="mt-2 border-t border-white/10 pt-3">
            {user ? (
              <>
                <p className="truncate px-3 pb-1 text-xs text-gray-400">{email}</p>
                <MobileLink href="/billing" onClick={() => setMobileOpen(false)}>
                  Billing
                </MobileLink>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    void signOut();
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  Sign out
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    setLoginOpen(true);
                  }}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white"
                >
                  Log In
                </button>
                <Link
                  href="/#waitlist"
                  onClick={() => setMobileOpen(false)}
                  className="btn-gradient rounded-xl px-5 py-2 text-center text-sm font-medium text-navy-dark"
                >
                  Get Access
                </Link>
              </div>
            )}
          </div>
        </nav>
      )}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </header>
  );
}

function TabLink({
  href,
  active,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "text-white" : "text-gray-300 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </Link>
  );
}

function MobileLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="rounded-lg px-3 py-2 text-sm text-gray-200 hover:bg-white/10 hover:text-white"
    >
      {children}
    </Link>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
