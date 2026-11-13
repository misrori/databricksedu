---
title: Lakehouse architecture
summary: Why data warehouses and data lakes each fall short, what turns a lake into a lakehouse, and how the Databricks platform is layered from cloud storage up to your workloads.
icon: 🏠
level: Beginner
minutes: 9
group: Lakehouse foundations
tags: [Lakehouse, Architecture, Delta Lake, Unity Catalog, Compute]
---
# Lakehouse architecture

> A lakehouse keeps all data as open files in cheap cloud storage, and adds the two things a plain data lake is missing: **transactions** and **governance**. One copy of the data then serves BI, data engineering and AI.

**The one idea to remember:** a lakehouse is open files in object storage, plus a transaction log that makes them tables, plus a catalog that decides who may use them.

## 🏛️ Warehouse, lake, lakehouse

Each architecture was built to fix the problems of the one before it.

```viz compare
{"title": "Three ways to store analytical data",
 "items": [
  {"icon": "🏛️", "title": "Data warehouse", "sub": "1980s onwards", "color": "blue",
   "points": ["✅ Fast, reliable SQL and BI", "✅ Transactions and a fixed schema", "❌ Structured data only", "❌ Storage and compute are expensive and closed"],
   "foot": "Great for reports, poor for ML and raw data"},
  {"icon": "🌊", "title": "Data lake", "sub": "2010s, Hadoop and S3", "color": "teal",
   "points": ["✅ Cheap storage for any file type", "✅ Open formats, any engine", "❌ No transactions: half-written data is visible", "❌ No updates, weak governance: a data swamp"],
   "foot": "Great for raw data, poor for reliable tables"},
  {"icon": "🏠", "title": "Lakehouse", "sub": "open table formats", "color": "green",
   "points": ["✅ Lake storage and open files", "✅ Warehouse reliability: ACID, schema, DML", "✅ One copy for BI, streaming and AI", "Needs a table format and a catalog"],
   "foot": "The design Databricks is built on"}
 ]}
```

Many companies ran a lake **and** a warehouse, copying data from one to the other. That meant two copies, two security models, and reports that were always a day behind.

## 🧱 What makes a lakehouse

Three ingredients, each solving one problem of the plain lake.

| Ingredient | On Databricks | What it adds |
|---|---|---|
| **Open file format** | Parquet | Columnar, compressed files any engine can read |
| **Transaction log** | Delta Lake (Apache Iceberg is also supported) | ACID commits, versions, `UPDATE` / `MERGE`, schema enforcement |
| **Governance** | Unity Catalog | Names, permissions, lineage and auditing for every table and file |
| **Engines** | Spark, Photon, SQL warehouses | Compute that can be started, scaled and stopped on its own |

The data never moves into a closed system. If you stopped using Databricks tomorrow, your tables would still be Parquet files plus a JSON log in **your** storage.

## 🥞 The Data Intelligence Platform

Databricks stacks its services on top of your cloud storage. Each layer only depends on the ones below it.

```viz layers
{"title": "Databricks Data Intelligence Platform",
 "layers": [
  {"icon": "🧑‍💻", "title": "Workloads", "sub": "what you build", "color": "gold", "items": ["Lakeflow (ingest, pipelines, jobs)", "Databricks SQL and AI/BI", "Machine learning and generative AI"]},
  {"icon": "⚙️", "title": "Compute", "sub": "runs your code", "color": "blue", "items": ["Serverless compute", "Classic clusters", "SQL warehouses"]},
  {"icon": "🛡️", "title": "Unity Catalog", "sub": "governance for data and AI", "color": "purple", "items": ["catalog.schema.table names", "Permissions, lineage, audit"]},
  {"icon": "📜", "title": "Delta Lake", "sub": "table format", "color": "teal", "items": ["Transaction log", "Versions, ACID, DML"]},
  {"icon": "☁️", "title": "Cloud object storage", "sub": "S3, ADLS, GCS", "color": "gray", "items": ["Parquet data files", "Raw files in volumes"]}
 ]}
```

Storage and compute are **separate**. Ten clusters can read the same table, and a stopped cluster costs nothing while the data stays where it is.

## 🎛️ Control plane and compute plane

A Databricks deployment is split in two, and it helps to know which side does what.

| | Control plane | Compute plane |
|---|---|---|
| **Runs in** | The Databricks account | Serverless: Databricks' account. Classic: **your** cloud account |
| **Holds** | Web UI, notebooks, job definitions, cluster manager, Unity Catalog metadata | The machines that execute Spark and SQL |
| **Touches your data?** | No, it stores metadata and decides access | Yes, it reads and writes files in storage |

Your table data lives in cloud object storage, usually in your own cloud account. Unity Catalog stores the **metadata** (names, schemas, permissions), not the rows.

## 🚀 Follow one query

What happens when you run `SELECT * FROM main.sales.orders` in a notebook.

```viz flow
{"title": "From your query to the files and back",
 "nodes": [
  {"icon": "🧑‍💻", "title": "You", "sub": "notebook or SQL editor", "color": "gold"},
  {"icon": "🎛️", "title": "Control plane", "sub": "routes the request", "color": "navy"},
  {"icon": "🛡️", "title": "Unity Catalog", "sub": "name, permission, location", "color": "purple"},
  {"icon": "⚙️", "title": "Compute", "sub": "serverless or classic", "color": "blue"},
  {"icon": "☁️", "title": "Cloud storage", "sub": "Delta log + Parquet", "color": "gray"}
 ],
 "edges": ["send query", "resolve", "allow + credentials", "read files"],
 "steps": [
  {"label": "Submit", "focus": [0, 1], "note": "The notebook sends the query to the compute attached to it. The control plane handles your login and session."},
  {"label": "Resolve the name", "focus": [2], "note": "Unity Catalog turns `main.sales.orders` into a table definition and a storage location, and checks that you have `USE CATALOG`, `USE SCHEMA` and `SELECT`."},
  {"label": "Get credentials", "focus": [2, 3], "note": "If you are allowed, Unity Catalog gives the compute **short-lived credentials** for that table's location only. Users never hold storage keys."},
  {"label": "Read", "focus": [3, 4], "note": "The compute reads the Delta log to find the current files, then reads only the Parquet files and columns the query needs."},
  {"label": "Return", "focus": [3, 0], "note": "Results go back to your notebook. The data files never left your storage; only the result rows travel."}
 ]}
```

## ⚡ Serverless or classic compute

Both run the same Spark and SQL. The difference is who manages the machines.

| | Serverless | Classic |
|---|---|---|
| **Start-up** | Seconds | Minutes (VMs boot in your account) |
| **You configure** | Almost nothing; Databricks picks versions and scales | Runtime version, VM types, workers, init scripts |
| **You pay for** | Usage only, billed by Databricks | Databricks units plus the cloud VMs |
| **Limits** | Little low-level Spark configuration, no RDD APIs | Full control, also GPUs and custom libraries |

Serverless is the default choice for new notebooks, jobs and pipelines. Choose classic when you need control that serverless does not offer.

## 🧪 Try it: is a table really files?

```dataset retail
```

A table in Unity Catalog looks like a database table. Ask it where it lives and what it is made of.

```sql run
-- Which metastore, catalog and schema am I in?
SELECT current_metastore(), current_catalog(), current_schema();
```

```sql run
-- Format, storage location, number of files and size
DESCRIBE DETAIL fact_orders;
```

```sql run
-- Table type (MANAGED), provider (delta) and the full name
DESCRIBE EXTENDED fact_orders;
```

> Look at `format` and `location` in the detail output: a Delta table at a cloud storage path (`s3://`, `abfss://` or `gs://`). The rows are in Parquet files under that path, and `numFiles` tells you how many.

## Exercise 1: one table, two faces

Run a normal business query on `fact_orders`, then predict **before you look** how many versions the table has and which operation created it.

```sql todo
-- TODO 1: revenue per product category for COMPLETED orders (join dim_product, quantity * unit_price)
-- TODO 2: show the history of fact_orders
```

```sql solution
SELECT p.category, round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o JOIN dim_product p USING (product_id)
WHERE o.status = 'COMPLETED'
GROUP BY ALL
ORDER BY revenue DESC;

DESCRIBE HISTORY fact_orders;   -- every write is a version; the first one created the table
```

## Exercise 2: build a gold table and inspect it

Create a small aggregate table from the dataset. Then check that it is just another Delta table in managed storage.

```sql todo
-- TODO 1: create lh_daily_revenue: order_date and revenue for COMPLETED orders
-- TODO 2: show its format, location and numFiles
```

```sql solution
CREATE OR REPLACE TABLE lh_daily_revenue AS
SELECT o.order_date, round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o JOIN dim_product p USING (product_id)
WHERE o.status = 'COMPLETED'
GROUP BY o.order_date;

DESCRIBE DETAIL lh_daily_revenue;   -- format delta, a location under managed storage, a few files

-- Clean up when you are done
-- DROP TABLE lh_daily_revenue;
```

## ⚠️ Common mistakes

- ❌ "Unity Catalog stores my data." It stores metadata and permissions. The files stay in cloud object storage.
- ❌ "A lakehouse is a data lake with a SQL engine on top." Without a transaction log there are no ACID commits, no safe updates and no versions.
- ❌ "Stopping a cluster deletes the data." Compute and storage are separate; tables survive any cluster.
- ✅ Keep one governed copy of the data and point every workload at it, instead of copying into a separate warehouse.
- ✅ Start with serverless compute and move to classic only for a concrete need.

## 🧭 Cheat sheet

| Term | In one line |
|---|---|
| Lakehouse | Open files in object storage + transaction log + governance |
| Delta Lake | The table format: Parquet files plus `_delta_log` |
| Unity Catalog | Names, permissions, lineage and audit for data and AI |
| Control plane | Databricks-side services: UI, jobs, catalog metadata |
| Compute plane | Machines that run your code: serverless or classic |
| `DESCRIBE DETAIL t` | Format, location, file count and size of a table |
