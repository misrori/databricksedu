---
title: "Recap: Automated Deployment with Databricks Asset Bundles"
summary: Recap of course 4 of Advanced Data Engineering with Databricks. Describe jobs and pipelines as YAML in a bundle, deploy the same project to dev, staging and prod with targets and variables, and automate it in CI.
icon: 📦
level: Advanced
minutes: 9
group: Advanced Data Engineering with Databricks
tags: [Declarative Automation Bundles, Databricks CLI, CI/CD, GitHub Actions, Deployment]
---
# Recap: Automated Deployment with Databricks Asset Bundles

> Course 4 of 4. Describing jobs, pipelines and code **as YAML in Git**, and deploying the **same project** to dev, test and prod with the Databricks CLI and a CI/CD pipeline. (Bundles are now also called *Declarative Automation Bundles*.)

**The one idea to remember:** one bundle, many **targets**. The code and resource definitions never change between environments, only **variables and target overrides** do. CI runs `validate`, `deploy` and `run` for you.

## 🗺️ What we covered

| Topic | Key takeaway |
|---|---|
| DevOps and CI/CD review | Why manual UI deployments do not scale |
| What a bundle is | A project folder with `databricks.yml`: **resources** + **targets** + **variables** |
| Bundle configuration | `include`, resource YAML files, substitutions, **deployment modes** |
| Deploying with the CLI | `bundle init` · `validate` · `deploy` · `run` · `summary` · `destroy` |
| Templates and project structure | `src/`, `resources/`, `tests/`, building **wheels** as artifacts |
| CI/CD automation | GitHub Actions running tests and bundle commands as a **service principal** |

## 🗂️ Bundle anatomy

```viz tree
{"title": "A bundle is a project folder in Git",
 "root": {"icon": "📦", "label": "orders_etl/", "sub": "the bundle root", "color": "navy", "children": [
   {"icon": "📜", "label": "databricks.yml", "sub": "bundle name, includes, variables, targets", "color": "purple"},
   {"icon": "📁", "label": "resources/", "sub": "one file per job / pipeline", "color": "blue", "children": [
     {"icon": "🗓️", "label": "orders.job.yml", "color": "blue"},
     {"icon": "🌊", "label": "orders.pipeline.yml", "color": "blue"}
   ]},
   {"icon": "🐍", "label": "src/", "sub": "notebooks, pipeline sources, Python package", "color": "green"},
   {"icon": "🧪", "label": "tests/", "sub": "pytest unit tests", "color": "teal"},
   {"icon": "⚙️", "label": "pyproject.toml", "sub": "optional: build a wheel", "color": "gray"}
 ]}}
```

## 📜 databricks.yml

```yaml
# databricks.yml
bundle:
  name: orders_etl

include:
  - resources/*.yml

variables:
  catalog:
    description: Target catalog
    default: dev

targets:
  dev:
    mode: development
    default: true
    workspace:
      host: https://dev.cloud.databricks.com
  prod:
    mode: production
    workspace:
      host: https://prod.cloud.databricks.com
    variables:
      catalog: prod
    run_as:
      service_principal_name: 6f1c0000-aaaa-bbbb-cccc-000000000000
```

## 🧩 Resources: jobs and pipelines as YAML

```yaml
# resources/orders.job.yml
resources:
  jobs:
    orders_job:
      name: orders-etl-${bundle.target}
      tasks:
        - task_key: ingest
          notebook_task:
            notebook_path: ../src/ingest.py
            base_parameters:
              catalog: ${var.catalog}
        - task_key: transform
          depends_on: [{ task_key: ingest }]
          pipeline_task:
            pipeline_id: ${resources.pipelines.orders_pipeline.id}
      schedule:
        quartz_cron_expression: "0 0 2 * * ?"
        timezone_id: UTC
```

- **Resource types:** jobs, pipelines, dashboards, schemas, volumes, models, serving endpoints, apps and more.
- **Substitutions:** `${var.catalog}`, `${bundle.target}`, `${workspace.current_user.userName}`, `${resources.pipelines.orders_pipeline.id}`.
- **Existing UI job to YAML:** `databricks bundle generate job --existing-job-id 123`.

## 🔣 Variables and overrides

The value of a variable is resolved in this order of precedence. The highest layer that sets a value wins.

```viz layers
{"layers": [
  {"icon": "⌨️", "title": "1. `--var=\"catalog=prod\"` on the CLI", "sub": "highest precedence", "color": "red"},
  {"icon": "🔐", "title": "2. `BUNDLE_VAR_catalog` environment variable", "sub": "great for CI secrets", "color": "amber"},
  {"icon": "🎯", "title": "3. `targets.<target>.variables`", "sub": "per-environment values", "color": "blue"},
  {"icon": "📄", "title": "4. The variable's `default`", "sub": "lowest precedence", "color": "gray"}
 ]}
```

- A variable can be a **lookup**, which resolves an ID by name: `lookup: { warehouse: "Shared SQL" }`.
- **Never** put credentials in `databricks.yml`. Inject them through `BUNDLE_VAR_...`, or use secret scopes.
- Bundle variables are **deployment-time** values. Values that change **per run** belong in **job parameters**.

## 🚦 Deployment modes

```viz compare
{"items": [
  {"icon": "🧑‍💻", "title": "mode: development", "color": "green",
   "points": ["Resource names prefixed **`[dev <user>]`**, so each developer gets an isolated copy", "**Schedules and triggers paused**", "Concurrent runs allowed, deployment lock off", "Fast iteration (e.g. `--cluster-id` override)"]},
  {"icon": "🏭", "title": "mode: production", "color": "red",
   "points": ["Names as written", "Schedules active", "Validates `run_as`, permissions, and that pipelines are not in development mode", "Cluster overrides not allowed"]}
 ]}
```

## 💻 The CLI lifecycle

```viz timeline
{"title": "databricks bundle ...",
 "items": [
  {"label": "init", "title": "`bundle init default-python`", "color": "navy", "note": "Start from a template: `src/`, `resources/`, `tests/` and a `databricks.yml`."},
  {"label": "validate", "title": "`bundle validate -t dev`", "color": "blue", "note": "Check syntax, references and variables. Run it in CI to catch config errors before deploying."},
  {"label": "deploy", "title": "`bundle deploy -t dev`", "color": "purple", "note": "Upload files and create or update resources (idempotent). Deploys are **declarative**: a resource removed from the YAML is removed from the workspace on the next deploy, and manual UI edits are overwritten."},
  {"label": "run", "title": "`bundle run -t dev orders_job`", "color": "green", "note": "Run a deployed job or pipeline by its resource key."},
  {"label": "summary", "title": "`bundle summary -t dev`", "color": "teal", "note": "What is deployed, with URLs."},
  {"label": "destroy", "title": "`bundle destroy -t dev`", "color": "red", "note": "Remove everything this bundle deployed to dev."}
 ]}
```

**Artifacts:** the bundle can build a **wheel** (`artifacts:` with `build: uv build --wheel`) and attach it to tasks, so prod runs exactly the tested version.

## 🤖 CI/CD with GitHub Actions

```yaml
# .github/workflows/deploy.yml (simplified)
on:
  pull_request:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
      DATABRICKS_CLIENT_ID: ${{ secrets.SP_CLIENT_ID }}          # service principal (OAuth M2M)
      DATABRICKS_CLIENT_SECRET: ${{ secrets.SP_CLIENT_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: databricks/setup-cli@main
      - run: pip install pytest pyspark && pytest tests/
      - run: databricks bundle validate -t staging
      - run: databricks bundle deploy -t staging && databricks bundle run -t staging integration_tests
      - if: github.ref == 'refs/heads/main'
        run: databricks bundle deploy -t prod
```

## 🔁 What CI does on each event

```viz flow
{"nodes": [
  {"icon": "📝", "title": "Pull request", "sub": "workflow starts", "color": "blue"},
  {"icon": "🧪", "title": "Unit tests + validate", "sub": "`pytest tests/`, `bundle validate`", "color": "purple"},
  {"icon": "🧫", "title": "Staging", "sub": "deploy + integration tests", "color": "amber"},
  {"icon": "🔀", "title": "Merge to main", "sub": "push event", "color": "navy"},
  {"icon": "🏭", "title": "Prod", "sub": "`bundle deploy -t prod`", "color": "red"}
 ],
 "edges": ["checkout, setup-cli", "passes", "review", "same commit"],
 "steps": [
  {"label": "Pull request", "focus": [0, 1, 2], "note": "Unit tests, `validate`, deploy to **staging**, integration tests."},
  {"label": "Merge", "focus": [3, 4], "note": "Deploy the **same commit** to **prod**. The `if: github.ref == 'refs/heads/main'` step only runs on main."},
  {"label": "Identity", "focus": [1, 2, 4], "note": "Authenticate CI as a **service principal** with OAuth, or with workload identity federation. Do not use a person's PAT."}
 ]}
```

## ⚠️ Common mistakes

- ❌ Recreating jobs by hand in each workspace, or copying job JSON between them.
- ❌ Hard-coded catalog names in code instead of `${var.catalog}`.
- ❌ Expecting a dev deployment to run on schedule. Development mode **pauses** schedules.
- ❌ `mode: development` on the prod target (prefixed names, paused schedules).
- ❌ Editing a bundle-managed job in the UI. The next deploy overwrites it.
- ❌ CI authenticated with a human's personal access token.

## 🧭 Cheat sheet

| Situation | Choose |
|---|---|
| Same job in dev, staging and prod with different catalogs | One bundle, **targets** + **variables** |
| Developers must not overwrite each other's jobs | **`mode: development`** (user-prefixed copies) |
| A prod job must not run as the engineer who deployed it | **`run_as`** service principal |
| A password is needed at deploy time | `BUNDLE_VAR_...` from the CI secret store |
| Prod must run exactly the tested code | Build a **wheel artifact** in the bundle |
| Catch config errors before deploying | `bundle validate` in CI |

**You finished the Advanced Data Engineering path.**
