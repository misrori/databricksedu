---
title: "Retail star schema"
summary: Three related tables (customers, products, orders) with primary and foreign keys, built from a seed. The default dataset for SQL, Delta Lake, pipelines and dashboard demos.
icon: 🛒
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, Star schema, SQL, Joins]
---
# Retail star schema

> A small online shop: 500 customers, 40 products and 60,000 orders from January 2025 to October 2026. It is generated from a seed, so everyone in the class gets exactly the same rows.

**The one idea to remember:** run the setup once, then every query in every module can use `fact_orders`, `dim_customer` and `dim_product` by their short names.

## 🗺️ The tables and how they join

One fact table in the middle, two dimensions around it. The keys are real Unity Catalog constraints, so Catalog Explorer, Genie and BI tools can see how the tables join.

```viz flow
{"nodes": [
  {"icon": "👤", "title": "dim_customer", "sub": "500 rows · PK customer_id", "color": "blue", "items": ["region, segment", "email, birth_year (synthetic PII)"]},
  {"icon": "🧾", "title": "fact_orders", "sub": "60,000 rows · PK order_id", "color": "gold", "items": ["order_date, quantity, discount", "status"]},
  {"icon": "📦", "title": "dim_product", "sub": "40 rows · PK product_id", "color": "teal", "items": ["category, unit_price"]}],
 "edges": ["customer_id", "product_id"],
 "steps": [
  {"label": "Fact", "focus": [1], "note": "One row per order. It holds the measures (`quantity`, `discount`) and two foreign keys."},
  {"label": "Customer", "focus": [0, 1], "note": "`fact_orders.customer_id` references `dim_customer.customer_id`. Every order has a customer that exists."},
  {"label": "Product", "focus": [1, 2], "note": "`fact_orders.product_id` references `dim_product.product_id`. The price lives on the product, not on the order."}]}
```

## 🧪 Try it: create the tables

Run the three steps. Step 1 builds the rows in memory and registers temporary views. Step 2 picks the schema you own. Step 3 is plain SQL you can read: drop, create with a primary key, insert, then add the foreign keys.

```dataset retail
```

```sql run
-- Look at the keys Unity Catalog now knows about
SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = current_schema()
  AND table_name IN ('dim_customer', 'dim_product', 'fact_orders')
ORDER BY table_name, constraint_type;
```

## 💰 Revenue: the one formula to remember

There is no amount column on purpose. Revenue is computed, and the learner has to join to get the price.

```viz code
title: revenue by category
lang: sql
---
SELECT p.category,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o
JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
GROUP BY p.category
ORDER BY revenue DESC
---
2 | revenue | Quantity times list price, minus the discount rate (0.0, 0.10 or 0.25).
3-4 | join | The price comes from the product dimension.
5 | filter | TEST orders are internal and CANCELLED orders never paid. Always exclude both.
```

```sql run
-- Revenue by category (try it)
SELECT p.category,
       count(*) AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o
JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
GROUP BY p.category
ORDER BY revenue DESC;
```

## 🪤 Built-in traps

The data is shaped so that careless queries give wrong answers. That makes it good for teaching.

```viz table
{"title": "fact_orders by status", "columns": ["status", "rows", "share", "what to do"],
 "rows": [["COMPLETED", "52,766", "88%", "count it"], ["OPEN", "2,400", "4%", "count it (not yet shipped)"],
          ["CANCELLED", "3,596", "6%", "exclude from revenue"], ["TEST", "1,238", "2%", "always exclude"]],
 "steps": [
  {"label": "All rows", "note": "A plain `count(*)` gives 60,000. That is not the number of real orders."},
  {"label": "Cancelled", "note": "Cancelled orders were never paid. Leave them out of revenue.", "hl": [2]},
  {"label": "Test", "note": "Internal test orders. Leave them out of everything.", "hl": [3]}]}
```

- **Skew:** product ids 1 to 8 are Books and are ordered far more often (product 1 alone has about 13,900 orders). Electronics (ids 33 to 40) are rare but expensive. Good for join skew and "count vs revenue" discussions.
- **Bad files:** `data.files("retail", ...)` also writes `fact_orders_bad/fact_orders_bad.csv` with four malformed rows (`five` as a quantity, `not-a-date`) for rescued-data and expectations demos.

## 🐍 Use it from Python

One call puts the data where you need it and prints a report: what it created, rows, size and columns.

```python
from databricksedu import data

ds = data.create("retail", CATALOG, SCHEMA)                       # Delta tables with keys (replaces existing)
data.create("retail", CATALOG, SCHEMA, mode="view")               # views over Parquet files in a volume
data.create("retail", CATALOG, SCHEMA, mode="temp_view")          # temporary views, this session only
data.create("retail", CATALOG, SCHEMA, drop_existing=False)       # keep tables that already exist
data.create("retail", CATALOG, SCHEMA, scale=0.1)                 # 6,000 orders instead of 60,000

data.files("retail", CATALOG, SCHEMA, volume="landing", n_files=3)   # 3 new CSV files; run again for more

pdf = ds.to_pandas("fact_orders")              # a pandas DataFrame (no Spark needed)
print(ds.sql())                                # the full CREATE TABLE / key script
ds.drop_tables(CATALOG, SCHEMA)                # clean up (the schema stays)
```

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Real orders | `WHERE status NOT IN ('TEST', 'CANCELLED')` |
| Revenue | `quantity * unit_price * (1 - discount)` |
| Order to customer | `JOIN dim_customer USING (customer_id)` |
| Order to product | `JOIN dim_product USING (product_id)` |
| Smaller data | `data.create("retail", CATALOG, SCHEMA, scale=0.1)` |
| New raw files | `data.files("retail", CATALOG, SCHEMA, volume="landing")` |
| Clean up | `ds.drop_tables()` |
