import { base } from "./base.js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export const next = [
  ...base,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];

export default next;
