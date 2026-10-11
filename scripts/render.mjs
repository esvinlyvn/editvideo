#!/usr/bin/env node
// Build + check + render một listing (hoặc tất cả) ra MP4.
// Dùng: npm run video -- listings/the-riverside-2pn   |   npm run video -- --all
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dirs = args.includes("--all")
  ? fs.readdirSync("listings").map((d) => path.join("listings", d)).filter((d) => fs.existsSync(path.join(d, "listing.json")))
  : args;
if (!dirs.length) {
  console.error("Dùng: npm run video -- listings/<slug>  (hoặc --all)");
  process.exit(1);
}
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" };
for (const dir of dirs) {
  const slug = path.basename(path.resolve(dir));
  const out = path.join("build", slug);
  execFileSync("node", ["scripts/build.mjs", dir], { stdio: "inherit" });
  execFileSync("npx", ["hyperframes", "check"], { cwd: out, stdio: "inherit", env });
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env });
  console.log(`🎬 ${out}/output.mp4`);
}
