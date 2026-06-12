import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const packageJson = readJson("./package.json");
const tauriConfig = readJson("./src-tauri/tauri.conf.json");

if (packageJson.version !== tauriConfig.version) {
  throw new Error(`package.json version ${packageJson.version} must match Tauri version ${tauriConfig.version}`);
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_PRODUCT_NAME__: JSON.stringify(tauriConfig.productName),
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUNDLE_IDENTIFIER__: JSON.stringify(tauriConfig.identifier),
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
