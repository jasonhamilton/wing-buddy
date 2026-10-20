import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: { input: { app: "index.html", landing: "landing.html" } },
  },
  server: { host: "0.0.0.0", port: 3000 },
});
