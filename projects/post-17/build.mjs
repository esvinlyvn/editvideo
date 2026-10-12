#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-17/build.mjs [--no-render]
// Kết quả: build/post-17/index.html (+ output.mp4)
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
const TAIL = 2.3;
const DURATION = Math.round((VOICE_DUR + TAIL) * 100) / 100;
const r2 = (n) => Math.round(n * 1000) / 1000;

// ---------- Phụ đề: 5–7 từ/cụm, hiện sớm 0.15s, tắt khi hết lời ----------
const LEAD = 0.15;
const MAX = 7;
const LINK = new Set("và là mà của thì với để nhưng những các từ ở có đến cho khi trong bởi hay hoặc nên vì rất chỉ đã sẽ hồi".split(" "));
// Tách cụm dài thành nhóm ≤ 7 từ, ưu tiên ngắt ở dấu câu / trước từ nối; thời gian chia theo số ký tự.
const pieces = [];
// Lời đã hiện thành chữ trên hình → không chạy phụ đề trùng lặp: "Ủa? Xe tao đâu?" · Sáu chào · biển "B2 · Dãy C · Cột 17"
const NO_CAP = new Set([4, 5, 11, 12, 13, 20, 21, 22, 23]);
for (const c of T.chunks.filter((c) => !NO_CAP.has(c.i))) {
  const words = c.text.split(/\s+/).filter(Boolean);
  const groups = [];
  let g = [];
  words.forEach((w, j) => {
    g.push(w);
    const next = words[j + 1];
    const left = words.length - j - 1;
    if (!next) return;
    // không để rớt 1–2 chữ lẻ sang dòng sau (tối đa 9 từ khi cần)
    if (!canBreak(words, j + 1) && g.length < 11) return; // không tách từ ghép / số đếm / tên riêng giữa 2 phụ đề
    if ((/[,.!?:;]$/.test(w) && g.length >= 3 && left >= 2) || (LINK.has(next.toLowerCase()) && g.length >= 4 && left >= 3 && words.length > 8) || (g.length >= MAX && left >= 3) || g.length >= 9)
      groups.push(g), (g = []);
  });
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
  if (last && ((p.start - last.end <= 0.45 && last.words.length + p.words.length <= MAX && (last.words.length < 3 || p.words.length < 3)) || (p.words.length <= 2 && p.start - last.end <= 1.0 && !/[.!?]$/.test(last.words.at(-1))))) {
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
for (const [pkg, weights] of [["oswald", [500, 600, 700]], ["be-vietnam-pro", [500, 600, 700, 800]]]) {
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

// ---------- Thế giới: bãi xe tầng hầm B2 nhìn từ trên xuống (sinh bằng code) ----------
// Lối đi ngang ở 5 dãy A–E, mỗi lối có 1 hàng xe phía trên và 1 hàng phía dưới; cột bê tông giữa 2 hàng quay lưng nhau.
// Cột đánh số liên tục theo dãy: A 1–6, B 7–12, C 13–18 … → xe của "tao" đậu ngay cột C17 (dãy C, cột thứ 5).
const W = 2400, AISLES = [360, 1080, 1800, 2520, 3240], ROWS = "ABCDE";
const BAY = 120, X0 = 240, NB = 16;
const car = (cx, cy, up, cls = "cb", fill = "#0a0d15") =>
  `<g class="${cls}" transform="translate(${cx} ${cy})${up ? "" : " rotate(180)"}"><rect x="-44" y="-94" width="88" height="188" rx="26" fill="${fill}" stroke="#34405e" stroke-width="4"/><rect x="-33" y="-58" width="66" height="40" rx="10" fill="#3a4870"/><rect x="-33" y="34" width="66" height="26" rx="8" fill="#273352"/><rect x="-46" y="-80" width="8" height="16" rx="3" fill="#34405e"/><rect x="38" y="-80" width="8" height="16" rx="3" fill="#34405e"/></g>`;
let g = `<rect x="-400" y="-600" width="${W + 800}" height="5200" fill="#14213d"/>`;
g += `<rect x="0" y="0" width="${W}" height="3800" fill="#182746"/>`;
AISLES.forEach((y, i) => {
  // vạch lối đi + mũi tên
  g += `<path d="M120 ${y + 130}H${W - 120}" stroke="#f2b134" stroke-width="6" stroke-dasharray="40 40" opacity=".55"/>`;
  for (let x = 420; x < W - 200; x += 600) g += `<path d="M${x} ${y + 105}l40 25-40 25z" fill="#f2b134" opacity=".6"/>`;
  g += `<text x="60" y="${y + 150}" font-family="Oswald" font-weight="700" font-size="56" fill="#f2b134" transform="rotate(-90 60 ${y + 130})" text-anchor="middle">DÃY ${ROWS[i]}</text>`;
  for (const [top, up] of [[y - 230, false], [y + 260, true]]) {
    for (let b = 0; b <= NB; b++) g += `<path d="M${X0 + b * BAY} ${top}v230" stroke="#f2b134" stroke-width="5" opacity=".8"/>`;
    for (let b = 0; b < NB; b++) {
      const cx = X0 + b * BAY + 60, cy = top + 115;
      const mine = ROWS[i] === "C" && up && b === 12;
      if (mine) g += car(cx, cy, up, "mine", "#f2b134");
      else if ((i * 7 + b * 3 + (up ? 5 : 0)) % 11 !== 0) g += car(cx, cy, up, ROWS[i] === "C" && up && b === 11 ? "cb nb" : "cb");
    }
  }
  // cột bê tông ở ranh giữa hàng dưới của dãy này và hàng trên của dãy sau
  const py = y + 490;
  for (let j = 0; j < 6; j++) {
    const px = X0 + j * 3 * BAY, n = i * 6 + j + 1;
    g += `<g class="pl" id="pl-${ROWS[i]}${n}"><rect x="${px - 30}" y="${py - 30}" width="60" height="60" rx="8" fill="#3a4870" stroke="#f2b134" stroke-width="4"/><text x="${px}" y="${py + 12}" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="30" fill="#f4efe1">${ROWS[i]}${n}</text></g>`;
  }
});
const svg = (f, w) => fs.readFileSync(path.join(HERE, "art", f), "utf8").replace('width="520" height="520"', `width="${w}" height="${w}"`);

const html = fs
  .readFileSync(path.join(HERE, "template.html"), "utf8")
  .replace("{{FONTS}}", fonts)
  .replace("{{CAPTIONS}}", capHtml)
  .replaceAll("{{DURATION}}", String(DURATION))
  .replace("{{SFX}}", fs.existsSync(path.join(HERE, "sfx.json")) ? ((j) => (Array.isArray(j) ? sfxHtml(j, out) : sfxHtml(j.cues, out, j)))(JSON.parse(fs.readFileSync(path.join(HERE, "sfx.json"), "utf8"))) : "")
  .replace("{{VOICE_DUR}}", String(r2(VOICE_DUR)))
  .replace("{{GARAGE}}", g)
  .replace(/\{\{REST_FROM_([\d.]+)\}\}/g, (_, t) => String(r2(DURATION - Number(t))))
  .replace("{{SAU}}", svg("sau.svg", 380))
  .replace("{{SAU_LAUGH}}", svg("sau-laugh.svg", 380));
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
