---
title: AI Functions and AI Gateway
summary: Call models from SQL over whole tables with AI Functions and ai_query, and govern every model call with AI Gateway. Build a keyword baseline you can run anywhere, and learn what the gateway checks, logs and limits.
icon: 🚪
level: Beginner
minutes: 10
group: Quality and governance
tags: [AI Functions, ai_query, AI Gateway, Batch inference, Governance]
---
# AI Functions and AI Gateway

> Many GenAI tasks are just a new column: a sentiment, a category, a summary. AI Functions add that column in SQL over millions of rows. AI Gateway sits in front of the model endpoints and decides who may call them, how often, and what gets logged.

**The one idea to remember:** for row-by-row enrichment, use **SQL AI Functions in batch**, not an agent or a Python loop. Every model call goes through a **governed endpoint**, where AI Gateway applies permissions, limits, guardrails and logging.

## 💡 Task-specific AI Functions

These SQL functions call a Databricks-hosted model for you. You pick the task; Databricks picks the model and handles the batching.

| Function | Returns | Typical use |
|---|---|---|
| `ai_classify(text, ARRAY('a','b'))` | One of your labels | Route tickets to a team |
| `ai_extract(text, ARRAY('product','order id'))` | A struct of found entities | Pull fields out of emails |
| `ai_analyze_sentiment(text)` | positive, negative, neutral or mixed | Flag unhappy customers |
| `ai_summarize(text, 20)` · `ai_translate(text, 'de')` · `ai_fix_grammar(text)` | Text | Short summaries, translation, clean-up |
| `ai_mask(text, ARRAY('email','phone'))` · `ai_similarity(a, b)` | Masked text / a score | PII redaction, duplicate detection |
| `ai_gen(prompt)` · `ai_parse_document(content)` | Text / parsed document | Free generation, PDF and image parsing |

They need a workspace where AI Functions are enabled, and every row is billed as model usage.

## 🧱 A table gains columns

```viz table
{"title": "SELECT ..., <AI function> FROM tickets", "columns": ["subject", "sentiment", "category", "summary"],
 "rows": [["My DoorGuard has been offline since yesterday.", "", "", ""], ["Is my LumaBulb still under warranty?", "", "", ""], ["Voice commands for PlugMate stopped working.", "", "", ""]],
 "steps": [{"label": "Input", "note": "Plain ticket rows. Nothing has called a model yet."},
           {"label": "Sentiment", "note": "`ai_analyze_sentiment(body)` adds one label per row. Outputs here are illustrative.", "upd": {"0": {"sentiment": "negative"}, "1": {"sentiment": "neutral"}, "2": {"sentiment": "negative"}}},
           {"label": "Category", "note": "`ai_classify(subject, ARRAY('setup','offline','warranty','voice', ...))` picks from **your** labels, so the column has a closed set of values.", "upd": {"0": {"category": "offline"}, "1": {"category": "warranty"}, "2": {"category": "voice"}}},
           {"label": "Summary", "note": "`ai_summarize(body, 10)` writes text. Free text is harder to check than a label: evaluate a sample.", "upd": {"0": {"summary": "DoorGuard offline for a day."}, "1": {"summary": "Asks about LumaBulb warranty."}, "2": {"summary": "PlugMate voice control broken."}}},
           {"label": "Persist", "note": "Write the result with `CREATE TABLE ... AS SELECT` and run it on new rows only. Re-running a query re-bills every row.", "hl": [0, 1, 2]}]}
```

## 🔧 ai_query: any endpoint, your prompt

`ai_query` is the general function: it sends your prompt to **any** serving endpoint (a foundation model, an external model or your own model) and is built for batch inference. Display only: it needs a model endpoint.

```viz code
title: batch triage of open tickets
lang: sql
---
CREATE OR REPLACE TABLE aifn_ticket_triage AS
SELECT ticket_id,
       ai_query(
         'databricks-meta-llama-3-3-70b-instruct',
         concat('Classify this support ticket. Ticket: ', body),
         responseFormat => '{"type": "json_schema", "json_schema": {"name": "triage", "schema": {"type": "object", "properties": {"topic": {"type": "string", "enum": ["setup", "offline", "firmware", "battery", "warranty", "automation", "voice", "privacy"]}}, "required": ["topic"]}}}',
         modelParameters => named_struct('temperature', 0.0, 'max_tokens', 30),
         failOnError => false
       ) AS r
FROM tickets
WHERE NOT resolved;
---
1 | persist | Store the output. A table is billed once; a view would call the model on every read.
4 | endpoint | The endpoint name. This one is an example: available models change, so check the Serving page.
5 | prompt | Built per row with `concat`. Send only the columns the model needs.
6 | responseFormat | A JSON schema, so every row returns the same keys and only allowed labels.
7 | modelParameters | Temperature 0 for repeatable labels, and a small `max_tokens` to cap cost.
8-9 | failOnError | With `false`, `r` is a struct of `result` and `errorMessage`: one bad row does not fail the whole job.
10-11 | filter first | Only open tickets. Fewer rows, fewer tokens.
```

## ⚖️ Function, ai_query or agent?

```viz compare
{"items": [{"icon": "🧩", "title": "Task-specific function", "sub": "ai_classify, ai_summarize, ...", "color": "green",
            "points": ["✅ one line of SQL, no prompt to write", "✅ no endpoint to choose", "❌ fixed behaviour, few options", "First choice for standard tasks"]},
           {"icon": "🔧", "title": "ai_query", "sub": "batch over a table", "color": "blue",
            "points": ["✅ your prompt, your model, JSON output", "✅ parallel and retried by Databricks", "❌ you own the prompt and its evaluation", "Custom tasks over many rows"]},
           {"icon": "🤖", "title": "Agent", "sub": "serving endpoint", "color": "purple",
            "points": ["✅ multi-step, tools, conversation", "❌ several model calls per request", "❌ heavier to build and evaluate", "Interactive questions, not enrichment"]}]}
```

## 🚪 AI Gateway: what happens to one request

AI Gateway is configured on a **model serving endpoint**, so it applies to every caller: `ai_query`, an agent, an app or a notebook.

```viz flow
{"title": "One request through the gateway",
 "nodes": [{"icon": "🔑", "title": "Permissions and limits", "sub": "CAN QUERY, rate limits", "color": "navy"},
           {"icon": "🛡️", "title": "Input guardrails", "sub": "safety, PII", "color": "amber"},
           {"icon": "🧠", "title": "Served model", "sub": "traffic split, fallback", "color": "purple"},
           {"icon": "🛡️", "title": "Output guardrails", "sub": "safety, PII", "color": "amber"},
           {"icon": "🧾", "title": "Logging", "sub": "inference table, usage", "color": "teal"}],
 "steps": [{"label": "Auth", "focus": [0], "note": "The caller needs `CAN QUERY` on the endpoint. Rate limits per user, group or endpoint stop one job from using all capacity or budget."},
           {"label": "Input check", "focus": [1], "note": "Optional guardrails screen the request, for example blocking unsafe content or detecting PII and blocking or masking it before the model sees it."},
           {"label": "Model", "focus": [2], "note": "The endpoint can split traffic across served models, and for external models fall back to another provider when one fails."},
           {"label": "Output check", "focus": [3], "note": "The same kind of checks can run on the response before it returns."},
           {"label": "Log", "focus": [4], "note": "Request and response payloads land in an **inference table** in Unity Catalog; token usage goes to **system tables**."}]}
```

Guardrails are one layer. Mask PII at the data layer too, and evaluate the app itself.

## 📊 What the gateway records

| Feature | Lands in | Use it for |
|---|---|---|
| **Payload logging** | Inference table: a Delta table in a UC schema you choose | Debugging, quality review, new evaluation rows |
| **Usage tracking** | `system.serving.endpoint_usage` | Tokens and requests per endpoint and requester |
| **Endpoint metadata** | `system.serving.served_entities` | Which model each usage row belongs to |

```sql
-- Display only: needs access to the system.serving schema
SELECT e.endpoint_name, u.requester, sum(u.input_token_count) AS input_tokens,
       sum(u.output_token_count) AS output_tokens, count(*) AS requests
FROM system.serving.endpoint_usage u
JOIN system.serving.served_entities e ON u.served_entity_id = e.served_entity_id
WHERE u.request_time >= current_date() - INTERVAL 7 DAYS
GROUP BY ALL ORDER BY output_tokens DESC;
```

## 🏛️ Models are governed objects

- Models you register live in Unity Catalog as `catalog.schema.model`, with versions, aliases, lineage and privileges such as `EXECUTE`.
- **External models** put a third-party API behind a Databricks endpoint. The provider key stays in Databricks secrets, and callers never see it.
- One endpoint, many callers: rate limits, guardrails and logging are configured once, not in every app.
- Batch jobs and agents use the same endpoints, so usage tables show the full cost picture.

## 🧪 Try it: a keyword baseline

```dataset support
```

Before paying for `ai_classify`, build a baseline: a `CASE` expression on keywords. Resolved tickets link to an article with a `topic`, which is the ground truth.

```sql run
-- Keyword rules: the cheapest possible classifier
CREATE OR REPLACE TABLE aifn_rule_topics AS
SELECT ticket_id, subject, article_id,
       CASE WHEN lower(subject) RLIKE 'alexa|google|voice' THEN 'voice'
            WHEN lower(subject) LIKE '%offline%'           THEN 'offline'
            WHEN lower(subject) LIKE '%firmware%'          THEN 'firmware'
            WHEN lower(subject) LIKE '%batter%'            THEN 'battery'
            WHEN lower(subject) LIKE '%warranty%'          THEN 'warranty'
            WHEN lower(subject) RLIKE 'schedule|automation' THEN 'automation'
            WHEN lower(subject) LIKE '%data%'              THEN 'privacy'
            WHEN lower(subject) RLIKE 'setup|pair'         THEN 'setup'
            ELSE 'other' END AS predicted
FROM tickets;

SELECT predicted, count(*) AS tickets FROM aifn_rule_topics GROUP BY predicted ORDER BY tickets DESC;
```

```sql run
-- Accuracy against the topic of the article that solved the ticket
SELECT count(*)                                         AS labelled,
       round(avg(CASE WHEN r.predicted = a.topic THEN 1 ELSE 0 END), 3) AS accuracy,
       count_if(r.predicted = 'other')                  AS unmatched,
       count_if(r.predicted NOT IN ('other', a.topic))  AS wrong_label
FROM aifn_rule_topics r
JOIN kb_articles a ON r.article_id = a.article_id;
```

```sql run
-- Per topic: where do the rules fail?
SELECT a.topic, count(*) AS tickets,
       round(avg(CASE WHEN r.predicted = a.topic THEN 1 ELSE 0 END), 2) AS accuracy
FROM aifn_rule_topics r
JOIN kb_articles a ON r.article_id = a.article_id
GROUP BY a.topic
ORDER BY accuracy;
```

The rules are about 60% accurate, and every miss is `other`: when a keyword matches, it is right. This is the number an `ai_classify` run must beat to justify its cost.

> The model-based version needs AI Functions enabled in the workspace and is billed per token, so it is display only: `SELECT ticket_id, ai_classify(subject, ARRAY('setup','offline','firmware','battery','warranty','automation','voice','privacy')) AS predicted FROM tickets`. Score it with the same accuracy query.

## Exercise 1: read the misses, fix the rules

List the most common subjects that the rules label `other`, with product names replaced by `{p}` so similar subjects group together. Add keywords for them, then predict the new accuracy before you run it. Is the result a fair estimate for real tickets?

```sql todo
-- TODO 1: SELECT regexp_replace(subject, 'HomeHub|ThermoSense|LumaBulb|DoorGuard|AquaLeak|PlugMate', '{p}'), count(*)
--         for tickets the CASE from the lecture labels 'other'
-- TODO 2: extend the CASE and compute accuracy against kb_articles.topic again
```

```sql solution
WITH rules AS (
  SELECT t.subject, a.topic,
         CASE WHEN lower(t.subject) RLIKE 'alexa|google|voice'                 THEN 'voice'
              WHEN lower(t.subject) RLIKE 'offline|unreachable|disconnect'     THEN 'offline'
              WHEN lower(t.subject) RLIKE 'firmware|orange'                    THEN 'firmware'
              WHEN lower(t.subject) LIKE '%batter%'                            THEN 'battery'
              WHEN lower(t.subject) RLIKE 'warranty|return|replacement'        THEN 'warranty'
              WHEN lower(t.subject) RLIKE 'schedule|automation|trigger'        THEN 'automation'
              WHEN lower(t.subject) RLIKE 'data|recorded|encrypted'            THEN 'privacy'
              WHEN lower(t.subject) RLIKE 'setup|pair|unboxed'                 THEN 'setup'
              ELSE 'other' END AS predicted
  FROM tickets t JOIN kb_articles a ON t.article_id = a.article_id)
SELECT round(avg(CASE WHEN predicted = topic THEN 1 ELSE 0 END), 3) AS accuracy,
       count_if(predicted = 'other') AS unmatched
FROM rules;
-- 100% here, because the synthetic tickets reuse a few phrasings. Real tickets vary far more,
-- so a model is worth testing there. Keep the rules as the baseline to beat.
```

## Exercise 2: send only the hard rows to the model

A common pattern is a cascade: keep the rule label when a keyword matches, and call `ai_classify` only for `other`. With the **original** rules, how many of the 2,000 tickets would reach the model, and what share of model calls do you save? Estimate input tokens with `words × 1.3`.

```sql todo
-- TODO: reuse the original CASE (or aifn_rule_topics from the lecture),
--       count rows labelled 'other', their share, and their estimated input tokens
```

```sql solution
WITH rules AS (
  SELECT subject,
         CASE WHEN lower(subject) RLIKE 'alexa|google|voice|offline|firmware|batter|warranty|schedule|automation|data|setup|pair'
              THEN 'matched' ELSE 'other' END AS route
  FROM tickets)
SELECT count(*)                                                    AS tickets,
       count_if(route = 'other')                                   AS to_model,
       round(1 - count_if(route = 'other') / count(*), 3)          AS calls_saved,
       sum(CASE WHEN route = 'other' THEN ceil(size(split(subject, ' ')) * 1.3) END) AS est_input_tokens
FROM rules;
-- 775 of 2,000 tickets go to the model, so about 61% of the calls are saved.
-- Clean-up:
-- DROP TABLE IF EXISTS aifn_rule_topics;
```

## ⚠️ Common mistakes

- ❌ A Python loop that calls an endpoint row by row. Use `ai_query` or an AI Function in SQL.
- ❌ AI Functions in a view or a recomputed query. Every read re-bills every row; persist results.
- ❌ `failOnError` left at its default on messy input: one bad row fails the job.
- ❌ Treating gateway guardrails as the only defence. Mask at the source and evaluate too.
- ✅ A cheap baseline first, `temperature` 0 and a schema for labels, usage tables for cost.

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Standard task on a column | `ai_classify`, `ai_extract`, `ai_summarize`, `ai_mask`, ... |
| Custom prompt or model over a table | `ai_query(endpoint, prompt, responseFormat => ..., failOnError => false)` |
| Who may call, how often | `CAN QUERY` and gateway rate limits |
| Requests and responses | Inference table in Unity Catalog |
| Token usage and cost | `system.serving.endpoint_usage` |
| Safety and PII on traffic | Gateway guardrails, plus masking at the data layer |
