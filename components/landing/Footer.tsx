"use client";

import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";

const footerLinks = {
  Product: [
    { label: "How It Works", href: "#comparison" },
    { label: "Install MCP", href: "#install" },
    { label: "Live Data", href: "#data" },
    { label: "API Reference", href: "/api/b/master" },
  ],
  Legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
};

export default function Footer() {
  return (
    <footer className="relative bg-navy-dark border-t border-white/5 z-10">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-16 md:py-20">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
            whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-3 mb-4">
              <Image
                src="/logo.png"
                alt="SWFL Data Gulf"
                width={40}
                height={40}
                className="rounded-lg"
              />
              <span className="text-lg font-semibold text-white tracking-tight">
                SWFL Data Gulf
              </span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              AI-ready data layer for Southwest Florida. Property, labor,
              permits, CRE, and tourism intelligence — every number cited, every
              source linked.
            </p>
          </motion.div>

          {Object.entries(footerLinks).map(([section, links], idx) => (
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
              whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.6, delay: idx * 0.1 }}
              viewport={{ once: true }}
            >
              <h4 className="font-semibold text-white mb-4">{section}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-gray-400 hover:text-teal-primary transition-colors text-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          viewport={{ once: true }}
          className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-6"
        >
          <div className="text-sm text-gray-500">
            <p>
              © {new Date().getFullYear()} SWFL Data Gulf. All rights reserved.
            </p>
            <p className="mt-1 text-xs">
              Lee + Collier county data. Every number cited.
            </p>
          </div>
          <div className="flex items-center gap-2 glass-card-modern border border-white/10 rounded-full px-4 py-2">
            <span className="w-2 h-2 bg-teal-primary rounded-full animate-pulse" />
            <span className="text-xs text-gray-400">Systems Operational</span>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
