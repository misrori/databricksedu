"""Turn the packaged cells into Databricks notebooks and copy them into the workspace."""
import base64
import json
import re

from . import catalog

DEFAULT_FOLDER = "databricksedu"


# ------------------------------------------------------------------ notebook source
def _magic(text):
    return "\n".join("# MAGIC " + line if line else "# MAGIC" for line in text.splitlines())


_CSS_JS = {}


def _css_loader(with_viz):
    """A script that adds the stylesheet. Databricks runs the scripts of a %md-sandbox cell, but its
    Markdown pass can break a long <style> block (CSS is full of * and _); base64 has neither."""
    if with_viz not in _CSS_JS:
        css = catalog.asset("dbx.css") + (catalog.asset("viz.css") if with_viz else "")
        b64 = base64.b64encode(css.encode("utf-8")).decode("ascii")
        b64 = "'+\n'".join(b64[i:i + 400] for i in range(0, len(b64), 400))     # short lines
        _CSS_JS[with_viz] = ("(function(){var b=atob('%s'),u=new Uint8Array(b.length);"
                             "for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);"
                             "var s=document.createElement('style');s.textContent=new TextDecoder('utf-8').decode(u);"
                             "(document.head||document.documentElement).appendChild(s);})();\n" % b64)
    return _CSS_JS[with_viz]


def _sandbox(cell):
    """A %md-sandbox cell. No blank lines (they would end the HTML block) and no bare $ (KaTeX)."""
    body = cell["h"].replace("$", "&#36;")
    body = "\n".join(line if line.strip() else "<span></span>" for line in body.splitlines())
    out = "%md-sandbox\n<div class=\"dbx\">\n" + body + "\n</div>"
    script = _css_loader(bool(cell.get("viz")))
    if cell.get("viz"):
        script += catalog.asset("viz.js") + "\nDBXViz.init(document, {autoplay: true});\n"
    if cell.get("quiz"):
        quiz = json.dumps(cell["quiz"], ensure_ascii=False).replace("$", "\\u0024").replace("</", "<\\/")
        script += catalog.asset("quiz.js") + "\ndbxQuiz('dbxquiz', " + quiz + ");\n"
    out += "\n<script>\n" + script.replace("$", "\\u0024") + "</script>"
    return out


def notebook_source(cells):
    """Cells -> Databricks notebook source (Python notebook with %md-sandbox and %sql cells)."""
    parts = []
    for cell in cells:
        kind = cell["k"]
        title = "# DBTITLE 1,%s\n" % cell["t"].replace("\n", " ") if cell.get("t") else ""
        if kind == "md":
            parts.append(_magic(_sandbox(cell)))
        elif kind == "pip":
            parts.append("# DBTITLE 1,Run this first: install databricksedu\n# MAGIC %pip install -q databricksedu")
        elif kind == "sql":
            parts.append(title + _magic("%sql\n" + cell["c"]))
        else:
            parts.append(title + cell["c"])
    return "# Databricks notebook source\n" + "\n\n# COMMAND ----------\n\n".join(parts) + "\n"


def _safe(name):
    return re.sub(r'[\\/:*?"<>|]+', " ", name).strip()


def files_for(category, module):
    """[(relative path, kind, text)] for one module. kind is 'notebook' or 'file'."""
    bundle = catalog.notebook_bundle(module["id"])
    folder = "%s/%s" % (_safe(category["title"]), _safe("%02d %s" % (module.get("n", 0), module["title"])))
    out = [("%s/%s" % (folder, _safe(nb["name"])), "notebook", notebook_source(nb["cells"]))
           for nb in bundle["notebooks"]]
    out.append(("%s/%s.md" % (folder, module["id"]), "file", bundle["md"]))
    return folder, out


# ------------------------------------------------------------------ workspace client
class _Clients(object):
    """Workspace clients. The second one pins the token seen while a cell was running, so that
    button callbacks (which run outside a cell) can still authenticate."""

    def __init__(self):
        from databricks.sdk import WorkspaceClient
        self.primary = WorkspaceClient()
        self.pinned = None
        self.user = self.primary.current_user.me().user_name
        self.host = (self.primary.config.host or "").rstrip("/")
        try:
            auth = self.primary.config.authenticate().get("Authorization", "")
            if auth.lower().startswith("bearer ") and self.host:
                self.pinned = WorkspaceClient(host=self.host, token=auth[7:])
        except Exception:
            pass

    def call(self, fn):
        try:
            return fn(self.primary)
        except Exception:
            if self.pinned is None:
                raise
            return fn(self.pinned)


def connect():
    return _Clients()


def save(what="all", target=None, overwrite=True, include_notes=True, clients=None, quiet=False):
    """Copy modules into your workspace as notebooks.

    what       "all", a track id ("data-engineering"), or a module id ("delta-table-anatomy")
    target     workspace folder; default /Workspace/Users/<you>/databricksedu
    Returns a list of {"title", "folder", "url", "files"} dicts, one per module.
    """
    from databricks.sdk.service.workspace import ImportFormat, Language

    selected = catalog.resolve(what)
    clients = clients or connect()
    base = (target or "/Workspace/Users/%s/%s" % (clients.user, DEFAULT_FOLDER)).rstrip("/")
    results = []
    for category, module in selected:
        folder, files = files_for(category, module)
        full = "%s/%s" % (base, folder)
        clients.call(lambda w: w.workspace.mkdirs(full))
        saved = []
        for rel, kind, text in files:
            path = "%s/%s" % (base, rel)
            payload = base64.b64encode(text.encode("utf-8")).decode("ascii")
            if kind == "notebook":
                clients.call(lambda w: w.workspace.import_(path=path, content=payload, format=ImportFormat.SOURCE,
                                                           language=Language.PYTHON, overwrite=overwrite))
            elif include_notes:
                try:
                    clients.call(lambda w: w.workspace.import_(path=path, content=payload, format=ImportFormat.RAW,
                                                               overwrite=overwrite))
                except Exception:
                    continue            # notes are a bonus: never fail the save because of them
            else:
                continue
            saved.append(path)
        url = None
        try:
            oid = clients.call(lambda w: w.workspace.get_status(full).object_id)
            url = "%s/browse/folders/%s" % (clients.host, oid) if clients.host else None
        except Exception:
            pass
        results.append({"title": module["title"], "folder": full, "url": url, "files": saved})
        if not quiet:
            print("saved  %s  ->  %s" % (module["title"], full))
    if not quiet:
        _show_links(results)
    return results


def links_html(results):
    rows = "".join(
        '<div style="margin:3px 0">&#9989; <b>%s</b>: %s</div>'
        % (r["title"], '<a href="%s" target="_blank">%s</a>' % (r["url"], r["folder"]) if r["url"] else r["folder"])
        for r in results)
    return ('<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;padding:10px 14px;'
            'border-radius:12px;background:#ECFDF3;border:1px solid #A7F3D0;color:#065F46">'
            '<b>Saved %d module(s) to your workspace.</b>%s</div>' % (len(results), rows))


def _show_links(results):
    from .app import display_html
    try:
        display_html(links_html(results), fallback_browser=False)
    except Exception:
        pass
