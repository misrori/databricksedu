---
title: CDC and slowly changing dimensions
summary: Turn a change feed of inserts, updates and deletes into a current-state table (SCD Type 1) or a full history (SCD Type 2). See why events that arrive out of order break a naive upsert, and how AUTO CDC and a careful MERGE handle them.
icon: 🔁
level: Intermediate
minutes: 12
group: Ingestion and pipelines
tags: [CDC, AUTO CDC, SCD, MERGE, Declarative Pipelines]
---
# CDC and slowly changing dimensions

> A source database does not send you its tables again every hour. It sends **changes**: this customer was inserted, that one moved city, this one was deleted. Your job is to turn that feed into a table that is right.

**The one idea to remember:** the order in which events **arrive** is not the order in which they **happened**. Always apply changes by a **sequence column**, never by arrival.

## 💡 What a change feed looks like

Every event carries an **operation**, the **key** of the row, the new values, and a **sequence** that gives the true order in the source. These are the three events of customer 126 in the `cdc` dataset.

| arrival_order | sequence_num | operation | city |
|---|---|---|---|
| 76 | 76 | UPDATE | Vienna |
| 77 | **75** | UPDATE | Berlin |
| 184 | 184 | UPDATE | Vienna |

The event with sequence 75 happened **before** sequence 76 but arrived **after** it. Networks, retries and parallel extract jobs do this all the time. Each event carries the full row after the change, not only the changed column.

## ⏱️ Why arrival order breaks a naive upsert

Step through customer 126 as a naive "upsert each event as it arrives" sees it.

```viz timeline
{"title": "Customer 126: arrival order versus sequence order",
 "items": [
  {"label": "arrival 76", "title": "seq 76: city = Vienna", "color": "blue", "note": "The newest change arrives first. The upsert writes Vienna. So far so good."},
  {"label": "arrival 77", "title": "seq 75: city = Berlin", "color": "red", "note": "An **older** change arrives late. The naive upsert overwrites Vienna with Berlin. The table is now wrong."},
  {"label": "sequenced", "title": "compare 75 with 76", "color": "green", "note": "A sequence-aware apply keeps the highest `sequence_num` per key. 75 is lower than 76, so in SCD Type 1 the event is ignored."},
  {"label": "arrival 184", "title": "seq 184: tier = Gold", "color": "gray", "note": "A later change overwrites the row again and both methods agree. This is why the bug is so hard to spot: it is wrong only for a while."}
 ]}
```

## 🔁 SCD Type 1: keep only the current state

Type 1 overwrites. One row per key, no history. Watch the `seq` column: it is how the target knows which change it has already applied.

```viz table
{"title": "customers (SCD Type 1)", "columns": ["customer_id", "city", "tier", "seq"],
 "rows": [[1, "Paris", "Bronze", 0], [2, "Rome", "Silver", 0]],
 "steps": [
  {"label": "Start", "note": "The target holds the initial snapshot."},
  {"label": "seq 10 UPDATE 1", "note": "Customer 1 moves to Vienna. The row is overwritten in place.", "upd": {"0": {"city": "Vienna", "seq": 10}}, "hl": [0]},
  {"label": "seq 11 INSERT 3", "note": "A new key: a new row.", "add": [[3, "Oslo", "Gold", 11]], "hl": [2]},
  {"label": "seq 13 UPDATE 1", "note": "Arrives before seq 12. It carries the full row: Milan and Gold.", "upd": {"0": {"city": "Milan", "tier": "Gold", "seq": 13}}, "hl": [0]},
  {"label": "seq 12 arrives late", "note": "It says Milan and Bronze. 12 is lower than 13, so it is **ignored**. Applying it would undo the Gold upgrade.", "hl": [0]},
  {"label": "seq 14 DELETE 2", "note": "The row is removed. In Type 1 nothing remembers that customer 2 ever existed.", "del": [1]}
 ]}
```

## 📚 SCD Type 2: keep every version

Type 2 never overwrites. Each change **closes** the current row by setting `__END_AT` and **opens** a new one. The current version is the row where `__END_AT IS NULL`.

```viz table
{"title": "customers_history (SCD Type 2, sequenced by seq)", "columns": ["customer_id", "city", "__START_AT", "__END_AT"],
 "rows": [[1, "Paris", 1, null]],
 "steps": [
  {"label": "seq 1 INSERT", "note": "The first version opens at sequence 1. It is current."},
  {"label": "seq 5 UPDATE: Vienna", "note": "The Paris row is closed at 5 and a Vienna row opens at 5.", "upd": {"0": {"__END_AT": 5}}, "add": [[1, "Vienna", 5, null]], "hl": [0, 1]},
  {"label": "seq 9 UPDATE: Milan", "note": "Vienna is closed at 9, Milan opens.", "upd": {"1": {"__END_AT": 9}}, "add": [[1, "Milan", 9, null]], "hl": [1, 2]},
  {"label": "seq 7 arrives late: Rome", "note": "Not ignored this time: it belongs **between** Vienna and Milan. Vienna now ends at 7 and Rome covers 7 to 9.", "upd": {"1": {"__END_AT": 7}}, "add": [[1, "Rome", 7, 9]], "hl": [1, 3]},
  {"label": "seq 12 DELETE", "note": "The current Milan row is closed at 12. The history stays; there is just no current row any more.", "upd": {"2": {"__END_AT": 12}}, "hl": [2]}
 ]}
```

Type 1 answers "where does the customer live now?". Type 2 also answers "where did they live when they placed this order?"

## ✨ AUTO CDC in a pipeline

In Lakeflow Spark Declarative Pipelines one statement does all of the above. `AUTO CDC INTO` was formerly called `APPLY CHANGES INTO`; the old name still works.

```viz code
title: pipeline/customers_cdc.sql
lang: sql
---
CREATE OR REFRESH STREAMING TABLE cdc_customers_silver;

CREATE FLOW cdc_customers_flow AS
AUTO CDC INTO cdc_customers_silver
FROM STREAM(cdc_customers_bronze)
KEYS (customer_id)
APPLY AS DELETE WHEN operation = 'DELETE'
SEQUENCE BY sequence_num
COLUMNS * EXCEPT (operation, sequence_num, arrival_order)
STORED AS SCD TYPE 2;
---
1 | target | An empty streaming table. Its rows are maintained by the flow below, not by a query.
3-4 | source | The change feed, read incrementally. Clean and filter it in a view before this point.
5 | KEYS | Which column identifies a row. Events with the same key change the same row.
6 | deletes | Which events are deletes. In Type 1 the row is removed, in Type 2 its current version is closed.
7 | SEQUENCE BY | The true order. Must be sortable and never NULL. `__START_AT` and `__END_AT` get its values.
8 | columns | Drop the feed's bookkeeping columns from the target.
9 | SCD type | `1` (the default) overwrites, `2` keeps history.
```

## 🐍 Python, and sources without a feed

The Python API takes the same parameters. Older code calls `dlt.apply_changes()`.

```python
from pyspark import pipelines as dp
from pyspark.sql.functions import col, expr

dp.create_streaming_table("cdc_customers_silver")

dp.create_auto_cdc_flow(
    target="cdc_customers_silver",
    source="cdc_customers_bronze",
    keys=["customer_id"],
    sequence_by=col("sequence_num"),
    apply_as_deletes=expr("operation = 'DELETE'"),
    except_column_list=["operation", "sequence_num", "arrival_order"],
    stored_as_scd_type=2,
    track_history_column_list=["city", "tier"],   # only these columns open a new version
)
```

Some sources only deliver a **full snapshot** every day, with no change feed. For those, `dp.create_auto_cdc_from_snapshot_flow(target=..., source=..., keys=[...], stored_as_scd_type=2)` compares consecutive snapshots and works out the inserts, updates and deletes itself (AUTO CDC FROM SNAPSHOT).

## 🛠️ Doing it by hand with MERGE

Outside a pipeline you write the same logic with `MERGE INTO`. It works, but every problem AUTO CDC solves is now yours.

| Problem | AUTO CDC | MERGE by hand |
|---|---|---|
| Several events for one key in a batch | Handled | Keep only the latest per key first, or MERGE fails |
| An older event arrives late | `SEQUENCE BY` ignores or places it | Store the sequence in the target and compare it in the condition |
| Deletes | `APPLY AS DELETE WHEN` | `WHEN MATCHED AND op = 'DELETE' THEN DELETE` |
| History rows | `STORED AS SCD TYPE 2` | Close the old row and insert the new one yourself |

## 🧪 Try it: from change feed to SCD tables

```dataset cdc
```

AUTO CDC needs a pipeline, so that code is display-only. The same results can be built with plain SQL here.

```sql run
-- The operations mix, and how many events arrive out of position
SELECT operation,
       count(*) AS events,
       count_if(arrival_order <> sequence_num) AS out_of_position
FROM customers_changes
GROUP BY operation;
```

```sql run
-- The dangerous case: an event arrives after a newer event for the same key
SELECT * FROM (
  SELECT customer_id, arrival_order, sequence_num, operation, city, tier,
         max(sequence_num) OVER (PARTITION BY customer_id ORDER BY arrival_order
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS newest_seq_seen
  FROM customers_changes
)
WHERE sequence_num < newest_seq_seen;
```

```sql run
-- SCD Type 1 with MERGE: start from the snapshot, apply the latest event per key
CREATE OR REPLACE TABLE cdc_customers_scd1 AS
SELECT customer_id, customer_name, email, city, tier, updated_at FROM customers_snapshot;

MERGE INTO cdc_customers_scd1 AS t
USING (
  SELECT * FROM customers_changes
  QUALIFY row_number() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) = 1
) AS s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.operation = 'DELETE' THEN DELETE
WHEN MATCHED THEN UPDATE SET
  customer_name = s.customer_name, email = s.email, city = s.city, tier = s.tier, updated_at = s.changed_at
WHEN NOT MATCHED AND s.operation <> 'DELETE' THEN
  INSERT (customer_id, customer_name, email, city, tier, updated_at)
  VALUES (s.customer_id, s.customer_name, s.email, s.city, s.tier, s.changed_at);

SELECT count(*) AS current_customers FROM cdc_customers_scd1;
```

```sql run
-- SCD Type 2 with a window: each version ends when the next event for the key happens
CREATE OR REPLACE TABLE cdc_customers_scd2 AS
WITH events AS (
  SELECT customer_id, customer_name, email, city, tier, 'SNAPSHOT' AS operation,
         CAST(0 AS BIGINT) AS sequence_num, updated_at AS changed_at
  FROM customers_snapshot
  UNION ALL
  SELECT customer_id, customer_name, email, city, tier, operation, sequence_num, changed_at
  FROM customers_changes
)
SELECT customer_id, customer_name, email, city, tier,
       changed_at AS __START_AT,
       LEAD(changed_at) OVER (PARTITION BY customer_id ORDER BY sequence_num) AS __END_AT,
       operation
FROM events;

DELETE FROM cdc_customers_scd2 WHERE operation = 'DELETE';   -- a delete only closes the previous version

SELECT count(*) AS versions, count_if(__END_AT IS NULL) AS current_rows FROM cdc_customers_scd2;
```

> The current rows of the Type 2 table match the Type 1 table: same keys, same values. Here `__START_AT` and `__END_AT` are timestamps because we used `changed_at`; AUTO CDC fills them with the `SEQUENCE BY` values.

## Exercise 1: replay the late event

Follow customer 126 (the out-of-order case found above). Show its events in arrival order. Then compute the city a naive upsert holds right after `arrival_order` 77, and the city a sequenced apply holds at the same moment.

```sql todo
-- TODO 1: all events of customer 126, ordered by arrival_order
-- TODO 2: among events with arrival_order <= 77: the city of the last ARRIVED event
--         and the city of the highest sequence_num (hint: max_by(city, ...))
```

```sql solution
SELECT arrival_order, sequence_num, operation, city, tier, changed_at
FROM customers_changes
WHERE customer_id = 126
ORDER BY arrival_order;

SELECT max_by(city, arrival_order) AS naive_city,       -- Berlin: the older change arrived last
       max_by(city, sequence_num)  AS sequenced_city    -- Vienna: the newest change wins
FROM customers_changes
WHERE customer_id = 126 AND arrival_order <= 77;
```

## Exercise 2: where did everyone live on 15 October?

This is the question SCD Type 2 exists for. Answer it from the snapshot and the feed: for each customer take the latest event (by `sequence_num`) that happened on or before `2026-10-15 00:00:00`, skip customers whose latest event is a delete, and count customers per city.

```sql todo
-- TODO 1: union customers_snapshot (as sequence 0) with customers_changes
-- TODO 2: keep events with changed_at <= TIMESTAMP '2026-10-15 00:00:00'
-- TODO 3: latest event per customer, drop deletes, count per city
```

```sql solution
WITH events AS (
  SELECT customer_id, city, 'SNAPSHOT' AS operation, CAST(0 AS BIGINT) AS sequence_num, updated_at AS changed_at
  FROM customers_snapshot
  UNION ALL
  SELECT customer_id, city, operation, sequence_num, changed_at
  FROM customers_changes
),
latest AS (
  SELECT *, row_number() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) AS rn
  FROM events
  WHERE changed_at <= TIMESTAMP '2026-10-15 00:00:00'
)
SELECT city, count(*) AS customers
FROM latest
WHERE rn = 1 AND operation <> 'DELETE'
GROUP BY city
ORDER BY customers DESC;
-- With an SCD Type 2 table this is a filter:
-- WHERE __START_AT <= ts AND (__END_AT > ts OR __END_AT IS NULL)

-- Clean up when you are done
-- DROP TABLE IF EXISTS cdc_customers_scd1;
-- DROP TABLE IF EXISTS cdc_customers_scd2;
```

## ⚠️ Common mistakes

- ❌ Applying changes in arrival order. Late events then overwrite newer data.
- ❌ A `MERGE` whose source has several events for one key. It fails; keep the latest per key first.
- ❌ SCD Type 1 when the business asks "what was true at the time". Use `STORED AS SCD TYPE 2`.
- ❌ NULLs in the sequence column. AUTO CDC needs a value on every event.
- ❌ Writing your own MERGE in a pipeline "because AUTO CDC cannot handle late data". Handling late data is what `SEQUENCE BY` is for.
- ✅ Track history only on the columns that matter (`track_history_column_list`), or Type 2 grows a version for every small change.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Current state from a change feed | `AUTO CDC INTO t ... STORED AS SCD TYPE 1` |
| Full history with validity ranges | `... STORED AS SCD TYPE 2` (`__START_AT`, `__END_AT`) |
| The current rows of a Type 2 table | `WHERE __END_AT IS NULL` |
| Changes from daily full dumps | `dp.create_auto_cdc_from_snapshot_flow(...)` |
| The same outside a pipeline | `MERGE INTO` with the latest event per key by sequence |
| Latest row per key in SQL | `QUALIFY row_number() OVER (PARTITION BY key ORDER BY seq DESC) = 1` |
