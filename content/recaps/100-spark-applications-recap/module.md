---
title: "Recap: Developing Applications with Apache Spark"
summary: Recap of module 2 of Apache Spark Programming with Databricks. Aggregate with groupBy, pivot and rollup, pick the right join, rank and run totals with window functions, handle nested data, and keep Python UDFs out of the hot path.
icon: 🧩
level: Intermediate
minutes: 10
group: Apache Spark Programming with Databricks
tags: [DataFrame API, Aggregation, Joins, Window functions, Complex types, UDFs]
---
# Recap: Developing Applications with Apache Spark

> Module 2 of 4. The DataFrame API for real application logic: **aggregations, joins, window functions, nested data** and the performance rules that keep it fast.

**The one idea to remember:** almost every business question is a combination of **group, join, window and reshape**. Express it with **built-in functions** so Spark can optimize it, and reach for a UDF only when nothing built in fits.

## 🗺️ What we covered

```viz timeline
{"title": "The lessons of the module",
 "items": [
  {"label": "1", "title": "DataFrame API basics", "color": "navy", "note": "Columns as expressions, `F.col`, aliases, casts, `when`/`otherwise`."},
  {"label": "2", "title": "Grouping and aggregating", "color": "blue", "note": "`groupBy().agg()`, `pivot`, `rollup` and `cube` for subtotals."},
  {"label": "3", "title": "Relational operations", "color": "teal", "note": "Inner, outer, **semi** and **anti** joins, `unionByName`, set operations."},
  {"label": "4", "title": "Window functions", "color": "purple", "note": "Rank, running totals and previous-row values **without collapsing rows**."},
  {"label": "5", "title": "Complex data", "color": "amber", "note": "STRUCT, ARRAY, MAP, `explode`, `from_json`, higher-order functions."},
  {"label": "6", "title": "Performance best practices", "color": "green", "note": "Built-ins first, **pandas UDFs** before Python UDFs."}
 ]}
```

## 🧰 Columns are expressions

A column is not data, it is an **expression** that Spark evaluates on every partition.

```python
from pyspark.sql import functions as F

orders = (spark.table("fact_orders").join(spark.table("dim_product"), "product_id")
  .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount")))
  .withColumn("size", F.when(F.col("quantity") >= 5, "bulk").otherwise("single"))
  .withColumn("order_id", F.col("order_id").cast("string"))
  .select("order_id", "order_date", F.col("revenue").alias("rev"), "size"))
```

Because these are expressions, the optimizer can reorder, combine and push them down.

## 📊 groupBy and agg

```viz code
title: revenue per region and category
lang: python
---
(orders
  .filter("status = 'COMPLETED'")
  .groupBy("region", "category")
  .agg(F.sum("revenue").alias("revenue"),
       F.countDistinct("customer_id").alias("customers"),
       F.avg("quantity").alias("avg_qty"))
  .orderBy(F.desc("revenue")))
---
2 | Filter first | Fewer rows to shuffle. Filtering early is the cheapest optimization.
3 | Group keys | Rows with the same key must meet, so this causes a **shuffle**.
4-6 | Many metrics, one pass | One `agg()` computes all of them in a single job.
7 | Sort | `orderBy` is another shuffle. Sort only the small, final result.
```

## 🔄 pivot and rollup

`pivot("category")` turns values into columns. `rollup("region", "segment")` adds **subtotal rows** where the rolled-up column is NULL.

```viz table
{"title": "rollup(\"region\", \"segment\").agg(sum(\"revenue\"))",
 "columns": ["region", "segment", "revenue"],
 "rows": [["EMEA", "Consumer", 410], ["EMEA", "Corporate", 290], ["AMER", "Consumer", 530], ["AMER", "Corporate", 370]],
 "steps": [
  {"label": "groupBy", "note": "A plain `groupBy` gives one row per region and segment."},
  {"label": "Subtotals", "note": "`rollup` adds one row per region with `segment = NULL`.", "add": [["EMEA", null, 700], ["AMER", null, 900]], "hl": [4, 5]},
  {"label": "Grand total", "note": "And one row where **both** keys are NULL. `cube` would also add per-segment totals.", "add": [[null, null, 1600]], "hl": [6]}
 ]}
```

## 🔗 Join types

| Join | Keeps | Typical use |
|---|---|---|
| `inner` | Matching rows of both sides | Facts with their dimensions |
| `left` | All left rows, NULLs if no match | Keep every customer |
| `left_semi` | Left rows **that have** a match, left columns only | "Customers who ordered" |
| `left_anti` | Left rows **with no** match | "Customers who never ordered", orphan keys |
| `full` | Everything from both sides | Reconciling two sources |

Semi and anti joins never duplicate left rows, even when the right side has many matches. A small dimension is **broadcast**, so the big side is not shuffled.

## ➕ Unions and set operations

```python
jan = spark.table("orders_jan")
feb = spark.table("orders_feb")

all_orders = jan.unionByName(feb)                         # match by name, not position
all_orders = jan.unionByName(feb, allowMissingColumns=True)  # fill missing columns with NULL

both      = jan.select("customer_id").intersect(feb.select("customer_id"))
jan_only  = jan.select("customer_id").exceptAll(feb.select("customer_id"))
distinct  = all_orders.select("customer_id").distinct()
```

- ❌ `union()` matches columns **by position**. A swapped column silently corrupts data.
- `union` keeps duplicates, like SQL `UNION ALL`. Add `distinct()` if you need SQL `UNION`.

## 🪟 Window functions

A window function computes over a group of related rows but **keeps every row**.

```viz table
{"title": "monthly revenue per category",
 "columns": ["category", "month", "revenue", "result"],
 "rows": [["Books", "Jan", 100, null], ["Books", "Feb", 140, null], ["Books", "Mar", 90, null], ["Toys", "Jan", 60, null], ["Toys", "Feb", 80, null]],
 "steps": [
  {"label": "partitionBy", "note": "`Window.partitionBy(\"category\").orderBy(\"month\")`: each category is its own window.", "hl": [0, 1, 2]},
  {"label": "Running total", "note": "`sum(\"revenue\").over(w)` with frame `unboundedPreceding` to `currentRow`.", "upd": {"0": {"result": 100}, "1": {"result": 240}, "2": {"result": 330}, "3": {"result": 60}, "4": {"result": 140}}},
  {"label": "Restart", "note": "The total **restarts** for Toys, because it is a new partition.", "hl": [3, 4]},
  {"label": "lag", "note": "`lag(\"revenue\", 1).over(w)` gives the previous month instead. The first row of each partition gets NULL.", "upd": {"0": {"result": null}, "1": {"result": 100}, "2": {"result": 140}, "3": {"result": null}, "4": {"result": 60}}}
 ]}
```

## 🏅 Ranking and frames in code

```python
from pyspark.sql.window import Window

w_rank  = Window.partitionBy("category").orderBy(F.desc("revenue"))
w_month = Window.partitionBy("category").orderBy("month")
w_run   = w_month.rowsBetween(Window.unboundedPreceding, Window.currentRow)

(by_month
  .withColumn("rank", F.dense_rank().over(w_rank))      # 1, 2, 2, 3 (ties share)
  .withColumn("rn", F.row_number().over(w_rank))         # 1, 2, 3, 4 (dedupe, top-N)
  .withColumn("running", F.sum("revenue").over(w_run))   # explicit frame
  .withColumn("prev", F.lag("revenue").over(w_month)))   # lag needs no frame
```

`row_number() == 1` per key is the standard way to **keep the latest row**. A window with no `partitionBy` moves all data to one task, so avoid it on big data.

## 🧬 Complex types

```viz compare
{"items": [
  {"icon": "📦", "title": "STRUCT", "sub": "named fields, fixed shape", "color": "blue", "points": ["`F.struct(\"a\", \"b\")`", "Read with `col.field` or `select(\"s.*\")`", "Like a nested row"]},
  {"icon": "📚", "title": "ARRAY", "sub": "a list of one type", "color": "teal", "points": ["`collect_list`, `size`, `array_contains`", "`explode` gives one row per element", "Higher-order: `transform`, `filter`"]},
  {"icon": "🗝️", "title": "MAP", "sub": "key to value", "color": "purple", "points": ["`F.create_map`, `map_keys`", "Look up with `col[\"key\"]`", "Good for sparse attributes"]}
 ]}
```

## 💥 explode, from_json and higher-order functions

```python
events = spark.createDataFrame([('{"user": 7, "items": [{"sku": "B1", "qty": 2}, {"sku": "T9", "qty": 1}]}',)], ["payload"])

parsed = events.select(F.from_json("payload",
    "user INT, items ARRAY<STRUCT<sku: STRING, qty: INT>>").alias("e"))

parsed.select("e.user", F.explode("e.items").alias("item")).select("user", "item.*")   # one row per item
parsed.select(F.transform("e.items", lambda i: i.qty * 10).alias("points"))            # no explode needed
parsed.select(F.filter("e.items", lambda i: i.qty > 1).alias("multi"))
```

Higher-order functions work **inside** the array, so you avoid an explode followed by a regroup (and its shuffle).

## 🐍 UDFs and performance

```viz flow
{"nodes": [
  {"icon": "⚙️", "title": "Executor (JVM / Photon)", "sub": "rows in columnar memory", "color": "blue"},
  {"icon": "📨", "title": "Serialize", "sub": "rows or Arrow batches", "color": "amber"},
  {"icon": "🐍", "title": "Python worker", "sub": "runs your function", "color": "red"},
  {"icon": "↩️", "title": "Back to the JVM", "sub": "deserialize results", "color": "gray"}
 ],
 "edges": ["to Python", "call", "results"],
 "steps": [
  {"label": "Built-in", "focus": [0], "note": "Built-in functions never leave the executor engine. They are optimized and run on **Photon**."},
  {"label": "Python UDF", "focus": [1, 2, 3], "note": "A plain `@udf` ships data to Python and back, **one row at a time**. The optimizer cannot see inside it."},
  {"label": "pandas UDF", "focus": [1, 2], "note": "A `@pandas_udf` sends **Arrow batches** and runs vectorized pandas code. Much faster than a row UDF."}
 ]}
```

Order of preference: **built-in function**, then **pandas UDF**, then Python UDF.

## 🧪 Try it: aggregate, join and rank

```dataset retail
```

One enriched DataFrame of completed **retail** orders feeds every cell below.

```python run
# Enriched completed orders, then a pivot and a rollup with subtotals
from pyspark.sql import functions as F
from pyspark.sql.window import Window

orders = (spark.table("fact_orders").filter("status = 'COMPLETED'")
          .join(spark.table("dim_product"), "product_id")
          .join(spark.table("dim_customer"), "customer_id")
          .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))))

display(orders.groupBy("region").pivot("category").agg(F.round(F.sum("revenue"), 0)))
display(orders.rollup("region", "segment").agg(F.round(F.sum("revenue"), 0).alias("revenue"))
        .orderBy(F.col("region").asc_nulls_last(), F.col("segment").asc_nulls_last()))
```

```python run
# Semi and anti joins: who ordered, who never did. Predict: do the two counts add up to 500?
customers = spark.table("dim_customer")
buyers = customers.join(spark.table("fact_orders").filter("status = 'COMPLETED'"), "customer_id", "left_semi")
never = customers.join(spark.table("fact_orders").filter("status = 'COMPLETED'"), "customer_id", "left_anti")
print("bought:", buyers.count(), " never bought:", never.count(), " all customers:", customers.count())
```

```python run
# Window functions: top 2 products per category, and a running monthly total
by_product = orders.groupBy("category", "product_name").agg(F.round(F.sum("revenue"), 0).alias("revenue"))
w_rank = Window.partitionBy("category").orderBy(F.desc("revenue"))
top2 = by_product.withColumn("rank", F.dense_rank().over(w_rank)).filter("rank <= 2")
top2.write.mode("overwrite").saveAsTable("sar_top_products")
display(spark.table("sar_top_products").orderBy("category", "rank"))

monthly = orders.groupBy(F.trunc("order_date", "month").alias("month")).agg(F.round(F.sum("revenue"), 0).alias("revenue"))
w_run = Window.orderBy("month").rowsBetween(Window.unboundedPreceding, Window.currentRow)   # small: 22 rows
display(monthly.withColumn("running_total", F.sum("revenue").over(w_run)).orderBy("month"))
```

## 🧪 Try it: nested data and UDF speed

```python run
# Complex types: one row per customer with an array of order structs, then explode it back
baskets = (orders.groupBy("customer_id", "customer_name")
    .agg(F.collect_list(F.struct("order_id", "product_name", "quantity")).alias("items"))
    .withColumn("n_items", F.size("items"))
    .withColumn("bulk_items", F.filter("items", lambda i: i.quantity >= 3)))
baskets.write.mode("overwrite").saveAsTable("sar_baskets")

display(spark.table("sar_baskets").select("customer_name", "n_items", F.size("bulk_items").alias("n_bulk")).limit(5))
display(spark.table("sar_baskets").select("customer_name", F.explode("items").alias("item"))
        .select("customer_name", "item.*").limit(5))
```

```python run
# Python UDF vs pandas UDF vs built-in on 3 million rows
import time
import pandas as pd
from pyspark.sql.functions import pandas_udf

df = spark.range(3_000_000).withColumn("price", (F.col("id") % 1000) / 10)
py_udf = F.udf(lambda p: p * 1.27, "double")

@pandas_udf("double")
def pd_udf(p: pd.Series) -> pd.Series:
    return p * 1.27

for name, col in [("Python UDF", py_udf("price")), ("pandas UDF", pd_udf("price")), ("built-in", F.col("price") * 1.27)]:
    start = time.time()
    df.select(F.sum(col)).collect()
    print(f"{name:<11} {time.time() - start:5.1f} s")

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS sar_top_products"); spark.sql("DROP TABLE IF EXISTS sar_baskets")
```

## ⚠️ Common mistakes

- ❌ `union()` on DataFrames whose columns are in a different order. Use **`unionByName`**.
- ❌ A left join plus `WHERE right.id IS NULL` instead of a **`left_anti`** join.
- ❌ A window with no `partitionBy` on a big table. Everything lands in **one task**.
- ❌ `explode` then `groupBy` just to change array elements. Use **`transform`** or **`filter`**.
- ❌ A Python UDF for `lower`, `trim`, `regexp_replace` or date math. A built-in exists.
- ❌ `rank()` to dedupe. Ties give two rows with rank 1. Use **`row_number()`**.

## 🧭 Cheat sheet

| Question | Use |
|---|---|
| Totals per group | `groupBy().agg()` |
| Subtotals and a grand total | `rollup` (or `cube`) |
| Rows that have / lack a match | `left_semi` / `left_anti` join |
| Stack two DataFrames safely | `unionByName` |
| Rank, running total, previous row | Window + `dense_rank`, `sum`, `lag` |
| JSON string to columns | `from_json` with a schema |
| Custom logic, no built-in | **pandas UDF** |

**Next module:** *Stream Processing with Apache Spark*. The deep dives are the Grouping and aggregating, Relational operations, Window functions, Complex data types and Python UDFs modules.
