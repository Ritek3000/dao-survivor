import type { VitalsPosition } from '../core/settings';
import type { Rarity } from '../game/items';
import type { IslandBearing, Zone } from '../game/zones';
import { element, span } from './dom';

/** Eine Karte in einer Auswahl: Klasse zu Beginn, Stärkung beim Stufenaufstieg. */
export interface ChoiceCard {
  name: string;
  text: string;
  /** Kleingedrucktes unter dem Text, etwa der Rang. */
  note: string;
  /** Ein Segen einer Höheren Macht wird hervorgehoben. */
  segen?: boolean;
  /** Zweites Kleingedrucktes, etwa wie viele Gegenstände die Klasse trägt. */
  extra?: string;
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
  private readonly hpFill = element('hp-fill');
  private readonly hpDust = element('hp-dust');
  private readonly hpText = element('hp-text');
  private readonly xpFill = element('xp-fill');
  private readonly level = element('level-text');
  private readonly gold = element('gold-text');
  private readonly loot = element('loot');
  private readonly lootText = element('loot-text');
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
  private readonly choice = element('choice');
  private readonly choiceTitle = element('choice-title');
  private readonly choiceSubtitle = element('choice-subtitle');
  private readonly choiceCards = element('choice-cards');
  private readonly choiceGold = element('choice-gold');
  private readonly choiceNote = element('choice-note');
  private readonly choiceLager = element('choice-lager');
  private readonly endLager = element('end-lager');
  private readonly endKeys = element('end-keys');
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
  private cards: HTMLButtonElement[] = [];
  private lagerEnabled = false;

  constructor(showDebug: boolean) {
    this.debug = showDebug ? element('debug') : null;
    if (this.debug) this.debug.hidden = false;
    // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
    for (const [id, action] of [
      ['choice-lager', () => this.onLager()],
      ['end-lager', () => this.onLager()],
      ['choice-main-menu', () => this.onMainMenu()],
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

  /** Hinweis, solange die Modelle geladen werden; `null` blendet ihn aus. */
  setLoading(text: string | null): void {
    this.loading.hidden = text === null;
    this.loadingText.textContent = text ?? '';
  }

  /**
   * Zeigt eine Auswahl. Mit `gold` (der Klassenwahl) steht darunter die Geldbörse samt Knopf zum Lager, und `note` ist ein Hinweis
   * darunter (leer: keiner); bei der Wahl einer Stärkung gibt es das alles nicht.
   */
  showChoice(
    title: string,
    subtitle: string,
    cards: readonly ChoiceCard[],
    selected: number,
    gold: number | null = null,
    note = '',
  ): void {
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
    this.choiceNote.textContent = note;
    this.choiceNote.hidden = gold === null || note === '';
    this.choiceLager.hidden = gold === null || !this.lagerEnabled;
    this.choiceMainMenu.hidden = gold === null;
    if (gold !== null) this.choiceGold.textContent = `Gold: ${gold}`;
    this.choiceKeys.textContent =
      gold === null
        ? '1 · 2 · 3 oder Pfeiltasten und Enter'
        : `1 · 2 · 3 oder Pfeiltasten und Enter: Nacht beginnen${this.lagerEnabled ? ' · L: Lager' : ''} · Esc: Hauptmenü`;
    this.select(selected);
    this.choice.hidden = false;
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
