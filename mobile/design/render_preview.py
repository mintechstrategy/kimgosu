"""Render review mockups. Requires Pillow; these PNGs are not an Android build."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "previews"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 432, 864
PURPLE = (113, 36, 239)
FONT = "C:/Windows/Fonts/malgun.ttf"
BOLD = "C:/Windows/Fonts/malgunbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def center(draw, xy, text, typeface, fill):
    box = draw.textbbox((0, 0), text, font=typeface)
    draw.text((xy[0] - (box[2] - box[0]) / 2, xy[1] - (box[3] - box[1]) / 2 - box[1]),
              text, font=typeface, fill=fill)


def splash():
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            # Violet with a subtle centered glow, close to the supplied concept.
            d = ((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2
            glow = max(0.0, 1.0 - d * 2.2)
            px[x, y] = (int(104 + 12 * glow), int(27 + 16 * glow), int(225 + 16 * glow))
    draw = ImageDraw.Draw(im)
    center(draw, (W / 2, 416), "김고수", font(91, True), "white")
    center(draw, (W / 2, 495), "고민은 우리동네 김고수와 상의하자", font(20, True), "white")
    im.save(OUT / "splash-preview.png")


def icon(draw, kind, x, y, color):
    stroke = 3
    if kind == "home":
        draw.line([(x - 11, y), (x, y - 10), (x + 11, y)], fill=color, width=stroke, joint="curve")
        draw.line([(x - 8, y - 1), (x - 8, y + 11), (x + 8, y + 11), (x + 8, y - 1)],
                  fill=color, width=stroke, joint="curve")
    elif kind == "search":
        draw.ellipse((x - 10, y - 10, x + 5, y + 5), outline=color, width=stroke)
        draw.line((x + 4, y + 4, x + 12, y + 12), fill=color, width=stroke)
    elif kind == "add":
        draw.rounded_rectangle((x - 12, y - 12, x + 12, y + 12), radius=7, outline=color, width=stroke)
        draw.line((x - 6, y, x + 6, y), fill=color, width=stroke)
        draw.line((x, y - 6, x, y + 6), fill=color, width=stroke)
    elif kind == "chat":
        draw.rounded_rectangle((x - 12, y - 10, x + 12, y + 7), radius=6, outline=color, width=stroke)
        draw.line((x - 3, y + 7, x - 6, y + 13, x + 2, y + 7), fill=color, width=stroke)
    elif kind == "person":
        draw.ellipse((x - 5, y - 12, x + 5, y - 2), outline=color, width=stroke)
        draw.arc((x - 12, y - 1, x + 12, y + 17), 180, 360, fill=color, width=stroke)


def main():
    im = Image.new("RGB", (W, H), (250, 250, 252))
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 755), fill="white")
    draw.rectangle((0, 755, W, H), fill="white")
    draw.line((0, 755, W, 755), fill=(232, 232, 238), width=1)
    tabs = [("home", "홈"), ("search", "검색"), ("add", "등록"), ("chat", "채팅"), ("person", "마이")]
    for i, (symbol, label) in enumerate(tabs):
        x = int((i + 0.5) * W / 5)
        color = PURPLE if i == 0 else (126, 128, 139)
        icon(draw, symbol, x, 789, color)
        center(draw, (x, 829), label, font(15, i == 0), color)
    im.save(OUT / "main-preview.png")


if __name__ == "__main__":
    splash()
    main()
