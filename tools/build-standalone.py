#!/usr/bin/env python3
"""Baut standalone.html: eine Datei mit eingebetteten Daten, CSS und JS.
Nur zum Anschauen ohne Webserver. Quelle der Wahrheit bleibt landkarte.json."""
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'assets' / 'style.css').read_text(encoding='utf-8')
js = (root / 'assets' / 'app.js').read_text(encoding='utf-8')
data = json.loads((root / 'landkarte.json').read_text(encoding='utf-8'))

html = html.replace('<link rel="stylesheet" href="assets/style.css">', f'<style>\n{css}\n</style>')
payload = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
html = html.replace(
    '<script src="assets/app.js"></script>',
    f'<script>window.LANDKARTE_DATA={payload};</script>\n<script>\n{js}\n</script>'
)
html = re.sub(r'<title>(.*?)</title>', r'<title>\1</title>', html)
(root / 'standalone.html').write_text(html, encoding='utf-8')
print('standalone.html geschrieben,', len(html), 'Zeichen')
