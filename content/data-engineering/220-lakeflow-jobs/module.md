---
title: Lakeflow Jobs
summary: Orchestrate notebooks, pipelines and SQL as a DAG of tasks. Learn how dependencies, Run if conditions, triggers, parameters and task values work, and how a repair run re-executes only what failed.
icon: 🗓️
level: Beginner
minutes: 11
group: Orchestration and DevOps
tags: [Lakeflow Jobs, Orchestration, Triggers, Parameters]
---
# Lakeflow Jobs

> A pipeline keeps tables up to date. A **job** decides **when** things run and **in which order**: ingest, then the pipeline, then a SQL refresh, then a notification, every night at two.

**The one idea to remember:** a job is a **graph of tasks**. Each task starts when its upstream tasks finish and its **Run if** condition holds, and a failed run can be **repaired** by re-running only the failed tasks and everything after them.

## 💡 Jobs, tasks and the DAG

A **job** has one or more **tasks**. Each task declares the tasks it `depends_on`, which makes a directed acyclic graph (DAG). Independent tasks run in parallel.

| Task family | Task types | Runs on |
|---|---|---|
| Code | Notebook, Python script, Python wheel, JAR | Serverless or a job cluster |
| SQL | SQL query or file, dbt | A SQL warehouse (dbt can also use a cluster) |
| Other objects | Pipeline, Dashboard, Run Job (another job) | Whatever that object uses |
| Control flow | If/else condition, For each | No compute of its own |

Prefer **serverless** for tasks: it starts in seconds and you do not size clusters. Use a **job cluster** (created for the run, deleted after it) when you need specific instance types, GPUs or init scripts. Never schedule production work on an all-purpose cluster.

## 🔗 Dependencies and Run if

By default a task runs only if **all** its upstream tasks succeeded. The `run_if` setting changes that.

| Run if | The task runs when… |
|---|---|
| `ALL_SUCCESS` (default) | every upstream task succeeded |
| `AT_LEAST_ONE_SUCCESS` | at least one upstream task succeeded |
| `NONE_FAILED` | no upstream task failed and at least one ran |
| `ALL_DONE` | all upstream tasks finished, whatever the result |
| `AT_LEAST_ONE_FAILED` | at least one upstream task failed |
| `ALL_FAILED` | every upstream task failed |

A task whose condition is not met does not fail. It gets a status such as **Upstream failed**, or **Excluded** for the branch an If/else task did not take. `ALL_DONE` is the usual choice for clean-up and notification tasks.

## 🩹 A failed run, then a repair

Step through one nightly run. `notify` uses `run_if: ALL_DONE`; the others use the default.

```viz flow
{"title": "orders_daily: run 1 fails, the repair finishes it",
 "nodes": [{"icon": "📥", "title": "ingest", "sub": "notebook", "color": "bronze"},
           {"icon": "🌊", "title": "build_silver", "sub": "pipeline", "color": "silver"},
           {"icon": "🏆", "title": "refresh_gold", "sub": "SQL", "color": "gold"},
           {"icon": "📣", "title": "notify", "sub": "run_if: ALL_DONE", "color": "blue"}],
 "edges": ["depends_on", "depends_on", "depends_on"],
 "steps": [
  {"label": "02:00 ingest", "focus": [0], "note": "The schedule fires and `ingest` succeeds in 40 minutes. Its output tables are written."},
  {"label": "build_silver fails", "focus": [1], "note": "The pipeline update fails on a schema change in the source. A retry would fail the same way, so this task has none."},
  {"label": "refresh_gold is skipped", "focus": [2], "note": "`ALL_SUCCESS` is not met, so the task never starts. Its status is **Upstream failed**."},
  {"label": "notify still runs", "focus": [3], "note": "`ALL_DONE` only needs every upstream task to be finished. It sends the failure message. The run ends as **Failed**."},
  {"label": "Fix, then repair", "focus": [1, 2, 3], "note": "After the fix, **Repair run** re-runs `build_silver` and everything downstream of it. `ingest` keeps its result and does **not** run again. The repair belongs to the same run."}
 ]}
```

A repair uses the **current** job and task settings, so fix the code or configuration first. You can also pass new parameter values to the repair.

## ⏰ Triggers: when does a run start?

```viz compare
{"title": "Four ways to start a job automatically",
 "items": [
  {"icon": "⏰", "title": "Scheduled", "sub": "Quartz cron + time zone", "color": "blue",
   "points": ["Runs at fixed times", "✅ simple, predictable", "❌ may run with no new data, or too early"]},
  {"icon": "📂", "title": "File arrival", "sub": "a UC volume or external location", "color": "amber",
   "points": ["Starts when new files land", "✅ no polling, no empty runs", "Good for irregular uploads"]},
  {"icon": "🔔", "title": "Table update", "sub": "one or more UC tables", "color": "green",
   "points": ["Starts when source tables change", "✅ chains work across teams", "No need to know the other team's schedule"]},
  {"icon": "♾️", "title": "Continuous", "sub": "always one run active", "color": "purple",
   "points": ["A new run starts when the last one ends", "For always-on streaming", "❌ cannot be combined with other triggers"]}
 ]}
```

Any job can also be started by hand, from the REST API or the CLI. By default a job allows **one** concurrent run; a run triggered while another is active is skipped, unless queueing is enabled.

## 🕒 The life of one task run

```viz timeline
{"title": "From trigger to final state",
 "items": [
  {"label": "trigger", "title": "Run created", "color": "navy", "note": "The schedule, a file arrival or a table update creates a run. Job parameters get their values now, including dynamic ones such as `{{job.start_time.iso_date}}`."},
  {"label": "pending", "title": "Compute starts", "color": "gray", "note": "Serverless is ready in seconds. A job cluster is created for this run and deleted when the run ends."},
  {"label": "running", "title": "Attempt 1", "color": "blue", "note": "`timeout_seconds` limits **each attempt**. A duration warning threshold only sends a notification; it does not stop the task."},
  {"label": "retry", "title": "Attempt 2", "color": "amber", "note": "With `max_retries` set, a failed attempt is retried after `min_retry_interval_millis`. Retry only tasks that are safe to run twice."},
  {"label": "failed", "title": "Retries used up", "color": "red", "note": "The task is **Failed**. Downstream tasks with the default Run if become Upstream failed."},
  {"label": "notify", "title": "Notifications", "color": "purple", "note": "`on_failure` notifications go out by email, Slack or webhook. They can be set per job or per task."},
  {"label": "repair", "title": "Repair run", "color": "green", "note": "Re-runs the failed task and its dependents with the current settings, as part of the same run."}
 ]}
```

## 🎛️ Parameters and task values

**Job parameters** are set once per run and pushed down to every task. **Task parameters** belong to one task. Both can use **dynamic value references** in double braces, resolved when the run starts.

```python
# In the notebook of task "ingest": parameters arrive as widgets
load_date = dbutils.widgets.get("load_date")         # job parameter, e.g. "{{job.start_time.iso_date}}"

new_rows = spark.table("orders_raw").where(f"order_date = '{load_date}'").count()
dbutils.jobs.taskValues.set(key="new_rows", value=new_rows)   # small, JSON-serializable values only

# A later task reads it, or an If/else task compares it:
#   {{tasks.ingest.values.new_rows}} > 0
n = dbutils.jobs.taskValues.get(taskKey="ingest", key="new_rows", default=0, debugValue=0)
```

Other references: `{{job.run_id}}`, `{{job.parameters.env}}`, `{{task.name}}`. A **For each** task loops over a list, often a task value, and passes each element as `{{input}}`.

## 📄 The job as YAML

Every job can be viewed and edited as code (**View as code** in the job UI). This is the job from the repair example, in the format the Jobs API and bundles use.

```viz code
title: orders_daily (job definition)
lang: yaml
---
name: orders-daily
parameters:
  - {name: load_date, default: "{{job.start_time.iso_date}}"}
schedule: {quartz_cron_expression: "0 0 2 * * ?", timezone_id: UTC}
email_notifications: {on_failure: [data-team@example.com]}
tasks:
  - task_key: ingest
    notebook_task: {notebook_path: /Workspace/etl/ingest, base_parameters: {source: orders}}
    max_retries: 2
    timeout_seconds: 3600
  - task_key: build_silver
    depends_on: [{task_key: ingest}]
    pipeline_task: {pipeline_id: 1a2b3c4d-0000-0000-0000-000000000000}
---
2-3 | job parameter | One value per run, visible to every task. The default is a dynamic reference: the date of the run.
4 | trigger | Quartz cron has a **seconds** field first: second 0, minute 0, hour 2, every day. Always set a time zone.
5 | notifications | Who hears about failures. Also `on_start`, `on_success` and duration warnings.
7-8 | first task | A notebook task with a task parameter. No `depends_on`, so it starts first.
9-10 | resilience | Up to 2 retries, and each attempt is stopped after one hour.
11-13 | dependency | `build_silver` waits for `ingest`. Add `run_if: ALL_DONE` to a task to change the default rule.
```

## 🧪 Try it: parameters in a notebook

```dataset retail
```

Creating a job needs the Jobs UI or API, so the definitions above are display-only. What you can try here is the notebook side: parameters arrive as **widgets**, and task values can be set.

```python run
# A job or task parameter arrives as a widget with the same name
dbutils.widgets.text("region", "EMEA", "Region")
dbutils.widgets.text("min_date", "2026-01-01", "Orders from")

region = dbutils.widgets.get("region")
min_date = dbutils.widgets.get("min_date")
print(f"region={region}  min_date={min_date}")
```

```python run
# Use the parameters in a query with named parameter markers, not string formatting
segments = spark.sql("""
    SELECT c.segment, count(*) AS orders
    FROM fact_orders o JOIN dim_customer c ON o.customer_id = c.customer_id
    WHERE c.region = :region AND o.order_date >= CAST(:min_date AS DATE) AND o.status = 'COMPLETED'
    GROUP BY c.segment ORDER BY orders DESC
""", args={"region": region, "min_date": min_date})
display(segments)
```

```python run
# Set a task value. Outside a job, set() does nothing and get() returns debugValue
dbutils.jobs.taskValues.set(key="segment_count", value=segments.count())

print(dbutils.jobs.taskValues.get(taskKey="report", key="segment_count", default=0, debugValue=-1))
```

> Change the `region` widget at the top of the notebook to `APAC` and re-run the query cell. In a job, a parameter named `region` sets the same widget. Without `debugValue`, `taskValues.get` raises an error when the notebook is not running as a job task.

## Exercise 1: what does a repair run re-run?

A run of this job failed. Write `repair_set` so that it returns the tasks a repair run would re-execute: every task that did not succeed, plus every task downstream of those.

```python todo
dag = {  # task -> its upstream tasks
    "ingest_orders": [],
    "ingest_customers": [],
    "build_silver": ["ingest_orders", "ingest_customers"],
    "refresh_gold": ["build_silver"],
    "export_csv": ["build_silver"],
    "notify": ["refresh_gold", "export_csv"],      # run_if: ALL_DONE
}
result = {"ingest_orders": "SUCCESS", "ingest_customers": "FAILED", "build_silver": "UPSTREAM_FAILED",
          "refresh_gold": "UPSTREAM_FAILED", "export_csv": "UPSTREAM_FAILED", "notify": "SUCCESS"}

def repair_set(dag, result):
    # TODO: start from the tasks that did not succeed, then add their downstream tasks
    return set()

print(sorted(repair_set(dag, result)))
```

```python solution
dag = {
    "ingest_orders": [],
    "ingest_customers": [],
    "build_silver": ["ingest_orders", "ingest_customers"],
    "refresh_gold": ["build_silver"],
    "export_csv": ["build_silver"],
    "notify": ["refresh_gold", "export_csv"],
}
result = {"ingest_orders": "SUCCESS", "ingest_customers": "FAILED", "build_silver": "UPSTREAM_FAILED",
          "refresh_gold": "UPSTREAM_FAILED", "export_csv": "UPSTREAM_FAILED", "notify": "SUCCESS"}

def repair_set(dag, result):
    todo = {t for t, state in result.items() if state != "SUCCESS"}
    changed = True
    while changed:                                   # add downstream tasks until nothing new appears
        new = {t for t, ups in dag.items() if t not in todo and any(u in todo for u in ups)}
        todo |= new
        changed = bool(new)
    return todo

rerun = repair_set(dag, result)
print(sorted(rerun))
assert "ingest_orders" not in rerun        # it succeeded: its result is kept
assert "notify" in rerun                   # it succeeded, but it is downstream of a re-run task
assert rerun == {"ingest_customers", "build_silver", "refresh_gold", "export_csv", "notify"}
```

## Exercise 2: write the schedules

Write Quartz cron expressions for two schedules. Quartz has six fields: second, minute, hour, day of month, month, day of week. One of the two day fields must be `?`.

```python todo
# TODO 1: every weekday (Monday to Friday) at 06:30 in Budapest
weekday_schedule = {"quartz_cron_expression": "FILL_IN", "timezone_id": "Europe/Budapest"}
# TODO 2: every 15 minutes, all day
every_15_min = {"quartz_cron_expression": "FILL_IN", "timezone_id": "UTC"}

for s in (weekday_schedule, every_15_min):
    assert len(s["quartz_cron_expression"].split()) in (6, 7), "Quartz needs 6 fields (7 with a year)"
print("Format OK")
```

```python solution
weekday_schedule = {"quartz_cron_expression": "0 30 6 ? * MON-FRI", "timezone_id": "Europe/Budapest"}
every_15_min = {"quartz_cron_expression": "0 0/15 * * * ?", "timezone_id": "UTC"}

sec, minute, hour, dom, month, dow = weekday_schedule["quartz_cron_expression"].split()
assert (sec, minute, hour) == ("0", "30", "6")
assert dom == "?" and dow == "MON-FRI"            # day of month is ? because day of week is set

sec, minute, hour, dom, month, dow = every_15_min["quartz_cron_expression"].split()
assert minute == "0/15" and hour == "*" and dow == "?"
print("Both schedules are correct")

# Clean up the widgets from the lecture when you are done
# dbutils.widgets.removeAll()
```

## ⚠️ Common mistakes

- ❌ Re-running the whole job after one late task failed. Use **Repair run**: finished upstream work is kept.
- ❌ A clean-up or alert task with the default Run if. It never runs after a failure; use `ALL_DONE` or `AT_LEAST_ONE_FAILED`.
- ❌ A schedule every 5 minutes to poll for files that arrive at random times. Use a **file arrival** trigger.
- ❌ Raising the duration warning to stop "Timed out" failures. The **timeout** is what stops a task.
- ❌ Passing data through task values. Pass a table name or a count, not rows.
- ✅ Retry only idempotent tasks, and set a timeout on every long task.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Run B after A | `depends_on: [{task_key: A}]` |
| Always run a final task | `run_if: ALL_DONE` |
| Branch or loop | If/else condition task, For each task |
| Start when data arrives | File arrival or table update trigger |
| Pass a small value to a later task | `dbutils.jobs.taskValues.set` and `{{tasks.<key>.values.<name>}}` |
| Finish a failed run | Repair run (failed tasks and their dependents) |
