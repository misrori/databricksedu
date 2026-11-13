---
title: "Recap: DevOps Essentials for Data Engineering"
summary: Recap of course 4 of Data Engineering with Databricks. Split logic into testable functions, unit test them with pytest, work in Git folders, and deploy the same code to dev, test and prod.
icon: 🚀
level: Intermediate
minutes: 8
group: Data Engineering with Databricks
tags: [CI/CD, Unit testing, Git folders, Bundles, DevOps]
---
# Recap: DevOps Essentials for Data Engineering

> Course 4 of 4. Applying software engineering practices to data work: **modular code, tests, version control, and automated deployment** across dev, test and prod.

**The one idea to remember:** treat pipelines as **software**. Logic goes in testable modules, everything lives in **Git**, and environments are promoted **automatically**. Nobody copies notebooks by hand.

## 🗺️ What we covered

```viz timeline
{"title": "The topics of the course",
 "items": [
  {"label": "1", "title": "Software engineering and DevOps", "color": "navy", "note": "Why data teams need versioning, testing, automation and environments."},
  {"label": "2", "title": "CI/CD fundamentals", "color": "blue", "note": "**Continuous integration** (merge often, test automatically) and **continuous deployment** (release automatically)."},
  {"label": "3", "title": "Modularizing code", "color": "purple", "note": "Business logic in **functions and modules**, notebooks as thin entry points."},
  {"label": "4", "title": "Unit testing", "color": "green", "note": "**pytest** plus PySpark testing utilities on small DataFrames."},
  {"label": "5", "title": "Integration testing", "color": "teal", "note": "Run the real pipeline or job on test data and check the outputs."},
  {"label": "6", "title": "Version control", "color": "amber", "note": "**Databricks Git folders**: branch, commit, push, pull, pull request."},
  {"label": "7", "title": "Deploying assets", "color": "red", "note": "UI, REST API, SDK, CLI, and **bundles**. Automate the deployment in CI."}
 ]}
```

## 🔄 DevOps and CI/CD in one picture

```viz flow
{"nodes": [
  {"icon": "🌿", "title": "Feature branch", "sub": "one developer, one change", "color": "green"},
  {"icon": "📝", "title": "Pull request", "sub": "review", "color": "blue"},
  {"icon": "🧪", "title": "CI", "sub": "on every pull request", "color": "purple", "items": ["lint", "unit tests", "validate", "deploy to TEST", "integration tests"]},
  {"icon": "🔀", "title": "Merge to main", "sub": "after review and green CI", "color": "navy"},
  {"icon": "🚀", "title": "CD", "sub": "deploy the SAME code to PROD", "color": "gold", "items": ["runs as a service principal"]}
 ],
 "edges": ["push", "triggers", "passes", "triggers"],
 "steps": [
  {"label": "Develop", "focus": [0], "note": "Work happens on a short-lived feature branch, never on `main`."},
  {"label": "Integrate", "focus": [1, 2], "note": "**Continuous integration**: merge often, and test automatically. CI lints, runs unit tests, validates and deploys to a test environment for integration tests."},
  {"label": "Deploy", "focus": [3, 4], "note": "**Continuous deployment**: after the merge, the same code is released to production automatically, by a service principal."}
 ]}
```

## 🏗️ Three environments

```viz compare
{"items": [
  {"icon": "🧑‍💻", "title": "Dev", "sub": "each developer experiments safely", "color": "green", "points": ["Personal schema or catalog", "Dev workspace"]},
  {"icon": "🧪", "title": "Test / Staging", "sub": "automated tests on realistic data", "color": "amber", "points": ["Separate catalog or workspace"]},
  {"icon": "🏭", "title": "Prod", "sub": "business-facing workloads", "color": "red", "points": ["Separate workspace", "Runs as a **service principal**"]}
 ]}
```

Code and configuration are the **same** everywhere. Only **parameters** (catalog, paths, schedules) differ per environment.

## 🧩 Modular code

```python
# src/transforms.py: pure functions, easy to test
from pyspark.sql import DataFrame, functions as F

def clean_orders(df: DataFrame) -> DataFrame:
    return (df.filter(F.col("amount") > 0)
              .withColumn("email", F.lower(F.trim("email"))))

def add_net_amount(df: DataFrame, vat: float) -> DataFrame:
    return df.withColumn("net_amount", F.round(F.col("amount") / (1 + vat), 2))
```

Functions take a DataFrame and return a DataFrame, and chain with `.transform()`.

## 🚪 Notebooks as thin entry points

```python
# notebook / job task: thin entry point
from transforms import clean_orders, add_net_amount

catalog = dbutils.widgets.get("catalog")                # environment comes from a parameter
raw = spark.read.table(f"{catalog}.bronze.orders")
(raw.transform(clean_orders)
    .transform(add_net_amount, vat=0.27)
    .write.mode("overwrite").saveAsTable(f"{catalog}.silver.orders"))
```

- **No hard-coded** catalogs, paths or credentials. Use parameters and **secrets**.
- Notebooks can import `.py` files from the same Git folder (workspace files).

## ✅ Unit tests with pytest

```python
# tests/test_transforms.py
from pyspark.testing import assertDataFrameEqual
from transforms import clean_orders

def test_clean_orders_removes_negative_and_normalizes_email(spark):
    src = spark.createDataFrame([(1, 10.0, " A@X.COM "), (2, -5.0, "b@x.com")],
                                "id INT, amount DOUBLE, email STRING")
    expected = spark.createDataFrame([(1, 10.0, "a@x.com")],
                                     "id INT, amount DOUBLE, email STRING")
    assertDataFrameEqual(clean_orders(src), expected)
```

- `assertDataFrameEqual` compares schema and rows (order-insensitive by default). `assertSchemaEqual` compares only the schema.
- Do not compare DataFrames with `collect() == collect()`, because it is order-sensitive and ignores the schema.

## 🧪 Three levels of testing

```viz layers
{"layers": [
  {"icon": "🔬", "title": "Unit", "sub": "A single function on tiny in-memory data", "color": "green", "items": ["pytest locally (Databricks Connect) or in a notebook", "in **CI**"]},
  {"icon": "🔗", "title": "Integration", "sub": "The deployed job or pipeline end-to-end on **test data**", "color": "blue", "items": ["test/staging environment", "after deployment"]},
  {"icon": "📏", "title": "Data quality", "sub": "Rules on real data: expectations, constraints, row-count checks", "color": "purple", "items": ["in the pipeline", "every run"]}
 ]}
```

## 🌿 Version control with Git folders

```viz timeline
{"title": "The Git workflow inside Databricks",
 "items": [
  {"label": "1", "title": "Clone", "color": "navy", "note": "*Workspace > Create > **Git folder***, then the repository URL. One Git folder **per developer**."},
  {"label": "2", "title": "Branch", "color": "green", "note": "Create or switch branch in the Git dialog (click the branch name). Use short-lived **feature branches**. Never develop on `main`."},
  {"label": "3", "title": "Commit and push", "color": "blue", "note": "Git dialog: select changes, write a message, **Commit & Push**. Notebooks are stored as source files (`.py` / `.sql`), so diffs and code reviews work."},
  {"label": "4", "title": "Pull", "color": "teal", "note": "**Pull** to get the changes of others."},
  {"label": "5", "title": "Pull request", "color": "purple", "note": "Review and merge in the Git provider (GitHub, Azure DevOps, GitLab and others)."}
 ]}
```

> Production should **not** run from someone's personal Git folder.

## 📦 Deploying Databricks assets

| Method | Good for |
|---|---|
| **UI** | Learning and one-offs. Not repeatable |
| **REST API / Python SDK** | Custom automation and scripts |
| **Databricks CLI** | Scripting from a terminal or CI runner |
| **Bundles** (Declarative Automation Bundles, formerly *Databricks Asset Bundles*) | **Recommended**: jobs, pipelines and code described as YAML and deployed per target |

> Bundles are covered in depth in the advanced course *Automated Deployment with Databricks Asset Bundles*.

## 📜 A minimal bundle

```viz code
title: databricks.yml (minimal)
lang: yaml
---
bundle:
  name: orders_etl
include:
  - resources/*.yml
targets:
  dev:
    mode: development     # names prefixed "[dev user]", schedules paused
    default: true
  prod:
    mode: production
    workspace:
      host: https://prod.cloud.databricks.com
---
1-2 | Bundle name | One bundle per project, kept in Git next to the code.
3-4 | Resources | Jobs and pipelines are described in YAML files under `resources/`.
5-8 | dev target | `mode: development` prefixes names with `[dev user]` and pauses schedules. `default: true` means `-t dev` is optional.
9-12 | prod target | A different workspace. Same code, different target.
```

Then: `databricks bundle validate -t dev`, `databricks bundle deploy -t dev`, `databricks bundle run -t dev orders_job`.

## 🧪 Try it: write and test a transformation

> Runs on in-memory DataFrames, so no data or schema is needed.

```python run
# Modular, testable transformations: DataFrame in, DataFrame out
from pyspark.sql import DataFrame, Row, functions as F

def clean_orders(df: DataFrame) -> DataFrame:
    return df.filter(F.col("amount") > 0).withColumn("email", F.lower(F.trim("email")))

def add_net_amount(df: DataFrame, vat: float) -> DataFrame:
    return df.withColumn("net_amount", F.round(F.col("amount") / (1 + vat), 2))
```

```python run
# Unit tests with pyspark.testing. They pass silently
from pyspark.testing import assertDataFrameEqual

src = spark.createDataFrame([(1, 10.0, " A@X.COM "), (2, -5.0, "b@x.com")], "id INT, amount DOUBLE, email STRING")
expected = spark.createDataFrame([(1, 10.0, "a@x.com")], "id INT, amount DOUBLE, email STRING")

assertDataFrameEqual(clean_orders(src), expected)
assertDataFrameEqual(src.transform(clean_orders).transform(add_net_amount, vat=0.25).select("net_amount"),
                     [Row(net_amount=8.0)])
print("✅ all tests passed")
```

```python run
# A failing test shows exactly which rows differ
try:
    assertDataFrameEqual(clean_orders(src),
                         spark.createDataFrame([(1, 10.0, "A@X.COM")], "id INT, amount DOUBLE, email STRING"))
except AssertionError as e:
    print("❌ test failed (as expected):\n", str(e)[:900])
```

> In a real project these functions live in `src/`, the tests in `tests/test_*.py`, and CI runs `pytest` on every pull request.

## ⚠️ Common mistakes

- ❌ All logic inside notebooks, "tested" by running them by hand.
- ❌ Copying notebooks between workspaces manually to promote code.
- ❌ Hard-coded `prod` catalog names or passwords in code.
- ❌ Working directly on `main` in a shared Git folder.
- ❌ Personal access tokens of a human user in CI. Use a **service principal** with OAuth.

## 🧭 Cheat sheet

| Situation | Choose |
|---|---|
| Verify a transformation function is correct | **Unit test** with `assertDataFrameEqual` |
| Verify the deployed job works with the real platform | **Integration test** in a test environment |
| Two engineers changing the same pipeline | **Feature branches** + **pull requests** |
| The same job in dev, test and prod with different catalogs | **Parameters** / bundle **variables** per target |
| Repeatable deployment from CI | **Bundles** + **Databricks CLI** |
| Who runs production jobs? | A **service principal**, not a person |

**You finished the Data Engineering path.** Next up: *Advanced Data Engineering with Databricks*.
