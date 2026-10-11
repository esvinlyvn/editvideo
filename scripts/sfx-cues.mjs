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

export function sfxHtml(cues, outDir, { gainDb = 0, minGap = 1.2 } = {}) {
  fs.mkdirSync(path.join(outDir, "assets/sfx"), { recursive: true });
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  sorted.forEach((c, i) => {
    if (!catalog[c.name]) throw new Error(`SFX không có trong thư viện: ${c.name}`);
    if (i && c.at - sorted[i - 1].at < minGap) throw new Error(`SFX quá dày ở ${c.at}s (cách ${sorted[i - 1].name} < ${minGap}s)`);
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
