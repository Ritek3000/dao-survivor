import * as THREE from 'three';
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { MoveVector } from '../core/input';
import type { ClassDef, SwingDef } from './classes';
import { swallowedByFinsternis } from './darkness';
import { clipNamed, type HeroModel, type LayeredClip } from './models';
import type { Stats } from './progression';
import type { World } from './world';
import type { Zone } from './zones';

const BODY_CENTER_Y = 0.86;
const FLAME_OFFSET = new THREE.Vector3(0.42, 2.3, 0.12);
/** Das Kerzenwort kriecht am Boden neben der Figur her; schweben kann kein Staub. */
const KERZENWORT_OFFSET = new THREE.Vector3(0.75, 0.22, 0.35);
/** Die Lichtquelle sitzt höher als die sichtbare Flamme, sonst überstrahlt sie den Kopf. */
const TORCH_LIGHT_OFFSET = new THREE.Vector3(0.2, 3, 0.1);
/** Tief und auf der Kameraseite: trifft die zugewandten Seiten der Figuren, den Boden nur streifend. */
const FILL_LIGHT_OFFSET = new THREE.Vector3(0, 1.5, 14);
const HURT_TINT = new THREE.Color(0xff2a1a);
/** Die Fackel steckt hinter der Schulter am Rücken: so weit ragt die Flamme über den Kopf. */
const FLAME_ABOVE_HEAD = 0.42;
const SHAFT_LENGTH = 1.1;
/** Meter zwischen zwei Schritten, die zu hören sind. */
const STEP_METERS = 1.6;
/** Ein Durchlauf der Renn-Animation überbrückt etwa so viele Körperhöhen. */
const RUN_STRIDE_PER_HEIGHT = 1.7;
/** Sekunden, in denen eine Figur ohne eigene Sterbe-Animation zu Boden geht. */
const FALL_SECONDS = 0.6;
/** Sekunden, in denen eine Angriffshaltung ein- und ausgeblendet wird. */
const SWING_BLEND_IN = 0.07;
const SWING_BLEND_OUT = 0.16;
/** So lange hält die Figur die ausgeholte Haltung, wenn der Treffer auf sich warten lässt. */
const SWING_PATIENCE = 0.4;
/** Wie schnell sich die Figur ihrem Ziel zudreht (1/s). */
const AIM_SHARPNESS = 22;
/** Läuft die Figur weiter als so von ihrer Blickrichtung weg, laufen die Beine rückwärts. */
const BACKPEDAL_BELOW = -0.3;

export type DamageCause = 'treffer' | 'verstaubung';

/** Stehen oder Rennen, getrennt nach Beinen und Oberkörper. */
interface Gait {
  upper: THREE.AnimationAction;
  lower: THREE.AnimationAction;
}

/** Ein Angriff, den die Figur gerade ausführt. */
interface Swing {
  def: SwingDef;
  /** Richtung zum Ziel als Winkel um die Hochachse. */
  angle: number;
  /** 'windup' = holt aus, 'follow' = schwingt aus, 'abort' = lässt die Haltung fallen. */
  phase: 'windup' | 'follow' | 'abort';
  action: THREE.AnimationAction;
  /** Stelle im Clip und Ende des laufenden Abschnitts, in Sekunden des Clips. */
  time: number;
  end: number;
  /** Clip-Sekunden je Spielsekunde. */
  rate: number;
  /** 0 bis 1: wie weit die Angriffshaltung die Laufbewegung ersetzt. */
  weight: number;
  /** Sekunden, die die ausgeholte Haltung schon auf den Treffer wartet. */
  waited: number;
}

/** Spielfigur: das GLB-Modell ihrer Klasse mit Lichtquelle; fehlt das Modell, steht eine Kapsel da. */
export class Player {
  /** Trägt nur die Position; gedreht wird die Figur darin. */
  readonly object = new THREE.Group();
  hp: number = CONFIG.player.maxHp;
  /**
   * Verstaubter Teil der Lebensleiste. Er wächst von rechts in die Leiste hinein:
   * Das Leben kann nie über maxHp minus Verstaubung liegen, und nur Licht löst ihn wieder.
   */
  verstaubung = 0;
  /** Woran die Figur zuletzt Leben verloren hat. */
  lastDamage: DamageCause = 'treffer';
  /** Geladener Schild: fängt den nächsten Treffer vollständig ab. */
  shield = false;
  /** Faktor auf erlittene Treffer aus der Besonderheit der Klasse. */
  takenFactor = 1;
  private readonly figure = new THREE.Group();
  private readonly velocity = new THREE.Vector3();
  private readonly body: THREE.Mesh;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly shaft: THREE.Mesh;
  private readonly flame: THREE.Mesh;
  private readonly flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  private readonly torch: THREE.PointLight;
  private lightRadius: number = CONFIG.torch.radius;
  /** Reichweite des Lichtscheins der Klasse, ohne Segen. */
  private baseLight: number = CONFIG.torch.radius;
  private kerzenwort = false;
  private heading = 0;
  private stride = 0;
  /** Seit dem letzten Schritt zurückgelegte Meter; bestimmt, wann der nächste Schritt zu hören ist. */
  private stepMeters = 0;
  private invulnerable = 0;
  private hurtGlow = 0;
  private wasHit = false;
  private model: HeroModel | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private idle: Gait | null = null;
  private run: Gait | null = null;
  private deadAction: THREE.AnimationAction | null = null;
  private swing: Swing | null = null;
  private readonly swingActions = new Set<THREE.AnimationAction>();
  private dead = false;
  /** 0 bis 1: wie weit eine Figur ohne Sterbe-Animation schon gefallen ist. */
  private fallen = 0;

  constructor(private readonly stats: Stats) {
    this.bodyMaterial = swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x6f757d, roughness: 0.7 }));
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1, 6, 14), this.bodyMaterial);
    this.body.position.y = BODY_CENTER_Y;
    this.body.castShadow = true;

    // Zeigt die Blickrichtung (+Z der Figur).
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.14, 0.2),
      swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5 })),
    );
    visor.position.set(0, 0.6, 0.27);
    this.body.add(visor);

    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6),
      swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x3a2c1f, roughness: 1 })),
    );
    this.shaft.position.set(FLAME_OFFSET.x, FLAME_OFFSET.y - 0.55, FLAME_OFFSET.z);

    // Nur der helle Kern; die Flamme darum und die Staubwolke des Kerzenworts zeichnen die Effekte.
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.flameMaterial);
    this.flame.position.copy(FLAME_OFFSET);

    const { torch, fill } = CONFIG;
    this.torch = new THREE.PointLight(torch.color, torch.intensity, torch.radius, torch.decay);
    this.torch.position.copy(TORCH_LIGHT_OFFSET);
    this.torch.castShadow = torch.shadows;
    this.torch.shadow.mapSize.setScalar(torch.shadowMapSize);
    this.torch.shadow.camera.near = 0.1;
    this.torch.shadow.camera.far = torch.radius;
    this.torch.shadow.bias = -0.003;
    this.torch.shadow.normalBias = 0.03;
    this.torch.shadow.intensity = torch.shadowIntensity;

    const fillLight = new THREE.PointLight(fill.color, fill.intensity, fill.radius, torch.decay);
    fillLight.position.copy(FILL_LIGHT_OFFSET);

    this.figure.add(this.body, this.shaft, this.flame, this.torch);
    this.object.add(this.figure, fillLight);
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** Reichweite der Lichtquelle der gewählten Klasse. */
  get light(): number {
    return this.lightRadius;
  }

  /** Farbe der Lichtquelle: warm bei der Fackel, kalt beim Kerzenwort. */
  get lightColor(): THREE.Color {
    return this.torch.color;
  }

  /** Schreibt nach `target`, wo die sichtbare Lichtquelle gerade ist, und sagt, welche es ist. */
  lightSource(target: THREE.Vector3): 'fackel' | 'kerzenwort' {
    this.flame.getWorldPosition(target);
    return this.kerzenwort ? 'kerzenwort' : 'fackel';
  }

  /** Aussehen und Lichtquelle der gewählten Klasse. Ohne Modell bleibt die Kapsel stehen. */
  setClass(playerClass: ClassDef, model: HeroModel | null): void {
    this.bodyMaterial.color.set(playerClass.bodyColor);
    this.baseLight = CONFIG.torch.radius * playerClass.lightRadiusFactor;
    this.torch.color.set(playerClass.lightColor);
    this.reach(this.baseLight * this.stats.light);

    if (model !== this.model) this.setModel(model);

    const kerzenwort = playerClass.light === 'kerzenwort';
    this.kerzenwort = kerzenwort;
    this.shaft.visible = !kerzenwort;
    if (kerzenwort) {
      this.flame.position.copy(KERZENWORT_OFFSET);
    } else if (model) {
      this.flame.position.set(0.16, model.height + FLAME_ABOVE_HEAD, -0.2);
    } else {
      this.flame.position.copy(FLAME_OFFSET);
    }
    this.shaft.position.copy(this.flame.position);
    this.shaft.position.y -= SHAFT_LENGTH / 2;
    this.flameMaterial.color.set(kerzenwort ? 0xe6eeff : 0xffd9a0);
  }

  /** Stellt die Reichweite des Lichtscheins ein; ein Segen kann sie mitten in der Nacht vergrößern. */
  private reach(radius: number): void {
    this.lightRadius = radius;
    this.torch.distance = radius;
    this.torch.shadow.camera.far = radius;
    this.torch.shadow.camera.updateProjectionMatrix();
  }

  private setModel(model: HeroModel | null): void {
    if (this.model) this.figure.remove(this.model.root);
    this.mixer?.stopAllAction();
    this.model = model;
    this.mixer = null;
    this.idle = null;
    this.run = null;
    this.deadAction = null;
    this.swing = null;
    this.swingActions.clear();
    this.body.visible = !model;
    if (!model) return;

    this.figure.add(model.root);
    const mixer = new THREE.AnimationMixer(model.root);
    this.mixer = mixer;
    const gait = (clip: LayeredClip | null): Gait | null =>
      clip && { upper: mixer.clipAction(clip.upper), lower: mixer.clipAction(clip.lower) };
    this.idle = gait(model.idle);
    this.run = gait(model.run);
    if (model.dead) {
      this.deadAction = mixer.clipAction(model.dead);
      this.deadAction.setLoop(THREE.LoopOnce, 1);
      this.deadAction.clampWhenFinished = true;
    }
  }

  reset(): void {
    this.object.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.hp = this.stats.maxHp;
    this.verstaubung = 0;
    this.lastDamage = 'treffer';
    this.shield = false;
    this.takenFactor = 1;
    this.invulnerable = 0;
    this.hurtGlow = 0;
    this.wasHit = false;
    this.dead = false;
    this.fallen = 0;
    this.setGlow(0);
    if (this.model) this.model.root.rotation.x = 0;
    this.deadAction?.stop();
    this.swing = null;
    for (const action of this.swingActions) action.stop();
    this.swingActions.clear();
    for (const gait of [this.idle, this.run]) {
      gait?.upper.reset().play();
      gait?.lower.reset().play();
    }
    this.blendGait(0, 1);
    this.model?.gear?.update(0, false);
    this.mixer?.update(0);
  }

  /**
   * Die Figur holt zu einem Angriff aus; in `seconds` Sekunden fällt der Treffer.
   * Bleibt weniger Zeit als vorgesehen, steigt sie später in die Bewegung ein.
   */
  windUp(def: SwingDef, angle: number, seconds: number): void {
    // Wer schon ausholt, bringt das erst zu Ende.
    if (this.dead || this.swing?.phase === 'windup' || seconds < 0.03) return;
    const { clip, from, to } = def.windup;
    const action = this.swingAction(clip, def.body);
    if (!action) return;
    const rate = (to - from) / def.lead;
    this.begin({ def, angle, phase: 'windup', action, time: Math.max(from, to - rate * seconds), end: to, rate });
  }

  /** Der Treffer fällt: Die Figur schlägt durch, lässt die Sehne los, vollendet die Geste. */
  strike(def: SwingDef, angle: number): void {
    if (this.dead) return;
    // Holt sie gerade für einen anderen Angriff aus, bleibt sie dabei; dieser wirkt ohne Bewegung.
    if (this.swing?.phase === 'windup' && this.swing.def !== def) return;
    const { clip, from, to } = def.follow;
    const action = this.swingAction(clip, def.body);
    if (!action) return;
    this.begin({ def, angle, phase: 'follow', action, time: from, end: to, rate: (to - from) / def.recover });
  }

  private begin(next: Omit<Swing, 'weight' | 'waited'>): void {
    const previous = this.swing;
    if (previous && previous.action !== next.action) previous.action.setEffectiveWeight(0);
    // Die Haltung des vorigen Angriffs geht ohne Umweg über die Laufbewegung in die neue über.
    this.swing = { ...next, weight: previous?.weight ?? 0, waited: 0 };
  }

  /** Die Aktion zu einem Clip; ihre Stelle im Clip wird von Hand gesetzt, nicht von der Uhr. */
  private swingAction(name: string, body: SwingDef['body']): THREE.AnimationAction | null {
    const clip = this.model && clipNamed(this.model, name);
    if (!clip || !this.mixer) return null;
    const action = this.mixer.clipAction(body === 'full' ? clip.full : clip.upper);
    if (!this.swingActions.has(action)) {
      this.swingActions.add(action);
      action.timeScale = 0;
      action.setEffectiveWeight(0);
      action.play();
    }
    return action;
  }

  private updateSwing(dt: number): void {
    const swing = this.swing;
    if (!swing) return;
    swing.time = Math.min(swing.end, swing.time + swing.rate * dt);
    const secondsLeft = (swing.end - swing.time) / swing.rate;
    if (swing.phase === 'windup') {
      swing.weight = Math.min(1, swing.weight + dt / SWING_BLEND_IN);
      if (secondsLeft <= 0) {
        swing.waited += dt;
        if (swing.waited > SWING_PATIENCE) swing.phase = 'abort';
      }
    } else if (swing.phase === 'follow') {
      swing.weight = Math.min(1, swing.weight + dt / SWING_BLEND_IN, secondsLeft / SWING_BLEND_OUT);
    } else {
      swing.weight -= dt / SWING_BLEND_OUT;
    }

    if (swing.weight <= 0 && swing.phase !== 'windup') {
      swing.action.setEffectiveWeight(0);
      this.swing = null;
      return;
    }
    // Knapp vor dem Ende bleiben: Genau am Ende spränge ein Clip an seinen Anfang zurück.
    swing.action.time = Math.min(swing.time, swing.action.getClip().duration - 0.001);
    swing.action.setEffectiveWeight(swing.weight);
  }

  /** Bringt die Waffe in den Zustand, der zur Bewegung passt: Pfeil auf der Sehne, Buch aufgeschlagen. */
  private updateGear(): void {
    const swing = this.swing;
    const charged = swing?.phase === 'windup' && swing.def.nock !== undefined && swing.time >= swing.def.nock;
    this.model?.gear?.update(swing?.weight ?? 0, charged);
  }

  /** Die Figur geht zu Boden: mit ihrer Sterbe-Animation, sonst kippt sie um. */
  die(): void {
    if (this.dead) return;
    this.dead = true;
    // Die Fackel fällt mit: Ihr Stiel verschwindet, die Glut liegt neben der Figur am Boden.
    this.shaft.visible = false;
    this.flame.position.y = Math.min(this.flame.position.y, KERZENWORT_OFFSET.y);
    this.model?.gear?.update(0, false);
    if (!this.deadAction) return;
    this.swing?.action.fadeOut(0.15);
    this.swing = null;
    for (const gait of [this.idle, this.run]) {
      gait?.upper.fadeOut(0.15);
      gait?.lower.fadeOut(0.15);
    }
    this.deadAction.reset().fadeIn(0.15).play();
  }

  /** Lässt die Figur weiter atmen oder fallen, wenn die Nacht vorbei ist und sonst alles stillsteht. */
  animate(dt: number): void {
    if (!this.dead) {
      this.updateSwing(dt);
      this.blendGait(0, 1);
      this.updateGear();
      this.mixer?.update(dt);
    } else if (this.deadAction) {
      this.mixer?.update(dt);
    } else if (this.model) {
      // Ohne Sterbe-Animation erstarrt die Figur in ihrer Haltung und kippt nach hinten:
      // erst langsam, dann schnell, wie ein Körper, der das Gleichgewicht verliert.
      this.fallen = Math.min(1, this.fallen + dt / FALL_SECONDS);
      this.model.root.rotation.x = -(Math.PI / 2) * this.fallen * this.fallen;
    }
  }

  /**
   * Blendet zwischen Stehen und Rennen; `pace` ist das Tempo der Beine, negativ für Rückwärtslaufen.
   * Ein Angriff verdrängt die Laufbewegung aus dem Oberkörper, ein Sprung auch aus den Beinen.
   */
  private blendGait(moving: number, pace: number): void {
    const upper = 1 - (this.swing?.weight ?? 0);
    const lower = this.swing?.def.body === 'full' ? upper : 1;
    this.idle?.upper.setEffectiveWeight((1 - moving) * upper);
    this.idle?.lower.setEffectiveWeight((1 - moving) * lower);
    if (!this.run) return;
    this.run.upper.setEffectiveWeight(moving * upper);
    this.run.lower.setEffectiveWeight(moving * lower);
    this.run.upper.timeScale = pace;
    this.run.lower.timeScale = pace;
  }

  private setGlow(amount: number): void {
    this.bodyMaterial.emissive.copy(HURT_TINT).multiplyScalar(amount);
    if (!this.model) return;
    for (const material of this.model.materials) material.emissive.copy(this.bodyMaterial.emissive);
  }

  update(dt: number, time: number, move: MoveVector, world: World): void {
    const { acceleration, turnSharpness, radius } = CONFIG.player;
    const speed = CONFIG.player.speed * this.stats.speed;
    const light = this.baseLight * this.stats.light;
    if (light !== this.lightRadius) this.reach(light);

    // Bildschirm-oben entspricht -Z in der Welt.
    const blend = 1 - Math.exp(-acceleration * dt);
    this.velocity.x += (move.x * speed - this.velocity.x) * blend;
    this.velocity.z += (-move.y * speed - this.velocity.z) * blend;

    const position = this.object.position;
    position.x += this.velocity.x * dt;
    position.z += this.velocity.z * dt;
    world.resolve(position, radius);

    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const course = Math.atan2(this.velocity.x, this.velocity.z);
    this.stepMeters += currentSpeed * dt;
    if (this.stepMeters >= STEP_METERS) {
      this.stepMeters -= STEP_METERS;
      audio.play('schritt', position.x, position.z);
    }
    this.updateSwing(dt);
    // Beim Angriff blickt die Figur zum Ziel, sonst dorthin, wohin sie läuft.
    const swing = this.swing;
    const aiming = swing !== null && swing.phase !== 'abort';
    if (aiming || currentSpeed > 0.2) {
      const target = aiming ? swing.angle + (swing.def.turn ?? 0) : course;
      const delta = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
      this.heading += delta * (1 - Math.exp(-(aiming ? AIM_SHARPNESS : turnSharpness) * dt));
      this.figure.rotation.y = this.heading;
    }

    if (this.model && this.mixer) {
      // Die Beine laufen so schnell, wie die Figur vorankommt; kleine Figuren machen mehr Schritte.
      const cycle = this.model.run?.full.duration ?? 1;
      const naturalSpeed = (RUN_STRIDE_PER_HEIGHT * this.model.height) / cycle;
      const pace = Math.min(1.6, Math.max(0.5, currentSpeed / naturalSpeed));
      // Wer sich beim Zurückweichen dem Gegner zudreht, läuft rückwärts.
      const backwards = currentSpeed > 0.2 && Math.cos(course - this.heading) < BACKPEDAL_BELOW;
      this.blendGait(Math.min(1, currentSpeed / (speed * 0.5)), backwards ? -pace : pace);
      this.updateGear();
      this.mixer.update(dt);
    } else {
      // Die Kapsel wippt leicht, als Ersatz für eine Laufanimation.
      this.stride += currentSpeed * dt * 2.2;
      this.body.position.y =
        BODY_CENTER_Y + Math.abs(Math.sin(this.stride)) * 0.05 * Math.min(1, currentSpeed / speed);
    }

    const flicker =
      1 + 0.06 * Math.sin(time * 11.3) + 0.04 * Math.sin(time * 23.7 + 1.3) + 0.03 * Math.sin(time * 5.1);
    this.torch.intensity = CONFIG.torch.intensity * flicker;
    this.flame.scale.setScalar(0.9 + 0.25 * (flicker - 0.87));

    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.hurtGlow = Math.max(0, this.hurtGlow - dt * 5);
    this.setGlow(this.hurtGlow);
  }

  /** Finsternis verstaubt die Lebensleiste, Licht löst den Staub und lässt rasten. */
  applyZone(dt: number, zone: Zone, finsternis: number): void {
    const { gainPerSecond, clearPerSecond } = CONFIG.verstaubung;
    const maxHp = this.stats.maxHp;
    if (zone === 'finsternis') {
      this.verstaubung = Math.min(maxHp, this.verstaubung + gainPerSecond * finsternis * this.stats.verstaubung * dt);
    } else if (zone === 'licht') {
      this.verstaubung = Math.max(0, this.verstaubung - clearPerSecond * dt);
      // Heilung gibt es nur bei der Rast im Licht, nie im Kampf.
      this.hp += CONFIG.islands.regenPerSecond * dt;
    } else if (this.stats.dustClear > 0) {
      // Sors Läuterung: Der Staub löst sich auch in der gewöhnlichen Nacht. Leben gibt sie nicht zurück.
      this.verstaubung = Math.max(0, this.verstaubung - this.stats.dustClear * dt);
    }
    const cap = maxHp - this.verstaubung;
    if (this.hp > cap) {
      if (zone === 'finsternis') this.lastDamage = 'verstaubung';
      this.hp = cap;
    }
  }

  /**
   * Treffer eines Gegners; während der Schonfrist wirkungslos. Mit `verstaubt` stammt er aus
   * einem Dhargass-Zauber: Was er an Leben nimmt, verstaubt zugleich und kehrt erst im Licht zurück.
   * `announced`: ein Angriff, der sich angekündigt hat und dem man ausweichen konnte.
   */
  hurt(amount: number, verstaubt = false, announced = false): void {
    // Die Schonfrist schützt vor dem Gedränge der Horde. Was sich am Boden angekündigt hat,
    // trifft trotzdem: Sonst machte ein Kratzer gegen den Schwarzen Sog unverwundbar.
    if ((this.invulnerable > 0 && !announced) || !this.alive) return;
    this.invulnerable = CONFIG.player.invulnerableSeconds * this.stats.grace;
    if (this.shield) {
      this.shield = false;
      audio.play('schild.faengt', this.position.x, this.position.z);
      return;
    }
    const taken = Math.max(1, amount * this.takenFactor - this.stats.armor);
    this.hp -= taken;
    if (verstaubt) {
      this.verstaubung = Math.min(this.stats.maxHp, this.verstaubung + taken * this.stats.verstaubung);
      this.lastDamage = 'verstaubung';
    } else {
      this.lastDamage = 'treffer';
    }
    this.hurtGlow = 1;
    this.wasHit = true;
    audio.play(verstaubt ? 'spieler-verstaubt' : 'spieler-treffer', this.position.x, this.position.z);
  }

  /** Mehr Höchstleben durch eine Verbesserung bringt die Punkte gleich mit. */
  grantHp(amount: number): void {
    this.hp = Math.min(this.hp + amount, this.stats.maxHp - this.verstaubung);
  }

  /** Wahr genau einmal je Treffer, für die Rückmeldung in der Anzeige. */
  consumeHit(): boolean {
    const hit = this.wasHit;
    this.wasHit = false;
    return hit;
  }
}
