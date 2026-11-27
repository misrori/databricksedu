---
title: "Delta Lake features: fast and open"
summary: A tour of the Delta Lake features that keep tables fast and open. Data skipping, the disk cache, liquid clustering, predictive optimization, deletion vectors, Iceberg compatibility and Delta Sharing, each with a small demo.
icon: ⚡
level: Beginner
minutes: 12
group: Delta Lake internals
tags: [Delta Lake, Features, Liquid clustering, Predictive optimization, Data skipping, Iceberg]
---
# Delta Lake features: fast and open

> The transaction log does more than make writes safe. It also stores the facts that let a query skip most of the table. It lets Databricks reorganize files without breaking readers, and it can describe the same Parquet files to other engines.

**The one idea to remember:** almost every speed feature works by **reading less**. The log tells the engine which files it does not need to read, and maintenance keeps the files easy to skip.

## ⚡ Seven features, one log

Each feature uses the same transaction log and the same Parquet files. There is no second copy of the data.

```viz layers
{"layers": [
  {"icon": "🧊", "title": "Open to other engines and companies", "sub": "UniForm and Delta Sharing", "color": "teal", "items": ["Iceberg metadata next to the Delta log", "live shares, no copies"]},
  {"icon": "🤖", "title": "Maintenance that runs itself", "sub": "predictive optimization", "color": "purple", "items": ["OPTIMIZE", "VACUUM", "ANALYZE"]},
  {"icon": "🗂️", "title": "Files laid out for skipping", "sub": "liquid clustering", "color": "blue", "items": ["CLUSTER BY", "incremental OPTIMIZE"]},
  {"icon": "✂️", "title": "Cheap row changes", "sub": "deletion vectors", "color": "amber", "items": ["DELETE and UPDATE without a rewrite"]},
  {"icon": "📊", "title": "Statistics in the log", "sub": "data skipping and scalable metadata", "color": "navy", "items": ["min and max per file and column"]},
  {"icon": "💾", "title": "Parquet files in cloud storage", "sub": "copied to local disk by the disk cache", "color": "gray"}
]}
```

Read from the bottom up: files, then the facts about them, then the features that use those facts.

## 🧪 Try it: a table written in several commits

```dataset retail
```

The demos below use one table with **one commit per quarter**. Each commit writes its own files, so every file covers a short range of dates.

```python run
# Build perf_feat_orders, one INSERT per quarter
spark.sql("CREATE OR REPLACE TABLE perf_feat_orders LIKE fact_orders")
quarters = spark.sql("""SELECT DISTINCT date_trunc('quarter', order_date) AS q
                        FROM fact_orders ORDER BY q""").collect()
for row in quarters:
    spark.sql(f"""INSERT INTO perf_feat_orders SELECT * FROM fact_orders
                  WHERE date_trunc('quarter', order_date) = DATE'{row.q.date()}'""")
display(spark.sql("DESCRIBE DETAIL perf_feat_orders").select("numFiles", "sizeInBytes"))
```

## 📊 Data skipping and the disk cache

Each commit stores **statistics per file** in the log, such as the minimum and maximum value of every column. A query with a filter compares the filter with these numbers and skips files that cannot match. Delta reads the log with Spark, so tables with billions of files still plan quickly.

**Without it:** every query opens every file to find out what is inside.

```viz table
{"title": "File statistics in the log: WHERE order_date = '2026-08-14'",
 "columns": ["file", "min(order_date)", "max(order_date)", "read?"],
 "rows": [["part-…01", "2026-01-01", "2026-03-31", ""], ["part-…02", "2026-04-01", "2026-06-30", ""], ["part-…03", "2026-07-01", "2026-09-30", ""], ["part-…04", "2026-10-01", "2026-10-31", ""]],
 "steps": [
  {"label": "Plan the query", "note": "The engine reads only the log: four files, with min and max per column."},
  {"label": "Compare", "note": "2026-08-14 is outside the range of three files. They cannot hold a match.", "upd": {"0": {"read?": "skip"}, "1": {"read?": "skip"}, "3": {"read?": "skip"}}},
  {"label": "Read one file", "note": "Only one file is opened. With well-ordered files most of the table is skipped.", "upd": {"2": {"read?": "read"}}, "hl": [2]}
 ]}
```

```sql run
-- Which files hold the rows of one day?
SELECT count(DISTINCT _metadata.file_name) AS files_with_matches,
       count(*) AS matching_rows
FROM perf_feat_orders
WHERE order_date = DATE'2026-08-14';
```

Compare `files_with_matches` with `numFiles` above. The other files could be skipped because of their statistics.


**The disk cache** (formerly the Delta cache) saves reads in a different way: it keeps copies of remote Parquet data on the **local disks of the compute nodes**. Repeated reads of the same data then come from local storage instead of cloud storage. Databricks manages it automatically; there is nothing to configure.

**Without the cache:** every read of the same data goes back to cloud storage.

```python run
# Run the same aggregation twice and time it
import time
q = "SELECT customer_id, sum(quantity) AS qty FROM perf_feat_orders GROUP BY customer_id"
for run in (1, 2):
    t = time.time()
    spark.sql(q).collect()
    print(f"run {run}: {time.time() - t:.2f} s")
```

> The second run is often faster, but on a small table the difference can be tiny. Other caches also help, so treat the numbers as a hint, not a measurement of the disk cache alone.

## 🗂️ Liquid clustering

Liquid clustering **replaces partitioning and `ZORDER`**. You name the columns you filter on with `CLUSTER BY`, and `OPTIMIZE` puts rows with similar values into the same files. It only rewrites data that needs it, handles skew, and you can change the keys at any time without rewriting the whole table. It is generally available for Delta tables in Databricks Runtime 15.4 LTS and above, and Databricks recommends it for new tables.

**Without it:** you pick partition columns once, and changing them means rewriting the table.

```viz files
{"title": "perf_feat_clustered/",
 "steps": [
  {"label": "Written as it came", "note": "Every file holds every customer, so a filter on `customer_id` must read all of them.",
   "add": [{"path": "part-0001.parquet", "tag": "customers 1-500"}, {"path": "part-0002.parquet", "tag": "customers 1-500"}, {"path": "part-0003.parquet", "tag": "customers 1-500"}]},
  {"label": "OPTIMIZE clusters", "note": "Rows are rewritten by `customer_id`. Each new file covers a narrow range, so most files can be skipped.",
   "remove": ["part-0001.parquet", "part-0002.parquet", "part-0003.parquet"],
   "add": [{"path": "part-0004.parquet", "tag": "customers 1-170"}, {"path": "part-0005.parquet", "tag": "customers 171-340"}, {"path": "part-0006.parquet", "tag": "customers 341-500"}]},
  {"label": "New data arrives", "note": "A new batch lands unclustered. Nothing else is touched.",
   "add": [{"path": "part-0007.parquet", "tag": "new rows, customers 1-500"}]},
  {"label": "OPTIMIZE again", "note": "Only the new, unclustered data is rewritten. The clustered files stay as they are.",
   "remove": ["part-0007.parquet"], "add": [{"path": "part-0008.parquet", "tag": "new rows, clustered"}]}
 ]}
```

```sql run
-- Cluster by customer, compact, then change the key
CREATE OR REPLACE TABLE perf_feat_clustered CLUSTER BY (customer_id)
AS SELECT * FROM fact_orders;
OPTIMIZE perf_feat_clustered;
ALTER TABLE perf_feat_clustered CLUSTER BY (order_date);
DESCRIBE DETAIL perf_feat_clustered;
```

`clusteringColumns` now shows `order_date`. Existing files are not rewritten by the `ALTER`; the next `OPTIMIZE` uses the new key. With `CLUSTER BY AUTO` (Runtime 15.4 and above, with predictive optimization), Databricks picks the keys from your queries.

## 🤖 Predictive optimization

Predictive optimization runs `OPTIMIZE`, `VACUUM` and `ANALYZE` for you on **Unity Catalog managed tables**. It looks at how tables are used and maintains the ones that benefit. It needs the Premium plan.

**Without it:** someone schedules maintenance jobs for every table and guesses how often to run them.

An admin or the owner turns it on for a catalog or schema. This is display-only code, because it needs those rights:

```sql
ALTER CATALOG main ENABLE PREDICTIVE OPTIMIZATION;
ALTER SCHEMA main.sales INHERIT PREDICTIVE OPTIMIZATION;
```

```python run
# What did predictive optimization do in this schema? (needs access to system tables)
try:
    display(spark.sql(f"""
        SELECT start_time, table_name, operation_type, operation_status
        FROM system.storage.predictive_optimization_operations_history
        WHERE catalog_name = '{CATALOG}' AND schema_name = '{SCHEMA}'
        ORDER BY start_time DESC LIMIT 20"""))
except Exception as e:
    print("No access to the system table:", str(e).splitlines()[0][:120])
```

> An empty result is normal for a new schema: maintenance runs in the background some time after tables change.

## ✂️ Deletion vectors

A `DELETE` or `UPDATE` does not rewrite the Parquet file that holds the row. Delta writes a small **deletion vector** file that marks the row as removed, and `OPTIMIZE` rewrites the files later. The Deletion vectors module shows this step by step.

**Without it:** deleting one row rewrites the whole file it lives in, which can be a gigabyte.

```sql run
-- Delete one order, then look at what the commit did
ALTER TABLE perf_feat_orders SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true');
DELETE FROM perf_feat_orders WHERE order_id = 42;
SELECT version, operation, operationMetrics
FROM (DESCRIBE HISTORY perf_feat_orders) LIMIT 1;
```

In `operationMetrics` look for `numDeletionVectorsAdded` and `numFilesAdded`: a deletion vector was added, but no data file was rewritten.

## 🧊 Iceberg compatibility (UniForm)

With **UniForm**, Delta also writes Apache Iceberg metadata next to the Delta log, for the same Parquet files. Iceberg engines then read the table through the Unity Catalog Iceberg REST catalog, without a copy. It needs column mapping, which is set automatically at creation, and it does not work with deletion vectors under Iceberg v2. The module "Iceberg compatibility with UniForm" covers the details.

**Without it:** an Iceberg-only engine needs its own copy of the data.

```sql run
-- A small table that Iceberg clients can read
CREATE OR REPLACE TABLE perf_feat_uniform
TBLPROPERTIES (
  'delta.enableDeletionVectors' = 'false',
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg')
AS SELECT * FROM fact_orders WHERE order_id <= 1000;
SHOW TBLPROPERTIES perf_feat_uniform;
```

Look for `delta.columnMapping.mode`: you did not set it, but UniForm turned it on.

## 🤝 Open data sharing with Delta Sharing

Delta Sharing is an **open protocol**: a provider shares live Delta tables without copying them. A Databricks recipient is identified by its sharing identifier. With open sharing, any client (pandas, Spark, Power BI) connects with a bearer token from an activation link, or with OIDC federation. The server hands out short-lived signed URLs to the Parquet files, so recipients always read the provider's current data. The governance module "Delta Sharing" covers the details.

**Without it:** you export files, email them or copy them to the partner's storage, and the copy is out of date the next day.

This is display-only code. It needs the `CREATE SHARE` and `CREATE RECIPIENT` privileges on the metastore:

```sql
CREATE SHARE sales_share COMMENT 'Orders for our logistics partner';
ALTER SHARE sales_share ADD TABLE main.sales.orders;
CREATE RECIPIENT logistics_partner;           -- open sharing: returns an activation link
GRANT SELECT ON SHARE sales_share TO RECIPIENT logistics_partner;
```

```python
# On the recipient side, with the open-source client: pip install delta-sharing
import delta_sharing
profile = "/path/to/config.share"             # downloaded from the activation link
df = delta_sharing.load_as_pandas(profile + "#sales_share.sales.orders")
```

## Exercise 1: how many files does a filter touch?

Pick one `customer_id`. **Predict** whether its rows sit in fewer files in `perf_feat_orders` (written by quarter) or in a table clustered by `customer_id` after `OPTIMIZE`. Then measure both.

```sql todo
-- TODO 1: create perf_feat_by_customer CLUSTER BY (customer_id) from fact_orders, then OPTIMIZE it
-- TODO 2: for customer_id = 123, count DISTINCT _metadata.file_name in both tables
```

```sql solution
CREATE OR REPLACE TABLE perf_feat_by_customer CLUSTER BY (customer_id)
AS SELECT * FROM fact_orders;
OPTIMIZE perf_feat_by_customer;

SELECT 'by quarter' AS layout, count(DISTINCT _metadata.file_name) AS files
FROM perf_feat_orders WHERE customer_id = 123
UNION ALL
SELECT 'clustered', count(DISTINCT _metadata.file_name)
FROM perf_feat_by_customer WHERE customer_id = 123;
-- A customer orders in every quarter, so the quarterly table spreads them over many files.
-- Clustering by customer_id groups them into one or very few files.
```

## Exercise 2: what does UniForm switch off?

Create a UniForm table without `'delta.enableDeletionVectors' = 'false'`. **Predict** whether the statement fails or quietly changes a setting, then check with `SHOW TBLPROPERTIES`.

```sql todo
-- TODO 1: create perf_feat_uniform2 with only the two UniForm properties, from fact_orders (order_id <= 100)
-- TODO 2: show its table properties and look at deletion vectors and column mapping
```

```sql solution
CREATE OR REPLACE TABLE perf_feat_uniform2
TBLPROPERTIES (
  'delta.enableIcebergCompatV2' = 'true',
  'delta.universalFormat.enabledFormats' = 'iceberg')
AS SELECT * FROM fact_orders WHERE order_id <= 100;
SHOW TBLPROPERTIES perf_feat_uniform2;
-- Column mapping is always added. If your workspace turns deletion vectors on for new tables,
-- the CREATE may fail and ask you to disable them: Iceberg v2 reads cannot use deletion vectors.

-- Clean up when you are done
-- DROP TABLE perf_feat_orders; DROP TABLE perf_feat_clustered; DROP TABLE perf_feat_uniform;
-- DROP TABLE perf_feat_by_customer; DROP TABLE perf_feat_uniform2;
```

## ⚠️ Common mistakes

- ❌ Partitioning a small table by a column with many values. You get thousands of tiny files. Use liquid clustering instead.
- ❌ Using `ZORDER` and `CLUSTER BY` together. Liquid clustering replaces `ZORDER`; a clustered table does not use it.
- ❌ Expecting `ALTER TABLE … CLUSTER BY` to rewrite the data at once. It only changes the key for the next `OPTIMIZE`.
- ❌ Turning on deletion vectors on a UniForm table. Iceberg v2 readers cannot use them.
- ✅ Filter on the clustering columns. Data skipping only helps when the filter uses columns with useful statistics.

## 🧭 Cheat sheet

| Feature | What it does | How you use it |
|---|---|---|
| Data skipping, disk cache | Skip files by statistics; keep data on local disks | Automatic; filter on well-ordered columns |
| Liquid clustering | Groups similar rows into files | `CLUSTER BY (col)` or `CLUSTER BY AUTO`, then `OPTIMIZE` |
| Predictive optimization | Runs OPTIMIZE, VACUUM, ANALYZE | `ALTER CATALOG … ENABLE PREDICTIVE OPTIMIZATION` |
| Deletion vectors | Deletes without rewriting files | `delta.enableDeletionVectors = true` |
| UniForm | Iceberg metadata for the same files | `delta.enableIcebergCompatV2` + `universalFormat.enabledFormats` |
| Delta Sharing | Live tables for other organizations | `CREATE SHARE`, `CREATE RECIPIENT`, `GRANT SELECT ON SHARE` |
