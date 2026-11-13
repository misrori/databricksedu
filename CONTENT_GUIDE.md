# Writing a databricksedu module

One module = one small idea, taught in about 8 minutes. You write **one Markdown file**; the build turns it into
animated slides, a document view, a lecture notebook and an exercises notebook.

```
content/<category>/<NNN-slug>/module.md     required
content/<category>/<NNN-slug>/quiz.json     required (5 questions)
```

`<NNN-slug>`: a three-digit order number and the module id, for example `060-delta-transaction-log`.
The id (`delta-transaction-log`) must be unique across all categories.

Validate while you write (it writes nothing):

```bash
.venv/bin/python tools/build.py --check content/<category>/<NNN-slug>
```

The reference module is `content/data-engineering/050-delta-table-anatomy/`. Read it first.

## Front matter

```markdown
---
title: Anatomy of a Delta table
summary: One or two sentences for the module card. Say what the learner will be able to do.
icon: 🧬
level: Beginner            # Beginner | Intermediate | Advanced
minutes: 10
group: Delta Lake internals  # sub-heading inside the category
tags: [Delta Lake, Parquet, Transaction log]
---
```

## Body structure

```markdown
# Title                                   (same as the front matter title)

> One or two sentences that set the scene. This becomes the subtitle of the title slide.

**The one idea to remember:** a single sentence. It becomes the highlighted card on the title slide.

## 💡 First section                       every "## " heading is one slide and one notebook cell
...
## Exercise 1: short title                headings that start with "Exercise" go to the exercises notebook
...
## ⚠️ Common mistakes
## 🧭 Cheat sheet
```

Rules that keep slides readable:

- **8 to 12 sections** in total, including 2 or 3 exercises. A module is small on purpose.
- One section = one slide. Keep it to **one main element** (a visualization, a table, or a code block) plus at most
  about 70 words of text or 4 bullets. If it does not fit a slide, split the section.
- Start a heading with an emoji to set the slide icon (`## 📜 The transaction log`). Otherwise one is guessed.
- Tables: at most 4 columns and 6 rows.
- Write plain English in short sentences. Explain the *why*, not only the *what*. No filler, no marketing words.
- Use current product names (Lakeflow Jobs, Lakeflow Spark Declarative Pipelines, Unity Catalog, Declarative
  Automation Bundles). Mention the old name once where learners will still meet it ("formerly Delta Live Tables").
- Do not invent syntax. If you are not sure a statement runs on Databricks, show it as display-only code.

## Blocks

| Block | Slides and document | Notebook |
|---|---|---|
| ```` ```sql ```` / ```` ```python ```` / ```` ```json ```` / ```` ```yaml ```` / ```` ```bash ```` | highlighted code | shown inside the text cell |
| ```` ```sql run ```` / ```` ```python run ```` | code with a "runs in the notebook" badge | **a runnable cell** |
| ```` ```sql todo ```` / ```` ```python todo ```` | code with a "your turn" badge | a runnable starter cell |
| ```` ```sql solution ```` / ```` ```python solution ```` | collapsed "Show the solution" | collapsed inside the text cell |
| ```` ```viz <type> ```` | animated visualization | the same visualization |
| ```` ```dataset <name> ```` | dataset card and setup code | the three-step data setup (see below) |
| `**The one idea to remember:** ...` | highlighted idea card | same |
| `> text` | callout | same |
| `- ❌ ...` / `- ✅ ...` | red / green list items | same |

The first comment line of a `run` / `todo` block (`-- ...` or `# ...`) becomes the cell title.

## Demo data: the `dataset` block

Put this once, in a section called `## 🧪 Try it: ...`, before the first runnable cell that needs data:

````markdown
```dataset retail
```
````

In the notebook it expands to: (1) generate the data and register temp views, (2) two variables `CATALOG` and
`SCHEMA` that the learner fills in, followed by `data.use(CATALOG, SCHEMA)`, (3) SQL cells that create the tables
with primary and foreign keys. After it, your cells can rely on:

- `data` (the module), `ds` (the generated dataset), `CATALOG`, `SCHEMA` (strings), `spark`
- the current catalog and schema are set, so **use unqualified table names**: `SELECT * FROM fact_orders`
- `data.volume(CATALOG, SCHEMA)` returns a `/Volumes/...` path you may write files to (it creates the volume)
- `ds.land_files(path, parts=3, upto=1, fmt="csv")` writes raw files for ingestion demos; call it again with a
  larger `upto` to simulate new files arriving

The exercises notebook repeats the same setup automatically, so exercises must only depend on the dataset tables
(not on objects created by the lecture cells), or create what they need themselves.

Rules for runnable cells (`run`, `todo`, `solution`):

- They must work on **serverless** compute with Unity Catalog, as a normal user who owns only one schema.
- **Never** `CREATE CATALOG` or `CREATE SCHEMA`, never touch objects you did not create.
- Prefix the objects a module creates with a short module word (`anatomy_orders`, `dv_orders`), and use
  `CREATE OR REPLACE` so cells can be re-run.
- No cluster-only settings (`spark.conf.set` of Delta or shuffle configs), no DBFS paths, no `%sh`, no `%run`.
- Things that need an admin, an external location, a paid endpoint or minutes of start-up time (serving endpoints,
  Vector Search endpoints, pipelines, jobs, Delta Sharing recipients) are **display-only** code. Say so in a callout.
- End the last exercise solution with a commented-out clean-up (`-- DROP TABLE anatomy_orders;`).

### Available datasets

**`retail`** - Retail star schema. 500 customers, 40 products and 60,000 orders (Jan 2025 - Oct 2026). Cheap Books sell far more often than expensive Electronics, and the orders include CANCELLED and TEST rows to filter out.  
Good for: SQL, joins, aggregations, Delta Lake internals, medallion pipelines, metric views, dashboards

- `dim_customer` (500 rows; PK (customer_id)): `customer_id` BIGINT, `customer_name` STRING, `region` STRING, `segment` STRING, `email` STRING, `birth_year` INT, `postal_code` STRING
- `dim_product` (40 rows; PK (product_id)): `product_id` BIGINT, `product_name` STRING, `category` STRING, `unit_price` DOUBLE
- `fact_orders` (60,000 rows; PK (order_id); FK customer_id -> dim_customer.customer_id; FK product_id -> dim_product.product_id): `order_id` BIGINT, `order_date` DATE, `customer_id` BIGINT, `product_id` BIGINT, `quantity` INT, `discount` DOUBLE, `status` STRING

**`iot`** - IoT sensor readings. 12 sites, 200 devices and 50,000 sensor readings over 30 days. Readings follow a daily temperature cycle and include a few duplicates, late arrivals and impossible values for data quality work.  
Good for: Structured Streaming, Auto Loader, watermarks, deduplication, expectations, time-series aggregation

- `sites` (12 rows; PK (site_id)): `site_id` BIGINT, `site_name` STRING, `country` STRING, `latitude` DOUBLE, `longitude` DOUBLE
- `devices` (200 rows; PK (device_id); FK site_id -> sites.site_id): `device_id` BIGINT, `serial_number` STRING, `site_id` BIGINT, `device_type` STRING, `model` STRING, `installed_on` DATE
- `readings` (50,500 rows; PK (reading_id); FK device_id -> devices.device_id): `reading_id` BIGINT, `device_id` BIGINT, `event_ts` TIMESTAMP, `ingest_ts` TIMESTAMP, `temperature` DOUBLE, `humidity` DOUBLE, `battery` DOUBLE, `status` STRING

**`churn`** - Telco churn (machine learning). 5,000 telco subscribers with a churn label that really depends on the features (contract type, support calls, payment failures, tenure), plus 30,000 rows of monthly usage for feature engineering.  
Good for: MLflow tracking, feature tables, train/test splits, hyperparameter tuning, model serving, drift monitoring

- `subscribers` (5,000 rows; PK (subscriber_id)): `subscriber_id` BIGINT, `signup_date` DATE, `plan` STRING, `contract` STRING, `region` STRING, `age` INT, `tenure_months` INT, `monthly_fee` DOUBLE, `support_calls_90d` INT, `payment_failures_6m` INT, `has_app` BOOLEAN, `avg_weekly_minutes` DOUBLE, `churned` INT
- `usage_monthly` (30,000 rows; PK (subscriber_id, month); FK subscriber_id -> subscribers.subscriber_id): `subscriber_id` BIGINT, `month` DATE, `minutes` DOUBLE, `data_gb` DOUBLE, `billed_amount` DOUBLE

**`support`** - Support knowledge base (generative AI). 48 knowledge-base articles and 2,000 support tickets for a fictional smart-home company. Every ticket is about a product and an issue that one article answers, so retrieval can be checked.  
Good for: Chunking, embeddings, Vector Search, RAG, AI Functions (ai_query, ai_classify), agent tools, evaluation sets

- `kb_articles` (48 rows; PK (article_id)): `article_id` BIGINT, `title` STRING, `product` STRING, `topic` STRING, `body` STRING, `updated_on` DATE
- `tickets` (2,000 rows; PK (ticket_id); FK article_id -> kb_articles.article_id): `ticket_id` BIGINT, `customer_id` BIGINT, `product` STRING, `subject` STRING, `body` STRING, `priority` STRING, `created_at` TIMESTAMP, `resolved` BOOLEAN, `article_id` BIGINT

**`hr`** - HR with sensitive columns (governance). 8 departments and 300 employees with synthetic PII (email, national id, salary) and a manager hierarchy. Made for row filters, column masks, dynamic views and privilege exercises.  
Good for: Unity Catalog privileges, row filters, column masks, dynamic views, pseudonymization, self joins

- `departments` (8 rows; PK (department_id)): `department_id` BIGINT, `department_name` STRING, `country` STRING
- `employees` (300 rows; PK (employee_id); FK department_id -> departments.department_id; FK manager_id -> employees.employee_id): `employee_id` BIGINT, `full_name` STRING, `email` STRING, `national_id` STRING, `department_id` BIGINT, `level` STRING, `salary` DOUBLE, `country` STRING, `hired_on` DATE, `manager_id` BIGINT

**`cdc`** - Change data capture feed. A 200-row customer snapshot and 600 change events (INSERT, UPDATE, DELETE) with a sequence number. Some events arrive out of order, so the sequence column matters.  
Good for: MERGE INTO, AUTO CDC (APPLY CHANGES), SCD Type 1 and Type 2, Change Data Feed, deduplication

- `customers_snapshot` (200 rows; PK (customer_id)): `customer_id` BIGINT, `customer_name` STRING, `email` STRING, `city` STRING, `tier` STRING, `updated_at` TIMESTAMP
- `customers_changes` (600 rows; PK (arrival_order)): `arrival_order` BIGINT, `sequence_num` BIGINT, `operation` STRING, `customer_id` BIGINT, `customer_name` STRING, `email` STRING, `city` STRING, `tier` STRING, `changed_at` TIMESTAMP

## Visualizations

````markdown
```viz <type>
{ ...JSON... }
```
````

Text fields accept inline Markdown (`**bold**`, `` `code` ``). Colors: `bronze silver gold red blue teal purple amber
green navy gray pink`. Types with **steps** get Previous / Next / Play controls, and in the slides the right-arrow
key walks through the steps before it moves to the next slide. Use **at least three visualizations per module, of
at least two different types, and make at least one of them stepped.** A good visualization shows the mechanism
(what moves, what changes), not a decorated bullet list.

### `flow`: a pipeline of boxes with moving dots

```json
{"title": "optional", "caption": "optional",
 "nodes": [{"icon": "📥", "title": "Bronze", "sub": "raw, append-only", "color": "bronze", "items": ["optional bullet"]},
           {"icon": "🧹", "title": "Silver", "sub": "clean, conformed", "color": "silver"},
           {"icon": "🏆", "title": "Gold", "sub": "business aggregates", "color": "gold"}],
 "edges": ["label for arrow 1", "label for arrow 2"],
 "steps": [{"label": "Ingest", "focus": [0], "note": "what happens here"},
           {"label": "Clean", "focus": [1], "note": "..."}]}
```

`edges` and `steps` are optional. With steps, the focused nodes are highlighted and the rest are dimmed.
Use at most 5 nodes.

### `files`: a folder that changes step by step (ideal for Delta internals)

```json
{"title": "orders/",
 "steps": [
  {"label": "CREATE TABLE", "note": "...", "add": [{"path": "_delta_log/00000000000000000000.json", "tag": "v0 · metaData"}]},
  {"label": "INSERT", "note": "...", "add": [{"path": "part-00000-a1.snappy.parquet", "tag": "3 rows"},
                                             {"path": "_delta_log/00000000000000000001.json", "tag": "v1 · add"}]},
  {"label": "DELETE", "note": "...", "remove": ["part-00000-a1.snappy.parquet"], "tag": {"part-00000-a1.snappy.parquet": "new tag"}},
  {"label": "VACUUM", "note": "...", "delete": ["part-00000-a1.snappy.parquet"]}
 ]}
```

Per step: `add` (new files), `remove` (file leaves the table but stays on disk: shown as a tombstone), `delete`
(file is physically deleted), `tag` (change the small label of a file). Files under `_delta_log/` are grouped as the
transaction log. Icons follow the extension (`.json`, `.parquet`, `.checkpoint.parquet`, `.crc`, `.bin`, `.csv`).

### `table`: rows that change step by step (DML, MERGE, SCD, deduplication)

```json
{"title": "customers", "columns": ["id", "name", "city"],
 "rows": [[1, "Ann", "Paris"], [2, "Bob", "Rome"]],
 "steps": [
  {"label": "Start", "note": "..."},
  {"label": "UPDATE", "note": "...", "upd": {"1": {"city": "Milan"}}},
  {"label": "INSERT", "note": "...", "add": [[3, "Cy", "Oslo"]]},
  {"label": "DELETE", "note": "...", "del": [0]},
  {"label": "Look here", "note": "...", "hl": [2]}
 ]}
```

Rows are addressed by index (0-based, in the order they were ever added). `upd` changes cells, `add` appends rows,
`del` strikes a row through (it stays visible), `hide` removes it, `hl` highlights rows for that step only.
Use `null` for NULL. Without `steps` it is a static table.

### `code`: walk through a piece of code or a file, a few lines at a time

This one is not JSON. Three parts separated by `---` lines: header, the code, the steps.

````markdown
```viz code
title: _delta_log/00000000000000000001.json
lang: json
---
{"commitInfo": {"operation": "WRITE"}}
{"add": {"path": "part-00000.parquet", "size": 1024}}
---
1 | commitInfo | Who did what.
2 | add | The new file joins the table.
```
````

Each step is `lines | label | note`; lines are `3`, `2-4` or `1,5-6` (1-based). `lang` is any Pygments lexer
(`json`, `sql`, `python`, `yaml`, `text`). Keep it under 14 lines.

### `compare`: two to four cards side by side

```json
{"title": "optional",
 "items": [{"icon": "🏛️", "title": "Data warehouse", "sub": "optional line", "color": "blue",
            "points": ["✅ fast SQL", "❌ expensive for raw data", "neutral point"], "foot": "optional footer"}]}
```

### `timeline`: events on a line, revealed one by one

```json
{"title": "optional",
 "items": [{"label": "v0", "title": "CREATE", "sub": "optional", "color": "navy", "note": "shown while this item is current"}]}
```

Add `"stepped": false` for a static timeline. Use at most 7 items.

### `layers`: a stack (architecture, hierarchy of responsibilities)

```json
{"layers": [{"icon": "🛡️", "title": "Unity Catalog", "sub": "governance", "color": "purple", "items": ["Catalogs", "Lineage"]}]}
```

### `tree`: a hierarchy (namespace, folder, org chart)

```json
{"root": {"icon": "🗄️", "label": "metastore", "sub": "one per region", "color": "navy",
          "children": [{"icon": "📚", "label": "catalog", "color": "blue", "children": []}]}}
```

### `html`: raw HTML for a one-off diagram

Only when no type above fits. No scripts, no external resources, inline styles only.

## Exercises

Two or three per module, each its own `## Exercise N: title` section: a short task, a starter cell, a solution.

````markdown
## Exercise 1: count the commits

Insert two more batches, then predict the next version number before you look.

```sql todo
-- TODO 1: insert orders 1001 to 1500 into anatomy_orders
-- TODO 2: show the table history
```

```sql solution
INSERT INTO anatomy_orders SELECT * FROM fact_orders WHERE order_id BETWEEN 1001 AND 1500;
DESCRIBE HISTORY anatomy_orders;
```
````

Exercises should make the learner predict or explain something, not only retype the lecture.

## quiz.json

Five questions that test understanding, each with 4 options:

```json
[
  {"q": "Question text. Inline `code` is allowed.",
   "o": ["Option A", "Option B", "Option C", "Option D"],
   "c": 1,
   "e": "Why the right answer is right, in one or two sentences."}
]
```

`c` is the 0-based index of the correct option. Vary the position of the correct answer.
