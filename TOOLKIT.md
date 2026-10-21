# TOOLKIT: kỹ thuật dựng video dùng chung

Tài liệu này chỉ ghi phần kỹ thuật: công cụ, pipeline, template, âm thanh, lệnh chạy.
Mọi bước chạy hoàn toàn trên máy, không gọi API ngoài.

---

## 1. Môi trường

| Thành phần | Ghi chú |
| --- | --- |
| Node.js 22+ | Script dạng ES module (`"type": "module"`) |
| FFmpeg + ffprobe | Dò khoảng lặng, chuẩn hóa âm lượng, đo mức, cắt khung |
| `npm install` | Cài `hyperframes` (0.8.x), `gsap`, các font `@fontsource/*` |
| Chromium | HyperFrames dùng để chụp khung và render. Trên máy cloud đã có sẵn (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), đừng chạy `playwright install` |

Font đang cài (đều có subset tiếng Việt): nunito, jetbrains-mono, lexend, montserrat, baloo-2, space-grotesk, playfair-display, bungee, be-vietnam-pro.
Cài thêm font: `npm install @fontsource/<tên>`, rồi kiểm tra có subset `vietnamese` bằng lệnh `grep -c vietnamese node_modules/@fontsource/<tên>/400.css`.

---

## 2. Cấu trúc thư mục

```
editvideo/
├── projects/<ten-video>/          # mỗi video một thư mục
│   ├── voice.wav             # file giọng đọc gốc
│   ├── script.txt            # lời thoại, mỗi câu một dòng ("A:"/"B:" để đánh dấu người nói)
│   ├── transcript.json       # cụm lời + mốc thời gian (sinh bởi align.mjs, sửa tay được)
│   ├── template.html         # bố cục + timeline GSAP, chứa các placeholder {{…}}
│   ├── build.mjs             # sinh phụ đề, nhúng font/SVG/SFX, render
│   ├── sfx.json              # danh sách SFX
│   └── art/                  # SVG riêng của video
├── scripts/
│   ├── align.mjs             # khớp lời thoại vào voice (offline)
│   ├── vn-text.mjs           # ngắt dòng tiếng Việt theo nghĩa
│   ├── sfx-import.mjs        # nhập + chuẩn hóa SFX vào thư viện
│   └── sfx-cues.mjs          # gắn SFX vào composition
├── sfx/                      # thư viện SFX đã chuẩn hóa (*.wav) + catalog.json
├── build/   (gitignore)      # build/<ten-video>/index.html, assets/, snapshots/, output.mp4
└── work/    (gitignore)      # file tạm
```

---

## 3. Lệnh chạy

```bash
# Tạo video mới
mkdir -p projects/<ten-video>/art
cp /đường/dẫn/voice.wav projects/<ten-video>/voice.wav
#   viết projects/<ten-video>/script.txt

# 1) Khớp lời thoại vào voice
node scripts/align.mjs projects/<ten-video>/voice.wav projects/<ten-video>/script.txt projects/<ten-video>/transcript.json

# 2) Chép khung mẫu rồi sửa (font, NO_CAP, FORCE, placeholder, nội dung template)
cp projects/example/{build.mjs,template.html,sfx.json} projects/<ten-video>/

# 3) Build không render, kiểm tra
node projects/<ten-video>/build.mjs --no-render
cd build/<ten-video>
npx hyperframes lint
npx hyperframes snapshot --no-end --at 1.5,8,15,22    # → snapshots/*.png + contact-sheet*.jpg

# 4) Render (video 60 giây mất khoảng 2 phút, 100 giây khoảng 3 phút)
node projects/<ten-video>/build.mjs                       # → build/<ten-video>/output.mp4

# Nhập SFX mới vào thư viện
node scripts/sfx-import.mjs <thư-mục-chứa-file-mới>
```

---

## 4. Pipeline

```
voice.wav + script.txt
   │  align.mjs
   ▼
transcript.json ──┐
template.html ────┤  build.mjs
sfx.json ─────────┤   ├─ phụ đề (vn-text.mjs)
art/*.svg ────────┘   ├─ font woff2, gsap, voice chuẩn hóa → build/<ten-video>/assets/
                      ├─ SFX (sfx-cues.mjs) → assets/sfx/*.wav + thẻ <audio>
                      └─ thay placeholder → build/<ten-video>/index.html
                                │  npx hyperframes render
                                ▼
                           output.mp4 (1080×1920)
```

### 4.1 `align.mjs`: khớp lời thoại vào voice
1. Dò khoảng lặng: `silencedetect=noise=-40dB:d=0.18`, ra các cụm lời có mốc thời gian chính xác. Bỏ cụm ngắn hơn 0,12 giây (tiếng thở, click).
2. Chia chữ trong kịch bản vào từng cụm bằng quy hoạch động:
   - Chi phí cơ bản: `(n − kỳ_vọng)² / (kỳ_vọng + 1.5)`. Kỳ vọng tính theo tốc độ nói trung bình (âm tiết/giây). Con số được tính nặng hơn chữ thường.
   - Ranh giới cụm không rơi vào dấu câu thì bị phạt: 6 điểm, hoặc 1,2 nếu là dấu phẩy.
   - Một cụm chứa 2 người nói thì bị phạt 50.
3. In bảng cụm để đọc lại. Gặp cụm lệch (tiếng động lạ, chỗ đọc nhanh, đoạn kéo dài) thì sửa tay `transcript.json`:
   - Đổi `text`, gộp cụm (nối `text`, lấy `end` của cụm sau), hoặc xóa cụm.
   - Giữ nguyên trường `i` vì `build.mjs` tham chiếu theo `i`.
   - Muốn soi chỗ ngắt thì dò lặng ở ngưỡng chặt hơn trên đoạn đó:
     `ffmpeg -ss 34.4 -t 7 -i voice.wav -af silencedetect=noise=-32dB:d=0.08 -f null -`

### 4.2 Phụ đề (trong `build.mjs`)
- Chia mỗi cụm thành nhóm tối đa 7 chữ. Ưu tiên ngắt sau dấu câu, hoặc trước từ nối (`LINK`). Không ngắt giữa từ ghép (`canBreak`).
- Đuôi 1–2 chữ thì gộp vào nhóm trước.
- Thời gian mỗi nhóm chia theo tỷ lệ số ký tự trong cụm.
- Gộp các nhóm rất ngắn liền nhau (nghỉ ≤ 0,45 giây, tổng ≤ 7 chữ), nhưng không gộp qua dấu kết câu (`. ! ? …`).
- Hiện sớm 0,15 giây (`LEAD`), tắt sau khi hết lời 0,1 giây, không chồng lên phụ đề sau.
- Xuống dòng trong khung phụ đề: `breakLines(text, 26)` trong `vn-text.mjs`, nối bằng `<br>`.
- Các công tắc tay:
  - `NO_CAP = new Set([i…])`: những cụm không chạy phụ đề (vì chữ đã hiện trên hình).
  - `KEEP = new Set([i…])`: giữ nguyên cụm thành một phụ đề.
  - `FORCE = { i: [số_chữ, số_chữ…] }`: chỉ định chỗ ngắt cho một cụm.

### 4.3 `vn-text.mjs`: ngắt dòng tiếng Việt
- `breakLines(text, maxChars = 26, maxLines = 2)` chọn chỗ ngắt có chi phí thấp nhất:
  - Sau dấu câu: 0.
  - Trước đại từ: 3.
  - Trước từ nối: 4.
  - Dòng kết thúc bằng đại từ: 30.
  - Ngắt ngay sau từ nối: 40.
- `canBreak(words, i)` cấm ngắt giữa từ ghép trong `COMPOUNDS`, giữa tên riêng, và giữa số với danh từ đi kèm.
- Gặp chỗ ngắt sai thì bổ sung cụm vào `COMPOUNDS` (ngăn cách bằng `|`, nhận cả cụm nhiều chữ).

### 4.4 Voice
- `build.mjs` chuẩn hóa về -14 LUFS:
  `ffmpeg -i voice.wav -af loudnorm=I=-14:TP=-1.5:LRA=9 -ar 48000 build/<ten-video>/assets/voice.wav`
- Voice nằm ở track 9: `<audio id="voice" data-start="0" data-duration="{{VOICE_DUR}}" data-track-index="9">`.
- Độ dài video = độ dài voice + `TAIL` (khoảng 1,5–2,5 giây, chừa chỗ cho cảnh kết).

---

## 5. Template HyperFrames

### 5.1 Khung cơ bản
```html
<div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="{{DURATION}}">
  <!-- mỗi cảnh là một clip -->
  <div class="clip scene" id="s1" data-start="0" data-duration="7.05" data-track-index="1"><div class="in" id="s1-in">…</div></div>
  {{CAPTIONS}}
  {{SFX}}
  <audio id="voice" …></audio>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  // … toàn bộ animation đặt theo giây tuyệt đối trên một timeline
  window.__timelines["main"] = tl;
</script>
```
- Clip chỉ hiện trong khoảng `data-start` đến `data-start + data-duration`. Phần tử trong clip animate bằng một timeline chung `tl`, theo giây tuyệt đối.
- Mỗi cảnh có một lớp `.in`: cho mờ vào ở đầu cảnh (`fromTo opacity 0→1`) và mờ ra 0,15–0,2 giây trước khi clip kết thúc.
- Lớp "thế giới" xuyên suốt (một bối cảnh dùng chung qua nhiều cảnh) đặt ở clip dài cả video. Ẩn/hiện bằng cách tween opacity của `#w-in` theo các khoảng thời gian.
- Phần lặp lại (lưới ô, danh sách, hàng icon…) có thể sinh bằng JS ngay đầu `<script>`, trước khi dựng timeline. Kết quả vẫn xác định (mỗi lần render giống nhau).

### 5.2 Placeholder do `build.mjs` thay
| Placeholder | Nội dung |
| --- | --- |
| `{{FONTS}}` | Các `@font-face` của 2 font, chỉ lấy file woff2 và giữ `unicode-range` |
| `{{CAPTIONS}}` | Các clip phụ đề `.cap > .cap-in`, track 2 |
| `{{SFX}}` | Các thẻ `<audio>` SFX, track 10–12 |
| `{{DURATION}}`, `{{VOICE_DUR}}` | Độ dài video, độ dài voice |
| `{{END_DUR}}` | Độ dài cảnh cuối = `DURATION − mốc bắt đầu cảnh cuối` |
| `{{SVG_NAME}}` | Nhúng nội dung `art/*.svg`, hoặc chuỗi SVG khai báo trong `build.mjs` |

### 5.3 Helper GSAP hay dùng
```js
const up = (sel, at, d = 0.5, y = 36) => tl.fromTo(sel, { opacity: 0, y }, { opacity: 1, y: 0, duration: d, ease: "power3.out" }, at);
const pop = (sel, at, s = 0.7) => tl.fromTo(sel, { opacity: 0, scale: s }, { opacity: 1, scale: 1, duration: 0.42, ease: "back.out(2)" }, at);
const out = (sel, at, d = 0.22) => tl.to(sel, { opacity: 0, duration: d }, at);
const stampIn = (sel, at, rot) => tl.fromTo(sel, { opacity: 0, scale: 2.3, rotation: rot - 20 }, { opacity: 1, scale: 1, rotation: rot, duration: 0.28, ease: "power4.in" }, at);
const strike = (sel, at) => tl.fromTo(sel + " > i", { scaleX: 0 }, { scaleX: 1, duration: 0.4 }, at);   // gạch chữ
const swapTxt = (a, b, at) => { tl.to(a, { opacity: 0, duration: 0.12 }, at); tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.15 }, at + 0.08); };
const tap = (sel, at) => tl.fromTo(sel, { opacity: 1, scale: 0.3 }, { opacity: 0, scale: 1.5, duration: 0.5, immediateRender: false }, at); // điểm chạm
const cam = (vb, at, d = 0.9) => tl.to("#svg", { attr: { viewBox: vb }, duration: d, ease: "power2.inOut" }, at);                       // camera SVG
```
- **Số đếm / chữ chạy:** tween một object rồi ghi `textContent` trong `onUpdate`:
  `tl.fromTo(o, { v: 0 }, { v: 100, onUpdate: () => (el.textContent = Math.round(o.v)) }, at)`.
- **Camera trên SVG:** tween `attr.viewBox` của thẻ `<svg>`. Đối tượng di chuyển bằng `x/y` của một `<g>`.
- **Camera trên HTML:** đặt một dải rộng nhiều màn hình (ví dụ 5 × 1080px), rồi tween `x` của dải đó để lia ngang.
- **Biến CSS:** tween được trực tiếp, ví dụ `{"--x": "300px"}` cho tâm một vùng sáng `radial-gradient` hay `{"--k": 1}` cho độ dài một vạch.
- **Xoay quanh tâm trong SVG:** dùng `svgOrigin: "100 100"`.

### 5.4 Quy tắc tránh lỗi (lint và render)
- `fromTo` mặc định có `immediateRender`: giá trị "from" được áp ngay từ đầu video. Hiệu ứng chỉ hiện tạm (điểm chạm, rung, hạt bay ra, nhấp nháy) phải có `immediateRender: false`, nếu không chúng sẽ hiện sẵn từ khung đầu.
- Phần tử mà CSS để `opacity: 0` thì phần đích của `fromTo` phải ghi rõ `opacity: 1`. Nếu không, worker render khởi động lại từ trạng thái gốc sẽ không thấy phần tử (lỗi `gsap_cold_seek_hidden_fromto_missing_reveal`).
- Không vừa đặt `transform` trong CSS vừa tween `scale/rotation` bằng GSAP (lỗi `gsap_css_transform_conflict`). Đưa toàn bộ transform vào `fromTo`.
- Lớp phủ toàn màn hình phải bắt đầu ở `opacity: 0`.
- GSAP 3 không tween được `className` hay `textContent` bằng `set`. Đổi màu bằng `backgroundColor/borderColor`, đổi chữ bằng 2 phần tử rồi `swapTxt`.
- Chữ lớn chia dòng bằng `<span class="blk">` và khóa `white-space: nowrap`, để trình duyệt không tự ngắt thêm.
- Các cảnh báo `nested_structure_needs_subcomposition`, `composition_file_too_large`, `timeline_track_too_dense` không chặn render. Chỉ cần đưa **error** về 0.

### 5.5 Kiểm tra trước khi render
1. `npx hyperframes lint` trả về 0 error.
2. `npx hyperframes snapshot --no-end --at …` chụp tại các mốc nằm giữa mỗi cảnh, rồi xem `contact-sheet*.jpg`.
3. Sau khi render, cắt vài khung từ MP4 để chắc kết quả giống snapshot:
   ```bash
   for t in 3 20 45; do ffmpeg -loglevel error -y -ss $t -i output.mp4 -frames:v 1 -vf scale=360:-1 f-$t.png; done
   ffmpeg -i f-3.png -i f-20.png -i f-45.png -filter_complex hstack=3 sheet.png
   ```

---

## 6. SFX

### 6.1 Thư viện `sfx/`
- File `.wav` đã chuẩn hóa, kèm `catalog.json` (`class`, `use`, `base`, `variant`, độ dài, mức âm).
- `sfx-import.mjs` xử lý từng file:
  - Lọc tần số dưới 40 Hz.
  - Cắt lặng ở đầu và cuối.
  - Cắt theo độ dài tối đa của nhóm, rồi fade-out.
  - Đưa về mức trung bình mục tiêu của nhóm, rồi chặn đỉnh bằng limiter.

| Nhóm | Mức trung bình | Đỉnh tối đa | Dài tối đa |
| --- | --- | --- | --- |
| ui | -31 dB | -9 dBFS | 1,2 giây |
| transition | -30 | -8 | 1,6 |
| impact | -28 | -6 | 2,0 |
| accent | -30 | -8 | 3,0 |
| ambience | -36 | -14 | 4,0 |
| bed | -40 | -24 | 15,0 |

- **Phiên bản:** file `tên-2.mp3`, `tên-3.mp3` được nhập làm phiên bản của `tên`. Các phiên bản cùng tên được kéo về cùng mức (chênh ≤ khoảng 2,5 dB).
- Thêm âm mới: đặt tên file theo danh sách `META` trong `sfx-import.mjs` (thêm dòng mới nếu là âm mới), rồi chạy `node scripts/sfx-import.mjs <thư mục>`.

### 6.2 `sfx.json` và `sfx-cues.mjs`
```json
{ "gainDb": 6, "minGap": 0.6, "scenes": [0, 7.0, 9.6], "cues": [ { "at": 0.35, "name": "pop", "vol": 0.55, "why": "thẻ bật ra" } ] }
```
- `sfxHtml(cues, outDir, { gainDb, minGap, scenes })`:
  - Chép file vào `assets/sfx/`. Khi có `gainDb`, file được nâng mức rồi đi qua `alimiter limit=0.7`.
  - Sinh thẻ `<audio>` xếp xoay vòng trên track 10–12.
- **Gán phiên bản theo cảnh:** cảnh là khoảng giữa 2 mốc trong `scenes`. Trong cùng một cảnh, mọi cue cùng tên dùng chung một phiên bản; sang cảnh mới thì đổi sang phiên bản kế tiếp. Muốn ép phiên bản: ghi tên đầy đủ (`"pop-2"`) hoặc thêm `"group"` cho cue.
- **Chặn đặt quá dày:** 2 cue cách nhau dưới `minGap` thì build dừng với lỗi `SFX quá dày ở …`. Kiểm tra nhanh trước khi build:
  ```bash
  node -e 'const c=require("./sfx.json").cues.sort((a,b)=>a.at-b.at);c.forEach((x,i)=>i&&x.at-c[i-1].at<0.6-1e-6&&console.log(c[i-1].at,"->",x.at))'
  ```
- `vol` gợi ý: 0,45–0,6 cho thao tác giao diện, 0,85–1,0 cho khoảnh khắc chốt.

### 6.3 Đo âm lượng sau render
```bash
cd build/<ten-video>
ffmpeg -i assets/voice.wav -af volumedetect -f null - 2>&1 | grep max_volume
ffmpeg -i output.mp4      -af volumedetect -f null - 2>&1 | grep max_volume
# soi từng mốc SFX lớn
for t in 10.5 24.3; do ffmpeg -ss $t -t 0.6 -i output.mp4 -af volumedetect -f null - 2>&1 | grep max_volume; done
```
Đạt khi đỉnh của `output.mp4` không vượt đỉnh voice (khoảng -1,5 dBFS sau loudnorm).

---

## 6b. Hiệu ứng Motion Prompt (tùy chọn)

```bash
node scripts/motion/build.mjs projects/<ten-video> --plan-only   # xem cảnh nào dùng hiệu ứng gì, cảnh nào giữ nguyên + lý do
node scripts/motion/build.mjs projects/<ten-video> --no-render   # build/<ten-video>.motion/ + motion-log.json
node scripts/motion/build.mjs projects/<ten-video>               # render build/<ten-video>.motion/output.mp4
MOTION_PROMPT_BASE=vendor/motion-prompt/api/v1 node .claude/skills/motion-prompt/scripts/motion-prompt.mjs search <từ khóa tiếng Anh>
```

Chi tiết: `scripts/motion/README.md`.

## 7. Lỗi hay gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| Hiệu ứng tạm hiện sẵn từ khung đầu | Thêm `immediateRender: false` |
| Phần tử không hiện trong MP4 nhưng snapshot vẫn thấy | Ghi rõ `opacity: 1` ở phần đích của `fromTo` |
| Build dừng với lỗi "SFX quá dày" | Dời mốc hoặc bỏ bớt cue. So sánh có sai số `1e-6` |
| Phụ đề ngắt giữa từ ghép | Thêm từ vào `COMPOUNDS`, hoặc dùng `FORCE` |
| Phụ đề lệch lời (cụm siêu ngắn, tiếng động lạ) | Sửa tay `transcript.json` sau khi dò lặng ở ngưỡng chặt hơn |
| `hyperframes check` treo với video dài | Bỏ qua, dùng `lint` + `snapshot` rồi render thẳng |
| `pkill -f …` giết luôn shell đang chạy | Đừng `pkill` theo chuỗi có trong chính lệnh đang chạy |
| Hết dung lượng đĩa | Xóa thư mục cũ trong `build/` (`assets/`, `snapshots/`, `output.mp4` sinh lại được) |
