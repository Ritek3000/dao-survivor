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

export interface LagerModel {
  gold: number;
  classes: readonly { name: string; note: string }[];
  active: number;
  equipment: readonly SlotView[];
  inventory: readonly SlotView[];
  /** Die Summe der Eigenschaften der angelegten Gegenstände; `capped`: der Höchstwert ist erreicht. */
  summary: readonly { text: string; capped: boolean }[];
}

export interface DetailView {
  /** Was angezeigt wird: ein Gegenstand oder, bei einem leeren Platz, nur dessen Name. */
  item: ItemView | null;
  emptyText: string;
  /** Unterschied zum angelegten Gegenstand desselben Platzes; `null`, wenn es nichts zu vergleichen gibt. */
  compare: readonly { text: string; better: boolean }[] | null;
  compareTitle: string;
}

/** Wo der Zeiger steht: auf den angelegten Gegenständen oder im Inventar. */
export type LagerZone = 'ausruestung' | 'inventar';

export const EQUIPMENT_COLUMNS = 3;
export const INVENTORY_COLUMNS = 5;

/** Die Oberfläche der Ausrüstung: zwei Raster, die Karte des markierten Gegenstands und die Übersicht. Hält keinen Spielzustand. */
export class LagerView {
  onClass: (index: number) => void = () => {};
  /** Ein Platz wurde angeklickt. */
  onActivate: (zone: LagerZone, index: number) => void = () => {};
  /** Der Zeiger liegt über einem Platz. */
  onHover: (zone: LagerZone, index: number) => void = () => {};
  onBack: () => void = () => {};
  private readonly root = element('lager');
  private readonly gold = element('lager-gold');
  private readonly tabs = element('lager-tabs');
  private readonly equipment = element('lager-equipment');
  private readonly inventory = element('lager-inventory');
  private readonly detail = element('lager-detail');
  private readonly summary = element('lager-summary');
  private cells: Record<LagerZone, HTMLButtonElement[]> = { ausruestung: [], inventar: [] };

  constructor() {
    const back = element('lager-back');
    back.addEventListener('click', () => {
      // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
      back.blur();
      this.onBack();
    });
  }

  /** Zeigt die Ausrüstung oder baut sie nach einer Änderung neu auf. */
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
    this.cells = {
      ausruestung: model.equipment.map((slot, index) => this.cell('ausruestung', index, slot)),
      inventar: model.inventory.map((slot, index) => this.cell('inventar', index, slot)),
    };
    this.equipment.replaceChildren(...this.cells.ausruestung);
    this.inventory.replaceChildren(...this.cells.inventar);
    this.summary.replaceChildren(
      span('title', 'Ausrüstung gesamt'),
      ...(model.summary.length > 0
        ? model.summary.map((line) => span(line.capped ? 'line capped' : 'line', line.capped ? `${line.text} (Höchstwert)` : line.text))
        : [span('line empty', 'Nichts angelegt.')]),
    );
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

  /** Lässt die Geldbörse kurz aufleuchten; für Handlungen, die nicht gehen. */
  deny(): void {
    this.gold.classList.remove('deny');
    void this.gold.offsetWidth;
    this.gold.classList.add('deny');
  }

  hide(): void {
    this.root.hidden = true;
  }

  private cell(zone: LagerZone, index: number, slot: SlotView): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = slot.item ? `slot rarity-${slot.item.rarity}` : 'slot empty';
    button.title = slot.item ? slot.item.name : slot.label;
    const icon = slot.item?.icon ?? slot.icon;
    if (icon) button.append(iconElement(icon));
    if (zone === 'ausruestung') button.append(span('label', slot.label));
    button.addEventListener('click', () => {
      button.blur();
      this.onActivate(zone, index);
    });
    button.addEventListener('pointerenter', () => this.onHover(zone, index));
    return button;
  }
}
