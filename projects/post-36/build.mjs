#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-36/build.mjs [--no-render]
// Kết quả: build/post-36/index.html (+ output.mp4)
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
const KEEP = new Set([20, 28, 35, 40]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 32: [6, 8, 6], 9: [8, 9], 10: [6, 5], 12: [8, 9], 14: [6, 6], 17: [9, 6, 8], 19: [6, 7], 22: [4, 8], 23: [8, 6, 10], 25: [7, 8], 27: [5, 6], 29: [9, 5] };
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
for (const [pkg, weights] of [["grandstander", [700, 800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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


// ---------- Icon + hình phụ cho thẻ ----------
const CR = "#fdf6e3", ACC = "#ff5c8a", K = "#0b1b1a";
const ic = (body, sz = 70) => `<svg width="${sz}" height="${sz}" viewBox="0 0 64 64" fill="none" stroke="${CR}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const mosq = (s = 1) => `<g transform="scale(${s})"><path d="M-6 6l-22 30M2 8l-6 34M10 6l14 30M-2 4l-40 18M14 4l30 22" stroke="${CR}" stroke-width="3" fill="none"/><ellipse cx="-26" cy="0" rx="30" ry="9" fill="#222" stroke="${CR}" stroke-width="2"/><path d="M-46 -4v8M-36 -6v12M-26 -7v14M-16 -6v12" stroke="#f4f4f4" stroke-width="3"/><circle cx="10" cy="-2" r="10" fill="#222" stroke="${CR}" stroke-width="2"/><circle cx="20" cy="-4" r="7" fill="#222"/><path d="M26 -2l26 10" stroke="${CR}" stroke-width="3"/><circle cx="22" cy="-7" r="2" fill="#f4f4f4"/><g class="wg"><ellipse cx="-12" cy="-22" rx="22" ry="11" fill="#dff4ff" fill-opacity=".55" stroke="#dff4ff" stroke-width="2" transform="rotate(-20 -12 -22)"/></g></g>`;
const bars = [0.2, 0.28, 1, 0.16, 0.33, 0.24].map((v, i) => { const x = 95 + i * 112, h = 250 * v, a = i === 2; return `<g transform="translate(${x} 400)"><rect class="bar" ${a ? 'id="barA"' : ""} x="0" y="${-h}" width="76" height="${h}" rx="10" fill="${a ? ACC : "#4e7a74"}"/><circle cx="38" cy="34" r="13" fill="${a ? ACC : "#9fc2bc"}"/><path d="M20 66q18-22 36 0" stroke="${a ? ACC : "#9fc2bc"}" stroke-width="8" fill="none"/>${a ? `<text id="yrA" x="38" y="${-h - 18}" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="28" fill="${CR}">năm đầu</text>` : ""}</g>`; }).join("");
const mol = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><g class="mol"><path d="M-70 10l24-16 24 16 24-16" stroke="#7a4a2a" stroke-width="8" fill="none" stroke-linecap="round"/><circle cx="2" cy="-6" r="14" fill="#555"/><circle cx="26" cy="-34" r="13" fill="${ACC}"/><circle cx="34" cy="14" r="13" fill="${ACC}"/><path d="M2 -6L26 -34M2 -6L34 14" stroke="#555" stroke-width="7"/><text x="0" y="62" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="800" font-size="26" fill="#7a2a44">COOH</text></g></g>`;
const ICONS = {
  IC_UNI: ic(`<path d="M6 24L32 10l26 14z"/><path d="M12 28v20M24 28v20M40 28v20M52 28v20"/><path d="M6 54h52"/>`),
  IC_JOURNAL: ic(`<path d="M14 8h30l8 8v40H14z"/><path stroke="${ACC}" d="M22 24h20M22 32h20M22 40h12"/>`),
  IC_SPRAY: ic(`<rect x="20" y="22" width="22" height="34" rx="6"/><path d="M26 22v-8h10v8M36 12h8"/><path stroke="${ACC}" d="M50 8l6-4M50 14h8M50 20l6 4"/>`),
  IC_SLEEVE: ic(`<path d="M18 10h28l10 14-8 6-4-6v32H20V24l-4 6-8-6z"/><path stroke="${ACC}" d="M8 24l-2 26M56 24l2 26"/>`),
  IC_WATER: ic(`<path d="M12 22h40l-4 32H16z"/><path stroke="${ACC}" d="M20 34c4-4 8 4 12 0s8 4 12 0"/><path d="M32 4v10"/>`),
  SWARM: [...Array(10)].map((_, i) => `<g transform="translate(${370 + (i % 5) * 22} ${60 + Math.floor(i / 5) * 50})"><g class="sw">${mosq(0.55)}</g></g>`).join(""),
  BARS: bars,
  MOLS: [[200, 200, -10], [420, 170, 15], [320, 300, 0], [170, 380, 20], [470, 360, -15], [300, 470, 10], [520, 250, 5]].map(([x, y, r]) => mol(x, y, r)).join(""),
  MQ_BIG: `<g transform="translate(220 120)">${mosq(3.2)}</g>`,
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
