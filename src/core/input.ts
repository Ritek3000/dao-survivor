/**
 * Eingabe über Aktionen statt über feste Tasten. Das Spiel fragt nur
 * "wohin bewegen?" und "wurde bestätigt?"; ein Gamepad kommt später
 * als weitere Quelle in dieser Klasse dazu, ohne dass die Spiellogik sich ändert.
 */
export type Action =
  | 'pause'
  | 'mute'
  | 'confirm'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  /** Öffnet das Lager mit Ausrüstung, Truhe und Händler (Menü zwischen den Nächten). */
  | 'lager'
  /** Im Lager: den markierten Gegenstand gleich anlegen oder wegräumen, ohne ihn erst aufzunehmen (in der Truhe: zwischen Inventar und Truhe umräumen). */
  | 'use'
  /** Im Lager: das gezeigte Inventar oder den gezeigten Reiter der Truhe sortieren; jeder Druck wechselt zwischen Art und Seltenheit. */
  | 'sort'
  /**
   * Im Lager: den Gegenstand unter dem Zeiger zum Verkauf markieren oder die Markierung zurücknehmen (der Händler verkauft alle markierten
   * auf einmal). Löst die Leertaste aus, die zugleich `confirm` auslöst; das Lager nimmt sie nur als Markierung, wo es etwas zu markieren gibt.
   */
  | 'mark'
  /** Im Lager: zwischen Ausrüstung, Truhe und Händler wechseln. */
  | 'switch'
  /** Beim Stufenaufstieg: die Karten neu würfeln. */
  | 'reroll'
  /** Beim Stufenaufstieg: eine Karte bis zum Ende der Nacht aus dem Angebot streichen. */
  | 'banish'
  /** Bei der Wahl der Nachtart: den Grad der gewählten Nacht um eins erhöhen oder senken (neben Pfeil hoch und runter). */
  | 'gradeUp'
  | 'gradeDown'
  /** Bei der Klassenwahl: das Aussehen der gewählten Klasse wechseln (Mann oder Frau). */
  | 'look'
  /** Die Karten einer Auswahl der Reihe nach; sieben gibt es bei der Wahl des Startangriffs. */
  | 'choice1'
  | 'choice2'
  | 'choice3'
  | 'choice4'
  | 'choice5'
  | 'choice6'
  | 'choice7';

/** Die Wahlaktionen in der Reihenfolge der Karten. */
export const CHOICE_ACTIONS: readonly Action[] = ['choice1', 'choice2', 'choice3', 'choice4', 'choice5', 'choice6', 'choice7'];

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

// Eine Taste darf zugleich bewegen und eine Aktion auslösen: Die Richtungen blättern in Menüs.
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
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  // U war die Taste der Steigerungen; wer sie gewohnt ist, landet nun im Lager (beim Händler gibt man das Gold aus).
  KeyU: 'lager',
  KeyL: 'lager',
  KeyE: 'use',
  // O wie „ordnen“: S wie „sortieren“ bewegt schon.
  KeyO: 'sort',
  KeyR: 'reroll',
  KeyX: 'banish',
  KeyF: 'look',
  Tab: 'switch',
  Digit1: 'choice1',
  Numpad1: 'choice1',
  Digit2: 'choice2',
  Numpad2: 'choice2',
  Digit3: 'choice3',
  Numpad3: 'choice3',
  Digit4: 'choice4',
  Numpad4: 'choice4',
  Digit5: 'choice5',
  Numpad5: 'choice5',
  Digit6: 'choice6',
  Numpad6: 'choice6',
  Digit7: 'choice7',
  Numpad7: 'choice7',
};

// Weitere Aktionen, die eine Taste neben ihrer eigenen auslöst: Die Leertaste bestätigt überall wie Enter und markiert im Lager außerdem
// einen Gegenstand zum Verkauf. Welche der beiden gilt, entscheidet die Stelle, die fragt (siehe `Lager.update`).
const ALSO_KEYS: Readonly<Record<string, Action>> = {
  Space: 'mark',
};

// Die Zeichen + und - liegen je nach Tastatur an anderer Stelle (und am Ziffernblock); darum zählt für sie das Zeichen, nicht die Taste.
const CHAR_ACTIONS: Readonly<Record<string, Action>> = {
  '+': 'gradeUp',
  '-': 'gradeDown',
};

/** Ist das Ziel eines Tastendrucks ein Feld, in das man Text schreibt? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === 'text') || target.isContentEditable;
}

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
    // Tippt jemand in ein Eingabefeld (etwa den Namen eines Reiters der Truhe), gehören die Tasten dem Feld und nicht dem Spiel.
    if (isTypingTarget(event.target)) return;
    const isMove = event.code in MOVE_KEYS;
    const action = ACTION_KEYS[event.code] ?? CHAR_ACTIONS[event.key];
    if (!isMove && !action) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isMove) this.held.add(event.code);
    if (action) this.pressed.add(action);
    const also = ALSO_KEYS[event.code];
    if (also) this.pressed.add(also);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  // Ohne das bliebe eine Taste "gedrückt", wenn das Fenster den Fokus verliert.
  private readonly onBlur = (): void => {
    this.held.clear();
  };
}
