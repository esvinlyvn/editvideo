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

// ---------- 4. Phụ đề: câu ngắn ≤ 9 từ, ngắt ở dấu câu, chia theo mảnh speech ----------
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
      if ((/[,.!?:;]$/.test(w) && g.length >= 4) || (g.length >= 9 && !inName) || g.length >= 12) groups.push(g), (g = []);
    });
    if (g.length) groups.length && g.length < 3 ? groups[groups.length - 1].push(...g) : groups.push(g);
    let acc = p.out + 0.04;
    const span = p.len - 0.04;
    groups.forEach((gr) => {
      const d = (gr.length / chunk.length) * span;
      captions.push({ start: r2(acc), dur: r2(d), text: gr.join(" ") });
      acc += d;
    });
  });
}

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
      :root { --accent: #e6c27a; --glass: rgba(14, 16, 20, 0.66); --line: rgba(255, 255, 255, 0.14); }
      body { margin: 0; background: #000; font-family: "Be Vietnam Pro", sans-serif; color: #fff; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #cam { position: absolute; inset: 0; transform-origin: 50% 32%; }
      #aroll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .top-shade { position: absolute; left: 0; right: 0; top: 0; height: 640px;
        background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,.18) 60%, rgba(0,0,0,0) 100%); }

      /* Phụ đề: gọn, dễ đọc, không giành sự chú ý */
      .cap { position: absolute; left: 90px; right: 90px; top: 1350px; display: flex; justify-content: center; }
      .cap-in { margin: 0; max-width: 860px; text-align: center; font-weight: 600; font-size: 44px; line-height: 1.4;
        padding: 10px 24px 12px; border-radius: 14px; background: rgba(0, 0, 0, 0.58);
        -webkit-box-decoration-break: clone; box-decoration-break: clone; text-wrap: balance; }

      /* Thẻ thông tin */
      .co { position: absolute; left: 64px; top: 168px; }
      .co-card { position: relative; display: block; max-width: 720px; padding: 26px 36px 30px 44px; border-radius: 22px;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(140%);
        box-shadow: 0 18px 50px rgba(0,0,0,.35); overflow: hidden; }
      .co-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: var(--accent); transform-origin: 50% 0; }
      .co-label { font-weight: 600; font-size: 26px; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); }
      .co-value { font-weight: 800; font-size: 104px; line-height: 1.02; letter-spacing: -0.025em; margin-top: 10px; }
      .co-value.long { font-size: 70px; line-height: 1.08; }
      .co-sub { text-wrap: balance; font-weight: 500; font-size: 32px; line-height: 1.35; margin-top: 14px; color: rgba(255,255,255,.82); }

      /* Hook */
      #hook { position: absolute; left: 64px; right: 64px; top: 168px; }
      #hook-in { display: block; max-width: 900px; padding: 28px 36px 34px 44px; border-radius: 22px; position: relative; overflow: hidden;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px) saturate(140%); box-shadow: 0 18px 50px rgba(0,0,0,.35); }
      #hook-label { display: inline-block; font-weight: 600; font-size: 28px; letter-spacing: .2em; text-transform: uppercase;
        color: #111; background: var(--accent); padding: 8px 18px; border-radius: 8px; }
      #hook-title { font-weight: 800; font-size: 82px; line-height: 1.1; letter-spacing: -0.02em; margin-top: 22px;
        text-wrap: balance; }
      #hook-rule { display: block; width: 180px; height: 8px; margin-top: 26px; background: var(--accent); border-radius: 4px; transform-origin: 0 50%; }

      /* CTA */
      #cta { position: absolute; inset: 0; }
      #cta-bg { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
      #cta-card { position: absolute; left: 80px; right: 80px; top: 720px; display: block; padding: 46px 48px 50px; border-radius: 28px;
        background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); text-align: center; }
      #cta-label { font-weight: 600; font-size: 28px; letter-spacing: .2em; text-transform: uppercase; color: var(--accent); }
      #cta-t { font-weight: 800; font-size: 64px; line-height: 1.15; margin-top: 18px; text-wrap: balance; }
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
