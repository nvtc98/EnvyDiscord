# Card art

Thả tranh của từng thẻ vào thư mục này, tên file là **id thẻ** + đuôi `.png`, `.webp`, `.jpg` hoặc `.jpeg`.
Thẻ nào chưa có file thì bot tự vẽ hình tạm theo hệ, nên có thể thêm dần từng tấm. Bot tự nhận file mới hoặc file bị thay (không cần restart).

## Quy cách tranh
- Tỉ lệ **4:3 ngang**, đề xuất **1024×768** (lớn hơn cũng được, bot tự thu nhỏ để tiết kiệm RAM).
- Đặt nhân vật ở **chính giữa** và chừa lề khoảng 10% mỗi bên: tranh được cắt vừa khung (cover) nên mép có thể bị cắt, nhất là trong cảnh đấu, nơi khung gần vuông hơn.
- Dưới ~2 MB mỗi file. Không cần vẽ khung, tên hay chỉ số; bot tự vẽ phần đó.
- Đừng dùng tranh có bản quyền của người khác (ví dụ Pokémon).

Xem thử kết quả mà không cần Discord: `npm run preview` (ảnh xuất ra thư mục `preview/`).

## Danh sách thẻ

| File | Tên thẻ | Hệ | Độ hiếm |
|---|---|---|---|
| `tho-lua.png` | Ember Hare | fire | common |
| `cao-than.png` | Cinder Fox | fire | common |
| `su-tu-dung-nham.png` | Magma Lion | fire | rare |
| `hoa-long.png` | Fire Drake | fire | epic |
| `phuong-hoang.png` | Phoenix | fire | legendary |
| `rua-bien.png` | Sea Turtle | water | common |
| `ca-chep.png` | Koi Carp | water | common |
| `ca-map.png` | Blue Shark | water | rare |
| `thuy-quai.png` | Kraken | water | epic |
| `long-vuong.png` | Dragon King | water | legendary |
| `nam-con.png` | Little Shroom | grass | common |
| `soi-rung.png` | Forest Wolf | grass | common |
| `ho-rung.png` | Forest Tiger | grass | rare |
| `co-thu.png` | Elder Tree | grass | epic |
| `than-rung.png` | Forest Spirit | grass | legendary |
