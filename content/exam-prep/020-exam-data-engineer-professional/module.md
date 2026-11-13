---
title: "Data Engineer Professional: exam prep"
summary: What the Databricks Certified Data Engineer Professional exam covers, the facts and distinctions to know in each of its nine domains, and a three-week study plan.
icon: 🎓
level: Advanced
minutes: 15
group: Professional
tags: [Certification, Data Engineering, Lakeflow, Delta Lake]
---
# Data Engineer Professional: exam prep

> For data engineers with about a year of hands-on work on Databricks. Passing shows you can build, tune, secure, monitor and deploy production pipelines, not only write a correct query.

**The one idea to remember:** most questions are production scenarios where several answers would work, so pick the one that is **managed, incremental and least privilege** and that matches the constraint the scenario states (latency, cost, history, idempotency).

## 📋 The exam at a glance

| Item | Fact |
|---|---|
| Questions | **60 scored** multiple-choice, plus possible unscored items (time for them is included) |
| Time | **120 minutes**, so about 2 minutes per question |
| Code | Mainly Python (PySpark) and SQL; long scenarios with code, errors or query profiles |
| Fee | **USD 200** |
| Validity | **2 years**; recertify by taking the current exam |
| Delivery | Online proctored or test center, English, no test aides |

Databricks does **not publish the passing score**. This guide follows the exam guide published **October 9, 2026** (9 domains, 60 questions). The exam page may still show an older 10-section outline with 59 questions, so check the official page two weeks before your date.

## 🗺️ Domains and weights

```viz layers
{"title": "Nine domains, weighted by share of the exam",
 "layers": [
  {"icon": "🛠️", "title": "Developing Code for Data Processing · 23%", "color": "navy", "items": ["Lakeflow Pipelines and AUTO CDC", "Streaming state and checkpoints", "Jobs control flow, serverless settings", "UDFs and tests"]},
  {"icon": "⚡", "title": "Cost & Performance Optimization · 15%", "color": "amber", "items": ["Liquid Clustering, CLUSTER BY AUTO", "Predictive Optimization, deletion vectors", "Query profile, caches, CDF"]},
  {"icon": "📥", "title": "Data Ingestion & Acquisition · 12%", "color": "bronze", "items": ["Auto Loader, Kafka, Kinesis, Pub/Sub", "Lakeflow Connect database CDC", "OpenSharing, Clean Rooms, Federation"]},
  {"icon": "🔀", "title": "Data Manipulation · 12%", "color": "teal", "items": ["Window functions and joins", "VARIANT", "ai_query, expectations"]},
  {"icon": "📈", "title": "Monitoring and Alerting · 10%", "color": "blue", "items": ["System tables", "Pipeline event log", "SQL alerts, Jobs API"]},
  {"icon": "🚀", "title": "Debugging and Deploying · 10%", "color": "green", "items": ["Spark UI and logs", "Repair runs", "Bundles and Git folders"]},
  {"icon": "🔐", "title": "Ensuring Data Security and Compliance · 8%", "color": "red", "items": ["Least privilege", "ABAC with governed tags", "GDPR purging"]},
  {"icon": "🏷️", "title": "Data Governance · 5%", "color": "purple", "items": ["Tags and comments", "Permission inheritance"]},
  {"icon": "⭐", "title": "Data Modeling · 5%", "color": "gold", "items": ["Table layout by grain", "Star schema, MVs, metric views"]}
 ]}
```

Half of the exam is the top three domains: spend half of your study time on pipelines, streaming state, jobs and table optimization.

## 🛠️ Developing code (1): pipelines and AUTO CDC

- **Streaming table** processes each input row once: low-latency, append-heavy ingestion. **Materialized view** always shows the correct result: aggregates, late updates and deletes, joins to a changing dimension.
- Choose **Lakeflow Spark Declarative Pipelines** (formerly Delta Live Tables) for managed retries, checkpoints, expectations and lineage. Choose plain **Structured Streaming** for custom `foreachBatch` sinks or `transformWithState`.
- **Triggered** mode for an SLA of hours, **continuous** for seconds. A full refresh of a streaming table loses data that is gone from the source.

```viz code
title: AUTO CDC (formerly APPLY CHANGES)
lang: sql
---
CREATE FLOW customers_flow AS AUTO CDC INTO customers_silver
FROM STREAM(customers_cdc_clean)
KEYS (customer_id)
APPLY AS DELETE WHEN op = 'DELETE'
SEQUENCE BY event_ts
COLUMNS * EXCEPT (op, event_ts)
STORED AS SCD TYPE 2;
---
1-2 | Target and source | The target is a streaming table. Clean the raw feed in a view first.
3 | KEYS | One current row per key. Python: `dp.create_auto_cdc_flow(keys=[...])`.
4 | Deletes | `APPLY AS TRUNCATE` exists too, but only for SCD Type 1.
5 | SEQUENCE BY | Orders events per key, so out-of-order events land correctly. It must not be NULL.
7 | SCD type | Type 1 overwrites. Type 2 keeps versions with `__START_AT` and `__END_AT`; current rows have `__END_AT IS NULL`.
```

## ⚙️ Developing code (2): streaming state, jobs, compute, tests

| If the scenario says | The answer is usually |
|---|---|
| State keeps growing in an aggregation or `dropDuplicates` | Add a **watermark** (`dropDuplicatesWithinWatermark` for bounded dedup) |
| A scheduled job must drain the backlog and stop | `trigger(availableNow=True)`; `once` is deprecated |
| Upsert a stream into Delta | `foreachBatch` with `MERGE`, made **idempotent** (at-least-once) |
| Changed grouping keys or window of a stateful query | A **new checkpoint**; never share or delete one to "fix" it |
| 20 copied tasks that differ by one value | A **For each** task (concurrency up to 100) |
| Serverless job that sends payments | Disable **auto-optimization** retries |

Also know: serverless **high memory** is for notebook tasks only, and **standard** mode is cheaper but can take 4-6 minutes to start. Test with `assertDataFrameEqual` and `assertSchemaEqual`. Prefer built-ins, then SQL UDFs, then Pandas UDFs; row-at-a-time Python UDFs are slowest.

## 📥 Data ingestion and acquisition

| Need | Use |
|---|---|
| New files in cloud storage (JSON, CSV, Parquet, PDFs) | **Auto Loader**; `binaryFile` for documents, `_rescued_data` for surprises |
| Kafka, Kinesis, Pub/Sub | Streaming source; Kafka `value` is **binary**, so parse it with `from_json` or `from_avro` |
| Replicate SQL Server, MySQL, PostgreSQL with deletes | **Lakeflow Connect**: gateway, staging volume, serverless pipeline |
| Ad hoc query of a live external database | **Lakehouse Federation**: connection, foreign catalog, UC grants |
| Live data to a partner on Databricks or elsewhere | **OpenSharing** (formerly Delta Sharing): D2D or Databricks-to-Open |
| Joint analysis where raw PII may not leave | **Clean Rooms**: up to 10 collaborators, approved notebooks |

`startingOffsets` applies only to a new query: the checkpoint wins on restart. Federation is read-only querying in place, not replication. Share a table `WITH HISTORY` so recipients can stream it or read its change feed.

## 🔀 Data manipulation

- **Window functions**: `row_number` for dedup (`QUALIFY ... = 1`), not `rank`. `last_value` needs a frame up to `UNBOUNDED FOLLOWING`. `lag`/`lead` for sessionization. A window with no `PARTITION BY` runs in one task.
- **VARIANT** stores JSON flexibly and fast: `parse_json` (or `try_parse_json` for dirty input), colon paths `payload:device.id::string`, `variant_get`, `try_variant_get`, `variant_explode`. Typical design: VARIANT in bronze, typed columns in silver.
- **AI functions**: `ai_query` calls any serving endpoint; `failOnError => false` returns errors as data. Use a streaming table so each row is inferred once.
- **Expectations**: choose the action from what must happen to bad rows.

```viz compare
{"title": "Three expectation actions, plus the quarantine pattern",
 "items": [
  {"icon": "⚠️", "title": "warn (default)", "sub": "EXPECT (...)", "color": "amber", "points": ["Bad rows are **kept**", "Counts go to the event log", "Update continues"]},
  {"icon": "🗑️", "title": "drop", "sub": "ON VIOLATION DROP ROW", "color": "blue", "points": ["Bad rows are removed", "Update continues", "❌ rows are gone for review"]},
  {"icon": "🛑", "title": "fail", "sub": "ON VIOLATION FAIL UPDATE", "color": "red", "points": ["Update **fails and rolls back**", "For hard rules only"]},
  {"icon": "🧺", "title": "quarantine", "sub": "flag, then split", "color": "green", "points": ["Clean rows flow on", "Bad rows land in a review table", "✅ when rows must be reviewed"]}
 ]}
```

## 📈 Monitoring and alerting

| Question | Where to look |
|---|---|
| What did this job cost? | `system.billing.usage` joined to `system.billing.list_prices` |
| Who read or changed this table? | `system.access.audit` |
| How did runs behave over months? | `system.lakeflow` tables such as `job_run_timeline` |
| Is this run healthy right now? | Jobs UI, Jobs REST API, CLI or SDK (`runs/get`) |
| Rows, backlog and expectation results of a pipeline | Pipeline **event log**, `flow_progress` events |
| Notify on a metric, cost or quality signal | **Databricks SQL alerts** (states `OK`, `TRIGGERED`, `ERROR`) |

The guide says "Lakehouse alerts"; the docs say Databricks SQL alerts. An alert can run as a job task, so a job can branch on it. System tables are account-wide (filter by `workspace_id`) and show history; APIs show live state.

## ⚡ Cost, performance and table layout

```viz compare
{"title": "Choosing a table layout",
 "items": [
  {"icon": "💧", "title": "Liquid Clustering", "sub": "CLUSTER BY (a, b)", "color": "teal", "points": ["✅ default when filters are known", "Up to 4 keys, high cardinality is fine", "Change keys without a rewrite"]},
  {"icon": "🤖", "title": "CLUSTER BY AUTO", "sub": "managed tables + PO", "color": "green", "points": ["✅ access pattern unknown or shifting", "Keys chosen from the workload"]},
  {"icon": "🗂️", "title": "Partitioning", "sub": "PARTITIONED BY", "color": "amber", "points": ["Only TB-scale tables", "Low-cardinality, matches load or retention", "❌ never by customer_id"]},
  {"icon": "🧮", "title": "ZORDER", "sub": "legacy", "color": "gray", "points": ["Rewrites everything each time", "❌ not with liquid tables"]}
 ]}
```

- **Predictive Optimization** on UC managed tables runs `OPTIMIZE`, `VACUUM` and `ANALYZE` for you. **Deletion vectors** make frequent `MERGE`, `UPDATE` and `DELETE` cheap.
- **Query profile**: bytes pruned near 0 means no data skipping (often `date(ts)` on a column clustered by `ts`); one task far above the median means skew; a sort-merge join with a tiny side means a missed broadcast.
- **Disk (Delta) cache** speeds repeated reads and invalidates itself. **CDF** exposes row changes, only from when it was enabled.
- **Modeling**: define the grain first. Materialized views for fast aggregates at a fixed grain, **metric views** for one governed metric definition. PK and FK constraints are informational.

## 🔐 Security, compliance and governance

- **Read a table = three grants**: `USE CATALOG` + `USE SCHEMA` + `SELECT`. There is no `DENY` in Unity Catalog. A grant on a catalog or schema covers current **and future** objects.
- Grant to **groups**, run production jobs as **service principals**. A job reads data as its run-as identity.
- **ABAC**: a policy on a catalog applies a mask or row filter to every column with a **governed tag**, now and in future tables. Per-table `SET MASK` does not scale.
- **De-identification**: keyed hashing stays joinable and is not reversible, tokenization is reversible through a vault. Pseudonymized data is still personal data.

```viz flow
{"title": "GDPR right to erasure with Delta",
 "nodes": [
  {"icon": "🧾", "title": "DELETE / MERGE", "sub": "bronze first", "color": "red"},
  {"icon": "🔁", "title": "Propagate", "sub": "silver, gold via CDF", "color": "silver"},
  {"icon": "🩹", "title": "REORG PURGE", "sub": "rewrite DV files", "color": "amber"},
  {"icon": "🧹", "title": "VACUUM", "sub": "after retention", "color": "navy"}
 ],
 "edges": ["changes", "rows still in files", "old files"],
 "steps": [
  {"label": "Delete", "focus": [0], "note": "Delete the subject's rows from a control table of requests. With deletion vectors the rows are only **marked**, and time travel can still see them."},
  {"label": "Propagate", "focus": [1], "note": "Downstream tables hold copies too. Use CDF or DML, and `skipChangeCommits` for streams that read the changed table."},
  {"label": "Purge", "focus": [2], "note": "`REORG TABLE t APPLY (PURGE)` rewrites the files so the deleted rows are physically gone from current files."},
  {"label": "Vacuum", "focus": [3], "note": "`VACUUM` removes the old files once they pass the retention period. Running it before the purge leaves the data in place."}
 ]}
```

## 🚀 Debugging and deploying

- **Evidence**: skew and spill in Spark UI **Stages** (task min, median, max); Python and library errors in driver logs; serverless and SQL performance in the **query profile**.
- **Repair run**: re-runs failed and skipped tasks and their dependents, keeps successful results, accepts parameter overrides, and uses the **current** job settings.
- `PERMISSION_DENIED` in a job: grant the **run-as** principal, not the user who clicked Run.

```viz flow
{"title": "Git-based CI/CD with Declarative Automation Bundles",
 "nodes": [
  {"icon": "🌿", "title": "Git folder", "sub": "feature branch", "color": "gray"},
  {"icon": "🧪", "title": "CI", "sub": "unit tests, bundle validate", "color": "blue"},
  {"icon": "🧫", "title": "Staging", "sub": "deploy -t staging", "color": "amber"},
  {"icon": "🏭", "title": "Production", "sub": "deploy -t prod", "color": "green"}
 ],
 "edges": ["pull request", "deploy", "merge"],
 "steps": [
  {"label": "Develop", "focus": [0], "note": "Work in a personal **Git folder** (formerly Repos) on a branch, with logic in `src/` modules."},
  {"label": "Test", "focus": [1], "note": "The PR runs pytest and `bundle validate`. CI signs in as a service principal with OAuth, not a PAT."},
  {"label": "Stage", "focus": [2], "note": "Deploy to staging and run integration tests. `${var.catalog}` switches the catalog per target."},
  {"label": "Promote", "focus": [3], "note": "The same commit is deployed with `mode: production` and `run_as` a service principal. Deploy is declarative and idempotent."}
 ]}
```

## 🪤 Typical traps

- ❌ A hand-written `MERGE` "because events arrive out of order". ✅ AUTO CDC with `SEQUENCE BY`; `FROM SNAPSHOT` for full daily dumps.
- ❌ Complete output mode to keep state small. ✅ A watermark; complete mode keeps all state.
- ❌ Partitioning a 500 GB table, or by a high-cardinality key. ✅ Liquid Clustering or `CLUSTER BY AUTO`.
- ❌ More workers when bytes pruned is 0%, or for a driver OOM. ✅ Fix the filter or layout; reduce driver-side work.
- ❌ `DELETE` alone satisfies GDPR. ✅ Purge deletion vectors, vacuum, and clean downstream copies.
- ❌ Granting `SELECT` without `USE CATALOG` and `USE SCHEMA`, or using `ALL PRIVILEGES` for a service principal.
- ❌ Rerunning the whole job, or editing it for one date. ✅ A repair run with a parameter override.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks to exam day",
 "items": [
  {"label": "Days 1-3", "title": "Pipelines and CDC", "color": "navy", "note": "Study **Lakeflow Spark Declarative Pipelines**, **CDC and slowly changing dimensions** and **Data quality with expectations**. Build one pipeline with a streaming table, a materialized view and an AUTO CDC flow."},
  {"label": "Days 4-6", "title": "Streaming and ingestion", "color": "bronze", "note": "Study **Structured Streaming basics**, **Watermarks and stateful streaming** and **Auto Loader and COPY INTO**. Write down which change needs a new checkpoint."},
  {"label": "Days 7-9", "title": "Optimization", "color": "amber", "note": "Study **Optimizing Delta tables**, **Deletion vectors**, **Change Data Feed**, **How Spark runs your code** and **Joins and shuffles**. Open a query profile and find bytes pruned, spill and the join type."},
  {"label": "Days 10-12", "title": "Jobs, deploy, monitor", "color": "green", "note": "Study **Lakeflow Jobs**, **Bundles and CI/CD** and **Lineage and system tables**. Deploy a bundle to two targets and write one cost query on `system.billing.usage`."},
  {"label": "Days 13-15", "title": "Security, sharing, modeling", "color": "purple", "note": "Study **Unity Catalog privileges**, **Row filters and column masks**, **Delta Sharing**, **Time travel, RESTORE and VACUUM**, **Metric views** and **AI Functions and AI Gateway**."},
  {"label": "Days 16-21", "title": "Timed practice", "color": "red", "note": "Take full timed practice exams (60 questions, 120 minutes). **Review every wrong answer** and every lucky guess, and reread the notes for its domain before the next attempt. Aim for 80% or more on unseen tests."}
 ]}
```

## 🧭 Exam-day checklist

| Do | Why |
|---|---|
| Budget about 2 minutes per question | Long scenarios eat time; do not stall on one |
| Underline the constraint: latency, cost, history, "minimal effort", "least privilege" | It decides between two working answers |
| Flag and move on after 3 minutes | Come back with the time you saved |
| Read the code and error text before the options | The error often names the fix (`UNRESOLVED_COLUMN`, `ConcurrentAppendException`) |
| Prefer the managed, current feature | AUTO CDC, Liquid Clustering, ABAC, bundles over hand-built versions |
| Answer every question | A blank answer scores nothing; guess, flag and revisit |
