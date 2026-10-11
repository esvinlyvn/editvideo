#!/usr/bin/env node
// Bước 2: dựng từ plan.json → build/<slug>/ (HyperFrames) rồi render.
//   node scripts/recut/build.mjs work/<slug> [--speed 1.1] [--no-render]
// - FFmpeg: cắt đoạn giữ, bỏ khoảng lặng, tăng tốc, lọc ồn + cân âm lượng → a-roll.
// - HyperFrames: phụ đề (tô màu keyword), text pop, hook, CTA, zoom nhấn, SFX, progress bar.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = path.resolve(process.argv[2] ?? "");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const SPEED = Number(arg("--speed", 1.1));
const plan = JSON.parse(fs.readFileSync(path.join(work, "plan.json"), "utf8"));
const slug = path.basename(work);
const out = path.join(ROOT, "build", `recut-${slug}`);
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString();
const r2 = (n) => Math.round(n * 1000) / 1000;

// ---------- 1. Khoảng lặng (ngưỡng tự thích nghi với tiếng ồn nền) ----------
const detect = (db) =>
  [
    ...execFileSync("bash", ["-c", `ffmpeg -hide_banner -i "$0" -vn -af "highpass=f=120,lowpass=f=5000,afftdn=nr=20:nf=-28,silencedetect=noise=${db}dB:d=0.25" -f null - 2>&1`, plan.source])
      .toString()
      .matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g),
  ].map((m) => ({ s: +m[1], e: +m[2] }));
let silences = [];
for (let db = -34; db <= -20; db += 2) {
  silences = detect(db);
  if (silences.length >= plan.segments.length) break;
}

// ---------- 2. Đoạn giữ → các mảnh speech (bỏ khoảng lặng bên trong) ----------
const segs = plan.segments.map((s, i) => ({ ...s, i }));
let order = segs.filter((s) => s.keep);
if (plan.hookIndex >= 0 && segs[plan.hookIndex]?.keep) {
  order = [segs[plan.hookIndex], ...order.filter((s) => s.i !== plan.hookIndex)];
}
const pieces = []; // { seg, a, b } thời gian gốc
for (const s of order) {
  let a = s.start - 0.1;
  let b = s.end + 0.1;
  const sa = silences.find((x) => x.e >= s.start - 0.7 && x.e <= s.start + 0.4);
  if (sa) a = sa.e - 0.08;
  const sb = silences.find((x) => x.s >= s.end - 0.4 && x.s <= s.end + 0.7);
  if (sb) b = sb.s + 0.12;
  let cur = Math.max(0, a);
  for (const x of silences.filter((x) => x.s > a + 0.2 && x.e < b - 0.2 && x.e - x.s > 0.35)) {
    pieces.push({ seg: s, a: cur, b: x.s + 0.1 });
    cur = x.e - 0.1;
  }
  pieces.push({ seg: s, a: cur, b });
}
// Thời gian trên video thành phẩm
let t = 0;
for (const p of pieces) {
  p.out = t;
  p.len = (p.b - p.a) / SPEED;
  t += p.len;
}
const ACT = t; // thời lượng phần nói
const CTA_DUR = 3.4;
const TOTAL = r2(ACT + CTA_DUR);

// ---------- 3. FFmpeg: a-roll ----------
// Mô hình lọc ồn RNNoise (tách giọng khỏi tiếng ồn đám đông), tải 1 lần.
const RNN = path.join(ROOT, "work/_models/sh.rnnn");
if (!fs.existsSync(RNN)) {
  fs.mkdirSync(path.dirname(RNN), { recursive: true });
  const r = await fetch("https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn");
  fs.writeFileSync(RNN, Buffer.from(await r.arrayBuffer()));
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets/fonts"), { recursive: true });
fs.mkdirSync(path.join(out, "assets/vendor"), { recursive: true });

const fc = [];
pieces.forEach((p, k) => {
  fc.push(`[0:v]trim=${r2(p.a)}:${r2(p.b)},setpts=PTS-STARTPTS[v${k}]`);
  fc.push(`[0:a]atrim=${r2(p.a)}:${r2(p.b)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${r2(p.b - p.a - 0.03)}:d=0.03[a${k}]`);
});
fc.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${pieces.length}:v=1:a=1[vc][ac]`);
fc.push(
  `[vc]setpts=PTS/${SPEED},fps=30,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,eq=contrast=1.06:saturation=1.08:gamma=0.98,colorbalance=rm=0.025:gm=0.005:bm=-0.025,vignette=angle=PI/7,` +
    `tpad=stop_mode=clone:stop_duration=${CTA_DUR}[vo]`,
);
// Âm thanh: lọc ồn môi trường, làm rõ giọng, nén, chuẩn -14 LUFS (chuẩn mạng xã hội)
fc.push(
  `[ac]atempo=${SPEED},highpass=f=90,arnndn=m='${RNN}':mix=0.85,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3,` +
    `acompressor=threshold=-22dB:ratio=3:attack=5:release=120:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=9,apad=pad_dur=${CTA_DUR}[ao]`,
);
const aroll = path.join(out, "assets/aroll.mp4");
console.log(`✂ ${pieces.length} mảnh · ${ACT.toFixed(1)}s (tốc độ ${SPEED}) · ngưỡng lặng ${silences.length} khoảng`);
sh("ffmpeg", ["-loglevel", "error", "-y", "-i", plan.source, "-filter_complex", fc.join(";"), "-map", "[vo]", "-map", "[ao]",
  "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", String(TOTAL), aroll]);

// ---------- 4. Phụ đề ----------
// Chuẩn: 5–7 từ/cụm (tối đa 2 dòng), hiện sớm 0.15s, tắt khi câu nói kết thúc.
// Thời điểm từng chữ: phân bổ theo thời gian CÓ TIẾNG NÓI thật (năng lượng audio sau lọc ồn),
// không chia đều — chữ không chạy trước/sau khi người nói ngừng.
const LEAD = 0.15;
function voicedClock(p) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(p.a), "-to", String(p.b), "-i", plan.source, "-vn",
    "-af", `highpass=f=90,arnndn=m='${RNN}'`, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  const N = 160; // 20ms
  const rms = [];
  for (let i = 0; i + N * 2 <= raw.length; i += N * 2) {
    let e = 0;
    for (let j = 0; j < N; j++) e += raw.readInt16LE(i + j * 2) ** 2;
    rms.push(Math.sqrt(e / N));
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const thr = sorted[Math.floor(sorted.length * 0.9)] * 0.18;
  const voiced = rms.map((v) => v > thr);
  const cum = [0];
  voiced.forEach((v, i) => cum.push(cum[i] + (v ? 1 : 0)));
  const total = cum.at(-1) || 1;
  // frac (0..1 lượng tiếng nói) → thời gian trên video thành phẩm
  return (frac) => {
    const target = frac * total;
    let i = cum.findIndex((c) => c >= target);
    if (i < 0) i = cum.length - 1;
    return p.out + (i * 0.02) / SPEED;
  };
}
const BREAK_BEFORE = new Set("và là mà của thì với để nhưng những các từ ở có đến cho khi trong bởi hay hoặc nên vì rất chỉ đã sẽ".split(" "));
const captions = [];
for (const s of order) {
  const ps = pieces.filter((p) => p.seg === s);
  const words = s.text.split(/\s+/).filter(Boolean);
  const totalLen = ps.reduce((a, p) => a + p.len, 0);
  let wi = 0;
  ps.forEach((p, pi) => {
    const n = pi === ps.length - 1 ? words.length - wi : Math.round((p.len / totalLen) * words.length);
    const chunk = words.slice(wi, wi + n);
    wi += n;
    if (!chunk.length) return;
    const groups = [];
    let g = [];
    chunk.forEach((w, j) => {
      g.push(w);
      const next = chunk[j + 1];
      const inName = next && /^\p{Lu}/u.test(w) && /^\p{Lu}/u.test(next); // không ngắt giữa tên riêng
      // Ưu tiên ngắt trước từ nối (không cắt đôi từ ghép như "chi tiết")
      const beforeLink = next && g.length >= 4 && BREAK_BEFORE.has(next.toLowerCase());
      if ((/[,.!?:;]$/.test(w) && g.length >= 4) || beforeLink || (g.length >= 7 && !inName && !BREAK_BEFORE.has(w.toLowerCase())) || g.length >= 9)
        groups.push(g), (g = []);
    });
    if (g.length) groups.length && g.length < 3 ? groups[groups.length - 1].push(...g) : groups.push(g);
    const at = voicedClock(p);
    let k = 0;
    groups.forEach((gr) => {
      const t0 = at(k / chunk.length);
      const t1 = at((k + gr.length) / chunk.length);
      k += gr.length;
      captions.push({ start: r2(Math.max(p.out, t0 - LEAD)), end: r2(Math.min(p.out + p.len, t1 + 0.12)), text: gr.join(" ") });
    });
  });
}
captions.forEach((c, i) => {
  const nx = captions[i + 1];
  if (nx && c.end > nx.start) c.end = nx.start;
  c.dur = r2(Math.max(0.3, c.end - c.start));
});

// ---------- 5. Hook, thẻ thông tin (callout), CTA, zoom, SFX ----------
const HOOK_DUR = 3.2;
const CALLOUT_MIN = 3.6;
const firstOut = (i) => pieces.find((p) => p.seg.i === i)?.out;
const callouts = (plan.callouts ?? [])
  .map((c) => ({ ...c, at: firstOut(c.index) }))
  .filter((c) => c.at != null)
  .map((c) => ({ ...c, at: r2(Math.max(c.at + 0.3, HOOK_DUR + 0.2)) }))
  .sort((a, b) => a.at - b.at);
callouts.forEach((c, i) => {
  // không chồng nhau: thẻ sau chờ thẻ trước xong
  if (i && c.at < callouts[i - 1].at + callouts[i - 1].dur + 0.25) c.at = r2(callouts[i - 1].at + callouts[i - 1].dur + 0.25);
  const next = callouts[i + 1] ? firstOut(callouts[i + 1].index) : ACT;
  c.dur = r2(Math.min(Math.max(CALLOUT_MIN, next - c.at - 0.3), 5.5, ACT - c.at));
});
const cuts = pieces.slice(1).map((p) => r2(p.out));
// SFX: chỉ dùng khi có file thật trong thư mục sfx/ (whoosh.wav, hit.wav, chime.wav)
const sfxDir = path.join(ROOT, "sfx");
const has = (k) => fs.existsSync(path.join(sfxDir, `${k}.wav`));
const sfxCues = [
  ...(has("hit") ? [{ k: "hit", at: 0.05, vol: 0.5 }] : []),
  ...(has("whoosh") ? callouts.map((c) => ({ k: "whoosh", at: r2(c.at - 0.1), vol: 0.3 })) : []),
  ...(has("chime") ? [{ k: "chime", at: r2(ACT + 0.15), vol: 0.4 }] : []),
];
if (sfxCues.length) {
  fs.mkdirSync(path.join(out, "assets/sfx"), { recursive: true });
  for (const k of new Set(sfxCues.map((s) => s.k))) fs.copyFileSync(path.join(sfxDir, `${k}.wav`), path.join(out, `assets/sfx/${k}.wav`));
}

// ---------- 6. HTML ----------
fs.copyFileSync(path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"), path.join(out, "assets/vendor/gsap.min.js"));
const fontPkg = path.join(ROOT, "node_modules/@fontsource/be-vietnam-pro");
let fontCss = "";
for (const w of [500, 600, 800]) {
  fontCss += fs.readFileSync(path.join(fontPkg, `${w}.css`), "utf8").replace(
    /url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\),\s*url\([^)]+\) format\('woff'\)/g,
    (_, f) => (fs.copyFileSync(path.join(fontPkg, "files", f), path.join(out, "assets/fonts", f)), `url(assets/fonts/${f}) format('woff2')`),
  );
}
// Font tiêu đề/con số: Montserrat (đậm, hiện đại); font nội dung/phụ đề: Be Vietnam Pro.
const mPkg = path.join(ROOT, "node_modules/@fontsource/montserrat");
for (const w of [700, 800]) {
  fontCss += fs.readFileSync(path.join(mPkg, `${w}.css`), "utf8").replace(
    /url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\),\s*url\([^)]+\) format\('woff'\)/g,
    (_, f) => (fs.copyFileSync(path.join(mPkg, "files", f), path.join(out, "assets/fonts", f)), `url(assets/fonts/${f}) format('woff2')`),
  );
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const capHtml = captions
  .map((c, i) => `<div class="clip cap" id="cap-${i}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="2"><p class="cap-in">${esc(c.text)}</p></div>`)
  .join("\n      ");
const coHtml = callouts
  .map(
    (c, i) => `<div class="clip co" id="co-${i}" data-start="${c.at}" data-duration="${c.dur}" data-track-index="3">
        <div class="co-card" id="co-${i}-card">
          <div class="co-bar"></div>
          <div class="co-label">${esc(c.label)}</div>
          <div class="co-value${c.value.length > 9 ? " long" : ""}">${esc(c.value)}</div>
          ${c.sub ? `<div class="co-sub">${esc(c.sub)}</div>` : ""}
        </div>
      </div>`,
  )
  .join("\n      ");
const sfxHtml = sfxCues
  .map((s, i) => `<audio id="sfx-${i}" src="assets/sfx/${s.k}.wav" data-start="${s.at}" data-duration="1.5" data-track-index="8" data-volume="${s.vol}"></audio>`)
  .join("\n      ");

const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${esc(plan.hookTitle)}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
${fontCss}
      /* Vùng an toàn: ≥10% mỗi cạnh (108px ngang, 192px dọc); phụ đề tránh thêm cột nút bên phải TikTok */
      :root { --display: "Montserrat", "Be Vietnam Pro", sans-serif; --accent: #e6c27a; --glass: rgba(14, 16, 20, 0.66); --line: rgba(255, 255, 255, 0.14); }
      body { margin: 0; background: #000; font-family: "Be Vietnam Pro", sans-serif; color: #fff; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #cam { position: absolute; inset: 0; transform-origin: 50% 32%; }
      #aroll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .top-shade { position: absolute; left: 0; right: 0; top: 0; height: 640px;
        background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,.18) 60%, rgba(0,0,0,0) 100%); }

      /* Phụ đề: gọn, dễ đọc, không giành sự chú ý */
      .cap { position: absolute; left: 108px; right: 150px; top: 1380px; display: flex; justify-content: center; }
      .cap-in { margin: 0; max-width: 800px; text-align: center; font-weight: 600; font-size: 46px; line-height: 1.38;
        padding: 10px 24px 12px; border-radius: 14px; background: rgba(0, 0, 0, 0.55);
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
        -webkit-box-decoration-break: clone; box-decoration-break: clone; text-wrap: balance; }

      /* Thẻ thông tin */
      .co { position: absolute; left: 108px; top: 212px; }
      .co-card { position: relative; display: block; max-width: 760px; padding: 26px 36px 30px 44px; border-radius: 22px;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(140%);
        box-shadow: 0 18px 50px rgba(0,0,0,.35); overflow: hidden; }
      .co-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: var(--accent); transform-origin: 50% 0; }
      .co-label { font-weight: 600; font-size: 26px; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); }
      .co-value { font-family: var(--display); font-weight: 800; font-size: 100px; line-height: 1.02; letter-spacing: -0.025em; margin-top: 10px; }
      .co-value.long { font-size: 64px; line-height: 1.08; }
      .co-sub { text-wrap: balance; font-weight: 500; font-size: 32px; line-height: 1.35; margin-top: 14px; color: rgba(255,255,255,.82); }

      /* Hook */
      #hook { position: absolute; left: 108px; right: 108px; top: 212px; }
      #hook-in { display: block; max-width: 864px; padding: 28px 36px 34px 44px; border-radius: 22px; position: relative; overflow: hidden;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(140%); box-shadow: 0 18px 50px rgba(0,0,0,.35); }
      #hook-label { display: inline-block; font-weight: 600; font-size: 28px; letter-spacing: .2em; text-transform: uppercase;
        color: #111; background: var(--accent); padding: 8px 18px; border-radius: 8px; }
      #hook-title { font-family: var(--display); font-weight: 800; font-size: 64px; line-height: 1.1; letter-spacing: -0.02em; margin-top: 22px;
        text-wrap: balance; }
      #hook-rule { display: block; width: 180px; height: 8px; margin-top: 26px; background: var(--accent); border-radius: 4px; transform-origin: 0 50%; }

      /* CTA */
      #cta { position: absolute; inset: 0; }
      #cta-bg { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
      #cta-card { position: absolute; left: 108px; right: 108px; top: 720px; display: block; padding: 46px 48px 50px; border-radius: 28px;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); text-align: center; }
      #cta-label { font-weight: 600; font-size: 28px; letter-spacing: .2em; text-transform: uppercase; color: var(--accent); }
      #cta-t { font-family: var(--display); font-weight: 800; font-size: 58px; line-height: 1.15; margin-top: 18px; text-wrap: balance; }
      #cta-s { font-weight: 500; font-size: 34px; margin-top: 22px; color: rgba(255,255,255,.8); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="recut" data-start="0" data-width="1080" data-height="1920" data-duration="${TOTAL}">
      <div id="cam">
        <video id="aroll" class="clip" src="assets/aroll.mp4" data-start="0" data-duration="${TOTAL}" data-track-index="0" data-has-audio="true" playsinline></video>
      </div>
      <div class="top-shade"></div>
      <div class="clip" id="hook" data-start="0" data-duration="${HOOK_DUR}" data-track-index="4">
        <div id="hook-in">
          <div id="hook-label">${esc(plan.hookLabel ?? "Góc nhìn")}</div>
          <div id="hook-title">${esc(plan.hookTitle)}</div>
          <div id="hook-rule"></div>
        </div>
      </div>
      ${coHtml}
      ${capHtml}
      <div class="clip" id="cta" data-start="${r2(ACT)}" data-duration="${CTA_DUR}" data-track-index="5">
        <div id="cta-bg"></div>
        <div id="cta-card">
          <div id="cta-label">Tư vấn & báo giá</div>
          <div id="cta-t">${esc(plan.cta)}</div>
          <div id="cta-s">Theo dõi để xem thêm phân tích dự án</div>
        </div>
      </div>
      ${sfxHtml}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const ACT = ${ACT}, HOOK = ${HOOK_DUR};
      const cuts = ${JSON.stringify(cuts)};

      // Zoom: mở đầu đẩy vào, mỗi điểm cắt đổi khung (jump-cut)
      tl.fromTo("#cam", { scale: 1.2 }, { scale: 1.06, duration: 0.9, ease: "power3.out" }, 0);
      cuts.forEach((c, i) => tl.set("#cam", { scale: i % 2 ? 1.06 : 1.14 }, c));
      tl.to("#cam", { scale: 1, duration: 0.6, ease: "power2.inOut" }, ACT);

      // Hook
      tl.fromTo("#hook-label", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 0.1);
      tl.fromTo("#hook-title", { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.22);
      tl.fromTo("#hook-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.inOut" }, 0.5);
      tl.to("#hook-in", { opacity: 0, y: -20, duration: 0.35, ease: "power2.in" }, HOOK - 0.4);

      // Phụ đề: hiện/ẩn nhẹ
      document.querySelectorAll(".cap").forEach((el) => {
        tl.fromTo(el.firstElementChild, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, parseFloat(el.dataset.start));
      });

      // Thẻ thông tin: mở từ trái sang, chữ lên lần lượt, giữ đủ lâu để đọc
      document.querySelectorAll(".co").forEach((el) => {
        const st = parseFloat(el.dataset.start), d = parseFloat(el.dataset.duration);
        const q = (s) => el.querySelector(s);
        tl.fromTo(q(".co-card"), { clipPath: "inset(0% 100% 0% 0% round 22px)", x: -24 }, { clipPath: "inset(0% 0% 0% 0% round 22px)", x: 0, duration: 0.6, ease: "power3.out" }, st);
        tl.fromTo(q(".co-bar"), { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: "power3.out" }, st + 0.1);
        tl.fromTo(q(".co-label"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, st + 0.25);
        tl.fromTo(q(".co-value"), { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, st + 0.35);
        if (q(".co-sub")) tl.fromTo(q(".co-sub"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, st + 0.5);
        tl.to(q(".co-card"), { opacity: 0, x: -20, duration: 0.35, ease: "power2.in" }, st + d - 0.38);
      });

      // CTA
      tl.fromTo("#cta-bg", { opacity: 0 }, { opacity: 1, duration: 0.4 }, ACT);
      tl.fromTo("#cta-card", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ACT + 0.15);

      window.__timelines["recut"] = tl;
    </script>
  </body>
</html>
`;
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(work, "timeline.json"), JSON.stringify({ pieces: pieces.map((p) => ({ seg: p.seg.i, a: r2(p.a), b: r2(p.b), out: r2(p.out) })), captions, callouts, sfxCues }, null, 1));
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${TOTAL}s · ${captions.length} phụ đề · ${callouts.length} thẻ · ${sfxCues.length} SFX`);

if (!process.argv.includes("--no-render")) {
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" };
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env });
}
