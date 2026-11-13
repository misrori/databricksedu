---
title: AI/BI dashboards
summary: Build a dashboard the way Databricks does it. Write the datasets, put widgets on the canvas, wire filters and parameters, then publish with the right credentials and keep it fresh.
icon: 📊
level: Beginner
minutes: 10
group: Dashboards and Genie
tags: [AI/BI, Dashboards, Databricks SQL, Parameters, Alerts]
---
# AI/BI dashboards

> An AI/BI dashboard is a set of **SQL datasets** and a **canvas** of widgets that read from them. Get the datasets right and the charts almost build themselves.

**The one idea to remember:** widgets never query tables directly. Each one reads a **dataset**, and filters, parameters and credentials decide what that dataset returns for each viewer.

## 💡 Two halves: data and canvas

A dashboard has a **Data** tab and a **Canvas**. Datasets are tables, views, metric views or your own SQL. The canvas holds pages of widgets.

```viz tree
{"title": "Inside one dashboard",
 "root": {"icon": "📊", "label": "Sales overview", "sub": "a .lvdash.json file in the workspace", "color": "navy", "children": [
   {"icon": "🗃️", "label": "Data", "sub": "datasets", "color": "purple", "children": [
     {"icon": "🧾", "label": "order_lines", "sub": "custom SQL with a :segment parameter", "color": "purple"},
     {"icon": "📋", "label": "dim_customer", "sub": "a table used directly", "color": "purple"}
   ]},
   {"icon": "🖼️", "label": "Canvas", "sub": "pages of widgets", "color": "blue", "children": [
     {"icon": "📄", "label": "Page: Overview", "color": "blue", "children": [
       {"icon": "🔢", "label": "Counter: revenue", "sub": "reads order_lines", "color": "teal"},
       {"icon": "📈", "label": "Line: revenue by month", "sub": "reads order_lines", "color": "teal"},
       {"icon": "🎛️", "label": "Filter: region", "sub": "field filter on order_lines", "color": "amber"}
     ]},
     {"icon": "📄", "label": "Page: Customers", "sub": "table of top customers", "color": "blue"}
   ]}
 ]}}
```

One dataset can feed many widgets. Each widget asks the dataset for the aggregation it needs, so the business rules live in **one** place.

## 🔁 From tables to a viewer

Step through the path a number takes before a viewer sees it.

```viz flow
{"title": "How a dashboard gets its numbers",
 "nodes": [{"icon": "📚", "title": "Tables", "sub": "fact_orders, dim_product", "color": "gray"},
           {"icon": "🧾", "title": "Dataset query", "sub": "joins, rules, :params", "color": "purple"},
           {"icon": "📈", "title": "Widgets", "sub": "charts, counters, tables", "color": "teal"},
           {"icon": "🚀", "title": "Published version", "sub": "a snapshot of the draft", "color": "navy"},
           {"icon": "👀", "title": "Viewer", "sub": "picks filter values", "color": "blue"}],
 "edges": ["SQL on a warehouse", "aggregate per widget", "publish", "open, filter"],
 "steps": [
  {"label": "Dataset", "focus": [0, 1], "note": "The dataset query joins the tables and applies the rules once: drop TEST and CANCELLED orders, compute revenue."},
  {"label": "Widgets", "focus": [1, 2], "note": "Each widget turns the dataset into its own aggregate, for example revenue per month. They all share the same definitions."},
  {"label": "Publish", "focus": [2, 3], "note": "You edit a **draft**. Viewers only see the **published** version, so draft changes are invisible until you publish again."},
  {"label": "View and filter", "focus": [3, 4], "note": "The viewer picks a region. The filter is applied to the dataset result and every widget on the page that uses that field updates."},
  {"label": "Cross-filter", "focus": [2, 4], "note": "Clicking a bar in one chart filters the other charts built on the same dataset. No extra setup is needed."}
 ]}
```

## 🎛️ Filters or parameters?

Both show up as a control on the canvas. They work at different points.

```viz compare
{"title": "Field filter vs query parameter",
 "items": [
  {"icon": "🎛️", "title": "Field filter", "sub": "filters dataset columns", "color": "teal",
   "points": ["Applied to the **result** of the dataset", "No change to the SQL", "Can apply to one page or all pages (global)", "✅ usually faster on large data"], "foot": "most dashboard filters"},
  {"icon": "🧩", "title": "Query parameter", "sub": ":name inside the SQL", "color": "purple",
   "points": ["Changes the **query itself**, before aggregation", "Types: string, number, date, date range", "Needed in a `WHERE` before `GROUP BY`, a function argument or a `LIMIT`", "❌ every new value runs a new query"], "foot": "when the value must reach the SQL"}
 ]}
```

## 🧾 A dataset with a parameter

This is a dataset query with two parameters: a date range and a customer segment. Walk through it.

```viz code
title: dataset: order_lines
lang: sql
---
SELECT date_trunc('MONTH', o.order_date) AS month,
       c.region, c.segment, p.category,
       o.quantity * p.unit_price * (1 - o.discount) AS revenue
FROM fact_orders o
JOIN dim_product  p ON o.product_id  = p.product_id
JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
  AND o.order_date BETWEEN :order_period.min AND :order_period.max
  AND (:segment = 'All' OR c.segment = :segment)
---
1-3 | Columns | Keep it at row level with clean dimensions. Widgets aggregate it themselves.
4-6 | Joins | One place for the star schema joins, so no widget repeats them.
7 | Business rule | Test and cancelled orders never reach any chart.
8 | Date range parameter | A date range parameter exposes `.min` and `.max`. The value goes into the SQL before any aggregation.
9 | Single value parameter | Default value `All` keeps every segment; any other value filters. A filter widget on the canvas sets it.
```

Define each parameter in the dataset (keyword, type, default), test it in the Data tab, then bind a filter widget to it.

## 🔐 Publishing: whose credentials?

When you publish, you choose whose permissions the dataset queries run with.

| Option | Queries run as | The viewer sees |
|---|---|---|
| **Share data permissions** (embedded credentials, default) | The publisher | Everything the publisher can read, even without own access |
| **Individual data permissions** | Each viewer | Only data they have `SELECT` on; row filters and masks apply per person |

Then share the dashboard itself: **CAN VIEW**, **CAN RUN**, **CAN EDIT**, **CAN MANAGE**, to users or groups. Dashboard permissions and data privileges are separate. Embedded credentials are convenient, so share those dashboards deliberately.

## ⏰ Keeping it fresh, and other ways in

| Feature | What it does |
|---|---|
| **Schedule** | Refreshes the published datasets at a set time on a chosen warehouse |
| **Subscription** | Sends a PDF or image snapshot after each scheduled refresh (email, Slack, Teams) |
| **SQL alert** | Runs its own query on a schedule and notifies when a condition is met (states OK, TRIGGERED, ERROR) |
| **Ask Genie** | Lets viewers ask follow-up questions in plain language over the dashboard's data |
| **Dashboards as code** | The `.lvdash.json` file lives in Git folders and can be deployed with Declarative Automation Bundles |

Use an alert, not a person refreshing a dashboard, when someone must react to a threshold.

## 🧪 Try it: the datasets of a sales dashboard

```dataset retail
```

First a view that holds the business rules, then the three queries a sales dashboard needs. Paste them into a dashboard's Data tab to build the charts.

```sql run
-- Base view: one row per valid order line, with revenue
CREATE OR REPLACE VIEW dash_order_lines AS
SELECT o.order_id, o.order_date, date_trunc('MONTH', o.order_date) AS month,
       c.customer_id, c.customer_name, c.region, c.segment, p.category,
       o.quantity * p.unit_price * (1 - o.discount) AS revenue
FROM fact_orders o
JOIN dim_product  p ON o.product_id  = p.product_id
JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('TEST', 'CANCELLED');
```

```sql run
-- Dataset 1: revenue by month (line chart)
SELECT month, round(sum(revenue), 2) AS revenue, count(DISTINCT order_id) AS orders
FROM dash_order_lines
GROUP BY month
ORDER BY month;
```

```sql run
-- Dataset 2: revenue by category (bar chart)
SELECT category, round(sum(revenue), 2) AS revenue, count(DISTINCT order_id) AS orders
FROM dash_order_lines
GROUP BY category
ORDER BY revenue DESC;
```

```sql run
-- Dataset 3: top 10 customers (table widget)
SELECT customer_name, region, segment, round(sum(revenue), 2) AS revenue
FROM dash_order_lines
GROUP BY ALL
ORDER BY revenue DESC
LIMIT 10;
```

> To build the dashboard: **New → Dashboard**, add these queries on the **Data** tab, then add widgets on the canvas. Compare `orders` and `revenue` per category: cheap Books sell most often, expensive Electronics earn more per order.

## Exercise 1: a KPI row

Dashboards often start with counters. Write one dataset that returns, in a single row, total revenue, number of orders and average revenue per order. Start from the tables, and apply the same rules as the lecture.

```sql todo
-- TODO: one row with total_revenue, orders and avg_order_value
-- exclude TEST and CANCELLED orders; revenue = quantity * unit_price * (1 - discount)
```

```sql solution
SELECT round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2)                              AS total_revenue,
       count(DISTINCT o.order_id)                                                              AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)) / count(DISTINCT o.order_id), 2) AS avg_order_value
FROM fact_orders o
JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status NOT IN ('TEST', 'CANCELLED');
```

## Exercise 2: a heatmap, then a parameter

Build a dataset with revenue per region and segment (a good heatmap). Then decide: should "segment" be a field filter or a parameter for this chart? Write the parameter version with a literal in place of `:segment`, so it runs here.

```sql todo
-- TODO 1: revenue per region and segment
-- TODO 2: the same query as it would look with a parameter, using 'SMB' in place of :segment
```

```sql solution
SELECT c.region, c.segment, round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o
JOIN dim_product  p ON o.product_id  = p.product_id
JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
GROUP BY ALL;

-- A field filter is enough here: segment is a column of the result.
-- A parameter only pays off when the value must act before aggregation:
SELECT c.region, round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o
JOIN dim_product  p ON o.product_id  = p.product_id
JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.status NOT IN ('TEST', 'CANCELLED')
  AND ('SMB' = 'All' OR c.segment = 'SMB')   -- in the dashboard: :segment
GROUP BY ALL;

-- Clean up the lecture view when you are done
-- DROP VIEW IF EXISTS dash_order_lines;
```

## ⚠️ Common mistakes

- ❌ Repeating the same joins and rules in every widget's dataset. Put them in one dataset or view.
- ❌ A parameter where a field filter would do. Every parameter change runs a new query.
- ❌ Editing the draft and expecting viewers to see it. **Publish** again.
- ❌ Publishing with embedded credentials to a wide audience over sensitive tables.
- ❌ A pie chart with 20 slices, or for a trend over time. Use bars and lines.
- ✅ Schedule the refresh, subscribe the stakeholders, and use **alerts** for thresholds.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| One set of business rules for many charts | One dataset (or view) feeding many widgets |
| Let viewers narrow a chart | Field filter |
| Change the SQL itself | Parameter `:name` (date range: `:p.min`, `:p.max`) |
| Viewers see only their own data | Publish with individual data permissions |
| Fresh data every morning in the inbox | Schedule plus subscription |
| Get told when a number crosses a line | SQL alert |
