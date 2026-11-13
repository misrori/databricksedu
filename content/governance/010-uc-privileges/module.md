---
title: Unity Catalog privileges
summary: Predict exactly who can read or change what. Learn the securable hierarchy, how grants inherit down it, why SELECT alone is not enough, and how to grant, revoke and inspect privileges.
icon: 🔑
level: Beginner
minutes: 10
group: Access control
tags: [Unity Catalog, Privileges, GRANT, Security]
---
# Unity Catalog privileges

> In Unity Catalog nobody can see data until someone grants it. Grants are made on **securables** (catalogs, schemas, tables, volumes, functions) and flow **down** the hierarchy.

**The one idea to remember:** to read a table you need a path to it: `USE CATALOG` on the catalog, `USE SCHEMA` on the schema, and `SELECT` on the table or on one of its parents.

## 💡 The securable hierarchy

Every object lives at `catalog.schema.object` under one metastore. A grant on a container applies to everything inside it, **including objects created later**.

```viz tree
{"title": "Where the grants were made",
 "root": {"icon": "🗄️", "label": "metastore", "sub": "one per region; admins manage it", "color": "navy", "children": [
   {"icon": "📚", "label": "prod", "sub": "GRANT USE CATALOG TO hr_analysts", "color": "blue", "children": [
     {"icon": "🗂️", "label": "prod.hr", "sub": "GRANT USE SCHEMA, SELECT TO hr_analysts", "color": "green", "children": [
       {"icon": "📋", "label": "employees", "sub": "SELECT inherited from the schema", "color": "green"},
       {"icon": "📋", "label": "departments", "sub": "SELECT inherited from the schema", "color": "green"},
       {"icon": "🧮", "label": "mask_salary()", "sub": "function: needs EXECUTE to call", "color": "gray"},
       {"icon": "📁", "label": "hr_docs", "sub": "volume: needs READ VOLUME", "color": "gray"}
     ]},
     {"icon": "🗂️", "label": "prod.finance", "sub": "no grant: hr_analysts cannot enter", "color": "red"}
   ]}
 ]}}
```

`SELECT` on the schema covers tables and views, but not the function or the volume. Each object type has its own privileges.

## 🔑 The privileges that matter

| Purpose | Privileges | Granted on |
|---|---|---|
| Get through a container | `USE CATALOG`, `USE SCHEMA` | Catalog, schema |
| Read | `SELECT` (tables, views), `READ VOLUME` (files) | Object or any parent |
| Change | `MODIFY` (insert, update, delete, merge), `WRITE VOLUME` | Object or any parent |
| Create | `CREATE TABLE`, `CREATE FUNCTION`, `CREATE VOLUME`… | Schema (or catalog) |
| Run | `EXECUTE` (functions, models) | Object or any parent |
| Discover, administer | `BROWSE` (see metadata only), `MANAGE` (grant without owning), `ALL PRIVILEGES` | Any level |

`USE CATALOG` and `USE SCHEMA` give **no** data access on their own. They only open the door.

## 🚪 Why SELECT alone is not enough

Follow one analyst running `SELECT * FROM prod.hr.employees` as grants are added one by one.

```viz table
{"title": "Effective access of hr_analysts",
 "columns": ["Grant added", "On", "Result of the query"],
 "rows": [["SELECT", "TABLE prod.hr.employees", "❌ no USE CATALOG on prod"]],
 "steps": [
  {"label": "Only SELECT", "note": "The table grant exists, but the engine checks the path first. Without `USE CATALOG` the analyst cannot even reach the catalog."},
  {"label": "+ USE CATALOG", "note": "The catalog door is open. Now the check fails one level down, at the schema.", "add": [["USE CATALOG", "CATALOG prod", "❌ no USE SCHEMA on prod.hr"]], "upd": {"0": {"Result of the query": "waiting for the path"}}},
  {"label": "+ USE SCHEMA", "note": "With both doors open the existing table grant finally counts. The query returns rows.", "add": [["USE SCHEMA", "SCHEMA prod.hr", "✅ 300 rows"]], "upd": {"1": {"Result of the query": "path: catalog ok"}}},
  {"label": "Lesson", "note": "Three grants, at three levels. Missing **any** of them blocks access. Most \"I granted SELECT but it does not work\" tickets are this.", "hl": [0, 1, 2]}
 ]}
```

## 🔍 How an access check works

Unity Catalog checks every query before it reads a single file. Step through the check.

```viz flow
{"title": "SELECT * FROM prod.hr.employees",
 "nodes": [{"icon": "🧑‍💻", "title": "Principal", "sub": "user + all their groups", "color": "blue"},
           {"icon": "📚", "title": "Catalog", "sub": "USE CATALOG?", "color": "navy"},
           {"icon": "🗂️", "title": "Schema", "sub": "USE SCHEMA?", "color": "purple"},
           {"icon": "📋", "title": "Table", "sub": "SELECT here or above?", "color": "green"},
           {"icon": "🛡️", "title": "Result", "sub": "filters and masks applied", "color": "teal"}],
 "edges": ["", "", "", ""],
 "steps": [
  {"label": "Who is asking", "focus": [0], "note": "The check uses the union of the user's own grants and the grants of every group they belong to. Privileges only add up."},
  {"label": "Catalog", "focus": [1], "note": "Is there `USE CATALOG` on `prod`, for the user or a group? Owners and `ALL PRIVILEGES` holders pass too. If not, stop."},
  {"label": "Schema", "focus": [2], "note": "`USE SCHEMA` on `prod.hr`, granted on the schema or inherited from the catalog."},
  {"label": "Table", "focus": [3], "note": "`SELECT` on the table, **or** on the schema, **or** on the catalog. A grant at any parent level is inherited."},
  {"label": "Read", "focus": [4], "note": "Access is allowed. Row filters and column masks on the table now shape what comes back (see **Row filters and column masks**)."}
 ]}
```

## ⬇️ Where to grant

The level of a grant decides its reach. Grant as high as the need is, and no higher.

```viz compare
{"title": "SELECT granted at three levels",
 "items": [
  {"icon": "📋", "title": "On a table", "sub": "GRANT SELECT ON TABLE prod.hr.departments", "color": "green",
   "points": ["Only that table", "❌ next week's new table is not covered", "Use for one-off, sensitive objects"]},
  {"icon": "🗂️", "title": "On a schema", "sub": "GRANT SELECT ON SCHEMA prod.hr", "color": "blue",
   "points": ["All current **and future** tables and views in it", "✅ the common choice for a team", "Keep secrets in a separate schema"]},
  {"icon": "📚", "title": "On a catalog", "sub": "GRANT SELECT ON CATALOG prod", "color": "purple",
   "points": ["Every table in every schema", "❌ easy to over-share", "Still needs `USE SCHEMA` per schema"]}
 ]}
```

There is **no DENY** in Unity Catalog. Privileges only add up, so you cannot take away at table level what a schema grant gives. Revoke at the level where it was granted, or move sensitive tables to another schema. `DENY` exists only for legacy `hive_metastore` table ACLs.

## 👑 Owners, groups and service principals

- Every securable has one **owner**. The owner has all privileges on it and can grant them. Owners of a parent catalog or schema, holders of `MANAGE`, and metastore admins can grant too.
- Grant to **account groups** (`hr_analysts`), not to people. Joining or leaving a group then changes access without new grants.
- Production jobs run as **service principals**, and production objects should be owned by a group or service principal, not a person.

```sql
GRANT USE CATALOG ON CATALOG prod TO `hr_analysts`;
GRANT USE SCHEMA, SELECT ON SCHEMA prod.hr TO `hr_analysts`;
GRANT MODIFY ON TABLE prod.hr.employees TO `sp-hr-pipeline`;
REVOKE SELECT ON SCHEMA prod.hr FROM `hr_analysts`;
ALTER TABLE prod.hr.employees OWNER TO `hr-data-owners`;
SHOW GRANTS `hr_analysts` ON SCHEMA prod.hr;
```

## 🏢 Beyond grants

- **Workspace binding**: a catalog can be bound to chosen workspaces. `prod` then cannot be reached from the dev workspace, whatever the grants say.
- **`BROWSE`** lets people find tables and request access in Catalog Explorer without reading any data.
- **Workspace objects** (notebooks, dashboards, warehouses, jobs) use their own permission lists such as CAN VIEW or CAN USE. They do not grant data access.

## 🧪 Try it: inspect and change grants

```dataset hr
```

You created the `hr` tables, so you **own** them and can grant on them. Start by looking at what exists.

```sql run
-- Who owns the table, and which grants apply to it?
DESCRIBE TABLE EXTENDED employees;   -- look for the Owner row
SHOW GRANTS ON TABLE employees;
```

```python run
# Grants on your schema (you may not be allowed to see them all in a shared lab)
cat, sch = spark.sql("SELECT current_catalog(), current_schema()").first()
try:
    display(spark.sql(f"SHOW GRANTS ON SCHEMA `{cat}`.`{sch}`"))
except Exception as e:
    print("Cannot list schema grants here:", str(e)[:200])
```

```sql run
-- Grant SELECT on one table to every user of the account, then look again
GRANT SELECT ON TABLE employees TO `account users`;
SHOW GRANTS ON TABLE employees;
```

```sql run
-- The same information in SQL form, then take the grant back
SELECT *
FROM information_schema.table_privileges
WHERE table_schema = current_schema() AND table_name = 'employees';

REVOKE SELECT ON TABLE employees FROM `account users`;
SHOW GRANTS ON TABLE employees;
```

> `account users` is a built-in group that contains everyone in the account. The grant alone does not expose the data: other users would still need `USE CATALOG` and `USE SCHEMA`. Always revoke demo grants, as the last cell does. To grant to your own group, it must already exist at account level.

## Exercise 1: share a safe view

Analysts may see names, levels and countries, but never `national_id` or `salary`. Create a view `priv_employee_directory` without them, grant `SELECT` on the **view** to `account users`, check the grants, then revoke. In a comment: does a user with `SELECT` on the view also need `SELECT` on `employees`?

```sql todo
-- TODO 1: create the view priv_employee_directory (no national_id, no salary)
-- TODO 2: grant SELECT on the view to `account users` and show the grants
-- TODO 3: revoke the grant
```

```sql solution
CREATE OR REPLACE VIEW priv_employee_directory AS
SELECT employee_id, full_name, email, department_id, level, country
FROM employees;

GRANT SELECT ON TABLE priv_employee_directory TO `account users`;   -- views use the TABLE keyword too
SHOW GRANTS ON TABLE priv_employee_directory;

REVOKE SELECT ON TABLE priv_employee_directory FROM `account users`;
-- No: readers need SELECT on the view (plus USE CATALOG and USE SCHEMA).
-- The view owner (you) needs SELECT on employees, readers do not.
```

## Exercise 2: revoke at the right level

Grant `SELECT` on `departments` to `account users`. Then predict: does `REVOKE SELECT ON TABLE employees FROM account users` remove it? Run it, check `information_schema.table_privileges`, then revoke correctly.

```sql todo
-- TODO 1: grant SELECT on departments to `account users`
-- TODO 2: revoke SELECT on employees (the wrong table) and check table_privileges
-- TODO 3: revoke the real grant and check again
```

```sql solution
GRANT SELECT ON TABLE departments TO `account users`;

REVOKE SELECT ON TABLE employees FROM `account users`;   -- nothing to remove: no error, no effect
SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges
WHERE table_schema = current_schema() AND grantee = 'account users';   -- departments is still there

REVOKE SELECT ON TABLE departments FROM `account users`;
SELECT grantee, table_name, privilege_type FROM information_schema.table_privileges
WHERE table_schema = current_schema() AND grantee = 'account users';   -- empty
-- REVOKE only removes a grant made on that exact object.

-- Clean up when you are done
-- DROP VIEW IF EXISTS priv_employee_directory;
```

## ⚠️ Common mistakes

- ❌ Granting `SELECT` on a table and forgetting `USE CATALOG` and `USE SCHEMA`.
- ❌ Granting table by table when the team needs every current and future table: grant on the **schema**.
- ❌ Trying to block one table with `DENY` or a table-level `REVOKE` while a schema grant exists. Restructure instead.
- ❌ A person as owner of production tables. Use a group or service principal.
- ✅ Grant to account groups, use service principals for jobs, check with `SHOW GRANTS`.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Let a group read a whole schema | `GRANT USE CATALOG` on the catalog + `GRANT USE SCHEMA, SELECT ON SCHEMA` |
| Let a pipeline write a table | `GRANT MODIFY ON TABLE … TO <service principal>` |
| Take a privilege away | `REVOKE … ON <same level> FROM …` |
| See grants | `SHOW GRANTS ON TABLE t`, `SHOW GRANTS <principal> ON SCHEMA s` |
| Query grants with SQL | `information_schema.table_privileges` |
| Hand over an object | `ALTER TABLE t OWNER TO <group>` |
