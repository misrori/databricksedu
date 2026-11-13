"""Hatch build hook: render content/ into src/databricksedu/_content before packaging.

The rendered slides and notebooks are build output (git-ignored). When the sources are not
present (for example when a wheel is built from an sdist that already holds the output),
the existing output is used as it is.
"""
import subprocess
import sys
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        root = Path(self.root)
        script = root / "tools" / "build.py"
        if (root / "content" / "categories.json").exists() and script.exists():
            subprocess.check_call([sys.executable, str(script)], cwd=str(root))
        elif not (root / "src" / "databricksedu" / "_content" / "catalog.json").exists():
            raise RuntimeError("No content: neither content/ sources nor prebuilt src/databricksedu/_content found")
