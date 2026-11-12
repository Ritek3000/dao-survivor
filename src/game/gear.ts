/**
 * Was eine Klasse in den Händen hält: die Axt des Kämpfers, der Bogen des Wildnisläufers,
 * das Zauberbuch des Magiers. Aus einfachen Körpern gebaut und an den Handknochen gehängt,
 * damit die Angriffs-Animationen etwas zu führen haben.
 */
import * as THREE from 'three';
import { swallowedByFinsternis } from './darkness';

export type GearKind = 'axt' | 'bogen' | 'buch';
type Triple = readonly [number, number, number];

export interface GearDef {
  kind: GearKind;
  hand: 'links' | 'rechts';
  /** In Metern: Stiel der Axt, Bogen von Spitze zu Spitze, Höhe des Buchs. */
  size: number;
  /** Griffpunkt, gemessen im Raum des Handknochens. */
  offset: Triple;
  /**
   * Richtung im Raum des Handknochens, in die der Gegenstand ragt:
   * zum Axtkopf, zum oberen Bogenende, aus den aufgeschlagenen Seiten heraus.
   */
  along: Triple;
  /** Richtung, in die er wirkt: Schneide der Axt, Flug des Pfeils, Kopfende des Buchs. */
  toward: Triple;
}

interface Built {
  object: THREE.Object3D;
  /** `weight`: wie weit die Angriffshaltung eingeblendet ist; `charged`: der Pfeil liegt auf der Sehne. */
  update(weight: number, charged: boolean, otherHand: THREE.Object3D): void;
}

const UP = new THREE.Vector3(0, 1, 0);
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

const BUILDERS: Record<GearKind, (size: number) => Built> = {
  axt: buildAxe,
  bogen: buildBow,
  buch: buildBook,
};

/** Ein Gegenstand in der Hand einer Spielfigur. */
export class Gear {
  private readonly built: Built;

  constructor(
    def: GearDef,
    hand: THREE.Object3D,
    private readonly otherHand: THREE.Object3D,
  ) {
    this.built = BUILDERS[def.kind](def.size);
    this.setGrip(def.along, def.toward, def.offset);
    hand.add(this.built.object);
    this.update(0, false);
  }

  /** Legt fest, wie der Gegenstand in der Hand sitzt; die Angaben gelten im Raum des Handknochens. */
  setGrip(along: Triple, toward: Triple, offset: Triple): void {
    const y = new THREE.Vector3(...along).normalize();
    const z = new THREE.Vector3(...toward);
    z.addScaledVector(y, -z.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    this.built.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.built.object.position.set(...offset);
  }

  /** `weight`: wie weit die Angriffshaltung eingeblendet ist; `charged`: der Pfeil liegt auf der Sehne. */
  update(weight: number, charged: boolean): void {
    this.built.update(weight, charged, this.otherHand);
  }
}

/** Hängt die Ausrüstung an die Hand einer Figur. Ohne Handknochen bleibt die Figur unbewaffnet. */
export function equip(def: GearDef, figure: THREE.Object3D): Gear | null {
  const hands: Partial<Record<GearDef['hand'], THREE.Object3D>> = {};
  figure.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const side = /^hand[._ ]?([lr])$/i.exec(object.name)?.[1]?.toLowerCase();
    if (side === 'l') hands.links ??= object;
    else if (side === 'r') hands.rechts ??= object;
  });
  const { links, rechts } = hands;
  if (!links || !rechts) return null;
  return def.hand === 'links' ? new Gear(def, links, rechts) : new Gear(def, rechts, links);
}
