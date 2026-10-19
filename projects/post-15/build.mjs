#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-15/build.mjs [--no-render]
// Kết quả: build/post-15/index.html (+ output.mp4)
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
// Hai câu trích của "hai bộ phận trong não" hiện bằng bong bóng → không chạy phụ đề trùng
const NO_CAP = new Set([22, 23, 25, 26]);
// Cụm giữ nguyên một phụ đề (tách ra sẽ để lại "mình đã có thể" lơ lửng)
const KEEP = new Set([]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 15: [8, 5, 5], 33: [5, 7] };
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
for (const [pkg, weights] of [["barlow-condensed", [700, 800]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
  .replace("{{END_DUR}}", String(r2(DURATION - 75.55)))
  // pictogram kiểu biển chỉ dẫn (đen trên nền vàng)
  .replaceAll("{{IC_Q}}", '<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.8" stroke-linecap="round"><path d="M8.5 9a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5"/><circle cx="12" cy="19" r="1.4" fill="#161616" stroke="none"/></svg>')
  .replaceAll("{{IC_ESC}}", '<svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M2 20h5l10-12h5"/><path d="M2 16h4l10-12h6" opacity=".45"/><circle cx="13" cy="6" r="1.6" fill="#161616" stroke="none"/><path d="M13 8.5v4l-2 3"/></svg>')
  .replaceAll("{{IC_ESC_BIG}}", '<svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="#ffcf00" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M2 20h5l10-12h5"/><circle cx="13" cy="5.5" r="1.5" fill="#ffcf00" stroke="none"/><path d="M13 8v4l-2.5 3M13 12l2 2"/><path d="M3 3l18 18" stroke="#ffffff" stroke-width="2.2"/></svg>')
  .replaceAll("{{IC_WARN}}", '<svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.4" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5" stroke-linecap="round"/></svg>')
  .replaceAll("{{IC_BRAIN}}", '<svg width="100" height="90" viewBox="0 0 120 100" fill="none" stroke="#161616" stroke-width="7" stroke-linejoin="round"><path d="M58 12c-8-8-24-6-28 4-12 0-20 10-16 20-10 6-10 22 2 26-2 12 10 20 20 16 4 10 18 10 22 2V12zM62 12c8-8 24-6 28 4 12 0 20 10 16 20 10 6 10 22-2 26 2 12-10 20-20 16-4 10-18 10-22 2V12z"/></svg>')
  .replaceAll("{{IC_BRAIN_BIG}}", '<svg style="margin-top:30px" width="220" height="190" viewBox="0 0 120 100" fill="none" stroke="#161616" stroke-width="4" stroke-linejoin="round"><path d="M58 12c-8-8-24-6-28 4-12 0-20 10-16 20-10 6-10 22 2 26-2 12 10 20 20 16 4 10 18 10 22 2V12zM62 12c8-8 24-6 28 4 12 0 20 10 16 20 10 6 10 22-2 26 2 12-10 20-20 16-4 10-18 10-22 2V12z" fill="#ffcf00"/><path d="M48 50l8 8 16-18" stroke-width="6" stroke-linecap="round"/></svg>')
  .replaceAll("{{IC_INFO}}", '<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1.3" fill="#161616" stroke="none"/></svg>')
  .replaceAll("{{IC_LAB}}", '<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M9 3h6M10 3v6l-5.5 10a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/></svg>')
  .replaceAll("{{IC_CHECK}}", '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11"/></svg>')
  .replaceAll("{{IC_CAL}}", '<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2.4" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke-linecap="round"/><path d="M8 14h3v4H8z" fill="#161616"/></svg>')
  .replaceAll("{{IC_BED}}", '<svg style="margin-top:30px" width="260" height="190" viewBox="0 0 52 38" fill="none" stroke="#161616" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M3 34V14M3 26h46v8M49 26v-6a4 4 0 0 0-4-4H22v10"/><circle cx="13" cy="20" r="4.5" fill="#ffcf00"/><g id="zz" font-family="Barlow Condensed" font-weight="800" fill="#161616" stroke="none"><text x="26" y="10" font-size="9">Z</text><text x="33" y="6" font-size="7">z</text><text x="38" y="3" font-size="5">z</text></g></svg>')
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  .replace("{{SAU_LAUGH}}", fs.readFileSync(path.join(HERE, "art/sau-laugh.svg"), "utf8"))
  ;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
