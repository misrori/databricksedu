---
title: "Windows on event time: tumbling, sliding, session"
summary: Work out which window, or windows, an event lands in for tumbling, sliding and session windows, read the window struct, control where windows start, use static and dynamic session gaps, and see why windows plus a watermark keep streaming state small.
icon: 🪟
level: Intermediate
minutes: 11
group: Stream processing
tags: [Structured Streaming, Windows, Event time, Session windows, State]
---
# Windows on event time: tumbling, sliding, session

> "How many readings per 10 minutes?" sounds simple until rows arrive late and out of order. A **window** groups rows by the time the event **happened**, so every row is counted where it belongs, whenever it arrives.

**The one idea to remember:** a tumbling window puts each event in **exactly one** window, a sliding window in **size ÷ slide** windows, and a session window in **one session per key** that grows until a gap with no events closes it.

## 🕰️ Event time, not arrival time

**Event time** is a column in the data (`event_ts`): when the sensor measured. **Processing time** is when Spark sees the row. Four readings, one of them delayed by the network:

```viz table
{"title": "Group by arrival or by event time?", "columns": ["reading", "event time", "arrived", "10-minute window"],
 "rows": [["r1", "10:02", "10:02", "…"], ["r2", "10:08", "10:09", "…"], ["r3", "10:09", "10:14", "…"], ["r4", "10:13", "10:13", "…"]],
 "steps": [
  {"label": "Four readings", "note": "r3 was measured at 10:09 but reached Spark 5 minutes later."},
  {"label": "By arrival time", "note": "r3 lands in 10:10–10:20, a window where it did not happen. Replay the same data tomorrow and it may land somewhere else again.", "upd": {"0": {"10-minute window": "10:00–10:10"}, "1": {"10-minute window": "10:00–10:10"}, "2": {"10-minute window": "10:10–10:20 ❌"}, "3": {"10-minute window": "10:10–10:20"}}, "hl": [2]},
  {"label": "By event time", "note": "`window(\"event_ts\", \"10 minutes\")` uses the event time. r3 is counted in 10:00–10:10, however late it arrives. Results are the same every time you reprocess.", "upd": {"2": {"10-minute window": "10:00–10:10 ✅"}}, "hl": [2]}
 ]}
```

## 🎯 Which window does an event land in?

Five events of one sensor. Step through the three window types.

```viz table
{"title": "Window membership of each event", "columns": ["event time", "tumbling 10 min", "sliding 10 min, every 5 min", "session, gap 5 min"],
 "rows": [["10:02", "…", "…", "…"], ["10:04", "…", "…", "…"], ["10:07", "…", "…", "…"], ["10:15", "…", "…", "…"], ["10:21", "…", "…", "…"]],
 "steps": [
  {"label": "Five events", "note": "Window start is inclusive and the end is exclusive: `start <= event_ts < end`."},
  {"label": "Tumbling", "note": "Fixed, non-overlapping windows: each event is in **exactly one**. Counts: 10:00 → 3, 10:10 → 1, 10:20 → 1.", "upd": {"0": {"tumbling 10 min": "10:00–10:10"}, "1": {"tumbling 10 min": "10:00–10:10"}, "2": {"tumbling 10 min": "10:00–10:10"}, "3": {"tumbling 10 min": "10:10–10:20"}, "4": {"tumbling 10 min": "10:20–10:30"}}},
  {"label": "Sliding", "note": "A new 10-minute window starts every 5 minutes, so each event is in 10 ÷ 5 = **2** windows. 10:15 is in 10:15–10:25 but **not** in 10:05–10:15, because the end is exclusive.", "upd": {"0": {"sliding 10 min, every 5 min": "09:55–10:05 · 10:00–10:10"}, "1": {"sliding 10 min, every 5 min": "09:55–10:05 · 10:00–10:10"}, "2": {"sliding 10 min, every 5 min": "10:00–10:10 · 10:05–10:15"}, "3": {"sliding 10 min, every 5 min": "10:10–10:20 · 10:15–10:25"}, "4": {"sliding 10 min, every 5 min": "10:15–10:25 · 10:20–10:30"}}, "hl": [3]},
  {"label": "Session", "note": "A session ends 5 minutes after its last event. 10:02, 10:04 and 10:07 are each within 5 minutes of the previous one: one session, 10:02–10:12. 10:15 starts a new one, and 10:21 is 6 minutes after 10:15, so it starts a third.", "upd": {"0": {"session, gap 5 min": "S1 · 10:02–10:12"}, "1": {"session, gap 5 min": "S1 · 10:02–10:12"}, "2": {"session, gap 5 min": "S1 · 10:02–10:12"}, "3": {"session, gap 5 min": "S2 · 10:15–10:20"}, "4": {"session, gap 5 min": "S3 · 10:21–10:26"}}}
 ]}
```

Sliding windows multiply the rows: with a 1-hour window sliding every minute, each event is counted 60 times.

## 🧩 The window column is a struct

```viz code
title: A windowed count and its result (display only)
lang: python
---
counts = (events
    .groupBy(F.window("event_ts", "10 minutes"), "sensor")
    .count())

# counts has these columns:
#   window  struct<start: timestamp, end: timestamp>
#   sensor  string
#   count   bigint

flat = counts.select(F.col("window.start").alias("window_start"),
                     F.col("window.end").alias("window_end"),
                     "sensor", "count")
---
2 | window() | Inside `groupBy`, next to other keys. Add a third argument for sliding windows: `F.window("event_ts", "10 minutes", "5 minutes")`.
5-8 | struct | One column named `window` with a `start` and an `end` field.
10-12 | flatten | Pull the fields out before you write to a table or a dashboard. SQL works the same: `GROUP BY window(event_ts, '10 minutes')`, then `window.start`.
```

## 📐 Where windows start

Windows are aligned to the Unix epoch (1970-01-01 00:00 **UTC**), not to the first event. An event at 10:07:

| Call | Windows that contain 10:07 |
|---|---|
| `window(ts, "10 minutes")` | 10:00–10:10 |
| `window(ts, "10 minutes", "5 minutes")` | 10:00–10:10, 10:05–10:15 |
| `window(ts, "1 hour", "1 hour", "15 minutes")` | 09:15–10:15 (the 4th argument, `startTime`, shifts every window) |
| `window(ts, "1 day")` | One **UTC** day, shown in your session time zone |

Because of the UTC alignment, a daily window in a session set to UTC+1 shows as 01:00 to 01:00. For local calendar days, group by a local date column instead.

## 💬 Session windows grow and merge

One sensor, gap 5 minutes. Rows arrive in the order shown, so 10:08 comes **late**.

```viz table
{"title": "Sessions in state for one sensor", "columns": ["session", "start → end", "events", "status"],
 "rows": [["S1", "10:02 → 10:07", "10:02", "open"]],
 "steps": [
  {"label": "10:02 arrives", "note": "A session starts at the event and ends **gap** later: 10:07."},
  {"label": "10:04 arrives", "note": "Before 10:07, so it joins S1. The end moves to the last event plus the gap: 10:09.", "upd": {"0": {"start → end": "10:02 → 10:09", "events": "10:02, 10:04"}}, "hl": [0]},
  {"label": "10:12 arrives", "note": "After 10:09: S1 is not extended. A new session S2 starts.", "add": [["S2", "10:12 → 10:17", "10:12", "open"]], "hl": [1]},
  {"label": "10:16 arrives", "note": "S2 grows to 10:21.", "upd": {"1": {"start → end": "10:12 → 10:21", "events": "10:12, 10:16"}}, "hl": [1]},
  {"label": "10:08 arrives late", "note": "Its own range, 10:08 → 10:13, overlaps **both** sessions. Spark merges them into one session, 10:02 → 10:21, with five events.", "upd": {"0": {"start → end": "10:02 → 10:21", "events": "10:02, 10:04, 10:08, 10:12, 10:16"}}, "del": [1], "hl": [0]},
  {"label": "Watermark passes 10:21", "note": "Only now can no event extend the session. In append mode it is written once and removed from state.", "upd": {"0": {"status": "final, written"}}}
 ]}
```

A session window has no fixed size, so it cannot be final until the watermark passes its **end**, and a late row can still change it until then.

## ⏳ Static or dynamic gap

```python
# Static gap: 5 minutes for every key
events.groupBy(F.session_window("event_ts", "5 minutes"), "sensor").count()

# Dynamic gap: an expression evaluated per row
gap = F.when(F.col("sensor_type") == "thermostat", "30 minutes").otherwise("5 minutes")
events.groupBy(F.session_window("event_ts", gap), "sensor").count()
```

```sql
-- The same in SQL
SELECT sensor, session_window.start, session_window.end, count(*) AS events
FROM win_events
GROUP BY sensor, session_window(event_ts, CASE WHEN sensor = 'A' THEN '10 minutes' ELSE '2 minutes' END);
```

In a **stream**, session windows need at least one more grouping key next to the session (here `sensor`), and they support append mode but **not** update mode.

## 📈 Windows keep state small

```viz compare
{"items": [{"icon": "♾️", "title": "groupBy(\"sensor\")", "sub": "no window", "color": "red",
            "points": ["One running row per sensor", "Never final: append mode is impossible", "State keeps every sensor ever seen"]},
           {"icon": "🪟", "title": "window, no watermark", "sub": "groupBy(window, sensor)", "color": "amber",
            "points": ["A new row per window and sensor", "Old windows are never removed", "❌ state grows every 10 minutes, forever"]},
           {"icon": "💧", "title": "window + watermark", "sub": "withWatermark(\"event_ts\", \"10 minutes\")", "color": "green",
            "points": ["Windows behind the watermark become final", "✅ written once, then removed from state", "State holds only the recent windows"]}]}
```

A window alone does not bound state: it gives Spark a time range it **could** close. The watermark tells Spark **when** to close it. How the watermark is computed and what happens to late rows is the topic of *Watermarks and stateful streaming*.

## 🧪 Try it: windows on six events

```dataset iot
```

First check window membership on a small table you can reason about, then run session windows as a stream over `readings`.

```sql run
-- Six events from two sensors
CREATE OR REPLACE TABLE win_events AS
SELECT * FROM VALUES
  ('A', TIMESTAMP'2026-01-15 10:02:00'), ('A', TIMESTAMP'2026-01-15 10:04:00'),
  ('A', TIMESTAMP'2026-01-15 10:07:00'), ('A', TIMESTAMP'2026-01-15 10:15:00'),
  ('A', TIMESTAMP'2026-01-15 10:21:00'), ('B', TIMESTAMP'2026-01-15 10:09:00')
AS t(sensor, event_ts);

-- Tumbling and session windows per sensor
SELECT sensor, 'tumbling' AS kind, date_format(window.start, 'HH:mm') AS starts,
       date_format(window.end, 'HH:mm') AS ends, count(*) AS events
FROM win_events GROUP BY sensor, window(event_ts, '10 minutes')
UNION ALL
SELECT sensor, 'session', date_format(session_window.start, 'HH:mm'),
       date_format(session_window.end, 'HH:mm'), count(*)
FROM win_events GROUP BY sensor, session_window(event_ts, '5 minutes')
ORDER BY sensor, kind, starts;
```

```sql run
-- Sliding windows: one output row per (event, window)
SELECT sensor, date_format(event_ts, 'HH:mm') AS event_time,
       date_format(w.start, 'HH:mm') AS window_start, date_format(w.end, 'HH:mm') AS window_end
FROM (SELECT *, window(event_ts, '10 minutes', '5 minutes') AS w FROM win_events)
ORDER BY sensor, event_ts, window_start;
```

```python run
# Device sessions on a stream: a session ends after 4 hours without a reading (clean start)
import shutil
from pyspark.sql import functions as F

chk = data.volume(CATALOG, SCHEMA) + "/win/sessions_checkpoint"
shutil.rmtree(chk, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS win_device_sessions")

(spark.readStream.table("readings")
    .withWatermark("event_ts", "1 hour")
    .groupBy(F.session_window("event_ts", "4 hours"), "device_id")
    .agg(F.count("*").alias("readings"))
    .select("device_id", F.col("session_window.start").alias("session_start"),
            F.col("session_window.end").alias("session_end"), "readings")
 .writeStream
    .outputMode("append")
    .option("checkpointLocation", chk)
    .trigger(availableNow=True)
    .toTable("win_device_sessions")
    .awaitTermination())

spark.sql("""SELECT count(*) AS sessions, count(DISTINCT device_id) AS devices,
                    round(avg(readings), 1) AS avg_readings, max(session_end) AS last_session_end
             FROM win_device_sessions""").show()
```

> The first query should show sensor A in three tumbling windows (3, 1, 1 events) and three sessions (10:02–10:12, 10:15–10:20, 10:21–10:26), and sensor B in one of each. The sliding query returns 12 rows: 6 events × 2 windows. In the stream, the **last** session of every device is missing: it ends after the final watermark, so it is still open in state.

## Exercise 1: predict the sliding windows

Use 15-minute windows that slide every 5 minutes over `win_events`. Predict before you run: how many rows does the membership query return, and which windows hold the most events of sensor A?

```sql todo
-- The exercise notebook does not have win_events yet: create it first
CREATE OR REPLACE TABLE win_events AS
SELECT * FROM VALUES
  ('A', TIMESTAMP'2026-01-15 10:02:00'), ('A', TIMESTAMP'2026-01-15 10:04:00'),
  ('A', TIMESTAMP'2026-01-15 10:07:00'), ('A', TIMESTAMP'2026-01-15 10:15:00'),
  ('A', TIMESTAMP'2026-01-15 10:21:00'), ('B', TIMESTAMP'2026-01-15 10:09:00')
AS t(sensor, event_ts);

-- TODO 1: one row per (event, window) for window(event_ts, '15 minutes', '5 minutes')
-- TODO 2: count events per sensor and window, busiest first
```

```sql solution
CREATE OR REPLACE TABLE win_events AS
SELECT * FROM VALUES
  ('A', TIMESTAMP'2026-01-15 10:02:00'), ('A', TIMESTAMP'2026-01-15 10:04:00'),
  ('A', TIMESTAMP'2026-01-15 10:07:00'), ('A', TIMESTAMP'2026-01-15 10:15:00'),
  ('A', TIMESTAMP'2026-01-15 10:21:00'), ('B', TIMESTAMP'2026-01-15 10:09:00')
AS t(sensor, event_ts);

SELECT sensor, event_ts, w.start, w.end
FROM (SELECT *, window(event_ts, '15 minutes', '5 minutes') AS w FROM win_events)
ORDER BY sensor, event_ts, w.start;
-- 18 rows: 15 / 5 = 3 windows per event, 6 events.

SELECT sensor, date_format(window.start, 'HH:mm') AS starts, date_format(window.end, 'HH:mm') AS ends,
       count(*) AS events
FROM win_events GROUP BY sensor, window(event_ts, '15 minutes', '5 minutes')
ORDER BY events DESC, sensor, starts;
-- Sensor A: two windows tie with 3 events (10:02, 10:04, 10:07): 09:55-10:10 and 10:00-10:15.
-- Overlapping windows often share the same events.
```

## Exercise 2: a dynamic session gap

Give sensor A a 10-minute gap and every other sensor a 2-minute gap. Predict the sessions first. Then predict what changes for sensor A if its gap is 5 minutes.

```sql todo
-- Run Exercise 1 first, so win_events exists
-- TODO: sessions per sensor with session_window(event_ts, CASE ... END), with start, end and event count
```

```sql solution
SELECT sensor, date_format(session_window.start, 'HH:mm') AS starts,
       date_format(session_window.end, 'HH:mm') AS ends, count(*) AS events
FROM win_events
GROUP BY sensor, session_window(event_ts, CASE WHEN sensor = 'A' THEN '10 minutes' ELSE '2 minutes' END)
ORDER BY sensor, starts;
-- A: one session 10:02-10:31 with 5 events. The largest gap is 8 minutes (10:07 to 10:15), less than 10.
-- B: one session 10:09-10:11 with 1 event.
-- With a 5-minute gap, A splits into three sessions: 10:02-10:12, 10:15-10:20 and 10:21-10:26.

-- Clean up when you are done
-- DROP TABLE IF EXISTS win_events;
-- DROP TABLE IF EXISTS win_device_sessions;
```

## ⚠️ Common mistakes

- ❌ Windowing on an ingest or `current_timestamp()` column. Late rows then count in the wrong window, and reruns give other numbers.
- ❌ Summing sliding-window counts to get a total. Each event is counted size ÷ slide times.
- ❌ Expecting daily windows to follow your local midnight. They are aligned to UTC.
- ❌ "A window bounds state." Without a watermark, old windows stay in state forever.
- ❌ Session windows in update mode on a stream. Use append.
- ✅ Flatten `window.start` and `window.end` into plain columns before you write the result.

## 🧭 Cheat sheet

| I want… | Use |
|---|---|
| Fixed, non-overlapping windows | `F.window("event_ts", "10 minutes")` |
| Overlapping windows | `F.window("event_ts", "10 minutes", "5 minutes")` |
| Windows at :15 past the hour | `F.window("event_ts", "1 hour", "1 hour", "15 minutes")` |
| Activity sessions | `F.session_window("event_ts", "5 minutes")` |
| A different gap per row | `F.session_window("event_ts", F.when(...).otherwise(...))` |
| Bounded state | `withWatermark` on the same event-time column |
