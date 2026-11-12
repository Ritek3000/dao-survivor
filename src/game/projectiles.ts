import * as THREE from 'three';
import type { Enemies, Enemy } from './enemies';
import { arrowGeometry, knifeGeometry, propMaterial, throwingAxeGeometry } from './props';
import type { ProjectileShape } from './weapons';

export interface Projectile<T> {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
  speed: number;
  /** Verbleibende Flugstrecke. */
  reach: number;
  /** Wie viele Gegner es noch durchschlagen darf. */
  pierce: number;
  shape: ProjectileShape;
  angle: number;
  /** Sekunden in der Luft; daraus ergibt sich, wie weit es sich überschlagen hat. */
  age: number;
  /** Bereits getroffene Gegner, damit keiner zweimal getroffen wird. */
  struck: Enemy[];
  /** Vom Aufrufer mitgegeben, etwa der Angriff, der das Geschoss abgefeuert hat. */
  payload: T;
}

const HEIGHT = 1.1;

interface ShapeDef {
  geometry: () => THREE.BufferGeometry;
  capacity: number;
  /** Vergrößerung gegenüber dem Netz. */
  scale: number;
  /** Trefferradius. */
  radius: number;
  /** Überschläge in Radiant je Sekunde; ein Pfeil fliegt gerade. */
  tumble: number;
  /** Länge, Breite und Farbe der Leuchtspur hinter dem Geschoss. */
  trail: [number, number, number];
}

const SHAPES: Record<ProjectileShape, ShapeDef> = {
  arrow: { geometry: arrowGeometry, capacity: 120, scale: 1.15, radius: 0.25, tumble: 0, trail: [2.4, 0.1, 0xb9a982] },
  knife: { geometry: knifeGeometry, capacity: 160, scale: 1.3, radius: 0.25, tumble: 24, trail: [0.9, 0.09, 0x8f98a6] },
  axe: { geometry: throwingAxeGeometry, capacity: 40, scale: 1.5, radius: 0.55, tumble: 15, trail: [1.4, 0.5, 0x6f757d] },
};
const SHAPE_NAMES = Object.keys(SHAPES) as ProjectileShape[];
const TRAIL_CAPACITY = SHAPE_NAMES.reduce((sum, name) => sum + SHAPES[name].capacity, 0);

const trailVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;

  void main() {
    vUv = uv;
    vTint = instanceColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const trailFragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;

  void main() {
    float across = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.5);
    float along = (1.0 - vUv.y) * (1.0 - vUv.y);
    gl_FragColor = vec4(vTint * across * along, 1.0);
    #include <colorspace_fragment>
  }
`;

const pose = new THREE.Object3D();
pose.rotation.order = 'YXZ';
const tint = new THREE.Color();

/** Pfeile, Messer und Äxte: fliegen geradeaus und treffen, was im Weg steht. */
export class Projectiles<T> {
  readonly group = new THREE.Group();
  private readonly meshes: Record<ProjectileShape, THREE.InstancedMesh>;
  private readonly trails: THREE.InstancedMesh;
  private readonly flying: Projectile<T>[] = [];
  private current: Projectile<T> | null = null;
  private onHit: ((enemy: Enemy, projectile: Projectile<T>) => void) | null = null;

  constructor() {
    const material = propMaterial(0.55);
    // Ein Rest Eigenhelligkeit: Am Rand des Lichtscheins wären die Geschosse sonst unsichtbar.
    material.emissive.set(0x24211c);
    const meshes = {} as Record<ProjectileShape, THREE.InstancedMesh>;
    for (const name of SHAPE_NAMES) {
      const mesh = new THREE.InstancedMesh(SHAPES[name].geometry(), material, SHAPES[name].capacity);
      mesh.frustumCulled = false;
      mesh.count = 0;
      meshes[name] = mesh;
      this.group.add(mesh);
    }
    this.meshes = meshes;

    // Die Spur liegt flach in der Luft hinter dem Geschoss: vorn hell, nach hinten verblassend.
    const trailGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.trails = new THREE.InstancedMesh(
      trailGeometry,
      new THREE.ShaderMaterial({
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      TRAIL_CAPACITY,
    );
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 3;
    for (let i = 0; i < TRAIL_CAPACITY; i++) this.trails.setColorAt(i, tint.set(0xffffff));
    this.trails.count = 0;
    this.group.add(this.trails);
  }

  reset(): void {
    this.flying.length = 0;
    for (const name of SHAPE_NAMES) this.meshes[name].count = 0;
    this.trails.count = 0;
  }

  spawn(
    x: number,
    z: number,
    angle: number,
    speed: number,
    reach: number,
    pierce: number,
    shape: ProjectileShape,
    payload: T,
  ): void {
    if (this.flying.length >= TRAIL_CAPACITY) return;
    this.flying.push({
      x,
      z,
      directionX: Math.sin(angle),
      directionZ: Math.cos(angle),
      speed,
      reach,
      pierce,
      shape,
      angle,
      age: 0,
      struck: [],
      payload,
    });
  }

  update(dt: number, enemies: Enemies, onHit: (enemy: Enemy, projectile: Projectile<T>) => void): void {
    this.onHit = onHit;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const projectile = this.flying[i];
      if (!projectile) continue;
      const step = projectile.speed * dt;
      projectile.x += projectile.directionX * step;
      projectile.z += projectile.directionZ * step;
      projectile.reach -= step;
      projectile.age += dt;

      this.current = projectile;
      enemies.queryRadius(projectile.x, projectile.z, SHAPES[projectile.shape].radius, this.strike);

      if (projectile.reach <= 0 || projectile.pierce < 0) {
        const last = this.flying.pop();
        if (last && last !== projectile) this.flying[i] = last;
      }
    }
    this.write();
  }

  private write(): void {
    const counts: Record<ProjectileShape, number> = { arrow: 0, knife: 0, axe: 0 };
    let trails = 0;
    for (const projectile of this.flying) {
      const shape = SHAPES[projectile.shape];
      const mesh = this.meshes[projectile.shape];
      if (counts[projectile.shape] >= shape.capacity) continue;

      pose.position.set(projectile.x, HEIGHT, projectile.z);
      pose.rotation.set(shape.tumble * projectile.age, projectile.angle, 0);
      pose.scale.setScalar(shape.scale);
      pose.updateMatrix();
      mesh.setMatrixAt(counts[projectile.shape]++, pose.matrix);

      // Kurz nach dem Abschuss ist die Spur erst so lang wie der zurückgelegte Weg.
      const [length, width, color] = shape.trail;
      pose.rotation.set(0, projectile.angle, 0);
      pose.scale.set(width, 1, Math.min(length, projectile.age * projectile.speed));
      pose.updateMatrix();
      this.trails.setMatrixAt(trails, pose.matrix);
      this.trails.setColorAt(trails++, tint.set(color));
    }
    for (const name of SHAPE_NAMES) {
      this.meshes[name].count = counts[name];
      this.meshes[name].instanceMatrix.needsUpdate = true;
    }
    this.trails.count = trails;
    this.trails.instanceMatrix.needsUpdate = true;
    if (this.trails.instanceColor) this.trails.instanceColor.needsUpdate = true;
  }

  private readonly strike = (enemy: Enemy): void => {
    const projectile = this.current;
    if (!projectile || projectile.pierce < 0 || enemy.hp <= 0 || projectile.struck.includes(enemy)) return;
    const reach = SHAPES[projectile.shape].radius + enemy.type.radius;
    if (Math.hypot(enemy.x - projectile.x, enemy.z - projectile.z) > reach) return;
    projectile.struck.push(enemy);
    projectile.pierce--;
    this.onHit?.(enemy, projectile);
  };
}
