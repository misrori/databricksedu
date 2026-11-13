---
title: "Recap: Build Data Pipelines with Lakeflow Spark Declarative Pipelines"
summary: Recap of course 3 of Data Engineering with Databricks. Choose streaming tables or materialized views, add expectations, run and monitor a pipeline, and apply CDC with AUTO CDC.
icon: 🌊
level: Intermediate
minutes: 9
group: Data Engineering with Databricks
tags: [Lakeflow Spark Declarative Pipelines, Streaming tables, Materialized views, Expectations, AUTO CDC]
---
# Recap: Build Data Pipelines with Lakeflow Spark Declarative Pipelines

> Course 3 of 4. Building a **bronze, silver, gold** pipeline *declaratively*: you describe the tables, and the pipeline handles the order, incremental processing, checkpoints, retries and data quality. (Formerly *Delta Live Tables / DLT*.)

**The one idea to remember:** use **streaming tables** for ingestion and row-level transforms, and **materialized views** for aggregates and joins that must stay correct. Add **expectations** to every layer you care about.

## 🗺️ What we covered

```viz timeline
{"title": "The topics of the course",
 "items": [
  {"label": "1", "title": "Why declarative", "color": "navy", "note": "Define *what* the tables are, not *how* to run them. Dependencies are resolved automatically."},
  {"label": "2", "title": "Dataset types", "color": "blue", "note": "**Streaming tables**, **materialized views**, temporary views, and **flows**."},
  {"label": "3", "title": "Developing a pipeline", "color": "purple", "note": "**Lakeflow Pipelines Editor**, pipeline settings, dry run, and the pipeline graph."},
  {"label": "4", "title": "Medallion with Auto Loader", "color": "bronze", "note": "`STREAM read_files()` into bronze, cleaned silver, aggregated gold."},
  {"label": "5", "title": "Data quality", "color": "green", "note": "**Expectations**: warn, drop or fail."},
  {"label": "6", "title": "Production and monitoring", "color": "teal", "note": "Triggered vs continuous, development vs production mode, scheduling with a job. Pipeline graph, data quality metrics, and the **event log**."},
  {"label": "7", "title": "Change data capture", "color": "amber", "note": "**AUTO CDC INTO** (formerly APPLY CHANGES) for **SCD Type 1 and 2**."}
 ]}
```

## 🧱 Dataset types

| Object | Semantics | Typical layer |
|---|---|---|
| **Streaming table (ST)** | Incremental and append-oriented: each source row is processed **once** | Bronze ingestion, silver cleansing, CDC targets |
| **Materialized view (MV)** | Query result that is kept **correct** on every refresh. Refreshed incrementally when possible, reflects updates and deletes | Gold aggregates, joins with changing dimensions |
| **Temporary view** | Not persisted, visible only inside the pipeline | Intermediate logic |
| **Flow** | A query that writes into a target. Several **append flows** can feed one ST | Fan-in from many sources, backfills |

`STREAM(...)` / `spark.readStream` gives a **streaming** read, so the result is a streaming table. A plain `FROM` / `spark.read` gives a **batch** read, so the result is a materialized view.

## 🥉 A medallion pipeline in SQL

```sql
-- Bronze: incremental file ingestion with Auto Loader
CREATE OR REFRESH STREAMING TABLE orders_bronze
COMMENT 'Raw orders'
AS SELECT *, _metadata.file_name AS source_file, current_timestamp() AS ingested_at
FROM STREAM read_files('/Volumes/shop/raw/orders/', format => 'json');

-- Silver: clean + data quality
CREATE OR REFRESH STREAMING TABLE orders_silver (
  CONSTRAINT valid_id     EXPECT (order_id IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT positive_amt EXPECT (amount > 0)           ON VIOLATION FAIL UPDATE,
  CONSTRAINT has_email    EXPECT (email IS NOT NULL)                      -- warn only
)
AS SELECT order_id, lower(email) AS email, CAST(amount AS DECIMAL(10,2)) AS amount,
          CAST(order_ts AS TIMESTAMP) AS order_ts
FROM STREAM(orders_bronze);

-- Gold: aggregate for BI
CREATE OR REFRESH MATERIALIZED VIEW daily_revenue
AS SELECT date(order_ts) AS order_date, sum(amount) AS revenue, count(*) AS orders
FROM orders_silver
GROUP BY ALL;
```

## 🕸️ The pipeline builds the graph

Tables reference each other by name, and the pipeline builds the **dependency graph** from those references. You never write "run bronze first".

```viz flow
{"nodes": [
  {"icon": "📂", "title": "Volume files", "sub": "/Volumes/shop/raw/orders/", "color": "gray"},
  {"icon": "🥉", "title": "orders_bronze", "sub": "streaming table", "color": "bronze"},
  {"icon": "🥈", "title": "orders_silver", "sub": "streaming table + expectations", "color": "silver"},
  {"icon": "🥇", "title": "daily_revenue", "sub": "materialized view", "color": "gold"}
 ],
 "edges": ["STREAM read_files", "STREAM(orders_bronze)", "FROM orders_silver"],
 "steps": [
  {"label": "Bronze", "focus": [0, 1], "note": "Auto Loader reads only the files it has not seen yet. Each row is processed **once**."},
  {"label": "Silver", "focus": [2], "note": "`STREAM(orders_bronze)` makes this a streaming read, so only new bronze rows are cleaned and checked by the expectations."},
  {"label": "Gold", "focus": [3], "note": "A batch read (`FROM orders_silver`), so the result is an MV. It stays correct on every refresh, incrementally when possible."}
 ]}
```

## 🐍 The same in Python

```python
from pyspark import pipelines as dp        # older code: import dlt
from pyspark.sql import functions as F

@dp.table(comment="Raw orders")
def orders_bronze():
    return (spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "json")
            .load("/Volumes/shop/raw/orders/"))

@dp.table
@dp.expect_or_drop("valid_id", "order_id IS NOT NULL")
@dp.expect_or_fail("positive_amt", "amount > 0")
def orders_silver():
    return spark.readStream.table("orders_bronze").withColumn("email", F.lower("email"))

@dp.materialized_view
def daily_revenue():
    return (spark.read.table("orders_silver")
            .groupBy(F.to_date("order_ts").alias("order_date"))
            .agg(F.sum("amount").alias("revenue")))
```

SQL and Python files can be mixed in the same pipeline.

## ✅ Data quality with expectations

| Expectation | Invalid rows | Pipeline |
|---|---|---|
| `EXPECT (...)` / `@dp.expect` (default: **warn**) | Kept | Continues. Violations are counted |
| `ON VIOLATION DROP ROW` / `@dp.expect_or_drop` | **Dropped** | Continues. Violations are counted |
| `ON VIOLATION FAIL UPDATE` / `@dp.expect_or_fail` | Not applicable | The update **fails**. Nothing is committed for that flow |

`expect_all`, `expect_all_or_drop` and `expect_all_or_fail` take a dictionary of rules.

## 🔍 Watch the expectations of orders_silver

```viz table
{"title": "One batch arriving in orders_silver",
 "columns": ["order_id", "amount", "email", "outcome"],
 "rows": [[1, 25.00, "ann@shop.com", "kept"], [null, 10.00, "bob@shop.com", ""], [3, 15.00, null, ""], [4, -5.00, "cy@shop.com", ""]],
 "steps": [
  {"label": "Batch arrives", "note": "Four rows from bronze. Row 1 passes every rule."},
  {"label": "valid_id: DROP ROW", "note": "`order_id` is NULL, so the row is **dropped**. The violation is counted in the metrics.", "del": [1], "upd": {"1": {"outcome": "dropped"}}},
  {"label": "has_email: warn", "note": "No action means **warn**: the row is kept and the violation is counted.", "upd": {"2": {"outcome": "kept, counted"}}, "hl": [2]},
  {"label": "positive_amt: FAIL UPDATE", "note": "A negative amount fails the **whole update**. Nothing is committed for that flow until the data or the rule is fixed.", "upd": {"3": {"outcome": "update fails"}}, "hl": [3]}
 ]}
```

- Violation metrics show up in the pipeline UI and in the **event log**.
- **Quarantine pattern:** do not just drop bad rows. Write them to a separate table with the inverted rule, so you can inspect them.

## 🛠️ Developing a pipeline

| Setting | Options | Guidance |
|---|---|---|
| **Editor** | Lakeflow Pipelines Editor (multi-file, graph, data preview) | Use **dry run** to validate code and the graph without processing data |
| **Destination** | Default catalog and schema in Unity Catalog | Tables are published as UC objects |
| **Compute** | **Serverless** (recommended) or classic | Serverless gives fast start and incremental MV refresh |
| **Configuration** | Key-value parameters (e.g. `source_path`) | Avoid hard-coded paths. Read them in code with `spark.conf.get("source_path")` |

## ▶️ Running a pipeline

| Setting | Options | Guidance |
|---|---|---|
| **Pipeline mode** | **Triggered**: process available data, then stop. **Continuous**: always running | Triggered with a schedule for hourly or daily SLAs, continuous for low latency |
| **Run type** | Development: reuses compute, no retries. Production: retries and restarts | Production for scheduled runs |
| **Refresh** | Normal update, refresh selected tables, **full refresh** | Full refresh recomputes from scratch. Careful with sources that no longer hold old data |

Schedule the pipeline with its own schedule, or as a **pipeline task in a Lakeflow Job** (course 2).

## 📈 Monitoring: the event log

- **Pipeline graph:** status, row counts and timing per dataset.
- **Data quality tab:** expectation pass and fail counts per table.
- **Event log:** a Delta table with every update, flow progress, data quality metric and error.

```sql
SELECT timestamp, event_type, message
FROM event_log(TABLE(orders_silver))     -- or event_log('<pipeline-id>')
WHERE event_type IN ('flow_progress', 'update_progress')
ORDER BY timestamp DESC;
```

## 🔁 Change data capture with AUTO CDC

```viz code
title: AUTO CDC into an SCD Type 2 table
lang: sql
---
CREATE OR REFRESH STREAMING TABLE customers_silver;

CREATE FLOW customers_cdc AS AUTO CDC INTO customers_silver
FROM STREAM(customers_cdc_bronze)
KEYS (customer_id)
APPLY AS DELETE WHEN operation = 'DELETE'
SEQUENCE BY event_ts                 -- decides which change wins (handles out-of-order data)
COLUMNS * EXCEPT (operation, event_ts)
STORED AS SCD TYPE 2;                -- or SCD TYPE 1
---
1 | Target | An empty streaming table. The flow below fills it.
3-4 | Source | A flow that reads the change feed from bronze as a stream.
5 | KEYS | The business key. All changes for one key are applied to the same row (or row history).
6 | Deletes | Which change events mean "delete this key".
7 | SEQUENCE BY | Orders the changes per key, so a late event cannot overwrite a newer one.
8-9 | Columns and SCD type | Drop the CDC bookkeeping columns, then choose SCD Type 1 or 2.
```

AUTO CDC replaces hand-written `MERGE` logic for ordering, deduplication, deletes and SCD2 versioning. Use **AUTO CDC FROM SNAPSHOT** when the source only delivers full snapshots.

## 🕰️ SCD Type 1 and Type 2

| | SCD Type 1 | SCD Type 2 |
|---|---|---|
| Target holds | Latest state, one row per key | One row **per version** |
| History | Overwritten | Kept in **`__START_AT` / `__END_AT`** |
| Current rows | All rows | `WHERE __END_AT IS NULL` |

```viz table
{"title": "customers_silver stored as SCD TYPE 2",
 "columns": ["customer_id", "city", "__START_AT", "__END_AT"],
 "rows": [[42, "Paris", "2026-01-05", null]],
 "steps": [
  {"label": "INSERT", "note": "The first event for key 42 creates the current version. `__END_AT` is NULL."},
  {"label": "UPDATE city", "note": "The current version is closed with the new event's `SEQUENCE BY` value, and a new current version is added. With SCD Type 1 the row would simply be overwritten.", "upd": {"0": {"__END_AT": "2026-03-10"}}, "add": [[42, "Rome", "2026-03-10", null]]},
  {"label": "Current rows", "note": "`WHERE __END_AT IS NULL` returns only the latest version of each key.", "hl": [1]}
 ]}
```

## ⚠️ Common mistakes

- ❌ A **streaming table** for a gold aggregate that must reflect late corrections. Use an **MV**.
- ❌ A **materialized view** for raw, high-volume append ingestion. Use an **ST**.
- ❌ `EXPECT` without an action, expecting it to remove rows. The default only **warns**.
- ❌ **Continuous** mode for a daily report. Use **triggered** mode with a schedule.
- ❌ A full refresh of a bronze ST whose source (e.g. Kafka) no longer holds old events. That data is lost.
- ❌ Hand-written MERGE for out-of-order CDC. **AUTO CDC + `SEQUENCE BY`** handles it.

## 🧭 Cheat sheet

| I need to… | Use |
|---|---|
| Ingest new files incrementally | `CREATE OR REFRESH STREAMING TABLE ... FROM STREAM read_files(...)` |
| Keep an aggregate or join correct | `CREATE OR REFRESH MATERIALIZED VIEW` |
| Drop bad rows, or stop on them | `ON VIOLATION DROP ROW` / `ON VIOLATION FAIL UPDATE` |
| Apply a change feed with history | `AUTO CDC INTO ... SEQUENCE BY ... STORED AS SCD TYPE 2` |
| Validate code and graph without data | **Dry run** in the Lakeflow Pipelines Editor |
| See what an update did | `event_log(TABLE(t))` |

**Next course:** *DevOps Essentials for Data Engineering*, which takes this code into a tested, versioned deployment.
