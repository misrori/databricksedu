---
title: Using Spark with Delta Lake (DataFrame API)
summary: Write, evolve, overwrite and time-travel Delta tables from the DataFrame API, and use the DeltaTable class for history, deletes, updates and MERGE without leaving Python.
icon: 🐍
level: Intermediate
minutes: 10
group: Monitoring and optimization
tags: [Apache Spark, Delta Lake, PySpark, MERGE, Time travel]
---
# Using Spark with Delta Lake (DataFrame API)

> On Databricks every `saveAsTable` already writes Delta. This module is the Python side of Delta Lake: write options that change the schema or replace one slice, reading old versions, and the `DeltaTable` class for history, DML and MERGE.

**The one idea to remember:** every DataFrame write to a Delta table is **one atomic commit** that creates a new version. Options decide *what* the commit changes; the log makes sure readers see all of it or none of it.

## 💾 What Delta adds to df.write

The save modes (`append`, `overwrite`, ...) are covered in *DataFrames: reading and writing data*. With Delta, each one becomes a commit.

```python
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
orders.write.mode("overwrite").saveAsTable("sdl_orders")   # Delta is the default format
orders.limit(10).write.mode("append").saveAsTable("sdl_orders")
# format("delta") is optional on Databricks, but harmless:
orders.write.format("delta").mode("overwrite").saveAsTable("sdl_orders")
```

- `append` adds files and logs them. Existing files are not touched.
- `overwrite` logs a `remove` for every old file. The old version stays readable.
- The schema is **checked** on every append. Mismatches fail instead of corrupting the table.

## 🔒 Readers see a snapshot

Overwriting a plain Parquet folder and overwriting a Delta table look the same in code. They behave very differently while the write runs, and when it fails.

```viz compare
{"items": [{"icon": "📁", "title": "Parquet folder", "sub": "df.write.mode(\"overwrite\").parquet(path)", "color": "red",
            "points": ["Old files are **deleted first**, then new ones are written", "❌ A reader in between sees an empty or half-written folder", "❌ A failed job leaves partial data and no way back"],
            "foot": "No transactions"},
           {"icon": "🔺", "title": "Delta table", "sub": "df.write.mode(\"overwrite\").saveAsTable(t)", "color": "green",
            "points": ["New files are written, then **one commit** swaps them in", "✅ Readers keep reading the previous version until the commit", "✅ A failed job commits nothing; the old version stays readable"],
            "foot": "Atomic, with time travel"}]}
```

The mechanics of concurrent writers are in *ACID and concurrency in Delta Lake*.

## 🧬 Schema on write

```viz code
title: Changing the schema from Python
lang: python
---
wider = orders.withColumn("channel", F.lit("web"))
wider.write.mode("append").saveAsTable("sdl_orders")
# fails: the table has no column "channel"

(wider.write.mode("append")
      .option("mergeSchema", "true")
      .saveAsTable("sdl_orders"))

(slim.write.mode("overwrite")
     .option("overwriteSchema", "true")
     .saveAsTable("sdl_orders"))
---
1-3 | Enforcement | An extra column is a mismatch. The append fails and **nothing** is committed.
5-7 | mergeSchema | Adds `channel` to the table schema. Old rows read it as NULL. It can add columns, not drop or retype them.
9-11 | overwriteSchema | Replaces the data **and** the schema, for example to drop or retype columns. Only with `overwrite`.
```

## 🎯 Overwrite one slice with replaceWhere

A full `overwrite` rewrites the whole table. Add `.option("replaceWhere", "<predicate>")` and the commit removes only the rows that match the predicate, then adds the new rows. Here March is reloaded without its TEST orders.

```viz table
{"title": "sdl_orders", "columns": ["order_id", "order_date", "status"],
 "rows": [[11, "2025-02-14", "COMPLETED"], [12, "2025-03-02", "COMPLETED"], [13, "2025-03-09", "TEST"],
          [14, "2025-03-28", "OPEN"], [15, "2025-04-03", "COMPLETED"]],
 "steps": [
  {"label": "Before", "note": "February, March and April are in the table. March has a TEST order that should not be there."},
  {"label": "Match the predicate", "note": "`replaceWhere = \"order_date >= '2025-03-01' AND order_date < '2025-04-01'\"` selects only the March rows.", "hl": [1, 2, 3]},
  {"label": "Remove March", "note": "The commit removes every row that matches the predicate. February and April are not read or rewritten.", "del": [1, 2, 3]},
  {"label": "Add the new March", "note": "The new DataFrame holds March without TEST rows. A row **outside** the predicate would make the write fail.", "add": [[12, "2025-03-02", "COMPLETED"], [14, "2025-03-28", "OPEN"]]}
 ]}
```

## 🕰️ Read an older version

Every commit is a version. The reader options `versionAsOf` and `timestampAsOf` return the table as it was. The SQL side (`VERSION AS OF`, `RESTORE`, `VACUUM`) is in *Time travel, RESTORE and VACUUM*.

```viz timeline
{"title": "Versions created by the Try it cells (first run)",
 "items": [
  {"label": "v0", "title": "overwrite", "sub": "Jan to Mar 2025", "color": "navy", "note": "`mode(\"overwrite\").saveAsTable` creates the table."},
  {"label": "v1", "title": "append", "sub": "April", "color": "green", "note": "`mode(\"append\")` adds files. v0 is still readable with `versionAsOf=0`."},
  {"label": "v2", "title": "replaceWhere", "sub": "March reloaded", "color": "amber", "note": "Only March files are removed and replaced."},
  {"label": "v3", "title": "DELETE", "sub": "DeltaTable.delete", "color": "red", "note": "TEST orders leave the table."},
  {"label": "v4", "title": "UPDATE", "sub": "DeltaTable.update", "color": "blue", "note": "Discounts above 20% are capped. Only files with matching rows are rewritten."},
  {"label": "v5", "title": "MERGE", "sub": "DeltaTable.merge", "color": "purple", "note": "Three updates and two inserts in one commit."}
 ]}
```

```python
spark.read.option("versionAsOf", 0).table("sdl_orders")
spark.read.option("timestampAsOf", "2026-11-17 09:00:00").table("sdl_orders")
```

## 🧰 The DeltaTable API

`from delta.tables import DeltaTable` gives you a handle on a table. Each method is the Python twin of a SQL command and creates a new version.

| Call | What it does | SQL twin |
|---|---|---|
| `DeltaTable.forName(spark, "t")` | Get a handle on the table | none |
| `dt.history()` | Commits as a DataFrame | `DESCRIBE HISTORY` |
| `dt.delete("status = 'TEST'")` | Delete matching rows | `DELETE FROM` |
| `dt.update(cond, {"col": expr})` | Change matching rows | `UPDATE` |
| `dt.merge(src, cond)...execute()` | Upsert | `MERGE INTO` |
| `dt.optimize().executeCompaction()` | Compact small files | `OPTIMIZE` |

Conditions and values can be SQL strings (`"discount > 0.2"`) or Columns (`F.col("discount") > 0.2`). In the notebook, compaction runs through SQL `OPTIMIZE`, which works on every compute type.

## 🔀 MERGE from Python

The builder reads like the SQL statement. Nothing runs until `execute()`. How MERGE matches rows is explained in *UPDATE, DELETE and MERGE*.

```viz code
title: an upsert with the DeltaTable builder
lang: python
---
from delta.tables import DeltaTable

target = DeltaTable.forName(spark, "sdl_orders")
(target.alias("t")
   .merge(changes.alias("s"), "t.order_id = s.order_id")
   .whenMatchedUpdateAll()
   .whenNotMatchedInsertAll()
   .execute())
---
3 | The target | A handle, not a DataFrame. It does not read any data yet.
4-5 | Source and key | `changes` is any DataFrame. Each source row must match **at most one** target row.
6 | Matched | Overwrite every column of the target row with the source row.
7 | Not matched | Insert source rows whose key is not in the target.
8 | execute() | One commit. Readers see all of it or none of it.
```

Use `whenMatchedUpdate(set={...})` or `whenMatchedDelete()` for finer control.

## 🧪 Try it: one table, six commits

```dataset retail
```

```python run
# v0 and v1: write Jan-Mar 2025, then append April
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
q1 = orders.filter("order_date < '2025-04-01'")
april = orders.filter("order_date >= '2025-04-01' AND order_date < '2025-05-01'")

q1.write.mode("overwrite").saveAsTable("sdl_orders")
april.write.mode("append").saveAsTable("sdl_orders")
print(spark.table("sdl_orders").count(), "rows")
```

```python run
# v2: reload March only, without TEST orders
march_pred = "order_date >= '2025-03-01' AND order_date < '2025-04-01'"
march = orders.filter(march_pred).filter(F.col("status") != "TEST")

(march.write.mode("overwrite")
      .option("replaceWhere", march_pred)
      .saveAsTable("sdl_orders"))
display(spark.table("sdl_orders").groupBy("status").count())
```

```python run
# v3 to v5: delete, update, then upsert 3 changed and 2 new orders
from delta.tables import DeltaTable

dt = DeltaTable.forName(spark, "sdl_orders")
dt.delete(F.col("status") == "TEST")
dt.update(F.col("discount") > 0.2, {"discount": F.lit(0.2)})

changed = spark.table("sdl_orders").orderBy("order_id").limit(3).withColumn("quantity", F.col("quantity") + 10)
new = orders.filter("order_date >= '2025-05-01'").orderBy("order_id").limit(2)
(dt.alias("t").merge(changed.unionByName(new).alias("s"), "t.order_id = s.order_id")
   .whenMatchedUpdateAll().whenNotMatchedInsertAll().execute())

display(dt.history().select("version", "operation", "operationMetrics"))
```

```python run
# Compare the newest version with the very first one
latest = spark.table("sdl_orders").count()
first = spark.read.option("versionAsOf", 0).table("sdl_orders").count()
print(f"version 0: {first} rows, now: {latest} rows")
```

> On re-runs, version 0 is the table's first-ever version. The `overwrite` in the first cell does not reset the history; it adds a new version.

## Exercise 1: add a column without breaking the table

Create `sdl_ex_orders` from the first 1,000 orders. Then append 10 rows that carry an extra `channel` column. Predict what happens without and with `mergeSchema`, and what `channel` contains for the old rows.

```python todo
# TODO 1: write fact_orders rows with order_id <= 1000 to sdl_ex_orders (overwrite)
# TODO 2: append 10 rows with F.lit("web").alias("channel") added; catch and print the error
# TODO 3: append again with option("mergeSchema", "true"); count rows per channel
```

```python solution
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
orders.filter("order_id <= 1000").write.mode("overwrite").saveAsTable("sdl_ex_orders")

extra = orders.filter("order_id BETWEEN 1001 AND 1010").withColumn("channel", F.lit("web"))
try:
    extra.write.mode("append").saveAsTable("sdl_ex_orders")
except Exception as e:
    print("Rejected:", type(e).__name__, str(e)[:200])   # schema mismatch, nothing committed

extra.write.mode("append").option("mergeSchema", "true").saveAsTable("sdl_ex_orders")
display(spark.table("sdl_ex_orders").groupBy("channel").count())
# 1000 rows with channel NULL (written before the column existed), 10 rows with 'web'.
```

## Exercise 2: upsert, then prove the old version

Copy January 2025 into `sdl_ex_jan`. MERGE a source of 2 changed January orders (status set to `CANCELLED`) and 3 February orders. Predict the row count after the merge and how many CANCELLED rows version 0 had, then check both.

```python todo
# TODO 1: write January 2025 orders to sdl_ex_jan (overwrite)
# TODO 2: build the source: 2 January orders with status CANCELLED + 3 February orders
# TODO 3: DeltaTable merge (update all / insert all), then compare counts with versionAsOf
```

```python solution
from pyspark.sql import functions as F
from delta.tables import DeltaTable

orders = spark.table("fact_orders")
jan = orders.filter("order_date < '2025-02-01'")
jan.write.mode("overwrite").saveAsTable("sdl_ex_jan")
v_before = DeltaTable.forName(spark, "sdl_ex_jan").history().agg(F.max("version")).first()[0]

changed = jan.filter("status = 'COMPLETED'").orderBy("order_id").limit(2).withColumn("status", F.lit("CANCELLED"))
feb = orders.filter("order_date >= '2025-02-01' AND order_date < '2025-03-01'").orderBy("order_id").limit(3)

(DeltaTable.forName(spark, "sdl_ex_jan").alias("t")
   .merge(changed.unionByName(feb).alias("s"), "t.order_id = s.order_id")
   .whenMatchedUpdateAll().whenNotMatchedInsertAll().execute())

before = spark.read.option("versionAsOf", v_before).table("sdl_ex_jan")
after = spark.table("sdl_ex_jan")
print("rows:", before.count(), "->", after.count())   # +3: the February orders were inserted
print("cancelled:", before.filter("status = 'CANCELLED'").count(), "->",
      after.filter("status = 'CANCELLED'").count())    # +2: the matched rows were updated

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS sdl_ex_jan"); spark.sql("DROP TABLE IF EXISTS sdl_ex_orders"); spark.sql("DROP TABLE IF EXISTS sdl_orders")
```

## ⚠️ Common mistakes

- ❌ `mode("overwrite")` to fix one month. It rewrites the whole table; use `replaceWhere`.
- ❌ `mergeSchema` to drop or retype a column. It only adds columns; that needs `overwriteSchema`.
- ❌ A MERGE source with duplicate keys. The merge fails when two source rows match one target row.
- ❌ Expecting `overwrite` to delete history. Old versions stay readable until `VACUUM`.
- ✅ Read `dt.history()` to find the version you need, instead of guessing numbers.
- ✅ Prefer `saveAsTable` (Unity Catalog tables) over writing Delta files to a path.

## 🧭 Cheat sheet

| I want to… | Python |
|---|---|
| Add rows, or replace the table | `df.write.mode("append" / "overwrite").saveAsTable("t")` |
| Add a new column on append | `.option("mergeSchema", "true")` |
| Replace one slice only | `.mode("overwrite").option("replaceWhere", "<predicate>")` |
| Read an old version | `spark.read.option("versionAsOf", 3).table("t")` |
| Delete, update, upsert | `DeltaTable.forName(spark, "t").delete / update / merge` |
| See the commits | `DeltaTable.forName(spark, "t").history()` |
