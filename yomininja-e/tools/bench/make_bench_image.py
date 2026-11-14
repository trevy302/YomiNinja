"""
Generates a game-like screenshot with known Japanese text, for OCR benchmarks.

Usage (any Python with Pillow, e.g. the embedded OCR Python):
    python make_bench_image.py <out_dir> [width] [height]

Writes <out_dir>/bench_<w>x<h>.png and <out_dir>/bench_<w>x<h>.json (ground truth lines).
Layout is defined on a 1920x1080 grid and scaled, so every size has the same content.
"""
import json
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
BOLD = os.path.join(FONT_DIR, "YuGothB.ttc")
REGULAR = os.path.join(FONT_DIR, "YuGothM.ttc")

# (text, x, y, size, bold, fill) on a 1920x1080 grid
LINES = [
    ("育成ストーリー 第3話「はじめての勝利」", 60, 40, 40, True, (255, 255, 255)),
    ("オート", 1455, 44, 30, True, (40, 40, 40)),
    ("ログ", 1605, 44, 30, True, (40, 40, 40)),
    ("スキップ", 1715, 44, 30, False, (40, 40, 40)),
    ("トレーナー", 150, 742, 38, True, (255, 255, 255)),
    ("「トレーナーさん、今日のトレーニングも頑張りましょう！」", 150, 830, 46, True, (60, 50, 50)),
    ("次のレースまであと三週間。スタミナを鍛えておかないと。", 150, 900, 46, True, (60, 50, 50)),
    ("ファン数 12,580人", 1500, 640, 30, False, (255, 255, 255)),
]


def make(width: int, height: int, out_dir: str) -> None:
    sx, sy = width / 1920, height / 1080
    random.seed(1234)

    img = Image.new("RGB", (width, height))
    px = ImageDraw.Draw(img)

    # Sky-to-grass gradient
    for y in range(height):
        t = y / height
        c = (int(120 + 100 * t), int(180 - 40 * t), int(255 - 150 * t)) if t < 0.6 else (90, 170, 80)
        px.line([(0, y), (width, y)], fill=c)

    # Busy background: random blurred shapes (stands in for the 3D scene)
    shapes = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shapes)
    for _ in range(140):
        x0, y0 = random.randint(0, width), random.randint(0, int(height * 0.75))
        r = random.randint(int(20 * sx), int(140 * sx))
        col = tuple(random.randint(40, 255) for _ in range(3)) + (random.randint(60, 160),)
        if random.random() < 0.5:
            sd.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=col)
        else:
            sd.rectangle([x0 - r, y0 - r // 2, x0 + r, y0 + r // 2], fill=col)
    shapes = shapes.filter(ImageFilter.GaussianBlur(radius=max(1, int(6 * sx))))
    img.paste(shapes, (0, 0), shapes)

    d = ImageDraw.Draw(img, "RGBA")

    # Header bar and buttons
    d.rectangle([0, 0, width, int(120 * sy)], fill=(30, 60, 120, 200))
    for bx, bw in ((1435, 130), (1585, 100), (1695, 165)):
        d.rounded_rectangle([int(bx * sx), int(36 * sy), int((bx + bw) * sx), int(86 * sy)],
                            radius=int(18 * sy), fill=(255, 255, 255, 235))

    # Name tag + dialogue box
    d.rounded_rectangle([int(120 * sx), int(725 * sy), int(380 * sx), int(795 * sy)], radius=int(20 * sy), fill=(230, 90, 140, 240))
    d.rounded_rectangle([int(100 * sx), int(800 * sy), int(1820 * sx), int(1030 * sy)], radius=int(30 * sy),
                        fill=(255, 255, 255, 235), outline=(230, 90, 140, 255), width=max(2, int(5 * sy)))

    truth = []
    for text, x, y, size, bold, fill in LINES:
        font = ImageFont.truetype(BOLD if bold else REGULAR, max(8, int(size * sy)))
        d.text((int(x * sx), int(y * sy)), text, font=font, fill=fill)
        truth.append(text)

    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, f"bench_{width}x{height}")
    img.save(base + ".png")
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"width": width, "height": height, "lines": truth}, f, ensure_ascii=False, indent=2)
    print(base + ".png")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    w = int(sys.argv[2]) if len(sys.argv) > 2 else 3840
    h = int(sys.argv[3]) if len(sys.argv) > 3 else 2160
    make(w, h, out)
