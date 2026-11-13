---
title: How LLMs work
summary: See what happens between a prompt and an answer. Tokens, the context window, next-token sampling, why models make things up, and how Databricks serves and bills foundation models.
icon: 🧠
level: Beginner
minutes: 10
group: Foundations
tags: [LLM, Tokens, Sampling, Foundation Model APIs]
---
# How LLMs work

> A large language model does one thing, over and over: given a sequence of tokens, it predicts a probability for every possible next token. Chat, summaries and agents are all built on that loop.

**The one idea to remember:** an LLM **predicts the next token** from the tokens it can see. It has no lookup and no memory between calls, so everything it should use must be inside the prompt.

## 💡 One token at a time

The model never sees letters or words. Text is split into **tokens**, each token becomes a number, and the model returns a probability for every token in its vocabulary. One token is picked, appended, and the loop runs again.

```viz flow
{"title": "From prompt to answer",
 "nodes": [{"icon": "📝", "title": "Prompt", "sub": "system + user text", "color": "blue"},
           {"icon": "🔤", "title": "Tokens", "sub": "IDs from a fixed vocabulary", "color": "teal"},
           {"icon": "🧠", "title": "Model", "sub": "scores every next token", "color": "purple"},
           {"icon": "🎲", "title": "Sampler", "sub": "temperature, top_p", "color": "amber"},
           {"icon": "💬", "title": "Text", "sub": "tokens decoded back", "color": "green"}],
 "edges": ["tokenize", "token IDs", "probabilities", "decode"],
 "steps": [{"label": "Tokenize", "focus": [0, 1], "note": "`My HomeHub is offline` becomes a list of token IDs. The same text always gives the same IDs for one model."},
           {"label": "Predict", "focus": [2], "note": "The model reads **all** tokens in the window and outputs one probability per vocabulary entry, often more than 100,000 numbers."},
           {"label": "Sample", "focus": [3], "note": "One token is chosen from that distribution. Settings like `temperature` decide how adventurous the choice is."},
           {"label": "Repeat", "focus": [1, 2, 3], "note": "The chosen token is appended to the input and the model runs again. An answer of 200 tokens means about 200 passes."},
           {"label": "Decode", "focus": [4], "note": "Generation stops at an end token or at `max_tokens`. The token IDs are turned back into text."}]}
```

## 🔤 Tokens and the context window

A tokenizer splits text into frequent pieces. Common words are one token, rare words and product names are several. In English, one token is roughly **4 characters** or **0.75 words**, so `words × 1.3` is a usable estimate.

```viz table
{"title": "Tokenizing \"The ThermoSense is offline.\"", "columns": ["piece", "token id", "why"],
 "rows": [["The", 791, "common word: one token"]],
 "steps": [{"label": "Common word", "note": "Frequent words get their own token. The leading space usually belongs to the next token."},
           {"label": "Rare name", "note": "`ThermoSense` is not in the vocabulary, so it is split into known pieces. Rare words cost more tokens.", "add": [[" Thermo", 42913, "known piece"], ["Sense", 51278, "known piece"]]},
           {"label": "Split word", "note": "Even ordinary words can split: ` offline` may be ` off` + `line`.", "add": [[" is", 374, "common word"], [" off", 1022, "piece"], ["line", 1056, "piece"], [".", 13, "punctuation"]]},
           {"label": "Count", "note": "7 tokens for 4 words. The IDs here are illustrative: every model family has its **own** tokenizer, so counts differ between models.", "hl": [1, 2, 4, 5]}]}
```

The **context window** is the maximum number of tokens one call can hold: system prompt, history, retrieved documents **and** the generated answer together. Anything outside the window does not exist for the model.

## 🎲 Sampling: temperature, top_p, max_tokens

After the prompt `The hub is`, suppose the model returns these probabilities. The sampler reshapes them before it picks one.

```viz table
{"title": "Next token after \"The hub is\"", "columns": ["next token", "probability", "comment"],
 "rows": [[" online", "0.50", ""], [" offline", "0.25", ""], [" ready", "0.15", ""], [" blinking", "0.07", ""], [" purple", "0.03", "unlikely, but possible"]],
 "steps": [{"label": "temperature = 1", "note": "The raw distribution. Sampling picks ` online` about half the time."},
           {"label": "temperature = 0.2", "note": "Low temperature sharpens the distribution: the top token wins about 97% of the time. Use low values for extraction, classification and JSON.", "upd": {"0": {"probability": "0.97"}, "1": {"probability": "0.03"}, "2": {"probability": "0.00"}, "3": {"probability": "0.00"}, "4": {"probability": "0.00"}}},
           {"label": "temperature = 1.5", "note": "High temperature flattens it. ` purple` now appears 6% of the time. More variety, more nonsense.", "upd": {"0": {"probability": "0.40"}, "1": {"probability": "0.25"}, "2": {"probability": "0.18"}, "3": {"probability": "0.11"}, "4": {"probability": "0.06"}}},
           {"label": "top_p = 0.8", "note": "Back at temperature 1, `top_p` keeps the smallest set of tokens whose probabilities add up to at least 0.8, then renormalizes. The long tail is cut off.", "upd": {"0": {"probability": "0.56"}, "1": {"probability": "0.28"}, "2": {"probability": "0.17"}, "3": {"probability": "0", "comment": "dropped"}, "4": {"probability": "0", "comment": "dropped"}}, "del": [3, 4]},
           {"label": "max_tokens", "note": "`max_tokens` does not change the pick. It only stops generation after N tokens, which caps cost and can cut an answer mid-sentence.", "hl": [0]}]}
```

Temperature 0 means **greedy decoding**: always take the top token. More repeatable, though not guaranteed identical on every serving stack.

## 🧠 What the model knows, and why it makes things up

| Way to teach a model | What changes | Good for |
|---|---|---|
| **Pretraining** | Weights, from trillions of tokens of public text | General language and world knowledge, frozen at a cutoff date |
| **Fine-tuning** | Weights, from your labelled examples | Style, format, a narrow task |
| **In-context learning** | Nothing: instructions, examples and documents go in the prompt | Fresh or private facts, quick iteration |

A model **hallucinates** because it is trained to produce a *plausible* continuation, not a *checked* one. If a fact is in neither its weights nor the prompt, it still writes fluent text. The fix is grounding: put the facts in the prompt (RAG), allow "I don't know", and evaluate.

## 💬 Messages: system, user, assistant

Chat models take a list of **messages**. Databricks serving endpoints accept the OpenAI-compatible chat format, so one request body works across models.

```viz code
title: POST /serving-endpoints/<endpoint>/invocations
lang: json
---
{
  "messages": [
    {"role": "system", "content": "You are a Casa support assistant. Answer in at most 3 sentences."},
    {"role": "user", "content": "My HomeHub shows as offline. What should I do?"},
    {"role": "assistant", "content": "Check the router, then unplug the hub for 30 seconds."},
    {"role": "user", "content": "I did that and it is still offline."}
  ],
  "max_tokens": 200,
  "temperature": 0.2
}
---
3 | system | Rules that apply to the whole conversation: role, scope, tone, format. Set by the developer, not the end user.
4 | user | What the person asked.
5 | assistant | An **earlier** answer. The model is stateless, so your app sends the whole history again on every call.
6 | user | The new question. The model answers this one, with turns 3 to 5 as context.
8-9 | parameters | Sampling settings from the previous slide. The response returns the text plus `usage`: `prompt_tokens` and `completion_tokens`.
```

## 🏗️ Foundation models on Databricks

**Foundation Model APIs** serve popular open and proprietary models behind serving endpoints in your workspace. Endpoint names look like `databricks-meta-llama-3-3-70b-instruct` or `databricks-claude-sonnet-4-5`. These are examples only: models are added and retired often, so check the **Serving** page.

```viz compare
{"title": "Three ways to call a model",
 "items": [{"icon": "🪙", "title": "Pay-per-token", "sub": "shared Databricks endpoints", "color": "blue",
            "points": ["✅ ready to use, nothing to deploy", "✅ billed per input and output token", "❌ shared capacity with rate limits", "Best for prototypes and variable traffic"]},
           {"icon": "🏭", "title": "Provisioned throughput", "sub": "dedicated capacity", "color": "purple",
            "points": ["✅ guaranteed throughput and latency", "✅ can serve fine-tuned models", "❌ billed per hour while it runs", "Best for steady production load"]},
           {"icon": "🌐", "title": "External models", "sub": "OpenAI, Anthropic, Google and others", "color": "teal",
            "points": ["✅ one governed endpoint for a third-party API", "✅ key stored in Databricks secrets", "❌ data leaves to the provider", "Billed by the provider"]}]}
```

## 💸 Cost and latency drivers

| Driver | Effect |
|---|---|
| **Input tokens** | Prompt, history and retrieved context, billed on **every** call |
| **Output tokens** | Usually priced higher than input, and generated one by one, so they dominate latency |
| **Model size** | Bigger models cost more per token and answer slower |
| **Prompt length** | Longer input means a longer wait before the **first** token |

Shorter prompts, fewer retrieved chunks, a capped `max_tokens` and the smallest model that passes your evaluation are the main levers.

## 🧪 Try it: a toy tokenizer and sampler

```dataset support
```

No model needed: plain Python with a fixed seed, so results repeat.

```python run
# A toy tokenizer: greedy longest match over a tiny vocabulary
VOCAB = ["The", " hub", " is", " on", " off", "line", " Thermo", "Sense", " ther", "mo", "stat", "."]

def tokenize(text, vocab=VOCAB):
    by_len = sorted(vocab, key=len, reverse=True)
    tokens, i = [], 0
    while i < len(text):
        piece = next((v for v in by_len if text.startswith(v, i)), text[i])   # unknown: one character
        tokens.append(piece)
        i += len(piece)
    return tokens

for s in ["The hub is offline.", "The ThermoSense is offline.", "The thermostat is online."]:
    t = tokenize(s)
    print(f"{len(t):>2} tokens  {t}")
```

```python run
# A toy sampler: how temperature and top_p reshape the next-token distribution
import random
from collections import Counter

NEXT = {" online": 0.50, " offline": 0.25, " ready": 0.15, " blinking": 0.07, " purple": 0.03}

def adjust(probs, temperature=1.0, top_p=1.0):
    scaled = {t: p ** (1 / temperature) for t, p in probs.items()}   # same as softmax(logits / T)
    total = sum(scaled.values())
    ranked = sorted(((t, p / total) for t, p in scaled.items()), key=lambda x: -x[1])
    kept, cum = [], 0.0
    for t, p in ranked:                     # nucleus: smallest set that reaches top_p
        kept.append((t, p))
        cum += p
        if cum >= top_p:
            break
    z = sum(p for _, p in kept)
    return {t: p / z for t, p in kept}

rng = random.Random(42)
for T, top_p in [(0.2, 1.0), (1.0, 1.0), (1.5, 1.0), (1.0, 0.8)]:
    probs = adjust(NEXT, T, top_p)
    picks = Counter(rng.choices(list(probs), weights=list(probs.values()), k=1000))
    print(f"T={T:<4} top_p={top_p:<4}", {t.strip(): picks[t] for t in NEXT})
```

```sql run
-- Estimate tokens per knowledge-base article with the words x 1.3 rule
SELECT article_id, title,
       size(split(body, ' '))             AS words,
       length(body)                       AS chars,
       ceil(size(split(body, ' ')) * 1.3) AS est_tokens
FROM kb_articles
ORDER BY est_tokens DESC
LIMIT 10;
```

> Calling a real model needs a workspace with Foundation Model APIs and `CAN QUERY` on the endpoint, and it costs money. This is what the call looks like (display only): `client = WorkspaceClient().serving_endpoints.get_open_ai_client()` then `client.chat.completions.create(model="<endpoint>", messages=[...], max_tokens=200)`.

## Exercise 1: greedy decoding

`adjust(NEXT, temperature=0)` fails with a division by zero. Add a special case so that temperature 0 always returns the single most likely token. Predict the counts for 1,000 samples before you run it.

```python todo
# TODO 1: write greedy(probs) that returns {best_token: 1.0}
# TODO 2: sample 1,000 times from greedy(NEXT) and print the Counter
```

```python solution
def greedy(probs):
    best = max(probs, key=probs.get)
    return {best: 1.0}

probs = greedy(NEXT)
print(Counter(random.Random(0).choices(list(probs), weights=list(probs.values()), k=1000)))
# Counter({' online': 1000}): the same token every time. Repeatable, but never ' offline', even when it is right.
```

## Exercise 2: what does a batch job cost?

You want a one-sentence summary for every ticket. Assume an instruction of 30 tokens per call and 40 output tokens per summary. Estimate input and output tokens with `words × 1.3`, then price them with the **example** rates of 0.50 per million input tokens and 1.50 per million output tokens. Which side dominates?

```sql todo
-- TODO: count tickets, total input tokens (30 + body tokens), total output tokens (40 per ticket),
--       and the cost of each side with the example prices
```

```sql solution
SELECT count(*)                                                       AS tickets,
       sum(30 + ceil(size(split(body, ' ')) * 1.3))                   AS input_tokens,
       count(*) * 40                                                  AS output_tokens,
       round(sum(30 + ceil(size(split(body, ' ')) * 1.3)) * 0.50 / 1e6, 4) AS input_cost,
       round(count(*) * 40 * 1.50 / 1e6, 4)                           AS output_cost
FROM tickets;
-- About 92,000 input and 80,000 output tokens: the output side costs more than twice as much.
-- Nothing to clean up: this module creates no tables.
```

## ⚠️ Common mistakes

- ❌ "The model remembers our last chat." Each call is independent. The app resends the history.
- ❌ "Temperature 0 makes answers correct." It makes them repeatable. A wrong guess is repeated too.
- ❌ "A token is a word." Rare words, names and code split into several tokens, and counts differ per model.
- ❌ Forgetting that the answer shares the context window with the prompt.
- ✅ Ground facts in the prompt, cap `max_tokens`, and measure token usage from the response.

## 🧭 Cheat sheet

| Term | Meaning |
|---|---|
| Token | A piece of text with an ID; about 4 characters of English |
| Context window | Max tokens per call, prompt and output together |
| `temperature` / `top_p` | Sharpen or flatten the distribution / cut its tail |
| `max_tokens` | Hard stop on output length and cost |
| Pay-per-token / provisioned | Shared and billed per token / dedicated and billed per hour |
| Hallucination | Plausible text without grounding; fix with context and evaluation |
