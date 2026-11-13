---
title: "Recap: Databricks Streaming and Lakeflow Spark Declarative Pipelines"
summary: Recap of course 1 of Advanced Data Engineering with Databricks. How Structured Streaming keeps state, emits results and recovers, and how declarative pipelines apply it to ingestion, joins, deduplication and CDC.
icon: 🌊
level: Advanced
minutes: 10
group: Advanced Data Engineering with Databricks
tags: [Structured Streaming, Watermarks, Checkpoints, AUTO CDC, Lakeflow Spark Declarative Pipelines]
---
# Recap: Databricks Streaming and Lakeflow Spark Declarative Pipelines

> Course 1 of 4. Production streaming: how **Structured Streaming** keeps state, emits results and recovers, and how **declarative pipelines** apply it to ingestion, joins, deduplication and **CDC**.

**The one idea to remember:** a stream is an **unbounded table** processed incrementally. **Checkpoints** make it exactly-once, **watermarks** bound its state, and declarative pipelines manage most of this for you.

## 🗺️ What we covered

| Topic | Key takeaway |
|---|---|
| Streaming concepts | Unbounded table, micro-batches, latency vs cost, batch and streaming with the same API |
| Structured Streaming basics | `readStream` / `writeStream`, sources and sinks, **triggers**, **output modes**, **checkpoints** |
| Stateful processing | Aggregations, **windows** (tumbling, sliding, session), **watermarks**, late data |
| Streaming joins and deduplication | Stream-static vs stream-stream joins, `dropDuplicatesWithinWatermark` |
| Streaming in declarative pipelines | Streaming tables, Auto Loader and Kafka ingestion, append flows, quarantine |
| CDC and SCD | **AUTO CDC** with `SEQUENCE BY`, SCD Type 1 and 2, snapshots, change data feed |

## 🧩 Structured Streaming in one example

```viz code
title: A windowed stream from bronze to silver
lang: python
---
from pyspark.sql import functions as F
events = spark.readStream.table("main.bronze.device_events")   # source: Delta table, Auto Loader, Kafka...
per_window = (events
    .withWatermark("event_ts", "10 minutes")     # accept data up to 10 min late, then drop state
    .groupBy(F.window("event_ts", "5 minutes"), "device_id")
    .agg(F.avg("temp").alias("avg_temp")))
(per_window.writeStream
    .outputMode("append")                        # emit each window once, when it is final
    .option("checkpointLocation", "/Volumes/main/chk/device_5min")
    .trigger(availableNow=True)                  # process what's there, then stop
    .toTable("main.silver.device_5min"))
---
2 | Source | `readStream` treats the table as an **unbounded table**: every micro-batch reads only the new rows.
3-4 | Watermark | Events up to 10 minutes late are still accepted. Older state is dropped.
5-6 | Stateful aggregation | One row per 5-minute window and device. The running averages live in the **state store**.
7-8 | Output mode | **Append** writes each window once, when the watermark has passed it.
9 | Checkpoint | Offsets, committed batches and state. This is what makes the query exactly-once and restartable.
10-11 | Trigger and sink | `availableNow` processes what is there, then stops. The result lands in a Delta table.
```

## ⚙️ Triggers, output modes, checkpoints

| Concept | Options |
|---|---|
| **Trigger** | default / `processingTime="1 minute"` (continuous micro-batches) · **`availableNow=True`** (incremental batch, then stop) · real-time mode (very low latency) |
| **Output mode** | **Append**: only new, final rows (aggregations need a watermark) · **Update**: changed rows (use with `foreachBatch` + `MERGE`) · **Complete**: whole result each trigger (keeps all state) |
| **Checkpoint** | Source offsets + committed batches + state. **One per query.** Never share it or delete it |

## 🪟 State and windows

```viz compare
{"items": [
  {"icon": "🧱", "title": "Tumbling", "sub": "fixed, non-overlapping", "color": "blue", "points": ["\"per 5 minutes\"", "Each event is in exactly one window"]},
  {"icon": "🎚️", "title": "Sliding", "sub": "overlapping", "color": "purple", "points": ["\"last 10 minutes, every 5 minutes\"", "An event can be in several windows"]},
  {"icon": "💬", "title": "Session", "sub": "gap-based", "color": "teal", "points": ["\"activity bursts per user\"", "A window closes after a gap without events"]}
 ]}
```

- **Stateless** operations (`select`, `filter`, stream-static join) do not remember anything between micro-batches.
- **Stateful** operations (aggregations, `dropDuplicates`, stream-stream joins) keep **state** in the state store (RocksDB), and it is saved in the checkpoint.

## 💧 Watermarks

**Watermark** = the latest event time seen minus the allowed delay. Windows older than the watermark are **finalized** and their state is **dropped**. Events arriving later than that can be ignored.

```viz table
{"title": "5-minute windows, watermark delay 10 minutes",
 "columns": ["batch", "event_ts", "watermark after batch", "what happens"],
 "rows": [[1, "10:02", "09:57", "window 10:00-10:05 opens"], [1, "10:07", "09:57", "window 10:05-10:10 opens"]],
 "steps": [
  {"label": "Batch 1", "note": "The latest event time is 10:07, so the watermark becomes 10:07 minus 10 minutes = 09:57. Both windows stay open in state."},
  {"label": "Batch 2", "note": "An event at 10:16 moves the watermark to 10:06. Window 10:00-10:05 ends before it, so it is **finalized**, written once in append mode, and its state is dropped.", "add": [[2, "10:16", "10:06", "window 10:00-10:05 final"]], "hl": [2]},
  {"label": "Late, but in time", "note": "An event at 10:09 arrives late. It is newer than the watermark, so it still updates window 10:05-10:10.", "add": [[3, "10:09", "10:06", "accepted"]], "hl": [3]},
  {"label": "Too late", "note": "An event at 10:03 arrives after its window was finalized. It is older than the watermark and is ignored.", "add": [[3, "10:03", "10:06", "dropped"]], "del": [4]}
 ]}
```

- A longer delay accepts later data, but keeps **more state** and delays append-mode output.
- Changing the aggregation keys, the window, or the number of stateful operators requires a **new checkpoint**.

## 🔗 Streaming joins

| Join | How it works | Watch out |
|---|---|---|
| **Stream-static** | Each micro-batch joins with the **current** version of a Delta table | Dimension changes are **not** re-applied to past results. Use an MV when results must stay correct |
| **Stream-stream** | Both sides buffered in state until they can match | Needs **watermarks on both sides** plus a **time-range condition**, otherwise state grows forever |

## 🧽 Deduplication and foreachBatch

```python
deduped = (events
    .withWatermark("event_ts", "1 hour")
    .dropDuplicatesWithinWatermark(["event_id"]))   # bounded state
# dropDuplicates(["event_id"]) without a watermark keeps every key forever
```

**`foreachBatch`** runs batch code per micro-batch, for example a `MERGE` into Delta or writes to several sinks. It is at-least-once, so make it **idempotent** (MERGE is), and deduplicate inside the batch first.

## 🌊 Streaming in declarative pipelines

```sql
-- Bronze from Kafka: decode the value, keep metadata
CREATE OR REFRESH STREAMING TABLE events_bronze AS
SELECT CAST(value AS STRING) AS payload, timestamp AS kafka_ts, topic, partition, offset
FROM STREAM read_kafka(bootstrapServers => '${kafka_servers}', subscribe => 'events');

-- Silver: parse, validate, deduplicate
CREATE OR REFRESH STREAMING TABLE events_silver (
  CONSTRAINT valid_device EXPECT (device_id IS NOT NULL) ON VIOLATION DROP ROW
) AS SELECT payload:device_id::string AS device_id, payload:temp::double AS temp,
            payload:ts::timestamp AS event_ts
FROM STREAM(events_bronze);
```

Pipelines manage **checkpoints, retries and the schema location** for you.

## 🧰 Pipeline patterns

- **Append flows**: several sources (for example one Kafka topic per region) write into one streaming table, and backfills run as a separate `ONCE` flow.
- **Quarantine**: route rows that fail a rule into a separate table instead of dropping them silently.
- Use a **materialized view** for aggregates that must reflect late updates. A streaming table processes each row only once.
- A streaming read **fails** if its source table gets UPDATEs or DELETEs. Use `skipChangeCommits` or read the **change data feed**.

## 🔁 CDC with AUTO CDC in Python

```python
from pyspark import pipelines as dp
from pyspark.sql.functions import col, expr

dp.create_streaming_table("customers_silver")

dp.create_auto_cdc_flow(
    target="customers_silver",
    source="customers_cdc_clean",
    keys=["customer_id"],
    sequence_by=col("event_ts"),                 # out-of-order events resolved by this column
    apply_as_deletes=expr("op = 'DELETE'"),
    except_column_list=["op", "event_ts"],
    stored_as_scd_type=2,                        # 1 = overwrite, 2 = keep history
    track_history_column_list=["address", "segment"],
)
```

## 🕰️ Slowly changing dimensions

| | SCD Type 1 | SCD Type 2 |
|---|---|---|
| Keeps | Latest row per key | Every version, with `__START_AT` / `__END_AT` |
| Current rows | All | `WHERE __END_AT IS NULL` |
| Typical question | "What is the customer's address?" | "Which segment was the customer in **when** they ordered?" |

- **AUTO CDC FROM SNAPSHOT:** for sources that only deliver full snapshots.
- **Change data feed (CDF)** (`delta.enableChangeDataFeed = true`) exposes row-level inserts, updates and deletes of a Delta table, so downstream processing touches only what changed.

## 🧪 Try it: incremental, exactly-once, stateful

```dataset retail
```

Stream a copy of the **retail** orders with `availableNow` (the trigger serverless supports). Run the processing twice to see the checkpoint at work.

```python run
# A source table you own, and a clean checkpoint folder (safe to re-run)
import shutil
CHK = data.volume(CATALOG, SCHEMA) + "/stream_checkpoints"
shutil.rmtree(CHK, ignore_errors=True)
for t in ("stream_orders_silver", "stream_orders_weekly"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE OR REPLACE TABLE stream_orders_src AS SELECT * FROM fact_orders")
```

```python run
# Incremental bronze -> silver stream. The checkpoint remembers what was processed
from pyspark.sql import functions as F

def rows_in(q):
    return sum(p["numInputRows"] if isinstance(p, dict) else p.numInputRows for p in q.recentProgress)

def run_silver():
    q = (spark.readStream.table("stream_orders_src")
         .filter("status <> 'TEST'")
         .withColumn("processed_at", F.current_timestamp())
         .writeStream
         .option("checkpointLocation", f"{CHK}/orders_silver")
         .trigger(availableNow=True)
         .toTable("stream_orders_silver"))
    q.awaitTermination()
    return rows_in(q)

print("1st run, rows processed:", run_silver())
print("2nd run, rows processed:", run_silver(), "<- nothing new, nothing reprocessed")
```

```python run
# New data arrives: only the new rows are processed
spark.sql("""
INSERT INTO stream_orders_src
SELECT order_id + 1000000, current_date(), customer_id, product_id, quantity, discount, 'COMPLETED'
FROM stream_orders_src LIMIT 100
""")
print("3rd run, rows processed:", run_silver())
display(spark.sql("SELECT count(*) AS silver_rows FROM stream_orders_silver"))
```

```python run
# Stateful: weekly revenue per category (stream-static join + windowed aggregation)
weekly = (spark.readStream.table("stream_orders_src")
    .join(spark.read.table("dim_product"), "product_id")                  # stream-static join
    .withColumn("order_ts", F.col("order_date").cast("timestamp"))
    .groupBy(F.window("order_ts", "7 days"), "category")
    .agg(F.round(F.sum(F.col("quantity") * F.col("unit_price")), 2).alias("revenue"), F.count("*").alias("orders")))

q = (weekly.writeStream
     .outputMode("complete")                       # small aggregate: rewrite the full result each trigger
     .option("checkpointLocation", f"{CHK}/weekly")
     .trigger(availableNow=True)
     .toTable("stream_orders_weekly"))
q.awaitTermination()
display(spark.sql("SELECT window.start, category, revenue, orders FROM stream_orders_weekly ORDER BY window.start DESC, revenue DESC LIMIT 15"))

# Clean up when you are done
# for t in ("stream_orders_src", "stream_orders_silver", "stream_orders_weekly"): spark.sql(f"DROP TABLE IF EXISTS {t}")
```

> In production, a large aggregate would use **append** mode plus `withWatermark(...)`, so finished windows are written once and their state is dropped.

## ⚠️ Common mistakes

- ❌ An append-mode aggregation without a watermark. This is not allowed, and state is unbounded.
- ❌ Complete mode on a large keyspace. It keeps all state forever.
- ❌ Deleting or sharing a checkpoint to "fix" a stream. This causes duplicates or gaps.
- ❌ A stream-stream join without watermarks and a time condition.
- ❌ Streaming from a table that receives UPDATEs or DELETEs without CDF or `skipChangeCommits`.
- ❌ `trigger(once=True)` in new code. Use **`availableNow`**.

## 🧭 Cheat sheet

| Situation | Choose |
|---|---|
| Hourly SLA, files land continuously | `availableNow` trigger / **triggered** pipeline + schedule |
| Seconds of latency on Kafka events | Continuous micro-batches or **real-time mode** |
| Per-window aggregates written to Delta once | **Append** mode + **watermark** |
| Upsert each micro-batch into a table | **`foreachBatch` + `MERGE`** (idempotent) |
| Change feed with out-of-order updates and deletes, history of dimension changes | **AUTO CDC** + `SEQUENCE BY`, stored as **SCD Type 2** |
| Propagate updates and deletes from silver to gold | **Change data feed** |

**Next course:** *Databricks Data Privacy*, which protects the data these pipelines produce.
