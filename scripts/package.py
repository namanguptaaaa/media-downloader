"""Build source-only and static-site ZIPs without vendoring dependencies."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
dist.mkdir(exist_ok=True)
extension_files = sorted((root / "extension").glob("*"))
with zipfile.ZipFile(root / "web" / "extension.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in extension_files:
        if path.is_file():
            archive.write(path, path.name)
shutil_copy = (root / "web" / "extension.zip").read_bytes()
(dist / "local-media-extension.zip").write_bytes(shutil_copy)
files = [root / name for name in ("README.md", "LICENSE", "requirements.txt", "start-local.ps1", ".gitignore")]
for directory in ("web", "server", "tests", "docs", "scripts", "extension", ".github"):
    files += [p for p in (root / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
with zipfile.ZipFile(dist / "local-media-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(root).as_posix())
with zipfile.ZipFile(dist / "local-media-website.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((root / "web").iterdir()):
        if path.is_file():
            archive.write(path, path.name)
for archive_path in sorted(dist.glob("local-media-*.zip")):
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.testzip() is None
        assert not any(".deps/" in name or ".venv/" in name or "cookies" in name for name in archive.namelist())
    print(f"{archive_path.name}: {archive_path.stat().st_size} bytes, verified")
