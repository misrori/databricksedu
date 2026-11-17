---
title: Grouping and aggregating data
summary: Turn many rows into one row per group with groupBy and agg. Count correctly around NULLs, filter and sort the groups, pivot values into columns, and add subtotals with rollup and cube.
icon: 🧮
level: Beginner
minutes: 10
group: Developing applications with Spark
tags: [Apache Spark, PySpark, groupBy, Aggregation, Pivot]
---
# Grouping and aggregating data

> Most business questions are aggregates: revenue per category, orders per customer, customers per region. In PySpark you answer them with `groupBy(...)` followed by `agg(...)`.

**The one idea to remember:** `groupBy` collects the rows that share a key into one group, and `agg` turns **each group into exactly one output row**.

## 🧺 What groupBy does

Step through `orders.groupBy("category").agg(F.sum("revenue"))` on five orders.

```viz table
{"title": "orders.groupBy(\"category\").agg(F.sum(\"revenue\"))",
 "columns": ["category", "order_id", "revenue"],
 "rows": [["Books", 1, 30], ["Home", 2, 80], ["Books", 3, 15], ["Sports", 4, 120], ["Home", 5, 160]],
 "steps": [
  {"label": "Input", "note": "Five order rows. The **grouping key** is `category`."},
  {"label": "Group: Books", "note": "Rows 1 and 3 share the key `Books`, so they land in the same group.", "hl": [0, 2]},
  {"label": "Group: Home", "note": "Rows 2 and 5 form the `Home` group. `Sports` is a group of one row.", "hl": [1, 4]},
  {"label": "Aggregate", "note": "Each group becomes **one row**. Columns that are not keys or aggregates, like `order_id`, cannot survive.",
   "hide": [0, 1, 2, 3, 4],
   "add": [["Books", "2 rows", 45], ["Home", "2 rows", 240], ["Sports", "1 row", 120]]}
 ]}
```

`groupBy` is a **wide** transformation: rows with the same key sit in different partitions, so Spark shuffles them together (see "Joins and shuffles").

## 🧩 One groupBy, many aggregates

`agg` takes any number of aggregate expressions. Give each one a name with `alias`, or you get column names like `sum(revenue)`.

```viz code
title: revenue per category
lang: python
---
from pyspark.sql import functions as F

by_category = (orders.groupBy("category")
    .agg(F.count("*").alias("orders"),
         F.countDistinct("customer_id").alias("customers"),
         F.round(F.sum("revenue"), 2).alias("revenue"),
         F.round(F.avg("revenue"), 2).alias("avg_order"),
         F.min("order_date").alias("first_order"),
         F.max("order_date").alias("last_order"))
    .orderBy(F.desc("revenue")))
---
1 | import | The usual alias. Every aggregate function lives in `F`.
3 | groupBy | One output row per distinct `category`.
4 | count | Rows in the group.
5 | countDistinct | Different customers in the group. Costs more than `count`.
6-7 | sum, avg | Wrap in `F.round` for readable output. `alias` names the column.
8-9 | min, max | Work on dates and strings too, not only numbers.
10 | orderBy | The groups come back in no particular order. Sort explicitly.
```

## 🧪 Try it: revenue per category

```dataset retail
```

First build one DataFrame of real orders with a `revenue` column. The later cells reuse it.

```python run
# Real orders, with product and customer columns and revenue
from pyspark.sql import functions as F

orders = (spark.table("fact_orders")
          .filter(~F.col("status").isin("TEST", "CANCELLED"))
          .join(spark.table("dim_product"), "product_id")
          .join(spark.table("dim_customer"), "customer_id")
          .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))))
orders.printSchema()
```

```python run
# Revenue per category, saved as a table
by_category = (orders.groupBy("category")
    .agg(F.count("*").alias("orders"),
         F.countDistinct("customer_id").alias("customers"),
         F.round(F.sum("revenue"), 2).alias("revenue"),
         F.round(F.avg("revenue"), 2).alias("avg_order"))
    .orderBy(F.desc("revenue")))

by_category.write.mode("overwrite").saveAsTable("agg_category_revenue")
display(by_category)
```

Books has by far the most orders, yet Electronics earns the most revenue.

## 🔢 count, NULLs and distinct values

`F.count("*")` counts rows. `F.count("price")` counts only the **non-NULL** values of that column. All other aggregates skip NULLs too.

```viz table
{"title": "Two NULL-free Home rows, one NULL price in Books",
 "columns": ["category", "count(*)", "count(price)", "avg(price)"],
 "rows": [["Books", 2, 1, 10.0], ["Home", 2, 2, 80.0]]}
```

```python run
# See NULL handling, then an approximate distinct count
demo = spark.createDataFrame(
    [("Books", 10.0), ("Books", None), ("Home", 80.0), ("Home", 80.0)], "category STRING, price DOUBLE")
display(demo.groupBy("category").agg(
    F.count("*").alias("rows"), F.count("price").alias("prices"),
    F.countDistinct("price").alias("distinct_prices"), F.avg("price").alias("avg_price")))

display(orders.agg(F.countDistinct("customer_id").alias("exact"),
                   F.approx_count_distinct("customer_id", rsd=0.05).alias("approx")))
```

`approx_count_distinct` uses a small sketch (HyperLogLog++) instead of remembering every value. Use it on huge tables when ±5% is good enough.

## 🔎 Filter and sort the groups

SQL has `HAVING` to filter after grouping. In PySpark you simply call `filter` **after** `agg`, on the aggregated column.

```python run
# Customers who spent more than 35,000: the HAVING equivalent
big_spenders = (orders.groupBy("customer_id", "customer_name", "region")
    .agg(F.round(F.sum("revenue"), 0).alias("revenue"), F.count("*").alias("orders"))
    .filter(F.col("revenue") > 35000)          # runs after the aggregation
    .orderBy(F.desc("revenue"), "customer_id"))
display(big_spenders)
```

- A `filter` **before** `groupBy` is SQL `WHERE`: it removes rows and makes the shuffle smaller.
- A `filter` **after** `agg` is SQL `HAVING`: it removes groups.
- Add a second sort key (`customer_id`) so ties come back in a stable order.

## 🔄 Pivot: values become columns

`pivot` turns the distinct values of one column into columns. Here: one row per region, one column per category.

```python run
# Revenue per region and category, as a grid
categories = ["Books", "Beauty", "Home", "Sports", "Electronics"]

grid = (orders.groupBy("region")
        .pivot("category", categories)
        .agg(F.round(F.sum("revenue"), 0))
        .orderBy("region"))
display(grid)
```

Pass the list of values when you know them. Without it Spark first runs an extra job to find the distinct values, and the column order is not under your control. A combination with no rows becomes `null`, not 0.

## 📊 Subtotals with rollup and cube

`rollup("region", "segment")` returns the normal groups **plus** a subtotal per region **plus** a grand total. The subtotal rows have `null` in the columns that were rolled up.

```viz table
{"title": "orders.rollup(\"region\", \"segment\")",
 "columns": ["region", "segment", "revenue", "grouping_id"],
 "rows": [["APAC", "SMB", 200, 0], ["EMEA", "Consumer", 300, 0], ["EMEA", "SMB", 500, 0]],
 "steps": [
  {"label": "Groups", "note": "Plain `groupBy(\"region\", \"segment\")` rows. `grouping_id` is 0."},
  {"label": "Region subtotals", "note": "One row per region with `segment` = null. `grouping_id` is 1.",
   "add": [["APAC", null, 200, 1], ["EMEA", null, 800, 1]]},
  {"label": "Grand total", "note": "Both columns are null. `grouping_id` is 3 (binary 11).",
   "add": [[null, null, 1000, 3]]}
 ]}
```

```python run
# Subtotals per region and a grand total
subtotals = (orders.rollup("region", "segment")
    .agg(F.round(F.sum("revenue"), 0).alias("revenue"),
         F.grouping_id("region", "segment").alias("grouping_id"))
    .orderBy(F.col("region").asc_nulls_last(), F.col("segment").asc_nulls_last()))
display(subtotals)
```

`cube` adds subtotals for **every** combination, so you also get per-segment totals across all regions. `F.grouping("segment")` is 1 when that column was rolled up, which tells a real `null` apart from a subtotal.

## Exercise 1: check the order statuses

Before you trust any revenue number, look at the raw statuses. Predict roughly what share of `fact_orders` are `TEST` rows, then count them per year.

```python todo
# TODO 1: from fact_orders, count the rows per status, largest first
# TODO 2: pivot: one row per year (F.year("order_date")), one column per status
from pyspark.sql import functions as F

raw = spark.table("fact_orders")
```

```python solution
from pyspark.sql import functions as F

raw = spark.table("fact_orders")
display(raw.groupBy("status").count().orderBy(F.desc("count")))   # TEST is about 2%

statuses = ["COMPLETED", "OPEN", "CANCELLED", "TEST"]
display(raw.groupBy(F.year("order_date").alias("year"))
           .pivot("status", statuses).count()
           .orderBy("year"))
```

## Exercise 2: big spenders per region

Count how many customers per region spent more than 35,000 in total. Which region do you expect on top, and why?

```python todo
from pyspark.sql import functions as F

orders = (spark.table("fact_orders")
          .filter(~F.col("status").isin("TEST", "CANCELLED"))
          .join(spark.table("dim_product"), "product_id")
          .join(spark.table("dim_customer"), "customer_id")
          .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))))

# TODO 1: revenue per customer and region
# TODO 2: keep customers above 35000 (filter after agg)
# TODO 3: count those customers per region, largest first
```

```python solution
per_customer = (orders.groupBy("region", "customer_id")
                .agg(F.sum("revenue").alias("revenue"))
                .filter(F.col("revenue") > 35000))

display(per_customer.groupBy("region")
        .agg(F.count("*").alias("big_spenders"))
        .orderBy(F.desc("big_spenders")))
# EMEA: it simply has the most customers (about 45%). Two groupBys = two levels of aggregation.
```

## Exercise 3: predict the size of a cube

There are 4 regions and 5 categories. **Before running**, predict how many rows `rollup("region", "category")` and `cube("region", "category")` return. Then check.

```python todo
# Uses the orders DataFrame from Exercise 2
# TODO 1: count the rows of orders.rollup("region", "category").agg(F.sum("revenue"))
# TODO 2: the same with cube, and save the cube as the table agg_region_category
```

```python solution
rolled = orders.rollup("region", "category").agg(F.round(F.sum("revenue"), 0).alias("revenue"))
cubed = orders.cube("region", "category").agg(F.round(F.sum("revenue"), 0).alias("revenue"))

print(rolled.count())   # 25 = 20 groups + 4 region subtotals + 1 grand total
print(cubed.count())    # 30 = 25 + 5 category subtotals
cubed.write.mode("overwrite").saveAsTable("agg_region_category")

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS agg_region_category")
# spark.sql("DROP TABLE IF EXISTS agg_category_revenue")
```

## ⚠️ Common mistakes

- ❌ `groupBy("category").sum("revenue")`, then `F.col("revenue")`. The new column is called `sum(revenue)`. Use `agg` with `alias`.
- ❌ Expecting `F.count("discount")` to count rows. It skips NULLs.
- ❌ Putting a plain column such as `order_id` inside `agg`. It is neither a key nor an aggregate, so Spark raises an error. Add it to the keys or wrap it in `F.first`.
- ❌ Relying on the order of `groupBy` output. Without `orderBy` it is undefined.
- ✅ Filter rows **before** grouping. A smaller input means a smaller shuffle.

## 🧭 Cheat sheet

| I want… | PySpark |
|---|---|
| Several aggregates per group | `df.groupBy("k").agg(F.sum("x").alias("total"), F.count("*").alias("n"))` |
| Distinct values, exact or fast | `F.countDistinct("c")` / `F.approx_count_distinct("c")` |
| SQL `HAVING` | `.agg(...).filter(F.col("total") > 100)` |
| Values as columns | `.groupBy("r").pivot("c", ["a", "b"]).agg(...)` |
| Subtotals and grand total | `.rollup("a", "b")` or `.cube("a", "b")` with `F.grouping_id("a", "b")` |
| Largest groups first | `.orderBy(F.desc("total"))` |
