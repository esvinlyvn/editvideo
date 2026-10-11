#!/usr/bin/env node
// Tạo giọng đọc tiếng Việt bằng Gemini TTS: MỘT lần gọi cho cả kịch bản
// (giữ nguyên chất giọng), rồi cắt theo khoảng lặng giữa các đoạn để khớp từng cảnh.
//   GEMINI_API_KEY=... node scripts/voice.mjs listings/<slug>
// Kết quả: listings/<slug>/voice/full.wav, <scene>.wav, manifest.json (build.mjs tự dùng).
// Có cache: kịch bản không đổi thì không gọi API lại.
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
const ids = Object.keys(auto);
const lines = ids.map((id) => speakable(L.voiceover?.[id] ?? auto[id]));
// Xuống dòng đôi giữa các cảnh để TTS ngắt nghỉ rõ, dễ cắt.
const script = lines.join("\n\n");

const outDir = path.join(listingDir, "voice");
fs.mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, "manifest.json");
const fullWav = path.join(outDir, "full.wav");
const hash = crypto.createHash("sha1").update(JSON.stringify([script, cfg])).digest("hex").slice(0, 12);
const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
if (old._hash === hash && fs.existsSync(fullWav)) {
  console.log("= Kịch bản không đổi, dùng lại giọng đã tạo (không gọi API).");
  process.exit(0);
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", ...args], { stdio: ["ignore", "pipe", "pipe"] });
const probe = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

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
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const hint = JSON.stringify(json).match(/"retryDelay":\s*"(\d+)/)?.[1];
      const wait = (Number(hint) || 20) + 1;
      if (wait > 120) {
        const quota = (json.error?.details ?? []).flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId}=${v.quotaValue}`);
        throw new Error(`Hết hạn mức Gemini (phải chờ ${Math.round(wait / 60)} phút). ${quota.join(", ") || json.error?.message?.slice(0, 300)}`);
      }
      console.log(`… Gemini giới hạn tốc độ (${res.status}), chờ ${wait}s rồi thử lại`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error(`Gemini TTS lỗi (${res.status}): ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    return part.inlineData;
  }
}

console.log(`Gọi Gemini TTS 1 lần · ${cfg.model} · giọng ${cfg.voice} · ${script.length} ký tự`);
const { mimeType, data } = await tts(script);
const raw = path.join(outDir, "full.raw");
fs.writeFileSync(raw, Buffer.from(data, "base64"));
const input = /wav/i.test(mimeType) ? ["-i", raw] : ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw];
// Tăng tốc độ đọc + cắt khoảng lặng đầu/cuối.
const trim = "silenceremove=start_periods=1:start_threshold=-45dB";
ffmpeg(["-loglevel", "error", "-y", ...input, "-af", `atempo=${cfg.speed},${trim},areverse,${trim},areverse`, "-ar", "44100", fullWav]);
fs.rmSync(raw);
const total = probe(fullWav);

// Tìm khoảng lặng; lấy (số cảnh - 1) khoảng dài nhất làm điểm cắt.
const log = execFileSync("bash", ["-c", 'ffmpeg -hide_banner -i "$0" -af silencedetect=noise=-40dB:d=0.15 -f null - 2>&1', fullWav]).toString();
const silences = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => ({
  start: Number(m[1]),
  end: Number(m[2]),
}));
const need = ids.length - 1;
let cuts;
if (silences.length >= need) {
  cuts = [...silences]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, need)
    .sort((a, b) => a.start - b.start);
} else {
  console.warn("⚠ Không đủ khoảng lặng để cắt, chia theo độ dài chữ.");
  const sum = lines.reduce((a, l) => a + l.length, 0);
  let acc = 0;
  cuts = lines.slice(0, -1).map((l) => {
    acc += (l.length / sum) * total;
    return { start: acc, end: acc };
  });
}

// Cắt từng đoạn: từ cuối khoảng lặng trước đến đầu khoảng lặng sau.
const manifest = { _hash: hash, _full: "voice/full.wav" };
ids.forEach((id, i) => {
  const a = i === 0 ? 0 : cuts[i - 1].end;
  const b = i === ids.length - 1 ? total : cuts[i].start;
  const file = path.join(outDir, `${id}.wav`);
  ffmpeg(["-loglevel", "error", "-y", "-i", fullWav, "-ss", a.toFixed(3), "-to", b.toFixed(3), file]);
  const duration = Math.round(probe(file) * 100) / 100;
  manifest[id] = { file: `voice/${id}.wav`, duration, text: lines[i] };
  console.log(`✔ ${id.padEnd(8)} ${duration.toFixed(2)}s · ${lines[i]}`);
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`→ ${path.relative(process.cwd(), manifestPath)} · tổng ${total.toFixed(1)}s`);
