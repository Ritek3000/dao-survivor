import * as THREE from 'three';
import { audio, type Duck, type MusicId } from '../audio';
import { CONFIG } from '../config';
import { Input, type MoveVector } from '../core/input';
import { createRandom } from '../core/random';
import { loadSettings, saveSettings, type Settings, type VitalsPosition } from '../core/settings';
import { formatTime, type EndLoot, type Hud } from '../ui/hud';
import { LagerView } from '../ui/lagerView';
import { Menus, type MenuCommand } from '../ui/menus';
import { Arsenal, type CombatTraits } from './arsenal';
import { Ausruestung } from './ausruestung';
import { Boerse } from './boerse';
import { Beute, type LootSettlement } from './beute';
import { Boss } from './boss';
import { CameraRig } from './cameraRig';
import { CLASSES, TRAITS, type ClassDef } from './classes';
import { Coins } from './coins';
import { finsternisUniforms } from './darkness';
import { Chest, Drops } from './drops';
import { Dust } from './dust';
import { Enemies, type EnemyHooks } from './enemies';
import { CombatEvents } from './events';
import { Fields } from './fields';
import { itemName, RARITIES, RARITY_LABELS, slotLabel, type Item, type Rarity } from './items';
import { Lager } from './lager';
import { loadModels, type Models } from './models';
import { Pickups } from './pickups';
import { Player } from './player';
import { Progression, SEGEN_EVERY_LEVELS } from './progression';
import { Threats } from './threats';
import { MAX_RANK } from './weapons';
import { World } from './world';
import { Zones, type IslandBearing, type Site, type Zone } from './zones';

/** Obergrenze je Frame, damit ein Ruckler oder Tab-Wechsel keinen Sprung auslöst. */
const MAX_FRAME_SECONDS = 0.05;
const NIGHT_BACKGROUND = new THREE.Color(0x030304);
const DAWN_BACKGROUND = new THREE.Color(0x4f4a3a);
/** Abstand zwischen zwei Wirkungen von Kwests Esse, in Sekunden. */
const SEAR_SECONDS = 0.5;
const SEGEN_SUBTITLE = 'Eine Höhere Macht antwortet. Wähle einen Segen';
/** Sekunden zwischen dem Sturz des Verschlingers und der Wahl des Segens. */
const BOSS_SEGEN_SECONDS = 3;

/**
 * 'loading' = Modelle werden geladen, 'title' = Startbildschirm, 'select' = Klassenwahl vor der Nacht,
 * 'levelup' = Wahl einer Stärkung, 'lager' = Lager (Ausrüstung, Truhe und Händler) zwischen den Nächten. Der Startbildschirm und die Pause
 * tragen die Menüs (Optionen, Anleitung, Rückfragen) als Unterseiten.
 */
type Phase = 'loading' | 'title' | 'select' | 'playing' | 'paused' | 'levelup' | 'lager' | 'ended';

/** Eine wählbare Stärkung beim Stufenaufstieg: neuer Angriff, höherer Rang oder Segen. */
interface Offer {
  name: string;
  text: string;
  note: string;
  segen?: boolean;
  take(): void;
}

export class Game {
  readonly player: Player;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly background = NIGHT_BACKGROUND.clone();
  private readonly fog = new THREE.Fog(NIGHT_BACKGROUND, 28, 60);
  private readonly input = new Input();
  private readonly menus = new Menus();
  private readonly random = createRandom(CONFIG.world.seed + 900);
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
  /** Segen, die außer der Reihe gewährt werden: für den erschlagenen Verschlinger. */
  private pendingSegen = 0;
  /** Sekunden, bis der Segen für den gefallenen Verschlinger zur Wahl steht; 0 = keiner unterwegs. */
  private segenIn = 0;
  /** Sekunden bis zur nächsten Wirkung von Kwests Esse. */
  private searIn = 0;
  /** Reichweite des Lichtscheins, die den übrigen Systemen zuletzt gemeldet wurde. */
  private shownLight = 0;
  private offers: Offer[] = [];
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
  /** Worauf die offene Rückfrage antwortet: das Abbrechen der Nacht oder das Löschen des Spielstands. */
  private confirming: 'abort' | 'new' | null = null;
  private settings: Settings;
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

    this.scene.background = this.background;
    // Blendet den fernen Boden in den Hintergrund aus, damit keine Kante sichtbar wird.
    this.scene.fog = this.fog;
    this.scene.add(
      this.world.group,
      this.zones.group,
      this.enemies.group,
      this.boss.group,
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
    this.settings = loadSettings({
      sound: { ...CONFIG.audio.defaults, muted: false },
      ui: { vitalsPosition: 'top-left' },
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
    this.world.dress(models.props);
    this.zones.setModel(models.props.get(CONFIG.islands.model.file) ?? null);
    this.pickups.setModels(
      models.props.get(CONFIG.xp.gems.small.file) ?? null,
      models.props.get(CONFIG.xp.gems.large.file) ?? null,
    );
    this.hud.setLoading(null);
    this.openTitle();
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
      case 'levelup':
        this.updateChoice();
        break;
      case 'lager':
        this.lager.update(this.input);
        break;
      case 'ended':
        this.player.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.boss.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
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
    this.fields.update(dt);
    this.threats.update(dt, this.player, this.zones);
    this.reportBoss();
    if (this.segenIn > 0) {
      this.segenIn -= dt;
      if (this.segenIn <= 0) this.pendingSegen++;
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

  /** Was der Verschlinger und sein Sog gerade getan haben, als kurze Meldung im Bild. */
  private reportBoss(): void {
    const event = this.boss.consumeEvent();
    if (event === 'erschienen') this.hud.announce(`${CONFIG.boss.name} kommt`);
    else if (event === 'verschlingen') this.hud.announce('Das Verschlingen');
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
      this.segenIn = BOSS_SEGEN_SECONDS;
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

  /** Bedienung der Menüs im Startbildschirm und in der Pause: Auf und Ab wählen, Links und Rechts ändern, Enter bestätigt, Esc geht zurück. */
  private updateMenu(): void {
    const { input, menus } = this;
    if (input.wasPressed('pause')) {
      this.menuBack();
      return;
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
        this.confirming = null;
        this.showMenuHome(true);
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
      case 'help':
        this.menus.showHelp();
        audio.play('auswahl');
        break;
      case 'new':
        if (this.boerse.hasGold() || this.ausruestung.hasAny()) this.confirmNewGame();
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

  /** Warnt vor dem Löschen des Spielstands und nennt, was verloren ginge. */
  private confirmNewGame(): void {
    const items = CLASSES.reduce((sum, entry) => sum + this.ausruestung.count(entry.id), this.ausruestung.chestCount());
    const lost: string[] = [];
    if (this.boerse.gold > 0) lost.push(`${this.boerse.gold} Gold`);
    if (items > 0) lost.push(`${items} ${items === 1 ? 'Gegenstand' : 'Gegenstände'}`);
    this.confirming = 'new';
    this.menus.showConfirm({
      title: 'Neues Spiel beginnen?',
      text: `Dein Fortschritt wird zurückgesetzt: ${lost.join(' und ')} gehen verloren. Das lässt sich nicht rückgängig machen. Die Optionen bleiben.`,
      no: 'Abbrechen',
      yes: 'Fortschritt löschen',
    }, true);
    audio.play('auswahl');
  }

  /** Beginnt bei null: leere Börse, keine Gegenstände, dann die Klassenwahl. */
  private startNewGame(): void {
    this.boerse.reset();
    this.ausruestung.reset();
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
    this.menus.showTitle(this.boerse.hasGold() || this.ausruestung.hasAny(), back);
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

  private startRun(playerClass: ClassDef): void {
    this.playerClass = playerClass;
    this.time = 0;
    this.pendingLevels = 0;
    this.pendingSegen = 0;
    this.segenIn = 0;
    this.searIn = 0;
    this.shownLight = 0;
    this.wasInLight = false;
    this.weakened = 0;
    this.goldRun = 0;
    this.hud.setGold(0);
    this.progression.reset(playerClass, (stats) => this.ausruestung.apply(playerClass.id, stats));
    this.player.setClass(playerClass, this.models?.heroes.get(playerClass.id) ?? null);
    this.player.reset();
    this.dust.setLightColor(playerClass.lightColor);
    this.events.clear();
    this.fields.reset();
    this.events.add(this.fields);
    this.events.add(this.arsenal.listener);
    this.enemies.reset();
    this.pickups.reset();
    this.coins.reset();
    this.drops.reset();
    this.chest.reset();
    this.beute.start(playerClass.id);
    this.lootBest = null;
    this.hud.setLoot(0, null);
    this.zones.reset();
    this.syncLight();
    this.applyBlessings();
    this.threats.reset();
    this.boss.reset();
    this.hud.setBoss(null);
    this.arsenal.reset(playerClass);
    finsternisUniforms.uSense.value = playerClass.id === 'wildnislaeufer' ? 1 : 0;
    this.traitLabel = '';
    this.rig.snapTo(this.player.position);
    this.updateDawn();
    this.refreshHud();
    this.phase = 'playing';
    audio.play('abendglocke');
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
    const candidates = this.progression.openSegen();
    if (candidates.length === 0) return false;
    this.offers = [];
    while (this.offers.length < 3 && candidates.length > 0) {
      const [segen] = candidates.splice(Math.floor(this.random() * candidates.length), 1);
      if (!segen) break;
      this.offers.push({
        name: segen.name,
        text: segen.text,
        note: segen.macht,
        segen: true,
        take: () => this.progression.bless(segen),
      });
    }
    this.selected = 0;
    this.phase = 'levelup';
    this.hud.showChoice(title, SEGEN_SUBTITLE, this.offers, this.selected);
    audio.play('segen');
    return true;
  }

  /** Der Segen für den erschlagenen Verschlinger. */
  private openBossSegen(): void {
    this.pendingSegen--;
    this.offerSegen(`${CONFIG.boss.name} ist gefallen`);
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
        name: def.name,
        // Was der nächste Rang bringt, steht auf der Karte; ohne Angabe die Kurzbeschreibung.
        text: def.rankText?.[rank] ?? def.text,
        note: rank === 0 ? 'Neuer Angriff' : `Rang ${rank + 1} von ${MAX_RANK}`,
        take: () => this.arsenal.take(def),
      })),
      ...this.progression.open().map((upgrade) => ({
        name: upgrade.name,
        text: upgrade.text,
        note: `Rang ${this.progression.rank(upgrade) + 1} von ${upgrade.max}`,
        take: () => this.progression.take(upgrade),
      })),
    ];
    this.offers = [];
    while (this.offers.length < 3 && candidates.length > 0) {
      this.offers.push(...candidates.splice(Math.floor(this.random() * candidates.length), 1));
    }
    if (this.offers.length === 0) {
      // Alles ausgereizt: es gibt nichts mehr zu wählen.
      this.pendingLevels = 0;
      return;
    }
    this.pendingLevels--;
    this.selected = 0;
    this.phase = 'levelup';
    this.hud.showChoice(
      `Stufe ${this.progression.level - this.pendingLevels}`,
      'Wähle eine Stärkung',
      this.offers,
      this.selected,
    );
    audio.play('stufe');
  }

  /** Gemeinsame Bedienung beider Auswahlen: Klasse und Stärkung. */
  private updateChoice(): void {
    const count = this.phase === 'select' ? CLASSES.length : this.offers.length;
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
    if (this.input.wasPressed('choice1')) this.pick(0);
    else if (this.input.wasPressed('choice2')) this.pick(1);
    else if (this.input.wasPressed('choice3')) this.pick(2);
    else if (this.input.wasPressed('confirm')) this.pick(this.selected);
  }

  private pick(index: number): void {
    if (this.phase === 'select') {
      const playerClass = CLASSES[index];
      if (!playerClass) return;
      this.hud.hideChoice();
      this.startRun(playerClass);
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

  private end(outcome: 'won' | 'fallen' | 'aborted'): void {
    const won = outcome === 'won';
    this.phase = 'ended';
    this.won = won;
    this.aborted = outcome === 'aborted';
    // Der letzte Frame läuft knapp über das Ende der Nacht hinaus.
    const survived = Math.min(this.time, CONFIG.run.nightSeconds);
    const stats = `${this.playerClass.name} · Überlebt: ${formatTime(survived)} · Stufe ${this.progression.level} · Erschlagen: ${this.enemies.kills}`;
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
      const { name } = CONFIG.boss;
      const fate = this.boss.slain
        ? ` ${name} ist gefallen.`
        : this.boss.appeared
          ? ` ${name} weicht mit der Finsternis.`
          : '';
      this.hud.showEnd('Sor geht auf', `Du hast die Nacht vor der Mauer überstanden.${fate}`, stats, gold, lines);
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
      case 'lager':
        return 'menue';
      case 'ended':
        return this.aborted ? 'menue' : this.won ? 'sieg' : 'niederlage';
      default:
        if (this.boss.enemy) return 'boss';
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
      if (!enemy || enemy.hp <= 0 || enemy === this.boss.enemy) continue;
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
    this.hud.setTrait(this.traitLabel);
    this.hud.setIgnite(this.zones.igniteProgress);
    this.hud.setCompass(this.zones.nearestIsland(x, z, this.bearing));
    this.hud.setBoss(this.boss.enemy ? CONFIG.boss.name : null, this.boss.hpFraction);
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
