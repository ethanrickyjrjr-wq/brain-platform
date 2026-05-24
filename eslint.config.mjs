import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design reference / vendor anime.js examples / beautified bundles —
    // not shipped code, not authored here, intentionally outside lint scope.
    "app/_design/**",
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
]);

export default eslintConfig;
