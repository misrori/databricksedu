---
title: Bundles and CI/CD
summary: Describe jobs and pipelines as code in a Declarative Automation Bundle, deploy the same definitions to dev, staging and prod with targets and variables, and wire it into a CI/CD flow with tests and a service principal.
icon: 📦
level: Intermediate
minutes: 12
group: Orchestration and DevOps
tags: [Bundles, CI/CD, Databricks CLI, Git folders, Testing]
---
# Bundles and CI/CD

> A job built by clicking in the UI exists in one workspace, with no review and no history. A **bundle** puts the job, the pipeline and the code in one Git repository, and the CLI deploys exactly that to each environment.

**The one idea to remember:** one set of files, many **targets**. Dev, staging and prod get the same jobs and pipelines; only the target's **variables and overrides** differ, and production runs as a **service principal**.

## 💡 Why infrastructure as code

| Question | Jobs built in the UI | A bundle in Git |
|---|---|---|
| Who changed the schedule, and why? | Hard to tell | The commit and the pull request |
| Is prod the same as staging? | Only if someone copied it carefully | Same files, different target |
| Can I review a change before it runs? | No | Yes, in the pull request |
| Can I roll back? | Rebuild by hand | Deploy the previous commit |

**Declarative Automation Bundles** were formerly called **Databricks Asset Bundles** (DABs); you will meet both names. A bundle can hold jobs, pipelines, dashboards, schemas, volumes, models and more.

## 📄 Anatomy of databricks.yml

The root file names the bundle, pulls in the resource files, declares variables, and defines the targets.

```viz code
title: databricks.yml
lang: yaml
---
bundle: {name: retail_etl}
include: [resources/*.yml]
variables:
  catalog: {description: Catalog to write to, default: dev_retail}
targets:
  dev:
    mode: development
    default: true
    workspace: {host: https://dev.cloud.databricks.com}
  prod:
    mode: production
    workspace: {host: https://prod.cloud.databricks.com}
    variables: {catalog: prod_retail}
    run_as: {service_principal_name: 6f1c2a9e-0000-0000-0000-000000000000}
---
1 | bundle | The name is used in deployment paths and is available as `${bundle.name}`.
2 | include | One YAML file per job or pipeline under `resources/`. Large projects stay reviewable.
3-4 | variables | Declared once with a default. Used as `${var.catalog}` anywhere in the bundle.
6-9 | dev target | `mode: development` and `default: true`: plain `databricks bundle deploy` goes here.
10-12 | prod target | Another workspace, in production mode.
13 | override | The only thing that changes for prod is the variable value. The code is the same.
14 | run_as | Prod jobs and pipelines run as a service principal, not as the person who deployed them.
```

## 🗂️ A bundle project

```viz tree
{"title": "A typical bundle repository",
 "root": {"icon": "📦", "label": "retail_etl/", "sub": "one Git repository", "color": "navy", "children": [
   {"icon": "📄", "label": "databricks.yml", "sub": "bundle, variables, targets", "color": "purple"},
   {"icon": "🗂️", "label": "resources/", "sub": "what gets deployed", "color": "blue", "children": [
     {"icon": "🗓️", "label": "orders.job.yml", "sub": "a Lakeflow job", "color": "blue"},
     {"icon": "🌊", "label": "orders.pipeline.yml", "sub": "a declarative pipeline", "color": "blue"}]},
   {"icon": "🐍", "label": "src/", "sub": "the code", "color": "green", "children": [
     {"icon": "🧮", "label": "retail_etl/transforms.py", "sub": "pure functions, unit-tested", "color": "green"},
     {"icon": "📓", "label": "ingest.py", "sub": "thin notebook that imports them", "color": "green"}]},
   {"icon": "🧪", "label": "tests/test_transforms.py", "sub": "pytest, runs in CI", "color": "amber"},
   {"icon": "⚙️", "label": ".github/workflows/", "sub": "the CI/CD pipeline", "color": "gray"}
 ]}}
```

Keep logic in importable modules and notebooks thin. Then the same function runs in the job, in the pipeline and in a unit test.

## 🧩 Variables and substitutions

A resource file refers to variables and built-in values with `${...}`. They are resolved at **deploy** time, per target.

```yaml
# resources/orders.job.yml
resources:
  jobs:
    orders_daily:
      name: orders-daily-${bundle.target}
      schedule: {quartz_cron_expression: "0 0 2 * * ?", timezone_id: UTC}
      tasks:
        - task_key: ingest
          notebook_task:
            notebook_path: ../src/ingest.py
            base_parameters: {catalog: "${var.catalog}"}
```

Where a variable's value comes from, highest first: the `--var="catalog=x"` flag, the `BUNDLE_VAR_catalog` environment variable, the target's `variables`, the default. Other substitutions: `${bundle.target}`, `${workspace.current_user.userName}`, `${resources.jobs.orders_daily.id}`. Values that change **per run** belong in job parameters, not bundle variables.

## 🎯 Development and production targets

```viz compare
{"title": "What the mode changes",
 "items": [
  {"icon": "🧑‍💻", "title": "mode: development", "sub": "your own copy", "color": "teal",
   "points": ["Names get a `[dev your_name]` prefix", "Schedules and triggers are **paused**", "Pipelines are marked as development", "Concurrent runs allowed, no deployment lock"],
   "foot": "Every developer can deploy without clashing"},
  {"icon": "🏭", "title": "mode: production", "sub": "the real thing", "color": "navy",
   "points": ["Names exactly as written", "Schedules and triggers are active", "Checks that pipelines are not in development mode", "Use `run_as` with a service principal"],
   "foot": "Deployed only from CI"}
 ]}
```

## ⌨️ The CLI lifecycle

The Databricks CLI does everything. `-t` picks the target; without it the `default: true` target is used.

```bash
databricks bundle validate -t dev            # parse the YAML, resolve variables, check references
databricks bundle deploy   -t dev            # upload files, create or update the job and pipeline
databricks bundle run      -t dev orders_daily   # start a deployed job and follow it
databricks bundle summary  -t dev            # what is deployed where, with links
databricks bundle destroy  -t dev            # delete everything this target deployed
```

Deploys are **declarative**. The CLI keeps state per target: a resource you delete from the YAML is deleted from the workspace on the next deploy, and manual edits in the UI are overwritten. `databricks bundle generate job --existing-job-id <id>` turns a job built in the UI into YAML.

## 🚀 From commit to production

Each developer works in a **Git folder** (a clone of the repository in the workspace) on a short-lived feature branch. Production never runs from a personal Git folder.

```viz flow
{"title": "One change on its way to prod",
 "nodes": [{"icon": "🌿", "title": "Feature branch", "sub": "your Git folder", "color": "teal"},
           {"icon": "🔍", "title": "Pull request", "sub": "CI checks", "color": "blue"},
           {"icon": "🧪", "title": "Staging", "sub": "merge to main", "color": "amber"},
           {"icon": "🏭", "title": "Production", "sub": "release tag", "color": "navy"}],
 "edges": ["push", "merge", "tag"],
 "steps": [
  {"label": "Develop", "focus": [0], "note": "Commit in your Git folder and `databricks bundle deploy -t dev`. You get a prefixed, paused copy to try things on."},
  {"label": "Pull request", "focus": [1], "note": "CI runs lint and **unit tests** with pytest (pure functions, small inputs) and `bundle validate`. A reviewer reads the YAML and code diff."},
  {"label": "Merge to main", "focus": [2], "note": "CD runs `bundle deploy -t staging` and `bundle run -t staging integration_tests`: **integration tests** on real tables in a separate catalog."},
  {"label": "Release", "focus": [3], "note": "The **same commit** is deployed with `-t prod`. Only variables differ. The schedule goes live."},
  {"label": "Identity", "focus": [1, 2, 3], "note": "CI authenticates as a **service principal** with OAuth (a client secret or workload identity federation), never with a person's token."}
 ]}
```

## 🧪 Try it: testable transformation code

```dataset retail
```

Bundle commands run in a terminal or a CI system, so everything above is display-only. What you can try here is the habit that makes CI useful: logic in small functions, checked by tests.

```python run
# Business logic as small functions: DataFrame in, DataFrame out
from pyspark.sql import DataFrame, functions as F

def completed_orders(orders: DataFrame) -> DataFrame:
    """Real sales only: drop TEST, CANCELLED and OPEN orders."""
    return orders.where(F.col("status") == "COMPLETED")

def add_net_amount(orders: DataFrame, products: DataFrame) -> DataFrame:
    """quantity * unit_price * (1 - discount), rounded to cents."""
    return (orders.join(products.select("product_id", "unit_price"), "product_id")
                  .withColumn("net_amount",
                              F.round(F.col("quantity") * F.col("unit_price") * (1 - F.col("discount")), 2)))
```

```python run
# Unit tests: tiny hand-made inputs with known answers
def test_completed_orders():
    df = spark.createDataFrame([(1, "COMPLETED"), (2, "TEST"), (3, "CANCELLED"), (4, "OPEN")],
                               "order_id BIGINT, status STRING")
    assert [r.order_id for r in completed_orders(df).collect()] == [1]

def test_add_net_amount():
    orders = spark.createDataFrame([(1, 10, 2, 0.25), (2, 11, 1, 0.0)],
                                   "order_id BIGINT, product_id BIGINT, quantity INT, discount DOUBLE")
    products = spark.createDataFrame([(10, 10.0), (11, 19.99)], "product_id BIGINT, unit_price DOUBLE")
    got = {r.order_id: r.net_amount for r in add_net_amount(orders, products).collect()}
    assert got == {1: 15.0, 2: 19.99}, got

for test in (test_completed_orders, test_add_net_amount):
    test()
    print("PASSED", test.__name__)
```

```python run
# The same tested functions on the real tables
revenue = (add_net_amount(completed_orders(spark.table("fact_orders")), spark.table("dim_product"))
           .groupBy("product_id")
           .agg(F.round(F.sum("net_amount"), 2).alias("revenue"))
           .orderBy(F.desc("revenue")))
display(revenue.limit(10))
```

> In a bundle these functions live in `src/retail_etl/transforms.py`, the tests in `tests/`, and CI runs `pytest` on every pull request.

## Exercise 1: a function and its test

Write `age_band(birth_year, as_of_year=2026)` that returns `"under 30"`, `"30-49"` or `"50+"`. Test the **boundaries** (29 and 30, 49 and 50 years old), then count the customers in `dim_customer` per band.

```python todo
def age_band(birth_year, as_of_year=2026):
    # TODO: return "under 30", "30-49" or "50+"
    pass

def test_age_band():
    # TODO: assert the four boundary cases
    pass

test_age_band()
# TODO: count customers per band (dim_customer has 500 rows: collect birth_year and use collections.Counter)
```

```python solution
from collections import Counter

def age_band(birth_year, as_of_year=2026):
    age = as_of_year - birth_year
    if age < 30:
        return "under 30"
    if age < 50:
        return "30-49"
    return "50+"

def test_age_band():
    assert age_band(1997) == "under 30"   # 29
    assert age_band(1996) == "30-49"      # 30
    assert age_band(1977) == "30-49"      # 49
    assert age_band(1976) == "50+"        # 50

test_age_band()
print("PASSED test_age_band")

rows = spark.table("dim_customer").select("birth_year").collect()
print(Counter(age_band(r.birth_year) for r in rows))
```

## Exercise 2: a prod target that passes review

A reviewer runs the checks below on every prod target. Fill in the target so that they pass, and write `resolve` so that `${var.catalog}` is replaced with the target's value.

```python todo
prod = {
    "mode": "FILL_IN",
    "workspace": {"host": "https://prod.cloud.databricks.com"},
    "variables": {"catalog": "FILL_IN"},           # the prod catalog is prod_retail
    "run_as": {"FILL_IN": "6f1c2a9e-0000-0000-0000-000000000000"},
}

def resolve(text, target):
    # TODO: replace ${var.<name>} with target["variables"][<name>]
    return text

assert prod["mode"] == "production", "prod must use production mode"
assert "service_principal_name" in prod["run_as"], "prod must run as a service principal"
assert resolve("${var.catalog}.silver.orders", prod) == "prod_retail.silver.orders"
print("The prod target passes")
```

```python solution
prod = {
    "mode": "production",
    "workspace": {"host": "https://prod.cloud.databricks.com"},
    "variables": {"catalog": "prod_retail"},
    "run_as": {"service_principal_name": "6f1c2a9e-0000-0000-0000-000000000000"},
}

def resolve(text, target):
    for name, value in target["variables"].items():
        text = text.replace("${var." + name + "}", value)
    return text

assert prod["mode"] == "production", "prod must use production mode"
assert "service_principal_name" in prod["run_as"], "prod must run as a service principal"
assert resolve("${var.catalog}.silver.orders", prod) == "prod_retail.silver.orders"
print("The prod target passes")
# With mode "development" prod would get prefixed names and paused schedules.
# This exercise created no tables, so there is nothing to clean up.
```

## ⚠️ Common mistakes

- ❌ Recreating a job by hand in every workspace. Define it once and deploy it per target.
- ❌ Hard-coding catalog names in notebooks. Use a variable per target and pass it as a parameter.
- ❌ `mode: development` for prod: prefixed names and paused schedules.
- ❌ Prod jobs that run as the engineer who deployed them. Set `run_as` to a service principal.
- ❌ Editing a deployed job in the UI. The next deploy overwrites the change; edit the YAML.
- ✅ `bundle validate` in every pull request, `bundle deploy` only from CI, the same commit from staging to prod.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Start a project | `databricks bundle init` |
| Check the configuration | `databricks bundle validate -t <target>` |
| Deploy, then run a job | `databricks bundle deploy -t <target>`, `databricks bundle run -t <target> <job_key>` |
| Remove a deployment | `databricks bundle destroy -t <target>` |
| A value per environment | `variables:` plus `targets.<name>.variables`, used as `${var.name}` |
| Turn a UI job into YAML | `databricks bundle generate job --existing-job-id <id>` |
