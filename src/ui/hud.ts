import type { Volumes } from '../audio';
import type { IslandBearing, Zone } from '../game/zones';

/** Eine Karte in einer Auswahl: Klasse zu Beginn, Stärkung beim Stufenaufstieg. */
export interface ChoiceCard {
  name: string;
  text: string;
  /** Kleingedrucktes unter dem Text, etwa der Rang. */
  note: string;
  /** Ein Segen einer Höheren Macht wird hervorgehoben. */
  segen?: boolean;
  /** Zweites Kleingedrucktes, etwa wie weit die Klasse schon gesteigert ist. */
  extra?: string;
}

/** Eine Zeile im Menü der Steigerungen. */
export interface SteigerungRow {
  name: string;
  /** Was ein Rang bewirkt. */
  text: string;
  rank: number;
  max: number;
  /** Preis des nächsten Rangs in Gold; `null`, wenn der höchste Rang erreicht ist. */
  cost: number | null;
  /** Reicht das Gold für den nächsten Rang? */
  affordable: boolean;
}

/** Alles, was das Menü der Steigerungen zeigt. */
export interface SteigerungView {
  gold: number;
  /** Die Klassen als Reiter, mit der Zahl ihrer Ränge. */
  classes: readonly { name: string; ranks: number }[];
  /** Stelle der gewählten Klasse in `classes`. */
  active: number;
  rows: readonly SteigerungRow[];
  /** Stelle der markierten Zeile. */
  selected: number;
}

const ZONE_LABELS: Record<Zone, string> = {
  licht: 'Im Licht',
  nacht: 'Nacht',
  finsternis: 'Finsternis',
};

/** Erst ab dieser Entfernung zeigt der Zeiger zur nächsten Feuerschale. */
const COMPASS_MIN_DISTANCE = 9;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} fehlt in index.html.`);
  return found as T;
}

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
  /** Die Knöpfe der Auswahl und des Steigerungsmenüs. */
  onSteigern: () => void = () => {};
  onSteigerungBuy: (index: number) => void = () => {};
  onSteigerungClass: (index: number) => void = () => {};
  onSteigerungBack: () => void = () => {};
  private readonly hpFill = element('hp-fill');
  private readonly hpDust = element('hp-dust');
  private readonly hpText = element('hp-text');
  private readonly xpFill = element('xp-fill');
  private readonly level = element('level');
  private readonly gold = element('gold-text');
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
  private readonly pause = element('pause');
  private readonly volMaster = element<HTMLInputElement>('vol-master');
  private readonly volEffects = element<HTMLInputElement>('vol-effects');
  private readonly volMusic = element<HTMLInputElement>('vol-music');
  private readonly volMute = element<HTMLInputElement>('vol-mute');
  private readonly soundOff = element('sound-off');
  private readonly loading = element('loading');
  private readonly loadingText = element('loading-text');
  private readonly choice = element('choice');
  private readonly choiceTitle = element('choice-title');
  private readonly choiceSubtitle = element('choice-subtitle');
  private readonly choiceCards = element('choice-cards');
  private readonly choiceGold = element('choice-gold');
  private readonly choiceSteigern = element('choice-steigern');
  private readonly choiceKeys = element('choice-keys');
  private readonly end = element('end');
  private readonly endTitle = element('end-title');
  private readonly endText = element('end-text');
  private readonly endStats = element('end-stats');
  private readonly endGold = element('end-gold');
  private readonly steigerung = element('steigerung');
  private readonly steigerungGold = element('steigerung-gold');
  private readonly steigerungTabs = element('steigerung-tabs');
  private readonly steigerungList = element('steigerung-list');
  private readonly debug: HTMLElement | null;
  private readonly shown = new Map<HTMLElement, string>();
  private cards: HTMLButtonElement[] = [];
  private steigerungRows: HTMLButtonElement[] = [];

  constructor(showDebug: boolean) {
    this.debug = showDebug ? element('debug') : null;
    if (this.debug) this.debug.hidden = false;
    // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
    for (const [id, action] of [
      ['choice-steigern', () => this.onSteigern()],
      ['end-steigern', () => this.onSteigern()],
      ['steigerung-back', () => this.onSteigerungBack()],
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
    this.text(this.level, `Stufe ${level}`);
    this.style(this.xpFill, 'width', percent(fraction));
  }

  /** Gold, das in dieser Nacht eingesammelt wurde. */
  setGold(gold: number): void {
    this.text(this.gold, String(gold));
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

  setPaused(paused: boolean): void {
    this.pause.hidden = !paused;
  }

  /** Verbindet die Tonregler im Pausenbild; `onChange` erfährt jede Änderung. */
  bindSound(volumes: Readonly<Volumes>, onChange: (volumes: Volumes) => void): void {
    const read = (): Volumes => ({
      master: Number(this.volMaster.value) / 100,
      effects: Number(this.volEffects.value) / 100,
      music: Number(this.volMusic.value) / 100,
      muted: this.volMute.checked,
    });
    for (const control of [this.volMaster, this.volEffects, this.volMusic, this.volMute]) {
      control.addEventListener('input', () => onChange(read()));
      // Der Fokus bliebe sonst am Regler hängen; die Pfeiltasten gehören aber dem Spiel.
      control.addEventListener('change', () => control.blur());
    }
    this.showSound(volumes);
  }

  /** Zeigt die Reglerstellungen, auch wenn sie über die Taste M geändert wurden. */
  showSound(volumes: Readonly<Volumes>): void {
    this.volMaster.value = String(Math.round(volumes.master * 100));
    this.volEffects.value = String(Math.round(volumes.effects * 100));
    this.volMusic.value = String(Math.round(volumes.music * 100));
    this.volMute.checked = volumes.muted;
    this.soundOff.hidden = !volumes.muted;
  }

  /** Hinweis, solange die Modelle geladen werden; `null` blendet ihn aus. */
  setLoading(text: string | null): void {
    this.loading.hidden = text === null;
    this.loadingText.textContent = text ?? '';
  }

  /**
   * Zeigt eine Auswahl. Mit `gold` (der Klassenwahl) steht darunter die Geldbörse samt Knopf zu den Steigerungen;
   * bei der Wahl einer Stärkung gibt es sie nicht.
   */
  showChoice(title: string, subtitle: string, cards: readonly ChoiceCard[], selected: number, gold: number | null = null): void {
    this.choiceTitle.textContent = title;
    this.choiceSubtitle.textContent = subtitle;
    this.cards = cards.map((card, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = card.segen ? 'card segen' : 'card';
      button.append(
        span('key', String(index + 1)),
        span('name', card.name),
        span('text', card.text),
        span('note', card.note),
        ...(card.extra ? [span('note extra', card.extra)] : []),
      );
      button.addEventListener('click', () => this.onPick(index));
      return button;
    });
    this.choiceCards.replaceChildren(...this.cards);
    this.choiceGold.hidden = gold === null;
    this.choiceSteigern.hidden = gold === null;
    if (gold !== null) this.choiceGold.textContent = `Gold: ${gold}`;
    this.choiceKeys.textContent =
      gold === null ? '1 · 2 · 3 oder Pfeiltasten und Enter' : '1 · 2 · 3 oder Pfeiltasten und Enter: Nacht beginnen · U: Klassen steigern';
    this.select(selected);
    this.choice.hidden = false;
  }

  select(index: number): void {
    for (const [cardIndex, card] of this.cards.entries()) {
      card.classList.toggle('selected', cardIndex === index);
    }
  }

  hideChoice(): void {
    this.choice.hidden = true;
  }

  /** `gold` beschreibt in einer Zeile den Ertrag der Nacht und die Geldbörse danach. */
  showEnd(title: string, text: string, stats: string, gold: string): void {
    this.endTitle.textContent = title;
    this.endText.textContent = text;
    this.endStats.textContent = stats;
    this.endGold.textContent = gold;
    this.end.hidden = false;
  }

  hideEnd(): void {
    this.end.hidden = true;
  }

  /** Zeigt das Menü der Steigerungen oder baut es nach einem Kauf neu auf. */
  showSteigerung(view: SteigerungView): void {
    this.steigerungGold.textContent = `Gold: ${view.gold}`;
    this.steigerungTabs.replaceChildren(
      ...view.classes.map((entry, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = index === view.active ? 'tab selected' : 'tab';
        tab.append(span('name', entry.name), span('note', `${entry.ranks} Ränge`));
        tab.addEventListener('click', () => this.onSteigerungClass(index));
        return tab;
      }),
    );
    this.steigerungRows = view.rows.map((row, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = row.cost === null ? 'row maxed' : row.affordable ? 'row' : 'row poor';
      const pips = span('pips', '');
      for (let i = 0; i < row.max; i++) pips.append(span(i < row.rank ? 'pip on' : 'pip', ''));
      button.append(
        span('name', row.name),
        span('rank', `Rang ${row.rank} von ${row.max}`),
        span('text', row.text),
        span('cost', row.cost === null ? 'Voll' : `${row.cost} Gold`),
        pips,
      );
      button.addEventListener('click', () => this.onSteigerungBuy(index));
      return button;
    });
    // Zwei Spalten, die Zeilen laufen spaltenweise: So führen Auf und Ab durch die Liste, ohne zur Seite zu springen.
    this.steigerungList.style.setProperty('--rows', String(Math.ceil(this.steigerungRows.length / 2)));
    this.steigerungList.replaceChildren(...this.steigerungRows);
    this.selectSteigerung(view.selected);
    this.steigerung.hidden = false;
  }

  selectSteigerung(index: number): void {
    for (const [rowIndex, row] of this.steigerungRows.entries()) {
      row.classList.toggle('selected', rowIndex === index);
      if (rowIndex === index) row.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Lässt die Geldbörse kurz aufleuchten, wenn das Gold für einen Rang nicht reicht. */
  denySteigerung(): void {
    this.steigerungGold.classList.remove('deny');
    void this.steigerungGold.offsetWidth;
    this.steigerungGold.classList.add('deny');
  }

  hideSteigerung(): void {
    this.steigerung.hidden = true;
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

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

export { formatTime };
