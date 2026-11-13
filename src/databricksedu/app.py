"""The in-notebook app: start(), present(), read()."""
import base64
import gzip
import html as _html
import json

from . import catalog
from ._version import __version__

DEFAULT_HEIGHT = 820


def _js_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def page(route="home", height=DEFAULT_HEIGHT, bar=False, only=None, compress=True):
    """The whole app as one self-contained HTML document.

    only       list of module ids to include (default: everything)
    compress   False embeds the content uncompressed (bigger page, works in very old browsers)
    """
    cats, content = [], {}
    for c in catalog.categories():
        mods = [m for m in c["modules"] if only is None or m["id"] in only]
        if not mods:
            continue
        cats.append({"id": c["id"], "title": c["title"], "icon": c["icon"], "desc": c.get("desc", ""),
                     "cta": bool(c.get("cta")), "modules": mods})
        for m in mods:
            blob = catalog.web_blob(m["id"])
            content[m["id"]] = {"z": blob} if compress else {
                "j": json.loads(gzip.decompress(base64.b64decode(blob)).decode("utf-8"))}
    data = {"version": __version__, "cfg": {"route": route, "height": height, "bar": bool(bar)},
            "categories": cats, "content": content}
    css = catalog.asset("dbx.css") + catalog.asset("viz.css") + catalog.asset("app.css")
    js = catalog.asset("viz.js") + "\n" + catalog.asset("quiz.js") + "\n" + catalog.asset("app.js")
    return ('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1"><title>databricksedu</title>'
            "<style>" + css + "</style></head><body>"
            '<div id="dbe" style="height:%dpx"></div>' % height
            + "<script>window.DBE=" + _js_json(data) + ";</script><script>" + js + "</script></body></html>")


# ------------------------------------------------------------------ displaying HTML
def _ipython():
    try:
        from IPython import get_ipython
        return get_ipython()
    except Exception:
        return None


def _databricks_display_html():
    ip = _ipython()
    if ip is not None and callable(ip.user_ns.get("displayHTML")):
        return ip.user_ns["displayHTML"]
    try:
        import os
        if os.environ.get("DATABRICKS_RUNTIME_VERSION"):
            from databricks.sdk.runtime import displayHTML
            return displayHTML
    except Exception:
        pass
    return None


def iframe(doc, height):
    """Wrap a full HTML document in an iframe (used outside Databricks, where output is not isolated)."""
    return ('<iframe data-dbe="1" srcdoc="%s" style="width:100%%;height:%dpx;border:0;border-radius:14px" '
            'allow="fullscreen; clipboard-write" allowfullscreen></iframe>' % (_html.escape(doc, quote=True), height + 4))


def display_html(doc, height=DEFAULT_HEIGHT, fallback_browser=True, framed=True):
    """Show an HTML document: displayHTML on Databricks, an iframe in Jupyter, the browser otherwise."""
    dbx = _databricks_display_html()
    if dbx is not None:
        dbx(doc)
        return "databricks"
    ip = _ipython()
    if ip is not None and getattr(ip, "kernel", None) is not None:
        from IPython.display import HTML, display
        display(HTML(iframe(doc, height) if framed else doc))
        return "jupyter"
    if fallback_browser:
        import os
        import tempfile
        import webbrowser
        path = os.path.join(tempfile.mkdtemp(prefix="databricksedu_"), "databricksedu.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(doc)
        webbrowser.open("file://" + path)
        print("Opened %s in your browser." % path)
        return "browser"
    return None


# ------------------------------------------------------------------ the save bar (ipywidgets)
def _save_bar(target=None):
    """A small row of real buttons above the app: choose what to save, press the button."""
    import ipywidgets as W
    from . import workspace

    options = [("Everything (all modules)", "all")]
    for c in catalog.categories():
        options.append(("%s %s: the whole track (%d modules)" % (c["icon"], c["title"], len(c["modules"])), c["id"]))
        options += [("      %s %s" % (m["icon"], m["title"]), m["id"]) for m in c["modules"]]
    state = {"clients": None, "error": None}
    try:                                   # connect now, while the cell is running and auth is available
        state["clients"] = workspace.connect()
    except Exception as exc:
        state["error"] = exc
    default = target or ("/Workspace/Users/%s/%s" % (state["clients"].user, workspace.DEFAULT_FOLDER)
                         if state["clients"] else "")
    what = W.Dropdown(options=options, value=options[1][1] if len(options) > 1 else "all",
                      layout=W.Layout(width="420px"))
    folder = W.Text(value=default, placeholder="/Workspace/Users/<you>/databricksedu",
                    layout=W.Layout(width="380px"))
    button = W.Button(description="Save to workspace", icon="save", button_style="danger",
                      layout=W.Layout(width="190px"))
    status = W.HTML()
    label = W.HTML('<b style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px">💾 Save to '
                   'workspace</b>')

    def note(text, color="#475569"):
        status.value = ('<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;'
                        'color:%s;padding:2px 0">%s</div>' % (color, text))

    def on_click(_):
        button.disabled = True
        note("Saving…")
        try:
            if state["clients"] is None:
                state["clients"] = workspace.connect()
            results = workspace.save(what.value, target=folder.value.strip() or None,
                                     clients=state["clients"], quiet=True)
            status.value = workspace.links_html(results)
        except Exception as exc:
            note("Could not save from the button (%s: %s). Run this in a cell instead: "
                 "<code>databricksedu.save(\"%s\")</code>" % (type(exc).__name__, _html.escape(str(exc))[:300],
                                                             what.value), "#B91C1C")
        finally:
            button.disabled = False

    button.on_click(on_click)
    if state["error"] is not None:
        note("Workspace connection is not available here, so the button may not work. "
             "<code>databricksedu.save(...)</code> does the same from a cell.")
    return W.VBox([W.HBox([label, what, folder, button], layout=W.Layout(align_items="center", flex_flow="row wrap")),
                   status])


# ------------------------------------------------------------------ public API
def start(route="home", ui="auto", height=DEFAULT_HEIGHT, target=None, compress=True):
    """Open the databricksedu app in the notebook.

    route     "home", "cat/<track id>", "slides/<module id>" or "doc/<module id>"
    ui        "auto": the app plus a Save-to-workspace button bar (needs ipywidgets and a workspace)
              "html": only the app (saving is done with databricksedu.save(...) from a cell)
    height    height of the app window in pixels (the ↕ button in the app changes it too)
    target    workspace folder for the Save bar (default /Workspace/Users/<you>/databricksedu)
    """
    if ui not in ("auto", "html"):
        raise ValueError('ui must be "auto" or "html"')
    bar = None
    ip = _ipython()
    if ui == "auto" and ip is not None and getattr(ip, "kernel", None) is not None:
        try:
            bar = _save_bar(target)
        except Exception:
            bar = None
    if bar is not None:
        from IPython.display import display
        display(bar)
    display_html(page(route=route, height=height, bar=bar is not None, compress=compress), height)


def _one(module, mode, height):
    _, m = catalog.resolve(module)[0] if len(catalog.resolve(module)) == 1 else (None, None)
    if m is None:
        raise ValueError("present() and read() take one module id. Run databricksedu.modules() to list them.")
    display_html(page(route="%s/%s" % (mode, m["id"]), height=height), height)


def present(module, height=DEFAULT_HEIGHT):
    """Play the animated slides of one module."""
    _one(module, "slides", height)


def read(module, height=DEFAULT_HEIGHT):
    """Open one module as a scrolling document (the rendered Markdown notes)."""
    _one(module, "doc", height)
