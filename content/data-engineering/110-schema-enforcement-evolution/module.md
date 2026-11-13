---
title: Schema enforcement and evolution
summary: Learn where a Delta table keeps its schema, which writes it rejects and why, and the safe ways to add, rename, drop and widen columns without breaking readers.
icon: 🧬
level: Beginner
minutes: 10
group: Delta Lake internals
tags: [Delta Lake, Schema, Constraints, Column mapping]
---
# Schema enforcement and evolution

> A Delta table has a schema, and every write is checked against it. Bad data is stopped at the door instead of being found by a broken report next week. When the schema really must change, you change it **on purpose**.

**The one idea to remember:** the schema lives in the transaction log. A write that does not fit is **rejected as a whole**, and a schema change is just a new `metaData` action, usually without rewriting any data file.

## 💡 Where the schema lives

Delta is **schema-on-write**: the table decides what it accepts. The schema is stored in the `metaData` action of the log, as a JSON string, together with table properties such as constraints.

```viz code
title: _delta_log/…0007.json  (the metaData action, formatted)
lang: json
---
{"metaData": {
  "format": {"provider": "parquet", "options": {}},
  "schemaString": "{\"type\":\"struct\",\"fields\":[
    {\"name\":\"order_id\",\"type\":\"long\",\"nullable\":false,\"metadata\":{\"delta.columnMapping.physicalName\":\"col-1b7e\"}},
    {\"name\":\"quantity\",\"type\":\"integer\",\"nullable\":true,\"metadata\":{\"delta.columnMapping.physicalName\":\"col-9c02\"}},
    {\"name\":\"channel\",\"type\":\"string\",\"nullable\":true,\"metadata\":{\"delta.columnMapping.physicalName\":\"col-4d5a\"}}]}",
  "partitionColumns": [],
  "configuration": {
    "delta.columnMapping.mode": "name",
    "delta.constraints.positive_quantity": "quantity > 0"}}}
---
1 | metaData | Written when the table is created and again on every schema or property change.
3 | schemaString | The whole schema as one JSON string. It is shown on several lines here; in the file it is escaped on one line.
4-5 | fields | Name, type and nullability per column. `nullable: false` is a NOT NULL constraint.
6 | a new column | Added by `ALTER TABLE ADD COLUMN` or `mergeSchema`. Old files do not have it.
4-6 | physicalName | With column mapping, each column has a stable physical name in the Parquet files. The logical name can change freely.
8-10 | configuration | Table properties. CHECK constraints are stored here as `delta.constraints.<name>`.
```

## 🚦 Every write passes two checks

```viz flow
{"nodes": [
  {"icon": "📨", "title": "Incoming write", "sub": "INSERT, append, MERGE", "color": "blue"},
  {"icon": "📜", "title": "Table schema", "sub": "from the latest metaData", "color": "purple"},
  {"icon": "🧬", "title": "Schema check", "sub": "names and types", "color": "amber"},
  {"icon": "📏", "title": "Constraint check", "sub": "NOT NULL, CHECK", "color": "amber"},
  {"icon": "✅", "title": "Commit", "sub": "add actions", "color": "green"}
 ],
 "edges": ["load", "compare", "every row", "write"],
 "steps": [
  {"label": "Matching write", "focus": [0, 1, 2, 3, 4], "note": "Same column names, compatible types, all rows satisfy the constraints. Files are written and committed."},
  {"label": "Extra column", "focus": [2], "note": "The batch has a column `channel` the table does not know. The write fails with a schema mismatch error. **No file is committed.**"},
  {"label": "Opt-in evolution", "focus": [2, 4], "note": "The same batch with `mergeSchema`: the commit contains a new `metaData` action with the extra column, plus the data files. Both become visible at once."},
  {"label": "Constraint violation", "focus": [3], "note": "One row has `quantity = -5` and breaks `CHECK (quantity > 0)`. The **whole** write fails, not only that row."}
 ]}
```

## ⚖️ Rejected or allowed?

| Incoming data | Result | Why |
|---|---|---|
| A column the table does not have | ❌ rejected | Unknown columns are usually a bug upstream |
| A column of an incompatible type (`STRING` data for an `INT` column) | ❌ rejected | It would corrupt the column |
| A nullable column is missing | ✅ allowed | The column is stored as NULL for those rows |
| Narrower numeric type (`INT` values into `BIGINT`) | ✅ allowed | The upcast loses nothing |
| Same columns in another order (DataFrame append) | ✅ allowed | `saveAsTable` appends match columns by name |

Column names are compared case-insensitively. Two columns that differ only in case cannot exist in one table.

## ➕ ADD COLUMN: old files stay as they are

Adding a column changes only the schema. Existing Parquet files are not touched, so the new column reads as **NULL** for every old row.

```viz table
{"title": "schema_orders",
 "columns": ["data file", "order_id", "quantity", "channel"],
 "rows": [["part-a", 1, 2, "(no such column)"], ["part-a", 2, 1, "(no such column)"], ["part-b", 3, 5, "(no such column)"]],
 "steps": [
  {"label": "Before", "note": "Two data files. The schema has no `channel` column."},
  {"label": "ALTER TABLE ADD COLUMN channel STRING", "note": "One new commit with a `metaData` action. No data file is rewritten. Old rows show NULL because their files have no such column.", "upd": {"0": {"channel": null}, "1": {"channel": null}, "2": {"channel": null}}},
  {"label": "INSERT a new order", "note": "New files carry the column. Old and new files now coexist in one table.", "add": [["part-c", 4, 3, "web"]], "hl": [3]},
  {"label": "Backfill (optional)", "note": "An `UPDATE ... SET channel = 'store' WHERE channel IS NULL` would rewrite the old files. Only do it if NULL is wrong for old rows.", "hl": [0, 1, 2]}
 ]}
```

## 🧬 Four ways to evolve the schema

```viz compare
{"items": [
 {"icon": "🛠️", "title": "ALTER TABLE ADD COLUMN", "sub": "explicit DDL", "color": "green", "points": ["✅ Clear, reviewed change", "✅ Metadata only", "Use for: planned changes"]},
 {"icon": "➕", "title": "mergeSchema", "sub": ".option(\"mergeSchema\", \"true\")", "color": "blue", "points": ["✅ New columns from the batch are added at the end", "❌ A typo upstream becomes a new column", "Use for: one append that adds columns"]},
 {"icon": "🔀", "title": "MERGE WITH SCHEMA EVOLUTION", "sub": "or the autoMerge setting", "color": "purple", "points": ["✅ `UPDATE SET *` / `INSERT *` bring new source columns", "Use for: upserts from evolving sources"]},
 {"icon": "♻️", "title": "overwriteSchema", "sub": "with mode(\"overwrite\")", "color": "red", "points": ["❌ Rewrites all data", "✅ Allows any change: types, drops, renames", "Use for: a deliberate rebuild"]}
]}
```

`mergeSchema` adds columns but does not drop any, and it does not change existing types unless type widening is enabled.

## 🏷️ Rename, drop and widen without rewriting

Parquet files store columns by name, so renaming a column would normally mean rewriting every file. **Column mapping** decouples the two.

```sql
ALTER TABLE orders SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');
ALTER TABLE orders RENAME COLUMN discount TO discount_rate;   -- metadata only
ALTER TABLE orders DROP COLUMN status;                        -- metadata only

ALTER TABLE orders SET TBLPROPERTIES ('delta.enableTypeWidening' = true);
ALTER TABLE orders ALTER COLUMN quantity TYPE BIGINT;          -- INT to BIGINT, no rewrite
```

- A dropped column's data stays in the old files until they are rewritten and vacuumed.
- Both features upgrade the table protocol. Old clients may no longer read the table.
- Type widening covers widening changes only, for example `INT` to `BIGINT`, `FLOAT` to `DOUBLE`, a larger decimal precision.

## 📏 Constraints are part of the contract

The schema says what **shape** a row has. Constraints say what **values** it may hold.

```sql
ALTER TABLE orders ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT positive_quantity CHECK (quantity > 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS positive_quantity;
```

- Adding a constraint first checks **all existing rows**. If one violates it, the `ALTER` fails.
- A violating write fails completely, with the offending values in the error message.
- A CHECK whose expression is NULL (for example `quantity` is NULL) passes. Add NOT NULL when NULL is not allowed.

## 🧪 Try it: stop a bad write, then evolve on purpose

```dataset retail
```

```sql run
-- A small table to experiment with
CREATE OR REPLACE TABLE schema_orders AS
SELECT * FROM fact_orders WHERE order_id <= 1000;

DESCRIBE TABLE schema_orders;
```

```python run
# Append a batch with an extra column: enforcement rejects it
from pyspark.sql import functions as F

batch = (spark.table("fact_orders").where("order_id BETWEEN 1001 AND 1010")
         .withColumn("channel", F.lit("web")))
try:
    batch.write.mode("append").saveAsTable("schema_orders")
except Exception as e:
    print(type(e).__name__, "\n", str(e)[:500])
```

```python run
# Opt in to evolution for this one write
batch.write.mode("append").option("mergeSchema", "true").saveAsTable("schema_orders")

display(spark.sql("SELECT channel, count(*) AS row_count FROM schema_orders GROUP BY ALL"))
# 1000 old rows read channel as NULL, the 10 new rows say 'web'
```

```python run
# A CHECK constraint, then a write that breaks it
spark.sql("DELETE FROM schema_orders WHERE quantity <= 0")   # existing rows must comply first
spark.sql("ALTER TABLE schema_orders DROP CONSTRAINT IF EXISTS positive_quantity")
spark.sql("ALTER TABLE schema_orders ADD CONSTRAINT positive_quantity CHECK (quantity > 0)")
try:
    spark.sql("""INSERT INTO schema_orders (order_id, order_date, customer_id, product_id, quantity, discount, status)
                 VALUES (999999, current_date(), 1, 1, -5, 0.0, 'NEW')""")
except Exception as e:
    print(type(e).__name__, "\n", str(e)[:500])
```

## Exercise 1: which writes get in?

Predict, for each of the three appends below, whether Delta accepts it. Then run them and check.

```python todo
# TODO 1: create schema_ex_orders from orders 1 to 1000 (CREATE OR REPLACE TABLE ... AS SELECT)
# TODO 2: append orders 1001-1010 WITHOUT the discount column
# TODO 3: append orders 1011-1020 with the columns in reverse order
# TODO 4: append orders 1021-1030 with an extra column "note" (wrap it in try/except)
```

```python solution
from pyspark.sql import functions as F

spark.sql("CREATE OR REPLACE TABLE schema_ex_orders AS SELECT * FROM fact_orders WHERE order_id <= 1000")
src = spark.table("fact_orders")

# 1. Missing nullable column: accepted, discount is NULL for these rows
src.where("order_id BETWEEN 1001 AND 1010").drop("discount").write.mode("append").saveAsTable("schema_ex_orders")

# 2. Other column order: accepted, saveAsTable matches columns by name
cols = list(reversed(src.columns))
src.where("order_id BETWEEN 1011 AND 1020").select(*cols).write.mode("append").saveAsTable("schema_ex_orders")

# 3. Extra column: rejected without mergeSchema
try:
    (src.where("order_id BETWEEN 1021 AND 1030").withColumn("note", F.lit("x"))
        .write.mode("append").saveAsTable("schema_ex_orders"))
except Exception as e:
    print("rejected:", str(e)[:200])

display(spark.sql("SELECT count(*) AS rows, count(discount) AS with_discount FROM schema_ex_orders"))  # 1020, 1010
```

## Exercise 2: rename a column without a rewrite

Enable column mapping on `schema_ex_orders`, rename `discount` to `discount_rate`, and drop `status`. Predict: does the number of data files change?

```sql todo
-- TODO 1: note numFiles from DESCRIBE DETAIL
-- TODO 2: set delta.columnMapping.mode = 'name'
-- TODO 3: rename discount to discount_rate, drop status
-- TODO 4: DESCRIBE DETAIL and DESCRIBE HISTORY again
```

```sql solution
DESCRIBE DETAIL schema_ex_orders;

ALTER TABLE schema_ex_orders SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');
ALTER TABLE schema_ex_orders RENAME COLUMN discount TO discount_rate;
ALTER TABLE schema_ex_orders DROP COLUMN status;

DESCRIBE DETAIL schema_ex_orders;    -- same numFiles: only metadata changed
DESCRIBE HISTORY schema_ex_orders;   -- RENAME COLUMN and DROP COLUMNS commits, no new data files

-- Clean up the demo tables when you are done
-- DROP TABLE schema_orders;
-- DROP TABLE schema_ex_orders;
```

## ⚠️ Common mistakes

- ❌ Setting `mergeSchema` on every write "just in case". A renamed field upstream silently becomes a new column.
- ❌ Using `overwriteSchema` to add one column. It rewrites the whole table; `ADD COLUMN` changes metadata only.
- ❌ Expecting a backfill after `ADD COLUMN`. Old rows are NULL until you update them.
- ❌ Assuming `DROP COLUMN` removes the data. The bytes stay in old files until they are rewritten and vacuumed.
- ✅ Prefer explicit `ALTER TABLE` for planned changes, and constraints for value rules.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See the schema | `DESCRIBE TABLE t` |
| Add a column | `ALTER TABLE t ADD COLUMN c STRING` |
| Accept new columns in one append | `.option("mergeSchema", "true")` |
| Evolve the schema in an upsert | `MERGE WITH SCHEMA EVOLUTION INTO t ...` |
| Rename or drop a column | `delta.columnMapping.mode = 'name'`, then `RENAME COLUMN` / `DROP COLUMN` |
| Restrict values | `ALTER TABLE t ADD CONSTRAINT name CHECK (expr)` |
