/**
 * Die Anzeige der Statistik: ein Reiter "Übersicht", je ein Reiter für jede Klasse, ein Reiter "Nachtarten" und ein Reiter "Höchster Grad".
 * Die Übersicht zeigt, wie oft jede Klasse gespielt wurde; der Reiter einer Klasse zeigt ihre Nächte (Siege, Durchschnitt der überlebten Zeit),
 * die Ränge ihrer Fertigkeiten, die erreichten Stufen und die gewählten Stärkungen und Segen, und zwar insgesamt oder, über Unterreiter und
 * Gradauswahl, nur für eine Nachtart und einen Grad. Der Reiter "Nachtarten" zählt jede Nachtart und jeden ihrer Grade über alle Klassen auf
 * und zeigt zur gewählten Zeile dasselbe (ohne Fertigkeiten, die gehören einer Klasse). "Höchster Grad" nennt je Nachtart den höchsten
 * geschafften Grad und die Klasse, die ihn zuerst geschafft hat. Jede Zahl steht mit ihrem Anteil daneben.
 *
 * Die Anzeige bekommt eine fertige `Auswertung` (`core/auswertung.ts`) und liest nichts selbst: Dieselbe Anzeige zeigt die eigenen
 * Nächte im Spiel und später die aller Spieler auf einer eigenen Seite. Sie schreibt nur ins DOM und kennt keine Spielregeln,
 * nur die Namen (`CLASSES`, `UPGRADES`, `SEGEN`, Angriffe).
 */

import './statistik.css';
import { emptyTally, type Auswertung, type Tally } from '../core/auswertung';
import { CONFIG } from '../config';
import { CLASSES, type ClassDef } from '../game/classes';
import { NIGHTS, type NightDef } from '../game/nights';
import { SEGEN, UPGRADES } from '../game/progression';
import { EVOLUTION_RANK, MAX_RANK, weaponById } from '../game/weapons';

const NUMBER = new Intl.NumberFormat('de-DE');
const DECIMAL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Die Texte, die sich zwischen den eigenen und den gemeinsamen Nächten unterscheiden. */
export interface StatistikTexts {
  /** Steht in der Übersicht, solange es keine einzige Nacht gibt. */
  empty: string;
  /** Steht im Reiter einer Klasse ohne Nacht; `name` ist der Name der Klasse. */
  emptyClass(name: string): string;
  /** Steht im Reiter der Nachtarten, solange keine Nacht mit bekannter Nachtart vorliegt. */
  emptyNights: string;
  /** Steht im Reiter einer Klasse, wenn sie in der gewählten Nachtart noch keine Nacht hat; `night` ist der Name der Nachtart. */
  emptyClassNight(name: string, night: string): string;
  /** Steht dort, wo die Auswertung die Aufschlüsselung nach Klasse und Nachtart nicht mitbringt (siehe `StatistikView.outdated`). */
  outdated: string;
}

export const OWN_TEXTS: StatistikTexts = {
  empty: 'Noch keine Nacht gespielt. Sobald eine Nacht endet, ob gewonnen, gefallen oder abgebrochen, erscheint sie hier.',
  emptyClass: (name) => `Mit ${name} hast du noch keine Nacht gespielt.`,
  emptyNights: 'Noch keine Nacht mit bekannter Nachtart. Sobald eine Nacht endet, erscheint sie hier mit ihrer Nachtart und ihrem Grad.',
  emptyClassNight: (name, night) => `Mit ${name} hast du noch keine Nacht der Art „${night}“ gespielt.`,
  outdated: 'Diese Auswertung enthält die Aufschlüsselung nach Klasse und Nachtart noch nicht.',
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

/** "1 Nacht", "12 Nächte". */
function nightsLabel(nights: number): string {
  return `${count(nights)} ${nights === 1 ? 'Nacht' : 'Nächte'}`;
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

/** Die mittlere Stufe am Ende der Nacht; 0, wenn es keine Nacht gibt. */
function meanLevel(tally: Tally): number {
  if (tally.nights <= 0) return 0;
  const total = Object.entries(tally.levels).reduce((sum, [level, nights]) => sum + Number(level) * nights, 0);
  return total / tally.nights;
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

/** Die gewählte Zeile im Reiter der Nachtarten: eine Nachtart, ganz (`grade` ist `null`) oder in einem Grad. */
interface NightPick {
  night: string;
  grade: number | null;
}

/** Was die Seite einer Klasse zeigt (siehe `StatistikView.resolveClassView`): Nachtart ("" ist gesamt), Grad (`null` ist alle) und die Zähler. */
interface ClassView {
  night: string;
  grade: number | null;
  tally: Tally | undefined;
}

export class StatistikView {
  /**
   * 0 ist die Übersicht, 1 bis `CLASSES.length` sind die Klassen in der Reihenfolge von `CLASSES`, danach folgen die Nachtarten und
   * zuletzt der höchste Grad.
   */
  private tab = 0;
  private data: Auswertung | null = null;
  /** Der Unterreiter der Klasse: leer für "Gesamt", sonst die Kennung der Nachtart. Er bleibt beim Wechsel der Klasse stehen, damit man sie vergleichen kann. */
  private classNight = '';
  /** Der gewählte Grad im Unterreiter einer Nachtart; `null` heißt alle Grade. Ob es ihn für die Klasse gibt, prüft `resolveClassView`. */
  private classGrade: number | null = null;
  /** Was im Reiter der Nachtarten unter der Tabelle ausgeführt wird; ob es noch passt, prüft `resolvePick`. */
  private pick: NightPick | null = null;

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
    const count = CLASSES.length + 3;
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
    if (this.tab === 0) this.root.append(this.overview(data));
    else if (playerClass) this.root.append(this.classPage(playerClass, data));
    else if (this.tab === CLASSES.length + 1) this.root.append(this.nightsPage(data));
    else this.root.append(this.highestPage(data));
  }

  private tabs(data: Auswertung): HTMLElement {
    const bar = el('div', 'stats-tabs');
    bar.setAttribute('role', 'tablist');
    const labels = ['Übersicht', ...CLASSES.map((playerClass) => playerClass.name), 'Nachtarten', 'Höchster Grad'];
    for (const [index, label] of labels.entries()) {
      let note: string;
      if (index === labels.length - 1) note = `${Object.keys(data.highestGrade).length} von ${NIGHTS.length} geschafft`;
      else {
        let nights: number;
        if (index === 0) nights = data.total.nights;
        else if (index <= CLASSES.length) nights = data.byClass[CLASSES[index - 1]?.id ?? '']?.nights ?? 0;
        else nights = this.knownNights(data);
        note = nightsLabel(nights);
      }
      const button = el('button', index === this.tab ? 'stats-tab selected' : 'stats-tab', label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === this.tab));
      button.append(el('small', '', note));
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

  /**
   * Die Seite einer Klasse: oben die Unterreiter (Gesamt und je Nachtart) und, in einer Nachtart, die Gradauswahl; darunter die Nächte,
   * Fertigkeiten, Stufen, Stärkungen und Segen der Auswahl.
   */
  private classPage(playerClass: ClassDef, data: Auswertung): HTMLElement {
    const page = el('div', 'stats-grid');
    const total = data.byClass[playerClass.id];
    if (!total || total.nights === 0) {
      page.append(el('p', 'stats-empty', this.texts.emptyClass(playerClass.name)));
      return page;
    }
    const view = this.resolveClassView(playerClass, data, total);
    page.append(this.classFilter(playerClass, data, view));
    if (!view.tally) {
      const night = NIGHTS.find((candidate) => candidate.id === view.night);
      const text = this.outdated(data) ? this.texts.outdated : this.texts.emptyClassNight(playerClass.name, night?.name ?? view.night);
      page.append(el('p', 'stats-empty', text));
      return page;
    }
    const { tally } = view;
    page.append(this.nights(tally), this.skills(playerClass, tally, view.night !== ''), this.levels(tally));
    const right = el('div', 'stats-stack');
    right.append(this.upgrades(tally), this.blessings(tally));
    page.append(right);
    return page;
  }

  /**
   * Was die Seite der Klasse zeigt: Unterreiter und Grad, soweit es sie für die Klasse gibt (sonst gilt "Gesamt" bzw. "alle Grade"), und die
   * Zähler dazu. `tally` fehlt, wenn die Klasse in der Nachtart keine Nacht hat.
   */
  private resolveClassView(playerClass: ClassDef, data: Auswertung, total: Tally): ClassView {
    const night = NIGHTS.some((candidate) => candidate.id === this.classNight) ? this.classNight : '';
    if (night === '') return { night, grade: null, tally: total };
    const ofNight = data.byClassNight[playerClass.id]?.[night];
    const grades = data.byClassNightGrade[playerClass.id]?.[night] ?? {};
    const wanted = this.classGrade;
    const ofGrade = wanted === null ? undefined : grades[wanted];
    if (wanted !== null && ofGrade && ofGrade.nights > 0) return { night, grade: wanted, tally: ofGrade };
    return { night, grade: null, tally: ofNight && ofNight.nights > 0 ? ofNight : undefined };
  }

  /**
   * Kommt die Auswertung von einer Sammelstelle, die noch den Stand vor `byClassNight` und `highestGrade` hat (ihr SQL-Skript wurde nicht
   * erneuert)? Sie kennt dann Nächte je Nachtart, aber nichts je Klasse und Nachtart. Die Seiten sagen es, statt "keine Nacht" zu behaupten.
   */
  private outdated(data: Auswertung): boolean {
    return Object.keys(data.byNight).length > 0 && Object.keys(data.byClassNight).length === 0;
  }

  /** Die Unterreiter "Gesamt" und je Nachtart; ist eine Nachtart gewählt, darunter die Grade, in denen die Klasse sie gespielt hat. */
  private classFilter(playerClass: ClassDef, data: Auswertung, view: ClassView): HTMLElement {
    const filter = el('div', 'stats-filter');
    const nights = el('div', 'stats-tabs sub');
    nights.setAttribute('role', 'tablist');
    const entries = [
      { id: '', name: 'Gesamt', tally: data.byClass[playerClass.id] },
      ...NIGHTS.map((night) => ({ id: night.id, name: night.name, tally: data.byClassNight[playerClass.id]?.[night.id] })),
    ];
    for (const entry of entries) {
      const amount = entry.tally?.nights ?? 0;
      const selected = entry.id === view.night;
      const button = el('button', selected ? 'stats-tab selected' : amount > 0 ? 'stats-tab' : 'stats-tab dim', entry.name);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(selected));
      button.append(el('small', '', nightsLabel(amount)));
      button.addEventListener('click', () => {
        // Wie bei den Reitern: Der Fokus soll nicht am Knopf hängen bleiben (Enter und die Pfeiltasten gehören dem Spiel).
        button.blur();
        this.classNight = entry.id;
        this.classGrade = null;
        this.render();
      });
      nights.append(button);
    }
    filter.append(nights);
    const grades = data.byClassNightGrade[playerClass.id]?.[view.night] ?? {};
    const played = Object.keys(grades)
      .map(Number)
      .sort((a, b) => a - b)
      .filter((grade) => (grades[grade]?.nights ?? 0) > 0);
    // Gibt es nur einen Grad, ist die Auswahl überflüssig: Er wäre dasselbe wie "alle Grade".
    if (view.night !== '' && played.length > 1) {
      const chips = el('div', 'stats-chips');
      const chip = (label: string, amount: number, grade: number | null): void => {
        const selected = grade === view.grade;
        const button = el('button', selected ? 'stats-chip selected' : 'stats-chip', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(selected));
        button.append(el('small', '', String(amount)));
        button.addEventListener('click', () => {
          button.blur();
          this.classGrade = grade;
          this.render();
        });
        chips.append(button);
      };
      chip('Alle Grade', data.byClassNight[playerClass.id]?.[view.night]?.nights ?? 0, null);
      for (const grade of played) chip(`Grad ${grade}`, grades[grade]?.nights ?? 0, grade);
      filter.append(chips);
    }
    return filter;
  }

  /** Die Nächte der Klasse (oder der Nachtart): wie viele, wie sie endeten und wie lange die Figur im Schnitt überlebte. */
  private nights(tally: Tally, title = 'Die Nächte'): HTMLElement {
    const section = card(title, true);
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
  private skills(playerClass: ClassDef, tally: Tally, scoped = false): HTMLElement {
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
    const whole = scoped ? 'der gewählten Nachtart (und des Grads)' : 'der Klasse';
    section.append(el('p', 'stats-note', `Zahl der Nächte und ihr Anteil an allen Nächten ${whole}; jede Zeile ergibt zusammen 100 %.`));
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
    section.append(el('p', 'stats-note', `Im Schnitt Stufe ${DECIMAL.format(meanLevel(tally))}, am höchsten Stufe ${high}.`));
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

  /** Wie viele Nächte eine bekannte Nachtart haben; die anderen (aus früheren Fassungen) fehlen im Reiter der Nachtarten. */
  private knownNights(data: Auswertung): number {
    return Object.values(data.byNight).reduce((sum, tally) => sum + tally.nights, 0);
  }

  /** Die Zähler zu einer Wahl; `undefined`, wo es keine Nacht gibt. */
  private tallyOf(data: Auswertung, pick: NightPick): Tally | undefined {
    const tally = pick.grade === null ? data.byNight[pick.night] : data.byNightGrade[pick.night]?.[pick.grade];
    return tally && tally.nights > 0 ? tally : undefined;
  }

  /**
   * Die Wahl, die gilt: die gemerkte, solange es dafür Nächte gibt (sonst gilt die ganze Nachtart, und fehlt auch die, die erste Nachtart
   * mit Nächten, in der Reihenfolge von `NIGHTS`). `null`, wenn es keine Nacht mit bekannter Nachtart gibt.
   */
  private resolvePick(data: Auswertung): NightPick | null {
    const wanted = this.pick;
    if (wanted && this.tallyOf(data, wanted)) return wanted;
    if (wanted && this.tallyOf(data, { night: wanted.night, grade: null })) return { night: wanted.night, grade: null };
    const first = NIGHTS.find((night) => this.tallyOf(data, { night: night.id, grade: null }));
    return first ? { night: first.id, grade: null } : null;
  }

  /**
   * Der Reiter der Nachtarten: oben jede Nachtart mit ihren Graden in einer Tabelle (ein Klick wählt eine Zeile), darunter zur gewählten
   * Zeile dieselben Angaben wie bei einer Klasse, nur ohne die Fertigkeiten (die gehören einer Klasse, nicht einer Nachtart).
   */
  private nightsPage(data: Auswertung): HTMLElement {
    const page = el('div', 'stats-grid');
    const pick = this.resolvePick(data);
    if (!pick) {
      page.append(el('p', 'stats-empty', this.texts.emptyNights));
      return page;
    }
    page.append(this.nightTable(data, pick));
    const night = NIGHTS.find((candidate) => candidate.id === pick.night);
    const tally = this.tallyOf(data, pick);
    if (!night || !tally) return page;
    page.append(this.nights(tally, this.pickTitle(night, pick.grade)), this.levels(tally));
    const right = el('div', 'stats-stack');
    right.append(this.upgrades(tally), this.blessings(tally));
    page.append(right);
    return page;
  }

  /** Je Nachtart der höchste geschaffte Grad und die Klasse, die ihn zuerst geschafft hat. */
  private highestPage(data: Auswertung): HTMLElement {
    const page = el('div', 'stats-grid');
    if (this.knownNights(data) === 0) {
      page.append(el('p', 'stats-empty', this.texts.emptyNights));
      return page;
    }
    if (this.outdated(data)) {
      page.append(el('p', 'stats-empty', this.texts.outdated));
      return page;
    }
    const section = card('Höchster Grad je Nachtart', true);
    const table = el('table', 'stats-table highest');
    table.append(head(['Nachtart', 'Höchster Grad', 'Zuerst geschafft mit', 'Am']));
    const body = el('tbody');
    for (const night of NIGHTS) {
      const best = data.highestGrade[night.id];
      const tr = el('tr');
      tr.append(el('td', 'name', night.name));
      if (best) {
        const className = CLASSES.find((candidate) => candidate.id === best.classId)?.name ?? best.classId;
        tr.append(cell(`Grad ${best.grade}`), cell(className), cell(best.at > 0 ? DATE.format(best.at) : '–'));
      } else {
        tr.append(cell('–', 'none'), cell('noch nicht geschafft', 'none'), cell('', 'none'));
      }
      body.append(tr);
    }
    table.append(body);
    section.append(scrollable(table));
    section.append(
      el('p', 'stats-note', 'Es zählt der höchste Grad, in dem die Nacht gewonnen wurde (die Sonne ging auf). Haben ihn mehrere Klassen geschafft, steht die, die es zuerst geschafft hat.'),
    );
    page.append(section);
    return page;
  }

  private pickTitle(night: NightDef, grade: number | null): string {
    return grade === null ? `${night.name} · alle Grade` : `${night.name} · Grad ${grade}`;
  }

  /** Eine Zeile je Nachtart (mit allen ihren Graden zusammen) und darunter eine je gespieltem Grad, aufsteigend. */
  private nightTable(data: Auswertung, pick: NightPick): HTMLElement {
    const section = card('Nachtarten und Grade', true);
    const known = this.knownNights(data);
    const table = el('table', 'stats-table nights');
    table.append(head(['Nachtart / Grad', 'Nächte', '', 'Anteil', 'Siege', 'Siegquote', 'Ø überlebt', 'Ø Stufe']));
    const body = el('tbody');
    const top = Math.max(1, ...Object.values(data.byNight).map((tally) => tally.nights));
    const row = (label: string, tally: Tally, choice: NightPick, className: string): void => {
      const chosen = choice.night === pick.night && choice.grade === pick.grade;
      const tr = el('tr', chosen ? `${className} chosen` : className);
      const name = el('td', 'name');
      const button = el('button', 'stats-pick', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(chosen));
      button.addEventListener('click', () => {
        // Wie bei den Reitern: Enter und die Pfeiltasten gehören dem Spiel, der Fokus soll nicht am Knopf hängen bleiben.
        button.blur();
        this.pick = choice;
        this.render();
      });
      name.append(button);
      tr.append(
        name,
        cell(count(tally.nights)),
        bar(tally.nights / top),
        cell(percent(tally.nights, known)),
        cell(count(tally.wins)),
        cell(percent(tally.wins, tally.nights)),
        cell(duration(average(tally))),
        cell(DECIMAL.format(meanLevel(tally))),
      );
      body.append(tr);
    };
    for (const night of NIGHTS) {
      const tally = data.byNight[night.id];
      if (!tally || tally.nights === 0) continue;
      row(night.name, tally, { night: night.id, grade: null }, 'night');
      const grades = data.byNightGrade[night.id] ?? {};
      for (const grade of Object.keys(grades).map(Number).sort((a, b) => a - b)) {
        const gradeTally = grades[grade];
        if (gradeTally && gradeTally.nights > 0) row(`Grad ${grade}`, gradeTally, { night: night.id, grade }, 'grade');
      }
    }
    table.append(body);
    section.append(scrollable(table));
    section.append(el('p', 'stats-note', 'Die Zeile einer Nachtart zählt alle ihre Grade zusammen. Ein Klick auf eine Zeile zeigt darunter ihre Stufen, Stärkungen und Segen.'));
    const unknown = data.total.nights - known;
    if (unknown > 0) {
      const text = unknown === 1 ? '1 Nacht' : `${count(unknown)} Nächte`;
      section.append(el('p', 'stats-note', `${text} aus früheren Fassungen ${unknown === 1 ? 'kennt' : 'kennen'} ihre Nachtart nicht und ${unknown === 1 ? 'fehlt' : 'fehlen'} hier.`));
    }
    return section;
  }

  /** Das Häufigste zuerst; bei gleicher Zahl bleibt die Reihenfolge aus dem Spiel. */
  private byCount<T extends { value: number }>(rows: readonly T[]): T[] {
    return rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.value - a.row.value || a.index - b.index).map(({ row }) => row);
  }
}
