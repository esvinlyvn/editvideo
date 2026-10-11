#!/usr/bin/env bash
# Tạo ảnh minh họa (placeholder) cho listing mẫu khi chưa có ảnh thật.
# Dùng: scripts/make-placeholders.sh <thư-mục-photos>
set -euo pipefail
out="${1:?thiếu thư mục đích}"
mkdir -p "$out"
font=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
make() { # name c0 c1 c2 label
  ffmpeg -loglevel error -y -f lavfi \
    -i "gradients=s=1440x2400:c0=$2:c1=$3:c2=$4:nb_colors=3:type=radial:x0=300:y0=500:x1=1300:y1=2300:d=1" \
    -vf "noise=alls=7:allf=u,vignette=PI/5,drawtext=fontfile=$font:text='ẢNH MẪU · $5':fontcolor=white@0.55:fontsize=46:x=(w-tw)/2:y=150" \
    -frames:v 1 -q:v 3 "$out/$1.jpg"
}
make 01-ngoai-that  0xf2c27b 0x8a5a44 0x1f2a44 "NGOẠI THẤT"
make 02-phong-khach 0xe9dccb 0xb08968 0x3d2c23 "PHÒNG KHÁCH"
make 03-bep         0xdfe7e2 0x7d9a8c 0x2b3a35 "BẾP"
make 04-phong-ngu   0xf0e1d2 0xa47c6b 0x2e2430 "PHÒNG NGỦ"
make 05-view        0xffd6a5 0x5c7fa3 0x15233b "VIEW SÔNG"
