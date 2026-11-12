/**
 * Eingabe über Aktionen statt über feste Tasten. Das Spiel fragt nur
 * "wohin bewegen?" und "wurde bestätigt?"; ein Gamepad kommt später
 * als weitere Quelle in dieser Klasse dazu, ohne dass die Spiellogik sich ändert.
 */
export type Action = 'pause' | 'mute' | 'confirm' | 'left' | 'right' | 'choice1' | 'choice2' | 'choice3';

export interface MoveVector {
  /** Rechts ist positiv. */
  x: number;
  /** Bildschirm-oben ist positiv. */
  y: number;
}

// Physische Tastenpositionen (event.code), damit QWERTZ und QWERTY gleich funktionieren.
const MOVE_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

// Eine Taste darf zugleich bewegen und eine Aktion auslösen: Links und Rechts blättern in Menüs.
const ACTION_KEYS: Readonly<Record<string, Action>> = {
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Digit1: 'choice1',
  Numpad1: 'choice1',
  Digit2: 'choice2',
  Numpad2: 'choice2',
  Digit3: 'choice3',
  Numpad3: 'choice3',
};

export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<Action>();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Bewegungsrichtung mit Länge höchstens 1, damit diagonal nicht schneller ist. */
  getMove(out: MoveVector): MoveVector {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const axis = MOVE_KEYS[code];
      if (axis) {
        x += axis[0];
        y += axis[1];
      }
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Wahr in dem Frame, in dem die Aktion ausgelöst wurde. */
  wasPressed(action: Action): boolean {
    return this.pressed.has(action);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const isMove = event.code in MOVE_KEYS;
    const action = ACTION_KEYS[event.code];
    if (!isMove && !action) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isMove) this.held.add(event.code);
    if (action) this.pressed.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  // Ohne das bliebe eine Taste "gedrückt", wenn das Fenster den Fokus verliert.
  private readonly onBlur = (): void => {
    this.held.clear();
  };
}
