"""Regenerate js/data/users.js from Excel columns: Member | Team | Role | Password | Report (optional: No = hide from reports)
Usage:  python tools/excel_to_users.py User_Team_Access.xlsx      (needs: pip install openpyxl)"""
import json, sys, pathlib, openpyxl
src = sys.argv[1] if len(sys.argv) > 1 else 'User_Team_Access.xlsx'
ws = openpyxl.load_workbook(src, data_only=True).active
rows = []
for r in list(ws.iter_rows(values_only=True))[1:]:
    if not r or not r[0]: continue
    pw = r[3]
    pw = str(int(pw)) if isinstance(pw, (int, float)) else str(pw or '').strip()
    x = {"member": str(r[0]).strip(), "team": str(r[1] or '').strip(), "role": str(r[2] or 'Member').strip(), "password": pw}
    if len(r) > 4 and str(r[4] or '').strip().lower() in ('no', 'n', 'false', '0'): x["report"] = False
    rows.append(x)
out = pathlib.Path(__file__).resolve().parent.parent / 'js' / 'data' / 'users.js'
head = out.read_text(encoding='utf-8').split('window.HARDCODED_USER_ROWS = [')[0] if out.exists() else ''
body = ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in rows)
out.write_text(head + "window.HARDCODED_USER_ROWS = [\n" + body + "\n];\n", encoding='utf-8')
print(f"Wrote {len(rows)} rows -> {out}")
