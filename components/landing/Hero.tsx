"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import PixelTextAnimation from "./PixelTextAnimation";

type Particle = {
  id: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  delay: number;
  duration: number;
};

function FloridaDataViz() {
  const swfl = { x: 245, y: 355 };

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: 32 }, (_, i) => {
        const edge = i % 4;
        let x1 = 0;
        let y1 = 0;

        if (edge === 0) {
          x1 = Math.random() * 600;
          y1 = -20;
        } else if (edge === 1) {
          x1 = 620;
          y1 = Math.random() * 520;
        } else if (edge === 2) {
          x1 = Math.random() * 600;
          y1 = 540;
        } else {
          x1 = -20;
          y1 = Math.random() * 520;
        }

        return {
          id: i,
          x1,
          y1,
          cx: (x1 + swfl.x) / 2 + (Math.random() - 0.5) * 70,
          cy: (y1 + swfl.y) / 2 + (Math.random() - 0.5) * 70,
          x2: swfl.x + (Math.random() - 0.5) * 18,
          y2: swfl.y + (Math.random() - 0.5) * 18,
          delay: Math.random() * 2.2,
          duration: 2.8 + Math.random() * 2.2,
        };
      }),
    [],
  );

  return (
    <div className="absolute inset-0 rounded-3xl overflow-hidden">
      <svg
        viewBox="0 0 600 520"
        className="w-full h-full"
        aria-label="Florida data connectivity visualization"
      >
        <defs>
          <linearGradient id="flStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.85" />
          </linearGradient>
          <pattern
            id="grid"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 28 0 L 0 0 0 28"
              fill="none"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect x="0" y="0" width="600" height="520" fill="url(#grid)" />
        {particles.map((p) => (
          <motion.path
            key={p.id}
            d={`M ${p.x1} ${p.y1} Q ${p.cx} ${p.cy} ${p.x2} ${p.y2}`}
            fill="none"
            stroke="rgba(94,234,212,0.28)"
            strokeWidth="1"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1], opacity: [0, 0.7, 0] }}
            transition={{
              duration: p.duration,
              delay: p.delay,
              repeat: Infinity,
              repeatDelay: 0.4,
              ease: "easeInOut",
            }}
          />
        ))}
      </svg>
    </div>
  );
}

export default function Hero() {
  const badgeColor = "#00d4aa";

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: 0.15 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.95, filter: "blur(10px)" },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      transition: {
        duration: 0.7,
        type: "spring" as const,
        stiffness: 80,
        damping: 12,
      },
    },
  };

  return (
    <section className="relative min-h-dvh flex items-center px-6 md:px-8 z-10 pt-24">
      <div className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-8"
        >
          <motion.div variants={itemVariants}>
            <div
              className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-full backdrop-blur-sm"
              style={{
                border: `1px solid ${badgeColor}33`,
                background: `linear-gradient(to right, ${badgeColor}14, rgba(34,211,238,0.06))`,
              }}
            >
              <PixelTextAnimation
                text="✨ AI Data Layer for SWFL"
                align="left"
                color={badgeColor}
                fontSize={14}
                fontWeight={600}
                className="w-[230px] h-[18px]"
              />
            </div>

            <h1 className="text-6xl md:text-7xl lg:text-8xl font-black tracking-tight text-white leading-tight mb-6 bg-gradient-to-br from-white via-teal-primary to-cyan-400 bg-clip-text text-transparent">
              Real Data. Real Answers.
            </h1>

            <p className="text-lg md:text-xl text-gray-300 font-light leading-relaxed max-w-xl">
              Stop guessing. Get instant access to Southwest Florida&apos;s most
              accurate property, labor, permits, and market intelligence powered
              by AI.
            </p>
          </motion.div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="relative h-[400px] md:h-[500px] lg:h-[600px] animate-float"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent rounded-3xl border border-white/10 backdrop-blur-sm glass-card-modern" />
          <FloridaDataViz />
        </motion.div>
      </div>
    </section>
  );
}
