"""Smoke tests: seeded data, the content build, the app page and notebook export.

    python tools/build.py && python -m pytest
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from databricksedu import data  # noqa: E402


@pytest.mark.parametrize("name", data.NAMES)
def test_datasets_are_deterministic_and_keyed(name):
    a, b = data.generate(name, seed=42), data.generate(name, seed=42)
    assert a.fingerprint() == b.fingerprint()
    assert data.generate(name, seed=7).fingerprint() != a.fingerprint()
    for t in a:
        assert len(t) > 0
        if t.primary_key:
            idx = [t.column_names.index(c) for c in t.primary_key]
            keys = [tuple(r[i] for i in idx) for r in t.rows]
            assert len(keys) == len(set(keys)), "%s.%s: duplicate primary key" % (name, t.name)
        for col, ref_table, ref_col in t.foreign_keys:
            ref = a[ref_table]
            valid = {r[ref.column_names.index(ref_col)] for r in ref.rows}
            i = t.column_names.index(col)
            assert all(r[i] is None or r[i] in valid for r in t.rows), "%s.%s.%s: dangling FK" % (name, t.name, col)
    sql = a.sql()
    assert "CREATE SCHEMA" not in sql.upper() and "CREATE CATALOG" not in sql.upper()


def test_reference_module_checks():
    out = subprocess.run([sys.executable, str(ROOT / "tools" / "build.py"), "--check",
                          str(ROOT / "content" / "data-engineering" / "050-delta-table-anatomy")],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr


built = (ROOT / "src" / "databricksedu" / "_content" / "catalog.json").exists()


@pytest.mark.skipif(not built, reason="run python tools/build.py first")
def test_app_page_and_notebooks():
    from databricksedu import app, catalog, workspace

    mods = list(catalog.index())
    assert "delta-table-anatomy" in mods
    page = app.page()
    assert page.startswith("<!DOCTYPE html>") and "window.DBE=" in page
    for mid in mods:
        bundle = catalog.notebook_bundle(mid)
        assert bundle["notebooks"], mid
        for nb in bundle["notebooks"]:
            src = workspace.notebook_source(nb["cells"])
            assert src.startswith("# Databricks notebook source"), mid
    json.loads(json.dumps(catalog.categories()))


class _FakeDF(object):
    def __init__(self, n=0):
        self.n = n

    def count(self):
        return self.n

    def first(self):
        return {"sizeInBytes": 1024}

    def createOrReplaceTempView(self, name):
        pass


class _FakeSpark(object):
    """Records SQL; enough for data.create() and data.files() without a cluster."""

    def __init__(self, existing=()):
        self.log, self.existing = [], set(existing)
        spark = self

        class _Catalog(object):
            def tableExists(self, name):
                return any(name.endswith(e) for e in spark.existing)
        self.catalog = _Catalog()

    def sql(self, q):
        self.log.append(q)
        return _FakeDF()

    def table(self, name):
        return _FakeDF(1)

    def createDataFrame(self, rows, schema):
        return _FakeDF(len(rows))


def test_create_runs_the_table_sql_and_respects_drop_existing():
    spark = _FakeSpark()
    data.create("retail", "main", "lab", spark=spark)
    assert any(q.startswith("DROP TABLE") for q in spark.log)
    assert sum(q.startswith("CREATE TABLE") for q in spark.log) == 3
    spark = _FakeSpark(existing=["dim_customer"])
    data.create("retail", "main", "lab", drop_existing=False, spark=spark)
    assert not any(q.startswith("DROP") for q in spark.log)
    assert not any("CREATE TABLE `main`.`lab`.dim_customer" in q for q in spark.log)
    with pytest.raises(ValueError):
        data.create("retail", "FILL_IN", "FILL_IN", spark=_FakeSpark())


def test_files_adds_new_files_with_new_ids(tmp_path, monkeypatch):
    import csv
    from databricksedu.data import _load
    monkeypatch.setattr(_load, "VOLUMES_ROOT", str(tmp_path))
    spark = _FakeSpark()
    base = data.files("retail", "main", "lab", volume="landing", n_files=2, rows_per_file=500, spark=spark)
    data.files("retail", "main", "lab", volume="landing", n_files=1, rows_per_file=500, spark=spark)
    folder = Path(base) / "fact_orders"
    assert sorted(p.name for p in folder.iterdir()) == ["part_0001.csv", "part_0002.csv", "part_0003.csv"]
    ids = [int(r[0]) for p in sorted(folder.iterdir()) for r in list(csv.reader(p.open()))[1:]]
    assert len(ids) == 1500 and len(set(ids)) == 1500
    assert (Path(base) / "dim_customer" / "dim_customer.csv").exists()
    assert any("CREATE VOLUME IF NOT EXISTS" in q for q in spark.log)
