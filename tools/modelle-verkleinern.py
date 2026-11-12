"""
Macht aus den schweren Meshy-Exporten spielfertige Kopien fuer die Welt (Felsen, Totholz,
Feuerschale, Edelsteine): wenige Tausend Dreiecke, kleine Texturen, nur die Farbtextur.

Laeuft in einem eigenen Blender-Prozess ohne Fenster, nicht im offenen Blender:

  blender.exe --background --factory-startup --python tools/modelle-verkleinern.py
  blender.exe --background --factory-startup --python tools/modelle-verkleinern.py -- fels-brocken.glb

Ohne Namen werden alle Auftraege aus modelle-verkleinern.json abgearbeitet, sonst nur die genannten.
Die Originale liegen im Ordner modelle-original und werden nur gelesen; die Kopien landen in
public/models (laut Auftragsliste im Unterordner welt). In der Liste steht 'src' relativ zu
modelle-original und 'dst' relativ zu public/models.
"""
import json
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
# Die schweren Originale liegen ausserhalb von public, damit sie nicht im fertigen Spiel landen.
ORIGINALS = os.path.normpath(os.path.join(HERE, '..', 'modelle-original'))
MODELS = os.path.normpath(os.path.join(HERE, '..', 'public', 'models'))


def triangle_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def reduce(src, dst, target, tex, keep_normal, quality=85):
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('kein Netz in der Datei')
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    obj = meshes[0]
    bpy.context.view_layer.objects.active = obj
    if len(meshes) > 1:
        bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    before = triangle_count(obj.data)
    if before > target:
        # Netze aus vielen losen Schalen (Rinde, Geroell) lassen sich nicht beliebig weit
        # zusammenlegen; sie bleiben dann ueber dem Ziel. Fuer das Spiel reicht das.
        mod = obj.modifiers.new('verkleinern', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = target / before
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()
    mesh = obj.data
    after = triangle_count(mesh)

    # Nur die Farbtextur bleibt (und auf Wunsch die Normalenkarte); nichts leuchtet, nichts ist Metall.
    images = set()
    for mat in mesh.materials:
        if not mat or not mat.node_tree:
            continue
        tree = mat.node_tree
        for node in tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            for name, socket in node.inputs.items():
                keep = name == 'Base Color' or (keep_normal and name == 'Normal')
                if not keep:
                    for link in list(socket.links):
                        tree.links.remove(link)
            for name, value in (('Metallic', 0.0), ('Roughness', 0.9), ('Emission Strength', 0.0), ('Alpha', 1.0)):
                if name in node.inputs:
                    node.inputs[name].default_value = value
            stack = [link.from_node for socket in node.inputs for link in socket.links]
            while stack:
                n = stack.pop()
                if n.type == 'TEX_IMAGE' and n.image:
                    images.add(n.image)
                stack.extend(link.from_node for socket in n.inputs for link in socket.links)

    sizes = []
    for img in images:
        w, h = img.size
        if max(w, h) > tex:
            scale = tex / max(w, h)
            img.scale(max(1, int(w * scale)), max(1, int(h * scale)))
        sizes.append('%s %dx%d->%dx%d' % (img.name, w, h, img.size[0], img.size[1]))

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_image_format='JPEG',
        export_image_quality=quality,
        export_jpeg_quality=quality,
        export_tangents=False,
        export_materials='EXPORT',
        export_unused_images=False,
    )
    return {
        'dreiecke': '%d -> %d' % (before, after),
        'bilder': sizes,
        'kb': round(os.path.getsize(dst) / 1024),
        'sekunden': round(time.time() - started, 1),
    }


def main():
    only = set(sys.argv[sys.argv.index('--') + 1:]) if '--' in sys.argv else set()
    jobs = json.load(open(os.path.join(HERE, 'modelle-verkleinern.json'), encoding='utf-8'))
    for job in jobs:
        name = os.path.basename(job['dst'])
        if only and name not in only:
            continue
        try:
            report = reduce(
                os.path.join(ORIGINALS, job['src']),
                os.path.join(MODELS, job['dst']),
                job['tris'],
                job['tex'],
                job.get('normal', False),
            )
        except Exception as error:  # eine kaputte Datei haelt die anderen nicht auf
            report = {'fehler': repr(error)}
        print('ERGEBNIS', name, json.dumps(report, ensure_ascii=False), flush=True)


main()
