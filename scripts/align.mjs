#!/usr/bin/env node
// Khớp kịch bản vào voice — chạy hoàn toàn trên máy, không cần API.
//   node scripts/align.mjs <voice.wav> <script.txt> <out transcript.json>
// 1) Dò khoảng lặng → các cụm lời có mốc thời gian chính xác.
// 2) Chia chữ kịch bản vào từng cụm bằng quy hoạch động: số chữ mỗi cụm ≈ tốc độ nói × thời lượng,
//    ưu tiên ranh giới cụm rơi vào dấu câu (người đọc ngắt ở , . ? ! :).
// Dòng kịch bản dạng "A: ..." được gắn speaker A/B; không có tiền tố thì giữ speaker trước đó.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [voice, scriptFile, outFile] = process.argv.slice(2);
if (!outFile) {
  console.error("Dùng: node scripts/align.mjs voice.wav script.txt transcript.json");
  process.exit(1);
}

// ---- 1. Cụm lời từ khoảng lặng ----
const T = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voice]).toString());
const log = execFileSync("bash", ["-c", 'ffmpeg -hide_banner -i "$0" -af silencedetect=noise=-40dB:d=0.18 -f null - 2>&1', voice]).toString();
const sil = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?(?:silence_end: ([\d.]+)|$)/g)].map((m) => [+m[1], m[2] ? +m[2] : T]);
const chunks = [];
let t = 0;
for (const [s, e] of sil) {
  if (s > t + 0.05) chunks.push([t, s]);
  t = e;
}
if (T > t + 0.05) chunks.push([t, T]);
// Bỏ cụm siêu ngắn (< 0.12s): thường là tiếng thở, đuôi tiếng cười, click — không phải lời nói
for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i][1] - chunks[i][0] < 0.12) chunks.splice(i, 1);

// ---- 2. Chữ kịch bản ----
const words = []; // { w, sp, strong (ranh giới mạnh sau chữ), weak }
let speaker = "B";
for (const raw of fs.readFileSync(scriptFile, "utf8").split(/\n+/)) {
  let line = raw.trim();
  if (!line) continue;
  const m = line.match(/^([A-Z])\s*:\s*(.*)$/);
  if (m) (speaker = m[1]), (line = m[2]);
  const ws = line.split(/\s+/).filter(Boolean);
  ws.forEach((w, i) => {
    const last = i === ws.length - 1;
    words.push({ w, sp: speaker, strong: last || /[.!?:…]["”"]?$/.test(w), weak: /[,;]["”"]?$/.test(w) });
  });
}

// ---- 3. Quy hoạch động: gán đoạn chữ liên tiếp cho từng cụm ----
// Đếm "âm tiết nặng": chữ dài/số đọc lâu hơn chữ ngắn
const weight = (w) => {
  const digits = (w.match(/\d/g) || []).length;
  return digits ? Math.max(1, digits * 0.9) : 1;
};
const W = words.map((x) => weight(x.w));
const prefix = [0];
W.forEach((x, i) => prefix.push(prefix[i] + x));
const speech = chunks.reduce((a, [s, e]) => a + (e - s), 0);
const rate = prefix.at(-1) / speech; // âm tiết / giây
const N = words.length, K = chunks.length;
const INF = 1e18;
const dp = Array.from({ length: K + 1 }, () => new Float64Array(N + 1).fill(INF));
const back = Array.from({ length: K + 1 }, () => new Int32Array(N + 1).fill(-1));
dp[0][0] = 0;
for (let k = 1; k <= K; k++) {
  const dur = chunks[k - 1][1] - chunks[k - 1][0];
  const expect = rate * dur;
  for (let j = k; j <= N - (K - k); j++) {
    for (let i = Math.max(k - 1, j - 60); i < j; i++) {
      if (dp[k - 1][i] === INF) continue;
      const n = prefix[j] - prefix[i];
      let cost = ((n - expect) ** 2) / (expect + 1.5);
      const end = words[j - 1];
      if (k < K) cost += end.strong ? 0 : end.weak ? 1.2 : 6; // ngắt giữa câu không có dấu câu → phạt
      if (words[i].sp !== end.sp) cost += 50; // một cụm không chứa 2 người nói
      if (dp[k - 1][i] + cost < dp[k][j]) (dp[k][j] = dp[k - 1][i] + cost), (back[k][j] = i);
    }
  }
}
const spans = [];
for (let k = K, j = N; k > 0; k--) {
  const i = back[k][j];
  spans.unshift([i, j]);
  j = i;
}
const out = {
  source: "align.mjs (local)",
  chunks: spans.map(([i, j], k) => ({
    i: k,
    start: Math.round(chunks[k][0] * 1000) / 1000,
    end: Math.round(chunks[k][1] * 1000) / 1000,
    speaker: words[i].sp,
    text: words.slice(i, j).map((x) => x.w).join(" "),
  })),
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const c of out.chunks) console.log(String(c.i).padStart(2), c.speaker, c.start.toFixed(2), c.end.toFixed(2), c.text);
console.log(`→ ${outFile} · ${K} cụm · ${N} chữ · ${rate.toFixed(2)} âm tiết/giây`);
