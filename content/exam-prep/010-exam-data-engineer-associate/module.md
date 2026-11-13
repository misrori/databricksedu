---
title: "Data Engineer Associate: exam prep"
summary: What the Databricks Certified Data Engineer Associate exam covers, the facts and distinctions each domain tests, the classic traps, and a three-week study plan.
icon: 🎓
level: Intermediate
minutes: 14
group: Associate
tags: [Certification, Data Engineering, Lakeflow, Unity Catalog]
---
# Data Engineer Associate: exam prep

> The exam is for engineers who build their first production pipelines on Databricks: ingest data into Unity Catalog, clean and model it, orchestrate it with Lakeflow Jobs, deploy it with bundles and keep it governed. Passing shows you can pick the right Databricks tool for a typical data engineering scenario.

**The one idea to remember:** almost every question is a scenario with one deciding constraint ("least maintenance", "files arrive at random times", "all current and future tables"). Find that phrase first, then pick the most managed Databricks option that satisfies it.

## 📋 The exam at a glance

| Item | Details |
|---|---|
| **Questions** | 45 scored, plus up to 10 unscored items |
| **Time** | 90 minutes (extra time for unscored items is included) |
| **Format** | Single-answer multiple choice |
| **Fee** | USD 200 |
| **Delivery** | Online proctored or at a test center. No test aides |
| **Validity** | 2 years. Renew with the renewal exam or the current full exam |

- **Passing score:** Databricks does not publish one. Aim for 80% or more on practice tests you have not seen before.
- **Version:** the current exam was published on May 4, 2026 (guide updated August 6, 2026).

## 🗺️ Domains and weights

```viz layers
{"layers": [
  {"icon": "🏛️", "title": "Databricks Intelligence Platform · 6%", "sub": "architecture and compute", "color": "navy", "items": ["Control vs compute plane", "Delta Lake and Unity Catalog", "Choosing compute"]},
  {"icon": "📥", "title": "Data Ingestion and Loading · 21%", "sub": "getting data in", "color": "bronze", "items": ["COPY INTO", "Auto Loader schema evolution", "Lakeflow Connect, JDBC, REST"]},
  {"icon": "🧹", "title": "Data Transformation and Modeling · 22%", "sub": "bronze to gold", "color": "silver", "items": ["Joins, unions, explode", "Deduplication and aggregation", "Views, MVs, streaming tables", "Expectations"]},
  {"icon": "⏱️", "title": "Working with Lakeflow Jobs · 16%", "sub": "orchestration", "color": "blue", "items": ["Task types and Run if", "If/else and For each", "Triggers"]},
  {"icon": "🚀", "title": "Implementing CI/CD · 10%", "sub": "code to prod", "color": "purple", "items": ["Git folders", "Bundle variables and targets", "Databricks CLI"]},
  {"icon": "🔧", "title": "Troubleshooting, Monitoring, and Optimization · 10%", "sub": "keep it healthy", "color": "amber", "items": ["Run history and task graph", "Skew, shuffle, spill", "Liquid clustering, predictive optimization"]},
  {"icon": "🛡️", "title": "Governance and Security · 15%", "sub": "who sees what", "color": "green", "items": ["Managed vs external tables", "GRANT and REVOKE", "Row filters, column masks, ABAC"]}
 ]}
```

Ingestion and transformation together are 43% of the exam, so spend about half your study time there. Jobs and governance come next.

## 🏛️ Platform and compute · 6%

The **control plane** (UI, scheduler, Unity Catalog metadata) is run by Databricks. **Classic** compute runs VMs in your cloud account. **Serverless** runs in the Databricks account. Data stays in your object storage: Delta Lake makes it reliable tables, Unity Catalog decides who may use it.

| Scenario | Choose |
|---|---|
| Many analysts, ad hoc SQL and BI dashboards | **Serverless SQL warehouse** |
| Nightly ETL notebook, no special needs | **Serverless jobs** (or job compute) |
| Scheduled job needing an init script, GPU or a specific instance type | **Job compute** (cheaper DBU rate than all-purpose) |
| Interactive development | **All-purpose compute** with auto-termination, or serverless notebooks |

Never schedule production jobs on all-purpose compute: it has the highest rate. Access modes were renamed: **standard** (formerly shared) and **dedicated** (formerly single user).

## 📥 Data ingestion and loading · 21%

Databricks says: **start with the most managed option** that supports the source.

```viz compare
{"title": "Which ingestion tool?",
 "items": [
  {"icon": "📋", "title": "COPY INTO", "sub": "SQL, batch", "color": "bronze", "points": ["Idempotent: already loaded files are skipped", "Thousands of files", "`mergeSchema` to add columns", "`force` reloads everything"]},
  {"icon": "🔁", "title": "Auto Loader", "sub": "`cloudFiles` stream", "color": "blue", "points": ["Millions of files, exactly-once via checkpoint", "`availableNow` = incremental batch", "Schema hints and `_rescued_data`", "Directory listing or file notification"]},
  {"icon": "🔌", "title": "Lakeflow Connect", "sub": "managed connectors", "color": "teal", "points": ["SaaS apps and databases", "CDC handled for you", "Lands UC streaming tables", "Least maintenance"]},
  {"icon": "🧑‍💻", "title": "JDBC / REST code", "sub": "last resort", "color": "gray", "points": ["You own pagination and incrementality", "JDBC: set `partitionColumn`, bounds, `numPartitions`", "Credentials from secrets", "Schedule with Lakeflow Jobs"]}
 ]}
```

- **`addNewColumns`** (default): the stream fails once, then picks up the new column on restart. **`rescue`**: never evolves, extra data goes to `_rescued_data`. **`failOnNewColumns`**: stops until you fix the schema.
- JSON and CSV columns are inferred as strings unless `cloudFiles.inferColumnTypes` is true. **Lakehouse Federation** queries a source in place: it is not ingestion.

## 🧹 Transformation: bronze to silver · 22%

| Task | What the exam expects |
|---|---|
| **Types and nulls** | `try_cast` returns NULL on bad input. Plain `cast` fails under ANSI mode (default on serverless and SQL warehouses) |
| **Joins** | `left` keeps facts without a match, `left_anti` finds orphans, `broadcast()` the **small** side (auto below 10 MB) |
| **Unions** | DataFrame `union` matches by **position** and keeps duplicates. Use `unionByName` when column order differs |
| **Arrays** | `explode` drops rows with NULL or empty arrays, `explode_outer` keeps them |
| **Dedup** | `dropDuplicates(["id"])` keeps an arbitrary row. For "the latest", use `row_number()` over a window (or `QUALIFY`) |
| **Counts** | `count(col)` ignores NULLs. `approx_count_distinct` is far cheaper than an exact distinct count |

Tuning: `spark.sql.shuffle.partitions` (default 200) controls DataFrame shuffles; `spark.default.parallelism` only affects RDDs. Driver and executor memory are cluster settings, not `spark.conf.set`. Change one setting, then **re-measure**.

## 🏆 Transformation: gold objects and quality

```viz compare
{"title": "Four gold-layer objects in Unity Catalog",
 "items": [
  {"icon": "👓", "title": "View", "sub": "stores nothing", "color": "gray", "points": ["Recomputed at every query", "Light logic or a security layer"]},
  {"icon": "🏆", "title": "Materialized view", "sub": "precomputed result", "color": "gold", "points": ["Fresh as of the last refresh", "Correct when sources update or delete", "Heavy aggregates read by many"]},
  {"icon": "🌊", "title": "Streaming table", "sub": "incremental", "color": "blue", "points": ["Each source row processed once", "Ingestion and append-only silver"]},
  {"icon": "🧱", "title": "Table", "sub": "managed Delta", "color": "navy", "points": ["Whatever your job writes", "`MERGE`, SCD logic, full control"]}
 ]}
```

- Pipeline **expectations**: plain `EXPECT` only **warns**, `ON VIOLATION DROP ROW` removes bad rows, `ON VIOLATION FAIL UPDATE` stops the update. Metrics go to the pipeline event log.
- A Delta `CHECK` or `NOT NULL` constraint fails the **whole write**. Primary and foreign keys are informational only.

## ⏱️ Working with Lakeflow Jobs · 16%

```viz flow
{"title": "A job is a DAG of tasks",
 "nodes": [
  {"icon": "📥", "title": "ingest", "sub": "notebook task", "color": "bronze"},
  {"icon": "🧹", "title": "build_silver", "sub": "pipeline task", "color": "silver"},
  {"icon": "🔀", "title": "has_new_rows", "sub": "If/else task", "color": "purple"},
  {"icon": "📊", "title": "refresh_gold", "sub": "SQL + dashboard", "color": "gold"},
  {"icon": "🧽", "title": "cleanup", "sub": "Run if: All done", "color": "gray"}
 ],
 "edges": ["depends on", "depends on", "true", "always"],
 "steps": [
  {"label": "Trigger", "focus": [0], "note": "Files land at random times, so a **file arrival** trigger on a UC volume or external location starts the run. Fixed times: **scheduled**. Upstream tables change: **table update**. Always on: **continuous**."},
  {"label": "Dependencies", "focus": [0, 1], "note": "A task waits for its upstream tasks. The default Run if is **All succeeded**. If that fails, the task shows **Upstream failed**."},
  {"label": "Branch", "focus": [2], "note": "The If/else task compares a value, often a **task value**: `{{tasks.ingest.values.new_rows}} > 0`. Set it with `dbutils.jobs.taskValues.set`. **For each** loops a nested task over an array."},
  {"label": "Retries and timeouts", "focus": [3], "note": "A **timeout** kills the task (Timed Out) and applies to each retry attempt. A **duration warning** only notifies. Most tasks are not retried by default."},
  {"label": "Always clean up", "focus": [4], "note": "A cleanup or notification task uses **All done**, so it runs whatever happened upstream. After a failure, a **repair run** re-runs only failed tasks and their dependents."}
 ]}
```

Max concurrent runs defaults to **1**: extra runs are skipped unless queueing is on.

## 🚀 Implementing CI/CD · 10%

**Git folders** (formerly Repos): branch, commit, push and pull in the Git dialog. The pull request itself is created and merged in the Git provider. **Declarative Automation Bundles** (formerly Databricks Asset Bundles) deploy the same code to every target.

```viz code
title: databricks.yml
lang: yaml
---
bundle:
  name: orders_etl
variables:
  catalog:
    default: dev
targets:
  dev:
    mode: development
    default: true
  prod:
    mode: production
    variables:
      catalog: prod
    run_as:
      service_principal_name: "<application-id>"
---
1-2 | bundle | The project name. Jobs and pipelines are declared under `resources`, usually in included files.
3-5 | variables | Declared once, used as `${var.catalog}`. Precedence: `--var` flag, then `BUNDLE_VAR_catalog`, then the target value, then the default.
7-9 | development | Resource names get a `[dev <user>]` prefix and **schedules are paused**. Every developer gets an isolated copy.
10-14 | production | The target overrides the variable and runs as a **service principal**. Only variables differ between targets.
```

CLI order in CI: `databricks bundle validate -t prod`, then `deploy -t prod`, then `run`. Secrets never go into `databricks.yml`.

## 🔧 Troubleshooting, monitoring and optimization · 10%

| Symptom | Diagnosis and fix |
|---|---|
| A task is slower than its usual runs | Compare against the baseline in the job's **run history** |
| Many tasks show Upstream failed | Open the task graph and fix the **first** failed task |
| One task runs minutes, the rest seconds; max shuffle read far above median | **Skew**: AQE skew join, salting. More workers do not help |
| Spill (memory or disk) above zero | Partitions too big: **more** shuffle partitions or more memory |
| Driver out of memory | `collect()` or `toPandas()` on big data. More workers do not help |
| Cluster does not start | Event log: cloud quota, instance type, failing init script |

**Liquid clustering** (`CLUSTER BY`, keys changeable, `CLUSTER BY AUTO`) replaces partitioning and `ZORDER` and cannot be combined with them. **Predictive optimization** runs `OPTIMIZE`, `VACUUM` and `ANALYZE` on **managed** tables only.

## 🛡️ Governance and security · 15%

| Topic | What to know |
|---|---|
| **Managed vs external** | `DROP` deletes managed data (`UNDROP` within 7 days). External files stay. `SET MANAGED` converts external to managed (DBR 17.3 LTS+ or serverless), `UNSET MANAGED` undoes it within 14 days |
| **Reading a table** | `USE CATALOG` + `USE SCHEMA` + `SELECT`. A grant on a schema covers all current **and future** tables |
| **REVOKE** | Removes a grant at that level only. An inherited privilege is revoked on the parent |
| **DENY** | Not a Unity Catalog statement. It exists only for legacy `hive_metastore` table ACLs |
| **Row filters, masks** | SQL UDFs with `is_account_group_member()`. A filter returns BOOLEAN. One filter per table |
| **ABAC** | Policies on a catalog or schema match **governed tags**, so new tagged tables are protected automatically |

Grant to groups, and run production jobs as service principals.

## 🪤 Typical traps

- ❌ "COPY INTO reloads every file on each run." It skips files it already loaded.
- ❌ "`rescue` mode adds new columns." It never evolves the schema.
- ❌ A custom REST poller for Salesforce. ✅ A Lakeflow Connect managed connector.
- ❌ A view for a heavy aggregation read all morning. ✅ A materialized view.
- ❌ Raising the duration warning to stop Timed Out failures. ✅ Raise the task **timeout**.
- ❌ A schedule every 5 minutes to poll for files. ✅ A file arrival trigger.
- ❌ Fewer shuffle partitions to fix skew or spill. That makes partitions bigger.
- ❌ Old names as "new" products: Delta Live Tables, Databricks Asset Bundles, Repos, Workflows are all renamed.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks to exam day",
 "items": [
  {"label": "Days 1-2", "title": "Platform and Delta", "color": "navy", "note": "Study **Lakehouse architecture**, **Unity Catalog basics** and **Anatomy of a Delta table**. Write down the compute decision table from memory."},
  {"label": "Days 3-5", "title": "Ingestion", "color": "bronze", "note": "Study **Auto Loader and COPY INTO**, **Structured Streaming basics** and **Schema enforcement and evolution**. Run COPY INTO twice and watch it skip files."},
  {"label": "Days 6-8", "title": "Transformation", "color": "silver", "note": "Study **Medallion architecture**, **Joins and shuffles**, **UPDATE, DELETE and MERGE**, **Lakeflow Spark Declarative Pipelines** and **Data quality with expectations**."},
  {"label": "Days 9-11", "title": "Jobs and CI/CD", "color": "blue", "note": "Study **Lakeflow Jobs** and **Bundles and CI/CD**. Build one job with an If/else task and deploy one bundle to a dev target."},
  {"label": "Days 12-14", "title": "Tuning and governance", "color": "green", "note": "Study **How Spark runs your code**, **Optimizing Delta tables**, **Unity Catalog privileges** and **Row filters and column masks**."},
  {"label": "Days 15-18", "title": "Timed practice exams", "color": "red", "note": "Take full practice exams under exam conditions: 45 questions, 90 minutes. Review **every** wrong answer, find the deciding constraint you missed, and re-read that domain."},
  {"label": "Days 19-21", "title": "Close the gaps", "color": "gold", "note": "One more unseen timed exam. Book the real one when you score 80% or more on tests you have not seen."}
 ]}
```

## 🧭 Exam-day checklist

| Do | Why |
|---|---|
| Budget about 1.5 minutes per question | 90 minutes for 45 scored plus up to 10 unscored items |
| Underline the constraint words first | "least maintenance", "lowest cost", "future tables", "random times" decide the answer |
| Flag long code questions and come back | One hard PySpark snippet should not cost five easy points |
| Eliminate options with old names or invented features | `DENY` in Unity Catalog, "DBFS copies for rollback" |
| Pick the most managed option that fits | Managed connectors, serverless, materialized views, predictive optimization |
| Answer every question before time runs out | An empty answer can never score |
