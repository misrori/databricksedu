---
title: How Spark runs your code
summary: Follow a DataFrame query from the line you type to the tasks that run on executors. Learn lazy evaluation, narrow and wide transformations, jobs, stages and tasks, and how to read a query plan with EXPLAIN.
icon: ⚙️
level: Beginner
minutes: 10
group: Apache Spark
tags: [Apache Spark, Catalyst, EXPLAIN, Spark Connect]
---
# How Spark runs your code

> When you write `df.filter(...).groupBy(...)`, nothing is computed. Spark only records what you want. The work starts when you ask for a result, and by then Spark can plan the whole query at once.

**The one idea to remember:** transformations build a plan, an action runs it, and **every shuffle cuts the plan into a new stage**.

## 🧠 Driver and executors

A Spark application has one **driver** and many **executors**.

| Part | What it does |
|---|---|
| **Driver** | Runs your notebook code, holds the `spark` session, builds and optimizes the plan, splits it into tasks, schedules them |
| **Executor** | A process on a worker machine that runs tasks and keeps shuffle files and cached data |
| **Core (slot)** | Runs one task at a time. Total cores = how many tasks run in parallel |
| **Partition** | The chunk of data one task works on |

The driver does not read your data. It sends small tasks to the executors and collects only the final result.

## 💤 Lazy evaluation

**Transformations** (`filter`, `select`, `withColumn`, `join`, `groupBy().agg()`) return a new DataFrame and only extend the plan. **Actions** (`show`, `count`, `collect`, `write`, `display`) run it.

```viz flow
{"title": "orders.filter(...).groupBy(\"product_id\").count().show()",
 "nodes": [{"icon": "📝", "title": "Your code", "sub": "on the driver", "color": "navy"},
           {"icon": "🗺️", "title": "Logical plan", "sub": "what you asked for", "color": "purple"},
           {"icon": "🧮", "title": "Catalyst", "sub": "optimize, pick a physical plan", "color": "blue"},
           {"icon": "⚙️", "title": "Stage 1", "sub": "scan, filter, partial count", "color": "teal"},
           {"icon": "🏁", "title": "Stage 2", "sub": "final count, return rows", "color": "green"}],
 "edges": ["records", "action", "tasks", "shuffle"],
 "steps": [
  {"label": "filter(...)", "focus": [0, 1], "note": "A `Filter` node is added to the logical plan. No file is opened, no executor is busy."},
  {"label": "groupBy().count()", "focus": [0, 1], "note": "Still nothing runs. `GroupedData.count()` is a **transformation** that returns a DataFrame. Only `DataFrame.count()` is an action."},
  {"label": ".show()", "focus": [2], "note": "The action. Catalyst now sees the whole query, optimizes it and turns it into a physical plan. A **job** starts."},
  {"label": "Stage 1 tasks", "focus": [3], "note": "One task per input partition: read the file chunk, keep COMPLETED rows, count per product locally, write **shuffle files** grouped by product_id."},
  {"label": "Stage 2 tasks", "focus": [4], "note": "Each task fetches its product_ids from every stage 1 task over the network, adds up the partial counts, and sends the first 20 rows to the driver."}
 ]}
```

## ↔️ Narrow and wide transformations

```viz compare
{"title": "Does an output partition need data from other partitions?",
 "items": [{"icon": "➡️", "title": "Narrow", "sub": "one input partition → one output partition", "color": "green",
            "points": ["`filter`, `select`, `withColumn`, `union`, `coalesce`", "✅ no data moves between executors", "✅ chained in the **same stage**, row by row"],
            "foot": "Cheap: runs where the data already is"},
           {"icon": "🔀", "title": "Wide", "sub": "output partitions need rows from many inputs", "color": "red",
            "points": ["`groupBy`, `join` (not broadcast), `distinct`, `orderBy`, `repartition`", "❌ rows are **shuffled**: written to disk, sent over the network", "❌ ends a stage, starts a new one"],
            "foot": "Expensive: the main cost in most slow queries"}]}
```

To count orders per product, all rows of product 7 must meet in one task. Rows of product 7 sit in every input file, so Spark has to move them. That move is the shuffle.

## 🧱 Jobs, stages and tasks

```viz layers
{"layers": [{"icon": "📱", "title": "Application", "sub": "one driver and one Spark session: your notebook", "color": "navy"},
            {"icon": "▶️", "title": "Job", "sub": "started by an action such as show, count or write", "color": "purple", "items": ["An action starts one or more jobs"]},
            {"icon": "🧱", "title": "Stage", "sub": "a chain of narrow work between two shuffles", "color": "blue", "items": ["Shuffles are the stage boundaries", "A stage waits for the stages it reads from"]},
            {"icon": "🔩", "title": "Task", "sub": "one per partition of the stage, runs on one core", "color": "teal", "items": ["Failed tasks are retried on another executor"]}]}
```

For the query above: one action, so one job. One shuffle (the `groupBy`), so two stages. A 4-file table might give 4 tasks in stage 1, and the shuffle partition count decides the tasks in stage 2.

## 🧮 Partitions decide the parallelism

| Where | How many partitions |
|---|---|
| Reading files | Roughly one per 128 MB of input (`spark.sql.files.maxPartitionBytes`) |
| After a shuffle | `spark.sql.shuffle.partitions` (200 in open-source Spark), then adjusted at runtime |
| You decide | `repartition(n)` (full shuffle) or `coalesce(n)` (merge, no full shuffle) |

Ten partitions on 64 cores leave 54 cores idle. Ten thousand tiny partitions spend more time scheduling than working. **Adaptive Query Execution** (AQE, on by default) merges small shuffle partitions at runtime, so you rarely tune this by hand.

## 🔍 Catalyst: from query to plan

SQL and DataFrame code end up in the same optimizer, called **Catalyst**. It works in four steps.

| Plan | What happens |
|---|---|
| **Parsed** (unresolved) | Your query as a tree. Names are not checked yet |
| **Analyzed** | Tables and columns are looked up in the catalog, types are resolved |
| **Optimized** | Rules rewrite the tree: push filters down, read only needed columns, fold constants |
| **Physical** | Concrete operators: scan, hash aggregate, exchange, join strategy |

At runtime, AQE can change the physical plan again using real statistics from finished stages. `EXPLAIN EXTENDED` prints all four plans.

## 📋 Reading a physical plan

```viz code
title: EXPLAIN FORMATTED (simplified, open-source operator names)
lang: text
---
AdaptiveSparkPlan (7)
+- HashAggregate (6)
   +- Exchange (5)
      +- HashAggregate (4)
         +- Project (3)
            +- Filter (2)
               +- Scan parquet fact_orders (1)

(1) Scan parquet  ReadSchema: struct<product_id:bigint,status:string>
                  PushedFilters: [IsNotNull(status), EqualTo(status,COMPLETED)]
(4) HashAggregate Keys: [product_id]  Functions: [partial_count(1)]
(5) Exchange      hashpartitioning(product_id, 200)
(6) HashAggregate Keys: [product_id]  Functions: [count(1)]
---
1-7 | Read bottom up | Data flows from the leaf (the scan) up to the root. The numbers point to the details below.
9-10 | Scan | Only 2 of 7 columns are read (**column pruning**) and the filter is pushed into the scan, so files can be skipped.
11 | Partial aggregate | Each stage 1 task counts its own rows first, so far fewer rows are shuffled.
12 | Exchange = shuffle | Rows are hash-partitioned by product_id. This is the **stage boundary**.
13 | Final aggregate | Stage 2 adds up the partial counts per product.
1 | AQE wrapper | `isFinalPlan=false` in EXPLAIN: AQE may still change the plan when the query runs.
```

> On serverless and SQL warehouses, Databricks runs queries with **Photon**. Operator names start with `Photon` (`PhotonGroupingAgg`, `PhotonShuffleExchangeSink`), but the shape is the same. Look for `hashpartitioning(` to find the shuffles.

## 🔌 Spark Connect and serverless

On serverless compute (and standard access clusters), your notebook is a **Spark Connect** client. The `spark` object does not run Spark locally. It builds an unresolved plan and sends it over gRPC to the Spark driver, which plans and runs it and streams results back as Arrow batches.

- ✅ DataFrame API, SQL, `spark.table`, `spark.readStream` work as usual.
- ❌ No `SparkContext` (`sc`), no RDD API (`df.rdd`), no `sc.broadcast` or accumulators.
- Analysis is lazy too: a misspelled column fails when the plan is analyzed (an action, `df.columns`, `df.schema`), not on the line you typed.

## 🧪 Try it: watch nothing happen

```dataset retail
```

Build a query from three transformations. No data is read yet.

```python run
# Build a plan: three transformations, no action
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
completed = orders.filter(F.col("status") == "COMPLETED")
per_product = (completed.groupBy("product_id")
                        .agg(F.count("*").alias("orders"), F.sum("quantity").alias("units")))

print("Columns:", per_product.columns)   # analyzes the plan, reads no rows
```

```python run
# Look at the plan Spark would run
per_product.explain(mode="formatted")
```

```python run
# The action: now a job runs
per_product.orderBy(F.desc("orders")).show(5)
```

```sql run
-- The same query in SQL: parsed, analyzed, optimized and physical plans
EXPLAIN EXTENDED
SELECT product_id, count(*) AS orders, sum(quantity) AS units
FROM fact_orders
WHERE status = 'COMPLETED'
GROUP BY product_id;
```

> In the optimized plan, look for the filter on `status` sitting directly above the relation, and in the physical plan for the scan with only the needed columns. The plans are the same for SQL and Python: both go through Catalyst.

## Exercise 1: count the shuffles

Write a query on `fact_orders`: keep COMPLETED orders, sum `quantity` per `customer_id`, and sort by the sum, highest first. **Before** you run `explain`, predict how many shuffles and how many stages it needs.

```python todo
# TODO 1: build top_customers (filter, groupBy + agg, orderBy) without an action
# TODO 2: write your prediction as a comment: shuffles = ?, stages = ?
# TODO 3: print the physical plan and count the lines with "partitioning("
```

```python solution
from pyspark.sql import functions as F

top_customers = (spark.table("fact_orders")
    .filter(F.col("status") == "COMPLETED")
    .groupBy("customer_id").agg(F.sum("quantity").alias("units"))
    .orderBy(F.desc("units")))

top_customers.explain()
# 2 shuffles: hashpartitioning(customer_id) for the groupBy, rangepartitioning(units) for the orderBy.
# 2 shuffles -> 3 stages. Add .limit(10) and the sort becomes a top-N without a range shuffle.
```

## Exercise 2: catch the optimizer at work

The filter below is written **after** a `withColumn` and a `select`. Predict where it ends up in the optimized plan, and which columns the scan reads.

```python todo
# TODO: build the DataFrame below, then print the extended plan (all four plans)
# spark.table("fact_orders").withColumn("double_qty", F.col("quantity") * 2)
#      .select("order_id", "order_date", "double_qty")
#      .filter(F.col("order_date") >= "2026-01-01")
```

```python solution
from pyspark.sql import functions as F

q = (spark.table("fact_orders")
     .withColumn("double_qty", F.col("quantity") * 2)
     .select("order_id", "order_date", "double_qty")
     .filter(F.col("order_date") >= "2026-01-01"))

q.explain(mode="extended")
# Optimized plan: the Filter is pushed below the Project, next to the relation.
# Physical plan: the scan reads only order_id, order_date and quantity, and lists the date filter
# under DataFilters / PushedFilters, so files whose max order_date is earlier can be skipped.
```

## Exercise 3: where does the error appear?

Predict which line raises the error: the `select`, the `filter`, or the action.

```python todo
# TODO: run this cell and explain the line where it fails
from pyspark.sql import functions as F

typo = spark.table("fact_orders").select("order_id", "quantiy")   # misspelled column
small = typo.filter(F.col("order_id") < 10)
small.show()
```

```python solution
from pyspark.sql import functions as F

typo = spark.table("fact_orders").select("order_id", "quantiy")
small = typo.filter(F.col("order_id") < 10)
try:
    small.show()
except Exception as e:
    print(type(e).__name__, str(e)[:200])
# On serverless (Spark Connect) the plan is analyzed only at .show(), so the error appears there:
# UNRESOLVED_COLUMN ... `quantiy`. On classic dedicated compute it appears at the select line.

# Nothing to clean up: this module created no tables.
```

## ⚠️ Common mistakes

- ❌ "Each transformation runs a job." Transformations only extend the plan. Actions start jobs.
- ❌ "A new stage starts at every transformation." Stages split at **shuffles**. Narrow steps are chained inside one stage.
- ❌ "More executors fix any slow query." One huge partition still runs as one task on one core.
- ❌ Using `sc` or `df.rdd` on serverless. Spark Connect exposes only the DataFrame and SQL APIs.
- ✅ Filter and select columns early, but know that Catalyst often moves them for you.
- ✅ Read the plan with `EXPLAIN` before you tune anything.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See the physical plan | `df.explain()` or `EXPLAIN SELECT ...` |
| See all four plans | `df.explain(mode="extended")` or `EXPLAIN EXTENDED` |
| See operators with details | `df.explain(mode="formatted")` or `EXPLAIN FORMATTED` |
| Find the shuffles | look for `Exchange` / `hashpartitioning(` / `rangepartitioning(` |
| Run the plan | an action: `show`, `count`, `collect`, `display`, `write` |
| Change the partition count | `repartition(n)` (shuffle) or `coalesce(n)` (decrease only) |
