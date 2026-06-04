import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: ".",
  cacheDir: resolve(projectRoot, "work/vite-cache-react18"),
  plugins: [react()],
  optimizeDeps: {
    noDiscovery: true,
    include: ["react", "react-dom/client", "react/jsx-dev-runtime", "react/jsx-runtime"],
    esbuildOptions: {
      absWorkingDir: projectRoot
    }
  },
  server: {
    host: "127.0.0.1",
    fs: {
      strict: true,
      allow: [projectRoot]
    }
  }
});
