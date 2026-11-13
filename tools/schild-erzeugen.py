"""
Erzeugt den Rundschild des Kaempfers als spielfertige GLB-Datei: Modell, Farbtextur, Normalkarte und
Rauheitskarte in einem Atlas, ein Material, gut 3000 Dreiecke.

Der Schild ist ein Rundschild aus senkrechten Eichenbohlen mit Eisenrand und Buckel (die Lore nennt
den Schild bei Ghens Schutzzaubern "Rundschildgroesse"). Auf der Flaeche steht das Sor-Symbol: der Buckel ist
die Sonne, darunter fallen drei Strahlen (siehe EMBLEM). Der Kaempfer kaempft im Licht; das Symbol ist ein
Vorschlag und laesst sich mit EMBLEM = False abschalten.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/schild-erzeugen.py
  blender.exe --background --factory-startup --python tools/schild-erzeugen.py -- ziel.glb

Ohne Pfad wird public/models/ausruestung/schild.glb geschrieben. Das Skript ist deterministisch: Derselbe Aufruf
erzeugt dieselbe Datei. Es laeuft auch als Python-Modul (pip install bpy) und braucht ausser Blender nur numpy,
das Blender mitbringt.

Schildraum (so sitzt der Schild in der Datei, gemessen in Metern):
  Ursprung  Mitte der Griffstange, also dort, wo die Faust zupackt
  +x        rechts, wenn man von vorn auf die Schildflaeche schaut
  +y        oben
  +z        aus der Schildflaeche heraus (die Aussenseite, mit dem Buckel)
Das Spiel haengt den Schild ueber seinen Griffpunkt an den Handknochen (src/game/gear.ts); dort wird festgelegt,
dass +z nach links zeigt. Die Stange laeuft entlang x.

Wer die Gestalt aendern will, aendert die Masse unter "Masse". Wer das Aussehen aendern will, aendert die Farben und
die Funktionen unter "Texturen".
"""
import math
import os
import sys

import bpy
import bmesh  # erst nach bpy: Als Python-Modul meldet sich bmesh erst mit bpy an
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
ZIEL = os.path.normpath(os.path.join(HERE, '..', 'public', 'models', 'ausruestung', 'schild.glb'))

# Das Sor-Symbol auf der Schildflaeche: Der Buckel ist die Sonne, darunter fallen drei Strahlen.
EMBLEM = True

# --- Masse (Meter) -------------------------------------------------------------------------------------------------
R = 0.268            # Halbmesser des Holzes
R_RAND = 0.281       # Halbmesser mit Eisenrand
WOLBUNG = 0.026      # Wie weit die Mitte der Flaeche nach aussen steht (der Schild ist leicht gewoelbt)
Z_MITTE = 0.096      # Hoehe der Vorderseite in der Mitte, vom Griff aus gemessen (das Brett steht 8 cm vor der Stange)
DICKE = 0.016        # Dicke der Bohlen
# Die Griffstange steht 8 cm hinter dem Brett: Die Faust passt dazwischen, und der Unterarm liegt hinter dem Schild
# statt durch ihn hindurch zu ragen, wenn die Figur den Arm haengen laesst.
STANGE_RADIUS = 0.0115
SEGMENTE = 40        # Teilung des Umfangs fuer Holz und Rand
SEGMENTE_BUCKEL = 28

# --- Atlas ---------------------------------------------------------------------------------------------------------
# Vier Viertel: oben links Vorderseite, oben rechts Rueckseite, unten links Eisen, unten rechts Leder und Messing.
ATLAS = 1024
K = 1.1429           # Meter je Atlaseinheit auf den Holzflaechen (Halbmesser 0,28 m passen in ein Viertel)
JPEG_GUETE = 90


def zv(r):
    """Hoehe der Vorderseite des Holzes im Abstand r von der Mitte."""
    return Z_MITTE - WOLBUNG * (min(r, R) / R) ** 2


def zh(r):
    """Hoehe der Rueckseite."""
    return zv(r) - DICKE


# --- Geometrie -----------------------------------------------------------------------------------------------------
def blender_punkt(p):
    """Schildraum (x rechts, y oben, z heraus) nach Blender (z oben); der glTF-Export dreht das zurueck."""
    return Vector((p[0], -p[2], p[1]))


class Bau:
    """Sammelt die Flaechen des Schilds in einem bmesh, mit Texturkoordinaten je Flaechenecke."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.dreiecke = 0
        self.ecken = {}

    def ecke(self, p):
        """Gleiche Punkte teilen sich eine Ecke, sonst waere jede Flaeche flach schattiert."""
        schluessel = (round(p.x, 6), round(p.y, 6), round(p.z, 6))
        if schluessel not in self.ecken:
            self.ecken[schluessel] = self.bm.verts.new(blender_punkt(p))
        return self.ecken[schluessel]

    def flaeche(self, punkte, uvs, hinweis):
        """Eine Flaeche aus Punkten im Schildraum. `hinweis` ist die Richtung, in die ihre Vorderseite zeigen soll."""
        # Doppelte Ecken (Spitze einer Drehflaeche) fallen weg.
        keep = []
        for i, p in enumerate(punkte):
            if keep and (Vector(p) - Vector(punkte[keep[-1]])).length < 1e-7:
                continue
            keep.append(i)
        if len(keep) > 1 and (Vector(punkte[keep[0]]) - Vector(punkte[keep[-1]])).length < 1e-7:
            keep.pop()
        if len(keep) < 3:
            return
        pts = [Vector(punkte[i]) for i in keep]
        uvl = [uvs[i] for i in keep]
        # Normale nach Newell; zeigt sie gegen den Hinweis, wird die Reihenfolge gedreht.
        n = Vector((0, 0, 0))
        for i, a in enumerate(pts):
            b = pts[(i + 1) % len(pts)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        if n.dot(Vector(hinweis)) < 0:
            pts.reverse()
            uvl.reverse()
        verts = [self.ecke(p) for p in pts]
        if len(set(verts)) < len(verts):
            return
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
        f.smooth = True
        for loop, uv in zip(f.loops, uvl):
            loop[self.uv].uv = uv
        self.dreiecke += len(pts) - 2

    def drehkoerper(self, profil, segmente, uv, hinweis, mitte=(0.0, 0.0)):
        """
        Flaechen einer Drehflaeche um die z-Achse. `profil`: Liste (r, z); `uv(t, s, r)`: Texturkoordinaten mit t = Winkel
        als Anteil von 0 bis 1, s = Anteil der Profillaenge und r = Halbmesser der Ecke; `hinweis(mitte)`: Richtung der Vorderseite.
        """
        laengen = [0.0]
        for a, b in zip(profil, profil[1:]):
            laengen.append(laengen[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        gesamt = laengen[-1] or 1.0
        s_an = [x / gesamt for x in laengen]

        def punkt(j, i):
            w = 2 * math.pi * i / segmente
            r, z = profil[j]
            return (mitte[0] + r * math.cos(w), mitte[1] + r * math.sin(w), z)

        for j in range(len(profil) - 1):
            for i in range(segmente):
                ecken = [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]
                punkte = [punkt(a, b) for a, b in ecken]
                uvs = [uv(b / segmente, s_an[a], profil[a][0]) for a, b in ecken]
                c = Vector((0, 0, 0))
                for p in punkte:
                    c += Vector(p) / 4
                self.flaeche(punkte, uvs, hinweis(c))


def atlas_uv(mx, my, x, y, spiegel=False):
    """Planare Abbildung einer Holzflaeche auf ihr Viertel des Atlas."""
    return (mx + (-x if spiegel else x) / K, my + y / K)


def bauen():
    bau = Bau()
    nach_aussen = (0.0, 0.0, 1.0)

    # --- Holzflaechen: Vorderseite und Rueckseite als Ringe um das Griffloch ---
    radien = [0.0, 0.06, 0.10, 0.15, 0.20, 0.24, R]
    for seite, (hoehe, mx, spiegel, hinweis) in {
        'vorn': (zv, 0.25, False, (0, 0, 1)),
        'hinten': (zh, 0.75, True, (0, 0, -1)),
    }.items():
        for a, b in zip(radien, radien[1:]):
            for i in range(SEGMENTE):
                w0 = 2 * math.pi * i / SEGMENTE
                w1 = 2 * math.pi * (i + 1) / SEGMENTE
                ecken = [(a, w0), (a, w1), (b, w1), (b, w0)]
                punkte = [(r * math.cos(w), r * math.sin(w), hoehe(r)) for r, w in ecken]
                uvs = [atlas_uv(mx, 0.75, p[0], p[1], spiegel) for p in punkte]
                bau.flaeche(punkte, uvs, hinweis)

    # --- Eisenrand: ueber die Kante gelegt, vorn und hinten je ein Streifen ---
    vorn = [
        (0.243, zv(0.243) - 0.0006),
        (0.250, zv(0.250) + 0.0046),
        (0.266, zv(0.266) + 0.0054),
        (0.275, zv(R) + 0.0040),
        (0.281, zv(R) + 0.0004),
    ]
    aussen = [(R_RAND, zv(R) - 0.0045), (R_RAND, zh(R) + 0.0045)]
    hinten = [(r, zh(r) - (z - zv(r))) for r, z in reversed(vorn)]
    hinten[0] = (0.281, zh(R) - 0.0004)
    profil_rand = vorn + aussen + hinten
    zentrum_r, zentrum_z = 0.262, (zv(R) + zh(R)) / 2

    def rand_hinweis(c):
        r = math.hypot(c.x, c.y)
        w = Vector((c.x, c.y, 0)) / (r or 1)
        return (w.x * (r - zentrum_r), w.y * (r - zentrum_r), c.z - zentrum_z)

    # Der Eisenstreifen wird gespiegelt abgewickelt (Anfang und Ende am selben Rand), damit am Umfang keine Naht entsteht.
    bau.drehkoerper(profil_rand, SEGMENTE, lambda t, s, r: (0.015 + 0.47 * (1.0 - abs(2.0 * t - 1.0)), 0.015 + 0.17 * s), rand_hinweis)

    # --- Buckel: Flansch und Kuppel, auf das Brett genietet ---
    aussen_profil = [
        (0.110, zv(0.110) - 0.0006),
        (0.110, zv(0.110) + 0.0039),
        (0.100, zv(0.100) + 0.0056),
        (0.082, zv(0.082) + 0.0054),
        (0.077, Z_MITTE + 0.0080),
        (0.074, Z_MITTE + 0.0180),
        (0.068, Z_MITTE + 0.0300),
        (0.056, Z_MITTE + 0.0430),
        (0.040, Z_MITTE + 0.0520),
        (0.022, Z_MITTE + 0.0565),
        (0.008, Z_MITTE + 0.0585),
        (0.000, Z_MITTE + 0.0590),
    ]

    # Der Buckel wird von oben auf das Eisenviertel projiziert; so laufen keine Strahlen zur Spitze zusammen.
    def von_oben(t, s, r):
        return (0.25 + r * math.cos(2 * math.pi * t) / 0.5, 0.25 + r * math.sin(2 * math.pi * t) / 0.5)

    bau.drehkoerper(aussen_profil, SEGMENTE_BUCKEL, von_oben, lambda c: (c.x, c.y, c.z - Z_MITTE + 0.06))

    # --- Nieten: kleine Kuppeln auf Rand und Flansch ---
    def rand_oben(r):
        """Hoehe der Oberseite des Randes bei Halbmesser r (zwischen den beiden mittleren Profilpunkten)."""
        (r0, z0), (r1, z1) = vorn[1], vorn[2]
        return z0 + (z1 - z0) * (r - r0) / (r1 - r0)

    def flansch_oben(r):
        (r0, z0), (r1, z1) = aussen_profil[3], aussen_profil[2]
        return z0 + (z1 - z0) * (r - r0) / (r1 - r0)

    uv_messing = (0.87, 0.25)
    for k in range(16):
        w = 2 * math.pi * (k + 0.5) / 16
        r = 0.258
        z = rand_oben(r)
        niete(bau, r * math.cos(w), r * math.sin(w), z - 0.0004, 0.0068, uv_messing)
    for k in range(8):
        w = 2 * math.pi * (k + 0.5) / 8
        r = 0.093
        z = flansch_oben(r)
        niete(bau, r * math.cos(w), r * math.sin(w), z - 0.0004, 0.0062, uv_messing)

    # --- Griff: Stange mit Lederwicklung, an beiden Enden mit Eisenlaschen am Buckel befestigt ---
    stange(bau)
    return bau


def niete(bau, x, y, z, radius, uv):
    """Eine Nietenkuppel mit Fuss bei (x, y, z); sechs Seiten genuegen bei dieser Groesse."""
    profil = [(radius, z), (radius * 0.74, z + radius * 0.46), (0.0, z + radius * 0.78)]
    bau.drehkoerper(profil, 6, lambda t, s, r: uv, lambda c: (c.x - x, c.y - y, c.z - z + 0.01), mitte=(x, y))


def stange(bau):
    """Die Griffstange liegt entlang x; die Mitte ist mit Leder umwickelt."""
    segmente = 10
    uv_eisen = (0.25, 0.46)
    uv_leder = (0.62, 0.25)

    def zylinder(x0, x1, radius, uv_fun):
        for i in range(segmente):
            w0 = 2 * math.pi * i / segmente
            w1 = 2 * math.pi * (i + 1) / segmente
            ecken = [(x0, w0), (x1, w0), (x1, w1), (x0, w1)]
            punkte = [(x, radius * math.sin(w), radius * math.cos(w)) for x, w in ecken]
            uvs = [uv_fun(x, w) for x, w in ecken]
            mitte = Vector(((x0 + x1) / 2, 0.0, 0.0))
            c = sum((Vector(p) for p in punkte), Vector()) / 4
            bau.flaeche(punkte, uvs, c - mitte)
        # Kappen an den Enden
        for x, richtung in ((x0, -1.0), (x1, 1.0)):
            punkte = [(x, radius * math.sin(2 * math.pi * i / segmente), radius * math.cos(2 * math.pi * i / segmente)) for i in range(segmente)]
            bau.flaeche(punkte, [uv_fun(x, 0.0)] * segmente, (richtung, 0.0, 0.0))

    # Eisenstange von Lasche zu Lasche, darueber das Leder
    zylinder(-0.056, 0.056, 0.0085, lambda x, w: uv_eisen)
    zylinder(-0.036, 0.036, STANGE_RADIUS, lambda x, w: (0.52 + 0.2 * (w / (2 * math.pi)), 0.1 + (x + 0.036) * 4.0))

    # Eisenlaschen: Von den Enden der Stange zum Brett; dazwischen ist Platz fuer die Faust.
    for seite in (-1.0, 1.0):
        x0, x1 = (0.052, 0.062) if seite > 0 else (-0.062, -0.052)
        y0, y1 = -0.014, 0.014
        z0, z1 = -STANGE_RADIUS * 0.7, zh(0.056) + 0.002
        quader(bau, x0, x1, y0, y1, z0, z1, uv_eisen)


def quader(bau, x0, x1, y0, y1, z0, z1, uv):
    ecken = {}
    for ix, x in enumerate((x0, x1)):
        for iy, y in enumerate((y0, y1)):
            for iz, z in enumerate((z0, z1)):
                ecken[(ix, iy, iz)] = (x, y, z)
    flaechen = [
        ((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1), (-1, 0, 0)),
        ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0), (1, 0, 0)),
        ((0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0), (0, -1, 0)),
        ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1), (0, 1, 0)),
        ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, -1)),
        ((0, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0, 1), (0, 0, 1)),
    ]
    for *ks, hinweis in flaechen:
        bau.flaeche([ecken[k] for k in ks], [uv] * 4, hinweis)


# --- Texturen ------------------------------------------------------------------------------------------------------
def hex_farbe(wert):
    return np.array([(wert >> 16) & 255, (wert >> 8) & 255, wert & 255], dtype=np.float64) / 255.0


def rauschen(sx, sy, seed, n=ATLAS):
    """Nahtloses Rauschen, in x und y verschieden weich gerechnet; Streuung rund eins."""
    rng = np.random.default_rng(seed)
    weiss = rng.standard_normal((n, n))
    fx = np.fft.fftfreq(n)[None, :]
    fy = np.fft.fftfreq(n)[:, None]
    filt = np.exp(-2.0 * np.pi ** 2 * ((sx * fx) ** 2 + (sy * fy) ** 2))
    feld = np.fft.ifft2(np.fft.fft2(weiss) * filt).real
    feld -= feld.mean()
    return feld / (feld.std() + 1e-12)


def weich(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mische(a, b, t):
    return a * (1.0 - t[..., None]) + b * t[..., None]


def konvex_maske(punkte, X, Y, pixel):
    """Weiche Maske eines konvexen Vierecks (Punkte gegen den Uhrzeigersinn)."""
    d = np.full(X.shape, 1e9)
    for (ax, ay), (bx, by) in zip(punkte, punkte[1:] + punkte[:1]):
        ex, ey = bx - ax, by - ay
        l = math.hypot(ex, ey)
        d = np.minimum(d, (-(ey) * (X - ax) + ex * (Y - ay)) / l)
    return np.clip(d / pixel + 0.5, 0.0, 1.0)


def holzseite(X, Y, grenzen, farbe_hell, farbe_dunkel, seed, bohlen_seed):
    """
    Farbe, Hoehe und Rauheit einer Bohlenflaeche. X und Y sind Meter in der Ansicht, in der die Textur liegt;
    `grenzen` die x-Lagen der Fugen zwischen den Bohlen. Gibt (farbe, hoehe, fugenabstand) zurueck.
    """
    rng = np.random.default_rng(bohlen_seed)
    index = np.digitize(X, grenzen[1:-1])
    abstand = np.full(X.shape, 1.0)
    for g in grenzen[1:-1]:
        abstand = np.minimum(abstand, np.abs(X - g))
    ton = rng.uniform(-1.0, 1.0, len(grenzen))[index]
    versatz = rng.integers(0, ATLAS, len(grenzen))[index]
    maserung = rauschen(1.0, 38.0, seed) * 0.55 + rauschen(3.5, 110.0, seed + 1) * 0.45
    zeilen = (np.arange(ATLAS)[:, None] + versatz) % ATLAS
    spalten = np.broadcast_to(np.arange(ATLAS)[None, :], zeilen.shape)
    maserung = maserung[zeilen, spalten]
    ringe = np.sin((X * 330.0) + 2.5 * rauschen(14.0, 90.0, seed + 2)) * 0.5
    t = np.clip(0.5 + 0.17 * maserung + 0.07 * ringe + 0.12 * ton, 0.0, 1.0)
    farbe = mische(farbe_dunkel, farbe_hell, t)
    hoehe = -0.0016 * np.exp(-((abstand / 0.0013) ** 2)) + 0.00018 * maserung
    return farbe, hoehe, abstand, ton


def normalen(hoehe, meter_je_pixel, staerke=1.0):
    gy, gx = np.gradient(hoehe, meter_je_pixel)
    n = np.stack([-gx * staerke, -gy * staerke, np.ones_like(hoehe)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def malen():
    """Zeichnet alle Texturen des Atlas. Gibt (farbe, normale, rauheit) als Felder mit Zeile 0 unten zurueck."""
    n = ATLAS
    zeile, spalte = np.mgrid[0:n, 0:n]
    U = (spalte + 0.5) / n
    V = (zeile + 0.5) / n          # Zeile 0 liegt unten, V waechst nach oben
    farbe = np.zeros((n, n, 3))
    hoehe = np.zeros((n, n))
    rauheit = np.full((n, n), 0.8)
    metall = np.zeros((n, n))
    mpp = K / n                    # Meter je Pixel im Holz

    eiche_hell, eiche_dunkel = hex_farbe(0x8f6c47), hex_farbe(0x5a3e24)
    lack, lack_alt = hex_farbe(0x73291f), hex_farbe(0x4f1d17)
    gold = hex_farbe(0xc99e42)

    # Fugen der Bohlen: neun Bohlen mit leicht ungleicher Breite
    rng = np.random.default_rng(7)
    grenzen = np.linspace(-R, R, 10)
    grenzen[1:-1] += rng.uniform(-0.005, 0.005, 8)

    # ---------- Vorderseite: oben links ----------
    vorn = (U < 0.5) & (V >= 0.5)
    X = (U - 0.25) * K
    Y = (V - 0.75) * K
    r = np.hypot(X, Y)
    f, h, d, ton = holzseite(X, Y, grenzen, eiche_hell, eiche_dunkel, 100, 11)

    verschleiss = rauschen(9, 9, 200) * 0.38 + rauschen(2.5, 2.5, 201) * 0.32
    verschleiss += 0.9 * np.exp(-(((np.maximum(r - 0.23, 0)) / 0.022) ** 2)) * (r > 0.23)
    verschleiss += 0.75 * np.exp(-((d / 0.0028) ** 2))
    verschleiss += 0.25 * np.clip((-Y - 0.05) / 0.2, 0, 1)
    abplatzer = weich(0.62, 1.12, verschleiss)
    lackfarbe = mische(lack, lack_alt, np.clip(0.5 + 0.25 * rauschen(30, 30, 202), 0, 1))
    vf = mische(lackfarbe, mische(f * 0.82, hex_farbe(0x7c6c58) * np.ones_like(f), np.full(r.shape, 0.25)), abplatzer)
    vh = h - 0.00035 * (1 - abplatzer)

    if EMBLEM:
        # Drei Strahlen unter dem Buckel, wie im Sor-Symbol; die Sonne ist der Buckel selbst.
        maske = np.zeros(X.shape)
        for winkel in (-90.0 - 24.0, -90.0, -90.0 + 24.0):
            a = math.radians(winkel)
            dx, dy = math.cos(a), math.sin(a)
            px, py = -dy, dx
            innen, aussen = 0.123, 0.218
            pkt = [
                (dx * innen - px * 0.0105, dy * innen - py * 0.0105),
                (dx * aussen - px * 0.0185, dy * aussen - py * 0.0185),
                (dx * aussen + px * 0.0185, dy * aussen + py * 0.0185),
                (dx * innen + px * 0.0105, dy * innen + py * 0.0105),
            ]
            # Gegen den Uhrzeigersinn ordnen
            if ((pkt[1][0] - pkt[0][0]) * (pkt[2][1] - pkt[0][1]) - (pkt[1][1] - pkt[0][1]) * (pkt[2][0] - pkt[0][0])) < 0:
                pkt.reverse()
            maske = np.maximum(maske, konvex_maske(pkt, X, Y, mpp))
        gold_abrieb = weich(0.85, 1.75, verschleiss * 0.7 + rauschen(4, 4, 203) * 0.35)
        goldfarbe = mische(gold, gold * 0.7, np.clip(0.5 + 0.3 * rauschen(20, 20, 204), 0, 1))
        a = maske * (1.0 - gold_abrieb)
        vf = mische(vf, goldfarbe, a)

    # Staub und Verschmutzung: dunkler in den Fugen und am Rand
    schmutz = 1.0 - 0.28 * weich(0.2, 0.27, r) - 0.35 * np.exp(-((d / 0.003) ** 2)) - 0.10 * weich(0.0, 1.5, rauschen(40, 40, 205))
    vf = vf * np.clip(schmutz, 0.3, 1.0)[..., None]
    farbe[vorn] = vf[vorn]
    hoehe[vorn] = vh[vorn]
    rauheit[vorn] = np.clip(0.68 + 0.22 * abplatzer + 0.06 * rauschen(6, 6, 206), 0.3, 1.0)[vorn]

    # ---------- Rueckseite: oben rechts, ungestrichenes dunkles Holz ----------
    hinten = (U >= 0.5) & (V >= 0.5)
    X = (U - 0.75) * K
    Y = (V - 0.75) * K
    r = np.hypot(X, Y)
    f, h, d, ton = holzseite(X, Y, np.sort(-grenzen), eiche_hell * 0.78, eiche_dunkel * 0.8, 300, 12)
    schmutz = 1.0 - 0.38 * weich(0.18, 0.27, r) - 0.32 * np.exp(-((d / 0.003) ** 2)) - 0.18 * weich(0.0, 1.5, rauschen(30, 30, 305))
    farbe[hinten] = (f * np.clip(schmutz, 0.25, 1.0)[..., None])[hinten]
    hoehe[hinten] = h[hinten]
    rauheit[hinten] = np.clip(0.88 + 0.06 * rauschen(5, 5, 306), 0.4, 1.0)[hinten]

    # ---------- Eisen: unten links ----------
    eisen = (U < 0.5) & (V < 0.5)
    grob = rauschen(30, 12, 400)
    fein = rauschen(1.4, 1.4, 401)
    mittel = rauschen(9, 9, 402)
    stahl = hex_farbe(0x7a8594)
    dunkel = hex_farbe(0x2f353d)
    t = np.clip(0.58 + 0.08 * mittel + 0.05 * grob + 0.03 * fein, 0.0, 1.0)
    ef = mische(dunkel, stahl, t)
    rost = weich(2.2, 3.0, rauschen(1.6, 1.6, 403) + 0.5 * mittel)
    ef = mische(ef, hex_farbe(0x6f4326), rost * 0.7)
    farbe[eisen] = ef[eisen]
    hoehe[eisen] = (0.00010 * fein + 0.00008 * mittel)[eisen]
    rauheit[eisen] = np.clip(0.5 + 0.18 * mittel + 0.2 * rost, 0.25, 1.0)[eisen]
    metall[eisen] = 0.0

    # ---------- Leder links, Messing rechts: unten rechts ----------
    leder = (U >= 0.5) & (U < 0.75) & (V < 0.5)
    lf = mische(hex_farbe(0x2f1f14), hex_farbe(0x5b3d28), np.clip(0.5 + 0.22 * rauschen(2, 14, 500) + 0.12 * rauschen(1.2, 1.2, 501), 0, 1))
    # Wicklung: schraeg laufende dunkle Fugen
    streifen = np.abs(np.sin((V * 3.0 + U * 14.0) * 2 * np.pi * 6.0))
    lf = lf * (1.0 - 0.28 * weich(0.8, 1.0, streifen))[..., None]
    farbe[leder] = lf[leder]
    hoehe[leder] = (0.0004 * rauschen(1.5, 1.5, 502) - 0.0006 * weich(0.8, 1.0, streifen))[leder]
    rauheit[leder] = 0.78

    messing = (U >= 0.75) & (V < 0.5)
    mf = mische(hex_farbe(0x7d6128), hex_farbe(0xb08d45), np.clip(0.5 + 0.2 * rauschen(6, 6, 600), 0, 1))
    farbe[messing] = mf[messing]
    hoehe[messing] = (0.0002 * rauschen(2, 2, 601))[messing]
    rauheit[messing] = 0.45

    # Den Rand jedes Viertels mit seiner Randfarbe auffuellen, damit beim Verkleinern keine fremde Farbe hineinblutet
    return farbe, normalen(hoehe, mpp), rauheit, metall


def bilder_anlegen(farbe, normale, rauheit, metall):
    """Legt die drei Bilder in Blender an: Farbe, Normalkarte, und Rauheit/Metall gepackt (G und B wie in glTF)."""
    n = ATLAS

    def bild(name, daten, farbraum, groesse):
        b = bpy.data.images.new(name, groesse, groesse, alpha=False, float_buffer=False)
        b.colorspace_settings.name = farbraum
        rgba = np.ones((groesse, groesse, 4))
        rgba[..., :3] = daten
        b.pixels.foreach_set(rgba.astype(np.float32).ravel())
        b.pack()
        return b

    halb = n // 2
    mr = np.zeros((halb, halb, 3))
    klein = lambda a: a.reshape(halb, 2, halb, 2).mean(axis=(1, 3))
    mr[..., 0] = 1.0
    mr[..., 1] = klein(rauheit)
    mr[..., 2] = klein(metall)
    return (
        bild('schild_farbe', np.clip(farbe, 0, 1), 'sRGB', n),
        bild('schild_normale', np.clip(normale, 0, 1), 'Non-Color', n),
        bild('schild_rauheit', np.clip(mr, 0, 1), 'Non-Color', halb),
    )


def material_anlegen(farbe, normale, rauheit):
    mat = bpy.data.materials.new('Schild')
    mat.use_nodes = True
    baum = mat.node_tree
    for k in list(baum.nodes):
        baum.nodes.remove(k)
    ausgang = baum.nodes.new('ShaderNodeOutputMaterial')
    bsdf = baum.nodes.new('ShaderNodeBsdfPrincipled')
    baum.links.new(bsdf.outputs['BSDF'], ausgang.inputs['Surface'])

    t_farbe = baum.nodes.new('ShaderNodeTexImage')
    t_farbe.image = farbe
    baum.links.new(t_farbe.outputs['Color'], bsdf.inputs['Base Color'])

    t_normale = baum.nodes.new('ShaderNodeTexImage')
    t_normale.image = normale
    nm = baum.nodes.new('ShaderNodeNormalMap')
    baum.links.new(t_normale.outputs['Color'], nm.inputs['Color'])
    baum.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

    t_rauheit = baum.nodes.new('ShaderNodeTexImage')
    t_rauheit.image = rauheit
    teil = baum.nodes.new('ShaderNodeSeparateColor')
    baum.links.new(t_rauheit.outputs['Color'], teil.inputs['Color'])
    baum.links.new(teil.outputs['Green'], bsdf.inputs['Roughness'])
    baum.links.new(teil.outputs['Blue'], bsdf.inputs['Metallic'])
    return mat


def schreibe(ziel):
    ordner = os.path.dirname(ziel)
    os.makedirs(ordner, exist_ok=True)
    felder = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    wunsch = dict(
        filepath=ziel,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='JPEG',
        export_jpeg_quality=JPEG_GUETE,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    bpy.ops.export_scene.gltf(**{k: v for k, v in wunsch.items() if k in felder})


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ziel = os.path.abspath(args[0]) if args else ZIEL
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bau = bauen()
    netz = bpy.data.meshes.new('schild')
    bau.bm.normal_update()
    # Harte Kanten dort, wo zwei Flaechen steil aufeinander treffen (Rand, Flansch, Laschen).
    for kante in bau.bm.edges:
        if len(kante.link_faces) == 2 and kante.calc_face_angle(0.0) > math.radians(38.0):
            kante.smooth = False
    bau.bm.to_mesh(netz)
    bau.bm.free()
    objekt = bpy.data.objects.new('schild', netz)
    bpy.context.scene.collection.objects.link(objekt)

    farbe, normale, rauheit, metall = malen()
    bild_farbe, bild_normale, bild_rauheit = bilder_anlegen(farbe, normale, rauheit, metall)
    objekt.data.materials.append(material_anlegen(bild_farbe, bild_normale, bild_rauheit))

    bpy.ops.object.select_all(action='DESELECT')
    objekt.select_set(True)
    bpy.context.view_layer.objects.active = objekt
    schreibe(ziel)
    print(f'Schild geschrieben: {ziel}  ({bau.dreiecke} Dreiecke)')


if __name__ == '__main__':
    main()
