---
title: Joins and shuffles
summary: See how Spark moves rows between executors to join and aggregate them, how it chooses between broadcast, sort-merge and shuffle hash joins, and how Adaptive Query Execution handles skew. Read the join strategy from EXPLAIN.
icon: 🔀
level: Intermediate
minutes: 12
group: Apache Spark
tags: [Apache Spark, Joins, Shuffle, AQE, Data skew]
---
# Joins and shuffles

> To join two tables, rows with the same key must end up in the same task. Spark either sends the small table to every executor or reshuffles both tables by the key. That choice decides most of the cost of a join.

**The one idea to remember:** a broadcast join moves the **small** table once; a sort-merge join moves **both** tables across the network. Avoid shuffling what you can broadcast.

## 🔀 What a shuffle does

Here is a sort-merge join of `fact_orders` and `dim_product` on `product_id`, on two executors with three shuffle partitions.

```viz flow
{"title": "Sort-merge join: both sides are repartitioned by product_id",
 "nodes": [{"icon": "📦", "title": "Map tasks", "sub": "read both tables", "color": "blue", "items": ["task A: orders for ids 1, 2, 7", "task B: orders for ids 1, 3, 5"]},
           {"icon": "💾", "title": "Shuffle write", "sub": "hash(product_id) mod 3", "color": "amber", "items": ["files on local disk, one block per target partition"]},
           {"icon": "🌐", "title": "Shuffle read", "sub": "fetch blocks over the network", "color": "red", "items": ["partition 1 gets every row of id 1"]},
           {"icon": "🔤", "title": "Sort", "sub": "each partition by product_id", "color": "purple"},
           {"icon": "🤝", "title": "Merge", "sub": "walk both sorted sides together", "color": "green"}],
 "edges": ["serialize", "network", "sort", "join"],
 "steps": [
  {"label": "Map", "focus": [0], "note": "Stage 1 reads both tables. Rows for product 1 sit in **both** tasks, so no task can join them yet."},
  {"label": "Write", "focus": [1], "note": "Every map task computes `hash(product_id) mod 3` for each row and writes the rows into one block per target partition, on the executor's **local disk**."},
  {"label": "Fetch", "focus": [2], "note": "Stage 2 starts only after all map tasks finish. Each reduce task fetches its block from **every** map task. Now all rows of product 1, from both tables, are in one task."},
  {"label": "Sort", "focus": [3], "note": "Both sides of the partition are sorted by the key. Large partitions that do not fit in memory **spill** to disk."},
  {"label": "Merge", "focus": [4], "note": "The task walks the two sorted lists in step, like a zipper, and emits matching pairs. Memory use stays low, which is why this is the default for big joins."}
 ]}
```

Every shuffled row is serialized, written to disk, sent over the network and read back. Shuffles are also barriers: no reduce task starts until every map task has finished.

## 🤝 Three join strategies

```viz compare
{"items": [{"icon": "📡", "title": "Broadcast hash join", "sub": "one side is small", "color": "green",
            "points": ["Small side is collected and **sent to every executor**", "Big side is joined where it is: **no shuffle**", "❌ out of memory if the \"small\" side is big"],
            "foot": "Fastest when it fits"},
           {"icon": "🔤", "title": "Sort-merge join", "sub": "both sides are large", "color": "blue",
            "points": ["Shuffle **both** sides by key, sort, merge", "✅ scales to any size, spills safely", "❌ two shuffles and two sorts"],
            "foot": "Default for large equi-joins in Spark"},
           {"icon": "🧺", "title": "Shuffle hash join", "sub": "one side is medium", "color": "purple",
            "points": ["Shuffle both sides, build a hash table from the smaller side per partition", "✅ no sort", "❌ each partition of the build side must fit in memory"],
            "foot": "Photon prefers hash joins"}]}
```

All three need an **equality** condition (`a.id = b.id`). Joins on ranges or inequalities fall back to nested-loop strategies, which are much slower.

## 🧭 How Spark picks a strategy

| Rule, in order | Result |
|---|---|
| A join **hint** is present | The hinted strategy, if it is valid for the join type |
| One side's estimated size is under `spark.sql.autoBroadcastJoinThreshold` (10 MB by default) | Broadcast hash join |
| Otherwise | Sort-merge join (`spark.sql.join.preferSortMergeJoin` is true in open-source Spark) |

- Hints: `/*+ BROADCAST(p) */`, `/*+ MERGE(p) */`, `/*+ SHUFFLE_HASH(p) */` in SQL, `F.broadcast(df)` or `df.hint("merge")` in Python.
- The join type limits the broadcast side: in `a LEFT JOIN b`, only `b` can be broadcast.
- The estimate comes from table statistics. Wrong statistics mean wrong choices, which AQE can fix at runtime.

## 📋 Read the join from EXPLAIN

```viz code
title: EXPLAIN of orders JOIN products, grouped by category (simplified)
lang: text
---
AdaptiveSparkPlan isFinalPlan=false
+- HashAggregate(keys=[category], functions=[sum(quantity)])
   +- Exchange hashpartitioning(category, 200)
      +- HashAggregate(keys=[category], functions=[partial_sum(quantity)])
         +- Project [quantity, category]
            +- BroadcastHashJoin [product_id], [product_id], Inner, BuildRight
               :- Filter isnotnull(product_id)
               :  +- FileScan parquet fact_orders [product_id, quantity]
               +- BroadcastExchange HashedRelationBroadcastMode(...)
                  +- Filter isnotnull(product_id)
                     +- FileScan parquet dim_product [product_id, category]
---
6 | The strategy | `BroadcastHashJoin`, inner join, and `BuildRight`: the right side (dim_product) becomes the in-memory hash table.
9-11 | BroadcastExchange | dim_product is read, collected and **sent to every executor**. This is not a shuffle.
7-8 | Big side stays put | No `Exchange` under fact_orders. Each task joins its own chunk of orders.
3 | The only shuffle | The `groupBy(category)` still shuffles, but only the partial sums, a few rows per task.
1 | Not final yet | AQE may still change the join when real sizes are known.
```

> On serverless and SQL warehouses the names start with `Photon` (`PhotonBroadcastHashJoin`, `PhotonShuffledHashJoin`). The strategy is in the name either way.

## ⚡ Adaptive Query Execution

AQE re-plans the query **while it runs**, using the real sizes of finished shuffle stages. It is on by default and does three things.

1. **Coalesces shuffle partitions**: many tiny partitions after a shuffle are merged into fewer tasks.
2. **Switches join strategy**: if one side turns out to be small after a filter, a planned sort-merge join becomes a broadcast join. Databricks uses its own runtime threshold for this (`spark.databricks.adaptive.autoBroadcastJoinThreshold`, 30 MB by default).
3. **Splits skewed partitions** in sort-merge and shuffle hash joins.

AQE acts only at shuffle boundaries. It cannot fix a plan that has no shuffle, and it does not split a skewed `groupBy`.

## 🐘 Data skew, and what AQE does about it

Imagine `fact_orders` 1000 times bigger, joined to a large table by `product_id`. Product 1 is ordered far more often than any other.

```viz table
{"title": "Shuffle partitions of the orders side", "columns": ["Partition", "product_ids", "Size", "Tasks"],
 "rows": [["p0", "1", "1,370 MB", "1"], ["p1", "2, 9, 14", "160 MB", "1"], ["p2", "3, 6, 21", "140 MB", "1"],
          ["p3", "17, 30", "30 MB", "1"], ["p4", "25, 38", "25 MB", "1"], ["p5", "33, 40", "20 MB", "1"]],
 "steps": [
  {"label": "After the shuffle", "note": "Hashing put all rows of product 1 into p0. One task would read 1.4 GB while the others finish in seconds and their cores sit idle."},
  {"label": "Detect skew", "note": "AQE marks a partition as skewed when it is larger than 5 × the median partition **and** larger than 256 MB (the open-source defaults).", "hl": [0]},
  {"label": "Split it", "note": "p0 is split into 6 tasks of about 230 MB. The matching partition of the other table is **copied** to each of the 6 tasks, so every pair still meets.", "upd": {"0": {"Tasks": "6 × 230 MB"}}},
  {"label": "Coalesce small ones", "note": "p3, p4 and p5 are tiny, so AQE reads them in one task. Fewer tasks, less scheduling overhead.", "upd": {"3": {"Tasks": "1 (with p4, p5)"}, "4": {"Tasks": "merged"}, "5": {"Tasks": "merged"}}, "hl": [3, 4, 5]},
  {"label": "Result", "note": "Nine tasks of similar size instead of one straggler. If the other side were small, a **broadcast join** would avoid the shuffle and the skew altogether."}
 ]}
```

Symptoms of skew: one task of a stage runs far longer than the rest, with much more shuffle read and spill. Fixes: broadcast the small side, let AQE split the partition, handle hot or NULL keys separately, or **salt** the key (add a random suffix, join, then combine) for skewed aggregations.

## 🔁 repartition and coalesce

| | `repartition(n)` or `repartition("col")` | `coalesce(n)` |
|---|---|---|
| Shuffle | Yes, a full shuffle | No, merges neighbouring partitions |
| Can increase partitions | Yes | No, decrease only |
| Result | Even partitions, or partitioned by a key | Possibly uneven partitions |
| Typical use | More parallelism, spread a skewed input | Fewer output files before a write |

`coalesce(1)` sends all data through one task. Use it only for small outputs.

## 🧪 Try it: read the join strategy

```dataset retail
```

`dim_product` has 40 rows, far below the 10 MB threshold. Expect a broadcast.

```sql run
-- Default plan: dim_product is broadcast
EXPLAIN
SELECT p.category, sum(o.quantity) AS units
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
GROUP BY p.category;
```

```sql run
-- Force a shuffle join with a hint, then compare the plans
EXPLAIN
SELECT /*+ MERGE(p) */ p.category, sum(o.quantity) AS units
FROM fact_orders o JOIN dim_product p ON o.product_id = p.product_id
GROUP BY p.category;
```

> With the hint you see a `hashpartitioning(product_id, ...)` exchange on **each** side of the join. Classic Spark shows `SortMergeJoin`. Photon may show `ShuffledHashJoin`, because it prefers hash joins, but both sides are still shuffled.

```sql run
-- Is the join key skewed? Orders per product_id
SELECT product_id,
       count(*) AS orders,
       round(100 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_all
FROM fact_orders
GROUP BY product_id
ORDER BY orders DESC
LIMIT 10;
```

Product 1 alone has more than a fifth of all orders. In a shuffle join on `product_id`, its task would be the straggler.

## Exercise 1: which side is broadcast?

Join the 40 products to their orders with `dim_product p LEFT JOIN fact_orders o`. Predict which table Spark broadcasts, then check `BuildLeft` or `BuildRight` in the plan.

```sql todo
-- TODO: EXPLAIN a query that keeps every product, with its order count
```

```sql solution
EXPLAIN
SELECT p.product_id, p.product_name, count(o.order_id) AS orders
FROM dim_product p LEFT JOIN fact_orders o ON o.product_id = p.product_id
GROUP BY p.product_id, p.product_name;
-- In a LEFT JOIN the left side must keep unmatched rows, so only the RIGHT side can be broadcast.
-- fact_orders is small here (well under 10 MB), so expect a broadcast hash join with BuildRight:
-- the bigger table is the one broadcast. If fact_orders were large, Spark would shuffle both sides.
```

## Exercise 2: measure the skew

Compute the ratio between the busiest `product_id` and the median product. AQE's skew rule uses a factor of 5. Would this key count as skewed?

```sql todo
-- TODO 1: orders per product_id in a subquery or CTE
-- TODO 2: max(orders), median(orders) and their ratio
```

```sql solution
WITH per_product AS (
  SELECT product_id, count(*) AS orders FROM fact_orders GROUP BY product_id
)
SELECT max(orders) AS busiest, median(orders) AS median_product,
       round(max(orders) / median(orders), 1) AS skew_ratio
FROM per_product;
-- The ratio is far above 5. At real scale (partitions over 256 MB) AQE would split that partition.
```

## Exercise 3: repartition versus coalesce

Write the same 60,000 orders as Parquet twice: once after `repartition(8)`, once after `coalesce(2)`. Predict the number of data files each time.

```python todo
# TODO 1: path = data.volume(CATALOG, SCHEMA) + "/js_partitions"
# TODO 2: write spark.table("fact_orders").repartition(8) to path + "/rep8" (mode overwrite)
# TODO 3: write ...coalesce(2) to path + "/coal2", then count the part- files in both folders
```

```python solution
import os

path = data.volume(CATALOG, SCHEMA) + "/js_partitions"
orders = spark.table("fact_orders")
orders.repartition(8).write.mode("overwrite").parquet(path + "/rep8")
orders.coalesce(2).write.mode("overwrite").parquet(path + "/coal2")

for folder in ("rep8", "coal2"):
    parts = [f for f in os.listdir(f"{path}/{folder}") if f.startswith("part-")]
    print(folder, len(parts), "files")
# rep8: 8 files (one per partition, after a full shuffle). coal2: at most 2 files, no shuffle.
# coalesce can only lower the count. If the table has 1 file, coalesce(2) still writes 1.

# Clean up the demo files when you are done
# import shutil; shutil.rmtree(path)
```

## ⚠️ Common mistakes

- ❌ Broadcasting a big table with a hint. It is collected on the driver and copied to every executor, and the query can fail with out-of-memory.
- ❌ "AQE fixes every skew." It splits skewed **join** partitions only. Skewed `groupBy` keys need salting or separate handling.
- ❌ `coalesce(1)` or `repartition(1)` before writing a large table: one task does all the work.
- ❌ Calling `repartition` "to be safe" before every join. It adds a shuffle.
- ✅ Filter and select columns before the join, so fewer bytes are shuffled.
- ✅ Check the join strategy in `EXPLAIN` before tuning anything else.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See the join strategy | `EXPLAIN SELECT ...`, look for `BroadcastHashJoin`, `SortMergeJoin`, `ShuffledHashJoin` |
| Force a broadcast | `/*+ BROADCAST(t) */` or `F.broadcast(df)` |
| Force a sort-merge or shuffle hash join | `/*+ MERGE(t) */`, `/*+ SHUFFLE_HASH(t) */` |
| Find skew | `GROUP BY key` with `count(*)`, compare the top keys to the median |
| More partitions, or by a key | `df.repartition(n)` / `df.repartition("col")` |
| Fewer output files, no shuffle | `df.coalesce(n)` |
