---
title: "Recap: Monitoring and Optimizing Apache Spark Workloads"
summary: Recap of module 4 of Apache Spark Programming with Databricks. Run Spark on the lakehouse with Delta Lake, keep tables healthy with MERGE, OPTIMIZE and liquid clustering, and use the Spark UI and query profile to find shuffles, skew and spill.
icon: 🩺
level: Intermediate
minutes: 10
group: Apache Spark Programming with Databricks
tags: [Delta Lake, MERGE, Liquid clustering, AQE, Skew, Spark UI, Query profile]
---
# Recap: Monitoring and Optimizing Apache Spark Workloads

> Module 4 of 4. Spark **on Databricks**: the lakehouse, compute and Photon, **Delta Lake** from the DataFrame API, the classic performance problems, and how the **Spark UI** and **query profile** point you to them.

**The one idea to remember:** measure before you tune. Open the Spark UI or query profile, find the slow stage, and name the problem (**too much data read, too much shuffled, skew or spill**). Fix the layout and the plan before you add hardware.

## 🗺️ What we covered

```viz timeline
{"title": "The lessons of the module",
 "items": [
  {"label": "1", "title": "Spark and Databricks", "color": "navy", "note": "The **lakehouse**, Unity Catalog, compute types, **Photon**."},
  {"label": "2", "title": "Spark with Delta Lake", "color": "blue", "note": "ACID writes, `saveAsTable`, **time travel**, `MERGE` with the `DeltaTable` API, `OPTIMIZE`, `VACUUM`, **liquid clustering**."},
  {"label": "3", "title": "Optimizing Spark", "color": "amber", "note": "Partitions, **shuffles**, **skew**, **spill**, **AQE**, broadcast joins, file layout."},
  {"label": "4", "title": "Monitoring", "color": "green", "note": "The **Spark UI** (jobs, stages, tasks, SQL tab) and the **query profile** to find bottlenecks."}
 ]}
```

## 🏠 Spark in the lakehouse

```viz layers
{"title": "Where Spark sits on Databricks",
 "layers": [
  {"icon": "🛡️", "title": "Unity Catalog", "sub": "one place for permissions, lineage and names", "color": "purple", "items": ["`catalog.schema.table`", "Volumes for files"]},
  {"icon": "⚡", "title": "Spark + Photon", "sub": "the engine: DataFrames, SQL, streaming", "color": "amber", "items": ["Photon: vectorized C++ engine for SQL and DataFrames"]},
  {"icon": "🔺", "title": "Delta Lake", "sub": "table format: Parquet files + transaction log", "color": "blue", "items": ["ACID", "Time travel"]},
  {"icon": "☁️", "title": "Cloud object storage", "sub": "cheap, durable, your account", "color": "gray"}
 ]}
```

Storage and compute are separate: many clusters can read the same governed tables.

## 🖥️ Compute types

| Compute | Best for | Note |
|---|---|---|
| **Serverless** | Notebooks, jobs, pipelines | Starts in seconds. Query profile, no Spark UI |
| Classic all-purpose | Interactive work that needs Spark UI or custom config | You pick nodes, access mode, runtime |
| Classic jobs compute | Scheduled production jobs on classic | Created per run, cheaper than all-purpose |
| SQL warehouse | SQL, BI and dashboards | Photon always on |

**Photon** speeds up scans, joins, aggregations and Delta writes without code changes. Python UDFs fall back to the classic engine.

## 🔺 Delta Lake from the DataFrame API

```python
from pyspark.sql import functions as F

(df.write.mode("overwrite").saveAsTable("orders_silver"))     # ACID: readers see old or new, never half
(new_rows.write.mode("append").saveAsTable("orders_silver"))

spark.sql("DESCRIBE HISTORY orders_silver")                    # one row per commit
spark.sql("SELECT * FROM orders_silver VERSION AS OF 3")       # time travel
spark.sql("SELECT * FROM orders_silver TIMESTAMP AS OF '2026-11-01'")
spark.sql("RESTORE TABLE orders_silver TO VERSION AS OF 3")    # undo a bad write
```

Every write is a **commit** in `_delta_log`. A failed job leaves no partial data behind, because its files are never committed.

## ⏪ Versions, files and VACUUM

```viz files
{"title": "orders_silver/",
 "steps": [
  {"label": "v0 · overwrite", "note": "`saveAsTable` writes data files and commit 0.", "add": [{"path": "part-000.parquet", "tag": "v0"}, {"path": "part-001.parquet", "tag": "v0"}, {"path": "_delta_log/00000000000000000000.json", "tag": "v0 · add 2 files"}]},
  {"label": "v1 · MERGE", "note": "Changed rows are rewritten into a new file. The old file is **removed from the table** but stays on disk for time travel.", "add": [{"path": "part-002.parquet", "tag": "v1"}, {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · remove + add"}], "remove": ["part-001.parquet"]},
  {"label": "v2 · OPTIMIZE", "note": "Small files are compacted into one bigger file. Same rows, fewer files.", "add": [{"path": "part-003.parquet", "tag": "v2 · compacted"}, {"path": "_delta_log/00000000000000000002.json", "tag": "v2 · optimize"}], "remove": ["part-000.parquet", "part-002.parquet"]},
  {"label": "VACUUM", "note": "After the retention period (7 days by default), `VACUUM` **physically deletes** unreferenced files. Time travel to v0 and v1 is no longer possible.", "delete": ["part-000.parquet", "part-001.parquet", "part-002.parquet"]}
 ]}
```

## 🔀 MERGE with the DeltaTable API

```viz table
{"title": "target orders, MERGE ON order_id",
 "columns": ["order_id", "status", "quantity"],
 "rows": [[101, "OPEN", 2], [102, "OPEN", 1], [103, "COMPLETED", 4]],
 "steps": [
  {"label": "Target", "note": "`DeltaTable.forName(spark, \"orders\").alias(\"t\").merge(updates.alias(\"s\"), \"t.order_id = s.order_id\")`"},
  {"label": "Matched", "note": "`whenMatchedUpdateAll()`: order 102 is in the updates, so its row is updated.", "upd": {"1": {"status": "COMPLETED", "quantity": 3}}, "hl": [1]},
  {"label": "Not matched", "note": "`whenNotMatchedInsertAll()`: order 104 is new, so it is inserted.", "add": [[104, "OPEN", 5]], "hl": [3]},
  {"label": "Delete", "note": "`whenMatchedDelete(\"s.status = 'CANCELLED'\")` can remove rows in the same atomic commit.", "del": [0]}
 ]}
```

`.execute()` runs it. One commit, all or nothing.

## 🧹 OPTIMIZE and liquid clustering

```sql
-- New tables: cluster on the columns you filter and join by most (1 to 4)
CREATE OR REPLACE TABLE orders_silver CLUSTER BY (customer_id, order_date) AS SELECT ...;
ALTER TABLE orders_silver CLUSTER BY (customer_id);   -- change keys later, no full rewrite

OPTIMIZE orders_silver;            -- compact small files and cluster new data
VACUUM orders_silver;              -- delete files older than the retention period
```

- Similar values in the same files let Delta **skip files** using min/max statistics.
- **Liquid clustering** replaces partitioning and Z-order for new tables.
- **Predictive optimization** on Unity Catalog managed tables runs `OPTIMIZE` and `VACUUM` for you.

## 🧩 Partitions and shuffles

Every stage runs **one task per partition**. Getting the partition count right matters most at shuffles.

| Partitions | Symptom | Effect |
|---|---|---|
| Too few | Few huge tasks, idle cores | **Spill** to disk, slow stages |
| Too many | Thousands of tiny tasks | Scheduling overhead, tiny output files |
| About right | Tasks of ~100-200 MB, all cores busy | Steady throughput |

`spark.sql.shuffle.partitions` (default 200) sets the count after a shuffle. **AQE** then coalesces small ones at run time, so on Databricks you rarely tune it by hand.

## ⚖️ Skew and spill

```viz compare
{"items": [
  {"icon": "🐘", "title": "Skew", "sub": "one key holds most of the data", "color": "red", "points": ["One task runs far longer than the median", "Example: Books orders dominate a groupBy on category", "Fix: AQE skew join, salting, handle hot keys separately"]},
  {"icon": "💧", "title": "Spill", "sub": "a task's data does not fit in memory", "color": "amber", "points": ["*Spill (memory/disk)* > 0 in the stage", "Common in big sorts, joins, aggregations", "Fix: more, smaller partitions, or more memory per core"]}
 ]}
```

Both show up in the **task metrics** of a stage: compare the max with the median.

## 🤖 AQE and broadcast joins

```viz flow
{"nodes": [
  {"icon": "📝", "title": "Initial plan", "sub": "from estimates", "color": "navy"},
  {"icon": "1️⃣", "title": "Stage runs", "sub": "real sizes measured", "color": "blue"},
  {"icon": "🤖", "title": "AQE re-plans", "sub": "at the shuffle boundary", "color": "purple"},
  {"icon": "✅", "title": "Better plan", "sub": "for the rest of the query", "color": "green"}
 ],
 "edges": ["execute", "statistics", "adjust"],
 "steps": [
  {"label": "Estimate", "focus": [0], "note": "Before running, the optimizer guesses sizes. With missing statistics it may choose a **sort-merge join** for a small table."},
  {"label": "Measure", "focus": [1], "note": "After the first stage, Spark knows the **real** size of each shuffle output."},
  {"label": "Re-plan", "focus": [2], "note": "AQE switches to a **broadcast join** if one side is small, **coalesces** tiny partitions, and **splits skewed** ones."},
  {"label": "Run", "focus": [3], "note": "You can also force it: `F.broadcast(dim_df)` or a `/*+ BROADCAST(d) */` hint. The big side is then never shuffled."}
 ]}
```

## 🖥️ The Spark UI

```viz tree
{"root": {"icon": "🖥️", "label": "Spark UI", "sub": "classic compute", "color": "navy",
  "children": [
   {"icon": "📋", "label": "Jobs", "sub": "one per action", "color": "blue", "children": [
     {"icon": "🧱", "label": "Stages", "sub": "duration, shuffle read/write, spill", "color": "purple", "children": [
       {"icon": "⚙️", "label": "Tasks", "sub": "min / median / max: skew lives here", "color": "red", "children": []}]}]},
   {"icon": "🔎", "label": "SQL / DataFrame", "sub": "the physical plan with row counts", "color": "teal", "children": []},
   {"icon": "💻", "label": "Executors", "sub": "memory, GC time, failed tasks", "color": "amber", "children": []}
  ]}}
```

On **serverless** and SQL warehouses, the **query profile** shows the same plan as a graph with time, rows and bytes per operator. Open it from the cell output.

## 🔍 Finding the bottleneck

```viz timeline
{"title": "Work through the checks in this order",
 "items": [
  {"label": "1", "title": "Slowest stage", "color": "navy", "note": "In the Spark UI or query profile, find the stage or operator with the most time."},
  {"label": "2", "title": "Too many files read?", "color": "blue", "note": "Few files pruned on a selective filter: a **layout** problem. Cluster the table, `OPTIMIZE`."},
  {"label": "3", "title": "Big shuffle?", "color": "purple", "note": "Large shuffle read/write: filter earlier, **broadcast** the small side."},
  {"label": "4", "title": "Max task >> median?", "color": "red", "note": "That is **skew**. Check AQE, salt or split hot keys."},
  {"label": "5", "title": "Spill > 0?", "color": "amber", "note": "More partitions or more memory."},
  {"label": "6", "title": "Python UDF?", "color": "teal", "note": "Replace with built-ins so Photon can run it."},
  {"label": "7", "title": "Only then: hardware", "color": "green", "note": "Bigger nodes, more workers, or serverless."}
 ]}
```

## 🧪 Try it: Delta history, time travel and MERGE

```dataset retail
```

Write a Delta table from the **retail** orders, change it, travel back, then upsert with the `DeltaTable` API.

```python run
# Write a Delta table with saveAsTable, change it, and read the history
from pyspark.sql import functions as F
from delta.tables import DeltaTable

spark.table("fact_orders").filter("status <> 'TEST'").write.mode("overwrite").saveAsTable("smr_orders")
spark.sql("UPDATE smr_orders SET status = 'CANCELLED' WHERE status = 'OPEN' AND order_date < '2025-03-01'")
display(spark.sql("DESCRIBE HISTORY smr_orders").select("version", "operation", "operationMetrics").limit(4))
```

```python run
# Time travel: compare the open orders now and one version ago
latest = spark.sql("DESCRIBE HISTORY smr_orders").agg(F.max("version")).first()[0]
display(spark.sql(f"""
SELECT 'now' AS version, count(*) AS open_orders FROM smr_orders WHERE status = 'OPEN'
UNION ALL
SELECT 'v{latest - 1}', count(*) FROM smr_orders VERSION AS OF {latest - 1} WHERE status = 'OPEN'
"""))
```

```python run
# MERGE: 3 cancelled orders become COMPLETED, 2 brand-new orders are inserted
changed = spark.table("smr_orders").filter("status = 'CANCELLED'").orderBy("order_id").limit(3).withColumn("status", F.lit("COMPLETED"))
new = spark.table("smr_orders").orderBy("order_id").limit(2).withColumn("order_id", F.col("order_id") + 10_000_000)
changed.unionByName(new).write.mode("overwrite").saveAsTable("smr_updates")   # a fixed, small source

(DeltaTable.forName(spark, "smr_orders").alias("t")
   .merge(spark.table("smr_updates").alias("s"), "t.order_id = s.order_id")
   .whenMatchedUpdateAll()
   .whenNotMatchedInsertAll()
   .execute())
display(spark.sql("DESCRIBE HISTORY smr_orders").select("version", "operation", "operationMetrics").limit(1))
```

## 🧪 Try it: layout, skew and the plan

```python run
# Liquid clustering: a clustered copy, compacted with OPTIMIZE
spark.sql("CREATE OR REPLACE TABLE smr_orders_clustered CLUSTER BY (customer_id, order_date) AS SELECT * FROM smr_orders")
spark.sql("OPTIMIZE smr_orders_clustered")
display(spark.sql("DESCRIBE DETAIL smr_orders_clustered").select("clusteringColumns", "numFiles", "sizeInBytes"))
```

```python run
# Skew check: how uneven is the work per key? Then read the plan: look for the broadcast and the shuffle
orders = spark.table("smr_orders").join(spark.table("dim_product"), "product_id")
display(orders.groupBy("category").count().orderBy(F.desc("count")))

by_region = (orders.join(spark.table("dim_customer"), "customer_id")
             .groupBy("region").agg(F.count("*").alias("orders")))
by_region.explain(mode="formatted")
display(by_region)    # then open the query profile from this cell's output

# Clean up when you are done
# for t in ("smr_orders", "smr_updates", "smr_orders_clustered"): spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ Adding workers before looking at the Spark UI or query profile.
- ❌ Partitioning a small table, or by a high-cardinality column. Use **liquid clustering**.
- ❌ `VACUUM ... RETAIN 0 HOURS` in production. It breaks time travel and running readers.
- ❌ Reading only the average task time. **Skew** hides in the max.
- ❌ Hand-tuning `spark.sql.shuffle.partitions` everywhere instead of letting **AQE** coalesce.
- ❌ Looking for the Spark UI on serverless. Use the **query profile**.

## 🧭 Cheat sheet

| Symptom | Fix |
|---|---|
| Undo a bad write | `RESTORE TABLE ... TO VERSION AS OF n` |
| Upsert changes | `DeltaTable.merge(...)` or `MERGE INTO` |
| Many small files, little file skipping | `OPTIMIZE`, **liquid clustering** |
| Sort-merge join with a small side | **Broadcast** it (AQE, hint, statistics) |
| Max task time far above median | **Skew**: AQE, salting, split hot keys |
| Spill > 0 | More partitions, more memory per core |

**End of the course.** Deep dives: Spark with Delta Lake, Optimizing Spark code, Spark UI and monitoring, and Delta table optimization.
