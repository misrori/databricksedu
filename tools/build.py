#!/usr/bin/env python3
"""Build the packaged content of databricksedu from the sources under content/.

    python tools/build.py                      # build everything into src/databricksedu/
    python tools/build.py --check content/data-engineering/050-delta-table-anatomy
                                               # validate one or more modules, write nothing

Sources:  content/categories.json, content/<category>/<NNN-slug>/module.md (+ quiz.json)
Outputs:  src/databricksedu/_content/catalog.json      module index
          src/databricksedu/_content/web/<id>.b64      slides + notes + quiz for the app (gzip, base64)
          src/databricksedu/_content/nb/<id>.json.gz   notebook cells + raw Markdown for save()
          src/databricksedu/assets/*                   CSS and JS used by the app and the notebooks
"""
import base64
import gzip
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "src"))
import render  # noqa: E402
from databricksedu import data as edu_data  # noqa: E402

CONTENT = ROOT / "content"
PKG = ROOT / "src" / "databricksedu"
OUT = PKG / "_content"
ASSETS_SRC = ROOT / "tools" / "assets"
LEVELS = {"Beginner", "Intermediate", "Advanced"}
DATASETS = {name: edu_data.describe(name) for name in edu_data.NAMES}


class BuildError(Exception):
    pass


# ------------------------------------------------------------------ dataset setup block
def dataset_cells(name):
    """The setup every demo starts with: one cell that creates the tables, one that checks them."""
    desc = DATASETS[name]
    setup = ('from databricksedu import data\n\n'
             'CATALOG = "FILL_IN"   # a catalog you can use, for example "dbacademy" or "main"\n'
             'SCHEMA  = "FILL_IN"   # a schema you can write to, for example your "labuser..." schema\n\n'
             'ds = data.create("%s", CATALOG, SCHEMA)   # Delta tables with keys; existing ones are replaced\n'
             '# options: mode="view" (views over files) or mode="temp_view", drop_existing=False to keep tables'
             % name)
    counts = "\nUNION ALL ".join("SELECT '%s' AS table_name, count(*) AS row_count FROM %s" % (t["name"], t["name"])
                                 for t in desc["tables"])
    return [
        {"k": "py", "t": "🗃️ Create the demo tables in your catalog and schema", "c": setup},
        {"k": "sql", "t": "✅ Check the row counts", "c": counts + ";"},
    ]


def dataset_block_html(name):
    cells = dataset_cells(name)
    sql = edu_data.generate(name, seed=42, scale=0.02).sql()
    return (render.dataset_html(DATASETS[name])
            + render.code_html(cells[0]["c"], "python", "run")
            + '<details class="solution"><summary>🗃️ Show the SQL that data.create() runs (tables and keys)</summary>%s</details>'
            % render.code_html(sql, "sql", "run"))


DATASET_HTML = {}


def dataset_html(name):
    if name not in DATASET_HTML:
        DATASET_HTML[name] = dataset_block_html(name)
    return DATASET_HTML[name]


class _Datasets(dict):
    def __missing__(self, key):
        if key not in DATASETS:
            raise BuildError("unknown dataset %r (available: %s)" % (key, ", ".join(DATASETS)))
        return dataset_html(key)


DS_HTML = _Datasets()


# ------------------------------------------------------------------ one module
def md_cell(content_html, quiz=None):
    cell = {"k": "md", "h": content_html}
    if 'class="vz ' in content_html:
        cell["viz"] = True
    if quiz:
        cell["quiz"] = quiz
    return cell


def code_cell(lang, code):
    first = code.strip().splitlines()[0] if code.strip() else ""
    title = re.sub(r"^(#|--)\s*", "", first).strip() if first.startswith(("#", "--")) else ""
    return {"k": "py" if lang == "python" else "sql", "t": title, "c": code}


def section_cells(sec, num):
    """One section -> notebook cells (styled text cells and runnable code cells, in order)."""
    title = render.section_title(sec)
    cells, head_done = [], False
    for b in render.split_blocks("\n".join(sec.splitlines()[1:])):
        head = "" if head_done else render.section_head(title, num)
        head_done = True
        if b[0] == "md":
            cells.append(md_cell(head + render.md_to_html(b[1], DS_HTML)))
        elif b[0] == "dataset":
            cells.append(md_cell(head + render.dataset_html(DATASETS[b[1]])
                                 + '<div class="tryit"><span style="font-size:22px">🧪</span><div><b>Set up the demo data in '
                                 'one cell.</b> Fill in your catalog and schema in the next cell and run it. It creates '
                                 'the tables and prints what it made: rows, size and columns.</div></div>'))
            cells += dataset_cells(b[1])
        else:
            if head:
                cells.append(md_cell(head))
            cells.append(code_cell(b[1], b[2]))
    if not head_done:
        cells.append(md_cell(render.section_head(title, num)))
    return cells


def footer_html(cat, meta):
    h = ('<div class="footer">🎓 <b>databricksedu</b> · %s · %s · open the whole library with '
         '<code>import databricksedu; databricksedu.start()</code></div>'
         % (html.escape(cat["title"]), html.escape(meta["title"])))
    lead = "Ready to test yourself?" if cat.get("cta") else "Preparing for a certification?"
    return ('<div class="cta"><span class="big">🎯</span><div><b>%s</b><br><span>Practice exams are available at '
            'GoldHandAcademy.com</span></div><a href="https://goldhandacademy.com" target="_blank">Practice exams →</a>'
            '</div>' % lead) + h


def build_module(folder, cat):
    src = folder / "module.md"
    if not src.exists():
        raise BuildError("module.md is missing")
    meta, body = render.parse_front_matter(src.read_text(encoding="utf-8"))
    mid = re.sub(r"^\d+-", "", folder.name)
    order = int(re.match(r"^(\d+)-", folder.name).group(1)) if re.match(r"^\d+-", folder.name) else 999
    for key in ("title", "summary"):
        if not meta.get(key):
            raise BuildError("front matter needs %r" % key)
    meta.setdefault("icon", "✨")
    meta.setdefault("level", "Beginner")
    meta.setdefault("minutes", 8)
    meta.setdefault("tags", [])
    meta.setdefault("group", "")
    if meta["level"] not in LEVELS:
        raise BuildError("level must be one of %s" % ", ".join(sorted(LEVELS)))
    if not isinstance(meta["tags"], list):
        raise BuildError("tags must be a list like [Delta Lake, Parquet]")
    if not body.startswith("# "):
        raise BuildError("the body must start with a '# Title' line")

    quiz = None
    qfile = folder / "quiz.json"
    if qfile.exists():
        quiz = json.loads(qfile.read_text(encoding="utf-8"))
        for n, q in enumerate(quiz, 1):
            if not (isinstance(q.get("q"), str) and isinstance(q.get("o"), list) and len(q["o"]) >= 2
                    and isinstance(q.get("c"), int) and 0 <= q["c"] < len(q["o"]) and isinstance(q.get("e"), str)):
                raise BuildError("quiz.json question %d must have q (text), o (options), c (index), e (explanation)" % n)

    for info in render.fence_infos(body):
        if len(info) > 1 and info[1] in ("run", "todo", "solution") and info[0] not in ("python", "sql"):
            raise BuildError("```%s %s: only python and sql blocks can be run/todo/solution" % (info[0], info[1]))
        if info and info[0] == "dataset" and (len(info) < 2 or info[1] not in DATASETS):
            raise BuildError("```dataset needs one of: %s" % ", ".join(DATASETS))
    if body.count("```") % 2:
        raise BuildError("a ``` code fence is not closed")

    sections = render.split_sections(body)
    if len(sections) < 3:
        raise BuildError("a module needs an intro and at least two '## ' sections")
    kicker = cat["title"] + (" · " + meta["group"] if meta["group"] else "")
    hero = render.hero_html(meta, kicker, sections[0])

    slides = [{"t": html.escape(meta["title"]), "i": meta["icon"], "h": hero, "hero": 1}]
    lecture = [md_cell(hero)]
    lecture.append(md_cell(
        '<div class="present"><span class="big">🎞️</span><div><b>Animated presentation</b><br><span>Run the next two '
        'cells to open the slides for this module right here in the notebook.</span></div></div>'))
    lecture.append({"k": "pip"})
    lecture.append({"k": "py", "t": "🎞️ Open the animated presentation",
                    "c": 'import databricksedu\n\ndatabricksedu.present("%s")' % mid})
    exercises, used, demo = [], [], False
    num = 0
    for sec in sections[1:]:
        num += 1
        title = render.section_title(sec)
        icon, text = render.split_icon(title)
        body_md = "\n".join(sec.splitlines()[1:])
        slides.append({"t": render.md_inline(text), "i": icon,
                       "h": render.section_head(title, num) + render.md_to_html(body_md, DS_HTML)})
        blocks = render.split_blocks(body_md)
        used += [b[1] for b in blocks if b[0] == "dataset" and b[1] not in used]
        if render.is_exercise(title):
            exercises.append(section_cells(sec, len(exercises) + 1))
        else:
            demo = demo or any(b[0] == "run" for b in blocks)
            lecture += section_cells(sec, num)

    nb_lecture = "01 Lecture - " + meta["title"]
    nb_ex = "02 Exercises - " + meta["title"]
    notebooks = []
    if exercises:
        lecture.append(md_cell('<div class="exercise"><span style="font-size:24px">✍️</span><div><b>Your turn.</b> '
                               'The exercises for this module are in the notebook <b>%s</b>, saved next to this one.'
                               '</div></div>' % html.escape(nb_ex)))
    if quiz:
        lecture.append(md_cell(render.section_head("Check yourself", num + 1)
                               + '<div id="dbxquiz" style="max-width:820px"></div>', quiz))
    lecture.append(md_cell(footer_html(cat, meta)))
    notebooks.append({"name": nb_lecture, "cells": lecture})

    if exercises:
        ex = [md_cell(render.hero_html(dict(meta, title="Exercises: " + meta["title"], icon="✍️"), kicker,
                                       "# x\n> Work through the tasks below. Each one has a starter cell and a hidden "
                                       "solution. Try first, then compare."))]
        ex.append({"k": "pip"})
        for name in used:
            ex.append(md_cell(render.section_head("🧪 Set up the demo data", 0).replace(">00<", ">▶<")
                              + render.dataset_html(DATASETS[name])))
            ex += dataset_cells(name)
        for cells in exercises:
            ex += cells
        ex.append(md_cell(footer_html(cat, meta)))
        notebooks.append({"name": nb_ex, "cells": ex})

    entry = {"id": mid, "order": order, "title": meta["title"], "summary": meta["summary"], "icon": meta["icon"],
             "level": meta["level"], "minutes": meta["minutes"], "tags": meta["tags"], "group": meta["group"],
             "slides": len(slides) + (1 if quiz else 0), "quiz": len(quiz or []), "exercises": len(exercises),
             "demo": demo, "datasets": used, "notebooks": [n["name"] for n in notebooks]}
    web = {"slides": slides, "quiz": quiz or [], "md": body}
    nb = {"notebooks": notebooks, "md": body}
    return entry, web, nb


# ------------------------------------------------------------------ whole build
def module_folders(cat_dir):
    return sorted(p for p in cat_dir.iterdir() if p.is_dir() and (p / "module.md").exists())


def minify_css(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "".join(l.strip() for l in text.splitlines())


def minify_js(text):
    return "\n".join(l.rstrip() for l in text.splitlines() if l.strip())


def write_assets():
    out = PKG / "assets"
    out.mkdir(parents=True, exist_ok=True)
    css = (ASSETS_SRC / "dbx.css").read_text(encoding="utf-8")
    base, _, viz = css.partition("/* ---------- visualizations ---------- */")
    (out / "dbx.css").write_text(minify_css(base), encoding="utf-8")
    (out / "viz.css").write_text(minify_css(viz), encoding="utf-8")
    (out / "app.css").write_text(minify_css((ASSETS_SRC / "app.css").read_text(encoding="utf-8")), encoding="utf-8")
    for name in ("viz.js", "quiz.js", "app.js"):
        (out / name).write_text(minify_js((ASSETS_SRC / name).read_text(encoding="utf-8")), encoding="utf-8")


def check(paths):
    cats = {c["id"]: c for c in json.loads((CONTENT / "categories.json").read_text(encoding="utf-8"))}
    failed = 0
    for p in paths:
        folder = Path(p).resolve()
        cat = cats.get(folder.parent.name)
        try:
            if cat is None:
                raise BuildError("parent folder %r is not a category in content/categories.json" % folder.parent.name)
            entry, web, nb = build_module(folder, cat)
            size = len(json.dumps(web))
            print("OK   %-40s %2d slides, %d quiz, %d exercises, %d notebook(s), %d KB"
                  % (entry["id"], entry["slides"], entry["quiz"], entry["exercises"], len(entry["notebooks"]), size // 1024))
        except (BuildError, render.VizError, ValueError, KeyError) as exc:
            failed += 1
            print("FAIL %s: %s: %s" % (folder.name, type(exc).__name__, exc))
    return 1 if failed else 0


def main():
    cats = json.loads((CONTENT / "categories.json").read_text(encoding="utf-8"))
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "web").mkdir(parents=True)
    (OUT / "nb").mkdir(parents=True)
    write_assets()
    seen, catalog, errors, total = {}, [], [], 0
    for cat in cats:
        entries = []
        cat_dir = CONTENT / cat["id"]
        for folder in (module_folders(cat_dir) if cat_dir.exists() else []):
            rel = folder.relative_to(ROOT)
            try:
                entry, web, nb = build_module(folder, cat)
            except (BuildError, render.VizError, ValueError, KeyError) as exc:
                errors.append("%s: %s: %s" % (rel, type(exc).__name__, exc))
                continue
            if entry["id"] in seen:
                errors.append("%s: module id %r is already used by %s" % (rel, entry["id"], seen[entry["id"]]))
                continue
            seen[entry["id"]] = rel
            raw = json.dumps(web, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            (OUT / "web" / (entry["id"] + ".b64")).write_bytes(base64.b64encode(gzip.compress(raw, 9, mtime=0)))
            (OUT / "nb" / (entry["id"] + ".json.gz")).write_bytes(
                gzip.compress(json.dumps(nb, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9, mtime=0))
            total += len(raw)
            entries.append(entry)
        entries.sort(key=lambda e: (e["order"], e["title"]))
        for pos, e in enumerate(entries, 1):
            e["n"] = pos
        if entries:
            catalog.append(dict(cat, modules=entries))
    (OUT / "catalog.json").write_text(json.dumps({"categories": catalog}, ensure_ascii=False, indent=1) + "\n",
                                      encoding="utf-8")
    n = sum(len(c["modules"]) for c in catalog)
    print("built %d modules in %d categories (%d KB of slides before compression)" % (n, len(catalog), total // 1024))
    for c in catalog:
        print("  %-22s %d" % (c["id"], len(c["modules"])))
    if errors:
        print("\n%d module(s) FAILED:" % len(errors))
        for e in errors:
            print("  " + e)
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--check":
        sys.exit(check(sys.argv[2:]))
    sys.exit(main())
