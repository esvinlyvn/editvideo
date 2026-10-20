#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-44/build.mjs [--no-render]
// Kết quả: build/post-44/index.html (+ output.mp4)
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
const KEEP = new Set([6, 7, 14, 20, 25, 51]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 9: [10, 7], 11: [7, 7], 17: [9, 5], 23: [6, 10], 27: [5, 8, 5], 31: [9, 5, 7], 42: [6, 5, 7], 48: [4, 8] };
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
for (const [pkg, weights] of [["itim", [400]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
const K = "#3a1f1d", ACC = "#d00000", COLD = "#1d7fbf";
const slice = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-60 0c20-26 100-30 120-6 8 12-6 22-30 24-30 4-70 6-86-4z" fill="#e5989b" stroke="${K}" stroke-width="5"/><path d="M-40 -6c20-8 50-8 70 0" stroke="#fff" stroke-width="6" fill="none"/></g>`;
const ic = (body) => `<svg width="70" height="70" viewBox="0 0 64 64" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  MEAT_BTN: `${slice(150, 150, 2.4)}<g id="pwrBtn"><circle cx="300" cy="90" r="52" fill="#fff" stroke="${K}" stroke-width="7"/><path d="M300 60v30" stroke="${ACC}" stroke-width="10" stroke-linecap="round"/><path d="M278 74a32 32 0 1 0 44 0" stroke="${ACC}" stroke-width="10" fill="none" stroke-linecap="round"/></g><text x="300" y="185" text-anchor="middle" font-family="Itim" font-size="34" fill="${ACC}">TẮT BẾP?</text>`,
  MORE: `<text x="20" y="70" font-family="Be Vietnam Pro" font-weight="700" font-size="30" fill="${K}">1 dĩa</text>${slice(170, 58, 0.8)}<rect class="mb1" x="260" y="38" width="200" height="40" rx="20" fill="#f4a261"/><text x="480" y="70" font-family="Be Vietnam Pro" font-weight="700" font-size="28" fill="${K}">sôi lại nhanh</text>
    <text x="20" y="200" font-family="Be Vietnam Pro" font-weight="700" font-size="30" fill="${K}">3 dĩa</text>${slice(150, 190, 0.6)}${slice(190, 175, 0.6)}${slice(220, 200, 0.6)}<rect class="mb3" x="260" y="170" width="440" height="40" rx="20" fill="${ACC}"/><text x="700" y="250" text-anchor="end" font-family="Be Vietnam Pro" font-weight="700" font-size="28" fill="${ACC}">lâu sôi lại hơn</text>
    <path d="M260 290h440" stroke="${K}" stroke-width="4"/><text x="480" y="325" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="600" font-size="24" fill="#8a5a44">thời gian chờ sôi (minh họa)</text>`,
  IC_TYPE: ic(`<path d="M10 40c4-16 24-24 40-16 8 4 8 14-2 18-10 6-30 8-38-2z"/><path stroke="${ACC}" d="M20 34c8-4 18-4 24 0"/>`),
  IC_THICK: ic(`<rect x="10" y="26" width="44" height="10" rx="3"/><rect x="10" y="42" width="44" height="18" rx="3" stroke="${ACC}"/><path d="M58 42v18M56 42h4M56 60h4"/>`),
  IC_PROBE: ic(`<path d="M30 6v34"/><circle cx="30" cy="48" r="10" stroke="${ACC}"/><path d="M8 54c8-10 36-10 48 0"/>`),
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
