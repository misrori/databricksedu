---
title: Handling missing values
summary: Find missing values in a Spark DataFrame, choose between dropping, a category, a domain default and imputing, and fill numeric gaps with a Spark ML Imputer learned from the training set only.
icon: 🩹
level: Beginner
minutes: 10
group: Data preparation
tags: [Data preparation, Missing values, Imputer, Spark ML]
---
# Handling missing values

> Real tables have gaps. A model cannot train on a null, and a careless fill can quietly bias it. This module shows how to find the gaps and fill them the same way in training and in production.

**The one idea to remember:** `Imputer` is an **estimator**. It learns the fill value (mean or median) from the **training set only**, and the fitted model fills train, test and inference data with that same value.

## 🔍 Find the gaps first

Before you choose a fix, find out **where** values are missing and **how many**.

```python
from pyspark.sql import functions as F

# One row: the number of nulls in every column
display(df.select([F.count(F.when(F.col(c).isNull(), c)).alias(c) for c in df.columns]))

# The "count" row of summary() is the number of NON-null values
display(df.summary("count"))
```

- `F.when(...)` returns null when the condition is false, and `F.count` skips nulls. So it counts only the missing rows.
- For a quick visual check, run `display(df)` and open **+ > Data Profile**. It shows the missing percentage per column.

## ⚖️ Why the pattern matters

| Problem | What goes wrong |
|---|---|
| **Errors** | `VectorAssembler` raises an error on null inputs by default |
| **Lost rows** | Dropping every incomplete row can remove a large part of the data |
| **Bias** | If missing values are linked to the label (leavers skip a survey), dropping or naive filling skews the model |
| **Train/serve mismatch** | Filling one way in training and another way in production feeds the model different data |

Compare missing rates across groups, for example by label or region. *Why* a value is missing is an assumption. Check it with domain knowledge.

## 🧭 Four strategies

Most projects mix them, column by column.

```viz compare
{"items": [
 {"icon": "🗑️", "title": "Drop", "color": "red",
  "points": ["Column mostly empty: `df.drop(c)`", "Row mostly empty: `df.na.drop(thresh=k)` keeps rows with at least k non-null values", "❌ Biased if the dropped rows have something in common"]},
 {"icon": "🏷️", "title": "Missing as a category", "color": "blue",
  "points": ["`fillna(\"Unknown\", subset=[...])`", "or `StringIndexer(handleInvalid=\"keep\")` gives nulls their own index", "✅ Categorical columns"]},
 {"icon": "📖", "title": "Domain default", "color": "amber",
  "points": ["Fill with a known meaning, such as `\"No\"`", "Only when the data definition says what missing means", "Missing, \"not applicable\" and \"No\" are different states"]},
 {"icon": "🧮", "title": "Impute", "color": "green",
  "points": ["Spark ML `Imputer`: mean, median or mode", "Learned from the training set", "✅ Numeric columns"]}
 ]}
```

## 🧮 Imputer: fit on train, transform everything

```viz code
title: Spark ML Imputer
lang: python
---
from pyspark.ml.feature import Imputer

imputer = Imputer(
    inputCols=["tenure_months", "support_calls_90d"],
    outputCols=["tenure_months_imp", "support_calls_90d_imp"],
    strategy="median",              # "mean", "median" or "mode"
)
imputer_model = imputer.fit(train_df)       # learns one value per column
display(imputer_model.surrogateDF)          # the learned fill values

train_imp = imputer_model.transform(train_df)
test_imp  = imputer_model.transform(test_df)    # same values, not recomputed
---
3-7 | Configure | One output column per input column. Numeric columns only. Both `null` and `NaN` count as missing.
6 | Mean or median | The **mean** is pulled by outliers. The **median** is robust, a good default for counts and amounts.
8 | fit = learn | `fit` scans the data you pass and computes the statistic. Pass the **training set only**, or test rows leak into the fill value.
9 | surrogateDF | A one-row DataFrame with the value that will replace each gap. Check it.
11-12 | transform = apply | Test and future data get the **training** median. That keeps training and inference consistent.
```

## 🚩 Flag first, then fill

Five training rows and one test row of `support_calls_90d`. Watch the order of the steps.

```viz table
{"title": "support_calls_90d", "columns": ["set", "calls", "was_missing", "calls_imp"],
 "rows": [["train", 0, "", ""], ["train", 1, "", ""], ["train", null, "", ""], ["train", 8, "", ""], ["train", null, "", ""]],
 "steps": [
  {"label": "Gaps", "note": "Two training rows have no value.", "hl": [2, 4]},
  {"label": "Flag BEFORE imputing", "note": "`isNull().cast(\"int\")` records the original gap. After imputing there is no null left to detect.", "upd": {"0": {"was_missing": 0}, "1": {"was_missing": 0}, "2": {"was_missing": 1}, "3": {"was_missing": 0}, "4": {"was_missing": 1}}, "hl": [2, 4]},
  {"label": "Learn on train", "note": "Observed values: 0, 1, 8. The **mean is 3**, pulled up by the outlier 8. The **median is 1**. Imputer with `strategy=\"median\"` stores 1.", "hl": [3]},
  {"label": "Fill", "note": "Observed values pass through unchanged. Gaps get the median.", "upd": {"0": {"calls_imp": 0}, "1": {"calls_imp": 1}, "2": {"calls_imp": 1}, "3": {"calls_imp": 8}, "4": {"calls_imp": 1}}, "hl": [2, 4]},
  {"label": "A test row arrives", "note": "It gets the **training** median 1. The test data never changes the fill value.", "add": [["test", null, 1, 1]], "hl": [5]},
  {"label": "Side effect", "note": "Every gap now sits on the same value, so the column's spread **shrinks**. Compare `stddev` before and after, and keep the flag so the model can tell real 1s from filled ones."}
 ]}
```

## 🧯 Caveats on Databricks

| Situation | Do this | Why |
|---|---|---|
| `strategy="mode"` on serverless | Avoid it | Fails with `UC_COMMAND_NOT_SUPPORTED` |
| A 0/1 column | `strategy="median"` | The median of 0/1 is its more common value, so it stays 0 or 1 |
| String column | `fillna("Unknown")` or `StringIndexer` | `Imputer` works on numeric columns only |
| Missing **label** | Never impute it | Investigate or remove the row |
| KNN imputation | Not in Spark ML | scikit-learn `KNNImputer` needs `toPandas()`, small data only |
| Regression imputation | Any Spark ML regressor | Train on rows where the column is present; one best guess, no uncertainty |

Model-based methods add a model to fit on train, validate and maintain. Start with `Imputer`.

## 🧪 Try it: find, flag and fill

```dataset churn
```

`subscribers` has no nulls, so the first cell makes a copy with gaps. `avg_weekly_minutes` is missing **more often for churners**, on purpose.

```sql run
-- A copy of subscribers with deterministic gaps
CREATE OR REPLACE TABLE imp_subscribers AS
SELECT subscriber_id, plan,
       CASE WHEN subscriber_id % 23 = 0 THEN NULL ELSE contract END AS contract,
       CAST(CASE WHEN subscriber_id % 11 = 0 THEN NULL ELSE tenure_months END AS DOUBLE) AS tenure_months,
       CAST(CASE WHEN subscriber_id % 7 = 0 THEN NULL ELSE support_calls_90d END AS DOUBLE) AS support_calls_90d,
       CASE WHEN (churned = 1 AND subscriber_id % 3 = 0) OR subscriber_id % 17 = 0 THEN NULL
            ELSE avg_weekly_minutes END AS avg_weekly_minutes,
       CAST(CASE WHEN subscriber_id % 13 = 0 THEN NULL ELSE CAST(has_app AS INT) END AS DOUBLE) AS has_app,
       CASE WHEN subscriber_id % 10 = 1 THEN age % 11 END AS nps_score,   -- 90% empty
       churned
FROM subscribers;
```

```python run
# Null counts per column
from pyspark.sql import functions as F

df = spark.table("imp_subscribers")
display(df.select([F.count(F.when(F.col(c).isNull(), c)).alias(c) for c in df.columns]))
```

```sql run
-- Is missingness linked to the label?
SELECT churned, count(*) AS subscribers,
       round(avg(CASE WHEN avg_weekly_minutes IS NULL THEN 1 ELSE 0 END), 3) AS minutes_missing_rate,
       round(avg(CASE WHEN tenure_months IS NULL THEN 1 ELSE 0 END), 3) AS tenure_missing_rate
FROM imp_subscribers GROUP BY churned ORDER BY churned;
```

Tenure is missing at the same rate in both groups. Minutes are missing about six times more often for churners: a reason to keep a flag.

```python run
# Drop the empty column, flag, split, then fit the Imputer on train only
from pyspark.ml.feature import Imputer

df = (spark.table("imp_subscribers").drop("nps_score")
      .withColumn("minutes_was_missing", F.col("avg_weekly_minutes").isNull().cast("int")))  # BEFORE imputing
train = df.filter("subscriber_id % 5 != 0")    # deterministic 80/20 split
test = df.filter("subscriber_id % 5 = 0")

num_cols = ["tenure_months", "support_calls_90d", "avg_weekly_minutes", "has_app"]
imputer = Imputer(inputCols=num_cols, outputCols=[f"{c}_imp" for c in num_cols], strategy="median")
imputer_model = imputer.fit(train)
display(imputer_model.surrogateDF)    # has_app stays 0/1: its median is 1.0
```

```python run
# The test set gets the training medians
test_imp = imputer_model.transform(test)
display(test_imp.filter("tenure_months IS NULL OR avg_weekly_minutes IS NULL")
        .select("subscriber_id", "tenure_months", "tenure_months_imp",
                "avg_weekly_minutes", "avg_weekly_minutes_imp", "minutes_was_missing").limit(5))
```

```python run
# Without imputing, VectorAssembler fails on nulls
from pyspark.ml.feature import VectorAssembler

va = VectorAssembler(inputCols=["tenure_months", "support_calls_90d"], outputCol="features")
try:
    va.transform(train.filter("support_calls_90d IS NULL")).select("features").show(1)
except Exception as e:
    print("Error:", str(e)[:300])

va_ok = VectorAssembler(inputCols=["tenure_months_imp", "support_calls_90d_imp", "minutes_was_missing"],
                        outputCol="features")
display(va_ok.transform(test_imp).select("subscriber_id", "features").limit(3))
```

> The split uses `subscriber_id % 5` so that everyone gets the same numbers. In a real project use `randomSplit` with a seed and save both sets as tables.

## Exercise 1: predict the median, then the spread

`support_calls_90d` is skewed: most subscribers call rarely, a few call often. **Predict first:** on the training rows, which is larger, the mean or the median? Roughly what is each? And after median imputation, does the standard deviation go up or down?

```python todo
# Mean vs median imputation on a skewed column
from pyspark.sql import functions as F
from pyspark.ml.feature import Imputer

df = spark.sql("""SELECT subscriber_id,
                         CAST(CASE WHEN subscriber_id % 7 = 0 THEN NULL ELSE support_calls_90d END AS DOUBLE) AS calls
                  FROM subscribers""")
train = df.filter("subscriber_id % 5 != 0")
# My guess: mean = ?, median = ?
# TODO 1: fit an Imputer with strategy="mean" and one with strategy="median" on train; display both surrogateDF
# TODO 2: transform train with the median model; compare stddev of calls and calls_imp
```

```python solution
from pyspark.sql import functions as F
from pyspark.ml.feature import Imputer

df = spark.sql("""SELECT subscriber_id,
                         CAST(CASE WHEN subscriber_id % 7 = 0 THEN NULL ELSE support_calls_90d END AS DOUBLE) AS calls
                  FROM subscribers""")
train = df.filter("subscriber_id % 5 != 0")

for strategy in ["mean", "median"]:
    m = Imputer(inputCols=["calls"], outputCols=["calls_imp"], strategy=strategy).fit(train)
    print(strategy, m.surrogateDF.first()["calls"])      # mean about 2.37, median 1.0

median_model = Imputer(inputCols=["calls"], outputCols=["calls_imp"], strategy="median").fit(train)
display(median_model.transform(train).select(
    F.round(F.stddev("calls"), 3).alias("std_before"),        # about 2.57
    F.round(F.stddev("calls_imp"), 3).alias("std_after")))   # about 2.43: 572 rows now sit on one value
# The mean is more than twice the median: a few subscribers with 6 to 8 calls pull it up.
```

## Exercise 2: does the gap carry signal?

Build a missingness flag for `avg_weekly_minutes`, once **before** and once **after** imputing. **Explain first:** which flag is useless, and why? Then compare the churn rate of rows with and without the gap.

```python todo
# Flag before vs after imputing
from pyspark.sql import functions as F
from pyspark.ml.feature import Imputer

df = spark.sql("""SELECT subscriber_id, churned,
                         CASE WHEN (churned = 1 AND subscriber_id % 3 = 0) OR subscriber_id % 17 = 0 THEN NULL
                              ELSE avg_weekly_minutes END AS minutes
                  FROM subscribers""")
# TODO 1: add flag_before = minutes IS NULL (as int)
# TODO 2: fit a median Imputer on the rows with subscriber_id % 5 != 0, transform df into minutes_imp
# TODO 3: add flag_after = minutes_imp IS NULL (as int)
# TODO 4: group by flag_before: count rows, average churned, sum flag_after
```

```python solution
from pyspark.sql import functions as F
from pyspark.ml.feature import Imputer

df = spark.sql("""SELECT subscriber_id, churned,
                         CASE WHEN (churned = 1 AND subscriber_id % 3 = 0) OR subscriber_id % 17 = 0 THEN NULL
                              ELSE avg_weekly_minutes END AS minutes
                  FROM subscribers""")
df = df.withColumn("flag_before", F.col("minutes").isNull().cast("int"))
model = Imputer(inputCols=["minutes"], outputCols=["minutes_imp"], strategy="median") \
    .fit(df.filter("subscriber_id % 5 != 0"))
out = model.transform(df).withColumn("flag_after", F.col("minutes_imp").isNull().cast("int"))
display(out.groupBy("flag_before").agg(
    F.count("*").alias("rows"),
    F.round(F.avg("churned"), 3).alias("churn_rate"),     # about 0.70 with a gap, 0.20 without
    F.sum("flag_after").alias("flag_after_ones")))        # always 0: no nulls are left to find
# flag_after is useless. flag_before is a strong feature here, but the label (churned) itself is never imputed.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS imp_subscribers")
```

## ⚠️ Common mistakes

- ❌ Fitting the `Imputer` on the full table before the split. Test rows leak into the fill value.
- ❌ Computing the fill value again on test or production data. Reuse the fitted model, ideally inside a saved `Pipeline`.
- ❌ Creating the missingness flag after imputing. It is always 0.
- ❌ Using the mean on skewed counts and amounts. Outliers pull it away from typical rows.
- ❌ `strategy="mode"` on serverless. Use the median for 0/1 columns.
- ❌ Filling `"No"` when the data definition does not say that missing means "No".
- ✅ Compare the distribution before and after imputing, and check missing rates by label.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Nulls per column | `df.select([F.count(F.when(F.col(c).isNull(), c)).alias(c) for c in df.columns])` |
| Drop sparse rows | `df.na.drop(thresh=k)` keeps rows with at least k non-null values |
| Categorical gaps | `fillna("Unknown", subset=[...])` or `StringIndexer(handleInvalid="keep")` |
| Numeric gaps | `Imputer(inputCols, outputCols, strategy="median").fit(train)` |
| See the fill values | `imputer_model.surrogateDF` |
| Keep the signal | `F.col(c).isNull().cast("int")` **before** imputing |
