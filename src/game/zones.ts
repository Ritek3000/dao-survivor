import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { createRandom, type Random } from '../core/random';
import { MAX_CLOUDS, clearCloudUniform, cloudAmount, finsternisUniforms, swallowedByFinsternis } from './darkness';
import type { PropModel } from './models';
import { Particles, type Particle } from './particles';

/** Die drei Zustände der Karte: Lichtinsel, gewöhnliche Nacht, Schwade der Finsternis. */
export type Zone = 'licht' | 'nacht' | 'finsternis';

export interface Site {
  x: number;
  z: number;
}

export interface IslandBearing {
  dx: number;
  dz: number;
  distance: number;
  burning: boolean;
}

type IslandState = 'unlit' | 'burning' | 'spent';

interface Island extends Site {
  state: IslandState;
  /** Restzeit des aktuellen Zustands: Brenndauer oder Pause nach dem Ausbrennen. */
  timer: number;
  /** Sichtbare Helligkeit von 0 bis 1, weich nachgeführt. */
  glow: number;
  ring: THREE.Mesh;
}

interface Cloud extends Site {
  radius: number;
  directionX: number;
  directionZ: number;
  turnIn: number;
}

/** Wer Finsternis mit sich trägt: der Mantel der Nacht eines Gegners, das Verschlingen. */
export interface Carrier extends Site {
  /** Radius seiner Finsternis in Metern; 0 trägt keine. */
  mantle: number;
}

/** Ein Platz für getragene Finsternis. Sie wächst an und fällt zusammen, statt zu springen. */
interface Carried extends Site {
  radius: number;
  wanted: number;
  owner: Carrier | null;
}

/** So schnell wächst getragene Finsternis an und fällt wieder zusammen (1/s). */
const CARRIED_SHARPNESS = 2.2;

/** So viele Feuer leuchten gleichzeitig als echte Lichtquelle; fest, damit kein Shader neu gebaut wird. */
const ISLAND_LIGHTS = 3;
/** Höhe der Platzhalter-Schale; das Modell bringt seine eigene mit. */
const PLACEHOLDER_HEIGHT = 0.98;
/** Feuer, Glut und Rauch werden nur für Schalen in dieser Entfernung zur Spielfigur gezeichnet. */
const FIRE_RANGE = 55;
const FLAME_COLORS = [0xffd27a, 0xff9a36, 0xff7a22, 0xe0481a] as const;
const bowlTint = new THREE.Color();

export class Zones {
  readonly group = new THREE.Group();
  /** Fortschritt beim Entzünden einer Feuerschale von 0 bis 1; 0 heißt, es wird nichts entzündet. */
  igniteProgress = 0;
  /** Faktor auf die Brenndauer neu entzündeter Feuer; die Feuer des Kämpfers brennen länger. */
  burnFactor = 1;
  /** Faktor auf das Tempo, mit dem sich eine Feuerschale entzündet. */
  igniteFactor = 1;
  private readonly islands: Island[] = [];
  private readonly clouds: Cloud[] = [];
  /** Plätze, die die wandernden Schwaden im Shader frei lassen. */
  private readonly carried: Carried[] = Array.from({ length: MAX_CLOUDS - CONFIG.finsternis.clouds }, () => ({
    x: 0,
    z: 0,
    radius: 0,
    wanted: 0,
    owner: null,
  }));
  private readonly lights: THREE.PointLight[] = [];
  /** Flammen, Funken und Glut aller Schalen. */
  private readonly fire = new Particles(1500, 'glow');
  /** Rauch ausgebrannter Schalen; nur im Schein der Spielfigur zu sehen. */
  private readonly smoke = new Particles(300, 'dust');
  private readonly particle: Particle = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size: 0.1,
    grow: 0,
    gravity: 0,
    drag: 0,
    color: new THREE.Color(),
    alpha: 1,
  };
  private bowls: THREE.InstancedMesh;
  /** Höhe, in der die Kohlen liegen und das Feuer beginnt. */
  private fireY = PLACEHOLDER_HEIGHT * 0.95;
  private viewerLight = CONFIG.torch.radius as number;
  private readonly viewerTint = new THREE.Color(1, 1, 1);
  private igniting: Island | null = null;
  private random: Random = createRandom(0);
  private night = 0;

  constructor(sites: readonly Site[]) {
    if (CONFIG.finsternis.clouds > MAX_CLOUDS) throw new Error(`Höchstens ${MAX_CLOUDS} Schwaden.`);
    this.bowls = this.buildIslands(sites);
    this.group.add(this.fire.points, this.smoke.points);
    for (let i = 0; i < ISLAND_LIGHTS; i++) {
      const light = new THREE.PointLight(CONFIG.torch.color, 0, CONFIG.islands.lightRadius, CONFIG.torch.decay);
      light.position.y = 1.7;
      this.lights.push(light);
      this.group.add(light);
    }
    this.reset();
  }

  /** Neue Nacht: alle Feuer aus, Schwaden neu verteilt. */
  reset(): void {
    this.random = createRandom(CONFIG.world.seed + 100 + this.night++);
    this.igniting = null;
    this.igniteProgress = 0;
    for (const island of this.islands) {
      island.state = 'unlit';
      island.timer = 0;
      island.glow = 0;
      island.ring.visible = false;
    }
    this.fire.reset();
    this.smoke.reset();

    const { clouds, minRadius, maxRadius, startDistance } = CONFIG.finsternis;
    this.clouds.length = 0;
    for (let i = 0; i < clouds; i++) {
      const angle = this.random() * Math.PI * 2;
      const fromCenter = startDistance + this.random() * (CONFIG.world.radius - 5 - startDistance);
      const cloud: Cloud = {
        x: Math.cos(angle) * fromCenter,
        z: Math.sin(angle) * fromCenter,
        radius: minRadius + this.random() * (maxRadius - minRadius),
        directionX: 0,
        directionZ: 0,
        turnIn: 0,
      };
      this.turn(cloud, null);
      this.clouds.push(cloud);
    }
    for (const slot of this.carried) {
      slot.owner = null;
      slot.radius = 0;
    }
    for (let i = 0; i < MAX_CLOUDS; i++) clearCloudUniform(i);
  }

  /** `carriers`: wer in diesem Augenblick Finsternis mit sich trägt. */
  update(dt: number, time: number, player: Site, carriers: readonly Carrier[]): void {
    this.updateIslands(dt, time, player);
    this.updateClouds(dt, player);
    this.updateCarried(dt, carriers);
    finsternisUniforms.uViewer.value.set(player.x, player.z);
    finsternisUniforms.uFinsternisTime.value = time;
  }

  /**
   * Löscht jede brennende Feuerschale im Umkreis; gibt zurück, wie viele es waren.
   * Der Schwarze Sog nimmt die Wärme, und danach braucht die Schale ihre Pause wie nach dem Ausbrennen.
   */
  quench(x: number, z: number, radius: number): number {
    let count = 0;
    for (const island of this.islands) {
      if (island.state !== 'burning' || Math.hypot(island.x - x, island.z - z) > radius) continue;
      island.state = 'spent';
      island.timer = CONFIG.islands.spentSeconds;
      count++;
    }
    return count;
  }

  /** Besucht jede Feuerschale, die gerade brennt. */
  eachBurning(visit: (island: Site) => void): void {
    for (const island of this.islands) if (island.state === 'burning') visit(island);
  }

  /** Ersetzt die Platzhalter-Schalen durch das Modell; ohne Modell bleiben sie stehen. */
  setModel(model: PropModel | null): void {
    if (!model) return;
    const height = CONFIG.islands.model.height;
    const bowls = new THREE.InstancedMesh(model.geometry, model.material, this.islands.length);
    const pose = new THREE.Object3D();
    this.islands.forEach((island, index) => {
      pose.position.set(island.x, 0, island.z);
      // Jede Schale steht etwas anders gedreht, damit sie nicht wie gestempelt wirken.
      pose.rotation.y = island.x * 1.7 + island.z * 0.9;
      pose.scale.setScalar(height);
      pose.updateMatrix();
      bowls.setMatrixAt(index, pose.matrix);
    });
    bowls.computeBoundingSphere();
    bowls.castShadow = true;
    bowls.receiveShadow = true;
    this.group.remove(this.bowls);
    this.bowls.dispose();
    this.group.add(bowls);
    this.bowls = bowls;
    this.fireY = height * 0.9;
  }

  /** Reichweite und Farbe der Lichtquelle der Spielfigur: In ihrem Schein ist der Rauch zu sehen. */
  setViewerLight(radius: number, color: THREE.Color): void {
    this.viewerLight = radius;
    this.viewerTint.copy(color).lerp(new THREE.Color(1, 1, 1), 0.45);
  }

  /** Hält Flammen und Rauch unabhängig von Auflösung und Blickwinkel gleich groß. */
  resize(pixelHeight: number, fovDegrees: number): void {
    this.fire.resize(pixelHeight, fovDegrees);
    this.smoke.resize(pixelHeight, fovDegrees);
  }

  /** Anteil der Finsternis an einem Punkt, 0 bis 1, ohne das Wabern des Randes. */
  finsternisAt(x: number, z: number): number {
    let amount = 0;
    for (const cloud of this.clouds) {
      amount = Math.max(amount, cloudAmount(Math.hypot(x - cloud.x, z - cloud.z), cloud.radius));
    }
    for (const slot of this.carried) {
      if (slot.owner) amount = Math.max(amount, cloudAmount(Math.hypot(x - slot.x, z - slot.z), slot.radius));
    }
    return amount;
  }

  /** Die Finsternis verschluckt jeden Lichtschein, auch den einer brennenden Feuerschale. */
  zoneAt(x: number, z: number): Zone {
    if (this.finsternisAt(x, z) > 0.5) return 'finsternis';
    for (const island of this.islands) {
      if (island.state === 'burning' && Math.hypot(x - island.x, z - island.z) <= CONFIG.islands.radius) {
        return 'licht';
      }
    }
    return 'nacht';
  }

  /** Wahr im Lichtkreis einer Feuerschale, gleich ob sie gerade brennt. */
  nearIsland(x: number, z: number): boolean {
    return this.islands.some((island) => Math.hypot(x - island.x, z - island.z) <= CONFIG.islands.radius);
  }

  /** Richtung zur nächsten Feuerschale, die brennt oder entzündet werden kann. */
  nearestIsland(x: number, z: number, out: IslandBearing): IslandBearing | null {
    let best: Island | null = null;
    let bestDistance = Infinity;
    for (const island of this.islands) {
      if (island.state === 'spent') continue;
      const distance = Math.hypot(island.x - x, island.z - z);
      if (distance < bestDistance) {
        best = island;
        bestDistance = distance;
      }
    }
    if (!best) return null;
    out.dx = best.x - x;
    out.dz = best.z - z;
    out.distance = bestDistance;
    out.burning = best.state === 'burning';
    return out;
  }

  private buildIslands(sites: readonly Site[]): THREE.InstancedMesh {
    const bowl = new THREE.CylinderGeometry(0.6, 0.38, 0.45, 10);
    bowl.translate(0, 0.75, 0);
    const stand = new THREE.CylinderGeometry(0.12, 0.22, 0.55, 6);
    stand.translate(0, 0.275, 0);
    const bowls = new THREE.InstancedMesh(
      mergeGeometries([bowl, stand]),
      swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.6, metalness: 0.3 })),
      sites.length,
    );
    bowls.castShadow = true;
    bowls.receiveShadow = true;

    const ringGeometry = new THREE.RingGeometry(CONFIG.islands.radius - 0.1, CONFIG.islands.radius, 72);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb45e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    const matrix = new THREE.Matrix4();
    sites.forEach((site, index) => {
      bowls.setMatrixAt(index, matrix.makeTranslation(site.x, 0, site.z));

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(site.x, 0.04, site.z);
      this.group.add(ring);
      this.islands.push({ x: site.x, z: site.z, state: 'unlit', timer: 0, glow: 0, ring });
    });
    this.group.add(bowls);
    return bowls;
  }

  /**
   * Ausgebrannte Schalen werden dunkel: Die Textur des Modells zeigt glühende Kohlen,
   * und die sollen nur glühen, solange sich die Schale entzünden lässt oder brennt.
   */
  private shadeBowls(): void {
    for (const [index, island] of this.islands.entries()) {
      this.bowls.setColorAt(index, bowlTint.setScalar(island.state === 'spent' ? 0.3 : 1));
    }
    if (this.bowls.instanceColor) this.bowls.instanceColor.needsUpdate = true;
  }

  /** Was über einer Schale zu sehen ist: Flammen und Funken, sonst Glut oder der Rauch danach. */
  private burn(island: Island, dt: number): void {
    const p = this.particle;
    const random = Math.random;
    const spread = (): number => (random() - 0.5) * 0.36;
    p.gravity = 0;
    p.alpha = 1;

    if (island.glow > 0.02) {
      p.alpha = 0.6;
      const wanted = 95 * island.glow * dt;
      for (let i = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0); i > 0; i--) {
        p.x = island.x + spread();
        p.y = this.fireY + random() * 0.12;
        p.z = island.z + spread();
        p.vx = (random() - 0.5) * 0.35;
        p.vy = (1.2 + random() * 1.4) * (0.55 + 0.45 * island.glow);
        p.vz = (random() - 0.5) * 0.35;
        p.life = 0.3 + random() * 0.35;
        p.size = 0.3 + random() * 0.22;
        p.grow = -0.5;
        p.drag = 0.5;
        // Unten hell, an den Spitzen rot.
        p.color.set(FLAME_COLORS[Math.floor(random() * FLAME_COLORS.length)] ?? 0xff9a36);
        this.fire.spawn(p);
      }
      p.alpha = 1;
      if (random() < 7 * island.glow * dt) {
        // Ein Funke löst sich und steigt weit über das Feuer.
        p.x = island.x + spread();
        p.y = this.fireY + 0.3;
        p.z = island.z + spread();
        p.vx = (random() - 0.5) * 1.2;
        p.vy = 1.6 + random() * 1.6;
        p.vz = (random() - 0.5) * 1.2;
        p.life = 0.8 + random() * 0.8;
        p.size = 0.06;
        p.grow = -0.03;
        p.gravity = 0.8;
        p.drag = 0.4;
        p.color.set(0xffb060);
        this.fire.spawn(p);
      }
    } else if (island.state === 'unlit') {
      // Die Glut in den Kohlen zeigt, dass sich die Schale entzünden lässt.
      if (random() < 14 * dt) {
        p.x = island.x + spread();
        p.y = this.fireY + random() * 0.05;
        p.z = island.z + spread();
        p.vx = 0;
        p.vy = 0.05 + random() * 0.12;
        p.vz = 0;
        p.life = 0.7 + random() * 0.8;
        p.size = 0.12 + random() * 0.1;
        p.grow = -0.04;
        p.drag = 0;
        p.color.set(random() < 0.3 ? 0xff7a2a : 0xc8361a);
        p.alpha = 0.8;
        this.fire.spawn(p);
      }
    } else if (random() < 7 * dt) {
      // Ausgebrannt: Ein dünner Rauchfaden steht über den Kohlen.
      p.x = island.x + spread() * 0.6;
      p.y = this.fireY + 0.1;
      p.z = island.z + spread() * 0.6;
      p.vx = 0.15 + (random() - 0.5) * 0.2;
      p.vy = 0.7 + random() * 0.4;
      p.vz = (random() - 0.5) * 0.2;
      p.life = 1.8 + random() * 1.2;
      p.size = 0.3;
      p.grow = 0.5;
      p.drag = 0.2;
      p.color.set(0x8a8580);
      p.alpha = 0.35;
      this.smoke.spawn(p);
    }
  }

  private updateIslands(dt: number, time: number, player: Site): void {
    const { igniteDistance, igniteSeconds, burnSeconds, spentSeconds, lightIntensity } = CONFIG.islands;

    let candidate: Island | null = null;
    let candidateDistance: number = igniteDistance;
    for (const island of this.islands) {
      if (island.state !== 'unlit') {
        island.timer -= dt;
        if (island.timer <= 0) {
          const burnedOut = island.state === 'burning';
          island.state = burnedOut ? 'spent' : 'unlit';
          island.timer = burnedOut ? spentSeconds : 0;
        }
      }
      if (island.state === 'unlit') {
        const distance = Math.hypot(player.x - island.x, player.z - island.z);
        if (distance < candidateDistance) {
          candidate = island;
          candidateDistance = distance;
        }
      }

      // In den letzten Sekunden wird das Feuer sichtbar schwächer.
      const burning = island.state === 'burning';
      const target = burning ? Math.min(1, 0.4 + island.timer / 8) : 0;
      island.glow += (target - island.glow) * (1 - Math.exp(-4 * dt));

      // Blinkt kurz vor dem Erlöschen als Warnung.
      island.ring.visible = burning && (island.timer > 6 || Math.sin(time * 10) > 0);
      if (Math.hypot(player.x - island.x, player.z - island.z) < FIRE_RANGE) this.burn(island, dt);
    }
    this.shadeBowls();
    this.fire.update(dt, this.viewerLight, this.viewerTint);
    this.smoke.update(dt, this.viewerLight, this.viewerTint);

    if (candidate !== this.igniting) {
      this.igniting = candidate;
      this.igniteProgress = 0;
    }
    if (candidate) {
      this.igniteProgress += (dt * this.igniteFactor) / igniteSeconds;
      if (this.igniteProgress >= 1) {
        candidate.state = 'burning';
        candidate.timer = burnSeconds * this.burnFactor;
        this.igniting = null;
        this.igniteProgress = 0;
      }
    }

    // Die wenigen echten Lichtquellen wandern zu den nächsten brennenden Schalen.
    const taken = new Set<Island>();
    for (const [index, light] of this.lights.entries()) {
      let best: Island | null = null;
      let bestDistance = Infinity;
      for (const island of this.islands) {
        if (island.glow <= 0.02 || taken.has(island)) continue;
        const distance = Math.hypot(player.x - island.x, player.z - island.z);
        if (distance < bestDistance) {
          best = island;
          bestDistance = distance;
        }
      }
      if (!best) {
        light.intensity = 0;
        continue;
      }
      taken.add(best);
      light.position.x = best.x;
      light.position.z = best.z;
      light.intensity =
        lightIntensity * best.glow * (1 + 0.07 * Math.sin(time * 9 + index) + 0.04 * Math.sin(time * 21 + index * 2));
    }
  }

  private updateClouds(dt: number, player: Site): void {
    const { speed } = CONFIG.finsternis;
    const limit = CONFIG.world.radius - 4;
    for (const [index, cloud] of this.clouds.entries()) {
      cloud.turnIn -= dt;
      if (cloud.turnIn <= 0) this.turn(cloud, player);

      cloud.x += cloud.directionX * speed * dt;
      cloud.z += cloud.directionZ * speed * dt;

      // Am Kartenrand kehrt die Schwade um.
      const fromCenter = Math.hypot(cloud.x, cloud.z);
      if (fromCenter > limit && cloud.x * cloud.directionX + cloud.z * cloud.directionZ > 0) {
        cloud.directionX = -cloud.x / fromCenter;
        cloud.directionZ = -cloud.z / fromCenter;
      }
      finsternisUniforms.uClouds.value[index]?.set(cloud.x, cloud.z, cloud.radius);
    }
  }

  /** Getragene Finsternis folgt ihrem Träger; stirbt er, fällt sie in sich zusammen. */
  private updateCarried(dt: number, carriers: readonly Carrier[]): void {
    for (const slot of this.carried) slot.wanted = 0;
    for (const carrier of carriers) {
      if (carrier.mantle <= 0) continue;
      let slot = this.carried.find((candidate) => candidate.owner === carrier);
      if (!slot) {
        // Sind alle Plätze belegt, geht dieser Träger leer aus, bis einer frei wird.
        slot = this.carried.find((candidate) => candidate.owner === null);
        if (!slot) continue;
        slot.owner = carrier;
        slot.radius = 0;
      }
      slot.x = carrier.x;
      slot.z = carrier.z;
      slot.wanted = carrier.mantle;
    }
    const blend = 1 - Math.exp(-CARRIED_SHARPNESS * dt);
    for (const [index, slot] of this.carried.entries()) {
      const uniform = this.clouds.length + index;
      if (!slot.owner) continue;
      slot.radius += (slot.wanted - slot.radius) * blend;
      if (slot.wanted === 0 && slot.radius < 0.4) {
        slot.owner = null;
        slot.radius = 0;
        clearCloudUniform(uniform);
        continue;
      }
      finsternisUniforms.uClouds.value[uniform]?.set(slot.x, slot.z, slot.radius);
    }
  }

  /** Die Finsternis wechselt ihre Richtung plötzlich und manchmal gezielt auf die Spielfigur zu. */
  private turn(cloud: Cloud, player: Site | null): void {
    const { turnSeconds, huntChance } = CONFIG.finsternis;
    cloud.turnIn = turnSeconds.min + this.random() * (turnSeconds.max - turnSeconds.min);
    const toPlayer = player ? Math.hypot(player.x - cloud.x, player.z - cloud.z) : 0;
    if (player && toPlayer > 1 && this.random() < huntChance) {
      cloud.directionX = (player.x - cloud.x) / toPlayer;
      cloud.directionZ = (player.z - cloud.z) / toPlayer;
      return;
    }
    const angle = this.random() * Math.PI * 2;
    cloud.directionX = Math.cos(angle);
    cloud.directionZ = Math.sin(angle);
  }
}
