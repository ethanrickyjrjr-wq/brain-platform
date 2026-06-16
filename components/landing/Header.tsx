"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { LoginModal } from "./LoginModal";

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const closeModal = useCallback(() => setModalOpen(false), []);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
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
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-black/70 backdrop-blur-xl border-b border-white/10"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -20, scale: 0.95, filter: "blur(8px)" }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
          transition={{
            duration: 0.6,
            type: "spring",
            stiffness: 100,
            damping: 15,
          }}
          className="flex items-center gap-3"
        >
          <Image
            src="/logo.png"
            alt="SWFL Data Gulf"
            width={44}
            height={44}
            className="rounded-xl"
          />
          <span className="text-xl font-semibold text-white tracking-tight">SWFL Data Gulf</span>
        </motion.div>

        <motion.nav
          initial={{ opacity: 0, x: 20, scale: 0.95, filter: "blur(8px)" }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
          transition={{
            duration: 0.6,
            delay: 0.1,
            type: "spring",
            stiffness: 100,
            damping: 15,
          }}
          className="hidden md:flex items-center gap-8"
        >
          <Link
            href="#comparison"
            className="relative text-gray-400 hover:text-white transition-colors group"
          >
            How It Works
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-teal-primary transition-all group-hover:w-full" />
          </Link>
          <Link
            href="#install"
            className="relative text-gray-400 hover:text-white transition-colors group"
          >
            Install
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-teal-primary transition-all group-hover:w-full" />
          </Link>
          <Link
            href="#data"
            className="relative text-gray-400 hover:text-white transition-colors group"
          >
            Live Data
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-teal-primary transition-all group-hover:w-full" />
          </Link>
          <Link
            href="/ops/data-inventory"
            className="relative text-gray-500 hover:text-gray-300 transition-colors text-xs"
          >
            Ops
          </Link>
          {user ? (
            <div className="flex items-center gap-3">
              <Link
                href="/project"
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                My Projects
              </Link>
              <button
                onClick={signOut}
                className="text-sm text-gray-400 transition-colors hover:text-white"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setModalOpen(true)}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                Log In
              </button>
              <motion.a
                href="#waitlist"
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.98 }}
                className="btn-gradient text-navy-dark px-6 py-2.5 rounded-xl font-medium transition-all"
              >
                Get Access
              </motion.a>
            </div>
          )}
        </motion.nav>

        <button
          className="md:hidden text-white p-2"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-white/10 bg-black/90 px-6 py-4 flex flex-col gap-4 backdrop-blur-xl">
          <Link
            href="#comparison"
            className="text-gray-300 hover:text-white transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            How It Works
          </Link>
          <Link
            href="#install"
            className="text-gray-300 hover:text-white transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Install
          </Link>
          <Link
            href="#data"
            className="text-gray-300 hover:text-white transition-colors"
            onClick={() => setMobileOpen(false)}
          >
            Live Data
          </Link>
          <div className="border-t border-white/10 pt-3">
            {user ? (
              <div className="flex flex-col gap-3">
                <Link
                  href="/project"
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-center font-medium text-white"
                  onClick={() => setMobileOpen(false)}
                >
                  My Projects
                </Link>
                <button
                  onClick={signOut}
                  className="text-sm text-gray-400 hover:text-white text-left"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    setModalOpen(true);
                  }}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white w-full"
                >
                  Log In
                </button>
                <a
                  href="#waitlist"
                  onClick={() => setMobileOpen(false)}
                  className="btn-gradient text-navy-dark px-6 py-2.5 rounded-xl font-medium text-center block"
                >
                  Get Access
                </a>
              </div>
            )}
          </div>
        </nav>
      )}

      <LoginModal open={modalOpen} onClose={closeModal} />
    </header>
  );
}
