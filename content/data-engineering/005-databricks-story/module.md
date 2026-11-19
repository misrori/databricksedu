---
title: "The Databricks story: from one machine to a data + AI platform"
summary: Follow the problems that shaped Databricks, from one overloaded server to Hadoop, Spark, PySpark, the lakehouse, Unity Catalog and Mosaic AI. Know why each piece exists and which problem it solves.
icon: 📖
level: Beginner
minutes: 9
group: Lakehouse foundations
tags: [History, Apache Spark, Lakehouse, Delta Lake, Unity Catalog, Mosaic AI]
---
# The Databricks story: from one machine to a data + AI platform

> Every part of Databricks exists because something earlier broke. Follow the chain of problems and breakthroughs, from one server running one job to a platform where engineers, analysts, scientists and business users work on the same data.

**The one idea to remember:** each step solved the previous step's problem and created the next one: **scale**, then **speed**, then **ease of use**, then **operations**, then **trust**, then **governance**, then **AI**.

> 🎨 Prefer the hand-drawn version? [Open the animated sketch story](https://misrori.github.io/databricksedu/extras/databricks-story/)

## 🖥️ One machine, one job

A company has data: sales, transactions, logs, events. Someone writes SQL, Python or Java, it runs on one machine, a laptop or a server, and returns a result. Everyone is happy, until the data grows.

```viz flow
{"title": "The classic setup",
 "nodes": [{"icon": "🗃️", "title": "Data", "sub": "sales, logs, events", "color": "blue"},
           {"icon": "🖥️", "title": "One machine", "sub": "CPU, RAM, one disk", "color": "navy"},
           {"icon": "📊", "title": "Result", "sub": "a report, a table", "color": "green"}],
 "edges": ["read", "compute"],
 "steps": [{"label": "Gigabytes", "focus": [0, 1, 2], "note": "A few GB fit on one disk and mostly in memory. The job finishes in minutes. ✓"},
           {"label": "Terabytes", "focus": [0, 1], "note": "More users, more transactions, more history. The same job now runs for hours. The machine is **struggling**."},
           {"label": "Petabytes + unstructured", "focus": [1], "note": "Images, video and PDFs join the tables. The data no longer fits on one machine, and the job never returns a result."}]}
```

## 🏋️ A bigger machine, or more machines?

The obvious first move is a bigger box: more RAM, a faster CPU, bigger disks. It works for a while. But it is still **one** machine. Prices climb steeply at the top end, and if it crashes, everything stops. The lasting answer was to spread the work across many ordinary machines.

```viz compare
{"title": "Two ways to grow",
 "items": [{"icon": "🏋️", "title": "Scale up", "sub": "one bigger machine", "color": "amber",
            "points": ["✅ no code changes", "❌ hard ceiling: the biggest box you can buy", "❌ single point of failure: crash = full stop"]},
           {"icon": "🧑‍🤝‍🧑", "title": "Scale out", "sub": "many machines together", "color": "green",
            "points": ["✅ need more power? add machines", "✅ one machine fails, the others take over", "❌ the work must be split and coordinated"]}]}
```

## 🐘 Hadoop MapReduce: divide and conquer

Hadoop (open source, around 2006) made scale-out practical. Data is split across many machines, each with its own CPU and disk. A job runs in two phases: **map** works on every piece in parallel, **reduce** combines the partial results.

```viz flow
{"title": "One MapReduce job",
 "nodes": [{"icon": "🧩", "title": "Split", "sub": "data spread over many machines", "color": "blue"},
           {"icon": "🗺️", "title": "Map", "sub": "each machine works on its piece", "color": "teal"},
           {"icon": "💾", "title": "Disk", "sub": "intermediate results", "color": "gray"},
           {"icon": "➕", "title": "Reduce", "sub": "combine the partial results", "color": "purple"},
           {"icon": "📊", "title": "Result", "color": "green"}],
 "edges": ["", "write", "read", ""],
 "steps": [{"label": "Scale out", "focus": [0, 1], "note": "Terabytes, even petabytes: every machine processes its own part. Add machines to go faster."},
           {"label": "Fault tolerant", "focus": [1], "note": "If one machine fails, another reruns its piece. The job survives."},
           {"label": "Slow on disk", "focus": [2], "note": "Every step **writes to disk and reads back**. A pipeline of ten steps pays that ten times, and disks are slow."},
           {"label": "Result", "focus": [3, 4], "note": "Scaling is solved. Speed is the next problem."}]}
```

## ⚡ Spark: compute in memory, then in Python

Apache Spark started in 2009 at UC Berkeley. Same idea, divide the data across machines, with one critical change: keep intermediate data **in memory** instead of writing it to disk between steps. Multi-step and iterative jobs became much faster, and Spark became the dominant engine. But it was for experts in Scala or Java. **PySpark** brought it to Python:

```python
# pandas, on one machine
df.groupby("city").size()

# PySpark: looks almost the same, runs on many machines
df.groupBy("city").count()
```

## 🧰 Databricks: one managed platform

Spark was powerful but a pain to run: clusters, scaling, security, failures, plus storage, notebooks, scheduling and monitoring in separate tools, all while moving from on-premises to the cloud. Teams wanted to build pipelines, not babysit clusters. In 2013 the creators of Spark founded **Databricks** to hide that complexity.

```viz layers
{"layers": [{"icon": "👩‍💻", "title": "Your team", "sub": "builds pipelines and analysis", "color": "green", "items": ["SQL", "Python", "notebooks"]},
            {"icon": "🧰", "title": "Databricks", "sub": "one managed platform", "color": "blue", "items": ["workspaces", "jobs", "monitoring"]},
            {"icon": "⚙️", "title": "Hidden complexity", "sub": "handled for you", "color": "gray", "items": ["clusters", "autoscaling", "security", "failures"]},
            {"icon": "☁️", "title": "Cloud", "sub": "storage and virtual machines", "color": "navy", "items": ["AWS", "Azure", "GCP"]}]}
```

## 🏞️ Lake, warehouse, lakehouse

Storage was cheap, so companies dumped everything into a **data lake**. With no structure and no control, schema changes went unnoticed and lakes became swamps nobody trusted. BI still ran on a **warehouse**, so data was copied between two worlds. **Delta Lake** added transactions to the lake: one data layer for everyone.

```viz compare
{"items": [{"icon": "🏞️", "title": "Data lake", "sub": "files in cheap storage", "color": "teal",
            "points": ["✅ any data, very cheap", "❌ no transactions, no schema checks", "❌ turns into a swamp"]},
           {"icon": "🏛️", "title": "Data warehouse", "sub": "tables for BI", "color": "blue",
            "points": ["✅ fast, reliable SQL", "❌ costly, closed format", "❌ a second copy of the data"]},
           {"icon": "🏠", "title": "Lakehouse", "sub": "Delta Lake on the lake", "color": "green",
            "points": ["✅ open files, cheap storage", "✅ ACID transactions, schema, history", "✅ one copy for BI, ETL and AI"]}]}
```

The details are in the "Lakehouse architecture" module.

## 🛡️ Govern it, then ask it

Once everyone uses one data layer, speed is no longer the problem. **Governance** is: teams, regions, regulations. Then a new wish arrives: business users want to ask "show me Q3 sales" in plain language, not write SQL.

```viz compare
{"items": [{"icon": "🛡️", "title": "Unity Catalog", "sub": "one governance layer", "color": "purple",
            "points": ["Problem: who can see what, and why?", "One place for permissions", "Audit logs and lineage behind every number"]},
           {"icon": "🤖", "title": "Mosaic AI", "sub": "data meets AI", "color": "pink",
            "points": ["Problem: AI needs governed data", "Build, serve and evaluate models and agents", "On the same tables, under the same permissions"]}]}
```

On top of both, AI/BI Genie lets business users ask questions in plain language.

## 🗺️ The whole journey

Step through it: each breakthrough answers the problem left by the one before.

```viz timeline
{"title": "From one machine to a data + AI platform",
 "items": [
  {"label": "🐘", "title": "Hadoop MapReduce", "sub": "~2006 · scale out", "color": "amber", "note": "Problem: one machine cannot hold or process big data. Breakthrough: many machines, divide and conquer, fault tolerant."},
  {"label": "⚡", "title": "Apache Spark", "sub": "2009 · in memory", "color": "red", "note": "Problem: MapReduce writes to disk after every step. Breakthrough: keep data in memory between steps."},
  {"label": "🐍", "title": "PySpark", "sub": "Python API", "color": "teal", "note": "Problem: Spark needed Scala or Java experts. Breakthrough: pandas-like Python that runs on a cluster."},
  {"label": "🧰", "title": "Databricks", "sub": "2013 · managed", "color": "blue", "note": "Problem: running clusters is hard work. Breakthrough: one managed platform in the cloud."},
  {"label": "🏠", "title": "Delta Lake", "sub": "the lakehouse", "color": "green", "note": "Problem: swamps on one side, costly warehouse copies on the other. Breakthrough: transactions on open files."},
  {"label": "🛡️", "title": "Unity Catalog", "sub": "governance", "color": "purple", "note": "Problem: who may see what, and where did this number come from? Breakthrough: one layer for permissions, audit and lineage."},
  {"label": "🤖", "title": "Mosaic AI", "sub": "data + AI", "color": "pink", "note": "Problem: people want to ask, not code, and AI must use trusted data. Breakthrough: AI built on the governed lakehouse."}
 ]}
```

## 🏢 The platform today

Everyone works on one platform and one copy of the data, in Python, PySpark or SQL, powered by the distributed Spark engine. And it keeps evolving.

```viz layers
{"layers": [{"icon": "👥", "title": "People", "sub": "one platform, everyone together", "color": "green", "items": ["data engineers", "analysts", "data scientists", "AI engineers", "business users"]},
            {"icon": "🤖", "title": "AI and BI", "sub": "Mosaic AI, AI/BI dashboards and Genie", "color": "pink", "items": ["models", "agents", "plain-language questions"]},
            {"icon": "🛡️", "title": "Unity Catalog", "sub": "governance for data and AI", "color": "purple", "items": ["permissions", "audit", "lineage"]},
            {"icon": "🏠", "title": "Lakehouse", "sub": "Delta Lake tables", "color": "blue", "items": ["ACID", "history", "open format"]},
            {"icon": "⚡", "title": "Spark engine + cloud storage", "sub": "distributed compute, cheap storage", "color": "navy", "items": ["Python", "PySpark", "SQL"]}]}
```

## 🧪 Try it: the whole story in one query

```dataset retail
```

60,000 orders are tiny for Spark, but the code is the same at 60 billion. It reads like pandas and runs distributed.

```python run
# Pandas-like code, distributed execution
from pyspark.sql import functions as F

orders = spark.table("fact_orders")
customers = spark.table("dim_customer")

by_region = orders.join(customers, "customer_id").groupBy("region").count()
display(by_region.orderBy(F.desc("count")))
```

```sql run
-- The same question in SQL, saved as a Delta table that Unity Catalog governs
CREATE OR REPLACE TABLE story_orders_by_region AS
SELECT c.region, count(*) AS orders
FROM fact_orders o JOIN dim_customer c ON o.customer_id = c.customer_id
GROUP BY c.region;

DESCRIBE HISTORY story_orders_by_region;   -- Delta Lake keeps every version
```

> Look at `by_region.explain()` if you are curious: the plan has `Exchange` steps, where rows move between machines. You wrote none of that.

## Exercise 1: same question, two languages

Find the three regions with the most **COMPLETED** orders, once with PySpark and once with SQL. Before you run them, predict: will Spark run the two versions differently?

```python todo
from pyspark.sql import functions as F

# TODO 1: PySpark: filter status = 'COMPLETED', join dim_customer, count per region, top 3
# TODO 2: SQL: the same query with spark.sql(...)
```

```python solution
from pyspark.sql import functions as F

top_py = (spark.table("fact_orders").filter(F.col("status") == "COMPLETED")
          .join(spark.table("dim_customer"), "customer_id")
          .groupBy("region").count()
          .orderBy(F.desc("count")).limit(3))
display(top_py)

top_sql = spark.sql("""
  SELECT c.region, count(*) AS count
  FROM fact_orders o JOIN dim_customer c ON o.customer_id = c.customer_id
  WHERE o.status = 'COMPLETED'
  GROUP BY c.region ORDER BY count DESC LIMIT 3""")
display(top_sql)
# Same answer, and practically the same plan: PySpark and SQL both go through
# the same optimizer and the same distributed engine.
```

## Exercise 2: match the problem to the breakthrough

Fill in the dictionary from memory, then compare with the solution.

```python todo
# TODO: replace each "?" with Hadoop, Spark, PySpark, Databricks, Delta Lake, Unity Catalog or Mosaic AI
answers = {
    "Intermediate results go to disk after every step": "?",
    "Lakes became swamps and BI needed a second copy": "?",
    "Nobody knows who may see which table": "?",
    "Running clusters takes all the team's time": "?",
    "One machine cannot hold petabytes": "?",
}
for problem, fix in answers.items():
    print(f"{problem:<52} -> {fix}")
```

```python solution
answers = {
    "Intermediate results go to disk after every step": "Spark",
    "Lakes became swamps and BI needed a second copy": "Delta Lake",
    "Nobody knows who may see which table": "Unity Catalog",
    "Running clusters takes all the team's time": "Databricks",
    "One machine cannot hold petabytes": "Hadoop",
}
for problem, fix in answers.items():
    print(f"{problem:<52} -> {fix}")

# Clean up the demo table when you are done
# spark.sql("DROP TABLE IF EXISTS story_orders_by_region")
```

## ⚠️ Common mistakes

- ❌ "Spark replaced the Hadoop idea." It kept divide and conquer. It changed where intermediate data lives: memory instead of disk.
- ❌ "In memory means the data must fit in RAM." Spark spills to disk when it has to. Memory is used to avoid disk, not to forbid it.
- ❌ "PySpark is pandas on a cluster." It looks similar, but it is lazy and distributed. `toPandas()` pulls every row onto one machine again.
- ❌ "Databricks is hosted Spark." Spark is the engine. Delta Lake, Unity Catalog, Lakeflow and Mosaic AI are built around it.
- ✅ Keep one governed copy of the data in the lakehouse instead of copying it between a lake and a warehouse.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| Process big data in Python | PySpark DataFrames, `df.groupBy(...).agg(...)` |
| Reliable tables with history on cheap storage | Delta Lake |
| Control and audit who sees what | Unity Catalog |
| Schedule pipelines without managing servers | Lakeflow Jobs on serverless compute |
| Build and serve models and agents | Mosaic AI |
| Let business users ask in plain language | AI/BI Genie |
