#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-41/build.mjs [--no-render]
// Kết quả: build/post-41/index.html (+ output.mp4)
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
const KEEP = new Set([15, 16, 27, 48, 60, 67]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 4: [8, 4], 5: [6, 9], 6: [8, 10], 12: [7, 10], 24: [10, 5], 30: [9, 6], 33: [10, 5], 35: [5, 8, 7, 4], 40: [8, 6], 43: [8, 9], 46: [7, 8], 49: [4, 8], 51: [7, 10], 53: [5, 7, 6, 7], 63: [3, 6, 8], 68: [7, 6] };
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
for (const [pkg, weights] of [["alegreya", [700, 800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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


// ---------- Icon + hình trong thẻ ----------
const CR = "#f6efe2", ACC = "#ffb703", K = "#121826", RED = "#ff6b6b";
const ic = (body, sz = 150, vb = 100) => `<svg width="${sz}" height="${sz}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="${CR}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto">${body}</svg>`;
const icS = (body) => ic(body, 70, 64).replace('stroke-width="5"', 'stroke-width="4"');
const PAL = ["#e76f51", "#2a9d8f", "#e9c46a", "#8ab4f8", "#c77dff", "#f4a261"];
const pp = (x, y, i, s = 1, cls = "") => `<g class="${cls}"><g transform="translate(${x} ${y}) scale(${s})"><circle cy="-46" r="11" fill="#f1c7a3"/><path d="M-11 0l2-34h18l2 34z" fill="${PAL[i % 6]}"/></g></g>`;
const ICONS = {
  IC_FLAG: ic(`<path d="M20 90V10"/><rect x="24" y="14" width="20" height="40" fill="#2a4d9c" stroke="none"/><rect x="44" y="14" width="20" height="40" fill="${CR}" stroke="none"/><rect x="64" y="14" width="20" height="40" fill="#d62828" stroke="none"/>`),
  IC_LAW: ic(`<path d="M22 10h44l14 14v66H22z" fill="#efe2c4" stroke="${K}"/><path stroke="#b23a3a" d="M32 40h36M32 52h36M32 64h24"/><circle cx="66" cy="76" r="9" fill="#b23a3a" stroke="none"/>`),
  STEPS: [["1791", "Cấm liên kết", "#ff6b6b"], ["1864", "Hết bị coi là tội", ACC], ["1884", "Công đoàn hợp pháp", "#2a9d8f"]].map(([y, t, c], i) => `<g class="stp"><rect x="${30 + i * 250}" y="${300 - i * 90}" width="240" height="${100 + i * 90}" fill="${c}" opacity=".9" stroke="${CR}" stroke-width="4"/><text x="${150 + i * 250}" y="${350 - i * 90}" text-anchor="middle" font-family="Alegreya" font-weight="800" font-size="48" fill="${K}">${y}</text><text x="${150 + i * 250}" y="${392 - i * 90}" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="22" fill="${K}">${t}</text></g>`).join("") +
    `<g class="stI"><circle cx="150" cy="210" r="40" fill="#1a2336" stroke="${CR}" stroke-width="4"/><path d="M128 210l12-18 10 14 10-20 12 24" stroke="${RED}" stroke-width="6" fill="none"/><text x="235" y="200" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${CR}">xung đột</text></g><g class="stI"><circle cx="400" cy="120" r="40" fill="#1a2336" stroke="${CR}" stroke-width="4"/><path d="M384 102h24l8 8v26h-32z" stroke="${ACC}" stroke-width="5" fill="none"/><text x="450" y="110" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${CR}">đổi luật</text></g>`,
  CROWD: [...Array(84)].map((_, k) => { const c = k % 14, r = Math.floor(k / 14); return `<g class="cd">${pp(40 + c * 54 + (r % 2) * 20, 100 + r * 46, k, 0.9)}</g>`; }).join("") + `<text x="390" y="325" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="#a9b6cc">mỗi hình người tượng trưng cho rất nhiều người</text>`,
  TABLE: `<rect x="120" y="250" width="560" height="40" rx="10" fill="#8d6e4f" stroke="${CR}" stroke-width="4"/><path d="M180 290v100M620 290v100" stroke="${CR}" stroke-width="10"/>
    <g class="ng">${pp(170, 250, 0, 2.2)}${pp(260, 250, 3, 2.2)}<text x="215" y="60" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="28" fill="${CR}">người lao động</text></g>
    <g class="ng">${pp(560, 250, 4, 2.2)}${pp(650, 250, 1, 2.2)}<text x="605" y="60" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="28" fill="${CR}">bên quyết định</text></g>
    <g class="ng"><rect x="330" y="180" width="140" height="70" rx="6" fill="#efe2c4" stroke="${K}" stroke-width="3"/><text x="400" y="212" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="800" font-size="20" fill="${K}">Lương ↑</text><text x="400" y="238" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="16" fill="${K}">Điều kiện lao động</text></g>
    <g id="hand"><path d="M300 150q50-20 100 0q50 20 100 0" stroke="${ACC}" stroke-width="10" fill="none"/></g>`,
  LEVER: `<path d="M400 300l-40 80h80z" fill="#a9b6cc"/><g id="lvBar"><rect x="100" y="285" width="600" height="30" rx="10" fill="${ACC}"/>${[0, 1, 2, 3, 4].map((k) => pp(140 + k * 40, 285, k, 1.6)).join("")}<rect x="560" y="205" width="140" height="80" fill="#4a5a7a" stroke="${CR}" stroke-width="4"/><path d="M550 205l80-50 80 50z" fill="#4a5a7a" stroke="${CR}" stroke-width="4"/></g>
    <g id="ear"><circle cx="640" cy="120" r="56" fill="#1a2336" stroke="${ACC}" stroke-width="5"/><path d="M620 112a20 20 0 0 1 40 0c0 14-14 16-16 28-1 8-8 12-14 10" stroke="${ACC}" stroke-width="6" fill="none"/></g>
    <text x="220" y="150" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="26" fill="${CR}">sức ép tập thể</text><text x="630" y="420" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="26" fill="${CR}">người có quyền quyết định</text>`,
  IC_PEACE: ic(`<path d="M30 90V40M70 90V40"/><rect x="14" y="14" width="34" height="28" rx="4"/><rect x="54" y="14" width="34" height="28" rx="4"/><path stroke="${ACC}" d="M50 66c-8-10 4-18 0-26"/>`),
  IC_STRIKE: ic(`<circle cx="50" cy="50" r="26"/><path d="M50 18v-8M50 82v8M18 50h-8M82 50h8"/><rect x="38" y="38" width="8" height="24" fill="${ACC}" stroke="none"/><rect x="54" y="38" width="8" height="24" fill="${ACC}" stroke="none"/>`),
  IC_BREAK: ic(`<rect x="16" y="16" width="68" height="68" rx="4" stroke="${RED}"/><path stroke="${RED}" d="M50 16l-8 22 14 8-10 16 8 22M42 38l-22 6M56 46l26-8"/>`),
  PRO: `${[0, 1, 2, 3].map((k) => pp(60 + k * 60, 200, k, 2)).join("")}<path d="M150 70v-50M150 20l20 12" stroke="${ACC}" stroke-width="6"/><circle cx="150" cy="100" r="34" fill="none" stroke="${ACC}" stroke-width="6"/><path d="M134 100l10 12 22-24" stroke="${ACC}" stroke-width="6" fill="none"/>`,
  CON: `<rect x="40" y="40" width="220" height="90" rx="20" fill="#e9eef5" stroke="${CR}" stroke-width="4"/>${[0, 1, 2].map((k) => `<rect x="${60 + k * 66}" y="58" width="50" height="40" rx="6" fill="#8ab4f8"/>`).join("")}<path d="M60 160l180-150" stroke="${RED}" stroke-width="10"/>${pp(90, 210, 2, 1.6)}${pp(210, 210, 5, 1.6)}<circle cx="250" cy="150" r="20" fill="${CR}"/><path d="M250 150v-12M250 150l8 6" stroke="${K}" stroke-width="4"/>`,
  IC_ORG: icS(`<rect x="6" y="10" width="52" height="44" rx="6"/><path stroke="${ACC}" d="M16 24h32M16 34h32M16 44h20"/>`),
  IC_IMPACT: icS(`<path d="M8 50l14-14 12 10 22-26"/><path stroke="${ACC}" d="M44 20h12v12"/>`),
  IC_DEBATE: icS(`<path d="M6 12h30v20H18l-8 8v-8H6z"/><path stroke="${ACC}" d="M28 30h30v18h-4v8l-8-8H28z"/>`),
  CLIP: `<rect width="300" height="420" rx="16" fill="#26324a"/>${[...Array(12)].map((_, k) => `<g class="shout">${pp(30 + (k % 6) * 48, 260 + Math.floor(k / 6) * 90, k, 1.6)}</g>`).join("")}<path d="M60 120l20-30M150 100v-40M240 120l-20-30" stroke="${RED}" stroke-width="8" stroke-linecap="round"/><rect x="20" y="370" width="260" height="10" rx="5" fill="#4a5a7a"/><rect x="20" y="370" width="110" height="10" rx="5" fill="${RED}"/><path d="M130 160l50 30-50 30z" fill="${CR}" opacity=".8"/>`,
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
