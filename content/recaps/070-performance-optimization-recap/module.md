---
title: "Recap: Databricks Performance Optimization"
summary: Recap of course 3 of Advanced Data Engineering with Databricks. Read less data with good file layout, move less data by avoiding shuffles, recognise skew, spill and slow UDFs, and choose compute last.
icon: ⚡
level: Advanced
minutes: 9
group: Advanced Data Engineering with Databricks
tags: [Performance, Liquid clustering, Data skipping, AQE, Photon, Spark UI]
---
# Recap: Databricks Performance Optimization

> Course 3 of 4. Why queries are slow and what to do about it: **file layout and data skipping**, the classic Spark problems (**skew, shuffle, spill, serialization**), and choosing **compute**.

**The one idea to remember:** first **read less data** (good layout, data skipping), then **move less data** (avoid shuffles, broadcast small sides), and only then **add hardware**. The query profile and the Spark UI tell you which problem you have.

## 🗺️ What we covered

```viz timeline
{"title": "The topics of the course",
 "items": [
  {"label": "1", "title": "Spark architecture", "color": "navy", "note": "Driver, executors, **jobs, stages, tasks**. Shuffles create stage boundaries."},
  {"label": "2", "title": "File layout", "color": "blue", "note": "Small files, **data skipping** with file statistics, partitioning vs Z-order vs **liquid clustering**."},
  {"label": "3", "title": "Managed maintenance", "color": "teal", "note": "`OPTIMIZE`, `VACUUM`, optimized writes, auto compaction, **predictive optimization**."},
  {"label": "4", "title": "Skew and shuffle", "color": "red", "note": "**Skew**: one task takes much longer than the rest; fix it with AQE, salting, or filtering hot keys. **Shuffle**: wide transformations move data across the network; broadcast joins avoid it."},
  {"label": "5", "title": "Spill", "color": "amber", "note": "Not enough memory per task, so data goes to disk. Fix it with more or smaller partitions or bigger nodes."},
  {"label": "6", "title": "Serialization", "color": "purple", "note": "Python UDFs are slow. Prefer **built-in functions**, then pandas UDFs."},
  {"label": "7", "title": "Compute and diagnostics", "color": "green", "note": "Cluster sizing, **Photon**, serverless, **query profile**, **Spark UI**, caching."}
 ]}
```

## ⚙️ How Spark executes a query

```viz flow
{"nodes": [
  {"icon": "📝", "title": "Query / Job", "sub": "an action starts a job", "color": "navy"},
  {"icon": "1️⃣", "title": "Stage 1", "sub": "scan, filter, project", "color": "blue", "items": ["one task per partition"]},
  {"icon": "🔀", "title": "Exchange", "sub": "shuffle over the network", "color": "red"},
  {"icon": "2️⃣", "title": "Stage 2", "sub": "join / aggregate", "color": "purple"},
  {"icon": "💾", "title": "Write", "sub": "output files", "color": "green"}
 ],
 "edges": ["plan", "shuffle write", "shuffle read", "write"],
 "steps": [
  {"label": "Narrow", "focus": [1], "note": "**Narrow** transformations (`filter`, `select`, `withColumn`) stay in the same stage. Tasks run in parallel on executor cores, one per partition."},
  {"label": "Wide", "focus": [2], "note": "**Wide** transformations (`groupBy`, `join`, `distinct`, `orderBy`) need a **shuffle**, which starts a new stage."},
  {"label": "AQE", "focus": [2, 3], "note": "**Adaptive Query Execution**, on by default, re-plans at this stage boundary using real data sizes."},
  {"label": "Output", "focus": [4], "note": "The final stage writes the result. Too many tiny partitions here means tiny output files."}
 ]}
```

AQE uses the real sizes to switch to a **broadcast join**, **coalesce** small partitions, and split **skewed** partitions.

## 🎯 Data skipping

Delta stores **min/max statistics** per file, so a selective filter can **skip files**. That only works when similar values sit in the same files.

```viz table
{"title": "SELECT ... FROM sales WHERE customer_id = 42",
 "columns": ["file", "min customer_id", "max customer_id", "read?"],
 "rows": [["part-0", 1, 500, "read"], ["part-1", 2, 499, "read"], ["part-2", 1, 500, "read"], ["part-3", 3, 498, "read"]],
 "steps": [
  {"label": "Unclustered", "note": "Every file holds a bit of every customer. 42 is inside every min/max range, so **no file is skipped**."},
  {"label": "CLUSTER BY + OPTIMIZE", "note": "Rows with similar `customer_id` now sit together, so each file covers a narrow range.", "upd": {"0": {"max customer_id": 125, "read?": "read"}, "1": {"min customer_id": 126, "max customer_id": 250, "read?": "skipped"}, "2": {"min customer_id": 251, "max customer_id": 375, "read?": "skipped"}, "3": {"min customer_id": 376, "max customer_id": 500, "read?": "skipped"}}},
  {"label": "1 of 4 files", "note": "The engine reads only `part-0`. The query profile shows this as **files pruned**.", "hl": [0]}
 ]}
```

## 🗂️ Layout techniques

| Technique | Use when | Notes |
|---|---|---|
| **Liquid clustering** `CLUSTER BY (cols)` | **Default for new tables**. Filter or join on 1-4 columns, any cardinality | Incremental, and keys can be changed without a rewrite |
| **`CLUSTER BY AUTO`** | Managed tables with unknown or changing query patterns | Databricks picks the keys (needs predictive optimization) |
| **Partitioning** | Very large tables (many TB) with a **low-cardinality** column used for lifecycle (e.g. date), partitions of at least ~1 GB | Over-partitioning leads to millions of small files |
| **Z-order** (legacy) | Existing partitioned tables | Not incremental. Must be re-run on all data |

## 🧹 Clustering and maintenance

```sql
CREATE TABLE sales (sale_ts TIMESTAMP, customer_id BIGINT, store_id INT, amount DOUBLE)
CLUSTER BY (customer_id, sale_ts);

OPTIMIZE sales;                     -- compacts small files and clusters new data
ANALYZE TABLE sales COMPUTE STATISTICS FOR ALL COLUMNS;
```

- **Small-file problem:** many tiny files from streaming or over-partitioning mean slow listing and slow scans. Fix it with `OPTIMIZE`, auto compaction and optimized writes.
- **Predictive optimization** on UC managed tables runs `OPTIMIZE`, `VACUUM` and `ANALYZE` for you.
- Write predicates on the column itself (`sale_ts >= '2026-01-01'`), not on a function of it (`date(sale_ts) = ...`), so that skipping works.

## 🩺 The four classic problems

| Problem | Symptom in Spark UI / query profile | Fixes |
|---|---|---|
| **Skew** | One task runs far longer than the median. Rows per task are very uneven | AQE skew join (on by default), **salting** hot keys, filtering or handling NULL / "unknown" keys separately |
| **Shuffle** | Large *shuffle read/write* bytes, many exchanges | **Broadcast** the small side, filter and select early, pre-aggregate, cluster on join keys |
| **Spill** | *Spill (memory/disk)* > 0 in sort, aggregate or join stages | More partitions (smaller tasks), memory-optimized nodes, less data per key |
| **Serialization** | Slow Python UDF stages, Photon falls back | Replace UDFs with **built-in functions**. Otherwise use **pandas (vectorized) UDFs** |

## 🛠️ Two fixes in code

```python
from pyspark.sql import functions as F

# ❌ row-by-row Python UDF: data shipped to Python one row at a time
# clean = F.udf(lambda s: s.strip().lower())

# ✅ built-in, runs in the JVM / Photon
df = df.withColumn("email", F.lower(F.trim("email")))

# ✅ broadcast a small dimension to avoid shuffling the big fact table
result = facts.join(F.broadcast(stores), "store_id")
```

## 🔗 Joins and shuffle partitions

| Join strategy | When | Cost |
|---|---|---|
| **Broadcast hash join** | One side is small (under `spark.sql.autoBroadcastJoinThreshold`, or AQE decides at runtime) | **No shuffle** of the big side, the fastest option |
| Shuffle hash join | Medium side fits in memory per partition | One shuffle |
| **Sort-merge join** | Both sides large | Shuffle **and** sort on both sides |

- `spark.sql.shuffle.partitions` (default 200): with AQE, set it high (or `auto`) and let coalescing shrink it.
- Too few partitions give huge tasks and spill. Too many give scheduling overhead and tiny output files.
- Missing statistics can hide a broadcast opportunity. Run `ANALYZE TABLE`, or add a `/*+ BROADCAST(dim) */` hint.

## 🖥️ Compute choices

| Choice | Guidance |
|---|---|
| **Serverless** | Default for jobs, pipelines and SQL: fast start, auto-scaling, no tuning |
| **Photon** | Vectorized engine for SQL and DataFrame workloads. Big gains on scans, joins, aggregations and Delta writes |
| Node type | Memory-optimized for large shuffles, joins and caching. Compute-optimized for CPU-heavy transforms. Storage-optimized (local SSD) for the **disk cache** |
| Autoscaling | Good for variable load. Fixed size for steady streaming workloads |
| Job clusters | Production jobs. All-purpose clusters are for interactive work |

## 🧊 Three caches

```viz compare
{"items": [
  {"icon": "💽", "title": "Disk cache", "sub": "automatic", "color": "green", "points": ["On SSD-backed nodes and SQL warehouses", "✅ Always consistent"]},
  {"icon": "🧠", "title": "Spark cache", "sub": "`df.cache()`, manual", "color": "amber", "points": ["Uses executor memory", "❌ Can go stale"]},
  {"icon": "🔁", "title": "Query result cache", "sub": "SQL", "color": "blue", "points": ["Repeated identical SQL queries"]}
 ]}
```

## 🔍 Diagnosing a slow query

```viz timeline
{"title": "Work through the checks in this order",
 "items": [
  {"label": "1", "title": "Open the profile", "color": "navy", "note": "Open the **query profile** (SQL / serverless) or the **Spark UI** (classic)."},
  {"label": "2", "title": "Files pruned near 0?", "color": "blue", "note": "On a selective filter, this is a **layout** problem: clustering, statistics, predicate."},
  {"label": "3", "title": "Sort-merge join, small side?", "color": "purple", "note": "**Broadcast** it, or fix the statistics."},
  {"label": "4", "title": "Huge shuffle bytes?", "color": "red", "note": "Filter early, broadcast, pre-aggregate."},
  {"label": "5", "title": "Max task time far above median?", "color": "amber", "note": "That is **skew**."},
  {"label": "6", "title": "Spill > 0?", "color": "teal", "note": "More partitions, or more memory."},
  {"label": "7", "title": "Only then: hardware", "color": "green", "note": "Bigger compute, or Photon if it is not on yet."}
 ]}
```

## 🧪 Try it: layout, join strategy, serialization

```dataset retail
```

Uses the **retail** tables, plus 5 million generated rows for the UDF comparison.

```python run
# Liquid clustering: create a clustered copy and inspect its layout
spark.sql("CREATE OR REPLACE TABLE perf_orders_clustered CLUSTER BY (customer_id, order_date) AS SELECT * FROM fact_orders")
spark.sql("OPTIMIZE perf_orders_clustered")
display(spark.sql("DESCRIBE DETAIL perf_orders_clustered").select("clusteringColumns", "numFiles", "sizeInBytes"))
```

```python run
# Join strategy: look for BroadcastHashJoin. The small dimension is broadcast, so the fact table isn't shuffled
spark.sql("""
SELECT p.category, sum(f.quantity * p.unit_price) AS revenue
FROM fact_orders f JOIN dim_product p ON f.product_id = p.product_id
GROUP BY ALL
""").explain()
```

```python run
# Serialization: a row-by-row Python UDF vs built-in functions on 5 million rows
import time
from pyspark.sql import functions as F

df = spark.range(5_000_000).withColumn("email", F.concat(F.lit("  User"), F.col("id").cast("string"), F.lit("@Example.COM ")))
clean_udf = F.udf(lambda s: s.strip().lower())

for name, col in [("Python UDF", clean_udf("email")), ("built-in", F.lower(F.trim("email")))]:
    start = time.time()
    df.select(F.sum(F.length(col))).collect()
    print(f"{name:<11} {time.time() - start:5.1f} s")

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS perf_orders_clustered")
```

## ⚠️ Common mistakes

- ❌ Scaling up the cluster when the profile shows **no data skipping**. Fix the layout first.
- ❌ Partitioning a 200 GB table, or partitioning by a high-cardinality column. Use **liquid clustering**.
- ❌ Scheduling `ZORDER` jobs on managed tables with liquid clustering and predictive optimization.
- ❌ Row-by-row Python UDFs for logic that built-in functions already cover.
- ❌ Forcing `spark.sql.shuffle.partitions = 2000` everywhere instead of letting AQE coalesce.
- ❌ `df.cache()` for a dashboard read by many users. Rely on the disk cache or result cache.

## 🧭 Cheat sheet

| Symptom | Fix |
|---|---|
| Files pruned near 0 on a selective filter | **Liquid clustering** on the filter columns, fresh statistics, predicate on the raw column |
| Many tiny files | `OPTIMIZE`, auto compaction, optimized writes, or **predictive optimization** |
| Max task time far above the median | **Skew**: AQE skew join, salting, handle hot or NULL keys separately |
| Sort-merge join with a small side | **Broadcast**: `ANALYZE TABLE` or a `/*+ BROADCAST(dim) */` hint |
| Spill > 0 | More partitions, memory-optimized nodes |
| Slow Python UDF stage | **Built-in functions**, then pandas UDFs |

**Next course:** *Automated Deployment with Databricks Asset Bundles*.
