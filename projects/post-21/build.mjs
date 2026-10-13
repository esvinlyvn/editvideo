#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-21/build.mjs [--no-render]
// Kết quả: build/post-21/index.html (+ output.mp4)
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
const TAIL = 2.2;
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
const FORCE = { 21: [5, 5] };
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
for (const [pkg, weights] of [["bricolage-grotesque", [800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
  .replace("{{END_DUR}}", String(r2(DURATION - 65.55)))
  // icon nét xanh than, điểm hồng (kiểu in Riso)
  .replaceAll("{{IC_LAPTOP}}", '<svg width="130" height="130" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5" fill="#ff4f9a"/><path d="M2 19h20"/></svg>')
  .replaceAll("{{IC_BOWL}}", '<svg width="130" height="130" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="1.8" stroke-linecap="round"><path d="M3 11h18a9 9 0 0 1-18 0z" fill="#ff4f9a"/><path d="M15 3l-2 8M19 4l-4 7"/></svg>')
  .replaceAll("{{IC_BED}}", '<svg width="130" height="130" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M2 19V8M2 15h20v4M22 15v-3a3 3 0 0 0-3-3H10v6"/><circle cx="6" cy="11" r="2.4" fill="#ff4f9a"/></svg>')
  .replaceAll("{{IC_POWER}}", '<svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="2.6" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>')
  .replaceAll("{{IC_LOOP}}", '<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#ff4f9a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 3v5h-5M20 12a8 8 0 0 1-13.7 5.7L4 16M4 21v-5h5"/></svg>')
  .replaceAll("{{IC_THUMB}}", '<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="1.8" stroke-linejoin="round"><path d="M7 4h9l3 7v3a2 2 0 0 1-2 2h-5l1 5c0 1-1 2-2 1l-4-6V4z" fill="#ff4f9a"/><rect x="2" y="4" width="5" height="11" rx="1"/></svg>')
  .replaceAll("{{IC_WARN}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="2" stroke-linejoin="round"><path d="M12 3l10 18H2z" fill="#ff4f9a"/><path d="M12 10v5M12 18v.5" stroke-linecap="round"/></svg>')
  .replaceAll("{{IC_BOOK}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="1.8" stroke-linejoin="round"><path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" fill="#fff"/><path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z" fill="#ff4f9a"/></svg>')
  .replaceAll("{{IC_KEY}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#1d1b3a" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="12" r="4.5" fill="#ff4f9a"/><path d="M12.5 12H21M18 12v3M21 12v2"/></svg>')
  .replaceAll("{{IC_SAFE}}", '<svg width="260" height="260" viewBox="0 0 26 26" fill="none" stroke="#1d1b3a" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="2" width="22" height="20" rx="2.5" fill="#fff"/><rect x="5" y="5" width="16" height="14" rx="1.5"/><rect x="7" y="9" width="10" height="7" rx="1" fill="#1d1b3a"/><circle cx="10" cy="12.5" r="1.6" fill="#ff4f9a" stroke="none"/><circle cx="14" cy="12.5" r="1.6" fill="#ff4f9a" stroke="none"/><path d="M19 10v4M5 22v2M21 22v2"/></svg>')
  .replaceAll("{{HEAD}}", fs.readFileSync(path.join(HERE, "art/head.svg"), "utf8"))
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  .replace("{{SAU_LAUGH}}", fs.readFileSync(path.join(HERE, "art/sau-laugh.svg"), "utf8"))
  ;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
