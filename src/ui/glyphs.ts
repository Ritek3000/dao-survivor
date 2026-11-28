/**
 * Kleine Zeichen der Oberfläche des Lagers (Münze, Befehle der Truhe und des Händlers, Sortieren), 24 × 24, nur Linien. Die Farbe kommt
 * vom Text ringsum (`currentColor`); so passt ein Zeichen zu jedem Zustand (golden, rot, gedämpft), ohne eine Datei zu laden.
 * Die Gegenstände haben eigene Zeichen und Bilder (`itemIcons.ts`).
 */
export type GlyphId = 'coin' | 'plus' | 'pencil' | 'drop' | 'trash' | 'refresh' | 'lock' | 'tag' | 'gem';

const GLYPHS: Readonly<Record<GlyphId, string>> = {
  coin: '<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.16"/><circle cx="12" cy="12" r="5.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M4.5 19.5 5.6 15 16 4.6 19.4 8 9 18.4z"/><path d="M13.6 7 17 10.4"/>',
  drop: '<path d="M12 3.5c3.4 4 6 6.8 6 10.5a6 6 0 0 1-12 0c0-3.7 2.6-6.5 6-10.5z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5.5M14 11v5.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.8h-4.8"/>',
  lock: '<rect x="6" y="11" width="12" height="9" rx="1.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  // Sortieren: das Schild steht für die Art, der Edelstein für die Seltenheit.
  tag: '<path d="M3.5 4.5h8l9 9-8 8-9-9z"/><circle cx="8" cy="9" r="1.3"/>',
  gem: '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11M14.5 4 16 9l-4 11"/>',
};

/** Das Zeichen als Markup; die Pfade oben sind feste Zeichenketten, keine Eingaben. */
export function glyphMarkup(id: GlyphId): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[id]}</svg>`;
}

export function glyphElement(id: GlyphId): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = `glyph glyph-${id}`;
  node.innerHTML = glyphMarkup(id);
  return node;
}
