import type { Look, VitalsPosition } from '../core/settings';
import type { Rarity } from '../game/items';
import type { IslandBearing, Zone } from '../game/zones';
import { element, span } from './dom';

/** Eine Karte in einer Auswahl: Klasse und Startangriff zu Beginn, Stärkung beim Stufenaufstieg. */
export interface ChoiceCard {
  name: string;
  text: string;
  /** Kleingedrucktes unter dem Text, etwa der Rang. */
  note: string;
  /** Ein Segen einer Höheren Macht wird hervorgehoben. */
  segen?: boolean;
  /** Zweites Kleingedrucktes, etwa wie viele Gegenstände die Klasse trägt. */
  extra?: string;
  /** Der Gradzähler einer Nachtart, die man schon geschafft hat (siehe `game/grade.ts`); fehlt er, hat die Karte keinen. */
  grade?: ChoiceGrade;
  /** Der Schalter zwischen Mann und Frau auf der Karte einer Klasse; fehlt er, gibt es die Klasse nur als Mann. */
  look?: Look;
}

/** Der Gradzähler auf der Karte einer Nachtart: `−  Grad 2  +`, darunter was der Grad ändert und was man geschafft hat. */
export interface ChoiceGrade {
  /** Der gewählte Grad. */
  value: number;
  /** Der höchste Grad, der zur Wahl steht; darüber ist der Knopf + gesperrt, unter 0 der Knopf −. */
  max: number;
  /** Was der gewählte Grad an den Gegnern ändert. */
  effect: string;
  /** Wie weit man die Nachtart geschafft hat. */
  cleared: string;
}

/** Was beim Stufenaufstieg unter den Karten steht: Neuwurf und Verbannen mit ihren Vorräten. */
export interface ChoiceTools {
  rerolls: number;
  banishes: number;
  /** Gibt es andere Karten, die an die Stelle der gezeigten treten könnten? Ohne sie bleibt beides wirkungslos und ist gesperrt. */
  swappable: boolean;
  /** Die Wahl wartet darauf, dass eine Karte zum Verbannen angeklickt wird. */
  banishing: boolean;
}

/** Ein Gegenstand der Nacht in der Endanzeige und was aus ihm wurde. */
export interface EndLoot {
  name: string;
  rarity: Rarity;
  /** Seltenheit und Platz, etwa „Rar · Ring“. */
  detail: string;
  /** Im Inventar gelandet oder verkauft. */
  note: string;
}

/** Die Teile eines Gradzählers. */
interface GradeParts {
  row: HTMLElement;
  less: HTMLButtonElement;
  more: HTMLButtonElement;
  value: HTMLElement;
  effect: HTMLElement;
  cleared: HTMLElement;
}

/** Der Schalter zwischen Mann und Frau auf der Klassenkarte und die Texte, die er mit ändert. */
interface LookParts {
  row: HTMLElement;
  buttons: Record<Look, HTMLButtonElement>;
  name: HTMLElement;
  text: HTMLElement;
  note: HTMLElement;
}

const LOOK_LABELS: Record<Look, string> = { m: 'Männlich', w: 'Weiblich' };

const ZONE_LABELS: Record<Zone, string> = {
  licht: 'Im Licht',
  nacht: 'Nacht',
  finsternis: 'Finsternis',
};

/** Erst ab dieser Entfernung zeigt der Zeiger zur nächsten Feuerschale. */
const COMPASS_MIN_DISTANCE = 9;

function percent(fraction: number): string {
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Anzeigen über dem Spielbild. Schreibt nur ins DOM, wenn sich ein Wert geändert hat. */
export class Hud {
  /** Wird aufgerufen, wenn eine Karte einer Auswahl angeklickt wird. */
  onPick: (index: number) => void = () => {};
  /** Der Knopf zum Lager bei der Klassenwahl und am Ende der Nacht. */
  onLager: () => void = () => {};
  /** Der Knopf "Hauptmenü" bei der Klassenwahl und am Ende der Nacht. */
  onMainMenu: () => void = () => {};
  /** Die Knöpfe "Neu würfeln" und "Verbannen" beim Stufenaufstieg. */
  onReroll: () => void = () => {};
  onBanish: () => void = () => {};
  /** Die Knöpfe − und + im Gradzähler einer Karte: Nummer der Karte und Schritt (−1 oder +1). */
  onGrade: (index: number, step: number) => void = () => {};
  /** Ein Klick auf den Schalter der Klassenkarte `index`: Das Aussehen soll `look` werden. */
  onLook: (index: number, look: Look) => void = () => {};
  private readonly hpFill = element('hp-fill');
  private readonly hpDust = element('hp-dust');
  private readonly hpText = element('hp-text');
  private readonly xpFill = element('xp-fill');
  private readonly level = element('level-text');
  private readonly gold = element('gold-text');
  private readonly loot = element('loot');
  private readonly lootText = element('loot-text');
  private readonly clockLabel = element('clock-label');
  private readonly clockTime = element('clock-time');
  private readonly zone = element('zone');
  private readonly trait = element('trait');
  private readonly finsternisVeil = element('finsternis-veil');
  private readonly hurtVeil = element('hurt-veil');
  private readonly ignite = element('ignite');
  private readonly igniteFill = element('ignite-fill');
  private readonly compass = element('compass');
  private readonly boss = element('boss');
  private readonly bossName = element('boss-name');
  private readonly bossFill = element('boss-fill');
  private readonly banner = element('banner');
  private readonly soundOff = element('sound-off');
  private readonly loading = element('loading');
  private readonly loadingText = element('loading-text');
  private readonly loadNotice = element('load-notice');
  private readonly choice = element('choice');
  private readonly choiceTitle = element('choice-title');
  private readonly choiceSubtitle = element('choice-subtitle');
  private readonly choiceCards = element('choice-cards');
  private readonly choiceGold = element('choice-gold');
  private readonly choiceNote = element('choice-note');
  private readonly choiceTools = element('choice-tools');
  private readonly choiceReroll = element<HTMLButtonElement>('choice-reroll');
  private readonly choiceBanish = element<HTMLButtonElement>('choice-banish');
  private readonly choiceLager = element('choice-lager');
  private readonly endLager = element('end-lager');
  private readonly endKeys = element('end-keys');
  private readonly endSeed = element('end-seed');
  private readonly choiceMainMenu = element('choice-main-menu');
  private readonly choiceKeys = element('choice-keys');
  private readonly end = element('end');
  private readonly endTitle = element('end-title');
  private readonly endText = element('end-text');
  private readonly endStats = element('end-stats');
  private readonly endGold = element('end-gold');
  private readonly endLoot = element('end-loot');
  private readonly debug: HTMLElement | null;
  private readonly shown = new Map<HTMLElement, string>();
  private cards: HTMLElement[] = [];
  /** Die Teile des Gradzählers je Karte (nach Nummer), damit `setGrade` sie ändern kann. */
  private gradeParts = new Map<number, GradeParts>();
  /** Die Teile des Aussehen-Schalters je Klassenkarte (nach Nummer), damit `setLook` Texte und Schalter ändern kann. */
  private lookParts = new Map<number, LookParts>();
  private lagerEnabled = false;

  constructor(showDebug: boolean) {
    this.debug = showDebug ? element('debug') : null;
    if (this.debug) this.debug.hidden = false;
    // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
    for (const [id, action] of [
      ['choice-lager', () => this.onLager()],
      ['end-lager', () => this.onLager()],
      ['choice-main-menu', () => this.onMainMenu()],
      ['choice-reroll', () => this.onReroll()],
      ['choice-banish', () => this.onBanish()],
      ['end-main-menu', () => this.onMainMenu()],
    ] as const) {
      const button = element(id);
      button.addEventListener('click', () => {
        button.blur();
        action();
      });
    }
  }

  setVitals(hp: number, verstaubung: number, maxHp: number): void {
    this.style(this.hpFill, 'width', percent(hp / maxHp));
    this.style(this.hpDust, 'width', percent(verstaubung / maxHp));
    this.text(this.hpText, `${Math.max(0, Math.ceil(hp))} / ${maxHp}`);
  }

  setProgress(level: number, fraction: number): void {
    this.text(this.level, String(level));
    this.style(this.xpFill, 'width', percent(fraction));
  }

  /** Gold, das in dieser Nacht eingesammelt wurde. */
  setGold(gold: number): void {
    const text = String(gold);
    this.text(this.gold, text);
    // Lange Zahlen werden kleiner gesetzt, damit sie im Beutel bleiben (siehe style.css).
    const long = text.length > 5 ? '2' : text.length > 4 ? '1' : '0';
    if (this.gold.dataset.long !== long) this.gold.dataset.long = long;
  }

  /** Gegenstände im Beutel dieser Nacht; der Stein trägt die Farbe des besten Funds. `null` blendet die Anzeige aus. */
  setLoot(count: number, best: Rarity | null): void {
    this.loot.hidden = count <= 0 || best === null;
    if (count <= 0 || best === null) return;
    this.text(this.lootText, String(count));
    const cls = `rarity-${best}`;
    if (this.loot.dataset.rarity !== cls) {
      this.loot.className = cls;
      this.loot.dataset.rarity = cls;
    }
  }

  setClock(secondsLeft: number): void {
    this.text(this.clockTime, formatTime(secondsLeft));
  }

  setZone(zone: Zone, finsternis: number): void {
    this.text(this.zone, ZONE_LABELS[zone]);
    if (this.zone.className !== zone) this.zone.className = zone;
    this.style(this.finsternisVeil, 'opacity', finsternis.toFixed(2));
  }

  /** Zustand der Klassen-Besonderheit, etwa "Stark im Licht"; leer blendet ihn aus. */
  setTrait(label: string): void {
    this.text(this.trait, label);
  }

  /** Fortschritt beim Entzünden von 0 bis 1; 0 blendet die Anzeige aus. */
  setIgnite(progress: number): void {
    this.ignite.hidden = progress <= 0;
    if (progress > 0) this.style(this.igniteFill, 'width', percent(progress));
  }

  setCompass(bearing: IslandBearing | null): void {
    const visible = bearing !== null && bearing.distance > COMPASS_MIN_DISTANCE;
    this.compass.hidden = !visible;
    if (!visible || !bearing) return;
    // Bildschirm-oben ist -Z in der Welt.
    const degrees = (Math.atan2(bearing.dx, -bearing.dz) * 180) / Math.PI;
    this.style(this.compass, 'transform', `rotate(${degrees.toFixed(1)}deg)`);
    this.compass.classList.toggle('burning', bearing.burning);
  }

  /** Lebensleiste des großen Gegners; `null` blendet sie aus. */
  setBoss(name: string | null, fraction = 0): void {
    if (this.boss.hidden !== (name === null)) this.boss.hidden = name === null;
    if (name === null) return;
    this.text(this.bossName, name);
    this.style(this.bossFill, 'width', percent(fraction));
  }

  /** Setzt den Namen der Nachtart über die Uhr („Rotnacht · Sonnenaufgang in“); `null` für die gewöhnliche Nacht. */
  setNightName(name: string | null): void {
    this.clockLabel.textContent = name === null ? 'Sonnenaufgang in' : `${name} · Sonnenaufgang in`;
  }

  /** Zeigt für einige Sekunden eine Meldung in der oberen Bildhälfte. */
  announce(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove('active');
    void this.banner.offsetWidth;
    this.banner.classList.add('active');
  }

  flashHurt(): void {
    // Erzwingt einen Neustart der Animation, auch wenn sie noch läuft.
    this.hurtVeil.classList.remove('active');
    void this.hurtVeil.offsetWidth;
    this.hurtVeil.classList.add('active');
  }

  /** Stellt die Lebensgruppe (Stufe, Lebensbalken, Gold) an die gewählte Stelle des Bildschirms. */
  setVitalsPosition(position: VitalsPosition): void {
    if (document.body.dataset.vitals !== position) document.body.dataset.vitals = position;
  }

  /** Der Hinweis "Ton aus" unten im Bild, solange der Ton stumm geschaltet ist. */
  setMuted(muted: boolean): void {
    this.soundOff.hidden = !muted;
  }

  /** Hinweis auf dem Startbildschirm, wenn Modelldateien fehlen (der Platzhalter bleibt); `null` blendet ihn aus. */
  setLoadNotice(text: string | null): void {
    this.loadNotice.hidden = text === null;
    this.loadNotice.textContent = text ?? '';
  }

  /** Hinweis, solange die Modelle geladen werden; `null` blendet ihn aus. */
  setLoading(text: string | null): void {
    this.loading.hidden = text === null;
    this.loadingText.textContent = text ?? '';
  }

  /**
   * Zeigt eine Auswahl. Mit `gold` (der Klassenwahl) steht darunter die Geldbörse samt Knopf zum Lager, und `note` ist ein Hinweis
   * darunter (leer: keiner); bei der Wahl einer Stärkung gibt es das alles nicht. `dense` setzt die Karten enger, damit die
   * sieben Angriffe der Klasse gut Platz haben. Neuwurf und Verbannen zeigt erst `setChoiceTools`.
   */
  showChoice(
    title: string,
    subtitle: string,
    cards: readonly ChoiceCard[],
    selected: number,
    gold: number | null = null,
    note = '',
    dense = false,
  ): void {
    this.choiceTitle.textContent = title;
    this.choiceCards.classList.toggle('dense', dense);
    this.choiceCards.classList.remove('banishing');
    this.choiceTools.hidden = true;
    this.choiceSubtitle.textContent = subtitle;
    this.gradeParts.clear();
    this.lookParts.clear();
    this.cards = cards.map((card, index) => {
      // Ein Knopf darf keine Knöpfe enthalten: Eine Karte mit Gradzähler oder Aussehen-Schalter ist darum ein Feld mit der Rolle eines Knopfs.
      const root = card.grade || card.look ? document.createElement('div') : document.createElement('button');
      if (root instanceof HTMLButtonElement) root.type = 'button';
      else root.setAttribute('role', 'button');
      root.className = card.segen ? 'card segen' : 'card';
      const name = span('name', card.name);
      const text = span('text', card.text);
      const note = span('note', card.note);
      root.append(span('key', String(index + 1)), name, text, note, ...(card.extra ? [span('note extra', card.extra)] : []));
      if (card.look) {
        const parts = this.lookRow(index, name, text, note);
        this.lookParts.set(index, parts);
        this.fillLook(parts, card.look);
        root.append(parts.row);
      }
      if (card.grade) {
        const parts = this.gradeRow(index);
        this.gradeParts.set(index, parts);
        this.fillGrade(parts, card.grade);
        root.append(parts.row);
      }
      root.addEventListener('click', () => this.onPick(index));
      return root;
    });
    this.choiceCards.replaceChildren(...this.cards);
    this.choiceGold.hidden = gold === null;
    this.choiceNote.textContent = note;
    this.choiceNote.hidden = gold === null || note === '';
    this.choiceLager.hidden = gold === null || !this.lagerEnabled;
    this.choiceMainMenu.hidden = gold === null;
    if (gold !== null) this.choiceGold.textContent = `Gold: ${gold}`;
    this.choiceKeys.textContent =
      gold === null
        ? '1 · 2 · 3 oder Pfeiltasten und Enter'
        : `1 · 2 · 3 oder Pfeiltasten und Enter: Nacht beginnen${cards.some((card) => card.look) ? ' · F: Figur' : ''}${this.lagerEnabled ? ' · L: Lager' : ''} · Esc: Hauptmenü`;
    this.select(selected);
    this.choice.hidden = false;
  }

  /** Baut den Schalter zwischen Mann und Frau auf einer Klassenkarte; gefüllt wird er von `fillLook`. */
  private lookRow(index: number, name: HTMLElement, text: HTMLElement, note: HTMLElement): LookParts {
    const row = document.createElement('div');
    row.className = 'look';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Figur');
    const choose = (look: Look): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'look-choice';
      button.textContent = LOOK_LABELS[look];
      button.title = 'Figur wechseln (F)';
      button.setAttribute('role', 'radio');
      button.addEventListener('click', (event) => {
        // Der Klick gehört dem Schalter und wählt nicht die Klasse; der Fokus bliebe sonst am Knopf hängen (Enter und Leertaste gehören dem Spiel).
        event.stopPropagation();
        button.blur();
        this.onLook(index, look);
      });
      return button;
    };
    const buttons = { m: choose('m'), w: choose('w') };
    const group = document.createElement('div');
    group.className = 'look-group';
    group.append(buttons.m, buttons.w);
    row.append(span('look-title', 'Figur'), group);
    return { row, buttons, name, text, note };
  }

  private fillLook(parts: LookParts, look: Look): void {
    for (const key of ['m', 'w'] as const) {
      parts.buttons[key].classList.toggle('on', key === look);
      parts.buttons[key].setAttribute('aria-checked', String(key === look));
    }
  }

  /** Stellt den Schalter der Klassenkarte `index` um und schreibt Name und Texte der Karte neu, etwa nach F. */
  setLook(index: number, look: Look, texts: { name: string; text: string; note: string }): void {
    const parts = this.lookParts.get(index);
    if (!parts) return;
    parts.name.textContent = texts.name;
    parts.text.textContent = texts.text;
    parts.note.textContent = texts.note;
    this.fillLook(parts, look);
  }

  /** Baut den Gradzähler einer Karte; gefüllt wird er von `fillGrade`. */
  private gradeRow(index: number): GradeParts {
    const row = document.createElement('div');
    row.className = 'grade';
    const step = (label: string, title: string, delta: number): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'grade-step';
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', (event) => {
        // Der Klick gehört dem Zähler und wählt nicht die Nacht; der Fokus bliebe sonst am Knopf hängen (Enter und Leertaste gehören dem Spiel).
        event.stopPropagation();
        button.blur();
        this.onGrade(index, delta);
      });
      return button;
    };
    const less = step('−', 'Grad senken (Pfeil runter oder −)', -1);
    const more = step('+', 'Grad erhöhen (Pfeil hoch oder +)', 1);
    const value = span('grade-value', '');
    const counter = document.createElement('div');
    counter.className = 'grade-counter';
    counter.append(less, value, more);
    const effect = span('note grade-effect', '');
    const cleared = span('note grade-cleared', '');
    row.append(span('grade-title', 'Grad'), counter, effect, cleared);
    return { row, less, more, value, effect, cleared };
  }

  private fillGrade(parts: GradeParts, grade: ChoiceGrade): void {
    parts.value.textContent = String(grade.value);
    parts.effect.textContent = grade.effect;
    parts.cleared.textContent = grade.cleared;
    parts.less.disabled = grade.value <= 0;
    parts.more.disabled = grade.value >= grade.max;
  }

  /** Ändert den Gradzähler der Karte `index`, etwa nach den Pfeiltasten. */
  setGrade(index: number, grade: ChoiceGrade): void {
    const parts = this.gradeParts.get(index);
    if (parts) this.fillGrade(parts, grade);
  }

  /** Ersetzt die Unterzeile der Auswahl, etwa während eine Karte zum Verbannen gesucht wird. */
  setChoiceSubtitle(text: string): void {
    this.choiceSubtitle.textContent = text;
  }

  /** Ersetzt die Tastenzeile unter den Karten. */
  setChoiceKeys(text: string): void {
    this.choiceKeys.textContent = text;
  }

  /** Zeigt unter den Karten Neuwurf und Verbannen mit den Vorräten der Nacht. */
  setChoiceTools(tools: ChoiceTools): void {
    const { rerolls, banishes, swappable, banishing } = tools;
    this.choiceTools.hidden = false;
    this.choiceCards.classList.toggle('banishing', banishing);
    this.choiceReroll.textContent = `Neu würfeln (R) · ${rerolls}`;
    this.choiceReroll.disabled = rerolls <= 0 || !swappable;
    this.choiceReroll.title = 'Ersetzt die Karten durch andere, wenn es welche gibt.';
    this.choiceBanish.textContent = banishing ? 'Abbrechen (X)' : `Verbannen (X) · ${banishes}`;
    this.choiceBanish.disabled = !banishing && (banishes <= 0 || !swappable);
    this.choiceBanish.title = 'Streicht eine Karte bis zum Ende der Nacht aus dem Angebot; eine andere nimmt ihren Platz ein.';
    this.choiceKeys.textContent = banishing
      ? '1 · 2 · 3 oder Pfeiltasten und Enter: Karte verbannen · X oder Esc: abbrechen'
      : '1 · 2 · 3 oder Pfeiltasten und Enter · R: Neu würfeln · X: Verbannen';
  }

  /** Zeigt die Knöpfe zum Lager oder versteckt sie; wirkt ab dem nächsten Bild der Klassenwahl und des Endes. */
  setLagerEnabled(enabled: boolean): void {
    this.lagerEnabled = enabled;
    this.endLager.hidden = !enabled;
    this.endKeys.textContent = `Enter: Klasse wählen und neue Nacht beginnen${enabled ? ' · L: Lager' : ''} · Esc: Hauptmenü`;
  }

  select(index: number): void {
    for (const [cardIndex, card] of this.cards.entries()) {
      card.classList.toggle('selected', cardIndex === index);
    }
  }

  hideChoice(): void {
    this.choice.hidden = true;
  }

  /** `gold` beschreibt in einer Zeile den Ertrag der Nacht und die Geldbörse danach; `loot` die gefundenen Gegenstände. */
  showEnd(title: string, text: string, stats: string, gold: string, loot: readonly EndLoot[] = []): void {
    this.endTitle.textContent = title;
    this.endText.textContent = text;
    this.endStats.textContent = stats;
    this.endGold.textContent = gold;
    this.endLoot.hidden = loot.length === 0;
    this.endLoot.replaceChildren(
      ...(loot.length === 0
        ? []
        : [
            span('title', loot.length === 1 ? 'Ein Gegenstand gefunden' : `${loot.length} Gegenstände gefunden`),
            ...loot.map((entry) => {
              const row = document.createElement('div');
              row.className = `row rarity-${entry.rarity}`;
              row.append(span('name', entry.name), span('detail', entry.detail), span('note', entry.note));
              return row;
            }),
          ]),
    );
    this.end.hidden = false;
  }

  /** Der Seed des Laufs unter dem Endbild; mit `?seed=` hinter der Adresse beginnt ein Lauf mit demselben Seed. */
  setEndSeed(seed: string): void {
    this.endSeed.textContent = `Lauf-Seed: ${seed}`;
    this.endSeed.title = `Mit ?seed=${seed} hinter der Adresse beginnt der erste Lauf mit diesem Seed und derselben Welt.`;
  }

  hideEnd(): void {
    this.end.hidden = true;
  }

  setDebug(text: string): void {
    if (this.debug) this.debug.textContent = text;
  }

  get debugEnabled(): boolean {
    return this.debug !== null;
  }

  private text(target: HTMLElement, value: string): void {
    if (this.shown.get(target) === value) return;
    this.shown.set(target, value);
    target.textContent = value;
  }

  private style(target: HTMLElement, property: 'width' | 'opacity' | 'transform', value: string): void {
    if (this.shown.get(target) === value) return;
    this.shown.set(target, value);
    target.style[property] = value;
  }
}

export { formatTime };
