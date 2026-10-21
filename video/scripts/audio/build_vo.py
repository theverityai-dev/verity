"""Render the scratch narration, one WAV per cue, and record each cue's length.

Reads  content/narration.json
Writes public/audio/vo/<id>.wav  (mono, 24 kHz, trimmed, level-matched)
       content/vo-timing.json    ({ id: seconds })

Kokoro v1.0 (Apache-2.0) runs offline through kokoro-onnx. The model files are not in
the repository (about 350 MB); point KOKORO_DIR at a folder holding kokoro-v1.0.onnx and
voices-v1.0.bin (README, "Narration"). A professional voice-over replaces these files
one-for-one: keep the ids, rerun this script with --measure-only, and the scenes re-time.
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "content" / "narration.json"
OUT_DIR = ROOT / "public" / "audio" / "vo"
TIMING = ROOT / "content" / "vo-timing.json"

# Level target for every cue: matched RMS, then a peak ceiling, so no cue jumps out of the mix.
TARGET_RMS_DB = -20.0
PEAK_CEILING_DB = -3.0
# Silence kept at each end after trimming, in seconds: enough for the consonant tails.
PAD = 0.06


def db(x: float) -> float:
    return 10 ** (x / 20)


def trim(samples: np.ndarray, rate: int) -> np.ndarray:
    """Drop leading and trailing silence below -45 dBFS (20 ms windows), keep PAD seconds."""
    win = int(rate * 0.02)
    frames = len(samples) // win
    if frames == 0:
        return samples
    rms = np.sqrt(np.mean(samples[: frames * win].reshape(frames, win) ** 2, axis=1) + 1e-12)
    loud = np.where(rms > db(-45))[0]
    if len(loud) == 0:
        return samples
    start = max(loud[0] * win - int(PAD * rate), 0)
    end = min((loud[-1] + 1) * win + int(PAD * rate), len(samples))
    return samples[start:end]


def level(samples: np.ndarray, rate: int) -> np.ndarray:
    rms = np.sqrt(np.mean(samples**2) + 1e-12)
    out = samples * (db(TARGET_RMS_DB) / rms)
    peak = np.max(np.abs(out))
    if peak > db(PEAK_CEILING_DB):
        out = out * (db(PEAK_CEILING_DB) / peak)
    # 5 ms fades so a cut never clicks.
    fade = int(0.005 * rate)
    ramp = np.linspace(0, 1, fade)
    out[:fade] *= ramp
    out[-fade:] *= ramp[::-1]
    return out.astype(np.float32)


def measure() -> dict:
    timing = {}
    for wav in sorted(OUT_DIR.glob("*.wav")):
        info = sf.info(wav)
        timing[wav.stem] = round(info.frames / info.samplerate, 3)
    return timing


def main() -> int:
    script = json.loads(SCRIPT.read_text(encoding="utf8"))
    if "--measure-only" in sys.argv:
        timing = measure()
    else:
        model_dir = os.environ.get("KOKORO_DIR")
        if not model_dir:
            print("Set KOKORO_DIR to the folder holding kokoro-v1.0.onnx and voices-v1.0.bin", file=sys.stderr)
            return 2
        from kokoro_onnx import Kokoro

        kokoro = Kokoro(str(Path(model_dir) / "kokoro-v1.0.onnx"), str(Path(model_dir) / "voices-v1.0.bin"))
        only = {a for a in sys.argv[1:] if not a.startswith("--")}
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        timing = json.loads(TIMING.read_text(encoding="utf8")) if TIMING.exists() else {}
        for line in script["lines"]:
            if only and line["id"] not in only:
                continue
            samples, rate = kokoro.create(line["text"], voice=script["voice"], speed=script["speed"], lang="en-us")
            samples = level(trim(np.asarray(samples, dtype=np.float32), rate), rate)
            sf.write(OUT_DIR / f"{line['id']}.wav", samples, rate, subtype="PCM_16")
            timing[line["id"]] = round(len(samples) / rate, 3)
            print(f"{line['id']}  {timing[line['id']]:6.2f}s  {line['text'][:60]}")

    missing = [l["id"] for l in script["lines"] if l["id"] not in timing]
    if missing:
        print(f"missing cues: {', '.join(missing)}", file=sys.stderr)
        return 1
    TIMING.write_text(json.dumps(dict(sorted(timing.items())), indent=2) + "\n", encoding="utf8")
    print(f"total speech {sum(timing.values()):.1f}s across {len(timing)} cues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
