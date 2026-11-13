---
title: "Machine Learning Associate: exam prep"
summary: What the Databricks Certified Machine Learning Associate exam covers, the facts and distinctions each domain tests, the traps, and a three-week study plan.
icon: 🎓
level: Intermediate
minutes: 14
group: Associate
tags: [Certification, Machine Learning, MLflow]
---
# Machine Learning Associate: exam prep

> The exam is for people who build basic ML solutions on Databricks: explore and prepare data, train and tune models, track them with MLflow, govern them in Unity Catalog and deploy them. Passing shows you can do the whole loop with Databricks tools, not only with scikit-learn.

**The one idea to remember:** most questions are scenarios with one deciding constraint (skewed data, a rare class, prod data locked away, a nightly job). Find that constraint first, then pick the Databricks tool or method that fits it.

## 📋 The exam at a glance

| Item | Details |
|---|---|
| **Questions** | 48 scored, plus up to 10 unscored items |
| **Time** | 90 minutes (extra time for unscored items is included) |
| **Format** | Multiple choice and multiple selection. ML code is Python, some data code is SQL |
| **Fee** | USD 200 |
| **Delivery** | Online proctored or at a test center. No test aides |
| **Validity** | 2 years |

- **Passing score:** Databricks does not publish one. Aim for 80% or more on practice tests you have not seen before.
- **Version:** the current exam was published on March 1, 2025.

## 🗺️ Domains and weights

```viz layers
{"layers": [
  {"icon": "🧰", "title": "Databricks Machine Learning · 38%", "sub": "the platform tools", "color": "purple", "items": ["AutoML and ML runtimes", "Feature tables in Unity Catalog", "MLflow tracking", "Models in UC: tags and aliases"]},
  {"icon": "🧹", "title": "Data Processing · 19%", "sub": "explore and prepare", "color": "teal", "items": ["Summary statistics", "Outliers: std dev or IQR", "Imputation and one-hot encoding", "Log transforms"]},
  {"icon": "🏗️", "title": "Model Development · 31%", "sub": "train, tune, evaluate", "color": "blue", "items": ["Estimators, transformers, pipelines", "Hyperopt `fmin` and cross-validation", "Metrics and bias vs variance"]},
  {"icon": "🚀", "title": "Model Deployment · 12%", "sub": "serve predictions", "color": "amber", "items": ["Batch, streaming, real-time", "Model Serving endpoints", "Traffic splitting"]}
 ]}
```

Databricks ML and Model Development together are 69% of the exam: spend most of your time on MLflow, feature tables, the registry and tuning, and treat deployment as a smaller, high-yield topic.

## 🧰 ML runtime, MLOps and AutoML

- **ML runtime advantages:** pre-installed, tested ML libraries, built-in MLflow, GPU variants. It does not make code faster, and MLflow does not require it.
- **MLOps:** dev, staging and prod environments (often one UC catalog each), everything in Git, Lakeflow Jobs for automation, champion vs challenger validation before promotion.
- **AutoML** is a glass box: a data exploration notebook, an editable notebook for the best trial, and one MLflow run per trial. Default metrics: F1 (classification), R² (regression), SMAPE (forecasting). Default split 60/20/20. It never deploys by itself.

```viz compare
{"title": "What moves from dev to prod?",
 "items": [
  {"icon": "📜", "title": "Deploy code", "sub": "Databricks' default recommendation", "color": "green",
   "points": ["✅ Prod data is only reachable in prod", "✅ Safe automated retraining", "✅ Strict code review for prod", "❌ Needs CI/CD"]},
  {"icon": "📦", "title": "Deploy models", "sub": "train once, promote the artifact", "color": "blue",
   "points": ["✅ Training is very expensive or hard to repeat", "✅ Single workspace, no CI/CD", "❌ Fails if dev cannot read prod data", "❌ Retraining is awkward"]}
 ]}
```

## 🏪 Feature tables in Unity Catalog

In Unity Catalog, **any Delta table with a primary key is a feature table**. Use `FeatureEngineeringClient` (not the legacy `FeatureStoreClient`).

```viz flow
{"title": "Train and score with feature lookups",
 "nodes": [
  {"icon": "🏗️", "title": "create_table", "sub": "primary_keys, optional timeseries_columns", "color": "teal"},
  {"icon": "✍️", "title": "write_table", "sub": "mode=\"merge\" upserts on the key", "color": "teal"},
  {"icon": "🔗", "title": "create_training_set", "sub": "label df + FeatureLookup", "color": "blue"},
  {"icon": "📦", "title": "fe.log_model", "sub": "stores feature metadata", "color": "purple"},
  {"icon": "🎯", "title": "score_batch", "sub": "df needs only the keys", "color": "green"}
 ],
 "edges": ["new rows", "join features", "train + log", "lookup at scoring"],
 "steps": [
  {"label": "Create", "focus": [0], "note": "Account level: one table, discoverable from every workspace on the metastore, governed by UC privileges, with lineage to models."},
  {"label": "Write", "focus": [1], "note": "`merge` updates existing keys, inserts new ones and leaves other keys alone. `overwrite` would replace the whole table."},
  {"label": "Build the training set", "focus": [2], "note": "The label DataFrame holds keys and the label. A `timestamp_lookup_key` makes the join **point in time**, so no future values leak in."},
  {"label": "Log", "focus": [3], "note": "`fe.log_model` packages which features come from which table. Plain `mlflow.sklearn.log_model` does not, and then automatic lookup fails."},
  {"label": "Score", "focus": [4], "note": "`score_batch` fetches the latest feature values itself. Offline Delta tables serve training and batch; **online** tables serve millisecond lookups for real-time endpoints."}
 ]}
```

## 📈 MLflow tracking and Models in Unity Catalog

- **Params** are logged once and cannot change within a run. **Metrics** can be logged many times with a `step`. `log_artifact` needs a file path; `log_dict` and `log_figure` write the file for you.
- **Best run:** `MlflowClient().search_runs(..., order_by=["metrics.val_rmse ASC"], max_results=1)`. ASC for errors, DESC for scores. `get_run` fetches a known run, it does not rank.
- **Register:** `mlflow.register_model("runs:/<id>/model", "catalog.schema.model")` or `client.create_model_version`. UC needs a **signature** and a three-level name.

```viz table
{"title": "ml.churn.churn_classifier: versions and aliases", "columns": ["version", "aliases", "version tags"],
 "rows": [["1", "@champion", "validation_status=passed"]],
 "steps": [
  {"label": "Start", "note": "Version 1 serves production through the alias. Jobs and endpoints load `models:/ml.churn.churn_classifier@champion`."},
  {"label": "Register v2", "note": "Each registration creates a new, immutable version.", "add": [["2", "", ""]]},
  {"label": "Mark the challenger", "note": "`set_registered_model_alias(name, \"challenger\", \"2\")`. An alias points to exactly one version.", "upd": {"1": {"aliases": "@challenger"}}},
  {"label": "Validate and tag", "note": "Score champion and challenger on the **same** held-out data. Record the result as a tag with `set_model_version_tag`. Tags describe; they do not route.", "upd": {"1": {"version tags": "validation_status=passed"}}, "hl": [1]},
  {"label": "Promote", "note": "Setting `@champion` on version 2 **moves** it. Consumers change nothing. Rollback is the same call with version 1.", "upd": {"0": {"aliases": ""}, "1": {"aliases": "@champion, @challenger"}}},
  {"label": "Clean up", "note": "`delete_registered_model_alias(name, \"challenger\")`. Stages (Staging, Production) do not exist in UC.", "upd": {"1": {"aliases": "@champion"}}}
 ]}
```

## 🧹 Data processing

| Task | What the exam wants |
|---|---|
| **Summary stats** | `describe()`: count, mean, stddev, min, max. `summary()` adds 25/50/75%. `dbutils.data.summarize(df)` adds histograms |
| **Outliers** | Std dev rule (mean ± 3σ) for roughly normal data. IQR rule `[Q1 − 1.5·IQR, Q3 + 1.5·IQR]` for skewed data. Fit on training data only |
| **Compare features** | Two continuous: Pearson (linear) or Spearman (monotonic, robust). Two categorical: crosstab plus chi-square |
| **Impute** | Mean for symmetric, median for skewed, mode for categorical. Spark `Imputer` is numeric only, default `mean` |
| **One-hot encode** | `StringIndexer` then `OneHotEncoder` (sparse vector, `dropLast=True`). Yes for linear and distance models. No for trees, high cardinality or ordinal data |
| **Log transform** | Right-skewed values over several orders of magnitude (prices, income). Use `log1p` with zeros. Not for negatives |

## 🏗️ Algorithms, imbalance and pipelines

- **Pick by constraint:** interpretability or regulation → linear or logistic regression. Best accuracy on tabular data → gradient-boosted trees. Random forest (bagging) cuts variance; boosting cuts bias.
- **Imbalance:** class weights (`weightCol`, `class_weight="balanced"`), under or oversampling **of the training set only**, threshold tuning, F1 or PR AUC instead of accuracy, stratified splits.
- **Leakage-free pipeline:** split first, then `pipeline.fit(train_df)`. Every estimator stage learns from training rows only.

| | Transformer | Estimator |
|---|---|---|
| Method | `.transform(df)` returns a DataFrame | `.fit(df)` returns a Model |
| Learns from data | No | Yes |
| Examples | `VectorAssembler`, any fitted `*Model`, `PipelineModel` | `StringIndexer`, `Imputer`, `OneHotEncoder`, `LinearRegression`, `Pipeline`, `CrossValidator` |

## 🎛️ Tuning and counting models

```viz code
title: Hyperopt fmin, the parts the exam asks about
lang: python
---
space = {"max_depth": hp.quniform("max_depth", 2, 12, 1),
         "booster": hp.choice("booster", ["gbtree", "dart"])}

def objective(params):
    model = XGBClassifier(max_depth=int(params["max_depth"]),
                          booster=params["booster"])
    auc = cross_val_score(model, X, y, cv=3, scoring="roc_auc").mean()
    return {"loss": -auc, "status": STATUS_OK}

best = fmin(fn=objective, space=space, algo=tpe.suggest,
            max_evals=64, trials=SparkTrials(parallelism=8))
space_eval(space, best)
---
1 | quniform | Returns floats like 4.0. Cast with `int()` before passing it on.
2 | choice | In `best`, a choice comes back as an **index**, not the value.
8 | loss | `fmin` **minimizes**. Return the negative of a score you want high.
10 | algo | `tpe.suggest` is Bayesian. `rand.suggest` is random search. 64 trials × 3 folds = 192 fits.
11 | trials | `SparkTrials` parallelizes single-node libraries. For Spark MLlib use plain `Trials`. Higher parallelism means less adaptive TPE.
12 | space_eval | Turns indices back into real values.
```

- **Counting:** combinations × folds, plus 1 when the best model is refit on all training data. A 3 × 2 grid with `numFolds=3` is 18 fits, 19 with the refit.
- **CV vs split:** k-fold is more reliable and suits small data, but costs k times more. `TrainValidationSplit` (default `trainRatio` 0.75) is cheaper for large data.
- **Currency:** Hyperopt is not in Databricks Runtime ML after 16.4 LTS ML; Optuna or Ray Tune are recommended now. The exam still asks about `fmin`.

## 📏 Metrics and bias vs variance

| Scenario | Metric |
|---|---|
| Missing a positive is unacceptable (disease, fraud) | **Recall** |
| False alarms are expensive (costly manual review) | **Precision** |
| Rare positive class, one number needed | **F1** or **PR AUC** |
| Ranking quality, threshold decided later | **ROC AUC** (0.5 = random) |
| Calibrated probabilities needed | **Log loss** (lower is better) |
| Big misses hurt most / outliers present | **RMSE** / **MAE** |

- **Log target:** exponentiate predictions (`exp`, or `expm1` after `log1p`) before computing RMSE or MAE in the original unit.
- **R²** can be negative on test data: worse than predicting the mean.
- **High train and validation error** = high bias (underfit). **Low train, much higher validation error** = high variance (overfit): simplify, regularize, add data.

## 🚀 Model deployment

```viz compare
{"title": "Pick the serving pattern by latency",
 "items": [
  {"icon": "🌙", "title": "Batch", "sub": "minutes to hours", "color": "navy",
   "points": ["Nightly scores, weekly forecasts", "`mlflow.pyfunc.spark_udf`, `fe.score_batch`", "pandas `predict`, or `mapInPandas` at scale", "✅ Cheapest per prediction"]},
  {"icon": "🌊", "title": "Streaming", "sub": "seconds to minutes", "color": "teal",
   "points": ["IoT, clickstream scoring", "Model as a Spark UDF **inside** a declarative pipeline", "Pipeline manages checkpoints, retries, autoscaling", "❌ Not an endpoint call per event"]},
  {"icon": "⚡", "title": "Real-time", "sub": "milliseconds", "color": "amber",
   "points": ["Checkout fraud, recommendations", "Model Serving REST endpoint", "Custom logic: `mlflow.pyfunc.PythonModel`", "A/B: `traffic_config` routes summing to 100"]}
 ]}
```

The guide says Delta Live Tables; the product is now **Lakeflow Spark Declarative Pipelines**, same concepts. Query an endpoint with a `dataframe_split` JSON body.

## 🪤 Typical traps

- ❌ Model stages and `models:/name/Production`. ✅ Aliases: `models:/catalog.schema.model@champion`.
- ❌ Returning AUC as the `loss` in `fmin`. ✅ Return `-auc`; Hyperopt minimizes.
- ❌ Fitting the imputer or indexer, or oversampling, before the split. ✅ Split first, fit on training rows only.
- ❌ One-hot encoding a 50,000-level ID for a random forest. ✅ Index it, or use another encoding.
- ❌ "Deploy models is simpler, so it is recommended." ✅ Databricks recommends deploy code in most cases.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks to exam day",
 "items": [
  {"label": "Days 1-3", "title": "Platform and MLOps", "color": "purple", "note": "Study **The ML lifecycle on Databricks**: runtimes, dev/staging/prod, deploy code vs deploy models."},
  {"label": "Days 4-6", "title": "MLflow and the registry", "color": "blue", "note": "Study **MLflow tracking** and **Models in Unity Catalog**. Log params, metrics and artifacts by hand, find the best run with `search_runs`, then register and move aliases."},
  {"label": "Days 7-8", "title": "Feature tables", "color": "teal", "note": "Study **Feature engineering in Unity Catalog**. Write the create, merge, `create_training_set`, `fe.log_model`, `score_batch` sequence from memory."},
  {"label": "Days 9-11", "title": "Data prep and development", "color": "green", "note": "Practice `summary()`, IQR filtering, `Imputer`, `StringIndexer` plus `OneHotEncoder` inside a `Pipeline`."},
  {"label": "Days 12-13", "title": "Tuning", "color": "amber", "note": "Study **Hyperparameter tuning**. Count models for grids with CV until it is automatic."},
  {"label": "Days 14-15", "title": "Deployment", "color": "navy", "note": "Study **Model serving** and skim **Monitoring models and drift**, plus **Lakeflow Spark Declarative Pipelines** for streaming inference."},
  {"label": "Days 16-20", "title": "Timed practice", "color": "red", "note": "Take full timed practice exams (48 questions, 90 minutes). Review **every** wrong answer and every lucky guess."}
 ]}
```

## 🧭 Exam-day checklist

| Do | Why |
|---|---|
| Budget under 2 minutes per question | 90 minutes for 48 scored plus up to 10 unscored items |
| Underline the constraint: skewed, rare class, latency, prod access | It decides the answer more often than the tool names |
| Check "select all that apply" | Multiple-selection questions need every correct option |
| Spot legacy names: stages, `FeatureStoreClient`, Delta Live Tables | Stages and the workspace client are usually distractors; DLT is the old pipeline name |
| Flag long code questions and come back | Do not let one `fmin` puzzle eat five minutes |
| Recount grid × folds (+1 refit) before answering | Arithmetic slips are the cheapest points to lose |
