---
title: Data quality with expectations
summary: Put quality rules into the pipeline with expectations that warn, drop rows or fail the update, keep bad rows in a quarantine table, and back the rules up with Delta CHECK constraints that every writer must respect.
icon: 🚦
level: Beginner
minutes: 11
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Expectations, Data quality, Constraints]
---
# Data quality with expectations

> Sensors send NULLs, impossible values and duplicates. You can find them later in a dashboard, or you can make the pipeline check every row as it is written and record what it found.

**The one idea to remember:** an expectation is a rule plus an **action**: **warn** keeps the row and counts it, **drop** removes the row, **fail** stops the whole update. A Delta `CHECK` constraint has only one action: reject the entire write.

## 💡 Why rules belong in the pipeline

The `iot` readings contain three kinds of problems. Each needs a different answer.

| Problem in `readings` | About how many | Reasonable action |
|---|---|---|
| `temperature` is NULL | 390 rows | Drop or quarantine: nothing to measure |
| `temperature` is 999 or -999 | 545 rows | Drop or quarantine: a sensor error code |
| Same `device_id` and `event_ts` twice | 500 extra rows | Deduplicate: a row rule cannot see this |
| `status = 'ERROR'` | 490 rows | Keep, but watch the count |

A check in the pipeline runs on **every** update, before the data reaches silver and gold. A check in a dashboard runs only when someone looks.

## 📏 A table with three rules

Expectations are written as `CONSTRAINT ... EXPECT (...)` inside a pipeline table definition. This one uses all three actions.

```viz code
title: pipeline/readings_silver.sql
lang: sql
---
CREATE OR REFRESH STREAMING TABLE dq_readings_silver (
  CONSTRAINT has_device   EXPECT (device_id IS NOT NULL)
                          ON VIOLATION FAIL UPDATE,
  CONSTRAINT valid_temp   EXPECT (temperature IS NOT NULL
                                  AND temperature BETWEEN -50 AND 60)
                          ON VIOLATION DROP ROW,
  CONSTRAINT status_known EXPECT (status IN ('OK', 'WARN'))
)
AS SELECT * FROM STREAM(dq_readings_bronze);
---
2-3 | fail | A reading without a device is a broken contract. One such row **fails the update**: nothing is committed for this table, and someone has to look.
4-6 | drop | Bad temperatures are removed from the target. The pipeline continues and records how many rows were dropped.
5 | explicit NULL | `temperature IS NOT NULL` is spelled out, so the rule is never NULL itself. That keeps its inverse exact for a quarantine table.
7 | warn | No `ON VIOLATION` clause: the default. The row is **kept** and only counted.
9 | the query | Expectations sit on top of any dataset definition: streaming table, materialized view or temporary view.
```

## 🚦 Rows through the three actions

All rules are checked on every row in one pass. The boxes are drawn one after another only to show what each action does.

```viz flow
{"title": "One update of dq_readings_silver over the full readings data",
 "nodes": [{"icon": "🥉", "title": "Bronze", "sub": "50,500 rows read", "color": "bronze"},
           {"icon": "🛑", "title": "has_device", "sub": "FAIL UPDATE", "color": "red"},
           {"icon": "🗑️", "title": "valid_temp", "sub": "DROP ROW", "color": "amber"},
           {"icon": "⚠️", "title": "status_known", "sub": "warn", "color": "blue"},
           {"icon": "🥈", "title": "Silver", "sub": "49,562 rows written", "color": "silver"}],
 "edges": ["all rows", "0 failed", "938 dropped", "kept"],
 "steps": [
  {"label": "Read", "focus": [0], "note": "The update reads 50,500 bronze rows, duplicates included."},
  {"label": "FAIL rule", "focus": [1], "note": "Every row has a `device_id`, so 0 violations and the update continues. A single violation would stop it and roll back this table's write."},
  {"label": "DROP rule", "focus": [2], "note": "938 rows fail `valid_temp` (NULL or ±999). They are not written, and the count goes to the event log."},
  {"label": "Warn rule", "focus": [3], "note": "About 490 rows have `status = 'ERROR'`. They are written anyway; the metric shows the share."},
  {"label": "Write", "focus": [4], "note": "49,562 rows land in silver. The 500 duplicates are still there: an expectation looks at one row at a time."}
 ]}
```

## 🧮 Kept, dropped, or the update fails

Five example rows, and what the same table definition does with them.

```viz table
{"title": "dq_readings_silver: one update", "columns": ["reading_id", "device_id", "temperature", "status"],
 "rows": [[25, 64, 20.4, "OK"], [26, 152, null, "OK"], [265, 161, 999.0, "OK"], [301, 12, -17.9, "ERROR"], [302, 88, 22.1, "WARN"]],
 "steps": [
  {"label": "Input", "note": "Five bronze rows arrive in one micro-batch."},
  {"label": "Warn", "note": "Row 301 breaks `status_known`. It is **kept** and counted as a warning.", "hl": [3]},
  {"label": "Drop", "note": "Row 26 (NULL) and row 265 (999) break `valid_temp`. They are dropped and counted.", "del": [1, 2]},
  {"label": "Result", "note": "Three rows are written: 25, 301 and 302. The update succeeds.", "hl": [0, 3, 4]},
  {"label": "And if...", "note": "A row without `device_id` arrives. `has_device` fails the **update**: none of these rows is written, including the good ones.", "add": [[303, null, 21.0, "OK"]], "hl": [5]}
 ]}
```

## 🐍 Python decorators and the event log

The Python API has one decorator per action, and an `_all` variant that takes a dict of rules.

```python
from pyspark import pipelines as dp

temp_rules = {"valid_temp": "temperature IS NOT NULL AND temperature BETWEEN -50 AND 60",
              "valid_battery": "battery BETWEEN 0 AND 100"}

@dp.table
@dp.expect("status_known", "status IN ('OK', 'WARN')")       # warn
@dp.expect_all_or_drop(temp_rules)                           # drop if any rule fails
@dp.expect_or_fail("has_device", "device_id IS NOT NULL")    # fail the update
def dq_readings_silver():
    return spark.readStream.table("dq_readings_bronze")
```

The counts appear in the pipeline UI on each dataset, and in the **event log** as `flow_progress` events. Query them with `SELECT details:flow_progress.data_quality.expectations FROM event_log(TABLE(dq_readings_silver)) WHERE event_type = 'flow_progress'`.

## 🗃️ The quarantine pattern

`DROP ROW` throws the bad rows away. To keep processing **and** keep them for review, write the inverse rule into a second table.

```sql
CREATE OR REFRESH STREAMING TABLE dq_readings_clean (
  CONSTRAINT valid_temp EXPECT (temperature IS NOT NULL AND temperature BETWEEN -50 AND 60)
  ON VIOLATION DROP ROW
) AS SELECT * FROM STREAM(dq_readings_bronze);

CREATE OR REFRESH STREAMING TABLE dq_readings_quarantine AS
SELECT * FROM STREAM(dq_readings_bronze)
WHERE NOT (temperature IS NOT NULL AND temperature BETWEEN -50 AND 60);
```

Together the two tables hold every bronze row exactly once. That only holds if the rule can never be NULL: `NOT (NULL)` is NULL, and such a row would land in **neither** table.

## 🔒 Expectations and constraints

```viz compare
{"title": "Two tools, two jobs",
 "items": [
  {"icon": "🚦", "title": "Pipeline expectation", "sub": "CONSTRAINT ... EXPECT", "color": "blue",
   "points": ["Checked only by that pipeline's flow", "Row level: warn, drop or fail", "Metrics per rule in the event log", "❌ another job can still write bad rows"],
   "foot": "Monitoring and filtering inside a pipeline"},
  {"icon": "🔒", "title": "Delta constraint", "sub": "NOT NULL · CHECK", "color": "purple",
   "points": ["Checked on **every** write, by any writer", "Whole transaction fails, nothing is committed", "`ADD CONSTRAINT` first checks the existing rows", "❌ no metrics, no way to drop just the bad rows"],
   "foot": "Hard guarantees on a table"}
 ]}
```

Use both: expectations filter and measure on the way in, a constraint guarantees that no other writer breaks the table later. Primary and foreign keys in Unity Catalog are informational and are not enforced.

## 🧪 Try it: profile, split and enforce

```dataset iot
```

Pipeline expectations need a pipeline, so the code above is display-only. The same logic runs as plain SQL in a notebook.

```sql run
-- Profile the bad readings
SELECT count(*)                                     AS total_rows,
       count_if(temperature IS NULL)                AS null_temperature,
       count_if(temperature NOT BETWEEN -50 AND 60) AS out_of_range,
       count(*) - count(DISTINCT device_id, event_ts) AS duplicate_rows,
       count_if(status = 'ERROR')                   AS error_status
FROM readings;
```

```sql run
-- Which device and timestamp pairs arrive more than once?
SELECT device_id, event_ts, count(*) AS copies, collect_list(reading_id) AS reading_ids
FROM readings
GROUP BY device_id, event_ts
HAVING count(*) > 1
ORDER BY device_id
LIMIT 10;
```

```sql run
-- Split with a rule and its exact inverse (the quarantine pattern, in batch)
CREATE OR REPLACE TABLE dq_readings_clean AS
SELECT * FROM readings
WHERE temperature IS NOT NULL AND temperature BETWEEN -50 AND 60;

CREATE OR REPLACE TABLE dq_readings_quarantine AS
SELECT *, CASE WHEN temperature IS NULL THEN 'missing' ELSE 'out_of_range' END AS reason
FROM readings
WHERE NOT (temperature IS NOT NULL AND temperature BETWEEN -50 AND 60);

SELECT (SELECT count(*) FROM dq_readings_clean)      AS clean_rows,
       (SELECT count(*) FROM dq_readings_quarantine) AS quarantined_rows,
       (SELECT count(*) FROM readings)               AS source_rows;
```

```python run
# Add a CHECK constraint to the clean table, then try to break it
spark.sql("ALTER TABLE dq_readings_clean DROP CONSTRAINT IF EXISTS valid_temp")
spark.sql("ALTER TABLE dq_readings_clean ADD CONSTRAINT valid_temp CHECK (temperature BETWEEN -50 AND 60)")

before = spark.table("dq_readings_clean").count()
try:
    spark.sql("""
        INSERT INTO dq_readings_clean
        SELECT reading_id + 1000000, device_id, event_ts, ingest_ts, 999.0, humidity, battery, status
        FROM dq_readings_clean LIMIT 3
    """)
except Exception as e:
    print("INSERT rejected:", str(e)[:300])

print(before, "rows before,", spark.table("dq_readings_clean").count(), "rows after: nothing was committed")
```

## Exercise 1: find the lost rows

Split `readings` again, but with the **naive** rule `temperature BETWEEN -50 AND 60` and its inverse. Predict first: do the two tables add up to 50,500 rows?

```sql todo
-- TODO 1: create dq_naive_clean with WHERE temperature BETWEEN -50 AND 60
-- TODO 2: create dq_naive_quarantine with WHERE NOT (temperature BETWEEN -50 AND 60)
-- TODO 3: compare both counts with the count of readings
```

```sql solution
CREATE OR REPLACE TABLE dq_naive_clean AS
SELECT * FROM readings WHERE temperature BETWEEN -50 AND 60;

CREATE OR REPLACE TABLE dq_naive_quarantine AS
SELECT * FROM readings WHERE NOT (temperature BETWEEN -50 AND 60);

SELECT (SELECT count(*) FROM dq_naive_clean)      AS clean_rows,
       (SELECT count(*) FROM dq_naive_quarantine) AS quarantined_rows,
       (SELECT count(*) FROM readings)            AS source_rows;
-- About 390 rows are missing: the NULL temperatures. For them both rules are NULL, so neither WHERE keeps them.
```

## Exercise 2: deduplicate before the rules

Expectations cannot see duplicates. Keep one row per `device_id` and `event_ts` (the lowest `reading_id`) and check how many rows disappear.

```sql todo
-- TODO 1: create dq_readings_dedup from readings, one row per device_id + event_ts
--         hint: QUALIFY row_number() OVER (PARTITION BY ... ORDER BY reading_id) = 1
-- TODO 2: show the row count before and after
```

```sql solution
CREATE OR REPLACE TABLE dq_readings_dedup AS
SELECT * FROM readings
QUALIFY row_number() OVER (PARTITION BY device_id, event_ts ORDER BY reading_id) = 1;

SELECT (SELECT count(*) FROM readings)          AS before_rows,
       (SELECT count(*) FROM dq_readings_dedup) AS after_rows;   -- about 500 fewer
-- In a streaming table the same job is done by withWatermark(...) plus dropDuplicatesWithinWatermark(["device_id", "event_ts"]).

-- Clean up when you are done
-- DROP TABLE IF EXISTS dq_readings_clean;
-- DROP TABLE IF EXISTS dq_readings_quarantine;
-- DROP TABLE IF EXISTS dq_naive_clean;
-- DROP TABLE IF EXISTS dq_naive_quarantine;
-- DROP TABLE IF EXISTS dq_readings_dedup;
```

## ⚠️ Common mistakes

- ❌ "`EXPECT` without `ON VIOLATION` removes bad rows." The default only warns; the rows are written.
- ❌ `FAIL UPDATE` for a soft rule. One bad row then stops the whole pipeline.
- ❌ `DROP ROW` when the business must review bad rows. Use a quarantine table with the inverse rule.
- ❌ Rules that can evaluate to NULL. Spell out `IS NOT NULL` so a rule and its inverse cover every row.
- ❌ "A `CHECK` constraint drops the violating rows." It rejects the whole write.
- ✅ Deduplicate with a key and `row_number()` or `dropDuplicatesWithinWatermark`; expectations check one row at a time.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Count bad rows, keep them | `CONSTRAINT c EXPECT (rule)` / `@dp.expect` |
| Remove bad rows, keep going | `... ON VIOLATION DROP ROW` / `@dp.expect_or_drop` |
| Stop the update on a bad row | `... ON VIOLATION FAIL UPDATE` / `@dp.expect_or_fail` |
| Apply many rules at once | `@dp.expect_all`, `expect_all_or_drop`, `expect_all_or_fail` |
| Keep bad rows for review | Second table with `WHERE NOT (rule)` |
| Guarantee a rule for every writer | `ALTER TABLE t ADD CONSTRAINT c CHECK (...)` / `SET NOT NULL` |
