"""Tile audit frames into one contact sheet, each captioned with its file name.

    python scripts/sheet.py out.png --cols 3 --width 640 qa/frames/s01-2.png qa/frames/s02-5.png ...

Needs Pillow (README, "QA tools"). Remotion's bundled ffmpeg has no tile filter, so this is the
contact-sheet path for the audit.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("frames", nargs="+")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--width", type=int, default=640)
    args = ap.parse_args()

    thumbs = []
    for f in args.frames:
        im = Image.open(f).convert("RGB")
        h = round(im.height * args.width / im.width)
        thumbs.append((Path(f).stem, im.resize((args.width, h), Image.LANCZOS)))
    cap = 26
    pad = 6
    th = thumbs[0][1].height
    rows = (len(thumbs) + args.cols - 1) // args.cols
    sheet = Image.new("RGB", (args.cols * (args.width + pad) + pad, rows * (th + cap + pad) + pad), (32, 32, 32))
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(thumbs):
        x = pad + (i % args.cols) * (args.width + pad)
        y = pad + (i // args.cols) * (th + cap + pad)
        sheet.paste(im, (x, y))
        draw.text((x + 4, y + th + 6), name, fill=(220, 220, 220))
    sheet.save(args.out)
    print(f"{args.out}: {len(thumbs)} frames")


if __name__ == "__main__":
    main()
