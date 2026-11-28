import type { Rarity, SortOrder } from '../game/items';
import './lager.css';
import { element, span } from './dom';
import { glyphElement, type GlyphId } from './glyphs';
import { iconElement, itemImageElement, type ItemIconId, type ItemImage } from './itemIcons';

/** Eine Eigenschaft auf der Karte: Name und Wert getrennt, damit der Wert in eigener Spalte stehen kann. */
export interface PropertyView {
  name: string;
  /** Der gewürfelte Wert mit Vorzeichen und Einheit, etwa „+5 %“. */
  value: string;
  /** Der Bereich, aus dem der Wert kommt, etwa „3–9 %“. */
  range: string;
  /** Wo der Wurf im Bereich liegt, 0 (schwächster) bis 1 (stärkster). */
  quality: number;
}

/** Ein Gegenstand, wie ihn die Oberfläche zeigt; den Text und die Zahlen bereitet `game/lager.ts` auf. */
export interface ItemView {
  name: string;
  rarity: Rarity;
  /** „Rar“, „Legendär“ …: das Schild auf der Karte. */
  rarityLabel: string;
  /** Der Platz des Gegenstands, etwa „Ring“ oder „Axt“. */
  slotLabel: string;
  /** Das Umrisszeichen des Gegenstands; es tritt an die Stelle des Bildes, falls das nicht geladen werden kann. */
  icon: ItemIconId;
  /** Das Bild des Gegenstands: sein Platz im Stil einer Klasse. */
  image: ItemImage;
  props: readonly PropertyView[];
  /** Hinweis zur Bindung an eine Klasse („Gehört zur Klasse Magier“), sonst `null`. */
  bound: string | null;
  /** Die Evolution eines legendären Rings: ihr Name, was sie freischaltet und was sie bewirkt; sonst `null`. */
  evolution: { title: string; requirement: string; text: string } | null;
  /** Der Spieler hat den Gegenstand zum Verkauf markiert. */
  forSale: boolean;
}

/** Ein Preis in Gold, wie ihn der Händler an einen Gegenstand schreibt; `poor`: Das Gold in der Börse reicht dafür nicht. */
export interface PriceView {
  /** Was der Preis meint: „Preis“, „Rückkauf“ oder „Verkauf“ (auf dem Platz selbst nicht zu sehen). */
  label: string;
  amount: number;
  poor: boolean;
}

export interface SlotView {
  /** Name des Platzes, bei Plätzen der Ausrüstung unter dem Zeichen. */
  label: string;
  /** Das Zeichen eines leeren Platzes der Ausrüstung; leere Plätze im Inventar haben keins. */
  icon: ItemIconId | null;
  item: ItemView | null;
  /** Nur beim Händler: Was der Gegenstand dort kostet. */
  price?: PriceView | null;
}

/** Ein Befehl in der Truhe (Zeichen im Kopf des Feldes) oder beim Händler (Knopf zwischen Angebot und Rückkauf). */
export interface CommandView {
  label: string;
  /** Zusatz am Knopf, etwa „gratis“ oder „500 Gold“. */
  note?: string;
  /** Erklärung beim Verweilen des Zeigers. */
  title: string;
  icon: GlyphId;
  /** Das Gold reicht dafür nicht. */
  poor?: boolean;
  /** Beim Händler: nur das Zeichen, ohne Beschriftung (ein schmaler Knopf; `label` bleibt für die Vorlesehilfe). */
  iconOnly?: boolean;
  /** Im Kopf des Feldes: mit Beschriftung statt nur dem Zeichen (so wie die Knöpfe des Händlers). */
  wide?: boolean;
  /** Es gibt nichts zu tun (etwa: nichts markiert); der Knopf wirkt gedämpft, lässt sich aber drücken und sagt dann, warum nicht. */
  idle?: boolean;
}

/** Ein Knopf zum Sortieren im Kopf des Inventars oder der Truhe; Tastatur und Gamepad sortieren über die Aktion `sort`. */
export interface SortView {
  order: SortOrder;
  /** Erklärung beim Verweilen des Zeigers, etwa „Inventar nach Art sortieren“. */
  title: string;
  icon: GlyphId;
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
  /** Die Überschrift des Feldes: „Truhe“, beim Händler „Dein Besitz“. */
  title: string;
  tabs: readonly ReiterView[];
  /** Der geöffnete Reiter. */
  active: number;
  slots: readonly SlotView[];
  /** Die Befehle hinter den Reitern: in der Truhe neuer Reiter, umbenennen, Farbe, löschen; beim Händler der Verkauf der markierten Gegenstände. */
  commands: readonly CommandView[];
  /** Die Knöpfe zum Sortieren dessen, was das Feld zeigt (der Reiter, beim Händler auch das Inventar). */
  sort: readonly SortView[];
}

/** Der Händler: sein Angebot, der Rückkauf und die Befehle dazwischen (Angebot erneuern, Auto-Verkauf und dessen Stufe). */
export interface HaendlerModel {
  stock: readonly SlotView[];
  buyback: readonly SlotView[];
  commands: readonly CommandView[];
}

/**
 * Wo der Zeiger steht: auf den angelegten Gegenständen, im Inventar, in der Truhe oder in der Leiste ihrer Reiter und Befehle,
 * beim Händler im Angebot, in den Befehlen oder im Rückkauf. Beim Händler zeigt `truhe` den eigenen Besitz (Inventar oder Reiter).
 */
export type LagerZone = 'ausruestung' | 'inventar' | 'truhe' | 'reiter' | 'angebot' | 'befehle' | 'rueckkauf';

/** Die drei Ansichten des Lagers: Ausrüstung mit Inventar, Inventar mit Truhe, und der Händler mit dem eigenen Besitz. */
export type LagerMode = 'ausruestung' | 'truhe' | 'haendler';

/** Ein Platz auf dem Bildschirm. In der Zone `reiter` zählen erst die Reiter, dann die Befehle. */
export interface Mark {
  zone: LagerZone;
  index: number;
}

/** Ein Hinweis auf die Tasten unten: die Tasten als Kappen, dahinter, was sie tun. */
export interface KeyHint {
  keys: readonly string[];
  text: string;
}

/** Was die Figur in der Hand hält: der Gegenstand und was man damit tun kann. */
export interface HandView {
  item: ItemView;
  hint: string;
}

export interface LagerModel {
  gold: number;
  classes: readonly { name: string; note: string }[];
  active: number;
  mode: LagerMode;
  equipment: readonly SlotView[];
  inventory: readonly SlotView[];
  /** Die Knöpfe zum Sortieren des Inventars. */
  inventorySort: readonly SortView[];
  /** Die Summe der Eigenschaften der angelegten Gegenstände; `capped`: der Höchstwert ist erreicht. */
  summary: readonly { name: string; value: string; capped: boolean }[];
  truhe: TruheModel;
  haendler: HaendlerModel;
  /** Der Platz des Gegenstands, den die Figur in der Hand hält, wenn er gerade zu sehen ist. */
  held: Mark | null;
  /** Der Gegenstand in der Hand, solange einer aufgenommen ist. */
  hand: HandView | null;
  /** Rückmeldung zur letzten Handlung, etwa warum etwas nicht ging (`noteBad`: dann rot, sonst golden). */
  note: string;
  noteBad: boolean;
  keys: readonly KeyHint[];
}

export interface DetailView {
  /** Was angezeigt wird: ein Gegenstand oder, bei einem leeren Platz, nur dessen Name. */
  item: ItemView | null;
  emptyText: string;
  /** Unterschied zum angelegten Gegenstand desselben Platzes; `null`, wenn es nichts zu vergleichen gibt. */
  compare: readonly { name: string; value: string; better: boolean }[] | null;
  compareTitle: string;
  /** Beim Händler: Was der Gegenstand kostet oder einbringt. */
  price?: PriceView | null;
  /** Bei einem eigenen Gegenstand im Inventar oder in der Truhe: wie man ihn zum Verkauf markiert oder die Markierung zurücknimmt. */
  markHint?: string;
}

export const EQUIPMENT_COLUMNS = 3;
export const INVENTORY_COLUMNS = 5;
export const TRUHE_COLUMNS = 5;
export const HAENDLER_COLUMNS = 5;

/** So weit (in Pixeln) muss der Zeiger bei gedrückter Taste wandern, bis aus einem Klick ein Ziehen wird. */
const DRAG_DISTANCE = 8;

const MODE_LABELS: Readonly<Record<LagerMode, string>> = { ausruestung: 'Ausrüstung', truhe: 'Truhe', haendler: 'Händler' };

/** Wie viele Rauten eine Seltenheit auf dem Platz trägt: ein zweites Merkmal neben der Farbe, für alle, die Farben schlecht unterscheiden. */
const PIPS: Readonly<Record<Rarity, number>> = { normal: 0, selten: 1, rar: 2, legendaer: 3 };

/** Ein Element der Leiste, das ein Platz ist (Reiter, Befehl, Knopf des Händlers). */
type ButtonCell = HTMLButtonElement;

/**
 * Die Oberfläche des Lagers: die Ansichten Ausrüstung, Truhe und Händler, die Karte des markierten Gegenstands und die Übersicht.
 * Hält keinen Spielzustand; Klicks, Ziehen und Eingaben gehen als Rückrufe an `game/lager.ts`.
 *
 * Nichts darf wandern, wenn der Zeiger sich bewegt: Der markierte Platz zeigt sich nur über einen Ring aus einem Pseudoelement
 * (`.selected::after`), der keinen Platz braucht, und die Karte sitzt in einer Spalte, die Raster und Summe nicht verschiebt (siehe `lager.css`).
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
  /** Antwort auf die Rückfrage: die Stelle der gewählten Antwort; die erste (0) ist die sichere. */
  onAsk: (index: number) => void = () => {};
  /** Ein Knopf zum Sortieren wurde gedrückt: für das Inventar oder für das, was die Truhe gerade zeigt. */
  onSort: (panel: 'inventar' | 'truhe', order: SortOrder) => void = () => {};
  /** Ein Gegenstand wurde mit der rechten Maustaste angeklickt: Markierung zum Verkauf umschalten (Tastatur und Gamepad über die Aktion `mark`). */
  onMark: (zone: LagerZone, index: number) => void = () => {};
  onBack: () => void = () => {};
  private readonly root = element('lager');
  private readonly goldChip = element('lager-gold');
  private readonly goldValue = element('lager-gold-value');
  private readonly tabs = element('lager-tabs');
  private readonly modes = element('lager-modes');
  private readonly equipmentPanel = element('lager-equipment');
  private readonly equipment = element('equipment-slots');
  private readonly equipmentMeter = element('equipment-meter');
  private readonly inventoryPanel = element('lager-inventory');
  private readonly inventory = element('inventory-slots');
  private readonly inventoryMeter = element('inventory-meter');
  private readonly inventorySort = element('inventory-sort');
  private readonly truhe = element('lager-truhe');
  private readonly truheTitle = element('truhe-title');
  private readonly haendler = element('lager-haendler');
  private readonly stock = element('haendler-stock');
  private readonly buyback = element('haendler-buyback');
  private readonly haendlerCommands = element('haendler-commands');
  private readonly reiter = element('truhe-tabs');
  private readonly truheCommands = element('truhe-commands');
  private readonly truheSlots = element('truhe-slots');
  private readonly truheSort = element('truhe-sort');
  private readonly rename = element('truhe-rename');
  private readonly nameField = element<HTMLInputElement>('truhe-name');
  private readonly ask = element('truhe-ask');
  private readonly askText = element('truhe-ask-text');
  private readonly askChoices = element('truhe-ask-choices');
  private readonly detail = element('lager-detail');
  private readonly summary = element('lager-summary');
  private readonly hand = element('lager-hand');
  private readonly note = element('lager-note');
  private readonly keys = element('lager-keys');
  private cells: Record<LagerZone, HTMLButtonElement[]> = {
    ausruestung: [],
    inventar: [],
    truhe: [],
    reiter: [],
    angebot: [],
    befehle: [],
    rueckkauf: [],
  };
  private pressed: { from: Mark; item: ItemView; x: number; y: number } | null = null;
  private dragging = false;
  private ghost: HTMLElement | null = null;
  /** Das Feld, über dem ein gezogener Gegenstand gerade schwebt; es zeigt, dass er dort abgelegt würde. */
  private dropTarget: HTMLElement | null = null;
  /** Nach dem Ziehen löst das Loslassen noch einen Klick aus; der soll nicht noch einmal ablegen. */
  private suppressClick = false;

  constructor() {
    const back = element('lager-back');
    back.addEventListener('click', () => {
      // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
      back.blur();
      this.onBack();
    });
    element('lager-gold-coin').replaceChildren(glyphElement('coin'));

    this.nameField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.finishRename(true);
      else if (event.key === 'Escape') this.finishRename(false);
    });
    this.nameField.addEventListener('blur', () => this.finishRename(true));
    element('truhe-name-ok').addEventListener('click', () => this.finishRename(true));

    // Viele Reiter laufen über die Leiste hinaus: Das Rad schiebt sie seitwärts (ein Rad kennt sonst nur „auf“ und „ab“).
    this.reiter.addEventListener(
      'wheel',
      (event) => {
        if (this.reiter.scrollWidth <= this.reiter.clientWidth || event.deltaX !== 0) return;
        event.preventDefault();
        this.reiter.scrollLeft += event.deltaY;
      },
      { passive: false },
    );

    // Ziehen: Das Drücken merkt sich den Platz, Bewegen und Loslassen verfolgt das Fenster, denn der Zeiger verlässt den Knopf.
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', () => this.endDrag());
  }

  /** Zeigt das Lager oder baut es nach einer Änderung neu auf. */
  show(model: LagerModel): void {
    this.goldValue.textContent = String(model.gold);
    this.tabs.replaceChildren(
      ...model.classes.map((entry, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(index === model.active));
        tab.className = index === model.active ? 'tab selected' : 'tab';
        const key = document.createElement('kbd');
        key.textContent = String(index + 1);
        tab.append(key, span('name', entry.name), span('note', entry.note));
        tab.addEventListener('click', () => {
          tab.blur();
          this.onClass(index);
        });
        return tab;
      }),
    );
    const modeButtons = (Object.keys(MODE_LABELS) as LagerMode[]).map((mode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(mode === model.mode));
      button.className = mode === model.mode ? 'mode selected' : 'mode';
      button.textContent = MODE_LABELS[mode];
      button.addEventListener('click', () => {
        button.blur();
        this.onMode(mode);
      });
      return button;
    });
    const tabKey = document.createElement('kbd');
    tabKey.textContent = 'Tab';
    tabKey.title = 'Nächste Ansicht';
    this.modes.replaceChildren(...modeButtons, tabKey);
    const reiterTabs = model.truhe.tabs.map((tab, index) => this.reiterTab(index, tab, index === model.truhe.active));
    const reiterCommands = model.truhe.commands.map((command, index) => this.iconCommand(model.truhe.tabs.length + index, command));
    this.cells = {
      ausruestung: model.equipment.map((slot, index) => this.cell('ausruestung', index, slot)),
      inventar: model.inventory.map((slot, index) => this.cell('inventar', index, slot)),
      truhe: model.truhe.slots.map((slot, index) => this.cell('truhe', index, slot)),
      reiter: [...reiterTabs, ...reiterCommands],
      angebot: model.haendler.stock.map((slot, index) => this.cell('angebot', index, slot)),
      befehle: model.haendler.commands.map((command, index) => this.haendlerCommand(index, command)),
      rueckkauf: model.haendler.buyback.map((slot, index) => this.cell('rueckkauf', index, slot)),
    };
    this.equipment.replaceChildren(...this.cells.ausruestung);
    this.inventory.replaceChildren(...this.cells.inventar);
    this.truheSlots.replaceChildren(...this.cells.truhe);
    this.reiter.replaceChildren(...reiterTabs);
    this.truheCommands.replaceChildren(...reiterCommands);
    this.inventorySort.replaceChildren(...model.inventorySort.map((sort) => this.sortButton('inventar', sort)));
    this.truheSort.replaceChildren(...model.truhe.sort.map((sort) => this.sortButton('truhe', sort)));
    this.truheTitle.textContent = model.truhe.title;
    this.stock.replaceChildren(...this.cells.angebot);
    this.haendlerCommands.replaceChildren(...this.cells.befehle);
    this.buyback.replaceChildren(...this.cells.rueckkauf);
    this.fillMeter(this.equipmentMeter, 'Belegt', model.equipment);
    this.fillMeter(this.inventoryMeter, 'Belegt', model.inventory);
    // Ausrüstung und Inventar zeigen nur die Ansicht Ausrüstung; Inventar gibt es in der Truhe links, beim Händler in der Leiste.
    this.equipmentPanel.hidden = model.mode !== 'ausruestung';
    this.inventoryPanel.hidden = model.mode === 'haendler';
    this.truhe.hidden = model.mode === 'ausruestung';
    this.haendler.hidden = model.mode !== 'haendler';
    // Die Zeile der Reiter läuft über, wenn es viele sind; dann blendet sie an den Rändern aus.
    this.reiter.classList.toggle('overflowing', this.reiter.scrollWidth > this.reiter.clientWidth);
    if (model.held) this.cells[model.held.zone][model.held.index]?.classList.add('held');
    this.showSummary(model.summary);
    this.showHand(model.hand);
    this.setNote(model.note, model.noteBad);
    this.keys.replaceChildren(
      ...model.keys.map((hint) => {
        const node = document.createElement('span');
        node.className = 'hint';
        node.append(...hint.keys.map((key) => kbd(key)), span('text', hint.text));
        return node;
      }),
    );
    this.root.hidden = false;
  }

  /** Markiert einen Platz und hält ihn im Bild. */
  setCursor(zone: LagerZone, index: number): void {
    for (const [name, cells] of Object.entries(this.cells) as [LagerZone, HTMLButtonElement[]][]) {
      for (const [cellIndex, cell] of cells.entries()) {
        const selected = name === zone && cellIndex === index;
        cell.classList.toggle('selected', selected);
        if (selected) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }

  showDetail(view: DetailView): void {
    if (!view.item) {
      this.detail.replaceChildren(view.emptyText === '' ? '' : this.plainCard(view.emptyText));
      return;
    }
    const { item } = view;
    const card = document.createElement('div');
    card.className = `item-card rarity-${item.rarity}`;

    const head = document.createElement('div');
    head.className = 'head';
    const frame = document.createElement('span');
    frame.className = 'frame';
    frame.append(itemImageElement(item.image, item.icon));
    const title = document.createElement('div');
    title.className = 'title';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.append(span('badge', item.rarityLabel), span('kind', item.slotLabel));
    title.append(span('name', item.name), meta);
    head.append(frame, title);
    card.append(head);

    const props = document.createElement('ul');
    props.className = 'props';
    for (const prop of item.props) {
      const row = document.createElement('li');
      const bar = document.createElement('i');
      bar.className = 'bar';
      const fill = document.createElement('b');
      fill.style.width = `${Math.max(3, Math.round(prop.quality * 100))}%`;
      bar.append(fill);
      row.append(span('pname', prop.name), span('pvalue', prop.value), bar, span('range', prop.range));
      props.append(row);
    }
    card.append(props);

    if (item.evolution) {
      const evolution = document.createElement('div');
      evolution.className = 'evolution';
      evolution.append(span('title', item.evolution.title), span('requirement', item.evolution.requirement), span('text', item.evolution.text));
      card.append(evolution);
    }
    if (item.bound) {
      const bound = document.createElement('p');
      bound.className = 'bound';
      bound.append(glyphElement('lock'), span('text', item.bound));
      card.append(bound);
    }
    if (item.forSale) {
      const sale = document.createElement('p');
      sale.className = 'for-sale';
      sale.append(glyphElement('coin'), span('text', 'Zum Verkauf markiert'));
      card.append(sale);
    }
    if (view.compare) {
      const compare = document.createElement('div');
      compare.className = 'compare';
      compare.append(span('title', view.compareTitle));
      const lines = document.createElement('ul');
      if (view.compare.length === 0) {
        const none = document.createElement('li');
        none.className = 'same';
        none.append(span('cname', 'Keine Änderung.'));
        lines.append(none);
      }
      for (const line of view.compare) {
        const row = document.createElement('li');
        row.className = line.better ? 'better' : 'worse';
        row.append(span('arrow', line.better ? 'besser' : 'schlechter'), span('cname', line.name), span('cvalue', line.value));
        lines.append(row);
      }
      compare.append(lines);
      card.append(compare);
    }
    if (view.price) {
      const price = document.createElement('div');
      price.className = view.price.poor ? 'price poor' : 'price';
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.append(glyphElement('coin'), span('number', String(view.price.amount)), span('unit', 'Gold'));
      price.append(span('plabel', view.price.label), amount);
      if (view.price.poor) price.append(span('short', 'Dein Gold reicht nicht.'));
      card.append(price);
    }
    if (view.markHint) {
      const hint = document.createElement('p');
      hint.className = 'mark-hint';
      hint.textContent = view.markHint;
      card.append(hint);
    }
    this.detail.replaceChildren(card);
  }

  /** Setzt die Rückmeldung unter den Plätzen, ohne das Lager neu aufzubauen; `bad`: Die Handlung ging nicht. */
  setNote(text: string, bad = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
    this.note.hidden = text === '';
  }

  /** Lässt die Geldbörse kurz aufleuchten; für Handlungen, die nicht gehen. */
  deny(): void {
    this.goldChip.classList.remove('deny');
    void this.goldChip.offsetWidth;
    this.goldChip.classList.add('deny');
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

  /** Eine Rückfrage mit zwei oder mehr Antworten (die erste ist die sichere); die Antwort kommt über `onAsk`. */
  showAsk(text: string, answers: readonly string[]): void {
    this.askText.textContent = text;
    this.askChoices.replaceChildren(
      ...answers.map((answer, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action';
        button.textContent = answer;
        button.addEventListener('click', () => {
          button.blur();
          this.onAsk(index);
        });
        return button;
      }),
    );
    this.ask.hidden = false;
    this.setAskChoice(0);
  }

  /** Welche Antwort vorgewählt ist; 0 ist die sichere. */
  setAskChoice(index: number): void {
    for (const [position, button] of [...this.askChoices.children].entries()) button.classList.toggle('selected', position === index);
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

  /** Eine Karte ohne Gegenstand: ein leerer Platz oder die Erklärung eines Befehls. */
  private plainCard(text: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'item-card plain';
    card.append(span('text', text));
    return card;
  }

  /** Füllstand eines Feldes: Beschriftung, Balken und „belegt / Plätze“. */
  private fillMeter(target: HTMLElement, label: string, slots: readonly SlotView[]): void {
    const used = slots.filter((slot) => slot.item).length;
    const track = document.createElement('span');
    track.className = 'track';
    const fill = document.createElement('i');
    fill.style.width = `${slots.length > 0 ? Math.round((used / slots.length) * 100) : 0}%`;
    track.append(fill);
    target.classList.toggle('full', slots.length > 0 && used >= slots.length);
    target.replaceChildren(span('label', label), track, span('count', `${used} / ${slots.length}`));
  }

  /** Die Summe der angelegten Gegenstände als Streifen unter den Feldern. */
  private showSummary(lines: LagerModel['summary']): void {
    const list = document.createElement('ul');
    list.className = 'lines';
    if (lines.length === 0) list.append(this.summaryLine('Nichts angelegt.', '', false, true));
    for (const line of lines) list.append(this.summaryLine(line.name, line.value, line.capped, false));
    this.summary.replaceChildren(span('title', 'Ausrüstung gesamt'), list);
  }

  private summaryLine(name: string, value: string, capped: boolean, empty: boolean): HTMLLIElement {
    const row = document.createElement('li');
    row.className = empty ? 'line empty' : capped ? 'line capped' : 'line';
    row.append(span('lname', name));
    if (value !== '') row.append(span('lvalue', value));
    if (capped) row.append(span('cap', 'Höchstwert'));
    return row;
  }

  private showHand(hand: HandView | null): void {
    this.hand.hidden = hand === null;
    if (!hand) {
      this.hand.replaceChildren();
      return;
    }
    this.hand.className = `rarity-${hand.item.rarity}`;
    const picture = document.createElement('span');
    picture.className = 'thumb';
    picture.append(itemImageElement(hand.item.image, hand.item.icon));
    this.hand.replaceChildren(picture, span('label', 'In der Hand'), span('name', hand.item.name), span('hint', hand.hint));
  }

  private cell(zone: LagerZone, index: number, slot: SlotView): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    const { item } = slot;
    button.className = item ? `slot rarity-${item.rarity}` : 'slot empty';
    // Die Karte rechts sagt alles über den Gegenstand; ein Hinweis des Browsers darüber wäre doppelt (und träfe die Karte).
    button.setAttribute(
      'aria-label',
      item
        ? `${item.name}, ${item.rarityLabel}, ${item.slotLabel}${slot.price ? `, ${slot.price.amount} Gold` : ''}${item.forSale ? ', zum Verkauf markiert' : ''}`
        : slot.label !== ''
          ? `${slot.label}: leer`
          : 'Leerer Platz',
    );
    if (item) {
      const pips = PIPS[item.rarity];
      if (pips > 0) {
        const mark = document.createElement('span');
        mark.className = 'pips';
        for (let pip = 0; pip < pips; pip++) mark.append(document.createElement('i'));
        button.append(mark);
      }
      button.append(itemImageElement(item.image, item.icon));
      if (item.forSale) {
        // Eine Münze in der Ecke: Der Gegenstand ist zum Verkauf markiert (das Bild tritt dafür etwas zurück, siehe `.forsale`).
        button.classList.add('forsale');
        const badge = span('sale-badge', '');
        badge.append(glyphElement('coin'));
        button.append(badge);
      }
    } else if (slot.icon) {
      button.append(iconElement(slot.icon));
    }
    if (zone === 'ausruestung') button.append(span('label', slot.label));
    if (item && slot.price) {
      button.classList.add('priced');
      const price = document.createElement('span');
      price.className = slot.price.poor ? 'price poor' : 'price';
      price.append(glyphElement('coin'), span('number', String(slot.price.amount)));
      button.append(price);
    }
    this.wire(button, { zone, index }, item);
    return button;
  }

  private reiterTab(index: number, tab: ReiterView, active: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.className = active ? 'rtab current' : 'rtab';
    button.style.setProperty('--tab', tab.color);
    button.title = `${tab.name}: ${tab.count} von ${tab.size} Plätzen belegt`;
    const dot = document.createElement('i');
    dot.className = 'dot';
    button.append(dot, span('name', tab.name), span('count', String(tab.count)));
    this.wire(button, { zone: 'reiter', index }, null);
    return button;
  }

  /** Ein Knopf zum Sortieren: nur das Zeichen, der Name steht beim Verweilen. Er gehört nicht zu den Plätzen des Zeigers (dafür gibt es die Taste). */
  private sortButton(panel: 'inventar' | 'truhe', sort: SortView): ButtonCell {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.title = sort.title;
    button.setAttribute('aria-label', sort.title);
    button.append(glyphElement(sort.icon));
    button.addEventListener('click', () => {
      // Der Fokus bliebe sonst am Knopf hängen; Leertaste und Enter gehören aber dem Spiel.
      button.blur();
      this.onSort(panel, sort.order);
    });
    return button;
  }

  /**
   * Ein Befehl im Kopf des Feldes: meist nur das Zeichen (der Name steht beim Verweilen und auf der Karte rechts); mit `wide` ein
   * beschrifteter Knopf wie die des Händlers.
   */
  private iconCommand(index: number, command: CommandView): ButtonCell {
    const button = document.createElement('button');
    button.type = 'button';
    const text = command.note ? `${command.label} (${command.note})` : command.label;
    button.title = command.wide ? command.title : text;
    button.setAttribute('aria-label', text);
    if (command.wide) {
      button.className = command.poor ? 'action poor' : command.idle ? 'action idle' : 'action';
      button.append(glyphElement(command.icon), span('label', command.label));
      if (command.note) button.append(span('note', command.note));
    } else {
      button.className = command.poor ? 'icon-btn poor' : 'icon-btn';
      button.append(glyphElement(command.icon));
    }
    this.wire(button, { zone: 'reiter', index }, null);
    return button;
  }

  private haendlerCommand(index: number, command: CommandView): ButtonCell {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = command.poor ? 'action poor' : command.iconOnly ? 'action icon-only' : 'action';
    button.title = command.title;
    if (command.iconOnly) {
      button.setAttribute('aria-label', command.label);
      button.append(glyphElement(command.icon));
    } else {
      button.append(glyphElement(command.icon), span('label', command.label));
      if (command.note) button.append(span('note', command.note));
    }
    this.wire(button, { zone: 'befehle', index }, null);
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
      // Die rechte Maustaste markiert zum Verkauf (statt des Menüs des Browsers).
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        button.blur();
        this.onMark(mark.zone, mark.index);
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
      this.root.classList.add('dragging');
      this.cells[pressed.from.zone][pressed.from.index]?.classList.add('lifted');
    }
    if (this.ghost) this.ghost.style.transform = `translate(${event.clientX - 32}px, ${event.clientY - 32}px) rotate(-4deg)`;
    this.markDropTarget(document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-zone]') ?? null);
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
    this.markDropTarget(null);
    this.root.classList.remove('dragging');
    for (const lifted of this.root.querySelectorAll('.lifted')) lifted.classList.remove('lifted');
  }

  /** Zeigt, wohin der gezogene Gegenstand fiele: der Platz unter dem Zeiger, beim Händler dessen ganzes Feld (verkaufen). */
  private markDropTarget(target: HTMLElement | null): void {
    if (target === this.dropTarget) return;
    this.dropTarget?.classList.remove('drop');
    this.dropTarget = target;
    target?.classList.add('drop');
  }

  private makeGhost(item: ItemView): HTMLElement {
    const ghost = document.createElement('div');
    ghost.className = `ghost rarity-${item.rarity}`;
    ghost.append(itemImageElement(item.image, item.icon));
    return ghost;
  }
}

/** Eine Taste als Kappe. */
function kbd(text: string): HTMLElement {
  const node = document.createElement('kbd');
  node.textContent = text;
  return node;
}
