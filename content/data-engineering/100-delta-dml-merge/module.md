---
title: UPDATE, DELETE and MERGE
summary: Learn how row-level changes become file operations in Delta, how to write a correct MERGE upsert, why duplicate source keys break it, and when a selective overwrite is the better tool.
icon: 🔀
level: Beginner
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, MERGE, DML, Upsert]
---
# UPDATE, DELETE and MERGE

> Delta lets you change single rows in a data lake with plain SQL. Under the hood every change is still "write new files, log which files changed", so the speed of a change depends on **how many files it has to touch**.

**The one idea to remember:** a DML statement first **finds the files** that may hold matching rows, then **rewrites or marks** them, then **commits** one atomic set of `add` and `remove` actions. Narrow the search and you make the whole statement cheaper.

## 💡 From a SQL statement to file operations

`UPDATE orders SET status = 'SHIPPED' WHERE order_id = 7` runs in three steps.

| Step | What happens |
|---|---|
| 1. Find candidate files | Per-file min/max **statistics** in the log rule out files that cannot contain `order_id = 7`. Only the rest are scanned. |
| 2. Rewrite or mark | Files that really hold a match are rewritten with the change (copy-on-write), or the old rows are marked with a deletion vector. |
| 3. Commit | One log entry: `remove` for replaced files, `add` for new ones. Readers see all of it or none of it. |

`DELETE` works the same way without new values. If the condition covers whole files (for example `DELETE FROM t` with no `WHERE`), the files are simply removed and nothing is rewritten.

## 🔀 Anatomy of MERGE INTO

`MERGE` combines insert, update and delete in one atomic statement. The clauses are checked top to bottom, and the **first** one whose condition is true wins for a row.

```viz code
title: an upsert with deletes
lang: sql
---
MERGE INTO customers AS t
USING changes AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.operation = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET t.city = s.city, t.tier = s.tier
WHEN NOT MATCHED AND s.operation != 'DELETE' THEN
  INSERT (customer_id, city, tier) VALUES (s.customer_id, s.city, s.tier)
WHEN NOT MATCHED BY SOURCE THEN DELETE
---
1 | target | The Delta table that changes.
2 | source | Any table, view or query. It is only read.
3 | ON | How a source row finds its target row. Usually the business key.
4 | matched + condition | A key exists on both sides and the extra condition holds: delete the target row.
5 | matched | Every other match: update. Clause order matters, so the delete is checked first.
6-7 | not matched | The key is only in the source: insert. Delete events for unknown keys are ignored.
8 | not matched by source | The key is only in the target. Optional, and dangerous: with a partial source it deletes everything else.
```

## 🎬 A MERGE, row by row

The target holds customers 1 to 4. The source has changes for 2, 3 and 5.

```viz table
{"title": "customers (target)",
 "columns": ["customer_id", "city", "tier", "what happens"],
 "rows": [[1, "Paris", "Silver", ""], [2, "Rome", "Bronze", ""], [3, "Oslo", "Gold", ""], [4, "Lima", "Silver", ""]],
 "steps": [
  {"label": "Before", "note": "Source rows: `(2, Milan, Gold, UPDATE)`, `(3, null, null, DELETE)`, `(5, Kyiv, Bronze, INSERT)`."},
  {"label": "Matched: update", "note": "Key 2 is on both sides and the source operation is not DELETE, so the second clause updates the row.", "upd": {"1": {"city": "Milan", "tier": "Gold", "what happens": "updated"}}, "hl": [1]},
  {"label": "Matched: delete", "note": "Key 3 matches and the first clause applies, so the row is deleted.", "upd": {"2": {"what happens": "deleted"}}, "del": [2]},
  {"label": "Not matched: insert", "note": "Key 5 has no target row, so it is inserted.", "add": [[5, "Kyiv", "Bronze", "inserted"]], "hl": [4]},
  {"label": "Untouched", "note": "Keys 1 and 4 had no source row. Without `WHEN NOT MATCHED BY SOURCE` they stay as they are. With it, they would be deleted.", "hl": [0, 3]}
 ]}
```

## ⚙️ How MERGE runs: two phases

```viz flow
{"nodes": [
  {"icon": "📨", "title": "Source", "sub": "the changes", "color": "blue"},
  {"icon": "🔎", "title": "Phase 1: find", "sub": "inner join on ON", "color": "amber", "items": ["which target files have a match?"]},
  {"icon": "✍️", "title": "Phase 2: rewrite", "sub": "join again, apply clauses", "color": "purple", "items": ["only the touched files", "plus new files for inserts"]},
  {"icon": "📜", "title": "Commit", "sub": "one log entry", "color": "navy", "items": ["remove touched files", "add rewritten files"]}
 ],
 "edges": ["scan", "touched file list", "add / remove"],
 "steps": [
  {"label": "Phase 1", "focus": [0, 1], "note": "The source is joined with the target to learn **which files** contain matching keys. File statistics and any extra filter in `ON` skip files that cannot match."},
  {"label": "Phase 2", "focus": [1, 2], "note": "Only the touched files are read again and rewritten with the clauses applied. Rows that did not change are copied along. This is where the cost is."},
  {"label": "Commit", "focus": [2, 3], "note": "One atomic commit. `DESCRIBE HISTORY` reports `numTargetRowsUpdated`, `numTargetRowsInserted`, `numTargetRowsDeleted` and how many rows were copied."}
 ]}
```

Make phase 1 small: add the partition or clustering column to `ON` (`AND t.order_date >= '2026-10-01'`) when the changes only cover recent data. Fewer candidate files means less to rewrite and fewer conflicts with other writers.

## 🧯 "Multiple source rows matched"

A target row may be changed by **one** source row only. If two source rows have the same key, Delta cannot know which one should win, so the whole `MERGE` fails (`DELTA_MULTIPLE_SOURCE_ROW_MATCHING_TARGET_ROW_IN_MERGE`) and nothing is written.

Change feeds often contain several events per key. Keep only the latest one **before** the merge:

```sql
SELECT * FROM customers_changes
QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) = 1
```

Order by the **sequence number** from the source system, not by arrival time: events can arrive out of order.

## ♻️ Upserts and idempotent loads

- **Upsert** = `WHEN MATCHED THEN UPDATE` + `WHEN NOT MATCHED THEN INSERT`. Use it when a batch can contain both new and changed keys.
- `UPDATE SET *` and `INSERT *` copy every target column from the source column with the same name. They need the source to have all target columns.
- A merge on a key is **idempotent**: running the same batch twice gives the same table. A plain `INSERT` run twice gives duplicates.
- Add a guard such as `WHEN MATCHED AND s.changed_at > t.updated_at` so a re-run, or an older event, does not overwrite newer data.

## 🔁 Replacing a slice instead of merging

When a batch brings the **complete** data for a range (a day, a region), replacing that range is simpler than merging row by row.

```sql
INSERT OVERWRITE orders SELECT * FROM orders_rebuilt;   -- replaces the whole table

INSERT INTO orders REPLACE WHERE order_date = '2026-10-01'   -- replaces one day only
SELECT * FROM orders_staging WHERE order_date = '2026-10-01';
```

```viz compare
{"items": [
 {"icon": "➕", "title": "INSERT INTO", "sub": "append", "color": "green", "points": ["✅ Cheapest: only new files", "❌ Re-run adds duplicates", "Use for: immutable events"]},
 {"icon": "🔀", "title": "MERGE INTO", "sub": "upsert by key", "color": "blue", "points": ["✅ Idempotent, handles updates and deletes", "❌ Joins and rewrites touched files", "Use for: CDC, dimension updates"]},
 {"icon": "🔁", "title": "INSERT OVERWRITE / REPLACE WHERE", "sub": "replace a slice", "color": "amber", "points": ["✅ Idempotent, no join", "❌ The batch must contain the whole slice", "Use for: daily rebuilds, backfills"]}
]}
```

`REPLACE WHERE` checks that every new row matches the predicate and fails otherwise, so a wrong batch cannot leak into other days.

## 🧪 Try it: apply a change feed with MERGE

```dataset cdc
```

Start from the snapshot and look at the problem: many keys have several change events.

```sql run
-- Target table and a look at duplicate keys in the source
CREATE OR REPLACE TABLE merge_customers AS SELECT * FROM customers_snapshot;

SELECT count(*) AS events, count(DISTINCT customer_id) AS keys FROM customers_changes;
```

```python run
# A merge with the raw feed fails, and leaves the table unchanged
try:
    spark.sql("""
        MERGE INTO merge_customers t USING customers_changes s
        ON t.customer_id = s.customer_id
        WHEN MATCHED THEN UPDATE SET t.city = s.city""")
except Exception as e:
    print(str(e)[:400])
```

```sql run
-- Keep the latest event per key, then merge
CREATE OR REPLACE TEMP VIEW merge_latest AS
SELECT * FROM customers_changes
QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) = 1;

MERGE INTO merge_customers AS t
USING merge_latest AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.operation = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET
  t.customer_name = s.customer_name, t.email = s.email, t.city = s.city,
  t.tier = s.tier, t.updated_at = s.changed_at
WHEN NOT MATCHED AND s.operation != 'DELETE' THEN
  INSERT (customer_id, customer_name, email, city, tier, updated_at)
  VALUES (s.customer_id, s.customer_name, s.email, s.city, s.tier, s.changed_at);
```

```python run
# What the MERGE did, from the commit metrics
h = spark.sql("DESCRIBE HISTORY merge_customers")
m = h.operationMetrics
display(h.select("version", "operation",
                 m["numTargetRowsInserted"].alias("inserted"),
                 m["numTargetRowsUpdated"].alias("updated"),
                 m["numTargetRowsDeleted"].alias("deleted"),
                 m["numTargetRowsCopied"].alias("copied")))
```

## Exercise 1: run it twice

Build your own target, apply the deduplicated changes, then run the same `MERGE` again. **Predict** the inserted, updated and deleted counts of the second run first. Then add a guard so the second run changes nothing.

```sql todo
-- TODO 1: create merge_ex_customers from customers_snapshot
-- TODO 2: create a temp view with the latest event per customer_id
-- TODO 3: MERGE the view into merge_ex_customers (delete, update, insert), twice
-- TODO 4: compare the two MERGE results; then add a guard and run once more
```

```sql solution
CREATE OR REPLACE TABLE merge_ex_customers AS SELECT * FROM customers_snapshot;

CREATE OR REPLACE TEMP VIEW merge_ex_latest AS
SELECT * FROM customers_changes
QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) = 1;

-- Run this statement twice. The second run inserts 0 and deletes 0 (those keys are
-- already handled) but still "updates" every matched row with the same values.
MERGE INTO merge_ex_customers AS t USING merge_ex_latest AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.operation = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET t.customer_name = s.customer_name, t.email = s.email,
  t.city = s.city, t.tier = s.tier, t.updated_at = s.changed_at
WHEN NOT MATCHED AND s.operation != 'DELETE' THEN
  INSERT (customer_id, customer_name, email, city, tier, updated_at)
  VALUES (s.customer_id, s.customer_name, s.email, s.city, s.tier, s.changed_at);

-- With a guard on the update clause, a re-run touches nothing:
MERGE INTO merge_ex_customers AS t USING merge_ex_latest AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.operation = 'DELETE' THEN DELETE
WHEN MATCHED AND s.changed_at > t.updated_at THEN UPDATE SET t.customer_name = s.customer_name,
  t.email = s.email, t.city = s.city, t.tier = s.tier, t.updated_at = s.changed_at
WHEN NOT MATCHED AND s.operation != 'DELETE' THEN
  INSERT (customer_id, customer_name, email, city, tier, updated_at)
  VALUES (s.customer_id, s.customer_name, s.email, s.city, s.tier, s.changed_at);
```

## Exercise 2: replace a slice safely

Replace customers 1 to 50 with the snapshot rows, using `REPLACE WHERE`. Then predict what happens if the `SELECT` also returns customers 51 to 60.

```sql todo
-- TODO 1: INSERT INTO merge_ex_customers REPLACE WHERE customer_id <= 50 with the snapshot rows for those keys
-- TODO 2: write down what you expect, then try the same with a SELECT that returns customer_id <= 60
```

```sql solution
INSERT INTO merge_ex_customers REPLACE WHERE customer_id <= 50
SELECT * FROM customers_snapshot WHERE customer_id <= 50;

DESCRIBE HISTORY merge_ex_customers;   -- the newest commit shows the predicate in operationParameters

-- With "WHERE customer_id <= 60" in the SELECT the statement fails: customers 51 to 60
-- do not match the REPLACE WHERE predicate, so the write is rejected and nothing changes.

-- Clean up the demo tables when you are done
-- DROP TABLE merge_customers;
-- DROP TABLE merge_ex_customers;
```

## ⚠️ Common mistakes

- ❌ Merging a raw change feed. Duplicate keys make the `MERGE` fail. Deduplicate by key and sequence number first.
- ❌ Ordering events by arrival time. Late events then overwrite newer ones. Use the source sequence number.
- ❌ Adding `WHEN NOT MATCHED BY SOURCE THEN DELETE` to a merge whose source is only a partial batch. Every key not in the batch is deleted.
- ❌ Using `INSERT INTO` for a load that may be re-run. Use `MERGE` or `REPLACE WHERE` to stay idempotent.
- ✅ Put the partition or clustering column into `ON` when the changes cover a known range.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Change or remove rows by condition | `UPDATE t SET ... WHERE ...` / `DELETE FROM t WHERE ...` |
| Insert new keys, update existing ones | `MERGE INTO t USING s ON key WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT ...` |
| Delete target rows missing from a full source | `WHEN NOT MATCHED BY SOURCE THEN DELETE` |
| Keep one event per key | `QUALIFY ROW_NUMBER() OVER (PARTITION BY key ORDER BY seq DESC) = 1` |
| Replace one slice of a table | `INSERT INTO t REPLACE WHERE pred SELECT ...` |
| See what a merge did | `DESCRIBE HISTORY t`: `numTargetRowsInserted / Updated / Deleted` |
