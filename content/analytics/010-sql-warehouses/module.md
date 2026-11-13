---
title: SQL warehouses
summary: Understand the compute behind Databricks SQL. Pick a warehouse type, size it for heavy queries or many users, and keep the bill under control with auto stop and caching.
icon: 🏭
level: Beginner
minutes: 10
group: Compute for SQL
tags: [Databricks SQL, SQL warehouse, Photon, Serverless, Cost]
---
# SQL warehouses

> Every query from the SQL editor, a dashboard, Genie, an alert or a BI tool runs on a **SQL warehouse**: compute that Databricks tunes for SQL and for many users at once.

**The one idea to remember:** a warehouse has two dials. **Size** makes each query faster (scale up). **Min and max clusters** let more queries run at the same time (scale out).

## 💡 What a SQL warehouse is

A SQL warehouse is a pool of compute that only runs SQL. It exposes one endpoint (JDBC/ODBC and the SQL editor) and hides the clusters behind it.

| | SQL warehouse | All-purpose compute | Job compute |
|---|---|---|---|
| Runs | SQL only | Python, SQL, Scala, R | Any task of a job |
| Used by | Editor, dashboards, Genie, BI tools | Interactive notebooks | Lakeflow Jobs |
| Many users at once | Yes: queues and scales out | Shared, but not built for BI load | No: one run, then gone |
| Engine | Photon, always on | Photon optional | Photon optional |

Using a warehouse needs the **CAN USE** permission on it. What data a query may read is still decided by Unity Catalog.

## 🏷️ Serverless, pro and classic

The type decides where the machines run and how fast they appear.

```viz compare
{"title": "Three warehouse types",
 "items": [
  {"icon": "⚡", "title": "Serverless", "sub": "recommended", "color": "teal",
   "points": ["✅ starts in seconds", "✅ Databricks manages the machines and scaling", "✅ remote result cache shared across restarts", "Machines run in the Databricks account"], "foot": "pay only while it runs"},
  {"icon": "🧰", "title": "Pro", "sub": "classic machines, full features", "color": "blue",
   "points": ["Machines run in your cloud account", "✅ all SQL features", "❌ start-up takes minutes", "Use when serverless is not available or not allowed"]},
  {"icon": "🏚️", "title": "Classic", "sub": "basic", "color": "gray",
   "points": ["Machines run in your cloud account", "❌ fewer features", "❌ slow start, slower scaling", "Rarely the right choice today"]}
 ]}
```

All three run **Photon**, the vectorized C++ engine. Photon speeds up scans, joins, aggregations and writes without any code change. It does not help Python UDFs.

## 📏 Two dials: size and clusters

The **size** (T-shirt: 2X-Small up to 4X-Large) sets how much compute **one cluster** has. A bigger cluster finishes one heavy query faster and spills less to disk.

The **min and max clusters** setting decides how many clusters of that size may run side by side. More clusters do not make one query faster. They let more queries run at once.

| Symptom | Turn this dial |
|---|---|
| One big query is slow, the profile shows spill | Bigger **size** |
| Monday 9:00, 40 analysts, queries wait in the queue | Higher **max clusters** |
| Queries are fast but the bill is high at night | Lower **auto stop**, lower **min clusters** |
| Dashboard re-runs the same queries | Rely on the **result cache** |

## 🚦 Queueing and scaling out

A cluster runs a limited number of queries at once (roughly ten). Extra queries wait in a queue. Step through a busy morning on a warehouse with min 1 and max 3 clusters.

```viz flow
{"title": "Warehouse with min 1, max 3 clusters",
 "nodes": [{"icon": "👩‍💼", "title": "Users and dashboards", "sub": "queries arrive", "color": "blue"},
           {"icon": "🚦", "title": "Queue", "sub": "waits for a free slot", "color": "amber"},
           {"icon": "🖥️", "title": "Cluster 1", "sub": "always on while running", "color": "teal"},
           {"icon": "🖥️", "title": "Cluster 2", "sub": "added under load", "color": "purple"}],
 "edges": ["submit", "dispatch", "overflow"],
 "steps": [
  {"label": "Quiet", "focus": [0, 2], "note": "A few queries arrive. Cluster 1 has free slots, so they start at once. Nothing waits."},
  {"label": "Rush hour", "focus": [0, 1], "note": "Forty people open the same dashboard. Cluster 1 is full, so new queries **queue**. Query history shows them as queued time."},
  {"label": "Scale out", "focus": [1, 3], "note": "The load stays high, so the warehouse **adds Cluster 2** (up to max clusters). Queued queries move to it. Serverless adds clusters faster than pro and classic."},
  {"label": "Both busy", "focus": [2, 3], "note": "Two clusters now share the load. Each query runs at the same speed as before: scaling out added **capacity**, not speed."},
  {"label": "Scale back", "focus": [2], "note": "Load drops. After a quiet period the extra cluster is **removed**, down to min clusters. Fewer clusters, lower cost."}
 ]}
```

## ⏱️ Auto stop and start-up time

An idle warehouse still costs money, so **auto stop** shuts it down after a set number of idle minutes. The next query starts it again.

```viz timeline
{"title": "One day of a serverless warehouse with auto stop = 10 min",
 "items": [
  {"label": "08:55", "title": "First query", "color": "teal", "note": "The warehouse is stopped. The first query **starts it**. Serverless is ready in seconds; pro and classic take minutes."},
  {"label": "09:00", "title": "Busy", "color": "green", "note": "Queries keep it running. You pay DBUs for every minute it is up, not per query."},
  {"label": "12:10", "title": "Last query before lunch", "color": "amber", "note": "No more queries arrive. The idle timer starts."},
  {"label": "12:20", "title": "Auto stop", "color": "gray", "note": "Ten idle minutes later the warehouse stops. From now on it costs nothing."},
  {"label": "13:30", "title": "Next query", "color": "teal", "note": "A dashboard refresh starts it again. With serverless the user barely notices the restart."}
 ]}
```

Serverless allows short timeouts because restarts are cheap. Pro and classic need a longer timeout, so they burn more idle time.

## 🗄️ Three caches

A warehouse avoids work it already did. Know which layer answered your query.

| Cache | Holds | Gone when |
|---|---|---|
| **UI cache** | The last result shown in the editor or dashboard | It ages out (kept up to 7 days) |
| **Query result cache** | The result of an identical query text | The underlying tables change, about 24 hours pass, or (local cache) the warehouse restarts |
| **Disk cache** | Copies of data files on local SSDs | The files change or the warehouse stops |

A result cache hit returns in milliseconds and appears in **query history** as served from cache. That is great for dashboards, and misleading for benchmarks: switch it off with `SET use_cached_result = false` when you measure.

## 💶 What you pay for

Warehouse cost is **DBUs per hour × hours running**. The DBU rate doubles with each size step and multiplies with the number of clusters. The rate below is an example figure; check your price list.

```viz table
{"title": "A Medium warehouse (example: 24 DBU per hour per cluster)",
 "columns": ["Setup", "Clusters", "Hours up per day", "DBUs per day"],
 "rows": [["Medium, no auto stop", 1, 24, 576]],
 "steps": [
  {"label": "Always on", "note": "Left running day and night, the warehouse pays for 24 hours even if people work 8."},
  {"label": "Auto stop", "note": "With a 10 minute auto stop it only runs during office hours plus a little idle time.", "add": [["Medium, auto stop 10 min", 1, 9, 216]]},
  {"label": "Peak at 9:00", "note": "Max clusters 3: a second and third cluster join for 2 hours of rush. You pay for them only while they run.", "add": [["+ 2 extra clusters for 2 h", 2, 2, 96]]},
  {"label": "Oversized", "note": "Choosing Large \"to be safe\" doubles the rate for every hour. Size up only when the query profile shows the need.", "add": [["Large instead of Medium", 1, 9, 432]], "hl": [3]}
 ]}
```

## 🧪 Try it: look at what the warehouse does

```dataset retail
```

These cells run on serverless notebook compute or on a SQL warehouse. To see the warehouse features (result cache, query history, query profile), attach the notebook to a **SQL warehouse**. Creating and configuring a warehouse is admin work done in the UI: **SQL Warehouses → Create**, then pick type, size, min/max clusters and auto stop.

```sql run
-- Which engine versions answer this query?
SELECT current_version() AS versions, current_user() AS me;
```

```sql run
-- The plan the engine will run: scans, join, aggregation
EXPLAIN
SELECT p.category, sum(o.quantity * p.unit_price * (1 - o.discount)) AS revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status = 'COMPLETED'
GROUP BY p.category;
```

```sql run
-- Run this twice. On a SQL warehouse the second run comes from the result cache
SELECT p.category, count(*) AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status = 'COMPLETED'
GROUP BY p.category
ORDER BY revenue DESC;
```

> After the second run, open **Query history**, find both runs and compare the durations. Open the first one and click **See query profile**: you see the scan, join and aggregation as a graph, with rows and time per operator.

## Exercise 1: break the cache

The result cache only serves an **identical** query on **unchanged** data. Predict which of these two queries can come from the cache, then check in query history.

```sql todo
-- TODO 1: run the category revenue query from the lecture again, unchanged
-- TODO 2: run it again with one change: only orders from 2026 (filter on order_date)
-- Which one was served from the cache, and why?
```

```sql solution
SELECT p.category, count(*) AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status = 'COMPLETED'
GROUP BY p.category
ORDER BY revenue DESC;
-- Same text, same data: a cache hit on a SQL warehouse

SELECT p.category, count(*) AS orders,
       round(sum(o.quantity * p.unit_price * (1 - o.discount)), 2) AS revenue
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
WHERE o.status = 'COMPLETED' AND o.order_date >= DATE'2026-01-01'
GROUP BY p.category
ORDER BY revenue DESC;
-- New query text: the warehouse must compute it (the disk cache may still speed up the scan)
```

## Exercise 2: read the plan

Write a query for revenue per customer region in 2026, look at its plan, and name the operator that combines the two tables. Then decide: if this query were slow and spilled to disk, which dial would you turn?

```sql todo
-- TODO 1: EXPLAIN a query that joins fact_orders and dim_customer and sums quantity per region for 2026
-- TODO 2: in a comment, name the join operator and the dial you would turn
```

```sql solution
EXPLAIN
SELECT c.region, sum(o.quantity) AS units
FROM fact_orders o JOIN dim_customer c ON o.customer_id = c.customer_id
WHERE o.order_date >= DATE'2026-01-01'
GROUP BY c.region;
-- dim_customer is small, so the plan usually shows a BroadcastHashJoin.
-- Spill on one heavy query means more compute per query: a bigger size, not more clusters.
```

## ⚠️ Common mistakes

- ❌ Raising the **size** to fix queueing from many users. Queueing needs more **clusters** (max scaling).
- ❌ Adding clusters to speed up one slow query. Each query still runs on one cluster.
- ❌ Benchmarking with the result cache on. Turn it off with `SET use_cached_result = false`.
- ❌ Leaving a warehouse without auto stop "so it is ready". Serverless restarts in seconds.
- ✅ Start small, read the **query profile**, then size up only when you see spill or long scans.
- ✅ Give users **CAN USE** on the warehouse and data access through Unity Catalog grants.

## 🧭 Cheat sheet

| I want to… | Do this |
|---|---|
| Fast start, no infrastructure work | Serverless warehouse |
| Make one heavy query faster | Bigger size (scale up) |
| Serve many users at once | Higher max clusters (scale out) |
| Stop paying for idle time | Short auto stop |
| Find slow queries and see why | Query history, then query profile |
| Measure real performance | `SET use_cached_result = false` |
