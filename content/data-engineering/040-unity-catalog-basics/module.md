---
title: Unity Catalog basics
summary: Find your way around Unity Catalog: the metastore, catalog, schema and object hierarchy, three-level names, managed and external tables, volumes for files, and the information_schema.
icon: 🗄️
level: Beginner
minutes: 10
group: Lakehouse foundations
tags: [Unity Catalog, Governance, Managed tables, Volumes]
---
# Unity Catalog basics

> Unity Catalog is the single place where Databricks keeps the **names, permissions and storage locations** of all your tables, views, volumes, functions and models. Every query goes through it.

**The one idea to remember:** every object has a three-level name, `catalog.schema.object`, and Unity Catalog decides both **who may use it** and **where its files live**.

## 🌳 The namespace

One **metastore** per cloud region holds everything. Workspaces in that region attach to it, so the same table has the same name in every workspace.

```viz tree
{"title": "The Unity Catalog object hierarchy",
 "root": {"icon": "🗄️", "label": "metastore", "sub": "one per region", "color": "navy", "children": [
   {"icon": "📚", "label": "catalog: main", "sub": "top level, often per environment or team", "color": "blue", "children": [
     {"icon": "📁", "label": "schema: sales", "sub": "a database, groups related objects", "color": "teal", "children": [
       {"icon": "📋", "label": "table / view", "sub": "main.sales.orders", "color": "green"},
       {"icon": "📂", "label": "volume", "sub": "files: /Volumes/main/sales/raw/", "color": "amber"},
       {"icon": "ƒ", "label": "function", "sub": "SQL or Python UDF", "color": "purple"},
       {"icon": "🤖", "label": "registered model", "sub": "MLflow model versions", "color": "pink"}
     ]}
   ]},
   {"icon": "🔑", "label": "storage credential", "sub": "a cloud identity (IAM role, managed identity)", "color": "gray"},
   {"icon": "📍", "label": "external location", "sub": "a cloud path + a credential", "color": "gray"}
 ]}}
```

Tables, views, volumes, functions and models all live **inside a schema**. Credentials and external locations sit at metastore level, because they are about storage, not about one schema.

## 🔤 Three-level names

You can always write the full name. Shorter names are completed from your **current catalog and schema**.

```viz flow
{"title": "How SELECT * FROM orders finds its table",
 "nodes": [
  {"icon": "✍️", "title": "You write", "sub": "orders", "color": "gold"},
  {"icon": "📚", "title": "Current catalog", "sub": "USE CATALOG main", "color": "blue"},
  {"icon": "📁", "title": "Current schema", "sub": "USE SCHEMA sales", "color": "teal"},
  {"icon": "🛡️", "title": "Unity Catalog", "sub": "main.sales.orders", "color": "purple"},
  {"icon": "☁️", "title": "Storage", "sub": "the table's location", "color": "gray"}
 ],
 "edges": ["no catalog given", "no schema given", "look up", "if allowed"],
 "steps": [
  {"label": "One-part name", "focus": [0], "note": "`orders` has no catalog and no schema, so both are filled in. `sales.orders` would only take the catalog, and `main.sales.orders` takes nothing."},
  {"label": "Add the catalog", "focus": [1], "note": "The session's current catalog. Set it with `USE CATALOG main`; check it with `SELECT current_catalog()`."},
  {"label": "Add the schema", "focus": [2], "note": "The current schema, set with `USE SCHEMA sales` (or `USE main.sales` for both at once)."},
  {"label": "Look up and check", "focus": [3], "note": "Unity Catalog finds `main.sales.orders` and checks your privileges: `USE CATALOG` on `main`, `USE SCHEMA` on `sales`, `SELECT` on the table."},
  {"label": "Read", "focus": [4], "note": "Only then does the compute get credentials for the table's storage location. A missing privilege stops the query before any file is read."}
 ]}
```

In jobs and shared code, prefer full names. They do not depend on what the session happens to be set to.

## 🏠 Managed or external table

The difference is **who owns the files**.

```viz compare
{"items": [
 {"icon": "🏠", "title": "Managed table", "sub": "CREATE TABLE t (...)", "color": "green",
  "points": ["Files in managed storage chosen by Unity Catalog", "UC manages metadata **and** files", "Predictive optimization, automatic maintenance", "`DROP TABLE` deletes the data too (`UNDROP` within 7 days)"],
  "foot": "The default. Use it unless you have a reason not to."},
 {"icon": "🔗", "title": "External table", "sub": "CREATE TABLE t (...) LOCATION 's3://…'", "color": "blue",
  "points": ["Files at a path you choose, inside an external location", "UC manages metadata only", "You schedule maintenance yourself", "`DROP TABLE` removes the definition; files stay"],
  "foot": "For data that must stay at a fixed path or is written by other tools."}
]}
```

Both are usually Delta tables and both are governed by the same permissions. `DESCRIBE EXTENDED` shows the `Type` (`MANAGED` or `EXTERNAL`) and the `Location`.

## 🗑️ What DROP TABLE does

Follow one managed and one external table through a `DROP` and a recovery.

```viz table
{"title": "DROP TABLE, side by side",
 "columns": ["What", "Managed table", "External table"],
 "rows": [["Name in Unity Catalog", "main.sales.orders", "main.raw.clicks"],
          ["Data files", "in managed storage", "at s3://lake/raw/clicks/"],
          ["Can you query it?", "yes", "yes"]],
 "steps": [
  {"label": "Before", "note": "Two Delta tables. One has files in managed storage, the other at a path you chose."},
  {"label": "DROP TABLE", "note": "Both names disappear from the catalog at once. The managed table's files are **marked for deletion**; the external files are **not touched**.",
   "upd": {"0": {"Managed table": "dropped (kept 7 days)", "External table": "dropped"}, "1": {"Managed table": "deleted after the retention period", "External table": "untouched"}, "2": {"Managed table": "no", "External table": "no"}}, "hl": [1]},
  {"label": "Recover", "note": "`UNDROP TABLE main.sales.orders` brings the managed table back with its data and history, within 7 days. The external files were never deleted, so you can re-create that table over the same `LOCATION`.",
   "upd": {"0": {"Managed table": "main.sales.orders (undropped)", "External table": "CREATE TABLE … LOCATION …"}, "1": {"Managed table": "in managed storage", "External table": "at s3://lake/raw/clicks/"}, "2": {"Managed table": "yes", "External table": "yes"}}}
 ]}
```

`SHOW TABLES DROPPED` lists what can still be recovered in the current schema.

## 📂 Volumes: governed files

Not everything is a table. CSV drops, JSON exports, images and wheels go into a **volume**: a folder governed by Unity Catalog with the same three-level name.

```sql
CREATE VOLUME IF NOT EXISTS main.sales.landing;          -- managed volume
-- external volume: CREATE EXTERNAL VOLUME … LOCATION 's3://…'  (needs an external location)

LIST '/Volumes/main/sales/landing/';
SELECT * FROM read_files('/Volumes/main/sales/landing/orders.csv', format => 'csv', header => true);
```

- The path is always `/Volumes/<catalog>/<schema>/<volume>/…`. Python, Spark and SQL all use it.
- Access is granted with `READ VOLUME` and `WRITE VOLUME`. Like tables, volumes are **managed** or **external**.

## 🔐 Credentials and external locations

How Unity Catalog reaches storage you own, without handing keys to users.

| Object | What it is | Who creates it |
|---|---|---|
| **Storage credential** | A cloud identity: IAM role, Azure managed identity, GCP service account | Usually an admin |
| **External location** | A storage path plus the credential that can reach it | Usually an admin |
| **External table / volume** | Data at a path inside an external location | Users with `CREATE EXTERNAL TABLE` / `CREATE EXTERNAL VOLUME` on it |
| **Managed storage** | Where a metastore, catalog or schema keeps its managed tables and volumes | Optional `MANAGED LOCATION` on a catalog or schema |

Users never see the credential. Unity Catalog uses it on their behalf, after checking their privileges.

## 🔎 information_schema

Every catalog has a read-only `information_schema` schema of standard SQL views. It only shows objects **you are allowed to see**.

| View | One row per |
|---|---|
| `information_schema.tables` | Table or view, with `table_type` and `data_source_format` |
| `information_schema.columns` | Column, with its type and position |
| `information_schema.table_constraints` | Primary key, foreign key or check constraint |
| `information_schema.volumes` | Volume |

`system.information_schema` has the same views across **all** catalogs of the metastore. Use these views instead of looping over `SHOW` commands.

## 🧪 Try it: explore your schema

```dataset retail
```

```sql run
-- Where am I?
SELECT current_catalog(), current_schema();
```

```sql run
-- Type, provider, owner and location of one table
DESCRIBE EXTENDED fact_orders;
```

```sql run
-- Every table in the schema, with its type, format and key constraints
SELECT t.table_name, t.table_type, t.data_source_format, t.table_owner,
       collect_set(c.constraint_type) AS constraints
FROM information_schema.tables t
LEFT JOIN information_schema.table_constraints c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = current_schema()
GROUP BY ALL
ORDER BY t.table_name;
```

```python run
# Create a managed volume, write a file into it with plain Python, read it with SQL
import os

spark.sql("CREATE VOLUME IF NOT EXISTS uc_files")
vol = f"/Volumes/{CATALOG}/{SCHEMA}/uc_files"
with open(f"{vol}/regions.csv", "w") as f:
    f.write("region,manager\nNorth,Ann\nSouth,Bob\n")

print(os.listdir(vol))
display(spark.sql(f"SELECT * FROM read_files('{vol}/regions.csv', format => 'csv', header => true)"))
```

## Exercise 1: drop and undrop

Create a managed table, drop it, and get it back. **Predict** first: after `UNDROP`, will `DESCRIBE HISTORY` still show the versions from before the drop?

```sql todo
-- TODO 1: create uc_top_customers: the 10 customers with the most orders (customer_id, order_count)
-- TODO 2: drop it, then list the dropped tables of the schema
-- TODO 3: undrop it and show its history
```

```sql solution
CREATE OR REPLACE TABLE uc_top_customers AS
SELECT customer_id, count(*) AS order_count
FROM fact_orders GROUP BY customer_id ORDER BY order_count DESC LIMIT 10;

DROP TABLE uc_top_customers;
SHOW TABLES DROPPED;

UNDROP TABLE uc_top_customers;
DESCRIBE HISTORY uc_top_customers;   -- yes: the data, the table id and the history are all back
```

## Exercise 2: read the catalog, not the docs

Use `information_schema` to answer two questions without opening any table: which columns of `fact_orders` are numeric, and which tables have a foreign key?

```sql todo
-- TODO 1: columns of fact_orders with their data type, in column order
-- TODO 2: tables in your schema that have a FOREIGN KEY constraint
```

```sql solution
SELECT column_name, data_type, ordinal_position
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'fact_orders'
ORDER BY ordinal_position;

SELECT DISTINCT table_name
FROM information_schema.table_constraints
WHERE table_schema = current_schema() AND constraint_type = 'FOREIGN KEY';   -- fact_orders

-- Clean up when you are done
-- DROP TABLE IF EXISTS uc_top_customers;
-- DROP VOLUME IF EXISTS uc_files;
```

## ⚠️ Common mistakes

- ❌ Dropping a **managed** table and expecting the files to stay. They are deleted after the recovery window.
- ❌ Dropping an **external** table to free storage. Only the definition goes; the files remain.
- ❌ Granting `SELECT` on a table but not `USE CATALOG` and `USE SCHEMA`. The user still cannot reach it.
- ✅ Use full three-level names in jobs, so results do not depend on the session's current schema.
- ✅ Put raw files in a volume and refer to them by `/Volumes/...` path, not by a cloud URL with keys.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See where I am | `SELECT current_catalog(), current_schema()` |
| Switch context | `USE CATALOG main;` `USE SCHEMA sales;` |
| Managed or external, and where | `DESCRIBE EXTENDED t` |
| List tables with metadata | `SELECT * FROM information_schema.tables` |
| Recover a dropped managed table | `SHOW TABLES DROPPED;` `UNDROP TABLE t;` |
| Store files | `CREATE VOLUME v;` then `/Volumes/cat/schema/v/...` |
