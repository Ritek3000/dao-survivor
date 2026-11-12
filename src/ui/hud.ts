import type { IslandBearing, Zone } from '../game/zones';

/** Eine Karte in einer Auswahl: Klasse zu Beginn, Stärkung beim Stufenaufstieg. */
export interface ChoiceCard {
  name: string;
  text: string;
  /** Kleingedrucktes unter dem Text, etwa der Rang. */
  note: string;
  /** Ein Segen einer Höheren Macht wird hervorgehoben. */
  segen?: boolean;
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
  private readonly hpFill = element('hp-fill');
  private readonly hpDust = element('hp-dust');
  private readonly hpText = element('hp-text');
  private readonly xpFill = element('xp-fill');
  private readonly level = element('level');
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
  private readonly loading = element('loading');
  private readonly loadingText = element('loading-text');
  private readonly choice = element('choice');
  private readonly choiceTitle = element('choice-title');
  private readonly choiceSubtitle = element('choice-subtitle');
  private readonly choiceCards = element('choice-cards');
  private readonly end = element('end');
  private readonly endTitle = element('end-title');
  private readonly endText = element('end-text');
  private readonly endStats = element('end-stats');
  private readonly debug: HTMLElement | null;
  private readonly shown = new Map<HTMLElement, string>();
  private cards: HTMLButtonElement[] = [];

  constructor(showDebug: boolean) {
    this.debug = showDebug ? element('debug') : null;
    if (this.debug) this.debug.hidden = false;
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

  /** Hinweis, solange die Modelle geladen werden; `null` blendet ihn aus. */
  setLoading(text: string | null): void {
    this.loading.hidden = text === null;
    this.loadingText.textContent = text ?? '';
  }

  showChoice(title: string, subtitle: string, cards: readonly ChoiceCard[], selected: number): void {
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
      );
      button.addEventListener('click', () => this.onPick(index));
      return button;
    });
    this.choiceCards.replaceChildren(...this.cards);
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

  showEnd(title: string, text: string, stats: string): void {
    this.endTitle.textContent = title;
    this.endText.textContent = text;
    this.endStats.textContent = stats;
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

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

export { formatTime };
