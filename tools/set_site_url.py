#!/usr/bin/env python3
"""Прописывает адрес опубликованного сайта туда, где нужен полный адрес:
превью ссылок (og:image, og:url), разметка магазина, robots.txt и sitemap.xml.

Запуск: python3 tools/set_site_url.py https://parfumroom.ru
Можно запускать повторно с другим адресом.
"""
import pathlib, re, sys

if len(sys.argv) != 2 or not re.match(r"^https?://[^/\s]+", sys.argv[1]):
    sys.exit("Укажи адрес сайта, например: python3 tools/set_site_url.py https://parfumroom.ru")
site = sys.argv[1].rstrip("/")
root = pathlib.Path(__file__).resolve().parent.parent

index = root / "index.html"
s = index.read_text(encoding="utf-8")
s = re.sub(r'(<meta property="og:image" content=")[^"]*(")', rf"\g<1>{site}/images/og.jpg\2", s)
s = re.sub(r'\n<meta property="og:url" content="[^"]*">', "", s)
s = s.replace('<meta property="og:type" content="website">', f'<meta property="og:type" content="website">\n<meta property="og:url" content="{site}/">')
s = re.sub(r'("image":")[^"]*(og\.jpg")', rf"\g<1>{site}/images/\2", s)
s = re.sub(r'\n<link rel="canonical" href="[^"]*">', "", s)
s = s.replace('<link rel="icon" href="favicon.svg"', f'<link rel="canonical" href="{site}/">\n<link rel="icon" href="favicon.svg"', 1)
index.write_text(s, encoding="utf-8")

(root / "robots.txt").write_text(f"User-agent: *\nDisallow: /admin.html\nAllow: /\n\nSitemap: {site}/sitemap.xml\n", encoding="utf-8")
(root / "sitemap.xml").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{site}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>{site}/privacy.html</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>
''', encoding="utf-8")
print("Готово: адрес", site, "прописан в index.html, robots.txt и sitemap.xml")
