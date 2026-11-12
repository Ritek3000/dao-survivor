"""
Gibt dem Priester seine Animationen: "Schweben" (Schleife) und "Zaubern" (einmalig).

Die Datei priester.glb kommt ohne Animationen aus Meshy. Dieses Skript importiert sie, legt die beiden
Bewegungen am Skelett an (aus Sinuswellen und Huellkurven, nicht von Hand gesetzt) und schreibt eine
neue GLB mit den Animationen. Mesh, Skelett und Texturen bleiben, wie sie sind.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/priester-animieren.py -- quelle.glb ziel.glb

Ohne Pfade wird modelle-original/priester.glb gelesen und public/models/priester.glb geschrieben.

Wer die Bewegung aendern will, aendert die Zahlen in schweben() und zaubern(); jede Zeile steht fuer einen
Knochen und sagt, was er tut. Die Winkel sind in Grad und beziehen sich auf die Achsen der Figur, nicht auf die
Achsen des einzelnen Knochens (die sind bei Meshy beliebig gedreht): x = nach vorn beugen, y = zur Seite neigen,
z = um die Hochachse drehen. Bei den Armen heisst x "Arm nach vorn drehen", y "Arm heben".
Gespiegelt wird ueber `seite` (+1 = Arm auf der +x-Seite der Figur, -1 = Gegenseite).
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
FPS = 30

# Dauer der Schwebe-Schleife in Sekunden. Eine Runde: Auf und Ab, Atmen, Nachschwingen des Gewandes.
SCHWEBEN_SEKUNDEN = 2.4
# Dauer des Zaubers. Gedacht fuer CONFIG.enemies.types (Priester) .cast.windup in src/config.ts: Das Spiel dehnt die
# Animation auf diese Sekunden, und der Schwarze Sog schlaegt am Ende ein. Die Haelfte der Zeit sammelt er, das letzte
# Fuenftel stoesst und klingt aus; weicht windup weit ab, passt das Tempo nicht mehr.
ZAUBERN_SEKUNDEN = 1.3

# --- Knochen nach ihrer Aufgabe (die Namen stammen von Meshys Autorig) -----------------------------------------
HUEFTE = 'Bone_000'
TAILLE = 'Bone_001'
BRUST = ['Bone_017', 'Bone_016', 'Bone_015', 'Bone_014']
KOPF = ['Bone_020', 'Bone_019', 'Bone_018']
# Je Arm: Schluesselbein, Oberarm, Unterarm, Hand, Handflaeche und vier Finger zu je vier Gliedern.
ARME = {
    1: {
        'schulter': 'Bone_030', 'oberarm': 'Bone_029', 'unterarm': 'Bone_028', 'hand': 'Bone_027', 'flaeche': 'Bone_026',
        'finger': [
            ['Bone_050', 'Bone_049', 'Bone_048', 'Bone_047'],
            ['Bone_054', 'Bone_053', 'Bone_052', 'Bone_051'],
            ['Bone_058', 'Bone_057', 'Bone_056', 'Bone_055'],
            ['Bone_062', 'Bone_061', 'Bone_060', 'Bone_059'],
        ],
    },
    -1: {
        'schulter': 'Bone_025', 'oberarm': 'Bone_024', 'unterarm': 'Bone_023', 'hand': 'Bone_022', 'flaeche': 'Bone_021',
        'finger': [
            ['Bone_034', 'Bone_033', 'Bone_032', 'Bone_031'],
            ['Bone_038', 'Bone_037', 'Bone_036', 'Bone_035'],
            ['Bone_042', 'Bone_041', 'Bone_040', 'Bone_039'],
            ['Bone_046', 'Bone_045', 'Bone_044', 'Bone_043'],
        ],
    },
}
# Die drei Gewandstraenge unter der Taille: hinten, auf der -x-Seite und auf der +x-Seite, je vier Knochen.
GEWAND = [
    ['Bone_005', 'Bone_004', 'Bone_003', 'Bone_002'],
    ['Bone_009', 'Bone_008', 'Bone_007', 'Bone_006'],
    ['Bone_013', 'Bone_012', 'Bone_011', 'Bone_010'],
]


class Haltung:
    """Eine Pose als Abweichung von der Ruhepose: Drehungen in Grad und Verschiebungen in Metern."""

    def __init__(self):
        self.drehung = {}
        self.versatz = {}
        self.ziele = {}

    def drehe(self, knochen, x=0.0, y=0.0, z=0.0):
        d = self.drehung.setdefault(knochen, [0.0, 0.0, 0.0])
        d[0] += x
        d[1] += y
        d[2] += z

    def verschiebe(self, knochen, x=0.0, y=0.0, z=0.0):
        v = self.versatz.setdefault(knochen, [0.0, 0.0, 0.0])
        v[0] += x
        v[1] += y
        v[2] += z

    def richte(self, knochen, richtung, gewicht):
        """Der Knochen zeigt in der Welt in `richtung` (x = zur Seite, y = nach hinten, z = nach oben), mit `gewicht` 0 bis 1."""
        self.ziele[knochen] = (Vector(richtung).normalized(), gewicht)


def weich(von, bis, x):
    """Sanfter Anstieg von 0 auf 1 zwischen `von` und `bis`."""
    t = min(1.0, max(0.0, (x - von) / (bis - von)))
    return t * t * (3.0 - 2.0 * t)


def schweben(t):
    """Eine Schleife des Schwebens: wiegt sich auf und ab, atmet, Arme und Gewand schwingen mit Verzoegerung nach."""
    sin = math.sin
    ph = 2.0 * math.pi * t / SCHWEBEN_SEKUNDEN
    h = Haltung()
    # Der ganze Koerper hebt und senkt sich um einige Zentimeter und wiegt sich dabei leicht.
    h.verschiebe(HUEFTE, x=0.012 * sin(ph + 1.0), y=0.010 * sin(2 * ph), z=0.09 * sin(ph))
    h.drehe(HUEFTE, x=1.2 * sin(ph - 0.5), y=1.6 * sin(ph + 0.8))
    h.drehe(TAILLE, x=1.0 * sin(ph - 1.0), y=1.2 * sin(ph + 0.3))
    for k, knochen in enumerate(BRUST):
        h.drehe(knochen, x=0.8 * sin(ph - 1.3 - 0.3 * k), y=-0.5 * sin(ph + 0.5 + 0.2 * k))
    # Der Kopf haengt hinterher und schaut langsam hin und her.
    h.drehe(KOPF[0], x=2.5 * sin(ph - 1.8), z=3.5 * sin(ph + 0.7))
    h.drehe(KOPF[1], x=1.5 * sin(ph - 2.2), z=1.5 * sin(ph + 0.4))
    h.drehe(KOPF[2], x=1.0 * sin(ph - 2.6))
    # Arme: Die Glieder folgen dem Oberarm je ein Stueck spaeter, die Finger krallen sich in Wellen.
    for seite, arm in ARME.items():
        h.drehe(arm['oberarm'], y=-seite * 6.0 * sin(ph - 0.9), z=-seite * 4.0 * sin(ph - 1.1))
        h.drehe(arm['unterarm'], y=-seite * 8.0 * sin(ph - 1.5))
        h.drehe(arm['hand'], x=10.0 * sin(ph - 2.0))
        h.drehe(arm['flaeche'], x=4.0 * sin(ph - 2.3))
        for i, finger in enumerate(arm['finger']):
            for j, knochen in enumerate(finger):
                h.drehe(knochen, x=(3.0 + 1.5 * j) * sin(ph - 2.4 - 0.3 * j + 0.4 * i))
    # Gewand: Je weiter unten, desto spaeter und desto weiter schwingt es; ein zweiter, schnellerer Schlag
    # macht es unruhig, damit es nicht wie ein Pendel wirkt.
    for strang, kette in enumerate(GEWAND):
        for k, knochen in enumerate(kette):
            amplitude = 3.0 + 2.0 * k
            verzug = 0.55 * (k + 1) + 0.25 * strang
            h.drehe(
                knochen,
                x=amplitude * sin(ph - verzug) + 0.4 * amplitude * sin(2 * ph - 1.6 * verzug),
                y=0.7 * amplitude * sin(ph - verzug + 1.2 + 0.6 * strang),
            )
    return h


def zaubern(t):
    """Einmal zaubern: Arme heben und sammeln, zittern, dann nach vorn stossen und ausklingen."""
    sin = math.sin
    u = t / ZAUBERN_SEKUNDEN
    gehoben = weich(0.0, 0.38, u) * (1.0 - weich(0.80, 0.86, u))
    gespannt = weich(0.25, 0.50, u) * (1.0 - weich(0.80, 0.86, u))
    stoss = weich(0.80, 0.86, u) * (1.0 - weich(0.90, 1.0, u))
    zittern = gespannt * sin(2.0 * math.pi * 11.0 * t)
    zittern2 = gespannt * sin(2.0 * math.pi * 7.3 * t + 1.3)
    h = Haltung()
    # Er steigt auf, lehnt sich beim Sammeln zurueck und wirft sich beim Stoss nach vorn.
    h.verschiebe(HUEFTE, y=0.05 * gehoben - 0.12 * stoss + 0.01 * zittern, z=0.16 * gehoben - 0.04 * stoss + 0.012 * zittern2)
    h.drehe(HUEFTE, x=-5.0 * gehoben + 5.0 * stoss)
    h.drehe(TAILLE, x=-3.0 * gehoben + 3.0 * stoss)
    for knochen in BRUST:
        h.drehe(knochen, x=-3.0 * gehoben + 2.5 * stoss, y=0.6 * zittern)
    h.drehe(KOPF[0], x=-12.0 * gehoben + 8.0 * stoss, z=1.5 * zittern2)
    h.drehe(KOPF[1], x=-4.0 * gehoben + 3.0 * stoss)
    # Die Arme zeigen in der Welt in bestimmte Richtungen (x = zur Seite, y = nach hinten, z = nach oben).
    # Gesammelt: weit nach oben und aussen, die Unterarme kippen nach vorn, die Haende greifen ins Leere.
    # Im Stoss: gestreckt nach vorn auf das Ziel zu, die Finger gespreizt.
    gewicht = min(1.0, gehoben + stoss)
    zu_stoss = stoss / (gehoben + stoss) if gehoben + stoss > 1e-6 else 0.0
    for seite, arm in ARME.items():
        def ziel(gesammelt, gestossen, zitter=(0.0, 0.0, 0.0)):
            return [
                (1.0 - zu_stoss) * a * (seite if i == 0 else 1.0) + zu_stoss * b * (seite if i == 0 else 1.0) + z
                for i, (a, b, z) in enumerate(zip(gesammelt, gestossen, zitter))
            ]
        zitter = (0.05 * zittern, 0.03 * zittern2, 0.06 * zittern2)
        h.drehe(arm['schulter'], y=-seite * 8.0 * gehoben)
        h.richte(arm['oberarm'], ziel((0.62, -0.15, 0.77), (0.40, -0.88, 0.10), zitter), gewicht)
        h.richte(arm['unterarm'], ziel((0.36, -0.50, 0.79), (0.22, -0.97, 0.10), zitter), gewicht)
        h.richte(arm['hand'], ziel((0.15, -0.72, 0.68), (0.10, -1.00, 0.0), zitter), gewicht)
        for i, finger in enumerate(arm['finger']):
            for j, knochen in enumerate(finger):
                # Krallen: in der Spannung krampfen die Finger zusammen, im Stoss spreizen sie sich.
                h.drehe(knochen, x=(18.0 + 4.0 * j) * gespannt - (10.0 + 3.0 * j) * stoss + 3.0 * zittern * (1 + 0.2 * i))
    # Das Gewand wird vom Aufsteigen mitgerissen, bauscht sich und peitscht beim Stoss nach.
    for strang, kette in enumerate(GEWAND):
        for k, knochen in enumerate(kette):
            weite = 1.0 + 0.5 * k
            h.drehe(
                knochen,
                x=(-4.0 * gehoben + 9.0 * stoss) * weite + 2.0 * zittern * weite,
                y=(strang - 1) * 6.0 * gehoben * weite,
            )
    return h


CLIPS = [
    # Name, Dauer in Sekunden, Haltung zur Zeit t
    ('Schweben', SCHWEBEN_SEKUNDEN, schweben),
    ('Zaubern', ZAUBERN_SEKUNDEN, zaubern),
]


def ruhelage(arm):
    """Ausrichtung jedes Knochens in der Ruhepose, im Raum der Figur."""
    return {bone.name: bone.matrix_local.to_quaternion() for bone in arm.data.bones}


def stelle(arm, ruhe, haltung):
    """
    Setzt die Haltung auf das Skelett.

    Eine Drehung gilt im Raum des Elternknochens, wie er gerade steht: Wer den Oberarm hebt, nimmt den Unterarm mit.
    Eine Zielrichtung gilt dagegen in der Welt: Der Arm zeigt dorthin, egal wie sich der Rumpf dabei neigt.
    Beides wird in die Drehung des einzelnen Knochens (in seinem eigenen Raum) umgerechnet.
    """
    kumuliert = {}
    for bone in knochen_nach_tiefe(arm):
        pb = arm.pose.bones[bone.name]
        q = ruhe[bone.name]
        eltern = kumuliert[bone.parent.name] if bone.parent else Quaternion()
        grad = haltung.drehung.get(bone.name)
        delta = Euler([math.radians(a) for a in grad], 'XYZ').to_quaternion() if grad else Quaternion()
        gesamt = eltern @ delta
        ziel = haltung.ziele.get(bone.name)
        if ziel:
            achse = (bone.tail_local - bone.head_local).normalized()
            gesamt = gesamt.slerp(achse.rotation_difference(ziel[0]), ziel[1])
        kumuliert[bone.name] = gesamt
        pb.rotation_quaternion = q.conjugated() @ (eltern.conjugated() @ gesamt) @ q
        versatz = haltung.versatz.get(bone.name)
        pb.location = q.conjugated() @ Vector(versatz) if versatz else Vector()


def knochen_nach_tiefe(arm):
    """Alle Knochen, Eltern vor Kindern."""
    def tiefe(bone):
        n = 0
        while bone.parent:
            bone = bone.parent
            n += 1
        return n
    return sorted(arm.data.bones, key=tiefe)


def lege_clip_an(arm, ruhe, name, sekunden, haltung_bei):
    """Erzeugt die Action eines Clips: je Bild ein Schluessel an jedem Knochen, den der Clip bewegt."""
    frames = int(round(sekunden * FPS))
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    haltungen = [haltung_bei(f / FPS) for f in range(frames + 1)]
    bewegt = {k for h in haltungen for k in list(h.drehung) + list(h.versatz) + list(h.ziele)}
    for f, haltung in enumerate(haltungen):
        stelle(arm, ruhe, haltung)
        for knochen in sorted(bewegt):
            pb = arm.pose.bones[knochen]
            pb.keyframe_insert('rotation_quaternion', frame=f, group=knochen)
            if any(knochen in h.versatz for h in haltungen):
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
    bpy.ops.import_scene.gltf(filepath=quelle)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    return arm


def animiere(arm):
    ruhe = ruhelage(arm)
    for name, sekunden, haltung_bei in CLIPS:
        lege_clip_an(arm, ruhe, name, sekunden, haltung_bei)
    # Zurueck in die Ruhepose, damit die Datei so beginnt, wie sie kam.
    stelle(arm, ruhe, Haltung())


def schreibe(ziel):
    bpy.ops.export_scene.gltf(
        filepath=ziel,
        export_format='GLB',
        use_active_scene=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_yup=True,
    )


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    quelle = args[0] if len(args) > 0 else os.path.normpath(os.path.join(HERE, '..', 'modelle-original', 'priester.glb'))
    ziel = args[1] if len(args) > 1 else os.path.normpath(os.path.join(HERE, '..', 'public', 'models', 'priester.glb'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    arm = importiere(quelle)
    animiere(arm)
    schreibe(ziel)
    print('Priester geschrieben:', ziel)


if __name__ == '__main__':
    main()
