/**
 * Der Verschlinger: der eine große Gegner der Nacht.
 *
 * Für die Angriffe der Spielfigur ist er ein Gegner wie jeder andere (ein Eintrag in der Horde),
 * aber er bewegt sich nach eigenen Regeln und hat ein eigenes Skelett mit Animationen:
 *   Hieb             aus der Nähe, mit der linken Faust
 *   Ansturm          er kündigt eine Bahn an und rennt sie entlang
 *   Schwarzer Sog    rund um ihn; verstaubt und löscht jede Feuerschale in der Fläche
 *   Das Verschlingen ist er angeschlagen, hüllt er sich zeitweise in Finsternis, die ihm folgt
 * Die beiden Zauber stammen aus der Vorlage (Domäne Finsternis). Alles kündigt sich am Boden an.
 */
import * as THREE from 'three';
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { Random } from '../core/random';
import { extendShader, swallowedByFinsternis } from './darkness';
import type { Enemies, Enemy } from './enemies';
import type { BossModel } from './models';
import type { Player } from './player';
import type { Threats } from './threats';
import type { World } from './world';

/**
 * 'walk' = geht auf die Spielfigur zu, 'hookWind'/'hookSwing' = holt aus und schlägt durch,
 * 'chargeWind'/'charge' = kündigt den Ansturm an und rennt, 'rest' = verschnauft danach,
 * 'sog' = wirkt den Schwarzen Sog, 'dying' = fällt und zerfällt.
 */
type Mode = 'walk' | 'hookWind' | 'hookSwing' | 'chargeWind' | 'charge' | 'rest' | 'sog' | 'dying';
type ClipName = keyof typeof CONFIG.boss.clips;
export type BossEvent = 'erschienen' | 'verschlingen';

const BOSS = CONFIG.boss;
const TYPE = BOSS.type;
/** So schnell dreht er sich (Radiant je Sekunde): Wer um ihn herumläuft, hängt ihn ab. */
const TURN_RATE = 2.6;
/** Sekunden zwischen zwei besonderen Angriffen, damit sie nicht ineinanderlaufen. */
const BREATH = 0.9;
/** Sekunden, in denen er nach dem Sturz zu Staub zerfällt. */
const DISSOLVE_SECONDS = 1.8;
const CROSSFADE = 0.18;

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class Boss {
  /** Trägt Position und Blickrichtung; darin steht das Modell oder der Platzhalter. */
  readonly group = new THREE.Group();
  /** Sein Eintrag in der Horde, solange er lebt. */
  enemy: Enemy | null = null;
  /** Ist er in dieser Nacht schon erschienen, und wurde er erschlagen? */
  appeared = false;
  slain = false;
  private readonly placeholder: THREE.Mesh;
  private readonly dissolve = { value: 0 };
  private model: BossModel | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private playing: ClipName | null = null;
  private mode: Mode = 'walk';
  /** Restsekunden des laufenden Abschnitts. */
  private timer = 0;
  private heading = 0;
  private hookIn = 0;
  private chargeIn = 0;
  private sogIn = 0;
  private breath = 0;
  private engulfIn = 0;
  private engulfLeft = 0;
  /** Meter, die der Ansturm noch läuft, und ob er die Spielfigur schon erwischt hat. */
  private chargeLeft = 0;
  private chargeHit = false;
  private event: BossEvent | null = null;

  constructor() {
    const height = TYPE.model.height;
    const geometry = new THREE.CapsuleGeometry(height * 0.24, height * 0.5, 6, 14);
    geometry.translate(0, height * 0.49, 0);
    this.placeholder = new THREE.Mesh(
      geometry,
      swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: TYPE.color, roughness: 0.85 }), true),
    );
    this.placeholder.castShadow = true;
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
    for (const name of Object.keys(BOSS.clips) as ClipName[]) {
      const wanted = BOSS.clips[name].toLowerCase();
      const clip = model.clips.find((candidate) => candidate.name.toLowerCase().includes(wanted));
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
  }

  /** Neue Nacht: Er ist noch nicht da. */
  reset(): void {
    this.enemy = null;
    this.appeared = false;
    this.slain = false;
    this.event = null;
    this.group.visible = false;
    this.dissolve.value = 0;
    this.mode = 'walk';
    this.mixer?.stopAllAction();
    this.playing = null;
    this.setGlow(0);
  }

  /** Anteil seines Lebens von 0 bis 1; 0, wenn er nicht da ist. */
  get hpFraction(): number {
    return this.enemy ? Math.max(0, this.enemy.hp / TYPE.hp) : 0;
  }

  /** Was seit dem letzten Aufruf geschehen ist; jedes Ereignis wird einmal gemeldet. */
  consumeEvent(): BossEvent | null {
    const event = this.event;
    this.event = null;
    return event;
  }

  update(
    dt: number,
    time: number,
    player: Player,
    enemies: Enemies,
    threats: Threats,
    world: World,
    random: Random,
  ): void {
    if (!this.appeared && time >= BOSS.from) this.appear(player, enemies, random);
    if (this.mode === 'dying') this.updateDying(dt);
    const enemy = this.enemy;
    if (enemy) {
      // Ihn hält nichts fest; verlangsamen lässt er sich.
      enemy.hold = 0;
      this.hookIn -= dt;
      this.chargeIn -= dt;
      this.sogIn -= dt;
      this.breath -= dt;
      this.updateEngulf(dt, enemy);
      this.act(dt, enemy, player, threats, world);
      this.group.position.set(enemy.x, 0, enemy.z);
      this.group.rotation.y = this.heading;
      enemy.heading = this.heading;
      this.setGlow(enemy.flash);
    }
    this.mixer?.update(dt);
  }

  /** Die Spielfigur hat ihn erschlagen: Er stürzt und zerfällt zu Staub. */
  fall(): void {
    audio.play('boss.faellt', this.group.position.x, this.group.position.z);
    this.enemy = null;
    this.slain = true;
    this.mode = 'dying';
    this.timer = (this.actions.get('dead')?.getClip().duration ?? 0.6) + DISSOLVE_SECONDS;
    this.play('dead', 0.12, false);
    this.setGlow(0);
  }

  /** Nach dem Ende der Nacht: Er rührt sich nicht mehr vom Fleck, bleibt aber lebendig. */
  animate(dt: number): void {
    if (this.mode === 'dying') this.updateDying(dt);
    else if (this.enemy) this.play('idle');
    this.mixer?.update(dt);
  }

  private appear(player: Player, enemies: Enemies, random: Random): void {
    this.appeared = true;
    // Er kommt vom Rand des Sichtfelds, möglichst von innerhalb der Steinmale.
    const distance = CONFIG.enemies.spawnRing.max;
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = random() * Math.PI * 2;
      x = player.position.x + Math.cos(angle) * distance;
      z = player.position.z + Math.sin(angle) * distance;
      if (Math.hypot(x, z) < CONFIG.world.radius - 3) break;
    }
    this.enemy = enemies.summon(TYPE, x, z);
    this.heading = Math.atan2(player.position.x - x, player.position.z - z);
    this.mode = 'walk';
    this.timer = 0;
    this.hookIn = 0;
    this.chargeIn = 2;
    this.sogIn = 4;
    this.breath = 0;
    this.engulfIn = 0;
    this.engulfLeft = 0;
    this.dissolve.value = 0;
    this.group.visible = true;
    this.event = 'erschienen';
    audio.play('boss.erscheint', x, z);
  }

  /** Das Verschlingen: Unter der Schwelle hüllt er sich immer wieder für einige Sekunden in Finsternis. */
  private updateEngulf(dt: number, enemy: Enemy): void {
    const { belowHp, radius, seconds, cooldown } = BOSS.verschlingen;
    if (this.engulfLeft > 0) {
      this.engulfLeft -= dt;
      if (this.engulfLeft <= 0) {
        enemy.mantle = 0;
        this.engulfIn = cooldown;
      }
      return;
    }
    if (enemy.hp > TYPE.hp * belowHp) return;
    this.engulfIn -= dt;
    if (this.engulfIn > 0) return;
    this.engulfLeft = seconds;
    enemy.mantle = radius;
    this.event = 'verschlingen';
    audio.play('boss.verschlingen', enemy.x, enemy.z);
  }

  private act(dt: number, enemy: Enemy, player: Player, threats: Threats, world: World): void {
    const dx = player.position.x - enemy.x;
    const dz = player.position.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    this.timer -= dt;

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
        this.turn(toPlayer, TURN_RATE * dt);
        const { hook, charge, sog } = BOSS;
        if (this.hookIn <= 0 && distance < hook.reach * 0.85) {
          this.mode = 'hookWind';
          this.timer = hook.windup;
          this.play('hook', 0.1, false, BOSS.hookStrikeAt / hook.windup);
          audio.play('boss.hieb-ausholen', enemy.x, enemy.z);
          threats.arc(enemy.x, enemy.z, this.heading, hook.arc, hook.reach, hook.windup);
          break;
        }
        if (this.breath <= 0 && this.sogIn <= 0 && distance < sog.trigger) {
          this.mode = 'sog';
          this.timer = sog.windup + 0.3;
          this.play('idle');
          threats.sog(enemy.x, enemy.z, sog.radius, sog.windup, sog.damage, enemy, true);
          break;
        }
        if (this.breath <= 0 && this.chargeIn <= 0 && distance > charge.minDistance && distance < charge.maxDistance) {
          this.mode = 'chargeWind';
          this.timer = charge.windup;
          this.heading = toPlayer;
          this.chargeLeft = Math.min(charge.maxDistance, distance + 6);
          this.chargeHit = false;
          this.play('idle');
          threats.lane(enemy.x, enemy.z, this.heading, this.chargeLeft, charge.width, charge.windup);
          audio.play('boss.ansturm', enemy.x, enemy.z);
          break;
        }
        // Er geht dorthin, wohin er blickt; steht die Spielfigur seitlich, dreht er sich erst.
        const facing = Math.cos(wrap(toPlayer - this.heading));
        const touching = TYPE.radius + CONFIG.player.radius + 0.3;
        const speed = TYPE.speed * (enemy.slow > 0 ? 0.7 : 1) * Math.max(0, facing);
        if (distance > touching && speed > 0.3) {
          enemy.x += Math.sin(this.heading) * speed * dt;
          enemy.z += Math.cos(this.heading) * speed * dt;
          world.resolve(enemy, TYPE.radius * 0.7);
          this.play('walk', CROSSFADE, true, (speed * this.clipSeconds('walk')) / TYPE.model.stride);
        } else {
          this.play('idle');
        }
        break;
      }

      case 'hookWind':
        if (this.timer > 0) break;
        this.strike(enemy, player, distance, toPlayer, threats);
        this.mode = 'hookSwing';
        this.timer = Math.max(0.2, this.clipSeconds('hook') - BOSS.hookStrikeAt);
        this.setTimeScale('hook', 1);
        break;

      case 'hookSwing':
        if (this.timer > 0) break;
        this.hookIn = BOSS.hook.cooldown;
        this.mode = 'walk';
        break;

      case 'chargeWind':
        if (this.timer > 0) break;
        this.mode = 'charge';
        this.play('run', 0.1, true, 1.4);
        break;

      case 'charge': {
        const { speed, damage, rest, cooldown } = BOSS.charge;
        const step = Math.min(this.chargeLeft, speed * dt);
        enemy.x += Math.sin(this.heading) * step;
        enemy.z += Math.cos(this.heading) * step;
        this.chargeLeft -= step;
        if (!this.chargeHit && distance < TYPE.radius + CONFIG.player.radius + 0.4) {
          this.chargeHit = true;
          player.hurt(damage, false, true);
        }
        if (this.chargeLeft > 0 && Math.hypot(enemy.x, enemy.z) < CONFIG.world.radius - 2) break;
        threats.thud(enemy.x, enemy.z, 2.6);
        audio.play('boss.aufprall', enemy.x, enemy.z);
        this.mode = 'rest';
        this.timer = rest;
        this.chargeIn = cooldown;
        this.breath = BREATH;
        this.play('idle', 0.25);
        break;
      }

      case 'rest':
        if (this.timer <= 0) this.mode = 'walk';
        break;

      case 'sog':
        if (this.timer > 0) break;
        this.sogIn = BOSS.sog.cooldown;
        this.breath = BREATH;
        this.mode = 'walk';
        break;

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

  /** Die Faust ist vorn: Wer jetzt in der angekündigten Fläche steht, wird getroffen. */
  private strike(enemy: Enemy, player: Player, distance: number, toPlayer: number, threats: Threats): void {
    const { reach, arc, damage } = BOSS.hook;
    const off = Math.abs(wrap(toPlayer - this.heading));
    if (distance <= reach + CONFIG.player.radius * 0.5 && off <= arc / 2) player.hurt(damage, false, true);
    audio.play('boss.hieb', enemy.x, enemy.z);
    threats.thud(enemy.x + Math.sin(this.heading) * reach * 0.6, enemy.z + Math.cos(this.heading) * reach * 0.6, 1.8);
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

  /** Ein Treffer lässt ihn kurz aufleuchten, wie die Horde. */
  private setGlow(amount: number): void {
    const glow = amount * 0.3;
    if (this.model) for (const material of this.model.materials) material.emissive.setScalar(glow);
    else (this.placeholder.material as THREE.MeshStandardMaterial).emissive.setScalar(glow);
  }
}
