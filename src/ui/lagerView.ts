import type { Rarity } from '../game/items';
import { element, span } from './dom';
import { iconElement, type ItemIconId } from './itemIcons';

/** Ein Gegenstand, wie ihn die Oberfläche zeigt; den Text und die Zahlen bereitet `game/lager.ts` auf. */
export interface ItemView {
  name: string;
  rarity: Rarity;
  /** Zweite Zeile unter dem Namen, etwa „Rar · Ring“. */
  subtitle: string;
  icon: ItemIconId;
  props: readonly { text: string; range: string; quality: number }[];
  /** Hinweis zur Bindung an eine Klasse („Nur für den Magier“), sonst `null`. */
  bound: string | null;
}

export interface SlotView {
  /** Name des Platzes, bei Plätzen der Ausrüstung unter dem Zeichen. */
  label: string;
  /** Das Zeichen eines leeren Platzes der Ausrüstung; leere Plätze im Inventar haben keins. */
  icon: ItemIconId | null;
  item: ItemView | null;
}

/** Ein Reiter der Truhe in der Leiste. */
export interface ReiterView {
  name: string;
  /** CSS-Farbe der Markierung. */
  color: string;
  count: number;
  size: number;
}

export interface TruheModel {
  tabs: readonly ReiterView[];
  /** Der geöffnete Reiter. */
  active: number;
  slots: readonly SlotView[];
  /** Die Befehle hinter den Reitern, in der Reihenfolge: neuer Reiter, umbenennen, Farbe, löschen. */
  commands: readonly { label: string; title: string }[];
}

/** Wo der Zeiger steht: auf den angelegten Gegenständen, im Inventar, in der Truhe oder in der Leiste ihrer Reiter und Befehle. */
export type LagerZone = 'ausruestung' | 'inventar' | 'truhe' | 'reiter';

/** Die zwei Ansichten des Lagers: Ausrüstung mit Inventar, oder Inventar mit Truhe. */
export type LagerMode = 'ausruestung' | 'truhe';

/** Ein Platz auf dem Bildschirm. In der Zone `reiter` zählen erst die Reiter, dann die Befehle. */
export interface Mark {
  zone: LagerZone;
  index: number;
}

export interface LagerModel {
  gold: number;
  classes: readonly { name: string; note: string }[];
  active: number;
  mode: LagerMode;
  equipment: readonly SlotView[];
  inventory: readonly SlotView[];
  /** Die Summe der Eigenschaften der angelegten Gegenstände; `capped`: der Höchstwert ist erreicht. */
  summary: readonly { text: string; capped: boolean }[];
  truhe: TruheModel;
  /** Der Platz des Gegenstands, den die Figur in der Hand hält, wenn er gerade zu sehen ist. */
  held: Mark | null;
  /** Zeile über den Tasten: was in der Hand liegt und was man damit tun kann. */
  hand: string;
  /** Rückmeldung zur letzten Handlung, etwa warum etwas nicht ging. */
  note: string;
  keys: string;
}

export interface DetailView {
  /** Was angezeigt wird: ein Gegenstand oder, bei einem leeren Platz, nur dessen Name. */
  item: ItemView | null;
  emptyText: string;
  /** Unterschied zum angelegten Gegenstand desselben Platzes; `null`, wenn es nichts zu vergleichen gibt. */
  compare: readonly { text: string; better: boolean }[] | null;
  compareTitle: string;
}

export const EQUIPMENT_COLUMNS = 3;
export const INVENTORY_COLUMNS = 5;
export const TRUHE_COLUMNS = 5;

/** So weit (in Pixeln) muss der Zeiger bei gedrückter Taste wandern, bis aus einem Klick ein Ziehen wird. */
const DRAG_DISTANCE = 8;

const MODE_LABELS: Readonly<Record<LagerMode, string>> = { ausruestung: 'Ausrüstung', truhe: 'Truhe' };

/**
 * Die Oberfläche des Lagers: die Ansichten Ausrüstung und Truhe, die Karte des markierten Gegenstands und die Übersicht.
 * Hält keinen Spielzustand; Klicks, Ziehen und Eingaben gehen als Rückrufe an `game/lager.ts`.
 */
export class LagerView {
  onClass: (index: number) => void = () => {};
  onMode: (mode: LagerMode) => void = () => {};
  /** Ein Platz wurde angeklickt. */
  onActivate: (zone: LagerZone, index: number) => void = () => {};
  /** Der Zeiger liegt über einem Platz. */
  onHover: (zone: LagerZone, index: number) => void = () => {};
  /** Ein Gegenstand wurde gezogen und losgelassen; `to` ist `null`, wenn dort kein Platz war. */
  onDrag: (from: Mark, to: Mark | null) => void = () => {};
  /** Der Name eines Reiters wurde bestätigt (`text`) oder die Eingabe abgebrochen (`null`). */
  onRename: (text: string | null) => void = () => {};
  /** Antwort auf die Rückfrage: `true` für die zweite Möglichkeit. */
  onAsk: (yes: boolean) => void = () => {};
  onBack: () => void = () => {};
  private readonly root = element('lager');
  private readonly gold = element('lager-gold');
  private readonly tabs = element('lager-tabs');
  private readonly modes = element('lager-modes');
  private readonly equipment = element('lager-equipment');
  private readonly inventory = element('lager-inventory');
  private readonly truhe = element('lager-truhe');
  private readonly reiter = element('truhe-tabs');
  private readonly truheSlots = element('truhe-slots');
  private readonly rename = element('truhe-rename');
  private readonly nameField = element<HTMLInputElement>('truhe-name');
  private readonly ask = element('truhe-ask');
  private readonly askText = element('truhe-ask-text');
  private readonly askNo = element<HTMLButtonElement>('truhe-ask-no');
  private readonly askYes = element<HTMLButtonElement>('truhe-ask-yes');
  private readonly detail = element('lager-detail');
  private readonly summary = element('lager-summary');
  private readonly hand = element('lager-hand');
  private readonly note = element('lager-note');
  private readonly keys = element('lager-keys');
  private cells: Record<LagerZone, HTMLButtonElement[]> = { ausruestung: [], inventar: [], truhe: [], reiter: [] };
  private pressed: { from: Mark; item: ItemView; x: number; y: number } | null = null;
  private dragging = false;
  private ghost: HTMLElement | null = null;
  /** Nach dem Ziehen löst das Loslassen noch einen Klick aus; der soll nicht noch einmal ablegen. */
  private suppressClick = false;

  constructor() {
    const back = element('lager-back');
    back.addEventListener('click', () => {
      // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
      back.blur();
      this.onBack();
    });

    this.nameField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.finishRename(true);
      else if (event.key === 'Escape') this.finishRename(false);
    });
    this.nameField.addEventListener('blur', () => this.finishRename(true));
    element('truhe-name-ok').addEventListener('click', () => this.finishRename(true));

    for (const [button, yes] of [[this.askNo, false], [this.askYes, true]] as const) {
      button.addEventListener('click', () => {
        button.blur();
        this.onAsk(yes);
      });
    }

    // Ziehen: Das Drücken merkt sich den Platz, Bewegen und Loslassen verfolgt das Fenster, denn der Zeiger verlässt den Knopf.
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', () => this.endDrag());
  }

  /** Zeigt das Lager oder baut es nach einer Änderung neu auf. */
  show(model: LagerModel): void {
    this.gold.textContent = `Gold: ${model.gold}`;
    this.tabs.replaceChildren(
      ...model.classes.map((entry, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = index === model.active ? 'tab selected' : 'tab';
        tab.append(span('name', entry.name), span('note', entry.note));
        tab.addEventListener('click', () => {
          tab.blur();
          this.onClass(index);
        });
        return tab;
      }),
    );
    this.modes.replaceChildren(
      ...(Object.keys(MODE_LABELS) as LagerMode[]).map((mode) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = mode === model.mode ? 'mode selected' : 'mode';
        button.textContent = MODE_LABELS[mode];
        button.addEventListener('click', () => {
          button.blur();
          this.onMode(mode);
        });
        return button;
      }),
    );
    this.cells = {
      ausruestung: model.equipment.map((slot, index) => this.cell('ausruestung', index, slot)),
      inventar: model.inventory.map((slot, index) => this.cell('inventar', index, slot)),
      truhe: model.truhe.slots.map((slot, index) => this.cell('truhe', index, slot)),
      reiter: [
        ...model.truhe.tabs.map((tab, index) => this.reiterTab(index, tab, index === model.truhe.active)),
        ...model.truhe.commands.map((command, index) => this.reiterCommand(model.truhe.tabs.length + index, command)),
      ],
    };
    this.equipment.replaceChildren(...this.cells.ausruestung);
    this.inventory.replaceChildren(...this.cells.inventar);
    this.truheSlots.replaceChildren(...this.cells.truhe);
    this.reiter.replaceChildren(...this.cells.reiter);
    this.equipment.hidden = model.mode !== 'ausruestung';
    this.truhe.hidden = model.mode !== 'truhe';
    if (model.held) this.cells[model.held.zone][model.held.index]?.classList.add('held');
    this.summary.replaceChildren(
      span('title', 'Ausrüstung gesamt'),
      ...(model.summary.length > 0
        ? model.summary.map((line) => span(line.capped ? 'line capped' : 'line', line.capped ? `${line.text} (Höchstwert)` : line.text))
        : [span('line empty', 'Nichts angelegt.')]),
    );
    this.hand.textContent = model.hand;
    this.hand.hidden = model.hand === '';
    this.note.textContent = model.note;
    this.keys.textContent = model.keys;
    this.root.hidden = false;
  }

  /** Markiert einen Platz und hält ihn im Bild. */
  setCursor(zone: LagerZone, index: number): void {
    for (const [name, cells] of Object.entries(this.cells) as [LagerZone, HTMLButtonElement[]][]) {
      for (const [cellIndex, cell] of cells.entries()) {
        const selected = name === zone && cellIndex === index;
        cell.classList.toggle('selected', selected);
        if (selected) cell.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  showDetail(view: DetailView): void {
    if (!view.item) {
      this.detail.replaceChildren(span('empty', view.emptyText));
      return;
    }
    const { item } = view;
    const card = document.createElement('div');
    card.className = `item-card rarity-${item.rarity}`;
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('div');
    title.append(span('name', item.name), span('sub', item.subtitle));
    head.append(iconElement(item.icon), title);
    const props = document.createElement('ul');
    props.className = 'props';
    for (const prop of item.props) {
      const row = document.createElement('li');
      const bar = document.createElement('i');
      bar.className = 'bar';
      const fill = document.createElement('b');
      fill.style.width = `${Math.round(prop.quality * 100)}%`;
      bar.append(fill);
      row.append(span('text', prop.text), span('range', prop.range), bar);
      props.append(row);
    }
    card.append(head, props);
    if (item.bound) card.append(span('bound', item.bound));
    if (view.compare) {
      const compare = document.createElement('div');
      compare.className = 'compare';
      compare.append(span('title', view.compareTitle));
      if (view.compare.length === 0) compare.append(span('line', 'Keine Änderung.'));
      for (const line of view.compare) compare.append(span(line.better ? 'line better' : 'line worse', line.text));
      card.append(compare);
    }
    this.detail.replaceChildren(card);
  }

  /** Setzt die Rückmeldung unter den Plätzen, ohne das Lager neu aufzubauen. */
  setNote(text: string): void {
    this.note.textContent = text;
  }

  /** Lässt die Geldbörse kurz aufleuchten; für Handlungen, die nicht gehen. */
  deny(): void {
    this.gold.classList.remove('deny');
    void this.gold.offsetWidth;
    this.gold.classList.add('deny');
  }

  /** Öffnet das Feld, in dem der Name des Reiters geändert wird. */
  showRename(name: string, maxLength: number): void {
    this.rename.hidden = false;
    this.nameField.maxLength = maxLength;
    this.nameField.value = name;
    this.nameField.focus();
    this.nameField.select();
  }

  hideRename(): void {
    if (this.rename.hidden) return;
    this.rename.hidden = true;
    // Der Fokus muss zurück zum Spiel, sonst bliebe die Eingabe bei den Tasten hängen.
    this.nameField.blur();
  }

  /** Eine Rückfrage vor dem Löschen eines vollen Reiters; die Antwort kommt über `onAsk`. */
  showAsk(text: string, no: string, yes: string): void {
    this.askText.textContent = text;
    this.askNo.textContent = no;
    this.askYes.textContent = yes;
    this.ask.hidden = false;
    this.setAskChoice(false);
  }

  /** Welche Antwort vorgewählt ist; `false` ist die sichere. */
  setAskChoice(yes: boolean): void {
    this.askNo.classList.toggle('selected', !yes);
    this.askYes.classList.toggle('selected', yes);
  }

  hideAsk(): void {
    this.ask.hidden = true;
  }

  hide(): void {
    this.endDrag();
    this.hideRename();
    this.hideAsk();
    this.root.hidden = true;
  }

  private finishRename(commit: boolean): void {
    if (this.rename.hidden) return;
    const text = this.nameField.value;
    this.hideRename();
    this.onRename(commit ? text : null);
  }

  private cell(zone: LagerZone, index: number, slot: SlotView): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = slot.item ? `slot rarity-${slot.item.rarity}` : 'slot empty';
    button.title = slot.item ? slot.item.name : slot.label;
    const icon = slot.item?.icon ?? slot.icon;
    if (icon) button.append(iconElement(icon));
    if (zone === 'ausruestung') button.append(span('label', slot.label));
    this.wire(button, { zone, index }, slot.item);
    return button;
  }

  private reiterTab(index: number, tab: ReiterView, active: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = active ? 'rtab current' : 'rtab';
    button.style.setProperty('--tab', tab.color);
    button.title = `${tab.name}: ${tab.count} von ${tab.size} Plätzen belegt`;
    const dot = document.createElement('i');
    dot.className = 'dot';
    button.append(dot, span('name', tab.name), span('count', String(tab.count)));
    this.wire(button, { zone: 'reiter', index }, null);
    return button;
  }

  private reiterCommand(index: number, command: { label: string; title: string }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rcmd';
    button.textContent = command.label;
    button.title = command.title;
    this.wire(button, { zone: 'reiter', index }, null);
    return button;
  }

  /** Klick, Zeigen und (bei einem Gegenstand) der Beginn des Ziehens für einen Platz. */
  private wire(button: HTMLButtonElement, mark: Mark, item: ItemView | null): void {
    button.dataset.zone = mark.zone;
    button.dataset.index = String(mark.index);
    button.addEventListener('click', () => {
      button.blur();
      if (this.suppressClick) return;
      this.onActivate(mark.zone, mark.index);
    });
    // Nicht `pointerenter`: Baut das Lager sich unter dem ruhenden Zeiger neu auf, meldet der Browser sonst ein „Hinzeigen“,
    // und der Zeiger der Tastatur spränge dorthin zurück. `pointermove` kommt nur, wenn die Maus sich wirklich bewegt.
    button.addEventListener('pointermove', () => this.onHover(mark.zone, mark.index));
    if (item) {
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        this.pressed = { from: mark, item, x: event.clientX, y: event.clientY };
      });
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const { pressed } = this;
    if (!pressed) return;
    if (!this.dragging) {
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_DISTANCE) return;
      this.dragging = true;
      this.ghost = this.makeGhost(pressed.item);
      this.root.append(this.ghost);
    }
    if (this.ghost) this.ghost.style.transform = `translate(${event.clientX - 30}px, ${event.clientY - 30}px)`;
  }

  private onPointerUp(event: PointerEvent): void {
    const { pressed } = this;
    const wasDragging = this.dragging;
    this.endDrag();
    if (!pressed || !wasDragging) return;
    // Das Loslassen löst gleich noch einen Klick aus, der nicht gelten soll.
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-zone]');
    const zone = target?.dataset.zone as LagerZone | undefined;
    const index = Number(target?.dataset.index);
    this.onDrag(pressed.from, zone && Number.isInteger(index) ? { zone, index } : null);
  }

  private endDrag(): void {
    this.pressed = null;
    this.dragging = false;
    this.ghost?.remove();
    this.ghost = null;
  }

  private makeGhost(item: ItemView): HTMLElement {
    const ghost = document.createElement('div');
    ghost.className = `ghost rarity-${item.rarity}`;
    ghost.append(iconElement(item.icon));
    return ghost;
  }
}
