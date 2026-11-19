---
title: Broadcast hash join
summary: See how Spark joins a huge table to a small one without shuffling the huge one. Build a hash table, broadcast it, probe it locally, find it in the plan, and know when a broadcast runs out of memory.
icon: 📡
level: Intermediate
minutes: 10
group: Monitoring and optimization
tags: [Apache Spark, Joins, Broadcast, Performance, EXPLAIN]
---
# Broadcast hash join

> A join of billions of orders with a few thousand products does not need to move the orders at all. Copy the small table to every worker, turn it into a hash table in memory, and let each chunk of orders look up its matches where it already is.

**The one idea to remember:** a broadcast hash join **moves the small side once, to every executor**, and never shuffles the big side. It is the fastest join Spark has, as long as the small side really is small.

> 🎬 Watch the animated whiteboard explainer: [Broadcast hash join animation](https://misrori.github.io/databricksedu/extras/broadcast-hash-join/)

## 🗂️ A hash table in RAM

A hash table stores rows by key. A hash function (for example MurmurHash3) turns `product_id` into a bucket address, so a lookup jumps straight to one bucket instead of scanning every row. Step through: first **build** it from the products, then **probe** it with orders.

```viz table
{"title": "Hash table built from products (bucket numbers are illustrative)",
 "columns": ["bucket", "product_id", "name", "probe"],
 "rows": [],
 "steps": [
  {"label": "Build: 101", "note": "`hash(101)` points to bucket 3. Store the row there.", "add": [["3", 101, "Shoe", ""]]},
  {"label": "Build: 102", "note": "`hash(102)` points to bucket 6.", "add": [["6", 102, "Shirt", ""]]},
  {"label": "Build: 205", "note": "`hash(205)` points to bucket 1. The table is ready: three rows, in memory.", "add": [["1", 205, "Coat", ""]]},
  {"label": "Probe: order #1001", "note": "Order #1001 has `product_id` 101. `hash(101)` → bucket 3 → keys match. **Hit**: emit the joined row.", "upd": {"0": {"probe": "✓ #1001"}}, "hl": [0]},
  {"label": "Probe: order #1002", "note": "Order #1002 has `product_id` 999. `hash(999)` → bucket 6, but the key there is 102. **Miss**: an inner join drops the order.", "upd": {"1": {"probe": "✗ #1002 (999)"}}, "hl": [1]},
  {"label": "Probe: order #1003", "note": "`product_id` 205 → bucket 1 → hit. Each probe costs one hash and one lookup, however many products there are.", "upd": {"2": {"probe": "✓ #1003"}}, "hl": [2]}
 ]}
```

## 🐘 A huge table meets a tiny one

The join: `orders.product_id = products.id`. The two sides play different roles.

| Side | Example | Role |
|---|---|---|
| **Build side** | `products`: a few MB | Collected, broadcast, and turned into a hash table on every executor |
| **Probe side** (stream side) | `orders`: billions of rows, terabytes | Stays where it is; each partition streams its rows through the local hash table |

In the plan, `BuildRight` or `BuildLeft` tells you which side became the hash table. The big side is read once, in place, by the tasks that already hold it. No row of `orders` crosses the network.

## 📡 The broadcast, step by step

```viz flow
{"title": "orders JOIN products, broadcast",
 "nodes": [{"icon": "🏷️", "title": "products", "sub": "small side, a few MB", "color": "teal"},
           {"icon": "🧠", "title": "Driver", "sub": "collects the small table", "color": "navy"},
           {"icon": "📡", "title": "Broadcast", "sub": "one full copy per executor", "color": "purple"},
           {"icon": "👷", "title": "Executors", "sub": "hash table + local orders chunk", "color": "blue", "items": ["probe: hit ✓", "probe: miss ✗"]},
           {"icon": "📊", "title": "Joined rows", "color": "green"}],
 "edges": ["collect", "send", "build", "probe"],
 "steps": [
  {"label": "Collect", "focus": [0, 1], "note": "The small table is read and its rows are gathered on the **driver**. This is why the driver needs memory for it."},
  {"label": "Broadcast", "focus": [1, 2], "note": "A full copy of `products` is sent to **every** executor. 50 executors means 50 copies."},
  {"label": "Build", "focus": [3], "note": "Each executor builds the hash table from its copy, in memory."},
  {"label": "Probe locally", "focus": [3, 4], "note": "Each orders chunk stays put ✓ and probes the local hash table row by row. **No shuffle of the big table.**"}]}
```

## ⚖️ Broadcast hash join vs sort-merge join

When neither side is small, Spark shuffles both sides by the join key and merges sorted partitions. That works at any size but moves every row of both tables.

```viz compare
{"items": [{"icon": "📡", "title": "Broadcast hash join", "sub": "one side is small", "color": "green",
            "points": ["✅ big side never moves", "✅ no sort, one lookup per row", "❌ small side must fit in driver and executor memory", "Plan: `BroadcastExchange` + `BroadcastHashJoin`"]},
           {"icon": "🔀", "title": "Sort-merge join", "sub": "both sides large", "color": "amber",
            "points": ["✅ works at any size, can spill to disk", "❌ shuffles **both** sides over the network", "❌ sorts both sides", "Plan: `Exchange hashpartitioning` ×2 + `SortMergeJoin`"]}]}
```

The "Joins and shuffles" module covers the shuffle join and skew in detail.

## 🧭 How Spark chooses it

- **Statistics**: if the estimated size of one side is below `spark.sql.autoBroadcastJoinThreshold` (10 MB by default in Apache Spark), it is broadcast.
- **AQE**: Adaptive Query Execution measures real sizes at runtime and can switch a planned sort-merge join to a broadcast join when one side turns out small.
- **Hints** override the estimate: `F.broadcast(df)` in Python, `/*+ BROADCAST(p) */` in SQL.

```python
# Display only: spark.conf.set is not allowed on serverless
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", 50 * 1024 * 1024)  # raise to 50 MB
spark.conf.set("spark.sql.autoBroadcastJoinThreshold", -1)                # never auto-broadcast
```

## 🚪 Which side can be broadcast

The build side cannot report rows that found no match, because no single executor sees all of the probe side. So the side whose unmatched rows must be kept has to be the **probe** side.

| Join type | Side that can be broadcast |
|---|---|
| Inner | Either side |
| `a LEFT JOIN b` (also left semi, left anti) | Only `b`, the right side |
| `a RIGHT JOIN b` | Only `a`, the left side |
| `a FULL OUTER JOIN b` | Neither: Spark uses a shuffle join |

A broadcast hint on a side that cannot be built is ignored, not an error.

## 💥 When "tiny" isn't tiny

Spark decides from an **estimate**. Missing or stale statistics, or a filter whose selectivity Spark cannot judge, can make a large table look small. A hint does the same by force.

```viz timeline
{"title": "A broadcast that goes wrong",
 "items": [
  {"label": "1", "title": "Estimate", "sub": "\"about 5 MB\"", "color": "teal", "note": "Stale statistics say the table is tiny. Spark plans a broadcast. **Spark thinks it's tiny…**"},
  {"label": "2", "title": "Collect", "sub": "really 8 GB", "color": "amber", "note": "The driver gathers the real data. It can run out of memory or exceed its result-size limit."},
  {"label": "3", "title": "Broadcast", "sub": "8 GB × 50 executors", "color": "red", "note": "Every executor must hold a full copy and build a hash table on top of it."},
  {"label": "4", "title": "Failure", "sub": "OOM or timeout", "color": "red", "note": "Worker RAM fills up: out-of-memory errors, or the broadcast times out. A sort-merge join would have been slower but safe."},
  {"label": "5", "title": "Fix", "sub": "ANALYZE TABLE", "color": "green", "note": "Refresh statistics with `ANALYZE TABLE t COMPUTE STATISTICS`, and remove broadcast hints from tables that grow."}
 ]}
```

## 🧪 Try it: find the broadcast in the plan

```dataset retail
```

`dim_product` has 40 rows, so Spark broadcasts it without being asked. On serverless the plan nodes may carry a `Photon` prefix, for example `PhotonBroadcastHashJoin`.

```python run
# Default plan: look for BroadcastExchange and BroadcastHashJoin
from pyspark.sql import functions as F

orders, products = spark.table("fact_orders"), spark.table("dim_product")
orders.join(products, "product_id").explain("formatted")
```

```python run
# Make the choice explicit with a hint, and run it
joined = orders.join(F.broadcast(products), "product_id")
joined.explain("formatted")
display(joined.groupBy("category").agg(F.sum("quantity").alias("units")))
```

```sql run
-- Two large-looking sides: force a shuffle join and compare the plan
EXPLAIN FORMATTED
SELECT /*+ MERGE(o2) */ o1.customer_id, count(*) AS pairs
FROM fact_orders o1 JOIN fact_orders o2 ON o1.customer_id = o2.customer_id
GROUP BY o1.customer_id;
```

> Now each side has its own `Exchange hashpartitioning(customer_id, ...)`: both tables are shuffled. Classic Spark shows `SortMergeJoin`; Photon may show `ShuffledHashJoin`, because it prefers hash joins, but the double shuffle is the point.

## Exercise 1: which side can be built?

Predict the plan for three joins of `fact_orders` (left) and `dim_product` (right): an inner join, a left join, and a full outer join **with** `F.broadcast(products)`. Then check `BuildLeft`, `BuildRight` or a shuffle join in each plan.

```python todo
from pyspark.sql import functions as F

orders, products = spark.table("fact_orders"), spark.table("dim_product")

# TODO 1: inner join on product_id, explain("formatted")
# TODO 2: "left" join, explain("formatted")
# TODO 3: "full_outer" join with F.broadcast(products), explain("formatted")
```

```python solution
from pyspark.sql import functions as F

orders, products = spark.table("fact_orders"), spark.table("dim_product")

orders.join(products, "product_id").explain("formatted")                              # broadcast, BuildRight
orders.join(products, "product_id", "left").explain("formatted")                      # broadcast, BuildRight
orders.join(F.broadcast(products), "product_id", "full_outer").explain("formatted")   # no broadcast hash join
# Inner and left: products is small and on the right, so it is the build side.
# Full outer: both sides must keep unmatched rows, so neither can be the build side.
# The hint is ignored and both sides are shuffled (SortMergeJoin or ShuffledHashJoin).
```

## Exercise 2: what does Spark think the size is?

Copy `dim_product` into `bhj_products`, collect statistics, and read the size Spark uses for its broadcast decision. Then predict: is the 60,000-row `fact_orders` itself below 10 MB, and what would happen if you joined two copies of it without a hint?

```sql todo
-- TODO 1: CREATE OR REPLACE TABLE bhj_products from dim_product, then ANALYZE TABLE ... COMPUTE STATISTICS
-- TODO 2: DESCRIBE TABLE EXTENDED bhj_products and find the Statistics row
-- TODO 3: EXPLAIN FORMATTED a join of fact_orders with itself on order_id (no hint)
```

```sql solution
CREATE OR REPLACE TABLE bhj_products AS SELECT * FROM dim_product;
ANALYZE TABLE bhj_products COMPUTE STATISTICS;
DESCRIBE TABLE EXTENDED bhj_products;   -- Statistics: a few KB, 40 rows

EXPLAIN FORMATTED
SELECT count(*) FROM fact_orders o1 JOIN fact_orders o2 ON o1.order_id = o2.order_id;
-- fact_orders is only around a megabyte, far below the threshold, so one copy is broadcast.
-- "Big" is relative: at demo scale everything broadcasts. At billions of rows the same
-- query would be a shuffle join, unless stale statistics made Spark think otherwise.

-- Clean up the demo table when you are done
-- DROP TABLE bhj_products;
```

## ⚠️ Common mistakes

- ❌ "A broadcast is a kind of shuffle." The small side is copied whole to every executor; the big side does not move at all.
- ❌ Broadcasting a table because it was small last year. Tables grow; a hint keeps forcing the broadcast until it runs out of memory.
- ❌ Expecting a broadcast for a full outer join, or for the left side of a left join. The join type decides which side can be built.
- ❌ Ignoring statistics. Without them a filtered large table can look tiny, or a tiny one large.
- ✅ Read the plan: `BroadcastExchange` plus `BroadcastHashJoin` means it worked, two `Exchange hashpartitioning` nodes mean both sides were shuffled.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See the join strategy | `df.explain("formatted")` or `EXPLAIN FORMATTED SELECT ...` |
| Force a broadcast | `big.join(F.broadcast(small), "id")` or `/*+ BROADCAST(p) */` |
| Force a shuffle join | `/*+ MERGE(t) */` or `df.hint("merge")` |
| Give Spark correct sizes | `ANALYZE TABLE t COMPUTE STATISTICS` |
| Check the size estimate | `EXPLAIN COST SELECT ...` |
| Change the auto threshold | `spark.sql.autoBroadcastJoinThreshold` (classic compute only) |
