"""
Gibt dem Manteltraeger seine Animationen: "Laufen" (Schleife) und "Krallenhieb" (einmalig).

Die Datei manteltraeger.glb kommt ohne Animationen aus Meshy. Dieses Skript importiert sie, legt die beiden
Bewegungen am Skelett an (Beine per Zwei-Glieder-Rechnung auf dem Boden gehalten, der Rest aus Wellen und
Schluesselkurven, nicht von Hand gesetzt) und schreibt eine neue GLB mit den Animationen. Mesh, Skelett und
Texturen bleiben, wie sie sind.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/manteltraeger-animieren.py -- quelle.glb ziel.glb

Ohne Pfade wird modelle-original/manteltraeger.glb gelesen und public/models/manteltraeger.glb geschrieben.
(Im offenen Blender geht es auch: exec() der Datei, dann main([quelle, ziel]) aufrufen. Dann bleibt die Szene
des Fensters unberuehrt, nur die importierte Figur wird danach wieder entfernt.)

Wer die Bewegung aendern will, aendert die Zahlen in laufen() und krallenhieb(); jede Zeile steht fuer einen
Knochen und sagt, was er tut. Die Winkel sind in Grad und beziehen sich auf die Achsen der Figur, nicht auf die
Achsen des einzelnen Knochens (die sind bei Meshy beliebig gedreht): Die Figur schaut nach -Y (in der GLB: +Z),
x = nach vorn beugen, y = zur Seite neigen, z = um die Hochachse drehen. Bei den Armen steht x fuer vor und zurueck
(negativ = nach vorn), y fuer zur Seite. Gespiegelt wird ueber `seite` (+1 = Arm auf der +x-Seite der Figur,
-1 = Gegenseite).

Die Beine sind Digitigrad (Zehengaenger mit nach hinten knickendem Sprunggelenk). Sie werden nicht ueber Winkel,
sondern ueber den Fuss gefuehrt: Jedes Bild legt fest, wo der Knoechel steht (vor/zurueck, Hoehe) und wie der Fuss
geneigt ist; Oberschenkel, Unterschenkel und Mittelfuss ergeben sich daraus. So bleibt ein Fuss, der am Boden steht,
dort stehen, auch wenn sich das Becken hebt, senkt und dreht.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
FPS = 30

# --- Zeiten und Strecken, die das Spiel kennt (src/config.ts) --------------------------------------------------
# Dauer einer Schleife des Laufens: zwei Schritte. Das Spiel spielt sie nicht nach der Zeit, sondern nach der
# Strecke ab (CONFIG.enemies.types, Mantelt. model.stride). Die Strecke steht hier in den Massen der Datei (die Figur
# ist 1,7 m hoch, im Spiel 2,1 m): model.stride = LAUF_STRECKE * 2,1 / 1,7. Zu kurz gewaehlt, rutschen die Fuesse.
LAUFEN_SEKUNDEN = 2.0 / 3.0
LAUF_STRECKE = 1.0
# Anteil der Schleife, in dem ein Fuss am Boden steht; den Rest schwingt er nach vorn.
STAND = 0.6

# Dauer des Krallenhiebs und der Augenblick, in dem die Krallen durch den Gegner fahren. Das Spiel spielt ihn in
# Echtzeit ab und laesst den Treffer zur Sekunde KRALLENHIEB_TREFFER einschlagen (CONFIG.enemies.types, Mantelt.
# strike.hitAt). Davor holt er aus (der Spieler sieht es und kann ausweichen), danach faengt er sich wieder.
KRALLENHIEB_SEKUNDEN = 1.0
KRALLENHIEB_TREFFER = 0.50

# --- Knochen nach ihrer Aufgabe (die Namen stammen von Meshys Autorig) -----------------------------------------
BECKEN = 'Bone_000'
KREUZ = 'Bone_001'
# Wirbelsaeule nach oben: Mitte des Rueckens, Brust, Schultergurtel.
RUECKEN = ['Bone_013', 'Bone_012', 'Bone_011']
HALS = ['Bone_022', 'Bone_021']
KOPF = 'Bone_020'
# Kopfschmuck (das Geweih haengt an Bone_041) und Unterkiefer samt Zotteln.
GEWEIH = ['Bone_042', 'Bone_041']
KIEFER = ['Bone_045', 'Bone_044', 'Bone_043']
# Rueckenmantel: oben die Stacheln, unten das Fell, das bis zu den Schenkeln herabhaengt.
MANTEL = [['Bone_003', 'Bone_002'], ['Bone_006', 'Bone_005', 'Bone_004']]
# Je Arm: Schluesselbein, Oberarm, Unterarm, Hand. Die Finger findet das Skript im Skelett selbst.
ARME = {
    1: {'schulter': 'Bone_026', 'oberarm': 'Bone_025', 'unterarm': 'Bone_024', 'hand': 'Bone_023'},
    -1: {'schulter': 'Bone_030', 'oberarm': 'Bone_029', 'unterarm': 'Bone_028', 'hand': 'Bone_027'},
}
# Je Bein: Oberschenkel; Unterschenkel (zwei starr verbundene Knochen); Mittelfuss (das Sprunggelenk sitzt an
# seinem Kopf); Fuss; Zehen. Die Kniescheibe hat zwei eigene Knochen, die am Unterschenkel mitlaufen.
BEINE = {
    -1: {'ober': 'Bone_016', 'unter': ['Bone_015', 'Bone_014'], 'mittel': 'Bone_035', 'fuss': 'Bone_034', 'zeh': 'Bone_033'},
    1: {'ober': 'Bone_019', 'unter': ['Bone_018', 'Bone_017'], 'mittel': 'Bone_040', 'fuss': 'Bone_039', 'zeh': 'Bone_038'},
}


class Haltung:
    """Eine Pose als Abweichung von der Ruhepose: Drehungen in Grad, Verschiebung des Beckens in Metern, Beine am Fuss."""

    def __init__(self):
        self.drehung = {}
        self.versatz = [0.0, 0.0, 0.0]
        self.ziele = {}
        self.beine = {}

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

    def setze_fuss(self, seite, vor, hoch, mittelfuss=0.0, fuss=0.0, zeh=0.0, aussen=0.0):
        """
        Stellt den Fuss einer Seite: `vor` und `hoch` in Metern gegenueber der Ruhepose (vor = nach vorn, hoch = nach oben,
        `aussen` = zur Seite hin), `mittelfuss` neigt den Mittelfuss, `fuss` die Sohle (positiv = Zehen nach unten), `zeh`
        die Zehen, alles in Grad.
        """
        self.beine[seite] = (vor, hoch, aussen, mittelfuss, fuss, zeh)

    def bewegt(self):
        namen = set(self.drehung) | set(self.ziele)
        for seite in self.beine:
            bein = BEINE[seite]
            namen |= {bein['ober'], *bein['unter'], bein['mittel'], bein['fuss'], bein['zeh']}
        return namen

    def hat_versatz(self):
        return any(abs(v) > 1e-9 for v in self.versatz)


def weich(von, bis, x):
    """Sanfter Anstieg von 0 auf 1 zwischen `von` und `bis`."""
    t = min(1.0, max(0.0, (x - von) / (bis - von)))
    return t * t * (3.0 - 2.0 * t)


def verlauf(t, schluessel):
    """
    Kurve durch Schluessel (Zeit, Wert, haelt); der Wert darf eine Zahl oder ein Tupel sein. Die Kurve laeuft glatt durch die
    Schluessel (Hermite-Kurve mit Tangenten aus den Nachbarn). An einem Schluessel mit `haelt` steht die Bewegung dagegen
    still: Dort ruht der Koerper kurz (Ausholen, Ende des Hiebs), statt durchzuschwingen.
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


# ------------------------------------------------------------------------------------------------------------
# Laufen
# ------------------------------------------------------------------------------------------------------------

def fussbahn(p):
    """
    Wo der Fuss in der Schleife steht, p = 0 bis 1 ab dem Aufsetzen. Gibt zurueck: vor (Meter, Abstand von der Ruhelage),
    hoch (Meter), Neigung des Mittelfusses und der Sohle (Grad).

    Im Stand wandert der Fuss mit der Geschwindigkeit des Bodens nach hinten (LAUF_STRECKE je Schleife), sonst rutscht er.
    Im Schwung faehrt er mit einer Kurve nach vorn, die in der Geschwindigkeit des Bodens anfaengt und endet:
    Er setzt schon rueckwaerts laufend auf, statt auf dem Boden zu schlittern.
    """
    breite = LAUF_STRECKE * STAND
    if p < STAND:
        u = p / STAND
        vor = breite * (0.5 - u)
        hoch = 0.045 * weich(0.7, 1.0, u)
        # Die Sohle setzt mit der Ferse auf, rollt ab und stoesst mit den Zehen ab.
        sohle = -10.0 * (1.0 - weich(0.0, 0.2, u)) + 24.0 * weich(0.75, 1.0, u)
        mittel = 6.0 * weich(0.7, 1.0, u)
        return vor, hoch, mittel, sohle
    u = (p - STAND) / (1.0 - STAND)
    m = -LAUF_STRECKE * (1.0 - STAND)
    h00, h10, h01, h11 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2, u**3 - u**2
    vor = h00 * (-0.5 * breite) + h10 * m + h01 * (0.5 * breite) + h11 * m
    hoch = 0.045 * (1.0 - weich(0.0, 0.35, u)) + 0.115 * math.sin(math.pi * u) ** 1.4
    sohle = 24.0 * (1.0 - weich(0.0, 0.35, u)) - 10.0 * weich(0.55, 1.0, u) - 18.0 * math.sin(math.pi * u) ** 2
    mittel = 6.0 * (1.0 - weich(0.0, 0.3, u)) - 14.0 * math.sin(math.pi * u) ** 1.2
    return vor, hoch, mittel, sohle


def laufen(t):
    """Eine Schleife des Laufens: geduckter Gang auf Zehenspitzen, schwere Arme, der Mantel schwingt nach."""
    sin, cos = math.sin, math.cos
    p = (t / LAUFEN_SEKUNDEN) % 1.0
    ph = 2.0 * math.pi * p
    h = Haltung()
    # Die Fuesse: Das linke (-x) Bein setzt bei p = 0 auf, das rechte eine halbe Schleife spaeter.
    for seite, versatz in ((-1, 0.0), (1, 0.5)):
        vor, hoch, mittel, sohle = fussbahn((p + versatz) % 1.0)
        h.setze_fuss(seite, vor, hoch, mittelfuss=mittel, fuss=sohle)
    # Becken: Auf dem Standbein am hoechsten (zweimal je Schleife), ein Stueck zum Standbein verschoben, im Schritt
    # nach vorn gedreht und zur Seite des Schwungbeins hin gesenkt.
    standbein = cos(ph - 0.6 * math.pi)
    h.verschiebe(x=-0.028 * standbein, y=-0.012 * cos(2 * ph + 0.4), z=-0.018 + 0.024 * cos(2 * ph - 1.2 * math.pi))
    h.drehe(BECKEN, y=3.0 * standbein, z=7.0 * cos(ph), x=1.2 * sin(2 * ph))
    # Rumpf: gebueckt, die Schultern drehen gegen das Becken, der Oberkoerper wiegt sich mit.
    for k, knochen in enumerate(RUECKEN):
        h.drehe(knochen, x=3.0 + 0.8 * sin(2 * ph - 0.8 - 0.3 * k), y=-1.4 * standbein, z=-4.0 * cos(ph))
    # Hals und Kopf: Der Kopf haengt nach und blickt gegen die Drehung der Schultern zurueck nach vorn.
    h.drehe(HALS[0], x=2.0 * sin(2 * ph - 1.4), z=2.4 * cos(ph - 0.3))
    h.drehe(HALS[1], x=2.2 * sin(2 * ph - 1.9), z=2.4 * cos(ph - 0.5))
    h.drehe(KOPF, x=-1.5 + 2.4 * sin(2 * ph - 2.4), y=1.0 * standbein, z=1.8 * cos(ph - 0.6))
    # Das Geweih wippt noch ein Stueck spaeter nach, der Kiefer klappt leicht.
    h.drehe(GEWEIH[0], x=2.2 * sin(2 * ph - 2.9), y=1.4 * sin(ph - 1.8))
    h.drehe(GEWEIH[1], x=2.8 * sin(2 * ph - 3.3), y=2.0 * sin(ph - 2.1))
    for k, knochen in enumerate(KIEFER):
        h.drehe(knochen, x=(3.0 + 2.0 * k) * sin(2 * ph - 2.0 - 0.5 * k))
    # Arme: Gegenlaeufig zu den Beinen, schwer, die Glieder folgen dem Oberarm je ein Stueck spaeter.
    for seite, arm in ARME.items():
        schritt = cos(ph + (0.0 if seite == 1 else math.pi))
        h.drehe(arm['schulter'], x=-1.5 * schritt)
        h.drehe(arm['oberarm'], x=-8.0 * schritt, y=-seite * (2.0 + 1.5 * (1.0 - cos(2 * ph + 0.3))))
        spaet = cos(ph + (0.0 if seite == 1 else math.pi) - 0.55)
        h.drehe(arm['unterarm'], x=-4.0 - 7.0 * (spaet * 0.5 + 0.5), y=-seite * 1.5 * spaet)
        h.drehe(arm['hand'], x=-5.0 * cos(ph + (0.0 if seite == 1 else math.pi) - 1.1))
        for finger, tiefe in fingerknochen(arm['hand']):
            h.drehe(finger, x=-(7.0 + 2.0 * tiefe) - 4.0 * sin(ph + 0.5 * tiefe + 0.6 * seite))
    # Mantel: Die Stacheln und das Fell schwingen je weiter unten, desto spaeter und weiter, und schlagen beim
    # Aufsetzen nach.
    for strang, kette in enumerate(MANTEL):
        for k, knochen in enumerate(kette):
            amplitude = 2.6 + 2.2 * k + 1.6 * strang
            verzug = 0.7 * (k + 1) + 0.4 * strang
            h.drehe(
                knochen,
                x=amplitude * sin(2 * ph - verzug) + 0.4 * amplitude * sin(ph - 0.7 * verzug),
                y=0.7 * amplitude * sin(ph - verzug + 0.8),
            )
    return h


# ------------------------------------------------------------------------------------------------------------
# Krallenhieb
# ------------------------------------------------------------------------------------------------------------

# Die Schluessel des Hiebs gelten fuer alle Kurven: Ruhe, Ausholen (die Bewegung steht), noch ein Stueck weiter zurueck,
# Hieb (die Krallen fahren durch den Gegner, hier ist die Bewegung am schnellsten), Nachschwung (steht), Ruhe.
HIEB_ZEITEN = (0.00, 0.30, 0.36, KRALLENHIEB_TREFFER, 0.64, KRALLENHIEB_SEKUNDEN)
HIEB_HAELT = (True, True, True, False, True, True)


def kurve(werte):
    return [(t, w, h) for t, w, h in zip(HIEB_ZEITEN, werte, HIEB_HAELT)]


# Wohin der Schlagarm (+x) zeigt, als (seite, vor, oben); None ist die Richtung des Knochens in der Ruhepose.
# Ausholen: Der Arm geht weit zur Seite, nach hinten und nach oben, der Unterarm kippt steil hoch, die Krallen spreizen sich.
# Hieb: Er faehrt von aussen oben nach vorn und unten quer durch den Gegner und endet tief vor dem Koerper.
HIEB_OBERARM = kurve([None, (0.85, -0.30, 0.42), (0.87, -0.34, 0.36), (0.20, 0.90, -0.12), (-0.30, 0.55, -0.78), None])
HIEB_UNTERARM = kurve([None, (0.25, -0.45, 0.86), (0.26, -0.48, 0.84), (0.00, 0.95, -0.25), (-0.25, 0.65, -0.72), None])
HIEB_HAND = kurve([None, (0.10, -0.50, 0.86), (0.12, -0.54, 0.83), (-0.10, 0.90, -0.30), (-0.30, 0.60, -0.74), None])
# Koerperkurven in Grad: Beugung des Rumpfes (positiv = nach vorn), Drehung der Schultern (positiv = die +x-Schulter
# geht zurueck), Neigung zur Seite (positiv = nach +x).
HIEB_BEUGUNG = kurve([0.0, -10.0, -12.0, 4.0, 12.0, 0.0])
HIEB_DREHUNG = kurve([0.0, 20.0, 22.0, -5.0, -26.0, 0.0])
HIEB_NEIGUNG = kurve([0.0, -5.0, -6.0, 0.0, 6.0, 0.0])
# Becken in Metern: nach hinten und tief beim Ausholen (er duckt sich), nach vorn beim Hieb (er wirft sich hinein).
HIEB_BECKEN_VOR = kurve([0.0, -0.05, -0.06, 0.10, 0.20, 0.0])
HIEB_BECKEN_HOCH = kurve([0.0, -0.06, -0.07, -0.01, -0.06, 0.0])
HIEB_KOPF = kurve([0.0, -14.0, -16.0, 0.0, 10.0, 0.0])
# Der Kiefer klappt beim Ausholen auf und bruellt im Hieb.
HIEB_KIEFER = kurve([0.0, 14.0, 16.0, 30.0, 20.0, 0.0])
# Die Krallen: Beim Ausholen kruemmen sie sich (negativ = einrollen), im Hieb strecken sie sich und fahren aus.
HIEB_KRALLEN = kurve([0.0, -22.0, -26.0, 4.0, -4.0, 0.0])
# Der andere Arm (+1 = geht nach vorn und oben, -1 = nach hinten und aussen) haelt das Gleichgewicht.
HIEB_GLEICHGEWICHT = kurve([0.0, 1.0, 1.0, -0.4, -0.8, 0.0])


def krallenhieb(t):
    """Einmal zuschlagen: ducken und ausholen, mit dem rechten Arm quer durch den Gegner reissen, sich fangen."""
    sin = math.sin
    h = Haltung()
    beugung = verlauf(t, HIEB_BEUGUNG)
    drehung = verlauf(t, HIEB_DREHUNG)
    neigung = verlauf(t, HIEB_NEIGUNG)

    # Die Fuesse stehen: das linke vorn, das rechte hinten, beide am Boden; das Becken wirft sich darueber nach vorn.
    # Beim Hieb loest sich die Ferse des hinteren Fusses.
    ferse = weich(KRALLENHIEB_TREFFER - 0.06, KRALLENHIEB_TREFFER + 0.06, t) * (1.0 - weich(0.72, 0.95, t))
    h.setze_fuss(-1, 0.30, 0.0, mittelfuss=0.0, fuss=-6.0 + 4.0 * ferse)
    h.setze_fuss(1, -0.20, 0.03 * ferse, mittelfuss=8.0 * ferse, fuss=10.0 * ferse + 8.0 * (weich(0.0, 0.2, t) * (1.0 - weich(0.7, 1.0, t))))
    h.verschiebe(y=-verlauf(t, HIEB_BECKEN_VOR), z=verlauf(t, HIEB_BECKEN_HOCH))
    h.drehe(BECKEN, z=0.25 * drehung, x=0.15 * beugung)
    for knochen in RUECKEN:
        h.drehe(knochen, x=beugung / 3.0, y=neigung / 3.0, z=0.25 * drehung)
    # Der Kopf bleibt dem Ziel zugewandt, das Geweih und der Kiefer schlagen nach.
    kopf = verlauf(t, HIEB_KOPF)
    h.drehe(HALS[0], x=0.3 * kopf, z=-0.2 * drehung)
    h.drehe(HALS[1], x=0.3 * kopf, z=-0.2 * drehung)
    h.drehe(KOPF, x=0.4 * kopf, z=-0.3 * drehung)
    h.drehe(GEWEIH[0], x=-0.25 * (verlauf(t - 0.06, HIEB_KOPF) - kopf))
    h.drehe(
        GEWEIH[1],
        x=-0.35 * (verlauf(t - 0.10, HIEB_KOPF) - kopf),
        y=0.3 * sin(14.0 * t) * weich(0.30, 0.38, t) * (1.0 - weich(0.40, 0.48, t)),
    )
    kiefer = verlauf(t, HIEB_KIEFER)
    for k, knochen in enumerate(KIEFER):
        h.drehe(knochen, x=kiefer * (0.55, 0.3, 0.15)[k])

    # Schlagarm (+x): Der Arm zeigt in die Richtungen der Kurven. Das Schluesselbein hebt ihn mit.
    stoss = weich(0.30, KRALLENHIEB_TREFFER, t) * (1.0 - weich(0.58, 0.70, t))
    arm = ARME[1]
    h.drehe(arm['schulter'], x=-8.0 * stoss, y=-8.0 * weich(0.0, 0.30, t) * (1.0 - weich(0.40, KRALLENHIEB_TREFFER, t)))
    for name, kurve_arm in (('oberarm', HIEB_OBERARM), ('unterarm', HIEB_UNTERARM), ('hand', HIEB_HAND)):
        ruhe_richtung = ruhe_richtungen[arm[name]]
        richtung = Vector(verlauf(t, [(zeit, ruhe_richtung if wert is None else wert, halt) for zeit, wert, halt in kurve_arm]))
        h.richte(arm[name], (richtung.x, -richtung.y, richtung.z), 1.0)
    krallen = verlauf(t, HIEB_KRALLEN)
    for finger, tiefe in fingerknochen(arm['hand']):
        h.drehe(finger, x=krallen * (0.7 + 0.15 * tiefe))

    # Der andere Arm (-x) haelt das Gleichgewicht.
    arm = ARME[-1]
    balance = verlauf(t, HIEB_GLEICHGEWICHT)
    h.drehe(arm['schulter'], x=-1.0 * balance)
    h.drehe(arm['oberarm'], x=-5.0 * balance, y=2.5 * (1.0 - balance))
    h.drehe(arm['unterarm'], x=-4.0 * max(0.0, balance) - 3.0 * (1.0 - balance))
    h.drehe(arm['hand'], x=-3.0 * balance)
    for finger, tiefe in fingerknochen(arm['hand']):
        h.drehe(finger, x=-(10.0 + 3.0 * tiefe) * (0.6 + 0.4 * max(0.0, balance)))

    # Der Mantel wird vom Ruck mitgerissen und schwingt nach: Er folgt der Beugung des Rumpfes mit Verzug.
    for strang, kette in enumerate(MANTEL):
        for k, knochen in enumerate(kette):
            verzug = 0.05 * (k + 1) + 0.03 * strang
            laeuft = verlauf(t - verzug, HIEB_BEUGUNG)
            h.drehe(knochen, x=-(0.28 + 0.12 * k) * laeuft, y=0.024 * (1.0 + k) * verlauf(t - verzug, HIEB_DREHUNG))
    return h


CLIPS = [
    # Name, Dauer in Sekunden, Haltung zur Zeit t
    ('Laufen', LAUFEN_SEKUNDEN, laufen),
    ('Krallenhieb', KRALLENHIEB_SEKUNDEN, krallenhieb),
]


# ------------------------------------------------------------------------------------------------------------
# Das Skelett auf die Haltung stellen
# ------------------------------------------------------------------------------------------------------------

_fingerknochen = {}
# Richtung jedes Knochens in der Ruhepose als (seite, vor, oben); gesetzt in lese_skelett().
ruhe_richtungen = {}


def fingerknochen(hand):
    """Alle Knochen unterhalb einer Hand mit ihrer Tiefe (1 = Fingerwurzel) und wie viele Wurzeln davor liegen. Gesetzt in lese_skelett()."""
    return _fingerknochen[hand]


def lese_skelett(arm):
    """Merkt sich, was nicht in den Tabellen oben steht: die Finger, und die Ruhelage jedes Knochens."""
    _fingerknochen.clear()
    ruhe_richtungen.clear()
    for bone in arm.data.bones:
        achse = (bone.tail_local - bone.head_local).normalized()
        ruhe_richtungen[bone.name] = (achse.x, -achse.y, achse.z)
    for seite in ARME.values():
        wurzel = arm.data.bones[seite['hand']]
        liste = []

        def sammle(bone, tiefe):
            for kind in bone.children:
                liste.append((kind.name, tiefe))
                sammle(kind, tiefe + 1)

        sammle(wurzel, 0)
        _fingerknochen[seite['hand']] = liste


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
        self.huefte = kopf[namen['ober']]
        knie = kopf[namen['unter'][0]]
        sprung = kopf[namen['mittel']]
        self.knoechel = kopf[namen['fuss']]
        zeh = kopf[namen['zeh']]
        self.ober = (knie - self.huefte).length
        self.unter = (sprung - knie).length
        self.mittel = (self.knoechel - sprung).length
        self.e_ober = (knie - self.huefte).normalized()
        self.e_unter = (sprung - knie).normalized()
        self.e_mittel = (self.knoechel - sprung).normalized()
        # In welche Richtung das Knie knickt, bestimmt die Ruhepose: seitlich vom Strich Huefte - Sprunggelenk.
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
        antwort = {
            n['ober']: self.e_ober.rotation_difference(d1),
            n['mittel']: self.e_mittel.rotation_difference(d3),
            n['fuss']: r_fuss,
            n['zeh']: r_zeh,
        }
        schaft = self.e_unter.rotation_difference(d2)
        for knochen in n['unter']:
            antwort[knochen] = schaft
        return antwort, v.length / (self.ober + self.unter)


def stelle(arm, ruhe, beine, haltung):
    """
    Setzt die Haltung auf das Skelett.

    Eine Drehung gilt im Raum des Elternknochens, wie er gerade steht: Wer den Oberarm hebt, nimmt den Unterarm mit.
    Eine Zielrichtung gilt dagegen in der Welt: Der Arm zeigt dorthin, egal wie sich der Rumpf dabei neigt.
    Beides wird in die Drehung des einzelnen Knochens (in seinem eigenen Raum) umgerechnet.
    Die Beine rechnet `Bein.loese` aus der Lage der Huefte; sie haengen am Kreuz, drehen und heben sich also mit dem Becken.
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
        for seite, bein in beine.items():
            if name == bein.namen['ober'] and seite in haltung.beine:
                vor, hoch, aussen, mittelfuss, sohle, zeh = haltung.beine[seite]
                ziel = bein.knoechel + Vector((aussen * -seite, -vor, hoch))
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
            gesamt = absolut[name]
        kumuliert[name] = gesamt
        pb.rotation_quaternion = q.conjugated() @ (eltern.conjugated() @ gesamt) @ q
        pb.location = q.conjugated() @ Vector(haltung.versatz) if not bone.parent else Vector()
    return streckung


def lege_clip_an(arm, ruhe, beine, name, sekunden, haltung_bei):
    """Erzeugt die Action eines Clips: je Bild ein Schluessel an jedem Knochen, den der Clip bewegt."""
    frames = int(round(sekunden * FPS))
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    haltungen = [haltung_bei(f / FPS) for f in range(frames + 1)]
    bewegt = set().union(*(h.bewegt() for h in haltungen))
    bewegt.add(BECKEN)
    vorher = {}
    for f, haltung in enumerate(haltungen):
        stelle(arm, ruhe, beine, haltung)
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
    return action


def importiere(quelle):
    vorher = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=quelle)
    neu = [o for o in bpy.data.objects if o not in vorher]
    arm = next(o for o in neu if o.type == 'ARMATURE')
    return arm, neu


def animiere(arm):
    lese_skelett(arm)
    ruhe = ruhelage(arm)
    beine = {seite: Bein(arm, namen) for seite, namen in BEINE.items()}
    for name, sekunden, haltung_bei in CLIPS:
        lege_clip_an(arm, ruhe, beine, name, sekunden, haltung_bei)
    # Zurueck in die Ruhepose, damit die Datei so beginnt, wie sie kam.
    stelle(arm, ruhe, beine, Haltung())


def schreibe(ziel, objekte):
    for o in bpy.context.scene.objects:
        o.select_set(o in objekte)
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
    quelle = args[0] if len(args) > 0 else os.path.normpath(os.path.join(HERE, '..', 'modelle-original', 'manteltraeger.glb'))
    ziel = args[1] if len(args) > 1 else os.path.normpath(os.path.join(HERE, '..', 'public', 'models', 'manteltraeger.glb'))
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    arm, objekte = importiere(quelle)
    animiere(arm)
    schreibe(ziel, objekte)
    print('Manteltraeger geschrieben:', ziel)
    return arm, objekte


if __name__ == '__main__':
    main()
