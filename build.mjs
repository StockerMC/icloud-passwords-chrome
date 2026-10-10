import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
cpSync("src/options/options.html", "dist/options.html");
cpSync("icons", "dist/icons", { recursive: true });

const opts = {
  entryPoints: [
    { in: "src/background.ts", out: "background" },
    { in: "src/content.ts", out: "content" },
    { in: "src/popup/popup.ts", out: "popup" },
    { in: "src/options/options.ts", out: "options" },
  ],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
