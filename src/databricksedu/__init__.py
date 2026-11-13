"""databricksedu: bite-sized Databricks lessons that run inside your notebook.

    %pip install databricksedu

    import databricksedu
    databricksedu.start()                      # the app: browse modules, play slides, read notes
    databricksedu.present("delta-table-anatomy")   # just one presentation
    databricksedu.read("delta-table-anatomy")      # the same module as a document
    databricksedu.save("delta-table-anatomy")      # copy its notebooks into your workspace
    databricksedu.save("data-engineering")         # ...a whole track, or save("all")
    databricksedu.modules()                    # list everything

    from databricksedu import data
    shop = data.generate("retail", seed=42)    # seeded fake data with primary and foreign keys

Unofficial educational material. Not affiliated with or endorsed by Databricks.
"""
from . import data
from ._version import __version__
from .app import present, read, start
from .catalog import modules
from .workspace import notebook_source, save

__all__ = ["start", "present", "read", "save", "modules", "notebook_source", "data", "__version__"]
