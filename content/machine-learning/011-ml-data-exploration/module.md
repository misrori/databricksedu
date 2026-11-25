---
title: Explore and version ML data
summary: Profile a training table with display(), summary() and null counts, check the class balance, then save it as a Delta table and use its version history to get the exact same training data back later.
icon: 🔍
level: Beginner
minutes: 10
group: Data preparation
tags: [EDA, Data Profile, Class balance, Delta time travel, Reproducibility]
---
# Explore and version ML data

> Before you train anything, look at the data: how many rows, which values are missing, how the label is spread. Then store the data so you can find exactly the same rows again when someone asks how the model was trained.

**The one idea to remember:** explore before you model, and train on a **Delta table version you record**. Time travel gives you that version back, but only as long as the old files are kept.

## 🗺️ The first look at a training table

```viz flow
{"title": "From a raw table to reproducible training data",
 "nodes": [
  {"icon": "👀", "title": "Look", "sub": "display() + Data Profile", "color": "blue"},
  {"icon": "📊", "title": "Measure", "sub": "summary(), null counts", "color": "teal"},
  {"icon": "⚖️", "title": "Check the label", "sub": "class balance", "color": "amber"},
  {"icon": "💾", "title": "Save in UC", "sub": "a Delta table", "color": "navy"},
  {"icon": "🔖", "title": "Record the version", "sub": "train on vN", "color": "green"}
 ],
 "edges": ["", "", "", "every write = new version"],
 "steps": [
  {"label": "Look", "focus": [0], "note": "`display(df)` shows the rows. Its **Data Profile** tab shows a histogram, null count and distinct count for every column, without plotting code."},
  {"label": "Measure", "focus": [1], "note": "`summary()` returns count, mean, stddev, min, quartiles and max. A null count per column tells you what needs cleaning or imputing later."},
  {"label": "Check the label", "focus": [2], "note": "How many rows per class? A rare class changes how you split, sample and score the model."},
  {"label": "Save and record", "focus": [3, 4], "note": "A Delta table in Unity Catalog keeps a version per write. Note the version you train on, so the run can be repeated."}
 ]}
```

## 🧪 Try it: profile a raw extract

```dataset churn
```

`subscribers` is clean, so the first cell makes a copy with gaps in `age` and `monthly_fee`, the way raw extracts often arrive.

```sql run
-- A raw extract to explore: subscribers with some missing values
DROP TABLE IF EXISTS explore_subscribers;   -- start a fresh history at version 0
CREATE TABLE explore_subscribers AS
SELECT subscriber_id, plan, contract, region, tenure_months,
       CASE WHEN subscriber_id % 7 = 0 THEN NULL ELSE age END AS age,
       CASE WHEN subscriber_id % 23 = 0 THEN NULL ELSE monthly_fee END AS monthly_fee,
       support_calls_90d, payment_failures_6m, has_app, avg_weekly_minutes, churned
FROM subscribers;
```

```python run
# display() for the rows and the Data Profile tab, summary() for statistics
df = spark.table("explore_subscribers")
display(df)              # click + next to the result, then Data Profile
display(df.summary())    # look at the count row: age and monthly_fee have fewer values
```

## 🕳️ Count nulls and check the class balance

`summary()` counts only non-null values, so missing data hides in the `count` row. Count it directly, then look at the label.

```python run
# Nulls per column, computed by Spark on the whole table
from pyspark.sql import functions as F
display(df.select([F.sum(F.col(c).isNull().cast("int")).alias(c) for c in df.columns]))
```

```sql run
-- Class balance: rows and share per label value
SELECT churned, count(*) AS subscribers,
       round(100 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM explore_subscribers
GROUP BY churned ORDER BY churned;
```

About 27% of subscribers churned. That is **imbalanced**: a model that always says "stays" is right 73% of the time, so accuracy alone will flatter it.

## 🤖 Genie Code for EDA

Genie Code, the assistant in the notebook side panel, writes plotting and analysis code from a prompt. Good prompts name the DataFrame, the target, the columns and the charts you want.

```text
Using the Spark DataFrame `df`, aggregate in Spark and plot with matplotlib:
1. A bar chart of the `churned` column with counts and percentages.
2. A horizontal bar chart of the percentage of missing values per column.
3. Box plots of `tenure_months` and `support_calls_90d` grouped by `churned`.
Add titles and axis labels. Summarize the findings in comments.
```

> Generated code can differ between runs and can be wrong. Read it before you run it, and check one number against your own query. A prompt that converts a large table with `toPandas()` is a warning sign: aggregate in Spark first.

## 🕰️ Every write is a version

A Delta table keeps a numbered version for every write. Step through what the next cells do to `explore_subscribers`.

```viz timeline
{"title": "explore_subscribers history",
 "items": [
  {"label": "v0", "title": "CREATE TABLE AS SELECT", "color": "navy", "note": "The extract you explored. This is the version you would train on."},
  {"label": "v1", "title": "UPDATE", "color": "red", "note": "A mistake: Basic fees multiplied by 100. Anyone who reads the table now gets wrong fees."},
  {"label": "read v0", "title": "VERSION AS OF 0", "color": "blue", "note": "Reading an old version **does not change** the table. It is how you reproduce the exact training input."},
  {"label": "v2", "title": "RESTORE TO VERSION 0", "color": "green", "note": "`RESTORE` writes a **new** version with the old content. v0 and v1 stay in the history."}
 ]}
```

> Time travel is not a backup. By default `VACUUM` deletes unreferenced data files older than **7 days** (`delta.deletedFileRetentionDuration`), and the history is kept for **30 days** (`delta.logRetentionDuration`). Record the version you trained on, and save a copy of the snapshot if you need it longer.

## 🔁 Try it: break it, read the old version, restore

```sql run
-- The mistake: version 1
UPDATE explore_subscribers SET monthly_fee = monthly_fee * 100 WHERE plan = 'Basic';
DESCRIBE HISTORY explore_subscribers;
```

```sql run
-- Read version 0 next to the current table
SELECT 'v0' AS version, round(avg(monthly_fee), 2) AS avg_fee FROM explore_subscribers VERSION AS OF 0
UNION ALL
SELECT 'current', round(avg(monthly_fee), 2) FROM explore_subscribers;
```

```python run
# The same read in Python, then roll the table back and record the version
train_df = spark.read.option("versionAsOf", 0).table("explore_subscribers")
print("v0 rows:", train_df.count())
spark.sql("RESTORE TABLE explore_subscribers TO VERSION AS OF 0")
latest = spark.sql("DESCRIBE HISTORY explore_subscribers").agg(F.max("version")).first()[0]
print(f"current version: {latest}   # log it with the training run, for example as an MLflow parameter")
```

## 📡 Data profiling in Unity Catalog

Manual EDA runs once. **Data profiling** in Unity Catalog (formerly Lakehouse Monitoring) runs the same checks on a schedule and writes a profile metrics table and a drift metrics table, plus a dashboard. You set it up in Catalog Explorer: open the table, **Quality** tab, create a profile.

```viz compare
{"title": "Pick the profile type that matches the table",
 "items": [
  {"icon": "📸", "title": "Snapshot", "color": "blue", "points": ["Tables that are fully replaced, or small tables", "Statistics over the whole table on each refresh"]},
  {"icon": "📈", "title": "Time series", "color": "teal", "points": ["Growing tables with a timestamp column", "Statistics per time window: trends and drift"]},
  {"icon": "🎯", "title": "Inference", "color": "purple", "points": ["Tables of model predictions", "Prediction drift, and model quality once labels arrive"]}
 ]}
```

> Display-only in this module: creating a profile needs the right privileges on the table and starts a refresh job. The metric tables it produces are normal Unity Catalog tables you can query with SQL.

## Exercise 1: travel back by timestamp

Copy `subscribers`, then delete the churners "by mistake". **Predict first:** how many versions does the history show, and how many rows do you get when you read the table as of the timestamp of version 0?

```python todo
# TODO 1: DROP TABLE IF EXISTS explore_ex_subs, then CREATE TABLE explore_ex_subs AS SELECT * FROM subscribers
# TODO 2: DELETE the rows WHERE churned = 1
# TODO 3: from DESCRIBE HISTORY, take the timestamp of version 0 (as a string)
# TODO 4: read the table with option("timestampAsOf", ...) and compare its count with the current count
```

```python solution
spark.sql("DROP TABLE IF EXISTS explore_ex_subs")
spark.sql("CREATE TABLE explore_ex_subs AS SELECT * FROM subscribers")
spark.sql("DELETE FROM explore_ex_subs WHERE churned = 1")

hist = spark.sql("DESCRIBE HISTORY explore_ex_subs")
display(hist.select("version", "timestamp", "operation"))      # two versions: 0 and 1
ts0 = hist.where("version = 0").selectExpr("CAST(timestamp AS STRING) AS ts").first().ts
v0 = spark.read.option("timestampAsOf", ts0).table("explore_ex_subs")
print("as of v0:", v0.count(), " current:", spark.table("explore_ex_subs").count())
# 5,000 rows at version 0; about 3,650 now, because about 27% of subscribers churned
```

## Exercise 2: what does imbalance hide?

**Predict first:** which contract type has the highest churn rate, and what accuracy would a model get that always predicts `0`? Check both with one query.

```sql todo
-- TODO: per contract: subscribers, churners, churn rate, and the accuracy of always predicting 0
```

```sql solution
SELECT contract, count(*) AS subscribers, sum(churned) AS churners,
       round(avg(churned), 3) AS churn_rate,
       round(1 - avg(churned), 3) AS accuracy_if_always_0
FROM subscribers
GROUP BY contract ORDER BY churn_rate DESC;
-- Monthly contracts churn most. On Two year contracts "always 0" is very accurate and completely useless,
-- so look at per-class metrics (precision, recall) and keep the class ratio when you split.

-- Clean up when you are done
-- DROP TABLE IF EXISTS explore_ex_subs;
-- DROP TABLE IF EXISTS explore_subscribers;
```

## ⚠️ Common mistakes

- ❌ Reading null counts from the `count` row of `summary()` without comparing it to the row count.
- ❌ Running generated EDA code without reading it, or calling `toPandas()` on a large table.
- ❌ Reporting accuracy on an imbalanced label without checking the class balance first.
- ❌ Writing "trained on the table" in the run notes. Tables change; write the version number.
- ❌ Expecting time travel to work after months. `VACUUM` and log retention remove old versions.
- ✅ `RESTORE` to undo a bad write: it adds a new version and keeps the history.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Rows, charts, column profile | `display(df)`, then the Data Profile tab |
| Statistics per column | `display(df.summary())` |
| Nulls per column | `F.sum(F.col(c).isNull().cast("int"))` for every column |
| Versions of a table | `DESCRIBE HISTORY t` |
| Read an old version | `VERSION AS OF n` / `.option("versionAsOf", n)` / `timestampAsOf` |
| Undo a bad write | `RESTORE TABLE t TO VERSION AS OF n` |
