---
title: MLflow tracking
summary: Record every training attempt as an MLflow run with its parameters, metrics and model. Compare runs in the UI and in code, then load the best model back by its run URI.
icon: 🧪
level: Beginner
minutes: 10
group: Foundations
tags: [MLflow, Experiments, Runs, Autologging]
---
# MLflow tracking

> You will train many versions of a model before one is good enough. MLflow tracking writes down what each attempt used and what it achieved, so you never have to remember which notebook cell produced the best number.

**The one idea to remember:** one training attempt is one **run**. A run stores its inputs (parameters), its results (metrics) and its outputs (artifacts, including the model), and every run belongs to an **experiment**.

## 🌳 Experiments hold runs

```viz tree
{"root": {"icon": "🧪", "label": "experiment", "sub": "notebook experiment or /Users/you/churn", "color": "purple", "children": [
   {"icon": "▶️", "label": "run: logreg_C_0.1", "sub": "run_id 7f3a…, status FINISHED", "color": "blue", "children": [
     {"icon": "🎛️", "label": "parameters", "sub": "C = 0.1, max_iter = 1000", "color": "teal"},
     {"icon": "📏", "label": "metrics", "sub": "roc_auc, f1 (numbers, can have a history)", "color": "green"},
     {"icon": "🏷️", "label": "tags", "sub": "demo = tracking, plus system tags like the source notebook", "color": "gray"},
     {"icon": "📁", "label": "artifacts", "sub": "files: plots, data samples, model/", "color": "amber"}
   ]},
   {"icon": "▶️", "label": "run: logreg_C_1.0", "sub": "another attempt, same structure", "color": "blue"}
 ]}}
```

| Item | Type | Rule |
|---|---|---|
| **Parameter** | string, logged once | Immutable: logging the same key with a new value fails |
| **Metric** | number, optional `step` | Log it many times to get a curve, such as loss per epoch |
| **Tag** | string | Searchable metadata: team, data version, purpose |
| **Artifact** | any file | Plots, reports, and the model folder |

## 🧾 A tracking snippet, line by line

```viz code
title: one run of the churn model
lang: python
---
mlflow.sklearn.autolog(disable=True)
with mlflow.start_run(run_name="logreg_C_0.1") as run:
    mlflow.log_params({"C": 0.1, "max_iter": 1000})
    mlflow.set_tag("demo", "tracking")
    model = make_model(C=0.1).fit(X_train, y_train)
    proba = model.predict_proba(X_val)[:, 1]
    mlflow.log_metrics({"roc_auc": roc_auc_score(y_val, proba),
                        "f1": f1_score(y_val, (proba >= 0.5).astype(int))})
    signature = infer_signature(X_train, model.predict(X_train))
    mlflow.sklearn.log_model(model, "model", signature=signature,
                             input_example=X_train.head(3))
print(run.info.run_id)
---
1 | autolog off | Databricks turns autologging on for many libraries. Switching it off here means the run holds only what you log by hand.
2 | start_run | Opens a run in the active experiment. When the `with` block ends, the run is marked FINISHED (or FAILED on an exception).
3-4 | params and tags | Inputs and labels for search. Parameters are stored as strings.
5-8 | metrics | Train, then score on the **validation** rows and log the numbers you will compare runs by.
9-11 | the model | The model is saved as artifacts under `model/`, with a signature (input and output schema) and a small input example.
12 | run_id | The unique id. `runs:/<run_id>/model` now points to this model.
```

## 📦 What a logged model is

`log_model` writes a folder of artifacts. The `MLmodel` file describes how to load it:

```yaml
artifact_path: model
flavors:
  python_function:            # generic interface: load_model(...).predict(df)
    loader_module: mlflow.sklearn
    env: {conda: conda.yaml, virtualenv: python_env.yaml}
  sklearn:                    # native interface: the scikit-learn Pipeline itself
    pickled_model: model.pkl
signature:
  inputs: '[{"name": "contract", "type": "string"}, {"name": "tenure_months", "type": "integer"}, ...]'
  outputs: '[{"type": "long"}]'
```

Next to it sit `model.pkl`, `requirements.txt`, `conda.yaml` and `input_example.json`. The **flavor** says which library can load it; `python_function` lets any tool call `.predict()`. The **signature** is required to register the model in Unity Catalog. In MLflow 3, `log_model(name="model")` replaces `artifact_path`; both forms appear in docs.

## 🤖 Autologging and nested runs

- `mlflow.autolog()` (or `mlflow.sklearn.autolog()`) hooks into `fit()` and logs parameters, training metrics and the model with a signature. On Databricks it is enabled by default for supported libraries.
- Autologging does **not** know your validation set. Log validation metrics yourself.
- **Nested runs** group related runs: one parent for a tuning job, one child per trial. Children carry the tag `mlflow.parentRunId`.

```python
with mlflow.start_run(run_name="C sweep"):
    for c in [0.01, 0.1, 1.0]:
        with mlflow.start_run(run_name=f"C_{c}", nested=True):
            ...   # log params, metrics, model for this trial
```

## 📍 Where experiments live

| | Notebook experiment | Workspace experiment |
|---|---|---|
| Created | Automatically, on the first run from a notebook | Explicitly: `mlflow.set_experiment("/Users/you/churn")` |
| Path | Same as the notebook | Any workspace folder you choose |
| Good for | Quick exploration | Runs from several notebooks and jobs in one place |
| Watch out | Deleting the notebook deletes it | Needs a path you can write to |

The experiment page lists runs as a table with one column per parameter and metric. You can sort, filter with expressions like `metrics.roc_auc > 0.8`, and select runs to **compare** them in charts.

## 📊 The runs table fills up

```viz table
{"title": "experiment runs (illustrative numbers)", "columns": ["run", "params.C", "metrics.roc_auc", "status"],
 "rows": [["logreg_C_0.01", "0.01", null, "RUNNING"]],
 "steps": [
  {"label": "Run 1 starts", "note": "`start_run` creates the row at once. Parameters appear immediately, metrics when they are logged."},
  {"label": "Run 1 ends", "note": "Strong regularisation (small C): a simpler model.", "upd": {"0": {"metrics.roc_auc": 0.821, "status": "FINISHED"}}},
  {"label": "Run 2", "note": "Each new run is a new row. Nothing about run 1 changes.", "add": [["logreg_C_0.1", "0.1", 0.836, "FINISHED"]]},
  {"label": "Run 3", "note": "A third value of C.", "add": [["logreg_C_1.0", "1.0", 0.834, "FINISHED"]]},
  {"label": "Pick the best", "note": "`search_runs(order_by=[\"metrics.roc_auc DESC\"])` returns this row first. Order **descending** for scores, **ascending** for errors such as RMSE.", "hl": [1]}
 ]}
```

## 🔄 From the best run back to predictions

```viz flow
{"nodes": [
  {"icon": "▶️", "title": "Runs", "sub": "params, metrics, model", "color": "blue"},
  {"icon": "🔎", "title": "search_runs", "sub": "pandas DataFrame", "color": "purple"},
  {"icon": "🔗", "title": "Model URI", "sub": "runs:/<run_id>/model", "color": "navy"},
  {"icon": "🎯", "title": "load_model", "sub": "mlflow.pyfunc", "color": "green"}
 ],
 "edges": ["filter and sort", "best run_id", "download artifacts"],
 "steps": [
  {"label": "Search", "focus": [0, 1], "note": "`mlflow.search_runs()` searches the active experiment and returns one row per run, with columns like `params.C` and `metrics.roc_auc`."},
  {"label": "Address", "focus": [2], "note": "A `runs:/` URI names an artifact path inside one run. It works anywhere MLflow accepts a model URI."},
  {"label": "Load and predict", "focus": [3], "note": "`mlflow.pyfunc.load_model(uri).predict(df)` rebuilds the pipeline. It is the same object that was trained, preprocessing included."}
 ]}
```

## 🧪 Try it: three runs and the best one

```dataset churn
```

```python run
# Prepare data and a model factory
import mlflow
from mlflow.models import infer_signature
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, f1_score

NUM = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
CAT = ["contract", "plan"]
pdf = spark.table("subscribers").toPandas()
X_train, X_val, y_train, y_val = train_test_split(
    pdf[CAT + NUM], pdf["churned"], test_size=0.25, stratify=pdf["churned"], random_state=42)

def make_model(C):
    prep = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
                              ("num", StandardScaler(), NUM)])
    return make_pipeline(prep, LogisticRegression(C=C, max_iter=1000))
```

```python run
# Log one run per value of C
mlflow.sklearn.autolog(disable=True)
for C in [0.01, 0.1, 1.0]:
    with mlflow.start_run(run_name=f"logreg_C_{C}"):
        mlflow.log_params({"C": C, "max_iter": 1000})
        mlflow.set_tag("demo", "tracking")
        model = make_model(C).fit(X_train, y_train)
        proba = model.predict_proba(X_val)[:, 1]
        mlflow.log_metrics({"roc_auc": roc_auc_score(y_val, proba), "f1": f1_score(y_val, (proba >= 0.5).astype(int))})
        mlflow.sklearn.log_model(model, "model", input_example=X_train.head(3),
                                 signature=infer_signature(X_train, model.predict(X_train)))
```

```python run
# Find the best run and load its model
runs = mlflow.search_runs(filter_string="tags.demo = 'tracking'",
                          order_by=["metrics.roc_auc DESC"])
display(runs[["run_id", "tags.mlflow.runName", "params.C", "metrics.roc_auc", "metrics.f1"]])

best_id = runs.loc[0, "run_id"]
loaded = mlflow.pyfunc.load_model(f"runs:/{best_id}/model")
print(loaded.predict(X_val.head(5)))
```

> Open the **Experiments** icon in the notebook's right side bar to see the same runs in the UI. Re-running the cells adds new runs; the filter on the tag keeps the search focused.

## Exercise 1: group runs under a parent

Wrap a sweep over `C` in one parent run with **nested** child runs, then list only the children of that parent.

```python todo
# TODO 1: load subscribers, split, and train LogisticRegression(C=...) for C in [0.05, 0.5, 5.0]
# TODO 2: one parent run "C sweep", one nested child run per C, log C and roc_auc in each child
# TODO 3: search_runs with filter_string on tags.mlflow.parentRunId
```

```python solution
import mlflow
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

cols = ["tenure_months", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
pdf = spark.table("subscribers").toPandas()
X_tr, X_va, y_tr, y_va = train_test_split(pdf[cols], pdf["churned"], test_size=0.25, random_state=1)

mlflow.sklearn.autolog(disable=True)
with mlflow.start_run(run_name="C sweep") as parent:
    for C in [0.05, 0.5, 5.0]:
        with mlflow.start_run(run_name=f"C_{C}", nested=True):
            m = LogisticRegression(C=C, max_iter=1000).fit(X_tr, y_tr)
            mlflow.log_param("C", C)
            mlflow.log_metric("roc_auc", roc_auc_score(y_va, m.predict_proba(X_va)[:, 1]))

children = mlflow.search_runs(filter_string=f"tags.mlflow.parentRunId = '{parent.info.run_id}'")
display(children[["tags.mlflow.runName", "params.C", "metrics.roc_auc"]])
```

## Exercise 2: parameter or metric?

A random forest gets better as it grows trees. Log the validation AUC after 10, 20, ... 100 trees in **one** run. **Predict first:** what happens if you log it with `log_param` instead?

```python todo
# TODO 1: in one run, loop n in range(10, 101, 10): train RandomForestClassifier(n_estimators=n, max_depth=6)
# TODO 2: log roc_auc with step=n
# TODO 3: (optional) try mlflow.log_param("n", n) inside the loop and read the error
```

```python solution
import mlflow
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

cols = ["tenure_months", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
pdf = spark.table("subscribers").toPandas()
X_tr, X_va, y_tr, y_va = train_test_split(pdf[cols], pdf["churned"], test_size=0.25, random_state=1)

mlflow.sklearn.autolog(disable=True)
with mlflow.start_run(run_name="rf_growth"):
    for n in range(10, 101, 10):
        rf = RandomForestClassifier(n_estimators=n, max_depth=6, random_state=0).fit(X_tr, y_tr)
        mlflow.log_metric("roc_auc", roc_auc_score(y_va, rf.predict_proba(X_va)[:, 1]), step=n)
# The run page shows roc_auc as a curve over the steps.
# log_param("n", ...) a second time with a new value raises an MlflowException: params are immutable.
```

## ⚠️ Common mistakes

- ❌ Logging a value that changes over training with `log_param`. Use `log_metric(..., step=)`.
- ❌ Picking the most recent run instead of sorting by the metric you care about.
- ❌ Ordering by RMSE descending. Errors sort ascending, scores descending.
- ❌ Trusting autolog metrics as validation results. They are computed on the training data.
- ❌ `log_artifact` with an in-memory object. It needs a file path; use `log_dict`, `log_figure` or `log_text`.
- ✅ Log a signature and an input example with every model you may register later.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Start a run | `with mlflow.start_run(run_name=...) as run:` |
| Log inputs / results | `log_param(s)` / `log_metric(s)`, with `step=` for curves |
| Log the model | `mlflow.sklearn.log_model(model, "model", signature=..., input_example=...)` |
| Log automatically | `mlflow.autolog()` or `mlflow.sklearn.autolog()` |
| Use a shared experiment | `mlflow.set_experiment("/Users/you/churn")` |
| Find the best run, load it | `mlflow.search_runs(order_by=["metrics.roc_auc DESC"])`, `mlflow.pyfunc.load_model("runs:/<id>/model")` |
