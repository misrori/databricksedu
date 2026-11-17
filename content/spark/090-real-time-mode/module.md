---
title: Real-time mode in Structured Streaming
summary: See where micro-batch latency comes from, how real-time mode removes it with long-running batches, which cluster settings it needs, and when an availableNow micro-batch stream is still the better choice.
icon: ⚡
level: Advanced
minutes: 12
group: Stream processing
tags: [Structured Streaming, Real-time mode, Kafka, Latency, Triggers]
---
# Real-time mode in Structured Streaming

> A micro-batch stream wakes up, plans a batch, processes it, commits it, and only then looks for new data. That rhythm costs seconds. **Real-time mode** (Public Preview) keeps one long batch running and processes each record as it arrives, for sub-second, millisecond-level latency.

**The one idea to remember:** real-time mode is the same Structured Streaming API with a different trigger, `.trigger(realTime="5 minutes")`. It needs a dedicated classic cluster with enough task slots to run **every stage of the query at the same time**.

## ⏱️ Where micro-batch latency comes from

This module assumes *Structured Streaming basics* (micro-batches, checkpoints, triggers). Follow one alert event through a micro-batch query.

```viz timeline
{"title": "One event's trip through a micro-batch query",
 "items": [
  {"label": "t0", "title": "Event arrives", "sub": "in Kafka", "color": "blue", "note": "The current batch has already started. The event must **wait** for the next one."},
  {"label": "+wait", "title": "Next batch starts", "color": "amber", "note": "The driver finds the latest offsets and writes them to the checkpoint before reading anything."},
  {"label": "+plan", "title": "Plan and schedule", "color": "amber", "note": "The query is planned and tasks are scheduled for each stage, one stage after the other."},
  {"label": "+run", "title": "Process", "color": "green", "note": "The actual work. For a filter on a few events this is often the smallest part."},
  {"label": "+commit", "title": "Write and commit", "color": "amber", "note": "Output is written and the batch is marked done in the checkpoint."},
  {"label": "seconds", "title": "Alert delivered", "color": "red", "note": "Waiting plus fixed per-batch overhead add up to **seconds** of latency, no matter how little data there was."}
 ]}
```

## ⚡ What real-time mode changes

- **Long-running batches.** A batch lasts as long as the trigger interval, for example 5 minutes. Inside it, records are read and processed **continuously**, as they arrive.
- **All stages run at once.** Stages are scheduled together and pass data straight on, instead of one after the other.
- **Checkpoints at the end of each batch.** The interval decides how often progress is saved, not how fast records flow.
- **Only `update` output mode.** Each result is emitted as soon as it is produced.

## 🆚 Micro-batch or real-time?

```viz compare
{"items": [{"icon": "🏁", "title": "Micro-batch: availableNow", "sub": "incremental batch", "color": "green",
            "points": ["Process what is new, then stop", "✅ scheduled jobs, cheapest", "✅ serverless, any sink", "Latency: the job schedule"]},
           {"icon": "⏲️", "title": "Micro-batch: processingTime", "sub": "always on", "color": "blue",
            "points": ["One batch per interval", "✅ all streaming features", "❌ not on serverless", "Latency: seconds"]},
           {"icon": "⚡", "title": "Real-time mode", "sub": "realTime=\"5 minutes\"", "color": "purple",
            "points": ["Records processed as they arrive", "✅ fraud, alerting, personalization", "❌ dedicated classic cluster only", "Latency: sub-second, milliseconds"]}]}
```

Most analytics pipelines are happy with seconds or minutes: keep them on micro-batch. Use real-time mode for **operational** workloads, where an action must follow an event right away.

## 🧾 The syntax

```viz code
title: Kafka in, Kafka out, in real-time mode (display only)
lang: python
---
(spark.readStream.format("kafka")
    .option("kafka.bootstrap.servers", "broker:9092")
    .option("subscribe", "events").load()
  .writeStream.format("kafka")
    .option("kafka.bootstrap.servers", "broker:9092")
    .option("topic", "alerts")
    .option("checkpointLocation", "/Volumes/.../chk")
    .outputMode("update")
    .trigger(realTime="5 minutes")
    .start())
---
1-3 | source | A normal Kafka source. Real-time mode is aimed at message buses such as Kafka.
4-6 | sink | Results go straight back to another Kafka topic, for the service that acts on them.
7 | checkpoint | Still required. It is written at the end of each long-running batch.
8 | update | The only output mode real-time mode supports.
9 | trigger | Turns on real-time mode. The interval is the batch (checkpoint) duration and is **required** in Python. Scala uses `RealTimeTrigger.apply()`.
```

> This code needs Kafka and a classic cluster set up for real-time mode (next slide). It does not run on serverless, so it is shown here only.

## 🖥️ What the cluster needs

| Setting | Required value |
|---|---|
| Compute | Classic, **Dedicated** access mode |
| Databricks Runtime | 16.4 LTS or later |
| Autoscaling and Photon | Both **off** |
| Spark config | `spark.databricks.streaming.realTimeMode.enabled true` |

Not supported: **serverless**, **standard** access mode, and Lakeflow Spark Declarative Pipelines. The Spark config is set on the cluster, not with `spark.conf.set` in a notebook.

## 🧮 Enough task slots for every stage

```viz flow
{"title": "A two-stage query in real-time mode",
 "nodes": [{"icon": "📥", "title": "Stage 1", "sub": "read 8 Kafka partitions", "color": "blue", "items": ["8 tasks"]},
           {"icon": "🔀", "title": "Shuffle", "sub": "by key", "color": "gray"},
           {"icon": "📤", "title": "Stage 2", "sub": "aggregate and write", "color": "purple", "items": ["4 tasks"]},
           {"icon": "🧮", "title": "Cluster", "sub": "slots = cores", "color": "navy", "items": ["needs ≥ 12 slots"]}],
 "steps": [
  {"label": "Micro-batch", "focus": [0, 2], "note": "In micro-batch mode stage 2 starts after stage 1 ends, so 8 slots are enough: they are reused."},
  {"label": "Real-time", "focus": [0, 1, 2], "note": "In real-time mode both stages run **for the whole batch** and stream data to each other."},
  {"label": "Count the slots", "focus": [3], "note": "Total task slots must be at least the tasks of **all stages together**: 8 + 4 = 12. With fewer, the query cannot run all stages at once."}
 ]}
```

## 🧪 Try it: a micro-batch alert stream

```dataset iot
```

On serverless you can use the `availableNow` trigger. Build an alert stream from `readings` and look at where each batch spends its time.

```python run
# Alerts: low battery, impossible temperature or ERROR status (clean start)
import json, shutil
from pyspark.sql import functions as F

checkpoint = data.volume(CATALOG, SCHEMA) + "/rt_demo/checkpoint"
shutil.rmtree(checkpoint, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS rt_alerts")

def run_alerts():
    q = (spark.readStream.table("readings")
            .filter((F.col("battery") < 35) | ~F.col("temperature").between(-50, 60) | (F.col("status") == "ERROR"))
            .select("reading_id", "device_id", "event_ts", "temperature", "battery", "status")
         .writeStream
            .option("checkpointLocation", checkpoint)
            .trigger(availableNow=True)
            .toTable("rt_alerts"))
    q.awaitTermination()
    return q

q = run_alerts()
print("alerts:", spark.table("rt_alerts").count())
```

```python run
# Where did each batch spend its time? (milliseconds)
def show_progress(q):
    for p in q.recentProgress:
        p = p if isinstance(p, dict) else json.loads(p.json)
        print("batch", p["batchId"], "| rows:", p["numInputRows"], "|", p["durationMs"])

show_progress(q)
```

> `triggerExecution` is the whole batch. Steps such as `latestOffset`, `queryPlanning` and `walCommit` are overhead that every micro-batch pays, however few rows it has. That is the cost real-time mode removes.

## Exercise 1: does a tiny batch take less time?

Start your own alert stream, then add only 5 new readings and run it again. Predict first: will the 5-row batch take about 1/10,000 of the time of the first one?

```python todo
# TODO 1: stream readings with status = 'ERROR' into rt_ex_alerts (availableNow, your own checkpoint)
# TODO 2: insert 5 new readings with status 'ERROR' into readings (new reading_id values)
# TODO 3: run the stream again and compare numInputRows and durationMs of the two runs
import json, shutil
from pyspark.sql import functions as F

checkpoint = data.volume(CATALOG, SCHEMA) + "/rt_ex/checkpoint"
shutil.rmtree(checkpoint, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS rt_ex_alerts")
```

```python solution
import json, shutil
from pyspark.sql import functions as F

checkpoint = data.volume(CATALOG, SCHEMA) + "/rt_ex/checkpoint"
shutil.rmtree(checkpoint, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS rt_ex_alerts")

def run():
    q = (spark.readStream.table("readings").filter(F.col("status") == "ERROR")
         .writeStream.option("checkpointLocation", checkpoint)
         .trigger(availableNow=True).toTable("rt_ex_alerts"))
    q.awaitTermination()
    for p in q.recentProgress:
        p = p if isinstance(p, dict) else json.loads(p.json)
        print("rows:", p["numInputRows"], "| total ms:", p["durationMs"].get("triggerExecution"))

run()
spark.sql("""
  INSERT INTO readings
  SELECT reading_id + (SELECT max(reading_id) FROM readings), device_id, event_ts, ingest_ts,
         temperature, humidity, battery, 'ERROR'
  FROM readings WHERE reading_id <= 5""")
run()
# No: the 5-row batch still takes a large share of the first batch's time.
# Most of a small batch is fixed overhead (offsets, planning, commit), not processing.
```

## Exercise 2: is this cluster ready for real-time mode?

A colleague describes their cluster. Write a function that returns every reason it cannot run real-time mode. Predict first: how many problems does `cluster` have?

```python todo
cluster = {"access_mode": "Standard", "runtime": 15.4, "autoscaling": True, "photon": False,
           "spark_conf": {}, "serverless": False, "task_slots": 8}
query_tasks_per_stage = [8, 4]

def blockers(c, tasks):
    problems = []
    # TODO: check access mode, runtime, autoscaling, Photon, the Spark config, serverless and task slots
    return problems

blockers(cluster, query_tasks_per_stage)
```

```python solution
cluster = {"access_mode": "Standard", "runtime": 15.4, "autoscaling": True, "photon": False,
           "spark_conf": {}, "serverless": False, "task_slots": 8}
query_tasks_per_stage = [8, 4]

def blockers(c, tasks):
    problems = []
    if c["serverless"]:
        problems.append("serverless is not supported: use classic compute")
    if c["access_mode"] != "Dedicated":
        problems.append("access mode must be Dedicated")
    if c["runtime"] < 16.4:
        problems.append("needs Databricks Runtime 16.4 LTS or later")
    if c["autoscaling"]:
        problems.append("turn autoscaling off")
    if c["photon"]:
        problems.append("turn Photon off")
    if c["spark_conf"].get("spark.databricks.streaming.realTimeMode.enabled") != "true":
        problems.append("set spark.databricks.streaming.realTimeMode.enabled true on the cluster")
    if c["task_slots"] < sum(tasks):
        problems.append(f"needs at least {sum(tasks)} task slots, has {c['task_slots']}")
    return problems

for p in blockers(cluster, query_tasks_per_stage):
    print("-", p)    # 5 problems: access mode, runtime, autoscaling, Spark config, task slots

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS rt_alerts"); spark.sql("DROP TABLE IF EXISTS rt_ex_alerts")
```

## ⚠️ Common mistakes

- ❌ Choosing real-time mode for a dashboard that refreshes every 10 minutes. A scheduled `availableNow` job is cheaper and simpler.
- ❌ Reading the trigger interval as the latency. `realTime="5 minutes"` sets the checkpoint interval; records still flow in milliseconds.
- ❌ Sizing the cluster for the biggest stage only. All stages run together, so add up their tasks.
- ❌ Expecting it on serverless, standard access mode or declarative pipelines. It needs a dedicated classic cluster without Photon or autoscaling.
- ✅ Measure first: `recentProgress` shows how much of each batch is overhead.

## 🧭 Cheat sheet

| I want… | Use |
|---|---|
| Process new data on a schedule, then stop | `.trigger(availableNow=True)` (works on serverless) |
| An always-on stream, seconds of latency | default trigger or `.trigger(processingTime="10 seconds")` |
| Sub-second latency, Kafka to Kafka | `.outputMode("update").trigger(realTime="5 minutes")` |
| To see where batch time goes | `query.recentProgress` → `durationMs` |
| Real-time mode turned on | Dedicated classic cluster, DBR 16.4 LTS+, no Photon, no autoscaling, the Spark config |
