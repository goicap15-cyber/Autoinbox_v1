# Spec: Giảm tải render danh sách hội thoại và khung chat

## Mục tiêu

Giảm độ trễ khi cuộn danh sách, mở hội thoại và nhận cập nhật mới trong CRM khi dữ liệu lớn.

## Yêu cầu

- Danh sách hội thoại chỉ dựng một lô nhỏ ban đầu và dựng thêm khi người dùng cuộn gần cuối; tìm kiếm, bộ lọc và thứ tự hiện tại vẫn áp dụng trên toàn bộ tập hội thoại đã tải.
- Khung chat chỉ dựng một phần tin nhắn gần nhất ban đầu; người dùng có thể chủ động mở thêm tin cũ mà không làm mất dữ liệu lịch sử hay làm đổi cơ chế đồng bộ Facebook.
- Socket tiếp tục là kênh cập nhật nhanh. REST chỉ đối soát thưa hơn và không cập nhật React state nếu snapshot không đổi.
- Cập nhật tin nhắn không được khiến sidebar lọc, sắp xếp và dựng lại toàn bộ các hàng hội thoại.

## Phạm vi ngoài

- Không đổi schema SQLite, giao thức extension, cách phân quyền hoặc payload API hiện tại.
- Chưa chuyển truy vấn danh sách/tin nhắn sang phân trang server-side; cần xử lý riêng để giữ đúng tìm kiếm toàn tập, bộ lọc và thứ tự ghim/chưa đọc.

## Tiêu chí chấp nhận

- Lần render đầu dựng tối đa 80 hàng hội thoại và 120 tin nhắn.
- Cuộn cuối sidebar dựng tiếp tối đa 80 hàng; thao tác tải tin cũ thêm tối đa 100 tin.
- REST reconciliation không chạy thường xuyên hơn mỗi 15 giây, không chồng request, và không gây state update khi snapshot không đổi.
- Tải lịch sử, nhảy tới ngày và cập nhật realtime vẫn giữ nguyên chức năng hiện có.
