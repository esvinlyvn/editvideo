#!/usr/bin/env node
// Dựng video motion graphics từ voice + transcript (chép lời theo cụm có mốc thời gian chính xác).
//   node projects/post-22/build.mjs [--no-render]
// Kết quả: build/post-22/index.html (+ output.mp4)
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
// Các câu ba má nói hiện thành mục từ / bong bóng trên hình → không chạy phụ đề trùng
const NO_CAP = new Set([0, 11, 13, 14, 16, 17, 20]);
// Cụm giữ nguyên một phụ đề (tách ra sẽ để lại "mình đã có thể" lơ lửng)
const KEEP = new Set([]);
// Chỗ ngắt chỉ định tay (số chữ của từng phụ đề) khi luật chung ngắt chưa đẹp
const FORCE = { 1: [6, 7, 4, 6], 26: [4, 6], 32: [4, 6] };
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
for (const [pkg, weights] of [["lora", [500, 700, "500-italic"]], ["be-vietnam-pro", [500, 600, 700]]]) {
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
  .replace("{{END_DUR}}", String(r2(DURATION - 70.0)))
  // icon + hình người (nét nâu mực, điểm đỏ đất)
  .replaceAll("{{IC_BOWL}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#2f2219" stroke-width="1.6" stroke-linecap="round"><path d="M3 11h18a9 9 0 0 1-18 0z" fill="#e3c9a2"/><path d="M8 10c1-3 7-3 8 0" fill="#a0522d"/><path d="M15 3l-2 7M19 4l-4 6"/></svg>')
  .replaceAll("{{IC_WALLET}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#2f2219" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#e3c9a2"/><path d="M3 7l12-4 2 4"/><rect x="15" y="11" width="6" height="4" rx="1" fill="#c4532f"/></svg>')
  .replaceAll("{{IC_PHONE}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#2f2219" stroke-width="1.6" stroke-linecap="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" fill="#e3c9a2"/></svg>')
  .replaceAll("{{IC_HOUSE}}", '<svg width="110" height="110" viewBox="0 0 24 24" fill="none" stroke="#2f2219" stroke-width="1.6" stroke-linejoin="round"><path d="M3 11L12 4l9 7v9H3z" fill="#e3c9a2"/><rect x="9" y="13" width="6" height="7" fill="#c4532f"/></svg>')
  .replaceAll("{{IC_CHECK}}", '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#c4532f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11"/></svg>')
  .replaceAll("{{FIG_KID}}", '<svg width="350" height="380" viewBox="0 0 350 380" style="margin-top:20px"><g fill="#2f2219"><circle cx="230" cy="90" r="34"/><path d="M170 380c4-110 30-160 60-160s56 50 60 160z"/><circle cx="300" cy="110" r="30" opacity=".8"/><path d="M250 380c4-100 26-140 50-140s46 40 50 140z" opacity=".8"/></g><g class="kid"><circle cx="90" cy="250" r="22" fill="#c4532f"/><path d="M90 272v50M90 322l-20 40M90 322l24 36M90 286l30-14M90 286l-26 18" stroke="#c4532f" stroke-width="12" stroke-linecap="round"/><path d="M20 250h-14M24 280h-20M26 310h-14" stroke="#c4532f" stroke-width="6" stroke-linecap="round"/></g></svg>')
  .replaceAll("{{FIG_ADULT}}", '<svg width="350" height="380" viewBox="0 0 350 380" style="margin-top:20px"><g fill="#2f2219"><circle cx="100" cy="80" r="34"/><path d="M40 380c4-110 30-160 60-160s56 50 60 160z"/></g><rect x="40" y="240" width="120" height="80" rx="8" fill="#e3c9a2" stroke="#2f2219" stroke-width="5"/><g fill="#2f2219" opacity=".75"><circle cx="270" cy="190" r="24"/><path d="M226 380c3-80 22-120 44-120s41 40 44 120z"/><circle cx="320" cy="205" r="20"/><path d="M286 380c3-70 18-104 34-104s31 34 34 104z"/></g><path d="M222 150c-20-30-60-40-80-30" stroke="#c4532f" stroke-width="5" fill="none" stroke-dasharray="3 10" stroke-linecap="round"/><text x="180" y="110" font-family="Lora" font-weight="700" font-size="52" fill="#c4532f">?</text></svg>')
  .replace("{{SAU}}", fs.readFileSync(path.join(HERE, "art/sau.svg"), "utf8"))
  .replace("{{SAU_LAUGH}}", fs.readFileSync(path.join(HERE, "art/sau-laugh.svg"), "utf8"))
  ;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${DURATION}s · ${caps.length} phụ đề`);
console.log(caps.map((c) => c.words.join(" ")).join(" | "));

if (!process.argv.includes("--no-render")) {
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" } });
}
