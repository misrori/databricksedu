---
title: Encoding categorical features
summary: Turn string categories into numbers with StringIndexer, OneHotEncoder and VectorAssembler, handle nulls, unseen and rare values the same way in training and production, and know when to use ordinal mappings or target encoding instead.
icon: 🔠
level: Intermediate
minutes: 11
group: Data preparation
tags: [Data preparation, Encoding, StringIndexer, OneHotEncoder, Spark ML]
---
# Encoding categorical features

> Spark ML models read one numeric feature vector. Columns such as `plan` or `region` hold strings, so they must be encoded first, with categories learned from the training data.

**The one idea to remember:** `StringIndexer` and `OneHotEncoder` are **estimators**. They learn the category list from the **training set**, and with `handleInvalid="keep"` every null or unseen value lands in one extra bucket instead of failing.

## 🔍 Find the categorical columns

```python
from pyspark.sql import functions as F

# String columns are the candidates (leave out ids and the label)
cat_cols = [f.name for f in df.schema.fields
            if f.dataType.simpleString() == "string" and f.name not in ("subscriber_id", "churned")]

# How many distinct values does each one have?
display(df.select([F.approx_count_distinct(c).alias(c) for c in cat_cols]))
```

- **Cardinality** (the number of distinct values) decides the encoding. Three regions are easy; 40,000 ZIP codes are not.
- `approx_count_distinct` is fast on big tables. The **Data Profile** of `display(df)` shows the same thing visually.

## 🗂️ Four kinds of categories

| Kind | Example | Start with |
|---|---|---|
| **Nominal**: no order | `region`: North, South, East, West | `StringIndexer` then `OneHotEncoder` |
| **Ordinal**: real order | `contract`: Monthly < One year < Two year | An explicit mapping you write |
| **Binary** | `has_app`: true / false | A 0/1 column: `cast("int")` |
| **High cardinality** | product id, ZIP code, promo code | Group rare values into `"Other"` first |

The same column can be treated either way. `contract` is nominal to a one-hot encoder and ordinal if you decide that its order matters.

## 🔢 Three stages in a pipeline

```viz flow
{"nodes": [
  {"icon": "🔤", "title": "region", "sub": "string", "color": "gray"},
  {"icon": "🔢", "title": "StringIndexer", "sub": "string → index", "color": "blue"},
  {"icon": "🧩", "title": "OneHotEncoder", "sub": "index → sparse vector", "color": "purple"},
  {"icon": "📦", "title": "VectorAssembler", "sub": "all columns → features", "color": "green"}
 ],
 "edges": ["fit learns labels", "fit learns size", "concatenate"],
 "steps": [
  {"label": "Index", "focus": [0, 1], "note": "`fit` counts the categories in the **training** data. The most frequent gets index `0.0`, the next `1.0`, and so on."},
  {"label": "One-hot", "focus": [2], "note": "Each index becomes a vector with a single 1. `fit` reads how many categories there are, so the vector size is fixed."},
  {"label": "Assemble", "focus": [3], "note": "The encoded vectors and the numeric columns are joined into one `features` vector for the model."},
  {"label": "Reuse", "focus": [1, 2, 3], "note": "Put the stages in a `Pipeline`, fit it on train once, and transform test and production data with the same fitted model."}
 ]}
```

## 🎯 From a string to a vector

Training counts: North 1,003, West 975, East 968, South 946. Two test rows are tricky: a null, and `Islands`, which never appears in training.

```viz table
{"title": "region → region_idx → region_ohe", "columns": ["region", "region_idx", "region_ohe", "as dense"],
 "rows": [["North", "", "", ""], ["West", "", "", ""], ["South", "", "", ""], [null, "", "", ""], ["Islands", "", "", ""]],
 "steps": [
  {"label": "Strings", "note": "The model cannot read these. `Islands` exists only in the test data.", "hl": [4]},
  {"label": "StringIndexer.fit(train)", "note": "Ordered by frequency: North 0, West 1, East 2, South 3. Not alphabetical, not by meaning.", "upd": {"0": {"region_idx": "0.0"}, "1": {"region_idx": "1.0"}, "2": {"region_idx": "3.0"}}},
  {"label": "handleInvalid=\"keep\"", "note": "Null and unseen values go to one extra index: the number of labels, **4**. With the default `\"error\"` the transform fails instead.", "upd": {"3": {"region_idx": "4.0"}, "4": {"region_idx": "4.0"}}, "hl": [3, 4]},
  {"label": "OneHotEncoder", "note": "Five indices, but `dropLast=True` (the default) leaves out the last one, so the vector has **4** positions. Spark stores it sparse: `(size, [positions], [values])`.", "upd": {"0": {"region_ohe": "(4,[0],[1.0])", "as dense": "[1, 0, 0, 0]"}, "1": {"region_ohe": "(4,[1],[1.0])", "as dense": "[0, 1, 0, 0]"}, "2": {"region_ohe": "(4,[3],[1.0])", "as dense": "[0, 0, 0, 1]"}}},
  {"label": "The unknown bucket", "note": "The dropped position is index 4, the unknown bucket. So null and `Islands` become an **all-zero** vector: none of the known regions.", "upd": {"3": {"region_ohe": "(4,[],[])", "as dense": "[0, 0, 0, 0]"}, "4": {"region_ohe": "(4,[],[])", "as dense": "[0, 0, 0, 0]"}}, "hl": [3, 4]}
 ]}
```

## ⚖️ Index, one-hot, or your own order?

```viz compare
{"items": [
 {"icon": "🧩", "title": "One-hot", "color": "purple",
  "points": ["✅ Default for nominal columns", "✅ Safe for linear and distance-based models", "❌ One column per category: wide with high cardinality", "Sparse vectors keep memory low"]},
 {"icon": "🔢", "title": "Index only (label encoding)", "color": "blue",
  "points": ["Spark ML trees read the `StringIndexer` metadata and split on groups of categories", "Set `maxBins` ≥ the largest category count", "❌ Linear models read 0 < 1 < 2 as a real order", "❌ Lost metadata (a plain cast) turns it into numbers"]},
 {"icon": "🪜", "title": "Explicit ordinal mapping", "color": "amber",
  "points": ["`F.when(c == \"Monthly\", 1).when(c == \"One year\", 2)...`", "Only when the order is real", "Implies equal steps between levels", "`StringIndexer` is **not** ordinal: it orders by frequency"]}
 ]}
```

Validate the choice: compare the index-only tree with the one-hot version on the same validation set.

## 🧺 Group rare categories into "Other"

A category seen 6 times teaches the model little and adds a column. Learn the frequent values from the **training data**, then apply the same mapping to every dataset.

```python
min_count = 50
frequent = [r["channel"] for r in
            train.groupBy("channel").count().filter(F.col("count") >= min_count).collect()
            if r["channel"] is not None]

def group_rare(df):
    return df.withColumn("channel_grouped",
        F.when(F.col("channel").isNull(), "Unknown")
         .when(F.col("channel").isin(frequent), F.col("channel"))
         .otherwise("Other"))     # rare AND unseen values both become "Other"
```

Keeping the top N values plus `"Other"` works the same way. Save `frequent` with the model, like any learned statistic.

## 🎯 Target encoding (advanced)

`TargetEncoder` (Apache Spark 4.0+) replaces each category with the **mean label** of its training rows. It takes indices, so run `StringIndexer` first.

```python
from pyspark.ml.feature import StringIndexer, TargetEncoder

indexer = StringIndexer(inputCol="channel", outputCol="channel_idx", handleInvalid="keep")
encoder = TargetEncoder(inputCol="channel_idx", outputCol="channel_te", labelCol="churned",
                        targetType="binary",      # "continuous" for regression
                        smoothing=1.0,            # pulls small categories toward the overall mean
                        handleInvalid="keep")     # unseen categories get the overall statistic
```

- It **learns from the label**. Fit it on the training set only, or test labels leak into the features.
- A category with 6 rows gets an over-confident mean. That is what `smoothing` is for.
- **Embeddings** (dense learned vectors) are another option for very high cardinality or text, usually with neural networks.

> Shown as display-only code: it needs a Spark 4.0 runtime, such as a recent serverless environment version.

## 🧪 Try it: encode regions with an unseen value

```dataset churn
```

The copy below adds null regions, an `Islands` region that appears **only** in the test split, and a `channel` column with seven rare promo codes.

```sql run
-- A copy of subscribers with nulls, an unseen value and rare categories
CREATE OR REPLACE TABLE enc_subscribers AS
SELECT subscriber_id, plan, contract,
       CASE WHEN subscriber_id % 37 = 0 THEN NULL
            WHEN subscriber_id % 250 = 0 THEN 'Islands'          -- only in the test split
            ELSE region END AS region,
       CASE WHEN floor(subscriber_id / 5) % 10 < 5 THEN 'Web'
            WHEN floor(subscriber_id / 5) % 10 < 8 THEN 'Store'
            WHEN floor(subscriber_id / 5) % 10 = 8 THEN 'Phone'
            WHEN floor(subscriber_id / 5) % 100 < 95 THEN 'Partner'
            ELSE concat('Promo-', CAST(subscriber_id % 7 AS STRING)) END AS channel,
       has_app, tenure_months, churned
FROM subscribers;
```

```python run
# Cardinality of the string columns
from pyspark.sql import functions as F

df = spark.table("enc_subscribers")
cat_cols = [f.name for f in df.schema.fields if f.dataType.simpleString() == "string"]
display(df.select([F.approx_count_distinct(c).alias(c) for c in cat_cols]))
```

```python run
# Fit the encoding pipeline on train only
from pyspark.ml import Pipeline
from pyspark.ml.feature import StringIndexer, OneHotEncoder, VectorAssembler

train = df.filter("subscriber_id % 5 != 0")     # deterministic 80/20 split
test = df.filter("subscriber_id % 5 = 0")

cats = ["plan", "region"]
pipeline = Pipeline(stages=[
    StringIndexer(inputCols=cats, outputCols=[f"{c}_idx" for c in cats], handleInvalid="keep"),
    OneHotEncoder(inputCols=[f"{c}_idx" for c in cats], outputCols=[f"{c}_ohe" for c in cats]),
    VectorAssembler(inputCols=[f"{c}_ohe" for c in cats] + ["tenure_months"], outputCol="features"),
])
model = pipeline.fit(train)
print(model.stages[0].labelsArray)    # per column, most frequent first
```

```python run
# One row per region value in the test set, including null and Islands
from pyspark.ml.functions import vector_to_array

display(model.transform(test).dropDuplicates(["region"])
        .select("region", "region_idx", "region_ohe",
                vector_to_array("region_ohe").alias("region_dense"), "features")
        .orderBy("region_idx"))
```

## Exercise 1: predict the indices

Build a `StringIndexer` and `OneHotEncoder` for `region` and `contract` from `subscribers`. **Predict first:** the index of `Islands`, the index of a null, the size of `region_ohe` and of `contract_ohe`. Then try the default `handleInvalid` on the test set and explain the result.

```python todo
# Predict, then check
from pyspark.ml.feature import StringIndexer, OneHotEncoder

df = spark.sql("""SELECT subscriber_id, contract,
                         CASE WHEN subscriber_id % 37 = 0 THEN NULL
                              WHEN subscriber_id % 250 = 0 THEN 'Islands' ELSE region END AS region
                  FROM subscribers""")
train, test = df.filter("subscriber_id % 5 != 0"), df.filter("subscriber_id % 5 = 0")
# My guesses: Islands -> ?, null -> ?, size of region_ohe = ?, size of contract_ohe = ?
# TODO 1: fit StringIndexer(handleInvalid="keep") for both columns on train; print labelsArray
# TODO 2: fit OneHotEncoder on the indexed train; show one test row per region value
# TODO 3: fit a StringIndexer for region WITHOUT handleInvalid and transform test (wrap in try/except)
```

```python solution
from pyspark.ml.feature import StringIndexer, OneHotEncoder

df = spark.sql("""SELECT subscriber_id, contract,
                         CASE WHEN subscriber_id % 37 = 0 THEN NULL
                              WHEN subscriber_id % 250 = 0 THEN 'Islands' ELSE region END AS region
                  FROM subscribers""")
train, test = df.filter("subscriber_id % 5 != 0"), df.filter("subscriber_id % 5 = 0")

idx = StringIndexer(inputCols=["region", "contract"], outputCols=["region_idx", "contract_idx"],
                    handleInvalid="keep").fit(train)
print(idx.labelsArray)   # [['North', 'West', 'East', 'South'], ['Monthly', 'One year', 'Two year']]
ohe = OneHotEncoder(inputCols=["region_idx", "contract_idx"],
                    outputCols=["region_ohe", "contract_ohe"]).fit(idx.transform(train))
display(ohe.transform(idx.transform(test)).dropDuplicates(["region"])
        .select("region", "region_idx", "region_ohe", "contract", "contract_ohe"))
# Islands -> 4.0 and null -> 4.0 (the extra bucket = number of labels).
# region_ohe has 4 positions (4 labels + unknown, minus dropLast); contract_ohe has 3.

strict = StringIndexer(inputCol="region", outputCol="region_idx").fit(train)   # handleInvalid="error"
try:
    strict.transform(test).collect()
except Exception as e:
    print("Error:", str(e)[:300])   # fails on the null or on the unseen label 'Islands'
```

## Exercise 2: order and rarity

`contract` gets the indices Monthly 0, One year 1, Two year 2 from `StringIndexer`. **Explain first:** is that order guaranteed? Then build an explicit ordinal column, and group rare `channel` values into `"Other"` using counts from the training rows only. **Predict:** how many test rows become `"Other"`?

```python todo
# Ordinal mapping and rare categories
from pyspark.sql import functions as F

df = spark.sql("""SELECT subscriber_id, contract,
                         CASE WHEN floor(subscriber_id / 5) % 10 < 5 THEN 'Web'
                              WHEN floor(subscriber_id / 5) % 10 < 8 THEN 'Store'
                              WHEN floor(subscriber_id / 5) % 10 = 8 THEN 'Phone'
                              WHEN floor(subscriber_id / 5) % 100 < 95 THEN 'Partner'
                              ELSE concat('Promo-', CAST(subscriber_id % 7 AS STRING)) END AS channel
                  FROM subscribers""")
train, test = df.filter("subscriber_id % 5 != 0"), df.filter("subscriber_id % 5 = 0")
# TODO 1: add contract_ord: Monthly 1, One year 2, Two year 3 with F.when(...).otherwise(None)
# TODO 2: collect the channel values with at least 50 training rows
# TODO 3: add channel_grouped to test (frequent value, else "Other") and count per value
```

```python solution
from pyspark.sql import functions as F

df = spark.sql("""SELECT subscriber_id, contract,
                         CASE WHEN floor(subscriber_id / 5) % 10 < 5 THEN 'Web'
                              WHEN floor(subscriber_id / 5) % 10 < 8 THEN 'Store'
                              WHEN floor(subscriber_id / 5) % 10 = 8 THEN 'Phone'
                              WHEN floor(subscriber_id / 5) % 100 < 95 THEN 'Partner'
                              ELSE concat('Promo-', CAST(subscriber_id % 7 AS STRING)) END AS channel
                  FROM subscribers""")
train, test = df.filter("subscriber_id % 5 != 0"), df.filter("subscriber_id % 5 = 0")

contract_ord = (F.when(F.col("contract") == "Monthly", 1)
                 .when(F.col("contract") == "One year", 2)
                 .when(F.col("contract") == "Two year", 3)
                 .otherwise(None))
display(train.withColumn("contract_ord", contract_ord).groupBy("contract", "contract_ord").count())
# Not guaranteed: StringIndexer follows frequency. The order matches only because Monthly is the most common.

frequent = [r["channel"] for r in train.groupBy("channel").count().filter(F.col("count") >= 50).collect()]
print(frequent)    # Web, Store, Phone, Partner; every Promo code has 5 or 6 training rows
grouped = test.withColumn("channel_grouped",
                          F.when(F.col("channel").isin(frequent), F.col("channel")).otherwise("Other"))
display(grouped.groupBy("channel_grouped").count().orderBy(F.desc("count")))   # Other: 10 rows

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS enc_subscribers")
```

## ⚠️ Common mistakes

- ❌ Fitting `StringIndexer` on the full table. The category list and its order must come from train.
- ❌ Leaving `handleInvalid` at `"error"`. One new value in production fails the whole batch.
- ❌ Using `StringIndexer` for ordinal data. It orders by frequency, not by meaning.
- ❌ Feeding raw indices to a linear model. It reads them as distances.
- ❌ Fitting `TargetEncoder` on all rows. That leaks the test labels.
- ❌ Putting both the one-hot and the ordinal version of a column in the same feature vector.
- ✅ Keep the fitted pipeline and reuse it for test and inference data.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Cardinality | `df.select([F.approx_count_distinct(c) for c in cat_cols])` |
| Index categories | `StringIndexer(inputCols, outputCols, handleInvalid="keep")`, most frequent = 0 |
| One-hot | `OneHotEncoder(inputCols, outputCols)`, `dropLast=True` by default |
| One vector | `VectorAssembler(inputCols, outputCol="features")` |
| Real order | `F.when(...).when(...).otherwise(None)` |
| Label-based | `TargetEncoder(labelCol, targetType, smoothing, handleInvalid)`, fit on train |
