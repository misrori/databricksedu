---
title: ETL with the DataFrame API
summary: Turn raw order files into a clean silver Delta table with the DataFrame API. Select, cast, filter, add columns with when/otherwise, use string and date functions, handle nulls and duplicates, join a dimension and compute revenue.
icon: 🧹
level: Beginner
minutes: 12
group: Introduction to Apache Spark
tags: [Apache Spark, DataFrame API, ETL, Medallion, Delta Lake]
---
# ETL with the DataFrame API

> Raw files arrive as strings, with test rows, odd spacing and missing values. A short chain of DataFrame methods turns them into a typed, trustworthy table that others can query.

**The one idea to remember:** every DataFrame method returns a **new** DataFrame, so ETL is a **chain**: each step does one clear thing, and the last step writes a Delta table.

## 🏗️ The plan: bronze to silver

We build one silver table, `etl_orders_silver`, from raw CSV order files and the `dim_product` table.

```viz flow
{"title": "Raw orders to a silver table",
 "nodes": [{"icon": "📥", "title": "Bronze", "sub": "CSV, every column a string", "color": "bronze"},
           {"icon": "🔢", "title": "Typed", "sub": "cast, to_date, trim, upper", "color": "blue"},
           {"icon": "🚦", "title": "Filtered", "sub": "no TEST, CANCELLED, duplicates", "color": "amber"},
           {"icon": "🔗", "title": "Enriched", "sub": "join dim_product, revenue", "color": "teal"},
           {"icon": "🥈", "title": "Silver", "sub": "Delta table", "color": "silver"}],
 "edges": ["types", "rules", "join", "write"],
 "steps": [
  {"label": "Read", "focus": [0], "note": "Read the files without a schema on purpose: bronze keeps what arrived, so nothing is lost."},
  {"label": "Type", "focus": [1], "note": "Cast each column to its real type and normalize text. Now comparisons and dates work."},
  {"label": "Filter", "focus": [2], "note": "Drop test and cancelled orders, rows without keys, and repeated order ids."},
  {"label": "Enrich", "focus": [3], "note": "Join the product price and compute `revenue = quantity × unit_price × (1 − discount)`."},
  {"label": "Write", "focus": [4], "note": "`saveAsTable` with `mode(\"overwrite\")`, so the whole chain can be re-run."}
 ]}
```

## 🎯 Pointing at columns

Most functions accept a column name or a **Column** object. You need the object when you compute with it.

| You write | It means |
|---|---|
| `"quantity"` or `F.col("quantity")` | an existing column |
| `F.lit(0.1)` | a constant value as a column |
| `F.expr("quantity * 2")` | a SQL expression as a column |
| `df.selectExpr("order_id", "year(order_date) AS y")` | `select` with SQL snippets |

`select` keeps **only** the columns you list, so it is also how you drop and reorder columns. Use `F` (`from pyspark.sql import functions as F`) for every built-in function.

## ➕ Adding and changing columns

```python
orders = (bronze
    .withColumn("quantity", F.col("quantity").cast("int"))     # same name: replaces the column
    .withColumns({"discount": F.col("discount").cast("double"),
                  "order_date": F.to_date("order_date")})      # several at once
    .withColumn("net_factor", 1 - F.col("discount"))           # new name: adds a column
    .withColumnRenamed("status", "order_status"))
```

- `withColumn` with an existing name **replaces** that column. A new name **adds** one.
- `withColumns` takes a dictionary and is cleaner than ten `withColumn` calls in a row.
- `cast` accepts a type name (`"int"`, `"bigint"`, `"double"`, `"date"`).

## 🚦 Filtering and conditions

`filter` and `where` are the same method. Combine conditions with `&`, `|` and `~`, and put each one in brackets.

```python
kept = orders.filter(~F.col("status").isin("TEST", "CANCELLED") & (F.col("quantity") > 0))

sized = kept.withColumn("basket",
    F.when(F.col("quantity") >= 4, "large")
     .when(F.col("quantity") >= 2, "medium")
     .otherwise("small"))
```

`when` is SQL `CASE WHEN`: the first true branch wins. Without `otherwise`, the rest get NULL.

## 🔤 String and date functions

| Function | Example | Result |
|---|---|---|
| `F.trim`, `F.upper` | `F.upper(F.trim("status"))` | `" open "` → `OPEN` |
| `F.regexp_replace` | `F.regexp_replace("email", "^.*@", "")` | `example.com` |
| `F.to_date` | `F.to_date("d", "dd/MM/yyyy")` | `"01/11/2026"` → `2026-11-01` |
| `F.year`, `F.month` | `F.year("order_date")` | `2026` |
| `F.date_trunc` | `F.date_trunc("month", "order_date")` | `2026-11-01 00:00:00` |

These run inside the engine, on every partition in parallel. Prefer them to a Python UDF, which is slower and hides the logic from the optimizer.

## 🎬 Watch a batch get cleaned

Step through the cleaning chain on five bronze rows.

```viz table
{"title": "orders: bronze → silver", "columns": ["order_id", "status", "discount", "revenue"],
 "rows": [[1, " completed", null, null], [2, "TEST", "0.1", null], [3, "COMPLETED", "0.25", null], [3, "COMPLETED", "0.25", null], [4, "CANCELLED", "0.0", null]],
 "steps": [
  {"label": "Bronze", "note": "Strings as they arrived: odd spacing, a missing discount, a duplicate, rows to drop."},
  {"label": "trim + upper", "note": "`F.upper(F.trim(\"status\"))` makes the status values comparable.", "upd": {"0": {"status": "COMPLETED"}}, "hl": [0]},
  {"label": "cast + fillna", "note": "Discount becomes a DOUBLE, and `fillna({\"discount\": 0.0})` replaces the NULL.", "upd": {"0": {"discount": 0.0}, "1": {"discount": 0.1}, "2": {"discount": 0.25}, "3": {"discount": 0.25}, "4": {"discount": 0.0}}, "hl": [0]},
  {"label": "dropDuplicates", "note": "`dropDuplicates([\"order_id\"])` keeps one row per order id.", "del": [3]},
  {"label": "filter", "note": "`~F.col(\"status\").isin(\"TEST\", \"CANCELLED\")` removes test and cancelled orders.", "del": [1, 4]},
  {"label": "join + revenue", "note": "After joining `dim_product`, `quantity * unit_price * (1 - discount)` fills the revenue.", "upd": {"0": {"revenue": 31.8}, "2": {"revenue": 67.5}}, "hl": [0, 2]}
 ]}
```

## ⛓️ One chain from bronze to silver

```viz code
title: the silver transformation, one step per line
lang: python
---
silver = (bronze
    .withColumns({"quantity": F.col("quantity").cast("int"),
                  "discount": F.col("discount").cast("double"),
                  "order_date": F.to_date("order_date"),
                  "status": F.upper(F.trim("status"))})
    .fillna({"discount": 0.0})
    .dropna(subset=["order_id", "order_date", "product_id"])
    .dropDuplicates(["order_id"])
    .filter(~F.col("status").isin("TEST", "CANCELLED"))
    .join(products, "product_id")
    .withColumn("revenue", F.col("quantity") * F.col("unit_price") * (1 - F.col("discount"))))

silver.write.mode("overwrite").saveAsTable("etl_orders_silver")
---
2-5 | Types | Strings become real types. Text is normalized before any comparison.
6-7 | Nulls | `fillna` sets a default, `dropna(subset=...)` drops rows that miss a key column.
8 | Duplicates | One row per `order_id`. Without a subset it compares every column.
9 | Rules | The business rule: test and cancelled orders are not sales.
10-11 | Enrich | The join adds `unit_price`, then revenue is one column expression.
13 | Write | Nothing ran until here. The write is the action that runs the whole chain.
```

## 🧪 Try it: build the silver table

```dataset retail
```

Write raw order files to a volume and read them as bronze: no schema, so every column is a string.

```python run
# Bronze: raw CSV files, all columns as strings
from pyspark.sql import functions as F

base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="etl", n_files=1, fresh=True)
bronze = spark.read.format("csv").option("header", "true").load(f"{base}/fact_orders")
bronze.printSchema()
display(bronze.groupBy("status").count())
```

```python run
# Silver: types, rules, join, revenue, then write a Delta table
products = spark.table("dim_product").select("product_id", "product_name", "category", "unit_price")

silver = (bronze
    .withColumns({"order_id": F.col("order_id").cast("bigint"),
                  "order_date": F.to_date("order_date"),
                  "customer_id": F.col("customer_id").cast("bigint"),
                  "product_id": F.col("product_id").cast("bigint"),
                  "quantity": F.col("quantity").cast("int"),
                  "discount": F.col("discount").cast("double"),
                  "status": F.upper(F.trim("status"))})
    .fillna({"discount": 0.0})
    .dropna(subset=["order_id", "order_date", "product_id"])
    .dropDuplicates(["order_id"])
    .filter(~F.col("status").isin("TEST", "CANCELLED"))
    .join(products, "product_id")
    .withColumn("revenue", F.round(F.col("quantity") * F.col("unit_price") * (1 - F.col("discount")), 2))
    .withColumn("order_month", F.date_trunc("month", "order_date"))
    .withColumn("basket", F.when(F.col("quantity") >= 4, "large").otherwise("small"))
    .withColumnRenamed("unit_price", "list_price"))

(silver.write.mode("overwrite").option("overwriteSchema", "true")
       .saveAsTable("etl_orders_silver"))
print(bronze.count(), "bronze rows ->", spark.table("etl_orders_silver").count(), "silver rows")
```

```python run
# Use the silver table: selectExpr, then plain SQL on the same table
display(spark.table("etl_orders_silver")
        .selectExpr("order_id", "year(order_date) AS order_year", "category", "revenue")
        .limit(5))

display(spark.sql("""
    SELECT category, round(sum(revenue), 2) AS revenue, count(*) AS orders
    FROM etl_orders_silver GROUP BY category ORDER BY revenue DESC"""))
```

## Exercise 1: clean the customers

Build `etl_customers_silver` from `dim_customer`: upper-case `region`, an `email_domain` column, and an `age_band` (under 30, 30-49, 50+) from `birth_year`, as of 2026. Predict the largest age band **before** you count.

```python todo
# TODO 1: start from spark.table("dim_customer")
# TODO 2: add email_domain with F.regexp_replace and age_band with F.when / otherwise
# TODO 3: write etl_customers_silver with mode("overwrite"), then count rows per age_band
```

```python solution
from pyspark.sql import functions as F

age = F.lit(2026) - F.col("birth_year")
customers = (spark.table("dim_customer")
    .withColumns({"region": F.upper(F.trim("region")),
                  "email_domain": F.regexp_replace("email", "^.*@", ""),
                  "age_band": F.when(age < 30, "under 30").when(age < 50, "30-49").otherwise("50+")})
    .select("customer_id", "customer_name", "region", "segment", "email_domain", "age_band"))

customers.write.mode("overwrite").saveAsTable("etl_customers_silver")
display(spark.table("etl_customers_silver").groupBy("age_band").count().orderBy("age_band"))
# Birth years are spread evenly over 1950-2005, so 50+ covers the most years and is the largest band.
```

## Exercise 2: quarantine the bad rows

`fact_orders_bad.csv` holds values like `five` and `not-a-date`. Read it as strings, find the rows whose values do not convert, and write them to `etl_orders_quarantine`. Predict how many rows survive.

```python todo
# TODO 1: write the raw files (data.files, folder="etl") and read f"{base}/fact_orders_bad" with header, no schema
# TODO 2: convert quantity, order_date, discount with F.expr("try_cast(... AS ...)")
# TODO 3: rows where any converted value is NULL go to etl_orders_quarantine; count good and bad rows
```

```python solution
from pyspark.sql import functions as F

base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="etl", n_files=1, fresh=True)
raw = spark.read.format("csv").option("header", "true").load(f"{base}/fact_orders_bad")

typed = raw.select("*",
    F.expr("try_cast(quantity AS INT)").alias("quantity_int"),
    F.expr("try_cast(order_date AS DATE)").alias("order_date_d"),
    F.expr("try_cast(discount AS DOUBLE)").alias("discount_d"))
is_bad = F.col("quantity_int").isNull() | F.col("order_date_d").isNull() | F.col("discount_d").isNull()

typed.filter(is_bad).write.mode("overwrite").saveAsTable("etl_orders_quarantine")
print("good:", typed.filter(~is_bad).count(), "bad:", spark.table("etl_orders_quarantine").count())   # 1 and 3

try:   # a plain cast fails the whole query when ANSI mode is on (the default on serverless)
    raw.select(F.col("quantity").cast("int")).collect()
except Exception as e:
    print(type(e).__name__, str(e)[:150])

# Clean up when you are done
# for t in ["etl_orders_silver", "etl_customers_silver", "etl_orders_quarantine"]: spark.sql(f"DROP TABLE IF EXISTS {t}")
```

## ⚠️ Common mistakes

- ❌ `F.col("a") > 1 & F.col("b") < 2` without brackets: Python binds `&` first. Write `(F.col("a") > 1) & (F.col("b") < 2)`.
- ❌ `filter(F.col("status") == "completed")` on raw text. Normalize with `trim` and `upper` first.
- ❌ A plain `cast` on dirty data: with ANSI mode one bad value fails the job. Use `try_cast` and quarantine.
- ❌ `dropDuplicates()` with no subset when only the key should be unique.
- ✅ One chain, one rule per step, `mode("overwrite")` at the end.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Keep, rename, compute columns | `select`, `selectExpr`, `withColumn(s)`, `withColumnRenamed` |
| Change a type | `F.col("x").cast("int")`, `F.expr("try_cast(x AS INT)")` |
| Keep some rows | `filter(...)` / `where(...)`, combine with `&` (and), `~` (not), `isin` |
| Conditional value | `F.when(cond, v).otherwise(w)` |
| Nulls and duplicates | `fillna({...})`, `dropna(subset=[...])`, `dropDuplicates([...])` |
| Save the result | `df.write.mode("overwrite").saveAsTable("t")` |
