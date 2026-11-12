/** Zentrale Stellschrauben. Einheiten: Meter und Sekunden. */

export interface EnemyType {
  id: string;
  radius: number;
  /** Größe des Platzhalter-Körpers. */
  scale: number;
  speed: number;
  hp: number;
  damage: number;
  xp: number;
  color: number;
  /** Ab welcher Sekunde der Nacht dieser Typ auftaucht. */
  from: number;
  /** Relative Häufigkeit, sobald er auftaucht. */
  weight: number;
}

export const CONFIG = {
  run: {
    /** Dauer einer Nacht von der Abendglocke bis zum Sonnenaufgang. */
    nightSeconds: 900,
    /** So lange vor Sonnenaufgang beginnt es zu dämmern. */
    dawnSeconds: 30,
  },
  world: {
    /** Begehbarer Bereich; die Steinmale stehen an seinem Rand. */
    radius: 90,
    /** Freie Fläche um den Startpunkt. */
    spawnClearing: 7,
    seed: 20261110,
  },
  player: {
    speed: 5.5,
    /** Wie schnell die Zielgeschwindigkeit erreicht wird (1/s). */
    acceleration: 16,
    turnSharpness: 14,
    radius: 0.4,
    maxHp: 100,
    /** Schonfrist nach einem Treffer. */
    invulnerableSeconds: 0.5,
    pickupRadius: 2.6,
  },
  camera: {
    fov: 42,
    offset: { x: 0, y: 18, z: 12 },
    followSharpness: 7,
  },
  torch: {
    color: 0xffa25a,
    intensity: 30,
    /** Reichweite des Lichtscheins. */
    radius: 14,
    /** Flacher als physikalisch korrekt (2), damit der Schein nicht nur die Füße erhellt. */
    decay: 1.2,
    shadows: true,
    shadowMapSize: 1024,
    /** Unter 1 bleiben Schatten durchscheinend, damit viele Gegner den Boden nicht schwärzen. */
    shadowIntensity: 0.75,
  },
  /** Schwaches Gegenlicht von der Kameraseite, damit Figuren nicht zu Scherenschnitten werden. */
  fill: {
    color: 0xc9b8a0,
    intensity: 45,
    radius: 30,
  },
  /** Lichtinseln: Feuerschalen, die man entzündet. */
  islands: {
    count: 16,
    /** Mindestabstand zwischen zwei Feuerschalen. */
    spacing: 26,
    /** Eine Schale steht in dieser Entfernung vom Start. */
    firstDistance: 11,
    /** Radius des schützenden Lichtkreises. */
    radius: 6.5,
    /** So nah muss man an der Schale stehen, um sie zu entzünden. */
    igniteDistance: 2.2,
    igniteSeconds: 1.2,
    burnSeconds: 45,
    /** Pause nach dem Ausbrennen, bevor sie wieder entzündet werden kann. */
    spentSeconds: 20,
    lightIntensity: 42,
    lightRadius: 15,
    /** Heilung je Sekunde bei der Rast im Licht. */
    regenPerSecond: 2.5,
  },
  /** Wandernde Schwaden der Finsternis. */
  finsternis: {
    clouds: 7,
    minRadius: 9,
    maxRadius: 15,
    /** Breite des Übergangs am Rand einer Schwade. */
    edge: 3,
    speed: 1.4,
    turnSeconds: { min: 8, max: 20 },
    /** Anteil der Richtungswechsel, die auf die Spielfigur zielen. */
    huntChance: 0.35,
    /** Mindestabstand der Schwaden zum Startpunkt bei Beginn der Nacht. */
    startDistance: 30,
  },
  verstaubung: {
    /** Zuwachs je Sekunde mitten in der Finsternis. */
    gainPerSecond: 6,
    /** Abbau je Sekunde in einer Lichtinsel. */
    clearPerSecond: 5,
  },
  enemies: {
    max: 350,
    spawnRing: { min: 23, max: 29 },
    /** Wer weiter weg gerät, wird an den Rand des Sichtfelds zurückgesetzt. */
    recycleDistance: 42,
    baseRate: 0.9,
    ratePerMinute: 0.4,
    /** Sekunden, nach denen Gegner doppelt so viel aushalten. */
    hpDoubleSeconds: 300,
    types: [
      { id: 'walker', radius: 0.4, scale: 1, speed: 2.3, hp: 14, damage: 8, xp: 1, color: 0x6a3b35, from: 0, weight: 10 },
      { id: 'runner', radius: 0.3, scale: 0.72, speed: 4.3, hp: 8, damage: 5, xp: 1, color: 0x7a5a2c, from: 60, weight: 4 },
      { id: 'brute', radius: 0.75, scale: 1.75, speed: 1.6, hp: 90, damage: 18, xp: 6, color: 0x3d2a3f, from: 180, weight: 1 },
    ] as readonly EnemyType[],
  },
  sword: {
    damage: 12,
    cooldown: 0.85,
    range: 2.9,
    /** Öffnungswinkel des Hiebs in Radiant. */
    arc: 2.5,
    knockback: 6,
  },
  xp: {
    /** Bedarf für die nächste Stufe: base + linear * Stufe + quadratic * Stufe². */
    base: 5,
    linear: 4,
    quadratic: 0.6,
    maxGems: 500,
  },
} as const;
