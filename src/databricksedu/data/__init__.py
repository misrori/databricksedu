"""Deterministic synthetic datasets for Databricks demos and exercises.

    from databricksedu import data

    shop = data.generate("retail", seed=42)      # same seed -> exactly the same rows, every time
    shop.preview()
    shop.register_views(spark)                   # temp views: src_dim_customer, src_dim_product, ...

    data.use(CATALOG, SCHEMA)                    # USE CATALOG / USE SCHEMA (never creates a schema)
    print(shop.sql())                            # the CREATE TABLE / PRIMARY KEY / FOREIGN KEY script
    shop.create_tables(CATALOG, SCHEMA)          # ...or run it in one call

Datasets: retail, iot, churn, support, hr, cdc (see data.datasets()).
"""
import importlib

from ._core import Dataset, Table, get_spark, use, volume

NAMES = ["retail", "iot", "churn", "support", "hr", "cdc"]

__all__ = ["generate", "datasets", "describe", "use", "volume", "Dataset", "Table", "NAMES"]


def _module(name):
    if name not in NAMES:
        raise ValueError("Unknown dataset %r. Available: %s" % (name, ", ".join(NAMES)))
    return importlib.import_module("." + name, __name__)


def generate(name="retail", seed=42, scale=1.0):
    """Generate a dataset in memory. The same name, seed and scale always give the same rows.

    ``scale`` multiplies the row count of the large tables (0.1 = a tenth, 2 = double).
    """
    return _module(name).generate(seed=seed, scale=scale)


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
            print('%s  data.generate("%s")\n   %s\n   Good for: %s\n' % (mod.TITLE, name, mod.SUMMARY, mod.USE_FOR))
    return None if show else out
