"""Package the offline music-space UI concept. Never starts a server."""
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "music-space-prototype"
ARCHIVE = ROOT / "dist" / "BiliMusic-Music-Space-Prototype.zip"
files = []

def write(relative, data):
    path = OUTPUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    files.append((path, str(relative).replace("\\", "/")))

for concept in ("music-space", "spatial-player"):
    directory = ROOT / "docs" / "concepts" / concept
    names = ("index.html", "space.css", "details.css", "catalog.js", "space.js", "README.md", "design-notes.md") if concept == "music-space" else ("index.html", "prototype.css", "scene.css", "prototype.js", "embed.js", "README.md", "design-notes.md")
    for name in names:
        content = (directory / name).read_text(encoding="utf-8").replace("../../../src/assets/", "../assets/")
        write(Path(concept) / name, content.encode("utf-8"))
    for path in sorted(directory.glob("*.webp")):
        write(Path(concept) / path.name, path.read_bytes())
for path in sorted((ROOT / "docs/concepts/music-space/art").glob("*.svg")):
    write(Path("music-space/art") / path.name, path.read_bytes())
for name in ("forest.jpg", "mist.flac", "creek.flac", "dusk.flac"):
    write(Path("assets") / name, (ROOT / "src/assets" / name).read_bytes())
write(Path("index.html"), b'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=music-space/index.html"><title>BiliMusic Music Space</title><a href="music-space/index.html">Open BiliMusic Music Space</a>')
write(Path("README.txt"), "BiliMusic 音乐空间 · 离线交互原型\n\n解压后双击 index.html，或打开 music-space/index.html。无需启动服务器。\n包含发现、多源示例检索、歌单、资料库、设置、登录入口预览和真实器乐试听。\n平台检索为离线示例，登录与 DSP 为界面演示，未连接线上服务。\n".encode("utf-8"))
with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
    for path, relative in files:
        package.write(path, relative)
with zipfile.ZipFile(ARCHIVE) as package:
    if package.testzip():
        raise RuntimeError("Archive integrity check failed")
print(f"Packaged {len(files)} files: {ARCHIVE}")
print(f"Bytes: {ARCHIVE.stat().st_size}")
print(f"SHA256: {hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()}")
