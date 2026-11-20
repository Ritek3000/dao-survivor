/**
 * Der Seed eines Laufs: Aus ihm ziehen Gegner, Schwaden, Beute und Angebote ihren Zufall (siehe `deriveSeed`). Die Welt
 * selbst bleibt davon unberührt; sie wächst aus `CONFIG.world.seed`. Wer den Seed eines Laufs kennt, kann ihn wiederholen:
 * Gegner und Angebote kommen in derselben Folge, auch wenn die Figur andere Wege geht.
 */

/** Ein Seed ist eine Zahl von 0 bis 2^32 - 1; als Text steht sie im Zahlensystem zur Basis 36 (höchstens sieben Zeichen). */
const BASE = 36;
const MAX_LENGTH = 7;

/** Ein neuer Seed aus der Uhrzeit. */
export function newRunSeed(): number {
  // Die Millisekunden allein wären gut zu erraten; die Feinzeit der Seite kommt dazu. Gemischt wird beim Ableiten.
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
}

/** So steht der Seed im Endbild, etwa "1Z141Z3". */
export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(BASE).toUpperCase();
}

/** Liest einen Seed aus dem Text; `null`, wenn es keiner ist. */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH || !/^[0-9a-z]+$/i.test(trimmed)) return null;
  const value = parseInt(trimmed, BASE);
  return Number.isFinite(value) && value <= 0xffffffff ? value : null;
}

/** Ein Seed, den die Adresse vorgibt (`?seed=1Z141Z3`); `null` ohne Angabe. Ohne Adresszeile (etwa in einer Hülle) bleibt es dabei. */
export function seedFromAddress(): number | null {
  try {
    const text = new URLSearchParams(window.location.search).get('seed');
    return text === null ? null : parseSeed(text);
  } catch {
    return null;
  }
}
