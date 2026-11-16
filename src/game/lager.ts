/**
 * Das Lager zwischen den Nächten: pro Klasse die neun angelegten Gegenstände und das Inventar, dazu die Truhe für alle und der Händler.
 *
 * Dieser Teil hält die Bedienung (Zeiger, Handlungen, Tasten) und bereitet die Gegenstände für die Oberfläche auf
 * (`ui/lagerView.ts`); gespeichert und gehandelt wird in `Ausruestung`. Drei Ansichten: Ausrüstung (angelegt und Inventar), Truhe
 * (Inventar und Truhe mit ihren Reitern) und Händler (sein Angebot und der Rückkauf links, der eigene Besitz rechts).
 *
 * Ein Gegenstand wandert so: Enter oder Klick nimmt ihn auf, ein zweiter Druck legt ihn auf einen anderen Platz ab (liegt dort
 * schon einer, tauschen beide); Ziehen mit der Maus oder dem Finger tut dasselbe in einem Zug. Aufgenommen ist er nur gemerkt:
 * Erst das Ablegen ändert etwas, ein Abbruch (Esc) lässt alles, wie es war. Wer es eilig hat, drückt E: Das legt den
 * Gegenstand gleich an, oder räumt ihn zwischen Inventar und Truhe um, und beim Händler kauft oder verkauft es. Jede Handlung geht
 * mit Maus und mit der Tastatur gleichwertig (Pfeile bewegen den Zeiger), damit später ein Gamepad ohne Umbau passt.
 *
 * Beim Händler heißt „ablegen“ auf sein Angebot oder den Rückkauf: verkaufen. Gekauft wird mit Enter auf dem Angebot oder indem man
 * den Gegenstand auf einen freien Platz des eigenen Besitzes zieht. Ab Rar fragt das Spiel vorher nach.
 */

import { audio } from '../audio';
import { CONFIG } from '../config';
import type { Input } from '../core/input';
import {
  EQUIPMENT_COLUMNS,
  HAENDLER_COLUMNS,
  INVENTORY_COLUMNS,
  LagerView,
  TRUHE_COLUMNS,
  type DetailView,
  type HaendlerModel,
  type ItemView,
  type LagerMode,
  type LagerModel,
  type LagerZone,
  type Mark,
  type SlotView,
  type TruheModel,
} from '../ui/lagerView';
import { itemIconId, preloadItemImages } from '../ui/itemIcons';
import { samePlace, type Ausruestung, type Place, type Scope } from './ausruestung';
import { CLASSES, type ClassDef, type ClassId } from './classes';
import { needsConfirm } from './haendler';
import {
  compareItems,
  canEquip,
  describeEvolution,
  describeProperty,
  formatRange,
  formatValue,
  ITEM_SLOTS,
  itemName,
  itemValue,
  propertyName,
  propertyQuality,
  RARITY_LABELS,
  sellPrice,
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
    evolution: describeEvolution(item),
  };
}

/** Die Ansichten in der Reihenfolge, in der Tab sie durchläuft. */
const MODES: readonly LagerMode[] = ['ausruestung', 'truhe', 'haendler'];

/** Die Befehle hinter den Reitern der Truhe, in der Reihenfolge der Leiste. */
const COMMANDS = ['neu', 'umbenennen', 'farbe', 'loeschen'] as const;

/** Die Befehle zwischen Angebot und Rückkauf des Händlers. */
const HAENDLER_COMMANDS = ['erneuern', 'normale'] as const;

/** Die Farbe der Leiste für das Inventar, das beim Händler als erster Reiter vor denen der Truhe steht. */
const INVENTORY_COLOR = '#b9b3a5';

const KEYS_EQUIPMENT =
  'Pfeiltasten: wählen · Enter: aufnehmen und ablegen · E: anlegen oder abnehmen · Tab: nächste Ansicht · 1 · 2 · 3: Klasse wechseln · Esc oder L: zurück';
const KEYS_TRUHE =
  'Pfeiltasten: wählen (ganz oben: Reiter und Befehle) · Enter: aufnehmen und ablegen · E: anlegen oder umräumen · Tab: nächste Ansicht · 1 · 2 · 3: Klasse wechseln · Esc oder L: zurück';
const KEYS_HAENDLER =
  'Pfeiltasten: wählen (ganz oben: Inventar und Reiter) · Enter: kaufen, aufnehmen und ablegen · E: kaufen oder verkaufen · Tab: nächste Ansicht · 1 · 2 · 3: Klasse wechseln · Esc oder L: zurück';

/** Ein Rückruf auf die Antwort „Ja“ einer Rückfrage; bei „Nein“ geschieht nichts. */
type OnYes = () => void;

function isVendorZone(zone: LagerZone): boolean {
  return zone === 'angebot' || zone === 'befehle' || zone === 'rueckkauf';
}

export class Lager {
  /** Die Klasse, deren Ausrüstung gezeigt wird (Stelle in `CLASSES`). */
  classIndex = 0;
  /** Wird aufgerufen, wenn das Lager geschlossen werden soll (Esc, L oder der Knopf). */
  onClose: () => void = () => {};
  private mode: LagerMode = 'ausruestung';
  private zone: LagerZone = 'inventar';
  private cursor = 0;
  /** Der geöffnete Reiter der Truhe; beim Händler steht -1 für das Inventar (siehe `truheModel`). */
  private tab = 0;
  /** Der aufgenommene Gegenstand: sein Platz und seine Nummer, damit ein Wechsel im anderen Tab auffällt. */
  private held: { place: Place; id: number } | null = null;
  private renaming = false;
  /** Läuft eine Rückfrage? `yes`: die zweite Antwort ist vorgewählt; `onYes` geschieht bei dieser Antwort. */
  private asking: { yes: boolean; onYes: OnYes } | null = null;
  private note = '';
  /** Ist die Rückmeldung eine Absage (rot) statt einer Bestätigung? */
  private noteBad = false;

  constructor(
    private readonly view: LagerView,
    private readonly ausruestung: Ausruestung,
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

  /** Das Gold in der Geldbörse. */
  private get gold(): number {
    return this.ausruestung.gold;
  }

  open(classIndex: number): void {
    this.classIndex = CLASSES[classIndex] ? classIndex : 0;
    // Gold und Gegenstände können sich seit dem letzten Mal geändert haben (der Ertrag der Nacht, ein anderes Fenster).
    if (this.ausruestung.persist) this.ausruestung.reload();
    this.mode = 'ausruestung';
    this.zone = 'inventar';
    this.tab = 0;
    this.held = null;
    this.renaming = false;
    this.asking = null;
    this.note = '';
    this.noteBad = false;
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

  /** Bedienung: Pfeile bewegen den Zeiger, Enter nimmt auf und legt ab, E handelt gleich, Tab wechselt die Ansicht, 1 bis 3 die Klasse. */
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
    if (input.wasPressed('switch')) this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length] ?? 'ausruestung');
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

  /** Stellt eine Rückfrage mit zwei Antworten; die zweite (`yes`) führt `onYes` aus. Vorgewählt ist die erste, sichere. */
  private ask(text: string, no: string, yes: string, onYes: OnYes): void {
    this.asking = { yes: false, onYes };
    this.view.showAsk(text, no, yes);
    audio.play('auswahl');
  }

  /** Wer etwas anderes tut, statt zu antworten (anklicken, ziehen, die Klasse oder Ansicht wechseln), nimmt die Rückfrage zurück. */
  private dismissAsk(): void {
    if (!this.asking) return;
    this.asking = null;
    this.view.hideAsk();
  }

  private answered(yes: boolean): void {
    const asking = this.asking;
    if (!asking) return;
    this.asking = null;
    this.view.hideAsk();
    if (yes) asking.onYes();
    else this.render();
  }

  private selectClass(index: number): void {
    if (index === this.classIndex || !CLASSES[index]) return;
    this.dismissAsk();
    this.classIndex = index;
    audio.play('auswahl');
    this.render();
  }

  private setMode(mode: LagerMode): void {
    if (mode === this.mode) return;
    this.dismissAsk();
    const wasHaendler = this.mode === 'haendler';
    this.mode = mode;
    if (mode === 'haendler') {
      // Das Angebot wird gewürfelt, wenn man den Händler nach einer gespielten Nacht zum ersten Mal ansieht.
      this.ausruestung.stockUp();
      this.tab = -1;
      this.zone = 'angebot';
      this.cursor = 0;
    } else if (wasHaendler) {
      this.tab = Math.max(0, this.tab);
      this.zone = 'inventar';
      this.cursor = 0;
    } else if (!this.zones().includes(this.zone)) {
      // Der Zeiger darf nur auf Plätze zeigen, die es in der neuen Ansicht gibt.
      this.zone = 'inventar';
      this.cursor = 0;
    }
    audio.play('auswahl');
    this.render();
  }

  private zones(): readonly LagerZone[] {
    switch (this.mode) {
      case 'ausruestung':
        return ['ausruestung', 'inventar'];
      case 'truhe':
        return ['inventar', 'truhe', 'reiter'];
      case 'haendler':
        return ['angebot', 'befehle', 'rueckkauf', 'truhe', 'reiter'];
    }
  }

  /** Beim Händler steht das Inventar als erster Reiter vor denen der Truhe; sonst fängt die Leiste mit dem ersten Reiter an. */
  private get offset(): number {
    return this.mode === 'haendler' ? 1 : 0;
  }

  /** Wie viele Reiter die Leiste zeigt, und wie viele Befehle dahinter stehen. */
  private get chips(): number {
    return this.ausruestung.truhe().length + this.offset;
  }

  private get entries(): number {
    return this.chips + (this.mode === 'haendler' ? 0 : COMMANDS.length);
  }

  private columnsOf(zone: LagerZone): number {
    switch (zone) {
      case 'ausruestung':
        return EQUIPMENT_COLUMNS;
      case 'truhe':
        return TRUHE_COLUMNS;
      case 'angebot':
      case 'rueckkauf':
        return HAENDLER_COLUMNS;
      case 'befehle':
        return HAENDLER_COMMANDS.length;
      default:
        return INVENTORY_COLUMNS;
    }
  }

  private sizeOf(zone: LagerZone): number {
    switch (zone) {
      case 'ausruestung':
        return ITEM_SLOTS.length;
      case 'truhe':
        return this.tab < 0 ? CONFIG.items.inventorySize : CONFIG.items.truhe.tabSize;
      case 'angebot':
        return CONFIG.items.shop.size;
      case 'rueckkauf':
        return CONFIG.items.shop.buybackSize;
      case 'befehle':
        return HAENDLER_COMMANDS.length;
      case 'reiter':
        return this.entries;
      case 'inventar':
        return CONFIG.items.inventorySize;
    }
  }

  private step(dx: number, dy: number): void {
    if (this.zone === 'reiter') {
      this.stepReiter(dx, dy);
      return;
    }
    if (this.mode === 'haendler' && this.stepHaendler(dx, dy)) return;
    const columns = this.columnsOf(this.zone);
    const rows = Math.ceil(this.sizeOf(this.zone) / columns);
    let column = this.cursor % columns;
    let row = Math.floor(this.cursor / columns);
    if (dy !== 0) {
      // Über den oberen Rand der Truhe geht es in die Leiste der Reiter.
      if (this.zone === 'truhe' && dy < 0 && row === 0) {
        this.moveTo('reiter', this.tab + this.offset);
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

  /**
   * Beim Händler: Der Zeiger wandert vom Angebot über die Befehle zum Rückkauf, und über den rechten Rand ins eigene Inventar oder
   * den eigenen Reiter (die Zeilen liegen dort so, dass Angebot, Befehle und Rückkauf der Reihe nach gegenüberstehen). Gibt true
   * zurück, wenn der Schritt hier erledigt ist; im eigenen Besitz gilt sonst die gewöhnliche Bewegung im Raster.
   */
  private stepHaendler(dx: number, dy: number): boolean {
    const columns = HAENDLER_COLUMNS;
    if (this.zone === 'truhe') {
      if (dx < 0 && this.cursor % columns === 0) {
        const row = Math.floor(this.cursor / columns);
        if (row <= 1) this.moveTo('angebot', row * columns + columns - 1);
        else if (row === 2) this.moveTo('befehle', HAENDLER_COMMANDS.length - 1);
        else this.moveTo('rueckkauf', (row - 3) * columns + columns - 1);
        return true;
      }
      return false;
    }
    if (this.zone === 'befehle') {
      const last = HAENDLER_COMMANDS.length - 1;
      if (dy < 0) this.moveTo('angebot', columns + (this.cursor === 0 ? 1 : 3));
      else if (dy > 0) this.moveTo('rueckkauf', this.cursor === 0 ? 1 : 3);
      else if (dx < 0) this.moveTo('befehle', Math.max(0, this.cursor - 1));
      else if (this.cursor < last) this.moveTo('befehle', this.cursor + 1);
      else this.moveTo('truhe', 2 * columns);
      return true;
    }
    if (this.zone !== 'angebot' && this.zone !== 'rueckkauf') return false;
    const rows = Math.ceil(this.sizeOf(this.zone) / columns);
    let column = this.cursor % columns;
    let row = Math.floor(this.cursor / columns);
    // Aus der unteren Zeile des Angebots oder der oberen des Rückkaufs geht es in die Befehle; weiter hinaus geht es nicht.
    const command = column < 3 ? 0 : 1;
    if (dy < 0) {
      if (row > 0) row--;
      else {
        if (this.zone === 'rueckkauf') this.moveTo('befehle', command);
        return true;
      }
    } else if (dy > 0) {
      if (row < rows - 1) row++;
      else {
        if (this.zone === 'angebot') this.moveTo('befehle', command);
        return true;
      }
    } else if (dx < 0) {
      if (column === 0) return true;
      column--;
    } else if (column < columns - 1) {
      column++;
    } else {
      this.moveTo('truhe', (this.zone === 'angebot' ? row : row + 3) * TRUHE_COLUMNS);
      return true;
    }
    this.moveTo(this.zone, row * columns + column);
    return true;
  }

  /** In der Leiste: Links und Rechts gehen die Reiter und Befehle entlang, Ab geht in die Truhe. Ein Reiter öffnet sich beim Hinzeigen. */
  private stepReiter(dx: number, dy: number): void {
    if (dy > 0) {
      this.moveTo('truhe', 0);
      return;
    }
    if (dx === 0) return;
    const next = Math.max(0, Math.min(this.entries - 1, this.cursor + dx));
    this.moveTo('reiter', next);
    if (next < this.chips) this.selectTab(next - this.offset);
  }

  /** Öffnet einen Reiter; -1 ist das Inventar (nur beim Händler). */
  private selectTab(index: number): void {
    const exists = index < 0 ? this.mode === 'haendler' : this.ausruestung.truhe()[index] !== undefined;
    if (index === this.tab || !exists) return;
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

  /** Der Platz, den ein Feld auf dem Bildschirm meint (für die gezeigte Klasse und den geöffneten Reiter); Angebot und Rückkauf sind keine. */
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
        return this.tab < 0 ? { kind: 'inventar', classId: id, index } : { kind: 'truhe', tab: this.tab, index };
      default:
        return null;
    }
  }

  /** Der erste freie Platz im Inventar (`tab` -1) oder in einem Reiter der Truhe. */
  private firstFree(tab: number): Place | null {
    if (tab < 0) return this.ausruestung.freeInventory(this.playerClass.id);
    const index = this.ausruestung.truhe()[tab]?.slots.indexOf(null) ?? -1;
    return index < 0 ? null : { kind: 'truhe', tab, index };
  }

  /** Enter oder Klick: einen Gegenstand aufnehmen, den aufgenommenen ablegen, beim Händler kaufen und verkaufen, in der Leiste einen Befehl ausführen. */
  private activate(): void {
    this.say('');
    this.dismissAsk();
    if (this.zone === 'reiter') {
      this.activateReiter();
      return;
    }
    if (this.zone === 'befehle') {
      this.activateCommand();
      return;
    }
    if (this.zone === 'angebot' || this.zone === 'rueckkauf') {
      // Mit einem Gegenstand in der Hand legt man ihn dem Händler hin: Das verkauft ihn. Sonst kauft Enter, was dort liegt.
      if (this.held) this.sellHeld();
      else this.buyAt(this.zone, this.cursor);
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

  /** Ein Gegenstand wurde gezogen und losgelassen: aufnehmen und dort ablegen, wo er losgelassen wurde; beim Händler kaufen und verkaufen. */
  private dragged(from: Mark, to: Mark | null): void {
    this.say('');
    this.dismissAsk();
    // Hält die Figur schon etwas, zählt nur das Ablegen per Klick.
    if (this.held) {
      this.render();
      return;
    }
    if (from.zone === 'angebot' || from.zone === 'rueckkauf') {
      this.draggedFromHaendler(from.zone, from.index, to);
      return;
    }
    const source = this.placeAt(from.zone, from.index);
    const item = source ? this.ausruestung.itemAt(source) : null;
    if (!source || !item) return;
    if (!to) {
      this.render();
      return;
    }
    // Auf den Händler gezogen: verkaufen.
    if (this.mode === 'haendler' && isVendorZone(to.zone)) {
      this.offerSale(source);
      return;
    }
    this.held = { place: source, id: item.id };
    if (to.zone === 'reiter') {
      // Auf einen Reiter gezogen: hinein. Auf einen Befehl oder daneben: zurück.
      if (to.index < this.chips) this.dropIntoTab(to.index - this.offset);
      else this.cancelHeld();
      return;
    }
    const target = this.placeAt(to.zone, to.index);
    if (target) this.drop(target);
    else this.cancelHeld();
  }

  /** Ein Gegenstand des Händlers wurde gezogen: auf einen Platz des eigenen Besitzes oder einen Reiter fallen gelassen, wird er gekauft. */
  private draggedFromHaendler(zone: 'angebot' | 'rueckkauf', index: number, to: Mark | null): void {
    let into: Place | null = null;
    if (to?.zone === 'truhe') into = this.placeAt('truhe', to.index);
    else if (to?.zone === 'reiter' && to.index < this.chips) {
      into = this.firstFree(to.index - this.offset);
      if (!into) {
        this.refuse(`${this.tabName(to.index - this.offset)} ist voll.`);
        this.render();
        return;
      }
    }
    if (!into) {
      this.render();
      return;
    }
    this.buyAt(zone, index, into);
  }

  /** Legt den aufgenommenen Gegenstand auf den ersten freien Platz des Reiters (-1: des Inventars). */
  private dropIntoTab(index: number): void {
    const place = this.firstFree(index);
    if (!place) {
      this.refuse(`${this.tabName(index)} ist voll.`);
      this.render();
      return;
    }
    this.drop(place);
  }

  private tabName(index: number): string {
    if (index < 0) return 'Das Inventar';
    const tab = this.ausruestung.truhe()[index];
    return tab ? `Der Reiter „${tab.name}“` : 'Dieser Reiter';
  }

  /**
   * E: Schnell erledigen, ohne den Gegenstand aufzunehmen. Ein angelegter wandert ins Inventar; ein Gegenstand, den die gezeigte
   * Klasse tragen kann, wird angelegt (der getragene nimmt seinen Platz); alles andere wandert zwischen Inventar und Truhe.
   * Beim Händler kauft E, was im Angebot oder im Rückkauf liegt, und verkauft, was man besitzt.
   */
  private quick(): void {
    this.say('');
    if (this.held || this.zone === 'reiter' || this.zone === 'befehle') return;
    if (this.zone === 'angebot' || this.zone === 'rueckkauf') {
      this.buyAt(this.zone, this.cursor);
      return;
    }
    const from = this.placeAt(this.zone, this.cursor);
    const item = from ? this.ausruestung.itemAt(from) : null;
    if (!from || !item) return;
    if (this.mode === 'haendler') {
      this.offerSale(from);
      return;
    }
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

  /** Was ein Gegenstand des Händlers kostet: im Angebot den vollen Wert, im Rückkauf das, was der Verkauf eingebracht hat. */
  private priceOf(zone: 'angebot' | 'rueckkauf', item: Item): number {
    return zone === 'angebot' ? itemValue(item) : sellPrice(item);
  }

  /** Kauft den Gegenstand an einer Stelle des Angebots oder Rückkaufs; ab Rar fragt das Spiel vorher nach. `into` ist der Platz, wohin er soll. */
  private buyAt(zone: 'angebot' | 'rueckkauf', index: number, into?: Place): void {
    const stand = this.ausruestung.haendler();
    const item = zone === 'angebot' ? stand.stock[index] : stand.buyback[index];
    if (!item) return;
    const price = this.priceOf(zone, item);
    if (price > this.gold) {
      this.refuse(`Dafür fehlen ${price - this.gold} Gold.`);
      this.render();
      return;
    }
    if (needsConfirm(item)) {
      const verb = zone === 'angebot' ? 'kaufen' : 'zurückkaufen';
      this.ask(
        `„${itemName(item)}“ (${RARITY_LABELS[item.rarity]}) für ${price} Gold ${verb}?`,
        'Abbrechen',
        zone === 'angebot' ? 'Kaufen' : 'Zurückkaufen',
        () => this.completeBuy(zone, index, item, into),
      );
      return;
    }
    this.completeBuy(zone, index, item, into);
  }

  private completeBuy(zone: 'angebot' | 'rueckkauf', index: number, item: Item, into?: Place): void {
    const { id } = this.playerClass;
    const options = into ? { into, id: item.id } : { id: item.id };
    const deal = zone === 'angebot' ? this.ausruestung.buy(index, id, options) : this.ausruestung.buyBack(index, id, options);
    if (!deal.ok) {
      this.refuse(deal.reason);
      this.render();
      return;
    }
    this.say(`„${itemName(item)}“ ${zone === 'angebot' ? 'gekauft' : 'zurückgekauft'} für ${deal.price} Gold${this.whereIs(deal.place)}.`);
    audio.play('steigerung');
    this.render();
  }

  /** „ (ins Inventar)“ oder „ (in die Truhe, Reiter …)“: wohin ein gekaufter Gegenstand gekommen ist, damit man ihn wiederfindet. */
  private whereIs(place: Place | null): string {
    if (!place) return '';
    if (place.kind === 'inventar') return ' (ins Inventar)';
    if (place.kind === 'truhe') return ` (in die Truhe, Reiter „${this.ausruestung.truhe()[place.tab]?.name ?? ''}“)`;
    return '';
  }

  /** Bietet dem Händler einen eigenen Gegenstand an; ab Rar fragt das Spiel vorher nach. */
  private offerSale(place: Place): void {
    const item = this.ausruestung.itemAt(place);
    if (!item) return;
    if (needsConfirm(item)) {
      this.ask(
        `„${itemName(item)}“ (${RARITY_LABELS[item.rarity]}) für ${sellPrice(item)} Gold verkaufen?`,
        'Abbrechen',
        'Verkaufen',
        () => this.completeSale(place, item),
      );
      return;
    }
    this.completeSale(place, item);
  }

  private completeSale(place: Place, item: Item): void {
    const deal = this.ausruestung.sell(place, item.id);
    if (!deal.ok) {
      this.refuse(deal.reason);
      this.render();
      return;
    }
    if (this.held && samePlace(this.held.place, place)) this.held = null;
    this.say(`„${itemName(item)}“ für ${deal.price} Gold verkauft. Im Rückkauf bekommst du ihn zurück.`);
    audio.play('muenze');
    this.render();
  }

  /** Der aufgenommene Gegenstand wird dem Händler hingelegt. */
  private sellHeld(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.offerSale(held.place);
  }

  private activateCommand(): void {
    switch (HAENDLER_COMMANDS[this.cursor]) {
      case 'erneuern':
        this.reroll();
        break;
      case 'normale':
        this.sellNormals();
        break;
    }
  }

  /** Würfelt das Angebot neu: das erste Mal in der Nacht gratis, dann gegen Gold. Was noch dort liegt, geht verloren. */
  private reroll(): void {
    const price = this.ausruestung.nextRerollPrice();
    const deal = this.ausruestung.reroll();
    if (!deal.ok) {
      this.refuse(deal.reason);
      this.render();
      return;
    }
    this.say(price > 0 ? `Das Angebot ist erneuert (${price} Gold).` : 'Das Angebot ist erneuert.');
    audio.play(price > 0 ? 'steigerung' : 'bestaetigen');
    this.render();
  }

  /** Der Ort, den „Normale verkaufen“ meint: das gezeigte Inventar oder der gezeigte Reiter der Truhe. */
  private scope(): Scope {
    return this.tab < 0 ? { kind: 'inventar', classId: this.playerClass.id } : { kind: 'truhe', tab: this.tab };
  }

  /** Verkauft alle normalen Gegenstände des gezeigten Inventars oder Reiters, nach einer Rückfrage mit der Summe. */
  private sellNormals(): void {
    const scope = this.scope();
    const { count, gold } = this.ausruestung.worth(scope, 'normal');
    if (count === 0) {
      this.refuse(this.tab < 0 ? 'Im Inventar liegt nichts Normales.' : 'In diesem Reiter liegt nichts Normales.');
      this.render();
      return;
    }
    const { buybackSize } = CONFIG.items.shop;
    const hint = count > buybackSize ? ` Nur die letzten ${buybackSize} bleiben im Rückkauf.` : '';
    this.ask(
      `${count} normale${count === 1 ? 'n Gegenstand' : ' Gegenstände'} für ${gold} Gold verkaufen?${hint}`,
      'Abbrechen',
      'Verkaufen',
      () => this.completeSellNormals(scope),
    );
  }

  private completeSellNormals(scope: Scope): void {
    const { count, gold } = this.ausruestung.sellAll(scope, 'normal');
    // Was in der Hand lag und mitverkauft wurde, ist nicht mehr da.
    if (this.held && this.ausruestung.itemAt(this.held.place)?.id !== this.held.id) this.held = null;
    this.say(`${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'} für ${gold} Gold verkauft.`);
    audio.play('muenze');
    this.render();
  }

  private activateReiter(): void {
    const { chips, offset } = this;
    if (this.cursor < chips) {
      // Mit einem Gegenstand in der Hand: ab in diesen Reiter. Sonst öffnet er sich nur.
      if (this.held) this.dropIntoTab(this.cursor - offset);
      else this.selectTab(this.cursor - offset);
      return;
    }
    switch (COMMANDS[this.cursor - chips]) {
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
    const deal = this.ausruestung.buyTab();
    if (!deal.ok) {
      this.refuse(deal.reason);
      return;
    }
    this.tab = deal.index;
    // Der Zeiger bleibt auf dem Befehl „Neuer Reiter“, der jetzt eine Stelle weiter rechts steht.
    this.cursor = deal.index + 1;
    this.say(deal.price > 0 ? `Neuer Reiter für ${deal.price} Gold.` : 'Neuer Reiter.');
    audio.play(deal.price > 0 ? 'steigerung' : 'bestaetigen');
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
    this.ask(
      `„${tab.name}“ enthält ${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'}. In die anderen Reiter verschieben und den Reiter löschen?`,
      'Abbrechen',
      'Verschieben und löschen',
      () => this.removeTab(true),
    );
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

  private say(text: string, bad = false): void {
    this.note = text;
    this.noteBad = bad;
    this.view.setNote(text, bad);
  }

  /** Eine Handlung ging nicht: Die Börse zuckt, und die Zeile unten sagt rot, warum. */
  private refuse(text: string): void {
    this.say(text, true);
    this.view.deny();
  }

  /** Die Karte eines Gegenstands, verglichen mit dem, was die gezeigte Klasse davon trägt (nur, was sie auch tragen könnte). */
  private itemDetail(item: Item): DetailView {
    const { id } = this.playerClass;
    const comparable = canEquip(item, id);
    const worn = comparable ? this.ausruestung.equipped(id, item.slot) : null;
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

  private emptyDetail(emptyText: string): DetailView {
    return { item: null, emptyText, compare: null, compareTitle: '' };
  }

  /** Karte zu dem, worauf der Zeiger steht: ein Gegenstand mit Vergleich und Preis, ein leerer Platz oder ein Reiter und Befehl. */
  private detail(): DetailView {
    const { id } = this.playerClass;
    switch (this.zone) {
      case 'reiter':
        return this.reiterDetail();
      case 'befehle':
        return this.befehleDetail();
      case 'ausruestung': {
        const slot = ITEM_SLOTS[this.cursor];
        const item = slot ? this.ausruestung.equipped(id, slot) : null;
        return {
          item: item ? itemView(item, id) : null,
          emptyText: slot ? `${slotLabel(slot, id)}: nichts angelegt.` : '',
          compare: null,
          compareTitle: '',
        };
      }
      case 'angebot':
      case 'rueckkauf': {
        const stand = this.ausruestung.haendler();
        const item = this.zone === 'angebot' ? stand.stock[this.cursor] : stand.buyback[this.cursor];
        if (!item) {
          return this.emptyDetail(
            this.zone === 'angebot'
              ? 'Verkauft. Nach der nächsten Nacht bietet der Händler Neues an, oder du erneuerst das Angebot.'
              : 'Hier liegt, was du dem Händler verkauft hast; du bekommst es für denselben Preis zurück.',
          );
        }
        const price = this.priceOf(this.zone, item);
        const label = this.zone === 'angebot' ? 'Preis' : 'Rückkauf';
        return { ...this.itemDetail(item), price: { text: `${label}: ${price} Gold`, poor: price > this.gold } };
      }
      default: {
        const place = this.placeAt(this.zone, this.cursor);
        const item = place ? this.ausruestung.itemAt(place) : null;
        if (!item) return this.emptyDetail('Leerer Platz.');
        const detail = this.itemDetail(item);
        return this.mode === 'haendler' ? { ...detail, price: { text: `Verkauf: ${sellPrice(item)} Gold`, poor: false } } : detail;
      }
    }
  }

  private befehleDetail(): DetailView {
    switch (HAENDLER_COMMANDS[this.cursor]) {
      case 'erneuern': {
        const price = this.ausruestung.nextRerollPrice();
        const cost = price === 0 ? 'Das erste Mal in einer Nacht ist es gratis' : `Es kostet ${price} Gold, danach das Doppelte`;
        return this.emptyDetail(`Das Angebot neu würfeln; was noch dort liegt, geht verloren. ${cost}.`);
      }
      case 'normale': {
        const { count, gold } = this.ausruestung.worth(this.scope(), 'normal');
        const where = this.tab < 0 ? 'im Inventar' : 'in diesem Reiter';
        return this.emptyDetail(
          count === 0 ? `Alle normalen Gegenstände ${where} verkaufen: hier liegt keiner.` : `Alle normalen Gegenstände ${where} verkaufen: ${count} für ${gold} Gold.`,
        );
      }
      default:
        return this.emptyDetail('');
    }
  }

  private reiterDetail(): DetailView {
    const tabs = this.ausruestung.truhe();
    const { offset, chips } = this;
    if (this.cursor < chips) {
      const hand = 'Enter öffnet ihn; mit einem Gegenstand in der Hand legt Enter ihn hinein.';
      if (this.cursor < offset) {
        const inventory = this.ausruestung.inventory(this.playerClass.id);
        const count = inventory.filter((item) => item !== null).length;
        return this.emptyDetail(`Inventar ${this.playerClass.name}: ${count} von ${inventory.length} Plätzen belegt. ${hand}`);
      }
      const tab = tabs[this.cursor - offset];
      if (!tab) return this.emptyDetail('');
      const count = tab.slots.filter((item) => item !== null).length;
      return this.emptyDetail(`Reiter „${tab.name}“: ${count} von ${tab.slots.length} Plätzen belegt. ${hand}`);
    }
    const current = tabs[this.tab];
    switch (COMMANDS[this.cursor - chips]) {
      case 'neu': {
        const price = this.ausruestung.nextTabPrice();
        if (price === null) return this.emptyDetail(`Mehr als ${CONFIG.items.truhe.maxTabs} Reiter gibt es nicht.`);
        return this.emptyDetail(price === 0 ? 'Einen neuen Reiter anlegen: gratis.' : `Einen neuen Reiter anlegen: ${price} Gold.`);
      }
      case 'umbenennen':
        return this.emptyDetail(`Reiter „${current?.name ?? ''}“ umbenennen.`);
      case 'farbe':
        return this.emptyDetail(`Die Farbe von „${current?.name ?? ''}“ wechseln.`);
      case 'loeschen':
        return this.emptyDetail(
          `Reiter „${current?.name ?? ''}“ löschen. Ein voller Reiter wird vorher in die anderen Reiter geleert; das Spiel fragt nach.`,
        );
      default:
        return this.emptyDetail('');
    }
  }

  /** Wo der aufgenommene Gegenstand auf dem Bildschirm liegt; `null`, wenn dieser Platz gerade nicht zu sehen ist. */
  private heldMark(): Mark | null {
    const held = this.held?.place;
    if (!held) return null;
    const { id } = this.playerClass;
    if (held.kind === 'inventar') {
      if (held.classId !== id) return null;
      // Beim Händler zeigt das Raster des eigenen Besitzes das Inventar nur, solange dessen Reiter offen ist.
      if (this.mode === 'haendler') return this.tab < 0 ? { zone: 'truhe', index: held.index } : null;
      return { zone: 'inventar', index: held.index };
    }
    if (held.kind === 'ausruestung') {
      return held.classId === id && this.mode === 'ausruestung' ? { zone: 'ausruestung', index: ITEM_SLOTS.indexOf(held.slot) } : null;
    }
    return held.tab === this.tab && this.mode !== 'ausruestung' ? { zone: 'truhe', index: held.index } : null;
  }

  /**
   * Das Raster rechts in der Truhe und beim Händler. Die Truhe zeigt ihre Reiter und die Befehle dahinter; beim Händler steht davor
   * das Inventar als erster Reiter (`tab` -1), und es gibt keine Befehle.
   */
  private truheModel(): TruheModel {
    const tabs = this.ausruestung.truhe();
    const { colors } = CONFIG.items.truhe;
    const price = this.ausruestung.nextTabPrice();
    const { id } = this.playerClass;
    const inventory = this.ausruestung.inventory(id);
    const chestTabs = tabs.map((tab) => ({
      name: tab.name,
      color: colors[tab.color] ?? INVENTORY_COLOR,
      count: tab.slots.filter((item) => item !== null).length,
      size: tab.slots.length,
    }));
    const haendler = this.mode === 'haendler';
    const shown = this.tab < 0 ? inventory : (tabs[this.tab]?.slots ?? []);
    return {
      tabs: haendler
        ? [{ name: 'Inventar', color: INVENTORY_COLOR, count: inventory.filter((item) => item !== null).length, size: inventory.length }, ...chestTabs]
        : chestTabs,
      active: this.tab + this.offset,
      slots: shown.map((item) => ({ label: '', icon: null, item: item ? itemView(item, id) : null })),
      commands: haendler
        ? []
        : [
            { label: price === null ? '+ Reiter (voll)' : price === 0 ? '+ Reiter' : `+ Reiter (${price} Gold)`, title: 'Neuen Reiter anlegen' },
            { label: 'Umbenennen', title: 'Den Namen des Reiters ändern' },
            { label: 'Farbe', title: 'Die Farbe des Reiters wechseln' },
            { label: 'Löschen', title: 'Den Reiter löschen' },
          ],
    };
  }

  private haendlerModel(): HaendlerModel {
    const stand = this.ausruestung.haendler();
    const { gold } = this;
    const { id } = this.playerClass;
    const priced = (item: Item | null, price: number): SlotView => ({
      label: '',
      icon: null,
      item: item ? itemView(item, id) : null,
      price: item ? { text: String(price), poor: price > gold } : null,
    });
    const reroll = this.ausruestung.nextRerollPrice();
    return {
      stock: stand.stock.map((item) => priced(item, item ? itemValue(item) : 0)),
      buyback: Array.from({ length: CONFIG.items.shop.buybackSize }, (_, index) => {
        const item = stand.buyback[index] ?? null;
        return priced(item, item ? sellPrice(item) : 0);
      }),
      commands: [
        {
          label: reroll === 0 ? 'Erneuern (gratis)' : `Erneuern (${reroll} Gold)`,
          title: 'Das Angebot neu würfeln; was noch dort liegt, geht verloren',
          poor: reroll > gold,
        },
        { label: 'Normale verkaufen', title: 'Alle normalen Gegenstände im gezeigten Inventar oder Reiter verkaufen', poor: false },
      ],
    };
  }

  /** Zeichnet das Lager neu, etwa nach dem Ablegen oder dem Wechsel der Klasse. */
  private render(): void {
    const { id } = this.playerClass;
    // Der Zeiger darf nach Änderungen (gelöschter Reiter, anderer Reiter) nicht ins Leere zeigen.
    this.tab = Math.max(this.mode === 'haendler' ? -1 : 0, Math.min(this.tab, this.ausruestung.truhe().length - 1));
    this.cursor = Math.min(this.cursor, this.sizeOf(this.zone) - 1);
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
    const dropHint = this.mode === 'haendler' ? 'Enter oder Klick: ablegen, beim Händler verkaufen' : 'Enter oder Klick: ablegen';
    const model: LagerModel = {
      gold: this.gold,
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
      haendler: this.haendlerModel(),
      held: this.heldMark(),
      hand: heldItem ? `In der Hand: ${itemName(heldItem)} (${RARITY_LABELS[heldItem.rarity]}) · ${dropHint} · Esc: zurücklegen` : '',
      note: this.note,
      noteBad: this.noteBad,
      keys: this.mode === 'ausruestung' ? KEYS_EQUIPMENT : this.mode === 'truhe' ? KEYS_TRUHE : KEYS_HAENDLER,
    };
    this.view.show(model);
    // Nach dem Neuzeichnen steht kein Platz mehr markiert; den Zeiger setzen und die Karte neu füllen.
    this.view.setCursor(this.zone, this.cursor);
    this.view.showDetail(this.detail());
  }
}
