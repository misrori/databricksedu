---
title: Workspace object permissions
summary: Learn the second permission system next to Unity Catalog. Set the right level on notebooks, folders, compute, SQL warehouses, jobs, dashboards and Genie Agents, and predict when a user can open something but still cannot see its data.
icon: 🗝️
level: Beginner
minutes: 10
group: Identity and administration
tags: [Permissions, ACL, Compute, SQL warehouses, Dashboards]
---
# Workspace object permissions

> Unity Catalog protects data. But notebooks, compute, warehouses, jobs and dashboards are not data: each has its own **permission list** (ACL) inside the workspace.

**The one idea to remember:** object permissions decide what you can **open or run**; Unity Catalog privileges decide what **data** you can touch. A user usually needs **both**.

## 💡 Two permission systems

```viz compare
{"title": "Two checks, two places",
 "items": [
  {"icon": "🗝️", "title": "Workspace object permissions", "sub": "CAN VIEW, CAN RUN, CAN USE, CAN MANAGE…", "color": "amber",
   "points": ["Notebooks, folders, files, compute, warehouses, jobs, dashboards, Genie Agents", "Set per workspace, on each object", "Workspace admins can manage all of them"],
   "foot": "Can I open it? Can I run it?"},
  {"icon": "🛡️", "title": "Unity Catalog privileges", "sub": "USE CATALOG, SELECT, MODIFY…", "color": "purple",
   "points": ["Catalogs, schemas, tables, volumes, functions, models", "Set once, valid in every workspace", "Granted with SQL `GRANT`"],
   "foot": "Which rows and files can I touch?"}
 ]}
```

Permission names look alike, but they never overlap. `CAN MANAGE` on a notebook gives no `SELECT` on the table it reads.

## 📁 Notebooks, folders and files

| Level | Allows |
|---|---|
| **CAN VIEW** | Read the cells, comment |
| **CAN RUN** | Plus attach to compute and run cells |
| **CAN EDIT** | Plus change the cells |
| **CAN MANAGE** | Plus change the permissions, move, delete |

Folders use the same levels, and **objects inherit the permissions of their folder**. Grant on a team folder, not on each notebook. A user with access to one notebook can see the folder name, but not the other objects in it.

```viz tree
{"title": "Inheritance in the workspace tree",
 "root": {"icon": "📁", "label": "/Workspace/Shared/finance", "sub": "finance-analysts: CAN RUN · finance-eng: CAN MANAGE", "color": "navy", "children": [
   {"icon": "📓", "label": "monthly_close.ipynb", "sub": "inherits both grants", "color": "green"},
   {"icon": "📁", "label": "drafts/", "sub": "+ ana@corp.com: CAN EDIT", "color": "amber", "children": [
     {"icon": "📓", "label": "new_forecast.ipynb", "sub": "inherited from both folders", "color": "amber"}
   ]},
   {"icon": "📄", "label": "helpers.py", "sub": "file: same levels as notebooks", "color": "green"}
 ]}}
```

## 🖥️ Compute and SQL warehouses

To run a notebook cell, you need a permission on the **compute** too.

| Object | Level | Allows |
|---|---|---|
| Compute (cluster) | **CAN ATTACH TO** | Attach a notebook and run code |
| | **CAN RESTART** | Plus start, restart, terminate |
| | **CAN MANAGE** | Plus edit, libraries, resize, permissions |
| SQL warehouse | **CAN USE** | Start it and run queries |
| | **CAN MONITOR** | Plus see everyone's queries and monitoring |
| | **CAN MANAGE** / **IS OWNER** | Plus edit, stop, delete, permissions |

Warehouses also have **CAN VIEW** (see the warehouse details). Serverless notebooks need no cluster permission, but your workspace must allow serverless.

## ⚙️ Jobs, dashboards and Genie Agents

| Object | Levels, smallest first | Note |
|---|---|---|
| Lakeflow Job | **CAN VIEW**, **CAN MANAGE RUN**, **IS OWNER**, **CAN MANAGE** | CAN MANAGE RUN: run now, cancel, see logs |
| AI/BI dashboard | **CAN VIEW / CAN RUN**, **CAN EDIT**, **CAN MANAGE** | Publish mode decides whose data access counts |
| Genie Agent (formerly Genie space) | **CAN VIEW**, **CAN RUN**, **CAN EDIT**, **CAN MANAGE** | CAN VIEW is enough to ask; data uses the asker's grants |
| Query, alert | **CAN VIEW**, **CAN RUN**, **CAN EDIT**, **CAN MANAGE** | Alerts: CAN RUN, CAN MANAGE only |

A job has one **owner**. The job runs as its **Run as** identity, which is the owner unless you pick a service principal. Its data access is that identity's Unity Catalog grants, not yours.

## 🔀 Access modes and compute policies

Classic compute has an **access mode**. Unity Catalog needs one of these two:

```viz compare
{"items": [
  {"icon": "👥", "title": "Standard", "sub": "formerly shared", "color": "blue",
   "points": ["Many users at once, isolated from each other", "Each user's own UC privileges apply", "Python, SQL, Scala"],
   "foot": "The default for team compute"},
  {"icon": "👤", "title": "Dedicated", "sub": "formerly single user", "color": "teal",
   "points": ["Assigned to one user or one group", "Runs with that user's or group's privileges", "Python, SQL, Scala, R, ML runtimes"],
   "foot": "For R, ML and special libraries"},
  {"icon": "🚫", "title": "No isolation shared", "sub": "legacy", "color": "red",
   "points": ["❌ No Unity Catalog access", "❌ No isolation between users"],
   "foot": "Do not create new ones"}
 ]}
```

**Compute policies** limit what users can configure. Users without the **Allow unrestricted cluster creation** entitlement can only create compute with the policies they were given access to. By default, every user can use the **Personal Compute** policy.

## 🚦 Both checks must pass

Follow Ben, an analyst, running a query in a shared notebook against `prod.hr.employees`.

```viz flow
{"title": "Ben runs a cell in /Shared/hr/report",
 "nodes": [{"icon": "📓", "title": "Notebook", "sub": "CAN RUN?", "color": "amber"},
           {"icon": "🖥️", "title": "Compute", "sub": "CAN ATTACH TO?", "color": "amber"},
           {"icon": "📚", "title": "Catalog and schema", "sub": "USE CATALOG, USE SCHEMA?", "color": "purple"},
           {"icon": "📋", "title": "Table", "sub": "SELECT?", "color": "purple"},
           {"icon": "✅", "title": "Rows", "sub": "filters and masks applied", "color": "green"}],
 "edges": ["", "", "", ""],
 "steps": [
  {"label": "Open and run", "focus": [0], "note": "The folder gives `hr-analysts` **CAN RUN**, so Ben can open the notebook and run cells. With only CAN VIEW he could read the code, not run it."},
  {"label": "Compute", "focus": [1], "note": "On a classic cluster Ben needs **CAN ATTACH TO**. On a SQL warehouse he would need **CAN USE**. These are still workspace permissions."},
  {"label": "Path to the data", "focus": [2], "note": "Now Unity Catalog takes over. Without `USE CATALOG` and `USE SCHEMA` the query fails with an insufficient privileges error, even though every workspace check passed."},
  {"label": "Table", "focus": [3], "note": "`SELECT` on the table, the schema or the catalog."},
  {"label": "Result", "focus": [4], "note": "Only now are rows read. Two systems, five checks, and any one of them can stop Ben."}
 ]}
```

## 📊 Dashboards: whose data access counts?

When you publish an AI/BI dashboard, you choose how viewers reach the data. Step through three viewers who all have **CAN VIEW / CAN RUN** on the dashboard.

```viz table
{"title": "Who sees data on the published HR dashboard",
 "columns": ["Viewer", "Own SELECT on prod.hr?", "Sees data?"],
 "rows": [["Ana (HR analyst)", "yes", "?"], ["Ben (sales analyst)", "no", "?"], ["Cleo (no dashboard permission)", "yes", "?"]],
 "steps": [
  {"label": "Three viewers", "note": "Ana and Ben have a dashboard permission. Cleo has data access but nobody shared the dashboard with her."},
  {"label": "Share data permissions", "note": "The default. Queries run with the **publisher's** data permissions (or a service principal you pick). Viewers need no grants of their own.",
   "upd": {"0": {"Sees data?": "✅ yes"}, "1": {"Sees data?": "✅ yes, as the publisher"}, "2": {"Sees data?": "❌ cannot open it"}}, "hl": [1]},
  {"label": "Individual data permissions", "note": "Each viewer's **own** Unity Catalog grants apply. Warehouse access still comes from the publisher.",
   "upd": {"0": {"Sees data?": "✅ yes"}, "1": {"Sees data?": "❌ permission error"}, "2": {"Sees data?": "❌ cannot open it"}}, "hl": [1]},
  {"label": "Lesson", "note": "Shared publisher credentials make a dashboard a window onto the publisher's data. Use them only for data every viewer may see, ideally with a service principal that holds just those grants.", "hl": [0, 1, 2]}
 ]}
```

Genie Agents always use the asker's own data permissions; only the warehouse access is embedded.

## 🧪 Try it: your own permissions

```dataset hr
```

You own the `hr` tables, and you own your home folder. Look at both systems from your side.

```sql run
-- Data side: who owns the tables in your schema?
SELECT current_user() AS me, table_name, table_owner
FROM information_schema.tables
WHERE table_schema = current_schema();
```

```python run
# Workspace side: the permission list of your home folder
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
home = f"/Users/{w.current_user.me().user_name}"
try:
    oid = w.workspace.get_status(home).object_id
    acl = w.permissions.get(request_object_type="directories", request_object_id=str(oid))
    for entry in acl.access_control_list or []:
        who = entry.user_name or entry.group_name or entry.service_principal_name
        levels = [(p.permission_level.value, "inherited" if p.inherited else "direct") for p in entry.all_permissions or []]
        print(f"{who:<40} {levels}")
except Exception as e:
    print("Cannot read the folder permissions here:", str(e)[:200])
```

```python run
# SQL warehouses this workspace shows you
try:
    for wh in w.warehouses.list():
        print(f"{wh.name:<40} {wh.state}")
except Exception as e:
    print("Cannot list warehouses here:", str(e)[:200])
```

> Changing ACLs on shared objects, warehouses, compute and policies needs CAN MANAGE or a workspace admin, so the next block is display-only. It shows what a user with **CAN USE** on a warehouse but no grants sees:

```sql
-- Display-only: Ben has CAN USE on the warehouse, but no USE SCHEMA on prod.hr
SELECT * FROM prod.hr.employees;
-- [INSUFFICIENT_PERMISSIONS] Insufficient privileges:
-- User does not have USE SCHEMA on Schema 'prod.hr'.
```

## Exercise 1: build an access matrix

A new team needs access. For each persona and task, decide the **workspace permission** and the **Unity Catalog privileges** needed. Store it as a temporary view `wsp_access_matrix`.

```sql todo
-- TODO: CREATE OR REPLACE TEMP VIEW wsp_access_matrix AS SELECT * FROM VALUES (...)
--       AS t(persona, task, workspace_permission, uc_privileges)
-- 1. Analyst runs the shared notebook /Shared/hr/report on cluster hr-shared
-- 2. On-call engineer must re-run a failed job, but not change it
-- 3. Manager views a dashboard published with individual data permissions
-- 4. SQL user writes ad-hoc queries on warehouse hr-wh against prod.hr
```

```sql solution
CREATE OR REPLACE TEMP VIEW wsp_access_matrix AS
SELECT * FROM VALUES
  ('Analyst',  'Run /Shared/hr/report',      'CAN RUN on notebook (or folder) + CAN ATTACH TO on hr-shared', 'USE CATALOG, USE SCHEMA, SELECT'),
  ('On-call',  'Re-run a failed job',         'CAN MANAGE RUN on the job',                                    'none: the job uses its Run as identity'),
  ('Manager',  'View dashboard (individual)', 'CAN VIEW / CAN RUN on the dashboard',                          'USE CATALOG, USE SCHEMA, SELECT'),
  ('SQL user', 'Ad-hoc queries on hr-wh',     'CAN USE on the warehouse',                                     'USE CATALOG, USE SCHEMA, SELECT')
AS t(persona, task, workspace_permission, uc_privileges);

SELECT * FROM wsp_access_matrix;
```

## Exercise 2: would your colleague see the data?

You give a colleague **CAN RUN** on a notebook that reads your `employees` table. Check the data side: list the grants on `employees`. Predict, then answer in a comment: will their run return rows?

```sql todo
-- TODO 1: list the privileges granted on employees (information_schema.table_privileges)
-- TODO 2: answer: will a colleague with CAN RUN on your notebook get rows? Why?
```

```sql solution
SELECT grantee, privilege_type, inherited_from
FROM information_schema.table_privileges
WHERE table_schema = current_schema() AND table_name = 'employees';
-- Probably only grants you can see, none for your colleague.
-- No: CAN RUN lets them open and run the notebook, but the query runs as THEM.
-- They also need USE CATALOG, USE SCHEMA and SELECT. Sharing a notebook never shares data.

-- Clean up when you are done
-- DROP VIEW IF EXISTS wsp_access_matrix;
```

## ⚠️ Common mistakes

- ❌ "I shared the notebook, so they can see the data." Sharing a notebook never grants Unity Catalog privileges.
- ❌ Granting **CAN MANAGE** on a job so someone can re-run it. **CAN MANAGE RUN** is enough.
- ❌ Publishing a sensitive dashboard with shared publisher credentials. Viewers then see what **you** can see.
- ❌ New compute in **No isolation shared** mode. It cannot reach Unity Catalog.
- ✅ Grant to groups on folders, give the smallest level that does the job, and check both systems.

## 🧭 Cheat sheet

| Someone must… | Workspace permission | Plus in Unity Catalog |
|---|---|---|
| Read a notebook's code | CAN VIEW | nothing |
| Run a notebook on a cluster | CAN RUN + CAN ATTACH TO | grants on the data it reads |
| Query on a SQL warehouse | CAN USE | grants on the data |
| Trigger or cancel a job | CAN MANAGE RUN | nothing: Run as identity counts |
| View a dashboard | CAN VIEW / CAN RUN | grants only with individual data permissions |
| Ask a Genie Agent | CAN VIEW (same as CAN RUN) | grants on the data, always |
