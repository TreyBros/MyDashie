import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

// Managed keys: read from .env at build time and baked (scrambled) into the main process only.
// TEMPORARY: anything shipped in the app can be extracted. Move these behind a key proxy before selling.
function managedKeys() {
  const p = resolve(".env");
  // DASH_EDITION=community builds the open-source edition: no cloud, no baked keys, users bring their own.
  const env: Record<string, string> = existsSync(p) && process.env.DASH_EDITION !== "community"
    ? Object.fromEntries(readFileSync(p, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]))
    : {};
  const salt = "dashy-pastel-salt";
  const scramble = (v = "") => Buffer.from([...Buffer.from(v)].map((b, i) => b ^ salt.charCodeAt(i % salt.length))).toString("base64");
  // With the cloud configured, the agent keys are delivered per session by the app-config function and
  // must not ship in the bundle; local dev builds (no SUPABASE_URL) keep baking them for convenience.
  const cloud = !!env.SUPABASE_URL;
  return { openai: cloud ? "" : scramble(env.OPENAI_API_KEY), composio: cloud ? "" : scramble(env.COMPOSIO_API_KEY), supabaseUrl: env.SUPABASE_URL ?? "", supabaseAnonKey: env.SUPABASE_ANON_KEY ?? "", webUrl: env.WEB_URL ?? "" };
}
const mk = managedKeys();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __MANAGED_OPENAI__: JSON.stringify(mk.openai),
      __MANAGED_COMPOSIO__: JSON.stringify(mk.composio),
      __SUPABASE_URL__: JSON.stringify(mk.supabaseUrl),
      __SUPABASE_ANON_KEY__: JSON.stringify(mk.supabaseAnonKey),
      __WEB_URL__: JSON.stringify(mk.webUrl),
    },
    resolve: {
      alias: { "@shared": resolve("src/shared"), "@main": resolve("src/main") },
    },
    build: {
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
        output: { format: "es" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") },
        output: { format: "es" },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@shared": resolve("src/shared"), "@": resolve("src/renderer/src") },
    },
    build: {
      rollupOptions: {
        input: { index: resolve("src/renderer/index.html") },
      },
    },
  },
});
