/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // In dev, /api is forwarded to the FastAPI server to avoid CORS setup.
        "/api": env.VITE_DEV_API_PROXY ?? "http://localhost:8000",
      },
    },
    build: {
      // Recharts alone is ~515 kB minified (~150 kB gzip); it is split into its own cached chunk.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: { manualChunks: { recharts: ["recharts"] } },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
    },
  };
});
