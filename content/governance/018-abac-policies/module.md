---
title: ABAC policies with governed tags
summary: Protect every current and future table with one policy. Understand governed tags, tag inheritance, the CREATE POLICY syntax, conflicts, and the privileges and compute an administrator needs.
icon: 🏷️
level: Advanced
minutes: 12
group: Access control
tags: [Unity Catalog, ABAC, Governed tags, Column masks, Row filters]
---
# ABAC policies with governed tags

> Table-level masks are attached one table at a time. **Attribute-based access control** (ABAC) turns that around: you tag the data, and one policy high in the catalog decides what every tagged column and table looks like.

**The one idea to remember:** a policy says "**mask whatever carries this tag**". Whoever tags a column decides whether it is protected, so **tagging is a security boundary**.

## 💡 From per-table work to one rule

```viz compare
{"title": "The same rule, two ways",
 "items": [
  {"icon": "🎭", "title": "Table-level mask", "sub": "ALTER TABLE … SET MASK", "color": "blue",
   "points": ["Set by the table owner", "❌ one statement per column per table", "❌ a new table is unprotected until someone remembers", "❌ the owner can remove it"], "foot": "fine for a few tables"},
  {"icon": "🏷️", "title": "ABAC policy", "sub": "CREATE POLICY … ON CATALOG", "color": "purple",
   "points": ["Set by a governance admin with `MANAGE`", "✅ matches columns by governed tag", "✅ new tagged tables are covered at once", "✅ table owners cannot override it"], "foot": "recommended by Databricks for most cases"}
 ]}
```

Both end up the same at query time: the engine adds the mask function to the plan. ABAC only changes **who decides** and **where the rule lives**.

## 🏷️ Governed tags vs ordinary tags

| | Ordinary tag | Governed tag |
|---|---|---|
| Defined by | Nobody: any key can be used | Account admin (or `CREATE` on tags in the account) |
| Allowed values | Any string | Only the values in its **tag policy** |
| Who may assign | `APPLY TAG` on the object | Also `ASSIGN` on the tag |
| Used by ABAC | No | **Yes** |

A governed tag is defined once for the whole account, across all metastores. Creating a governed tag with an existing key turns the existing assignments of that key into governed ones. Data classification applies system governed tags such as `class.email_address` for you.

## 🌳 Which tags does a policy see?

```viz tree
{"title": "Tags as seen by policy conditions",
 "root": {"icon": "📚", "label": "catalog prod", "sub": "tag: domain = hr", "color": "navy", "children": [
   {"icon": "🗂️", "label": "schema prod.people", "sub": "inherits domain = hr", "color": "blue", "children": [
     {"icon": "📋", "label": "table employees", "sub": "inherits domain = hr · own tag: sensitivity = high", "color": "teal", "children": [
       {"icon": "🔤", "label": "column email", "sub": "pii = email (set on the column)", "color": "green"},
       {"icon": "🔤", "label": "column country", "sub": "no tags: table tags do not flow down", "color": "gray"}
     ]}
   ]}
 ]}}
```

- `WHEN has_tag_value('domain', 'hr')` checks the **table**, including tags inherited from its schema and catalog.
- `MATCH COLUMNS has_tag_value('pii', 'email')` checks tags set **directly on the column**. Column tags are never inherited.

## 📜 Anatomy of a policy

```viz code
title: CREATE POLICY (display-only)
lang: sql
---
CREATE OR REPLACE POLICY mask_pii_email
ON CATALOG prod
COMMENT 'Mask emails outside HR'
COLUMN MASK prod.sec.mask_email
TO `account users`
EXCEPT `hr_admins`
FOR TABLES
WHEN has_tag_value('domain', 'hr')
MATCH COLUMNS has_tag_value('pii', 'email') AS e
ON COLUMN e;
---
1-2 | Name and scope | The policy lives on a catalog, schema or table and covers everything below it. Names are unique per securable.
4 | Action | `COLUMN MASK fn` or `ROW FILTER fn`. The function is an ordinary Unity Catalog UDF.
5-6 | Principals | Who gets masked, and who is exempt. Up to 20 principals per policy.
7-8 | Which tables | `FOR TABLES` is required. `WHEN` is optional and defaults to TRUE.
9 | Which columns | Up to 3 column conditions for a mask, 6 for a row filter. Each gets an alias.
10 | Mask target | The aliased column becomes the first argument of the function. `USING COLUMNS (alias, 4)` adds more.
```

## 🎬 A new table is masked on arrival

The policy above already exists on `prod`. Nobody touches it while a data engineer ships a new table.

```viz flow
{"title": "prod.people.contractors: from CREATE TABLE to the first query",
 "nodes": [{"icon": "🛠️", "title": "CREATE TABLE", "sub": "contractors, with an email column", "color": "blue"},
           {"icon": "🏷️", "title": "Tag the column", "sub": "pii = email", "color": "amber"},
           {"icon": "🛡️", "title": "Policy evaluation", "sub": "mask_pii_email matches", "color": "purple"},
           {"icon": "🧑‍💼", "title": "Analyst query", "sub": "SELECT * FROM contractors", "color": "teal"},
           {"icon": "🎭", "title": "Result", "sub": "email masked", "color": "green"}],
 "edges": ["", "", "", ""],
 "steps": [
  {"label": "Create", "focus": [0], "note": "The table inherits `domain = hr` from the catalog. Its `email` column has no tag yet, so the policy does **not** match: email is still readable."},
  {"label": "Tag", "focus": [0, 1], "note": "The engineer (who has `APPLY TAG` on their own table and `ASSIGN` on `pii`) tags the column, or data classification does it automatically."},
  {"label": "Evaluate", "focus": [1, 2], "note": "At the next query Unity Catalog finds the catalog policy: the user is in `account users`, not in `hr_admins`, the table matches `WHEN`, a column matches `MATCH COLUMNS`."},
  {"label": "Query", "focus": [2, 3], "note": "The effective mask is sent to the engine with the table metadata. Nobody wrote `ALTER TABLE … SET MASK`."},
  {"label": "Masked", "focus": [3, 4], "note": "The analyst sees masked emails. A tag change can take a few minutes to take effect."}
 ]}
```

## ⚔️ Conflicts and failing closed

- For one user, a column may resolve to **one distinct mask** and a table to **one distinct row filter**.
- Two policies that resolve to the **same function with the same arguments** are fine.
- Two **different** masks, or an ABAC mask plus a table-level `SET MASK` on the same column, **block the query** with an error (`MULTIPLE_MASKS`, `UC_ABAC_MULTIPLE_ROW_FILTERS`).
- ABAC **fails closed**. Delete a referenced governed tag or UDF, or query from a runtime older than 16.4, and queries fail instead of returning raw data.

To debug, run `SHOW EFFECTIVE POLICIES ON TABLE t` and check `information_schema.column_masks` for table-level masks.

## 🔐 Who may do what, and where it runs

| Step | Needs |
|---|---|
| Define a governed tag and its values | Account admin, or `CREATE` on tags in the account |
| Tag a column or table | `ASSIGN` on the governed tag + `APPLY TAG` on the object |
| Create, replace or drop a policy | `MANAGE` on (or ownership of) the catalog, schema or table + `EXECUTE` on the UDF |
| See policies | `READ METADATA`, `MANAGE` or ownership |
| Query a protected table | `SELECT` as usual (policies never grant access) |

Compute: serverless, or standard or dedicated compute on Databricks Runtime **16.4+**. Row filter and column mask policies are generally available (announced May 2026). Metastore-level policies, policies on views and DENY policies are Beta. Check the docs for the current status.

## 🧪 Try it: tags on your own copy

```dataset hr
```

Governed tags are created by account admins, and policies need `MANAGE` on a catalog or schema. So in this lab you use **ordinary tags** with keys that are not governed (`abac_domain`, `abac_pii`), and **simulate** what a policy would do with explicit masks.

```sql run
-- A copy, a table tag and two column tags
CREATE OR REPLACE TABLE abac_employees AS SELECT * FROM employees;

ALTER TABLE abac_employees SET TAGS ('abac_domain' = 'hr');
ALTER TABLE abac_employees ALTER COLUMN email SET TAGS ('abac_pii' = 'email');
ALTER TABLE abac_employees ALTER COLUMN national_id SET TAGS ('abac_pii' = 'national_id');
```

```sql run
-- Table tags and column tags live in separate views
SELECT 'table' AS level, table_name, NULL AS column_name, tag_name, tag_value
FROM information_schema.table_tags
WHERE schema_name = current_schema() AND table_name LIKE 'abac_%'
UNION ALL
SELECT 'column', table_name, column_name, tag_name, tag_value
FROM information_schema.column_tags
WHERE schema_name = current_schema() AND table_name LIKE 'abac_%';
```

```python run
# A do-it-yourself "policy": mask every column tagged abac_pii in tables named abac_%
spark.sql("""
CREATE OR REPLACE FUNCTION abac_mask_pii(val STRING) RETURNS STRING
RETURN CASE WHEN is_account_group_member('hr_admins') THEN val ELSE '***' END""")

def apply_pii_policy():
    tagged = spark.sql("""
        SELECT table_name AS t, column_name AS c FROM information_schema.column_tags
        WHERE schema_name = current_schema() AND table_name LIKE 'abac_%' AND tag_name = 'abac_pii'""").collect()
    for r in tagged:
        spark.sql(f"ALTER TABLE `{r.t}` ALTER COLUMN `{r.c}` DROP MASK")
        spark.sql(f"ALTER TABLE `{r.t}` ALTER COLUMN `{r.c}` SET MASK abac_mask_pii")
        print(f"masked {r.t}.{r.c}")

apply_pii_policy()
display(spark.sql("SELECT employee_id, full_name, email, national_id FROM abac_employees LIMIT 5"))
```

> A real policy is evaluated **at query time** inside Unity Catalog. This loop only runs when you call it. That gap is exactly what ABAC closes.

## Exercise 1: the forgotten new table

The starter rebuilds the do-it-yourself policy. Create `abac_contractors` (`employee_id`, `full_name`, `email` of 10 employees) and tag its `email` column `abac_pii = email`. **Predict** whether the email is masked before you run the "policy". Then predict what a real catalog policy with `MATCH COLUMNS has_tag_value('pii', 'email')` would have done.

```python todo
# Given: the mask function and the do-it-yourself policy from the lecture
spark.sql("""CREATE OR REPLACE FUNCTION abac_mask_pii(val STRING) RETURNS STRING
             RETURN CASE WHEN is_account_group_member('hr_admins') THEN val ELSE '***' END""")

def apply_pii_policy():
    for r in spark.sql("""SELECT table_name AS t, column_name AS c FROM information_schema.column_tags
                          WHERE schema_name = current_schema() AND table_name LIKE 'abac_%'
                            AND tag_name = 'abac_pii'""").collect():
        spark.sql(f"ALTER TABLE `{r.t}` ALTER COLUMN `{r.c}` DROP MASK")
        spark.sql(f"ALTER TABLE `{r.t}` ALTER COLUMN `{r.c}` SET MASK abac_mask_pii")

# TODO 1: CREATE OR REPLACE TABLE abac_contractors from 10 employees, then tag its email column
# TODO 2: query it, then call apply_pii_policy() and query again
```

```python solution
spark.sql("""CREATE OR REPLACE TABLE abac_contractors AS
             SELECT employee_id, full_name, email FROM employees WHERE employee_id <= 10""")
spark.sql("ALTER TABLE abac_contractors ALTER COLUMN email SET TAGS ('abac_pii' = 'email')")

display(spark.sql("SELECT * FROM abac_contractors"))   # real emails: an ordinary tag protects nothing
apply_pii_policy()
display(spark.sql("SELECT * FROM abac_contractors"))   # now '***' (unless you are in hr_admins)
# A real ABAC policy needs no loop: the first query after the governed tag was set is already masked.
```

## Exercise 2: table tag or column tag?

Make a copy `abac_ex_employees` and put the tag `abac_pii = salary` on the **table**, not on its `salary` column. **Predict**: does `information_schema.column_tags` list `salary`? Would a policy with `MATCH COLUMNS has_tag('abac_pii')` mask it? Then check which policies already reach your table.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE abac_ex_employees as a copy of employees, SET TAGS on the table
-- TODO 2: query table_tags and column_tags for abac_ex_employees
-- TODO 3: SHOW EFFECTIVE POLICIES ON TABLE abac_ex_employees (you own it, so you may list policies)
```

```sql solution
CREATE OR REPLACE TABLE abac_ex_employees AS SELECT * FROM employees;
ALTER TABLE abac_ex_employees SET TAGS ('abac_pii' = 'salary');

SELECT 'table' AS level, tag_name, tag_value FROM information_schema.table_tags
WHERE schema_name = current_schema() AND table_name = 'abac_ex_employees'
UNION ALL
SELECT concat('column ', column_name), tag_name, tag_value FROM information_schema.column_tags
WHERE schema_name = current_schema() AND table_name = 'abac_ex_employees';
-- Only the table row: table tags never flow down to columns, so MATCH COLUMNS would not match salary.
-- WHEN has_tag('abac_pii') would match the TABLE, because WHEN reads table and inherited tags.

SHOW EFFECTIVE POLICIES ON TABLE abac_ex_employees;
-- Usually empty in a lab. A row here means an admin's catalog or schema policy reaches your table.

-- Clean up when you are done (tables before the function)
-- DROP TABLE abac_ex_employees; DROP TABLE abac_contractors; DROP TABLE abac_employees;
-- DROP FUNCTION abac_mask_pii;
```

## ⚠️ Common mistakes

- ❌ Tagging the table and expecting `MATCH COLUMNS` to find its columns. Tag each column.
- ❌ Letting everyone assign the `pii` tag. Whoever can remove a tag can unmask a column.
- ❌ Adding a table-level mask on a column a policy already masks. The query fails.
- ❌ Deleting a governed tag a policy still uses. Every query in the policy's scope fails.
- ❌ Forgetting the pipeline's run-as identity. A materialized view refreshed by a masked identity stores masked data. Put ETL principals in `EXCEPT`.
- ✅ Attach policies at the catalog, keep `EXCEPT` short, audit tag changes.

## 🧭 Cheat sheet

| I want to… | Use (display-only unless you hold the privilege) |
|---|---|
| Tag a column | `ALTER TABLE t ALTER COLUMN c SET TAGS ('pii' = 'email')` |
| Create or change a policy | `CREATE [OR REPLACE] POLICY p ON CATALOG c COLUMN MASK fn TO … FOR TABLES MATCH COLUMNS … AS a ON COLUMN a` |
| List policies here and above | `SHOW EFFECTIVE POLICIES ON TABLE t` |
| See one policy | `DESCRIBE POLICY p ON CATALOG c` |
| Remove a policy | `DROP POLICY p ON CATALOG c` |
| Audit all policies | `system.information_schema.abac_policy_definitions` |
