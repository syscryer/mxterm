import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5520,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5521,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and local scratch dirs
      //    (.tmp-dev holds locked temp files from external tools that crash fs.watch with EBUSY)
      ignored: ["**/src-tauri/**", "**/.tmp-dev/**"],
    },
  },
}));
