const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const msgs = db.prepare(`
  SELECT id, fb_message_id, is_outgoing, timestamp_ms, created_at, sequence_order, direction_status, timestamp_source,
        substr(replace(content, char(10), ' '), 1, 55) AS content_head
  FROM messages
  WHERE thread_id = '100040996505718'
  ORDER BY COALESCE(timestamp_ms, 0) DESC, id DESC LIMIT 12
`).all();
console.log('LAST 12 MESSAGES (thread 100040996505718, Yến):');
for (const m of msgs) {
  console.log([m.created_at, 'ts=' + m.timestamp_ms, 'out=' + m.is_outgoing, 'seq=' + m.sequence_order, m.timestamp_source, String(m.fb_message_id).slice(0, 46), JSON.stringify(m.content_head)].join(' | '));
}
