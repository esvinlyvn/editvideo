#!/usr/bin/env node
// Sinh một project HyperFrames (video dọc 1080x1920) từ thư mục listing:
//   listings/<slug>/listing.json + photos/
// Kết quả: build/<slug>/index.html + assets, sẵn sàng `hyperframes check/render`.
//
// Dùng: node scripts/build.mjs listings/the-riverside-2pn
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listingDir = path.resolve(process.argv[2] ?? "");
const listingFile = path.join(listingDir, "listing.json");
if (!fs.existsSync(listingFile)) {
  console.error("Không tìm thấy listing.json. Dùng: node scripts/build.mjs listings/<slug>");
  process.exit(1);
}
const L = JSON.parse(fs.readFileSync(listingFile, "utf8"));
const slug = path.basename(listingDir);
const outDir = path.join(ROOT, "build", slug);

// ---------- Thời lượng từng cảnh (giây) ----------
const FADE = 0.6; // crossfade giữa các cảnh
const T_HERO = 5;
const T_PHOTO = 3.5;
const T_STATS = 5;
const T_NEARBY = L.nearby?.length ? 4.5 : 0;
const T_CTA = 5;

// Giọng đọc (nếu đã chạy scripts/voice.mjs): cảnh tự giãn cho vừa câu đọc.
const VO_LEAD = 0.4; // giọng bắt đầu sau khi cảnh vào
const VO_TAIL = 0.35; // khoảng nghỉ trước khi chuyển cảnh
const voPath = path.join(listingDir, "voice/manifest.json");
const VO = fs.existsSync(voPath) ? JSON.parse(fs.readFileSync(voPath, "utf8")) : {};

const scenes = [];
let cursor = 0;
const push = (id, base) => {
  const dur = VO[id] ? Math.max(base, Math.ceil((VO_LEAD + VO[id].duration + VO_TAIL) * 10) / 10) : base;
  scenes.push({ id, start: cursor, dur });
  cursor += dur;
};
push("hero", T_HERO);
L.gallery.forEach((_, i) => push(`photo-${i}`, T_PHOTO));
push("stats", T_STATS);
if (T_NEARBY) push("nearby", T_NEARBY);
push("cta", T_CTA);
const TOTAL = cursor;
const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
// Mỗi clip kéo dài thêm FADE để cảnh sau fade-in đè lên (trừ cảnh cuối).
const clipAttrs = (s, track) => {
  const last = s === scenes.at(-1);
  return `data-start="${s.start}" data-duration="${last ? s.dur : s.dur + FADE}" data-track-index="${track}"`;
};

// ---------- Copy assets ----------
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "assets/fonts"), { recursive: true });
fs.mkdirSync(path.join(outDir, "assets/vendor"), { recursive: true });
fs.copyFileSync(
  path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"),
  path.join(outDir, "assets/vendor/gsap.min.js"),
);

// Font Be Vietnam Pro (có đủ dấu tiếng Việt), chỉ lấy woff2 + giữ unicode-range.
const fontPkg = path.join(ROOT, "node_modules/@fontsource/be-vietnam-pro");
let fontCss = "";
for (const w of [400, 600, 800]) {
  const css = fs.readFileSync(path.join(fontPkg, `${w}.css`), "utf8");
  fontCss += css.replace(/url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\),\s*url\([^)]+\) format\('woff'\)/g, (_, f) => {
    fs.copyFileSync(path.join(fontPkg, "files", f), path.join(outDir, "assets/fonts", f));
    return `url(assets/fonts/${f}) format('woff2')`;
  });
}

const copyMedia = (rel) => {
  const dest = path.join("assets/media", path.basename(rel));
  fs.mkdirSync(path.join(outDir, "assets/media"), { recursive: true });
  fs.copyFileSync(path.join(listingDir, rel), path.join(outDir, dest));
  return dest;
};
const hero = copyMedia(L.hero);
const gallery = L.gallery.map((g) => ({ ...g, src: copyMedia(g.src) }));
const music = L.music ? copyMedia(L.music) : null;
const voices = scenes
  .filter((s) => VO[s.id])
  .map((s) => ({ id: s.id, src: copyMedia(VO[s.id].file), start: Math.round((s.start + VO_LEAD) * 100) / 100, dur: VO[s.id].duration }));

// ---------- HTML ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const photoScenes = gallery
  .map((g, i) => {
    const s = S[`photo-${i}`];
    return `
      <section id="photo-${i}" class="clip scene" ${clipAttrs(s, 1)}>
        <div class="scene-in" data-layout-allow-overlap data-layout-allow-occlusion id="photo-${i}-in">
          <img class="kb" data-layout-allow-overflow id="photo-${i}-img" src="${esc(g.src)}" alt="" />
          <div class="shade-bottom"></div>
          <div class="caption-wrap txt">
            <div class="counter" id="photo-${i}-count">${String(i + 1).padStart(2, "0")} / ${String(gallery.length).padStart(2, "0")}</div>
            <div class="caption" id="photo-${i}-cap">${esc(g.caption)}</div>
          </div>
        </div>
      </section>`;
  })
  .join("");

const statCells = L.stats
  .map(
    (st, i) => `
          <div class="stat" id="stat-${i}">
            <div class="stat-num"><span id="stat-${i}-v">${st.value}</span><small>${esc(st.unit)}</small></div>
            <div class="stat-label">${esc(st.label)}</div>
          </div>`,
  )
  .join("");

const nearbyRows = (L.nearby ?? [])
  .map(
    (n, i) => `
          <div class="near" id="near-${i}">
            <div class="near-min">${n.minutes}<small>phút</small></div>
            <div class="near-place">${esc(n.place)}</div>
          </div>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${esc(L.title)} · ${esc(L.project)}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
${fontCss}
      :root {
        --ink: #14110f;
        --paper: #f6f1ea;
        --gold: #c9a46a;
        --muted: rgba(246, 241, 234, 0.72);
      }
      body {
        margin: 0;
        background: var(--ink);
        color: var(--paper);
        font-family: "Be Vietnam Pro", sans-serif;
      }
      #root {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--ink);
      }
      .scene {
        position: absolute;
        inset: 0;
      }
      .scene-in {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: var(--ink);
      }
      .kb {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .shade-bottom {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(20, 17, 15, 0.55) 0%, rgba(20, 17, 15, 0) 28%, rgba(20, 17, 15, 0) 50%, rgba(20, 17, 15, 0.88) 100%);
      }

      /* HERO */
      .hero-top {
        position: absolute;
        top: 120px;
        left: 80px;
        right: 80px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .brand {
        font-weight: 800;
        letter-spacing: 0.32em;
        font-size: 30px;
      }
      .pill {
        font-weight: 600;
        font-size: 26px;
        padding: 12px 26px;
        border: 2px solid var(--gold);
        color: var(--gold);
        border-radius: 999px;
      }
      .hero-text {
        position: absolute;
        left: 80px;
        right: 80px;
        bottom: 240px;
      }
      .hero-title {
        font-weight: 800;
        font-size: 124px;
        line-height: 1.02;
        letter-spacing: -0.02em;
        margin: 0;
      }
      .rule {
        width: 160px;
        height: 6px;
        background: var(--gold);
        margin: 48px 0 36px;
      }
      .hero-project {
        font-weight: 600;
        font-size: 48px;
      }
      .hero-loc {
        font-weight: 400;
        font-size: 36px;
        color: var(--muted);
        margin-top: 12px;
      }

      /* GALLERY */
      .caption-wrap {
        position: absolute;
        left: 80px;
        right: 80px;
        bottom: 220px;
      }
      .counter {
        font-weight: 600;
        font-size: 28px;
        letter-spacing: 0.2em;
        color: var(--gold);
        margin-bottom: 20px;
      }
      .caption {
        font-weight: 800;
        font-size: 84px;
        line-height: 1.08;
        letter-spacing: -0.01em;
      }

      /* STATS */
      .panel {
        position: absolute;
        inset: 0;
        padding: 200px 80px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        background: radial-gradient(120% 80% at 20% 10%, #2a221c 0%, var(--ink) 60%);
      }
      .eyebrow {
        font-weight: 600;
        font-size: 30px;
        letter-spacing: 0.24em;
        color: var(--gold);
        text-transform: uppercase;
      }
      .panel-title {
        font-weight: 800;
        font-size: 92px;
        line-height: 1.05;
        margin: 24px 0 80px;
      }
      .stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
      }
      .stat {
        border-top: 3px solid rgba(201, 164, 106, 0.6);
        padding-top: 32px;
      }
      .stat-num {
        font-weight: 800;
        font-size: 150px;
        line-height: 1;
        letter-spacing: -0.03em;
      }
      .stat-num small {
        font-size: 52px;
        font-weight: 600;
        margin-left: 12px;
        color: var(--gold);
        letter-spacing: 0;
      }
      .stat-label {
        font-size: 34px;
        color: var(--muted);
        margin-top: 14px;
      }
      .direction {
        margin-top: 72px;
        font-size: 40px;
        font-weight: 600;
      }

      /* NEARBY */
      .near {
        display: flex;
        align-items: center;
        gap: 44px;
        padding: 44px 0;
        border-bottom: 2px solid rgba(246, 241, 234, 0.14);
      }
      .near-min {
        flex: 0 0 230px;
        font-weight: 800;
        font-size: 120px;
        line-height: 1;
        color: var(--gold);
      }
      .near-min small {
        font-size: 34px;
        font-weight: 600;
        margin-left: 10px;
        color: var(--muted);
      }
      .near-place {
        font-size: 48px;
        font-weight: 600;
        line-height: 1.2;
      }

      /* CTA */
      .cta-bg {
        position: absolute;
        inset: 0;
        background: rgba(20, 17, 15, 0.78);
      }
      .cta {
        position: absolute;
        inset: 0;
        padding: 0 80px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .price-label {
        font-size: 36px;
        font-weight: 600;
        letter-spacing: 0.2em;
        color: var(--gold);
      }
      .price {
        font-weight: 800;
        font-size: 210px;
        line-height: 1;
        letter-spacing: -0.03em;
        margin: 20px 0 24px;
      }
      .price-note {
        font-size: 36px;
        color: var(--muted);
      }
      .agent {
        margin-top: 120px;
        padding: 48px 52px;
        background: var(--paper);
        color: var(--ink);
        border-radius: 28px;
      }
      .agent-name {
        font-size: 40px;
        font-weight: 600;
      }
      .agent-phone {
        font-size: 88px;
        font-weight: 800;
        letter-spacing: -0.01em;
        margin-top: 8px;
      }
      .cta-brand {
        position: absolute;
        bottom: 140px;
        left: 80px;
        right: 80px;
        text-align: center;
        font-weight: 800;
        letter-spacing: 0.32em;
        font-size: 30px;
      }
      .progress {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 8px;
        background: rgba(246, 241, 234, 0.12);
      }
      #progress-bar {
        display: block;
        width: 100%;
        height: 100%;
        background: var(--gold);
        transform-origin: 0 50%;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="listing" data-start="0" data-width="1080" data-height="1920" data-duration="${TOTAL}">
      <section id="hero" class="clip scene" ${clipAttrs(S.hero, 0)}>
        <div class="scene-in" data-layout-allow-overlap data-layout-allow-occlusion id="hero-in">
          <img class="kb" data-layout-allow-overflow id="hero-img" src="${esc(hero)}" alt="" />
          <div class="shade-bottom"></div>
          <div class="hero-top txt">
            <div class="brand" id="hero-brand">${esc(L.brand)}</div>
            <div class="pill" id="hero-tag">${esc(L.tag)}</div>
          </div>
          <div class="hero-text txt">
            <h1 class="hero-title" id="hero-title">${esc(L.title)}</h1>
            <div class="rule" id="hero-rule"></div>
            <div class="hero-project" id="hero-project">${esc(L.project)}</div>
            <div class="hero-loc" id="hero-loc">${esc(L.location)}</div>
          </div>
        </div>
      </section>
${photoScenes}

      <section id="stats" class="clip scene" ${clipAttrs(S.stats, 2)}>
        <div class="scene-in" data-layout-allow-overlap data-layout-allow-occlusion id="stats-in">
          <div class="panel txt">
            <div class="eyebrow" id="stats-eyebrow">Thông số căn hộ</div>
            <div class="panel-title" id="stats-title">${esc(L.project)}</div>
            <div class="stats">${statCells}
            </div>
            <div class="direction" id="stats-dir">${esc(L.direction)}</div>
          </div>
        </div>
      </section>
${
  T_NEARBY
    ? `
      <section id="nearby" class="clip scene" ${clipAttrs(S.nearby, 2)}>
        <div class="scene-in" data-layout-allow-overlap data-layout-allow-occlusion id="nearby-in">
          <div class="panel txt">
            <div class="eyebrow" id="nearby-eyebrow">Kết nối</div>
            <div class="panel-title" id="nearby-title">${esc(L.location)}</div>
            <div>${nearbyRows}
            </div>
          </div>
        </div>
      </section>`
    : ""
}

      <section id="cta" class="clip scene" ${clipAttrs(S.cta, 3)}>
        <div class="scene-in" data-layout-allow-overlap data-layout-allow-occlusion id="cta-in">
          <div class="kb" data-layout-allow-overflow id="cta-img" style="background: center / cover url('${esc(gallery.at(-1)?.src ?? hero)}')"></div>
          <div class="cta-bg"></div>
          <div class="cta txt">
            <div class="price-label" id="cta-label">GIÁ CHỈ TỪ</div>
            <div class="price" id="cta-price">${esc(L.price)}</div>
            <div class="price-note" id="cta-note">${esc(L.priceNote)}</div>
            <div class="agent" id="cta-agent">
              <div class="agent-name">${esc(L.agent.name)} · Tư vấn 24/7</div>
              <div class="agent-phone">${esc(L.agent.phone)}</div>
            </div>
          </div>
          <div class="cta-brand" id="cta-brand">${esc(L.brand)}</div>
        </div>
      </section>

      <div class="progress"><span id="progress-bar"></span></div>
${
  music
    ? `
      <audio id="music" src="${esc(music)}" data-start="0" data-duration="${TOTAL}" data-track-index="9" data-volume="${voices.length ? 0.18 : 0.45}"></audio>`
    : ""
}${voices
  .map(
    (v) => `
      <audio id="vo-${v.id}" src="${esc(v.src)}" data-start="${v.start}" data-duration="${v.dur}" data-track-index="8" data-volume="1"></audio>`,
  )
  .join("")}
    </div>
    <script>
      const TOTAL = ${TOTAL};
      const FADE = ${FADE};
      const scenes = ${JSON.stringify(scenes)};
      const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
      const tl = gsap.timeline({ paused: true });

      // Thanh tiến trình chạy suốt video
      tl.fromTo("#progress-bar", { scaleX: 0 }, { scaleX: 1, duration: TOTAL, ease: "none" }, 0);

      // Crossfade: mỗi cảnh (trừ cảnh đầu) fade-in đè lên cảnh trước
      scenes.slice(1).forEach((s) => {
        tl.fromTo("#" + s.id + "-in", { opacity: 0 }, { opacity: 1, duration: FADE, ease: "power1.inOut" }, s.start);
      });

      // Chữ của cảnh cũ mờ đi trước khi crossfade, tránh chồng chữ
      scenes.slice(0, -1).forEach((s) => {
        tl.to("#" + s.id + "-in .txt", { opacity: 0, duration: 0.35, ease: "power1.in" }, s.start + s.dur - 0.3);
      });

      // Ken Burns: zoom chậm, xen kẽ hướng
      const kenBurns = (sel, s, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        tl.fromTo(
          sel,
          { scale: 1.18, xPercent: -3 * dir, yPercent: 0 },
          { scale: 1.04, xPercent: 3 * dir, yPercent: -2, duration: s.dur + FADE, ease: "none" },
          s.start,
        );
      };

      // HERO
      kenBurns("#hero-img", S.hero, 0);
      tl.fromTo("#hero-brand", { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.2);
      tl.fromTo("#hero-tag", { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.35);
      tl.fromTo("#hero-title", { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: 1, ease: "power4.out" }, 0.5);
      tl.fromTo("#hero-rule", { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, duration: 0.8, ease: "power3.inOut" }, 1.1);
      tl.fromTo("#hero-project", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 1.4);
      tl.fromTo("#hero-loc", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 1.6);

      // GALLERY
      scenes
        .filter((s) => s.id.startsWith("photo-"))
        .forEach((s, i) => {
          kenBurns("#" + s.id + "-img", s, i + 1);
          tl.fromTo("#" + s.id + "-count", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, s.start + 0.3);
          tl.fromTo("#" + s.id + "-cap", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.8, ease: "power4.out" }, s.start + 0.45);
        });

      // STATS (đếm số)
      const st = S.stats;
      tl.fromTo("#stats-eyebrow", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, st.start + 0.3);
      tl.fromTo("#stats-title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power4.out" }, st.start + 0.45);
      ${JSON.stringify(L.stats.map((x) => x.value))}.forEach((v, i) => {
        const at = st.start + 0.8 + i * 0.18;
        tl.fromTo("#stat-" + i, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, at);
        const o = { v: 0 };
        tl.to(o, {
          v,
          duration: 1.2,
          ease: "power2.out",
          onUpdate() {
            document.getElementById("stat-" + i + "-v").textContent = Math.round(o.v);
          },
        }, at);
      });
      tl.fromTo("#stats-dir", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, st.start + 1.8);

      // NEARBY
      if (S.nearby) {
        const nb = S.nearby;
        tl.fromTo("#nearby-eyebrow", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, nb.start + 0.3);
        tl.fromTo("#nearby-title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power4.out" }, nb.start + 0.45);
        document.querySelectorAll(".near").forEach((el, i) => {
          tl.fromTo(el, { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.7, ease: "power3.out" }, nb.start + 0.8 + i * 0.25);
        });
      }

      // CTA
      const c = S.cta;
      tl.fromTo("#cta-img", { scale: 1.25 }, { scale: 1.1, duration: c.dur, ease: "none" }, c.start);
      tl.fromTo("#cta-label", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, c.start + 0.3);
      tl.fromTo("#cta-price", { opacity: 0, scale: 0.85, transformOrigin: "0 50%" }, { opacity: 1, scale: 1, duration: 0.9, ease: "back.out(1.6)" }, c.start + 0.5);
      tl.fromTo("#cta-note", { opacity: 0 }, { opacity: 1, duration: 0.6 }, c.start + 1);
      tl.fromTo("#cta-agent", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.8, ease: "power4.out" }, c.start + 1.3);
      tl.fromTo("#cta-brand", { opacity: 0 }, { opacity: 1, duration: 0.6 }, c.start + 1.8);

      window.__timelines["listing"] = tl;
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log(`✔ ${path.relative(ROOT, outDir)}/index.html · ${scenes.length} cảnh · ${TOTAL}s`);
