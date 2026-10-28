import { next } from "@leadforge/config/eslint/next";

export default [
  ...next,
  {
    ignores: [".next/**", ".next-*/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
];
