/**
 * Das Menü der Ausrüstung zwischen den Nächten: pro Klasse die neun angelegten Gegenstände und das Inventar.
 *
 * Dieser Teil hält die Bedienung (Zeiger, Handlungen, Tasten) und bereitet die Gegenstände für die Oberfläche auf
 * (`ui/lagerView.ts`); gespeichert wird in `Ausruestung`. Bedienbar mit Maus und mit der Tastatur gleichwertig:
 * Pfeile bewegen den Zeiger, Enter legt an oder ab. So passt später ein Gamepad ohne Umbau.
 */

import { audio } from '../audio';
import { CONFIG } from '../config';
import type { Input } from '../core/input';
import {
  EQUIPMENT_COLUMNS,
  INVENTORY_COLUMNS,
  LagerView,
  type DetailView,
  type ItemView,
  type LagerModel,
  type LagerZone,
  type SlotView,
} from '../ui/lagerView';
import { itemIconId } from '../ui/itemIcons';
import type { Ausruestung } from './ausruestung';
import { CLASSES, type ClassDef } from './classes';
import {
  compareItems,
  describeProperty,
  formatRange,
  formatValue,
  ITEM_SLOTS,
  itemName,
  propertyName,
  propertyQuality,
  RARITY_LABELS,
  slotLabel,
  type Item,
} from './items';

function itemView(item: Item): ItemView {
  const owner = item.classId ? CLASSES.find((entry) => entry.id === item.classId) : undefined;
  return {
    name: itemName(item),
    rarity: item.rarity,
    subtitle: `${RARITY_LABELS[item.rarity]} · ${slotLabel(item.slot, item.classId)}`,
    icon: itemIconId(item.slot, item.classId),
    props: item.props.map((property) => ({
      text: describeProperty(property),
      range: formatRange(property.id, item.slot),
      quality: propertyQuality(item.slot, property),
    })),
    bound: owner ? `Gehört zur Klasse ${owner.name}` : null,
  };
}

export class Lager {
  /** Die Klasse, deren Ausrüstung gezeigt wird (Stelle in `CLASSES`). */
  classIndex = 0;
  /** Wird aufgerufen, wenn das Menü geschlossen werden soll (Esc, L oder der Knopf). */
  onClose: () => void = () => {};
  private zone: LagerZone = 'inventar';
  private cursor = 0;

  constructor(
    private readonly view: LagerView,
    private readonly ausruestung: Ausruestung,
    /** Gold in der Geldbörse, nur zur Anzeige. */
    private readonly gold: () => number,
  ) {
    view.onClass = (index) => this.selectClass(index);
    view.onActivate = (zone, index) => {
      this.moveTo(zone, index);
      this.activate();
    };
    view.onHover = (zone, index) => this.moveTo(zone, index);
    view.onBack = () => this.onClose();
  }

  private get playerClass(): ClassDef {
    return CLASSES[this.classIndex] ?? (CLASSES[0] as ClassDef);
  }

  open(classIndex: number): void {
    this.classIndex = CLASSES[classIndex] ? classIndex : 0;
    this.zone = 'inventar';
    // Der Zeiger beginnt beim ersten Gegenstand im Inventar, sonst oben links.
    const first = this.ausruestung.inventory(this.playerClass.id).findIndex((item) => item !== null);
    this.cursor = Math.max(0, first);
    this.render();
  }

  close(): void {
    this.view.hide();
  }

  /** Bedienung: Pfeile bewegen den Zeiger, Enter legt an oder ab, 1 bis 3 wechseln die Klasse. */
  update(input: Input): void {
    if (input.wasPressed('up')) this.step(0, -1);
    else if (input.wasPressed('down')) this.step(0, 1);
    else if (input.wasPressed('left')) this.step(-1, 0);
    else if (input.wasPressed('right')) this.step(1, 0);
    if (input.wasPressed('choice1')) this.selectClass(0);
    else if (input.wasPressed('choice2')) this.selectClass(1);
    else if (input.wasPressed('choice3')) this.selectClass(2);
    if (input.wasPressed('confirm')) this.activate();
    else if (input.wasPressed('pause') || input.wasPressed('lager')) this.onClose();
  }

  private selectClass(index: number): void {
    if (index === this.classIndex || !CLASSES[index]) return;
    this.classIndex = index;
    audio.play('auswahl');
    this.render();
  }

  private step(dx: number, dy: number): void {
    const inEquipment = this.zone === 'ausruestung';
    const columns = inEquipment ? EQUIPMENT_COLUMNS : INVENTORY_COLUMNS;
    const count = inEquipment ? ITEM_SLOTS.length : CONFIG.items.inventorySize;
    const rows = Math.ceil(count / columns);
    let column = this.cursor % columns;
    let row = Math.floor(this.cursor / columns);
    if (dy !== 0) {
      row = (row + dy + rows) % rows;
    } else if (dx < 0 && column > 0) {
      column--;
    } else if (dx > 0 && column < columns - 1) {
      column++;
    } else if (dx < 0 && !inEquipment) {
      // Über den Rand des Inventars nach links in die Ausrüstung, auf die Zeile, die dem Zeiger am nächsten liegt.
      this.moveTo('ausruestung', Math.floor((row * 3) / 5) * EQUIPMENT_COLUMNS + EQUIPMENT_COLUMNS - 1);
      return;
    } else if (dx > 0 && inEquipment) {
      this.moveTo('inventar', Math.min(rows * 2 - 2, row * 2) * INVENTORY_COLUMNS);
      return;
    }
    this.moveTo(this.zone, row * columns + column);
  }

  private moveTo(zone: LagerZone, index: number): void {
    if (zone === this.zone && index === this.cursor) return;
    this.zone = zone;
    this.cursor = index;
    audio.play('auswahl');
    this.view.setCursor(zone, index);
    this.view.showDetail(this.detail());
  }

  /** Legt den Gegenstand unter dem Zeiger an (im Inventar) oder ab (bei den angelegten). */
  private activate(): void {
    const { id } = this.playerClass;
    let done = false;
    if (this.zone === 'inventar') {
      if (!this.ausruestung.inventory(id)[this.cursor]) return;
      done = this.ausruestung.equip(id, this.cursor);
    } else {
      const slot = ITEM_SLOTS[this.cursor];
      if (!slot || !this.ausruestung.equipped(id, slot)) return;
      done = this.ausruestung.unequip(id, slot);
    }
    if (done) audio.play('bestaetigen');
    else this.view.deny();
    this.render();
  }

  private detail(): DetailView {
    const { id } = this.playerClass;
    if (this.zone === 'ausruestung') {
      const slot = ITEM_SLOTS[this.cursor];
      const item = slot ? this.ausruestung.equipped(id, slot) : null;
      return {
        item: item ? itemView(item) : null,
        emptyText: slot ? `${slotLabel(slot, id)}: nichts angelegt.` : '',
        compare: null,
        compareTitle: '',
      };
    }
    const item = this.ausruestung.inventory(id)[this.cursor] ?? null;
    if (!item) return { item: null, emptyText: 'Leerer Platz.', compare: null, compareTitle: '' };
    const worn = this.ausruestung.equipped(id, item.slot);
    return {
      item: itemView(item),
      emptyText: '',
      compare: compareItems(item, worn).map(({ id: property, delta }) => ({
        text: `${propertyName(property)} ${formatValue(property, delta)}`,
        better: delta > 0,
      })),
      compareTitle: worn ? `Gegenüber ${itemName(worn)}` : 'Gegenüber leerem Platz',
    };
  }

  /** Zeichnet das Menü neu, etwa nach dem Anlegen oder dem Wechsel der Klasse. */
  private render(): void {
    const { id } = this.playerClass;
    const equipment: SlotView[] = ITEM_SLOTS.map((slot) => {
      const item = this.ausruestung.equipped(id, slot);
      return {
        label: slotLabel(slot, id),
        icon: itemIconId(slot, id),
        item: item ? itemView(item) : null,
      };
    });
    const inventory: SlotView[] = this.ausruestung.inventory(id).map((item) => ({
      label: '',
      icon: null,
      item: item ? itemView(item) : null,
    }));
    const summary = [...this.ausruestung.totals(id)].map(([property, total]) => ({
      text: `${propertyName(property)} ${formatValue(property, total)}`,
      capped: total >= CONFIG.items.properties[property].cap,
    }));
    const model: LagerModel = {
      gold: this.gold(),
      classes: CLASSES.map((entry) => {
        const count = this.ausruestung.count(entry.id);
        return { name: entry.name, note: `${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'}` };
      }),
      active: this.classIndex,
      equipment,
      inventory,
      summary,
    };
    this.view.show(model);
    // Nach dem Neuzeichnen steht kein Platz mehr markiert; den Zeiger setzen und die Karte neu füllen.
    this.view.setCursor(this.zone, this.cursor);
    this.view.showDetail(this.detail());
  }
}
