/**
 * Die Menüs, die ein Knopfdruck bedient: Pause, Optionen und Rückfragen (später auch der Startbildschirm).
 *
 * Jedes Menü ist ein Overlay in index.html. Jeder Eintrag darin trägt `data-item` und ist mit Maus oder Tasten
 * anwählbar; trägt er `data-command`, löst er beim Anklicken oder mit Enter einen `MenuCommand` aus. Was daraus folgt,
 * entscheidet das Spiel (`Game.onMenuCommand`); dieser Teil kennt keine Spielregeln. Die Tasten kommen von dort
 * über `step`, `adjust` und `activate`, damit die Eingabe an einer Stelle bleibt (`core/input.ts`).
 */

import type { Volumes } from '../audio';
import { VITALS_POSITIONS, type VitalsPosition } from '../core/settings';
import { element } from './dom';

/** Was ein Knopf in einem Menü auslöst. */
export type MenuCommand = 'resume' | 'options' | 'abort' | 'back' | 'yes' | 'no';

export type MenuScreen = 'pause' | 'options' | 'confirm';

/** Eine Rückfrage mit zwei Antworten; `no` ist die sichere und steht vorn und vorgewählt. */
export interface ConfirmView {
  title: string;
  text: string;
  no: string;
  yes: string;
}

/** Die Namen der Stellen für die Lebensgruppe, wie sie im Menü stehen. */
export const VITALS_POSITION_LABELS: Readonly<Record<VitalsPosition, string>> = {
  'top-left': 'Oben links',
  'top-right': 'Oben rechts',
  'bottom-left': 'Unten links',
  'bottom-center': 'Unten Mitte',
  'bottom-right': 'Unten rechts',
};

/** So viel Prozent verstellen Links und Rechts einen Tonregler. */
const SLIDER_STEP = 5;

type SliderRow = 'master' | 'effects' | 'music';

export class Menus {
  /** Wird aufgerufen, wenn ein Knopf angeklickt oder mit Enter ausgelöst wird. */
  onCommand: (command: MenuCommand) => void = () => {};
  /** Wird aufgerufen, wenn ein Tonregler oder das Häkchen "Ton aus" geändert wird. */
  onSound: (volumes: Volumes) => void = () => {};
  onVitalsPosition: (position: VitalsPosition) => void = () => {};

  private readonly roots: Readonly<Record<MenuScreen, HTMLElement>> = {
    pause: element('pause'),
    options: element('options'),
    confirm: element('confirm'),
  };
  private readonly sliders: Readonly<Record<SliderRow, HTMLInputElement>> = {
    master: element<HTMLInputElement>('vol-master'),
    effects: element<HTMLInputElement>('vol-effects'),
    music: element<HTMLInputElement>('vol-music'),
  };
  private readonly sliderValues: Readonly<Record<SliderRow, HTMLElement>> = {
    master: element('vol-master-value'),
    effects: element('vol-effects-value'),
    music: element('vol-music-value'),
  };
  private readonly muteBox = element<HTMLInputElement>('vol-mute');
  private readonly spots = [...element('position-picker').querySelectorAll<HTMLButtonElement>('.spot')];
  private readonly positionName = element('position-name');
  private readonly confirmTitle = element('confirm-title');
  private readonly confirmText = element('confirm-text');
  private readonly confirmNo = element('confirm-no');
  private readonly confirmYes = element('confirm-yes');
  private current: MenuScreen | null = null;
  private selected = 0;
  private position: VitalsPosition = 'top-left';

  constructor() {
    for (const root of Object.values(this.roots)) {
      for (const item of root.querySelectorAll<HTMLElement>('[data-item]')) {
        // Die Maus setzt die Markierung dorthin, wo sie steht; die Tasten führen von dort weiter.
        item.addEventListener('pointerenter', () => this.markItem(item));
      }
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-command]')) {
        button.addEventListener('click', () => {
          // Der Fokus bliebe sonst am Knopf hängen; Enter und Leertaste gehören aber dem Spiel.
          button.blur();
          this.onCommand(button.dataset.command as MenuCommand);
        });
      }
    }
    for (const control of [...Object.values(this.sliders), this.muteBox]) {
      control.addEventListener('input', () => this.onSound(this.readSound()));
      // Der Fokus bliebe sonst am Regler hängen; die Pfeiltasten gehören aber dem Spiel.
      control.addEventListener('change', () => control.blur());
    }
    for (const spot of this.spots) {
      spot.addEventListener('click', () => {
        spot.blur();
        const position = VITALS_POSITIONS.find((candidate) => candidate === spot.dataset.position);
        if (position) this.onVitalsPosition(position);
      });
    }
  }

  /** Das gerade offene Menü; `null`, wenn keines offen ist. */
  get screen(): MenuScreen | null {
    return this.current;
  }

  showPause(): void {
    this.show('pause', 0);
  }

  /** `solid`: undurchsichtiger Grund, wenn dahinter kein Spiel zu sehen sein soll (später: vom Startbildschirm aus). */
  showOptions(solid = false): void {
    this.roots.options.classList.toggle('solid', solid);
    this.show('options', 0);
  }

  showConfirm(view: ConfirmView): void {
    this.confirmTitle.textContent = view.title;
    this.confirmText.textContent = view.text;
    this.confirmNo.textContent = view.no;
    this.confirmYes.textContent = view.yes;
    this.show('confirm', 0);
  }

  hide(): void {
    for (const root of Object.values(this.roots)) root.hidden = true;
    this.current = null;
  }

  /** Zeigt die Reglerstellungen, auch wenn sie über die Taste M geändert wurden. */
  showSound(volumes: Readonly<Volumes>): void {
    for (const row of ['master', 'effects', 'music'] as const) {
      const percent = Math.round(volumes[row] * 100);
      this.sliders[row].value = String(percent);
      this.sliderValues[row].textContent = `${percent} %`;
    }
    this.muteBox.checked = volumes.muted;
  }

  /** Markiert die gewählte Stelle der Lebensgruppe im Menü. */
  showVitalsPosition(position: VitalsPosition): void {
    this.position = position;
    this.positionName.textContent = VITALS_POSITION_LABELS[position];
    for (const spot of this.spots) {
      const on = spot.dataset.position === position;
      spot.classList.toggle('selected', on);
      spot.setAttribute('aria-checked', String(on));
    }
  }

  /** Setzt die Markierung um `delta` Einträge weiter (mit Umbruch); gibt zurück, ob sie sich bewegt hat. */
  step(delta: number): boolean {
    const count = this.items().length;
    if (count < 2) return false;
    this.setSelected((this.selected + delta + count) % count);
    return true;
  }

  /** Links und Rechts: verstellt Regler und Stelle der Lebensgruppe, wählt in der Rückfrage; gibt zurück, ob sich etwas getan hat. */
  adjust(delta: number): boolean {
    if (this.current === 'confirm') return this.step(delta);
    if (this.current !== 'options') return false;
    const row = this.items()[this.selected]?.dataset.row;
    switch (row) {
      case 'master':
      case 'effects':
      case 'music': {
        const slider = this.sliders[row];
        const next = Math.min(100, Math.max(0, Number(slider.value) + delta * SLIDER_STEP));
        if (next === Number(slider.value)) return false;
        slider.value = String(next);
        this.onSound(this.readSound());
        return true;
      }
      case 'mute':
        this.muteBox.checked = !this.muteBox.checked;
        this.onSound(this.readSound());
        return true;
      case 'position': {
        const count = VITALS_POSITIONS.length;
        const at = VITALS_POSITIONS.indexOf(this.position);
        const next = VITALS_POSITIONS[(at + delta + count) % count];
        if (!next) return false;
        this.onVitalsPosition(next);
        return true;
      }
      default:
        return false;
    }
  }

  /** Enter: löst den markierten Knopf aus, schaltet "Ton aus" um oder rückt die Stelle der Lebensgruppe weiter. */
  activate(): void {
    const item = this.items()[this.selected];
    if (!item) return;
    if (item.dataset.command) item.click();
    else if (item.dataset.row === 'mute' || item.dataset.row === 'position') this.adjust(1);
  }

  private show(screen: MenuScreen, selected: number): void {
    for (const [id, root] of Object.entries(this.roots)) root.hidden = id !== screen;
    this.current = screen;
    this.setSelected(selected);
  }

  private items(): HTMLElement[] {
    if (!this.current) return [];
    return [...this.roots[this.current].querySelectorAll<HTMLElement>('[data-item]')].filter((item) => !item.hidden);
  }

  private setSelected(index: number): void {
    this.selected = index;
    for (const [at, item] of this.items().entries()) item.classList.toggle('selected', at === index);
  }

  private markItem(item: HTMLElement): void {
    const index = this.items().indexOf(item);
    if (index >= 0 && index !== this.selected) this.setSelected(index);
  }

  private readSound(): Volumes {
    return {
      master: Number(this.sliders.master.value) / 100,
      effects: Number(this.sliders.effects.value) / 100,
      music: Number(this.sliders.music.value) / 100,
      muted: this.muteBox.checked,
    };
  }
}
