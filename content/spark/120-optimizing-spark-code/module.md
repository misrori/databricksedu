---
title: Optimizing Spark code
summary: Make PySpark code faster in the right order. Read less, shuffle less, compute less with built-in functions, keep big data off the driver, and write fewer, larger files. Check every change with EXPLAIN.
icon: 🚀
level: Intermediate
minutes: 12
group: Monitoring and optimization
tags: [Apache Spark, Performance, Python UDF, Caching, Photon]
---
# Optimizing Spark code

> Most slow Spark code is not slow because the cluster is small. It reads columns it never uses, shuffles rows it later throws away, or sends every row through Python. Fix those first, in that order.

**The one idea to remember:** the cheapest row is the one you never read. **Read less, then shuffle less, then compute less**, and check each change in the plan, not with a stopwatch alone.

## 🪜 The order of fixes

Each fix makes the next one cheaper, so work from the top. Hardware comes last.

```viz flow
{"title": "Where the time goes, and what to fix first",
 "nodes": [{"icon": "📖", "title": "Read less", "sub": "columns, filters, skipping", "color": "blue"},
           {"icon": "🔀", "title": "Shuffle less", "sub": "filter early, broadcast", "color": "amber"},
           {"icon": "🧮", "title": "Compute less", "sub": "built-ins, not Python UDFs", "color": "purple"},
           {"icon": "📤", "title": "Stay on the cluster", "sub": "no collect of big data", "color": "red"},
           {"icon": "📦", "title": "Write well", "sub": "fewer, larger files", "color": "green"}],
 "edges": ["fewer bytes", "fewer rows", "less CPU", "next reader"],
 "steps": [
  {"label": "Read less", "focus": [0], "note": "Select only the columns you need and filter on columns with good data skipping. Bytes never read cost nothing downstream."},
  {"label": "Shuffle less", "focus": [1], "note": "A shuffle writes, sends and reads every row. Filter and aggregate before joins, and broadcast small tables."},
  {"label": "Compute less", "focus": [2], "note": "Built-in functions run in the JVM or in Photon. A Python UDF ships every row to a Python process and back."},
  {"label": "Stay on the cluster", "focus": [3], "note": "`collect()` and `toPandas()` pull everything into one driver. Keep big results in tables."},
  {"label": "Write well", "focus": [4], "note": "Many small writes make many small files. Every later query pays for them."}
 ]}
```

## 📖 Read less: pruning and pushdown

Catalyst trims the scan for you when it can see the whole query. Check it in `explain("formatted")`: completed orders, quantity per customer.

```viz code
title: the scan node of explain("formatted") (simplified)
lang: text
---
(1) Scan parquet fact_orders
Output [3]: [customer_id, quantity, status]
ReadSchema: struct<customer_id:bigint,quantity:int,status:string>
PushedFilters: [IsNotNull(status), EqualTo(status,COMPLETED)]

(2) Filter
Input [3]: [customer_id, quantity, status]
Condition : (isnotnull(status) AND (status = COMPLETED))
---
2-3 | Column pruning | Only 3 of 7 columns are read. Parquet stores columns separately, so the other 4 are never touched.
4 | Predicate pushdown | The filter goes to the reader. With file statistics it **skips** whole files (see *Optimizing Delta tables*).
6-8 | Filter still runs | Skipping is per file. Rows inside a file that was read are still checked.
```

Catalyst cannot prune through a Python UDF, a `collect()`, or a table you materialized too early.

## 🔀 Shuffle less

Joins themselves are covered in *Joins and shuffles*. Here are the shuffles people add without noticing.

| Code | Shuffles? | Cheaper alternative |
|---|---|---|
| `orderBy` in the middle of a pipeline | Yes, a range shuffle | Sort only the final, small result |
| `distinct()` "to be safe" | Yes, all columns | `dropDuplicates(["key"])` where keys can repeat |
| Big table joined to a small one | Only if not broadcast | `big.join(F.broadcast(small), "id")` |
| `groupBy` after a big join | Yes, the joined rows | Aggregate before the join when you can |
| `repartition(n)` before every write | Yes, the full table | Let AQE and optimized writes size it |

## 🧮 Compute less: built-ins beat Python UDFs

```viz compare
{"items": [{"icon": "⚡", "title": "Built-in functions", "sub": "F.when, F.round, F.regexp_extract …", "color": "green",
            "points": ["Run in the JVM or in **Photon**", "Catalyst understands them: pruning, pushdown", "✅ the default choice"],
            "foot": "Hundreds of functions in pyspark.sql.functions"},
           {"icon": "🐼", "title": "pandas UDF", "sub": "@F.pandas_udf", "color": "amber",
            "points": ["Batches of rows move via **Arrow**", "Vectorized pandas or NumPy code", "Use when no built-in exists"],
            "foot": "The fallback for custom logic"},
           {"icon": "🐢", "title": "Python UDF", "sub": "@F.udf", "color": "red",
            "points": ["Every row is serialized to a Python worker and back", "A black box: no pushdown, no Photon", "❌ slowest per row"],
            "foot": "Shows up as BatchEvalPython or ArrowEvalPython"}]}
```

Before writing a UDF, search `pyspark.sql.functions`. Most string, date, array and math logic is already there.

## 📤 Keep the data on the cluster

The driver is one machine. Executors are many. Moving data between them in big or tiny pieces is a common slowdown.

- ❌ `df.collect()` or `df.toPandas()` on millions of rows: the driver runs out of memory, or waits for the network.
- ❌ A Python `for` loop that appends one small DataFrame per iteration: one commit and new small files every time.
- ❌ `count()` or `show()` left in as debug checks: each one runs a full job.
- ✅ Aggregate on the cluster, then collect the small result.
- ✅ Build the whole DataFrame (`unionByName`, joins), then write once.

## 📦 Partitions and file sizes

| Thing | What to aim for | Who handles it |
|---|---|---|
| Read partitions | About 128 MB each | Spark splits the input files |
| Shuffle partitions | Tasks of 100-200 MB | AQE coalesces them |
| Output files | 128 MB to 1 GB | Optimized writes, `OPTIMIZE`, predictive optimization |
| Tiny tables | One or a few files | Do not `repartition` up |

Too few partitions leave cores idle. Too many make tasks so small that scheduling costs more than the work.

## ⚙️ AQE, Photon and caching

- **AQE** is on by default. It coalesces shuffle partitions, switches to broadcast joins and splits skewed joins at runtime.
- **Photon**, a vectorized engine, is always on for serverless and SQL warehouses. It speeds up built-in functions, not Python UDFs.
- **Disk cache** (formerly Delta cache) on classic compute keeps copies of remote files on the workers' local SSDs. Delta files never change, so a cached file is never stale.
- `df.cache()` keeps a DataFrame in executor memory. It is **not available on serverless**. There, write a table if you reuse a result.

```python
# Classic compute only: caching APIs are not supported on serverless
completed = spark.table("fact_orders").filter("status = 'COMPLETED'")
completed.cache()      # lazy: only marks the DataFrame
completed.count()      # the first action fills the cache
# ... several queries on completed ...
completed.unpersist()  # free executor memory
```

## 🧪 Try it: compare plans

```dataset retail
```

```python run
# Filter after the join vs before the join: compare the two plans
from pyspark.sql import functions as F

orders, customers = spark.table("fact_orders"), spark.table("dim_customer")

late = orders.join(customers, "customer_id").filter(F.col("status") == "COMPLETED").select("region", "quantity")
early = orders.filter(F.col("status") == "COMPLETED").select("customer_id", "quantity").join(customers, "customer_id")

late.explain("formatted")
early.explain("formatted")
```

> Both plans push `status = COMPLETED` into the scan of `fact_orders` and read the same columns (on serverless the node is a `PhotonScan`). Catalyst moved your filter. Writing it early still matters when something blocks the optimizer, as the next cell shows.

```python run
# The same filter as a built-in and as a Python UDF
import time

@F.udf(returnType="boolean")
def is_completed(status):
    return status == "COMPLETED"

builtin = orders.filter(F.col("status") == "COMPLETED").agg(F.sum("quantity"))
udf = orders.filter(is_completed("status")).agg(F.sum("quantity"))

for name, df in [("built-in", builtin), ("python udf", udf)]:
    start = time.perf_counter()
    df.collect()
    print(f"{name:<11} {time.perf_counter() - start:.2f} s")
udf.explain("formatted")
```

> In the UDF plan the status filter is no longer part of the scan, and a Python evaluation node appears. At 60,000 rows the gap is small; it grows with every row.

```python run
# Broadcast hint: make the join strategy explicit
by_region = orders.join(F.broadcast(customers), "customer_id").groupBy("region").agg(F.sum("quantity").alias("units"))
by_region.explain("formatted")
display(by_region)
```

## Exercise 1: remove the UDF and the toPandas

The starter cell computes revenue per category with a Python UDF and pandas on the driver. Rewrite it so that everything runs on the cluster with built-in functions, and only 5 rows reach the driver. Predict which plan node disappears.

```python todo
# Slow version: runs, but sends every row through Python and then to the driver
from pyspark.sql import functions as F

@F.udf(returnType="double")
def net_revenue(quantity, unit_price, discount):
    return quantity * unit_price * (1 - discount)

rows = (spark.table("fact_orders").join(spark.table("dim_product"), "product_id")
        .withColumn("revenue", net_revenue("quantity", "unit_price", "discount")))
pdf = rows.toPandas()
print(pdf.groupby("category")["revenue"].sum().round(2))

# TODO 1: compute revenue with column arithmetic (F.col) instead of the UDF
# TODO 2: groupBy("category") and sum on the cluster, then display() the 5 rows
# TODO 3: explain("formatted") both versions and compare
```

```python solution
from pyspark.sql import functions as F

revenue = F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))
per_category = (spark.table("fact_orders").join(spark.table("dim_product"), "product_id")
                .groupBy("category")
                .agg(F.round(F.sum(revenue), 2).alias("revenue")))
per_category.explain("formatted")
display(per_category)
# The BatchEvalPython / ArrowEvalPython node is gone, so Photon can run the whole query.
# Only 5 aggregated rows travel to the driver instead of 60,000 joined rows.
```

## Exercise 2: one write or twelve?

Write the 2025 orders twice: once as 12 monthly appends in a loop into `opt_monthly`, once as a single write into `opt_once`. Predict the number of data files and table versions of each before you run `DESCRIBE DETAIL`.

```python todo
# TODO 1: for month in 1..12: append that month's 2025 orders to opt_monthly (first one with overwrite)
# TODO 2: write all 2025 orders at once to opt_once (overwrite)
# TODO 3: compare numFiles from DESCRIBE DETAIL, and the number of rows in the history
```

```python solution
from pyspark.sql import functions as F

orders_2025 = spark.table("fact_orders").filter(F.year("order_date") == 2025)
for month in range(1, 13):
    (orders_2025.filter(F.month("order_date") == month)
        .write.mode("overwrite" if month == 1 else "append").saveAsTable("opt_monthly"))
orders_2025.write.mode("overwrite").saveAsTable("opt_once")

for t in ["opt_monthly", "opt_once"]:
    files = spark.sql(f"DESCRIBE DETAIL {t}").select("numFiles").first()[0]
    versions = spark.sql(f"DESCRIBE HISTORY {t}").count()
    print(f"{t:<12} files={files} versions={versions}")
# opt_monthly: at least 12 small files and 12+ versions. opt_once: one or a few files, one version.
# If auto compaction ran, the history shows an OPTIMIZE commit and fewer files: the platform paid for the loop.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS opt_monthly"); spark.sql("DROP TABLE IF EXISTS opt_once")
```

## ⚠️ Common mistakes

- ❌ Tuning configs before reading the plan. Most wins come from code changes.
- ❌ A Python UDF for logic that `pyspark.sql.functions` already has.
- ❌ `toPandas()` on a large DataFrame "just to look". Use `display()` or `limit()`.
- ❌ Calling `df.cache()` on serverless. It is not supported; write a table instead.
- ✅ Compare `explain("formatted")` before and after each change.
- ✅ Time actions, not transformations, and run them twice.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Check pruning and pushdown | `df.explain("formatted")`: `ReadSchema`, `PushedFilters` |
| Avoid shuffling a small table | `big.join(F.broadcast(small), "id")` |
| Replace a Python UDF | `pyspark.sql.functions`, or `@F.pandas_udf` if nothing fits |
| Look at a big result | `display(df)` or `df.limit(20)`, not `toPandas()` |
| Avoid small files | Build one DataFrame, write once; `OPTIMIZE` |
| Reuse a result on serverless | Write it to a table (no `df.cache()`) |
