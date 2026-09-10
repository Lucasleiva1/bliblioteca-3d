from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src-tauri" / "icons"
CANVAS = 512


def make_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    pixels = image.load()

    for y in range(CANVAS):
        blend = y / (CANVAS - 1)
        for x in range(CANVAS):
            radial = max(0.0, 1.0 - (((x - 330) ** 2 + (y - 165) ** 2) ** 0.5) / 430)
            pixels[x, y] = (
                int(34 + 40 * radial),
                int(26 + 26 * radial),
                int(64 + 72 * (1 - blend) + 30 * radial),
                255,
            )

    mask = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle((18, 18, 494, 494), radius=108, fill=255)
    image.putalpha(mask)

    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((80, 165, 432, 404), outline=(130, 102, 255, 100), width=13)
    draw.arc((80, 165, 432, 404), 190, 345, fill=(76, 225, 255, 245), width=14)
    draw.ellipse((403, 250, 429, 276), fill=(89, 232, 255, 255))

    top = [(256, 91), (387, 166), (256, 241), (125, 166)]
    left = [(125, 166), (256, 241), (256, 397), (125, 322)]
    right = [(256, 241), (387, 166), (387, 322), (256, 397)]
    draw.polygon(top, fill=(158, 128, 255, 245))
    draw.polygon(left, fill=(78, 76, 195, 248))
    draw.polygon(right, fill=(45, 198, 230, 248))
    for polygon in (top, left, right):
        draw.line(polygon + [polygon[0]], fill=(225, 236, 255, 235), width=8, joint="curve")
    draw.line((256, 241, 256, 397), fill=(226, 237, 255, 220), width=7)

    draw.rounded_rectangle((174, 196, 338, 256), radius=17, fill=(20, 20, 44, 220))
    draw.rectangle((209, 256, 303, 326), fill=(20, 20, 44, 210))
    draw.rounded_rectangle((190, 314, 322, 350), radius=15, fill=(20, 20, 44, 215))
    draw.ellipse((206, 211, 226, 231), fill=(102, 229, 255, 255))
    draw.ellipse((286, 211, 306, 231), fill=(102, 229, 255, 255))

    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image = make_icon()
    image.save(OUTPUT / "icon.png")
    image.resize((32, 32), Image.Resampling.LANCZOS).save(OUTPUT / "32x32.png")
    image.resize((128, 128), Image.Resampling.LANCZOS).save(OUTPUT / "128x128.png")
    image.resize((256, 256), Image.Resampling.LANCZOS).save(OUTPUT / "128x128@2x.png")
    image.save(
        OUTPUT / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
