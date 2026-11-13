---
title: Delta Sharing
summary: Share live tables with another company without copying them. Learn providers, shares and recipients, how a recipient read really works, and how to prepare a curated, PII-free view for sharing.
icon: 🤝
level: Intermediate
minutes: 10
group: Sharing and audit
tags: [Delta Sharing, Unity Catalog, Data sharing, Security]
---
# Delta Sharing

> **Delta Sharing** is an open protocol for sharing live data. The recipient reads the provider's files straight from cloud storage, with short-lived links the provider controls. Nothing is exported or copied.

**The one idea to remember:** the provider shares a **pointer, not a copy**. A sharing server checks the recipient's rights and hands out temporary URLs to the current Parquet files.

## 💡 Share, do not copy

The usual way to give data to a partner is an export job. Delta Sharing replaces it.

```viz compare
{"title": "Two ways to give a partner your data",
 "items": [
  {"icon": "📤", "title": "Export and copy", "sub": "CSV files, SFTP, a nightly job", "color": "red",
   "points": ["❌ stale the moment it lands", "❌ a pipeline to build and keep running", "❌ copies you can no longer revoke", "❌ no record of who read what"]},
  {"icon": "🤝", "title": "Delta Sharing", "sub": "a share granted to a recipient", "color": "green",
   "points": ["✅ live: the recipient reads the current version", "✅ no copy, no export job", "✅ revoke the grant and access stops", "✅ every access is audited"], "foot": "the recipient pays for their own compute"}
 ]}
```

The newest Databricks documentation calls the feature **OpenSharing**. The protocol and the SQL are the same.

## 🧩 Provider, share, recipient

The **provider** owns the data. A **share** is a read-only collection of assets in Unity Catalog. A **recipient** is a Unity Catalog object that stands for one consumer. You grant shares to recipients.

```viz tree
{"title": "A share, as the recipient will see it",
 "root": {"icon": "🎁", "label": "hr_partner_share", "sub": "share (provider side)", "color": "navy", "children": [
   {"icon": "🗂️", "label": "hr", "sub": "schema inside the share", "color": "blue", "children": [
     {"icon": "👁️", "label": "share_department_stats", "sub": "view: aggregates, no PII", "color": "green"}
   ]},
   {"icon": "🗂️", "label": "hu", "sub": "schema made by an alias", "color": "blue", "children": [
     {"icon": "📋", "label": "headcount_daily", "sub": "table: only partition country = 'HU', WITH HISTORY", "color": "teal"}
   ]},
   {"icon": "👥", "label": "granted to: benefits_partner", "sub": "recipient", "color": "amber"}
 ]}}
```

On the recipient side the share appears as a **read-only catalog**. The recipient grants it to their own users with normal Unity Catalog privileges.

## 🔁 How a read works

The provider runs no cluster for a table read. Step through one query by the recipient.

```viz flow
{"title": "Recipient runs SELECT * FROM shared.hr.headcount_daily",
 "nodes": [{"icon": "🧑‍💻", "title": "Recipient client", "sub": "Databricks, Spark, pandas, Power BI", "color": "blue"},
           {"icon": "🛂", "title": "Sharing server", "sub": "run by Databricks for the provider", "color": "purple"},
           {"icon": "📜", "title": "Delta log", "sub": "which files are the table", "color": "navy"},
           {"icon": "🔗", "title": "Pre-signed URLs", "sub": "valid for a short time", "color": "amber"},
           {"icon": "☁️", "title": "Provider storage", "sub": "the Parquet files", "color": "teal"}],
 "edges": ["request + credential", "resolve version", "sign", "download"],
 "steps": [
  {"label": "Request", "focus": [0, 1], "note": "The client calls the sharing server's REST API with its identity: the recipient metastore (Databricks-to-Databricks) or a bearer token or OIDC token (open sharing)."},
  {"label": "Check", "focus": [1], "note": "The server checks that the recipient exists, is active and was granted `SELECT` on the share. A revoked grant stops access here."},
  {"label": "Resolve", "focus": [1, 2], "note": "It reads the table's transaction log to find the files of the current (or requested) version. Filter hints from the client can skip files that cannot match."},
  {"label": "Sign", "focus": [2, 3], "note": "For each file the server creates a **pre-signed URL** that expires soon. It returns them with the schema."},
  {"label": "Read", "focus": [3, 4], "note": "The client downloads the Parquet files directly from cloud storage and computes on its own side. The data never passes through an export."}
 ]}
```

## 🔀 Two kinds of recipient

| | Databricks-to-Databricks | Open sharing |
|---|---|---|
| Recipient | Another Unity Catalog metastore, any cloud or region | Any client: pandas, Spark, Power BI, Tableau |
| Identified by | Its **sharing identifier** `cloud:region:metastore-uuid` | A bearer token from an activation link, or OIDC federation |
| Gets | A catalog, governed by their own Unity Catalog | Tables read through a connector |
| Assets | Tables, views, volumes, notebooks, models and more | Tabular data |

The recipient finds its sharing identifier with `SELECT current_metastore()` and sends it to the provider.

## 📦 What you can share, and how

| Option | Effect |
|---|---|
| `ADD TABLE t` | The current version of the table |
| `WITH HISTORY` | Recipient can time travel, read the change data feed and stream from the table |
| `PARTITION (country = 'HU')` | Only matching partitions of a partitioned table |
| `AS hu.headcount_daily` | A different schema and name inside the share |
| `ADD VIEW v` | A view, for example a dynamic view that filters by recipient |

Tables with **row filters or column masks** cannot be shared directly. Put the logic in a view and share the view.

## 🧾 The provider's SQL

Creating shares and recipients needs metastore-level privileges such as `CREATE SHARE` and `CREATE RECIPIENT`, so this code is display-only.

```viz code
title: provider side (display only)
lang: sql
---
CREATE SHARE hr_partner_share COMMENT 'Department statistics for the benefits partner';

ALTER SHARE hr_partner_share ADD VIEW prod.hr_curated.share_department_stats AS hr.share_department_stats;

ALTER SHARE hr_partner_share
  ADD TABLE prod.hr_curated.headcount_daily
  PARTITION (country = 'HU') AS hu.headcount_daily
  WITH HISTORY;

CREATE RECIPIENT benefits_partner
  USING ID 'aws:eu-central-1:<recipient-metastore-uuid>';

GRANT SELECT ON SHARE hr_partner_share TO RECIPIENT benefits_partner;
---
1 | Create the share | An empty container. It holds references, not data.
3 | Add a view | The curated, aggregated view. The alias puts it in schema `hr` inside the share.
5-8 | Add a table | Only the HU partition, under its own name, with history so the partner can read changes.
10-11 | Create the recipient | Databricks-to-Databricks: the partner's sharing identifier. Without `USING ID` you get an open recipient with an activation link.
13 | Grant | Nothing is visible until this grant. `REVOKE` takes it away again.
```

On the recipient side: `CREATE CATALOG partner_hr USING SHARE acme.hr_partner_share;`

## 🔒 Security, audit, and what builds on it

- Shares are **read-only**. Revoke a grant or drop the recipient to stop access at once. Open recipients' tokens have a lifetime, can be rotated and limited by IP access lists.
- The provider sees every recipient request in its **audit logs** (`system.access.audit`): which recipient, which table, when.
- **Clean Rooms** use sharing underneath to let parties run approved code on combined data without seeing each other's rows. **Marketplace** listings are shares too.
- **Lakehouse Federation** is the opposite direction: you query someone else's database (PostgreSQL, Snowflake…) in place, as a foreign catalog.

## 🧪 Try it: prepare a shareable view

```dataset hr
```

You cannot create a share in a lab, but you can do the part that matters most: decide **what** leaves the company. Build an aggregate view with no personal data.

```sql run
-- Headcount and average salary per department, no individual rows
CREATE OR REPLACE VIEW share_department_stats AS
SELECT d.department_name, d.country,
       count(*)                AS headcount,
       round(avg(e.salary), -2) AS avg_salary_eur
FROM employees e
JOIN departments d ON e.department_id = d.department_id
GROUP BY d.department_name, d.country
HAVING count(*) >= 5;   -- never publish groups small enough to identify a person

SELECT * FROM share_department_stats ORDER BY country, department_name;
```

```sql run
-- Check what the view exposes: no names, emails, ids or exact salaries
SELECT column_name, data_type,
       column_name IN ('employee_id', 'full_name', 'email', 'national_id', 'salary', 'manager_id') AS is_sensitive
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'share_department_stats'
ORDER BY ordinal_position;
```

```sql run
-- The sharing identifier a provider would need to share with your metastore
SELECT current_metastore() AS my_sharing_identifier;
```

## Exercise 1: country statistics with suppression

The partner also wants headcount per **country and level**. Build `share_country_levels` with the same rules: aggregates only, and suppress groups under 5 people. Predict first: which level is most likely to disappear? Then check its columns.

```sql todo
-- TODO 1: view share_country_levels: country, level, headcount, avg salary rounded to hundreds; HAVING count(*) >= 5
-- TODO 2: list its columns from information_schema.columns
```

```sql solution
CREATE OR REPLACE VIEW share_country_levels AS
SELECT country, level, count(*) AS headcount, round(avg(salary), -2) AS avg_salary_eur
FROM employees
GROUP BY country, level
HAVING count(*) >= 5;

SELECT * FROM share_country_levels ORDER BY country, level;
-- Lead is only about 5 % of employees, so most Lead groups fall under 5 and are suppressed.

SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'share_country_levels';
```

## Exercise 2: history leaks

Sharing a table `WITH HISTORY` exposes **old versions** too. Simulate a mistake: create `share_dept_stats_tbl` with a `max_salary` column, then replace it without that column. What could a recipient with history still read?

```sql todo
-- TODO 1: DROP TABLE IF EXISTS share_dept_stats_tbl, then create it with department_id, headcount and max(salary) AS max_salary
-- TODO 2: CREATE OR REPLACE it with only department_id and headcount
-- TODO 3: DESCRIBE HISTORY, then read VERSION AS OF 0
```

```sql solution
DROP TABLE IF EXISTS share_dept_stats_tbl;
CREATE TABLE share_dept_stats_tbl AS
SELECT department_id, count(*) AS headcount, max(salary) AS max_salary FROM employees GROUP BY department_id;

CREATE OR REPLACE TABLE share_dept_stats_tbl AS
SELECT department_id, count(*) AS headcount FROM employees GROUP BY department_id;

DESCRIBE HISTORY share_dept_stats_tbl;
SELECT * FROM share_dept_stats_tbl VERSION AS OF 0;   -- max_salary is still readable
-- Shared WITH HISTORY, a recipient could time travel to version 0.
-- Share WITHOUT HISTORY, or start from a clean table, when old versions held data you would not share.

-- Clean up when you are done
-- DROP TABLE share_dept_stats_tbl; DROP VIEW share_country_levels; DROP VIEW share_department_stats;
```

## ⚠️ Common mistakes

- ❌ Exporting CSV files to a partner. Share the table, keep control, and keep it live.
- ❌ Sharing raw tables with PII "because the partner promised to filter". Share a curated view.
- ❌ Adding a table with a row filter or column mask to a share. Share a view instead.
- ❌ Expecting a recipient to stream or read the change feed of a table shared without `WITH HISTORY`.
- ✅ Grant to a recipient, audit access, and revoke when the contract ends.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Create a share | `CREATE SHARE s` |
| Put data in it | `ALTER SHARE s ADD TABLE t [WITH HISTORY]`, `ADD VIEW v` |
| Register a Databricks partner | `CREATE RECIPIENT r USING ID '<sharing identifier>'` |
| Register a non-Databricks partner | `CREATE RECIPIENT r` (activation link or OIDC) |
| Give or remove access | `GRANT SELECT ON SHARE s TO RECIPIENT r`, `REVOKE …` |
| Mount a share as a recipient | `CREATE CATALOG c USING SHARE provider.share` |
