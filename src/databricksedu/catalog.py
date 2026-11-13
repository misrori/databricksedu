"""The module index and the packaged content (built by tools/build.py)."""
import gzip
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_CONTENT = os.path.join(_HERE, "_content")
_ASSETS = os.path.join(_HERE, "assets")
_cache = {}


def _read(path, mode="r"):
    if mode == "rb":
        with open(path, "rb") as f:
            return f.read()
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def asset(name):
    key = ("asset", name)
    if key not in _cache:
        _cache[key] = _read(os.path.join(_ASSETS, name))
    return _cache[key]


def categories():
    """The categories with their modules, in display order."""
    if "catalog" not in _cache:
        path = os.path.join(_CONTENT, "catalog.json")
        if not os.path.exists(path):
            raise RuntimeError("The packaged content is missing. If you run from a git checkout, "
                               "build it first: python tools/build.py")
        _cache["catalog"] = json.loads(_read(path))["categories"]
    return _cache["catalog"]


def index():
    """{module id: (category, module)}"""
    if "index" not in _cache:
        _cache["index"] = {m["id"]: (c, m) for c in categories() for m in c["modules"]}
    return _cache["index"]


def resolve(what):
    """'all', a category id or a module id (or a module title) -> list of (category, module)."""
    idx = index()
    if what in (None, "", "all", "*"):
        return list(idx.values())
    if what in idx:
        return [idx[what]]
    for c in categories():
        if what in (c["id"], c["title"]):
            return [(c, m) for m in c["modules"]]
    low = str(what).lower()
    hits = [cm for cm in idx.values() if cm[1]["title"].lower() == low]
    if not hits:
        hits = [cm for cm in idx.values() if low in cm[1]["id"] or low in cm[1]["title"].lower()]
    if len(hits) == 1:
        return hits
    if hits:
        raise ValueError("%r matches several modules: %s" % (what, ", ".join(m["id"] for _, m in hits)))
    raise ValueError("Unknown module or track %r. Run databricksedu.modules() to see what is available." % (what,))


def web_blob(module_id):
    """Base64 text of the gzipped slide bundle, ready to embed in a page."""
    return _read(os.path.join(_CONTENT, "web", module_id + ".b64"))


def notebook_bundle(module_id):
    """{'notebooks': [{'name', 'cells'}], 'md': raw Markdown}"""
    return json.loads(gzip.decompress(_read(os.path.join(_CONTENT, "nb", module_id + ".json.gz"), "rb")).decode("utf-8"))


def modules(track=None, show=True):
    """List the modules (optionally of one track). Returns a list of dicts when show=False."""
    rows = []
    for c in categories():
        if track and track not in (c["id"], c["title"]):
            continue
        for m in c["modules"]:
            rows.append({"track": c["id"], "id": m["id"], "title": m["title"], "level": m["level"],
                         "minutes": m["minutes"], "summary": m["summary"]})
    if not show:
        return rows
    last = None
    for r in rows:
        if r["track"] != last:
            last = r["track"]
            title = [c["title"] for c in categories() if c["id"] == last][0]
            print("\n%s  (save(\"%s\"))" % (title, last))
        print("  %-34s %s" % (r["id"], r["title"]))
    print("\nstart() opens the app, present(id) plays one module, save(id) copies its notebooks.")
    return None
