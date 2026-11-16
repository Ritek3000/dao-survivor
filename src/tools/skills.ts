/**
 * Werkzeug für die Browser-Konsole (nur im Entwicklungsmodus): der Unterbau der Fertigkeiten zum Ausprobieren. Er hat noch keine
 * sichtbare Wirkung im Spiel; die Fertigkeiten der Klassen füllen ihn erst. Gehört nicht ins fertige Spiel und wird deshalb nur im
 * Entwicklungsmodus nachgeladen (siehe `main.ts`). Alles gilt nur mitten in einer Nacht.
 *
 *   __skills.zustand('bleed', 4, 6)          bringt allen Gegnern im Umkreis von 14 m einen Zustand an: Art, Sekunden, Stärke (optional)
 *                                            Arten: hold, slow, weak, bleed, burn, mark, fear, blind, feeble, silence (Stärke siehe status.ts)
 *   __skills.feld({ shape: 'circle', radius: 4, every: 0.5, damage: 5, duration: 8, pull: 2, follow: true })
 *                                            stellt ein Bodenfeld an der Figur auf (Felder siehe fields.ts; ohne Angaben ein Kreis mit Schaden)
 *   __skills.wert('speed', 'mul', 1.5, 6)    setzt einen zeitweiligen Wert: Wert, 'add' oder 'mul', Betrag, Sekunden, Stapel (optional)
 *   __skills.hoeren()                        zählt von jetzt an Treffer, Tode und Verletzungen der Figur mit Urheber; `__skills.ereignisse()` liest den Stand
 *   __skills.raenge('wirbelschlag')          die aufgelösten Ränge eines Angriffs (siehe weapons.ts, `resolveRank`; mit Evolution ein Rang mehr)
 *   __skills.entwickeln('axthieb')           schaltet die Evolution frei, als trüge die Figur den Ring, und hebt den Angriff auf Rang 6
 *   __skills.stand()                         was gerade wirkt: Zustände der Gegner, Felder, zeitweilige Werte
 *
 * Sichtbar ist davon nur, was ohnehin sichtbar ist: Ein Gegner im Zustand `hold` steht fahl da. Alles Übrige zeigt `stand()`.
 */

import type { BuffStat } from '../game/buffs';
import type { Enemies, Enemy } from '../game/enemies';
import type { CombatEvents, CombatListener, Source } from '../game/events';
import type { Fields, FieldDef, FieldOptions } from '../game/fields';
import type { Game } from '../game/game';
import type { Progression } from '../game/progression';
import { applyStatus, STATUS_KINDS, type StatusKind } from '../game/status';
import type { Arsenal } from '../game/arsenal';
import { EVOLUTION_RANK, MAX_RANK, resolveRank, weaponById } from '../game/weapons';

interface Internals {
  phase: string;
  events: CombatEvents;
  enemies: Enemies;
  fields: Fields;
  progression: Progression;
  arsenal: Arsenal;
  player: { position: { x: number; z: number } };
}

/** Was `hoeren` zählt. */
interface Counts {
  /** Treffer je Urheber (`'-'`: ohne Urheber); Schaden über Zeit zählt getrennt. */
  hits: Record<string, number>;
  dots: Record<string, number>;
  kills: Record<string, number>;
  hurts: number;
  absorbed: number;
}

function requireNight(internals: Internals): void {
  if (internals.phase !== 'playing') throw new Error('Das geht nur mitten in einer Nacht.');
}

export function installSkillTools(game: Game): void {
  const internals = game as unknown as Internals;
  let counts: Counts = { hits: {}, dots: {}, kills: {}, hurts: 0, absorbed: 0 };
  let listening = false;

  const name = (source: Source | null): string => source?.id ?? '-';
  const listener: CombatListener = {
    hit(_enemy, _amount, source, dot) {
      const bucket = dot ? counts.dots : counts.hits;
      bucket[name(source)] = (bucket[name(source)] ?? 0) + 1;
    },
    kill(_enemy, source) {
      counts.kills[name(source)] = (counts.kills[name(source)] ?? 0) + 1;
    },
    hurt(_attacker, _taken, absorbed) {
      counts.hurts++;
      if (absorbed) counts.absorbed++;
    },
  };

  const api = {
    zustand(kind: StatusKind, seconds: number, power?: number, radius = 14): number {
      requireNight(internals);
      if (!STATUS_KINDS.includes(kind)) throw new Error(`Unbekannter Zustand: ${kind}. Es gibt ${STATUS_KINDS.join(', ')}.`);
      const { x, z } = internals.player.position;
      let hit = 0;
      internals.enemies.queryRadius(x, z, radius, (enemy: Enemy) => {
        if (enemy.hp <= 0 || Math.hypot(enemy.x - x, enemy.z - z) > radius) return;
        applyStatus(enemy.status, kind, seconds, power);
        hit++;
      });
      return hit;
    },

    feld(def: Partial<FieldDef> = {}, options: FieldOptions = {}): void {
      requireNight(internals);
      const full: FieldDef = { id: 'werkzeug', shape: 'circle', duration: 8, every: 0.5, damage: 5, ...def };
      const { x, z } = internals.player.position;
      internals.fields.spawn(full, x, z, { radius: 4, follow: true, ...options });
    },

    wert(stat: BuffStat, mode: 'add' | 'mul', amount: number, seconds: number, stacks = 1): boolean {
      requireNight(internals);
      return internals.progression.addBuff({ id: 'werkzeug', stat, mode, amount, seconds, maxStacks: 10 }, stacks);
    },

    hoeren(): void {
      counts = { hits: {}, dots: {}, kills: {}, hurts: 0, absorbed: 0 };
      if (listening) return;
      listening = true;
      // `Game.startRun` meldet alle Zuhörer ab; wer mitzählen will, ruft `hoeren` in jeder Nacht neu auf.
      internals.events.add(listener);
    },

    ereignisse(): Counts {
      return counts;
    },

    raenge(id: string): unknown {
      const def = weaponById(id);
      const top = def.evolution ? EVOLUTION_RANK : MAX_RANK;
      return Array.from({ length: top }, (_, index) => resolveRank(def, index + 1));
    },

    entwickeln(id: string): number {
      requireNight(internals);
      const def = weaponById(id);
      if (!def.evolution) throw new Error(`${id} hat keine Evolution.`);
      const { arsenal } = internals;
      arsenal.unlockEvolutions(new Set([id]));
      // Bis Rang 5 aufsteigen; der letzte Schritt entwickelt ihn.
      while (arsenal.rankOf(id) < EVOLUTION_RANK) arsenal.take(def);
      return arsenal.rankOf(id);
    },

    stand(): unknown {
      const statuses: Record<string, number> = {};
      for (const enemy of internals.enemies.alive) {
        for (const kind of STATUS_KINDS) if (enemy.status[kind].time > 0) statuses[kind] = (statuses[kind] ?? 0) + 1;
      }
      return {
        zustaendeDerGegner: statuses,
        felder: internals.fields.count,
        zeitweiligeWerte: internals.progression.buffs.active,
        hoerer: internals.events.count,
      };
    },
  };

  // Nach jeder neuen Nacht ist die Liste der Zuhörer leer; `listening` danach zurücksetzen, sobald `hoeren` neu gerufen wird.
  const original = internals.events.clear.bind(internals.events);
  internals.events.clear = () => {
    original();
    listening = false;
  };

  (window as unknown as { __skills: typeof api }).__skills = api;
}
