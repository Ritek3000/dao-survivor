import * as THREE from 'three';
import { CONFIG, type EnemyStrike, type EnemyType } from '../config';
import { createRandom, type Random } from '../core/random';
import { SpatialGrid } from '../core/spatialGrid';
import { swallowedByFinsternis } from './darkness';
import type { HordeClip, HordeModel } from './models';
import type { Player } from './player';
import { animatedByTexture, shadowByTexture } from './vat';
import type { World } from './world';

export interface Enemy {
  type: EnemyType;
  x: number;
  z: number;
  /** Rückstoß durch Treffer; klingt schnell ab. */
  pushX: number;
  pushZ: number;
  hp: number;
  /** 1 direkt nach einem Treffer, fällt auf 0. */
  flash: number;
  heading: number;
  age: number;
  /** Restsekunden, in denen er sich nicht rührt: umgeworfen, verwurzelt oder geblendet. */
  hold: number;
  /** Restsekunden mit halbem Tempo. */
  slow: number;
  /** Restsekunden, in denen er mehr Schaden erleidet. */
  weak: number;
  /** Wo er in der Schleife ist: 0 bis 1 über einen Durchlauf. Beim Gehen folgt sie der Strecke, beim Schweben der Zeit. */
  stride: number;
  /** Nach dem Tod: 0 bis 1, während er zu Staub zerfällt. */
  fade: number;
  /** Sekunden bis zum nächsten Zauber; nur bei Arten, die wirken. */
  castIn: number;
  /** Restsekunden des Zaubers, den er gerade wirkt; dabei steht er still. */
  casting: number;
  /** Restsekunden des Hiebs, den er gerade ausführt (die Länge der Animation läuft ab); dabei steht er still. 0 = keiner. */
  striking: number;
  /** Sekunden, bis er wieder zuschlagen darf; nur bei Arten, die zuschlagen. */
  strikeIn: number;
  /** Radius der Finsternis, die er mit sich trägt; 0 = keine. */
  mantle: number;
  /** Bewegt sich nicht von selbst: Der Verschlinger wird von boss.ts geführt. */
  driven: boolean;
}

/** Was die Horde dem Spiel meldet. */
export interface EnemyHooks {
  death(enemy: Enemy): void;
  /** Ein Gegner beginnt, den Schwarzen Sog auf die Stelle (x, z) zu wirken. */
  cast(enemy: Enemy, x: number, z: number): void;
  /** Ein Gegner holt zum Hieb aus; er blickt in `enemy.heading`. Der Boden soll die Fläche vor ihm ankündigen. */
  strike(enemy: Enemy): void;
}

/** Alle Gegner einer Art in einem Zeichenaufruf. */
interface Horde {
  type: EnemyType;
  mesh: THREE.InstancedMesh;
  /** Je Gegner: Bild der Bewegung und Zerfall. Der Platzhalter hat beides nicht. */
  anim: THREE.InstancedBufferAttribute | null;
  /** Wo Schleife, Zauber und Hieb in der Bewegungstextur liegen. */
  loop: HordeClip;
  cast: HordeClip | null;
  strike: HordeClip | null;
  /** So viele Gegner dieser Art werden in diesem Frame gezeichnet ... */
  count: number;
  /** ... und die ersten so vielen stehen im Lichtschein und werfen einen Schatten. */
  lit: number;
}

const TYPES = CONFIG.enemies.types;
const LARGEST_RADIUS = Math.max(CONFIG.boss.type.radius, ...TYPES.map((type) => type.radius));
const WHITE = new THREE.Color(0xffffff);
/** Festgehaltene Gegner wirken fahl. */
const HELD = new THREE.Color(0x8d99a8);
/** Wer gerade wirkt, schimmert kalt. */
const CASTING = new THREE.Color(0x9fb4ff);
/** So lange zerfällt ein erschlagener Gegner zu Staub. */
const FADE_SECONDS = 0.5;
/** Ein Treffer lässt die Figur kurz aufleuchten: Faktor auf ihre Farbe. */
const FLASH_GAIN = 3;
/** Gegner knapp außerhalb des Lichtscheins werfen ihren Schatten noch hinein. */
const SHADOW_MARGIN = 2;
/** Zauber und Hieb beginnen in der Animation bei 0 und enden kurz vor 1, damit das Überblenden nicht über das Schlussbild hinausgreift. */
const CAST_END = 0.999;
const PLACEHOLDER_CLIP: HordeClip = { start: 0, frames: 1, seconds: 1 };
const pose = new THREE.Object3D();
const tint = new THREE.Color();

/** Gegnerwellen: erzeugen, verfolgen, auseinanderhalten, zeichnen. */
export class Enemies {
  /** Je Gegnerart ein Netz mit vielen Instanzen. */
  readonly group = new THREE.Group();
  readonly alive: Enemy[] = [];
  /** Wer gerade Finsternis mit sich trägt; in jedem Schritt neu zusammengestellt. */
  readonly carriers: Enemy[] = [];
  kills = 0;
  /** Erschlagene, die noch zu Staub zerfallen: zu sehen, aber nicht mehr im Weg. */
  private readonly fading: Enemy[] = [];
  private readonly pool: Enemy[] = [];
  private readonly hordes = new Map<EnemyType, Horde>();
  private readonly grid = new SpatialGrid<Enemy>(2);
  private random: Random = createRandom(0);
  private spawnBudget = 0;
  private night = 0;
  /** Der Gegner, für den gerade Nachbarn abgefragt werden. */
  private current: Enemy | null = null;

  constructor() {
    // Platzhalter-Kapseln, solange (oder falls) kein GLB-Modell geladen ist.
    const geometry = new THREE.CapsuleGeometry(0.4, 0.9, 6, 12);
    geometry.translate(0, 0.85, 0);
    const material = swallowedByFinsternis(new THREE.MeshStandardMaterial({ roughness: 0.8 }), true);
    for (const type of TYPES) {
      this.adopt(type, new THREE.InstancedMesh(geometry, material, CONFIG.enemies.max), null, PLACEHOLDER_CLIP, null, null);
    }
    this.reset();
  }

  /** Ersetzt den Platzhalter einer Gegnerart durch ihr Modell. */
  setModel(type: EnemyType, model: HordeModel): void {
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(CONFIG.enemies.max * 2), 2);
    anim.setUsage(THREE.DynamicDrawUsage);
    model.geometry.setAttribute('aAnim', anim);
    const material = new THREE.MeshStandardMaterial({ map: model.map, roughness: 0.9, metalness: 0, side: model.side });
    const mesh = new THREE.InstancedMesh(
      model.geometry,
      animatedByTexture(swallowedByFinsternis(material, true), model),
      CONFIG.enemies.max,
    );
    mesh.customDistanceMaterial = shadowByTexture(new THREE.MeshDistanceMaterial(), model);
    this.adopt(type, mesh, anim, model.loop, model.cast, model.strike);
  }

  private adopt(
    type: EnemyType,
    mesh: THREE.InstancedMesh,
    anim: THREE.InstancedBufferAttribute | null,
    loop: HordeClip,
    cast: HordeClip | null,
    strike: HordeClip | null,
  ): void {
    const before = this.hordes.get(type);
    if (before) {
      this.group.remove(before.mesh);
      before.mesh.dispose();
    }
    const horde: Horde = { type, mesh, anim, loop, cast, strike, count: 0, lit: 0 };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Die Instanzen bewegen sich, die einmal berechnete Hüllkugel wäre falsch.
    mesh.frustumCulled = false;
    mesh.count = 0;
    // Legt das Farbattribut an, bevor der Shader gebaut wird.
    for (let i = 0; i < CONFIG.enemies.max; i++) mesh.setColorAt(i, WHITE);
    // In die Schattenkarte der Fackel kommen nur die Gegner in ihrem Lichtschein.
    mesh.onBeforeShadow = () => {
      mesh.count = horde.lit;
    };
    mesh.onAfterShadow = () => {
      mesh.count = horde.count;
    };
    this.hordes.set(type, horde);
    this.group.add(mesh);
  }

  reset(): void {
    this.pool.push(...this.alive, ...this.fading);
    this.alive.length = 0;
    this.fading.length = 0;
    this.carriers.length = 0;
    this.kills = 0;
    this.spawnBudget = 0;
    this.random = createRandom(CONFIG.world.seed + 500 + this.night++);
    for (const horde of this.hordes.values()) {
      horde.count = 0;
      horde.lit = 0;
      horde.mesh.count = 0;
    }
  }

  update(dt: number, time: number, player: Player, world: World, hooks: EnemyHooks): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const enemy = this.alive[i];
      if (!enemy || enemy.hp > 0) continue;
      hooks.death(enemy);
      this.kills++;
      const last = this.alive.pop();
      if (last && last !== enemy) this.alive[i] = last;
      enemy.fade = 0;
      this.fading.push(enemy);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const enemy = this.fading[i];
      if (!enemy) continue;
      enemy.fade += dt / FADE_SECONDS;
      if (enemy.fade < 1) continue;
      const last = this.fading.pop();
      if (last && last !== enemy) this.fading[i] = last;
      this.pool.push(enemy);
    }
    this.spawn(dt, time, player);

    this.grid.clear();
    for (const enemy of this.alive) this.grid.insert(enemy.x, enemy.z, enemy);

    const playerX = player.position.x;
    const playerZ = player.position.z;
    const pushDecay = Math.exp(-8 * dt);
    this.carriers.length = 0;
    for (const enemy of this.alive) {
      enemy.age += dt;
      enemy.flash = Math.max(0, enemy.flash - dt * 6);
      const held = enemy.hold > 0;
      const speed = enemy.type.speed * (enemy.slow > 0 ? 0.5 : 1);
      enemy.hold = Math.max(0, enemy.hold - dt);
      enemy.slow = Math.max(0, enemy.slow - dt);
      enemy.weak = Math.max(0, enemy.weak - dt);
      if (enemy.mantle > 0) this.carriers.push(enemy);

      enemy.x += enemy.pushX * dt;
      enemy.z += enemy.pushZ * dt;
      enemy.pushX *= pushDecay;
      enemy.pushZ *= pushDecay;
      // Den Verschlinger führt boss.ts: Er läuft, stürmt und schlägt nach eigenen Regeln.
      if (enemy.driven) continue;

      let dx = playerX - enemy.x;
      let dz = playerZ - enemy.z;
      let distance = Math.hypot(dx, dz);
      if (distance > CONFIG.enemies.recycleDistance && this.place(enemy, player)) continue;

      let walking = !held;
      const cast = enemy.type.cast;
      if (cast) {
        if (enemy.casting > 0) {
          // Wer wirkt, steht.
          enemy.casting = Math.max(0, enemy.casting - dt);
          walking = false;
        } else {
          enemy.castIn -= dt;
          if (distance < cast.keep) walking = false;
          if (!held && enemy.castIn <= 0 && distance < cast.range) {
            enemy.casting = cast.windup;
            enemy.castIn = cast.cooldown * (0.85 + 0.3 * this.random());
            hooks.cast(enemy, playerX, playerZ);
            walking = false;
          }
        }
      }
      // Wer zuschlägt, tut es statt zu berühren: Er bleibt stehen, holt aus (der Boden kündigt die Fläche an) und trifft in
      // der Sekunde der Animation, in der die Krallen durchfahren. Ohne Modell mit Hieb-Animation gilt die Berührung.
      const strike = enemy.type.strike;
      const strikeClip = strike ? (this.hordes.get(enemy.type)?.strike ?? null) : null;
      if (strike && strikeClip) {
        if (enemy.striking > 0) {
          walking = false;
          if (held) {
            // Wer umgeworfen oder festgehalten wird, bricht den Hieb ab.
            enemy.striking = 0;
            enemy.strikeIn = strike.cooldown;
          } else {
            const landing = strikeClip.seconds - strike.hitAt;
            const before = enemy.striking;
            enemy.striking = Math.max(0, before - dt);
            if (before > landing && enemy.striking <= landing) this.land(enemy, strike, player);
            if (enemy.striking === 0) enemy.strikeIn = strike.cooldown;
          }
        } else {
          enemy.strikeIn -= dt;
          if (!held && enemy.strikeIn <= 0 && distance < strike.reach) {
            enemy.striking = strikeClip.seconds;
            // Die Fläche gilt ab jetzt: Er blickt dorthin, wo die Spielfigur steht, und dreht sich im Hieb nicht mehr nach.
            enemy.heading = Math.atan2(dx, dz);
            hooks.strike(enemy);
            walking = false;
          }
        }
      }
      if (distance > 1e-4 && enemy.striking <= 0) enemy.heading = Math.atan2(dx, dz);
      const hovers = enemy.type.model.hover !== undefined;
      if (distance > 1e-4 && walking) {
        const step = (speed * dt) / distance;
        enemy.x += dx * step;
        enemy.z += dz * step;
        // Die Beine laufen so schnell, wie er vorankommt; wer festgehalten wird, erstarrt im Schritt.
        if (!hovers) enemy.stride = (enemy.stride + (speed * dt) / enemy.type.model.stride) % 1;
      }
      // Wer schwebt, wiegt sich nach der Zeit, auch wenn er auf Abstand steht; festgehalten erstarrt er.
      if (hovers && !held) enemy.stride = (enemy.stride + dt / (this.hordes.get(enemy.type)?.loop.seconds ?? 1)) % 1;

      this.current = enemy;
      this.grid.query(enemy.x, enemy.z, enemy.type.radius + LARGEST_RADIUS, this.separate);
      world.resolve(enemy, enemy.type.radius);

      // Wer die Spielfigur berührt, verletzt sie und bleibt an ihrem Rand stehen.
      dx = enemy.x - playerX;
      dz = enemy.z - playerZ;
      distance = Math.hypot(dx, dz);
      const reach = enemy.type.radius + CONFIG.player.radius;
      if (distance < reach) {
        // Wer zuschlagen kann, verletzt nicht durch Berührung; der Hieb ist sein Angriff.
        if (!held && !(strike && strikeClip)) player.hurt(enemy.type.damage);
        if (distance > 1e-4) {
          const push = (reach - distance) / distance;
          enemy.x += dx * push;
          enemy.z += dz * push;
        }
      }
    }
    this.writeInstances(player);
  }

  /** Die Krallen fahren durch: Wer jetzt in der angekündigten Fläche steht, wird getroffen. */
  private land(enemy: Enemy, strike: EnemyStrike, player: Player): void {
    const dx = player.position.x - enemy.x;
    const dz = player.position.z - enemy.z;
    const toPlayer = Math.atan2(dx, dz);
    // Der Winkel zwischen Blickrichtung und Spielfigur, auf -pi bis pi gebracht.
    const off = Math.abs(Math.atan2(Math.sin(toPlayer - enemy.heading), Math.cos(toPlayer - enemy.heading)));
    // Die Fläche ist nach vorn angekündigt; der halbe Radius der Spielfigur ist Nachsicht, wie beim Hieb des Verschlingers.
    if (Math.hypot(dx, dz) <= strike.reach + CONFIG.player.radius * 0.5 && off <= strike.arc / 2) {
      player.hurt(enemy.type.damage, false, true);
    }
  }

  damage(enemy: Enemy, amount: number, pushX: number, pushZ: number): void {
    enemy.hp -= amount;
    enemy.flash = 1;
    enemy.pushX += pushX;
    enemy.pushZ += pushZ;
  }

  /** Besucht Gegner in der Nähe eines Kreises; der Aufrufer prüft den genauen Abstand selbst. */
  queryRadius(x: number, z: number, radius: number, visit: (enemy: Enemy) => void): void {
    this.grid.query(x, z, radius + LARGEST_RADIUS, visit);
  }

  nearest(x: number, z: number, maxDistance: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistance = maxDistance;
    for (const enemy of this.alive) {
      if (enemy.hp <= 0) continue;
      const distance = Math.hypot(enemy.x - x, enemy.z - z) - enemy.type.radius;
      if (distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Stellt einen einzelnen Gegner an eine feste Stelle, etwa den Verschlinger.
   * Er zählt wie jeder andere als Ziel der Angriffe, bewegt sich aber nicht von selbst.
   */
  summon(type: EnemyType, x: number, z: number): Enemy {
    const enemy = this.fresh(type, type.hp);
    enemy.x = x;
    enemy.z = z;
    enemy.driven = true;
    this.alive.push(enemy);
    return enemy;
  }

  private spawn(dt: number, time: number, player: Player): void {
    const { max, baseRate, ratePerMinute, hpDoubleSeconds } = CONFIG.enemies;
    this.spawnBudget += (baseRate + (ratePerMinute * time) / 60) * dt;
    while (this.spawnBudget >= 1) {
      this.spawnBudget -= 1;
      if (this.alive.length >= max) continue;
      const type = this.pickType(time);
      const enemy = this.fresh(type, type.hp * (1 + time / hpDoubleSeconds));
      if (this.place(enemy, player)) this.alive.push(enemy);
      else this.pool.push(enemy);
    }
  }

  /** Ein unverbrauchter Gegner dieser Art; wer zu Staub zerfallen ist, wird dafür wiederverwendet. */
  private fresh(type: EnemyType, hp: number): Enemy {
    const enemy: Enemy = this.pool.pop() ?? {
      type,
      x: 0,
      z: 0,
      pushX: 0,
      pushZ: 0,
      hp: 0,
      flash: 0,
      heading: 0,
      age: 0,
      hold: 0,
      slow: 0,
      weak: 0,
      stride: 0,
      fade: 0,
      castIn: 0,
      casting: 0,
      striking: 0,
      strikeIn: 0,
      mantle: 0,
      driven: false,
    };
    enemy.type = type;
    enemy.hp = hp;
    enemy.pushX = 0;
    enemy.pushZ = 0;
    enemy.flash = 0;
    enemy.age = 0;
    enemy.hold = 0;
    enemy.slow = 0;
    enemy.weak = 0;
    // Jeder beginnt irgendwo im Schritt, sonst marschiert die Horde im Gleichtakt.
    enemy.stride = this.random();
    enemy.fade = 0;
    // Der erste Zauber kommt nicht sofort, und nicht alle wirken im selben Augenblick.
    enemy.castIn = type.cast ? 1 + this.random() * type.cast.cooldown * 0.5 : 0;
    enemy.casting = 0;
    enemy.striking = 0;
    enemy.strikeIn = 0;
    enemy.mantle = type.mantle ?? 0;
    enemy.driven = false;
    return enemy;
  }

  /** Setzt einen Gegner auf einen Ring knapp außerhalb des Sichtfelds. */
  private place(enemy: Enemy, player: Player): boolean {
    const { min, max } = CONFIG.enemies.spawnRing;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const distance = min + this.random() * (max - min);
      const x = player.position.x + Math.cos(angle) * distance;
      const z = player.position.z + Math.sin(angle) * distance;
      if (Math.hypot(x, z) > CONFIG.world.radius - 1) continue;
      enemy.x = x;
      enemy.z = z;
      return true;
    }
    return false;
  }

  private pickType(time: number): EnemyType {
    let total = 0;
    for (const type of TYPES) if (this.mayAppear(type, time)) total += type.weight;
    let roll = this.random() * total;
    for (const type of TYPES) {
      if (!this.mayAppear(type, time)) continue;
      roll -= type.weight;
      if (roll <= 0) return type;
    }
    // Der erste Typ ist von Beginn an verfügbar.
    return TYPES[0] as EnemyType;
  }

  /** Ist seine Zeit gekommen, und sind noch nicht zu viele seiner Art unterwegs? */
  private mayAppear(type: EnemyType, time: number): boolean {
    if (type.from > time) return false;
    if (type.maxAlive === undefined) return true;
    let count = 0;
    for (const enemy of this.alive) if (enemy.type === type) count++;
    return count < type.maxAlive;
  }

  private readonly separate = (other: Enemy): void => {
    const enemy = this.current;
    if (!enemy || other === enemy) return;
    const dx = enemy.x - other.x;
    const dz = enemy.z - other.z;
    const minDistance = enemy.type.radius + other.type.radius;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= minDistance * minDistance) return;
    if (distanceSq < 1e-8) {
      // Exakt übereinander: irgendwohin ausweichen, sonst lösen sie sich nie.
      enemy.x += 0.01;
      return;
    }
    const distance = Math.sqrt(distanceSq);
    const push = ((minDistance - distance) / distance) * 0.5;
    enemy.x += dx * push;
    enemy.z += dz * push;
  };

  private writeInstances(player: Player): void {
    for (const horde of this.hordes.values()) horde.count = 0;

    // Zuerst die Gegner im Lichtschein: Nur sie müssen in die Schattenkarte.
    const playerX = player.position.x;
    const playerZ = player.position.z;
    const litSq = (player.light + SHADOW_MARGIN) ** 2;
    for (const enemy of this.alive) {
      if ((enemy.x - playerX) ** 2 + (enemy.z - playerZ) ** 2 <= litSq) this.write(enemy);
    }
    for (const horde of this.hordes.values()) horde.lit = horde.count;
    for (const enemy of this.alive) {
      if ((enemy.x - playerX) ** 2 + (enemy.z - playerZ) ** 2 > litSq) this.write(enemy);
    }
    for (const enemy of this.fading) this.write(enemy);

    for (const horde of this.hordes.values()) {
      horde.mesh.count = horde.count;
      horde.mesh.instanceMatrix.needsUpdate = true;
      if (horde.mesh.instanceColor) horde.mesh.instanceColor.needsUpdate = true;
      if (horde.anim) horde.anim.needsUpdate = true;
    }
  }

  /** Welches Bild der Bewegungstextur der Gegner zeigt: den Hieb oder den Zauber, solange sie laufen, sonst die Schleife. */
  private frameOf(enemy: Enemy, horde: Horde): number {
    if (enemy.striking > 0 && horde.strike) {
      // Der Hieb läuft in Echtzeit von vorn bis hinten.
      const progress = Math.min(CAST_END, 1 - enemy.striking / horde.strike.seconds);
      return horde.strike.start + progress * horde.strike.frames;
    }
    const cast = enemy.type.cast;
    if (enemy.casting > 0 && horde.cast && cast && cast.windup > 0) {
      // Die Animation läuft genau über die Sekunden, in denen der Zauber heranreift; am Ende schlägt er ein.
      const progress = Math.min(CAST_END, 1 - enemy.casting / cast.windup);
      return horde.cast.start + progress * horde.cast.frames;
    }
    return horde.loop.start + enemy.stride * horde.loop.frames;
  }

  private write(enemy: Enemy): void {
    const horde = this.hordes.get(enemy.type);
    if (!horde) return;
    const index = horde.count++;
    // Neue Gegner wachsen kurz aus dem Boden, statt plötzlich dazustehen.
    const grow = 0.3 + 0.7 * Math.min(1, enemy.age / 0.3);
    pose.position.set(enemy.x, 0, enemy.z);
    pose.rotation.y = enemy.heading;

    if (horde.anim) {
      // Das Modell bringt Größe und Farbe mit; ein Treffer lässt es aufleuchten.
      pose.scale.setScalar(grow);
      horde.anim.setXY(index, this.frameOf(enemy, horde), enemy.fade);
      tint.copy(WHITE);
      if (enemy.hold > 0) tint.lerp(HELD, 0.55);
      if (enemy.casting > 0) tint.lerp(CASTING, 0.6).multiplyScalar(1.6);
      tint.multiplyScalar(1 + FLASH_GAIN * enemy.flash);
    } else {
      pose.scale.setScalar(enemy.type.scale * grow * (1 - enemy.fade));
      tint.set(enemy.type.color);
      if (enemy.hold > 0) tint.lerp(HELD, 0.55);
      if (enemy.casting > 0) tint.lerp(CASTING, 0.7);
      tint.lerp(WHITE, enemy.flash);
    }
    pose.updateMatrix();
    horde.mesh.setMatrixAt(index, pose.matrix);
    horde.mesh.setColorAt(index, tint);
  }
}
