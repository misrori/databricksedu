---
title: Anatomy of a Delta table
summary: A Delta table is a folder. See which files are in it, what each one does, and how the folder changes when you insert, update, compact and vacuum.
icon: 🧬
level: Beginner
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, Parquet, Transaction log]
---
# Anatomy of a Delta table

> A Delta table looks like a database table, but on disk it is a **folder**: Parquet files hold the rows, and a `_delta_log` folder records which of those files belong to the table right now.

**The one idea to remember:** data files are never changed in place. Every write adds new Parquet files and one new log entry, and **the log decides which files are the table**.

## 💡 A table is a folder

When you run `CREATE TABLE`, Databricks creates a directory in cloud storage. Everything the table needs is inside it.

```viz tree
{"title": "What is inside a Delta table directory",
 "root": {"icon": "🗂️", "label": "orders/", "sub": "the table directory", "color": "navy", "children": [
   {"icon": "📜", "label": "_delta_log/", "sub": "the transaction log", "color": "purple", "children": [
     {"icon": "📜", "label": "00000000000000000000.json", "sub": "commit 0: one JSON file per transaction", "color": "purple"},
     {"icon": "🏁", "label": "00000000000000000010.checkpoint.parquet", "sub": "a snapshot of the log, for fast reads", "color": "purple"},
     {"icon": "📍", "label": "_last_checkpoint", "sub": "points to the newest checkpoint", "color": "purple"}
   ]},
   {"icon": "📦", "label": "part-00000-….snappy.parquet", "sub": "data file: the rows, stored by column", "color": "green"},
   {"icon": "📦", "label": "part-00001-….snappy.parquet", "sub": "another data file", "color": "green"},
   {"icon": "🩹", "label": "deletion_vector_….bin", "sub": "optional: marks deleted rows", "color": "amber"}
 ]}}
```

- **Data files** are plain Parquet. Any Parquet reader could open them.
- **The log** is what turns a pile of Parquet files into a table with versions and transactions.

## 📦 The data files are Parquet

| Property | What it means for you |
|---|---|
| **Columnar** | A query that needs 3 of 50 columns reads only those 3 |
| **Compressed** | Similar values sit together, so files are small |
| **Statistics** | Each file stores min and max values, which lets the engine skip files |
| **Immutable** | A file is written once and never edited |

That last row matters most. To change one row, Delta cannot edit the file. It writes a **new** file and records in the log that the old one is no longer part of the table.

## 📜 The transaction log

Every successful write is one **commit**, and every commit is one numbered JSON file in `_delta_log`. The number is the **table version**.

```viz timeline
{"title": "Each commit creates the next table version",
 "items": [
  {"label": "v0", "title": "CREATE TABLE", "color": "navy", "note": "The first commit stores the **schema** and the table **protocol**. There are no data files yet."},
  {"label": "v1", "title": "INSERT", "color": "green", "note": "New Parquet files are written, then the commit lists them with `add` actions."},
  {"label": "v2", "title": "UPDATE", "color": "amber", "note": "The files that held the changed rows get a `remove` action. Rewritten files get an `add` action."},
  {"label": "v3", "title": "OPTIMIZE", "color": "blue", "note": "Many small files are replaced by one bigger file. The data is the same, so `dataChange` is false."},
  {"label": "v4", "title": "DELETE", "color": "red", "note": "With deletion vectors the data file stays, and a small `.bin` file marks the deleted rows."}
 ]}
```

To read the table, the engine replays the log: start from nothing, apply every `add` and `remove` in order, and you get the list of files for the version you asked for. Reading an older version is the same replay, stopped earlier. That is **time travel**.

## 🎬 Watch the folder change

Step through what happens on disk. Notice that files are added to the folder all the time, but they only leave it when `VACUUM` runs.

```viz files
{"title": "orders/  (step through the commits)",
 "steps": [
  {"label": "CREATE TABLE orders", "note": "Version 0. The folder has only a log entry with the schema. No data files exist yet.",
   "add": [{"path": "_delta_log/00000000000000000000.json", "tag": "v0 · protocol, metaData"}]},
  {"label": "INSERT 3 rows", "note": "Version 1. One Parquet file is written, then the commit adds it to the table.",
   "add": [{"path": "part-00000-a1f3.snappy.parquet", "tag": "3 rows"},
           {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · add"}]},
  {"label": "INSERT 2 more rows", "note": "Version 2. A second file. Appends never touch the existing files.",
   "add": [{"path": "part-00000-b2e8.snappy.parquet", "tag": "2 rows"},
           {"path": "_delta_log/00000000000000000002.json", "tag": "v2 · add"}]},
  {"label": "UPDATE one row", "note": "Version 3. The row lived in the first file, so that file is rewritten as a new file. The old file is **removed from the table**, but it is still on disk.",
   "add": [{"path": "part-00000-c7d9.snappy.parquet", "tag": "3 rows, 1 changed"},
           {"path": "_delta_log/00000000000000000003.json", "tag": "v3 · remove, add"}],
   "remove": ["part-00000-a1f3.snappy.parquet"]},
  {"label": "OPTIMIZE", "note": "Version 4. The two small files are compacted into one. Both old files become tombstones.",
   "add": [{"path": "part-00000-d4a0.snappy.parquet", "tag": "5 rows"},
           {"path": "_delta_log/00000000000000000004.json", "tag": "v4 · remove ×2, add"}],
   "remove": ["part-00000-b2e8.snappy.parquet", "part-00000-c7d9.snappy.parquet"]},
  {"label": "VACUUM (after the retention period)", "note": "Files that no version inside the retention period needs are deleted from storage. Time travel to versions 1 to 3 stops working.",
   "delete": ["part-00000-a1f3.snappy.parquet", "part-00000-b2e8.snappy.parquet", "part-00000-c7d9.snappy.parquet"]}
 ]}
```

## 🧩 Inside one commit file

A commit file is a list of **actions**, one JSON object per line. This is the `UPDATE` from the previous slide (formatted over several lines so it is easier to read).

```viz code
title: _delta_log/00000000000000000003.json
lang: json
---
{"commitInfo": {"timestamp": 1762425600000, "operation": "UPDATE",
                "operationParameters": {"predicate": "[\"(order_id = 2)\"]"},
                "readVersion": 2, "isolationLevel": "WriteSerializable"}}
{"remove": {"path": "part-00000-a1f3.snappy.parquet",
            "deletionTimestamp": 1762425600000, "dataChange": true}}
{"add": {"path": "part-00000-c7d9.snappy.parquet", "size": 1180,
         "partitionValues": {}, "dataChange": true,
         "stats": "{\"numRecords\":3,\"minValues\":{\"order_id\":1},\"maxValues\":{\"order_id\":3},\"nullCount\":{\"order_id\":0}}"}}
---
1-3 | commitInfo | Who did what: the operation, its parameters, and the version it read. `DESCRIBE HISTORY` shows this.
4-5 | remove | The old file leaves the table. It gets a timestamp, so `VACUUM` knows when it is old enough to delete.
6-7 | add | The rewritten file joins the table. The path is relative to the table directory.
8 | stats | Row count plus min, max and null count per column. The engine uses them to **skip files** that cannot match a filter.
```

| Action | Purpose |
|---|---|
| `metaData` | Schema, partition columns, table properties |
| `protocol` | Which reader and writer features a client needs |
| `add` / `remove` | A file joins or leaves the table |
| `commitInfo` | Audit information about the operation |

## 🏁 Checkpoints keep reads fast

Replaying thousands of JSON files would be slow. So Delta regularly writes a **checkpoint**: a Parquet file that holds the complete state of the table at one version.

- A reader opens `_last_checkpoint`, loads that checkpoint, and replays only the few JSON commits after it.
- Checkpoints are written automatically. You never create them by hand.
- JSON commits are kept for `delta.logRetentionDuration` (30 days by default), which limits how far back history goes.

## 🧪 Try it: look at a real table

```dataset retail
```

Create a small table from a few orders, then ask Delta what is on disk.

```sql run
-- Create a tiny Delta table
CREATE OR REPLACE TABLE anatomy_orders AS
SELECT * FROM fact_orders WHERE order_id <= 1000;

DESCRIBE DETAIL anatomy_orders;   -- format, location, numFiles, sizeInBytes
```

```sql run
-- Which data file does each row live in?
SELECT _metadata.file_name, count(*) AS row_count
FROM anatomy_orders
GROUP BY ALL;
```

```sql run
-- Change one row, then look at the files again
UPDATE anatomy_orders SET status = 'CANCELLED' WHERE order_id = 7;

SELECT _metadata.file_name, count(*) AS row_count
FROM anatomy_orders
GROUP BY ALL;
```

```sql run
-- Every commit is one row here: version, operation and what it changed
DESCRIBE HISTORY anatomy_orders;
```

> On new tables Databricks usually enables **deletion vectors**. Then a small `UPDATE` keeps the old file, marks the changed row as deleted, and writes only the new row to a new file. Look at `operationMetrics` in the history to see which path was taken.

## 🔬 Try it: open the log yourself

A managed table hides its storage path, so write a small Delta table into a **volume**, where you can list the files with plain Python.

```python run
# Write a tiny Delta table into a volume and list its folder
import os

path = data.volume(CATALOG, SCHEMA) + "/anatomy_demo"
spark.table("fact_orders").limit(5).write.format("delta").mode("overwrite").save(path)
spark.sql(f"UPDATE delta.`{path}` SET quantity = 99 WHERE quantity < 99")

for root, _, files in sorted(os.walk(path)):
    for name in sorted(files):
        print(os.path.join(root, name).replace(path, "."))
```

```python run
# Print the actions of every commit
import json

log = path + "/_delta_log"
for name in sorted(f for f in os.listdir(log) if f.endswith(".json")):
    print("\n==", name)
    for line in open(os.path.join(log, name)):
        action = json.loads(line)
        kind = list(action)[0]
        print(f"  {kind:<11}", str(action[kind])[:110])
```

## Exercise 1: count the commits

Insert two more batches into `anatomy_orders`, then predict the next version number **before** you look at the history.

```sql todo
-- TODO 1: insert orders 1001 to 1500 from fact_orders into anatomy_orders
-- TODO 2: insert orders 1501 to 2000
-- TODO 3: show the table history
```

```sql solution
INSERT INTO anatomy_orders SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 1500;
INSERT INTO anatomy_orders SELECT * FROM fact_orders WHERE order_id BETWEEN 1501 AND 2000;

DESCRIBE HISTORY anatomy_orders;   -- two new versions, both with operation WRITE
```

## Exercise 2: find the small files

Each insert wrote at least one new file. Show how many rows each data file holds, compact the table, and compare.

```sql todo
-- TODO 1: rows per data file (use _metadata.file_name)
-- TODO 2: compact the table
-- TODO 3: rows per data file again
```

```sql solution
SELECT _metadata.file_name, count(*) AS row_count FROM anatomy_orders GROUP BY ALL;

OPTIMIZE anatomy_orders;

SELECT _metadata.file_name, count(*) AS row_count FROM anatomy_orders GROUP BY ALL;
-- Fewer, larger files. DESCRIBE HISTORY shows a new version with operation OPTIMIZE.
```

## Exercise 3: read an old version

The update and the inserts changed the table, but the old files are still there. Prove it.

```sql todo
-- TODO: count the rows of anatomy_orders as it was at version 0
```

```sql solution
SELECT count(*) AS rows_at_v0 FROM anatomy_orders VERSION AS OF 0;   -- 1000

-- Clean up the demo table when you are done
-- DROP TABLE anatomy_orders;
```

## ⚠️ Common mistakes

- ❌ "An `UPDATE` edits the Parquet file." Files are immutable. The update writes new files and logs a `remove` for the old ones.
- ❌ "Deleted rows are gone from storage." They stay on disk until `VACUUM` removes files older than the retention period.
- ❌ "The folder contents are the table." The folder also holds files of **older versions**. Only the log knows the current set.
- ✅ Read Delta tables through the table name or `delta.` path, never with a plain Parquet reader over the folder.
- ✅ Use `DESCRIBE HISTORY` and `DESCRIBE DETAIL` instead of browsing storage.

## 🧭 Cheat sheet

| I want to know… | Use |
|---|---|
| Where the table lives, how many files, total size | `DESCRIBE DETAIL t` |
| Which commits happened, who ran them, what they changed | `DESCRIBE HISTORY t` |
| Which file a row is in | `SELECT _metadata.file_name FROM t` |
| The table as of an older commit | `SELECT * FROM t VERSION AS OF 3` |
| Merge small files | `OPTIMIZE t` |
| Delete files no version needs any more | `VACUUM t` |
