---
title: "Output modes: what each micro-batch writes"
summary: Follow one windowed count through four micro-batches and see exactly which rows append, update and complete mode write each time, what the sink table holds afterwards, which query shapes allow which mode, and how to upsert into Delta with foreachBatch and MERGE.
icon: 📤
level: Intermediate
minutes: 12
group: Stream processing
tags: [Structured Streaming, Output modes, Watermarks, foreachBatch, MERGE]
---
# Output modes: what each micro-batch writes

> An aggregation keeps a **result table** in state: one row per window. After every micro-batch, Spark must decide which of those rows to send to the sink. The output mode is that decision.

**The one idea to remember:** **append** writes a row once, when it is final. **update** writes the rows that changed in this batch. **complete** writes the whole result table, every batch.

## 📤 One query, three ways to write it

The running example counts events in 10-minute tumbling windows on event time, with a 10-minute watermark. Only the output mode changes.

```viz code
title: A windowed count (display only)
lang: python
---
counts = (events
    .withWatermark("event_ts", "10 minutes")
    .groupBy(F.window("event_ts", "10 minutes"))
    .count())

(counts.writeStream
    .outputMode("append")          # or "update", or "complete"
    .option("checkpointLocation", chk)
    .trigger(availableNow=True)
    .toTable("event_counts"))
---
2 | watermark | Max event time seen minus 10 minutes, updated at the **end** of each batch. Details in *Watermarks and stateful streaming*.
3-4 | result table | One row per window, kept in the state store between batches.
7 | output mode | Which rows of the result table go to the sink after each batch.
```

## 🧮 The result table, batch by batch

Four micro-batches arrive. Watch the result table and the watermark. Windows are shown as `start–end`.

```viz table
{"title": "Result table in state (10-minute windows, 10-minute watermark)", "columns": ["window", "count", "this batch", "status"],
 "rows": [["10:00–10:10", 2, "new", "open"], ["10:10–10:20", 1, "new", "open"]],
 "steps": [
  {"label": "Batch 0: 10:02, 10:07, 10:12", "note": "Two windows open. Max event time 10:12, so after the batch the watermark becomes **10:02**."},
  {"label": "Batch 1: 10:09, 10:21, 10:24", "note": "10:09 is late, but newer than the watermark 10:02, so it counts. Max event time 10:24: the watermark becomes **10:14**. Window 10:00–10:10 ends before that, so it is **final**.", "upd": {"0": {"count": 3, "this batch": "+1 (late)", "status": "final"}, "1": {"this batch": "–"}}, "add": [["10:20–10:30", 2, "new", "open"]], "hl": [0]},
  {"label": "Batch 2: 10:27, 10:31", "note": "The watermark 10:14 now applies: the final window is written by append and **removed from state**. After this batch the watermark is **10:21**, so 10:10–10:20 is final.", "upd": {"0": {"this batch": "–", "status": "removed from state"}, "1": {"status": "final"}, "2": {"count": 3, "this batch": "+1", "status": "open"}}, "add": [["10:30–10:40", 1, "new", "open"]], "hl": [1]},
  {"label": "Batch 3: 10:33, 10:45", "note": "10:10–10:20 is written and removed. The watermark moves to **10:35**: 10:20–10:30 is final and waits for the next batch. Two windows are still open.", "upd": {"1": {"status": "removed from state"}, "2": {"this batch": "–", "status": "final"}, "3": {"count": 2, "this batch": "+1", "status": "open"}}, "add": [["10:40–10:50", 1, "new", "open"]], "hl": [2]}
 ]}
```

"Removed from state" is true for append and update. Complete mode keeps every row: more on that below.

## 🔍 What each mode writes, batch by batch

The same four batches. A cell lists the rows written to the sink as `window start → count`.

```viz table
{"title": "Rows written per micro-batch", "columns": ["batch", "append", "update", "complete"],
 "rows": [["0", "nothing", "10:00 → 2 · 10:10 → 1", "10:00 → 2 · 10:10 → 1"]],
 "steps": [
  {"label": "Batch 0", "note": "No window is final, so **append** writes nothing. **update** writes the two rows that changed. **complete** writes the whole table, which is the same two rows."},
  {"label": "Batch 1", "note": "update skips 10:10, because no event fell into it. complete writes all three rows again.", "add": [["1", "nothing", "10:00 → 3 · 10:20 → 2", "10:00 → 3 · 10:10 → 1 · 10:20 → 2"]], "hl": [1]},
  {"label": "Batch 2", "note": "append writes its **first** row: the 10:00 window, final since the watermark reached 10:14. update writes only the two changed windows.", "add": [["2", "10:00 → 3", "10:20 → 3 · 10:30 → 1", "10:00 → 3 · 10:10 → 1 · 10:20 → 3 · 10:30 → 1"]], "hl": [2]},
  {"label": "Batch 3", "note": "append writes the 10:10 window. complete writes five rows, including windows that have not changed for three batches.", "add": [["3", "10:10 → 1", "10:30 → 2 · 10:40 → 1", "all five: 10:00 → 3 · 10:10 → 1 · 10:20 → 3 · 10:30 → 2 · 10:40 → 1"]], "hl": [3]},
  {"label": "Totals", "note": "Rows written in four batches: append **2**, update **8**, complete **14** (2 + 3 + 4 + 5). Append is final but late; update is fresh but needs an upsert; complete grows every batch."}
 ]}
```

## 🗄️ What the sink table holds

Append adds rows. Update must **upsert** them. Complete **replaces** the table.

```viz table
{"title": "Sink tables after each batch (count per window)", "columns": ["window", "append sink", "update sink (MERGE)", "complete sink"],
 "rows": [["10:00–10:10", "–", "2 · inserted", "2"], ["10:10–10:20", "–", "1 · inserted", "1"]],
 "steps": [
  {"label": "After batch 0", "note": "The append table is still empty. The complete table was written in full: 2 rows."},
  {"label": "After batch 1", "note": "MERGE updated one row and inserted one. Complete rewrote all 3 rows.", "upd": {"0": {"update sink (MERGE)": "3 · updated", "complete sink": "3"}, "1": {"update sink (MERGE)": "1"}}, "add": [["10:20–10:30", "–", "2 · inserted", "2"]]},
  {"label": "After batch 2", "note": "The first final row lands in the append table. Complete rewrote 4 rows.", "upd": {"0": {"append sink": "3 ✅", "update sink (MERGE)": "3"}, "2": {"update sink (MERGE)": "3 · updated", "complete sink": "3"}}, "add": [["10:30–10:40", "–", "1 · inserted", "1"]], "hl": [0]},
  {"label": "After batch 3", "note": "Complete rewrote 5 rows to change two of them.", "upd": {"1": {"append sink": "1 ✅"}, "2": {"update sink (MERGE)": "3"}, "3": {"update sink (MERGE)": "2 · updated", "complete sink": "2"}}, "add": [["10:40–10:50", "–", "1 · inserted", "1"]], "hl": [1]},
  {"label": "Compare", "note": "The update and complete tables hold the same numbers, including the 3 windows that are still open. The append table holds only final windows, and its rows never change.", "hl": [2, 3, 4]}
 ]}
```

## ✅ Which query allows which mode

Spark checks the combination when the query **starts**, and refuses the ones that make no sense.

| Query shape | append | update | complete |
|---|---|---|---|
| Stateless: `select`, `filter`, stream-static join | ✅ | ✅ same as append | ❌ no result table to repeat |
| Aggregation without a watermark | ❌ rows are never final | ✅ | ✅ |
| Aggregation with a watermark on the window | ✅ | ✅ | ✅ |
| Stream-stream join | ✅ | ❌ | ❌ |

**Complete mode never drops state.** It must write every window every batch, so it keeps every window, and the watermark cannot remove anything. On a long-running stream the state and each write grow without limit. Session windows are one more exception: in a stream they allow append but not update.

## 🔺 Output modes and the Delta sink

The Delta sink supports **append** (each batch adds rows) and **complete** (each batch overwrites the table). For **update**, a row must replace an earlier version of itself, so write each batch yourself with `foreachBatch` and `MERGE`.

```viz code
title: update mode into a Delta table (display only)
lang: python
---
def upsert(batch_df, batch_id):
    batch_df.createOrReplaceTempView("changes")
    batch_df.sparkSession.sql("""
        MERGE INTO event_counts t
        USING changes s ON t.window_start = s.window_start
        WHEN MATCHED THEN UPDATE SET t.cnt = s.cnt
        WHEN NOT MATCHED THEN INSERT *""")

(counts.select(F.col("window.start").alias("window_start"), F.col("count").alias("cnt"))
    .writeStream.outputMode("update")
    .foreachBatch(upsert)
    .option("checkpointLocation", chk)
    .trigger(availableNow=True).start())
---
1 | foreachBatch | Called once per micro-batch with a normal DataFrame: only the rows update mode emits.
2-7 | MERGE | The window is the key. A changed window overwrites its old count; a new one is inserted.
9 | flatten | Give the window a plain key column for the MERGE.
10-11 | update | The mode decides what `batch_df` contains; the function decides how it is written.
```

## 🧪 Try it: log what each mode writes

```dataset iot
```

You need no dataset table here. The cells write tiny JSON files with hand-made event times, one file per step, and run the same count in all three modes. A `foreachBatch` function logs every emitted row with the batch id and mode into `om_emitted`, and imitates the sink of each mode: append, MERGE, or overwrite.

```python run
# Set up: events folder, sink tables, the log, and the three streams (clean start)
import json, os, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/om"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/events", exist_ok=True)
FQ = f"`{CATALOG}`.`{SCHEMA}`"
spark.sql("CREATE OR REPLACE TABLE om_emitted (mode STRING, run INT, batch_id BIGINT, window_start STRING, cnt BIGINT)")
for m in ("append", "update", "complete"):
    spark.sql(f"CREATE OR REPLACE TABLE om_sink_{m} (window_start STRING, cnt BIGINT)")

BATCHES = [["10:02", "10:07", "10:12"], ["10:09", "10:21", "10:24"], ["10:27", "10:31"], ["10:33", "10:45"]]

def windowed_counts():
    events = (spark.readStream.schema("event_time STRING, sensor STRING")
                .option("maxFilesPerTrigger", 1).json(base + "/events")
                .withColumn("event_ts", F.col("event_time").cast("timestamp")))
    return (events.withWatermark("event_ts", "10 minutes")
                  .groupBy(F.window("event_ts", "10 minutes")).count())

def make_writer(mode, run_no):
    def write_batch(df, batch_id):
        out = df.select(F.date_format("window.start", "HH:mm").alias("window_start"), F.col("count").alias("cnt"))
        log = out.select(F.lit(mode).alias("mode"), F.lit(run_no).alias("run"), F.lit(batch_id).alias("batch_id"), "*")
        if out.count() == 0:
            log = df.sparkSession.createDataFrame([(mode, run_no, batch_id, "(nothing)", None)],
                                                  "mode STRING, run INT, batch_id BIGINT, window_start STRING, cnt BIGINT")
        log.write.mode("append").saveAsTable(f"{FQ}.om_emitted")
        sink = f"{FQ}.om_sink_{mode}"
        if mode == "append":
            out.write.mode("append").saveAsTable(sink)
        elif mode == "complete":
            out.write.mode("overwrite").saveAsTable(sink)
        else:
            out.createOrReplaceTempView("om_changes")
            df.sparkSession.sql(f"""MERGE INTO {sink} t USING om_changes s ON t.window_start = s.window_start
                                    WHEN MATCHED THEN UPDATE SET t.cnt = s.cnt WHEN NOT MATCHED THEN INSERT *""")
    return write_batch

def feed(run_no):
    """Write file number run_no, then run the count once in each mode."""
    with open(f"{base}/events/batch_{run_no}.json", "w") as f:
        for t in BATCHES[run_no]:
            f.write(json.dumps({"event_time": f"2026-01-15T{t}:00", "sensor": "s1"}) + "\n")
    for mode in ("append", "update", "complete"):
        (windowed_counts().writeStream
            .outputMode(mode)
            .foreachBatch(make_writer(mode, run_no))
            .option("checkpointLocation", f"{base}/checkpoint_{mode}")
            .trigger(availableNow=True)
            .start()
            .awaitTermination())

feed(0)
spark.table("om_emitted").orderBy("mode", "batch_id", "window_start").show()
```

```python run
# Feed the next three files, one run each
for run_no in (1, 2, 3):
    feed(run_no)
print("done")
```

```sql run
-- What did each mode write, run by run?
SELECT mode, run, batch_id, window_start, cnt
FROM om_emitted
ORDER BY mode, run, batch_id, window_start;
```

```sql run
-- And what does each sink table hold now?
SELECT 'append' AS sink, * FROM om_sink_append
UNION ALL SELECT 'update', * FROM om_sink_update
UNION ALL SELECT 'complete', * FROM om_sink_complete
ORDER BY sink, window_start;
```

> **What is guaranteed and what is not.** update and complete write exactly what the slides show. Append writes a window only in a batch that **starts** with the watermark past the window end. When the watermark moves, Spark may run an extra batch **without new data** to write final windows earlier, and whether an `availableNow` run does that can differ between runtimes. So the 10:00 window may show up in run 1 with its own `batch_id` instead of run 2, and the 10:20 window may already appear after run 3. Compare runs and modes, not exact batch numbers.

## Exercise 1: which combinations does Spark accept?

Try three query shapes with all three modes and record which ones start. Predict the 3 × 3 grid first, then compare it with the table on the slide.

```python todo
import json, os, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/om_ex1"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/events", exist_ok=True)
with open(base + "/events/f1.json", "w") as f:
    for t in ("10:02", "10:07", "10:12"):
        f.write(json.dumps({"event_time": f"2026-01-15T{t}:00", "sensor": "s1"}) + "\n")

events = (spark.readStream.schema("event_time STRING, sensor STRING").json(base + "/events")
            .withColumn("event_ts", F.col("event_time").cast("timestamp")))

shapes = {
    "stateless": events.filter("sensor = 's1'"),
    # TODO 1: "agg, no watermark": a 10-minute window count without withWatermark
    # TODO 2: "agg + watermark": the same count after withWatermark("event_ts", "10 minutes")
}
# TODO 3: for each shape and mode, start it with foreachBatch(lambda df, i: None), availableNow
#         and its own checkpoint. Print "ok", or the first line of the error.
```

```python solution
import json, os, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/om_ex1"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/events", exist_ok=True)
with open(base + "/events/f1.json", "w") as f:
    for t in ("10:02", "10:07", "10:12"):
        f.write(json.dumps({"event_time": f"2026-01-15T{t}:00", "sensor": "s1"}) + "\n")

events = (spark.readStream.schema("event_time STRING, sensor STRING").json(base + "/events")
            .withColumn("event_ts", F.col("event_time").cast("timestamp")))

shapes = {
    "stateless": events.filter("sensor = 's1'"),
    "agg, no watermark": events.groupBy(F.window("event_ts", "10 minutes")).count(),
    "agg + watermark": events.withWatermark("event_ts", "10 minutes")
                             .groupBy(F.window("event_ts", "10 minutes")).count(),
}
for n, (name, df) in enumerate(shapes.items()):
    for mode in ("append", "update", "complete"):
        try:
            (df.writeStream.outputMode(mode).foreachBatch(lambda d, i: None)
               .option("checkpointLocation", f"{base}/chk/{n}_{mode}")
               .trigger(availableNow=True).start().awaitTermination())
            result = "ok"
        except Exception as e:
            result = "refused: " + str(e).strip().splitlines()[0][:90]
        print(f"{name:<18} {mode:<9} {result}")
# stateless: append ok, update ok, complete refused (no aggregation)
# agg, no watermark: append refused (rows never final), update ok, complete ok
# agg + watermark: all three ok
```

## Exercise 2: a longer watermark delay

Run the four batches from the lecture in **append** mode only, written straight to a Delta table with `toTable`, but with a **30-minute** watermark. Predict first: which windows are in the table after the fourth run?

```python todo
import json, os, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/om_ex2"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/events", exist_ok=True)
spark.sql("DROP TABLE IF EXISTS om_ex2_final")
BATCHES = [["10:02", "10:07", "10:12"], ["10:09", "10:21", "10:24"], ["10:27", "10:31"], ["10:33", "10:45"]]

# TODO 1: for each batch, write it as one JSON file (event_time like "2026-01-15T10:02:00")
# TODO 2: then run: read the folder, cast event_time to event_ts, withWatermark("event_ts", "30 minutes"),
#         10-minute window count, select window start as HH:mm and the count,
#         outputMode("append"), availableNow, toTable("om_ex2_final")
# TODO 3: show the table after the last run
```

```python solution
import json, os, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/om_ex2"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/events", exist_ok=True)
spark.sql("DROP TABLE IF EXISTS om_ex2_final")
BATCHES = [["10:02", "10:07", "10:12"], ["10:09", "10:21", "10:24"], ["10:27", "10:31"], ["10:33", "10:45"]]

for n, times in enumerate(BATCHES):
    with open(f"{base}/events/batch_{n}.json", "w") as f:
        for t in times:
            f.write(json.dumps({"event_time": f"2026-01-15T{t}:00", "sensor": "s1"}) + "\n")
    (spark.readStream.schema("event_time STRING, sensor STRING").json(base + "/events")
        .withColumn("event_ts", F.col("event_time").cast("timestamp"))
        .withWatermark("event_ts", "30 minutes")
        .groupBy(F.window("event_ts", "10 minutes")).count()
        .select(F.date_format("window.start", "HH:mm").alias("window_start"), "count")
     .writeStream.outputMode("append")
        .option("checkpointLocation", base + "/checkpoint")
        .trigger(availableNow=True).toTable("om_ex2_final")
     .awaitTermination())

spark.table("om_ex2_final").orderBy("window_start").show()
# Watermarks after each batch: 09:42, 09:54, 10:01, 10:15. No window ends before 10:01,
# so the table is empty, or holds only 10:00 -> 3 if an extra no-data batch ran with 10:15.
# A longer delay accepts later data, but append mode writes its results later.

# Clean up when you are done
# for t in ("om_emitted", "om_sink_append", "om_sink_update", "om_sink_complete", "om_ex2_final"):
#     spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ Expecting append mode to show a window as it fills up. It writes nothing until the watermark passes the window end.
- ❌ `outputMode("update")` straight into a Delta table. Use `foreachBatch` with `MERGE`.
- ❌ Complete mode on a long-running windowed stream. It keeps every window forever and rewrites them all each batch.
- ❌ An aggregation in append mode without a watermark. Spark refuses to start it.
- ✅ Final facts for downstream tables: append with a watermark. Fresh partial numbers for a dashboard: update with `MERGE`. A small, bounded summary: complete.

## 🧭 Cheat sheet

| I want… | Use |
|---|---|
| Each window written once, when final | `outputMode("append")` + `withWatermark` |
| Only the rows changed in this batch | `outputMode("update")` |
| Update rows of a Delta table | `update` + `foreachBatch` with `MERGE` |
| The full result every batch | `outputMode("complete")` (state never shrinks) |
| To see what a batch emitted | `foreachBatch(fn)`: `fn(batch_df, batch_id)` |
