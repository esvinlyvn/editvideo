# editvideo toolkit

Bộ công cụ dựng video dọc 1080×1920 từ một file giọng đọc, bằng [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML + GSAP → MP4).

- Khớp lời thoại vào voice, chạy offline (`scripts/align.mjs`).
- Phụ đề tiếng Việt ngắt dòng theo nghĩa (`scripts/vn-text.mjs`).
- Thư viện SFX đã chuẩn hóa (`sfx/`), có công cụ nhập âm mới (`scripts/sfx-import.mjs`) và gắn SFX theo cảnh (`scripts/sfx-cues.mjs`).

## Chạy thử

Cần Node.js 22+ và FFmpeg.

```bash
npm install
npm run example            # build + render projects/example → build/example/output.mp4
```

Chi tiết xem [`TOOLKIT.md`](TOOLKIT.md).
