---
title: The ML lifecycle on Databricks
summary: Follow one churn model from raw table to monitored prediction. Learn which Databricks component handles each step, how to split data without leakage, and which metric to trust when classes are imbalanced.
icon: 🔁
level: Beginner
minutes: 10
group: Foundations
tags: [MLOps, MLflow, Evaluation, Unity Catalog]
---
# The ML lifecycle on Databricks

> A model is not a file you train once. It is a loop: data becomes features, features become a model, the model makes predictions, and the predictions tell you when to train again.

**The one idea to remember:** every step of the loop leaves a governed artifact in Unity Catalog or MLflow, so you can always answer *which data and which code produced this prediction*.

## 🔁 The loop

```viz flow
{"title": "One churn model, from table to retraining",
 "nodes": [
  {"icon": "🗄️", "title": "Data and features", "sub": "Delta tables in UC", "color": "blue"},
  {"icon": "🏋️", "title": "Train and evaluate", "sub": "MLflow runs", "color": "purple"},
  {"icon": "📦", "title": "Register", "sub": "Models in UC", "color": "navy"},
  {"icon": "🚀", "title": "Deploy", "sub": "batch job or endpoint", "color": "green"},
  {"icon": "📈", "title": "Monitor", "sub": "data profiling", "color": "amber"}
 ],
 "edges": ["training set", "best run", "@champion", "predictions"],
 "steps": [
  {"label": "Data", "focus": [0], "note": "Raw subscriber and usage data lands in **Delta tables** governed by Unity Catalog. Lakeflow pipelines or jobs keep them fresh."},
  {"label": "Features", "focus": [0], "note": "Columns the model can learn from are computed once and stored in **feature tables**: Delta tables with a primary key."},
  {"label": "Training", "focus": [1], "note": "Each training attempt is an **MLflow run** that records parameters, metrics and the model artifact."},
  {"label": "Evaluation", "focus": [1], "note": "Metrics are computed on rows the model never saw during training. The best run is the candidate."},
  {"label": "Registration", "focus": [2], "note": "The candidate becomes a **version** of a registered model, `catalog.schema.churn_model`. An alias such as `@champion` marks the one in use."},
  {"label": "Deployment", "focus": [3], "note": "A scheduled batch job scores all subscribers, or a **Model Serving** endpoint answers one request at a time."},
  {"label": "Monitoring", "focus": [4], "note": "Predictions and, later, true labels are profiled over time. Drift or falling accuracy raises an alert."},
  {"label": "Retraining", "focus": [4, 0, 1], "note": "A **Lakeflow Job** reruns the same training code on fresh data. The loop starts again, and a new version can replace the champion."}
 ]}
```

## 🧱 Which component does what

```viz layers
{"layers": [
  {"icon": "⏱️", "title": "Lakeflow Jobs", "sub": "orchestration", "color": "gray", "items": ["scheduled retraining", "batch scoring", "triggers from alerts"]},
  {"icon": "📈", "title": "Data profiling (Lakehouse Monitoring)", "sub": "watch production", "color": "amber", "items": ["drift metrics", "model quality over time"]},
  {"icon": "🚀", "title": "Mosaic AI Model Serving", "sub": "real-time inference", "color": "green", "items": ["REST endpoints", "inference tables"]},
  {"icon": "📦", "title": "Models in Unity Catalog", "sub": "registry", "color": "navy", "items": ["versions", "aliases", "lineage"]},
  {"icon": "🧪", "title": "MLflow tracking", "sub": "experiments", "color": "purple", "items": ["runs", "params, metrics", "artifacts"]},
  {"icon": "🗄️", "title": "Delta tables and Feature Engineering in UC", "sub": "data", "color": "blue", "items": ["tables", "feature tables", "volumes"]}
 ]}
```

Unity Catalog sits under all of it: tables, feature tables, models and endpoints share one permission model and one lineage graph.

## 🖥️ Where the code runs

```viz compare
{"items": [
 {"icon": "🧰", "title": "Databricks Runtime for ML", "sub": "a classic cluster image", "color": "purple",
  "points": ["✅ ML libraries preinstalled and tested together (scikit-learn, XGBoost, PyTorch, MLflow, Optuna)", "✅ GPU variants", "✅ Feature Engineering client included", "❌ You size the cluster and wait for it to start"],
  "foot": "Use dedicated access mode for AutoML"},
 {"icon": "⚡", "title": "Serverless notebook", "sub": "no cluster to manage", "color": "teal",
  "points": ["✅ Starts in seconds", "✅ pandas, scikit-learn and MLflow are available", "❌ Extra packages come from `%pip install` or the environment panel", "neutral: good for small models like the one in this module"]}
 ]}
```

MLflow works on both. The ML runtime saves setup work; it does not make training faster by itself.

## ✂️ Split before you look

Training on all rows and then measuring on the same rows tells you how well the model **memorises**, not how well it predicts. So split once, at the start:

| Split | Share | Used for |
|---|---|---|
| **Train** | 60 % | Fitting the model |
| **Validation** | 20 % | Comparing models and choosing settings |
| **Test** | 20 % | One final, honest number at the very end |

Use a **stratified** split for a label like `churned`, so each part has the same churn rate. For data with a time order, split by time instead: train on the past, test on the most recent period.

## 🚰 Leakage ruins evaluation

**Leakage** means the model sees information during training that it will not have at prediction time. The metrics look great, and production results do not.

- ❌ A feature computed **after** the label date, such as "minutes used in the month after cancelling".
- ❌ Scaling or encoding fitted on **all** rows, so statistics of the test rows flow into training.
- ❌ The same subscriber appearing in both train and test.
- ✅ Put preprocessing **inside** the model pipeline, so it is fitted on training rows only.
- ✅ Build features only from data available at the prediction moment.

## 🎯 From predictions to a confusion matrix

A classifier outputs a probability. A **threshold** (0.5 by default) turns it into a yes or no, and comparing that with the truth puts each row in one cell.

```viz table
{"title": "validation rows, threshold 0.5", "columns": ["id", "p(churn)", "actual", "cell"],
 "rows": [[101, 0.91, 1, "?"], [102, 0.12, 0, "?"], [103, 0.64, 0, "?"], [104, 0.33, 1, "?"], [105, 0.05, 0, "?"], [106, 0.78, 1, "?"], [107, 0.41, 0, "?"], [108, 0.22, 0, "?"]],
 "steps": [
  {"label": "Predictions", "note": "Each row has a probability and the true label. Rows with p ≥ 0.5 are predicted as churners."},
  {"label": "True positives", "note": "Predicted churn, really churned. These are the customers a retention call would save.", "upd": {"0": {"cell": "TP"}, "5": {"cell": "TP"}}, "hl": [0, 5]},
  {"label": "False positive", "note": "Predicted churn, but the customer stayed. A wasted retention offer.", "upd": {"2": {"cell": "FP"}}, "hl": [2]},
  {"label": "False negative", "note": "Predicted stay, but the customer left. The most expensive mistake for a churn model.", "upd": {"3": {"cell": "FN"}}, "hl": [3]},
  {"label": "True negatives", "note": "Predicted stay, really stayed.", "upd": {"1": {"cell": "TN"}, "4": {"cell": "TN"}, "6": {"cell": "TN"}, "7": {"cell": "TN"}}, "hl": [1, 4, 6, 7]},
  {"label": "Count the cells", "note": "TP 2, FP 1, FN 1, TN 4. Accuracy = 6/8 = 0.75, precision = 2/3, recall = 2/3. Every metric on the next slide is built from these four counts."}
 ]}
```

## 📏 Which metric to trust

| Metric | Formula | Answers |
|---|---|---|
| **Accuracy** | (TP + TN) / all | How often is the model right? |
| **Precision** | TP / (TP + FP) | Of those we flag, how many really churn? |
| **Recall** | TP / (TP + FN) | Of those who churn, how many do we catch? |
| **F1** | 2·P·R / (P + R) | One number that balances precision and recall |
| **ROC AUC** | area under the ROC curve | How well churners are ranked above stayers, over all thresholds (0.5 = random) |

**When accuracy lies:** about 27 % of the subscribers in this dataset churn. A model that predicts "nobody churns" is 73 % accurate and catches zero churners. For imbalanced labels, report recall, precision, F1 or AUC next to accuracy.

## 🧪 Try it: split, train, evaluate

```dataset churn
```

```python run
# Load the subscribers and split them 60 / 20 / 20
from sklearn.model_selection import train_test_split

pdf = spark.table("subscribers").toPandas()
FEATURES = ["contract", "plan", "tenure_months", "monthly_fee",
            "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
X, y = pdf[FEATURES], pdf["churned"]

X_train, X_tmp, y_train, y_tmp = train_test_split(X, y, test_size=0.4, stratify=y, random_state=42)
X_val, X_test, y_val, y_test = train_test_split(X_tmp, y_tmp, test_size=0.5, stratify=y_tmp, random_state=42)
print(len(X_train), len(X_val), len(X_test), "rows. Churn rate:", round(y.mean(), 3))
```

```python run
# Train a logistic regression; preprocessing is part of the model
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression

prep = ColumnTransformer([
    ("cat", OneHotEncoder(handle_unknown="ignore"), ["contract", "plan"]),
    ("num", StandardScaler(), FEATURES[2:]),
])
model = make_pipeline(prep, LogisticRegression(max_iter=1000))
model.fit(X_train, y_train)   # the scaler only sees training rows
```

```python run
# Evaluate on the validation rows
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                             f1_score, roc_auc_score, confusion_matrix)

proba = model.predict_proba(X_val)[:, 1]
pred = (proba >= 0.5).astype(int)
print("accuracy ", round(accuracy_score(y_val, pred), 3))
print("precision", round(precision_score(y_val, pred), 3))
print("recall   ", round(recall_score(y_val, pred), 3))
print("f1       ", round(f1_score(y_val, pred), 3))
print("roc_auc  ", round(roc_auc_score(y_val, proba), 3))
print(confusion_matrix(y_val, pred))   # [[TN, FP], [FN, TP]]
```

> The test rows (`X_test`) are not used here on purpose. You touch them once, after all choices are made.

## Exercise 1: the lazy baseline

Before you trust a model, compare it with a model that learns nothing. Predict that **nobody** churns. Which metrics look fine, and which expose it?

```python todo
# TODO 1: load subscribers and make the same stratified 60 / 20 / 20 split
# TODO 2: fit sklearn.dummy.DummyClassifier(strategy="most_frequent")
# TODO 3: print accuracy and recall on the validation rows
```

```python solution
from sklearn.model_selection import train_test_split
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, recall_score

pdf = spark.table("subscribers").toPandas()
X, y = pdf[["tenure_months", "support_calls_90d"]], pdf["churned"]
X_train, X_tmp, y_train, y_tmp = train_test_split(X, y, test_size=0.4, stratify=y, random_state=42)
X_val, X_test, y_val, y_test = train_test_split(X_tmp, y_tmp, test_size=0.5, stratify=y_tmp, random_state=42)

pred = DummyClassifier(strategy="most_frequent").fit(X_train, y_train).predict(X_val)
print("accuracy", accuracy_score(y_val, pred))   # about 0.73: looks respectable
print("recall  ", recall_score(y_val, pred))     # 0.0: it never finds a churner
```

## Exercise 2: move the threshold

Retention calls are cheap, missing a churner is expensive. Lower the threshold from 0.5 to 0.3. **Predict first:** which of precision and recall goes up?

```python todo
# TODO 1: train the logistic regression pipeline from the lecture on the training rows
# TODO 2: for thresholds 0.3, 0.5 and 0.7, print precision and recall on the validation rows
```

```python solution
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_score, recall_score

pdf = spark.table("subscribers").toPandas()
num = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
X, y = pdf[["contract", "plan"] + num], pdf["churned"]
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

prep = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), ["contract", "plan"]),
                          ("num", StandardScaler(), num)])
model = make_pipeline(prep, LogisticRegression(max_iter=1000)).fit(X_train, y_train)
proba = model.predict_proba(X_val)[:, 1]
for t in [0.3, 0.5, 0.7]:
    pred = (proba >= t).astype(int)
    print(t, "precision", round(precision_score(y_val, pred), 3), "recall", round(recall_score(y_val, pred), 3))
# Lower threshold: more rows flagged, recall rises, precision falls. ROC AUC does not change.
```

## ⚠️ Common mistakes

- ❌ Reporting accuracy alone on an imbalanced label. A do-nothing model can score 73 %.
- ❌ Tuning on the test set. Then the test number is no longer honest; use the validation set.
- ❌ Fitting a scaler or encoder on all rows before splitting.
- ❌ "MLflow needs the ML runtime." It also works on standard runtimes and serverless.
- ✅ Keep preprocessing inside the model pipeline, so training and serving apply the same steps.
- ✅ Automate retraining with a job that runs reviewed code, instead of rerunning a notebook by hand.

## 🧭 Cheat sheet

| Step | Databricks component |
|---|---|
| Store and govern data and features | Delta tables, Feature Engineering in Unity Catalog |
| Record training attempts | MLflow tracking: experiments and runs |
| Version and promote models | Models in Unity Catalog: versions and aliases |
| Predict | Batch job with `spark_udf`, or Model Serving endpoint |
| Watch production | Data profiling (Lakehouse Monitoring), inference tables |
| Retrain on a schedule or alert | Lakeflow Jobs |
