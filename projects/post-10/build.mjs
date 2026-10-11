#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-10/build.mjs [--no-render]
// Kết quả: build/post-10/index.html (+ output.mp4)
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
const TAIL = 1.3;
const DURATION = Math.round((VOICE_DUR + TAIL) * 100) / 100;
const r2 = (n) => Math.round(n * 1000) / 1000;

// ---------- Phụ đề: 5–7 từ/cụm, hiện sớm 0.15s, tắt khi hết lời ----------
const LEAD = 0.15;
const MAX = 7;
const LINK = new Set("và là mà của thì với để nhưng những các từ ở có đến cho khi trong bởi hay hoặc nên vì rất chỉ đã sẽ".split(" "));
// Tách cụm dài thành nhóm ≤ 7 từ, ưu tiên ngắt ở dấu câu / trước từ nối; thời gian chia theo số ký tự.
const pieces = [];
// Đoạn hội thoại/trích lời đã hiện bằng bong bóng chat → không chạy phụ đề trùng lặp
const NO_CAP = new Set([7, 8, 10, 11, 12, 33]);
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
    if ((/[,.!?:;]$/.test(w) && g.length >= 3 && left >= 2) || (LINK.has(next.toLowerCase()) && g.length >= 4 && left >= 3) || (g.length >= MAX && left >= 3) || g.length >= 9)
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
for (const [pkg, weights] of [["space-grotesk", [500, 700]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
  .replaceAll("{{PERSON_A}}", '<svg width="256" height="290" viewBox="0 0 100 114"><circle cx="50" cy="42" r="20" fill="#2a1720"/><path d="M14 114c2-26 18-40 36-40s34 14 36 40z" fill="#2a1720"/><path d="M78 20c0-5 6-7 8-2 2-5 8-3 8 2 0 6-8 10-8 10s-8-4-8-10z" fill="#e8335a"/></svg>')
  .replaceAll("{{PERSON_B}}", '<svg width="256" height="290" viewBox="0 0 100 114"><path d="M28 46c0-16 10-26 22-26s22 10 22 26c0 8-2 14-4 18H32c-2-4-4-10-4-18z" fill="#2a1720"/><circle cx="50" cy="44" r="18" fill="#2a1720"/><path d="M14 114c2-26 18-40 36-40s34 14 36 40z" fill="#2a1720"/></svg>')
  .replaceAll("{{HEART_S}}", '<svg width="28" height="26" viewBox="0 0 24 22"><path d="M12 21s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z" fill="#e8335a"/></svg>')
  .replaceAll("{{CAMERA}}", '<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>')
  .replaceAll("{{TRASH}}", '<svg width="140" height="160" viewBox="0 0 24 26" fill="none" stroke="#2a1720" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1.5 18h11L19 6M10 11v8M14 11v8"/></svg>')
  .replaceAll("{{TRASH_S}}", '<svg width="110" height="120" viewBox="0 0 24 26" fill="none" stroke="#2a1720" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1.5 18h11L19 6M10 11v8M14 11v8"/></svg>')
  .replaceAll("{{BANK}}", '<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M3 9.5L12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>')
  .replaceAll("{{CARD}}", '<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#e8335a" stroke-width="1.8"><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 9.5h19M6 15h5"/><path d="M17 13.5a2.5 2.5 0 1 1-.7-1.8M16.3 11.7v1.6h-1.6" stroke-linecap="round"/></svg>')
  .replaceAll("{{MAG}}", '<svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="#2a1720" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="6.5" fill="rgba(255,255,255,.35)"/><path d="M15 15l6 6"/></svg>')
  .replaceAll("{{PHONE_S}}", '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#e8335a" stroke-width="2.2" stroke-linecap="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>')
  .replaceAll("{{MAIL}}", '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#e8335a" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>')
  .replaceAll("{{ALARM}}", '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e8335a" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M5 4.5L3 6.5M19 4.5l2 2"/></svg>')
  .replace("{{PLAN}}", fs.readFileSync(path.join(HERE, "art/plan.svg"), "utf8"))
  .replaceAll("{{WAND}}", '<svg width="420" height="300" viewBox="0 0 140 100" fill="none"><rect x="20" y="20" width="44" height="72" rx="3" stroke="#1f2d3d" stroke-width="4"/><circle cx="56" cy="58" r="3" fill="#1f2d3d"/><path d="M80 80l40-46" stroke="#1f2d3d" stroke-width="6" stroke-linecap="round"/><path d="M122 18l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#0fa3a3"/><path d="M10 10l120 80" stroke="#0fa3a3" stroke-width="7" stroke-linecap="round"/></svg>')
  .replaceAll("{{BRAIN}}", '<svg width="400" height="330" viewBox="0 0 120 100" fill="none" stroke="#1f2d3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M58 14c-8-8-24-6-28 4-12 0-20 10-16 20-10 6-10 22 2 26-2 12 10 20 20 16 4 10 18 10 22 2V14z" fill="#fff"/><path d="M62 14c8-8 24-6 28 4 12 0 20 10 16 20 10 6 10 22-2 26 2 12-10 20-20 16-4 10-18 10-22 2V14z" fill="#fff"/><path d="M36 40c6 0 10 4 10 10M30 62c6-2 12 0 14 6M84 40c-6 0-10 4-10 10M90 62c-6-2-12 0-14 6"/></svg>')
  .replaceAll("{{CHARGER}}", '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#1f2d3d" stroke-width="2.2" stroke-linecap="round"><rect x="7" y="7" width="10" height="9" rx="2" fill="#0fa3a3"/><path d="M10 7V3M14 7V3M12 16v3c0 2 2 2 4 2"/></svg>')
  .replaceAll("{{CHARGER_W}}", '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="7" y="7" width="10" height="9" rx="2"/><path d="M10 7V3M14 7V3M12 16v3c0 2 2 2 4 2"/></svg>')
  .replaceAll("{{BILL}}", '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#1f2d3d" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M13 7l-3 5h4l-3 5" stroke="#0fa3a3"/></svg>')
  .replaceAll("{{LAPTOP}}", '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#1f2d3d" stroke-width="2.2" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>')
  .replaceAll("{{BOWL}}", '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#1f2d3d" stroke-width="2.2" stroke-linecap="round"><path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M15 3l-2 8M19 4l-4 7"/></svg>')
  .replaceAll("{{SCISSORS}}", '<svg width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="#1f2d3d" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="3" fill="#fff"/><circle cx="6" cy="18" r="3" fill="#fff"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/></svg>')
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  .replace("{{SAU_LAUGH}}", fs.readFileSync(path.join(HERE, "art/sau-laugh.svg"), "utf8"))
  .replace("{{S9_DUR}}", String(r2(DURATION - 66.1)))
  ;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
