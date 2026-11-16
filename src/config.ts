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
  /** Wert der Münze in Gold (vor dem Goldfaktor der Figur, den Gegenstände geben). */
  value: number;
}

/** Was eine Gegnerart an Gegenständen fallen lässt (`game/beute.ts`). */
export interface EnemyLoot {
  /** Wahrscheinlichkeit von 0 bis 1, dass ein erschlagener Gegner einen Gegenstand fallen lässt (0,008 = 0,8 %). */
  chance: number;
  /** Welche Verteilung der Seltenheiten gilt: eine Zeile aus `CONFIG.loot.rarity`. */
  tier: 'schwach' | 'stark';
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
  /** Fehlt der Eintrag, fallen keine Gegenstände. */
  loot?: EnemyLoot;
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
    /** Rüstung nimmt von einem Treffer höchstens so viel ab, dass dieser Anteil übrig bleibt (1 Schaden ist die Untergrenze). */
    minDamageShare: 0.25,
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
        loot: { chance: 0.0008, tier: 'schwach' },
      },
      // Schnell: der Behemoth.
      {
        id: 'runner',
        model: { file: 'behemoth.glb', height: 1, clip: 'Walking', stride: 2.2 },
        radius: 0.45, scale: 0.72, speed: 4.3, hp: 8, damage: 5, xp: 1, color: 0x7a5a2c, from: 60, weight: 4,
        gold: { chance: 0.12, value: 1 },
        loot: { chance: 0.0008, tier: 'schwach' },
      },
      // Groß: der Troll.
      {
        id: 'brute',
        model: { file: 'troll.glb', height: 2.5, clip: 'Walking', stride: 2.2 },
        radius: 0.75, scale: 1.75, speed: 1.6, hp: 90, damage: 18, xp: 6, color: 0x3d2a3f, from: 180, weight: 1,
        gold: { chance: 0.6, value: 5 },
        loot: { chance: 0.008, tier: 'stark' },
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
        loot: { chance: 0.012, tier: 'stark' },
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
        loot: { chance: 0.02, tier: 'stark' },
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
    /** Auf diesen Anteil seines Tempos lässt er sich höchstens bremsen, wie stark die Verlangsamung auch ist. Festhalten lässt er sich nicht. */
    slowFloor: 0.7,
  },
  /**
   * Gold: Münzen aus Gegnern, Sold für die überlebte Zeit und die Siegprämie. Es bezahlt zwischen den Nächten beim Händler
   * Gegenstände und Reiter der Truhe (game/ausruestung.ts). Was eine Gegnerart fallen lässt, steht bei ihr (`gold`).
   * Alle Beträge sind Gold vor dem Goldfaktor der Figur (Eigenschaft „Gold“ der Gegenstände).
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
  /**
   * Gegenstände (`items.ts`): die Wertebereiche je Eigenschaft, in der Einheit der Anzeige (Prozent, Punkte, Leben).
   * `min` und `max` gelten für einen gewöhnlichen Platz, `core` hebt sie auf dem Kernplatz einer Eigenschaft um einen Faktor an.
   * `step` ist die Rundung des Wurfs. `cap` begrenzt die Summe über alle angelegten Gegenstände: ein Netz unter dem Gleichgewicht,
   * falls sich später Ausreißer häufen. Die Grenzen sind aus den früheren Steigerungen (bis Fassung 5 des Spielstands) abgeleitet: Eine Eigenschaft kostet auf
   * einem Gegenstand etwa zwei bis drei alte Ränge, und alle Plätze zusammen kommen auf den Höchstwert der Steigerung.
   */
  items: {
    /** Plätze im Inventar einer Figur. */
    inventorySize: 25,
    /**
     * Preis eines Gegenstands (`itemValue`): die Basis der Seltenheit mal (0,75 + 0,5 × Güte des Wurfs), die Güte von 0 bis 1.
     * Der Händler verkauft zu diesem Preis und kauft für ein Viertel davon (`sellShare`); das Verhältnis 4 zu 1 verhindert eine
     * Schleife aus Kaufen und Verkaufen. Wer das Inventar voll hat, verkauft so, was nicht mehr hineinpasst.
     */
    price: { normal: 100, selten: 400, rar: 1600, legendaer: 6400, sellShare: 0.25 },
    /**
     * Die Truhe: eine für alle Klassen, in Reitern. Der erste Reiter ist von Anfang an da; die ersten `freeTabs` Reiter kosten
     * nichts, jeder weitere `tabPrice` Gold mal seiner Nummer über dieser Zahl (der sechste 500, der siebte 1.000, …). Mit
     * `tabPrice: 0` sind alle Reiter gratis. `colors` sind die acht Farben, mit denen sich ein Reiter markieren lässt.
     */
    truhe: {
      tabSize: 25,
      maxTabs: 16,
      freeTabs: 5,
      tabPrice: 500,
      nameLength: 16,
      colors: ['#d4604f', '#e0954a', '#d6c25a', '#8fc98a', '#5cc0b8', '#6f9be0', '#a47fd6', '#d67fb0'],
    },
    /**
     * Der Händler (`game/haendler.ts`). Sein Angebot hat `size` Plätze; je Platz fällt Legendäres (ein Ring der Klasse eines
     * zufälligen Gegenstands) mit `chances.legendaer`, sonst Rar mit `chances.rar` (höchstens einmal je Angebot), sonst Selten
     * mit `chances.selten`, sonst Normal. Gewürfelt wird, wenn man ihn nach einer gespielten Nacht wieder ansieht. Der Rückkauf
     * merkt sich die letzten `buybackSize` verkauften Gegenstände; zurückkaufen kostet, was der Verkauf eingebracht hat.
     * Das Angebot erneuern: das erste Mal je Nacht gratis, dann `rerollPrice` Gold, und jedes weitere Mal das Doppelte.
     * Ein Lauf, den man vor `minNightSeconds` abbricht, zählt nicht als gespielte Nacht (sonst gäbe es das Angebot gratis neu).
     * Die Preise der Gegenstände stehen unter `price`.
     */
    shop: {
      size: 10,
      buybackSize: 10,
      chances: { selten: 0.3, rar: 0.08, legendaer: 0.001 },
      rerollPrice: 25,
      minNightSeconds: 60,
    },
    properties: {
      schaden: { min: 6, max: 14, step: 1, cap: 50, core: { waffe: 1.5 } },
      tempo: { min: 3, max: 10, step: 1, cap: 30, core: {} },
      kritChance: { min: 2, max: 6, step: 1, cap: 18, core: {} },
      kritSchaden: { min: 8, max: 20, step: 1, cap: 60, core: {} },
      reichweite: { min: 4, max: 12, step: 1, cap: 24, core: {} },
      leben: { min: 5, max: 13, step: 1, cap: 72, core: { brust: 1.5 } },
      ruestung: { min: 0.4, max: 0.8, step: 0.1, cap: 3.6, core: { brust: 1.5 } },
      staub: { min: 3, max: 8, step: 1, cap: 32, core: {} },
      schonfrist: { min: 3, max: 8, step: 1, cap: 32, core: {} },
      rastheilung: { min: 5, max: 12, step: 1, cap: 48, core: {} },
      lauftempo: { min: 2, max: 5, step: 1, cap: 20, core: { schuh: 2 } },
      sammelradius: { min: 6, max: 14, step: 1, cap: 63, core: { handschuh: 1.5 } },
      erfahrung: { min: 5, max: 13, step: 1, cap: 39, core: {} },
      gold: { min: 5, max: 15, step: 1, cap: 45, core: {} },
      licht: { min: 2, max: 6, step: 1, cap: 21, core: { fackel: 1.5 } },
      brenndauer: { min: 10, max: 30, step: 1, cap: 30, core: {} },
      zuendtempo: { min: 10, max: 30, step: 1, cap: 30, core: {} },
    },
  },
  /**
   * Beute (`game/beute.ts`, `game/drops.ts`): Was fällt, wie selten und wie es zur Figur kommt. Die Chance je Gegner steht bei der
   * Gegnerart (`loot`); gerechnet sind es bei einer vollen Nacht (900 s) im Schnitt 4 bis 5 Gegenstände, nach acht Minuten 1 bis 2.
   * Dazu kommt die Kiste des Verschlingers mit drei Gegenständen.
   */
  loot: {
    /**
     * Gewichte der Seltenheiten in Prozent je Quelle (die Summe muss nicht 100 sein). Starke Gegner würfeln bessere Gegenstände;
     * die Kiste hat kein Normal, damit sie sich lohnt. Legendäres gibt es nur als Ring der gespielten Klasse (`LEGENDARY_SLOTS`).
     */
    rarity: {
      schwach: { normal: 72, selten: 22, rar: 5.5, legendaer: 0.5 },
      stark: { normal: 55, selten: 30, rar: 13.5, legendaer: 1.5 },
      kiste: { normal: 0, selten: 45, rar: 42, legendaer: 13 },
    },
    chest: {
      /** Gegenstände in der Kiste des Verschlingers. */
      items: 3,
      /**
       * Pech-Schutz: Jede Kiste ohne Legendäres hebt die Chance auf Legendäres in der nächsten um so viele Prozentpunkte je Gegenstand
       * (zu Lasten von Selten); nach einem Legendären fällt sie auf den Wert in `rarity.kiste` zurück. Der Zähler liegt im Spielstand.
       */
      pityStep: 5,
      /** Sekunden vom Sturz des Verschlingers bis die Kiste offen ist, und Sekunden zwischen zwei Gegenständen, die herausspringen. */
      openSeconds: 1.1,
      spillSeconds: 0.28,
      /** Größe der Platzhalter-Kiste (Breite) in Metern; ein Modell gibt es noch nicht. */
      size: 1.5,
    },
    /** Gegenstände am Boden: Sie liegen kurz da und fliegen dann der Figur zu, wo sie auch sei. */
    drop: {
      /** So viele liegen höchstens zugleich da; weitere gehen sofort in den Beutel. */
      max: 24,
      /** Sekunden, die ein Gegenstand liegt, ehe er fliegt: Der Lichtstrahl zeigt in der Zeit, was gefallen ist. */
      wait: 1.3,
      /** Anfangstempo (m/s) und Beschleunigung (m/s²) im Flug. */
      speed: 6,
      accel: 34,
      /** Größe des Steins in Metern, Höhe und Radius des Lichtstrahls. */
      size: 0.42,
      beamHeight: 9,
      beamRadius: 0.14,
    },
    /** Farbe je Seltenheit für Stein und Strahl (wie in style.css die Rahmen der Gegenstände). */
    colors: { normal: 0xb9b3a5, selten: 0x6fa8e8, rar: 0xe6c04a, legendaer: 0xff8a3d },
  },
  /**
   * Der Unterbau der Fertigkeiten (game/status.ts, fields.ts, buffs.ts, events.ts): Zustände der Gegner, Bodenfelder und zeitweilige
   * Werte der Figur. Die Fertigkeiten der Klassen füllen ihn mit Zahlen; hier stehen nur die Grundwerte, die jeder Zustand ohne Angabe hat.
   */
  skills: {
    status: {
      /** Verlangsamung ohne eigene Angabe: So viel vom Tempo fällt weg (0,5 = halbes Tempo). */
      slowPower: 0.5,
      /** Nachteil ohne eigene Angabe: Faktor auf den Schaden, den der Gegner erleidet. */
      weakFactor: 1.3,
      /** Blendung: So viel von ihrem Schaden richten Geblendete nicht an. */
      blindPower: 0.5,
      /** Schwäche ohne eigene Angabe: So viel von Schaden und Angriffstempo fällt weg. */
      feeblePower: 0.3,
      /** Schaden je Sekunde ohne eigene Angabe für Blutung und Brennen. */
      dotPower: 4,
      /** Markierung ohne eigene Angabe: So viel Kritchance kommt gegen Markierte dazu (1 = jeder Treffer kritisch). */
      markPower: 0.25,
    },
    /** So viele Bodenfelder liegen höchstens zugleich da; ein weiteres ersetzt das älteste. */
    maxFields: 24,
    /** So viele zeitweilige Werte der Figur gibt es höchstens zugleich. */
    maxBuffs: 16,
    /**
     * Die Fertigkeiten des Kämpfers (Vorlage: „Klassen, Fertigkeiten & Evolutionen“). Was je Rang gilt, steht als Tabelle bei den
     * Angriffen in `weapons.ts`; hier stehen die Zahlen, die für alle Ränge gleich sind und die man beim Abgleichen anfasst.
     */
    kaempfer: {
      /** Axthieb, Rang 2: Wer auf einen Gegner zuläuft, trifft ihn mit diesem Faktor härter. */
      chargeBonus: 1.3,
      /** Als „zulaufend“ gilt, wer mindestens so schnell läuft (m/s) und höchstens so weit (Radiant) von der Richtung zum Gegner abweicht. */
      chargeSpeed: 1,
      chargeAngle: 0.8,
      /** Axthieb, Rang 4: Rückhand-Hieb nach so vielen Sekunden, mit diesem Faktor auf den Schaden. */
      backhandDelay: 0.22,
      backhandDamage: 0.6,
      /** Wirbelschlag, Rang 3: zweiter Wirbel nach so vielen Sekunden; so viel mehr Tempo, so lange (Sekunden). */
      whirlAgain: 0.35,
      whirlSpeed: 1.15,
      whirlSpeedSeconds: 1.4,
      /** Wirbelschlag, Rang 4: Jeder getroffene Gegner verkürzt die Abklingzeit um so viele Sekunden, insgesamt um höchstens diesen Anteil. */
      whirlRefund: 0.12,
      whirlRefundMax: 0.45,
      /** Wirbelschlag, Rang 5: Ab so vielen Gegnern im Kreis gilt die Figur als umzingelt (doppelter Schaden); der Wirbel schützt sie. */
      surround: 5,
      surroundFactor: 2,
      whirlGuard: 0.7,
      /** Wuchthieb, Rang 2: So viel weniger Schaden nimmt die Figur beim Ausholen (Faktor auf erlittenen Schaden). */
      windupGuard: 0.7,
      /** Wuchthieb, Rang 5: Ab so vielen Getroffenen lädt der nächste Schlag fast sofort (Anteil der Abklingzeit, der entfällt) und ist sicher kritisch. */
      chainHits: 5,
      chainRefund: 0.7,
      /** Kriegsschrei, Rang 3: Vorteil für so viele Sekunden (Faktor auf Abklingzeiten, dazu Kritchance). Rang 5: Echo nach so vielen Sekunden, mit diesem Faktor. */
      shoutAdvantageSeconds: 4,
      shoutAdvantageCooldown: 0.85,
      shoutAdvantageCrit: 0.15,
      echoDelay: 1.5,
      echoFactor: 0.5,
      /** Wurfaxt: So lange bleibt eine Axt in ihrem Ziel oder am Boden stecken (Sekunden). */
      axeStick: 0.6,
      /** Wurfaxt, Rang 4: Die Staubspur verlangsamt Gegner im Umkreis der Axt so stark und so lange. */
      trailRadius: 0.9,
      trailSlow: 0.35,
      trailSeconds: 1.2,
      /** Wurfaxt, Rang 5: Die Axt kehrt mit diesem Faktor auf ihr Tempo zurück. */
      returnSpeed: 1.25,
      /** Banner, Rang 3: Jeder so vielte Gegner, der darin stirbt, lässt einen Lebenssplitter fallen; er heilt so viel. */
      splinterEvery: 10,
      splinterHeal: 8,
      /** Banner, Rang 5: Alle so viele Sekunden zieht es Edelsteine in diesem Umkreis (Faktor auf den Radius) zur Figur. */
      bannerPulse: 2,
      bannerMagnet: 3,
      /** Dornenschild, Rang 3 (Rammbock): Als „frontal“ gilt ein Angreifer innerhalb dieses Winkels (Radiant) vor der Figur; Faktor auf den Schaden. */
      rammAngle: 1.05,
      rammFactor: 2,
      /** Dornenschild, Rang 4: Jeder so vielte Treffer schleudert Eisensplitter (Zahl, Winkel dazwischen in Radiant, Faktor auf den Schaden, Tempo und Reichweite der Splitter). */
      splitterEvery: 3,
      splitterCount: 3,
      splitterSpread: 0.14,
      splitterDamage: 0.5,
      splitterSpeed: 20,
      splitterReach: 6,
    },
  },
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
