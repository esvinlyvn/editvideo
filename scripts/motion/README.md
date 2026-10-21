# scripts/motion: Motion Prompt × HyperFrames

Tích hợp thư viện [Motion Prompt](https://github.com/showheyohtaki/motion-prompt) (MIT, Shohei Ohtaki) vào pipeline dựng của repo. Hướng dẫn dùng cho Claude: `.claude/skills/motion-director/SKILL.md`.

| File | Vai trò |
| --- | --- |
| `registry.json` | 18 hiệu ứng đã tuyển + port: ý đồ, năng lượng, tone, độ dài cảnh tối thiểu, trần mỗi video, phương án dự phòng, spec gốc và chỗ đã điều chỉnh. Cuối file: các nhóm chưa port và lý do |
| `characters.json` | Giới hạn chuyển động cho nhân vật (Sáu Suy Nghĩ, Vis Giữ Xe) |
| `direct.mjs` | Đạo diễn tự động: kịch bản + mốc cảnh + `motion.json` → `motion-plan.json` |
| `motion-fx.js` | Runtime trong trang: dò phần tử theo timeline, áp hiệu ứng như hàm thuần của thời gian, dự phòng/bỏ qua khi không hợp |
| `build.mjs` | Dựng bản `build/post-N.motion/` (không đụng bản gốc), kiểm tra trong Chromium, lập lại kế hoạch nếu có hiệu ứng không gắn được, lint, render |

Dữ liệu thư viện gốc (catalog, spec, code, kit) để offline ở `vendor/motion-prompt/api/v1` (commit `36f5bdac`). Skill gốc ở `.claude/skills/motion-prompt/` giữ nguyên; chạy CLI offline bằng `MOTION_PROMPT_BASE=vendor/motion-prompt/api/v1`. Cập nhật thư viện: clone lại repo gốc, chép `api/v1/{catalog.json,en,kit}` và `skills/motion-prompt/`, đổi `source.commit` trong `registry.json`.

## Vì sao không chạy thẳng code Canvas của thư viện

Phần tử gốc là hàm vẽ Canvas 2D trên thẻ 539×208 với bảng màu, font hệ thống riêng. Repo này dựng bằng DOM/SVG + GSAP, mỗi post một bộ font/màu riêng, chữ tiếng Việt phải tự ngắt dòng. Nên dùng cách **"chuyển số liệu"** (porting.md, mục 3): giữ nguyên thời gian, easing, lò xo, biên độ (đổi tỉ lệ thẻ → khung 1080), dựng lại trên phần tử thật của post. Nhờ vậy chữ, font, màu, nhân vật vẫn là của post.

## Mức trung thực

- **full**: số liệu y gốc (count-up, impact shake, pop-in, stagger, highlighter, scramble, bounce, pulse, line draw).
- **adapted**: giữ nhịp và easing, đổi hình học cho hợp khung dọc/tiếng Việt (mask reveal: cả hai dòng trồi từ dưới để không cắt dấu; whip pan: dịch ngang + nhòe một chiều; smash cut; rack focus; anticipation/follow-through theo giới hạn nhân vật; light sweep; overshoot).
- **partial**: dolly in (thế giới SVG phẳng, không có thị sai → thực chất là zoom chậm).

## Giới hạn kỹ thuật

- Không tua lại thời gian của timeline được → Slow motion, Speed ramp, Freeze frame, Time-lapse không port.
- Hiệu ứng cần cảnh 3D (Orbit, Dolly zoom, FPV) hoặc offscreen canvas (Liquid, Particles, Shatter, Glitch…) không tự áp; muốn dùng thì dựng tay cho cảnh cụ thể.
- Nhóm `photo` là từ khóa cho model tạo ảnh; nhóm `ui`/`lp` dùng làm tham chiếu số liệu khi dựng giao diện điện thoại mô phỏng.
- Bộ nhận diện ý đồ dựa trên từ khóa tiếng Việt: nhanh, chạy offline, giải thích được, nhưng có thể đoán sai nghĩa ("tự nhiên" = bỗng nhiên hay = tự nhiên). Sửa bằng `motion.json` → `shots`.
- Dò phần tử dựa trên quy ước của repo (`#stage`, `.h .blk`, `.card`, `.tag`, `.sau`, `#W`). Template khác quy ước thì truyền `selector` trong `shots`.
- Nhòe toàn khung (whip pan, rack focus) tốn thêm thời gian render ở vài khung đó.
- `build.mjs` tạm đổi tên `build/post-N` trong lúc build bản motion rồi trả lại; đừng chạy song song hai lệnh build cùng một post.

## Bài học khi tích hợp (đã xử lý trong code)

- Runtime HyperFrames ẩn các `.clip` bằng `visibility: hidden` lúc khởi tạo, giá trị này kế thừa xuống con → bước dò chỉ xét `opacity`/`display`, không xét `visibility`. Bước kiểm tra headless trong `build.mjs` mô phỏng đúng điều này.
- GSAP 3.13 gộp các thuộc tính CSS `translate/scale/rotate` vào `transform` của nó khi lần đầu đọc transform của phần tử. Nên phần tử nào timeline gốc có tween transform thì hiệu ứng ghi lên lớp bọc `.mp-wrap` tạo sẵn lúc gắn, không ghi lên phần tử gốc (nếu không, vị trí sẽ lệch vĩnh viễn, như nhãn `translate: -50% -100%` của post 44).
- Không dùng `onUpdate` để chạy hiệu ứng: HyperFrames có lúc tua với `suppressEvents`. Hiệu ứng chạy qua plugin GSAP `mpDrive`, luôn được gọi khi timeline render.
- `tabular-nums` chỉ bật trong lúc đếm số, đếm xong trả dáng chữ gốc.
