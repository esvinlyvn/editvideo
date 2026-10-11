// Gắn SFX từ thư viện chung (sfx/) vào một composition HyperFrames.
// cues: [{ at: giây, name: "pop", vol?: 0.4–1.0 }] — vol mặc định 0.8, thư viện đã chuẩn hóa sẵn
// mức âm lượng thấp hơn voice ~14–18 dB nên KHÔNG cần (và không nên) đẩy vol > 1.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "sfx/catalog.json"), "utf8"));

export function sfxHtml(cues, outDir) {
  fs.mkdirSync(path.join(outDir, "assets/sfx"), { recursive: true });
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  // Chống lạm dụng: 2 SFX cách nhau tối thiểu 1.2s
  sorted.forEach((c, i) => {
    if (!catalog[c.name]) throw new Error(`SFX không có trong thư viện: ${c.name}`);
    if (i && c.at - sorted[i - 1].at < 1.2) throw new Error(`SFX quá dày ở ${c.at}s (cách ${sorted[i - 1].name} < 1.2s)`);
  });
  for (const n of new Set(sorted.map((c) => c.name))) fs.copyFileSync(path.join(ROOT, "sfx", catalog[n].file), path.join(outDir, "assets/sfx", catalog[n].file));
  return sorted
    .map((c, i) => {
      const e = catalog[c.name];
      const vol = Math.min(1, c.vol ?? 0.8);
      return `<audio id="sfx-${i}" src="assets/sfx/${e.file}" data-start="${c.at}" data-duration="${e.duration}" data-track-index="${10 + (i % 2)}" data-volume="${vol}"></audio>`;
    })
    .join("\n      ");
}
