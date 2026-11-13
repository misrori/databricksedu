---
title: "Recap: Databricks Data Privacy"
summary: Recap of course 2 of Advanced Data Engineering with Databricks. Control who sees which rows and columns, de-identify PII early in the medallion flow, and delete personal data so it is really gone.
icon: 🔒
level: Advanced
minutes: 9
group: Advanced Data Engineering with Databricks
tags: [Data privacy, Row filters, Column masks, ABAC, GDPR, VACUUM]
---
# Recap: Databricks Data Privacy

> Course 2 of 4. Protecting personal data across the lakehouse: **who can see what**, how to **de-identify** PII, and how to **really delete** data when a person asks for it.

**The one idea to remember:** put privacy into the **platform**, not into every job. Use Unity Catalog permissions, **row filters and column masks** (ideally driven by **tags**), de-identify early in the medallion flow, and design deletes that also remove old file versions.

## 🗺️ What we covered

| Topic | Key takeaway |
|---|---|
| Governance and regulations | GDPR / CCPA principles: minimization, purpose limitation, the right to be forgotten |
| Securing data in Unity Catalog | Least-privilege grants, groups, service principals, audit logs |
| Fine-grained access | **Dynamic views**, **row filters**, **column masks**, ABAC with **governed tags** |
| De-identification | **Pseudonymization** (hashing, tokenization) vs **anonymization** (generalization, suppression) |
| PII detection | **Data classification** finds PII columns and tags them automatically |
| Deleting data | `DELETE` / `MERGE`, **change data feed** for propagation, `REORG ... PURGE`, **`VACUUM`** |

## 🔐 Least privilege in Unity Catalog

```sql
GRANT USE CATALOG ON CATALOG prod TO `analysts`;
GRANT USE SCHEMA, SELECT ON SCHEMA prod.gold TO `analysts`;      -- gold only, no raw PII
REVOKE ALL PRIVILEGES ON SCHEMA prod.bronze FROM `analysts`;
SHOW GRANTS ON SCHEMA prod.gold;
```

- Reading a table needs **all three**: `USE CATALOG`, `USE SCHEMA` and `SELECT`.
- Grant to **groups**, run production as **service principals**, and keep raw PII in a **restricted** bronze schema.
- Unity Catalog privileges are **allow-only** (there is no `DENY`), so restrict by granting narrowly.
- **Audit:** `system.access.audit` and **lineage** show who read PII and where it flowed.

## 🎭 Row filters and column masks

```sql
-- Column mask: only pii_readers see the full email
CREATE FUNCTION prod.sec.mask_email(email STRING)
RETURN CASE WHEN is_account_group_member('pii_readers') THEN email
            ELSE regexp_replace(email, '^[^@]+', '***') END;
ALTER TABLE prod.silver.customers ALTER COLUMN email SET MASK prod.sec.mask_email;

-- Row filter: EU analysts see EU rows only
CREATE FUNCTION prod.sec.eu_only(region STRING)
RETURN is_account_group_member('admins') OR region = 'EU';
ALTER TABLE prod.silver.customers SET ROW FILTER prod.sec.eu_only ON (region);
```

## 👀 Same table, different users

The functions run on every query, for every reader. Step through what different people get from `SELECT * FROM prod.silver.customers`.

```viz table
{"title": "prod.silver.customers",
 "columns": ["customer_id", "email", "region"],
 "rows": [[1, "ann@shop.com", "EU"], [2, "bob@shop.com", "US"], [3, "cy@shop.com", "EU"]],
 "steps": [
  {"label": "Admin in pii_readers", "note": "`is_account_group_member` is true for both rules: every row, full emails."},
  {"label": "Analyst: column mask", "note": "Not in `pii_readers`, so `mask_email` returns the masked value. The stored data is unchanged.", "upd": {"0": {"email": "***@shop.com"}, "1": {"email": "***@shop.com"}, "2": {"email": "***@shop.com"}}},
  {"label": "Analyst: row filter", "note": "Not in `admins`, so `eu_only` keeps only rows where `region = 'EU'`. The US row is not returned at all.", "hide": [1]}
 ]}
```

## 🧰 Three ways to control access

| Technique | How | Best for |
|---|---|---|
| **Dynamic view** | A view with `CASE WHEN is_account_group_member(...)` | Classic approach. Users must query the **view**, not the table |
| **Row filter / column mask** | A function attached **to the table** | The policy travels with the table: batch, streaming, MVs |
| **ABAC policy + governed tags** | One policy on a catalog or schema for every column tagged e.g. `pii = email` | Scale: new tables are protected **without code changes** |

## 🏷️ ABAC: one policy for every tagged column

```sql
ALTER TABLE prod.silver.customers ALTER COLUMN email SET TAGS ('pii' = 'email');

CREATE POLICY mask_pii_email ON CATALOG prod
COLUMN MASK prod.sec.mask_email
TO `account users` EXCEPT `pii_readers`
FOR TABLES MATCH COLUMNS has_tag_value('pii', 'email') AS c ON COLUMN c;
```

The policy is defined once, on the catalog. Any column in any table of `prod` that carries the tag `pii = email` is masked, including tables created next week.

## 🧪 De-identification methods

| Method (result) | Example | Reversible? | Still joinable? |
|---|---|---|---|
| **Hashing**, salted or keyed (pseudonymized) | `sha2(concat(email, secret('pii','salt')), 256)` | No | **Yes** |
| **Tokenization** (pseudonymized) | Random token, mapping kept in a locked **vault table** | **Yes**, with vault access | Yes |
| **Generalization** (anonymized) | Age to `30-39`, ZIP to first 3 digits, date to month | No | Partly |
| **Suppression** (anonymized) | Drop or NULL the column | No | No |
| **Masking** (access control) | `***-**-1234` at query time | Original still stored | Not applicable |
| Text masking (PII in free text) | `ai_mask(comment, ARRAY('email', 'phone'))` | No | Not applicable |

## 🌫️ Pseudonymized or anonymized?

```viz table
{"title": "One customer row, de-identified step by step",
 "columns": ["email", "birth_year", "postal_code", "status"],
 "rows": [["ann@shop.com", 1987, "10115", "personal data"]],
 "steps": [
  {"label": "Raw", "note": "Direct identifier plus quasi-identifiers. Lives in a restricted bronze schema."},
  {"label": "Salted hash", "note": "Still joinable and countable, but **pseudonymized** data is still **personal data** under GDPR: re-identification is possible.", "upd": {"0": {"email": "9f2c…e1 (sha2 + salt)", "status": "pseudonymized"}}},
  {"label": "Generalize", "note": "Birth year to a decade, postal code to an area. This makes many people look alike.", "upd": {"0": {"birth_year": "1980s", "postal_code": "10***"}}},
  {"label": "Suppress", "note": "Drop the identifier. If nobody can be re-identified, the data is **anonymized** and no longer personal data. Think **k-anonymity**: every combination of attributes should match at least *k* people.", "upd": {"0": {"email": null, "status": "anonymized"}}}
 ]}
```

> Keep salts and keys in **secrets**. A plain `sha2(email)` is guessable.

## 🥇 A privacy-aware medallion flow

```viz flow
{"nodes": [
  {"icon": "📥", "title": "Landing", "sub": "raw files", "color": "gray"},
  {"icon": "🥉", "title": "Bronze", "sub": "raw data incl. PII", "color": "bronze", "items": ["restricted schema", "very few principals"]},
  {"icon": "🥈", "title": "Silver", "sub": "hashed / tokenized IDs", "color": "silver", "items": ["PII columns tagged", "masks via ABAC"]},
  {"icon": "🥇", "title": "Gold", "sub": "aggregated / generalized", "color": "gold", "items": ["no direct identifiers", "broad access"]}
 ],
 "edges": ["ingest", "de-identify", "aggregate"],
 "steps": [
  {"label": "Classify", "focus": [1], "note": "**Data classification** scans tables, detects PII (emails, phone numbers, IBANs, names) and applies **governed tags** automatically."},
  {"label": "Tag and mask", "focus": [2], "note": "**Tags + ABAC** mask everything tagged, including columns added later."},
  {"label": "De-identify", "focus": [1, 2], "note": "De-identify in the **bronze to silver** step, for example with pipeline code or a UDF."},
  {"label": "Guard", "focus": [2, 3], "note": "Put **expectations** on silver, so the pipeline fails if PII-looking values appear where they should not."}
 ]}
```

## 🗑️ The right to be forgotten

```sql
-- 1) delete everyone in the request table, starting at bronze
MERGE INTO prod.bronze.customers t
USING (SELECT customer_id FROM prod.ops.gdpr_requests WHERE status = 'pending') r
ON t.customer_id = r.customer_id
WHEN MATCHED THEN DELETE;

-- 2) propagate to silver/gold: DELETE / MERGE, or apply deletes read from the change data feed
-- 3) deletion vectors only *mark* rows -> rewrite the files
REORG TABLE prod.bronze.customers APPLY (PURGE);
-- 4) remove old file versions after the retention period (default 7 days)
VACUUM prod.bronze.customers;
```

## 💽 What happens on disk

```viz files
{"title": "prod.bronze.customers/",
 "steps": [
  {"label": "Before", "note": "Customer 42 lives in one data file.",
   "add": [{"path": "part-00000-a1.snappy.parquet", "tag": "includes customer 42"}, {"path": "_delta_log/00000000000000000004.json", "tag": "v4"}]},
  {"label": "MERGE ... DELETE", "note": "With deletion vectors the file is not rewritten. A small `.bin` file **marks** the row as deleted. Until `VACUUM`, the row is still readable with **time travel** (`VERSION AS OF 4`).",
   "add": [{"path": "deletion_vector_7f.bin", "tag": "marks customer 42"}, {"path": "_delta_log/00000000000000000005.json", "tag": "v5 · DELETE"}]},
  {"label": "REORG ... APPLY (PURGE)", "note": "The file is rewritten without the row. The old file and its deletion vector leave the table, but stay on disk.",
   "add": [{"path": "part-00000-b2.snappy.parquet", "tag": "without customer 42"}, {"path": "_delta_log/00000000000000000006.json", "tag": "v6 · REORG"}],
   "remove": ["part-00000-a1.snappy.parquet", "deletion_vector_7f.bin"]},
  {"label": "VACUUM (after retention)", "note": "Files no longer referenced and older than the retention period (default 7 days) are deleted. Now the data is really gone.",
   "delete": ["part-00000-a1.snappy.parquet", "deletion_vector_7f.bin"]}
 ]}
```

- **Downstream streaming tables** fail on deletes in their source. Use `skipChangeCommits` plus DML on the target, or the **change data feed**.
- **Upstream copies** (landing files, Kafka, source systems) must be deleted too, or the data comes back on reprocessing.
- **Design for deletion:** keep PII in a separate table keyed by a surrogate ID, so an erasure touches only one small table.
- **Retention rules:** e.g. auto TTL (`DELETE ROWS 365 DAYS AFTER event_ts`) on managed tables with predictive optimization.

## 🧪 Try it: de-identify, mask, filter

```dataset retail
```

The **retail** customers include a fake `email`, `birth_year` and `postal_code`. Work on your own copy, `priv_customers`, so the dataset table stays untouched.

```python run
# Your own copy, then pseudonymize + generalize: hash the email, bucket the birth year, truncate the postal code
FN = f"`{CATALOG}`.`{SCHEMA}`"
spark.sql("CREATE OR REPLACE TABLE priv_customers AS SELECT * FROM dim_customer")
display(spark.sql("""
SELECT customer_id,
       sha2(concat(email, 'demo-salt-keep-real-ones-in-secrets'), 256) AS email_hash,    -- pseudonymized, joinable
       concat(CAST(floor(birth_year / 10) * 10 AS STRING), 's')       AS birth_decade,  -- generalized
       concat(left(postal_code, 2), '**')                             AS postal_area,   -- generalized
       region, segment
FROM priv_customers
LIMIT 10
"""))
```

```python run
# Column mask: only members of 'pii_readers' see full emails
spark.sql(f"""
CREATE OR REPLACE FUNCTION {FN}.priv_mask_email(email STRING)
RETURN CASE WHEN is_account_group_member('pii_readers') THEN email
            ELSE regexp_replace(email, '^[^@]+', '***') END
""")
spark.sql(f"ALTER TABLE priv_customers ALTER COLUMN email SET MASK {FN}.priv_mask_email")
display(spark.sql("SELECT customer_id, email, region FROM priv_customers LIMIT 5"))
```

```python run
# Row filter: non-admins see EMEA customers only
spark.sql(f"""
CREATE OR REPLACE FUNCTION {FN}.priv_emea_only(region STRING)
RETURN is_account_group_member('admins') OR region = 'EMEA'
""")
spark.sql(f"ALTER TABLE priv_customers SET ROW FILTER {FN}.priv_emea_only ON (region)")
display(spark.sql("SELECT region, count(*) AS customers FROM priv_customers GROUP BY ALL"))
```

## 🔬 Try it: forget a customer

```python run
# Remove the policies again
spark.sql("ALTER TABLE priv_customers DROP ROW FILTER")
spark.sql("ALTER TABLE priv_customers ALTER COLUMN email DROP MASK")
```

```python run
# Right to be forgotten: after DELETE, time travel still shows the row
spark.sql("DELETE FROM priv_customers WHERE customer_id = 42")
before = spark.sql("DESCRIBE HISTORY priv_customers").filter("operation = 'DELETE'").first()["version"] - 1
display(spark.sql(f"SELECT customer_id, email FROM priv_customers VERSION AS OF {before} WHERE customer_id = 42"))
```

```python run
# Physically remove it: purge deletion vectors, then VACUUM (removes files older than the retention, default 7 days)
display(spark.sql("REORG TABLE priv_customers APPLY (PURGE)"))
display(spark.sql("VACUUM priv_customers"))

# Clean up when you are done
# spark.sql("DROP TABLE IF EXISTS priv_customers")
# spark.sql(f"DROP FUNCTION IF EXISTS {FN}.priv_mask_email"); spark.sql(f"DROP FUNCTION IF EXISTS {FN}.priv_emea_only")
```

## ⚠️ Common mistakes

- ❌ Calling unsalted `sha2(email)` "anonymization". It is guessable pseudonymization.
- ❌ Running `DELETE` only. Old versions remain via time travel until `VACUUM`, and deletion vectors need `REORG ... PURGE` first.
- ❌ Forgetting downstream streaming tables and upstream raw files.
- ❌ Copy-pasting masking logic into every job instead of attaching **policies** to tables and tags.
- ❌ Granting `ALL PRIVILEGES` to make access "just work".

## 🧭 Cheat sheet

| Requirement | Choose |
|---|---|
| Analysts may count unique customers but not see emails | **Salted hashing** |
| Support must re-identify a customer in rare cases | **Tokenization** + vault table |
| Public / partner dataset | **Generalization + suppression** (anonymization) |
| Different people see different detail on the same table | **Column mask** / row filter |
| Hundreds of tables with PII, new ones added weekly | **Data classification + governed tags + ABAC** |
| Customer asks to be forgotten | `DELETE`/`MERGE` in every layer, then `REORG ... PURGE`, then `VACUUM`. **Change data feed** propagates deletes from silver to gold |

**Next course:** *Databricks Performance Optimization*.
