---
title: Feature engineering in Unity Catalog
summary: Store features once in Unity Catalog tables with a primary key, build training sets that never see the future, and package the feature lookups with the model so scoring finds the same features.
icon: 🧮
level: Intermediate
minutes: 11
group: Features and training
tags: [Feature Engineering, Unity Catalog, Point-in-time, Leakage]
---
# Feature engineering in Unity Catalog

> Features such as "average monthly minutes" are computed from raw tables. If every notebook computes them its own way, training and scoring drift apart. A feature table computes them once and lets every model look them up by key.

**The one idea to remember:** in Unity Catalog, **any Delta table with a primary key is a feature table**. Add a time series key, and lookups return the feature values that were known **at the label's timestamp**, never later ones.

## 🗂️ A feature table is a Delta table with a key

```sql
CREATE TABLE fe_subscriber_usage (
  subscriber_id BIGINT NOT NULL,               -- primary key columns must be NOT NULL
  avg_minutes   DOUBLE,
  minutes_trend DOUBLE,
  CONSTRAINT fe_subscriber_usage_pk PRIMARY KEY (subscriber_id)
);
-- time series feature table: PRIMARY KEY (subscriber_id, feature_ts TIMESERIES)
```

- There is no special table type. The primary key says which entity a row describes.
- A **time series key** (a timestamp column in the key) keeps history: one row per subscriber per point in time.
- Because it is a UC table, it has privileges, lineage and can be found from every workspace on the metastore.
- The older workspace feature store (`FeatureStoreClient`, `hive_metastore`) is legacy.

## 🧰 The FeatureEngineeringClient

```viz code
title: databricks.feature_engineering (display-only)
lang: python
---
fe = FeatureEngineeringClient()
fe.create_table(name=T, primary_keys=["subscriber_id"], df=features_df)
fe.write_table(name=T, df=new_features_df, mode="merge")
lookups = [FeatureLookup(table_name=T, lookup_key="subscriber_id",
                         feature_names=["avg_minutes", "minutes_trend"])]
ts = fe.create_training_set(df=labels_df, feature_lookups=lookups,
                            label="churned", exclude_columns=["subscriber_id"])
pdf = ts.load_df().toPandas()
model = RandomForestClassifier().fit(pdf.drop(columns="churned"), pdf["churned"])
fe.log_model(model=model, artifact_path="model", flavor=mlflow.sklearn,
             training_set=ts, registered_model_name=MODEL)
scores = fe.score_batch(model_uri=f"models:/{MODEL}@champion", df=keys_df)
---
1-2 | create_table | Creates the Delta table `T` (a three-level name) with its primary key. SQL with a `PRIMARY KEY` constraint does the same.
3 | write_table | `merge` upserts on the key: existing keys are updated, new keys inserted, others left alone.
4-5 | FeatureLookup | Which table, which key in the label data, which columns. Add `timestamp_lookup_key` for a point-in-time join.
6-8 | training set | Your label DataFrame has only keys and the label. The client joins in the features.
10-11 | log_model | Stores the model **and** the lookup metadata, which also records lineage from feature table to model.
12 | score_batch | Needs only the keys. It looks up the features itself, the same way as in training.
```

## ⚖️ Plain join or FeatureLookup?

```viz compare
{"items": [
 {"icon": "🔗", "title": "Plain join in your notebook", "color": "gray",
  "points": ["✅ Works with any table, no extra package", "❌ Scoring code must repeat the join exactly", "❌ The model does not know where its features came from", "❌ Point-in-time logic is yours to get right"]},
 {"icon": "🧮", "title": "FeatureLookup + fe.log_model", "color": "green",
  "points": ["✅ Lookups are packaged with the model", "✅ `score_batch` and serving fetch features from keys", "✅ Lineage from feature table to model", "✅ As-of joins with `timestamp_lookup_key`"],
  "foot": "Logging with mlflow.sklearn.log_model loses the lookups"}
 ]}
```

## 🕰️ Point-in-time correctness

Subscriber 7 has a label at **2026-08-15**. The feature table holds a monthly snapshot of `avg_minutes`. Which row should training see?

```viz table
{"title": "fe_usage_ts for subscriber 7 (label at 2026-08-15)", "columns": ["feature_ts", "avg_minutes", "known on Aug 15?", "chosen by"],
 "rows": [["2026-05-31", 980, "", ""], ["2026-06-30", 955, "", ""], ["2026-07-31", 905, "", ""], ["2026-08-31", 640, "", ""], ["2026-09-30", 310, "", ""]],
 "steps": [
  {"label": "Five snapshots", "note": "One row per month, stamped with the day the value became complete: the **month end**."},
  {"label": "Join the latest", "note": "A plain join on `subscriber_id` takes the newest row: September. That value was computed **after** the label, while the customer was already leaving.", "upd": {"4": {"chosen by": "❌ latest"}}, "hl": [4]},
  {"label": "Apply the as-of rule", "note": "Only rows with `feature_ts <= label_ts` existed when the prediction would have been made.", "upd": {"0": {"known on Aug 15?": "yes"}, "1": {"known on Aug 15?": "yes"}, "2": {"known on Aug 15?": "yes"}, "3": {"known on Aug 15?": "no"}, "4": {"known on Aug 15?": "no"}}, "hl": [0, 1, 2]},
  {"label": "Pick the newest known row", "note": "The point-in-time join takes July. A `lookback_window` can also reject rows that are too old.", "upd": {"2": {"chosen by": "✅ as-of"}}, "hl": [2]},
  {"label": "Why it matters", "note": "Trained on September values, the model learns a drop that is only visible after churn starts. Validation AUC looks great; in production that signal does not exist yet. That is **leakage**."}
 ]}
```

## 🔗 From feature table to batch scores

```viz flow
{"nodes": [
  {"icon": "🗂️", "title": "Feature table", "sub": "PK + optional time key", "color": "blue"},
  {"icon": "🏷️", "title": "Training set", "sub": "labels + FeatureLookup", "color": "purple"},
  {"icon": "📦", "title": "Model in UC", "sub": "with lookup metadata", "color": "navy"},
  {"icon": "📊", "title": "score_batch", "sub": "keys in, predictions out", "color": "green"}
 ],
 "edges": ["as-of join", "fe.log_model", "@champion"],
 "steps": [
  {"label": "Compute", "focus": [0], "note": "A scheduled job refreshes features with `write_table(mode=\"merge\")` or a SQL `MERGE`."},
  {"label": "Assemble", "focus": [0, 1], "note": "`create_training_set` joins features to the label rows, as of each row's timestamp if a time key is set."},
  {"label": "Package", "focus": [2], "note": "`fe.log_model` stores which tables and columns the model needs. Unity Catalog shows the feature table in the model's lineage."},
  {"label": "Score", "focus": [3, 0], "note": "`score_batch` receives keys, looks up the current features, and appends a `prediction` column. A column you pass with a feature's name overrides the lookup."}
 ]}
```

## ⚡ Online features and on-demand features

- **Online feature store**: a low-latency copy of a feature table (Lakebase-backed; older docs say *online tables*). You publish the Delta table to it; incremental sync needs Change Data Feed. It serves the latest value per key in milliseconds.
- A model logged with `fe.log_model` and served on Model Serving looks up its features there. The request sends only the key.
- **On-demand features** are computed at request time, such as "days since signup". Define them once as a Unity Catalog Python function and reference it with `FeatureFunction`, so training and serving run the same code.

The Delta table stays the source of truth.

## 🧪 Try it: build a feature table in SQL

```dataset churn
```

```sql run
-- Usage features per subscriber, stored with a primary key
DROP TABLE IF EXISTS fe_subscriber_usage;
CREATE TABLE fe_subscriber_usage (
  subscriber_id BIGINT NOT NULL,
  avg_minutes   DOUBLE,
  minutes_trend DOUBLE,
  max_bill      DOUBLE,
  CONSTRAINT fe_subscriber_usage_pk PRIMARY KEY (subscriber_id)
) COMMENT 'Usage features per subscriber, May to Oct 2026';

INSERT INTO fe_subscriber_usage
SELECT subscriber_id,
       avg(minutes),
       avg(CASE WHEN month >= DATE'2026-09-01' THEN minutes END)
         / nullif(avg(CASE WHEN month < DATE'2026-07-01' THEN minutes END), 0) - 1,
       max(billed_amount)
FROM usage_monthly
GROUP BY subscriber_id;

SELECT * FROM fe_subscriber_usage ORDER BY subscriber_id LIMIT 5;
```

```sql run
-- Does the trend separate churners from stayers?
SELECT s.churned, count(*) AS subscribers,
       round(avg(f.avg_minutes), 1) AS avg_minutes,
       round(avg(f.minutes_trend), 3) AS avg_trend
FROM subscribers s JOIN fe_subscriber_usage f ON s.subscriber_id = f.subscriber_id
GROUP BY s.churned;
```

```python run
# Train with and without the usage features
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

pdf = spark.sql("""
  SELECT s.tenure_months, s.support_calls_90d, s.payment_failures_6m, s.monthly_fee,
         f.avg_minutes, f.minutes_trend, f.max_bill, s.churned
  FROM subscribers s JOIN fe_subscriber_usage f ON s.subscriber_id = f.subscriber_id""").toPandas().fillna(0)
base = ["tenure_months", "support_calls_90d", "payment_failures_6m", "monthly_fee"]
usage = ["avg_minutes", "minutes_trend", "max_bill"]
train, val = train_test_split(pdf, test_size=0.25, stratify=pdf["churned"], random_state=42)

for name, cols in [("base only", base), ("base + usage", base + usage)]:
    rf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=0).fit(train[cols], train["churned"])
    print(f"{name:<13} roc_auc = {roc_auc_score(val['churned'], rf.predict_proba(val[cols])[:, 1]):.3f}")
```

> The label means "cancelled in the month **after** October", and all usage rows are from May to October, so these features are known at prediction time. The `FeatureEngineeringClient` calls above are display-only: on serverless they need `%pip install databricks-feature-engineering` first, while Databricks Runtime ML includes the package.

## Exercise 1: a time series feature table

Build `fe_usage_ts` with one row per subscriber and month: the 3-month rolling average of minutes, stamped with the **month end**, and a time series primary key. Then do an as-of lookup by hand for a label on 2026-08-15.

```sql todo
-- TODO 1: create fe_usage_ts (subscriber_id, feature_ts DATE, minutes_3m) with PRIMARY KEY (subscriber_id, feature_ts TIMESERIES)
-- TODO 2: fill it from usage_monthly with a window over the last 3 months, feature_ts = last_day(month)
-- TODO 3: for each subscriber, return the newest minutes_3m with feature_ts <= DATE'2026-08-15'
```

```sql solution
DROP TABLE IF EXISTS fe_usage_ts;
CREATE TABLE fe_usage_ts (
  subscriber_id BIGINT NOT NULL,
  feature_ts    DATE NOT NULL,
  minutes_3m    DOUBLE,
  CONSTRAINT fe_usage_ts_pk PRIMARY KEY (subscriber_id, feature_ts TIMESERIES)
);
INSERT INTO fe_usage_ts
SELECT subscriber_id, last_day(month),
       avg(minutes) OVER (PARTITION BY subscriber_id ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
FROM usage_monthly;

SELECT subscriber_id, max(feature_ts) AS feature_ts, max_by(minutes_3m, feature_ts) AS minutes_3m
FROM fe_usage_ts
WHERE feature_ts <= DATE'2026-08-15'      -- every subscriber gets the July row
GROUP BY subscriber_id ORDER BY subscriber_id LIMIT 5;
```

## Exercise 2: measure the leak

Pretend the prediction is made on **2026-08-01**. Build a trend from May to July only (allowed) and one from May to October (leaks the future). **Predict first:** which scores higher, and which number would you report?

```python todo
# TODO 1: in SQL, per subscriber: trend_ok = avg(Jul) / avg(May) - 1 and trend_leak = avg(Oct) / avg(May) - 1
# TODO 2: join to subscribers and train a random forest with base features + each trend
# TODO 3: compare validation roc_auc
```

```python solution
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

pdf = spark.sql("""
  WITH u AS (
    SELECT subscriber_id,
           try_divide(max(CASE WHEN month = DATE'2026-07-01' THEN minutes END),
                      max(CASE WHEN month = DATE'2026-05-01' THEN minutes END)) - 1 AS trend_ok,
           try_divide(max(CASE WHEN month = DATE'2026-10-01' THEN minutes END),
                      max(CASE WHEN month = DATE'2026-05-01' THEN minutes END)) - 1 AS trend_leak
    FROM usage_monthly GROUP BY subscriber_id)
  SELECT s.tenure_months, s.support_calls_90d, s.payment_failures_6m, u.trend_ok, u.trend_leak, s.churned
  FROM subscribers s JOIN u ON s.subscriber_id = u.subscriber_id""").toPandas().fillna(0)
train, val = train_test_split(pdf, test_size=0.25, stratify=pdf["churned"], random_state=42)
base = ["tenure_months", "support_calls_90d", "payment_failures_6m"]
for trend in ["trend_ok", "trend_leak"]:
    cols = base + [trend]
    rf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=0).fit(train[cols], train["churned"])
    print(trend, round(roc_auc_score(val["churned"], rf.predict_proba(val[cols])[:, 1]), 3))
# trend_leak scores higher, but only trend_ok exists on 2026-08-01. Report the trend_ok number.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS fe_usage_ts")
```

## ⚠️ Common mistakes

- ❌ Joining labels to the **latest** feature values. Use a time series key and `timestamp_lookup_key`.
- ❌ Stamping a monthly aggregate with the **first** day of the month. The value is only complete at month end.
- ❌ Logging with `mlflow.sklearn.log_model` and expecting `score_batch` to find the features. Use `fe.log_model(training_set=...)`.
- ❌ `mode="overwrite"` to update a few subscribers. Use `merge`.
- ❌ `CREATE TABLE ... AS FEATURE STORE`: that syntax does not exist. A primary key is all it takes.
- ✅ Keep the Delta feature table as the source of truth and publish it for online lookups.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Make a feature table | `PRIMARY KEY (id)` constraint, or `fe.create_table(primary_keys=[...])` |
| Keep history for as-of joins | `PRIMARY KEY (id, ts TIMESERIES)`, `timeseries_columns=` |
| Upsert features | `fe.write_table(mode="merge")` or SQL `MERGE INTO` |
| Build a training set | `FeatureLookup(...)` + `fe.create_training_set(df=labels, ...)` |
| Keep lookups with the model | `fe.log_model(..., training_set=ts)` |
| Score from keys only | `fe.score_batch(model_uri, df=keys)` |
