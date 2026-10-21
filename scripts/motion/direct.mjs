#!/usr/bin/env node
// Đạo diễn chuyển động tự động: đọc kịch bản + mốc cảnh + chỉ dẫn hình ảnh, chấm từng cảnh và quyết định
// có dùng hiệu ứng Motion Prompt hay không. Không cần người chọn hiệu ứng.
//   node scripts/motion/direct.mjs projects/post-N [--html build/post-N/index.html] [--out plan.json] [--quiet]
// Đầu vào:
//   transcript.json (bắt buộc) · sfx.json "scenes" (mốc cảnh; không có thì tự chia theo khoảng lặng)
//   motion.json (tùy chọn): { "enabled": true, "tone": "auto|playful|calm|solemn|tech", "deny": ["024"], "allow": [...],
//                            "shots": [{ "at": 12.3, "brief": "chỉ dẫn hình ảnh…", "effect": "005" | "none", "selector": "#t3" }] }
// Đầu ra: plan { duration, tone, items[], scenes[] (mọi cảnh, kể cả cảnh bỏ qua, kèm lý do) }
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REG = JSON.parse(fs.readFileSync(path.join(HERE, "registry.json"), "utf8"));
const CHARS = JSON.parse(fs.readFileSync(path.join(HERE, "characters.json"), "utf8")).characters;
const BY_ID = Object.fromEntries(REG.effects.map((e) => [e.id, e]));

// ---------- nhận diện ý đồ của cảnh (tiếng Việt, cả Nam lẫn Bắc) ----------
const YEAR = /^(1[89]|20)\d{2}$/;
const RULES = [
  ["number", (s) => (s.match(/\d+(?:[.,]\d+)*/g) || []).some((n) => !YEAR.test(n) && parseFloat(n.replace(/\./g, "")) >= 2)],
  ["punch", (s) => /(^|[\s,])(ủa|trời|trời đất|hả\?|bất ngờ|hóa ra|té ra|thì ra|ngờ đâu|hết hồn|dữ thần|luôn!)/.test(s) || /[^.?]{4,60}!\s*$/.test(s)],
  ["surprise", (s) => /(bất ngờ|không ngờ|ai dè|hóa ra|té ra|thì ra|tự nhiên)/.test(s)],
  ["contrast", (s) => /(tưởng|ai dè|ngờ đâu|trong khi đó|đùng một cái|mà thực tế)/.test(s)],
  ["truth", (s) => /(^|\s)(nhưng|thật ra|thực ra|sự thật|không phải|hiểu lầm|ngược lại|mà là)(\s|,)/.test(s)],
  ["question", (s) => /\?|(tại sao|vì sao|là gì|như thế nào|ra sao|bao nhiêu)/.test(s)],
  ["list", (s) => /(thứ nhất|thứ hai|một là|hai là|đầu tiên|tiếp theo|bước \d|bước một)/.test(s) || (s.match(/,/g) || []).length >= 2 && /\svà\s/.test(s)],
  ["key", (s) => /(quan trọng|chính là|bí quyết|mẹo|lưu ý|cần tránh|mấu chốt|nhớ nha|nhớ là)/.test(s)],
  ["tech", (s) => /(\bapp\b|ứng dụng|điện thoại|dữ liệu|mã qr|\bqr\b|wifi|máy tính|hệ thống|thuật toán|mật khẩu|sonar|laser|tín hiệu)/.test(s)],
  ["drop", (s) => /(rơi|rớt|thả|đổ nguyên|quăng|ném)/.test(s)],
  ["emotion", (s) => /(nhớ nhà|thương|ba má|kỷ niệm|lặng|cô đơn|hy sinh|biết ơn|tri ân|bình thường cũng)/.test(s)],
  ["shift", (s) => /^(còn|giờ|bây giờ|quay lại|chuyển qua|mặt khác|ngoài ra|bởi vậy|vậy nên|năm \d{4})/.test(s)],
  ["info", (s) => /(nghiên cứu|theo |khoảng|phần trăm|%|độ c|nhiệt độ|áp suất|tỉ lệ)/.test(s)],
  ["object", (s) => /(cái |chiếc |tấm |thẻ |hộp |dĩa |chai |bao )/.test(s)],
  ["cta", (s) => /(follow|theo dõi|\bflo\b)/.test(s)],
];
// Trọng số: ý đồ chính của hiệu ứng (đứng đầu danh sách) = 3, ý đồ phụ = 2
function scoreEffect(eff, intents) {
  let s = 0;
  eff.intents.forEach((it, k) => intents.has(it) && (s += k === 0 ? 3 : 2));
  return s;
}

export function direct(projectDir, { html: htmlPath, quiet, exclude = new Set() } = {}) {
  const dir = path.resolve(projectDir);
  const post = path.basename(dir);
  const T = JSON.parse(fs.readFileSync(path.join(dir, "transcript.json"), "utf8"));
  const chunks = T.chunks || T;
  const sfx = fs.existsSync(path.join(dir, "sfx.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "sfx.json"), "utf8")) : null;
  const cfg = fs.existsSync(path.join(dir, "motion.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "motion.json"), "utf8")) : {};
  const html = htmlPath && fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
  const stageText = html
    .replace(/<div class="clip cap"[\s\S]*?<\/div>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ");

  let duration = Number((html.match(/data-composition-id="[^"]+"[^>]*data-duration="([\d.]+)"/) || [])[1]);
  if (!duration) {
    const v = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "voice.wav")]).toString());
    duration = Math.round((v + 3.2) * 100) / 100;
  }

  // ---------- chia cảnh ----------
  let starts = sfx && !Array.isArray(sfx) && Array.isArray(sfx.scenes) && sfx.scenes.length ? [...sfx.scenes] : null;
  if (!starts) {
    starts = [0];
    chunks.forEach((c, i) => i && c.start - chunks[i - 1].end > 0.5 && c.start - starts.at(-1) > 3 && starts.push(Math.max(0, c.start - 0.2)));
  }
  starts = starts.sort((a, b) => a - b);
  const cues = sfx ? (Array.isArray(sfx) ? sfx : sfx.cues || []) : [];
  const scenes = starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : duration;
    const lines = chunks.filter((c) => c.start >= s - 0.25 && c.start < end - 0.25).map((c) => c.text);
    const shot = (cfg.shots || []).find((sh) => sh.at >= s - 0.3 && sh.at < end - 0.3);
    // nhịp thoại: số chữ / giây nói thật (bỏ khoảng lặng)
    const spoken = chunks.filter((c) => c.start >= s - 0.25 && c.start < end - 0.25).reduce((a, c) => a + (c.end - c.start), 0);
    const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
    return { k, start: s, end, dur: end - s, text: lines.join(" "), shot, pace: spoken > 0.3 ? words / spoken : 0 };
  });

  // ---------- tone ----------
  const all = chunks.map((c) => c.text).join(" ").toLowerCase();
  let tone = cfg.tone && cfg.tone !== "auto" ? cfg.tone : null;
  if (!tone) {
    const solemn = (all.match(/(liệt sĩ|hy sinh|tưởng niệm|qua đời|chiến tranh|nghĩa trang|tang lễ|mộ )/g) || []).length;
    const techN = scenes.filter((s) => RULES.find((r) => r[0] === "tech")[1](s.text.toLowerCase())).length;
    const emo = (all.match(/(thương|nhớ|kỷ niệm|ba má|cô đơn|bình yên)/g) || []).length;
    const bang = (all.match(/!/g) || []).length;
    tone = solemn >= 2 ? "solemn" : techN >= scenes.length * 0.35 ? "tech" : emo >= 4 && bang <= 3 ? "calm" : "playful";
  }

  // ---------- chấm điểm từng cặp (cảnh, hiệu ứng) ----------
  const deny = new Set(cfg.deny || []), allow = cfg.allow ? new Set(cfg.allow) : null;
  const greet = Object.values(CHARS).flatMap((c) => c.match);
  const pairs = [];
  for (const sc of scenes) {
    const low = sc.text.toLowerCase();
    const brief = (sc.shot && sc.shot.brief ? sc.shot.brief : "").toLowerCase();
    const intents = new Set(RULES.filter(([, f]) => f(low) || (brief && f(brief))).map(([n]) => n));
    if (sc.k === scenes.length - 1) intents.add("ending");
    const charKey = Object.entries(CHARS).find(([, c]) => c.match.some((m) => low.includes(m)))?.[0];
    if (charKey) intents.add("character");
    if (intents.has("punch") || intents.has("surprise")) intents.add("emphasis");
    // số liệu phải thật sự hiện trên hình (không chỉ nằm trong phụ đề)
    if (intents.has("number") && html) {
      const nums = (sc.text.match(/\d+(?:[.,]\d+)*/g) || []).filter((n) => !YEAR.test(n));
      if (!nums.some((n) => stageText.includes(n))) intents.delete("number");
    }
    sc.intents = [...intents];
    sc.character = charKey || null;
    if (cfg.enabled === false) continue;
    if (sc.shot && sc.shot.effect === "none") continue;
    for (const eff of REG.effects) {
      if (deny.has(eff.id) || (allow && !allow.has(eff.id))) continue;
      if (exclude.has(`${sc.start}|${eff.id}`)) continue; // lượt trước đã thử, không gắn được vào cảnh này
      const forced = sc.shot && sc.shot.effect === eff.id;
      if (eff.manualOnly && !forced) continue;
      let score = forced ? 99 : scoreEffect(eff, intents);
      // câu nói chậm, lắng (< 2,6 chữ/giây) thì hạ điểm hiệu ứng mạnh; câu nhanh, dồn dập thì cộng nhẹ
      if (!forced && eff.energy === 3) score += sc.pace && sc.pace < 2.6 ? -2 : sc.pace > 4 ? 1 : 0;
      if (brief && (brief.includes(eff.name.toLowerCase()) || brief.includes(eff.vi.toLowerCase()) || brief.includes(`#${eff.id}`))) score += 3;
      if (!forced) {
        if (!eff.tones.includes(tone)) continue;
        if (sc.dur < eff.minSlot) continue;
        if (charKey && CHARS[charKey].deny.includes(eff.id)) continue;
        if (eff.intents[0] === "character" && !charKey) continue;
        if (eff.role === "stage" && sc.k === 0) continue; // không có cảnh trước để chuyển
      }
      if (score >= 3) pairs.push({ sc, eff, score, forced });
    }
  }

  // ---------- chọn có ngân sách (tránh dùng tràn lan) ----------
  const budget = { total: cfg.maxEffects ?? Math.max(3, Math.round(duration / 15)), frame: Math.max(1, Math.round(duration / 30)), gap: 5, frameGap: 15, sameGap: 12 };
  if (tone === "solemn") (budget.total = Math.max(2, Math.round(duration / 45))), (budget.frame = 1);
  const at = (p) => p.sc.start;
  const chosen = [];
  pairs.sort((a, b) => b.score - a.score || b.eff.energy - a.eff.energy || at(a) - at(b));
  const reasonsSkip = new Map();
  const note = (sc, r) => reasonsSkip.has(sc.k) || reasonsSkip.set(sc.k, r);
  for (const p of pairs) {
    const { sc, eff } = p;
    if (chosen.some((c) => c.sc === sc)) continue;
    if (!p.forced) {
      if (sc.k === 0 && eff.intents[0] !== "number") { note(sc, "mở đầu: để hình ảnh thực tế và nhịp kể dẫn dắt, chỉ nhận hiệu ứng có chức năng (số liệu)"); continue; }
      if (chosen.length >= budget.total) { note(sc, `đã đủ ngân sách ${budget.total} hiệu ứng`); continue; }
      if (eff.footprint === "frame" && chosen.filter((c) => c.eff.footprint === "frame").length >= budget.frame) { note(sc, "đã đủ hiệu ứng toàn khung"); continue; }
      if (chosen.filter((c) => c.eff.id === eff.id).length >= eff.max) continue;
      if (chosen.some((c) => Math.abs(at(c) - sc.start) < budget.gap)) { note(sc, "quá gần hiệu ứng khác (< 5 s), giữ nhịp nghỉ"); continue; }
      if (eff.footprint === "frame" && chosen.some((c) => c.eff.footprint === "frame" && Math.abs(at(c) - sc.start) < budget.frameGap)) continue;
      if (chosen.some((c) => c.eff.id === eff.id && Math.abs(at(c) - sc.start) < budget.sameGap)) continue;
    }
    chosen.push(p);
  }
  chosen.sort((a, b) => at(a) - at(b));

  const sfxNear = (t, w = 0.4) => cues.filter((c) => Math.abs(c.at - t) <= w).map((c) => c.name);
  const SFX_HINT = { impactShake: "stamp", whipPan: "whoosh-fast", smashCut: "record-scratch", countUp: "tick", popIn: "pop", overshoot: "pop", bounceDrop: "boing", stagger: "pop", lightSweep: "shimmer", pulse: "pop", scramble: "glitch", maskReveal: "whoosh-soft" };
  const items = chosen.map((p, n) => {
    const fb = [];
    for (let id = p.eff.fallback; id && BY_ID[id] && !fb.some((f) => f.id === id); id = BY_ID[id].fallback) {
      if (p.sc.character && CHARS[p.sc.character].deny.includes(id)) break;
      fb.push({ id, fx: BY_ID[id].fx, role: BY_ID[id].role });
    }
    const near = sfxNear(p.sc.start + (p.eff.fx === "impactShake" ? 0.5 : 0), 0.6);
    return {
      n, id: p.eff.id, fx: p.eff.fx, name: p.eff.name, role: p.eff.role, footprint: p.eff.footprint,
      at: Math.round(p.sc.start * 1000) / 1000, end: Math.round(p.sc.end * 1000) / 1000,
      selector: p.sc.shot?.selector, fallback: fb, score: p.score, intents: p.sc.intents,
      reason: p.forced ? "chỉ định trong motion.json" : `ý đồ: ${p.sc.intents.filter((i) => p.eff.intents.includes(i)).join(", ")} → ${p.eff.vi}`,
      sfx: near.length ? `có sẵn: ${near.join(", ")}` : `gợi ý thêm: ${SFX_HINT[p.eff.fx] || "—"}`,
      text: p.sc.text.slice(0, 90),
    };
  });
  const plan = {
    post, duration, tone, budget, source: REG.source,
    limits: Object.fromEntries(REG.effects.map((e) => [e.fx, e.max])), // runtime chặn cả hiệu ứng dự phòng vượt trần
    items,
    scenes: scenes.map((sc) => {
      const it = items.find((i) => i.at === Math.round(sc.start * 1000) / 1000);
      return { k: sc.k, start: sc.start, end: sc.end, intents: sc.intents, character: sc.character, decision: it ? `#${it.id} ${it.name}` : "giữ nguyên",
        why: it ? it.reason : sc.shot?.effect === "none" ? "chỉ định không dùng" : reasonsSkip.get(sc.k) || (sc.intents.length ? "không có hiệu ứng nào đủ hợp (điểm < 3, sai tone, hoặc cảnh quá ngắn)" : "cảnh kể chuyện thường, chuyển động gốc đã đủ"), text: sc.text.slice(0, 70) };
    }),
  };
  if (!quiet) printPlan(plan);
  return plan;
}

export function printPlan(plan) {
  console.log(`\n🎬 ${plan.post} · ${plan.duration}s · tone ${plan.tone} · ${plan.items.length}/${plan.scenes.length} cảnh dùng Motion Prompt (ngân sách ${plan.budget.total}, toàn khung ${plan.budget.frame})`);
  for (const s of plan.scenes) console.log(`  ${s.start.toFixed(1).padStart(5)}s  ${s.decision.padEnd(22)} ${s.why}${s.intents.length ? `  [${s.intents.join(",")}]` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const proj = args.find((a) => !a.startsWith("--"));
  if (!proj) { console.error("Cách dùng: node scripts/motion/direct.mjs projects/post-N [--html build/post-N/index.html] [--out plan.json]"); process.exit(2); }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const html = opt("--html") || path.join("build", path.basename(proj), "index.html");
  const plan = direct(proj, { html, quiet: args.includes("--quiet") });
  if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify(plan, null, 1));
}
