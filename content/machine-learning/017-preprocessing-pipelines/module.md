---
title: Preprocessing pipelines in Spark ML
summary: Chain imputation, encoding and scaling into one Spark ML Pipeline, fit it on the training data only, inspect what it learned, and save the fitted PipelineModel to a Unity Catalog volume for reuse.
icon: 🧩
level: Intermediate
minutes: 10
group: Data preparation
tags: [Spark ML, Pipeline, PipelineModel, Leakage, Unity Catalog volumes]
---
# Preprocessing pipelines in Spark ML

> Imputing, encoding and scaling each learn something from data: a median, a list of categories, a mean and a standard deviation. Done by hand, step by step, it is easy to learn one of them from the wrong rows, or to forget a step at scoring time.

**The one idea to remember:** put every data-dependent step into one `Pipeline`. `pipeline.fit(train)` learns all the statistics once, from training rows only, and the fitted `PipelineModel` applies **exactly those** to test data and to new data.

## 🔒 Fit once, transform many times

```viz flow
{"nodes": [
  {"icon": "📋", "title": "Pipeline", "sub": "a list of stages", "color": "gray", "items": ["estimators: learn", "transformers: apply"]},
  {"icon": "🧮", "title": "pipeline.fit(train)", "sub": "runs stages in order", "color": "blue"},
  {"icon": "📦", "title": "PipelineModel", "sub": "every stage fitted", "color": "navy"},
  {"icon": "🔁", "title": "transform", "sub": "train, test, new data", "color": "green"}
 ],
 "edges": ["train only", "returns", "re-learns nothing"],
 "steps": [
  {"label": "Define", "focus": [0], "note": "**Estimators** (`Imputer`, `StandardScaler`, `StringIndexer`, `OneHotEncoder`) learn from data. **Transformers** (`VectorAssembler`) only apply a rule."},
  {"label": "Fit", "focus": [1], "note": "Each estimator is fit on the training rows as they look after the previous stages, then transforms them for the next stage."},
  {"label": "Fitted model", "focus": [2], "note": "Every estimator is replaced by its fitted model: `ImputerModel`, `StandardScalerModel`, `StringIndexerModel`, `OneHotEncoderModel`."},
  {"label": "Apply", "focus": [3], "note": "`pipeline_model.transform(df)` uses the stored medians, means and category lists. Test rows never influence them."}
 ]}
```

## 🌿 Two branches, one features vector

```viz flow
{"nodes": [
  {"icon": "🗃️", "title": "Input columns", "sub": "numbers, strings, flags", "color": "gray"},
  {"icon": "🔢", "title": "Numeric branch", "sub": "continuous columns", "color": "blue", "items": ["Imputer (median)", "VectorAssembler → num_vec", "StandardScaler → num_scaled"]},
  {"icon": "🔤", "title": "Categorical branch", "sub": "plan, contract, region", "color": "purple", "items": ["StringIndexer (keep)", "OneHotEncoder → *_ohe"]},
  {"icon": "🧷", "title": "Final VectorAssembler", "sub": "→ features", "color": "green"}
 ],
 "steps": [
  {"label": "Inputs", "focus": [0], "note": "Each column goes into one branch. 0/1 flags such as `has_app` skip both and join at the end."},
  {"label": "Numeric", "focus": [1], "note": "Fill nulls with the training median, pack the columns into one vector, then scale that vector."},
  {"label": "Categorical", "focus": [2], "note": "Map strings to indices. `handleInvalid=\"keep\"` gives nulls and unseen values an extra index instead of an error. Then one-hot encode."},
  {"label": "Join", "focus": [3], "note": "One assembler concatenates `num_scaled`, the flags and the one-hot vectors into `features`, the column Spark ML models read by default."}
 ]}
```

The stages run as one list, but each branch only touches its own columns.

## 🔢 Why the order matters

| Rule | Why | If you break it |
|---|---|---|
| Impute before you assemble and scale | Assembler and scaler cannot use nulls | `VectorAssembler` fails on nulls by default |
| Assemble before you scale | Scalers read one vector column | Error: the input must be a vector |
| Scale only the numeric branch | One-hot vectors and flags are already 0/1 | Encoded columns lose their meaning |
| Index before one-hot, encode before the final assembly | Each stage needs the previous stage's output column | Column not found |
| Keep the label out of the inputs | The label is the target, not a feature | Perfect, worthless model |

## 🚩 Flag missing values before the pipeline

```viz table
{"title": "pipe_subscribers (train rows)", "columns": ["subscriber", "avg_weekly_minutes", "minutes_missing", "minutes_imp"],
 "rows": [[12, 310.5, "", ""], [13, null, "", ""], [14, 188.0, "", ""], [26, null, "", ""]],
 "steps": [
  {"label": "Raw", "note": "Two training rows have no usage value."},
  {"label": "Add the flag", "note": "Before the pipeline, a plain column expression marks the nulls. It learns nothing from data, so it cannot leak.", "upd": {"0": {"minutes_missing": 0}, "1": {"minutes_missing": 1}, "2": {"minutes_missing": 0}, "3": {"minutes_missing": 1}}},
  {"label": "Impute", "note": "Inside the pipeline, `Imputer` fills the nulls with the **training** median (233 here) into a new column.", "upd": {"1": {"minutes_imp": 233.0}, "3": {"minutes_imp": 233.0}, "0": {"minutes_imp": 310.5}, "2": {"minutes_imp": 188.0}}, "hl": [1, 3]},
  {"label": "Both survive", "note": "The model gets the filled value **and** the fact that it was missing. Missing usage may itself predict churn. The flag joins at the final assembler, unscaled."}
 ]}
```

Your scoring code must add the same flag. To keep it inside the pipeline instead, use a `SQLTransformer` stage.

## ⚠️ The "fit on full data" mistake

```viz compare
{"items": [
 {"icon": "❌", "title": "pipeline.fit(all rows)", "sub": "then split", "color": "red",
  "points": ["Medians, means and σ include the test rows", "Category lists include test-only values", "Test scores look better than production will be", "The leak is invisible: no error, just optimism"]},
 {"icon": "✅", "title": "split, then pipeline.fit(train)", "sub": "transform train and test", "color": "green",
  "points": ["Every statistic comes from training rows", "Test rows are scaled like future data", "Unseen categories are handled by `keep`", "Test metrics estimate production performance"],
  "foot": "The same applies to cross-validation: refit inside each fold"}
 ]}
```

## 🧪 Try it: build and fit the pipeline

```dataset churn
```

```sql run
-- A copy of subscribers with some missing values, numbers as DOUBLE
CREATE OR REPLACE TABLE pipe_subscribers AS
SELECT subscriber_id, plan, contract,
       CASE WHEN subscriber_id % 31 = 0 THEN NULL ELSE region END AS region,
       CAST(tenure_months AS DOUBLE) AS tenure_months,
       monthly_fee,
       CASE WHEN subscriber_id % 13 = 0 THEN NULL ELSE avg_weekly_minutes END AS avg_weekly_minutes,
       CAST(support_calls_90d AS DOUBLE) AS support_calls_90d,
       CAST(has_app AS DOUBLE) AS has_app,
       CAST(churned AS DOUBLE) AS label
FROM subscribers;
```

```python run
# Split, add the flag, define the two branches and fit on train only
from pyspark.sql import functions as F
from pyspark.ml import Pipeline
from pyspark.ml.feature import Imputer, VectorAssembler, StandardScaler, StringIndexer, OneHotEncoder

df = spark.table("pipe_subscribers").withColumn("minutes_missing", F.col("avg_weekly_minutes").isNull().cast("double"))
train_df, test_df = df.filter("subscriber_id % 5 <> 0"), df.filter("subscriber_id % 5 = 0")

num_cols = ["tenure_months", "monthly_fee", "avg_weekly_minutes", "support_calls_90d"]
cat_cols = ["plan", "contract", "region"]
imp_cols = [f"{c}_imp" for c in num_cols]

pipeline = Pipeline(stages=[
    Imputer(inputCols=num_cols, outputCols=imp_cols, strategy="median"),
    VectorAssembler(inputCols=imp_cols, outputCol="num_vec"),
    StandardScaler(inputCol="num_vec", outputCol="num_scaled", withMean=True, withStd=True),
    StringIndexer(inputCols=cat_cols, outputCols=[f"{c}_idx" for c in cat_cols], handleInvalid="keep"),
    OneHotEncoder(inputCols=[f"{c}_idx" for c in cat_cols], outputCols=[f"{c}_ohe" for c in cat_cols]),
    VectorAssembler(inputCols=["num_scaled", "has_app", "minutes_missing"] + [f"{c}_ohe" for c in cat_cols],
                    outputCol="features"),
])
pipeline_model = pipeline.fit(train_df)           # every statistic from train
train_out = pipeline_model.transform(train_df)
test_out = pipeline_model.transform(test_df)      # nothing re-learned
display(test_out.select("subscriber_id", "region", "avg_weekly_minutes", "features", "label").limit(5))
```

> On serverless, Spark ML runs through Spark Connect and a fitted model must stay small. This pipeline is tiny. If you ever see `CONNECT_ML.MODEL_SIZE_OVERFLOW_EXCEPTION`, start a new session and keep the pipeline smaller.

## 🔍 Try it: look inside the fitted stages

```python run
# What did fit() learn?
from pyspark.ml.functions import vector_to_array

for i, stage in enumerate(pipeline_model.stages):
    print(i, type(stage).__name__)

display(pipeline_model.stages[0].surrogateDF)                    # ImputerModel: the training medians
print("scaler mean:", pipeline_model.stages[2].mean)               # StandardScalerModel
print("scaler std: ", pipeline_model.stages[2].std)
print("labels:     ", pipeline_model.stages[3].labelsArray)        # StringIndexerModel, most frequent first

sizes = [r.n for r in train_out.select(F.size(vector_to_array("features")).alias("n")).distinct().collect()]
sizes_test = [r.n for r in test_out.select(F.size(vector_to_array("features")).alias("n")).distinct().collect()]
print("feature vector size, train:", sizes, "test:", sizes_test)
```

Region has 4 labels, so `region_ohe` has 4 slots: `keep` adds a fifth index for null and unseen values, and `dropLast` drops it. Those rows get all zeros.

## 💾 Try it: save the fitted pipeline and load it back

```python run
# Save the PipelineModel to a Unity Catalog volume, reload it, compare
from pyspark.ml import PipelineModel

pipeline_path = f"{data.volume(CATALOG, SCHEMA)}/pipe/churn_prep_v1"   # a version in the path
pipeline_model.write().overwrite().save(pipeline_path)

loaded = PipelineModel.load(pipeline_path)
print([type(s).__name__ for s in loaded.stages])

a = test_out.select("subscriber_id", vector_to_array("features").alias("f"))
b = loaded.transform(test_df).select("subscriber_id", vector_to_array("features").alias("f"))
print("rows that differ after reload:", a.exceptAll(b).count() + b.exceptAll(a).count())
```

A scoring job loads this folder and calls `transform`, so new data is prepared exactly like the training data. To store the resulting features for many models, see the module on Feature Engineering in Unity Catalog.

## Exercise 1: score a subscriber the pipeline has never seen

The starter fits a small pipeline on training rows. Then a new subscriber arrives: region `"Central"` (never seen), no usage value, tenure 12. **Predict all 6 numbers in its `features` vector** before you transform it. Read the stage statistics to make your prediction exact.

```python todo
# A small pipeline: 2 numeric columns + region
from pyspark.ml import Pipeline
from pyspark.ml.feature import Imputer, VectorAssembler, StandardScaler, StringIndexer, OneHotEncoder
from pyspark.ml.functions import vector_to_array

train_df = spark.sql("""
  SELECT subscriber_id, region, CAST(tenure_months AS DOUBLE) AS tenure_months,
         CASE WHEN subscriber_id % 13 = 0 THEN NULL ELSE avg_weekly_minutes END AS avg_weekly_minutes
  FROM subscribers WHERE subscriber_id % 5 <> 0""")
model = Pipeline(stages=[
    Imputer(inputCols=["avg_weekly_minutes", "tenure_months"], outputCols=["minutes_imp", "tenure_imp"], strategy="median"),
    VectorAssembler(inputCols=["minutes_imp", "tenure_imp"], outputCol="num_vec"),
    StandardScaler(inputCol="num_vec", outputCol="num_scaled", withMean=True, withStd=True),
    StringIndexer(inputCol="region", outputCol="region_idx", handleInvalid="keep"),
    OneHotEncoder(inputCol="region_idx", outputCol="region_ohe"),
    VectorAssembler(inputCols=["num_scaled", "region_ohe"], outputCol="features"),
]).fit(train_df)
new_df = spark.createDataFrame([(9001, "Central", 12.0, None)],
                               "subscriber_id BIGINT, region STRING, tenure_months DOUBLE, avg_weekly_minutes DOUBLE")

# TODO 1: print the medians (stage 0 surrogateDF), mean and std (stage 2) and the region labels (stage 3)
# TODO 2: compute your prediction for the two scaled numbers and the four region slots
# TODO 3: transform new_df and compare with vector_to_array("features")
```

```python solution
display(model.stages[0].surrogateDF)
mean, std = model.stages[2].mean, model.stages[2].std
print("mean:", mean, "std:", std, "labels:", model.stages[3].labelsArray)

med = model.stages[0].surrogateDF.first()["avg_weekly_minutes"]
print("predicted:", [round((med - mean[0]) / std[0], 4), round((12.0 - mean[1]) / std[1], 4), 0.0, 0.0, 0.0, 0.0])
print("actual:   ", [round(v, 4) for v in model.transform(new_df).select(vector_to_array("features")).first()[0]])
# Minutes: the training median, scaled. It is near 0 but not 0, because the median is below the mean.
# Tenure: (12 - mean) / std, about -0.74. Region: "Central" gets the extra "keep" index, which dropLast removes: all zeros.
```

## Exercise 2: what does fitting on the full data change?

Fit the same `Imputer` + `StandardScaler` steps twice: once on the training rows, once on **all** rows. Compare the learned median, mean and std. **Explain** why even a small difference is a problem for the test score.

```python todo
# TODO 1: build a DataFrame from subscribers with avg_weekly_minutes NULL when subscriber_id % 13 = 0
# TODO 2: Pipeline(Imputer(median) -> VectorAssembler -> StandardScaler(withMean=True)), fit on train and on all rows
# TODO 3: print the surrogate value, mean and std of both fitted models side by side
```

```python solution
from pyspark.ml import Pipeline
from pyspark.ml.feature import Imputer, VectorAssembler, StandardScaler

df = spark.sql("""SELECT subscriber_id,
                         CASE WHEN subscriber_id % 13 = 0 THEN NULL ELSE avg_weekly_minutes END AS avg_weekly_minutes
                  FROM subscribers""")
pipe = Pipeline(stages=[
    Imputer(inputCols=["avg_weekly_minutes"], outputCols=["m_imp"], strategy="median"),
    VectorAssembler(inputCols=["m_imp"], outputCol="m_vec"),
    StandardScaler(inputCol="m_vec", outputCol="m_scaled", withMean=True, withStd=True),
])
for name, rows in [("train only", df.filter("subscriber_id % 5 <> 0")), ("all rows", df)]:
    m = pipe.fit(rows)
    print(f"{name:<11} median={m.stages[0].surrogateDF.first()[0]:.2f} "
          f"mean={m.stages[2].mean[0]:.2f} std={m.stages[2].std[0]:.2f}")
# The numbers differ only a little here, because the test rows look like the training rows.
# But the full-data model has seen the test rows: the test set no longer plays "unseen data",
# so its score is optimistic. With drift, small data, or rare categories the gap grows.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS pipe_subscribers")
# dbutils.fs.rm(f"{data.volume(CATALOG, SCHEMA)}/pipe", True)
```

## ⚠️ Common mistakes

- ❌ `pipeline.fit(df)` on all rows, then `randomSplit`. Split first.
- ❌ Calling `fit` again on the test set or on new data. Load the `PipelineModel` and call `transform`.
- ❌ Scaling the one-hot vectors by putting the scaler after the final assembler.
- ❌ `StringIndexer` without `handleInvalid="keep"`: one unseen category fails the whole scoring job.
- ❌ Adding the missing flag in training code only. Scoring needs it too.
- ✅ Save the fitted model to a versioned volume path, and check the reloaded copy gives the same features.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Learn all statistics | `pipeline_model = Pipeline(stages=[...]).fit(train_df)` |
| Apply them | `pipeline_model.transform(test_df)` |
| Inspect | `.stages`, `.surrogateDF`, `.mean`, `.std`, `.labelsArray` |
| Save | `pipeline_model.write().overwrite().save("/Volumes/...")` |
| Load | `PipelineModel.load("/Volumes/...")` |
| Unseen categories | `StringIndexer(..., handleInvalid="keep")` |
