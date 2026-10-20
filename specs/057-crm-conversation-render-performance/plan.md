# Implementation Plan: CRM conversation rendering performance

## Kiến trúc

- Giữ nguyên dữ liệu đầy đủ và hợp đồng API hiện tại để không làm thay đổi tìm kiếm, bộ lọc, đồng bộ Page/Messenger hay phân quyền.
- Dùng lô render phía client cho sidebar và lịch sử tin nhắn. Chỉ mở rộng danh sách đã render theo hành động cuộn/xem thêm.
- Memo hóa kết quả lọc, danh sách con và từng hàng hội thoại; dùng callback ổn định để cập nhật tin nhắn không làm sidebar dựng lại.
- Giữ socket làm đường cập nhật chính. REST reconciliation chạy mỗi 15 giây, hủy request khi đổi hội thoại và bỏ qua state update nếu snapshot không đổi.

## Rủi ro được kiểm soát

- Không thay API pagination trong lượt này vì tìm kiếm/bộ lọc hiện đang dựa vào toàn bộ danh sách và thứ tự có ưu tiên ghim/chưa đọc.
- Không thay endpoint đọc tin nhắn hoặc logic sửa dữ liệu lịch sử vì chúng gắn với pipeline đồng bộ và chuẩn hóa thứ tự tin nhắn.
- Việc chia tin nhắn chỉ giới hạn số bubble gắn vào DOM; dữ liệu đầy đủ vẫn được giữ để đối soát và nhảy tới ngày.

## Xác nhận

- Kiểm tra diff và build giao diện sau khi triển khai.
- Không sửa nội dung feature 054 đang có trong workspace.
