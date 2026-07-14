import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Le garde build-time de Next (`import "server-only"`) jette hors d'un
      // React Server environment : sous Vitest, on pointe sur sa version vide
      // (celle que Next résout lui-même via la condition `react-server`).
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    // La logique testée (lib/scoring/) est pure : pas de DOM, pas de réseau.
    environment: "node",
  },
});
