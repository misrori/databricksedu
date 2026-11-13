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
| 🤖 Machine Learning | ML lifecycle, MLflow tracking, feature engineering, tuning, models in Unity Catalog, serving, monitoring |
| ✨ Generative AI | How LLMs work, prompting, embeddings and Vector Search, chunking, RAG, agents, evaluation, AI Functions |
| 📊 Analytics & AI/BI | SQL warehouses, AI/BI dashboards, Genie spaces, metric views |
| 🛡️ Governance & Security | Unity Catalog privileges, row filters and column masks, Delta Sharing, lineage and system tables |
| 🎒 Course Recaps | 8-10 minute recaps of the Databricks Academy Data Engineering and Advanced Data Engineering courses |
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

## Seeded demo data

The same seed always gives the same rows, so a whole class works on identical data. Every dataset has several
tables joined by real primary and foreign keys.

```python
from databricksedu import data

ds = data.generate("retail", seed=42)    # retail, iot, churn, support, hr, cdc
ds.preview()

CATALOG = "FILL_IN"                       # a catalog you can use
SCHEMA = "FILL_IN"                        # a schema you can write to (it is never created for you)
ds.create_tables(CATALOG, SCHEMA)         # prints and runs the CREATE TABLE / PRIMARY KEY / FOREIGN KEY SQL
print(ds.sql())                           # ...or just show the script
```

`data.datasets()` describes them all. `ds.to_pandas("fact_orders")` gives a pandas DataFrame, and
`ds.land_files(path)` writes raw CSV or JSON files for ingestion and streaming demos.

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
