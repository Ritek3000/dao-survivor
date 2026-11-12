import * as THREE from 'three';
import { audio, type Duck, type MusicId } from '../audio';
import { CONFIG } from '../config';
import { Input, type MoveVector } from '../core/input';
import { createRandom } from '../core/random';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { formatTime, type Hud } from '../ui/hud';
import { Arsenal, type CombatTraits } from './arsenal';
import { Boss } from './boss';
import { CameraRig } from './cameraRig';
import { CLASSES, TRAITS, type ClassDef } from './classes';
import { Coins } from './coins';
import { finsternisUniforms } from './darkness';
import { Dust } from './dust';
import { Enemies, type EnemyHooks } from './enemies';
import { loadModels, type Models } from './models';
import { Pickups } from './pickups';
import { Player } from './player';
import { Progression, SEGEN_EVERY_LEVELS } from './progression';
import { Steigerungen, STEIGERUNGEN } from './steigerung';
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
 * 'loading' = Modelle werden geladen, 'select' = Klassenwahl vor der Nacht, 'levelup' = Wahl einer Stärkung,
 * 'steigerung' = Menü, in dem man zwischen den Nächten Gold für dauerhafte Ränge der Klassen ausgibt.
 */
type Phase = 'loading' | 'select' | 'playing' | 'paused' | 'levelup' | 'steigerung' | 'ended';

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
  private readonly random = createRandom(CONFIG.world.seed + 900);
  private readonly progression = new Progression();
  private readonly world = new World();
  private readonly zones: Zones;
  private readonly enemies = new Enemies();
  private readonly pickups = new Pickups();
  private readonly coins = new Coins();
  /** Geldbörse und Ränge der Klassen; bleiben über die Nächte hinweg bestehen und werden gespeichert. */
  private readonly steigerungen = new Steigerungen();
  private readonly arsenal: Arsenal;
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
  /** Gold, das in dieser Nacht eingesammelt wurde, schon mit dem Faktor der Steigerungen. */
  private goldRun = 0;
  /** Im Menü der Steigerungen: die gewählte Klasse und die markierte Zeile. */
  private menuClass = 0;
  private menuRow = 0;
  /** Kämpfer: stand im letzten Frame im Licht. */
  private wasInLight = false;
  /** Kämpfer: Restzeit der Schwäche nach erloschenem Feuer. */
  private weakened = 0;
  private traitLabel = '';
  /** Hat die Spielfigur die letzte Nacht überstanden? Bestimmt das Stück zum Ende. */
  private won = false;
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

    this.player = new Player(this.progression.stats);
    this.zones = new Zones(this.world.islandSites);
    this.arsenal = new Arsenal(this.progression.stats, this.random, this.enemies, this.zones, this.player);

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
      this.player.object,
      this.threats.group,
      this.arsenal.group,
      this.dust.points,
    );

    this.hud.onPick = (index) => this.pick(index);
    this.hud.onSteigern = () => this.openSteigerungFromMenu();
    this.hud.onSteigerungBuy = (index) => {
      if (this.phase !== 'steigerung') return;
      this.menuRow = index;
      this.buySteigerung();
    };
    this.hud.onSteigerungClass = (index) => this.selectSteigerungClass(index);
    this.hud.onSteigerungBack = () => this.closeSteigerung();
    this.settings = loadSettings({ sound: { ...CONFIG.audio.defaults, muted: false } });
    audio.setVolumes(this.settings.sound);
    audio.muffleAt = (x, z) => this.zones.finsternisAt(x, z);
    audio.onVolumes = (volumes) => {
      this.settings.sound = { ...volumes };
      saveSettings(this.settings);
      this.hud.showSound(volumes);
    };
    this.hud.bindSound(this.settings.sound, (volumes) => audio.setVolumes(volumes));
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
    this.openSelect();
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
      case 'paused':
        if (this.input.wasPressed('pause')) this.setPaused(false);
        break;
      case 'select':
      case 'levelup':
        this.updateChoice();
        break;
      case 'steigerung':
        this.updateSteigerung();
        break;
      case 'ended':
        this.player.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.boss.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        this.arsenal.animate(Math.min(frameSeconds, MAX_FRAME_SECONDS));
        if (this.input.wasPressed('confirm')) this.openSelect();
        else if (this.input.wasPressed('upgrade')) this.openSteigerungFromMenu();
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

    this.rig.update(dt, position);
    this.dust.update(this.time, position, this.player.light);
    this.updateDawn();
    if (this.player.consumeHit()) this.hud.flashHurt();
    this.refreshHud();

    if (!this.player.alive) this.end(false);
    else if (this.time >= CONFIG.run.nightSeconds) this.end(true);
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
      // Erst stürzt er, dann antwortet die Höhere Macht.
      this.segenIn = BOSS_SEGEN_SECONDS;
      this.hud.announce(`${name} fällt`);
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

  private setPaused(paused: boolean): void {
    this.phase = paused ? 'paused' : 'playing';
    this.hud.setPaused(paused);
    audio.play('pause');
  }

  /** Die Klassenwahl vor der Nacht; `selected` markiert eine Klasse, sonst die zuletzt gespielte. */
  private openSelect(selected = Math.max(0, CLASSES.indexOf(this.playerClass))): void {
    this.phase = 'select';
    this.selected = selected;
    this.hud.hideEnd();
    this.hud.hideSteigerung();
    this.hud.showChoice(
      'Die Abendglocke läutet',
      'Wer steht heute Nacht vor der Mauer?',
      CLASSES.map((playerClass) => {
        const ranks = this.steigerungen.totalRanks(playerClass.id);
        return {
          name: playerClass.name,
          text: playerClass.text,
          note: playerClass.home,
          extra: ranks > 0 ? `Gesteigert: ${ranks} Ränge` : 'Noch nicht gesteigert',
        };
      }),
      this.selected,
      this.steigerungen.gold,
    );
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
    this.progression.reset(playerClass, (stats) => this.steigerungen.apply(playerClass.id, stats));
    this.player.setClass(playerClass, this.models?.heroes.get(playerClass.id) ?? null);
    this.player.reset();
    this.dust.setLightColor(playerClass.lightColor);
    this.enemies.reset();
    this.pickups.reset();
    this.coins.reset();
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
        text: def.text,
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

    if (this.phase === 'select' && this.input.wasPressed('upgrade')) {
      this.openSteigerung(this.selected);
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

  private end(won: boolean): void {
    this.phase = 'ended';
    this.won = won;
    // Der letzte Frame läuft knapp über das Ende der Nacht hinaus.
    const survived = Math.min(this.time, CONFIG.run.nightSeconds);
    const stats = `${this.playerClass.name} · Überlebt: ${formatTime(survived)} · Stufe ${this.progression.level} · Erschlagen: ${this.enemies.kills}`;
    const gold = this.settle(won, survived);
    this.hud.setBoss(null);
    if (won) {
      this.world.setDawn(1);
      const { name } = CONFIG.boss;
      const fate = this.boss.slain
        ? ` ${name} ist gefallen.`
        : this.boss.appeared
          ? ` ${name} weicht mit der Finsternis.`
          : '';
      this.hud.showEnd('Sor geht auf', `Du hast die Nacht vor der Mauer überstanden.${fate}`, stats, gold);
    } else {
      this.player.die();
      if (this.player.lastDamage === 'verstaubung') {
        this.hud.showEnd('Verstaubt', 'Die Finsternis hat dich behalten.', stats, gold);
      } else {
        this.hud.showEnd('Gefallen', 'Die Nacht hat dich geholt.', stats, gold);
      }
    }
  }

  /**
   * Rechnet den Ertrag der Nacht ab und schreibt ihn der Geldbörse gut: die eingesammelten Münzen, den Sold für die
   * überlebte Zeit und, wenn die Sonne aufgeht, die Prämie. Wer fällt, behält `CONFIG.gold.deathKeep` davon.
   * Gibt die Zeile für die Endanzeige zurück.
   */
  private settle(won: boolean, survived: number): string {
    const { perMinute, victory, deathKeep } = CONFIG.gold;
    const factor = this.progression.stats.gold;
    const loot = Math.round(this.goldRun);
    const pay = Math.round(Math.floor(survived / 60) * perMinute * factor);
    const bonus = won ? Math.round(victory * factor) : 0;
    const kept = won ? 1 : deathKeep;
    const total = Math.round((loot + pay + bonus) * kept);
    this.steigerungen.credit(total);
    const parts = [`Beute ${loot}`, `Sold ${pay}`];
    if (won) parts.push(`Sonnenaufgang ${bonus}`);
    const cut = kept < 1 ? ` · davon behalten: ${Math.round(kept * 100)} %` : '';
    return `${parts.join(' · ')}${cut} · Ertrag: +${total} Gold · Börse: ${this.steigerungen.gold}`;
  }

  /** Öffnet die Steigerungen aus der Klassenwahl (für die markierte Klasse) oder vom Ende der Nacht (für die gespielte). */
  private openSteigerungFromMenu(): void {
    if (this.phase === 'select') this.openSteigerung(this.selected);
    else if (this.phase === 'ended') this.openSteigerung(Math.max(0, CLASSES.indexOf(this.playerClass)));
  }

  private openSteigerung(classIndex: number): void {
    if (classIndex !== this.menuClass) this.menuRow = 0;
    this.menuClass = classIndex;
    this.phase = 'steigerung';
    this.hud.hideChoice();
    this.hud.hideEnd();
    audio.play('auswahl');
    this.refreshSteigerung();
  }

  /** Zeichnet das Menü der Steigerungen neu, etwa nach einem Kauf. */
  private refreshSteigerung(): void {
    const playerClass = CLASSES[this.menuClass];
    if (!playerClass) return;
    const { steigerungen } = this;
    this.hud.showSteigerung({
      gold: steigerungen.gold,
      classes: CLASSES.map((entry) => ({ name: entry.name, ranks: steigerungen.totalRanks(entry.id) })),
      active: this.menuClass,
      rows: STEIGERUNGEN.map((steigerung) => {
        const cost = steigerungen.cost(playerClass.id, steigerung);
        return {
          name: steigerung.name,
          text: steigerung.text,
          rank: steigerungen.rank(playerClass.id, steigerung),
          max: steigerung.max,
          cost,
          affordable: cost !== null && cost <= steigerungen.gold,
        };
      }),
      selected: this.menuRow,
    });
  }

  private selectSteigerungClass(index: number): void {
    if (this.phase !== 'steigerung' || index === this.menuClass || !CLASSES[index]) return;
    this.menuClass = index;
    audio.play('auswahl');
    this.refreshSteigerung();
  }

  private buySteigerung(): void {
    const playerClass = CLASSES[this.menuClass];
    const steigerung = STEIGERUNGEN[this.menuRow];
    if (!playerClass || !steigerung) return;
    if (this.steigerungen.buy(playerClass.id, steigerung)) audio.play('steigerung');
    else this.hud.denySteigerung();
    this.refreshSteigerung();
  }

  /** Zurück zur Klassenwahl, mit der gesteigerten Klasse markiert. */
  private closeSteigerung(): void {
    if (this.phase !== 'steigerung') return;
    audio.play('auswahl');
    this.openSelect(this.menuClass);
  }

  /** Bedienung des Menüs: Auf und Ab wählen die Steigerung, Links und Rechts die Klasse, Enter kauft. */
  private updateSteigerung(): void {
    const rows = STEIGERUNGEN.length;
    const row = this.menuRow;
    if (this.input.wasPressed('up')) this.menuRow = (this.menuRow + rows - 1) % rows;
    if (this.input.wasPressed('down')) this.menuRow = (this.menuRow + 1) % rows;
    if (this.menuRow !== row) {
      audio.play('auswahl');
      this.hud.selectSteigerung(this.menuRow);
    }

    const count = CLASSES.length;
    if (this.input.wasPressed('left')) this.selectSteigerungClass((this.menuClass + count - 1) % count);
    else if (this.input.wasPressed('right')) this.selectSteigerungClass((this.menuClass + 1) % count);
    else if (this.input.wasPressed('choice1')) this.selectSteigerungClass(0);
    else if (this.input.wasPressed('choice2')) this.selectSteigerungClass(1);
    else if (this.input.wasPressed('choice3')) this.selectSteigerungClass(2);

    if (this.input.wasPressed('confirm')) this.buySteigerung();
    else if (this.input.wasPressed('pause') || this.input.wasPressed('upgrade')) this.closeSteigerung();
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
      case 'select':
      case 'steigerung':
        return 'menue';
      case 'ended':
        return this.won ? 'sieg' : 'niederlage';
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
