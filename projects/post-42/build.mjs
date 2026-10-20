#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-42/build.mjs [--no-render]
// Kết quả: build/post-42/index.html (+ output.mp4)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sfxHtml } from "../../scripts/sfx-cues.mjs";
import { breakLines, canBreak } from "../../scripts/vn-text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const out = path.join(ROOT, "build", path.basename(HERE));
const T = JSON.parse(fs.readFileSync(path.join(HERE, "transcript.json"), "utf8"));
const VOICE_DUR = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(HERE, "voice.wav")]).toString());
const TAIL = 3.2;
const DURATION = Math.round((VOICE_DUR + TAIL) * 100) / 100;
const r2 = (n) => Math.round(n * 1000) / 1000;

// ---------- Phụ đề: 5–7 từ/cụm, hiện sớm 0.15s, tắt khi hết lời ----------
const LEAD = 0.15;
const MAX = 7;
const LINK = new Set("và là mà của thì với để nhưng những các từ ở có đến cho khi trong bởi hay hoặc nên vì rất chỉ đã sẽ".split(" "));
// Tách cụm dài thành nhóm ≤ 7 từ, ưu tiên ngắt ở dấu câu / trước từ nối; thời gian chia theo số ký tự.
const pieces = [];
// Không có đoạn trích lời nào hiện trên hình → phụ đề chạy suốt
const NO_CAP = new Set([]);
// Cụm giữ nguyên một phụ đề (tách ra sẽ để lại "mình đã có thể" lơ lửng)
const KEEP = new Set([5, 21, 39, 44]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 2: [5, 8], 7: [5, 10], 16: [6, 5], 18: [5, 6, 5], 24: [5, 6], 33: [8, 5], 40: [9, 6], 45: [3, 7, 8] };
for (const c of T.chunks.filter((c) => !NO_CAP.has(c.i))) {
  const words = c.text.split(/\s+/).filter(Boolean);
  const groups = [];
  let g = [];
  words.forEach((w, j) => {
    g.push(w);
    if (KEEP.has(c.i)) return;
    const next = words[j + 1];
    const left = words.length - j - 1;
    if (!next) return;
    // không để rớt 1–2 chữ lẻ sang dòng sau (tối đa 9 từ khi cần)
    if (!canBreak(words, j + 1) && g.length < 11) return; // không tách từ ghép / số đếm / tên riêng giữa 2 phụ đề
    if ((/[,.!?:;]$/.test(w) && g.length >= 3 && left >= 2) || (LINK.has(next.toLowerCase()) && g.length >= 4 && left >= 3) || (g.length >= MAX && left >= 3) || g.length >= 9)
      groups.push(g), (g = []);
  });
  if (FORCE[c.i]) (groups.length = 0), (g = []), ((k) => k < words.length && groups[groups.length - 1].push(...words.slice(k)))(FORCE[c.i].reduce((k, n) => (groups.push(words.slice(k, k + n)), k + n), 0)); // chữ dư (nếu đếm thiếu) gộp vào phụ đề cuối
  // chữ lẻ 1–2 chữ cuối câu: gộp vào cụm trước, không để đứng một mình
  if (g.length) groups.length && g.length <= 2 ? groups[groups.length - 1].push(...g) : groups.push(g);
  const chars = words.join(" ").length;
  let acc = c.start;
  for (const gr of groups) {
    const d = ((gr.join(" ").length + 1) / (chars + 1)) * (c.end - c.start);
    pieces.push({ start: acc, end: acc + d, words: gr });
    acc += d;
  }
}
// Gộp cụm rất ngắn liền nhau (vd "chết," + "chưa trả lời.") khi tổng ≤ 7 từ và nghỉ ≤ 0.45s
const caps = [];
for (const p of pieces) {
  const last = caps.at(-1);
  if (last && !/[.!?…]$/.test(last.words.at(-1)) && ((p.start - last.end <= 0.45 && last.words.length + p.words.length <= MAX && (last.words.length < 3 || p.words.length < 3)) || (p.words.length <= 2 && p.start - last.end <= 1.0 && !/[.!?]$/.test(last.words.at(-1))))) {
    last.words.push(...p.words);
    last.end = p.end;
  } else caps.push({ ...p, words: [...p.words] });
}
caps.forEach((c, i) => {
  c.s = r2(Math.max(0, c.start - LEAD));
  c.e = r2(c.end + 0.1);
  if (i && caps[i - 1].e > c.s) caps[i - 1].e = c.s;
});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const capHtml = caps
  .map((c, i) => `<div class="clip cap" id="cap-${i}" data-start="${c.s}" data-duration="${r2(c.e - c.s)}" data-track-index="2"><p class="cap-in">${breakLines(c.words.join(" "), 26).map(esc).join("<br>")}</p></div>`)
  .join("\n      ");

// ---------- Font (chỉ woff2, giữ unicode-range) ----------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets/fonts"), { recursive: true });
fs.mkdirSync(path.join(out, "assets/vendor"), { recursive: true });
let fonts = "";
for (const [pkg, weights] of [["quicksand", [600, 700]], ["be-vietnam-pro", [500, 600, 700]]]) {
  const dir = path.join(ROOT, "node_modules/@fontsource", pkg);
  for (const w of weights) {
    fonts += fs.readFileSync(path.join(dir, `${w}.css`), "utf8").replace(
      /url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\),\s*url\([^)]+\) format\('woff'\)/g,
      (_, f) => (fs.copyFileSync(path.join(dir, "files", f), path.join(out, "assets/fonts", f)), `url(assets/fonts/${f}) format('woff2')`),
    );
  }
}
fs.copyFileSync(path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"), path.join(out, "assets/vendor/gsap.min.js"));
// Voice: chuẩn hóa -14 LUFS (chuẩn mạng xã hội)
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(HERE, "voice.wav"), "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-ar", "48000", path.join(out, "assets/voice.wav")]);


// ---------- Hình trong thẻ ----------
const K = "#1f3340", ACC = "#f25f5c", TEAL = "#2a9d8f", OLIVE = "#7a9a3a";
const bug = (x, y, c, cls, r = 0) => `<g class="${cls}"><g transform="translate(${x} ${y}) rotate(${r})"><ellipse rx="30" ry="18" fill="${c}" stroke="${K}" stroke-width="4"/><circle cx="-10" cy="-4" r="4" fill="${K}"/><circle cx="8" cy="-4" r="4" fill="${K}"/><path d="M-30 6l-14 8M30 6l14 8" stroke="${K}" stroke-width="4"/></g></g>`;
const ICONS = {
  SOAP: `<rect x="40" y="70" width="180" height="130" rx="16" fill="#8ecae6" stroke="${K}" stroke-width="6"/><text x="130" y="150" text-anchor="middle" font-family="Quicksand" font-weight="700" font-size="34" fill="${K}">XÀ BÔNG</text>${[[60, 50, 18], [110, 30, 24], [175, 45, 16], [210, 70, 12]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${K}" stroke-width="4"/>`).join("")}`,
  MINI_SHIRT: `<svg width="150" height="150" viewBox="-80 -10 160 170"><path d="M-40 10l-36 30 24 22 12-12v100h80v-100l12 12 24-22-36-30c-10 8-22 12-40 12s-30-4-40-12z" fill="#8ecae6" stroke="${K}" stroke-width="5"/>${[[-20, 60], [10, 90], [20, 50], [-10, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${OLIVE}"/>`).join("")}</svg>`,
  LENS: `<defs><clipPath id="lc"><circle cx="320" cy="320" r="270"/></clipPath></defs><circle cx="320" cy="320" r="270" fill="#eaf4f7"/><g clip-path="url(#lc)">${[...Array(10)].map((_, k) => `<path d="M0 ${60 + k * 60}c160-40 320 40 640 0" stroke="#b9d3dc" stroke-width="22" fill="none"/>`).join("")}
    ${[[200, 220, -20], [420, 200, 15], [300, 380, 0], [460, 420, 25], [180, 440, 10]].map(([x, y, r]) => bug(x, y, "#ffb703", "bA", r)).join("")}${[[230, 260, 20], [410, 300, -10], [330, 460, 5], [500, 360, -25], [220, 380, 15]].map(([x, y, r]) => bug(x, y, OLIVE, "bB", r)).join("")}</g>
    <circle cx="320" cy="320" r="270" fill="none" stroke="${K}" stroke-width="18"/><path d="M510 510l100 100" stroke="${K}" stroke-width="36" stroke-linecap="round"/>`,
  THERMO: `<rect x="80" y="20" width="40" height="190" rx="20" fill="#fff" stroke="${K}" stroke-width="6"/><rect id="mercury" x="90" y="60" width="20" height="150" fill="${ACC}"/><circle cx="100" cy="220" r="32" fill="${ACC}" stroke="${K}" stroke-width="6"/><path d="M150 60c0 20 20 20 20 40s-20 20-20 40" stroke="#5b8db3" stroke-width="6" fill="none"/><text x="100" y="20" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="22" fill="${K}">nóng ẩm</text>`,
  GROW: `<rect x="10" y="10" width="360" height="240" rx="20" fill="#eaf4f7"/>${[[60, 80], [130, 60], [200, 90], [270, 70], [330, 100], [90, 150], [170, 160], [250, 150], [320, 180], [60, 210], [150, 220], [240, 210]].map(([x, y], k) => `<g class="gB"><circle cx="${x}" cy="${y}" r="20" fill="${OLIVE}" stroke="${K}" stroke-width="3"/></g>`).join("")}
    ${[60, 180, 300].map((x) => `<g class="gS"><path d="M${x} 250c-14-20 14-34 0-54s14-34 0-54" stroke="#556b2f" stroke-width="8" fill="none" stroke-linecap="round"/></g>`).join("")}`,
  REWASH: `<rect x="40" y="30" width="140" height="170" rx="16" fill="#fff" stroke="${K}" stroke-width="6"/><circle cx="110" cy="125" r="50" fill="#8ecae6" stroke="${K}" stroke-width="6"/><path d="M180 60c30 10 30 40 10 50l6-20" stroke="${TEAL}" stroke-width="6" fill="none"/><path d="M20 210h180" stroke="${K}" stroke-width="5"/>`,
  PERFUME: `<rect x="70" y="80" width="80" height="120" rx="18" fill="#ffc8dd" stroke="${K}" stroke-width="6"/><rect x="95" y="50" width="30" height="30" fill="${K}"/>${[[150, 50], [175, 30], [190, 60], [165, 80]].map(([x, y]) => `<circle class="pf" cx="${x}" cy="${y}" r="9" fill="#ffc8dd" stroke="${K}" stroke-width="2"/>`).join("")}`,
  SOFT: `<rect x="320" y="200" width="160" height="160" rx="20" fill="#cfe6ef" stroke="${K}" stroke-width="6"/><path d="M340 260c30 20 90 20 120 0" stroke="${K}" stroke-width="5" fill="none"/>
    <g id="bottle"><rect x="100" y="120" width="100" height="160" rx="22" fill="#cdb4db" stroke="${K}" stroke-width="6"/><rect x="125" y="90" width="50" height="34" rx="6" fill="${K}"/><text x="150" y="210" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="800" font-size="20" fill="${K}">NƯỚC XẢ</text></g>
    <path id="pour" d="M150 90C220 40 330 100 380 220" stroke="#cdb4db" stroke-width="14" fill="none" stroke-linecap="round"/>
    <g id="xSoft"><circle cx="260" cy="190" r="60" fill="#fff" stroke="${ACC}" stroke-width="10"/><path d="M230 160l60 60M290 160l-60 60" stroke="${ACC}" stroke-width="12" stroke-linecap="round"/></g>`,
};

let html = fs
  .readFileSync(path.join(HERE, "template.html"), "utf8")
  .replace("{{FONTS}}", fonts)
  .replace("{{CAPTIONS}}", capHtml)
  .replaceAll("{{DURATION}}", String(DURATION))
  .replace("{{SFX}}", fs.existsSync(path.join(HERE, "sfx.json")) ? ((j) => (Array.isArray(j) ? sfxHtml(j, out) : sfxHtml(j.cues, out, j)))(JSON.parse(fs.readFileSync(path.join(HERE, "sfx.json"), "utf8"))) : "")
  .replace("{{VOICE_DUR}}", String(r2(VOICE_DUR)))
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  ;
for (const [k, v] of Object.entries(ICONS)) html = html.replaceAll(`{{${k}}}`, v);
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
