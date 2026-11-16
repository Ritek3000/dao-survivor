"""Verkleinert die freigestellten 512-px-PNGs auf 256 px und schreibt sie als WebP mit Alpha. ASCII-only, nur Pillow.

Aufruf: python tools/item-icons/webp-erzeugen.py QUELLORDNER ZIELORDNER [Kantenlaenge=256] [Qualitaet=90]
"""
import os
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 256
quality = int(sys.argv[4]) if len(sys.argv) > 4 else 90
os.makedirs(dst, exist_ok=True)
total = 0
for name in sorted(os.listdir(src)):
    if not name.endswith('.png'):
        continue
    im = Image.open(os.path.join(src, name)).convert('RGBA').resize((size, size), Image.LANCZOS)
    out = os.path.join(dst, name[:-4] + '.webp')
    im.save(out, 'WEBP', quality=quality, method=6)
    total += os.path.getsize(out)
print(f'{len(os.listdir(dst))} Dateien, {total / 1024:.0f} KB gesamt')
