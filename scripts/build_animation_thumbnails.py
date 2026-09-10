from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "source" / "animation-poses-sheet-v0.1.0.png"
OUTPUT = ROOT / "public" / "thumbnails" / "poses"

POSES = [
    "character", "sheath-high", "sheath-low", "turn-180", "attack", "block",
    "block-idle", "casting", "crouch-block", "crouch-block-idle", "crouch-idle", "crouch",
    "crouching", "death", "idle", "impact", "jump", "kick",
    "power-up", "run", "slash", "strafe", "turn", "walk",
]


def main() -> None:
    sheet = Image.open(SOURCE).convert("RGB")
    if sheet.size != (1536, 1024):
        raise ValueError(f"La lámina debe medir 1536x1024, mide {sheet.size}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for index, pose in enumerate(POSES):
        column = index % 6
        row = index // 6
        crop = sheet.crop((column * 256, row * 256, (column + 1) * 256, (row + 1) * 256))
        crop.save(OUTPUT / f"{pose}-v0.1.0.webp", "WEBP", quality=88, method=6)


if __name__ == "__main__":
    main()
