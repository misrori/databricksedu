---
title: "Recap: Data Ingestion with Lakeflow Connect"
summary: Recap of course 1 of Data Engineering with Databricks. Choose the right ingestion option, load files incrementally with COPY INTO or Auto Loader, and keep every row traceable to its source file.
icon: 📥
level: Beginner
minutes: 9
group: Data Engineering with Databricks
tags: [Lakeflow Connect, COPY INTO, Auto Loader, read_files, Ingestion]
---
# Recap: Data Ingestion with Lakeflow Connect

> Course 1 of 4. Getting data **into** the lakehouse: files from cloud storage, semi-structured formats, and enterprise sources, all landing in **Unity Catalog** bronze tables.

**The one idea to remember:** pick the *most managed* ingestion option that fits the source. Then make the load **incremental** and **traceable**, so you only process new data and always know where each row came from.

## 🗺️ What we covered

```viz timeline
{"title": "The lessons of the course",
 "items": [
  {"label": "01", "title": "Lab environment", "color": "navy", "note": "Unity Catalog: `catalog.schema.table`, and **volumes** for files."},
  {"label": "02", "title": "CTAS, COPY INTO, streaming tables", "color": "blue", "note": "Batch load with `read_files()`. **Incremental, idempotent** load with `COPY INTO`. `CREATE OR REFRESH STREAMING TABLE` with Auto Loader is the recommended incremental method."},
  {"label": "03", "title": "Metadata columns", "color": "teal", "note": "`_metadata.file_name`, `_metadata.file_modification_time` and `current_timestamp()` for lineage."},
  {"label": "04", "title": "CSV and rescued data", "color": "amber", "note": "CSV options, explicit schemas, and `_rescued_data` for rows that do not fit."},
  {"label": "06", "title": "JSON", "color": "purple", "note": "Flatten JSON strings, use `from_json` and STRUCT, and the `VARIANT` type."},
  {"label": "08", "title": "Lakeflow Connect", "color": "green", "note": "**Managed connectors** for databases and SaaS apps, plus Partner Connect."},
  {"label": "09+", "title": "MERGE INTO and appendix", "color": "gray", "note": "Bonus: upserts with schema enforcement and evolution. Appendix: XML ingestion and Auto Loader in Python."}
 ]}
```

## 🍽️ The ingestion menu

Start at the top of the stack and move down only when you need to. Everything should end up in **Unity Catalog-governed** tables. Volume paths look like `/Volumes/<catalog>/<schema>/<volume>/<path>`.

```viz layers
{"title": "From most managed to most custom",
 "layers": [
  {"icon": "🔌", "title": "Managed connectors (Lakeflow Connect)", "sub": "SaaS apps (Salesforce, Workday, ServiceNow) and databases (SQL Server, PostgreSQL). Fully managed, incremental, CDC-aware", "color": "green"},
  {"icon": "📂", "title": "Standard connectors", "sub": "Files in cloud object storage (Auto Loader, `COPY INTO`, `read_files`) and message buses (Kafka, Kinesis)", "color": "teal"},
  {"icon": "⬆️", "title": "Upload UI / Add data", "sub": "One-off CSV, JSON or Excel files into a table or a volume", "color": "blue"},
  {"icon": "🤝", "title": "Partner Connect (Fivetran and others)", "sub": "Sources not covered natively, or a tool the company already uses", "color": "purple"},
  {"icon": "🛠️", "title": "Custom code (JDBC / REST in a notebook)", "sub": "Anything else. You own pagination, retries and incrementality", "color": "red"}
 ]}
```

## 📂 Three ways to load files

```sql
-- 1) Batch: CTAS + read_files()  -> re-reads everything every time
CREATE OR REPLACE TABLE bronze_users AS
SELECT * FROM read_files('/Volumes/shop/raw/users/', format => 'parquet');

-- 2) Incremental batch: COPY INTO  -> idempotent, already-loaded files are skipped
CREATE TABLE IF NOT EXISTS bronze_sales;
COPY INTO bronze_sales
FROM '/Volumes/shop/raw/sales/'
FILEFORMAT = PARQUET
COPY_OPTIONS ('mergeSchema' = 'true');

-- 3) Incremental: streaming table + Auto Loader  -> recommended
CREATE OR REFRESH STREAMING TABLE bronze_orders
AS SELECT * FROM STREAM read_files('/Volumes/shop/raw/orders/', format => 'json');

REFRESH STREAMING TABLE bronze_orders;   -- pick up new files
```

> A streaming table created in Databricks SQL is refreshed by a **serverless pipeline** that Databricks creates for you. It does not use warehouse compute.

## 🔁 What happens on a re-run

Step through a landing folder as files arrive. Watch which files each method reads.

```viz files
{"title": "/Volumes/shop/raw/sales/",
 "steps": [
  {"label": "Two files land", "note": "The source system drops two files. Nothing is loaded yet.",
   "add": [{"path": "part_1.parquet", "tag": "new"}, {"path": "part_2.parquet", "tag": "new"}]},
  {"label": "COPY INTO, run 1", "note": "Both files are loaded. `COPY INTO` records them in the target table's state.",
   "tag": {"part_1.parquet": "loaded (run 1)", "part_2.parquet": "loaded (run 1)"}},
  {"label": "COPY INTO, run 2", "note": "Same command again: **0 rows inserted**. It is idempotent, so already-loaded files are skipped. Use `'force' = 'true'` to reload on purpose."},
  {"label": "A third file lands", "note": "New data arrives in the same folder.",
   "add": [{"path": "part_3.parquet", "tag": "new"}]},
  {"label": "COPY INTO, run 3", "note": "Only `part_3` is read. A streaming table with Auto Loader behaves the same way, tracking files in its checkpoint.",
   "tag": {"part_3.parquet": "loaded (run 3)"}},
  {"label": "CTAS re-run", "note": "`CREATE OR REPLACE TABLE ... AS SELECT * FROM read_files(...)` has no state. It reads **all three** files again, every time.",
   "tag": {"part_1.parquet": "re-read by CTAS", "part_2.parquet": "re-read by CTAS", "part_3.parquet": "re-read by CTAS"}}
 ]}
```

## ⚖️ Compare the three methods

| | CTAS + `read_files` | `COPY INTO` | Streaming table / Auto Loader |
|---|---|---|---|
| Re-run behaviour | Reloads **all** files | Loads only **new** files | Processes only **new** files |
| Scale | Small / one-off | Thousands of files | **Millions** of files |
| Schema drift | Re-infers | `mergeSchema` | Evolution modes, schema hints, `_rescued_data` |
| State | None | Tracked in the table | Checkpoint (managed for you) |

## 🏷️ Traceability: metadata columns

Every file source exposes a hidden `_metadata` column. Select it explicitly when you load:

```sql
CREATE OR REPLACE TABLE bronze_users AS
SELECT
  *,
  cast(from_unixtime(user_first_touch_timestamp / 1000000) AS DATE) AS first_touch_date,
  _metadata.file_name              AS source_file,
  _metadata.file_modification_time AS file_modified_at,
  current_timestamp()              AS ingested_at
FROM read_files('/Volumes/shop/raw/users/', format => 'parquet');
```

This tells you **which file** a row came from and **when** it was loaded. That is essential for debugging and for reprocessing.

## 📄 CSV needs options

The defaults often give a single column, or headers loaded as data:

```sql
SELECT * FROM read_files(
  '/Volumes/shop/raw/sales-csv/',
  format    => 'csv',
  header    => true,
  delimiter => '|',
  schema    => 'order_id INT, email STRING, amount DOUBLE',
  rescuedDataColumn => '_rescued_data'
);
```

- Missing header? Set `header => false` and supply the column names through `schema`.
- When the schema is inferred, `read_files` and Auto Loader add `_rescued_data` automatically.

## 🛟 The rescued data column

`_rescued_data` catches values that do not match the schema (wrong type, extra columns) as JSON, so **nothing is silently lost**. Typical lab pattern: ingest, inspect rows `WHERE _rescued_data IS NOT NULL`, then fix and coalesce them.

```viz table
{"title": "read_files with schema 'order_id INT, quantity INT, status STRING'",
 "columns": ["order_id", "quantity", "status", "_rescued_data"],
 "rows": [[1, 2, "COMPLETED", null], [2, null, "OPEN", "{\"quantity\":\"two\"}"], [3, 1, "OPEN", "{\"coupon\":\"X10\"}"]],
 "steps": [
  {"label": "Good row", "note": "Every value matches its type, so `_rescued_data` is NULL.", "hl": [0]},
  {"label": "Wrong type", "note": "`quantity` was the text `two`. The column becomes NULL, but the original value is kept as JSON in `_rescued_data`.", "hl": [1]},
  {"label": "Extra column", "note": "The file had a `coupon` column the schema does not know. It is rescued instead of dropped.", "hl": [2]},
  {"label": "Fix it", "note": "Inspect rows `WHERE _rescued_data IS NOT NULL`, repair the value, and coalesce it back into the typed column.", "upd": {"1": {"quantity": 2}}}
 ]}
```

## 🧾 JSON and semi-structured data

```sql
-- JSON files -> table (nested fields become STRUCT / ARRAY)
SELECT * FROM read_files('/Volumes/shop/raw/events/', format => 'json');

-- A JSON *string* column (e.g. Kafka value, after unbase64 + cast to STRING):
SELECT value:device, value:items[0].sku::int FROM bronze_kafka;               -- colon syntax
SELECT from_json(value, schema_of_json('<sample json>')) AS v FROM bronze_kafka; -- -> STRUCT
SELECT parse_json(value) AS v FROM bronze_kafka;                               -- -> VARIANT
```

## 🧰 Which JSON tool when

| Need | Use |
|---|---|
| Quick extraction from a JSON string | `col:field.subfield`, cast with `::type` |
| Typed nested columns | `from_json(col, schema)` gives a STRUCT, then `select v.*` to flatten |
| Flexible, evolving schema, fast queries | **`VARIANT`** via `parse_json()` |
| One row per array element | `explode()` / `explode_outer()` |
| XML (appendix) | `read_files(..., format => 'xml', rowTag => 'book')` |

## 🔌 Enterprise sources: managed connectors

In the workspace, open **Data Ingestion**. It shows the Databricks connectors, file upload, and Fivetran (partner) connectors. A managed connector creates an **ingestion pipeline**. Step through it.

```viz flow
{"nodes": [
  {"icon": "🏢", "title": "Source", "sub": "SaaS app or database", "color": "gray"},
  {"icon": "🔑", "title": "Connection", "sub": "credentials as a UC object", "color": "purple"},
  {"icon": "🚪", "title": "Ingestion gateway", "sub": "databases only: reads the change log", "color": "amber"},
  {"icon": "⚙️", "title": "Ingestion pipeline", "sub": "source objects to sync", "color": "blue"},
  {"icon": "🌊", "title": "Streaming tables", "sub": "in the destination catalog and schema", "color": "green"}
 ],
 "edges": ["authenticates", "CDC", "incremental", "SCD 1 or 2"],
 "steps": [
  {"label": "Connection", "focus": [0, 1], "note": "Credentials are stored in a Unity Catalog **connection**, not in code."},
  {"label": "Gateway", "focus": [2], "note": "**Database connectors** add an ingestion gateway that reads the change log (CDC). **SaaS connectors** run fully serverless without it."},
  {"label": "Pipeline", "focus": [3], "note": "You pick the source objects and the destination **catalog and schema**. Schedule it from the pipeline itself or from a Lakeflow Job."},
  {"label": "Tables", "focus": [4], "note": "Each source table lands as a **streaming table**, with history as **SCD Type 1** (overwrite) or **SCD Type 2** (keep history)."}
 ]}
```

> Federation **queries data in place**. Lakeflow Connect **ingests** it. These are different tools for different needs.

## 🔀 Bonus: MERGE INTO for upserts

```sql
MERGE WITH SCHEMA EVOLUTION INTO users_target t
USING users_updates s
ON t.id = s.id
WHEN MATCHED AND s.op = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *;
```

- Atomic insert, update and delete in a single statement.
- **Schema enforcement** by default: new source columns cause an error. Use `WITH SCHEMA EVOLUTION` to add them to the target.
- When incoming changes must update existing rows, use `MERGE INTO` here, or AUTO CDC in pipelines (course 3).

## 🧪 Try it: three ways to ingest

```dataset retail
```

Land the **retail** order data as CSV files in a volume in your schema, then load them. Only 2 of the 3 order files land for now.

```python run
# Land raw CSV files in a volume (2 of the 3 order files for now)
LANDING = data.volume(CATALOG, SCHEMA) + "/lfc_landing"
ds.land_files(LANDING, upto=2)
```

```python run
# 1) Batch: CTAS + read_files() with metadata columns
spark.sql(f"""
CREATE OR REPLACE TABLE lfc_orders_ctas AS
SELECT *, _metadata.file_name AS source_file, current_timestamp() AS ingested_at
FROM read_files('{LANDING}/fact_orders/', format => 'csv', header => true)
""")
display(spark.sql("SELECT source_file, count(*) AS rows, max(ingested_at) AS ingested_at FROM lfc_orders_ctas GROUP BY ALL"))
```

```python run
# 2) Incremental: COPY INTO is idempotent. Run this cell twice and watch num_inserted_rows
COPY = f"""
COPY INTO lfc_orders_copy
FROM '{LANDING}/fact_orders/'
FILEFORMAT = CSV
FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true')
COPY_OPTIONS ('mergeSchema' = 'true')
"""
spark.sql("CREATE TABLE IF NOT EXISTS lfc_orders_copy")
display(spark.sql(COPY))
```

## 🔬 Try it: a new file and bad rows

```python run
# 3) A new file arrives: COPY INTO loads only that one
ds.land_files(LANDING, upto=3)
display(spark.sql(COPY))
```

```python run
# 4) Rescued data: malformed values are kept in _rescued_data instead of being lost
display(spark.sql(f"""
SELECT * FROM read_files('{LANDING}/fact_orders_bad/', format => 'csv', header => true,
  schema => 'order_id INT, order_date DATE, customer_id INT, product_id INT, quantity INT, discount DOUBLE, status STRING',
  rescuedDataColumn => '_rescued_data')
"""))

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS lfc_orders_ctas"); spark.sql("DROP TABLE IF EXISTS lfc_orders_copy")
```

## ⚠️ Common mistakes

- ❌ Expecting `COPY INTO` to reload every file on each run. It is **idempotent** and skips files it has already loaded. Use `'force' = 'true'` to reload.
- ❌ CTAS on a schedule for growing data: this reprocesses **everything** on every run.
- ❌ Ignoring `_rescued_data`: bad values quietly turn into NULLs in your analysis.
- ❌ Writing a custom REST poller for a source that has a **managed connector**.
- ❌ Hard-coding credentials. Use **UC connections** or **secrets**.

## 🧭 Cheat sheet

| Situation | Choose |
|---|---|
| Salesforce / SQL Server tables, keep them in sync | **Managed connector** |
| New files land in a volume every hour | **Streaming table** (Auto Loader) or `COPY INTO` on a schedule |
| Millions of small files, continuous arrival | **Auto Loader** |
| A one-off Excel file from a business user | **Upload UI** |
| You must know which file each row came from | Add **`_metadata`** columns |
| Bad CSV rows must not be lost | **`_rescued_data`** |

**Next course:** *Deploy Workloads with Lakeflow Jobs*, which schedules and orchestrates these loads.
