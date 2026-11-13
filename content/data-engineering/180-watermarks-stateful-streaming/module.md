---
title: Watermarks and stateful streaming
summary: Aggregate and deduplicate streams by event time without letting state grow forever. Learn how a watermark is computed, when a window is final, what happens to late rows, and which joins keep state.
icon: 💧
level: Advanced
minutes: 12
group: Ingestion and pipelines
tags: [Structured Streaming, Watermarks, Windows, State store, Deduplication]
---
# Watermarks and stateful streaming

> A sensor measures at 10:02 and the reading reaches you at 11:30. To count it in the right window, Spark must keep the 10:00 window open. A watermark tells Spark **how long to wait** before it closes a window and forgets it.

**The one idea to remember:** watermark = **latest event time seen minus the delay you allow**. Windows that end before it are final and leave the state; rows older than it are dropped.

## 🕰️ Event time, and operators that remember

**Event time** is when something happened (`event_ts`). **Processing time** is when Spark sees it (`ingest_ts` is close to that). Networks and retries mean rows arrive out of order, so aggregations by event time must wait.

| Stateless: each batch on its own | Stateful: keeps data between batches |
|---|---|
| `select`, `filter`, `withColumn` | `groupBy` aggregations, with or without windows |
| Stream-static joins | `dropDuplicates`, `dropDuplicatesWithinWatermark` |
| `explode`, `from_json` | Stream-stream joins, `transformWithState` |

Stateful operators store their partial results in the **state store**, which is saved in the checkpoint after every batch.

## 🪟 Window types

```viz compare
{"items": [{"icon": "🧱", "title": "Tumbling", "sub": "window(\"event_ts\", \"1 hour\")", "color": "blue",
            "points": ["Fixed size, no overlap", "Each row belongs to **exactly one** window", "10:00–11:00, 11:00–12:00, …"],
            "foot": "Hourly or daily totals"},
           {"icon": "🪜", "title": "Sliding", "sub": "window(\"event_ts\", \"1 hour\", \"30 minutes\")", "color": "purple",
            "points": ["Fixed size, starts every slide interval", "Each row is in **size / slide** windows (here 2)", "10:00–11:00, 10:30–11:30, …"],
            "foot": "Moving averages"},
           {"icon": "💬", "title": "Session", "sub": "session_window(\"event_ts\", \"10 minutes\")", "color": "teal",
            "points": ["Size depends on the data, per key", "Closes after 10 minutes without a row", "Each new row can extend the session"],
            "foot": "User or device activity bursts"}]}
```

## 🔄 State lives in the state store

```viz flow
{"title": "Every micro-batch of a windowed aggregation",
 "nodes": [{"icon": "📥", "title": "New rows", "sub": "this batch only", "color": "blue"},
           {"icon": "🚧", "title": "Late filter", "sub": "drop rows older than the watermark", "color": "red"},
           {"icon": "🧮", "title": "Aggregate", "sub": "merge with stored partial results", "color": "purple"},
           {"icon": "🗄️", "title": "State store", "sub": "one store per shuffle partition", "color": "amber", "items": ["one entry per open window and key", "saved to the checkpoint each batch"]},
           {"icon": "📤", "title": "Emit and evict", "sub": "final windows out, their state deleted", "color": "green"}],
 "edges": ["rows", "on time", "read and update", "after the watermark moves"]}
```

Without a watermark, Spark can never be sure a window is complete, so it keeps **every window forever**. State grows each hour, batches slow down, and the query eventually runs out of memory. Databricks recommends the RocksDB state store for large state, because it keeps state on disk rather than in the JVM heap.

## 💧 Watch the watermark move

`withWatermark("event_ts", "10 minutes")` with 5-minute tumbling windows. Each item is one micro-batch with one row. The watermark is updated at the **end** of a batch and applies from the next one.

```viz timeline
{"title": "Watermark = max event time seen − 10 minutes",
 "items": [
  {"label": "batch 0", "title": "10:02 arrives", "sub": "watermark → 09:52", "color": "blue", "note": "First row. Window 10:00–10:05 opens in state. Max event time 10:02, so the watermark becomes 09:52."},
  {"label": "batch 1", "title": "10:07 arrives", "sub": "watermark → 09:57", "color": "blue", "note": "Window 10:05–10:10 opens. The max moves to 10:07."},
  {"label": "batch 2", "title": "10:03 arrives late", "sub": "within the delay", "color": "amber", "note": "Out of order, but 10:03 is newer than the watermark 09:57. It is **counted** in window 10:00–10:05, which is still in state."},
  {"label": "batch 3", "title": "10:16 arrives", "sub": "watermark → 10:06", "color": "purple", "note": "Window 10:15–10:20 opens. The max jumps to 10:16, so after this batch the watermark is 10:06."},
  {"label": "batch 4", "title": "10:04 arrives too late", "sub": "dropped", "color": "red", "note": "The watermark 10:06 now applies. Window 10:00–10:05 ends before it: it is **final**, written in append mode, and its state is deleted. The 10:04 row is older than the watermark, so it is **dropped**."},
  {"label": "batch 5", "title": "10:12 arrives", "sub": "on time", "color": "green", "note": "Newer than 10:06: counted in window 10:10–10:15. Window 10:05–10:10 closes once the watermark passes 10:10, so a row after 10:20 must arrive first."}
 ]}
```

## 📊 Windows open, update and close

The same six batches, seen from the result side. Append mode writes a window **once**, when it is final.

```viz table
{"title": "State of the 5-minute windows", "columns": ["window", "rows", "avg temp", "status"],
 "rows": [["10:00–10:05", 1, 21.0, "open (in state)"]],
 "steps": [
  {"label": "batch 0", "note": "10:02 at 21.0 °C opens the first window."},
  {"label": "batch 1", "note": "10:07 opens the next window.", "add": [["10:05–10:10", 1, 22.0, "open (in state)"]]},
  {"label": "batch 2", "note": "The late 10:03 row (23.0 °C) updates the first window. In append mode nothing is written yet.", "upd": {"0": {"rows": 2, "avg temp": 22.0}}, "hl": [0]},
  {"label": "batch 3", "note": "10:16 opens a third window and pushes the watermark to 10:06.", "add": [["10:15–10:20", 1, 20.0, "open (in state)"]]},
  {"label": "batch 4", "note": "The first window is final: one row is written to the sink, and its state is removed. The 10:04 row (30.0 °C) was dropped, so the average stays 22.0.", "upd": {"0": {"status": "✅ final: written, state removed"}}, "hl": [0]},
  {"label": "batch 5", "note": "10:12 opens the fourth window. Three windows are still open, waiting for the watermark.", "add": [["10:10–10:15", 1, 21.5, "open (in state)"]], "hl": [1, 2, 3]}
 ]}
```

A longer delay accepts later data but keeps more state and, in append mode, writes results later. In update mode the window is written at every change, but the watermark still decides when its state is removed.

## 🧹 Deduplicating a stream

```python
# State for every key forever: fine for a batch, dangerous for a stream
events.dropDuplicates(["device_id", "event_id"])

# Event time in the keys: a key is forgotten once the watermark passes its event time
events.withWatermark("event_ts", "1 hour").dropDuplicates(["device_id", "event_id", "event_ts"])

# Same key, possibly different timestamps: drop copies that arrive within 1 hour of the first one
events.withWatermark("event_ts", "1 hour").dropDuplicatesWithinWatermark(["device_id", "event_id"])
```

With a watermark, state is bounded, but a duplicate that arrives later than the delay is **not** caught. Choose the delay from how late retries really come.

## 🔗 Joins and state

| Join | State kept | What it needs |
|---|---|---|
| **Stream-static** | None. Each batch joins the latest version of the Delta table | Nothing extra |
| **Stream-stream, inner** | Rows of both sides, waiting for a match | Watermarks on both sides and a time bound, or state grows forever |
| **Stream-stream, outer** | Same | Watermarks and a time bound are **required**. Unmatched rows are written when the watermark passes |

A time bound looks like `click_ts BETWEEN impression_ts AND impression_ts + INTERVAL 1 HOUR`. With two watermarked inputs, the query uses the **minimum** of the two watermarks by default.

## 🧪 Try it: hourly averages and deduplication

```dataset iot
```

Average temperature per device and hour, with a 1-hour watermark. The cell starts clean every time.

```python run
# Hourly average per device, append mode with a watermark (clean start)
import os, json, shutil, datetime
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/wm_demo"
shutil.rmtree(base, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS wm_hourly_temperature")
spark.sql("DROP TABLE IF EXISTS wm_readings_dedup")

hourly = (spark.readStream.table("readings")
            .withWatermark("event_ts", "1 hour")
            .filter(F.col("temperature").between(-50, 60))
            .groupBy(F.window("event_ts", "1 hour"), "device_id")
            .agg(F.avg("temperature").alias("avg_temp"), F.count("*").alias("readings"))
            .select(F.col("window.start").alias("window_start"), F.col("window.end").alias("window_end"),
                    "device_id", "avg_temp", "readings"))

(hourly.writeStream
    .outputMode("append")
    .option("checkpointLocation", base + "/hourly_checkpoint")
    .trigger(availableNow=True)
    .toTable("wm_hourly_temperature")
    .awaitTermination())
```

```sql run
-- Which windows were written, and how far did the data go?
SELECT count(*) AS windows, min(window_start) AS first_window, max(window_end) AS last_window_end,
       (SELECT max(event_ts) FROM readings) AS max_event_ts
FROM wm_hourly_temperature;
```

```python run
# Where the watermark and the state live
chk = base + "/hourly_checkpoint"
print(sorted(os.listdir(chk)))                     # commits, metadata, offsets, state
last = max((f for f in os.listdir(chk + "/offsets") if f.isdigit()), key=int)
meta = json.loads(open(f"{chk}/offsets/{last}").read().splitlines()[1])
wm = datetime.datetime.fromtimestamp(meta["batchWatermarkMs"] / 1000, datetime.timezone.utc)
print("batch", last, "ran with watermark", wm)
```

```python run
# Drop retried duplicates: same device and event time, within 1 hour
(spark.readStream.table("readings")
    .withWatermark("event_ts", "1 hour")
    .dropDuplicatesWithinWatermark(["device_id", "event_ts"])
 .writeStream
    .option("checkpointLocation", base + "/dedup_checkpoint")
    .trigger(availableNow=True)
    .toTable("wm_readings_dedup")
    .awaitTermination())
print("readings:", spark.table("readings").count(), " after dedup:", spark.table("wm_readings_dedup").count())
```

> With `availableNow` on a table that already holds all 30 days, Spark processes everything in a few batches. Rows do not arrive out of order between batches here, so nothing is dropped as late: the visuals above show that behaviour. What you can observe: the last windows (within about an hour of `max_event_ts`) are missing, because the final watermark has not passed them. They wait in `state/`.

## Exercise 1: sliding windows count twice

Count readings in 1-hour windows that slide every 30 minutes, with a 1-hour watermark, into `wm_sliding_counts`. Predict how `sum(readings)` compares with the number of rows in `readings`.

```python todo
# TODO 1: readStream readings, withWatermark("event_ts", "1 hour")
# TODO 2: groupBy(F.window("event_ts", "1 hour", "30 minutes")).count(), append mode, availableNow
# TODO 3: compare sum(count) in wm_sliding_counts with count(*) in readings
```

```python solution
import shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/wm_ex1/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS wm_sliding_counts")

(spark.readStream.table("readings")
    .withWatermark("event_ts", "1 hour")
    .groupBy(F.window("event_ts", "1 hour", "30 minutes")).count()
 .writeStream.outputMode("append").option("checkpointLocation", chk)
    .trigger(availableNow=True).toTable("wm_sliding_counts")
 .awaitTermination())

spark.sql("""SELECT (SELECT sum(`count`) FROM wm_sliding_counts) AS counted,
                    (SELECT count(*) FROM readings) AS rows""").show()
# counted is close to 2 x rows: every row sits in two overlapping windows.
# Slightly less than 2x, because the windows at the end of the data are still open in state.
```

## Exercise 2: which keys does dropDuplicates keep?

Run two deduplicating streams over `readings`, both with a 1-hour watermark: one with keys `["device_id", "event_ts"]`, one with only `["device_id"]`. Predict both row counts, and which one has bounded state.

```python todo
# TODO 1: stream A: withWatermark + dropDuplicates(["device_id", "event_ts"]) into wm_dedup_a
# TODO 2: stream B: withWatermark + dropDuplicates(["device_id"]) into wm_dedup_b
# TODO 3: count both tables
```

```python solution
import shutil
base = data.volume(CATALOG, SCHEMA) + "/wm_ex2"
shutil.rmtree(base, ignore_errors=True)

def dedup(keys, table):
    spark.sql(f"DROP TABLE IF EXISTS {table}")
    (spark.readStream.table("readings")
        .withWatermark("event_ts", "1 hour")
        .dropDuplicates(keys)
     .writeStream.option("checkpointLocation", f"{base}/{table}")
        .trigger(availableNow=True).toTable(table)
     .awaitTermination())
    print(table, spark.table(table).count())

dedup(["device_id", "event_ts"], "wm_dedup_a")   # about 50,000: only the retried copies are dropped
dedup(["device_id"], "wm_dedup_b")               # 200: the first reading of each device, forever
# A has event_ts in its keys, so the watermark can expire old keys: bounded state.
# B has no event-time key, so its state is never cleaned up and it keeps every device id forever.

# Clean up when you are done
# for t in ("wm_dedup_a", "wm_dedup_b", "wm_sliding_counts", "wm_hourly_temperature", "wm_readings_dedup"):
#     spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ A windowed aggregation without a watermark on a long-running stream. State grows until the query fails.
- ❌ "Rows later than the delay are always counted." Rows older than the watermark are dropped.
- ❌ `dropDuplicates` on an id without the event-time column. State is never cleaned up.
- ❌ Complete mode with a watermark, to bound state. Complete mode keeps all state anyway.
- ❌ Changing the window, keys or watermark column and reusing the checkpoint. Stateful changes need a new checkpoint.
- ✅ Pick the delay from real lateness: long enough for most late rows, short enough for state and latency.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Allow 10 minutes of lateness | `.withWatermark("event_ts", "10 minutes")` |
| Fixed, non-overlapping windows | `F.window("event_ts", "1 hour")` |
| Overlapping windows | `F.window("event_ts", "1 hour", "15 minutes")` |
| Windows by activity gap | `F.session_window("event_ts", "10 minutes")` |
| Drop duplicates with bounded state | `.dropDuplicatesWithinWatermark(["id"])` after `withWatermark` |
| Final rows only, written once | `outputMode("append")` with a watermark |
| Inspect the last watermark | `batchWatermarkMs` in the newest `offsets/` file |
