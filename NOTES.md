# NOTES: sổ tay series video "Sáu Suy Nghĩ"

Tài liệu tổng hợp cho người (hoặc AI) tiếp tục làm series. **Quy tắc bắt buộc nằm ở `CLAUDE.md`.** File này giải thích phong cách chung, cấu trúc repo, cách render và lịch sử từng post.

---

## 1. Series là gì

- Video ngắn dọc **1080×1920, 60–100 giây**, cho TikTok, Reels và Shorts.
- **Motion graphics dựng từ một file voice** có sẵn: không quay hình, mọi hình ảnh là đồ họa động (HTML, CSS, SVG, GSAP), render bằng **HyperFrames**.
- Nội dung là mẹo đời sống, tiền bạc, tâm lý, công nghệ, kể bằng giọng **miền Nam, xưng mày/tao, hài hước**.
- Người dẫn chuyện là **"Sáu Suy Nghĩ"** (từ post 8). Nhân vật chỉ xuất hiện ở đoạn chào "Chào mấy mày, tao là Sáu…", kèm nút Follow.

### Phong cách chung (giữ nguyên qua mọi post)

| Yếu tố | Quy ước |
| --- | --- |
| Cấu trúc | Hook tình huống đời thường → Sáu chào + Follow → giải thích → mẹo cụ thể → câu chốt hài, gọi lại hình ảnh mở đầu |
| Hình ảnh | Mỗi ý có **đồ vật hoặc giao diện minh họa cụ thể**. Mỗi post có **một ẩn dụ xuyên suốt** riêng |
| Nhịp | Bố cục đổi mỗi 3–5 giây; chữ lớn tự chia dòng theo nghĩa; phụ đề 5–7 từ |
| Chữ | 2 font (1 tiêu đề + **Be Vietnam Pro** cho phụ đề và chữ phụ); 1 màu chữ chính + 1 màu nhấn |
| Ngôn ngữ | Chữ tự viết dùng từ miền Nam (nha, khỏi, xài, vô…); phụ đề giữ đúng y lời voice |
| Âm thanh | Chỉ voice + SFX, **không nhạc nền**; SFX khoảng 1 điểm mỗi 1,5–2 giây, luôn dưới đỉnh giọng nói |
| Khác biệt | **Mỗi post một bộ màu, một font tiêu đề, một kiểu chuyển cảnh, một concept mới**. Không lặp lại post cũ |

### Nhân vật Sáu Suy Nghĩ

- Vẽ SVG theo avatar: tóc rối, kính tròn gọng mảnh, ria và chòm râu, mắt lim dim nhếch mép, chống cằm, áo thun đen số "6", nền tròn cam `#ff7a1a`.
- Các file:
  - `projects/post-9/art/sau.svg`: biểu cảm nhếch mép.
  - `projects/post-10/art/sau-laugh.svg`: cười híp mắt, há miệng.
  - `projects/post-8/art/sau-happy.svg`, `sau-shock.svg`: bản cũ hơn (vẽ đơn giản hơn, trước khi có avatar).
- **Không đưa ảnh avatar thật vào video.** Chỉ dùng bản vẽ SVG.
- Có thể animate các lớp: `.head` (gật gù), `.brow-r` (nhướng mày), `.hand` hoặc `.fist`.

---

## 2. Cấu trúc thư mục

```
editvideo/
├── CLAUDE.md              # quy tắc bắt buộc (ngôn ngữ, xuống dòng, chữ, minh họa, SFX, quy trình)
├── NOTES.md               # file này
├── projects/post-N/       # mỗi post một thư mục
│   ├── voice.wav          # voice gốc người dùng gửi
│   ├── script.txt         # kịch bản (dòng "A:"/"B:" = người nói; "~cười~" = chỗ có tiếng cười)
│   ├── transcript.json    # cụm lời + mốc thời gian (sinh bởi scripts/align.mjs, có thể sửa tay)
│   ├── template.html      # toàn bộ thiết kế + timeline GSAP, có các placeholder {{…}}
│   ├── build.mjs          # sinh phụ đề, nhúng font/SVG/SFX, render
│   ├── sfx.json           # { gainDb, minGap, scenes, cues[] }
│   └── art/               # SVG riêng của post (nhân vật, mặt bằng nhà…)
├── scripts/
│   ├── align.mjs          # khớp kịch bản vào voice, chạy offline
│   ├── vn-text.mjs        # ngắt dòng tiếng Việt theo nghĩa (breakLines, canBreak, COMPOUNDS)
│   ├── sfx-import.mjs     # chuẩn hóa SFX vào thư viện sfx/
│   ├── sfx-cues.mjs       # gắn SFX vào composition, xoay phiên bản theo cảnh, chặn đặt quá dày
│   ├── build.mjs / render.mjs / voice.mjs / make-placeholders.sh   # pipeline listing BĐS (thử nghiệm đầu)
│   └── recut/             # pipeline dựng lại clip quay thô (thử nghiệm, dùng Gemini)
├── sfx/                   # thư viện SFX đã chuẩn hóa (*.wav) + catalog.json
├── listings/              # dữ liệu cho pipeline listing BĐS
├── raw/                   # clip thô (xuan-mik.mp4)
├── build/   (gitignore)   # kết quả build: build/post-N/index.html, output.mp4, snapshots/
└── work/    (gitignore)   # file tạm (plan.json của recut, model RNNoise…)
```

---

## 3. Cách làm và render một post

Cần Node 22+, FFmpeg, `npm install`. Font lấy từ `@fontsource/*`, đều có bộ ký tự tiếng Việt.

```bash
# 1) Tạo thư mục, chép voice, viết script.txt
mkdir -p projects/post-11/art && cp voice.wav projects/post-11/

# 2) Khớp kịch bản vào voice (offline, vài giây)
node scripts/align.mjs projects/post-11/voice.wav projects/post-11/script.txt projects/post-11/transcript.json
#    → đọc lại output; cụm lạ (tiếng cười, cụm quá ngắn) thì sửa tay transcript.json

# 3) Copy build.mjs từ post gần nhất, sửa: font, NO_CAP (cụm không chạy phụ đề), các placeholder
# 4) Viết template.html + sfx.json (khai báo "scenes" là mốc bắt đầu từng cảnh)

# 5) Build không render, chụp kiểm tra
node projects/post-11/build.mjs --no-render
cd build/post-11 && npx hyperframes lint && npx hyperframes snapshot --at 3,10,20,...

# 6) Render (khoảng 2–3 phút cho video 80 giây)
node projects/post-11/build.mjs
#    → build/post-11/output.mp4
```

**Cần kiểm tra trước khi giao video:**
- Lint 0 lỗi.
- Đọc lại snapshot mọi khung có chữ 2 dòng (xem quy tắc xuống dòng trong `CLAUDE.md`).
- Phụ đề không có chữ lẻ.
- Đo âm lượng: SFX không vượt đỉnh voice. Đo bằng `volumedetect` trên `assets/voice.wav` và `output.mp4` tại các mốc SFX lớn.
- Liệt kê cho người dùng những nội dung tự bịa thêm (tên app, số liệu minh họa, tin nhắn…).

### Placeholder `build.mjs` hay dùng

| Placeholder | Nội dung |
| --- | --- |
| `{{FONTS}}` | `@font-face` của 2 font (chỉ lấy woff2, giữ unicode-range) |
| `{{CAPTIONS}}` | Phụ đề sinh từ `transcript.json` |
| `{{SFX}}` | Các thẻ `<audio>` SFX |
| `{{VOICE_DUR}}`, `{{DURATION}}` | Độ dài voice, độ dài cả video (voice + 1,3 giây) |
| `{{S9_DUR}}` | Độ dài cảnh cuối (`DURATION − mốc bắt đầu`) |
| `{{SAU}}`, `{{SAU_LAUGH}}`, `{{PLAN}}`, `{{ICON_*}}`… | SVG nhúng từ `art/` hoặc khai báo trong `build.mjs` |

**Phụ đề** tự động: chia 5–7 từ, ngắt theo nghĩa (`vn-text.mjs`), hiện sớm 0,15 giây, gộp chữ lẻ, đặt ở top 1500px. Các cụm đã hiện bằng hình (bong bóng chat, câu trích, đoạn Sáu chào) đưa vào `NO_CAP`.

---

## 4. Quy ước font, màu, âm thanh

### Font và màu đã dùng (post mới phải chọn bộ chưa dùng)

| Post | Font tiêu đề | Nền | Màu nhấn | Ghi chú |
| --- | --- | --- | --- | --- |
| 5 | Nunito | Kem sáng → đổi theo giờ trong ngày | San hô `#ff5a3c` | |
| 6 | JetBrains Mono (con số) | Đen kẻ lưới sổ kế toán | Vàng highlight `#ffd23f` | |
| 6b | Nunito | Hồng nhạt → bạc hà | Xanh lá `#0f8a57` | Bản post 6 theo phong cách post 5 |
| 7 | Lexend | Tím nhạt chấm bi | Xanh dương `#3557ff` | |
| 8 | Montserrat | Xanh đêm `#0d1321` | Cam cảnh báo `#ff7a1a` | |
| 9 | Baloo 2 | Hồng phấn `#fff0f3` | Đỏ hồng `#e8335a` | |
| 10 | Space Grotesk | Giấy kraft `#f4ede1` | Xanh ngọc `#0fa3a3` | |
| 11 | Playfair Display (serif) | Đỏ son `#7a1317` → nâu đêm `#2a1112` → đỏ | Vàng kim `#f5c242` | Giấy lịch kem, số đỏ |
| 12 | Bungee (chữ bảng hiệu) | Xanh đêm `#0f2a22` | Xanh chanh `#c8f03c` | Bạt sọc chanh/kem, dây đèn |
| 13 | Pangolin (viết tay) | Tường tím than `#241d33` (cố định) | Vàng đèn `#ffc65c` | Trời trong cửa sổ đổi theo giờ; đầu video đen trắng |
| 14 | Paytone One | Giấy thi có dòng kẻ xanh + lề đỏ `#fbf8ef` | Mực đỏ chấm bài `#e0352b` (chữ chính mực xanh `#23339a`) | |
| 15 | Barlow Condensed (biển chỉ dẫn) | Bê tông sáng `#e9e7e2` | Vàng biển báo `#ffcf00` (chữ chính đen) | Tiêu đề là các tấm biển đen |
| 19 | Fraunces (serif tạp chí thám hiểm) | Nâu đá tối `#14100c` | Xanh lá rừng `#7ee08a` | Mặt cắt lòng núi |
| 21 | Bricolage Grotesque | Bạc hà `#e7f3ec` chấm Riso | Hồng huỳnh quang `#ff4f9a` (chữ chính xanh than) | Bóng chữ lệch kiểu in Riso |
| 22 | Lora (serif từ điển) | Giấy ngà `#f4ead8` | Đỏ đất `#c4532f` (chữ chính nâu mực) | |
| 23 | Plus Jakarta Sans | Xám bản đồ `#f1f2f6` | Tím `#5b3df5` | |
| 24 | Literata | Đêm xanh than `#12161c`, chữ kem `#efe8da` | Vàng nến `#d9b26a` (đỏ cờ chỉ trong cảnh lễ) | Giọng trang nghiêm, SFX thưa |

- Font phụ đề và chữ phụ luôn là **Be Vietnam Pro**.
- Font đã cài sẵn: nunito, jetbrains-mono, lexend, montserrat, baloo-2, space-grotesk, playfair-display, bungee, pangolin, paytone-one, barlow-condensed, fraunces, bricolage-grotesque, lora, plus-jakarta-sans, be-vietnam-pro.
- Phụ đề: chữ trắng 44px, Be Vietnam Pro 600, nền tối bán trong suốt bo góc kèm đổ bóng, khung trái 108px phải 150px.

### Âm thanh

- Voice chuẩn hóa về -14 LUFS (loudnorm trong `build.mjs`). Không có nhạc nền.
- Thư viện `sfx/`: 53 âm gốc, 89 file kể cả phiên bản (đã xóa `scribble-2` theo yêu cầu, cấm dùng lại) (`pop`, `pop-2`…). Đã chuẩn hóa:
  - Cắt lặng đầu và cuối, lọc tần số dưới 40 Hz, giới hạn độ dài theo nhóm.
  - Âm lượng trung bình khoảng -30 dB, có limiter chặn đỉnh.
  - Các phiên bản cùng tên chênh nhau ≤ khoảng 2,5 dB.
- Cấu hình `sfx.json` đã được duyệt: `gainDb: 6`, `minGap: 0.6`, khai báo `scenes`.
  - Trong cùng một cảnh luôn dùng một phiên bản; sang cảnh mới đổi phiên bản kế tiếp.
  - Âm giao diện đặt vol 0,5–0,6; khoảnh khắc chốt (dấu đóng, ra kết quả, câu cuối) đặt 0,85–1,0.
- **Họ âm theo loại sự kiện:**
  - Chuyển cảnh: `whoosh-soft` / `whoosh-fast` / `whoosh-heavy` / `zoom-in`.
  - Thẻ hoặc icon bật ra: `pop`.
  - Bấm, chọn: `click`, `toggle`.
  - Gạch chữ: `scribble`.
  - Đóng dấu, nhãn đập: `stamp`.
  - Tiền: `coin`, `cash`.
  - Đúng, xong: `success`, `ding-idea`.
  - Hài, hụt: `boing`, `oops`, `record-scratch`, `lose`.
  - Điện thoại: `notify`, `phone-ring`, `phone-vibrate`, `hang-up`, `send`.
  - Dồn nhịp: `riser`, `riser-long`.
  - Chốt câu cuối: `cymbal`, `stamp`.

---

## 5. Các thư viện và kỹ thuật dùng lại được

| Kỹ thuật | Post mẫu | Ghi chú |
| --- | --- | --- |
| Khung chat có "đang nhập…" | 7 | Bong bóng chính là chữ, không chạy phụ đề trùng |
| Giao diện thật của vụ lừa (thông báo số dư, cuộc gọi đến, sóng âm) | 8 | |
| Hướng dẫn bấm từng bước trên iPhone và Android | 9 | Điểm chạm gợn sóng (`immediateRender: false`), màn hình trượt kiểu `push()` |
| "Thế giới" SVG có camera (`attr.viewBox`) + nhân vật đi lại | 10 | Đặt trong khung bo góc |
| Đèn soi (radial-gradient + biến CSS `--x/--y`) | 10 | Chỉ phủ trong khung |
| Biểu đồ, thanh so sánh, số đếm (`count()`), lưới chấm | 6, 6b | |
| Dấu đóng (`stampIn`), gạch chữ (`strike`), gạch chân (`ul`), highlight (`mark`) | 6–10 | |
| Thẻ lật mặt 3D (bài toán → quyết định) | 7 | |
| Bảng clapper, cuộn phim, cây kéo | 10 | |

---

## 6. Lịch sử các post

Repo **không có post 1–4 được đánh số**. Trước post 5 là giai đoạn thử nghiệm công cụ:

| Giai đoạn | Nội dung | Vị trí |
| --- | --- | --- |
| Thử nghiệm 1 | Video listing bất động sản tự động: JSON và ảnh thành video 9:16 (ảnh mẫu là ảnh placeholder) | `listings/`, `scripts/build.mjs`, `render.mjs` |
| Thử nghiệm 2 | Thêm giọng đọc tiếng Việt bằng Gemini TTS: gọi 1 lần cho cả kịch bản rồi cắt theo khoảng lặng, tốc độ 1.1 | `scripts/voice.mjs` (cần `GEMINI_API_KEY`) |
| Thử nghiệm 3 | Dựng lại clip thô "Imperia Sensa Park (MIK) vs Gladia Heights (Khang Điền)": cắt nhịp, lọc ồn RNNoise, phụ đề, thẻ thông tin. Có 3 bản; người dùng chê text và nhịp dựng, chuyển hướng sang motion graphics | `scripts/recut/`, `raw/xuan-mik.mp4` |

**Từ thử nghiệm 3 trở đi, người dùng yêu cầu không phụ thuộc API ngoài cho khâu biên tập.** `align.mjs` thay thế hoàn toàn Gemini.

| Post | Chủ đề | Ẩn dụ / concept | Điểm mới | Thời lượng · SFX |
| --- | --- | --- | --- | --- |
| **5** | Việc nhỏ lởn vởn trong đầu, hãy quyết định "khi nào" | **Một ngày**: nền đổi màu sáng → trưa → chiều → tối → bình minh; chấm nhỏ lởn vởn trong "cái đầu", rời đi ở cảnh kết | Post motion graphics đầu tiên; đặt chuẩn chữ, vùng an toàn, phụ đề | 62,8s · 13 |
| **6** | Chi phí trên mỗi lần dùng, đừng mắc bẫy giảm giá | **Hóa đơn và phép tính**: hóa đơn in từng dòng, 5 chấm và 150 chấm, phép chia lắp ráp | Nền tối, font mono cho số, chuyển cảnh đẩy dọc | 92,8s · 16 |
| **6b** | (cùng voice post 6) | Phong cách post 5 cho chủ đề tiền: thẻ trắng, gạch chân xanh | Lần đầu tăng SFX lên +6 dB và dày hơn (người dùng duyệt) | 92,8s · 49 |
| **7** | Từ chối không cần lý do | **Khung chat**: lời từ chối thành bài toán người khác giải, lật thành "một quyết định" | Hội thoại A/B dạng chat, không phụ đề trùng; `align.mjs` (bỏ Gemini) | 77,2s · 47 |
| **8** | Lừa đảo "chuyển lộn tiền" | **Ứng dụng ngân hàng ban đêm**: thông báo số dư, cuộc gọi đến, dòng tiền lật ngược, giấy đòi nợ | Lần đầu có nhân vật Sáu (2 biểu cảm); quy tắc giọng miền Nam và xuống dòng ghi vào `CLAUDE.md` | 77,6s · 56 |
| **9** | Xóa app ≠ hủy gói đăng ký | **App là người yêu cũ**: ảnh đôi bị xé, quyết định cấp dưỡng, "ứng dụng cũ" | Hướng dẫn hủy gói trên iPhone và Android từng bước; Sáu vẽ theo avatar; SFX có phiên bản theo cảnh | 98,0s · 68 |
| **10** | Hiệu ứng ngưỡng cửa | **Bản vẽ mặt bằng nhà có camera**: đèn soi tìm "thủ phạm", bong bóng suy nghĩ bị xóa khi qua cửa, gói mì | Thế giới SVG xuyên suốt + camera viewBox; Sáu cười theo tiếng cười trong voice; clapper và cắt phim | 76,7s · 52 |
| **11** | Còn chưa tới 4 tháng là Tết: đừng để bữa khác | **Cuốn lịch xé (lịch bloc)**: mở đầu xé tới Mùng 1 Tết 6/2/2027, mỗi tờ ghi "còn N ngày"; cảnh kết dán note "thôi, để bữa khác." rồi xé tiếp | Nền đổi màu theo cảm xúc (đỏ → nâu đêm → đỏ); lịch hẹn bị dời xuống hàng "Bữa khác"; ghế trống ở bàn cơm; `FORCE`/`KEEP` chỉnh ngắt phụ đề tay | 97,8s · 79 |
| **12** | Chợ flo: 5 bước để tăng flo (kịch bản cố ý viết "flo" thay "follow" → mọi chữ trên hình dùng "flo") | **Chợ đêm "CHỢ FLO"**: cổng chợ có dây đèn, dãy 5 sạp mái bạt sọc, camera lia ngang từng sạp theo từng bước | Vé vô chợ, thả tim, gửi liên kết bằng máy bay giấy, đăng lại kéo người vô, gõ bình luận "CÓ MẶT! 37 flo!"; bảng chỉ đường "HỔNG CÓ BÁN" người yêu; cảnh kết gọi lại cổng chợ | 61,1s · 57 |
| **13** | Một ngày bình thường cũng đáng vui | **Ô cửa sổ nhìn ra phố**: trời đổi sáng/chiều/tối/bão, camera zoom vào ô cửa "Nhà mình"; đầu video cả ô cửa đen trắng (chán phèo), tới "Nhưng mày thử nghĩ coi" màu quay lại | Đồ trên bậu cửa (đồng hồ, chén cơm, gối, đèn); tin nhắn của Má; bão + kính nứt + tấm polaroid "một ngày bình thường"; kết bằng đèn ấm. SFX nhẹ hơn cho hợp giọng lắng | 57,8s · 42 |
| **14** | "Ăn gì cũng được" là một bài kiểm tra (hội thoại A/B) | **Giấy kiểm tra**: lời thoại thành bong bóng, gợi ý món thành phiếu trắc nghiệm bị gạch bút đỏ; đề không phát, đáp án niêm phong; câu 2 trắc nghiệm, khoanh đáp án, chấm 10, giấy báo trúng tuyển trợ lý giám đốc | Nét bút đỏ tự vẽ (`pathLength=1` + `strokeDashoffset`); tắt phụ đề ở mọi đoạn thoại | 55,2s · 42 |
| **15** | Hiệu ứng thang cuốn hư | **Biển chỉ dẫn ga tàu**: mặt cắt ga (cầu thang thường + thang cuốn TẠM NGƯNG), người hình biển báo đi, chao, chúi; thí nghiệm sàn chạy; não hai bộ phận cãi nhau; tối Chủ nhật vs sáng thứ Hai | Chân người đung đưa quanh hông (`transformOrigin: 50% 0%`); `FORCE` tự gộp chữ dư nếu đếm thiếu | 80,7s · 52 |
| **19** | Khu rừng trong hang Sơn Đoòng | **Mặt cắt lòng núi**: camera lặn 200 m qua các vỉa đá vôi (thước đo độ sâu), đoàn thám hiểm đeo đèn đi xuyên rừng tới vách hang, quay ngược thời gian lúc mái hang sập, nắng lọt vô và cây mọc; cây ngoài trời vs cây trong hang; kết bằng người đứng trên mặt đất, mũi tên xuống khu rừng | Thế giới SVG cao 3000 đơn vị; bọc `<g>` khi cần animate y của phần tử có `transform` | 91,2s · 47 |
| **21** | Earworm: nhạc tự lặp trong đầu | **Cái đầu là máy cát-xét**: băng quay, liveshow lúc đi ngủ, bấm tắt không được; "con sâu trong tai"; sóng nhạc chọn đúng 10 giây lặp x99, cờ trắng; DJ quên danh sách nhạc; nghiên cứu nhai kẹo (biểu đồ minh họa); nhai làm băng khựng; két sắt "giữ kỹ như tài sản thừa kế" | Riso: `text-shadow` hồng lệch | 79,4s · 54 |
| **22** | Những câu ba má nói | **Từ điển ba má**: mâm cơm còn một miếng ngon, mỗi câu là một mục từ (nghĩa đen / nghĩa thật, bút dạ đánh dấu), "Chừng nào rảnh thì về chơi" = ba má nhớ con; hồi nhỏ vs lớn lên; mục cuối "Con về." = chuyện đặc biệt | Mục từ lật trang `rotationY`; tắt phụ đề ở các câu trích | 78,4s · 38 |
| **23** | Google Maps Dòng thời gian | **Bản đồ ký ức**: ghim + dấu chấm đường đi trên bản đồ có camera; hướng dẫn 4 bước trên điện thoại mô phỏng (mở app, hình đại diện, Dòng thời gian, chọn ngày cũ); quán cà phê quên tên, chuyến đi, con đường quen; 4 thẻ lưu ý riêng tư; kết "điện thoại lưu địa điểm, mình nhớ cảm giác" | Giao diện app là mô phỏng chung, không chép giao diện thật | 85,0s · 44 |
| **24** | 731 liệt sĩ · Lê Thị Riêng | **Tháp nước làm manh mối**: 3 bức ảnh cũ vẽ lại trừu tượng (không vẽ hài cốt) → lớp đất nghĩa địa → công viên → nhân chứng hỏi "ở đâu?" → KTS Nguyễn Xuân Thắng, bảng ghim nối manh mối → sơ đồ Cư xá Bắc Hải → 8 năm → 731 = 698 + 33 chấm → lễ truy điệu (hộp phủ cờ, đội nghi lễ, người thắp nhang) → bàn vẽ tương lai/quá khứ → thẻ danh tính trống → tri ân, "một con người, một quê hương, một gia đình" | Ảnh người dùng gửi chỉ để tham khảo; sơ đồ không theo tỷ lệ | 321,5s · 191 |

### Bài học đã rút ra (đã đưa vào `CLAUDE.md` hoặc code)

- Gọi TTS từng câu làm giọng không đồng nhất và tốn hạn mức, nên **gọi 1 lần rồi cắt theo khoảng lặng**.
- Text xấu, rối mắt, chữ lớn đè hình, hiện quá nhanh, SFX tự tổng hợp dở (phản hồi về recut và post 5–6), nên đặt bộ chuẩn chữ, vùng an toàn và thời lượng tối thiểu.
- Xuống dòng sai nghĩa ("thử | nghiệm", "quyết | định", "reo." đứng riêng), nên viết `vn-text.mjs`, khóa `nowrap`, gộp chữ lẻ.
- SFX trùng giờ nhau và xen kẽ phiên bản lung tung, nên thêm `minGap` (có dung sai làm tròn) và xoay phiên bản theo `scenes`.
- Animation tạm (điểm chạm, sóng) hiện sẵn từ đầu, nên dùng `immediateRender: false`; lớp phủ toàn màn hình phải bắt đầu với `opacity: 0`.
- Cụm tiếng siêu ngắn (tiếng thở, đuôi tiếng cười) làm lệch bước khớp, nên `align.mjs` bỏ cụm dưới 0,12 giây; tiếng cười thì soi năng lượng audio và sửa tay.

### Ý tưởng chưa dùng cho các post sau

- Bộ màu: xanh rêu và kem, đen và hồng neon, xanh navy và vàng mù tạt, trắng và đỏ cờ.
- Concept: bản đồ thành phố có camera, game board / thẻ bài, bảng tin TV, timeline lịch sử, mô phỏng web trình duyệt.
- SFX còn thiếu trong thư viện: `camera-shutter`, `glitch`, `drumroll`, `ta-da`, `sigh`, `gulp`, `card-beep`, `timer-beep`, `countdown`, âm nền `office` và `rain`.
