// Ngắt dòng tiếng Việt theo ngữ nghĩa cho phụ đề / chữ trên màn hình.
//   breakLines("Có những trường hợp mày nên giải thích rõ ràng.", 26) → ["Có những trường hợp", "mày nên giải thích rõ ràng."]
// Quy tắc: không cắt đôi từ ghép (COMPOUNDS) hay tên riêng; ưu tiên ngắt sau dấu câu hoặc ngay TRƯỚC từ nối;
// không ngắt ngay SAU từ nối; tránh dòng lẻ 1–2 chữ; 2 dòng càng cân càng tốt.
export const LINK = new Set("và là mà của để nhưng khi thì với cho từ ở trong bởi vì nên hay hoặc rằng nếu chứ còn thành".split(" "));
// Đại từ chủ ngữ: nên đứng ĐẦU dòng cùng vị ngữ, không treo cuối dòng
export const PRONOUN = new Set("mày tao mình nó tụi người anh chị em ổng bả họ ta".split(" "));
// Số đếm: không tách khỏi danh từ đi sau ("ba | cuộc họp" là sai)
const NUMBER = new Set("một hai ba bốn năm sáu bảy tám chín mười mấy vài những các mỗi".split(" "));

// Từ ghép hay gặp — bổ sung dần khi gặp chỗ ngắt sai
export const COMPOUNDS = new Set(
  `loài người|bằng chứng|thiết bị|chứng kiến|thủy thủ|giàn khoan|hải lưu|xuất hiện|nghiên cứu|lĩnh vực|khoa học|đại dương|bất ngờ|vượt trội|kỹ thuật|hành khách|áp suất|duy trì|bảo trì|sửa chữa|vận hành|hoạt động|khả năng|nhiệt độ|kết cấu|công trình|sa mạc|văn minh|nguyên vẹn|quyết định|nước ngoài|đi nhậu|chi tiết|giải thích|rõ ràng|tham gia|lý do|bài toán|người ta|tối nay|hết tiền|dậy sớm|chính đáng|thông thường|
tiết kiệm|giảm giá|sử dụng|mua sắm|săn sale|món hời|hiệp định|hòa bình|thương lượng|từ chối|năn nỉ|cuộc họp|đám giỗ|bà con|chứng minh|lời mời|
đơn giản|nhất thiết|cảm ơn|bữa khác|tin nhắn|trả lời|lát nữa|đầu óc|lởn vởn|bứt rứt|giải quyết|sắp xếp|điện thoại|lời nhắc|cụ thể|bỏ qua|
hoàn thành|lập tức|chủ đầu tư|căn hộ|dự án|mở bán|thiết yếu|phụ kiện|sản phẩm|cảm giác|chi phí|số lần|bao nhiêu|hôm nay|ngày mai|bản thân|
nhớ đi nhớ lại|lời từ chối|trường hợp|người khác|mấy giờ|9 giờ|8 giờ|một chút|chút xíu|vấn đề|thực sự|tất nhiên|không phải|đi được|
thử nghiệm|tài khoản|chuyển khoản|chuyển lộn|ngân hàng|lừa đảo|ngược đời|đòi nợ|con nợ|tiền lãi|ứng dụng|kiểm tra|giữ nguyên|chính thức|
hướng dẫn|liên hệ|hỗ trợ|đường link|quan trọng|tội nghiệp|lòng tốt|giả bộ|gọi hối|lần thứ hai|mã otp|ăn lẩu|ăn nướng|sao cho|đúng người|số tiền|thiết yếu|
lời hứa|làm được|đầu năm|cuối tuần|thăm nhà|bạn cũ|ba má|lì xì|lớn lao|thất bại|trưng bày|chạy bộ|du lịch|lành mạnh|để dành|giật mình|thành công|
chương trình|khám phá|hệ thống|cả buổi|tầng hầm|vé coi phim|coi phim|tìm xe|mã cột|số tầng|số cột|đậu xe|bãi xe|vị trí|định vị|thao tác|trung tâm thương mại|màu đen|mang máng|lòng vòng|kho báu|truy tìm|đang ở|tiếng anh|tiếng việt|gia dụng|xúc động|hộp quà|đơn hàng|sinh tố|hút bụi|lau nhà|nghỉ ngơi|để ý|mắc tiền|
lời hứa|làm được|trả góp|thành công|lì xì|du lịch|lành mạnh|chạy bộ|trưng bày|cuối tuần|ba má|bạn cũ|thất bại|lớn lao|cơm nhà|để dành|giật mình|nghỉ học|đồ mới|thăm nhà|trôi qua|
dòng họ|bà con dòng họ|một ngàn người|theo dõi|hợp gu|liên kết|sao chép|bình luận|người yêu|tập hợp|luật chơi|có mặt|tin dữ|chán phèo|y chang|kẹt xe|hoành tráng|thăng chức|trúng số|biến cố|bình yên|bình thường|đặc biệt|
thí nghiệm|mô phỏng|nhà khoa học|thang cuốn|cầu thang|chao đảo|thống nhất|chuyển động|vận động|tưởng tượng|phức tạp|ngủ nướng|bắt kịp|thời gian|cơ thể|quyết đoán|giám đốc|trợ lý|chiến thuật|kiểm tra|đáp án|cơm tấm|bún bò|cái người|xa xôi|hành tinh|thám hiểm|khổng lồ|lòng đất|lòng hang|viễn tưởng|chiều cao|phát triển|địa đàng|đầu hàng|kẹo cao su|nghiên cứu|gián đoạn|âm thanh|mật khẩu|thừa kế|tài sản|cà phê|vị trí|dữ liệu|tính năng|lịch sử|riêng tư|cá nhân|chính xác|bản đồ|địa điểm|đại diện|
liệt sĩ|chôn cất|tưởng chừng|bức ảnh|tấm ảnh|tấm hình|tháp nước|nhân chứng|hài cốt|an táng|truy điệu|tập thể|manh mối|kiến trúc sư|tư liệu|nghiên cứu|giám định|tìm kiếm|khuôn viên|công viên|nghĩa địa|nghĩa trang|danh tính|thân nhân|lịch sử|địa hình|không ảnh|thập kỷ|tháp nước|cơ quan|chức năng|khoanh vùng|khai quật|hy sinh|quê hương|gia đình|con người|sự thật|đặt câu hỏi|xác định||mở ra|khảo sát|tìm hiểu|gần như|lần theo|lần ngược|quy tập|trở thành|thực địa|giả thuyết|xóa nhòa|tri ân|an nghỉ|trang trọng|danh tính|quê quán|tên tuổi|hiện thực|thay đổi|chụp lại|đối chiếu`
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "");
const isCap = (w) => /^\p{Lu}/u.test(w.replace(/^["“'(]/, ""));

// Có được ngắt giữa words[i-1] và words[i] không? Trả về điểm phạt (Infinity = cấm)
function breakCost(words, i) {
  const prev = words[i - 1], next = words[i];
  for (const c of COMPOUNDS) {
    const parts = c.split(" ");
    for (let k = 1; k < parts.length; k++) {
      const a = words.slice(i - k, i).map(bare).join(" ");
      const b = words.slice(i, i + parts.length - k).map(bare).join(" ");
      if (a === parts.slice(0, k).join(" ") && b === parts.slice(k).join(" ")) return Infinity;
    }
  }
  if (isCap(prev) && isCap(next) && i > 1) return Infinity; // tên riêng
  if (NUMBER.has(bare(prev)) || (/^\d/.test(prev) && !/^\d{4}$/.test(prev) && !/[,.!?]$/.test(prev))) return Infinity; // số đếm + danh từ (năm 4 chữ số như "2027" thì không tính)
  if (/[,.!?:;…]["”']?$/.test(prev)) return 0; // sau dấu câu: đẹp nhất
  if (PRONOUN.has(bare(prev))) return 30; // đại từ treo cuối dòng: xấu
  if (PRONOUN.has(bare(next))) return 3; // ngắt trước chủ ngữ: tốt
  if (LINK.has(bare(prev))) return 40; // ngay sau từ nối: xấu
  if (LINK.has(bare(next))) return 4; // ngay trước từ nối: tốt
  return 12;
}

// Chia thành tối đa `maxLines` dòng, mỗi dòng ≤ maxChars nếu có thể
export function breakLines(text, maxChars = 26, maxLines = 2) {
  const words = text.trim().split(/\s+/);
  if (text.length <= maxChars || words.length < 4) return [text.trim()];
  let best = null;
  for (let i = 2; i <= words.length - 2; i++) {
    const cost0 = breakCost(words, i);
    if (cost0 === Infinity) continue;
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const over = Math.max(0, a.length - maxChars) + Math.max(0, b.length - maxChars);
    const cost = cost0 + Math.abs(a.length - b.length) * 0.6 + over * 8;
    if (!best || cost < best.cost) best = { cost, lines: [a, b] };
  }
  return best ? best.lines.slice(0, maxLines) : [text.trim()];
}

// Có được tách cụm (phụ đề) giữa words[i-1] và words[i] không — dùng khi chia câu thành nhiều phụ đề
export function canBreak(words, i) {
  // "tiếng Anh" là tên ngôn ngữ, không phải đại từ "anh"
  return i > 0 && i < words.length && breakCost(words, i) !== Infinity && !(PRONOUN_END(words[i - 1]) && bare(words[i - 2] ?? "") !== "tiếng");
}
const PRONOUN_END = (w) => PRONOUN.has(bare(w)) && !/[,.!?:;…]$/.test(w);
