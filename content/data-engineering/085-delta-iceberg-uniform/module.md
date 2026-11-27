---
title: Iceberg compatibility with UniForm
summary: Make one Delta table readable by Apache Iceberg clients. See which table properties to set, how the transaction log, the protocol and the schema change, what appears in the table folder, and how an external Spark reads it through Unity Catalog.
icon: 🧊
level: Intermediate
minutes: 11
group: Delta Lake internals
tags: [Delta Lake, Iceberg, UniForm, Column mapping, Interoperability]
---
# Iceberg compatibility with UniForm

> Delta Lake and Apache Iceberg are two open table formats. Both are Parquet files plus metadata, but the metadata looks different. UniForm (Universal Format) lets one Delta table also write Iceberg metadata, so Iceberg engines can read the same files without a copy.

**The one idea to remember:** UniForm does not copy data. It writes a second set of metadata (Iceberg's) next to the Delta log, pointing to the same Parquet files.

## 🧊 One copy of data, two kinds of metadata

```viz flow
{"title": "A UniForm table",
 "nodes": [
  {"icon": "✍️", "title": "Databricks writes", "sub": "INSERT, MERGE, …", "color": "navy"},
  {"icon": "📜", "title": "Delta log", "sub": "_delta_log/*.json", "color": "blue"},
  {"icon": "📦", "title": "Parquet files", "sub": "one copy", "color": "gray"},
  {"icon": "🧊", "title": "Iceberg metadata", "sub": "metadata/*.json, *.avro", "color": "teal"},
  {"icon": "🔌", "title": "Iceberg clients", "sub": "Spark, Trino, Snowflake, …", "color": "purple"}
 ],
 "edges": ["commit", "lists", "same files", "Iceberg REST catalog"],
 "steps": [
  {"label": "Write", "focus": [0, 1, 2], "note": "Every write is a normal Delta commit: Parquet files plus a log entry."},
  {"label": "Translate", "focus": [1, 3], "note": "After the commit, Databricks generates Iceberg metadata for the new version, **asynchronously**."},
  {"label": "Read", "focus": [3, 4, 2], "note": "An Iceberg client asks Unity Catalog for the table, gets the Iceberg metadata and reads the **same** Parquet files."}
 ]}
```

Writes go through Delta. Iceberg clients read; they do not write to a UniForm table.

## 🔀 Delta and Iceberg metadata, side by side

```viz compare
{"items": [
 {"icon": "🔺", "title": "Delta Lake", "color": "blue",
  "points": ["`_delta_log/00…07.json`: one file per commit", "Actions: `add`, `remove`, `metaData`, `protocol`", "Checkpoints every few commits", "Columns found by **name** (or by id with column mapping)"]},
 {"icon": "🧊", "title": "Apache Iceberg", "color": "teal",
  "points": ["`metadata/…metadata.json`: one file per snapshot", "→ manifest list (Avro) → manifests (Avro) → data files", "Snapshots instead of versions", "Columns found by **field id**"]}
 ]}
```

The last row is the important one: Iceberg needs a stable id per column. That is why UniForm turns on **column mapping** in Delta.

## 🔛 Turning it on

```sql
-- New table: set two properties (column mapping is enabled automatically)
CREATE TABLE main.sales.orders_uf (order_id BIGINT, amount DOUBLE, status STRING)
TBLPROPERTIES (
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg'
);

-- Existing table: REORG also removes deletion vectors, which Iceberg v2 cannot read
REORG TABLE main.sales.orders APPLY (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION = 2));
```

| Requirement | Why |
|---|---|
| Unity Catalog table | Iceberg clients find it through the UC Iceberg REST catalog |
| Column mapping | Iceberg identifies columns by field id |
| No deletion vectors (Iceberg v2) | Iceberg v2 readers cannot apply them; Iceberg v3 can |
| Not a materialized view or streaming table | Not supported for these objects |

## 📂 What changes in the folder

```viz files
{"title": "orders_uf/",
 "steps": [
  {"label": "CREATE with UniForm", "note": "Version 0 records the properties, the new protocol and the schema with column ids.",
   "add": [{"path": "_delta_log/00000000000000000000.json", "tag": "v0 · protocol + metaData"}]},
  {"label": "Iceberg metadata appears", "note": "A `metadata/` folder is written next to `_delta_log/`. It describes the same (still empty) table for Iceberg.",
   "add": [{"path": "metadata/00000-6f1c….metadata.json", "tag": "Iceberg snapshot for v0"}]},
  {"label": "INSERT", "note": "A normal Delta commit: one Parquet file and `…01.json`.",
   "add": [{"path": "part-00000-a1….snappy.parquet", "tag": "3 rows"}, {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · add"}]},
  {"label": "Iceberg catches up", "note": "Shortly after, a new Iceberg snapshot lists **the same Parquet file** through a manifest list and a manifest. No data was copied.",
   "add": [{"path": "metadata/snap-81…-1-c2….avro", "tag": "manifest list"}, {"path": "metadata/c2…-m0.avro", "tag": "manifest → part-00000"}, {"path": "metadata/00001-9d0e….metadata.json", "tag": "Iceberg snapshot for v1"}]}
 ]}
```

File names are shortened. On managed tables you do not browse this folder yourself; `DESCRIBE EXTENDED` shows which Delta version the Iceberg metadata was last converted from.

## 📜 What changes in the transaction log

```viz code
title: _delta_log/00000000000000000000.json (shortened)
lang: json
---
{"protocol": {"minReaderVersion": 3, "minWriterVersion": 7,
  "readerFeatures": ["columnMapping"],
  "writerFeatures": ["columnMapping", "icebergCompatV2"]}}
{"metaData": {"id": "4b8f…", "format": {"provider": "parquet"},
  "schemaString": "{… \"name\":\"amount\", \"metadata\": {\"delta.columnMapping.id\": 2, \"delta.columnMapping.physicalName\": \"col-5e2a…\"} …}",
  "configuration": {
    "delta.enableIcebergCompatV2": "true",
    "delta.universalFormat.enabledFormats": "iceberg",
    "delta.columnMapping.mode": "name",
    "delta.columnMapping.maxColumnId": "3"}}}
---
1-3 | protocol | The table now needs readers and writers that know **table features**. Old Delta clients that do not support column mapping can no longer read it.
4 | metaData | The usual table metadata: id, file format, schema, properties.
5 | schema | Every column gets an **id** and a **physical name**. The id becomes the Iceberg field id.
6-10 | configuration | The two properties you set, plus the column mapping settings Delta added for you.
```

Exact values differ by runtime (for example the mapping mode). The shape is what matters.

## 🧬 What changes in the schema

With column mapping, a column has two names: the **logical** name you query, and a **physical** name used inside the Parquet files.

```viz table
{"title": "orders_uf columns", "columns": ["logical name", "column id", "physical name in Parquet"],
 "rows": [["order_id", 1, "col-a81c…"], ["amount", 2, "col-5e2a…"], ["status", 3, "col-0f9b…"]],
 "steps": [
  {"label": "After CREATE", "note": "You still write `SELECT amount …`. Only the files use the physical names, and Iceberg uses the ids."},
  {"label": "RENAME COLUMN", "note": "`ALTER TABLE … RENAME COLUMN amount TO net_amount` changes only the logical name in the log. **No file is rewritten.**", "upd": {"1": {"logical name": "net_amount"}}, "hl": [1]},
  {"label": "DROP COLUMN", "note": "`ALTER TABLE … DROP COLUMN status` removes it from the schema; the data stays in old files until they are rewritten.", "del": [2]},
  {"label": "ADD COLUMN", "note": "A new column gets the next id (4). Iceberg readers see the same change in the next snapshot.", "add": [["channel", 4, "col-77d3…"]], "hl": [3]}
 ]}
```

## 🔌 Reading it from an external Spark

On Databricks you only set the table properties. An **external** Spark reads the table as Iceberg through the Unity Catalog Iceberg REST catalog. It needs the Iceberg runtime package and a catalog definition.

```python
# Display only: an open-source Spark outside Databricks
spark = (SparkSession.builder
  .config("spark.jars.packages", "org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:<iceberg-version>,"
                                 "org.apache.iceberg:iceberg-aws-bundle:<iceberg-version>")   # azure or gcp bundle on those clouds
  .config("spark.sql.extensions", "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
  .config("spark.sql.catalog.uc", "org.apache.iceberg.spark.SparkCatalog")
  .config("spark.sql.catalog.uc.type", "rest")
  .config("spark.sql.catalog.uc.uri", "https://<workspace-host>/api/2.1/unity-catalog/iceberg-rest")
  .config("spark.sql.catalog.uc.warehouse", "main")            # one Unity Catalog catalog per Spark catalog
  .config("spark.sql.catalog.uc.token", "<token>")             # or OAuth for a service principal
  .getOrCreate())

spark.sql("SELECT * FROM uc.sales.orders_uf").show()
```

> The principal needs `USE CATALOG`, `USE SCHEMA` and `SELECT` like any reader, and the metastore must allow external data access. An admin sets that up, so this cell is display only. Check the docs for the package versions that match your Spark.

## 🧪 Try it: create a UniForm table

```dataset retail
```

```sql run
-- A Delta table that Iceberg clients can read
CREATE OR REPLACE TABLE uniform_orders
TBLPROPERTIES (
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg',
  'delta.enableDeletionVectors' = 'false'
)
AS SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id <= 1000;
```

```sql run
-- The properties Delta set for you: look for columnMapping and the format settings
SHOW TBLPROPERTIES uniform_orders;
```

```sql run
-- The Iceberg section shows the converted Delta version
DESCRIBE EXTENDED uniform_orders;
```

## Exercise 1: rename without rewriting

Rename `quantity` to `qty` on `uniform_orders`. **Predict** whether the rename adds or removes data files, then check with `DESCRIBE HISTORY` (look at `operation` and `operationMetrics`) and query the new column name.

```sql todo
-- TODO 1: rename the column quantity to qty
-- TODO 2: read the latest history entry
-- TODO 3: SELECT sum(qty) FROM uniform_orders
```

```sql solution
ALTER TABLE uniform_orders RENAME COLUMN quantity TO qty;
DESCRIBE HISTORY uniform_orders LIMIT 1;   -- RENAME COLUMN: a metadata-only commit, no files added or removed
SELECT sum(qty) AS total_qty FROM uniform_orders;
-- Column mapping makes this possible: the Parquet files keep the physical name,
-- and Iceberg keeps the same field id, so Iceberg readers see the rename too.
```

## Exercise 2: upgrade an existing table

Create a normal copy of the orders with deletion vectors **on**, delete a few rows, then upgrade it to UniForm with `REORG`. **Predict** what happens to the deletion vectors, then compare `SHOW TBLPROPERTIES` before and after.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE uniform_legacy with 'delta.enableDeletionVectors' = 'true', from fact_orders (order_id <= 1000)
-- TODO 2: DELETE the TEST orders
-- TODO 3: REORG TABLE uniform_legacy APPLY (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION = 2))
-- TODO 4: SHOW TBLPROPERTIES and DESCRIBE HISTORY
```

```sql solution
CREATE OR REPLACE TABLE uniform_legacy
TBLPROPERTIES ('delta.enableDeletionVectors' = 'true')
AS SELECT order_id, order_date, quantity, status FROM fact_orders WHERE order_id <= 1000;
DELETE FROM uniform_legacy WHERE status = 'TEST';                     -- writes deletion vectors
REORG TABLE uniform_legacy APPLY (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION = 2));
SHOW TBLPROPERTIES uniform_legacy;   -- deletion vectors off, column mapping on, Iceberg enabled
DESCRIBE HISTORY uniform_legacy;     -- REORG rewrote the files that had deletion vectors

-- Clean up when you are done
-- DROP TABLE uniform_orders; DROP TABLE uniform_legacy;
```

## ⚠️ Common mistakes

- ❌ "UniForm converts my table to Iceberg." It stays a Delta table; Iceberg metadata is added next to it.
- ❌ Writing to a UniForm table from an Iceberg engine. Iceberg clients read; writes go through Delta.
- ❌ Expecting the Iceberg view to be updated in the same instant. Metadata is generated after the commit, asynchronously.
- ❌ Turning UniForm on and later trying to drop column mapping. Once enabled it stays.
- ✅ Use `REORG … UPGRADE UNIFORM` on existing tables with deletion vectors instead of setting the properties by hand.

## 🧭 Cheat sheet

| Task | How |
|---|---|
| New UniForm table | `TBLPROPERTIES ('delta.enableIcebergCompatV2'='true', 'delta.universalFormat.enabledFormats'='iceberg')` |
| Existing table | `REORG TABLE t APPLY (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION = 2))` |
| Check it | `SHOW TBLPROPERTIES t`, `DESCRIBE EXTENDED t` |
| External reader | Iceberg REST catalog at `/api/2.1/unity-catalog/iceberg-rest` |
