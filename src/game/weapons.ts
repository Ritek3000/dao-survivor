/**
 * Alle Angriffe als Daten. Einheiten: Meter und Sekunden.
 * Die Zauber des Magiers folgen den Effektfamilien aus den Magie-Vorlagen des Nutzers:
 * nichts schwebt, nichts entsteht aus dem Nichts.
 *
 * Was ein höherer Rang ändert, steht entweder in den Einheitsregeln (jeder Rang +25 % Schaden, Abklingzeit auf 94 %) mit den
 * Feldern `arc`, `count` und `pierce` oder, je Angriff, in einer Tabelle `ranks` (siehe `RankRule`). `resolveRank` macht daraus
 * für jeden Rang eine fertige Zeile, die der Kampf liest.
 */

import type { StatusApply } from './status';

export type WeaponKind =
  /** Kegel in Richtung des nächsten Gegners. */
  | 'arc'
  /** Wirkung rundum um die Spielfigur. */
  | 'nova'
  | 'projectile'
  /** Gerade Linie, die alle Gegner darauf trifft. */
  | 'beam'
  /** Dauerhafter Kreis um die Spielfigur, der in Abständen wirkt. */
  | 'aura'
  /** Verzögerter Einschlag auf einer Fläche. */
  | 'volley'
  | 'trap'
  /** Eine Kapsel, die liegt, bis ein Gegner nah kommt, und dann ein Bodenfeld öffnet (Sporenfalle). */
  | 'pod'
  /** Sofortige Wirkung auf einer Fläche um den nächsten Gegner. */
  | 'root'
  | 'shield'
  /** Ein Bodenfeld an der Figur (Banner); es wirkt, solange es liegt (siehe `fields.ts`). */
  | 'field'
  /** Wirkt nicht von selbst, sondern wenn ein Gegner die Figur trifft (Dornenschild). */
  | 'thorns';

export type ProjectileShape = 'arrow' | 'knife' | 'axe';

/** Das Bild eines Angriffs; was dazu gezeichnet wird, steht in effects.ts. */
export type WeaponLook =
  // Kegel
  | 'hieb'
  | 'wucht'
  | 'hitze'
  // Fläche um den nächsten Gegner
  | 'netz'
  // rundum
  | 'wirbel'
  | 'schrei'
  | 'erdstoss'
  | 'boee';

export interface WeaponDef {
  id: string;
  name: string;
  /** Kurzbeschreibung für die Auswahlkarte. */
  text: string;
  kind: WeaponKind;
  /** Bei 'aura' der Abstand zwischen zwei Wirkungen, bei 'shield' die Ladezeit. */
  cooldown: number;
  damage: number;
  /** Reichweite, in der ein Ziel gesucht wird; bei 'nova' und 'aura' der Radius. */
  range: number;
  /** Wie ein Kegel oder eine Wirkung rundum aussieht; die übrigen Arten haben nur ein Bild. */
  look?: WeaponLook;
  /** Öffnungswinkel eines Kegels in Radiant, abhängig vom Rang. */
  arc?: (rank: number) => number;
  knockback?: number;
  /** Sekunden, die Getroffene festgehalten werden: umgeworfen oder verwurzelt. */
  hold?: number;
  /** Sekunden mit halbem Tempo. */
  slow?: number;
  /** Sekunden, in denen Getroffene mehr Schaden erleiden. */
  weak?: number;
  /** Fläche von 'volley', 'trap' und 'root'. */
  radius?: number;
  /** Verzögerung bis zum Einschlag. */
  delay?: number;
  /** Sekunden, die ein Bodenfeld liegt (Sporenwolke, Köderpuppe); ein Rang darf es mit `RankRule.duration` ersetzen. */
  duration?: number;
  maxTargets?: number;
  /** Höchstzahl gleichzeitig liegender Fallen. */
  maxActive?: number;
  /** Breite eines Strahls. */
  width?: number;
  speed?: number;
  shape?: ProjectileShape;
  /** Winkel zwischen zwei Geschossen eines Fächers. */
  spread?: number;
  count?: (rank: number) => number;
  /** Wie viele Gegner ein Geschoss zusätzlich durchschlägt. */
  pierce?: (rank: number) => number;
  /**
   * Die Regeln je Rang, wo sie von den Einheitsregeln abweichen; der Eintrag an Stelle 0 ist Rang 1. Siehe `RankRule`.
   * Ohne Tabelle gelten die Einheitsregeln und die Felder `arc`, `count` und `pierce`.
   */
  ranks?: readonly RankRule[];
  /** Was ein Rang bringt, in einem Satz für die Auswahlkarte; der Eintrag an Stelle 0 gehört zu Rang 1. */
  rankText?: readonly string[];
  /**
   * Die Evolution des Angriffs: Hat er Rang 5 und schaltet ein angelegter legendärer Ring sie frei, wird er zu Rang 6. Die Zeile dazu
   * steht als sechster Eintrag in `ranks` (siehe `EVOLUTION_RANK`).
   */
  evolution?: EvolutionInfo;
}

/** Name, Gegenstand und Wirkung einer Evolution, wie sie Auswahlkarte, Meldung und Gegenstandskarte zeigen. */
export interface EvolutionInfo {
  /** Der Name des entwickelten Angriffs („Henkersbeil der Alten Ordnung“); er ersetzt den Namen der Fertigkeit, solange sie entwickelt ist. */
  name: string;
  /** Der Name des legendären Rings, der sie freischaltet („Henkerswerk“). */
  item: string;
  /** Die Wirkung in ein, zwei Sätzen, für die Karte des Rings und die Meldung. */
  text: string;
}

/**
 * Was ein Rang eines Angriffs festlegt. Ein Feld, das der Rang nennt, gilt von diesem Rang an auch für die folgenden, bis ein späterer
 * Rang es neu setzt (Rang 3 mit `count: 4` heißt: auf Rang 3, 4 und 5 sind es vier). Ein Feld, das nie genannt wird, folgt den
 * Einheitsregeln und den Feldern des Angriffs. So schreibt eine Tabelle nur auf, was von der Regel abweicht.
 */
export interface RankRule {
  /** Faktor auf den Schaden des Angriffs. */
  damage?: number;
  /** Faktor auf die Abklingzeit; kleiner ist schneller. */
  cooldown?: number;
  /** Faktor auf die Reichweite, in der ein Ziel gesucht wird. */
  range?: number;
  /** Faktor auf die Fläche (`radius`; bei 'aura' die Reichweite selbst). */
  radius?: number;
  /** Öffnungswinkel eines Kegels in Radiant. */
  arc?: number;
  /** Zahl der Geschosse eines Fächers. */
  count?: number;
  /** Wie viele Gegner ein Geschoss zusätzlich durchschlägt. */
  pierce?: number;
  /** Faktor auf den Rückstoß. */
  knockback?: number;
  /** Faktor auf die Zeit, die die Figur für diesen Angriff ausholt (kleiner ist kürzer). */
  lead?: number;
  /** Faktor auf das Tempo der Geschosse. */
  speed?: number;
  /** Faktor auf den Winkel zwischen zwei Geschossen eines Fächers. */
  spread?: number;
  /** Sekunden, die ein Bodenfeld liegt; ersetzt `WeaponDef.duration`. */
  duration?: number;
  /** Die Zustände, die ein Treffer anbringt; die Liste ersetzt die des vorigen Rangs ganz (leer: keine). */
  statuses?: readonly StatusApply[];
  /** Schalter für Besonderheiten dieses Rangs, die der Angriff mit `hasFlag` liest (etwa ein zweiter Hieb); ersetzt die des vorigen Rangs ganz. */
  flags?: readonly string[];
}

/** Ein Rang eines Angriffs, fertig aufgelöst: das, was der Kampf liest. */
export interface ResolvedRank {
  rank: number;
  /** Faktor auf den Schaden des Angriffs. */
  damage: number;
  /** Faktor auf die Abklingzeit. */
  cooldown: number;
  range: number;
  radius: number;
  arc: number;
  count: number;
  pierce: number;
  knockback: number;
  lead: number;
  speed: number;
  spread: number;
  duration: number;
  statuses: readonly StatusApply[];
  flags: readonly string[];
}

/** Der höchste Rang, den man wählen kann. */
export const MAX_RANK = 5;
/**
 * Rang 6 ist die Evolution: Sie bekommt man nicht durch Wahl, sondern wenn ein Angriff mit Evolution Rang 5 erreicht und ein angelegter
 * legendärer Ring sie freischaltet (`Arsenal.reset`, `Arsenal.take`).
 */
export const EVOLUTION_RANK = 6;
/** Jeder Rang über dem ersten bringt so viel Schaden dazu. */
export const DAMAGE_PER_RANK = 0.25;
/** Jeder Rang über dem ersten verkürzt die Abklingzeit auf diesen Anteil. */
export const COOLDOWN_PER_RANK = 0.94;
/** Bei Dauerkreisen wächst der Radius mit jedem Rang um so viel des Grundwerts. */
export const AURA_RADIUS_PER_RANK = 0.1;

const DEFS: readonly WeaponDef[] = [
  // Kämpfer. Die Tabellen `ranks` und die Sätze `rankText` folgen der Vorlage „Klassen, Fertigkeiten & Evolutionen“; was ein Text
  // verlangt, das es im Spiel nicht gibt, ist umgedeutet (Nachteil heißt mehr erlittener Schaden, keine Rüstung der Gegner).
  {
    id: 'axthieb',
    name: 'Axthieb',
    text: 'Weiter Hieb im Bogen auf den nächsten Gegner',
    kind: 'arc',
    look: 'hieb',
    cooldown: 0.85,
    damage: 12,
    range: 2.9,
    arc: () => 2.5,
    knockback: 6,
    ranks: [
      {},
      { range: 1.25, flags: ['zulaufen'] },
      {
        statuses: [
          { kind: 'bleed', seconds: 3, power: 4 },
          { kind: 'slow', seconds: 3, power: 0.15 },
        ],
      },
      { cooldown: 0.72, flags: ['zulaufen', 'rueckhand'] },
      {
        cooldown: 0.7,
        statuses: [
          { kind: 'bleed', seconds: 3, power: 4 },
          { kind: 'slow', seconds: 3, power: 0.15 },
          { kind: 'weak', seconds: 4, power: 1.2 },
          { kind: 'mark', seconds: 4, power: 0.3 },
        ],
      },
      // Evolution: Jeder vierte Hieb entlädt die Sichel (`CONFIG.skills.evolution.kaempfer`).
      { flags: ['zulaufen', 'rueckhand', 'sichel'] },
    ],
    evolution: {
      name: 'Henkersbeil der Alten Ordnung',
      item: 'Henkerswerk',
      text: 'Jeder vierte Axthieb entlädt eine schwere Staub-Sichel nach vorn, die durch ganze Horden schneidet und geschwächte Feinde unter 25 % ihres Lebens sofort hinrichtet.',
    },
    rankText: [
      'Weiter Hieb im Halbkreis auf den nächsten Gegner, stößt leicht zurück',
      'Reichweite +25 %; mehr Schaden gegen Gegner, auf die du zuläufst',
      'Getroffene bluten und werden etwas langsamer',
      'Kürzere Abklingzeit; ein schneller Rückhand-Hieb folgt',
      'Spaltet Deckungen: Getroffene erleiden Nachteil und werden leichter kritisch getroffen',
    ],
  },
  {
    id: 'banner',
    name: 'Banner',
    text: 'Ein zerfetztes Banner entzieht Gegnern darin Lebenskraft',
    kind: 'field',
    cooldown: 11,
    // Schaden je Takt (alle 0,5 s); `range` ist die Entfernung, ab der ein Gegner das Setzen auslöst, `radius` der Kreis des Banners.
    damage: 5,
    range: 7,
    radius: 3.2,
    ranks: [
      { damage: 1 },
      { damage: 1.5, radius: 1.3 },
      { damage: 1.6, flags: ['splitter'] },
      { damage: 1.7, flags: ['splitter', 'lang'], statuses: [{ kind: 'feeble', seconds: 0.8, power: 0.2 }] },
      { damage: 1.9, flags: ['splitter', 'lang', 'magnet'] },
      // Evolution: Das Banner schwebt dauerhaft über der Figur, ohne Pause und mit mehr Schaden je Takt; dazu kommen die Stapel an Tempo.
      { damage: 3, radius: 1.4, flags: ['splitter', 'lang', 'magnet', 'reliquie'] },
    ],
    evolution: {
      name: 'Reliquie der Nimmersatten',
      item: 'Nimmersatt',
      text: 'Das Banner schwebt dauerhaft über dir. Gegner im Umkreis werden ausgesaugt; jeder betroffene Feind steigert deine Angriffs- und Lauftempo (bis zu 10 Stapel).',
    },
    rankText: [
      'Ein Banner für 6 Sekunden: Gegner im Kreis erleiden fortwährend Schaden',
      'Radius +30 %, mehr Schaden',
      'Jeder zehnte Gegner, der im Banner stirbt, lässt einen Lebenssplitter fallen, der dich heilt',
      'Gegner im Banner richten 20 % weniger Schaden an; es hält 8 Sekunden',
      'Das Banner pulsiert alle 2 Sekunden und zieht Edelsteine in der Nähe heran',
    ],
  },
  {
    id: 'wurfaxt',
    name: 'Wurfaxt',
    text: 'Schwerer Wurf auf den nächsten Gegner',
    kind: 'projectile',
    cooldown: 2.8,
    damage: 14,
    range: 11,
    speed: 11,
    shape: 'axe',
    spread: 0.2,
    knockback: 3,
    ranks: [
      { damage: 1.5, pierce: 0, count: 1 },
      { damage: 1.75, pierce: 1 },
      { damage: 2, count: 2 },
      { damage: 2.25, flags: ['staubspur'] },
      { damage: 2.5, flags: ['staubspur', 'kehrtwende'] },
      // Evolution: sechs Äxte statt zwei, dafür je Axt weniger Schaden.
      { damage: 1, count: 6, flags: ['staubspur', 'kehrtwende', 'sturm'] },
    ],
    evolution: {
      name: 'Sturm der Klingen',
      item: 'Sturmklinge',
      text: 'Sechs mit Staub gebundene Äxte kreisen kurz als Schutzring um dich, dann fliegen sie gleichzeitig in alle Richtungen auf die stärksten Ziele in Sichtweite.',
    },
    rankText: [
      'Schwerer Wurf auf den nächsten Gegner; die Axt bleibt kurz im Ziel stecken',
      'Die Axt durchschlägt bis zu zwei Gegner hintereinander',
      'Zwei Äxte zugleich, im leichten Winkel zueinander',
      'Die Äxte ziehen eine Staubspur, die Gegner verlangsamt',
      'Am Ende der Flugbahn kehren die Äxte zurück und treffen alle auf dem Rückweg erneut',
    ],
  },
  {
    id: 'wirbelschlag',
    name: 'Wirbelschlag',
    text: 'Sprung mit Drehung, trifft alle Gegner rundum',
    kind: 'nova',
    look: 'wirbel',
    cooldown: 3.2,
    damage: 14,
    range: 3.2,
    knockback: 4,
    ranks: [
      {},
      { radius: 1.3 },
      { flags: ['doppelt'] },
      { flags: ['doppelt', 'abkuehlung'], knockback: 2.5 },
      { flags: ['doppelt', 'abkuehlung', 'schutz', 'umzingelt'] },
      // Evolution: Statt zwei Wirbeln ein Mahlstrom von mehreren Sekunden (`CONFIG.skills.evolution.kaempfer`).
      { flags: ['doppelt', 'abkuehlung', 'schutz', 'umzingelt', 'mahlstrom'] },
    ],
    evolution: {
      name: 'Mahlstrom aus Staub und Eisen',
      item: 'Wirbelsturm',
      text: 'Du drehst dich mehrere Sekunden ununterbrochen und läufst dabei frei. Ein reißender Staub-Tornado zieht Gegner an, zerschneidet sie und schleudert sie am Ende in einer Druckwelle nach außen.',
    },
    rankText: [
      'Sprung mit Drehung, trifft alle Gegner rundum',
      'Radius +30 %',
      'Zwei Wirbel hintereinander; dabei bist du etwas schneller',
      'Jeder getroffene Gegner verkürzt die Abklingzeit; Gegner fliegen weit zurück',
      'Im Wirbel nimmst du weniger Schaden; Umzingelte erleiden doppelten Schaden',
    ],
  },
  {
    // Der Kämpfer trägt keinen Schild; an die Stelle des Schildstoßes tritt der aufgeladene Hieb.
    id: 'wuchthieb',
    name: 'Wuchthieb',
    text: 'Weit ausgeholter Hieb, schleudert Gegner vor dir zurück',
    kind: 'arc',
    look: 'wucht',
    cooldown: 3,
    damage: 18,
    range: 3.1,
    arc: () => 2.2,
    knockback: 16,
    hold: 0.5,
    ranks: [
      {},
      { cooldown: 0.8, lead: 0.6, flags: ['schutz'] },
      {
        statuses: [
          { kind: 'hold', seconds: 0.5 },
          { kind: 'blind', seconds: 2.5 },
        ],
      },
      { range: 1.4, knockback: 1.8 },
      { flags: ['schutz', 'kette'] },
      // Evolution: längeres Ausholen, in dem der Staub Gegner zum Einschlag zieht, dann spaltet der Hieb den Boden in einer langen Linie.
      { lead: 1.6, flags: ['schutz', 'kette', 'spalter'] },
    ],
    evolution: {
      name: 'Spalter von Ghen',
      item: 'Weltenspalter',
      text: 'Beim Ausholen saugt die Axt den Staub ein und zieht nahe Gegner zum Einschlagpunkt. Der Niederschlag spaltet den Boden in einer langen Linie und zerquetscht alles auf seinem Weg.',
    },
    rankText: [
      'Weit ausgeholter Hieb, schleudert Gegner vor dir zurück',
      'Kürzeres Ausholen, dabei erleidest du 30 % weniger Schaden',
      'Der Aufprall wirbelt Staub auf: Gegner werden geblendet und betäubt',
      'Radius +40 %, Gegner fliegen weit zurück',
      'Trifft er fünf Gegner, lädt der nächste Schlag fast sofort und ist sicher kritisch',
    ],
  },
  {
    id: 'kriegsschrei',
    name: 'Kriegsschrei',
    text: 'Druckwelle rundum: Gegner weichen zurück und geraten in Furcht',
    kind: 'nova',
    look: 'schrei',
    cooldown: 7,
    damage: 6,
    range: 6,
    knockback: 6,
    ranks: [
      { damage: 0, statuses: [{ kind: 'fear', seconds: 1.5 }] },
      { damage: 1, radius: 1.35, flags: ['schwache'] },
      { damage: 1, flags: ['schwache', 'vorteil'] },
      {
        damage: 1.25,
        statuses: [
          { kind: 'fear', seconds: 1.5 },
          { kind: 'weak', seconds: 4, power: 1.2 },
        ],
      },
      { damage: 1.5, cooldown: 0.7, flags: ['schwache', 'vorteil', 'echo'] },
      // Evolution: ein Kegel mit doppelter Reichweite, der alle verletzt (nicht nur Schwache), bremst und für Nahkämpfe verwundbar macht.
      {
        radius: 2.7,
        flags: ['vorteil', 'echo', 'donner'],
        statuses: [
          { kind: 'fear', seconds: 1.5 },
          { kind: 'weak', seconds: 4, power: 1.2 },
          { kind: 'slow', seconds: 1.5, power: 0.3 },
        ],
      },
    ],
    evolution: {
      name: 'Donner der Alten Ordnung',
      item: 'Donneraxt',
      text: 'Der Schrei fährt als Kegel in Blickrichtung mit doppelter Reichweite. Getroffene erleiden Schaden, werden 1,5 Sekunden um 30 % verlangsamt und nehmen von deinen Nahkampfangriffen 15 % mehr Schaden.',
    },
    rankText: [
      'Druckwelle rundum: Gegner weichen zurück und geraten in Furcht',
      'Radius +35 %, leichter Schaden an schwachen Gegnern',
      'Danach 4 Sekunden Vorteil: schnellere Hiebe und mehr Kritchance',
      'Getroffene erleiden Nachteil: 20 % mehr Schaden aus allen Quellen',
      'Kürzere Abklingzeit; nach 1,5 Sekunden folgt ein schwächeres Echo',
    ],
  },
  {
    id: 'dornenschild',
    name: 'Dornenschild',
    text: 'Wer dich im Nahkampf trifft, wird von den Dornen gestochen',
    kind: 'thorns',
    // Wirkt nur, wenn die Figur getroffen wird: Abklingzeit und Reichweite bleiben ungenutzt.
    cooldown: 1,
    damage: 6,
    range: 0,
    ranks: [
      { damage: 1 },
      { damage: 1.3, statuses: [{ kind: 'bleed', seconds: 2, power: 3 }] },
      { damage: 1.45, flags: ['ramm'] },
      { damage: 1.6, flags: ['ramm', 'splitter'] },
      {
        damage: 1.75,
        statuses: [
          { kind: 'bleed', seconds: 2, power: 3 },
          { kind: 'slow', seconds: 1, power: 0.2 },
        ],
      },
      // Evolution: eine Dornen-Aura vor der Figur, dauerhaft (`CONFIG.skills.evolution.kaempfer`).
      { flags: ['ramm', 'splitter', 'bollwerk'] },
    ],
    evolution: {
      name: 'Bollwerk der Stacheln',
      item: 'Stachelbeil',
      text: 'Lange, staubverkrustete Eisenstangen bilden eine dauerhafte, enge Dornen-Aura vor dir. Gegner erleiden den Dornenschaden schon beim Berühren der Aura, bevor sie zuschlagen können, und werden leicht zurückgedrängt.',
    },
    rankText: [
      'Wer dich im Nahkampf trifft, erleidet sofort leichten Stichschaden',
      'Dornenschaden +30 %; Angreifer bluten kurz',
      'Rammbock: Gegen frontale Angreifer verdoppelt sich der Dornenschaden, solange du stehst oder auf sie zuläufst',
      'Alle 3 Treffer schleudert der Schild drei Eisensplitter auf den Angreifer',
      'Gegner an den Dornen werden 1 Sekunde um 20 % verlangsamt',
    ],
  },

  // Wildnisläufer. Wie beim Kämpfer folgen Tabellen und Sätze der Vorlage; die Sekunden der Vorlage („Abklingzeit −0,3 s“) stehen als
  // Faktor auf der Grundzeit. Wo sie keine Grundzeit nennt (Bogenschuss), ist sie hier gesetzt: eine Sekunde, damit „−0,3 s“ etwas bedeutet.
  // Der Schaden von Bogenschuss (36) und Wurfmesser (12) ist höher als vor dem Umbau (16 und 9), weil Rang 1 jetzt nur noch ein Ziel trifft
  // (der Durchschlag kommt erst mit Rang 2 bzw. 5); im Messlauf (zwölf Nächte, zwei Saatwerte) hält die Klasse damit etwa die Überlebenszeit von vorher.
  {
    id: 'bogenschuss',
    name: 'Bogenschuss',
    text: 'Schwerer Pfeil auf den nächsten Gegner, auf höheren Rängen mehr',
    kind: 'projectile',
    cooldown: 1,
    damage: 36,
    range: 14,
    speed: 26,
    shape: 'arrow',
    spread: 0.07,
    knockback: 2,
    ranks: [
      { pierce: 0 },
      { pierce: 1, flags: ['abfall'] },
      { cooldown: 0.7, statuses: [{ kind: 'slow', seconds: 1.5, power: 0.15 }] },
      { count: 2, flags: ['abfall', 'vorteil'] },
      { range: 1.3, speed: 1.3, flags: ['abfall', 'vorteil', 'ruestung'] },
      // Evolution: Ein schneller Fächer aus fünf schweren Pfeilen; jeder dritte Schuss trägt einen Staub-Pfeil.
      { count: 5, spread: 1.7, damage: 1.3, flags: ['abfall', 'vorteil', 'ruestung', 'faecher'] },
    ],
    evolution: {
      name: 'Pfeilfächer der Alten Ordnung',
      item: 'Pfauenfeder',
      text: 'Der Bogen feuert einen schnellen Fächer aus fünf schweren Eisenpfeilen. Jeder dritte Schuss trägt einen Staub-Pfeil: Er lässt beim ersten Aufprall eine Staubwolke zurück, die nachfolgende Pfeile auf Ziele im Inneren lenkt.',
    },
    rankText: [
      'Schwerer Pfeil auf den nächsten Gegner, stößt kleine Gegner leicht zurück',
      'Der Pfeil durchbohrt das erste Ziel und trifft einen zweiten dahinter, mit weniger Schaden',
      'Kürzere Nachladezeit; Getroffene sind 1,5 Sekunden um 15 % langsamer',
      'Zwei Pfeile dicht nebeneinander; gegen Gegner im Nachteil, verlangsamt oder blutend sind sie leichter kritisch (Vorteil)',
      'Mehr Reichweite und Pfeiltempo; der erste Getroffene erleidet 3 Sekunden lang 15 % mehr Schaden',
    ],
  },
  {
    // Der Schaden ist der Treffer der ganzen Salve auf jeden Gegner im Kreis; `count` sind die Pfeile (nur für das Bild).
    // Abklingzeit, Radius, Verzögerung und der Anstieg des Schadens sind am Messlauf abgestimmt: Vorher traf die Salve im Schnitt nur
    // drei Gegner und kam auf 18 Schaden pro Sekunde (die tragenden Angriffe auf über 70); mit diesen Werten ist Rang 5 solide und die Evolution tragend.
    id: 'pfeilhagel',
    name: 'Pfeilhagel',
    text: 'Eine Salve Pfeile regnet auf eine Gruppe von Gegnern',
    kind: 'volley',
    cooldown: 3.4,
    damage: 24,
    range: 13,
    radius: 3.8,
    delay: 0.45,
    ranks: [
      { damage: 1, count: 6 },
      { damage: 1.5, count: 9, radius: 1.2 },
      { damage: 1.75, statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }] },
      { damage: 2.25, cooldown: 2.8 / 3.4, statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }, { kind: 'bleed', seconds: 3, power: 3 }] },
      { damage: 2.5, flags: ['folgen', 'mitte'] },
      // Evolution: Kein einzelner Einschlag, sondern ein Schauer, der 2,5 Sekunden anhält (`CONFIG.skills.evolution.laeufer`).
      { count: 14, flags: ['folgen', 'mitte', 'aschesturm'] },
    ],
    evolution: {
      name: 'Sturm der Aschenfedern',
      item: 'Schatten der Tausend',
      text: 'Der Pfeilhagel geht 2,5 Sekunden lang als anhaltender Schauer nieder. Die Aschepfeile nehmen Gegnern darin die Sicht (Fernkämpfer können nicht mehr zaubern) und lassen ein dichtes Staubfeld zurück, das Nachrückende weiter verlangsamt.',
    },
    rankText: [
      'Eine Salve von 6 Pfeilen schlägt nach kurzer Verzögerung auf eine Gruppe ein',
      '9 Pfeile je Salve, Radius +20 %',
      'Mehr Schaden; der aufgewirbelte Boden verlangsamt Gegner im Zielgebiet 2 Sekunden um 20 %',
      'Mehr Schaden und kürzere Abklingzeit; Getroffene bluten 3 Sekunden lang',
      'Noch mehr Schaden; die Salve folgt der Gruppe leicht, im Zentrum erleiden Gegner 25 % mehr Schaden',
    ],
  },
  {
    id: 'fangeisen',
    name: 'Fangeisen',
    text: 'Legt Fallen aus, die Gegner verletzen und festhalten',
    kind: 'trap',
    cooldown: 3.5,
    damage: 30,
    range: 0,
    radius: 1.1,
    maxActive: 6,
    ranks: [
      { statuses: [{ kind: 'hold', seconds: 1.5 }] },
      { count: 2 },
      { cooldown: 2.5 / 3.5, statuses: [{ kind: 'hold', seconds: 1.5 }, { kind: 'bleed', seconds: 1.5, power: 4 }] },
      {
        statuses: [
          { kind: 'hold', seconds: 1.5 },
          { kind: 'bleed', seconds: 1.5, power: 4 },
          { kind: 'weak', seconds: 3, power: 1.2 },
          { kind: 'mark', seconds: 3, power: 0.3 },
        ],
      },
      { flags: ['splitter'] },
      // Evolution: Ein Bündel aus drei verketteten Riesen-Fangeisen, das auf die größte Gruppe zufliegt.
      { count: 3, radius: 1.6, cooldown: 4 / 3.5, flags: ['splitter', 'kiefer'] },
    ],
    evolution: {
      name: 'Kiefer der Ödnis',
      item: 'Der Eiserne Kiefer',
      text: 'Alle paar Sekunden fliegt ein Bündel aus drei verketteten Riesen-Fangeisen auf die größte Gruppe zu. Schnappt das erste zu, reißen die Ketten bis zu drei weitere Gegner in die Mitte, wo sie festgehalten und zerrissen werden.',
    },
    rankText: [
      'Ein verdecktes Eisen liegt, bis ein Gegner darauftritt: Schaden, dann 1,5 Sekunden festgehalten',
      'Zwei Fangeisen zugleich, leicht versetzt',
      'Kürzere Abklingzeit; wer im Eisen steckt, blutet',
      'Gegengewicht: Gefangene geraten in Nachteil und sind leichter kritisch zu treffen (Vorteil)',
      'Stirbt ein Gefangener im Eisen, schleudert die Falle Splitter auf Gegner ringsum',
    ],
  },
  {
    id: 'wurfmesser',
    name: 'Wurfmesser-Fächer',
    text: 'Fächer aus Messern auf nahe Gegner, mehr Messer auf höheren Rängen',
    kind: 'projectile',
    cooldown: 1.6,
    damage: 12,
    range: 9,
    speed: 20,
    shape: 'knife',
    spread: 0.22,
    ranks: [
      { count: 3, pierce: 0 },
      { count: 4, spread: 1.15 },
      { cooldown: 1.3 / 1.6, statuses: [{ kind: 'bleed', seconds: 2, power: 2 }] },
      { count: 5, flags: ['vorteil'] },
      { pierce: 1, flags: ['vorteil', 'abfall'] },
      // Evolution: Zwei versetzte Wellen aus je sieben Messern im weiten Halbkreis.
      { count: 7, spread: 2.4, damage: 1.35, flags: ['vorteil', 'abfall', 'klingenfaecher'] },
    ],
    evolution: {
      name: 'Klingen-Fächer der Ödnis',
      item: 'Tausend Schnitte',
      text: 'Zwei versetzte Wellen aus je sieben Messern fliegen kurz nacheinander im weiten Halbkreis. Die äußeren Messer wirbeln Staub auf und biegen nach kurzem Flug nach innen ab, um Flüchtende an den Flanken zu fangen.',
    },
    rankText: [
      'Drei Messer im Fächer, jedes trifft das erste Ziel auf seiner Bahn',
      'Vier Messer, breiterer Fächer',
      'Kürzere Abklingzeit; Getroffene bluten leicht',
      'Fünf Messer; gegen Gegner im Nachteil, blutend oder verlangsamt sind sie leichter kritisch (Vorteil)',
      'Jedes Messer durchschlägt sein Ziel und trifft noch einen Gegner dahinter',
    ],
  },
  {
    // Die Kapsel liegt, bis ein Gegner nah kommt; dann öffnet sich ein Bodenfeld. `damage` ist der Schaden je Takt des Felds (alle 0,5 s).
    id: 'sporenfalle',
    name: 'Sporenfalle',
    text: 'Pilzkapseln, die Gegner in eine erstickende Sporenwolke hüllen',
    kind: 'pod',
    cooldown: 6,
    damage: 3,
    range: 0,
    radius: 2,
    duration: 3.5,
    ranks: [
      { statuses: [{ kind: 'slow', seconds: 0.8, power: 0.2 }] },
      { radius: 1.3, duration: 4.5 },
      {
        cooldown: 4.8 / 6,
        statuses: [
          { kind: 'slow', seconds: 0.8, power: 0.2 },
          { kind: 'silence', seconds: 0.8 },
          { kind: 'feeble', seconds: 0.8, power: 0.25 },
        ],
      },
      { damage: 2.2, count: 2 },
      { flags: ['platzen'] },
      // Evolution: Ein dicker Beutel fliegt in die Gruppe; die Wolke ist eine breite, wandernde Nebelwand.
      { count: 1, radius: 1.7, duration: 7, flags: ['platzen', 'schattenpilz'] },
    ],
    evolution: {
      name: 'Atem der Schattenpilze',
      item: 'Herz des Myzels',
      text: 'Dicke Sporenbeutel fliegen in dichte Gegnergruppen. Beim Aufprall kriecht eine breite Nebelwand aus Sporen und Staub mit dem Wind weiter, macht Gegner darin blind und langsam und zersetzt ihre Rüstung.',
    },
    rankText: [
      'Lässt Pilzkapseln fallen; platzt eine, hüllt eine Wolke Gegner 3,5 Sekunden in Sporen: 20 % langsamer, Schaden über Zeit',
      'Radius +30 %, die Wolke hält 1 Sekunde länger',
      'Kürzere Abklingzeit; Fernkämpfer in der Wolke können nicht zaubern, Gegner darin greifen langsamer an',
      'Zwei Kapseln zugleich; deutlich mehr Schaden über Zeit',
      'Wer in einer Wolke stirbt, platzt auf und lässt eine frische Wolke zurück (2 Sekunden)',
    ],
  },
  {
    // Ein hohes Gestell, das an der Figur steht: Es wirkt als Bodenfeld, löst sich nach `duration` auf und kann dabei (Rang 5)
    // eine Welle schleudern, deren Schaden `damage` ist. `range` ist die Entfernung, ab der ein Gegner das Rammen auslöst.
    id: 'koederpuppe',
    name: 'Köderpuppe',
    text: 'Ein klapperndes Gestell lockt Gegner an, verlangsamt und verwirrt sie',
    kind: 'field',
    cooldown: 8.5,
    damage: 22,
    range: 9,
    radius: 2.6,
    duration: 3.5,
    knockback: 9,
    ranks: [
      {
        damage: 1,
        statuses: [
          { kind: 'slow', seconds: 0.8, power: 0.2 },
          { kind: 'feeble', seconds: 0.8, power: 0.2 },
        ],
      },
      { radius: 1.3, duration: 5 },
      { cooldown: 7 / 8.5, flags: ['furcht'] },
      { flags: ['furcht', 'schleier'] },
      { damage: 1.6, flags: ['furcht', 'schleier', 'knall'] },
      // Evolution: Ein großes, schwebendes Phantom, das Gegner im weiten Umkreis anlockt, anzieht und in Furcht versetzt.
      { radius: 2, duration: 6, flags: ['furcht', 'schleier', 'knall', 'vollstrecker'] },
    ],
    evolution: {
      name: 'Vollstrecker der Ödnis',
      item: 'Der Falsche König',
      text: 'Ein riesiges, schwebendes Staub-Phantom zieht Gegner im weiten Umkreis an und versetzt sie in Furcht. Am Ende zerspringt es in einer gewaltigen Schockwelle aus Knochen- und Staubsplittern; wer verlangsamt oder gefesselt ist, erleidet 15 % mehr Schaden.',
    },
    rankText: [
      'Rammt ein Gestell in den Boden: Gegner in der Nähe laufen auf die Puppe zu statt auf dich, sind 20 % langsamer und greifen langsamer an',
      'Bereich +30 %, die Puppe steht 5 Sekunden',
      'Kürzere Abklingzeit; kleine Gegner, die zu lange in ihrem Schatten stehen, geraten in Furcht',
      'Nahe der Puppe erleidest du weniger Schaden aus Fernangriffen',
      'Löst sich die Puppe auf, schleudert eine Schadenswelle Gegner zurück',
    ],
  },
  {
    id: 'netz',
    name: 'Netz',
    text: 'Ein Fangnetz bremst eine Gruppe von Gegnern',
    kind: 'root',
    look: 'netz',
    cooldown: 6,
    damage: 6,
    range: 9,
    radius: 2.4,
    ranks: [
      { damage: 1, statuses: [{ kind: 'slow', seconds: 2.5, power: 0.4 }] },
      { radius: 1.3, statuses: [{ kind: 'slow', seconds: 2.5, power: 0.5 }] },
      { cooldown: 4.8 / 6, flags: ['zug'] },
      {
        statuses: [
          { kind: 'slow', seconds: 2.5, power: 0.5 },
          { kind: 'bleed', seconds: 3, power: 2 },
          { kind: 'weak', seconds: 3, power: 1.2 },
        ],
      },
      { flags: ['zug', 'staub'] },
      // Evolution: Ein Schleppnetz, das als Welle über den Boden fegt und am Ende ein Bündel schnürt.
      { damage: 2, flags: ['zug', 'staub', 'schlinge'] },
    ],
    evolution: {
      name: 'Schlinge der Alten Ordnung',
      item: 'Arachnes Zorn',
      text: 'Ein gewaltiges Schleppnetz fegt als Welle über den Boden, reißt kleine und mittlere Gegner mit, schnürt sie am Ende zu einem engen Bündel und hält sie 3 Sekunden fest, während Eisengewichte sie zerquetschen.',
    },
    rankText: [
      'Ein Fangnetz auf die nächste Gruppe: leichter Schaden, 2,5 Sekunden um 40 % langsamer',
      'Radius +30 %, Verlangsamung 50 %',
      'Kürzere Abklingzeit; das Netz zieht Getroffene zusammen',
      'Eingefangene bluten und geraten in Nachteil: Sie erleiden mehr Schaden',
      'Der aufgewirbelte Staub macht kleine Gegner 1,5 Sekunden bewegungsunfähig und stört Fernkämpfer',
    ],
  },

  // Magier. Auch hier folgen Tabellen und Sätze der Vorlage; was die Vorlage „Abklingzeit verringert“ nennt, ohne eine Zahl zu geben, ist ein
  // Faktor von 0,8. Die Zustände sind die des Unterbaus: Brennen (`burn`), Nachteil (`weak`), Blendung (`blind`) und so weiter.
  {
    id: 'hitze-werfen',
    name: 'Hitze werfen',
    text: 'Unsichtbarer Hitzestoß, der alle Gegner in einer Linie durchdringt und entzündet; ab Rang 4 ein Kegel',
    kind: 'arc',
    look: 'hitze',
    cooldown: 1.2,
    damage: 15,
    range: 9,
    ranks: [
      { arc: 0.3, statuses: [{ kind: 'burn', seconds: 2, power: 5 }] },
      {
        range: 1.25,
        arc: 0.375,
        statuses: [
          { kind: 'burn', seconds: 2, power: 5 },
          { kind: 'weak', seconds: 2, power: 1.2 },
        ],
      },
      {
        cooldown: 0.8,
        statuses: [
          { kind: 'burn', seconds: 2, power: 5 },
          { kind: 'weak', seconds: 2, power: 1.2 },
          { kind: 'slow', seconds: 1.5, power: 0.15 },
        ],
      },
      { arc: 0.95 },
      { flags: ['asche'] },
      // Evolution: Ein Hitzesturm im weiten Halbkreis; wer brennend stirbt, entzündet den Staub um sich (`CONFIG.skills.evolution.magier`).
      // Der Schaden ist ausdrücklich höher als die +25 % je Rang: Der Messlauf zeigte beim Standardwert (2,25) keinen Vorsprung vor Rang 5.
      {
        damage: 2.9,
        arc: 2.4,
        flags: ['asche', 'sonnenstich'],
        statuses: [
          { kind: 'burn', seconds: 2, power: 5 },
          { kind: 'weak', seconds: 2, power: 1.2 },
          { kind: 'slow', seconds: 1.5, power: 0.15 },
          { kind: 'blind', seconds: 1.5, power: 0.5 },
        ],
      },
    ],
    evolution: {
      name: 'Atem der Verblassenden Sor',
      item: 'Foliant der Glut',
      text: 'Der Hitzestoß bricht als gewaltiger, fast unsichtbarer Sturm im weiten Halbkreis durch den Staub. Getroffene fangen Feuer und sind geblendet; wer brennend stirbt, entzündet den Staub um sich herum.',
    },
    rankText: [
      'Ein unsichtbarer Hitzestoß durchdringt alle Gegner in einer Linie und entzündet sie 2 Sekunden lang',
      'Reichweite und Breite +25 %; Entzündete erleiden Nachteil: Ihre Rüstung wird spröde',
      'Kürzere Abklingzeit; Getroffene sind 1,5 Sekunden um 15 % langsamer',
      'Statt einer Linie ein breiter Hitzekegel, der ganze Gruppen erfasst',
      'Am Ende des Kegels bleibt 2,5 Sekunden eine glühende Linie aus Asche liegen und verbrennt, wer nachrückt',
    ],
  },
  {
    id: 'sorlanze',
    name: 'Sorlanze',
    text: 'Schmaler Lichtspeer auf den nächsten Gegner, der in einer Linie durchbohrt',
    kind: 'beam',
    cooldown: 2.5,
    damage: 26,
    range: 15,
    width: 0.4,
    ranks: [
      { pierce: 2, flags: ['abfall'] },
      { range: 1.3, pierce: 999, flags: [] },
      { cooldown: 0.8, statuses: [{ kind: 'blind', seconds: 2.5, power: 0.4 }] },
      { flags: ['glutspur'] },
      { flags: ['glutspur', 'doppel', 'treffsicher'] },
      // Evolution: Ein Lichtspeer fällt aus dem Himmel in die dichteste Gruppe und teilt sich in vier Strahlen. Die Abklingzeit bleibt die von
      // Rang 3 (Faktor 0,8): Mit dem Faktor 1 wäre der Speer langsamer als die zwei Lanzen von Rang 5. Der Schaden ist ausdrücklich 3 statt 2,25:
      // Die zwei durchbohrenden Lanzen von Rang 5 sind stark, und der Speer lag im Messlauf bei den Standardwerten nicht über ihnen.
      {
        damage: 3,
        flags: ['treffsicher', 'sonnenspeer'],
        statuses: [
          { kind: 'blind', seconds: 2.5, power: 0.4 },
          { kind: 'burn', seconds: 3, power: 5 },
        ],
      },
    ],
    evolution: {
      name: 'Speer der Verschwundenen Sonne',
      item: 'Zorn der Sonne',
      text: 'Ein grell leuchtender Lichtspeer bricht aus dem Himmel in die dichteste Gruppe. Beim Aufprall teilt er sich in vier Strahlen, die sternförmig über den Boden fegen, den Staub wegbrennen und alles entzünden.',
    },
    rankText: [
      'Ein schmaler Lichtspeer durchbohrt bis zu drei Gegner in einer Linie, jeder weitere erleidet weniger',
      'Die Lanze durchschlägt alle Gegner auf ihrer ganzen, längeren Bahn ohne Schadensverlust',
      'Kürzere Abklingzeit; das Licht von Sor blendet Getroffene: Ihre Angriffe gehen häufiger daneben',
      'Der Speer brennt eine glühende Linie in den Staub: Wer sie überquert, verbrennt und wird langsamer',
      'Zwei leicht versetzte Lanzen kurz nacheinander; gegen Gegner im Nachteil oder in Flammen trifft sie sicher kritisch',
    ],
  },
  {
    // Trifft alle Gegner im ganzen Kreis, nicht nur am Rand: Rang 1 bringt 5 Schaden alle 0,5 s, also 10 je Sekunde.
    id: 'glut-formen',
    name: 'Glut formen',
    text: 'Brennender Kreis um dich: Wer darin steht, erleidet jede Sekunde Schaden',
    kind: 'aura',
    cooldown: 0.5,
    damage: 5,
    range: 3.2,
    ranks: [
      { radius: 1 },
      { radius: 1.3 },
      { statuses: [{ kind: 'feeble', seconds: 0.8, power: 0.15 }] },
      { flags: ['entzuenden'] },
      { flags: ['entzuenden', 'puls'] },
      // Evolution: Ein weißglühendes Aschefeld; die Hitze wächst, je länger einer darin steht.
      {
        radius: 1.7,
        flags: ['entzuenden', 'puls', 'krone'],
        statuses: [
          { kind: 'feeble', seconds: 0.8, power: 0.15 },
          { kind: 'weak', seconds: 1.2, power: 1.2 },
        ],
      },
    ],
    evolution: {
      name: 'Krone der Erloschenen Sor',
      item: 'Zorn des Phönix',
      text: 'Der Glutkreis weitet sich zu einem weißglühenden Aschefeld. Wer darin steht, verliert seine Rüstung und leidet unter immer stärkerer Hitze; wer darin stirbt, zerfällt zu Glut und löst eine Hitzewelle aus.',
    },
    rankText: [
      'Ein dauerhafter Kreis aus glühender Asche um dich: Wer darin steht, erleidet jede Sekunde Schaden',
      'Radius +30 %, mehr Schaden je Sekunde',
      'Die aufsteigende Hitze verzerrt die Luft: Gegner im Kreis greifen 15 % langsamer an',
      'Wer länger als 2 Sekunden im Kreis steht, fängt Feuer und brennt auch außerhalb weiter',
      'Alle 4 Sekunden pulsiert der Ring: doppelter Schaden, kleine Nahkämpfer werden an den Rand gestoßen',
    ],
  },
  {
    id: 'erdstoss',
    name: 'Erdstoß',
    text: 'Druckwelle im Umkreis: Schaden und Rückstoß',
    kind: 'nova',
    look: 'erdstoss',
    cooldown: 3.8,
    damage: 18,
    range: 4.5,
    knockback: 14,
    ranks: [
      { knockback: 1 },
      { radius: 1.3, knockback: 1.4 },
      { cooldown: 0.82, statuses: [{ kind: 'slow', seconds: 2, power: 0.25 }] },
      { flags: ['welle'] },
      { flags: ['welle', 'ring'] },
      // Evolution: Drei Ringe rollen hinaus, danach liegt ein Trümmerfeld.
      { radius: 2, knockback: 1.6, flags: ['beben'], statuses: [{ kind: 'slow', seconds: 2, power: 0.25 }] },
    ],
    evolution: {
      name: 'Beben der Alten Ordnung',
      item: 'Herz des Berges',
      text: 'Eine dreistufige Ringwelle rollt über das Sichtfeld, bricht Zacken aus dem Boden und schleudert selbst Große weit zurück. Ein zerrissenes Trümmerfeld bleibt, in dem Feinde taumeln und verwundbar sind.',
    },
    rankText: [
      'Der Stab schlägt auf den Boden: eine Druckwelle um dich verletzt und stößt zurück',
      'Radius +30 %, stärkerer Rückstoß',
      'Kürzere Abklingzeit; der aufgewirbelte Staub macht Zurückgeworfene 2 Sekunden um 25 % langsamer',
      'Eine zweite, engere Welle folgt und betäubt, wer dem ersten Stoß standgehalten hat',
      'Am Rand der Welle türmt sich 2,5 Sekunden ein Ring aus gebrochener Erde auf und bremst, wer nachrückt',
    ],
  },
  {
    id: 'wurzelgriff',
    name: 'Wurzelgriff',
    text: 'Knorrige Wurzeln halten eine Gruppe von Gegnern fest',
    kind: 'root',
    cooldown: 3.8,
    damage: 4,
    range: 10,
    radius: 2.5,
    maxTargets: 5,
    ranks: [
      { statuses: [{ kind: 'hold', seconds: 1.8 }] },
      { radius: 1.3, statuses: [{ kind: 'hold', seconds: 2.2 }] },
      {
        cooldown: 0.82,
        statuses: [
          { kind: 'hold', seconds: 2.2 },
          { kind: 'bleed', seconds: 2.2, power: 3 },
        ],
      },
      {
        flags: ['trocken'],
        statuses: [
          { kind: 'hold', seconds: 2.2 },
          { kind: 'bleed', seconds: 2.2, power: 3 },
          { kind: 'weak', seconds: 2.2, power: 1.2 },
        ],
      },
      { flags: ['trocken', 'nachwuchs'] },
      // Evolution: Ein Netz aus Wurzeln in einer langen Bahn zieht Gegner in die Mitte und hält sie fest.
      {
        flags: ['trocken', 'nachwuchs', 'tiefe'],
        statuses: [
          { kind: 'hold', seconds: 2.5 },
          { kind: 'bleed', seconds: 2.5, power: 3 },
          { kind: 'weak', seconds: 2.5, power: 1.2 },
          { kind: 'blind', seconds: 2.5, power: 0.4 },
        ],
      },
    ],
    evolution: {
      name: 'Griff der Alten Tiefe',
      item: 'Zorn des Tiefwalds',
      text: 'Ein Netz aus versteinerten Wurzeln bricht in einer langen Bahn aus dem Staub, zieht Getroffene in die Mitte, hält sie 2,5 Sekunden fest und zehrt sie aus, während Staub ihnen die Sicht nimmt.',
    },
    rankText: [
      'Wurzeln brechen unter einer kleinen Gruppe hervor und halten sie 1,8 Sekunden fest',
      'Radius +30 %, sie halten 2,2 Sekunden',
      'Kürzere Abklingzeit; wer im Griff steckt, erleidet laufend leichten Schaden',
      'Gefesselte geraten in Nachteil und erleiden 20 % mehr Schaden durch Feuer und Licht: Das trockene Holz brennt mit',
      'Stirbt ein Gefesselter, schießt eine neue Wurzel zum nächsten freien Gegner und hält ihn 1,5 Sekunden',
    ],
  },
  {
    id: 'sturmboee',
    name: 'Sturmböe',
    text: 'Eine Windschneise in Blickrichtung: schneidet und drängt zurück',
    kind: 'arc',
    look: 'boee',
    cooldown: 2.2,
    // Der Schaden ist am Messlauf abgestimmt: Mit 6 kam die Böe auf rund 14 Schaden pro Sekunde und trug nichts bei; ab etwa 14 flacht der Gewinn auf Rang 5 ab.
    // Die Ränge 1 bis 5 steigen mit dem Standardanstieg (×1 bis ×2).
    damage: 14,
    range: 7,
    knockback: 16,
    ranks: [
      { arc: 0.5 },
      { flags: ['schub'] },
      { cooldown: 0.82, flags: ['schub', 'zerstreuen'] },
      { range: 1.3, arc: 0.65, statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }] },
      { flags: ['schub', 'zerstreuen', 'spur'] },
      // Evolution: Alle 2 Sekunden eine Doppel-Sturmböe; ein dauerhafter Luftstrom macht die Figur schneller. Der Schaden steigt über den Standardanstieg (×2,25) hinaus auf ×4,2.
      {
        damage: 4.2,
        cooldown: 0.91,
        arc: 0.85,
        knockback: 1.8,
        flags: ['schub', 'zerstreuen', 'spur', 'orkan'],
        statuses: [
          { kind: 'slow', seconds: 2, power: 0.2 },
          { kind: 'blind', seconds: 1.2, power: 0.4 },
        ],
      },
    ],
    evolution: {
      name: 'Orkan der Alten Ordnung',
      item: 'Zorn des Nordwinds',
      text: 'Ein dauerhafter Luftstrom macht dich schneller. Alle 2 Sekunden entlädt sich eine Doppel-Sturmböe, die Gegner weit zurückwirft, feindliche Zauber zerreibt und mit scharfem Staub blendet.',
    },
    rankText: [
      'Eine schneidende Windschneise nach vorn drängt Gegner zurück und verletzt sie',
      'Nach jeder Böe läufst du 2 Sekunden lang schneller',
      'Kürzere Abklingzeit; die Böe stört Zauberer, die sie trifft, und zerstreut ihre Zauber',
      'Breite und Reichweite +30 %; Getroffene sind 2 Sekunden um 20 % langsamer',
      'Während des Schubs ziehst du eine Staubspur hinter dir her, die Verfolger bremst und schwächt',
    ],
  },
  {
    id: 'schild',
    name: 'Schild',
    text: 'Fängt einen Treffer vollständig ab und lädt dann neu',
    kind: 'shield',
    cooldown: 10,
    damage: 0,
    range: 1.1,
    ranks: [
      { cooldown: 1, count: 1 },
      { cooldown: 0.85 },
      { count: 2 },
      { flags: ['impuls'] },
      { flags: ['impuls', 'staub'] },
      // Evolution: Drei kreisende Runen fangen je einen Treffer ab.
      { count: 3, flags: ['impuls', 'staub', 'kuppel'] },
    ],
    evolution: {
      name: 'Kuppel der Alten Ordnung',
      item: 'Das Arkane Herz',
      text: 'Drei kreisende Staub-Runen fangen je einen Treffer ab. Solange eine steht, werden feindliche Fernzauber an der Aura zu Staub zerrieben; jede zerbrechende Rune schickt eine Staub-Druckwelle in Blickrichtung.',
    },
    rankText: [
      'Eine Hülle aus Staub fängt den nächsten Treffer ganz ab und bildet sich nach 10 Sekunden neu',
      'Die Neubildung dauert 1,5 Sekunden weniger',
      'Der Schild hält zwei Treffern stand, bevor er bricht',
      'Bricht der Schild unter einem Treffer, entlädt sich ein Impuls: Nahe Angreifer sind geblendet und langsamer',
      'Fünf Tode durch deine Zauber oder zehn Treffer an einem Großen verkürzen die Neubildung spürbar',
    ],
  },
];

const BY_ID = new Map(DEFS.map((def) => [def.id, def]));
const NO_FLAGS: readonly string[] = [];

/** Die Zustände, die `hold`, `slow` und `weak` eines Angriffs ohne Tabelle anbringen. */
function legacyStatuses(def: WeaponDef): readonly StatusApply[] {
  const list: StatusApply[] = [];
  if (def.hold) list.push({ kind: 'hold', seconds: def.hold });
  if (def.slow) list.push({ kind: 'slow', seconds: def.slow });
  if (def.weak) list.push({ kind: 'weak', seconds: def.weak });
  return list;
}

/** Ein Rang nach den Einheitsregeln und den Feldern des Angriffs, ohne Tabelle. */
function ruleRank(def: WeaponDef, rank: number): ResolvedRank {
  return {
    rank,
    damage: 1 + DAMAGE_PER_RANK * (rank - 1),
    cooldown: COOLDOWN_PER_RANK ** (rank - 1),
    range: 1,
    radius: def.kind === 'aura' ? 1 + AURA_RADIUS_PER_RANK * (rank - 1) : 1,
    arc: def.arc?.(rank) ?? Math.PI,
    count: def.count?.(rank) ?? 1,
    pierce: def.pierce?.(rank) ?? 0,
    knockback: 1,
    lead: 1,
    speed: 1,
    spread: 1,
    duration: def.duration ?? 0,
    statuses: legacyStatuses(def),
    flags: NO_FLAGS,
  };
}

/** Alle Ränge eines Angriffs, von 1 bis `MAX_RANK`, mit Evolution bis `EVOLUTION_RANK`. */
function resolveAll(def: WeaponDef): readonly ResolvedRank[] {
  const table = def.ranks ?? [];
  const named: RankRule = {};
  const all: ResolvedRank[] = [];
  const top = def.evolution ? EVOLUTION_RANK : MAX_RANK;
  for (let rank = 1; rank <= top; rank++) {
    // Was ein Rang nennt, merkt sich `named` für die folgenden.
    Object.assign(named, table[rank - 1]);
    const resolved = ruleRank(def, rank);
    all.push({
      rank,
      damage: named.damage ?? resolved.damage,
      cooldown: named.cooldown ?? resolved.cooldown,
      range: named.range ?? resolved.range,
      radius: named.radius ?? resolved.radius,
      arc: named.arc ?? resolved.arc,
      count: named.count ?? resolved.count,
      pierce: named.pierce ?? resolved.pierce,
      knockback: named.knockback ?? resolved.knockback,
      lead: named.lead ?? resolved.lead,
      speed: named.speed ?? resolved.speed,
      spread: named.spread ?? resolved.spread,
      duration: named.duration ?? resolved.duration,
      statuses: named.statuses ?? resolved.statuses,
      flags: named.flags ?? resolved.flags,
    });
  }
  return all;
}

const RANKS = new Map(DEFS.map((def) => [def.id, resolveAll(def)]));

/** Die fertige Zeile eines Rangs (1 bis `MAX_RANK`, mit Evolution bis `EVOLUTION_RANK`); sie liegt vorberechnet da, im Kampf entsteht nichts. */
export function resolveRank(def: WeaponDef, rank: number): ResolvedRank {
  const all = RANKS.get(def.id) ?? resolveAll(def);
  const row = all[Math.min(Math.max(rank, 1), all.length) - 1];
  if (!row) throw new Error(`Kein Rang ${rank} für ${def.id}`);
  return row;
}

/** Hat der Rang diesen Schalter gesetzt? */
export function hasFlag(rules: ResolvedRank, flag: string): boolean {
  return rules.flags.includes(flag);
}

/** Die Sekunden, die ein Rang einen Zustand anbringt; 0, wenn er ihn nicht anbringt. */
export function statusSeconds(rules: ResolvedRank, kind: StatusApply['kind']): number {
  for (const entry of rules.statuses) if (entry.kind === kind) return entry.seconds;
  return 0;
}

export function weaponById(id: string): WeaponDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unbekannter Angriff: ${id}`);
  return def;
}

/** Die Evolution eines Angriffs, falls er eine hat. */
export function evolutionOf(id: string): EvolutionInfo | undefined {
  return BY_ID.get(id)?.evolution;
}

/** Die Angriffe einer Auswahl (etwa einer Klasse), die eine Evolution haben, in der Reihenfolge der Auswahl. */
export function evolvable(ids: readonly string[]): string[] {
  return ids.filter((id) => BY_ID.get(id)?.evolution !== undefined);
}
