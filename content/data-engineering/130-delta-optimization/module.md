---
title: Optimizing Delta tables
summary: Understand why small files and wide min/max ranges make queries slow, and how OPTIMIZE, liquid clustering, partitioning and predictive optimization fix the file layout.
icon: 🚀
level: Intermediate
minutes: 11
group: Delta Lake internals
tags: [Delta Lake, OPTIMIZE, Liquid clustering, Data skipping]
---
# Optimizing Delta tables

> A query on a Delta table is fast when it opens **few files** and **skips most of them**. Both depend on the file layout: how big the files are and which rows sit together in each one.

**The one idea to remember:** Delta keeps min and max values per file. A filter can skip a file only when its range does not overlap the filter. **Compaction** gives you fewer files; **clustering** gives each file a narrow range, so more of them can be skipped.

## 🐜 The small-file problem and OPTIMIZE

Streaming micro-batches, frequent small inserts and over-partitioning leave thousands of tiny files. Each file costs a listing entry, a log entry, an open call and a footer read, whatever its size.

```viz files
{"title": "orders/",
 "steps": [
  {"label": "Five small inserts", "note": "Five commits, five files of a few MB each. Readers open all five, and the log tracks five `add` actions.",
   "add": [{"path": "part-00000-a1.snappy.parquet", "tag": "4 MB"}, {"path": "part-00000-b2.snappy.parquet", "tag": "3 MB"},
           {"path": "part-00000-c3.snappy.parquet", "tag": "5 MB"}, {"path": "part-00000-d4.snappy.parquet", "tag": "2 MB"},
           {"path": "part-00000-e5.snappy.parquet", "tag": "4 MB"},
           {"path": "_delta_log/00000000000000000005.json", "tag": "v5 · add"}]},
  {"label": "OPTIMIZE", "note": "Bin-packing: the small files are read and written again as one larger file. The commit has `dataChange: false`, so streaming readers ignore it. The old files become **tombstones**.",
   "add": [{"path": "part-00000-f6.snappy.parquet", "tag": "18 MB · compacted"},
           {"path": "_delta_log/00000000000000000006.json", "tag": "v6 · remove ×5, add"}],
   "remove": ["part-00000-a1.snappy.parquet", "part-00000-b2.snappy.parquet", "part-00000-c3.snappy.parquet", "part-00000-d4.snappy.parquet", "part-00000-e5.snappy.parquet"]},
  {"label": "OPTIMIZE again", "note": "Nothing to do: `OPTIMIZE` is idempotent and skips files that are already large enough. No new version.",
   "tag": {"part-00000-f6.snappy.parquet": "18 MB · already compact"}},
  {"label": "VACUUM (after retention)", "note": "The old small files are deleted from storage. Until then, time travel to version 5 still works.",
   "delete": ["part-00000-a1.snappy.parquet", "part-00000-b2.snappy.parquet", "part-00000-c3.snappy.parquet", "part-00000-d4.snappy.parquet", "part-00000-e5.snappy.parquet"]}
 ]}
```

## 📦 What OPTIMIZE does and does not do

- It **compacts** small files toward a target size (up to about 1 GB by default; Databricks can tune the target to the table size).
- It does not change any row. Queries return the same result before and after.
- It only rewrites what needs it, so running it again is cheap.
- It is a normal commit: the old files stay for time travel until `VACUUM`.
- Its output, and `DESCRIBE HISTORY`, show `numFilesRemoved` and `numFilesAdded`.

```sql
OPTIMIZE orders;                                  -- compact
OPTIMIZE orders WHERE order_date >= '2026-10-01'; -- only some partitions (partitioned tables)
OPTIMIZE orders ZORDER BY (customer_id);          -- compact and co-locate (legacy, see below)
```

## 🔍 Data skipping: how a filter avoids files

Every `add` action stores `numRecords`, `minValues`, `maxValues` and `nullCount` per column, for the **first 32 columns** by default. The engine uses them before it opens any file.

```viz flow
{"nodes": [
  {"icon": "❓", "title": "Query", "sub": "WHERE order_date = '2026-03-15'", "color": "blue"},
  {"icon": "📜", "title": "File stats", "sub": "from the log", "color": "purple", "items": ["min / max per file"]},
  {"icon": "⚖️", "title": "Overlap test", "sub": "min ≤ value ≤ max?", "color": "amber"},
  {"icon": "⏭️", "title": "Skip", "sub": "file never opened", "color": "gray"},
  {"icon": "📖", "title": "Read", "sub": "only candidate files", "color": "green"}
 ],
 "edges": ["predicate", "per file", "no", "yes"],
 "steps": [
  {"label": "Load stats", "focus": [0, 1], "note": "The filter is compared with the statistics of every file in the current version. This is metadata only, no data is read."},
  {"label": "Test", "focus": [2], "note": "If the value lies outside a file's `[min, max]`, no row in that file can match."},
  {"label": "Skip", "focus": [3], "note": "Those files are pruned. The query profile reports them as files pruned."},
  {"label": "Read", "focus": [4], "note": "Only overlapping files are opened. Whether that is 1 file or all of them depends on the **layout**."}
 ]}
```

Columns beyond the first 32 have no stats. Put filter columns early, or set `delta.dataSkippingStatsColumns`.

## 🎯 Clustering makes ranges narrow

Stats only help if each file covers a **small** range. Follow four files of orders and a filter on one day.

```viz table
{"title": "files of orders  (filter: order_date = '2026-03-15')",
 "columns": ["file", "rows", "min order_date", "max order_date"],
 "rows": [["a1", "15,000", "2025-01-01", "2026-10-31"], ["b2", "15,000", "2025-01-02", "2026-10-30"],
          ["c3", "15,000", "2025-01-01", "2026-10-31"], ["d4", "15,000", "2025-01-03", "2026-10-31"]],
 "steps": [
  {"label": "Unclustered", "note": "Rows were written in random order, so every file spans almost the whole date range."},
  {"label": "Run the filter", "note": "The date lies inside every range. **No file can be skipped**: all 60,000 rows are read.", "hl": [0, 1, 2, 3]},
  {"label": "Cluster by order_date", "note": "`OPTIMIZE` on a table with `CLUSTER BY (order_date)` rewrites the files so that close dates sit together. Each file now covers a few months.", "del": [0, 1, 2, 3],
   "add": [["e5", "15,000", "2025-01-01", "2025-06-15"], ["f6", "15,000", "2025-06-15", "2025-11-30"], ["g7", "15,000", "2025-11-30", "2026-05-20"], ["h8", "15,000", "2026-05-20", "2026-10-31"]]},
  {"label": "Run the filter again", "note": "Only `g7` overlaps the date. Three of four files are skipped without being opened.", "hl": [6]}
 ]}
```

## 🧭 Three ways to lay out the data

```viz compare
{"items": [
 {"icon": "🗂️", "title": "Partitioning", "sub": "PARTITIONED BY (col)", "color": "amber", "points": ["One folder per value", "✅ Very large tables, low-cardinality column, partition-level overwrite or retention", "❌ High cardinality or tables under ~1 TB: many tiny files", "❌ Fixed: changing it rewrites the table"]},
 {"icon": "🧵", "title": "Z-ordering", "sub": "OPTIMIZE ... ZORDER BY", "color": "blue", "points": ["Co-locates values of up to a few columns", "❌ Not incremental: reorganises the data each run", "❌ Not kept by new writes", "Legacy for new tables"]},
 {"icon": "💧", "title": "Liquid clustering", "sub": "CLUSTER BY (cols)", "color": "teal", "points": ["✅ Up to 4 keys, high cardinality is fine", "✅ Incremental: OPTIMIZE clusters new data", "✅ Change keys without a rewrite", "Default choice for new tables"]}
]}
```

Liquid clustering cannot be combined with partitioning or Z-ordering on the same table.

## 💧 Liquid clustering in practice

```sql
CREATE TABLE orders (order_id BIGINT, order_date DATE, customer_id BIGINT, ...)
CLUSTER BY (order_date, customer_id);

OPTIMIZE orders;                                   -- cluster data not yet clustered
ALTER TABLE orders CLUSTER BY (customer_id);       -- new keys, existing files stay
OPTIMIZE orders FULL;                              -- recluster everything with the new keys
ALTER TABLE orders CLUSTER BY AUTO;                -- let Databricks pick keys from the query workload
```

- Pick keys from columns that appear in **filters and joins**. They need statistics, so they must be within the stats columns.
- `CLUSTER BY AUTO` needs predictive optimization. It chooses and changes keys as query patterns change.
- Clustering also reduces write conflicts: with row-level concurrency, concurrent writers rarely touch the same files.

## 🤖 Let the platform do the maintenance

| Feature | What it does | Where |
|---|---|---|
| **Optimized writes** | Shuffles data before writing, so each write produces fewer, larger files | Table property `delta.autoOptimize.optimizeWrite`; on by default in many cases |
| **Auto compaction** | After a write commits, compacts the small files it left behind, on the same compute | `delta.autoOptimize.autoCompact` |
| **Predictive optimization** | Runs `OPTIMIZE`, `VACUUM` and `ANALYZE` when it pays off | Unity Catalog **managed** tables only, enabled per account, catalog or schema |
| **`ANALYZE TABLE`** | Collects table and column statistics for the query optimizer (join order, broadcast choice) | `ANALYZE TABLE t COMPUTE STATISTICS FOR ALL COLUMNS` |

With predictive optimization on, you rarely schedule maintenance jobs yourself. External tables still need your own `OPTIMIZE` and `VACUUM`.

## 🧪 Try it: compact and cluster a table

```dataset retail
```

```python run
# Ten small inserts: each one adds a file that spans the whole date range
spark.sql("CREATE OR REPLACE TABLE opt_orders AS SELECT * FROM fact_orders WHERE 1 = 0")
for i in range(10):
    spark.sql(f"INSERT INTO opt_orders SELECT * FROM fact_orders WHERE order_id % 10 = {i}")

display(spark.sql("""
  SELECT _metadata.file_name, count(*) AS row_count, min(order_date) AS min_date, max(order_date) AS max_date
  FROM opt_orders GROUP BY ALL ORDER BY 1"""))
```

```sql run
-- Compact, and compare the file count before and after
DESCRIBE DETAIL opt_orders;     -- numFiles: about 10

OPTIMIZE opt_orders;            -- returns numFilesRemoved and numFilesAdded

SELECT count(DISTINCT _metadata.file_name) AS files_now FROM opt_orders;
```

```sql run
-- A liquid clustered copy
CREATE OR REPLACE TABLE opt_orders_lc CLUSTER BY (order_date)
AS SELECT * FROM fact_orders;

OPTIMIZE opt_orders_lc;

DESCRIBE DETAIL opt_orders_lc;  -- clusteringColumns: ["order_date"]
```

> 60,000 rows fit in one or two files, so you will not measure a speed-up here, and clustering has little to sort. The demo shows the **mechanics**: file counts, commits and clustering metadata. The effect appears at millions of rows and hundreds of files.

## Exercise 1: the layout you get for free

Load orders **month by month** instead of by `order_id % 10`. Predict the min and max `order_date` of each file, and how many files a filter on `'2025-02-14'` must read.

```sql todo
-- TODO 1: create an empty opt_ex_orders with the schema of fact_orders
-- TODO 2: insert January, February and March 2025 as three separate INSERT statements
-- TODO 3: show rows, min and max order_date per data file
```

```sql solution
CREATE OR REPLACE TABLE opt_ex_orders AS SELECT * FROM fact_orders WHERE 1 = 0;

INSERT INTO opt_ex_orders SELECT * FROM fact_orders WHERE order_date >= '2025-01-01' AND order_date < '2025-02-01';
INSERT INTO opt_ex_orders SELECT * FROM fact_orders WHERE order_date >= '2025-02-01' AND order_date < '2025-03-01';
INSERT INTO opt_ex_orders SELECT * FROM fact_orders WHERE order_date >= '2025-03-01' AND order_date < '2025-04-01';

SELECT _metadata.file_name, count(*) AS row_count, min(order_date), max(order_date)
FROM opt_ex_orders GROUP BY ALL ORDER BY 3;
-- Each file covers one month, so a filter on 2025-02-14 can skip the other two files.
-- Data that arrives in time order is naturally clustered by time.
```

## Exercise 2: change the clustering keys

Create a table clustered by `customer_id`, then switch the key to `order_date`. Predict: does the `ALTER` rewrite any data file?

```sql todo
-- TODO 1: create opt_ex_lc CLUSTER BY (customer_id) from fact_orders and OPTIMIZE it
-- TODO 2: change the clustering key to order_date
-- TODO 3: check clusteringColumns and numFiles in DESCRIBE DETAIL, then the history
-- TODO 4: recluster all data with the new key
```

```sql solution
CREATE OR REPLACE TABLE opt_ex_lc CLUSTER BY (customer_id) AS SELECT * FROM fact_orders;
OPTIMIZE opt_ex_lc;

ALTER TABLE opt_ex_lc CLUSTER BY (order_date);

DESCRIBE DETAIL opt_ex_lc;    -- clusteringColumns: ["order_date"], numFiles unchanged
DESCRIBE HISTORY opt_ex_lc;   -- the ALTER is a metadata-only commit

OPTIMIZE opt_ex_lc FULL;      -- rewrites existing files with the new key

-- Clean up the demo tables when you are done
-- DROP TABLE opt_orders; DROP TABLE opt_orders_lc;
-- DROP TABLE opt_ex_orders; DROP TABLE opt_ex_lc;
```

## ⚠️ Common mistakes

- ❌ Partitioning a 200 GB table by date "for speed". It creates many small files and helps less than clustering.
- ❌ Partitioning by a high-cardinality column such as `customer_id`. Use liquid clustering.
- ❌ Expecting `OPTIMIZE` to free storage. Old files stay until `VACUUM`.
- ❌ Clustering on a column that is never filtered or joined on. It costs rewrites and skips nothing.
- ✅ For new tables: liquid clustering (or `CLUSTER BY AUTO`) on managed tables with predictive optimization.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Compact small files | `OPTIMIZE t` |
| Cluster a new table | `CREATE TABLE t (...) CLUSTER BY (c1, c2)` |
| Change clustering keys | `ALTER TABLE t CLUSTER BY (c3)`, then `OPTIMIZE t FULL` if needed |
| Let Databricks choose keys | `ALTER TABLE t CLUSTER BY AUTO` |
| See files and clustering | `DESCRIBE DETAIL t` (numFiles, clusteringColumns) |
| Statistics for the optimizer | `ANALYZE TABLE t COMPUTE STATISTICS FOR ALL COLUMNS` |
