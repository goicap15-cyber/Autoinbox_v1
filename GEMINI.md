## Mandatory Project Policies

### 1. Always Read Rules First
- At the start of every task or implementation, inspect `AGENTS.md` and `PROJECT_RULES.md` before writing code.

### 2. Spec-Driven Development (Spec Kit Workflow)
- Every feature development or structural change MUST follow the Spec Kit SDD process:
  - `/speckit.specify` -> `/speckit.plan` -> `/speckit.tasks` -> `/speckit.implement` -> `/speckit.converge`

### 3. Maintain Knowledge Graph (Graphify)
- This project has a knowledge graph at `graphify-out/`.
- For codebase questions, use `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"`.
- **MANDATORY**: After modifying code or changing architecture, run `graphify update .` to keep the graph current.

### 4. UI/UX Pro Max Design Rules
- Follow UI/UX design intelligence guidelines from `ui-ux-pro-max` skill for all UI components, pages, design tokens, color schemes, typography, and responsive layouts.

### 5. Quy trình Đóng gói & Phát hành Bản cập nhật (Hot-Update & Release)
- Khi sửa code xong và cần cập nhật vào bản chạy thực tế `release/win-unpacked/FB Messenger CRM.exe` + phát hành bản cập nhật (Hot-Update) lên nhánh `prod-owner-only`:
  - Chạy `node scripts/publish-update.js "<mô tả thay đổi>"` để tự động tăng `version` trong `package.json`, build toàn bộ (`dist/client`, `dist/server`, `dist/extension`) và tạo `updates/crm-update.zip` + `updates/version.json`.
  - Chạy `node tmp/repack_release.js` để đóng gói `app.asar`, cập nhật `resources/extension` và vá mã SHA256 header hash trong `release/win-unpacked/FB Messenger CRM.exe`.
  - Khi người dùng yêu cầu đẩy bản cập nhật lên GitHub, chạy `npm run release:push` (hoặc commit `updates/version.json`, `updates/crm-update.zip`, `package.json` và push lên nhánh `prod-owner-only`).
