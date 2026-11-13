---
title: Embeddings and Vector Search
summary: Turn text into vectors, find the nearest ones to a question, and see how Mosaic AI Vector Search builds, syncs and queries an index. Then measure a retriever on real tickets.
icon: 🧭
level: Intermediate
minutes: 12
group: Retrieval
tags: [Embeddings, Vector Search, Cosine similarity, Hybrid search]
---
# Embeddings and Vector Search

> Keyword search finds documents that share your words. Vector search finds documents that share your **meaning**, because an embedding model places similar texts close together in space.

**The one idea to remember:** an embedding turns text into a list of numbers, and **similar meaning means a small angle between vectors**. A vector index is a structure that finds the closest vectors fast, without comparing the query to every row.

## 💡 Text becomes a vector

An **embedding model** reads a text and returns a fixed-length vector, for example 1,024 numbers. Real dimensions have no names. In this toy version each text gets 3 numbers: how much it is about **connectivity**, **hardware and power**, and **account and data**.

```viz table
{"title": "Four article snippets as toy 3-dimensional vectors", "columns": ["text", "vector", "cosine to query"],
 "rows": [["Device offline: check the router and Wi-Fi", "[0.90, 0.20, 0.10]", ""],
          ["Firmware updates install at night", "[0.50, 0.60, 0.10]", ""],
          ["Batteries last about 12 months", "[0.10, 0.95, 0.10]", ""],
          ["Export or delete your data", "[0.10, 0.10, 0.95]", ""]],
 "steps": [{"label": "Embed the documents", "note": "Each text is embedded **once**, when the index is built. The vectors are stored next to the text."},
           {"label": "Embed the query", "note": "The question `My HomeHub is unreachable` goes through the **same** model and becomes `[0.80, 0.30, 0.10]`. It shares no word with the first snippet.", "add": [["Query: My HomeHub is unreachable", "[0.80, 0.30, 0.10]", "-"]]},
           {"label": "Score every vector", "note": "Cosine similarity compares directions: 1 means same direction, 0 means unrelated.", "upd": {"0": {"cosine to query": "0.99"}, "1": {"cosine to query": "0.87"}, "2": {"cosine to query": "0.45"}, "3": {"cosine to query": "0.25"}}},
           {"label": "Top-k", "note": "The two closest vectors are the top-2 result. The offline article wins although it never says \"unreachable\".", "hl": [0, 1]}]}
```

## 📐 Cosine similarity, and why keywords miss paraphrases

Cosine similarity is the dot product of two vectors divided by their lengths: `cos = a·b / (|a| |b|)`. It ignores length and keeps direction, so a long article and a short question can still match.

| Query | Keyword match on "unreachable" | Embedding match |
|---|---|---|
| My HomeHub is unreachable | none: the article says "offline" | close to the offline article |
| How do I pair the plug? | only articles that contain "pair" | also "pairing fails", "setup" |
| Error code E-104 | exact hit | may be weak: codes carry little meaning |

Keywords need the same token. Embeddings learn that "unreachable", "offline" and "lost connection" are used in similar contexts. The last row is why **hybrid search** exists.

## 🕸️ Approximate nearest neighbours (HNSW)

Comparing the query with millions of vectors is too slow for a chat app. Vector indexes use **approximate nearest neighbour** (ANN) search. A common algorithm, also used by Vector Search, is **HNSW** (Hierarchical Navigable Small World): a graph where each vector links to its near neighbours.

```viz layers
{"layers": [{"icon": "🛫", "title": "Top layer", "sub": "a few vectors, long links", "color": "navy", "items": ["Search starts here", "Jump to the neighbour closest to the query"]},
            {"icon": "🚌", "title": "Middle layers", "sub": "more vectors, shorter links", "color": "blue", "items": ["Repeat the greedy step", "Drop down one layer when no neighbour is closer"]},
            {"icon": "🚶", "title": "Bottom layer", "sub": "every vector, local links", "color": "teal", "items": ["Collect the k closest candidates", "A few hundred comparisons instead of millions"]}]}
```

"Approximate" is the price: now and then the true nearest vector is missed. In exchange, latency stays in milliseconds as the index grows.

## 🔄 How Vector Search builds and answers an index

**Mosaic AI Vector Search** runs indexes on a serverless **Vector Search endpoint**. Databricks has started calling the product **Databricks AI Search**, so you may meet both names. The common setup is a Delta Sync index over a table of chunks.

```viz flow
{"title": "Delta Sync index with managed embeddings",
 "nodes": [{"icon": "🗃️", "title": "Source Delta table", "sub": "chunk_id, chunk_text, product", "color": "blue"},
           {"icon": "🧮", "title": "Embedding model", "sub": "a serving endpoint", "color": "purple"},
           {"icon": "📇", "title": "Vector index", "sub": "catalog.schema.index", "color": "teal"},
           {"icon": "❓", "title": "Query", "sub": "text plus filters", "color": "amber"},
           {"icon": "🏅", "title": "Top-k", "sub": "rows with a score", "color": "green"}],
 "edges": ["new and changed rows", "vectors", "ANN search", "results"],
 "steps": [{"label": "Source", "focus": [0], "note": "A Delta table with a **primary key** and **Change Data Feed** enabled, so the index can read only what changed."},
           {"label": "Embed", "focus": [1], "note": "Each new or changed row's text column is sent to the embedding endpoint, for example `databricks-gte-large-en`. Model names change; check the Serving page."},
           {"label": "Index", "focus": [2], "note": "Vectors and the other columns are stored in the index. It is a Unity Catalog object, so privileges and lineage apply."},
           {"label": "Query", "focus": [3, 1], "note": "The query text is embedded with the **same** model. A different model gives vectors in a different space and the results are garbage."},
           {"label": "Answer", "focus": [4], "note": "The endpoint returns the k nearest rows, the requested columns and a similarity score. Your app puts them into the prompt."}]}
```

## ⚖️ Three kinds of index

```viz compare
{"items": [{"icon": "🤖", "title": "Delta Sync, managed embeddings", "sub": "you give a text column", "color": "teal",
            "points": ["✅ Databricks calls the embedding endpoint for you", "✅ syncs from the Delta table", "❌ only models on a serving endpoint", "Simplest RAG setup"]},
           {"icon": "🧑‍🔧", "title": "Delta Sync, self-managed", "sub": "you give a vector column", "color": "blue",
            "points": ["✅ any embedding model, also fine-tuned ones", "✅ still syncs from the Delta table", "❌ you compute vectors for queries too", "Custom models, embeddings computed in batch"]},
           {"icon": "✍️", "title": "Direct Vector Access", "sub": "no source table", "color": "amber",
            "points": ["✅ upsert and delete vectors through the API", "✅ writes visible right away", "❌ no automatic sync, you own consistency", "Apps that write vectors in real time"]}]}
```

A Delta Sync index has a **pipeline type**. `TRIGGERED` updates only when you call `sync()`, for example as a job task after the nightly load, and costs less. `CONTINUOUS` follows the table within seconds and keeps compute running all the time.

## 🧩 Create and query an index with the SDK

Display only: this needs a Vector Search endpoint and an embedding endpoint, and both cost money.

```viz code
title: Python SDK (databricks-vectorsearch)
lang: python
---
from databricks.vector_search.client import VectorSearchClient
vsc = VectorSearchClient()
index = vsc.create_delta_sync_index(
    endpoint_name="kb-endpoint",
    index_name="main.support.kb_index",
    source_table_name="main.support.kb_chunks",
    primary_key="chunk_id",
    pipeline_type="TRIGGERED",
    embedding_source_column="chunk_text",
    embedding_model_endpoint_name="databricks-gte-large-en")
hits = index.similarity_search(query_text="My HomeHub is unreachable",
    columns=["chunk_id", "chunk_text"], filters={"product": "HomeHub"},
    num_results=3, query_type="HYBRID")
index.sync()
---
1-2 | client | The client uses your notebook credentials. The endpoint was created earlier with `vsc.create_endpoint(...)`.
4-5 | names | The endpoint hosts the index. The index gets a three-level Unity Catalog name.
6-7 | source | The chunk table with its primary key. Change Data Feed must be on.
8 | sync mode | `TRIGGERED`: the index changes only when line 14 runs.
9-10 | managed embeddings | The text column and the endpoint that embeds it. For self-managed vectors you pass `embedding_vector_column` and `embedding_dimension` instead.
11-13 | query | Text in, top 3 rows out, only for HomeHub, keyword and vector scores combined.
14 | sync | Pick up new and changed rows from the source table.
```

You can also query from SQL with the `vector_search()` table function, or over REST.

## 🎯 Better results: hybrid, filters, reranking

| Technique | What it does | Cost |
|---|---|---|
| **Hybrid search** | Runs keyword and vector search and merges the two ranked lists | Small; helps with names, codes, SKUs |
| **Metadata filters** | Restrict to rows where `product = 'HomeHub'` before ranking | Needs the column in the index |
| **Reranking** | A slower, more accurate model reorders the top candidates | Extra latency; cannot recover rows the first stage missed |
| **Unity Catalog** | Who may query the index is a privilege, like a table | Grant access, do not share tokens |

Vector Search measures distance with L2 by default. If your self-managed vectors are **normalized** to length 1, L2 order and cosine order are the same.

## 🧪 Try it: a TF-IDF retriever

```dataset support
```

No endpoint needed. **TF-IDF** turns each article into a vector of word weights: frequent in this article, rare elsewhere. It is a keyword method, not a learned embedding, but the search mechanics are identical.

```python run
# Turn every article into a TF-IDF vector
from sklearn.feature_extraction.text import TfidfVectorizer

kb = spark.table("kb_articles").select("article_id", "title", "product", "body").toPandas()
vectorizer = TfidfVectorizer(stop_words="english")
kb_vectors = vectorizer.fit_transform(kb["body"])          # sparse matrix: one row per article

terms = vectorizer.get_feature_names_out()
print("shape:", kb_vectors.shape)                          # (48 articles, vocabulary size)
weights = kb_vectors[0].toarray()[0]
print(kb.loc[0, "title"], [(terms[j], round(float(weights[j]), 2)) for j in weights.argsort()[::-1][:6]])
```

```python run
# Cosine similarity search: the query goes through the SAME vectorizer
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

def search(query, k=3):
    scores = cosine_similarity(vectorizer.transform([query]), kb_vectors)[0]
    return [(int(kb.loc[i, "article_id"]), kb.loc[i, "title"], round(float(scores[i]), 3))
            for i in np.argsort(-scores)[:k]]

tickets = spark.sql("""SELECT ticket_id, product, subject, article_id FROM tickets
                       WHERE resolved ORDER BY ticket_id LIMIT 200""").toPandas()
for t in tickets.head(4).itertuples():
    print(f"\n{t.subject}  (answered by article {t.article_id})")
    for hit in search(t.subject):
        print("   ", hit)
```

```python run
# Top-1 and top-3 accuracy over 200 resolved tickets
ids = kb["article_id"].to_numpy()
scores = cosine_similarity(vectorizer.transform(tickets["subject"]), kb_vectors)   # 200 x 48
ranked = ids[np.argsort(-scores, axis=1)]                                           # article ids, best first

tickets["top1"] = ranked[:, 0] == tickets["article_id"].to_numpy()
tickets["top3"] = [a in row[:3] for a, row in zip(tickets["article_id"], ranked)]
print(f"top-1 accuracy: {tickets.top1.mean():.1%}   top-3 accuracy: {tickets.top3.mean():.1%}")
```

> Expect roughly 70-75% top-1 and 85% top-3. Top-3 matters because a RAG app passes several chunks to the model.

## Exercise 1: why did it miss?

List the subjects the retriever gets wrong most often. For the top miss, compare the words in the subject with the words in the right article. Would a learned embedding help?

```python todo
# Setup: the retriever from the lecture
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

kb = spark.table("kb_articles").select("article_id", "title", "body").toPandas()
tickets = spark.sql("SELECT ticket_id, product, subject, article_id FROM tickets WHERE resolved ORDER BY ticket_id LIMIT 200").toPandas()
vectorizer = TfidfVectorizer(stop_words="english")
kb_vectors = vectorizer.fit_transform(kb["body"])
tickets["best"] = kb["article_id"].to_numpy()[cosine_similarity(vectorizer.transform(tickets["subject"]), kb_vectors).argmax(axis=1)]

# TODO 1: keep the misses (best != article_id)
# TODO 2: replace the product name in the subject with {p} and count the 5 most common patterns
# TODO 3: show the expected and the returned article title for the top pattern
```

```python solution
titles = dict(zip(kb["article_id"], kb["title"]))
misses = tickets[tickets["best"] != tickets["article_id"]].copy()
misses["pattern"] = [s.replace(p, "{p}") for s, p in zip(misses["subject"], misses["product"])]
misses["expected"] = misses["article_id"].map(titles)
misses["returned"] = misses["best"].map(titles)
print(misses["pattern"].value_counts().head(5))
print(misses[["pattern", "expected", "returned"]].drop_duplicates("pattern").head(5).to_string())
# "I just unboxed my {p} and the app cannot find it." expects the setup article, which says "pairing" and "QR code".
# TF-IDF needs exact tokens: "pair" is not "pairing", "automation" is not "automations".
# An embedding model places "cannot find it" near "pairing fails", so it would likely fix this one.
```

## Exercise 2: does preprocessing matter?

Predict first: without the English stop-word list, will top-1 accuracy go up or down? Then measure it.

```python todo
# TODO: build a second vectorizer without stop_words, recompute top-1 accuracy, compare with the first
```

```python solution
for name, v in [("with stop words removed", TfidfVectorizer(stop_words="english")), ("keep all words", TfidfVectorizer())]:
    X = v.fit_transform(kb["body"])
    best = kb["article_id"].to_numpy()[cosine_similarity(v.transform(tickets["subject"]), X).argmax(axis=1)]
    print(f"{name:<24} top-1: {(best == tickets['article_id'].to_numpy()).mean():.1%}")
# Down, by about 15 points: words like "my", "the" and "is" add noise to every match.
# Treat preprocessing, the model and k like hyperparameters, and decide with an evaluation set.
# Nothing to clean up: this module creates no tables.
```

## ⚠️ Common mistakes

- ❌ Querying with a different embedding model than the one that built the index.
- ❌ Expecting a `TRIGGERED` index to see new rows without `sync()`.
- ❌ `CONTINUOUS` sync for data that changes once a day: you pay for idle compute.
- ❌ Direct Vector Access when the data already lives in a Delta table and should just sync.
- ✅ Primary key and Change Data Feed on the source table, hybrid search for codes and names, filters for scope.

## 🧭 Cheat sheet

| Need | Choose |
|---|---|
| Text in a Delta table, simplest setup | Delta Sync index, managed embeddings |
| Your own or fine-tuned embedding model | Delta Sync index, self-managed embeddings |
| Vectors written by an app, no table | Direct Vector Access index |
| Data changes daily / within seconds | `TRIGGERED` + `sync()` / `CONTINUOUS` |
| Exact terms such as error codes | `query_type="HYBRID"` |
| Restrict by product or access level | `filters={...}` on indexed columns |
