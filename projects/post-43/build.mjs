#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-43/build.mjs [--no-render]
// Kết quả: build/post-43/index.html (+ output.mp4)
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
const KEEP = new Set([5, 32, 33]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 4: [6, 7], 8: [6, 7], 10: [6, 5, 9], 11: [6, 6, 5], 14: [6, 8], 15: [7, 6, 6], 16: [5, 5, 6], 22: [6, 8], 24: [9, 8], 31: [5, 10], 35: [5, 6] };
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
for (const [pkg, weights] of [["signika", [600, 700]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
const K = "#231942", ACC = "#e85d75", TEAL = "#2a9d8f";
const wave = (amp, freq, w, c, cls, harm = 0) => { let d = ""; for (let x = 0; x <= 740; x += 4) { const t = x / 740; const y = 75 - amp * Math.sin(t * Math.PI * freq) * Math.sin(t * Math.PI) - harm * Math.sin(t * Math.PI * freq * 5) * Math.sin(t * Math.PI); d += `${x ? "L" : "M"}${x + 10} ${y.toFixed(1)}`; } return `<path class="${cls}" d="${d}" stroke="${c}" stroke-width="${w}" fill="none" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" stroke-linejoin="round"/>`; };
const ic = (body) => `<svg width="70" height="70" viewBox="0 0 64 64" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const head = (x, y, s, flip = 1) => `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})"><circle r="60" fill="#f3c9a5" stroke="${K}" stroke-width="5"/><path d="M-60 -10c0-40 30-60 60-60s60 20 60 50c-30-20-80-20-120 10z" fill="#3b2a20"/><circle cx="30" cy="-6" r="6" fill="${K}"/><circle cx="-14" cy="6" r="13" fill="#e8b48f" stroke="${K}" stroke-width="4"/></g>`;
const ICONS = {
  WAVE_IN: wave(60, 6, 12, ACC, "wvA"),
  WAVE_REC: wave(26, 14, 5, TEAL, "wvB", 10),
  EQ: [...Array(10)].map((_, k) => { const base = [70, 80, 90, 100, 110, 120, 110, 100, 90, 80][k], extra = [110, 90, 60, 30, 0, 0, 0, 0, 0, 0][k]; const x = 40 + k * 70; return `<rect class="eqb" x="${x}" y="${270 - base}" width="46" height="${base}" rx="8" fill="${TEAL}"/>${extra ? `<rect class="eqx" x="${x}" y="${270 - base - extra}" width="46" height="${extra}" rx="8" fill="${ACC}"/>` : ""}`; }).join("") +
    `<path d="M20 272H740" stroke="${K}" stroke-width="5"/><text x="40" y="310" font-family="Be Vietnam Pro" font-weight="700" font-size="26" fill="${ACC}">âm trầm ↑</text><text x="740" y="310" text-anchor="end" font-family="Be Vietnam Pro" font-weight="700" font-size="26" fill="${K}">âm cao</text>`,
  IC_MIC: ic(`<rect x="22" y="6" width="20" height="34" rx="10"/><path d="M14 30c0 12 8 18 18 18s18-6 18-18M32 48v10M22 58h20"/>`),
  IC_DIST: ic(`<path stroke="${ACC}" d="M6 32h52M6 24v16M58 24v16"/><path d="M18 32l-6-6M18 32l-6 6M46 32l6-6M46 32l6 6"/>`),
  IC_ROOM: ic(`<path d="M6 54V18l26-12 26 12v36z"/><path stroke="${ACC}" d="M24 34a8 8 0 0 1 16 0M18 30a14 14 0 0 1 28 0"/>`),
  IC_SPK: ic(`<rect x="14" y="6" width="36" height="52" rx="6"/><circle cx="32" cy="20" r="6"/><circle stroke="${ACC}" cx="32" cy="40" r="10"/>`),
  P_IN: `${head(120, 120, 1.4)}<path d="M180 150C240 150 250 60 170 40" stroke="${TEAL}" stroke-width="8" fill="none" stroke-dasharray="14 10"/><path d="M130 160C120 140 110 130 100 125" stroke="${ACC}" stroke-width="10" fill="none"/><circle cx="100" cy="126" r="10" fill="${ACC}"/><text x="150" y="225" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${K}">bạn</text>`,
  P_OUT: `${head(70, 120, 1.1)}${head(240, 120, 1.1, -1)}<path d="M110 130C150 100 180 100 205 125" stroke="${TEAL}" stroke-width="8" fill="none" stroke-dasharray="14 10"/><text x="70" y="225" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${K}">bạn</text><text x="240" y="225" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${K}">người khác</text>`,
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
