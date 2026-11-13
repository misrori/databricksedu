---
title: Evaluating GenAI apps
summary: Replace "it looks good" with numbers. Build a labelled evaluation set, measure retrieval with precision@k, recall@k and MRR, judge answers with MLflow scorers, and keep watching quality, cost and latency in production.
icon: 📏
level: Intermediate
minutes: 12
group: Quality and governance
tags: [Evaluation, MLflow, LLM judges, Retrieval metrics, Monitoring]
---
# Evaluating GenAI apps

> Reading five answers and liking them is not evaluation. An evaluation is a fixed set of labelled questions, scored the same way for every version of your app, so you can tell whether a change made things better.

**The one idea to remember:** measure **retrieval** and **generation** separately, on the **same** labelled set, for every version. Then you know which step broke and whether a fix really helped.

## 🎯 Offline and online evaluation

An **evaluation set** is a list of inputs with expectations: the facts a correct answer must contain, or the documents that should be retrieved. You build it from real questions, expert labels and production failures.

| | Offline evaluation | Online monitoring |
|---|---|---|
| **Data** | Curated evaluation set with expectations | Live traces from real users, usually no ground truth |
| **When** | Before you ship a version | After deployment, continuously |
| **Answers** | Is version B better than A? | Is quality, cost or latency drifting? |
| **Tools** | `mlflow.genai.evaluate()`, review app | Scorers on sampled traces, inference tables, usage tables |

Each one feeds the other: bad production cases become new evaluation rows.

## 📏 Retrieval metrics

For each question you know the relevant documents. The retriever returns a ranked list, and you score the top **k**.

- **precision@k**: share of the top k that are relevant.
- **recall@k**: share of all relevant documents found in the top k.
- **MRR** (mean reciprocal rank): the average of 1 / rank of the first relevant hit, 0 when it is missing.

```viz table
{"title": "Scoring a retriever, k = 3 (one relevant article per ticket)", "columns": ["ticket subject", "expected", "top 3 retrieved", "P@3 · R@3 · RR"],
 "rows": [["My HomeHub has been offline since yesterday.", 2, "", ""], ["How do I pair PlugMate with the Casa app?", 41, "", ""], ["Is my DoorGuard still under warranty?", 29, "", ""], ["Can LumaBulb trigger another device?", 22, "", ""]],
 "steps": [{"label": "The set", "note": "Four labelled questions. The ticket's `article_id` is the ground truth."},
           {"label": "Row 1", "note": "Correct article at rank 1: precision 1/3, recall 1, reciprocal rank 1.", "upd": {"0": {"top 3 retrieved": "**2**, 10, 3", "P@3 · R@3 · RR": "0.33 · 1 · 1"}}, "hl": [0]},
           {"label": "Row 2", "note": "Found at rank 3: still recall 1, but reciprocal rank only 1/3.", "upd": {"1": {"top 3 retrieved": "47, 45, **41**", "P@3 · R@3 · RR": "0.33 · 1 · 0.33"}}, "hl": [1]},
           {"label": "Row 3", "note": "Rank 2: reciprocal rank 0.5.", "upd": {"2": {"top 3 retrieved": "30, **29**, 5", "P@3 · R@3 · RR": "0.33 · 1 · 0.5"}}, "hl": [2]},
           {"label": "Row 4", "note": "A miss: the right article is not in the top 3, so every metric is 0. Look at misses one by one; they explain the averages.", "upd": {"3": {"top 3 retrieved": "17, 19, 21", "P@3 · R@3 · RR": "0 · 0 · 0"}}, "hl": [3]},
           {"label": "Aggregate", "note": "Averages over the set. With **one** relevant document per question, precision@3 can never exceed 0.33, so watch recall and MRR here.", "add": [["**mean of 4**", "", "", "0.25 · 0.75 · 0.46"]], "hl": [4]}]}
```

## 🧑‍⚖️ Generation metrics and LLM judges

Answers are free text, so exact match is useless. An **LLM judge** is a model with a fixed rubric that returns a verdict and a rationale. MLflow ships built-in judges as **scorers**:

| Scorer | Checks | Needs expectations? |
|---|---|---|
| `Correctness` | Answer contains the expected facts | Yes |
| `RelevanceToQuery` | Answer addresses the question | No |
| `RetrievalGroundedness` | Answer is supported by the retrieved context | No |
| `RetrievalRelevance` | Retrieved chunks are relevant to the question | No |
| `RetrievalSufficiency` | Context holds the facts the answer needs | Yes |
| `Safety` | No harmful or toxic content | No |

`Guidelines` scorers check your own rules in plain language ("answer in under 80 words, cite an article"). Scorers that need no expectations can also run on production traffic.

## ⚖️ Code checks, judges and humans

```viz compare
{"items": [{"icon": "🧮", "title": "Code-based scorers", "sub": "deterministic functions", "color": "blue",
            "points": ["✅ free, fast, repeatable", "✅ retrieval metrics, JSON validity, length, citations, latency", "❌ cannot judge meaning or tone"]},
           {"icon": "🧑‍⚖️", "title": "LLM judges", "sub": "built-in or custom", "color": "purple",
            "points": ["✅ score meaning at scale", "✅ give a rationale per row", "❌ cost tokens and can be wrong", "Align them with expert labels"]},
           {"icon": "👩‍🔬", "title": "Human review", "sub": "subject-matter experts", "color": "teal",
            "points": ["✅ the reference for quality", "✅ review app and labeling sessions", "❌ slow and expensive", "Needs a clear rubric so raters agree"]}]}
```

Use all three. Code where a rule exists, judges for meaning, experts to build the labels and to check the judges.

## 🔬 One evaluate call

This is display only: it calls your app and judge models on serving endpoints.

```viz code
title: evaluate a support bot with MLflow 3
lang: python
---
import mlflow
from mlflow.genai.scorers import Correctness, RetrievalGroundedness, Guidelines, scorer

eval_data = [{"inputs": {"question": "How long is the DoorGuard warranty?"},
              "expectations": {"expected_facts": ["24 months", "manufacturing defects"]}}]

@scorer
def cites_article(outputs) -> bool:
    return "article" in outputs["answer"].lower()

results = mlflow.genai.evaluate(
    data=eval_data, predict_fn=lambda question: support_bot(question),
    scorers=[Correctness(), RetrievalGroundedness(), cites_article,
             Guidelines(name="short", guidelines="The answer has at most 80 words.")])
---
4-5 | evaluation set | `inputs` are passed to your app. `expectations` hold ground truth, here the facts a correct answer must state.
7-9 | code scorer | A plain function decorated with `@scorer`. It returns a bool, a number or feedback.
11-12 | predict_fn | MLflow calls your app once per row with the keys of `inputs` as arguments, and records a **trace** of each call.
13-14 | scorers | Built-in judges, a custom code check and a natural-language guideline. Each row gets one feedback per scorer, and the run stores the averages.
```

## 🔄 From traces to a decision

```viz flow
{"title": "The evaluation loop",
 "nodes": [{"icon": "🤖", "title": "App version", "sub": "prompt v3, k = 5", "color": "blue"},
           {"icon": "🧵", "title": "Traces", "sub": "inputs, chunks, output, tokens, latency", "color": "teal"},
           {"icon": "🧑‍⚖️", "title": "Scorers", "sub": "code, judges, guidelines", "color": "purple"},
           {"icon": "📊", "title": "Metrics", "sub": "per row and per run", "color": "amber"},
           {"icon": "🏁", "title": "Compare", "sub": "ship, fix, or roll back", "color": "green"}],
 "steps": [{"label": "Run", "focus": [0, 1], "note": "Each evaluation row produces a trace: every retrieval, model call and tool call is a span with its inputs, outputs, tokens and time."},
           {"label": "Score", "focus": [2], "note": "Scorers read the trace. Retrieval scorers look at the retrieved chunks, answer scorers at the output."},
           {"label": "Aggregate", "focus": [3], "note": "Per-row feedback rolls up to run metrics. Add latency and token cost: a correct answer that takes 20 seconds may still fail the requirement."},
           {"label": "Compare", "focus": [4], "note": "Compare versions on the **same** set with the **same** scorers. Prefer the version that is good on every required metric, not the best average."},
           {"label": "Monitor", "focus": [1, 2], "note": "In production the same scorers (those without expectations) run on a sample of live traces. Failures become new evaluation rows."}]}
```

**Retrieval or generation?** If the right document was not retrieved, fix chunking, the index or the query. If it was retrieved and the answer is still wrong or ungrounded, fix the prompt or the model.

## 🧪 Try it: score a retriever

```dataset support
```

Resolved tickets are a free labelled set: `article_id` is the article that answered the ticket. The retriever is TF-IDF with cosine similarity, a stand-in for an embedding index.

```python run
# The labelled evaluation set and a retriever that returns the top 5 article ids per question
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer

kb = spark.sql("SELECT article_id, title, body, topic FROM kb_articles ORDER BY article_id").toPandas()
evalset = spark.sql("""SELECT ticket_id, subject, article_id AS expected
                       FROM tickets WHERE resolved ORDER BY ticket_id""").toPandas()

def retrieve(doc_texts, queries, k=5):
    vec = TfidfVectorizer(stop_words="english")
    docs = vec.fit_transform(doc_texts)
    scores = (vec.transform(queries) @ docs.T).toarray()    # rows are L2-normalized: this is cosine similarity
    top = np.argsort(-scores, axis=1, kind="stable")[:, :k]
    return [[int(kb.article_id.iloc[j]) for j in row] for row in top]

evalset["retrieved"] = retrieve(kb.title + " " + kb.body, evalset.subject)
print(len(evalset), "labelled questions")
evalset.head()
```

```python run
# precision@k, recall@k and MRR@k
def score(retrieved, expected, k):
    p, r, rr = [], [], []
    for ids, gold in zip(retrieved, expected):
        top = ids[:k]
        hits = [i == gold for i in top]
        p.append(sum(hits) / k)
        r.append(sum(hits) / 1)                                # one relevant article per ticket
        rr.append(1 / (top.index(gold) + 1) if gold in top else 0.0)
    return {"precision": round(float(np.mean(p)), 3), "recall": round(float(np.mean(r)), 3), "mrr": round(float(np.mean(rr)), 3)}

for k in (1, 3, 5):
    print(f"k={k}", score(evalset.retrieved, evalset.expected, k))
```

## 🧪 Try it: compare two retrievers

Same set, same metrics, one change: index only the titles, or titles plus bodies. Predict the winner before you run it.

```python run
# Variant A vs variant B on the same evaluation set
variants = {"title only": kb.title, "title + body": kb.title + " " + kb.body}
rows = []
for name, texts in variants.items():
    retrieved = retrieve(texts, evalset.subject)
    for k in (1, 3):
        rows.append({"variant": name, "k": k, **score(retrieved, evalset.expected, k)})
pd.DataFrame(rows)
```

```python run
# Do not stop at the average: read the misses
title = dict(zip(kb.article_id, kb.title))
misses = evalset[[e not in r[:3] for r, e in zip(evalset.retrieved, evalset.expected)]]
print(f"{len(misses)} misses at k=3")
misses.assign(expected_title=misses.expected.map(title),
              got_title=misses.retrieved.map(lambda r: title[r[0]]))[["subject", "expected_title", "got_title"]].head(10)
```

Titles share few words with real questions. Often only the product name matches, which ties all eight articles of that product. Bodies add the words customers actually use.

## Exercise 1: metrics by hand

Three questions, each with exactly one relevant document. Compute precision@3, recall@3 and MRR in your head, then check with code. What is the highest precision@3 any retriever could reach on this set?

```python todo
rankings = [["d7", "d2", "d9"], ["d4", "d1", "d3"], ["d5", "d8", "d6"]]
relevant = ["d2", "d4", "d1"]
# TODO: compute mean precision@3, recall@3 and MRR without libraries
```

```python solution
p = [sum(d == g for d in r[:3]) / 3 for r, g in zip(rankings, relevant)]
rec = [float(g in r[:3]) for r, g in zip(rankings, relevant)]
rr = [1 / (r.index(g) + 1) if g in r[:3] else 0.0 for r, g in zip(rankings, relevant)]
print(sum(p) / 3, sum(rec) / 3, sum(rr) / 3)
# 0.222, 0.667, 0.5 (ranks 2, 1 and a miss). The best possible precision@3 is 1/3,
# because each question has only one relevant document.
```

## Exercise 2: find the weak slice

An average hides weak spots. Compute top-1 accuracy (recall@1) of the title + body retriever **per topic**. Which topic is worst, and which other topic's articles does it get confused with?

```python todo
import numpy as np, pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
kb = spark.sql("SELECT article_id, title, body, topic FROM kb_articles ORDER BY article_id").toPandas()
ev = spark.sql("""SELECT t.subject, t.article_id AS expected, a.topic FROM tickets t
                  JOIN kb_articles a ON t.article_id = a.article_id ORDER BY t.ticket_id""").toPandas()
vec = TfidfVectorizer(stop_words="english")
docs = vec.fit_transform(kb.title + " " + kb.body)
ev["top1"] = kb.article_id.values[np.argmax((vec.transform(ev.subject) @ docs.T).toarray(), axis=1)]
# TODO 1: top-1 accuracy per topic, sorted from worst to best
# TODO 2: for the worst topic, count the topics of the wrongly retrieved articles
```

```python solution
ev["hit"] = ev.top1 == ev.expected
print(ev.groupby("topic").hit.mean().sort_values().round(3))
worst = ev.groupby("topic").hit.mean().idxmin()
topic_of = dict(zip(kb.article_id, kb.topic))
print(ev[(ev.topic == worst) & ~ev.hit].top1.map(topic_of).value_counts())
# Setup is the weakest slice. Its tickets say "pair" and "app", but the article says "pairing",
# and "app" appears in almost every article. TF-IDF has no stemming or synonyms: real embeddings,
# hybrid search or a reranker are the fixes to evaluate next, on this same set.
# Nothing to clean up: this module creates no tables.
```

## ⚠️ Common mistakes

- ❌ Judging a change by reading a few answers. Use a fixed set and fixed scorers.
- ❌ Scoring only the final answer. You cannot tell a retrieval miss from a generation error.
- ❌ Running `Correctness` on live traffic: it needs expected facts that production does not have.
- ❌ Picking the run with the best average while one required metric is poor.
- ✅ Track quality, latency and token cost together, and turn production failures into new evaluation rows.

## 🧭 Cheat sheet

| Term | Meaning |
|---|---|
| precision@k / recall@k | Relevant share of the top k / share of relevant docs found in the top k |
| MRR | Mean of 1 / rank of the first relevant hit |
| LLM judge / scorer | Model or function that scores each row; built-ins live in `mlflow.genai.scorers` |
| Needs expectations | `Correctness`, `RetrievalSufficiency`; the others run without ground truth |
| `mlflow.genai.evaluate` | `data`, `predict_fn`, `scorers`; one trace and feedback per row |
| Monitoring | Same scorers on sampled production traces, plus cost and latency |
