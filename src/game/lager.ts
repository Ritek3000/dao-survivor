/**
 * Das Lager zwischen den Nächten: pro Klasse die neun angelegten Gegenstände und das Inventar, dazu die Truhe für alle.
 *
 * Dieser Teil hält die Bedienung (Zeiger, Handlungen, Tasten) und bereitet die Gegenstände für die Oberfläche auf
 * (`ui/lagerView.ts`); gespeichert wird in `Ausruestung`. Zwei Ansichten: Ausrüstung (angelegt und Inventar) und Truhe
 * (Inventar und Truhe mit ihren Reitern).
 *
 * Ein Gegenstand wandert so: Enter oder Klick nimmt ihn auf, ein zweiter Druck legt ihn auf einen anderen Platz ab (liegt dort
 * schon einer, tauschen beide); Ziehen mit der Maus oder dem Finger tut dasselbe in einem Zug. Aufgenommen ist er nur gemerkt:
 * Erst das Ablegen ändert etwas, ein Abbruch (Esc) lässt alles, wie es war. Wer es eilig hat, drückt E: Das legt den
 * Gegenstand gleich an, oder räumt ihn zwischen Inventar und Truhe um. Jede Handlung geht mit Maus und mit der Tastatur
 * gleichwertig (Pfeile bewegen den Zeiger), damit später ein Gamepad ohne Umbau passt.
 */

import { audio } from '../audio';
import { CONFIG } from '../config';
import type { Input } from '../core/input';
import {
  EQUIPMENT_COLUMNS,
  INVENTORY_COLUMNS,
  LagerView,
  TRUHE_COLUMNS,
  type DetailView,
  type ItemView,
  type LagerMode,
  type LagerModel,
  type LagerZone,
  type Mark,
  type SlotView,
  type TruheModel,
} from '../ui/lagerView';
import { itemIconId, preloadItemImages } from '../ui/itemIcons';
import { samePlace, type Ausruestung, type Place } from './ausruestung';
import { CLASSES, type ClassDef, type ClassId } from './classes';
import {
  compareItems,
  canEquip,
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
import { cleanReiterName } from './truhe';

/**
 * Was die Oberfläche von einem Gegenstand zeigt. `viewer` ist die Klasse, deren Lager offen ist: Gegenstände ohne Klasse
 * (alles außer Fackel, Waffe und legendärem Ring) zeigen ihr Bild im Stil dieser Klasse, damit das Lager einer Klasse nach ihr aussieht.
 */
function itemView(item: Item, viewer: ClassId): ItemView {
  const owner = item.classId ? CLASSES.find((entry) => entry.id === item.classId) : undefined;
  return {
    name: itemName(item),
    rarity: item.rarity,
    subtitle: `${RARITY_LABELS[item.rarity]} · ${slotLabel(item.slot, item.classId)}`,
    icon: itemIconId(item.slot, item.classId),
    image: { slot: item.slot, look: item.classId ?? viewer },
    props: item.props.map((property) => ({
      text: describeProperty(property),
      range: formatRange(property.id, item.slot),
      quality: propertyQuality(item.slot, property),
    })),
    bound: owner ? `Gehört zur Klasse ${owner.name}` : null,
  };
}

/** Die Befehle hinter den Reitern der Truhe, in der Reihenfolge der Leiste. */
const COMMANDS = ['neu', 'umbenennen', 'farbe', 'loeschen'] as const;

const KEYS_EQUIPMENT =
  'Pfeiltasten: wählen · Enter: aufnehmen und ablegen · E: anlegen oder abnehmen · Tab: Truhe · 1 · 2 · 3: Klasse wechseln · Esc oder L: zurück';
const KEYS_TRUHE =
  'Pfeiltasten: wählen (ganz oben: Reiter und Befehle) · Enter: aufnehmen und ablegen · E: anlegen oder umräumen · Tab: Ausrüstung · 1 · 2 · 3: Klasse wechseln · Esc oder L: zurück';

export class Lager {
  /** Die Klasse, deren Ausrüstung gezeigt wird (Stelle in `CLASSES`). */
  classIndex = 0;
  /** Wird aufgerufen, wenn das Lager geschlossen werden soll (Esc, L oder der Knopf). */
  onClose: () => void = () => {};
  private mode: LagerMode = 'ausruestung';
  private zone: LagerZone = 'inventar';
  private cursor = 0;
  /** Der geöffnete Reiter der Truhe. */
  private tab = 0;
  /** Der aufgenommene Gegenstand: sein Platz und seine Nummer, damit ein Wechsel im anderen Tab auffällt. */
  private held: { place: Place; id: number } | null = null;
  private renaming = false;
  /** Läuft eine Rückfrage (ein voller Reiter soll gelöscht werden)? `yes`: die zweite Antwort ist vorgewählt. */
  private asking: { yes: boolean } | null = null;
  private note = '';

  constructor(
    private readonly view: LagerView,
    private readonly ausruestung: Ausruestung,
    /** Gold in der Geldbörse. */
    private readonly gold: () => number,
    /** Zahlt Gold aus der Geldbörse; false, wenn es nicht reicht. */
    private readonly spend: (gold: number) => boolean,
  ) {
    preloadItemImages(CLASSES.map((entry) => entry.id));
    view.onClass = (index) => this.selectClass(index);
    view.onMode = (mode) => this.setMode(mode);
    view.onActivate = (zone, index) => {
      this.moveTo(zone, index);
      this.activate();
    };
    view.onHover = (zone, index) => this.moveTo(zone, index);
    view.onDrag = (from, to) => this.dragged(from, to);
    view.onRename = (text) => this.renamed(text);
    view.onAsk = (yes) => this.answered(yes);
    view.onBack = () => this.onClose();
  }

  private get playerClass(): ClassDef {
    return CLASSES[this.classIndex] ?? (CLASSES[0] as ClassDef);
  }

  open(classIndex: number): void {
    this.classIndex = CLASSES[classIndex] ? classIndex : 0;
    this.mode = 'ausruestung';
    this.zone = 'inventar';
    this.tab = 0;
    this.held = null;
    this.renaming = false;
    this.asking = null;
    this.note = '';
    // Der Zeiger beginnt beim ersten Gegenstand im Inventar, sonst oben links.
    const first = this.ausruestung.inventory(this.playerClass.id).findIndex((item) => item !== null);
    this.cursor = Math.max(0, first);
    this.view.hideRename();
    this.view.hideAsk();
    this.render();
  }

  close(): void {
    this.held = null;
    this.view.hide();
  }

  /** Bedienung: Pfeile bewegen den Zeiger, Enter nimmt auf und legt ab, E legt gleich an, Tab wechselt die Ansicht, 1 bis 3 die Klasse. */
  update(input: Input): void {
    // Beim Umbenennen gehören die Tasten dem Textfeld (siehe `Input`); nur dessen Ende kommt als Rückruf an.
    if (this.renaming) return;
    if (this.asking) {
      this.updateAsk(input);
      return;
    }
    if (input.wasPressed('up')) this.step(0, -1);
    else if (input.wasPressed('down')) this.step(0, 1);
    else if (input.wasPressed('left')) this.step(-1, 0);
    else if (input.wasPressed('right')) this.step(1, 0);
    if (input.wasPressed('choice1')) this.selectClass(0);
    else if (input.wasPressed('choice2')) this.selectClass(1);
    else if (input.wasPressed('choice3')) this.selectClass(2);
    if (input.wasPressed('switch')) this.setMode(this.mode === 'ausruestung' ? 'truhe' : 'ausruestung');
    if (input.wasPressed('confirm')) this.activate();
    else if (input.wasPressed('use')) this.quick();
    else if (input.wasPressed('lager')) this.onClose();
    else if (input.wasPressed('pause')) {
      // Esc legt zuerst zurück, was in der Hand liegt; erst ein zweiter Druck schließt das Lager.
      if (this.held) this.cancelHeld();
      else this.onClose();
    }
  }

  private updateAsk(input: Input): void {
    if (!this.asking) return;
    if (input.wasPressed('left') || input.wasPressed('up')) this.asking.yes = false;
    else if (input.wasPressed('right') || input.wasPressed('down')) this.asking.yes = true;
    this.view.setAskChoice(this.asking.yes);
    if (input.wasPressed('confirm')) this.answered(this.asking.yes);
    else if (input.wasPressed('pause')) this.answered(false);
  }

  private selectClass(index: number): void {
    if (index === this.classIndex || !CLASSES[index]) return;
    this.classIndex = index;
    audio.play('auswahl');
    this.render();
  }

  private setMode(mode: LagerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Der Zeiger darf nur auf Plätze zeigen, die es in der neuen Ansicht gibt.
    if (!this.zones().includes(this.zone)) {
      this.zone = 'inventar';
      this.cursor = 0;
    }
    audio.play('auswahl');
    this.render();
  }

  private zones(): readonly LagerZone[] {
    return this.mode === 'ausruestung' ? ['ausruestung', 'inventar'] : ['inventar', 'truhe', 'reiter'];
  }

  private columnsOf(zone: LagerZone): number {
    return zone === 'ausruestung' ? EQUIPMENT_COLUMNS : zone === 'truhe' ? TRUHE_COLUMNS : INVENTORY_COLUMNS;
  }

  private sizeOf(zone: LagerZone): number {
    if (zone === 'ausruestung') return ITEM_SLOTS.length;
    if (zone === 'truhe') return CONFIG.items.truhe.tabSize;
    return CONFIG.items.inventorySize;
  }

  private step(dx: number, dy: number): void {
    if (this.zone === 'reiter') {
      this.stepReiter(dx, dy);
      return;
    }
    const columns = this.columnsOf(this.zone);
    const rows = Math.ceil(this.sizeOf(this.zone) / columns);
    let column = this.cursor % columns;
    let row = Math.floor(this.cursor / columns);
    if (dy !== 0) {
      // Über den oberen Rand der Truhe geht es in die Leiste der Reiter.
      if (this.zone === 'truhe' && dy < 0 && row === 0) {
        this.moveTo('reiter', this.tab);
        return;
      }
      row = (row + dy + rows) % rows;
    } else if (dx < 0 && column > 0) {
      column--;
    } else if (dx > 0 && column < columns - 1) {
      column++;
    } else if (this.mode === 'ausruestung' && dx < 0 && this.zone === 'inventar') {
      // Über den Rand des Inventars nach links in die Ausrüstung, auf die Zeile, die dem Zeiger am nächsten liegt.
      this.moveTo('ausruestung', Math.floor((row * 3) / 5) * EQUIPMENT_COLUMNS + EQUIPMENT_COLUMNS - 1);
      return;
    } else if (this.mode === 'ausruestung' && dx > 0 && this.zone === 'ausruestung') {
      this.moveTo('inventar', Math.min(rows * 2 - 2, row * 2) * INVENTORY_COLUMNS);
      return;
    } else if (this.mode === 'truhe' && dx > 0 && this.zone === 'inventar') {
      this.moveTo('truhe', row * TRUHE_COLUMNS);
      return;
    } else if (this.mode === 'truhe' && dx < 0 && this.zone === 'truhe') {
      this.moveTo('inventar', row * INVENTORY_COLUMNS + INVENTORY_COLUMNS - 1);
      return;
    }
    this.moveTo(this.zone, row * columns + column);
  }

  /** In der Leiste: Links und Rechts gehen die Reiter und Befehle entlang, Ab geht in die Truhe. Ein Reiter öffnet sich beim Hinzeigen. */
  private stepReiter(dx: number, dy: number): void {
    const tabs = this.ausruestung.truhe().length;
    if (dy > 0) {
      this.moveTo('truhe', 0);
      return;
    }
    if (dx === 0) return;
    const next = Math.max(0, Math.min(tabs + COMMANDS.length - 1, this.cursor + dx));
    this.moveTo('reiter', next);
    if (next < tabs) this.selectTab(next);
  }

  private selectTab(index: number): void {
    if (index === this.tab || !this.ausruestung.truhe()[index]) return;
    this.tab = index;
    this.render();
  }

  private moveTo(zone: LagerZone, index: number): void {
    if (zone === this.zone && index === this.cursor) return;
    this.zone = zone;
    this.cursor = index;
    audio.play('auswahl');
    this.view.setCursor(zone, index);
    this.view.showDetail(this.detail());
  }

  /** Der Platz, den ein Feld auf dem Bildschirm meint (für die gerade gezeigte Klasse und den geöffneten Reiter). */
  private placeAt(zone: LagerZone, index: number): Place | null {
    const { id } = this.playerClass;
    switch (zone) {
      case 'inventar':
        return { kind: 'inventar', classId: id, index };
      case 'ausruestung': {
        const slot = ITEM_SLOTS[index];
        return slot ? { kind: 'ausruestung', classId: id, slot } : null;
      }
      case 'truhe':
        return { kind: 'truhe', tab: this.tab, index };
      case 'reiter':
        return null;
    }
  }

  /** Enter oder Klick: einen Gegenstand aufnehmen, den aufgenommenen ablegen, in der Leiste einen Befehl ausführen. */
  private activate(): void {
    this.say('');
    if (this.zone === 'reiter') {
      this.activateReiter();
      return;
    }
    const place = this.placeAt(this.zone, this.cursor);
    if (!place) return;
    if (this.held) {
      this.drop(place);
      return;
    }
    const item = this.ausruestung.itemAt(place);
    if (!item) return;
    this.held = { place, id: item.id };
    audio.play('auswahl');
    this.render();
  }

  /** Legt den aufgenommenen Gegenstand auf `target` ab; ein Gegenstand dort tauscht den Platz mit ihm. */
  private drop(target: Place): void {
    const held = this.held;
    if (!held) return;
    const item = this.ausruestung.itemAt(held.place);
    if (!item || item.id !== held.id) {
      // Ein anderes offenes Fenster hat ihn inzwischen weggenommen.
      this.held = null;
      this.refuse('Der Gegenstand liegt nicht mehr dort.');
      this.render();
      return;
    }
    if (samePlace(held.place, target)) {
      // Auf den eigenen Platz gelegt: zurückgelegt.
      this.held = null;
      this.render();
      return;
    }
    const reason = this.ausruestung.refusal(held.place, target);
    if (reason || !this.ausruestung.move(held.place, target)) {
      // Er bleibt in der Hand, damit man einen anderen Platz versuchen kann.
      this.refuse(reason ?? 'Das ging nicht.');
      this.render();
      return;
    }
    this.held = null;
    audio.play('bestaetigen');
    this.render();
  }

  private cancelHeld(): void {
    this.held = null;
    this.say('');
    audio.play('auswahl');
    this.render();
  }

  /** Ein Gegenstand wurde gezogen und losgelassen: aufnehmen und dort ablegen, wo er losgelassen wurde. */
  private dragged(from: Mark, to: Mark | null): void {
    this.say('');
    // Hält die Figur schon etwas, zählt nur das Ablegen per Klick.
    if (this.held) {
      this.render();
      return;
    }
    const source = this.placeAt(from.zone, from.index);
    const item = source ? this.ausruestung.itemAt(source) : null;
    if (!source || !item) return;
    if (!to) {
      this.render();
      return;
    }
    this.held = { place: source, id: item.id };
    if (to.zone === 'reiter') {
      // Auf einen Reiter gezogen: hinein. Auf einen Befehl oder daneben: zurück.
      if (to.index < this.ausruestung.truhe().length) this.dropIntoTab(to.index);
      else this.cancelHeld();
      return;
    }
    const target = this.placeAt(to.zone, to.index);
    if (target) this.drop(target);
    else this.cancelHeld();
  }

  /** Legt den aufgenommenen Gegenstand auf den ersten freien Platz des Reiters. */
  private dropIntoTab(index: number): void {
    const tab = this.ausruestung.truhe()[index];
    const free = tab?.slots.indexOf(null) ?? -1;
    if (!tab || free < 0) {
      this.refuse(tab ? `Der Reiter „${tab.name}“ ist voll.` : 'Diesen Reiter gibt es nicht.');
      this.render();
      return;
    }
    this.drop({ kind: 'truhe', tab: index, index: free });
  }

  /**
   * E: Schnell erledigen, ohne den Gegenstand aufzunehmen. Ein angelegter wandert ins Inventar; ein Gegenstand, den die gezeigte
   * Klasse tragen kann, wird angelegt (der getragene nimmt seinen Platz); alles andere wandert zwischen Inventar und Truhe.
   */
  private quick(): void {
    this.say('');
    if (this.held || this.zone === 'reiter') return;
    const from = this.placeAt(this.zone, this.cursor);
    const item = from ? this.ausruestung.itemAt(from) : null;
    if (!from || !item) return;
    const { id } = this.playerClass;
    let target: Place | null;
    if (from.kind === 'ausruestung') target = this.ausruestung.freeInventory(id) ?? this.ausruestung.freeChest(this.tab);
    else if (canEquip(item, id)) target = { kind: 'ausruestung', classId: id, slot: item.slot };
    else if (from.kind === 'inventar') target = this.ausruestung.freeChest(this.tab);
    else target = this.ausruestung.freeInventory(id);
    if (!target) {
      this.refuse('Es ist kein Platz frei.');
      return;
    }
    if (this.ausruestung.move(from, target)) audio.play('bestaetigen');
    else this.refuse(this.ausruestung.refusal(from, target) ?? 'Das ging nicht.');
    this.render();
  }

  private activateReiter(): void {
    const tabs = this.ausruestung.truhe();
    if (this.cursor < tabs.length) {
      // Mit einem Gegenstand in der Hand: ab in diesen Reiter. Sonst öffnet er sich nur.
      if (this.held) this.dropIntoTab(this.cursor);
      else this.selectTab(this.cursor);
      return;
    }
    switch (COMMANDS[this.cursor - tabs.length]) {
      case 'neu':
        this.newTab();
        break;
      case 'umbenennen':
        this.startRename();
        break;
      case 'farbe':
        this.ausruestung.colorTab(this.tab, (this.ausruestung.truhe()[this.tab]?.color ?? 0) + 1);
        audio.play('auswahl');
        this.render();
        break;
      case 'loeschen':
        this.deleteTab();
        break;
    }
  }

  private newTab(): void {
    const price = this.ausruestung.nextTabPrice();
    if (price === null) {
      this.refuse(`Mehr als ${CONFIG.items.truhe.maxTabs} Reiter gibt es nicht.`);
      return;
    }
    if (price > this.gold()) {
      this.refuse(`Ein neuer Reiter kostet ${price} Gold.`);
      return;
    }
    if (price > 0 && !this.spend(price)) {
      this.refuse(`Ein neuer Reiter kostet ${price} Gold.`);
      return;
    }
    const index = this.ausruestung.addTab();
    if (index < 0) {
      this.refuse(`Mehr als ${CONFIG.items.truhe.maxTabs} Reiter gibt es nicht.`);
      return;
    }
    this.tab = index;
    // Der Zeiger bleibt auf dem Befehl „Neuer Reiter“, der jetzt eine Stelle weiter rechts steht.
    this.cursor = index + 1;
    this.say(price > 0 ? `Neuer Reiter für ${price} Gold.` : 'Neuer Reiter.');
    audio.play('bestaetigen');
    this.render();
  }

  private startRename(): void {
    const tab = this.ausruestung.truhe()[this.tab];
    if (!tab) return;
    this.renaming = true;
    this.view.showRename(tab.name, CONFIG.items.truhe.nameLength);
  }

  private renamed(text: string | null): void {
    this.renaming = false;
    if (text !== null) {
      const name = cleanReiterName(text);
      if (name) this.ausruestung.renameTab(this.tab, name);
    }
    this.render();
  }

  private deleteTab(): void {
    const tab = this.ausruestung.truhe()[this.tab];
    if (!tab) return;
    const count = tab.slots.filter((item) => item !== null).length;
    if (this.ausruestung.truhe().length <= 1) {
      this.refuse('Der letzte Reiter bleibt.');
      return;
    }
    if (count === 0) {
      this.removeTab(false);
      return;
    }
    // Ein voller Reiter wird nie einfach gelöscht: Die Gegenstände ziehen in die anderen Reiter um, und das Spiel fragt vorher.
    this.asking = { yes: false };
    this.view.showAsk(
      `„${tab.name}“ enthält ${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'}. In die anderen Reiter verschieben und den Reiter löschen?`,
      'Abbrechen',
      'Verschieben und löschen',
    );
    audio.play('auswahl');
  }

  private answered(yes: boolean): void {
    if (!this.asking) return;
    this.asking = null;
    this.view.hideAsk();
    if (yes) this.removeTab(true);
    else this.render();
  }

  private removeTab(moveItems: boolean): void {
    const result = this.ausruestung.removeTab(this.tab, moveItems);
    if (result === 'ok') {
      this.tab = Math.min(this.tab, this.ausruestung.truhe().length - 1);
      this.cursor = this.tab;
      this.say('Reiter gelöscht.');
      audio.play('bestaetigen');
    } else {
      this.refuse(
        result === 'voll'
          ? 'In den anderen Reitern ist nicht genug Platz. Schaffe Platz oder lege einen neuen Reiter an.'
          : result === 'letzter'
            ? 'Der letzte Reiter bleibt.'
            : 'Der Reiter ist nicht leer.',
      );
    }
    this.render();
  }

  private say(text: string): void {
    this.note = text;
    this.view.setNote(text);
  }

  /** Eine Handlung ging nicht: Die Börse zuckt, und die Zeile unten sagt, warum. */
  private refuse(text: string): void {
    this.say(text);
    this.view.deny();
  }

  /** Karte zu dem, worauf der Zeiger steht: ein Gegenstand mit Vergleich, ein leerer Platz oder ein Reiter und Befehl. */
  private detail(): DetailView {
    const { id } = this.playerClass;
    if (this.zone === 'reiter') return this.reiterDetail();
    if (this.zone === 'ausruestung') {
      const slot = ITEM_SLOTS[this.cursor];
      const item = slot ? this.ausruestung.equipped(id, slot) : null;
      return {
        item: item ? itemView(item, id) : null,
        emptyText: slot ? `${slotLabel(slot, id)}: nichts angelegt.` : '',
        compare: null,
        compareTitle: '',
      };
    }
    const place = this.placeAt(this.zone, this.cursor);
    const item = place ? this.ausruestung.itemAt(place) : null;
    if (!item) return { item: null, emptyText: 'Leerer Platz.', compare: null, compareTitle: '' };
    // Verglichen wird nur, was die gezeigte Klasse auch tragen könnte.
    const worn = canEquip(item, id) ? this.ausruestung.equipped(id, item.slot) : null;
    const comparable = canEquip(item, id);
    return {
      item: itemView(item, id),
      emptyText: '',
      compare: comparable
        ? compareItems(item, worn).map(({ id: property, delta }) => ({
            text: `${propertyName(property)} ${formatValue(property, delta)}`,
            better: delta > 0,
          }))
        : null,
      compareTitle: worn ? `Gegenüber ${itemName(worn)}` : 'Gegenüber leerem Platz',
    };
  }

  private reiterDetail(): DetailView {
    const tabs = this.ausruestung.truhe();
    const empty = (emptyText: string): DetailView => ({ item: null, emptyText, compare: null, compareTitle: '' });
    const tab = tabs[this.cursor];
    if (tab) {
      const count = tab.slots.filter((item) => item !== null).length;
      return empty(`Reiter „${tab.name}“: ${count} von ${tab.slots.length} Plätzen belegt. Enter öffnet ihn; mit einem Gegenstand in der Hand legt Enter ihn hinein.`);
    }
    const current = tabs[this.tab];
    switch (COMMANDS[this.cursor - tabs.length]) {
      case 'neu': {
        const price = this.ausruestung.nextTabPrice();
        if (price === null) return empty(`Mehr als ${CONFIG.items.truhe.maxTabs} Reiter gibt es nicht.`);
        return empty(price === 0 ? 'Einen neuen Reiter anlegen: gratis.' : `Einen neuen Reiter anlegen: ${price} Gold.`);
      }
      case 'umbenennen':
        return empty(`Reiter „${current?.name ?? ''}“ umbenennen.`);
      case 'farbe':
        return empty(`Die Farbe von „${current?.name ?? ''}“ wechseln.`);
      case 'loeschen':
        return empty(
          `Reiter „${current?.name ?? ''}“ löschen. Ein voller Reiter wird vorher in die anderen Reiter geleert; das Spiel fragt nach.`,
        );
      default:
        return empty('');
    }
  }

  /** Wo der aufgenommene Gegenstand auf dem Bildschirm liegt; `null`, wenn dieser Platz gerade nicht zu sehen ist. */
  private heldMark(): Mark | null {
    const held = this.held?.place;
    if (!held) return null;
    const { id } = this.playerClass;
    if (held.kind === 'inventar') return held.classId === id ? { zone: 'inventar', index: held.index } : null;
    if (held.kind === 'ausruestung') {
      return held.classId === id && this.mode === 'ausruestung' ? { zone: 'ausruestung', index: ITEM_SLOTS.indexOf(held.slot) } : null;
    }
    return held.tab === this.tab && this.mode === 'truhe' ? { zone: 'truhe', index: held.index } : null;
  }

  private truheModel(): TruheModel {
    const tabs = this.ausruestung.truhe();
    const { colors } = CONFIG.items.truhe;
    const price = this.ausruestung.nextTabPrice();
    const { id } = this.playerClass;
    return {
      tabs: tabs.map((tab) => ({
        name: tab.name,
        color: colors[tab.color] ?? '#b9b3a5',
        count: tab.slots.filter((item) => item !== null).length,
        size: tab.slots.length,
      })),
      active: this.tab,
      slots: (tabs[this.tab]?.slots ?? []).map((item) => ({ label: '', icon: null, item: item ? itemView(item, id) : null })),
      commands: [
        { label: price === null ? '+ Reiter (voll)' : price === 0 ? '+ Reiter' : `+ Reiter (${price} Gold)`, title: 'Neuen Reiter anlegen' },
        { label: 'Umbenennen', title: 'Den Namen des Reiters ändern' },
        { label: 'Farbe', title: 'Die Farbe des Reiters wechseln' },
        { label: 'Löschen', title: 'Den Reiter löschen' },
      ],
    };
  }

  /** Zeichnet das Lager neu, etwa nach dem Ablegen oder dem Wechsel der Klasse. */
  private render(): void {
    const { id } = this.playerClass;
    // Der Zeiger darf nach Änderungen (gelöschter Reiter, anderer Reiter) nicht ins Leere zeigen.
    const entries = this.ausruestung.truhe().length + COMMANDS.length;
    this.tab = Math.min(this.tab, this.ausruestung.truhe().length - 1);
    this.cursor = Math.min(this.cursor, (this.zone === 'reiter' ? entries : this.sizeOf(this.zone)) - 1);
    const equipment: SlotView[] = ITEM_SLOTS.map((slot) => {
      const item = this.ausruestung.equipped(id, slot);
      return {
        label: slotLabel(slot, id),
        icon: itemIconId(slot, id),
        item: item ? itemView(item, id) : null,
      };
    });
    const inventory: SlotView[] = this.ausruestung.inventory(id).map((item) => ({
      label: '',
      icon: null,
      item: item ? itemView(item, id) : null,
    }));
    const summary = [...this.ausruestung.totals(id)].map(([property, total]) => ({
      text: `${propertyName(property)} ${formatValue(property, total)}`,
      capped: total >= CONFIG.items.properties[property].cap,
    }));
    const heldItem = this.held ? this.ausruestung.itemAt(this.held.place) : null;
    const model: LagerModel = {
      gold: this.gold(),
      classes: CLASSES.map((entry) => {
        const count = this.ausruestung.count(entry.id);
        return { name: entry.name, note: `${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'}` };
      }),
      active: this.classIndex,
      mode: this.mode,
      equipment,
      inventory,
      summary,
      truhe: this.truheModel(),
      held: this.heldMark(),
      hand: heldItem
        ? `In der Hand: ${itemName(heldItem)} (${RARITY_LABELS[heldItem.rarity]}) · Enter oder Klick: ablegen · Esc: zurücklegen`
        : '',
      note: this.note,
      keys: this.mode === 'ausruestung' ? KEYS_EQUIPMENT : KEYS_TRUHE,
    };
    this.view.show(model);
    // Nach dem Neuzeichnen steht kein Platz mehr markiert; den Zeiger setzen und die Karte neu füllen.
    this.view.setCursor(this.zone, this.cursor);
    this.view.showDetail(this.detail());
  }
}
