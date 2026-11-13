---
title: Deletion vectors
summary: See why deleting one row used to rewrite a whole file, how a deletion vector marks rows instead, what it looks like in the log, and when the rows really leave storage.
icon: 🩹
level: Intermediate
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, Deletion vectors, DML, Merge-on-read]
---
# Deletion vectors

> Parquet files cannot be edited. Without help, deleting one row means rewriting the whole file around it. A **deletion vector** is a small side file that says "these row positions are gone", so the big file can stay as it is.

**The one idea to remember:** with deletion vectors, `DELETE`, `UPDATE` and `MERGE` **mark** rows instead of rewriting files, and readers skip the marked rows. The rows physically leave storage only after a rewrite **and** `VACUUM`.

## 🧱 The problem: copy-on-write

Without deletion vectors, Delta uses **copy-on-write**. A data file is immutable, so to delete 3 rows from a file of 60,000 rows the engine must read the file, write a new one with the 59,997 survivors, and log a `remove` for the old file.

```viz files
{"title": "orders/  (DELETE without deletion vectors)",
 "steps": [
  {"label": "Start", "note": "One data file with 60,000 rows. The log lists it with an `add` action.",
   "add": [{"path": "part-00000-a1f3.snappy.parquet", "tag": "60,000 rows"},
           {"path": "_delta_log/00000000000000000000.json", "tag": "v0 · add"}]},
  {"label": "DELETE 3 rows", "note": "The engine reads all 60,000 rows and writes **59,997 of them again** into a new file. The old file becomes a tombstone. Write cost: one full file, for 3 rows.",
   "add": [{"path": "part-00000-b2e8.snappy.parquet", "tag": "59,997 rows (rewritten)"},
           {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · remove, add"}],
   "remove": ["part-00000-a1f3.snappy.parquet"]}
 ]}
```

This is called **write amplification**. On a table that receives a small `MERGE` every few minutes, most of the work is copying rows that did not change.

## 🩹 The fix: merge-on-read

With deletion vectors the same `DELETE` writes almost nothing. The data file stays in the table, and a tiny `.bin` file records which row positions are deleted. Readers **merge** the two **on read**.

```viz files
{"title": "orders/  (DELETE with deletion vectors)",
 "steps": [
  {"label": "Start", "note": "The same table: one file with 60,000 rows.",
   "add": [{"path": "part-00000-a1f3.snappy.parquet", "tag": "60,000 rows"},
           {"path": "_delta_log/00000000000000000000.json", "tag": "v0 · add"}]},
  {"label": "DELETE 3 rows", "note": "Only a small bitmap is written. The commit re-adds the **same** data file, now with a pointer to the vector. No row is copied.",
   "add": [{"path": "deletion_vector_5d1c9e2a.bin", "tag": "3 positions marked"},
           {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · remove, add + DV"}],
   "tag": {"part-00000-a1f3.snappy.parquet": "60,000 rows, 3 marked"}},
  {"label": "REORG ... APPLY (PURGE)", "note": "Later, a rewrite produces a clean file without the marked rows. The old file and its vector leave the table but are **still on disk**.",
   "add": [{"path": "part-00000-c7d9.snappy.parquet", "tag": "59,997 rows"},
           {"path": "_delta_log/00000000000000000002.json", "tag": "v2 · remove, add"}],
   "remove": ["part-00000-a1f3.snappy.parquet", "deletion_vector_5d1c9e2a.bin"]},
  {"label": "VACUUM (after retention)", "note": "Only now are the deleted rows physically gone from storage.",
   "delete": ["part-00000-a1f3.snappy.parquet", "deletion_vector_5d1c9e2a.bin"]}
 ]}
```

## 🔢 Rows are marked, not removed

A deletion vector is a compressed bitmap (a RoaringBitmap) of **row positions** inside one data file. Step through a `DELETE` and an `UPDATE` on six rows of one file.

```viz table
{"title": "part-00000-a1f3.snappy.parquet  +  its deletion vector",
 "columns": ["position", "order_id", "status", "marked?"],
 "rows": [[0, 1, "SHIPPED", "no"], [1, 2, "TEST", "no"], [2, 3, "SHIPPED", "no"],
          [3, 4, "TEST", "no"], [4, 5, "PENDING", "no"], [5, 6, "SHIPPED", "no"]],
 "steps": [
  {"label": "Start", "note": "Six physical rows. No deletion vector yet."},
  {"label": "DELETE WHERE status = 'TEST'", "note": "Positions 1 and 3 are set in the bitmap. The Parquet file is untouched.", "upd": {"1": {"marked?": "yes"}, "3": {"marked?": "yes"}}, "del": [1, 3]},
  {"label": "UPDATE order 5 to SHIPPED", "note": "An update is a delete plus an insert: position 4 is marked, and the new version of the row goes to a **small new file**.", "upd": {"4": {"marked?": "yes"}}, "del": [4], "add": [["new file · 0", 5, "SHIPPED", "no"]]},
  {"label": "Read the table", "note": "The reader loads the file, drops positions 1, 3 and 4, and adds the rows of the new file. Four rows come back.", "hl": [0, 2, 5, 6]}
 ]}
```

## 🧩 Inside the commit

The vector is attached to the file entry in the log. Adding a vector is logged as a `remove` and an `add` of the **same path**, the new `add` carrying a `deletionVector` descriptor.

```viz code
title: _delta_log/00000000000000000001.json
lang: json
---
{"commitInfo": {"operation": "DELETE",
                "operationParameters": {"predicate": "[\"(order_id IN (1, 2, 3))\"]"}}}
{"remove": {"path": "part-00000-a1f3.snappy.parquet", "dataChange": true}}
{"add": {"path": "part-00000-a1f3.snappy.parquet", "size": 1048576,
         "dataChange": true, "stats": "{\"numRecords\":60000, ...}",
         "deletionVector": {
            "storageType": "u",
            "pathOrInlineDv": "ab^-aqEH.-t@S}K{vb[*k^",
            "offset": 1,
            "sizeInBytes": 36,
            "cardinality": 3}}}
---
1-2 | commitInfo | A normal `DELETE` commit. `DESCRIBE HISTORY` shows it as usual.
3 | remove | The file entry **without** a vector leaves the table state.
4-5 | add | The same file comes back. `numRecords` still counts all 60,000 physical rows.
7 | storageType | `u`: a `deletion_vector_<uuid>.bin` file next to the data. `i`: the bitmap is stored inline in the log. `p`: an absolute path.
8 | pathOrInlineDv | An encoded UUID that gives the `.bin` file name (or the inline bitmap itself).
9-10 | offset, sizeInBytes | Where the vector starts inside the `.bin` file and how long it is. One `.bin` file can hold vectors for several data files.
11 | cardinality | How many rows are marked. The table row count is 60,000 minus 3.
```

## ✏️ What each statement writes

| Statement | Without deletion vectors | With deletion vectors |
|---|---|---|
| `DELETE` | Rewrite every file that holds a matching row | Only a vector per touched file |
| `UPDATE` | Rewrite every touched file in full | Vector marks the old rows, a small new file holds the new rows |
| `MERGE` | Rewrite every file with a matched row, plus new files for inserts | Vectors for matched rows, new files for updated and inserted rows |

A `DELETE` without a `WHERE` clause, or one that removes every row of a file, simply logs `remove` for whole files in both cases. No vector is needed for a file that is gone completely.

## 🧹 When rows really leave storage

Marked rows stay inside the Parquet file. Three steps get rid of them:

- **`OPTIMIZE`** and auto compaction rewrite files and drop marked rows on the way, but they only pick files that are worth compacting.
- **`REORG TABLE t APPLY (PURGE)`** rewrites **every** file that has a deletion vector. Use it when the data must go.
- **`VACUUM`** then deletes the old files and `.bin` files once they are older than the retention period (7 days by default).

> For a privacy request ("delete this customer"), `DELETE` alone is not enough. Until `REORG ... APPLY (PURGE)` and `VACUUM` have run, the rows are still on disk and readable with time travel.

## ⚙️ Turning them on, and what it costs

- The table property is `delta.enableDeletionVectors = true`. Many workspaces turn it on by default for new tables, so check `SHOW TBLPROPERTIES` before you assume.
- Enabling it adds the **table feature** `deletionVectors` and upgrades the protocol to reader version 3 and writer version 7. Clients that do not support the feature (old runtimes, some external engines) can no longer read the table. `ALTER TABLE t DROP FEATURE deletionVectors` reverses it.
- Deletion vectors are the base for **row-level concurrency** (two writers changing different rows of the same file no longer conflict) and for **predictive I/O for updates** on Photon.

```viz compare
{"items": [
 {"icon": "✍️", "title": "Writes", "color": "green", "points": ["✅ No full-file rewrite for a few rows", "✅ Fast frequent MERGE, CDC and GDPR deletes", "✅ Fewer concurrent-write conflicts"]},
 {"icon": "📖", "title": "Reads", "color": "amber", "points": ["❌ Readers must load and apply the vectors", "❌ Many vectors per file slow scans until compaction", "neutral: OPTIMIZE cleans this up"]},
 {"icon": "🔒", "title": "Privacy", "color": "red", "points": ["❌ Deleted rows stay in the file", "✅ Fix: REORG ... APPLY (PURGE), then VACUUM"]}
]}
```

## 🧪 Try it: watch a delete become a vector

```dataset retail
```

Create a copy of the orders with deletion vectors on, delete three rows, and read the history.

```sql run
-- A table with deletion vectors enabled
CREATE OR REPLACE TABLE dv_orders
TBLPROPERTIES ('delta.enableDeletionVectors' = true)
AS SELECT * FROM fact_orders;

DELETE FROM dv_orders WHERE order_id IN (1, 2, 3);

SHOW TBLPROPERTIES dv_orders;   -- delta.enableDeletionVectors, delta.feature.deletionVectors
```

```python run
# What did the DELETE write? Look at the metrics of each commit
h = spark.sql("DESCRIBE HISTORY dv_orders")
display(h.select("version", "operation",
                 h.operationMetrics["numDeletionVectorsAdded"].alias("dv_added"),
                 h.operationMetrics["numRemovedFiles"].alias("removed_files"),
                 h.operationMetrics["numDeletedRows"].alias("deleted_rows")))
```

```sql run
-- Protocol versions and table features
DESCRIBE DETAIL dv_orders;   -- minReaderVersion 3, minWriterVersion 7, tableFeatures

-- Rewrite every file that carries a deletion vector
REORG TABLE dv_orders APPLY (PURGE);
```

```python run
# The newest commit rewrote the file: compare its metrics with the DELETE
display(spark.sql("DESCRIBE HISTORY dv_orders").select("version", "operation", "operationMetrics"))
```

> Expect `dv_added` of 1 (one per touched file) and `removed_files = 0` for the `DELETE`: no file was rewritten. The purge commit shows files removed and added instead.

## Exercise 1: where does an updated row go?

Predict before you run: after updating 5 rows in a table with deletion vectors, how many data files does the table have, and how many rows does each one hold?

```sql todo
-- TODO 1: create dv_ex_orders from orders 1 to 5000 with deletion vectors enabled
-- TODO 2: set status = 'SHIPPED' for order_id 10 to 14
-- TODO 3: count rows per data file with _metadata.file_name
```

```sql solution
CREATE OR REPLACE TABLE dv_ex_orders
TBLPROPERTIES ('delta.enableDeletionVectors' = true)
AS SELECT * FROM fact_orders WHERE order_id <= 5000;

UPDATE dv_ex_orders SET status = 'SHIPPED' WHERE order_id BETWEEN 10 AND 14;

SELECT _metadata.file_name, count(*) AS row_count FROM dv_ex_orders GROUP BY ALL;
-- The file that held orders 10 to 14 shows 5 fewer visible rows (they are marked),
-- and a small new file holds the 5 updated rows. No big file was rewritten.
```

## Exercise 2: is the deleted row really gone?

Use the table from Exercise 1. Delete one order, purge, and then try to read it back with time travel. Explain the result.

```sql todo
-- TODO 1: delete order_id 100 from dv_ex_orders
-- TODO 2: purge the deletion vectors
-- TODO 3: read order_id 100 from version 0 of the table
```

```sql solution
DELETE FROM dv_ex_orders WHERE order_id = 100;
REORG TABLE dv_ex_orders APPLY (PURGE);

SELECT * FROM dv_ex_orders VERSION AS OF 0 WHERE order_id = 100;
-- Still returns the row: the purge wrote new files, but the old ones stay on disk
-- for time travel until VACUUM removes them after the retention period.

-- Clean up the demo tables when you are done
-- DROP TABLE dv_orders;
-- DROP TABLE dv_ex_orders;
```

## ⚠️ Common mistakes

- ❌ "A `DELETE` with deletion vectors removed the data." It only marked the rows. The bytes are still in the Parquet file.
- ❌ Running `VACUUM` alone for a compliance delete. Without a purge first, the current files still contain the marked rows.
- ❌ Enabling deletion vectors on a table that an old client or external engine must still read. Check compatibility first.
- ✅ Run `REORG TABLE t APPLY (PURGE)` and then `VACUUM` when data must physically disappear.
- ✅ Let `OPTIMIZE` or predictive optimization compact tables with many vectors, so reads stay fast.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Turn deletion vectors on | `ALTER TABLE t SET TBLPROPERTIES ('delta.enableDeletionVectors' = true)` |
| Check if they are on | `SHOW TBLPROPERTIES t`, `DESCRIBE DETAIL t` (tableFeatures) |
| See if a DML wrote vectors | `DESCRIBE HISTORY t`: `numDeletionVectorsAdded` |
| Physically drop marked rows | `REORG TABLE t APPLY (PURGE)` |
| Remove old files from storage | `VACUUM t` |
| Turn the feature off again | `ALTER TABLE t DROP FEATURE deletionVectors` |
