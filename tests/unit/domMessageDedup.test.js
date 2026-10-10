const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/extension/domMessageDedup.js', 'utf8'), context);
const { makeDomMessageId, shouldSkipObservation, createBubbleFamilyTracker } = context.FbCrmDomMessageDedup;

test('same message re-scanned with a flipped is_outgoing produces the SAME id (SC-001)', () => {
  const firstScan = { content: 'chào shop', is_outgoing: false, sender_name: '', effective_label: '', native_id: null, bubble_idx: 0 };
  const secondScan = { content: 'chào shop', is_outgoing: true, sender_name: 'Bạn', effective_label: 'Tin nhắn do Bạn gửi lúc 10:09: chào shop', native_id: null, bubble_idx: 0 };
  assert.equal(makeDomMessageId('969878666067566', firstScan), makeDomMessageId('969878666067566', secondScan));
});

test('a stable native_id makes the id direction-independent regardless of content/label drift', () => {
  const firstScan = { content: '20sáng', is_outgoing: false, native_id: 'mid.abc123', bubble_idx: 2 };
  const secondScan = { content: 'chào shop', is_outgoing: true, native_id: 'mid.abc123', bubble_idx: 2 };
  assert.equal(makeDomMessageId('t1', firstScan), makeDomMessageId('t1', secondScan));
});

test('grouped native bubbles keep the legacy first id and distinguish later bubbles', () => {
  const first = { content: 'tin mot', is_outgoing: false, native_id: 'mid.grouped', bubble_idx: 0 };
  const second = { content: 'tin hai', is_outgoing: false, native_id: 'mid.grouped', bubble_idx: 1 };
  const third = { content: 'tin ba', is_outgoing: false, native_id: 'mid.grouped', bubble_idx: 2 };

  assert.equal(makeDomMessageId('t1', first), 'mid.grouped');
  assert.equal(makeDomMessageId('t1', second), 'mid.grouped__bubble_1');
  assert.equal(makeDomMessageId('t1', third), 'mid.grouped__bubble_2');
});

test('genuinely different content still produces different ids (no regression, SC-002)', () => {
  const a = { content: 'ok', is_outgoing: false, native_id: null, bubble_idx: 0 };
  const b = { content: 'ok nhé', is_outgoing: false, native_id: null, bubble_idx: 0 };
  assert.notEqual(makeDomMessageId('t1', a), makeDomMessageId('t1', b));
});

test('shouldSkipObservation: identical id+direction already forwarded -> skip', () => {
  const seen = new Map([['dom_t1_hash_1_0', false]]);
  assert.equal(shouldSkipObservation(seen, 'dom_t1_hash_1_0', false), true);
});

test('shouldSkipObservation: same id but direction now disagrees -> do NOT skip (let the correction through, SC-001)', () => {
  const seen = new Map([['dom_t1_hash_1_0', false]]);
  assert.equal(shouldSkipObservation(seen, 'dom_t1_hash_1_0', true), false);
});

test('shouldSkipObservation: id never seen before -> do NOT skip', () => {
  const seen = new Map();
  assert.equal(shouldSkipObservation(seen, 'dom_t1_hash_1_0', false), false);
});

test('separate physical bubbles with identical content keep separate ids', () => {
  const first = { content: 'c', native_id: null, bubble_idx: 0, dom_occurrence_id: 101 };
  const second = { content: 'c', native_id: null, bubble_idx: 0, dom_occurrence_id: 102 };
  assert.notEqual(makeDomMessageId('t1', first), makeDomMessageId('t1', second));
});

test('content observer has no delayed startup or thread-change baseline window', () => {
  const source = fs.readFileSync('src/extension/content.js', 'utf8');
  assert.doesNotMatch(source, /Second seed after 3s/);
  assert.doesNotMatch(source, /seedBaseline\(thread_id\);\s*setTimeout/);
  assert.match(source, /chatObserver\.observe\(document\.body[\s\S]*observerPaused = false;/);
});

// ===== "alo" x2 chi con 1 (2026-10-08): reread timer tim nham article khac
// cung noi dung + echo suppression 90s nut tin khach mang label ro rang. =====

test('reread timer re-parses the exact bubble anchor, not the mutation root', () => {
  const source = fs.readFileSync('src/extension/content.js', 'utf8');
  assert.match(source, /const rereadScope = parsed\.dom_anchor \|\| node;/);
  assert.match(source, /rereadAll\.find\(\(item\) => rereadContentMatch\(item\)\s*&& \(Number\(item\.bubble_idx\) \|\| 0\) === \(Number\(parsed\.bubble_idx\) \|\| 0\)\)/);
  assert.doesNotMatch(source, /const reread = parseMessagesFromDOMNode\(node, true\)/);
});

test('echo suppression exempts rows whose label proves an incoming customer sender', () => {
  const source = fs.readFileSync('src/extension/content.js', 'utf8');
  assert.match(source, /const labelProvesIncoming = \/Tin nhắn do \.\+ gửi lúc\/i\.test/);
  assert.match(source, /!parsed\.native_id && !parsed\.is_outgoing && !labelProvesIncoming/);
});

test('loss-path diagnostics are instrumented for composer-debug', () => {
  const source = fs.readFileSync('src/extension/content.js', 'utf8');
  assert.match(source, /stage: 'TRACKER_DUPLICATE'/);
  assert.match(source, /stage: 'ECHO_SUPPRESSED'/);
  assert.match(source, /stage: deferredVerdict \? 'REREAD_NATIVE_ID' : 'REREAD_SYNTHETIC'/);
});

// ===== createBubbleFamilyTracker: phantom __bubble_N khi bubble_idx trôi giữa
// các lần quét (hội thoại "Yến" 2026-10-08 - cùng một bong bóng vật lý bị
// đánh số lại mid.x <-> mid.x__bubble_1 -> hai id -> hai row CRM). =====

const trackerItem = (nativeId, sig, proposedId) => ({ nativeId, sig, proposedId });

test('tracker: re-parse với bubble_idx trôi (phantom) bị đánh dấu duplicate', () => {
  const tracker = createBubbleFamilyTracker();
  // Lần quét 1 (ổn định): 1 lá -> mid.X
  const pass1 = tracker.resolveBatch([trackerItem('mid.X', 'in|text||chào', 'mid.X')]);
  assert.equal(pass1[0].duplicate, false);
  tracker.markSeen(pass1[0].key);
  // Lần quét 2 (hydrate trễ thêm lá tạm): cùng chữ ký, id thành mid.X__bubble_1
  const pass2 = tracker.resolveBatch([trackerItem('mid.X', 'in|text||chào', 'mid.X__bubble_1')]);
  assert.equal(pass2[0].duplicate, true);
  // Và theo chiều ngược lại (transient trước, ổn định sau - thứ tự DB thấy ở Yến)
  const tracker2 = createBubbleFamilyTracker();
  const p1 = tracker2.resolveBatch([trackerItem('mid.Y', 'in|text||alo', 'mid.Y__bubble_1')]);
  tracker2.markSeen(p1[0].key);
  const p2 = tracker2.resolveBatch([trackerItem('mid.Y', 'in|text||alo', 'mid.Y')]);
  assert.equal(p2[0].duplicate, true);
});

test('tracker: like-group tích lũy (thêm bản sao giống nhau) KHÔNG bị nuốt', () => {
  const tracker = createBubbleFamilyTracker();
  const batch1 = tracker.resolveBatch([
    trackerItem('mid.L', 'in|text||👍', 'mid.L'),
    trackerItem('mid.L', 'in|text||👍', 'mid.L__bubble_1')
  ]);
  batch1.forEach((v) => tracker.markSeen(v.key));
  assert.deepEqual(batch1.map((v) => v.duplicate), [false, false]);
  // Khách like thêm 1 cái: batch 3 lá, slot 2 là tin MỚI
  const batch2 = tracker.resolveBatch([
    trackerItem('mid.L', 'in|text||👍', 'mid.L'),
    trackerItem('mid.L', 'in|text||👍', 'mid.L__bubble_1'),
    trackerItem('mid.L', 'in|text||👍', 'mid.L__bubble_2')
  ]);
  assert.deepEqual(batch2.map((v) => v.duplicate), [true, true, false]);
  batch2.forEach((v) => tracker.markSeen(v.key));
  // Re-scan lại đủ 3 lá (reconcile đuôi): tất cả đã forward -> duplicate hết
  const batch3 = tracker.resolveBatch([
    trackerItem('mid.L', 'in|text||👍', 'mid.L'),
    trackerItem('mid.L', 'in|text||👍', 'mid.L__bubble_1'),
    trackerItem('mid.L', 'in|text||👍', 'mid.L__bubble_2')
  ]);
  assert.deepEqual(batch3.map((v) => v.duplicate), [true, true, true]);
});

test('tracker: drift khi batch bị cắt nhỏ (observer bắt node lá) vẫn duplicate', () => {
  const tracker = createBubbleFamilyTracker();
  const full = tracker.resolveBatch([
    trackerItem('mid.G', 'in|text||kkkk', 'mid.G'),
    trackerItem('mid.G', 'in|text||kkkk', 'mid.G__bubble_1')
  ]);
  full.forEach((v) => tracker.markSeen(v.key));
  // Đợt sau observer chỉ thấy article qua node con: parse ra 1 lá -> slot 0
  const partial = tracker.resolveBatch([trackerItem('mid.G', 'in|text||kkkk', 'mid.G__bubble_1')]);
  assert.equal(partial[0].duplicate, true);
});

test('tracker: chữ ký KHÁC nhau (direction flip / media hydrate thêm) không bị nuốt', () => {
  const tracker = createBubbleFamilyTracker();
  const first = tracker.resolveBatch([trackerItem('mid.M', 'in|text||hi', 'mid.M')]);
  tracker.markSeen(first[0].key);
  const flipped = tracker.resolveBatch([trackerItem('mid.M', 'out|text||hi', 'mid.M')]);
  assert.equal(flipped[0].duplicate, false);
  const richer = tracker.resolveBatch([trackerItem('mid.V', 'in|image|http://x|hi', 'mid.V')]);
  assert.equal(richer[0].duplicate, false);
});

test('tracker: id không phải mid.* (dom_ hash) đi qua nguyên trạng', () => {
  const tracker = createBubbleFamilyTracker();
  const v = tracker.resolveBatch([trackerItem(null, 'in|text||c', 'dom_t1_hash_9_0')]);
  assert.equal(v[0].id, 'dom_t1_hash_9_0');
  assert.equal(v[0].key, null);
  assert.equal(v[0].duplicate, false);
});

test('tracker: family riêng biệt không ảnh hưởng nhau dù nội dung giống', () => {
  const tracker = createBubbleFamilyTracker();
  const a = tracker.resolveBatch([trackerItem('mid.A', 'in|text||alo', 'mid.A')]);
  const b = tracker.resolveBatch([trackerItem('mid.B', 'in|text||alo', 'mid.B')]);
  assert.equal(a[0].duplicate, false);
  assert.equal(b[0].duplicate, false);
});

test('tracker: markSeen idempotent và resolveBatch chỉ đọc khi chưa markSeen', () => {
  const tracker = createBubbleFamilyTracker();
  const v1 = tracker.resolveBatch([trackerItem('mid.X', 'in|text||x', 'mid.X')]);
  assert.equal(v1[0].duplicate, false);
  // resolveBatch KHÔNG tự mark: quét lại lần 2 vẫn chưa duplicate cho tới markSeen
  const v2 = tracker.resolveBatch([trackerItem('mid.X', 'in|text||x', 'mid.X')]);
  assert.equal(v2[0].duplicate, false);
  tracker.markSeen(v1[0].key);
  tracker.markSeen(v1[0].key);
  const v3 = tracker.resolveBatch([trackerItem('mid.X', 'in|text||x', 'mid.X__bubble_1')]);
  assert.equal(v3[0].duplicate, true);
});

test('tracker: content.js mirror đồng bộ với bản testable', () => {
  const dedupSrc = fs.readFileSync('src/extension/domMessageDedup.js', 'utf8');
  const contentSrc = fs.readFileSync('src/extension/content.js', 'utf8');
  const grab = (src, name) => {
    const start = src.indexOf(`function ${name}()`);
    assert.ok(start >= 0, `${name} phải tồn tại`);
    let depth = 0, i = src.indexOf('{', start);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    return '';
  };
  const strip = (code) => code
    .replace(/\/\/[^\n]*/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  assert.equal(strip(grab(contentSrc, 'createBubbleFamilyTracker')), strip(grab(dedupSrc, 'createBubbleFamilyTracker')));
});
