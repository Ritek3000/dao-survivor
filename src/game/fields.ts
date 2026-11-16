/**
 * Bodenfelder mit Dauer. Banner, Sporenwolke, Köderpuppe, Netz, Glut- und Aschelinie, Erdring, Dornen-Aura und Staubfeld sind alle
 * dasselbe: ein Ort, eine Form, eine Dauer und eine Wirkung je Takt. Dieser Teil kennt keine dieser Fertigkeiten, nur die Bausteine;
 * jede Fertigkeit beschreibt ihr Feld als `FieldDef` und stellt es mit `Fields.spawn` auf.
 *
 * Die Felder liegen in einem festen Vorrat (`CONFIG.skills.maxFields`); ist er voll, ersetzt ein neues das älteste. Im Kampf entsteht
 * nichts Neues, auch nicht für die Zeichen: Wer ein Feld zeigen will, besucht die laufenden mit `eachActive`.
 *
 * Was ein Feld bewirkt:
 * - Jeden Takt (`every`): Schaden und Zustände bei jedem Gegner darin; Leben und zeitweilige Werte für die Figur, solange sie darin steht.
 * - In jedem Bild: Zug zur Mitte (`pull`).
 * - Nach jedem Takt (`onTick`), wenn ein Gegner darin stirbt (`onKill`) und wenn das Feld endet (`onEnd`): was die Fertigkeit daraus macht,
 *   steht in ihrer Funktion.
 */

import { CONFIG } from '../config';
import type { BuffSpec } from './buffs';
import type { Enemies, Enemy } from './enemies';
import { sourceOf, type CombatListener, type Source } from './events';
import type { Player } from './player';
import type { Progression } from './progression';
import { applyStatus, type StatusApply } from './status';

export type FieldShape =
  /** Ein Kreis um die Mitte des Felds. */
  | 'circle'
  /** Ein Streifen: Er beginnt in der Mitte des Felds und läuft in Richtung `angle` über `length` Meter, `width` Meter breit. */
  | 'line'
  /** Ein Ring um die Mitte des Felds: bei `radius` Meter, `width` Meter dick (der Erdring des Erdstoßes). */
  | 'ring';

export interface FieldDef {
  id: string;
  shape: FieldShape;
  /** Sekunden, die das Feld liegt; `Infinity` bis es ersetzt wird oder die Nacht endet. */
  duration: number;
  /** Sekunden zwischen zwei Wirkungen; mindestens 0,05. */
  every: number;
  /** Wirkt es beim Aufstellen sofort einmal, statt erst nach `every` Sekunden? */
  instant?: boolean;
  /** Schaden an jedem Gegner im Feld je Takt, vor dem Faktor `scale` des Felds. */
  damage?: number;
  /** Zustände, die jeder Gegner im Feld je Takt bekommt. Sie laufen nach, wenn er das Feld verlässt; kurze Dauer lässt sie schnell verfallen. */
  statuses?: readonly StatusApply[];
  /** Zug zur Mitte in Metern je Sekunde, in jedem Bild (bei einem Streifen: zur Linie). */
  pull?: number;
  /** Leben für die Figur im Feld je Takt, vor dem Faktor `scale`. */
  heal?: number;
  /** Zeitweilige Werte für die Figur im Feld; sie werden jeden Takt erneuert, ihre Dauer sollte also etwas über `every` liegen. */
  buffs?: readonly BuffSpec[];
  /** Nach jedem Takt, wenn die Fertigkeit noch etwas dazu tut (das Banner zieht auf Rang 5 Edelsteine heran). */
  onTick?(field: Field, fields: Fields): void;
  /** Ein Gegner ist im Feld gestorben; `field.kills` hat ihn schon mitgezählt. */
  onKill?(field: Field, enemy: Enemy, fields: Fields): void;
  /** Die Dauer ist um; das Feld verschwindet danach. */
  onEnd?(field: Field, fields: Fields): void;
}

/** Ein Feld im Vorrat; die Werte gehören dem Vorrat, wer ein Feld hält, liest nur. */
export interface Field {
  active: boolean;
  def: FieldDef;
  x: number;
  z: number;
  /** Radius eines Kreises. */
  radius: number;
  /** Richtung (wie beim Angriff: `atan2(dx, dz)`), Länge und Breite eines Streifens. */
  angle: number;
  length: number;
  width: number;
  /** Sekunden seit dem Aufstellen und bis zum Ende. */
  age: number;
  life: number;
  /** Sekunden bis zur nächsten Wirkung. */
  tickIn: number;
  /** Wie viele Gegner seit dem Aufstellen im Feld gestorben sind. */
  kills: number;
  /** Liegt das Feld an der Figur und wandert mit ihr? */
  follow: boolean;
  /** Faktor auf Schaden und Heilung; die Ränge einer Fertigkeit stellen das ein. */
  scale: number;
  /** Wer es aufgestellt hat. */
  source: Source;
}

/** Was beim Aufstellen von der Beschreibung abweichen darf. */
export interface FieldOptions {
  radius?: number;
  angle?: number;
  length?: number;
  width?: number;
  /** Ersetzt `duration` der Beschreibung. */
  duration?: number;
  scale?: number;
  follow?: boolean;
  /** Ersetzt den Urheber (sonst gilt die Kennung der Beschreibung). */
  source?: Source;
}

const MIN_EVERY = 0.05;
const DEFAULT_RADIUS = 2;
/** Gegner knapp außerhalb des Felds zählen schon dazu: Ihr Körper hat eine Breite. */
const REACH_MARGIN = 0.1;

function blank(): Field {
  return {
    active: false,
    def: { id: '', shape: 'circle', duration: 0, every: 1 },
    x: 0,
    z: 0,
    radius: DEFAULT_RADIUS,
    angle: 0,
    length: 0,
    width: 0,
    age: 0,
    life: 0,
    tickIn: 0,
    kills: 0,
    follow: false,
    scale: 1,
    source: sourceOf(''),
  };
}

/** Der Vorrat an Bodenfeldern. Hört auf `CombatEvents`, um die Tode darin zu zählen. */
export class Fields implements CombatListener {
  private readonly pool: Field[] = [];
  /** Das Feld, dessen Wirkung gerade die Gegner besucht; die Besucher bekommen nur den Gegner und lesen es von hier. */
  private current: Field = blank();
  /** Die Zeit des Bilds für `pullEnemy`. */
  private pullDt = 0;

  constructor(
    readonly enemies: Enemies,
    readonly player: Player,
    private readonly progression: Progression,
  ) {
    for (let i = 0; i < CONFIG.skills.maxFields; i++) this.pool.push(blank());
  }

  /** Neue Nacht: alle Felder sind weg, ohne dass ihr Ende wirkt. */
  reset(): void {
    for (const field of this.pool) field.active = false;
  }

  /** Wie viele Felder gerade liegen. */
  get count(): number {
    let count = 0;
    for (const field of this.pool) if (field.active) count++;
    return count;
  }

  /** Besucht die laufenden Felder, etwa um sie zu zeichnen. */
  eachActive(visit: (field: Field) => void): void {
    for (const field of this.pool) if (field.active) visit(field);
  }

  /** Stellt ein Feld auf. Ist der Vorrat voll, ersetzt es das älteste. */
  spawn(def: FieldDef, x: number, z: number, options: FieldOptions = {}): Field {
    let slot: Field | null = null;
    for (const field of this.pool) {
      if (!field.active) {
        slot = field;
        break;
      }
      if (!slot || field.age > slot.age) slot = field;
    }
    const field = slot ?? blank();
    field.active = true;
    field.def = def;
    field.x = x;
    field.z = z;
    field.radius = options.radius ?? DEFAULT_RADIUS;
    field.angle = options.angle ?? 0;
    field.length = options.length ?? 0;
    field.width = options.width ?? 0;
    field.age = 0;
    field.life = options.duration ?? def.duration;
    field.tickIn = def.instant ? 0 : Math.max(def.every, MIN_EVERY);
    field.kills = 0;
    field.follow = options.follow ?? false;
    field.scale = options.scale ?? 1;
    field.source = options.source ?? sourceOf(def.id);
    return field;
  }

  /** Nimmt ein Feld weg, ohne dass sein Ende wirkt. */
  remove(field: Field): void {
    field.active = false;
  }

  update(dt: number): void {
    for (const field of this.pool) {
      if (!field.active) continue;
      const { def } = field;
      if (field.follow) {
        field.x = this.player.position.x;
        field.z = this.player.position.z;
      }
      field.age += dt;
      field.life -= dt;
      if (def.pull) this.pull(field, dt);
      field.tickIn -= dt;
      if (field.tickIn <= 0) {
        this.tick(field);
        // Ein Takt je Bild genügt: Wer ein Bild lang hängt, holt versäumte Takte nicht in einem Schlag nach.
        field.tickIn = Math.max(0, field.tickIn) + Math.max(def.every, MIN_EVERY);
      }
      if (field.life <= 0) {
        field.active = false;
        def.onEnd?.(field, this);
      }
    }
  }

  /** Ein Gegner ist gestorben: Wer in einem Feld mit `onKill` stirbt, wird dem Feld gemeldet. */
  kill(enemy: Enemy): void {
    for (const field of this.pool) {
      if (!field.active || !this.contains(field, enemy.x, enemy.z, enemy.type.radius)) continue;
      field.kills++;
      field.def.onKill?.(field, enemy, this);
    }
  }

  /** Liegt der Punkt (x, z) im Feld? `margin` ist die Breite des Körpers, der dort steht. */
  contains(field: Field, x: number, z: number, margin = 0): boolean {
    const dx = x - field.x;
    const dz = z - field.z;
    if (field.def.shape === 'circle') return Math.hypot(dx, dz) <= field.radius + margin;
    if (field.def.shape === 'ring') return Math.abs(Math.hypot(dx, dz) - field.radius) <= field.width / 2 + margin;
    const directionX = Math.sin(field.angle);
    const directionZ = Math.cos(field.angle);
    const along = dx * directionX + dz * directionZ;
    if (along < -margin || along > field.length + margin) return false;
    return Math.abs(dx * directionZ - dz * directionX) <= field.width / 2 + margin;
  }

  /** Die Mitte, um die Gegner gesucht werden, und wie weit: bei einem Kreis er selbst, bei einem Streifen sein Mittelpunkt. */
  private search(field: Field, visit: (enemy: Enemy) => void): void {
    if (field.def.shape === 'circle') {
      this.enemies.queryRadius(field.x, field.z, field.radius, visit);
      return;
    }
    if (field.def.shape === 'ring') {
      this.enemies.queryRadius(field.x, field.z, field.radius + field.width / 2, visit);
      return;
    }
    const half = field.length / 2;
    this.enemies.queryRadius(
      field.x + Math.sin(field.angle) * half,
      field.z + Math.cos(field.angle) * half,
      Math.hypot(half, field.width / 2),
      visit,
    );
  }

  /** Die Wirkung eines Takts: Gegner im Feld bekommen Schaden und Zustände, die Figur Leben und zeitweilige Werte. */
  private tick(field: Field): void {
    const { def } = field;
    if (def.damage || def.statuses) {
      this.current = field;
      this.search(field, this.hitEnemy);
    }
    const { player } = this;
    if ((def.heal || def.buffs) && player.alive && this.contains(field, player.position.x, player.position.z)) {
      if (def.heal) player.grantHp(def.heal * field.scale);
      if (def.buffs) for (const buff of def.buffs) this.progression.addBuff(buff);
    }
    def.onTick?.(field, this);
  }

  private readonly hitEnemy = (enemy: Enemy): void => {
    const field = this.current;
    if (enemy.hp <= 0 || !this.contains(field, enemy.x, enemy.z, enemy.type.radius + REACH_MARGIN)) return;
    const { def } = field;
    // Takte sind Schaden über Zeit: ohne Aufleuchten und Rückstoß.
    if (def.damage) this.enemies.damage(enemy, def.damage * field.scale, 0, 0, field.source, true);
    if (def.statuses) for (const apply of def.statuses) applyStatus(enemy.status, apply.kind, apply.seconds, apply.power, field.source);
  };

  private readonly pullEnemy = (enemy: Enemy): void => {
    const field = this.current;
    if (enemy.hp <= 0 || enemy.driven || !this.contains(field, enemy.x, enemy.z, enemy.type.radius)) return;
    // Zur Mitte eines Kreises, bei einem Streifen zu seiner Linie, bei einem Ring zu seinem Rand.
    let toX = field.x - enemy.x;
    let toZ = field.z - enemy.z;
    if (field.def.shape === 'ring') {
      const out = Math.hypot(-toX, -toZ);
      if (out < 1e-3) return;
      toX += (-toX / out) * field.radius;
      toZ += (-toZ / out) * field.radius;
    } else if (field.def.shape === 'line') {
      const directionX = Math.sin(field.angle);
      const directionZ = Math.cos(field.angle);
      const along = Math.min(Math.max((enemy.x - field.x) * directionX + (enemy.z - field.z) * directionZ, 0), field.length);
      toX = field.x + directionX * along - enemy.x;
      toZ = field.z + directionZ * along - enemy.z;
    }
    const distance = Math.hypot(toX, toZ);
    if (distance < 1e-3) return;
    const step = Math.min(distance, (field.def.pull ?? 0) * this.pullDt) / distance;
    enemy.x += toX * step;
    enemy.z += toZ * step;
  };

  private pull(field: Field, dt: number): void {
    this.current = field;
    this.pullDt = dt;
    this.search(field, this.pullEnemy);
  }
}
