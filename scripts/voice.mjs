#!/usr/bin/env node
// Tạo giọng đọc tiếng Việt cho từng cảnh bằng Gemini TTS.
//   GEMINI_API_KEY=... node scripts/voice.mjs listings/<slug>
// Kết quả: listings/<slug>/voice/<scene>.wav + manifest.json (build.mjs tự dùng).
// Có cache: câu nào không đổi thì không gọi API lại.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const listingDir = path.resolve(process.argv[2] ?? "");
const L = JSON.parse(fs.readFileSync(path.join(listingDir, "listing.json"), "utf8"));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("Thiếu GEMINI_API_KEY. Ví dụ: export GEMINI_API_KEY=...");
  process.exit(1);
}
const cfg = { model: "gemini-3.8-flash-tts", voice: "Kore", speed: 1.1, ...(L.voice ?? {}) };

// Chuẩn hóa chữ viết tắt để TTS đọc tự nhiên.
const speakable = (s) =>
  String(s)
    .replace(/(\d+)\s*PN\b/g, "$1 phòng ngủ")
    .replace(/\bPN\b/g, "phòng ngủ")
    .replace(/\bWC\b/g, "phòng tắm")
    .replace(/m²/g, " mét vuông")
    .replace(/\bTP\.\s*/g, "thành phố ")
    .replace(/\s*·\s*/g, ", ");

// Lời đọc: ưu tiên listing.voiceover[sceneId], không có thì tự ghép từ dữ liệu.
const auto = {
  hero: `${L.title}, tại ${L.project}, ${L.location}.`,
  ...Object.fromEntries(L.gallery.map((g, i) => [`photo-${i}`, `${g.caption}.`])),
  stats: L.stats.map((s) => (s.label === "Tầng" ? `tầng ${s.value}` : `${s.value} ${s.unit}`)).join(", ") + `, ${L.direction ?? ""}.`,
  ...(L.nearby?.length ? { nearby: L.nearby.map((n) => `${n.minutes} phút tới ${n.place}`).join(", ") + "." } : {}),
  cta: `Giá chỉ ${L.price}. Liên hệ ${L.agent.name}, ${L.agent.phone}.`,
};
const lines = Object.fromEntries(Object.entries(auto).map(([id, t]) => [id, speakable(L.voiceover?.[id] ?? t)]));

const outDir = path.join(listingDir, "voice");
fs.mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};

async function tts(text) {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } } },
    },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      // Giới hạn theo phút: chờ đúng thời gian Gemini gợi ý (retryDelay), mặc định 20s.
      const hint = JSON.stringify(json).match(/"retryDelay":\s*"(\d+)/)?.[1];
      const wait = (Number(hint) || 20 * (attempt + 1)) + 1;
      console.log(`… Gemini giới hạn tốc độ, chờ ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error(`Gemini TTS lỗi (${res.status}): ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    return part.inlineData;
  }
}

const manifest = {};
for (const [id, text] of Object.entries(lines)) {
  const hash = crypto.createHash("sha1").update(JSON.stringify([text, cfg])).digest("hex").slice(0, 12);
  const file = `${id}.wav`;
  const dest = path.join(outDir, file);
  if (old[id]?.hash === hash && fs.existsSync(dest)) {
    manifest[id] = old[id];
    console.log(`= ${id} (cache)`);
    continue;
  }
  const { mimeType, data } = await tts(text);
  const raw = path.join(outDir, `${id}.raw`);
  fs.writeFileSync(raw, Buffer.from(data, "base64"));
  // Gemini trả WAV hoặc PCM 16-bit 24kHz mono; chuẩn hóa + tăng tốc độ đọc.
  const input = /wav/i.test(mimeType) ? ["-i", raw] : ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw];
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...input, "-af", `atempo=${cfg.speed},silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse`, "-ar", "44100", dest]);
  fs.rmSync(raw);
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dest]).toString().trim());
  manifest[id] = { file: `voice/${file}`, duration: Math.round(duration * 100) / 100, hash, text };
  console.log(`✔ ${id} ${manifest[id].duration}s · ${text}`);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...old, ...manifest }, null, 2) + "\n");
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`→ ${path.relative(process.cwd(), manifestPath)}`);
