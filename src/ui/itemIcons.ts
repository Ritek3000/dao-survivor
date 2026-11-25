import type { ClassId } from '../game/classes';
import { ITEM_SLOTS, type ItemSlot } from '../game/items';

/** Welches Zeichen ein Gegenstand trägt: der Platz, bei Waffe und Fackel nach Klasse. */
export type ItemIconId = Exclude<ItemSlot, 'waffe'> | 'axt' | 'bogen' | 'buch' | 'kerze';

export function itemIconId(slot: ItemSlot, classId?: ClassId): ItemIconId {
  if (slot === 'waffe') return classId === 'wildnislaeufer' ? 'bogen' : classId === 'magier' ? 'buch' : 'axt';
  if (slot === 'fackel' && classId === 'magier') return 'kerze';
  return slot;
}

/**
 * Selbst gezeichnete Zeichen, 24 × 24, nur Linien: Die Farbe kommt von der Seltenheit (`currentColor`). Sie stehen für leere
 * Plätze der Ausrüstung und springen für ein Bild ein, das nicht geladen werden kann.
 */
const ICONS: Readonly<Record<ItemIconId, string>> = {
  fackel:
    '<path d="M12 2c2 3 4 4.5 4 7a4 4 0 0 1-8 0c0-1.5.8-2.5 1.6-3.6C10 6.5 11 5 12 2z"/><path d="M10 14h4l-.8 8h-2.4z"/>',
  kerze: '<path d="M12 2.5c1.6 2 2 3.2 0 5-2-1.8-1.6-3 0-5z"/><rect x="9" y="9" width="6" height="12" rx="1"/><path d="M7 21h10"/>',
  helm: '<path d="M4 16a8 8 0 0 1 16 0v3H4z"/><path d="M4 19h16M12 8v6M8.5 16h7"/>',
  guertel: '<rect x="2.5" y="9.5" width="19" height="5" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/>',
  axt: '<path d="M6.5 21.5 15.5 4"/><path d="M13 4c3.5-1.5 6.5-.5 8 2.5-3 2-6 2-8.5.5z"/>',
  bogen: '<path d="M6 3c9 3 9 15 0 18z"/><path d="M6 12h14M16.5 8.5 20 12l-3.5 3.5"/>',
  buch: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"/><path d="M12 6v13"/>',
  handschuh: '<path d="M7 21v-6l-2-4 1.5-1 2 2V5h2v6h1V4h2v7h1V5.5h2V12h1V9l1.5.5V16l-2 5z"/>',
  schuh: '<path d="M6 3h6v9l8 3v4H6z"/><path d="M6 19h14"/>',
  ring: '<circle cx="12" cy="15" r="6"/><path d="M9.5 7.5 12 3l2.5 4.5-2.5 1.5z"/>',
  brust: '<path d="M7 4 3 7.5v5.5l3 1V21h12v-7l3-1V7.5L17 4l-2.5 2h-5z"/>',
  amulett: '<path d="M5 3l7 9 7-9"/><circle cx="12" cy="16.5" r="4"/>',
};

/** Das SVG-Zeichen als Markup; die Pfade oben sind feste Zeichenketten, keine Eingaben. */
function iconMarkup(id: ItemIconId): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id]}</svg>`;
}

/** Das Umrisszeichen eines Platzes: für leere Plätze der Ausrüstung. */
export function iconElement(id: ItemIconId): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'icon';
  node.innerHTML = iconMarkup(id);
  return node;
}

/**
 * Welches Bild ein Gegenstand trägt: sein Platz und der Stil einer Klasse. Fackel, Waffe und legendärer Ring gehören einer
 * Klasse und tragen ihren Stil; alles andere kann jede Klasse tragen und zeigt den Stil der Klasse, deren Lager offen ist
 * (siehe `game/lager.ts`).
 */
export interface ItemImage {
  slot: ItemSlot;
  look: ClassId;
}

/**
 * Adresse eines Bildes; über BASE_URL, damit der Build mit relativen Pfaden läuft (siehe CLAUDE.md, „Zielplattform offen“).
 * Der Ordner heißt bewusst nicht `icons`: Viele Webserver legen `/icons/` selbst auf ihre eigenen Symbole (Apache-Standard).
 * Liegt die Seite in der Wurzel einer eigenen Domäne, kämen die Bilder dort nie an und das Lager zeigte nur die Umrisszeichen.
 */
export function itemImageUrl({ slot, look }: ItemImage): string {
  return `${import.meta.env.BASE_URL}bilder/items/${slot}-${look}.webp`;
}

/** Das Bild eines Gegenstands; lässt es sich nicht laden, tritt das Umrisszeichen `fallback` an seine Stelle. */
export function itemImageElement(image: ItemImage, fallback: ItemIconId): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'icon picture';
  const picture = document.createElement('img');
  picture.alt = '';
  picture.draggable = false;
  picture.decoding = 'async';
  picture.addEventListener('error', () => {
    node.className = 'icon';
    node.innerHTML = iconMarkup(fallback);
  });
  picture.src = itemImageUrl(image);
  node.append(picture);
  return node;
}

/** Lädt alle Bilder einmal vor, damit sie beim ersten Öffnen des Lagers ohne Verzögerung stehen (zusammen rund 0,5 MB). */
export function preloadItemImages(looks: readonly ClassId[]): void {
  for (const slot of ITEM_SLOTS) {
    for (const look of looks) new Image().src = itemImageUrl({ slot, look });
  }
}
