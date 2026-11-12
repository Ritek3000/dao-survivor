"""
Erzeugt die Platzhalter-Klaenge des Spiels: Soundeffekte, Umgebungsgeraeusche und Musik.

Alles entsteht hier aus Rechnung (Schwingungen, Rauschen, Filter, Hall), es steckt kein fremdes Material darin.
Die Ergebnisse liegen als OGG-Dateien in public/audio und werden dort von public/audio/audio.json den Ereignissen
des Spiels zugeordnet. Die Dateien sind Platzhalter: Wer eigene hat, legt sie mit demselben Namen daneben
oder traegt den neuen Namen in audio.json ein (siehe README, Abschnitt "Ton und Musik").

Voraussetzungen: Python 3, numpy und ffmpeg (mit libvorbis) im Pfad.

  python tools/audio-erzeugen.py                   alles neu erzeugen
  python tools/audio-erzeugen.py --list            nur die Namen zeigen
  python tools/audio-erzeugen.py --only glocke     nur Dateien, deren Name 'glocke' enthaelt
  python tools/audio-erzeugen.py --format wav      ohne ffmpeg: unkomprimierte WAV-Dateien (gross)
  python tools/audio-erzeugen.py --out /tmp/klang  woanders hin schreiben

Alle Zufallswerte stammen aus festen Saatwerten (je Dateiname), derselbe Aufruf liefert also dieselben Klaenge.
Schleifen (Musik, Feuer, Wind, Finsternis) werden kreisfoermig gerechnet: Ihr Ende geht ohne Naht in den Anfang ueber.
"""
import argparse
import hashlib
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, '..', 'public', 'audio'))

# ---------------------------------------------------------------------------
# Grundbausteine
# ---------------------------------------------------------------------------


def rng_for(name):
    digest = hashlib.sha256(name.encode('ascii')).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], 'little'))


def n_of(seconds):
    return int(round(seconds * SR))


def taxis(seconds):
    return np.arange(n_of(seconds)) / SR


def shape_filter(x, gain_fn, circular=False):
    """Filtert im Frequenzbereich. Kreisfoermig fuer Schleifen, sonst mit Auffuellung."""
    n = len(x)
    nfft = n if circular else 1 << max(1, math.ceil(math.log2(max(2, n))))
    spec = np.fft.rfft(x, nfft)
    freqs = np.fft.rfftfreq(nfft, 1.0 / SR)
    return np.fft.irfft(spec * gain_fn(freqs), nfft)[:n]


def lowpass(x, fc, order=2, circular=False):
    return shape_filter(x, lambda f: 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order)), circular)


def highpass(x, fc, order=2, circular=False):
    return shape_filter(x, lambda f: 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1e-3)) ** (2 * order)), circular)


def bandpass(x, lo, hi, order=2, circular=False):
    return highpass(lowpass(x, hi, order, circular), lo, order, circular)


def resonance(x, fc, q, circular=False):
    """Schmales Band um fc (Formant, Pfeifen)."""
    return shape_filter(
        x, lambda f: 1.0 / np.sqrt(1.0 + (q * (f / fc - fc / np.maximum(f, 1e-3))) ** 2), circular
    )


def sweep_filter(x, curve, kind='low', order=2, q=1.2, frame=2048):
    """Filter, dessen Grenzfrequenz sich im Lauf der Zeit aendert (curve: eine Frequenz je Sample)."""
    n = len(x)
    hop = frame // 2
    window = np.hanning(frame + 1)[:-1]
    padded = np.concatenate([np.zeros(frame), x, np.zeros(frame)])
    out = np.zeros(len(padded))
    freqs = np.fft.rfftfreq(frame, 1.0 / SR)
    for start in range(0, len(padded) - frame + 1, hop):
        center = min(n - 1, max(0, start + frame // 2 - frame))
        fc = max(20.0, float(curve[center]))
        spec = np.fft.rfft(padded[start : start + frame] * window)
        if kind == 'low':
            gain = 1.0 / np.sqrt(1.0 + (freqs / fc) ** (2 * order))
        elif kind == 'high':
            gain = 1.0 / np.sqrt(1.0 + (fc / np.maximum(freqs, 1e-3)) ** (2 * order))
        else:
            gain = 1.0 / np.sqrt(1.0 + (q * (freqs / fc - fc / np.maximum(freqs, 1e-3))) ** 2)
        out[start : start + frame] += np.fft.irfft(spec * gain, frame)
    return out[frame : frame + n]


def white(n, rng):
    return rng.standard_normal(n)


def colored(n, rng, power):
    """Rauschen mit Spektrum 1/f^power (1 = rosa, 2 = braun), auf Standardabweichung 1 gebracht."""
    bins = n // 2 + 1
    spec = rng.standard_normal(bins) + 1j * rng.standard_normal(bins)
    index = np.arange(bins, dtype=float)
    index[0] = 1.0
    spec /= index ** (power / 2.0)
    spec[0] = 0.0
    x = np.fft.irfft(spec, n)
    return x / (np.std(x) + 1e-12)


def phase_of(freq, n):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    return 2.0 * np.pi * np.cumsum(f) / SR


def sine(freq, n, start=0.0):
    return np.sin(phase_of(freq, n) + start)


def saw(freq, n, start=0.0):
    ph = (phase_of(freq, n) / (2.0 * np.pi) + start) % 1.0
    return 2.0 * ph - 1.0


def square(freq, n):
    return np.sign(np.sin(phase_of(freq, n)) + 1e-9)


def loop_freq(f, seconds):
    """Rundet auf ganze Schwingungen je Schleife, damit die Phase an der Naht stimmt."""
    return max(1, round(f * seconds)) / seconds


def smooth(t, a, b):
    """0 vor a, 1 nach b, dazwischen weich."""
    u = np.clip((t - a) / max(b - a, 1e-9), 0.0, 1.0)
    return u * u * (3 - 2 * u)


def fade_edges(x, fade_in=0.004, fade_out=0.02):
    n = len(x)
    out = x.copy()
    a = min(n, n_of(fade_in))
    b = min(n, n_of(fade_out))
    if a > 1:
        out[:a] *= np.linspace(0, 1, a)
    if b > 1:
        out[-b:] *= np.linspace(1, 0, b)
    return out


def pad_seconds(x, seconds):
    return np.concatenate([x, np.zeros((n_of(seconds),) + x.shape[1:])])


def place(buf, sig, start_seconds, gain=1.0, wrap=False):
    """Mischt sig ab start_seconds in buf; mit wrap laeuft der Rest am Anfang weiter (fuer Schleifen)."""
    start = n_of(start_seconds)
    n = len(buf)
    sig = sig * gain
    if wrap:
        start %= n
        end = start + len(sig)
        if end <= n:
            buf[start:end] += sig
        else:
            first = n - start
            buf[start:] += sig[:first]
            rest = sig[first:]
            while len(rest) > 0:
                chunk = rest[:n]
                buf[: len(chunk)] += chunk
                rest = rest[n:]
        return
    if start >= n:
        return
    end = min(n, start + len(sig))
    buf[start:end] += sig[: end - start]


def stereo_of(sig, pan=0.0):
    theta = (np.clip(pan, -1.0, 1.0) + 1.0) * np.pi / 4.0
    return np.stack([sig * np.cos(theta), sig * np.sin(theta)], axis=-1)


# ---------------------------------------------------------------------------
# Hall und Abschluss
# ---------------------------------------------------------------------------


def make_ir(rt60, rng, predelay=0.018, damping=0.5):
    """Raumantwort aus abklingendem Rauschen; hohe Frequenzen verklingen schneller."""
    n = n_of(rt60 * 1.15 + predelay)
    t = np.arange(n) / SR
    ir = np.zeros(n)
    bands = [(50.0, 400.0, 1.15), (400.0, 2500.0, 1.0), (2500.0, 9000.0, 0.75 - 0.5 * damping)]
    for lo, hi, scale in bands:
        noise = bandpass(white(n, rng), lo, hi, 2)
        ir += noise * np.exp(-6.9078 * t / (rt60 * scale))
    shift = n_of(predelay)
    ir = np.concatenate([np.zeros(shift), ir[: n - shift]])
    # Einige fruehe Reflexionen geben dem Raum eine Groesse.
    for _ in range(7):
        i = int(rng.uniform(0.004, 0.06) * SR)
        ir[i] += rng.choice([-1, 1]) * rng.uniform(0.6, 1.4) * np.std(ir) * 6
    ir[: shift // 2 + 1] *= 0.0
    return ir / (np.sqrt(np.sum(ir**2)) + 1e-12)


def convolve(x, ir, circular):
    n = len(x)
    if circular:
        nfft = n
        full = np.zeros(nfft)
        full[: min(len(ir), nfft)] = ir[:nfft]
        return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(full, nfft), nfft)
    nfft = 1 << math.ceil(math.log2(n + len(ir)))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:n]


def reverb(x, rt60=2.2, wet=0.3, damping=0.5, seed='hall', circular=False):
    """Stereo-Hall. Ein Mono-Signal wird zu Stereo; bei Schleifen laeuft der Nachhall um die Naht herum."""
    rng = rng_for('ir-' + seed)
    left_ir = make_ir(rt60, rng, damping=damping)
    right_ir = make_ir(rt60, rng, damping=damping)
    if x.ndim == 1:
        left, right = x, x
    else:
        left, right = x[:, 0], x[:, 1]
    out = np.stack([convolve(left, left_ir, circular), convolve(right, right_ir, circular)], axis=-1)
    dry = np.stack([left, right], axis=-1)
    return dry * (1.0 - wet * 0.5) + out * wet * 2.0


def active_rms(x):
    mono = x if x.ndim == 1 else x.mean(axis=1)
    level = np.abs(mono)
    gate = level > 0.03 * (np.max(level) + 1e-12)
    if not np.any(gate):
        return 1e-9
    return float(np.sqrt(np.mean(mono[gate] ** 2)))


def finish(x, rms_db=-20.0, peak_db=-1.5):
    """Bringt ein Signal auf eine einheitliche Lautheit; Spitzen darueber werden weich begrenzt."""
    x = np.nan_to_num(x)
    x = x - x.mean(axis=0)
    target = 10 ** (rms_db / 20.0)
    x = x * (target / active_rms(x))
    ceiling = 10 ** (peak_db / 20.0)
    peak = np.max(np.abs(x))
    if peak > ceiling:
        knee = ceiling * 0.6
        mag = np.abs(x)
        over = mag > knee
        squeezed = knee + (ceiling - knee) * np.tanh((mag[over] - knee) / (ceiling - knee))
        x = x.copy()
        x[over] = np.sign(x[over]) * squeezed
    return x


# ---------------------------------------------------------------------------
# Kleine Klangbausteine
# ---------------------------------------------------------------------------


def thump(f_start, f_end, dur, tau, bend=0.35):
    """Tiefer Schlag: ein Sinus, dessen Tonhoehe schnell faellt."""
    n = n_of(dur)
    t = np.arange(n) / SR
    f = f_end + (f_start - f_end) * np.exp(-t / (tau * bend))
    return np.sin(phase_of(f, n)) * np.exp(-t / tau)


def noise_hit(rng, lo, hi, dur, tau, order=2):
    n = n_of(dur)
    t = np.arange(n) / SR
    if lo <= 0:
        x = lowpass(white(n, rng), hi, order)
    elif hi <= 0:
        x = highpass(white(n, rng), lo, order)
    else:
        x = bandpass(white(n, rng), lo, hi, order)
    return x * np.exp(-t / tau)


def whoosh(rng, dur, f_start, f_end, peak=0.4, tail=0.2, q=1.0):
    """Rauschen, dessen Mittenfrequenz wandert; die Lautstaerke schwillt an und klingt aus."""
    n = n_of(dur)
    t = np.arange(n) / SR
    tp = max(peak * dur, 1e-3)
    env = np.where(t < tp, (t / tp) ** 2, np.exp(-(t - tp) / max(tail, 1e-3)))
    curve = f_start * (f_end / f_start) ** (t / dur)
    return sweep_filter(white(n, rng), curve, 'band', q=q) * env


def crackle(rng, dur, rate, lo=1500, hi=9000, strength=1.0, tau=0.004, pops=0.0):
    """Knistern: zufaellig verteilte kurze Knackser, einzelne lauter."""
    n = n_of(dur)
    out = np.zeros(n)
    count = rng.poisson(rate * dur)
    for _ in range(count):
        at = rng.uniform(0, dur)
        amp = strength * rng.uniform(0.08, 1.0) ** 2.2
        hit = noise_hit(rng, lo * rng.uniform(0.7, 1.4), hi * rng.uniform(0.7, 1.2), 0.04, tau * rng.uniform(0.6, 1.6))
        place(out, hit, at, amp)
        if pops > 0 and rng.random() < pops:
            place(out, thump(rng.uniform(150, 260), 70, 0.06, 0.015), at, amp * 1.4)
    return out


def chime(freq, dur, tau, partials=((1.0, 1.0), (2.76, 0.32), (5.4, 0.12)), rng=None):
    """Heller, glasiger Ton mit unharmonischen Obertoenen."""
    n = n_of(dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for index, (ratio, amp) in enumerate(partials):
        start = rng.uniform(0, 6.28) if rng is not None else 0.0
        out += amp * np.sin(2 * np.pi * freq * ratio * t + start) * np.exp(-t / (tau / (1 + 0.8 * index)))
    return fade_edges(out, 0.001, 0.01)


BELL_RATIOS = [0.5, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.2]
BELL_AMPS = [0.7, 1.0, 0.75, 0.55, 0.6, 0.28, 0.22, 0.14, 0.08]
BELL_TAUS = [3.2, 2.6, 2.0, 1.6, 1.2, 0.9, 0.6, 0.4, 0.25]


def bell(f0, dur, rng, tau_scale=1.0, brightness=1.0):
    """Grosse Glocke: Schlagton, Prim, Terz, Quint ... mit leichtem Schweben der Obertoene."""
    n = n_of(dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, tau in zip(BELL_RATIOS, BELL_AMPS, BELL_TAUS):
        a = amp * (brightness if ratio > 2.2 else 1.0)
        for beat in (-0.5, 0.5):
            f = f0 * ratio * (1 + rng.normal(0, 0.0015)) + beat * (0.25 + 0.15 * ratio)
            out += 0.5 * a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / (tau * tau_scale))
    clapper = noise_hit(rng, 700, 4500, 0.05, 0.009) * 0.9 * brightness
    out[: len(clapper)] += clapper
    out[: n_of(0.05)] += thump(f0, f0 * 0.5, 0.05, 0.02)[: n_of(0.05)] * 0.5
    return out


def pluck(f, dur, rng, brightness=1.0, base_tau=None):
    """Gezupfte Saite, harfenartig: viele Obertoene, die hoeheren klingen schneller ab."""
    n = n_of(dur)
    t = np.arange(n) / SR
    base = base_tau if base_tau else dur / 3.0
    out = np.zeros(n)
    for k in range(1, 13):
        fk = f * k * (1 + 0.0004 * k * k)
        if fk > 9000:
            break
        out += (1.0 / k**1.2) * brightness ** (k > 2) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(
            -t / (base / (k**0.7))
        )
    out *= smooth(t, 0.0, 0.004)
    return out


def formant_voice(f0_curve, n, formants, rng, breath=0.15, rasp=0.0):
    """Stimmenartiger Klang: Saege durch Formantfilter, dazu Hauch (breath = Anteil des Hauchs am Klang)."""
    source = saw(f0_curve, n)
    if rasp > 0:
        source = source * (1 - rasp + rasp * (0.5 + 0.5 * np.sign(np.sin(phase_of(np.asarray(f0_curve) * 0.5, n)))))
    voiced = np.zeros(n)
    for fc, q, gain in formants:
        voiced += gain * resonance(source, fc, q)
    voiced = voiced / (np.std(voiced) + 1e-9)
    air = bandpass(white(n, rng), 500, 2800)
    air = air / (np.std(air) + 1e-9)
    # Der Rachenraum daempft alles ueber einigen Kilohertz.
    return lowpass(voiced + air * breath, 3200, 2)


def note_hz(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    letter = name[0]
    index = 1
    semitone = names[letter]
    while index < len(name) and name[index] in '#b':
        semitone += 1 if name[index] == '#' else -1
        index += 1
    octave = int(name[index:])
    midi = 12 * (octave + 1) + semitone
    return 440.0 * 2 ** ((midi - 69) / 12.0)


# ---------------------------------------------------------------------------
# Soundeffekte
# ---------------------------------------------------------------------------


def sfx_abendglocke(rng):
    # Drei Schlaege der grossen Glocke, jeder klingt in den naechsten hinein.
    out = np.zeros(n_of(16.0))
    for at, gain in [(0.0, 1.0), (3.2, 0.9), (6.4, 0.85)]:
        place(out, bell(196.0, 11.0, rng, tau_scale=1.3), at, gain)
    out = fade_edges(out, 0.002, 2.5)
    stereo = reverb(out, rt60=3.4, wet=0.28, damping=0.6, seed='glocke')
    return stereo.mean(axis=1)


def sfx_spieler_treffer(rng, variant):
    pitch = [1.0, 0.86, 1.15][variant]
    out = np.zeros(n_of(0.4))
    place(out, thump(170 * pitch, 55, 0.3, 0.09), 0, 1.0)
    place(out, noise_hit(rng, 0, 1800 * pitch, 0.25, 0.05), 0, 0.9)
    place(out, noise_hit(rng, 2200, 7000, 0.08, 0.012), 0, 0.35)
    # Ein kurzer Laut der Anstrengung: gedaempfte Stimme mit fallender Tonhoehe.
    n = n_of(0.22)
    t = np.arange(n) / SR
    voice = formant_voice(210 * pitch * (1 - 0.35 * t / 0.22), n, [(520, 4, 1.0), (1100, 5, 0.5)], rng, breath=0.25)
    place(out, voice * np.exp(-t / 0.09) * smooth(t, 0, 0.012), 0.02, 0.45)
    return fade_edges(out, 0.001, 0.05)


def sfx_spieler_verstaubt(rng):
    n = n_of(0.9)
    t = np.arange(n) / SR
    hiss = sweep_filter(white(n, rng), 5200 - 3200 * t / 0.9, 'band', q=0.8)
    hiss = hiss / (np.std(hiss) + 1e-9)
    env = smooth(t, 0, 0.08) * np.exp(-t / 0.35)
    out = hiss * env * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * t)) * 0.5
    place(out, thump(80, 48, 0.5, 0.14), 0, 0.8)
    out += np.sin(2 * np.pi * 1568 * t) * np.exp(-t / 0.25) * 0.08
    return fade_edges(out, 0.002, 0.1)


def sfx_schild_faengt(rng):
    out = np.zeros(n_of(0.7))
    place(out, chime(1244.5, 0.7, 0.28, ((1, 1), (2.32, 0.5), (4.1, 0.3)), rng), 0, 1.0)
    place(out, noise_hit(rng, 2500, 9000, 0.06, 0.01), 0, 0.5)
    place(out, thump(300, 120, 0.12, 0.03), 0, 0.5)
    return out


def sfx_schild_bereit(rng):
    out = np.zeros(n_of(0.9))
    place(out, chime(880.0, 0.9, 0.3, ((1, 1), (2.0, 0.3)), rng), 0, 0.6)
    place(out, chime(1318.5, 0.8, 0.28, ((1, 1), (2.0, 0.3)), rng), 0.1, 0.5)
    return out


def sfx_schritt(rng, variant):
    pitch = [1.0, 0.85, 1.2][variant]
    out = np.zeros(n_of(0.2))
    place(out, noise_hit(rng, 0, 650 * pitch, 0.18, 0.03), 0, 1.0)
    place(out, noise_hit(rng, 1500, 4500, 0.05, 0.01), 0.004, 0.18)
    place(out, thump(95 * pitch, 55, 0.12, 0.035), 0, 0.7)
    return out


def sfx_eingesammelt(rng, variant):
    f = [880.0, 1046.5, 1318.5][variant]
    out = np.zeros(n_of(0.45))
    place(out, chime(f * 2, 0.45, 0.1, ((1, 1), (2.7, 0.3)), rng), 0, 0.9)
    place(out, chime(f * 3.0, 0.2, 0.04, ((1, 1),), rng), 0.012, 0.25)
    return out


def sfx_stufe(rng):
    out = np.zeros(n_of(3.0))
    for index, f in enumerate([440.0, 523.25, 659.25, 880.0]):
        place(out, chime(f, 1.8, 0.45, ((1, 1), (2.01, 0.35), (3.99, 0.12)), rng), 0.11 * index, 0.8)
    stereo = reverb(out, rt60=1.8, wet=0.3, seed='stufe')
    return stereo.mean(axis=1)


def sfx_segen(rng):
    # Ein weiter Akkord wie aus einem Chor, darueber ein Schimmer.
    length = 5.0
    out = np.zeros(n_of(length))
    for index, f in enumerate([110.0, 220.0, 329.63, 440.0, 523.25, 659.25]):
        n = n_of(length)
        t = np.arange(n) / SR
        vib = 1 + 0.004 * np.sin(2 * np.pi * (5.0 + 0.3 * index) * t + index)
        voice = np.zeros(n)
        for detune in (-0.003, 0.0, 0.003):
            voice += saw(f * vib * (1 + detune), n, rng.uniform(0, 1))
        shaped = resonance(voice, 780, 2.2) + 0.7 * resonance(voice, 1250, 3.0) + 0.3 * lowpass(voice, 500)
        env = smooth(t, 0.0, 1.1) * (1 - smooth(t, length - 2.2, length))
        out += shaped * env * (0.9 if f < 300 else 0.55)
    for at, f in [(0.7, 1318.5), (1.3, 1760.0), (1.9, 2093.0)]:
        place(out, chime(f, 2.2, 0.5, ((1, 1), (2.76, 0.2)), rng), at, 0.25)
    stereo = reverb(out, rt60=3.2, wet=0.35, seed='segen')
    return stereo.mean(axis=1)


def sfx_auswahl(rng):
    out = np.zeros(n_of(0.12))
    place(out, noise_hit(rng, 1500, 4500, 0.06, 0.012), 0, 0.6)
    place(out, chime(1568.0, 0.12, 0.03, ((1, 1),), rng), 0, 0.5)
    return out


def sfx_bestaetigen(rng):
    out = np.zeros(n_of(0.7))
    place(out, thump(250, 130, 0.2, 0.06), 0, 0.9)
    place(out, noise_hit(rng, 600, 3000, 0.05, 0.01), 0, 0.4)
    place(out, chime(220.0, 0.7, 0.3, ((1, 1), (1.5, 0.6), (2.0, 0.3)), rng), 0.02, 0.7)
    return out


def sfx_pause(rng):
    out = np.zeros(n_of(0.6))
    place(out, thump(150, 52, 0.5, 0.16), 0, 1.0)
    place(out, noise_hit(rng, 0, 500, 0.4, 0.1), 0, 0.5)
    return out


def sfx_feuer_entzuenden(rng):
    n = n_of(1.1)
    t = np.arange(n) / SR
    scrape = sweep_filter(white(n, rng), 1800 + 5200 * t / 1.1, 'band', q=0.6)
    chop = (rng.random(n // 441 + 2) > 0.4).astype(float)
    chop = np.interp(np.arange(n), np.arange(len(chop)) * 441, chop)
    out = scrape * chop * smooth(t, 0, 0.05) * (1 - smooth(t, 0.85, 1.1)) * 0.6
    for at in (0.22, 0.47, 0.72, 0.93):
        place(out, noise_hit(rng, 3000, 11000, 0.05, 0.006), at, 1.0)
    return out


def sfx_feuer_entzuendet(rng):
    n = n_of(1.8)
    t = np.arange(n) / SR
    out = thump(95, 38, 1.4, 0.3)[: n_of(1.4)]
    out = np.pad(out, (0, n - len(out)))
    roar = sweep_filter(white(n, rng), 250 + 2400 * np.exp(-((t - 0.25) / 0.35) ** 2), 'low')
    out += roar * smooth(t, 0, 0.09) * np.exp(-t / 0.55) * 1.2
    out += crackle(rng, 1.8, 40, strength=0.7, pops=0.1) * smooth(t, 0.1, 0.4) * np.exp(-t / 1.0)
    return fade_edges(out, 0.002, 0.2)


def sfx_feuer_erlischt(rng):
    n = n_of(2.2)
    t = np.arange(n) / SR
    hiss = sweep_filter(white(n, rng), 6500 * (0.08 ** (t / 2.2)), 'low')
    out = hiss * smooth(t, 0, 0.05) * np.exp(-t / 0.7)
    out += crackle(rng, 2.2, 22, strength=0.6, pops=0.2) * np.exp(-t / 0.9)
    return fade_edges(out, 0.002, 0.3)


def sfx_feuer_geloescht(rng):
    # Der Sog nimmt die Waerme: erst saugt es, dann schliesst sich die Kaelte mit einem dumpfen Schlag.
    n = n_of(2.0)
    t = np.arange(n) / SR
    suck = sweep_filter(white(n, rng), 5500 * (0.05 ** (t / 1.0)) + 250, 'low')
    out = suck * smooth(t, 0, 0.9) * (1 - smooth(t, 0.9, 1.0)) * 0.9
    place(out, thump(75, 32, 0.9, 0.22), 0.9, 1.2)
    place(out, noise_hit(rng, 0, 900, 0.5, 0.12), 0.9, 0.6)
    place(out, chime(1760.0, 1.0, 0.45, ((1, 1), (2.76, 0.3)), rng), 0.92, 0.12)
    return fade_edges(out, 0.002, 0.25)


def loop_feuer_knistern(rng):
    seconds = 8.0
    n = n_of(seconds)
    base = lowpass(colored(n, rng, 2), 230, 2, circular=True) * 0.5
    slow = lowpass(white(n, rng), 3.0, 2, circular=True)
    slow = slow / (np.std(slow) + 1e-9)
    hiss = bandpass(colored(n, rng, 1), 500, 3200, 2, circular=True) * 0.22 * (1.0 + 0.5 * np.clip(slow, -1.5, 1.5))
    out = base + hiss
    count = rng.poisson(16 * seconds)
    for _ in range(count):
        at = rng.uniform(0, seconds)
        amp = rng.uniform(0.08, 1.0) ** 2.2 * 1.1
        hit = noise_hit(rng, 1500 * rng.uniform(0.7, 1.4), 9000 * rng.uniform(0.7, 1.2), 0.05, 0.004 * rng.uniform(0.6, 1.6))
        place(out, hit, at, amp, wrap=True)
        if rng.random() < 0.12:
            place(out, thump(rng.uniform(150, 260), 70, 0.06, 0.016), at, amp * 1.6, wrap=True)
    return out


def loop_wind_nacht(rng):
    seconds = 20.0
    n = n_of(seconds)
    body = bandpass(colored(n, rng, 1), 110, 900, 2, circular=True)
    swell = lowpass(white(n, rng), 0.35, 2, circular=True)
    swell = np.clip(0.75 + 0.5 * swell / (np.std(swell) + 1e-9), 0.2, 1.4)
    out = body * swell
    # Ein duenner, pfeifender Zug, der mal da ist und mal nicht.
    gust = lowpass(white(n, rng), 0.18, 2, circular=True)
    gust = np.clip(gust / (np.std(gust) + 1e-9), 0, 3) / 3.0
    whistle = resonance(white(n, rng), 620, 14.0, circular=True) + 0.6 * resonance(white(n, rng), 905, 18.0, circular=True)
    out += whistle * gust * 0.5
    return out


def loop_finsternis_brummen(rng):
    seconds = 10.0
    n = n_of(seconds)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f, a in [(55.0, 1.0), (55.9, 0.8), (82.4, 0.5), (110.7, 0.35), (164.0, 0.12)]:
        out += a * np.sin(2 * np.pi * loop_freq(f, seconds) * t)
    out *= 0.75 + 0.25 * np.sin(2 * np.pi * 2.0 / seconds * t + 1.0)
    out += lowpass(colored(n, rng, 2), 140, 2, circular=True) * 0.6
    mod = np.clip(np.sin(2 * np.pi * 3.0 / seconds * t) * np.sin(2 * np.pi * 5.0 / seconds * t + 0.7), 0, 1)
    out += bandpass(white(n, rng), 1800, 4200, 2, circular=True) * mod * 0.07
    out += np.sin(2 * np.pi * loop_freq(1318.5, seconds) * t) * 0.02 * (0.5 + 0.5 * np.sin(2 * np.pi * 4.0 / seconds * t))
    return out


# --- Angriffe der Spielfigur -----------------------------------------------


def sfx_angriff_axthieb(rng):
    out = whoosh(rng, 0.38, 500, 2400, peak=0.35, tail=0.09)
    out = np.pad(out, (0, n_of(0.3)))
    place(out, thump(180, 70, 0.2, 0.05), 0.2, 0.55)
    place(out, noise_hit(rng, 1200, 5000, 0.07, 0.014), 0.2, 0.45)
    return fade_edges(out, 0.002, 0.08)


def sfx_angriff_wuchthieb(rng):
    out = whoosh(rng, 0.55, 260, 1500, peak=0.5, tail=0.14)
    out = np.pad(out, (0, n_of(0.5)))
    place(out, thump(120, 38, 0.5, 0.13), 0.33, 1.1)
    place(out, noise_hit(rng, 0, 2500, 0.3, 0.07), 0.33, 0.8)
    place(out, noise_hit(rng, 1500, 6000, 0.1, 0.02), 0.33, 0.5)
    return fade_edges(out, 0.002, 0.1)


def sfx_angriff_wirbelschlag(rng):
    n = n_of(1.0)
    t = np.arange(n) / SR
    spin = whoosh(rng, 1.0, 400, 1600, peak=0.4, tail=0.18) * (0.65 + 0.35 * np.sin(2 * np.pi * 6.5 * t))
    place(spin, thump(90, 30, 0.7, 0.2), 0.62, 1.4)
    place(spin, noise_hit(rng, 0, 1800, 0.4, 0.09), 0.62, 0.8)
    return fade_edges(spin, 0.002, 0.15)


def sfx_angriff_kriegsschrei(rng):
    n = n_of(1.3)
    t = np.arange(n) / SR
    f0 = 118 + 60 * smooth(t, 0, 0.25) - 70 * smooth(t, 0.6, 1.3)
    voice = formant_voice(f0, n, [(650, 3, 1.0), (1080, 4, 0.8), (2500, 6, 0.35)], rng, breath=0.4, rasp=0.2)
    env = smooth(t, 0, 0.06) * np.exp(-np.maximum(t - 0.45, 0) / 0.5)
    out = np.tanh(2.2 * voice * env / (np.std(voice) + 1e-9)) * 0.7
    stereo = reverb(out, rt60=1.2, wet=0.2, seed='schrei')
    return stereo.mean(axis=1)


def sfx_angriff_wurfaxt(rng):
    n = n_of(0.6)
    t = np.arange(n) / SR
    spin = whoosh(rng, 0.6, 700, 1900, peak=0.3, tail=0.2, q=1.4) * (0.55 + 0.45 * np.sin(2 * np.pi * 17 * t))
    place(spin, noise_hit(rng, 1000, 4000, 0.06, 0.012), 0, 0.5)
    return fade_edges(spin, 0.002, 0.1)


def sfx_angriff_bogenschuss(rng):
    out = np.zeros(n_of(0.55))
    twang = pluck(196.0, 0.4, rng, brightness=0.8, base_tau=0.07)
    place(out, twang, 0, 0.9)
    place(out, noise_hit(rng, 1500, 5000, 0.05, 0.01), 0, 0.5)
    place(out, whoosh(rng, 0.35, 2500, 5200, peak=0.25, tail=0.09), 0.01, 0.55)
    return fade_edges(out, 0.001, 0.08)


def sfx_angriff_pfeilhagel(rng):
    out = np.zeros(n_of(1.3))
    for at in (0.0, 0.06, 0.11):
        place(out, pluck(185.0 * rng.uniform(0.95, 1.1), 0.3, rng, brightness=0.8, base_tau=0.06), at, 0.7)
        place(out, noise_hit(rng, 1500, 5000, 0.04, 0.008), at, 0.4)
    place(out, whoosh(rng, 1.1, 1200, 6500, peak=0.45, tail=0.25), 0.05, 0.6)
    return fade_edges(out, 0.001, 0.15)


def sfx_einschlag_pfeilhagel(rng):
    out = np.zeros(n_of(1.0))
    for _ in range(14):
        at = rng.uniform(0, 0.55)
        place(out, thump(rng.uniform(220, 360), 110, 0.07, 0.016), at, rng.uniform(0.35, 0.9))
        place(out, noise_hit(rng, 1200, 6000, 0.03, 0.006), at, rng.uniform(0.2, 0.6))
    return fade_edges(out, 0.001, 0.15)


def sfx_angriff_fangeisen(rng):
    out = np.zeros(n_of(0.35))
    place(out, chime(1480.0, 0.3, 0.05, ((1, 1), (2.3, 0.6), (4.2, 0.3)), rng), 0, 0.6)
    place(out, noise_hit(rng, 2000, 8000, 0.04, 0.006), 0, 0.6)
    place(out, thump(130, 70, 0.1, 0.025), 0, 0.5)
    return out


def sfx_einschlag_fangeisen(rng):
    out = np.zeros(n_of(0.6))
    place(out, noise_hit(rng, 1500, 9000, 0.05, 0.006), 0, 1.0)
    place(out, chime(930.0, 0.55, 0.12, ((1, 1), (2.32, 0.8), (3.9, 0.6), (6.1, 0.3)), rng), 0, 0.8)
    place(out, thump(200, 70, 0.15, 0.04), 0, 0.8)
    place(out, pluck(310.0, 0.25, rng, brightness=1.0, base_tau=0.05), 0.03, 0.4)
    return fade_edges(out, 0.001, 0.1)


def sfx_angriff_wurfmesser(rng):
    out = np.zeros(n_of(0.6))
    for index in range(3):
        at = 0.045 * index
        place(out, whoosh(rng, 0.2, 3500 + 500 * index, 8000, peak=0.25, tail=0.05, q=1.8), at, 0.7)
        place(out, chime(2900.0 + 220 * index, 0.2, 0.03, ((1, 1), (2.7, 0.4)), rng), at, 0.3)
    return fade_edges(out, 0.001, 0.08)


def sfx_angriff_hitze_werfen(rng):
    n = n_of(0.7)
    t = np.arange(n) / SR
    hiss = sweep_filter(white(n, rng), 1200 + 4800 * np.exp(-t / 0.25), 'band', q=0.7)
    out = hiss * smooth(t, 0, 0.03) * np.exp(-t / 0.22)
    out += crackle(rng, 0.7, 60, strength=0.5, pops=0.1) * np.exp(-t / 0.3)
    place(out, thump(110, 55, 0.2, 0.05), 0, 0.5)
    return fade_edges(out, 0.001, 0.1)


def sfx_angriff_sorlanze(rng):
    n = n_of(0.8)
    t = np.arange(n) / SR
    f = 380 + 2300 * np.exp(-t / 0.12)
    zap = sine(f, n) + 0.5 * sine(f * 2.01, n) + 0.25 * sine(f * 3.02, n)
    out = zap * smooth(t, 0, 0.004) * np.exp(-t / 0.18) * 0.7
    out += bandpass(white(n, rng), 3000, 9000) * np.exp(-t / 0.12) * 0.6
    out += sine(loop_freq(880.0, 1.0), n) * np.exp(-t / 0.35) * 0.25
    return fade_edges(out, 0.001, 0.15)


def sfx_angriff_glut_formen(rng):
    n = n_of(0.45)
    t = np.arange(n) / SR
    puff = sweep_filter(white(n, rng), 900 + 1200 * np.exp(-t / 0.12), 'low')
    out = puff * smooth(t, 0, 0.03) * np.exp(-t / 0.13)
    out += crackle(rng, 0.45, 50, strength=0.4) * np.exp(-t / 0.2)
    return fade_edges(out, 0.001, 0.08)


def sfx_angriff_erdstoss(rng):
    out = np.zeros(n_of(1.2))
    place(out, thump(85, 28, 1.0, 0.24), 0, 1.4)
    place(out, noise_hit(rng, 0, 1400, 0.6, 0.14), 0, 0.9)
    place(out, crackle(rng, 0.9, 70, lo=500, hi=3500, strength=0.6) * np.exp(-taxis(0.9) / 0.3), 0.04, 0.9)
    return fade_edges(out, 0.001, 0.2)


def sfx_angriff_wurzelgriff(rng):
    n = n_of(1.0)
    t = np.arange(n) / SR
    creak_f = 85 + 40 * smooth(t, 0, 0.6) + 6 * np.sin(2 * np.pi * 9 * t)
    creak = resonance(saw(creak_f, n), 320, 4.0) + 0.5 * resonance(saw(creak_f, n), 700, 5.0)
    creak = creak * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 14 * t))) * smooth(t, 0, 0.1) * np.exp(-np.maximum(t - 0.4, 0) / 0.3)
    out = creak / (np.std(creak) + 1e-9) * 0.5
    out += crackle(rng, 1.0, 55, lo=800, hi=4500, strength=0.7, tau=0.006) * smooth(t, 0.0, 0.3)
    return fade_edges(out, 0.002, 0.15)


def sfx_angriff_sturmboee(rng):
    return fade_edges(whoosh(rng, 1.1, 250, 2200, peak=0.4, tail=0.28, q=0.55), 0.01, 0.2)


def sfx_angriff_sorhennas_brand(rng):
    out = np.zeros(n_of(2.2))
    t = taxis(2.2)
    for index, f in enumerate([1318.5, 1975.5, 2637.0, 3951.0]):
        glide = f * (0.92 + 0.08 * smooth(t, 0, 0.25))
        out += sine(glide, len(t)) * (0.5 / (1 + index * 0.5)) * smooth(t, 0, 0.12) * np.exp(-t / 0.8)
    out += bandpass(white(len(t), rng), 2500, 11000) * smooth(t, 0, 0.05) * np.exp(-t / 0.18) * 0.7
    stereo = reverb(out, rt60=2.0, wet=0.3, seed='brand')
    return stereo.mean(axis=1)


# --- Treffer und Tod der Gegner -----------------------------------------------


def sfx_treffer_stahl(rng, variant):
    pitch = [1.0, 0.82, 1.2][variant]
    out = np.zeros(n_of(0.3))
    place(out, thump(210 * pitch, 85, 0.2, 0.05), 0, 1.0)
    place(out, noise_hit(rng, 0, 3200, 0.12, 0.022), 0, 0.8)
    place(out, noise_hit(rng, 2500, 9000, 0.04, 0.006), 0, 0.5)
    place(out, chime(1250.0 * pitch, 0.25, 0.04, ((1, 1), (2.7, 0.5)), rng), 0, 0.18)
    return fade_edges(out, 0.001, 0.05)


def sfx_treffer_staub(rng, variant):
    pitch = [1.0, 0.85, 1.15][variant]
    out = np.zeros(n_of(0.35))
    place(out, noise_hit(rng, 0, 1300 * pitch, 0.3, 0.07), 0, 1.0)
    place(out, noise_hit(rng, 1200, 4000, 0.15, 0.03), 0, 0.35)
    place(out, thump(120 * pitch, 55, 0.18, 0.05), 0, 0.7)
    return fade_edges(out, 0.001, 0.06)


def sfx_treffer_brand(rng, variant):
    pitch = [1.0, 0.85, 1.2][variant]
    out = np.zeros(n_of(0.4))
    place(out, crackle(rng, 0.35, 90, lo=2000 * pitch, hi=10000, strength=1.0, pops=0.15), 0, 0.9)
    place(out, noise_hit(rng, 1500, 6000, 0.25, 0.07), 0, 0.5)
    place(out, thump(140 * pitch, 65, 0.12, 0.03), 0, 0.5)
    return fade_edges(out, 0.001, 0.08)


def crumble(rng, dur, f_high, f_low, tau, thump_hz=120, thump_gain=0.7, chop_hz=90):
    """Ein Gegner zerfaellt zu Staub: Rauschen, dessen Helligkeit sinkt, mit zufaelligem Zerbroeckeln."""
    n = n_of(dur)
    t = np.arange(n) / SR
    body = sweep_filter(white(n, rng), f_high * (f_low / f_high) ** (t / dur), 'low')
    chop = (rng.random(n // int(SR / chop_hz) + 2) ** 0.7)
    chop = np.interp(np.arange(n), np.arange(len(chop)) * (SR / chop_hz), chop)
    out = body * chop * smooth(t, 0, 0.01) * np.exp(-t / tau)
    out[: n_of(0.3)] += thump(thump_hz, thump_hz * 0.4, 0.3, 0.06)[: n_of(0.3)] * thump_gain * np.std(out[: n_of(0.3)]) * 3
    return out


def sfx_gegner_tod(rng):
    return fade_edges(crumble(rng, 0.7, 5200, 350, 0.28), 0.001, 0.12)


def sfx_gegner_tod_runner(rng):
    return fade_edges(crumble(rng, 0.45, 8500, 1200, 0.15, thump_hz=200, thump_gain=0.4, chop_hz=140), 0.001, 0.08)


def sfx_gegner_tod_brute(rng):
    out = crumble(rng, 1.2, 3000, 160, 0.5, thump_hz=70, thump_gain=1.2, chop_hz=55)
    n = n_of(0.5)
    t = np.arange(n) / SR
    groan = formant_voice(78 - 35 * t / 0.5, n, [(450, 3, 1.0), (800, 4, 0.5)], rng, breath=0.3)
    out[:n] += groan / (np.std(groan) + 1e-9) * 0.3 * np.exp(-t / 0.25)
    return fade_edges(out, 0.001, 0.2)


def sfx_gegner_tod_priester(rng):
    out = crumble(rng, 0.9, 6000, 500, 0.3, thump_hz=130, thump_gain=0.5)
    out = np.pad(out, (0, n_of(0.5)))
    place(out, chime(523.25, 1.0, 0.35, ((1, 1), (2.0, 0.3), (3.01, 0.15)), rng), 0.02, 0.35 * np.std(out[:5000]) * 5)
    return fade_edges(out, 0.001, 0.2)


def sfx_gegner_tod_mantel(rng):
    out = crumble(rng, 1.3, 2600, 200, 0.45, thump_hz=85, thump_gain=0.9, chop_hz=50)
    out += whoosh(rng, 1.3, 800, 180, peak=0.15, tail=0.4, q=0.5) * 0.5
    return fade_edges(out, 0.001, 0.2)


# --- Rufe der Horde ---------------------------------------------------------------


def sfx_gegner_laut_walker(rng):
    n = n_of(1.4)
    t = np.arange(n) / SR
    f0 = (105 - 28 * smooth(t, 0.2, 1.3)) * (1 + 0.03 * np.sin(2 * np.pi * 4.3 * t))
    voice = formant_voice(f0, n, [(560, 3, 1.0), (980, 4, 0.7), (2300, 7, 0.2)], rng, breath=0.35, rasp=0.35)
    env = smooth(t, 0, 0.25) * (1 - smooth(t, 0.9, 1.4))
    return fade_edges(voice / (np.std(voice) + 1e-9) * env, 0.01, 0.15)


def sfx_gegner_laut_runner(rng):
    n = n_of(0.9)
    t = np.arange(n) / SR
    carrier = 520 + 650 * smooth(t, 0, 0.3) - 280 * smooth(t, 0.4, 0.9)
    mod = sine(78.0, n) * 3.2
    out = np.sin(phase_of(carrier, n) + mod)
    out += bandpass(white(n, rng), 1800, 6000) * 0.5
    env = smooth(t, 0, 0.05) * (1 - smooth(t, 0.5, 0.9)) * (0.7 + 0.3 * np.sin(2 * np.pi * 31 * t))
    return fade_edges(out / (np.std(out) + 1e-9) * env, 0.005, 0.1)


def sfx_gegner_laut_brute(rng):
    n = n_of(1.7)
    t = np.arange(n) / SR
    f0 = 52 - 12 * smooth(t, 0.3, 1.6)
    growl = saw(f0, n) * (0.45 + 0.55 * np.abs(np.sin(2 * np.pi * 27 * t)))
    growl = resonance(growl, 260, 2.5) + 0.6 * resonance(growl, 640, 3.0) + lowpass(growl, 140)
    growl = np.tanh(1.6 * growl / (np.std(growl) + 1e-9))
    env = smooth(t, 0, 0.3) * (1 - smooth(t, 1.1, 1.7))
    return fade_edges(growl * env, 0.01, 0.2)


def sfx_gegner_laut_priester(rng):
    n = n_of(1.9)
    t = np.arange(n) / SR
    syllable = np.clip(np.sin(2 * np.pi * 5.0 * t) * np.sin(2 * np.pi * 1.7 * t + 0.5), 0, 1)
    whisper = bandpass(white(n, rng), 700, 2800) * syllable
    f0 = 196 * (1 + 0.012 * np.sin(2 * np.pi * 5.5 * t))
    tone = formant_voice(f0, n, [(500, 5, 1.0), (1500, 8, 0.4)], rng, breath=0.0)
    out = whisper / (np.std(whisper) + 1e-9) * 0.9 + tone / (np.std(tone) + 1e-9) * 0.35 * smooth(t, 0.2, 0.8)
    return fade_edges(out * smooth(t, 0, 0.2) * (1 - smooth(t, 1.4, 1.9)), 0.01, 0.2)


def sfx_gegner_laut_mantel(rng):
    n = n_of(2.2)
    t = np.arange(n) / SR
    breath = sweep_filter(colored(n, rng, 1), 300 + 450 * np.sin(np.pi * t / 2.2), 'low')
    out = breath / (np.std(breath) + 1e-9) + sine(64.0, n) * 0.6
    return fade_edges(out * smooth(t, 0, 0.7) * (1 - smooth(t, 1.4, 2.2)), 0.01, 0.2)


# --- Schwarzer Sog und Verschlinger -------------------------------------------------


def sfx_sog_ankuendigung(rng):
    n = n_of(1.6)
    t = np.arange(n) / SR
    pull = sweep_filter(white(n, rng), 180 + 3600 * (t / 1.6) ** 2, 'band', q=0.9)
    out = pull * smooth(t, 0, 1.4) * (1 - smooth(t, 1.4, 1.6)) * 1.0
    out += sine(70 + 90 * (t / 1.6) ** 2, n) * smooth(t, 0, 1.2) * 0.7
    out += sine(loop_freq(1480.0, 1.0), n) * smooth(t, 0.3, 1.5) * 0.06
    return fade_edges(out, 0.01, 0.05)


def sfx_sog_wirkung(rng):
    out = np.zeros(n_of(1.3))
    place(out, thump(70, 30, 1.0, 0.22), 0, 1.3)
    place(out, noise_hit(rng, 0, 1200, 0.4, 0.1), 0, 0.7)
    place(out, chime(1568.0, 1.2, 0.4, ((1, 1), (2.76, 0.4), (5.4, 0.2)), rng), 0.0, 0.18)
    place(out, whoosh(rng, 0.7, 4500, 500, peak=0.08, tail=0.25), 0.0, 0.5)
    return fade_edges(out, 0.001, 0.2)


def sfx_boss_erscheint(rng):
    length = 6.0
    n = n_of(length)
    t = np.arange(n) / SR
    horn = np.zeros(n)
    for f, a in [(55.0, 1.0), (55.5, 0.8), (110.2, 0.5)]:
        horn += a * (saw(f, n, rng.uniform(0, 1)) + 0.5 * square(f, n))
    cutoff = 140 + 1100 * smooth(t, 0.3, 2.4) - 700 * smooth(t, 3.2, 5.5)
    horn = sweep_filter(horn, cutoff, 'low', order=2)
    horn = horn / (np.std(horn) + 1e-9) * smooth(t, 0.2, 1.8) * (1 - smooth(t, 3.8, 6.0))
    sub = sine(27.5 + 6 * smooth(t, 0, 1.5), n) * smooth(t, 0.1, 1.0) * (1 - smooth(t, 3.5, 6.0)) * 1.4
    rumble = lowpass(colored(n, rng, 2), 180) * smooth(t, 0, 2.5) * (1 - smooth(t, 3.5, 6.0)) * 0.9
    out = horn * 0.9 + sub + rumble
    stereo = reverb(out, rt60=3.0, wet=0.3, seed='bossauf')
    return stereo.mean(axis=1)


def sfx_boss_hieb_ausholen(rng):
    n = n_of(0.8)
    t = np.arange(n) / SR
    f0 = 60 + 35 * smooth(t, 0, 0.7)
    growl = formant_voice(f0, n, [(300, 3, 1.0), (650, 4, 0.6)], rng, breath=0.4, rasp=0.3)
    env = smooth(t, 0, 0.5) * (1 - smooth(t, 0.65, 0.8))
    out = np.tanh(1.8 * growl * env / (np.std(growl) + 1e-9))
    out += whoosh(rng, 0.8, 300, 900, peak=0.85, tail=0.05, q=0.6) * 0.5
    return fade_edges(out, 0.01, 0.06)


def sfx_boss_hieb(rng):
    out = np.zeros(n_of(1.6))
    place(out, thump(95, 24, 1.4, 0.3), 0, 1.5)
    place(out, noise_hit(rng, 0, 1600, 0.7, 0.15), 0, 1.0)
    place(out, noise_hit(rng, 1500, 7000, 0.12, 0.02), 0, 0.5)
    place(out, crackle(rng, 1.0, 50, lo=500, hi=3000, strength=0.6) * np.exp(-taxis(1.0) / 0.35), 0.05, 0.8)
    place(out, whoosh(rng, 0.4, 400, 2000, peak=0.3, tail=0.1), 0, 0.5)
    return fade_edges(out, 0.001, 0.25)


def sfx_boss_ansturm(rng):
    n = n_of(2.0)
    t = np.arange(n) / SR
    f0 = 62 + 55 * smooth(t, 0, 1.2)
    roar = formant_voice(f0, n, [(420, 3, 1.0), (900, 4, 0.9), (1800, 5, 0.4)], rng, breath=0.55, rasp=0.4)
    env = smooth(t, 0, 0.35) * (1 - smooth(t, 1.2, 2.0))
    out = np.tanh(2.4 * roar * env / (np.std(roar) + 1e-9)) * 0.8
    out += lowpass(colored(n, rng, 2), 120) * smooth(t, 0, 1.0) * (1 - smooth(t, 1.2, 2.0)) * 0.8
    stereo = reverb(out, rt60=1.6, wet=0.2, seed='ansturm')
    return stereo.mean(axis=1)


def sfx_boss_aufprall(rng):
    out = np.zeros(n_of(1.6))
    place(out, thump(80, 22, 1.3, 0.28), 0, 1.5)
    place(out, noise_hit(rng, 150, 4500, 0.9, 0.2), 0, 0.9)
    place(out, crackle(rng, 1.3, 90, lo=400, hi=3500, strength=0.9, tau=0.006) * np.exp(-taxis(1.3) / 0.45), 0.08, 0.9)
    return fade_edges(out, 0.001, 0.3)


def sfx_boss_verschlingen(rng):
    length = 4.2
    n = n_of(length)
    t = np.arange(n) / SR
    f = 330 * (55.0 / 330) ** smooth(t, 0, length * 0.85)
    drone = saw(f, n) + 0.7 * saw(f * 1.004, n)
    drone = sweep_filter(drone, 400 + 1500 * np.exp(-t / 1.0), 'low')
    drone = drone / (np.std(drone) + 1e-9) * smooth(t, 0, 0.5) * (1 - smooth(t, 3.2, 4.2))
    whisper = bandpass(white(n, rng), 1500, 5200) * np.clip(np.sin(2 * np.pi * 3.7 * t) * np.sin(2 * np.pi * 1.3 * t), 0, 1)
    whisper = whisper / (np.std(whisper) + 1e-9) * smooth(t, 0.5, 2.0) * (1 - smooth(t, 3.0, 4.2)) * 0.35
    sub = sine(36.0, n) * smooth(t, 1.0, 2.5) * (1 - smooth(t, 3.4, 4.2)) * 1.3
    out = drone * 0.8 + whisper + sub
    stereo = reverb(out, rt60=3.4, wet=0.35, damping=0.7, seed='verschlingen')
    return stereo.mean(axis=1)


def sfx_boss_faellt(rng):
    length = 4.6
    n = n_of(length)
    t = np.arange(n) / SR
    f0 = 92 - 52 * smooth(t, 0, 1.6)
    groan = formant_voice(f0, n, [(380, 3, 1.0), (760, 4, 0.7), (1500, 6, 0.25)], rng, breath=0.5, rasp=0.35)
    groan = groan / (np.std(groan) + 1e-9) * smooth(t, 0, 0.2) * (1 - smooth(t, 1.0, 1.8))
    out = np.tanh(1.4 * groan)
    place(out, thump(70, 20, 2.0, 0.45), 1.4, 1.8)
    dust = sweep_filter(white(n, rng), 3200 * (0.06 ** (np.clip(t - 1.4, 0, None) / 3.0)) + 150, 'low')
    chop = rng.random(n // 490 + 2) ** 0.8
    chop = np.interp(np.arange(n), np.arange(len(chop)) * 490, chop)
    out += dust * chop * smooth(t, 1.4, 1.5) * np.exp(-np.clip(t - 1.4, 0, None) / 1.1) * 1.1
    stereo = reverb(out, rt60=2.6, wet=0.3, seed='faellt')
    return stereo.mean(axis=1)


# ---------------------------------------------------------------------------
# Musik
# ---------------------------------------------------------------------------


class Timeline:
    """Eine Schleife in Takten: Beat 0 ist der Anfang, alles darueber hinaus laeuft am Anfang weiter."""

    def __init__(self, bpm, bars, beats_per_bar=4):
        self.bpm = bpm
        self.beat_seconds = 60.0 / bpm
        self.beats = bars * beats_per_bar
        self.bars = bars
        self.beats_per_bar = beats_per_bar
        self.seconds = self.beats * self.beat_seconds
        self.buf = np.zeros((n_of(self.seconds), 2))

    def add(self, sig, at_beat, gain=1.0, pan=0.0):
        place(self.buf, stereo_of(sig, pan), at_beat * self.beat_seconds, gain, wrap=True)

    def bar(self, index):
        return index * self.beats_per_bar


def pad_note(f, dur, rng, attack=2.0, release=3.0, bright=1500, detune=0.0045, voices=3, vib=0.0):
    n = n_of(dur + release)
    t = np.arange(n) / SR
    mod = 1.0 + (vib * np.sin(2 * np.pi * 4.8 * t + rng.uniform(0, 6.28)) * smooth(t, 0.5, 2.5) if vib else 0.0)
    sig = np.zeros(n)
    for index in range(voices):
        d = (index - (voices - 1) / 2) * detune
        sig += saw(f * (1 + d) * mod, n, rng.uniform(0, 1))
    sig = lowpass(sig / voices, bright, 2)
    env = smooth(t, 0, attack) * (1 - smooth(t, dur, dur + release))
    return sig * env


def sub_note(f, dur, release=2.0):
    n = n_of(dur + release)
    t = np.arange(n) / SR
    env = smooth(t, 0, 1.0) * (1 - smooth(t, dur, dur + release))
    return (sine(f, n) + 0.25 * sine(f * 2, n)) * env


def cello_note(f, dur, rng, bright=1100):
    n = n_of(dur + 1.0)
    t = np.arange(n) / SR
    vib = 1.0 + 0.0035 * np.sin(2 * np.pi * 5.1 * t) * smooth(t, 0.4, 1.2)
    sig = saw(f * vib * 1.002, n) + saw(f * vib * 0.998, n, 0.3)
    sig = lowpass(sig * 0.5, bright, 2) + bandpass(white(n, rng), 800, 3000) * 0.015 * smooth(t, 0, 0.1)
    env = smooth(t, 0, 0.35) * (1 - smooth(t, dur, dur + 1.0))
    return sig * env


def strings_note(f, dur, rng, tremolo=7.0, bright=2600):
    n = n_of(dur + 1.0)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for d in (-0.006, 0.0, 0.006):
        sig += saw(f * (1 + d), n, rng.uniform(0, 1))
    sig = lowpass(sig / 3, bright, 2)
    trem = 0.55 + 0.45 * np.sin(2 * np.pi * tremolo * t + rng.uniform(0, 6.28))
    env = smooth(t, 0, 0.6) * (1 - smooth(t, dur, dur + 1.0))
    return sig * trem * env


def horn_note(f, dur, rng, bright=1500):
    n = n_of(dur + 0.8)
    t = np.arange(n) / SR
    sig = saw(f, n, rng.uniform(0, 1)) + 0.7 * saw(f * 1.006, n) + 0.4 * square(f, n)
    sig = sweep_filter(sig, 200 + bright * smooth(t, 0.0, 0.35) * (1 - 0.6 * smooth(t, dur * 0.6, dur)), 'low')
    env = smooth(t, 0, 0.12) * (1 - smooth(t, dur, dur + 0.8))
    return sig / (np.std(sig) + 1e-9) * env


def drum(kind, rng):
    if kind == 'tief':
        out = np.zeros(n_of(1.2))
        place(out, thump(95, 40, 1.1, 0.26), 0, 1.0)
        place(out, noise_hit(rng, 0, 380, 0.3, 0.05), 0, 0.5)
        return out
    if kind == 'leise':
        out = np.zeros(n_of(0.7))
        place(out, thump(120, 50, 0.6, 0.12), 0, 0.8)
        place(out, noise_hit(rng, 0, 500, 0.2, 0.03), 0, 0.4)
        return out
    if kind == 'tom':
        out = np.zeros(n_of(0.9))
        place(out, thump(165, 80, 0.8, 0.16), 0, 1.0)
        place(out, noise_hit(rng, 200, 1800, 0.12, 0.02), 0, 0.5)
        return out
    out = np.zeros(n_of(1.6))
    place(out, thump(78, 28, 1.5, 0.34), 0, 1.3)
    place(out, noise_hit(rng, 0, 1100, 0.5, 0.09), 0, 0.8)
    place(out, noise_hit(rng, 1200, 6000, 0.08, 0.012), 0, 0.3)
    return out


def dust_bed(rng, seconds, lo=600, hi=4500):
    """Feiner, ruhiger Staub als Teppich unter der Musik; kreisfoermig, damit er die Naht verbirgt."""
    n = n_of(seconds)
    bed = bandpass(colored(n, rng, 1), lo, hi, 2, circular=True)
    slow = lowpass(white(n, rng), 0.2, 2, circular=True)
    slow = np.clip(0.8 + 0.5 * slow / (np.std(slow) + 1e-9), 0.2, 1.5)
    return bed * slow


def render_track(tl, rt60, wet, seed, rms_db=-21.0):
    mixed = reverb(tl.buf, rt60=rt60, wet=wet, damping=0.6, seed=seed, circular=True)
    return finish(mixed, rms_db=rms_db, peak_db=-1.5)


def track_menue(rng):
    """Klassenwahl: Abendstimmung vor der Mauer. D-Moll, langsam, ein ferner Glockenschlag."""
    tl = Timeline(60, 16)
    chords = [
        ('D1', ['D3', 'A3', 'F4', 'C5']),
        ('Bb0', ['F3', 'A3', 'D4', 'F4']),
        ('G1', ['D3', 'F3', 'Bb3', 'D4']),
        ('A1', ['E3', 'G3', 'D4', 'E4']),
    ]
    for index, (bass, notes) in enumerate(chords):
        at = tl.bar(index * 4)
        dur = 4 * 4 * tl.beat_seconds + 1.5
        tl.add(sub_note(note_hz(bass) * 2, dur), at, 0.55, 0.0)
        for k, name in enumerate(notes):
            tl.add(pad_note(note_hz(name), dur, rng, attack=3.5, release=3.5, bright=1100, vib=0.002), at, 0.16, [-0.5, -0.15, 0.15, 0.5][k])
    scale = ['D5', 'E5', 'F5', 'G5', 'A5', 'C6', 'D6', 'A4', 'C5']
    for bar_index in range(16):
        if rng.random() < 0.62:
            note = scale[int(rng.integers(0, len(scale)))]
            beat = tl.bar(bar_index) + float(rng.choice([0.0, 1.5, 2.0, 3.0]))
            tl.add(pluck(note_hz(note), 7.0, rng, brightness=0.7, base_tau=2.2), beat, 0.16, float(rng.uniform(-0.7, 0.7)))
    # Fern, durch die Mauer gedaempft: die Abendglocke.
    for bar_index in (0, 8):
        distant = lowpass(bell(note_hz('D3'), 9.0, rng, tau_scale=1.1, brightness=0.5), 2200, 2)
        tl.add(distant, tl.bar(bar_index) + 0.0, 0.2, -0.3)
    tl.buf += stereo_of(dust_bed(rng, tl.seconds, 700, 3800), 0.0) * 0.025
    return render_track(tl, 3.4, 0.38, 'menue')


def track_nacht(rng):
    """Die Nacht: E-Phrygisch, tiefer Grundton, ferner Herzschlag. Ruhig genug, um 15 Minuten zu tragen."""
    tl = Timeline(72, 24)
    chords = [
        ('E1', ['E3', 'B3', 'E4', 'G4']),
        ('F1', ['F3', 'C4', 'F4', 'A4']),
        ('E1', ['E3', 'B3', 'G4', 'B4']),
        ('D1', ['D3', 'A3', 'D4', 'F4']),
    ]
    for index, (bass, notes) in enumerate(chords):
        at = tl.bar(index * 6)
        dur = 6 * 4 * tl.beat_seconds + 1.0
        tl.add(sub_note(note_hz(bass) * 2, dur), at, 0.6, 0.0)
        for k, name in enumerate(notes):
            tl.add(pad_note(note_hz(name), dur, rng, attack=4.0, release=4.0, bright=900, vib=0.0015), at, 0.13, [-0.55, -0.2, 0.2, 0.55][k])
    # Herzschlag: zwei dumpfe Schlaege, nur in der Mitte jedes Abschnitts.
    for bar_index in range(24):
        if bar_index % 6 in (2, 3, 4):
            tl.add(drum('leise', rng), tl.bar(bar_index), 0.5, -0.1)
            tl.add(drum('leise', rng), tl.bar(bar_index) + 0.75, 0.28, 0.1)
    # Ein langsames Motiv in den tiefen Streichern: (Ton, Beginn in Schlaegen, Laenge in Schlaegen).
    motif = [('E2', 0, 8), ('F2', 12, 6), ('E2', 18, 8), ('D2', 28, 12)]
    for section in range(4):
        for name, beat, length in motif[: 2 + (section % 2) * 2]:
            tl.add(cello_note(note_hz(name), length * tl.beat_seconds, rng), tl.bar(section * 6) + beat, 0.34, -0.25)
    scale = ['E5', 'F5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'B4']
    for bar_index in range(24):
        if rng.random() < 0.28:
            note = scale[int(rng.integers(0, len(scale)))]
            tl.add(pluck(note_hz(note), 5.5, rng, brightness=0.6, base_tau=1.7), tl.bar(bar_index) + float(rng.choice([0.5, 2.0, 3.5])), 0.1, float(rng.uniform(-0.8, 0.8)))
    wind = lowpass(white(n_of(tl.seconds), rng), 700, 2, circular=True)
    swell = np.zeros(n_of(tl.seconds))
    for bar_index in (4, 13, 20):
        at = n_of(tl.bar(bar_index) * tl.beat_seconds)
        length = n_of(6.0)
        env = np.sin(np.pi * np.arange(length) / length) ** 2
        idx = (np.arange(length) + at) % len(swell)
        swell[idx] += env
    tl.buf += stereo_of(wind * swell, 0.0) * 0.03
    tl.buf += stereo_of(dust_bed(rng, tl.seconds, 500, 3000), 0.0) * 0.02
    return render_track(tl, 3.8, 0.4, 'nacht')


def track_nacht_spaet(rng):
    """Gegen Ende der Nacht: derselbe Boden, aber ein Puls, schneidende Streicher und Naehe."""
    tl = Timeline(84, 28)
    chords = [
        ('E1', ['E3', 'B3', 'F4', 'G4']),
        ('F1', ['F3', 'C4', 'E4', 'A4']),
        ('E1', ['E3', 'Bb3', 'E4', 'G4']),
        ('G1', ['G3', 'D4', 'F4', 'Bb4']),
    ]
    for index, (bass, notes) in enumerate(chords):
        at = tl.bar(index * 7)
        dur = 7 * 4 * tl.beat_seconds + 1.0
        tl.add(sub_note(note_hz(bass) * 2, dur), at, 0.7, 0.0)
        for k, name in enumerate(notes):
            tl.add(strings_note(note_hz(name), dur, rng, tremolo=6.0 + k, bright=1900), at, 0.12, [-0.6, -0.25, 0.25, 0.6][k])
            tl.add(pad_note(note_hz(name) / 2, dur, rng, attack=3.0, release=3.0, bright=700), at, 0.1, 0.0)
    # Pulsierender Herzschlag auf jedem Schlag, in der Mitte der Abschnitte dichter.
    for bar_index in range(28):
        local = bar_index % 7
        for beat in (0, 2):
            tl.add(drum('tief', rng), tl.bar(bar_index) + beat, 0.5 if local < 5 else 0.62, -0.1)
        if local >= 4:
            tl.add(drum('leise', rng), tl.bar(bar_index) + 3.5, 0.35, 0.1)
    # Ein Ostinato aus gezupften tiefen Toenen, das sich durch die Takte zieht.
    pattern = ['E3', None, 'E3', 'F3', None, 'E3', 'B2', None]
    for bar_index in range(28):
        if bar_index % 7 < 2:
            continue
        for step, name in enumerate(pattern):
            if name:
                tl.add(pluck(note_hz(name), 0.9, rng, brightness=0.7, base_tau=0.25), tl.bar(bar_index) + step * 0.5, 0.18, -0.15)
    for bar_index in (6, 13, 20, 27):
        tl.add(drum('tom', rng), tl.bar(bar_index) + 3.0, 0.4, 0.3)
        tl.add(drum('tom', rng), tl.bar(bar_index) + 3.5, 0.5, -0.3)
    tl.buf += stereo_of(dust_bed(rng, tl.seconds, 500, 3500), 0.0) * 0.03
    return render_track(tl, 3.2, 0.34, 'nachtspaet')


def track_boss(rng):
    """Der Verschlinger: tiefe Stoesse, ein Tritonus als Dauerzustand, Hoerner und Tremolo."""
    tl = Timeline(96, 24)
    for index in range(3):
        at = tl.bar(index * 8)
        dur = 8 * 4 * tl.beat_seconds + 1.0
        low, high = [('C1', 'Gb3'), ('Db1', 'G3'), ('C1', 'Gb3')][index]
        tl.add(sub_note(note_hz(low) * 2, dur), at, 0.8, 0.0)
        for k, name in enumerate(['C3', 'G3', high, 'C4']):
            tl.add(strings_note(note_hz(name), dur, rng, tremolo=7.5 + k * 0.5, bright=2200), at, 0.12, [-0.55, -0.2, 0.2, 0.55][k])
        tl.add(pad_note(note_hz('C2'), dur, rng, attack=1.5, release=2.0, bright=500, voices=3), at, 0.2, 0.0)
    for bar_index in range(24):
        tl.add(drum('boss', rng), tl.bar(bar_index), 0.78, 0.0)
        if bar_index % 2 == 1:
            tl.add(drum('tief', rng), tl.bar(bar_index) + 2.5, 0.5, 0.15)
        tl.add(drum('tief', rng), tl.bar(bar_index) + 3.0, 0.38, -0.15)
        if bar_index % 4 == 3:
            tl.add(drum('tom', rng), tl.bar(bar_index) + 3.5, 0.55, 0.4)
    # Hoerner antworten sich in langen, tiefen Rufen.
    calls = [(0, 'C2', 6), (4, 'Gb2', 4), (8, 'C2', 6), (12, 'Db2', 4), (16, 'C2', 5), (20, 'Gb2', 3)]
    for bar_index, name, length in calls:
        tl.add(horn_note(note_hz(name), length * tl.beat_seconds, rng, bright=1500), tl.bar(bar_index), 0.5, 0.1)
    # Ein Cluster aus hohen Streichern setzt alle acht Takte in der Mitte ein und haelt bis zum naechsten Abschnitt.
    for start in (0, 8, 16):
        for k, name in enumerate(['C5', 'Db5', 'Gb5', 'G5']):
            length = 4 * tl.beats_per_bar * tl.beat_seconds
            tl.add(strings_note(note_hz(name), length, rng, tremolo=8.0, bright=3200), tl.bar(start + 4), 0.045 * (1 + 0.15 * k), [-0.6, -0.2, 0.2, 0.6][k])
    tl.buf += stereo_of(dust_bed(rng, tl.seconds, 400, 3000), 0.0) * 0.03
    return render_track(tl, 2.6, 0.26, 'boss', rms_db=-19.5)


def stinger_sieg(rng):
    """Sor geht auf: Der Staub hellt auf, die Glocke schlaegt einmal, ein warmer Akkord loest die Spannung."""
    seconds = 18.0
    buf = np.zeros((n_of(seconds), 2))

    def add(sig, at, gain=1.0, pan=0.0):
        place(buf, stereo_of(sig, pan), at, gain)

    add(sub_note(note_hz('D1') * 2, 14.0, release=3.0), 0.0, 0.6)
    add(bell(note_hz('A3'), 10.0, rng, tau_scale=1.4), 0.8, 0.7)
    chord = ['D3', 'A3', 'D4', 'E4', 'A4', 'F#5']
    for k, name in enumerate(chord):
        add(pad_note(note_hz(name), 11.0, rng, attack=4.0, release=4.0, bright=1500, vib=0.002), 1.5, 0.15, [-0.6, -0.3, -0.1, 0.1, 0.3, 0.6][k])
    for k, name in enumerate(['D5', 'F#5', 'A5', 'E5', 'D6']):
        add(pluck(note_hz(name), 6.0, rng, brightness=0.8, base_tau=2.0), 4.5 + 1.1 * k, 0.17, float(rng.uniform(-0.6, 0.6)))
    mixed = reverb(pad_seconds(buf, 5.0), rt60=4.0, wet=0.4, damping=0.5, seed='sieg', circular=False)
    mixed = mixed[: n_of(seconds)]
    mixed *= (1 - smooth(np.arange(len(mixed)) / SR, seconds - 3.5, seconds))[:, None]
    return finish(mixed, rms_db=-21.0, peak_db=-1.5)


def stinger_niederlage(rng):
    """Gefallen oder verstaubt: ein Glockenschlag, ein sinkender Akkord, dann Stille."""
    seconds = 12.0
    buf = np.zeros((n_of(seconds), 2))

    def add(sig, at, gain=1.0, pan=0.0):
        place(buf, stereo_of(sig, pan), at, gain)

    add(bell(note_hz('E3'), 9.0, rng, tau_scale=1.2, brightness=0.7), 0.0, 0.8)
    for k, name in enumerate(['E2', 'B2', 'F3', 'B3']):
        add(pad_note(note_hz(name), 6.0, rng, attack=1.5, release=5.0, bright=700, vib=0.002), 0.6, 0.2, [-0.4, -0.1, 0.1, 0.4][k])
    n = n_of(8.0)
    t = np.arange(n) / SR
    fall = sine(55.0 * (0.62 ** smooth(t, 1.0, 7.0)), n) * smooth(t, 0.5, 1.5) * (1 - smooth(t, 5.5, 8.0))
    add(fall, 1.0, 0.7)
    whisper = bandpass(white(n, rng), 1500, 5000) * np.clip(np.sin(2 * np.pi * 2.9 * t) * np.sin(2 * np.pi * 1.1 * t), 0, 1)
    add(whisper / (np.std(whisper) + 1e-9) * smooth(t, 0.5, 2.5) * (1 - smooth(t, 4.0, 8.0)), 1.0, 0.04)
    mixed = reverb(pad_seconds(buf, 5.0), rt60=4.2, wet=0.42, damping=0.7, seed='niederlage', circular=False)
    mixed = mixed[: n_of(seconds)]
    mixed *= (1 - smooth(np.arange(len(mixed)) / SR, seconds - 3.0, seconds))[:, None]
    return finish(mixed, rms_db=-22.0, peak_db=-1.5)


# ---------------------------------------------------------------------------
# Liste aller Dateien
# ---------------------------------------------------------------------------

SFX_RMS = -20.0


def variants(fn, count):
    return [(lambda rng, i=i: fn(rng, i)) for i in range(count)]


def build_catalogue():
    """Name (Pfad ohne Endung unter public/audio) -> (Funktion, Zielpegel in dB, ist_Musik)."""
    cat = {}

    def sfx(name, fn, rms=SFX_RMS):
        cat[name] = (fn, rms, False)

    def many(base, fn, count, rms=SFX_RMS):
        for index, variant in enumerate(variants(fn, count)):
            sfx('%s-%d' % (base, index + 1), variant, rms)

    sfx('sfx/abendglocke', sfx_abendglocke, -18.0)
    many('sfx/spieler-treffer', sfx_spieler_treffer, 3, -17.0)
    sfx('sfx/spieler-verstaubt', sfx_spieler_verstaubt, -19.0)
    sfx('sfx/schild-faengt', sfx_schild_faengt, -19.0)
    sfx('sfx/schild-bereit', sfx_schild_bereit, -22.0)
    many('sfx/schritt', sfx_schritt, 3, -24.0)
    many('sfx/eingesammelt', sfx_eingesammelt, 3, -21.0)
    sfx('sfx/stufe', sfx_stufe, -19.0)
    sfx('sfx/segen', sfx_segen, -19.0)
    sfx('sfx/auswahl', sfx_auswahl, -24.0)
    sfx('sfx/bestaetigen', sfx_bestaetigen, -20.0)
    sfx('sfx/pause', sfx_pause, -22.0)

    sfx('sfx/feuer-entzuenden', sfx_feuer_entzuenden, -21.0)
    sfx('sfx/feuer-entzuendet', sfx_feuer_entzuendet, -18.0)
    sfx('sfx/feuer-erlischt', sfx_feuer_erlischt, -22.0)
    sfx('sfx/feuer-geloescht', sfx_feuer_geloescht, -18.0)
    cat['schleifen/feuer-knistern'] = (loop_feuer_knistern, -22.0, False)
    cat['schleifen/wind-nacht'] = (loop_wind_nacht, -26.0, False)
    cat['schleifen/finsternis-brummen'] = (loop_finsternis_brummen, -24.0, False)

    sfx('sfx/angriff-axthieb', sfx_angriff_axthieb)
    sfx('sfx/angriff-wuchthieb', sfx_angriff_wuchthieb, -18.0)
    sfx('sfx/angriff-wirbelschlag', sfx_angriff_wirbelschlag, -18.0)
    sfx('sfx/angriff-kriegsschrei', sfx_angriff_kriegsschrei, -19.0)
    sfx('sfx/angriff-wurfaxt', sfx_angriff_wurfaxt)
    sfx('sfx/angriff-bogenschuss', sfx_angriff_bogenschuss)
    sfx('sfx/angriff-pfeilhagel', sfx_angriff_pfeilhagel)
    sfx('sfx/einschlag-pfeilhagel', sfx_einschlag_pfeilhagel, -21.0)
    sfx('sfx/angriff-fangeisen', sfx_angriff_fangeisen, -23.0)
    sfx('sfx/einschlag-fangeisen', sfx_einschlag_fangeisen, -20.0)
    sfx('sfx/angriff-wurfmesser', sfx_angriff_wurfmesser)
    sfx('sfx/angriff-hitze-werfen', sfx_angriff_hitze_werfen)
    sfx('sfx/angriff-sorlanze', sfx_angriff_sorlanze, -19.0)
    sfx('sfx/angriff-glut-formen', sfx_angriff_glut_formen, -25.0)
    sfx('sfx/angriff-erdstoss', sfx_angriff_erdstoss, -17.0)
    sfx('sfx/angriff-wurzelgriff', sfx_angriff_wurzelgriff, -21.0)
    sfx('sfx/angriff-sturmboee', sfx_angriff_sturmboee, -20.0)
    sfx('sfx/angriff-sorhennas-brand', sfx_angriff_sorhennas_brand, -19.0)

    many('sfx/treffer-stahl', sfx_treffer_stahl, 3, -21.0)
    many('sfx/treffer-staub', sfx_treffer_staub, 3, -22.0)
    many('sfx/treffer-brand', sfx_treffer_brand, 3, -23.0)
    sfx('sfx/gegner-tod', sfx_gegner_tod, -22.0)
    sfx('sfx/gegner-tod-runner', sfx_gegner_tod_runner, -23.0)
    sfx('sfx/gegner-tod-brute', sfx_gegner_tod_brute, -19.0)
    sfx('sfx/gegner-tod-priester', sfx_gegner_tod_priester, -22.0)
    sfx('sfx/gegner-tod-mantel', sfx_gegner_tod_mantel, -21.0)
    sfx('sfx/gegner-laut-walker', sfx_gegner_laut_walker, -24.0)
    sfx('sfx/gegner-laut-runner', sfx_gegner_laut_runner, -25.0)
    sfx('sfx/gegner-laut-brute', sfx_gegner_laut_brute, -22.0)
    sfx('sfx/gegner-laut-priester', sfx_gegner_laut_priester, -25.0)
    sfx('sfx/gegner-laut-mantel', sfx_gegner_laut_mantel, -25.0)

    sfx('sfx/sog-ankuendigung', sfx_sog_ankuendigung, -21.0)
    sfx('sfx/sog-wirkung', sfx_sog_wirkung, -18.0)
    sfx('sfx/boss-erscheint', sfx_boss_erscheint, -15.0)
    sfx('sfx/boss-hieb-ausholen', sfx_boss_hieb_ausholen, -19.0)
    sfx('sfx/boss-hieb', sfx_boss_hieb, -15.0)
    sfx('sfx/boss-ansturm', sfx_boss_ansturm, -17.0)
    sfx('sfx/boss-aufprall', sfx_boss_aufprall, -15.0)
    sfx('sfx/boss-verschlingen', sfx_boss_verschlingen, -17.0)
    sfx('sfx/boss-faellt', sfx_boss_faellt, -15.0)

    cat['musik/menue'] = (track_menue, None, True)
    cat['musik/nacht'] = (track_nacht, None, True)
    cat['musik/nacht-spaet'] = (track_nacht_spaet, None, True)
    cat['musik/boss'] = (track_boss, None, True)
    cat['musik/sieg'] = (stinger_sieg, None, True)
    cat['musik/niederlage'] = (stinger_niederlage, None, True)
    return cat


# ---------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------


def write_wav(path, data):
    data = np.clip(data, -1.0, 1.0)
    channels = 1 if data.ndim == 1 else data.shape[1]
    pcm = (data * 32767.0).astype('<i2')
    with wave.open(path, 'wb') as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def encode(wav_path, out_path, quality):
    command = [
        'ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
        '-c:a', 'libvorbis', '-q:a', str(quality), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
        out_path,
    ]
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description='Erzeugt die Klaenge des Spiels.')
    parser.add_argument('--only', help='nur Dateien, deren Name diesen Text enthaelt')
    parser.add_argument('--list', action='store_true', help='nur die Namen zeigen')
    parser.add_argument('--format', choices=['ogg', 'wav'], default='ogg')
    parser.add_argument('--out', default=DEFAULT_OUT, help='Zielordner (Standard: public/audio)')
    args = parser.parse_args()

    catalogue = build_catalogue()
    names = [name for name in catalogue if not args.only or args.only in name]
    if args.list:
        print('\n'.join(names))
        return
    if not names:
        sys.exit('Nichts gefunden fuer --only %s' % args.only)
    if args.format == 'ogg' and not shutil.which('ffmpeg'):
        sys.exit('ffmpeg fehlt. Installieren oder --format wav verwenden.')

    with tempfile.TemporaryDirectory() as scratch:
        for name in names:
            function, rms_db, is_music = catalogue[name]
            rng = rng_for(name)
            audio = function(rng)
            if rms_db is not None:
                audio = finish(audio, rms_db=rms_db, peak_db=-1.0)
            seconds = len(audio) / SR
            target = os.path.join(args.out, name + '.' + args.format)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if args.format == 'wav':
                write_wav(target, audio)
            else:
                wav_path = os.path.join(scratch, os.path.basename(name) + '.wav')
                write_wav(wav_path, audio)
                encode(wav_path, target, 3 if is_music else 4)
            print('%-34s %6.2f s  %7.1f kB' % (name, seconds, os.path.getsize(target) / 1024.0))


if __name__ == '__main__':
    main()
