---
title: Column masks in depth
summary: Write mask functions that hide, shorten, hash or generalize a column, pass other columns into them, and predict what a masked column does to filters, joins and aggregates.
icon: 🎭
level: Intermediate
minutes: 10
group: Access control
tags: [Unity Catalog, Column masks, PII, Pseudonymization]
---
# Column masks in depth

> A column mask replaces the value of one column with whatever a SQL function returns, for every reader and every query. Choosing **how** to mask decides what analysts can still do with the column.

**The one idea to remember:** the mask runs **as soon as each row is read**, before any `WHERE`, `JOIN`, `GROUP BY` or `ORDER BY` in the user's query. Everything after it only sees the masked value.

## 💡 Anatomy of a mask function

A mask is an ordinary SQL UDF in Unity Catalog. Step through the parts that matter.

```viz code
title: A mask for national_id
lang: sql
---
CREATE OR REPLACE FUNCTION sec.mask_national_id(national_id STRING)
RETURNS STRING
RETURN CASE
  WHEN is_account_group_member('hr_admins') THEN national_id
  ELSE concat('***-**-', right(national_id, 4))
END;
ALTER TABLE hr.employees
  ALTER COLUMN national_id SET MASK sec.mask_national_id;
---
1 | First parameter | The **first** parameter always receives the masked column's value. Give it the column's exact type.
2 | Return type | Must be the column's type (or castable to it), so tools and views keep working.
4 | Who is asking | Checked per query against the current user. Members of `hr_admins` get the real value.
5 | Everyone else | Partial reveal: only the last four characters survive.
7-8 | Attach | Every query on the column now calls the function. One mask per column.
```

## 🔧 Attach, replace, remove

| Task | Statement |
|---|---|
| Mask an existing column | `ALTER TABLE t ALTER COLUMN c SET MASK fn` |
| Mask at creation | `CREATE TABLE t (id BIGINT, c STRING MASK fn)` |
| Pass more inputs | `... SET MASK fn USING COLUMNS (other_col, 'const')` |
| Remove | `ALTER TABLE t ALTER COLUMN c DROP MASK` |
| Change the logic | `CREATE OR REPLACE FUNCTION fn ...` (the table keeps pointing to it) |

You need to **own the table** (or hold `MANAGE` and `SELECT` on it) and have `EXECUTE` on the function. Always `DROP MASK` before `DROP FUNCTION`: a mask pointing to a missing function makes the table unreadable.

## 🧮 Masks that read other columns

`USING COLUMNS` passes more arguments to the function: other columns of the same row, or constants. The masked column is still the first argument.

```sql
-- Reveal an email only to the HR group of the employee's own country
CREATE OR REPLACE FUNCTION sec.email_by_country(email STRING, emp_country STRING)
RETURNS STRING
RETURN CASE WHEN is_account_group_member(concat('hr_', lower(emp_country))) THEN email
            ELSE regexp_replace(email, '^[^@]+', '***') END;

ALTER TABLE hr.employees
  ALTER COLUMN email SET MASK sec.email_by_country USING COLUMNS (country);
```

A member of `hr_hu` sees the emails of Hungarian employees only. One function, one mask, a different answer per row.

## 🎨 Five ways to mask, one row

The technique decides what still works downstream. Step through the same employee row.

```viz table
{"title": "One employee row, five masking techniques",
 "columns": ["technique", "email", "salary", "national_id"],
 "rows": [["raw value", "anna.novak1@example.com", 33600, "242-23-9935"]],
 "steps": [
  {"label": "Raw", "note": "What `hr_admins` see. Every mask below is what everyone else gets."},
  {"label": "NULL out", "note": "`CAST(NULL AS DOUBLE)`. Safest. Counts of non-NULL values, sums and averages are gone.", "upd": {"0": {"technique": "NULL out", "salary": null}}},
  {"label": "Constant", "note": "`'REDACTED'`. Like NULL, but shows that a value exists. Nothing is joinable or groupable.", "upd": {"0": {"technique": "constant", "national_id": "REDACTED"}}},
  {"label": "Partial reveal", "note": "Keep the last four characters or the email domain. Good for support desks that confirm identity.", "upd": {"0": {"technique": "partial", "email": "***@example.com", "national_id": "***-**-9935"}}},
  {"label": "Hash", "note": "`sha2(email, 256)`. Same input, same output: **joins and distinct counts still work**. Without a secret salt, a known email can be hashed and matched.", "upd": {"0": {"technique": "hash", "email": "5d41e2…9c0a"}}},
  {"label": "Generalize", "note": "Round salary down to 10,000. Averages and ranges become **approximate**, and filters on exact values change.", "upd": {"0": {"technique": "generalize", "salary": 30000}}}
 ]}
```

## ⏱️ The mask runs first

An analyst asks how many people earn more than 100,000. The salary mask returns `NULL` for them. Step through the plan.

```viz flow
{"title": "SELECT count(*) FROM employees WHERE salary > 100000",
 "nodes": [{"icon": "📦", "title": "Scan", "sub": "real salaries on disk", "color": "teal"},
           {"icon": "🎭", "title": "Mask", "sub": "salary → NULL", "color": "purple"},
           {"icon": "🔍", "title": "WHERE", "sub": "salary > 100000", "color": "amber"},
           {"icon": "📋", "title": "Result", "sub": "count = 0", "color": "red"}],
 "edges": ["each row", "masked rows", "nothing passes"],
 "steps": [
  {"label": "Scan", "focus": [0], "note": "The files hold the real values. 21 employees really earn more than 100,000."},
  {"label": "Mask", "focus": [0, 1], "note": "The mask is applied **as each row is fetched**. From here on, salary is NULL for this user."},
  {"label": "Filter", "focus": [1, 2], "note": "`NULL > 100000` is not TRUE, so every row is dropped. The user cannot probe the real values with clever filters."},
  {"label": "Result", "focus": [2, 3], "note": "The answer is 0, not an error. Joins, `GROUP BY` and `ORDER BY` also work on masked values."}
 ]}
```

## 🔎 Find the masks in a schema

Masks are metadata, so you can audit them like any other object.

```sql
-- every mask in the current catalog: table, column, function, extra inputs
SELECT table_name, column_name, mask_name, mask_col_usage
FROM information_schema.column_masks;

-- one table, machine-readable (look for "column_masks")
DESCRIBE TABLE EXTENDED hr.employees AS JSON;
```

`mask_col_usage` lists the `USING COLUMNS` inputs. `information_schema.column_masks` is in Public Preview, and you only see columns you have access to.

## 🧪 Try it: mask a copy of employees

```dataset hr
```

Work on a copy. You are probably **not** in `hr_admins`, so you will see the masked values. If you are, every mask returns the real value: read the comments to know what others see.

```sql run
-- A copy and three mask functions: partial, hash, NULL out
CREATE OR REPLACE TABLE cm_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION cm_partial_nid(national_id STRING)
RETURNS STRING
RETURN CASE WHEN is_account_group_member('hr_admins') THEN national_id
            ELSE concat('***-**-', right(national_id, 4)) END;

CREATE OR REPLACE FUNCTION cm_hash_email(email STRING)
RETURNS STRING
RETURN CASE WHEN is_account_group_member('hr_admins') THEN email
            ELSE sha2(email, 256) END;

CREATE OR REPLACE FUNCTION cm_null_salary(salary DOUBLE)
RETURNS DOUBLE
RETURN CASE WHEN is_account_group_member('hr_admins') THEN salary
            ELSE CAST(NULL AS DOUBLE) END;
```

```sql run
-- Attach the masks and query the table as yourself
ALTER TABLE cm_employees ALTER COLUMN national_id SET MASK cm_partial_nid;
ALTER TABLE cm_employees ALTER COLUMN email SET MASK cm_hash_email;
ALTER TABLE cm_employees ALTER COLUMN salary SET MASK cm_null_salary;

SELECT employee_id, full_name, email, national_id, salary
FROM cm_employees ORDER BY employee_id LIMIT 5;
```

```sql run
-- The mask runs before WHERE: compare the two counts
SELECT
  (SELECT count(*) FROM employees    WHERE salary > 100000) AS real_count,
  (SELECT count(*) FROM cm_employees WHERE salary > 100000) AS masked_count;
```

```sql run
-- A mask declared at CREATE TABLE time, and where to find all of them
CREATE OR REPLACE TABLE cm_contacts (
  employee_id BIGINT,
  email STRING MASK cm_hash_email,
  country STRING);
INSERT INTO cm_contacts SELECT employee_id, email, country FROM employees;

SELECT table_name, column_name, mask_name, mask_col_usage
FROM information_schema.column_masks
WHERE schema_name = current_schema() AND table_name LIKE 'cm_%';
```

> The `INSERT` stored the **real** emails. Masks change what is read, never what is written. A `CREATE TABLE AS SELECT` from a masked table, though, stores whatever the reader saw.

## Exercise 1: generalize salaries, then filter

Make a copy `cm_ex_employees` and mask its `salary` with `cm_salary_band`, which rounds down to the nearest 10,000. **Before** you run the counts, predict: compared with `employees`, does `WHERE salary > 100000` return fewer, the same, or more rows? And `WHERE salary >= 100000`?

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE cm_ex_employees as a copy of employees
-- TODO 2: function cm_salary_band(salary DOUBLE) RETURNS DOUBLE (hr_admins see the real value)
-- TODO 3: attach it to cm_ex_employees.salary
-- TODO 4: compare real and masked counts for "> 100000" and ">= 100000"
```

```sql solution
CREATE OR REPLACE TABLE cm_ex_employees AS SELECT * FROM employees;

CREATE OR REPLACE FUNCTION cm_salary_band(salary DOUBLE)
RETURNS DOUBLE
RETURN CASE WHEN is_account_group_member('hr_admins') THEN salary
            ELSE CAST(floor(salary / 10000) * 10000 AS DOUBLE) END;

ALTER TABLE cm_ex_employees ALTER COLUMN salary SET MASK cm_salary_band;

SELECT
  (SELECT count(*) FROM employees       WHERE salary >  100000) AS real_gt,
  (SELECT count(*) FROM cm_ex_employees WHERE salary >  100000) AS masked_gt,
  (SELECT count(*) FROM employees       WHERE salary >= 100000) AS real_ge,
  (SELECT count(*) FROM cm_ex_employees WHERE salary >= 100000) AS masked_ge;
-- masked_gt is smaller (8 vs 21): 104,300 becomes 100,000, which is not > 100,000.
-- masked_ge equals real_ge: rounding down never crosses the 100,000 boundary.
```

## Exercise 2: do hashed keys still join?

The starter makes two copies whose `email` is masked with the same hash function. **Predict** the row count of two joins before you run them: masked to masked, and masked to the unmasked `employees` table.

```sql todo
-- Given: two copies with a hashed email
CREATE OR REPLACE FUNCTION cm_ex_hash(email STRING) RETURNS STRING
RETURN CASE WHEN is_account_group_member('hr_admins') THEN email ELSE sha2(email, 256) END;
CREATE OR REPLACE TABLE cm_ex_a AS SELECT employee_id, email FROM employees;
CREATE OR REPLACE TABLE cm_ex_b AS SELECT employee_id, email FROM employees;
ALTER TABLE cm_ex_a ALTER COLUMN email SET MASK cm_ex_hash;
ALTER TABLE cm_ex_b ALTER COLUMN email SET MASK cm_ex_hash;

-- TODO 1: count rows of cm_ex_a JOIN cm_ex_b ON email
-- TODO 2: count rows of cm_ex_a JOIN employees ON email
```

```sql solution
SELECT count(*) AS masked_to_masked
FROM cm_ex_a a JOIN cm_ex_b b ON a.email = b.email;        -- 300: same input, same hash

SELECT count(*) AS masked_to_raw
FROM cm_ex_a a JOIN employees e ON a.email = e.email;      -- 0: a hash never equals a raw email
-- In hr_admins both joins return 300, because the mask returns the real value for you.
```

## Exercise 3: reveal emails for one country

Write `cm_email_for_country(email STRING, emp_country STRING, visible_country STRING)`: the real email when the row's country equals `visible_country`, `***@domain` otherwise. Attach it to the email of a copy `cm_ex_contacts` with `USING COLUMNS (country, 'HU')`. Predict which countries show real emails, then switch the constant to `'DE'`.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE cm_ex_contacts with employee_id, email, country from employees
-- TODO 2: create the three-parameter mask function
-- TODO 3: SET MASK ... USING COLUMNS (country, 'HU'), count masked vs visible emails per country
-- TODO 4: switch to 'DE', then check mask_col_usage in information_schema.column_masks
```

```sql solution
CREATE OR REPLACE TABLE cm_ex_contacts AS SELECT employee_id, email, country FROM employees;

CREATE OR REPLACE FUNCTION cm_email_for_country(email STRING, emp_country STRING, visible_country STRING)
RETURNS STRING
RETURN CASE WHEN emp_country = visible_country THEN email
            ELSE regexp_replace(email, '^[^@]+', '***') END;

ALTER TABLE cm_ex_contacts ALTER COLUMN email SET MASK cm_email_for_country USING COLUMNS (country, 'HU');
SELECT country, count_if(email LIKE '***@%') AS masked, count_if(email NOT LIKE '***@%') AS visible
FROM cm_ex_contacts GROUP BY country;   -- only HU rows are visible

ALTER TABLE cm_ex_contacts ALTER COLUMN email SET MASK cm_email_for_country USING COLUMNS (country, 'DE');
SELECT country, count_if(email NOT LIKE '***@%') AS visible FROM cm_ex_contacts GROUP BY country;   -- now only DE

SELECT table_name, column_name, mask_name, mask_col_usage
FROM information_schema.column_masks
WHERE schema_name = current_schema() AND table_name LIKE 'cm_%';

-- Clean up when you are done (tables before functions)
-- DROP TABLE cm_ex_contacts; DROP TABLE cm_ex_a; DROP TABLE cm_ex_b; DROP TABLE cm_ex_employees;
-- DROP TABLE cm_contacts; DROP TABLE cm_employees;
-- DROP FUNCTION cm_email_for_country; DROP FUNCTION cm_ex_hash; DROP FUNCTION cm_salary_band;
-- DROP FUNCTION cm_null_salary; DROP FUNCTION cm_hash_email; DROP FUNCTION cm_partial_nid;
```

## ⚠️ Common mistakes

- ❌ Expecting `WHERE salary > x` to see real values. Filters, joins and aggregates run **after** the mask.
- ❌ Hashing one side of a join only. Hash every column you join on with the same function.
- ❌ A plain `sha2(email)` as "anonymization". It is pseudonymization, and guessable. Add a secret salt.
- ❌ `DROP FUNCTION` while a mask still uses it. The table becomes unreadable until you `DROP MASK`.
- ❌ Two masks on one column. Combine the rules in one function.
- ✅ Keep mask functions simple SQL, so the optimizer can inline them.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Hide the value completely | `CAST(NULL AS <type>)` or a constant |
| Keep part of it | `concat('***', right(c, 4))`, `regexp_replace(email, '^[^@]+', '***')` |
| Keep it joinable | `sha2(concat(c, <salt>), 256)` on every side |
| Keep it roughly usable | `floor(c / 10000) * 10000`, `trunc(d, 'YEAR')` |
| Decide per row | `SET MASK fn USING COLUMNS (other_col, 'const')` |
| List masks | `information_schema.column_masks` |
