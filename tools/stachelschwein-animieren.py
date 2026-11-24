"""
Gibt dem Stachelschwein-Boss seine Animationen: "Stehen" und "Laufen" (Schleifen), "Stachelwurf" und "Stachelwurf2"
(einmalig, mit dem linken und mit dem rechten Arm), "Stachelsalve" und "Tod" (einmalig, bleibt am Ende liegen).

Die Datei kommt aus tools/stachelschwein-rig.py (korrigiertes Rigging, keine Animationen). Dieses Skript legt die
Bewegungen am Skelett an (Beine per Zwei-Glieder-Rechnung auf dem Boden gehalten, der Rest aus Wellen und Schluesselkurven,
nicht von Hand gesetzt) und schreibt eine neue GLB mit den Animationen. Mesh, Skelett und Texturen bleiben, wie sie sind.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/stachelschwein-animieren.py -- quelle.glb ziel.glb

Ohne Pfade wird modelle-original/stachelschwein-rig.glb gelesen und public/models/stachelschwein.glb geschrieben.

Wer die Bewegung aendern will, aendert die Zahlen in stehen(), laufen(), stachelwurf(), stachelsalve() und tod(); jede Zeile
steht fuer einen Knochen und sagt, was er tut. Die Winkel sind in Grad und beziehen sich auf die Achsen der Figur, nicht auf die
Achsen des einzelnen Knochens (die sind bei Meshy beliebig gedreht): Die Figur schaut nach -Y (in der GLB: +Z), x = nach vorn
beugen, y = zur Seite neigen (positiv = nach +x), z = um die Hochachse drehen (positiv = nach links). Arme zeigen mit
Zielrichtungen als (seite, vor, oben); `seite` gilt fuer den Arm auf der +x-Seite und wird fuer die Gegenseite gespiegelt.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
FPS = 30

# --- Zeiten und Strecken, die das Spiel kennt (src/config.ts, CONFIG.stachelboss) -------------------------------
# Dauer einer Schleife des Laufens: ein voller Schritt jedes Beins. Das Spiel spielt sie nicht nach der Zeit, sondern nach
# der Strecke ab (model.stride): stride = LAUF_STRECKE * Groesse im Spiel / Groesse in der Datei (1,7 m). Zu kurz gewaehlt,
# rutschen die Fuesse.
LAUFEN_SEKUNDEN = 1.0
LAUF_STRECKE = 0.9
# Anteil der Schleife, in dem ein Fuss am Boden steht; den Rest schwingt er nach vorn. Beim Schreiten sind immer mindestens
# zwei Fuesse unten.
STAND = 0.7
# Phasen der vier Beine (Seitengang: hinten links, vorn links, hinten rechts, vorn rechts). Links ist +x.
PHASEN = {('hinten', 1): 0.0, ('vorn', 1): 0.25, ('hinten', -1): 0.5, ('vorn', -1): 0.75}

# Stachelwurf: Dauer und Augenblick, in dem der Stachel die Hand verlaesst (CONFIG.stachelboss.wurf.releaseAt). Davor greift die
# Hand in den Ruecken und holt aus (der Spieler sieht es), danach faengt der Arm sich wieder.
WURF_SEKUNDEN = 0.9
WURF_LOSLASSEN = 0.52
# Stachelsalve: Dauer und die Zeit, ab der die Stacheln den Ruecken verlassen (CONFIG.stachelboss.salve.launchAt).
SALVE_SEKUNDEN = 2.0
SALVE_START = 0.75
# Tod: Dauer bis zum Liegen.
TOD_SEKUNDEN = 1.9

# --- Knochen nach ihrer Aufgabe (die Namen stammen von Meshys Autorig, Arme von tools/stachelschwein-rig.py) ---------
BECKEN = 'Bone_000'
RUMPF = ['Bone_002', 'Bone_001']
BRUST = 'Bone_005'
HALS = 'Bone_004'
KOPF = 'Bone_003'
# Die Stachelmaehne ist bei Meshy eine Kette am Kopf: erst die Schulterpartie, dann der Ruecken, am Ende die Spitzen.
MAEHNE = ['Bone_023', 'Bone_022', 'Bone_021', 'Bone_020', 'Bone_019', 'Bone_018']
ARME = {
    1: {'schulter': 'Arm_L_Schulter', 'oberarm': 'Arm_L_Oberarm', 'unterarm': 'Arm_L_Unterarm', 'hand': 'Arm_L_Hand'},
    -1: {'schulter': 'Arm_R_Schulter', 'oberarm': 'Arm_R_Oberarm', 'unterarm': 'Arm_R_Unterarm', 'hand': 'Arm_R_Hand'},
}
# Je Bein: Oberschenkel (ein oder mehr starr verbundene Knochen), Unterschenkel, Mittelfuss (das Sprunggelenk sitzt an seinem
# Kopf), Fuss, Zehen; `knick` ist die Richtung, in die das Knie knickt (x = zur Seite, y = nach hinten, z = nach oben).
BEINE = {
    ('hinten', 1): {'ober': ['Bone_011'], 'unter': ['Bone_010'], 'mittel': ['Bone_009'], 'fuss': 'Bone_008', 'zeh': 'Bone_007', 'knick': None},
    ('hinten', -1): {'ober': ['Bone_017'], 'unter': ['Bone_016'], 'mittel': ['Bone_015'], 'fuss': 'Bone_014', 'zeh': 'Bone_013', 'knick': None},
    ('vorn', 1): {'ober': ['Bone_028', 'Bone_027'], 'unter': ['Bone_026'], 'mittel': ['Bone_025'], 'fuss': 'Bone_024', 'zeh': 'Bone_036', 'knick': (0.25, 0.95, 0.0)},
    ('vorn', -1): {'ober': ['Bone_033', 'Bone_032'], 'unter': ['Bone_031'], 'mittel': ['Bone_030'], 'fuss': 'Bone_029', 'zeh': 'Bone_045', 'knick': (-0.25, 0.95, 0.0)},
}


class Haltung:
    """Eine Pose als Abweichung von der Ruhepose: Drehungen in Grad, Verschiebung des Beckens in Metern, Beine am Fuss."""

    def __init__(self):
        self.drehung = {}
        self.versatz = [0.0, 0.0, 0.0]
        self.ziele = {}
        self.beine = {}
        # 0 = die Beine folgen ihrer Fusshaltung (am Boden), 1 = sie folgen nur den Drehungen (Fallen, Liegen); dazwischen Ueberblendung.
        self.frei = 0.0

    def drehe(self, knochen, x=0.0, y=0.0, z=0.0):
        d = self.drehung.setdefault(knochen, [0.0, 0.0, 0.0])
        d[0] += x
        d[1] += y
        d[2] += z

    def verschiebe(self, x=0.0, y=0.0, z=0.0):
        """Verschiebt das Becken und damit den ganzen Koerper (x = zur Seite, y = nach hinten, z = nach oben)."""
        self.versatz[0] += x
        self.versatz[1] += y
        self.versatz[2] += z

    def richte(self, knochen, richtung, gewicht=1.0):
        """Der Knochen zeigt in der Welt in `richtung` (x = zur Seite, y = nach hinten, z = nach oben), mit `gewicht` 0 bis 1."""
        self.ziele[knochen] = (Vector(richtung).normalized(), gewicht)

    def setze_fuss(self, schluessel, vor, hoch, mittelfuss=0.0, fuss=0.0, zeh=0.0, aussen=0.0):
        """
        Stellt den Fuss eines Beins: `vor` und `hoch` in Metern gegenueber der Ruhepose (vor = nach vorn, hoch = nach oben,
        `aussen` = zur Seite hin), `mittelfuss` neigt den Mittelfuss, `fuss` die Sohle (positiv = Zehen nach unten), `zeh`
        die Zehen, alles in Grad.
        """
        self.beine[schluessel] = (vor, hoch, aussen, mittelfuss, fuss, zeh)

    def bewegt(self):
        namen = set(self.drehung) | set(self.ziele)
        for schluessel in self.beine:
            bein = BEINE[schluessel]
            namen |= {*bein['ober'], *bein['unter'], *bein['mittel'], bein['fuss'], bein['zeh']}
        return namen


def weich(von, bis, x):
    """Sanfter Anstieg von 0 auf 1 zwischen `von` und `bis`."""
    t = min(1.0, max(0.0, (x - von) / (bis - von)))
    return t * t * (3.0 - 2.0 * t)


def verlauf(t, schluessel):
    """
    Kurve durch Schluessel (Zeit, Wert, haelt); der Wert darf eine Zahl oder ein Tupel sein. Die Kurve laeuft glatt durch die
    Schluessel (Hermite-Kurve mit Tangenten aus den Nachbarn). An einem Schluessel mit `haelt` steht die Bewegung dagegen
    still: Dort ruht der Koerper kurz (Ausholen, Ende des Wurfs), statt durchzuschwingen.
    """
    if t <= schluessel[0][0]:
        return schluessel[0][1]
    if t >= schluessel[-1][0]:
        return schluessel[-1][1]
    i = 0
    while t > schluessel[i + 1][0]:
        i += 1
    ist_zahl = not isinstance(schluessel[0][1], tuple)

    def werte(j):
        v = schluessel[j][1]
        return (v,) if ist_zahl else v

    def tangente(j):
        if schluessel[j][2] or j == 0 or j == len(schluessel) - 1:
            return [0.0] * len(werte(j))
        dt = schluessel[j + 1][0] - schluessel[j - 1][0]
        return [(b - a) / dt for a, b in zip(werte(j - 1), werte(j + 1))]

    t0, t1 = schluessel[i][0], schluessel[i + 1][0]
    u = (t - t0) / (t1 - t0)
    h00, h10, h01, h11 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2, u**3 - u**2
    m0, m1 = tangente(i), tangente(i + 1)
    antwort = tuple(
        h00 * a + h10 * (t1 - t0) * ma + h01 * b + h11 * (t1 - t0) * mb
        for a, b, ma, mb in zip(werte(i), werte(i + 1), m0, m1)
    )
    return antwort[0] if ist_zahl else antwort


def kurve(zeiten, werte, haelt=None):
    """Schluessel aus Zeiten und Werten; `haelt` (gleich lang) markiert Schluessel, an denen die Bewegung steht (Vorgabe: alle)."""
    haelt = haelt if haelt is not None else [True] * len(zeiten)
    return [(t, w, h) for t, w, h in zip(zeiten, werte, haelt)]


def lerp(a, b, u):
    return a + (b - a) * u


def lerp3(a, b, u):
    return tuple(lerp(x, y, u) for x, y in zip(a, b))


# ------------------------------------------------------------------------------------------------------------
# Gemeinsame Bausteine
# ------------------------------------------------------------------------------------------------------------

# Wohin ein Arm zeigt, als (seite, vor, oben): in der Ruhepose hangen die Arme schraeg nach aussen, die Haende vor dem Koerper.
ARM_RUHE = {
    'oberarm': (0.95, 0.19, -0.30),
    'unterarm': (0.37, 0.53, -0.77),
    'hand': (0.60, 0.55, -0.70),
}
# Die Arme beim Laufen: etwas naeher am Koerper, die Haende hangen vor der Brust.
ARM_TRAGEN = {
    'oberarm': (0.70, 0.12, -0.70),
    'unterarm': (0.25, 0.55, -0.80),
    'hand': (0.20, 0.55, -0.80),
}


def fuesse_stehen(h, anhebung=0.0, mittel=0.0, sohle=0.0):
    """Alle vier Fuesse stehen an ihrem Platz der Ruhepose."""
    for schluessel in BEINE:
        h.setze_fuss(schluessel, 0.0, anhebung, mittelfuss=mittel, fuss=sohle)


def arme_richten(h, seite, nach, gewicht=1.0):
    """Der Arm einer Seite zeigt in den Richtungen aus `nach` (seite, vor, oben); fuer die Gegenseite wird gespiegelt."""
    arm = ARME[seite]
    for name in ('oberarm', 'unterarm', 'hand'):
        s, vor, oben = nach[name]
        h.richte(arm[name], (s * seite, -vor, oben), gewicht)


def maehne_schwingen(h, t, amplitude, takt, verzug=0.45, phase=0.0, quer=0.6):
    """Die Stachelmaehne schwingt: je weiter hinten in der Kette, desto spaeter und weiter."""
    for k, knochen in enumerate(MAEHNE):
        a = amplitude * (0.5 + 0.35 * k)
        h.drehe(knochen, x=a * math.sin(takt * t - verzug * k + phase), y=quer * a * math.sin(takt * t * 0.5 - verzug * k + phase + 1.1))


# ------------------------------------------------------------------------------------------------------------
# Stehen
# ------------------------------------------------------------------------------------------------------------

def stehen(t):
    """Er steht und atmet, die Maehne zittert leicht, die Arme pendeln kaum."""
    sin = math.sin
    p = (t / STEHEN_SEKUNDEN) % 1.0
    ph = 2.0 * math.pi * p
    h = Haltung()
    fuesse_stehen(h)
    # Das Gewicht wandert ein wenig von Seite zu Seite, der Brustkorb hebt und senkt sich.
    h.verschiebe(x=0.012 * sin(ph), z=-0.018 + 0.010 * sin(2 * ph))
    h.drehe(BECKEN, y=0.8 * sin(ph + 0.4))
    for k, knochen in enumerate(RUMPF):
        h.drehe(knochen, x=0.6 * sin(2 * ph - 0.4 * k), y=-0.5 * sin(ph + 0.4))
    h.drehe(BRUST, x=0.9 * sin(2 * ph - 1.0), y=0.7 * sin(ph - 0.3))
    h.drehe(HALS, x=0.8 * sin(2 * ph - 1.5), z=1.4 * sin(ph - 0.8))
    h.drehe(KOPF, x=0.8 * sin(2 * ph - 1.9), z=1.0 * sin(ph - 1.0))
    maehne_schwingen(h, t, 0.8, 2 * math.pi * 2.0 / STEHEN_SEKUNDEN, verzug=0.5)
    for seite, arm in ARME.items():
        pendel = sin(ph + (0.0 if seite == 1 else math.pi))
        for name in ('oberarm', 'unterarm', 'hand'):
            s, vor, oben = ARM_RUHE[name]
            richtung = (s, vor + 0.03 * pendel, oben)
            h.richte(arm[name], (richtung[0] * seite, -richtung[1], richtung[2]), 1.0)
    return h


STEHEN_SEKUNDEN = 3.0


# ------------------------------------------------------------------------------------------------------------
# Laufen
# ------------------------------------------------------------------------------------------------------------

def fussbahn(p, hoehe):
    """
    Wo der Fuss in der Schleife steht, p = 0 bis 1 ab dem Aufsetzen. Gibt zurueck: vor (Meter, Abstand von der Ruhelage), hoch (Meter),
    Neigung des Mittelfusses und der Sohle (Grad). `hoehe` ist die Schritthoehe in Metern.

    Im Stand wandert der Fuss mit der Geschwindigkeit des Bodens nach hinten (LAUF_STRECKE je Schleife), sonst rutscht er.
    Im Schwung faehrt er mit einer Kurve nach vorn, die in der Geschwindigkeit des Bodens anfaengt und endet.
    """
    breite = LAUF_STRECKE * STAND
    if p < STAND:
        u = p / STAND
        vor = breite * (0.5 - u)
        sohle = -8.0 * (1.0 - weich(0.0, 0.2, u)) + 20.0 * weich(0.8, 1.0, u)
        return vor, 0.012 * weich(0.8, 1.0, u), 4.0 * weich(0.75, 1.0, u), sohle
    u = (p - STAND) / (1.0 - STAND)
    m = -LAUF_STRECKE * (1.0 - STAND)
    h00, h10, h01, h11 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2, u**3 - u**2
    vor = h00 * (-0.5 * breite) + h10 * m + h01 * (0.5 * breite) + h11 * m
    hoch = 0.012 * (1.0 - weich(0.0, 0.3, u)) + hoehe * math.sin(math.pi * u) ** 1.3
    sohle = 20.0 * (1.0 - weich(0.0, 0.3, u)) - 8.0 * weich(0.6, 1.0, u) - 16.0 * math.sin(math.pi * u) ** 2
    mittel = 4.0 * (1.0 - weich(0.0, 0.3, u)) - 10.0 * math.sin(math.pi * u) ** 1.2
    return vor, hoch, mittel, sohle


def laufen(t):
    """Eine Schleife des Laufens: schwerer Schritt auf allen vieren, der Ruecken wiegt sich, die Arme pendeln, die Maehne wippt nach."""
    sin, cos = math.sin, math.cos
    p = (t / LAUFEN_SEKUNDEN) % 1.0
    ph = 2.0 * math.pi * p
    h = Haltung()
    for schluessel, versatz in PHASEN.items():
        vor, hoch, mittel, sohle = fussbahn((p + versatz) % 1.0, 0.085 if schluessel[0] == 'hinten' else 0.075)
        h.setze_fuss(schluessel, vor, hoch, mittelfuss=mittel, fuss=sohle)
    # Der Koerper senkt sich ein Stueck, damit die Beine bei grossen Schritten reichen; er hebt sich zweimal je Schleife.
    h.verschiebe(x=0.020 * sin(ph + 0.5), y=-0.014 * cos(2 * ph + 0.4), z=-0.075 + 0.016 * cos(2 * ph - 0.6))
    h.drehe(BECKEN, y=1.8 * sin(ph + 0.5), z=3.0 * sin(ph), x=0.8 * sin(2 * ph))
    for k, knochen in enumerate(RUMPF):
        h.drehe(knochen, z=-2.0 * sin(ph - 0.2 * k), y=-1.2 * sin(ph + 0.5), x=0.9 * sin(2 * ph - 0.6 - 0.3 * k))
    h.drehe(BRUST, z=-3.0 * sin(ph - 0.5), y=-1.2 * sin(ph + 0.4), x=1.4 * sin(2 * ph - 1.0))
    h.drehe(HALS, z=2.5 * sin(ph - 0.7), x=2.0 * sin(2 * ph - 1.5) + 2.0)
    h.drehe(KOPF, z=1.5 * sin(ph - 1.0), x=2.0 * sin(2 * ph - 2.0) - 1.5)
    maehne_schwingen(h, t, 1.6, 4.0 * math.pi / LAUFEN_SEKUNDEN, verzug=0.55, quer=0.7)
    # Arme: gegenlaeufig zu den Vorderbeinen, schwer; sie tragen die Haende vor der Brust.
    for seite, arm in ARME.items():
        gegen = sin(ph + 0.25 * 2 * math.pi + (math.pi if seite == 1 else 0.0))
        h.drehe(arm['schulter'], x=-1.5 * gegen)
        for name in ('oberarm', 'unterarm', 'hand'):
            s, vor, oben = ARM_TRAGEN[name]
            spaet = {'oberarm': 0.0, 'unterarm': -0.5, 'hand': -0.9}[name]
            wippe = sin(ph + 0.25 * 2 * math.pi + (math.pi if seite == 1 else 0.0) + spaet)
            h.richte(arm[name], (s * seite, -(vor + {'oberarm': 0.20, 'unterarm': 0.16, 'hand': 0.12}[name] * wippe), oben), 1.0)
    return h


# ------------------------------------------------------------------------------------------------------------
# Stachelwurf: in den Ruecken greifen, einen Stachel herausziehen, ausholen und werfen
# ------------------------------------------------------------------------------------------------------------

# Die Schluessel gelten fuer alle Kurven: Ruhe, Griff in den Ruecken (die Hand liegt zwischen den Stacheln), Stachel gezogen und
# ausgeholt (steht kurz), Wurf (hier ist die Bewegung am schnellsten, der Stachel verlaesst die Hand), Nachschwung (steht), Ruhe.
WURF_ZEITEN = (0.00, 0.20, 0.36, WURF_LOSLASSEN, 0.68, WURF_SEKUNDEN)
WURF_HAELT = (True, False, True, False, True, True)


def wurf_kurve(werte):
    return kurve(WURF_ZEITEN, werte, WURF_HAELT)


# Wohin der Wurfarm zeigt, als (seite, vor, oben). Ruhe: ARM_RUHE.
WURF_OBERARM = wurf_kurve([ARM_RUHE['oberarm'], (0.55, -0.45, 0.52), (0.60, -0.55, 0.45), (0.40, 0.78, 0.48), (0.55, 0.45, -0.70), ARM_RUHE['oberarm']])
WURF_UNTERARM = wurf_kurve([ARM_RUHE['unterarm'], (-0.45, -0.65, 0.50), (-0.35, -0.80, 0.42), (0.20, 0.95, 0.25), (0.35, 0.60, -0.70), ARM_RUHE['unterarm']])
WURF_HAND = wurf_kurve([ARM_RUHE['hand'], (-0.40, -0.70, 0.45), (-0.30, -0.85, 0.38), (0.10, 0.95, 0.20), (0.30, 0.60, -0.72), ARM_RUHE['hand']])
# Koerperkurven in Grad: Beugung des Rumpfes (positiv = nach vorn), Drehung der Schultern zum Wurfarm (positiv = Schulter des Wurfarms
# geht zurueck), Neigung zur Seite des Wurfarms.
WURF_BEUGUNG = wurf_kurve([0.0, -3.0, -5.0, 6.0, 3.0, 0.0])
WURF_DREHUNG = wurf_kurve([0.0, 6.0, 12.0, -10.0, -4.0, 0.0])
WURF_NEIGUNG = wurf_kurve([0.0, 3.0, 5.0, -2.0, 0.0, 0.0])
WURF_KOPF = wurf_kurve([0.0, -8.0, -4.0, 4.0, 0.0, 0.0])


def stachelwurf_seite(t, seite):
    sin = math.sin
    h = Haltung()
    fuesse_stehen(h)
    beugung = verlauf(t, WURF_BEUGUNG)
    drehung = verlauf(t, WURF_DREHUNG) * seite
    neigung = verlauf(t, WURF_NEIGUNG) * seite
    # Er steht fest, das Becken geht beim Wurf ein wenig mit.
    h.verschiebe(y=-0.02 * weich(0.3, WURF_LOSLASSEN, t) * (1.0 - weich(0.6, 0.9, t)), z=-0.065 - 0.015 * weich(0.0, 0.3, t) * (1.0 - weich(0.5, 0.8, t)))
    h.drehe(BECKEN, z=0.2 * drehung, x=0.2 * beugung)
    for knochen in RUMPF:
        h.drehe(knochen, x=beugung * 0.25, y=neigung * 0.25, z=0.3 * drehung)
    h.drehe(BRUST, x=beugung * 0.35, y=neigung * 0.35, z=0.5 * drehung)
    h.drehe(HALS, x=0.5 * verlauf(t, WURF_KOPF), z=-0.3 * drehung)
    h.drehe(KOPF, x=0.5 * verlauf(t, WURF_KOPF), z=-0.4 * drehung)
    # Die Maehne schlaegt nach dem Griff und dem Wurf aus.
    ruck = sin(26.0 * t) * weich(0.14, 0.2, t) * (1.0 - weich(0.3, 0.46, t)) + 0.8 * sin(24.0 * t) * weich(WURF_LOSLASSEN - 0.03, WURF_LOSLASSEN + 0.03, t) * (1.0 - weich(0.62, 0.84, t))
    for k, knochen in enumerate(MAEHNE):
        h.drehe(knochen, x=(1.0 + 0.7 * k) * ruck, y=(0.6 + 0.3 * k) * ruck * seite)
    # Wurfarm: Die Zielrichtungen kommen aus den Kurven (fuer die +x-Seite, bei -x gespiegelt).
    arm = ARME[seite]
    stoss = weich(0.3, WURF_LOSLASSEN, t) * (1.0 - weich(0.6, 0.8, t))
    h.drehe(arm['schulter'], x=-6.0 * stoss, y=-seite * 6.0 * weich(0.0, 0.2, t) * (1.0 - weich(0.4, WURF_LOSLASSEN, t)))
    for name, kurve_arm in (('oberarm', WURF_OBERARM), ('unterarm', WURF_UNTERARM), ('hand', WURF_HAND)):
        s, vor, oben = verlauf(t, kurve_arm)
        h.richte(arm[name], (s * seite, -vor, oben), 1.0)
    # Der andere Arm haelt das Gleichgewicht: Er geht beim Wurf ein Stueck zur Seite.
    anderer = ARME[-seite]
    h.drehe(anderer['schulter'], x=2.0 * verlauf(t, WURF_BEUGUNG) / 6.0)
    for name in ('oberarm', 'unterarm', 'hand'):
        s, vor, oben = ARM_RUHE[name]
        gleich = weich(0.1, 0.4, t) * (1.0 - weich(0.7, 0.9, t))
        h.richte(anderer[name], (lerp(s, s * 1.15, gleich) * -seite, -lerp(vor, vor * 0.4, gleich), oben), 1.0)
    return h


def stachelwurf(t):
    return stachelwurf_seite(t, 1)


def stachelwurf2(t):
    return stachelwurf_seite(t, -1)


# ------------------------------------------------------------------------------------------------------------
# Stachelsalve: Er bockt, die Arme gehen auf, und er schuettelt den Ruecken, bis die Stacheln fliegen
# ------------------------------------------------------------------------------------------------------------

def stachelsalve(t):
    """Aufrichten (steht), den Ruecken ausschuetteln (Stacheln fliegen ab SALVE_START), sich wieder setzen."""
    sin, cos = math.sin, math.cos
    h = Haltung()
    auf = weich(0.0, 0.5, t) * (1.0 - weich(1.55, 2.0, t))
    # Je staerker er schuettelt, desto mehr bebt der ganze Koerper (Abklingen nach dem Hoehepunkt).
    schuettel = weich(0.45, 0.7, t) * (1.0 - weich(1.3, 1.85, t))
    takt = 2.0 * math.pi * 7.5
    fuesse_stehen(h)
    h.verschiebe(z=-0.11 * auf + 0.012 * sin(takt * t) * schuettel, x=0.012 * sin(takt * 0.5 * t) * schuettel)
    # Er richtet sich auf: Brust und Hals nach oben, der Kopf in den Nacken, die Vorderbeine bleiben stehen.
    h.drehe(BECKEN, x=-1.0 * auf, z=2.5 * sin(takt * t + 0.3) * schuettel)
    for k, knochen in enumerate(RUMPF):
        h.drehe(knochen, x=-1.5 * auf, z=(4.0 + 1.5 * k) * sin(takt * t - 0.5 * k) * schuettel, y=1.5 * sin(takt * 0.5 * t) * schuettel)
    h.drehe(BRUST, x=-5.0 * auf, z=5.5 * sin(takt * t - 1.0) * schuettel, y=2.0 * sin(takt * 0.5 * t - 0.4) * schuettel)
    h.drehe(HALS, x=-11.0 * auf, z=3.0 * sin(takt * t - 1.6) * schuettel)
    h.drehe(KOPF, x=-13.0 * auf, z=3.5 * sin(takt * t - 2.0) * schuettel)
    # Die Maehne peitscht im Takt des Schuettelns hin und her, vom Ansatz bis zu den Spitzen mit wachsendem Ausschlag.
    for k, knochen in enumerate(MAEHNE):
        a = (2.5 + 2.2 * k) * schuettel + 1.0 * auf
        h.drehe(knochen, x=a * sin(takt * t - 0.7 * k) * 0.8 - 2.0 * auf, y=a * sin(takt * t - 0.7 * k + 1.2))
    # Die Arme gehen weit auf und zittern mit.
    for seite, arm in ARME.items():
        zittern = sin(takt * t + (0.0 if seite == 1 else 1.7)) * schuettel
        h.drehe(arm['schulter'], x=-4.0 * auf, y=-seite * 6.0 * auf)
        for name, ziel in (('oberarm', (1.0, -0.15, 0.20)), ('unterarm', (0.70, -0.10, -0.55)), ('hand', (0.60, 0.20, -0.70))):
            s, vor, oben = lerp3(ARM_RUHE[name], ziel, auf)
            h.richte(arm[name], (s * seite, -(vor + 0.05 * zittern), oben + 0.04 * zittern), 1.0)
    return h


# ------------------------------------------------------------------------------------------------------------
# Tod: er taumelt, bricht ein und kippt auf die Seite
# ------------------------------------------------------------------------------------------------------------

def tod(t):
    """Taumeln (Brust sackt nach vorn), die Beine geben nach, Zusammenbrechen auf den Bauch, halb auf die linke Seite kippen."""
    sin = math.sin
    h = Haltung()
    taumeln = weich(0.0, 0.45, t)
    sacken = weich(0.30, 1.15, t)
    kippen = weich(0.70, 1.45, t)
    liegen = weich(1.20, 1.9, t)
    # Die Fuesse bleiben am Boden und rutschen dabei nach aussen und nach vorn, waehrend der Koerper einsackt; die Beine knicken so
    # von selbst ein (Zwei-Glieder-Rechnung). Hinten ziehen sie unter den Leib, vorn rutschen sie nach vorn weg.
    gleiten = weich(0.25, 1.30, t)
    for schluessel in BEINE:
        vorn = schluessel[0] == 'vorn'
        seite = schluessel[1]
        links_unten = seite == 1  # die linke Seite liegt am Ende unten
        vor = (0.30 if vorn else 0.22) * gleiten
        aussen = (0.26 if vorn else 0.18) * gleiten * (1.2 if links_unten else 0.8)
        hoch = 0.0 if links_unten else 0.05 * kippen
        h.setze_fuss(schluessel, vor, hoch, aussen=aussen, mittelfuss=-8.0 * gleiten, fuss=-10.0 * gleiten, zeh=0.0)
    # Wuchtig: ein Ruck nach vorn, dann geht der Koerper in die Knie und sinkt auf den Bauch.
    h.verschiebe(x=0.05 * kippen, y=-0.06 * taumeln * (1.0 - kippen) - 0.10 * sacken, z=-0.05 * taumeln - 0.40 * sacken)
    h.drehe(BECKEN, y=34.0 * kippen + 2.0 * sin(14.0 * t) * taumeln * (1.0 - kippen), x=-6.0 * sacken + 6.0 * taumeln * (1.0 - liegen))
    for k, knochen in enumerate(RUMPF):
        h.drehe(knochen, x=4.0 * taumeln + 3.0 * sacken, z=-6.0 * kippen, y=3.0 * kippen)
    h.drehe(BRUST, x=8.0 * taumeln + 6.0 * sacken - 4.0 * liegen, z=-9.0 * kippen, y=5.0 * kippen)
    h.drehe(HALS, x=-6.0 * taumeln + 18.0 * sacken, z=12.0 * kippen)
    h.drehe(KOPF, x=-8.0 * taumeln + 14.0 * sacken + 8.0 * liegen, z=14.0 * kippen)
    # Die Arme fallen: erst hoch (Schreck), dann schlaff nach vorn und aussen auf den Boden.
    for seite, arm in ARME.items():
        hoch = sin(math.pi * weich(0.0, 0.55, t)) * (1.0 - weich(0.55, 0.9, t))
        schlaff = weich(0.5, 1.4, t)
        for name, ziel, ziel_liegen in (
            ('oberarm', (0.95, -0.10, 0.45), (0.80, 0.55, -0.25)),
            ('unterarm', (0.60, 0.10, -0.50), (0.55, 0.80, -0.50)),
            ('hand', (0.50, 0.30, -0.70), (0.55, 0.80, -0.55)),
        ):
            s, vor, oben = lerp3(ARM_RUHE[name], ziel, hoch)
            s, vor, oben = lerp3((s, vor, oben), ziel_liegen, schlaff * (1.0 - hoch))
            h.richte(arm[name], (s * seite, -vor, oben), 1.0)
    # Die Maehne sackt zusammen und schwingt noch einmal nach.
    for k, knochen in enumerate(MAEHNE):
        h.drehe(knochen, x=(8.0 + 3.0 * k) * kippen + (3.0 + 2.0 * k) * sin(10.0 * t - 0.8 * k) * taumeln * (1.0 - liegen), y=(2.0 + k) * sin(8.0 * t - k) * taumeln * (1.0 - liegen))
    return h


# Name, Dauer in Sekunden, Haltung zur Zeit t, Boden (von, bis): ab wann der Koerper auf den Boden gelegt wird (None = Fuesse tragen ihn)
CLIPS = [
    ('Stehen', STEHEN_SEKUNDEN, stehen, None),
    ('Laufen', LAUFEN_SEKUNDEN, laufen, None),
    ('Stachelwurf', WURF_SEKUNDEN, stachelwurf, None),
    ('Stachelwurf2', WURF_SEKUNDEN, stachelwurf2, None),
    ('Stachelsalve', SALVE_SEKUNDEN, stachelsalve, None),
    ('Tod', TOD_SEKUNDEN, tod, (0.95, 1.40)),
]


# ------------------------------------------------------------------------------------------------------------
# Das Skelett auf die Haltung stellen
# ------------------------------------------------------------------------------------------------------------

# Richtung jedes Knochens in der Ruhepose als (seite, vor, oben); gesetzt in lese_skelett().
ruhe_richtungen = {}


def lese_skelett(arm):
    """Merkt sich die Ruhelage jedes Knochens."""
    ruhe_richtungen.clear()
    for bone in arm.data.bones:
        achse = (bone.tail_local - bone.head_local).normalized()
        ruhe_richtungen[bone.name] = (achse.x, -achse.y, achse.z)


def ruhelage(arm):
    """Ausrichtung jedes Knochens in der Ruhepose, im Raum der Figur."""
    return {bone.name: bone.matrix_local.to_quaternion() for bone in arm.data.bones}


def knochen_nach_tiefe(arm):
    """Alle Knochen, Eltern vor Kindern."""
    def tiefe(bone):
        n = 0
        while bone.parent:
            bone = bone.parent
            n += 1
        return n
    return sorted(arm.data.bones, key=tiefe)


class Bein:
    """Die Masse eines Beins in der Ruhepose und die Rechnung vom Fuss zu den Gelenken."""

    def __init__(self, arm, namen):
        kopf = {b.name: b.head_local.copy() for b in arm.data.bones}
        self.namen = namen
        self.huefte = kopf[namen['ober'][0]]
        knie = kopf[namen['unter'][0]]
        sprung = kopf[namen['mittel'][0]]
        self.knoechel = kopf[namen['fuss']]
        zeh = kopf[namen['zeh']]
        self.ober = (knie - self.huefte).length
        self.unter = (sprung - knie).length
        self.mittel = (self.knoechel - sprung).length
        self.e_ober = (knie - self.huefte).normalized()
        self.e_unter = (sprung - knie).normalized()
        self.e_mittel = (self.knoechel - sprung).normalized()
        if namen['knick'] is not None:
            # Bei fast gestreckten Beinen sagt die Ruhepose nicht, wohin das Knie knickt: Dann steht die Richtung in der Tabelle.
            self.knick = Vector(namen['knick']).normalized()
        else:
            # Sonst knickt es seitlich vom Strich Huefte - Sprunggelenk, wie in der Ruhepose.
            achse = (sprung - self.huefte).normalized()
            ab = knie - self.huefte
            self.knick = (ab - achse * ab.dot(achse)).normalized()
        self.zeh = zeh
        self.reichweite = self.ober + self.unter + self.mittel

    def loese(self, huefte, ziel, mittelfuss, sohle, zeh):
        """
        Die Drehungen der Beinknochen (im Raum der Figur) fuer einen Knoechel an `ziel` bei einer Huefte an `huefte`.
        Der Mittelfuss steht fest zur Ruhe um `mittelfuss` Grad geneigt, daraus folgt das Sprunggelenk;
        Knie und Huefte ergeben sich als Zwei-Glieder-Kette.
        """
        pitch = Quaternion((1.0, 0.0, 0.0), math.radians(mittelfuss))
        d3 = (pitch @ self.e_mittel).normalized()
        sprung = ziel - d3 * self.mittel
        v = sprung - huefte
        abstand = min(max(v.length, abs(self.ober - self.unter) + 1e-3), self.ober + self.unter - 1e-3)
        t = v.normalized()
        cos_a = (self.ober**2 + abstand**2 - self.unter**2) / (2.0 * self.ober * abstand)
        a = math.acos(max(-1.0, min(1.0, cos_a)))
        knick = (self.knick - t * self.knick.dot(t)).normalized()
        d1 = t * math.cos(a) + knick * math.sin(a)
        knie = huefte + d1 * self.ober
        d2 = (sprung - knie).normalized()
        r_fuss = Quaternion((1.0, 0.0, 0.0), math.radians(sohle))
        r_zeh = r_fuss @ Quaternion((1.0, 0.0, 0.0), math.radians(zeh))
        n = self.namen
        antwort = {}
        for knochen in n['ober']:
            antwort[knochen] = self.e_ober.rotation_difference(d1)
        for knochen in n['unter']:
            antwort[knochen] = self.e_unter.rotation_difference(d2)
        for knochen in n['mittel']:
            antwort[knochen] = self.e_mittel.rotation_difference(d3)
        antwort[n['fuss']] = r_fuss
        antwort[n['zeh']] = r_zeh
        return antwort, v.length / (self.ober + self.unter)


def stelle(arm, ruhe, beine, haltung):
    """
    Setzt die Haltung auf das Skelett.

    Eine Drehung gilt im Raum des Elternknochens, wie er gerade steht: Wer den Oberarm hebt, nimmt den Unterarm mit.
    Eine Zielrichtung gilt dagegen in der Welt: Der Arm zeigt dorthin, egal wie sich der Rumpf dabei neigt.
    Beides wird in die Drehung des einzelnen Knochens (in seinem eigenen Raum) umgerechnet.
    Die Beine rechnet `Bein.loese` aus der Lage der Huefte; sie haengen an Kreuz und Brust, drehen und heben sich also mit dem Rumpf.
    Gibt das groesste Verhaeltnis aus Abstand Huefte-Sprunggelenk zur Laenge von Ober- und Unterschenkel zurueck (1 = voll gestreckt;
    darueber wuerde das Bein nicht mehr bis zum Fuss reichen).
    """
    kumuliert = {}
    lage = {}
    absolut = {}
    streckung = 0.0
    kopf = {bone.name: bone.head_local for bone in arm.data.bones}
    for bone in knochen_nach_tiefe(arm):
        name = bone.name
        pb = arm.pose.bones[name]
        q = ruhe[name]
        eltern = kumuliert[bone.parent.name] if bone.parent else Quaternion()
        # Wo der Kopf des Knochens in der Haltung liegt (der Versatz gilt nur der Wurzel).
        if bone.parent:
            lage[name] = lage[bone.parent.name] + eltern @ (kopf[name] - kopf[bone.parent.name])
        else:
            lage[name] = kopf[name] + Vector(haltung.versatz)
        for schluessel, bein in beine.items():
            if name == bein.namen['ober'][0] and schluessel in haltung.beine:
                vor, hoch, aussen, mittelfuss, sohle, zeh = haltung.beine[schluessel]
                ziel = bein.knoechel + Vector((aussen * (1 if schluessel[1] == 1 else -1), -vor, hoch))
                dreh, strecke = bein.loese(lage[name], ziel, mittelfuss, sohle, zeh)
                absolut.update(dreh)
                streckung = max(streckung, strecke)
        grad = haltung.drehung.get(name)
        delta = Euler([math.radians(a) for a in grad], 'XYZ').to_quaternion() if grad else Quaternion()
        gesamt = eltern @ delta
        ziel = haltung.ziele.get(name)
        if ziel:
            achse = (bone.tail_local - bone.head_local).normalized()
            gesamt = gesamt.slerp(achse.rotation_difference(ziel[0]), ziel[1])
        if name in absolut:
            gesamt = absolut[name].slerp(gesamt, haltung.frei) if haltung.frei > 0.0 else absolut[name]
        kumuliert[name] = gesamt
        pb.rotation_quaternion = q.conjugated() @ (eltern.conjugated() @ gesamt) @ q
        pb.location = q.conjugated() @ Vector(haltung.versatz) if not bone.parent else Vector()
    return streckung


def tiefster_punkt(netz, anteil=1.0):
    """Hoehe (Welt, z = oben), unter der `anteil` Prozent der Punkte des verformten Netzes liegen (einzelne Stachelspitzen zaehlen nicht)."""
    bpy.context.view_layer.update()
    ev = netz.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    z = co @ np.array(netz.matrix_world.row[2][:3]) + netz.matrix_world.row[2][3]
    return float(np.percentile(z, anteil))


def boden_verschiebungen(arm, netz, ruhe, beine, haltungen, anlegen):
    """
    Wie weit der Koerper je Bild gehoben (oder gesenkt) werden muss, damit das Netz auf dem Boden liegt und nicht darin steckt.
    Heben gilt immer; Senken (der Koerper schwebt) erst ab `anlegen` = (von, bis) in Sekunden, davor faellt er frei.
    """
    roh = []
    for f, haltung in enumerate(haltungen):
        stelle(arm, ruhe, beine, haltung)
        k = -tiefster_punkt(netz)
        roh.append(k if k > 0.0 else k * weich(anlegen[0], anlegen[1], f / FPS))
    # Ein wenig glaetten, damit der Koerper nicht zittert, wenn ein Glied den Boden mal beruehrt und mal nicht.
    glatt = []
    for i in range(len(roh)):
        fenster = roh[max(0, i - 2):i + 3]
        glatt.append(sum(fenster) / len(fenster))
    return [max(g, r) if r > 0.0 else g for g, r in zip(glatt, roh)]


def lege_clip_an(arm, ruhe, beine, name, sekunden, haltung_bei, netz=None, anlegen=None):
    """Erzeugt die Action eines Clips: je Bild ein Schluessel an jedem Knochen, den der Clip bewegt."""
    frames = int(round(sekunden * FPS))
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    haltungen = [haltung_bei(f / FPS) for f in range(frames + 1)]
    if anlegen is not None:
        for haltung, hoch in zip(haltungen, boden_verschiebungen(arm, netz, ruhe, beine, haltungen, anlegen)):
            haltung.versatz[2] += hoch
    bewegt = set().union(*(h.bewegt() for h in haltungen))
    bewegt.add(BECKEN)
    vorher = {}
    hoechste = 0.0
    for f, haltung in enumerate(haltungen):
        hoechste = max(hoechste, stelle(arm, ruhe, beine, haltung))
        for knochen in sorted(bewegt):
            pb = arm.pose.bones[knochen]
            # q und -q sind dieselbe Drehung; die Schluessel sollen aber nicht zwischen beiden springen.
            if knochen in vorher and pb.rotation_quaternion.dot(vorher[knochen]) < 0.0:
                pb.rotation_quaternion = -pb.rotation_quaternion
            vorher[knochen] = pb.rotation_quaternion.copy()
            pb.keyframe_insert('rotation_quaternion', frame=f, group=knochen)
            if knochen == BECKEN:
                pb.keyframe_insert('location', frame=f, group=knochen)
    action.use_fake_user = True
    arm.animation_data.action = None
    # Jeder Clip kommt auf eine eigene NLA-Spur; der Export macht aus jeder Spur eine Animation gleichen Namens.
    # Die Schluessel beginnen bei Bild 0, denn der Export nimmt Bild geteilt durch FPS als Zeit: So beginnt jeder Clip bei 0 s.
    spur = arm.animation_data.nla_tracks.new()
    spur.name = name
    spur.strips.new(name, 0, action)
    print(f'{name}: {frames} Bilder, Beine zu {hoechste:.2f} gestreckt (1 = voll)')
    return action


def importiere(quelle):
    vorher = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=quelle)
    neu = [o for o in bpy.data.objects if o not in vorher]
    arm = next(o for o in neu if o.type == 'ARMATURE')
    return arm, neu


def animiere(arm, netz):
    lese_skelett(arm)
    ruhe = ruhelage(arm)
    beine = {schluessel: Bein(arm, namen) for schluessel, namen in BEINE.items()}
    for name, sekunden, haltung_bei, boden in CLIPS:
        lege_clip_an(arm, ruhe, beine, name, sekunden, haltung_bei, netz, boden)
    # Zurueck in die Ruhepose, damit die Datei so beginnt, wie sie kam.
    stelle(arm, ruhe, beine, Haltung())


def schreibe(ziel, objekte):
    # Der Importer legt Hilfsnetze fuer die Knochenformen an; sie gehoeren nicht in die Datei.
    for o in bpy.context.scene.objects:
        o.select_set(o in objekte and not (o.type == 'MESH' and len(o.vertex_groups) == 0))
    bpy.ops.export_scene.gltf(
        filepath=ziel,
        export_format='GLB',
        use_active_scene=True,
        use_selection=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_yup=True,
    )


def main(args=None):
    if args is None:
        args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    quelle = args[0] if len(args) > 0 else os.path.normpath(os.path.join(HERE, '..', 'modelle-original', 'stachelschwein-rig.glb'))
    ziel = args[1] if len(args) > 1 else os.path.normpath(os.path.join(HERE, '..', 'public', 'models', 'stachelschwein.glb'))
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    arm, objekte = importiere(quelle)
    netz = next(o for o in objekte if o.type == 'MESH' and len(o.vertex_groups) > 0)
    animiere(arm, netz)
    schreibe(ziel, objekte)
    print('Stachelschwein geschrieben:', ziel)
    return arm, objekte


if __name__ == '__main__':
    main()
