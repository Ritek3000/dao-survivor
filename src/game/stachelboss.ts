/**
 * Der Stachelträger: der zweite Boss der Nacht. Er kommt früh und bedrängt die Spielfigur aus der Ferne.
 *
 * Für die Angriffe der Spielfigur ist er ein Gegner wie jeder andere (ein Eintrag in der Horde), aber er bewegt sich nach eigenen
 * Regeln und hat ein eigenes Skelett mit Animationen (tools/stachelschwein-animieren.py):
 *   Stachelwurf    der Standardangriff: Er greift mit einer Hand in den Rücken, zieht einen Stachel und wirft ihn; die Hände wechseln
 *   Stachelsalve   Er schüttelt den Rücken, zehn Stacheln fliegen im hohen Bogen auf eine vorher angekündigte Fläche von 12 m Durchmesser;
 *                  wen einer trifft, der ist kurz festgesetzt (`Player.root`)
 *   Rage           unter einem Drittel seines Lebens greift er schneller an und schüttelt öfter; er pulsiert dabei rötlich
 * Die Stacheln selbst fliegen im Vorrat von `quills.ts`. Alle Zahlen stehen in `CONFIG.stachelboss`.
 */
import * as THREE from 'three';
import { audio } from '../audio';
import { CONFIG } from '../config';
import { createRandom, deriveSeed, type Random } from '../core/random';
import { extendShader, swallowedByFinsternis } from './darkness';
import type { Enemies, Enemy } from './enemies';
import type { BossModel } from './models';
import type { Player } from './player';
import { Quills, type SalveZone } from './quills';
import { clearStatus, slowFactor } from './status';
import type { Threats } from './threats';
import type { World } from './world';

/** 'walk' = geht auf die Spielfigur zu oder steht, 'wurf' = holt aus und wirft, 'salve' = schüttelt den Rücken, 'dying' = fällt und zerfällt. */
type Mode = 'walk' | 'wurf' | 'salve' | 'dying';
type ClipName = keyof typeof CONFIG.stachelboss.clips;
export type StachelbossEvent = 'erschienen' | 'rage';

const SPEC = CONFIG.stachelboss;
const TYPE = SPEC.type;
/** Sekunden, in denen er nach dem Sturz zu Staub zerfällt. */
const DISSOLVE_SECONDS = 1.8;
const CROSSFADE = 0.18;
/** Höhe über dem Boden, in der die Stacheln den Rücken verlassen (in der Hocke geschüttelt, bei 3,4 m Größe). */
const BACK_HEIGHT = 2.7;
/** Rückfall für die Hand, wenn das Modell fehlt: Höhe der Hand beim Wurf. */
const HAND_HEIGHT = 2.4;
/** Stärke des roten Pulsierens in der Rage (Emission; 0 = keins). */
const RAGE_GLOW = 0.34;
const GOLDEN_ANGLE = 2.399963;

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class Stachelboss {
  /** Trägt Position und Blickrichtung; darin steht das Modell oder der Platzhalter. */
  readonly group = new THREE.Group();
  /** Seine Stacheln: im Flug und im Boden. */
  readonly quills = new Quills();
  /** Sein Eintrag in der Horde, solange er lebt. */
  enemy: Enemy | null = null;
  /** Ist er in dieser Nacht schon erschienen, und wurde er erschlagen? */
  appeared = false;
  slain = false;
  /** Sekunde der Nacht, in der er erschlagen wurde; für den Messlauf. */
  slainAt = 0;
  private readonly placeholder: THREE.Mesh;
  private readonly dissolve = { value: 0 };
  private model: BossModel | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private playing: ClipName | null = null;
  private mode: Mode = 'walk';
  /** Faktor der Nacht auf sein Leben; 1, solange kein Grad es erhöht. */
  private hpFactor = 1;
  /** Eigener Strom des Zufalls, damit er den des Laufs (Angebote, Verschlinger) nicht verschiebt. */
  private random: Random = createRandom(0);
  /** Restsekunden des laufenden Abschnitts, und wie viele Sekunden der Animation schon vergangen sind. */
  private timer = 0;
  private elapsed = 0;
  private heading = 0;
  private wurfIn = 0;
  private salveIn = 0;
  /** Welche Hand als Nächste wirft: 1 = links (Stachelwurf), -1 = rechts (Stachelwurf2). */
  private hand: 1 | -1 = 1;
  private released = false;
  private shaken = false;
  private raging = false;
  private rageTime = 0;
  private event: StachelbossEvent | null = null;
  /** Die Hände (Knochen des Modells) und der Stachel, den die Hand beim Wurf hält. */
  private readonly hands = new Map<1 | -1, THREE.Object3D>();
  private heldQuill: THREE.Mesh | null = null;
  private readonly handPosition = new THREE.Vector3();

  constructor() {
    const height = TYPE.model.height;
    const geometry = new THREE.CapsuleGeometry(height * 0.26, height * 0.45, 6, 14);
    geometry.translate(0, height * 0.49, 0);
    this.placeholder = new THREE.Mesh(
      geometry,
      swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: TYPE.color, roughness: 0.85 }), true),
    );
    this.placeholder.castShadow = true;
    // Die Stacheln (`quills.group`) gehören der Welt, nicht ihm: Sie fliegen weiter, wenn er sich dreht, und sind auch zu sehen, wenn er verschwindet.
    this.group.add(this.placeholder);
    this.group.visible = false;
  }

  /** Ersetzt den Platzhalter durch das Modell; ohne Modell bleibt die Kapsel stehen. */
  setModel(model: BossModel | null): void {
    if (!model) return;
    this.model = model;
    this.group.remove(this.placeholder);
    this.group.add(model.root);
    this.mixer = new THREE.AnimationMixer(model.root);
    for (const name of Object.keys(SPEC.clips) as ClipName[]) {
      const wanted = SPEC.clips[name].toLowerCase();
      // Genau passend zuerst: „Stachelwurf“ steckt auch im Namen von „Stachelwurf2“.
      const clip =
        model.clips.find((candidate) => candidate.name.toLowerCase() === wanted) ??
        model.clips.find((candidate) => candidate.name.toLowerCase().includes(wanted));
      if (clip) this.actions.set(name, this.mixer.clipAction(clip));
    }
    for (const material of model.materials) {
      extendShader(material, 'zerfall', (shader) => {
        shader.uniforms.uDissolve = this.dissolve;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uDissolve;')
          .replace(
            '#include <color_fragment>',
            /* glsl */ `#include <color_fragment>
            if (uDissolve > 0.0) {
              // Körnig statt durchsichtig, wie bei der Horde: Staub rieselt, er verblasst nicht.
              float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
              if (grain < uDissolve) discard;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.46, 0.43, 0.39), min(1.0, uDissolve * 1.5));
            }`,
          );
      });
    }
    // Der Stachel in der Hand: Er hängt am Knochen der Hand und teilt Form und Material mit den fliegenden.
    for (const side of [1, -1] as const) {
      const bone = model.root.getObjectByName(side === 1 ? 'Arm_L_Hand' : 'Arm_R_Hand');
      if (bone) this.hands.set(side, bone);
    }
    const held = this.quills.createHeld();
    // Der Knochen steckt im Modell, das auf die Größe im Spiel gebracht wurde; der Stachel soll dennoch so lang sein wie die fliegenden.
    const scale = model.root.children[0]?.scale.x ?? 1;
    held.scale.setScalar(1 / scale);
    // Er liegt quer in der Faust: Der Knochen zeigt entlang der Finger, der Stachel steht im rechten Winkel dazu.
    held.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    held.position.set(0, 0.12, 0);
    held.visible = false;
    this.heldQuill = held;
  }

  /** Neue Nacht: Er ist noch nicht da. `hpFactor` ist der Faktor der Nacht auf sein Leben (der Grad, siehe `nights.ts`). */
  reset(hpFactor = 1, seed = 0): void {
    this.hpFactor = hpFactor;
    this.random = createRandom(deriveSeed(seed, 600));
    this.enemy = null;
    this.appeared = false;
    this.slain = false;
    this.slainAt = 0;
    this.event = null;
    this.raging = false;
    this.group.visible = false;
    this.dissolve.value = 0;
    this.mode = 'walk';
    this.mixer?.stopAllAction();
    this.playing = null;
    this.hideHeld();
    this.quills.reset();
    this.setGlow(0, 0);
  }

  /** Anteil seines Lebens von 0 bis 1; 0, wenn er nicht da ist. */
  get hpFraction(): number {
    return this.enemy ? Math.max(0, this.enemy.hp / this.enemy.maxHp) : 0;
  }

  /** Ist er in der Rage? */
  get enraged(): boolean {
    return this.raging;
  }

  /** Was seit dem letzten Aufruf geschehen ist; jedes Ereignis wird einmal gemeldet. */
  consumeEvent(): StachelbossEvent | null {
    const event = this.event;
    this.event = null;
    return event;
  }

  update(dt: number, time: number, player: Player, enemies: Enemies, threats: Threats, world: World): void {
    if (!this.appeared && time >= SPEC.from) this.appear(player, enemies);
    if (this.mode === 'dying') this.updateDying(dt);
    const enemy = this.enemy;
    if (enemy) {
      // Ihn hält nichts fest; verlangsamen lässt er sich, aber nur bis `CONFIG.boss.slowFloor`.
      clearStatus(enemy.status, 'hold');
      this.wurfIn -= dt;
      this.salveIn -= dt;
      this.updateRage(dt, enemy);
      this.act(dt, enemy, player, threats, world);
      this.group.position.set(enemy.x, 0, enemy.z);
      this.group.rotation.y = this.heading;
      enemy.heading = this.heading;
      this.setGlow(enemy.flash, this.rageTime);
    }
    this.mixer?.update(dt);
    this.quills.update(dt, player, threats);
  }

  /** Die Spielfigur hat ihn erschlagen: Er stürzt und zerfällt zu Staub. */
  fall(time: number): void {
    audio.play('stachelboss.faellt', this.group.position.x, this.group.position.z);
    this.enemy = null;
    this.slain = true;
    this.slainAt = time;
    this.mode = 'dying';
    this.timer = (this.actions.get('dead')?.getClip().duration ?? 0.6) + DISSOLVE_SECONDS;
    this.hideHeld();
    this.play('dead', 0.12, false);
    this.setGlow(0, 0);
  }

  /** Nach dem Ende der Nacht: Er rührt sich nicht mehr vom Fleck, bleibt aber lebendig. */
  animate(dt: number): void {
    if (this.mode === 'dying') this.updateDying(dt);
    else if (this.enemy) this.play('idle');
    this.mixer?.update(dt);
  }

  private appear(player: Player, enemies: Enemies): void {
    this.appeared = true;
    // Er kommt vom Rand des Sichtfelds, möglichst von innerhalb der Steinmale.
    const distance = CONFIG.enemies.spawnRing.max;
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = this.random() * Math.PI * 2;
      x = player.position.x + Math.cos(angle) * distance;
      z = player.position.z + Math.sin(angle) * distance;
      if (Math.hypot(x, z) < CONFIG.world.radius - 3) break;
    }
    this.enemy = enemies.summon(TYPE, x, z, this.hpFactor);
    this.heading = Math.atan2(player.position.x - x, player.position.z - z);
    this.mode = 'walk';
    this.timer = 0;
    this.wurfIn = 1;
    this.salveIn = SPEC.salve.interval * 0.6;
    this.hand = 1;
    this.raging = false;
    this.rageTime = 0;
    this.dissolve.value = 0;
    this.group.visible = true;
    this.event = 'erschienen';
    audio.play('stachelboss.erscheint', x, z);
  }

  /** Unter der Schwelle gerät er in Rage; sie hält bis zu seinem Ende an. */
  private updateRage(dt: number, enemy: Enemy): void {
    if (!this.raging && enemy.hp <= enemy.maxHp * SPEC.rage.below) {
      this.raging = true;
      this.event = 'rage';
      audio.play('stachelboss.rage', enemy.x, enemy.z);
      // Die laufende Animation wird gleich schneller.
      if (this.mode === 'wurf') this.setTimeScale(this.hand === 1 ? 'wurf' : 'wurf2', SPEC.rage.speed);
      else if (this.mode === 'salve') this.setTimeScale('salve', SPEC.rage.speed);
    }
    if (this.raging) this.rageTime += dt;
  }

  /** Tempo seiner Angriffe: in der Rage schneller. */
  private get pace(): number {
    return this.raging ? SPEC.rage.speed : 1;
  }

  private act(dt: number, enemy: Enemy, player: Player, threats: Threats, world: World): void {
    const dx = player.position.x - enemy.x;
    const dz = player.position.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    this.timer -= dt;
    this.elapsed += dt;

    switch (this.mode) {
      case 'walk': {
        if (distance > CONFIG.enemies.recycleDistance) {
          // Abgehängt: Wie jeder Gegner taucht er am Rand des Sichtfelds wieder aus dem Dunkel auf.
          const back = CONFIG.enemies.spawnRing.max / distance;
          enemy.x = player.position.x - dx * back;
          enemy.z = player.position.z - dz * back;
          this.heading = toPlayer;
          break;
        }
        this.turn(toPlayer, SPEC.turnRate * dt);
        // Er blickt zur Spielfigur, bevor er angreift: Wer hinter ihm läuft, hat Zeit.
        const facing = Math.cos(wrap(toPlayer - this.heading));
        if (distance < SPEC.range && facing > 0.8) {
          if (this.salveIn <= 0) {
            this.startSalve(enemy, player, threats);
            break;
          }
          if (this.wurfIn <= 0) {
            this.startWurf();
            break;
          }
        }
        // Er geht dorthin, wohin er blickt; steht die Spielfigur seitlich, dreht er sich erst. Nah genug, bleibt er stehen.
        const speed = TYPE.speed * slowFactor(enemy.status, CONFIG.boss.slowFloor) * Math.max(0, facing);
        if (distance > SPEC.stand && speed > 0.3) {
          enemy.x += Math.sin(this.heading) * speed * dt;
          enemy.z += Math.cos(this.heading) * speed * dt;
          world.resolve(enemy, TYPE.radius * 0.7);
          this.play('walk', CROSSFADE, true, (speed * this.clipSeconds('walk')) / TYPE.model.stride);
        } else {
          this.play('idle');
        }
        break;
      }

      case 'wurf': {
        // Bis zum Wurf blickt er der Spielfigur nach; danach fängt er sich.
        if (!this.released) this.turn(toPlayer, SPEC.turnRate * 1.5 * dt);
        const clipTime = this.elapsed * this.pace;
        this.showHeld(clipTime >= SPEC.wurf.heldFrom && !this.released);
        if (!this.released && clipTime >= SPEC.wurf.releaseAt) this.release(enemy, player);
        if (this.timer <= 0) {
          this.hideHeld();
          this.mode = 'walk';
        }
        break;
      }

      case 'salve': {
        // Er schüttelt sich am Ort und blickt zur Mitte der Fläche, bis die Stacheln fliegen.
        if (!this.shaken) this.turn(toPlayer, SPEC.turnRate * dt);
        if (!this.shaken && this.elapsed * this.pace >= SPEC.salve.launchAt) {
          this.shaken = true;
          audio.play('stachelboss.salve', enemy.x, enemy.z);
          threats.thud(enemy.x, enemy.z, 2.4);
        }
        if (this.timer <= 0) this.mode = 'walk';
        break;
      }

      case 'dying':
        break;
    }

    // Wie jeder Gegner bleibt er am Rand der Spielfigur stehen, statt in ihr.
    const reach = TYPE.radius + CONFIG.player.radius;
    const away = Math.hypot(enemy.x - player.position.x, enemy.z - player.position.z);
    if (away < reach && away > 1e-4) {
      const push = (reach - away) / away;
      enemy.x += (enemy.x - player.position.x) * push;
      enemy.z += (enemy.z - player.position.z) * push;
    }
  }

  /** Holt aus: Die Hand greift in den Rücken. Der Stachel fliegt erst, wenn die Animation die Hand loslässt. */
  private startWurf(): void {
    const clip: ClipName = this.hand === 1 ? 'wurf' : 'wurf2';
    this.mode = 'wurf';
    this.released = false;
    this.elapsed = 0;
    const seconds = this.clipSeconds(clip) / this.pace;
    this.timer = seconds;
    this.wurfIn = SPEC.wurf.interval / this.pace;
    this.play(clip, 0.1, false, this.pace);
    // Ohne Animation (Platzhalter) wirft er trotzdem; die Zeit läuft dann nach der Uhr.
    if (!this.actions.has(clip)) this.timer = SPEC.wurf.releaseAt + 0.2;
  }

  /** Der Stachel verlässt die Hand und fliegt zu der Stelle, an der die Spielfigur jetzt steht. */
  private release(enemy: Enemy, player: Player): void {
    this.released = true;
    this.hideHeld();
    const hand = this.hands.get(this.hand);
    const position = this.handPosition;
    if (hand) {
      hand.getWorldPosition(position);
    } else {
      position.set(enemy.x + Math.sin(this.heading) * 0.8, HAND_HEIGHT, enemy.z + Math.cos(this.heading) * 0.8);
    }
    this.quills.throwAt(enemy, position.x, Math.max(1.2, position.y), position.z, player.position.x, player.position.z);
    audio.play('stachelboss.wurf', enemy.x, enemy.z);
    this.hand = this.hand === 1 ? -1 : 1;
  }

  /**
   * Beginnt die Salve: Die Fläche um die Spielfigur wird angekündigt, und die Stacheln stehen schon fest. Jeder bekommt seinen Punkt in der
   * Fläche (auf einer Spirale, damit sie dicht gedeckt ist, mit etwas Zufall) und seinen Zeitpunkt; sie fliegen ab `launchAt`.
   */
  private startSalve(enemy: Enemy, player: Player, threats: Threats): void {
    const { salve } = SPEC;
    const pace = this.pace;
    this.mode = 'salve';
    this.shaken = false;
    this.elapsed = 0;
    this.timer = this.clipSeconds('salve') / pace;
    if (!this.actions.has('salve')) this.timer = salve.launchAt + 1.5;
    this.salveIn = salve.interval * (this.raging ? SPEC.rage.cooldown : 1);
    this.play('salve', 0.15, false, pace);

    const cx = player.position.x;
    const cz = player.position.z;
    const zone: SalveZone = this.quills.openZone(cx, cz, salve.radius, salve.count);
    // Die Reihenfolge, in der die Punkte der Spirale an die Stacheln gehen, ist gewürfelt.
    const order = Array.from({ length: salve.count }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    const phase = this.random() * Math.PI * 2;
    const reachMax = salve.radius - 0.6;
    let lastLanding = 0;
    for (let n = 0; n < salve.count; n++) {
      const slot = order[n] as number;
      const r = reachMax * Math.sqrt((slot + 0.5) / salve.count);
      const angle = phase + slot * GOLDEN_ANGLE;
      const jitter = 0.45;
      const tx = cx + Math.cos(angle) * r + (this.random() - 0.5) * jitter * 2;
      const tz = cz + Math.sin(angle) * r + (this.random() - 0.5) * jitter * 2;
      const flight = salve.flight[0] + this.random() * (salve.flight[1] - salve.flight[0]);
      const delay = (salve.launchAt + (n / salve.count) * salve.spread) / pace;
      // Vom Rücken, etwas verstreut, damit es nach einer Mähne aussieht und nicht nach einer Düse.
      const back = -0.5;
      const sx = enemy.x + Math.sin(this.heading) * back + (this.random() - 0.5) * 1.6;
      const sz = enemy.z + Math.cos(this.heading) * back + (this.random() - 0.5) * 1.6;
      this.quills.arcTo(enemy, sx, BACK_HEIGHT + this.random() * 0.5, sz, tx, tz, flight, delay, zone);
      lastLanding = Math.max(lastLanding, delay + flight);
    }
    // Die Fläche steht, bis der letzte Stachel eingeschlagen ist; ein zusammenziehender Ring zeigt, wann es losgeht.
    threats.marker(cx, cz, salve.radius, lastLanding);
  }

  private updateDying(dt: number): void {
    this.timer -= dt;
    this.dissolve.value = Math.min(1, Math.max(0, 1 - this.timer / DISSOLVE_SECONDS));
    if (this.timer > 0) return;
    this.group.visible = false;
    this.mode = 'walk';
  }

  private turn(target: number, maxStep: number): void {
    const delta = wrap(target - this.heading);
    this.heading += Math.min(maxStep, Math.max(-maxStep, delta));
  }

  private clipSeconds(name: ClipName): number {
    return this.actions.get(name)?.getClip().duration ?? 1;
  }

  private setTimeScale(name: ClipName, timeScale: number): void {
    this.actions.get(name)?.setEffectiveTimeScale(timeScale);
  }

  /** Blendet zu einer Animation über; läuft sie schon, wird nur ihr Tempo nachgeführt. */
  private play(name: ClipName, fade = CROSSFADE, loop = true, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.playing === name && loop) {
      next.setEffectiveTimeScale(timeScale);
      return;
    }
    const before = this.playing ? this.actions.get(this.playing) : undefined;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.fadeIn(fade).play();
    if (before && before !== next) before.fadeOut(fade);
    this.playing = name;
  }

  /** Zeigt den Stachel in der Hand, die gleich wirft, und nimmt ihn aus der anderen. */
  private showHeld(visible: boolean): void {
    const held = this.heldQuill;
    if (!held) return;
    if (!visible) {
      this.hideHeld();
      return;
    }
    const bone = this.hands.get(this.hand);
    if (bone && held.parent !== bone) bone.add(held);
    held.visible = true;
  }

  private hideHeld(): void {
    if (this.heldQuill) this.heldQuill.visible = false;
  }

  /** Ein Treffer lässt ihn kurz aufleuchten, wie die Horde; in der Rage pulsiert er dazu rötlich. */
  private setGlow(flash: number, rageTime: number): void {
    const hit = flash * 0.3;
    let red = 0;
    if (this.raging && rageTime > 0) {
      // Weich zwischen schwach und stark, nicht ganz aus: Er glüht die ganze Rage hindurch.
      const wave = 0.5 + 0.5 * Math.sin((rageTime / SPEC.rage.pulse) * Math.PI * 2);
      red = RAGE_GLOW * (0.35 + 0.65 * wave);
    }
    const materials = this.model ? this.model.materials : [this.placeholder.material as THREE.MeshStandardMaterial];
    for (const material of materials) material.emissive.setRGB(hit + red, hit + red * 0.12, hit + red * 0.06);
  }
}
