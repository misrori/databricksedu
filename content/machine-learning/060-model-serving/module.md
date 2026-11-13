---
title: Model serving
summary: Choose between batch, streaming and real-time inference, score a whole table with a Spark UDF, and understand what a Model Serving endpoint builds, how it routes traffic between versions, and what it logs.
icon: 🚀
level: Intermediate
minutes: 11
group: Deployment
tags: [Model Serving, Batch inference, spark_udf, Traffic split]
---
# Model serving

> A registered model does nothing until something calls `predict`. That can be a nightly job over every subscriber, a stream of events, or an app that needs an answer in 50 milliseconds. The model is the same; the serving pattern is not.

**The one idea to remember:** pick the **slowest pattern the business can accept**. Batch is cheapest and simplest; a real-time endpoint is for when someone is waiting for the answer.

## ⚖️ Batch, streaming or real-time

```viz compare
{"items": [
 {"icon": "🗓️", "title": "Batch", "sub": "minutes to hours", "color": "blue",
  "points": ["✅ Cheapest per prediction, highest throughput", "Scheduled Lakeflow Job", "`spark_udf`, `fe.score_batch`", "Nightly churn scores for the retention team"]},
 {"icon": "🌊", "title": "Streaming", "sub": "seconds to minutes", "color": "teal",
  "points": ["Structured Streaming or a declarative pipeline", "The same `spark_udf`, applied to a streaming DataFrame", "No network hop per record", "Scoring usage events as they arrive"]},
 {"icon": "⚡", "title": "Real-time", "sub": "milliseconds per request", "color": "purple",
  "points": ["Mosaic AI Model Serving endpoint (REST)", "Autoscaling, always available", "❌ Highest cost per prediction", "A churn-risk check while the customer is on the phone"]}
 ]}
```

Most use cases are batch. A real-time endpoint for a job that scores 5,000 rows once a night is wasted money.

## 📊 Batch scoring with a Spark UDF

`mlflow.pyfunc.spark_udf` wraps any MLflow model as a vectorised pandas UDF. Each executor loads the model **once** and scores Arrow batches of rows.

```python
from pyspark.sql.functions import struct
predict = mlflow.pyfunc.spark_udf(spark, f"models:/{CATALOG}.{SCHEMA}.churn_model@champion", result_type="double")
scores = spark.table("subscribers").withColumn("churn_score", predict(struct(*FEATURES)))
scores.write.mode("overwrite").saveAsTable("churn_scores")
```

- The same UDF works on a **streaming** DataFrame inside a pipeline.
- For data that fits in memory, `mlflow.pyfunc.load_model(uri).predict(pdf)` is enough.
- SQL users can call an existing endpoint row by row with `ai_query('churn-endpoint', ...)`. That needs a running endpoint.

## 🧾 What an endpoint is

```viz code
title: POST /api/2.0/serving-endpoints (display-only)
lang: json
---
{"name": "churn-endpoint",
 "config": {
   "served_entities": [
     {"name": "champion", "entity_name": "prod.ml.churn_model", "entity_version": "3",
      "workload_size": "Small", "scale_to_zero_enabled": false},
     {"name": "challenger", "entity_name": "prod.ml.churn_model", "entity_version": "4",
      "workload_size": "Small", "scale_to_zero_enabled": false}],
   "traffic_config": {"routes": [
     {"served_model_name": "champion", "traffic_percentage": 90},
     {"served_model_name": "challenger", "traffic_percentage": 10}]}},
 "ai_gateway": {"inference_table_config": {"enabled": true,
                "catalog_name": "prod", "schema_name": "ml"}}}
---
1 | name | The URL becomes `/serving-endpoints/churn-endpoint/invocations`.
3-5 | served entity | A model version from Unity Catalog. Databricks builds a **container** from the model's logged environment (`requirements.txt`, `conda.yaml`). If a package fails to install, the build logs say why.
5 | size and scaling | Workload size sets concurrency. Scale to zero saves money when idle, but the first request waits for a cold start.
6-7 | second entity | One endpoint can serve several versions side by side.
8-10 | traffic split | Percentages per served entity; they must add up to 100. Clients never see the split.
11-12 | inference table | Requests and responses are logged to a Delta table in Unity Catalog, the input for monitoring.
```

## 🛣️ The path of one request

```viz flow
{"nodes": [
  {"icon": "📱", "title": "Client", "sub": "app, job, ai_query", "color": "gray"},
  {"icon": "🚪", "title": "Endpoint", "sub": "auth + traffic split", "color": "navy"},
  {"icon": "📦", "title": "Served model", "sub": "container, pyfunc predict", "color": "purple"},
  {"icon": "📨", "title": "Response", "sub": "{\"predictions\": [...]}", "color": "green"},
  {"icon": "🗄️", "title": "Inference table", "sub": "Delta, in UC", "color": "amber"}
 ],
 "edges": ["POST JSON", "90 % / 10 %", "predictions", "logged"],
 "steps": [
  {"label": "Request", "focus": [0], "note": "The client sends JSON with a bearer token in the `Authorization` header, for example `{\"dataframe_split\": {\"columns\": [...], \"data\": [[...]]}}`."},
  {"label": "Route", "focus": [1], "note": "The endpoint checks the token and picks a served entity according to the traffic percentages."},
  {"label": "Predict", "focus": [2], "note": "The served model checks the input against its **signature**, then runs `predict`. A model logged with `fe.log_model` also looks up features from the online store."},
  {"label": "Answer", "focus": [3], "note": "The response returns to the client. Autoscaling adds capacity when concurrent requests rise."},
  {"label": "Log", "focus": [4], "note": "The request, the response and which served entity answered are written to the inference table, a little later, for monitoring and debugging."}
 ]}
```

```bash
curl -X POST "https://<workspace-host>/serving-endpoints/churn-endpoint/invocations" \
  -H "Authorization: Bearer $DATABRICKS_TOKEN" -H "Content-Type: application/json" \
  -d '{"dataframe_records": [{"contract": "Monthly", "plan": "Basic", "tenure_months": 3, "monthly_fee": 21.5, "support_calls_90d": 6, "payment_failures_6m": 2, "avg_weekly_minutes": 120.0}]}'
```

## 🔀 Rolling out a new version

```viz table
{"title": "traffic_config of churn-endpoint", "columns": ["stage", "champion v3", "challenger v4", "what you watch"],
 "rows": [["start", "100 %", "0 %", ""]],
 "steps": [
  {"label": "Before", "note": "Version 4 is registered and validated offline. It is added as a second served entity at 0 %, so it can be tested directly without user traffic."},
  {"label": "Canary 10 %", "note": "One config update, no downtime: the old config serves until the new one is ready.", "add": [["canary", "90 %", "10 %", "errors, latency"]], "hl": [1]},
  {"label": "50 / 50", "note": "An A/B split. The inference table shows which entity answered each request, so you can compare them once labels arrive.", "add": [["A/B", "50 %", "50 %", "model metrics per entity"]], "hl": [2]},
  {"label": "Promote", "note": "All traffic goes to v4. Remove the old entity later; until then, rollback is one more config update.", "add": [["promoted", "0 %", "100 %", "keep monitoring"]], "hl": [3]},
  {"label": "Size both", "note": "During a canary, size the challenger for the traffic it **may** get, not only today's 10 %. Disable scale to zero for latency-critical endpoints."}
 ]}
```

## 🧩 Custom pyfunc models

When the model needs pre- or post-processing, returns a probability instead of a class, or combines several models, wrap it in `mlflow.pyfunc.PythonModel`:

```python
class ChurnProba(mlflow.pyfunc.PythonModel):
    def __init__(self, pipeline):
        self.pipeline = pipeline            # pickled together with the wrapper
    def predict(self, context, model_input, params=None):
        return self.pipeline.predict_proba(model_input)[:, 1]   # P(churn), not 0/1
```

- Heavy files (indexes, tokenizers) go in `artifacts={...}` and are loaded once in `load_context`.
- The signature describes the **raw** input, so clients send raw columns and the model does the rest.
- The same object is used in batch, in tests and on the endpoint: one code path, no training-serving skew.

## 🧪 Try it: batch inference

```dataset churn
```

```python run
# Train a pipeline and log it as a pyfunc that returns P(churn)
import mlflow
from mlflow.models import infer_signature
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression

NUM = ["tenure_months", "monthly_fee", "support_calls_90d", "payment_failures_6m", "avg_weekly_minutes"]
CAT = ["contract", "plan"]
FEATURES = CAT + NUM
pdf = spark.table("subscribers").toPandas()
prep = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CAT), ("num", StandardScaler(), NUM)])
pipeline = make_pipeline(prep, LogisticRegression(max_iter=1000)).fit(pdf[FEATURES], pdf["churned"])

class ChurnProba(mlflow.pyfunc.PythonModel):
    def __init__(self, pipeline, features):
        self.pipeline, self.features = pipeline, features
    def predict(self, context, model_input, params=None):
        return self.pipeline.predict_proba(model_input[self.features])[:, 1]

wrapper = ChurnProba(pipeline, FEATURES)
X = pdf[FEATURES]
mlflow.sklearn.autolog(disable=True)
with mlflow.start_run(run_name="serving_batch") as run:
    mlflow.pyfunc.log_model("model", python_model=wrapper, input_example=X.head(3),
                            signature=infer_signature(X, wrapper.predict(None, X)))
model_uri = f"runs:/{run.info.run_id}/model"
print(model_uri)
```

```python run
# Score every subscriber with a Spark UDF and save the result
from pyspark.sql.functions import struct

predict = mlflow.pyfunc.spark_udf(spark, model_uri, result_type="double")
scored = (spark.table("subscribers")
          .withColumn("churn_score", predict(struct(*FEATURES)))
          .select("subscriber_id", "contract", "support_calls_90d", "churned", "churn_score"))
scored.write.mode("overwrite").saveAsTable("serving_churn_scores")
display(spark.table("serving_churn_scores").orderBy("churn_score", ascending=False).limit(10))
```

```sql run
-- Do high scores really churn more? (a quick calibration check)
SELECT floor(churn_score * 5) / 5 AS score_from,
       count(*) AS subscribers,
       round(avg(churned), 3) AS actual_churn_rate
FROM serving_churn_scores
GROUP BY ALL
ORDER BY score_from;
```

> Creating an endpoint and calling it by REST are display-only in this module: an endpoint takes several minutes to build, runs on paid serving compute, and needs permission to create serving endpoints. The same model URI, registered in Unity Catalog, is what you would serve.

## Exercise 1: score in pandas

For a small table you do not need Spark. Log a quick model, load it with `mlflow.pyfunc.load_model`, and score only the **Monthly** contract subscribers. **Predict first:** would `spark_udf` give the same numbers?

```python todo
# TODO 1: train LogisticRegression on 3 numeric columns of subscribers and log it with mlflow.sklearn.log_model
# TODO 2: load it with mlflow.pyfunc.load_model(f"runs:/{run_id}/model")
# TODO 3: predict for contract == 'Monthly' rows and count predicted churners
```

```python solution
import mlflow
from mlflow.models import infer_signature
from sklearn.linear_model import LogisticRegression

cols = ["tenure_months", "support_calls_90d", "payment_failures_6m"]
pdf = spark.table("subscribers").toPandas()
m = LogisticRegression(max_iter=1000).fit(pdf[cols], pdf["churned"])
mlflow.sklearn.autolog(disable=True)
with mlflow.start_run() as run:
    mlflow.sklearn.log_model(m, "model", signature=infer_signature(pdf[cols], m.predict(pdf[cols])))

loaded = mlflow.pyfunc.load_model(f"runs:/{run.info.run_id}/model")
monthly = pdf[pdf["contract"] == "Monthly"]
pred = loaded.predict(monthly[cols])
print(len(monthly), "monthly subscribers,", int(pred.sum()), "predicted churners")
# Yes: spark_udf loads the same model and calls the same predict, only spread over executors.
```

## Exercise 2: plan a canary

Write a function that returns the endpoint config for a canary with a given challenger share, and **check** that every route set adds up to 100. Nothing is sent to a real endpoint.

```python todo
# TODO 1: def canary(model, champion_v, challenger_v, pct) -> dict with served_entities and traffic_config
# TODO 2: print the routes for pct = 10, 50 and 100 and assert they sum to 100
```

```python solution
def canary(model, champion_v, challenger_v, pct):
    entity = lambda name, v: {"name": name, "entity_name": model, "entity_version": str(v),
                              "workload_size": "Small", "scale_to_zero_enabled": False}
    return {"served_entities": [entity("champion", champion_v), entity("challenger", challenger_v)],
            "traffic_config": {"routes": [
                {"served_model_name": "champion", "traffic_percentage": 100 - pct},
                {"served_model_name": "challenger", "traffic_percentage": pct}]}}

for pct in [10, 50, 100]:
    cfg = canary(f"{CATALOG}.{SCHEMA}.churn_model", 3, 4, pct)
    routes = cfg["traffic_config"]["routes"]
    assert sum(r["traffic_percentage"] for r in routes) == 100
    print(pct, [(r["served_model_name"], r["traffic_percentage"]) for r in routes])

# To apply one (display-only, needs an endpoint):
# from mlflow.deployments import get_deploy_client
# get_deploy_client("databricks").update_endpoint(endpoint="churn-endpoint", config=canary(...))
```

## ⚠️ Common mistakes

- ❌ A real-time endpoint for a nightly job over all customers. Use batch.
- ❌ Calling an endpoint once per event in a streaming job. Apply the model as a Spark UDF in the stream.
- ❌ Loading the model inside a row-level function. Load once per executor (`spark_udf`) or once per batch.
- ❌ Two endpoints and random routing in the client for an A/B test. Use one endpoint with `traffic_config`.
- ❌ Scale to zero on a latency-critical endpoint. The first request after idle waits for a cold start.
- ✅ Turn on inference tables so production requests can be monitored.

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Score a table on a schedule | `mlflow.pyfunc.spark_udf` in a Lakeflow Job |
| Score a stream | The same UDF on a streaming DataFrame or in a pipeline |
| Score small data | `mlflow.pyfunc.load_model(uri).predict(pdf)` |
| Answer app requests in ms | Model Serving endpoint, `POST /serving-endpoints/<name>/invocations` |
| Roll out a new version | Second served entity + `traffic_config` routes summing to 100 |
| Log production traffic | Inference tables (AI Gateway) |
