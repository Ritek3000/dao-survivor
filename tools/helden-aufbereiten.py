"""
Bereitet die GLB-Datei einer Spielfigur fuer das Spiel auf: kleinere Texturen und, wenn gewuenscht, Clips aus einer
anderen Datei.

Die Meshy-Exporte der Spielfiguren sind knapp 20 MB gross, fast alles davon sind drei 2048er-PNG-Texturen. Dieses Skript
liest die GLB, verkleinert die Texturen (Farbe und Metall/Rauheit als JPEG, die Normalenkarte als PNG, weil JPEG-Rauschen in
Normalen als Falten sichtbar wird) und schreibt die GLB neu. Netz, Skelett und Animationen bleiben unveraendert, soweit
nichts anderes verlangt ist.

Es braucht kein Blender, nur Python 3 mit Pillow und NumPy:

  python tools/helden-aufbereiten.py quelle.glb ziel.glb
  python tools/helden-aufbereiten.py quelle.glb ziel.glb --textur 1024 --clip-aus public/models/magier.glb --clip Idle_02 --clip mage_soell_cast --ohne Idle

--textur: Kantenlaenge der Texturen in Pixeln (Vorgabe 1024; 0 laesst sie unveraendert).
--clip-aus, --clip: Uebertraegt Clips von einer anderen Figur (--clip darf mehrfach stehen). Gedacht fuer Clips, die es nicht in
der Bibliothek von Meshy gibt, etwa mage_soell_cast des Magiers fuer die Magierin, und fuer den Leerlauf der Maenner (Idle_02):
In dieser Haltung sind Axt, Bogen und Buch der Maenner ausgemessen, die Frauen sollen so stehen wie sie. Uebertragen werden nur
die Drehungen der Knochen, nach Knochennamen. Beide Figuren muessen dasselbe Skelett aus Meshys Autorig haben (gleiche
Knochennamen und gleiche Achsen der Knochen in der Ruhepose). Uebertragen werden nicht die Drehungen selbst, sondern ihr Abstand
zur Ruhepose: Die Frau hat andere Proportionen und leicht andere Ruhedrehungen als der Mann, die Bewegung soll aber dieselbe
bleiben. Verschiebungen und Skalierungen entfallen, die Knochen behalten dann ihre Laenge.
--ohne: Entfernt einen Clip der Quelle mit genau diesem Namen (etwa den Leerlauf "Idle" aus Meshys Bibliothek, wenn der des
Mannes ihn ersetzt); --ohne darf mehrfach stehen. Die Daten, auf die danach nichts mehr zeigt, fallen aus der Datei.
"""
import argparse
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
FLOAT = 5126


def read_glb(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    magic, _version, _length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        raise SystemExit(path + ': keine GLB-Datei')
    offset = 12
    document = None
    binary = b''
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + size]
        offset += size
        if kind == JSON_CHUNK:
            document = json.loads(chunk)
        elif kind == BIN_CHUNK:
            binary = chunk
    if document is None:
        raise SystemExit(path + ': kein JSON-Teil')
    return document, binary


def write_glb(path, document, views):
    """views: die neuen Inhalte aller bufferViews in ihrer Reihenfolge; die Offsets werden hier gesetzt."""
    blob = bytearray()
    for view, data in zip(document['bufferViews'], views):
        while len(blob) % 4:
            blob.append(0)
        view['buffer'] = 0
        view['byteOffset'] = len(blob)
        view['byteLength'] = len(data)
        blob.extend(data)
    while len(blob) % 4:
        blob.append(0)
    document['buffers'] = [{'byteLength': len(blob)}]
    text = json.dumps(document, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(path, 'wb') as handle:
        handle.write(struct.pack('<4sII', b'glTF', 2, total))
        handle.write(struct.pack('<II', len(text), JSON_CHUNK))
        handle.write(text)
        handle.write(struct.pack('<II', len(blob), BIN_CHUNK))
        handle.write(blob)


def view_bytes(document, binary, index):
    view = document['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']]


def image_roles(document):
    """Welche Rolle jedes Bild im Material spielt: 'farbe', 'normal' oder 'metall' (Metall und Rauheit)."""
    textures = document.get('textures', [])
    roles = {}
    for material in document.get('materials', []):
        pbr = material.get('pbrMetallicRoughness', {})
        for key, role in (
            (pbr.get('baseColorTexture'), 'farbe'),
            (material.get('normalTexture'), 'normal'),
            (pbr.get('metallicRoughnessTexture'), 'metall'),
        ):
            if key is not None:
                roles[textures[key['index']]['source']] = role
    return roles


def shrink_textures(document, binary, views, size, quality=88):
    roles = image_roles(document)
    for index, image in enumerate(document.get('images', [])):
        original = view_bytes(document, binary, image['bufferView'])
        picture = Image.open(io.BytesIO(original))
        picture.load()
        before = len(original)
        if size and max(picture.size) > size:
            picture = picture.resize((size, size * picture.height // picture.width), Image.LANCZOS)
        role = roles.get(index, 'farbe')
        out = io.BytesIO()
        if role == 'normal':
            picture.convert('RGB').save(out, 'PNG', optimize=True)
            image['mimeType'] = 'image/png'
        else:
            picture.convert('RGB').save(out, 'JPEG', quality=quality, optimize=True, subsampling=0)
            image['mimeType'] = 'image/jpeg'
        views[image['bufferView']] = out.getvalue()
        print('  Bild %d (%s): %d x %d, %.2f MB -> %.2f MB' % (
            index, role, picture.width, picture.height, before / 1048576, len(out.getvalue()) / 1048576))


# --- Quaternionen als Zeilen (x, y, z, w) ---------------------------------------------------------------------------

def q_mul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], axis=-1)


def q_inverse(q):
    return q * np.array([-1.0, -1.0, -1.0, 1.0])


def q_normalize(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def read_accessor(document, binary, index):
    accessor = document['accessors'][index]
    if accessor['componentType'] != FLOAT or 'sparse' in accessor:
        raise SystemExit('Nur Gleitkomma-Zugriffe ohne Sparse werden gelesen.')
    width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    view = document['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    count = accessor['count']
    stride = view.get('byteStride', width * 4)
    if stride == width * 4:
        flat = np.frombuffer(binary, dtype='<f4', count=count * width, offset=start)
        return flat.reshape(count, width).astype(np.float64)
    rows = [np.frombuffer(binary, dtype='<f4', count=width, offset=start + i * stride) for i in range(count)]
    return np.array(rows, dtype=np.float64)


def add_accessor(document, views, values, kind):
    data = np.asarray(values, dtype='<f4')
    views.append(data.tobytes())
    document['bufferViews'].append({'buffer': 0, 'byteOffset': 0, 'byteLength': len(views[-1])})
    accessor = {
        'bufferView': len(document['bufferViews']) - 1,
        'componentType': FLOAT,
        'count': int(data.shape[0]),
        'type': kind,
    }
    if kind == 'SCALAR':
        accessor['min'] = [float(data.min())]
        accessor['max'] = [float(data.max())]
    document['accessors'].append(accessor)
    return len(document['accessors']) - 1


def rest_rotation(node):
    return np.array(node.get('rotation', [0.0, 0.0, 0.0, 1.0]), dtype=np.float64)


def copy_clip(document, views, source, source_binary, source_path, clip_name):
    animation = next((a for a in source.get('animations', []) if clip_name.lower() in a.get('name', '').lower()), None)
    if animation is None:
        raise SystemExit('%s hat keinen Clip "%s".' % (source_path, clip_name))
    if any(a.get('name') == animation['name'] for a in document.get('animations', [])):
        raise SystemExit('Die Datei hat den Clip "%s" schon.' % animation['name'])
    target_nodes = {node['name']: index for index, node in enumerate(document['nodes']) if 'name' in node}

    inputs = {}
    samplers = []
    channels = []
    skipped = []
    for channel in animation['channels']:
        if channel['target']['path'] != 'rotation':
            continue
        sampler = animation['samplers'][channel['sampler']]
        if sampler.get('interpolation', 'LINEAR') != 'LINEAR':
            raise SystemExit('Nur lineare Clips werden uebertragen.')
        source_node = source['nodes'][channel['target']['node']]
        name = source_node.get('name')
        if name not in target_nodes:
            skipped.append(name)
            continue
        target_node = document['nodes'][target_nodes[name]]
        rotations = read_accessor(source, source_binary, sampler['output'])
        delta = q_mul(q_inverse(rest_rotation(source_node)), rotations)
        moved = q_normalize(q_mul(rest_rotation(target_node), delta))
        # Zwei Drehungen sind dieselbe, wenn sie sich im Vorzeichen unterscheiden; die Mischung zwischen Bildern soll den kurzen Weg nehmen.
        for i in range(1, len(moved)):
            if np.dot(moved[i], moved[i - 1]) < 0:
                moved[i] = -moved[i]
        if sampler['input'] not in inputs:
            inputs[sampler['input']] = add_accessor(document, views, read_accessor(source, source_binary, sampler['input'])[:, 0], 'SCALAR')
        samplers.append({'input': inputs[sampler['input']], 'output': add_accessor(document, views, moved, 'VEC4'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': target_nodes[name], 'path': 'rotation'}})
    if skipped:
        print('  Knochen ohne Gegenstueck, uebersprungen: ' + ', '.join(sorted(set(skipped))))
    document.setdefault('animations', []).append({'name': animation['name'], 'samplers': samplers, 'channels': channels})
    print('  Clip %s: %d Knochen uebertragen' % (animation['name'], len(channels)))


def drop_clips(document, names):
    """Entfernt die Clips mit genau diesen Namen; ihre Zugriffe bleiben zunaechst liegen (siehe prune)."""
    animations = document.get('animations', [])
    for name in names:
        if not any(a.get('name') == name for a in animations):
            raise SystemExit('Die Datei hat keinen Clip "%s", der sich entfernen liesse.' % name)
        animations[:] = [a for a in animations if a.get('name') != name]
        print('  Clip %s entfernt' % name)


def prune(document, views):
    """Entfernt Zugriffe und bufferViews, auf die nichts mehr zeigt, und setzt die Nummern neu."""
    if document.get('extensionsUsed') or any('sparse' in a for a in document['accessors']):
        raise SystemExit('Aufraeumen kennt nur Dateien ohne Erweiterungen und ohne Sparse-Zugriffe.')
    used = set()
    for mesh in document.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            used.update(primitive.get('attributes', {}).values())
            if 'indices' in primitive:
                used.add(primitive['indices'])
            for target in primitive.get('targets', []):
                used.update(target.values())
    for skin in document.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used.add(skin['inverseBindMatrices'])
    for animation in document.get('animations', []):
        for sampler in animation['samplers']:
            used.update((sampler['input'], sampler['output']))
    accessor_map = {old: new for new, old in enumerate(sorted(used))}

    view_used = {document['accessors'][old]['bufferView'] for old in used}
    view_used.update(image['bufferView'] for image in document.get('images', []))
    view_map = {old: new for new, old in enumerate(sorted(view_used))}

    def remap(mapping, mapped):
        return {key: mapping[value] for key, value in mapped.items()}

    for mesh in document.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            primitive['attributes'] = remap(accessor_map, primitive['attributes'])
            if 'indices' in primitive:
                primitive['indices'] = accessor_map[primitive['indices']]
            if 'targets' in primitive:
                primitive['targets'] = [remap(accessor_map, target) for target in primitive['targets']]
    for skin in document.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = accessor_map[skin['inverseBindMatrices']]
    for animation in document.get('animations', []):
        for sampler in animation['samplers']:
            sampler['input'] = accessor_map[sampler['input']]
            sampler['output'] = accessor_map[sampler['output']]
    document['accessors'] = [document['accessors'][old] for old in sorted(used)]
    for accessor in document['accessors']:
        accessor['bufferView'] = view_map[accessor['bufferView']]
    for image in document.get('images', []):
        image['bufferView'] = view_map[image['bufferView']]
    document['bufferViews'] = [document['bufferViews'][old] for old in sorted(view_used)]
    views[:] = [views[old] for old in sorted(view_used)]


def main():
    parser = argparse.ArgumentParser(description='Texturen verkleinern und Clips uebertragen')
    parser.add_argument('quelle')
    parser.add_argument('ziel')
    parser.add_argument('--textur', type=int, default=1024)
    parser.add_argument('--clip-aus', dest='clip_aus')
    parser.add_argument('--clip', action='append', default=[])
    parser.add_argument('--ohne', action='append', default=[])
    args = parser.parse_args()
    if bool(args.clip_aus) != bool(args.clip):
        raise SystemExit('--clip-aus und --clip gehoeren zusammen.')

    document, binary = read_glb(args.quelle)
    views = [view_bytes(document, binary, i) for i in range(len(document['bufferViews']))]
    print(args.quelle)
    shrink_textures(document, binary, views, args.textur)
    drop_clips(document, args.ohne)
    if args.clip_aus:
        source, source_binary = read_glb(args.clip_aus)
        for name in args.clip:
            copy_clip(document, views, source, source_binary, args.clip_aus, name)
    if args.ohne:
        prune(document, views)
    write_glb(args.ziel, document, views)
    print('-> %s (%.2f MB)' % (args.ziel, len(open(args.ziel, 'rb').read()) / 1048576))


if __name__ == '__main__':
    sys.exit(main())
