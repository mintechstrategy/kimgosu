"""Generate the Android 12+ system splash logo (Pillow required)."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
target = root / "app/src/main/res/drawable-nodpi/launch_logo.png"
target.parent.mkdir(parents=True, exist_ok=True)
canvas = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf", 92)
label = "김고수"
box = draw.textbbox((0, 0), label, font=font)
draw.text(((432 - (box[2] - box[0])) / 2, (432 - (box[3] - box[1])) / 2 - box[1]),
          label, font=font, fill="white")
canvas.save(target, optimize=True)
