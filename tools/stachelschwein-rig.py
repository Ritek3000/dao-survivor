"""
Korrigiert das Rigging des Stachelschwein-Monsters (Meshy-Autorig).

Problem: Meshys Autorig hat das Wesen als Vierbeiner erkannt. Die Arme (seitlich abstehend, mit Haenden bei x = +-1)
haben dadurch keine eigenen Knochen. Nur ein paar winzige Fingerketten (Bone_037..042 und Bone_049..052) wurden an
den FUSS der Vorderbeine gehaengt, und die Skin-Weights des Oberarms liegen auf den Vorderbein-Knochen. Beim Gehen
zieht das Bein also den ganzen Arm mit.

Was dieses Skript macht:
  1. Je Arm vier neue Knochen: Schulter, Oberarm, Unterarm, Hand (Arm_L_* auf der +x-Seite, Arm_R_* auf der -x-Seite).
     Sie haengen wie die Vorderbeine an der Brust (Bone_005), nicht an den Beinen. Auch die Vorderbeine selbst sind von
     Bone_003 (dem Kopf) auf die Brust umgehaengt, damit Kopfbewegungen sie nicht mitnehmen.
  2. Die vorhandenen Fingerketten haengen jetzt an der neuen Hand statt am Fuss. Ihre Lage aendert sich nicht.
  3. Die Skin-Weights von Schulter, Arm und Hand werden neu gerechnet: laengs der Armachse, mit weichen Uebergaengen
     an Schulter, Ellbogen und Handgelenk. Die Weights des Rumpfs, des Kopfes und der Beine bleiben unberuehrt; an der
     Schulter wird zum Rumpf hin ueberblendet.
Alle alten Knochen behalten ihre Namen und ihre Lage. Netz, UVs und Texturen bleiben, wie sie sind.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/stachelschwein-rig.py -- quelle.glb ziel.glb

(oder mit dem Python-Modul bpy: python tools/stachelschwein-rig.py -- quelle.glb ziel.glb)
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

# --- Knochen der Meshy-Vorlage ---------------------------------------------------------------------------------
# Die Vorderbeine hingen bei Meshy an Bone_003, dem Kopf (dort haengt auch die Stachelmaehne). Dann risse jede Kopfbewegung
# Beine und Arme mit. Sie haengen jetzt am Brustknochen: Er traegt Schultern und Vorderbeine, der Hals und der Kopf sitzen davor.
BRUST = 'Bone_005'
UMHAENGEN = {'Bone_028': BRUST, 'Bone_033': BRUST}
# Seite +1 = +x der Figur (Blickrichtung -y, also die linke Seite der Figur), Seite -1 = -x.
VORDERBEIN = {
    1: ['Bone_028', 'Bone_027', 'Bone_026', 'Bone_025', 'Bone_024', 'Bone_036', 'Bone_035', 'Bone_034'],
    -1: ['Bone_033', 'Bone_032', 'Bone_031', 'Bone_030', 'Bone_029', 'Bone_045', 'Bone_044', 'Bone_043',
         'Bone_048', 'Bone_047', 'Bone_046'],
}
# Fingerketten der Haende (die Wurzel jeder Kette wird auf die neue Hand umgehaengt).
FINGER = {
    1: [['Bone_039', 'Bone_038', 'Bone_037'], ['Bone_042', 'Bone_041', 'Bone_040']],
    -1: [['Bone_052', 'Bone_051', 'Bone_050', 'Bone_049']],
}

# --- Die Armachse in Metern (Figur steht auf z = 0, Blick nach -y) -----------------------------------------------
# Brustpunkt, Schultergelenk, Ellbogen, Handgelenk, Handende (Fingeransatz). Von Hand aus dem Netz abgelesen
# (Querschnitte entlang der Arme); der linke Arm steht leicht nach vorn, der rechte gerade seitlich.
ARME = {
    1: {'brust': (0.10, -0.15, 1.06), 'schulter': (0.38, -0.13, 1.08), 'ellbogen': (0.79, -0.21, 0.95),
        'handgelenk': (0.90, -0.37, 0.72), 'handende': (0.99, -0.45, 0.61)},
    -1: {'brust': (-0.10, -0.03, 1.06), 'schulter': (-0.38, -0.03, 1.08), 'ellbogen': (-0.80, 0.00, 0.92),
         'handgelenk': (-0.92, 0.00, 0.72), 'handende': (-1.00, 0.00, 0.62)},
}
NAMEN = ('Schulter', 'Oberarm', 'Unterarm', 'Hand')

# --- Stellschrauben der Weights ---------------------------------------------------------------------------------
UEBERGANG = {'schulter': 0.11, 'ellbogen': 0.07, 'handgelenk': 0.05}  # halbe Breite der Blende am Gelenk, m
FINGER_VOR = 0.03       # Fingerweights beginnen so weit vor dem Handende
FINGER_BREITE = 0.07    # und sind nach so vielen Metern voll da
ROEHRE_VOLL = 0.13      # Abstand zur Armachse, bis zu dem ein Punkt voll zum Arm gehoert (m) ...
ROEHRE_SCHULTER = 0.19  # ... an der Schulter (dort ist der Arm dicker) ...
ROEHRE_AUS = 0.10       # ... und so viel weiter aussen gehoert er gar nicht mehr dazu
MASKE_VON, MASKE_BIS = 0.08, 0.40   # alte Weights auf Vorderbein/Fingern, ab denen ein Punkt als Arm in Frage kommt
GLAETTEN = 4            # Durchgaenge beim Glaetten der Weights an Schulter und Arm
GLAETTEN_ANTEIL = 0.5
MAX_EINFLUESSE = 4      # glTF kann nur vier Knochen je Punkt


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def punkt_strecke(P, a, b):
    """Kleinster Abstand und Parameter (0..1) jedes Punktes zur Strecke a-b."""
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0.0, 1.0)
    q = a + np.outer(t, ab)
    return np.linalg.norm(P - q, axis=1), t


def lade(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = next(o for o in bpy.data.objects if o.type == 'MESH' and len(o.vertex_groups) > 0)
    # Die Bone-Shapes, die der Importer als Hilfsnetze anlegt, loeschen.
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o is not mesh:
            bpy.data.objects.remove(o)
    return arm, mesh


def knochen_anlegen(arm):
    """Legt die acht Armknochen an und haengt die Fingerketten um."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    brust = eb[BRUST]
    for knochen, eltern in UMHAENGEN.items():
        eb[knochen].parent = eb[eltern]
        eb[knochen].use_connect = False
    for seite, pt in ARME.items():
        tag = 'L' if seite == 1 else 'R'
        punkte = [Vector(pt[k]) for k in ('brust', 'schulter', 'ellbogen', 'handgelenk', 'handende')]
        elter = brust
        for i, name in enumerate(NAMEN):
            b = eb.new(f'Arm_{tag}_{name}')
            b.head, b.tail = punkte[i], punkte[i + 1]
            b.use_connect = False
            b.parent = elter
            b.use_deform = True
            # Rollwinkel: Z-Achse des Knochens zeigt nach vorn (-y), damit die Knochenachsen links und rechts gleich liegen.
            b.align_roll(Vector((0, -1, 0)))
            elter = b
        hand = eb[f'Arm_{tag}_Hand']
        for kette in FINGER[seite]:
            eb[kette[0]].parent = hand
            eb[kette[0]].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')


def netz_daten(mesh):
    me = mesh.data
    co = np.array([v.co[:] for v in me.vertices])
    namen = {g.index: g.name for g in mesh.vertex_groups}
    # Gleiche Positionen (aufgespaltene Normalen/UV-Naehte) bilden einen Punkt, damit Weights nicht an Naehten reissen.
    schluessel = {}
    wid = np.zeros(len(co), dtype=int)
    for i, c in enumerate(np.round(co, 5)):
        wid[i] = schluessel.setdefault(tuple(c), len(schluessel))
    nw = len(schluessel)
    P = np.zeros((nw, 3))
    P[wid] = co
    # Nachbarschaft ueber die Dreiecke
    nach = [set() for _ in range(nw)]
    for p in me.polygons:
        vs = [wid[i] for i in p.vertices]
        for a, b in zip(vs, vs[1:] + vs[:1]):
            if a != b:
                nach[a].add(b)
                nach[b].add(a)
    return co, wid, P, nach, namen


def weights_lesen(mesh, wid, nw, namen):
    """Alte Weights je Punkt als {Gruppenname: Spalte}-Matrix."""
    spalten = {n: i for i, n in enumerate(sorted(namen.values()))}
    W = np.zeros((nw, len(spalten)))
    for v in mesh.data.vertices:
        for g in v.groups:
            W[wid[v.index], spalten[namen[g.group]]] = g.weight  # gleiche Punkte tragen gleiche Weights
    return W, spalten


def weights_rechnen(P, W, spalten):
    """Neue Weights fuer beide Arme. Gibt (W_neu, Spalten_neu, a) zurueck; a = Anteil Arm je Punkt (max beider Seiten)."""
    neue = [f'Arm_{t}_{n}' for t in 'LR' for n in NAMEN]
    sp = dict(spalten)
    for n in neue:
        sp[n] = len(sp)
    Wn = np.zeros((W.shape[0], len(sp)))
    Wn[:, :W.shape[1]] = W
    a_gesamt = np.zeros(W.shape[0])

    for seite in (1, -1):
        tag = 'L' if seite == 1 else 'R'
        pt = {k: np.array(v) for k, v in ARME[seite].items()}
        pol = [pt['brust'], pt['schulter'], pt['ellbogen'], pt['handgelenk'], pt['handende']]
        laengen = [np.linalg.norm(pol[i + 1] - pol[i]) for i in range(4)]
        s_gelenk = np.cumsum([0.0] + laengen)  # Bogenlaenge am Anfang jeder Strecke

        # Naechster Punkt auf der Armachse und dessen Bogenlaenge s.
        beste_d = np.full(len(P), np.inf)
        s = np.zeros(len(P))
        for i in range(4):
            d, t = punkt_strecke(P, pol[i], pol[i + 1])
            besser = d < beste_d
            beste_d = np.where(besser, d, beste_d)
            s = np.where(besser, s_gelenk[i] + t * laengen[i], s)
        # Hinter dem Handende: Fingerzone (s darf ueber das Ende hinaus wachsen).
        ende = pt['handende']
        richtung = (pt['handende'] - pt['handgelenk'])
        richtung /= np.linalg.norm(richtung)
        ueber = (P - ende) @ richtung
        s = np.where((beste_d < 0.35) & (ueber > 0), s_gelenk[4] + ueber, s)

        # Gelenkblenden: w_x = 0 vor dem Gelenk, 1 dahinter.
        wS = smoothstep(s, s_gelenk[1] - UEBERGANG['schulter'], s_gelenk[1] + UEBERGANG['schulter'])
        wE = smoothstep(s, s_gelenk[2] - UEBERGANG['ellbogen'], s_gelenk[2] + UEBERGANG['ellbogen'])
        wW = smoothstep(s, s_gelenk[3] - UEBERGANG['handgelenk'], s_gelenk[3] + UEBERGANG['handgelenk'])
        kette = np.stack([1 - wS, wS - wE, wE - wW, wW], axis=1)  # Schulter, Oberarm, Unterarm, Hand

        # Finger: alte Weights der Fingerknochen untereinander (welcher Finger ist wo), aber nur im Fingerbereich.
        finger_namen = [n for k in FINGER[seite] for n in k]
        fcols = [spalten[n] for n in finger_namen]
        fold = W[:, fcols]
        fsum = fold.sum(axis=1, keepdims=True)
        frel = np.divide(fold, fsum, out=np.zeros_like(fold), where=fsum > 1e-6)
        f = smoothstep(s, s_gelenk[4] - FINGER_VOR, s_gelenk[4] - FINGER_VOR + FINGER_BREITE) * (fsum[:, 0] > 1e-6)

        W_arm = np.zeros((len(P), len(sp)))
        for j, n in enumerate(NAMEN):
            W_arm[:, sp[f'Arm_{tag}_{n}']] = kette[:, j] * (1 - f)
        # In der Fingerzone bleibt auch die Hand etwas beteiligt, damit die Krallen nicht von der Hand abreissen.
        W_arm[:, sp[f'Arm_{tag}_Hand']] += f * 0.25
        for j, c in enumerate(fcols):
            W_arm[:, c] += frel[:, j] * f * 0.75

        # Zugehoerigkeit: nah an der Achse UND alte Weights auf Vorderbein/Fingern (schuetzt Rumpf, Kopf und Stacheln).
        alte_namen = VORDERBEIN[seite] + finger_namen
        m_alt = W[:, [spalten[n] for n in alte_namen]].sum(axis=1)
        m_alt = smoothstep(m_alt, MASKE_VON, MASKE_BIS)
        r_voll = ROEHRE_VOLL + (ROEHRE_SCHULTER - ROEHRE_VOLL) * (1 - smoothstep(s, s_gelenk[1], s_gelenk[2]))
        m_geo = 1 - smoothstep(beste_d, r_voll, r_voll + ROEHRE_AUS)
        a = m_geo * m_alt

        # Alte Weights ohne die Fingerknochen dieser Seite (die haengen jetzt am Arm und werden unten neu verteilt).
        W_alt = Wn.copy()
        W_alt[:, fcols] = 0
        zs = W_alt.sum(axis=1, keepdims=True)
        W_alt = np.divide(W_alt, zs, out=np.zeros_like(W_alt), where=zs > 1e-6)
        # Wo der Arm nur teilweise gilt, geht der Rest zurueck auf die alten Weights (Rumpf, Bein ...).
        Wn = np.where(a[:, None] > 0, a[:, None] * W_arm + (1 - a[:, None]) * W_alt, Wn)
        a_gesamt = np.maximum(a_gesamt, a)
    return Wn, sp, a_gesamt


def glaetten(Wn, nach, a):
    """Mittelt die Weights an Schulter und Arm mit ihren Nachbarn (nur dort, wo sich etwas geaendert hat)."""
    aktiv = np.where(a > 0.001)[0]
    for _ in range(GLAETTEN):
        neu = Wn.copy()
        for i in aktiv:
            nb = list(nach[i])
            if not nb:
                continue
            mittel = Wn[nb].mean(axis=0)
            neu[i] = (1 - GLAETTEN_ANTEIL) * Wn[i] + GLAETTEN_ANTEIL * mittel
        Wn = neu
    return Wn


def auf_vier_kuerzen(Wn):
    """Behaelt je Punkt nur die staerksten MAX_EINFLUESSE Knochen und normiert auf Summe 1."""
    idx = np.argsort(-Wn, axis=1)[:, MAX_EINFLUESSE:]
    out = Wn.copy()
    np.put_along_axis(out, idx, 0.0, axis=1)
    out[out < 0.005] = 0.0
    s = out.sum(axis=1, keepdims=True)
    return np.divide(out, s, out=np.zeros_like(out), where=s > 1e-9)


def weights_schreiben(mesh, wid, Wn, sp, a):
    names = {i: n for n, i in sp.items()}
    for n in sp:
        if n not in mesh.vertex_groups:
            mesh.vertex_groups.new(name=n)
    geaendert = np.zeros(Wn.shape[0], dtype=bool)
    geaendert[a > 0.001] = True
    n_geaendert = 0
    for v in mesh.data.vertices:
        w = wid[v.index]
        if not geaendert[w]:
            continue
        n_geaendert += 1
        for gi in [g.group for g in v.groups]:
            mesh.vertex_groups[gi].remove([v.index])
        for c in np.nonzero(Wn[w] > 0)[0]:
            mesh.vertex_groups[names[c]].add([v.index], float(Wn[w, c]), 'REPLACE')
    return n_geaendert


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) < 2:
        raise SystemExit('Aufruf: ... -- quelle.glb ziel.glb')
    src, dst = args[0], args[1]
    arm, mesh = lade(src)
    knochen_anlegen(arm)
    co, wid, P, nach, namen = netz_daten(mesh)
    W, spalten = weights_lesen(mesh, wid, len(P), namen)
    Wn, sp, a = weights_rechnen(P, W, spalten)
    Wn = glaetten(Wn, nach, a)
    Wn = auf_vier_kuerzen(Wn)
    n = weights_schreiben(mesh, wid, Wn, sp, a)
    print(f'{int((a > 0.001).sum())} von {len(P)} Punkten gehoeren (teilweise) zum Arm; {n} Netzpunkte neu bewertet')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', export_image_format='AUTO', export_yup=True, export_apply=False,
        export_animations=False, export_skins=True, export_morph=False, export_lights=False, export_cameras=False)
    print('geschrieben:', dst)


main()
