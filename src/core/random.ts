export type Random = () => number;

/** Deterministischer Zufall (mulberry32): gleicher Seed, gleiche Welt. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Leitet aus einem Seed einen zweiten ab, der mit ihm nichts gemein hat. `salt` unterscheidet die Ströme eines Laufs
 * (Gegner, Schwaden, Beute, Angebote). Ohne das Mischen glichen sich die Ströme benachbarter Seeds, und Läufe mit den
 * Seeds 7 und 8 spielten sich fast gleich.
 */
export function deriveSeed(seed: number, salt: number): number {
  let h = Math.imul((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
