// Test logic detectRowUnread (trich tu sidebarActivityObserver.js) voi DOM gia.
const fs = require('fs');
const src = fs.readFileSync('src/extension/sidebarActivityObserver.js', 'utf8');
const fnMatch = src.match(/function detectRowUnread\(row\) \{[\s\S]*?\n  \}/);
if (!fnMatch) { console.log('KHONG TACH DUOC detectRowUnread'); process.exit(1); }
eval(fnMatch[0]);

// ---- DOM gia ----
function makeEl({ w = 0, h = 0, br = '0px', bg = 'rgba(0, 0, 0, 0)', label = null, children = [], tags = [] } = {}) {
  const el = {
    offsetWidth: w, offsetHeight: h, label,
    getAttribute: (k) => (k === 'aria-label' ? label : null),
    children,
    __tags: tags,
    __computed: { borderTopLeftRadius: br, backgroundColor: bg }
  };
  el.querySelectorAll = (sel) => {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        const wantTag = sel === '[aria-label]' ? c.label != null : /^(div|span|i)$/.test(c.__tag || 'div');
        if (sel === 'div, span, i') out.push(c);
        else if (sel === '[aria-label]' && c.label != null) out.push(c);
        else if (sel === '[data-testid="unread-count"], .unread' && c.__tags.some((t) => t === 'unread-count' || t === 'unread')) out.push(c);
        walk(c);
      }
    };
    walk(el);
    return out;
  };
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  return el;
}
global.getComputedStyle = (e) => e.__computed;

const FB_BLUE = 'rgb(8, 102, 255)';
const OLD_BLUE = 'rgb(24, 119, 242)';
const GREEN = 'rgb(49, 162, 76)';
const GRAY = 'rgb(101, 103, 107)';
const TRANSPARENT = 'rgba(8, 102, 255, 0)';

const cases = [
  ['row co chot xanh FB 10px', makeEl({ children: [makeEl({ w: 10, h: 10, br: '50%', bg: FB_BLUE })] }), true],
  ['row co chot xanh cu #1877F2 12px', makeEl({ children: [makeEl({ w: 12, h: 12, br: '9999px', bg: OLD_BLUE })] }), true],
  ['row co chot online XANH LA (phai loai)', makeEl({ children: [makeEl({ w: 10, h: 10, br: '50%', bg: GREEN })] }), false],
  ['row co cham xam (phai loai)', makeEl({ children: [makeEl({ w: 10, h: 10, br: '50%', bg: GRAY })] }), false],
  ['row co vong trong trong suot (phai loai)', makeEl({ children: [makeEl({ w: 10, h: 10, br: '50%', bg: TRANSPARENT })] }), false],
  ['row co avatar 40px (ngoai kich thuoc, phai loai)', makeEl({ children: [makeEl({ w: 40, h: 40, br: '50%', bg: FB_BLUE })] }), false],
  ['row co vuong 10px khong tron (phai loai)', makeEl({ children: [makeEl({ w: 10, h: 10, br: '2px', bg: FB_BLUE })] }), false],
  ['row aria-label "Chua doc" (chu hoa dac biet)', makeEl({ children: [makeEl({ label: 'Rosalind, 1 chưa đọc' })] }), true],
  ['row aria-label "unread" tieng Anh', makeEl({ children: [makeEl({ label: '1 unread message' })] }), true],
  ['row data-testid unread-count', makeEl({ children: [makeEl({ tags: ['unread-count'] })] }), true],
  ['row doc binh thuong (khong co gi)', makeEl({ children: [makeEl({ w: 32, h: 32, br: '50%' }), makeEl({ w: 8, h: 8, br: '4px' })] }), false]
];

let bad = 0;
for (const [name, row, expect] of cases) {
  const got = detectRowUnread(row);
  const ok = got === expect;
  if (!ok) bad += 1;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' => ' + got);
}
process.exit(bad ? 1 : 0);
