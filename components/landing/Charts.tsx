"use client";

import { motion } from "motion/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useState } from "react";

interface LandingCharts {
  corridorRents: { name: string; rent: number }[];
  marketEvents: { name: string; count: number }[];
  keyMetrics: { label: string; value: string; change: string }[];
}

const CustomTooltipRent = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number }[];
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-navy-dark border border-white/10 rounded-lg p-3 shadow-xl">
        <p className="text-teal-primary font-mono text-sm">
          ${payload[0].value.toFixed(2)}/sqft NNN
        </p>
      </div>
    );
  }
  return null;
};

const CustomTooltipCount = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number }[];
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-navy-dark border border-white/10 rounded-lg p-3 shadow-xl">
        <p className="text-teal-primary font-mono text-sm">
          {payload[0].value} active
        </p>
      </div>
    );
  }
  return null;
};

export default function Charts() {
  const [data, setData] = useState<LandingCharts | null>(null);

  useEffect(() => {
    fetch("/api/landing-data")
      .then((r) => r.json())
      .then((d) => setData(d.charts))
      .catch(() => {});
  }, []);

  const chartVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.98, filter: "blur(8px)" },
    visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
  };

  return (
    <section
      id="data"
      className="relative py-32 px-6 md:px-8 z-10 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-6xl font-black text-white mb-4 bg-gradient-to-r from-white to-teal-primary/80 bg-clip-text text-transparent">
            Live Market Intelligence
          </h2>
          <p className="text-lg text-gray-300 font-light">
            Real-time data insights for Southwest Florida — cited, sourced,
            machine-readable
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8 mb-12">
          {/* Corridor rents */}
          <motion.div
            variants={chartVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <div className="relative glass-card-modern border border-white/10 rounded-2xl p-8 hover:border-teal-primary/30 transition-all">
              <h3 className="text-xl font-bold text-white mb-1">
                Corridor Asking Rents
              </h3>
              <p className="text-sm text-gray-400 mb-6">
                $/sqft NNN · Source: SWFL CRE Corridor Profiles 2026-Q1
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={data?.corridorRents ?? []}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 120, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <XAxis type="number" stroke="rgba(255,255,255,0.5)" />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="rgba(255,255,255,0.5)"
                    width={115}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip content={<CustomTooltipRent />} />
                  <Bar
                    dataKey="rent"
                    fill="url(#rentGradient)"
                    radius={[0, 6, 6, 0]}
                    isAnimationActive={true}
                  >
                    <defs>
                      <linearGradient
                        id="rentGradient"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="0"
                      >
                        <stop
                          offset="0%"
                          stopColor="#00d4aa"
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="100%"
                          stopColor="#00b894"
                          stopOpacity={0.4}
                        />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Active market events */}
          <motion.div
            variants={chartVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <div className="relative glass-card-modern border border-white/10 rounded-2xl p-8 hover:border-teal-primary/30 transition-all">
              <h3 className="text-xl font-bold text-white mb-1">
                Active Market Events
              </h3>
              <p className="text-sm text-gray-400 mb-6">
                32 live flags across 17 corridors · Source: SWFL Corridor Pulse
                2026-06-05
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={data?.marketEvents ?? []}
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <XAxis
                    dataKey="name"
                    stroke="rgba(255,255,255,0.5)"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis stroke="rgba(255,255,255,0.5)" />
                  <Tooltip content={<CustomTooltipCount />} />
                  <Bar
                    dataKey="count"
                    fill="url(#eventGradient)"
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={true}
                  >
                    <defs>
                      <linearGradient
                        id="eventGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#00d4aa"
                          stopOpacity={0.9}
                        />
                        <stop
                          offset="100%"
                          stopColor="#00b894"
                          stopOpacity={0.4}
                        />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* Key metrics grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(data?.keyMetrics ?? []).map((metric, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
              whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.6, delay: index * 0.08 }}
              viewport={{ once: true }}
              className="glass-card-modern border border-white/10 rounded-2xl p-6 transition-all hover:border-white/20"
            >
              <p className="text-sm text-gray-400 mb-2">{metric.label}</p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-4xl font-bold text-white font-mono">
                    {metric.value}
                  </p>
                  <p className="text-sm mt-2 text-teal-primary">
                    {metric.change}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl bg-teal-primary/10 text-teal-primary">
                  📊
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
