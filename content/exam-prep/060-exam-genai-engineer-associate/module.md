---
title: "Generative AI Engineer Associate: exam prep"
summary: What the GenAI Engineer Associate exam covers, the facts and distinctions to know per domain (RAG data prep, Vector Search, agents, MLflow evaluation, guardrails), and a realistic study plan.
icon: 🎓
level: Intermediate
minutes: 14
group: Associate
tags: [Certification, Generative AI, RAG, Agents]
---
# Generative AI Engineer Associate: exam prep

> This exam is for engineers who build LLM applications on Databricks: RAG chains, agents with tools, Vector Search indexes, served models and their evaluation. Passing shows you can pick the right component for a scenario and wire it together with MLflow, Unity Catalog and Model Serving.

**The one idea to remember:** most questions describe a scenario with one hard constraint (cost, freshness, latency, ground truth, privacy). Find that constraint first: it rules out three options, and the **simplest design that meets it** is the answer.

## 📋 The exam at a glance

| Fact | Value |
|---|---|
| Questions | 45 scored, multiple-choice and multiple-selection, plus up to 10 unscored items |
| Time and fee | 90 minutes · USD 200 |
| Delivery | Online proctored, no test aids |
| Validity | 2 years, recertify by taking the current exam |
| Passing score | Not published by Databricks. Aim for 80% or more on unseen practice tests |
| Version | Exam published March 18, 2026 |

> Product names moved after the exam was published. The exam says **Vector Search** (now Databricks AI Search), **AI Gateway** (features now in Unity Gateway), **Genie spaces** (now Genie Agents) and `agents.deploy()` (now legacy). Learn the exam names, recognise the new ones.

## 🗺️ Domains and weights

```viz layers
{"layers": [
  {"icon": "🧭", "title": "Design Applications · 14%", "sub": "prompts, model tasks, chains vs agents", "color": "blue", "items": ["Formatted output prompts", "Task selection", "Agent Bricks"]},
  {"icon": "📄", "title": "Data Preparation · 14%", "sub": "documents to chunks to Delta", "color": "bronze", "items": ["Parsing packages", "Chunking strategy", "Retrieval metrics, re-ranking"]},
  {"icon": "🛠️", "title": "Application Development · 30%", "sub": "the biggest domain", "color": "purple", "items": ["LLM and embedding choice", "LangChain, LangGraph, MLflow", "Guardrails"]},
  {"icon": "🚀", "title": "Assembling and Deploying Applications · 22%", "sub": "from code to endpoint", "color": "teal", "items": ["pyfunc, signature, resources", "Vector Search config", "ai_query, MCP, prompt registry"]},
  {"icon": "🛡️", "title": "Governance · 8%", "sub": "masking, injection, licensing", "color": "red", "items": ["PII masking", "Prompt injection defences"]},
  {"icon": "📈", "title": "Evaluation and Monitoring · 12%", "sub": "MLflow scorers, inference tables", "color": "green", "items": ["Judges and ground truth", "AI Gateway, cost control"]}
]}
```

Application Development and Deploying are 52% of the exam together. Spend half your study time there, and practise reading Python snippets (LangChain chains, `log_model`, `VectorSearchClient`).

## 🧭 Design Applications · 14%

Start from the requirement, not the model. Name the input, the exact output, the knowledge needed and any action. Then pick the task and the shape.

| Requirement | Choose |
|---|---|
| Paragraph to a one-line gist | **Summarization** (not classification) |
| Invoice to vendor, date, amount | **Extraction** with a JSON schema, few-shot examples, low temperature |
| Fixed steps: retrieve, prompt, answer | A **chain**. Cheap, predictable, easy to evaluate |
| Next step depends on earlier results | An **agent** with few, focused, clearly described tools |
| Q&A over documents with citations, structured fields from documents, or routing across Genie and document agents | Agent Bricks **Knowledge Assistant**, **Information Extraction**, **Multi-Agent Supervisor** |

- Order tools as: gather facts first, verify, then act. Irreversible actions come last and may need confirmation.
- A format problem is solved with a precise prompt (schema, allowed values, examples), not fine-tuning.

## 📄 Data Preparation · 14%

Know the pipeline from raw file to an index-ready table, and which package reads which format.

```viz flow
{"title": "From raw documents to a sync-ready chunk table",
 "nodes": [
  {"icon": "📁", "title": "UC volume", "sub": "raw PDFs, HTML, DOCX", "color": "bronze"},
  {"icon": "🔍", "title": "Parse", "sub": "text plus page, path", "color": "amber"},
  {"icon": "🧹", "title": "Clean", "sub": "remove noise", "color": "silver"},
  {"icon": "✂️", "title": "Chunk", "sub": "size, overlap, metadata", "color": "blue"},
  {"icon": "🗄️", "title": "Delta table", "sub": "primary key, CDF on", "color": "gold"}],
 "edges": ["read", "text", "clean text", "rows"],
 "steps": [
  {"label": "Store", "focus": [0], "note": "Raw files land in a **Unity Catalog volume** and are read with `binaryFile` or `read_files`. Keep the path for provenance."},
  {"label": "Parse", "focus": [1], "note": "Digital PDF: `pypdf`, `PyMuPDF`, `pdfplumber` for tables. Scanned PDF or image: **OCR** (`pytesseract`). HTML: `beautifulsoup4`. Mixed layouts: `unstructured` or `ai_parse_document()`."},
  {"label": "Clean", "focus": [2], "note": "Drop headers, footers, page numbers, menus, cookie banners, tables of contents and old duplicate versions. Noise dilutes the embeddings."},
  {"label": "Chunk", "focus": [3], "note": "Chunks must fit the **embedding model's context length** or they are truncated. More overlap means **more** chunks. Add source, section, date and access level as metadata."},
  {"label": "Write", "focus": [4], "note": "Write to a Delta table with an id column as **primary key** and `delta.enableChangeDataFeed = true`, so a Delta Sync index can update incrementally."}
 ]}
```

## 🎯 Retrieval quality and re-ranking

Measure retrieval on its own, with an evaluation set of questions and the chunks that should come back.

| Metric | Answers the question |
|---|---|
| **Precision@k** | How many of the top k chunks are relevant? |
| **Recall@k** | How many of all relevant chunks made it into the top k? |
| **MRR** | How high does the first relevant chunk rank? |
| **NDCG** | How good is the ordering, with graded relevance? |

- **Re-ranking** is a second stage: retrieve about 50 candidates fast, re-score them with a cross-encoder, keep the best 5. It raises precision and adds latency. It **cannot** bring back a document the first stage missed.
- **Hybrid search** (vector plus keyword) helps with exact terms: SKUs, error codes, names.
- Per-customer facts (order status, delivery date) belong in a **structured lookup** by key, not in a vector index of policies.

## 🛠️ Application Development · 30%

| Decision | What the exam expects |
|---|---|
| Framework | Plain SDK for one call, **LangChain** for RAG chains, **LangGraph** for stateful looping agents, **MLflow** for tracing and logging any of them |
| LLM | The **smallest model that meets the quality bar** on your evaluation set, within latency, cost, context window and license |
| Embedding model | Context length at least the chunk size, no bigger than needed. The **same model** for indexing and querying |
| Agent authoring | Wrap the agent in MLflow **`ResponsesAgent`** (`ChatAgent` is older), trace with `mlflow.<flavor>.autolog()` or `@mlflow.trace` |

- Augment prompts from the user's input: extract key fields (IDs, dates) for **filters**, detect intent to route, rewrite follow-ups into standalone queries.
- Guardrails sit on **input** (safety classifier, injection detection, length limits) and **output** (PII masking, format and groundedness checks). A system prompt alone is not a guardrail.
- Structured data questions in a multi-agent system go to a **Genie space** (Conversation API, managed MCP or Multi-Agent Supervisor), not to an LLM writing raw SQL.

## 🚀 Assembling and Deploying · 22%: the app as a model

A RAG app is logged as an MLflow model, registered in Unity Catalog and served. Know what each argument is for.

```viz code
title: log and register a RAG chain
lang: python
---
mlflow.set_registry_uri("databricks-uc")
with mlflow.start_run():
    info = mlflow.langchain.log_model(
        lc_model="chain.py",
        name="support_bot",
        input_example={"messages": [{"role": "user", "content": "Reset password?"}]},
        resources=[DatabricksServingEndpoint(endpoint_name="databricks-meta-llama-3-3-70b-instruct"),
                   DatabricksVectorSearchIndex(index_name="main.rag.docs_index")],
        pip_requirements=["databricks-langchain", "mlflow"],
    )
mlflow.register_model(info.model_uri, "main.rag.support_bot")
---
1 | Registry | Register to Unity Catalog, so the model name is `catalog.schema.model`.
3-5 | Flavor | Code-based logging of a LangChain chain. Use `pyfunc` when you need custom pre- and post-processing (PII masking, citations).
6 | Input example | Used to infer the **signature**. Unity Catalog requires a signature.
7-8 | Resources | Declared endpoints and indexes get **automatic authentication passthrough** with short-lived credentials. Forget them and the endpoint cannot reach the index.
9 | Dependencies | Lets serving rebuild the environment.
11 | Register | Creates a new version of `main.rag.support_bot`.
```

Serving: **pay-per-token** Foundation Model APIs for prototypes and variable traffic, **provisioned throughput** for a production SLA, **on-behalf-of-user** auth when each user's permissions must apply. Secrets for external APIs come from Databricks secrets, never hard-coded tokens.

## 🔎 Vector Search and production patterns

| Requirement | Choose |
|---|---|
| Source already in Delta | **Delta Sync** index (managed or self-managed embeddings). Direct Vector Access only for API writes |
| Data changes daily | **TRIGGERED** sync, call `sync()` after the load. CONTINUOUS costs all the time |
| Searchable within seconds | **CONTINUOUS** sync on a **standard** endpoint |
| Billions of vectors, cost first, ~hundreds of ms OK | **Storage-optimized** endpoint (no continuous sync) |

- **`ai_query()`** for batch over many rows (a job over millions of tickets), a serving endpoint for real-time requests.
- **MLflow Prompt Registry**: versions are immutable, move an **alias** (`production`) to promote or roll back.
- **MCP**: prefer managed servers (UC functions, Vector Search, Genie), then external ones via a UC connection, custom ones hosted on Databricks Apps last.
- Cross-session memory in **Lakebase**, analytical history in Delta. Internal UIs on **Databricks Apps**, tokens stay server-side.

## 🛡️ Governance · 8%

- **Mask PII before the LLM** when the task does not need it: fewer tokens, less risk, same quality. Mask it in logs and inference tables too.
- **Prompt injection** can hide in retrieved documents. Treat retrieved text as data, filter input with safety guardrails, and give tools least-privilege credentials.
- **Licensing**: public web content is not automatically free to use. Check document and model licenses, keep license and source in chunk metadata.
- **Problematic text** in a source (toxic, outdated, confidential): fix or exclude it at the source before indexing. Output filters are a safety net, not the fix.

## 📈 Evaluation and Monitoring · 12%

```viz compare
{"title": "Two phases, different data and judges",
 "items": [
  {"icon": "🧪", "title": "Evaluation", "sub": "offline, before release", "color": "blue",
   "points": ["Curated eval set with **expectations**", "`mlflow.genai.evaluate()` with scorers", "**Correctness** and **RetrievalSufficiency** need ground truth", "Review App and SME labels"], "foot": "Output: ship or not"},
  {"icon": "📡", "title": "Monitoring", "sub": "online, in production", "color": "green",
   "points": ["Live traces, **no ground truth**", "RelevanceToQuery, RetrievalGroundedness, Safety, Guidelines", "Inference tables, usage tracking, rate limits", "Bad cases go back into the eval set"], "foot": "Output: alerts and fixes"}
 ]}
```

Custom scorers (`@scorer`) check rules such as format or citations. Cost levers: smaller model, `ai_query()` batch, shorter context, max tokens, rate limits, provisioned throughput only for steady volume.

## 🪤 Typical traps

- ❌ Increasing chunk overlap to get fewer chunks. ✅ More overlap gives more chunks. Larger chunks or less overlap give fewer.
- ❌ Expecting a TRIGGERED index to pick up changes by itself. ✅ It updates only when `sync()` runs.
- ❌ Fine-tuning to keep shipping dates current. ✅ Retrieve fresh facts with a structured lookup tool.
- ❌ Running Correctness on live traffic. ✅ Use judges that need no expectations in production.
- ❌ A Python loop calling an endpoint for 2 million rows. ✅ `ai_query()` in a scheduled job.
- ❌ Building a custom MCP server for Genie or UC functions. ✅ Use the managed MCP server.

## 🗓️ A study plan

```viz timeline
{"title": "Three weeks to exam-ready",
 "items": [
  {"label": "Days 1-3", "title": "Foundations", "color": "navy", "note": "Study **How LLMs work** and **Prompt engineering**. Read the official exam guide and list every objective you cannot explain yet."},
  {"label": "Days 4-6", "title": "Data preparation", "color": "bronze", "note": "Study **Parsing and chunking documents** and **Embeddings and Vector Search**. Memorise the parser per format and the index and endpoint choices."},
  {"label": "Days 7-10", "title": "RAG and agents", "color": "purple", "note": "Study **RAG architecture** and **Agents and tools**. Read chain and `ResponsesAgent` code until you can say what each line does."},
  {"label": "Days 11-13", "title": "Deploy and govern", "color": "teal", "note": "Study **Models in Unity Catalog**, **Model serving**, **AI Functions and AI Gateway** and **Row filters and column masks**. Focus on resources, auth and `ai_query()`."},
  {"label": "Days 14-16", "title": "Evaluate and monitor", "color": "green", "note": "Study **Evaluating GenAI apps** and **MLflow tracking**. Make a table of judges that need ground truth and those that do not."},
  {"label": "Days 17-21", "title": "Timed practice", "color": "red", "note": "Take full timed practice exams. Review **every** wrong answer, find the constraint you missed, and reread that topic before the next attempt."}
 ]}
```

## 🧭 Exam-day checklist

| Do | Why |
|---|---|
| Budget about 1.5 minutes per item | Up to 55 items in 90 minutes, including unscored ones |
| Underline the constraint (cost, freshness, latency, privacy) | It decides between two plausible designs |
| Check "select all that apply" wording | Multiple-selection items need every correct option |
| Flag and move on after 2 minutes | Easy points later are worth more than one hard item now |
| Map new names to exam names | AI Search is Vector Search, Genie Agents are Genie spaces |
