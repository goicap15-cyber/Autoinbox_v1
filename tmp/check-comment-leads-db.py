import sqlite3, os, sys
sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'autochatbot-fb-crm', 'data', 'database.db')
if not os.path.exists(db_path):
    base = os.path.dirname(db_path)
    cands = [f for f in os.listdir(base) if f.endswith('.db')]
    print('db candidates:', cands)
    db_path = os.path.join(base, cands[0]) if cands else None
if db_path:
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    cur = con.cursor()
    mig = cur.execute("SELECT version, name FROM migrations WHERE version = 20261013001").fetchall()
    print('migration row:', mig)
    try:
        cols = [r[1] for r in cur.execute('PRAGMA table_info(comment_leads)').fetchall()]
        print('comment_leads cols:', cols)
        print('row count:', cur.execute('SELECT COUNT(*) FROM comment_leads').fetchone()[0])
    except Exception as e:
        print('comment_leads error:', e)
    con.close()
