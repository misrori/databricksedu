---
title: Unity Catalog in depth
summary: See Unity Catalog the way an administrator does. Place the account, metastores and workspaces, tell the three admin roles apart, follow how a storage path is authorized and how a query gets temporary credentials, and choose catalog types and workspace bindings.
icon: 🏛️
level: Intermediate
minutes: 14
group: Unity Catalog foundations
tags: [Unity Catalog, Administration, Metastore, Storage, Workspace binding]
---
# Unity Catalog in depth

> Users meet Unity Catalog as `catalog.schema.table`. An administrator meets it as an **account** with metastores, workspaces, cloud credentials and storage paths that must all fit together.

**The one idea to remember:** Unity Catalog lives at the **account** level, not in a workspace. It owns the names, the grants **and** the cloud credentials, so users never touch storage keys: Unity Catalog checks the grant, then hands the compute a short-lived credential for exactly the files it needs.

## 🏢 Account, metastores and workspaces

A Databricks **account** is the top-level object of your company. Admins manage it in the **account console**: identities, workspaces, metastores, billing and system tables.

```viz tree
{"title": "One account, one metastore per region",
 "root": {"icon": "🏢", "label": "Databricks account", "sub": "account console: users, groups, service principals", "color": "navy", "children": [
   {"icon": "🗄️", "label": "metastore: eu-west-1", "sub": "one per region; holds catalogs, credentials, locations", "color": "purple", "children": [
     {"icon": "🖥️", "label": "workspace: data-dev", "sub": "attached to the EU metastore", "color": "teal"},
     {"icon": "🖥️", "label": "workspace: data-prod", "sub": "attached to the EU metastore", "color": "teal"},
     {"icon": "📚", "label": "catalogs dev, prod, …", "sub": "visible from attached workspaces (unless bound)", "color": "blue"}
   ]},
   {"icon": "🗄️", "label": "metastore: us-east-1", "sub": "a separate metastore for the US region", "color": "purple", "children": [
     {"icon": "🖥️", "label": "workspace: us-analytics", "sub": "sees only US catalogs", "color": "teal"}
   ]}
 ]}}
```

- Create **one metastore per region** where you have workspaces. A workspace attaches to exactly one metastore, in its own region.
- Users and groups are defined **once at account level**, then assigned to workspaces. Grants use these account principals.
- Data in another region's metastore is reached with **Delta Sharing**, not by attaching a workspace across regions.

## 👑 Three admin roles

Three different "admins" exist, at three levels. Mixing them up is the most common admin confusion.

```viz compare
{"title": "Who manages what",
 "items": [
  {"icon": "🏢", "title": "Account admin", "sub": "the whole account", "color": "navy",
   "points": ["Uses the account console", "Creates metastores and assigns workspaces to them", "Manages account users, groups, service principals", "Enables system tables, sets account policies"],
   "foot": "Few people. Keep it to a small group."},
  {"icon": "🗄️", "title": "Metastore admin", "sub": "one metastore (optional role)", "color": "purple",
   "points": ["Owns the metastore", "Can create catalogs, credentials, external locations", "Can change owners and grants on any securable", "No data access by default, but can grant it"],
   "foot": "Assign a group, never one person."},
  {"icon": "🖥️", "title": "Workspace admin", "sub": "one workspace", "color": "teal",
   "points": ["Adds users to the workspace, manages compute and policies", "Sets workspace settings such as the default catalog", "Owns the workspace catalog in new workspaces", "No rights on other catalogs by role alone"],
   "foot": "Workspace objects, not the metastore."}
 ]}
```

Data access always comes from **grants and ownership**, not from an admin title. A metastore admin can grant themselves `SELECT`, but that grant is visible in the audit log.

## 🔐 How a storage path is authorized

Two metastore-level objects connect Unity Catalog to cloud storage you own.

```sql
-- Display-only: needs an admin. The storage credential (an IAM role, Azure managed identity
-- or GCP service account) is usually created in Catalog Explorer, then referenced here.
CREATE EXTERNAL LOCATION lake_raw
  URL 's3://acme-lake/raw'
  WITH (STORAGE CREDENTIAL acme_lake_role)
  COMMENT 'Landing zone for raw files';

GRANT READ FILES, CREATE EXTERNAL TABLE ON EXTERNAL LOCATION lake_raw TO `data_engineers`;
GRANT CREATE MANAGED STORAGE ON EXTERNAL LOCATION lake_raw TO `platform_admins`;
```

When someone uses `s3://acme-lake/raw/clicks/`, Unity Catalog finds the external location whose URL **contains** that path, checks the privilege on it, and uses its credential. Once an external table exists, readers need only the table grants (`SELECT`), not `READ FILES`.

## 📦 Managed storage: which level wins

Managed tables and volumes need a place for their files. You can set a **managed location** on the metastore, a catalog or a schema. The most specific one wins.

```viz table
{"title": "Where does CREATE TABLE prod.sales.orders put its files?",
 "columns": ["Level", "Managed location", "Used?"],
 "rows": [["metastore", "s3://acme-root/", "fallback"],
          ["catalog prod", "s3://acme-prod/", "if the schema has none"],
          ["schema prod.sales", "(not set)", "-"]],
 "steps": [
  {"label": "Three levels", "note": "New metastores are often created **without** a root location. Databricks recommends setting managed storage at **catalog** level, so each catalog can live in its own bucket or container."},
  {"label": "Schema has none", "note": "The schema has no location, so the catalog's location is used. Files land under `s3://acme-prod/`.", "upd": {"1": {"Used?": "✅ used"}, "0": {"Used?": "skipped"}}, "hl": [1]},
  {"label": "Schema gets one", "note": "`CREATE SCHEMA prod.sales MANAGED LOCATION 's3://acme-sales/'` (display-only). Now the schema wins for **new** tables. Existing tables are not moved.", "upd": {"2": {"Managed location": "s3://acme-sales/", "Used?": "✅ used"}, "1": {"Used?": "skipped"}}, "hl": [2]},
  {"label": "Rule", "note": "Schema, then catalog, then metastore. The path must sit inside an external location, and setting it needs `CREATE MANAGED STORAGE` on that location.", "hl": [0, 1, 2]}
 ]}
```

## 🎟️ Credential vending: how a query reads files

Users and clusters never hold storage keys. For every read or write, Unity Catalog **vends** a temporary credential, scoped down to the table's path.

```viz flow
{"title": "SELECT * FROM prod.sales.orders (a managed table)",
 "nodes": [
  {"icon": "🖥️", "title": "Compute", "sub": "serverless, warehouse or UC cluster", "color": "blue"},
  {"icon": "🛡️", "title": "Unity Catalog", "sub": "names, grants, locations", "color": "purple"},
  {"icon": "🔑", "title": "Storage credential", "sub": "the cloud identity", "color": "gray"},
  {"icon": "🎟️", "title": "Temporary token", "sub": "short-lived, one path only", "color": "amber"},
  {"icon": "☁️", "title": "Cloud storage", "sub": "the table's files", "color": "green"}
 ],
 "edges": ["asks for the table", "if allowed", "issues", "reads with"],
 "steps": [
  {"label": "Ask", "focus": [0, 1], "note": "The engine sends the table name and the user's identity to Unity Catalog. It does not know where the files are yet."},
  {"label": "Check", "focus": [1], "note": "Unity Catalog checks `USE CATALOG`, `USE SCHEMA` and `SELECT`, then looks up the table's storage path. No grant, no path."},
  {"label": "Assume", "focus": [2], "note": "Unity Catalog uses the storage credential behind that path (the managed storage location or an external location)."},
  {"label": "Vend", "focus": [3], "note": "It creates a **down-scoped, short-lived** credential that works only for the table's directory, and returns it with the path."},
  {"label": "Read", "focus": [4], "note": "The compute reads the files with that token. It cannot list other tables' folders, and the token expires soon after."}
 ]}
```

This is why Unity Catalog needs serverless, a SQL warehouse, or a cluster in **standard** or **dedicated** access mode (formerly shared and single user). Only such compute takes part in this exchange.

## 📚 Catalog types

Not every catalog holds data that Unity Catalog stores itself.

```viz compare
{"items": [
  {"icon": "📚", "title": "Standard", "sub": "CREATE CATALOG prod", "color": "blue",
   "points": ["Managed and external tables, views, volumes, functions, models", "Its own managed location", "The normal case"]},
  {"icon": "🔌", "title": "Foreign", "sub": "Lakehouse Federation", "color": "teal",
   "points": ["Mirrors a database through a **connection**", "PostgreSQL, Snowflake, SQL Server, BigQuery…", "Also a Hive metastore (HMS federation)", "Queries run against the source"]},
  {"icon": "🤝", "title": "Shared", "sub": "from Delta Sharing", "color": "amber",
   "points": ["Created from a share a provider gave you", "Read-only", "Can come from another region or account"]},
  {"icon": "⚙️", "title": "Built-in", "sub": "system, hive_metastore", "color": "gray",
   "points": ["`system`: audit, billing, lineage, `information_schema`", "`hive_metastore`: the workspace's legacy metastore", "Not created by you"]}
 ]}
```

```sql
-- Display-only: admin statements
CREATE CONNECTION pg_sales TYPE postgresql
  OPTIONS (host 'pg.acme.internal', port '5432', user secret('pg', 'user'), password secret('pg', 'password'));
CREATE FOREIGN CATALOG pg_sales_cat USING CONNECTION pg_sales OPTIONS (database 'sales');
CREATE CATALOG partner_sales USING SHARE partner_provider.sales_share;
```

`hive_metastore` is per workspace and outside Unity Catalog governance. **HMS federation** turns it into a foreign catalog, so you can govern and migrate it step by step, then disable legacy access.

## 🔒 Workspace binding and the default catalog

By default a catalog is **OPEN**: every workspace attached to the metastore can reach it, if grants allow. Set it to **ISOLATED** and bind it to chosen workspaces, optionally **read-only**.

```bash
# Display-only: needs a metastore admin or the catalog owner. There is no SQL statement for this.
databricks catalogs update prod --isolation-mode ISOLATED
databricks workspace-bindings update-bindings catalog prod --json '{
  "add": [{"workspace_id": 1111111111, "binding_type": "BINDING_TYPE_READ_WRITE"},
          {"workspace_id": 2222222222, "binding_type": "BINDING_TYPE_READ_ONLY"}]}'
```

- Binding is checked **before** grants: from an unbound workspace, `prod` is unreachable for everyone.
- New workspaces with automatic Unity Catalog get a **workspace catalog**, named after the workspace, bound only to it and owned by its workspace admins.
- The **default catalog** (Admin Settings → Advanced) is what unqualified names use. Older workspaces default to `hive_metastore`.

## 🧪 Try it: look at your metastore

```dataset hr
```

You cannot create metastores or catalogs here, but you can see how they are wired.

```sql run
-- Which metastore, catalog and schema is this session using?
SELECT current_metastore(), current_catalog(), current_schema();
```

```python run
# Catalogs you can see, then the details of your own catalog and schema
display(spark.sql("SHOW CATALOGS"))
for stmt in [f"DESCRIBE CATALOG EXTENDED `{CATALOG}`", f"DESCRIBE SCHEMA EXTENDED `{CATALOG}`.`{SCHEMA}`"]:
    try:
        display(spark.sql(stmt))
    except Exception as e:
        print(stmt, "->", str(e)[:200])
```

```sql run
-- A managed table you own: look at its location
CREATE OR REPLACE TABLE uc_departments AS SELECT * FROM departments;
DESCRIBE DETAIL uc_departments;
```

```python run
# The system catalog: which schemas can you see? (an admin decides which ones you may read)
try:
    display(spark.sql("SHOW SCHEMAS IN system"))
except Exception as e:
    print("No access to the system catalog here:", str(e)[:200])
```

> The `location` of a managed table is a long generated path. You cannot choose it, and you should not read it directly: always go through the table name.

## Exercise 1: which level gave the storage?

Read the `location` of `uc_departments` and the `Location` row of your schema. **Predict** first: did the files land in schema-level, catalog-level or metastore-level managed storage?

```python todo
# TODO 1: get the location of uc_departments from DESCRIBE DETAIL
# TODO 2: get the rows of DESCRIBE SCHEMA EXTENDED for your schema
# TODO 3: print both and decide which managed location was used
```

```python solution
table_loc = spark.sql("DESCRIBE DETAIL uc_departments").first()["location"]
schema_info = {r[0]: r[1] for r in spark.sql(f"DESCRIBE SCHEMA EXTENDED `{CATALOG}`.`{SCHEMA}`").collect()}

print("table :", table_loc)
print("schema:", schema_info.get("Location"))
# Managed paths usually contain __unitystorage/schemas/<id>/ when the schema has its own
# managed location, and __unitystorage/catalogs/<id>/ when the catalog's location was used.
# If neither appears, the metastore root was the fallback.
```

## Exercise 2: inventory the catalogs

An admin asks: which catalogs can you see, and of which type is each? Loop over `SHOW CATALOGS`, run `DESCRIBE CATALOG EXTENDED` on each, and keep the rows that mention a type. Expect some catalogs to refuse you.

```python todo
# TODO 1: list catalog names from SHOW CATALOGS
# TODO 2: for each, run DESCRIBE CATALOG EXTENDED inside try/except
# TODO 3: print the name and every row whose name contains "type"
```

```python solution
for row in spark.sql("SHOW CATALOGS").collect():
    name = row[0]
    try:
        info = spark.sql(f"DESCRIBE CATALOG EXTENDED `{name}`").collect()
        kinds = [f"{r[0]}={r[1]}" for r in info if "type" in r[0].lower()]
        print(f"{name:<30}", ", ".join(kinds) or "(no type row)")
    except Exception as e:
        print(f"{name:<30} no access: {str(e)[:80]}")
# Typical results: your own catalog is a regular catalog, `system` is a system catalog,
# shared and foreign catalogs show their own type. hive_metastore may refuse on serverless.

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS uc_departments")
```

## ⚠️ Common mistakes

- ❌ Creating a second metastore in the same region "for prod". Use separate **catalogs** and workspace binding instead.
- ❌ Making one person the metastore admin or the owner of production catalogs. Use a group.
- ❌ Giving users storage keys or `READ FILES` on a whole bucket to read tables. Grant on tables; Unity Catalog vends the credentials.
- ❌ Expecting a new schema `MANAGED LOCATION` to move existing tables. It only affects new ones.
- ✅ Set managed storage per catalog, bind production catalogs to production workspaces, federate `hive_metastore` to migrate.

## 🧭 Cheat sheet

| I want to… | Where / how |
|---|---|
| Create a metastore, attach a workspace | Account console (account admin) |
| Let Unity Catalog reach a bucket | Storage credential + `CREATE EXTERNAL LOCATION` |
| Choose where managed data goes | `MANAGED LOCATION` on catalog or schema (schema wins) |
| Read an external database or HMS in place | `CREATE CONNECTION` + `CREATE FOREIGN CATALOG` |
| Keep `prod` out of the dev workspace | Isolation mode `ISOLATED` + workspace bindings |
| See where I am | `SELECT current_metastore(), current_catalog()` |
