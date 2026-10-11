#!/usr/bin/env node
// Nhập & chuẩn hóa thư viện SFX dùng chung.
//   node scripts/sfx-import.mjs <thư-mục-nguồn>
// Mỗi file: cắt lặng đầu/cuối, cắt độ dài tối đa, fade-out, đưa về mức âm lượng chuẩn
// (thấp hơn voice -14 LUFS khoảng 14–18 dB, đỉnh bị chặn) → sfx/<tên>.wav + sfx/catalog.json
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
const OUT = path.resolve("sfx");
fs.mkdirSync(OUT, { recursive: true });

// Nhóm → mức trung bình mục tiêu (dB), đỉnh tối đa (dBFS), độ dài tối đa (s)
const CLASS = {
  ui: { mean: -31, peak: -9, max: 1.2 },
  transition: { mean: -30, peak: -8, max: 1.6 },
  impact: { mean: -28, peak: -6, max: 2.0 },
  accent: { mean: -30, peak: -8, max: 3.0 },
  ambience: { mean: -36, peak: -14, max: 4.0 },
};
// Tên → nhóm + nhãn gợi ý dùng
const META = {
  "whoosh-soft": ["transition", "chuyển cảnh nhẹ, mờ dần"],
  "whoosh-fast": ["transition", "chuyển cảnh nhanh, đẩy/trượt"],
  swipe: ["transition", "lướt thẻ, đổi bước"],
  pop: ["ui", "thẻ/chip/icon bật ra"],
  click: ["ui", "nhấn, chọn mục"],
  toggle: ["ui", "bật/tắt, so sánh A/B"],
  scroll: ["ui", "cuộn danh sách"],
  type: ["ui", "gõ chữ, nhập số"],
  send: ["ui", "gửi tin/file"],
  like: ["ui", "tương tác mạng xã hội"],
  notify: ["ui", "tin nhắn/thông báo đến"],
  tick: ["ui", "đồng hồ, số đếm"],
  success: ["accent", "đúng, hoàn thành, kết quả tốt"],
  "ding-idea": ["accent", "ý tưởng, mẹo, 'à ra vậy'"],
  shimmer: ["accent", "nhẹ nhõm, sáng tỏ, kết đẹp"],
  coin: ["accent", "tiết kiệm, tiền lẻ"],
  cash: ["accent", "ra số tiền, lợi nhuận"],
  "chart-up": ["accent", "tăng trưởng, giá tăng"],
  lose: ["accent", "thua lỗ, kết quả tệ"],
  receipt: ["accent", "hóa đơn in ra"],
  scribble: ["accent", "gạch chữ, quẹt highlight"],
  oops: ["accent", "sai lầm, 'chết rồi' (hài)"],
  "sad-trombone": ["accent", "thất bại kiểu hài"],
  gasp: ["accent", "bất ngờ"],
  "record-scratch": ["accent", "khựng lại, 'khoan đã'"],
  "phone-vibrate": ["accent", "điện thoại rung, áp lực"],
  alarm: ["accent", "hẹn giờ, deadline"],
  "door-open": ["accent", "mở cửa, vào nhà"],
  riser: ["accent", "dồn nhịp ngắn trước câu quan trọng"],
  "riser-long": ["accent", "dồn nhịp dài trước khi lộ kết quả"],
  hit: ["impact", "hook, câu chốt"],
  punch: ["impact", "chữ đập vào khung"],
  stamp: ["impact", "nhãn/dấu đập xuống"],
  snap: ["impact", "búng tay, đổi ý nhanh"],
  "bass-drop": ["impact", "lộ kết quả bất ngờ"],
  "door-slam": ["impact", "chốt, đóng lại"],
  crickets: ["ambience", "im lặng ngượng ngùng"],
  heartbeat: ["ambience", "hồi hộp, lo lắng"],
  "tick-tock": ["ambience", "áp lực thời gian"],
  suspense: ["ambience", "bí ẩn, 'nhưng mà…'"],
};

const vol = (f) => {
  const o = execFileSync("bash", ["-c", 'ffmpeg -hide_banner -i "$0" -af volumedetect -f null - 2>&1', f]).toString();
  return { mean: +o.match(/mean_volume: ([-\d.]+)/)[1], max: +o.match(/max_volume: ([-\d.]+)/)[1] };
};
const dur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString();

const catalog = fs.existsSync(path.join(OUT, "catalog.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "catalog.json"))) : {};
for (const file of fs.readdirSync(src).filter((f) => /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f)).sort()) {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  const [cls, use] = META[name] ?? ["accent", ""];
  const C = CLASS[cls];
  const tmp = path.join(OUT, `.${name}.tmp.wav`);
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.01";
  // 1) cắt lặng đầu/cuối + cắt độ dài + fade-out
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(src, file), "-af",
    `${trim},areverse,${trim},areverse,atrim=0:${C.max},afade=t=out:st=${Math.max(0, C.max - 0.25)}:d=0.25`, "-ar", "48000", "-ac", "2", tmp]);
  const d = dur(tmp);
  const fadeAt = Math.max(0, d - Math.min(0.12, d * 0.3));
  // 2) đưa về mức chuẩn: tăng/giảm tới mean mục tiêu nhưng không để đỉnh vượt ngưỡng
  const v = vol(tmp);
  const gain = Math.min(C.mean - v.mean, C.peak - v.max);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", tmp, "-af", `volume=${gain.toFixed(1)}dB,afade=t=out:st=${fadeAt.toFixed(3)}:d=${(d - fadeAt).toFixed(3)}`,
    path.join(OUT, `${name}.wav`)]);
  fs.rmSync(tmp);
  const after = vol(path.join(OUT, `${name}.wav`));
  catalog[name] = { file: `${name}.wav`, class: cls, use, duration: Math.round(d * 100) / 100, mean: after.mean, peak: after.max };
  console.log(`${name.padEnd(15)} ${cls.padEnd(10)} ${d.toFixed(2)}s  mean ${after.mean}  peak ${after.max}`);
}
fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
console.log(`→ sfx/catalog.json · ${Object.keys(catalog).length} SFX`);
