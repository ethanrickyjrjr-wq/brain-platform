"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Mail, Check } from "lucide-react";

const INTERESTS = [
  { id: "real-estate", label: "Real Estate" },
  { id: "franchise", label: "Franchise" },
  { id: "labor", label: "Labor" },
  { id: "development", label: "Development" },
  { id: "all", label: "All Updates" },
];

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "duplicate" | "error"
  >("idle");

  const toggleInterest = (id: string) => {
    if (id === "all") {
      setInterests(interests.includes("all") ? [] : ["all"]);
    } else {
      const filtered = interests.filter((i) => i !== "all");
      setInterests(
        filtered.includes(id)
          ? filtered.filter((i) => i !== id)
          : [...filtered, id],
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || interests.length === 0) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, interests }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      setStatus(data.already_subscribed ? "duplicate" : "done");
    } catch {
      setStatus("error");
    }
  };

  const done = status === "done" || status === "duplicate";

  return (
    <section
      id="waitlist"
      className="relative py-32 px-6 md:px-8 z-10 overflow-hidden"
    >
      <div className="max-w-2xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-5xl md:text-6xl font-black text-white mb-4 bg-gradient-to-r from-white to-teal-primary/80 bg-clip-text text-transparent">
            Join the Waitlist
          </h2>
          <p className="text-lg text-gray-300 font-light">
            Be first to access new data lakes, sharper numbers, and deeper SWFL
            coverage
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6, delay: 0.1 }}
          viewport={{ once: true }}
        >
          {done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card-modern border border-teal-primary/30 rounded-2xl p-12 text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center justify-center w-16 h-16 bg-teal-primary/15 rounded-full mb-4"
              >
                <Check className="w-8 h-8 text-teal-primary" />
              </motion.div>
              <h3 className="text-2xl font-bold text-white mb-2">
                {status === "done"
                  ? "You're on the list!"
                  : "Already subscribed"}
              </h3>
              <p className="text-gray-400">
                {status === "done"
                  ? "We'll reach out when new coverage drops."
                  : "You're already on our list — we'll be in touch."}
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={status === "submitting"}
                  className="w-full pl-12 pr-4 py-4 input-modern rounded-xl text-white placeholder-gray-500"
                />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-400">
                  I&apos;m interested in:
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {INTERESTS.map((option) => (
                    <motion.button
                      key={option.id}
                      type="button"
                      onClick={() => toggleInterest(option.id)}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className={`px-4 py-3 rounded-lg font-medium transition-all text-sm ${
                        interests.includes(option.id)
                          ? "btn-gradient text-navy-dark border border-teal-primary/50"
                          : "bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] hover:border-white/20"
                      }`}
                    >
                      {option.label}
                    </motion.button>
                  ))}
                </div>
                {interests.length === 0 && (
                  <p className="text-xs text-red-400/70">
                    Select at least one interest
                  </p>
                )}
              </div>

              <motion.button
                type="submit"
                disabled={status === "submitting" || interests.length === 0}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="w-full btn-gradient text-navy-dark py-4 rounded-xl font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "submitting" ? "Joining…" : "Join Waitlist"}
              </motion.button>

              {status === "error" && (
                <p className="text-xs text-red-400 text-center">
                  Something went wrong. Try again in a moment.
                </p>
              )}

              <p className="text-xs text-gray-500 text-center">
                No spam, ever. Your email stays on our infrastructure only.{" "}
                <a href="/privacy" className="underline hover:text-gray-300">
                  Privacy policy.
                </a>
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}
