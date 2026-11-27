---
title: Flows and the multi-flow pattern
summary: See what a flow really is in a declarative pipeline, why its name is its checkpoint, and how several explicit flows feed one streaming table so that a new source backfills only itself.
icon: 🔀
level: Intermediate
minutes: 11
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Flows, Append flows, Checkpoints]
---
# Flows and the multi-flow pattern

> Behind every streaming table in Lakeflow Spark Declarative Pipelines (formerly Delta Live Tables) there is a **flow**: the query that writes into it. Most of the time you never see it. Once several sources must land in one table, the flow becomes the thing you design.

**The one idea to remember:** a flow is **a query plus a target**, and it remembers its progress in a checkpoint that is **named after the flow**. Give each source its own flow, and never rename a flow that has already run.

## 💡 A flow is a query plus a target

The **query** says what to read and how to transform it. The **target** is the streaming table or materialized view where the rows land. Between the two sits the flow's **checkpoint**, its bookmark in the source.

```viz flow
{"title": "One flow, two ways to run it",
 "nodes": [{"icon": "📂", "title": "Source", "sub": "files, Kafka, a Delta table", "color": "gray"},
           {"icon": "🔀", "title": "Flow", "sub": "query + checkpoint", "color": "blue"},
           {"icon": "🌊", "title": "Target", "sub": "streaming table", "color": "teal"}],
 "edges": ["read", "append"],
 "steps": [
  {"label": "Incremental update", "focus": [0, 1], "note": "The flow reads only what came **after** its checkpoint, then moves the checkpoint forward. This is what a normal pipeline update does."},
  {"label": "Append", "focus": [1, 2], "note": "The new rows are appended to the target. Old rows are not touched."},
  {"label": "Full refresh", "focus": [0, 1, 2], "note": "The checkpoint is thrown away and the target is emptied. The flow re-reads **everything** the source still has. Expensive, and only safe if the source kept all its data."}
 ]}
```

## 🔖 The flow name is the checkpoint

The pipeline stores one checkpoint per flow and finds it **by the flow's name**. Two flows, `web_flow` and `shop_flow`, write into one table `flw_orders_all`. Step through three updates (a simplified view: the pipeline manages where these folders live).

```viz files
{"title": "checkpoints of flw_orders_all (simplified)",
 "steps": [
  {"label": "Update 1", "note": "Each flow starts from nothing and gets its own folder. Web reads 300 rows, shop reads 200. The table has **500** rows.",
   "add": [{"path": "web_flow/offsets/0", "tag": "read 300 rows"}, {"path": "web_flow/commits/0", "tag": "done"},
           {"path": "shop_flow/offsets/0", "tag": "read 200 rows"}, {"path": "shop_flow/commits/0", "tag": "done"}]},
  {"label": "Update 2: 100 new web orders", "note": "Web continues from its bookmark and reads only the 100 new rows. Shop has nothing new and writes nothing. **600** rows.",
   "add": [{"path": "web_flow/offsets/1", "tag": "read 100 rows"}, {"path": "web_flow/commits/1", "tag": "done"}]},
  {"label": "Rename web_flow", "note": "Someone renames `web_flow` to `web_orders_flow`. The pipeline finds no checkpoint with that name, so the flow starts over and appends all **400** web rows again: **1,000** rows, 400 of them duplicates.",
   "remove": ["web_flow/offsets/0", "web_flow/commits/0", "web_flow/offsets/1", "web_flow/commits/1"],
   "add": [{"path": "web_orders_flow/offsets/0", "tag": "read 400 rows again"}, {"path": "web_orders_flow/commits/0", "tag": "done"}]}
 ]}
```

Flows also **progress and fail independently**: a broken source stops its own flow, not the others.

## 🧩 Default flow and explicit flow

`CREATE ... AS SELECT` creates a table and its **default flow** in one statement; the flow takes the table's name. An **explicit flow** is defined separately and points at an existing target by name.

```viz code
title: pipeline/orders.sql
lang: sql
---
-- Default (implicit) flow: one statement, flow name = table name
CREATE OR REFRESH STREAMING TABLE flw_web_copy
AS SELECT * FROM STREAM(flw_web_src);

-- Explicit flows: first the empty target, then the flows
CREATE OR REFRESH STREAMING TABLE flw_orders_all;

CREATE FLOW web_flow
AS INSERT INTO flw_orders_all BY NAME
SELECT *, 'web' AS channel FROM STREAM(flw_web_src);

CREATE FLOW shop_flow
AS INSERT INTO flw_orders_all BY NAME
SELECT *, 'shop' AS channel FROM STREAM(flw_shop_src);
---
2-3 | default flow | Table and flow in one step. You never name the flow, so you cannot rename it by accident.
6 | target only | No `AS SELECT`: the table has no default flow. Its schema comes from the flows (or from a column list you write).
8-10 | explicit flow | `CREATE FLOW <name> AS INSERT INTO <target> BY NAME` appends the query's rows. `BY NAME` matches columns by name, not position.
12-14 | a second flow | Same target, different source, its **own** checkpoint `shop_flow`.
```

## 🐍 Python flows and one-time backfills

In Python the target is `dp.create_streaming_table`, and each flow is a function with `@dp.append_flow`. The flow name is the function name unless you pass `name=`.

```python
from pyspark import pipelines as dp

dp.create_streaming_table("flw_orders_all")

@dp.append_flow(target="flw_orders_all", name="web_flow")
def web_orders():                      # renaming the function is safe: name= is fixed
    return spark.readStream.table("flw_web_src")

@dp.append_flow(target="flw_orders_all", once=True)
def archive_backfill():                # runs one time, not on every update
    return spark.read.table("flw_orders_archive")
```

The second flow is a **backfill**: a batch read of old data that runs once. In SQL it is `CREATE FLOW archive_backfill AS INSERT INTO ONCE flw_orders_all BY NAME SELECT ...`. A full refresh runs it again.

## ⚖️ Many flows or one UNION?

You could also write one streaming table whose query is `... FROM STREAM(a) UNION ALL ... FROM STREAM(b)`. It works, but it is **one** flow with **one** checkpoint for all sources.

```viz compare
{"title": "Three sources into one table",
 "items": [
  {"icon": "🧶", "title": "One UNION query", "sub": "one flow, one checkpoint", "color": "red",
   "points": ["❌ adding a source changes the query: full refresh of **all** sources", "❌ one failing source stops all of them", "❌ metrics only for the whole query", "✅ fine for a fixed, small set of sources"],
   "foot": "the default flow of one table"},
  {"icon": "🔀", "title": "Multi-flow", "sub": "one flow per source", "color": "green",
   "points": ["✅ adding a source = adding a flow: only it backfills", "✅ a failing source stops only its flow", "✅ rows and metrics per flow in the event log", "✅ sources can be dropped or added any time"],
   "foot": "recommended for consolidating sources"}
 ]}
```

## ➕ Adding a source later

The web and shop flows have run. Now partner orders (150 rows) must join the same table. Watch what each approach reads at the next update.

```viz table
{"title": "Rows read at the update after the change", "columns": ["approach", "flow", "rows read", "why"],
 "rows": [["Multi-flow", "web_flow", 300, "first update"],
          ["Multi-flow", "shop_flow", 200, "first update"],
          ["UNION", "orders_union", 500, "first update"]],
 "steps": [
  {"label": "Before", "note": "Both designs ingested the same 500 rows in their first update."},
  {"label": "Add partners: multi-flow", "note": "A new `partner_flow` gets a new checkpoint and backfills its 150 rows. Web and shop have nothing new and read 0.", "add": [["Multi-flow", "partner_flow", 150, "new checkpoint, backfills itself"]], "upd": {"0": {"rows read": 0, "why": "nothing new"}, "1": {"rows read": 0, "why": "nothing new"}}, "hl": [0, 1, 3]},
  {"label": "Add partners: UNION", "note": "The query changed, so the old checkpoint no longer fits. A full refresh re-reads every source: 300 + 200 + 150.", "upd": {"2": {"rows read": 650, "why": "full refresh of all sources"}}, "hl": [2]}
 ]}
```

If the web or shop files have expired in the meantime, the UNION table also **loses** them.

## ✅ Expectations and clustering live on the target

A flow cannot carry expectations. Put the rules on the **target table**: they then apply to every flow that writes into it. Liquid clustering is set on the target too, with `CLUSTER BY`.

```sql
CREATE OR REFRESH STREAMING TABLE flw_orders_all (
  CONSTRAINT valid_qty    EXPECT (quantity > 0)          ON VIOLATION DROP ROW,
  CONSTRAINT has_order_id EXPECT (order_id IS NOT NULL)  ON VIOLATION FAIL UPDATE
)
CLUSTER BY AUTO                     -- or CLUSTER BY (order_date, customer_id)
COMMENT 'Orders from every channel, one flow per source';
```

- `FAIL UPDATE` fails the **flow** that wrote the bad row. In a triggered pipeline the other flows still finish.
- `CLUSTER BY AUTO` lets Databricks pick the keys from the queries it sees. How clustering works is in the Delta optimization module.

## 🧪 Try it: two flows, one table

```dataset retail
```

> A pipeline cannot run from a notebook cell, so the pipeline code above is display-only. Plain Structured Streaming shows the same mechanism: each "flow" is a stream with `availableNow`, and its checkpoint folder is **named after the flow**, just like in a pipeline.

```python run
# Set up: two sources, one target, and a run_flow helper (clean start)
import os, shutil

base = data.volume(CATALOG, SCHEMA) + "/flw_checkpoints"
shutil.rmtree(base, ignore_errors=True)
spark.sql("CREATE OR REPLACE TABLE flw_web_src  AS SELECT * FROM fact_orders WHERE order_id <= 300")
spark.sql("CREATE OR REPLACE TABLE flw_shop_src AS SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 1200")
spark.sql("CREATE OR REPLACE TABLE flw_orders_all (order_id BIGINT, quantity INT, flow STRING)")

def run_flow(name, source):
    """One flow: read source incrementally, append to flw_orders_all, checkpoint folder = flow name."""
    before = spark.table("flw_orders_all").count()
    (spark.readStream.table(source).selectExpr("order_id", "quantity", f"'{name}' AS flow")
        .writeStream.option("checkpointLocation", f"{base}/{name}")
        .trigger(availableNow=True).toTable("flw_orders_all").awaitTermination())
    print(f"{name:16} read {spark.table('flw_orders_all').count() - before} rows")

run_flow("web_flow", "flw_web_src")     # 300
run_flow("shop_flow", "flw_shop_src")   # 200
```

```python run
# 100 new web orders arrive, then the next "update" runs both flows
spark.sql("INSERT INTO flw_web_src SELECT * FROM fact_orders WHERE order_id BETWEEN 301 AND 400")
run_flow("web_flow", "flw_web_src")     # only the 100 new rows
run_flow("shop_flow", "flw_shop_src")   # nothing new
```

```python run
# Rename the web flow: a new name means a new, empty checkpoint
run_flow("web_orders_flow", "flw_web_src")
print("checkpoint folders:", sorted(os.listdir(base)))
display(spark.sql("SELECT count(*) AS total_rows, count(DISTINCT order_id) AS distinct_orders FROM flw_orders_all"))
```

> The renamed flow read all 400 web rows again: 1,000 rows, but only 600 distinct orders. The old `web_flow` folder is still there, abandoned. In a pipeline the same happens when you rename a `CREATE FLOW` or an `append_flow` function without `name=`.

## Exercise 1: add a source without touching the others

The cell builds web (300 rows) and shop (200 rows) sources and runs their flows once. Partner orders (150 rows) are new. Predict first: at the next update, how many rows does **each** of the three flows read, and how big is the table afterwards?

```python todo
# Given: sources, target and the helper (clean start)
import shutil
base = data.volume(CATALOG, SCHEMA) + "/flw_ex1"
shutil.rmtree(base, ignore_errors=True)
spark.sql("CREATE OR REPLACE TABLE flw_ex_web     AS SELECT * FROM fact_orders WHERE order_id <= 300")
spark.sql("CREATE OR REPLACE TABLE flw_ex_shop    AS SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 1200")
spark.sql("CREATE OR REPLACE TABLE flw_ex_partner AS SELECT * FROM fact_orders WHERE order_id BETWEEN 2001 AND 2150")
spark.sql("CREATE OR REPLACE TABLE flw_ex_all (order_id BIGINT, quantity INT, flow STRING)")

def run_flow(name, source):
    before = spark.table("flw_ex_all").count()
    (spark.readStream.table(source).selectExpr("order_id", "quantity", f"'{name}' AS flow")
        .writeStream.option("checkpointLocation", f"{base}/{name}")
        .trigger(availableNow=True).toTable("flw_ex_all").awaitTermination())
    print(f"{name:14} read {spark.table('flw_ex_all').count() - before} rows")

run_flow("web_flow", "flw_ex_web"); run_flow("shop_flow", "flw_ex_shop")

# TODO 1: write your prediction: rows read by web_flow, shop_flow and partner_flow, and the total
# TODO 2: run the next update: all three flows (partner_flow reads flw_ex_partner)
# TODO 3: show the row count per flow in flw_ex_all
```

```python solution
# Prediction: web_flow 0, shop_flow 0, partner_flow 150; total 300 + 200 + 150 = 650
run_flow("web_flow", "flw_ex_web")
run_flow("shop_flow", "flw_ex_shop")
run_flow("partner_flow", "flw_ex_partner")

display(spark.sql("SELECT flow, count(*) AS row_count FROM flw_ex_all GROUP BY flow ORDER BY flow"))
# With one UNION query instead, adding partners would have needed a full refresh that re-reads all 650 rows.
```

## Exercise 2: which tool for which job?

Decide for each scenario. Use `"FLOW"` (add an explicit append flow), `"ONCE"` (a one-time backfill flow), `"TARGET"` (change the target table definition) or `"KEEP_NAME"` (do not change the flow name). The cell checks only that every answer is filled in.

```python todo
# TODO: replace each None with "FLOW", "ONCE", "TARGET" or "KEEP_NAME"
answers = {
    "a_a_fourth_region_starts_sending_orders_to_its_own_kafka_topic": None,
    "b_load_three_years_of_old_csv_exports_into_the_same_table_one_time": None,
    "c_reject_rows_with_negative_quantity_from_every_source": None,
    "d_a_colleague_wants_to_rename_web_flow_to_match_a_naming_standard": None,
}

assert all(v in ("FLOW", "ONCE", "TARGET", "KEEP_NAME") for v in answers.values()), "Fill in every answer"
print("All answered:", answers)
```

```python solution
answers = {
    "a_a_fourth_region_starts_sending_orders_to_its_own_kafka_topic": "FLOW",     # only the new flow backfills
    "b_load_three_years_of_old_csv_exports_into_the_same_table_one_time": "ONCE", # INSERT INTO ONCE / once=True
    "c_reject_rows_with_negative_quantity_from_every_source": "TARGET",           # expectations live on the table
    "d_a_colleague_wants_to_rename_web_flow_to_match_a_naming_standard": "KEEP_NAME",  # new name = new checkpoint = duplicates
}

assert answers["a_a_fourth_region_starts_sending_orders_to_its_own_kafka_topic"] == "FLOW"
assert answers["b_load_three_years_of_old_csv_exports_into_the_same_table_one_time"] == "ONCE"
assert answers["c_reject_rows_with_negative_quantity_from_every_source"] == "TARGET"
assert answers["d_a_colleague_wants_to_rename_web_flow_to_match_a_naming_standard"] == "KEEP_NAME"
print("All correct")

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS flw_ex_all"); spark.sql("DROP TABLE IF EXISTS flw_ex_web")
# spark.sql("DROP TABLE IF EXISTS flw_ex_shop"); spark.sql("DROP TABLE IF EXISTS flw_ex_partner")
# dbutils.fs.rm(data.volume(CATALOG, SCHEMA) + "/flw_ex1", True)
```

## ⚠️ Common mistakes

- ❌ Renaming a flow (or the Python function behind it) in a clean-up. The next update re-reads the whole source into an append target: duplicates.
- ❌ One `UNION ALL` query over many sources. Adding a source then means a full refresh of all of them.
- ❌ Putting `CONSTRAINT ... EXPECT` on a flow. Expectations belong to the target table and cover every flow.
- ❌ Full refresh of a multi-flow bronze table whose sources expire. Protect it with `pipelines.reset.allowed = false`.
- ✅ One explicit flow per source, with a stable name; pass `name=` in Python so the function can change freely.
- ✅ Old data goes in once with a `ONCE` backfill flow, new data keeps flowing through the normal flows.

## 🧭 Cheat sheet

| I want to… | SQL | Python |
|---|---|---|
| A table with its default flow | `CREATE OR REFRESH STREAMING TABLE t AS SELECT ... FROM STREAM(src)` | `@dp.table` returning a streaming DataFrame |
| An empty target for flows | `CREATE OR REFRESH STREAMING TABLE t;` | `dp.create_streaming_table("t")` |
| Add a source | `CREATE FLOW f AS INSERT INTO t BY NAME SELECT ... FROM STREAM(src)` | `@dp.append_flow(target="t", name="f")` |
| Load history one time | `CREATE FLOW f AS INSERT INTO ONCE t BY NAME SELECT ...` | `@dp.append_flow(target="t", once=True)` |
| Quality rules for all flows | `CONSTRAINT ... EXPECT` on `t` | `expect_all_or_drop={...}` in `create_streaming_table` |
| Clustered target | `CLUSTER BY AUTO` or `CLUSTER BY (cols)` on `t` | `cluster_by=[...]` in `create_streaming_table` |
