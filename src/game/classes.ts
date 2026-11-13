/**
 * Die drei Klassen. Jede hat eine Heimat im Verhältnis zum Licht:
 * der Kämpfer im Licht, der Wildnisläufer am Rand der Finsternis, der Magier in ihr.
 */

import type { GearDef } from './gear';

export type ClassId = 'kaempfer' | 'wildnislaeufer' | 'magier';

/** Ein Abschnitt einer Animation aus der GLB-Datei. */
export interface ClipSpan {
  /** Name des Clips oder ein Teil davon; Groß- und Kleinschreibung ist egal. */
  clip: string;
  /** Anfang und Ende im Clip, in Sekunden. */
  from: number;
  to: number;
}

/** Wie die Figur einen Angriff ausführt: Sie holt aus, der Treffer fällt, sie schwingt aus. */
export interface SwingDef {
  /** Das Ausholen; es endet in dem Augenblick, in dem der Angriff wirkt. */
  windup: ClipSpan;
  /** Das Ausschwingen nach dem Treffer. */
  follow: ClipSpan;
  /** Sekunden im Spiel für das Ausholen. Die Clips sind dafür meist zu lang und laufen schneller. */
  lead: number;
  /** Sekunden im Spiel für das Ausschwingen. */
  recover: number;
  /** 'upper': Die Beine laufen weiter. 'full': Die ganze Figur führt den Angriff aus, etwa einen Sprung. */
  body: 'upper' | 'full';
  /** Um diesen Winkel steht die Figur beim Angriff zum Ziel verdreht; ein Schütze steht seitlich. */
  turn?: number;
  /** Stelle im Clip des Ausholens, ab der ein Pfeil auf der Sehne liegt. */
  nock?: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Spielgefühl in einem Satz, für die Auswahlkarte. */
  text: string;
  /** Wo die Klasse stark ist und was es sie kostet. */
  home: string;
  /** Faktoren auf die Grundwerte aus der Konfiguration. */
  hpFactor: number;
  speedFactor: number;
  lightRadiusFactor: number;
  verstaubungFactor: number;
  lightColor: number;
  /** Der Magier trägt keine Fackel, sondern ein Kerzenwort: eine kalt leuchtende Staubwolke am Boden. */
  light: 'fackel' | 'kerzenwort';
  bodyColor: number;
  /** GLB-Modell: Datei im Ordner public/models und Höhe der stehenden Figur im Spiel, in Metern. */
  model: { file: string; height: number };
  /**
   * Was die Figur in der Hand hält. Die drei Angaben zum Sitz in der Hand sind am Modell
   * ausgemessen; nach einem neuen Export mit anderem Skelett müssen sie neu bestimmt werden.
   */
  gear: GearDef;
  /** Was die andere Hand hält, etwa der Schild des Kämpfers; er greift nicht ein, sondern schmückt die Figur. */
  offhand?: GearDef;
  /** Der erste Eintrag ist der Startangriff, die übrigen kommen beim Stufenaufstieg dazu. */
  weapons: readonly string[];
  /** Welche Animation zu welchem Angriff gehört. Angriffe ohne Eintrag wirken ohne Bewegung der Figur. */
  swings: Readonly<Record<string, SwingDef>>;
}

const SLASH = 'Charged_Slash';
const SPIN = 'Axe_Spin_Attack';
const DRAW = 'Archery_Shot_1';
const LOOSE = 'Archery_Shot_3';
const CAST = 'cast';

/**
 * Der Kämpfer reißt die Axt von der linken Hüfte nach rechts durch. Im Spiel gemessen
 * (nur der Oberkörper folgt dem Clip) fährt der Axtkopf bei 1,25 s genau auf das Ziel zu.
 */
const AXE_SWING: SwingDef = {
  windup: { clip: SLASH, from: 1.02, to: 1.25 },
  follow: { clip: SLASH, from: 1.25, to: 1.62 },
  lead: 0.16,
  recover: 0.3,
  body: 'upper',
};

/** Pfeil aus dem Köcher, auflegen, spannen; dann lösen und den Bogen senken. */
const BOW_SHOT: SwingDef = {
  windup: { clip: DRAW, from: 0.3, to: 1 },
  follow: { clip: LOOSE, from: 0, to: 0.5 },
  lead: 0.3,
  recover: 0.24,
  body: 'upper',
  // Am gespannten Bogen gemessen: So gedreht zeigt der Pfeil genau auf das Ziel.
  turn: -1.3,
  nock: 0.62,
};

/** Die rechte Hand fährt nach oben; bei 0,78 s ist die Geste vollendet. */
const QUICK_CAST: SwingDef = {
  windup: { clip: CAST, from: 0.42, to: 0.78 },
  follow: { clip: CAST, from: 0.78, to: 1.45 },
  lead: 0.2,
  recover: 0.35,
  body: 'upper',
};
const GREAT_CAST: SwingDef = {
  ...QUICK_CAST,
  windup: { clip: CAST, from: 0.15, to: 0.78 },
  lead: 0.38,
  recover: 0.45,
};

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'kaempfer',
    name: 'Kämpfer',
    text: 'Zäh und mitten im Getümmel.',
    home: 'Im Licht einer Feuerschale schlägt er härter und steckt mehr ein. Erlischt das Feuer, ist er kurz geschwächt.',
    hpFactor: 1.2,
    speedFactor: 1,
    lightRadiusFactor: 1,
    verstaubungFactor: 0.75,
    lightColor: 0xffa25a,
    light: 'fackel',
    bodyColor: 0x6f757d,
    model: { file: 'kaempfer.glb', height: 1.4 },
    gear: {
      kind: 'axt',
      hand: 'rechts',
      size: 0.7,
      // Hammergriff: der Kopf an der Daumenseite, die Schneide in Richtung der Knöchel.
      offset: [0.055, 0.085, -0.05],
      along: [0.16, 0.42, 0.89],
      toward: [0.72, 0.57, -0.4],
    },
    // Rundschild in der linken Hand, die Außenseite nach links. Er ist um 20 Grad nach oben geneigt: So fängt die Fläche das
    // Licht der Fackel über dem Kopf, und der Unterarm ragt nicht durch das Brett. Griffpunkt und Richtungen sind im Leerlauf
    // der Figur ausgemessen und gelten im Raum des linken Handknochens (`handL`); nach einem neuen Export des Modells
    // müssen sie neu bestimmt werden.
    offhand: {
      kind: 'schild',
      hand: 'links',
      size: 0.56,
      model: 'ausruestung/schild.glb',
      offset: [-0.088, 0.129, -0.157],
      along: [0.601, -0.516, 0.61],
      toward: [-0.036, -0.78, -0.625],
      // Im Lauf schwenkt die Hand weit; der Schild bleibt dabei an der linken Seite der Figur und fährt nicht in den Körper.
      steady: { weight: 0.9, along: [-0.342, 0.94, 0], toward: [0.94, 0.342, 0], minSide: 0.4 },
    },
    weapons: ['axthieb', 'wirbelschlag', 'wuchthieb', 'kriegsschrei', 'wurfaxt'],
    swings: {
      axthieb: AXE_SWING,
      // Dieselbe Bewegung, aber mit dem ganzen Anlauf: Er zieht die Axt erst weit nach links zurück.
      wuchthieb: { ...AXE_SWING, windup: { clip: SLASH, from: 0.3, to: 1.25 }, lead: 0.5, recover: 0.4 },
      // Sprung mit Drehung, die Axt fährt bei 1,02 s vor ihm in den Boden.
      wirbelschlag: {
        windup: { clip: SPIN, from: 0.2, to: 1.02 },
        follow: { clip: SPIN, from: 1.02, to: 1.6 },
        lead: 0.45,
        recover: 0.4,
        body: 'full',
      },
      wurfaxt: AXE_SWING,
    },
  },
  {
    id: 'wildnislaeufer',
    name: 'Wildnisläufer',
    text: 'Schnell und auf Abstand bedacht.',
    home: 'Er spürt Gegner in der Finsternis und trifft sie dort härter. Dafür trägt er das kleinste Licht und hält wenig aus.',
    hpFactor: 0.85,
    speedFactor: 1.12,
    lightRadiusFactor: 0.78,
    verstaubungFactor: 1,
    lightColor: 0xffa25a,
    light: 'fackel',
    bodyColor: 0x5c6b47,
    model: { file: 'wildnislaeufer.glb', height: 1.8 },
    gear: {
      kind: 'bogen',
      hand: 'links',
      size: 1.3,
      offset: [0, 0.09, 0],
      along: [-0.538, -0.068, 0.84],
      toward: [-0.225, 0.95, -0.216],
    },
    weapons: ['bogenschuss', 'pfeilhagel', 'fangeisen', 'wurfmesser'],
    swings: {
      bogenschuss: BOW_SHOT,
      pfeilhagel: { ...BOW_SHOT, windup: { clip: DRAW, from: 0.15, to: 1 }, lead: 0.42 },
    },
  },
  {
    id: 'magier',
    name: 'Magier',
    text: 'Zerbrechlich, mit großer Flächenwirkung.',
    home: 'In der Finsternis liegt mehr Staub, dort zaubert er schneller. Sie verstaubt auch ihn, aber langsamer als andere.',
    hpFactor: 0.7,
    speedFactor: 1,
    lightRadiusFactor: 1,
    verstaubungFactor: 0.6,
    lightColor: 0xcfdcff,
    light: 'kerzenwort',
    bodyColor: 0x4b4a6e,
    model: { file: 'magier.glb', height: 1.25 },
    // Ein Zauberbuch als Fokus; die linke Hand hält es beim Zaubern aufgeschlagen vor den Körper.
    gear: {
      kind: 'buch',
      hand: 'links',
      size: 0.2,
      offset: [-0.014, 0.058, 0.008],
      along: [-0.691, -0.611, 0.386],
      toward: [-0.361, 0.754, 0.548],
    },
    weapons: [
      'hitze-werfen',
      'sorlanze',
      'glut-formen',
      'erdstoss',
      'wurzelgriff',
      'sturmboee',
      'sorhennas-brand',
      'schild',
    ],
    swings: {
      'hitze-werfen': QUICK_CAST,
      sorlanze: QUICK_CAST,
      wurzelgriff: QUICK_CAST,
      erdstoss: GREAT_CAST,
      sturmboee: GREAT_CAST,
      'sorhennas-brand': GREAT_CAST,
    },
  },
];

/** Stellschrauben der Besonderheiten. */
export const TRAITS = {
  kaempfer: {
    /** Schaden im Licht. */
    lightDamage: 1.35,
    /** Erlittener Schaden im Licht. */
    lightTaken: 0.6,
    /** Seine Feuer brennen länger. */
    burnFactor: 1.5,
    /** Schwäche, nachdem das Feuer erloschen ist, in dem er stand. */
    weakSeconds: 3,
    weakDamage: 0.75,
    weakTaken: 1.3,
  },
  wildnislaeufer: {
    /** Schaden gegen Gegner, die in der Finsternis stehen. */
    finsternisDamage: 1.5,
  },
  magier: {
    /** Mitten in der Finsternis laufen Abklingzeiten um diesen Anteil schneller ab. */
    finsternisHaste: 0.7,
  },
} as const;
