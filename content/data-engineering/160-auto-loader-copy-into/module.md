---
title: Auto Loader and COPY INTO
summary: Load only the new files from a landing folder, exactly once. See how COPY INTO and Auto Loader remember what they loaded, how Auto Loader infers and evolves a schema, and where bad values go.
icon: 📥
level: Beginner
minutes: 12
group: Ingestion and pipelines
tags: [Auto Loader, COPY INTO, Ingestion, Schema evolution]
---
# Auto Loader and COPY INTO

> Files land in a folder all day. Each run must load the new ones, skip the ones already loaded, and survive a failure halfway. Both tools solve this by **remembering which files they have loaded**.

**The one idea to remember:** `COPY INTO` keeps the list of loaded files in the target table, Auto Loader keeps it in its **checkpoint**. Re-running either one loads only the files it has not seen.

## 📂 The problem: which files are new?

Reading the whole folder every run duplicates data. Tracking file names by hand breaks on the first failure. Watch Auto Loader do it instead.

```viz files
{"title": "landing/fact_orders/  and the Auto Loader checkpoint",
 "steps": [
  {"label": "First file lands", "note": "An upstream system drops `part_1.csv`. Nothing has been loaded yet.",
   "add": [{"path": "landing/fact_orders/part_1.csv", "tag": "new"}]},
  {"label": "Run 1", "note": "Auto Loader infers the schema and saves it, lists the folder, loads part_1 into the table, and records the file in its RocksDB state.",
   "add": [{"path": "_schema/_schemas/0", "tag": "inferred schema"},
           {"path": "_checkpoint/sources/0/rocksdb/…", "tag": "seen: part_1"},
           {"path": "_checkpoint/offsets/0", "tag": "batch 0 planned"},
           {"path": "_checkpoint/commits/0", "tag": "batch 0 done"}],
   "tag": {"landing/fact_orders/part_1.csv": "ingested"}},
  {"label": "More files land", "note": "Two new files arrive. The old file is untouched.",
   "add": [{"path": "landing/fact_orders/part_2.csv", "tag": "new"},
           {"path": "landing/fact_orders/part_3.csv", "tag": "new"}]},
  {"label": "Run 2", "note": "The state already contains part_1, so only part_2 and part_3 are read. One more offsets and commits pair is written.",
   "add": [{"path": "_checkpoint/offsets/1", "tag": "batch 1 planned"},
           {"path": "_checkpoint/commits/1", "tag": "batch 1 done"}],
   "tag": {"landing/fact_orders/part_2.csv": "ingested", "landing/fact_orders/part_3.csv": "ingested", "_checkpoint/sources/0/rocksdb/…": "seen: part_1, 2, 3"}},
  {"label": "Run 3, nothing new", "note": "No new files, so no new data is written. This is why a scheduled run is safe to repeat."}
 ]}
```

If a run fails after writing `offsets/1` but before `commits/1`, the next run redoes batch 1. The Delta sink knows which batches it already committed, so rows are not duplicated.

## 📋 COPY INTO: one SQL command

```sql
CREATE TABLE IF NOT EXISTS bronze_orders;          -- an empty placeholder is allowed

COPY INTO bronze_orders
FROM '/Volumes/main/landing/raw/orders/'
FILEFORMAT = CSV
FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true')
COPY_OPTIONS ('mergeSchema' = 'true');            -- new columns may extend the schema
```

- **Idempotent**: loaded files are recorded in the target table, and a re-run skips them.
- `PATTERN = '*.csv'` or `FILES = (...)` choose a subset. `COPY_OPTIONS ('force' = 'true')` reloads everything.
- Good for thousands of files on a schedule. For millions of files, or continuous arrival, use Auto Loader.

## 🌀 Auto Loader: a streaming source for files

Auto Loader is the `cloudFiles` source of Structured Streaming. One run goes through five steps.

```viz flow
{"title": "spark.readStream.format(\"cloudFiles\") ... .trigger(availableNow=True)",
 "nodes": [{"icon": "🔎", "title": "Discover", "sub": "find files not in the state", "color": "blue"},
           {"icon": "🧬", "title": "Schema", "sub": "infer once, then reuse", "color": "purple"},
           {"icon": "📖", "title": "Read", "sub": "parse new files", "color": "teal"},
           {"icon": "💾", "title": "Write", "sub": "append to a Delta table", "color": "green"},
           {"icon": "📌", "title": "Checkpoint", "sub": "offsets, commits, file state", "color": "navy"}],
 "steps": [
  {"label": "Discover", "focus": [0], "note": "List the input path (or read file events) and compare against the file paths stored in the checkpoint's **RocksDB** state."},
  {"label": "Schema", "focus": [1], "note": "On the very first run, sample files to infer a schema and store it in `cloudFiles.schemaLocation`. Later runs read the stored schema, so it does not drift."},
  {"label": "Read", "focus": [2], "note": "Parse only the new files. Values that do not fit the schema go to `_rescued_data` instead of failing the run."},
  {"label": "Write", "focus": [3], "note": "Append the batch to the target table in one Delta commit."},
  {"label": "Checkpoint", "focus": [4], "note": "Mark the batch as committed. With `availableNow=True` the stream stops when there is nothing left, like a batch job."}
 ]}
```

## 🔎 Finding new files and choosing a trigger

| Discovery mode | How it works | When |
|---|---|---|
| **Directory listing** (default) | Lists the input path every run | Simple, no setup. Cost grows with the folder size |
| **File notification** (`cloudFiles.useNotifications`) | Cloud storage events go to a queue Auto Loader reads | Huge folders. Needs permission to create cloud resources |
| **Managed file events** | Events configured once on the Unity Catalog external location | The recommended option where it is available |

The trigger decides how long the stream lives. `trigger(availableNow=True)` processes everything new, then stops: run it from a Lakeflow Job on a schedule. Without it, the stream keeps running and picks up files within seconds.

## 🧬 Schema inference and evolution

Without type inference, CSV and JSON columns are read as strings. Set `cloudFiles.inferColumnTypes` to `true`, or pin types with `cloudFiles.schemaHints` (`"quantity INT, order_date DATE"`).

| `cloudFiles.schemaEvolutionMode` | A file brings a new column |
|---|---|
| `addNewColumns` (default without a schema) | The stream **fails once**, saves the new schema, and includes the column after a restart |
| `rescue` | The schema never changes. The new column goes to `_rescued_data` |
| `failOnNewColumns` | The stream fails until you change the schema or remove the file |
| `none` | The new column is ignored. This is the default when you pass `.schema(...)` |

With `addNewColumns`, set retries on the job so the restart happens on its own.

## 🛟 Rescued data and file metadata

A bad value does not fail the stream. Watch four CSV rows meet the schema `order_date DATE, quantity INT, discount DOUBLE`.

```viz table
{"title": "al_orders_rescued", "columns": ["order_id", "order_date", "quantity", "_rescued_data"],
 "rows": [[90001, "2026-11-01", "five", null], [90002, "not-a-date", "2", null], [90003, "2026-11-02", "1", null], [90004, "2026-11-02", "3", null]],
 "steps": [
  {"label": "Raw CSV", "note": "Every value arrives as text. The `discount` column of row 90003 says `ten percent` (not shown)."},
  {"label": "quantity = five", "note": "`five` is not an INT. The column becomes NULL and the original text is kept as JSON.", "upd": {"0": {"quantity": null, "_rescued_data": "{\"quantity\":\"five\", \"_file_path\":…}"}}, "hl": [0]},
  {"label": "Bad date", "note": "Same for the date that cannot be parsed.", "upd": {"1": {"order_date": null, "quantity": 2, "_rescued_data": "{\"order_date\":\"not-a-date\", …}"}}, "hl": [1]},
  {"label": "Bad discount", "note": "The bad value is in a column outside this view, but it is rescued the same way.", "upd": {"2": {"quantity": 1, "_rescued_data": "{\"discount\":\"ten percent\", …}"}}, "hl": [2]},
  {"label": "Find them", "note": "`WHERE _rescued_data IS NOT NULL` lists the rows to fix. Row 90004 was clean and loaded normally.", "upd": {"3": {"quantity": 3}}, "hl": [0, 1, 2]}
 ]}
```

Every file source also offers the hidden `_metadata` column: `_metadata.file_path`, `file_name`, `file_size`, `file_modification_time`. Select it into bronze tables so each row knows where it came from.

## ⚖️ Which one to use

```viz compare
{"items": [{"icon": "📋", "title": "COPY INTO", "sub": "SQL command", "color": "blue",
            "points": ["Incremental, idempotent batch", "Loaded files tracked in the target table", "✅ thousands of files, SQL only", "`mergeSchema` for new columns"],
            "foot": "Simple scheduled SQL loads"},
           {"icon": "🌀", "title": "Auto Loader", "sub": "cloudFiles streaming source", "color": "green",
            "points": ["Incremental, streaming or `availableNow`", "Files tracked in the checkpoint", "✅ millions of files, notifications", "Evolution modes, hints, `_rescued_data`"],
            "foot": "The default for production ingestion"},
           {"icon": "📄", "title": "read_files (batch)", "sub": "SQL table-valued function", "color": "gray",
            "points": ["Reads **all** matching files each time", "No state, nothing remembered", "✅ exploring a folder, one-off loads", "`STREAM read_files(...)` is Auto Loader in SQL pipelines"],
            "foot": "Look before you load"}]}
```

## 🧪 Try it: files arrive, only new ones load

```dataset retail
```

Land the first of three order files in a volume. The cell starts clean every time you run it.

```python run
# Land the first file (clean start)
import shutil
from pyspark.sql import functions as F

vol = data.volume(CATALOG, SCHEMA)
state = vol + "/autoloader_state"                       # schema and checkpoint live here
for p in (vol + "/autoloader_demo", state):
    shutil.rmtree(p, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS al_orders_bronze")

landing = ds.land_files(vol + "/autoloader_demo", parts=3, upto=1)
```

```python run
# Auto Loader: load whatever is new, then stop
def ingest():
    q = (spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "csv")
            .option("header", "true")
            .option("cloudFiles.inferColumnTypes", "true")
            .option("cloudFiles.schemaLocation", state + "/schema")
            .load(landing + "/fact_orders")
            .withColumn("source_file", F.col("_metadata.file_name"))
         .writeStream
            .option("checkpointLocation", state + "/checkpoint")
            .trigger(availableNow=True)
            .toTable("al_orders_bronze"))
    q.awaitTermination()
    spark.table("al_orders_bronze").groupBy("source_file").count().orderBy("source_file").show()

ingest()
```

```python run
# A second file arrives: run the same stream again
ds.land_files(landing, parts=3, upto=2)
ingest()        # part_1 is not read again: still 20,000 rows from it
```

```python run
# COPY INTO from the same folder, twice
spark.sql("DROP TABLE IF EXISTS ci_orders")
spark.sql("CREATE TABLE IF NOT EXISTS ci_orders")
copy = f"""
  COPY INTO ci_orders FROM '{landing}/fact_orders'
  FILEFORMAT = CSV
  FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true')
  COPY_OPTIONS ('mergeSchema' = 'true')"""
spark.sql(copy).show()   # loads part_1 and part_2: 40,000 rows
spark.sql(copy).show()   # 0 rows: both files are already recorded
```

> Look at the schema of `al_orders_bronze`: Auto Loader added a `_rescued_data` column on its own. Files under `state` are the checkpoint; never share one checkpoint between two streams.

## Exercise 1: rescue the bad rows

`ds.land_files` also writes `fact_orders_bad/fact_orders_bad.csv`, four rows with broken values. Load it with Auto Loader and schema hints. Predict which rows get a `_rescued_data` value.

```python todo
# TODO 1: base = data.volume(CATALOG, SCHEMA) + "/al_rescue"; ds.land_files(base, parts=3, upto=1)
# TODO 2: readStream cloudFiles (csv, header, inferColumnTypes) from base + "/fact_orders_bad"
#         with cloudFiles.schemaHints = "order_date DATE, quantity INT, discount DOUBLE"
# TODO 3: write with availableNow to al_orders_rescued, then show the rows with _rescued_data
```

```python solution
import shutil
base = data.volume(CATALOG, SCHEMA) + "/al_rescue"
shutil.rmtree(base, ignore_errors=True)
spark.sql("DROP TABLE IF EXISTS al_orders_rescued")
ds.land_files(base, parts=3, upto=1)

(spark.readStream.format("cloudFiles")
    .option("cloudFiles.format", "csv")
    .option("header", "true")
    .option("cloudFiles.inferColumnTypes", "true")
    .option("cloudFiles.schemaHints", "order_date DATE, quantity INT, discount DOUBLE")
    .option("cloudFiles.schemaLocation", base + "/_schema")
    .load(base + "/fact_orders_bad")
 .writeStream
    .option("checkpointLocation", base + "/_checkpoint")
    .trigger(availableNow=True)
    .toTable("al_orders_rescued")
 .awaitTermination())

spark.sql("SELECT order_id, order_date, quantity, discount, _rescued_data FROM al_orders_rescued").show(truncate=False)
# 90001 (quantity), 90002 (order_date) and 90003 (discount) are rescued. 90004 is clean.
```

## Exercise 2: what does force do?

Land two files, run `COPY INTO` twice, then once more with `'force' = 'true'`. Predict the row count after each run.

```python todo
# TODO 1: base = data.volume(CATALOG, SCHEMA) + "/ci_force"; ds.land_files(base, parts=3, upto=2)
# TODO 2: create ci_force_orders, COPY INTO it from base + "/fact_orders" twice, count rows
# TODO 3: COPY INTO again with COPY_OPTIONS ('force' = 'true', 'mergeSchema' = 'true'), count rows
```

```python solution
import shutil
base = data.volume(CATALOG, SCHEMA) + "/ci_force"
shutil.rmtree(base, ignore_errors=True)
ds.land_files(base, parts=3, upto=2)
spark.sql("DROP TABLE IF EXISTS ci_force_orders")
spark.sql("CREATE TABLE IF NOT EXISTS ci_force_orders")

def copy(options):
    spark.sql(f"""COPY INTO ci_force_orders FROM '{base}/fact_orders' FILEFORMAT = CSV
                  FORMAT_OPTIONS ('header' = 'true', 'inferSchema' = 'true')
                  COPY_OPTIONS ({options})""")
    print(spark.table("ci_force_orders").count())

copy("'mergeSchema' = 'true'")                    # 40,000
copy("'mergeSchema' = 'true'")                    # 40,000: nothing new
copy("'force' = 'true', 'mergeSchema' = 'true'")  # 80,000: every order_id is now duplicated

# Clean up when you are done
# spark.sql("DROP TABLE ci_force_orders"); spark.sql("DROP TABLE al_orders_rescued"); shutil.rmtree(base)
```

## ⚠️ Common mistakes

- ❌ "COPY INTO reloads every file each run." It skips files it already loaded, unless `force` is set.
- ❌ Deleting the checkpoint to "fix" a stream. Auto Loader forgets every file and loads them all again.
- ❌ Expecting `rescue` mode to add new columns. It never changes the schema.
- ❌ Expecting `addNewColumns` to continue without a restart. It stops once, then picks the column up.
- ✅ One checkpoint and one schema location per stream, stored in a volume.
- ✅ `availableNow` plus a scheduled job: incremental loads at batch cost.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Load new files with SQL, on a schedule | `COPY INTO t FROM 'path' FILEFORMAT = ...` |
| Load new files at any scale | `spark.readStream.format("cloudFiles")` |
| Run a stream like a batch job | `.trigger(availableNow=True)` |
| Keep the inferred schema | `cloudFiles.schemaLocation` |
| Pin some column types | `cloudFiles.schemaHints` |
| Find rows that did not fit | `WHERE _rescued_data IS NOT NULL` |
| Know the source file of each row | `_metadata.file_path` |
