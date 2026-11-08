# Tasks: CRM conversation rendering performance

- [x] T001 Memo hóa lọc/sắp xếp sidebar và chỉ render 80 hội thoại ban đầu, mở rộng theo cuộn.
- [x] T002 Ổn định callback và memo hóa list/item để cập nhật khung chat không dựng lại các hàng không đổi.
- [x] T003 Chỉ dựng 120 tin nhắn gần nhất; thêm nút tải thêm 100 tin cũ và giữ hỗ trợ nhảy tới ngày.
- [x] T004 Giảm REST reconciliation xuống 15 giây, chặn request chồng nhau, hủy request khi đổi hội thoại và bỏ qua snapshot không đổi.
- [x] T005 Build giao diện thành công và rà lại các phần triển khai.
- [x] T006 Cập nhật Graphify sau khi hoàn tất thay đổi mã.
- [x] T007 Khắc phục lỗi mất kết nối giả khi MV3 Service Worker khởi động lại (`chrome.runtime.onMessage` response channel, `disconnectGraceTimers`, non-destructive `sendDispatchProbe`).
- [x] T008 Ngăn tự động bật cửa sổ Chrome `login.php` rác từ các tài khoản `pending_*` chưa đăng nhập và yêu cầu đủ cặp cookie `c_user` + `xs`.
- [x] T009 Khắc phục lỗi gửi tin nhắn bị treo ở trạng thái "Đang gửi" (`executeScriptWithTimeout`, tách bất đồng bộ `SYNC_THREADS`/`SYNC_THREAD_MESSAGES`, sửa nhận diện `composerLabel` `"Tin nhắn"`).
