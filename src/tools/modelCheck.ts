/**
 * Modell-Prüfer: zeigt eine GLB-Datei im Licht und aus der Kamera des Spiels
 * und misst sie an den Vorgaben für Gegner und Spielfiguren.
 * Nur für die Entwicklung; die Seite modell.html gehört nicht zum fertigen Spiel.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from '../config';
import { CLASSES } from '../game/classes';
import { equip, type Gear } from '../game/gear';

/** Richtwerte, an denen ein Modell gemessen wird. */
const BUDGET = {
  /** Gegner treten zu Hunderten auf und werden wegen der Fackelschatten siebenmal je Bild gezeichnet. */
  enemyTriangles: 3000,
  /** Spielfigur und Boss gibt es nur einmal. */
  heroTriangles: 15000,
  texturePixels: 1024,
  enemyBones: 30,
  megabytes: 3,
};

/** Auf diese Höhe wird eine Figur zum Ansehen gebracht, wenn ihr Maßstab in der Datei nicht zu Metern passt. */
const SHOWN_HEIGHT = 1.8;

type Level = 'good' | 'warn' | 'bad';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} fehlt in modell.html.`);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('view');
const report = element('report');
const clipButtons = element('clips');
const viewButtons = element('views');
const hint = element('hint');
const panel = element('panel');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a09);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
// Ein Kästchen ist ein Meter.
const grid = new THREE.GridHelper(20, 20, 0x5a5346, 0x4a4439);
grid.position.y = 0.005;
scene.add(ground, grid);

// Stellvertreter der Spielfigur als Größenvergleich, mit ihrer Fackel als Lichtquelle.
const REFERENCE_X = -1.6;
const reference = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.36, 1, 6, 14),
  new THREE.MeshStandardMaterial({ color: 0x6f757d, roughness: 0.7 }),
);
reference.position.set(REFERENCE_X, 0.86, 0);
reference.castShadow = true;
scene.add(reference);

// Der Pfeil zeigt nach +Z: dorthin blickt eine Figur im Spiel.
const forward = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.02, 0.5), 1.4, 0xffb45e, 0.3, 0.18);
scene.add(forward);

const torch = new THREE.PointLight(CONFIG.torch.color, CONFIG.torch.intensity, CONFIG.torch.radius, CONFIG.torch.decay);
torch.position.set(REFERENCE_X + 0.2, 3, 0.1);
torch.castShadow = true;
torch.shadow.mapSize.setScalar(1024);
torch.shadow.bias = -0.003;
torch.shadow.normalBias = 0.03;
const fill = new THREE.PointLight(CONFIG.fill.color, CONFIG.fill.intensity, CONFIG.fill.radius, CONFIG.torch.decay);
fill.position.set(REFERENCE_X, 1.5, 14);
const ambient = new THREE.HemisphereLight(0xffffff, 0x6b6558, 0.3);
scene.add(torch, fill, ambient);

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);

const VIEWS = {
  Nahansicht: () => {
    camera.position.set(2.2, 1.6, 3.4);
    controls.target.set(0, 0.9, 0);
    controls.enabled = true;
  },
  Spielkamera: () => {
    const { x, y, z } = CONFIG.camera.offset;
    camera.position.set(x, y, z);
    controls.target.set(0, 1, 0);
    controls.enabled = false;
  },
} as const;
const LIGHTS = {
  Prüflicht: 2.4,
  'Spiel-Licht': 0.3,
} as const;

let mixer: THREE.AnimationMixer | null = null;
let current: THREE.Object3D | null = null;
let clips: readonly THREE.AnimationClip[] = [];
/** Die Waffe der Klasse, wenn die Datei das Modell einer Spielfigur ist. */
let gear: Gear | null = null;
/** Was die andere Hand hält (der Schild des Kämpfers). */
let offhand: Gear | null = null;
/** Zum Ausprobieren aus der Konsole: Buch aufgeschlagen (weight), Pfeil auf der Sehne (charged). */
const gearState = { weight: 0, charged: false };

function buttons<T extends string>(parent: HTMLElement, labels: readonly T[], onPick: (label: T) => void, initial?: T): void {
  const created = labels.map((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      for (const other of created) other.classList.toggle('active', other === button);
      onPick(label);
    });
    parent.append(button);
    return button;
  });
  const start = created[initial ? labels.indexOf(initial) : -1];
  start?.click();
}

buttons(viewButtons, Object.keys(VIEWS) as (keyof typeof VIEWS)[], (label) => VIEWS[label](), 'Nahansicht');
viewButtons.append(document.createElement('br'));
buttons(
  viewButtons,
  Object.keys(LIGHTS) as (keyof typeof LIGHTS)[],
  (label) => (ambient.intensity = LIGHTS[label]),
  'Prüflicht',
);

function show(gltf: GLTF, megabytes: number, fileName: string, gearModels: ReadonlyMap<string, THREE.Object3D>): void {
  if (current) scene.remove(current);
  current = gltf.scene;
  scene.add(current);
  const playerClass = CLASSES.find((candidate) => fileName.endsWith(candidate.model.file));
  gear = playerClass ? equip(playerClass.gear, current, gearModels) : null;
  offhand = playerClass?.offhand ? equip(playerClass.offhand, current, gearModels) : null;

  let triangles = 0;
  let vertices = 0;
  let bones = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  current.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    object.castShadow = true;
    object.receiveShadow = true;
    const geometry = object.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute('position').count;
    vertices += positions;
    triangles += (geometry.index ? geometry.index.count : positions) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object instanceof THREE.SkinnedMesh) bones = Math.max(bones, object.skeleton.bones.length);
  });

  let largestTexture = 0;
  const textures = new Set<THREE.Texture>();
  const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;
  for (const material of materials) {
    for (const slot of slots) {
      const texture = (material as unknown as Partial<Record<(typeof slots)[number], THREE.Texture | null>>)[slot];
      if (!texture?.image) continue;
      textures.add(texture);
      const image = texture.image as { width: number; height: number };
      largestTexture = Math.max(largestTexture, image.width, image.height);
    }
  }

  const box = new THREE.Box3().setFromObject(current, true);
  const size = box.getSize(new THREE.Vector3());
  const metres = (value: number): string =>
    value !== 0 && Math.abs(value) < 0.1 ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(2)} m`;

  // Manche Exportwege liefern die Figur winzig (Zentimeter statt Meter). Gemessen wird die Datei,
  // gezeigt wird die Figur dann auf Mannshöhe, sonst wäre hier nichts zu sehen.
  const plausibleScale = size.y >= 0.4 && size.y <= 6;
  if (!plausibleScale && size.y > 0) {
    current.scale.multiplyScalar(SHOWN_HEIGHT / size.y);
    current.updateMatrixWorld(true);
  }

  const rows: [string, string][] = [
    ['Datei', `${megabytes.toFixed(1)} MB`],
    ['Dreiecke', triangles.toLocaleString('de-DE')],
    ['Eckpunkte', vertices.toLocaleString('de-DE')],
    ['Netze / Materialien', `${meshes} / ${materials.size}`],
    ['Texturen', `${textures.size}, größte ${largestTexture} px`],
    ['Knochen', String(bones)],
    ['Höhe', metres(size.y)],
    ['Breite × Tiefe', `${metres(size.x)} × ${metres(size.z)}`],
    ['Unterkante', metres(box.min.y)],
    ['Animationen', String(gltf.animations.length)],
  ];

  const findings: [Level, string][] = [];
  // Richtwert, keine harte Grenze: zehn Prozent darüber sind kein Befund.
  if (triangles <= BUDGET.enemyTriangles * 1.1) findings.push(['good', 'Dreiecke: passt für Gegner.']);
  else if (triangles <= BUDGET.heroTriangles * 1.1) {
    findings.push(['warn', `Dreiecke: für Gegner zu viel (Ziel unter ${BUDGET.enemyTriangles}), für Spielfigur oder Boss in Ordnung.`]);
  } else {
    findings.push(['bad', `Dreiecke: zu viel, auch für Spielfigur oder Boss (Ziel unter ${BUDGET.heroTriangles}, Gegner unter ${BUDGET.enemyTriangles}).`]);
  }
  findings.push(
    largestTexture <= BUDGET.texturePixels
      ? ['good', 'Texturgröße passt.']
      : ['warn', `Texturen größer als ${BUDGET.texturePixels} px; kleiner reicht bei dieser Kameraentfernung.`],
  );
  findings.push(materials.size <= 1 ? ['good', 'Ein Material.'] : ['warn', `${materials.size} Materialien; eines wäre günstiger.`]);
  const glowing = [...materials].some((material) => {
    const { emissive, emissiveIntensity } = material as THREE.MeshStandardMaterial;
    return emissive !== undefined && emissiveIntensity > 0 && emissive.getHex() !== 0;
  });
  if (glowing) findings.push(['warn', 'Material leuchtet selbst (Emission): Die Figur bliebe im Dunkeln hell. Das Spiel muss das beim Laden abschalten.']);
  if (bones === 0) findings.push(['warn', 'Kein Rig: Das Modell lässt sich nicht animieren.']);
  else if (bones <= BUDGET.enemyBones) findings.push(['good', 'Knochenzahl passt für Gegner.']);
  else findings.push(['warn', `${bones} Knochen; für Gegner in der Horde wären unter ${BUDGET.enemyBones} besser (Finger weglassen).`]);
  findings.push(
    megabytes <= BUDGET.megabytes
      ? ['good', 'Dateigröße passt.']
      : ['warn', `Datei größer als ${BUDGET.megabytes} MB; das summiert sich beim Laden im Browser.`],
  );
  findings.push(
    Math.abs(box.min.y) <= 0.03 * size.y ? ['good', 'Steht auf dem Boden.'] : ['bad', 'Die Füße stehen nicht auf Höhe 0.'],
  );
  findings.push(
    plausibleScale
      ? ['good', 'Maßstab plausibel (1 Einheit = 1 Meter).']
      : [
          'warn',
          `Maßstab: In der Datei ist die Figur ${metres(size.y)} hoch. Hier wird sie auf ${SHOWN_HEIGHT.toFixed(2)} m vergrößert gezeigt; das Spiel legt die Größe je Gegnertyp selbst fest.`,
        ],
  );
  findings.push(
    gltf.animations.length > 0
      ? ['good', 'Animationen als benannte Clips vorhanden.']
      : ['warn', 'Keine Animationen in der Datei.'],
  );

  hint.textContent = fileName;
  const table = document.createElement('table');
  for (const [label, value] of rows) {
    const row = table.insertRow();
    row.insertCell().textContent = label;
    row.insertCell().textContent = value;
  }
  const heading = document.createElement('h2');
  heading.textContent = 'Befund';
  const list = document.createElement('ul');
  for (const [level, text] of findings) {
    const item = document.createElement('li');
    item.className = level;
    item.textContent = text;
    list.append(item);
  }
  const facing = document.createElement('p');
  facing.textContent = 'Der Pfeil zeigt die Blickrichtung im Spiel. Das Modell muss in dieselbe Richtung schauen.';
  report.replaceChildren(table, heading, list, facing);

  mixer = new THREE.AnimationMixer(current);
  clips = gltf.animations;
  clipButtons.replaceChildren();
  const names = ['(Ruhepose)', ...gltf.animations.map((clip) => `${clip.name} · ${clip.duration.toFixed(1)} s`)];
  buttons(
    clipButtons,
    names,
    (label) => {
      mixer?.stopAllAction();
      const clip = gltf.animations[names.indexOf(label) - 1];
      if (clip) mixer?.clipAction(clip).reset().play();
    },
    names[1] ?? names[0],
  );
}

const loader = new GLTFLoader();

/** Lädt die Modelle der Ausrüstung (Schild), die eine Spielfigur in die Hand nimmt; fehlt eines, bleibt der Platzhalter. */
async function loadGearModels(fileName: string): Promise<Map<string, THREE.Object3D>> {
  const models = new Map<string, THREE.Object3D>();
  const playerClass = CLASSES.find((candidate) => fileName.endsWith(candidate.model.file));
  for (const def of [playerClass?.gear, playerClass?.offhand]) {
    if (!def?.model || models.has(def.model)) continue;
    try {
      models.set(def.model, (await loader.loadAsync(`${import.meta.env.BASE_URL}models/${def.model}`)).scene);
    } catch (error) {
      console.warn(`Ausrüstung ${def.model} nicht geladen.`, error);
    }
  }
  return models;
}

function load(buffer: ArrayBuffer, fileName: string): void {
  hint.textContent = `Lade ${fileName} …`;
  loader.parse(
    buffer,
    '',
    (gltf) => void loadGearModels(fileName).then((gearModels) => show(gltf, buffer.byteLength / 1048576, fileName, gearModels)),
    (error) => {
      hint.textContent = `Die Datei ließ sich nicht lesen: ${error.message}`;
    },
  );
}

const requested = new URLSearchParams(location.search).get('datei');
if (requested) {
  // Unterordner bleiben erhalten (behemoth/name.glb), nur die einzelnen Namen werden kodiert.
  const path = requested.split('/').map(encodeURIComponent).join('/');
  fetch(`${import.meta.env.BASE_URL}models/${path}`)
    .then((response) => {
      if (!response.ok) throw new Error(`nicht gefunden (${response.status})`);
      return response.arrayBuffer();
    })
    .then((buffer) => load(buffer, requested))
    .catch((error: Error) => {
      hint.textContent = `${requested}: ${error.message}`;
    });
}

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void file.arrayBuffer().then((buffer) => load(buffer, file.name));
});

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  // Schiebt die Bildmitte in den freien Bereich rechts neben der Seitenleiste.
  camera.setViewOffset(width, height, -panel.getBoundingClientRect().width / 2, 0, width, height);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  mixer?.update(Math.min((now - last) / 1000, 0.1));
  last = now;
  controls.update();
  gear?.update(gearState.weight, gearState.charged);
  offhand?.settle();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Zugriff aus der Browser-Konsole beim Prüfen.
(window as unknown as { __check: object }).__check = {
  scene,
  camera,
  controls,
  renderer,
  getMixer: () => mixer,
  getModel: () => current,
  getClips: () => clips,
  getGear: () => gear,
  getOffhand: () => offhand,
  gearState,
};
