---
title: Models in Unity Catalog
summary: Register a trained model as a governed Unity Catalog object, keep immutable versions, point aliases like @champion at the one in use, and promote or roll back by moving an alias.
icon: 📦
level: Beginner
minutes: 10
group: Deployment
tags: [Models in UC, MLflow, Aliases, Governance]
---
# Models in Unity Catalog

> A logged model lives inside one run of one experiment. To use it in a job or an endpoint you **register** it: it becomes a named object in Unity Catalog, next to your tables, with versions, aliases and permissions.

**The one idea to remember:** versions never change; **aliases move**. Consumers load `models:/catalog.schema.model@champion`, so promoting or rolling back is one alias update, not a code change.

## 🌳 A model is a Unity Catalog object

```viz tree
{"root": {"icon": "📚", "label": "dev (catalog)", "color": "navy", "children": [
  {"icon": "🗂️", "label": "churn (schema)", "color": "blue", "children": [
    {"icon": "🧾", "label": "subscribers", "sub": "table", "color": "gray"},
    {"icon": "📦", "label": "churn_model", "sub": "registered model: dev.churn.churn_model", "color": "purple", "children": [
      {"icon": "1️⃣", "label": "version 1", "sub": "from run 7f3a…, no alias", "color": "gray"},
      {"icon": "2️⃣", "label": "version 2", "sub": "@champion", "color": "green"},
      {"icon": "3️⃣", "label": "version 3", "sub": "@challenger", "color": "amber"}
    ]}
  ]}
 ]}}
```

A registered model has a **three-level name**, like a table. It inherits governance from its catalog and schema, and every workspace attached to the metastore sees the same model.

## 📦 Versions, aliases and tags

| Item | Changes? | Example | Purpose |
|---|---|---|---|
| **Version** | Never | `churn_model/2` | One registered copy of one logged model |
| **Alias** | Moves | `@champion` → version 2 | A stable name for the version in use; one version per alias |
| **Tag** | Editable | `validation_status = passed` | Describes a model or a version; points at nothing |

```python
mlflow.set_registry_uri("databricks-uc")      # needed in MLflow 2; the default in MLflow 3 on Databricks
mv = mlflow.register_model(f"runs:/{run_id}/model", f"{CATALOG}.{SCHEMA}.churn_model")
# or: mlflow.sklearn.log_model(..., registered_model_name=f"{CATALOG}.{SCHEMA}.churn_model")
```

A model needs a **signature** to be registered in Unity Catalog. Log it with `signature=` or an `input_example`.

## 🔁 From run to inference

```viz flow
{"nodes": [
  {"icon": "🏋️", "title": "Train", "sub": "MLflow run", "color": "blue"},
  {"icon": "📦", "title": "Register", "sub": "new version", "color": "purple"},
  {"icon": "🔬", "title": "Validate", "sub": "@challenger", "color": "amber"},
  {"icon": "🏆", "title": "Promote", "sub": "move @champion", "color": "green"},
  {"icon": "🎯", "title": "Load", "sub": "models:/…@champion", "color": "navy"}
 ],
 "edges": ["runs:/<id>/model", "set alias", "if it wins", "jobs, endpoints"],
 "steps": [
  {"label": "Train", "focus": [0], "note": "The model is logged with a signature and an input example inside a run."},
  {"label": "Register", "focus": [1], "note": "`register_model` creates the registered model if needed and adds the next version number. The version records its source run."},
  {"label": "Validate", "focus": [2], "note": "Alias the new version `@challenger`. Score `@champion` and `@challenger` on the **same** recent data with the same metric."},
  {"label": "Promote", "focus": [3], "note": "`set_registered_model_alias(name, \"champion\", version)` moves the alias. The old version stays, ready for rollback."},
  {"label": "Load", "focus": [4], "note": "Batch jobs and endpoints load by alias and pick up the new version without any code change."}
 ]}
```

## 🏷️ The champion alias moves

```viz table
{"title": "versions of dev.churn.churn_model", "columns": ["version", "roc_auc", "aliases", "tags"],
 "rows": [[1, 0.821, "", ""]],
 "steps": [
  {"label": "Register v1", "note": "The first version has no alias yet. Nothing points at it."},
  {"label": "Make it champion", "note": "Jobs that load `@champion` now get version 1.", "upd": {"0": {"aliases": "@champion"}}, "hl": [0]},
  {"label": "Register v2", "note": "A retrained model becomes version 2 and is aliased `@challenger`. The champion is unchanged.", "add": [[2, 0.836, "@challenger", ""]], "hl": [1]},
  {"label": "Validate", "note": "Both are scored on the same data. Version 2 wins, and the result is written as a tag.", "upd": {"1": {"tags": "validation_status=passed"}}, "hl": [0, 1]},
  {"label": "Promote", "note": "`@champion` moves to version 2 and `@challenger` is deleted. Version 1 still exists, so a rollback is one more alias move.", "upd": {"0": {"aliases": ""}, "1": {"aliases": "@champion"}}, "hl": [1]}
 ]}
```

## ⚖️ Stages are gone, aliases replace them

```viz compare
{"items": [
 {"icon": "🏚️", "title": "Workspace Model Registry", "sub": "legacy", "color": "gray",
  "points": ["Fixed stages: None, Staging, Production, Archived", "`transition_model_version_stage(...)`", "URIs like `models:/churn/Production`", "One registry per workspace"]},
 {"icon": "🛡️", "title": "Models in Unity Catalog", "sub": "current", "color": "purple",
  "points": ["✅ Any number of named aliases: `@champion`, `@challenger`", "✅ `set_registered_model_alias(...)`", "✅ URIs like `models:/dev.churn.churn_model@champion`", "✅ One registry for all workspaces, with UC privileges and lineage"],
  "foot": "Environments are catalogs, not stages"}
 ]}
```

## 🔐 Privileges and lineage

| To… | You need |
|---|---|
| Reach the schema | `USE CATALOG` and `USE SCHEMA` |
| Register a new model in the schema | `CREATE MODEL` on the schema |
| Load a version and score with it | `EXECUTE` on the model |
| Manage versions, aliases and grants | Ownership of the model |

- Each version links to the **run** and notebook that produced it.
- Upstream tables appear in lineage when they are logged as inputs, for example with `mlflow.log_input(...)` or through `fe.log_model` feature lookups.
- Serving endpoints that use the model appear downstream.

## 🌍 Promoting across environments

Use one catalog per environment: `dev`, `staging`, `prod`. Databricks recommends **deploying code**: the reviewed training job runs in prod and registers to `prod.ml.churn_model` itself. When a model is too costly to retrain, **copy** the validated version instead:

```python
client = MlflowClient()
client.copy_model_version(
    src_model_uri="models:/staging.ml.churn_model@champion",
    dst_name="prod.ml.churn_model",
)   # creates a new version in prod; set the prod alias after checks
```

Never hard-code a version number in a consumer. A version number says *what was registered*; an alias says *what is in use*.

## 🧪 Try it: register, alias, promote

```dataset churn
```

> Registering creates a model in your schema, which needs `CREATE MODEL` on it. As the owner of your schema you have it. Ask your admin if `register_model` fails with a permission error.

```python run
# Train, log with a signature, and register version by version
import mlflow
from mlflow import MlflowClient
from mlflow.models import infer_signature
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

mlflow.set_registry_uri("databricks-uc")
mlflow.sklearn.autolog(disable=True)
MODEL_NAME = f"{CATALOG}.{SCHEMA}.churn_model"
client = MlflowClient()

NUM = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
CAT = ["contract", "plan"]
pdf = spark.table("subscribers").toPandas()
X_train, X_val, y_train, y_val = train_test_split(
    pdf[CAT + NUM], pdf["churned"], test_size=0.25, stratify=pdf["churned"], random_state=42)

def train_and_register(num, cat):
    steps = [("num", StandardScaler(), num)] + ([("cat", OneHotEncoder(handle_unknown="ignore"), cat)] if cat else [])
    model = make_pipeline(ColumnTransformer(steps), LogisticRegression(max_iter=1000)).fit(X_train, y_train)
    auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])
    with mlflow.start_run(run_name=f"uc_{len(num + cat)}_features") as run:
        mlflow.log_param("features", ",".join(num + cat))
        mlflow.log_metric("roc_auc", auc)
        mlflow.sklearn.log_model(model, "model", input_example=X_train.head(3),   # same input columns
                                 signature=infer_signature(X_train, model.predict(X_train)))  # for every version
    mv = mlflow.register_model(f"runs:/{run.info.run_id}/model", MODEL_NAME)
    print(f"{MODEL_NAME} version {mv.version}: roc_auc={auc:.3f}")
    return mv

mv1 = train_and_register(["monthly_fee", "avg_weekly_minutes"], [])   # a weak first model
```

```python run
# Point @champion at the first version and load it by alias
client.set_registered_model_alias(MODEL_NAME, "champion", mv1.version)

champion = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@champion")
print(champion.predict(X_val.head(5)))
```

```python run
# Register a second version, validate it as challenger, move the champion alias
mv2 = train_and_register(NUM, CAT)   # all features
client.set_registered_model_alias(MODEL_NAME, "challenger", mv2.version)

def auc_of(alias):
    m = mlflow.sklearn.load_model(f"models:/{MODEL_NAME}@{alias}")
    return roc_auc_score(y_val, m.predict_proba(X_val)[:, 1])

champ, chall = auc_of("champion"), auc_of("challenger")
print(f"champion {champ:.3f}   challenger {chall:.3f}")
if chall > champ:
    client.set_registered_model_alias(MODEL_NAME, "champion", mv2.version)
    client.delete_registered_model_alias(MODEL_NAME, "challenger")
print("@champion is now version", client.get_model_version_by_alias(MODEL_NAME, "champion").version)
```

> Open **Catalog** in the side bar and find `churn_model` in your schema: the versions, the aliases and the source run of each version are all there.

## Exercise 1: tag the validation result

Register two versions of a small model as `churn_model_ex`. Compare them by alias on the same rows, record the result as a **version tag**, and promote only if the challenger wins.

```python todo
# TODO 1: register two LogisticRegression versions (different C) to f"{CATALOG}.{SCHEMA}.churn_model_ex"
# TODO 2: alias v1 champion, v2 challenger; compare roc_auc on the same validation rows
# TODO 3: set_model_version_tag(name, v2, "validation_status", "passed" or "failed"); promote if passed
```

```python solution
import mlflow
from mlflow import MlflowClient
from mlflow.models import infer_signature
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

mlflow.set_registry_uri("databricks-uc")
mlflow.sklearn.autolog(disable=True)
client, NAME = MlflowClient(), f"{CATALOG}.{SCHEMA}.churn_model_ex"
cols = ["tenure_months", "support_calls_90d", "payment_failures_6m"]
pdf = spark.table("subscribers").toPandas().astype({c: "float64" for c in cols})
X_tr, X_va, y_tr, y_va = train_test_split(pdf[cols], pdf["churned"], test_size=0.25, random_state=1)

versions = []
for C in [0.0001, 1.0]:
    m = LogisticRegression(C=C, max_iter=1000).fit(X_tr, y_tr)
    with mlflow.start_run() as run:
        mlflow.sklearn.log_model(m, "model", signature=infer_signature(X_tr, m.predict(X_tr)))
    versions.append(mlflow.register_model(f"runs:/{run.info.run_id}/model", NAME).version)

client.set_registered_model_alias(NAME, "champion", versions[0])
client.set_registered_model_alias(NAME, "challenger", versions[1])
auc = {a: roc_auc_score(y_va, mlflow.sklearn.load_model(f"models:/{NAME}@{a}").predict_proba(X_va)[:, 1])
       for a in ["champion", "challenger"]}
status = "passed" if auc["challenger"] > auc["champion"] else "failed"
client.set_model_version_tag(NAME, versions[1], "validation_status", status)
if status == "passed":
    client.set_registered_model_alias(NAME, "champion", versions[1])
print(auc, status, "champion =", client.get_model_version_by_alias(NAME, "champion").version)
```

## Exercise 2: roll back

The new champion misbehaves in production. Roll back to the previous version **without** registering anything. **Predict first:** what does `models:/...@challenger` resolve to after you delete that alias?

```python todo
# TODO 1: move @champion of churn_model_ex back to the first version from Exercise 1
# TODO 2: delete the @challenger alias
# TODO 3: print the champion version, then try loading @challenger and read the error
```

```python solution
client.set_registered_model_alias(NAME, "champion", versions[0])
client.delete_registered_model_alias(NAME, "challenger")
print("champion =", client.get_model_version_by_alias(NAME, "champion").version)

try:
    mlflow.pyfunc.load_model(f"models:/{NAME}@challenger")
except Exception as e:
    print("No such alias any more:", type(e).__name__)
# Both versions still exist; only the pointers changed.

# Clean up when you are done
# client.delete_registered_model(NAME)
```

## ⚠️ Common mistakes

- ❌ `transition_model_version_stage(..., "Production")`. Stages do not exist in Unity Catalog; use aliases.
- ❌ Two-level names like `churn.churn_model`. Unity Catalog models are `catalog.schema.model`.
- ❌ Hard-coding `models:/…/3` in a job. Load `@champion`.
- ❌ Deleting the old version to "promote" the new one. Move the alias and keep the old version for rollback.
- ❌ Registering without a signature. Unity Catalog rejects it.
- ✅ Compare champion and challenger on the same data before moving the alias.

## 🧭 Cheat sheet

| Task | Call |
|---|---|
| Use the UC registry | `mlflow.set_registry_uri("databricks-uc")` |
| Register a version | `mlflow.register_model("runs:/<id>/model", "cat.sch.model")` |
| Point an alias | `client.set_registered_model_alias(name, "champion", version)` |
| Read an alias | `client.get_model_version_by_alias(name, "champion")` |
| Load by alias / by version | `models:/cat.sch.model@champion` / `models:/cat.sch.model/2` |
| Copy to another catalog | `client.copy_model_version(src_model_uri, dst_name)` |
