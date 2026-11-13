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
