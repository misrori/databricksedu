---
title: "DataFrames: reading and writing data"
summary: Read CSV files and tables into DataFrames with the right schema, look at what you loaded, and write the result back as files or as a Unity Catalog table with the right save mode.
icon: 📖
level: Beginner
minutes: 10
group: Introduction to Apache Spark
tags: [Apache Spark, DataFrame, DataFrameReader, DataFrameWriter, Unity Catalog]
---
# DataFrames: reading and writing data

> Almost every Spark program has the same shape: read data into a DataFrame, change it, write it somewhere. This module covers the two ends: `spark.read` and `df.write`.

**The one idea to remember:** a DataFrame is a **distributed table with a schema**. Give Spark the schema when you know it, and choose the **save mode** on purpose every time you write.

## 🧱 A DataFrame is a distributed table

A DataFrame has **named columns with types** (the schema) and **rows split into partitions** that live on many machines. You never hold the rows yourself: you hold a plan that says where they come from.

The entry point is the **SparkSession**, the `spark` object every Databricks notebook already has.

```viz flow
{"title": "The round trip of a Spark program",
 "nodes": [{"icon": "🚪", "title": "SparkSession", "sub": "`spark`, the entry point", "color": "navy"},
           {"icon": "📖", "title": "DataFrameReader", "sub": "`spark.read`", "color": "blue"},
           {"icon": "🧱", "title": "DataFrame", "sub": "schema + partitioned rows", "color": "teal"},
           {"icon": "✍️", "title": "DataFrameWriter", "sub": "`df.write`", "color": "purple"},
           {"icon": "🗄️", "title": "Table or files", "sub": "Unity Catalog, volumes", "color": "green"}],
 "edges": ["read", "load", "write", "save"],
 "steps": [
  {"label": "spark", "focus": [0], "note": "The session knows your catalog, your schema and the compute. In a notebook it is created for you."},
  {"label": "spark.read", "focus": [1], "note": "A builder: you set the **format**, **options** and **schema**, then call `load()` or `table()`."},
  {"label": "DataFrame", "focus": [2], "note": "Columns with types, rows in partitions. Nothing is copied to your notebook."},
  {"label": "df.write", "focus": [3], "note": "Another builder: **format**, **mode**, options, partition columns."},
  {"label": "saveAsTable / save", "focus": [4], "note": "The executors write the files in parallel. A table name registers the result in Unity Catalog."}
 ]}
```

## 📖 The DataFrameReader

`spark.read` returns a **DataFrameReader**. You chain settings onto it and finish with `load(path)`. Every option is a string key and value.

```viz code
title: Reading a CSV folder from a volume
lang: python
---
orders = (spark.read
    .format("csv")
    .option("header", "true")
    .schema("order_id BIGINT, order_date DATE, customer_id BIGINT, "
            "product_id BIGINT, quantity INT, discount DOUBLE, status STRING")
    .load("/Volumes/main/shop/landing/rw/fact_orders"))

orders.printSchema()
---
2 | format | The file format: `csv`, `json`, `parquet`, `delta`, `text`. Shortcuts such as `spark.read.csv(path)` do the same.
3 | option | Format-specific settings. For CSV: `header`, `sep`, `quote`, `mode`, `dateFormat`.
4-5 | schema | A DDL string (or a `StructType`) with every column name and type. Spark trusts it and does not scan the files first.
6 | load | A path to one file or a whole folder. All files in the folder become one DataFrame.
8 | printSchema | Prints the column tree. It reads no rows.
```

## 🔎 Infer the schema or give it

CSV and JSON files carry no types, so Spark must get them from somewhere.

```viz compare
{"title": "Where do the column types come from?",
 "items": [{"icon": "🕵️", "title": "Inferred", "sub": "`option(\"inferSchema\", \"true\")`", "color": "amber",
            "points": ["✅ quick for exploring", "❌ an **extra pass** over the data before the real read", "❌ types can change when the files change", "❌ without it, every CSV column is a STRING"],
            "foot": "Fine in a notebook, risky in a pipeline"},
           {"icon": "📐", "title": "Explicit", "sub": "`.schema(\"id BIGINT, ...\")` or `StructType`", "color": "green",
            "points": ["✅ no extra pass, faster start", "✅ the same types on every run", "✅ bad values show up as NULL or errors you can catch", "Parquet and Delta store their schema, so they need neither"],
            "foot": "The default for production code"}]}
```

## 📍 Tables, paths and SQL

| You have | Read it with |
|---|---|
| A Unity Catalog table | `spark.table("fact_orders")` or `spark.read.table(...)` |
| Files in a volume | `spark.read.format(...).load("/Volumes/<catalog>/<schema>/<volume>/<folder>")` |
| A SQL query | `spark.sql("SELECT ...")` returns a DataFrame |
| A DataFrame you want in SQL | `df.createOrReplaceTempView("v")`, then `SELECT ... FROM v` |

Prefer **table names**: Unity Catalog checks permissions and the table already knows its format and schema. SQL and DataFrames run on the **same engine** and produce the same plans, so mix them freely.

## ✍️ The DataFrameWriter

`df.write` returns a **DataFrameWriter**. `saveAsTable("name")` creates a Unity Catalog table (Delta by default). `save(path)` writes only files to a volume path. The **mode** says what happens if the target already exists.

| Mode | Target exists | Target missing |
|---|---|---|
| `errorifexists` (default) | fails | writes |
| `append` | adds rows | writes |
| `overwrite` | replaces the data | writes |
| `ignore` | does nothing, silently | writes |

`partitionBy("col")` writes one subfolder per value. Use it only for big tables and low-cardinality columns.

## 🧪 Try it: read raw files

```dataset retail
```

Write a few raw CSV files to a volume, then read them twice: once with inference, once with an explicit schema.

```python run
# Write raw CSV files to a volume and read them with schema inference
from pyspark.sql import functions as F

base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="rw", n_files=1, fresh=True)
print(base)

inferred = (spark.read.format("csv")
            .option("header", "true")
            .option("inferSchema", "true")
            .load(f"{base}/fact_orders"))
inferred.printSchema()
```

```python run
# The same files with an explicit DDL schema: no inference pass
ORDERS_SCHEMA = ("order_id BIGINT, order_date DATE, customer_id BIGINT, product_id BIGINT, "
                 "quantity INT, discount DOUBLE, status STRING")

orders = (spark.read.format("csv")
          .option("header", "true")
          .schema(ORDERS_SCHEMA)
          .load(f"{base}/fact_orders"))

print(orders.columns)
print(orders.dtypes)
orders.show(5)        # plain text, 20 rows by default
display(orders)       # Databricks: interactive grid, sort, charts
```

## 🧪 Try it: write it back

Save the orders as a managed table, write Parquet files to the volume, then query both ways.

```python run
# Write a Unity Catalog table and a partitioned Parquet folder
orders.write.mode("overwrite").saveAsTable("rw_orders")

(orders.withColumn("order_year", F.year("order_date"))
       .write.format("parquet").mode("overwrite")
       .partitionBy("order_year")
       .save(f"{base}/out/orders_parquet"))

print(spark.table("rw_orders").count())
display(spark.read.parquet(f"{base}/out/orders_parquet").groupBy("order_year").count())
```

```python run
# SQL and DataFrames: same engine, same data
orders.createOrReplaceTempView("rw_orders_v")
by_status = spark.sql("SELECT status, count(*) AS n FROM rw_orders_v GROUP BY status ORDER BY n DESC")
display(by_status)
```

> A temp view lives only in your current session. It is a name for a plan, not a copy of the data. `saveAsTable` is what makes the data permanent.

## Exercise 1: a StructType schema

Read `dim_product.csv` from the raw files with a `StructType` instead of a DDL string. Predict the type of `unit_price` if you left out the schema **and** `inferSchema`.

```python todo
# TODO 1: write the raw files (data.files, folder="rw") and keep the base path
# TODO 2: build a StructType for product_id, product_name, category, unit_price
# TODO 3: read f"{base}/dim_product" with header and your schema, then printSchema()
```

```python solution
from pyspark.sql.types import StructType, StructField, LongType, StringType, DoubleType

base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="rw", n_files=1, fresh=True)

product_schema = StructType([
    StructField("product_id", LongType(), False),
    StructField("product_name", StringType()),
    StructField("category", StringType()),
    StructField("unit_price", DoubleType()),
])
products = spark.read.format("csv").option("header", "true").schema(product_schema).load(f"{base}/dim_product")
products.printSchema()
display(products)
# Without schema and inferSchema every CSV column is a string, so unit_price would be STRING.
```

## Exercise 2: what happens to bad rows?

`fact_orders_bad.csv` has values such as `five` in an INT column. Read it with the explicit schema in three CSV modes. Predict each result first.

```python todo
# TODO 1: write the raw files and set ORDERS_SCHEMA (see the lecture)
# TODO 2: read f"{base}/fact_orders_bad" with mode PERMISSIVE, then DROPMALFORMED; display both
# TODO 3: read it with mode FAILFAST and catch the error in try/except
```

```python solution
base = data.files("retail", CATALOG, SCHEMA, volume="landing", folder="rw", n_files=1, fresh=True)
ORDERS_SCHEMA = ("order_id BIGINT, order_date DATE, customer_id BIGINT, product_id BIGINT, "
                 "quantity INT, discount DOUBLE, status STRING")

def read_bad(mode):
    return (spark.read.format("csv").option("header", "true").option("mode", mode)
            .schema(ORDERS_SCHEMA).load(f"{base}/fact_orders_bad"))

display(read_bad("PERMISSIVE"))      # all rows, unparsable values become NULL
display(read_bad("DROPMALFORMED"))   # only the rows that parse cleanly
try:
    read_bad("FAILFAST").collect()   # the error appears at the action, not at load()
except Exception as e:
    print(type(e).__name__, str(e)[:200])
```

## Exercise 3: predict the save modes

Start from 100 orders. Before you run each write, predict the row count of `rw_modes` afterwards.

```python todo
# TODO 1: small = spark.table("fact_orders").limit(100); write it with mode overwrite to rw_modes
# TODO 2: write it again with append, then ignore, then errorifexists (catch the error)
# TODO 3: print the row count after each step
```

```python solution
small = spark.table("fact_orders").limit(100)

small.write.mode("overwrite").saveAsTable("rw_modes")
print("overwrite:", spark.table("rw_modes").count())   # 100
small.write.mode("append").saveAsTable("rw_modes")
print("append:", spark.table("rw_modes").count())      # 200
small.write.mode("ignore").saveAsTable("rw_modes")
print("ignore:", spark.table("rw_modes").count())      # 200, nothing written
try:
    small.write.mode("errorifexists").saveAsTable("rw_modes")
except Exception as e:
    print("errorifexists:", type(e).__name__)          # the table already exists

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS rw_modes"); spark.sql("DROP TABLE IF EXISTS rw_orders")
```

## ⚠️ Common mistakes

- ❌ Reading CSV without `header` or schema: the header becomes a data row and every column is a STRING.
- ❌ `inferSchema` in a production job: an extra pass on every run, and the types can drift.
- ❌ Forgetting the mode: the default `errorifexists` fails on the second run, `append` doubles the data on a re-run.
- ❌ `dbfs:/` paths for new data. Use Unity Catalog tables and `/Volumes/...` paths.
- ✅ Read tables by name, give file reads an explicit schema, and choose the mode on purpose.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Read a table | `spark.table("t")` |
| Read files with a schema | `spark.read.format("csv").option("header", "true").schema(ddl).load(path)` |
| Look at the data | `display(df)`, `df.show(5)`, `df.printSchema()`, `df.columns`, `df.dtypes` |
| Run SQL on a DataFrame | `df.createOrReplaceTempView("v")`, then `spark.sql("SELECT ... FROM v")` |
| Save as a table | `df.write.mode("overwrite").saveAsTable("t")` |
| Save files | `df.write.format("parquet").mode("overwrite").save(path)` |
