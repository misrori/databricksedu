---
title: "Triggers: when a micro-batch runs"
summary: See on a clock when each trigger starts a micro-batch, what that costs in latency and compute, what happens when a batch runs longer than its interval, and how availableNow with maxFilesPerTrigger turns a stream into an incremental batch job.
icon: ⏱️
level: Intermediate
minutes: 10
group: Stream processing
tags: [Structured Streaming, Triggers, availableNow, maxFilesPerTrigger, Serverless]
---
# Triggers: when a micro-batch runs

> The query says **what** to compute. The trigger says **when**: start the next micro-batch right away, on a fixed clock, or process what is there now and stop. That one line decides your latency and your compute bill.

**The one idea to remember:** a trigger trades **latency** for **cost**. An always-on trigger answers in seconds but keeps compute running; `availableNow` on a schedule answers as often as the job runs and pays only while it runs.

## 🎛️ What a trigger decides

This module assumes *Structured Streaming basics* (micro-batches and checkpoints). Every option below is one line on the stream writer.

```viz code
title: The trigger options (display only)
lang: python
---
w = df.writeStream.option("checkpointLocation", chk)

w.toTable("t")                                          # no trigger: default
w.trigger(processingTime="1 minute").toTable("t")
w.trigger(availableNow=True).toTable("t")
w.trigger(once=True).toTable("t")                       # deprecated
w.trigger(continuous="1 second")                        # old, experimental
w.trigger(realTime="5 minutes")                         # real-time mode
---
3 | default | No trigger: the next batch starts **as soon as** the previous one ends and new data is there.
4 | processingTime | One batch per interval, on clock boundaries (10:01, 10:02, …).
5 | availableNow | Process everything that exists **now**, in one or more batches, then stop.
6 | once | Everything in **one** batch, then stop. Deprecated: use availableNow.
7-8 | not micro-batch | `continuous` is an old experimental Spark mode. `realTime` is Databricks real-time mode, covered in *Real-time mode in Structured Streaming*.
```

## ⏱️ Same four files, three triggers

Four files land in a folder. Each batch takes about 10 seconds. Step through when each trigger picks them up.

```viz table
{"title": "Which batch processes each file, and when", "columns": ["file arrives", "default", "processingTime = 1 min", "availableNow, job at 10:05"],
 "rows": [["f1 · 10:00:05", "…", "…", "…"], ["f2 · 10:00:12", "…", "…", "…"], ["f3 · 10:01:30", "…", "…", "…"], ["f4 · 10:03:10", "…", "…", "…"]],
 "steps": [
  {"label": "Files arrive", "note": "The streams were started at 10:00:00. The job for availableNow is scheduled at 10:05."},
  {"label": "Default", "note": "f1 starts batch 0 at once. f2 arrives **while batch 0 runs**, so it waits and starts batch 1 the moment batch 0 ends. Latency: about 10 to 20 seconds. Compute runs the whole time.", "upd": {"0": {"default": "batch 0 · 10:00:05"}, "1": {"default": "batch 1 · 10:00:15"}, "2": {"default": "batch 2 · 10:01:30"}, "3": {"default": "batch 3 · 10:03:10"}}, "hl": [1]},
  {"label": "processingTime", "note": "Batches start only on the minute. At 10:00 and 10:03 there is nothing new, so **no batch** runs. f1 and f2 share one batch. Latency: up to the interval plus the run time, about 70 seconds.", "upd": {"0": {"processingTime = 1 min": "batch 0 · 10:01"}, "1": {"processingTime = 1 min": "batch 0 · 10:01"}, "2": {"processingTime = 1 min": "batch 1 · 10:02"}, "3": {"processingTime = 1 min": "batch 2 · 10:04"}}},
  {"label": "availableNow", "note": "Nothing happens until the job starts at 10:05. Then all four files go into one batch and the query **stops**. Compute runs for about 10 seconds.", "upd": {"0": {"availableNow, job at 10:05": "batch 0 · 10:05"}, "1": {"availableNow, job at 10:05": "batch 0 · 10:05"}, "2": {"availableNow, job at 10:05": "batch 0 · 10:05"}, "3": {"availableNow, job at 10:05": "batch 0 · 10:05"}}},
  {"label": "Compare", "note": "Default: 4 small batches, lowest latency, always on. processingTime: 3 batches, fewer commits, still always on. availableNow: 1 batch, latency up to the job schedule, compute only while it runs."}
 ]}
```

## 🐢 When a batch takes longer than the interval

`processingTime="1 minute"`, and batch 1 has a big backlog. Batches of one query never run in parallel.

```viz timeline
{"title": "processingTime = 1 minute, on the clock",
 "items": [
  {"label": "10:00:00", "title": "batch 0 starts", "sub": "done at 10:00:20", "color": "green", "note": "A normal batch. It ends early, so the query **waits** for the next boundary."},
  {"label": "10:01:00", "title": "batch 1 starts", "sub": "runs 95 s", "color": "amber", "note": "A big backlog. This batch runs until 10:02:35."},
  {"label": "10:02:00", "title": "boundary missed", "sub": "no second batch", "color": "red", "note": "Batch 1 is still running. Spark does **not** start another batch next to it, and it does not queue one batch per missed minute."},
  {"label": "10:02:35", "title": "batch 2 starts at once", "sub": "done at 10:02:50", "color": "purple", "note": "The next batch starts **immediately** after the late one, without waiting for 10:03. Spark logs a warning that the query is falling behind."},
  {"label": "10:03:00", "title": "batch 3", "sub": "back on the clock", "color": "green", "note": "The next boundary after batch 2 started is 10:03:00. The query is on schedule again."},
  {"label": "10:04:00", "title": "no new data", "sub": "no batch", "color": "gray", "note": "processingTime only starts a batch when there is new input."}
 ]}
```

If batches are late all the time, latency keeps growing. Give the stream more compute, limit the batch size, or choose a longer interval.

## 🏁 availableNow: catch up, then stop

`availableNow` notes the end position **when it starts**, then works through it in batches that respect the size limits. Here `maxFilesPerTrigger = 2`.

```viz files
{"title": "landing/  (availableNow, maxFilesPerTrigger = 2)",
 "steps": [
  {"label": "Before the run", "note": "Five files are waiting since the last run.", "add": [{"path": "f1.json", "tag": "new"}, {"path": "f2.json", "tag": "new"}, {"path": "f3.json", "tag": "new"}, {"path": "f4.json", "tag": "new"}, {"path": "f5.json", "tag": "new"}]},
  {"label": "Batch 0", "note": "At most two files per batch. The checkpoint records them as done.", "tag": {"f1.json": "✓ batch 0", "f2.json": "✓ batch 0"}},
  {"label": "f6 arrives", "note": "A file lands **during** the run. It is after the end position noted at the start, so this run ignores it.", "add": [{"path": "f6.json", "tag": "new, after the start"}]},
  {"label": "Batch 1", "note": "The next two files.", "tag": {"f3.json": "✓ batch 1", "f4.json": "✓ batch 1"}},
  {"label": "Batch 2, stop", "note": "Only f5 is left. After this batch the query **stops** on its own. f6 waits for the next run.", "tag": {"f5.json": "✓ batch 2"}}
 ]}
```

The deprecated `once` trigger would put all five files into **one** batch and ignore `maxFilesPerTrigger`. On a large backlog that one batch can run out of memory, which is why availableNow replaced it.

## 🎚️ Limiting the batch size

| Option | Source | Each batch takes at most |
|---|---|---|
| `maxFilesPerTrigger` | Delta table, files | This many new files. Delta default: 1000 |
| `cloudFiles.maxFilesPerTrigger` | Auto Loader | This many new files. Default: 1000 |
| `maxBytesPerTrigger`, `cloudFiles.maxBytesPerTrigger` | Delta table, Auto Loader | About this much data. A soft limit: at least one file is always taken |
| `maxOffsetsPerTrigger` | Kafka | This many offsets |

Set both a file and a byte limit, and a batch stops at whichever comes first. Default, `processingTime` and `availableNow` respect the limits. Smaller batches give steadier run times and a first result sooner. They also mean more commits.

## 📅 Incremental batch: availableNow on a schedule

```viz compare
{"items": [{"icon": "♾️", "title": "Always-on stream", "sub": "default or processingTime", "color": "blue",
            "points": ["Latency: seconds", "❌ compute runs 24 hours a day", "❌ classic compute only", "Batch size follows the arrival rate"],
            "foot": "For data that must be fresh within a minute"},
           {"icon": "📅", "title": "Scheduled availableNow", "sub": "a Lakeflow Job every 15 minutes", "color": "green",
            "points": ["Latency: up to the schedule plus the run", "✅ pay only while it runs", "✅ works on serverless", "Same code, same checkpoint, exactly once"],
            "foot": "For most reporting and medallion pipelines"}]}
```

This pattern is called **incremental batch**. Each run behaves like a batch job, but the checkpoint makes it read only what is new since the last run. Moving between the two is a one-line change to the trigger; the checkpoint stays valid.

## ☁️ Where each trigger runs

| Trigger | Serverless notebooks and jobs | Classic compute |
|---|---|---|
| `availableNow`, `once` | ✅ supported | ✅ |
| default, `processingTime` | ❌ not supported | ✅ |
| `realTime` | ❌ | ✅ dedicated cluster with special settings |
| `continuous` | ❌ | Experimental, few operations: use real-time mode instead |

On serverless, a stream without a trigger, or with `processingTime`, fails to start. Lakeflow Spark Declarative Pipelines choose the trigger for you: a **triggered** pipeline runs like availableNow, a **continuous** pipeline keeps running.

## 🧪 Try it: count the batches

```dataset iot
```

You need no table from the dataset here: the cells write their own tiny JSON files, five rows each, into a volume.

```python run
# Write six small JSON files into a landing folder (clean start)
import json, os, shutil

base = data.volume(CATALOG, SCHEMA) + "/trg"
shutil.rmtree(base, ignore_errors=True)
landing = base + "/landing"
os.makedirs(landing, exist_ok=True)
spark.sql("DROP TABLE IF EXISTS trg_events")

def write_file(n):
    with open(f"{landing}/file_{n:02d}.json", "w") as f:
        for i in range(5):
            f.write(json.dumps({"file": n, "event_id": n * 100 + i, "device_id": i}) + "\n")

for n in range(1, 7):
    write_file(n)
print(sorted(os.listdir(landing)))
```

```python run
# availableNow with at most 2 files per batch: how many batches?
def run(max_files):
    q = (spark.readStream
            .schema("file INT, event_id INT, device_id INT")
            .option("maxFilesPerTrigger", max_files)
            .json(landing)
         .writeStream
            .option("checkpointLocation", base + "/checkpoint")
            .trigger(availableNow=True)
            .toTable("trg_events"))
    q.awaitTermination()
    for p in q.recentProgress:
        p = p if isinstance(p, dict) else json.loads(p.json)
        print("batch", p["batchId"], "| rows:", p["numInputRows"])
    print("rows in trg_events:", spark.table("trg_events").count())

run(2)   # 6 files, 2 per batch
```

```python run
# One more file arrives. The same checkpoint reads only that file
write_file(7)
run(2)
```

> You should see three batches of 10 rows, then one batch of 5 rows (batch 3), and 35 rows in the table. The batch numbers continue across runs because they live in the checkpoint. Run the last cell again without a new file: no batch runs, and the count stays 35.

## Exercise 1: predict the batches

Start a **new** checkpoint over the same seven files, with `maxFilesPerTrigger = 3`. Before you run it, write down how many batches will run and how many rows each will have.

```python todo
# TODO 1: write 7 JSON files of 5 rows each into a fresh folder (or reuse the code above)
# TODO 2: stream them with maxFilesPerTrigger = 3, availableNow, a new checkpoint, into trg_ex1
# TODO 3: print batchId and numInputRows of every batch
import json, os, shutil

base = data.volume(CATALOG, SCHEMA) + "/trg_ex1"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/landing", exist_ok=True)
spark.sql("DROP TABLE IF EXISTS trg_ex1")
```

```python solution
import json, os, shutil

base = data.volume(CATALOG, SCHEMA) + "/trg_ex1"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/landing", exist_ok=True)
spark.sql("DROP TABLE IF EXISTS trg_ex1")

for n in range(1, 8):
    with open(f"{base}/landing/file_{n:02d}.json", "w") as f:
        for i in range(5):
            f.write(json.dumps({"file": n, "event_id": n * 100 + i, "device_id": i}) + "\n")

q = (spark.readStream.schema("file INT, event_id INT, device_id INT")
        .option("maxFilesPerTrigger", 3).json(base + "/landing")
     .writeStream.option("checkpointLocation", base + "/checkpoint")
        .trigger(availableNow=True).toTable("trg_ex1"))
q.awaitTermination()
for p in q.recentProgress:
    p = p if isinstance(p, dict) else json.loads(p.json)
    print("batch", p["batchId"], "| rows:", p["numInputRows"])
# 3 batches: 15, 15 and 5 rows (3 + 3 + 1 files). With once=True it would be one batch of 35.
```

## Exercise 2: a stream that falls behind

A `processingTime` stream cannot run on serverless, but its schedule follows a simple rule: after a batch that started at `t`, the next one starts at the next interval boundary after `t`, or **right away** if the batch ended later than that. Write the rule, then predict the start times for an interval of 30 seconds and batch run times of 10, 45, 50, 5 and 5 seconds.

```python todo
def batch_starts(interval, durations):
    """Start second of each batch. Assume new data is always waiting."""
    starts, now = [], 0
    for d in durations:
        starts.append(now)
        # TODO: compute when the next batch starts
    return starts

print(batch_starts(60, [20, 95, 15, 20]))   # the timeline on the slide: [0, 60, 155, 180]
print(batch_starts(30, [10, 45, 50, 5, 5]))
```

```python solution
def batch_starts(interval, durations):
    """Start second of each batch. Assume new data is always waiting."""
    starts, now = [], 0
    for d in durations:
        starts.append(now)
        next_boundary = now // interval * interval + interval
        now = max(now + d, next_boundary)    # wait for the boundary, or start at once if late
    return starts

print(batch_starts(60, [20, 95, 15, 20]))   # [0, 60, 155, 180]
print(batch_starts(30, [10, 45, 50, 5, 5]))  # [0, 30, 75, 125, 150]
# Two slow batches in a row push the schedule off the clock (75, 125).
# Once a batch is short again, the stream returns to the boundaries (150).

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS trg_events"); spark.sql("DROP TABLE IF EXISTS trg_ex1")
```

## ⚠️ Common mistakes

- ❌ "processingTime = 1 minute gives 1-minute latency." A file can wait up to a full interval, then the batch run time comes on top.
- ❌ "A slow batch is followed by a burst of catch-up batches." Spark starts **one** batch right after it, never several in parallel.
- ❌ Starting a stream without a trigger on serverless. Only `availableNow` and `once` are supported there.
- ❌ Using `once=True` for a big backlog. It ignores the size limits and builds one huge batch.
- ✅ Start with availableNow on a schedule. Move to an always-on trigger only when the latency really needs it.

## 🧭 Cheat sheet

| I want… | Use |
|---|---|
| Process the backlog in limited batches, then stop | `.trigger(availableNow=True)` |
| A batch as soon as data arrives (classic compute) | no trigger |
| One batch per interval (classic compute) | `.trigger(processingTime="1 minute")` |
| Sub-second latency | `.trigger(realTime="5 minutes")`, see *Real-time mode* |
| Smaller batches | `maxFilesPerTrigger`, `maxBytesPerTrigger` |
| See the batches of a finished run | `query.recentProgress` |
