---
title: Medallion architecture
summary: Bronze, silver and gold are three promises about data quality. Learn what belongs in each layer, why raw data is kept, and build a small medallion flow in SQL.
icon: 🏅
level: Beginner
minutes: 9
group: Lakehouse foundations
tags: [Medallion, Bronze, Silver, Gold]
---
# Medallion architecture

> A way to organise tables in a lakehouse so that data gets **cleaner and more useful at every step**: bronze keeps what arrived, silver makes it trustworthy, gold answers business questions.

**The one idea to remember:** each layer makes one promise. Bronze: *nothing is lost*. Silver: *this is correct*. Gold: *this is ready to use*.

## 💡 Why layers at all

Raw data is messy: duplicates, missing values, test records, columns that change without warning. If every report cleans it in its own way, two dashboards show two different revenues.

```viz compare
{"items": [
 {"icon": "🍝", "title": "One big step", "sub": "raw files → report", "color": "red",
  "points": ["❌ Every consumer repeats the cleaning", "❌ A bug means re-reading the source system", "❌ Nobody knows which number is right"]},
 {"icon": "🏅", "title": "Medallion layers", "sub": "raw → clean → business", "color": "green",
  "points": ["✅ Cleaning happens once, in silver", "✅ Bronze lets you replay any fix", "✅ Gold tables carry agreed definitions"]}
]}
```

The layers are a **convention**, not a product feature. They are ordinary Delta tables, usually one schema per layer.

## 🏗️ The three layers

```viz flow
{"nodes": [
  {"icon": "📥", "title": "Sources", "sub": "files, databases, events", "color": "gray"},
  {"icon": "🥉", "title": "Bronze", "sub": "raw, as it arrived", "color": "bronze", "items": ["append-only", "source columns + load metadata"]},
  {"icon": "🥈", "title": "Silver", "sub": "cleaned and conformed", "color": "silver", "items": ["typed, deduplicated", "bad rows filtered or quarantined"]},
  {"icon": "🥇", "title": "Gold", "sub": "business-level tables", "color": "gold", "items": ["aggregates, star schemas", "one table per use case"]}
 ],
 "edges": ["ingest", "clean", "model"],
 "steps": [
  {"label": "Ingest", "focus": [0, 1], "note": "Load the data **without changing it**. Add when and where it came from. Speed and completeness matter here, not beauty."},
  {"label": "Clean", "focus": [1, 2], "note": "Fix types, remove duplicates and invalid rows, standardise values, join reference data. Silver is where **data quality rules** live."},
  {"label": "Model", "focus": [2, 3], "note": "Shape the data for a consumer: daily revenue, a customer 360 view, features for a model. Gold is read by dashboards and people."}
 ]}
```

## 🥉 Bronze: keep what arrived

| Do | Why |
|---|---|
| Keep every source column, even odd ones | You cannot predict what a later fix needs |
| Append, never update | The table is a history of what the source sent |
| Add load metadata (`ingested_at`, source file) | You can trace any row back to its origin |
| Keep types loose (strings are fine) | A bad value must not make the load fail |

If a cleaning rule turns out to be wrong, you fix it and **rebuild silver from bronze**. Without bronze you would have to ask the source system again, which is often impossible.

## 🥈 Silver: make it trustworthy

Watch four raw rows go through the usual silver rules.

```viz table
{"title": "orders: from bronze to silver",
 "columns": ["order_id", "order_date", "quantity", "status"],
 "rows": [["1001", "2026-03-04", "2", "completed"],
          ["1002", "04/03/2026", "1", "COMPLETED"],
          ["1002", "04/03/2026", "1", "COMPLETED"],
          ["1003", "2026-03-05", "-5", "TEST"]],
 "steps": [
  {"label": "Bronze rows", "note": "Exactly what the source sent: everything is a string, one order arrived twice, one row is a test order."},
  {"label": "Standardise", "note": "One date format and one spelling for the status.", "upd": {"0": {"status": "COMPLETED"}, "1": {"order_date": "2026-03-04"}, "2": {"order_date": "2026-03-04"}}},
  {"label": "Deduplicate", "note": "The same `order_id` twice is one order. Keep one row.", "del": [2]},
  {"label": "Apply quality rules", "note": "A negative quantity and a `TEST` status break the rules. The row goes to a quarantine table instead of silver.", "del": [3]},
  {"label": "Silver rows", "note": "Two clean orders with proper types. Everyone downstream starts from here.", "hide": [2, 3], "hl": [0, 1]}
 ]}
```

Silver keeps the **same grain** as the source (one row per order). It does not aggregate.

## 🥇 Gold: ready for the business

Gold tables are built **for a consumer**, so there are usually many of them on top of the same silver tables.

```viz layers
{"layers": [
 {"icon": "📊", "title": "Dashboards", "sub": "gold.daily_revenue", "color": "gold", "items": ["one row per day and category", "revenue already net of discounts"]},
 {"icon": "🧞", "title": "Genie and ad-hoc SQL", "sub": "gold star schema", "color": "amber", "items": ["fact_orders", "dim_customer", "dim_product"]},
 {"icon": "🤖", "title": "Machine learning", "sub": "gold.customer_features", "color": "purple", "items": ["one row per customer", "orders_90d, avg_basket"]},
 {"icon": "🥈", "title": "All of them read silver", "sub": "the single source of truth", "color": "silver", "items": ["orders", "customers", "products"]}
]}
```

- Business definitions ("revenue excludes cancelled orders") are written **once**, in gold.
- Gold is denormalised and aggregated, so queries on it are short and fast.

## 🔁 How data moves between layers

| Step | Typical tool | Processing |
|---|---|---|
| Source → bronze | Auto Loader, `COPY INTO`, Lakeflow Connect | Incremental: only new files or rows |
| Bronze → silver | Streaming tables or `MERGE` | Incremental, with quality rules |
| Silver → gold | Materialized views or scheduled SQL | Recomputed or incrementally refreshed |

> In Lakeflow Spark Declarative Pipelines the same idea is three table definitions. Bronze and silver are usually **streaming tables**, gold is usually a **materialized view**.

## 🧪 Try it: a medallion flow in SQL

```dataset retail
```

Treat `fact_orders` as the data a source system sent. First land it in bronze, unchanged, with load metadata.

```sql run
-- Bronze: keep everything, add load metadata
CREATE OR REPLACE TABLE medal_orders_bronze AS
SELECT *, current_timestamp() AS ingested_at, 'orders_export' AS source_system
FROM fact_orders;

SELECT status, count(*) AS row_count FROM medal_orders_bronze GROUP BY status ORDER BY row_count DESC;
```

```sql run
-- Silver: valid orders only, joined to the product price
CREATE OR REPLACE TABLE medal_orders_silver AS
SELECT o.order_id, o.order_date, o.customer_id, o.product_id, o.quantity, o.discount, o.status,
       round(o.quantity * p.unit_price * (1 - o.discount), 2) AS net_amount
FROM medal_orders_bronze o
JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status <> 'TEST' AND o.quantity > 0;

SELECT count(*) AS silver_rows FROM medal_orders_silver;
```

```sql run
-- Gold: the table a revenue dashboard reads
CREATE OR REPLACE TABLE medal_daily_revenue_gold AS
SELECT s.order_date, p.category, count(*) AS orders, round(sum(s.net_amount), 2) AS revenue
FROM medal_orders_silver s
JOIN dim_product p ON s.product_id = p.product_id
WHERE s.status = 'COMPLETED'
GROUP BY s.order_date, p.category;

SELECT * FROM medal_daily_revenue_gold ORDER BY order_date DESC, revenue DESC LIMIT 10;
```

## Exercise 1: which layer?

Decide where each table belongs. Fill in `bronze`, `silver` or `gold`, then run the cell to check yourself.

```python todo
# TODO: replace each "?" with "bronze", "silver" or "gold"
answers = {
    "JSON events exactly as the app sent them, plus the file name": "?",
    "Monthly active customers per region": "?",
    "Customers with trimmed names, valid emails and no duplicates": "?",
    "Orders joined to products with a net_amount column, one row per order": "?",
}

expected = ["bronze", "gold", "silver", "silver"]
for (text, given), right in zip(answers.items(), expected):
    print("✅" if given == right else "❌", text)
```

```python solution
answers = {
    "JSON events exactly as the app sent them, plus the file name": "bronze",      # raw + load metadata
    "Monthly active customers per region": "gold",                                 # aggregated for a consumer
    "Customers with trimmed names, valid emails and no duplicates": "silver",      # cleaned, same grain
    "Orders joined to products with a net_amount column, one row per order": "silver",   # enriched, still one row per order
}
```

## Exercise 2: quarantine the bad rows

Silver filtered out the `TEST` orders. Dropping rows silently is risky, so keep them where someone can inspect them.

```sql todo
-- TODO: create medal_orders_quarantine with the bronze rows that silver rejected,
--       and add a column "reason" that says why
```

```sql solution
CREATE OR REPLACE TABLE medal_orders_quarantine AS
SELECT *, CASE WHEN status = 'TEST' THEN 'test order' ELSE 'invalid quantity' END AS reason
FROM medal_orders_bronze
WHERE status = 'TEST' OR quantity <= 0;

SELECT reason, count(*) AS row_count FROM medal_orders_quarantine GROUP BY reason;
-- silver rows + quarantine rows = bronze rows
```

## Exercise 3: a second gold table

A marketing team wants the ten customers with the highest completed revenue, with their region. Build it from silver.

```sql todo
-- TODO: create medal_top_customers_gold (customer_id, customer_name, region, revenue), top 10 by revenue
```

```sql solution
CREATE OR REPLACE TABLE medal_top_customers_gold AS
SELECT c.customer_id, c.customer_name, c.region, round(sum(s.net_amount), 2) AS revenue
FROM medal_orders_silver s
JOIN dim_customer c ON s.customer_id = c.customer_id
WHERE s.status = 'COMPLETED'
GROUP BY c.customer_id, c.customer_name, c.region
ORDER BY revenue DESC
LIMIT 10;

SELECT * FROM medal_top_customers_gold;

-- Clean up when you are done
-- DROP TABLE medal_orders_bronze; DROP TABLE medal_orders_silver; DROP TABLE medal_orders_quarantine;
-- DROP TABLE medal_daily_revenue_gold; DROP TABLE medal_top_customers_gold;
```

## ⚠️ Common mistakes

- ❌ Cleaning data on the way into bronze. Then a wrong rule destroys data you can never get back.
- ❌ Aggregating in silver. Silver keeps the source grain so that every gold table can start from it.
- ❌ One giant gold table for everyone. Gold is per use case, and several small tables are normal.
- ❌ Dropping bad rows without a trace. Quarantine them and count them.
- ✅ Three layers are a starting point. Add a landing zone or split silver if your data needs it.

## 🧭 Cheat sheet

| | Bronze | Silver | Gold |
|---|---|---|---|
| **Promise** | Nothing is lost | This is correct | This is ready to use |
| **Shape** | Like the source | Clean, same grain | Aggregated or modelled |
| **Writes** | Append-only | Upserts, deduplication | Rebuild or refresh |
| **Readers** | Data engineers | Engineers, analysts, data scientists | Dashboards, business users |
