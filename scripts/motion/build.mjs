#!/usr/bin/env node
// Dựng bản "có Motion Prompt" của một post mà KHÔNG đụng vào bản gốc.
//   node scripts/motion/build.mjs projects/post-N [--no-render] [--plan-only]
// Các bước:
//   1. Chạy build.mjs của post (--no-render). Thư mục build/post-N cũ (kể cả output.mp4) được giữ nguyên.
//   2. Chép kết quả sang build/post-N.motion/ rồi chạy đạo diễn tự động (direct.mjs) → motion-plan.json.
//   3. Tiêm motion-fx.js + MP.apply(tl, plan) ngay trước dòng đăng ký window.__timelines.
//   4. Mở trang bằng Chromium headless: bắt lỗi JS, đọc nhật ký áp hiệu ứng (motion-log.json).
//      Có lỗi → tự rút hiệu ứng ra, bản dựng quay về y như gốc (không bao giờ hỏng video).
//   5. Lint + render → build/post-N.motion/output.mp4, ghi thời gian render.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { direct, printPlan } from "./direct.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const proj = args.find((a) => !a.startsWith("--"));
if (!proj) { console.error("Cách dùng: node scripts/motion/build.mjs projects/post-N [--no-render] [--plan-only]"); process.exit(2); }
const PDIR = path.resolve(proj);
const post = path.basename(PDIR);
const orig = path.join(ROOT, "build", post);
const out = path.join(ROOT, "build", `${post}.motion`);
const keep = path.join(ROOT, "build", `.${post}.keep`);

// ---------- 1. build gốc, giữ thư mục build cũ ----------
if (fs.existsSync(keep)) fs.rmSync(keep, { recursive: true, force: true });
if (fs.existsSync(orig)) fs.renameSync(orig, keep);
try {
  execFileSync("node", [path.join(PDIR, "build.mjs"), "--no-render"], { stdio: ["ignore", "ignore", "inherit"] });
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(orig, out, { recursive: true });
} finally {
  if (fs.existsSync(keep)) { fs.rmSync(orig, { recursive: true, force: true }); fs.renameSync(keep, orig); }
}

// ---------- 2. đạo diễn tự động ----------
let plan = direct(PDIR, { html: path.join(out, "index.html"), quiet: true });
fs.writeFileSync(path.join(out, "motion-plan.json"), JSON.stringify(plan, null, 1));
if (args.includes("--plan-only")) { printPlan(plan); process.exit(0); }

// ---------- 3. tiêm runtime ----------
const chars = JSON.parse(fs.readFileSync(path.join(HERE, "characters.json"), "utf8")).characters;
const htmlPath = path.join(out, "index.html");
const pristine = fs.readFileSync(htmlPath, "utf8");
function inject(items) {
  const reg = pristine.match(/window\.__timelines\[\s*["']([^"']+)["']\s*\]\s*=\s*(\w+)\s*;/);
  if (!reg) return null;
  const opts = { characters: Object.fromEntries(Object.entries(chars).map(([k, c]) => [k, { name: c.name, selector: c.selector, parts: c.parts, limits: c.limits }])) };
  const call = `MP.apply(${reg[2]}, ${JSON.stringify({ duration: plan.duration, limits: plan.limits, items })}, ${JSON.stringify(opts)});\n      `;
  let h = pristine.replace(reg[0], call + reg[0]);
  h = h.replace(/(<script src="assets\/vendor\/gsap\.min\.js"><\/script>)/, `$1\n    <script src="assets/vendor/motion-fx.js"></script>`);
  return h.includes("motion-fx.js") ? h : null;
}
fs.copyFileSync(path.join(HERE, "motion-fx.js"), path.join(out, "assets/vendor/motion-fx.js"));
let html = inject(plan.items);
if (!html) { console.warn("⚠ Không tìm thấy chỗ đăng ký timeline / thẻ gsap: giữ nguyên bản gốc, không áp hiệu ứng."); html = pristine; }
fs.writeFileSync(htmlPath, html);

// ---------- 4. kiểm tra trong trình duyệt ----------
async function verify() {
  const { default: puppeteer } = await import("puppeteer-core");
  const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium", process.env.CHROME_PATH].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => { window.__timelines = window.__timelines || {}; document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(".clip").forEach((c) => (c.style.visibility = "hidden"))); }); // runtime HyperFrames tạo sẵn biến này
    const t0 = Date.now();
    await page.goto("file://" + htmlPath, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const log = await page.evaluate(() => window.__MP_LOG || null);
    return { errors, log, setupMs: Date.now() - t0 };
  } finally { await browser.close(); }
}
let check = await verify();
// Hiệu ứng nào không gắn được (không thấy phần tử phù hợp) thì trả lại suất cho cảnh khác: lập kế hoạch lại tối đa 2 lượt.
const exclude = new Set();
for (let pass = 0; pass < 2 && check.log && !check.errors.length; pass++) {
  const miss = check.log.filter((l) => l.status === "skipped");
  if (!miss.length) break;
  miss.forEach((l) => { const it = plan.items.find((i) => i.n === l.n); exclude.add(`${it.at}|${it.id}`); it.fallback.forEach((f) => exclude.add(`${it.at}|${f.id}`)); });
  const next = direct(PDIR, { html: path.join(out, "index.html"), quiet: true, exclude });
  if (JSON.stringify(next.items.map((i) => [i.at, i.id])) === JSON.stringify(plan.items.map((i) => [i.at, i.id]))) break;
  plan = next;
  fs.writeFileSync(htmlPath, inject(plan.items) || pristine);
  check = await verify();
}
printPlan(plan);
fs.writeFileSync(path.join(out, "motion-plan.json"), JSON.stringify(plan, null, 1));
if (check.errors.length || !check.log) {
  console.warn(`⚠ Lỗi khi chạy hiệu ứng (${check.errors.join(" | ") || "không có nhật ký"}). Rút toàn bộ hiệu ứng, dựng như bản gốc.`);
  fs.writeFileSync(htmlPath, pristine);
  check = { ...check, log: [], fallbackToOriginal: true };
}
fs.writeFileSync(path.join(out, "motion-log.json"), JSON.stringify(check, null, 1));
console.log(`\n🧩 Áp vào timeline (dò + gắn ${check.setupMs} ms):`);
for (const l of check.log) console.log(`  ${l.at.toFixed(1).padStart(5)}s  #${l.id} ${l.fx.padEnd(13)} ${l.status.padEnd(8)} ${l.target || ""}${l.te !== undefined ? ` @${l.te.toFixed(2)}s` : ""}${l.note ? `  · ${l.note}` : ""}`);

// ---------- 5. lint + render ----------
const lint = spawnSync("npx", ["hyperframes", "lint"], { cwd: out, encoding: "utf8", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
console.log((lint.stdout || "").trim().split("\n").slice(-3).join("\n"));
if (!args.includes("--no-render")) {
  const t0 = Date.now();
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4", "--quiet"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
  const sec = (Date.now() - t0) / 1000;
  fs.writeFileSync(path.join(out, "render-time.txt"), `${sec.toFixed(1)}\n`);
  console.log(`✔ ${path.relative(ROOT, out)}/output.mp4 · render ${sec.toFixed(1)} s`);
}
