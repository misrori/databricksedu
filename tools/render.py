"""Markdown -> styled HTML for databricksedu (slides, document view and notebook cells).

Conventions understood in a module.md (see CONTENT_GUIDE.md):
  ---front matter---             id, title, summary, icon, level, minutes, tags, group, order
  # Title                        intro section: becomes the hero
  ## Section                     one slide / one notebook cell per section
  ```python run / ```sql run     runnable notebook cell
  ```python todo / ```sql todo   exercise starter cell
  ```python solution / ...       collapsed solution
  ```viz <type>                  animated visualization (flow, files, table, code, compare, timeline, layers, tree, html)
  ```dataset <name>              the "generate data -> pick catalog.schema -> CREATE TABLE" setup block
  **The one idea to remember:**  highlighted idea card
  > quote                        callout card
  - ❌ ... / - ✅ ...             red / green list items
"""
import html as _html
import json
import re

import markdown
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

FENCE = re.compile(r"^```([^\n]*)\n(.*?)^```[ \t]*$", re.S | re.M)
_FMT = HtmlFormatter(nowrap=True, noclasses=True, style="github-dark")
COLORS = {"bronze", "silver", "gold", "red", "blue", "teal", "purple", "amber", "green", "navy", "gray", "pink"}
VIZ_TYPES = {"flow", "files", "table", "code", "compare", "timeline", "layers", "tree", "html"}

ICONS = [
    ("check yourself", "🎯"), ("what we covered", "🗺️"), ("try it", "🧪"), ("exercise", "✍️"), ("cheat", "🧭"),
    ("mistake", "⚠️"), ("trap", "🪤"), ("gotcha", "🪤"), ("best practice", "🏆"), ("further reading", "📚"),
    ("recap", "🧭"), ("summary", "🧭"), ("privacy", "🔐"), ("privilege", "🔐"), ("access", "🔐"), ("govern", "🛡️"),
    ("delet", "🧹"), ("vacuum", "🧹"), ("stream", "🌊"), ("state", "🧠"), ("watermark", "🧠"), ("join", "🔗"),
    ("cdc", "🔁"), ("change data", "🔁"), ("merge", "🔀"), ("bundle", "📦"), ("deploy", "🚀"), ("ci/cd", "🚀"),
    ("test", "🧪"), ("git", "🌿"), ("trigger", "⏰"), ("schedul", "⏰"), ("parameter", "🎛️"), ("quality", "✅"),
    ("expectation", "✅"), ("monitor", "📈"), ("log", "📜"), ("json", "🧩"), ("parquet", "📦"), ("file", "🗂️"),
    ("time travel", "⏳"), ("version", "⏳"), ("history", "⏳"), ("schema", "🧬"), ("optimi", "⚡"),
    ("cluster", "🧲"), ("compute", "🖥️"), ("spark", "⚙️"), ("ingest", "📥"), ("load", "📥"), ("dashboard", "📊"),
    ("genie", "🧞"), ("metric", "📏"), ("anatomy", "🧬"), ("pipeline", "🏗️"), ("medallion", "🏅"),
    ("bronze", "🥉"), ("silver", "🥈"), ("gold", "🥇"), ("python", "🐍"), ("sql", "🗃️"), ("job", "🕸️"),
    ("why", "💡"), ("what is", "💡"), ("how", "🔧"), ("model", "🤖"), ("feature", "🧱"), ("mlflow", "🧪"),
    ("serving", "🛎️"), ("vector", "🧭"), ("embedding", "🧭"), ("rag", "📚"), ("prompt", "💬"), ("agent", "🕵️"),
    ("llm", "🧠"), ("token", "🔤"), ("evaluat", "⚖️"), ("exam", "🎓"), ("domain", "🗺️"), ("plan", "🗓️"),
    ("data", "🗄️"),
]


def icon_for(title):
    t = title.lower()
    for key, icon in ICONS:
        if key in t:
            return icon
    return "✨"


def split_icon(title):
    """'🧬 Anatomy' -> ('🧬', 'Anatomy'); otherwise the icon is guessed from the words."""
    m = re.match(r"^([^\w\s`*\[(\"'#]+)\s+(.*)$", title.strip())
    if m and any(ord(ch) > 0x2000 for ch in m.group(1)):
        return m.group(1), m.group(2).strip()
    return icon_for(title), title.strip()


# ------------------------------------------------------------------ front matter
def parse_front_matter(text):
    meta = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end == -1:
            raise ValueError("front matter is not closed with ---")
        for line in text[3:end].strip().splitlines():
            if not line.strip() or line.strip().startswith("#"):
                continue
            key, _, value = line.partition(":")
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                value = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
            elif re.fullmatch(r"-?\d+", value):
                value = int(value)
            elif value.lower() in ("true", "false"):
                value = value.lower() == "true"
            else:
                value = value.strip("'\"")
            meta[key.strip()] = value
        text = text[end + 4:].lstrip("\n")
    return meta, text


def split_sections(md):
    sections, cur, fence = [], [], False
    for line in md.splitlines():
        if line.startswith("```"):
            fence = not fence
        if not fence and line.startswith("## ") and cur:
            sections.append("\n".join(cur).strip())
            cur = []
        cur.append(line)
    if cur:
        sections.append("\n".join(cur).strip())
    return [s for s in sections if s]


def section_title(section_md):
    first = section_md.splitlines()[0]
    return first[3:].strip() if first.startswith("## ") else first.lstrip("# ").strip()


def is_exercise(title):
    return split_icon(title)[1].lower().startswith("exercise")


# ------------------------------------------------------------------ inline + code
def md_inline(text):
    h = markdown.markdown(str(text), output_format="html").strip()
    return re.sub(r"^<p>(.*)</p>$", r"\1", h, flags=re.S)


def _hl(code, lang):
    try:
        lexer = get_lexer_by_name({"sh": "bash", "shell": "bash", "text": "text"}.get(lang, lang))
        return highlight(code, lexer, _FMT).rstrip("\n")
    except ClassNotFound:
        return _html.escape(code)


def code_html(code, lang, tag=""):
    code = code.rstrip("\n")
    if not lang:
        return '<pre class="diagram">%s</pre>' % _html.escape(code)
    badge = {"run": '<span class="run">▶ runs in the notebook</span>',
             "todo": '<span class="run todo">✍️ your turn</span>'}.get(tag, "")
    box = ('<div class="code"><div class="code-bar"><i></i><i></i><i></i><span class="lang">%s</span>%s'
           '<button class="copy" type="button">copy</button></div><pre>%s</pre></div>'
           % (_html.escape(lang.upper()), badge, _hl(code, lang)))
    if tag == "solution":
        return '<details class="solution"><summary>💡 Show the solution</summary>%s</details>' % box
    return box


def enhance(h):
    h = h.replace("<blockquote>", '<blockquote class="callout">')
    h = re.sub(r"<li>(\s*(?:<p>)?)❌", r'<li class="bad">\1❌', h)
    h = re.sub(r"<li>(\s*(?:<p>)?)✅", r'<li class="good">\1✅', h)
    h = re.sub(r"<p><strong>(The one idea to remember:?)</strong>(.*?)</p>",
               r'<div class="idea"><span class="idea-icon">💡</span><div><b>\1</b>\2</div></div>', h, flags=re.S)
    h = h.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
    h = re.sub(r'<a href="(http[^"]+)"', r'<a target="_blank" rel="noopener" href="\1"', h)
    return h


def md_to_html(text, datasets=None):
    """Markdown with fenced blocks -> HTML. `datasets` maps a name to its description (for ```dataset)."""
    stash = []

    def repl(m):
        info = m.group(1).strip().split()
        lang = info[0] if info else ""
        tag = info[1] if len(info) > 1 else ""
        if lang == "viz":
            stash.append(viz_html(tag, m.group(2)))
        elif lang == "dataset":
            stash.append(datasets[tag] if datasets is not None else "")
        else:
            stash.append(code_html(m.group(2), lang, tag))
        return "\n\nDBXBLOCK%dX\n\n" % (len(stash) - 1)

    text = FENCE.sub(repl, text)
    out = markdown.markdown(text, extensions=["tables", "sane_lists"], output_format="html")
    out = re.sub(r"<p>DBXBLOCK(\d+)X</p>", lambda m: stash[int(m.group(1))], out)
    return enhance(out)


def split_blocks(section_md):
    """[('md', text) | ('run'|'todo', lang, code) | ('dataset', name)] in order."""
    out, pos = [], 0
    for m in FENCE.finditer(section_md):
        info = m.group(1).strip().split()
        lang = info[0] if info else ""
        tag = info[1] if len(info) > 1 else ""
        if lang == "dataset":
            block = ("dataset", tag)
        elif tag in ("run", "todo") and lang in ("python", "sql"):
            block = (tag, lang, m.group(2).rstrip("\n"))
        else:
            continue
        out.append(("md", section_md[pos:m.start()]))
        out.append(block)
        pos = m.end()
    out.append(("md", section_md[pos:]))
    return [b for b in out if not (b[0] == "md" and not b[1].strip())]


def fence_infos(md):
    return [m.group(1).strip().split() for m in FENCE.finditer(md)]


# ------------------------------------------------------------------ page parts
def hero_html(meta, kicker, intro_md):
    """The intro section: kicker, title, chips, subtitle (from the blockquote), then the rest."""
    lines = intro_md.splitlines()
    rest = "\n".join(lines[1:])
    quote = " ".join(l[1:].strip() for l in rest.splitlines() if l.startswith(">") and l[1:].strip())
    body = "\n".join(l for l in rest.splitlines() if not l.startswith(">"))
    chips = [meta.get("level"), "⏱ ~%s min" % meta["minutes"] if meta.get("minutes") else None]
    chips += list(meta.get("tags") or [])[:4]
    chip_html = "".join('<span class="chip">%s</span>' % _html.escape(str(c)) for c in chips if c)
    return ('<div class="hero"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>'
            '<div class="hero-in"><div class="kicker">%s</div><h1><span class="hero-icon">%s</span>%s</h1>'
            '<div class="chips">%s</div><p class="sub">%s</p></div></div>'
            % (_html.escape(kicker), meta.get("icon", "✨"), _html.escape(meta["title"]), chip_html,
               md_inline(quote or meta.get("summary", "")))) + md_to_html(body)


def section_head(title, num):
    icon, text = split_icon(title)
    return ('<div class="sec-head"><span class="sec-num">%02d</span><span class="sec-icon">%s</span>'
            '<h2>%s</h2></div>' % (num, icon, md_inline(text)))


def dataset_html(desc):
    """Card describing a dataset: tables, keys and how they join."""
    tables = []
    for t in desc["tables"]:
        fk_cols = {fk[0]: fk for fk in t["foreign_keys"]}
        cols = []
        for name, typ, _ in t["columns"]:
            badge = ""
            if name in t["primary_key"]:
                badge += '<span class="k pk">PK</span>'
            if name in fk_cols:
                badge += '<span class="k fk">FK → %s</span>' % _html.escape(fk_cols[name][1])
            cols.append('<div class="ds-col"><code>%s</code><span class="ty">%s</span>%s</div>'
                        % (_html.escape(name), _html.escape(typ.replace(" NOT NULL", "")), badge))
        tables.append('<div class="ds-table"><div class="ds-th">🗃️ %s</div><div class="ds-cm">%s</div>%s</div>'
                      % (_html.escape(t["name"]), _html.escape(t["comment"]), "".join(cols)))
    return ('<div class="dataset"><div class="ds-head"><span class="ds-icon">%s</span><div><b>Demo data: %s</b>'
            '<br><span>%s</span></div><code class="ds-call">data.generate("%s", seed=42)</code></div>'
            '<div class="ds-tables">%s</div></div>'
            % (desc["icon"], _html.escape(desc["title"]), _html.escape(desc["summary"]), desc["name"],
               "".join(tables)))


# ------------------------------------------------------------------ visualizations
class VizError(ValueError):
    pass


def _st(states):
    """List of per-step states -> data-st='0:a,2:b' (only the changes) plus the final state."""
    parts, prev = [], None
    for k, s in enumerate(states):
        if s != prev:
            parts.append("%d:%s" % (k, s))
            prev = s
    return 'data-st="%s" data-state="%s"' % (",".join(parts), states[-1])


def _color(c, default="blue"):
    c = c or default
    if c not in COLORS:
        raise VizError("unknown color %r (use one of %s)" % (c, ", ".join(sorted(COLORS))))
    return c


def _wrap(kind, title, body, notes=None, caption="", steps=0):
    out = ['<div class="vz vz-%s"%s>' % (kind, ' data-steps="%d"' % steps if steps else "")]
    out.append('<div class="vz-top"><span class="vz-title">%s</span><span class="vz-ctl"></span></div>'
               % md_inline(title or ""))
    out.append('<div class="vz-body">%s</div>' % body)
    if notes:
        out.append('<div class="vz-notes">%s</div>' % "".join(
            '<div class="vz-note" data-step="%d"><span class="vz-n">%d</span><div><b class="vz-lb">%s</b>%s</div></div>'
            % (k, k + 1, md_inline(label), (" " + md_inline(note)) if note else "")
            for k, (label, note) in enumerate(notes)))
    if caption:
        out.append('<div class="vz-cap">%s</div>' % md_inline(caption))
    out.append("</div>")
    return "".join(out)


def _json(src):
    try:
        return json.loads(src)
    except ValueError as exc:
        raise VizError("viz block is not valid JSON: %s" % exc)


def viz_html(kind, src):
    if kind not in VIZ_TYPES:
        raise VizError("unknown viz type %r (use one of %s)" % (kind, ", ".join(sorted(VIZ_TYPES))))
    if kind == "html":
        return '<div class="vz vz-html"><div class="vz-body">%s</div></div>' % src.strip()
    if kind == "code":
        return _viz_code(src)
    return globals()["_viz_" + kind](_json(src))


def _viz_flow(d):
    nodes, edges, steps = d["nodes"], d.get("edges") or [], d.get("steps") or []
    n = len(steps)
    parts = []
    for i, nd in enumerate(nodes):
        states = [("hl" if i in s.get("focus", []) else "dim") for s in steps] or ["on"]
        items = "".join("<li>%s</li>" % md_inline(x) for x in nd.get("items", []))
        parts.append('<div class="vz-node c-%s" style="--i:%d" %s><div class="vz-ic">%s</div><b>%s</b>'
                     '<span>%s</span>%s</div>' % (_color(nd.get("color")), i, _st(states), nd.get("icon", "📦"),
                                                  md_inline(nd["title"]), md_inline(nd.get("sub", "")),
                                                  "<ul>%s</ul>" % items if items else ""))
        if i < len(nodes) - 1:
            label = edges[i] if i < len(edges) else ""
            parts.append('<div class="vz-edge" style="--i:%d"><em>%s</em><div class="vz-line"><i></i><i></i><i></i>'
                         '</div></div>' % (i, md_inline(label)))
    notes = [(s.get("label", "Step %d" % (k + 1)), s.get("note", "")) for k, s in enumerate(steps)]
    return _wrap("flow", d.get("title"), '<div class="vz-flow">%s</div>' % "".join(parts), notes,
                 d.get("caption", ""), n)


_FILE_ICONS = [("_last_checkpoint", "📍"), (".checkpoint.parquet", "🏁"), (".crc", "🔢"), (".bin", "🩹"),
               (".json", "📜"), (".parquet", "📦"), (".csv", "📄"), (".yml", "📝"), (".yaml", "📝"), (".py", "🐍"),
               (".sql", "🗃️")]


def _file_icon(path):
    for suffix, icon in _FILE_ICONS:
        if path.endswith(suffix):
            return icon
    return "📄"


def _viz_files(d):
    steps = d["steps"]
    n = len(steps)
    files, order = {}, []                      # path -> per-step base state
    tags = {}                                  # path -> [(step, text)]
    for k, s in enumerate(steps):
        for f in s.get("add", []):
            f = {"path": f} if isinstance(f, str) else f
            p = f["path"]
            if p in files:
                raise VizError("files viz: %r is added twice" % p)
            files[p] = {"add": k}
            order.append(p)
            tags[p] = [(k, f.get("tag", ""))]
        for key in ("remove", "delete"):
            for p in s.get(key, []):
                if p not in files:
                    raise VizError("files viz: step %d %ss unknown file %r" % (k, key, p))
                files[p][key] = k
        for p, text in (s.get("tag") or {}).items():
            if p not in files:
                raise VizError("files viz: step %d tags unknown file %r" % (k, p))
            tags[p].append((k, text))

    def states(p):
        f, out = files[p], []
        for k in range(n):
            if k < f["add"]:
                st = "hide"
            elif "delete" in f and k > f["delete"]:
                st = "gone"
            elif "delete" in f and k == f["delete"]:
                st = "del"
            elif "remove" in f and k >= f["remove"]:
                st = "tombnew" if k == f["remove"] else "tomb"
            else:
                st = "new" if k == f["add"] else "on"
            out.append(st)
        return out

    def row(p, name):
        tag_html = ""
        for j, (k, text) in enumerate(tags[p]):
            end = tags[p][j + 1][0] if j + 1 < len(tags[p]) else n
            sts = ["hide" if (i < k or i >= end) else ("new" if (i == k and j > 0) else "on") for i in range(n)]
            if text:
                tag_html += '<span class="vz-tag" %s>%s</span>' % (_st(sts), md_inline(text))
        return ('<div class="vz-file" %s><span class="fi">%s</span><span class="fn">%s</span>%s'
                '<span class="fs"></span></div>' % (_st(states(p)), _file_icon(p), _html.escape(name), tag_html))

    groups = {}
    for p in order:
        folder, _, name = p.rpartition("/")
        groups.setdefault(folder, []).append((p, name))
    ordered = sorted(groups, key=lambda g: (0 if g.startswith("_delta_log") else 1 if g else 2, g))
    body = []
    for g in ordered:
        rows = "".join(row(p, name) for p, name in groups[g])
        first = min(files[p]["add"] for p, _ in groups[g])
        gst = _st(["hide" if k < first else "on" for k in range(n)])
        head = '<div class="vz-dir">📁 %s/</div>' % _html.escape(g) if g else '<div class="vz-dir">📁 data files</div>'
        body.append('<div class="vz-group%s" %s>%s%s</div>' % (" log" if g.startswith("_delta_log") else "", gst,
                                                                head, rows))
    legend = ('<div class="vz-legend"><span class="lg on">in the current version</span>'
              '<span class="lg tomb">removed from the table, still on disk</span>'
              '<span class="lg log">transaction log</span></div>')
    notes = [(s.get("label", "Step %d" % (k + 1)), s.get("note", "")) for k, s in enumerate(steps)]
    return _wrap("files", d.get("title", "Table directory"), "".join(body) + legend, notes, d.get("caption", ""), n)


def _viz_table(d):
    cols, steps = d["columns"], d.get("steps") or [{"label": d.get("title", "Table")}]
    n = len(steps)
    rows = [list(r) for r in d.get("rows", [])]
    born = [0] * len(rows)
    events = []                                # per step: dict of row idx -> flash state
    base = [["on"] * n for _ in rows]
    values = [[[(0, v)] for v in r] for r in rows]
    for k, s in enumerate(steps):
        flash = {}
        for r in s.get("add", []):
            if len(r) != len(cols):
                raise VizError("table viz: added row %r does not have %d values" % (r, len(cols)))
            rows.append(list(r))
            born.append(k)
            base.append(["hide"] * k + ["on"] * (n - k))
            values.append([[(k, v)] for v in r])
            flash[len(rows) - 1] = "new"
        for key, st in (("del", "del"), ("hide", "gone")):
            for i in s.get(key, []):
                if not 0 <= i < len(rows):
                    raise VizError("table viz: step %d %s refers to row %d which does not exist yet" % (k, key, i))
                for j in range(k, n):
                    base[i][j] = st
                if st == "del":
                    flash[i] = "delnew"
        for i, change in (s.get("upd") or {}).items():
            i = int(i)
            if not 0 <= i < len(rows):
                raise VizError("table viz: step %d upd refers to row %d which does not exist yet" % (k, i))
            for col, v in change.items():
                if col not in cols:
                    raise VizError("table viz: unknown column %r in upd" % col)
                values[i][cols.index(col)].append((k, v))
            flash[i] = "upd"
        for i in s.get("hl", []):
            flash.setdefault(int(i), "hl")
        events.append(flash)

    body = ['<div class="tbl"><table><thead><tr>%s</tr></thead><tbody>'
            % "".join("<th>%s</th>" % _html.escape(str(c)) for c in cols)]
    for i in range(len(rows)):
        states = [events[k].get(i, base[i][k]) if base[i][k] != "hide" and base[i][k] != "gone" else base[i][k]
                  for k in range(n)]
        cells = []
        for versions in values[i]:
            spans = ""
            for j, (k, v) in enumerate(versions):
                end = versions[j + 1][0] if j + 1 < len(versions) else n
                sts = ["hide" if (s < k or s >= end) else ("new" if (s == k and j > 0) else "on") for s in range(n)]
                spans += "<span %s>%s</span>" % (_st(sts), "<i>NULL</i>" if v is None else _html.escape(str(v)))
            cells.append("<td>%s</td>" % spans)
        body.append("<tr %s>%s</tr>" % (_st(states), "".join(cells)))
    body.append("</tbody></table></div>")
    notes = [(s.get("label", "Step %d" % (k + 1)), s.get("note", "")) for k, s in enumerate(steps)]
    return _wrap("table", d.get("title"), "".join(body), notes if len(steps) > 1 or steps[0].get("note") else None,
                 d.get("caption", ""), n if n > 1 else 0)


def _viz_code(src):
    """header (key: value) --- code --- steps (lines | label | note)"""
    parts = re.split(r"^---[ \t]*$", src, flags=re.M)
    if len(parts) != 3:
        raise VizError("code viz needs three parts separated by '---' lines: header, code, steps")
    head = dict((k.strip(), v.strip()) for k, _, v in (l.partition(":") for l in parts[0].strip().splitlines() if l.strip()))
    lines = parts[1].strip("\n").split("\n")
    steps = []
    for l in parts[2].strip().splitlines():
        if not l.strip():
            continue
        bits = [b.strip() for b in l.split("|", 2)]
        if len(bits) < 2:
            raise VizError("code viz step must look like 'lines | label | note': %r" % l)
        sel = set()
        for rng in bits[0].split(","):
            a, _, b = rng.strip().partition("-")
            a, b = int(a), int(b or a)
            if not (1 <= a <= b <= len(lines)):
                raise VizError("code viz: line range %r is outside 1-%d" % (rng, len(lines)))
            sel.update(range(a, b + 1))
        steps.append((sel, bits[1], bits[2] if len(bits) > 2 else ""))
    if not steps:
        raise VizError("code viz needs at least one step")
    lang = head.get("lang", "text")
    rows = []
    for i, line in enumerate(lines, 1):
        states = ["hl" if i in sel else "dim" for sel, _, _ in steps]
        rows.append('<span class="vz-ln" %s><i>%d</i>%s</span>' % (_st(states), i, _hl(line, lang) or " "))
    body = '<pre class="vz-code">%s</pre>' % "".join(rows)
    return _wrap("code", head.get("title", lang.upper()), body, [(lb, nt) for _, lb, nt in steps],
                 head.get("caption", ""), len(steps))


def _viz_compare(d):
    cards = []
    for i, it in enumerate(d["items"]):
        pts = "".join('<li class="%s">%s</li>' % ("good" if str(p).startswith("✅") else "bad" if str(p).startswith("❌")
                                                 else "", md_inline(p)) for p in it.get("points", []))
        foot = '<div class="vz-foot">%s</div>' % md_inline(it["foot"]) if it.get("foot") else ""
        cards.append('<div class="vz-card c-%s" style="--i:%d"><div class="vz-ic">%s</div><b>%s</b><span>%s</span>'
                     '<ul>%s</ul>%s</div>' % (_color(it.get("color")), i, it.get("icon", "📦"), md_inline(it["title"]),
                                              md_inline(it.get("sub", "")), pts, foot))
    return _wrap("compare", d.get("title"), '<div class="vz-cards">%s</div>' % "".join(cards), None,
                 d.get("caption", ""))


def _viz_timeline(d):
    items = d["items"]
    n = len(items)
    stepped = d.get("stepped", True)
    out = []
    for i, it in enumerate(items):
        states = (["hide"] * i + ["new"] + ["on"] * (n - i - 1)) if stepped else ["on"]
        out.append('<div class="vz-tl c-%s" style="--i:%d" %s><span class="vz-dot">%s</span><b>%s</b><span>%s</span></div>'
                   % (_color(it.get("color")), i, _st(states), md_inline(it.get("label", str(i))),
                      md_inline(it.get("title", "")), md_inline(it.get("sub", ""))))
    notes = [(it.get("title", it.get("label", "")), it.get("note", "")) for it in items] if stepped else None
    return _wrap("timeline", d.get("title"), '<div class="vz-tls">%s</div>' % "".join(out), notes,
                 d.get("caption", ""), n if stepped else 0)


def _viz_layers(d):
    out = []
    for i, ly in enumerate(d["layers"]):
        items = "".join("<span>%s</span>" % md_inline(x) for x in ly.get("items", []))
        out.append('<div class="vz-layer c-%s" style="--i:%d"><div class="vz-ic">%s</div><div class="vz-lt"><b>%s</b>'
                   '<em>%s</em></div><div class="vz-li">%s</div></div>'
                   % (_color(ly.get("color")), i, ly.get("icon", "🧱"), md_inline(ly["title"]),
                      md_inline(ly.get("sub", "")), items))
    return _wrap("layers", d.get("title"), '<div class="vz-layers">%s</div>' % "".join(out), None, d.get("caption", ""))


def _viz_tree(d):
    counter = [0]

    def node(nd):
        counter[0] += 1
        kids = "".join(node(c) for c in nd.get("children", []))
        return ('<li><div class="vz-tn c-%s" style="--i:%d"><span class="vz-ic">%s</span><b>%s</b><em>%s</em></div>%s</li>'
                % (_color(nd.get("color"), "navy"), counter[0], nd.get("icon", "📁"), md_inline(nd["label"]),
                   md_inline(nd.get("sub", "")), "<ul>%s</ul>" % kids if kids else ""))

    return _wrap("tree", d.get("title"), '<ul class="vz-tree">%s</ul>' % node(d["root"]), None, d.get("caption", ""))
