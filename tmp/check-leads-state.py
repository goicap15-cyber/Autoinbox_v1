import sqlite3, os, sys
sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'autochatbot-fb-crm', 'data', 'database.db')
con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
cur = con.cursor()
try:
    rows = cur.execute('SELECT id, post_url, author_uid, author_name, status, created_at FROM comment_leads ORDER BY id DESC LIMIT 20').fetchall()
    print('comment_leads rows:', len(rows))
    for r in rows: print(r)
except Exception as e:
    print('err:', e)
kv = cur.execute("SELECT key, substr(value,1,60) FROM page_api_config").fetchall()
print('kv keys:', kv)
con.close()
