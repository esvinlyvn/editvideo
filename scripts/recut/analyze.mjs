#!/usr/bin/env node
// Bước 1: Gemini xem clip thô (1 lần gọi) → work/<slug>/plan.json
// gồm lời thoại theo cụm có mốc thời gian, đoạn nào giữ/bỏ, hook, keyword, text pop, CTA.
//   GEMINI_API_KEY=... node scripts/recut/analyze.mjs raw/clip.mp4 [--target 60] [--context "tên riêng, dự án…"]
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
const target = Number(process.argv[process.argv.indexOf("--target") + 1]) || 60;
const ctxArg = process.argv.indexOf("--context");
const CONTEXT = ctxArg > 0 ? process.argv[ctxArg + 1] : "";
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
if (!src || !fs.existsSync(src) || !KEY) {
  console.error("Dùng: GEMINI_API_KEY=... node scripts/recut/analyze.mjs raw/clip.mp4 [--target 60]");
  process.exit(1);
}
const slug = path.basename(src, path.extname(src));
const work = path.join("work", slug);
fs.mkdirSync(work, { recursive: true });
const API = "https://generativelanguage.googleapis.com";

async function upload(file) {
  const size = fs.statSync(file).size;
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": KEY,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: slug } }),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error(`Upload lỗi: ${start.status} ${await start.text()}`);
  const done = await fetch(url, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0" },
    body: fs.readFileSync(file),
  });
  let { file: f } = await done.json();
  while (f.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 3000));
    f = await (await fetch(`${API}/v1beta/${f.name}`, { headers: { "x-goog-api-key": KEY } })).json();
  }
  if (f.state !== "ACTIVE") throw new Error(`File lỗi: ${JSON.stringify(f)}`);
  return f;
}

const PROMPT = `Bạn là editor video ngắn (TikTok/Reels) hàng đầu Việt Nam. Clip đính kèm là footage THÔ, một người nói trước máy, chia sẻ góc nhìn.
${CONTEXT ? `Bối cảnh / tên riêng ĐÚNG (dùng để chép lời chính xác, không nghe nhầm): ${CONTEXT}\n` : ""}Nhiệm vụ: lên kế hoạch dựng lại thành video ~${target} giây (được phép 45–90s) có tính lan truyền cao, CHỈ dùng tiếng gốc.

Trả về JSON:
- "topic": chủ đề 1 câu.
- "segments": TOÀN BỘ lời nói trong clip, theo thứ tự, chia thành cụm ngắn 1–4 giây (ngắt ở chỗ ngừng tự nhiên). Mỗi cụm:
  "start","end": giây (số thực, chính xác tới 0.1s, khớp ÂM THANH lời nói, không lấy khoảng lặng);
  "text": chép NGUYÊN VĂN tiếng Việt có dấu, viết đúng chính tả, tên riêng/dự án viết hoa đúng;
  "keep": true/false. Bỏ: nói vấp, lặp ý, câu thừa, ậm ừ, chào hỏi dài dòng, ý lan man. Giữ: ý giá trị, số liệu, nhận định mạnh, câu chốt.
  Tổng thời lượng các cụm keep ≈ ${target}s. Các cụm keep phải ghép lại vẫn thành câu trọn ý, mạch lạc: nếu giữ câu "yếu tố thứ hai/tiếp theo" thì phải giữ cả yếu tố trước đó; ưu tiên giữ số liệu mạnh (giá tăng, %, khoảng cách, số lượng).
- "hookIndex": index cụm keep gây tò mò/mạnh nhất để đưa LÊN ĐẦU video làm hook (hoặc -1 nếu câu mở đầu đã đủ mạnh).
- "hookLabel": nhãn nhỏ 2–3 từ phía trên hook (vd "Góc nhìn đầu tư").
- "hookTitle": câu hook hiện 3 giây đầu, ≤ 9 từ, gây tò mò, viết thường có hoa đầu câu/tên riêng.
- "callouts": 5–8 thẻ thông tin nhấn ý chính, mỗi thẻ hiện ≥ 3.5 giây nên rải đều, không 2 thẻ ở 2 cụm liền nhau:
  [{"index": index cụm keep, "label": nhãn 1–3 từ (vd "Quy mô"), "value": số liệu/từ khóa ngắn ≤ 3 từ (vd "922 căn"), "sub": mô tả ≤ 7 từ}]
  Thẻ đầu tiên nên giới thiệu dự án/chủ thể chính của video.
- "cta": câu kêu gọi cuối video ≤ 8 từ (theo dõi / bình luận / nhắn tin tư vấn…) phù hợp nội dung.
Chỉ trả JSON hợp lệ.`;

const schema = {
  type: "OBJECT",
  properties: {
    topic: { type: "STRING" },
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { start: { type: "NUMBER" }, end: { type: "NUMBER" }, text: { type: "STRING" }, keep: { type: "BOOLEAN" } },
        required: ["start", "end", "text", "keep"],
      },
    },
    hookIndex: { type: "INTEGER" },
    hookLabel: { type: "STRING" },
    hookTitle: { type: "STRING" },
    callouts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { index: { type: "INTEGER" }, label: { type: "STRING" }, value: { type: "STRING" }, sub: { type: "STRING" } },
        required: ["index", "label", "value", "sub"],
      },
    },
    cta: { type: "STRING" },
  },
  required: ["topic", "segments", "hookIndex", "hookLabel", "hookTitle", "callouts", "cta"],
};

console.log(`↑ Upload ${src} lên Gemini…`);
const f = await upload(src);
console.log(`✔ ${f.name} · gọi ${MODEL}…`);
const res = await fetch(`${API}/v1beta/models/${MODEL}:generateContent`, {
  method: "POST",
  headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ file_data: { mime_type: f.mimeType, file_uri: f.uri } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 },
  }),
});
const json = await res.json();
const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
if (!text) throw new Error(`Gemini lỗi (${res.status}): ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
const plan = JSON.parse(text);
plan.source = path.resolve(src);
fs.writeFileSync(path.join(work, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
// Xóa file khỏi Gemini sau khi dùng.
await fetch(`${API}/v1beta/${f.name}`, { method: "DELETE", headers: { "x-goog-api-key": KEY } });

const kept = plan.segments.filter((s) => s.keep);
const dur = kept.reduce((a, s) => a + s.end - s.start, 0);
console.log(`✔ ${work}/plan.json · ${plan.segments.length} cụm, giữ ${kept.length} (${dur.toFixed(1)}s) · ${json.usageMetadata?.totalTokenCount ?? "?"} token Gemini`);
console.log(`  Chủ đề: ${plan.topic}\n  Hook: ${plan.hookTitle}`);
