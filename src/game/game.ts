import * as THREE from 'three';
import { audio, type Duck, type MusicId } from '../audio';
import { CONFIG } from '../config';
import { evaluate } from '../core/auswertung';
import { pickTextFile, saveTextFile } from '../core/dateien';
import { CHOICE_ACTIONS, Input, type MoveVector } from '../core/input';
import { createRandom, deriveSeed, type Random } from '../core/random';
import { formatSeed, newRunSeed, seedFromAddress } from '../core/runSeed';
import { loadSettings, saveSettings, type Settings, type VitalsPosition } from '../core/settings';
import { sendRun } from '../core/sammelstelle';
import {
  loadSavegame,
  MAX_SAVEGAME_FILE_BYTES,
  readSavegameFile,
  summarizeSavegame,
  writeSavegame,
  writeSavegameFile,
  type Savegame,
  type SavegameSummary,
} from '../core/savegame';
import { loadRuns, newRunId, recordRun, type RunOutcome, type RunRecord } from '../core/statistik';
import { formatTime, type ChoiceGrade, type EndLoot, type Hud } from '../ui/hud';
import { LagerView } from '../ui/lagerView';
import { Menus, type MenuCommand } from '../ui/menus';
import { Arsenal, type CombatTraits } from './arsenal';
import { Ausruestung } from './ausruestung';
import { Boerse } from './boerse';
import { Beute, type LootSettlement } from './beute';
import { Boss } from './boss';
import { CameraRig } from './cameraRig';
import { CLASSES, TRAITS, type ClassDef, type ClassId } from './classes';
import { Coins } from './coins';
import { finsternisUniforms } from './darkness';
import { Chest, Drops } from './drops';
import { Dust } from './dust';
import { Enemies, type Enemy, type EnemyHooks } from './enemies';
import { CombatEvents } from './events';
import { Fields } from './fields';
import { Grade, describeGrade } from './grade';
import { itemName, RARITIES, RARITY_LABELS, slotLabel, type Item, type Rarity } from './items';
import { Lager } from './lager';
import { loadModels, type Models } from './models';
import { applyNightStats, NIGHTS, rulesAt, USUAL_NIGHT, type NightDef, type NightId } from './nights';
import { Pickups } from './pickups';
import { Player } from './player';
import { Progression, SEGEN_EVERY_LEVELS, UPGRADES } from './progression';
import { Stachelboss } from './stachelboss';
import { Threats } from './threats';
import { MAX_RANK, weaponById } from './weapons';
import { World } from './world';
import { Zones, type IslandBearing, type Site, type Zone } from './zones';

/** Obergrenze je Frame, damit ein Ruckler oder Tab-Wechsel keinen Sprung auslöst. */
const MAX_FRAME_SECONDS = 0.05;
const NIGHT_BACKGROUND = new THREE.Color(0x030304);
const DAWN_BACKGROUND = new THREE.Color(0x4f4a3a);
/** Abstand zwischen zwei Wirkungen von Kwests Esse, in Sekunden. */
const SEAR_SECONDS = 0.5;
const SEGEN_SUBTITLE = 'Eine Höhere Macht antwortet. Wähle einen Segen';
/** Sekunden zwischen dem Sturz eines Bosses und der Wahl des Segens. */
const BOSS_SEGEN_SECONDS = 3;

/**
 * 'loading' = Modelle werden geladen, 'title' = Startbildschirm, 'select' = Klassenwahl vor der Nacht, 'start' = Wahl des Startangriffs, 'night' = Wahl der Nachtart,
 * 'levelup' = Wahl einer Stärkung, 'lager' = Lager (Ausrüstung, Truhe und Händler) zwischen den Nächten. Der Startbildschirm und die Pause
 * tragen die Menüs (Optionen, Anleitung, Rückfragen) als Unterseiten.
 */
type Phase = 'loading' | 'title' | 'select' | 'start' | 'night' | 'playing' | 'paused' | 'levelup' | 'lager' | 'ended';

/** Eine wählbare Stärkung beim Stufenaufstieg: neuer Angriff, höherer Rang oder Segen. */
interface Offer {
  /** Woran das Spiel die Karte wiedererkennt, wenn sie verbannt wurde: Art und Kennung, etwa `staerkung:harte-hand`. */
  key: string;
  name: string;
  text: string;
  note: string;
  segen?: boolean;
  take(): void;
}

/** „a“, „a und b“, „a, b und c“. */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

export class Game {
  readonly player: Player;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly background = NIGHT_BACKGROUND.clone();
  private readonly fog = new THREE.Fog(NIGHT_BACKGROUND, 28, 60);
  private readonly input = new Input();
  private readonly menus = new Menus();
  /**
   * Der Zufall des Laufs für Angebote, Boss und Angriffe. Jeder Lauf beginnt einen neuen Strom aus seinem Seed (`startRun`);
   * die Hand, die ihn weitergibt, bleibt dieselbe, damit Arsenal und Boss ihn nicht neu bekommen müssen.
   */
  private stream: Random = createRandom(deriveSeed(0, 900));
  private readonly random: Random = () => this.stream();
  /** Der Seed des laufenden (oder zuletzt gespielten) Laufs; er steht im Endbild. */
  private runSeed = 0;
  /**
   * Der Seed für den nächsten Lauf, wenn er nicht aus der Uhrzeit kommen soll: von der Adresse (`?seed=`) vorgegeben oder,
   * nur für den Messlauf, von diesem. Der Lauf nimmt ihn und leert das Feld; danach würfelt wieder die Uhr.
   */
  private nextSeed: number | null = seedFromAddress();
  private readonly progression = new Progression();
  private readonly world = new World();
  private readonly zones: Zones;
  /** Meldet Treffer, Tode und Verletzte mit Urheber; die Fertigkeiten hören zu (siehe `events.ts`). */
  private readonly events = new CombatEvents();
  private readonly enemies = new Enemies(this.events);
  private readonly pickups = new Pickups();
  private readonly coins = new Coins();
  /** Geldbörse und Ränge der Klassen; bleiben über die Nächte hinweg bestehen und werden gespeichert. */
  private readonly boerse = new Boerse();
  /** Die Gegenstände jeder Klasse; sie wirken beim Start der Nacht auf die Werte (`startRun`). */
  private readonly ausruestung = new Ausruestung();
  /** Was in dieser Nacht fällt und im Beutel liegt; am Ende der Nacht wandert es ins Inventar. */
  private readonly beute = new Beute(this.ausruestung);
  private readonly drops = new Drops();
  /** Die Kiste, die der Verschlinger hinterlässt. */
  private readonly chest = new Chest();
  /** Die beste Seltenheit im Beutel dieser Nacht, für die Anzeige. */
  private lootBest: Rarity | null = null;
  private readonly lager: Lager;
  /** Sind die Knöpfe und die Taste zum Lager freigeschaltet? */
  private lagerEnabled = false;
  private readonly arsenal: Arsenal;
  /** Bodenfelder der Fertigkeiten (siehe `fields.ts`). */
  private readonly fields: Fields;
  private readonly threats = new Threats();
  private readonly boss = new Boss();
  private readonly stachelboss = new Stachelboss();
  private readonly dust = new Dust();
  private readonly rig = new CameraRig();
  private readonly move: MoveVector = { x: 0, y: 0 };
  private readonly bearing: IslandBearing = { dx: 0, dz: 0, distance: 0, burning: false };
  private readonly traits: CombatTraits = { dealt: 1, haste: 1, finsternisDamage: 1 };
  private playerClass: ClassDef = CLASSES[0] as ClassDef;
  private models: Models | null = null;
  private phase: Phase = 'loading';
  private lastFrame = 0;
  /** Seit der Abendglocke vergangene Spielzeit. */
  private time = 0;
  /** Stufenaufstiege, für die noch eine Stärkung gewählt werden muss. */
  private pendingLevels = 0;
  /** Segen, die außer der Reihe gewährt werden: für erschlagene Bosse. */
  private pendingSegen = 0;
  /** Segen für gefallene Bosse, die noch unterwegs sind: Name des Bosses und Sekunden bis zur Wahl. */
  private readonly segenDue: { name: string; seconds: number }[] = [];
  /** Die Bosse, für die ein Segen zur Wahl steht, in der Reihenfolge ihres Falls. */
  private readonly segenFor: string[] = [];
  /** Sekunden bis zur nächsten Wirkung von Kwests Esse. */
  private searIn = 0;
  /** Reichweite des Lichtscheins, die den übrigen Systemen zuletzt gemeldet wurde. */
  private shownLight = 0;
  private offers: Offer[] = [];
  /** Alle Karten, aus denen das jetzige Angebot gezogen wurde; Neuwurf und Verbannen schöpfen daraus. */
  private pool: Offer[] = [];
  /** Titel und Unterzeile des Angebots, damit ein Neuwurf es neu zeigen kann. */
  private offerTitle = '';
  private offerSubtitle = '';
  /** Neuwürfe und Verbannungen, die in dieser Nacht noch bleiben. */
  private rerolls = 0;
  private banishes = 0;
  /** Die in dieser Nacht verbannten Karten (`Offer.key`); sie kommen bis zum Morgen nicht wieder ins Angebot. */
  private readonly banished = new Set<string>();
  /** Wartet die Wahl darauf, dass die Karte zum Verbannen gewählt wird? */
  private banishing = false;
  /** Die Klasse, deren Startangriff gerade gewählt wird (Phase 'start'). */
  private pendingClass: ClassDef | null = null;
  /** Mit welchem Angriff jede Klasse zuletzt begann; nur für diese Sitzung, es wird nichts gespeichert. */
  private readonly lastStart = new Map<ClassId, string>();
  /** Der gewählte Startangriff, solange die Nachtart gewählt wird (Phase 'night'). */
  private pendingStart = '';
  /** Welche Nachtart zuletzt gewählt wurde; nur für diese Sitzung. */
  private lastNight: NightId = USUAL_NIGHT.id;
  /** Die Nachtart der laufenden (oder zuletzt gespielten) Nacht. */
  private night: NightDef = USUAL_NIGHT;
  /** Die Grade der Nächte (siehe `grade.ts`); sie liegen im Spielstand. */
  private readonly grade = new Grade();
  /** Der gewählte Grad je Nachtart, solange die Nachtart gewählt wird (Phase 'night'); jede Wahl beginnt beim höchsten freien Grad. */
  private readonly chosenGrade = new Map<NightId, number>();
  /** Der Grad der laufenden (oder zuletzt gespielten) Nacht. */
  private runGrade = 0;
  private selected = 0;
  /** Gold, das in dieser Nacht eingesammelt wurde, schon mit dem Goldfaktor der Figur. */
  private goldRun = 0;
  /** Kämpfer: stand im letzten Frame im Licht. */
  private wasInLight = false;
  /** Kämpfer: Restzeit der Schwäche nach erloschenem Feuer. */
  private weakened = 0;
  private traitLabel = '';
  /** Hat die Spielfigur die letzte Nacht überstanden? Bestimmt das Stück zum Ende. */
  private won = false;
  /** Wurde die Nacht über das Pausenmenü abgebrochen? Dann spielt zum Ende die Musik des Menüs. */
  private aborted = false;
  /**
   * Worauf die offene Rückfrage antwortet: das Abbrechen der Nacht, das Löschen des Spielstands, das Ersetzen durch eine Datei (`import`,
   * der Stand daraus wartet in `pendingImport`) oder ein Hinweis. `info` und `import` führen mit Esc zurück in die Optionen, von denen sie
   * ausgingen; `imported` (der Stand ist geladen) und alle anderen zur Hauptseite des Menüs.
   */
  private confirming: 'abort' | 'new' | 'notice' | 'import' | 'info' | 'imported' | null = null;
  private pendingImport: Savegame | null = null;
  private settings: Settings;
  /**
   * Schreibt jede Nacht ins Protokoll der Statistik (`core/statistik.ts`)? Der Messlauf spielt Nächte im Zeitraffer und
   * schaltet es ab, damit seine Probenächte die Statistik nicht verfälschen.
   */
  private recordStats = true;
  /** Sekunden bis zum nächsten Ruf aus der Horde. */
  private callIn = 2;
  /** Nächste brennende Feuerschale, für das Knistern: Ort und Abstand zur Spielfigur. */
  private fireX = 0;
  private fireZ = 0;
  private fireDistance = Infinity;
  private fpsFrames = 0;
  private fpsSeconds = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: Hud,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = CONFIG.torch.shadows;

    this.player = new Player(this.progression.stats, this.events);
    this.zones = new Zones(this.world.islandSites);
    this.fields = new Fields(this.enemies, this.player, this.progression);
    this.arsenal = new Arsenal(this.progression.stats, this.random, this.enemies, this.zones, this.player, {
      fields: this.fields,
      progression: this.progression,
      pickups: this.pickups,
    });
    this.beute.rankOf = (id) => this.arsenal.rankOf(id);
    this.arsenal.dissolveSogs = (x, z, reach) => this.threats.dissolve(x, z, reach);
    this.arsenal.onEvolve = (weapon) => this.hud.announce(`Evolution · ${weapon.def.evolution?.name ?? weapon.def.name}`);

    this.scene.background = this.background;
    // Blendet den fernen Boden in den Hintergrund aus, damit keine Kante sichtbar wird.
    this.scene.fog = this.fog;
    this.scene.add(
      this.world.group,
      this.zones.group,
      this.enemies.group,
      this.boss.group,
      this.stachelboss.group,
      this.stachelboss.quills.group,
      this.pickups.group,
      this.coins.group,
      this.drops.group,
      this.chest.group,
      this.player.object,
      this.threats.group,
      this.arsenal.group,
      this.dust.points,
    );

    this.lager = new Lager(new LagerView(), this.ausruestung);
    this.lager.onClose = () => this.closeLager();
    this.hud.onLager = () => this.openLagerFromMenu();
    this.hud.onPick = (index) => this.pick(index);
    this.hud.onMainMenu = () => this.openTitle();
    this.hud.onReroll = () => this.reroll();
    this.hud.onBanish = () => this.toggleBanishing();
    this.hud.onGrade = (index, step) => {
      // Wer auf + oder − einer Karte klickt, wählt sie mit, damit Enter dieselbe Nacht beginnt.
      this.selected = index;
      this.hud.select(index);
      this.stepGrade(step, index);
    };
    this.settings = loadSettings({
      sound: { ...CONFIG.audio.defaults, muted: false },
      ui: { vitalsPosition: 'top-left' },
      data: { share: true, noticeSeen: false },
    });
    audio.setVolumes(this.settings.sound);
    audio.muffleAt = (x, z) => this.zones.finsternisAt(x, z);
    audio.onVolumes = (volumes) => {
      this.settings.sound = { ...volumes };
      saveSettings(this.settings);
      this.menus.showSound(volumes);
      this.hud.setMuted(volumes.muted);
    };
    this.menus.onCommand = (command) => this.onMenuCommand(command);
    this.menus.onSound = (volumes) => audio.setVolumes(volumes);
    this.menus.onVitalsPosition = (position) => this.setVitalsPosition(position);
    this.menus.onShare = (share) => this.setShare(share);
    this.menus.showShare(this.settings.data.share);
    this.menus.showSound(this.settings.sound);
    this.hud.setMuted(this.settings.sound.muted);
    this.setVitalsPosition(this.settings.ui.vitalsPosition, false);
    this.rig.snapTo(this.player.position);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.refreshHud();
    void this.load();
  }

  /** Holt die GLB-Modelle, bevor die Klassenwahl erscheint. Was fehlt, bleibt Platzhalter. */
  private async load(): Promise<void> {
    this.hud.setLoading('Die Figuren werden geladen …');
    // Die Klänge laden daneben her; fehlen sie, bleibt das Spiel stumm, aber spielbar.
    const [models] = await Promise.all([
      loadModels((done, total) => this.hud.setLoading(`Figuren geladen: ${done} von ${total}`)),
      audio.load(),
    ]);
    this.models = models;
    for (const [type, model] of models.hordes) this.enemies.setModel(type, model);
    this.boss.setModel(models.boss);
    this.stachelboss.setModel(models.stachelboss);
    this.world.dress(models.props);
    this.zones.setModel(models.props.get(CONFIG.islands.model.file) ?? null);
    this.pickups.setModels(
      models.props.get(CONFIG.xp.gems.small.file) ?? null,
      models.props.get(CONFIG.xp.gems.large.file) ?? null,
    );
    this.hud.setLoading(null);
    this.openTitle();
    if (!this.settings.data.noticeSeen) this.showDataNotice();
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const frameSeconds = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    if (this.input.wasPressed('mute')) audio.toggleMute();
    switch (this.phase) {
      case 'playing':
        if (this.input.wasPressed('pause')) this.setPaused(true);
        else this.update(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        break;
      case 'title':
      case 'paused':
        this.updateMenu();
        break;
      case 'select':
      case 'start':
      case 'night':
      case 'levelup':
        this.updateChoice();
        break;
      case 'lager':
        this.lager.update(this.input);
        break;
      case 'ended':
        this.player.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.boss.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.stachelboss.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.arsenal.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        if (this.input.wasPressed('confirm')) this.openSelect();
        else if (this.input.wasPressed('lager')) this.openLagerFromMenu();
        else if (this.input.wasPressed('pause')) this.openTitle();
        break;
      case 'loading':
        break;
    }
    this.input.endFrame();
    this.updateAudio();

    this.renderer.render(this.scene, this.rig.camera);
    this.updateDebug(frameSeconds);
  };

  private update(dt: number): void {
    this.time += dt;
    const position = this.player.position;

    const stats = this.progression.stats;

    this.progression.update(dt);
    this.player.update(dt, this.time, this.input.getMove(this.move), this.world);
    this.syncLight();
    this.zones.update(dt, this.time, position, this.enemies.carriers);
    const zone = this.zones.zoneAt(position.x, position.z);
    const finsternis = this.zones.finsternisAt(position.x, position.z);
    this.updateTraits(dt, zone, finsternis);
    this.player.applyZone(dt, zone, finsternis);

    this.enemies.update(dt, this.time, this.player, this.world, this.hooks);
    this.callHorde(dt);
    this.boss.update(dt, this.time, this.player, this.enemies, this.threats, this.world, this.random);
    this.stachelboss.update(dt, this.time, this.player, this.enemies, this.threats, this.world);
    this.fields.update(dt);
    this.threats.update(dt, this.player, this.zones);
    this.reportBoss();
    for (let i = this.segenDue.length - 1; i >= 0; i--) {
      const due = this.segenDue[i];
      if (!due) continue;
      due.seconds -= dt;
      if (due.seconds > 0) continue;
      this.segenDue.splice(i, 1);
      this.segenFor.push(due.name);
      this.pendingSegen++;
    }
    this.arsenal.update(dt, this.time, this.traits);
    if (stats.scorch > 0) {
      this.searIn -= dt;
      if (this.searIn <= 0) {
        this.searIn += SEAR_SECONDS;
        const amount = stats.scorch * SEAR_SECONDS;
        this.zones.eachBurning((island) => this.arsenal.sear(island.x, island.z, CONFIG.islands.radius, amount));
      }
    }
    const pickupRadius = CONFIG.player.pickupRadius * stats.pickup;
    const gained = this.pickups.update(dt, this.time, position, pickupRadius);
    const healed = this.pickups.takeHealing();
    if (healed > 0) {
      this.player.grantHp(healed);
      audio.play('eingesammelt', position.x, position.z);
    }
    if (gained > 0) {
      this.pendingLevels += this.progression.addXp(gained * stats.xp);
      audio.play('eingesammelt', position.x, position.z);
    }
    const coined = this.coins.update(dt, this.time, position, pickupRadius);
    if (coined > 0) {
      this.goldRun += coined * stats.gold;
      this.hud.setGold(Math.floor(this.goldRun));
      audio.play('muenze', position.x, position.z);
    }
    this.chest.update(dt, this.drops, this.collectLoot);
    this.drops.update(dt, this.time, position, this.collectLoot);

    this.rig.update(dt, position);
    this.dust.update(this.time, position, this.player.light);
    this.updateDawn();
    if (this.player.consumeHit()) this.hud.flashHurt();
    this.refreshHud();

    if (!this.player.alive) this.end('fallen');
    else if (this.time >= CONFIG.run.nightSeconds) this.end('won');
    else if (this.pendingSegen > 0) this.openBossSegen();
    else if (this.pendingLevels > 0) this.openLevelUp();
  }

  /** Meldet den übrigen Systemen, wenn ein Segen den Lichtschein der Spielfigur vergrößert hat. */
  private syncLight(): void {
    if (this.player.light === this.shownLight) return;
    this.shownLight = this.player.light;
    this.zones.setViewerLight(this.player.light, this.player.lightColor);
  }

  /** Was die Bosse und der Sog gerade getan haben, als kurze Meldung im Bild. */
  private reportBoss(): void {
    const event = this.boss.consumeEvent();
    if (event === 'erschienen') this.hud.announce(`${CONFIG.boss.name} kommt`);
    else if (event === 'verschlingen') this.hud.announce('Das Verschlingen');
    const stachel = this.stachelboss.consumeEvent();
    if (stachel === 'erschienen') this.hud.announce(`${CONFIG.stachelboss.name} kommt`);
    else if (stachel === 'rage') this.hud.announce(`${CONFIG.stachelboss.name} gerät in Rage`);
    if (this.threats.quenched > 0) {
      this.threats.quenched = 0;
      this.hud.announce('Die Feuer erlöschen');
    }
  }

  /** Die Besonderheit der Klasse: was die Zone, in der sie steht, gerade bewirkt. */
  private updateTraits(dt: number, zone: Zone, finsternis: number): void {
    const { x, z } = this.player.position;
    this.traits.dealt = 1;
    this.traits.haste = 1;
    this.traits.finsternisDamage = 1;
    this.player.takenFactor = 1;
    this.traitLabel = '';

    switch (this.playerClass.id) {
      case 'kaempfer': {
        const kaempfer = TRAITS.kaempfer;
        const inLight = zone === 'licht';
        // Das Feuer ist erloschen oder verschluckt worden, während er noch in seinem Kreis stand.
        if (this.wasInLight && !inLight && this.zones.nearIsland(x, z)) this.weakened = kaempfer.weakSeconds;
        this.wasInLight = inLight;
        if (inLight) {
          this.weakened = 0;
          this.traits.dealt = kaempfer.lightDamage;
          this.player.takenFactor = kaempfer.lightTaken;
          this.traitLabel = 'Stark im Licht';
        } else if (this.weakened > 0) {
          this.weakened -= dt;
          this.traits.dealt = kaempfer.weakDamage;
          this.player.takenFactor = kaempfer.weakTaken;
          this.traitLabel = 'Geschwächt';
        }
        break;
      }
      case 'wildnislaeufer':
        this.traits.finsternisDamage = TRAITS.wildnislaeufer.finsternisDamage;
        break;
      case 'magier':
        // Nur dort, wo ihn die Finsternis auch verstaubt.
        if (zone === 'finsternis') {
          this.traits.haste = 1 + TRAITS.magier.finsternisHaste * finsternis;
          this.traitLabel = 'Zauber beschleunigt';
        }
        break;
    }
  }

  private readonly hooks: EnemyHooks = {
    death: (enemy) => {
      if (enemy === this.stachelboss.enemy) {
        this.stachelbossFalls(enemy);
        return;
      }
      if (enemy !== this.boss.enemy) {
        this.pickups.drop(enemy.x, enemy.z, enemy.type.xp);
        const { gold } = enemy.type;
        if (gold && this.random() < gold.chance) this.coins.drop(enemy.x, enemy.z, gold.value);
        const { loot } = enemy.type;
        if (loot && this.beute.drops(loot.chance)) this.dropLoot(this.beute.roll(loot.tier), enemy.x, enemy.z);
        audio.play(`gegner-tod.${enemy.type.id}`, enemy.x, enemy.z);
        return;
      }
      // Der Verschlinger fällt: Erfahrung in einem Kranz von Edelsteinen, Gold in einem Kranz von Münzen und ein Segen.
      const { xp, gems, name } = CONFIG.boss;
      for (let i = 0; i < gems; i++) {
        const angle = (i / gems) * Math.PI * 2;
        const distance = 1.6 + this.random() * 2;
        this.pickups.drop(enemy.x + Math.cos(angle) * distance, enemy.z + Math.sin(angle) * distance, xp / gems);
      }
      const { coins, value } = CONFIG.gold.boss;
      for (let i = 0; i < coins; i++) {
        // Zwischen den Edelsteinen, etwas weiter außen.
        const angle = ((i + 0.5) / coins) * Math.PI * 2;
        const distance = 2.4 + this.random() * 1.6;
        this.coins.drop(enemy.x + Math.cos(angle) * distance, enemy.z + Math.sin(angle) * distance, value);
      }
      this.boss.fall();
      // Seine Kiste springt auf; die Gegenstände sind schon gewürfelt (und der Pech-Schutz weitergezählt).
      this.chest.open(enemy.x, enemy.z, this.beute.rollChest());
      audio.play('beute.kiste', enemy.x, enemy.z);
      // Erst stürzt er, dann antwortet die Höhere Macht.
      this.segenDue.push({ name, seconds: BOSS_SEGEN_SECONDS });
      this.hud.announce(`${name} fällt · Eine Kiste springt auf`);
    },
    cast: (enemy, x, z) => {
      const cast = enemy.type.cast;
      if (cast) this.threats.sog(x, z, cast.radius, cast.windup, cast.damage, enemy);
    },
    strike: (enemy) => {
      const strike = enemy.type.strike;
      if (strike) this.threats.arc(enemy.x, enemy.z, enemy.heading, strike.arc, strike.reach, strike.hitAt);
    },
  };

  /**
   * Der Stachelträger fällt: Erfahrung in einem Kranz von Edelsteinen, Gold in einem Kranz von Münzen und ein Segen. Eine Kiste lässt er
   * nicht zurück (das bleibt dem Verschlinger vorbehalten; das ist ein Vorschlag, siehe `CONFIG.stachelboss`).
   */
  private stachelbossFalls(enemy: Enemy): void {
    const { xp, gems, coins, coinValue, segen, name } = CONFIG.stachelboss;
    for (let i = 0; i < gems; i++) {
      const angle = (i / gems) * Math.PI * 2;
      const distance = 1.6 + this.random() * 2;
      this.pickups.drop(enemy.x + Math.cos(angle) * distance, enemy.z + Math.sin(angle) * distance, xp / gems);
    }
    for (let i = 0; i < coins; i++) {
      // Zwischen den Edelsteinen, etwas weiter außen.
      const angle = ((i + 0.5) / coins) * Math.PI * 2;
      const distance = 2.4 + this.random() * 1.6;
      this.coins.drop(enemy.x + Math.cos(angle) * distance, enemy.z + Math.sin(angle) * distance, coinValue);
    }
    this.stachelboss.fall(this.time);
    for (let i = 0; i < segen; i++) this.segenDue.push({ name, seconds: BOSS_SEGEN_SECONDS });
    this.hud.announce(`${name} fällt`);
  }

  /** Legt einen gefallenen Gegenstand hin; ist kein Platz am Boden, geht er gleich in den Beutel. */
  private dropLoot(item: Item, x: number, z: number): void {
    audio.play(`beute.${item.rarity}`, x, z);
    if (item.rarity === 'rar' || item.rarity === 'legendaer') {
      this.hud.announce(`Fund · ${RARITY_LABELS[item.rarity]}: ${itemName(item)}`);
    }
    if (!this.drops.spawn(item, x, z)) this.collectLoot(item);
  }

  /** Die Figur hat einen Gegenstand erreicht: Er liegt jetzt im Beutel und wandert am Ende der Nacht ins Inventar. */
  private readonly collectLoot = (item: Item): void => {
    this.beute.collect(item);
    if (this.lootBest === null || RARITIES.indexOf(item.rarity) > RARITIES.indexOf(this.lootBest)) this.lootBest = item.rarity;
    this.hud.setLoot(this.beute.bag.length, this.lootBest);
    audio.play('beute.eingesammelt');
  };

  /** Das Ende der Nacht: Was noch liegt oder fliegt, geht in den Beutel, dann wandert der Beutel ins Inventar. */
  private settleLoot(): LootSettlement {
    this.drops.flush((item) => this.beute.collect(item));
    for (const item of this.chest.take()) this.beute.collect(item);
    return this.beute.settle();
  }

  /** Die Zeilen der Endanzeige: jeder Gegenstand der Nacht und was aus ihm wurde. */
  private lootLines(loot: LootSettlement): EndLoot[] {
    return loot.items.map(({ item, place, gold }) => ({
      name: itemName(item),
      rarity: item.rarity,
      detail: `${RARITY_LABELS[item.rarity]} · ${slotLabel(item.slot, item.classId)}`,
      note:
        place === 'inventar' ? 'im Inventar' : place === 'truhe' ? 'in der Truhe (Inventar voll)' : `verkauft für ${gold} Gold (Inventar und Truhe voll)`,
    }));
  }

  private setPaused(paused: boolean): void {
    this.phase = paused ? 'paused' : 'playing';
    if (paused) this.menus.showPause();
    else this.menus.hide();
    audio.play('pause');
  }

  /** Stellt die Lebensgruppe an die gewählte Stelle; `save` ist beim Start aus, denn dann kommt der Wert aus dem Speicher. */
  private setVitalsPosition(position: VitalsPosition, save = true): void {
    this.settings.ui.vitalsPosition = position;
    this.hud.setVitalsPosition(position);
    this.menus.showVitalsPosition(position);
    if (save) saveSettings(this.settings);
  }

  /** Schaltet das anonyme Melden der Nächte an die Sammelstelle (`core/sammelstelle.ts`) ein oder aus und merkt es sich. */
  private setShare(share: boolean): void {
    this.settings.data.share = share;
    this.menus.showShare(share);
    saveSettings(this.settings);
  }

  /**
   * Der Hinweis zur anonymen Statistik, einmal je Spieler (`Settings.data.noticeSeen`), auch für alle, die in 0.17.0 noch gefragt wurden.
   * Wer das Senden eingeschaltet hat (der Standard), liest nur und bestätigt. Wer in 0.17.0 "Nicht senden" gewählt hat, bleibt abgeschaltet,
   * bis er hier selbst "Jetzt senden" wählt: Eine ausdrückliche Absage wird nie übergangen. Esc zählt als "Weiter nicht senden" bzw. als gelesen.
   */
  private showDataNotice(): void {
    this.confirming = 'notice';
    const what =
      'Am Ende jeder Nacht meldet das Spiel anonym, welche Klasse du gespielt hast, wie die Nacht endete und was du gewählt hast. ' +
      'So lässt sich das Gleichgewicht verbessern. Es gibt keinen Namen und keine Kennung deines Geräts; beim Übertragen sieht der Dienst ' +
      '(Supabase) wie bei jeder Webanfrage deine IP-Adresse, in der Statistik wird sie nicht gespeichert.';
    if (this.settings.data.share) {
      this.menus.showConfirm(
        { title: 'Anonyme Statistik', text: `${what} Abschalten kannst du es jederzeit in den Optionen unter „Daten“.`, no: 'Verstanden' },
        true,
      );
    } else {
      this.menus.showConfirm(
        {
          title: 'Anonyme Statistik',
          text: `${what} Du hattest „Nicht senden“ gewählt; dabei bleibt es, bis du „Jetzt senden“ wählst. Ändern kannst du es jederzeit in den Optionen unter „Daten“.`,
          no: 'Weiter nicht senden',
          yes: 'Jetzt senden',
          danger: false,
        },
        true,
      );
    }
  }

  /** Der Hinweis ist gelesen; zurück zum Startbildschirm. */
  private closeDataNotice(): void {
    this.confirming = null;
    this.settings.data.noticeSeen = true;
    saveSettings(this.settings);
    this.showMenuHome(true);
  }

  /** Bedienung der Menüs im Startbildschirm und in der Pause: Auf und Ab wählen, Links und Rechts ändern, Enter bestätigt, Esc geht zurück. */
  private updateMenu(): void {
    const { input, menus } = this;
    if (input.wasPressed('pause')) {
      this.menuBack();
      return;
    }
    // In der Anleitung und der Statistik gibt es nur einen Knopf; dort blättern Auf und Ab.
    if (menus.screen === 'help' || menus.screen === 'stats') {
      if (input.wasPressed('up')) menus.scrollPage(-1);
      else if (input.wasPressed('down')) menus.scrollPage(1);
    }
    let moved = false;
    if (input.wasPressed('up')) moved = menus.step(-1);
    else if (input.wasPressed('down')) moved = menus.step(1);
    else if (input.wasPressed('left')) moved = menus.adjust(-1);
    else if (input.wasPressed('right')) moved = menus.adjust(1);
    if (moved) audio.play('auswahl');
    if (input.wasPressed('confirm')) menus.activate();
  }

  /** Esc im Menü: eine Ebene zurück; aus dem Pausenmenü selbst zurück ins Spiel, aus dem Startbildschirm nirgendwohin. */
  private menuBack(): void {
    switch (this.menus.screen) {
      case 'pause':
        this.setPaused(false);
        break;
      case 'title':
      case null:
        break;
      default:
        if (this.confirming === 'notice') this.closeDataNotice();
        else if (this.confirming === 'import' || this.confirming === 'info') {
          this.confirming = null;
          this.pendingImport = null;
          this.menus.showOptions(this.phase === 'title');
        } else {
          this.confirming = null;
          this.showMenuHome(true);
        }
        audio.play('auswahl');
    }
  }

  /** Die Hauptseite des Menüs, von dem Optionen, Anleitung und Rückfragen ausgingen. */
  private showMenuHome(back = false): void {
    if (this.phase === 'title') this.openTitle(back);
    else this.menus.showPause(back);
  }

  private onMenuCommand(command: MenuCommand): void {
    switch (command) {
      case 'resume':
        this.setPaused(false);
        break;
      case 'options':
        // Vom Startbildschirm aus liegt kein Spiel dahinter, das man sehen müsste.
        this.menus.showOptions(this.phase === 'title');
        audio.play('auswahl');
        break;
      case 'stats':
        this.menus.showStats(evaluate(loadRuns()));
        audio.play('auswahl');
        break;
      case 'help':
        this.menus.showHelp();
        audio.play('auswahl');
        break;
      case 'save-export':
        this.exportSavegame();
        break;
      case 'save-import':
        void this.chooseSavegameFile();
        break;
      case 'new':
        if (this.hasProgress()) this.confirmNewGame();
        else this.startNewGame();
        break;
      case 'continue':
        this.menus.hide();
        audio.play('bestaetigen');
        this.openSelect();
        break;
      case 'abort': {
        const keep = Math.round(CONFIG.gold.deathKeep * 100);
        this.confirming = 'abort';
        this.menus.showConfirm({
          title: 'Lauf abbrechen?',
          text:
            keep >= 100
              ? 'Du verlässt die Nacht. Was du bis jetzt erbeutet hast, behältst du, wie bei einem Sturz.'
              : `Du verlässt die Nacht. Vom Ertrag behältst du ${keep} %, wie bei einem Sturz.`,
          no: 'Weiterspielen',
          yes: 'Lauf abbrechen',
        });
        audio.play('auswahl');
        break;
      }
      case 'yes': {
        if (this.confirming === 'notice') {
          this.setShare(true);
          this.closeDataNotice();
          audio.play('bestaetigen');
          break;
        }
        if (this.confirming === 'import') {
          this.applyImport();
          break;
        }
        const confirmed = this.confirming;
        this.confirming = null;
        this.menus.hide();
        if (confirmed === 'abort') this.end('aborted');
        else if (confirmed === 'new') this.startNewGame();
        break;
      }
      case 'no':
      case 'back':
        this.menuBack();
        break;
    }
  }

  /** Ein Hinweis mit einem Knopf; Esc und der Knopf führen zurück in die Optionen (`confirming: 'info'`). */
  private showInfo(title: string, text: string): void {
    this.confirming = 'info';
    this.menus.showConfirm({ title, text, no: 'Weiter' }, this.phase === 'title');
    audio.play('auswahl');
  }

  /** Was ein Stand enthält, für die Rückfragen: "120 Gold und 5 Gegenstände". */
  private describeSavegame({ gold, items, nights }: SavegameSummary): string {
    const grades = nights > 0 ? `, dazu Grade in ${nights} ${nights === 1 ? 'Nachtart' : 'Nachtarten'}` : '';
    return `${gold} Gold und ${items} ${items === 1 ? 'Gegenstand' : 'Gegenstände'}${grades}`;
  }

  /** Gibt es etwas, das ein neues Spiel löschen würde: Gold, Gegenstände oder geschaffte Grade? */
  private hasProgress(): boolean {
    return this.boerse.hasGold() || this.ausruestung.hasAny() || this.grade.hasAny();
  }

  /**
   * Legt den Spielstand als Datei ab (Optionen, "Spielstand als Datei sichern"). Gesichert wird, was im Speicher liegt; jede Änderung von
   * Börse und Ausrüstung ist dort schon angekommen. Ein leerer Stand wird nicht gesichert: Die Datei könnte später einen echten ersetzen.
   */
  private exportSavegame(): void {
    const save = loadSavegame();
    const summary = summarizeSavegame(save);
    if (summary.gold === 0 && summary.items === 0 && summary.nights === 0) {
      this.showInfo('Noch nichts zu sichern', 'Dein Spielstand ist noch leer: Du hast weder Gold noch Gegenstände. Spiele zuerst eine Nacht.');
      return;
    }
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const name = `dao-survivor-spielstand-${day}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
    saveTextFile(name, writeSavegameFile(save, __GAME_VERSION__, now));
    this.showInfo(
      'Spielstand gesichert',
      `${this.describeSavegame(summary)} stehen in der Datei „${name}“. Dein Browser legt sie in seinen Download-Ordner oder fragt dich, wohin. ` +
        'Hebe sie gut auf; über „Spielstand aus Datei laden“ holst du den Stand zurück.',
    );
  }

  /**
   * Lässt den Spieler eine Sicherungsdatei wählen (nur im Hauptmenü, siehe `Menus.showOptions`), prüft sie und fragt, ob sie den jetzigen
   * Stand ersetzen soll. Geschrieben wird erst nach der Antwort (`applyImport`).
   */
  private async chooseSavegameFile(): Promise<void> {
    if (this.phase !== 'title') return;
    audio.play('auswahl');
    const picked = await pickTextFile(MAX_SAVEGAME_FILE_BYTES);
    // Wer abbricht, bleibt in den Optionen. Hat sich das Menü inzwischen geändert, gilt die Antwort nicht mehr.
    if (picked === null || this.phase !== 'title' || this.menus.screen !== 'options') return;
    if ('error' in picked) {
      this.showInfo('Datei nicht geladen', picked.error);
      return;
    }
    const file = readSavegameFile(picked.text);
    if (!file) {
      this.showInfo('Kein Spielstand', 'Diese Datei ist kein Spielstand von DAO-Survivor. Gewählt werden muss eine Datei, die das Spiel mit „Spielstand als Datei sichern“ angelegt hat.');
      return;
    }
    this.pendingImport = file.save;
    this.confirming = 'import';
    const when = file.savedAt === null ? '' : ` (gesichert am ${new Date(file.savedAt).toLocaleDateString('de-DE')})`;
    const newer = file.newer
      ? ' Sie stammt aus einer neueren Fassung des Spiels; was diese Fassung nicht kennt, bleibt erhalten, wird aber nicht angezeigt.'
      : '';
    this.menus.showConfirm(
      {
        title: 'Spielstand ersetzen?',
        text:
          `Die Datei${when} enthält ${this.describeSavegame(summarizeSavegame(file.save))}. Dein jetziger Stand hat ` +
          `${this.describeSavegame(summarizeSavegame(loadSavegame()))}; er wird ersetzt und lässt sich nicht zurückholen. ` +
          `Sichere ihn vorher, wenn du ihn noch brauchst. Die Optionen und die Statistik bleiben.${newer}`,
        no: 'Abbrechen',
        yes: 'Stand ersetzen',
      },
      true,
    );
    audio.play('auswahl');
  }

  /** Die Antwort "Stand ersetzen": schreibt den Stand aus der Datei und lässt Börse und Ausrüstung ihn neu lesen. */
  private applyImport(): void {
    const save = this.pendingImport;
    this.pendingImport = null;
    if (!save) {
      this.confirming = null;
      this.showMenuHome(true);
      return;
    }
    writeSavegame(save);
    this.boerse.reload();
    this.ausruestung.reload();
    this.grade.reload();
    this.confirming = 'imported';
    this.menus.showConfirm(
      {
        title: 'Spielstand geladen',
        text: `Dein Spielstand ist jetzt der aus der Datei: ${this.describeSavegame(summarizeSavegame(save))}. „Spiel fortsetzen“ führt dich weiter.`,
        no: 'Weiter',
      },
      true,
    );
    audio.play('bestaetigen');
  }

  /** Warnt vor dem Löschen des Spielstands und nennt, was verloren ginge. */
  private confirmNewGame(): void {
    const items = CLASSES.reduce((sum, entry) => sum + this.ausruestung.count(entry.id), this.ausruestung.chestCount());
    const lost: string[] = [];
    if (this.boerse.gold > 0) lost.push(`${this.boerse.gold} Gold`);
    if (items > 0) lost.push(`${items} ${items === 1 ? 'Gegenstand' : 'Gegenstände'}`);
    const nights = NIGHTS.filter((night) => this.grade.cleared(night.id) >= 0).length;
    if (nights > 0) lost.push(`die Grade von ${nights} ${nights === 1 ? 'Nachtart' : 'Nachtarten'}`);
    this.confirming = 'new';
    this.menus.showConfirm({
      title: 'Neues Spiel beginnen?',
      text: `Dein Fortschritt wird zurückgesetzt: ${joinAnd(lost)} gehen verloren. Das lässt sich nicht rückgängig machen. Die Optionen und die Statistik bleiben.`,
      no: 'Abbrechen',
      yes: 'Fortschritt löschen',
    }, true);
    audio.play('auswahl');
  }

  /** Beginnt bei null: leere Börse, keine Gegenstände, dann die Klassenwahl. */
  private startNewGame(): void {
    this.boerse.reset();
    this.ausruestung.reset();
    this.grade.reload();
    this.menus.hide();
    audio.play('bestaetigen');
    this.openSelect();
  }

  /** Der Startbildschirm; auch das Ziel von "Hauptmenü" bei der Klassenwahl und am Ende der Nacht. */
  private openTitle(back = false): void {
    this.phase = 'title';
    this.hud.hideChoice();
    this.hud.hideEnd();
    this.lager.close();
    this.confirming = null;
    this.menus.showTitle(this.hasProgress(), back);
  }

  /** Die Klassenwahl vor der Nacht; `selected` markiert eine Klasse, sonst die zuletzt gespielte. */
  private openSelect(selected = Math.max(0, CLASSES.indexOf(this.playerClass))): void {
    this.phase = 'select';
    this.selected = selected;
    this.hud.hideEnd();
    this.lager.close();
    this.updateLagerAccess();
    // Wer Ränge der entfallenen Steigerungen hatte, liest hier einmal, wohin das Gold dafür gegangen ist.
    const { refund } = this.boerse;
    this.hud.showChoice(
      'Die Abendglocke läutet',
      'Wer steht heute Nacht vor der Mauer?',
      CLASSES.map((playerClass) => ({
        name: playerClass.name,
        text: playerClass.text,
        note: playerClass.home,
        extra: this.lagerEnabled ? `Ausrüstung: ${this.ausruestung.equippedItems(playerClass.id).length} von 9` : undefined,
      })),
      this.selected,
      this.boerse.gold,
      refund > 0
        ? `Die Steigerungen sind entfallen: Die ${refund} Gold, die in ihren Rängen steckten, liegen wieder in deiner Börse. Beim Händler im Lager (L) kaufst du dafür Gegenstände.`
        : '',
    );
    // Gelesen ist die Erklärung, sobald sie auf dem Bildschirm stand; beim nächsten Mal bleibt sie weg.
    this.boerse.acknowledgeRefund();
  }

  /**
   * Nach der Klasse die Wahl des Startangriffs: Alle sieben Angriffe der Klasse stehen offen, einer beginnt die Nacht auf Rang 1.
   * Vorgewählt ist der, mit dem die Klasse zuletzt begann, sonst ihr üblicher erster; Enter bestätigt ihn also gleich.
   */
  private openStart(playerClass: ClassDef): void {
    this.phase = 'start';
    this.pendingClass = playerClass;
    const [usual] = playerClass.weapons;
    const remembered = this.lastStart.get(playerClass.id) ?? usual;
    this.selected = Math.max(0, playerClass.weapons.indexOf(remembered ?? ''));
    this.hud.showChoice(
      playerClass.name,
      'Mit welchem Angriff beginnst du die Nacht?',
      playerClass.weapons.map((id) => {
        const def = weaponById(id);
        return { name: def.name, text: def.text, note: id === usual ? 'Der übliche Beginn' : 'Beginnt auf Rang 1' };
      }),
      this.selected,
      null,
      '',
      true,
    );
    this.hud.setChoiceKeys('1 bis 7 oder Pfeiltasten und Enter: Nacht beginnen · Esc: zurück zur Klassenwahl');
    audio.play('auswahl');
  }

  /**
   * Nach dem Startangriff die Wahl der Nachtart (siehe `nights.ts`); vorgewählt ist die zuletzt gewählte. Hat man eine Nachtart schon geschafft,
   * zeigt ihre Karte den Grad (siehe `grade.ts`) und beginnt beim höchsten, den man wählen darf.
   */
  private openNight(): void {
    this.phase = 'night';
    this.selected = Math.max(0, NIGHTS.findIndex((night) => night.id === this.lastNight));
    this.grade.refresh();
    this.chosenGrade.clear();
    for (const night of NIGHTS) this.chosenGrade.set(night.id, this.grade.highest(night.id));
    this.hud.showChoice(
      'Was für eine Nacht?',
      'Schwerere Nächte zahlen besser',
      NIGHTS.map((night) => ({
        name: night.name,
        text: night.text,
        note: night.note,
        extra: night.reward,
        grade: this.gradeCard(night.id),
      })),
      this.selected,
    );
    this.hud.setChoiceKeys(
      `1 bis ${NIGHTS.length} oder Pfeiltasten und Enter: Nacht beginnen · Pfeil hoch und runter oder + und −: Grad · Esc: zurück zum Startangriff`,
    );
    audio.play('auswahl');
  }

  /** Der Gradzähler auf der Karte einer Nachtart; `undefined`, solange man sie nie geschafft hat (dann gibt es nur Grad 0). */
  private gradeCard(id: NightId): ChoiceGrade | undefined {
    const cleared = this.grade.cleared(id);
    if (cleared < 0) return undefined;
    const value = this.chosenGrade.get(id) ?? 0;
    return {
      value,
      max: this.grade.highest(id),
      effect: describeGrade(value),
      cleared: `Geschafft bis Grad ${cleared}`,
    };
  }

  /**
   * Stellt den Grad einer Nachtart um `step` ein, nie unter 0 und nie über den geschafften Grad plus 1. `index` ist die Karte der Nachtart;
   * ohne Angabe gilt die gewählte (Pfeiltasten).
   */
  private stepGrade(step: number, index = this.selected): void {
    if (this.phase !== 'night') return;
    const night = NIGHTS[index];
    if (!night || this.grade.cleared(night.id) < 0) return;
    const before = this.chosenGrade.get(night.id) ?? 0;
    const after = Math.min(this.grade.highest(night.id), Math.max(0, before + step));
    if (after === before) return;
    this.chosenGrade.set(night.id, after);
    const card = this.gradeCard(night.id);
    if (card) this.hud.setGrade(index, card);
    audio.play('auswahl');
  }

  private startRun(
    playerClass: ClassDef,
    startWeapon: string = playerClass.weapons[0] ?? '',
    night: NightDef = USUAL_NIGHT,
    grade = 0,
  ): void {
    this.night = night;
    this.runGrade = grade;
    const rules = rulesAt(night, grade);
    this.runSeed = this.nextSeed ?? newRunSeed();
    this.nextSeed = null;
    this.stream = createRandom(deriveSeed(this.runSeed, 900));
    this.playerClass = playerClass;
    this.time = 0;
    this.pendingLevels = 0;
    this.pendingSegen = 0;
    this.segenDue.length = 0;
    this.segenFor.length = 0;
    this.rerolls = CONFIG.run.rerolls;
    this.banishes = CONFIG.run.banishes;
    this.banished.clear();
    this.banishing = false;
    this.searIn = 0;
    this.shownLight = 0;
    this.wasInLight = false;
    this.weakened = 0;
    this.goldRun = 0;
    this.hud.setGold(0);
    this.progression.reset(playerClass, (stats) => {
      this.ausruestung.apply(playerClass.id, stats);
      applyNightStats(rules, stats);
    });
    this.player.setClass(playerClass, this.models?.heroes.get(playerClass.id) ?? null);
    this.player.reset();
    this.dust.setLightColor(playerClass.lightColor);
    this.events.clear();
    this.fields.reset();
    this.events.add(this.fields);
    this.events.add(this.arsenal.listener);
    this.enemies.reset(this.runSeed, rules);
    this.pickups.reset();
    this.coins.reset();
    this.drops.reset();
    this.chest.reset();
    this.beute.start(playerClass.id, this.runSeed);
    this.lootBest = null;
    this.hud.setLoot(0, null);
    this.zones.reset(this.runSeed, rules.clouds);
    this.syncLight();
    this.applyBlessings();
    this.threats.reset();
    this.boss.reset(rules.bossHp);
    this.stachelboss.reset(rules.bossHp, this.runSeed);
    this.hud.setBoss(null);
    this.arsenal.reset(playerClass, this.ausruestung.evolutionsOf(playerClass.id), startWeapon);
    finsternisUniforms.uSense.value = playerClass.id === 'wildnislaeufer' ? 1 : 0;
    this.traitLabel = '';
    this.rig.snapTo(this.player.position);
    this.updateDawn();
    this.refreshHud();
    this.phase = 'playing';
    audio.play('abendglocke');
    // Eine besondere Nacht oder ein höherer Grad nennt sich: im Bild kurz und über der Uhr, solange die Nacht dauert.
    const title = this.nightTitle();
    this.hud.setNightName(title === '' ? null : title);
    if (title !== '') this.hud.announce(title);
  }

  /** Wie sich die laufende Nacht nennt: „Rotnacht · Grad 2“; leer für die gewöhnliche Nacht im Grad 0. */
  private nightTitle(): string {
    const grade = this.runGrade > 0 ? ` · Grad ${this.runGrade}` : '';
    if (this.night === USUAL_NIGHT && grade === '') return '';
    return `${this.night.name}${grade}`;
  }

  /** Überträgt, was Klasse und Segen an den Feuerschalen ändern. */
  private applyBlessings(): void {
    const stats = this.progression.stats;
    const classBurn = this.playerClass.id === 'kaempfer' ? TRAITS.kaempfer.burnFactor : 1;
    this.zones.burnFactor = classBurn * stats.burn;
    this.zones.igniteFactor = stats.ignite;
  }

  /** Stellt bis zu drei Segen zur Wahl; gibt false zurück, wenn in dieser Nacht keiner mehr offen ist. */
  private offerSegen(title: string): boolean {
    const pool = this.progression.openSegen().map(
      (segen): Offer => ({
        key: `segen:${segen.id}`,
        name: segen.name,
        text: segen.text,
        note: segen.macht,
        segen: true,
        take: () => this.progression.bless(segen),
      }),
    );
    if (!this.deal(pool)) return false;
    this.showOffers(title, SEGEN_SUBTITLE);
    audio.play('segen');
    return true;
  }

  /**
   * Zieht das Angebot aus den Karten, die in dieser Nacht nicht verbannt sind; gibt false zurück, wenn keine bleibt.
   * `pool` merkt sich das Spiel für Neuwurf und Verbannen.
   */
  private deal(pool: Offer[]): boolean {
    this.pool = pool.filter((offer) => !this.banished.has(offer.key));
    this.offers = this.draw(this.pool);
    return this.offers.length > 0;
  }

  /**
   * Zieht bis zu drei Karten aus dem Vorrat. Karten aus `avoid` kommen nur dann wieder, wenn der Vorrat sonst nicht für drei reicht,
   * damit ein Neuwurf möglichst etwas Neues zeigt.
   */
  private draw(pool: readonly Offer[], avoid: readonly Offer[] = []): Offer[] {
    const sources = [pool.filter((offer) => !avoid.includes(offer)), pool.filter((offer) => avoid.includes(offer))];
    const drawn: Offer[] = [];
    for (const source of sources) {
      while (drawn.length < 3 && source.length > 0) drawn.push(...source.splice(Math.floor(this.random() * source.length), 1));
    }
    return drawn;
  }

  /** Zeigt das gezogene Angebot samt Neuwurf und Verbannen und hält die Wahl an. */
  private showOffers(title: string, subtitle: string): void {
    this.offerTitle = title;
    this.offerSubtitle = subtitle;
    this.banishing = false;
    this.selected = 0;
    this.phase = 'levelup';
    this.hud.showChoice(title, subtitle, this.offers, this.selected);
    this.showTools();
  }

  /** Gibt es Karten im Vorrat, die gerade nicht zu sehen sind? Nur dann haben Neuwurf und Verbannen etwas zu tun. */
  private canSwap(): boolean {
    return this.pool.length > this.offers.length;
  }

  private showTools(): void {
    this.hud.setChoiceTools({
      rerolls: this.rerolls,
      banishes: this.banishes,
      swappable: this.canSwap(),
      banishing: this.banishing,
    });
  }

  /** Würfelt die Karten neu; sie kosten einen der Neuwürfe dieser Nacht. */
  private reroll(): void {
    if (this.phase !== 'levelup' || this.rerolls <= 0 || !this.canSwap()) return;
    this.rerolls--;
    this.offers = this.draw(this.pool, this.offers);
    this.showOffers(this.offerTitle, this.offerSubtitle);
    audio.play('auswahl');
  }

  /** Schaltet um, ob die nächste gewählte Karte verbannt statt genommen wird. */
  private toggleBanishing(): void {
    if (this.phase !== 'levelup') return;
    if (!this.banishing && (this.banishes <= 0 || !this.canSwap())) return;
    this.banishing = !this.banishing;
    this.hud.setChoiceSubtitle(this.banishing ? 'Welche Karte soll bis zum Morgen verschwinden?' : this.offerSubtitle);
    this.showTools();
    audio.play('auswahl');
  }

  /** Streicht die Karte für den Rest der Nacht aus dem Angebot; eine andere aus dem Vorrat tritt an ihre Stelle. */
  private banish(index: number): void {
    const gone = this.offers[index];
    if (!gone || this.banishes <= 0 || !this.canSwap()) return;
    this.banishes--;
    this.banished.add(gone.key);
    this.pool = this.pool.filter((offer) => offer !== gone);
    const [replacement] = this.draw(this.pool.filter((offer) => !this.offers.includes(offer)));
    if (replacement) this.offers[index] = replacement;
    else this.offers.splice(index, 1);
    this.selected = Math.min(index, this.offers.length - 1);
    this.banishing = false;
    this.hud.showChoice(this.offerTitle, this.offerSubtitle, this.offers, this.selected);
    this.showTools();
    audio.play('bestaetigen');
  }

  /** Der Segen für einen erschlagenen Boss. */
  private openBossSegen(): void {
    this.pendingSegen--;
    this.offerSegen(`${this.segenFor.shift() ?? CONFIG.boss.name} ist gefallen`);
  }

  private openLevelUp(): void {
    // Auf jeder fünften Stufe antwortet eine Höhere Macht.
    const level = this.progression.level - (this.pendingLevels - 1);
    if (level % SEGEN_EVERY_LEVELS === 0 && this.offerSegen(`Stufe ${level}`)) {
      this.pendingLevels--;
      return;
    }
    const candidates: Offer[] = [
      ...this.arsenal.open().map(({ def, rank }) => ({
        key: `angriff:${def.id}`,
        name: def.name,
        // Was der nächste Rang bringt, steht auf der Karte; ohne Angabe die Kurzbeschreibung.
        text: def.rankText?.[rank] ?? def.text,
        // Schaltet der angelegte Ring seine Evolution frei, steht auf der Karte schon, was aus dem Angriff wird.
        note:
          rank === 0
            ? 'Neuer Angriff'
            : `Rang ${rank + 1} von ${MAX_RANK}${rank + 1 === MAX_RANK && this.arsenal.unlocks(def) ? ` · wird zu ${def.evolution?.name ?? ''}` : ''}`,
        take: () => this.arsenal.take(def),
      })),
      ...this.progression.open().map((upgrade) => ({
        key: `staerkung:${upgrade.id}`,
        name: upgrade.name,
        text: upgrade.text,
        note: `Rang ${this.progression.rank(upgrade) + 1} von ${upgrade.max}`,
        take: () => this.progression.take(upgrade),
      })),
    ];
    if (!this.deal(candidates)) {
      // Alles ausgereizt (oder verbannt): es gibt nichts mehr zu wählen.
      this.pendingLevels = 0;
      return;
    }
    this.pendingLevels--;
    this.showOffers(`Stufe ${this.progression.level - this.pendingLevels}`, 'Wähle eine Stärkung');
    audio.play('stufe');
  }

  /** Gemeinsame Bedienung der Auswahlen: Klasse, Startangriff und Stärkung. */
  private updateChoice(): void {
    const count =
      this.phase === 'select'
        ? CLASSES.length
        : this.phase === 'start'
          ? (this.pendingClass?.weapons.length ?? 0)
          : this.phase === 'night'
            ? NIGHTS.length
            : this.offers.length;
    if (count === 0) return;
    const before = this.selected;
    if (this.input.wasPressed('left')) this.selected = (this.selected + count - 1) % count;
    if (this.input.wasPressed('right')) this.selected = (this.selected + 1) % count;
    if (this.selected !== before) audio.play('auswahl');
    this.hud.select(this.selected);

    if (this.phase === 'select' && this.input.wasPressed('lager') && this.lagerEnabled) {
      this.openLager(this.selected);
      return;
    }
    if (this.phase === 'select' && this.input.wasPressed('pause')) {
      this.openTitle();
      return;
    }
    if (this.phase === 'start' && this.input.wasPressed('pause')) {
      this.openSelect(Math.max(0, CLASSES.findIndex((entry) => entry === this.pendingClass)));
      return;
    }
    if (this.phase === 'night' && this.input.wasPressed('pause')) {
      if (this.pendingClass) this.openStart(this.pendingClass);
      return;
    }
    if (this.phase === 'night') {
      if (this.input.wasPressed('up') || this.input.wasPressed('gradeUp')) this.stepGrade(1);
      if (this.input.wasPressed('down') || this.input.wasPressed('gradeDown')) this.stepGrade(-1);
    }
    if (this.phase === 'levelup') {
      if (this.input.wasPressed('reroll')) {
        this.reroll();
        return;
      }
      if (this.input.wasPressed('banish')) {
        this.toggleBanishing();
        return;
      }
      // Wer verbannen wollte und es sich anders überlegt, bricht mit Esc ab; die Pause gibt es hier nicht.
      if (this.banishing && this.input.wasPressed('pause')) {
        this.toggleBanishing();
        return;
      }
    }
    const choice = CHOICE_ACTIONS.findIndex((action) => this.input.wasPressed(action));
    if (choice >= 0) this.pick(choice);
    else if (this.input.wasPressed('confirm')) this.pick(this.selected);
  }

  private pick(index: number): void {
    if (this.phase === 'select') {
      const playerClass = CLASSES[index];
      if (!playerClass) return;
      this.openStart(playerClass);
      return;
    }
    if (this.phase === 'start') {
      const playerClass = this.pendingClass;
      const start = playerClass?.weapons[index];
      if (!playerClass || !start) return;
      this.lastStart.set(playerClass.id, start);
      this.pendingStart = start;
      this.openNight();
      return;
    }
    if (this.phase === 'night') {
      const playerClass = this.pendingClass;
      const night = NIGHTS[index];
      if (!playerClass || !night) return;
      this.lastNight = night.id;
      this.pendingClass = null;
      this.hud.hideChoice();
      this.startRun(playerClass, this.pendingStart, night, this.chosenGrade.get(night.id) ?? 0);
      return;
    }

    if (this.phase === 'levelup' && this.banishing) {
      this.banish(index);
      return;
    }
    const offer = this.offers[index];
    if (this.phase !== 'levelup' || !offer) return;
    const stats = this.progression.stats;
    const maxHpBefore = stats.maxHp;
    audio.play('bestaetigen');
    offer.take();
    this.player.grantHp(stats.maxHp - maxHpBefore);
    this.applyBlessings();
    this.hud.hideChoice();
    this.refreshHud();
    this.phase = 'playing';
    if (this.pendingSegen > 0) this.openBossSegen();
    else if (this.pendingLevels > 0) this.openLevelUp();
  }

  /** Was aus einem Boss geworden ist, für den Text zum Sonnenaufgang; leer, wenn er nicht erschien. */
  private bossFate(name: string, boss: { slain: boolean; appeared: boolean }): string {
    if (boss.slain) return ` ${name} ist gefallen.`;
    return boss.appeared ? ` ${name} weicht mit der Finsternis.` : '';
  }

  private end(outcome: 'won' | 'fallen' | 'aborted'): void {
    const won = outcome === 'won';
    this.phase = 'ended';
    this.won = won;
    this.aborted = outcome === 'aborted';
    // Der letzte Frame läuft knapp über das Ende der Nacht hinaus.
    const survived = Math.min(this.time, CONFIG.run.nightSeconds);
    const title = this.nightTitle();
    const nightName = title === '' ? '' : ` · ${title}`;
    const stats = `${this.playerClass.name}${nightName} · Überlebt: ${formatTime(survived)} · Stufe ${this.progression.level} · Erschlagen: ${this.enemies.kills}`;
    this.recordNight(outcome, survived);
    // Nur der Sonnenaufgang zählt als geschafft; wer fällt oder abbricht, behält den Grad, den er schon hat.
    const unlocked = won && this.grade.record(this.night.id, this.runGrade) ? this.grade.highest(this.night.id) : null;
    this.hud.setEndSeed(formatSeed(this.runSeed));
    const loot = this.settleLoot();
    const gold = this.settle(won, survived, loot.gold);
    const lines = this.lootLines(loot);
    // Eine gespielte Nacht lässt den Händler neu auswürfeln; ein Lauf, den man gleich wieder abbricht, zählt nicht.
    if (outcome !== 'aborted' || survived >= CONFIG.items.shop.minNightSeconds) this.ausruestung.nightPlayed();
    this.updateLagerAccess();
    this.hud.setBoss(null);
    if (outcome === 'aborted') {
      this.hud.showEnd('Lauf abgebrochen', 'Du hast dich aus der Nacht zurückgezogen.', stats, gold, lines);
    } else if (won) {
      this.world.setDawn(1);
      const fate = this.bossFate(CONFIG.boss.name, this.boss) + this.bossFate(CONFIG.stachelboss.name, this.stachelboss);
      const unlock = unlocked === null ? '' : ` Freigeschaltet: ${this.night.name}, Grad ${unlocked}.`;
      this.hud.showEnd('Sor geht auf', `Du hast die Nacht vor der Mauer überstanden.${fate}${unlock}`, stats, gold, lines);
    } else {
      this.player.die();
      if (this.player.lastDamage === 'verstaubung') {
        this.hud.showEnd('Verstaubt', 'Die Finsternis hat dich behalten.', stats, gold, lines);
      } else {
        this.hud.showEnd('Gefallen', 'Die Nacht hat dich geholt.', stats, gold, lines);
      }
    }
  }

  /**
   * Hält die Nacht für die Statistik fest: Klasse, Ausgang, Zeit, Stufe, die gewählten Stärkungen und Segen und den Rang jeder Fertigkeit.
   * Es zählt wie bei der gespielten Nacht des Händlers: Ein Lauf, den man vor `minNightSeconds` abbricht, fehlt im Protokoll.
   */
  private recordNight(outcome: RunOutcome, survived: number): void {
    if (!this.recordStats) return;
    if (outcome === 'aborted' && survived < CONFIG.items.shop.minNightSeconds) return;
    const upgrades: Record<string, number> = {};
    for (const upgrade of UPGRADES) {
      const rank = this.progression.rank(upgrade);
      if (rank > 0) upgrades[upgrade.id] = rank;
    }
    const skills: Record<string, number> = {};
    for (const id of this.playerClass.weapons) {
      const rank = this.arsenal.rankOf(id);
      if (rank > 0) skills[id] = rank;
    }
    const run: RunRecord = {
      id: newRunId(),
      at: Date.now(),
      version: __GAME_VERSION__,
      classId: this.playerClass.id,
      outcome,
      seconds: Math.round(survived),
      level: this.progression.level,
      upgrades,
      segen: this.progression.blessed.map((segen) => segen.id),
      skills,
    };
    recordRun(run);
    // Standardmäßig an, in den Optionen abschaltbar (`setShare`). Der Messlauf kommt gar nicht bis hierher (`recordStats`); aus dem
    // Dev-Modus geht nichts hinaus, denn die Sammelstelle zählt Nächte der Fassung "-dev" ohnehin nicht (siehe `tools/supabase/statistik.sql`).
    if (this.settings.data.share && !import.meta.env.DEV) sendRun(run);
  }

  /**
   * Rechnet den Ertrag der Nacht ab und schreibt ihn der Geldbörse gut: die eingesammelten Münzen, den Sold für die
   * überlebte Zeit und, wenn die Sonne aufgeht, die Prämie. Wer fällt, behält `CONFIG.gold.deathKeep` davon.
   * Dazu kommt, was der Verkauf überzähliger Gegenstände einbrachte (`sold`); das behält man immer ganz, denn die Gegenstände
   * bleiben auch beim Sturz erhalten. Gibt die Zeile für die Endanzeige zurück.
   */
  private settle(won: boolean, survived: number, sold: number): string {
    const { perMinute, victory, deathKeep } = CONFIG.gold;
    const factor = this.progression.stats.gold;
    const loot = Math.round(this.goldRun);
    const pay = Math.round(Math.floor(survived / 60) * perMinute * factor);
    const bonus = won ? Math.round(victory * factor) : 0;
    const kept = won ? 1 : deathKeep;
    const total = Math.round((loot + pay + bonus) * kept) + sold;
    this.boerse.credit(total);
    const parts = [`Münzen ${loot}`, `Sold ${pay}`];
    if (won) parts.push(`Sonnenaufgang ${bonus}`);
    if (sold > 0) parts.push(`Verkauf ${sold}`);
    const cut = kept < 1 ? ` · davon behalten: ${Math.round(kept * 100)} %` : '';
    return `${parts.join(' · ')}${cut} · Ertrag: +${total} Gold · Börse: ${this.boerse.gold}`;
  }

  /**
   * Schaltet das Lager frei: im Entwicklungsmodus immer, im fertigen Spiel erst, wenn es Gegenstände gibt oder Gold für den Händler.
   * Sonst bliebe das Menü ein leerer Bildschirm.
   */
  private updateLagerAccess(): void {
    this.lagerEnabled = import.meta.env.DEV || this.ausruestung.hasAny() || this.boerse.gold > 0;
    this.hud.setLagerEnabled(this.lagerEnabled);
  }

  /** Öffnet das Lager aus der Klassenwahl (für die markierte Klasse) oder vom Ende der Nacht (für die gespielte). */
  private openLagerFromMenu(): void {
    if (!this.lagerEnabled) return;
    if (this.phase === 'select') this.openLager(this.selected);
    else if (this.phase === 'ended') this.openLager(Math.max(0, CLASSES.indexOf(this.playerClass)));
  }

  private openLager(classIndex: number): void {
    this.phase = 'lager';
    this.hud.hideChoice();
    this.hud.hideEnd();
    audio.play('auswahl');
    this.lager.open(classIndex);
  }

  /** Zurück zur Klassenwahl, mit der Klasse markiert, deren Ausrüstung eben zu sehen war. */
  private closeLager(): void {
    if (this.phase !== 'lager') return;
    audio.play('auswahl');
    this.lager.close();
    // Der Handel im Lager hat das Gold im Spielstand geändert; die Börse und die Klassenwahl sollen es kennen.
    this.boerse.reload();
    this.openSelect(this.lager.classIndex);
  }

  /** In den letzten Sekunden der Nacht hellt der Staub zum Zwielicht des Tages auf. */
  private updateDawn(): void {
    const { nightSeconds, dawnSeconds } = CONFIG.run;
    const t = Math.min(1, Math.max(0, (this.time - (nightSeconds - dawnSeconds)) / dawnSeconds));
    const amount = t * t * (3 - 2 * t);
    this.world.setDawn(amount);
    this.background.lerpColors(NIGHT_BACKGROUND, DAWN_BACKGROUND, amount);
    this.fog.color.copy(this.background);
  }

  /** Welche Musik zu dem passt, was gerade läuft. */
  private wantedMusic(): MusicId {
    switch (this.phase) {
      case 'loading':
      case 'title':
      case 'select':
      case 'start':
      case 'night':
      case 'lager':
        return 'menue';
      case 'ended':
        return this.aborted ? 'menue' : this.won ? 'sieg' : 'niederlage';
      default:
        if (this.boss.enemy || this.stachelboss.enemy) return 'boss';
        return this.time >= CONFIG.audio.music.lateFrom ? 'nacht-spaet' : 'nacht';
    }
  }

  /** Das Ohr der Spielfigur, Musik und Dauerklänge; einmal je Frame, in jeder Phase. */
  private updateAudio(): void {
    const { x, z } = this.player.position;
    const night = this.phase === 'playing' || this.phase === 'levelup' || this.phase === 'paused';
    // Die Finsternis dämpft jeden Laut, aber nur in der Nacht und nicht in den Menüs davor und danach.
    const finsternis = night ? this.zones.finsternisAt(x, z) : 0;
    const duck: Duck = this.phase === 'paused' ? 'paused' : this.phase === 'levelup' ? 'choice' : 'none';
    audio.setDuck(duck);
    audio.setMusic(this.wantedMusic());
    audio.update(x, z, finsternis);

    // Die Welt klingt nur, solange sie sich bewegt; in der Pause schweigt sie bis auf die Musik.
    if (this.phase !== 'playing' && this.phase !== 'levelup') return;
    audio.loop('wind.nacht', 1);
    audio.loop('finsternis.brummen', Math.min(1, finsternis * 1.25));
    this.fireDistance = Infinity;
    this.zones.eachBurning(this.measureFire);
    if (this.fireDistance < Infinity) audio.loop('feuer.knistern', 1, this.fireX, this.fireZ);
  }

  /** Merkt sich die brennende Feuerschale, die der Spielfigur am nächsten steht. */
  private readonly measureFire = (island: Site): void => {
    const position = this.player.position;
    const distance = Math.hypot(island.x - position.x, island.z - position.z);
    if (distance >= this.fireDistance) return;
    this.fireDistance = distance;
    this.fireX = island.x;
    this.fireZ = island.z;
  };

  /** Hin und wieder ruft ein Gegner in Hörweite; je dichter die Horde, desto öfter. */
  private callHorde(dt: number): void {
    this.callIn -= dt;
    if (this.callIn > 0) return;
    const { callEvery, range, busy } = CONFIG.audio.horde;
    const { alive } = this.enemies;
    this.callIn = (callEvery.min + Math.random() * (callEvery.max - callEvery.min)) / (1 + alive.length / busy);
    const position = this.player.position;
    // Ein paar Versuche reichen: Wer weit weg steht, wird ohnehin nicht gehört. Der Zufall gehört nur dem Ohr.
    for (let attempt = 0; attempt < 6 && alive.length > 0; attempt++) {
      const enemy = alive[Math.floor(Math.random() * alive.length)];
      if (!enemy || enemy.hp <= 0 || enemy === this.boss.enemy || enemy === this.stachelboss.enemy) continue;
      if (Math.hypot(enemy.x - position.x, enemy.z - position.z) > range) continue;
      audio.play(`gegner-laut.${enemy.type.id}`, enemy.x, enemy.z);
      return;
    }
  }

  private refreshHud(): void {
    const { x, z } = this.player.position;
    this.hud.setVitals(this.player.hp, this.player.verstaubung, this.progression.stats.maxHp);
    this.hud.setProgress(this.progression.level, this.progression.xp / this.progression.needed);
    this.hud.setClock(CONFIG.run.nightSeconds - this.time);
    this.hud.setZone(this.zones.zoneAt(x, z), this.zones.finsternisAt(x, z));
    // Wer von Stacheln festgehalten wird, sieht es an der Stelle der Besonderheit der Klasse: Das ist die wichtigere Nachricht.
    this.hud.setTrait(this.player.rootedFor > 0 ? 'Festgesetzt' : this.traitLabel);
    this.hud.setIgnite(this.zones.igniteProgress);
    this.hud.setCompass(this.zones.nearestIsland(x, z, this.bearing));
    // Die Leiste zeigt den Boss, der gerade bedrohlicher ist: der Verschlinger, solange er lebt, sonst der Stachelträger.
    if (this.boss.enemy) this.hud.setBoss(CONFIG.boss.name, this.boss.hpFraction);
    else this.hud.setBoss(this.stachelboss.enemy ? CONFIG.stachelboss.name : null, this.stachelboss.hpFraction);
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.rig.resize(width / height);
    this.dust.resize(this.renderer.domElement.height, CONFIG.camera.fov);
    this.arsenal.resize(this.renderer.domElement.height, CONFIG.camera.fov);
    this.threats.resize(this.renderer.domElement.height, CONFIG.camera.fov);
    this.zones.resize(this.renderer.domElement.height, CONFIG.camera.fov);
  };

  private updateDebug(frameSeconds: number): void {
    if (!this.hud.debugEnabled) return;
    this.fpsFrames++;
    this.fpsSeconds += frameSeconds;
    if (this.fpsSeconds < 0.5) return;
    const { x, z } = this.player.position;
    this.hud.setDebug(
      `${Math.round(this.fpsFrames / this.fpsSeconds)} FPS · Gegner ${this.enemies.alive.length} · x ${x.toFixed(1)} · z ${z.toFixed(1)}`,
    );
    this.fpsFrames = 0;
    this.fpsSeconds = 0;
  }
}
