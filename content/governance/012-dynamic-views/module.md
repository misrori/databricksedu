---
title: Dynamic views
summary: Build a view whose result depends on who runs it. Filter rows and mask columns with group checks and an entitlement table, grant it safely, and know when a dynamic view is still the right tool.
icon: 🪞
level: Intermediate
minutes: 12
group: Access control
tags: [Unity Catalog, Dynamic views, Row-level security, Column masking, Delta Sharing]
---
# Dynamic views

> A normal view returns the same rows to everyone. A **dynamic view** asks "who is running me?" inside its SQL, so two people who run the same `SELECT` get different rows and different values.

**The one idea to remember:** readers get `SELECT` on the **view only**. The view reads the base tables with its **owner's** privileges, but checks the identity of the **reader**.

## 💡 One view, two readers

Rita is in `hr_admins`. Sam is an analyst who may see only Sales and Marketing. Both run `SELECT * FROM hr_secure.employees_v`.

```viz table
{"title": "SELECT * FROM hr_secure.employees_v",
 "columns": ["full_name", "department", "salary", "national_id"],
 "rows": [["Anna Kovacs", "Engineering", 61200, "412-55-7310"],
          ["Felix Weber", "Sales", 84500, "233-18-4402"],
          ["Ines Garcia", "Support", 47900, "671-90-1185"],
          ["Jonas Fischer", "Marketing", 58800, "145-66-2051"],
          ["Olga Novak", "Sales", 112300, "508-23-9967"]],
 "steps": [
  {"label": "Rita (hr_admins)", "note": "`is_account_group_member('hr_admins')` is TRUE for Rita, so the WHERE clause keeps every row and the CASE expressions return the real values."},
  {"label": "Sam: the WHERE clause", "note": "For Sam the group check is FALSE. The view looks Sam up in an entitlement table, finds Sales and Marketing, and drops the other rows.", "hide": [0, 2]},
  {"label": "Sam: the CASE expressions", "note": "The salary column becomes NULL and the national id keeps only its last four characters. The column names and types do not change.", "upd": {"1": {"salary": null, "national_id": "***-**-4402"}, "3": {"salary": null, "national_id": "***-**-2051"}, "4": {"salary": null, "national_id": "***-**-9967"}}},
  {"label": "Same SQL, same view", "note": "Nothing was copied. The view text is identical for both. Only the answer of the identity functions changed.", "hl": [1, 3, 4]}
 ]}
```

## 🧑 The identity functions

A dynamic view is an ordinary `CREATE VIEW`. What makes it dynamic is one of these functions in its SQL. They are evaluated for the **person running the query**, not for the view owner.

| Function | Returns | Use it for |
|---|---|---|
| `is_account_group_member('g')` | TRUE if the reader is in account group `g` | Most rules (recommended) |
| `current_user()` / `session_user()` | The reader's email, or a service principal's id | Per-person rules, entitlement tables |
| `is_member('g')` | TRUE if the reader is in **workspace-local** group `g` | Legacy only |

- `is_member()` does not see account-level groups. Databricks advises against it for Unity Catalog data.
- `current_user()` is an alias of `session_user()`. Newer docs prefer `session_user()`. Both work.

## 🧮 Anatomy of a combined view

Row rules go in the `WHERE` clause. Column rules go in `CASE` expressions in the select list. One view can do both, and it can join several tables.

```viz code
title: prod.hr_secure.employees_v
lang: sql
---
CREATE OR REPLACE VIEW prod.hr_secure.employees_v AS
SELECT e.employee_id, e.full_name, d.department_name,
  CASE WHEN is_account_group_member('hr_admins') THEN e.salary END AS salary,
  CASE WHEN is_account_group_member('hr_admins') THEN e.national_id
       ELSE concat('***-**-', right(e.national_id, 4)) END AS national_id
FROM prod.hr.employees e
JOIN prod.hr.departments d ON d.department_id = e.department_id
WHERE is_account_group_member('hr_admins')
   OR EXISTS (SELECT 1 FROM prod.sec.dept_access a
              WHERE a.department_id = e.department_id
                AND is_account_group_member(a.group_name));

GRANT SELECT ON TABLE prod.hr_secure.employees_v TO `hr_analysts`;
---
1 | A plain view | No special keyword. Any view that calls an identity function is a dynamic view.
3 | Column rule: hide | `CASE` without `ELSE` returns NULL. Keep the alias so the column name stays the same.
4-5 | Column rule: redact | Return a value of the same type, so dashboards and joins keep working.
6-7 | Two tables | A view can join and reshape. Readers never need access to either table.
8 | Row rule: bypass | Admins see every row. Put the cheap group check first.
9-11 | Row rule: entitlements | Other readers see a row only if one of their groups is mapped to its department.
13 | Grant the view | Readers get the view. They get **nothing** on `prod.hr` or `prod.sec`.
```

## 🗺️ Rules in a table, not in the SQL

Hard-coded group names mean a new view version for every change. An **entitlement table** moves the rules into data.

| group_name | department_id |
|---|---|
| `sales_analysts` | 3 |
| `sales_analysts` | 4 |
| `finance_analysts` | 5 |

- Giving a group a new department is an `INSERT`. The view does not change.
- Use `EXISTS`, not a `JOIN`. A join returns one copy of the row **per matching rule**, so a duplicate entitlement doubles the reader's numbers.
- Readers need no grant on the entitlement table. The view owner reads it, so only stewards can change who sees what.

## 🔐 Whose privileges does the view use?

Unity Catalog checks two different people when a dynamic view runs. Step through Sam's query.

```viz flow
{"title": "Sam runs SELECT * FROM prod.hr_secure.employees_v",
 "nodes": [{"icon": "🧑‍💻", "title": "Sam", "sub": "SELECT on the view only", "color": "blue"},
           {"icon": "🪞", "title": "employees_v", "sub": "owned by hr_stewards", "color": "purple"},
           {"icon": "🔑", "title": "Owner's rights", "sub": "SELECT on base tables", "color": "amber"},
           {"icon": "📋", "title": "prod.hr.employees", "sub": "no grant to Sam", "color": "gray"},
           {"icon": "📋", "title": "Result", "sub": "Sam's rows and values", "color": "green"}],
 "edges": ["SELECT on view?", "expand", "read", "filter + mask"],
 "steps": [
  {"label": "Check the reader", "focus": [0, 1], "note": "Sam needs `USE CATALOG`, `USE SCHEMA` and `SELECT` on the **view**. That is all."},
  {"label": "Check the owner", "focus": [1, 2], "note": "The view body is checked against the **view owner's** privileges. If the owner loses `SELECT` on a base table, the view fails for everyone."},
  {"label": "Read the base table", "focus": [2, 3], "note": "The base table is read on the owner's behalf. Sam never touches it directly."},
  {"label": "Evaluate for Sam", "focus": [3, 4], "note": "The identity functions still answer for **Sam**. This split is what makes the view safe and personal at the same time."},
  {"label": "The bypass", "focus": [0, 3], "note": "If Sam is ever granted `SELECT` on `prod.hr.employees` (for example through a schema-wide grant), `SELECT * FROM prod.hr.employees` returns everything. The view protects nothing any more."}
 ]}
```

> Put base tables and secure views in **different schemas**. Then a `SELECT ON SCHEMA prod.hr_secure` grant can never leak the raw tables.

## ⚖️ Dynamic view or row filter?

Row filters and column masks sit on the table itself, so nobody can go around them. Dynamic views are a separate object. Each wins in different places.

```viz compare
{"title": "Pick the tool by what the reader should get",
 "items": [
  {"icon": "🪞", "title": "Dynamic view", "sub": "a new object over the data", "color": "purple",
   "points": ["✅ Delta Sharing of filtered data", "✅ joins, aggregates, renamed or dropped columns", "✅ a curated subset for one audience", "❌ bypassed if readers also get the base table"], "foot": "reshape and expose"},
  {"icon": "🎭", "title": "Row filter / column mask", "sub": "attached to the table", "color": "blue",
   "points": ["✅ every query on the table is covered", "✅ no second object to grant and maintain", "❌ a table with a filter cannot be shared directly", "❌ no reshaping: same columns, same grain"], "foot": "protect in place"},
  {"icon": "🏷️", "title": "ABAC policy", "sub": "driven by governed tags", "color": "teal",
   "points": ["✅ one rule for many tables, including future ones", "✅ table owners cannot override it", "❌ needs governed tags and a tagging process"], "foot": "protect at scale"}
 ]}
```

For Delta Sharing, a shared dynamic view can also use `current_recipient('property')` to filter by **recipient** instead of by user.

## 🚧 Requirements and limits

- **Compute:** SQL warehouses, serverless, and standard access mode clusters read dynamic views. Dedicated (single user) clusters need **Databricks Runtime 15.4 LTS+** and a workspace with serverless enabled, because the filtering runs on serverless compute. Older dedicated clusters cannot read them.
- **Read only:** you cannot `INSERT`, `UPDATE` or `MERGE` through a view.
- **Performance:** a `CASE` on a group check is cheap. Correlated lookups in a big entitlement table cost time on every query.
- **Governance debt:** one view per audience multiplies objects. If the rule is the same for every reader of a table, a row filter is simpler.

## 🧪 Try it: a view that knows who you are

```dataset hr
```

You are probably not in `hr_admins`, so you will see the restricted side. First, ask the identity functions about yourself.

```sql run
-- A private copy, and who am I?
CREATE OR REPLACE TABLE dv_employees AS SELECT * FROM employees;

SELECT current_user()                        AS me,
       is_account_group_member('hr_admins')  AS in_hr_admins,
       is_account_group_member('admins')     AS in_workspace_admins;
```

```sql run
-- Column level: mask salary and national_id for everyone outside hr_admins
CREATE OR REPLACE VIEW dv_employees_masked AS
SELECT employee_id, full_name, department_id, level,
       CASE WHEN is_account_group_member('hr_admins') THEN salary END AS salary,
       CASE WHEN is_account_group_member('hr_admins') THEN national_id
            ELSE concat('***-**-', right(national_id, 4)) END AS national_id
FROM dv_employees;

SELECT * FROM dv_employees_masked ORDER BY employee_id LIMIT 5;
```

```sql run
-- Row level: an entitlement table that maps YOU to two departments
CREATE OR REPLACE TABLE dv_access (user_email STRING, department_id BIGINT);
INSERT INTO dv_access VALUES (current_user(), 3), (current_user(), 4);   -- Sales, Marketing

CREATE OR REPLACE VIEW dv_my_employees AS
SELECT e.*
FROM dv_employees e
WHERE is_account_group_member('hr_admins')
   OR EXISTS (SELECT 1 FROM dv_access a
              WHERE a.user_email = current_user() AND a.department_id = e.department_id);

SELECT (SELECT count(*) FROM dv_employees)    AS base_table_rows,
       (SELECT count(*) FROM dv_my_employees) AS rows_you_see;
```

> You own `dv_employees`, so you can still read it directly. A real reader would get `SELECT` on `dv_my_employees` only, and that is exactly the second number.

## Exercise 1: change access without touching the view

Make a copy `dv_ex_employees` and an entitlement table `dv_ex_access` that gives you department 1 (Engineering). Build `dv_ex_view` with the same `EXISTS` pattern. Count its rows per `department_id`. **Before you run step 4, predict:** after you add department 5 and remove department 1, which departments appear, and did you need `CREATE OR REPLACE VIEW`?

```sql todo
-- TODO 1: copy employees to dv_ex_employees; create dv_ex_access(user_email, department_id) with (current_user(), 1)
-- TODO 2: create dv_ex_view with WHERE ... OR EXISTS (... a.user_email = current_user() ...)
-- TODO 3: count rows per department_id in dv_ex_view
-- TODO 4: add department 5 for yourself, delete department 1, count again
```

```sql solution
CREATE OR REPLACE TABLE dv_ex_employees AS SELECT * FROM employees;
CREATE OR REPLACE TABLE dv_ex_access (user_email STRING, department_id BIGINT);
INSERT INTO dv_ex_access VALUES (current_user(), 1);

CREATE OR REPLACE VIEW dv_ex_view AS
SELECT e.* FROM dv_ex_employees e
WHERE is_account_group_member('hr_admins')
   OR EXISTS (SELECT 1 FROM dv_ex_access a
              WHERE a.user_email = current_user() AND a.department_id = e.department_id);

SELECT department_id, count(*) AS employees FROM dv_ex_view GROUP BY ALL;   -- only 1

INSERT INTO dv_ex_access VALUES (current_user(), 5);
DELETE FROM dv_ex_access WHERE user_email = current_user() AND department_id = 1;

SELECT department_id, count(*) AS employees FROM dv_ex_view GROUP BY ALL;   -- only 5
-- The view text never changed. Access is data in dv_ex_access, read at query time.
```

## Exercise 2: JOIN or EXISTS?

A colleague wrote the entitlement check as a `JOIN`. Build both versions over `dv_ex2_employees`, give yourself department 3 **twice** in `dv_ex2_access` (a copy-paste accident), and **predict** the row count of each view before you run the comparison. Then add an aggregate view `dv_ex2_salary_by_dept` with only `department_id`, `count(*)` and `round(avg(salary))`: a dynamic view can expose a summary while the per-person salary stays hidden.

```sql todo
-- TODO 1: copy employees to dv_ex2_employees; dv_ex2_access with (current_user(), 3) inserted twice
-- TODO 2: dv_ex2_join  = SELECT e.* FROM ... JOIN dv_ex2_access a ON ... WHERE a.user_email = current_user()
-- TODO 3: dv_ex2_exists = the EXISTS version
-- TODO 4: compare both counts with the real number of employees in department 3
-- TODO 5: dv_ex2_salary_by_dept over dv_ex2_exists
```

```sql solution
CREATE OR REPLACE TABLE dv_ex2_employees AS SELECT * FROM employees;
CREATE OR REPLACE TABLE dv_ex2_access (user_email STRING, department_id BIGINT);
INSERT INTO dv_ex2_access VALUES (current_user(), 3), (current_user(), 3);

CREATE OR REPLACE VIEW dv_ex2_join AS
SELECT e.* FROM dv_ex2_employees e
JOIN dv_ex2_access a ON a.department_id = e.department_id
WHERE a.user_email = current_user();

CREATE OR REPLACE VIEW dv_ex2_exists AS
SELECT e.* FROM dv_ex2_employees e
WHERE EXISTS (SELECT 1 FROM dv_ex2_access a
              WHERE a.user_email = current_user() AND a.department_id = e.department_id);

SELECT (SELECT count(*) FROM employees WHERE department_id = 3) AS real_rows,
       (SELECT count(*) FROM dv_ex2_join)   AS join_rows,     -- twice the real number
       (SELECT count(*) FROM dv_ex2_exists) AS exists_rows;   -- the real number

CREATE OR REPLACE VIEW dv_ex2_salary_by_dept AS
SELECT department_id, count(*) AS employees, round(avg(salary)) AS avg_salary
FROM dv_ex2_exists GROUP BY department_id;
SELECT * FROM dv_ex2_salary_by_dept;

-- Clean up when you are done
-- DROP VIEW dv_ex2_salary_by_dept; DROP VIEW dv_ex2_exists; DROP VIEW dv_ex2_join;
-- DROP TABLE dv_ex2_access; DROP TABLE dv_ex2_employees;
-- DROP VIEW dv_ex_view; DROP TABLE dv_ex_access; DROP TABLE dv_ex_employees;
-- DROP VIEW dv_my_employees; DROP VIEW dv_employees_masked; DROP TABLE dv_access; DROP TABLE dv_employees;
```

## ⚠️ Common mistakes

- ❌ Granting `SELECT` on the schema that holds the base table. Readers then skip the view.
- ❌ `is_member()` in Unity Catalog views. It ignores account groups.
- ❌ Entitlements joined with `JOIN`. Duplicate rules duplicate rows.
- ❌ A mask without an alias. The column gets an odd generated name and breaks reports.
- ❌ One view per team for the same rule. Use an entitlement table, or a row filter on the table.
- ✅ Base tables and secure views in separate schemas, readers granted only the secure schema.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Hide rows | `WHERE is_account_group_member('g') OR …` |
| Hide or redact a column | `CASE WHEN is_account_group_member('g') THEN col ELSE … END AS col` |
| Per-person or many rules | Entitlement table + `EXISTS (… current_user() …)` |
| Let a group read it | `GRANT SELECT ON TABLE view TO grp`, nothing on the base table |
| Share filtered data externally | Dynamic view in a share, `current_recipient()` |
| One rule on every query of a table | A row filter or column mask instead |
