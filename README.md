# databricksedu

Bite-sized Databricks lessons that run **inside your notebook**. One function opens an app in the notebook output.
In it you browse the library, play animated slides, read the notes, take a quiz, and save the lecture and exercise
notebooks into your workspace.

```python
%pip install databricksedu
```

```python
import databricksedu
databricksedu.start()
```

Works on Databricks serverless and classic compute. No dependencies beyond what Databricks already ships.

## What is inside

| Track | Examples |
|---|---|
| 🛠️ Data Engineering | Lakehouse architecture, Parquet files, Medallion architecture, Anatomy of a Delta table, the transaction log, deletion vectors, MERGE, Change Data Feed, Spark joins and shuffles, Auto Loader, Structured Streaming, Declarative Pipelines, Lakeflow Jobs, Bundles and CI/CD |
| 🔥 Apache Spark Programming | Driver, workers, shuffle and the DAG, reading and writing DataFrames, DataFrame ETL, aggregation, joins and set operations, window functions, complex types, Python UDFs, real-time mode, the Spark UI, Spark with Delta Lake, optimizing Spark code |
| 🤖 Machine Learning | ML lifecycle, MLflow tracking, feature engineering, tuning, models in Unity Catalog, serving, monitoring |
| ✨ Generative AI | How LLMs work, prompting, embeddings and Vector Search, chunking, RAG, agents, evaluation, AI Functions |
| 📊 Analytics & AI/BI | SQL warehouses, AI/BI dashboards, Genie spaces, metric views |
| 🛡️ Governance & Security | Unity Catalog in depth, the three-level namespace, users, groups and service principals, workspace object permissions, privileges, dynamic views, row filters, column masks, ABAC policies, Delta Sharing, lineage and system tables |
| 🎒 Course Recaps | 8-10 minute recaps of the Databricks Academy Data Engineering, Advanced Data Engineering and Apache Spark Programming courses |
| 🎓 Exam Prep | Study guides for the Databricks certifications |
| 🧪 Demo Data | Seeded generators for six related-table datasets with primary and foreign keys |

A lesson module takes about 8 minutes: animated slides, a document view, a 5-question quiz, a lecture notebook with a
runnable "Try it" section, and an exercises notebook with hidden solutions.

## The API

```python
import databricksedu

databricksedu.start()                          # the app (with a Save-to-workspace bar)
databricksedu.modules()                        # list everything
databricksedu.present("delta-table-anatomy")   # play one presentation
databricksedu.read("delta-table-anatomy")      # the same module as a document
databricksedu.save("delta-table-anatomy")      # copy its notebooks to /Workspace/Users/<you>/databricksedu/
databricksedu.save("data-engineering")         # a whole track, or save("all")
```

## On the web

Everything is also published as a website: **https://misrori.github.io/databricksedu/**. It has the same app
(slides, notes, quizzes), the hand-made extras (the Delta Lake storyboard with a
storage path decoder and a Delta table simulator, the Spark optimization storyboard, the Governance storyboard with an access lab, the Databricks story, a broadcast
hash join animation, an OPTIMIZE & VACUUM deck) and the Markdown of every module under `markdown/<module id>.md`. The website is rebuilt from `main` by
`.github/workflows/pages.yml` (`python tools/build.py && python tools/site.py`).

## Demo data in one line

Six datasets (retail, iot, churn, support, hr, cdc), each with several tables joined by real primary and
foreign keys. Give a catalog and a schema; one call creates everything and prints a report (what it created,
rows, size, columns). The catalog and schema must exist: nothing here creates them.

```python
from databricksedu import data

CATALOG, SCHEMA = "main", "my_schema"

data.create("retail", CATALOG, SCHEMA)                        # Delta tables with keys (existing ones replaced)
data.create("retail", CATALOG, SCHEMA, mode="view")           # views over Parquet files in a volume
data.create("retail", CATALOG, SCHEMA, mode="temp_view")      # temporary views, this session only
data.create("retail", CATALOG, SCHEMA, drop_existing=False)   # keep tables that already exist

data.files("retail", CATALOG, SCHEMA, volume="landing", n_files=3)            # 3 new CSV files
data.files("iot", CATALOG, SCHEMA, volume="landing", n_files=1, fmt="json")   # run again: new rows, new files
```

`data.create` uses a fixed seed, so a whole class works on identical tables. `data.files` has no fixed seed:
every call adds new files with new rows and new ids, which is what Auto Loader and `COPY INTO` demos need.
`data.datasets()` describes them all; `data.generate("retail").to_pandas("fact_orders")` works without Spark.

## Practice exams

Practice exams for the Databricks certifications are available at [GoldHandAcademy.com](https://goldhandacademy.com).

## Development

```bash
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/python tools/build.py --check content/<category>/<NNN-slug>   # validate one module
.venv/bin/python tools/build.py                                          # render all content into the package
.venv/bin/python -m pytest
.venv/bin/python tools/preview.py /tmp/app.html                          # look at the app in a browser
```

Content lives in `content/<category>/<NNN-slug>/module.md` + `quiz.json`. See [CONTENT_GUIDE.md](CONTENT_GUIDE.md)
for the format, the visualization blocks and the dataset rules. The rendered output under
`src/databricksedu/_content/` is generated and not committed; the build hook regenerates it for every package build.

Releasing: bump `src/databricksedu/_version.py`, then push a tag `v<version>`. The `Publish to PyPI` workflow builds,
tests and uploads using the `PYPI_API_TOKEN` repository secret.

## Legacy: the dbxhelp loader

The earlier one-line loader from [misrori/dbxhelp](https://github.com/misrori/dbxhelp) still works for the original recaps:

```python
import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/misrori/dbxhelp/main/dbxhelp.py").read().decode()); dbxhelp()
```

---

Unofficial educational material. Not affiliated with or endorsed by Databricks. Databricks, Delta Lake and Apache
Spark are trademarks of their respective owners.
