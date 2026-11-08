# DANH SÁCH PHÂN RÃ CÔNG VIỆC CHI TIẾT (TASK BREAKDOWN)
## DỰ ÁN: FB PERSONAL MESSENGER CRM (AUTOCHATBOT)

---

## 🚀 SPRINT 1: KHỞI TẠO CORE ENGINE, CSDL SQLITE & CHROME EXTENSION (TUẦN 1)

### Task 1.1: Khởi tạo CSDL SQLite, WAL Mode & Bảng ảo FTS5
- **Mục tiêu:** Tạo file CSDL `data/database.db` chuẩn hóa với hiệu năng cao.
- **Tệp mục tiêu:** `src/server/database/db.js`, `src/server/database/schema.sql`
- **Công việc cụ thể:**
  1. Khởi tạo `better-sqlite3` kết nối tới `data/database.db`.
  2. Bật chế độ `PRAGMA journal_mode = WAL;` và `PRAGMA synchronous = NORMAL;`.
  3. Chạy script tạo 8 bảng (`users`, `accounts`, `threads`, `messages`, `contacts`, `auto_replies`, `ai_configs`, `messages_fts`) và các Indices/Triggers.
- **Xác minh:** Chạy `node src/server/database/db.js`, kiểm tra file `.db` và `.db-wal` sinh ra sạch sẽ.

### Task 1.2: Xây dựng Chrome Extension (Manifest V3) & Engine Facebook GraphQL
- **Mục tiêu:** Cào `fb_dtsg` token, gửi/nhận tin nhắn qua GraphQL API và kết nối WebSocket với Backend.
- **Tệp mục tiêu:** `src/extension/manifest.json`, `src/extension/background.js`, `src/extension/content.js`
- **Công việc cụ thể:**
  1. Tạo `manifest.json` chuẩn Manifest V3 cho Chrome Extension.
  2. Viết `background.js` tự động bắt `fb_dtsg` token và ID người dùng Facebook từ Cookie/Document.
  3. Viết hàm gọi GraphQL API lấy danh sách 100 threads mới nhất và gửi tin nhắn trực tiếp qua GraphQL.
  4. Mở kết nối WebSocket nội bộ tới `ws://localhost:5050` để nhận/đẩy dữ liệu tin nhắn hai chiều.
- **Xác minh:** Load unpacked extension vào Chrome Portable, kiểm tra kết nối WebSocket log thành công.

### Task 1.3: Xây dựng Backend `ProcessManager` quản lý Chrome Portable ngầm
- **Mục tiêu:** Khởi chạy ngầm tiến trình Chrome Portable và bật sáng giao diện Window khi gặp Checkpoint.
- **Tệp mục tiêu:** `src/server/services/ProcessManager.js`
- **Công việc cụ thể:**
  1. Sử dụng `child_process.spawn()` gọi `bin/chrome-win/chrome.exe` với cờ profile `data/profiles/{account_id}`.
  2. Bổ sung các cờ tối ưu RAM: `--disable-gpu --disable-software-rasterizer --no-first-run`.
  3. Bổ sung hàm `unhideWindow(accountId)` sử dụng PowerShell script đưa cửa sổ Chrome Portable lên màn hình desktop khi nhận event `CHECKPOINT`.
- **Xác minh:** Chạy test mở Chrome ngầm, gửi event Checkpoint -> Cửa sổ Chrome thật xuất hiện cho user thao tác.

### Task 1.4: Quy trình Thêm Tài khoản Facebook Mới (Facebook Account Onboarding)
- **Mục tiêu:** Cho phép người dùng bấm "Thêm tài khoản Facebook" từ UI, tự động mở Chrome profile tạm, tự đọc session Facebook thật và gộp vào Inbox.
- **Tệp mục tiêu:** `src/client/components/AccountManagerModal.jsx`, `src/server/server.js`, `src/server/services/ProcessManager.js`, `src/extension/background.js`
- **Công việc cụ thể:**
  1. Thêm nút `+ Thêm tài khoản Facebook` trong `AccountManagerModal.jsx` với trạng thái `Đang chờ đăng nhập...`.
  2. Bổ sung endpoint REST API `POST /api/accounts/new-session` trong `server.js` sinh `pending_key` và gọi `ProcessManager.startNewAccountProcess(pending_key)` mở Chrome Portable mới.
  3. Bổ sung hàm `startNewAccountProcess(pendingKey)` trong `ProcessManager.js` dùng thư mục `data/profiles/{pendingKey}` trỏ đến Facebook Messenger.
  4. Cập nhật `background.js` của Chrome Extension: sau khi phát hiện session `c_user` hợp lệ ➔ gửi WebSocket event `REGISTER_ACCOUNT` chứa `{ account_id, name, pending_key }`.
  5. Thêm WebSocket case `REGISTER_ACCOUNT` trong `server.js`: Lưu/cập nhật DB `accounts`, gán thư mục profile chính thức, phát `ACCOUNT_STATUS_CHANGED` & `EXTENSION_CONNECTION_CHANGED` và tự động kích hoạt `SYNC_THREADS`.
- **Xác minh:** Bấm "Thêm tài khoản Facebook" -> Chrome mở ra -> Đăng nhập Facebook -> CRM UI lập tức hiển thị nick mới và gộp hội thoại vào Inbox chung thành công.

---

## 🚀 SPRINT 2: UNIFIED CHAT DASHBOARD & REAL-TIME SOCKET.IO (TUẦN 2)

### Task 2.1: Khởi tạo Giao diện React SPA 3-Panel
- **Mục tiêu:** Xây dựng khung giao diện Dashboard chat tập trung chuẩn UI/UX Pro Max.
- **Tệp mục tiêu:** `src/client/App.jsx`, `src/client/components/ThreadList.jsx`, `src/client/components/ChatArea.jsx`, `src/client/components/LeadPanel.jsx`
- **Công việc cụ thể:**
  1. Thiết lập dự án React (Vite) + TailwindCSS.
  2. Thiết kế Layout 3 cột: Cột trái (Danh sách Inbox + Tabs), Cột giữa (Khung chat + Khung nhập liệu), Cột phải (Thông tin Lead + Ghi chú).
  3. Áp dụng bảng màu Dark/Light Mode hiện đại, typography Inter và micro-animations mượt mà.
- **Xác minh:** Giao diện hiển thị chuẩn responsive, chuyển đổi qua lại giữa các hội thoại mượt mà.

### Task 2.2: Tích hợp Socket.io Realtime gửi/nhận Tin nhắn
- **Mục tiêu:** Kết nối Real-time giữa React UI <-> Node.js Backend <-> Chrome Extension.
- **Tệp mục tiêu:** `src/server/socket/ioHandler.js`, `src/client/hooks/useSocket.js`
- **Công việc cụ thể:**
  1. Thiết lập Socket.io Server tại Backend và Client Hook tại React UI.
  2. Khi Nhân viên gõ tin nhắn bấm Gửi -> Đẩy lệnh qua Socket.io về Backend -> Backend bắn lệnh WebSocket tới Chrome Extension -> Extension gọi GraphQL API gửi đi Facebook.
  3. Khi có tin nhắn mới từ Facebook -> Extension bắn WebSocket về Backend -> Backend phát Socket.io lên React UI cập nhật tức thì.
- **Xác minh:** Thời gian từ lúc bấm Gửi trên UI đến khi tin nhắn đến Facebook < 300ms.

### Task 2.3: Phát triển Trình xem Rich Media & Bộ Tải ngầm Local Media
- **Mục tiêu:** Hiển thị trực tiếp Ảnh, Video, Voice note, File và tải ngầm media tin nhắn mới.
- **Tệp mục tiêu:** `src/client/components/MediaViewer.jsx`, `src/server/services/MediaDownloader.js`
- **Công việc cụ thể:**
  1. Xây dựng UI MediaViewer: Lightbox xem ảnh đại diện lớn, Video custom player, Audio voice note player có thanh thời lượng, Nút tải file đính kèm.
  2. Viết `MediaDownloader.js` tại Backend: Chỉ các tin nhắn MỚI đổ về mới tự động download tệp về `data/media/{thread_id}/` và lưu `local_media_path`.
- **Xác minh:** Gửi thử ảnh và voice note từ FB cá nhân -> UI Dashboard hiển thị và phát được audio lập tức.

---

## 🚀 SPRINT 3: PHÂN QUYỀN NHÂN VIÊN, BÓC TÁCH LEAD & BỘ LỌC FTS5 (TUẦN 3)

### Task 3.1: Hệ thống Phân quyền & Độc quyền Nhân viên
- **Mục tiêu:** Gán đúng 1 nhân viên phụ trách 1 hội thoại và quản lý 4 Tabs phân luồng.
- **Tệp mục tiêu:** `src/server/services/AssignmentManager.js`, `src/client/components/TabFilter.jsx`
- **Công việc cụ thể:**
  1. Viết API gán nhân viên phụ trách (`UPDATE threads SET assigned_user_id = ? WHERE id = ?`).
  2. Phát triển 4 Tabs lọc: *Tất cả*, *Đơn của tôi*, *Chưa xử lý*, *Đã chốt*.
- **Xác minh:** Nhân viên A đăng nhập chỉ thấy và thao tác trên các thread thuộc phân công của mình hoặc chưa xử lý.

### Task 3.2: Tự động Bóc tách SĐT/Email bằng Regex
- **Mục tiêu:** Trích xuất tự động SĐT/Email từ nội dung chat và hiển thị tại Panel Lead.
- **Tệp mục tiêu:** `src/server/utils/leadExtractor.js`, `src/client/components/LeadPanel.jsx`
- **Công việc cụ thể:**
  1. Viết hàm Regex lọc biểu thức chính quy SĐT Việt Nam (10 số) và Email.
  2. Khi có tin nhắn mới chứa SĐT/Email, tự động cập nhật vào bảng `contacts`.
  3. Xây dựng nút "Xác nhận đã lấy liên hệ" (Lead Captured Toggle) trên UI.
- **Xác minh:** Khách nhắn "SĐT mình là 0912345678" -> Panel phải tự động điền số 0912345678.

### Task 3.3: Tìm kiếm siêu tốc FTS5 & Xuất dữ liệu Excel/CSV
- **Mục tiêu:** Truy vấn từ khóa trong hàng triệu tin nhắn < 30ms và xuất danh sách Lead.
- **Tệp mục tiêu:** `src/server/services/SearchService.js`, `src/server/services/ExportService.js`
- **Công việc cụ thể:**
  1. Viết câu SQL FTS5: `SELECT * FROM messages_fts WHERE messages_fts MATCH ?`.
  2. Viết module xuất danh sách `contacts` có `lead_captured = 1` ra file `.xlsx` / `.csv` bằng thư viện `exceljs`.
- **Xác minh:** Tìm kiếm từ khóa trả về kết quả ngay lập tức; Nút Export ra đúng file Excel chuẩn format.

### Task 3.4: Xử lý hiển thị Tin nhắn Thu hồi (Unsend)
- **Mục tiêu:** Giữ lại tin nhắn thu hồi trong CSDL và gắn nhãn cảnh báo đỏ trên UI.
- **Tệp mục tiêu:** `src/server/services/SyncManager.js`, `src/client/components/MessageItem.jsx`
- **Công việc cụ thể:**
  1. Bắt sự kiện `MSG_UNSEND` từ Chrome Extension -> Cập nhật `MESSAGES.is_unsent = 1`.
  2. Trên UI React, rendering tin nhắn thu hồi với khung màu hồng mờ kèm Icon nhãn màu đỏ: **"Khách hàng đã thu hồi tin nhắn này"**.
- **Xác minh:** Thao tác gỡ tin nhắn bên app Facebook Messenger -> Dashboard UI không mất tin nhắn mà hiện nhãn cảnh báo thu hồi.

---

## 🚀 SPRINT 4: TỰ ĐỘNG HÓA, BROADCAST AN TOÀN & DUAL-AI ENGINE (TUẦN 4)

### Task 4.1: Xây dựng Mô-đun Auto-Reply Tự Động Trả Lời
- **Mục tiêu:** Tự động trả lời theo từ khóa hoặc tin nhắn đầu tiên của khách.
- **Tệp mục tiêu:** `src/server/services/AutoReplyEngine.js`
- **Công việc cụ thể:**
  1. So khớp từ khóa kích hoạt (Trigger keyword) trong bảng `auto_replies`.
  2. Thay thế các biến cá nhân hóa `{ten_khach_hang}` -> Gửi phản hồi tự động.
- **Xác minh:** Khách nhắn từ khóa "báo giá" -> Hệ thống tự gửi lại mẫu câu báo giá lập tức.

### Task 4.2: Xây dựng Mô-đun Broadcast An Toàn (Quota 150/ngày + Random Delay)
- **Mục tiêu:** Gửi tin nhắn hàng loạt không lo bị khóa tài khoản Facebook.
- **Tệp mục tiêu:** `src/server/services/BroadcastEngine.js`
- **Công việc cụ thể:**
  1. Kiểm tra điều kiện `ACCOUNTS.broadcast_daily_count < 150`.
  2. Lập lịch gửi tuần tự từng khách hàng với độ trễ ngẫu nhiên 15s - 45s.
  3. Cập nhật tiến trình gửi (Progress Bar) trên UI Dashboard.
- **Xác minh:** Gửi chiến dịch 10 khách -> Tiến trình gửi cách nhau ngẫu nhiên từ 15-45s; Đạt 150 tin/ngày sẽ tự chặn không cho gửi tiếp.

### Task 4.3: Tích hợp Dual-AI Engine & Thuật toán AI Auto-Pause 30 Phút
- **Mục tiêu:** Cho phép kết nối Ollama Local / OpenAI / Gemini và tự động tạm dừng AI khi nhân viên can thiệp.
- **Tệp mục tiêu:** `src/server/services/AIMediator.js`, `src/server/connectors/ollamaConnector.js`, `src/server/connectors/cloudAiConnector.js`
- **Công việc cụ thể:**
  1. Xây dựng Connectors kết nối tới Local Ollama (`http://localhost:11434`) và Cloud OpenAI / Gemini API.
  2. Viết thuật toán check Pause AI: Khi nhân viên gõ tin nhắn tay -> Cập nhật `threads.ai_paused_until = Date.now() + 30 * 60 * 1000`.
  3. Nếu `now() < ai_paused_until` -> Bỏ qua không gọi AI sinh câu trả lời.
- **Xác minh:** Bật AI trả lời tự động -> Nhân viên nhảy vào gõ 1 tin nhắn -> AI tự tạm dừng trong đúng 30 phút.

---

## 🚀 SPRINT 5: MÃ HÓA BẢO VỆ CODE & ĐÓNG GÓI BỘ CÀI WINDOWS .EXE (TUẦN 5)

### Task 5.1: Biên dịch Bytecode Backend & Obfuscate Chrome Extension
- **Mục tiêu:** Bảo vệ bản quyền source code chống bị reverse engineering.
- **Tệp mục tiêu:** `scripts/build-bytecode.js`, `scripts/obfuscate-extension.js`
- **Công việc cụ thể:**
  1. Viết script chạy `bytenode` biên dịch toàn bộ các file JS trong `src/server/` sang file V8 Bytecode nhị phân `.jsc`.
  2. Viết script chạy `javascript-obfuscator` làm rối mã nguồn `background.js` và `content.js` của Chrome Extension.
- **Xác minh:** File `.jsc` chạy mượt mà trên môi trường Node.js runtime của Electron.

### Task 5.2: Cấu hình Electron Builder Đóng gói Installer `.exe`
- **Mục tiêu:** Tạo file cài đặt `FB_Messenger_CRM_Setup_1.0.0.exe` duy nhất cho Windows.
- **Tệp mục tiêu:** `electron-builder.yml`, `package.json`
- **Công việc cụ thể:**
  1. Cấu hình Electron Builder gom gói: Frontend Build + Node.js Bytecode + Chrome Portable Binaries + Extension.
  2. Cấu hình NSIS Installer cho phép chọn thư mục cài đặt và tự tạo shortcut trên Desktop.
- **Xác minh:** Chạy `npm run dist`, tạo ra file `.exe` cài đặt và chạy thử nghiệm mượt mà trên máy Windows sạch.

### Task 5.3: Kiểm thử Toàn diện (End-to-End Testing)
- **Mục tiêu:** Kiểm tra độ ổn định, tải RAM và tốc độ phản hồi trên môi trường thực tế.
- **Công việc cụ thể:**
  1. Thêm 5 tài khoản FB cá nhân chạy song song.
  2. Kiểm tra mức tiêu thụ RAM (< 1.5GB cho toàn bộ ứng dụng).
  3. Kiểm tra tính năng đồng bộ tin nhắn, tìm kiếm FTS5, Broadcast và AI Auto-Pause.
- **Xác minh:** Toàn bộ tính năng hoạt động không phát sinh lỗi, đạt đầy đủ tiêu chí trong Specification (`spec.md`).

---

## 🚀 SPRINT 6: SỬA LỖI ĐỒNG BỘ HỘI THOẠI USER & NGĂN CHROME RÁC KHI MỞ APP

### Task 6.1: Khắc phục xung đột Migration DB (`src/server/database/db.js`)
- [x] Đổi version migration `comment_lead_thread_after_send_only` thành `20261014003` để tránh lỗi `UNIQUE constraint failed: migrations.version`.

### Task 6.2: Ngăn Chrome Rác Mở khi Khởi động App (`src/server/services/ProcessManager.js`, `src/server/server.js`)
- [x] Bổ sung `hasValidFacebookProfile` và export `resolveAccountProfileDir` trong `ProcessManager.js`.
- [x] Dọn dẹp tài khoản mồ côi (`owner_user_id IS NULL`) không có profile hợp lệ và dừng các tiến trình Chrome mồ côi ngay khi `startServer()`.
- [x] Tắt cơ chế tự động bật cửa sổ Chrome hàng loạt cho mọi tài khoản `DISCONNECTED`/chưa đăng nhập trong `autoReconnectTimer` khi mở app.

### Task 6.3: Khắc phục lỗi Không Đồng bộ Hội thoại User (`src/extension/background.js`, `src/server/server.js`, `src/server/services/InboxSyncScheduler.js`)
- [x] Sửa `handleSync100Threads` trong `src/extension/background.js`: bỏ vòng lặp reload `/messages` khi đang ở `/messages/t/...`, ưu tiên quét `inboxTarget` (`INBOX`) trước `requestsTab`, và thêm fallback tab cho chế độ `realtime`.
- [x] Sửa `waitForPendingSetupCompletion` trong `src/extension/background.js`: không chặn hoàn tất đăng ký khi chưa mở composer.
- [x] Sửa `REGISTER_ACCOUNT` trong `src/server/server.js` và `InboxSyncScheduler.js`: không gửi `SET_SIDEBAR_SYNC_WINDOW: { enabled: false }` khi vừa kết nối, tự động mở cửa sổ sync và kích hoạt `SYNC_THREADS` (`full`) để đồng bộ hội thoại cá nhân ngay lập tức.
- [x] Cập nhật `hideChromeWindowFromScreen` trong `ProcessManager.js` để giữ Chromium render DOM khi chạy ngầm.

