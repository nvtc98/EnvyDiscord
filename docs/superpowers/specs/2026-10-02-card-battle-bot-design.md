# Card Battle Bot — Design

## Mục tiêu
Bot Discord chơi thẻ bài, dùng slash command + nút bấm, chạy được trong DM (User Install) và server.
Chơi **PvE với AI**, **sưu tầm thẻ rồi đấu**. Quy mô nhỏ: <20 người chơi, <5 người cùng lúc, chạy nội bộ trên Synology NAS.

## Quyết định chính
| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Kết nối Discord | `discord.js` qua Gateway | Chỉ kết nối ra ngoài, NAS không cần mở port |
| Ngôn ngữ | TypeScript chạy bằng `tsx`, test bằng Vitest | Logic trận đấu cần test kỹ |
| Lưu dữ liệu | 1 file JSON, ghi atomic (file tạm + rename), sau interface `PlayerRepo` | Quy mô nhỏ, dễ backup, không phụ thuộc thư viện native; đổi sang SQLite sau chỉ cần thay repo |
| Trạng thái trận đấu | Trong RAM theo `userId`, không lưu đĩa | Mỗi lần bấm nút Discord cấp interaction mới nên không dính giới hạn 15 phút; restart bot chỉ mất trận đang đánh dở |
| Triển khai | Chạy thẳng bằng Node (>= 20.6) trên Synology, khởi động bằng Task Scheduler; `data/` nằm cạnh project | Người dùng không dùng Docker; code không phụ thuộc Node 22 nên nâng cấp sau không cần sửa |

## Cấu trúc
```
src/engine/    Logic trận đấu thuần (không import discord.js): lượt, damage, skill, AI
src/game/      Luật tiến trình: gacha, thẻ trùng lên cấp, /daily, đội hình, đối thủ AI, thưởng
src/data/      Định nghĩa thẻ
src/db/        PlayerRepo + bản JSON
src/discord/   Slash command, nút bấm, vẽ embed
```

## Luật chơi
**Thẻ:** hệ (Lửa/Nước/Cỏ), độ hiếm (Thường/Hiếm/Sử thi/Huyền thoại), HP/ATK/DEF/SPD, 3 skill
(đánh thường không hồi chiêu, đòn mạnh có hồi chiêu, hỗ trợ hồi máu hoặc khiên).
**Khắc hệ:** Lửa > Cỏ > Nước > Lửa. Khắc ×1.5, bị khắc ×0.5.
**Damage:** `ATK × power × 100 / (100 + DEF) × hệ`, tối thiểu 1. Khiên hấp thụ trước khi mất HP.
**Trận 3v3:** mỗi lượt chọn skill của thẻ đang đánh hoặc đổi thẻ. Đổi thẻ xảy ra trước, sau đó skill theo SPD
(hòa thì người chơi trước). Thẻ gục thì thẻ kế tiếp tự ra sân. Hết thẻ là thua. Hồi chiêu N nghĩa là không dùng được trong N lượt kế tiếp.
**Cấp thẻ:** nhận trùng thì +1 cấp (tối đa 5, mỗi cấp +10% chỉ số). Đã tối đa thì đổi thành 50 coin.
**AI:** Dễ = skill ngẫu nhiên. Thường = chọn đòn có giá trị cao nhất theo heuristic (hạ gục > sát thương > hồi khi máu thấp > đổi thẻ khi bị khắc). Khó = nhìn trước 1 lượt (minimax).

## Lệnh
Ngôn ngữ của bot (lệnh, tuỳ chọn, tin nhắn, tên thẻ/skill) là **tiếng Anh**; tài liệu viết tiếng Việt.
`/daily` (3 thẻ khác nhau + 30 coin mỗi ngày theo múi giờ cấu hình), `/collection`, `/card <tên>`, `/team`, `/battle [difficulty]`, `/profile`.
Mọi command đăng ký với `integration_types: [0,1]` và `contexts: [0,1,2]` để dùng được trong DM.

## Hình ảnh
Thẻ và trận đấu được vẽ bằng `@napi-rs/canvas` thành PNG, gắn vào tin nhắn dạng tệp đính kèm (hiển thị lớn hơn ảnh trong embed).
- `src/render/`: `theme` (màu, biểu tượng hệ vẽ bằng path, không dùng emoji), `art` (nạp `assets/cards/<id>.(png|webp|jpg)`, theo dõi mtime, thu nhỏ khi nạp), `draw` (vẽ thẻ), `renderer` (API: `cards()` cho một hàng thẻ, `battle()` cho cả cảnh 3v3).
- Thẻ chưa có tranh dùng hình tạm: gradient theo hệ + họa tiết ngẫu nhiên cố định theo id.
- Font Inter đóng gói trong `assets/fonts/` vì máy chạy bot (NAS) thường không có font.
- **Dự phòng:** renderer được nạp động trong `index.ts`; nếu nạp lỗi thì `ctx.images = null` và mọi lệnh dùng embed chữ. Lỗi vẽ lúc chạy cũng được bắt trong `tryRender` và quay về chữ.
- Tên file ảnh có số lượt/trang để Discord không hiển thị ảnh cũ từ cache.

## Ngoài phạm vi (lần này)
PvP, cửa hàng/giao dịch, dùng coin, lưu trận đang đánh dở qua restart.

## Kiểm thử
Vitest cho engine, gacha/tiến trình, AI, repo JSON (kể cả file hỏng không bị ghi đè), và kiểm tra command có đủ `integration_types`/`contexts`.
Script `npm run simulate` cho AI đấu AI để soi cân bằng. Script `npm run preview` xuất ảnh mẫu ra `preview/` để xem giao diện mà không cần Discord.
