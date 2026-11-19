/**
 * Die Anzeige der Statistik: ein Reiter "Übersicht" und je ein Reiter für jede Klasse. Die Übersicht zeigt, wie oft jede Klasse gespielt
 * wurde; der Reiter einer Klasse zeigt ihre Nächte (Siege, Durchschnitt der überlebten Zeit), die Ränge ihrer Fertigkeiten, die erreichten
 * Stufen und die gewählten Stärkungen und Segen. Jede Zahl steht mit ihrem Anteil daneben.
 *
 * Die Anzeige bekommt eine fertige `Auswertung` (`core/auswertung.ts`) und liest nichts selbst: Dieselbe Anzeige zeigt die eigenen
 * Nächte im Spiel und später die aller Spieler auf einer eigenen Seite. Sie schreibt nur ins DOM und kennt keine Spielregeln,
 * nur die Namen (`CLASSES`, `UPGRADES`, `SEGEN`, Angriffe).
 */

import './statistik.css';
import { emptyTally, type Auswertung, type Tally } from '../core/auswertung';
import { CONFIG } from '../config';
import { CLASSES, type ClassDef } from '../game/classes';
import { SEGEN, UPGRADES } from '../game/progression';
import { EVOLUTION_RANK, MAX_RANK, weaponById } from '../game/weapons';

const NUMBER = new Intl.NumberFormat('de-DE');
const DECIMAL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Die Texte, die sich zwischen den eigenen und den gemeinsamen Nächten unterscheiden. */
export interface StatistikTexts {
  /** Steht in der Übersicht, solange es keine einzige Nacht gibt. */
  empty: string;
  /** Steht im Reiter einer Klasse ohne Nacht; `name` ist der Name der Klasse. */
  emptyClass(name: string): string;
}

export const OWN_TEXTS: StatistikTexts = {
  empty: 'Noch keine Nacht gespielt. Sobald eine Nacht endet, ob gewonnen, gefallen oder abgebrochen, erscheint sie hier.',
  emptyClass: (name) => `Mit ${name} hast du noch keine Nacht gespielt.`,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function count(value: number): string {
  return NUMBER.format(value);
}

/** Anteil in ganzen Prozent; was es gibt, aber unter einem Prozent bleibt, steht als "< 1 %", damit es nicht wie null aussieht. */
function percent(part: number, whole: number): string {
  if (part <= 0 || whole <= 0) return '0 %';
  const share = (part / whole) * 100;
  return share < 1 ? '< 1 %' : `${Math.round(share)} %`;
}

/** Sekunden als Minuten und Sekunden, wie die Uhr im Spiel. */
function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function average(tally: Tally): number {
  return tally.nights > 0 ? tally.seconds / tally.nights : 0;
}

function cell(text: string, className = ''): HTMLTableCellElement {
  return el('td', className, text);
}

function head(labels: readonly string[]): HTMLTableSectionElement {
  const thead = el('thead');
  const row = el('tr');
  for (const label of labels) row.append(el('th', '', label));
  thead.append(row);
  return thead;
}

/** Ein Balken, dessen Länge `fraction` (0 bis 1) der Zelle füllt. */
function bar(fraction: number): HTMLTableCellElement {
  const td = el('td', 'bar-cell');
  const track = el('span', 'bar');
  const fill = el('i');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  track.append(fill);
  td.append(track);
  return td;
}

/** Zahl über Anteil in einer Zelle. */
function figureCell(value: number, whole: number, heat?: number): HTMLTableCellElement {
  const td = el('td', 'figure-cell');
  td.append(el('span', '', count(value)), el('small', '', percent(value, whole)));
  if (heat !== undefined) {
    td.classList.add('heat');
    td.style.setProperty('--share', String(heat));
  }
  return td;
}

function card(title: string, wide = false): HTMLElement {
  const section = el('section', wide ? 'stats-card wide' : 'stats-card');
  section.append(el('h2', '', title));
  return section;
}

function scrollable(table: HTMLTableElement): HTMLElement {
  const wrap = el('div', 'table-scroll');
  wrap.append(table);
  return wrap;
}

/** Eine Zeile je Eintrag mit Balken, Zahl und Anteil; der Balken ist am größten Eintrag gemessen, der Anteil an `whole`. */
function ranking(rows: readonly { name: string; detail?: string; value: number }[], whole: number, labels: readonly [string, string, string]): HTMLElement {
  const table = el('table', 'stats-table');
  table.append(head([labels[0], '', labels[1], labels[2]]));
  const body = el('tbody');
  const top = Math.max(1, ...rows.map((row) => row.value));
  for (const row of rows) {
    const tr = el('tr');
    const name = el('td', 'name', row.name);
    if (row.detail) name.append(el('small', '', row.detail));
    tr.append(name, bar(row.value / top), cell(count(row.value)), cell(percent(row.value, whole)));
    body.append(tr);
  }
  table.append(body);
  return scrollable(table);
}

export class StatistikView {
  /** 0 ist die Übersicht, 1 und folgende sind die Klassen in der Reihenfolge von `CLASSES`. */
  private tab = 0;
  private data: Auswertung | null = null;

  /** `root` nimmt den Inhalt auf; `scroller` ist, was blättert (die Seite dahinter), damit ein Reiterwechsel nach oben springt. */
  constructor(
    private readonly root: HTMLElement,
    private readonly scroller: HTMLElement = root,
    private readonly texts: StatistikTexts = OWN_TEXTS,
  ) {}

  /** Zeigt die Auswertung; der Reiter bleibt, wo er war. */
  show(data: Auswertung): void {
    this.data = data;
    this.render();
  }

  /** Wechselt den Reiter um `delta` weiter (mit Umbruch); gibt zurück, ob sich etwas getan hat. */
  stepTab(delta: number): boolean {
    const count = CLASSES.length + 1;
    this.select((this.tab + delta + count) % count);
    return true;
  }

  private select(tab: number): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.scroller.scrollTop = 0;
    this.render();
  }

  private render(): void {
    const { data } = this;
    this.root.replaceChildren();
    if (!data) return;
    this.root.append(this.tabs(data));
    const playerClass = CLASSES[this.tab - 1];
    if (!playerClass) this.root.append(this.overview(data));
    else this.root.append(this.classPage(playerClass, data.byClass[playerClass.id]));
  }

  private tabs(data: Auswertung): HTMLElement {
    const bar = el('div', 'stats-tabs');
    bar.setAttribute('role', 'tablist');
    const labels = ['Übersicht', ...CLASSES.map((playerClass) => playerClass.name)];
    for (const [index, label] of labels.entries()) {
      const nights = index === 0 ? data.total.nights : (data.byClass[CLASSES[index - 1]?.id ?? '']?.nights ?? 0);
      const button = el('button', index === this.tab ? 'stats-tab selected' : 'stats-tab', label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === this.tab));
      button.append(el('small', '', `${count(nights)} ${nights === 1 ? 'Nacht' : 'Nächte'}`));
      button.addEventListener('click', () => {
        // Der Fokus bliebe sonst am Knopf hängen; Enter und die Pfeiltasten gehören aber dem Spiel.
        button.blur();
        this.select(index);
      });
      bar.append(button);
    }
    return bar;
  }

  /** Wie oft jede Klasse gespielt wurde, daneben ihre Siege und die mittlere Zeit. */
  private overview(data: Auswertung): HTMLElement {
    const page = el('div', 'stats-grid');
    if (data.total.nights === 0) {
      page.append(el('p', 'stats-empty', this.texts.empty));
      return page;
    }
    const section = card('Gespielte Klassen', true);
    const table = el('table', 'stats-table');
    table.append(head(['Klasse', 'Nächte', '', 'Anteil', 'Siege', 'Siegquote', 'Ø überlebt']));
    const body = el('tbody');
    const row = (name: string, tally: Tally, top: number, className = ''): HTMLTableRowElement => {
      const tr = el('tr', className);
      tr.append(
        el('td', 'name', name),
        cell(count(tally.nights)),
        bar(tally.nights / top),
        cell(percent(tally.nights, data.total.nights)),
        cell(count(tally.wins)),
        cell(percent(tally.wins, tally.nights)),
        cell(tally.nights > 0 ? duration(average(tally)) : '–'),
      );
      return tr;
    };
    const top = Math.max(1, ...CLASSES.map((playerClass) => data.byClass[playerClass.id]?.nights ?? 0));
    for (const playerClass of CLASSES) {
      body.append(row(playerClass.name, data.byClass[playerClass.id] ?? emptyTally(), top));
    }
    body.append(row('Alle Klassen', data.total, data.total.nights, 'total'));
    table.append(body);
    section.append(scrollable(table));
    page.append(section);
    return page;
  }

  private classPage(playerClass: ClassDef, tally: Tally | undefined): HTMLElement {
    const page = el('div', 'stats-grid');
    if (!tally || tally.nights === 0) {
      page.append(el('p', 'stats-empty', this.texts.emptyClass(playerClass.name)));
      return page;
    }
    page.append(this.nights(tally), this.skills(playerClass, tally), this.levels(tally));
    const right = el('div', 'stats-stack');
    right.append(this.upgrades(tally), this.blessings(tally));
    page.append(right);
    return page;
  }

  /** Die Nächte der Klasse: wie viele, wie sie endeten und wie lange die Figur im Schnitt überlebte. */
  private nights(tally: Tally): HTMLElement {
    const section = card('Die Nächte', true);
    const figures = el('dl', 'stats-figures');
    const figure = (label: string, value: string, detail = ''): void => {
      const box = el('div', 'figure');
      box.append(el('dt', '', label), el('dd', '', value));
      if (detail) box.append(el('small', '', detail));
      figures.append(box);
    };
    figure('Nächte gespielt', count(tally.nights));
    figure('Siege', count(tally.wins), percent(tally.wins, tally.nights));
    figure('Gefallen', count(tally.falls), percent(tally.falls, tally.nights));
    figure('Abgebrochen', count(tally.aborts), percent(tally.aborts, tally.nights));
    figure('Ø überlebt', duration(average(tally)), `von ${duration(CONFIG.run.nightSeconds)}`);
    section.append(figures);
    return section;
  }

  /** Auf welchem Rang jede Fertigkeit am Ende der Nacht stand, in wie vielen Nächten. Je dunkler die Zelle, desto häufiger. */
  private skills(playerClass: ClassDef, tally: Tally): HTMLElement {
    const section = card('Fertigkeiten: Rang am Ende der Nacht', true);
    const ranks = Array.from({ length: MAX_RANK }, (_, index) => index + 1);
    const table = el('table', 'stats-table skills');
    table.append(head(['Fertigkeit', 'Nicht gewählt', ...ranks.map((rank) => `Rang ${rank}`), 'Evolution']));
    const body = el('tbody');
    for (const id of playerClass.weapons) {
      const def = weaponById(id);
      const at = tally.skills[id] ?? {};
      const chosen = Object.values(at).reduce((sum, nights) => sum + nights, 0);
      const tr = el('tr');
      tr.append(el('td', 'name', def.name));
      const columns = [Math.max(0, tally.nights - chosen), ...ranks.map((rank) => at[rank] ?? 0)];
      for (const nights of columns) tr.append(figureCell(nights, tally.nights, nights / tally.nights));
      // Eine Evolution gibt es nur dort, wo der Angriff eine hat.
      if (def.evolution) tr.append(figureCell(at[EVOLUTION_RANK] ?? 0, tally.nights, (at[EVOLUTION_RANK] ?? 0) / tally.nights));
      else tr.append(cell('–', 'none'));
      body.append(tr);
    }
    table.append(body);
    section.append(scrollable(table));
    section.append(el('p', 'stats-note', 'Zahl der Nächte und ihr Anteil an allen Nächten der Klasse; jede Zeile ergibt zusammen 100 %.'));
    return section;
  }

  /** Auf welcher Stufe die Figur am Ende der Nacht stand, in wie vielen Nächten. */
  private levels(tally: Tally): HTMLElement {
    const section = card('Erreichte Stufe');
    const reached = Object.keys(tally.levels).map(Number);
    const low = Math.min(...reached);
    const high = Math.max(...reached);
    const rows: { name: string; value: number }[] = [];
    // Stufen dazwischen, die nie das Ende waren, stehen mit 0 da; so bleibt die Reihe lückenlos.
    for (let level = high; level >= low; level--) rows.push({ name: `Stufe ${level}`, value: tally.levels[level] ?? 0 });
    section.append(ranking(rows, tally.nights, ['Stufe', 'Nächte', 'Anteil']));
    const mean = reached.reduce((sum, level) => sum + level * (tally.levels[level] ?? 0), 0) / tally.nights;
    section.append(el('p', 'stats-note', `Im Schnitt Stufe ${DECIMAL.format(mean)}, am höchsten Stufe ${high}.`));
    return section;
  }

  private upgrades(tally: Tally): HTMLElement {
    const section = card('Gewählte Stärkungen');
    const rows = UPGRADES.map((upgrade) => ({ name: upgrade.name, detail: upgrade.text, value: tally.upgrades[upgrade.id] ?? 0 }));
    const whole = rows.reduce((sum, row) => sum + row.value, 0);
    section.append(ranking(this.byCount(rows), whole, ['Stärkung', 'Gewählt', 'Anteil']));
    return section;
  }

  private blessings(tally: Tally): HTMLElement {
    const section = card('Gewährte Segen');
    const rows = SEGEN.map((segen) => ({ name: segen.name, detail: segen.macht, value: tally.segen[segen.id] ?? 0 }));
    const whole = rows.reduce((sum, row) => sum + row.value, 0);
    section.append(ranking(this.byCount(rows), whole, ['Segen', 'Gewährt', 'Anteil']));
    return section;
  }

  /** Das Häufigste zuerst; bei gleicher Zahl bleibt die Reihenfolge aus dem Spiel. */
  private byCount<T extends { value: number }>(rows: readonly T[]): T[] {
    return rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.value - a.row.value || a.index - b.index).map(({ row }) => row);
  }
}
