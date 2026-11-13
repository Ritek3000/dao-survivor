"""
Bereitet das Sor-Symbol auf: Rahmen zuschneiden, Bildrauschen am Rand entfernen und das Favicon erzeugen.

Das Symbol (goldener Kreis mit drei Strahlen, Verlauf von Gold nach Schwarz) liegt als PNG mit durchsichtigem Hintergrund
in public/sor-symbol.png. Der Startbildschirm zeigt diese Datei; aus ihr entsteht auch das Favicon:

  public/favicon.ico   16, 32 und 48 Pixel in einer Datei (fuer die Tabs aller Browser)

Voraussetzungen: Python 3 und Pillow.

  python tools/symbol-erzeugen.py                       public/sor-symbol.png neu zuschneiden, Favicon neu erzeugen
  python tools/symbol-erzeugen.py neues-symbol.png      ein neues Quellbild verwenden (wird nach public/ geschrieben)

Der Aufruf ist wiederholbar: Ein schon zugeschnittenes Bild bleibt unveraendert. Das Favicon ist quadratisch, das
Symbol steht darin mittig und fuellt die Hoehe bis auf einen schmalen Rand.
"""
import argparse
import os
import sys

from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HIER, '..', 'public')
SYMBOL = os.path.join(PUBLIC, 'sor-symbol.png')

# Alles unterhalb dieser Deckkraft (von 255) ist Rauschen vom Zuschneiden im Quellbild, kein Teil des Symbols.
RAUSCHEN = 8
# Rand um das Symbol im quadratischen Favicon, als Anteil der Kantenlaenge (mindestens ein Pixel).
RAND_ANTEIL = 0.04
ICO_GROESSEN = [16, 32, 48]
# Es wird groesser gerechnet und dann verkleinert, das glaettet die Kanten.
UEBERABTASTUNG = 4


def freistellen(bild):
    """Entfernt fast durchsichtige Bildpunkte und schneidet auf die sichtbare Flaeche zu."""
    bild = bild.convert('RGBA')
    r, g, b, a = bild.split()
    maske = a.point(lambda wert: 0 if wert <= RAUSCHEN else 255)
    # Farbe der entfernten Punkte mit auf Null setzen, sonst bleibt ein Schleier im Rand.
    leer = Image.new('RGBA', bild.size, (0, 0, 0, 0))
    bild = Image.composite(bild, leer, maske)
    rahmen = bild.getbbox()
    if rahmen is None:
        sys.exit('Das Bild enthaelt nichts Sichtbares.')
    return bild.crop(rahmen)


def quadrat(symbol, kante):
    """Das Symbol mittig in ein durchsichtiges Quadrat der gegebenen Kantenlaenge setzen."""
    gross = kante * UEBERABTASTUNG
    rand = max(1, round(kante * RAND_ANTEIL)) * UEBERABTASTUNG
    hoehe = gross - 2 * rand
    breite = max(1, round(symbol.width * hoehe / symbol.height))
    if breite > gross - 2 * rand:
        breite = gross - 2 * rand
        hoehe = max(1, round(symbol.height * breite / symbol.width))
    klein = symbol.resize((breite, hoehe), Image.Resampling.LANCZOS)
    flaeche = Image.new('RGBA', (gross, gross), (0, 0, 0, 0))
    flaeche.paste(klein, ((gross - breite) // 2, (gross - hoehe) // 2))
    return flaeche.resize((kante, kante), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('quelle', nargs='?', default=SYMBOL, help='Quellbild (Standard: public/sor-symbol.png)')
    args = parser.parse_args()

    symbol = freistellen(Image.open(args.quelle))
    symbol.save(SYMBOL, optimize=True)
    print(f'sor-symbol.png  {symbol.width} x {symbol.height}')

    # Die Pillow-ICO-Ausgabe verkleinert selbst; deshalb die groesste Fassung uebergeben.
    quadrat(symbol, 256).save(os.path.join(PUBLIC, 'favicon.ico'), sizes=[(k, k) for k in ICO_GROESSEN])
    print('favicon.ico     ' + ', '.join(str(k) for k in ICO_GROESSEN))


if __name__ == '__main__':
    main()
