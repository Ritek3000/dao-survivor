"""Stellt ein Icon frei, das auf flachem Magenta (#FF00FF) erzeugt wurde: Hintergrund -> Alpha, Rand entfaerbt, auf Quadrat zugeschnitten.

Aufruf: python tools/item-icons/freistellen.py EINGABE.png AUSGABE.png [Kantenlaenge=512] [Rand=0.07]
ASCII-only, Pillow, numpy und scipy.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage


def freistellen(src, dst, size=512, margin=0.07):
    img = Image.open(src).convert('RGB')
    rgb = np.asarray(img).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Magenta-Anteil: hoch, wenn Rot und Blau beide deutlich ueber Gruen liegen. Gemaltes Gegenstandsmaterial erreicht das kaum.
    m = np.minimum(r, b) - g
    h, w = m.shape
    # Nur Hintergrund, der mit dem Rand zusammenhaengt: Zufallstreffer im Bild bleiben erhalten.
    cand = m > 70
    labels, count = ndimage.label(cand)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    # Auch grosse, vom Rand abgeschlossene Magenta-Flaechen gehoeren zum Hintergrund (etwa zwischen Bogen und Sehne).
    sizes = ndimage.sum(cand, labels, index=np.arange(1, count + 1))
    big = np.nonzero(sizes > 100)[0] + 1
    bg = np.isin(labels, np.union1d(border[border > 0], big))
    # Weicher Rand: im Grenzbereich Alpha aus dem Magenta-Anteil, nur in Randnaehe des Hintergrunds.
    grow = bg.copy()
    grow = ndimage.binary_dilation(grow, iterations=3)
    alpha = np.ones((h, w), np.float32)
    soft = np.clip(1.0 - (m - 25.0) / 130.0, 0.0, 1.0)
    alpha[grow] = soft[grow]
    alpha[bg & (m > 150)] = 0.0
    # Entfaerben: Magenta-Rest an Randpixeln auf Gruen-Niveau druecken.
    spill = np.clip(m, 0, None) * grow
    r2 = np.clip(r - spill * 0.9, 0, 255)
    b2 = np.clip(b - spill * 0.9, 0, 255)
    out = np.dstack([r2, g, b2, alpha * 255.0]).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    bbox = im.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox is None:
        raise SystemExit('Nichts Sichtbares gefunden: ' + src)
    im = im.crop(bbox)
    side = max(im.size)
    pad = int(side * margin)
    canvas = Image.new('RGBA', (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2 + pad, (side - im.height) // 2 + pad))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas.save(dst)


if __name__ == '__main__':
    a = sys.argv
    freistellen(a[1], a[2], int(a[3]) if len(a) > 3 else 512, float(a[4]) if len(a) > 4 else 0.07)
