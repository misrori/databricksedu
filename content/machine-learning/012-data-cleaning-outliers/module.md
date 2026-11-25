---
title: Clean data and handle outliers
summary: Fix column types, remove impossible values, drop rows and columns that are mostly empty, and detect and treat outliers with thresholds learned on the training set only.
icon: 🧹
level: Intermediate
minutes: 11
group: Data preparation
tags: [Data cleaning, Outliers, IQR, Winsorizing, Leakage]
---
# Clean data and handle outliers

> Raw data arrives with numbers stored as text, fees below zero and a few users with ten times the normal usage. Some of that is wrong, some is rare but real. This module shows how to tell them apart and in which order to fix them.

**The one idea to remember:** clean with **fixed rules** before the split, but anything that **learns a number from the data**, such as an outlier threshold, is fit on the **training set only** and then applied to every split.

## 🧹 Cleaning or feature engineering?

```viz compare
{"items": [
 {"icon": "🧹", "title": "Cleaning and formatting", "sub": "make the data correct", "color": "teal",
  "points": ["Fix data types", "Remove impossible values", "Treat outliers", "Drop empty columns and rows, deduplicate"]},
 {"icon": "🛠️", "title": "Feature engineering", "sub": "make the data informative", "color": "purple",
  "points": ["Impute missing values", "Log transform, scale", "Encode categories", "Aggregate, derive new features"],
  "foot": "Modules 014 to 017"}
 ]}
```

Most datasets need both. What decides the order is not the category but one question: **does this step learn something from the data?**

## 🪜 The order matters

```viz flow
{"nodes": [
  {"icon": "✅", "title": "Validate and clean", "sub": "rules that do not learn", "color": "teal"},
  {"icon": "✂️", "title": "Split", "sub": "train / test", "color": "navy"},
  {"icon": "📐", "title": "Fit on train", "sub": "thresholds, medians, scalers", "color": "amber"},
  {"icon": "🔁", "title": "Apply everywhere", "sub": "train, test, new data", "color": "green"}
 ],
 "steps": [
  {"label": "Clean", "focus": [0], "note": "Fix types, remove fees below zero and ages above 120. These rules are the same whatever the data looks like, so they are safe before the split."},
  {"label": "Split", "focus": [1], "note": "From now on the test set is out of reach. Module 013 covers how to split."},
  {"label": "Fit", "focus": [2], "note": "An IQR bound, an imputation median, a scaler mean: each is a number **computed from data**. Compute it from the training rows only."},
  {"label": "Apply", "focus": [3], "note": "Use the same numbers on test and production data. If test rows had shaped the bounds, the test score would be too optimistic."}
 ]}
```

## 🧪 Try it: a dirty copy of the subscribers

```dataset churn
```

```sql run
-- Text columns, impossible values, inflated usage, mostly empty rows and a mostly empty column
CREATE OR REPLACE TABLE clean_subscribers_raw AS
SELECT subscriber_id,
       CASE WHEN subscriber_id % 41 = 0 THEN NULL ELSE plan END AS plan,
       CASE WHEN subscriber_id % 41 = 0 THEN NULL ELSE contract END AS contract,
       CASE WHEN subscriber_id % 41 = 0 THEN NULL WHEN subscriber_id % 89 = 0 THEN 'unknown'
            ELSE CAST(tenure_months AS STRING) END AS tenure_txt,
       CASE WHEN subscriber_id % 97 = 0 THEN -monthly_fee ELSE monthly_fee END AS monthly_fee,
       CASE WHEN subscriber_id % 113 = 0 THEN age + 150 ELSE age END AS age,
       CASE WHEN subscriber_id % 59 = 0 THEN avg_weekly_minutes * 10 ELSE avg_weekly_minutes END AS avg_weekly_minutes,
       CASE WHEN subscriber_id % 41 = 0 THEN NULL WHEN has_app THEN 'Yes' ELSE 'No' END AS has_app_txt,
       CASE WHEN subscriber_id % 41 = 0 THEN NULL ELSE support_calls_90d END AS support_calls_90d,
       CASE WHEN subscriber_id % 10 = 0 THEN concat('REF', subscriber_id) END AS referral_code,
       churned
FROM subscribers;

SELECT count_if(monthly_fee < 0) AS negative_fee, count_if(age > 120) AS impossible_age,
       count_if(tenure_txt IS NOT NULL AND try_cast(tenure_txt AS INT) IS NULL) AS bad_tenure_text,
       round(avg(CASE WHEN referral_code IS NULL THEN 1 ELSE 0 END), 2) AS referral_null_share
FROM clean_subscribers_raw;
```

## 🔤 Fix the types first

Numbers stored as text cannot be averaged or scaled, and `'Yes'`/`'No'` strings are not booleans. Spark casts `'Yes'` and `'No'` (any case) to `true` and `false`, and null stays null. Use `try_cast` when text may hold values like `'unknown'`: it returns NULL instead of failing the query.

```sql run
-- tenure as INT, has_app as BOOLEAN
CREATE OR REPLACE TABLE clean_subscribers_typed AS
SELECT * EXCEPT (tenure_txt, has_app_txt),
       try_cast(tenure_txt AS INT) AS tenure_months,
       CAST(has_app_txt AS BOOLEAN) AS has_app
FROM clean_subscribers_raw;

DESCRIBE clean_subscribers_typed;
```

> If a Yes/No column can contain other strings, map each value with `CASE WHEN` instead of a cast.

## 🚫 Invalid value or outlier?

An **invalid** value is impossible: remove or fix it with a fixed rule. An **outlier** is possible but extreme: investigate it before you decide.

```viz table
{"title": "clean_subscribers_typed (four rows)", "columns": ["subscriber_id", "monthly_fee", "age", "avg_weekly_minutes"],
 "rows": [[96, 19.22, 52, 128.5], [97, -16.11, 25, 323.5], [113, 39.44, 211, 220.3], [118, 19.8, 69, 3789.0]],
 "steps": [
  {"label": "Start", "note": "Each row has one odd value. Which ones are errors?"},
  {"label": "Domain rule: fee >= 0", "note": "A negative fee is impossible. The rule does not depend on other rows, so it can run before the split.", "hl": [1]},
  {"label": "Domain rule: age <= 120", "note": "Also impossible. Remove both rows (or fix them, if you know the cause).", "del": [1, 2]},
  {"label": "Extreme but possible", "note": "3,789 minutes a week is ten times the typical value. Maybe a typo, maybe a heavy user. Keep the row for now: an outlier rule fit on the training set decides later.", "hl": [3]}
 ]}
```

```sql run
-- Fixed rules only: keep NULLs, they are handled by imputation (module 014)
CREATE OR REPLACE TABLE clean_subscribers_valid AS
SELECT * FROM clean_subscribers_typed
WHERE (monthly_fee >= 0 OR monthly_fee IS NULL)
  AND (age <= 120 OR age IS NULL);
```

## 🕳️ Drop what is mostly empty

A column that is mostly null carries little signal; a row missing most fields is not worth imputing. `na.drop(thresh=k)` keeps rows with **at least k non-null values**. Filling the remaining gaps is module 014.

```python run
# Drop columns more than 60% null, then rows with fewer than 80% of their fields
from pyspark.sql import functions as F
df = spark.table("clean_subscribers_valid")
null_share = df.select([F.avg(F.col(c).isNull().cast("double")).alias(c) for c in df.columns]).first().asDict()
df = df.drop(*[c for c, share in null_share.items() if share > 0.6])
min_present = round(len(df.columns) * 0.8)
kept = df.na.drop(thresh=min_present)
print(f"dropped columns: {[c for c, s in null_share.items() if s > 0.6]}")
print(f"rows: {df.count():,} -> {kept.count():,} (need {min_present} of {len(df.columns)} values)")
kept.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable("clean_subscribers_silver")
```

> The 60% and 80% thresholds are choices, not rules. In production, decide them on the training set.

## 📏 Detect outliers on the training set

| Method | Flags a value when | Use it for |
|---|---|---|
| Domain rule | Outside a valid range | Always first: catches entry errors |
| IQR | Below Q1 − 1.5×IQR or above Q3 + 1.5×IQR | Skewed data; robust to extremes |
| Z-score | More than 3 standard deviations from the mean | Roughly normal data |
| Visual | Stands out in a box plot or histogram | Exploring before you pick a rule |

```python run
# Split first, then learn the IQR bounds from the training rows only
train, test = spark.table("clean_subscribers_silver").randomSplit([0.8, 0.2], seed=42)
q1, q3 = train.approxQuantile("avg_weekly_minutes", [0.25, 0.75], 0.01)
lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
print(f"Q1={q1:.1f}  Q3={q3:.1f}  keep [{lower:.1f}, {upper:.1f}]")
print("train rows above upper:", train.filter(F.col("avg_weekly_minutes") > upper).count())
```

`approxQuantile(col, probabilities, relativeError)` computes quantiles at scale; `0.01` trades a little precision for speed, `0` is exact but expensive.

## ✂️ Treat outliers: cap, flag or transform

```viz table
{"title": "Capping at the train upper bound (about 540)", "columns": ["avg_weekly_minutes", "minutes_capped", "minutes_outlier", "minutes_log"],
 "rows": [[234.0, "", "", ""], [612.3, "", "", ""], [3789.0, "", "", ""]],
 "steps": [
  {"label": "Raw values", "note": "One typical value, one heavy user, one likely typo."},
  {"label": "Cap (winsorize)", "note": "`least(greatest(x, lower), upper)` clips to the bounds. Every row stays, extremes lose their pull.", "upd": {"0": {"minutes_capped": 234.0}, "1": {"minutes_capped": 540.0}, "2": {"minutes_capped": 540.0}}, "hl": [1, 2]},
  {"label": "Flag", "note": "An indicator column lets the model learn whether being extreme matters.", "upd": {"0": {"minutes_outlier": "false"}, "1": {"minutes_outlier": "true"}, "2": {"minutes_outlier": "true"}}},
  {"label": "Log transform", "note": "`log1p` compresses the long tail instead of cutting it. The feature now means something different.", "upd": {"0": {"minutes_log": 5.46}, "1": {"minutes_log": 6.42}, "2": {"minutes_log": 8.24}}},
  {"label": "Or remove, or go robust", "note": "Remove rows only for clear errors. Robust methods (median imputation, `RobustScaler`) reduce the influence of extremes without changing the data."}
 ]}
```

```python run
# Apply the SAME train bounds to train and test
def treat(d):
    x = F.col("avg_weekly_minutes")
    return (d.withColumn("minutes_capped", F.least(F.greatest(x, F.lit(lower)), F.lit(upper)))
             .withColumn("minutes_outlier", (x < lower) | (x > upper))
             .withColumn("minutes_log", F.log1p(x)))
train_t, test_t = treat(train), treat(test)
display(test_t.filter("minutes_outlier").select("subscriber_id", "avg_weekly_minutes", "minutes_capped", "minutes_log"))
```

## Exercise 1: IQR or z-score?

Make usage ten times too high for every 59th subscriber (about 85 rows), as in the lecture. **Predict first:** does the z-score rule (|z| > 3) flag more or fewer rows than the IQR rule? Explain why.

```python todo
# TODO 1: from subscribers, multiply avg_weekly_minutes by 10 WHERE subscriber_id % 59 = 0
# TODO 2: split with randomSplit([0.8, 0.2], seed=42) and count train rows outside the IQR bounds
# TODO 3: compute mean and stddev on train, count train rows with abs(z) > 3
```

```python solution
from pyspark.sql import functions as F
x = F.col("avg_weekly_minutes")
dirty = spark.table("subscribers").withColumn(
    "avg_weekly_minutes", F.when(F.col("subscriber_id") % 59 == 0, x * 10).otherwise(x))
train, test = dirty.randomSplit([0.8, 0.2], seed=42)
q1, q3 = train.approxQuantile("avg_weekly_minutes", [0.25, 0.75], 0.01)
iqr_n = train.filter((x < q1 - 1.5 * (q3 - q1)) | (x > q3 + 1.5 * (q3 - q1))).count()
s = train.select(F.mean(x).alias("mu"), F.stddev(x).alias("sd")).first()
z_n = train.filter(F.abs((x - s.mu) / s.sd) > 3).count()
print(f"IQR flags {iqr_n}, z-score flags {z_n}, stddev = {s.sd:.0f}")
# The z-score flags fewer. The inflated rows blow up the mean and the stddev (about 330 instead of about 110),
# so the extremes hide each other. Quartiles barely move, which is why IQR is called robust.
```

## Exercise 2: catch the leak

A colleague computes the cap on the **full** table, then splits. **Predict first:** will the bound differ much from the train-only bound? Why is it still wrong?

```python todo
# TODO 1: compute the IQR upper bound of avg_weekly_minutes on the full subscribers table
# TODO 2: compute it on the train split (seed=42) and compare
```

```python solution
full = spark.table("subscribers")
train, test = full.randomSplit([0.8, 0.2], seed=42)
def upper(d):
    q1, q3 = d.approxQuantile("avg_weekly_minutes", [0.25, 0.75], 0.01)
    return q3 + 1.5 * (q3 - q1)
print(f"full: {upper(full):.1f}   train only: {upper(train):.1f}")
# The numbers are close here, but the full-table bound used the test rows. With smaller or shifting data the gap
# grows, and the test score no longer measures how the model does on data it has never seen.

# Clean up when you are done
# for t in ["clean_subscribers_raw", "clean_subscribers_typed", "clean_subscribers_valid", "clean_subscribers_silver"]:
#     spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ Computing outlier bounds, medians or category lists before the split.
- ❌ Treating every extreme value as an error. Heavy users are real and may predict churn.
- ❌ `CAST` on text that may hold `'unknown'`: under ANSI mode the query fails. Use `try_cast`.
- ❌ Filtering `monthly_fee >= 0` and silently losing the NULL rows too.
- ❌ Cleaning or filling the **label**. Rows without a label are investigated or removed, never imputed.
- ✅ Keep the raw table, write each cleaning stage to its own table, and apply one set of train-fitted bounds everywhere.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Text to number | `try_cast(col AS INT)` |
| Yes/No to boolean | `CAST(col AS BOOLEAN)`, or `CASE WHEN` for other values |
| Rows with too many nulls | `df.na.drop(thresh=k)`: keep rows with at least k values |
| IQR bounds | `train.approxQuantile(col, [0.25, 0.75], 0.01)` |
| Cap | `F.least(F.greatest(x, F.lit(lo)), F.lit(hi))` |
| Flag or compress | `(x > hi)` as a column, `F.log1p(x)` |
