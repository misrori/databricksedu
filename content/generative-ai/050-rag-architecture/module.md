---
title: RAG architecture
summary: Follow a question through retrieval-augmented generation, from the offline index to a cited answer. Learn where RAG fails, how to tell a retrieval error from a generation error, and when RAG beats fine-tuning.
icon: 🔗
level: Beginner
minutes: 10
group: Retrieval
tags: [RAG, Retrieval, Citations, Vector Search]
---
# RAG architecture

> A model only knows its training data and what is in the prompt. **Retrieval-augmented generation** (RAG) looks up the relevant documents at question time and puts them into the prompt, so the answer can use fresh, private facts and cite them.

**The one idea to remember:** RAG is two pipelines. An **offline** one prepares an index of chunks, and an **online** one retrieves the best chunks for each question and asks the model to answer **only from them**. Most bad answers start with bad retrieval.

## 💡 Why RAG

A support bot must know that the current HomeHub firmware is 4.2.1 and that the warranty lasts 24 months. A general model does not, and its training data stops at a cutoff date.

- **Fresh:** update a document, re-sync the index, and the next answer uses it. No retraining.
- **Private:** your documents stay in your tables and are read only when needed, under Unity Catalog permissions.
- **Citable:** every chunk has a source, so the answer can say where a fact came from and a reviewer can check it.
- **Less guessing:** with the facts in the prompt, and permission to say "I don't know", the model has less reason to invent.

## 🏭 Offline: build the index

This part runs as a job, before any user asks anything. The modules "Parsing and chunking documents" and "Embeddings and Vector Search" cover each box in detail.

```viz flow
{"title": "Indexing pipeline (runs on a schedule)",
 "nodes": [{"icon": "📥", "title": "Documents", "sub": "files in a UC volume", "color": "bronze"},
           {"icon": "🔍", "title": "Parse and clean", "sub": "text, tables, pages", "color": "blue"},
           {"icon": "✂️", "title": "Chunk", "sub": "Delta table with metadata", "color": "amber"},
           {"icon": "🧮", "title": "Embed", "sub": "embedding endpoint", "color": "purple"},
           {"icon": "📇", "title": "Index", "sub": "Vector Search, synced", "color": "teal"}],
 "edges": ["read", "clean text", "chunk rows", "vectors"]}
```

The chunk table needs a primary key and Change Data Feed, so a Delta Sync index can pick up changes. A **triggered** index must be synced after each load, or it serves yesterday's documents.

## ⚡ Online: answer a question

```viz flow
{"title": "One request through a RAG app",
 "nodes": [{"icon": "❓", "title": "Question", "sub": "from the user", "color": "amber"},
           {"icon": "🔎", "title": "Retrieve", "sub": "top-k chunks + filters", "color": "teal"},
           {"icon": "🧾", "title": "Augment", "sub": "prompt with sources", "color": "blue"},
           {"icon": "🧠", "title": "Generate", "sub": "chat model endpoint", "color": "purple"},
           {"icon": "📌", "title": "Answer + citations", "sub": "source ids", "color": "green"}],
 "edges": ["query text", "chunks", "one prompt", "text"],
 "steps": [{"label": "Question", "focus": [0], "note": "`Voice commands for ThermoSense stopped working.` In a chat, a follow-up such as \"and for the plug?\" is first **rewritten** into a standalone question."},
           {"label": "Retrieve", "focus": [1], "note": "The question is embedded with the index's model and the k nearest chunks come back, optionally filtered by `product = 'ThermoSense'` and reranked."},
           {"label": "Augment", "focus": [2], "note": "The chunks go into a prompt template with delimiters and source ids, plus the rule: answer only from these sources."},
           {"label": "Generate", "focus": [3], "note": "The model writes the answer. It sees only the prompt, so a fact that was not retrieved cannot be used correctly."},
           {"label": "Cite", "focus": [4], "note": "The app returns the answer with the source ids it cited. MLflow tracing records every step, which is how you debug it later."}]}
```

## 🧾 The augmented prompt

```viz code
title: what the model receives (k = 2)
lang: text
---
You are a Casa support assistant. Answer the question using only the sources below.
Cite the source id in square brackets after each fact, like [12].
If the sources do not contain the answer, say "I don't know".
<source id="15" title="ThermoSense: Voice assistant integration">
ThermoSense works with Alexa and Google Home. ... Voice control needs the cloud
connection, so it does not work during an internet outage.
</source>
<source id="14" title="ThermoSense: Schedules and automations">
... Routines run locally on the hub, so they keep working without internet. ...
</source>
Question: Voice commands for ThermoSense stopped working.
---
1 | grounding rule | Answer from the sources, not from memory. This is what turns a chat model into a RAG answerer.
2 | citations | Ids the app can turn into links. Ask for them explicitly, or they will not appear.
3 | way out | Permission to say "I don't know" when retrieval found nothing useful. Without it the model guesses.
4-7 | source 1 | A retrieved chunk inside delimiters, with its id and title as metadata.
8-10 | source 2 | A second chunk. It is related but answers a different question: noise the model must ignore.
11 | question | The user's text, last, clearly separated from the sources.
```

## 🩺 Where RAG fails

| Failure | What you see | Fix |
|---|---|---|
| **Bad retrieval** | The right chunk is not in the top-k | Hybrid search, better chunks, filters, larger k, reranking |
| **Lost in the middle** | Right chunk retrieved, but buried among many others | Fewer, better chunks; put the best ones first |
| **Stale index** | Answers quote an old version | Sync after each load; keep only current documents |
| **Wrong chunking** | The answer is split across two chunks | Sentence or structure-aware chunks, overlap, parent-child |

To find the culprit, open the **trace** and ask one question first: **was the right chunk in the context?** If not, it is a retrieval error, and no prompt change can fix it. If yes and the answer is still wrong, it is a generation error: work on the prompt, the model or the number of chunks.

## ⚖️ RAG, fine-tuning or a long prompt?

```viz compare
{"items": [{"icon": "🔗", "title": "RAG", "sub": "retrieve facts per question", "color": "teal",
            "points": ["✅ fresh and private facts, with citations", "✅ update by re-syncing the index", "❌ quality depends on retrieval", "Default for knowledge that changes"]},
           {"icon": "🎛️", "title": "Fine-tuning", "sub": "change the weights", "color": "purple",
            "points": ["✅ style, format, domain language", "❌ facts go stale until the next training run", "❌ no citations, costly to repeat", "Combine with RAG, do not replace it"]},
           {"icon": "📚", "title": "Prompt stuffing", "sub": "send every document each time", "color": "amber",
            "points": ["✅ no index to build", "❌ pays for all tokens on every call", "❌ slower, and lost in the middle", "Fine for a few short documents"]}]}
```

## 🧱 RAG on Databricks

```viz layers
{"layers": [{"icon": "📊", "title": "Quality", "sub": "MLflow tracing and evaluation", "color": "green", "items": ["A trace per request, with retrieved chunks", "Judges for relevance and groundedness"]},
            {"icon": "🚀", "title": "App and serving", "sub": "Mosaic AI Agent Framework", "color": "blue", "items": ["Log the chain or agent with MLflow", "Deploy to a serving endpoint, test in the Review App"]},
            {"icon": "🧠", "title": "Models", "sub": "Foundation Model APIs, external models", "color": "purple", "items": ["Chat model for generation", "Embedding model for index and queries"]},
            {"icon": "📇", "title": "Retrieval", "sub": "Mosaic AI Vector Search", "color": "teal", "items": ["Endpoint and Delta Sync index", "Filters, hybrid search, reranking"]},
            {"icon": "🗄️", "title": "Data and governance", "sub": "Unity Catalog", "color": "navy", "items": ["Volumes for raw files, Delta tables for chunks", "Privileges and lineage on every object"]}]}
```

## 🧪 Try it: a complete RAG chain without an LLM

```dataset support
```

TF-IDF stands in for the embedding index, and a deterministic function stands in for the model: it returns the retrieved sentence closest to the question. Every step of the chain runs.

```python run
# Retrieve: TF-IDF over the articles stands in for a vector index
import re, numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

kb = spark.table("kb_articles").select("article_id", "title", "body").toPandas()
vectorizer = TfidfVectorizer(stop_words="english")
kb_vectors = vectorizer.fit_transform(kb["body"])

def retrieve(question, k=3):
    scores = cosine_similarity(vectorizer.transform([question]), kb_vectors)[0]
    return [{"article_id": int(kb.loc[i, "article_id"]), "title": kb.loc[i, "title"],
             "body": kb.loc[i, "body"], "score": round(float(scores[i]), 3)} for i in np.argsort(-scores)[:k]]

for h in retrieve("Voice commands for ThermoSense stopped working."):
    print(h["article_id"], h["title"], h["score"])
```

```python run
# Augment: build the prompt an LLM would receive
PROMPT = """You are a Casa support assistant. Answer the question using only the sources below.
Cite the source id in square brackets after each fact, like [12].
If the sources do not contain the answer, say "I don't know".

{sources}

Question: {question}"""

def build_prompt(question, hits):
    sources = "\n".join(f'<source id="{h["article_id"]}" title="{h["title"]}">\n{h["body"]}\n</source>' for h in hits)
    return PROMPT.format(sources=sources, question=question)

question = "Voice commands for ThermoSense stopped working."
prompt = build_prompt(question, retrieve(question))
print(prompt)
print(f"\nabout {round(len(prompt.split()) * 1.3)} tokens")
```

```python run
# Generate and cite: an extractive stand-in for the model, then the whole chain
def sentences(text):
    return re.split(r"(?<=[.!?])\s+", text.strip())[1:]       # sentence 0 only repeats the title

def extractive_answer(question, hits):
    cands = [(h["article_id"], s) for h in hits for s in sentences(h["body"])]
    scores = cosine_similarity(vectorizer.transform([question]), vectorizer.transform([s for _, s in cands]))[0]
    source, sentence = cands[int(scores.argmax())]
    return sentence, source

def rag(question, k=3):
    hits = retrieve(question, k)
    prompt = build_prompt(question, hits)          # a real app sends this to the model
    sentence, source = extractive_answer(question, hits)
    return f"{sentence} [{source}]", [h["article_id"] for h in hits]

for t in spark.sql("SELECT subject, article_id FROM tickets WHERE resolved ORDER BY ticket_id LIMIT 5").collect():
    answer, retrieved = rag(t.subject)
    print(f"Q: {t.subject}\nA: {answer}   retrieved={retrieved}  expected={t.article_id}\n")
```

> With a real model, step 3 becomes one call. It needs a chat endpoint (Foundation Model APIs or an external model) and `CAN QUERY` on it, and it costs tokens, so it is display only here. The endpoint name is an example; names change.

```python
from databricks.sdk import WorkspaceClient
client = WorkspaceClient().serving_endpoints.get_open_ai_client()
response = client.chat.completions.create(model="databricks-meta-llama-3-3-70b-instruct",
                                          messages=[{"role": "user", "content": prompt}],
                                          max_tokens=200, temperature=0)
print(response.choices[0].message.content)
```

## Exercise 1: retrieval error or generation error?

Run the chain on 200 resolved tickets and sort every wrong answer into one of two buckets: the right article was **never retrieved**, or it was retrieved but the answer came from **another source**. Predict which bucket is bigger.

```python todo
# Setup: the chain from the lecture (retriever + extractive answer)
import re, numpy as np
from collections import Counter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

kb = spark.table("kb_articles").select("article_id", "title", "body").toPandas()
tickets = spark.sql("SELECT subject, article_id FROM tickets WHERE resolved ORDER BY ticket_id LIMIT 200").toPandas()
vectorizer = TfidfVectorizer(stop_words="english")
kb_vectors = vectorizer.fit_transform(kb["body"])

def retrieve(question, k=3):
    scores = cosine_similarity(vectorizer.transform([question]), kb_vectors)[0]
    return [{"article_id": int(kb.loc[i, "article_id"]), "body": kb.loc[i, "body"]} for i in np.argsort(-scores)[:k]]

def extractive_answer(question, hits):
    cands = [(h["article_id"], s) for h in hits for s in re.split(r"(?<=[.!?])\s+", h["body"])[1:]]
    scores = cosine_similarity(vectorizer.transform([question]), vectorizer.transform([s for _, s in cands]))[0]
    source, sentence = cands[int(scores.argmax())]
    return sentence, source

# TODO: for each ticket, retrieve (k=3), answer, and count: correct / generation error / retrieval error
```

```python solution
cases = Counter()
for t in tickets.itertuples():
    hits = retrieve(t.subject)
    _, source = extractive_answer(t.subject, hits)
    if source == t.article_id:
        cases["correct"] += 1
    elif t.article_id in [h["article_id"] for h in hits]:
        cases["generation error: right article retrieved, another one used"] += 1
    else:
        cases["retrieval error: right article not retrieved"] += 1
print(cases)
# About 140 correct, 31 generation errors, 29 retrieval errors: roughly the same size.
# Example of a generation error: "Voice commands ... stopped working" picks "keep working without internet"
# from the automation article, although the voice article was ranked first.
```

## Exercise 2: how many chunks?

Run the chain with k = 1, 3, 5 and 10. For each, measure the **hit rate** (right article in the context), the **answer accuracy**, and the average prompt size in tokens (`words × 1.3`). Uses the setup cell of Exercise 1.

```python todo
PROMPT = 'Answer only from the sources. Cite ids like [12]. Say "I don\'t know" if unsure.\n{sources}\nQuestion: {question}'
# TODO: for each k, compute hit rate, answer accuracy and average prompt tokens
```

```python solution
for k in [1, 3, 5, 10]:
    hit = correct = tokens = 0
    for t in tickets.itertuples():
        hits = retrieve(t.subject, k)
        prompt = PROMPT.format(sources="\n".join(h["body"] for h in hits), question=t.subject)
        hit += t.article_id in [h["article_id"] for h in hits]
        correct += extractive_answer(t.subject, hits)[1] == t.article_id
        tokens += len(prompt.split()) * 1.3
    n = len(tickets)
    print(f"k={k:<3} hit rate={hit / n:.0%}  accuracy={correct / n:.0%}  avg prompt tokens={tokens / n:.0f}")
# Hit rate climbs from about 73% to 100%, but accuracy stays near 70%, while the prompt grows about 7 times.
# More context helps only if the generator can ignore the noise. Choose k with an evaluation, not by habit.
# Nothing to clean up: this module creates no tables.
```

## ⚠️ Common mistakes

- ❌ Tuning the prompt when the right chunk was never retrieved. Check the trace first.
- ❌ Fine-tuning a model to teach it facts that change every week.
- ❌ Raising k until the answer looks right: more noise, more cost, lost in the middle.
- ❌ Forgetting to sync a triggered index after the documents change.
- ✅ Ask for citations and allow "I don't know"; measure retrieval and generation separately.

## 🧭 Cheat sheet

| Question | Answer |
|---|---|
| Where do documents live? | Raw files in a UC volume, chunks in a Delta table |
| What finds the chunks? | A Vector Search index, synced from the chunk table |
| What writes the answer? | A chat model through Foundation Model APIs or an external model |
| How is it deployed? | Logged with MLflow, served with Mosaic AI Agent Framework |
| How do I debug one answer? | MLflow trace: was the right chunk retrieved? |
| Knowledge that changes often | RAG, not fine-tuning |
