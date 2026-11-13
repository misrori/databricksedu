---
title: Time travel, RESTORE and VACUUM
summary: Query any recent version of a Delta table, undo a bad write with RESTORE or a targeted MERGE, and understand exactly what VACUUM deletes and how it limits time travel.
icon: ⏪
level: Beginner
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, Time travel, RESTORE, VACUUM]
---
# Time travel, RESTORE and VACUUM

> Because Delta never edits files and keeps every commit in its log, an older version of a table is still on disk. You can query it, compare it, or go back to it, until `VACUUM` deletes the files it needs.

**The one idea to remember:** time travel works as long as the old **files** are there. `RESTORE` adds a new version that looks like an old one; `VACUUM` is what finally takes the past away.

## 🕰️ Every commit is a version

```viz timeline
{"title": "The life of tt_orders",
 "items": [
  {"label": "v0", "title": "CREATE TABLE AS SELECT", "color": "navy", "note": "1,000 orders. The first data files and the schema."},
  {"label": "v1", "title": "UPDATE (by mistake)", "color": "red", "note": "Someone sets `discount = 0.9` on every OPEN order instead of one. New files hold the changed rows; the old files are **removed in the log** but stay on disk."},
  {"label": "v2", "title": "DELETE TEST orders", "color": "amber", "note": "A correct change. More files are removed in the log, still on disk."},
  {"label": "v3", "title": "RESTORE TO VERSION AS OF 0", "color": "green", "note": "A **new** commit whose file list equals version 0. Versions 1 and 2 stay in the history and can still be queried."},
  {"label": "+8 days", "title": "VACUUM", "color": "gray", "note": "Files removed more than 7 days ago are deleted. Versions that need them can no longer be read, even though their history rows remain."}
 ]}
```

`DESCRIBE HISTORY t` lists the versions: number, timestamp, user, operation, parameters and metrics.

## 🔎 Query an old version

```sql
SELECT * FROM orders VERSION AS OF 3;
SELECT * FROM orders TIMESTAMP AS OF '2026-11-01 08:00:00';  -- latest version at or before that time
SELECT * FROM orders@v3;                                       -- short form of VERSION AS OF 3

-- Which rows of version 3 are no longer in the table?
SELECT * FROM orders VERSION AS OF 3 EXCEPT SELECT * FROM orders;
```

In Python: `spark.read.option("versionAsOf", 3).table("orders")`.

- **Audit**: what did the table contain when the report ran?
- **Reproduce** a report or a model training set exactly.
- **Repair** a bad write by comparing before and after.

## ⏪ RESTORE: forward, not back

`RESTORE TABLE orders TO VERSION AS OF 0` does not delete versions. It writes a new commit that removes today's files and re-adds the old ones.

```viz table
{"title": "tt_orders through a bad UPDATE and a RESTORE",
 "columns": ["order_id", "status", "discount"],
 "rows": [[101, "OPEN", 0.0], [102, "COMPLETED", 0.1], [103, "OPEN", 0.25], [104, "TEST", 0.0]],
 "steps": [
  {"label": "v0", "note": "Four of the orders, as created."},
  {"label": "v1: bad UPDATE", "note": "`UPDATE … SET discount = 0.9 WHERE status = 'OPEN'` hit every open order.", "upd": {"0": {"discount": 0.9}, "2": {"discount": 0.9}}, "hl": [0, 2]},
  {"label": "v2: DELETE", "note": "The TEST order is removed. This change was correct.", "del": [3]},
  {"label": "v3: RESTORE to v0", "note": "The discounts are back, **and so is the TEST order**: RESTORE brings back the whole table state, good changes included.",
   "upd": {"0": {"discount": 0.0}, "2": {"discount": 0.25}}, "hide": [3], "add": [[104, "TEST", 0.0]], "hl": [0, 2, 4]},
  {"label": "History", "note": "`DESCRIBE HISTORY` now shows v0 to v3. You could even restore to v2 later. To undo only the bad update, use a `MERGE` from the old version instead (Exercise 1)."}
 ]}
```

## 🧹 What VACUUM deletes

`VACUUM` deletes files in the table folder that the current version does not use, once they are older than the retention threshold (7 days by default).

```viz files
{"title": "tt_orders/  (step through)",
 "steps": [
  {"label": "v0: CREATE", "note": "One data file holds the 1,000 rows.",
   "add": [{"path": "part-a.snappy.parquet", "tag": "v0"}, {"path": "_delta_log/00000000000000000000.json", "tag": "v0 · add a"}]},
  {"label": "v1: UPDATE", "note": "The file with the changed rows is rewritten. `part-a` is a tombstone: out of the table, still on disk.",
   "add": [{"path": "part-b.snappy.parquet", "tag": "v1"}, {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · remove a, add b"}], "remove": ["part-a.snappy.parquet"]},
  {"label": "v2: DELETE", "note": "Again a rewrite. Now two old files are kept only for time travel.",
   "add": [{"path": "part-c.snappy.parquet", "tag": "v2"}, {"path": "_delta_log/00000000000000000002.json", "tag": "v2 · remove b, add c"}], "remove": ["part-b.snappy.parquet"]},
  {"label": "VACUUM today", "note": "Nothing is deleted: both tombstones are younger than 7 days. `VACUUM … DRY RUN` would list no files.",
   "tag": {"part-a.snappy.parquet": "removed today, kept", "part-b.snappy.parquet": "removed today, kept"}},
  {"label": "VACUUM after 8 days", "note": "`part-a` and `part-b` are deleted. v2 is fine, but `VERSION AS OF 0` or `1` now fails: the log still lists the files, they are just gone.",
   "delete": ["part-a.snappy.parquet", "part-b.snappy.parquet"]}
 ]}
```

`VACUUM` never touches `_delta_log`. Commit files are cleaned up separately, after `delta.logRetentionDuration` (30 days).

## ⏱️ The retention threshold

| Command or property | Effect |
|---|---|
| `VACUUM t` | Deletes unused files older than `delta.deletedFileRetentionDuration` (default 7 days) |
| `VACUUM t DRY RUN` | Lists what would be deleted, deletes nothing |
| `VACUUM t RETAIN 720 HOURS` | Uses a longer threshold for this run (30 days) |
| `delta.deletedFileRetentionDuration` | Table property that sets the default threshold |

Why `RETAIN 0 HOURS` is dangerous: a running query, a lagging stream or a concurrent writer may still need the files of a recent version. Deleting them makes those jobs fail and ends time travel at once. Databricks refuses a retention under 7 days unless a safety check is turned off. On managed tables, predictive optimization runs `VACUUM` for you.

## 🛟 UNDROP and clones

Time travel needs the table to exist. For a dropped table, and for keeping a version for good, use these.

```sql
DROP TABLE orders;
SHOW TABLES DROPPED;     -- what can still be recovered in this schema
UNDROP TABLE orders;     -- managed tables, within 7 days: data and history come back

CREATE OR REPLACE TABLE orders_v3 DEEP CLONE orders VERSION AS OF 3;      -- own copy of the files
CREATE OR REPLACE TABLE orders_dev SHALLOW CLONE orders VERSION AS OF 3;  -- metadata only
```

- A **deep clone** copies the data files. It survives any `VACUUM` of the source: good for audits.
- A **shallow clone** points at the source's files. It is instant and cheap, but depends on them.

## 🧪 Try it: break it and fix it

```dataset retail
```

```sql run
-- v0: create, v1: a bad update, v2: a good delete
DROP TABLE IF EXISTS tt_orders;
CREATE TABLE tt_orders AS SELECT * FROM fact_orders WHERE order_id <= 1000;
UPDATE tt_orders SET discount = 0.9 WHERE status = 'OPEN';
DELETE FROM tt_orders WHERE status = 'TEST';
DESCRIBE HISTORY tt_orders;
```

```sql run
-- Compare versions, and count the rows the bad update changed (v1 EXCEPT v0)
SELECT 'v0' AS version, count(*) AS orders, round(avg(discount), 4) AS avg_discount FROM tt_orders VERSION AS OF 0
UNION ALL SELECT 'v1', count(*), round(avg(discount), 4) FROM tt_orders@v1
UNION ALL SELECT 'now', count(*), round(avg(discount), 4) FROM tt_orders
UNION ALL SELECT 'changed by v1', count(*), NULL
          FROM (SELECT * FROM tt_orders VERSION AS OF 1 EXCEPT SELECT * FROM tt_orders VERSION AS OF 0);
```

```sql run
-- Go back to v0 with a new commit, then read the history again
RESTORE TABLE tt_orders TO VERSION AS OF 0;
DESCRIBE HISTORY tt_orders;
```

```sql run
-- What would VACUUM delete right now? (nothing is deleted by a dry run)
VACUUM tt_orders DRY RUN;
```

> The dry run returns no files: every removed file is younger than 7 days. Do not shorten the retention to "see it work"; that is exactly the mistake that breaks running jobs.

## Exercise 1: undo only the bad change

`RESTORE` also brought back the TEST orders. Repair a fresh table so the bad discount is undone **but the delete stays**. **Predict** the version number of your fix before you run it.

```sql todo
-- TODO 1: drop and create tt_ex_orders (order_id <= 1000)      -> v0
-- TODO 2: set discount = 0.9 for OPEN orders                    -> v1 (the mistake)
-- TODO 3: delete the TEST orders                                -> v2 (correct)
-- TODO 4: MERGE the old discounts back from VERSION AS OF 0, then check nothing else differs
```

```sql solution
DROP TABLE IF EXISTS tt_ex_orders;
CREATE TABLE tt_ex_orders AS SELECT * FROM fact_orders WHERE order_id <= 1000;
UPDATE tt_ex_orders SET discount = 0.9 WHERE status = 'OPEN';
DELETE FROM tt_ex_orders WHERE status = 'TEST';

MERGE INTO tt_ex_orders t
USING (SELECT order_id, discount FROM tt_ex_orders VERSION AS OF 0) s
ON t.order_id = s.order_id
WHEN MATCHED AND t.discount <> s.discount THEN UPDATE SET discount = s.discount;   -- v3

-- 0 rows: the table equals v0 without the TEST orders
SELECT * FROM tt_ex_orders VERSION AS OF 0 WHERE status <> 'TEST'
EXCEPT SELECT * FROM tt_ex_orders;
```

## Exercise 2: keep evidence that survives VACUUM

An auditor wants the table exactly as it was **before** a change, kept for a year. Time travel will not last that long. **Predict** whether a deep clone of version 0 still works after `VACUUM` removes the source's old files.

```sql todo
-- TODO 1: drop and create tt_audit (order_id <= 1000), then cancel all OPEN orders
-- TODO 2: deep clone tt_audit as of version 0 into tt_audit_v0
-- TODO 3: compare the OPEN order counts of tt_audit, tt_audit VERSION AS OF 0 and tt_audit_v0
-- TODO 4: dry-run a VACUUM of tt_audit and look at the clone's history
```

```sql solution
DROP TABLE IF EXISTS tt_audit;
CREATE TABLE tt_audit AS SELECT * FROM fact_orders WHERE order_id <= 1000;
UPDATE tt_audit SET status = 'CANCELLED' WHERE status = 'OPEN';

CREATE OR REPLACE TABLE tt_audit_v0 DEEP CLONE tt_audit VERSION AS OF 0;
VACUUM tt_audit DRY RUN;
DESCRIBE HISTORY tt_audit_v0;   -- its own history, starting with a CLONE commit

SELECT 'now' AS source, count_if(status = 'OPEN') AS open_orders FROM tt_audit
UNION ALL SELECT 'time travel v0', count_if(status = 'OPEN') FROM tt_audit VERSION AS OF 0
UNION ALL SELECT 'deep clone', count_if(status = 'OPEN') FROM tt_audit_v0;
-- Yes: the deep clone has its own copy of the files, so VACUUM on tt_audit cannot affect it.

-- Clean up when you are done
-- DROP TABLE tt_orders; DROP TABLE tt_ex_orders; DROP TABLE tt_audit; DROP TABLE tt_audit_v0;
```

## ⚠️ Common mistakes

- ❌ "RESTORE rewinds the table and deletes later versions." It adds a new version; the later ones stay in the history.
- ❌ "Time travel is a backup." It lasts only as long as the retention period. Use a deep clone for long-term copies.
- ❌ `VACUUM t RETAIN 0 HOURS` to save storage. It breaks running queries and streams and ends time travel.
- ✅ Run `VACUUM … DRY RUN` before a manual `VACUUM` on an unfamiliar table.
- ✅ Raise `delta.deletedFileRetentionDuration` **and** `delta.logRetentionDuration` together if you need longer history.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See all versions | `DESCRIBE HISTORY t` |
| Read an old version | `VERSION AS OF 5`, `TIMESTAMP AS OF '…'`, `t@v5` |
| Go back entirely | `RESTORE TABLE t TO VERSION AS OF 5` |
| Undo one change only | `MERGE INTO t USING (SELECT … FROM t VERSION AS OF 5) …` |
| Preview a cleanup | `VACUUM t DRY RUN` |
| Recover a dropped table | `SHOW TABLES DROPPED;` `UNDROP TABLE t;` |
