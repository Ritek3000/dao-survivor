/**
 * Was eine Klasse in den Händen hält: die Axt und der Schild des Kämpfers, der Bogen des Wildnisläufers,
 * das Zauberbuch des Magiers. Axt, Bogen und Buch sind aus einfachen Körpern gebaut, der Schild ist ein GLB-Modell
 * (`tools/schild-erzeugen.py`). Alles hängt am Handknochen, damit es den Animationen folgt.
 */
import * as THREE from 'three';
import { swallowedByFinsternis } from './darkness';

export type GearKind = 'axt' | 'bogen' | 'buch' | 'schild';
type Triple = readonly [number, number, number];

export interface GearDef {
  kind: GearKind;
  hand: 'links' | 'rechts';
  /** In Metern: Stiel der Axt, Bogen von Spitze zu Spitze, Höhe des Buchs, Durchmesser des Schilds. */
  size: number;
  /** Modell aus `public/models` für Gegenstände, die keine Körper aus dem Code sind (der Schild). */
  model?: string;
  /** Griffpunkt, gemessen im Raum des Handknochens. */
  offset: Triple;
  /**
   * Richtung im Raum des Handknochens, in die der Gegenstand ragt:
   * zum Axtkopf, zum oberen Bogenende, aus den aufgeschlagenen Seiten heraus, zum oberen Schildrand.
   */
  along: Triple;
  /** Richtung, in die er wirkt: Schneide der Axt, Flug des Pfeils, Kopfende des Buchs, Aussenseite des Schilds. */
  toward: Triple;
  /**
   * Der Schild folgt mit seinem Griffpunkt der Hand, behält aber seine Ausrichtung im Raum der Figur, sonst schwenkt er
   * mit jedem Handgelenk durch den Lauf: `weight` 0 heißt starr an der Hand, 1 ganz fest; `along` und `toward` gelten im
   * Raum der Figur (+Z nach vorn, +X nach links), nicht im Raum des Handknochens. `minSide`: So weit links von der
   * Mitte der Figur bleibt der Griffpunkt mindestens, damit der Schild nicht in den Körper fährt, wenn die Hand
   * im Lauf nach innen schwingt (Meter, vor der Skalierung der Figur).
   */
  steady?: { weight: number; along: Triple; toward: Triple; minSide: number };
}

interface Built {
  object: THREE.Object3D;
  /** `weight`: wie weit die Angriffshaltung eingeblendet ist; `charged`: der Pfeil liegt auf der Sehne. */
  update(weight: number, charged: boolean, otherHand: THREE.Object3D): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const handRotation = new THREE.Quaternion();
const figureRotation = new THREE.Quaternion();
const wanted = new THREE.Quaternion();
const origin = new THREE.Vector3();
const handScale = new THREE.Vector3();
const sideways = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, 1);
const direction = new THREE.Vector3();

function lit(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return swallowedByFinsternis(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  // Hängt an einem Knochen: Die Hüllkugel aus der Ruhelage stimmt in Bewegung nicht.
  mesh.frustumCulled = false;
  return mesh;
}

/** Bartaxt: Der Stiel läuft entlang +Y, die Schneide zeigt nach +Z. Gegriffen wird nahe dem unteren Ende. */
function buildAxe(length: number): Built {
  const object = new THREE.Group();
  const unit = length / 0.7;

  const handle = part(new THREE.CylinderGeometry(0.017 * unit, 0.022 * unit, length, 6), lit(0x4a3423));
  handle.position.y = length * 0.34;

  // Umriss des Blatts: u zeigt vom Stiel zur Schneide, v den Stiel entlang.
  const outline = new THREE.Shape();
  outline.moveTo(-0.045, 0.05);
  outline.lineTo(0.04, 0.045);
  outline.quadraticCurveTo(0.11, 0.06, 0.2, 0.13);
  outline.quadraticCurveTo(0.245, -0.02, 0.185, -0.2);
  outline.quadraticCurveTo(0.11, -0.08, 0.04, -0.05);
  outline.lineTo(-0.045, -0.055);
  outline.closePath();
  const thickness = 0.022;
  const blade = part(
    new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false }),
    lit(0xb9bec6, 0.42),
  );
  // Der Umriss liegt in der XY-Ebene der Geometrie; gedreht zeigt sein u nach +Z.
  blade.rotation.y = -Math.PI / 2;
  blade.scale.setScalar(unit);
  blade.position.set((thickness / 2) * unit, length * 0.74, 0);

  object.add(handle, blade);
  return { object, update: () => {} };
}

/**
 * Langbogen: Die Wurfarme laufen entlang ±Y, der Pfeil fliegt nach +Z.
 * Liegt ein Pfeil auf, folgt die Sehne der anderen Hand.
 */
function buildBow(height: number): Built {
  const object = new THREE.Group();
  const half = height / 2;
  const depth = height * 0.14;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -half, -depth),
    new THREE.Vector3(0, -half * 0.55, -depth * 0.3),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, half * 0.55, -depth * 0.3),
    new THREE.Vector3(0, half, -depth),
  ]);
  const limbs = part(new THREE.TubeGeometry(curve, 18, height * 0.012, 5), lit(0x5a3d24));
  const grip = part(new THREE.CylinderGeometry(height * 0.017, height * 0.017, height * 0.11, 6), lit(0x2b2118));

  const stringMaterial = lit(0xd8cfb8);
  const stringGeometry = new THREE.CylinderGeometry(0.005, 0.005, 1, 4);
  const upperString = part(stringGeometry, stringMaterial);
  const lowerString = part(stringGeometry, stringMaterial);

  const arrowLength = height * 0.6;
  const arrow = new THREE.Group();
  const shaft = part(new THREE.CylinderGeometry(0.008, 0.008, arrowLength, 5), lit(0xcdb98a));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = arrowLength / 2;
  const tip = part(new THREE.ConeGeometry(0.02, 0.07, 5), lit(0xb9bec6, 0.42));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = arrowLength + 0.03;
  arrow.add(shaft, tip);

  object.add(limbs, grip, upperString, lowerString, arrow);

  const topTip = new THREE.Vector3(0, half, -depth);
  const bottomTip = new THREE.Vector3(0, -half, -depth);
  const rest = new THREE.Vector3(0, 0, -depth);
  const nock = new THREE.Vector3();
  const stretch = (segment: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void => {
    direction.copy(end).sub(start);
    const length = direction.length();
    segment.position.copy(start).addScaledVector(direction, 0.5);
    segment.scale.y = length;
    segment.quaternion.setFromUnitVectors(UP, direction.divideScalar(length || 1));
  };

  return {
    object,
    update(_weight, charged, otherHand) {
      if (charged) {
        // Die Zughand hält die Sehne; gemessen wird sie im Raum des Bogens.
        object.worldToLocal(otherHand.getWorldPosition(nock));
        // Sie kann die Sehne nur nach hinten ziehen, nicht durch den Bogen hindurch.
        nock.z = Math.min(nock.z, rest.z);
      } else {
        nock.copy(rest);
      }
      stretch(upperString, nock, topTip);
      stretch(lowerString, nock, bottomTip);
      arrow.visible = charged;
      if (!charged) return;
      arrow.position.copy(nock);
      // Der Pfeil liegt über der Griffhand auf.
      direction.set(0, 0.03, 0).sub(nock).normalize();
      arrow.quaternion.setFromUnitVectors(FORWARD, direction);
    },
  };
}

/**
 * Zauberbuch, ein Fokus: aufgeschlagen liegen die Seiten in der XZ-Ebene und zeigen nach +Y,
 * der Buchrücken läuft entlang Z. Geschlossen klappen beide Hälften nach oben zusammen.
 */
function buildBook(height: number): Built {
  const object = new THREE.Group();
  const width = height * 0.72;
  const cover = height * 0.03;
  const pages = height * 0.09;
  const leather = lit(0x4a1f1c, 0.7);
  const paper = lit(0xd9cfb4, 0.95);

  const half = (side: 1 | -1): THREE.Group => {
    const hinge = new THREE.Group();
    hinge.position.x = side * (cover + pages);
    const board = part(new THREE.BoxGeometry(width, cover, height), leather);
    board.position.set((side * width) / 2, cover / 2, 0);
    const block = part(new THREE.BoxGeometry(width * 0.94, pages, height * 0.94), paper);
    block.position.set((side * width * 0.94) / 2, cover + pages / 2, 0);
    hinge.add(board, block);
    return hinge;
  };
  const right = half(1);
  const left = half(-1);
  const spine = part(new THREE.BoxGeometry((cover + pages) * 2, cover, height), leather);
  spine.position.y = cover / 2;
  object.add(right, left, spine);

  const CLOSED = Math.PI / 2;
  /** Ganz flach liegt ein Buch in der Hand nie. */
  const OPEN = 0.16;
  return {
    object,
    update(weight) {
      const eased = weight * weight * (3 - 2 * weight);
      const angle = CLOSED + (OPEN - CLOSED) * eased;
      right.rotation.z = angle;
      left.rotation.z = -angle;
    },
  };
}

/**
 * Rundschild: Im Modell steht +Y oben, +Z zeigt aus der Schildfläche heraus (zur Aussenseite mit dem Buckel), und der
 * Ursprung liegt in der Griffstange. Das Modell wird auf den Durchmesser `diameter` gebracht, wie es auch geliefert wird.
 * Fehlt die Datei, steht ein schlichter Holzteller an seiner Stelle.
 */
function buildShield(diameter: number, model?: THREE.Object3D): Built {
  const object = new THREE.Group();
  if (model) {
    const copy = model.clone(true);
    const box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    copy.scale.multiplyScalar(diameter / (Math.max(size.x, size.y) || diameter));
    object.add(copy);
  } else {
    const radius = diameter / 2;
    const board = part(new THREE.CylinderGeometry(radius, radius, 0.03, 24), lit(0x6b2a22));
    board.rotation.x = Math.PI / 2;
    board.position.z = -0.045;
    const boss = part(new THREE.SphereGeometry(radius * 0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lit(0x8a9099, 0.45));
    boss.rotation.x = Math.PI / 2;
    boss.position.z = -0.03;
    object.add(board, boss);
  }
  return { object, update: () => {} };
}

const BUILDERS: Record<GearKind, (size: number, model?: THREE.Object3D) => Built> = {
  axt: buildAxe,
  bogen: buildBow,
  buch: buildBook,
  schild: buildShield,
};

/** Die Drehung eines Gegenstands, dessen +Y nach `along` und dessen +Z nach `toward` zeigt. */
function orientation(along: Triple, toward: Triple): THREE.Quaternion {
  const y = new THREE.Vector3(...along).normalize();
  const z = new THREE.Vector3(...toward);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Ein Gegenstand in der Hand einer Spielfigur. */
export class Gear {
  private readonly built: Built;
  /** Die Drehung, in der er starr an der Hand sitzt, im Raum des Handknochens. */
  private readonly rigid = new THREE.Quaternion();
  /** Die Drehung, die er im Raum der Figur hält (nur mit `def.steady`). */
  private readonly held = new THREE.Quaternion();
  private steadiness: number;
  /** Der Griffpunkt im Raum des Handknochens, wie ihn `setGrip` festlegt. */
  private readonly grip = new THREE.Vector3();

  constructor(
    private readonly def: GearDef,
    private readonly hand: THREE.Object3D,
    private readonly otherHand: THREE.Object3D,
    private readonly figure: THREE.Object3D,
    model?: THREE.Object3D,
  ) {
    this.built = BUILDERS[def.kind](def.size, model);
    this.setGrip(def.along, def.toward, def.offset);
    if (def.steady) this.held.copy(orientation(def.steady.along, def.steady.toward));
    this.steadiness = def.steady?.weight ?? 0;
    hand.add(this.built.object);
    this.update(0, false);
  }

  /** Legt fest, wie der Gegenstand in der Hand sitzt; die Angaben gelten im Raum des Handknochens. */
  setGrip(along: Triple, toward: Triple, offset: Triple): void {
    this.rigid.copy(orientation(along, toward));
    this.built.object.quaternion.copy(this.rigid);
    this.grip.set(...offset);
    this.built.object.position.copy(this.grip);
  }

  /**
   * Richtet einen Gegenstand mit `def.steady` im Raum der Figur aus. Gehört hinter jeden Schritt der Animation,
   * denn die Hand steht erst dann an ihrem neuen Platz.
   */
  settle(): void {
    if (this.steadiness <= 0) return;
    this.hand.getWorldQuaternion(handRotation);
    this.figure.getWorldQuaternion(figureRotation);
    // Gesucht ist die Drehung im Raum der Hand, die in der Welt der gehaltenen Ausrichtung der Figur entspricht.
    wanted.copy(handRotation).invert().multiply(figureRotation).multiply(this.held);
    const object = this.built.object;
    object.quaternion.slerpQuaternions(this.rigid, wanted, this.steadiness);

    // Schwingt die Hand nach innen, rückt der Schild nach außen, statt durch den Körper zu fahren.
    object.position.copy(this.grip);
    object.getWorldPosition(origin);
    this.figure.worldToLocal(origin);
    const missing = (this.def.steady?.minSide ?? 0) - origin.x;
    if (missing <= 0) return;
    object.getWorldPosition(origin);
    sideways.setFromMatrixColumn(this.figure.matrixWorld, 0).normalize();
    // Die Figur ist skaliert: Der Abstand gilt in ihrem eigenen Maß.
    origin.addScaledVector(sideways, missing * this.figure.getWorldScale(handScale).x);
    object.position.copy(this.hand.worldToLocal(origin));
  }

  /** Lässt den Schild starr an der Hand sitzen, etwa wenn die Figur zu Boden geht. */
  release(): void {
    this.steadiness = 0;
    this.built.object.quaternion.copy(this.rigid);
  }

  /** Nimmt die gehaltene Ausrichtung wieder auf. */
  restore(): void {
    this.steadiness = this.def.steady?.weight ?? 0;
  }

  /** `weight`: wie weit die Angriffshaltung eingeblendet ist; `charged`: der Pfeil liegt auf der Sehne. */
  update(weight: number, charged: boolean): void {
    this.built.update(weight, charged, this.otherHand);
  }
}

/**
 * Hängt die Ausrüstung an die Hand einer Figur. Ohne Handknochen bleibt die Figur unbewaffnet.
 * `models` hält die geladenen Modelle für Ausrüstung mit `def.model`, nach Dateiname.
 */
export function equip(def: GearDef, figure: THREE.Object3D, models?: ReadonlyMap<string, THREE.Object3D>): Gear | null {
  const hands: Partial<Record<GearDef['hand'], THREE.Object3D>> = {};
  figure.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const side = /^hand[._ ]?([lr])$/i.exec(object.name)?.[1]?.toLowerCase();
    if (side === 'l') hands.links ??= object;
    else if (side === 'r') hands.rechts ??= object;
  });
  const { links, rechts } = hands;
  if (!links || !rechts) return null;
  const model = def.model ? models?.get(def.model) : undefined;
  return def.hand === 'links' ? new Gear(def, links, rechts, figure, model) : new Gear(def, rechts, links, figure, model);
}
