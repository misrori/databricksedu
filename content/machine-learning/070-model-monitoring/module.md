---
title: Monitoring models and drift
summary: Learn why a good model gets worse, tell data drift from concept drift, compute PSI and a KS test yourself, and see how data profiling turns an inference table into drift metrics, alerts and retraining.
icon: 📡
level: Intermediate
minutes: 11
group: Deployment
tags: [Drift, PSI, Lakehouse Monitoring, Data profiling]
---
# Monitoring models and drift

> A churn model trained in spring is evaluated on spring customers. By autumn, prices, competitors and customer habits have moved. The code has not changed, but the world the model predicts has.

**The one idea to remember:** compare **what the model sees now** with **what it was trained on**, window by window. Input drift warns you early; falling accuracy, once labels arrive, confirms the damage.

## 📉 Why models decay

```viz timeline
{"title": "recall of the churn model, month by month (illustrative)",
 "items": [
  {"label": "Apr", "title": "recall 0.71", "color": "green", "note": "Deployed. Validation recall was 0.72, production matches it."},
  {"label": "May", "title": "recall 0.70", "color": "green", "note": "Normal noise. Input distributions match the training data."},
  {"label": "Jun", "title": "recall 0.69", "color": "green", "note": "A new mobile app launches. `has_app` and `avg_weekly_minutes` start to shift. Inputs drift, accuracy holds for now."},
  {"label": "Jul", "title": "recall 0.62", "color": "amber", "note": "A competitor offers cheap monthly contracts. Customers with few support calls now leave too: the link between features and churn has changed. That is **concept drift**."},
  {"label": "Aug", "title": "recall 0.55", "color": "red", "note": "Labels for July arrive and confirm the drop. The drift alert fired weeks ago, on inputs alone."},
  {"label": "Sep", "title": "recall 0.70", "color": "blue", "note": "The retraining job trains on recent data, the challenger beats the champion on the same window, and the alias moves."}
 ]}
```

## 🧭 Four kinds of change

```viz compare
{"items": [
 {"icon": "📦", "title": "Data drift", "sub": "P(X) changes", "color": "blue",
  "points": ["Inputs shift: more support calls, younger customers", "Detectable without labels", "May or may not hurt the model"]},
 {"icon": "🧠", "title": "Concept drift", "sub": "P(y | X) changes", "color": "red",
  "points": ["Same inputs, different outcome", "Needs labels to see", "Always means retraining"]},
 {"icon": "🏷️", "title": "Label drift", "sub": "P(y) changes", "color": "amber",
  "points": ["The churn rate itself moves, 27 % to 35 %", "Thresholds and precision change", "Watch the prediction distribution too"]},
 {"icon": "🔧", "title": "Training-serving skew", "sub": "a bug, not the world", "color": "gray",
  "points": ["A feature computed differently in production", "Visible from day one", "Fix with shared feature tables or a pyfunc"]}
 ]}
```

## 📏 Which test for which column

| Column type | Test or distance | Read it as |
|---|---|---|
| Numeric | **KS test** (two-sample Kolmogorov-Smirnov) | Small p-value: the distributions differ |
| Numeric | **PSI**, Wasserstein distance | Size of the shift. PSI < 0.1 small, 0.1 to 0.2 moderate, ≥ 0.2 significant |
| Categorical | **Chi-square test** | Small p-value: category frequencies changed |
| Categorical | **Jensen-Shannon distance**, total variation | 0 = same distribution, larger = more change |

With many rows, p-values become tiny even for harmless shifts. Look at the **size** of the change (PSI, distance) and set business thresholds, not only significance.

## 🧮 PSI, one bin at a time

PSI bins the feature using the baseline, then compares the share of rows per bin: **PSI = Σ (current% − baseline%) × ln(current% / baseline%)**.

```viz table
{"title": "support_calls_90d: training baseline vs this month", "columns": ["bin", "baseline %", "current %", "contribution"],
 "rows": [["0 calls", 36.8, 22.0, ""], ["1-2", 23.6, 24.0, ""], ["3-4", 16.0, 20.0, ""], ["5-6", 12.4, 17.0, ""], ["7+", 11.2, 17.0, ""]],
 "steps": [
  {"label": "Two histograms", "note": "Same bins, two samples. Each column of percentages sums to 100."},
  {"label": "The biggest move", "note": "(0.220 − 0.368) × ln(0.220 / 0.368) = 0.076. Both factors are negative, so every contribution is positive.", "upd": {"0": {"contribution": 0.076}}, "hl": [0]},
  {"label": "Almost no change", "note": "23.6 % vs 24.0 % adds almost nothing.", "upd": {"1": {"contribution": 0.0001}}, "hl": [1]},
  {"label": "The tail grows", "note": "More customers in the high-call bins: the service got worse.", "upd": {"2": {"contribution": 0.009}, "3": {"contribution": 0.015}, "4": {"contribution": 0.024}}, "hl": [2, 3, 4]},
  {"label": "Sum", "note": "PSI = 0.123: a **moderate** shift. A bin with 0 % would make the log infinite, so implementations clip shares to a small minimum."}
 ]}
```

## 🔭 Data profiling (Lakehouse Monitoring)

**Data profiling** (formerly Lakehouse Monitoring) attaches a monitor to a Unity Catalog table and computes these metrics on each refresh.

| Profile type | Table holds | Use for |
|---|---|---|
| **Snapshot** | The current state, no time column | Feature or reference tables |
| **TimeSeries** | Rows with a timestamp, metrics per window | Event data, drift between windows |
| **InferenceLog** | Features, prediction, label, model id, timestamp | Model monitoring: drift plus accuracy, F1, ROC AUC per window and model version |

Each refresh writes two Delta tables, `<table>_profile_metrics` (counts, nulls, mean, quantiles, model quality) and `<table>_drift_metrics` (KS, PSI, chi-square, JS distance), plus a **dashboard**. Drift is measured against the **previous window** (`CONSECUTIVE`) and, if you give one, a **baseline table** such as the training data (`BASELINE`). Slicing expressions like `contract` repeat every metric per segment.

## 🔁 From inference table to retraining

```viz flow
{"nodes": [
  {"icon": "🗄️", "title": "Inference table", "sub": "requests, predictions, labels", "color": "blue"},
  {"icon": "🔭", "title": "Monitor", "sub": "InferenceLog profile", "color": "purple"},
  {"icon": "📋", "title": "Metric tables", "sub": "profile + drift", "color": "navy"},
  {"icon": "🚨", "title": "SQL alert", "sub": "PSI ≥ 0.2, recall < 0.6", "color": "red"},
  {"icon": "⏱️", "title": "Retraining job", "sub": "Lakeflow Job", "color": "green"}
 ],
 "edges": ["refresh", "writes", "query", "triggers"],
 "steps": [
  {"label": "Collect", "focus": [0], "note": "The endpoint's inference table, or a batch scoring table, holds features and predictions. A job joins the true labels when they arrive, often weeks later."},
  {"label": "Profile", "focus": [1], "note": "A scheduled refresh computes metrics per time window, per model version and per slice."},
  {"label": "Store", "focus": [2], "note": "Metrics are rows in Delta tables, so you can query them with SQL like any other table."},
  {"label": "Alert", "focus": [3], "note": "A SQL alert checks a condition on the drift or profile metrics table after each refresh and notifies the team."},
  {"label": "Retrain", "focus": [4, 0], "note": "The alert starts a job that trains a challenger on recent data, compares it with the champion on the same window, and moves `@champion` only if it wins."}
 ]}
```

```python
# Display-only: needs MANAGE on the table and creates serverless jobs and a dashboard
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.catalog import MonitorInferenceLog, MonitorInferenceLogProblemType
WorkspaceClient().quality_monitors.create(
    table_name=f"{CATALOG}.{SCHEMA}.churn_inference", output_schema_name=f"{CATALOG}.{SCHEMA}",
    assets_dir="/Workspace/Users/you/monitors/churn", baseline_table_name=f"{CATALOG}.{SCHEMA}.churn_baseline",
    inference_log=MonitorInferenceLog(problem_type=MonitorInferenceLogProblemType.PROBLEM_TYPE_CLASSIFICATION,
        prediction_col="prediction", label_col="churned", model_id_col="model_version",
        timestamp_col="ts", granularities=["1 day"]))
```

## 🧪 Try it: compute drift yourself

```dataset churn
```

```python run
# Split subscribers into a baseline and a shifted "current" sample
import numpy as np
import pandas as pd

pdf = spark.table("subscribers").toPandas()
baseline = pdf[pdf["subscriber_id"] % 2 == 0]
current = pdf[pdf["subscriber_id"] % 2 == 1].copy()
current["support_calls_90d"] = current["support_calls_90d"] + 2      # simulate a service problem
print(len(baseline), "baseline rows,", len(current), "current rows")
print(baseline["support_calls_90d"].mean().round(2), "->", current["support_calls_90d"].mean().round(2))
```

```python run
# PSI per bin, then the total
def psi_table(base, cur, edges, labels):
    b = np.histogram(base, edges)[0] / len(base)
    c = np.histogram(cur, edges)[0] / len(cur)
    b, c = np.clip(b, 1e-4, None), np.clip(c, 1e-4, None)          # avoid log(0)
    return pd.DataFrame({"bin": labels, "baseline_pct": (100 * b).round(1),
                         "current_pct": (100 * c).round(1), "contribution": ((c - b) * np.log(c / b)).round(4)})

edges = [-np.inf, 1, 3, 5, 7, np.inf]                               # 0 | 1-2 | 3-4 | 5-6 | 7+
t = psi_table(baseline["support_calls_90d"], current["support_calls_90d"], edges, ["0", "1-2", "3-4", "5-6", "7+"])
display(t)
print("PSI support_calls_90d =", round(t["contribution"].sum(), 3))

q = np.unique(np.quantile(baseline["tenure_months"], np.linspace(0, 1, 11)))   # deciles of an unshifted feature
q[0], q[-1] = -np.inf, np.inf
t2 = psi_table(baseline["tenure_months"], current["tenure_months"], q, list(range(len(q) - 1)))
print("PSI tenure_months     =", round(t2["contribution"].sum(), 3))
```

```python run
# Two-sample KS test for numeric columns
from scipy.stats import ks_2samp

for col in ["support_calls_90d", "tenure_months", "avg_weekly_minutes"]:
    r = ks_2samp(baseline[col], current[col])
    print(f"{col:<20} KS statistic {r.statistic:.3f}   p-value {r.pvalue:.2g}")
```

> Creating a monitor is display-only here: it needs `MANAGE` on the table (or ownership), and every refresh runs serverless jobs that take minutes and cost money. The metrics above are the same ones it computes.

## Exercise 1: a categorical feature

Build a current sample where **Monthly** contracts are over-represented (add the Monthly rows twice). Measure the change in `contract`. **Predict first:** why is the KS test the wrong tool here?

```python todo
# TODO 1: baseline = even subscriber_id; current = odd ids plus their Monthly rows again
# TODO 2: chi-square test on a crosstab of sample vs contract (scipy.stats.chi2_contingency)
# TODO 3: Jensen-Shannon distance of the two contract distributions (scipy.spatial.distance.jensenshannon, base=2)
```

```python solution
import pandas as pd
from scipy.stats import chi2_contingency
from scipy.spatial.distance import jensenshannon

pdf = spark.table("subscribers").toPandas()
baseline = pdf[pdf["subscriber_id"] % 2 == 0]
odd = pdf[pdf["subscriber_id"] % 2 == 1]
current = pd.concat([odd, odd[odd["contract"] == "Monthly"]])

both = pd.concat([baseline.assign(sample="baseline"), current.assign(sample="current")])
table = pd.crosstab(both["sample"], both["contract"])
chi2, p, dof, _ = chi2_contingency(table)
print(table, f"\nchi2 = {chi2:.1f}, p-value = {p:.2g}")

shares = table.div(table.sum(axis=1), axis=0)
print("JS distance =", round(float(jensenshannon(shares.loc["baseline"], shares.loc["current"], base=2)), 3))
# Contract values have no order, so there is no cumulative distribution for KS to compare.
```

## Exercise 2: drift hidden in one segment

Add 4 support calls only for current subscribers in region **North**. Compute PSI for the whole sample and per region. **Predict first:** which number is larger?

```python todo
# TODO 1: current = odd ids; support_calls_90d + 4 where region == 'North'
# TODO 2: PSI over the 5 bins from the lecture, for all rows and then per region
```

```python solution
import numpy as np
import pandas as pd

def psi(base, cur, edges=(-np.inf, 1, 3, 5, 7, np.inf)):
    b = np.clip(np.histogram(base, edges)[0] / len(base), 1e-4, None)
    c = np.clip(np.histogram(cur, edges)[0] / len(cur), 1e-4, None)
    return float(np.sum((c - b) * np.log(c / b)))

pdf = spark.table("subscribers").toPandas()
baseline = pdf[pdf["subscriber_id"] % 2 == 0]
current = pdf[pdf["subscriber_id"] % 2 == 1].copy()
current.loc[current["region"] == "North", "support_calls_90d"] += 4

print("all rows", round(psi(baseline["support_calls_90d"], current["support_calls_90d"]), 3))
for region in sorted(pdf["region"].unique()):
    print(f"{region:<8}", round(psi(baseline.loc[baseline.region == region, "support_calls_90d"],
                                    current.loc[current.region == region, "support_calls_90d"]), 3))
# North shows a large PSI; the global number dilutes it. This is why monitors support slicing.
```

## ⚠️ Common mistakes

- ❌ A KS test on a categorical column, or chi-square on a continuous one.
- ❌ Declaring drift from a tiny p-value on millions of rows. Check the size of the shift.
- ❌ Waiting for accuracy alone. Labels often arrive weeks late; input drift warns earlier.
- ❌ A Snapshot profile for a prediction log. Use InferenceLog, with a label column for model quality.
- ❌ Retraining automatically on data that drifted because of a pipeline bug. Check data quality first.
- ✅ Monitor slices that matter to the business, not only global numbers.

## 🧭 Cheat sheet

| Question | Tool |
|---|---|
| Did a numeric input shift? | KS test, PSI, Wasserstein (`drift_metrics` table) |
| Did a categorical input shift? | Chi-square, Jensen-Shannon distance |
| Is the model still accurate? | InferenceLog profile with `label_col`, `profile_metrics` table |
| Compared with what? | `BASELINE` (training data) or `CONSECUTIVE` (previous window) |
| Who gets told? | SQL alert on the metric tables |
| What happens next? | Lakeflow Job retrains, validates the challenger, moves `@champion` |
