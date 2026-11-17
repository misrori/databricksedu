---
title: "Monitoring Spark: the Spark UI and query profile"
summary: Find out why a Spark query is slow. Read the Spark UI on classic compute and the query profile on serverless, and turn task metrics such as skew, spill and shuffle size into a fix.
icon: 🩺
level: Intermediate
minutes: 10
group: Monitoring and optimization
tags: [Apache Spark, Spark UI, Query profile, Data skew, Spill]
---
# Monitoring Spark: the Spark UI and query profile

> A slow query is a symptom. The Spark UI (classic compute) and the query profile (serverless and SQL warehouses) show where the time went, so you fix the cause instead of guessing.

**The one idea to remember:** never judge a stage by its total time. Compare the **slowest task with the median task**, and look at what that task read, shuffled and spilled.

## 🗺️ The Spark UI tabs

On classic compute, open it from the compute page (**Spark UI** tab) or from a cell: expand **Spark Jobs** under the output and click **View**. Jobs, stages and tasks are explained in *How Spark runs your code*.

```viz tree
{"title": "What each tab answers",
 "root": {"icon": "🩺", "label": "Spark UI", "sub": "one per cluster, live while it runs", "color": "navy", "children": [
   {"icon": "🧾", "label": "Jobs", "sub": "which actions ran, how long, did any fail?", "color": "blue"},
   {"icon": "🧱", "label": "Stages", "sub": "task metrics: duration, shuffle, spill, GC", "color": "red"},
   {"icon": "🗄️", "label": "Storage", "sub": "cached DataFrames and their size", "color": "gray"},
   {"icon": "⚙️", "label": "Environment", "sub": "Spark configs and versions in effect", "color": "gray"},
   {"icon": "🖥️", "label": "Executors", "sub": "per-machine memory, task time, GC, logs", "color": "teal"},
   {"icon": "🔎", "label": "SQL / DataFrame", "sub": "the query plan with rows per operator", "color": "purple"}
 ]}}
```

Most diagnoses happen in two tabs: **Stages** for the numbers, **SQL / DataFrame** for the plan.

## 🔬 Reading one stage

A stage page starts with **Summary Metrics** for all its tasks: min, 25th percentile, median, 75th percentile and max. Step through a diagnosis of a join stage on a large orders table.

```viz table
{"title": "Summary metrics for 200 completed tasks", "columns": ["Metric", "Min", "Median", "Max"],
 "rows": [["Duration", "2 s", "3 s", "2.1 min"], ["Shuffle read", "18 MB", "25 MB", "1.4 GB"],
          ["Spill (memory)", "0 B", "0 B", "3.1 GB"], ["Spill (disk)", "0 B", "0 B", "880 MB"],
          ["GC time", "0.1 s", "0.2 s", "9 s"]],
 "steps": [
  {"label": "Open the stage", "note": "The stage took over 2 minutes. More machines would not help yet: first find out **which tasks** were slow."},
  {"label": "Duration", "note": "The median task needs 3 seconds, the slowest needs 2 minutes. One **straggler** holds the whole stage while the other cores sit idle.", "hl": [0]},
  {"label": "Shuffle read", "note": "The straggler read 56 times more data than the median. Same code, more rows: this is **data skew**, not a slow machine.", "hl": [1]},
  {"label": "Spill", "note": "Its rows did not fit in execution memory, so the task wrote them to local disk and read them back. Spill (memory) is the size in memory, Spill (disk) the compressed size on disk.", "hl": [2, 3]},
  {"label": "GC time", "note": "High garbage collection time is the JVM struggling with the same oversized partition. It is a side effect here, not the cause.", "hl": [4]},
  {"label": "Diagnosis", "note": "One hot key. Count rows per join key to find it, then broadcast the small side, let AQE split the partition, or salt the key (see *Joins and shuffles*)."}
 ]}
```

## 🩹 From symptom to cause

| Symptom in the UI | Likely cause | First fix |
|---|---|---|
| Max task time far above the median | Skewed key | Broadcast, AQE skew join, salting |
| Spill (disk) above zero | Partitions too big for memory | More shuffle partitions, less data per task |
| Thousands of tasks of a few ms | Too many small files or partitions | `OPTIMIZE`, fewer output files |
| Shuffle write close to the input size | Wide shuffle on unfiltered data | Filter and select before the join |
| `BatchEvalPython` / `ArrowEvalPython` is slow | Python UDF | Built-in functions |
| Long GC time on every task | Memory pressure | Smaller partitions, fewer wide rows |

## 🔎 The SQL / DataFrame tab

This tab draws the physical plan of one query as a graph. Every operator shows **how many rows** came out of it, so you can see where data shrinks or explodes. Step through `completed orders per product`.

```viz flow
{"title": "Rows flowing through the plan",
 "nodes": [{"icon": "📂", "title": "Scan fact_orders", "sub": "60,000 rows", "color": "blue", "items": ["files read, files pruned"]},
           {"icon": "🧹", "title": "Filter", "sub": "about 52,800 rows", "color": "teal", "items": ["status = 'COMPLETED'"]},
           {"icon": "➗", "title": "Partial aggregate", "sub": "up to 40 rows per task", "color": "purple"},
           {"icon": "🌐", "title": "Exchange", "sub": "shuffle by product_id", "color": "amber", "items": ["shuffle write and read"]},
           {"icon": "🏁", "title": "Final aggregate", "sub": "40 rows", "color": "green"}],
 "edges": ["", "", "", ""],
 "steps": [
  {"label": "Scan", "focus": [0], "note": "The scan reports rows and bytes read. If it reads far more than the filter keeps, data skipping is not working."},
  {"label": "Filter", "focus": [1], "note": "About 12% of the rows are dropped (CANCELLED, OPEN, TEST). The filter runs inside the same tasks as the scan."},
  {"label": "Partial aggregate", "focus": [2], "note": "Each task counts its own rows first. Thousands of rows become at most 40 per task **before** the shuffle."},
  {"label": "Exchange", "focus": [3], "note": "The shuffle is a stage boundary. Small row counts here mean a cheap shuffle. A row count that **grows** after a join is a warning sign."},
  {"label": "Final aggregate", "focus": [4], "note": "The partial counts are added up: 40 rows. The plan only shows real numbers **after** an action has run."}
 ]}
```

## ☁️ Serverless: the query profile

Serverless notebooks and SQL warehouses have **no Spark UI**: you do not own the cluster. You get the **query profile** instead.

```viz compare
{"items": [{"icon": "🖥️", "title": "Classic compute", "sub": "Spark UI", "color": "blue",
            "points": ["Spark Jobs → **View** under the cell", "Task-level metrics: min, median, max", "Executors, GC and logs per machine"],
            "foot": "You own the cluster, you see its internals"},
           {"icon": "☁️", "title": "Serverless and SQL warehouses", "sub": "Query profile", "color": "teal",
            "points": ["**See performance** under the cell output", "**Query History** page for earlier runs", "Operator graph: time, rows, bytes, spill, files pruned"],
            "foot": "The same questions, answered per operator"}]}
```

The questions do not change: which operator took the time, how many rows went in and out, was anything spilled or pruned.

## 🧪 Try it: time a query and read its plan

```dataset retail
```

```python run
# Time an action, then print the formatted plan
import time
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
per_product = (orders.filter(F.col("status") == "COMPLETED")
                     .groupBy("product_id")
                     .agg(F.count("*").alias("orders")))

start = time.perf_counter()
rows = per_product.collect()      # only the action does work, so time the action
print(f"{len(rows)} rows in {time.perf_counter() - start:.2f} s")
per_product.explain("formatted")
```

Now open the run: **See performance** under the output on serverless, **Spark Jobs → View** on classic.

```python run
# What would the Stages tab show? Rows per task after shuffling by product_id
parts = (orders.repartition(8, "product_id")
               .groupBy(F.spark_partition_id().alias("partition"))
               .agg(F.count("*").alias("rows")))

display(parts.orderBy(F.desc("rows")))
display(parts.agg(F.min("rows").alias("min"),
                  F.percentile_approx("rows", 0.5).alias("median"),
                  F.max("rows").alias("max")))
```

> Product 1 alone has about 13,700 orders, so the partition that holds it is far bigger than the rest. In the Stages tab that partition is the task with the long bar.

## Exercise 1: spread the rows evenly

Run the same per-partition count after `repartition(8)` **without** a column (round-robin). Predict min, median and max first. Then explain why a `groupBy("product_id")` still cannot avoid putting all of product 1 in one task.

```python todo
# TODO 1: orders = spark.table("fact_orders"); repartition(8) with no column
# TODO 2: count rows per F.spark_partition_id()
# TODO 3: show min, median and max of those counts
```

```python solution
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
parts = (orders.repartition(8)
               .groupBy(F.spark_partition_id().alias("partition"))
               .agg(F.count("*").alias("rows")))
display(parts.agg(F.min("rows").alias("min"),
                  F.percentile_approx("rows", 0.5).alias("median"),
                  F.max("rows").alias("max")))
# About 7,500 rows each: round-robin ignores the values, so there is no skew.
# A groupBy or join on product_id must bring every row of one key into one task,
# so the hot key comes back. Partial aggregation (count per task first) keeps it cheap for groupBy.
```

## Exercise 2: predict the stages from the plan

Build completed orders per region (join `dim_customer`). Before you run it, predict how many shuffles the plan has and whether the busy region (EMEA, about 45% of customers) would show up as skew.

```python todo
# TODO 1: join fact_orders (status = 'COMPLETED') to dim_customer on customer_id
# TODO 2: groupBy("region") and sum the quantity
# TODO 3: explain("formatted"): count the shuffle exchanges (hashpartitioning), then run it with display()
```

```python solution
from pyspark.sql import functions as F

orders = spark.table("fact_orders").filter(F.col("status") == "COMPLETED")
customers = spark.table("dim_customer")
per_region = (orders.join(customers, "customer_id")
                    .groupBy("region")
                    .agg(F.sum("quantity").alias("units")))
per_region.explain("formatted")
display(per_region)
# dim_customer (500 rows) is broadcast: a broadcast exchange is not a shuffle.
# One shuffle, hashpartitioning(region): two stages. No skew problem, because each task
# sends at most 4 partial sums (one per region) through the shuffle, not raw orders.
```

## ⚠️ Common mistakes

- ❌ Judging a stage by its total time. Compare the slowest task to the median task.
- ❌ Adding workers to fix skew. One task still does the hot key's work, on one core.
- ❌ Timing a transformation. `filter` and `groupBy` return at once; only the action does the work.
- ❌ Looking for the Spark UI on serverless. Use **See performance** and **Query History**.
- ✅ Run a query twice before you compare timings. The first run includes warm-up.
- ✅ Check rows per operator. A join that outputs more rows than it receives usually has a duplicate key.

## 🧭 Cheat sheet

| I want to know… | Look at |
|---|---|
| Which action was slow | Spark UI **Jobs**, or Query History |
| Whether one task is a straggler | **Stages** → Summary Metrics: max vs median duration |
| Whether data did not fit in memory | **Stages**: Spill (memory) and Spill (disk) |
| Where rows shrink or explode | **SQL / DataFrame** graph, or the query profile |
| The plan before running anything | `df.explain("formatted")` |
| Performance on serverless | **See performance** under the cell output |
