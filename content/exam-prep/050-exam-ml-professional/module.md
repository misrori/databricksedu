---
title: "Machine Learning Professional: exam prep"
summary: What the Databricks Certified Machine Learning Professional exam covers, the facts and distinctions to know per domain, the typical traps, and a 3-week study plan.
icon: 🎓
level: Advanced
minutes: 14
group: Professional
tags: [Certification, Machine Learning, MLOps]
---
# Machine Learning Professional: exam prep

> For ML engineers with about a year of hands-on ML on Databricks. Passing shows you can build, scale, operate and roll out ML systems at enterprise scale: SparkML, distributed tuning, feature serving, MLOps with bundles and tests, drift monitoring and safe rollouts.

**The one idea to remember:** most questions are long scenarios with one deciding constraint ("minimal setup", "model does not fit one GPU", "categorical column", "high traffic"). Find that constraint first, then pick the option that satisfies it with the least extra machinery.

## 📋 The exam at a glance

| Fact | Value |
|---|---|
| Scored questions | 59 multiple choice, plus up to 10 unscored items (the time already covers them) |
| Time and fee | 120 minutes · USD 200 |
| Delivery | Online proctored or test center, English, no test aides |
| Code in questions | Python: PySpark, MLflow, Feature Engineering client, Databricks SDK |
| Passing score | Not published by Databricks. Aim for 80%+ on unseen practice tests |
| Validity | 2 years. Recertify by taking the current exam |

## 🗺️ Domains and weights

```viz layers
{"title": "Exam blueprint (published September 30, 2025)",
 "layers": [
  {"icon": "🛠️", "title": "Model Development · 44%", "sub": "build, scale, tune, track, feature", "color": "blue",
   "items": ["SparkML pipelines and tuning", "pandas Function APIs, Spark vs Ray", "Optuna and Ray Tune with MLflow", "Point-in-time and online features"]},
  {"icon": "🔁", "title": "MLOps · 44%", "sub": "lifecycle, tests, bundles, monitoring", "color": "purple",
   "items": ["Deploy code, UC aliases", "Unit and integration tests", "Bundles and automated retraining", "Drift metrics, inference tables, alerts"]},
  {"icon": "🚀", "title": "Model Deployment · 12%", "sub": "rollouts and custom models", "color": "teal",
   "items": ["Blue-green, canary, A/B, shadow", "Custom PyFunc in Unity Catalog", "Query via REST or Deployments SDK"]}
 ]}
```

Development and MLOps are 88% of the score, so spend most of your time there. Monitoring alone carries many MLOps objectives.

## 🧱 Development: SparkML or single node

| Situation | Choose |
|---|---|
| Data does not fit one machine | SparkML `Pipeline` (StringIndexer, OneHotEncoder, VectorAssembler, estimator) |
| Data fits, rich library needed | Single-node (scikit-learn, XGBoost) |
| Thousands of per-group models | `groupBy(...).applyInPandas(train_fn, schema)` |
| Millisecond real-time inference | Single-node model on Model Serving |
| Batch or streaming scoring | `model.transform(df)` or `mlflow.pyfunc.spark_udf` |

- **Tuning:** `CrossValidator` fits folds × grid models; `TrainValidationSplit` is cheaper. Put the whole pipeline inside so encoders cannot leak.
- **Evaluator defaults:** binary `areaUnderROC` (switch to `areaUnderPR` when positives are rare), multiclass `f1`, regression `rmse`, clustering `silhouette`.

## ⚖️ Development: scaling out

```viz compare
{"title": "Which kind of scaling does the scenario need?",
 "items": [
  {"icon": "⬆️", "title": "Vertical", "sub": "bigger node or GPU", "color": "blue",
   "points": ["✅ no communication overhead", "❌ limited by the largest node", "First choice until it no longer fits"]},
  {"icon": "📊", "title": "Data parallelism", "sub": "split the data, replicate the model", "color": "teal",
   "points": ["✅ model fits one GPU", "TorchDistributor (DDP)", "Spark or Ray for tabular work"]},
  {"icon": "🧩", "title": "Model parallelism", "sub": "split the model across devices", "color": "purple",
   "points": ["✅ model too big for one GPU", "DeepSpeed, FSDP", "❌ wrong answer when the model fits"]},
  {"icon": "☀️", "title": "Ray", "sub": "tasks and actors on Spark", "color": "amber",
   "points": ["`setup_ray_cluster(...)`", "✅ Ray Tune, Train, RL, GPU deep learning", "Spark stays better for ETL and batch scoring"]}
 ]}
```

- `applyInPandas`: one group = one pandas DataFrame on one worker, so a giant group runs out of memory.
- Distributed inference: `spark_udf` for any MLflow model, an iterator pandas UDF to load the model once per task, `mapInPandas` for flexible output.

## 🎯 Development: tuning and advanced MLflow

```viz code
title: Distributed Optuna trials, each logged as an MLflow run
lang: python
---
from mlflow.optuna.storage import MlflowStorage
from mlflow.pyspark.optuna.study import MlflowSparkStudy

storage = MlflowStorage(experiment_id=exp_id)
study = MlflowSparkStudy(study_name="xgb", storage=storage)
study.optimize(objective, n_trials=64, n_jobs=8)

with mlflow.start_run(run_name="search"):
    for params in candidates:
        with mlflow.start_run(nested=True):
            mlflow.log_params(params)
            mlflow.log_metric("cv_auc", score)
---
1-2 | Imports | Shared trial history lives in MLflow. This is the "minimal setup on an existing Spark cluster" answer.
4-5 | Study | Trials run on Spark executors. Defaults: TPE sampler, median pruner.
6 | Parallelism | More `n_jobs` is faster but less adaptive. `n_jobs = n_trials` turns Bayesian search into random search.
8-12 | Nested runs | One parent per search, one child per configuration. Query children with `tags.mlflow.parentRunId`.
```

Ray Tune (ASHA, PBT, GPU deep learning) logs with `MLflowLoggerCallback`. Hyperopt is no longer maintained. A plain `MLflowCallback` on a local study is **not** distributed.

## 🕰️ Development: features without leakage

```viz table
{"title": "Point-in-time lookup: label rows get the feature row as of their event time",
 "columns": ["customer_id", "event_ts / snapshot_ts", "row", "avg_spend_7d"],
 "rows": [[42, "2026-03-01", "feature", 120],
          [42, "2026-03-15", "feature", 310],
          [42, "2026-04-01", "feature", 95],
          [42, "2026-03-10", "label (churned=1)", null]],
 "steps": [
  {"label": "Feature table", "note": "A time-series feature table: primary key `customer_id, snapshot_ts` with `timeseries_columns=\"snapshot_ts\"`. Updates use `write_table(mode=\"merge\")`."},
  {"label": "Label arrives", "note": "The training label happened on March 10. Which feature value did the model know then?", "hl": [3]},
  {"label": "Wrong: latest value", "note": "A key-only join picks the April 1 value (95). That is **future data**: leakage.", "hl": [2]},
  {"label": "Right: as-of join", "note": "`FeatureLookup(..., timestamp_lookup_key=\"event_ts\")` takes the latest row with `snapshot_ts <= event_ts`: the March 1 value.", "hl": [0], "upd": {"3": {"avg_spend_7d": 120}}}
 ]}
```

- `fe.log_model(..., training_set=...)` packages the lookups, so scoring and serving fetch features automatically. `mlflow.sklearn.log_model` does not.
- Online: the Lakebase-backed **Online Feature Store** (`fe.create_online_store`, `fe.publish_table`) replaces legacy online tables. Needs a primary key and Change Data Feed. Sync modes: snapshot, triggered, continuous.
- On-demand features: `FeatureFunction` on a Unity Catalog Python function, so training and serving run the same logic. Custom PyFunc models can also compute features from raw input inside `predict`.

## 🔁 MLOps: lifecycle, environments and bundles

```viz flow
{"title": "Deploy code: the training code is promoted, the model is trained in prod",
 "nodes": [
  {"icon": "💻", "title": "Dev", "sub": "branches, sampled data", "color": "blue"},
  {"icon": "🧪", "title": "Staging", "sub": "CI, integration tests", "color": "amber"},
  {"icon": "🏭", "title": "Prod", "sub": "bundle deploy as service principal", "color": "green"},
  {"icon": "🏷️", "title": "Models in UC", "sub": "versions + aliases", "color": "purple"},
  {"icon": "🚀", "title": "Serving", "sub": "pinned to @champion", "color": "teal"}],
 "edges": ["merge", "release", "train, validate", "alias"],
 "steps": [
  {"label": "Dev", "focus": [0], "note": "Experiments in a dev catalog. Unit tests on small DataFrames. Nothing here touches prod tables."},
  {"label": "Staging", "focus": [1], "note": "CI runs unit tests, `bundle validate`, then the full pipeline on test data as an **integration test**."},
  {"label": "Prod", "focus": [2], "note": "`bundle deploy -t prod` from CI as a service principal. The training job runs on prod data."},
  {"label": "Registry", "focus": [3], "note": "Versions are immutable, aliases move. No stages in Unity Catalog. An MLflow 3 deployment job can evaluate, approve and deploy each new version."},
  {"label": "Serve", "focus": [4], "note": "Consumers load `models:/prod.ml.churn@champion`, never \"latest version\"."}]}
```

Bundles (Declarative Automation Bundles, formerly Databricks Asset Bundles) define `experiments`, `registered_models`, `model_serving_endpoints`, `jobs` and `quality_monitors`, with one target and one catalog per environment.

## 🧪 MLOps: testing and retraining

| Topic | What the exam expects |
|---|---|
| Code layout | `.py` modules + pytest: importable and CI-friendly. `%run` has side effects, a wheel adds a build step |
| Tests per stage | Dev and CI: unit. Staging: integration and load. Prod: validation gates, smoke, monitoring |
| Retraining triggers | Schedule, table update, **drift alert**, **performance alert** from inference table + labels |
| Champion vs challenger | Same recent evaluation data, guardrails, then promote the alias through a gate |
| Selection metric | Probabilities drive actions: log loss. Rare positives: PR AUC. Big errors costly: RMSE. Outliers: MAE |

Integration tests cover the chain: features, training, evaluation, deployment (endpoint READY), inference.

## 📈 MLOps: drift and endpoint health

| Need | Answer |
|---|---|
| Profile type | Snapshot (whole table), TimeSeries (per window), InferenceLog (predictions, quality, fairness) |
| Numeric drift | `ks_test`, `wasserstein_distance`, `population_stability_index` (≥ 0.2 significant) |
| Categorical drift | `chi_squared_test`, `js_distance`, `tv_distance`, `l_infinity_distance` |
| Gradual vs sudden | `drift_type` BASELINE (vs known-good table) vs CONSECUTIVE (vs previous window) |
| Endpoint health | Latency, request rate, 4xx (client), 5xx (server), CPU, memory: metrics tab and export |

Lakehouse Monitoring is now called **data profiling**; the `_profile_metrics` and `_drift_metrics` tables and `w.quality_monitors` are unchanged. Alert with a SQL alert on the drift table. Quality metrics need a `label_col`. Custom metrics: aggregate, derived, drift.

## 🚀 Deployment: rollouts and custom models

| Strategy | Use when |
|---|---|
| Blue-green | Full switch with instant rollback |
| Canary | High-traffic, critical: 5 → 25 → 50 → 100% with monitoring |
| A/B | Fixed split to compare a business metric |
| Shadow | Copy of traffic, responses unused: zero-risk validation, no business impact measured |

- Traffic splits live in `served_entities` + `traffic_config`; `update_endpoint` is zero-downtime. Rollback = challenger to 0%.
- Custom PyFunc: load artifacts in `load_context`, not `predict`. A signature is required in Unity Catalog.
- Query: `POST /serving-endpoints/<name>/invocations` with `dataframe_split` or `dataframe_records`, or `get_deploy_client("databricks").predict(...)`.

## 🪤 Typical traps

- ❌ Joining labels to the latest feature values. ✅ Use `timestamp_lookup_key` for an as-of join.
- ❌ KS test on a categorical column. ✅ Chi-squared or a distance such as JS or TV.
- ❌ Declaring drift from a tiny p-value on 50 million rows. ✅ Check an effect size (PSI, Wasserstein) too.
- ❌ Pinning serving to "latest version" or using stages. ✅ Aliases such as `@champion` in Unity Catalog.
- ❌ Model parallelism when the model fits one GPU, or Ray when the scenario says "minimal setup" with Optuna.
- ❌ Scale-to-zero on a latency-critical endpoint, or shadow mode to measure business impact.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks to exam day",
 "items": [
  {"label": "Days 1-3", "title": "Foundations", "color": "navy", "note": "Refresh **MLflow tracking**, **Models in Unity Catalog** and **The ML lifecycle on Databricks**. Read the official exam guide objectives."},
  {"label": "Days 4-7", "title": "Development", "color": "blue", "note": "SparkML pipelines and evaluators, pandas Function APIs, then **Hyperparameter tuning** (Optuna, Ray Tune). Review **How Spark runs your code**."},
  {"label": "Days 8-10", "title": "Features", "color": "teal", "note": "**Feature engineering in Unity Catalog**: time-series keys, point-in-time lookups, online store, FeatureFunction."},
  {"label": "Days 11-14", "title": "MLOps", "color": "purple", "note": "**Bundles and CI/CD**, **Lakeflow Jobs**, testing per stage, retraining and selection metrics."},
  {"label": "Days 15-17", "title": "Monitor and deploy", "color": "amber", "note": "**Monitoring models and drift** and **Model serving**: drift tests, inference tables, traffic splits, custom PyFunc."},
  {"label": "Days 18-21", "title": "Timed practice", "color": "green", "note": "Full timed practice exams (59 questions, 120 minutes). Review **every** wrong answer and the domain it came from."}
 ]}
```

## 🧭 Exam-day checklist

| Do | Why |
|---|---|
| Budget about 2 minutes per question | 120 minutes for 59 scored plus unscored items |
| Read the last sentence first, then underline the constraint | Long scenarios hide one deciding requirement |
| Eliminate options that add tools the scenario did not ask for | "Minimal setup" usually wins |
| Flag and move on after 3 minutes | Come back with fresh eyes at the end |
| Check numeric vs categorical, batch vs real time | These flip the right answer most often |
