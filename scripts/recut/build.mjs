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
const CTA_DUR = 2.6;
const TOTAL = r2(ACT + CTA_DUR);

// ---------- 3. FFmpeg: a-roll ----------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets/fonts"), { recursive: true });
fs.mkdirSync(path.join(out, "assets/vendor"), { recursive: true });
fs.mkdirSync(path.join(out, "assets/sfx"), { recursive: true });
const fc = [];
pieces.forEach((p, k) => {
  fc.push(`[0:v]trim=${r2(p.a)}:${r2(p.b)},setpts=PTS-STARTPTS[v${k}]`);
  fc.push(`[0:a]atrim=${r2(p.a)}:${r2(p.b)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${r2(p.b - p.a - 0.03)}:d=0.03[a${k}]`);
});
fc.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${pieces.length}:v=1:a=1[vc][ac]`);
fc.push(
  `[vc]setpts=PTS/${SPEED},fps=30,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,eq=contrast=1.05:saturation=1.12,` +
    `tpad=stop_mode=clone:stop_duration=${CTA_DUR}[vo]`,
);
// Âm thanh: lọc ồn môi trường, làm rõ giọng, nén, chuẩn -14 LUFS (chuẩn mạng xã hội)
fc.push(
  `[ac]atempo=${SPEED},highpass=f=90,afftdn=nr=14:nf=-30:tn=1,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3,` +
    `acompressor=threshold=-22dB:ratio=3:attack=5:release=120:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=9,apad=pad_dur=${CTA_DUR}[ao]`,
);
const aroll = path.join(out, "assets/aroll.mp4");
console.log(`✂ ${pieces.length} mảnh · ${ACT.toFixed(1)}s (tốc độ ${SPEED}) · ngưỡng lặng ${silences.length} khoảng`);
sh("ffmpeg", ["-loglevel", "error", "-y", "-i", plan.source, "-filter_complex", fc.join(";"), "-map", "[vo]", "-map", "[ao]",
  "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", String(TOTAL), aroll]);

// ---------- 4. SFX tổng hợp (thay bằng file thật trong assets/sfx nếu muốn) ----------
const sfx = {
  boom: "aevalsrc='0.9*sin(2*PI*(45+90*exp(-18*t))*t)*exp(-4*t)':d=1.2",
  whoosh: "anoisesrc=d=0.5:c=pink:a=0.6,highpass=f=600,lowpass=f=6000,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.2",
  pop: "aevalsrc='0.7*sin(2*PI*(1500-9000*t)*t)*exp(-35*t)':d=0.15",
  ding: "aevalsrc='0.5*sin(2*PI*1568*t)*exp(-5*t)+0.3*sin(2*PI*2352*t)*exp(-7*t)':d=1.0",
};
for (const [k, f] of Object.entries(sfx)) {
  sh("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", f, "-ac", "2", "-ar", "44100", path.join(out, `assets/sfx/${k}.wav`)]);
}

// ---------- 5. Phụ đề: chia chữ theo mảnh speech, nhóm 3–5 từ ----------
const mapT = (p, tOrig) => p.out + (tOrig - p.a) / SPEED;
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "");
const captions = [];
for (const s of order) {
  const ps = pieces.filter((p) => p.seg === s);
  const words = s.text.split(/\s+/).filter(Boolean);
  // keyword → đánh dấu chỉ số từ
  const hot = new Set();
  for (const k of plan.keywords.filter((k) => k.index === s.i)) {
    const kw = k.phrase.split(/\s+/).map(norm);
    for (let i = 0; i + kw.length <= words.length; i++) {
      if (kw.every((w, j) => norm(words[i + j]) === w)) kw.forEach((_, j) => hot.add(i + j));
    }
  }
  const totalLen = ps.reduce((a, p) => a + p.len, 0);
  let wi = 0;
  ps.forEach((p, pi) => {
    const n = pi === ps.length - 1 ? words.length - wi : Math.round((p.len / totalLen) * words.length);
    const chunk = words.slice(wi, wi + n).map((w, j) => ({ w, hot: hot.has(wi + j) }));
    wi += n;
    // nhóm: tối đa 4 từ, ngắt sau dấu câu
    const groups = [];
    let g = [];
    for (const x of chunk) {
      g.push(x);
      if (g.length >= 4 || /[,.!?:;]$/.test(x.w)) groups.push(g), (g = []);
    }
    if (g.length) groups.push(g);
    const pad = 0.06;
    const st0 = p.out + pad;
    const span = p.len - pad * 2;
    let acc = 0;
    groups.forEach((gr) => {
      const d = (gr.length / chunk.length) * span;
      captions.push({ start: r2(st0 + acc), dur: r2(Math.max(0.25, d)), words: gr });
      acc += d;
    });
  });
}

// ---------- 6. Pop, hook, CTA, zoom, SFX ----------
const firstOut = (i) => pieces.find((p) => p.seg.i === i)?.out;
const pops = plan.pops
  .map((x) => ({ ...x, at: firstOut(x.index) }))
  .filter((x) => x.at != null)
  .map((x) => ({ ...x, at: r2(x.at + 0.35), dur: 2.1 }))
  .sort((a, b) => a.at - b.at);
const HOOK_DUR = 2.8;
const cuts = pieces.slice(1).map((p) => r2(p.out));
const sfxCues = [
  { k: "boom", at: 0, vol: 0.9 },
  ...pops.filter((p) => p.at > HOOK_DUR).map((p) => ({ k: "whoosh", at: r2(p.at - 0.15), vol: 0.55 })),
  ...captions.filter((c) => c.words.some((w) => w.hot)).map((c) => ({ k: "pop", at: c.start, vol: 0.35 })),
  { k: "ding", at: r2(ACT + 0.2), vol: 0.6 },
];

// ---------- 7. HTML ----------
fs.copyFileSync(path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"), path.join(out, "assets/vendor/gsap.min.js"));
const fontPkg = path.join(ROOT, "node_modules/@fontsource/be-vietnam-pro");
let fontCss = "";
for (const w of [600, 800, 900]) {
  fontCss += fs.readFileSync(path.join(fontPkg, `${w}.css`), "utf8").replace(
    /url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\),\s*url\([^)]+\) format\('woff'\)/g,
    (_, f) => (fs.copyFileSync(path.join(fontPkg, "files", f), path.join(out, "assets/fonts", f)), `url(assets/fonts/${f}) format('woff2')`),
  );
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const capHtml = captions
  .map(
    (c, i) =>
      `<div class="clip cap" id="cap-${i}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="2"><div class="cap-in" id="cap-${i}-in">${c.words
        .map((w) => `<span class="${w.hot ? "hot" : ""}">${esc(w.w)}</span>`)
        .join(" ")}</div></div>`,
  )
  .join("\n      ");
const popHtml = pops
  .map(
    (p, i) =>
      `<div class="clip pop" id="pop-${i}" data-start="${p.at}" data-duration="${p.dur}" data-track-index="3"><div class="pop-in" id="pop-${i}-in"><div class="pop-t">${esc(p.text)}</div>${
        p.sub ? `<div class="pop-s">${esc(p.sub)}</div>` : ""
      }</div></div>`,
  )
  .join("\n      ");
const sfxHtml = sfxCues
  .map((s, i) => `<audio id="sfx-${i}" src="assets/sfx/${s.k}.wav" data-start="${s.at}" data-duration="1.2" data-track-index="${8 + (i % 2)}" data-volume="${s.vol}"></audio>`)
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
      body { margin: 0; background: #000; font-family: "Be Vietnam Pro", sans-serif; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #cam { position: absolute; inset: 0; transform-origin: 50% 32%; }
      #aroll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .shade { position: absolute; inset: 0; pointer-events: none;
        background: linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 55%, rgba(0,0,0,.45) 100%); }
      .cap { position: absolute; left: 110px; right: 110px; top: 1190px; display: flex; justify-content: center; }
      .cap-in { display: block; text-align: center; font-weight: 900; font-size: 74px; line-height: 1.15; color: #fff;
        text-transform: uppercase; letter-spacing: -0.01em;
        text-shadow: 0 0 2px #000, 0 4px 0 #000, 0 6px 18px rgba(0,0,0,.65); -webkit-text-stroke: 3px #000; paint-order: stroke fill; }
      .cap-in .hot { color: #ffd60a; }
      .pop { position: absolute; left: 70px; right: 70px; top: 250px; display: flex; justify-content: center; }
      .pop-in { display: block; text-align: center; }
      .pop-t { display: inline-block; background: #ffd60a; color: #111; font-weight: 900; font-size: 92px; line-height: 1.05;
        padding: 18px 34px 22px; border-radius: 18px; transform: rotate(-2deg); box-shadow: 0 14px 40px rgba(0,0,0,.45); }
      .pop-s { margin-top: 22px; color: #fff; font-weight: 800; font-size: 46px; text-shadow: 0 3px 14px rgba(0,0,0,.8); }
      #hook { position: absolute; left: 70px; right: 70px; top: 200px; }
      #hook-in { display: block; text-align: center; color: #fff; font-weight: 900; font-size: 108px; line-height: 1.04;
        text-transform: uppercase; letter-spacing: -0.02em; text-shadow: 0 6px 30px rgba(0,0,0,.8); -webkit-text-stroke: 4px #000; paint-order: stroke fill; }
      #hook-in em { font-style: normal; color: #ffd60a; }
      #cta { position: absolute; inset: 0; }
      #cta-bg { position: absolute; inset: 0; background: rgba(0,0,0,.62); }
      #cta-card { position: absolute; left: 90px; right: 90px; top: 760px; display: block; text-align: center;
        background: #ffd60a; color: #111; border-radius: 28px; padding: 48px 40px; }
      #cta-t { font-weight: 900; font-size: 76px; line-height: 1.1; text-transform: uppercase; }
      #cta-s { font-weight: 800; font-size: 40px; margin-top: 18px; opacity: .8; }
      .bar { position: absolute; left: 0; right: 0; top: 0; height: 10px; background: rgba(255,255,255,.18); }
      #bar-fill { display: block; width: 100%; height: 100%; background: #ffd60a; transform-origin: 0 50%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="recut" data-start="0" data-width="1080" data-height="1920" data-duration="${TOTAL}">
      <div id="cam">
        <video id="aroll" class="clip" src="assets/aroll.mp4" data-start="0" data-duration="${TOTAL}" data-track-index="0" data-has-audio="true" playsinline></video>
      </div>
      <div class="shade"></div>
      <div class="clip" id="hook" data-start="0" data-duration="${HOOK_DUR}" data-track-index="4"><div id="hook-in">${esc(plan.hookTitle).replace(/(\d[\d.,%]*\s*\S*)/, "<em>$1</em>")}</div></div>
      ${capHtml}
      ${popHtml}
      <div class="clip" id="cta" data-start="${r2(ACT)}" data-duration="${CTA_DUR}" data-track-index="5">
        <div id="cta-bg"></div>
        <div id="cta-card"><div id="cta-t">${esc(plan.cta)}</div><div id="cta-s">Theo dõi để xem phân tích dự án tiếp theo</div></div>
      </div>
      <div class="bar"><span id="bar-fill"></span></div>
      ${sfxHtml}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const ACT = ${ACT}, TOTAL = ${TOTAL}, HOOK = ${HOOK_DUR};
      const cuts = ${JSON.stringify(cuts)};
      const pops = ${JSON.stringify(pops.map((p) => p.at))};

      tl.fromTo("#bar-fill", { scaleX: 0 }, { scaleX: 1, duration: ACT, ease: "none" }, 0);

      // Zoom: mở đầu đẩy vào, mỗi điểm cắt đổi khung (jump-cut punch), pop thì đẩy sâu hơn
      tl.fromTo("#cam", { scale: 1.28 }, { scale: 1.06, duration: 0.7, ease: "power3.out" }, 0);
      cuts.forEach((c, i) => tl.set("#cam", { scale: i % 2 ? 1.06 : 1.16 }, c));
      pops.forEach((p) => tl.to("#cam", { scale: "+=0.08", duration: 0.35, ease: "power2.out" }, p - 0.05));
      tl.to("#cam", { scale: 1, duration: 0.6, ease: "power2.inOut" }, ACT);

      // Hook
      tl.fromTo("#hook-in", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)" }, 0.05);
      tl.to("#hook-in", { opacity: 0, y: -40, duration: 0.3, ease: "power2.in" }, HOOK - 0.35);

      // Phụ đề bật nhẹ
      document.querySelectorAll(".cap").forEach((el) => {
        const st = parseFloat(el.dataset.start);
        tl.fromTo(el.firstElementChild, { scale: 0.86, y: 14 }, { scale: 1, y: 0, duration: 0.16, ease: "back.out(2.5)" }, st);
      });

      // Text pop
      document.querySelectorAll(".pop").forEach((el) => {
        const st = parseFloat(el.dataset.start), d = parseFloat(el.dataset.duration);
        const inner = el.firstElementChild;
        tl.fromTo(inner, { scale: 0.4, opacity: 0, y: -30 }, { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: "back.out(2.2)" }, st);
        tl.to(inner, { scale: 0.9, opacity: 0, duration: 0.25, ease: "power2.in" }, st + d - 0.28);
      });

      // CTA
      tl.fromTo("#cta-bg", { opacity: 0 }, { opacity: 1, duration: 0.3 }, ACT);
      tl.fromTo("#cta-card", { y: 120, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)" }, ACT + 0.1);

      window.__timelines["recut"] = tl;
    </script>
  </body>
</html>
`;
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(work, "timeline.json"), JSON.stringify({ pieces: pieces.map((p) => ({ seg: p.seg.i, a: r2(p.a), b: r2(p.b), out: r2(p.out) })), captions, pops, sfxCues }, null, 1));
console.log(`✔ ${path.relative(ROOT, out)}/index.html · ${TOTAL}s · ${captions.length} phụ đề · ${pops.length} pop · ${sfxCues.length} SFX`);

if (!process.argv.includes("--no-render")) {
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" };
  execFileSync("npx", ["hyperframes", "render", "-o", "output.mp4"], { cwd: out, stdio: "inherit", env });
}
