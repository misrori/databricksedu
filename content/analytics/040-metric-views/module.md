---
title: Metric views
summary: Define a business metric once in Unity Catalog and get the correct number at any grain, in SQL, dashboards and Genie. Build a metric view in YAML, query it with MEASURE(), and see why pre-aggregated views give wrong answers.
icon: 📐
level: Intermediate
minutes: 15
group: Dashboards and Genie
tags: [Metric views, Unity Catalog, Genie, AI/BI dashboards, Semantic layer]
---
# Metric views

> Understand what a Unity Catalog metric view is, why Genie gets more reliable with it, and what is new in AI/BI dashboards (local metric views, export to metric view).

**The one idea to remember:** a metric view lets you define a business metric *once* (for example "net revenue divided by completed orders") in Unity Catalog. Any tool, including Genie, dashboards, SQL, alerts and external BI, can then slice it by *any* dimension, and it always computes correctly.

## 🤔 Why this matters for Genie

When Genie only sees raw tables, it has to **guess** your business logic each time. *Revenue*: gross or net, with cancelled or test orders? *Average order value* is `SUM(revenue) / COUNT(orders)`, not `AVG(price)`. *Active customers* is a `COUNT(DISTINCT ...)`, which **cannot be summed** across months. Each guess lets two users get two different numbers.

```viz compare
{"items": [
  {"icon": "🎲", "title": "Without metric view", "color": "red",
   "points": ["❌ Genie writes the aggregation SQL itself", "❌ Business rules live in instructions and examples", "❌ The same KPI can differ between Genie, dashboards and Excel", "❌ Hard to review"]},
  {"icon": "📐", "title": "With metric view", "color": "green",
   "points": ["✅ Genie picks a measure: `MEASURE(net_revenue)`", "✅ Business rules live in Unity Catalog, in one place", "✅ Same definition everywhere", "✅ Reviewable YAML, permissions, lineage"]}
 ]}
```

## 📐 What is a metric view?

A Unity Catalog object, defined in YAML. Step through its parts.

```viz flow
{"nodes": [
  {"icon": "🗄️", "title": "Source", "sub": "table, view, SQL query or metric view", "color": "navy", "items": ["optional **joins**: star or snowflake"]},
  {"icon": "🚫", "title": "Filter", "sub": "applied to every query", "color": "red"},
  {"icon": "🏷️", "title": "Fields", "sub": "dimensions", "color": "blue"},
  {"icon": "🧮", "title": "Measures", "sub": "aggregate expressions", "color": "purple"},
  {"icon": "❓", "title": "Your query", "sub": "picks the grain", "color": "green"}
 ],
 "edges": ["rows", "kept rows", "group by", "MEASURE()"],
 "steps": [
  {"label": "Source", "focus": [0], "note": "Detail rows come from a table, view, SQL query, or another metric view, optionally with **joins**."},
  {"label": "Filter", "focus": [1], "note": "A condition applied to *every* query, for example `status <> 'TEST'`."},
  {"label": "Fields", "focus": [2], "note": "The attributes you group and filter by (`region`, `order_month`)."},
  {"label": "Measures", "focus": [3], "note": "Aggregate expressions: `SUM(...)`, `COUNT(DISTINCT ...)`, ratios, window measures."},
  {"label": "Query time", "focus": [4], "note": "A **standard view** fixes the aggregation *and* the grouping when you create it. A **metric view** fixes only the **definition**. The grouping is chosen at query time, and the engine generates the correct SQL for that grain."}
 ]}
```

> Metric views are the core of the **Unity Catalog semantics layer** (docs: *UC Semantics, Metric views*).

## 🪤 The classic trap: average of averages

A standard view pre-aggregated per **category x month** holds `avg_order_value` and `unique_customers`. Someone (or Genie) asks: *"What was the average order value and number of customers in 2025?"* Illustrative numbers:

```viz table
{"title": "v_sales_by_category_month, rolled up to the year",
 "columns": ["product_category", "orders", "avg_order_value", "unique_customers"],
 "rows": [["Books", 900, 20.00, 450], ["Electronics", 100, 800.00, 90]],
 "steps": [
  {"label": "The view", "note": "Cheap Books sell often, expensive Electronics rarely. Each row is correct at its own grain."},
  {"label": "AVG / SUM over it", "note": "`AVG(avg_order_value)` gives the 100 Electronics orders the same weight as the 900 Books orders. `SUM(unique_customers)` counts a customer who bought both twice.", "add": [["AVG / SUM of rows", 1000, 410.00, 540]], "hl": [2]},
  {"label": "From detail rows", "note": "Recomputed from the orders: (900 x 20 + 100 x 800) / 1000 = **98.00**, and each customer is counted once. `MEASURE(avg_order_value)` and `MEASURE(unique_customers)` do exactly this, at whatever grain you ask for.", "add": [["MEASURE() from detail", 1000, 98.00, 470]], "del": [2], "hl": [3]}
 ]}
```

## 🧬 Anatomy of a metric view (YAML)

```yaml
version: 1.1
comment: Sales KPIs for the retail demo
source: main.retail.fact_orders
filter: source.status <> 'TEST'          # applied to every query

joins:                                    # star schema, LEFT OUTER, many-to-one by default
  - name: customer
    source: main.retail.dim_customer
    'on': source.customer_id = customer.customer_id
  - name: product
    source: main.retail.dim_product
    'on': source.product_id = product.product_id

fields:                                   # a.k.a. dimensions
  - name: order_month
    expr: DATE_TRUNC('MONTH', source.order_date)
  - name: region
    expr: customer.region
    synonyms: ['market', 'territory']

measures:
  - name: completed_orders
    expr: COUNT(1) FILTER (WHERE source.status = 'COMPLETED')
  - name: net_revenue
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount)) FILTER (WHERE source.status = 'COMPLETED')
    format: {type: currency, currency_code: USD}
  - name: avg_order_value                 # composed from other measures
    expr: MEASURE(net_revenue) / MEASURE(completed_orders)
```

- Quote the `'on'` key, because plain YAML can parse `on` as a boolean.
- `fields` and `dimensions` are synonyms (the UI editor writes `dimensions`).
- Measures may reference earlier fields and measures, and use `MEASURE()` to reference a measure.

## 🛠️ Creating a metric view

```viz code
title: SQL DDL
lang: sql
---
CREATE OR REPLACE VIEW sales_metrics
WITH METRICS
LANGUAGE YAML
AS $$
version: 1.1
source: main.retail.fact_orders
fields:
  - name: order_month
    expr: DATE_TRUNC('MONTH', order_date)
measures:
  - name: order_count
    expr: COUNT(1)
$$;
---
1-3 | WITH METRICS | A normal `CREATE VIEW`, marked as a metric view written in YAML.
4-13 | The YAML | Everything between `$$` and `$$` is the definition.
```

Other ways: the **Catalog Explorer UI** (open a table, **Create > Metric view**; a visual editor with joins, filters, fields, measures, *Preview* and a `<>` YAML tab), and **Genie Code** (describe it in natural language, or import Tableau / Power BI definitions).

**Privileges:** `SELECT` on the sources, `USE CATALOG`, `USE SCHEMA` and `CREATE TABLE` on the target schema, and a SQL warehouse or compute on a supported runtime.

## 🔎 Querying with MEASURE()

```sql
SELECT region,
       order_month,
       MEASURE(net_revenue)      AS net_revenue,
       MEASURE(avg_order_value)  AS aov
FROM sales_metrics
WHERE product_category = 'Electronics'
GROUP BY ALL
ORDER BY order_month;
```

- Every measure **must** be wrapped in `MEASURE()` (on DBR 18.1+, `agg()` works as well).
- **No `SELECT *`**: list fields explicitly.
- **No direct joins** with other tables. Aggregate in a CTE first, then join the CTE.
- `DESCRIBE TABLE EXTENDED sales_metrics AS JSON` shows the full YAML (*View Text*) and per-column metadata.

## 🏷️ Agent metadata: teach Genie your vocabulary

YAML spec **1.1** (DBR 17.3+) adds metadata that downstream tools understand.

```viz code
title: A measure with agent metadata
lang: yaml
---
measures:
  - name: net_revenue
    expr: SUM(source.amount)
    comment: Revenue after discounts, completed orders only
    display_name: Net Revenue
    synonyms: ['revenue', 'sales', 'turnover']
    format:
      type: currency
      currency_code: EUR
      decimal_places: {type: exact, places: 2}
---
2-3 | The measure | Name and aggregate expression.
4 | comment | Business description of the view, field or measure. Used by Genie, Catalog and BI tools.
5 | display_name | Human-friendly label (up to 255 characters) for dashboards and BI tools.
6 | synonyms | Up to 10 alternative names. **Genie imports them automatically.**
7-10 | format | `number`, `currency`, `percentage`, `byte`, `date`, `date_time`. Dashboards apply it automatically.
```

> YAML `#` comments are removed when the definition is saved. Use `comment:` for anything you want to keep.

## 🧪 Try it: the wrong answer

```dataset retail
```

Cheap products are ordered much more often than expensive ones. This skew is what makes the "average of averages" mistake visible.

```sql run
-- Quick look at the skew
SELECT p.category, count(*) AS orders, round(avg(p.unit_price), 2) AS avg_unit_price
FROM fact_orders f JOIN dim_product p USING (product_id)
GROUP BY ALL ORDER BY orders DESC;
```

```sql run
-- A classic pre-aggregated reporting view
CREATE OR REPLACE VIEW mv_v_sales_by_category_month
COMMENT 'Pre-aggregated reporting view at category x month grain'
AS
SELECT
  p.category                                                AS product_category,
  date_trunc('MONTH', f.order_date)                         AS order_month,
  SUM(f.quantity * p.unit_price * (1 - f.discount))         AS net_revenue,
  COUNT(*)                                                  AS completed_orders,
  SUM(f.quantity * p.unit_price * (1 - f.discount)) / COUNT(*) AS avg_order_value,
  COUNT(DISTINCT f.customer_id)                             AS unique_customers
FROM fact_orders f
JOIN dim_product p USING (product_id)
WHERE f.status = 'COMPLETED'
GROUP BY ALL;
```

```sql run
-- Wrong (from the view) vs correct (from detail rows)
WITH from_view AS (
  SELECT 'From pre-aggregated view' AS method,
         round(AVG(avg_order_value), 2) AS avg_order_value,   -- average of averages
         SUM(unique_customers)          AS unique_customers   -- double counts customers
  FROM mv_v_sales_by_category_month
  WHERE year(order_month) = 2025
),
correct AS (
  SELECT 'Correct (detail rows)' AS method,
         round(SUM(f.quantity * p.unit_price * (1 - f.discount)) / COUNT(*), 2),
         COUNT(DISTINCT f.customer_id)
  FROM fact_orders f JOIN dim_product p USING (product_id)
  WHERE f.status = 'COMPLETED' AND year(f.order_date) = 2025
)
SELECT * FROM from_view UNION ALL SELECT * FROM correct;
```

> The view's AOV is far too high, and its customer count is several times larger than the real 500 at most. An LLM writing SQL against this view will happily produce these numbers.

## 🔬 Try it: create the metric view

Source, global filter, two joins, fields with `display_name` and `synonyms`, composed measures and formats. The YAML is built in a Python string so the fully qualified source names can be filled in for your catalog.

```python run
# CREATE VIEW ... WITH METRICS LANGUAGE YAML
S = f"`{CATALOG}`.`{SCHEMA}`"   # used inside the YAML definitions

metric_view_yaml = """
version: 1.1
comment: Retail sales KPIs. Single source of truth for revenue, orders, AOV and customers. TEST orders are always excluded.
source: "__S__.fact_orders"
filter: source.status <> 'TEST'

joins:
  - name: customer
    source: "__S__.dim_customer"
    'on': source.customer_id = customer.customer_id
  - name: product
    source: "__S__.dim_product"
    'on': source.product_id = product.product_id

fields:
  - name: order_date
    expr: source.order_date
    comment: Date the order was placed
    display_name: Order Date
    synonyms: ['date', 'purchase date', 'day']
  - name: order_month
    expr: DATE_TRUNC('MONTH', source.order_date)
    comment: First day of the order month
    display_name: Order Month
    synonyms: ['month']
  - name: order_year
    expr: YEAR(source.order_date)
    display_name: Order Year
    synonyms: ['year']
  - name: order_status
    expr: INITCAP(source.status)
    comment: Completed, Open or Cancelled
    display_name: Order Status
  - name: region
    expr: customer.region
    comment: Sales region of the customer
    display_name: Region
    synonyms: ['market', 'territory', 'geo']
  - name: customer_segment
    expr: customer.segment
    display_name: Customer Segment
    synonyms: ['segment', 'customer type']
  - name: product_category
    expr: product.category
    display_name: Product Category
    synonyms: ['category', 'product line']
  - name: product_name
    expr: product.product_name
    display_name: Product
    synonyms: ['item', 'sku']

measures:
  - name: order_count
    expr: COUNT(1)
    comment: Number of orders in any status (TEST excluded)
    display_name: Orders (all statuses)
  - name: completed_orders
    expr: COUNT(1) FILTER (WHERE source.status = 'COMPLETED')
    comment: Number of completed orders
    display_name: Completed Orders
    synonyms: ['orders', 'number of orders', 'sales count']
  - name: gross_revenue
    expr: SUM(source.quantity * product.unit_price) FILTER (WHERE source.status = 'COMPLETED')
    comment: Revenue before discounts, completed orders only
    display_name: Gross Revenue
    format: {type: currency, currency_code: USD, decimal_places: {type: exact, places: 2}, abbreviation: compact}
  - name: net_revenue
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount)) FILTER (WHERE source.status = 'COMPLETED')
    comment: Revenue after discounts, completed orders only. This is THE revenue KPI.
    display_name: Net Revenue
    synonyms: ['revenue', 'sales', 'turnover', 'income']
    format: {type: currency, currency_code: USD, decimal_places: {type: exact, places: 2}, abbreviation: compact}
  - name: avg_order_value
    expr: MEASURE(net_revenue) / MEASURE(completed_orders)
    comment: Net revenue divided by completed orders
    display_name: Average Order Value
    synonyms: ['AOV', 'average basket', 'average order size']
    format: {type: currency, currency_code: USD, decimal_places: {type: exact, places: 2}}
  - name: unique_customers
    expr: COUNT(DISTINCT source.customer_id) FILTER (WHERE source.status = 'COMPLETED')
    comment: Distinct customers with at least one completed order
    display_name: Unique Customers
    synonyms: ['active customers', 'buyers', 'customer count']
  - name: revenue_per_customer
    expr: MEASURE(net_revenue) / MEASURE(unique_customers)
    display_name: Revenue per Customer
    format: {type: currency, currency_code: USD, decimal_places: {type: exact, places: 2}}
  - name: discount_rate
    expr: 1 - MEASURE(net_revenue) / MEASURE(gross_revenue)
    comment: Share of gross revenue given away as discount
    display_name: Discount Rate
    format: {type: percentage, decimal_places: {type: max, places: 1}}
  - name: cancellation_rate
    expr: COUNT(1) FILTER (WHERE source.status = 'CANCELLED') / COUNT(1)
    comment: Cancelled orders divided by all orders
    display_name: Cancellation Rate
    synonyms: ['cancel rate', 'churned orders share']
    format: {type: percentage, decimal_places: {type: max, places: 1}}
""".replace("__S__", S)

spark.sql(f"""
CREATE OR REPLACE VIEW {S}.mv_sales_metrics
WITH METRICS
LANGUAGE YAML
AS $$
{metric_view_yaml}
$$
""")
print(f"Created metric view {S}.mv_sales_metrics")
```

```sql run
-- Same question as before, correct answer
SELECT
  round(MEASURE(avg_order_value), 2) AS avg_order_value,
  MEASURE(unique_customers)          AS unique_customers
FROM mv_sales_metrics
WHERE order_year = 2025;
```

> Open **Catalog**, your catalog and schema, then `mv_sales_metrics`. The **Overview** tab lists fields and measures, and **Edit** opens the visual editor (with a `<>` YAML tab).

## 📊 Try it: any grain, same definition

```sql run
-- By category
SELECT
  product_category,
  MEASURE(completed_orders)               AS completed_orders,
  round(MEASURE(net_revenue), 0)          AS net_revenue,
  round(MEASURE(avg_order_value), 2)      AS avg_order_value,
  round(MEASURE(discount_rate) * 100, 1)  AS discount_rate_pct
FROM mv_sales_metrics
WHERE order_year = 2025
GROUP BY ALL
ORDER BY net_revenue DESC;
```

```sql run
-- By region and segment, with a filter on a joined dimension
SELECT
  region,
  customer_segment,
  MEASURE(unique_customers)                 AS customers,
  round(MEASURE(revenue_per_customer), 2)   AS revenue_per_customer,
  round(MEASURE(cancellation_rate) * 100, 1) AS cancellation_rate_pct
FROM mv_sales_metrics
WHERE product_category = 'Electronics'
GROUP BY ALL
ORDER BY region, customer_segment;
```

```sql run
-- CTE pattern for joins: metric views can't be joined directly
WITH revenue_by_region AS (
  SELECT region, MEASURE(net_revenue) AS net_revenue
  FROM mv_sales_metrics
  WHERE order_year = 2025
  GROUP BY region
),
targets AS (
  SELECT * FROM VALUES ('EMEA', 4500000), ('North America', 3000000), ('APAC', 1700000), ('LATAM', 800000) AS t(region, target)
)
SELECT r.region, round(r.net_revenue) AS net_revenue, t.target,
       round(r.net_revenue / t.target * 100, 1) AS pct_of_target
FROM revenue_by_region r JOIN targets t USING (region)
ORDER BY pct_of_target DESC;
```

```sql run
-- Inspect the definition: the full YAML (View Text) and the metadata Genie reads
DESCRIBE TABLE EXTENDED mv_sales_metrics;

-- What fails? Uncomment to see: no SELECT *, and no measure without MEASURE()
-- SELECT * FROM mv_sales_metrics;
-- SELECT region, SUM(net_revenue) FROM mv_sales_metrics GROUP BY region;
```

## 🪟 Composability and window measures

**Composability:** build measures on measures, for example `revenue_per_customer` as `MEASURE(net_revenue) / MEASURE(unique_customers)`. **Window measures** cover trailing, cumulative, and period-over-period values:

```yaml
  - name: revenue_trailing_7d
    expr: SUM(source.amount)
    window:
      - order: order_date        # a field of the metric view
        range: trailing 7 day    # current | cumulative | trailing n unit | leading n unit | all
        semiadditive: last
```

- `trailing` / `leading` are **exclusive** of the current row by default. `inclusive` needs DBR 18.1+ and spec 1.1.
- `offset: -12 month` gives "same period last year" (DBR 18.1+, spec 1.1).
- `semiadditive: last`: when you do not group by the window's `order` field, the value of the last period is returned.

## 📈 Try it: trailing and cumulative revenue

`range: trailing 7 day` covers the previous 7 days, **excluding** the current day. `range: cumulative` is a running total up to and including the current day. They go in a separate metric view, so the main one stays simple.

```python run
# Metric view with window measures
window_yaml = """
version: 1.1
comment: Daily revenue with trailing and cumulative window measures
source: "__S__.fact_orders"
filter: source.status = 'COMPLETED'
joins:
  - name: product
    source: "__S__.dim_product"
    'on': source.product_id = product.product_id
fields:
  - name: order_date
    expr: source.order_date
    display_name: Order Date
measures:
  - name: daily_revenue
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount))
    display_name: Daily Net Revenue
  - name: revenue_trailing_7d
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount))
    display_name: Net Revenue (trailing 7 days)
    window:
      - order: order_date
        range: trailing 7 day
        semiadditive: last
  - name: revenue_cumulative
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount))
    display_name: Net Revenue (cumulative)
    window:
      - order: order_date
        range: cumulative
        semiadditive: last
""".replace("__S__", S)

spark.sql(f"""
CREATE OR REPLACE VIEW {S}.mv_sales_metrics_daily
WITH METRICS
LANGUAGE YAML
AS $$
{window_yaml}
$$
""")

display(spark.sql("""
SELECT order_date,
       round(MEASURE(daily_revenue))        AS daily_revenue,
       round(MEASURE(revenue_trailing_7d))  AS revenue_trailing_7d,
       round(MEASURE(revenue_cumulative))   AS revenue_cumulative
FROM mv_sales_metrics_daily
GROUP BY ALL
ORDER BY order_date DESC
LIMIT 14
"""))
```

## 🚀 Advanced features (good to know)

| Feature | What | Min. runtime |
|---|---|---|
| **Snowflake joins** | Nested `joins` (e.g. `customer.nation.n_name`) | DBR 17.3 |
| **Materialization** | Pre-computed aggregates with automatic query rewrite, `schedule: every 6 hours` | DBR 17.3 |
| **Parameters** | `sales_metrics(discount => 0.2)`, queried as a table-valued function | DBR 18.2 |
| **Wildcards** | `- expr: source.* EXCEPT (comment)` | DBR 18.2 |
| **One-to-many joins** | `cardinality: one_to_many` | DBR 18.1 |
| **Relationships** (Beta) | Declare how metric views relate, so agents pick the right join path | DBR 19 |

SQL warehouses and serverless compute update automatically, so they normally have the newest features.

## 📊 Metric views in AI/BI dashboards

Three ways to use them (**Data** tab, **Add data**). In dashboards, `MEASURE()` is applied automatically.

```viz compare
{"items": [
  {"icon": "📐", "title": "UC metric view as a dataset", "color": "blue",
   "points": ["Every dimension and measure, with display names and formats", "❌ Can't change the dataset query (no filters or column pruning)", "✅ Can add custom calculations"]},
  {"icon": "📝", "title": "SQL dataset over a metric view", "color": "purple",
   "points": ["For filters or reshaping", "Measures go through `MEASURE()`", "Parameters, e.g. `sales_metrics(discount => :discount)` linked to a filter widget"]},
  {"icon": "🧪", "title": "Local metric view", "color": "amber",
   "points": ["Dimensions, measures and joins **scoped to the dashboard**", "Nothing is published to Unity Catalog", "Picking a table or view as the source opens its editor"]}
 ]}
```

**Export as a metric view (Public Preview):** dataset kebab menu, *Create Metric View*, pick catalog and schema, optionally edit the YAML, **Save**. Measures and dimensions on the dataset are carried over. This **promotes** a dashboard-only definition into a governed UC metric view that Genie can use as well.

## ⚖️ UC metric view vs local metric view vs custom calculation

| | **UC metric view** | **Dashboard local metric view** | **Custom calculation** |
|---|---|---|---|
| Lives in | Unity Catalog | One dashboard | One dashboard dataset |
| Reusable by Genie, SQL, BI, alerts | ✅ | ❌ (until exported) | ❌ |
| Governed (permissions, lineage, tags) | ✅ | Dashboard permissions | Dashboard permissions |
| Who creates it | Data / analytics engineers | Dashboard author | Dashboard author |
| Best for | Company-wide KPIs | Prototyping, dashboard-specific logic | Quick one-off metric or LOD expression |

**Typical lifecycle:** prototype as a *local metric view*, validate with stakeholders, **Export as metric view**, then add it to a **Genie Agent**.

## 🧞 Metric views and Genie Agents

*Genie Agents were formerly known as Genie Spaces*; the course may still say "Genie space". Add a metric view like a table (**up to 50 tables, views or metric views** per agent, on a **pro or serverless SQL warehouse**). Genie generates `MEASURE(...)` queries and **imports synonyms automatically**. The reverse also works: kebab menu, *Export to metric view*.

```viz timeline
{"title": "Recommended pattern for reliable agents",
 "items": [
  {"label": "1", "title": "Model the KPIs", "color": "purple", "note": "Model the KPIs in a metric view, with comments, synonyms and formats."},
  {"label": "2", "title": "Give Genie the metric view", "color": "blue", "note": "Give the Genie Agent the **metric view**, and only the raw tables it really needs."},
  {"label": "3", "title": "Short instructions", "color": "teal", "note": "Keep instructions short, focused on *business context*, not on SQL formulas. For example: *\"Revenue\" always means net revenue.*"},
  {"label": "4", "title": "Benchmarks", "color": "green", "note": "Add **benchmarks** with questions whose expected SQL uses `MEASURE()`, so you can re-test after every change."}
 ]}
```

## 🚧 Requirements and limitations

| Topic | Requirement or limit |
|---|---|
| Platform | **Unity Catalog** required. Introduced in **DBR 16.4**; agent metadata (spec 1.1) needs **DBR 17.3+**. Works on **SQL warehouses** and **serverless compute**, which always run a recent version |
| Querying | `MEASURE()` is mandatory, `SELECT *` is not allowed, and direct joins are not allowed (use a CTE) |
| Joined tables | Can't contain `MAP` columns |
| Star joins | `LEFT OUTER`. With `many_to_one`, a many-to-many match uses the **first** matching row, so model your keys carefully |
| `rely.at_most_one_match: true` | An optimization that is **not validated**. A wrong value causes wrong `SUM` / `COUNT` |
| Materialization | Can't be combined with parameters |

## ✅ Best practices

| Practice | Why |
|---|---|
| **Name for humans and LLMs:** `net_revenue`, not `m_rev_2`, plus `display_name`, `synonyms` and `comment` everywhere | Comments are the cheapest accuracy boost for Genie |
| **Business rules in the definition:** global `filter` for exclusions (test data), `FILTER (WHERE ...)` for measure-level rules | Every query applies them |
| **Ratio measures composed from base measures** | Never pre-aggregate ratios |
| **PK/FK constraints with `RELY`** on source tables | Genie and the optimizer both benefit |
| **One metric view per business process** (sales, support tickets, inventory) | Not one giant view |
| **Version control:** YAML in Git, deployed with SQL or bundles | Reviewable, repeatable changes |

## 💬 Questions learners ask

| Question | Answer |
|---|---|
| "Isn't this just a view?" | No. A view fixes the GROUP BY, while a metric view lets the query decide it and still computes non-additive measures correctly |
| "Do I still need Genie instructions?" | Yes, but fewer. Use them for business context and terminology, and put formulas in the metric view |
| "Can Power BI or Tableau use it?" | Yes: Tableau and Sigma through custom SQL or BI compatibility mode, Power BI through semantic models (Private Preview) or custom SQL. Excel and Google Sheets too |
| "Performance?" | Materialization can pre-compute aggregations, and queries are rewritten automatically |
| "Local vs UC metric view?" | Local is a dashboard-only sandbox. UC is the governed, shared definition |

## Exercise 1: distinct counts do not add up

Build a small metric view with one distinct-count measure. **Predict first:** for 2025, is the sum of the twelve monthly `unique_customers` values bigger or smaller than the yearly value, and roughly by how much?

```python todo
# TODO 1: create the metric view mv_customer_metrics on fact_orders, TEST orders filtered out,
#         with fields order_month and order_year, and a measure unique_customers (COUNT(DISTINCT ...))
# TODO 2: sum MEASURE(unique_customers) per order_month over 2025
# TODO 3: compare with MEASURE(unique_customers) for the whole of 2025
S = f"`{CATALOG}`.`{SCHEMA}`"
```

```python solution
S = f"`{CATALOG}`.`{SCHEMA}`"
customer_yaml = """
version: 1.1
source: "__S__.fact_orders"
filter: source.status <> 'TEST'
fields:
  - name: order_month
    expr: DATE_TRUNC('MONTH', source.order_date)
  - name: order_year
    expr: YEAR(source.order_date)
measures:
  - name: unique_customers
    expr: COUNT(DISTINCT source.customer_id)
""".replace("__S__", S)

spark.sql(f"""
CREATE OR REPLACE VIEW {S}.mv_customer_metrics
WITH METRICS
LANGUAGE YAML
AS $$
{customer_yaml}
$$
""")

display(spark.sql("""
WITH monthly AS (
  SELECT order_month, MEASURE(unique_customers) AS customers
  FROM mv_customer_metrics WHERE order_year = 2025 GROUP BY ALL
),
yearly AS (
  SELECT MEASURE(unique_customers) AS whole_year
  FROM mv_customer_metrics WHERE order_year = 2025
)
SELECT m.sum_of_months, y.whole_year
FROM (SELECT sum(customers) AS sum_of_months FROM monthly) m CROSS JOIN yearly y
"""))
# The sum of the months is many times larger: the same customer buys in many months.
# The yearly value can never exceed the 500 customers in dim_customer.
```

## Exercise 2: a ratio that survives any grain

Create `mv_category_metrics` with a join to `dim_product` and the measures `completed_orders`, `net_revenue` and a composed `avg_order_value`. **Predict first:** will the overall AOV be above or below the plain average of the five category AOVs, and why?

```python todo
# TODO 1: create mv_category_metrics: source fact_orders, filter out TEST, join product,
#         field product_category, measures completed_orders, net_revenue, avg_order_value
# TODO 2: query MEASURE(avg_order_value) per product_category
# TODO 3: query the overall MEASURE(avg_order_value) and the AVG of the per-category values
S = f"`{CATALOG}`.`{SCHEMA}`"
```

```python solution
S = f"`{CATALOG}`.`{SCHEMA}`"
category_yaml = """
version: 1.1
source: "__S__.fact_orders"
filter: source.status <> 'TEST'
joins:
  - name: product
    source: "__S__.dim_product"
    'on': source.product_id = product.product_id
fields:
  - name: product_category
    expr: product.category
measures:
  - name: completed_orders
    expr: COUNT(1) FILTER (WHERE source.status = 'COMPLETED')
  - name: net_revenue
    expr: SUM(source.quantity * product.unit_price * (1 - source.discount)) FILTER (WHERE source.status = 'COMPLETED')
  - name: avg_order_value
    expr: MEASURE(net_revenue) / MEASURE(completed_orders)
""".replace("__S__", S)

spark.sql(f"""
CREATE OR REPLACE VIEW {S}.mv_category_metrics
WITH METRICS
LANGUAGE YAML
AS $$
{category_yaml}
$$
""")

display(spark.sql("SELECT product_category, round(MEASURE(avg_order_value), 2) AS aov FROM mv_category_metrics GROUP BY ALL ORDER BY aov"))
display(spark.sql("""
WITH per_category AS (
  SELECT product_category, MEASURE(avg_order_value) AS aov FROM mv_category_metrics GROUP BY ALL
),
overall AS (
  SELECT MEASURE(avg_order_value) AS aov FROM mv_category_metrics
)
SELECT a.average_of_averages, round(o.aov, 2) AS correct_overall_aov
FROM (SELECT round(avg(aov), 2) AS average_of_averages FROM per_category) a CROSS JOIN overall o
"""))
# The correct overall AOV is well below the average of averages: most orders are cheap ones,
# and the measure weights every order equally instead of every category.

# Clean up the demo objects when you are done (your schema itself is kept)
# for obj in ["mv_category_metrics", "mv_customer_metrics", "mv_sales_metrics_daily", "mv_sales_metrics", "mv_v_sales_by_category_month"]:
#     spark.sql(f"DROP VIEW IF EXISTS {S}.{obj}")
```

## ⚠️ Common mistakes

- ❌ `AVG()` over a pre-aggregated ratio column, or `SUM()` over a distinct count. Both are wrong at any other grain.
- ❌ `SELECT *` or `SUM(net_revenue)` on a metric view. Wrap measures in `MEASURE()` and list fields.
- ❌ Documenting with YAML `#` comments. They are removed on save; use `comment:`.
- ❌ An unquoted `on` key in `joins`. Plain YAML can read it as a boolean; write `'on'`.
- ❌ Setting `rely.at_most_one_match: true` without checking the keys. It is not validated.
- ✅ Give Genie the metric view and only the raw tables it really needs.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Define a KPI once | `CREATE OR REPLACE VIEW ... WITH METRICS LANGUAGE YAML AS $$ ... $$` |
| Query a measure at any grain | `SELECT field, MEASURE(m) FROM mv GROUP BY ALL` |
| Join with another table | Aggregate the metric view in a CTE, then join the CTE |
| See the YAML and metadata | `DESCRIBE TABLE EXTENDED mv AS JSON` |
| Teach Genie your vocabulary | `comment`, `display_name`, `synonyms`, `format` |
| Rolling or running totals | `window:` with `range: trailing 7 day` or `range: cumulative` |

Further reading on docs.databricks.com: [Metric views](https://docs.databricks.com/aws/en/metric-views/) · [YAML reference](https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference) · [Query metric views](https://docs.databricks.com/aws/en/uc-semantics/metric-views/query) · [Agent metadata](https://docs.databricks.com/aws/en/uc-semantics/agent-metadata) · [Feature availability](https://docs.databricks.com/aws/en/uc-semantics/metric-views/feature-availability) · [Dashboard datasets](https://docs.databricks.com/aws/en/dashboards/manage/data-modeling/datasets) · [Genie Agents setup](https://docs.databricks.com/aws/en/genie-agents/set-up)
