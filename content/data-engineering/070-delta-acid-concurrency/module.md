---
title: ACID and concurrency in Delta Lake
summary: How Delta Lake gets atomic, isolated commits on object storage with no locks. Learn optimistic concurrency, the two isolation levels, which operations conflict, and how to avoid conflict exceptions.
icon: ⚛️
level: Intermediate
minutes: 11
group: Delta Lake internals
tags: [Delta Lake, ACID, Concurrency, Isolation levels]
---
# ACID and concurrency in Delta Lake

> Object storage has no locks and no transactions, yet many jobs write to the same Delta table while dashboards read it. Delta makes this safe with one trick: **a commit is the creation of a single new log file, and only one writer can create it**.

**The one idea to remember:** writers never lock the table. Each one writes its files, then tries to claim the next version number; if someone else got there first, it checks for a real conflict and either retries or fails.

## ⚛️ ACID, in terms of files

| Letter | Promise | How Delta keeps it |
|---|---|---|
| **Atomicity** | All of a write or none of it | Data files are invisible until one log file `N+1.json` is created |
| **Consistency** | Every version is valid | Schema, `NOT NULL` and `CHECK` constraints are checked before the commit |
| **Isolation** | Concurrent work does not interfere | Readers use a fixed snapshot; writers validate conflicts before committing |
| **Durability** | A commit survives failures | The log file is in replicated cloud storage once it is written |

Everything below is about the **I**: what happens when two operations overlap.

## ✍️ One file makes a commit

Watch a successful writer and a crashed one. Only the log decides what is part of the table.

```viz files
{"title": "orders/",
 "steps": [
  {"label": "Table at v5", "note": "One live data file, listed by the commits up to version 5.",
   "add": [{"path": "part-0001.snappy.parquet", "tag": "live"}, {"path": "_delta_log/00000000000000000005.json", "tag": "v5 · current"}]},
  {"label": "Writer A writes data", "note": "Two new Parquet files appear in the folder, but **no commit lists them**. Every reader ignores them.",
   "add": [{"path": "part-0002.snappy.parquet", "tag": "not in the log yet"}, {"path": "part-0003.snappy.parquet", "tag": "not in the log yet"}]},
  {"label": "Writer A commits", "note": "A creates `…06.json` **only if it does not exist yet** (put-if-absent). That single step makes both files visible at once.",
   "add": [{"path": "_delta_log/00000000000000000006.json", "tag": "v6 · add ×2"}],
   "tag": {"part-0002.snappy.parquet": "live", "part-0003.snappy.parquet": "live"}},
  {"label": "Writer B crashes", "note": "B wrote a file and died before committing. The table is unaffected: no reader ever sees half of B's write.",
   "add": [{"path": "part-0004.snappy.parquet", "tag": "orphan, never committed"}]},
  {"label": "VACUUM, much later", "note": "`VACUUM` deletes files that no version references once they are older than the retention period, orphans included.",
   "delete": ["part-0004.snappy.parquet"]}
 ]}
```

Put-if-absent comes from the cloud store, or from a Databricks commit service where the store cannot guarantee it alone.

## 🔄 Optimistic concurrency: two writers race

Delta assumes conflicts are rare. Each writer: **read** a snapshot, **write** files, **try** to create the next log file, and on a clash **check** whether the winner touched what it read.

```viz timeline
{"title": "Writers A (MERGE) and B (DELETE) on the same table",
 "items": [
  {"label": "t1", "title": "Both read v5", "color": "navy", "note": "A starts a `MERGE` of October orders, B a `DELETE` of TEST orders. Both see version 5. Nobody takes a lock."},
  {"label": "t2", "title": "Both write files", "color": "blue", "note": "Each writes new Parquet files privately. Nothing is visible to readers yet."},
  {"label": "t3", "title": "B commits v6", "color": "green", "note": "B is faster and creates `…06.json`. B is done."},
  {"label": "t4", "title": "A cannot create v6", "color": "amber", "note": "A's put-if-absent of `…06.json` fails because it already exists. A does **not** give up yet."},
  {"label": "t5", "title": "A checks v6", "color": "purple", "note": "A reads B's commit: which files did it add or remove? Did any of them belong to the data A read?"},
  {"label": "t6", "title": "No overlap: A commits v7", "color": "green", "note": "B only removed files A never read. A's result is still valid, so A commits as version 7 automatically."},
  {"label": "t6'", "title": "Overlap: A fails", "color": "red", "note": "If B removed a file that A read, A's work is based on stale data. A throws `ConcurrentDeleteReadException` and the job must retry."}
 ]}
```

## 👀 Readers see one snapshot

A query picks a version when it starts and reads exactly the files of that version, even while writers commit. Readers never block writers, and writers never block readers.

```viz table
{"title": "What a long query started at v5 returns",
 "columns": ["order_id", "status", "from version"],
 "rows": [[1, "COMPLETED", "v5"], [2, "OPEN", "v5"], [3, "TEST", "v5"]],
 "steps": [
  {"label": "Query starts at v5", "note": "The reader builds the snapshot of version 5: a fixed list of files.", "hl": [0, 1, 2]},
  {"label": "Writer commits v6", "note": "`UPDATE … SET status = 'CANCELLED' WHERE order_id = 2` commits. The reader still reads the v5 files, so nothing changes for it.", "hl": [1]},
  {"label": "Writer commits v7", "note": "`DELETE … WHERE status = 'TEST'` commits. The old file is only **removed in the log**, it is still on disk, so the reader finishes safely.", "hl": [2]},
  {"label": "Next query: v7", "note": "A new query builds a new snapshot and sees both changes. No query ever sees v6 half-applied.",
   "upd": {"1": {"status": "CANCELLED", "from version": "v6"}}, "del": [2]}
 ]}
```

## ⚔️ Which operations conflict

Conflicts are checked against what each operation **read**. Appends read nothing, so they are the easiest.

```viz compare
{"items": [
 {"icon": "✅", "title": "Never conflict", "color": "green",
  "points": ["`INSERT` + `INSERT` (blind appends)", "Any reader + any writer", "`INSERT` + `OPTIMIZE`"]},
 {"icon": "⚖️", "title": "Depends on isolation level", "color": "amber",
  "points": ["`INSERT` + `UPDATE` / `DELETE` / `MERGE`", "No conflict under **WriteSerializable** (default)", "Can conflict under **Serializable**"]},
 {"icon": "❌", "title": "Can conflict", "color": "red",
  "points": ["`UPDATE` / `DELETE` / `MERGE` + `UPDATE` / `DELETE` / `MERGE` on the same files or partitions", "`OPTIMIZE` + `UPDATE` / `DELETE` / `MERGE` on the same files", "`OPTIMIZE` + `OPTIMIZE`"],
  "foot": "Different partitions, or different rows with row-level concurrency: no conflict"}
]}
```

## 🧱 Isolation levels

| Level | What it guarantees | When |
|---|---|---|
| **WriteSerializable** | Writes are serializable. An `INSERT` that commits during an `UPDATE` is treated as if it came after it | Default for every table |
| **Serializable** | Reads and writes are serializable. The same case is a conflict | Opt-in per table |
| **Snapshot isolation** | A query sees one version from start to end | Always, for every reader |

Example: an `UPDATE` reads v5, and an `INSERT` commits v6 with rows that match the update's filter. Under WriteSerializable the `UPDATE` commits as v7 and leaves the new rows alone. Under Serializable it fails. Switch with `ALTER TABLE t SET TBLPROPERTIES ('delta.isolationLevel' = 'Serializable')`.

## 🚨 Conflict exceptions and how to avoid them

| Exception | What happened | Typical fix |
|---|---|---|
| `ConcurrentAppendException` | Another commit added files in data you read | Narrow the predicate: `WHERE` or `ON` with the partition or clustering column |
| `ConcurrentDeleteReadException` | Another commit removed a file you read | Disjoint predicates, or row-level concurrency |
| `ConcurrentDeleteDeleteException` | Both commits removed the same file | Do not run two compactions or rewrites of the same data at once |
| `MetadataChangedException` | The schema or table properties changed | Run `ALTER TABLE` and schema changes outside busy write windows |
| `ConcurrentTransactionException` | Two streams with the same checkpoint wrote | One stream per checkpoint location |

**Row-level concurrency** helps most: on tables with deletion vectors that are liquid clustered or unpartitioned, Databricks checks conflicts per row, so two `UPDATE`s of different rows in the same file both succeed.

## 🧪 Try it: snapshots and the history

```dataset retail
```

You cannot reproduce a real race reliably in one notebook, but you can see snapshots stay fixed and read what each commit recorded.

```sql run
-- A demo table for this module
CREATE OR REPLACE TABLE acid_orders AS
SELECT * FROM fact_orders WHERE order_id <= 1000;
```

```python run
# Pin a version, let a "writer" commit twice, then read the pinned version again
v = spark.sql("DESCRIBE HISTORY acid_orders LIMIT 1").first()["version"]
q = "SELECT count(*) AS orders, count_if(status = 'CANCELLED') AS cancelled FROM acid_orders"

print(f"v{v} before:", spark.sql(f"{q} VERSION AS OF {v}").first())
spark.sql("INSERT INTO acid_orders SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 1200")
spark.sql("UPDATE acid_orders SET status = 'CANCELLED' WHERE order_id <= 10")
print(f"v{v} after: ", spark.sql(f"{q} VERSION AS OF {v}").first())
print("latest:    ", spark.sql(q).first())
```

```python run
# What each commit recorded about concurrency
display(spark.sql("DESCRIBE HISTORY acid_orders")
             .select("version", "operation", "readVersion", "isolationLevel", "isBlindAppend"))
```

> `readVersion` is the snapshot a commit was based on, and `isBlindAppend = true` marks the `INSERT`, which read nothing and so could never conflict. A long-running query pinned to an old version keeps working the same way as `VERSION AS OF` here.

## Exercise 1: a write is all or nothing

Add a `CHECK` constraint, then try to insert 300 rows where exactly **one** breaks it. **Predict** how many of the 300 rows end up in the table and whether a new version appears.

```python todo
# TODO 1: create acid_ex_orders from fact_orders (order_id <= 1000)
# TODO 2: add CONSTRAINT acid_qty_positive CHECK (quantity > 0)
# TODO 3: insert orders 1001 to 1300 with quantity set to -1 for order 1300; catch the error
# TODO 4: compare the latest version and the row count before and after
```

```python solution
spark.sql("CREATE OR REPLACE TABLE acid_ex_orders AS SELECT * FROM fact_orders WHERE order_id <= 1000")
spark.sql("ALTER TABLE acid_ex_orders DROP CONSTRAINT IF EXISTS acid_qty_positive")
spark.sql("ALTER TABLE acid_ex_orders ADD CONSTRAINT acid_qty_positive CHECK (quantity > 0)")

def state():
    version = spark.sql("DESCRIBE HISTORY acid_ex_orders LIMIT 1").first()["version"]
    return version, spark.table("acid_ex_orders").count()

print("before:", state())
try:
    spark.sql("""INSERT INTO acid_ex_orders
                 SELECT order_id, order_date, customer_id, product_id,
                        IF(order_id = 1300, -1, quantity), discount, status
                 FROM fact_orders WHERE order_id BETWEEN 1001 AND 1300""")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:120])
print("after: ", state())   # same version, same 1000 rows: none of the 299 valid rows were committed
```

## Exercise 2: switch to Serializable

Set the table to `Serializable`, make one change, and read the history. **Predict** the `isolationLevel` of each commit, then explain in one sentence what a concurrent `INSERT` would now do to your `UPDATE`.

```sql todo
-- TODO 1: create acid_ser_orders from fact_orders (order_id <= 1000)
-- TODO 2: set the table property delta.isolationLevel to Serializable
-- TODO 3: cancel the OPEN orders, then show the history
```

```sql solution
CREATE OR REPLACE TABLE acid_ser_orders AS SELECT * FROM fact_orders WHERE order_id <= 1000;
ALTER TABLE acid_ser_orders SET TBLPROPERTIES ('delta.isolationLevel' = 'Serializable');
UPDATE acid_ser_orders SET status = 'CANCELLED' WHERE status = 'OPEN';
DESCRIBE HISTORY acid_ser_orders;
-- The UPDATE commit shows Serializable. A concurrent INSERT of matching rows would now
-- make the UPDATE fail with a conflict instead of silently leaving the new rows unchanged.

-- Clean up when you are done
-- DROP TABLE acid_orders; DROP TABLE acid_ex_orders; DROP TABLE acid_ser_orders;
```

## ⚠️ Common mistakes

- ❌ "Delta locks the table during a write." There are no locks; conflicts are detected at commit time.
- ❌ "Two jobs appending to one table will conflict." Blind appends never conflict with each other.
- ❌ A `MERGE` with `ON t.id = s.id` only, while another job merges other dates. Add the date or clustering column to the condition so the two touch disjoint files.
- ✅ Retry jobs that hit a conflict exception: the retry reads the new version and usually succeeds.
- ✅ Enable deletion vectors and liquid clustering for tables with many concurrent row-level writers.

## 🧭 Cheat sheet

| Question | Answer |
|---|---|
| What makes a commit atomic? | Creating `_delta_log/<N+1>.json` with put-if-absent |
| Default isolation level | `WriteSerializable` |
| Stricter option | `delta.isolationLevel = 'Serializable'` |
| What readers get | Snapshot isolation: one version per query |
| Never conflicts | Blind appends, and readers with anything |
| See concurrency details | `DESCRIBE HISTORY t`: `readVersion`, `isolationLevel`, `isBlindAppend` |
