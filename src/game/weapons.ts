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

export const MAX_RANK = 5;
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
    rankText: [
      'Schwerer Pfeil auf den nächsten Gegner, stößt kleine Gegner leicht zurück',
      'Der Pfeil durchbohrt das erste Ziel und trifft einen zweiten dahinter, mit weniger Schaden',
      'Kürzere Nachladezeit; Getroffene sind 1,5 Sekunden um 15 % langsamer',
      'Zwei Pfeile dicht nebeneinander; gegen Gegner im Nachteil, verlangsamt oder blutend sind sie leichter kritisch (Vorteil)',
      'Mehr Reichweite und Pfeiltempo; der erste Getroffene erleidet 3 Sekunden lang 15 % mehr Schaden',
    ],
  },
  {
    // Der Schaden ist der Treffer der ganzen Salve; `count` sind die Pfeile (nur für das Bild), sie bestimmen den Faktor auf den Schaden.
    id: 'pfeilhagel',
    name: 'Pfeilhagel',
    text: 'Eine Salve Pfeile regnet auf eine Gruppe von Gegnern',
    kind: 'volley',
    cooldown: 4.5,
    damage: 16,
    range: 13,
    radius: 3,
    delay: 0.6,
    ranks: [
      { damage: 1, count: 6 },
      { damage: 1.5, count: 9, radius: 1.2 },
      { statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }] },
      { cooldown: 3.7 / 4.5, statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }, { kind: 'bleed', seconds: 3, power: 3 }] },
      { flags: ['folgen', 'mitte'] },
    ],
    rankText: [
      'Eine Salve von 6 Pfeilen schlägt nach kurzer Verzögerung auf eine Gruppe ein',
      '9 Pfeile je Salve, Radius +20 %',
      'Der aufgewirbelte Boden verlangsamt Gegner im Zielgebiet 2 Sekunden um 20 %',
      'Kürzere Abklingzeit; Getroffene bluten 3 Sekunden lang',
      'Die Salve folgt der Gruppe leicht; im Zentrum erleiden Gegner 25 % mehr Schaden',
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
    ],
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
    ],
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
    ],
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
    text: 'Ein klapperndes Gestell verlangsamt und verwirrt Gegner in der Nähe',
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
    ],
    rankText: [
      'Rammt ein Gestell in den Boden: Gegner in der Nähe sind 20 % langsamer und greifen langsamer an',
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
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
    ],
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
    damage: 6,
    range: 7,
    knockback: 16,
    ranks: [
      { arc: 0.5 },
      { flags: ['schub'] },
      { cooldown: 0.82, flags: ['schub', 'zerstreuen'] },
      { range: 1.3, arc: 0.65, statuses: [{ kind: 'slow', seconds: 2, power: 0.2 }] },
      { flags: ['schub', 'zerstreuen', 'spur'] },
    ],
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
    ],
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

/** Alle Ränge eines Angriffs, von 1 bis `MAX_RANK`. */
function resolveAll(def: WeaponDef): readonly ResolvedRank[] {
  const table = def.ranks ?? [];
  const named: RankRule = {};
  const all: ResolvedRank[] = [];
  for (let rank = 1; rank <= MAX_RANK; rank++) {
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

/** Die fertige Zeile eines Rangs (1 bis `MAX_RANK`) eines Angriffs; sie liegt vorberechnet da, im Kampf entsteht nichts. */
export function resolveRank(def: WeaponDef, rank: number): ResolvedRank {
  const all = RANKS.get(def.id) ?? resolveAll(def);
  const row = all[Math.min(Math.max(rank, 1), MAX_RANK) - 1];
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
