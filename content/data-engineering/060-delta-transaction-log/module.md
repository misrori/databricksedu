---
title: The Delta transaction log
summary: Read a Delta commit file line by line. Learn every action type, how per-file statistics enable data skipping, how checkpoints keep reads fast, and how a reader rebuilds a table version.
icon: 📜
level: Intermediate
minutes: 12
group: Delta Lake internals
tags: [Delta Lake, Transaction log, Checkpoints, Data skipping]
---
# The Delta transaction log

> The `_delta_log` folder is the source of truth for a Delta table. It is an ordered list of commits, each one a small file of **actions**. Replay them and you get the exact table at any version.

**The one idea to remember:** a table version is the result of replaying actions in order: start from the latest checkpoint, apply the later JSON commits, and keep every file whose last action is `add`.

## 📜 Version 0: protocol and metaData

Each commit is one file named after its version, zero-padded to **20 digits**: `00000000000000000000.json`, `…01.json`, and so on. A file holds one JSON action per line. This is version 0 of an empty table (formatted over several lines).

```viz code
title: _delta_log/00000000000000000000.json
lang: json
---
{"commitInfo": {"timestamp": 1762425600000, "operation": "CREATE TABLE",
                "isolationLevel": "WriteSerializable", "isBlindAppend": true}}
{"protocol": {"minReaderVersion": 3, "minWriterVersion": 7,
              "readerFeatures": ["deletionVectors"],
              "writerFeatures": ["deletionVectors", "invariants", "appendOnly"]}}
{"metaData": {"id": "5b1c0d6e-2f4a-4c1e-9a77-0f3d2b8e61aa",
              "format": {"provider": "parquet", "options": {}},
              "schemaString": "{\"type\":\"struct\",\"fields\":[{\"name\":\"order_id\",
                  \"type\":\"long\",\"nullable\":true,\"metadata\":{}}, …]}",
              "partitionColumns": [],
              "configuration": {"delta.enableDeletionVectors": "true"},
              "createdTime": 1762425600000}}
---
1-2 | commitInfo | Audit data: when, which operation, which isolation level. `DESCRIBE HISTORY` is built from these.
3 | Protocol versions | Reader version 3 and writer version 7 mean "table features": the needed features are listed by name instead of implied by a number.
4-5 | Features | A client must support every reader feature to read the table and every writer feature to write it. Otherwise it refuses, instead of corrupting data.
6-7 | Table id and format | A unique id for the table. Data files are Parquet.
8-9 | schemaString | The whole schema as a JSON string. Schema enforcement checks every write against it.
10-11 | Partitions and properties | Partition columns, and every `TBLPROPERTIES` value. A schema or property change writes a new `metaData` action; the latest one wins.
```

## ➕ An INSERT commit: add with statistics

Version 1 appends 1,000 rows. The data file is written first; this commit is what makes it part of the table.

```viz code
title: _delta_log/00000000000000000001.json
lang: json
---
{"commitInfo": {"timestamp": 1762425660000, "operation": "WRITE",
                "operationParameters": {"mode": "Append", "partitionBy": "[]"},
                "readVersion": 0, "isolationLevel": "WriteSerializable", "isBlindAppend": true,
                "operationMetrics": {"numFiles": "1", "numOutputRows": "1000", "numOutputBytes": "21950"}}}
{"add": {"path": "part-00000-7c2e41b0-c000.snappy.parquet",
         "partitionValues": {}, "size": 21950,
         "modificationTime": 1762425659000, "dataChange": true,
         "stats": "{\"numRecords\":1000,
            \"minValues\":{\"order_id\":1,\"order_date\":\"2025-01-01\",\"status\":\"CANCELLED\"},
            \"maxValues\":{\"order_id\":1000,\"order_date\":\"2026-10-30\",\"status\":\"TEST\"},
            \"nullCount\":{\"order_id\":0,\"order_date\":0,\"status\":0}}"}}
---
1-2 | Operation | `INSERT INTO` appears in the history as `WRITE` with mode `Append`.
3 | readVersion, isBlindAppend | The commit was based on version 0, and it only appended without reading the table. Blind appends cannot conflict with each other.
4 | operationMetrics | Files, rows and bytes written. The history shows these per version.
5-6 | path, size | The path is relative to the table folder. Partition values would appear here for a partitioned table.
7 | dataChange | `true`: rows changed. `OPTIMIZE` writes `false`, so streaming readers know nothing new arrived.
8-11 | stats | Row count, min, max and null count per column, stored as a JSON string. This is what data skipping uses.
```

## 🗂️ The other actions

Five more action types cover everything else a commit can do.

| Action | Written by | What it records |
|---|---|---|
| `remove` | `UPDATE`, `DELETE`, `MERGE`, `OPTIMIZE`, overwrite | The file leaves the table. `deletionTimestamp` tells `VACUUM` when it may be deleted |
| `add` + `deletionVector` | DML on tables with deletion vectors | The same file is re-added with a pointer to a `.bin` file that marks deleted rows |
| `cdc` | `UPDATE`, `DELETE`, `MERGE` with Change Data Feed on | A file under `_change_data/` holding the changed rows |
| `txn` | Structured Streaming, idempotent writes | An `appId` and a `version`, so a retried batch is not written twice |
| `domainMetadata` | Features such as liquid clustering, row tracking | Named configuration for one feature, for example the clustering columns |

A commit never edits an earlier commit. To undo something, Delta writes a new commit with the opposite actions.

## 🎯 Statistics drive data skipping

The planner reads the `stats` of every `add` in the snapshot and drops files that cannot match the filter. Step through `WHERE order_date = '2025-05-10'`.

```viz table
{"title": "add actions in the current snapshot",
 "columns": ["file", "min order_date", "max order_date", "decision"],
 "rows": [["part-0001", "2025-01-01", "2025-03-31", "?"],
          ["part-0002", "2025-04-01", "2025-06-30", "?"],
          ["part-0003", "2025-07-01", "2025-09-30", "?"],
          ["part-0004", "2025-01-01", "2026-10-31", "?"]],
 "steps": [
  {"label": "Stats from the log", "note": "Min and max come from the `add` actions, so no data file and no Parquet footer is opened yet."},
  {"label": "Compare", "note": "2025-05-10 lies outside the range of files 1 and 3, so they are **skipped**. Files 2 and 4 might contain it.",
   "upd": {"0": {"decision": "skip"}, "1": {"decision": "read"}, "2": {"decision": "skip"}, "3": {"decision": "read"}}, "hl": [1, 3]},
  {"label": "The wide file", "note": "File 4 came from an unsorted append and spans the whole period, so it can never be skipped. Clustering and `OPTIMIZE` produce files with narrow ranges.", "hl": [3]},
  {"label": "Which columns", "note": "Stats are collected for the first 32 columns by default (`delta.dataSkippingNumIndexedCols`), or for the columns in `delta.dataSkippingStatsColumns`. A filter on any other column skips nothing."}
 ]}
```

## 🏁 Checkpoints and .crc files

Replaying thousands of JSON files would make every query slow to plan. So Delta regularly writes a **checkpoint**: one Parquet file with the complete state at a version.

```viz files
{"title": "orders/_delta_log/  (step through)", "steps": [{"label": "Commits 0 to 3", "note": "One JSON file per write, named after the version.", "add": [{"path": "_delta_log/00000000000000000000.json", "tag": "v0"}, {"path": "_delta_log/00000000000000000001.json", "tag": "v1"}, {"path": "_delta_log/00000000000000000002.json", "tag": "v2"}, {"path": "_delta_log/00000000000000000003.json", "tag": "v3"}]}, {"label": "Commits 4 to 9", "note": "A reader starting from scratch would now open ten JSON files.", "add": [{"path": "_delta_log/00000000000000000004.json", "tag": "v4"}, {"path": "_delta_log/00000000000000000005.json", "tag": "v5"}, {"path": "_delta_log/00000000000000000006.json", "tag": "v6"}, {"path": "_delta_log/00000000000000000007.json", "tag": "v7"}, {"path": "_delta_log/00000000000000000008.json", "tag": "v8"}, {"path": "_delta_log/00000000000000000009.json", "tag": "v9"}]}, {"label": "Commit 10 + checkpoint", "note": "After commit 10 the writer also saves a **checkpoint** (the full state at v10) and points `_last_checkpoint` at it.", "add": [{"path": "_delta_log/00000000000000000010.json", "tag": "v10"}, {"path": "_delta_log/00000000000000000010.checkpoint.parquet", "tag": "state at v10"}, {"path": "_delta_log/_last_checkpoint", "tag": "{\"version\":10}"}]}, {"label": "Commits 11 and 12", "note": "New commits are JSON again. Each commit also gets a `.crc` file with the version's size, file count, schema and protocol, used to validate the state (shown only for 11 and 12).", "add": [{"path": "_delta_log/00000000000000000011.json", "tag": "v11"}, {"path": "_delta_log/00000000000000000011.crc", "tag": "checksum v11"}, {"path": "_delta_log/00000000000000000012.json", "tag": "v12"}, {"path": "_delta_log/00000000000000000012.crc", "tag": "checksum v12"}]}, {"label": "Later: log cleanup", "note": "When a later checkpoint is written, commits older than `delta.logRetentionDuration` (30 days) that precede a checkpoint are deleted. The current state is intact; time travel to v0 to v9 stops working.", "delete": ["_delta_log/00000000000000000000.json", "_delta_log/00000000000000000001.json", "_delta_log/00000000000000000002.json", "_delta_log/00000000000000000003.json", "_delta_log/00000000000000000004.json", "_delta_log/00000000000000000005.json", "_delta_log/00000000000000000006.json", "_delta_log/00000000000000000007.json", "_delta_log/00000000000000000008.json", "_delta_log/00000000000000000009.json"]}]}
```

Classic checkpoints are written every few commits (`delta.checkpointInterval`, 10 in Delta Lake). Newer **V2 checkpoints** (table feature `v2Checkpoint`) split the state into a small top-level file plus sidecar files in `_delta_log/_sidecars/`, which scales to very large tables.

## 🔁 How a reader rebuilds a version

Every query starts by computing a **snapshot**: the schema plus the exact list of data files for one version.

```viz flow
{"title": "Reading version 12",
 "nodes": [
  {"icon": "📍", "title": "_last_checkpoint", "sub": "says: version 10", "color": "gray"},
  {"icon": "🏁", "title": "Checkpoint v10", "sub": "full state in Parquet", "color": "purple"},
  {"icon": "📜", "title": "Commits 11, 12", "sub": "JSON after the checkpoint", "color": "blue"},
  {"icon": "🧮", "title": "Reconcile", "sub": "apply actions in order", "color": "teal"},
  {"icon": "📸", "title": "Snapshot v12", "sub": "schema + live files + stats", "color": "green"}
 ],
 "edges": ["points to", "then list newer", "replay", "result"],
 "steps": [
  {"label": "Find a starting point", "focus": [0], "note": "The reader opens `_last_checkpoint`. It is only a hint, so the reader also **lists** `_delta_log` from version 10 upwards to find newer files."},
  {"label": "Load the checkpoint", "focus": [1], "note": "One Parquet read gives every live `add`, the recent `remove` tombstones, the latest `protocol` and `metaData`, and the `txn` versions."},
  {"label": "Replay the tail", "focus": [2], "note": "Commits 11 and 12 are read in version order. Only two small files, instead of thirteen."},
  {"label": "Reconcile", "focus": [3], "note": "A file is live if its **last** action is `add`. The newest `metaData` and `protocol` win, and the reader checks that it supports every listed feature."},
  {"label": "Use the snapshot", "focus": [4], "note": "The planner now has the schema and the file list with stats, and can skip files. `VERSION AS OF 11` does the same, but stops after commit 11."}
 ]}
```

## ⏳ Log retention vs data retention

Two separate clocks decide how far back you can go.

| Property | Default | What it controls |
|---|---|---|
| `delta.logRetentionDuration` | `interval 30 days` | How long commit files are kept. Older ones are cleaned up when a checkpoint is written |
| `delta.deletedFileRetentionDuration` | `interval 7 days` | How long a removed data file must stay before `VACUUM` may delete it |

Time travel to a version needs **both**: the log entries to rebuild it and the data files it lists. With the defaults, `VACUUM` is usually the limit: after it runs, versions older than about 7 days can no longer be read. For longer time travel, raise both with `ALTER TABLE … SET TBLPROPERTIES`.

## 🔬 Try it: open the log yourself

```dataset retail
```

Write a small Delta table into a **volume**, where plain Python can read its folder, and make four commits.

```python run
# A Delta table in a volume with four commits: write, insert, update, delete
import os, json, shutil

path = data.volume(CATALOG, SCHEMA) + "/txlog_orders"
shutil.rmtree(path, ignore_errors=True)            # start fresh on every run
spark.table("fact_orders").where("order_id <= 500").write.format("delta").save(path)
spark.sql(f"INSERT INTO delta.`{path}` SELECT * FROM fact_orders WHERE order_id BETWEEN 501 AND 1000")
spark.sql(f"UPDATE delta.`{path}` SET status = 'CANCELLED' WHERE order_id = 7")
spark.sql(f"DELETE FROM delta.`{path}` WHERE status = 'TEST'")

log = path + "/_delta_log"
for name in sorted(os.listdir(log)):
    print(name)
```

```python run
# Plain Python: operation and action counts per commit, then version 0 in detail
for name in sorted(f for f in os.listdir(log) if f.endswith(".json")):
    actions = [json.loads(line) for line in open(os.path.join(log, name))]
    kinds = [next(iter(a)) for a in actions]
    op = next(a["commitInfo"]["operation"] for a in actions if "commitInfo" in a)
    print(name, f"{op:<8}", {k: kinds.count(k) for k in dict.fromkeys(kinds)})

v0 = [json.loads(line) for line in open(f"{log}/{0:020d}.json")]
print("\nprotocol:", next(a["protocol"] for a in v0 if "protocol" in a))
print("configuration:", next(a["metaData"]["configuration"] for a in v0 if "metaData" in a))
first_add = next(a["add"] for a in v0 if "add" in a)
print("stats of", first_add["path"][:30], json.loads(first_add.get("stats") or "{}"))
```

```python run
# The same log read as a DataFrame: one column per action type
from pyspark.sql import functions as F

log_df = spark.read.json(log + "/*.json")
present = [c for c in ["commitInfo", "protocol", "metaData", "add", "remove", "cdc", "txn", "domainMetadata"] if c in log_df.columns]
kind = F.coalesce(*[F.when(F.col(c).isNotNull(), F.lit(c)) for c in present])
display(log_df.select(F.col("_metadata.file_name").alias("commit"), kind.alias("action"))
              .groupBy("commit").pivot("action").count().orderBy("commit"))
```

```python run
# The history is built from the commitInfo actions
display(spark.sql(f"DESCRIBE HISTORY delta.`{path}`")
             .select("version", "operation", "readVersion", "isBlindAppend", "operationMetrics"))
```

> Version 0 holds `protocol`, `metaData` **and** `add` actions: a DataFrame write creates the table and its first files in one commit. If deletion vectors are enabled, the `UPDATE` and `DELETE` commits show an `add` for the **same** path as a `remove`, now carrying a `deletionVector`.

## Exercise 1: decode an UPDATE

Write 1,000 orders as **one** file, then update one row. **Predict** before you run it: which actions will commit 1 contain, and how many rows will each added file hold?

```python todo
# TODO 1: write fact_orders (order_id <= 1000) with .coalesce(1) as Delta to <volume>/txlog_ex1 (remove the folder first)
# TODO 2: UPDATE one row (order_id = 42)
# TODO 3: for each action in commit 1, print its type, the path, numRecords from stats and whether it has a deletionVector
```

```python solution
import os, json, shutil

path = data.volume(CATALOG, SCHEMA) + "/txlog_ex1"
shutil.rmtree(path, ignore_errors=True)
spark.table("fact_orders").where("order_id <= 1000").coalesce(1).write.format("delta").save(path)
spark.sql(f"UPDATE delta.`{path}` SET status = 'OPEN' WHERE order_id = 42")

for line in open(f"{path}/_delta_log/{1:020d}.json"):
    kind, body = next(iter(json.loads(line).items()))
    if kind in ("add", "remove"):
        stats = json.loads(body.get("stats") or "{}")
        print(f"{kind:<7} {body['path'][:36]:<38} rows={stats.get('numRecords')} dv={bool(body.get('deletionVector'))}")
    else:
        print(kind)
# Without deletion vectors: remove the old file, add a rewritten file with 1000 rows.
# With deletion vectors: remove + add of the SAME path (now with a DV), plus a new file with 1 row.
```

## Exercise 2: trigger a checkpoint

Set the checkpoint interval to 5 and make enough commits to pass version 5. **Predict** which checkpoint file appears and what `_last_checkpoint` says.

```python todo
# TODO 1: write 100 orders as Delta to <volume>/txlog_ex2 (remove the folder first)       -> v0
# TODO 2: set the table property delta.checkpointInterval = 5 with ALTER TABLE delta.`path` -> v1
# TODO 3: five single-row INSERTs (v2 .. v6), then list _delta_log and print _last_checkpoint
```

```python solution
import os, shutil

path = data.volume(CATALOG, SCHEMA) + "/txlog_ex2"
shutil.rmtree(path, ignore_errors=True)
spark.table("fact_orders").where("order_id <= 100").write.format("delta").save(path)
spark.sql(f"ALTER TABLE delta.`{path}` SET TBLPROPERTIES ('delta.checkpointInterval' = '5')")
for i in range(5):
    spark.sql(f"INSERT INTO delta.`{path}` SELECT * FROM fact_orders WHERE order_id = {101 + i}")

log = path + "/_delta_log"
print("\n".join(sorted(os.listdir(log))))
marker = log + "/_last_checkpoint"
print(open(marker).read() if os.path.exists(marker) else "no checkpoint yet")
# Expect a checkpoint for version 5 (a classic .checkpoint.parquet, or a V2 checkpoint
# plus _sidecars/ if the table uses V2 checkpoints), and _last_checkpoint with "version":5.

# Clean up the demo folders when you are done
# shutil.rmtree(data.volume(CATALOG, SCHEMA) + "/txlog_ex1", ignore_errors=True)
# shutil.rmtree(data.volume(CATALOG, SCHEMA) + "/txlog_ex2", ignore_errors=True)
```

## ⚠️ Common mistakes

- ❌ "Each commit stores the whole table state." A commit stores only the **changes**; the state comes from replaying commits on top of a checkpoint.
- ❌ "Deleting old JSON files by hand saves space." It breaks the table. Delta cleans the log itself.
- ❌ "Stats exist for every column." Only the first 32 by default; put frequently filtered columns early or set `delta.dataSkippingStatsColumns`.
- ✅ Treat the log as read-only. Inspect it with `DESCRIBE HISTORY` and `DESCRIBE DETAIL`, or read it for learning as here.
- ✅ Raise **both** retention properties when you need longer time travel.

## 🧭 Cheat sheet

| Item | Remember |
|---|---|
| Commit file | `_delta_log/<20-digit version>.json`, one action per line |
| Core actions | `commitInfo`, `protocol`, `metaData`, `add`, `remove` |
| Other actions | `cdc`, `txn`, `domainMetadata`, `add` with `deletionVector` |
| Checkpoint | Full state in Parquet; `_last_checkpoint` points to the newest one |
| Snapshot | Latest checkpoint + later JSON commits, last action per file wins |
| Retention | Log: `delta.logRetentionDuration` 30 days. Files: `delta.deletedFileRetentionDuration` 7 days |
