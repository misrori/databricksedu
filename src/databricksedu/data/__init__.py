"""Synthetic datasets for Databricks demos and exercises.

One call puts a dataset where you want it, and prints what it created:

    from databricksedu import data

    data.create("retail", "main", "my_schema")                       # Delta tables with keys
    data.create("retail", "main", "my_schema", mode="view")          # views over Parquet files
    data.create("retail", "main", "my_schema", mode="temp_view")     # temporary views only
    data.files("retail", "main", "my_schema", volume="landing", n_files=2)   # raw files; run again for more

In memory, without Spark:

    shop = data.generate("retail", seed=42)      # same seed -> exactly the same rows, every time
    shop.preview()
    print(shop.sql())                            # the CREATE TABLE / PRIMARY KEY / FOREIGN KEY script

Datasets: retail, iot, churn, support, hr, cdc (see data.datasets()).
"""
import importlib

from . import _load
from ._core import Dataset, Table, get_spark, use, volume

NAMES = ["retail", "iot", "churn", "support", "hr", "cdc"]

__all__ = ["create", "files", "generate", "datasets", "describe", "use", "volume", "Dataset", "Table", "NAMES"]


def _module(name):
    if name not in NAMES:
        raise ValueError("Unknown dataset %r. Available: %s" % (name, ", ".join(NAMES)))
    return importlib.import_module("." + name, __name__)


def generate(name="retail", seed=42, scale=1.0):
    """Generate a dataset in memory. The same name, seed and scale always give the same rows.

    ``scale`` multiplies the row count of the large tables (0.1 = a tenth, 2 = double).
    """
    return _module(name).generate(seed=seed, scale=scale)


def create(name, catalog, schema, mode="table", drop_existing=True, scale=1.0, seed=42,
           volume="databricksedu_files", spark=None, show_sql=False):
    """Create a dataset in catalog.schema in one call and print a report (tables, rows, size, schema).

    mode           "table"     Delta tables with primary and foreign keys (default)
                   "view"      views over Parquet files written to ``volume`` in the same schema
                   "temp_view" temporary views for this notebook session only
    drop_existing  True replaces tables/views that already exist; False keeps them as they are
    scale          multiplies the row count of the large tables (0.1 = a tenth)
    seed           the same seed gives the same rows (lessons rely on the default, 42)

    The catalog and schema must exist; nothing here creates them. Afterwards they are the current
    catalog and schema, so plain table names work. Returns the generated Dataset.
    """
    ds = generate(name, seed=seed, scale=scale)
    return _load.create(ds, catalog, schema, mode=mode, drop_existing=drop_existing, volume=volume,
                        spark=spark, show_sql=show_sql)


def files(name, catalog, schema, volume, n_files=1, fmt="csv", folder=None, rows_per_file=None,
          fresh=False, seed=None, spark=None):
    """Write raw files into a volume, like files arriving in a landing zone, and print a report.

    Every call adds ``n_files`` NEW files of the growing table (retail: fact_orders, iot: readings) with new,
    random rows and new ids, so incremental readers (Auto Loader, COPY INTO) pick up only them.
    The small tables (and any sample bad-rows file) are written once.

    volume         volume name in catalog.schema; created if it does not exist
    fmt            "csv" or "json" (JSON lines)
    folder         optional sub-folder inside the volume
    rows_per_file  default: a third of the full table (20,000 orders for retail)
    fresh          True deletes the folder first (a clean start)
    seed           None (default) gives different rows on every call

    Layout: <volume>[/<folder>]/<table>/part_0001.csv, part_0002.csv, ...  Returns that base path.
    """
    return _load.files(_module(name), name, catalog, schema, volume, n_files=n_files, fmt=fmt,
                       folder=folder, rows_per_file=rows_per_file, fresh=fresh, seed=seed, spark=spark)


def describe(name):
    """Static description of a dataset: title, summary and table layouts (no rows generated twice)."""
    mod = _module(name)
    ds = mod.generate(seed=42, scale=0.02)
    return {
        "name": name, "title": mod.TITLE, "icon": mod.ICON, "summary": mod.SUMMARY, "use_for": mod.USE_FOR,
        "tables": [{"name": t.name, "comment": t.comment, "columns": [list(c) for c in t.columns],
                    "primary_key": t.primary_key, "foreign_keys": [list(fk) for fk in t.foreign_keys]}
                   for t in ds],
    }


def datasets(show=True):
    """List the available datasets."""
    out = []
    for name in NAMES:
        mod = _module(name)
        out.append({"name": name, "title": mod.TITLE, "summary": mod.SUMMARY, "use_for": mod.USE_FOR})
        if show:
            print('%s  data.create("%s", CATALOG, SCHEMA)\n   %s\n   Good for: %s\n' % (mod.TITLE, name, mod.SUMMARY, mod.USE_FOR))
    return None if show else out
