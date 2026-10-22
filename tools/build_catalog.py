#!/usr/bin/env python3
"""Собирает каталог из data/price.txt.

Создаёт:
  data/catalog.js      — каталог для демо-режима сайта
  supabase/seed.sql    — тот же каталог для загрузки в Supabase

Запуск: python3 tools/build_catalog.py
"""
import hashlib, json, pathlib, re, unicodedata

root = pathlib.Path(__file__).resolve().parent.parent

def slug(text):
    """«27 87 Mosaïque» → «27-87-mosaique»: так называется файл фото в папке images."""
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")

photos = {p.stem: p for p in (root / "images").glob("*") if p.suffix.lower() in {".webp", ".jpg", ".jpeg", ".png"}}
rows = []
for line in (root / "data/price.txt").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("#"):
        continue
    house, name, price, loc, tag, tags = (line.split("|") + [""] * 6)[:6]
    # «новинка 2026» в пометке превращается в метку «Новинка», остальной текст остаётся описанием
    is_new = bool(re.search(r"новинка", tag, re.I))
    desc = re.sub(r"новинка\s*\d*", "", tag, flags=re.I).strip(" ,;")
    # мягкий цвет «жидкости» во флаконе, стабильный для каждого аромата
    h = int(hashlib.md5((house + name).encode()).hexdigest()[:4], 16) % 360
    rows.append({
        "id": hashlib.md5((house + "|" + name).encode()).hexdigest()[:10],
        "house": house.strip(), "name": name.strip(),
        "description": desc, "is_new": is_new, "price_per_ml": int(price),
        "tags": [t.strip().lower() for t in tags.split(",") if t.strip()],
        "location": loc.strip(), "min_ml": 2,
        "bottle_price": None, "bottle_volume": None, "ml_left": None,
        "color": f"hsl({h} 38% 52%)",
        "photo_url": (lambda p: f"images/{p.name}" if p else None)(photos.get(slug(f"{house} {name}"))),
    })

rows.sort(key=lambda r: (r["house"].lower(), r["name"].lower()))
(root / "data/catalog.js").write_text(
    "// Создано tools/build_catalog.py из data/price.txt — правь прайс там.\n"
    "window.CATALOG = " + json.dumps(rows, ensure_ascii=False, indent=0) + ";\n",
    encoding="utf-8")

q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
values = ",\n".join(
    f"({q(r['house'])}, {q(r['name'])}, {q(r['description'] or None)}, {r['price_per_ml']}, "
    f"{q(r['location'] or None)}, {q(r['color'])}, {q(r['photo_url'])}, {'true' if r['is_new'] else 'false'}, "
    f"{q('{' + ','.join(r['tags']) + '}')})" for r in rows)
(root / "supabase/seed.sql").write_text(
    "-- Загрузка прайса в Supabase. Выполни один раз после schema.sql.\n"
    "insert into perfumes (house, name, description, price_per_ml, location, color, photo_url, is_new, tags) values\n"
    + values + ";\n", encoding="utf-8")

matched = {r["photo_url"].split("/")[-1].rsplit(".", 1)[0] for r in rows if r["photo_url"]}
print(len(rows), "ароматов, с фото:", len(matched))
for stem in sorted(set(photos) - matched):
    print("  не нашёл аромат для фото:", photos[stem].name)
