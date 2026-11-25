---
title: Feature scaling with Spark ML
summary: Put numeric features on comparable scales with StandardScaler, MinMaxScaler or RobustScaler, learn the statistics from the training data only, and check the result.
icon: 📏
level: Intermediate
minutes: 9
group: Data preparation
tags: [Spark ML, StandardScaler, MinMaxScaler, RobustScaler, Leakage]
---
# Feature scaling with Spark ML

> Tenure is counted in months, the monthly fee in dollars and usage in minutes per week. Some models read these raw magnitudes as importance. Scaling puts the features on comparable scales before the model sees them.

**The one idea to remember:** a scaler is a small model. It **learns** its statistics (mean and standard deviation, or min and max, or median and IQR) from the **training data only**, and then applies those same numbers to test and new data.

## 📏 Same order, new units

Scaling does not change the order of the values. It only changes their units and range. The most common form is the **z-score**: z = (x − μ) / σ. It says how many standard deviations a value sits from the mean.

| Feature in `subscribers` | Raw range | After z-scores |
|---|---|---|
| `tenure_months` | 1 to 71 | about −1.3 to 2.0 |
| `monthly_fee` | 16 to 75 | about −1.1 to 2.0 |
| `avg_weekly_minutes` | 0 to 726 | about −2.2 to 4.5 |

Without scaling, a distance between two subscribers is mostly the difference in minutes, simply because minutes are the biggest numbers.

## 🎬 From raw values to z-scores

```viz table
{"title": "avg_weekly_minutes, scaled with the training statistics", "columns": ["set", "subscriber", "minutes", "z"],
 "rows": [["train", 1, 100, ""], ["train", 2, 200, ""], ["train", 3, 300, ""], ["train", 4, 400, ""]],
 "steps": [
  {"label": "Training rows", "note": "Four training rows. The scaler has not seen any test data."},
  {"label": "Fit", "note": "`fit` learns **μ = 250** and **σ = 129.1** (the sample standard deviation) from these four rows only.", "hl": [0, 1, 2, 3]},
  {"label": "Transform train", "note": "z = (x − 250) / 129.1. The training z-scores have mean 0 and standard deviation 1 by construction.", "upd": {"0": {"z": -1.16}, "1": {"z": -0.39}, "2": {"z": 0.39}, "3": {"z": 1.16}}},
  {"label": "Test rows arrive", "note": "Two test rows. Their own mean is 255, but the scaler does **not** refit.", "add": [["test", 5, 180, ""], ["test", 6, 330, ""]], "hl": [4, 5]},
  {"label": "Transform test", "note": "Same μ and σ: (180 − 250) / 129.1 = −0.54 and (330 − 250) / 129.1 = 0.62. Their mean is 0.04, close to 0 but not 0. That is expected and honest.", "upd": {"4": {"z": -0.54}, "5": {"z": 0.62}}, "hl": [4, 5]}
 ]}
```

## ⚖️ Three scalers, one outlier

The same five values, `100, 200, 300, 400, 2000`, through each Spark ML scaler. Watch what happens to the four normal values.

```viz compare
{"items": [
 {"icon": "📐", "title": "StandardScaler", "sub": "(x − mean) / std, with withMean=True", "color": "blue",
  "points": ["μ = 600, σ = 791", "Normal values: −0.63, −0.51, −0.38, −0.25", "Outlier: 1.77", "❌ The outlier inflates σ and squeezes the rest"], "foot": "Fine without severe outliers"},
 {"icon": "📦", "title": "MinMaxScaler", "sub": "(x − min) / (max − min)", "color": "amber",
  "points": ["min = 100, max = 2000", "Normal values: 0, 0.05, 0.11, 0.16", "Outlier: 1", "❌ Most sensitive: one value sets the whole range"], "foot": "For models that need bounded inputs"},
 {"icon": "🛡️", "title": "RobustScaler", "sub": "(x − median) / IQR, with withCentering=True", "color": "green",
  "points": ["median = 300, IQR = 200", "Normal values: −1, −0.5, 0, 0.5", "Outlier: 8.5", "✅ The normal values keep their spread"], "foot": "For outlier-heavy features"}
 ]}
```

For a heavily skewed feature, a **log transform first** (`log1p`), then a scaler, is another good option.

## ⚙️ Spark's defaults are not scikit-learn's

```viz code
title: pyspark.ml.feature (display-only)
lang: python
---
assembler = VectorAssembler(inputCols=["tenure_months", "monthly_fee"], outputCol="num_vec")

StandardScaler(inputCol="num_vec", outputCol="num_scaled")      # withMean=False, withStd=True
StandardScaler(inputCol="num_vec", outputCol="num_scaled", withMean=True, withStd=True)

MinMaxScaler(inputCol="num_vec", outputCol="num_scaled")        # min=0.0, max=1.0

RobustScaler(inputCol="num_vec", outputCol="num_scaled")        # withCentering=False, withScaling=True
RobustScaler(inputCol="num_vec", outputCol="num_scaled", withCentering=True)
---
1 | Vector first | Every Spark ML scaler reads **one vector column**. Assemble the numeric columns first.
3 | Default StandardScaler | Divides by σ but does **not** subtract the mean. scikit-learn centers by default; Spark does not.
4 | Why the default | Centering turns a sparse vector dense, which can blow up memory for wide sparse data. For dense tabular features, set `withMean=True` to get real z-scores.
6 | MinMaxScaler | Uses the training min and max. A new value above the training max scales to more than 1.
8 | Default RobustScaler | Divides by the IQR (Q3 − Q1) but does not subtract the median.
9 | Median centering | `withCentering=True` also subtracts the median.
```

## 🎯 Which models need it

| Model family | Scale? | Why |
|---|---|---|
| Regularized linear / logistic regression | Yes | The L1/L2 penalty should not depend on units |
| SVM, neural networks | Yes | Optimization is faster and more stable |
| KNN, K-Means | Yes | Distances are dominated by the largest units |
| PCA | Usually | Components follow the largest variance |
| Decision trees, random forests, GBTs | No | A split on rescaled values is the same split |

Signs you need it: features that differ by orders of magnitude, slow convergence, odd nearest neighbours, or tiny-unit features that get over-penalized.

## 🔒 Fit on train, apply everywhere

```viz flow
{"nodes": [
  {"icon": "✂️", "title": "Split", "sub": "train / test first", "color": "gray"},
  {"icon": "🧮", "title": "scaler.fit(train)", "sub": "learns μ and σ", "color": "blue"},
  {"icon": "📦", "title": "StandardScalerModel", "sub": ".mean, .std", "color": "navy"},
  {"icon": "🔁", "title": "transform", "sub": "train, test, new data", "color": "green"}
 ],
 "edges": ["train only", "fitted", "same numbers"],
 "steps": [
  {"label": "Split first", "focus": [0], "note": "Split before any step that learns from data. Otherwise test rows shape the statistics."},
  {"label": "Fit", "focus": [1], "note": "`fit` is the only moment the scaler looks at values. Give it the training rows."},
  {"label": "Keep the model", "focus": [2], "note": "The fitted model stores μ and σ per feature. You can read them in `.mean` and `.std`."},
  {"label": "Reuse", "focus": [3], "note": "`transform` applies the stored numbers. It re-learns nothing, so test and production data are scaled exactly like training data."}
 ]}
```

`transform` adds a new column and keeps the originals. Keep them: Spark scalers have no inverse transform, but `x = z · σ + μ` gets you back.

## 🧪 Try it: scale three churn features

```dataset churn
```

```python run
# Fit a StandardScaler on train and apply it to both sets
from pyspark.ml.feature import VectorAssembler, StandardScaler

df = spark.table("subscribers")
train_df = df.filter("subscriber_id % 5 <> 0")   # a reproducible 80/20 split
test_df = df.filter("subscriber_id % 5 = 0")

num_cols = ["tenure_months", "monthly_fee", "avg_weekly_minutes"]
assembler = VectorAssembler(inputCols=num_cols, outputCol="num_vec")
scaler = StandardScaler(inputCol="num_vec", outputCol="num_scaled", withMean=True, withStd=True)

scaler_model = scaler.fit(assembler.transform(train_df))   # statistics from train only
train_out = scaler_model.transform(assembler.transform(train_df))
test_out = scaler_model.transform(assembler.transform(test_df))

print("mean:", scaler_model.mean)
print("std: ", scaler_model.std)
display(test_out.select("subscriber_id", *num_cols, "num_scaled").limit(5))
```

```python run
# Validate: about 0 and 1 on train, close but not exact on test
from pyspark.sql import functions as F
from pyspark.ml.functions import vector_to_array

def scaled_stats(out):
    z = vector_to_array("num_scaled")
    return out.select([F.round(F.avg(z[i]), 3).alias(f"{c}_mean") for i, c in enumerate(num_cols)]
                      + [F.round(F.stddev(z[i]), 3).alias(f"{c}_std") for i, c in enumerate(num_cols)])

display(scaled_stats(train_out))
display(scaled_stats(test_out))
```

## 🔬 Try it: an outlier squeezes MinMaxScaler

Ten rows get an impossible extra 5,000 minutes, like a unit error in the source. Then the three scalers are fit on the same column. Compare how wide the **normal** rows stay.

```sql run
-- Ten bad values in an otherwise normal column
CREATE OR REPLACE TABLE scale_outliers AS
SELECT subscriber_id,
       CASE WHEN subscriber_id % 500 = 0 THEN avg_weekly_minutes + 5000 ELSE avg_weekly_minutes END AS minutes
FROM subscribers;
```

```python run
# Spread (p95 - p05) of the normal rows after each scaler
from pyspark.ml.feature import VectorAssembler, StandardScaler, MinMaxScaler, RobustScaler
from pyspark.ml.functions import vector_to_array
from pyspark.sql import functions as F

vec = VectorAssembler(inputCols=["minutes"], outputCol="v").transform(spark.table("scale_outliers"))
scalers = {"StandardScaler": StandardScaler(inputCol="v", outputCol="s", withMean=True),
           "MinMaxScaler": MinMaxScaler(inputCol="v", outputCol="s"),
           "RobustScaler": RobustScaler(inputCol="v", outputCol="s", withCentering=True)}
rows = []
for name, sc in scalers.items():
    out = sc.fit(vec).transform(vec).withColumn("x", vector_to_array("s")[0])
    r = (out.filter("subscriber_id % 500 <> 0")
            .agg(F.percentile_approx("x", 0.05).alias("p05"), F.percentile_approx("x", 0.95).alias("p95")).first())
    rows.append((name, round(r.p05, 3), round(r.p95, 3), round(r.p95 - r.p05, 3)))
display(spark.createDataFrame(rows, "scaler STRING, p05 DOUBLE, p95 DOUBLE, spread DOUBLE"))
```

> MinMaxScaler squeezes 99.8% of the rows into a band about 0.06 wide. StandardScaler is squeezed too: the outliers inflate σ, and the spread falls from about 3.3 (clean column) to 1.4. RobustScaler keeps about 2.4.

## Exercise 1: predict a test row

Fit a StandardScaler on `avg_weekly_minutes` (training rows only) and read μ and σ. **Before you transform**, compute by hand the z-score of subscriber 5, a test row. Then predict what the **default** StandardScaler (no `withMean`) would return for the same row.

```python todo
# TODO 1: split subscribers with subscriber_id % 5 (test = 0), assemble avg_weekly_minutes into a vector
# TODO 2: fit StandardScaler(withMean=True) on train and print model.mean[0] and model.std[0]
# TODO 3: compute (x - mean) / std for subscriber 5 by hand, then compare with the transformed value
# TODO 4: predict, then check, the value with StandardScaler defaults
```

```python solution
from pyspark.ml.feature import VectorAssembler, StandardScaler
from pyspark.ml.functions import vector_to_array

df = spark.table("subscribers")
train_df, test_df = df.filter("subscriber_id % 5 <> 0"), df.filter("subscriber_id % 5 = 0")
asm = VectorAssembler(inputCols=["avg_weekly_minutes"], outputCol="m_vec")
train_vec, row_vec = asm.transform(train_df), asm.transform(test_df.filter("subscriber_id = 5"))

centered = StandardScaler(inputCol="m_vec", outputCol="m_z", withMean=True, withStd=True).fit(train_vec)
mu, sigma = centered.mean[0], centered.std[0]
x = row_vec.first()["avg_weekly_minutes"]
print(f"mu={mu:.2f} sigma={sigma:.2f} x={x}")
print("by hand:", round((x - mu) / sigma, 4))
print("spark:  ", round(centered.transform(row_vec).select(vector_to_array("m_z")[0]).first()[0], 4))

default = StandardScaler(inputCol="m_vec", outputCol="m_z").fit(train_vec)   # withMean=False
print("default:", round(default.transform(row_vec).select(vector_to_array("m_z")[0]).first()[0], 4),
      "= x / sigma =", round(x / sigma, 4))
# The centered value is negative (115 minutes is below the mean). The default is positive: x / sigma only.
```

## Exercise 2: MinMaxScaler beyond 1

Fit a MinMaxScaler on `tenure_months` using only subscribers with a tenure of **48 months or less**. Then transform the subscribers with a longer tenure. **Predict first:** what is the largest scaled value, and is it inside [0, 1]?

```python todo
# TODO 1: assemble tenure_months into a vector
# TODO 2: fit MinMaxScaler on rows with tenure_months <= 48; print originalMin and originalMax
# TODO 3: transform rows with tenure_months > 48 and show the max scaled value
```

```python solution
from pyspark.ml.feature import VectorAssembler, MinMaxScaler
from pyspark.ml.functions import vector_to_array
from pyspark.sql import functions as F

vec = VectorAssembler(inputCols=["tenure_months"], outputCol="t_vec").transform(spark.table("subscribers"))
mm = MinMaxScaler(inputCol="t_vec", outputCol="t_scaled").fit(vec.filter("tenure_months <= 48"))
print("originalMin:", mm.originalMin, "originalMax:", mm.originalMax)

new = mm.transform(vec.filter("tenure_months > 48"))
display(new.agg(F.max(vector_to_array("t_scaled")[0]).alias("max_scaled")))
# (71 - 1) / (48 - 1) is about 1.49: new values outside the training range land outside [0, 1].

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS scale_outliers")
```

## ⚠️ Common mistakes

- ❌ Expecting z-scores from `StandardScaler()` with defaults. Set `withMean=True`.
- ❌ Fitting the scaler on the full dataset, or refitting it on the test set. Fit once, on train.
- ❌ Passing raw columns to a scaler. Assemble them into a vector first.
- ❌ Scaling one-hot vectors and 0/1 flags. Scale only the continuous columns.
- ❌ MinMaxScaler on a column with outliers. Use RobustScaler, or log-transform first.
- ✅ Keep the original columns next to the scaled vector, so results stay readable.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Vector input | `VectorAssembler(inputCols=[...], outputCol="num_vec")` |
| Real z-scores | `StandardScaler(..., withMean=True, withStd=True)` |
| Bounded [0, 1] | `MinMaxScaler(...)`, read `.originalMin` / `.originalMax` |
| Outlier-resistant | `RobustScaler(..., withCentering=True)` |
| Read the statistics | `scaler_model.mean`, `scaler_model.std` |
| Check the result | `vector_to_array("num_scaled")[i]`, then `avg` and `stddev` |
