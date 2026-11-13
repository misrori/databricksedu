---
title: "Data Analyst Associate: exam prep"
summary: What the Databricks Certified Data Analyst Associate exam covers, the facts and distinctions each domain tests, the usual traps, and a three-week study plan.
icon: 🎓
level: Intermediate
minutes: 14
group: Associate
tags: [Certification, Analytics, Databricks SQL, AI/BI]
---
# Data Analyst Associate: exam prep

> For analysts who query, model, visualize and share data with Databricks SQL. Passing shows you can find trusted data in Unity Catalog, write and tune SQL on a SQL warehouse, and build dashboards, alerts and Genie spaces that others can safely use.

**The one idea to remember:** most questions are scenarios with one deciding constraint ("many concurrent users", "viewers have no access to the table", "must change the SQL itself"). Find that constraint first, then pick the tool that fits it.

## 📋 The exam at a glance

| Item | Detail |
|---|---|
| Scored questions | 45 multiple choice (a few "choose two"), plus possible unscored items |
| Time and fee | 90 minutes · USD 200 |
| Delivery | Online proctored or at a test center, no test aides |
| Validity | 2 years; recertify by taking the current full exam |
| Passing score | Not published by Databricks; aim for 80% or more on unseen practice tests |

The topics follow the exam guide version of October 30, 2025.

## 🗺️ Domains and weights

```viz layers
{"title": "Nine domains, 45 questions",
 "layers": [
  {"icon": "⚙️", "title": "Executing queries with Databricks SQL and SQL warehouses · 20%", "color": "blue", "items": ["Warehouse sizing", "Joins and set operations", "Views vs materialized views", "Time travel"]},
  {"icon": "📊", "title": "Dashboards and visualizations · 16%", "color": "teal", "items": ["Filters vs parameters", "Publish and share", "Schedules and alerts"]},
  {"icon": "🔍", "title": "Analyzing queries · 15%", "color": "amber", "items": ["Photon", "Query history and profile", "Caching", "Liquid clustering"]},
  {"icon": "🧞", "title": "AI/BI Genie spaces · 12%", "color": "purple", "items": ["Components", "Permissions", "Benchmarks and monitoring"]},
  {"icon": "🏛️", "title": "Databricks Data Intelligence Platform · 11%", "color": "navy", "items": ["Core components", "Catalog Explorer", "Marketplace"]},
  {"icon": "🏷️", "title": "Managing data · 8%", "color": "green", "items": ["Certified datasets", "Tags and lineage", "SQL cleaning"]},
  {"icon": "🛡️", "title": "Securing data · 8%", "color": "red", "items": ["Three-level namespace", "Privileges", "Ownership and PII"]},
  {"icon": "📥", "title": "Importing data · 5%", "color": "bronze", "items": ["Upload UI", "COPY INTO and Auto Loader", "Delta Sharing"]},
  {"icon": "⭐", "title": "Data modeling with Databricks SQL · 5%", "color": "gold", "items": ["Star and snowflake", "Data vault", "Medallion mapping"]}
 ]}
```

Executing, analyzing and dashboards make up just over half the exam, so spend most of your time writing SQL and building a real dashboard.

## 🏛️ Platform, Catalog Explorer and managing data · 19%

| Topic | What to know |
|---|---|
| Managed vs external | Managed: Unity Catalog owns the storage, `DROP` deletes the data. External: your `LOCATION`, `DROP` keeps the files |
| Catalog Explorer | Overview (columns, comments, tags, owner), Sample data, Details, Permissions, History, Lineage, Insights |
| Certified data | System tag `system.certification_status` = certified or deprecated; search `certificationStatus:certified` |
| Lineage | Captured automatically, down to columns, including notebooks, jobs and dashboards |
| Marketplace | Data products shared through Delta Sharing; they arrive as a **read-only catalog**, no copy |
| Cleaning SQL | `coalesce`, `nullif(col, 'N/A')`, `try_cast`, `trim`, dedup with `QUALIFY row_number() OVER (...) = 1` |

Know the platform names too: Delta Lake, Unity Catalog, Databricks SQL, Lakeflow Jobs, Mosaic AI and Lakeflow Spark Declarative Pipelines (the guide still says Delta Live Tables).

## 📥 Importing data · 5%

| Scenario | Use |
|---|---|
| One small file from your laptop | **Add or upload data** in the UI → a managed Delta table (or a volume to keep the raw file) |
| Files land in S3 every day | `COPY INTO` or Auto Loader (`read_files` in a streaming table); both pick up only new files |
| Live data from another organization | **Delta Sharing**: read-only, no copy |
| Third-party data products | **Marketplace** |
| Source only has a REST API | Notebook that calls the API, scheduled as a Lakeflow Jobs task |
| Query an external database in place | **Lakehouse Federation**: nothing is imported |

Auto Loader adds schema evolution and a `_rescued_data` column for values that do not fit the schema.

## ⚙️ Executing queries: warehouses, Assistant, federation · 20%

- A **SQL warehouse** runs SQL from the editor, dashboards, Genie, alerts and BI tools. Photon is on. Serverless is recommended; pro and classic also exist.
- **Cluster size** = power per query (scale up for one heavy query). **Min/max clusters** = concurrency (scale out when queries queue).
- Using a warehouse needs **CAN USE**; data access is a separate Unity Catalog question.
- The **Databricks Assistant** (now called Genie Code in the docs): `/explain`, `/fix`, `/doc`, `/optimize`, `/findTables`. Reference tables with `@table`. Always review its SQL.
- **Federation**: `CREATE CONNECTION`, then `CREATE FOREIGN CATALOG`, then join a Delta table with the foreign table in one query.
- Aggregates: `count(DISTINCT x)` is exact, `approx_count_distinct(x)` is faster on big data. `WHERE` filters rows before grouping, `HAVING` filters groups after.

## 🧱 Executing queries: views, tables and time travel

```viz compare
{"title": "Which object stores what",
 "items": [
  {"icon": "🪟", "title": "View", "sub": "the \"dynamic\" view", "color": "gray", "points": ["❌ stores no data", "✅ always current", "Computed at every query", "Light logic, security layer"]},
  {"icon": "🧊", "title": "Materialized view", "sub": "CREATE MATERIALIZED VIEW", "color": "blue", "points": ["✅ stores results", "Fresh as of the last refresh", "`SCHEDULE EVERY 1 HOUR` or `REFRESH`", "Heavy aggregates for BI"]},
  {"icon": "🌊", "title": "Streaming table", "sub": "CREATE STREAMING TABLE", "color": "teal", "points": ["✅ stores results", "Incremental: each new row once", "Files or Kafka arriving continuously", "Pick this for near real time"]}
 ]}
```

- `UNION` removes duplicates, `UNION ALL` keeps them; columns match **by position**. Know `INTERSECT`, `EXCEPT`, `LEFT SEMI` and `LEFT ANTI`.
- `CREATE OR REPLACE TABLE` keeps history and grants; `DROP` plus `CREATE` loses them.
- `VERSION AS OF` / `TIMESTAMP AS OF` read old versions until `VACUUM` (7-day default retention) removes their files.

## 🔍 Analyzing and fixing queries · 15%

- **Photon**: vectorized C++ engine, on by default on SQL warehouses. Speeds up scans, joins, aggregations and writes; does nothing for Python UDFs.
- **Query history** finds slow queries (filter by user, time, warehouse, status). **Query profile** shows which operator is slow: full scans, row explosion, spill, files read vs pruned.
- **Result cache**: up to 24 hours, dropped when the table changes. Benchmark with `SET use_cached_result = false`.
- **Liquid clustering**: `CLUSTER BY (col)` plus `OPTIMIZE` for columns you filter on. It replaces partitioning and `ZORDER`.

"Fix the query" items are common. Step through the classic fixes:

```viz code
title: Customers per region, including customers with no 2026 orders
lang: sql
---
SELECT c.region,
       count(DISTINCT c.customer_id) AS customers,
       coalesce(sum(o.amount), 0)    AS revenue_2026
FROM customers AS c
LEFT JOIN orders AS o
  ON o.customer_id = c.customer_id
 AND o.order_date >= '2026-01-01'
WHERE c.email IS NOT NULL
GROUP BY c.region
HAVING count(DISTINCT c.customer_id) > 10
ORDER BY revenue_2026 DESC;
---
2 | DISTINCT | `count(*)` would count joined rows, one per order. Count distinct keys to count customers.
3 | coalesce | A region whose customers have no matching orders sums to NULL. `coalesce` turns it into 0.
5-7 | Filter in ON | A right-side filter in `WHERE` drops the NULL rows and turns the LEFT JOIN into an inner join. Keep it in `ON`.
8 | IS NOT NULL | `col = NULL` or `col != NULL` is never true. Use `IS NULL` / `IS NOT NULL`.
9 | GROUP BY | Every non-aggregated column must be grouped, or use `GROUP BY ALL`.
10 | HAVING | Conditions on aggregates go in `HAVING`; `WHERE sum(...)` is an error.
```

## 📊 Dashboards, visualizations and alerts · 16%

| Question | Answer |
|---|---|
| Filter or parameter? | A **filter** works on dataset fields after the query. A **parameter** (`:region`, `:date_range.min`) changes the SQL itself |
| Who do queries run as? | **Shared data permissions**: the publisher. **Individual data permissions**: each viewer, who then needs `SELECT` |
| Sharing | CAN VIEW / RUN / EDIT / MANAGE; "anyone in my account" reaches users without workspace access; iframe embedding |
| Refresh | **Schedule** on the published dashboard, plus subscribers (email, Slack, Teams) |
| Watch a threshold | **SQL alert**: query, condition with threshold, schedule, destination. States: OK, TRIGGERED, ERROR |

Charts: line for trends, bar to compare categories, scatter for relationships, histogram or box plot for distributions, counter for one KPI. Draft edits reach viewers only after you **republish**.

## 🧞 AI/BI Genie spaces · 12%

The current docs call Genie spaces **Genie Agents**; the concepts are the same. Genie turns questions into SQL on a pro or serverless warehouse, shows the SQL, and applies **each user's own** Unity Catalog permissions.

```viz flow
{"title": "Build a space, then improve it",
 "nodes": [
  {"icon": "🗂️", "title": "Curate data", "sub": "few tables, one topic", "color": "blue", "items": ["Up to 50, aim for about 5", "Good UC comments"]},
  {"icon": "📝", "title": "Add knowledge", "sub": "trusted assets first", "color": "purple", "items": ["Example SQL", "SQL functions", "SQL expressions", "Short instructions"]},
  {"icon": "🔐", "title": "Share", "sub": "CAN VIEW / CAN RUN", "color": "green", "items": ["Users need SELECT", "No warehouse grant"]},
  {"icon": "📈", "title": "Monitor and benchmark", "sub": "measure accuracy", "color": "amber", "items": ["Questions and ratings", "Ground-truth SQL"]}
 ],
 "edges": ["describe", "publish", "learn"],
 "steps": [
  {"label": "Curate", "focus": [0], "note": "Start small: about 5 tables or views for one audience. Genie depends on Unity Catalog metadata, so write table and column comments and synonyms."},
  {"label": "Add knowledge", "focus": [1], "note": "Vetted **example SQL** and **SQL functions** are trusted assets: when a question matches, Genie answers with the verified query. Prefer them over long text instructions."},
  {"label": "Share", "focus": [2], "note": "End users need CAN VIEW or CAN RUN on the space and SELECT on the data. They do **not** need CAN USE on the warehouse. Distribute by link, embedding or the Conversation API."},
  {"label": "Improve", "focus": [3, 1], "note": "The Monitoring tab shows every question and its feedback. Fix wrong SQL, add it as an example, then rerun **benchmarks** to prove accuracy went up. Feedback alone changes nothing."}
 ]}
```

## 🛡️ Data modeling and securing data · 13%

| Topic | What to know |
|---|---|
| Star schema | Fact table plus denormalized dimensions; few joins, the default for gold and BI |
| Snowflake and data vault | Snowflake normalizes dimensions (more joins). Data vault (hubs, links, satellites) fits silver, not direct BI |
| Read access | `USE CATALOG` + `USE SCHEMA` + `SELECT`; privileges inherit downward; grant to groups |
| Ownership and PII | Prod objects owned by groups or service principals; tag PII columns, use column masks, row filters and curated views |

Keep the two permission systems apart: a dashboard or Genie ACL (CAN VIEW, CAN RUN) is not a data privilege (`SELECT`).

## 🪤 Typical traps

- ❌ "Make the warehouse bigger so 50 users stop queueing." ✅ Raise the **max clusters**; size only helps a single heavy query.
- ❌ "A materialized view is the real-time option." ✅ Continuously arriving data needs a **streaming table**.
- ❌ "Delta Sharing, Marketplace and federation copy the data." ✅ All three read data in place.
- ❌ "Photon speeds up my Python UDF." ✅ It accelerates SQL and DataFrame operators only.
- ❌ "Benchmark the query twice and take the faster run." ✅ The second run probably came from the **result cache**.
- ❌ "Give Genie all 50 tables and longer instructions." ✅ Few tables, example SQL, SQL expressions, good metadata, benchmarks.
- ❌ Old names only. ✅ Recognize Delta Live Tables, Databricks Assistant and Vector Search under their current names.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks, about an hour a day",
 "items": [
  {"label": "Days 1-3", "title": "Platform and governance", "color": "navy", "note": "Study **Lakehouse architecture**, **Unity Catalog basics** and **Unity Catalog privileges**. In Catalog Explorer, open a table's Permissions, History and Lineage tabs and tag a column."},
  {"label": "Days 4-7", "title": "SQL you must read fast", "color": "blue", "note": "Study **SQL warehouses**, **Joins and shuffles**, **Time travel, RESTORE and VACUUM** and **Auto Loader and COPY INTO**. Write LEFT JOIN, UNION ALL, HAVING and `VERSION AS OF` queries until they are routine."},
  {"label": "Days 8-10", "title": "Performance", "color": "amber", "note": "Study **Optimizing Delta tables** and **Lakeflow Spark Declarative Pipelines** (for materialized views and streaming tables). Open a query profile and find the slowest operator."},
  {"label": "Days 11-14", "title": "Dashboards and Genie", "color": "teal", "note": "Study **AI/BI dashboards**, **Genie spaces** and **Metric views**. Build a dashboard with a parameter, publish it both ways, schedule it, and create an alert."},
  {"label": "Days 15-16", "title": "Modeling and security", "color": "purple", "note": "Study **Medallion architecture**, **Row filters and column masks**, **Delta Sharing** and **Lineage and system tables**. Map star, snowflake and data vault to the layers."},
  {"label": "Days 17-21", "title": "Timed practice exams", "color": "green", "note": "Take full practice exams under 90 minutes. Review **every** wrong answer and every lucky guess, and go back to the module that covers it."}
 ]}
```

## 🧭 Exam-day checklist

| Do this | Why |
|---|---|
| Budget 2 minutes per question | 45 questions in 90 minutes, with time left to review flags |
| Underline the deciding constraint | Concurrency, freshness, who runs the query, "without copying" |
| Check "choose two" | Both answers must be right; read the count in the stem |
| Read the whole SQL snippet | One `WHERE` vs `ON`, or `UNION` vs `UNION ALL`, changes the answer |
| Flag and move on | Never leave a question blank; come back to flags at the end |
