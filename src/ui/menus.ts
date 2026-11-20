/**
 * Die Menüs, die ein Knopfdruck bedient: Startbildschirm, Pause, Optionen, Anleitung und Rückfragen.
 *
 * Jedes Menü ist ein Overlay in index.html. Jeder Eintrag darin trägt `data-item` und ist mit Maus oder Tasten
 * anwählbar; trägt er `data-command`, löst er beim Anklicken oder mit Enter einen `MenuCommand` aus. Was daraus folgt,
 * entscheidet das Spiel (`Game.onMenuCommand`); dieser Teil kennt keine Spielregeln. Die Tasten kommen von dort
 * über `step`, `adjust` und `activate`, damit die Eingabe an einer Stelle bleibt (`core/input.ts`).
 */

import type { Volumes } from '../audio';
import type { Auswertung } from '../core/auswertung';
import { VITALS_POSITIONS, type VitalsPosition } from '../core/settings';
import { element } from './dom';
import { StatistikView } from './statistikView';

/** Was ein Knopf in einem Menü auslöst. */
export type MenuCommand =
  | 'new'
  | 'continue'
  | 'options'
  | 'stats'
  | 'help'
  | 'resume'
  | 'abort'
  | 'back'
  | 'yes'
  | 'no'
  | 'save-export'
  | 'save-import';

export type MenuScreen = 'title' | 'pause' | 'options' | 'stats' | 'help' | 'confirm';

/** Eine Rückfrage mit zwei Antworten; `no` ist die sichere und steht vorn und vorgewählt. Ohne `yes` ist es ein Hinweis mit einem Knopf. */
export interface ConfirmView {
  title: string;
  text: string;
  no: string;
  yes?: string;
  /** Ist `yes` ein Schritt, den man bereuen kann (rot gefärbt)? Ohne Angabe ja. */
  danger?: boolean;
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

/** Um diesen Anteil der Fensterhöhe blättern Auf und Ab die Anleitung. */
const HELP_SCROLL_SHARE = 0.4;

type SliderRow = 'master' | 'effects' | 'music';

export class Menus {
  /** Wird aufgerufen, wenn ein Knopf angeklickt oder mit Enter ausgelöst wird. */
  onCommand: (command: MenuCommand) => void = () => {};
  /** Wird aufgerufen, wenn ein Tonregler oder das Häkchen "Ton aus" geändert wird. */
  onSound: (volumes: Volumes) => void = () => {};
  /** Wird aufgerufen, wenn das Häkchen für die anonyme Statistik geändert wird. */
  onShare: (share: boolean) => void = () => {};
  onVitalsPosition: (position: VitalsPosition) => void = () => {};

  private readonly roots: Readonly<Record<MenuScreen, HTMLElement>> = {
    title: element('title'),
    pause: element('pause'),
    options: element('options'),
    stats: element('stats'),
    help: element('help'),
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
  private readonly stats = new StatistikView(element('stats-view'), element('stats'));
  private readonly muteBox = element<HTMLInputElement>('vol-mute');
  private readonly shareBox = element<HTMLInputElement>('data-share');
  /** Der Knopf zum Laden eines Spielstands und sein Ersatzhinweis; geladen wird nur im Hauptmenü (siehe `showOptions`). */
  private readonly importButton = element<HTMLButtonElement>('save-import');
  private readonly importHint = element('save-import-hint');
  private readonly spots = [...element('position-picker').querySelectorAll<HTMLButtonElement>('.spot')];
  private readonly positionName = element('position-name');
  private readonly continueButton = element('title-continue');
  private readonly confirmTitle = element('confirm-title');
  private readonly confirmText = element('confirm-text');
  private readonly confirmNo = element('confirm-no');
  private readonly confirmYes = element('confirm-yes');
  private current: MenuScreen | null = null;
  private selected = 0;
  /** Die zuletzt markierte Zeile je Menü, damit man nach Optionen oder Anleitung dort weitermacht, wo man war. */
  private readonly lastSelected: Partial<Record<MenuScreen, number>> = {};
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
    this.shareBox.addEventListener('input', () => this.onShare(this.shareBox.checked));
    this.shareBox.addEventListener('change', () => this.shareBox.blur());
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

  /**
   * Der Startbildschirm; "Spiel fortsetzen" gibt es nur, wenn es einen Spielstand gibt, und dann ist er vorgewählt.
   * `back`: man kommt von einer Unterseite zurück; die Markierung bleibt, wo sie war.
   */
  showTitle(canContinue: boolean, back = false): void {
    this.continueButton.hidden = !canContinue;
    this.show('title', canContinue ? 1 : 0, back);
  }

  showPause(back = false): void {
    this.show('pause', 0, back);
  }

  showHelp(): void {
    this.show('help', 0);
    this.roots.help.scrollTop = 0;
  }

  /** Die Statistik, ausgerechnet aus dem Protokoll der Nächte (siehe `core/statistik.ts`); undurchsichtig, denn dahinter liegt kein Spiel. */
  showStats(data: Auswertung): void {
    this.stats.show(data);
    this.show('stats', 0, false, true);
    this.roots.stats.scrollTop = 0;
  }

  /**
   * Auf und Ab blättern die Anleitung und die Statistik: Sie sind länger als mancher Bildschirm, und die Pfeiltasten gehören dem Spiel,
   * scrollen also nicht von allein. `direction` ist -1 (hoch) oder 1 (runter); gibt zurück, ob es etwas zu blättern gab.
   */
  scrollPage(direction: -1 | 1): boolean {
    if (this.current !== 'help' && this.current !== 'stats') return false;
    const page = this.roots[this.current];
    if (page.scrollHeight <= page.clientHeight) return false;
    page.scrollBy({ top: direction * page.clientHeight * HELP_SCROLL_SHARE, behavior: 'smooth' });
    return true;
  }

  /**
   * `fromTitle`: Die Optionen kommen vom Startbildschirm; dahinter ist kein Spiel zu sehen (undurchsichtiger Grund), und einen Spielstand
   * laden darf man nur hier: Mitten in der Nacht schriebe der laufende Lauf später über den geladenen Stand.
   */
  showOptions(fromTitle = false): void {
    this.importButton.hidden = !fromTitle;
    this.importHint.hidden = fromTitle;
    this.show('options', 0, false, fromTitle);
  }

  showConfirm(view: ConfirmView, solid = false): void {
    this.confirmTitle.textContent = view.title;
    this.confirmText.textContent = view.text;
    this.confirmNo.textContent = view.no;
    this.confirmYes.hidden = view.yes === undefined;
    this.confirmYes.textContent = view.yes ?? '';
    this.confirmYes.classList.toggle('danger', view.danger !== false);
    this.show('confirm', 0, false, solid);
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

  /** Zeigt das Häkchen für die anonyme Statistik; beim Start kommt es aus den Einstellungen. */
  showShare(share: boolean): void {
    this.shareBox.checked = share;
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

  /** Links und Rechts: verstellt Regler und Stelle der Lebensgruppe, wählt in der Rückfrage und den Reiter der Statistik; gibt zurück, ob sich etwas getan hat. */
  adjust(delta: number): boolean {
    if (this.current === 'confirm') return this.step(delta);
    if (this.current === 'stats') return this.stats.stepTab(delta);
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
      case 'share':
        this.shareBox.checked = !this.shareBox.checked;
        this.onShare(this.shareBox.checked);
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

  /** Enter: löst den markierten Knopf aus, schaltet "Ton aus" oder die anonyme Statistik um oder rückt die Stelle der Lebensgruppe weiter. */
  activate(): void {
    const item = this.items()[this.selected];
    if (!item) return;
    if (item.dataset.command) item.click();
    else if (item.dataset.row === 'mute' || item.dataset.row === 'share' || item.dataset.row === 'position') this.adjust(1);
  }

  private show(screen: MenuScreen, selected: number, restore = false, solid = false): void {
    for (const [id, root] of Object.entries(this.roots)) root.hidden = id !== screen;
    this.roots[screen].classList.toggle('solid', solid);
    this.current = screen;
    const last = restore ? this.lastSelected[screen] : undefined;
    this.setSelected(Math.min(last ?? selected, this.items().length - 1));
  }

  private items(): HTMLElement[] {
    if (!this.current) return [];
    return [...this.roots[this.current].querySelectorAll<HTMLElement>('[data-item]')].filter((item) => !item.hidden);
  }

  private setSelected(index: number): void {
    this.selected = index;
    if (this.current) this.lastSelected[this.current] = index;
    for (const [at, item] of this.items().entries()) item.classList.toggle('selected', at === index);
    // Auf kleinen Bildschirmen reichen die Optionen über den Rand; die Auswahl per Tasten soll dort bleiben, wo man sie sieht.
    if (this.current === 'options') this.items()[index]?.scrollIntoView({ block: 'nearest' });
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
