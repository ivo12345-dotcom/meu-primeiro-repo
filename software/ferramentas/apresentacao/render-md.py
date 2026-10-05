import io, os, re, sys, subprocess, markdown
src, out_html, out_pdf, titulo, orient = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], (sys.argv[5] if len(sys.argv) > 5 else 'portrait')
md = io.open(src, encoding='utf-8').read()
lin = [re.sub(r'^( +)', lambda m: ' ' * (len(m.group(1)) * 2) if len(m.group(1)) < 4 else m.group(1), l) for l in md.split('\n')]
item = re.compile(r'^\s*(-|\d+\.) ')
out = []
for l in lin:
    if item.match(l) and out and out[-1].strip() and not item.match(out[-1]) and not out[-1].startswith(' '):
        out.append('')
    out.append(l)
body = markdown.markdown('\n'.join(out), extensions=['tables', 'sane_lists'])
css = """body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;line-height:1.42;color:#1b2430;margin:0}
h1{font-size:17pt;color:#0b3d5c;border-bottom:3px solid #0b3d5c;padding-bottom:4px}
h2{font-size:13pt;color:#0b3d5c;margin-top:16px;border-bottom:1px solid #c9d6e0;page-break-after:avoid}
h3{font-size:11pt;color:#0b3d5c;page-break-after:avoid}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:9pt}
th,td{border:1px solid #c9d6e0;padding:4px 6px;vertical-align:top;text-align:left}
th{background:#e8f0f6}
code{background:#eef2f5;padding:0 2px;border-radius:3px;font-size:8.5pt}
ul,ol{margin:3px 0;padding-left:18px}
@page{size:A4 __ORIENT__;margin:14mm 13mm}""".replace("__ORIENT__", orient)
html = "<!doctype html><html lang='pt-PT'><head><meta charset='utf-8'><title>%s</title><style>%s</style></head><body>%s</body></html>" % (titulo, css, body)
io.open(out_html, 'w', encoding='utf-8').write(html)
chrome = os.environ.get('CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
url = 'file:///' + out_html.replace('\\', '/')
r = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + out_pdf, url], capture_output=True, text=True)
print((r.stderr or '').strip().splitlines()[-1] if r.stderr else 'chrome ok')
import fitz
d = fitz.open(out_pdf)
print('paginas', d.page_count)
