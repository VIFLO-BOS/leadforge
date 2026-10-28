import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC (not esbuild) so NestJS constructor injection metadata survives transpilation.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    globalSetup: ["./test/global-setup.ts"],
  },
});
