import { AudioEngine } from './engine';

/** Der Ton des Spiels. Es gibt nur einen; ohne geladene Klänge sind alle Aufrufe wirkungslos. */
export const audio = new AudioEngine();

export type { LoopId, MusicId, SoundId } from './ids';
export type { Duck, Volumes } from './engine';
