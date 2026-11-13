"""One-call loaders: data.create() puts a dataset into catalog.schema, data.files() writes raw files
into a volume. Both print a short report at the end."""
import json
import os
import random
import shutil

from ._core import _clean, _q, _serialize, get_spark, use

MODES = ("table", "view", "temp_view")
MODE_LABEL = {"table": "Delta tables (with primary and foreign keys)",
              "view": "views over Parquet files in a volume",
              "temp_view": "temporary views (this notebook session only)"}
STATE_FILE = "_databricksedu_state.json"
VOLUMES_ROOT = "/Volumes"            # tests point this at a temporary folder


# --------------------------------------------------------------------------- helpers
def _size(n):
    if n is None:
        return "-"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d %s" % (n, unit)) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0


def _check_target(catalog, schema):
    catalog, schema = _clean(catalog), _clean(schema)
    if not catalog or not schema or "FILL_IN" in (catalog + schema).upper():
        raise ValueError("Give a catalog and a schema you can write to (got %r, %r), for example "
                         'data.create("retail", "main", "my_schema").' % (catalog, schema))
    return catalog, schema


def _exists(spark, full_name):
    try:
        return bool(spark.catalog.tableExists(full_name))
    except Exception:
        try:
            spark.sql("DESCRIBE TABLE " + full_name)
            return True
        except Exception:
            return False


def _folder_size(path):
    total = 0
    for dirpath, _, names in os.walk(path):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(dirpath, n))
            except OSError:
                pass
    return total


def _schema_lines(t):
    keys = set(t.primary_key)
    fks = {col: "%s.%s" % (ref, ref_col) for col, ref, ref_col in t.foreign_keys}
    out = []
    for c, typ, _ in t.columns:
        tag = " PK" if c in keys else (" FK -> " + fks[c] if c in fks else "")
        out.append("      %-20s %s%s" % (c, typ.replace(" NOT NULL", ""), tag))
    return out


def _report(title, where, rows, tables, footer=()):
    """rows: [(name, kind, row count, size in bytes or None)]"""
    line = "=" * 78
    print(line)
    print("✅ " + title)
    print("   " + where)
    print(line)
    print("   %-40s %-12s %12s %10s" % ("name", "type", "rows", "size"))
    for name, kind, n, size in rows:
        print("   %-40s %-12s %12s %10s" % (name, kind, format(n, ","), _size(size)))
    print()
    for t in tables:
        print("   %s" % t.name + ("  (%s)" % t.comment if t.comment else ""))
        for s in _schema_lines(t):
            print(s)
    for f in footer:
        print(f)
    print(line)


# --------------------------------------------------------------------------- create
def create(ds, catalog, schema, mode="table", drop_existing=True, volume="databricksedu_files",
           spark=None, show_sql=False):
    """Put every table of ``ds`` into catalog.schema and print a report. See data.create()."""
    if mode not in MODES:
        raise ValueError("mode must be one of %s" % ", ".join(repr(m) for m in MODES))
    catalog, schema = _check_target(catalog, schema)
    spark = get_spark(spark)
    tgt = "%s.%s." % (_q(catalog), _q(schema))
    use(catalog, schema, spark, quiet=True)
    tables = list(ds)
    rows, footer, kept = [], [], []

    if mode == "temp_view":
        for t in tables:
            t.dataframe(spark).createOrReplaceTempView(t.name)
            rows.append((t.name, "temp view", len(t), None))
        footer.append("   Temporary views live only in this notebook session; nothing was written to %s.%s."
                      % (catalog, schema))

    elif mode == "table":
        ds.register_views(spark, quiet=True)
        for title, stmts in ds.statements(catalog, schema):
            for s in stmts:
                if s.startswith("DROP "):
                    if not drop_existing:
                        continue
                elif s.startswith("CREATE TABLE") or s.startswith("INSERT"):
                    name = s.split(tgt, 1)[1].split()[0]
                    if not drop_existing and _exists(spark, tgt + name):
                        if name not in kept:
                            kept.append(name)
                        continue
                elif s.startswith("ALTER TABLE"):
                    name = s.split(tgt, 1)[1].split()[0]
                    if name in kept:
                        continue
                if show_sql:
                    print(s + ";")
                spark.sql(s)
        for t in tables:
            full = tgt + t.name
            n = spark.table(full).count()
            try:
                size = spark.sql("DESCRIBE DETAIL " + full).first()["sizeInBytes"]
            except Exception:
                size = None
            rows.append((t.name, "table" + (" (kept)" if t.name in kept else ""), n, size))
        if kept:
            footer.append("   drop_existing=False: %s already existed and was left as it was." % ", ".join(kept))

    else:  # view: data as Parquet in a volume, a view on top of it
        spark.sql("CREATE VOLUME IF NOT EXISTS %s%s COMMENT 'databricksedu demo files'" % (tgt, _q(volume)))
        base = VOLUMES_ROOT + "/%s/%s/%s/%s" % (catalog, schema, _clean(volume), ds.name)
        for t in tables:
            full, path = tgt + t.name, "%s/%s" % (base, t.name)
            if not drop_existing and _exists(spark, full):
                kept.append(t.name)
                rows.append((t.name, "view (kept)", spark.table(full).count(), None))
                continue
            if drop_existing:
                for kind in ("VIEW", "TABLE"):
                    try:
                        spark.sql("DROP %s IF EXISTS %s" % (kind, full))
                    except Exception:
                        pass
            t.dataframe(spark).write.mode("overwrite").parquet(path)
            spark.sql("CREATE VIEW %s%s AS SELECT * FROM parquet.`%s`"
                      % (full, " COMMENT '%s'" % t.comment.replace("'", "\\'") if t.comment else "", path))
            rows.append((t.name, "view", spark.table(full).count(), _folder_size(path)))
        footer.append("   The views read Parquet files under %s" % base)

    footer.append("   Current catalog and schema: %s.%s  (plain table names work in the next cells)" % (catalog, schema))
    _report("Dataset '%s': %d %s created" % (ds.name, len(tables), "object" if len(tables) == 1 else "objects"),
            "%s.%s  ·  %s%s" % (catalog, schema, MODE_LABEL[mode],
                               "  ·  existing objects replaced" if drop_existing and mode != "temp_view" else ""),
            rows, tables, footer)
    return ds


# --------------------------------------------------------------------------- files
def files(module, name, catalog, schema, volume, n_files=1, fmt="csv", folder=None, rows_per_file=None,
          fresh=False, seed=None, spark=None):
    """Write raw files for one dataset into a volume. See data.files()."""
    if fmt not in ("csv", "json"):
        raise ValueError('fmt must be "csv" or "json"')
    if int(n_files) < 1:
        raise ValueError("n_files must be 1 or more")
    catalog, schema = _check_target(catalog, schema)
    volume = _clean(volume)
    if not volume or "FILL_IN" in volume.upper():
        raise ValueError("Give the name of a volume, for example volume=\"landing\" (it is created if missing).")
    spark = get_spark(spark)
    spark.sql("CREATE VOLUME IF NOT EXISTS %s.%s.%s COMMENT 'databricksedu demo files'"
              % (_q(catalog), _q(schema), _q(volume)))
    base = VOLUMES_ROOT + "/%s/%s/%s" % (catalog, schema, volume) + ("/" + folder.strip("/") if folder else "")
    if fresh:
        shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)

    # the big table grows with every call; the small ones are written once
    generate = module.generate
    probe = generate(seed=1, scale=0.1)
    big = getattr(module, "FILES_TABLE", None) or max(probe, key=len).name
    full_rows = len(probe[big]) * 10
    per_file = int(rows_per_file or max(1, full_rows // 3))
    run_seed = random.SystemRandom().randrange(1, 2 ** 31) if seed is None else seed
    ds = generate(seed=run_seed, scale=per_file * int(n_files) / float(full_rows) + 1e-9)

    state_path = os.path.join(base, STATE_FILE)
    try:
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}

    written = []                                   # (path, table, rows, bytes)
    t = ds[big]
    rows = list(t.rows)[:per_file * int(n_files)]
    if len(t.primary_key) == 1 and rows and isinstance(rows[0][t.column_names.index(t.primary_key[0])], int):
        i = t.column_names.index(t.primary_key[0])          # new files get new ids, never repeats
        offset = state.get("next_id", {}).get(big, 0)
        rows = [r[:i] + (r[i] + offset,) + r[i + 1:] for r in rows]
        state.setdefault("next_id", {})[big] = max(r[i] for r in rows)
    folder_big = os.path.join(base, big)
    os.makedirs(folder_big, exist_ok=True)
    number = state.get("files", {}).get(big, 0)
    for k in range(int(n_files)):
        chunk = rows[k * per_file:(k + 1) * per_file]
        if not chunk:
            break
        number += 1
        path = os.path.join(folder_big, "part_%04d.%s" % (number, fmt))
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(_serialize(t.column_names, chunk, fmt))
        written.append((path, big, len(chunk), os.path.getsize(path)))
    state.setdefault("files", {})[big] = number

    for other in ds:
        if other.name == big:
            continue
        path = os.path.join(base, other.name, "%s.%s" % (other.name, fmt))
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(_serialize(other.column_names, other.rows, fmt))
            written.append((path, other.name, len(other), os.path.getsize(path)))
    for rel, text in ds.extra_files.items():
        path = os.path.join(base, rel)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(text)
            written.append((path, rel.split("/")[0], text.count("\n") - 1, os.path.getsize(path)))

    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f)

    rows_out = [(p[len(base) + 1:], fmt.upper(), n, size) for p, _, n, size in written]
    _report("Dataset '%s': %d new file(s) written" % (name, len(written)),
            "%s  ·  %s in this folder, %d part file(s) of %s so far"
            % (base, _size(_folder_size(base)), number, big),
            rows_out, [x for x in ds if any(w[1] == x.name for w in written)],
            ["   Run the same call again to add %d more %s file(s) with new rows." % (int(n_files), big),
             "   Read them with: spark.read.format(\"%s\")%s.load(\"%s/%s\")"
             % (fmt, '.option("header", "true")' if fmt == "csv" else "", base, big)])
    return base
