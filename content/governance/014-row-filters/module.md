---
title: Row filters
summary: Attach a boolean SQL function to a table so every query returns only the rows the reader may see. Write filters with columns, constants and mapping tables, know who can set them, how they behave on writes, and how to find them.
icon: 🚦
level: Intermediate
minutes: 12
group: Access control
tags: [Unity Catalog, Row filters, Row-level security, SQL UDF]
---
# Row filters

> A row filter is a SQL function that returns `TRUE` or `FALSE` for each row. Attach it to a table and every read of that table, by anyone, on any tool, keeps only the `TRUE` rows.

**The one idea to remember:** the filter is part of the **table**, not of the query. Nobody can skip it, the owner included, and only the function's own logic decides who sees what.

## 💡 What the engine does with each row

The table `employees` has the filter `country_filter(country)`. An analyst outside `hr_admins` runs `SELECT * FROM employees`.

```viz table
{"title": "SELECT * FROM employees  (row filter: country_filter ON (country))",
 "columns": ["full_name", "country", "salary", "filter returns"],
 "rows": [["Anna Kovacs", "HU", 61200, "?"],
          ["Felix Weber", "DE", 84500, "?"],
          ["Bence Nagy", "HU", 112300, "?"],
          ["Rosa Lopez", null, 47900, "?"],
          ["Tessa Smith", "GB", 58800, "?"]],
 "steps": [
  {"label": "Fetch", "note": "The engine reads rows from the files. The filter is applied as soon as a row is fetched, before joins, aggregates or your `WHERE`."},
  {"label": "Call the function", "note": "For each row, the `country` value is passed to `country_filter`. The rule is `is_account_group_member('hr_admins') OR emp_country = 'HU'`.", "upd": {"0": {"filter returns": "TRUE"}, "1": {"filter returns": "FALSE"}, "2": {"filter returns": "TRUE"}, "3": {"filter returns": "NULL"}, "4": {"filter returns": "FALSE"}}},
  {"label": "NULL counts as no", "note": "`NULL = 'HU'` is NULL, and `FALSE OR NULL` is NULL. A row is kept only on `TRUE`, so NULL drops the row too.", "hl": [3]},
  {"label": "Return", "note": "Only the `TRUE` rows leave the engine. `count(*)`, `avg(salary)` and every dashboard see the filtered table.", "hide": [1, 3, 4]}
 ]}
```

## 🧮 Write, attach, remove

A row filter is a SQL user-defined function that returns `BOOLEAN`. You attach it to an existing table with `ALTER TABLE`, or to a new table with `WITH ROW FILTER`.

```viz code
title: the row filter life cycle
lang: sql
---
CREATE OR REPLACE FUNCTION prod.sec.country_filter(emp_country STRING)
RETURNS BOOLEAN
RETURN is_account_group_member('hr_admins') OR emp_country = 'HU';

ALTER TABLE prod.hr.employees
  SET ROW FILTER prod.sec.country_filter ON (country);

CREATE TABLE prod.hr.contractors (name STRING, country STRING)
  WITH ROW FILTER prod.sec.country_filter ON (country);

ALTER TABLE prod.hr.employees DROP ROW FILTER;
DROP FUNCTION prod.sec.country_filter;
---
1-3 | The function | Any scalar SQL UDF that returns BOOLEAN. Name the parameter differently from the column, so a lookup can never confuse them.
5-6 | Attach | `ON (...)` maps table columns to the function's parameters, in order.
8-9 | At create time | The clause goes after the column list. Rows are filtered from the first insert on.
11 | Remove | Detach the filter **before** you drop the function.
12 | Drop | Changing the rule is just `CREATE OR REPLACE FUNCTION`. No `ALTER TABLE` needed.
```

> One row filter per table. To combine rules, put them in one function.

## 🎛️ The ON list: columns, constants, or nothing

| ON list | Example | Use it for |
|---|---|---|
| One column | `ON (country)` | The usual case |
| Several columns | `ON (country, level)` | Rules that need more than one value |
| Column + constant | `ON (country, 'HU')` | One generic function, a different value per table |
| Empty | `ON ()` | All-or-nothing rules that do not depend on the row |

- Constants may be `STRING`, numeric, `BOOLEAN`, `INTERVAL` or `NULL`.
- Values are cast to the parameter type. Match the types exactly: with ANSI mode off, a failed cast becomes NULL and silently drops the row.
- Every column you pass must be read, so the optimizer cannot prune it. Pass only what the rule needs.

## 🗺️ Mapping tables and definer's rights

Rules that change often belong in a **mapping table**. The function looks the reader up there.

```viz flow
{"title": "SELECT * FROM prod.hr.employees, run by Sam",
 "nodes": [{"icon": "🧑‍💻", "title": "Sam", "sub": "SELECT on employees", "color": "blue"},
           {"icon": "🚦", "title": "dept_filter()", "sub": "owned by sec_admins", "color": "purple"},
           {"icon": "🗺️", "title": "prod.sec.dept_access", "sub": "no grant to Sam", "color": "amber"},
           {"icon": "📋", "title": "Sam's rows", "sub": "only mapped departments", "color": "green"}],
 "edges": ["each row", "lookup", "TRUE / FALSE"],
 "steps": [
  {"label": "Query", "focus": [0, 1], "note": "Sam only needs `SELECT` on the table (and `USE CATALOG`, `USE SCHEMA`). The filter is called for him."},
  {"label": "Definer's rights", "focus": [1, 2], "note": "Filters run with the **definer's** rights. The function reads `dept_access` with its owner's privileges, so Sam needs no grant on it and cannot read or edit it."},
  {"label": "Invoker identity", "focus": [1], "note": "The exception: identity functions such as `session_user()` and `is_account_group_member()` run as the **invoker**. They answer for Sam."},
  {"label": "Result", "focus": [2, 3], "note": "Granting Sam a new department is an `INSERT` into `dept_access`. The function and the table stay the same."}
 ]}
```

```sql
RETURN EXISTS (SELECT 1 FROM prod.sec.dept_access a
               WHERE a.department_id = emp_department_id
                 AND is_account_group_member(a.group_name));
```

The mapping table itself must not have a row filter or mask.

## 🔑 Who can set a filter, who can read

| Task | You need |
|---|---|
| Use the function in a filter | `EXECUTE` on it, plus `USE CATALOG` / `USE SCHEMA` |
| Filter a new table | `CREATE TABLE` on the schema |
| Set or drop on an existing table | Ownership, or `MANAGE` **and** `SELECT` on the table |
| Same statement also changes the schema | Additionally `MODIFY` |
| Read the filtered table | `SELECT` on the table |

Readers need supported compute: a SQL warehouse, serverless, standard access mode (DBR 12.2 LTS+), or dedicated access mode on **DBR 15.4 LTS+** in a serverless-enabled workspace. Older runtimes fail closed: they return no data.

## ⚡ Keep the filter cheap

The function runs for **every row of every query**. A slow filter makes the whole table slow.

```viz compare
{"title": "The same rule, written two ways",
 "items": [
  {"icon": "🐇", "title": "Fast", "sub": "simple deterministic SQL", "color": "green",
   "points": ["`is_account_group_member()` checks first", "Plain comparisons, `CASE`, `IN` lists", "Error-safe expressions like `try_divide`", "One or two input columns"], "foot": "the optimizer can push it into the scan"},
  {"icon": "🐢", "title": "Slow", "sub": "heavy per-row logic", "color": "red",
   "points": ["Python UDFs (only allowed wrapped in a SQL UDF)", "Correlated subqueries into large tables", "Many `AND` conjuncts", "Non-deterministic functions"], "foot": "can also block MERGE on the table"}
 ]}
```

Mapping tables are fine when they are **small**. Databricks still recommends simple `CASE` logic over lookups when the rule allows it.

## ✍️ Writes, sharing and derived tables

| Feature | With a row filter on the table |
|---|---|
| `INSERT` | Allowed. A row you cannot see is still written. A filter is not a constraint. |
| `UPDATE`, `DELETE` | Supported. The filter applies when rows are read, so plan for them to act on visible rows. |
| `MERGE` | Fails if the filter uses nested subqueries, aggregates, windows, `LIMIT` or non-deterministic functions. |
| Time travel, clones | Not supported on the table. |
| Delta Sharing | The table cannot be shared. Share a dynamic view instead. |
| Materialized view, streaming table | Can have its own filter (`WITH ROW FILTER` in the `CREATE`). Refreshes run with the owner's rights. |

On dedicated compute, writes need DBR 16.3+. Below DBR 17.2, `UPDATE`, `DELETE` and `MERGE` fail on partitioned tables whose partition column has a filter.

## 🧪 Try it: filter a copy of employees

```dataset hr
```

You are probably not in `hr_admins`, so the filter applies to you. You are also the owner, which proves that owners are filtered too. Use `DROP TABLE` before `CREATE`: `CREATE OR REPLACE TABLE` would **keep** an existing row filter.

```sql run
-- A generic filter function with a constant in the ON list
DROP TABLE IF EXISTS rf2_employees;
CREATE TABLE rf2_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION rf2_country_is(emp_country STRING, allowed STRING)
RETURNS BOOLEAN
RETURN is_account_group_member('hr_admins') OR emp_country = allowed;

ALTER TABLE rf2_employees SET ROW FILTER rf2_country_is ON (country, 'HU');

SELECT (SELECT count(*) FROM employees)     AS base_table_rows,
       (SELECT count(*) FROM rf2_employees) AS rows_you_see;
```

```sql run
-- Where is the filter recorded? (information_schema.row_filters is in Public Preview)
SELECT table_name, filter_name, filter_col_usage
FROM information_schema.row_filters
WHERE schema_name = current_schema() AND table_name LIKE 'rf2_%';
```

```sql run
-- DESCRIBE TABLE EXTENDED lists the filter in the table details too
DESCRIBE TABLE EXTENDED rf2_employees;
```

```sql run
-- Filter at create time, then insert all 8 departments
CREATE OR REPLACE FUNCTION rf2_only_de(dep_country STRING)
RETURNS BOOLEAN
RETURN is_account_group_member('hr_admins') OR dep_country = 'DE';

DROP TABLE IF EXISTS rf2_departments;
CREATE TABLE rf2_departments (department_id BIGINT, department_name STRING, country STRING)
  WITH ROW FILTER rf2_only_de ON (country);
INSERT INTO rf2_departments SELECT department_id, department_name, country FROM departments;

SELECT * FROM rf2_departments;   -- 8 rows were written, you see only the DE ones
```

## Exercise 1: several columns and a NULL

Make `rf2_ex_employees` and a filter `rf2_ex_cap(emp_country STRING, emp_salary DOUBLE, cap DOUBLE)` that keeps `DE` employees earning **less than** `cap` (and everything for `hr_admins`). Attach it with `ON (country, salary, 60000)`. **Predict** the count, then check it with a plain `WHERE` on `employees`. Then replace the constant with `NULL` and predict again before you run.

```sql todo
-- TODO 1: DROP TABLE IF EXISTS, then copy employees to rf2_ex_employees
-- TODO 2: create rf2_ex_cap and attach it ON (country, salary, 60000)
-- TODO 3: compare count(*) of rf2_ex_employees with employees WHERE country = 'DE' AND salary < 60000
-- TODO 4: drop the filter, attach it ON (country, salary, NULL), count again
```

```sql solution
DROP TABLE IF EXISTS rf2_ex_employees;
CREATE TABLE rf2_ex_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION rf2_ex_cap(emp_country STRING, emp_salary DOUBLE, cap DOUBLE)
RETURNS BOOLEAN
RETURN is_account_group_member('hr_admins') OR (emp_country = 'DE' AND emp_salary < cap);

ALTER TABLE rf2_ex_employees SET ROW FILTER rf2_ex_cap ON (country, salary, 60000);
SELECT (SELECT count(*) FROM rf2_ex_employees) AS filtered,
       (SELECT count(*) FROM employees WHERE country = 'DE' AND salary < 60000) AS expected;   -- equal

ALTER TABLE rf2_ex_employees DROP ROW FILTER;
ALTER TABLE rf2_ex_employees SET ROW FILTER rf2_ex_cap ON (country, salary, NULL);
SELECT count(*) AS filtered_with_null_cap FROM rf2_ex_employees;
-- 0 rows: salary < NULL is NULL, and a NULL result drops the row (unless you are in hr_admins).
```

## Exercise 2: a mapping-table filter

Create `rf2_ex2_access(user_email STRING, department_id BIGINT)` with one row: you and department 3. Write `rf2_ex2_by_dept(emp_department_id BIGINT)` that keeps a row when your email is mapped to its department. Attach it to a copy `rf2_ex2_employees`. **Predict** which `department_id` values you will see after you add department 7, then confirm in `information_schema.row_filters` which column feeds the filter.

```sql todo
-- TODO 1: create rf2_ex2_access and insert (current_user(), 3)
-- TODO 2: rf2_ex2_by_dept with EXISTS on rf2_ex2_access and current_user()
-- TODO 3: DROP TABLE IF EXISTS, copy employees to rf2_ex2_employees, attach ON (department_id)
-- TODO 4: count per department_id, insert (current_user(), 7), count again
-- TODO 5: look up the filter in information_schema.row_filters
```

```sql solution
CREATE OR REPLACE TABLE rf2_ex2_access (user_email STRING, department_id BIGINT);
INSERT INTO rf2_ex2_access VALUES (current_user(), 3);

CREATE OR REPLACE FUNCTION rf2_ex2_by_dept(emp_department_id BIGINT)
RETURNS BOOLEAN
RETURN EXISTS (SELECT 1 FROM rf2_ex2_access a
               WHERE a.user_email = current_user() AND a.department_id = emp_department_id);

DROP TABLE IF EXISTS rf2_ex2_employees;
CREATE TABLE rf2_ex2_employees AS SELECT * FROM employees;
ALTER TABLE rf2_ex2_employees SET ROW FILTER rf2_ex2_by_dept ON (department_id);
SELECT department_id, count(*) AS employees FROM rf2_ex2_employees GROUP BY ALL;   -- only 3

INSERT INTO rf2_ex2_access VALUES (current_user(), 7);
SELECT department_id, count(*) AS employees FROM rf2_ex2_employees GROUP BY ALL;   -- 3 and 7

SELECT table_name, filter_name, filter_col_usage
FROM information_schema.row_filters
WHERE schema_name = current_schema() AND table_name = 'rf2_ex2_employees';     -- department_id

-- Clean up when you are done (drop the tables first: a function cannot go while a filter uses it)
-- DROP TABLE rf2_ex2_employees; DROP TABLE rf2_ex_employees; DROP TABLE rf2_employees; DROP TABLE rf2_departments;
-- DROP TABLE rf2_ex2_access;
-- DROP FUNCTION rf2_ex2_by_dept; DROP FUNCTION rf2_ex_cap; DROP FUNCTION rf2_country_is; DROP FUNCTION rf2_only_de;
```

## ⚠️ Common mistakes

- ❌ A parameter named like the column (`country`) inside a lookup. `m.country = country` compares the mapping table with itself.
- ❌ `CREATE OR REPLACE TABLE` to "reset" a table. The old row filter stays attached.
- ❌ Dropping the function first. Run `DROP ROW FILTER` before `DROP FUNCTION`.
- ❌ Expecting the filter to block `INSERT`. Use a `CHECK` constraint for that.
- ❌ A second `SET ROW FILTER` for a second rule. One filter per table: combine the rules in one function.
- ✅ Simple SQL, `is_account_group_member()`, small mapping tables, matching parameter types.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Attach a filter | `ALTER TABLE t SET ROW FILTER fn ON (col, 'const')` |
| Filter from the first row | `CREATE TABLE t (…) WITH ROW FILTER fn ON (col)` |
| Change the rule | `CREATE OR REPLACE FUNCTION fn …` |
| Remove it | `ALTER TABLE t DROP ROW FILTER` |
| Find filtered tables | `information_schema.row_filters`, `DESCRIBE TABLE EXTENDED t` |
| Share filtered rows | A dynamic view in the share |
