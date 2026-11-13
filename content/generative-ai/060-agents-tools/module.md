---
title: Agents and tools
summary: See how an agent really works. The tool-calling loop, tool definitions and why their descriptions matter, Unity Catalog functions and MCP as governed tools, the Agent Framework, and the limits that keep an agent safe.
icon: 🤖
level: Intermediate
minutes: 12
group: Agents
tags: [Agents, Tool calling, Unity Catalog functions, MCP, Agent Framework]
---
# Agents and tools

> A chain runs the same steps every time. An agent lets the model choose the next step: which tool to call, with which arguments, and when to stop. Your code still runs every tool.

**The one idea to remember:** the model never executes anything. It **asks** for a tool call as JSON, your code runs it and sends the result back, and this loop repeats until the model writes a final answer.

## 💡 Chain, agent, multi-agent

```viz compare
{"title": "How much does the model decide?",
 "items": [{"icon": "⛓️", "title": "Chain", "sub": "fixed steps in code", "color": "blue",
            "points": ["✅ predictable, cheap, easy to evaluate", "✅ retrieve, prompt, generate", "❌ cannot react to what a step returned", "Start here"]},
           {"icon": "🤖", "title": "Single agent", "sub": "one model plus a few tools", "color": "purple",
            "points": ["✅ steps depend on intermediate results", "✅ one prompt, one tool list", "❌ more calls, more tokens, less predictable", "Use when the path is not known in advance"]},
           {"icon": "🧑‍🤝‍🧑", "title": "Multi-agent", "sub": "supervisor or router", "color": "teal",
            "points": ["✅ specialists: Genie for tables, RAG for documents", "✅ each agent keeps a short tool list", "❌ hardest to debug and evaluate", "Agent Bricks offers a Multi-Agent Supervisor"]}]}
```

Pick the simplest design that meets the requirement. A three-step pipeline that never changes does not need an agent.

## 🔁 The tool-calling loop

```viz flow
{"title": "One agent run",
 "nodes": [{"icon": "🙋", "title": "Question", "sub": "system + user messages", "color": "blue"},
           {"icon": "🧠", "title": "Model", "sub": "sees messages and tool definitions", "color": "purple"},
           {"icon": "📞", "title": "Tool call", "sub": "name + JSON arguments", "color": "amber"},
           {"icon": "⚙️", "title": "Your code", "sub": "runs the function", "color": "teal"},
           {"icon": "✅", "title": "Final answer", "sub": "no more tool calls", "color": "green"}],
 "edges": ["messages", "decides", "executes", "result"],
 "steps": [{"label": "Ask", "focus": [0, 1], "note": "The request holds the messages **and** the list of tool definitions. The model only knows the tools you list."},
           {"label": "Decide", "focus": [1, 2], "note": "Instead of text, the model returns a tool call: `ticket_stats` with arguments `{\"product\": \"HomeHub\"}`. This is the thought turned into an action."},
           {"label": "Execute", "focus": [3], "note": "Your code parses the arguments, checks them, and runs the real function: a SQL query, a search, an API call."},
           {"label": "Observe", "focus": [1, 3], "note": "The result goes back as a `tool` message, and the model is called **again** with the longer history."},
           {"label": "Answer", "focus": [4], "note": "When the model has enough facts it returns plain text. Your loop stops there, or at a maximum number of steps."}]}
```

## 🧰 A tool definition

The model chooses a tool by reading its **name**, **description** and **parameter schema**. These are sent with every request in the OpenAI-compatible `tools` format.

```viz code
title: tools: one definition
lang: json
---
{"type": "function",
 "function": {
   "name": "ticket_stats",
   "description": "Count support tickets for ONE product: total, open and high priority. Use for questions about ticket volume. Do not use for how-to answers: use search_kb.",
   "parameters": {
     "type": "object",
     "properties": {
       "product": {"type": "string",
                   "enum": ["AquaLeak", "DoorGuard", "HomeHub", "LumaBulb", "PlugMate", "ThermoSense"]}},
     "required": ["product"]}}}
---
3 | name | One action, in words. `ticket_stats` beats `data_tool`.
4 | description | The most important line. Say **when** to use it, when **not** to, and which tool to use instead. Overlapping descriptions make the model pick the wrong tool.
5-9 | parameters | A JSON schema. An `enum` lists the exact allowed values, so the model does not send `homehub` or `Home Hub`.
10 | required | The model must fill these. Your code still validates them: a schema guides the model, it does not guarantee its output.
```

## 📨 The message list grows

The model is stateless, so every call resends the whole list. Here is one run for "How many HomeHub tickets are open, and how do I fix it when it is offline?"

```viz table
{"title": "messages", "columns": ["#", "role", "content"],
 "rows": [[1, "system", "You are a Casa support agent. Use tools, then answer briefly."], [2, "user", "How many HomeHub tickets are open, and how do I fix it when offline?"]],
 "steps": [{"label": "Start", "note": "Two messages plus the tool definitions go to the model."},
           {"label": "Call 1", "note": "The model answers with a tool call, not text. The arguments are a JSON **string** that your code must parse.", "add": [[3, "assistant", "tool_calls: ticket_stats({\"product\": \"HomeHub\"}) id=call_1"]]},
           {"label": "Result 1", "note": "Your code runs the query and appends a `tool` message. `tool_call_id` links it to the call.", "add": [[4, "tool", "call_1 → {\"tickets\": 328, \"open_tickets\": 54}"]]},
           {"label": "Call 2", "note": "Called again, now with four messages, the model asks for the second tool.", "add": [[5, "assistant", "tool_calls: search_kb({\"query\": \"HomeHub offline\"}) id=call_2"]]},
           {"label": "Result 2", "note": "Keep tool results compact: titles and ids, not whole tables. Every token is resent on the next call.", "add": [[6, "tool", "call_2 → [{\"article_id\": 2, \"title\": \"HomeHub: Device shows as offline\"}]"]]},
           {"label": "Answer", "note": "No tool call this time: the loop ends. Three model calls for one question, which is why agents cost more than chains.", "add": [[7, "assistant", "HomeHub has 54 open tickets. For offline devices, follow article 2."]], "hl": [6]}]}
```

## 🏛️ Governed tools: UC functions and MCP

| Tool source | How the agent gets it | Governed by |
|---|---|---|
| **Unity Catalog function** (SQL or Python) | Function comment becomes the description | `EXECUTE` privilege on the function |
| **Vector Search index** | Retriever tool | `SELECT` on the index |
| **Genie space** | Questions over curated tables | Genie and table permissions |
| **External API** | External MCP server via a UC connection | Connection privileges, secrets |

The **Model Context Protocol (MCP)** is a standard way for an agent to discover tools (`tools/list`) and call them (`tools/call`). Databricks hosts **managed MCP servers** for UC functions, Vector Search and Genie, so you do not wrap them yourself. Your own tools can run as a custom MCP server on Databricks Apps.

## 🏗️ Author, log and deploy with Agent Framework

Write the loop with any library and wrap it in MLflow's **`ResponsesAgent`** interface (`ChatAgent` is the older one). Then log, register and deploy. Display only: it needs a model endpoint.

```python
# import mlflow; from mlflow.models.resources import DatabricksServingEndpoint, DatabricksFunction; from databricks import agents
info = mlflow.pyfunc.log_model(name="support_agent", python_model="agent.py",   # code-based logging
                               resources=[DatabricksServingEndpoint(endpoint_name="databricks-claude-sonnet-4-5"),
                                          DatabricksFunction(function_name="main.support.agent_ticket_count")])
v = mlflow.register_model(info.model_uri, "main.support.support_agent").version
agents.deploy("main.support.support_agent", v)    # endpoint, review app, inference tables
```

The declared **resources** let the endpoint get short-lived credentials for exactly those objects. **MLflow Tracing** records each model call and tool call as a span, so you can see which step failed. Endpoint names are examples and change over time.

## 🛡️ Limits and guardrails

An agent turns model output into actions, so the controls belong in **your code**, not only in the prompt.

- **Max iterations** and a repeated-call check: a confused model can loop forever and burn tokens.
- **Least privilege**: tools run with narrow credentials, or **on behalf of the user** so each user sees only their own data.
- **Validate arguments** against the schema and return an error message instead of crashing.
- **Human approval** before irreversible actions (refunds, deletes, emails). Gather facts first, act last.
- **Treat tool results as data**: text from documents or APIs may contain instructions, and must not change what the agent is allowed to do.

## 🧪 Try it: an agent loop without a model

```dataset support
```

Two real tools. `ticket_stats` uses a **parameter marker** (`:product`), so the model's argument is never pasted into SQL text.

```python run
# Two tools: TF-IDF search over the knowledge base, and ticket counts from Spark SQL
import json
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

kb = spark.sql("SELECT article_id, title, body FROM kb_articles ORDER BY article_id").toPandas()
vectorizer = TfidfVectorizer(stop_words="english")
kb_matrix = vectorizer.fit_transform(kb["title"] + " " + kb["body"])

def search_kb(query, k=2):
    scores = cosine_similarity(vectorizer.transform([query]), kb_matrix)[0]
    return [{"article_id": int(kb.article_id.iloc[i]), "title": kb.title.iloc[i]} for i in scores.argsort()[::-1][:k]]

def ticket_stats(product):
    sql = "SELECT count(*) AS tickets, count_if(NOT resolved) AS open_tickets FROM tickets WHERE product = :product"
    return spark.sql(sql, args={"product": product}).first().asDict()

TOOLS = {"search_kb": search_kb, "ticket_stats": ticket_stats}
PRODUCTS = sorted(r["product"] for r in spark.sql("SELECT DISTINCT product FROM kb_articles").collect())
print(search_kb("HomeHub offline"))
print(ticket_stats("HomeHub"))
```

A scripted "fake model" stands in for the LLM. Its rules are trivial, but it speaks the real protocol: it reads the messages and tool definitions and returns `tool_calls` or text.

```python run
# A fake model and the agent loop
TOOL_DEFS = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object",
              "properties": {p: {"type": "string"}}, "required": [p]}}} for n, d, p in [
    ("search_kb", "Search knowledge-base articles for how-to and troubleshooting answers.", "query"),
    ("ticket_stats", "Count tickets for one product: total and open.", "product")]]

def fake_model(messages, tools):
    q = messages[1]["content"].lower()
    offered = {t["function"]["name"] for t in tools}
    called = {c["function"]["name"] for m in messages for c in m.get("tool_calls") or []}
    product = next((p for p in PRODUCTS if p.lower() in q), None)
    plan = [("ticket_stats", {"product": product})] if product and "how many" in q else []
    plan += [("search_kb", {"query": q})] if "how do" in q else []
    for name, args in plan:
        if name in offered and name not in called:      # ask for the next tool: JSON arguments as a string
            return {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{len(called) + 1}",
                    "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
    facts = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
    return {"role": "assistant", "content": " ".join(
        f"{product} has {f['open_tickets']} open tickets." if isinstance(f, dict) else f"See: {f[0]['title']}."
        for f in facts) or "I do not know."}

def run_agent(question, model=fake_model, tools=TOOL_DEFS, max_steps=5):
    messages = [{"role": "system", "content": "You are a Casa support agent."}, {"role": "user", "content": question}]
    for step in range(1, max_steps + 1):
        reply = model(messages, tools)
        messages.append(reply)
        if not reply.get("tool_calls"):
            print(f"step {step}: final answer: {reply['content']}")
            return messages
        for call in reply["tool_calls"]:
            name, args = call["function"]["name"], json.loads(call["function"]["arguments"])
            result = TOOLS[name](**args)                  # YOUR code runs the tool
            print(f"step {step}: {name}({args}) -> {result}")
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
    print(f"stopped: no final answer after {max_steps} steps")
    return messages

msgs = run_agent("How many HomeHub tickets are open, and how do I fix it when it is offline?")
print([m["role"] for m in msgs])
```

Now a governed tool: a Unity Catalog function. Its comments are what an agent reads as the description.

```python run
# Create a UC SQL function that an agent could use as a tool
spark.sql(f"""
CREATE OR REPLACE FUNCTION agent_ticket_count(
  product STRING COMMENT 'Exact product name, for example HomeHub')
RETURNS BIGINT
COMMENT 'Number of support tickets for one product. Use for ticket volume questions.'
RETURN (SELECT count(*) FROM `{CATALOG}`.`{SCHEMA}`.tickets t WHERE t.product = agent_ticket_count.product)
""")
display(spark.sql("DESCRIBE FUNCTION EXTENDED agent_ticket_count"))
```

```sql run
-- Call the function like any SQL function
SELECT agent_ticket_count('HomeHub') AS homehub, agent_ticket_count('PlugMate') AS plugmate;
```

> A real agent needs a model serving endpoint (Foundation Model APIs) and, for MCP, the managed UC functions MCP server. Both cost money, so they are not used here. Other users would need `EXECUTE` on the function.

## Exercise 1: stop a stuck agent

This scripted model is broken: it repeats the same tool call forever. Write `run(model, max_steps)` that stops at the step limit, and **early** when a call repeats with the same name and arguments. Predict how many SQL queries run with `max_steps=10`.

```python todo
import json

def stuck_model(messages):
    return {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{len(messages)}", "type": "function",
            "function": {"name": "open_tickets", "arguments": json.dumps({"product": "HomeHub"})}}]}

def open_tickets(product):
    return spark.sql("SELECT count_if(NOT resolved) AS n FROM tickets WHERE product = :p", args={"p": product}).first()["n"]

# TODO 1: write run(model, max_steps) with a step limit
# TODO 2: remember (name, arguments) pairs and stop with a reason when one repeats
```

```python solution
def run(model, max_steps=10):
    messages, seen = [{"role": "user", "content": "How many HomeHub tickets are open?"}], set()
    for step in range(1, max_steps + 1):
        reply = model(messages)
        messages.append(reply)
        call = reply["tool_calls"][0]
        key = (call["function"]["name"], call["function"]["arguments"])
        if key in seen:
            return f"stopped at step {step}: repeated call {key}"
        seen.add(key)
        args = json.loads(call["function"]["arguments"])
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(open_tickets(**args))})
    return f"stopped: step limit {max_steps}"

print(run(stuck_model))
# One query runs. Without the repeat check, the step limit alone would allow 10 queries and 10 model calls.
```

## Exercise 2: a second UC tool

Create `agent_open_tickets(product STRING)` that returns the number of **unresolved** tickets, with a comment on the function and on the parameter. Call it for `HomeHub` and for `homehub`. Why does the second call return 0, and what in a tool definition prevents that mistake?

```python todo
# TODO 1: CREATE OR REPLACE FUNCTION agent_open_tickets(...) with COMMENTs, using {CATALOG}.{SCHEMA}.tickets
# TODO 2: SELECT it for 'HomeHub' and 'homehub', then DESCRIBE FUNCTION EXTENDED
```

```python solution
spark.sql(f"""
CREATE OR REPLACE FUNCTION agent_open_tickets(
  product STRING COMMENT 'Exact product name: AquaLeak, DoorGuard, HomeHub, LumaBulb, PlugMate or ThermoSense')
RETURNS BIGINT
COMMENT 'Number of unresolved support tickets for one product.'
RETURN (SELECT count(*) FROM `{CATALOG}`.`{SCHEMA}`.tickets t
        WHERE t.product = agent_open_tickets.product AND NOT t.resolved)
""")
display(spark.sql("SELECT agent_open_tickets('HomeHub') AS exact, agent_open_tickets('homehub') AS lowercase"))
display(spark.sql("DESCRIBE FUNCTION EXTENDED agent_open_tickets"))
# String comparison is case-sensitive, so 'homehub' matches nothing. Listing the exact values
# (an enum in the schema, or in the comment) tells the model what it may send.
# Clean-up:
# spark.sql("DROP FUNCTION IF EXISTS agent_open_tickets")
# spark.sql("DROP FUNCTION IF EXISTS agent_ticket_count")
```

## ⚠️ Common mistakes

- ❌ Thinking the model runs the tool. It only proposes a call; your code executes it.
- ❌ Two tools with overlapping descriptions such as "gets order information". The model guesses.
- ❌ Returning whole tables from a tool. The result is resent on every later call.
- ❌ No step limit, no argument checks, broad credentials. Prompt instructions alone are not a guardrail.
- ✅ Few focused tools, an `enum` for fixed values, compact results, traces for every step.

## 🧭 Cheat sheet

| Term | Meaning |
|---|---|
| Tool definition | Name, description, JSON schema of the parameters |
| Tool call / `tool` message | Model asks for a function with JSON arguments / your code sends the result back |
| UC function | Governed tool; the comment is the description, `EXECUTE` controls use |
| MCP | Standard for tool discovery and calls; managed servers for UC functions, Vector Search, Genie |
| `ResponsesAgent` | MLflow interface for agents; log with resources, register in UC, `agents.deploy()` |
| Guardrails | Max steps, validation, least privilege, human approval |
