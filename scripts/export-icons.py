"""Export a generated square master to the installed apps' icon formats. Requires Pillow."""
import argparse
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZES = (32, 180, 192, 512)


def maskable(source):
    # Keep the subject inside Android's central circular safe zone. Extend only
    # the painted edges, so rounded and circular launchers can crop the full tile.
    size, margin = 512, 48
    side = size - 2 * margin
    core = source.resize((side, side), Image.Resampling.LANCZOS)
    icon = Image.new("RGB", (size, size))
    icon.paste(core, (margin, margin))
    icon.paste(core.crop((0, 0, 1, side)).resize((margin, side)), (0, margin))
    icon.paste(core.crop((side - 1, 0, side, side)).resize((margin, side)), (size - margin, margin))
    icon.paste(icon.crop((0, margin, size, margin + 1)).resize((size, margin)), (0, 0))
    icon.paste(icon.crop((0, size - margin - 1, size, size - margin)).resize((size, margin)), (0, size - margin))
    return icon


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("master", nargs="?", type=Path, default=ROOT / "artwork/icons/tv.png")
    args = parser.parse_args()
    with Image.open(args.master) as original:
        if original.width != original.height or original.width < 1024:
            parser.error("Choose a square master at least 1024 pixels wide")
        source = original.convert("RGB")
    out = ROOT / "src/icons"
    out.mkdir(exist_ok=True)
    for size in SIZES:
        source.resize((size, size), Image.Resampling.LANCZOS).save(out / f"v021-{size}.png")
    maskable(source).save(out / "v021-maskable-512.png")
    source.resize((1024, 1024), Image.Resampling.LANCZOS).save(
        ROOT / "ios/BiliMusic/Assets.xcassets/AppIcon.appiconset/icon.png"
    )
    source.save(ROOT / "windows/icon.ico", sizes=[(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])


if __name__ == "__main__":
    main()
