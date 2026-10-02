# Card Battle Bot

Bot Discord chơi thẻ bài PvE: sưu tầm thẻ bằng `/daily`, xây đội 3 thẻ, đấu với AI theo lượt (kiểu Pokémon).
Thiết kế chi tiết: [docs/superpowers/specs/2026-10-02-card-battle-bot-design.md](docs/superpowers/specs/2026-10-02-card-battle-bot-design.md).

## Ghi chú quan trọng (đọc trước)

### Link cấu hình bot
- Danh sách app: <https://discord.com/developers/applications>
- App hiện tại (tên **EE**, Application ID `823859055796944907`):
  - Tổng quan (tên, mô tả, Application ID): <https://discord.com/developers/applications/823859055796944907/information>
  - Bot (Reset Token, avatar, Public Bot): <https://discord.com/developers/applications/823859055796944907/bot>
  - Installation (User Install / Guild Install, Install Link): <https://discord.com/developers/applications/823859055796944907/installation>

### Lệnh hay dùng

| Việc | Lệnh |
|---|---|
| Chạy bot (tự reload khi sửa code) | `npm run dev` |
| Chạy bot (không reload, dùng trên NAS) | `npm start` |
| Đăng ký lệnh `/` với Discord | `npm run deploy` |
| Test / kiểm tra kiểu | `npm test` · `npm run typecheck` |
| Xem thử ảnh thẻ/trận đấu không cần Discord | `npm run preview` (xuất ra thư mục `preview/`) |
| AI đấu AI để soi cân bằng | `npm run simulate` |

Dừng bot: `Ctrl+C` trong terminal đang chạy. Sửa `.env` thì phải dừng và chạy lại bot (`tsx watch` không theo dõi `.env`).

### Khi nào phải chạy `npm run deploy`?
- **Lần đầu**, và mỗi khi **thêm, xoá, đổi tên lệnh hoặc đổi tuỳ chọn của lệnh**.
- **Không cần** khi chỉ sửa luật game, thẻ bài, hay nội dung trả lời của lệnh.
- Bot phải đang chạy (`npm run dev`) thì lệnh mới trả lời được. `deploy` chỉ gửi danh sách lệnh cho Discord, còn `dev` mới là nơi xử lý lệnh.

### Hai chế độ đăng ký lệnh (biến `DEV_GUILD_ID` trong `.env`)

| | Có `DEV_GUILD_ID=<id server>` | Không có (để trống hoặc comment `#`) |
|---|---|---|
| Phạm vi | Chỉ 1 server thử | **Global**: mọi server và **DM** |
| Hiện lệnh | Ngay lập tức | Có thể mất vài phút |
| Dùng được trong DM | **Không** | **Có** (cần bật User Install) |
| Ghi đè lệnh khác của app | Chỉ lệnh của server đó | Toàn bộ lệnh global của app |

Muốn dùng trong DM thì **phải** dùng chế độ global. Lệnh theo server và lệnh global là hai danh sách riêng, nên nếu đăng ký cả hai thì trong server sẽ thấy lệnh bị trùng.

### Lưu ý
- **Token là bí mật.** Chỉ để trong `.env` (đã nằm trong `.gitignore`), không dán vào chat hay commit. Lộ token thì vào trang **Bot** ở trên bấm **Reset Token** rồi chép token mới vào `.env`.
- **Mỗi token chỉ chạy một process.** Hai bản bot dùng chung token thì mỗi lệnh bị xử lý hai lần.
- Gõ `/` không thấy lệnh: thoát hẳn Discord và mở lại (hoặc Cmd+R). Trong DM chỉ thấy lệnh khi đã bật **User Install** và đã **Add to my apps** bằng Install Link.
- Bot không đọc được tin nhắn trong DM giữa hai người (giới hạn của Discord với app User Install), nên không thể làm tính năng đếm tin nhắn DM. Bot chỉ nhận dữ liệu khi có người gọi lệnh.
- Lệnh trả lời **công khai** thì cả hai người trong DM đều thấy (hiện tên và avatar của bot kèm dòng "bạn đã dùng /lệnh"). Lệnh trả lời kiểu **chỉ mình bạn thấy** (ephemeral) thì người kia không thấy gì.

## Lệnh của bot

Toàn bộ giao diện của bot (tên lệnh, tuỳ chọn, tin nhắn, tên thẻ và skill) dùng **tiếng Anh**. Tài liệu và README này vẫn viết tiếng Việt.

| Lệnh | Việc làm | Người kia thấy? |
|---|---|---|
| `/daily` | Mỗi ngày nhận 3 thẻ khác nhau + 30 coin (thẻ trùng thì lên cấp, tối đa Lv 5) | Có |
| `/collection` | Xem bộ sưu tập | Không |
| `/card <name>` | Xem chi tiết thẻ | Có |
| `/team` | Chọn 3 thẻ vào đội (không chọn thì bot tự lấy 3 thẻ mạnh nhất) | Không |
| `/battle [difficulty]` | Đấu 3v3 với AI: dễ / thường / khó | Không |
| `/profile` | Coin, thắng/thua | Không |
| `/say <content>` | Bot nói đúng câu bạn nhập (không ping được @everyone/@mention) | Có |
| `/merciful` | Bot trả lời: "Merciful be, all my eyes." | Có |

Hệ khắc nhau: 🔥 Lửa > 🌿 Cỏ > 💧 Nước > 🔥 Lửa (khắc ×1.5, bị khắc ×0.5).

## Hình ảnh thẻ bài

Thẻ và trận đấu được vẽ thành **ảnh PNG** (khung theo độ hiếm, biểu tượng hệ, thanh HP, khiên, K.O.):

| Lệnh | Ảnh |
|---|---|
| `/card` | Một thẻ đầy đủ chỉ số và 3 skill |
| `/daily` | 3 thẻ vừa nhận, kèm nhãn NEW / LV n / MAX |
| `/collection` | 3 thẻ mỗi trang |
| `/battle` | Cả hai đội trong một ảnh, vẽ lại mỗi lượt (thẻ đang đánh to, thẻ dự bị nhỏ) |

**Thả tranh thật:** bỏ file `assets/cards/<id thẻ>.png` (đuôi png/webp/jpg đều được). Thẻ nào chưa có tranh thì bot tự vẽ hình tạm theo hệ. Bot tự nhận file mới hoặc file thay thế, không cần restart. Quy cách tranh và danh sách tên file nằm trong [assets/cards/README.md](assets/cards/README.md).

**Tự quay về chữ nếu cần:** nếu thư viện vẽ ảnh không chạy được (ví dụ trên NAS) hoặc một lần vẽ bị lỗi, bot tự dùng embed chữ như trước và game vẫn chơi bình thường. Khi khởi động, terminal in `Image rendering enabled` nếu ảnh bật được, hoặc `Image rendering unavailable, falling back to text embeds: ...` kèm lý do.

Font **Inter** (giấy phép OFL) được đóng gói sẵn trong `assets/fonts/`, nên không phụ thuộc font của máy chạy bot. Khi đưa lên NAS, nhớ copy cả thư mục `assets/`.

## Cài đặt Discord (một lần)

1. Vào <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → Reset Token, chép token vào `.env` (`DISCORD_TOKEN`). Không cần bật Privileged Intent nào.
3. **General Information** → chép *Application ID* vào `.env` (`DISCORD_CLIENT_ID`). Application ID cũng chính là phần đầu của token (mã hoá base64).
4. **Installation** → tick cả **User Install** và **Guild Install**. Lấy *Install Link* để mời bot.
   - **User Install** là phần làm lệnh `/` hiện được trong mọi DM.
   - Guild Install cần scope `applications.commands` (thêm `bot` nếu muốn bot ở trong server).
5. Mở Install Link, chọn **Add to my apps** (cài cho tài khoản của bạn). Bạn bè cũng làm như vậy để dùng trong DM với nhau.

## Chạy thử trên máy

```bash
cp .env.example .env     # điền DISCORD_TOKEN và DISCORD_CLIENT_ID
npm install
npm run deploy           # đăng ký lệnh với Discord (xem mục "Hai chế độ đăng ký lệnh")
npm run dev              # chạy bot, tự reload khi sửa code
```

Phải thấy dòng `Online as ...` trong terminal. Dữ liệu người chơi nằm ở `data/players.json`.

## Chạy trên Synology NAS (chạy thẳng, không Docker)

Cần Node.js từ Package Center, **Node 20.6 trở lên** là đủ (Node 22 cũng được). Bot chỉ kết nối *ra* Discord nên không cần mở port.

1. Copy project (trừ `node_modules` và `data`, nhớ kèm thư mục `assets/`) lên NAS, ví dụ `/volume1/cardbot`, rồi tạo `.env` ở đó.
2. SSH vào NAS và cài thư viện chạy bot (bỏ qua công cụ test, vì `vitest` đòi Node 22):
   ```bash
   cd /volume1/cardbot && npm ci --omit=dev
   ```
3. Chạy thử: `npm start`. Phải thấy `Image rendering enabled` (nếu thấy `unavailable` thì bot vẫn chạy ở chế độ chữ) rồi `Online as ...`.
4. Tự chạy khi NAS khởi động: Control Panel → Task Scheduler → Create → Triggered Task → User-defined script,
   sự kiện **Boot-up**, và dán:
   ```bash
   cd /volume1/cardbot && npm start >> bot.log 2>&1
   ```
   Nếu task báo không thấy `npm`, chạy `which node` qua SSH rồi dùng đường dẫn đầy đủ.
5. Đăng ký lệnh một lần từ máy dev bằng `npm run deploy` (không cần làm trên NAS). Nhớ tắt bản bot chạy trên máy dev trước khi bật bản trên NAS.

Backup: sao lưu file `data/players.json` (Hyper Backup hoặc copy tay).
Cập nhật bot: copy đè thư mục `src` (và `package*.json`, rồi `npm ci --omit=dev` nếu thư viện đổi), giữ nguyên thư mục `data`, rồi khởi động lại task.
Nâng lên Node 22 sau này không cần sửa gì trong code.

## Phát triển

```bash
npm test            # Vitest: engine, gacha, AI, JSON repo, giới hạn payload Discord
npm run typecheck
npm run simulate    # AI đấu AI để soi cân bằng
```

Thêm thẻ mới: sửa `src/data/cards.ts` (mỗi thẻ cần đúng 3 skill, skill đầu là đòn đánh thường không hồi chiêu).
Thêm lệnh mới: tạo file trong `src/discord/commands/`, thêm vào `src/discord/commands/index.ts`, rồi chạy `npm run deploy`.
