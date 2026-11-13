---
title: Change Data Feed
summary: Turn on the Change Data Feed, see which change rows each INSERT, UPDATE and DELETE emits and where they are stored, and use them to update downstream tables incrementally.
icon: 📰
level: Intermediate
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, Change Data Feed, CDC, Incremental processing]
---
# Change Data Feed

> The transaction log tells you which **files** changed in each version. Downstream tables usually need to know which **rows** changed. The Change Data Feed (CDF) records exactly that.

**The one idea to remember:** with CDF on, every commit also produces **row-level change records** (insert, update before and after, delete), tagged with the commit version. Consumers read only the changes since the version they last processed.

## 💡 Rows, not files

A plain read of a Delta table gives you the current state. To find out what changed since yesterday you would have to compare two full versions. CDF keeps the answer for you.

```sql
ALTER TABLE silver_orders SET TBLPROPERTIES (delta.enableChangeDataFeed = true);
-- or: CREATE TABLE ... TBLPROPERTIES (delta.enableChangeDataFeed = true)
```

Each change row has the table columns plus three metadata columns:

| Column | Meaning |
|---|---|
| `_change_type` | `insert`, `update_preimage`, `update_postimage` or `delete` |
| `_commit_version` | The table version that made the change |
| `_commit_timestamp` | When that version was committed |

CDF records changes **from the version that enabled it** onwards. Older history cannot be recovered.

## 🎬 Three operations on a table

Follow `orders` through three commits. The next slide shows the change rows the same commits emit.

```viz table
{"title": "orders  (current state)",
 "columns": ["order_id", "status", "quantity"],
 "rows": [[1, "PENDING", 2], [2, "PENDING", 1]],
 "steps": [
  {"label": "v1: INSERT order 3", "note": "A new row appears.", "add": [[3, "PENDING", 4]], "hl": [2]},
  {"label": "v2: UPDATE order 1", "note": "The status of order 1 changes. The table only shows the new value; the old one is gone from the current state.", "upd": {"0": {"status": "SHIPPED"}}, "hl": [0]},
  {"label": "v3: DELETE order 2", "note": "Order 2 leaves the table. A plain read cannot tell you it ever existed.", "del": [1]}
 ]}
```

## 📰 The change rows those commits emit

```viz table
{"title": "table_changes('orders', 1)",
 "columns": ["order_id", "status", "_change_type", "_commit_version"],
 "rows": [],
 "steps": [
  {"label": "v1: INSERT", "note": "One `insert` row with the new values.", "add": [[3, "PENDING", "insert", 1]], "hl": [0]},
  {"label": "v2: UPDATE", "note": "An update emits **two** rows: the row before (`update_preimage`) and after (`update_postimage`). You can see both the old and the new status.", "add": [[1, "PENDING", "update_preimage", 2], [1, "SHIPPED", "update_postimage", 2]], "hl": [1, 2]},
  {"label": "v3: DELETE", "note": "A `delete` row with the values the row had when it was deleted.", "add": [[2, "PENDING", "delete", 3]], "hl": [3]},
  {"label": "Use it", "note": "To apply these changes downstream, drop the preimages and keep the newest row per key. A `delete` row means: remove the key."}
 ]}
```

## 🗂️ Where the change rows are stored

Some changes can be read straight from the log. Others are written into a `_change_data/` folder in the table directory, referenced by `cdc` actions in the commit.

```viz files
{"title": "orders/  (CDF enabled)",
 "steps": [
  {"label": "v1: INSERT", "note": "Every row of the new file is an insert. Delta derives the change rows from the `add` action. **No extra file.**",
   "add": [{"path": "part-00001-b2e8.snappy.parquet", "tag": "1 row"},
           {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · add"}]},
  {"label": "v2: UPDATE", "note": "An update cannot be derived from file actions alone, so Delta writes the pre and post images into `_change_data/` and logs a `cdc` action next to the normal `add` and `remove`.",
   "add": [{"path": "part-00002-c7d9.snappy.parquet", "tag": "rewritten data"},
           {"path": "_change_data/cdc-00000-4f1a.c000.snappy.parquet", "tag": "2 change rows"},
           {"path": "_delta_log/00000000000000000002.json", "tag": "v2 · remove, add, cdc"}]},
  {"label": "v3: DELETE a whole file", "note": "When a commit drops whole files, every row in them is a delete. Again Delta derives the change rows from the `remove` action.",
   "add": [{"path": "_delta_log/00000000000000000003.json", "tag": "v3 · remove"}],
   "remove": ["part-00001-b2e8.snappy.parquet"]},
  {"label": "VACUUM (after retention)", "note": "Change files are cleaned up like data files. Once vacuumed, the changes of those versions can no longer be read.",
   "delete": ["_change_data/cdc-00000-4f1a.c000.snappy.parquet"]}
 ]}
```

Change files are never part of a normal read. They exist only for change queries.

## 🔎 Reading the feed

In SQL, `table_changes` takes a start and an optional end, as versions or timestamps.

```sql
SELECT * FROM table_changes('silver_orders', 5);        -- versions 5 to latest
SELECT * FROM table_changes('silver_orders', 5, 9);     -- versions 5 to 9
```

In PySpark, set `readChangeFeed`, for a batch read or a stream:

```python
changes = (spark.read.option("readChangeFeed", "true")
           .option("startingVersion", 5).table("silver_orders"))

stream = (spark.readStream.option("readChangeFeed", "true")
          .table("silver_orders"))   # the checkpoint remembers the last version read
```

## 🔁 Incremental downstream processing

A plain stream from a Delta table only handles appends; an `UPDATE` or `DELETE` in the source breaks it. Reading the change feed passes updates and deletes on.

```viz flow
{"nodes": [
  {"icon": "🥈", "title": "silver_orders", "sub": "CDF enabled", "color": "silver"},
  {"icon": "📰", "title": "Change feed", "sub": "readChangeFeed", "color": "blue", "items": ["since the last version read"]},
  {"icon": "🧹", "title": "Prepare", "sub": "per micro-batch", "color": "amber", "items": ["drop update_preimage", "newest row per key"]},
  {"icon": "🔀", "title": "MERGE", "sub": "into gold", "color": "purple", "items": ["delete → DELETE", "else → upsert"]},
  {"icon": "🥇", "title": "gold_orders", "sub": "always in sync", "color": "gold"}
 ],
 "edges": ["commits", "change rows", "one row per key", "apply"],
 "steps": [
  {"label": "Read", "focus": [0, 1], "note": "The consumer asks only for versions it has not seen. A streaming checkpoint, or a stored version number for batch, remembers where it stopped."},
  {"label": "Prepare", "focus": [2], "note": "Preimages are useful for audit, not for applying changes. A key changed twice in the range must be reduced to its newest row, ordered by `_commit_version`."},
  {"label": "Apply", "focus": [3, 4], "note": "A `MERGE` deletes keys whose newest change is `delete` and upserts the rest. Work is proportional to the **changes**, not the table size."}
 ]}
```

Other uses: an **audit** trail of every change, and **replication** of a table to another system.

## ⚖️ CDF is not CDC

| | Change Data Capture (CDC) | Change Data Feed (CDF) |
|---|---|---|
| Direction | **Input**: changes coming from a source system | **Output**: changes made to a Delta table |
| Produced by | The source database or a tool (Debezium, Lakeflow Connect) | Delta itself, per commit |
| You use it to | Apply changes to a bronze or silver table | Propagate changes further downstream |

Retention: change files follow `VACUUM`, and change queries also need the log entries of those versions. A consumer that falls behind the retention period must be rebuilt from a full read.

## 🧪 Try it: read the changes of a table

```dataset retail
```

```sql run
-- A table with CDF on from version 0, then three changes
DROP TABLE IF EXISTS cdf_orders;
CREATE TABLE cdf_orders TBLPROPERTIES (delta.enableChangeDataFeed = true)
AS SELECT * FROM fact_orders WHERE order_id <= 100;                        -- v0

INSERT INTO cdf_orders SELECT * FROM fact_orders WHERE order_id BETWEEN 101 AND 105;   -- v1
UPDATE cdf_orders SET status = 'SHIPPED', quantity = quantity + 1 WHERE order_id IN (101, 102);   -- v2
DELETE FROM cdf_orders WHERE order_id = 103;                                -- v3

DESCRIBE HISTORY cdf_orders;
```

```sql run
-- Every change since version 1, and a summary per version and type
SELECT order_id, status, quantity, _change_type, _commit_version
FROM table_changes('cdf_orders', 1)
ORDER BY _commit_version, order_id, _change_type;

SELECT _commit_version, _change_type, count(*) AS change_rows
FROM table_changes('cdf_orders', 1)
GROUP BY ALL ORDER BY ALL;
```

```sql run
-- Incremental sync: a copy as of version 1, then apply only the changes after it
CREATE OR REPLACE TABLE cdf_orders_copy AS SELECT * FROM cdf_orders VERSION AS OF 1;

MERGE INTO cdf_orders_copy AS t
USING (
  SELECT * FROM table_changes('cdf_orders', 2)
  WHERE _change_type != 'update_preimage'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY _commit_version DESC) = 1
) AS c
ON t.order_id = c.order_id
WHEN MATCHED AND c._change_type = 'delete' THEN DELETE
WHEN MATCHED THEN UPDATE SET t.status = c.status, t.quantity = c.quantity
WHEN NOT MATCHED AND c._change_type != 'delete' THEN INSERT
  (order_id, order_date, customer_id, product_id, quantity, discount, status)
  VALUES (c.order_id, c.order_date, c.customer_id, c.product_id, c.quantity, c.discount, c.status);

-- Zero rows means the copy now equals the source
SELECT * FROM cdf_orders EXCEPT SELECT * FROM cdf_orders_copy;
```

## Exercise 1: predict the change rows of a MERGE

Create your own CDF table from orders 1 to 50. Then run a `MERGE` that updates orders 1 to 3 and inserts orders 51 and 52. **Predict** how many rows of each `_change_type` the merge version emits, then check.

```sql todo
-- TODO 1: create cdf_ex_orders (orders 1 to 50) with delta.enableChangeDataFeed = true
-- TODO 2: MERGE orders 1-3 and 51-52 from fact_orders: matched -> set quantity = 99, not matched -> insert
-- TODO 3: count the change rows of version 1 by _change_type
```

```sql solution
DROP TABLE IF EXISTS cdf_ex_orders;
CREATE TABLE cdf_ex_orders TBLPROPERTIES (delta.enableChangeDataFeed = true)
AS SELECT * FROM fact_orders WHERE order_id <= 50;

MERGE INTO cdf_ex_orders AS t
USING (SELECT * FROM fact_orders WHERE order_id IN (1, 2, 3, 51, 52)) AS s
ON t.order_id = s.order_id
WHEN MATCHED THEN UPDATE SET t.quantity = 99
WHEN NOT MATCHED THEN INSERT *;

SELECT _change_type, count(*) AS change_rows
FROM table_changes('cdf_ex_orders', 1, 1)
GROUP BY ALL;
-- insert 2, update_preimage 3, update_postimage 3
```

## Exercise 2: changes from before CDF was enabled

Create a table **without** CDF, insert a batch, then enable CDF and update a row. Predict which change query works: from version 0 or from the version that enabled CDF.

```python todo
# TODO 1: create cdf_ex_late from orders 1 to 50 (no CDF), insert orders 51 to 60
# TODO 2: enable delta.enableChangeDataFeed, then update order 1
# TODO 3: read the feed with spark.read.option("readChangeFeed", "true") from version 0 (in try/except)
# TODO 4: read it again from the enabling version (see DESCRIBE HISTORY)
```

```python solution
spark.sql("DROP TABLE IF EXISTS cdf_ex_late")
spark.sql("CREATE TABLE cdf_ex_late AS SELECT * FROM fact_orders WHERE order_id <= 50")        # v0
spark.sql("INSERT INTO cdf_ex_late SELECT * FROM fact_orders WHERE order_id BETWEEN 51 AND 60")  # v1
spark.sql("ALTER TABLE cdf_ex_late SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")      # v2
spark.sql("UPDATE cdf_ex_late SET quantity = 99 WHERE order_id = 1")                            # v3

def changes(start):
    return (spark.read.option("readChangeFeed", "true")
            .option("startingVersion", start).table("cdf_ex_late"))

try:
    changes(0).count()
except Exception as e:
    print("from v0 fails:", str(e)[:200])   # no change data was recorded for versions 0 and 1

display(changes(2).select("order_id", "quantity", "_change_type", "_commit_version"))

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE cdf_orders"); spark.sql("DROP TABLE cdf_orders_copy")
# spark.sql("DROP TABLE cdf_ex_orders"); spark.sql("DROP TABLE cdf_ex_late")
```

## ⚠️ Common mistakes

- ❌ Expecting CDF to show changes from before it was enabled. Turn it on when the table is created.
- ❌ Applying `update_preimage` rows downstream. They hold the **old** values. Filter them out for upserts.
- ❌ Merging a range of changes without deduplication. A key changed twice gives two rows and the merge fails.
- ❌ Confusing CDF with CDC. CDC feeds a Delta table; CDF is what a Delta table emits.
- ✅ Store the last processed version (or use a streaming checkpoint) so each run reads only new changes.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Turn on the feed | `ALTER TABLE t SET TBLPROPERTIES (delta.enableChangeDataFeed = true)` |
| Changes since version N in SQL | `SELECT * FROM table_changes('t', N)` |
| Changes between two versions | `table_changes('t', 5, 9)` |
| Changes in PySpark | `spark.read.option("readChangeFeed", "true").option("startingVersion", N).table("t")` |
| Changes as a stream | `spark.readStream.option("readChangeFeed", "true").table("t")` |
| Only what to apply | `WHERE _change_type != 'update_preimage'` + newest row per key |
