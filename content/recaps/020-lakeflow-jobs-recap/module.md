---
title: "Recap: Deploy Workloads with Lakeflow Jobs"
summary: Recap of course 2 of Data Engineering with Databricks. Build a job as a DAG of tasks, pick the right trigger, pass parameters and task values, and recover from failures with repair runs.
icon: 🗓️
level: Beginner
minutes: 8
group: Data Engineering with Databricks
tags: [Lakeflow Jobs, Orchestration, Triggers, Task values, Repair run]
---
# Recap: Deploy Workloads with Lakeflow Jobs

> Course 2 of 4. Turning notebooks, SQL and pipelines into **reliable, scheduled, observable** production workloads.

**The one idea to remember:** a job is a **DAG of tasks**. Dependencies, triggers, parameters and conditions decide *what* runs and *when*. Repair runs and notifications keep it healthy.

## 🗺️ What we covered

| Lesson | Key takeaway |
|---|---|
| 1 Creating a job | Single notebook task in the **Jobs UI**: configure, run, review the run |
| 2 Lab: multiple tasks | Several tasks with **dependencies**, building a DAG |
| 3 Scheduling options | **Scheduled**, **file arrival**, **continuous** triggers, plus **task parameters** |
| 4 Controlling the flow | **Run if** conditions, **repair runs**, **task values**, the **If/else** task |
| 5 Lab: modular orchestration | **Run Job** task: a parent ("master") job calling other jobs |

## 🕸️ Jobs, tasks and the DAG

The lab job: three ingest tasks, a cleaning task, then a branch. Step through one run.

```viz flow
{"nodes": [
  {"icon": "📥", "title": "Ingest", "sub": "no dependencies", "color": "bronze", "items": ["Ingest_Source_1", "Ingest_Source_2", "Ingest_Source_3"]},
  {"icon": "🧹", "title": "Clean_Data", "sub": "depends on all three", "color": "silver", "items": ["sets task value `bad_records`"]},
  {"icon": "🔀", "title": "If/else", "sub": "`bad_records > 0`", "color": "amber"},
  {"icon": "🌿", "title": "Branches", "sub": "only one runs", "color": "green", "items": ["true: Fix_Bad_Records", "false: Aggregate_Records"]}
 ],
 "edges": ["all succeeded", "task value", "condition"],
 "steps": [
  {"label": "Parallel start", "focus": [0], "note": "Tasks without dependencies run **in parallel**."},
  {"label": "Fan in", "focus": [1], "note": "`Clean_Data` depends on all three ingest tasks, so it starts when they have succeeded. It counts the bad records and stores the number as a **task value**."},
  {"label": "Branch", "focus": [2], "note": "The **If/else** task compares `{{tasks.Clean_Data.values.bad_records}} > 0`."},
  {"label": "One path", "focus": [3], "note": "The *true* branch fixes the bad records. The *false* branch goes straight to aggregation."}
 ]}
```

## 🧱 The building blocks

| Building block | What it is |
|---|---|
| **Job** | A named workflow with triggers, parameters, notifications and permissions |
| **Task** | One unit of work: notebook, Python script/wheel, **SQL**, **dashboard**, **pipeline**, dbt, **Run Job**, **If/else**, **For each** |
| **Dependency** | "Depends on" edges between tasks. Tasks without dependencies run **in parallel** |
| **Compute** | **Serverless** (recommended), a **job cluster** that tasks of the job can share, or a **SQL warehouse** for SQL and dashboard tasks |

Job clusters are created for the run and terminated afterwards. They are cheaper than all-purpose clusters, which are meant for interactive development.

## ⏰ Triggers: when does a job run?

| Trigger | Starts a run | Use when |
|---|---|---|
| **Manual / API** | *Run now*, REST API, another orchestrator | Ad hoc runs, testing |
| **Scheduled** | Cron-style schedule with a time zone (UI or cron syntax) | Data arrives at **known times**; reports due at fixed times |
| **File arrival** | New files in a UC **volume** or **external location** (checked about every minute; use **Test trigger** to verify the path) | Files arrive at **unpredictable** times |
| **Table update** | One or more UC tables are updated | Run right after an upstream team's table changes |
| **Continuous** | A new run starts as soon as the previous one ends | Always-on streaming workloads |

Data-driven triggers (file arrival, table update) avoid **empty runs** and runs that start **too early**.

## 🎛️ Parameters and dynamic values

| Kind | Example | Scope |
|---|---|---|
| **Job parameters** | `env = prod`, referenced as `{{job.parameters.env}}` | Pushed down to every task |
| **Task parameters** | `catalog = dbacademy` | One task |
| **Dynamic value references** | `{{job.id}}`, `{{job.run_id}}`, `{{job.start_time.iso_date}}`, `{{tasks.Clean_Data.values.bad_records}}` | Resolved at run time |
| **Task values** | `dbutils.jobs.taskValues.set / get` | Pass small results between tasks |

Parameters make one notebook reusable across catalogs, environments and dates. Never hard-code them.

## 📨 Parameters and task values in code

```python
# In the task notebook, read a task/job parameter like a widget
catalog = dbutils.widgets.get("catalog")

# Pass a value to downstream tasks
dbutils.jobs.taskValues.set(key="bad_records", value=5)
```

A downstream task reads the value with `dbutils.jobs.taskValues.get`, or references it in its settings as `{{tasks.Clean_Data.values.bad_records}}`, for example in an If/else condition.

## 🚦 Run if dependencies

When should a task with upstream tasks start? Step through a run where upstream task **A succeeded** and task **B failed**.

```viz table
{"title": "Downstream task with two upstream tasks: A succeeded, B failed",
 "columns": ["Run if", "Runs when", "Typical use", "Runs now?"],
 "rows": [["**All succeeded** (default)", "every upstream task succeeded", "Normal flow", "no"],
          ["At least one succeeded", "1 or more succeeded", "Partial-source processing", "yes"],
          ["None failed", "nothing failed", "Skip-tolerant flows", "no"],
          ["**All done**", "everything finished, whatever the result", "**Cleanup**, final notification", "yes"],
          ["At least one failed", "something failed", "**Alerting**, fallback", "yes"],
          ["All failed", "everything failed", "**Alerting**, fallback", "no"]],
 "steps": [
  {"label": "The options", "note": "Each task with dependencies has one **Run if** setting. The default is *All succeeded*."},
  {"label": "Default", "note": "B failed, so a task on *All succeeded* does not run. Its status is **Upstream failed**.", "hl": [0]},
  {"label": "Cleanup", "note": "*All done* only waits for the upstream tasks to finish. This is where cleanup and final notifications go.", "hl": [3]},
  {"label": "Alerting", "note": "*At least one failed* runs because B failed. *All failed* would need A to fail too.", "hl": [4, 5]}
 ]}
```

## 🔀 Branches and loops

```viz compare
{"items": [
  {"icon": "🔀", "title": "If/else condition task", "sub": "branch on a value", "color": "amber",
   "points": ["Condition such as `{{tasks.Clean_Data.values.bad_records}} > 0`", "*true* branch: fix the bad records", "*false* branch: go straight to aggregation", "Tasks on the branch not taken are not run"]},
  {"icon": "🔁", "title": "For each task", "sub": "loop over a list", "color": "teal",
   "points": ["Runs a nested task once per item of a list (for example per country)", "Each iteration gets the item as a parameter", "A **concurrency** setting controls how many run at once"]}
 ]}
```

## 🩹 Repair runs

After a failure, a **repair run** re-runs **only the failed tasks and their dependents**. Successful tasks are not executed again, which saves time and money.

```viz table
{"title": "A 5-task job",
 "columns": ["Task", "Depends on", "Run 1", "Repair run"],
 "rows": [["1 Ingest_A", "", "Succeeded", ""], ["2 Ingest_B", "", "Succeeded", ""],
          ["3 Clean_Data", "1, 2", "Failed", ""], ["4 Aggregate", "3", "Upstream failed", ""],
          ["5 Report", "4", "Upstream failed", ""]],
 "steps": [
  {"label": "Run 1 fails", "note": "Task 3 fails. Tasks 4 and 5 never start: their status is **Upstream failed**.", "hl": [2, 3, 4]},
  {"label": "Fix and repair", "note": "Fix the code, then choose **Repair run**. Tasks 1 and 2 keep their results and are not executed again.", "upd": {"0": {"Repair run": "not re-run"}, "1": {"Repair run": "not re-run"}}, "hl": [0, 1]},
  {"label": "Only what failed", "note": "Task 3 and its dependents 4 and 5 run in the repair.", "upd": {"2": {"Repair run": "Succeeded"}, "3": {"Repair run": "Succeeded"}, "4": {"Repair run": "Succeeded"}}, "hl": [2, 3, 4]}
 ]}
```

Other statuses to recognise: *Excluded* (condition not met), *Timed Out*, *Skipped*.

## ⏱️ Retries, timeouts and notifications

| Setting | What it does |
|---|---|
| **Retries** | Per task: a retry count and interval. Off by default for most tasks |
| **Timeout** | Maximum duration of a task. When exceeded, the status is *Timed Out*. With retries, it applies to each attempt |
| **Duration threshold** | Sends a **warning** only. It does not stop the task |
| **Notifications** | Email, Slack or webhooks on start, success, failure or duration warning, at job or task level |
| **Max concurrent runs** | Default **1**. Extra triggered runs are skipped unless **queueing** is enabled |

## 🧩 Modular orchestration: Run Job task

Split large workflows into **smaller, reusable jobs** owned by different people or teams. The parent job controls the order and passes parameters down.

```viz flow
{"nodes": [
  {"icon": "👑", "title": "Master_Job", "sub": "parent job: order and parameters", "color": "navy"},
  {"icon": "▶️", "title": "Run Job tasks", "sub": "run in parallel", "color": "blue", "items": ["Ingestion_Job", "Reference_Job"]},
  {"icon": "📊", "title": "Run Job: Reporting_Job", "sub": "depends on both", "color": "gold"}
 ],
 "edges": ["triggers", "both succeeded"],
 "steps": [
  {"label": "Parent", "focus": [0], "note": "The parent job contains only **Run Job** tasks and passes parameters down."},
  {"label": "Children", "focus": [1], "note": "Each child job keeps its own run history, permissions and compute settings."},
  {"label": "Reporting", "focus": [2], "note": "A 40-task workflow maintained by three teams becomes several small jobs wired together like this."}
 ]}
```

## ⚠️ Common mistakes

- ❌ Raising the duration **warning** threshold to fix *Timed Out* failures. It is the **timeout** that stops the task.
- ❌ Re-running the whole job after one task failed. Use **repair run**.
- ❌ Running production jobs on an **all-purpose** cluster. Use **serverless** or a **job cluster**.
- ❌ Hard-coding catalog or schema names in task notebooks. Use **parameters**.
- ❌ Expecting overlapping runs: max concurrent runs is **1** by default.

## 🧭 Cheat sheet

| Situation | Choose |
|---|---|
| Files land at random times during the day | **File arrival** trigger, not a 5-minute schedule |
| Downstream job must run after another team's table is refreshed | **Table update** trigger |
| A cleanup task must always run | Run if **All done** |
| Only the third of five tasks failed | **Repair run** |
| Different logic when bad records are found | **If/else** task with a **task value** |
| Same notebook for 12 countries | **For each** task with parameters |

**Next course:** *Build Data Pipelines with Lakeflow Spark Declarative Pipelines*, the pipelines these jobs will trigger.
