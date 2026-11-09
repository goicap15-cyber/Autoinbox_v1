# Agent Instructions & Execution Rules

These rules apply to all AI agent executions in this project (`autochatbot`).

## Mandatory Core Rules

### 1. Always Read Rules First
- At the start of every task or coding session, read `AGENTS.md` and `PROJECT_RULES.md` before analyzing code or writing implementation.

### 2. Follow Spec Kit Workflow
- All new feature implementations and major architecture changes MUST follow Spec-Driven Development:
  - Phase 1: `/speckit.specify` (Requirements)
  - Phase 2: `/speckit.plan` (Architecture & Plan)
  - Phase 3: `/speckit.tasks` (Task Breakdown)
  - Phase 4: `/speckit.implement` (Code Implementation)
  - Phase 5: `/speckit.converge` (Verification)

### 3. Maintain Knowledge Graph (Graphify)
- Use `graphify query`, `graphify path`, or `graphify explain` to explore codebase dependencies and structure.
- **MANDATORY**: Run `graphify update .` after making any code or architecture changes to keep the graph up to date.

### 4. Apply UI/UX Pro Max Design Intelligence
- When building or modifying UI, consult the `ui-ux-pro-max` skill.
- Enforce 3-layer design tokens, accessible color palettes, responsive layouts, micro-animations, and ARIA standards.

### 5. Release & In-App Hot-Update Packaging (`autoinbox_v1` / `prod-owner-only`)
- Official Auto-Update repository: `https://github.com/goicap15-cyber/Autoinbox_v1.git` (git remote `autoinbox_v1`, branch `prod-owner-only`).
- After modifying source code (`src/client`, `src/server`, or `src/extension`), to update the local desktop executable and create the GitHub Hot-Update package:
  1. Run `node scripts/publish-update.js "<release notes>"` (bumps `package.json` version, builds `dist/client`, `dist/server`, `dist/extension`, and writes `updates/crm-update.zip` + `updates/version.json`).
  2. Run `node tmp/repack_release.js` (packs `release/win-unpacked/resources/app.asar`, updates `release/win-unpacked/resources/extension`, and patches the ASAR header SHA256 hash inside `release/win-unpacked/FB Messenger CRM.exe`).
  3. When asked to push/publish the update for customers, commit and push `updates/version.json`, `updates/crm-update.zip`, and `package.json` to `autoinbox_v1` on the `prod-owner-only` branch (`npm run release:push` / `git push autoinbox_v1 HEAD:prod-owner-only`).
