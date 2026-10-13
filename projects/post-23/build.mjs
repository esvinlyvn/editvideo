#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-23/build.mjs [--no-render]
// Kết quả: build/post-23/index.html (+ output.mp4)
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
const TAIL = 2.4;
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
const KEEP = new Set([]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 15: [4, 6], 18: [7, 6], 19: [4, 9], 21: [6, 5], 27: [5, 5], 28: [9], 30: [4, 8] };
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
for (const [pkg, weights] of [["plus-jakarta-sans", [700, 800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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

const html = fs
  .readFileSync(path.join(HERE, "template.html"), "utf8")
  .replace("{{FONTS}}", fonts)
  .replace("{{CAPTIONS}}", capHtml)
  .replaceAll("{{DURATION}}", String(DURATION))
  .replace("{{SFX}}", fs.existsSync(path.join(HERE, "sfx.json")) ? ((j) => (Array.isArray(j) ? sfxHtml(j, out) : sfxHtml(j.cues, out, j)))(JSON.parse(fs.readFileSync(path.join(HERE, "sfx.json"), "utf8"))) : "")
  .replace("{{VOICE_DUR}}", String(r2(VOICE_DUR)))
  .replace("{{END_DUR}}", String(r2(DURATION - 77.3)))
  // icon + hình minh họa (nét than, nhấn tím)
  .replaceAll("{{IC_TIMELINE}}", '<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#5b3df5" stroke-width="2.2" stroke-linecap="round"><circle cx="5" cy="5" r="2.2" fill="#5b3df5"/><circle cx="19" cy="12" r="2.2" fill="#5b3df5"/><circle cx="7" cy="19" r="2.2" fill="#5b3df5"/><path d="M7 5h8a4 4 0 0 1 0 7M17 12H9a4 4 0 0 0 0 7" stroke-dasharray="1 3"/></svg>')
  .replaceAll("{{IC_MAPAPP}}", '<svg width="70" height="70" viewBox="0 0 24 24" fill="none"><path d="M12 22c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="#5b3df5"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>')
  .replaceAll("{{MAPBG}}", '<svg width="500" height="1040" viewBox="0 0 500 1040" style="position:absolute;inset:0"><rect width="500" height="1040" fill="#e6e9ee"/><g fill="#f7f8fa">' + Array.from({ length: 30 }, (_, k) => `<rect x="${(k % 4) * 130 + 10}" y="${Math.floor(k / 4) * 140 + 10}" width="110" height="120" rx="12"/>`).join("") + '</g><path d="M0 520C150 480 300 560 500 520V580C300 620 150 540 0 580z" fill="#cfdcf2"/><path d="M60 900V700H330V300" stroke="#5b3df5" stroke-width="8" stroke-dasharray="1 16" stroke-linecap="round" fill="none"/></svg>')
  .replaceAll("{{IC_TOGGLE}}", '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#18202b" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="7" cy="12" r="3" fill="#18202b"/></svg>')
  .replaceAll("{{IC_PIN}}", '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#5b3df5" stroke-width="2"><path d="M12 21c-4-5-6-8-6-11a6 6 0 0 1 12 0c0 3-2 6-6 11z" fill="#ece8ff"/><circle cx="12" cy="10" r="8.5" stroke-dasharray="2 2.5" opacity=".7"/></svg>')
  .replaceAll("{{IC_LOCK}}", '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#5b3df5" stroke-width="2" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#ece8ff"/><rect x="9" y="10" width="6" height="5" rx="1" fill="#5b3df5"/><path d="M10 10V8.5a2 2 0 0 1 4 0V10"/></svg>')
  .replaceAll("{{IC_TRASH}}", '<svg width="72" height="72" viewBox="0 0 24 26" fill="none" stroke="#18202b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1.5 18h11L19 6M10 11v8M14 11v8"/></svg>')
  .replaceAll("{{IC_PHONEPIN}}", '<svg width="260" height="380" viewBox="0 0 26 38" fill="none" stroke="#18202b" stroke-width="1.4"><rect x="2" y="1" width="22" height="36" rx="4" fill="#fff"/><path d="M13 26c-3-4-5-6-5-8.5a5 5 0 0 1 10 0c0 2.5-2 4.5-5 8.5z" fill="#5b3df5" stroke="none"/><circle cx="13" cy="17.5" r="1.8" fill="#fff" stroke="none"/><path d="M6 31h14" stroke-dasharray="1 2"/></svg>')
  .replaceAll("{{IC_HEART}}", '<svg width="300" height="380" viewBox="0 0 30 38" fill="none"><circle cx="15" cy="13" r="10" fill="#18202b"/><path d="M5 38c0-9 4-14 10-14s10 5 10 14z" fill="#18202b"/><path d="M15 18s-5-3-5-6.5a2.7 2.7 0 0 1 5-1.5 2.7 2.7 0 0 1 5 1.5C20 15 15 18 15 18z" fill="#5b3df5"/></svg>')
  .replaceAll("{{MEMORY}}", '<svg width="708" height="420" viewBox="0 0 708 420" fill="none"><defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7cff"/><stop offset="1" stop-color="#ffc9a3"/></linearGradient></defs><rect width="708" height="420" fill="url(#sun)"/><circle cx="520" cy="250" r="70" fill="#ffe3b8"/><path d="M0 300h708v120H0z" fill="#3a2f5c"/><rect x="40" y="40" width="628" height="250" fill="none" stroke="#fff" stroke-width="10" opacity=".7"/><path d="M354 40v250" stroke="#fff" stroke-width="8" opacity=".7"/><ellipse cx="354" cy="340" rx="230" ry="26" fill="#2a2244"/><g stroke="#fff" stroke-width="6"><path d="M250 300h56v26a20 20 0 0 1-20 20h-16a20 20 0 0 1-20-20z" fill="#ffffff"/><path d="M402 300h56v26a20 20 0 0 1-20 20h-16a20 20 0 0 1-20-20z" fill="#ffffff"/></g><path d="M266 280c0-10 10-10 10-20M418 280c0-10 10-10 10-20" stroke="#fff" stroke-width="4" opacity=".6"/></svg>')
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  .replace("{{SAU_LAUGH}}", fs.readFileSync(path.join(HERE, "art/sau-laugh.svg"), "utf8"))
  ;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
