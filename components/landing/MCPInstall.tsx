"use client";

import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

const installCommands = {
  "claude-code": {
    title: "Claude Code",
    command: "claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp",
    description: "Add the SWFL Data Gulf MCP server to Claude Code CLI",
  },
  "claude-desktop": {
    title: "Claude Desktop",
    command: `Add to your claude_desktop_config.json:\n{\n  "mcpServers": {\n    "swfl": {\n      "type": "http",\n      "url": "https://www.swfldatagulf.com/api/mcp"\n    }\n  }\n}`,
    description: "Configure for the Claude Desktop App",
  },
} as const;

type TabKey = keyof typeof installCommands;

export default function MCPInstall() {
  const [activeTab, setActiveTab] = useState<TabKey>("claude-code");
  const [copiedTab, setCopiedTab] = useState<TabKey | null>(null);

  const handleCopy = (tab: TabKey) => {
    navigator.clipboard.writeText(installCommands[tab].command);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <section id="install" className="relative py-32 px-6 md:px-8 z-10 overflow-hidden">
      <div className="max-w-5xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl md:text-6xl font-black text-white mb-4 bg-gradient-to-r from-white to-teal-primary/80 bg-clip-text text-transparent">
            Install MCP Server
          </h2>
          <p className="text-lg text-gray-300 font-light">
            Connect SWFL Data Gulf to your AI tool in one command
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6, delay: 0.1 }}
          viewport={{ once: true }}
          className="mb-8"
        >
          <div className="flex flex-wrap gap-3 mb-8 justify-center">
            {(Object.keys(installCommands) as TabKey[]).map((tab) => (
              <motion.button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                  activeTab === tab
                    ? "btn-gradient text-navy-dark"
                    : "bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] hover:border-white/20"
                }`}
                whileHover={{ y: -2 }}
                whileTap={{ y: 0 }}
              >
                {installCommands[tab].title}
              </motion.button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <div className="relative glass-card-modern border border-white/10 rounded-2xl p-8 hover:border-teal-primary/30 transition-all">
                <p className="text-sm text-gray-400 mb-6">
                  {installCommands[activeTab].description}
                </p>
                <div className="relative">
                  <pre className="text-teal-primary font-mono text-sm overflow-x-auto pb-4 whitespace-pre-wrap">
                    <code>{installCommands[activeTab].command}</code>
                  </pre>
                  <motion.button
                    onClick={() => handleCopy(activeTab)}
                    className="absolute top-0 right-0 p-2 bg-white/[0.06] hover:bg-teal-primary/20 rounded-lg transition-colors"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {copiedTab === activeTab ? (
                      <Check className="w-5 h-5 text-teal-primary" />
                    ) : (
                      <Copy className="w-5 h-5 text-gray-300" />
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <p className="inline-block bg-white/[0.04] border border-white/10 rounded-full px-6 py-3 text-gray-300 font-light">
            Cursor and Windsurf support is on the roadmap — HTTP MCP transport arriving soon.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
