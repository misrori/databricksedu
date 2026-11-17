---
title: "Recap: Stream Processing with Apache Spark"
summary: Recap of module 3 of Apache Spark Programming with Databricks. Treat a stream as an unbounded table, build a readStream to writeStream query with a checkpoint, pick triggers and output modes, aggregate with windows and watermarks, and know when Real-Time Mode fits.
icon: 🌊
level: Intermediate
minutes: 10
group: Apache Spark Programming with Databricks
tags: [Structured Streaming, Checkpoints, Triggers, Watermarks, Windows, Real-Time Mode]
---
# Recap: Stream Processing with Apache Spark

> Module 3 of 4. **Structured Streaming**: the same DataFrame API on data that never stops arriving. Sources, sinks, checkpoints, triggers, output modes, windows, watermarks, and the new **Real-Time Mode**.

**The one idea to remember:** a stream is a table that keeps growing. Spark runs your query **incrementally** on the new rows only, and the **checkpoint** remembers how far it got, so a restart neither loses nor repeats data.

## 🗺️ What we covered

```viz timeline
{"title": "The lessons of the module",
 "items": [
  {"label": "1", "title": "Intro to stream processing", "color": "navy", "note": "Batch vs streaming, latency vs cost, the **unbounded table** model."},
  {"label": "2", "title": "Structured Streaming", "color": "blue", "note": "`readStream` / `writeStream`, sources and sinks, **checkpoints**, triggers, output modes."},
  {"label": "3", "title": "Aggregations and windows", "color": "purple", "note": "Tumbling, sliding and session windows on **event time**."},
  {"label": "4", "title": "Watermarks and late data", "color": "amber", "note": "How long to wait for late events, and when state can be dropped."},
  {"label": "5", "title": "Real-Time Mode", "color": "red", "note": "Sub-second latency by processing records **continuously** instead of in micro-batches."}
 ]}
```

## 📦 Batch vs streaming

```viz compare
{"items": [
  {"icon": "📦", "title": "Batch", "sub": "`spark.read` ... `write`", "color": "blue", "points": ["Reads everything that exists now", "Re-run = reprocess it all (unless you add logic)", "✅ Simple, cheap for daily loads"]},
  {"icon": "🌊", "title": "Structured Streaming", "sub": "`spark.readStream` ... `writeStream`", "color": "teal", "points": ["Reads only **new** data each trigger", "Progress stored in a **checkpoint**", "✅ Incremental, exactly-once into Delta"]}
 ]}
```

Streaming is not only about low latency. With `availableNow` it is also the easiest way to build **incremental batch** jobs.

## ♾️ The unbounded table

Think of the input as a table where new rows keep being appended. Each trigger processes only the rows added since the last one.

```viz table
{"title": "readings (input table)",
 "columns": ["reading_id", "device_id", "temperature", "trigger"],
 "rows": [[1, 17, 21.4, "1"], [2, 42, -18.2, "1"], [3, 17, 21.9, "1"]],
 "steps": [
  {"label": "Trigger 1", "note": "The query reads rows 1 to 3 and writes its result. The checkpoint records the offset.", "hl": [0, 1, 2]},
  {"label": "New rows", "note": "Two new readings arrive at the source.", "add": [[4, 42, -17.9, "2"], [5, 99, 23.1, "2"]]},
  {"label": "Trigger 2", "note": "Only rows 4 and 5 are processed. Rows 1 to 3 are **not** read again.", "hl": [3, 4]}
 ]}
```

## 🔁 Anatomy of a streaming query

```viz code
title: bronze to silver, incrementally
lang: python
---
q = (spark.readStream
       .table("readings_bronze")
       .filter("temperature BETWEEN -50 AND 60")
       .withColumn("processed_at", F.current_timestamp())
       .writeStream
       .outputMode("append")
       .option("checkpointLocation", "/Volumes/iot/raw/chk/silver")
       .trigger(availableNow=True)
       .toTable("readings_silver"))
q.awaitTermination()
---
1-2 | Source | A streaming read of a Delta table. Files, Kafka and Auto Loader work the same way.
3-4 | Transform | The normal DataFrame API. Most batch code works unchanged.
5-6 | Sink and mode | `append` writes only new result rows.
7 | Checkpoint | **One folder per query**. It stores offsets, commits and state.
8 | Trigger | Process everything available, then stop.
9-10 | Start | `toTable` starts the query. `awaitTermination` waits for it.
```

## 🔌 Sources and sinks

| Kind | Read with | Write with |
|---|---|---|
| Delta table | `readStream.table("t")` | `writeStream.toTable("t")` |
| Files in a volume | Auto Loader `format("cloudFiles")` or `format("csv")` + schema | Delta (files are rare as a sink) |
| Message bus | `format("kafka")`, Kinesis, Event Hubs | `format("kafka")` |
| Custom logic | | `foreachBatch` (for example `MERGE` per micro-batch) |

A file source needs an **explicit schema**, because the files of tomorrow do not exist yet.

## 📍 Checkpoints: exactly-once

```viz files
{"title": "/Volumes/.../checkpoint/readings/",
 "steps": [
  {"label": "Start", "note": "The query writes its metadata, including a unique query id.", "add": [{"path": "metadata", "tag": "query id"}]},
  {"label": "Plan batch 0", "note": "Before processing, Spark writes the **offsets** it is about to read: a write-ahead log.", "add": [{"path": "offsets/0", "tag": "files 1-1"}, {"path": "sources/0/0", "tag": "file list"}]},
  {"label": "Commit batch 0", "note": "After the sink write succeeds, a **commit** file is written.", "add": [{"path": "commits/0", "tag": "done"}]},
  {"label": "Crash in batch 1", "note": "Offsets for batch 1 exist, but no commit. On restart Spark **re-runs batch 1** with the same offsets. Delta's idempotent sink makes that exactly-once.", "add": [{"path": "offsets/1", "tag": "files 2-2, no commit"}]},
  {"label": "Restart", "note": "Batch 1 completes and is committed. Nothing was lost or duplicated.", "add": [{"path": "commits/1", "tag": "done"}]}
 ]}
```

Never share a checkpoint between queries, and never delete it to "fix" a stream.

## ⏱️ Triggers

| Trigger | Behaviour | Where |
|---|---|---|
| default / `processingTime="1 minute"` | Micro-batches, forever | Classic compute |
| `availableNow=True` | Everything available, in batches, then stop | **Everywhere, incl. serverless** |
| `once=True` | One batch, then stop | Deprecated: use `availableNow` |
| `realTime="5 minutes"` | Continuous, sub-second | Classic, dedicated (Preview) |

`availableNow` on a schedule gives you incremental jobs that cost nothing between runs.

## 📤 Output modes

| Mode | Writes each trigger | Use for |
|---|---|---|
| `append` | Only **new** rows, never changed later | Row-level ETL, windowed aggregates **with a watermark** |
| `update` | Only rows that **changed** | Aggregates to Kafka or `foreachBatch`; Real-Time Mode |
| `complete` | The **whole** result again | Small aggregates (dashboards) |

A Delta table sink supports `append` and `complete`. Use `foreachBatch` with `MERGE` for update semantics into Delta.

## 🪟 Windows on event time

Group by **when the event happened** (`event_ts`), not when it arrived (`ingest_ts`).

```viz compare
{"items": [
  {"icon": "🧱", "title": "Tumbling", "sub": "fixed, no overlap", "color": "blue", "points": ["`F.window(\"event_ts\", \"10 minutes\")`", "Each event in exactly one window", "Hourly averages, counts"]},
  {"icon": "🎞️", "title": "Sliding", "sub": "fixed, overlapping", "color": "purple", "points": ["`F.window(\"event_ts\", \"10 minutes\", \"5 minutes\")`", "Each event in several windows", "Moving averages"]},
  {"icon": "💬", "title": "Session", "sub": "dynamic length", "color": "teal", "points": ["`F.session_window(\"event_ts\", \"5 minutes\")`", "Closes after a gap of inactivity", "User or device sessions"]}
 ]}
```

## 💧 Watermarks and late data

`withWatermark("event_ts", "10 minutes")`: watermark = latest event time seen minus 10 minutes. Windows ending before it are final. Here, 15-minute tumbling windows.

```viz table
{"title": "15-minute windows, 10-minute watermark",
 "columns": ["event_ts", "device_id", "temperature", "status"],
 "rows": [["10:02", 17, 21.0, "window 10:00"], ["10:09", 42, 22.0, "window 10:00"], ["10:14", 17, 21.5, "window 10:00"]],
 "steps": [
  {"label": "Events arrive", "note": "Latest event 10:14, so the watermark is **10:04**. The 10:00-10:15 window stays open."},
  {"label": "Late but OK", "note": "A 10:06 event arrives late. It is after the watermark, so it still counts.", "add": [["10:06", 99, 20.8, "accepted, late"]], "hl": [3]},
  {"label": "Time moves on", "note": "A 10:31 event moves the watermark to **10:21**. The 10:00 window is final: append mode emits it and drops its state.", "add": [["10:31", 42, 22.4, "window 10:30"]], "upd": {"0": {"status": "emitted"}, "1": {"status": "emitted"}, "2": {"status": "emitted"}, "3": {"status": "emitted"}}},
  {"label": "Too late", "note": "A 10:12 event arrives now. Its window is already closed, so it is **dropped**.", "add": [["10:12", 17, 21.1, "dropped"]], "hl": [5]}
 ]}
```

A longer watermark accepts later data but keeps more state and emits results later.

## ⚡ Real-Time Mode

```viz compare
{"items": [
  {"icon": "🧺", "title": "Micro-batch", "sub": "the default engine", "color": "blue", "points": ["Collects data, then processes a batch", "Latency of **seconds**", "Runs everywhere, incl. serverless"]},
  {"icon": "⚡", "title": "Real-Time Mode", "sub": "Public Preview", "color": "red", "points": ["Processes records **continuously**", "**Sub-second** latency", "`update` output mode only", "Typical source and sink: **Kafka**"]}
 ]}
```

Use it for fraud checks, alerts or personalization, where every millisecond matters. For ETL into Delta, micro-batch is simpler and cheaper.

## ⚡ Real-Time Mode in code

> Display-only. Real-Time Mode needs **classic compute in Dedicated access mode**, DBR **16.4 LTS** or above, autoscaling and Photon **off**, and the Spark config `spark.databricks.streaming.realTimeMode.enabled true` on the cluster. It does not run on serverless, standard access mode or Lakeflow Spark Declarative Pipelines.

```python
q = (spark.readStream.format("kafka")
       .option("kafka.bootstrap.servers", BROKERS)
       .option("subscribe", "readings")
       .load()
       .selectExpr("key", "upper(CAST(value AS STRING)) AS value")
       .writeStream.format("kafka")
       .option("kafka.bootstrap.servers", BROKERS)
       .option("topic", "readings_clean")
       .option("checkpointLocation", CHECKPOINT)
       .outputMode("update")                 # the only supported mode
       .trigger(realTime="5 minutes")         # the interval is required in Python
       .start())
```

The only code change from micro-batch is the trigger. The **Real-Time Mode** module covers the details.

## 🧪 Try it: a file stream with a checkpoint

```dataset iot
```

Land raw **iot** reading files, stream them into a Delta table with `availableNow` (the trigger serverless supports), then add a file and run again.

```python run
# Land one raw CSV file of readings, and start from a clean checkpoint (safe to re-run)
import shutil
from pyspark.sql import functions as F

RAW = data.files("iot", CATALOG, SCHEMA, volume="landing", folder="ssr", n_files=1, fresh=True)
CHK = data.volume(CATALOG, SCHEMA) + "/ssr/checkpoint"
shutil.rmtree(CHK, ignore_errors=True)
for t in ("ssr_readings", "ssr_hourly"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")

READINGS_DDL = ("reading_id BIGINT, device_id BIGINT, event_ts TIMESTAMP, ingest_ts TIMESTAMP, "
                "temperature DOUBLE, humidity DOUBLE, battery DOUBLE, status STRING")
```

```python run
# readStream -> writeStream with a checkpoint. availableNow processes what is there, then stops
def run_stream():
    q = (spark.readStream.format("csv").option("header", "true").schema(READINGS_DDL)
         .load(f"{RAW}/readings/")
         .filter("temperature BETWEEN -50 AND 60")            # drop impossible values
         .withColumn("processed_at", F.current_timestamp())
         .writeStream
         .option("checkpointLocation", f"{CHK}/readings")
         .trigger(availableNow=True)
         .toTable("ssr_readings"))
    q.awaitTermination()
    return sum(p["numInputRows"] if isinstance(p, dict) else p.numInputRows for p in q.recentProgress)

print("1st run, rows read:", run_stream())
print("2nd run, rows read:", run_stream(), "<- the checkpoint says nothing is new")
```

```python run
# A new file lands: predict how many rows the 3rd run reads before you run this
data.files("iot", CATALOG, SCHEMA, volume="landing", folder="ssr", n_files=1)
print("3rd run, rows read:", run_stream())
display(spark.sql("SELECT count(*) AS rows_in_table FROM ssr_readings"))
```

## 🧪 Try it: hourly windows per device type

```python run
# Tumbling 1-hour windows per device type, with a stream-static join to the devices table
hourly = (spark.readStream.table("ssr_readings")
          .join(spark.table("devices"), "device_id")
          .groupBy(F.window("event_ts", "1 hour"), "device_type")
          .agg(F.round(F.avg("temperature"), 2).alias("avg_temp"), F.count("*").alias("readings")))

q = (hourly.writeStream
     .outputMode("complete")                  # small result: rewrite it every trigger
     .option("checkpointLocation", f"{CHK}/hourly")
     .trigger(availableNow=True)
     .toTable("ssr_hourly"))
q.awaitTermination()
display(spark.sql("""SELECT window.start, device_type, avg_temp, readings
                     FROM ssr_hourly ORDER BY window.start DESC, device_type LIMIT 12"""))

# Clean up when you are done
# for t in ("ssr_readings", "ssr_hourly"): spark.sql(f"DROP TABLE IF EXISTS {t}")
```

For a large result, use **append** mode with a watermark, so each window is written once and its state is dropped:

```python
(spark.readStream.table("ssr_readings")
   .withWatermark("event_ts", "2 hours")
   .groupBy(F.window("event_ts", "1 hour"), "device_id")
   .agg(F.avg("temperature").alias("avg_temp"))
   .writeStream.outputMode("append") ...)
```

## ⚠️ Common mistakes

- ❌ Grouping by `ingest_ts` (arrival time) when the question is about **event time**.
- ❌ An `append` aggregation without a watermark. It is not allowed, and state would grow forever.
- ❌ Sharing one checkpoint between two queries, or deleting it to restart. You get duplicates or gaps.
- ❌ `complete` mode on a large keyspace. It rewrites and keeps everything.
- ❌ `trigger(once=True)` in new code. Use **`availableNow`**.
- ❌ Choosing Real-Time Mode for a nightly Delta load. Micro-batch is simpler and cheaper.

## 🧭 Cheat sheet

| Need | Choose |
|---|---|
| Incremental load on a schedule | `trigger(availableNow=True)` + checkpoint |
| Seconds of latency, always on | Default / `processingTime` trigger |
| Sub-second latency on Kafka | **Real-Time Mode**, `update` mode |
| Hourly metrics written once | Window + **watermark** + `append` |
| Small live dashboard table | `complete` mode |
| Upsert each batch into Delta | `foreachBatch` + `MERGE` |

**Next module:** *Monitoring and Optimizing Apache Spark Workloads*. Deep dives: Structured Streaming basics and Watermarks and stateful streaming.
