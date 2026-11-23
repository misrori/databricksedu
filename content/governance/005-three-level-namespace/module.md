---
title: The three-level namespace
summary: Read and write every Unity Catalog name with confidence. Learn what catalog, schema and object are each for, pick a catalog design, predict how short names are resolved, quote names that need it, and find any object with information_schema.
icon: 🔤
level: Beginner
minutes: 10
group: Unity Catalog foundations
tags: [Unity Catalog, Namespace, information_schema, Naming]
---
# The three-level namespace

> Every table, view, volume, function and model in Unity Catalog has a name with three parts: `catalog.schema.object`. The same name works in every workspace attached to the metastore.

**The one idea to remember:** a full name like `prod.hr.employees` always means the same object. A short name like `employees` means **whatever your current catalog and schema point to**, so its meaning depends on the session.

## 🌳 Three levels, three jobs

Each level answers a different question. Design them for that question, not for the folder structure you are used to.

```viz tree
{"title": "prod.hr.employees, level by level",
 "root": {"icon": "📚", "label": "catalog: prod", "sub": "the big boundary: environment, team, isolation, storage", "color": "blue", "children": [
   {"icon": "📁", "label": "schema: hr", "sub": "a group of related objects; the usual grant level", "color": "teal", "children": [
     {"icon": "📋", "label": "table: employees", "sub": "prod.hr.employees", "color": "green"},
     {"icon": "👁️", "label": "view: employee_directory", "sub": "prod.hr.employee_directory", "color": "green"},
     {"icon": "📂", "label": "volume: documents", "sub": "/Volumes/prod/hr/documents/", "color": "amber"},
     {"icon": "ƒ", "label": "function: mask_salary", "sub": "prod.hr.mask_salary", "color": "purple"}
   ]},
   {"icon": "🔎", "label": "schema: information_schema", "sub": "read-only views, created automatically", "color": "gray"}
 ]}}
```

- **Catalog**: the unit an admin can bind to workspaces and give its own storage.
- **Schema**: the unit a team usually owns and gets grants on.
- **Object**: the thing people query. A table and a view in the same schema cannot share a name.

## 🏗️ Choosing a catalog design

What should the top level mean? Three common answers:

```viz compare
{"title": "Three ways to cut the catalogs",
 "items": [
  {"icon": "🚦", "title": "Per environment", "sub": "dev.sales.orders, prod.sales.orders", "color": "green",
   "points": ["✅ Same code, only the catalog name changes", "✅ Bind `prod` to the production workspace", "❌ Teams share one catalog per environment"],
   "foot": "The most common choice."},
  {"icon": "🏢", "title": "Per business unit", "sub": "finance.reporting.revenue", "color": "blue",
   "points": ["✅ Each unit owns its catalog and storage", "✅ Clear cost and ownership", "❌ Environments must go into schema names or workspaces"]},
  {"icon": "🥇", "title": "Per medallion layer", "sub": "bronze.sales.orders, gold.sales.orders", "color": "gold",
   "points": ["✅ Easy to grant analysts only `gold`", "❌ One pipeline writes into three catalogs", "❌ Dev and prod still need separating"]}
 ]}
```

Many companies combine two: `prod_finance`, `dev_finance`, with layers as schemas (`prod_finance.silver`). Pick a rule early: renaming catalogs later breaks every job and dashboard that uses full names.

## 🧭 How a short name is resolved

Unity Catalog fills in what you leave out from the **current catalog** and **current schema** of the session. Watch them change.

```viz table
{"title": "One session, statement by statement",
 "columns": ["Statement", "current_catalog()", "current_schema()", "employees means"],
 "rows": [["(session starts)", "workspace default", "default", "<default>.default.employees"]],
 "steps": [
  {"label": "Start", "note": "A new session starts in the **workspace default catalog** and its `default` schema."},
  {"label": "USE CATALOG", "note": "Only the catalog changes. The schema is reset to `default` of the new catalog.", "add": [["USE CATALOG prod", "prod", "default", "prod.default.employees"]], "hl": [1]},
  {"label": "USE SCHEMA", "note": "Now a one-part name lands in `prod.hr`.", "add": [["USE SCHEMA hr", "prod", "hr", "prod.hr.employees"]], "hl": [2]},
  {"label": "Two parts", "note": "`USE dev.hr` sets both at once. A two-part name like `sales.orders` would still take only the catalog from the session.", "add": [["USE dev.hr", "dev", "hr", "dev.hr.employees"]], "hl": [3]},
  {"label": "Full names", "note": "`prod.hr.employees` ignores the session completely. That is why jobs and shared code should use full names.", "hl": [0, 1, 2, 3]}
 ]}
```

`USE SCHEMA` (or its synonym `USE DATABASE`) only changes the schema. Check where you are at any time with `SELECT current_catalog(), current_schema()`.

## 🏠 The default catalog and hive_metastore

When a session starts, the catalog comes from, in order: a `USE CATALOG` in the session, the cluster's Spark config, then the **workspace default catalog** that a workspace admin sets in Admin Settings → Advanced.

- Newer workspaces often default to the **workspace catalog**, named after the workspace.
- Older workspaces default to **`hive_metastore`**: the legacy, per-workspace metastore.
- `hive_metastore` is only two levels deep (`database.table`). Unity Catalog shows it as one more catalog, so its tables are reached as `hive_metastore.sales.orders`.

```sql
-- Display-only: legacy names, and how they look from Unity Catalog
SELECT * FROM sales.orders;                    -- means hive_metastore.sales.orders only if that is the current catalog
SELECT * FROM hive_metastore.sales.orders;     -- always the legacy table, if the workspace still allows legacy access
```

## ✍️ Naming rules and backticks

| Rule | Example |
|---|---|
| Names are stored in **lowercase** | `CREATE TABLE Sales_Orders` creates `sales_orders` |
| No period, space or `/` in a name | `sales.orders` is two names, never one |
| Other special characters need backticks | `` `finance-eu`.reporting.`revenue-2026` `` |
| Quote each part on its own | `` `my-cat`.`my-schema`.t ``, not `` `my-cat.my-schema.t` `` |

Stick to lowercase letters, digits and underscores, and you never need backticks. Column names keep their casing, but lookups ignore case. A name can be up to 255 characters.

## 📂 Volume paths use the same three levels

Files in a volume are addressed by a path that repeats the namespace, with `/Volumes` in front.

```sql
-- Display-only example
LIST '/Volumes/prod/hr/documents/';
SELECT * FROM read_files('/Volumes/prod/hr/documents/2026/contracts.csv', format => 'csv', header => true);
```

- `/Volumes/<catalog>/<schema>/<volume>/<any folders>/<file>`: the first three levels are Unity Catalog names, the rest is a normal folder tree you create.
- The Unity Catalog parts of the path use the stored, lowercase names. Grants still apply: `READ VOLUME` to read, `WRITE VOLUME` to write.

## 🔎 Finding names with information_schema

Every catalog has its own `information_schema` schema. The `system` catalog has one that spans **all** catalogs.

| Where | What it covers |
|---|---|
| `prod.information_schema.tables` | Tables and views in catalog `prod` |
| `prod.information_schema.columns` | Their columns, types and positions |
| `system.information_schema.tables` | Tables and views of every catalog in the metastore |
| `system.information_schema.catalogs` | All catalogs, with owner and comment |

Both only show objects you are allowed to see. Searching `system.information_schema` is the fastest way to answer "where is that table?".

## 🧪 Try it: inspect your names

```dataset hr
```

```sql run
-- Where does this session point to?
SELECT current_catalog(), current_schema();
```

```sql run
-- Tables in your schema, from your catalog's information_schema
SELECT table_catalog, table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema = current_schema()
ORDER BY table_name;
```

```python run
# The same table by its one-part name and by its full name
full = f"`{CATALOG}`.`{SCHEMA}`.employees"
print("unqualified:", spark.sql("SELECT count(*) FROM employees").first()[0])
print("qualified  :", spark.sql(f"SELECT count(*) FROM {full}").first()[0], "<-", full)
```

```sql run
-- A name with a hyphen needs backticks
CREATE OR REPLACE VIEW `ns-dept-headcount` AS
SELECT d.department_name, count(*) AS employees
FROM employees e JOIN departments d USING (department_id)
GROUP BY ALL;

SELECT * FROM `ns-dept-headcount` ORDER BY employees DESC;
```

> The `CATALOG` and `SCHEMA` values in this notebook are quoted with backticks in Python on purpose: a lab catalog name may contain a hyphen.

## Exercise 1: describe a table from the catalog

Without opening the data, list the columns of `employees` with their types and positions. Then **predict**: if you run `USE SCHEMA information_schema` and query `tables` without a filter, which catalog's tables will you see?

```sql todo
-- TODO 1: columns of employees, in order, from information_schema.columns
-- TODO 2: answer the prediction in a comment
```

```sql solution
SELECT column_name, data_type, ordinal_position, is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'employees'
ORDER BY ordinal_position;
-- Only the current catalog's: each catalog's information_schema covers that catalog alone.
-- For all catalogs use system.information_schema.tables.
```

## Exercise 2: one name, many spellings

Write three queries that count rows of the `ns-dept-headcount` view: by its one-part name, by `schema.view`, and by its full three-part name. Which of them would still work after `USE CATALOG system`?

```python todo
# TODO 1: build the one-part, two-part and three-part names (quote every part with backticks)
# TODO 2: run SELECT count(*) on each and print the results
```

```python solution
names = ["`ns-dept-headcount`",
         f"`{SCHEMA}`.`ns-dept-headcount`",
         f"`{CATALOG}`.`{SCHEMA}`.`ns-dept-headcount`"]
for n in names:
    print(f"{n:<60}", spark.sql(f"SELECT count(*) FROM {n}").first()[0])
# After USE CATALOG system only the three-part name still works: the other two
# would be completed with the system catalog (and schema), where the view does not exist.

# Clean up when you are done
# spark.sql("DROP VIEW IF EXISTS `ns-dept-headcount`")
```

## ⚠️ Common mistakes

- ❌ Relying on the current catalog in a scheduled job. A changed workspace default silently points it elsewhere.
- ❌ Using capital letters or hyphens in catalog names. They force backticks everywhere.
- ❌ Quoting the whole name as one: `` `prod.hr.employees` `` is a single name with dots, which is not allowed.
- ❌ Expecting `information_schema` in one catalog to list other catalogs. Use `system.information_schema`.
- ✅ Agree on a catalog design and lowercase, underscore names before the first production table.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See where I am | `SELECT current_catalog(), current_schema()` |
| Switch catalog, schema, or both | `USE CATALOG prod;` `USE SCHEMA hr;` `USE prod.hr;` |
| Quote a special name | `` `finance-eu`.reporting.revenue `` |
| Reach a file | `/Volumes/catalog/schema/volume/path/file` |
| Find a table anywhere | `SELECT * FROM system.information_schema.tables WHERE table_name = 'x'` |
| Use a legacy table | `hive_metastore.database.table` |
