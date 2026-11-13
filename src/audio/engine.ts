/**
 * Ton und Musik mit der Web Audio API, ohne Bibliothek.
 *
 * Das Spiel meldet nur Ereignisse (`play('treffer.stahl', x, z)`); welche Datei dazu klingt, steht in
 * public/audio/audio.json (siehe manifest.ts). Die Klänge sind in drei Gruppen geteilt:
 *  - Ereignisse: kurze Töne, bei Bedarf mit Ort (Lautstärke nach Entfernung, Links/Rechts, Dumpfheit in der Finsternis),
 *  - Dauerklänge: Feuer, Wind, Finsternis; das Spiel meldet je Frame, wie laut sie sein sollen,
 *  - Musik: ein Stück zugleich, wird bei Wechsel übergeblendet.
 *
 * Die Finsternis dämpft jeden Laut (finsternis.md): Steht die Spielfigur in ihr oder liegt die Quelle darin,
 * sinkt die Grenzfrequenz eines Tons, seine Lautstärke und seine Reichweite. Auch die Musik wird dumpf.
 *
 * Fehlt etwas (kein AudioContext, keine audio.json, eine Datei), bleibt das Spiel spielbar und der Ton stumm.
 * Für Tonhöhe und Auswahl der Variante wird `Math.random` genutzt: Das ist rein Hörbares und ändert nichts
 * an der Welt, die aus dem Saatwert entsteht.
 */
import { CONFIG } from '../config';
import type { SoundSettings } from '../core/settings';
import type { LoopId, MusicId, SoundId } from './ids';
import { audioUrl, parseManifest, type LoopEntry, type MusicEntry, type SoundEntry } from './manifest';

/** Wie weit die Musik zurückgenommen wird: voll, leiser bei der Wahl einer Stärkung, leise und dumpf in der Pause. */
export type Duck = 'none' | 'choice' | 'paused';

/** Regler wie in den Optionen: 0 bis 1 und Stumm. Dieselben Werte merkt sich `core/settings.ts`. */
export type Volumes = SoundSettings;

interface LoadedSound {
  entry: SoundEntry;
  buffers: AudioBuffer[];
  /** Frühester Zeitpunkt (Zeit des AudioContext) für die nächste Wiedergabe. */
  nextAt: number;
}

interface LoadedMusic {
  entry: MusicEntry;
  buffer: AudioBuffer | null;
}

/** Ein Dauerklang mit seinem Zustand: Er läuft nur, solange er zu hören ist. */
interface LoopState {
  entry: LoopEntry;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  gain: GainNode;
  /** Was das Spiel zuletzt gemeldet hat; gilt nur, wenn es in diesem Frame gemeldet wurde. */
  level: number;
  x: number;
  z: number;
  located: boolean;
  reportedFrame: number;
  /** Seit wann (AudioContext-Zeit) er unhörbar ist; bestimmt, wann er angehalten wird. */
  quietSince: number;
}

/** Eine Stimme: fertig verdrahtete Kette, in die jeder Ton seine Quelle einsteckt. */
interface Voice {
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  endsAt: number;
  priority: number;
}

interface Deck {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Offen: kein Tiefpass. */
const OPEN_CUTOFF = 20000;
/** Ein Regler im unteren Bereich soll schon deutlich leiser machen: Das Ohr hört den Pegel logarithmisch. */
const curve = (value: number): number => value * value;
/** Dauerklänge, die so lange unhörbar sind, werden angehalten (Sekunden). */
const LOOP_IDLE_SECONDS = 1.5;
const LOOP_SILENT = 0.002;
const SMOOTHING = 0.12;
/** So lange (Sekunden) bleibt ein verlangter Ton gültig, während der Kontext aufwacht. */
const PENDING_SECONDS = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class AudioEngine {
  /** Der Messlauf spielt Nächte im Zeitraffer; dafür bleiben Töne und Dauerklänge aus. */
  silenced = false;
  /** Anteil der Finsternis an einem Ort von 0 bis 1; das Spiel setzt die Abfrage. */
  muffleAt: (x: number, z: number) => number = () => 0;
  /** Für die Entwicklung: wie oft ein Ereignis abgespielt wurde, und wie viele Töne verworfen wurden. */
  readonly played = new Map<string, number>();
  dropped = 0;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private readonly voices: Voice[] = [];
  private readonly sounds = new Map<string, LoadedSound>();
  /** Ergebnis der Suche samt Rückfall; `null` heißt: nichts gefunden (nur einmal gemeldet). */
  private readonly resolved = new Map<string, LoadedSound | null>();
  private readonly loops = new Map<string, LoopState>();
  private readonly music = new Map<string, LoadedMusic>();
  private volumes: Volumes = {
    master: CONFIG.audio.defaults.master,
    effects: CONFIG.audio.defaults.effects,
    music: CONFIG.audio.defaults.music,
    muted: false,
  };
  private listenerX = 0;
  private listenerZ = 0;
  private listenerMuffle = 0;
  private duck: Duck = 'none';
  private frame = 0;
  private wantedMusic: MusicId | null = null;
  private startedMusic: MusicId | null = null;
  private deck: Deck | null = null;
  private unlocked = false;
  /** Ruht der Kontext nur, weil der Tab verdeckt ist? Dann weckt ihn die Rückkehr wieder auf. */
  private hiddenSuspend = false;
  /** Ein Ton, der in der kurzen Zeit zwischen erster Eingabe und laufendem Kontext verlangt wurde, etwa die Abendglocke. */
  private pending: { id: SoundId; x?: number; z?: number; at: number } | null = null;
  /** Wird aufgerufen, wenn sich die Regler ändern, etwa über die Taste M. */
  onVolumes: (volumes: Readonly<Volumes>) => void = () => {};

  /** Wahr, sobald Klänge geladen sind und der Browser Ton erlaubt. */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get muted(): boolean {
    return this.volumes.muted;
  }

  getVolumes(): Readonly<Volumes> {
    return this.volumes;
  }

  setVolumes(next: Readonly<Volumes>): void {
    this.volumes = {
      master: clamp(next.master, 0, 1),
      effects: clamp(next.effects, 0, 1),
      music: clamp(next.music, 0, 1),
      muted: next.muted,
    };
    this.applyLevels(0.03);
    this.onVolumes(this.volumes);
  }

  toggleMute(): void {
    this.setVolumes({ ...this.volumes, muted: !this.volumes.muted });
  }

  /**
   * Legt den AudioContext an, liest audio.json und holt alle Klänge. Scheitert etwas, bleibt das Spiel stumm
   * (so weit es fehlt) und läuft weiter; die Gründe stehen in der Konsole.
   * Die Musik der Klassenwahl und der Nacht wird mit erwartet, die übrigen Stücke laden im Hintergrund nach.
   */
  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      console.warn('Audio: Der Browser stellt keinen Ton bereit.', error);
      return;
    }
    this.ctx = ctx;
    this.build(ctx);
    this.watchUnlock(ctx);

    let manifest;
    try {
      const response = await fetch(audioUrl(CONFIG.audio.manifest));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      manifest = parseManifest(await response.json());
    } catch (error) {
      console.warn('Audio: audio.json konnte nicht gelesen werden, das Spiel bleibt stumm.', error);
      return;
    }

    // Jede Datei wird nur einmal geholt, auch wenn mehrere Ereignisse sie nennen.
    const buffers = new Map<string, Promise<AudioBuffer | null>>();
    const fetchBuffer = (file: string): Promise<AudioBuffer | null> => {
      let job = buffers.get(file);
      if (!job) {
        job = this.decode(ctx, file);
        buffers.set(file, job);
      }
      return job;
    };

    const wait: Promise<unknown>[] = [];
    const later: Promise<unknown>[] = [];
    for (const [id, entry] of manifest.sounds) {
      const loaded: LoadedSound = { entry, buffers: [], nextAt: 0 };
      this.sounds.set(id, loaded);
      wait.push(
        Promise.all(entry.files.map(fetchBuffer)).then((list) => {
          loaded.buffers = list.filter((buffer): buffer is AudioBuffer => buffer !== null);
        }),
      );
    }
    for (const [id, entry] of manifest.loops) {
      const state = this.createLoop(ctx, entry);
      this.loops.set(id, state);
      wait.push(
        fetchBuffer(entry.file).then((buffer) => {
          state.buffer = buffer;
        }),
      );
    }
    for (const [id, entry] of manifest.music) {
      const loaded: LoadedMusic = { entry, buffer: null };
      this.music.set(id, loaded);
      const job = fetchBuffer(entry.file).then((buffer) => {
        loaded.buffer = buffer;
      });
      // Klassenwahl und Nacht braucht es gleich; Boss, Spätnacht und das Ende dürfen nachladen.
      (id === 'menue' || id === 'nacht' ? wait : later).push(job);
    }

    const total = wait.length;
    let done = 0;
    onProgress?.(0, total);
    await Promise.all(
      wait.map((job) =>
        job.then(() => {
          onProgress?.(++done, total);
        }),
      ),
    );
    void Promise.all(later);
  }

  /** Ruft ein Ereignis aus. Mit Ort (x, z) in Metern klingt es nach Entfernung und Seite und wird in der Finsternis dumpf. */
  play(id: SoundId, x?: number, z?: number): void {
    const ctx = this.ctx;
    if (!ctx || this.silenced || this.volumes.muted) return;
    if (ctx.state !== 'running') {
      // Die erste Eingabe weckt den Kontext erst einen Augenblick später auf: Was in dieser Zeit verlangt wird, holt `watchUnlock` nach.
      if (this.unlocked && ctx.state === 'suspended') this.pending = { id, x, z, at: performance.now() };
      return;
    }
    const sound = this.resolve(id);
    if (!sound || sound.buffers.length === 0) return;
    const now = ctx.currentTime;
    if (now < sound.nextAt) return;
    const { entry } = sound;

    let level = entry.volume;
    let cutoff = OPEN_CUTOFF;
    let pan = 0;
    if (x !== undefined && z !== undefined) {
      const spatial = this.spatial(x, z, entry.range);
      if (!spatial) return;
      level *= spatial.level;
      cutoff = spatial.cutoff;
      pan = spatial.pan;
    }
    if (level < 0.01) return;

    const voice = this.claim(now, entry.priority);
    if (!voice) {
      this.dropped++;
      return;
    }
    sound.nextAt = now + entry.gap;
    const buffer = sound.buffers[Math.floor(Math.random() * sound.buffers.length)];
    if (!buffer) return;
    const rate = entry.jitter > 0 ? 2 ** (((Math.random() * 2 - 1) * entry.jitter) / 1200) : 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    voice.filter.frequency.value = cutoff;
    voice.pan.pan.value = pan;
    voice.gain.gain.value = level;
    source.connect(voice.filter);
    source.onended = () => source.disconnect();
    source.start();
    voice.source = source;
    voice.endsAt = now + buffer.duration / rate;
    voice.priority = entry.priority;
    this.played.set(id, (this.played.get(id) ?? 0) + 1);
  }

  /**
   * Meldet einen Dauerklang für diesen Frame. `level` von 0 bis 1 ist der Anteil seiner Lautstärke;
   * mit Ort (x, z) nimmt er nach Entfernung ab. Was in einem Frame nicht gemeldet wird, blendet aus.
   */
  loop(id: LoopId, level: number, x?: number, z?: number): void {
    const state = this.loops.get(id);
    if (!state) return;
    state.level = level;
    state.located = x !== undefined && z !== undefined;
    state.x = x ?? 0;
    state.z = z ?? 0;
    state.reportedFrame = this.frame + 1;
  }

  /** Wünscht ein Musikstück (oder Stille mit `null`); der Wechsel geschieht mit Überblendung. */
  setMusic(id: MusicId | null): void {
    this.wantedMusic = id;
  }

  /** Nimmt die Musik zurück, etwa in der Pause; die Werte stehen in der Konfiguration. */
  setDuck(duck: Duck): void {
    this.duck = duck;
  }

  /**
   * Einmal je Frame: Standort der Spielfigur als Ohr, Anteil der Finsternis dort, und was sich daraus für
   * Musik, Dauerklänge und Lautstärke ergibt.
   */
  update(x: number, z: number, muffle: number): void {
    const ctx = this.ctx;
    this.frame++;
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerMuffle = muffle;
    if (!ctx || ctx.state !== 'running') return;
    this.applyLevels(SMOOTHING);
    this.reconcileMusic(ctx);
    this.updateLoops(ctx);
  }

  /** Verdrahtet Lautstärkeregler, Musikweg und die Stimmen. */
  private build(ctx: AudioContext): void {
    // Ein Begrenzer fängt Spitzen ab, wenn viel auf einmal klingt.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(limiter);
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.connect(master);
    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = OPEN_CUTOFF;
    musicFilter.connect(musicBus);
    this.master = master;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.musicFilter = musicFilter;
    for (let i = 0; i < CONFIG.audio.voices; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = OPEN_CUTOFF;
      const pan = ctx.createStereoPanner();
      const gain = ctx.createGain();
      filter.connect(pan);
      pan.connect(gain);
      gain.connect(sfxBus);
      this.voices.push({ filter, pan, gain, source: null, endsAt: 0, priority: 0 });
    }
    this.applyLevels(0);
  }

  private createLoop(ctx: AudioContext, entry: LoopEntry): LoopState {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = OPEN_CUTOFF;
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(pan);
    pan.connect(gain);
    if (this.sfxBus) gain.connect(this.sfxBus);
    return {
      entry,
      buffer: null,
      source: null,
      filter,
      pan,
      gain,
      level: 0,
      x: 0,
      z: 0,
      located: false,
      reportedFrame: -1,
      quietSince: 0,
    };
  }

  private async decode(ctx: AudioContext, file: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(audioUrl(file));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await ctx.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn(`Audio: Die Datei "${file}" fehlt oder lässt sich nicht lesen; dafür bleibt es stumm.`, error);
      return null;
    }
  }

  /**
   * Browser starten Ton erst nach einer Eingabe der Spielerin oder des Spielers. Bis dahin ist
   * der Kontext angehalten; die erste Taste oder der erste Klick weckt ihn. Im verdeckten Tab ruht er.
   */
  private watchUnlock(ctx: AudioContext): void {
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const unlock = (): void => {
      this.unlocked = true;
      void ctx.resume();
    };
    for (const type of events) window.addEventListener(type, unlock, { capture: true, passive: true });
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running') return;
      for (const type of events) window.removeEventListener(type, unlock, { capture: true });
      const pending = this.pending;
      this.pending = null;
      if (pending && performance.now() - pending.at < PENDING_SECONDS * 1000) this.play(pending.id, pending.x, pending.z);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenSuspend = ctx.state === 'running';
        if (this.hiddenSuspend) void ctx.suspend();
      } else if (this.hiddenSuspend) {
        this.hiddenSuspend = false;
        void ctx.resume();
      }
    });
  }

  /** Findet den Eintrag zu einem Ereignis; fehlt `a.b.c`, gilt `a.b`, dann `a`. */
  private resolve(id: string): LoadedSound | null {
    const cached = this.resolved.get(id);
    if (cached !== undefined) return cached;
    let key = id;
    let found: LoadedSound | null = null;
    for (;;) {
      found = this.sounds.get(key) ?? null;
      const dot = key.lastIndexOf('.');
      if (found || dot < 0) break;
      key = key.slice(0, dot);
    }
    if (!found) console.warn(`Audio: In audio.json steht kein Ton für das Ereignis "${id}"; es bleibt stumm.`);
    this.resolved.set(id, found);
    return found;
  }

  /** Lautstärke, Seite und Dumpfheit eines Tons an einem Ort; `null`, wenn er außer Hörweite liegt. */
  private spatial(x: number, z: number, range: number): { level: number; pan: number; cutoff: number } | null {
    const { near, panWidth, muffle } = CONFIG.audio;
    const dx = x - this.listenerX;
    const distance = Math.hypot(dx, z - this.listenerZ);
    // In der Finsternis verhallen Rufe nach wenigen Metern.
    const reach = Math.max(near + 1, range * (1 - muffle.range * this.listenerMuffle));
    if (distance >= reach) return null;
    const away = distance <= near ? 0 : (distance - near) / (reach - near);
    const dull = clamp(Math.max(this.listenerMuffle, this.muffleAt(x, z)) + muffle.distance * away, 0, 1);
    return {
      level: (1 - away) * (1 - away) * (1 - (1 - muffle.gain) * dull),
      pan: clamp(dx / panWidth, -1, 1) * 0.85,
      cutoff: OPEN_CUTOFF * (muffle.cutoff / OPEN_CUTOFF) ** dull,
    };
  }

  /** Eine freie Stimme; sind alle belegt, verdrängt der neue Ton einen gleich oder weniger wichtigen. */
  private claim(now: number, priority: number): Voice | null {
    let victim: Voice | null = null;
    for (const voice of this.voices) {
      if (voice.endsAt <= now) return voice;
      if (voice.priority > priority) continue;
      if (!victim || voice.priority < victim.priority || (voice.priority === victim.priority && voice.endsAt < victim.endsAt)) {
        victim = voice;
      }
    }
    if (victim?.source) {
      victim.source.stop();
      victim.source.disconnect();
    }
    return victim;
  }

  /** Setzt Lautstärken und Dumpfheit der Busse; `seconds` ist die Zeit, in der der Wert angesteuert wird. */
  private applyLevels(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus || !this.musicFilter) return;
    const now = ctx.currentTime;
    const { muffle, music } = CONFIG.audio;
    const { master, effects, music: musicVolume, muted } = this.volumes;
    this.master.gain.setTargetAtTime(muted ? 0 : curve(master), now, seconds || 0.001);
    this.sfxBus.gain.setTargetAtTime(curve(effects), now, seconds || 0.001);

    const dull = this.listenerMuffle;
    const duckGain = this.duck === 'paused' ? music.pausedGain : this.duck === 'choice' ? music.choiceGain : 1;
    const muffleGain = 1 - (1 - muffle.gain) * dull;
    this.musicBus.gain.setTargetAtTime(curve(musicVolume) * duckGain * muffleGain, now, seconds || 0.001);
    const cutoff = Math.min(
      OPEN_CUTOFF * (muffle.cutoff / OPEN_CUTOFF) ** dull,
      this.duck === 'paused' ? music.pausedCutoff : OPEN_CUTOFF,
    );
    this.musicFilter.frequency.setTargetAtTime(cutoff, now, seconds || 0.001);
  }

  /** Startet das gewünschte Stück, sobald es geladen ist und der Browser Ton erlaubt. */
  private reconcileMusic(ctx: AudioContext): void {
    if (this.wantedMusic === this.startedMusic) return;
    const now = ctx.currentTime;
    const wanted = this.wantedMusic === null ? undefined : this.music.get(this.wantedMusic);
    if (this.wantedMusic !== null && !wanted?.buffer) return;

    const old = this.deck;
    const fade = wanted?.entry.fade ?? CONFIG.audio.music.fade;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.source.stop(now + fade + 0.1);
      old.source.onended = () => {
        old.source.disconnect();
        old.gain.disconnect();
      };
    }
    this.deck = null;
    this.startedMusic = this.wantedMusic;
    if (!wanted?.buffer || !this.musicFilter) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(wanted.entry.volume, now + fade);
    gain.connect(this.musicFilter);
    const source = ctx.createBufferSource();
    source.buffer = wanted.buffer;
    source.loop = wanted.entry.loop;
    source.connect(gain);
    source.start(now);
    this.deck = { source, gain };
  }

  /** Führt die Dauerklänge nach: Lautstärke, Seite und Dumpfheit; hält die unhörbaren an. */
  private updateLoops(ctx: AudioContext): void {
    const now = ctx.currentTime;
    for (const state of this.loops.values()) {
      let target = 0;
      let cutoff = OPEN_CUTOFF;
      let pan = 0;
      if (state.reportedFrame === this.frame && !this.silenced && !this.volumes.muted) {
        target = state.entry.volume * clamp(state.level, 0, 1);
        if (state.located) {
          const spatial = this.spatial(state.x, state.z, state.entry.range);
          if (spatial) {
            target *= spatial.level;
            cutoff = spatial.cutoff;
            pan = spatial.pan;
          } else {
            target = 0;
          }
        }
      }
      state.gain.gain.setTargetAtTime(target, now, SMOOTHING);
      state.filter.frequency.setTargetAtTime(cutoff, now, SMOOTHING);
      state.pan.pan.setTargetAtTime(pan, now, SMOOTHING);

      if (target > LOOP_SILENT) {
        state.quietSince = 0;
        if (!state.source && state.buffer) {
          const source = ctx.createBufferSource();
          source.buffer = state.buffer;
          source.loop = true;
          source.connect(state.filter);
          // Nicht bei jedem Einsatz von vorn, sonst klingt das Knistern immer gleich an.
          source.start(now, Math.random() * state.buffer.duration);
          state.source = source;
        }
      } else if (state.source) {
        if (state.quietSince === 0) state.quietSince = now;
        else if (now - state.quietSince > LOOP_IDLE_SECONDS) {
          state.source.stop();
          state.source.disconnect();
          state.source = null;
        }
      }
    }
  }
}
