import sqlite3, json
db = sqlite3.connect(r'file:C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
print('=== ACCOUNTS ===')
for r in db.execute("SELECT id, name, status, profile_dir, substr(updated_at,1,19) upd FROM accounts"):
    print(json.dumps(dict(r), ensure_ascii=False))
print('=== EXT REGISTRATIONS (recent) ===')
try:
    for r in db.execute("SELECT * FROM sqlite_master WHERE name LIKE '%extension%' OR name LIKE '%register%'"):
        print(r['name'])
except Exception as e:
    print(e)
