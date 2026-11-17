---
title: Driver, workers, shuffle and the DAG
summary: See what the driver node and the worker nodes of a Spark cluster really do, follow one query from your notebook to the executors and back, and learn exactly what a shuffle and a DAG are.
icon: 🖥️
level: Beginner
minutes: 14
group: Introduction to Apache Spark
tags: [Apache Spark, Driver, Executors, Shuffle, DAG, Spark Connect]
---
# Driver, workers, shuffle and the DAG

> A Spark cluster is a small team of machines. One machine, the **driver**, plans the work and hands it out. The other machines, the **workers**, do the work in parallel. When rows have to be regrouped between them, that is a **shuffle**, and the plan that ties it all together is a **DAG**.

**The one idea to remember:** the driver plans and coordinates, the executors on the workers read and process the data, and **every shuffle splits the work into stages** that run one after the other.

## 🖥️ A cluster is a group of machines

A Spark cluster is not one big computer. It is several ordinary machines (cloud VMs) that work together over the network. Each layer below has one job.

```viz layers
{"layers": [
  {"icon": "📓", "title": "Your notebook", "sub": "where you type code", "color": "gray", "items": ["Sends plans, gets results back", "Holds no table data"]},
  {"icon": "🧠", "title": "Driver node", "sub": "one machine: the coordinator", "color": "navy", "items": ["SparkSession (`spark`)", "Plans the query", "Schedules tasks", "Receives results"]},
  {"icon": "🗂️", "title": "Cluster manager", "sub": "hands out machines", "color": "purple", "items": ["Databricks does this for you", "YARN or Kubernetes in open source"]},
  {"icon": "👷", "title": "Worker nodes", "sub": "many machines: do the work", "color": "teal", "items": ["Each runs an executor", "Cores = task slots", "Memory and local disk"]},
  {"icon": "☁️", "title": "Cloud storage", "sub": "where the table files live", "color": "blue", "items": ["Delta / Parquet files", "Read by the executors directly"]}
 ]}
```

The driver is the **brain** and the workers are the **muscle**. To make a job faster, you add workers, not a bigger notebook.

## 🧠 The driver node: the brain

The driver is **one** process on **one** machine. Everything that needs a global view of the query happens here.

| The driver… | What that means |
|---|---|
| runs your program | Your DataFrame and SQL code is turned into a plan. `spark` lives here |
| plans the query | Builds the logical plan. The **Catalyst** optimizer turns it into a physical plan |
| builds the DAG | Cuts the plan into **stages** at every shuffle |
| schedules tasks | Sends one task per partition to a free core and retries failed ones |
| tracks the cluster | Knows which executor is alive and where every shuffle file lives |
| receives results | Only for actions that return data: `show`, `collect`, `display`, `count` |

The driver does **not** read your table. That is why `collect()` on a huge DataFrame is dangerous: all rows travel to this one machine and can run it out of memory.

## 👷 Worker nodes and executors: the muscle

A **worker node** is a machine that hosts an **executor**: a long-running JVM process that runs tasks. On Databricks, each worker node runs one executor. The sizes below are only an example.

```viz tree
{"root": {"icon": "👷", "label": "Worker node", "sub": "a cloud VM, for example 8 cores and 32 GB", "color": "teal", "children": [
   {"icon": "⚙️", "label": "Executor", "sub": "one JVM process, lives as long as the cluster", "color": "blue", "children": [
     {"icon": "🔩", "label": "8 cores = 8 task slots", "sub": "8 tasks run at the same time", "color": "blue"},
     {"icon": "🧮", "label": "Execution memory", "sub": "aggregations, joins, sorts, shuffle buffers", "color": "purple"},
     {"icon": "📦", "label": "Storage memory", "sub": "cached data, broadcast tables", "color": "purple"}
   ]},
   {"icon": "💽", "label": "Local disk (SSD)", "sub": "shuffle files, spill, disk cache", "color": "amber"}
 ]}}
```

What an executor does for each task, step by step:

1. Receives a small task from the driver: a piece of the plan plus *which* partition to work on.
2. Reads that chunk **directly from cloud storage**, or fetches shuffle blocks from other executors.
3. Runs the operators in memory, and spills to local disk if memory runs short.
4. Writes the output (shuffle files, table files, or a small result), then reports "done" to the driver.

## ☁️ Classic cluster or serverless

The picture is the same everywhere. What changes is who chooses and manages the machines.

```viz compare
{"title": "Same driver and executors, different ownership",
 "items": [
  {"icon": "🖥️", "title": "Classic cluster", "sub": "you configure the machines", "color": "navy",
   "points": ["You pick the driver type, worker type and number of workers (or autoscaling)", "The notebook attaches to the driver node", "Spark UI shows jobs, stages, tasks and executors", "Single node compute: driver and executor share one machine"],
   "foot": "You see and size the nodes"},
  {"icon": "⚡", "title": "Serverless", "sub": "Databricks manages the machines", "color": "teal",
   "points": ["Databricks picks, starts and scales the driver and workers", "Your notebook is a **Spark Connect** client: it sends plans, gets results", "No Spark UI: use the query profile", "❌ No `SparkContext`, no RDD API"],
   "foot": "Same model, nodes hidden"}
 ]}
```

On serverless you never see a worker node, but your query still runs as tasks on executors, and shuffles still cut it into stages. Serverless also runs most queries with **Photon**, a faster native engine inside the executors.

## 🎬 One query, traced end to end

Here is the example we follow for the rest of the module: count COMPLETED orders per product in `fact_orders` (60,000 rows). The partition and task counts in the trace are illustrative.

```python
(spark.table("fact_orders")
      .filter(F.col("status") == "COMPLETED")
      .groupBy("product_id").count()
      .show())
```

```viz flow
{"title": "Who does what, from the first line to the printed result",
 "nodes": [{"icon": "📝", "title": "Driver: your code", "sub": "builds a plan, reads nothing", "color": "navy"},
           {"icon": "🧮", "title": "Driver: planning", "sub": "Catalyst, DAG, scheduling", "color": "purple"},
           {"icon": "⚙️", "title": "Stage 1 on executors", "sub": "scan, filter, partial count", "color": "teal"},
           {"icon": "🔀", "title": "Stage 2 on executors", "sub": "fetch buckets, final count", "color": "blue"},
           {"icon": "🏁", "title": "Driver: result", "sub": "prints 20 rows", "color": "green"}],
 "edges": ["action", "tasks", "shuffle", "result rows"],
 "steps": [
  {"label": "Build the plan", "focus": [0], "note": "`spark.table`, `filter` and `groupBy().count()` are **transformations**. The driver only records them in a logical plan. No file is opened."},
  {"label": "Action: .show()", "focus": [0, 1], "note": "The action starts a **job**. Catalyst optimizes the whole query: it reads only `product_id` and `status`, and pushes the filter into the scan."},
  {"label": "Make the DAG", "focus": [1], "note": "The physical plan has one **Exchange** (the shuffle for `groupBy`). The DAG scheduler cuts there: **stage 1** = scan + filter + partial count, **stage 2** = final count."},
  {"label": "Launch stage 1", "focus": [1, 2], "note": "One task per input partition, say 3. The task scheduler sends them to free cores on worker 1 and worker 2. A task is tiny: a plan fragment plus a file chunk to read."},
  {"label": "Stage 1 runs", "focus": [2], "note": "Each task reads its chunk **from cloud storage**, keeps COMPLETED rows, counts per product locally, and writes a **shuffle file** to its worker's local disk, split into buckets by `product_id`."},
  {"label": "Stage boundary", "focus": [1], "note": "The driver waits until **every** stage 1 task is done, because each final count needs data from all of them. Adaptive Query Execution can now look at real sizes and adjust stage 2."},
  {"label": "Stage 2 runs", "focus": [3], "note": "One task per bucket. Each fetches its bucket from **every** stage 1 output (over the network when it is on another worker) and adds up the partial counts."},
  {"label": "Back to the driver", "focus": [4], "note": "`show()` needs 20 rows, so only those travel to the driver, which prints them. This is the first moment any data reaches the driver."}
 ]}
```

## 🔀 Watch the rows move

The same query with tiny partitions. Each value is the `product_id` of one order. For the picture, odd ids go to bucket 0 and even ids to bucket 1. Real Spark uses `hash(product_id) % N`.

```viz table
{"title": "3 map tasks on 2 workers → shuffle → 2 reduce tasks",
 "columns": ["task", "worker", "product_id values", "rows"],
 "rows": [["map P0", "worker 1", "1 1 2 1 3 4", 6],
          ["map P1", "worker 1", "1 2 1 1 4 4", 6],
          ["map P2", "worker 2", "3 1 1 2 1 2", 6]],
 "steps": [
  {"label": "Read", "note": "Stage 1 starts. Each map task reads one chunk of the table. Product 1 sits in **every** partition, so no task can count it alone."},
  {"label": "Filter (narrow)", "note": "Each task drops the rows that are not COMPLETED, on its own. No data moves between machines. (Which rows are dropped is made up.)",
   "upd": {"0": {"product_id values": "1 1 2 1 3", "rows": 5}, "1": {"product_id values": "1 1 1 4 4", "rows": 5}, "2": {"product_id values": "1 1 2 1 2", "rows": 5}}},
  {"label": "Partial count", "note": "Each task counts per product **before** the shuffle. 15 rows shrink to 7 small (product, count) pairs, so far less data has to move.",
   "upd": {"0": {"product_id values": "1→3 · 2→1 · 3→1", "rows": 3}, "1": {"product_id values": "1→3 · 4→2", "rows": 2}, "2": {"product_id values": "1→3 · 2→2", "rows": 2}}},
  {"label": "Shuffle write", "note": "Each map task splits its output into **buckets** (b0, b1) and writes them to a shuffle file on its worker's **local disk**. Stage 1 is finished.",
   "upd": {"0": {"product_id values": "b0: 1→3, 3→1 | b1: 2→1"}, "1": {"product_id values": "b0: 1→3 | b1: 4→2"}, "2": {"product_id values": "b0: 1→3 | b1: 2→2"}}},
  {"label": "Shuffle read", "note": "Stage 2. Reduce task R0 fetches **bucket 0 from all three** map outputs: two from worker 1's own disk, one over the network from worker 2. R1 does the same for bucket 1.",
   "add": [["reduce R0", "worker 1", "1→3+3+3 · 3→1", 4], ["reduce R1", "worker 2", "2→1+2 · 4→2", 3]]},
  {"label": "Final count", "note": "Every product now lives in exactly **one** task, so its sum is final: 9 + 1 + 3 + 2 = 15 COMPLETED orders. These rows go to the driver.",
   "upd": {"3": {"product_id values": "1→9 · 3→1", "rows": 2}, "4": {"product_id values": "2→3 · 4→2", "rows": 2}}, "hl": [3, 4]}
 ]}
```

## 🚚 What a shuffle is, precisely

A **shuffle** redistributes rows across partitions so that **all rows with the same key end up in the same partition**. It has two sides.

- **Map side** (end of a stage): every task computes `hash(key) % N` per row, where N is the number of shuffle partitions, and writes N buckets to local disk.
- **Reduce side** (start of the next stage): task *i* fetches bucket *i* from **every** map task. 100 map tasks × 50 reducers = 5,000 blocks to fetch.

| Cost | Why it hurts |
|---|---|
| Serialization and disk | Rows are encoded, written to local disk, read back |
| Network | Most blocks live on other machines |
| A barrier | Stage 2 cannot start until the slowest stage 1 task ends |
| Spill | A reducer with more data than memory spills to disk |
| Skew | One hot key (like product 1) means one huge, slow task |

## 📋 Which operations shuffle

Ask one question: *does an output row need rows from other partitions?* If yes, Spark must shuffle.

```viz compare
{"title": "Shuffle or no shuffle?",
 "items": [
  {"icon": "🔀", "title": "Causes a shuffle", "sub": "wide: rows must meet by key", "color": "red",
   "points": ["`groupBy().agg()`, `count` per key", "`distinct()`, `dropDuplicates()`", "`join` (sort-merge or shuffle hash join)", "`orderBy` / `sort` (range partitioning)", "`repartition(n)` or `repartition(col)`", "window functions with `partitionBy`"],
   "foot": "Ends a stage, starts a new one"},
  {"icon": "➡️", "title": "No shuffle", "sub": "narrow: each partition on its own", "color": "green",
   "points": ["`filter` / `where`", "`select`, `withColumn`, `drop`", "`union`", "`coalesce(n)`: merges partitions in place", "broadcast join: the small table is copied to every executor, the big one stays put"],
   "foot": "Chained together inside one stage"}
 ]}
```

## 🕸️ What a DAG is

**DAG** means *directed acyclic graph*. The nodes are the steps of your query. An arrow means "this step needs the output of that one". *Directed*: data flows one way. *Acyclic*: no loops, so Spark can always find an order to run the steps, and can recompute any piece from its parents.

```viz flow
{"title": "The DAG of the example query",
 "nodes": [{"icon": "📂", "title": "Scan", "sub": "fact_orders", "color": "teal"},
           {"icon": "🔎", "title": "Filter", "sub": "status = COMPLETED", "color": "teal"},
           {"icon": "➕", "title": "Partial count", "sub": "per product, per partition", "color": "teal"},
           {"icon": "🧮", "title": "Final count", "sub": "per product", "color": "blue"},
           {"icon": "🏁", "title": "show()", "sub": "the action", "color": "navy"}],
 "edges": ["narrow", "narrow", "WIDE: shuffle", "to driver"],
 "steps": [
  {"label": "The graph", "focus": [0, 1, 2, 3, 4], "note": "Each box is an operator, each arrow a dependency. With a join, two scans would feed one box: that is why it is a graph, not a list."},
  {"label": "Narrow dependencies", "focus": [0, 1, 2], "note": "Each output partition needs **one** input partition. One task pushes its rows through scan, filter and partial count without stopping. This is called **pipelining**."},
  {"label": "Wide dependency", "focus": [2, 3], "note": "The final count of product 1 needs partial counts from **all** partitions. That arrow is a shuffle."},
  {"label": "Stage 1", "focus": [0, 1, 2], "note": "The **DAG scheduler** walks back from the action and cuts at every wide dependency. Everything before the cut is stage 1."},
  {"label": "Stage 2", "focus": [3, 4], "note": "Everything after the cut is stage 2. It only starts when stage 1 is complete."}
 ]}
```

## 🧱 Jobs, stages and tasks, with numbers

Each stage becomes a **task set**: one task per partition. Our example, using the numbers from the picture:

| Level | In the example | Comes from |
|---|---|---|
| Job | 1 | one action: `.show()` |
| Stages | 2 | one shuffle cuts the DAG once |
| Tasks in stage 1 | 3 | one per input partition (file chunks) |
| Tasks in stage 2 | 2 | one per shuffle partition, after AQE |

With 2 workers × 8 cores there are 16 slots, so all tasks of a stage run at once. Real numbers depend on file sizes and on AQE, which can also show one action as several small jobs. To see the DAG: on classic compute open the **Spark UI** (a job's *DAG Visualization*); on serverless open the cell's **query profile**.

## 🛟 When a machine fails

Spark does not copy intermediate data to be safe. It keeps the **recipe**: the DAG, also called the **lineage**. Any lost piece can be rebuilt from its parents.

```viz timeline
{"title": "What the driver does when something breaks",
 "items": [
  {"label": "1", "title": "A task fails", "color": "amber", "note": "The driver retries it, often on another executor. By default a task may fail 4 times before the job fails."},
  {"label": "2", "title": "An executor is lost", "color": "red", "note": "A worker VM disappears. The driver re-runs its running tasks elsewhere. Lineage says how: re-read the same file chunk, apply the same filter."},
  {"label": "3", "title": "Shuffle files are lost", "color": "red", "note": "Finished map output lived on that worker's disk. Reducers get a fetch failure, and the driver re-runs **only the map tasks** whose files were lost, then stage 2 continues."},
  {"label": "4", "title": "The driver is lost", "color": "navy", "note": "The plan, the schedule and the results live on the driver. The whole application fails and must be re-run. A Lakeflow Job can retry it for you."},
  {"label": "✓", "title": "Why this works", "color": "green", "note": "The DAG is acyclic and the inputs (a Delta table version) do not change, so recomputing a partition gives the same rows."}
 ]}
```

## 🧪 Try it: run the example and find the shuffle

```dataset retail
```

Run the example. The first two lines only build a plan on the driver. The `show` is the action.

```python run
# The example query: transformations build a plan, show() runs it
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
per_product = (orders.filter(F.col("status") == "COMPLETED")
                     .groupBy("product_id").count())
per_product.orderBy(F.desc("count")).show(5)
```

```python run
# The plan of the aggregation: find the shuffle
per_product.explain(mode="formatted")
```

> Look for an **Exchange** with `hashpartitioning(product_id, …)`: that is the shuffle and the stage boundary. With Photon the operator name may carry a Photon prefix; `hashpartitioning(` is the reliable thing to look for. You also see a partial and a final aggregate around it.

```python run
# A narrow-only query: no Exchange in its plan
narrow = (orders.filter(F.col("status") == "COMPLETED")
                .select("order_id", "product_id", "quantity")
                .withColumn("big_order", F.col("quantity") > 5))
narrow.explain()
```

Now look at the partitions themselves. `df.rdd` does not exist on serverless, but `F.spark_partition_id()` tells you which partition each row is in.

```python run
# Rows per partition as the table is read
(orders.withColumn("partition", F.spark_partition_id())
       .groupBy("partition").count()
       .orderBy("partition").show())
```

A small demo table is often one file, so you may see a single partition. Now shuffle it on purpose into 4 partitions by `product_id`.

```python run
# After a hash repartition by product_id: rows and products per partition
by_product = orders.repartition(4, "product_id").withColumn("partition", F.spark_partition_id())
(by_product.groupBy("partition")
           .agg(F.count("*").alias("rows"), F.countDistinct("product_id").alias("products"))
           .orderBy("partition").show())
```

```python run
# Proof: every product lives in exactly one partition
(by_product.groupBy("product_id")
           .agg(F.countDistinct("partition").alias("partitions_holding_it"), F.count("*").alias("rows"))
           .orderBy(F.desc("rows")).show(5))
```

> `partitions_holding_it` is 1 for every product: that is what a hash shuffle guarantees. Product 1 has far more rows than the others, so its partition is the biggest. That is **skew**.

## Exercise 1: predict the shuffles

For each query, predict **before** you look: how many shuffles, and how many stages? Then print the plan lines that repartition data.

```python todo
# TODO: write your predictions, then uncomment the last line
from pyspark.sql import functions as F
import io, contextlib

def shuffle_lines(df):
    """Print the physical plan lines that repartition data (one per shuffle)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        df.explain()
    lines = [l.strip() for l in buf.getvalue().splitlines() if "partitioning(" in l]
    print(len(lines), "line(s)")
    for l in lines:
        print("   ", l[:110])

orders = spark.table("fact_orders")
q1 = orders.filter(F.col("quantity") > 3).select("order_id", "quantity")
q2 = orders.join(spark.table("dim_customer"), "customer_id").groupBy("region").count()
q3 = orders.select("customer_id").distinct().orderBy("customer_id")

# q1: shuffles = ?, stages = ?   q2: shuffles = ?, stages = ?   q3: shuffles = ?, stages = ?
# for q in (q1, q2, q3): shuffle_lines(q)
```

```python solution
for q in (q1, q2, q3):
    shuffle_lines(q)

# q1: 0 shuffles, 1 stage. filter and select are narrow.
# q2: 1 shuffle, 2 stages. dim_customer (500 rows) is broadcast, so the join does not shuffle
#     (you see a BroadcastExchange, which has no "partitioning("). Only groupBy(region) shuffles.
#     If both tables were big, a sort-merge join would add a hashpartitioning on each side.
# q3: 2 shuffles, 3 stages. distinct -> hashpartitioning(customer_id), orderBy -> rangepartitioning.
```

## Exercise 2: driver or executors?

For each numbered line, decide where the real work happens: on the **driver**, on the **executors**, or both. Then run the cell.

```python todo
# TODO: after each "# n" write DRIVER, EXECUTORS or BOTH, and why
from pyspark.sql import functions as F

orders = spark.table("fact_orders")                                         # 1
net = orders.withColumn("net_qty", F.col("quantity") * (1 - F.col("discount")))  # 2 (the multiplication)
top = net.filter(F.col("net_qty") > 5).limit(3).collect()                   # 3
for row in top:                                                             # 4
    print(row["order_id"], round(row["net_qty"], 2))
print(net.count())                                                          # 5
```

```python solution
# 1 DRIVER: looks up the table in Unity Catalog and starts a plan. No rows are read.
# 2 DRIVER builds the expression; the multiplication itself runs later on the EXECUTORS, once per row.
# 3 BOTH: executors read, compute and filter; the 3 collected rows travel to the driver.
# 4 DRIVER: plain Python looping over a local list of 3 Row objects.
# 5 BOTH: executors count their partitions, the driver receives one number.

# Nothing to clean up: this module created no tables.
```

## ⚠️ Common mistakes

- ❌ "The driver reads the table and sends rows to the workers." Executors read their chunks directly from cloud storage.
- ❌ `collect()` or `toPandas()` on a big DataFrame. Every row goes to the one driver machine.
- ❌ "A new stage starts at every transformation." Stages split only at **shuffles**.
- ❌ "More workers fix a skewed `groupBy`." All rows of one hot key are still one task on one core.
- ❌ "`coalesce` and `repartition` are the same." `repartition` shuffles. `coalesce` only merges partitions.
- ✅ Filter and select early so less data reaches the shuffle. Broadcast small tables in joins.
- ✅ Read `explain()` and look for `Exchange` before you tune anything.

## 🧭 Cheat sheet

| Term | In one line |
|---|---|
| Driver | One process: plans, builds the DAG, schedules tasks, receives results |
| Executor | Process on a worker node that runs tasks. Cores = task slots |
| Shuffle | Regroup rows by key across machines: local disk + network |
| DAG | Graph of steps; cut at wide dependencies into stages |
| Job / stage / task | One action / work between shuffles / one partition on one core |
| Find the shuffles | `Exchange` and `hashpartitioning(` in `df.explain()` |
