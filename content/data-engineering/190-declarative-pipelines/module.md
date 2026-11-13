---
title: Lakeflow Spark Declarative Pipelines
summary: Describe streaming tables, materialized views and views in one file, and let the pipeline work out the order, the incremental processing and the retries. Learn which dataset type to pick and what each update really processes.
icon: 🌊
level: Beginner
minutes: 12
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Streaming tables, Materialized views]
---
# Lakeflow Spark Declarative Pipelines

> In a pipeline you do not write the steps. You write **what each dataset should contain**, and the engine builds the dependency graph, decides what is new, and keeps the results up to date. It was formerly called Delta Live Tables (DLT).

**The one idea to remember:** a **streaming table** processes each source row **once** and never looks back, a **materialized view** is kept **correct** against the current sources. Choosing between them is choosing between "cheap and append-only" and "always right".

## 💡 Describe datasets, not steps

With plain notebooks and jobs you write the plan yourself: read, transform, write, in the right order, with your own checkpoints and retry logic. A declarative pipeline turns that around.

| Concern | Imperative job | Declarative pipeline |
|---|---|---|
| Order of steps | You chain tasks by hand | Derived from the table references |
| What is new since last run | Your checkpoints or watermark columns | Managed per streaming table |
| Retries after a failure | Your job settings | Built in (production mode) |
| Schema, tables, lineage | You create them | Created and tracked in Unity Catalog |

You still write SQL or PySpark. You just write it as **definitions**: `CREATE OR REFRESH ... AS SELECT ...`.

## 🧱 Three kinds of datasets

```viz compare
{"title": "What you can define in a pipeline",
 "items": [
  {"icon": "🌊", "title": "Streaming table", "sub": "CREATE OR REFRESH STREAMING TABLE", "color": "blue",
   "points": ["Reads its source with `STREAM(...)`", "Each new source row is processed **once**", "Old rows are never recomputed", "❌ misses later updates to rows it already read"],
   "foot": "Bronze ingestion, row-level silver"},
  {"icon": "🏆", "title": "Materialized view", "sub": "CREATE OR REFRESH MATERIALIZED VIEW", "color": "gold",
   "points": ["Batch read of its sources", "Result equals the query over the **current** data", "Refreshed incrementally when possible, else recomputed", "✅ reflects updates, deletes and late data"],
   "foot": "Gold aggregates, joins over changing tables"},
  {"icon": "🪟", "title": "Temporary view", "sub": "CREATE TEMPORARY VIEW", "color": "gray",
   "points": ["Not stored, not published", "Visible only inside the pipeline", "Good for shared intermediate logic", "Can carry expectations"],
   "foot": "Helpers, cleaning steps"}
 ]}
```

**How `STREAM(...)` decides:** `FROM STREAM(t)` is an incremental read that only sees rows added since the last update. A plain `FROM t` is a batch read of the whole table. In Python the same choice is `spark.readStream` versus `spark.read`.

## 📄 A pipeline in one SQL file

This is a complete pipeline source file. There is no "run this first" anywhere in it.

```viz code
title: pipeline/orders.sql
lang: sql
---
CREATE OR REFRESH STREAMING TABLE pl_orders_bronze AS
SELECT *, _metadata.file_name AS source_file
FROM STREAM read_files('/Volumes/<catalog>/<schema>/databricksedu_files/pl_landing/fact_orders',
  format => 'csv', header => true,
  schema => 'order_id BIGINT, order_date DATE, customer_id BIGINT, product_id BIGINT, quantity INT, discount DOUBLE, status STRING');

CREATE OR REFRESH STREAMING TABLE pl_orders_silver AS
SELECT order_id, order_date, customer_id, product_id, quantity, discount
FROM STREAM(pl_orders_bronze) WHERE status = 'COMPLETED';

CREATE OR REFRESH MATERIALIZED VIEW pl_revenue_by_category AS
SELECT p.category, count(*) AS orders, round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM pl_orders_silver o JOIN dim_product p ON o.product_id = p.product_id
GROUP BY p.category;
---
1-5 | bronze | `STREAM read_files(...)` is Auto Loader in SQL. Each update picks up only files it has not read yet. The explicit schema keeps the types stable.
2 | lineage column | `_metadata.file_name` records which file each row came from. Cheap and very useful when a file is bad.
7-9 | silver | `STREAM(pl_orders_bronze)` reads only the bronze rows added since the last update. This reference is also an **edge in the graph**: silver runs after bronze.
11-14 | gold | No `STREAM`: a batch read of silver joined with `dim_product`, a table outside the pipeline. The engine keeps this result equal to the query.
```

The pipeline parses all files first, finds every table name each query reads, and builds a graph from those references. Write the definitions in any order, or spread them over several files.

## 🔁 What each update processes

Step through two updates of the pipeline above. The second update starts after a second file has landed.

```viz flow
{"title": "Two triggered updates of the orders pipeline",
 "nodes": [{"icon": "📂", "title": "Landing folder", "sub": "CSV files in a volume", "color": "gray"},
           {"icon": "🥉", "title": "pl_orders_bronze", "sub": "streaming table", "color": "bronze"},
           {"icon": "🥈", "title": "pl_orders_silver", "sub": "streaming table", "color": "silver"},
           {"icon": "🥇", "title": "pl_revenue_by_category", "sub": "materialized view", "color": "gold"}],
 "edges": ["new files only", "new rows only", "whole silver table"],
 "steps": [
  {"label": "Update 1: bronze", "focus": [0, 1], "note": "`part_1.csv` is in the folder. Bronze reads its 20,000 rows and records the file in its checkpoint."},
  {"label": "Update 1: silver", "focus": [1, 2], "note": "Silver reads the 20,000 new bronze rows and keeps the COMPLETED ones (about 88%)."},
  {"label": "Update 1: gold", "focus": [2, 3], "note": "The materialized view is computed for the first time: one row per category."},
  {"label": "Update 2: bronze", "focus": [0, 1], "note": "`part_2.csv` has landed. Bronze reads **only** `part_2.csv`. `part_1.csv` is in the checkpoint and is skipped."},
  {"label": "Update 2: silver", "focus": [1, 2], "note": "Silver processes only the 20,000 rows that bronze appended in this update."},
  {"label": "Update 2: gold", "focus": [2, 3], "note": "The view is refreshed. On serverless the engine tries an **incremental** refresh, otherwise it recomputes. The result is the same either way."}
 ]}
```

## 🩹 When an upstream table is corrected

Here a streaming table enriches orders with `dim_product` as each order arrives (a stream-static join), and a materialized view joins the same tables at refresh time. Then someone fixes a wrong category.

```viz table
{"title": "Product 7 was filed under Toys by mistake", "columns": ["dataset", "row", "category", "amount"],
 "rows": [["dim_product", "product 7", "Toys", "-"],
          ["orders_enriched (ST)", "order 1001", "Toys", 40.0],
          ["orders_enriched (ST)", "order 1002", "Toys", 25.0],
          ["revenue_by_category (MV)", "group", "Toys", 65.0],
          ["revenue_by_category (MV)", "group", "Books", 300.0]],
 "steps": [
  {"label": "Start", "note": "Two orders of product 7 were enriched with the wrong category. Both datasets agree: 65.0 under Toys."},
  {"label": "Fix the dimension", "note": "`UPDATE dim_product SET category = 'Books' WHERE product_id = 7`. Nothing in the pipeline has run yet.", "upd": {"0": {"category": "Books"}}, "hl": [0]},
  {"label": "Next update: streaming table", "note": "A new order arrives and is enriched with Books. The two old rows **keep Toys**: a streaming table never revisits rows it already wrote.", "add": [["orders_enriched (ST)", "order 1003", "Books", 30.0]], "hl": [1, 2, 5]},
  {"label": "Next update: materialized view", "note": "The view is brought in line with the current sources. The Toys group disappears and Books grows to 395.0.", "del": [3], "upd": {"4": {"amount": 395.0}}, "hl": [4]},
  {"label": "Full refresh of the ST", "note": "Only a **full refresh** makes the streaming table re-read its whole source and fix the old rows. That works only if the source still has all the data.", "upd": {"1": {"category": "Books"}, "2": {"category": "Books"}}, "hl": [1, 2]}
 ]}
```

## 🐍 The same in Python, and append flows

Python pipelines use `from pyspark import pipelines as dp`. Older code uses `import dlt` with `@dlt.table`; it still works. A function returning a streaming DataFrame becomes a streaming table, a batch DataFrame becomes a materialized view.

```python
from pyspark import pipelines as dp

@dp.temporary_view                       # not stored, used inside the pipeline only
def completed_orders():
    return spark.readStream.table("pl_orders_bronze").where("status = 'COMPLETED'")

dp.create_streaming_table("pl_orders_all")          # one target, several flows

@dp.append_flow(target="pl_orders_all")
def from_web():
    return spark.readStream.table("completed_orders")

@dp.append_flow(target="pl_orders_all")
def from_shops():
    return spark.readStream.table("pl_shop_orders_bronze")
```

A **flow** is the streaming query that writes into a table. Every streaming table has at least one. **Append flows** let several sources feed one table, each with its own checkpoint. In SQL: `CREATE FLOW from_web AS INSERT INTO pl_orders_all BY NAME SELECT * FROM STREAM(completed_orders)`.

## ⚙️ Settings, updates and full refresh

| Setting | Options | What it changes |
|---|---|---|
| Default catalog and schema | Any schema you can write to | Where tables are published; unqualified names resolve here |
| Compute | Serverless (recommended) or classic | Start-up time, incremental MV refresh |
| Mode | Development / Production | Development: no automatic retries. Production: retries recoverable failures |
| Pipeline mode | Triggered / Continuous | Process what is there and stop, or keep running for low latency |
| Refresh | Update / Full refresh | Only new data, or truncate and reprocess everything |

A **full refresh** empties the streaming tables and re-reads every source from the beginning. If the source no longer has the old data (Kafka retention, deleted files), those rows are gone for good. Protect such tables with the table property `pipelines.reset.allowed = false`.

## 🧪 Try it: land files for a pipeline

```dataset retail
```

A pipeline cannot be created from a notebook cell, so the pipeline code in this module is display-only. You can prepare its source data here.

```python run
# Land the first of three raw order files in a volume
landing = data.volume(CATALOG, SCHEMA) + "/pl_landing"
ds.land_files(landing, table="fact_orders", parts=3, upto=1, fmt="csv")

orders_path = landing + "/fact_orders"
print("Use this path in read_files:", orders_path)
```

```python run
# Read the landed files the way the bronze table will (a batch read, no checkpoint)
display(spark.sql(f"""
    SELECT _metadata.file_name AS file, count(*) AS row_count, count_if(status = 'COMPLETED') AS completed
    FROM read_files('{orders_path}', format => 'csv', header => true)
    GROUP BY ALL
"""))
```

> **Run it yourself** (needs permission to create pipelines and serverless): 1. Open **Jobs & Pipelines** and create an ETL pipeline. 2. Set its default catalog and schema to your `CATALOG` and `SCHEMA`. 3. Paste the SQL file from this module into the source file and put in the path printed above. 4. Click **Start** and watch the graph. 5. Run `ds.land_files(landing, table="fact_orders", parts=3, upto=2, fmt="csv")` here, start the pipeline again, and check in the update details that bronze read only 20,000 new rows.

## Exercise 1: predict the gold table

Before you look at the pipeline result, compute with plain SQL what `pl_revenue_by_category` must contain after **two** files have landed. Each file holds 20,000 orders in `order_id` order, so the first two files are orders 1 to 40,000.

```sql todo
-- TODO 1: join fact_orders with dim_product
-- TODO 2: keep only the orders in the first two files, and only COMPLETED ones
-- TODO 3: per category: number of orders and revenue = round(sum(quantity * unit_price * (1 - discount)), 2)
```

```sql solution
SELECT p.category,
       count(*) AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o
JOIN dim_product p ON o.product_id = p.product_id
WHERE o.order_id <= 40000
  AND o.status = 'COMPLETED'
GROUP BY p.category
ORDER BY revenue DESC;
-- If you ran the pipeline, SELECT * FROM pl_revenue_by_category must return the same rows.
```

## Exercise 2: streaming table, materialized view or view?

Decide for each scenario. Use `"ST"`, `"MV"` or `"VIEW"` (temporary view). The cell checks only that every answer is filled in.

```python todo
# TODO: replace each None with "ST", "MV" or "VIEW"
answers = {
    "a_raw_json_files_every_10_minutes_ingest_each_once": None,
    "b_daily_revenue_where_orders_get_late_cancellations": None,
    "c_cleaning_step_used_by_two_other_datasets_not_queried_by_anyone": None,
    "d_orders_joined_with_customer_segment_that_must_be_current": None,
}

assert all(v in ("ST", "MV", "VIEW") for v in answers.values()), "Fill in every answer"
print("All answered:", answers)
```

```python solution
answers = {
    "a_raw_json_files_every_10_minutes_ingest_each_once": "ST",   # append-only, each file once
    "b_daily_revenue_where_orders_get_late_cancellations": "MV",  # must reflect updates to old rows
    "c_cleaning_step_used_by_two_other_datasets_not_queried_by_anyone": "VIEW",  # no need to store it
    "d_orders_joined_with_customer_segment_that_must_be_current": "MV",  # an ST would freeze the segment at ingest
}

assert answers["a_raw_json_files_every_10_minutes_ingest_each_once"] == "ST"
assert answers["b_daily_revenue_where_orders_get_late_cancellations"] == "MV"
assert answers["c_cleaning_step_used_by_two_other_datasets_not_queried_by_anyone"] == "VIEW"
assert answers["d_orders_joined_with_customer_segment_that_must_be_current"] == "MV"
print("All correct")

# Clean up the landed files when you are done (they live in your volume)
# dbutils.fs.rm(data.volume(CATALOG, SCHEMA) + "/pl_landing", True)
```

## ⚠️ Common mistakes

- ❌ A streaming table for a gold aggregate whose sources get corrected. It keeps the old numbers. Use a materialized view.
- ❌ A materialized view for raw, high-volume, append-only ingestion. Use a streaming table and process each file once.
- ❌ Leaving out `STREAM(...)` and expecting incremental processing. Without it the query is a batch read of the whole source.
- ❌ Full refresh of a bronze table to "fix" a silver bug. Fix silver and refresh only silver; the old raw data may be gone.
- ✅ Keep bronze and silver as streaming tables, put joins and aggregates that must be correct in materialized views.
- ✅ Use development mode while you build, production mode for scheduled runs.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Ingest new files once each | `CREATE OR REFRESH STREAMING TABLE t AS SELECT ... FROM STREAM read_files(...)` |
| Read another pipeline table incrementally | `FROM STREAM(t)` / `spark.readStream.table("t")` |
| A result that is always correct | `CREATE OR REFRESH MATERIALIZED VIEW` / `@dp.materialized_view` |
| A helper that is not stored | `CREATE TEMPORARY VIEW` / `@dp.temporary_view` |
| Several sources into one table | `CREATE FLOW ... INSERT INTO t BY NAME ...` / `@dp.append_flow(target="t")` |
| Reprocess everything | Full refresh (block it with `pipelines.reset.allowed = false`) |
