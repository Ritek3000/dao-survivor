/**
 * Die dichteste Gruppe von Gegnern in Reichweite: der Ort, auf den Evolutionen werfen, zielen und herabstoßen lassen
 * (Kiefer der Ödnis, Atem der Schattenpilze, Schlinge der Alten Ordnung, Speer der Verschwundenen Sonne, Griff der Alten Tiefe).
 *
 * Wie überall im Kampf entsteht dabei nichts Neues: Die Kandidaten liegen in einem festen Feld, das Ergebnis in `siteX` und `siteZ`.
 */
import type { Enemies, Enemy } from './enemies';

/** So viele Gegner in Reichweite werden höchstens als mögliche Mitte einer Gruppe betrachtet. */
const SLOTS = 48;

export class Crowd {
  /** Die Mitte der Gruppe, die `find` gefunden hat; für den Aufrufer, damit keine Zahlenpaare entstehen. */
  siteX = 0;
  siteZ = 0;

  private readonly members: (Enemy | null)[] = Array.from({ length: SLOTS }, () => null);
  private count = 0;
  private x = 0;
  private z = 0;
  private range = 0;
  private around = 0;
  private near = 0;
  private sumX = 0;
  private sumZ = 0;

  constructor(private readonly enemies: Enemies) {}

  /** Merkt sich Gegner in Reichweite als mögliche Mitte einer Gruppe. */
  private readonly collect = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || enemy.driven || this.count >= SLOTS) return;
    if (Math.hypot(enemy.x - this.x, enemy.z - this.z) > this.range + enemy.type.radius) return;
    this.members[this.count++] = enemy;
  };

  private readonly neighbour = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || enemy.driven) return;
    if (Math.hypot(enemy.x - this.siteX, enemy.z - this.siteZ) > this.around) return;
    this.near++;
    this.sumX += enemy.x;
    this.sumZ += enemy.z;
  };

  /**
   * Die Mitte der dichtesten Gruppe (die meisten Gegner im Umkreis `around`) in `range` Metern um (x, z); das Ergebnis liegt in
   * `siteX` und `siteZ`. Ohne Gegner in Reichweite ist es false.
   */
  find(x: number, z: number, range: number, around: number): boolean {
    this.count = 0;
    this.x = x;
    this.z = z;
    this.range = range;
    this.around = around;
    this.enemies.queryRadius(x, z, range, this.collect);
    let best = 0;
    let bestX = 0;
    let bestZ = 0;
    for (let i = 0; i < this.count; i++) {
      const candidate = this.members[i];
      if (!candidate) continue;
      this.siteX = candidate.x;
      this.siteZ = candidate.z;
      this.near = 0;
      this.sumX = 0;
      this.sumZ = 0;
      this.enemies.queryRadius(candidate.x, candidate.z, around, this.neighbour);
      if (this.near > best) {
        best = this.near;
        // Die Mitte der Gruppe, nicht der eine Gegner, von dem aus gezählt wurde.
        bestX = this.sumX / this.near;
        bestZ = this.sumZ / this.near;
      }
    }
    this.siteX = bestX;
    this.siteZ = bestZ;
    return best > 0;
  }
}
