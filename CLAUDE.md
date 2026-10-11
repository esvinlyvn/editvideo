# editvideo: tiêu chuẩn dựng video (đọc trước khi làm bất kỳ post nào)

Repo dựng video ngắn dọc 1080×1920 bằng HyperFrames (HTML + GSAP → MP4).
Mỗi post nằm trong `projects/post-N/`, gồm `voice.wav`, `script.txt`, `transcript.json`, `template.html`, `sfx.json` và `build.mjs`.
Build: `node projects/post-N/build.mjs`. Kết quả nằm ở `build/post-N/output.mp4`.

**Mỗi post phải tốt hơn post trước.** Không lặp lại concept, bố cục hay màu của post cũ. Mỗi post cần một ý tưởng hình ảnh xuyên suốt riêng.

## 1. Ngôn ngữ: giọng người miền Nam

- Mọi chữ trên màn hình do mình viết thêm (tiêu đề, nhãn, lời minh họa, tin nhắn bịa thêm…) phải dùng **từ ngữ miền Nam**:
  - nha (không dùng "nhé"), dạ (không dùng "ạ"), vậy (không dùng "thế"), ba/má (không dùng "bố/mẹ"), bao nhiêu, chút xíu.
  - khỏi (thay "không cần"), mắc (thay "đắt", khi phù hợp), xài (thay "dùng", khi tự nhiên), tụi mình, ổng/bả, hổng, nè, hen.
- **Phụ đề và bong bóng trích lời phải đúng y lời trong voice/kịch bản.** Không sửa lời gốc, kể cả khi lời gốc có từ miền Bắc.
- Không dùng tiếng lóng Bắc ("vãi", "điêu"…) trong chữ tự viết.

## 2. Xuống dòng: phải đúng ngữ nghĩa

- **Không bao giờ để trình duyệt tự ngắt dòng ở chữ lớn** (tiêu đề, thẻ, nhãn dán, bong bóng). Tự chia dòng bằng `<span class="blk">` hoặc `<br>` theo cụm nghĩa.
- **Không cắt đôi từ ghép:** "quyết | định", "nước | ngoài", "đi | nhậu", "chi | tiết", "giải | thích", "tham | gia" đều SAI.
- **Không cắt đôi tên riêng:** "Imperia Sensa | Park" là sai.
- **Không để chữ lẻ cuối dòng hay đầu dòng:** "tháng?", "lời!", "nộp" đứng một mình là sai.
- **Ưu tiên ngắt ở dấu câu, hoặc ngay trước từ nối** (và, là, mà, của, để, nhưng, khi, thì, với…). Không ngắt ngay sau từ nối ("là một bài để | người ta giải" là sai, phải là "là một bài toán | để người ta giải").
- **Phụ đề:** dùng `scripts/vn-text.mjs` (`breakLines`) để tự chọn chỗ xuống dòng. Bổ sung từ ghép mới vào từ điển `COMPOUNDS` khi gặp.
- **Sau khi render, xem lại snapshot** của mọi khung có chữ 2 dòng và đọc to từng dòng để kiểm tra có gây hiểu lầm không.

## 3. Chữ (typography)

- Tối đa 2 font: 1 font cho chữ lớn/tiêu đề, 1 font cho phụ đề/chữ phụ. Font phải có bộ ký tự tiếng Việt (@fontsource, subset vietnamese).
- Chỉ 1 màu chữ chính và 1 màu nhấn. Tương phản cao. Phụ đề luôn có nền tối bán trong suốt và đổ bóng.
- Vùng an toàn: cách mỗi cạnh ≥10% (ngang 108px, dọc 192px). Phụ đề chừa thêm lề phải (150px) để tránh cột nút của TikTok. Phụ đề đặt ở top khoảng 1500px.
- Phụ đề: 5–7 từ mỗi cụm, tối đa 2 dòng, hiện sớm 0,15 giây, tắt khi câu nói kết thúc.
- Đoạn nào đã có chữ hiển thị trên hình (bong bóng chat, câu trích) thì không chạy phụ đề trùng lặp.

## 4. Minh họa

- Mỗi ý trong voice cần một **đối tượng minh họa cụ thể** (đồ vật, giao diện, biểu đồ, giấy tờ, icon…), không chỉ là chữ. Tự hỏi: "câu này vẽ được thành cái gì?"
- Ưu tiên ẩn dụ xuyên suốt cả video và gọi lại hình ảnh mở đầu ở cảnh kết.
- Bố cục phải đổi nhịp khoảng 3–5 giây một lần: thẻ, chia đôi, toàn màn, giao diện chat/điện thoại…
- Nội dung minh họa tự bịa (ví dụ tin nhắn, việc cần làm) phải hợp ngữ cảnh, viết bằng giọng miền Nam, và **báo lại cho người dùng** khi giao video.

## 5. SFX

- Thư viện chung nằm ở `sfx/` (đã chuẩn hóa, xem `sfx/catalog.json`). Thêm âm mới bằng `node scripts/sfx-import.mjs <thư mục>`.
- Mỗi post có `sfx.json` dạng `{ "gainDb": 6, "minGap": 0.6, "cues": [...] }`. Mức người dùng đã duyệt: +6 dB, khoảng 1 điểm mỗi 1,7–2 giây.
- Mỗi loại chuyển động có họ âm riêng, khớp đúng khung hình. Âm nhỏ (0,5–0,6) cho thao tác giao diện, âm lớn (0,85–1,0) cho khoảnh khắc chốt.
- Không có nhạc nền, trừ khi người dùng yêu cầu.
- Sau khi render, đo lại âm lượng: SFX không được vượt đỉnh của giọng nói.

## 6. Quy trình (không phụ thuộc API)

1. Có kịch bản: `node scripts/align.mjs voice.wav script.txt transcript.json` (chạy hoàn toàn trên máy).
2. Lên storyboard theo mốc thời gian, rồi viết `template.html` (copy và sửa `build.mjs` từ post gần nhất).
3. `node build.mjs --no-render`, chạy `npx hyperframes snapshot --at …`, xem contact sheet và sửa lỗi bố cục, xuống dòng, tương phản.
4. Render, đo âm lượng, rồi giao video kèm ghi chú những gì tự bịa thêm.
- Không gọi Gemini hay API ngoài cho khâu biên tập. API key (nếu có) chỉ để trong biến môi trường, tuyệt đối không commit.
