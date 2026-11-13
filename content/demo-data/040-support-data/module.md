---
title: "Support knowledge base"
summary: 48 help-center articles and 2,000 support tickets for a fictional smart-home company. Each resolved ticket points to the article that answers it, so retrieval can be measured.
icon: 💬
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, Generative AI, RAG, Text]
---
# Support knowledge base

> Casa is a fictional smart-home company with six products (HomeHub, ThermoSense, LumaBulb, DoorGuard, AquaLeak, PlugMate). Its help center has 48 articles and its support queue has 2,000 tickets.

**The one idea to remember:** `tickets.article_id` is the ground truth. When a retriever returns that article for a ticket, it found the right answer.

## 🗺️ The tables and how they join

```viz flow
{"nodes": [
  {"icon": "📚", "title": "kb_articles", "sub": "48 rows · PK article_id", "color": "blue", "items": ["title, product, topic", "body: the answer text", "6 products × 8 topics"]},
  {"icon": "🎫", "title": "tickets", "sub": "2,000 rows · PK ticket_id", "color": "pink", "items": ["product, subject, body", "priority, created_at, resolved", "article_id: the answer"]}],
 "edges": ["article_id"],
 "steps": [
  {"label": "Articles", "focus": [0], "note": "One article per product and topic: setup, offline, firmware, battery, warranty, automation, voice, privacy."},
  {"label": "Tickets", "focus": [0, 1], "note": "Customers write in their own words. `article_id` references the article that resolves the ticket. It is NULL on unresolved tickets."}]}
```

## 🔎 From ticket to answer

```viz table
{"title": "one ticket, one article", "columns": ["", "text"],
 "rows": [["ticket", "I just unboxed my AquaLeak and the app cannot find it."],
          ["article", "AquaLeak: First-time setup"],
          ["answer", "Setup needs a 2.4 GHz Wi-Fi network; 5 GHz-only networks are not supported."]],
 "steps": [
  {"label": "Question", "note": "The ticket never uses the article's words. Keyword search struggles, embeddings do better.", "hl": [0]},
  {"label": "Retrieve", "note": "A retriever should return the setup article for this product.", "hl": [1]},
  {"label": "Generate", "note": "The model answers from the retrieved text, and can cite it.", "hl": [2]}]}
```

## 🧪 Try it: create the tables

```dataset support
```

```sql run
-- Tickets per product and topic, through the answer article
SELECT a.product, a.topic, count(*) AS tickets
FROM tickets t
JOIN kb_articles a ON t.article_id = a.article_id
GROUP BY a.product, a.topic
ORDER BY tickets DESC
LIMIT 10;
```

```sql run
-- An evaluation set: question plus the expected article
SELECT t.ticket_id, t.body AS question, a.article_id AS expected_article, a.title
FROM tickets t
JOIN kb_articles a ON t.article_id = a.article_id
LIMIT 20;
```

## 🐍 Use it from Python

```python
from databricksedu import data

ds = data.generate("support", seed=42)
docs = ds.to_pandas("kb_articles")        # chunk and embed docs["body"]
evals = ds.to_pandas("tickets").dropna(subset=["article_id"])   # questions with a known answer
```

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Documents to index | `kb_articles.body` |
| Questions | `tickets.body` or `subject` |
| Ground truth | `tickets.article_id` |
| Only answered tickets | `WHERE article_id IS NOT NULL` |
| Classify with AI | `ai_classify(body, ARRAY('setup', 'offline', ...))` |
