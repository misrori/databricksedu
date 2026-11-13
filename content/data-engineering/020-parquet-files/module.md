---
title: Parquet files
summary: Open a Parquet file and see what is inside: row groups, column chunks, pages and a footer full of statistics. Learn why that layout makes queries fast and why the files are never edited.
icon: 📦
level: Beginner
minutes: 10
group: Lakehouse foundations
tags: [Parquet, File formats, Columnar storage, Data skipping]
---
# Parquet files

> Every Delta table stores its rows in Parquet files. Knowing how one file is laid out explains why reading 3 columns is cheap, why filters can skip data, and why changing a single row means writing a new file.

**The one idea to remember:** Parquet stores data **column by column in blocks**, and writes a **footer with the schema and min/max statistics** at the end, so a reader can decide what to skip before it reads any data.

## 🧮 Rows or columns

Here are the same four orders stored two ways. Step through and watch what `SELECT sum(quantity)` has to read.

```viz table
{"title": "Four orders, two layouts",
 "columns": ["Layout", "Used by", "Bytes on disk, in this order"],
 "rows": [["Row-oriented", "CSV, OLTP databases", "1, 01-03, 2, COMPLETED │ 2, 01-03, 1, COMPLETED │ 3, 01-04, 5, OPEN │ 4, 01-04, 1, COMPLETED"],
          ["Columnar", "Parquet, ORC", "1, 2, 3, 4 │ 01-03, 01-03, 01-04, 01-04 │ 2, 1, 5, 1 │ COMPLETED, COMPLETED, OPEN, COMPLETED"]],
 "steps": [
  {"label": "Same data", "note": "Four orders with `order_id`, `order_date`, `quantity` and `status`. Only the order of the bytes differs."},
  {"label": "Row layout", "note": "The quantities are scattered between the other values. To sum them, the reader must scan **every byte** of every row.", "hl": [0],
   "upd": {"0": {"Bytes on disk, in this order": "1, 01-03, **2**, COMPLETED │ 2, 01-03, **1**, COMPLETED │ 3, 01-04, **5**, OPEN │ 4, 01-04, **1**, COMPLETED"}}},
  {"label": "Column layout", "note": "All quantities sit next to each other. The reader jumps to that block and reads **only it**: a quarter of the data here, often 5% on a wide table.", "hl": [1],
   "upd": {"1": {"Bytes on disk, in this order": "1, 2, 3, 4 │ 01-03, 01-03, 01-04, 01-04 │ **2, 1, 5, 1** │ COMPLETED, COMPLETED, OPEN, COMPLETED"}}},
  {"label": "Bonus: compression", "note": "Values of one column look alike. Three `COMPLETED` in a row compress far better than a mix of dates, numbers and strings.", "hl": [1]}
 ]}
```

Row storage is good for writing and reading whole records (an online shop's database). Columnar storage is good for analytics, which reads few columns over many rows.

## 🗂️ Inside one Parquet file

A Parquet file is not one big column. It is split horizontally into **row groups**, and each row group holds one **column chunk** per column.

```viz tree
{"title": "Layout of part-00000.snappy.parquet",
 "root": {"icon": "📦", "label": "part-00000.snappy.parquet", "sub": "one file", "color": "navy", "children": [
   {"icon": "🔖", "label": "PAR1", "sub": "4 magic bytes at the start", "color": "gray"},
   {"icon": "🧱", "label": "Row group 0", "sub": "a horizontal slice, often up to ~128 MB", "color": "blue", "children": [
     {"icon": "🧩", "label": "column chunk: order_id", "sub": "pages of encoded, compressed values", "color": "teal"},
     {"icon": "🧩", "label": "column chunk: status", "sub": "dictionary page + data pages", "color": "teal"}
   ]},
   {"icon": "🧱", "label": "Row group 1", "sub": "the next slice of rows, same columns", "color": "blue"},
   {"icon": "📇", "label": "Footer", "sub": "schema, row groups, offsets, min/max/null counts", "color": "purple"},
   {"icon": "🔖", "label": "footer length + PAR1", "sub": "the last 8 bytes", "color": "gray"}
 ]}}
```

- **Pages** (about 1 MB) are the smallest unit that is encoded and compressed.
- The **footer is written last**, because it records where every chunk starts. A reader opens a file from the end.

## 📇 Read the footer first

This is a simplified printout of a footer, the kind you will produce with `pyarrow` in the Try it section.

```viz code
title: footer of part-00000.snappy.parquet (simplified)
lang: text
---
num_rows:        1000
num_row_groups:  1
schema:          order_id: int64, order_date: date, customer_id: int64,
                 product_id: int64, quantity: int32, discount: double, status: string
row_group 0:     1000 rows, 7 column chunks
  column order_id     offset 4        compressed 4.1 KB
    statistics:  min=1           max=1000        null_count=0
    encodings:   PLAIN, RLE       codec: SNAPPY
  column status       offset 31872    compressed 0.3 KB
    statistics:  min=CANCELLED   max=TEST        null_count=0
    encodings:   RLE_DICTIONARY   codec: SNAPPY
---
1-2 | Totals | Row count and number of row groups, known without reading any data.
3-4 | Schema | Column names and types travel with the file. Parquet is self-describing.
5-6 | Where to read | Each column chunk records its byte offset, so a reader can jump straight to it.
7 | Statistics | Min, max and null count per chunk. A filter `order_id > 5000` can skip this row group without reading it.
9-11 | Encoding | `status` has 4 distinct values, so it is stored as a small dictionary plus short codes: 0.3 KB for 1000 strings. Real output may name it `PLAIN_DICTIONARY` or `RLE_DICTIONARY`.
```

## 🔤 Encodings and compression

Parquet shrinks data twice: first it **encodes** values in a smarter form, then it **compresses** the pages.

| Technique | What it does | Works best on |
|---|---|---|
| **Dictionary** | Stores each distinct value once, then small integer codes | Low-cardinality strings: status, country |
| **Run-length (RLE)** | Stores "COMPLETED × 300" instead of 300 copies | Repeated values, especially on sorted data |
| **Snappy** | Fast general-purpose compression of pages | The long-time Spark default |
| **Zstandard (zstd)** | Smaller files than snappy at similar read speed | Large tables where storage and I/O matter |

The codec is written in the footer of every column chunk, and usually appears in the file name too (`.snappy.parquet`, `.zstd.parquet`). Sorting data before writing makes runs longer and files smaller.

## ✂️ How a query skips data

Two tricks make Parquet fast: **column pruning** (read only the needed columns) and **predicate pushdown** (use statistics to skip row groups).

```viz flow
{"title": "SELECT sum(quantity) FROM orders WHERE order_date = '2026-03-01'",
 "nodes": [
  {"icon": "🔍", "title": "Query", "sub": "needs 2 of 7 columns", "color": "gold"},
  {"icon": "📇", "title": "Footer", "sub": "schema + statistics", "color": "purple"},
  {"icon": "🧱", "title": "Row groups", "sub": "3 in this file", "color": "blue", "items": ["RG0: Jan 01 to Feb 10", "RG1: Feb 10 to Mar 05", "RG2: Mar 05 to Apr 20"]},
  {"icon": "🧩", "title": "Column chunks", "sub": "order_date, quantity", "color": "teal"},
  {"icon": "✅", "title": "Result", "sub": "one number", "color": "green"}
 ],
 "edges": ["open from the end", "check min/max", "read 2 chunks", "decode + sum"],
 "steps": [
  {"label": "Plan", "focus": [0], "note": "The engine sees the query needs only `order_date` (to filter) and `quantity` (to sum). The other five columns are **pruned**."},
  {"label": "Read the footer", "focus": [1], "note": "The reader fetches the last bytes of the file, finds the footer length, and reads the footer. No row data yet."},
  {"label": "Skip row groups", "focus": [2], "note": "RG0 ends on Feb 10 and RG2 starts on Mar 05, so neither can contain Mar 01. Only **RG1** might."},
  {"label": "Read only what is needed", "focus": [3], "note": "Using the offsets in the footer, the reader fetches 2 column chunks of 1 row group: a small part of the file."},
  {"label": "Answer", "focus": [4], "note": "Pages are decompressed, decoded, filtered row by row, and summed. Skipping works best when data is **sorted or clustered** by the filter column."}
 ]}
```

## 🧊 Parquet files are never edited

The footer stores byte offsets for every chunk. Changing one value could shift all of them, and cloud object storage cannot modify a file in place anyway. So a Parquet file is **written once and never changed**.

What that means for Delta Lake:

- An `UPDATE` or `DELETE` writes **new** files, or with deletion vectors a small side file that marks deleted rows.
- The old file stays on disk. The **transaction log** records which files belong to the current version.
- Old files are removed later by `VACUUM`, after the retention period.

## 🐜 The small-file problem

Every file has a fixed cost: a storage request to open it, a footer to read, a task to schedule. A million 10 KB files are far slower to query than ten 1 GB files holding the same rows.

| Cause | Fix on Databricks |
|---|---|
| Streaming or frequent small batch writes | Auto compaction and optimized writes |
| Partitioning by a high-cardinality column | Liquid clustering instead of partitions |
| Many small `INSERT`s over time | `OPTIMIZE` (or predictive optimization on managed tables) |

Delta helps in a second way: it copies each file's min/max statistics into the log, so the engine can skip whole files **without even opening their footers**.

## 🧪 Try it: write and open a Parquet file

```dataset retail
```

Write 1,000 orders as **plain Parquet** (not Delta) into a volume, so you can look at the files directly.

```python run
# Write 1,000 orders as two Parquet files and list the folder
import os

path = data.volume(CATALOG, SCHEMA) + "/parquet_demo/orders"
(spark.table("fact_orders").where("order_id <= 1000")
     .repartition(2)
     .write.mode("overwrite").parquet(path))

for name in sorted(os.listdir(path)):
    print(f"{os.path.getsize(os.path.join(path, name)):>8} bytes  {name}")
```

```python run
# The magic bytes and the footer length at the end of the file
first = os.path.join(path, sorted(f for f in os.listdir(path) if f.endswith(".parquet"))[0])
with open(first, "rb") as f:
    head = f.read(4)
    f.seek(-8, os.SEEK_END)
    tail = f.read(8)
print("first 4 bytes:", head)
print("footer length:", int.from_bytes(tail[:4], "little"), "bytes")
print("last 4 bytes: ", tail[4:])
```

```python run
# Read the footer: schema, row groups and statistics per column chunk
import pyarrow.parquet as pq

meta = pq.ParquetFile(first).metadata
print(meta)
print(meta.schema)
rg = meta.row_group(0)
for i in range(rg.num_columns):
    col, st = rg.column(i), rg.column(i).statistics
    mn, mx = (st.min, st.max) if st is not None and st.has_min_max else (None, None)
    print(f"{col.path_in_schema:<12} {col.compression:<8} {str(col.encodings):<36} min={mn} max={mx}")
```

```python run
# Spark reads the schema from the footers; explain() shows pruning and pushed filters
orders = spark.read.parquet(path)
orders.printSchema()
q = orders.where("order_date BETWEEN '2025-03-01' AND '2025-03-31'").select("order_id", "quantity")
q.explain()
display(q)
```

> Besides the `part-…` files you may see `_SUCCESS`, `_started_…` or `_committed_…` files. They are written by the job's commit protocol and are not Parquet. In the plan, look for `ReadSchema` (only the selected and filtered columns) and the pushed or data filters on `order_date`.

## Exercise 1: sorted data skips better

Write the same orders twice: once spread randomly over 4 files, once range-partitioned by `order_date`. **Predict** how many files a filter on one day could skip in each case, then print each file's min and max `order_date`.

```python todo
# TODO 1: write fact_orders (order_id <= 4000) to <volume>/parquet_ex/random with .repartition(4)
# TODO 2: write the same rows to <volume>/parquet_ex/sorted with .repartitionByRange(4, "order_date")
# TODO 3: for every .parquet file in both folders, print min and max of order_date from the footer
```

```python solution
import os
import pyarrow.parquet as pq

base = data.volume(CATALOG, SCHEMA) + "/parquet_ex"
rows = spark.table("fact_orders").where("order_id <= 4000")
rows.repartition(4).write.mode("overwrite").parquet(base + "/random")
rows.repartitionByRange(4, "order_date").write.mode("overwrite").parquet(base + "/sorted")

for layout in ["random", "sorted"]:
    folder = f"{base}/{layout}"
    for name in sorted(f for f in os.listdir(folder) if f.endswith(".parquet")):
        meta = pq.ParquetFile(os.path.join(folder, name)).metadata
        idx = meta.schema.to_arrow_schema().get_field_index("order_date")
        st = meta.row_group(0).column(idx).statistics
        print(f"{layout:<7} {name[:20]}  {st.min} .. {st.max}")
# random: every file covers the whole date range, so nothing can be skipped.
# sorted: each file covers its own date range, so a one-day filter reads one file.
```

## Exercise 2: compare codecs

Write 4,000 orders once with `snappy` and once with `zstd`. **Predict** which folder is smaller, then measure.

```python todo
# TODO 1: write the rows with .option("compression", "snappy") to <volume>/parquet_codec/snappy
# TODO 2: write them with .option("compression", "zstd") to <volume>/parquet_codec/zstd
# TODO 3: print the total size of the .parquet files in each folder
```

```python solution
import os

base = data.volume(CATALOG, SCHEMA) + "/parquet_codec"
rows = spark.table("fact_orders").where("order_id <= 4000").coalesce(1)
for codec in ["snappy", "zstd"]:
    rows.write.mode("overwrite").option("compression", codec).parquet(f"{base}/{codec}")
    folder = f"{base}/{codec}"
    size = sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith(".parquet"))
    print(f"{codec:<7} {size:>8} bytes")
# zstd is usually smaller. Both files are read the same way: the codec is stored in the footer.

# Clean up the demo files when you are done
# import shutil; shutil.rmtree(data.volume(CATALOG, SCHEMA) + "/parquet_codec", ignore_errors=True)
```

## ⚠️ Common mistakes

- ❌ "Parquet is compressed CSV." It is columnar, split into row groups, and carries its own schema and statistics.
- ❌ "`SELECT *` costs the same as selecting two columns." With Parquet, every extra column is extra I/O.
- ❌ "Partitioning by `customer_id` speeds things up." It creates thousands of tiny files; use liquid clustering.
- ✅ Read Delta tables by name, never with `spark.read.parquet` on the table folder: that also returns rows from old, removed files.
- ✅ Filter on columns the data is sorted or clustered by, so min/max statistics can skip files.

## 🧭 Cheat sheet

| Term | Meaning |
|---|---|
| Row group | Horizontal slice of rows inside one file |
| Column chunk | One column's values within one row group |
| Page | Smallest encoded and compressed unit (about 1 MB) |
| Footer | Schema, offsets and min/max/null statistics, at the end of the file |
| Column pruning / predicate pushdown | Read only needed columns / skip row groups by statistics |
| Inspect a file | `pyarrow.parquet.ParquetFile(path).metadata` |
