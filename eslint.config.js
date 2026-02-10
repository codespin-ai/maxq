import js from "@eslint/js";
import typescript from "typescript-eslint";
import globals from "globals";

export default typescript.config(
  js.configs.recommended,
  ...typescript.configs.recommended,

  // Base config for all TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      "prefer-const": "error",
      "no-var": "error",
      quotes: [
        "error",
        "double",
        { avoidEscape: true, allowTemplateLiterals: true },
      ],
    },
  },

  // Tests - relaxed rules for test mocks and fixtures
  {
    files: [
      "**/maxq-integration-tests/**/*.ts",
      "**/maxq-test-utils/**/*.ts",
      "**/foreman-integration-tests/**/*.ts",
      "**/foreman-client/src/tests/**/*.ts",
      "**/foreman-test-utils/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.mocha,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": "off",
    },
  },

  // JS/MJS config files (no type checking)
  {
    files: ["**/*.js", "**/*.mjs"],
    ...typescript.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      quotes: [
        "error",
        "double",
        { avoidEscape: true, allowTemplateLiterals: true },
      ],
    },
  },

  // Ignores
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "**/dist/**",
      "build/**",
      "**/*.d.ts",
      "**/generated/**",
      "scripts/**",
    ],
  },
);
