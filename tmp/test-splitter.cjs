function splitTopLevelJsonObjects(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
      }
    }
  }
  return out;
}
const Q = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const doc1 = JSON.stringify({ data: { viewer: { bootstrap_keywords: { edges: [{ node: { keyword_text: 'ele' + Q + 'ven' + BS + Q + 'labs{' } }] } } } });
const doc2 = JSON.stringify({ data: { message: { message_id: 'mid.123', thread_key: { thread_fbid: '100010068667322' } } } });
const doc3 = 'for (;;);' + JSON.stringify({ data: { x: '}' } });
const body = doc1 + doc2 + '\n' + doc3;
let ok = 0;
try { JSON.parse(body); console.log('whole parse: UNEXPECTED OK'); } catch { console.log('whole parse: FAIL (as expected)'); }
const chunks = [];
for (const line of body.split('\n')) {
  const t = line.trim(); if (!t) continue;
  try { chunks.push(JSON.parse(t)); continue; } catch (e) {}
  for (const piece of splitTopLevelJsonObjects(t)) {
    let p = piece.trim();
    const pm = p.match(/^(?:for\s*\(;;\);|while\s*\(1\);|while\s*\(true\);)+/i);
    if (pm) p = p.slice(pm[0].length);
    try { chunks.push(JSON.parse(p)); ok++; } catch (e2) { console.log('piece fail:', p.substring(0, 50)); }
  }
}
console.log('chunks:', chunks.length, '| from splitter:', ok);
console.log('has doc1:', chunks.some(c => c?.data?.viewer), '| has doc2:', chunks.some(c => c?.data?.message), '| has doc3:', chunks.some(c => c?.data?.x === '}'));
