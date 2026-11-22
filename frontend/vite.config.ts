import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { InlineConfig } from "vitest/node";

interface VitestConfigExport extends UserConfig {
  test?: InlineConfig;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (
            normalized.includes("/node_modules/zod/") ||
            normalized.includes("/node_modules/react-hook-form/") ||
            normalized.includes("/node_modules/@hookform/")
          ) {
            return "vendor-forms";
          }
          if (normalized.includes("/node_modules/katex/")) {
            return "vendor-katex";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    minWorkers: 1,
    maxWorkers: 2,
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 2,
      },
      threads: {
        minThreads: 1,
        maxThreads: 2,
      },
    },
  },
} as VitestConfigExport);
