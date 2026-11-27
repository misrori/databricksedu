---
title: "Delta Lake features: reliable data"
summary: A tour of the Delta Lake features that keep data correct, each with a small demo you can run. ACID transactions, history and time travel, schema enforcement and evolution, MERGE, the change data feed, and one table for batch and streaming.
icon: 🛡️
level: Beginner
minutes: 12
group: Delta Lake internals
tags: [Delta Lake, Features, Time travel, MERGE, Change data feed, Streaming]
---
# Delta Lake features: reliable data

> A folder of Parquet files is cheap and open, but it has no rules: half-written batches, wrong types and lost changes are all possible. Delta Lake adds a transaction log to the same files, and every feature in this module is built on that log.

**The one idea to remember:** every Delta feature is a promise the transaction log keeps for you. Without the log, each of these jobs would be your code's problem.

## 🧰 Parquet folder vs Delta table

The data files are the same Parquet files in both cases. The difference is the `_delta_log` folder next to them.

```viz compare
{"title": "The same data, with and without a transaction log",
 "items": [
  {"icon": "📁", "title": "Plain Parquet folder", "sub": "files only", "color": "gray",
   "points": ["❌ A crashed job leaves half a batch", "❌ Any file with any schema is accepted", "❌ No history: an overwrite is final", "❌ Updates mean rewriting files by hand", "❌ No record of what changed"]},
  {"icon": "🔺", "title": "Delta table", "sub": "Parquet files + `_delta_log`", "color": "green",
   "points": ["✅ ACID transactions", "✅ Schema enforcement and evolution", "✅ History, time travel, `RESTORE`", "✅ `UPDATE`, `DELETE`, `MERGE`", "✅ Change data feed, batch and streaming"],
   "foot": "Every feature below reads or writes the log"}
 ]}
```

Each section below shows one feature: what it is, why it matters, what happens without Delta, and one small demo.

## ⚛️ ACID transactions

A write is **all or nothing**, every version is valid, readers see one fixed version, and a committed write survives failures. The dedicated module **ACID transactions, letter by letter** covers each letter in depth.

**Without Delta:** a job that crashes after writing 3 of 5 files leaves 3 files that every reader sees.

```dataset retail
```

```sql run
-- A small orders table with a rule: quantity must be positive
CREATE OR REPLACE TABLE feat_orders AS
SELECT * FROM fact_orders WHERE order_id <= 1000;
ALTER TABLE feat_orders DROP CONSTRAINT IF EXISTS feat_qty_positive;
ALTER TABLE feat_orders ADD CONSTRAINT feat_qty_positive CHECK (quantity > 0);
```

```python run
# One bad row rejects the whole batch
def rows():
    return spark.table("feat_orders").count()

print("before:", rows())
try:
    spark.sql("""INSERT INTO feat_orders
                 SELECT order_id, order_date, customer_id, product_id,
                        IF(order_id = 1100, -1, quantity), discount, status
                 FROM fact_orders WHERE order_id BETWEEN 1001 AND 1100""")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:120])
print("after: ", rows())   # still 1000: none of the 99 valid rows were committed
```

## 🕰️ History and time travel

Every commit is a numbered **version**. `DESCRIBE HISTORY` lists them, `VERSION AS OF` reads an old one, and `RESTORE` makes an old version current again with a new commit. This is how you audit a table and undo a bad write in seconds.

**Without Delta:** an overwrite replaces the files, and yesterday's data is gone unless you copied it.

```viz timeline
{"title": "The life of feat_orders",
 "items": [
  {"label": "v0", "title": "CREATE", "color": "navy", "note": "The table is created with 1,000 orders."},
  {"label": "v1", "title": "ADD CONSTRAINT", "color": "blue", "note": "A metadata-only commit: no data files change."},
  {"label": "v2", "title": "UPDATE", "color": "amber", "note": "20 orders are set to CANCELLED. Their old files are **removed** in the log, but stay on disk."},
  {"label": "v3", "title": "DELETE", "color": "red", "note": "TEST orders are deleted. `VERSION AS OF 1` still reads every row, because the old files are still there."},
  {"label": "v4", "title": "RESTORE to v1", "color": "green", "note": "A **new** version that looks like v1. History is not rewritten: v2 and v3 stay in the log."}
 ]}
```

```python run
# Two changes, then look back and undo them
before = spark.sql("DESCRIBE HISTORY feat_orders LIMIT 1").first()["version"]
spark.sql("UPDATE feat_orders SET status = 'CANCELLED' WHERE order_id <= 20")
spark.sql("DELETE FROM feat_orders WHERE status = 'TEST'")

q = "SELECT count(*) AS orders, count_if(status = 'CANCELLED') AS cancelled FROM feat_orders"
print("now:       ", spark.sql(q).first())
print(f"v{before}:       ", spark.sql(q.replace("feat_orders", f"feat_orders VERSION AS OF {before}")).first())
spark.sql(f"RESTORE TABLE feat_orders TO VERSION AS OF {before}")
print("restored:  ", spark.sql(q).first())
display(spark.sql("DESCRIBE HISTORY feat_orders").select("version", "operation", "operationMetrics"))
```

## 🧬 Schema enforcement and evolution

**Enforcement:** a write whose columns or types do not fit the table is rejected, so readers never meet a surprise type. **Evolution:** you can still add new columns without rewriting existing data, with `.option("mergeSchema", "true")` on the write or `ALTER TABLE … ADD COLUMNS`. Old rows simply show `NULL` in the new column.

**Without Delta:** any file with any schema lands in the folder, and the error appears later, in someone else's query.

```python run
# Enforcement rejects a wrong type; evolution adds a new column
from pyspark.sql import functions as F

bad = spark.table("feat_orders").limit(5).withColumn("quantity", F.lit("many"))
try:
    bad.write.mode("append").saveAsTable("feat_orders")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:150])

new = (spark.table("fact_orders").where("order_id BETWEEN 1001 AND 1010")
            .withColumn("channel", F.lit("web")))
new.write.mode("append").option("mergeSchema", "true").saveAsTable("feat_orders")

display(spark.sql("SELECT order_id, status, channel FROM feat_orders WHERE order_id >= 998 ORDER BY order_id"))
```

> The rows that were already in the table were not rewritten. Their `channel` is `NULL` because the new column is only in the schema and in the new files.

## 🔀 MERGE: upsert on a key

`MERGE` matches source rows to the target on a key, **updates** the matched rows and **inserts** the new ones in one commit. `WHEN NOT MATCHED BY SOURCE` handles rows that disappeared from the source, for example a soft delete. If **several source rows match the same target row**, `MERGE` fails instead of guessing, so deduplicate the source first.

```viz table
{"title": "MERGE INTO customers USING updates ON id",
 "columns": ["id", "name", "city", "active"],
 "rows": [[1, "Ann", "Paris", true], [2, "Bob", "Rome", true], [3, "Cy", "Oslo", true]],
 "steps": [
  {"label": "Target", "note": "Three customers. The source has id 2 (moved to Milan) and id 4 (new). id 3 is no longer in the source."},
  {"label": "WHEN MATCHED", "note": "id 2 is in both: its row is **updated**.", "upd": {"1": {"city": "Milan"}}, "hl": [1]},
  {"label": "WHEN NOT MATCHED", "note": "id 4 is only in the source: it is **inserted**.", "add": [[4, "Dee", "Lyon", true]], "hl": [3]},
  {"label": "NOT MATCHED BY SOURCE", "note": "id 3 is only in the target: a **soft delete** sets `active = false` instead of removing it.", "upd": {"2": {"active": false}}, "hl": [2]},
  {"label": "One commit", "note": "All three changes are one version. A reader sees all of them or none."}
 ]}
```

**Without Delta:** you rewrite whole files yourself and hope no job reads them in the middle.

```python run
# Upsert 30 orders, then see why duplicate keys make MERGE fail
spark.sql("""CREATE OR REPLACE TEMP VIEW feat_updates AS
             SELECT order_id, order_date, customer_id, product_id, quantity, discount, 'SHIPPED' AS status
             FROM fact_orders WHERE order_id BETWEEN 991 AND 1020""")
merge = """MERGE INTO feat_orders t USING {src} s ON t.order_id = s.order_id
           WHEN MATCHED THEN UPDATE SET t.status = s.status
           WHEN NOT MATCHED THEN INSERT (order_id, order_date, customer_id, product_id, quantity, discount, status)
                                 VALUES (s.order_id, s.order_date, s.customer_id, s.product_id, s.quantity, s.discount, s.status)"""
display(spark.sql(merge.format(src="feat_updates")))   # rows updated and inserted

spark.sql("CREATE OR REPLACE TEMP VIEW feat_updates_dup AS SELECT * FROM feat_updates UNION ALL SELECT * FROM feat_updates WHERE order_id = 991")
try:
    spark.sql(merge.format(src="feat_updates_dup"))
except Exception as e:
    print("MERGE failed:", str(e).splitlines()[0][:150])
```

## 🔁 Change data feed

With `delta.enableChangeDataFeed = true`, Delta records every row-level insert, update and delete between versions. You read them with `table_changes()` in SQL or `.option("readChangeFeed", "true")` in Python. Use it for incremental ETL (process only changed rows), audit trails, and syncing changes to other tables or systems.

**Without Delta:** you compare yesterday's full copy with today's to find what changed.

```python run
# Turn on the change data feed, change three orders, read the changes
spark.sql("ALTER TABLE feat_orders SET TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')")
start = spark.sql("DESCRIBE HISTORY feat_orders LIMIT 1").first()["version"] + 1
spark.sql("UPDATE feat_orders SET quantity = quantity + 1 WHERE order_id IN (1, 2)")
spark.sql("DELETE FROM feat_orders WHERE order_id = 3")

display(spark.sql(f"""SELECT order_id, quantity, _change_type, _commit_version
                      FROM table_changes('feat_orders', {start})
                      ORDER BY _commit_version, order_id, _change_type"""))
```

> An update gives two rows, `update_preimage` and `update_postimage`; a delete gives one `delete` row. Only versions after the feed was switched on can be read.

## 🌊 One table for batch and streaming

The same Delta table can be a **batch source**, a **streaming source** and a **streaming sink**. An ingestion stream writes to it while a dashboard queries it and a training job reads it, all from one copy of the data. A stream remembers in its **checkpoint** which versions it has already processed.

```viz flow
{"title": "One copy of the data, three ways to use it",
 "nodes": [{"icon": "🌊", "title": "Ingestion stream", "sub": "writes", "color": "blue"},
           {"icon": "🔺", "title": "feat_orders", "sub": "one Delta table", "color": "green"},
           {"icon": "📊", "title": "Batch query", "sub": "reads a snapshot", "color": "navy"},
           {"icon": "🌊", "title": "Downstream stream", "sub": "reads new versions", "color": "teal"}],
 "edges": ["streaming sink", "batch source", "streaming source"]}
```

**Without Delta:** a stream that reads a folder must list files and guess which ones are complete.

```python run
# Read feat_orders as a stream and write the big orders to another table
ckpt = data.volume(CATALOG, SCHEMA) + "/feat_checkpoints/big_orders"
dbutils.fs.rm(ckpt, True)                       # start fresh when you re-run this cell
spark.sql("DROP TABLE IF EXISTS feat_big_orders")

q = (spark.readStream.option("skipChangeCommits", "true").table("feat_orders")
          .where("quantity >= 3")
          .writeStream.option("checkpointLocation", ckpt)
          .trigger(availableNow=True)           # process what is there, then stop
          .toTable("feat_big_orders"))
q.awaitTermination()
print("big orders:", spark.table("feat_big_orders").count())
```

> `skipChangeCommits` tells the stream to ignore the `UPDATE` and `DELETE` commits made earlier in this module. A streaming source normally expects appends only.

## Exercise 1: undo a bad delete

Someone deletes every `CANCELLED` order from a copy of the orders. **Predict** how many rows `VERSION AS OF` the version before the delete returns, then bring them back with `RESTORE` and check the history.

```python todo
# TODO 1: create feat_ex_orders from fact_orders (order_id <= 2000)
# TODO 2: remember the latest version, then DELETE the CANCELLED orders
# TODO 3: count the rows now and at the remembered version
# TODO 4: RESTORE to the remembered version and show the history
```

```python solution
spark.sql("CREATE OR REPLACE TABLE feat_ex_orders AS SELECT * FROM fact_orders WHERE order_id <= 2000")
v = spark.sql("DESCRIBE HISTORY feat_ex_orders LIMIT 1").first()["version"]
spark.sql("DELETE FROM feat_ex_orders WHERE status = 'CANCELLED'")

print("now:     ", spark.table("feat_ex_orders").count())
print(f"v{v}:     ", spark.sql(f"SELECT count(*) FROM feat_ex_orders VERSION AS OF {v}").first()[0])  # 2000
spark.sql(f"RESTORE TABLE feat_ex_orders TO VERSION AS OF {v}")
print("restored:", spark.table("feat_ex_orders").count())
display(spark.sql("DESCRIBE HISTORY feat_ex_orders").select("version", "operation"))
```

## Exercise 2: a stream only reads what is new

Stream a source table into a sink once, append 100 orders to the source, and run the same stream again. **Predict** how many rows the second run adds to the sink, and explain how the stream knows.

```python todo
# TODO 1: create feat_ex_src from fact_orders (order_id <= 500) and drop feat_ex_sink
# TODO 2: stream feat_ex_src into feat_ex_sink with trigger(availableNow=True) and a checkpoint in data.volume(CATALOG, SCHEMA)
# TODO 3: append orders 501 to 600 to feat_ex_src
# TODO 4: run the same stream again (same checkpoint) and count the sink after each run
```

```python solution
ckpt = data.volume(CATALOG, SCHEMA) + "/feat_checkpoints/ex_sink"
dbutils.fs.rm(ckpt, True)
spark.sql("CREATE OR REPLACE TABLE feat_ex_src AS SELECT * FROM fact_orders WHERE order_id <= 500")
spark.sql("DROP TABLE IF EXISTS feat_ex_sink")

def run_stream():
    (spark.readStream.table("feat_ex_src")
          .writeStream.option("checkpointLocation", ckpt)
          .trigger(availableNow=True)
          .toTable("feat_ex_sink")
          .awaitTermination())
    return spark.table("feat_ex_sink").count()

print("first run: ", run_stream())   # 500
spark.sql("INSERT INTO feat_ex_src SELECT * FROM fact_orders WHERE order_id BETWEEN 501 AND 600")
print("second run:", run_stream())   # 600: only the 100 new rows were added
# The checkpoint stores the last source version the stream processed,
# so the second run reads only the commits after it.

# Clean up when you are done
# DROP TABLE feat_orders; DROP TABLE feat_big_orders; DROP TABLE feat_ex_orders;
# DROP TABLE feat_ex_src; DROP TABLE feat_ex_sink;
```

## ⚠️ Common mistakes

- ❌ "Time travel is a backup." It works only while the old files exist: `VACUUM` deletes them after the retention period.
- ❌ Using `mergeSchema` to fix a wrong type. Evolution adds columns; enforcement still rejects incompatible types.
- ❌ Running `MERGE` with a source that has duplicate keys. Deduplicate the source first, for example keep the latest row per key.
- ❌ Expecting `table_changes` to show changes from before the feed was switched on.
- ✅ Use `RESTORE` to undo a bad write: it adds a new version, so the undo itself is in the history.

## 🧭 Cheat sheet

| Feature | Command |
|---|---|
| History and time travel | `DESCRIBE HISTORY t`, `SELECT … FROM t VERSION AS OF 3`, `RESTORE TABLE t TO VERSION AS OF 3` |
| Schema evolution | `.option("mergeSchema", "true")`, `ALTER TABLE t ADD COLUMNS (c STRING)` |
| Upsert | `MERGE INTO t USING s ON … WHEN MATCHED … WHEN NOT MATCHED … WHEN NOT MATCHED BY SOURCE …` |
| Change data feed | `delta.enableChangeDataFeed = true`, `table_changes('t', 5)` |
| Streaming | `spark.readStream.table("t")`, `.writeStream.toTable("t2")` |
