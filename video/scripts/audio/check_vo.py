"""Listen to every narration cue with an offline speech recogniser and compare it to the script.

A synthetic voice can swallow or mispronounce a word without any error. This is the check:
each cue is transcribed with faster-whisper (MIT, model `base.en`) and the word error rate
against the script is recorded. Word timings are kept, so subtitles can follow the voice.

Reads  content/narration.json, public/audio/vo/<id>.wav
Writes content/vo-check.json  ({ id: { heard, wer, words: [{ w, s, e }] } }, seconds)
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "content" / "narration.json"
VO = ROOT / "public" / "audio" / "vo"
OUT = ROOT / "content" / "vo-check.json"

# Above this a cue is re-rendered or re-worded before the film is called finished.
MAX_WER = 0.10


# The recogniser spells some words its own way; these are the same sound, not an error.
SAME = {"inquiry": "enquiry", "waterboard": "water board", "1": "one", "2": "two"}


def words(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[a-z0-9']+", text.lower()):
        out.extend(SAME.get(w, w).split())
    return out


def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[len(hyp)] / max(len(ref), 1)


def main() -> int:
    from faster_whisper import WhisperModel

    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    script = json.loads(SCRIPT.read_text(encoding="utf8"))
    report, worst = {}, 0.0
    for line in script["lines"]:
        segments, _ = model.transcribe(str(VO / f"{line['id']}.wav"), word_timestamps=True, beam_size=5)
        ws = [w for seg in segments for w in seg.words]
        heard = "".join(w.word for w in ws).strip()
        score = wer(words(line["text"]), words(heard))
        worst = max(worst, score)
        report[line["id"]] = {
            "heard": heard,
            "wer": round(score, 3),
            "words": [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for w in ws],
        }
        flag = "  <-- check" if score > MAX_WER else ""
        print(f"{line['id']}  wer {score:4.2f}  {heard}{flag}")
    OUT.write_text(json.dumps(report, indent=1) + "\n", encoding="utf8")
    print(f"worst wer {worst:.2f} (limit {MAX_WER})")
    return 0 if worst <= MAX_WER else 1


if __name__ == "__main__":
    sys.exit(main())
