"use client";

import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export function ProjectNav() {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  return (
    <nav className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-sm font-semibold text-white hover:text-[#00d4aa] transition-colors"
        >
          SWFL Data Gulf
        </Link>
        <span className="text-white/20">/</span>
        <Link href="/r" className="text-sm text-gray-400 hover:text-white transition-colors">
          Explore Data
        </Link>
      </div>
      <button
        onClick={signOut}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Sign out
      </button>
    </nav>
  );
}
