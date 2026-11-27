---
title: "Advanced expectations: ranges, NULLs, schema drift and quarantine"
summary: Write expectations that catch wrong values, not only missing ones, without false alarms on NULLs. Check whole tables against each other, keep a bronze layer that survives new columns, and build a quarantine split that never loses a row.
icon: 🛡️
level: Advanced
minutes: 12
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Expectations, Data quality, Schema evolution, Quarantine]
---
# Advanced expectations: ranges, NULLs, schema drift and quarantine

> `WARN`, `DROP ROW` and `FAIL UPDATE` are only the actions. Production quality depends on the rules themselves: do they catch a 120% discount, do they stay quiet about a column that did not exist last month, and does every row end up somewhere?

**The one idea to remember:** a rule must return TRUE or FALSE, never NULL. Decide for every column whether NULL is allowed, write that into the rule, and the metrics, the drops and the quarantine split all stay exact.

## 🔍 What NOT NULL misses

The basics are in the "Data quality with expectations" module. A value can be present and still be wrong.

| Problem | Example | `IS NOT NULL` catches it? |
|---|---|---|
| Numeric anomaly | `qty = -2` | ❌ |
| System default date | `order_date = 1970-01-01` | ❌ |
| Range violation | `discount_pct = 120` | ❌ |
| Optional field | NULL is fine, but if present it must be ≥ 0 | ❌ |
| New column mid-stream | old rows have NULL | ❌ (and naive rules flag them) |

Write **one rule per `CONSTRAINT`**. The pipeline reports metrics per constraint, so `valid_qty` and `valid_discount` as two rules tell you which problem grew; one big rule only says "something".

## 🎯 The NULL trap

In SQL, `NULL BETWEEN 0 AND 100` is NULL, not FALSE. A pipeline expectation counts a NULL result as a **violation**, just like FALSE: it is reported as failed, and `DROP ROW` drops it.

```viz table
{"title": "adq_orders: two ways to write the discount rule", "columns": ["order_id", "discount_pct", "naive rule", "NULL-tolerant rule"],
 "rows": [[1, 10.0, "", ""], [2, null, "", ""], [6, 120.0, "", ""], [7, 15.0, "", ""]],
 "steps": [
  {"label": "Input", "note": "Discount is optional: order 2 simply had no discount."},
  {"label": "Naive", "note": "`discount_pct BETWEEN 0 AND 100` returns NULL for order 2. The pipeline counts it as a failure: **2 violations**, one of them false.", "upd": {"0": {"naive rule": "TRUE"}, "1": {"naive rule": "NULL → fail"}, "2": {"naive rule": "FALSE → fail"}, "3": {"naive rule": "TRUE"}}, "hl": [1, 2]},
  {"label": "Tolerant", "note": "`discount_pct IS NULL OR discount_pct BETWEEN 0 AND 100` is TRUE for order 2. **1 violation**: the real one.", "upd": {"0": {"NULL-tolerant rule": "TRUE"}, "1": {"NULL-tolerant rule": "TRUE"}, "2": {"NULL-tolerant rule": "FALSE → fail"}, "3": {"NULL-tolerant rule": "TRUE"}}, "hl": [2]}
 ]}
```

## 🧷 Say what NULL means in each rule

```viz code
title: pipeline/orders_silver.sql (constraints only)
lang: sql
---
CONSTRAINT has_customer   EXPECT (customer_id IS NOT NULL),
CONSTRAINT valid_qty      EXPECT (qty IS NOT NULL AND qty > 0),
CONSTRAINT valid_date     EXPECT (order_date >= DATE '2020-01-01'),
CONSTRAINT valid_discount EXPECT (
  CASE WHEN discount_pct IS NOT NULL
       THEN discount_pct BETWEEN 0 AND 100
       ELSE TRUE END),
CONSTRAINT valid_shipping EXPECT (shipping_cost IS NULL
                                  OR shipping_cost BETWEEN 0 AND 100)
---
1 | required key | NULL is a real problem here, so the rule says so.
2 | required number | `IS NOT NULL AND` makes a missing quantity FALSE instead of NULL.
3 | range | Catches the 1970 default date. If `order_date` can be NULL, add `IS NOT NULL AND` too.
4-7 | optional (course style) | `CASE WHEN ... ELSE TRUE END`: check the value only when it is there.
8-9 | optional (short form) | `col IS NULL OR ...` means the same and is easier to read.
```

## 🧬 Resilient bronze: a column appears mid-stream

Bronze should never reject a record. Read everything, declare columns you know are coming with `schemaHints`, and let `_rescued_data` keep anything unexpected.

```viz table
{"title": "orders_bronze (read_files with schemaHints => 'shipping_cost STRING')", "columns": ["order_id", "file", "shipping_cost", "_rescued_data"],
 "rows": [[1, "file 1", null, null], [2, "file 1", null, null]],
 "steps": [
  {"label": "File 1", "note": "The file has no `shipping_cost`, but the hint already created the column. Old rows hold NULL."},
  {"label": "File 2", "note": "The column arrives and fills in. No code change, no restart.", "add": [[7, "file 2", "4.99", null], [8, "file 2", "150", null]]},
  {"label": "File 3", "note": "An unexpected field `gift_wrap` shows up. With `schemaEvolutionMode => 'rescue'` the schema stays fixed and the field is kept as JSON in `_rescued_data`.", "add": [[11, "file 3", "6.00", "{\"gift_wrap\":\"yes\"}"]], "hl": [4]},
  {"label": "Naive rule", "note": "`shipping_cost BETWEEN 0 AND 100` (after a cast in silver) is NULL for orders 1 and 2, so every historic row becomes a violation.", "hl": [0, 1, 3]},
  {"label": "Tolerant rule", "note": "With `shipping_cost IS NULL OR ...` only order 8 (150) fails.", "hl": [3]}
 ]}
```

The default mode, `addNewColumns`, instead stops the stream on a new column and restarts with the wider schema. Keep bronze as STRING and convert in silver with `TRY_CAST`: a bad value becomes NULL instead of failing the update, and the rule decides what that NULL means.

## 🔗 Checks across tables

A row rule sees one row. To check completeness and keys, build a small **materialized view** whose rows are the test results, and put `FAIL UPDATE` on it.

```sql
CREATE OR REFRESH MATERIALIZED VIEW adq_check_counts (
  CONSTRAINT no_rows_lost EXPECT (src_count = report_count) ON VIOLATION FAIL UPDATE
) AS SELECT * FROM (SELECT count(*) AS src_count FROM orders_silver),
                   (SELECT count(*) AS report_count FROM orders_report);

CREATE OR REFRESH MATERIALIZED VIEW adq_check_missing (
  CONSTRAINT no_missing_orders EXPECT (r_order_id IS NOT NULL) ON VIOLATION FAIL UPDATE
) AS SELECT s.order_id, r.order_id AS r_order_id
     FROM orders_silver s LEFT JOIN orders_report r ON s.order_id = r.order_id;

CREATE OR REFRESH MATERIALIZED VIEW adq_check_pk (
  CONSTRAINT unique_order_id EXPECT (num_entries = 1) ON VIOLATION FAIL UPDATE
) AS SELECT order_id, count(*) AS num_entries FROM orders_report GROUP BY order_id;
```

Equal counts do not prove equal data: one lost row and one duplicate cancel out. Use the join and the key check too.

## 🗃️ Quarantine with inverse logic

`DROP ROW` deletes evidence. The quarantine pattern keeps every row: one table with **WARN-only** rules (for the metrics) also computes `is_quarantined = NOT (rule1 AND rule2 AND ...)`, and two views split on that flag.

```viz flow
{"title": "Ten orders through the quarantine pattern",
 "nodes": [{"icon": "🥉", "title": "adq_orders_raw", "sub": "all STRING", "color": "bronze", "items": ["10 rows, `qty = 'two'` included"]},
           {"icon": "🔤", "title": "adq_orders", "sub": "TRY_CAST", "color": "silver", "items": ["`'two'` → NULL, nothing fails"]},
           {"icon": "⚠️", "title": "adq_orders_dq", "sub": "WARN rules + is_quarantined", "color": "amber", "items": ["every row kept", "metrics per rule"]},
           {"icon": "🔀", "title": "Two views", "sub": "split on the flag", "color": "teal", "items": ["clean: 4", "quarantined: 6"]}],
 "edges": ["cast", "flag", "filter"],
 "steps": [
  {"label": "Bronze", "focus": [0], "note": "Ten orders arrive as text. Nothing is rejected."},
  {"label": "Types", "focus": [1], "note": "`TRY_CAST('two' AS INT)` is NULL. A plain `CAST` would fail the whole update."},
  {"label": "Flag", "focus": [2], "note": "WARN rules only measure. The flag is computed from the **same** rules, so metrics and routing agree. With `DROP ROW` or `FAIL UPDATE` here, bad rows would never get a flag."},
  {"label": "Split", "focus": [3], "note": "`WHERE is_quarantined = FALSE` and `= TRUE`. The check that matters: **total = clean + quarantined**, 10 = 4 + 6."}
 ]}
```

## 🕳️ The NOT(NULL) hole

If one rule returns NULL and all others are TRUE, the AND is NULL, and `NOT NULL` is NULL. The row matches neither `= FALSE` nor `= TRUE`.

```viz table
{"title": "adq_orders_dq with the naive rule qty > 0", "columns": ["order_id", "qty", "rules AND-ed", "is_quarantined"],
 "rows": [[7, 2, "TRUE", "FALSE"], [5, -2, "FALSE", "TRUE"], [10, null, "NULL", "NULL"]],
 "steps": [
  {"label": "Three rows", "note": "Order 10 had `qty = 'two'`, which `TRY_CAST` turned into NULL. Everything else about it is valid."},
  {"label": "Split", "note": "Order 7 goes to clean, order 5 to quarantine. Order 10 goes **nowhere**: 4 + 5 = 9 of 10 rows. Yet the `valid_qty` metric did count it as a failure.", "hl": [2]},
  {"label": "Fix", "note": "Write the rule as `qty IS NOT NULL AND qty > 0`, or wrap the whole flag: `NOT coalesce(rule1 AND ..., FALSE)`. Order 10 is quarantined: 4 + 6 = 10.", "upd": {"2": {"rules AND-ed": "FALSE", "is_quarantined": "TRUE"}}, "hl": [2]}
 ]}
```

A row that fails another rule is still caught, because `FALSE AND NULL` is FALSE. The hole hides exactly the rows that are bad in one NULL way only.

## 🧪 Try it: rules, flag and split in plain SQL

```dataset retail
```

Expectations need a pipeline, so the definitions above are display-only. The rule logic is plain SQL; build the ten orders and run it here.

```sql run
-- Bronze: ten orders as text; shipping_cost did not exist for orders 1 to 6
CREATE OR REPLACE TABLE adq_orders_raw AS
SELECT * FROM VALUES
  (1,  '2026-03-02', 'C01', '2',   '10',  NULL),
  (2,  '2026-03-02', 'C02', '1',   NULL,  NULL),
  (3,  '1970-01-01', 'C03', '3',   '5',   NULL),
  (4,  '2026-03-03', NULL,  '1',   '0',   NULL),
  (5,  '2026-03-03', 'C05', '-2',  '0',   NULL),
  (6,  '2026-03-04', 'C06', '1',   '120', NULL),
  (7,  '2026-03-05', 'C07', '2',   '15',  '4.99'),
  (8,  '2026-03-05', 'C08', '1',   '0',   '150'),
  (9,  '2026-03-06', 'C09', '4',   '25',  '0'),
  (10, '2026-03-06', 'C10', 'two', '10',  '7.5')
AS t(order_id, order_date, customer_id, qty, discount_pct, shipping_cost);

-- Silver: TRY_CAST turns 'two' into NULL instead of failing
CREATE OR REPLACE TABLE adq_orders AS
SELECT order_id, TRY_CAST(order_date AS DATE) AS order_date, customer_id,
       TRY_CAST(qty AS INT) AS qty, TRY_CAST(discount_pct AS DOUBLE) AS discount_pct,
       TRY_CAST(shipping_cost AS DOUBLE) AS shipping_cost
FROM adq_orders_raw;

SELECT * FROM adq_orders ORDER BY order_id;
```

```sql run
-- Violations per rule, counted like a pipeline: NULL counts as a failure
SELECT
  count_if(NOT coalesce(discount_pct BETWEEN 0 AND 100, FALSE))                         AS naive_discount,     -- 2
  count_if(NOT coalesce(discount_pct IS NULL OR discount_pct BETWEEN 0 AND 100, FALSE)) AS tolerant_discount,  -- 1
  count_if(NOT coalesce(shipping_cost BETWEEN 0 AND 100, FALSE))                        AS naive_shipping,     -- 7
  count_if(NOT coalesce(shipping_cost IS NULL OR shipping_cost BETWEEN 0 AND 100, FALSE)) AS tolerant_shipping, -- 1
  count_if(NOT coalesce(qty > 0, FALSE))                                                AS valid_qty,          -- 2
  count_if(NOT coalesce(order_date >= DATE '2020-01-01', FALSE))                         AS valid_date,         -- 1
  count_if(customer_id IS NULL)                                                         AS has_customer        -- 1
FROM adq_orders;
```

```sql run
-- The quality table with the naive qty rule, then the split
CREATE OR REPLACE VIEW adq_orders_dq AS
SELECT *,
  NOT (customer_id IS NOT NULL
       AND qty > 0
       AND order_date >= DATE '2020-01-01'
       AND (discount_pct IS NULL OR discount_pct BETWEEN 0 AND 100)
       AND (shipping_cost IS NULL OR shipping_cost BETWEEN 0 AND 100)) AS is_quarantined
FROM adq_orders;

CREATE OR REPLACE VIEW adq_orders_clean       AS SELECT * FROM adq_orders_dq WHERE is_quarantined = FALSE;
CREATE OR REPLACE VIEW adq_orders_quarantined AS SELECT * FROM adq_orders_dq WHERE is_quarantined = TRUE;

SELECT (SELECT count(*) FROM adq_orders_dq)          AS total,        -- 10
       (SELECT count(*) FROM adq_orders_clean)       AS clean,        -- 4
       (SELECT count(*) FROM adq_orders_quarantined) AS quarantined;  -- 5: one row is lost
```

```sql run
-- Find the lost row, then fix the rule and count again
SELECT order_id, qty, is_quarantined FROM adq_orders_dq WHERE is_quarantined IS NULL;   -- order 10

CREATE OR REPLACE VIEW adq_orders_dq AS
SELECT *,
  NOT (customer_id IS NOT NULL
       AND qty IS NOT NULL AND qty > 0
       AND order_date >= DATE '2020-01-01'
       AND (discount_pct IS NULL OR discount_pct BETWEEN 0 AND 100)
       AND (shipping_cost IS NULL OR shipping_cost BETWEEN 0 AND 100)) AS is_quarantined
FROM adq_orders;

SELECT (SELECT count(*) FROM adq_orders_clean)       AS clean,        -- 4
       (SELECT count(*) FROM adq_orders_quarantined) AS quarantined;  -- 6: 4 + 6 = 10
```

```python run
# Resilient bronze: read the broken retail file with schema hints and look at _rescued_data
base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="adq", fresh=True)

display(spark.sql(f"""
  SELECT order_id, order_date, quantity, discount, _rescued_data
  FROM read_files('{base}/fact_orders_bad', format => 'csv', header => true,
                  schemaHints => 'order_date DATE, quantity INT, discount DOUBLE')
  ORDER BY order_id
"""))
# 90001 ('five'), 90002 ('not-a-date') and 90003 ('ten percent') keep the raw text in _rescued_data
```

## Exercise 1: equal counts, wrong data

Build a "report" from the first 1,000 orders that loses order 500 and holds order 42 twice. **Predict** which of the three cross-table checks fails: equal row counts, no missing orders, unique `order_id`.

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE adq_report: fact_orders with order_id <= 1000 except 500,
--         UNION ALL order 42 once more
-- TODO 2: compare count(*) of adq_report with the 1,000 source orders
-- TODO 3: list source orders missing from adq_report (LEFT JOIN ... WHERE r.order_id IS NULL)
-- TODO 4: list order_ids that appear more than once in adq_report (GROUP BY ... HAVING)
```

```sql solution
CREATE OR REPLACE TABLE adq_report AS
SELECT * FROM fact_orders WHERE order_id <= 1000 AND order_id <> 500
UNION ALL
SELECT * FROM fact_orders WHERE order_id = 42;

SELECT (SELECT count(*) FROM fact_orders WHERE order_id <= 1000) AS src_count,      -- 1000
       (SELECT count(*) FROM adq_report)                         AS report_count;   -- 1000: passes!

SELECT s.order_id
FROM fact_orders s LEFT JOIN adq_report r ON s.order_id = r.order_id
WHERE s.order_id <= 1000 AND r.order_id IS NULL;                                    -- 500

SELECT order_id, count(*) AS num_entries
FROM adq_report GROUP BY order_id HAVING count(*) > 1;                              -- 42, 2
-- The count check passes while two other checks fail. In a pipeline, each query becomes
-- a materialized view with an ON VIOLATION FAIL UPDATE expectation.
```

## Exercise 2: make the split add up

Six orders: `quantity` is required and must be positive, `discount` is optional and must be between 0 and 1. **Predict** for the naive flag how many rows land in clean, in quarantine and nowhere. Then write a NULL-safe flag and predict again: which lost row becomes clean, and which becomes quarantined?

```sql todo
CREATE OR REPLACE TABLE adq_ex_orders AS
SELECT * FROM VALUES (101, 2, 0.10), (102, NULL, 0.0), (103, 3, NULL),
                     (104, 0, 0.25), (105, 1, 1.50), (106, 5, 0.0)
AS t(order_id, quantity, discount);

-- TODO 1: naive flag: NOT (quantity > 0 AND discount BETWEEN 0 AND 1)
--         count rows where the flag is FALSE, TRUE and NULL
-- TODO 2: NULL-safe flag: say explicitly what NULL means for each column, count again
```

```sql solution
CREATE OR REPLACE TABLE adq_ex_orders AS
SELECT * FROM VALUES (101, 2, 0.10), (102, NULL, 0.0), (103, 3, NULL),
                     (104, 0, 0.25), (105, 1, 1.50), (106, 5, 0.0)
AS t(order_id, quantity, discount);

SELECT count_if(flag = FALSE) AS clean, count_if(flag = TRUE) AS quarantined, count_if(flag IS NULL) AS lost
FROM (SELECT NOT (quantity > 0 AND discount BETWEEN 0 AND 1) AS flag FROM adq_ex_orders);
-- 2 clean (101, 106), 2 quarantined (104, 105), 2 lost (102, 103)

SELECT count_if(flag = FALSE) AS clean, count_if(flag = TRUE) AS quarantined, count_if(flag IS NULL) AS lost
FROM (SELECT NOT ((quantity IS NOT NULL AND quantity > 0)
                  AND (discount IS NULL OR discount BETWEEN 0 AND 1)) AS flag
      FROM adq_ex_orders);
-- 3 clean (101, 103, 106), 3 quarantined (102, 104, 105), 0 lost:
-- 103 has no discount, which is allowed; 102 has no quantity, which is not.

-- Clean up when you are done
-- DROP VIEW IF EXISTS adq_orders_clean; DROP VIEW IF EXISTS adq_orders_quarantined; DROP VIEW IF EXISTS adq_orders_dq;
-- DROP TABLE IF EXISTS adq_orders; DROP TABLE IF EXISTS adq_orders_raw;
-- DROP TABLE IF EXISTS adq_report; DROP TABLE IF EXISTS adq_ex_orders;
```

## ⚠️ Common mistakes

- ❌ "A NULL result passes the rule." The pipeline counts it as a violation, and `DROP ROW` drops it.
- ❌ Naive range rules on a column added mid-stream. Every older row becomes a false violation.
- ❌ `DROP ROW` or `FAIL UPDATE` on the quarantine tracking table. Bad rows vanish before they get a flag; use WARN there.
- ❌ Trusting `count(source) = count(target)` alone. A loss and a duplicate cancel out.
- ❌ `CAST` in silver on text from bronze. One bad value fails the update; `TRY_CAST` gives NULL.
- ✅ After every split, check `total = clean + quarantined`, and look for `is_quarantined IS NULL`.

## 🧭 Cheat sheet

| I want to… | Write |
|---|---|
| Require a value | `col IS NOT NULL AND col > 0` |
| Allow NULL, check when present | `col IS NULL OR col BETWEEN 0 AND 100` / `CASE WHEN col IS NOT NULL THEN ... ELSE TRUE END` |
| Expect a future column | `read_files(..., schemaHints => 'col STRING')` |
| Keep unexpected fields | `_rescued_data`, `schemaEvolutionMode => 'rescue'` |
| Check counts, missing rows, keys | Materialized views with `ON VIOLATION FAIL UPDATE` |
| Quarantine without losing rows | WARN rules + `NOT coalesce(r1 AND r2, FALSE) AS is_quarantined`, two views |
