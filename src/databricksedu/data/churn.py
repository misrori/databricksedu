"""churn: telco subscribers with a learnable churn label, plus monthly usage."""
import datetime as dt
import math
import random

from ._core import Dataset, Table, pick

TITLE = "Telco churn (machine learning)"
ICON = "📉"
SUMMARY = ("5,000 telco subscribers with a churn label that really depends on the features (contract type, "
           "support calls, payment failures, tenure), plus 30,000 rows of monthly usage for feature engineering.")
USE_FOR = "MLflow tracking, feature tables, train/test splits, hyperparameter tuning, model serving, drift monitoring"


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)
    n = int(5000 * scale)
    subscribers, usage = [], []
    months = [dt.date(2026, m, 1) for m in range(5, 11)]
    for sid in range(1, n + 1):
        plan = pick(rng, [("Basic", .45), ("Plus", .35), ("Premium", .20)])
        contract = pick(rng, [("Monthly", .55), ("One year", .28), ("Two year", .17)])
        tenure = int(1 + rng.random() ** 1.6 * 71)
        age = rng.randint(18, 80)
        fee = {"Basic": 19.0, "Plus": 39.0, "Premium": 69.0}[plan] + round(rng.uniform(-3, 6), 2)
        support_calls = int(rng.random() ** 2.2 * 9)
        payment_failures = int(rng.random() ** 3.0 * 5)
        has_app = rng.random() < 0.6
        weekly_minutes = round(max(0.0, rng.gauss(220, 90) * (1.25 if has_app else 0.85)), 1)
        region = pick(rng, [("North", .25), ("South", .25), ("East", .25), ("West", .25)])
        z = (-1.4
             + 0.42 * support_calls
             + 0.65 * payment_failures
             - 0.035 * tenure
             + {"Monthly": 0.9, "One year": -0.4, "Two year": -1.3}[contract]
             - (0.5 if has_app else 0.0)
             - 0.0025 * weekly_minutes
             + {"Basic": 0.1, "Plus": 0.0, "Premium": -0.2}[plan])
        churned = rng.random() < 1.0 / (1.0 + math.exp(-z))
        subscribers.append((sid, dt.date(2026, 10, 1) - dt.timedelta(days=tenure * 30), plan, contract, region, age,
                            tenure, round(fee, 2), support_calls, payment_failures, has_app, weekly_minutes,
                            1 if churned else 0))
        trend = -0.12 if churned else 0.01
        for k, month in enumerate(months):
            factor = max(0.05, 1.0 + trend * k + rng.gauss(0, 0.08))
            minutes = round(weekly_minutes * 4.3 * factor, 1)
            usage.append((sid, month, minutes, round(max(0.0, rng.gauss(12, 5) * factor), 2),
                          round(fee + (rng.uniform(0, 12) if rng.random() < 0.15 else 0.0), 2)))

    return Dataset("churn", SUMMARY, seed, [
        Table("subscribers", [
            ("subscriber_id", "BIGINT NOT NULL", "Unique subscriber identifier"),
            ("signup_date", "DATE", "Date the subscription started"),
            ("plan", "STRING", "Basic, Plus or Premium"),
            ("contract", "STRING", "Monthly, One year or Two year"),
            ("region", "STRING", "North, South, East or West"),
            ("age", "INT", "Age in years"),
            ("tenure_months", "INT", "Months since signup"),
            ("monthly_fee", "DOUBLE", "Monthly fee in USD"),
            ("support_calls_90d", "INT", "Support calls in the last 90 days"),
            ("payment_failures_6m", "INT", "Failed payments in the last 6 months"),
            ("has_app", "BOOLEAN", "Uses the mobile app"),
            ("avg_weekly_minutes", "DOUBLE", "Average minutes used per week"),
            ("churned", "INT", "Label: 1 = cancelled within the next month, 0 = stayed"),
        ], subscribers, "Telco subscribers with the churn label", ["subscriber_id"]),
        Table("usage_monthly", [
            ("subscriber_id", "BIGINT NOT NULL", "FK to subscribers"),
            ("month", "DATE NOT NULL", "First day of the month"),
            ("minutes", "DOUBLE", "Minutes used in the month"),
            ("data_gb", "DOUBLE", "Mobile data used in GB"),
            ("billed_amount", "DOUBLE", "Amount billed in USD"),
        ], usage, "Monthly usage per subscriber (May - Oct 2026)", ["subscriber_id", "month"],
            [("subscriber_id", "subscribers", "subscriber_id")]),
    ])
