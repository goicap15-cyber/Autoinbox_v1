const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { APP_DATA_ROOT } = require('../utils/appDataRoot');

const EXPORT_DIR = path.join(APP_DATA_ROOT, 'exports');
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// 2026-11-05: xuất TOÀN BỘ hội thoại (1 dòng = 1 hội thoại/khách hàng) — bỏ
// hẳn bộ lọc SĐT/email/trạng thái cũ. Nguồn là threads LEFT JOIN contacts:
// hội thoại chưa từng tạo row contact vẫn vào file, các cột thông tin phụ
// (SĐT, email, ghi chú, thẻ...) để trống. Excel và CSV dùng chung một nguồn
// để không còn lệch dòng. Tên khách fallback sang threads.contact_name khi
// contacts.name trống (bắt số tự động chỉ lưu SĐT vào contacts).
const LEADS_QUERY = `
  SELECT
    COALESCE(NULLIF(c.name, ''), t.contact_name) AS name,
    c.nickname,
    c.phone,
    c.email,
    c.address,
    c.notes,
    ls.name AS status_name,
    c.tags,
    c.custom_fields,
    COALESCE(NULLIF(a.name, ''), t.account_id) AS tai_khoan_fb,
    src.display_name AS page_name,
    c.profile_url,
    t.last_activity
  FROM threads t
  LEFT JOIN contacts c ON c.thread_id = t.id
  LEFT JOIN lead_statuses ls ON ls.id = c.status_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN inbox_sources src ON src.id = t.source_id
  ORDER BY t.last_activity DESC
`;

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function formatTags(value) {
  return parseJsonArray(value)
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

function formatCustomFields(value) {
  return parseJsonArray(value)
    .map((field) => {
      if (!field || typeof field !== 'object') return '';
      const label = typeof field.label === 'string' ? field.label.trim() : '';
      const val = typeof field.value === 'string' ? field.value.trim() : '';
      if (!label) return '';
      return val ? `${label}: ${val}` : label;
    })
    .filter(Boolean)
    .join('; ');
}

// last_activity trong DB tồn tại 2 dạng UTC: 'YYYY-MM-DD HH:MM:SS'
// (CURRENT_TIMESTAMP của SQLite) và ISO 'YYYY-MM-DDTHH:MM:SS.sssZ' - xuất ra
// Excel trông lộn xộn. Quy cả hai về giờ địa phương 'YYYY-MM-DD HH:MM'.
function formatLocalDateTime(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw}Z` : raw;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return raw;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getLeadRows() {
  return db.prepare(LEADS_QUERY).all().map((lead) => ({
    ...lead,
    the_phan_loai: formatTags(lead.tags),
    truong_tuy_chinh: formatCustomFields(lead.custom_fields),
    last_activity: formatLocalDateTime(lead.last_activity)
  }));
}

class ExportService {
  /**
   * Xuất danh sách Lead thu thập được ra file Excel (.xlsx)
   * @returns {string} Đường dẫn file Excel đã xuất
   */
  async exportLeadsToExcel() {
    const leads = getLeadRows();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AutoChatbot FB CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Danh Sách Lead', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    // Thiết lập Header Row với màu sắc đẹp
    sheet.columns = [
      { header: 'Họ tên khách hàng', key: 'name', width: 28 },
      { header: 'Biệt danh', key: 'nickname', width: 18 },
      { header: 'Số điện thoại', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Địa chỉ', key: 'address', width: 32 },
      { header: 'Ghi chú', key: 'notes', width: 40 },
      { header: 'Trạng thái', key: 'status_name', width: 16 },
      { header: 'Thẻ phân loại', key: 'the_phan_loai', width: 20 },
      { header: 'Trường tùy chỉnh', key: 'truong_tuy_chinh', width: 30 },
      { header: 'Tài khoản FB', key: 'tai_khoan_fb', width: 22 },
      { header: 'Page', key: 'page_name', width: 26 },
      { header: 'Link FB', key: 'profile_url', width: 34 },
      { header: 'Hoạt động cuối', key: 'last_activity', width: 22 }
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A5F' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF3B82F6' } }
      };
    });
    headerRow.height = 28;

    // Thêm dữ liệu từng Lead
    leads.forEach((lead, idx) => {
      const row = sheet.addRow(lead);
      // Màu xen kẽ dòng
      if (idx % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
        });
      }
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
    });

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:M1';

    const fileName = `leads_${Date.now()}.xlsx`;
    const filePath = path.join(EXPORT_DIR, fileName);
    await workbook.xlsx.writeFile(filePath);

    console.log(`[ExportService] Đã xuất ${leads.length} Lead ra file: ${filePath}`);
    return filePath;
  }

  /**
   * Xuất danh sách Lead ra file CSV
   * @returns {string} Đường dẫn file CSV đã xuất
   */
  exportLeadsToCSV() {
    const leads = getLeadRows();

    const header = ['Họ tên,Biệt danh,Số điện thoại,Email,Địa chỉ,Ghi chú,Trạng thái,Thẻ phân loại,Trường tùy chỉnh,Tài khoản FB,Page,Link FB,Hoạt động cuối'];
    const rows = leads.map((l) =>
      [l.name, l.nickname, l.phone, l.email, l.address, l.notes, l.status_name, l.the_phan_loai, l.truong_tuy_chinh, l.tai_khoan_fb, l.page_name, l.profile_url, l.last_activity]
        .map((v) => `"${(v || '').toString().replace(/"/g, '""')}"`)
        .join(',')
    );

    const csv = [...header, ...rows].join('\n');
    const fileName = `leads_${Date.now()}.csv`;
    const filePath = path.join(EXPORT_DIR, fileName);
    fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf8'); // BOM UTF-8 cho Excel mở đúng

    console.log(`[ExportService] Đã xuất ${leads.length} Lead ra CSV: ${filePath}`);
    return filePath;
  }
}

module.exports = new ExportService();
