"""Turn the scene spec and the measured narration into absolute times.

Reads  content/scenes.json, content/vo-timing.json, content/narration.json
Writes content/timeline.json
       content/captions.json, deliverables/captions.srt, deliverables/captions.vtt

Times are seconds from the start of the film. A scene's cues are placed after its lead,
each followed by its gap; the scene ends after its tail. Both the film (TypeScript) and
the audio builder (Python) read the result, so they cannot disagree about when anything
happens.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def build() -> dict:
    spec = json.loads((ROOT / "content" / "scenes.json").read_text(encoding="utf8"))
    timing = json.loads((ROOT / "content" / "vo-timing.json").read_text(encoding="utf8"))
    text = {l["id"]: l["text"] for l in json.loads((ROOT / "content" / "narration.json").read_text(encoding="utf8"))["lines"]}

    t, scenes = 0.0, []
    for s in spec["scenes"]:
        start = t
        at = start + s["lead"]
        cues = []
        for cue_id, gap in s["cues"]:
            length = timing[cue_id]
            cues.append({"id": cue_id, "start": round(at, 3), "end": round(at + length, 3), "text": text[cue_id]})
            at += length + gap
        end = at + s["tail"]
        scenes.append(
            {
                "id": s["id"],
                "act": s["act"],
                "chapter": s.get("chapter"),
                "title": s["title"],
                "start": round(start, 3),
                "end": round(end, 3),
                "cues": cues,
            }
        )
        t = end
    return {"overlap": spec["overlap"], "total": round(t, 3), "scenes": scenes}


MAX_LINE = 42


def captions(timeline: dict) -> list:
    """Caption lines in the SCRIPT's words, timed by the recogniser's word timings (vo-check.json).
    A line breaks after punctuation once it has some length, or before it would pass 42 characters.
    Each line stays up until the next begins, or 0.4 s after the voice stops."""
    check_path = ROOT / "content" / "vo-check.json"
    heard = json.loads(check_path.read_text(encoding="utf8")) if check_path.exists() else {}
    out = []
    for sc in timeline["scenes"]:
        for c in sc["cues"]:
            words = c["text"].split()
            timed = heard.get(c["id"], {}).get("words", [])

            def at(i: int) -> float:
                if not timed:
                    return c["start"] + (c["end"] - c["start"]) * i / len(words)
                j = min(len(timed) - 1, round(i * (len(timed) - 1) / max(1, len(words) - 1)))
                return c["start"] + timed[j]["s"]

            line, first = [], 0
            for i, w in enumerate(words):
                if not line:
                    first = i
                line.append(w)
                text = " ".join(line)
                nxt = words[i + 1] if i + 1 < len(words) else None
                if nxt is None or (w[-1] in ".,;:?" and len(text) > 18) or len(text + " " + nxt) > MAX_LINE:
                    out.append({"start": round(at(first), 3), "end": round(at(i + 1) if nxt else c["end"] + 0.4, 3), "text": text})
                    line = []
    return out


def stamp(sec: float, sep: str) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def main() -> int:
    timeline = build()
    (ROOT / "content" / "timeline.json").write_text(json.dumps(timeline, indent=1) + "\n", encoding="utf8")
    lines = captions(timeline)
    (ROOT / "content" / "captions.json").write_text(json.dumps(lines, indent=1) + "\n", encoding="utf8")
    deliver = ROOT / "deliverables"
    deliver.mkdir(exist_ok=True)
    srt = "\n".join(f"{i + 1}\n{stamp(l['start'], ',')} --> {stamp(l['end'], ',')}\n{l['text']}\n" for i, l in enumerate(lines))
    vtt = "WEBVTT\n\n" + "\n".join(f"{stamp(l['start'], '.')} --> {stamp(l['end'], '.')}\n{l['text']}\n" for l in lines)
    (deliver / "captions.srt").write_text(srt, encoding="utf8")
    (deliver / "captions.vtt").write_text(vtt, encoding="utf8")
    print(f"{len(lines)} caption lines")
    for s in timeline["scenes"]:
        print(f"{s['id']}  {s['start']:7.2f} - {s['end']:7.2f}  ({s['end'] - s['start']:5.2f}s)  {s['title']}")
    print(f"total {timeline['total']:.2f}s = {int(timeline['total'] // 60)}:{timeline['total'] % 60:05.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
