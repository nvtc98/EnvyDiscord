# Tutorial design — hướng dẫn người chơi trận đầu

Tài liệu này KHÔNG phải kịch bản. Nó là bản đồ các khái niệm + các mốc (beat) mà một trận
tutorial nên dạy, để bạn (hoặc session story) dựa vào mà viết lời bot. Lời thoại cụ thể do bạn
viết; ở đây chỉ nêu "dạy cái gì, lúc nào, vì sao".

Giọng: lời bot trong story dùng giọng cổ (archaic) đầy đủ; nhưng khi giải thích LUẬT/UI thì giữ
cho dễ hiểu — một câu rõ nghĩa quan trọng hơn một câu kêu. (Theo steering voice-and-tone: narration
= full voice, nhưng chỉ dẫn thao tác thì nhẹ tay.)

---

## 1. Người chơi cần hiểu gì sau tutorial

Xếp theo thứ tự nên dạy — từ "mục tiêu" tới "chi tiết".

### 1.1 Mục tiêu trận đấu (dạy ĐẦU TIÊN)

Nói theo cảm nhận người chơi, KHÔNG nói con số kỹ thuật và KHÔNG so với luật cũ. Người chơi chỉ cần hiểu:

- Giữa hai người có **một cán cân** (thanh dọc bên trái). Nó **nghiêng qua lại** theo thế trận.
- Nghiêng **về phía mình = mình đang thắng thế**; nghiêng về phía đối thủ = đang thua thế. Khởi đầu
  cân bằng, chưa ai hơn ai.
- **Thắng** khi cán cân **nghiêng hẳn về phía mình**, hoặc khi trận kết thúc mà cán cân đang
  nghiêng về mình.
- Cán cân dịch theo **sức mạnh quân mình đang áp đảo đối thủ trên sân** tới đâu. Quân mình mạnh hơn
  trên sân → cán cân nghiêng về mình.
- Trận không kéo dài mãi: tới một lúc nó khép lại, ai đang nghiêng cán cân về mình thì thắng.
  (Con số lượt là chuyện kỹ thuật — người chơi chỉ cần thấy "trận đang gần tàn", không cần biết "18".)

**Ẩn dụ + tên gọi gợi ý cho lời bot** (dùng tiếng Việt hay tiếng Anh đều hay, chọn cái hợp giọng cổ):

- Thủy triều / dòng chảy — _the tide, the current, the flow_
- Cán cân / đòn cân — _the balance, the scales, the beam_
- Kéo co / giằng co — _the tug, the pull_
- Thế nghiêng / độ nghiêng — _the tilt, the lean, the sway_
- Triều cường & triều rút — _the tide rises / the tide ebbs_
- Gió xoay chiều — _the wind turns, the wind favors thee_
- Vận / thế / mệnh — _fortune, the turning of fate, the omen shifts_
- Ánh mắt dõi về ai (hợp theme "The Eyes") — _the Eyes turn toward thee / away from thee_
  Gợi ý: chọn MỘT ẩn dụ chủ đạo và dùng nhất quán cả trận (ví dụ luôn gọi là "the tide"), thỉnh thoảng
  đổi cách nói cho đỡ lặp. Tránh trộn quá nhiều ẩn dụ khác nhau trong một trận.

### 1.2 Bàn đấu 3 lane × 3 ô

- Sân có **3 lane** (Trái / Giữa / Phải), mỗi lane sâu **3 ô**.
- Quân mình vào từ **phía mình (đáy)**, quân địch vào từ **phía địch (đỉnh)**.
- Mỗi lượt dịch cán cân tính TỔNG power quân trên sân — nên **rải quân nhiều lane** hay **dồn một
  lane mạnh** là lựa chọn chiến thuật.

### 1.3 Đánh một lá bài

- Chọn một lá trong tay (menu chọn), rồi bấm một **lane** để đặt.
- Mỗi lá có **cost** (góc trái) và **power** (góc phải).
- **Energy**: đầu mỗi lượt của mình, energy = số lượt mình đã đi (tối đa 9). Đánh lá tốn energy
  bằng cost. Hết energy thì không đánh được lá đắt (lá quá đắt hiện mờ / không bấm được lane).

### 1.4 Cơ chế ĐẨY (push) — điểm cốt lõi, dạy kỹ

- Đặt một lá vào ô vào (entry cell) của lane. Nếu ô đó đã có quân, quân cũ **bị đẩy một bước ra
  xa** phía mình. Đẩy có thể dây chuyền.
- Quân bị đẩy **rớt khỏi mép xa** của lane thì **bị hủy (destroy)**.
- Đây là cách phản đòn: địch đặt một lá mạnh ở lane, mình đặt một lá nhỏ **đẩy nó rớt ra = hủy nó**,
  xóa power của địch khỏi sân.
- Lane đầy mà đặt thêm → đẩy dây chuyền → quân ở mép xa rớt ra (hủy).

### 1.5 Lợi thế người đi sau (nên nhắc khéo, không bắt buộc)

- Trong một lượt, người đi sau thấy đối thủ vừa đặt gì rồi mới quyết → có lợi thế thông tin.
- Luật cán cân + tính mỗi lượt làm điều này công bằng hơn: mỗi người lần lượt được "ra đòn với
  thông tin mới nhất", và cán cân dịch sau MỖI lượt chứ không gộp.

### 1.6 Chiêu thức (ability) — dạy khi gặp lá có chiêu

- Lá có chiêu hiện dòng mô tả (đậm "Active:" hoặc "Passive:").
  - **Active**: kích một lần khi đánh ra.
  - **Passive**: hiệu lực khi còn trên sân / theo nhịp (đầu lượt, cuối lượt) / khi bị hủy.
- Không cần dạy hết mọi chiêu — chỉ dạy chiêu của lá mà tutorial đưa cho người chơi. Vài ví dụ
  đã có trong game để làm quân tutorial:
  - **Siren Eyes** (active): đẩy cả lane hiện tại thêm một bước — dạy ý "đẩy chủ động".
  - **Laser Eyes** (active): hủy mọi quân khác trong lane trừ bản thân — dạy ý "xóa sân".
  - **Bedrock Eyes** (active): lượt này địch không đẩy được nó — dạy ý "phòng thủ chống đẩy".
  - **Phoenix Eyes** (passive): bị hủy thì về tay với +4 power — dạy ý "hồi sinh".
  - **Venom Eyes** (passive): đầu mỗi lượt, mọi quân KHÁC -1 power — dạy ý "bào mòn sân".
  - **Ocean Eyes** (passive): cuối lượt +1 power cho đồng minh rồi về lại deck — dạy ý "luân hồi".
  - **Stella Eyes** (active): nhận power = tổng power mọi quân đã bị hủy trong trận — dạy ý
    "càng nhiều hủy diệt càng mạnh".

### 1.7 Kết thúc lượt + Reset

- Đánh xong các lá muốn đánh → bấm **End the turn**. Lúc đó cán cân dịch, rồi tới lượt đối thủ.

## 2. Các mốc (beat) để chèn lời bot — khớp với hook onBeat

> Tên phase cuối cùng, chữ ký `onBeat`, và hợp đồng `reanchor` đã chốt — xem `docs/onbeat-hook.md`
> (API reference phía battle). Bảng dưới là CATALOGUE "dạy gì ở mỗi mốc"; `docs/onbeat-hook.md` là
> nguồn chuẩn cho cơ chế/tên phase. Lưu ý: hook thực tế dùng dạng một-đối-tượng
> `onBeat(ev: BattleBeat)` (không phải `onBeat(session, phase, interaction)` như mô tả cũ bên dưới).

Battle sẽ expose `onBeat(session, phase, interaction)` gọi tại các mốc dưới.

---

## 2. Các mốc (beat) để chèn lời bot — khớp với hook onBeat

Battle sẽ expose `onBeat(session, phase, interaction)` gọi tại các mốc dưới. Tại mỗi mốc, bot nói
một câu (DM thường, có typing) rồi board được re-anchor xuống đáy. Danh sách mốc đề xuất (tên phase
cuối cùng chốt khi làm hook):

| Phase                      | Khi nào                                     | Dạy gì                                                           |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `battle-start`             | Ngay khi bàn đấu hiện ra, trước nước đi đầu | Mục tiêu + cán cân + "chọn lá rồi bấm lane"                      |
| `after-player-play`        | Sau khi người chơi đặt MỘT lá               | Phản hồi nước vừa đánh; lần đầu đặt → giải thích power/cost/lane |
| `near-push` / `after-push` | Khi một push xảy ra (quân bị đẩy/hủy)       | Giải thích đẩy & hủy ngay lúc nó vừa diễn ra                     |
| `after-player-end-turn`    | Sau khi người chơi End, trước khi địch đi   | "Giờ xem cán cân dịch, rồi tới lượt đối thủ"                     |
| `after-enemy-turn`         | Sau khi địch đánh xong (animation xong)     | Bình phẩm nước địch; gợi ý cách đối phó lượt tới                 |
| `tide-shifted` (tùy)       | Sau khi cán cân dịch rõ rệt                 | Chỉ cho người chơi nhìn cán cân nghiêng                          |
| `near-win` / `near-defeat` | Khi cán cân gần chạm một đầu                | Tăng kịch tính; nhắc "sắp xong"                                  |
| `before-finish`            | Trước màn hình kết thúc                     | Lời kết, dẫn sang scene story tiếp theo                          |

Lưu ý thiết kế hook (để bên battle làm, không phải phần kịch bản):

- `onBeat` là **tùy chọn** trên Session; trận thường (practice) không set, nên không ảnh hưởng.
- Callback **không trả nội dung cho battle**; nó tự gửi DM. Sau khi chèn lời, nó yêu cầu battle
  **re-anchor board** (gửi board mới xuống đáy DM, xóa board cũ) để board luôn ở đáy khung chat.
- Battle gọi `await session.onBeat?.(...)` tại mốc, TRƯỚC khi render board kế tiếp.
- Tutorial có thể dạy MỘT thứ mỗi mốc, và dùng cờ "đã dạy chưa" để không lặp lại ở các lượt sau
  (ví dụ chỉ giải thích "đẩy" ở lần push đầu tiên).

---

## 3. Dàn trận tutorial gợi ý (để kịch bản dễ dàn dựng)

Để dạy chắc, nên **gài sẵn thế trận** thay vì để ngẫu nhiên:

- Deck tutorial của người chơi: vài lá cơ bản (không chiêu) + 1–2 lá có chiêu đơn giản để dạy.
- Đối thủ tutorial đi những nước **đoán trước được** (hoặc kịch bản cố định) để lời bot khớp
  diễn biến. Ví dụ: lượt 1 địch đặt một lá mạnh ở lane Giữa → bot gợi ý "hãy đẩy nó ra".
- Một thế để dạy đẩy: địch có 1 lá ở ô vào lane Giữa; đưa người chơi 1 lá nhỏ → đặt vào Giữa để
  đẩy, cho họ thấy quân địch rớt/hủy và cán cân nghiêng về mình.
- Một thế để dạy chiêu: đưa Laser hoặc Siren, dựng một lane đầy quân địch, cho người chơi "xóa sân".

---

## 4. Những điều KHÔNG nên làm trong tutorial

- Đừng dạy hết mọi chiêu một lúc — chỉ dạy chiêu của lá đang cầm.
- Đừng để trận tutorial quá dài (18 lượt là tối đa luật; tutorial nên kết thúc sớm hơn, ví dụ sau
  khi người chơi đã đẩy-hủy thành công một lần và thấy cán cân nghiêng — có thể cho knockout sớm
  hoặc kết thúc theo kịch bản).
- Đừng chặn người chơi quá nhiều — cho họ tự thử, sai thì có Reset.
- Lời giải thích LUẬT/UI giữ plain; chỉ phần narration/kịch tính mới lên giọng cổ.

---

## 5. Trạng thái cần theo dõi (để không lặp lời)

Gợi ý các cờ story lưu trên người chơi (bên story quản, battle không cần biet):

- `taughtGoal`, `taughtPlay`, `taughtPush`, `taughtAbility`, `taughtEndTurn`, `taughtReset`
- Mỗi cờ bật khi đã dạy xong mốc tương ứng, để các lượt sau bot không giảng lại.

---

## 6. Trạng thái triển khai (đã làm, story side)

Tutorial đã được dựng ở lớp story (consume hook `onBeat`, KHÔNG đụng battle/engine):

- **Nội dung + chọn bài học**: `src/story/tutorial.ts` — `tutorialLineFor(ev, player)` trả `string[] | null`
  (null = im lặng), và `TUTORIAL_INTRO_LINE` (câu trấn an gửi trước khi board hiện).
- **Cờ "đã dạy" per-player**: `StoryState.tutorial` trong `src/story/types.ts`
  (`{ goal, play, push, endTurn, tideSeen }`), back-fill `{}` trong `ensureStory`/`freshStory` ở
  `src/story/engine.ts`. Mỗi cờ bật ngay khi `tutorialLineFor` trả lời cho mốc đó.
- **Wiring**: `src/discord/story-battle.ts` — `buildBattleDm` + `makeTutorialOnBeat` gắn vào session ở
  cả 3 nhánh (fresh / resume / live-reuse). Nhánh fresh gửi `TUTORIAL_INTRO_LINE` trước board, rồi
  `runBattleStartBeat` một lần trước opening animation.
- **Gate**: chỉ gắn khi `!player.story.caveWon` (trận hang đầu tiên). "Fight again" (caveWon=true) và
  `/battle` không gắn. Cờ teach-once chống giảng lại khi resume giữa trận.
- **Metaphor cán cân** dùng trong tutorial: **The Tide** (theo lựa chọn của người chơi).
- Tests: `tests/story-tutorial.test.ts` (nội dung) + phần "in-battle tutorial wiring" trong
  `tests/story-battle-flow.test.ts` (gắn hook, teach-once, fast path, gate replay/resume).
