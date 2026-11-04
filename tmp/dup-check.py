import sqlite3, json
db = sqlite3.connect(r'file:C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
THREAD = '2211776809571916'

print('=== DUP CONTENT ROWS ===')
for r in db.execute("""SELECT fb_message_id, substr(content,1,40) content, sender_name, is_outgoing, created_at, timestamp_ms
  FROM messages WHERE thread_id=? AND content IN ('là sao','chắc vẫn hơn em') ORDER BY created_at""", (THREAD,)):
    print(json.dumps(dict(r), ensure_ascii=False))

print('=== THREAD TAIL (oldest->newest, last 25) ===')
rows = list(db.execute("""SELECT fb_message_id, substr(content,1,30) content, sender_name, is_outgoing, created_at, timestamp_ms
  FROM messages WHERE thread_id=? ORDER BY created_at DESC LIMIT 25""", (THREAD,)))
for r in reversed(rows):
    print(json.dumps(dict(r), ensure_ascii=False))

print('=== COLUMNS ===')
print(','.join(r['name'] for r in db.execute('PRAGMA table_info(messages)')))
