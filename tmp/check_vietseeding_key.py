# Kiem tra key vietseeding co hoat dong khong - chi in status + cau truc, KHONG in cookie
import requests

URL = "https://api.vietseeding.com/api/export/seeding-cookies"
KEY = "B6Y3QSoXPZBvDGziP-4FnU7TWCRb0hJ-G0Km9CuTJ5o"

try:
    r = requests.get(URL, headers={"Authorization": f"Bearer {KEY}"}, timeout=30)
except Exception as e:
    print("LOI KET NOI / KHONG VUOT DUOC MANG:", e)
    input("Nhan Enter de dong...")
    raise SystemExit

print("HTTP status:", r.status_code)

if r.status_code == 200:
    try:
        data = r.json()
    except Exception:
        print("=> KEY HOAT DONG nhung body khong phai JSON")
        data = None
    if isinstance(data, dict):
        print("Top-level keys:", list(data.keys()))
        for k, v in data.items():
            if isinstance(v, list):
                print(f"  {k}: {len(v)} phan tu")
                if v and isinstance(v[0], dict):
                    print(f"    fields cua 1 item: {list(v[0].keys())}")
    elif isinstance(data, list):
        print(f"Mang gom {len(data)} phan tu")
        if data and isinstance(data[0], dict):
            print(f"  fields cua 1 item: {list(data[0].keys())}")
    print("=> KEY HOAT DONG (200)")
elif r.status_code in (401, 403):
    print("Body:", r.text[:200])
    print("=> KEY SAI / HET HAN / BI KHOA")
elif r.status_code == 429:
    print("=> BI GIOI HAN (goi qua nhieu) - thu lai sau vai phut")
else:
    print("Body:", r.text[:200])
    print(f"=> LOI PHIA SERVER ({r.status_code})")

input("Nhan Enter de dong...")
