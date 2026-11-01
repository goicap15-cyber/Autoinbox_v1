/** Global phone automation (Spec 037).
 * A deliberately opt-in CRM rule: valid incoming phone captures can change
 * the contact status even when no campaign is involved. Campaign status
 * automation runs after this and therefore remains the explicit override. */
class GlobalPhoneAutomationService {
  static get(database) {
    database.prepare(`INSERT OR IGNORE INTO phone_capture_automation_settings (id, is_enabled, status_id) VALUES (1, 0, NULL)`).run();
    const row = database.prepare(`
      SELECT s.is_enabled, s.status_id, s.updated_at, ls.name AS status_name, ls.color AS status_color
      FROM phone_capture_automation_settings s
      LEFT JOIN lead_statuses ls ON ls.id = s.status_id
      WHERE s.id = 1
    `).get();
    return {
      enabled: Boolean(row?.is_enabled),
      status_id: row?.status_id == null ? null : Number(row.status_id),
      status_name: row?.status_name || null,
      status_color: row?.status_color || null,
      updated_at: row?.updated_at || null
    };
  }

  static update(input = {}, database) {
    const enabled = input.enabled === true || input.enabled === 1 || input.enabled === 'true';
    const rawStatusId = input.status_id == null || input.status_id === '' ? null : Number(input.status_id);
    if (rawStatusId != null && (!Number.isInteger(rawStatusId) || rawStatusId < 1)) {
      const error = new Error('Trạng thái đích không hợp lệ.'); error.code = 'INVALID_PHONE_AUTOMATION_STATUS'; throw error;
    }
    if (enabled && rawStatusId == null) {
      const error = new Error('Hãy chọn trạng thái đích trước khi bật tự động hóa số điện thoại.'); error.code = 'PHONE_AUTOMATION_STATUS_REQUIRED'; throw error;
    }
    if (rawStatusId != null && !database.prepare('SELECT id FROM lead_statuses WHERE id = ?').get(rawStatusId)) {
      const error = new Error('Trạng thái đích không còn tồn tại.'); error.code = 'INVALID_PHONE_AUTOMATION_STATUS'; throw error;
    }
    database.prepare(`
      INSERT INTO phone_capture_automation_settings (id, is_enabled, status_id, updated_at)
      VALUES (1, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET is_enabled = excluded.is_enabled, status_id = excluded.status_id, updated_at = CURRENT_TIMESTAMP
    `).run(enabled ? 1 : 0, rawStatusId);
    return this.get(database);
  }

  static applyCaptures(threadId, captures, database) {
    const settings = this.get(database);
    if (!settings.enabled || settings.status_id == null || !threadId || !Array.isArray(captures) || captures.length === 0) {
      return { applied: false, settings };
    }
    const statusExists = database.prepare('SELECT id FROM lead_statuses WHERE id = ?').get(settings.status_id);
    if (!statusExists) return { applied: false, settings: { ...settings, enabled: false, status_id: null, status_name: null, status_color: null } };
    const result = database.prepare('UPDATE contacts SET status_id = ? WHERE thread_id = ?').run(settings.status_id, threadId);
    return { applied: result.changes > 0, settings };
  }
}
module.exports = GlobalPhoneAutomationService;
