/**
 * Gleichmäßiges Gitter für Nachbarschaftsabfragen auf der Bodenebene.
 * Einträge liegen in der Zelle ihres Mittelpunkts; wer nach Kreisen sucht,
 * vergrößert den Suchradius um den größten vorkommenden Radius.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();

  constructor(private readonly cellSize: number) {}

  /** Leert alle Zellen, behält aber deren Speicher für den nächsten Frame. */
  clear(): void {
    for (const cell of this.cells.values()) cell.length = 0;
  }

  insert(x: number, z: number, item: T): void {
    const key = cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(item);
  }

  /** Besucht alle Einträge aus den Zellen, die das Quadrat um den Kreis berühren. */
  query(x: number, z: number, radius: number, visit: (item: T) => void): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const cell = this.cells.get(cellKey(cellX, cellZ));
        if (cell) for (const item of cell) visit(item);
      }
    }
  }
}

function cellKey(cellX: number, cellZ: number): number {
  return (cellX + 4096) * 8192 + (cellZ + 4096);
}
