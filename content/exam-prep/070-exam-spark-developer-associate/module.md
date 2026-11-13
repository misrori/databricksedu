---
title: "Apache Spark Developer Associate: exam prep"
summary: What the Spark Developer Associate exam covers, the facts and API details to know per domain, the classic traps, and a three-week study plan.
icon: 🎓
level: Intermediate
minutes: 14
group: Associate
tags: [Certification, Apache Spark, PySpark]
---
# Apache Spark Developer Associate: exam prep

> For developers who write PySpark every day. Passing shows that you understand how Spark executes a DataFrame program and that you can read and write correct PySpark code: transformations, joins, I/O, streaming and tuning.

**The one idea to remember:** most questions are code-reading questions, so before you look at the options, ask two things: **does this line run at all** (right API, right argument types), and **when does it run** (lazy transformation or action).

## 📋 The exam at a glance

| Item | Fact |
|---|---|
| Questions | 45 scored multiple-choice, plus up to 10 unscored items |
| Time | 90 minutes |
| Code | All code is Python (PySpark) |
| Fee | USD 200 |
| Validity | 2 years |
| Delivery | Online proctored or test center, English only |

- Databricks does **not publish the passing score**. Aim for 80% or more on practice tests you have not seen before.
- The current version was published on October 8, 2026, and uses the Spark 3.5 / 4.x API: AQE on by default, `dropDuplicatesWithinWatermark`, Spark Connect.

## 🗺️ Domains and weights

```viz layers
{"title": "Seven domains, weighted",
 "layers": [
  {"icon": "🧱", "title": "DataFrame / Dataset API applications · 30%", "color": "blue", "items": ["Columns, filters, explode", "Dedup and aggregations", "Joins and unions", "UDFs, broadcast, accumulators"]},
  {"icon": "🏗️", "title": "Spark architecture and components · 20%", "color": "navy", "items": ["Driver, executors, cores", "Job, stage, task", "Lazy evaluation, shuffles", "Caching and storage levels"]},
  {"icon": "🗄️", "title": "Using Spark SQL · 20%", "color": "teal", "items": ["Data sources and JDBC", "Save modes, partitionBy", "SQL on files, temp views"]},
  {"icon": "🔧", "title": "Troubleshooting and tuning · 10%", "color": "amber", "items": ["repartition vs coalesce", "Skew and AQE", "Driver and executor logs"]},
  {"icon": "🌊", "title": "Structured Streaming · 10%", "color": "purple", "items": ["Output modes and sinks", "Windows and watermarks", "Streaming dedup"]},
  {"icon": "🔌", "title": "Spark Connect and deployment · 5%", "color": "gray", "items": ["Thin client over gRPC", "Local, client, cluster mode"]},
  {"icon": "🐼", "title": "Pandas API on Spark · 5%", "color": "green", "items": ["pyspark.pandas", "Pandas UDFs"]}
 ]}
```

Half the exam is the DataFrame API plus architecture. Spend half your study time writing and reading PySpark, not reading slides.

## 🏗️ Architecture: how one action becomes tasks

Step through `df.filter(...).groupBy("country").count().collect()` on a file with 8 input partitions.

```viz flow
{"title": "Application → job → stage → task",
 "nodes": [
  {"icon": "🧠", "title": "Driver", "sub": "SparkSession, plans, schedules", "color": "navy"},
  {"icon": "📋", "title": "Job", "sub": "one per action", "color": "blue"},
  {"icon": "🧩", "title": "Stage 1", "sub": "read + filter + partial count", "color": "teal"},
  {"icon": "🔀", "title": "Shuffle", "sub": "stage boundary", "color": "amber"},
  {"icon": "🧩", "title": "Stage 2", "sub": "final count per country", "color": "teal"}
 ],
 "edges": ["collect()", "plan", "write shuffle files", "read shuffle files"],
 "steps": [
  {"label": "Lazy", "focus": [0], "note": "`filter`, `groupBy` and `count()` on grouped data are **transformations**. The driver only builds a plan. Nothing runs yet."},
  {"label": "Action", "focus": [0, 1], "note": "`collect()` is an **action**, so the driver creates **one job** and lets Catalyst optimize the whole plan."},
  {"label": "Narrow work", "focus": [2], "note": "`filter` is narrow, so it is pipelined into the first stage: **8 tasks**, one per input partition, each on one core of an executor."},
  {"label": "Shuffle", "focus": [3], "note": "`groupBy` is wide. Rows with the same key must meet, so data is written to disk and moved over the network. A new stage starts here."},
  {"label": "Wide work", "focus": [4], "note": "The second stage has `spark.sql.shuffle.partitions` tasks (default **200**), which AQE may coalesce at runtime. Results go back to the driver."}
 ]}
```

- **Executors** run tasks and hold the cache. The driver does not process partitions.
- Parallel tasks are capped by **total cores**. A skewed task still runs on one core.
- A lost partition is **recomputed from lineage**; failed tasks are retried (4 attempts by default).

## ⚡ Lazy evaluation, partitions and caching

| Topic | What the exam expects |
|---|---|
| Narrow vs wide | `select`, `filter`, `withColumn`, `union`, `coalesce` are narrow. `groupBy`, `join` (not broadcast), `distinct`, `orderBy`, `repartition` shuffle |
| Partition sizes | File reads split at `spark.sql.files.maxPartitionBytes` (128 MB). After a shuffle: `spark.sql.shuffle.partitions` (200) |
| Caching | `cache()` is **lazy**: the first action fills it. DataFrame default is memory and disk (`MEMORY_AND_DISK_DESER` in PySpark 3+); `persist(StorageLevel.DISK_ONLY)` picks another level, `_2` levels replicate |
| Session | `SparkSession.builder.getOrCreate()` returns the existing session. Datasets are Scala/Java only; Python has DataFrames |

Long **GC time** in the Spark UI means memory pressure: too much caching, too many Python objects, or partitions that are too big.

## 🗄️ Spark SQL: sources, save modes, tables and views

| Save mode | When the target already has data |
|---|---|
| `error` / `errorifexists` | **Default.** The write fails |
| `append` | Adds the new rows |
| `overwrite` | Replaces the data |
| `ignore` | Silently does nothing |

- CSV and JSON need a schema (given or inferred); Parquet, ORC and Delta carry their own. JDBC reads through **one connection** unless you set `partitionColumn`, `lowerBound`, `upperBound` and `numPartitions`.
- SQL on files: ``SELECT * FROM parquet.`/path` ``, also `json`, `csv`, `orc`, `text` (one `value` column) and `delta`.
- `partitionBy` for low-cardinality columns only. `bucketBy` and `sortBy` work **only with `saveAsTable`**. `insertInto` matches columns by **position**.
- `createOrReplaceTempView` lives for the session; a global temp view lives for the application and is read as `global_temp.name`.

## 🧱 DataFrame API: the details that decide answers

```viz code
title: the PySpark lines the exam loves
lang: python
---
df.filter((F.col("qty") > 0) & (F.col("country") == "DE"))
df.withColumn("first", F.split("full_name", " ").getItem(0))
df.select("id", F.explode("items").alias("item"))
df.na.drop(how="all")
df.dropDuplicates(["order_id"])
df.agg(F.count("coupon"), F.approx_count_distinct("customer"))
df.withColumn("day", F.from_unixtime("epoch_s", "yyyy-MM-dd"))
df.withColumn("ts", (F.col("epoch_ms") / 1000).cast("timestamp"))
df.withColumn("wd", F.dayofweek("order_date"))
---
1 | Filters | Combine conditions with `&`, `|`, `~` and **parentheses**. Python `and` / `or` raise an error on Columns.
2 | split | `split` returns an array; `getItem(0)` takes an element. `withColumn` with an existing name **replaces** the column.
3 | explode | One row per element. `explode` drops rows with NULL or empty arrays; `explode_outer` keeps them.
4-5 | Clean | `how="all"` drops rows where **every** value is NULL (the default `any` drops rows with one NULL). `dropDuplicates` keeps one arbitrary row per key.
6 | Aggregates | `count(col)` skips NULLs, `count("*")` does not. `approx_count_distinct` trades a small error for no exact-distinct cost.
7-8 | Epochs | `from_unixtime` takes **seconds** and returns a **string**. Divide milliseconds by 1000, or cast to get a real timestamp.
9 | Date parts | `dayofweek` returns 1 for Sunday up to 7 for Saturday. Also `year`, `month`, `date_format`, `datediff`.
```

## 🔗 Joins, UDFs and shared variables

```viz compare
{"title": "Know which tool fits which scenario",
 "items": [
  {"icon": "📡", "title": "Broadcast join", "color": "blue", "points": ["Small side copied to every executor", "Large side joined **without a shuffle**", "Automatic below 10 MB (`autoBroadcastJoinThreshold`)", "❌ broadcasting a big table means OOM"], "foot": "F.broadcast(df) or /*+ BROADCAST(t) */"},
  {"icon": "➕", "title": "union vs unionByName", "color": "teal", "points": ["`union` matches columns by **position**", "Both keep duplicates (UNION ALL)", "`unionByName(df, allowMissingColumns=True)`", "Add `.distinct()` for SQL UNION"]},
  {"icon": "🐍", "title": "UDF choice", "color": "amber", "points": ["1. Built-in functions", "2. Pandas UDF (Arrow, vectorized)", "3. Row-by-row `@udf` (slowest)", "`@udf` return type defaults to string"]},
  {"icon": "📦", "title": "Shared variables", "color": "purple", "points": ["Broadcast variable: driver → executors, read-only", "Accumulator: tasks only **add**, driver reads", "Reliable only when updated in actions", "Need `sparkContext`: not on Spark Connect"]}
 ]}
```

Join types to recognise: `inner` (default), `left`, `right`, `full`, `left_semi`, `left_anti`, `cross`. Multi-key joins take a list: `on=["currency", "date"]`. `collect()` and `toPandas()` bring everything to the driver.

## 🔧 Tuning and troubleshooting

| | `repartition(n or col)` | `coalesce(n)` |
|---|---|---|
| Shuffle | Full shuffle | No full shuffle |
| Direction | Up or down | **Down only** |
| Use for | More parallelism, balance skew | Fewer output files, cheaply |

- **AQE** (on by default since Spark 3.2) re-plans at shuffle boundaries: coalesces small shuffle partitions, switches sort-merge to **broadcast hash join**, splits skewed **join** partitions. It does not fix a skewed `groupBy`: use **salting** there.
- **Skew** in the Spark UI: one task with far more shuffle read than the median while other cores sit idle.
- **Driver OOM**: `collect()`, `toPandas()` or big broadcasts. More executors do not help. **Executor OOM**: huge or skewed partitions; look in the executor logs (Spark UI, Executors tab).

## 🌊 Structured Streaming

| Output mode | Writes each trigger | Note |
|---|---|---|
| `append` (default) | Only new, final rows | Aggregations need a **watermark** |
| `complete` | The whole result table | Aggregations only; not for file sinks |
| `update` | Only changed rows | Sink must support updates |

- Exactly-once needs a **replayable source**, a **checkpoint** (one per query, never shared) and an **idempotent sink** such as Delta.
- Triggers: default (back to back), `processingTime="1 minute"`, `availableNow=True` (process what is there, then **stop**). File sources need a schema.
- `dropDuplicates(["id"])` without a watermark keeps state forever. With `withWatermark("ts", "1 hour")`, include `ts` in the keys, or use `dropDuplicatesWithinWatermark(["id"])`.
- Windows: tumbling `window("ts", "10 minutes")`, sliding with a slide argument, `session_window`.

## 🔌 Spark Connect, deployment modes and pandas on Spark

```viz compare
{"items": [
  {"icon": "🔌", "title": "Spark Connect", "sub": "since Spark 3.4", "color": "navy", "points": ["Thin client sends unresolved plans over **gRPC**", "Results come back as Arrow batches", "A client crash does not kill the driver", "❌ No `SparkContext`, RDDs, accumulators"], "foot": "behind Databricks Connect and serverless"},
  {"icon": "🖥️", "title": "Deployment modes", "color": "gray", "points": ["**Local**: driver and executors in one JVM on one machine", "**Client**: driver on the submitting machine", "**Cluster**: driver inside the cluster, submitter can leave"], "foot": "spark-submit --deploy-mode client|cluster"},
  {"icon": "🐼", "title": "Pandas API on Spark", "color": "green", "points": ["`import pyspark.pandas as ps`: pandas syntax, distributed", "`to_spark()`, `pandas_api()`, `to_pandas()` (collects!)", "Pandas UDF: `@pandas_udf(\"double\")`, Series → Series", "Iterator UDF: load a model once per partition"]}
 ]}
```

## 🪤 Typical traps

- ❌ "The driver executes tasks." ✅ Executors do; the driver plans and schedules.
- ❌ "A job per transformation, a stage per transformation." ✅ A job per **action**, a new stage at each **shuffle**.
- ❌ "`cache()` stores the data now." ✅ It is lazy until the first action.
- ❌ "`coalesce(400)` raises parallelism." ✅ Only `repartition` can increase partitions.
- ❌ "The default save mode is overwrite." ✅ It is `error`; `ignore` skips silently.
- ❌ "`spark.sparkContext` works everywhere." ✅ Not with Spark Connect, Databricks Connect or serverless compute.
- ❌ "AQE fixes every skew." ✅ Skewed joins yes, skewed aggregations no.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks, about an hour a day",
 "items": [
  {"label": "Days 1-3", "title": "Architecture", "color": "navy", "note": "Study **How Spark runs your code**. Run small jobs and match jobs, stages and tasks in the Spark UI. Learn narrow vs wide by heart."},
  {"label": "Days 4-7", "title": "DataFrame API", "color": "blue", "note": "Write every function from the code slide yourself: filters, `explode`, `na.drop`, dates and epochs, aggregations. Read **Parquet files** for the storage side."},
  {"label": "Days 8-10", "title": "Joins and Spark SQL", "color": "teal", "note": "Study **Joins and shuffles**. Practise save modes, `partitionBy`, `saveAsTable` with `bucketBy`, temp and global temp views, SQL on files."},
  {"label": "Days 11-13", "title": "Tuning", "color": "amber", "note": "Study **Optimizing Delta tables** for file layout, then `repartition` vs `coalesce`, AQE, skew and salting, and where driver and executor logs live."},
  {"label": "Days 14-16", "title": "Streaming", "color": "purple", "note": "Study **Structured Streaming basics** and **Watermarks and stateful streaming**: output modes, triggers, checkpoints, windowed counts, deduplication."},
  {"label": "Day 17", "title": "Connect and pandas", "color": "green", "note": "Spark Connect limits, deployment modes, `pyspark.pandas` conversions and the pandas UDF types. Small domains, quick wins."},
  {"label": "Days 18-21", "title": "Practice exams", "color": "red", "note": "Take full timed practice exams. Review **every** wrong answer and every lucky guess, and write down the API detail you missed."}
 ]}
```

## 🧭 Exam-day checklist

| Do this | Why |
|---|---|
| Budget about 1.5 minutes per question | Up to 55 items in 90 minutes |
| Read the last line of the code first | It tells you whether anything runs (action) and what is returned |
| Check syntax before semantics | `and` vs `&`, missing parentheses, wrong argument types rule options out fast |
| Underline the constraint | "without a shuffle", "fewest files", "late data" point to one API |
| Flag and move on | Come back to long code blocks at the end; never leave a question blank |
