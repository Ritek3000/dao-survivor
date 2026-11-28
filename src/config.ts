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
    /** Wie oft je Nacht beim Stufenaufstieg die Karten neu gewürfelt werden dürfen (siehe `Game.reroll`). */
    rerolls: 2,
    /** Wie viele Karten je Nacht bis zu ihrem Ende aus dem Angebot gestrichen werden dürfen (siehe `Game.banish`). */
    banishes: 2,
  },
  /**
   * Grade der Nächte (`game/grade.ts`, Regeln in `game/nights.ts`): Wer eine Nachtart geschafft hat, darf sie beim nächsten Mal einen Grad
   * höher wählen. Jeder Grad macht die Gegner stärker, und zwar additiv: Grad 5 ist fünfmal der Zuschlag, nicht 1,05 hoch 5. Die Zuschläge
   * kommen auf die Regeln der Nachtart obendrauf (Blaunacht, Grad 2: Leben × 1,5 × 1,1).
   */
  grade: {
    /** Höchster Grad. Nur ein Schutz vor Unsinn in einer bearbeiteten Datei, kein Ziel. */
    max: 99,
    /** Zuschlag je Grad auf das Leben der Gegner, auch des Verschlingers (0,05 = +5 %). */
    enemyHp: 0.05,
    /** Zuschlag je Grad auf den Schaden, den Gegner, Verschlinger und Schwarzer Sog der Figur zufügen (0,025 = +2,5 %). */
    enemyDamage: 0.025,
  },
  world: {
    /** Begehbarer Bereich; die Steinmale stehen an seinem Rand. */
    radius: 90,
    /** Freie Fläche um den Startpunkt. */
    spawnClearing: 7,
    /**
     * Der Seed der Welt im Titelbild, solange noch kein Lauf läuft, und der Teile, die nicht in jedem Lauf neu entstehen: die Kachel
     * des Bodens (das Errechnen kostet Zeit), das Modell der Grasbüschel und der Staub in der Luft. Die Welt eines Laufs wächst aus
     * dem Seed des Laufs (`World.generate`); Zahl und Größen der Dinge in ihr stehen unter `scenery` und `islands`.
     */
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
    /**
     * Köder (Köderpuppe des Wildnisläufers): Wer einem Köder folgt, bleibt in diesem Abstand (Meter, vom Rand des Gegners bis zur
     * Mitte des Köders) stehen und drängt sich dort mit den anderen, statt auf die Mitte zu laufen.
     */
    lureStand: 0.7,
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
   * Der Stachelträger: ein zweiter Boss, der früh in der Nacht kommt (Sekunde 300) und die Spielfigur aus der Ferne bedrängt. Er wirft Stacheln aus
   * seinem Rücken und schüttelt ab und zu eine Salve auf eine angekündigte Fläche, deren Stacheln die Figur am Boden festsetzen. Eine Aura schützt
   * ihn zeitweise vor Schaden von außen. Unter 30 % seines Lebens gerät er in Rage. **Namen und alle Zahlen sind Vorschläge und Startwerte** für den Messlauf (`__messlauf`); die Lore
   * kennt dieses Wesen nicht (siehe PR zu v0.23.0).
   */
  stachelboss: {
    name: 'Der Stachelträger',
    /** Sekunde der Nacht, in der er erscheint. */
    from: 300,
    /**
     * Als Gegner: Trefferkreis, Leben und Schritttempo. `scale` bremst nur den Rückstoß, `model.height` ist seine Größe im Spiel (die Stacheln
     * eingerechnet), `model.stride` die Meter je Durchlauf des Gehens: LAUF_STRECKE aus tools/stachelschwein-animieren.py (0,9 m in der Datei,
     * die 1,675 m hoch ist) mal 3,4 / 1,675. Stimmt der Wert nicht, rutschen die Füße.
     */
    type: {
      id: 'stachelboss',
      model: { file: 'stachelschwein.glb', height: 3.4, clip: 'Laufen', stride: 1.83 },
      radius: 1.4, scale: 6, speed: 3, hp: 2000, damage: 0, xp: 0, color: 0x4a4038, from: 0, weight: 0,
    } as EnemyType,
    /** Namen der Animationen in der Datei (ein Teil des Namens genügt; beide Würfe heißen gleich anfangend, darum genau). */
    clips: { idle: 'Stehen', walk: 'Laufen', wurf: 'Stachelwurf', wurf2: 'Stachelwurf2', salve: 'Stachelsalve', dead: 'Tod' },
    /** Erfahrung und Gold, die er fallen lässt (Kranz von Edelsteinen und Münzen), und die Segen, die man für ihn wählen darf. */
    xp: 60,
    gems: 8,
    coins: 6,
    coinValue: 8,
    segen: 1,
    /**
     * Er geht auf die Spielfigur zu, bis sie näher ist als `stand`, und greift an, sobald sie näher ist als `range` (Meter, Mitte zu Mitte).
     * Die Kamera zeigt etwa 13 m vor die Figur, und die Lebensleiste im Bild verdeckt den oberen Rand: Mit `stand` 5,5 m steht er unter ihr,
     * und `range` liegt weit genug darunter, damit jeder Angriff im Bild beginnt und sein Ausholen zu sehen ist.
     */
    stand: 5.5,
    range: 10,
    /** So schnell dreht er sich (Radiant je Sekunde). */
    turnRate: 2.4,
    /**
     * Stachelwurf, der Standardangriff: Er greift mit einer Hand in den Rücken und wirft den Stachel. Die Hände wechseln sich ab.
     * `interval` = Sekunden von einem Wurf bis zum nächsten, `releaseAt` = Sekunde der Animation, in der der Stachel die Hand verlässt,
     * `heldFrom` = ab da hält die Hand ihn sichtbar (siehe tools/stachelschwein-animieren.py: WURF_LOSLASSEN). `speed` in m/s, `radius` =
     * wie dicht der Stachel an der Mitte der Figur vorbei darf, um zu treffen; `maxRange` = so weit fliegt er höchstens.
     */
    wurf: { interval: 0.9, damage: 4, speed: 12, releaseAt: 0.52, heldFrom: 0.26, radius: 0.6, maxRange: 28 },
    /**
     * Stachelsalve: Er schüttelt den Rücken, `count` Stacheln fliegen im hohen Bogen auf die angekündigte Fläche (Radius `radius`, also 12 m
     * Durchmesser; sie liegt dort, wo die Figur beim Beginn steht). Jeder Stachel schlägt mit `impactRadius` Metern Wirkung ein; wen einer trifft,
     * ist `root` Sekunden bewegungsunfähig und danach `immunity` Sekunden gegen weiteres Festsetzen gefeit. `launchAt` = Sekunde der Animation, ab
     * der sie fliegen, verteilt auf `spread` Sekunden; `flight` = Flugzeit von bis; `stuck` = so lange stecken sie danach im Boden.
     */
    salve: {
      interval: 5,
      count: 10,
      radius: 6,
      damage: 4,
      root: 1.6,
      immunity: 1.5,
      launchAt: 0.75,
      spread: 0.55,
      flight: [1.15, 1.45] as readonly [number, number],
      impactRadius: 1.7,
      stuck: 1.4,
    },
    /**
     * Rage: Unter diesem Anteil seines Lebens wird er schneller. `speed` = Faktor auf die Geschwindigkeit seiner Angriffe (Animation und Takt),
     * `cooldown` = Faktor auf die Abklingzeit der Salve (0,75 = ein Viertel kürzer). Er pulsiert dabei rötlich (`pulse` = Sekunden je Puls).
     * Abweichung vom Wortlaut des Auftrags: „die Abklingzeit um 25 % steigern“ ist als kürzere Wartezeit gemeint, sonst wäre die Rage keine.
     */
    rage: { below: 0.3, speed: 1.25, cooldown: 0.75, pulse: 0.9 },
    /**
     * Aura: Alle `interval` Sekunden, `first` Sekunden nach seinem Erscheinen zum ersten Mal, umgibt ihn `duration` Sekunden lang eine Aura
     * (Radius `radius`, 5 m Durchmesser). Solange sie steht, erleidet er nur den Anteil `outside` des Schadens (0,25 = 75 % weniger), es sei denn,
     * die Spielfigur steht in der Aura: Dann gilt der Schaden voll. Maßgeblich ist, wo die Figur im Augenblick des Schadens steht (Mitte der Figur
     * zur Mitte des Bosses), gleich ob der Schaden von einem Hieb, einem Geschoss oder einem Feld kommt. Sein Kollisionskreis (1,4 m) lässt die
     * Figur bis auf 2,2 m heran: Wer ihm im Nahkampf an den Füßen steht, ist in der Aura. Die Rage ändert sie nicht.
     */
    aura: { first: 3, interval: 6, duration: 3, radius: 5, outside: 0.10 },
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
    /** Fertigkeiten des Wildnisläufers. Die Zahlen je Rang stehen in `weapons.ts`; hier stehen die, die über mehrere Ränge gleich bleiben. */
    laeufer: {
      /** Bogenschuss, Rang 2: Wer als Zweiter vom Pfeil (oder Messer) getroffen wird, erleidet nur diesen Anteil des Schadens. */
      pierceFalloff: 0.6,
      /** Bogenschuss und Wurfmesser, Rang 4: Gegen Gegner im Nachteil, verlangsamt oder blutend kommt so viel Kritchance dazu (Vorteil). */
      advantageCrit: 0.3,
      /** Bogenschuss, Rang 5: Der erste Getroffene erleidet so lange (Sekunden) diesen Faktor mehr Schaden (Nachteil, „Rüstungsverlust“). */
      armorSeconds: 3,
      armorFactor: 1.15,
      /** Pfeilhagel, Rang 5: Die Salve rückt höchstens so viele Meter zur Mitte der Gruppe vor; wer näher als dieser Anteil des Radius an der Mitte steht, erleidet mehr Schaden. */
      hailFollow: 1.4,
      hailCenter: 0.4,
      hailCenterFactor: 1.25,
      /** Fangeisen, Rang 2: Die beiden Eisen liegen so weit auseinander (Meter). Rang 5: Splitter im Umkreis, Anteil am Schaden des Eisens. */
      trapSpacing: 1.8,
      trapSplinterRadius: 2.4,
      trapSplinterDamage: 0.7,
      /** Sporenfalle: Die Kapsel platzt, wenn ein Gegner so nah kommt (Meter); höchstens so viele liegen zugleich. */
      sporeTrigger: 1,
      sporeMax: 4,
      /** Sporenfalle, Rang 4: Die zwei Kapseln liegen so weit auseinander. Rang 5: Die Wolke eines Gestorbenen hat diesen Radius und hält so lange (Sekunden). */
      sporeSpacing: 1.6,
      sporeAgainRadius: 1.3,
      sporeAgainSeconds: 2,
      /** Sporenfalle, Rang 5: Solange weniger Felder liegen als dieser Wert, hinterlässt ein Gestorbener eine Wolke (der Vorrat ist begrenzt). */
      sporeAgainLimit: 14,
      /** Köderpuppe: Gegner bis zu diesem Vielfachen des Radius der Puppe (Meter vom Gestell) laufen auf sie zu statt auf die Figur und schlagen und zaubern dorthin. */
      decoyLure: 3,
      /** Köderpuppe, Rang 3: Wer so lange (Sekunden) im Schatten der Puppe steht, gerät in Furcht, sofern er nicht groß ist; die Furcht hält so lange. */
      decoyFearAfter: 1.5,
      decoyFearSeconds: 1.2,
      /** Köderpuppe, Rang 4: Solange die Figur in der Nähe der Puppe steht, erleidet sie diesen Faktor des Schadens aus Fernangriffen (Ausweichen, als Mittelwert). */
      decoyShelter: 0.6,
      /** Köderpuppe, Rang 5: Beim Auflösen schleudert die Welle Gegner im Umkreis (Faktor auf den Radius der Puppe). */
      decoyBlast: 1.5,
      /** Netz, Rang 3: Das Netz zieht Getroffene um höchstens so viele Meter, höchstens diesen Anteil ihres Abstands zur Mitte, zusammen. */
      netPull: 1.4,
      netPullShare: 0.55,
      /** Netz, Rang 5: Kleine Gegner im Netz sind so lange (Sekunden) bewegungsunfähig; der Zauber der Fernkämpfer ist so lange gestört. */
      netHold: 1.5,
      netSilence: 1.5,
    },
    /** Fertigkeiten des Magiers. Die Zustände je Rang stehen in `weapons.ts`; hier stehen die Zahlen, die über mehrere Ränge gleich bleiben. */
    magier: {
      /** Hitze werfen, Rang 5: Die Aschelinie am Ende des Kegels liegt so lange (Sekunden), ist so breit und höchstens so lang (Meter); Schaden je Takt als Anteil am Schaden des Zaubers. */
      ashSeconds: 2.5,
      ashWidth: 1,
      ashLength: 7,
      ashDamage: 0.35,
      ashBurnSeconds: 1,
      ashBurnPower: 4,
      /** Sorlanze, Rang 1: Der zweite und dritte Getroffene erleiden diesen Anteil des Schadens des Vorgängers. */
      lanceFalloff: 0.7,
      /** Sorlanze, Rang 4: Die Glutspur liegt so lange (Sekunden), ist so breit (Meter); Schaden je Takt als Anteil, Verlangsamung (Stärke, Sekunden). */
      lineSeconds: 3,
      lineWidth: 1,
      lineDamage: 0.25,
      lineSlow: 0.25,
      lineSlowSeconds: 0.8,
      /** Sorlanze, Rang 5: Die zweite Lanze folgt nach so vielen Sekunden, so viele Meter seitlich versetzt. */
      lanceAgain: 0.3,
      lanceOffset: 0.5,
      /** Glut formen, Rang 4: Wer so lange (Sekunden) im Kreis steht, fängt Feuer und brennt so lange mit dieser Stärke weiter. Wer den Kreis verlässt, beginnt nach `scorchGap` Sekunden von vorn. */
      scorchAfter: 2,
      scorchGap: 0.8,
      scorchSeconds: 3,
      scorchPower: 4,
      /** Glut formen, Rang 5: Jeder so vielte Schlag ist ein Puls (Faktor auf den Schaden); er stößt kleine Nahkämpfer höchstens so viele Meter zum Rand. */
      pulseEvery: 8,
      pulseFactor: 2,
      pulsePush: 3,
      /** Erdstoß, Rang 4: Die zweite Welle folgt nach so vielen Sekunden, reicht so weit (Anteil des Radius), trifft mit diesem Anteil des Schadens und betäubt so lange (Sekunden). */
      waveDelay: 0.35,
      waveRadius: 0.7,
      waveDamage: 0.7,
      waveStun: 0.8,
      /** Erdstoß, Rang 5: Der Ring aus Erde liegt so lange (Sekunden), ist so breit (Meter) und bremst Gegner darin (Stärke, Sekunden). */
      ringSeconds: 2.5,
      ringWidth: 1.2,
      ringSlow: 0.45,
      ringSlowSeconds: 0.6,
      /** Wurzelgriff, Rang 4: Gefesselte erleiden von Feuer- und Lichtzaubern diesen Faktor mehr. Rang 5: Die neue Wurzel sucht einen freien Gegner in dieser Entfernung (Meter) und hält ihn so lange (Sekunden). */
      dryFactor: 1.2,
      regrowRange: 6,
      regrowSeconds: 1.5,
      /** Sturmböe, Rang 2: Nach jeder Böe so viel mehr Tempo, so lange (Sekunden). Rang 3: Getroffene Zauberer sind so lange (Sekunden) gestört. */
      boostSpeed: 1.3,
      boostSeconds: 2,
      scatterSeconds: 1.5,
      /** Sturmböe, Rang 5: Die Staubspur: alle so viele Sekunden ein Feld mit diesem Radius, das so lange liegt und Verfolger bremst und schwächt (Stärke, Sekunden). */
      trailEvery: 0.35,
      trailRadius: 1.1,
      trailSeconds: 1.6,
      trailSlow: 0.3,
      trailFeeble: 0.3,
      trailEffectSeconds: 0.6,
      /** Schild, Rang 4: Der Impuls beim Brechen reicht so weit (Meter), blendet (Stärke, Sekunden) und verlangsamt (Stärke, Sekunden). */
      pulseRadius: 3.5,
      pulseBlind: 0.5,
      pulseBlindSeconds: 2,
      pulseSlow: 0.4,
      pulseSlowSeconds: 1.2,
      /** Schild, Rang 5: So viele Tode durch Zauber oder so viele Treffer an einem Großen verkürzen die Ladezeit um diesen Anteil. */
      primeKills: 5,
      primeHits: 10,
      primeShare: 0.25,
    },
    /**
     * Evolutionen (Rang 6): Hat ein Angriff Rang 5 und schaltet ein angelegter legendärer Ring seine Evolution frei, wird er zum
     * Rang 6. Was der Rang an Schaden, Abklingzeit und Zuständen ändert, steht in `weapons.ts`; hier stehen die Zahlen der neuen Wirkungen.
     */
    evolution: {
      /**
       * Beute: Ein legendärer Ring kann die Evolution eines Angriffs tragen, den die Klasse noch nicht spielt. Angriffe, die in dieser
       * Nacht schon so hohen Rang haben, werden um diesen Faktor häufiger gewürfelt (Zielhilfe, kein Zwang).
       */
      lootRank: 3,
      lootWeight: 3,
      kaempfer: {
        /** Henkersbeil: Jeder so vielte Hieb entlädt die Sichel; sie ist so lang und breit (Meter), schlägt mit diesem Faktor auf den Schaden zu und richtet Geschwächte unter diesem Anteil ihres Lebens hin (Große und der Verschlinger nicht). */
        sickleEvery: 4,
        sickleLength: 14,
        sickleWidth: 2.6,
        sickleDamage: 3,
        sickleExecute: 0.25,
        /** Reliquie: Jeder Gegner im Umkreis (höchstens `relicStacks`) gibt einen Stapel: Abklingzeit × `relicHaste`, Tempo × `relicSpeed` je Stapel. Das Banner schwebt `relicLift` Meter hoch. */
        relicStacks: 10,
        relicHaste: 0.97,
        relicSpeed: 1.015,
        relicSeconds: 1,
        relicLift: 2.5,
        /** Sturm der Klingen: Die Äxte kreisen so lange (Sekunden) in diesem Abstand (Meter) mit diesem Tempo (Radiant je Sekunde); wer sie berührt, erleidet alle `stormEvery` Sekunden diesen Anteil des Schadens. Danach suchen sie Ziele bis `stormSight` mal ihrer Reichweite. */
        stormSeconds: 1.1,
        stormRadius: 1.9,
        stormSpin: 8,
        stormEvery: 0.2,
        stormTouch: 0.2,
        stormSight: 1.3,
        /** Mahlstrom: So lange dreht er sich (Sekunden), mit diesem Faktor auf den Radius des Wirbelschlags; jeder Takt (`vortexEvery`) schlägt mit diesem Faktor zu und zieht Gegner mit diesem Tempo (m/s) heran. Am Ende schleudert die Druckwelle (Radius-Faktor, Schadensfaktor, Rückstoß in Metern) sie fort. */
        vortexSeconds: 4,
        vortexRadius: 1.2,
        vortexEvery: 0.25,
        vortexDamage: 0.4,
        vortexPull: 3,
        vortexBlastRadius: 1.4,
        vortexBlastDamage: 2,
        vortexBlastPush: 5,
        /** Spalter von Ghen: Beim Ausholen zieht der Staub Gegner im Umkreis `cleaveReach` mit diesem Tempo (m/s) zum Einschlagpunkt `cleaveImpact` Meter vor der Figur; der Spalt ist so lang und breit (Meter), schlägt mit diesem Faktor zu und betäubt so lange (Sekunden). */
        cleaveReach: 5,
        cleavePull: 3.5,
        cleaveImpact: 2.2,
        cleaveLength: 13,
        cleaveWidth: 2.6,
        cleaveDamage: 2.4,
        cleaveStun: 0.7,
        /** Donner: Der Kegel öffnet sich so weit (Radiant); wer getroffen wird, nimmt so lange (Sekunden) diesen Faktor mehr Schaden aus den Nahkampfangriffen des Kämpfers. */
        thunderArc: 1.4,
        thunderSeconds: 4,
        thunderFactor: 1.15,
        /** Bollwerk: Die Aura beginnt `bulwarkStart` Meter vor der Figur, ist so lang und breit (Meter), wirkt alle `bulwarkEvery` Sekunden mit diesem Faktor auf den Dornenschaden und drängt Gegner um `bulwarkPush` Meter zurück. */
        bulwarkStart: 0.5,
        bulwarkLength: 2.6,
        bulwarkWidth: 3,
        bulwarkEvery: 0.3,
        bulwarkDamage: 0.5,
        bulwarkPush: 0.5,
      },
      laeufer: {
        /** Pfeilfächer: Jeder so vielte Schuss trägt einen Staub-Pfeil; seine Wolke (Radius in Metern, Sekunden) lenkt Pfeile darin mit diesem Tempo (Radiant je Sekunde) auf Ziele im Inneren; höchstens `dustMax` Wolken zugleich. */
        dustEvery: 3,
        dustRadius: 2.6,
        dustSeconds: 4.5,
        dustTurn: 9,
        dustMax: 3,
        /** Sturm der Aschenfedern: Der Schauer hält so lange (Sekunden), wirkt alle `ashEvery` Sekunden mit diesem Anteil am Schaden der Salve; wer darin steht, ist so lange blind und verstummt. Danach liegt ein Staubfeld (Sekunden, Anteil am Radius, Verlangsamung). */
        ashSeconds: 2.5,
        ashEvery: 0.25,
        ashTick: 0.3,
        ashBlind: 0.7,
        ashFieldSeconds: 5,
        ashFieldRadius: 1.1,
        ashFieldSlow: 0.35,
        /** Kiefer der Ödnis: Das Bündel fliegt zur größten Gruppe in `jawsRange` Metern (Flug in Sekunden); die drei Eisen liegen `jawsSpread` Meter von der Mitte. Beim Zuschnappen reißen die Ketten bis zu `jawsChain` Gegner im Umkreis `jawsChainRadius` zur Mitte; sie bleiben `jawsHold` Sekunden gefangen und erleiden dabei, alle `jawsTearEvery` Sekunden, diesen Anteil des Schadens. */
        jawsRange: 12,
        jawsFlight: 0.55,
        jawsSpread: 1.9,
        jawsChain: 3,
        jawsChainRadius: 7,
        jawsHold: 2.5,
        jawsDamage: 1.4,
        jawsTearEvery: 0.5,
        jawsTear: 0.45,
        jawsMax: 3,
        /** Klingen-Fächer: Die zweite Welle folgt nach `knivesDelay` Sekunden, um eine halbe Lücke versetzt. Die äußeren Messer wirbeln alle `knivesDustEvery` Sekunden Staub auf und knicken ab `knivesBendAfter` Sekunden mit diesem Tempo (Radiant je Sekunde) nach innen. */
        knivesDelay: 0.16,
        knivesBendAfter: 0.16,
        knivesBend: 2.6,
        knivesDustEvery: 0.07,
        /** Atem der Schattenpilze: Der Beutel fliegt zur dichtesten Gruppe in `bagRange` Metern (Flug in Sekunden); die Nebelwand wandert mit `fogDrift` Metern je Sekunde in Wurfrichtung und macht Gegner darin `fogBlind` Sekunden blind; höchstens `fogMax` zugleich; sie schlägt `fogDamage`-mal so hart zu wie eine Kapsel. */
        bagRange: 11,
        bagFlight: 0.65,
        fogDrift: 0.7,
        fogBlind: 0.8,
        fogMax: 2,
        fogDamage: 1.6,
        /** Vollstrecker der Ödnis: Das Phantom zieht Gegner mit diesem Tempo (m/s) zur Mitte und versetzt kleine in Furcht (Sekunden); die Schockwelle am Ende reicht so weit (Faktor auf den Radius), schlägt mit diesem Faktor zu und bringt jedem Verlangsamten oder Gefesselten diesen Anteil mehr Schaden. */
        phantomPull: 2.2,
        /** Vollstrecker der Ödnis: Das Phantom lockt Gegner bis zu diesem Vielfachen seines Radius an (Meter vom Phantom); weiter als das Gestell der Puppe, denn es zieht „im weiten Umkreis“. */
        phantomLure: 2.5,
        phantomFear: 1.2,
        phantomBlast: 1.5,
        phantomDamage: 1.8,
        phantomBonus: 0.15,
        /** Schlinge der Alten Ordnung: Das Netz fegt mit diesem Tempo (m/s) so weit (Meter) und so breit (Meter) über den Boden, nimmt höchstens `dragMax` kleine und mittlere Gegner mit und schnürt sie am Ende auf einen Kreis mit diesem Radius zusammen. Dort hält es sie `dragHold` Sekunden; die Gewichte schlagen alle `dragCrushEvery` Sekunden mit diesem Anteil des Schadens zu. */
        dragSpeed: 15,
        dragLength: 11,
        dragWidth: 4.4,
        dragMax: 18,
        dragBundle: 1.2,
        dragHold: 3,
        dragCrushEvery: 0.5,
        dragCrush: 1,
      },
      magier: {
        /** Atem der Verblassenden Sor: Wer brennend stirbt, entzündet den Staub um sich. Das Feld hat diesen Radius (Meter), liegt so lange (Sekunden), schlägt je Takt mit diesem Anteil am Schaden des Zaubers zu und setzt in Brand (Sekunden, Stärke); höchstens `sunLimit` Felder liegen zugleich. */
        sunRadius: 1.7,
        sunSeconds: 2.2,
        sunDamage: 0.3,
        sunBurnSeconds: 2,
        sunBurnPower: 5,
        sunLimit: 14,
        /** Speer der Verschwundenen Sonne: Er fällt auf die dichteste Gruppe in `spearReach` Metern (Umkreis `spearGroup`), nach `spearDelay` Sekunden Ankündigung. Der Einschlag trifft im Radius `spearRadius` mit diesem Faktor auf den Schaden; die vier Strahlen laufen so weit und so breit (Meter) und schlagen mit ihrem Faktor zu. */
        spearReach: 13,
        spearGroup: 3,
        spearDelay: 0.5,
        spearRadius: 2.8,
        spearDamage: 3.2,
        spearRayLength: 11,
        spearRayWidth: 1.6,
        spearRayDamage: 1,
        /** Krone der Erloschenen Sor: Der Hitzeschaden wächst, je länger einer im Kreis steht (je Sekunde dieser Anteil, bis `crownRampMax` Sekunden). Wer im Kreis stirbt, löst eine Hitzewelle aus (Radius in Metern, Faktor auf den Schaden, höchstens `crownWaveMax` je Bild), die versengt (Sekunden, Stärke). */
        crownRamp: 0.25,
        crownRampMax: 4,
        crownWave: 2.4,
        crownWaveDamage: 1,
        crownWaveMax: 4,
        crownBurnSeconds: 2,
        crownBurnPower: 5,
        /** Beben der Alten Ordnung: Drei Ringe laufen mit `quakeSpeed` Metern je Sekunde hinaus, im Abstand `quakeGap` Sekunden; sie reichen bis zu diesen Anteilen des Radius und schlagen mit diesen Faktoren zu. Sie schleudern zurück (Meter; Großwild ein Stück weniger). Danach liegt ein Trümmerfeld (Sekunden; Verlangsamung, Faktor Nachteil). */
        quakeSpeed: 20,
        quakeGap: 0.28,
        quakeRings: [0.5, 0.78, 1],
        quakeDamage: [1, 1, 1.3],
        quakePush: 6,
        quakeBigPush: 4,
        quakeFieldSeconds: 4,
        quakeSlow: 0.35,
        quakeWeak: 1.25,
        /** Griff der Alten Tiefe: Die Bahn vor der Figur ist so lang und so breit (Meter); sie zieht höchstens `gripMax` kleine und mittlere Gegner in `gripPull` Sekunden in die Mitte, wo sie ein Bündel mit diesem Radius bilden. Das Geflecht zehrt sie aus: alle `gripDrainEvery` Sekunden mit diesem Anteil am Schaden. */
        gripLength: 11,
        gripWidth: 5,
        gripPull: 0.4,
        gripMax: 14,
        gripBundle: 1.5,
        gripDrain: 0.6,
        gripDrainEvery: 0.5,
        /** Orkan der Alten Ordnung: Der Luftstrom macht die Figur dauerhaft um diesen Faktor schneller; die zweite Böe folgt nach `galeAgain` Sekunden mit diesem Faktor auf den Schaden. Beide Böen zerreiben die Fernzauber (Schwarze Sog) in diesem Umkreis (Meter) um die Figur. */
        galeSpeed: 1.15,
        galeAgain: 0.24,
        galeAgainFactor: 0.85,
        galeCancel: 7,
        /** Kuppel der Alten Ordnung: Solange eine Rune steht, zerreibt die Aura (Radius in Metern) feindliche Fernzauber. Die Runen kreisen mit `domeSpin` rad/s. Zerbricht eine, fährt in Blickrichtung eine Staub-Druckwelle (Reichweite, Öffnungswinkel, fester Schaden, Rückstoß in Metern, Blendung in Sekunden). */
        domeCancel: 2.4,
        domeSpin: 1.3,
        domeRange: 6.5,
        domeArc: 1.5,
        domeDamage: 28,
        domePush: 9,
        domeBlind: 1,
      },
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
  /**
   * Die Sammelstelle für die Statistik aller Spieler (Supabase; Einrichtung in tools/supabase/statistik.sql, siehe README, Abschnitt
   * "Sammelstelle"). Der Schlüssel ist ein "publishable key": Er ist dafür gemacht, im Spiel zu stehen. Was er darf, regeln die
   * Regeln in der Datenbank (nur Nächte eintragen, nur Zähler lesen), nicht seine Geheimhaltung.
   */
  sammelstelle: {
    url: 'https://bakxzwwqbmnlkvgmbumy.supabase.co',
    key: 'sb_publishable_c5G9AvY1aNuep5rJ401TMQ_ftOe76re',
    /** Nach so vielen Sekunden gibt eine Anfrage auf; die Nacht ist dann für die Statistik aller verloren, das Spiel läuft weiter. */
    timeoutSeconds: 10,
  },
} as const;
