---
title: Parsing and chunking documents
summary: Turn PDFs, web pages and articles into clean, well-sized chunks with metadata. Compare fixed-size, sentence, recursive and structure-based chunking, write chunks to a Delta table, and judge a strategy by retrieval quality.
icon: ✂️
level: Intermediate
minutes: 12
group: Retrieval
tags: [Chunking, Parsing, ai_parse_document, RAG]
---
# Parsing and chunking documents

> A retriever can only return what you indexed. Before anything is embedded, documents are parsed to text, cleaned, and cut into **chunks**: pieces small enough to match one question well and large enough to answer it.

**The one idea to remember:** a chunk is the **unit of retrieval**. Its size, its boundaries and the metadata you attach decide what the model will see, so choose them by measuring retrieval, not by habit.

## 💡 Why chunk at all

Three limits push you to split documents:

- **The embedding model has a maximum input.** Text beyond it is silently **truncated**, so the end of a long document never reaches the vector.
- **One vector per topic.** A 40-page manual squeezed into one vector is an average of everything. A question about batteries matches it weakly.
- **The LLM context window.** You pass the top-k chunks plus the prompt and history. Smaller chunks let you pass more distinct sources.

| Chunks too large | Chunks too small |
|---|---|
| Fewer vectors, cheaper index | Many vectors, more storage and cost |
| Vague matches, noise in the prompt | Sharp matches, but missing context |
| Risk of truncation by the embedding model | Answers split across chunks |

## 📄 Parsing: from files to text

Raw files belong in a **Unity Catalog volume**. A job or pipeline reads them, extracts text, and keeps the provenance: file path, page, section.

| Source | Typical tool |
|---|---|
| Digital PDF | `pypdf`, `PyMuPDF`, `pdfplumber` for tables |
| Scanned PDF or image | OCR, for example `pytesseract`; text extraction finds nothing |
| HTML | `beautifulsoup4`; drop menus, banners and footers |
| Mixed formats, layout-aware | `ai_parse_document()` in SQL, or `unstructured` |

```sql
-- Display only: ai_parse_document needs a workspace where AI Functions are available, and it is billed
SELECT path, ai_parse_document(content) AS parsed
FROM read_files('/Volumes/main/support/raw_docs/', format => 'binaryFile');
```

`ai_parse_document` returns a structured result with text elements, tables and page information. **Clean** before chunking: repeated headers and footers, page numbers, tables of contents and old duplicate versions only add noise to every vector.

## 🏭 The indexing pipeline

```viz flow
{"title": "From a raw file to a searchable chunk",
 "nodes": [{"icon": "📥", "title": "Raw files", "sub": "UC volume: PDF, HTML, DOCX", "color": "bronze"},
           {"icon": "🔍", "title": "Parse", "sub": "text, tables, pages", "color": "blue"},
           {"icon": "🧹", "title": "Clean", "sub": "drop boilerplate", "color": "silver"},
           {"icon": "✂️", "title": "Chunk", "sub": "plus id and metadata", "color": "amber"},
           {"icon": "📇", "title": "Embed and index", "sub": "Delta table, then Vector Search", "color": "teal"}],
 "edges": ["binaryFile", "plain text", "clean text", "chunk rows"],
 "steps": [{"label": "Land", "focus": [0], "note": "Files arrive in a volume. Unity Catalog governs who can read them, and the path becomes the `source` of every chunk."},
           {"label": "Parse", "focus": [1], "note": "Pick the parser per format. A scanned PDF needs OCR; a layout-aware parser keeps headings and tables apart."},
           {"label": "Clean", "focus": [2], "note": "Remove what repeats on every page and fix extraction damage such as broken hyphenation. Junk in means junk retrieved."},
           {"label": "Chunk", "focus": [3], "note": "Split by the chosen strategy. Each chunk gets a stable **primary key** and metadata columns such as title, section and product."},
           {"label": "Index", "focus": [4], "note": "Write the chunks to a Delta table with **Change Data Feed** on. A Delta Sync vector index embeds and syncs from there."}]}
```

## ⚖️ Chunking strategies

```viz compare
{"items": [{"icon": "📏", "title": "Fixed size + overlap", "sub": "every N characters or tokens", "color": "blue",
            "points": ["✅ simple, predictable sizes", "❌ cuts words and sentences", "Baseline for uniform text"]},
           {"icon": "🔤", "title": "Sentence or paragraph", "sub": "group whole units up to a limit", "color": "teal",
            "points": ["✅ every chunk reads cleanly", "❌ sizes vary", "Prose, FAQs, articles"]},
           {"icon": "🪆", "title": "Recursive", "sub": "paragraphs, then sentences, then words", "color": "purple",
            "points": ["✅ keeps the biggest unit that fits", "✅ default in many libraries", "General documents of mixed length"]},
           {"icon": "🗂️", "title": "Structure or semantic", "sub": "headings, or meaning shifts", "color": "amber",
            "points": ["✅ chunks follow the document's own sections", "❌ needs layout or extra embedding calls", "Manuals, wikis, contracts"]}]}
```

Two more patterns: **one record per chunk** for items that are already short (an FAQ entry, a ticket), and **parent-child** (small-to-big), where you match on small chunks but pass the larger parent section to the model.

## 🪟 A sliding window with overlap

A real article, about 460 characters, cut into windows of 200 characters that **overlap** by 50. The step is `size - overlap` = 150.

```viz table
{"title": "kb_articles: HomeHub: Device shows as offline", "columns": ["chunk", "chars", "text"],
 "rows": [["0", "0-200", "Device shows as offline for HomeHub, the central smart-home hub. HomeHub goes offline when it loses Wi-Fi for more than five minutes. Check that the router is on and that the device is within range (t"]],
 "steps": [{"label": "First window", "note": "The window ends after 200 characters, in the middle of `(the`. Fixed-size chunking does not care about words."},
           {"label": "Slide by 150", "note": "Chunk 1 starts 50 characters before the end of chunk 0, so the text around the cut is in both. Here the overlap is still too short to keep the sentence about range whole: overlap reduces the damage, it does not remove it.", "add": [["1", "150-350", "outer is on and that the device is within range (the signal indicator in the app should show at least two bars). Power-cycle HomeHub by unplugging it for 30 seconds. If the router password changed, op"]]},
           {"label": "Last window", "note": "The last chunk is shorter. Overlap repeats text, so the index stores more characters than the article has.", "add": [["2", "300-461", "for 30 seconds. If the router password changed, open Settings > Network > Update Wi-Fi. Devices reconnect automatically after an outage; no re-pairing is needed."]]},
           {"label": "Missing context", "note": "Chunk 2 never names the product. A question about **PlugMate** could retrieve it. Metadata and context enrichment fix this.", "hl": [2]}]}
```

## 📏 Size and overlap, measured

Fixed-size chunking of all 48 articles (about 400 characters each), with different settings:

| Size | Overlap | Chunks | Average length |
|---|---|---|---|
| 200 | 0 | 119 | 163 |
| 200 | 50 | 138 | 173 |
| 200 | 100 | 167 | 187 |
| 300 | 50 | 96 | 227 |

- **More overlap means more chunks**, not fewer. To shrink an index, use larger chunks or less overlap.
- A common starting point is a few hundred tokens with 10-20% overlap. Real limits are in **tokens**: keep every chunk below the embedding model's maximum input.

## 🏷️ Metadata and context-enriched chunks

A chunk row carries more than its text. This is what one row of a chunk table could look like.

```viz code
title: one row of a chunk table
lang: json
---
{"chunk_id": "2-2",
 "article_id": 2,
 "source": "/Volumes/main/support/raw_docs/homehub-offline.pdf",
 "title": "HomeHub: Device shows as offline",
 "section": "Troubleshooting",
 "product": "HomeHub",
 "updated_on": "2026-03-14",
 "chunk_text": "If the router password changed, open Settings > Network > Update Wi-Fi.",
 "embed_text": "HomeHub: Device shows as offline. If the router password changed, ..."}
---
1-2 | keys | A stable primary key, plus the id of the parent document. Vector Search needs the key; parent-child retrieval needs the parent id.
3 | source | Where the text came from. The app shows it as a **citation**.
4-6 | metadata | Columns you can **filter** on at query time, such as `product = 'HomeHub'`.
7 | freshness | Lets you prefer or keep only current versions.
8 | chunk_text | What the model reads in the prompt.
9 | embed_text | **Context-enriched** text: the title is prepended before embedding, so the vector knows which product and topic this is.
```

## 🧪 Try it: two chunkers and a chunk table

```dataset support
```

```python run
# Two chunkers in plain Python
import re

def fixed_chunks(text, size=200, overlap=50):
    step = size - overlap
    return [text[i:i + size] for i in range(0, max(len(text) - overlap, 1), step)]

def sentence_chunks(text, max_chars=250):
    chunks, current = [], ""
    for s in re.split(r"(?<=[.!?])\s+", text.strip()):         # split after . ! or ? followed by a space
        if current and len(current) + 1 + len(s) > max_chars:
            chunks.append(current)
            current = s
        else:
            current = (current + " " + s).strip()
    return chunks + [current] if current else chunks

body = spark.sql("SELECT body FROM kb_articles WHERE article_id = 2").first().body
for name, f in [("fixed", fixed_chunks), ("sentence", sentence_chunks)]:
    print(f"\n== {name}")
    for c in f(body):
        print(f"{len(c):>4}  {c}")
```

```python run
# Apply both to every article and compare
import pandas as pd

kb = spark.table("kb_articles").select("article_id", "body").toPandas()
rows = [(name, int(a.article_id), f"{a.article_id}-{i}", c)
        for name, f in [("fixed", fixed_chunks), ("sentence", sentence_chunks)]
        for a in kb.itertuples() for i, c in enumerate(f(a.body))]
all_chunks = pd.DataFrame(rows, columns=["strategy", "article_id", "chunk_id", "chunk_text"])
all_chunks["chars"] = all_chunks["chunk_text"].str.len()
print(all_chunks.groupby("strategy")["chars"].agg(["count", "mean", "min", "max"]).round(0))
```

```python run
# Store the sentence chunks in a Delta table, ready for a Delta Sync index
chunks = all_chunks[all_chunks.strategy == "sentence"][["article_id", "chunk_id", "chunk_text"]]
spark.createDataFrame(chunks).createOrReplaceTempView("chunk_staging")

spark.sql("""CREATE OR REPLACE TABLE chunk_kb_chunks
             TBLPROPERTIES (delta.enableChangeDataFeed = true)
             AS SELECT * FROM chunk_staging""")
display(spark.sql("SELECT * FROM chunk_kb_chunks ORDER BY article_id, chunk_id LIMIT 8"))
```

> The sentence chunker gives fewer chunks (about 108 against 138) and no cut words, but sizes vary more. Creating the index itself needs a Vector Search endpoint, so it stays display only (see "Embeddings and Vector Search").

## Exercise 1: predict the chunk count

For fixed-size chunking of all articles, predict whether each setting gives **more or fewer** chunks than 200/50 (138 chunks): 200/0, 200/100, 300/50, 100/20. Then measure.

```python todo
# Setup: the fixed-size chunker from the lecture
def fixed_chunks(text, size=200, overlap=50):
    step = size - overlap
    return [text[i:i + size] for i in range(0, max(len(text) - overlap, 1), step)]

bodies = [r.body for r in spark.table("kb_articles").select("body").collect()]

# TODO: for each (size, overlap) pair, print the total number of chunks and the average chunk length
```

```python solution
for size, overlap in [(200, 50), (200, 0), (200, 100), (300, 50), (100, 20)]:
    cs = [c for b in bodies for c in fixed_chunks(b, size, overlap)]
    print(f"size={size:<4} overlap={overlap:<4} chunks={len(cs):<4} avg={sum(map(len, cs)) / len(cs):.0f}")
# 200/0: 119 (fewer), 200/100: 167 (more), 300/50: 96 (fewer), 100/20: 252 (many more).
# Overlap repeats text, so it always adds chunks. Size is the main lever on index size.
```

## Exercise 2: judge chunking by retrieval

Chunking is only good if retrieval gets better. Index the whole articles, the fixed chunks and the sentence chunks with TF-IDF, map each retrieved chunk back to its `article_id`, and compute top-1 accuracy on 200 resolved tickets. Predict the winner first.

```python todo
# Setup
import re, numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

def fixed_chunks(text, size=200, overlap=50):
    return [text[i:i + size] for i in range(0, max(len(text) - overlap, 1), size - overlap)]

def sentence_chunks(text, max_chars=250):
    chunks, current = [], ""
    for s in re.split(r"(?<=[.!?])\s+", text.strip()):
        if current and len(current) + 1 + len(s) > max_chars:
            chunks.append(current); current = s
        else:
            current = (current + " " + s).strip()
    return chunks + [current] if current else chunks

kb = spark.table("kb_articles").select("article_id", "body").toPandas()
tickets = spark.sql("SELECT subject, article_id FROM tickets WHERE resolved ORDER BY ticket_id LIMIT 200").toPandas()

# TODO: write top1(chunker) that chunks every article, fits TF-IDF on the chunks,
#       finds the best chunk for each ticket subject and compares its article_id with the label
```

```python solution
def top1(chunker):
    pairs = [(a.article_id, c) for a in kb.itertuples() for c in chunker(a.body)]
    owners = np.array([p[0] for p in pairs])
    v = TfidfVectorizer(stop_words="english")
    X = v.fit_transform([p[1] for p in pairs])
    best = owners[cosine_similarity(v.transform(tickets["subject"]), X).argmax(axis=1)]
    return len(pairs), (best == tickets["article_id"].to_numpy()).mean()

for name, f in [("whole article", lambda b: [b]), ("fixed 200/50", fixed_chunks), ("sentence", sentence_chunks)]:
    n, acc = top1(f)
    print(f"{name:<14} chunks={n:<4} top-1={acc:.1%}")
# The whole article wins here (about 73% vs 72% and 66%): these articles are short and about one topic,
# and chunks lose words such as the product name. Chunk long, multi-topic documents; keep short ones whole.

# Clean up the lecture table when you are done
# DROP TABLE chunk_kb_chunks;
```

## ⚠️ Common mistakes

- ❌ Chunks longer than the embedding model's maximum input: the end is truncated without an error.
- ❌ Raising the overlap to get fewer chunks. It gives more.
- ❌ Text extraction on scanned PDFs: they need OCR.
- ❌ Chunks without a primary key, source or title: no sync, no filters, no citations.
- ✅ Clean boilerplate, attach metadata, enable Change Data Feed, and compare strategies with a retrieval evaluation.

## 🧭 Cheat sheet

| Situation | Choice |
|---|---|
| Uniform text, quick baseline | Fixed size, 10-20% overlap |
| Articles and prose | Sentence or recursive chunking |
| Manuals with headings | Structure-aware chunking, section in metadata |
| Short self-contained items | One record per chunk |
| Precise match but more context for the LLM | Parent-child (small-to-big) |
| Chunk table for Delta Sync | Primary key, metadata columns, `delta.enableChangeDataFeed = true` |
