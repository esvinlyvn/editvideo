#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-40/build.mjs [--no-render]
// Kết quả: build/post-40/index.html (+ output.mp4)
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
const KEEP = new Set([31]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 1: [6, 5], 3: [5, 7], 12: [8, 4], 22: [6, 5], 23: [6, 5], 30: [6, 6], 33: [5, 8], 34: [6, 6], 36: [7, 6, 8], 37: [6, 6] };
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
for (const [pkg, weights] of [["kanit", [600, 800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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


// ---------- Hình phụ (bánh xe nhỏ trong thẻ) ----------
const K = "#141414", ACC = "#d7263d";
const spk = (r, w = 10) => [...Array(6)].map((_, k) => `<path d="M0 0L0 ${-r}" stroke="${K}" stroke-width="${w}" stroke-linecap="round" transform="rotate(${k * 60})"/>`).join("");
const mini = (r, inner = "", rot = 0, id = "", cls = "") => `<circle r="${r}" fill="${K}"/><circle r="${r * 0.78}" fill="#e9e4d4" stroke="${K}" stroke-width="4"/><g ${id ? `id="${id}"` : ""} class="${cls}" transform="rotate(${rot})">${spk(r * 0.76, Math.max(4, r / 10))}${inner}</g><circle r="${r * 0.15}" fill="${K}"/>`;
const ICONS = {
  FR4: [0, 22, 44, 66].map((a) => `<div class="fr"><svg width="230" height="230" viewBox="-115 -115 230 230">${mini(95, "", a)}</svg></div>`).join(""),
  TICKS30: [...Array(31)].map((_, k) => `<path class="t30" d="M${20 + k * 24} 90V${k % 5 ? 60 : 40}" stroke="${k % 5 ? K : ACC}" stroke-width="${k % 5 ? 5 : 8}"/>`).join(""),
  WHEEL_A: mini(130, `<path class="mkA" d="M0 0L0 -99" stroke="${ACC}" stroke-width="14" stroke-linecap="round" opacity="0"/>`),
  WHEEL_B: `<path id="ghostB" d="M0 0L0 -99" stroke="${ACC}" stroke-width="8" stroke-dasharray="10 8" opacity="0" transform="rotate(60)"/>` + mini(130, `<path class="mkB" d="M0 0L0 -99" stroke="${ACC}" stroke-width="14" stroke-linecap="round" opacity="0"/>`, 0, "spkB") + `<path id="arcB" d="M0 -118A118 118 0 0 1 102 -59" fill="none" stroke="${ACC}" stroke-width="10" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><g id="backB" opacity="0"><path d="M60 -128A140 140 0 0 0 0 -140" fill="none" stroke="${ACC}" stroke-width="12"/><path d="M-6 -140l24-16v32z" fill="${ACC}"/></g>`,
  WHEEL_S: mini(130, "", 0, "spkS"),
  MISS: `<path d="M40 200H740" stroke="${K}" stroke-width="6"/>${[110, 390, 670].map((x, i) => `<g transform="translate(${x} 100)">${mini(62, "", i * 55)}</g><path d="M${x} 180v40" stroke="${ACC}" stroke-width="8"/><text x="${x}" y="252" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="700" font-size="24" fill="${K}">hình ${i + 1}</text>`).join("")}
    ${[250, 530].map((x) => `<g class="gapZ"><rect x="${x - 60}" y="40" width="120" height="150" rx="12" fill="${ACC}" opacity=".18"/><text x="${x}" y="125" text-anchor="middle" font-family="Be Vietnam Pro" font-weight="800" font-size="24" fill="${ACC}">bỏ lỡ</text></g>`).join("")}
    <path id="missArc" d="M110 30C250 -10 530 -10 670 30" fill="none" stroke="${ACC}" stroke-width="6" stroke-dasharray="1" pathLength="1" stroke-dashoffset="1"/>`,
  WAGON: `<path d="M120 170h320v-50H120z" fill="#b5651d" stroke="${K}" stroke-width="6"/><path d="M120 120c0-90 320-90 320 0z" fill="#fffbea" stroke="${K}" stroke-width="6"/><path d="M200 120c0-60 0-70 0-70M280 120V45M360 120c0-60 0-70 0-70" stroke="${K}" stroke-width="4"/><path d="M440 160l90 0" stroke="${K}" stroke-width="8"/>
    <g id="wagonWheels"><g transform="translate(180 210)"><circle r="70" fill="none" stroke="${K}" stroke-width="12"/><g class="wspk">${[...Array(12)].map((_, k) => `<path d="M0 0L0 -64" stroke="${K}" stroke-width="6" transform="rotate(${k * 30})"/>`).join("")}</g><circle r="12" fill="${K}"/></g><g transform="translate(390 220)"><circle r="60" fill="none" stroke="${K}" stroke-width="12"/><g class="wspk">${[...Array(12)].map((_, k) => `<path d="M0 0L0 -54" stroke="${K}" stroke-width="6" transform="rotate(${k * 30})"/>`).join("")}</g><circle r="12" fill="${K}"/></g></g>`,
  CINE: `<rect width="760" height="420" fill="#1f2a36"/><rect y="300" width="760" height="120" fill="#333"/><path d="M0 360H760" stroke="#fffbea" stroke-width="8" stroke-dasharray="60 60"/>
    ${[...Array(8)].map((_, k) => `<path d="M${k * 110 - 40} ${150 + (k % 3) * 40}h70" stroke="#fffbea" stroke-width="5" opacity=".5"/>`).join("")}
    <g id="cineCar"><path d="M-160 300v-60c0-14 10-20 24-22l50-10 40-50h120l40 50 40 6c14 2 22 12 22 26v60z" fill="${ACC}" stroke="#000" stroke-width="5"/>${[-90, 90].map((x) => `<g transform="translate(${x} 300)"><circle r="42" fill="#111"/><circle r="32" fill="#e9e4d4"/><g class="cwS">${[...Array(6)].map((_, k) => `<path d="M0 0L0 -30" stroke="#111" stroke-width="6" transform="rotate(${k * 60})"/>`).join("")}</g></g>`).join("")}</g>
    <g id="opCam"><rect x="60" y="330" width="120" height="70" rx="10" fill="#111" stroke="#fffbea" stroke-width="4"/><circle cx="85" cy="320" r="22" fill="none" stroke="#fffbea" stroke-width="5"/><circle cx="140" cy="320" r="22" fill="none" stroke="#fffbea" stroke-width="5"/></g>
    <path id="sweat" d="M200 300q12 20 0 34q-12-14 0-34z" fill="#5cc8ff" opacity="0"/>`,
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
