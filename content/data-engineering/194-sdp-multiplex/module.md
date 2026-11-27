---
title: "Multiplex: one stream, many event types"
summary: Ingest a mixed event stream once into a bronze table with a VARIANT payload, then fan it out into one table per event type. Learn the VARIANT path syntax, and what happens to new and unknown event types.
icon: 🔱
level: Intermediate
minutes: 11
group: Ingestion and pipelines
tags: [Lakeflow, Declarative Pipelines, Multiplex, VARIANT, Kafka]
---
# Multiplex: one stream, many event types

> Orders, clicks and shipments often travel through **one** Kafka topic or **one** storage folder. Each message says what it is in a type field, and each type has a different shape.

**The one idea to remember:** read the shared source **once** into a bronze table that keeps the raw payload as `VARIANT` plus an `event_type` column, then **fan out**: one downstream table per type, each a simple `WHERE event_type = '...'`.

## 💡 One transport, many event types

The shop sends all its events to the topic `shop-events`. There are three types today. How many pipelines should read the topic?

```viz compare
{"title": "Three event types on one topic",
 "items": [
  {"icon": "🔁", "title": "One reader per type", "sub": "N pipelines on the same topic", "color": "red",
   "points": ["❌ the topic is scanned N times", "❌ N checkpoints on the source to look after", "❌ a source change (new broker, new auth) is made N times", "❌ an unexpected type is read by nobody"],
   "foot": "cost and effort grow with every type"},
  {"icon": "🔱", "title": "Multiplex", "sub": "ingest once, fan out", "color": "green",
   "points": ["✅ one source scan, one checkpoint on the topic", "✅ source settings live in one place", "✅ every message lands in bronze, known or not", "✅ a new type is one new downstream table"],
   "foot": "the pattern this module teaches"}
 ]}
```

## 🔀 Ingest once, fan out by type

Step through one pipeline update with 8 new messages on the topic.

```viz flow
{"title": "A multiplex pipeline",
 "nodes": [{"icon": "📨", "title": "shop-events", "sub": "one Kafka topic", "color": "gray"},
           {"icon": "🥉", "title": "mpx_bronze", "sub": "payload VARIANT + event_type", "color": "bronze", "items": ["8 messages, 4 types"]},
           {"icon": "🔱", "title": "Fan-out tables", "sub": "one streaming table per type", "color": "silver",
            "items": ["`mpx_orders`: 3", "`mpx_clicks`: 2", "`mpx_shipments`: 2"]}],
 "edges": ["read once", "WHERE event_type = ..."],
 "steps": [
  {"label": "Ingest", "focus": [0, 1], "note": "One flow reads the topic and appends all **8** messages to bronze. The payload is parsed into `VARIANT`, whatever its shape."},
  {"label": "Fan out", "focus": [1, 2], "note": "Each fan-out table has its **own flow and checkpoint on bronze**. It reads the new bronze rows, keeps its type and casts the fields to real columns: 3 orders, 2 clicks, 2 shipments."},
  {"label": "The odd one", "focus": [1], "note": "3 + 2 + 2 = 7. The 8th message is a `refund`, a type nobody asked for yet. No table filters on it, so it **stays in bronze**."}
 ]}
```

The topic is read once. Each fan-out table is a streaming table with its own flow and checkpoint **on bronze**, so it reads only the bronze rows added since its last update.

## 🧬 VARIANT: keep any shape, extract later

`VARIANT` stores semi-structured data in an efficient binary form. It needs no schema up front, so orders and clicks fit in the same column. It works on serverless and DBR 15.3 and above.

| Expression | Returns | Note |
|---|---|---|
| `parse_json(value)` | `VARIANT` | Fails on invalid JSON; `try_parse_json` returns NULL instead |
| `payload:order_id` | `VARIANT` | Path into the value; `payload:items[0].sku` for nested data |
| `payload:order_id::BIGINT` | `BIGINT` | Cast with `::`; a value that does not fit raises an error |
| `try_variant_get(payload, '$.qty', 'int')` | `INT` | NULL instead of an error when the cast fails |
| `schema_of_variant(payload)` | `STRING` | The shape of one value; `schema_of_variant_agg` merges many rows |

Field names after `:` are case-sensitive. A missing field gives NULL, not an error.

## 📄 The pipeline in SQL

Bronze ingests and parses. Each silver table filters one type and turns paths into typed columns.

```viz code
title: pipeline/multiplex.sql
lang: sql
---
CREATE OR REFRESH STREAMING TABLE mpx_bronze
TBLPROPERTIES ('pipelines.reset.allowed' = false)
AS SELECT offset AS msg_offset,
  parse_json(CAST(value AS STRING)) AS payload,
  variant_get(parse_json(CAST(value AS STRING)), '$.type', 'string') AS event_type
FROM STREAM read_kafka(bootstrapServers => '${kafka_servers}', subscribe => 'shop-events');

CREATE OR REFRESH STREAMING TABLE mpx_orders AS
SELECT payload:order_id::BIGINT   AS order_id,
       payload:product_id::BIGINT AS product_id,
       try_variant_get(payload, '$.qty', 'int') AS qty
FROM STREAM(mpx_bronze) WHERE event_type = 'order';
---
1-2 | protect bronze | Bronze is the only full copy once the topic's retention has expired. A full refresh could lose data, so it is blocked.
4 | the payload | Kafka delivers `value` as binary. Cast to string, parse to `VARIANT`, keep it whole.
5 | the routing key | The type is pulled out once, as a plain column, so every fan-out filter is cheap.
6 | read once | The only reader of the topic. `mpx_clicks` and `mpx_shipments` look like `mpx_orders`.
9-10 | typed columns | Paths plus casts give silver a real schema.
11 | tolerant cast | One producer sends `"qty": "two"`. `::INT` would fail the update; `try_variant_get` gives NULL, which an expectation can count.
12 | fan-out | Each silver table reads `STREAM(mpx_bronze)` and keeps its type.
```

## 🎯 Where each message goes

The 8 messages of the update, as bronze sees them. Step through the fan-out.

```viz table
{"title": "mpx_bronze after the update", "columns": ["msg_offset", "event_type", "payload (short)", "lands in"],
 "rows": [[1, "order", "order_id 9001, qty 2", "-"],
          [2, "click", "page /books, 340 ms", "-"],
          [3, "order", "order_id 9002, qty 1", "-"],
          [4, "shipment", "order_id 9001, DHL", "-"],
          [5, "click", "page /toys, 1210 ms", "-"],
          [6, "refund", "order_id 9002, 19.99", "-"],
          [7, "order", "order_id 9003, qty \"two\"", "-"],
          [8, "shipment", "order_id 9002, UPS", "-"]],
 "steps": [
  {"label": "Bronze", "note": "All 8 messages are in bronze, in arrival order. Nothing was filtered or lost."},
  {"label": "mpx_orders", "note": "3 rows. Offset 7 gets `qty = NULL` from `try_variant_get`.", "upd": {"0": {"lands in": "mpx_orders"}, "2": {"lands in": "mpx_orders"}, "6": {"lands in": "mpx_orders (qty NULL)"}}, "hl": [0, 2, 6]},
  {"label": "mpx_clicks", "note": "2 rows.", "upd": {"1": {"lands in": "mpx_clicks"}, "4": {"lands in": "mpx_clicks"}}, "hl": [1, 4]},
  {"label": "mpx_shipments", "note": "2 rows.", "upd": {"3": {"lands in": "mpx_shipments"}, "7": {"lands in": "mpx_shipments"}}, "hl": [3, 7]},
  {"label": "The refund", "note": "No table filters on `refund`, so it lands nowhere else. It is **not lost**: it waits in bronze.", "upd": {"5": {"lands in": "bronze only"}}, "hl": [5]}
 ]}
```

## ➕ New types and unknown types

- **A new type** is a new silver table with its own flow. On its first update it reads bronze **from the beginning**, so the old refunds are included. No other table is touched.
- **Unknown types** stay in bronze. Watch for them: count the bronze rows whose type has no table (Exercise 2 does this).
- In Python, the fan-out is often a loop over a list of types, so a new type is one more list entry.

```python
from pyspark import pipelines as dp

def fan_out(t):                          # a factory: one streaming table per call
    @dp.table(name=f"mpx_{t}s")
    def _():
        return spark.readStream.table("mpx_bronze").where(f"event_type = '{t}'")

for t in ["order", "click", "shipment"]:
    fan_out(t)
```

## 🧪 Try it: a mixed event table

```dataset retail
```

> A pipeline cannot run from a notebook cell, so the pipeline code above is display-only. `VARIANT` itself is plain SQL: build the 8 messages, parse them, and fan out with batch tables.

```sql run
-- The raw messages as they would arrive from the topic: one JSON string each
CREATE OR REPLACE TABLE mpx_raw AS
SELECT * FROM VALUES
  (1, '{"type":"order","order_id":9001,"customer_id":12,"product_id":3,"qty":2}'),
  (2, '{"type":"click","session":"s-71","page":"/books","ms":340}'),
  (3, '{"type":"order","order_id":9002,"customer_id":40,"product_id":17,"qty":1}'),
  (4, '{"type":"shipment","order_id":9001,"carrier":"DHL","packages":1}'),
  (5, '{"type":"click","session":"s-72","page":"/toys","ms":1210}'),
  (6, '{"type":"refund","order_id":9002,"amount":19.99}'),
  (7, '{"type":"order","order_id":9003,"customer_id":12,"product_id":3,"qty":"two"}'),
  (8, '{"type":"shipment","order_id":9002,"carrier":"UPS","packages":2}')
AS t(msg_offset, value);
```

```sql run
-- Bronze: parse once, pull out the routing key
CREATE OR REPLACE TABLE mpx_bronze AS
SELECT msg_offset, payload, payload:type::STRING AS event_type
FROM (SELECT msg_offset, parse_json(value) AS payload FROM mpx_raw);

SELECT event_type, count(*) AS messages FROM mpx_bronze GROUP BY event_type ORDER BY event_type;
```

```sql run
-- Paths, casts and the shape of each type
SELECT msg_offset, event_type,
       payload:order_id::BIGINT                 AS order_id,
       payload:carrier::STRING                  AS carrier,   -- NULL where the field is missing
       payload:qty                              AS qty_raw,   -- still VARIANT
       try_variant_get(payload, '$.qty', 'int') AS qty
FROM mpx_bronze ORDER BY msg_offset;

SELECT event_type, schema_of_variant_agg(payload) AS merged_shape FROM mpx_bronze GROUP BY event_type;
```

```sql run
-- Fan out (batch stand-in for the streaming tables): one table per type
CREATE OR REPLACE TABLE mpx_orders AS
SELECT msg_offset, payload:order_id::BIGINT AS order_id, payload:customer_id::BIGINT AS customer_id,
       payload:product_id::BIGINT AS product_id, try_variant_get(payload, '$.qty', 'int') AS qty
FROM mpx_bronze WHERE event_type = 'order';

CREATE OR REPLACE TABLE mpx_clicks AS
SELECT msg_offset, payload:session::STRING AS session_id, payload:page::STRING AS page, payload:ms::INT AS duration_ms
FROM mpx_bronze WHERE event_type = 'click';

SELECT (SELECT count(*) FROM mpx_orders) AS orders, (SELECT count(*) FROM mpx_clicks) AS clicks,
       (SELECT count(*) FROM mpx_bronze) AS bronze;
```

> Look at `merged_shape` for `order`: the producers disagree about the type of `qty`. In a pipeline this is exactly the row an expectation such as `EXPECT (qty IS NOT NULL)` should count.

## Exercise 1: a new event type arrives

The first cell rebuilds `mpx_bronze` with the same 8 messages. Add `mpx_shipments` (order_id, carrier, packages as INT). Then the business asks for refunds: add `mpx_refunds` (order_id, amount as DECIMAL(10,2)). Predict both row counts first.

```sql run
-- Setup: the same 8 messages as the lecture, parsed into mpx_bronze
CREATE OR REPLACE TABLE mpx_bronze AS
SELECT msg_offset, payload, payload:type::STRING AS event_type
FROM (SELECT msg_offset, parse_json(value) AS payload FROM VALUES
  (1, '{"type":"order","order_id":9001,"customer_id":12,"product_id":3,"qty":2}'),
  (2, '{"type":"click","session":"s-71","page":"/books","ms":340}'),
  (3, '{"type":"order","order_id":9002,"customer_id":40,"product_id":17,"qty":1}'),
  (4, '{"type":"shipment","order_id":9001,"carrier":"DHL","packages":1}'),
  (5, '{"type":"click","session":"s-72","page":"/toys","ms":1210}'),
  (6, '{"type":"refund","order_id":9002,"amount":19.99}'),
  (7, '{"type":"order","order_id":9003,"customer_id":12,"product_id":3,"qty":"two"}'),
  (8, '{"type":"shipment","order_id":9002,"carrier":"UPS","packages":2}')
  AS t(msg_offset, value));
```

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE mpx_shipments from the 'shipment' rows (order_id, carrier, packages)
-- TODO 2: CREATE OR REPLACE TABLE mpx_refunds from the 'refund' rows (order_id, amount)
-- TODO 3: show both tables
```

```sql solution
CREATE OR REPLACE TABLE mpx_shipments AS
SELECT msg_offset, payload:order_id::BIGINT AS order_id, payload:carrier::STRING AS carrier,
       payload:packages::INT AS packages
FROM mpx_bronze WHERE event_type = 'shipment';

CREATE OR REPLACE TABLE mpx_refunds AS
SELECT msg_offset, payload:order_id::BIGINT AS order_id, payload:amount::DECIMAL(10,2) AS amount
FROM mpx_bronze WHERE event_type = 'refund';

SELECT 'shipments' AS tbl, count(*) AS row_count FROM mpx_shipments   -- 2
UNION ALL SELECT 'refunds', count(*) FROM mpx_refunds;                -- 1: it waited in bronze
```

## Exercise 2: reconcile and enrich

Uses `mpx_bronze` from the setup cell of Exercise 1. First, list every `event_type` with its count and the table it is routed to, where `order`, `click` and `shipment` are routed and anything else is `'unrouted'`. Then join the orders with `dim_product`. Predict: which order has no quantity, and why?

```sql todo
-- TODO 1: per event_type: messages, and route = 'routed' or 'unrouted'
-- TODO 2: the order events (order_id, product_id, qty via try_variant_get) joined with dim_product for category
```

```sql solution
SELECT event_type, count(*) AS messages,
       CASE WHEN event_type IN ('order', 'click', 'shipment') THEN 'routed' ELSE 'unrouted' END AS route
FROM mpx_bronze GROUP BY event_type ORDER BY route, event_type;   -- refund: 1 unrouted; total 8

SELECT b.payload:order_id::BIGINT AS order_id, p.product_id, p.category,
       try_variant_get(b.payload, '$.qty', 'int') AS qty          -- 9003: NULL, the producer sent "two"
FROM mpx_bronze b
JOIN dim_product p ON p.product_id = b.payload:product_id::BIGINT
WHERE b.event_type = 'order'
ORDER BY order_id;

-- Clean up when you are done
-- DROP TABLE IF EXISTS mpx_raw; DROP TABLE IF EXISTS mpx_bronze; DROP TABLE IF EXISTS mpx_orders;
-- DROP TABLE IF EXISTS mpx_clicks; DROP TABLE IF EXISTS mpx_shipments; DROP TABLE IF EXISTS mpx_refunds;
```

## ⚠️ Common mistakes

- ❌ One pipeline per event type, all reading the same topic. N scans, N source checkpoints, N places to change.
- ❌ Filtering unknown types out at ingestion. They are gone before anyone notices; keep everything in bronze.
- ❌ `payload:qty::INT` on data from many producers. One bad value fails the update; use `try_variant_get` and count the NULLs.
- ❌ Full refresh of bronze after the topic retention has expired. Set `pipelines.reset.allowed = false`.
- ✅ Extract `event_type` once in bronze as a plain column, and filter on it downstream.
- ✅ Monitor the unrouted types, and add a table when one becomes useful.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Parse a JSON string, any shape | `parse_json(value)` (or `try_parse_json`) |
| One field, typed | `payload:field::TYPE`, nested `payload:a.b[0]` |
| A cast that never fails | `try_variant_get(payload, '$.field', 'type')` |
| See the shape | `schema_of_variant(v)`, `schema_of_variant_agg(v)` |
| Fan out one type | `CREATE OR REFRESH STREAMING TABLE t AS SELECT ... FROM STREAM(bronze) WHERE event_type = '...'` |
| Add a type later | A new fan-out table: it backfills from bronze |
