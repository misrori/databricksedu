---
title: Distributed systems programming fundamentals
summary: Learn which lines of your notebook run on the driver and which run on the executors, why collect() on big data fails, and how to write set-based, re-runnable Spark code instead of Python loops.
icon: 🌐
level: Beginner
minutes: 10
group: Introduction to Apache Spark
tags: [Apache Spark, Driver, Partitions, Idempotency, Lineage]
---
# Distributed systems programming fundamentals

> Your notebook looks like ordinary Python, but the data lives on many machines. Code that is fine on a laptop can be slow or crash when the data is spread out. The trick is to know **where** each line runs.

**The one idea to remember:** send the work to the data, not the data to your code. Describe **what** you want for the whole set, and bring back only small results.

## 🗺️ Where does each line run?

Your Python runs on the **driver**. DataFrame operations are only described there and run on the **executors**, one task per partition. (The full story of jobs, stages and lazy evaluation is in *How Spark runs your code*.)

```viz code
title: One cell, two places
lang: python
---
threshold = 3                                   # driver: a plain Python int
orders = spark.table("fact_orders")             # driver: a plan, no rows read
big = orders.filter(F.col("quantity") > threshold)
per_day = big.groupBy("order_date").count()     # still only a plan

per_day.write.mode("overwrite").saveAsTable("dist_per_day")
rows = per_day.collect()                        # results travel to the driver
print(len(rows))                                # driver: plain Python again
---
1 | Driver | Normal Python variables live in the notebook process.
2-4 | Plan only | Each line returns a new DataFrame. The driver records the steps. No data moves.
6 | Executors | The write is an action. Executors read, filter, count and write files **in parallel**. The driver never sees the rows.
7 | Back to the driver | `collect()` copies every result row into driver memory. Fine for ~670 days, fatal for 600 million orders.
8 | Driver | From here on `rows` is an ordinary Python list.
```

## 🧩 Partitions are the unit of parallelism

A DataFrame is split into **partitions**. One task processes one partition on one core, so the number of partitions caps how much work runs at the same time.

| Situation | Effect |
|---|---|
| 4 partitions, 64 cores | 60 cores sit idle |
| 64 even partitions, 64 cores | every core busy |
| 1 partition holds half the rows | one slow task decides the run time (skew) |

You rarely set partitions by hand: file reads, shuffles and Adaptive Query Execution choose them. Your job is to keep the work **inside** the DataFrame, so Spark can spread it.

## 💥 collect() brings everything home

```viz flow
{"title": "orders.collect() on a big table",
 "nodes": [{"icon": "📦", "title": "Executor 1", "sub": "partitions 1-100", "color": "teal"},
           {"icon": "📦", "title": "Executor 2", "sub": "partitions 101-200", "color": "teal"},
           {"icon": "📦", "title": "Executor 3", "sub": "partitions 201-300", "color": "teal"},
           {"icon": "🧠", "title": "Driver", "sub": "one process, limited memory", "color": "red"}],
 "edges": ["", "", "all rows"],
 "steps": [
  {"label": "Read", "focus": [0, 1, 2], "note": "Executors read their partitions in parallel. Total memory and cores grow with the cluster."},
  {"label": "collect()", "focus": [3], "note": "Every row is serialized and sent to **one** process. The driver does not grow with the cluster."},
  {"label": "Out of memory", "focus": [3], "note": "The result exceeds the result-size limit or driver memory. The query fails, or the notebook restarts and loses its state."},
  {"label": "The fix", "focus": [0, 1, 2], "note": "Aggregate or filter on the executors first. `collect()`, `toPandas()` and `display()` are fine for **small** results."}
 ]}
```

- `df.take(5)` and `df.limit(5)` stop early: Spark reads only what it needs.
- `toPandas()` is `collect()` plus a pandas copy. Same rule, more memory.

## 🧺 Think in sets, not rows

```viz compare
{"title": "Total units of COMPLETED orders per product",
 "items": [{"icon": "🐌", "title": "Row by row", "sub": "a Python loop on the driver", "color": "red",
            "points": ["`for row in df.collect(): ...`", "❌ all 60,000 rows copied to one machine", "❌ one core does the work", "❌ breaks as the data grows"],
            "foot": "Data moves to the code"},
           {"icon": "🚀", "title": "Set based", "sub": "one DataFrame expression", "color": "green",
            "points": ["`df.filter(...).groupBy(\"product_id\").agg(F.sum(\"quantity\"))`", "✅ each executor works on the partitions it read", "✅ only 40 result rows travel", "✅ Catalyst can push the filter into the scan"],
            "foot": "Code moves to the data"}]}
```

This is **data locality** in practice: executors read their own slices straight from cloud storage, filter and pre-aggregate them where they are, and ship only small partial results.

## 🧬 Immutable data, recorded lineage

A DataFrame is never changed. `withColumn` or `filter` returns a **new** DataFrame, and the old one stays as it was. Each DataFrame remembers the steps that built it: its **lineage**.

```viz timeline
{"title": "Why lineage makes failures cheap",
 "items": [
  {"label": "1", "title": "spark.table", "color": "navy", "note": "The source is fixed: the Delta table version that the query read."},
  {"label": "2", "title": "filter", "color": "blue", "note": "A new DataFrame that points back to step 1. The source is untouched."},
  {"label": "3", "title": "withColumn", "color": "blue", "note": "Another new DataFrame. Three plans now exist, but no data was copied."},
  {"label": "4", "title": "Executor lost", "color": "red", "note": "A machine dies while it holds partition 17 of the result."},
  {"label": "5", "title": "Recompute", "color": "green", "note": "Spark replays the lineage for **partition 17 only** on another executor. No other work is repeated."}
 ]}
```

Because inputs never change, replaying the steps gives the same answer, as long as the steps are deterministic.

## 🎒 Closures travel, they do not come back

When you use your own Python function in a UDF, Spark **serializes** it together with the variables it uses and ships a copy to every executor.

```python
counter = 0

@F.udf("int")
def plus_one(q):
    global counter
    counter += 1          # changes the executor's copy only
    return q + 1

spark.table("fact_orders").select(plus_one("quantity")).collect()
print(counter)            # still 0 on the driver
```

- Executors cannot send variables back. Return results as columns and aggregate them.
- Keep captured objects small: a big dictionary is shipped with every task. Join a table instead.

## 🔁 Writes you can safely re-run

Tasks are retried, jobs are re-run after failures, and people press Run twice. A good write is **idempotent**: running it again gives the same table.

```viz table
{"title": "dist_daily: loading 2026-10-01", "columns": ["order_id", "order_date", "quantity"],
 "rows": [[101, "2026-10-01", 2], [102, "2026-10-01", 1]],
 "steps": [
  {"label": "Run 1: append", "note": "The day's two orders are added. Correct."},
  {"label": "Re-run: append", "note": "The job is retried. `append` adds the same rows again: **duplicates**.", "add": [[101, "2026-10-01", 2], [102, "2026-10-01", 1]], "hl": [2, 3]},
  {"label": "Fix: overwrite the day", "note": "`mode(\"overwrite\")` with `replaceWhere` replaces exactly that day, however often it runs.", "del": [0, 1, 2, 3], "add": [[101, "2026-10-01", 2], [102, "2026-10-01", 1]]}
 ]}
```

Avoid non-deterministic inputs too: `limit()` without `orderBy`, `rand()` without a seed, or `current_timestamp()` can give a different answer on a retry.

## 🧪 Try it: partitions, results and closures

```dataset retail
```

See how the rows are spread over partitions. `spark_partition_id()` tells each row where it lives.

```python run
# Rows per partition, before and after repartition
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
display(orders.groupBy(F.spark_partition_id().alias("partition")).count().orderBy("partition"))

spread = orders.repartition(8)
display(spread.groupBy(F.spark_partition_id().alias("partition")).count().orderBy("partition"))
```

```python run
# take() returns Python objects, limit() returns a DataFrame
first = orders.take(3)
print(type(first), first[0])

small = orders.limit(3)
print(type(small))

# Aggregate on the executors first, then bring the small result home
per_region = (orders.join(spark.table("dim_customer"), "customer_id")
                    .groupBy("region").agg(F.count("*").alias("orders"))
                    .toPandas())
print(per_region)
```

```python run
# A UDF changes the executor's copy of a variable, never the driver's
counter = 0

@F.udf("int")
def plus_one(q):
    global counter
    counter += 1
    return q + 1

orders.limit(100).select(plus_one("quantity").alias("q1")).collect()
print("counter on the driver:", counter)
```

## Exercise 1: replace the loop

The code in the comments works on a laptop. Rewrite it as one DataFrame expression. Then answer: how many rows travel to the driver in each version?

```python todo
# TODO: rewrite this set-based (units per product_id for COMPLETED orders, highest first)
# totals = {}
# for row in spark.table("fact_orders").collect():
#     if row.status == "COMPLETED":
#         totals[row.product_id] = totals.get(row.product_id, 0) + row.quantity
```

```python solution
from pyspark.sql import functions as F

totals = (spark.table("fact_orders")
          .filter(F.col("status") == "COMPLETED")
          .groupBy("product_id")
          .agg(F.sum("quantity").alias("units"))
          .orderBy(F.desc("units")))
display(totals)
# The loop copies all 60,000 rows to the driver and sums them on one core.
# The DataFrame version sums on the executors and returns only 40 rows.
```

## Exercise 2: make the load re-runnable

Load the orders of one day into `dist_daily`. First use `append` and run it twice. Predict the count. Then make it idempotent.

```python todo
# TODO 1: create an empty dist_daily with the fact_orders columns
# TODO 2: append the orders of 2026-10-01 twice and print the count
# TODO 3: write the day with mode("overwrite") and option("replaceWhere", ...) twice, print the count
```

```python solution
from pyspark.sql import functions as F

day = "2026-10-01"
batch = spark.table("fact_orders").filter(F.col("order_date") == day)
batch.limit(0).write.mode("overwrite").saveAsTable("dist_daily")       # empty table, right schema

for _ in range(2):
    batch.write.mode("append").saveAsTable("dist_daily")
print("append twice:", spark.table("dist_daily").count(), "expected", batch.count())   # doubled

for _ in range(2):
    (batch.write.mode("overwrite")
          .option("replaceWhere", f"order_date = '{day}'")
          .saveAsTable("dist_daily"))
print("replaceWhere twice:", spark.table("dist_daily").count())                         # correct

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS dist_daily")
```

## ⚠️ Common mistakes

- ❌ `collect()` or `toPandas()` on a whole table "just to look". Use `display(df)` or `df.limit(20)`.
- ❌ Python loops over rows, or one `spark.sql` call per row. Write one set-based query.
- ❌ Updating a driver variable inside a UDF and expecting it to change.
- ❌ `append` in a job that may be retried. Overwrite the slice (`replaceWhere`) or use `MERGE`.
- ✅ Filter and aggregate first, then bring home the small result.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Look at a few rows | `display(df)`, `df.show(5)`, `df.take(5)` |
| Keep a small DataFrame for more work | `df.limit(n)` |
| Bring a small result to Python | `df.collect()`, `df.toPandas()` after an aggregate |
| See how rows are spread | `df.groupBy(F.spark_partition_id()).count()` |
| Re-run a load safely | `mode("overwrite")` + `replaceWhere`, or `MERGE INTO` |
| Use a lookup in a transformation | join a table, do not capture a big dict |
