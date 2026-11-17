---
title: "Recap: Introduction to Apache Spark"
summary: Recap of module 1 of Apache Spark Programming with Databricks. Explain how the driver, executors and shuffles run a query, read and write DataFrames, and build a small ETL job without pulling big data onto the driver.
icon: 🔥
level: Beginner
minutes: 10
group: Apache Spark Programming with Databricks
tags: [Apache Spark, Driver, Executors, Shuffle, DAG, DataFrames, ETL]
---
# Recap: Introduction to Apache Spark

> Module 1 of 4. What Spark is, how a cluster runs your code (**driver, executors, jobs, stages, tasks, shuffles**), and the first DataFrame skills: **read, transform, write**.

**The one idea to remember:** you describe the result, and Spark plans it lazily. The **driver** cuts the plan into stages at every **shuffle**, and **executors** do the real work in parallel, one task per partition. Only small results should come back to the driver.

## 🗺️ What we covered

```viz timeline
{"title": "The lessons of the module",
 "items": [
  {"label": "1", "title": "What is Apache Spark", "color": "navy", "note": "An open-source engine for **distributed** data processing: one program, many machines."},
  {"label": "2", "title": "Runtime architecture", "color": "blue", "note": "**Driver**, **executors**, cluster manager. Jobs, stages and tasks. **Lazy evaluation**. Spark Connect and serverless."},
  {"label": "3", "title": "DataFrames and SQL", "color": "teal", "note": "One engine, two languages. Reading and writing files and tables."},
  {"label": "4", "title": "Distributed programming", "color": "amber", "note": "**Partitions**, driver code vs executor code, why `collect()` on big data hurts."},
  {"label": "5", "title": "ETL with the DataFrame API", "color": "green", "note": "`select`, `filter`, `withColumn`, dates, deduplication, writing a Delta table. The course demo used flight data. Here we use **retail** orders."}
 ]}
```

## 🔥 What Spark is

Spark splits a big dataset into **partitions** and processes them on many cores at once. You write one program. Spark turns it into thousands of small tasks.

```viz compare
{"items": [
  {"icon": "💻", "title": "pandas on one machine", "sub": "single process", "color": "gray", "points": ["✅ Simple, great for small data", "❌ Data must fit in one machine's memory", "❌ One core does most of the work"]},
  {"icon": "🔥", "title": "Spark on a cluster", "sub": "many executors", "color": "amber", "points": ["✅ Scales to terabytes", "✅ Same API for batch, SQL and streaming", "❌ Moving data between machines (shuffle) costs time"]}
 ]}
```

## 🖥️ Driver node and worker nodes

```viz layers
{"title": "Who does what",
 "layers": [
  {"icon": "🧠", "title": "Driver", "sub": "runs your notebook code and the SparkSession", "color": "navy", "items": ["Builds and optimizes the plan", "Splits it into stages and tasks", "Receives only the final result"]},
  {"icon": "🗂️", "title": "Cluster manager", "sub": "gives the driver machines", "color": "purple", "items": ["Databricks manages this for you"]},
  {"icon": "⚙️", "title": "Worker nodes with executors", "sub": "the processes that do the work", "color": "blue", "items": ["Each core = one **task slot**", "Executors **read the data from storage themselves**", "They write shuffle files and output files"]}
 ]}
```

The data never flows through the driver on its way in. A cluster with 4 workers of 8 cores runs **32 tasks at the same time**.

## 🧱 Jobs, stages, tasks and the DAG

The plan is a **DAG** (directed acyclic graph) of steps. The driver cuts it into stages wherever data must move between machines.

| Level | What it is | Created by |
|---|---|---|
| **Job** | All the work for one action | `count()`, `display()`, `write` |
| **Stage** | Steps that run without moving data | Cut at every **wide** dependency (shuffle) |
| **Task** | One stage on one partition | One per partition, runs on one core |

**Narrow** steps (`filter`, `select`, `withColumn`) stay in a stage. **Wide** steps (`groupBy`, `join`, `distinct`, `orderBy`) start a new one.

## 🔀 What a shuffle is

A shuffle moves rows so that all rows with the same key end up in the same partition. It has two sides.

```viz table
{"title": "groupBy(\"product_id\").count(), two map tasks, two reducers",
 "columns": ["task", "product_id", "count", "goes to"],
 "rows": [["map 1", 7, 120, "?"], ["map 1", 12, 80, "?"], ["map 2", 7, 95, "?"], ["map 2", 12, 60, "?"]],
 "steps": [
  {"label": "Map side", "note": "Each map task counts the rows **in its own partition** (a partial count)."},
  {"label": "hash(key)", "note": "`hash(product_id) % 2` picks a reducer. Rows are written to **local shuffle files**, one bucket per reducer.", "upd": {"0": {"goes to": "reducer 0"}, "1": {"goes to": "reducer 1"}, "2": {"goes to": "reducer 0"}, "3": {"goes to": "reducer 1"}}},
  {"label": "Fetch", "note": "Reducer 0 **fetches its bucket from every map task over the network**.", "hl": [0, 2]},
  {"label": "Reduce side", "note": "It adds the partial counts: product 7 has 215 orders.", "add": [["reducer 0", 7, 215, "result"]], "hl": [4]}
 ]}
```

## 🔎 One query, traced end to end

`spark.table("fact_orders").filter("status = 'COMPLETED'").groupBy("product_id").count()`, then `display()`.

```viz flow
{"nodes": [
  {"icon": "🧠", "title": "Driver", "sub": "plan + DAG", "color": "navy"},
  {"icon": "1️⃣", "title": "Stage 1", "sub": "scan, filter, partial count", "color": "blue", "items": ["one task per input split"]},
  {"icon": "🔀", "title": "Shuffle", "sub": "files by hash(product_id)", "color": "red"},
  {"icon": "2️⃣", "title": "Stage 2", "sub": "final count per product", "color": "purple"},
  {"icon": "📋", "title": "Result", "sub": "40 rows to the driver", "color": "green"}
 ],
 "edges": ["tasks", "shuffle write", "shuffle read", "collect result"],
 "steps": [
  {"label": "Lazy", "focus": [0], "note": "`filter` and `groupBy` only build a plan. **Nothing runs** until `display()`, the action, starts a job."},
  {"label": "Stage 1", "focus": [1], "note": "Executors read their own part of the files, drop non-COMPLETED rows and count per product **locally**."},
  {"label": "Shuffle", "focus": [2], "note": "Partial counts are written to shuffle files by `hash(product_id)`. This is the **stage boundary**."},
  {"label": "Stage 2", "focus": [3], "note": "Each reducer fetches its bucket from all map tasks and adds them up. AQE can merge tiny reducer partitions."},
  {"label": "Result", "focus": [4], "note": "Only **40 small rows** travel back to the driver. 60,000 orders never left the executors."}
 ]}
```

The **Driver, workers, shuffle and the DAG** module goes deeper. **How Spark runs your code** shows the same plan in the UI.

## 💤 Lazy evaluation

```viz code
title: transformations vs actions
lang: python
---
orders = spark.table("fact_orders")
done = orders.filter("status = 'COMPLETED'")
by_product = done.groupBy("product_id").count()
by_product.explain()
display(by_product)
by_product.write.mode("overwrite").saveAsTable("t")
---
1-3 | Transformations | Each line returns a new DataFrame and only extends the plan. No data is read.
4 | explain() | Prints the optimized plan. Still no job.
5 | Action | `display()` starts a **job**. The optimizer saw the whole chain, so it can push the filter into the scan.
6 | Another action | A second, separate job. Spark recomputes from the source.
```

## 🔌 Spark Connect and serverless

```viz compare
{"items": [
  {"icon": "🖥️", "title": "Classic compute", "sub": "your notebook is attached to the driver", "color": "blue", "points": ["Full Spark UI", "RDD API and `spark.sparkContext` available", "You choose node types and sizes"]},
  {"icon": "☁️", "title": "Serverless (Spark Connect)", "sub": "a thin client sends plans to a remote driver", "color": "teal", "points": ["✅ Starts in seconds, no tuning", "✅ **Query profile** instead of the Spark UI", "❌ No RDD API, no `sparkContext`, no `cache()`"]}
 ]}
```

The DataFrame and SQL code is the same on both.

## 📖 DataFrames, SQL, reading and writing

A DataFrame is a distributed table with a schema. SQL and the DataFrame API compile to **the same plan**.

```python
df = (spark.read.format("csv")
      .option("header", "true")
      .schema("order_id BIGINT, order_date DATE, quantity INT, status STRING")
      .load("/Volumes/shop/raw/landing/orders/"))          # or .option("inferSchema", "true")

df.write.mode("overwrite").saveAsTable("orders_bronze")    # Delta table in Unity Catalog
df.write.mode("append").format("parquet").save("/Volumes/shop/raw/export/orders")

spark.sql("SELECT status, count(*) FROM orders_bronze GROUP BY status")   # same engine
```

An explicit schema avoids a second pass over the files to infer types.

## 🧩 Driver code vs executor code

Code in DataFrame expressions runs **on the executors**. Plain Python around it runs **on the driver**.

- ❌ `rows = big_df.collect()` pulls every row into driver memory and can crash it.
- ❌ A Python `for` loop over rows runs on one core.
- ✅ `display(df)`, `df.limit(10)`, `df.take(5)`: only a few rows come back.
- ✅ Aggregate first, then `collect()` the small result.
- ✅ Express logic with built-in functions so every partition is processed in parallel.

## 🧹 ETL with the DataFrame API

```python
from pyspark.sql import functions as F

clean = (raw
  .select("order_id", "order_date", "customer_id", "product_id", "quantity", "discount", "status")
  .filter(F.col("status").isin("COMPLETED", "OPEN"))       # drop TEST and CANCELLED
  .dropDuplicates(["order_id"])                             # dedupe on the key
  .withColumn("order_date", F.to_date("order_date"))         # string -> DATE
  .withColumn("order_month", F.trunc("order_date", "month"))
  .withColumn("order_year", F.year("order_date")))

clean.write.mode("overwrite").saveAsTable("orders_silver")
```

Every step returns a new DataFrame, so the chain reads like a recipe.

## 🧪 Try it: read, clean and write orders

```dataset retail
```

Land one raw CSV file of **retail** orders, run the ETL chain and write a Delta table.

```python run
# Land one raw CSV file of orders (fresh=True starts clean) and read it
from pyspark.sql import functions as F

BASE = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="sri", n_files=1, fresh=True)
raw = (spark.read.format("csv").option("header", "true").option("inferSchema", "true")
       .load(f"{BASE}/fact_orders/"))
raw.printSchema()
print(raw.count(), "raw rows")
```

```python run
# ETL: filter, dedupe, dates, join a dimension, derive revenue, write a Delta table
products = spark.table("dim_product").select("product_id", "category", "unit_price")
clean = (raw
    .filter(F.col("status").isin("COMPLETED", "OPEN"))
    .dropDuplicates(["order_id"])
    .withColumn("order_date", F.to_date("order_date"))
    .withColumn("order_month", F.trunc("order_date", "month"))
    .join(products, "product_id")
    .withColumn("revenue", F.round(F.col("quantity") * F.col("unit_price") * (1 - F.col("discount")), 2))
    .select("order_id", "order_date", "order_month", "category", "quantity", "revenue", "status"))

clean.write.mode("overwrite").saveAsTable("sri_orders_clean")
display(spark.table("sri_orders_clean").groupBy("order_month")
        .agg(F.round(F.sum("revenue"), 0).alias("revenue")).orderBy("order_month"))
```

## 🧪 Try it: partitions, the plan and the driver

```python run
# Rows per partition, before and after repartition (a built-in function, no RDD API needed)
orders = spark.table("fact_orders")
display(orders.groupBy(F.spark_partition_id().alias("partition")).count().orderBy("partition"))
display(orders.repartition(8).groupBy(F.spark_partition_id().alias("partition")).count().orderBy("partition"))
```

```python run
# The traced query: filter -> groupBy -> count. Find the shuffle (an Exchange) in the plan
by_product = orders.filter("status = 'COMPLETED'").groupBy("product_id").count()
by_product.explain()

# Safe: the result is aggregated first, so only 40 rows reach the driver
top = by_product.orderBy(F.desc("count")).limit(5).collect()
print([(r["product_id"], r["count"]) for r in top])

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS sri_orders_clean")
```

## ⚠️ Common mistakes

- ❌ `collect()` or `toPandas()` on a large DataFrame. The driver runs out of memory.
- ❌ Expecting a transformation to run when you write it. Nothing happens until an **action**.
- ❌ Thinking more `groupBy` and `join` steps are free. Each one can add a **shuffle**.
- ❌ `inferSchema` on large production files. Give a **schema**.
- ❌ Writing to `dbfs:/` paths. Use **Unity Catalog tables** and **volumes**.
- ❌ Using `spark.sparkContext` or RDDs on serverless. They are not available there.

## 🧭 Cheat sheet

| Question | Answer |
|---|---|
| Who plans the work? | The **driver** |
| Who reads the data? | **Executors**, one task per partition |
| How many tasks run at once? | Total executor **cores** (task slots) |
| What cuts a stage? | A **shuffle** (`groupBy`, `join`, `distinct`, `orderBy`) |
| What starts a job? | An **action** (`count`, `display`, `write`) |
| What to bring to the driver? | Only **small**, aggregated results |

**Next module:** *Developing Applications with Apache Spark*: aggregations, joins, window functions and complex types.
