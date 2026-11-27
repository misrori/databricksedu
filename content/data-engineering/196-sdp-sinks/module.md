---
title: "Sinks: writing outside the pipeline"
summary: Send a pipeline's streaming output to a table, topic or system the pipeline does not own. Learn how create_sink and an append flow work, what a sink cannot do, and why a plain Delta sink is the course's way to give Iceberg clients a live table.
icon: 📤
level: Advanced
minutes: 10
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Sinks, Append flow, UniForm, Iceberg]
---
# Sinks: writing outside the pipeline

> Every streaming table and materialized view in a pipeline belongs to that pipeline. Sometimes the result has to land somewhere the pipeline does not own: a plain Delta table with your own properties, a Kafka topic, or another system.

**The one idea to remember:** a **sink** is a destination, not a dataset. The pipeline **appends** to it through a flow and keeps the checkpoint, but it does not own, check or reset the data that lands there.

## 🧱 Inside and outside the pipeline

Lakeflow Spark Declarative Pipelines (SDP, formerly Delta Live Tables) manage their datasets end to end. A sink sits on the boundary.

```viz flow
{"title": "One pipeline, one sink",
 "nodes": [{"icon": "🥉", "title": "orders_bronze", "sub": "streaming table", "color": "bronze", "items": ["owned by the pipeline"]},
           {"icon": "🥈", "title": "orders_silver", "sub": "streaming table", "color": "silver", "items": ["expectations live here"]},
           {"icon": "➡️", "title": "orders_export_flow", "sub": "@dp.append_flow", "color": "blue", "items": ["checkpoint kept by the pipeline"]},
           {"icon": "📤", "title": "orders_export_sink", "sub": "dp.create_sink", "color": "teal", "items": ["outside the pipeline's scope"]},
           {"icon": "🔌", "title": "Readers", "sub": "Spark, Trino, Snowflake, Kafka consumers", "color": "purple"}],
 "edges": ["stream", "readStream", "append", "read"],
 "steps": [
  {"label": "Inside", "focus": [0, 1], "note": "Streaming tables and materialized views are **managed**: the pipeline creates them, tracks lineage, applies expectations and AUTO CDC, and empties them on a full refresh."},
  {"label": "The flow", "focus": [2], "note": "An append flow reads `orders_silver` as a stream. Its checkpoint remembers which rows it already sent, so each run sends only new rows."},
  {"label": "The sink", "focus": [3], "note": "The sink is just the address: a Delta table by name or path, a Kafka topic, an Event Hub, or a custom writer. The pipeline only appends to it."},
  {"label": "Outside", "focus": [4], "note": "Whoever reads the target sees an ordinary table or topic. Its properties, permissions and clean-up are yours to manage."}
 ]}
```

## ⚖️ A managed dataset or a sink?

```viz compare
{"items": [
  {"icon": "🏠", "title": "Streaming table / materialized view", "sub": "the default", "color": "blue",
   "points": ["Created and owned by the pipeline", "Lineage in the pipeline graph and Unity Catalog", "✅ expectations, AUTO CDC, SQL or Python", "❌ you cannot freely set every Delta table property"],
   "foot": "Use it for everything that stays in the lakehouse"},
  {"icon": "📤", "title": "Sink", "sub": "dp.create_sink", "color": "teal",
   "points": ["The target lives outside the pipeline's scope", "✅ full control of a Delta table's properties", "✅ Kafka, Event Hubs, custom writers (reverse ETL)", "❌ Python only, append only, no expectations"],
   "foot": "Use it when the result must leave the pipeline"}
 ]}
```

Reach for a sink only when a managed dataset cannot do the job. Lineage, data quality metrics and automatic resets are worth keeping.

## 🔌 Four kinds of sinks

| Sink | `format` | Typical use |
|---|---|---|
| Delta table | `"delta"` | A plain Delta table, by `tableName` or by `path` |
| Apache Kafka | `"kafka"` | Push events back to a topic for operational apps |
| Azure Event Hubs | `"kafka"` (Kafka interface) | Real-time events on Azure, such as fraud alerts |
| Python custom sink | the name of your data source | Any store you can write with a PySpark custom data source |

Each needs its own options (servers, topic, credentials). Look them up in the sink documentation for your target; this module uses the Delta sink.

## 🐍 Two steps: register, then append

A sink is defined in Python. There is no SQL syntax for it.

```viz code
title: pipeline/orders_export.py
lang: python
---
from pyspark import pipelines as dp

dp.create_sink(
    name="orders_export_sink",
    format="delta",
    options={"tableName": "main.partner.snk_orders_export"}
)

@dp.append_flow(name="orders_export_flow", target="orders_export_sink")
def orders_export_flow():
    return spark.readStream.table("orders_silver")
---
3-7 | register | `create_sink` only names the destination. Nothing is written yet. `name` is how flows refer to it; `tableName` is the real Unity Catalog table.
6 | target table | On the first run the table is created if it does not exist. It is a normal managed Delta table.
9 | the flow | `target` points at the **sink name**, not at the table name. Only append flows can write to a sink.
10-11 | the query | A streaming read. The flow's checkpoint makes each update send only rows it has not sent before.
```

## 📏 What a sink does not do

- **Python only.** SQL files cannot declare a sink.
- **Append only.** No AUTO CDC, no updates in place. Each new source row becomes one new target row.
- **No expectations on the sink.** Put the rules on the table that feeds it (`orders_silver`), so bad rows never reach the flow.
- **Not reset by a full refresh.** The Databricks docs state that a full refresh does not clean up data already in a sink: reprocessed rows are **appended again**.

```viz timeline
{"title": "Row counts in orders_silver and in the sink",
 "items": [
  {"label": "run 1", "title": "1,000 rows", "color": "green", "note": "The flow sends all 1,000 silver rows. Sink: **1,000**."},
  {"label": "run 2", "title": "+200 rows", "color": "green", "note": "The checkpoint knows the first 1,000. Only 200 new rows are appended. Sink: **1,200**."},
  {"label": "full refresh", "title": "1,200 again", "color": "red", "note": "Silver is emptied and rebuilt (1,200 rows) and the flow starts over. The sink is not emptied, so it gets 1,200 more. Sink: **2,400**, every order twice."}
 ]}
```

## 🧊 Why the course uses a Delta sink: Iceberg reads

UniForm makes a Delta table readable by Iceberg clients (see the "Iceberg compatibility with UniForm" module, `delta-iceberg-uniform`). Its properties cannot be set on pipeline streaming tables for Iceberg v2 reads, but a sink's target is a plain table you control.

```viz table
{"title": "SHOW TBLPROPERTIES snk_orders_export", "columns": ["property", "value"],
 "rows": [["delta.enableDeletionVectors", "true"], ["delta.columnMapping.mode", "(not set)"], ["delta.enableIcebergCompatV2", "(not set)"], ["delta.universalFormat.enabledFormats", "(not set)"]],
 "steps": [
  {"label": "First run", "note": "The flow created a normal managed Delta table. Deletion vectors may be on by default, depending on workspace settings."},
  {"label": "ALTER 1", "note": "Iceberg v2 readers cannot apply deletion vectors, so the course turns them off first.", "upd": {"0": {"value": "false"}}, "hl": [0]},
  {"label": "ALTER 2", "note": "Column mapping gives every column a stable id, then Iceberg compatibility and Iceberg metadata are switched on.", "upd": {"1": {"value": "name"}, "2": {"value": "true"}, "3": {"value": "iceberg"}}, "hl": [1, 2, 3]},
  {"label": "Next runs", "note": "The flow keeps appending as before. After each commit Databricks writes Iceberg metadata for the new version, asynchronously."}
 ]}
```

> Newer option: on Databricks Runtime 17.3 and above, pipeline streaming tables and materialized views can be exposed to external **Iceberg v3** clients directly, and Iceberg v3 does not need deletion vectors off. The sink pattern still works for Iceberg v2 readers and gives you full control of the table.

## 🧪 Try it: the table a sink writes

```dataset retail
```

A pipeline needs minutes to start, so the sink code above is display-only. Here you play the flow yourself: create the plain Delta table its first run would write, then switch on Iceberg reads exactly as the course does.

```sql run
-- Run 1 of the "flow": the first 1,000 orders land in a plain Delta table
CREATE OR REPLACE TABLE snk_orders_export AS
SELECT order_id, order_date, customer_id, product_id, quantity, discount, status
FROM fact_orders
WHERE order_id <= 1000;

SHOW TBLPROPERTIES snk_orders_export;   -- is delta.enableDeletionVectors there, and true?
```

```sql run
-- Turn off deletion vectors, then enable column mapping, Iceberg compatibility and Iceberg metadata
ALTER TABLE snk_orders_export SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'false');

ALTER TABLE snk_orders_export SET TBLPROPERTIES (
  'delta.columnMapping.mode' = 'name',
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg'
);

SHOW TBLPROPERTIES snk_orders_export;
```

```sql run
-- Run 2 of the "flow": only the new rows are appended
INSERT INTO snk_orders_export
SELECT order_id, order_date, customer_id, product_id, quantity, discount, status
FROM fact_orders
WHERE order_id BETWEEN 1001 AND 1200;

SELECT count(*) AS rows_in_sink FROM snk_orders_export;   -- 1,200
```

```sql run
-- The Iceberg section shows which Delta version was last converted
DESCRIBE EXTENDED snk_orders_export;
```

## Exercise 1: properties from the first commit

Instead of altering the table after the first run, create `snk_orders_uf` with the UniForm properties already set. **Predict** which extra properties appear in `SHOW TBLPROPERTIES` that you did not write, and how many versions `DESCRIBE HISTORY` shows compared with `snk_orders_export`.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE snk_orders_uf with TBLPROPERTIES for Iceberg v2
--         (deletion vectors off, Iceberg compat v2, enabled formats iceberg)
--         AS SELECT the first 1,000 orders from fact_orders
-- TODO 2: SHOW TBLPROPERTIES snk_orders_uf
-- TODO 3: DESCRIBE HISTORY snk_orders_uf
```

```sql solution
CREATE OR REPLACE TABLE snk_orders_uf
TBLPROPERTIES (
  'delta.enableDeletionVectors' = 'false',
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg'
)
AS SELECT order_id, order_date, customer_id, product_id, quantity, discount, status
   FROM fact_orders WHERE order_id <= 1000;

SHOW TBLPROPERTIES snk_orders_uf;    -- delta.columnMapping.mode and maxColumnId were added for you
DESCRIBE HISTORY snk_orders_uf;      -- one CREATE TABLE AS SELECT version, no SET TBLPROPERTIES commits
-- You could also create the target table up front like this before the first pipeline run;
-- its schema must then match what the flow writes.
```

## Exercise 2: what a full refresh does to a sink

Simulate the timeline: run 1 sends orders 1 to 1,000, run 2 sends 1,001 to 1,200, then a full refresh re-sends all 1,200. **Predict** the row count and the number of distinct `order_id` values before you run the check.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE snk_ex_export from fact_orders WHERE order_id <= 1000
-- TODO 2: INSERT orders 1001 to 1200 (run 2)
-- TODO 3: INSERT orders 1 to 1200 again (the full refresh)
-- TODO 4: count rows and distinct order_ids, then list a few order_ids that appear twice
```

```sql solution
CREATE OR REPLACE TABLE snk_ex_export AS
SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id <= 1000;

INSERT INTO snk_ex_export
SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id BETWEEN 1001 AND 1200;

INSERT INTO snk_ex_export
SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id <= 1200;

SELECT count(*) AS total_rows, count(DISTINCT order_id) AS distinct_orders FROM snk_ex_export;   -- 2,400 and 1,200

SELECT order_id, count(*) AS copies FROM snk_ex_export
GROUP BY order_id HAVING count(*) > 1 ORDER BY order_id LIMIT 5;
-- Every order is there twice. Before a full refresh, empty the sink table yourself,
-- or make its readers deduplicate on the key.

-- Clean up when you are done
-- DROP TABLE IF EXISTS snk_orders_export;
-- DROP TABLE IF EXISTS snk_orders_uf;
-- DROP TABLE IF EXISTS snk_ex_export;
```

## ⚠️ Common mistakes

- ❌ Writing `CREATE SINK` in a SQL file. Sinks exist only in the Python API.
- ❌ Pointing `@dp.append_flow(target=...)` at the table name. The target is the **sink name** from `create_sink`.
- ❌ Adding `@dp.expect` to the sink flow. Check the rows on the streaming table that feeds it.
- ❌ Running a full refresh and trusting the sink. It is appended to again, not reset.
- ❌ Using a sink for every output. Managed datasets keep lineage, metrics and resets; a sink gives them up.
- ✅ Set the UniForm properties before Iceberg clients rely on the table, and check them with `SHOW TBLPROPERTIES`.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Name an external Delta target | `dp.create_sink(name=..., format="delta", options={"tableName": ...})` |
| Send rows to it | `@dp.append_flow(name=..., target="<sink name>")` returning a `readStream` |
| Push events to Kafka / Event Hubs | `dp.create_sink(..., format="kafka", options={...})` |
| Check data quality | Expectations on the streaming table that feeds the sink |
| Let Iceberg v2 clients read it | DVs off, then column mapping, `enableIcebergCompatV2`, `enabledFormats = 'iceberg'` |
| Check the result | `SHOW TBLPROPERTIES t`, `DESCRIBE EXTENDED t` |
