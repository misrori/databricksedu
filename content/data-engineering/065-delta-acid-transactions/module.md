---
title: ACID transactions, letter by letter
summary: What atomicity, consistency, isolation and durability mean for a Delta table, with a tiny demo for each letter and what would go wrong on a plain Parquet folder without them.
icon: 🧾
level: Beginner
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, ACID, Transactions, Schema enforcement]
---
# ACID transactions, letter by letter

> A data lake is a folder of files. Many jobs write to it while dashboards read it, and jobs crash. ACID is the set of four promises that keeps such a table trustworthy, and Delta Lake gives them to every table through its transaction log.

**The one idea to remember:** a Delta write either becomes one new, valid, durable version of the table or nothing at all, and every reader sees exactly one version.

## ⚛️ Four promises

```viz compare
{"title": "ACID in one sentence each",
 "items": [
  {"icon": "🅰️", "title": "Atomicity", "sub": "all or nothing", "color": "blue",
   "points": ["A write is applied completely or not at all", "❌ Without it: half a batch is visible after a crash"]},
  {"icon": "🅲", "title": "Consistency", "sub": "only valid versions", "color": "green",
   "points": ["Every version follows the schema and the constraints", "❌ Without it: a bad file breaks every reader"]},
  {"icon": "🅸", "title": "Isolation", "sub": "no half-seen changes", "color": "purple",
   "points": ["A query sees one version, never a mix", "❌ Without it: totals that never existed"]},
  {"icon": "🅳", "title": "Durability", "sub": "committed means kept", "color": "amber",
   "points": ["Once a write returns, it survives a crash", "❌ Without it: success messages that lie"]}
 ]}
```

All four come from one mechanism: a write becomes visible only when its commit file `_delta_log/<N>.json` is created.

## 🅰️ Atomicity: all or nothing

A job inserts three new orders. It writes two data files and then the cluster dies before the third file and before the commit.

```viz table
{"title": "orders, as a reader sees it", "columns": ["order_id", "amount", "status"],
 "rows": [[1, 120, "COMPLETED"], [2, 45, "COMPLETED"]],
 "steps": [
  {"label": "Start", "note": "Two orders. A nightly job starts to append three more (ids 3, 4, 5)."},
  {"label": "Crash after 2 files", "note": "The files with orders 3 and 4 are in the folder. Order 5 and the commit were never written.",
   "add": [[3, 80, "NEW"], [4, 15, "NEW"]], "hl": [2, 3]},
  {"label": "❌ Plain Parquet folder", "note": "A reader lists the folder and sees orders 3 and 4: **two thirds of a batch**. The rerun adds 3 and 4 again, so they are duplicated.", "hl": [2, 3]},
  {"label": "✅ Delta table", "note": "No commit file lists the two new files, so readers ignore them. The table still has 2 orders, and the rerun is safe.", "hide": [2, 3]}
 ]}
```

The same rule makes one failing row reject a whole `INSERT`: nothing of the batch is committed.

## 🅲 Consistency: every version is valid

Delta checks the **schema** and the **constraints** (`NOT NULL`, `CHECK`) before it commits. A write that breaks them fails, and the table stays at its last valid version.

```viz table
{"title": "orders with CHECK (quantity > 0)", "columns": ["order_id", "quantity", "amount"],
 "rows": [[1, 2, 120.0], [2, 1, 45.0]],
 "steps": [
  {"label": "Start", "note": "The table has a rule: `quantity > 0`, and `amount` is a DOUBLE."},
  {"label": "A bad batch arrives", "note": "One row has quantity -5, another has the text `'n/a'` as amount.",
   "add": [[3, -5, 80.0], [4, 1, "n/a"]], "hl": [2, 3]},
  {"label": "❌ Plain Parquet folder", "note": "The files are written anyway. Revenue reports now include a negative quantity, and some readers fail on the text value **later, far from the cause**.", "hl": [2, 3]},
  {"label": "✅ Delta table", "note": "The write fails at once with a constraint or schema error. No version contains the bad rows.", "hide": [2, 3]}
 ]}
```

Schema evolution is still possible, but on purpose: `mergeSchema` or `ALTER TABLE … ADD COLUMNS`.

## 🅸 Isolation: one version per query

Isolation means concurrent work does not leak into each other. Here a report sums two balances while an `UPDATE` moves 100 from A to B.

```viz table
{"title": "accounts", "columns": ["account", "balance", "version"],
 "rows": [["A", 500, "v5"], ["B", 300, "v5"]],
 "steps": [
  {"label": "Report starts", "note": "The report reads row A first: 500. The true total is 800.", "hl": [0]},
  {"label": "UPDATE commits v6", "note": "One statement moves 100 from A to B in one commit.",
   "upd": {"0": {"balance": 400, "version": "v6"}, "1": {"balance": 400, "version": "v6"}}},
  {"label": "❌ Without isolation", "note": "The report now reads B **after** the update: 500 + 400 = **900**. A total that never existed.", "hl": [1]},
  {"label": "✅ Delta: snapshot", "note": "The report was pinned to v5, so it reads 500 + 300 = 800. The next query sees v6: 400 + 400 = 800.", "hl": [0, 1]}
 ]}
```

For writers, Delta uses optimistic concurrency: no locks, a conflict check at commit time. The module "ACID and concurrency in Delta Lake" shows the details.

## 🅳 Durability: committed means kept

When a Delta write returns success, its data files and its commit file are already in cloud object storage, which keeps several copies. No cluster memory or local disk is needed to keep it.

```viz timeline
{"title": "What survives a crash",
 "items": [
  {"label": "10:00", "title": "INSERT returns", "color": "green", "note": "The commit `…07.json` is in the bucket. The job prints success."},
  {"label": "10:01", "title": "Cluster dies", "color": "red", "note": "Memory, local disks and caches of the cluster are gone. **Nothing of the table was only there.**"},
  {"label": "10:05", "title": "New cluster", "color": "blue", "note": "It reads the log from storage: version 7 is there, with every row."},
  {"label": "Next week", "title": "Time travel", "color": "purple", "note": "Version 7 can still be read with `VERSION AS OF 7`, until VACUUM removes its files."},
  {"label": "❌", "title": "Without it", "color": "gray", "note": "A system that says *done* while data is still in memory or on a local disk loses it in exactly this crash."}
 ]}
```

## 🧪 Try it: atomicity and consistency

```dataset retail
```

```python run
# A small table with a rule: quantity must be positive
spark.sql("""CREATE OR REPLACE TABLE acidx_orders AS
             SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id <= 100""")
spark.sql("ALTER TABLE acidx_orders DROP CONSTRAINT IF EXISTS acidx_qty")
spark.sql("ALTER TABLE acidx_orders ADD CONSTRAINT acidx_qty CHECK (quantity > 0)")

def state():
    v = spark.sql("DESCRIBE HISTORY acidx_orders LIMIT 1").first()["version"]
    return f"version {v}, {spark.table('acidx_orders').count()} rows"
print("start:", state())
```

```python run
# Atomicity: 50 rows, one of them breaks the rule
try:
    spark.sql("""INSERT INTO acidx_orders
                 SELECT order_id, order_date, IF(order_id = 150, -1, quantity), status
                 FROM fact_orders WHERE order_id BETWEEN 101 AND 150""")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:110])
print("after:", state())   # same version, same 100 rows: none of the 49 good rows got in
```

```python run
# Consistency: a column with the wrong type is rejected too
from pyspark.sql import functions as F
bad = spark.table("acidx_orders").limit(3).withColumn("quantity", F.lit("n/a"))
try:
    bad.write.mode("append").saveAsTable("acidx_orders")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:110])
print("after:", state())
```

## 🧪 Try it: isolation, durability, and life without Delta

```python run
# Isolation: a pinned version does not move while others write
v = spark.sql("DESCRIBE HISTORY acidx_orders LIMIT 1").first()["version"]
spark.sql("UPDATE acidx_orders SET quantity = quantity * 10 WHERE order_id <= 50")
q = "SELECT sum(quantity) AS total_quantity FROM acidx_orders"
print(f"pinned v{v}:", spark.sql(q + f" VERSION AS OF {v}").first()[0])
print("latest:    ", spark.sql(q).first()[0])
# Durability: every commit is recorded in storage, with who, when and what
display(spark.sql("DESCRIBE HISTORY acidx_orders").select("version", "timestamp", "operation", "operationMetrics"))
```

```python run
# Without Delta: a plain Parquet folder accepts a write that breaks its readers
base = data.volume(CATALOG, SCHEMA) + "/acidx_plain_orders"
spark.table("acidx_orders").write.mode("overwrite").parquet(base)
spark.table("acidx_orders").limit(3).withColumn("quantity", F.lit("n/a")).write.mode("append").parquet(base)
print("the bad append succeeded: nothing checked it")
try:
    print("rows:", spark.read.parquet(base).count(), "| sum:", spark.read.parquet(base).selectExpr("sum(quantity)").first()[0])
except Exception as e:
    print("the reader fails later instead:", str(e).splitlines()[0][:110])
```

> Depending on which file Spark takes the schema from, the plain read fails or returns wrong values. Either way the problem shows up at the reader, not at the write that caused it.

## Exercise 1: predict the version number

Starting from `acidx_orders`, you will run four statements: a valid `INSERT` of orders 151 to 160, an `INSERT` of orders 161 to 170 where one row has quantity 0, an `UPDATE` that sets status to `'CHECKED'` for order 1, and a `DELETE` of order 2. **Predict** how many new versions appear and the final row count, then run it.

```python todo
# TODO 1: note the current version and row count
# TODO 2: run the four statements; wrap the second one in try/except
# TODO 3: compare the version and the row count with your prediction
```

```python solution
before = spark.sql("DESCRIBE HISTORY acidx_orders LIMIT 1").first()["version"], spark.table("acidx_orders").count()
spark.sql("INSERT INTO acidx_orders SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id BETWEEN 151 AND 160")
try:
    spark.sql("""INSERT INTO acidx_orders SELECT order_id, order_date, IF(order_id = 165, 0, quantity), status
                 FROM fact_orders WHERE order_id BETWEEN 161 AND 170""")
except Exception as e:
    print("rejected:", str(e).splitlines()[0][:100])
spark.sql("UPDATE acidx_orders SET status = 'CHECKED' WHERE order_id = 1")
spark.sql("DELETE FROM acidx_orders WHERE order_id = 2")
after = spark.sql("DESCRIBE HISTORY acidx_orders LIMIT 1").first()["version"], spark.table("acidx_orders").count()
print(before, "->", after)   # 3 new versions (the failed INSERT made none), rows: +10 then -1
```

## Exercise 2: undo a mistake

Someone runs `UPDATE acidx_orders SET status = 'CANCELLED'` without a `WHERE`. **Explain** which ACID letter lets you go back, then restore the table to the version just before the mistake and check the statuses.

```sql todo
-- TODO 1: run the bad UPDATE
-- TODO 2: find the version before it in DESCRIBE HISTORY
-- TODO 3: RESTORE TABLE acidx_orders TO VERSION AS OF <that version>, then count rows per status
```

```sql solution
UPDATE acidx_orders SET status = 'CANCELLED';
DESCRIBE HISTORY acidx_orders;          -- the UPDATE is the latest version; use the one before it
-- RESTORE TABLE acidx_orders TO VERSION AS OF <latest - 1>;
-- SELECT status, count(*) FROM acidx_orders GROUP BY status;
-- Durability (with atomic, versioned commits) keeps the old version and its files until VACUUM.
-- RESTORE itself is a new commit, so the mistake stays visible in the history.

-- Clean up when you are done
-- DROP TABLE acidx_orders;
```

## ⚠️ Common mistakes

- ❌ "ACID means Delta locks the table." It does not: readers use snapshots and writers check conflicts at commit time.
- ❌ "A failed job may leave half its rows behind." Uncommitted files are ignored and later removed by `VACUUM`.
- ❌ Writing Parquet files into a Delta table folder by hand. Files that no commit lists are not part of the table.
- ❌ Expecting a transaction across two tables. A Delta commit covers one table; design multi-table jobs to be rerunnable.
- ✅ Add `CHECK` and `NOT NULL` constraints for the rules your consumers rely on: Delta enforces them on every write.

## 🧭 Cheat sheet

| Letter | Promise | Delta mechanism |
|---|---|---|
| Atomicity | All or nothing | One commit file per write, created with put-if-absent |
| Consistency | Only valid versions | Schema enforcement, `NOT NULL`, `CHECK` before commit |
| Isolation | One version per query | Snapshot reads, optimistic concurrency for writers |
| Durability | Committed means kept | Data and log in replicated object storage, versions kept until `VACUUM` |
