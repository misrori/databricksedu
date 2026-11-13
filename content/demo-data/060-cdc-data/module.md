---
title: "Change data capture feed"
summary: A 200-row customer snapshot and 600 change events (inserts, updates, deletes), some delivered out of order. Made for MERGE, AUTO CDC and SCD Type 1 and 2.
icon: 🔁
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, CDC, MERGE, SCD]
---
# Change data capture feed

> A source system exported its customer table on 30 September 2026, then streamed every change during October: 111 inserts, 429 updates and 60 deletes.

**The one idea to remember:** apply the changes in `sequence_num` order, not in `arrival_order`. 148 of the 600 events arrive after an event with a higher sequence number.

## 🗺️ The tables

```viz flow
{"nodes": [
  {"icon": "📸", "title": "customers_snapshot", "sub": "200 rows · PK customer_id", "color": "blue", "items": ["customer_name, email, city, tier", "updated_at = 2026-09-30"]},
  {"icon": "🔁", "title": "customers_changes", "sub": "600 rows · PK arrival_order", "color": "amber", "items": ["sequence_num, operation", "the full row after the change", "changed_at"]},
  {"icon": "🎯", "title": "your target table", "sub": "you build it", "color": "green", "items": ["SCD 1: current state", "SCD 2: full history"]}],
 "edges": ["start from", "apply changes"],
 "steps": [
  {"label": "Snapshot", "focus": [0], "note": "The starting state of the customer table."},
  {"label": "Changes", "focus": [1], "note": "Each event carries the whole row after the change. A DELETE carries the last known row."},
  {"label": "Apply", "focus": [0, 1, 2], "note": "MERGE, or AUTO CDC in a pipeline, turns snapshot plus changes into the current table."}]}
```

## ⏱️ Out of order on purpose

```viz table
{"title": "customers_changes (simplified)", "columns": ["arrival_order", "sequence_num", "operation", "tier"],
 "rows": [[10, 10, "UPDATE", "Silver"], [11, 13, "UPDATE", "Gold"], [12, 11, "UPDATE", "Bronze"]],
 "steps": [
  {"label": "Arrival", "note": "Rows are stored in the order they arrived."},
  {"label": "Late row", "note": "Event 11 arrived after event 13. Applied in arrival order, the customer would end up with an old value.", "hl": [2]},
  {"label": "Sequence", "note": "Sort or `SEQUENCE BY sequence_num`, and the newest change wins.", "hl": [1]}]}
```

## 🧪 Try it: create the tables

```dataset cdc
```

```sql run
-- How many events arrived after a newer one?
SELECT count_if(sequence_num < prev_max) AS late_events, count(*) AS events
FROM (
  SELECT sequence_num,
         max(sequence_num) OVER (ORDER BY arrival_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max
  FROM customers_changes
);
```

```sql run
-- The latest change per customer (what an SCD Type 1 MERGE needs)
SELECT * FROM customers_changes
QUALIFY row_number() OVER (PARTITION BY customer_id ORDER BY sequence_num DESC) = 1
ORDER BY customer_id
LIMIT 10;
```

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Order of truth | `sequence_num` |
| Operation | `operation`: INSERT, UPDATE, DELETE |
| Latest per key | `QUALIFY row_number() ... = 1` |
| Pipelines | `AUTO CDC ... SEQUENCE BY sequence_num` |
| Snapshot time | `customers_snapshot.updated_at` |
