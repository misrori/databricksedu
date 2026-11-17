---
title: "Relational operations: joins and set operations"
summary: Combine DataFrames with the right join type, avoid the duplicate-column trap, stack DataFrames safely with unionByName, and use intersect, subtract, exceptAll, distinct, sort and limit.
icon: 🔗
level: Beginner
minutes: 11
group: Developing applications with Spark
tags: [Apache Spark, PySpark, Joins, Union, Set operations]
---
# Relational operations: joins and set operations

> A join puts columns of two DataFrames side by side. A set operation stacks rows of two DataFrames on top of each other. Both look simple, and both have one or two traps that silently give wrong numbers.

**The one idea to remember:** pick the join type by asking **which rows must survive when there is no match**, and stack DataFrames with `unionByName`, never by position.

## 🤝 Join types on two tiny tables

Customers 1, 2, 3 and orders for customers 1, 1, 2 and 9. Step through `customers.join(orders, "customer_id", how)`.

```viz table
{"title": "customers.join(orders, \"customer_id\", how)",
 "columns": ["customer_id", "name", "order_id"],
 "rows": [[1, "Ann", 101], [1, "Ann", 102], [2, "Bob", 103]],
 "steps": [
  {"label": "inner", "note": "Only keys found on **both** sides. Ann has two orders, so she appears twice."},
  {"label": "left", "note": "Every customer survives. Cy has no order, so `order_id` is null.", "add": [[3, "Cy", null]]},
  {"label": "full", "note": "Every row of both sides survives. Order 104 belongs to customer 9, who is not in `customers`.", "add": [[9, null, 104]]},
  {"label": "right", "note": "Every **order** survives, unmatched customers do not. Cy disappears again.", "hide": [3]}
 ]}
```

The default `how` is `"inner"`. Spark also accepts `"outer"` for `"full"`. For **how** Spark executes a join (broadcast, sort-merge, shuffles), see "Joins and shuffles".

## 🧪 Try it: every join type

```dataset retail
```

Build the two tiny tables from the slide and run each join type on them.

```python run
# The tiny tables from the slide, joined in every way
from pyspark.sql import functions as F

customers = spark.createDataFrame([(1, "Ann"), (2, "Bob"), (3, "Cy")], "customer_id INT, name STRING")
orders = spark.createDataFrame([(101, 1), (102, 1), (103, 2), (104, 9)], "order_id INT, customer_id INT")

for how in ["inner", "left", "right", "full", "left_semi", "left_anti"]:
    print(f"--- {how}")
    customers.join(orders, "customer_id", how).orderBy("customer_id").show()
```

Notice that `left_semi` and `left_anti` return **only the customer columns**.

## 🔍 Semi, anti and cross joins

```viz compare
{"items": [{"icon": "✅", "title": "left_semi", "sub": "\"has at least one match\"", "color": "green",
            "points": ["Keeps left rows that match", "Left columns only", "Never duplicates a row: Ann appears **once**"], "foot": "Result: Ann, Bob"},
           {"icon": "🚫", "title": "left_anti", "sub": "\"has no match\"", "color": "red",
            "points": ["Keeps left rows that do **not** match", "Left columns only", "Safer than a left join + `isNull` filter"], "foot": "Result: Cy"},
           {"icon": "✖️", "title": "crossJoin", "sub": "every pair", "color": "amber",
            "points": ["No join key at all", "Rows = left × right", "❌ explodes fast on real tables"], "foot": "Result: 3 × 4 = 12 rows"}]}
```

```python run
# Which customers ordered in the last week of October 2026, and which did not?
dim_customer = spark.table("dim_customer")
last_week = spark.table("fact_orders").filter(F.col("order_date").between("2026-10-25", "2026-10-31"))

active = dim_customer.join(last_week, "customer_id", "left_semi")
inactive = dim_customer.join(last_week, "customer_id", "left_anti")
print(active.count(), "+", inactive.count(), "= 500 customers")

inactive.write.mode("overwrite").saveAsTable("rel_inactive_customers")
print(dim_customer.crossJoin(spark.table("dim_product")).count(), "customer-product pairs")
```

## 🧷 Join on a name, or on an expression

Joining on a column **name** keeps one copy of the key. Joining on an **expression** keeps both copies, and a later `select("customer_id")` cannot tell them apart.

```viz code
title: the duplicate-column problem
lang: python
---
o = spark.table("fact_orders")
c = spark.table("dim_customer")

by_expr = o.join(c, o.customer_id == c.customer_id)
by_expr.select("customer_id")         # error: AMBIGUOUS_REFERENCE

by_name = o.join(c, "customer_id")    # or on=["customer_id", ...]
by_name.select("customer_id")         # works: one key column

fixed = by_expr.drop(c.customer_id)   # keep only the copy you need
---
4 | expression | Two columns named `customer_id` end up in the result.
5 | ambiguous | Spark cannot choose, so it raises an error.
7-8 | by name | The key is merged into one column. Use this when the names match.
10 | drop | With an expression, drop the copy you do not need, or alias both sides.
```

Use an expression when the key names differ, or the condition is more than equality: `o.order_date >= c.valid_from`.

```python run
# Expression join with aliases: every column stays addressable
o = spark.table("fact_orders").alias("o")
c = spark.table("dim_customer").alias("c")

joined = (o.join(c, F.col("o.customer_id") == F.col("c.customer_id"))
           .select("o.order_id", "o.customer_id", "c.customer_name", "c.region"))
display(joined.limit(5))
```

## ➕ union vs unionByName

`union` matches columns **by position**, like SQL `UNION ALL`. If the second DataFrame has the same columns in another order, values land in the wrong column without any error.

```viz table
{"title": "a (name, city) + b (city, name)",
 "columns": ["name", "city"],
 "rows": [["Ann", "Paris"], ["Bob", "Rome"]],
 "steps": [
  {"label": "a", "note": "Two rows with columns `name, city`."},
  {"label": "a.union(b)", "note": "`b` has the columns in the order `city, name`. Matched by position, **Oslo becomes a name**.", "add": [["Oslo", "Cy"]], "hl": [2]},
  {"label": "a.unionByName(b)", "note": "Matched by **name**, the row is correct.", "upd": {"2": {"name": "Cy", "city": "Oslo"}}}
 ]}
```

```python run
# union by position, by name, and with a missing column
a = spark.createDataFrame([("Ann", "Paris"), ("Bob", "Rome")], "name STRING, city STRING")
b = spark.createDataFrame([("Oslo", "Cy")], "city STRING, name STRING")
d = spark.createDataFrame([("Dee",)], "name STRING")

a.union(b).show()                                       # wrong, and no error
a.unionByName(b).show()                                 # correct
a.unionByName(d, allowMissingColumns=True).show()      # city is null for Dee
```

## 🧮 intersect, subtract, exceptAll, distinct

For `a` = 1, 1, 2, 3 and `b` = 1, 3, 4:

| Method | SQL | Result |
|---|---|---|
| `a.union(b)` | `UNION ALL` | 1, 1, 1, 2, 3, 3, 4 (keeps duplicates) |
| `a.union(b).distinct()` | `UNION` | 1, 2, 3, 4 |
| `a.intersect(b)` | `INTERSECT` | 1, 3 |
| `a.subtract(b)` | `EXCEPT` | 2 (distinct rows of `a` not in `b`) |
| `a.exceptAll(b)` | `EXCEPT ALL` | 1, 2 (removes one 1 per 1 in `b`) |

```python run
# Check the table above
a = spark.createDataFrame([(1,), (1,), (2,), (3,)], "x INT")
b = spark.createDataFrame([(1,), (3,), (4,)], "x INT")

for name, df in [("union", a.union(b)), ("union.distinct", a.union(b).distinct()),
                 ("intersect", a.intersect(b)), ("subtract", a.subtract(b)), ("exceptAll", a.exceptAll(b))]:
    print(f"{name:<15}", sorted(r.x for r in df.collect()))
```

Set operations compare **whole rows**. To remove duplicates by some columns only, use `dropDuplicates(["customer_id"])`.

## 🔢 Sort and limit

`orderBy` and `sort` are the same method. A global sort is a wide transformation: Spark samples the data, splits it into ranges and shuffles every row into its range.

```python run
# The five best-selling products by units, saved as a table
top_products = (spark.table("fact_orders")
    .filter(~F.col("status").isin("TEST", "CANCELLED"))
    .join(spark.table("dim_product"), "product_id")
    .groupBy("product_name", "category")
    .agg(F.sum("quantity").alias("units"))
    .orderBy(F.desc("units"), "product_name")      # same as .sort(...)
    .limit(5))

top_products.write.mode("overwrite").saveAsTable("rel_top_products")
display(top_products)
```

- `F.desc("c")`, `F.col("c").desc_nulls_last()` control direction and where NULLs go.
- `limit` without `orderBy` returns **any** n rows, not the first ones.

## Exercise 1: who never bought Electronics?

Split the 500 customers into those who ordered at least one Electronics product (real orders only) and those who never did. **Predict first**: is the second group large or small? Books outsell Electronics about six to one.

```python todo
from pyspark.sql import functions as F

customers = spark.table("dim_customer")
electronics_orders = (spark.table("fact_orders")
    .filter(~F.col("status").isin("TEST", "CANCELLED"))
    .join(spark.table("dim_product").filter(F.col("category") == "Electronics"), "product_id"))

# TODO 1: customers with at least one Electronics order (left_semi), count them
# TODO 2: customers with none (left_anti), count them
```

```python solution
buyers = customers.join(electronics_orders, "customer_id", "left_semi")
never = customers.join(electronics_orders, "customer_id", "left_anti")
print(buyers.count(), never.count())
# Almost every customer has bought Electronics: each one places about 100 orders,
# so even a rare category is hit at least once. The two counts always add up to 500.
```

## Exercise 2: fix the ambiguous column

The commented line fails. Predict the error, then fix the join twice: once by joining on the column name, once by keeping the expression and dropping one copy.

```python todo
from pyspark.sql import functions as F

o = spark.table("fact_orders")
c = spark.table("dim_customer")
# o.join(c, o.customer_id == c.customer_id).select("customer_id", "customer_name", "order_id").show(3)

# TODO 1: the same select, joining on the column name
# TODO 2: the same select, keeping the expression join and dropping c.customer_id
```

```python solution
o.join(c, "customer_id").select("customer_id", "customer_name", "order_id").show(3)

(o.join(c, o.customer_id == c.customer_id)
  .drop(c.customer_id)
  .select("customer_id", "customer_name", "order_id")
  .show(3))
# The original fails with AMBIGUOUS_REFERENCE: two columns are called customer_id.
```

## Exercise 3: who came back?

Find the customers who ordered in **both** September and October 2026, and those who ordered in October but **not** in September. Predict: what do the two counts add up to?

```python todo
from pyspark.sql import functions as F

real = spark.table("fact_orders").filter(~F.col("status").isin("TEST", "CANCELLED"))
sep_ids = real.filter(F.col("order_date").between("2026-09-01", "2026-09-30")).select("customer_id")
oct_ids = real.filter(F.col("order_date").between("2026-10-01", "2026-10-31")).select("customer_id")

# TODO 1: returning customers = in both months (intersect); save as rel_returning
# TODO 2: new in October (subtract)
# TODO 3: compare with the distinct customer count of October
```

```python solution
returning = oct_ids.intersect(sep_ids)
new_in_oct = oct_ids.subtract(sep_ids)
returning.write.mode("overwrite").saveAsTable("rel_returning")

print(returning.count(), "+", new_in_oct.count(), "=", oct_ids.distinct().count())
# intersect and subtract both return distinct rows, so they add up to the distinct October customers.
# oct_ids.exceptAll(sep_ids) counts rows instead: a customer stays once for every
# October order beyond their number of September orders.

# Clean up the demo tables when you are done
# spark.sql("DROP TABLE IF EXISTS rel_returning")
# spark.sql("DROP TABLE IF EXISTS rel_inactive_customers")
# spark.sql("DROP TABLE IF EXISTS rel_top_products")
```

## ⚠️ Common mistakes

- ❌ `union` of DataFrames whose columns are in a different order. No error, wrong data. Use `unionByName`.
- ❌ Expecting `union` to remove duplicates. It is `UNION ALL`; add `.distinct()`.
- ❌ A left join + `filter(F.col("x").isNull())` to find non-matches. If `x` can be NULL in the right table, you get extra rows. Use `left_anti`.
- ❌ Joining on a key that is not unique on the "one" side. Rows multiply and sums double.
- ✅ Join on the column name when the names match, so the key appears once.

## 🧭 Cheat sheet

| I want… | PySpark |
|---|---|
| Matching rows, plus all of the left side | `a.join(b, "id", "left")` |
| Left rows that have / have no match | `"left_semi"` / `"left_anti"` |
| Every combination | `a.crossJoin(b)` |
| Stack rows safely | `a.unionByName(b, allowMissingColumns=True)` |
| Rows in both / only in `a` | `a.intersect(b)` / `a.subtract(b)` or `a.exceptAll(b)` |
| Top n | `df.orderBy(F.desc("x")).limit(n)` |
