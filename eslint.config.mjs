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
    // Downloaded third-party browser bundle; it is not application source.
    "app/SVG Viewer - View, edit, and optimize SVGs_files/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    ".stryker-tmp/**",
    "reports/**",
  ]),
]);

export default eslintConfig;
