import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

// Dev-only endpoint for the in-page text editor (src/util/editMode.ts). It only ever updates keys that
// already exist in src/copy.json, with string values, and keeps a timestamped backup before each write.
function copyEditor(): Plugin {
  const file = path.resolve("src/copy.json");
  const backups = path.resolve("src/.copy-backups");
  return {
    name: "copy-editor",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__copy", (req, res) => {
        const reply = (code: number, body: object) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return reply(405, { error: "POST only" });
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return reply(403, { error: "cross-origin request refused" });
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          try {
            const changes = JSON.parse(data) as Record<string, unknown>;
            const current = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, string>;
            for (const [k, v] of Object.entries(changes)) {
              if (!(k in current)) throw new Error(`unknown text "${k}"`);
              if (typeof v !== "string") throw new Error(`"${k}" is not text`);
            }
            fs.mkdirSync(backups, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            fs.copyFileSync(file, path.join(backups, `copy-${stamp}.json`));
            const old = fs.readdirSync(backups).filter((f) => f.endsWith(".json")).sort();
            for (const f of old.slice(0, Math.max(0, old.length - 40))) fs.unlinkSync(path.join(backups, f));
            fs.writeFileSync(file, JSON.stringify({ ...current, ...(changes as Record<string, string>) }, null, 2) + "\n", "utf-8");
            reply(200, { saved: Object.keys(changes).length });
          } catch (err) {
            reply(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      });
    },
  };
}

// The "Last updated" date in the page header: the day this build ran (local time), so every `npm run build` -- on this
// machine or on Cloudflare -- stamps its own. SITE_BUILD_DATE=YYYY-MM-DD overrides it (reproducible builds, testing).
const buildDate = process.env.SITE_BUILD_DATE ?? new Date().toLocaleDateString("en-CA");

export default defineConfig({
  root: ".",
  plugins: [copyEditor()],
  define: { __BUILD_DATE__: JSON.stringify(buildDate) },
  publicDir: "public",
  server: { port: 5183, strictPort: false, fs: { strict: false } },
  // This project's directory is exposed under two different host paths (a
  // sandbox-level bind mount, not an NTFS symlink -- fsutil sees neither side
  // as a reparse point). Vite's file-serving check realpath()s each request
  // and compares it against the root it booted from; the two paths diverge
  // there, so requests fell through to raw static serving instead of the
  // esbuild transform (symptom: .ts files served byte-for-byte, complete
  // with `import type`, which then fails to parse as JS in the browser).
  // preserveSymlinks keeps Vite working in path-as-launched terms instead of
  // realpath terms, which sidesteps the divergence entirely.
  resolve: { preserveSymlinks: true },
  build: { outDir: "dist", assetsDir: "assets" },
});
