"""Build the static website for GitHub Pages into _site/.

    python tools/build.py && python tools/site.py [out_dir]

index.html is the same app that databricksedu.start() shows, filling the browser window.
site/extras/ (hand-made decks and animations) is copied next to it, and every module's
Markdown is published under markdown/<module id>.md.
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from databricksedu import app, catalog  # noqa: E402


def main(out="_site"):
    out = (ROOT / out).resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / "index.html").write_text(app.page(web=True), encoding="utf-8")
    shutil.copytree(ROOT / "site" / "extras", out / "extras")
    md = out / "markdown"
    md.mkdir()
    n = 0
    for c in catalog.categories():
        for m in c["modules"]:
            (md / ("%s.md" % m["id"])).write_text(catalog.notebook_bundle(m["id"])["md"], encoding="utf-8")
            n += 1
    (out / ".nojekyll").write_text("", encoding="utf-8")
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print("site: %s (%d modules, %d extras, %.1f MB)" % (out, n, len(app.EXTRAS), size / 1e6))


if __name__ == "__main__":
    main(*sys.argv[1:])
