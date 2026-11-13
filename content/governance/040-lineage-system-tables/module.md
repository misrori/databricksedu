---
title: Lineage and system tables
summary: Find out where data comes from, who touched it and what it cost. See how Unity Catalog captures lineage on its own, which system tables answer which question, and how to query them safely.
icon: 🧭
level: Intermediate
minutes: 11
group: Sharing and audit
tags: [Unity Catalog, Lineage, System tables, Audit, Cost]
---
# Lineage and system tables

> Unity Catalog watches every query it governs. From that it builds **lineage** (what feeds what) and fills **system tables**: read-only Delta tables about access, cost, jobs and queries across the whole account.

**The one idea to remember:** you do not document lineage or audit by hand. Run work through Unity Catalog and the platform **records it for you**. Your job is to know which table holds the answer.

## 💡 Lineage is captured, not drawn

When a notebook, job, pipeline or dashboard reads tables and writes another, Unity Catalog records the link, down to the **column**. Step through a lineage graph.

```viz flow
{"title": "Lineage of an HR cost dashboard",
 "nodes": [{"icon": "📁", "title": "Volume", "sub": "raw HR exports", "color": "gray"},
           {"icon": "🥉", "title": "employees_raw", "sub": "bronze table", "color": "bronze"},
           {"icon": "🥈", "title": "employees", "sub": "silver table", "color": "silver"},
           {"icon": "🥇", "title": "lin_salary_by_department", "sub": "gold table", "color": "gold"},
           {"icon": "📊", "title": "HR cost dashboard", "sub": "AI/BI dashboard", "color": "blue"}],
 "edges": ["Lakeflow job", "pipeline", "notebook", "dataset query"],
 "steps": [
  {"label": "Ingest", "focus": [0, 1], "note": "A job loads files into bronze. Lineage records the volume path as the source and the job as the **entity** that did the work."},
  {"label": "Clean", "focus": [1, 2], "note": "A pipeline writes silver. Column lineage shows that `employees.salary` comes from `employees_raw.salary_text`."},
  {"label": "Aggregate", "focus": [2, 3], "note": "A notebook builds the gold table. `avg_salary` is linked to `employees.salary`, and `department_name` to the departments table."},
  {"label": "Consume", "focus": [3, 4], "note": "A dashboard dataset reads gold. Lineage now answers \"what feeds this dashboard?\" and, the other way round, \"what breaks if I change `salary`?\""}
 ]}
```

## 🔎 Where to see it, and its limits

- **Catalog Explorer → table → Lineage**: an interactive graph of upstream and downstream tables, plus the notebooks, jobs, pipelines and dashboards involved. Click a column to see its column lineage.
- **System tables** `system.access.table_lineage` and `system.access.column_lineage`: the same events as rows, for SQL and alerts.
- Lineage only exists for work that runs **through Unity Catalog**. Tools writing straight to storage, or reading paths outside Unity Catalog, leave no trace.
- You only see lineage for objects you have permission on. Others show as hidden nodes.
- Events arrive with a delay and are kept for a limited window, so do not treat lineage as a permanent archive.

## 🗄️ System tables by purpose

All system tables live in the `system` catalog. They are account-wide, so filter by `workspace_id` when you need one workspace.

```viz layers
{"layers": [
  {"icon": "🕵️", "title": "system.access", "sub": "who did what", "color": "purple", "items": ["audit", "table_lineage", "column_lineage"]},
  {"icon": "💶", "title": "system.billing", "sub": "what it cost", "color": "green", "items": ["usage (DBUs per record)", "list_prices (price per SKU over time)"]},
  {"icon": "🔁", "title": "system.lakeflow", "sub": "jobs and pipelines", "color": "blue", "items": ["jobs, job_tasks", "job_run_timeline, job_task_run_timeline", "pipelines"]},
  {"icon": "🔍", "title": "system.query", "sub": "SQL workloads", "color": "teal", "items": ["history: duration, bytes read, statement, user"]},
  {"icon": "🖥️", "title": "system.compute", "sub": "the machines", "color": "gray", "items": ["clusters, node_timeline", "warehouses, warehouse_events"]}
 ]}
```

Tables such as `system.lakeflow.jobs` keep a history of changes, so one job can have several rows. Take the latest `change_time` per job.

## 🕵️ Who accessed employees?

`system.access.audit` holds one row per audited action. Step through answering a question from security.

```viz table
{"title": "system.access.audit (simplified)",
 "columns": ["user", "action_name", "object", "status"],
 "rows": [["anna@acme.com", "getTable", "prod.hr.employees", 200],
          ["sp-hr-etl", "getTable", "prod.hr.departments", 200],
          ["bob@acme.com", "getTable", "prod.hr.employees", 403],
          ["carl@acme.com", "updatePermissions", "prod.hr.employees", 200],
          ["dana@acme.com", "getTable", "prod.retail.fact_orders", 200]],
 "steps": [
  {"label": "All events", "note": "Audit rows cover every service. The useful columns are `user_identity.email`, `service_name`, `action_name`, `request_params` (a map) and `response.status_code`."},
  {"label": "Only employees", "note": "Filter on `service_name = 'unityCatalog'` and the table name in `request_params`. Other tables drop out.", "hide": [1, 4]},
  {"label": "Failed access", "note": "Bob got **403**: he tried and was denied. A burst of these is worth an alert.", "hl": [2]},
  {"label": "Grant changes", "note": "`updatePermissions` shows Carl changed who may read the table. Audit records the change, the user and the time.", "hl": [3]}
 ]}
```

Audit tells you **who asked for** an object, not which rows they saw.

## 💶 What did yesterday cost?

`system.billing.usage` counts DBUs. `system.billing.list_prices` turns them into money. Walk through the join.

```viz code
title: cost per product, yesterday, at list price
lang: sql
---
SELECT u.billing_origin_product,
       sum(u.usage_quantity)                     AS dbus,
       sum(u.usage_quantity * p.pricing.default) AS list_cost
FROM system.billing.usage u
JOIN system.billing.list_prices p
  ON  u.sku_name = p.sku_name
  AND u.usage_start_time >= p.price_start_time
  AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time)
WHERE u.usage_date = date_sub(current_date(), 1)
GROUP BY ALL
ORDER BY list_cost DESC;
---
1 | Product | Which product the usage came from: jobs, SQL, serverless notebooks, pipelines, model serving.
2-3 | DBUs and money | `pricing.default` is the list price per unit. Discounts from your contract are not in it.
4-6 | Join on SKU | Each usage record has a SKU, the billable item. Prices are per SKU.
7-8 | Join on time | Prices change. Use the price that was valid when the usage happened, and the open-ended current price.
9 | Yesterday | Billing data is not real-time: expect a delay of hours.
```

`usage_metadata` (job, warehouse, pipeline, notebook ids) and `custom_tags` let you split the cost per job or per team.

## 🔐 Who can read system tables

System tables are not open to everyone. An **account admin** enables the schemas, and a **metastore admin** grants access with ordinary Unity Catalog privileges.

```sql
GRANT USE CATALOG ON CATALOG system TO `platform-observers`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.billing TO `platform-observers`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `security-team`;
```

They are read-only, and they hold data from the whole account. Grant `system.access` with care: audit rows contain user emails and IP addresses.

## 🏷️ Tags and data classification

Lineage tells you where data flows. **Tags** tell you what it is. A tag such as `pii = email` on a column makes it searchable (`tag:pii` in Catalog Explorer) and can drive ABAC policies. **Data classification** scans tables, detects PII such as emails and phone numbers, and applies governed tags for you.

```sql
ALTER TABLE prod.hr.employees ALTER COLUMN email SET TAGS ('pii' = 'email');
SELECT table_name, column_name, tag_value FROM prod.information_schema.column_tags WHERE tag_name = 'pii';
```

## 🧪 Try it: make lineage, then look for it

```dataset hr
```

First create a derived table, so there is lineage to find. The system table queries are guarded: in a lab without access they print a message instead of failing.

```sql run
-- A gold table built from two hr tables
CREATE OR REPLACE TABLE lin_salary_by_department AS
SELECT d.department_name, d.country, count(*) AS headcount, round(avg(e.salary)) AS avg_salary
FROM employees e
JOIN departments d ON e.department_id = d.department_id
GROUP BY d.department_name, d.country;

SELECT * FROM lin_salary_by_department ORDER BY avg_salary DESC;
```

```python run
# Which tables feed lin_salary_by_department? Ask the lineage system table
cat, sch = spark.sql("SELECT current_catalog(), current_schema()").first()
target = f"{cat}.{sch}.lin_salary_by_department"
try:
    rows = spark.sql(f"""
        SELECT source_table_full_name, target_table_full_name, entity_type, created_by, event_time
        FROM system.access.table_lineage
        WHERE target_table_full_name = '{target}' AND event_date >= date_sub(current_date(), 1)
        ORDER BY event_time DESC LIMIT 20""").toPandas()
    if len(rows):
        display(rows)
    else:
        print("No lineage rows yet: events arrive with a delay. Try again in a few minutes.")
except Exception as e:
    print("System tables are not accessible here. An admin must enable and grant them.")
    print("Detail:", str(e)[:200])
```

```python run
# DBUs per product over the last 7 days, in the same guarded style
try:
    usage = spark.sql("""
        SELECT usage_date, billing_origin_product, usage_unit, round(sum(usage_quantity), 2) AS quantity
        FROM system.billing.usage
        WHERE usage_date >= date_sub(current_date(), 7)
        GROUP BY ALL ORDER BY usage_date DESC, quantity DESC""").toPandas()
    if len(usage):
        display(usage)
    else:
        print("No usage rows visible for you.")
except Exception as e:
    print("system.billing is not accessible here. Ask an admin for SELECT on system.billing.")
    print("Detail:", str(e)[:200])
```

> Without system table access you can still see the lineage graph: open `lin_salary_by_department` in **Catalog Explorer → Lineage**.

## Exercise 1: predict the lineage

Build a two-step chain from `employees`: `lin_ex_hu_staff` (Hungarian employees, only `employee_id`, `level`, `salary`) and then `lin_ex_hu_levels` (headcount and average salary per level). **Before** you look, write down which source columns feed `lin_ex_hu_levels.avg_salary`. Then check, if you can, in the optional guarded cell.

```sql todo
-- TODO 1: lin_ex_hu_staff from employees where country = 'HU'
-- TODO 2: lin_ex_hu_levels from lin_ex_hu_staff: level, count(*) AS headcount, avg(salary) AS avg_salary
-- TODO 3: in a comment, list the upstream tables and columns of avg_salary
```

```sql solution
CREATE OR REPLACE TABLE lin_ex_hu_staff AS
SELECT employee_id, level, salary FROM employees WHERE country = 'HU';

CREATE OR REPLACE TABLE lin_ex_hu_levels AS
SELECT level, count(*) AS headcount, round(avg(salary)) AS avg_salary
FROM lin_ex_hu_staff GROUP BY level;
-- avg_salary <- lin_ex_hu_staff.salary <- employees.salary
-- employees.country was used in the filter of step 1: it shaped the rows but feeds no output column.
```

```python solution
# Optional check: column lineage of lin_ex_hu_levels (needs system table access)
cat, sch = spark.sql("SELECT current_catalog(), current_schema()").first()
try:
    display(spark.sql(f"""
        SELECT source_table_full_name, source_column_name, target_column_name
        FROM system.access.column_lineage
        WHERE target_table_full_name = '{cat}.{sch}.lin_ex_hu_levels'
          AND event_date >= date_sub(current_date(), 1)""").toPandas())
except Exception as e:
    print("No access to system.access.column_lineage. Open the table's Lineage tab instead.")
```

## Exercise 2: tag the sensitive columns

Lineage shows flow, tags show meaning. Make a copy `lin_ex_employees`, tag `email`, `national_id` and `salary` with the key `edu_sensitivity`, then list your tags from `information_schema.column_tags`. Which columns of `lin_ex_hu_staff` from Exercise 1 should carry a tag too?

```sql todo
-- TODO 1: copy employees into lin_ex_employees
-- TODO 2: SET TAGS ('edu_sensitivity' = ...) on email, national_id and salary
-- TODO 3: query information_schema.column_tags for your schema
```

```sql solution
CREATE OR REPLACE TABLE lin_ex_employees AS SELECT * FROM employees;

ALTER TABLE lin_ex_employees ALTER COLUMN email       SET TAGS ('edu_sensitivity' = 'pii');
ALTER TABLE lin_ex_employees ALTER COLUMN national_id SET TAGS ('edu_sensitivity' = 'restricted');
ALTER TABLE lin_ex_employees ALTER COLUMN salary      SET TAGS ('edu_sensitivity' = 'confidential');

SELECT table_name, column_name, tag_name, tag_value
FROM information_schema.column_tags
WHERE schema_name = current_schema() AND tag_name = 'edu_sensitivity';
-- lin_ex_hu_staff.salary should be tagged too: tags do not follow lineage by themselves.

-- Clean up when you are done
-- DROP TABLE lin_ex_employees; DROP TABLE lin_ex_hu_levels; DROP TABLE lin_ex_hu_staff; DROP TABLE lin_salary_by_department;
```

## ⚠️ Common mistakes

- ❌ Keeping a hand-drawn lineage diagram. It goes stale; the captured lineage does not.
- ❌ Expecting lineage for files written straight to cloud storage by outside tools.
- ❌ Reading the Spark UI to attribute cost. Use `system.billing.usage` with `list_prices`.
- ❌ Forgetting that system tables are account-wide: filter by `workspace_id`.
- ❌ Taking every row of `system.lakeflow.jobs` as a separate job. Keep the latest `change_time`.
- ✅ Wrap system table queries in notebooks you share, so they fail gracefully without access.

## 🧭 Cheat sheet

| Question | Table |
|---|---|
| Who read or changed this table, who changed its grants? | `system.access.audit` |
| What feeds this table or dashboard, what does it feed? | `system.access.table_lineage`, `column_lineage` |
| What did we spend, per product, job or tag? | `system.billing.usage` + `list_prices` |
| Which jobs fail or run long? | `system.lakeflow.job_run_timeline` |
| Which queries are slow or read the most? | `system.query.history` |
| How busy are clusters and warehouses? | `system.compute.*` |
