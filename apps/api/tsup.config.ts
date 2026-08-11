import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Les packages de l'atelier sont inlinés dans le bundle : l'image runtime
  // n'a alors plus besoin des liens symboliques pnpm du monorepo.
  noExternal: [/^@maxoujeux\//],
  // PGlite n'est utilisé qu'en développement ; l'exclure évite de tirer
  // son binaire WASM (~12 Mo) dans l'image de production.
  external: ["@electric-sql/pglite"],
});
