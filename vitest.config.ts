import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // La logique testée (lib/scoring/) est pure : pas de DOM, pas de réseau.
    environment: "node",
  },
});
