---
title: "Telco churn"
summary: 5,000 subscribers with a churn label that really depends on the features, plus six months of usage per subscriber. Made for MLflow, feature tables and model demos.
icon: 📉
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, Machine learning, Classification, Features]
---
# Telco churn

> A mobile operator wants to know which subscribers will leave. 5,000 subscribers, about 27% of them churned, and 30,000 rows of monthly usage from May to October 2026.

**The one idea to remember:** the label is not random. It is generated from the features, so a model can learn it and feature importance tells a true story.

## 🗺️ The tables and how they join

```viz flow
{"nodes": [
  {"icon": "📱", "title": "subscribers", "sub": "5,000 rows · PK subscriber_id", "color": "purple", "items": ["plan, contract, region, age", "tenure, support calls, payment failures", "churned (0 or 1): the label"]},
  {"icon": "📊", "title": "usage_monthly", "sub": "30,000 rows · PK (subscriber_id, month)", "color": "teal", "items": ["minutes, data_gb, billed_amount", "6 months per subscriber"]}],
 "edges": ["subscriber_id"],
 "steps": [
  {"label": "Label", "focus": [0], "note": "One row per subscriber with ready-made features and the `churned` label."},
  {"label": "Usage", "focus": [0, 1], "note": "A composite primary key `(subscriber_id, month)`. Aggregate it into features such as the usage trend."}]}
```

## 🧠 What drives churn

These are the real effects inside the generator. A good model should find them.

```viz compare
{"items": [
  {"icon": "📈", "title": "Raises churn", "color": "red", "points": ["Monthly contract", "More support calls in 90 days", "More payment failures in 6 months", "Basic plan (slightly)"]},
  {"icon": "📉", "title": "Lowers churn", "color": "green", "points": ["One or two year contract", "Long tenure", "Uses the app", "More weekly minutes"]},
  {"icon": "➖", "title": "No effect", "color": "gray", "points": ["region", "age"], "foot": "Good for showing that not every column matters."}]}
```

Churned subscribers also use less every month (`usage_monthly.minutes` trends down), so a "usage trend" feature from the second table is useful.

## 🧪 Try it: create the tables

```dataset churn
```

```sql run
-- Churn rate by contract type
SELECT contract,
       count(*) AS subscribers,
       round(avg(churned) * 100, 1) AS churn_pct
FROM subscribers
GROUP BY contract
ORDER BY churn_pct DESC;
```

```sql run
-- A usage-trend feature: last month vs first month
SELECT subscriber_id,
       round(max_by(minutes, month) / nullif(min_by(minutes, month), 0), 2) AS minutes_ratio
FROM usage_monthly
GROUP BY subscriber_id
ORDER BY minutes_ratio
LIMIT 10;
```

## 🐍 Train straight from pandas

```python
from databricksedu import data

ds = data.generate("churn", seed=42)
df = ds.to_pandas("subscribers")
X = df.drop(columns=["subscriber_id", "signup_date", "churned"])
y = df["churned"]
# one-hot encode plan, contract, region, then train any classifier
```

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Label | `subscribers.churned` (1 = left) |
| Base rate | about 27% churned |
| Join usage | `USING (subscriber_id)` |
| Usage key | `(subscriber_id, month)` |
| Drift demo | compare `scale` or `seed` variants |
