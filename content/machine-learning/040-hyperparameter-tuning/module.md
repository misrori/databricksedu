---
title: Hyperparameter tuning
summary: Search model settings with grid, random and Bayesian methods, score each candidate with cross-validation, log every trial as a nested MLflow run, and keep the test set honest.
icon: 🎛️
level: Intermediate
minutes: 11
group: Features and training
tags: [Hyperparameters, Optuna, Cross-validation, MLflow]
---
# Hyperparameter tuning

> A random forest with 3 levels of depth and one with 12 can give very different results on the same data. Tuning is the search for good settings, and the hard part is measuring each candidate without fooling yourself.

**The one idea to remember:** every candidate is scored on **validation folds** carved out of the training data. The test set is used once, after the search, or its number means nothing.

## 🎛️ Parameters and hyperparameters

| | Parameters | Hyperparameters |
|---|---|---|
| Who sets them | Learned by `fit()` from the data | Chosen by you before `fit()` |
| Examples | Logistic regression weights, tree split points | `C`, `max_depth`, `n_estimators`, `min_samples_leaf`, learning rate |
| How to improve | More or better data | Search: try settings and compare scores |

Most hyperparameters move the model along the **bias-variance** curve. A deeper tree fits the training data better, until it starts memorising noise and the validation score drops.

## 🔍 Three ways to search

```viz compare
{"items": [
 {"icon": "🔲", "title": "Grid search", "sub": "every combination", "color": "gray",
  "points": ["✅ Simple, exhaustive, easy to parallelise", "❌ Cost is the **product** of the value counts", "❌ Spends trials on settings that do not matter"]},
 {"icon": "🎲", "title": "Random search", "sub": "samples from ranges", "color": "blue",
  "points": ["✅ Same budget covers the important parameter better", "✅ Trivially parallel", "❌ Does not learn from earlier trials"]},
 {"icon": "🧠", "title": "Bayesian (TPE)", "sub": "Optuna's default sampler", "color": "purple",
  "points": ["✅ Models score vs settings, proposes promising ones", "✅ Fewest trials for a good result", "❌ Sequential by nature: high parallelism makes it less adaptive"]}
 ]}
```

Hyperopt, used in older courses, is no longer maintained and is not included in Databricks Runtime ML after 16.4 LTS. Databricks now recommends **Optuna** for single-node models and Ray Tune for distributed work. Exams may still show Hyperopt's `fmin`.

## 🔁 The tuning loop

```viz flow
{"nodes": [
  {"icon": "🧠", "title": "Sampler", "sub": "suggests settings", "color": "purple"},
  {"icon": "🏋️", "title": "Train", "sub": "on k-1 folds", "color": "blue"},
  {"icon": "📏", "title": "Evaluate", "sub": "on the held-out fold", "color": "green"},
  {"icon": "📝", "title": "Report", "sub": "study history + MLflow run", "color": "amber"}
 ],
 "edges": ["max_depth=7, …", "model", "mean cv_auc"],
 "steps": [
  {"label": "Suggest", "focus": [0], "note": "`trial.suggest_int(\"max_depth\", 2, 12)` asks the sampler for a value. TPE starts with random trials (10 by default), then favours regions that scored well."},
  {"label": "Train", "focus": [1], "note": "The full pipeline, preprocessing included, is fitted on the training folds."},
  {"label": "Evaluate", "focus": [2], "note": "Score on the fold that was left out, repeat for each fold, and average. A **pruner** can stop a trial early if its intermediate scores are clearly worse than others."},
  {"label": "Report", "focus": [3, 0], "note": "The objective returns the score. Optuna stores it, and a nested MLflow run records the settings and the score. The sampler now knows one more point."}
 ]}
```

## 📈 Trials accumulate

```viz table
{"title": "study: maximize cv_auc (illustrative)", "columns": ["trial", "max_depth / min_leaf", "cv_auc", "best so far"],
 "rows": [[0, "3 / 40", 0.812, "0.812"]],
 "steps": [
  {"label": "Trial 0", "note": "A random first guess: shallow trees. It is the best so far because it is the only one.", "hl": [0]},
  {"label": "Trial 1", "note": "Deeper trees, small leaves. Better.", "add": [[1, "11 / 2", 0.829, "0.829"]], "hl": [1]},
  {"label": "Trial 2", "note": "Worse than trial 1, so the best-so-far column does not change.", "add": [[2, "4 / 25", 0.818, "0.829"]]},
  {"label": "Trial 3", "note": "After the start-up trials, TPE proposes values near the good region.", "add": [[3, "8 / 6", 0.836, "0.836"]], "hl": [3]},
  {"label": "Trial 4", "note": "Gains get smaller. Differences of 0.002 are often noise between folds.", "add": [[4, "9 / 8", 0.837, "0.837"]], "hl": [4]},
  {"label": "Stop", "note": "The winner was chosen **because** it scored highest on these folds, so its score is a little optimistic. Only the untouched test set gives an unbiased estimate."}
 ]}
```

## 🧩 Cross-validation: tune on folds

```viz timeline
{"title": "5-fold cross-validation of one candidate (training data only)",
 "items": [
  {"label": "Split", "title": "Hold out the test set", "color": "amber", "note": "20 % of rows go into a **test set** that the search never sees. The other 80 % are cut into 5 equal folds."},
  {"label": "Round 1", "title": "validate on fold 1", "color": "blue", "note": "Train on folds 2 to 5, score on fold 1."},
  {"label": "Round 2", "title": "validate on fold 2", "color": "blue", "note": "Train on folds 1, 3, 4, 5, score on fold 2. Preprocessing in the pipeline is refitted too."},
  {"label": "Rounds 3-5", "title": "validate on folds 3, 4, 5", "color": "blue", "note": "Each row is used for validation exactly once and for training four times."},
  {"label": "Average", "title": "one score per candidate", "color": "green", "note": "The mean of the 5 fold scores is the candidate's score. The spread shows how much of a difference is noise."},
  {"label": "Test", "title": "once, at the end", "color": "red", "note": "After the search, refit the winner on all training rows and score it on the test set. That is the number you report."}
 ]}
```

- **Models trained = combinations × folds**, plus 1 if the best setting is refitted on all training rows. A 3 × 3 grid with 5 folds is 45 fits, 46 with the refit.
- Cross-validation costs k times more than a single train-validation split. Use it for small data; use one split for large data or expensive models.

## ⚙️ Optuna with MLflow on Databricks

```python
def objective(trial):
    params = {"max_depth": trial.suggest_int("max_depth", 2, 12),
              "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 50, log=True)}
    with mlflow.start_run(nested=True):               # one child run per trial
        score = cross_val_score(make_rf(**params), X_train, y_train, cv=3, scoring="roc_auc").mean()
        mlflow.log_params(params); mlflow.log_metric("cv_roc_auc", score)
    return score

with mlflow.start_run(run_name="rf_tuning"):
    study = optuna.create_study(direction="maximize")     # TPE sampler, median pruner by default
    study.optimize(objective, n_trials=30, n_jobs=1)
```

- To run trials on several nodes, Databricks documents `MlflowSparkStudy` with `MlflowStorage`: the MLflow tracking server becomes the shared study storage.
- **Parallelism trade-off:** 30 trials with `n_jobs=30` finish fast but every trial is chosen blind, which is random search. Keep parallelism well below the trial count.

## 🧪 Try it: tune a random forest

```dataset churn
```

```python run
# Hold out a test set, then define the model factory
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import make_pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

NUM = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
CAT = ["contract", "plan"]
pdf = spark.table("subscribers").toPandas()
X_train, X_test, y_train, y_test = train_test_split(
    pdf[CAT + NUM], pdf["churned"], test_size=0.2, stratify=pdf["churned"], random_state=42)

def make_rf(n_estimators=100, max_depth=None, min_samples_leaf=1):
    prep = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CAT)], remainder="passthrough")
    return make_pipeline(prep, RandomForestClassifier(n_estimators=n_estimators, max_depth=max_depth,
                                                      min_samples_leaf=min_samples_leaf, n_jobs=-1, random_state=0))
```

```python run
# Search 12 trials: Optuna TPE if installed, otherwise random search. Each trial is a nested run.
import mlflow
from sklearn.model_selection import ParameterSampler
from scipy.stats import randint

def evaluate(params):
    score = cross_val_score(make_rf(**params), X_train, y_train, cv=3, scoring="roc_auc").mean()
    with mlflow.start_run(nested=True):
        mlflow.log_params(params)
        mlflow.log_metric("cv_roc_auc", score)
    return score

mlflow.sklearn.autolog(disable=True)
with mlflow.start_run(run_name="rf_tuning") as parent:
    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        study = optuna.create_study(direction="maximize",
                                    sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=5))
        study.optimize(lambda t: evaluate({
            "n_estimators": t.suggest_int("n_estimators", 50, 200, step=50),
            "max_depth": t.suggest_int("max_depth", 2, 12),
            "min_samples_leaf": t.suggest_int("min_samples_leaf", 1, 50, log=True)}), n_trials=12)
        method, best_params = "optuna-tpe", study.best_params
    except ImportError:
        space = {"n_estimators": [50, 100, 150, 200], "max_depth": randint(2, 13), "min_samples_leaf": randint(1, 51)}
        results = [(evaluate(p), p) for p in ParameterSampler(space, n_iter=12, random_state=42)]
        method, best_params = "random", max(results, key=lambda r: r[0])[1]
    mlflow.set_tag("search", method)
print(method, best_params)
```

```python run
# Compare the trials, then evaluate the winner once on the test set
trials = mlflow.search_runs(filter_string=f"tags.mlflow.parentRunId = '{parent.info.run_id}'",
                            order_by=["metrics.cv_roc_auc DESC"])
display(trials[["params.n_estimators", "params.max_depth", "params.min_samples_leaf", "metrics.cv_roc_auc"]])

final = make_rf(**best_params).fit(X_train, y_train)          # refit on all training rows
print("test roc_auc:", round(roc_auc_score(y_test, final.predict_proba(X_test)[:, 1]), 3))
```

## Exercise 1: count the fits

A grid of `max_depth` in [4, 8, 12] and `min_samples_leaf` in [1, 10, 50], with 5-fold cross-validation and a final refit. **Predict** the number of models trained, then check with `GridSearchCV`.

```python todo
# TODO 1: load subscribers and split off a test set
# TODO 2: GridSearchCV over a RandomForestClassifier(n_estimators=50) with cv=5, scoring="roc_auc"
# TODO 3: print the number of candidates, the fits, and best_params_
```

```python solution
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.ensemble import RandomForestClassifier

cols = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
pdf = spark.table("subscribers").toPandas()
X_tr, X_te, y_tr, y_te = train_test_split(pdf[cols], pdf["churned"], test_size=0.2, random_state=42)

grid = {"max_depth": [4, 8, 12], "min_samples_leaf": [1, 10, 50]}
gs = GridSearchCV(RandomForestClassifier(n_estimators=50, n_jobs=-1, random_state=0),
                  grid, cv=5, scoring="roc_auc").fit(X_tr, y_tr)
n = len(gs.cv_results_["params"])
print(n, "candidates,", n * 5, "fits in the search, +1 refit =", n * 5 + 1)   # 9, 45, 46
print(gs.best_params_, round(gs.best_score_, 3))
```

## Exercise 2: the winner's curse

Tune `C` of a logistic regression with random search on a log scale. Compare the best cross-validation score with the test score. **Explain** why the test score is usually a little lower.

```python todo
# TODO 1: RandomizedSearchCV(LogisticRegression(max_iter=1000), {"C": loguniform(1e-3, 1e2)}, n_iter=15, cv=5, scoring="roc_auc")
# TODO 2: print best_score_ and the roc_auc of best_estimator_ on the test set
```

```python solution
from sklearn.model_selection import train_test_split, RandomizedSearchCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from scipy.stats import loguniform

cols = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
pdf = spark.table("subscribers").toPandas()
X_tr, X_te, y_tr, y_te = train_test_split(pdf[cols], pdf["churned"], test_size=0.2, random_state=42)

rs = RandomizedSearchCV(LogisticRegression(max_iter=1000), {"C": loguniform(1e-3, 1e2)},
                        n_iter=15, cv=5, scoring="roc_auc", random_state=0).fit(X_tr, y_tr)
print("best cv:", round(rs.best_score_, 4), "C =", round(rs.best_params_["C"], 4))
print("test   :", round(roc_auc_score(y_te, rs.best_estimator_.predict_proba(X_te)[:, 1]), 4))
# The winner was picked because it scored highest on these folds, partly by luck.
# The test set played no part in the choice, so its score is the unbiased one.
```

## ⚠️ Common mistakes

- ❌ Tuning on the test set. Then the test score is just another validation score.
- ❌ Fitting preprocessing before cross-validation. Put it in the pipeline so each fold refits it.
- ❌ Treating a 0.002 gain as real. Look at the spread between folds.
- ❌ `n_jobs` equal to `n_trials` for Bayesian search. It degrades into random search.
- ❌ Starting new work on Hyperopt. Use Optuna, or Ray Tune for distributed training.
- ✅ Log every trial as a nested run, so the search and its winner stay together in MLflow.

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Few parameters, small value lists | Grid search (`GridSearchCV`) |
| Many parameters, fixed budget | Random search (`RandomizedSearchCV`) |
| Fewest trials for a good result | Optuna, TPE sampler, `direction="maximize"` |
| Stop weak trials early | `trial.report(score, step)` + `trial.should_prune()` |
| Trials across nodes | `MlflowSparkStudy` + `MlflowStorage` |
| Count the fits | combinations × folds (+ 1 refit) |
