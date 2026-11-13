---
title: Genie spaces
summary: See how Genie turns a business question into SQL, what context makes its answers right, and how to prepare tables, comments, keys and example queries so a space is accurate from day one.
icon: 🧞
level: Beginner
minutes: 10
group: Dashboards and Genie
tags: [AI/BI, Genie, Unity Catalog, Metadata, Semantic layer]
---
# Genie spaces

> A **Genie space** lets business users ask questions in plain language. Genie writes the SQL over a few curated tables, runs it, and shows both the answer and the SQL.

**The one idea to remember:** Genie is only as good as the **context** you give it. A few well-described tables, keys, example queries and clear definitions beat a large, silent schema.

## 💡 From question to answer

Genie does not guess from the data alone. It assembles context, writes SQL, and runs it with the asking user's permissions. Step through one question.

```viz flow
{"title": "\"What was net revenue per region last quarter?\"",
 "nodes": [{"icon": "💬", "title": "Question", "sub": "plain language", "color": "blue"},
           {"icon": "🧱", "title": "Context", "sub": "tables, comments, instructions, examples", "color": "purple"},
           {"icon": "✍️", "title": "SQL generation", "sub": "LLM writes a query", "color": "amber"},
           {"icon": "🏭", "title": "Execution", "sub": "SQL warehouse, user's UC rights", "color": "teal"},
           {"icon": "📊", "title": "Answer", "sub": "table or chart, plus the SQL", "color": "green"}],
 "edges": ["", "", "run", ""],
 "steps": [
  {"label": "Ask", "focus": [0], "note": "The user types a question. Words like \"net revenue\" and \"last quarter\" have no meaning yet."},
  {"label": "Assemble context", "focus": [0, 1], "note": "Genie collects the table and column descriptions, keys, the space instructions, matching example SQL and sampled column values (so \"Electronics\" maps to `category`)."},
  {"label": "Write SQL", "focus": [1, 2], "note": "If an **example query** or **SQL function** matches, Genie uses it and marks the answer as a trusted asset. Otherwise it writes new SQL from the context."},
  {"label": "Run", "focus": [2, 3], "note": "The SQL runs on the space's warehouse with the **user's own** Unity Catalog permissions. Row filters and column masks apply."},
  {"label": "Answer", "focus": [3, 4], "note": "The user sees the result and the generated SQL, and can rate it. Ratings help authors, but they do not retrain anything by themselves."}
 ]}
```

## 🧱 The context Genie uses

Each layer narrows what a question can mean. Authors fill in the lower layers first: they help every question.

```viz layers
{"layers": [
  {"icon": "💬", "title": "General instructions", "sub": "short text: vocabulary, conventions", "color": "gray", "items": ["\"fiscal year starts in July\"", "\"always exclude TEST orders\""]},
  {"icon": "✅", "title": "Trusted assets", "sub": "example SQL queries and SQL functions", "color": "green", "items": ["vetted, can take parameters", "reused when a question matches"]},
  {"icon": "📐", "title": "SQL expressions and metric views", "sub": "measures, filters, dimensions defined once", "color": "teal", "items": ["net_revenue", "active_customer"]},
  {"icon": "🔎", "title": "Value sampling and entity matching", "sub": "real values of key columns", "color": "blue", "items": ["\"electronics\" matches Electronics"]},
  {"icon": "🗂️", "title": "Unity Catalog metadata", "sub": "the foundation", "color": "purple", "items": ["table and column comments", "primary and foreign keys", "clear column names"]}
 ]}
```

Prefer good metadata and SQL definitions over long text instructions. Long, conflicting instructions make answers worse.

## 🎯 Vague space or curated space

```viz compare
{"title": "Same data, two spaces",
 "items": [
  {"icon": "🌫️", "title": "Vague space", "sub": "\"add the whole schema\"", "color": "red",
   "points": ["❌ 40 tables, many with similar columns", "❌ no comments, cryptic names like `amt2`", "❌ \"revenue\" means three different things", "❌ no examples: every answer is a fresh guess"], "foot": "plausible SQL, wrong numbers"},
  {"icon": "🎯", "title": "Curated space", "sub": "one topic, one audience", "color": "green",
   "points": ["✅ 3 to 5 tables or views, pre-joined where useful", "✅ comments on every table and key column", "✅ PK and FK constraints declared", "✅ example SQL for the top questions"], "foot": "consistent, checkable answers"}
 ]}
```

A space can hold up to about 50 tables, but best practice is **five or fewer**. Genie is not a search engine over a whole lakehouse.

## 📐 Metric views: definitions in one place

A **metric view** defines measures (`net_revenue`) and dimensions once, in Unity Catalog. Add it to the space and Genie queries the measure instead of re-deriving the formula. The same definition then feeds dashboards and alerts too. See the module **Metric views** for how to build one.

| Where a definition lives | Who reuses it |
|---|---|
| Text instruction | Genie only, and only as a hint |
| Example SQL query | Genie, for questions that match it |
| SQL expression in the space | Genie, as a reusable measure or filter |
| Metric view in Unity Catalog | Genie, dashboards, alerts, any SQL |

## 📏 Benchmarks: measure, do not guess

A **benchmark** is a list of test questions with the correct SQL. Run it after every change to the space and you get an accuracy score instead of a feeling.

```viz table
{"title": "Benchmark run for a sales space",
 "columns": ["Question", "Expected answer", "Genie", "Result"],
 "rows": [["Net revenue in 2025?", "rule: no TEST, no CANCELLED", "summed all rows", "❌"],
          ["Top 5 customers by revenue", "5 rows by net revenue", "5 rows", "✅"],
          ["How many active customers?", "orders in last 90 days", "all customers", "❌"],
          ["Revenue by category", "5 categories", "5 categories", "✅"]],
 "steps": [
  {"label": "First run", "note": "Two of four questions are wrong. Both times the SQL **looks** fine but uses the wrong definition. Accuracy: 50 %."},
  {"label": "Find the cause", "note": "The space never says what net revenue or an active customer is. Genie made a reasonable guess.", "hl": [0, 2]},
  {"label": "Add knowledge", "note": "The author adds two example SQL queries with the business definitions, and a comment on `status`.", "upd": {"0": {"Genie": "uses the example query"}, "2": {"Genie": "uses the example query"}}},
  {"label": "Re-run", "note": "All four pass. Keep the benchmark and re-run it after every change, so a fix for one question does not break another.", "upd": {"0": {"Result": "✅"}, "2": {"Result": "✅"}}}
 ]}
```

## 🔐 Permissions and limits

| Who | Needs |
|---|---|
| **Author** | Databricks SQL access, **CAN USE** on a pro or serverless warehouse, `SELECT` on the data, CAN EDIT on the space |
| **End user** | CAN VIEW or CAN RUN on the space, and `SELECT` on the underlying data. No warehouse permission |
| **Everyone** | Answers respect Unity Catalog: a user never sees data they cannot query directly |

Genie spaces are now also called **Genie Agents** in the documentation. The ideas are the same.

## 🧪 Try it: describe the data

```dataset retail
```

The dataset ships with basic comments. Make them say what a business user means, then check the keys Genie will see.

```sql run
-- Business descriptions on the table and the columns that carry rules
COMMENT ON TABLE fact_orders IS 'One row per order. Net revenue = quantity * dim_product.unit_price * (1 - discount). Always exclude status TEST and CANCELLED.';
ALTER TABLE fact_orders ALTER COLUMN status   COMMENT 'Order status: COMPLETED, OPEN, CANCELLED, TEST. TEST rows are internal and never count. CANCELLED orders earn no revenue.';
ALTER TABLE fact_orders ALTER COLUMN discount COMMENT 'Discount rate between 0 and 1. 0.25 means 25 % off the list price.';
ALTER TABLE dim_product ALTER COLUMN unit_price COMMENT 'List price per unit in USD, before discount.';

DESCRIBE TABLE fact_orders;
```

```sql run
-- Primary and foreign keys tell Genie how to join
SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = current_schema()
  AND table_name IN ('fact_orders', 'dim_customer', 'dim_product')
ORDER BY table_name, constraint_type;
```

## 🔬 Try it: example SQL with definitions

These are the queries you paste into the space as **example SQL**. Each one fixes a business definition.

```sql run
-- Example SQL: "net revenue by month"
SELECT date_trunc('MONTH', o.order_date) AS month,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS net_revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
GROUP BY ALL ORDER BY month;
```

```sql run
-- Example SQL: "how many active customers?" (a valid order in the last 90 days of data)
SELECT count(DISTINCT customer_id) AS active_customers
FROM fact_orders
WHERE status NOT IN ('TEST', 'CANCELLED')
  AND order_date > date_sub((SELECT max(order_date) FROM fact_orders), 90);
```

> **Create the space (UI):** 1. **Genie → New**. 2. Add `fact_orders`, `dim_customer`, `dim_product`. 3. Pick a pro or serverless warehouse. 4. Add two lines of general instructions. 5. Paste the example queries with the question each answers. 6. Add sample questions, ask them yourself and check the SQL. 7. Add a benchmark, then share the space with CAN RUN.

## Exercise 1: a third definition

Business users ask about "average order value by segment". Write the example SQL query, with the definition (net revenue per valid order) made explicit in a comment, so Genie can reuse it.

```sql todo
-- TODO: average order value per customer segment
-- definition: net revenue / number of valid orders (no TEST, no CANCELLED)
```

```sql solution
-- Average order value = net revenue / valid orders, per customer segment
SELECT c.segment,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)) / count(DISTINCT o.order_id), 2) AS avg_order_value
FROM fact_orders o
JOIN dim_product  p ON o.product_id  = p.product_id
JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
GROUP BY c.segment
ORDER BY avg_order_value DESC;
```

## Exercise 2: catch a wrong answer

Pretend Genie answered "net revenue in 2025" with the query below. Run it, then write the correct version and explain the difference in a comment. This is how you build a benchmark entry.

```sql todo
-- Genie's answer (run it):
SELECT round(sum(o.quantity * p.unit_price), 2) AS net_revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE year(o.order_date) = 2025;
-- TODO: write the correct query and explain the two mistakes
```

```sql solution
SELECT round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS net_revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE year(o.order_date) = 2025
  AND o.status NOT IN ('TEST', 'CANCELLED');
-- Mistake 1: no discount, so it is gross, not net revenue.
-- Mistake 2: TEST and CANCELLED orders were counted.
-- Fix in the space: example SQL for this question plus the comment on status.
```

## ⚠️ Common mistakes

- ❌ Adding every table of a schema "so Genie can answer anything". Start with five or fewer.
- ❌ Fixing wrong answers with ever longer text instructions. Add example SQL, SQL expressions and comments.
- ❌ Expecting user feedback to retrain the space. Authors must act on it.
- ❌ Giving end users CAN USE on the warehouse. They need access to the space and `SELECT` on the data.
- ✅ Declare primary and foreign keys and comment the columns that carry business rules.
- ✅ Keep a benchmark and re-run it after every change.

## 🧭 Cheat sheet

| I want to… | Do this |
|---|---|
| Describe a table or column | `COMMENT ON TABLE t IS '…'`, `ALTER TABLE t ALTER COLUMN c COMMENT '…'` |
| Show Genie how tables join | Primary and foreign key constraints |
| Fix a business definition | Example SQL query, SQL expression or metric view |
| Measure accuracy | Benchmark questions with correct SQL |
| Restrict what users see | Unity Catalog grants, row filters, masks |
| Check the keys | `information_schema.table_constraints` |
