---
title: Window functions
summary: Compute running totals, moving averages, rankings, top-N per group and day-over-day changes with Window.partitionBy().orderBy(), while every input row stays in the result.
icon: 🪟
level: Intermediate
minutes: 11
group: Developing applications with Spark
tags: [Apache Spark, PySpark, Window functions, Ranking, Running total]
---
# Window functions

> Some questions need a value from **other rows** next to every row: the running total so far, the rank inside the category, yesterday's revenue. A `groupBy` cannot answer them, because it collapses the rows. A window function can.

**The one idea to remember:** a window function looks at a **frame** of related rows around the current row, computes one value, and **keeps every row**.

## 🪟 groupBy vs window

```viz compare
{"items": [{"icon": "🧺", "title": "groupBy + agg", "sub": "many rows in, one row per group out", "color": "blue",
            "points": ["`F.sum(\"revenue\")` per category", "Row details are gone", "Answers: *how much per group?*"],
            "foot": "5 categories × 669 days → 5 rows"},
           {"icon": "🪟", "title": "function.over(window)", "sub": "many rows in, the same rows out", "color": "teal",
            "points": ["`F.sum(\"revenue\").over(w)` on every row", "Each row gets a new column", "Answers: *how does this row compare to its group?*"],
            "foot": "5 categories × 669 days → about 3,345 rows"}]}
```

Like `groupBy`, `partitionBy` is a wide transformation: Spark shuffles the rows so that each partition key ends up in one task.

## 🧩 Anatomy of a window

A window spec has up to three parts. Then you attach it to a function with `.over(w)`.

```viz code
title: a running total per category
lang: python
---
from pyspark.sql import functions as F
from pyspark.sql.window import Window

w = (Window.partitionBy("category")
           .orderBy("order_date")
           .rowsBetween(Window.unboundedPreceding, Window.currentRow))

trend = daily.withColumn("running_total", F.sum("revenue").over(w))
---
2 | import | `Window` lives in its own module, not in `F`.
4 | partitionBy | Which rows belong together. The window never crosses into another category.
5 | orderBy | The order inside each partition. Needed for ranking, lag, lead and running totals.
6 | frame | Which rows of the partition count for the current row: here, from the first row up to this one.
8 | over | Any aggregate (`sum`, `avg`, `min`, `max`, `count`) or window-only function can use the window.
```

## 🎬 How the frame moves

Step through `rowsBetween(Window.unboundedPreceding, Window.currentRow)` over five days of one category. The highlighted rows are the frame.

```viz table
{"title": "F.sum(\"revenue\").over(w) for category = Books",
 "columns": ["order_date", "revenue", "running_total"],
 "rows": [["2026-10-01", 10, null], ["2026-10-02", 20, null], ["2026-10-03", 5, null], ["2026-10-04", 15, null], ["2026-10-05", 30, null]],
 "steps": [
  {"label": "Sort the partition", "note": "Rows of one category, sorted by `order_date`. Nothing is computed yet."},
  {"label": "Row 1", "note": "The frame is just the first row: 10.", "upd": {"0": {"running_total": 10}}},
  {"label": "Row 2", "note": "The frame grows: 10 + 20 = 30.", "upd": {"1": {"running_total": 30}}, "hl": [0]},
  {"label": "Row 3", "note": "10 + 20 + 5 = 35.", "upd": {"2": {"running_total": 35}}, "hl": [0, 1]},
  {"label": "Row 4", "note": "The start stays fixed (`unboundedPreceding`), the end follows the current row.", "upd": {"3": {"running_total": 50}}, "hl": [0, 1, 2]},
  {"label": "Row 5", "note": "80. With `rowsBetween(-2, 0)` the frame would slide instead: only the last 3 rows, a **moving** sum.", "upd": {"4": {"running_total": 80}}, "hl": [0, 1, 2, 3]}
 ]}
```

## 🧪 Try it: running totals and moving averages

```dataset retail
```

```python run
# Daily revenue per category from real orders
from pyspark.sql import functions as F
from pyspark.sql.window import Window

orders = (spark.table("fact_orders")
          .filter(~F.col("status").isin("TEST", "CANCELLED"))
          .join(spark.table("dim_product"), "product_id")
          .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))))

daily = orders.groupBy("category", "order_date").agg(F.round(F.sum("revenue"), 2).alias("revenue"))
```

```python run
# Running total and a 7-row moving average per category
w = Window.partitionBy("category").orderBy("order_date")

trend = (daily
    .withColumn("running_total",
                F.round(F.sum("revenue").over(w.rowsBetween(Window.unboundedPreceding, Window.currentRow)), 2))
    .withColumn("avg_7_rows", F.round(F.avg("revenue").over(w.rowsBetween(-6, Window.currentRow)), 2)))

trend.write.mode("overwrite").saveAsTable("win_daily_trend")
display(trend.filter(F.col("category") == "Electronics").orderBy("order_date"))
```

`rowsBetween(-6, 0)` means "the last 7 **rows**". That is 7 days only if no day is missing. For true time ranges, order by a number such as days and use `rangeBetween`.

## 🥇 row_number, rank, dense_rank

The three ranking functions differ only in how they treat **ties**.

```viz table
{"title": "orderBy(F.desc(\"revenue\")) with a tie at 400",
 "columns": ["revenue", "row_number", "rank", "dense_rank"],
 "rows": [[500, 1, 1, 1], [400, 2, 2, 2], [400, 3, 2, 2], [300, 4, 4, 3]]}
```

```python run
# Compare the three ranking functions on a tie
products = spark.createDataFrame(
    [("Books", "B1", 500), ("Books", "B2", 400), ("Books", "B3", 400), ("Books", "B4", 300)],
    "category STRING, product STRING, revenue INT")
w_rank = Window.partitionBy("category").orderBy(F.desc("revenue"))

display(products.select("product", "revenue",
                        F.row_number().over(w_rank).alias("row_number"),
                        F.rank().over(w_rank).alias("rank"),
                        F.dense_rank().over(w_rank).alias("dense_rank")))
```

`row_number` breaks ties arbitrarily, so B2 and B3 may swap between runs. Add a tie-breaker column to `orderBy` when the order must be stable.

## 🏆 Top N per group

The classic pattern: number the rows inside each partition, then filter on that number.

```python run
# The three best-selling products of each category
by_product = orders.groupBy("category", "product_name").agg(F.round(F.sum("revenue"), 0).alias("revenue"))
w_best = Window.partitionBy("category").orderBy(F.desc("revenue"), "product_name")

top3 = (by_product
        .withColumn("rn", F.row_number().over(w_best))
        .filter(F.col("rn") <= 3)
        .orderBy("category", "rn"))

top3.write.mode("overwrite").saveAsTable("win_top_products")
display(top3)
```

Use `row_number` for **exactly** N rows per group. Use `rank` or `dense_rank` when ties should all be included.

## ⏮️ lag, lead, first and last

`lag` reads a value from an earlier row, `lead` from a later row. The first row has no previous row, so `lag` returns `null` there.

```python run
# Day-over-day change, and the first and last value of each category
w = Window.partitionBy("category").orderBy("order_date")
w_all = w.rowsBetween(Window.unboundedPreceding, Window.unboundedFollowing)

changes = (daily
    .withColumn("prev_day", F.lag("revenue", 1).over(w))
    .withColumn("change", F.round(F.col("revenue") - F.col("prev_day"), 2))
    .withColumn("next_day", F.lead("revenue", 1).over(w))
    .withColumn("first_value", F.first("revenue").over(w))
    .withColumn("last_wrong", F.last("revenue").over(w))       # frame ends at the current row
    .withColumn("last_value", F.last("revenue").over(w_all)))  # frame is the whole partition
display(changes.filter(F.col("category") == "Books").orderBy("order_date"))
```

With `orderBy` and no explicit frame, the frame runs from the first row to the **current** row. That is why `last_wrong` just repeats `revenue`.

## Exercise 1: days between orders

For each real order, compute how many days passed since the same customer's previous order. **Predict first**: how many rows get a `null` gap, and roughly what is the average gap? Each customer places about 110 orders over 22 months.

```python todo
from pyspark.sql import functions as F
from pyspark.sql.window import Window

real = spark.table("fact_orders").filter(~F.col("status").isin("TEST", "CANCELLED"))

# TODO 1: a window per customer, ordered by order_date, then order_id as a tie-breaker
# TODO 2: prev_date with F.lag, gap_days with F.datediff("order_date", "prev_date")
# TODO 3: count the null gaps and compute the average gap
```

```python solution
w = Window.partitionBy("customer_id").orderBy("order_date", "order_id")

gaps = (real.withColumn("prev_date", F.lag("order_date").over(w))
            .withColumn("gap_days", F.datediff("order_date", "prev_date")))

display(gaps.agg(F.count(F.when(F.col("gap_days").isNull(), 1)).alias("null_gaps"),
                 F.round(F.avg("gap_days"), 1).alias("avg_gap_days")))
# null_gaps = 500: one first order per customer. The average gap is about 6 days
# (669 days / ~110 orders). avg skips the nulls.
```

## Exercise 2: each product's share of its category

Compute each product's share of its category's revenue, and its dense rank inside the category. **Predict**: what do the shares add up to per category? Does the share window need an `orderBy`?

```python todo
from pyspark.sql import functions as F
from pyspark.sql.window import Window

by_product = (spark.table("fact_orders")
    .filter(~F.col("status").isin("TEST", "CANCELLED"))
    .join(spark.table("dim_product"), "product_id")
    .groupBy("category", "product_name")
    .agg(F.sum(F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))).alias("revenue")))

# TODO 1: share = revenue / sum(revenue) over a window partitioned by category (no orderBy)
# TODO 2: dense_rank by revenue, highest first, inside the category
# TODO 3: save as win_product_share, then check that the shares sum to 1 per category
```

```python solution
w_cat = Window.partitionBy("category")                          # no orderBy: the frame is the whole category
w_rank = Window.partitionBy("category").orderBy(F.desc("revenue"))

share = (by_product
         .withColumn("share", F.round(F.col("revenue") / F.sum("revenue").over(w_cat), 4))
         .withColumn("rank_in_category", F.dense_rank().over(w_rank)))
share.write.mode("overwrite").saveAsTable("win_product_share")

display(share.groupBy("category").agg(F.round(F.sum("share"), 2).alias("total_share")))   # 1.0 each
# With an orderBy, the sum would become a running total and the shares would be wrong.

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS win_product_share")
# spark.sql("DROP TABLE IF EXISTS win_top_products")
# spark.sql("DROP TABLE IF EXISTS win_daily_trend")
```

## ⚠️ Common mistakes

- ❌ `Window.orderBy("order_date")` with no `partitionBy`. Every row is moved into **one** partition and one task. Spark warns about it, and it does not scale.
- ❌ `F.last(...)` or `F.max(...)` over an ordered window, expecting the whole partition. The default frame stops at the current row.
- ❌ `row_number` without a tie-breaker. Results can change from run to run.
- ❌ `rowsBetween(-6, 0)` called "last 7 days" when some days have no rows.
- ✅ Need one row per group? Use `groupBy`. Need every row plus group context? Use a window.

## 🧭 Cheat sheet

| I want… | PySpark |
|---|---|
| A window | `w = Window.partitionBy("k").orderBy("d")` |
| Running total | `F.sum("x").over(w.rowsBetween(Window.unboundedPreceding, Window.currentRow))` |
| Moving average of 7 rows | `F.avg("x").over(w.rowsBetween(-6, 0))` |
| Top N per group | `F.row_number().over(w)` then `.filter(F.col("rn") <= N)` |
| Previous / next value | `F.lag("x", 1).over(w)` / `F.lead("x", 1).over(w)` |
| Share of the group total | `F.col("x") / F.sum("x").over(Window.partitionBy("k"))` |
