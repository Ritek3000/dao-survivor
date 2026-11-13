/**
 * Lädt die GLB-Modelle und bringt sie in die Form, die das Spiel braucht.
 *
 * Die Dateien kommen aus verschiedenen Exportwegen: mal in Metern, mal einen Zentimeter groß,
 * mal mit selbstleuchtendem Material, mal mit dem Drehpunkt an der Hüfte. Das wird hier
 * ausgeglichen, damit niemand die Dateien von Hand nachbearbeiten muss.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, type EnemyModel, type EnemyType, type SceneryModel } from '../config';
import { CLASSES, type ClassDef, type ClassId } from './classes';
import { swallowedByFinsternis } from './darkness';
import { equip, type Gear } from './gear';

/**
 * Ein Clip in drei Fassungen. Beim Angriff im Laufen führen die Beine weiter die Laufbewegung aus,
 * während der Oberkörper zuschlägt; dafür braucht es beide Hälften einzeln.
 */
export interface LayeredClip {
  full: THREE.AnimationClip;
  /** Nur die Knochen oberhalb der Hüfte. */
  upper: THREE.AnimationClip;
  /** Hüfte und Beine. */
  lower: THREE.AnimationClip;
}

/** Die Spielfigur gibt es einmal: volles Skelett, Animationen werden überblendet. */
export interface HeroModel {
  /** Füße auf Höhe 0, Blick nach +Z, in der Größe der Klasse. */
  root: THREE.Group;
  height: number;
  materials: THREE.MeshStandardMaterial[];
  idle: LayeredClip | null;
  run: LayeredClip | null;
  dead: THREE.AnimationClip | null;
  /** Alle Clips der Datei, für die Angriffe. */
  clips: LayeredClip[];
  /** Die Waffe in der Hand; fehlt, wenn das Skelett keine Handknochen hat. */
  gear: Gear | null;
  /** Was die andere Hand hält, etwa der Schild des Kämpfers. */
  offhand: Gear | null;
}

/** Sucht einen Clip nach seinem Namen oder einem Teil davon. */
export function clipNamed(model: HeroModel, name: string): LayeredClip | null {
  const wanted = name.toLowerCase();
  return (
    model.clips.find((clip) => clip.full.name.toLowerCase() === wanted) ??
    model.clips.find((clip) => clip.full.name.toLowerCase().includes(wanted)) ??
    null
  );
}

/**
 * Gegner gibt es zu Hunderten. Ihre Laufbewegung wird einmal ausgerechnet und als Textur
 * abgelegt (je Bild und Eckpunkt eine Position); die Grafikkarte liest sie beim Zeichnen aus.
 * So kostet ein Gegner kein Skelett und alle einer Art zusammen einen Zeichenaufruf.
 */
export interface HordeModel {
  /** Eckpunkte des ersten Bildes, Texturkoordinaten und Dreiecke. */
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  side: THREE.Side;
  positions: THREE.DataTexture;
  normals: THREE.DataTexture;
  /** x = Breite der Textur, y = Zeilen je Bild, z = Anzahl der Bilder (alle Clips zusammen). */
  layout: THREE.Vector3;
  /** Die Schleife: Gehen, bei Schwebenden das Schweben. */
  loop: HordeClip;
  /** Der Zauber, falls die Art einen hat. */
  cast: HordeClip | null;
  /** Der Hieb, falls die Art zuschlägt. */
  strike: HordeClip | null;
}

/** Ein Clip in der Bewegungstextur. Hinter seinen Bildern liegt ein Schlussbild, damit das Überblenden nie in den nächsten Clip greift. */
export interface HordeClip {
  /** Erstes Bild des Clips in der Textur. */
  start: number;
  /** Anzahl der Bilder ohne das Schlussbild. */
  frames: number;
  /** Dauer des Clips in der Datei; dem Zauber dient sie nur als Maß, im Spiel wird er auf die Zauberzeit gedehnt. */
  seconds: number;
}

/** Ein unbewegter Gegenstand der Welt: Fels, Totholz, Feuerschale, Edelstein. */
export interface PropModel {
  /**
   * Steht auf dem Boden, in der Mitte, und ist auf das Maß 1 gebracht:
   * bei Kulissen der größte Durchmesser am Boden, bei allem anderen die Höhe.
   */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Höhe und größter Durchmesser am Boden im selben Maß. */
  height: number;
  width: number;
  /**
   * Dünne Gebilde wie Grashalme beschatten sich selbst zu schwarzen Strichen;
   * mit `false` werfen sie Schatten, nehmen aber keine an.
   */
  receiveShadow?: boolean;
}

/** Der Verschlinger kommt einmal: volles Skelett wie die Spielfigur, mit allen Clips der Datei. */
export interface BossModel {
  /** Füße auf Höhe 0, Blick nach +Z, in der Größe aus der Konfiguration. */
  root: THREE.Group;
  height: number;
  materials: THREE.MeshStandardMaterial[];
  clips: THREE.AnimationClip[];
}

export interface Models {
  heroes: Map<ClassId, HeroModel>;
  hordes: Map<EnemyType, HordeModel>;
  boss: BossModel | null;
  /** Gegenstände der Welt, nach Dateiname. */
  props: Map<string, PropModel>;
  /** Dateien, die fehlten oder sich nicht lesen ließen; dafür bleibt der Platzhalter stehen. */
  failed: string[];
}

/** Bilder je Sekunde, mit denen die Laufbewegung der Gegner abgelegt wird. */
const BAKE_FPS = 30;
/**
 * Wer schwebt, bewegt sich langsam und weich; die Grafikkarte blendet zwischen den Bildern über. Mit der Hälfte der
 * Bilder spart die Schleife Grafikspeicher, ohne dass man es sieht (bei diesem Netz kostet jedes Bild gut 0,2 MB
 * für Positionen und Normalen).
 */
const HOVER_FPS = 15;
/** Breite der Bewegungstextur; mehr Eckpunkte laufen in weitere Zeilen. */
const BAKE_WIDTH = 1024;

const loader = new GLTFLoader();

function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function findClip<T>(clips: readonly T[], name: (clip: T) => string, pattern: RegExp): T | null {
  return clips.find((clip) => pattern.test(name(clip))) ?? null;
}

/**
 * Namen aller Knochen oberhalb der Hüfte: der Ast des Skeletts, an dem die Hände hängen.
 * Hüfte, Beine und was sonst an der Hüfte sitzt (etwa ein Rock) gehören zur unteren Hälfte.
 */
function upperBodyBones(scene: THREE.Object3D): Set<string> {
  const hands: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Bone && /^hand/i.test(object.name)) hands.push(object);
  });
  const names = new Set<string>();
  let branch = hands[0];
  if (!branch) return names;
  // Aufwärts bis zu dem Knochen, der direkt an der Hüfte sitzt.
  while (branch.parent instanceof THREE.Bone && branch.parent.parent instanceof THREE.Bone) branch = branch.parent;
  branch.traverse((bone) => names.add(bone.name));
  return names;
}

function layered(clip: THREE.AnimationClip, upperBones: ReadonlySet<string>): LayeredClip {
  // Eine Spur heißt wie ihr Knochen, gefolgt von dem, was sie bewegt: "handR.quaternion".
  const isUpper = (track: THREE.KeyframeTrack): boolean => upperBones.has(track.name.slice(0, track.name.lastIndexOf('.')));
  return {
    full: clip,
    upper: new THREE.AnimationClip(`${clip.name}|oben`, clip.duration, clip.tracks.filter(isUpper)),
    lower: new THREE.AnimationClip(
      `${clip.name}|unten`,
      clip.duration,
      clip.tracks.filter((track) => !isUpper(track)),
    ),
  };
}

/**
 * Baut das Material neu auf, sodass es nur noch vom Licht der Welt lebt.
 * Manche Exporte legen die Farbtextur zusätzlich als Leuchten an und stellen das Material
 * voll metallisch: Solche Figuren blieben in der Finsternis hell.
 */
function litMaterial(source: THREE.Material, detailed: boolean): THREE.MeshStandardMaterial {
  const from = source as Partial<THREE.MeshStandardMaterial>;
  const material = new THREE.MeshStandardMaterial({
    map: from.map ?? null,
    color: from.color ?? 0xffffff,
    side: source.side,
    roughness: 0.9,
    metalness: 0,
  });
  if (detailed) {
    material.normalMap = from.normalMap ?? null;
    if (from.normalScale) material.normalScale.copy(from.normalScale);
    material.roughnessMap = from.roughnessMap ?? null;
    if (from.roughnessMap) material.roughness = from.roughness ?? 1;
    // Ohne Karte gilt in GLB "voll metallisch" als Vorgabe; ohne Umgebung zum Spiegeln wäre das schwarz.
    material.metalnessMap = from.metalnessMap ?? null;
    if (from.metalnessMap) material.metalness = from.metalness ?? 1;
  }
  return material;
}

/** Die Eckpunkte eines Netzes mit Skelett, ausgerechnet für die Pose, in der es gerade steht. */
class PoseSampler {
  readonly count: number;
  private readonly restPositions: Float32Array;
  private readonly restNormals: Float32Array;
  private readonly boneIndices: Uint16Array;
  private readonly boneWeights: Float32Array;
  private readonly boneMatrices: Float32Array;
  private readonly matrix = new THREE.Matrix4();
  private readonly toWorld = new THREE.Matrix4();

  constructor(private readonly mesh: THREE.SkinnedMesh) {
    const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
    if (!position || !normal || !skinIndex || !skinWeight) throw new Error('Dem Netz fehlen Positionen, Normalen oder Gewichte.');
    this.count = position.count;
    this.restPositions = new Float32Array(this.count * 3);
    this.restNormals = new Float32Array(this.count * 3);
    this.boneIndices = new Uint16Array(this.count * 4);
    this.boneWeights = new Float32Array(this.count * 4);
    this.boneMatrices = new Float32Array(mesh.skeleton.bones.length * 16);
    for (let i = 0; i < this.count; i++) {
      this.restPositions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      this.restNormals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
      const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
      this.boneIndices.set([skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)], i * 4);
      this.boneWeights.set(
        weights.map((weight) => weight / sum),
        i * 4,
      );
    }
  }

  /** Schreibt Position und Normale jedes Eckpunkts als je vier Werte (der vierte bleibt frei) ab `offset`. */
  sample(positions: Float32Array, normals: Float32Array, offset: number): void {
    const { mesh, matrix, boneMatrices } = this;
    const { bones, boneInverses } = mesh.skeleton;
    this.toWorld.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    bones.forEach((bone, index) => {
      const inverse = boneInverses[index];
      if (!inverse) return;
      matrix.multiplyMatrices(bone.matrixWorld, inverse).multiply(mesh.bindMatrix).premultiply(this.toWorld);
      matrix.toArray(boneMatrices, index * 16);
    });

    const m = boneMatrices;
    for (let i = 0; i < this.count; i++) {
      const px = this.restPositions[i * 3] as number;
      const py = this.restPositions[i * 3 + 1] as number;
      const pz = this.restPositions[i * 3 + 2] as number;
      const nx = this.restNormals[i * 3] as number;
      const ny = this.restNormals[i * 3 + 1] as number;
      const nz = this.restNormals[i * 3 + 2] as number;
      let x = 0;
      let y = 0;
      let z = 0;
      let a = 0;
      let b = 0;
      let c = 0;
      for (let k = 0; k < 4; k++) {
        const weight = this.boneWeights[i * 4 + k] as number;
        if (weight === 0) continue;
        const o = (this.boneIndices[i * 4 + k] as number) * 16;
        const m0 = m[o] as number;
        const m1 = m[o + 1] as number;
        const m2 = m[o + 2] as number;
        const m4 = m[o + 4] as number;
        const m5 = m[o + 5] as number;
        const m6 = m[o + 6] as number;
        const m8 = m[o + 8] as number;
        const m9 = m[o + 9] as number;
        const m10 = m[o + 10] as number;
        x += weight * (m0 * px + m4 * py + m8 * pz + (m[o + 12] as number));
        y += weight * (m1 * px + m5 * py + m9 * pz + (m[o + 13] as number));
        z += weight * (m2 * px + m6 * py + m10 * pz + (m[o + 14] as number));
        a += weight * (m0 * nx + m4 * ny + m8 * nz);
        b += weight * (m1 * nx + m5 * ny + m9 * nz);
        c += weight * (m2 * nx + m6 * ny + m10 * nz);
      }
      const length = Math.hypot(a, b, c) || 1;
      const at = offset + i * 4;
      positions[at] = x;
      positions[at + 1] = y;
      positions[at + 2] = z;
      normals[at] = a / length;
      normals[at + 1] = b / length;
      normals[at + 2] = c / length;
    }
  }
}

function firstSkinnedMesh(scene: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  scene.traverse((object) => {
    if (!found && object instanceof THREE.SkinnedMesh) found = object;
  });
  if (!found) throw new Error('Kein Netz mit Skelett in der Datei.');
  return found;
}

function bakedTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Rechnet die Bewegungen einer Gegnerart einmal aus und legt sie als Textur ab: zuerst die Schleife (Gehen oder
 * Schweben), danach, falls es sie gibt, der Zauber und der Hieb. Jeder Clip bekommt ein Bild mehr als er Bilder hat: Bei
 * der Schleife ist es eine Kopie des ersten (sie schließt an), bei Zauber und Hieb das Endbild.
 */
function bakeHorde(gltf: GLTF, spec: EnemyModel): HordeModel {
  const scene = gltf.scene;
  const mesh = firstSkinnedMesh(scene);
  const sampler = new PoseSampler(mesh);
  const loopClip = gltf.animations.find((candidate) => candidate.name === spec.clip) ?? gltf.animations[0] ?? null;
  const castClip = spec.castClip ? (gltf.animations.find((candidate) => candidate.name === spec.castClip) ?? null) : null;
  if (spec.castClip && !castClip) console.warn(`Animation ${spec.castClip} fehlt in ${spec.file}.`);
  const strikeClip = spec.strikeClip ? (gltf.animations.find((candidate) => candidate.name === spec.strikeClip) ?? null) : null;
  if (spec.strikeClip && !strikeClip) console.warn(`Animation ${spec.strikeClip} fehlt in ${spec.file}.`);

  const clipFrames = (clip: THREE.AnimationClip | null, fps: number): number =>
    clip ? Math.max(1, Math.round(clip.duration * fps)) : 1;
  const loop: HordeClip = {
    start: 0,
    frames: clipFrames(loopClip, spec.hover ? HOVER_FPS : BAKE_FPS),
    seconds: loopClip?.duration ?? 1,
  };
  // Zauber und Hieb liegen hinter der Schleife, jeder mit seinem Schlussbild.
  let next = loop.frames + 1;
  const oneShot = (clip: THREE.AnimationClip | null): HordeClip | null => {
    if (!clip) return null;
    const segment: HordeClip = { start: next, frames: clipFrames(clip, BAKE_FPS), seconds: clip.duration };
    next += segment.frames + 1;
    return segment;
  };
  const cast = oneShot(castClip);
  const strike = oneShot(strikeClip);
  const total = next;

  const width = Math.min(sampler.count, BAKE_WIDTH);
  const rows = Math.ceil(sampler.count / width);
  const frameSize = width * rows * 4;
  const positions = new Float32Array(frameSize * total);
  const normals = new Float32Array(frameSize * total);

  const mixer = new THREE.AnimationMixer(scene);
  const bake = (clip: THREE.AnimationClip | null, segment: HordeClip, repeats: boolean): void => {
    mixer.stopAllAction();
    if (clip) {
      const action = mixer.clipAction(clip).reset();
      // Das Schlussbild des Zaubers ist sein letzter Zustand; eine Schleife käme dort wieder am Anfang an.
      if (!repeats) action.setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
      action.play();
    }
    for (let frame = 0; frame < segment.frames; frame++) {
      // Das letzte Bild einer Schleife schließt an das erste an, deshalb wird die Dauer nicht ganz ausgeschöpft.
      if (clip) mixer.setTime((frame / segment.frames) * clip.duration);
      scene.updateMatrixWorld(true);
      sampler.sample(positions, normals, (segment.start + frame) * frameSize);
    }
    const last = (segment.start + segment.frames) * frameSize;
    if (repeats || !clip) {
      positions.copyWithin(last, segment.start * frameSize, (segment.start + 1) * frameSize);
      normals.copyWithin(last, segment.start * frameSize, (segment.start + 1) * frameSize);
    } else {
      mixer.setTime(clip.duration);
      scene.updateMatrixWorld(true);
      sampler.sample(positions, normals, last);
    }
  };
  bake(loopClip, loop, true);
  if (cast) bake(castClip, cast, false);
  if (strike) bake(strikeClip, strike, false);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // Hüllbox über den ganzen Lauf: Daran werden Größe, Bodenhöhe und Mitte ausgerichtet. Zauber und Hieb gehen nicht
  // ein: Mit erhobenen Armen wäre die Figur sonst höher als beim Gehen und würde kleiner eingemessen.
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let frame = 0; frame < loop.frames; frame++) {
    for (let i = 0; i < sampler.count; i++) {
      const at = frame * frameSize + i * 4;
      box.expandByPoint(point.set(positions[at] as number, positions[at + 1] as number, positions[at + 2] as number));
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = size.y > 0 ? spec.height / size.y : 1;
  const lift = spec.hover?.lift ?? 0;
  for (let frame = 0; frame < total; frame++) {
    for (let i = 0; i < sampler.count; i++) {
      const at = frame * frameSize + i * 4;
      positions[at] = ((positions[at] as number) - center.x) * scale;
      positions[at + 1] = ((positions[at + 1] as number) - box.min.y) * scale + lift;
      positions[at + 2] = ((positions[at + 2] as number) - center.z) * scale;
    }
  }

  const geometry = new THREE.BufferGeometry();
  const firstPositions = new Float32Array(sampler.count * 3);
  const firstNormals = new Float32Array(sampler.count * 3);
  for (let i = 0; i < sampler.count; i++) {
    for (let k = 0; k < 3; k++) {
      firstPositions[i * 3 + k] = positions[i * 4 + k] as number;
      firstNormals[i * 3 + k] = normals[i * 4 + k] as number;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(firstPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(firstNormals, 3));
  const uv = mesh.geometry.getAttribute('uv');
  if (uv) geometry.setAttribute('uv', uv.clone());
  if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
  const halfWidth = Math.max(size.x, size.z) * scale * 0.5;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-halfWidth, 0, -halfWidth),
    new THREE.Vector3(halfWidth, spec.height + lift, halfWidth),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

  const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  return {
    geometry,
    map: source.map ?? null,
    side: source.side,
    positions: bakedTexture(positions, width, rows * total),
    normals: bakedTexture(normals, width, rows * total),
    layout: new THREE.Vector3(width, rows, total),
    loop,
    cast,
    strike,
  };
}

/** Ein geladenes Modell für Ausrüstung, die nicht aus dem Code gebaut wird (der Schild). */
interface GearModel {
  object: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
}

/**
 * Säubert das Material eines Ausrüstungsmodells wie das der Spielfigur: nicht selbstleuchtend, von der Finsternis
 * verschluckt. Die Materialien kommen in die Liste der Figur, damit der Schild beim Treffer mit aufglüht.
 */
function prepareGearModel(gltf: GLTF): GearModel {
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const replace = (source: THREE.Material): THREE.MeshStandardMaterial => {
    const known = materials.get(source);
    if (known) return known;
    const material = swallowedByFinsternis(litMaterial(source, true));
    materials.set(source, material);
    return material;
  };
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
    object.castShadow = true;
    // Hängt an einem Knochen: Die Hüllkugel aus der Ruhelage stimmt in Bewegung nicht.
    object.frustumCulled = false;
  });
  return { object: gltf.scene, materials: [...materials.values()] };
}

/**
 * Stellt die Spielfigur auf den Boden, bringt sie auf die Höhe ihrer Klasse, säubert das Material
 * und gibt ihr ihre Waffe in die Hand.
 */
function prepareHero(gltf: GLTF, playerClass: ClassDef, gearModels: ReadonlyMap<string, GearModel>): HeroModel {
  const scene = gltf.scene;
  const spec = playerClass.model;
  const upperBones = upperBodyBones(scene);
  const clips = gltf.animations.map((clip) => layered(clip, upperBones));
  const named = (clip: LayeredClip): string => clip.full.name;
  const idle = findClip(clips, named, /idle/i);
  const run = findClip(clips, named, /^running$/i) ?? findClip(clips, named, /run/i) ?? findClip(clips, named, /walk/i);
  const dead = findClip(gltf.animations, (clip) => clip.name, /dead|death/i);

  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const replace = (source: THREE.Material): THREE.MeshStandardMaterial => {
    const known = materials.get(source);
    if (known) return known;
    const material = swallowedByFinsternis(litMaterial(source, true));
    materials.set(source, material);
    return material;
  };
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
    object.castShadow = true;
    // Die Hüllkugel stammt aus der Ruhepose; in Bewegung ragt die Figur darüber hinaus.
    object.frustumCulled = false;
  });

  // Gemessen wird in der Haltung, in der die Figur im Spiel steht.
  const mixer = new THREE.AnimationMixer(scene);
  if (idle) {
    mixer.clipAction(idle.full).play();
    mixer.setTime(0);
  }
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = size.y > 0 ? spec.height / size.y : 1;
  scene.scale.multiplyScalar(scale);
  scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  // Erst nach dem Messen: Ein Bogen ragt über den Kopf hinaus und zählt nicht zur Körpergröße.
  const objects = new Map([...gearModels].map(([file, model]) => [file, model.object]));
  const gear = equip(playerClass.gear, scene, objects);
  const offhand = playerClass.offhand ? equip(playerClass.offhand, scene, objects) : null;
  for (const def of [playerClass.gear, playerClass.offhand]) {
    for (const material of (def?.model ? gearModels.get(def.model)?.materials : undefined) ?? []) materials.set(material, material);
  }

  const root = new THREE.Group();
  root.add(scene);
  return { root, height: spec.height, materials: [...materials.values()], idle, run, dead, clips, gear, offhand };
}

/** Stellt den Verschlinger auf den Boden, bringt ihn auf seine Größe und säubert das Material. */
function prepareBoss(gltf: GLTF, spec: EnemyModel): BossModel {
  const scene = gltf.scene;
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const replace = (source: THREE.Material): THREE.MeshStandardMaterial => {
    const known = materials.get(source);
    if (known) return known;
    // Wie die Horde bleibt er für den Spürsinn des Wildnisläufers in der Finsternis als Umriss sichtbar.
    const material = swallowedByFinsternis(litMaterial(source, true), true);
    materials.set(source, material);
    return material;
  };
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });

  // Gemessen wird in der Haltung, in der er steht: Die Ruhepose der Datei hat ausgebreitete Arme.
  const idle = findClip(gltf.animations, (clip) => clip.name, /idle/i) ?? gltf.animations[0] ?? null;
  const mixer = new THREE.AnimationMixer(scene);
  if (idle) {
    mixer.clipAction(idle).play();
    mixer.setTime(0);
  }
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = size.y > 0 ? spec.height / size.y : 1;
  scene.scale.multiplyScalar(scale);
  scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  const root = new THREE.Group();
  root.add(scene);
  return { root, height: spec.height, materials: [...materials.values()], clips: gltf.animations };
}

/** Was beim Vorbereiten eines Gegenstands einzustellen ist. */
interface PropSpec {
  file: string;
  /** Welches Maß auf 1 gebracht wird. */
  fit: 'footprint' | 'height';
  tint?: number;
  /** Unbeleuchtet: auch im Dunkeln und in der Finsternis zu sehen. */
  unlit?: boolean;
}

/** Stellt einen Gegenstand auf den Boden, bringt ihn auf Einheitsgröße und säubert das Material. */
function prepareProp(gltf: GLTF, spec: PropSpec): PropModel {
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const mesh = meshes[0];
  if (!mesh) throw new Error('Kein Netz in der Datei.');

  const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z);
  const scale = 1 / ((spec.fit === 'height' ? size.y : footprint) || 1);
  geometry.translate(-center.x, -box.min.y, -center.z).scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  const material = spec.unlit
    ? new THREE.MeshBasicMaterial({ map: source.map ?? null, side: source.side })
    : swallowedByFinsternis(litMaterial(source, true));
  if (spec.tint !== undefined) material.color.set(spec.tint);
  return { geometry, material, height: size.y * scale, width: footprint * scale };
}

function sceneryProp(model: SceneryModel): PropSpec {
  return { file: model.file, fit: 'footprint', tint: model.tint };
}

/**
 * Lädt alle Modelle. Eine fehlende oder kaputte Datei hält das Spiel nicht auf:
 * Sie landet in `failed`, und an ihrer Stelle bleibt der Platzhalter.
 */
export async function loadModels(onProgress: (done: number, total: number) => void): Promise<Models> {
  const models: Models = { heroes: new Map(), hordes: new Map(), boss: null, props: new Map(), failed: [] };
  const { gems } = CONFIG.xp;
  const props: PropSpec[] = [
    ...CONFIG.scenery.rockModels.map(sceneryProp),
    ...CONFIG.scenery.woodModels.map(sceneryProp),
    { file: CONFIG.islands.model.file, fit: 'height' },
    { file: gems.small.file, fit: 'height', unlit: true },
    { file: gems.large.file, fit: 'height', unlit: true },
  ];
  // Die Ausrüstung lädt neben den Figuren und ist fertig, bevor eine Figur sie in die Hand nimmt.
  const gearModels = new Map<string, GearModel>();
  const gearFiles = [...new Set(CLASSES.flatMap((playerClass) => [playerClass.gear.model, playerClass.offhand?.model]))].filter(
    (file): file is string => file !== undefined,
  );
  let done = 0;
  const gearLoaded = Promise.all(
    gearFiles.map(async (file) => {
      try {
        gearModels.set(file, prepareGearModel(await loader.loadAsync(modelUrl(file))));
      } catch (error) {
        // Ohne Modell greift die Figur zum Platzhalter aus gear.ts.
        console.warn(`Modell ${file} nicht geladen, Platzhalter bleibt.`, error);
        models.failed.push(file);
      }
      onProgress(++done, tasks.length + gearFiles.length);
    }),
  );
  const tasks: [string, (gltf: GLTF) => void | Promise<void>][] = [
    ...CLASSES.map((playerClass): [string, (gltf: GLTF) => void | Promise<void>] => [
      playerClass.model.file,
      async (gltf) => {
        await gearLoaded;
        models.heroes.set(playerClass.id, prepareHero(gltf, playerClass, gearModels));
      },
    ]),
    // Arten ohne Datei treten als Kapsel auf, bis es ihr Modell gibt.
    ...CONFIG.enemies.types
      .filter((type) => type.model.file !== '')
      .map((type): [string, (gltf: GLTF) => void] => [
        type.model.file,
        (gltf) => models.hordes.set(type, bakeHorde(gltf, type.model)),
      ]),
    [CONFIG.boss.type.model.file, (gltf) => (models.boss = prepareBoss(gltf, CONFIG.boss.type.model))],
    ...props.map((spec): [string, (gltf: GLTF) => void] => [
      spec.file,
      (gltf) => models.props.set(spec.file, prepareProp(gltf, spec)),
    ]),
  ];

  onProgress(done, tasks.length + gearFiles.length);
  await Promise.all([
    gearLoaded,
    ...tasks.map(async ([file, use]) => {
      try {
        await use(await loader.loadAsync(modelUrl(file)));
      } catch (error) {
        console.warn(`Modell ${file} nicht geladen, Platzhalter bleibt.`, error);
        models.failed.push(file);
      }
      onProgress(++done, tasks.length + gearFiles.length);
    }),
  ]);
  return models;
}
