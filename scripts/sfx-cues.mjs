// Gắn SFX từ thư viện chung (sfx/) vào một composition HyperFrames.
//   sfxHtml(cues, outDir, { gainDb = 0, minGap = 1.2 })
// cues: [{ at: giây, name: "pop", vol?: 0.3–1.0 }] — vol mặc định 0.8.
// Thư viện đã chuẩn hóa ở mức thấp hơn voice ~14–18 dB; gainDb nâng cả bộ (có limiter chặn đỉnh -3 dBFS).
// minGap: khoảng cách tối thiểu giữa 2 SFX — chống lạm dụng.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "sfx/catalog.json"), "utf8"));

// Phiên bản: tên gốc (vd "pop") → ["pop", "pop-2", "pop-3"] nếu thư viện có.
const VARIANTS = {};
for (const [k, e] of Object.entries(catalog)) (VARIANTS[e.base ?? k] ??= []).push(k);
for (const v of Object.values(VARIANTS)) v.sort((a, b) => (catalog[a].variant ?? 1) - (catalog[b].variant ?? 1));

// Gán phiên bản: trong CÙNG một cảnh luôn dùng 1 phiên bản (pop pop pop), sang cảnh mới thì đổi
// phiên bản kế tiếp. Cảnh = khoảng giữa 2 mốc trong `scenes`; cue có thể ép bằng "group" hoặc tên đầy đủ "pop-2".
function assignVariants(cues, scenes) {
  const groupOf = (c) => c.group ?? scenes.filter((t) => t <= c.at + 1e-6).length;
  const seen = {}; // base → [group…] theo thứ tự xuất hiện
  return cues.map((c) => {
    if (catalog[c.name] && /-\d+$/.test(c.name)) return c; // đã chỉ định phiên bản cụ thể
    const vs = VARIANTS[c.name];
    if (!vs) return c;
    const g = groupOf(c);
    const list = (seen[c.name] ??= []);
    if (!list.includes(g)) list.push(g);
    return { ...c, name: vs[list.indexOf(g) % vs.length] };
  });
}

export function sfxHtml(cues, outDir, { gainDb = 0, minGap = 1.2, scenes = [] } = {}) {
  fs.mkdirSync(path.join(outDir, "assets/sfx"), { recursive: true });
  const sorted = assignVariants([...cues].sort((a, b) => a.at - b.at), scenes);
  sorted.forEach((c, i) => {
    if (!catalog[c.name]) throw new Error(`SFX không có trong thư viện: ${c.name}`);
    if (i && c.at - sorted[i - 1].at < minGap - 1e-6) throw new Error(`SFX quá dày ở ${c.at}s (cách ${sorted[i - 1].name} < ${minGap}s)`);
  });
  for (const n of new Set(sorted.map((c) => c.name))) {
    const src = path.join(ROOT, "sfx", catalog[n].file);
    const dst = path.join(outDir, "assets/sfx", catalog[n].file);
    if (gainDb) execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-af", `volume=${gainDb}dB,alimiter=limit=0.7:level=false`, dst]);
    else fs.copyFileSync(src, dst);
  }
  return sorted
    .map((c, i) => {
      const e = catalog[c.name];
      return `<audio id="sfx-${i}" src="assets/sfx/${e.file}" data-start="${c.at}" data-duration="${e.duration}" data-track-index="${10 + (i % 3)}" data-volume="${Math.min(1, c.vol ?? 0.8)}"></audio>`;
    })
    .join("\n      ");
}
