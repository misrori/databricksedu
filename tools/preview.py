#!/usr/bin/env python3
"""Write the app to an HTML file for a quick look in a browser.

    python tools/preview.py out.html [route] [height]      # route: home, cat/<id>, slides/<id>, doc/<id>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from databricksedu import app  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "preview.html"
route = sys.argv[2] if len(sys.argv) > 2 else "home"
height = int(sys.argv[3]) if len(sys.argv) > 3 else 820
Path(out).write_text(app.page(route=route, height=height), encoding="utf-8")
print(out, route)
