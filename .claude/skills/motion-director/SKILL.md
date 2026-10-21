---
name: motion-director
description: 'Đạo diễn chuyển động cho repo editvideo (HyperFrames + GSAP, video dọc 9:16 "Sáu Suy Nghĩ"). Dùng khi dựng hoặc nâng cấp một post và cần quyết định cảnh nào nên có hiệu ứng Motion Prompt (mask reveal, count-up, impact shake, whip pan, rack focus…), khi người dùng nhắc "motion prompt", "hiệu ứng chuyển động", "làm video sinh động hơn", "thêm hiệu ứng cho post-N", "so sánh bản có/không hiệu ứng", hoặc đưa số hiệu #NNN. Tự chọn hiệu ứng từ kịch bản + chỉ dẫn hình ảnh, không bắt người dùng chọn tay; chỉ dùng khi cảnh thật sự cần, bản gốc luôn được giữ.'
---

# Motion Director (Motion Prompt × HyperFrames)

Lớp nối giữa thư viện **Motion Prompt** (144 hiệu ứng có tên, spec, code Canvas, MIT, vendored ở `vendor/motion-prompt/`, skill gốc ở `.claude/skills/motion-prompt/`) và pipeline dựng của repo này. Đây là **tài nguyên gọi khi cần**, không phải phong cách bắt buộc. `CLAUDE.md` vẫn là luật cao nhất; skill này không thay thế quy trình nào trong đó.

## Khi nào gọi

- Sau bước 3 của quy trình (`build.mjs --no-render` + snapshot đã sạch), muốn thử bản có hiệu ứng.
- Người dùng muốn video "đã mắt hơn", hỏi có hiệu ứng nào, hoặc đưa số `#NNN`.
- Không gọi cho post trang nghiêm nếu người dùng chưa yêu cầu (tone `solemn` vẫn chạy được, nhưng chỉ còn hiệu ứng nhẹ).

## Lệnh

```bash
# 1) Xem kế hoạch: cảnh nào dùng gì, cảnh nào giữ nguyên và vì sao (không ghi gì vào bản gốc)
node scripts/motion/build.mjs projects/post-N --plan-only
# 2) Dựng bản có hiệu ứng, kiểm tra trong Chromium, lint; chưa render
node scripts/motion/build.mjs projects/post-N --no-render
cd build/post-N.motion && npx hyperframes snapshot --no-end --at <mốc các hiệu ứng trong motion-log.json>
# 3) Render: build/post-N.motion/output.mp4 (bản gốc build/post-N/ không bị đụng)
node scripts/motion/build.mjs projects/post-N
# Tra thư viện gốc (offline)
MOTION_PROMPT_BASE=vendor/motion-prompt/api/v1 node .claude/skills/motion-prompt/scripts/motion-prompt.mjs search <từ tiếng Anh>
MOTION_PROMPT_BASE=vendor/motion-prompt/api/v1 node .claude/skills/motion-prompt/scripts/motion-prompt.mjs get 24
```

Kết quả trong `build/post-N.motion/`: `motion-plan.json` (mọi cảnh + lý do), `motion-log.json` (hiệu ứng nào đã gắn, vào phần tử nào, lúc nào, có dùng dự phòng không), `render-time.txt`.

## Cách nó quyết định (tự động, không cần người chọn)

`scripts/motion/direct.mjs` chấm từng cảnh (mốc lấy từ `sfx.json` → `scenes`):
1. **Ý đồ truyền tải** từ lời voice + chỉ dẫn hình ảnh: số liệu, câu chốt/bất ngờ, đảo ý ("nhưng", "hiểu lầm"), câu hỏi, liệt kê, mẹo/điểm mấu chốt, chuyển chủ đề, vật rơi/thả, cảm xúc lắng, công nghệ, nhân vật chào, kết.
2. **Cảm xúc + nhịp thoại**: tone cả bài (playful/calm/solemn/tech, tự đoán hoặc ghi trong `motion.json`); câu nói chậm (< 2,6 chữ/giây) bị trừ điểm hiệu ứng mạnh.
3. **Ràng buộc**: cảnh đủ dài cho hiệu ứng; nhân vật chỉ nhận hiệu ứng trong `characters.json` → `allow`; mở đầu chỉ nhận hiệu ứng có chức năng (số liệu), để hình ảnh thực tế + nhịp kể dẫn dắt.
4. **Ngân sách chống tràn lan**: ≈ 1 hiệu ứng / 15 s, hiệu ứng toàn khung ≈ 1 / 30 s, cách nhau ≥ 5 s, cùng loại cách ≥ 12 s, mỗi loại có trần riêng. Bài trang nghiêm: ≈ 1 / 45 s và chỉ 1 hiệu ứng toàn khung.
5. Điểm < 3 → **giữ nguyên chuyển động gốc**. Đa số cảnh sẽ được giữ nguyên; đó là chủ ý.

Muốn can thiệp, tạo `projects/post-N/motion.json` (tùy chọn):
```json
{ "tone": "auto", "deny": ["043"], "maxEffects": 5,
  "shots": [ { "at": 15.6, "brief": "nhấn con số 100 độ", "effect": "007" },
             { "at": 41.2, "effect": "none" },
             { "at": 30.0, "effect": "004", "selector": "#route" } ] }
```
`brief` là chỉ dẫn hình ảnh: được chấm chung với lời voice. `effect: "none"` khóa một cảnh.

## An toàn: không bao giờ làm hỏng video

- Runtime `scripts/motion/motion-fx.js` chỉ ghi `translate/scale/rotate/filter/clip-path` (thuộc tính CSS riêng lẻ) hoặc phần tử tự tạo, không đụng `transform/opacity/x/y` mà timeline gốc dùng. Mọi hiệu ứng là hàm thuần của thời gian, chạy qua một plugin GSAP phủ cả timeline: tua kiểu gì, worker nào render cũng ra cùng khung.
- Dò phần tử bằng cách tua timeline thật để biết tiêu đề/thẻ/nhân vật nào xuất hiện trong cảnh. Không thấy phần tử phù hợp, hoặc phần tử đã có tween cùng thuộc tính → thử phương án dự phòng trong `registry.json` → vẫn không được thì **bỏ qua**, và kế hoạch được lập lại để suất đó sang cảnh khác.
- Lỗi JS khi mở trang → rút toàn bộ hiệu ứng, bản dựng y như gốc.
- Phụ đề (`.cap`), voice, SFX, thời lượng, khung 1080×1920 không đổi. Hiệu ứng toàn khung chỉ tác động `#stage`, phụ đề đứng yên.
- SFX: kế hoạch ghi cue có sẵn gần hiệu ứng hoặc gợi ý âm nên thêm; **không tự sửa `sfx.json`**. Muốn thêm, sửa `sfx.json` theo luật SFX trong `CLAUDE.md`.

## Nhân vật

`scripts/motion/characters.json`: Sáu Suy Nghĩ (`.sau`, lớp `.head`) và Vis Giữ Xe (`.vis`, **chưa có bản vẽ trong repo**). Mỗi nhân vật có giới hạn nén/giãn, góc xoay, độ nhảy, danh sách hiệu ứng được/cấm. Hiệu ứng không đổi hình vẽ, màu, nét; chỉ di chuyển nhẹ. Khi có art cho Vis, bọc SVG trong phần tử `class="vis"` và cập nhật mô tả.

## Dùng tay trong template mới (khi đã biết cảnh cần gì)

```html
<script src="assets/vendor/motion-fx.js"></script>  <!-- build.mjs chép từ scripts/motion/motion-fx.js -->
...
MP.use(tl, { duration: {{DURATION}} });
MP.fx("countUp", "#t3", 16.2);       // phần tử, mốc bắt đầu hiện
window.__timelines["postN"] = tl;
```
Muốn hiệu ứng chưa port: `get <id>` để đọc spec + code, dựng lại bằng GSAP theo `references/porting.md` mục 3 (giữ số liệu, đổi màu/chữ theo post), ghi dòng license `// Motion Prompt #ID · MIT License …` ở chỗ dùng.

## Báo cáo khi giao

Liệt kê từ `motion-log.json`: số hiệu + tên, cảnh (mốc giây), phần tử, chỗ đã điều chỉnh so với gốc, link demo `https://showheyohtaki.github.io/motion-prompt/#ID`; nêu cảnh bị bỏ qua/dự phòng và lý do.

Danh mục đã port, mức trung thực và các nhóm chưa port (kèm lý do): `scripts/motion/registry.json`, giải thích chi tiết trong `scripts/motion/README.md`.
