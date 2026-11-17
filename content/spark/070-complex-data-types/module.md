---
title: Working with complex data types
summary: Build and query struct, array and map columns, nest rows with collect_list and flatten them back with explode, parse JSON with a schema, and change arrays in place with higher-order functions.
icon: 🪆
level: Intermediate
minutes: 12
group: Developing applications with Spark
tags: [Spark, DataFrames, Struct, Array, Map, JSON, Higher-order functions]
---
# Working with complex data types

> Real data is often nested: a customer with a list of orders, an event with a JSON payload, a device with a map of settings. Spark stores these as **struct**, **array** and **map** columns, so one row can hold a whole document.

**The one idea to remember:** `collect_list` folds many rows into one array, `explode` unfolds one array into many rows, and **higher-order functions** let you work on the array without unfolding it at all.

## 🧱 Three complex types

```viz compare
{"title": "One column can hold more than one value",
 "items": [{"icon": "📦", "title": "struct", "sub": "fixed, named fields", "color": "blue",
            "points": ["Like a small row inside a row", "`profile.region` reads one field", "Each field has its own type"],
            "foot": "STRUCT<region: STRING, segment: STRING>"},
           {"icon": "📚", "title": "array", "sub": "ordered list, one type", "color": "green",
            "points": ["Any length, can be empty", "`element_at(a, 1)` is the first item", "Items can be structs"],
            "foot": "ARRAY<STRUCT<order_id: BIGINT, …>>"},
           {"icon": "🗝️", "title": "map", "sub": "key → value pairs", "color": "purple",
            "points": ["Keys are unique, one key type", "`element_at(m, 'k')` looks up a key", "Good for sparse attributes"],
            "foot": "MAP<STRING, DOUBLE>"}]}
```

A struct has a fixed shape known in the schema. Arrays and maps vary in length from row to row.

## 🏗️ Building nested columns

```python
from pyspark.sql import functions as F

df.select(
    F.struct("region", "segment").alias("profile"),                 # struct
    F.array("quantity", F.lit(1)).alias("qty_pair"),                 # array
    F.create_map(F.lit("qty"), "quantity",
                 F.lit("disc"), "discount").alias("attrs"),         # map from key, value, key, value
    F.map_from_arrays(F.array(F.lit("a"), F.lit("b")),
                      F.array(F.lit(1), F.lit(2))).alias("m"))      # map from two arrays
```

Read a struct field with a dot: `F.col("profile.region")`, or select every field with `"profile.*"`. A dot on an **array of structs** returns an array: `orders.quantity` is the list of all quantities.

## 💥 explode: one row becomes many

```viz table
{"title": "explode(orders) on a nested customer table", "columns": ["customer_id", "orders", "order"],
 "rows": [[7, "[{101}, {102}, {103}]", "…"], [9, "[{104}]", "…"], [12, "NULL", "…"]],
 "steps": [
  {"label": "Nested input", "note": "Three rows. Customer 7 has three orders in one array, customer 12 has none."},
  {"label": "explode(orders)", "note": "Every array item becomes its own row. The other columns are copied onto each new row.",
   "hide": [0, 1, 2], "add": [[7, "", "{101}"], [7, "", "{102}"], [7, "", "{103}"], [9, "", "{104}"]]},
  {"label": "Where is 12?", "note": "`explode` drops rows whose array is NULL or empty. Customer 12 silently disappeared.", "hl": [3, 4, 5, 6]},
  {"label": "explode_outer(orders)", "note": "`explode_outer` keeps such rows and puts NULL in the new column.",
   "add": [[12, "", null]]},
  {"label": "And back", "note": "`groupBy(customer_id).agg(collect_list(order))` folds the rows into arrays again. `collect_list` skips NULLs, so 12 gets an empty array.", "hl": [3, 4, 5, 6, 7]}
 ]}
```

## 🔀 The explode family and its opposites

| Function | Output | Use it when |
|---|---|---|
| `explode(a)` | one row per item; drops NULL and empty arrays | you only care about items |
| `explode_outer(a)` | same, but keeps those rows with NULL | you must not lose parent rows |
| `posexplode(a)` | `pos` and `col`: item plus its 0-based position | order matters |
| `collect_list` / `collect_set` | rows back into an array (set removes duplicates) | the reverse direction |

`explode` on a **map** gives two columns, `key` and `value`. `collect_list` does not promise an order, so wrap it in `sort_array` when order matters.

## 🧪 Try it: nest and flatten the orders

```dataset retail
```

Build one row per customer with an array of their October 2026 orders. Putting `order_date` first in the struct makes `sort_array` sort by date.

```python run
# Nest: one row per customer, orders as an array of structs
from pyspark.sql import functions as F

october = spark.table("fact_orders").filter((F.col("status") == "COMPLETED") & (F.col("order_date") >= "2026-10-01"))
per_customer = (october.groupBy("customer_id")
    .agg(F.sort_array(F.collect_list(
        F.struct("order_date", "order_id", "product_id", "quantity", "discount"))).alias("orders")))

(spark.table("dim_customer")
    .select("customer_id", "customer_name", F.struct("region", "segment").alias("profile"))
    .join(per_customer, "customer_id", "left")
    .write.mode("overwrite").saveAsTable("cx_customer_orders"))

spark.table("cx_customer_orders").printSchema()
```

```python run
# Query nested data without flattening it
cx = spark.table("cx_customer_orders")
display(cx.filter(F.col("orders").isNotNull()).select(
    "customer_name",
    "profile.region",                                          # struct field
    F.size("orders").alias("n_orders"),
    F.element_at("orders", -1)["order_date"].alias("last_order"),   # 1-based, -1 = last
    F.array_contains("orders.product_id", 1).alias("bought_product_1")))   # array of structs -> array of ids
```

```python run
# Flatten it back: explode vs explode_outer
flat = cx.select("customer_id", F.explode("orders").alias("o")).select("customer_id", "o.*")
outer = cx.select("customer_id", F.explode_outer("orders").alias("o"))

print("customers:            ", cx.count())
print("rows after explode:   ", flat.count(), "(same as October orders:", october.count(), ")")
print("rows after explode_outer:", outer.count(), "(customers without orders are kept)")
display(flat.limit(5))
```

## 🧾 JSON strings in, JSON strings out

Files and Kafka messages often carry JSON as a plain string. `from_json` parses it with a schema you give as a DDL string; `to_json` turns a struct back into a string. `schema_of_json` guesses a DDL schema from one sample.

```python run
# Round trip: struct -> JSON string -> struct
sample = '{"device": "t-17", "tags": ["lab", "roof"], "reading": {"temp": 21.5, "unit": "C"}}'
spark.range(1).select(F.schema_of_json(F.lit(sample)).alias("ddl")).show(truncate=False)

as_json = cx.select("customer_id", F.to_json(F.struct("profile", "orders")).alias("payload"))
ddl = ("profile STRUCT<region: STRING, segment: STRING>, "
       "orders ARRAY<STRUCT<order_date: DATE, order_id: BIGINT, product_id: BIGINT, quantity: INT, discount: DOUBLE>>")
parsed = as_json.select("customer_id", F.from_json("payload", ddl).alias("p"))
display(parsed.select("customer_id", "p.profile.region", F.size("p.orders").alias("n_orders")).limit(5))
```

> Fields that do not match the schema become NULL instead of failing the query. Check for unexpected NULLs after parsing.

## λ Higher-order functions: work inside the array

```viz code
title: higher-order functions on cx_customer_orders.orders
lang: python
---
cx.select(
    "customer_id",
    F.transform("orders", lambda o: o["quantity"] * (1 - o["discount"])).alias("net_units"),
    F.filter("orders", lambda o: o["discount"] > 0).alias("discounted"),
    F.aggregate("orders", F.lit(0), lambda acc, o: acc + o["quantity"]).alias("total_qty"),
    F.exists("orders", lambda o: o["quantity"] >= 5).alias("has_big_order"))
---
3 | transform | Applies the lambda to every item and returns a new array of the **same length**.
4 | filter | Keeps only the items where the lambda is true. The array gets shorter.
5 | aggregate | Folds the array into one value: start at 0, add each quantity. The start value sets the type.
6 | exists | True if **any** item matches. `forall` asks whether all items match.
```

The lambdas are not Python running row by row: they are translated into Spark expressions, so they run in the engine like any built-in. In SQL the same reads `transform(orders, o -> o.quantity)`.

## 🧪 Try it: change arrays in place

Run the functions from the previous slide on `cx_customer_orders`. Each customer stays one row: nothing is exploded, nothing is shuffled.

```python run
# Higher-order functions keep one row per customer
display(cx.filter(F.col("orders").isNotNull()).select(
    "customer_id",
    F.transform("orders", lambda o: o["quantity"] * (1 - o["discount"])).alias("net_units"),
    F.size(F.filter("orders", lambda o: o["discount"] > 0)).alias("n_discounted"),
    F.aggregate("orders", F.lit(0), lambda acc, o: acc + o["quantity"]).alias("total_qty"),
    F.exists("orders", lambda o: o["quantity"] >= 5).alias("has_big_order")).limit(10))
```

## Exercise 1: which regions buy each product?

Build `cx_product_regions` with one row per product: the product name, a **set** of regions that ordered it, and how many regions that is. Predict first: what is the largest possible `n_regions`? Then list the products that were never ordered from LATAM.

```python todo
# TODO 1: join fact_orders, dim_customer and dim_product
# TODO 2: group by product_name, collect_set(region) as regions, size(...) as n_regions
# TODO 3: save as cx_product_regions and show the products where regions does not contain 'LATAM'
from pyspark.sql import functions as F
```

```python solution
from pyspark.sql import functions as F

(spark.table("fact_orders")
    .join(spark.table("dim_customer"), "customer_id")
    .join(spark.table("dim_product"), "product_id")
    .groupBy("product_name")
    .agg(F.sort_array(F.collect_set("region")).alias("regions"))
    .withColumn("n_regions", F.size("regions"))
    .write.mode("overwrite").saveAsTable("cx_product_regions"))

# At most 4: there are only four regions, and a set keeps each one once.
display(spark.table("cx_product_regions").filter(~F.array_contains("regions", "LATAM")))
```

## Exercise 2: higher-order functions in SQL

For each customer, build an array of order quantities. Then, **without exploding**, compute how many units came from orders of 3 or more items. Predict: can the result ever be larger than `aggregate(qtys, 0, (acc, q) -> acc + q)`?

```sql todo
-- TODO 1: per customer_id, collect_list(quantity) AS qtys from fact_orders
-- TODO 2: big_units = aggregate(filter(qtys, ...), 0, ...)
-- TODO 3: also show all_units = aggregate over all qtys
```

```sql solution
WITH per_customer AS (
  SELECT customer_id, collect_list(quantity) AS qtys
  FROM fact_orders
  GROUP BY customer_id
)
SELECT customer_id,
       size(qtys) AS n_orders,
       aggregate(filter(qtys, q -> q >= 3), 0, (acc, q) -> acc + q) AS big_units,
       aggregate(qtys, 0, (acc, q) -> acc + q) AS all_units   -- never smaller than big_units
FROM per_customer
ORDER BY big_units DESC
LIMIT 10;

-- Clean up the demo tables when you are done
-- DROP TABLE cx_customer_orders;
-- DROP TABLE cx_product_regions;
```

## ⚠️ Common mistakes

- ❌ Using `explode` when some arrays are NULL or empty. Those parent rows vanish. Use `explode_outer` if you need them.
- ❌ Trusting the order of `collect_list`. It follows whatever order the rows arrived in. Sort with `sort_array` or `array_sort`.
- ❌ Exploding, transforming and re-collecting just to change each item. That is a shuffle; `transform` and `filter` do it in place.
- ❌ Ignoring NULLs after `from_json`. A wrong schema does not fail, it gives NULL.
- ✅ Keep nested data for documents and payloads; flatten into columns for the tables people query most.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Group fields / build a list / build a map | `struct`, `array`, `create_map`, `map_from_arrays` |
| Read a field, item or key | `col("s.field")`, `element_at(a, 1)`, `element_at(m, "k")` |
| Rows ↔ array | `explode`, `explode_outer`, `posexplode` ↔ `collect_list`, `collect_set` |
| Test an array | `size`, `array_contains`, `exists`, `forall` |
| Change items without exploding | `transform`, `filter`, `aggregate` |
| Parse or write JSON | `from_json(c, "a INT, b STRING")`, `to_json`, `schema_of_json` |
