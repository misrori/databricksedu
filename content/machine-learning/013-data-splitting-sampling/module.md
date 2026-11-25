---
title: Split and sample data for ML
summary: Choose between random, stratified, time-based and group-based splits, know what Spark ML cross-validation does and does not do, and draw random, stratified and cluster samples with Spark.
icon: ✂️
level: Intermediate
minutes: 11
group: Data preparation
tags: [Train/test split, Cross-validation, Leakage, Sampling, randomSplit]
---
# Split and sample data for ML

> A model that is scored on rows it has already seen looks great and teaches you nothing. The split decides what "unseen" means, and the right split depends on how the model will meet new data in production.

**The one idea to remember:** make the test set look like the future the model will face: **later dates** for time-ordered data, **new customers** for repeated rows, and nothing from it may shape training.

## 🎯 Why split at all?

| Need | What the split gives you |
|---|---|
| Detect overfitting | A test set the model never saw in training |
| Tune hyperparameters | A validation set you may look at many times |
| Prevent leakage | Statistics fit on train only, then applied to validation and test |
| Honest evaluation | One final test score that estimates real-world performance |

Look at the test set **once**, at the end. Every decision made by looking at it makes it a little less unseen.

## 🔀 Train, validation, test

```viz table
{"title": "randomSplit([0.6, 0.2, 0.2], seed=42) on eight subscribers", "columns": ["subscriber_id", "churned", "random draw", "goes to"],
 "rows": [[1, 0, "", ""], [2, 1, "", ""], [3, 0, "", ""], [4, 0, "", ""], [5, 1, "", ""], [6, 0, "", ""], [7, 0, "", ""], [8, 0, "", ""]],
 "steps": [
  {"label": "Rows", "note": "Each row will get a random number between 0 and 1. The seed makes the numbers repeatable."},
  {"label": "Draw", "note": "The weights become ranges: [0, 0.6) train, [0.6, 0.8) validation, [0.8, 1) test.", "upd": {"0": {"random draw": 0.31}, "1": {"random draw": 0.87}, "2": {"random draw": 0.05}, "3": {"random draw": 0.66}, "4": {"random draw": 0.52}, "5": {"random draw": 0.94}, "6": {"random draw": 0.71}, "7": {"random draw": 0.12}}},
  {"label": "Assign", "note": "Every row lands in exactly one set.", "upd": {"0": {"goes to": "train"}, "1": {"goes to": "test"}, "2": {"goes to": "train"}, "3": {"goes to": "validation"}, "4": {"goes to": "train"}, "5": {"goes to": "test"}, "6": {"goes to": "validation"}, "7": {"goes to": "train"}}},
  {"label": "Approximate", "note": "4 / 2 / 2 here, not 4.8 / 1.6 / 1.6. Proportions are only **approximate**, and the class ratio per set varies too. Test has 1 churner of 2 rows: on small data, check the ratio.", "hl": [1, 5]}
 ]}
```

## 🧪 Try it: a three-way random split

```dataset churn
```

```python run
# 60 / 20 / 20 with a seed, then check sizes and the churn rate per set
from pyspark.sql import functions as F
subs = spark.table("subscribers")
train, val, test = subs.randomSplit([0.6, 0.2, 0.2], seed=42)
for name, d in [("train", train), ("validation", val), ("test", test)]:
    r = d.agg(F.count("*").alias("n"), F.avg("churned").alias("rate")).first()
    print(f"{name:<11} {r.n:>5,} rows   churn rate {r.rate:.3f}")
```

The seed repeats the split only for the **same input**. If the table changes, the split changes, which is one more reason to train on a recorded table version.

## 🔁 Cross-validation

With little data, one validation set gives a noisy score. **K-fold** cross-validation splits the training data into K folds and rotates which fold validates, so every row is validated once. **Stratified** K-fold keeps the class ratio equal in every fold.

```viz code
title: Spark ML cross-validation (display-only)
lang: python
---
from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
from pyspark.ml.evaluation import BinaryClassificationEvaluator
cv = CrossValidator(estimator=pipeline, estimatorParamMaps=grid,
                    evaluator=BinaryClassificationEvaluator(labelCol="churned"),
                    numFolds=5, seed=42)
model = cv.fit(train)
cv_own = CrossValidator(estimator=pipeline, estimatorParamMaps=grid,
                        evaluator=BinaryClassificationEvaluator(labelCol="churned"),
                        numFolds=5, foldCol="fold")
---
3-5 | random K-fold | Rows go to 5 folds at random. Each fold validates once, trained on the other 4.
6 | fit on train only | The test set stays outside cross-validation.
7-9 | foldCol | Your own folds: an integer column with values 0 to 4. Use it for stratified or group-based folds.
```

Stratified, shuffle-split and nested cross-validation are not built in. Tuning is covered in the hyperparameter tuning module.

## 📅 Time-based splits

When rows are ordered in time, a random split trains on October to predict June. That is **look-ahead leakage**: the score is better than production will ever be. Split at **cutoff dates** instead.

```python run
# usage_monthly: May to Oct 2026. Train on the past, validate and test on what follows
usage = spark.table("usage_monthly")
train_t = usage.filter(F.col("month") < "2026-09-01")
val_t   = usage.filter(F.col("month") == "2026-09-01")
test_t  = usage.filter(F.col("month") >= "2026-10-01")
print(f"train {train_t.count():,}  validation {val_t.count():,}  test {test_t.count():,}")
```

Counts are exact here: a filter is a rule, not a draw. Pick the cutoff so the test period looks like the period you will predict.

> Features can leak the future too: "total minutes over all months" used on a June row includes October. Point-in-time lookups (module 030) prevent this.

## ⏩ Forward chaining for time series

```viz table
{"title": "Expanding-window folds over usage_monthly", "columns": ["fold", "train months", "validate", "uses the future?"],
 "rows": [[1, "May - Jul", "Aug", ""], [2, "May - Aug", "Sep", ""], [3, "May - Sep", "Oct", ""], ["CrossValidator", "4 of 5 folds", "1 fold", ""]],
 "steps": [
  {"label": "Fold 1", "note": "Train on the first three months, validate on the next one.", "hl": [0], "upd": {"0": {"uses the future?": "no"}}},
  {"label": "Fold 2", "note": "The window grows by one month. Each fold learns only from the past.", "hl": [1], "upd": {"1": {"uses the future?": "no"}}},
  {"label": "Fold 3", "note": "The last fold validates on the newest month, like production.", "hl": [2], "upd": {"2": {"uses the future?": "no"}}},
  {"label": "CrossValidator", "note": "Even with `foldCol` set to the month, each fold trains on **all other** folds, including later months. Spark ML has no forward chaining: build the windows with date filters.", "hl": [3], "upd": {"3": {"uses the future?": "yes"}}}
 ]}
```

```python run
# Build the forward-chaining windows yourself
months = [r.month for r in usage.select("month").distinct().orderBy("month").collect()]
for i in range(3, len(months)):
    fit_rows = usage.filter(F.col("month") < months[i]).count()
    print(f"fold {i - 2}: train {months[0]} .. {months[i - 1]} ({fit_rows:,} rows) -> validate {months[i]}")
```

## 👥 Group-based splits

Every subscriber has six rows in `usage_monthly`. A random row split puts some of them in train and some in test, so the model partly **recognizes the customer**. Split the distinct ids, then join back.

```python run
# Row split vs id split: how many subscribers end up on both sides?
def shared(a, b):
    return a.select("subscriber_id").distinct().intersect(b.select("subscriber_id").distinct()).count()

tr_rows, te_rows = usage.randomSplit([0.8, 0.2], seed=42)
train_ids, test_ids = usage.select("subscriber_id").distinct().randomSplit([0.8, 0.2], seed=42)
tr_grp, te_grp = usage.join(train_ids, "subscriber_id"), usage.join(test_ids, "subscriber_id")
print(f"row split: {shared(tr_rows, te_rows):,} subscribers in both sets")
print(f"id split:  {shared(tr_grp, te_grp)} subscribers in both sets, rows {tr_grp.count():,} / {te_grp.count():,}")
```

## 🎲 Sampling is not splitting

```viz compare
{"title": "A sample is a smaller copy for exploring or prototyping, not a test set",
 "items": [
  {"icon": "🎲", "title": "Random", "color": "blue", "points": ["Every row equally likely", "`df.sample(fraction=0.1, seed=42)`"]},
  {"icon": "⚖️", "title": "Stratified", "color": "amber", "points": ["A fraction per class: keep or change the ratio", "`df.sampleBy(\"churned\", {0: 0.1, 1: 0.1}, seed=42)`"]},
  {"icon": "🧺", "title": "Cluster", "color": "teal", "points": ["Whole groups: every row of a chosen customer", "Sample distinct ids, then join back"]}
 ]}
```

```python run
# All three on the churn data. Fractions are probabilities, so sizes are approximate
rand_s = subs.sample(withReplacement=False, fraction=0.1, seed=42)
strat_s = subs.sampleBy("churned", fractions={0: 0.1, 1: 0.1}, seed=42)
picked = usage.select("subscriber_id").distinct().sample(fraction=0.1, seed=42)
cluster_s = usage.join(picked, "subscriber_id")
print("random:", rand_s.count(), " stratified:", strat_s.count(),
      " cluster:", cluster_s.count(), "rows of", picked.count(), "subscribers")
display(strat_s.groupBy("churned").count())
```

## Exercise 1: stratified folds for foldCol

`CrossValidator` folds are random. Build your own **stratified** fold column: number the rows within each class in a fixed shuffled order and take the number modulo 5. **Predict first:** how much does the churn rate vary between your folds?

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE split_folds with subscriber_id, churned and fold (0 to 4)
--         hint: pmod(row_number() OVER (PARTITION BY churned ORDER BY xxhash64(subscriber_id)), 5)
-- TODO 2: show rows and churn rate per fold
```

```sql solution
CREATE OR REPLACE TABLE split_folds AS
SELECT subscriber_id, churned,
       pmod(row_number() OVER (PARTITION BY churned ORDER BY xxhash64(subscriber_id)), 5) AS fold
FROM subscribers;

SELECT fold, count(*) AS subscribers, round(avg(churned), 4) AS churn_rate
FROM split_folds GROUP BY fold ORDER BY fold;
-- Every fold has about 1,000 rows and a churn rate within a fraction of a percent of 0.269,
-- because each class is dealt out to the folds like cards. A random K-fold varies more.
```

## Exercise 2: a balanced sample, and where not to use it

For a quick prototype you want about as many churners as stayers. **Predict first:** with `sampleBy("churned", {0: 0.37, 1: 1.0})`, what churn rate does the sample have? Why must the test set never be rebalanced like this?

```python todo
# TODO 1: draw the sample with seed=42
# TODO 2: print its size and churn rate, next to the churn rate of subscribers
```

```python solution
from pyspark.sql import functions as F
subs = spark.table("subscribers")
bal = subs.sampleBy("churned", fractions={0: 0.37, 1: 1.0}, seed=42)
for name, d in [("all", subs), ("balanced", bal)]:
    r = d.agg(F.count("*").alias("n"), F.avg("churned").alias("rate")).first()
    print(f"{name:<9} {r.n:>5,} rows  churn rate {r.rate:.3f}")
# About 0.5: 1,346 churners and about 1,350 stayers. The test set must keep the real ratio (about 0.27),
# otherwise precision and other scores describe a world the model will never see.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS split_folds")
```

## ⚠️ Common mistakes

- ❌ `randomSplit` on time-ordered rows: the model trains on the future.
- ❌ Random row splits when one customer has many rows. Split the ids.
- ❌ Expecting `randomSplit([0.8, 0.2])` to return exactly 80% and 20%.
- ❌ Assuming `CrossValidator` with `foldCol` = month does forward chaining. It trains on later folds too.
- ❌ Rebalancing or sampling the **test** set. Change the training data only.
- ✅ Fix the seed, record the table version, and check the class ratio in every split.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| Random split | `df.randomSplit([0.8, 0.2], seed=42)` (approximate) |
| Time-based split | `df.filter(F.col("month") < cutoff)` and `>= cutoff` |
| Group-based split | Split `df.select("id").distinct()`, then `join` back |
| Own folds | `CrossValidator(..., foldCol="fold")`, values 0 to numFolds - 1 |
| Random / stratified sample | `df.sample(fraction=f, seed=s)` / `df.sampleBy(col, {k: f}, seed=s)` |
| Cluster sample | Sample distinct group ids, then `join` |
