---
title: Row filters and column masks
summary: Keep one table and let every user see only the rows and values they are allowed to. Write filter and mask functions, attach them, see how the engine applies them, and know when ABAC policies take over.
icon: 🎭
level: Intermediate
minutes: 12
group: Access control
tags: [Unity Catalog, Row filters, Column masks, ABAC, PII]
---
# Row filters and column masks

> Grants decide **whether** someone can read a table. Row filters and column masks decide **which rows** and **which values** they get back, from the same table and the same query.

**The one idea to remember:** a filter or mask is a SQL function attached to the table. At query time the engine **rewrites** every query to call it, for every user, on every tool.

## 💡 One table, two people

An HR admin and an analyst run the same `SELECT * FROM employees`. Step through what each one gets.

```viz table
{"title": "SELECT * FROM employees",
 "columns": ["full_name", "country", "salary", "national_id"],
 "rows": [["Anna Kovacs", "HU", 61200, "412-55-7310"],
          ["Felix Weber", "DE", 84500, "233-18-4402"],
          ["Ines Garcia", "ES", 47900, "671-90-1185"],
          ["Bence Nagy", "HU", 112300, "508-23-9967"],
          ["Tessa Smith", "GB", 58800, "145-66-2051"]],
 "steps": [
  {"label": "HR admin", "note": "A member of `hr_admins` sees every row and every real value. The functions on the table return the data unchanged for this group."},
  {"label": "Analyst: row filter", "note": "The analyst may only see Hungarian employees. The row filter returns FALSE for other countries, so those rows never leave the engine.", "hide": [1, 2, 4]},
  {"label": "Analyst: masks", "note": "The salary mask returns NULL and the national id mask keeps only the last four characters. The column names and types stay the same.", "upd": {"0": {"salary": null, "national_id": "***-**-7310"}, "3": {"salary": null, "national_id": "***-**-9967"}}},
  {"label": "Same query", "note": "Nobody changed the query or used a different table. Dashboards, notebooks, Genie and BI tools all get the same treatment.", "hl": [0, 3]}
 ]}
```

## 🪟 Three ways to do it

```viz compare
{"title": "Fine-grained access in Unity Catalog",
 "items": [
  {"icon": "🪞", "title": "Dynamic view", "sub": "the older way", "color": "gray",
   "points": ["`CASE WHEN is_account_group_member(…)` inside a view", "Users get the view, never the table", "❌ one view per rule, easy to bypass via the table", "✅ still the way to share filtered data externally"]},
  {"icon": "🎭", "title": "Row filter and column mask", "sub": "attached to the table", "color": "blue",
   "points": ["Function set with `ALTER TABLE`", "✅ applies to every query on the table", "✅ no second object to keep in sync", "❌ attached table by table"], "foot": "one table, one rule"},
  {"icon": "🏷️", "title": "ABAC policy", "sub": "driven by governed tags", "color": "purple",
   "points": ["Policy on a catalog, schema or table", "Matches tagged tables and columns", "✅ new tagged tables are covered automatically", "✅ one rule for hundreds of tables"], "foot": "rules that follow classification"}
 ]}
```

## 🧮 Writing a mask and a filter

Both are SQL user-defined functions in Unity Catalog. A **mask** takes the column value and returns what this user may see. A **row filter** returns a **boolean**: rows with `TRUE` are kept.

```viz code
title: masks and filters on prod.hr.employees
lang: sql
---
CREATE OR REPLACE FUNCTION prod.sec.mask_national_id(national_id STRING)
RETURNS STRING
RETURN CASE
  WHEN is_account_group_member('hr_admins') THEN national_id
  ELSE concat('***-**-', right(national_id, 4))
END;

ALTER TABLE prod.hr.employees
  ALTER COLUMN national_id SET MASK prod.sec.mask_national_id;

CREATE OR REPLACE FUNCTION prod.sec.country_filter(country STRING)
RETURNS BOOLEAN
RETURN is_account_group_member('hr_admins') OR country = 'HU';

ALTER TABLE prod.hr.employees SET ROW FILTER prod.sec.country_filter ON (country);
---
1-2 | Signature | The mask receives the column value and returns the **same type**, so queries and tools keep working.
3-6 | The rule | Checked per query against the **current user's** account groups. Members see the real value, everyone else the last four characters.
8-9 | Attach the mask | Only the table owner (or someone with `MANAGE`) can do this. Each column holds at most one mask.
11-13 | Row filter | Must return a boolean. The table column is passed in by the `ON (...)` list.
15 | Attach the filter | One row filter per table. `DROP ROW FILTER` and `ALTER COLUMN … DROP MASK` remove them.
```

## ⚙️ What the engine does at query time

The functions are not copies of data. They are injected into the query plan.

```viz flow
{"title": "SELECT full_name, national_id FROM prod.hr.employees",
 "nodes": [{"icon": "🧑‍💻", "title": "Query", "sub": "written by the user", "color": "blue"},
           {"icon": "🛡️", "title": "Unity Catalog", "sub": "privileges + policies", "color": "purple"},
           {"icon": "✏️", "title": "Rewritten plan", "sub": "filter and mask added", "color": "amber"},
           {"icon": "⚙️", "title": "Execution", "sub": "reads the files", "color": "teal"},
           {"icon": "📋", "title": "Result", "sub": "only allowed data", "color": "green"}],
 "edges": ["resolve", "inject", "run", ""],
 "steps": [
  {"label": "Resolve", "focus": [0, 1], "note": "The engine asks Unity Catalog for the table. The answer includes the privileges check **and** the attached filter and masks."},
  {"label": "Rewrite", "focus": [1, 2], "note": "The plan becomes, in effect, `SELECT full_name, mask_national_id(national_id) FROM employees WHERE country_filter(country)`. The user cannot remove it."},
  {"label": "Execute", "focus": [2, 3], "note": "The filter runs during the scan, so blocked rows are dropped early. Simple SQL functions keep this fast; heavy logic slows every query."},
  {"label": "Return", "focus": [3, 4], "note": "The result has the usual columns. The table owner is filtered too, unless the function lets the owner's group through."}
 ]}
```

## 🧑‍🤝‍🧑 Who is asking?

| Function | Tells you | Use for |
|---|---|---|
| `is_account_group_member('g')` | TRUE if the user is in account group `g` | Most rules (recommended) |
| `current_user()` | The user's email (or service principal id) | Per-person rules, mapping tables |
| `is_member('g')` | TRUE if the user is in workspace-local group `g` | Legacy setups only |

For many groups and values, keep the rules in a **mapping table** and look them up in the function:

```sql
RETURN EXISTS (SELECT 1 FROM prod.sec.country_access m
               WHERE m.country = emp_country AND is_account_group_member(m.group_name));
```

Changing access is then an `INSERT` into the mapping table, not a new function.

## 🏷️ ABAC: policies instead of per-table work

With hundreds of tables, attaching masks one by one does not scale, and a forgotten table is a leak. **Attribute-based access control** attaches a policy high in the hierarchy and lets **governed tags** decide where it applies.

```sql
ALTER TABLE prod.hr.employees ALTER COLUMN national_id SET TAGS ('pii' = 'national_id');

CREATE POLICY mask_national_ids
ON CATALOG prod
COLUMN MASK prod.sec.mask_national_id
TO `account users` EXCEPT `hr_admins`
FOR TABLES
MATCH COLUMNS has_tag_value('pii', 'national_id') AS c
ON COLUMN c;
```

Any column tagged `pii = national_id`, in any current or future table of `prod`, is masked. Policies need `MANAGE` on the securable and `EXECUTE` on the function, and queries need serverless or Databricks Runtime 16.4+. Policies on the whole metastore and ABAC `DENY` policies are still in Beta.

## 🚧 Limits to know

- One **row filter** per table and one **mask** per column. Combine rules inside the function.
- Filters and masks **do not grant** anything. Users still need `SELECT` on the table.
- The **owner is filtered too**, unless the function says otherwise.
- A table with a row filter or mask **cannot be shared directly** with Delta Sharing. Share a dynamic view.
- With ABAC, column tags are **not inherited** from the table, so `MATCH COLUMNS` only sees columns that carry the tag themselves.

## 🧪 Try it: protect a copy of employees

```dataset hr
```

Work on a private copy, so the dataset tables stay untouched. You are probably not in `hr_admins` or `admins`, so you will see the restricted version.

```sql run
-- A copy to protect, and the two policy functions
DROP TABLE IF EXISTS rf_employees;
CREATE TABLE rf_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION rf_mask_national_id(national_id STRING)
RETURNS STRING
RETURN CASE WHEN is_account_group_member('hr_admins') THEN national_id
            ELSE concat('***-**-', right(national_id, 4)) END;

CREATE OR REPLACE FUNCTION rf_only_my_country(country STRING)
RETURNS BOOLEAN
RETURN country = 'HU' OR is_account_group_member('admins');
```

```sql run
-- Attach both and query the table as yourself
ALTER TABLE rf_employees SET ROW FILTER rf_only_my_country ON (country);
ALTER TABLE rf_employees ALTER COLUMN national_id SET MASK rf_mask_national_id;

SELECT country, count(*) AS employees, min(national_id) AS sample_national_id
FROM rf_employees
GROUP BY country;
```

```sql run
-- Remove them: the same query now shows every country and real ids
ALTER TABLE rf_employees DROP ROW FILTER;
ALTER TABLE rf_employees ALTER COLUMN national_id DROP MASK;

SELECT country, count(*) AS employees, min(national_id) AS sample_national_id
FROM rf_employees
GROUP BY country;
```

> You own `rf_employees` and still got filtered results. Filters and masks apply to the owner as well. Only the function logic lets someone through.

## Exercise 1: salary bands for everyone else

Analysts may see salaries only rounded down to the nearest 10,000 (a generalization). Members of `hr_admins` see the exact value. Make a copy `rf_ex_employees`, write a mask `rf_salary_band`, attach it to `salary`, and predict how `avg(salary)` per `level` changes for you.

```sql todo
-- TODO 1: copy employees into rf_ex_employees (DROP TABLE IF EXISTS first)
-- TODO 2: mask function rf_salary_band(salary DOUBLE) RETURNS DOUBLE
-- TODO 3: attach it to the salary column and compare avg(salary) per level with employees
```

```sql solution
DROP TABLE IF EXISTS rf_ex_employees;
CREATE TABLE rf_ex_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION rf_salary_band(salary DOUBLE)
RETURNS DOUBLE
RETURN CASE WHEN is_account_group_member('hr_admins') THEN salary
            ELSE CAST(floor(salary / 10000) * 10000 AS DOUBLE) END;

ALTER TABLE rf_ex_employees ALTER COLUMN salary SET MASK rf_salary_band;

SELECT e.level, round(avg(e.salary)) AS exact_avg, round(avg(m.salary)) AS masked_avg
FROM employees e JOIN rf_ex_employees m ON e.employee_id = m.employee_id
GROUP BY e.level;
-- masked_avg is lower: the mask runs before the aggregation, on every row.
```

## Exercise 2: a mapping table

Hard-coded countries do not scale. Create `rf_country_access(user_email, country)` with one row: your own user and `DE`. Write a row filter `rf_by_mapping` that looks you up there, attach it to a copy `rf_ex2_employees`, and query. Then add `HU` for yourself and query again **without** touching the table or the function.

```sql todo
-- TODO 1: create rf_country_access and insert (current_user(), 'DE')
-- TODO 2: row filter function rf_by_mapping(emp_country STRING) using EXISTS on the mapping table
-- TODO 3: copy employees to rf_ex2_employees, attach the filter, count per country
-- TODO 4: insert (current_user(), 'HU') and count again
```

```sql solution
DROP TABLE IF EXISTS rf_ex2_employees;   -- detach the old filter first when you re-run
CREATE OR REPLACE TABLE rf_country_access (user_email STRING, country STRING);
INSERT INTO rf_country_access SELECT current_user(), 'DE';

CREATE OR REPLACE FUNCTION rf_by_mapping(emp_country STRING)
RETURNS BOOLEAN
RETURN EXISTS (SELECT 1 FROM rf_country_access m
               WHERE m.country = emp_country AND m.user_email = current_user());

CREATE TABLE rf_ex2_employees AS SELECT * FROM employees;
ALTER TABLE rf_ex2_employees SET ROW FILTER rf_by_mapping ON (country);
SELECT country, count(*) FROM rf_ex2_employees GROUP BY country;   -- only DE

INSERT INTO rf_country_access SELECT current_user(), 'HU';
SELECT country, count(*) FROM rf_ex2_employees GROUP BY country;   -- DE and HU
-- The parameter is called emp_country, not country, so it cannot be confused with m.country.

-- Clean up when you are done
-- DROP TABLE rf_ex2_employees; DROP TABLE rf_ex_employees; DROP TABLE rf_employees; DROP TABLE rf_country_access;
-- DROP FUNCTION rf_by_mapping; DROP FUNCTION rf_salary_band; DROP FUNCTION rf_mask_national_id; DROP FUNCTION rf_only_my_country;
```

## ⚠️ Common mistakes

- ❌ One redacted copy of the table per audience. It drifts and multiplies grants.
- ❌ A row filter that returns a string or a number. It must return a boolean.
- ❌ Expecting the owner to see everything. Owners are filtered too.
- ❌ `DENY SELECT ON COLUMN`. Unity Catalog has no column deny: use a mask.
- ❌ Sharing a masked table with Delta Sharing. Share a dynamic view instead.
- ✅ `is_account_group_member()` in the function, mapping tables for many rules, ABAC for many tables.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Hide rows | `ALTER TABLE t SET ROW FILTER fn ON (col)` |
| Hide or redact a column | `ALTER TABLE t ALTER COLUMN c SET MASK fn` |
| Remove them | `ALTER TABLE t DROP ROW FILTER`, `ALTER COLUMN c DROP MASK` |
| Check the group of the user | `is_account_group_member('group')` |
| Same rule on many tables, now and later | ABAC policy with governed tags |
| Share filtered data externally | Dynamic view in a share |
