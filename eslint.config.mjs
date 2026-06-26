import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import allow from "./verification/supabase-untyped-allowlist.json" with { type: "json" };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow _-prefixed identifiers as intentionally unused (TypeScript/pack convention).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Claude Code worktrees — each contains its own .next/ build artifacts and
    // hook scripts that are not authored code; never lint them.
    ".claude/**",
    // Third-party toolkit — CJS Node scripts; not app code.
    "awesome-claude-code-toolkit/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design reference / vendor anime.js examples / beautified bundles —
    // not shipped code, not authored here, intentionally outside lint scope.
    "app/_design/**",
    "docs/design-reference/**",
    // /ops is a separate Vercel project with its own toolchain — isolated from
    // the main app's lint/build (see _AUDIT_AND_ROADMAP/ops-build-spec.md).
    "ops/**",
    // Archived plan docs — historical code snippets, not shipped.
    "docs/**/_FINISHED/**",
    "docs/_FINISHED/**",
  ]),
  // Fiverr-delivered viz components use Recharts tooltip prop typing
  // (`any` is the library default) and a setState-in-effect default-select
  // pattern. Both are functional; not worth blocking CI on. Relax these two
  // rules for the viz folder only — refactor backlog.
  {
    files: ["components/viz/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Ban the untyped Supabase client factories. Every new caller must use the typed
  // factory or add the file to verification/supabase-untyped-allowlist.json with a KNOWN-DEBT comment.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/utils/supabase/server",
              importNames: ["createClientUntyped"],
              message:
                "createClientUntyped is the deferred-fix hatch. Use the typed createClient; if a fix is genuinely deferred, add the file to verification/supabase-untyped-allowlist.json + a KNOWN-DEBT comment.",
            },
            {
              name: "@/utils/supabase/service-role",
              importNames: ["createServiceRoleClientUntyped"],
              message:
                "createServiceRoleClientUntyped is the deferred-fix hatch. Use the typed createServiceRoleClient; if a fix is genuinely deferred, add the file to verification/supabase-untyped-allowlist.json + a KNOWN-DEBT comment.",
            },
          ],
        },
      ],
    },
  },
  // Allowlist: files that still use a hatch (shrinking — KNOWN-DEBT). Overrides the ban above.
  // Escape glob special characters ([ ]) that appear in Next.js dynamic-route directory names.
  {
    files: allow.map((p) => p.replace(/\[/g, "\\[").replace(/\]/g, "\\]")),
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
