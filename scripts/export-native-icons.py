"""Export the native BiliMusic vector mark. Requires PyMuPDF and Pillow.

Run from any directory with:
    python BiliMusic/scripts/export-native-icons.py

The SVG is the only artwork source. Ordinary icons preserve its rounded,
transparent corners; iOS and Android maskable icons use a full-bleed tile.
"""
from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/icons/app.svg"
SIZES = (32, 180, 192, 512)


def render(full_bleed=False):
    artwork = ET.fromstring(SOURCE.read_bytes())
    if full_bleed:
        tile = next(node for node in artwork if node.get("id") == "tile")
        tile.attrib.update(x="0", y="0", width="512", height="512", rx="0")
    data = ET.tostring(artwork, encoding="utf-8")
    with pymupdf.open(stream=data, filetype="svg") as document:
        # Render above every delivery size and downsample for smooth edges.
        pixmap = document[0].get_pixmap(matrix=pymupdf.Matrix(4, 4), alpha=True)
        return Image.open(BytesIO(pixmap.tobytes("png"))).convert("RGBA")


def resized(image, size):
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    normal = render()
    square = render(full_bleed=True).convert("RGB")
    icons = ROOT / "src/icons"
    for size in SIZES:
        resized(normal, size).save(icons / f"v021-{size}.png")
    resized(square, 512).save(icons / "v021-maskable-512.png")
    for size in (192, 512):
        resized(normal, size).save(ROOT / "src" / f"pwa-icon-{size}.png")
    resized(square, 1024).save(
        ROOT / "ios/BiliMusic/Assets.xcassets/AppIcon.appiconset/icon.png"
    )
    normal.save(
        ROOT / "windows/icon.ico",
        sizes=[(size, size) for size in (16, 20, 24, 32, 40, 48, 64, 128, 256)],
    )
    print("Exported BiliMusic SVG to web, PWA, iOS and Windows icon sizes.")


if __name__ == "__main__":
    main()
