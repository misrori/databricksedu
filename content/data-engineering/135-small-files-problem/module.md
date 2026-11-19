---
title: "The small-file problem: OPTIMIZE and VACUUM"
summary: See why thousands of tiny files slow every query down, how OPTIMIZE compacts them into large files, and why the old files stay on disk until VACUUM removes them after the retention window.
icon: 🐜
level: Intermediate
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, OPTIMIZE, VACUUM, Small files, Maintenance]
---
# The small-file problem: OPTIMIZE and VACUUM

> Streaming jobs and frequent small writes scatter a table into thousands of tiny files, and every query pays for each one. Two commands keep a Delta table healthy: `OPTIMIZE` compacts, `VACUUM` cleans up.

**The one idea to remember:** `OPTIMIZE` **adds** a few large files and retires the small ones, but deletes nothing. `VACUUM` **deletes** the retired files, and only once they are older than the retention window (7 days by default).

> 🎞️ Watch the slide version: [OPTIMIZE & VACUUM deck](https://misrori.github.io/databricksedu/extras/optimize-vacuum/)

## 🧹 Two commands, two jobs

Table maintenance is a pair. One command makes reads fast, the other gives the storage back. Run them in this order.

```viz compare
{"items": [{"icon": "📦", "title": "OPTIMIZE", "sub": "compacts small files", "color": "blue",
            "points": ["Bin-packs many small files into a few large ones (about 1 GB each)", "Writes a new table version; the rows do not change", "Deletes nothing: old files stay for time travel"],
            "foot": "`OPTIMIZE events_delta;`"},
           {"icon": "🧹", "title": "VACUUM", "sub": "cleans up the leftovers", "color": "amber",
            "points": ["Deletes files the current version no longer uses", "Only files older than the retention window (7 days)", "Ends time travel to the versions that needed them"],
            "foot": "`VACUUM events_delta;`"}]}
```

## 🐜 Why small files hurt

A table that receives a micro-batch every few seconds gets a few new files every few seconds. After a week it can hold thousands of files of a few MB each. A query does not pay per byte only; it also pays **per file**.

| Per-file cost | Why it adds up |
|---|---|
| Listing and log entry | Every file is an `add` action the reader must load |
| Open request | Each file is a separate call to cloud storage, with its own latency |
| Footer and statistics | Each Parquet footer is read before any row |
| Task scheduling | Many tiny reads keep tasks busy with overhead, not rows |

Example: an `events_delta` table of about 2.8 GB stored as **280 files of 5-15 MB**. The same data fits in **3 files of about 1 GB**.

## 📦 OPTIMIZE, then VACUUM, on disk

Step through what happens to the folder. Watch the difference between a file that leaves the **table** and a file that leaves the **disk**.

```viz files
{"title": "events_delta/",
 "steps": [
  {"label": "280 small appends", "note": "A streaming job committed 280 times. Each commit added a small file. The current version reads **280 files**.",
   "add": [{"path": "part-00000-0a1.snappy.parquet", "tag": "8 MB"}, {"path": "part-00000-0b2.snappy.parquet", "tag": "12 MB"},
           {"path": "part-00000-0c3.snappy.parquet", "tag": "5 MB"}, {"path": "part-00000-0d4.snappy.parquet", "tag": "15 MB"},
           {"path": "part-00000-… 276 more.snappy.parquet", "tag": "276 files · 5-15 MB"},
           {"path": "_delta_log/00000000000000000280.json", "tag": "v280 · last append"}]},
  {"label": "OPTIMIZE", "note": "Bin-packing: the small files are read and rewritten as **3 files of about 1 GB**. The commit removes the 280 files from the table, but they stay on disk as tombstones.",
   "add": [{"path": "part-00000-f01.snappy.parquet", "tag": "~1 GB · compacted"}, {"path": "part-00001-f02.snappy.parquet", "tag": "~1 GB · compacted"},
           {"path": "part-00002-f03.snappy.parquet", "tag": "~0.8 GB · compacted"},
           {"path": "_delta_log/00000000000000000281.json", "tag": "v281 · remove ×280, add ×3"}],
   "remove": ["part-00000-0a1.snappy.parquet", "part-00000-0b2.snappy.parquet", "part-00000-0c3.snappy.parquet", "part-00000-0d4.snappy.parquet", "part-00000-… 276 more.snappy.parquet"]},
  {"label": "VACUUM on day 2", "note": "The tombstones are only 2 days old, inside the 7-day window. VACUUM deletes **nothing**. Time travel to v280 still works.",
   "tag": {"part-00000-… 276 more.snappy.parquet": "removed 2 days ago · protected"}},
  {"label": "VACUUM on day 8", "note": "The tombstones are now older than 7 days. VACUUM deletes them. Same rows, **283 files on disk → 3**, storage reclaimed. Time travel to v280 no longer works.",
   "delete": ["part-00000-0a1.snappy.parquet", "part-00000-0b2.snappy.parquet", "part-00000-0c3.snappy.parquet", "part-00000-0d4.snappy.parquet", "part-00000-… 276 more.snappy.parquet"]}
 ]}
```

## 🕰️ OPTIMIZE deletes nothing

After `OPTIMIZE`, the **current** version reads 3 files. The **older** versions still list the 280 small files, and those files are still on disk. That is what makes time travel work, and why storage grows at first.

```sql
OPTIMIZE events_delta;
-- metrics: numFilesRemoved = 280, numFilesAdded = 3

SELECT count(*) FROM events_delta VERSION AS OF 280;  -- still works: old files are on disk
DESCRIBE DETAIL events_delta;                          -- numFiles = 3 (current version only)
```

The `OPTIMIZE` commit has `dataChange = false`: the rows are the same, so streaming readers of the table skip it. Running `OPTIMIZE` again is cheap, because files that are already large are left alone.

## ⏱️ The retention window

`VACUUM` only deletes a retired file once it has been retired for longer than `delta.deletedFileRetentionDuration`: **7 days** (168 hours) by default. Step through a week after one `OPTIMIZE`.

```viz timeline
{"title": "Tombstones from an OPTIMIZE on day 0",
 "items": [
  {"label": "0", "title": "OPTIMIZE", "sub": "280 files retired", "color": "blue", "note": "The small files leave the table but stay on disk. The retention clock starts now."},
  {"label": "1", "title": "VACUUM", "sub": "deletes nothing", "color": "green", "note": "One day old: protected. A long query or a lagging stream may still read them."},
  {"label": "3", "title": "Time travel", "sub": "VERSION AS OF 280 ✓", "color": "teal", "note": "Old versions still work because their files are still on disk."},
  {"label": "7", "title": "Window ends", "sub": "168 hours", "color": "amber", "note": "From now on the tombstones are old enough to delete."},
  {"label": "8", "title": "VACUUM", "sub": "280 files deleted", "color": "red", "note": "Storage is reclaimed. Time travel to versions that needed those files now fails."}
 ]}
```

```sql
ALTER TABLE events_delta SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = 'interval 7 days');
VACUUM events_delta RETAIN 168 HOURS;   -- the same threshold, written out for this run
```

## ☠️ Why never RETAIN 0 HOURS

`VACUUM t RETAIN 0 HOURS` deletes every retired file at once. A query that is still running, a stream that has not caught up, or a concurrent writer can then fail on a missing file, and time travel ends immediately. Databricks refuses a retention shorter than the table's setting (7 days by default) unless a safety check is turned off, and that check is a Spark config you cannot set on serverless.

```python
# Display only. Do not do this on a live table (and spark.conf.set is not allowed on serverless)
spark.conf.set("spark.databricks.delta.retentionDurationCheck.enabled", "false")
spark.sql("VACUUM events_delta RETAIN 0 HOURS")
```

Need longer history instead? Raise `delta.deletedFileRetentionDuration`, for example to `'interval 30 days'`. More on history and recovery in the "Time travel, RESTORE and VACUUM" module.

## 🤖 Let Databricks do it

You often do not need to schedule these commands yourself. Check what your tables already use before you add a maintenance job.

| Feature | What it does |
|---|---|
| **Optimized writes** | Shuffles data before a write, so each write produces fewer, larger files |
| **Auto compaction** | After a write commits, compacts the small files it left behind |
| **Predictive optimization** | Runs `OPTIMIZE` and `VACUUM` when it pays off, on Unity Catalog **managed** tables where it is enabled |

Whether each one is on depends on the table type, table properties and account settings. External tables always need your own `VACUUM`. For clustering and data skipping, see the "Optimizing Delta tables" module.

## 🧪 Try it: make the problem, then fix it

```dataset retail
```

Build `sf_orders` from 20 small appends. Each append writes at least one new file.

```python run
# Twenty small appends: at least twenty small files
from pyspark.sql import functions as F

spark.sql("CREATE OR REPLACE TABLE sf_orders AS SELECT * FROM fact_orders WHERE 1 = 0")
orders = spark.table("fact_orders")
for i in range(20):
    orders.filter(F.col("order_id") % 20 == i).write.mode("append").saveAsTable("sf_orders")

display(spark.sql("DESCRIBE DETAIL sf_orders").select("numFiles", "sizeInBytes"))
```

> Expect about 20 files. If you see fewer, **auto compaction** already ran: `DESCRIBE HISTORY sf_orders` then shows an `OPTIMIZE` you did not type. Either way, the next cells show the same mechanics.

```python run
# Remember the last version, then compact
v_before = spark.sql("DESCRIBE HISTORY sf_orders LIMIT 1").first()["version"]

display(spark.sql("OPTIMIZE sf_orders"))   # metrics: numFilesRemoved, numFilesAdded
display(spark.sql("DESCRIBE DETAIL sf_orders").select("numFiles", "sizeInBytes"))
```

```python run
# The OPTIMIZE commit in the history, and the old version that still works
display(spark.sql("DESCRIBE HISTORY sf_orders")
        .select("version", "operation",
                F.col("operationMetrics")["numRemovedFiles"].alias("removed"),
                F.col("operationMetrics")["numAddedFiles"].alias("added"))
        .limit(5))

display(spark.sql(f"""
  SELECT count(*) AS row_count, count(DISTINCT _metadata.file_name) AS files
  FROM sf_orders VERSION AS OF {v_before}"""))
```

```sql run
-- Which files would VACUUM delete now? (DRY RUN lists them and deletes nothing)
VACUUM sf_orders DRY RUN;
```

> The list is empty. The small files were retired minutes ago, well inside the 7-day window, so nothing is old enough to delete. Run `VACUUM sf_orders` in a week and they would go.

## Exercise 1: predict the file counts

Build `sf_events` from 8 appends, then compact it twice. Write down your three predictions **before** you run anything: `numFiles` after the appends, after the first `OPTIMIZE`, and the number of new versions the second `OPTIMIZE` creates.

```python todo
from pyspark.sql import functions as F

# TODO 1: create an empty sf_events with the schema of fact_orders
# TODO 2: append 8 slices of fact_orders (order_id % 8) and show numFiles
# TODO 3: OPTIMIZE twice, then look at DESCRIBE HISTORY
```

```python solution
from pyspark.sql import functions as F

spark.sql("CREATE OR REPLACE TABLE sf_events AS SELECT * FROM fact_orders WHERE 1 = 0")
for i in range(8):
    spark.table("fact_orders").filter(F.col("order_id") % 8 == i).write.mode("append").saveAsTable("sf_events")
display(spark.sql("DESCRIBE DETAIL sf_events").select("numFiles"))   # about 8

spark.sql("OPTIMIZE sf_events")
display(spark.sql("DESCRIBE DETAIL sf_events").select("numFiles"))   # 1: 60,000 rows fit in one file

spark.sql("OPTIMIZE sf_events")                                        # nothing left to compact
display(spark.sql("DESCRIBE HISTORY sf_events").select("version", "operation").limit(4))
# The second OPTIMIZE finds no small files and does not create a new OPTIMIZE version.
```

## Exercise 2: what will VACUUM delete, and when?

Make `sf_events_ex2` with three small appends and one `OPTIMIZE`. Then answer: what does `VACUUM ... RETAIN 168 HOURS DRY RUN` return right now? Raise the table's retention to 30 days and say how long time travel to the pre-OPTIMIZE version will now work.

```sql todo
-- TODO 1: CREATE OR REPLACE sf_events_ex2 with orders 1-1000, then INSERT 1001-2000 and 2001-3000
-- TODO 2: OPTIMIZE it, then VACUUM ... RETAIN 168 HOURS DRY RUN
-- TODO 3: set delta.deletedFileRetentionDuration to 30 days and check SHOW TBLPROPERTIES
```

```sql solution
CREATE OR REPLACE TABLE sf_events_ex2 AS SELECT * FROM fact_orders WHERE order_id <= 1000;
INSERT INTO sf_events_ex2 SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 2000;
INSERT INTO sf_events_ex2 SELECT * FROM fact_orders WHERE order_id BETWEEN 2001 AND 3000;
OPTIMIZE sf_events_ex2;

VACUUM sf_events_ex2 RETAIN 168 HOURS DRY RUN;   -- empty: the retired files are minutes old

ALTER TABLE sf_events_ex2 SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = 'interval 30 days');
SHOW TBLPROPERTIES sf_events_ex2;
-- A default VACUUM now keeps retired files for 30 days, so time travel to the
-- pre-OPTIMIZE versions works for 30 days (if the log is also kept that long).

-- Clean up the demo tables when you are done
-- DROP TABLE sf_orders; DROP TABLE sf_events; DROP TABLE sf_events_ex2;
```

## ⚠️ Common mistakes

- ❌ "OPTIMIZE freed my storage." It adds files. Storage drops only after `VACUUM`, once the retention window has passed.
- ❌ "VACUUM ran but deleted nothing, so it is broken." The retired files were younger than 7 days. Use `DRY RUN` to see what it would delete.
- ❌ `VACUUM t RETAIN 0 HOURS` on a live table. Running queries and streams fail, and time travel ends at once.
- ❌ Expecting time travel to a version that `VACUUM` has already cleaned up. Its files are gone.
- ✅ Check `DESCRIBE DETAIL` (`numFiles`, `sizeInBytes`) and `DESCRIBE HISTORY` before adding a maintenance job. Predictive optimization or auto compaction may already do it.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Count files and bytes of the current version | `DESCRIBE DETAIL t` |
| Compact small files (toward ~1 GB) | `OPTIMIZE t` |
| See what VACUUM would delete | `VACUUM t DRY RUN` |
| Delete retired files older than 7 days | `VACUUM t` or `VACUUM t RETAIN 168 HOURS` |
| Keep history longer | `ALTER TABLE t SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = 'interval 30 days')` |
| Check what maintenance ran | `DESCRIBE HISTORY t` |
