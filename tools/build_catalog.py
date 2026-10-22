#!/usr/bin/env python3
"""Собирает каталог из data/price.txt.

Создаёт:
  data/catalog.js      — каталог для демо-режима сайта
  supabase/seed.sql    — тот же каталог для загрузки в Supabase

Запуск: python3 tools/build_catalog.py
"""
import hashlib, json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
rows = []
for line in (root / "data/price.txt").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("#"):
        continue
    house, name, price, loc, tag = (line.split("|") + [""] * 5)[:5]
    # мягкий цвет «жидкости» во флаконе, стабильный для каждого аромата
    h = int(hashlib.md5((house + name).encode()).hexdigest()[:4], 16) % 360
    rows.append({
        "id": hashlib.md5((house + "|" + name).encode()).hexdigest()[:10],
        "house": house.strip(), "name": name.strip(),
        "description": tag.strip(), "price_per_ml": int(price),
        "location": loc.strip(), "min_ml": 2,
        "bottle_price": None, "bottle_volume": None, "ml_left": None,
        "color": f"hsl({h} 38% 52%)", "photo_url": None,
    })

rows.sort(key=lambda r: (r["house"].lower(), r["name"].lower()))
(root / "data/catalog.js").write_text(
    "// Создано tools/build_catalog.py из data/price.txt — правь прайс там.\n"
    "window.CATALOG = " + json.dumps(rows, ensure_ascii=False, indent=0) + ";\n",
    encoding="utf-8")

q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
values = ",\n".join(
    f"({q(r['house'])}, {q(r['name'])}, {q(r['description'] or None)}, {r['price_per_ml']}, "
    f"{q(r['location'] or None)}, {q(r['color'])})" for r in rows)
(root / "supabase/seed.sql").write_text(
    "-- Загрузка прайса в Supabase. Выполни один раз после schema.sql.\n"
    "insert into perfumes (house, name, description, price_per_ml, location, color) values\n"
    + values + ";\n", encoding="utf-8")
print(len(rows), "ароматов")
