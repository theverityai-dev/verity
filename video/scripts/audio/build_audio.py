"""Synthesise the film's music bed, ambience and sound effects. Every sound is original.

Reads  content/timeline.json (act and scene boundaries)
Writes public/audio/music.wav      stereo 48 kHz, the evolving bed
       public/audio/ambience.wav   stereo 48 kHz, factory room tone (Act I), quiet room after
       public/audio/sfx/<name>.wav mono 48 kHz, the sample library named in src/film/sfx.ts

Deterministic (fixed seed): the same timeline always produces the same audio. No sample, loop or
preset from anywhere else is used, so there is nothing to license.

Music plan (docs/sound-design.md): D minor drone and a slow pulse while the owner is overloaded
(Act I); at s03 the harmony turns to D major and a soft plucked figure begins (Act II); Act III
opens up with a high pad; Act IV thins to pad and sparse notes; Act V resolves on Dmaj9 and decays.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
SR = 48_000
RNG = np.random.default_rng(20261021)


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_adsr(n: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    """Attack/decay/sustain/release in seconds over n samples (release at the tail)."""
    e = np.full(n, s, dtype=np.float64)
    na = min(int(a * SR), n)
    e[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(int(d * SR), n - na)
    e[na : na + nd] = np.linspace(1, s, nd, endpoint=False)
    nr = min(int(r * SR), n)
    e[n - nr :] *= np.linspace(1, 0, nr)
    return e


def add(buf: np.ndarray, at: float, sig: np.ndarray, pan: float = 0.0, gain: float = 1.0) -> None:
    """Mix a mono signal into a stereo buffer at `at` seconds with equal-power pan (-1..1)."""
    i = int(at * SR)
    if i >= buf.shape[0]:
        return
    sig = sig[: buf.shape[0] - i]
    buf[i : i + len(sig), 0] += sig * np.cos((pan + 1) * np.pi / 4) * gain
    buf[i : i + len(sig), 1] += sig * np.sin((pan + 1) * np.pi / 4) * gain


def pad_voice(f: float, dur: float, a: float = 3.0, r: float = 3.0, bright: float = 0.25) -> np.ndarray:
    """A warm pad note: three detuned sines plus soft second and third partials."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for det in (-0.12, 0.0, 0.13):
        ph = RNG.uniform(0, 2 * np.pi)
        fr = f * 2 ** (det / 12)
        sig += np.sin(2 * np.pi * fr * t + ph) + bright * 0.5 * np.sin(4 * np.pi * fr * t + ph) + bright * 0.18 * np.sin(6 * np.pi * fr * t)
    sig *= 1 + 0.08 * np.sin(2 * np.pi * 0.11 * t + RNG.uniform(0, 6))
    return sig / 3 * env_adsr(n, a, 1.0, 0.85, r)


def pluck(f: float, dur: float = 2.2, tone: float = 1.0) -> np.ndarray:
    """A soft felt-piano-like pluck: decaying, slightly inharmonic partials."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for k, amp in enumerate((1.0, 0.42, 0.2, 0.09, 0.05), start=1):
        fk = f * k * (1 + 0.0004 * k * k)
        sig += amp * tone ** (k - 1) * np.sin(2 * np.pi * fk * t) * np.exp(-t * (2.2 + 1.8 * k))
    return sig * np.minimum(1, t / 0.006) * 0.6


def kick(dur: float = 0.6) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 52 + 40 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * 0.9


def reverb(x: np.ndarray, seconds: float = 3.2, mix: float = 0.32) -> np.ndarray:
    """FFT convolution with decorrelated exponential-noise impulse responses, per channel."""
    n_ir = int(seconds * SR)
    t = np.arange(n_ir) / SR
    out = np.empty_like(x)
    size = 1 << int(np.ceil(np.log2(x.shape[0] + n_ir)))
    for ch in range(x.shape[1]):
        ir = RNG.standard_normal(n_ir) * np.exp(-t * 6.9 / seconds)
        ir[: int(0.012 * SR)] = 0  # pre-delay
        ir /= np.sqrt(np.sum(ir**2))
        wet = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[: x.shape[0]]
        out[:, ch] = (1 - mix) * x[:, ch] + mix * wet * 0.9
    return out


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Whole-signal FFT low-pass with a soft roll-off."""
    spec = np.fft.rfft(x, axis=0)
    freqs = np.fft.rfftfreq(x.shape[0], 1 / SR)
    h = 1 / np.sqrt(1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(spec * (h[:, None] if x.ndim == 2 else h), x.shape[0], axis=0)


def bandnoise(dur: float, lo: float, hi: float) -> np.ndarray:
    n = int(dur * SR)
    spec = np.fft.rfft(RNG.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec[(freqs < lo) | (freqs > hi)] = 0
    s = np.fft.irfft(spec, n)
    return s / (np.max(np.abs(s)) + 1e-9)


def normalise(x: np.ndarray, peak_db: float) -> np.ndarray:
    return x * (10 ** (peak_db / 20) / (np.max(np.abs(x)) + 1e-9))


# Chords (MIDI notes) for the bed.
D_MIN = [38, 45, 50, 53, 57]
PROG = [
    [38, 50, 54, 57, 64],  # Dmaj9
    [35, 50, 54, 57, 62],  # Bm7
    [31, 50, 55, 59, 62],  # Gmaj7
    [33, 49, 52, 57, 62],  # A, suspended colour
]
ARP = [[62, 66, 69, 76], [59, 62, 66, 69], [62, 67, 71, 74], [61, 64, 69, 74]]


def build_music(tl: dict) -> np.ndarray:
    total = tl["total"] + 1.5
    sc = {s["id"]: s for s in tl["scenes"]}
    buf = np.zeros((int(total * SR), 2))
    act2, act3, act4, act5 = sc["s03"]["start"], sc["s12"]["start"], sc["s15"]["start"], sc["s16"]["start"]

    # Act I: D minor drone, slowly widening; a low pulse once the questions start.
    for f_m, pan in zip(D_MIN, (-0.2, 0.3, -0.4, 0.4, 0.0)):
        add(buf, 0.0, pad_voice(hz(f_m), act2 + 2.5, a=6.0, r=2.5, bright=0.12), pan, 0.13 if f_m > 40 else 0.2)
    t, k = sc["s02"]["start"] - 1.0, 0
    while t < act2 - 0.6:
        add(buf, t, kick(), 0.0, 0.18 + 0.12 * min(1, k / 8))
        t += 1.25
        k += 1

    # Acts II-III: the harmony turns. Four chords, 2 bars each at 100 bpm (4.8 s per chord).
    bar = 2.4
    chord_len = 2 * bar
    t, i = act2, 0
    while t < act4:
        chord = PROG[i % 4]
        third_act = t >= act3
        for j, m in enumerate(chord):
            add(buf, t, pad_voice(hz(m), chord_len + 2.0, a=1.6 if i else 2.5, r=2.0, bright=0.3 if third_act else 0.22), (-0.5, -0.15, 0.15, 0.45, 0.0)[j], 0.09 if j else 0.16)
        if third_act:
            add(buf, t, pad_voice(hz(chord[3] + 12), chord_len + 2.0, a=2.0, r=2.0, bright=0.1), 0.6, 0.04)
        if t >= sc["s04"]["start"] - 0.1:
            notes = ARP[i % 4]
            for q in range(8):
                vel = 0.55 + 0.25 * np.sin(q / 8 * np.pi) + RNG.uniform(-0.05, 0.05)
                add(buf, t + q * bar / 4, pluck(hz(notes[q % 4]), 1.8, tone=0.8), (-0.35, 0.35)[q % 2], 0.085 * vel)
            add(buf, t, pad_voice(hz(chord[0] - 12 if chord[0] > 30 else chord[0]), chord_len, a=0.4, r=0.8, bright=0.0), 0.0, 0.11)
        t += chord_len
        i += 1

    # Act IV: pad and sparse notes, thinner.
    t = act4
    while t < act5:
        chord = PROG[i % 4]
        for j, m in enumerate(chord[1:]):
            add(buf, t, pad_voice(hz(m), chord_len + 2.0, a=2.0, r=2.5, bright=0.15), (-0.4, -0.1, 0.1, 0.4)[j], 0.08)
        for q in (0, 3, 6):
            add(buf, t + q * bar / 4, pluck(hz(ARP[i % 4][q % 4] + 12), 2.4, tone=0.7), 0.2, 0.06)
        t += chord_len
        i += 1

    # Act V: resolve on Dmaj9, swell and long decay.
    for j, m in enumerate([38, 50, 57, 62, 64, 66, 69]):
        add(buf, act5, pad_voice(hz(m), total - act5, a=1.4, r=max(4.0, total - act5 - 2.0), bright=0.2), (-0.5, -0.2, 0.0, 0.2, 0.4, -0.3, 0.3)[j], 0.1)
    for q, m in enumerate([62, 66, 69, 74]):
        add(buf, act5 + 0.4 + q * 0.35, pluck(hz(m), 3.5, tone=0.8), (-0.3, 0.3)[q % 2], 0.07)

    buf = reverb(buf, 3.6, 0.35)
    n = buf.shape[0]
    buf[: int(2.0 * SR)] *= np.linspace(0, 1, int(2.0 * SR))[:, None]
    buf[n - int(3.0 * SR) :] *= np.linspace(1, 0, int(3.0 * SR))[:, None]
    return normalise(buf, -3.0)


def build_ambience(tl: dict) -> np.ndarray:
    total = tl["total"] + 1.5
    sc = {s["id"]: s for s in tl["scenes"]}
    n = int(total * SR)
    t = np.arange(n) / SR
    room = lowpass(RNG.standard_normal((n, 2)), 420.0)
    room /= np.max(np.abs(room))
    hum = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((100, 0.5), (150, 0.25), (200, 0.12)))
    bed = room * 0.6 + hum[:, None] * 0.05
    act2 = sc["s03"]["start"]
    # Distant metal: inharmonic, decaying clanks at seeded times through Act I.
    for at in np.sort(RNG.uniform(1.0, act2 - 2.0, 9)):
        m = int(2.5 * SR)
        tt = np.arange(m) / SR
        base = RNG.uniform(180, 420)
        clank = sum(np.sin(2 * np.pi * base * r * tt) * np.exp(-tt * (3 + 2 * r)) for r in (1, 2.76, 5.4, 8.93)) * 0.25
        i = int(at * SR)
        pan = RNG.uniform(-0.8, 0.8)
        bed[i : i + m, 0] += clank[: n - i] * np.cos((pan + 1) * np.pi / 4)
        bed[i : i + m, 1] += clank[: n - i] * np.sin((pan + 1) * np.pi / 4)
    # Level over time: present in Act I, a quiet room after, a little more in Act IV.
    level = np.full(n, 0.12)
    a1 = int(act2 * SR)
    level[:a1] = 1.0
    xf = int(2.5 * SR)
    level[a1 : a1 + xf] = np.linspace(1.0, 0.12, xf)
    level[int(sc["s15"]["start"] * SR) : int(sc["s16"]["start"] * SR)] = 0.3
    level[: int(1.5 * SR)] *= np.linspace(0, 1, int(1.5 * SR))
    level[n - int(3 * SR) :] *= np.linspace(1, 0, int(3 * SR))
    return normalise(reverb(bed * level[:, None], 2.0, 0.25), -10.0)


def build_sfx() -> dict:
    out = {}

    def tt(d: float) -> np.ndarray:
        return np.arange(int(d * SR)) / SR

    t = tt(0.42)
    buzz = np.sign(np.sin(2 * np.pi * 168 * t)) * 0.5 + np.sin(2 * np.pi * 336 * t) * 0.3
    out["buzz"] = lowpass(buzz * ((t % 0.21) < 0.13) * np.minimum(1, t / 0.01), 900.0)

    t = tt(0.06)
    out["tick"] = np.sin(2 * np.pi * 1750 * t) * np.exp(-t * 90) + bandnoise(0.06, 2000, 6000) * np.exp(-t * 160) * 0.3
    out["press"] = np.sin(2 * np.pi * 620 * t) * np.exp(-t * 70) + bandnoise(0.06, 800, 3000) * np.exp(-t * 120) * 0.25

    t = tt(1.1)
    out["confirm"] = (np.sin(2 * np.pi * hz(88) * t) * np.exp(-t * 4.5) + np.where(t > 0.09, np.sin(2 * np.pi * hz(95) * (t - 0.09)) * np.exp(-(t - 0.09) * 4.0), 0)) * 0.5

    t = tt(0.6)
    out["refuse"] = (np.sin(2 * np.pi * hz(57) * t) * np.exp(-t * 7) + np.where(t > 0.12, np.sin(2 * np.pi * hz(53) * (t - 0.12)) * np.exp(-(t - 0.12) * 6), 0)) * 0.6

    t = tt(0.3)
    out["shutter"] = bandnoise(0.3, 1500, 9000) * (np.exp(-t * 60) + np.where(t > 0.07, np.exp(-(t - 0.07) * 45), 0)) * 0.8

    # Whoosh: windowed noise grains with a band that rises then falls.
    n = int(0.9 * SR)
    wh = np.zeros(n)
    grain = int(0.06 * SR)
    win = np.hanning(grain)
    for g in range(0, n - grain, grain // 2):
        k = g / n
        centre = 300 + 2400 * np.sin(np.pi * k)
        wh[g : g + grain] += bandnoise(grain / SR, centre * 0.6, centre * 1.6) * win * np.sin(np.pi * k) ** 1.5
    out["whoosh"] = wh * 0.6

    t = tt(0.35)
    rustle = bandnoise(0.35, 1200, 7000) * (0.5 + 0.5 * (RNG.random(len(t)) > 0.97))
    out["paper"] = lowpass(rustle, 5000.0) * np.exp(-t * 8) * 0.8

    t = tt(0.5)
    out["stamp"] = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-t * 40)) / SR) * np.exp(-t * 11) + bandnoise(0.5, 400, 3000) * np.exp(-t * 60) * 0.35

    t = tt(1.6)
    out["swell"] = bandnoise(1.6, 3000, 12000) * (t / 1.6) ** 2.5 * np.exp(-np.maximum(0, t - 1.45) * 30) * 0.5 + np.sin(2 * np.pi * hz(74) * t) * (t / 1.6) ** 3 * 0.25

    t = tt(5.0)
    out["low"] = (np.sin(2 * np.pi * hz(38) * t) + 0.4 * np.sin(2 * np.pi * hz(50) * t)) * np.minimum(1, t / 0.4) * np.exp(-t * 0.8) * 0.8

    return {k: normalise(np.asarray(v, dtype=np.float64), -6.0) for k, v in out.items()}


def main() -> int:
    tl = json.loads((ROOT / "content" / "timeline.json").read_text(encoding="utf8"))
    audio = ROOT / "public" / "audio"
    (audio / "sfx").mkdir(parents=True, exist_ok=True)
    for name, sig in build_sfx().items():
        sf.write(audio / "sfx" / f"{name}.wav", sig.astype(np.float32), SR, subtype="PCM_16")
    print("sfx written")
    sf.write(audio / "ambience.wav", build_ambience(tl).astype(np.float32), SR, subtype="PCM_16")
    print("ambience written")
    sf.write(audio / "music.wav", build_music(tl).astype(np.float32), SR, subtype="PCM_16")
    print(f"music written ({tl['total']:.1f}s + tail)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
