import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  base: "./",
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false, routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2500 },
});
