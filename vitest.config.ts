import { createRequire } from "node:module";
import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

// Résolution qui remonte les node_modules comme Node (racine OU worktree avec
// son propre npm install) — contrairement à un chemin construit sur
// `import.meta.url`, qui cassait dans les worktrees `.claude/` (#76).
// NB : `require.resolve("server-only/empty.js")` est impossible (le champ
// `exports` du package n'expose que "."), d'où le join à côté de l'entrée.
const require = createRequire(import.meta.url);
const serverOnlyEmpty = path.join(path.dirname(require.resolve("server-only")), "empty.js");

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Le garde build-time de Next (`import "server-only"`) jette hors d'un
      // React Server environment : sous Vitest, on pointe sur sa version vide
      // (celle que Next résout lui-même via la condition `react-server`).
      "server-only": serverOnlyEmpty,
    },
  },
  test: {
    // La logique testée (lib/scoring/) est pure : pas de DOM, pas de réseau.
    environment: "node",
    // Les worktrees d'agents (`.claude/worktrees/*`) contiennent des copies du
    // repo : sans exclusion, un run à la racine exécute leurs tests en double.
    // On étend les défauts (node_modules, dist…) au lieu de les remplacer.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
