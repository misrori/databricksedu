---
title: Python UDFs and when to avoid them
summary: Learn what happens when Spark calls your own Python function, compare Python UDFs, pandas UDFs and SQL UDFs on the same task, and follow a simple rule for choosing between them.
icon: 🐍
level: Intermediate
minutes: 12
group: Developing applications with Spark
tags: [Spark, UDF, pandas UDF, SQL UDF, Unity Catalog, Performance]
---
# Python UDFs and when to avoid them

> A user-defined function (UDF) lets you run your own code on every row. It is the escape hatch when no built-in function does what you need. Escape hatches have a price: the data has to leave the engine to reach your Python code.

**The one idea to remember:** use **built-in functions first**, then a SQL UDF or a pandas UDF, and a plain Python UDF **last**. Built-ins run inside the optimized engine; a Python UDF ships every row to a Python process and back.

## ⚙️ Where your function runs

```viz flow
{"title": "One partition through a Python UDF",
 "nodes": [{"icon": "⚙️", "title": "Executor", "sub": "JVM / Photon, columnar", "color": "navy"},
           {"icon": "📤", "title": "Serialize", "sub": "rows → bytes", "color": "amber"},
           {"icon": "🐍", "title": "Python worker", "sub": "your function, row by row", "color": "green"},
           {"icon": "📥", "title": "Deserialize", "sub": "bytes → rows", "color": "amber"},
           {"icon": "⚙️", "title": "Executor", "sub": "continues the plan", "color": "navy"}],
 "edges": ["input columns", "batches of rows", "results", "new column"],
 "steps": [
  {"label": "Built-in path", "focus": [0, 4], "note": "A built-in such as `when` or `upper` runs right here, on columnar data, with generated or Photon code. Nothing leaves the process."},
  {"label": "Ship the rows", "focus": [1], "note": "For a Python UDF the executor converts the input columns into bytes and sends them to a separate Python process."},
  {"label": "Call your function", "focus": [2], "note": "A plain Python UDF is called **once per row**. A pandas UDF is called once per batch of thousands of rows, as a pandas Series."},
  {"label": "Ship the results back", "focus": [3, 4], "note": "The results are converted back and joined to the row. This round trip is the cost you pay, on every row."}
 ]}
```

## 🐍 A plain Python UDF

```python
from pyspark.sql import functions as F

@F.udf(returnType="string")          # always give the return type
def bucket_py(d):
    if d is None or d <= 0:
        return "none"
    return "deep" if d >= 0.2 else "standard"

df.select(bucket_py("discount"))
spark.udf.register("bucket_py", bucket_py)   # also callable from SQL in this session
```

Without `returnType` the result is a string. If your function returns a value of the wrong type, the column can silently become NULL instead of raising an error.

## 🙈 Catalyst cannot see inside

To the optimizer a UDF is a black box. It does not know what the function does, so it cannot:

- push a filter on the UDF result down into the file scan or use file statistics to skip data,
- reorder, simplify or combine it with other expressions,
- run it in Photon. The plan shows a separate Python step (look for `EvalPython` in `explain()`).

A built-in `when(...).otherwise(...)` has none of these limits. The same logic, written with built-ins, is just another expression in the plan.

## 🐼 pandas UDFs: vectorized Python

```viz code
title: a pandas UDF (Series in, Series out)
lang: python
---
import numpy as np
import pandas as pd

@F.pandas_udf("string")
def bucket_pd(d: pd.Series) -> pd.Series:
    out = np.select([d >= 0.2, d > 0], ["deep", "standard"], default="none")
    return pd.Series(out)

df.select(bucket_pd("discount"))
---
4 | decorator | `pandas_udf` with the return type. The type hints tell Spark this is Series to Series.
5 | signature | `d` is a whole **batch** of values, not one value. Batches travel in Apache Arrow format.
6 | vectorized | One NumPy call handles thousands of rows at once. No Python loop per row.
7 | same length | The output Series must have exactly as many values as the input.
```

Arrow moves columns without per-row pickling, and NumPy works on whole arrays. That usually makes pandas UDFs much faster than plain Python UDFs. The data still leaves the engine, so built-ins remain faster.

## 🗄️ SQL UDFs in Unity Catalog

```sql
CREATE OR REPLACE FUNCTION udf_discount_bucket(d DOUBLE)
RETURNS STRING
RETURN CASE WHEN d >= 0.2 THEN 'deep' WHEN d > 0 THEN 'standard' ELSE 'none' END;
```

- A SQL UDF is stored in your schema, like a table, with privileges and lineage.
- Its body is SQL, so the optimizer **inlines** it: it runs as fast as the built-ins it is made of.
- Anyone with `EXECUTE` can call it from SQL, Python (`F.expr`), dashboards and Genie.
- Unity Catalog also supports **Python UDFs** (`LANGUAGE PYTHON AS $$ ... $$`). They are governed and shareable, but still run Python.

## 🪜 Which one should I use?

```viz compare
{"title": "Try them in this order",
 "items": [{"icon": "🥇", "title": "Built-in functions", "sub": "pyspark.sql.functions, SQL", "color": "green",
            "points": ["✅ optimized, runs in Photon", "✅ hundreds exist: check first", "❌ none fits your logic"]},
           {"icon": "🥈", "title": "SQL UDF", "sub": "CREATE FUNCTION … RETURN", "color": "teal",
            "points": ["✅ inlined, as fast as built-ins", "✅ reusable and governed in UC", "❌ only what SQL can express"]},
           {"icon": "🥉", "title": "pandas UDF", "sub": "@pandas_udf, Arrow", "color": "blue",
            "points": ["✅ any Python library", "✅ vectorized, batch at a time", "❌ data leaves the engine"]},
           {"icon": "🐢", "title": "Python UDF", "sub": "@udf", "color": "amber",
            "points": ["✅ simplest to write", "❌ one call per row", "❌ slowest option"],
            "foot": "All of these run on serverless"}]}
```

## 🧪 Try it: the same bucket, four ways

```dataset retail
```

Make the job a little bigger (10 copies of `fact_orders`, 600,000 rows) so the timings mean something. Grouping by the bucket forces Spark to compute it for every row.

```python run
# One task, four implementations
import time
import numpy as np
import pandas as pd
from pyspark.sql import functions as F

big = spark.table("fact_orders").crossJoin(spark.range(10))

bucket_builtin = (F.when(F.col("discount") >= 0.2, "deep")
                   .when(F.col("discount") > 0, "standard")
                   .otherwise("none"))

@F.udf(returnType="string")
def bucket_py(d):
    if d is None or d <= 0:
        return "none"
    return "deep" if d >= 0.2 else "standard"

@F.pandas_udf("string")
def bucket_pd(d: pd.Series) -> pd.Series:
    return pd.Series(np.select([d >= 0.2, d > 0], ["deep", "standard"], default="none"))

def timed(label, col):
    start = time.time()
    rows = big.select(col.alias("bucket")).groupBy("bucket").count().collect()
    print(f"{label:<12} {time.time() - start:6.2f} s ", sorted((r.bucket, r["count"]) for r in rows))
```

```sql run
-- A SQL UDF, stored in your schema
CREATE OR REPLACE FUNCTION udf_discount_bucket(d DOUBLE)
RETURNS STRING
RETURN CASE WHEN d >= 0.2 THEN 'deep' WHEN d > 0 THEN 'standard' ELSE 'none' END;
```

```python run
# Run each one twice and compare the second timings (the first includes warm-up)
for _ in range(2):
    timed("built-in", bucket_builtin)
    timed("SQL UDF", F.expr("udf_discount_bucket(discount)"))
    timed("pandas UDF", bucket_pd("discount"))
    timed("Python UDF", bucket_py("discount"))
    print()
```

```python run
# Look for the Python step in the plans
big.select(bucket_builtin.alias("b")).groupBy("b").count().explain()
big.select(bucket_py("discount").alias("b")).groupBy("b").count().explain()
```

> All four give the same counts. Exact timings depend on the compute, but the order is usually the same: built-in and SQL UDF first, pandas UDF next, Python UDF last.

## Exercise 1: replace a UDF with built-ins

A teammate wrote this Python UDF to get the email domain of each customer. Rewrite it with built-in functions only, and check that both give the same counts. Before you run it: which plan will contain an `EvalPython` step?

```python todo
from pyspark.sql import functions as F

@F.udf(returnType="string")
def domain_py(email):
    return email.split("@")[1].lower() if email else None

customers = spark.table("dim_customer")
customers.groupBy(domain_py("email").alias("domain")).count().show()

# TODO: the same result with built-ins only (hint: substring_index or split, then lower)
```

```python solution
from pyspark.sql import functions as F

@F.udf(returnType="string")
def domain_py(email):
    return email.split("@")[1].lower() if email else None

customers = spark.table("dim_customer")
customers.groupBy(domain_py("email").alias("domain")).count().show()

domain_builtin = F.lower(F.substring_index("email", "@", -1))
customers.groupBy(domain_builtin.alias("domain")).count().show()

customers.select(domain_py("email")).explain()       # has an EvalPython step
customers.select(domain_builtin).explain()           # does not
```

## Exercise 2: a reusable SQL UDF

Write a SQL UDF `udf_net_amount(quantity INT, unit_price DOUBLE, discount DOUBLE)` that returns the order value after discount, rounded to 2 decimals. Use it to get the net revenue per category for COMPLETED orders. Predict: will `DESCRIBE FUNCTION EXTENDED` show the body?

```sql todo
-- TODO 1: CREATE OR REPLACE FUNCTION udf_net_amount(...) RETURNS DOUBLE RETURN ...
-- TODO 2: net revenue per category, using the function
-- TODO 3: DESCRIBE FUNCTION EXTENDED udf_net_amount
```

```sql solution
CREATE OR REPLACE FUNCTION udf_net_amount(quantity INT, unit_price DOUBLE, discount DOUBLE)
RETURNS DOUBLE
RETURN round(quantity * unit_price * (1 - discount), 2);

SELECT p.category, round(sum(udf_net_amount(o.quantity, p.unit_price, o.discount)), 2) AS net_revenue
FROM fact_orders o JOIN dim_product p USING (product_id)
WHERE o.status = 'COMPLETED'
GROUP BY ALL
ORDER BY net_revenue DESC;

DESCRIBE FUNCTION EXTENDED udf_net_amount;   -- yes: the body is stored in Unity Catalog

-- Clean up when you are done
-- DROP FUNCTION udf_net_amount;
-- DROP FUNCTION udf_discount_bucket;
```

## ⚠️ Common mistakes

- ❌ Writing a UDF for something a built-in already does (`upper`, `regexp_extract`, date math, `when`). Search `pyspark.sql.functions` first.
- ❌ Leaving out the return type, or returning the wrong type. The result is a string, or NULL.
- ❌ Forgetting NULLs. Your Python function receives `None` and crashes on `None.split(...)`.
- ✅ When you need Python, prefer a pandas UDF and work on whole Series, not a loop.
- ✅ Put shared business logic in a Unity Catalog SQL UDF, so SQL users and dashboards get the same answer.

## 🧭 Cheat sheet

| Kind | How to create | Runs |
|---|---|---|
| Built-in | `F.when`, `F.lower`, `F.substring_index`, … | in the engine, Photon |
| SQL UDF | `CREATE FUNCTION f(x T) RETURNS T RETURN expr` | inlined into the plan |
| pandas UDF | `@F.pandas_udf("type")`, Series → Series | Python, batch at a time (Arrow) |
| Python UDF | `@F.udf(returnType="type")`, `spark.udf.register` | Python, row at a time |
| UC Python UDF | `CREATE FUNCTION … LANGUAGE PYTHON AS $$ … $$` | Python, governed in UC |
