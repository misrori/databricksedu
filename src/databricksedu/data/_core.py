"""Core classes for the synthetic datasets: Table, Dataset, and the Spark helpers.

Everything here is pure Python (standard library only). Spark is only touched by the
methods that take or look up a ``spark`` session.
"""
import csv
import datetime as _dt
import io
import json
import os
import re

SRC_PREFIX = "src_"


# --------------------------------------------------------------------------- helpers
def pick(rng, weighted):
    """Weighted choice built on rng.random() only, so results are stable across Python versions."""
    r, acc = rng.random(), 0.0
    for value, w in weighted:
        acc += w
        if r < acc:
            return value
    return weighted[-1][0]


def get_spark(spark=None):
    """Return the given session, or find the notebook's active Spark session."""
    if spark is not None:
        return spark
    try:
        from IPython import get_ipython
        ip = get_ipython()
        if ip is not None and ip.user_ns.get("spark") is not None:
            return ip.user_ns["spark"]
    except Exception:
        pass
    try:
        from pyspark.sql import SparkSession
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
        return SparkSession.builder.getOrCreate()
    except Exception as exc:  # pragma: no cover - only without Spark
        raise RuntimeError("No Spark session found. Run this inside a Databricks notebook, "
                           "or pass spark=<your session>.") from exc


def _clean(name):
    return str(name).strip().strip("`").strip()


def _q(name):
    return "`" + _clean(name).replace("`", "``") + "`"


def _suggest(spark):
    try:
        user = spark.sql("SELECT current_user()").first()[0]
        guess = re.sub(r"[^a-z0-9_]", "_", user.split("@")[0].lower())
        if spark.sql("SHOW SCHEMAS IN dbacademy LIKE '%s'" % guess).count():
            return ' In a Databricks Academy lab this is usually CATALOG = "dbacademy", SCHEMA = "%s".' % guess
    except Exception:
        pass
    return " Run SHOW CATALOGS / SHOW SCHEMAS IN <catalog> to find a schema you can write to."


def use(catalog, schema, spark=None, quiet=False):
    """Validate the target and run USE CATALOG / USE SCHEMA. Never creates a catalog or schema.

    Returns the quoted ``catalog.schema`` name.
    """
    spark = get_spark(spark)
    catalog, schema = _clean(catalog), _clean(schema)
    if not catalog or not schema or "FILL_IN" in (catalog + schema).upper():
        raise ValueError("Fill in CATALOG and SCHEMA first (got %r, %r)." % (catalog, schema) + _suggest(spark))
    spark.sql("USE CATALOG " + _q(catalog))
    spark.sql("USE SCHEMA " + _q(schema))
    if not quiet:
        print("Using %s.%s" % (catalog, schema))
    return "%s.%s" % (_q(catalog), _q(schema))


def volume(catalog, schema, name="databricksedu_files", spark=None):
    """Create (if needed) a volume for demo files and checkpoints. Returns its /Volumes path."""
    spark = get_spark(spark)
    catalog, schema = _clean(catalog), _clean(schema)
    if not catalog or not schema or "FILL_IN" in (catalog + schema).upper():
        raise ValueError("Fill in CATALOG and SCHEMA first (got %r, %r)." % (catalog, schema) + _suggest(spark))
    spark.sql("CREATE VOLUME IF NOT EXISTS %s.%s.%s COMMENT 'databricksedu demo files and checkpoints'"
              % (_q(catalog), _q(schema), _q(name)))
    return "/Volumes/%s/%s/%s" % (catalog, schema, name)


def _base_type(sql_type):
    return re.sub(r"\s+NOT\s+NULL", "", sql_type, flags=re.I).strip()


def _sql_str(text):
    return str(text).replace("\\", "\\\\").replace("'", "\\'")


# --------------------------------------------------------------------------- Table
class Table(object):
    """One generated table: column definitions, rows (tuples of plain Python values) and keys."""

    def __init__(self, name, columns, rows, comment="", primary_key=None, foreign_keys=None):
        self.name = name
        self.columns = [tuple(c) for c in columns]            # (name, SQL type, comment)
        self.rows = rows
        self.comment = comment
        self.primary_key = list(primary_key or [])
        self.foreign_keys = [tuple(fk) for fk in (foreign_keys or [])]   # (column, ref_table, ref_column)

    @property
    def column_names(self):
        return [c[0] for c in self.columns]

    def __len__(self):
        return len(self.rows)

    def __repr__(self):
        return "Table(%s, %d rows, %d columns)" % (self.name, len(self.rows), len(self.columns))

    def records(self):
        names = self.column_names
        return [dict(zip(names, r)) for r in self.rows]

    def to_pandas(self):
        import pandas as pd
        return pd.DataFrame(self.rows, columns=self.column_names)

    def spark_schema(self):
        return ", ".join("%s %s" % (_q(c), _base_type(t)) for c, t, _ in self.columns)

    def dataframe(self, spark=None):
        return get_spark(spark).createDataFrame(self.rows, self.spark_schema())

    def create_sql(self, target=""):
        lines = []
        for c, t, cmt in self.columns:
            lines.append("  %-18s %s%s" % (c, t, " COMMENT '%s'" % _sql_str(cmt) if cmt else ""))
        if self.primary_key:
            lines.append("  CONSTRAINT %s_pk PRIMARY KEY (%s)" % (self.name, ", ".join(self.primary_key)))
        out = "CREATE TABLE %s%s (\n%s\n)" % (target, self.name, ",\n".join(lines))
        if self.comment:
            out += " COMMENT '%s'" % _sql_str(self.comment)
        return out

    def foreign_key_sql(self, target=""):
        return ["ALTER TABLE %s%s ADD CONSTRAINT %s_%s_fk FOREIGN KEY (%s) REFERENCES %s%s (%s)"
                % (target, self.name, self.name, col, col, target, ref, ref_col)
                for col, ref, ref_col in self.foreign_keys]


# --------------------------------------------------------------------------- Dataset
class Dataset(object):
    """A set of related tables generated from one seed. Parents come before children."""

    def __init__(self, name, description, seed, tables, extra_files=None):
        self.name = name
        self.description = description
        self.seed = seed
        self.tables = {t.name: t for t in tables}
        self.extra_files = extra_files or {}                 # {relative path: text}

    def __getitem__(self, table):
        return self.tables[table]

    def __iter__(self):
        return iter(self.tables.values())

    def __repr__(self):
        return "Dataset(%s, seed=%s, tables=[%s])" % (
            self.name, self.seed, ", ".join("%s:%d" % (t.name, len(t)) for t in self))

    # ---- looking at the data (no Spark needed)
    def preview(self, rows=3):
        """Print every table with its keys and the first rows."""
        print("Dataset '%s' (seed=%s)\n%s\n" % (self.name, self.seed, self.description))
        for t in self:
            keys = []
            if t.primary_key:
                keys.append("PK(%s)" % ", ".join(t.primary_key))
            keys += ["FK %s -> %s.%s" % fk for fk in t.foreign_keys]
            print("%s  %s rows  %s" % (t.name, format(len(t), ","), "  ".join(keys)))
            print("   " + " | ".join(t.column_names))
            for r in t.rows[:rows]:
                print("   " + " | ".join("" if v is None else str(v) for v in r))
            print()
        return self

    def to_pandas(self, table):
        return self.tables[table].to_pandas()

    def fingerprint(self):
        """Short hash of all rows: the same seed always gives the same fingerprint."""
        import hashlib
        h = hashlib.sha256()
        for t in self:
            h.update(t.name.encode())
            for r in t.rows:
                h.update(repr(r).encode())
        return h.hexdigest()[:16]

    # ---- Spark: temporary views
    def register_views(self, spark=None, prefix=SRC_PREFIX, quiet=False):
        """Expose every generated table as a temporary view called <prefix><table>."""
        spark = get_spark(spark)
        for t in self:
            t.dataframe(spark).createOrReplaceTempView(prefix + t.name)
            if not quiet:
                print("  temp view %-28s %8s rows" % (prefix + t.name, format(len(t), ",")))
        return self

    # ---- SQL script
    def _target(self, catalog=None, schema=None):
        if catalog and schema:
            return "%s.%s." % (_q(catalog), _q(schema))
        return ""

    def statements(self, catalog=None, schema=None, prefix=SRC_PREFIX):
        """The SQL that turns the temporary views into Delta tables with keys.

        Returns a list of (title, [statement, ...]) steps. Without catalog and schema the names
        are unqualified, so the statements run in the current catalog and schema.
        """
        tgt = self._target(catalog, schema)
        tables = list(self)
        steps = [("Clean start: drop children first, so foreign keys never block a drop",
                  ["DROP TABLE IF EXISTS %s%s" % (tgt, t.name) for t in reversed(tables)])]
        for t in tables:
            steps.append(("%s: create the table%s, then load it" % (
                t.name, " with its primary key" if t.primary_key else ""),
                [t.create_sql(tgt), "INSERT INTO %s%s SELECT * FROM %s%s" % (tgt, t.name, prefix, t.name)]))
        fks = [s for t in tables for s in t.foreign_key_sql(tgt)]
        if fks:
            steps.append(("Foreign keys: document how the tables join", fks))
        return steps

    def sql(self, catalog=None, schema=None, prefix=SRC_PREFIX):
        """The whole setup as one readable SQL script."""
        out = []
        for title, stmts in self.statements(catalog, schema, prefix):
            out.append("-- " + title)
            out += [s + ";" for s in stmts]
            out.append("")
        return "\n".join(out).rstrip() + "\n"

    def create_tables(self, catalog, schema, spark=None, show_sql=True):
        """Create every table in catalog.schema, running (and printing) the same SQL as .sql().

        The schema must already exist: nothing here creates a catalog or a schema.
        """
        spark = get_spark(spark)
        use(catalog, schema, spark)
        self.register_views(spark, quiet=True)
        for title, stmts in self.statements():
            if show_sql:
                print("\n-- " + title)
            for s in stmts:
                if show_sql:
                    print(s + ";")
                spark.sql(s)
        print()
        for t in self:
            print("  %s.%s.%-24s %8s rows" % (_clean(catalog), _clean(schema), t.name,
                                               format(spark.table(t.name).count(), ",")))
        print("Dataset '%s' is ready. Current catalog and schema: %s.%s" % (self.name, _clean(catalog), _clean(schema)))
        return self

    def drop_tables(self, catalog=None, schema=None, spark=None):
        """Drop the tables of this dataset (children first). The schema itself is never dropped."""
        spark = get_spark(spark)
        tgt = self._target(catalog, schema)
        for t in reversed(list(self)):
            spark.sql("DROP TABLE IF EXISTS %s%s" % (tgt, t.name))
            print("  dropped %s%s" % (tgt, t.name))
        return self

    # ---- raw files (for ingestion demos)
    def land_files(self, path, table=None, parts=3, upto=None, fmt="csv"):
        """Write raw files under ``path``, like files arriving in a landing zone.

        Every table goes to <path>/<table>/. The largest table (or ``table``) is split into
        ``parts`` files; ``upto`` writes only the first N of them, so calling again with a larger
        ``upto`` simulates new files arriving. Files that already exist are never rewritten.
        ``fmt`` is "csv" or "json" (JSON lines). Returns ``path``.
        """
        if fmt not in ("csv", "json"):
            raise ValueError('fmt must be "csv" or "json"')
        tables = list(self)
        big = table or max(tables, key=len).name
        written = []
        for t in tables:
            folder = os.path.join(path, t.name)
            os.makedirs(folder, exist_ok=True)
            if t.name != big:
                chunks = [("%s.%s" % (t.name, fmt), t.rows)]
            else:
                size = -(-len(t.rows) // parts)
                chunks = [("part_%d.%s" % (i + 1, fmt), t.rows[i * size:(i + 1) * size])
                          for i in range(min(parts, upto or parts))]
            for fname, rows in chunks:
                full = os.path.join(folder, fname)
                if os.path.exists(full):          # a rewritten file would look "new" to incremental readers
                    continue
                with open(full, "w", encoding="utf-8", newline="") as f:
                    f.write(_serialize(t.column_names, rows, fmt))
                written.append(full)
        for rel, text in self.extra_files.items():
            full = os.path.join(path, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            if not os.path.exists(full):
                with open(full, "w", encoding="utf-8", newline="") as f:
                    f.write(text)
                written.append(full)
        for full in written:
            print("  " + full)
        print("%d new file(s) under %s" % (len(written), path))
        return path


def _plain(v):
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat(sep=" ") if isinstance(v, _dt.datetime) else v.isoformat()
    return v


def _serialize(names, rows, fmt):
    buf = io.StringIO()
    if fmt == "csv":
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(names)
        for r in rows:
            w.writerow(["" if v is None else _plain(v) for v in r])
    else:
        for r in rows:
            buf.write(json.dumps({n: _plain(v) for n, v in zip(names, r)}, ensure_ascii=False) + "\n")
    return buf.getvalue()
