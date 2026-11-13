---
title: Structured Streaming basics
summary: Treat a stream as a table that keeps growing. See how micro-batches, checkpoints and triggers work, which output modes fit which queries, and how a stream from a Delta table picks up only the new rows.
icon: 🌊
level: Beginner
minutes: 12
group: Ingestion and pipelines
tags: [Structured Streaming, Checkpoints, Triggers, Delta Lake]
---
# Structured Streaming basics

> A streaming query is a normal DataFrame query over a table that never stops growing. Spark runs it again and again on the **new** rows only, and writes down how far it got after every run.

**The one idea to remember:** the **checkpoint** is the memory of a stream. It records which input was read and which output was committed, so a restart continues exactly where the last batch ended.

## ♾️ A stream is an unbounded table

New rows are appended to the input table. Each micro-batch processes only the rows that arrived since the last one. Here the query is `filter(temperature BETWEEN -50 AND 60)`.

```viz table
{"title": "readings (input) and what reaches ss_readings_clean", "columns": ["batch", "device_id", "temperature", "written to sink"],
 "rows": [[0, 17, 21.4, "…"], [0, 42, 999.0, "…"], [0, 8, -18.2, "…"]],
 "steps": [
  {"label": "Batch 0 arrives", "note": "The stream starts. Everything already in the table is the first batch."},
  {"label": "Batch 0 runs", "note": "Two rows pass the filter and are appended to the sink. The 999 reading is dropped.", "upd": {"0": {"written to sink": "✅ yes"}, "1": {"written to sink": "❌ filtered"}, "2": {"written to sink": "✅ yes"}}, "del": [1]},
  {"label": "New rows", "note": "Two new rows are appended to `readings`. Batch 0 is never read again.", "add": [[1, 23, 22.0, "…"], [1, 17, 21.9, "…"]], "hl": [3, 4]},
  {"label": "Batch 1 runs", "note": "Only the two new rows are processed and appended. The query text did not change: the same filter, applied incrementally.", "upd": {"3": {"written to sink": "✅ yes"}, "4": {"written to sink": "✅ yes"}}},
  {"label": "Result", "note": "The sink holds 4 rows: exactly what a batch query over all 5 input rows would return."}
 ]}
```

## 🔁 Inside one micro-batch

```viz flow
{"title": "Micro-batch N",
 "nodes": [{"icon": "📝", "title": "Plan", "sub": "write offsets/N", "color": "navy"},
           {"icon": "📥", "title": "Read", "sub": "only offsets N-1 → N", "color": "blue"},
           {"icon": "⚙️", "title": "Process", "sub": "your DataFrame logic", "color": "purple"},
           {"icon": "💾", "title": "Write", "sub": "one Delta commit", "color": "green"},
           {"icon": "✅", "title": "Commit", "sub": "write commits/N", "color": "teal"}],
 "steps": [
  {"label": "Plan", "focus": [0], "note": "The driver asks the source for its latest position and writes the range for this batch to `offsets/N` **before** reading anything. This is the write-ahead log."},
  {"label": "Read", "focus": [1], "note": "Only data between the previous end offset and the new one is read. For a Delta source that means new table versions."},
  {"label": "Process", "focus": [2], "note": "The batch is an ordinary DataFrame: filters, joins with static tables, aggregations."},
  {"label": "Write", "focus": [3], "note": "The Delta sink writes the batch in one commit and stores the query id and batch number (a `txn` action) in the table log."},
  {"label": "Commit", "focus": [4], "note": "`commits/N` marks the batch as done. After a crash between Write and Commit, batch N is replayed, and the Delta sink skips it because it already has that batch number. **Exactly once.**"}
 ]}
```

## 🔌 Sources and sinks

| Source | Position it tracks | Notes |
|---|---|---|
| **Delta table** `spark.readStream.table(...)` | Table version and file index | New commits only. The usual choice for silver and gold |
| **Files** (Auto Loader, `cloudFiles`) | Files already seen | See *Auto Loader and COPY INTO* |
| **Kafka**, Kinesis, Pub/Sub | Offsets per partition | Data expires after the bus retention period |

The usual sink is a Delta table: `writeStream.toTable("name")`. `foreachBatch` runs any batch code per micro-batch, for example a `MERGE`.

## 📌 Checkpoints, file by file

```viz files
{"title": "ss_demo/checkpoint/",
 "steps": [
  {"label": "Start", "note": "`metadata` stores the query id. It identifies this stream forever.", "add": [{"path": "metadata", "tag": "query id"}]},
  {"label": "Batch 0 planned", "note": "The offsets file is written first: which table version this batch reads up to.", "add": [{"path": "offsets/0", "tag": "readings v1"}]},
  {"label": "Batch 0 done", "note": "Written only after the sink commit succeeded.", "add": [{"path": "commits/0", "tag": "done"}]},
  {"label": "Run again, no new data", "note": "With `availableNow`, nothing new means no batch at all. The folder does not change."},
  {"label": "New rows, batch 1", "note": "New commits in `readings`. A new pair of files: the stream continued from offsets/0, it did not start over.", "add": [{"path": "offsets/1", "tag": "readings v2"}, {"path": "commits/1", "tag": "done"}]},
  {"label": "Stateful query", "note": "Aggregations and deduplication also save their state here, versioned per batch. Covered in *Watermarks and stateful streaming*.", "add": [{"path": "state/0/…", "tag": "only for stateful queries"}]}
 ]}
```

One checkpoint belongs to one query. Never share it, never delete it to "fix" a stream: a new checkpoint means starting from the beginning.

## ⏱️ Triggers

```viz compare
{"items": [{"icon": "🏁", "title": "availableNow=True", "sub": "incremental batch", "color": "green",
            "points": ["Process everything new, in one or more batches, then **stop**", "✅ run it from a scheduled job", "✅ pay only while it runs"],
            "foot": "Works on serverless"},
           {"icon": "⏩", "title": "Default (no trigger)", "sub": "continuous micro-batches", "color": "blue",
            "points": ["Next batch starts as soon as the last one ends", "Lowest latency in micro-batch mode", "❌ compute runs all the time"]},
           {"icon": "⏲️", "title": "processingTime", "sub": "\"1 minute\"", "color": "purple",
            "points": ["One batch per interval", "Fewer, larger batches and commits", "❌ compute runs all the time"]},
           {"icon": "🧪", "title": "continuous", "sub": "experimental", "color": "gray",
            "points": ["Millisecond latency, few operations supported", "❌ not the usual choice", "`once=True` is deprecated: use availableNow"]}]}
```

## 📤 Output modes

| Mode | Writes each batch | Allowed for |
|---|---|---|
| **append** (default) | Only new rows, each written once | Stateless queries, and aggregations **with a watermark** |
| **complete** | The whole result table again | Aggregations only. All state is kept |
| **update** | Only result rows that changed | Aggregations. Delta tables need `foreachBatch` with `MERGE` |

An aggregation without a watermark cannot use append mode, because its rows are never final. Spark refuses to start it.

## 🔺 Streaming from a Delta table

- The first run reads the current snapshot of the table, then each new commit after it.
- A Delta source expects **appends**. An `UPDATE`, `DELETE` or `MERGE` on the source makes the stream fail. Set `skipChangeCommits` to `true` to ignore those commits, or read the Change Data Feed instead.
- `startingVersion` starts from a given version instead of the snapshot (only for a new checkpoint).
- `maxFilesPerTrigger` (1000 by default) and `maxBytesPerTrigger` limit the size of each batch.
- On restart the checkpoint wins: options such as `startingVersion` are ignored once a checkpoint exists.

## 🧪 Try it: a stream that picks up new rows

```dataset iot
```

Stream `readings` into a clean table, keeping only plausible temperatures. The first cell starts clean every time.

```python run
# Stream readings into ss_readings_clean (clean start)
import os, shutil
from pyspark.sql import functions as F

checkpoint = data.volume(CATALOG, SCHEMA) + "/ss_demo/checkpoint"
shutil.rmtree(checkpoint, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS ss_readings_clean")

def run_stream():
    q = (spark.readStream.table("readings")
            .filter(F.col("temperature").between(-50, 60))
         .writeStream
            .option("checkpointLocation", checkpoint)
            .trigger(availableNow=True)
            .toTable("ss_readings_clean"))
    q.awaitTermination()
    print("rows in ss_readings_clean:", spark.table("ss_readings_clean").count())

run_stream()
```

```sql run
-- New readings arrive: 300 more rows, a month later, each time you run this cell
INSERT INTO readings
SELECT reading_id + (SELECT max(reading_id) FROM readings), device_id,
       event_ts + INTERVAL 31 DAYS, ingest_ts + INTERVAL 31 DAYS,
       temperature, humidity, battery, status
FROM readings
WHERE reading_id <= 300;
```

```python run
# Run the same stream again: only the new rows are processed
run_stream()
spark.sql("DESCRIBE HISTORY ss_readings_clean").select("version", "operation", "operationParameters").show(truncate=False)
```

```python run
# What did the stream write down?
for root, _, files in sorted(os.walk(checkpoint)):
    for name in sorted(files):
        print(os.path.join(root, name).replace(checkpoint, "."))
last = max((f for f in os.listdir(checkpoint + "/offsets") if f.isdigit()), key=int)
print(f"\n== offsets/{last}\n" + open(f"{checkpoint}/offsets/{last}").read())
```

> The count grows by the new rows only, and the history shows one `STREAMING UPDATE` per batch with its `epochId`. The last `offsets` file names the source table version (`reservoirVersion`) the batch read up to.

## Exercise 1: the checkpoint is the memory

Stream the `ERROR` readings into `ss_errors`. Run it twice with the same checkpoint, then once with a **new** checkpoint. Predict the row count after each run.

```python todo
# TODO 1: a function that streams readings WHERE status = 'ERROR' into ss_errors
#         with availableNow and a checkpoint path you pass in
# TODO 2: run it twice with checkpoint A, print the count after each run
# TODO 3: run it with checkpoint B, print the count
```

```python solution
import shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/ss_ex1"
shutil.rmtree(base, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS ss_errors")

def errors_stream(chk):
    (spark.readStream.table("readings").filter(F.col("status") == "ERROR")
        .writeStream.option("checkpointLocation", chk)
        .trigger(availableNow=True).toTable("ss_errors")
        .awaitTermination())
    print(spark.table("ss_errors").count())

errors_stream(base + "/A")   # about 500 error readings
errors_stream(base + "/A")   # same count: nothing new since the last commit
errors_stream(base + "/B")   # doubled: a new checkpoint knows nothing and reads everything again
```

## Exercise 2: complete mode

Count readings per `status` with `outputMode("complete")` into `ss_status_counts`. Add rows to `readings`, run again, and predict what the table holds. Then look for a `state` folder in the checkpoint.

```python todo
# TODO 1: readStream readings, groupBy("status").count(), outputMode("complete"), availableNow
# TODO 2: insert 100 new readings (copy reading_id <= 100 with reading_id + 2000000), run again
# TODO 3: show the table and list the checkpoint folders
```

```python solution
import os, shutil
chk = data.volume(CATALOG, SCHEMA) + "/ss_ex2/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS ss_status_counts")

def status_counts():
    (spark.readStream.table("readings").groupBy("status").count()
        .writeStream.outputMode("complete").option("checkpointLocation", chk)
        .trigger(availableNow=True).toTable("ss_status_counts")
        .awaitTermination())
    spark.table("ss_status_counts").orderBy("status").show()

status_counts()
spark.sql("""INSERT INTO readings SELECT reading_id + 2000000, device_id, event_ts, ingest_ts,
             temperature, humidity, battery, status FROM readings WHERE reading_id <= 100""")
status_counts()
# Still 3 rows (OK, WARN, ERROR), but the counts went up by 100 in total: complete mode
# rewrites the whole result each batch, from the running counts kept in state.
print(sorted(os.listdir(chk)))   # includes 'state'

# Clean up when you are done
# spark.sql("DROP TABLE ss_status_counts"); spark.sql("DROP TABLE ss_errors"); shutil.rmtree(chk)
```

## ⚠️ Common mistakes

- ❌ Sharing one checkpoint between two queries, or deleting it to recover. Each query needs its own, kept forever.
- ❌ Running `UPDATE` or `DELETE` on a streaming source table and expecting the stream to continue. Use `skipChangeCommits` or the Change Data Feed.
- ❌ An aggregation in append mode without a watermark. Spark rejects it.
- ❌ Expecting `availableNow` to keep running. It stops when the backlog is processed.
- ✅ Use `availableNow` from a scheduled job when minutes of latency are fine.
- ✅ Write streams to Delta tables: their commits make the sink exactly-once.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Read new rows of a Delta table | `spark.readStream.table("t")` |
| Write a stream to a table | `.writeStream.option("checkpointLocation", p).toTable("t")` |
| Process the backlog, then stop | `.trigger(availableNow=True)` |
| Ignore updates and deletes in the source | `.option("skipChangeCommits", "true")` |
| Limit batch size | `.option("maxFilesPerTrigger", 100)` |
| Upsert each batch | `.foreachBatch(fn)` with `MERGE` inside |
| Wait for an availableNow run | `query.awaitTermination()` |
