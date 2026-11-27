---
title: "Streaming joins: stream-static and stream-stream"
summary: Enrich a stream with a Delta dimension table, and match two streams whose rows arrive at different times. Learn what each join keeps in state, how watermarks and a time bound clean that state up, and when outer joins write their unmatched rows.
icon: 🔗
level: Advanced
minutes: 12
group: Stream processing
tags: [Structured Streaming, Joins, Watermarks, State store, Delta Lake]
---
# Streaming joins: stream-static and stream-stream

> An order arrives at 10:00 and its payment at 10:04, in a different stream. To pair them, Spark must remember the order until the payment shows up. How long it remembers, and what it does with orders that never get paid, is the whole art of streaming joins.

**The one idea to remember:** a stream-static join keeps **no state**: each batch looks up the latest version of the table. A stream-stream join **buffers both sides in state**, and only watermarks plus a time bound in the join condition let Spark forget old rows.

## 🔗 Two kinds of streaming joins

This module builds on *Watermarks and stateful streaming*. A streaming DataFrame can be joined with a static DataFrame or with another stream.

```viz compare
{"items": [{"icon": "🧊", "title": "Stream-static", "sub": "readings ⋈ devices", "color": "blue",
            "points": ["The static side is read again for **every micro-batch**", "No join state, nothing to clean up", "✅ enrich events with reference data", "❌ rows already written are not updated"],
            "foot": "Stateless, like a filter"},
           {"icon": "🌊", "title": "Stream-stream", "sub": "orders ⋈ payments", "color": "purple",
            "points": ["A match can arrive in a **later** batch, on either side", "Both sides are buffered in the state store", "✅ correlate two event streams", "❌ state grows forever without watermarks and a time bound"],
            "foot": "Stateful, needs a checkpoint"}]}
```

## 🧊 Stream-static: the latest snapshot per batch

The static side can be a Delta table, a normal DataFrame, or a table written by a `complete`-mode stream. Each micro-batch joins its new rows to the **latest version** of that table. Follow device 7 as its model changes.

```viz table
{"title": "sj_enriched (the sink)", "columns": ["reading", "device", "model", "written in"],
 "rows": [[101, 7, "TX-100", "batch 0"], [102, 7, "TX-100", "batch 0"]],
 "steps": [
  {"label": "batch 0", "note": "Two readings of device 7 arrive. The devices table says `TX-100`, so both rows are written with it."},
  {"label": "UPDATE devices", "note": "Someone sets device 7 to `TX-900`. The stream is not involved: nothing in the sink changes."},
  {"label": "batch 1", "note": "A new reading of device 7 arrives. This batch reads the **new** version of devices, so it gets `TX-900`.", "add": [[103, 7, "TX-900", "batch 1"]], "hl": [2]},
  {"label": "Result", "note": "Old rows keep `TX-100`. A streaming join never goes back to rows it already wrote. To fix history, reprocess or run a `MERGE`.", "hl": [0, 1]}
 ]}
```

## 🧠 Stream-stream: both sides wait in state

Orders and payments with a 10-minute watermark on both, and the rule "payment within 15 minutes after the order". The query writes a row as soon as a pair matches.

```viz table
{"title": "Join state (both buffers)", "columns": ["buffered row", "event time", "status"],
 "rows": [["order 1", "10:00", "waiting"], ["order 2", "10:05", "waiting"], ["order 3", "10:10", "waiting"],
          ["payment 1", "10:04", "waiting"], ["payment 2", "10:25", "waiting"]],
 "steps": [
  {"label": "batch 0", "note": "Three orders and two payments arrive. Every row goes into state first."},
  {"label": "match", "note": "Payment 1 at 10:04 is within 10:00–10:15: one row is written. Payment 2 at 10:25 is **outside** 10:05–10:20, so order 2 has no match.", "upd": {"0": {"status": "✅ matched, written"}, "3": {"status": "✅ matched, written"}, "1": {"status": "no match yet"}, "4": {"status": "no match yet"}}, "hl": [0, 3]},
  {"label": "watermark", "note": "Max order time 10:10, max payment time 10:25. Watermarks: 10:00 and 10:15. The query uses the **minimum**, 10:00. Nothing is old enough to drop."},
  {"label": "batch 1", "note": "Payment 3 (10:20) arrives and finds order 3, which waited in state. Order 4 and payment 4 match within the batch.", "add": [["payment 3", "10:20", "✅ matched, written"], ["order 4", "10:40", "✅ matched, written"], ["payment 4", "10:41", "✅ matched, written"]], "upd": {"2": {"status": "✅ matched, written"}}, "hl": [2, 5, 6, 7]},
  {"label": "clean up", "note": "Now the watermark is min(10:30, 10:31) = 10:30. Payments before 10:30 would now be dropped as late, so orders before 10:15 can never match. They leave state, and so do old payments.", "hide": [0, 1, 2, 3, 4, 5], "hl": [6, 7]}
 ]}
```

In an **inner** join, order 2 is simply forgotten. In a **left outer** join, it is written with NULL payment columns at that moment.

## 💧 Bounding the state

```viz code
title: orders ⋈ payments with bounded state
lang: python
---
orders = (spark.readStream.table("sj_orders")
            .withWatermark("order_ts", "10 minutes").alias("o"))
payments = (spark.readStream.table("sj_payments")
              .withWatermark("payment_ts", "10 minutes").alias("p"))

joined = orders.join(payments, F.expr("""
    o.order_id = p.order_id AND
    p.payment_ts BETWEEN o.order_ts AND o.order_ts + INTERVAL 15 MINUTES
"""), "inner")
---
1-2 | watermark 1 | How late orders may arrive. Orders older than this are dropped as late.
3-4 | watermark 2 | The same for payments. Both sides need one, or one buffer is never cleaned.
6-7 | equality | The key alone matches, but it gives Spark no reason to forget anything.
8 | time bound | The business rule. With the watermarks it tells Spark when a buffered row can no longer match.
9 | join type | `inner` works without lines 1-4 and 8, but then state grows forever. Outer and semi joins **require** them.
```

Pick the bound from the business rule ("payments come within 15 minutes"), and the watermarks from how late rows really arrive.

## 📋 Which joins work

| Join type | Stream-static (stream on the left) | Stream-stream |
|---|---|---|
| Inner | ✅ no state | ✅ add watermarks and a time bound |
| Left outer | ✅ no state | ✅ watermarks and a time bound required |
| Right outer | ❌ (put the stream on the right) | ✅ watermarks and a time bound required |
| Full outer | ❌ | ✅ Spark 3.1 and later, with watermarks and a time bound |
| Left semi | ✅ | ✅ watermarks and a time bound required |

Cross joins between two streams are not supported. Older course material lists full outer as unsupported: that was true before Spark 3.1. A query with a stream-stream join supports only **append** output mode.

## ⚖️ One watermark for the whole query

```viz flow
{"title": "Two inputs, one global watermark",
 "nodes": [{"icon": "🧾", "title": "orders", "sub": "max 10:40 − 10 min", "color": "blue", "items": ["watermark 10:30"]},
           {"icon": "💳", "title": "payments", "sub": "max 10:41 − 10 min", "color": "teal", "items": ["watermark 10:31"]},
           {"icon": "💧", "title": "Global watermark", "sub": "min(10:30, 10:31)", "color": "purple", "items": ["10:30"]},
           {"icon": "🧠", "title": "Join state", "sub": "evict what can no longer match", "color": "amber"}],
 "edges": ["", "minimum", "after each batch"],
 "steps": [
  {"label": "Per input", "focus": [0, 1], "note": "Each input tracks its own watermark: its latest event time minus its delay."},
  {"label": "Minimum", "focus": [2], "note": "By default the query uses the **minimum**. A slow or idle stream holds the watermark back, so no row of the faster stream is dropped too early."},
  {"label": "Clean up", "focus": [3], "note": "State is evicted, and outer rows are written, only when this global watermark moves. A `max` policy exists as a Spark setting, but it drops more data from the slower stream."}
 ]}
```

## 🧪 Try it: enrich readings with devices and sites

```dataset iot
```

The static side is our own copy of `devices`, so we can change it. The stream reads a small copy of `readings`.

```python run
# Stream-static join: each reading gets its device model and site (clean start)
import json, shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/sj_demo"
shutil.rmtree(base, ignore_errors=True)
for t in ("sj_readings", "sj_devices", "sj_enriched"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE TABLE sj_readings AS SELECT * FROM readings WHERE reading_id <= 1000")
spark.sql("CREATE TABLE sj_devices AS SELECT * FROM devices")

def run_enrich():
    devices_sites = spark.table("sj_devices").join(spark.table("sites"), "site_id")   # static side
    q = (spark.readStream.table("sj_readings")                                        # streaming side
            .join(devices_sites, "device_id")
            .select("reading_id", "device_id", "model", "site_name", "country", "event_ts", "temperature")
         .writeStream
            .option("checkpointLocation", base + "/enrich_checkpoint")
            .trigger(availableNow=True)
            .toTable("sj_enriched"))
    q.awaitTermination()
    return q

run_enrich()
spark.sql("SELECT country, count(*) AS readings FROM sj_enriched GROUP BY country ORDER BY readings DESC").show()
```

```python run
# Change one device, add 5 new readings for it, run the same stream again
dev = spark.sql("SELECT device_id FROM sj_readings ORDER BY reading_id LIMIT 1").first()[0]
spark.sql(f"UPDATE sj_devices SET model = 'TX-900' WHERE device_id = {dev}")
spark.sql(f"""INSERT INTO sj_readings
              SELECT reading_id + 1000000, device_id, event_ts, ingest_ts, temperature, humidity, battery, status
              FROM readings WHERE device_id = {dev} AND reading_id > 1000 LIMIT 5""")
run_enrich()
spark.sql(f"""SELECT model, reading_id > 1000000 AS new_row, count(*) AS readings
              FROM sj_enriched WHERE device_id = {dev} GROUP BY ALL ORDER BY new_row""").show()
# Old rows keep the old model; only the 5 new rows have TX-900.
```

## 🧪 Try it: orders meet payments

The same rows as the state walkthrough above, in two tiny Delta tables.

```python run
# Stream-stream inner join with watermarks and a 15-minute bound (clean start)
for t in ("sj_orders", "sj_payments", "sj_paid_orders"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
shutil.rmtree(base + "/paid_checkpoint", ignore_errors=True)
spark.sql("CREATE TABLE sj_orders (order_id INT, amount DOUBLE, order_ts TIMESTAMP)")
spark.sql("CREATE TABLE sj_payments (order_id INT, method STRING, payment_ts TIMESTAMP)")
spark.sql("""INSERT INTO sj_orders VALUES (1, 40.0, '2026-11-02 10:00:00'),
             (2, 25.0, '2026-11-02 10:05:00'), (3, 60.0, '2026-11-02 10:10:00')""")
spark.sql("""INSERT INTO sj_payments VALUES (1, 'card', '2026-11-02 10:04:00'), (2, 'card', '2026-11-02 10:25:00')""")

def as_dict(p):                       # progress reports are dicts or objects, depending on the version
    return json.loads(p.json() if callable(p.json) else p.json) if hasattr(p, "json") else p

def run_join(how, table, chk):
    orders = spark.readStream.table("sj_orders").withWatermark("order_ts", "10 minutes").alias("o")
    payments = spark.readStream.table("sj_payments").withWatermark("payment_ts", "10 minutes").alias("p")
    joined = orders.join(payments, F.expr("""o.order_id = p.order_id AND
        p.payment_ts BETWEEN o.order_ts AND o.order_ts + INTERVAL 15 MINUTES"""), how)
    q = (joined.select("o.order_id", "o.amount", "o.order_ts", "p.method", "p.payment_ts")
         .writeStream.option("checkpointLocation", f"{base}/{chk}")
         .trigger(availableNow=True).toTable(table))
    q.awaitTermination()
    for p in map(as_dict, q.recentProgress):
        print("batch", p["batchId"], "| rows in:", p["numInputRows"], "| watermark:", p.get("eventTime", {}).get("watermark"),
              "| rows in join state:", [s.get("numRowsTotal") for s in p.get("stateOperators", [])])
    spark.table(table).orderBy("order_id").show()

run_join("inner", "sj_paid_orders", "paid_checkpoint")     # only order 1 matches
```

```python run
# Payment 3 arrives late, order 4 and payment 4 arrive together
spark.sql("INSERT INTO sj_payments VALUES (3, 'cash', '2026-11-02 10:20:00'), (4, 'card', '2026-11-02 10:41:00')")
spark.sql("INSERT INTO sj_orders VALUES (4, 15.0, '2026-11-02 10:40:00')")
run_join("inner", "sj_paid_orders", "paid_checkpoint")     # orders 1, 3 and 4; order 2 never
```

> Watch the state column: it grows while rows wait, and drops after the watermark reaches 10:30. When the watermark moved, Spark usually ends an `availableNow` run with an extra batch of 0 input rows, only to clean up state and write what became final.

## Exercise 1: inner, left, and the wrong side

Make `sj_ex_devices`: `devices` without device 7. Stream `readings` and join it to that table, once `inner` and once `left`. Predict the difference in row counts. Then try the static table on the **left** of a left outer join with the stream.

```python todo
# TODO 1: sj_ex_devices = devices WHERE device_id <> 7
# TODO 2: stream readings INNER JOIN sj_ex_devices into sj_ex_inner, and LEFT JOIN into sj_ex_left (availableNow)
# TODO 3: compare the counts with the number of readings of device 7
# TODO 4: spark.table("sj_ex_devices").join(<the stream>, "device_id", "left"): start it inside try/except
import shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/sj_ex1"
shutil.rmtree(base, ignore_errors=True)
```

```python solution
import shutil
from pyspark.sql import functions as F

base = data.volume(CATALOG, SCHEMA) + "/sj_ex1"
shutil.rmtree(base, ignore_errors=True)
spark.sql("CREATE OR REPLACE TABLE sj_ex_devices AS SELECT * FROM devices WHERE device_id <> 7")

def enrich(how, table):
    spark.sql(f"DROP TABLE IF EXISTS {table}")
    (spark.readStream.table("readings").join(spark.table("sj_ex_devices"), "device_id", how)
        .select("reading_id", "device_id", "model")
     .writeStream.option("checkpointLocation", f"{base}/{table}")
        .trigger(availableNow=True).toTable(table)
     .awaitTermination())
    return spark.table(table).count()

inner, left = enrich("inner", "sj_ex_inner"), enrich("left", "sj_ex_left")
dev7 = spark.table("readings").where("device_id = 7").count()
print("inner:", inner, " left:", left, " difference:", left - inner, " readings of device 7:", dev7)
# The difference equals the readings of device 7: the left join keeps them with model = NULL.

try:
    (spark.table("sj_ex_devices").join(spark.readStream.table("readings"), "device_id", "left")
       .writeStream.option("checkpointLocation", f"{base}/wrong_side")
       .trigger(availableNow=True).toTable("sj_ex_wrong").awaitTermination())
except Exception as e:
    print(type(e).__name__, str(e)[:300])
# Fails: a left outer join with a static left side would have to emit "no match" rows for the
# static table, but Spark can never know that no future streaming row will match them.
```

## Exercise 2: when does the unpaid order appear?

Build your own orders and payments with the rows from the walkthrough (orders 1, 2, 3 and payments for 1 at 10:04 and 2 at 10:25), and run a **left outer** stream-stream join. Predict: after the first run, does order 2 appear with NULL? Then add order 4 at 11:00 with a payment at 11:02, and run again.

```python todo
# TODO 1: create sj_ex_orders and sj_ex_payments and insert the walkthrough rows
# TODO 2: left outer join with 10-minute watermarks and the 15-minute bound into sj_ex_left_paid (availableNow)
# TODO 3: show the result; insert order 4 (11:00) and payment 4 (11:02); run again and show it
import json, shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/sj_ex2/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
```

```python solution
import json, shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/sj_ex2/checkpoint"
shutil.rmtree(chk, ignore_errors=True)
for t in ("sj_ex_orders", "sj_ex_payments", "sj_ex_left_paid"):
    spark.sql(f"DROP TABLE IF EXISTS {t}")
spark.sql("CREATE TABLE sj_ex_orders (order_id INT, amount DOUBLE, order_ts TIMESTAMP)")
spark.sql("CREATE TABLE sj_ex_payments (order_id INT, method STRING, payment_ts TIMESTAMP)")
spark.sql("""INSERT INTO sj_ex_orders VALUES (1, 40.0, '2026-11-02 10:00:00'),
             (2, 25.0, '2026-11-02 10:05:00'), (3, 60.0, '2026-11-02 10:10:00')""")
spark.sql("INSERT INTO sj_ex_payments VALUES (1, 'card', '2026-11-02 10:04:00'), (2, 'card', '2026-11-02 10:25:00')")

def run():
    o = spark.readStream.table("sj_ex_orders").withWatermark("order_ts", "10 minutes").alias("o")
    p = spark.readStream.table("sj_ex_payments").withWatermark("payment_ts", "10 minutes").alias("p")
    (o.join(p, F.expr("""o.order_id = p.order_id AND
             p.payment_ts BETWEEN o.order_ts AND o.order_ts + INTERVAL 15 MINUTES"""), "left")
      .select("o.order_id", "o.order_ts", "p.method", "p.payment_ts")
      .writeStream.option("checkpointLocation", chk)
      .trigger(availableNow=True).toTable("sj_ex_left_paid")
      .awaitTermination())
    spark.table("sj_ex_left_paid").orderBy("order_id").show()

run()   # only order 1: the watermark is 10:00, so orders 2 and 3 might still get a payment
spark.sql("INSERT INTO sj_ex_orders VALUES (4, 15.0, '2026-11-02 11:00:00')")
spark.sql("INSERT INTO sj_ex_payments VALUES (4, 'card', '2026-11-02 11:02:00')")
run()   # orders 1 and 4 matched, orders 2 and 3 with NULL payment columns
# The watermark moved to min(10:50, 10:52) = 10:50. A payment after 10:50 cannot match an order
# before 10:35, so orders 2 and 3 are written as unmatched. Order 2 had a payment, but at 10:25:
# outside its 15-minute bound, so it counts as unpaid.

# Clean up when you are done
# for t in ("sj_ex_orders", "sj_ex_payments", "sj_ex_left_paid", "sj_ex_devices", "sj_ex_inner",
#           "sj_ex_left", "sj_orders", "sj_payments", "sj_paid_orders", "sj_readings", "sj_devices", "sj_enriched"):
#     spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ Expecting a stream-static join to fix rows it already wrote when the dimension changes. Reprocess or `MERGE` them.
- ❌ An inner stream-stream join without watermarks and a time bound. It runs, but state grows until the query slows down or fails.
- ❌ A watermark on one side only. The other side's buffer is never cleaned up.
- ❌ Expecting outer NULL rows right away. They are written only when the watermark passes the time bound.
- ❌ `update` or `complete` output mode with a stream-stream join. Only `append` is supported.
- ✅ Take the time bound from the business rule, and the watermark delay from real lateness.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Enrich events with reference data | `stream.join(spark.table("devices"), "device_id")` |
| Keep events without a reference row | `stream.join(static_df, "key", "left")` (stream on the left) |
| Match two event streams | `withWatermark` on both + `BETWEEN` time bound in the condition |
| Emit unmatched rows of one stream | `"left"` join with watermarks and a bound; rows appear when the watermark passes |
| See the join state | `stateOperators` → `numRowsTotal` in `query.recentProgress` |
| Learn more about watermarks | *Watermarks and stateful streaming* |
