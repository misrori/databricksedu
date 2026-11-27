---
title: Monitoring a streaming query
summary: Read the progress report of a Structured Streaming query, tell from the input and processing rates whether it keeps up, follow the watermark and the state size, and find out why a query stopped. Use the query handle, the Structured Streaming tab and listeners.
icon: 📡
level: Intermediate
minutes: 12
group: Stream processing
tags: [Structured Streaming, Monitoring, Progress reports, State store, Spark UI]
---
# Monitoring a streaming query

> A batch job either finishes or fails. A streaming query can run for months and get slowly worse: more rows arrive than it can process, or its state grows a little every hour. You only see that if you read what the query reports after **every micro-batch**.

**The one idea to remember:** after each micro-batch, Spark writes a **progress report**. Compare `inputRowsPerSecond` with `processedRowsPerSecond` to see if the query keeps up, and watch `stateOperators.numRowsTotal` to see if its state stays bounded.

## 🔭 Three places to look

This module assumes *Structured Streaming basics*. For slow stages, skew and spill inside a batch, see *Monitoring Spark: the Spark UI and query profile*.

```viz compare
{"items": [{"icon": "🐍", "title": "The query handle", "sub": "q = df.writeStream...toTable(...)", "color": "blue",
            "points": ["`q.status`, `q.lastProgress`, `q.recentProgress`", "`q.exception()`, `spark.streams.active`", "✅ works on serverless", "You ask, when you want"]},
           {"icon": "🖥️", "title": "Structured Streaming tab", "sub": "in the Spark UI", "color": "purple",
            "points": ["Charts of rates, durations and state", "Active and completed queries", "❌ classic compute only", "You look, while it runs"]},
           {"icon": "👂", "title": "StreamingQueryListener", "sub": "spark.streams.addListener(...)", "color": "teal",
            "points": ["Called on start, progress, idle and end", "Send metrics to a table or a monitoring tool", "✅ for alerting", "Spark pushes, every batch"]}]}
```

## 📄 One progress report

`q.lastProgress` is the report of the newest batch; `q.recentProgress` keeps the last ones (100 by default). This one comes from an hourly window count over readings, trimmed.

```viz code
title: q.lastProgress (one micro-batch)
lang: json
---
{
  "batchId": 3,
  "numInputRows": 8412,
  "inputRowsPerSecond": 2104.1,
  "processedRowsPerSecond": 3530.0,
  "durationMs": {"addBatch": 1890, "getBatch": 12, "latestOffset": 85,
                 "queryPlanning": 140, "walCommit": 95, "triggerExecution": 2383},
  "eventTime": {"max": "2026-10-20T23:59:51.000Z", "watermark": "2026-10-15T22:59:58.000Z"},
  "stateOperators": [{"numRowsTotal": 122, "numRowsUpdated": 120, "memoryUsedBytes": 98304}],
  "sources": [{"description": "DeltaSource[.../mon_readings]", "numInputRows": 8412,
               "startOffset": {"reservoirVersion": 6, "index": 2}, "endOffset": {"reservoirVersion": 6, "index": 3}}],
  "sink": {"description": "DeltaSink[.../mon_hourly]", "numOutputRows": 120}
}
---
2-3 | batch | The fourth micro-batch read 8,412 rows. Batch ids count up across restarts, because they live in the checkpoint.
4-5 | rates | Rows that **arrived** per second since the last batch, and rows **processed** per second of batch time: 8,412 / 2.383 s = 3,530.
6-7 | durations | `triggerExecution` is the whole batch. `addBatch` runs your query and writes the sink. The rest is fixed overhead: finding offsets, planning, the write-ahead log.
8 | event time | The newest event time seen, and the watermark this batch used. Here 1 hour behind the end of the previous batch's data.
9 | state | 122 hourly windows in state, 120 touched in this batch. If `numRowsTotal` only ever grows, state is not bounded.
10-11 | offsets | Where the batch started and ended in the source. For a Delta source: a table version and a file index.
12 | sink | 120 rows written: the windows that became final. Rows read and rows written are different numbers.
```

## 📈 Is the query keeping up?

A query triggered every 10 seconds can process 1,000 rows per second. Watch what happens when the input rises to 1,200.

```viz table
{"title": "Progress reports, one per 10-second trigger", "columns": ["batch at", "input rows/s", "processed rows/s", "rows waiting"],
 "rows": [["10:00:00", "500", "1,000", "0"]],
 "steps": [
  {"label": "Keeping up", "note": "Processed is higher than input. Each batch finishes early and the query waits for the next trigger. Latency is low."},
  {"label": "Surge", "note": "1,200 rows/s arrive, 1,000 are processed. 12,000 rows arrived in 10 seconds, 10,000 were done: **2,000 wait**.", "add": [["10:00:10", "1,200", "1,000", "2,000"]], "hl": [1]},
  {"label": "Backlog grows", "note": "Every batch adds 2,000 more. Each row now waits longer before it is processed.", "add": [["10:00:20", "1,200", "1,000", "4,000"], ["10:00:30", "1,200", "1,000", "6,000"]], "hl": [2, 3]},
  {"label": "Fix", "note": "More compute, or cheaper work per row, raises the processing rate to 1,500 rows/s: 18,000 rows to do, 15,000 done.", "add": [["10:00:40", "1,200", "1,500", "3,000"]], "hl": [4]},
  {"label": "Caught up", "note": "12,000 new plus 3,000 waiting = 15,000, all processed. **Input above processed for many batches in a row is the signal to act.**", "add": [["10:00:50", "1,200", "1,500", "0"]], "hl": [5]}
 ]}
```

## 🧠 Is the state bounded?

Two hourly window counts over the same 30 days of readings, read as six 5-day batches. One has a 1-hour watermark, one has none.

```viz table
{"title": "stateOperators[0].numRowsTotal (about)", "columns": ["batch", "rows in", "with watermark", "no watermark"],
 "rows": [[0, "≈ 8,400", 120, 120]],
 "steps": [
  {"label": "batch 0", "note": "Days 1–5: 120 hourly windows go into state in both queries."},
  {"label": "batch 1", "note": "With a watermark, the windows of days 1–5 are final: written and evicted. Only the last 2 stay. Without one, Spark must keep them all.", "add": [[1, "≈ 8,400", 122, 240]], "hl": [1]},
  {"label": "batches 2–5", "note": "The watermarked query stays flat. The other one grows by 120 rows per batch, forever.", "add": [[2, "≈ 8,400", 122, 360], [3, "≈ 8,400", 122, 480], [4, "≈ 8,400", 122, 600], [5, "≈ 8,400", 122, 720]], "hl": [2, 3, 4, 5]}
 ]}
```

The same check works for joins and `dropDuplicates`: a flat `numRowsTotal` is healthy. `memoryUsedBytes` and `numRowsDroppedByWatermark` (late rows thrown away) are in the same entry.

## 🎛️ The query handle

| Call | What you get | Use it to |
|---|---|---|
| `q.status` | `message`, `isDataAvailable`, `isTriggerActive` | See what it is doing right now |
| `q.lastProgress`, `q.recentProgress` | The newest report, the last reports | Read metrics per batch |
| `spark.streams.active` | Running queries of this session | Find and `stop()` forgotten streams |
| `q.exception()` | `None`, or the error that stopped it | Learn why it failed |
| `q.awaitTermination()` | Waits; raises the error if it failed | Block a job until the stream ends |

`q.id` stays the same across restarts from one checkpoint. `q.runId` is new on every start. `lastProgress` is `None` until the first batch is done.

## 🖥️ The Structured Streaming tab

On classic compute, the Spark UI has a **Structured Streaming** tab. It shows the same progress reports as charts.

| Page | Shows |
|---|---|
| Query list | Active and completed queries: name, id, run id, duration, average input and process rate, latest batch |
| Query details | Input rate, process rate, input rows, batch duration, and the duration of each step per batch |
| State charts | Total and updated state rows, state memory, rows dropped by the watermark (stateful queries only) |

Serverless has no Spark UI: read `recentProgress` instead. A query in **real-time mode** adds latency fields such as `e2eLatencyMs` to the report: see *Real-time mode in Structured Streaming*.

## 👂 Listeners: Spark calls you

A listener receives an event for every query of the session. It is the usual way to send metrics to a table, Datadog, Grafana or Prometheus.

```python
from pyspark.sql.streaming import StreamingQueryListener

class ProgressLogger(StreamingQueryListener):
    def onQueryStarted(self, event):
        print("started", event.id, event.name)
    def onQueryProgress(self, event):            # after every micro-batch
        p = event.progress
        print(p.name, p.batchId, p.numInputRows, p.processedRowsPerSecond)
    def onQueryIdle(self, event):                # Spark 3.5+: no new data for a while
        pass
    def onQueryTerminated(self, event):
        print("ended", event.id, event.exception)

spark.streams.addListener(ProgressLogger())     # spark.streams.removeListener(...) to remove it
```

> Display only. Python listeners need Spark 3.5 or later for every method above. On serverless and standard access mode the listener code may run on the server side, so `print` output does not show under your cell: write to a table instead, and check the current Databricks docs before you rely on it.

## 🧪 Try it: read the reports of a multi-batch query

```dataset iot
```

`maxFilesPerTrigger` limits how many files one micro-batch reads. We fill `mon_readings` in 6 commits (one file each, normally), so one file per batch gives at least 6 batches.

```python run
# A source table filled in 6 commits, one per 5 days of readings (clean start)
import json, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/mon_demo"
shutil.rmtree(base, ignore_errors=True)
for t in ("mon_readings", "mon_hourly", "mon_bad"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE TABLE mon_readings AS SELECT * FROM readings WHERE false")
for k in range(6):
    spark.sql(f"""INSERT INTO mon_readings SELECT * FROM readings
                  WHERE event_ts >= date_add(DATE'2026-10-01', {5 * k})
                    AND event_ts <  date_add(DATE'2026-10-01', {5 * k + 5})""")
print(spark.table("mon_readings").count(), "rows,", spark.sql("DESCRIBE DETAIL mon_readings").first()["numFiles"], "files")
```

```python run
# Hourly counts with a 1-hour watermark, at most one file per micro-batch
hourly = (spark.readStream.option("maxFilesPerTrigger", 1).table("mon_readings")
            .withWatermark("event_ts", "1 hour")
            .groupBy(F.window("event_ts", "1 hour"))
            .agg(F.count("*").alias("readings")))

q = (hourly.writeStream.queryName("mon_hourly")
        .outputMode("append")
        .option("checkpointLocation", base + "/hourly_checkpoint")
        .trigger(availableNow=True)
        .toTable("mon_hourly"))
print("active:", [s.name for s in spark.streams.active], "| status:", q.status)
q.awaitTermination()
print("status:", q.status, "| exception:", q.exception())
```

```python run
# One line per micro-batch: rows, time, watermark, state, output
def as_dict(p):                       # progress reports are dicts or objects, depending on the version
    return json.loads(p.json() if callable(p.json) else p.json) if hasattr(p, "json") else p

print(f"{'batch':>5} {'rows in':>8} {'total ms':>9} {'addBatch':>9} {'watermark':>25} {'state':>6} {'out':>5}")
for p in map(as_dict, q.recentProgress):
    d, state = p["durationMs"], (p.get("stateOperators") or [{}])[0]
    print(f"{p['batchId']:>5} {p['numInputRows']:>8} {d.get('triggerExecution', 0):>9} {d.get('addBatch', 0):>9} "
          f"{p.get('eventTime', {}).get('watermark', '-'):>25} {state.get('numRowsTotal', '-'):>6} {p['sink'].get('numOutputRows'):>5}")
```

```python run
# One batch in detail: rates and source offsets
p = as_dict(q.recentProgress[min(1, len(q.recentProgress) - 1)])
print("batch", p["batchId"], "| input rows/s:", p["inputRowsPerSecond"], "| processed rows/s:", p["processedRowsPerSecond"])
src = p["sources"][0]
print("from:", src["startOffset"], "\nto:  ", src["endOffset"])
```

```python run
# A query that fails: what do awaitTermination and exception() say?
bad = (spark.readStream.table("mon_readings")
         .select("reading_id", F.when(F.col("temperature").isNull() | (F.col("temperature") < 100), F.col("temperature"))
                                .otherwise(F.raise_error(F.lit("impossible temperature"))).alias("temperature"))
       .writeStream.option("checkpointLocation", base + "/bad_checkpoint")
         .trigger(availableNow=True).toTable("mon_bad"))
try:
    bad.awaitTermination()
except Exception as e:
    print("awaitTermination raised", type(e).__name__)
print("isActive:", bad.isActive, "\nexception():", str(bad.exception())[:300])
```

> Expect the watermark to move about 5 days per batch, the state to stay near 120 windows, and a last batch with 0 input rows that only moves the watermark. On a table that already holds all the data, the rates say little: they matter on a stream that runs on a schedule or all the time.

## Exercise 1: rows in or rows out?

Fill your own table `mon_ex_src` in 4 commits of 12,500 readings (by `reading_id`). Stream only the rows with `status <> 'OK'` into `mon_ex_alerts`, with `maxFilesPerTrigger` 2. Predict the number of data batches, the sum of `numInputRows`, and the sum of the sink's `numOutputRows`.

```python todo
# TODO 1: CREATE TABLE mon_ex_src AS SELECT * FROM readings WHERE false; then 4 INSERTs by reading_id range
# TODO 2: stream mon_ex_src with option("maxFilesPerTrigger", 2), filter status <> 'OK', availableNow
# TODO 3: sum numInputRows and sink numOutputRows over recentProgress; count the batches with rows
import json, shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/mon_ex1/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
```

```python solution
import json, shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/mon_ex1/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
for t in ("mon_ex_src", "mon_ex_alerts"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE TABLE mon_ex_src AS SELECT * FROM readings WHERE false")
for k in range(4):
    spark.sql(f"INSERT INTO mon_ex_src SELECT * FROM readings WHERE reading_id BETWEEN {k * 12500 + 1} AND {(k + 1) * 12500}")

q = (spark.readStream.option("maxFilesPerTrigger", 2).table("mon_ex_src")
        .filter("status <> 'OK'")
     .writeStream.option("checkpointLocation", chk)
        .trigger(availableNow=True).toTable("mon_ex_alerts"))
q.awaitTermination()

def as_dict(p):
    return json.loads(p.json() if callable(p.json) else p.json) if hasattr(p, "json") else p

reports = [as_dict(p) for p in q.recentProgress]
print("batches with rows:", sum(1 for p in reports if p["numInputRows"] > 0))          # 2 when each INSERT wrote one file
print("rows in: ", sum(p["numInputRows"] for p in reports))                           # 50,000: every row read
print("rows out:", sum(max(p["sink"].get("numOutputRows", 0), 0) for p in reports),   # about 5%: only WARN and ERROR
      "| table:", spark.table("mon_ex_alerts").count())
# numInputRows counts rows read from the source, before your filter. The sink counts rows written.
```

## Exercise 2: a state health check

Write `state_trend(q)` that returns `numRowsTotal` of the first state operator for every batch with input rows. Run two hourly window counts over `mon_ex2_src` (filled in 6 commits, as in the demo), with `maxFilesPerTrigger` 1: one with a 1-hour watermark in `append` mode, one without a watermark in `complete` mode. Predict which list keeps growing.

```python todo
# TODO 1: build mon_ex2_src in 6 commits of 5 days each (copy the demo cell)
# TODO 2: state_trend(q): [numRowsTotal of stateOperators[0] for batches with numInputRows > 0]
# TODO 3: query A: withWatermark + window, append, into mon_ex2_a; query B: no watermark, complete, into mon_ex2_b
# TODO 4: print both trends; flag a query whose state grew in every batch
```

```python solution
import json, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/mon_ex2"
shutil.rmtree(base, ignore_errors=True)
for t in ("mon_ex2_src", "mon_ex2_a", "mon_ex2_b"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE TABLE mon_ex2_src AS SELECT * FROM readings WHERE false")
for k in range(6):
    spark.sql(f"""INSERT INTO mon_ex2_src SELECT * FROM readings
                  WHERE event_ts >= date_add(DATE'2026-10-01', {5 * k})
                    AND event_ts <  date_add(DATE'2026-10-01', {5 * k + 5})""")

def as_dict(p):
    return json.loads(p.json() if callable(p.json) else p.json) if hasattr(p, "json") else p

def state_trend(q):
    return [(p.get("stateOperators") or [{}])[0].get("numRowsTotal")
            for p in map(as_dict, q.recentProgress) if p["numInputRows"] > 0]

def hourly(watermark, mode, table):
    src = spark.readStream.option("maxFilesPerTrigger", 1).table("mon_ex2_src")
    if watermark:
        src = src.withWatermark("event_ts", "1 hour")
    q = (src.groupBy(F.window("event_ts", "1 hour")).count()
         .writeStream.outputMode(mode).option("checkpointLocation", f"{base}/{table}")
         .trigger(availableNow=True).toTable(table))
    q.awaitTermination()
    return q

for name, q in (("A watermark", hourly(True, "append", "mon_ex2_a")), ("B none", hourly(False, "complete", "mon_ex2_b"))):
    trend = state_trend(q)
    growing = len(trend) > 1 and all(b > a for a, b in zip(trend, trend[1:]))
    print(name, trend, "<- state grows every batch!" if growing else "")
# A stays near 120: finished windows leave the state. B grows by about 120 per batch:
# without a watermark Spark keeps every window, because a late row could still change it.

# Clean up when you are done
# for t in ("mon_ex2_src", "mon_ex2_a", "mon_ex2_b", "mon_ex_src", "mon_ex_alerts",
#           "mon_readings", "mon_hourly", "mon_bad"):
#     spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ Reading `numInputRows` as rows written. It counts rows read from the source; the sink reports `numOutputRows`.
- ❌ Acting on one slow batch. A backlog shows as input above processed **for many batches in a row**.
- ❌ Watching only durations. A query with growing `numRowsTotal` is fine today and fails next month.
- ❌ Calling `awaitTermination()` without handling its error, then wondering why the job "finished". Check `q.exception()`.
- ❌ Starting a stream twice by re-running a cell. Look at `spark.streams.active` and stop the old one.
- ✅ Send `onQueryProgress` metrics to a table or monitoring tool, and alert on the rates and the state size.

## 🧭 Cheat sheet

| I want to know… | Look at |
|---|---|
| Is it running, is a batch active? | `q.status`, `q.isActive`, `spark.streams.active` |
| Does it keep up? | `inputRowsPerSecond` vs `processedRowsPerSecond` over many batches |
| Where batch time goes | `durationMs`: `addBatch` vs `triggerExecution` |
| Is state bounded? | `stateOperators[0].numRowsTotal` over time |
| How far event time got | `eventTime.watermark` |
| Why it stopped | `q.exception()`, or the error raised by `awaitTermination()` |
| Metrics pushed to me | `StreamingQueryListener` → `onQueryProgress` |
