#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-35/build.mjs [--no-render]
// Kết quả: build/post-35/index.html (+ output.mp4)
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
const NO_CAP = new Set([29, 30]);
// Cụm giữ nguyên một phụ đề (tách ra sẽ để lại "mình đã có thể" lơ lửng)
const KEEP = new Set([4, 21]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 0: [9, 8], 1: [5, 5], 2: [5, 6], 6: [8, 4], 8: [5, 6], 16: [6, 5], 24: [8, 5, 5], 25: [6, 6], 26: [8, 4, 7], 27: [8, 4] };
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
for (const [pkg, weights] of [["spectral", [600, 700]], ["be-vietnam-pro", [500, 600, 700]]]) {
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


// ---------- Hình nhỏ cho thẻ phương án + biểu tượng ----------
const K = "#1f2a24", R = "#d9481c";
const mini = (body) => `<svg width="330" height="250" viewBox="0 0 330 250" style="display:block;margin:12px auto">${body}</svg>`;
const ICONS = {
  PLAN_A: mini(`<path d="M10 200H320" stroke="${K}" stroke-width="6"/><path d="M20 120H310" stroke="#8a959c" stroke-width="26"/><rect x="140" y="170" width="50" height="30" fill="#7a5638" stroke="${K}" stroke-width="5"/><path d="M150 170l8-12 10 12 10-10" stroke="${K}" stroke-width="4" fill="none"/>${[50, 110, 220, 280].map((x) => `<path d="M${x} 133V200" stroke="#b4bab4" stroke-width="16"/>`).join("")}`),
  PLAN_B: mini(`<path d="M10 200H320" stroke="${K}" stroke-width="6"/><path d="M20 70H135M195 70H310" stroke="#8a959c" stroke-width="18"/><path d="M20 130H138M192 130H310" stroke="#b4bab4" stroke-width="20"/><path d="M152 200C150 140 155 90 158 60H172C175 90 180 140 178 200z" fill="#7a5638" stroke="${K}" stroke-width="5"/><circle cx="165" cy="44" r="40" fill="#3f9b5f" stroke="${K}" stroke-width="5"/><circle cx="130" cy="58" r="26" fill="#5bb974" stroke="${K}" stroke-width="5"/><circle cx="200" cy="58" r="26" fill="#2f7d4f" stroke="${K}" stroke-width="5"/><circle cx="165" cy="100" r="62" fill="none" stroke="${R}" stroke-width="6" stroke-dasharray="14 10"/>`),
  IC_TRAIN: `<svg width="200" height="150" viewBox="0 0 200 150"><rect x="20" y="20" width="160" height="100" rx="20" fill="#f6f3ec" stroke="${K}" stroke-width="6"/><path d="M20 90h160" stroke="#2f6f5a" stroke-width="14"/><rect x="40" y="38" width="50" height="36" rx="6" fill="#bcdcf0" stroke="${K}" stroke-width="4"/><rect x="110" y="38" width="50" height="36" rx="6" fill="#bcdcf0" stroke="${K}" stroke-width="4"/><circle cx="60" cy="128" r="12" fill="${K}"/><circle cx="140" cy="128" r="12" fill="${K}"/></svg>`,
  IC_TREE: `<svg width="200" height="150" viewBox="0 0 200 150"><path d="M90 146C88 110 92 80 94 60h12c2 20 6 50 4 86z" fill="#7a5638" stroke="${K}" stroke-width="5"/><circle cx="100" cy="50" r="40" fill="#3f9b5f" stroke="${K}" stroke-width="5"/><circle cx="62" cy="66" r="28" fill="#5bb974" stroke="${K}" stroke-width="5"/><circle cx="138" cy="66" r="28" fill="#2f7d4f" stroke="${K}" stroke-width="5"/></svg>`,
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
