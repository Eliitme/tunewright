import { loadEnv } from "vite";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { securityHeadersFile } from "./src/config/environment-settings.ts";

/** Emits Cloudflare's `_headers` (CSP etc.) for the API origin of the build mode. */
function securityHeaders(mode: string, apiUrl: string | undefined): Plugin {
  return {
    name: "tunewright-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: securityHeadersFile(mode, apiUrl) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Same VITE_API_URL the app sees (shell or .env.<mode>), so the CSP always allows the API it calls.
  plugins: [react(), tailwindcss(), securityHeaders(mode, loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL || undefined)],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom" },
}));
