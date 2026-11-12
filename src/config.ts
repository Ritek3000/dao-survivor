/** Zentrale Stellschrauben. Einheiten: Meter und Sekunden. */

/** Das GLB-Modell einer Gegnerart. */
export interface EnemyModel {
  /** Datei im Ordner public/models. Leer, solange es kein Modell gibt: Dann steht eine Kapsel da. */
  file: string;
  /** Höhe der laufenden Figur im Spiel, in Metern. Die Größe in der Datei spielt keine Rolle. */
  height: number;
  /** Name der Lauf-Animation in der Datei. Gibt es ihn nicht, gilt die erste Animation. */
  clip: string;
  /** Meter, die ein Durchlauf der Lauf-Animation überbrückt. Größer = langsamere Beine. Ohne Wirkung bei `hover`. */
  stride: number;
  /**
   * Wer schwebt, hat keine Beine, die der Strecke folgen: Seine Animation `clip` läuft dann nach der Zeit, auch wenn er
   * steht, und er hängt `lift` Meter über dem Boden (zusätzlich zu `height`).
   */
  hover?: { lift: number };
  /**
   * Name der Zauber-Animation in der Datei. Sie läuft einmal von vorn bis hinten, gedehnt auf die Sekunden des Zaubers
   * (`cast.windup`): Am Ende der Animation schlägt der Zauber ein. Fehlt sie, wirkt er in der Haltung des Gehens.
   */
  castClip?: string;
  /**
   * Name der Hieb-Animation in der Datei, falls die Art zuschlägt (`EnemyType.strike`). Sie läuft einmal in Echtzeit,
   * während der Gegner steht; ihre Länge bestimmt, wie lange der Hieb dauert. Fehlt sie in der Datei, trifft er wie jeder
   * andere Gegner durch Berühren.
   */
  strikeClip?: string;
}

/** Ein Modell für die Kulisse: Felsen, Totholz, Gestrüpp. */
export interface SceneryModel {
  /** Datei im Ordner public/models. */
  file: string;
  /** Größter Durchmesser am Boden in Metern, von bis; jede Kopie bekommt einen Wert dazwischen. */
  size: readonly [number, number];
  /** Relative Häufigkeit innerhalb seiner Gruppe. */
  weight: number;
  /**
   * Wie das Stück im Weg steht: 'rund' als Kreis, 'lang' als liegender Stamm,
   * 'flach' gar nicht (man läuft darüber).
   */
  shape: 'rund' | 'lang' | 'flach';
  /** Färbt das Modell ein, etwa um frisches Grün welk zu machen. */
  tint?: number;
}

/** Der Schwarze Sog eines Gegners: Er entzieht der Stelle, an der die Spielfigur steht, die Wärme. */
export interface EnemyCast {
  /** Näher als so (Meter) kommt er nicht heran. */
  keep: number;
  /** Aus dieser Entfernung wirkt er. */
  range: number;
  /** Sekunden zwischen zwei Zaubern. */
  cooldown: number;
  /** Sekunden von der Ankündigung am Boden bis zur Wirkung. */
  windup: number;
  /** Radius der Fläche in Metern. */
  radius: number;
  /** Schaden, der zugleich verstaubt. */
  damage: number;
}

/**
 * Der Hieb eines Nahkämpfers. Statt die Spielfigur im Vorbeigehen zu berühren, bleibt er stehen und holt aus; der Boden
 * zeigt die Fläche vor ihm an, und wer beim Treffer noch darin steht, wird verletzt. Wer ausweicht, bleibt heil.
 */
export interface EnemyStrike {
  /** Aus dieser Entfernung (Mitte zu Mitte, Meter) holt er aus; so weit reicht auch die angekündigte Fläche. */
  reach: number;
  /** Öffnungswinkel der Fläche in Radiant. */
  arc: number;
  /**
   * Sekunde der Hieb-Animation, in der die Krallen durch die Fläche fahren (siehe tools/manteltraeger-animieren.py:
   * KRALLENHIEB_TREFFER). Bis dahin ist die Fläche angekündigt.
   */
  hitAt: number;
  /** Sekunden Pause zwischen dem Ende eines Hiebs und dem nächsten. */
  cooldown: number;
}

/** Was eine Gegnerart an Münzen fallen lässt. */
export interface EnemyGold {
  /** Wahrscheinlichkeit von 0 bis 1, dass ein erschlagener Gegner eine Münze fallen lässt. */
  chance: number;
  /** Wert der Münze in Gold (vor dem Faktor der Steigerung „Kaufmannsblick“). */
  value: number;
}

export interface EnemyType {
  id: string;
  radius: number;
  /** Fehlt die Modelldatei, steht ersatzweise eine Kapsel in Größe `scale` und Farbe `color` da. */
  model: EnemyModel;
  /** Größe des Platzhalter-Körpers. */
  scale: number;
  speed: number;
  hp: number;
  damage: number;
  xp: number;
  /** Fehlt der Eintrag, fallen keine Münzen. */
  gold?: EnemyGold;
  color: number;
  /** Ab welcher Sekunde der Nacht dieser Typ auftaucht. */
  from: number;
  /** Relative Häufigkeit, sobald er auftaucht. */
  weight: number;
  /** Höchstens so viele dieser Art sind zugleich unterwegs. */
  maxAlive?: number;
  /** Wirkt aus der Ferne den Schwarzen Sog, statt die Spielfigur anzuspringen. */
  cast?: EnemyCast;
  /** Schlägt mit den Krallen zu, statt die Spielfigur durch Berühren zu verletzen. `damage` ist der Schaden des Hiebs. */
  strike?: EnemyStrike;
  /** Trägt einen Mantel der Nacht: Finsternis mit diesem Radius (Meter) zieht mit ihm. */
  mantle?: number;
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
  /** Was in der Welt herumliegt und -steht. Die Modelle sind verkleinerte Kopien im Ordner models/welt. */
  scenery: {
    /** Anzahl der Felsen in der ganzen Welt; die meisten sind klein. */
    rocks: 520,
    /** Kleinere Felsen als so (Durchmesser in Metern) überläuft man. */
    rockBlocksFrom: 1.3,
    rockModels: [
      { file: 'welt/fels-brocken.glb', size: [0.5, 2.8], weight: 3, shape: 'rund' },
      { file: 'welt/fels-haufen-rot.glb', size: [0.6, 3], weight: 2, shape: 'rund' },
      { file: 'welt/fels-mooshaufen.glb', size: [0.8, 3.2], weight: 2, shape: 'rund' },
      { file: 'welt/fels-moosblock.glb', size: [0.9, 2.6], weight: 1, shape: 'rund' },
      { file: 'welt/fels-platte-1.glb', size: [0.7, 3], weight: 2, shape: 'flach' },
      { file: 'welt/fels-platte-moos.glb', size: [0.7, 3], weight: 2, shape: 'flach' },
      { file: 'welt/fels-platte-hell.glb', size: [0.7, 2.6], weight: 2, shape: 'flach' },
      { file: 'welt/fels-geroell.glb', size: [1.2, 3], weight: 3, shape: 'flach' },
    ] as readonly SceneryModel[],
    /** Anzahl der Stücke Totholz und Gestrüpp. */
    wood: 120,
    woodModels: [
      { file: 'welt/baum-stamm-1.glb', size: [2.4, 4.4], weight: 4, shape: 'lang' },
      { file: 'welt/baum-stamm-2.glb', size: [2.6, 4.8], weight: 4, shape: 'lang' },
      { file: 'welt/baum-stumpf.glb', size: [1.6, 2.8], weight: 2, shape: 'rund' },
      // Der Laubbaum ist im Original frisch grün; die Tönung macht ihn welk und staubig.
      { file: 'welt/baum-laub.glb', size: [2, 3.4], weight: 2, shape: 'rund', tint: 0x6e6948 },
    ] as readonly SceneryModel[],
    /** Die kahlen Platzhalter-Stämme bleiben, bis es ein Modell für einen stehenden toten Baum gibt. */
    bareTrunks: 160,
    /** Dürre Grasbüschel; sie stehen in Flecken beisammen und sind nie im Weg. 0 schaltet sie ab. */
    tufts: 5200,
  },
  player: {
    speed: 5.5,
    /** Wie schnell die Zielgeschwindigkeit erreicht wird (1/s). */
    acceleration: 26,
    turnSharpness: 14,
    radius: 0.8,
    maxHp: 100,
    /** Schonfrist nach einem Treffer. */
    invulnerableSeconds: 0.5,
    pickupRadius: 3.6,
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
    /** Modell der Feuerschale und ihre Höhe in Metern. */
    model: { file: 'welt/feuerschale.glb', height: 1.25 },
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
    regenPerSecond: 4,
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
    ratePerMinute: 0.25,
    /** Sekunden, nach denen Gegner doppelt so viel aushalten. */
    hpDoubleSeconds: 450,
    types: [
      // Normal: der Schänder.
      {
        id: 'walker',
        model: { file: 'schaender.glb', height: 1.8, clip: 'Walking', stride: 1.5 },
        radius: 0.4, scale: 1, speed: 2.3, hp: 14, damage: 8, xp: 1, color: 0x6a3b35, from: 0, weight: 10,
        gold: { chance: 0.12, value: 1 },
      },
      // Schnell: der Behemoth.
      {
        id: 'runner',
        model: { file: 'behemoth.glb', height: 1, clip: 'Walking', stride: 2.2 },
        radius: 0.45, scale: 0.72, speed: 4.3, hp: 8, damage: 5, xp: 1, color: 0x7a5a2c, from: 60, weight: 4,
        gold: { chance: 0.12, value: 1 },
      },
      // Groß: der Troll.
      {
        id: 'brute',
        model: { file: 'troll.glb', height: 2.5, clip: 'Walking', stride: 2.2 },
        radius: 0.75, scale: 1.75, speed: 1.6, hp: 90, damage: 18, xp: 6, color: 0x3d2a3f, from: 180, weight: 1,
        gold: { chance: 0.6, value: 5 },
      },
      // Dhargass-Priester: hält Abstand und wirkt den Schwarzen Sog. Er schwebt und hebt zum Zaubern die Arme.
      {
        id: 'priester',
        model: {
          file: 'priester.glb',
          // Vom Saum des Gewandes bis zum Haarschopf; dazu kommen die 0,3 m, die er über dem Boden hängt.
          height: 1.7,
          clip: 'Schweben',
          stride: 0,
          hover: { lift: 0.3 },
          castClip: 'Zaubern',
        },
        radius: 0.42, scale: 1.1, speed: 2.6, hp: 30, damage: 6, xp: 4, color: 0x5563c8, from: 240, weight: 0.6,
        gold: { chance: 0.6, value: 4 },
        maxAlive: 4,
        cast: { keep: 9, range: 13, cooldown: 4.5, windup: 1.3, radius: 2.6, damage: 9 },
      },
      // Mantelträger: trägt einen Mantel der Nacht mit sich. Geduckte Bestie mit Geweih; sie bleibt vor der Spielfigur
      // stehen, holt mit der Kralle aus und reißt sie durch.
      {
        id: 'mantel',
        model: {
          file: 'manteltraeger.glb',
          // Vom Boden bis zu den Spitzen des Geweihs (gebückt, ohne es wäre er kaum 1,5 m hoch).
          height: 2.1,
          clip: 'Laufen',
          // Meter je Durchlauf (zwei Schritte): LAUF_STRECKE aus tools/manteltraeger-animieren.py (1 m in der Datei,
          // die 1,7 m hoch ist) mal 2,1 / 1,7. Stimmt der Wert nicht, rutschen die Füße.
          stride: 1.24,
          strikeClip: 'Krallenhieb',
        },
        radius: 0.5, scale: 1.25, speed: 1.9, hp: 60, damage: 18, xp: 5, color: 0x7a4f9e, from: 360, weight: 0.35,
        gold: { chance: 0.7, value: 6 },
        maxAlive: 2,
        mantle: 6,
        // Die Kralle reicht gut 1,3 m vor ihn (bei 2,1 m Größe); `reach` rechnet bis zur Mitte der Spielfigur (Radius 0,8).
        strike: { reach: 1.8, arc: 1.7, hitAt: 0.5, cooldown: 1.2 },
      },
    ] as readonly EnemyType[],
  },
  /** Der Verschlinger kommt gegen Ende der Nacht. Wer ihn erschlägt, erhält einen Segen. */
  boss: {
    name: 'Der Verschlinger',
    /** Sekunde der Nacht, in der er erscheint. */
    from: 660,
    /**
     * Als Gegner: Trefferkreis, Leben und Schritttempo. `scale` bremst nur den Rückstoß,
     * `model.height` ist seine Größe im Spiel, `model.stride` die Meter je Durchlauf des Gehens.
     */
    type: {
      id: 'verschlinger',
      model: { file: 'boss1.glb', height: 4, clip: 'Walking', stride: 3.1 },
      radius: 1.3, scale: 6, speed: 3, hp: 4500, damage: 0, xp: 0, color: 0x4a3a30, from: 0, weight: 0,
    } as EnemyType,
    /** Namen der Animationen in der Datei (ein Teil des Namens genügt). */
    clips: { walk: 'Walking', run: 'Running', idle: 'Idle', hook: 'Left_Hook', dead: 'Dead' },
    /** Sekunde im Hieb-Clip, in der die Faust vorn ist. */
    hookStrikeAt: 0.32,
    /** Erfahrung, die er fallen lässt, verteilt auf so viele Edelsteine. */
    xp: 80,
    gems: 10,
    /** Hieb: Reichweite ab seiner Mitte, Öffnungswinkel (Radiant), Sekunden des Ausholens. */
    hook: { reach: 4.6, arc: 2.2, damage: 28, windup: 0.6, cooldown: 2.6 },
    /** Ansturm: Er kündigt eine Bahn an und rennt sie entlang. */
    charge: { minDistance: 9, maxDistance: 24, speed: 13, width: 3.2, damage: 24, windup: 1, cooldown: 9, rest: 1.3 },
    /** Schwarzer Sog rund um ihn: verstaubt und löscht jede Feuerschale in der Fläche. */
    sog: { trigger: 7, radius: 8.5, damage: 18, windup: 1.6, cooldown: 11 },
    /** Das Verschlingen: Unter diesem Anteil seines Lebens hüllt er sich zeitweise in Finsternis. */
    verschlingen: { belowHp: 0.5, radius: 10, seconds: 8, cooldown: 22 },
  },
  /**
   * Gold: Münzen aus Gegnern, Sold für die überlebte Zeit und die Siegprämie. Es bezahlt zwischen den Nächten die
   * Steigerungen der Klassen (game/steigerung.ts). Was eine Gegnerart fallen lässt, steht bei ihr (`gold`).
   * Alle Beträge sind Gold vor dem Faktor der Steigerung „Kaufmannsblick“.
   */
  gold: {
    /** So viele Münzen liegen höchstens zugleich da; der Wert weiterer geht in eine vorhandene Münze. */
    maxCoins: 160,
    /**
     * Aussehen der Münze: Durchmesser in Metern und Farbe je Stufe, nach Kupferpfennig, Silbermark und Goldkrone der Lore.
     * Abweichung von der Lore: Im Spiel gilt 1 zu 5 zu 25 statt 1 zu 100 zu 10 000; sonst gäbe es keine Goldkronen zu sehen.
     */
    coin: {
      size: 0.56,
      colors: { copper: 0xeb9b5c, silver: 0xd3d8e0, gold: 0xffc83d },
      silverFrom: 5,
      goldFrom: 25,
    },
    /** Der Verschlinger lässt beim Sturz einen Kranz von Münzen fallen: Anzahl und Wert je Münze. */
    boss: { coins: 8, value: 12 },
    /** Sold je volle Minute, die man überlebt hat; er wird am Ende der Nacht gutgeschrieben. */
    perMinute: 3,
    /** Prämie, wenn die Sonne aufgeht. */
    victory: 60,
    /** Anteil des Ertrags, den man behält, wenn man fällt. 1 = alles, 0,5 = die Hälfte. */
    deathKeep: 1,
    /** Jeder weitere Rang einer Steigerung kostet so viel mal mehr als der vorige. */
    upgradeGrowth: 1.2,
  },
  /**
   * Ton und Musik. Welche Datei zu welchem Ereignis klingt, steht nicht hier, sondern in
   * public/audio/audio.json; hier stehen nur die Regeln der Abmischung. Einheiten: Meter und Sekunden.
   */
  audio: {
    /** Ordner mit den Klängen und der Zuordnungsliste, unterhalb von public. */
    folder: 'audio/',
    manifest: 'audio.json',
    /** Startwerte der Regler von 0 bis 1, bis der Spieler sie verstellt. */
    defaults: { master: 0.8, effects: 0.9, music: 0.7 },
    /** So viele Töne klingen höchstens zugleich; ein wichtigerer verdrängt dafür einen unwichtigeren. */
    voices: 24,
    /** Töne mit Ort sind bis `near` voll zu hören und ab `range` stumm; je Ereignis in audio.json änderbar. */
    range: 30,
    near: 3,
    /** Seitlicher Abstand, ab dem ein Ton ganz auf einer Seite liegt. */
    panWidth: 14,
    /**
     * Die Finsternis dämpft jeden Laut (finsternis.md): Mitten in ihr sinkt die Grenzfrequenz auf `cutoff` (Hz),
     * die Lautstärke auf den Anteil `gain`, und die Reichweite schrumpft um den Anteil `range`.
     * `distance`: so viel Dumpfheit kommt am Rand der Reichweite durch die Luft dazu.
     */
    muffle: { cutoff: 380, gain: 0.45, range: 0.5, distance: 0.3 },
    music: {
      /** Sekunden der Überblendung zwischen zwei Stücken. */
      fade: 2.5,
      /** Anteil der Musiklautstärke in der Pause und bei der Wahl einer Stärkung; in der Pause auch dumpfer. */
      pausedGain: 0.3,
      choiceGain: 0.55,
      pausedCutoff: 650,
      /** Ab dieser Sekunde der Nacht spielt die dichtere Fassung der Nachtmusik. */
      lateFrom: 480,
    },
    /** Gegner rufen ab und zu; je mehr unterwegs sind, desto öfter. Nur Gegner in `range` Metern werden gehört. */
    horde: { callEvery: { min: 1.6, max: 3.6 }, range: 18, busy: 80 },
  },
  // Angriffe stehen in game/weapons.ts, Klassen und ihre Besonderheiten in game/classes.ts.
  xp: {
    /** Bedarf für die nächste Stufe: base + linear * Stufe + quadratic * Stufe². */
    base: 5,
    linear: 4,
    quadratic: 0.6,
    maxGems: 500,
    /** Edelsteine für kleine und große Erfahrung: Datei und Höhe in Metern. */
    gems: {
      small: { file: 'welt/gem-klein.glb', height: 0.34 },
      large: { file: 'welt/gem-gross.glb', height: 0.62 },
      /** Ab so viel Erfahrung liegt der große Edelstein da. */
      largeFrom: 5,
    },
  },
} as const;
