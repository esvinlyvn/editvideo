# editvideo: video listing bất động sản tự động

Pipeline thử nghiệm với [HyperFrames](https://github.com/heygen-com/hyperframes):
**thông tin căn hộ (JSON) + ảnh → video dọc 1080×1920 (TikTok / Reels / Shorts)**, không cần dựng tay.

## Cấu trúc video (~30–35s, tự tính theo số ảnh)

| Cảnh | Nội dung |
| --- | --- |
| Hero | Ảnh chính + thương hiệu, nhãn, tiêu đề, dự án, vị trí |
| Gallery | Mỗi ảnh 3,5s, zoom chậm (Ken Burns) + chú thích + số thứ tự |
| Thông số | Diện tích / PN / WC / tầng: số đếm chạy + hướng nhà |
| Kết nối | Bao nhiêu phút tới các tiện ích (bỏ qua nếu không có `nearby`) |
| CTA | Giá, ghi chú, tên và SĐT môi giới, thương hiệu |

Các cảnh chuyển bằng crossfade, có thanh tiến trình chạy trên cùng.

## Cài đặt

Cần Node.js 22+ và FFmpeg.

```bash
npm install
```

## Tạo video

```bash
npm run video -- listings/the-riverside-2pn   # 1 căn
npm run video -- --all                        # tất cả căn trong listings/
```

Kết quả: `build/<slug>/output.mp4`. Lệnh sẽ tự build, chạy `hyperframes check` rồi render.

Muốn xem trước hoặc chỉnh trực quan trong Studio:

```bash
npm run build -- listings/the-riverside-2pn
cd build/the-riverside-2pn && npx hyperframes preview
```

## Thêm một căn mới

1. Tạo thư mục `listings/<slug>/` gồm `listing.json` và thư mục `photos/`.
2. Copy `listings/the-riverside-2pn/listing.json` rồi sửa nội dung.
3. Ảnh nên dùng **ảnh dọc**, hoặc ảnh ngang có chủ thể ở giữa, vì video tự crop về khổ 9:16.
4. Có thể thêm nhạc nền (tùy chọn): `"music": "audio/nhac.mp3"` (đường dẫn tương đối trong thư mục listing).

Ảnh trong listing mẫu là **ảnh minh họa** tạo bằng `scripts/make-placeholders.sh`. Hãy thay bằng ảnh thật của dự án.

## Giới hạn hiện tại

- Mới làm phần **đóng gói** (ảnh + chữ + hiệu ứng). Chưa cắt dựng footage quay thô.
- Chưa có giọng đọc (TTS) và nhạc nền mặc định.
- Màu sắc và font (Be Vietnam Pro) đặt trong `scripts/build.mjs` (biến CSS `--ink`, `--paper`, `--gold`).
