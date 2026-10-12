# Bộ công cụ dựng video dọc bằng HyperFrames

Đọc **`TOOLKIT.md`** trước khi làm: cấu trúc thư mục, pipeline, cách viết template, xử lý voice và SFX, lệnh chạy.

- Mỗi video là một thư mục `projects/<ten-video>/`. Bắt đầu bằng cách chép `projects/example/`.
- Build: `node projects/<ten-video>/build.mjs [--no-render]`. Kết quả nằm ở `build/<ten-video>/`.
- Trước khi render: `npx hyperframes lint` phải 0 error. Chụp `npx hyperframes snapshot --at …` và xem contact sheet.
- Sau khi render: đo `volumedetect`, SFX không được vượt đỉnh voice.
- Mọi bước chạy trên máy, không gọi API ngoài. Không commit API key.
