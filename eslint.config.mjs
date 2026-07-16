import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  nextPlugin.flatConfig.coreWebVitals,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "apps/web/postcss.config.mjs",
      "**/*.config.cjs",
      "apps/web/src/components/leadvirt/**",
      "apps/web/src/components/marketing/**"
    ]
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      next: {
        rootDir: ["apps/web/"]
      }
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["warn", { "prefer": "type-imports" }]
    }
  }
];
