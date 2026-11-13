"""retail: a small star schema (customers, products, orders)."""
import datetime as dt
import random

from ._core import Dataset, Table, pick

TITLE = "Retail star schema"
ICON = "🛒"
SUMMARY = ("500 customers, 40 products and 60,000 orders (Jan 2025 - Oct 2026). Cheap Books sell far more "
           "often than expensive Electronics, and the orders include CANCELLED and TEST rows to filter out.")
USE_FOR = "SQL, joins, aggregations, Delta Lake internals, medallion pipelines, metric views, dashboards"


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)

    customers = []
    for cid in range(1, 501):
        region = pick(rng, [("EMEA", .45), ("North America", .30), ("APAC", .17), ("LATAM", .08)])
        segment = pick(rng, [("Enterprise", .2), ("SMB", .4), ("Consumer", .4)])
        customers.append((cid, "Customer %04d" % cid, region, segment, "customer%04d@example.com" % cid,
                          rng.randint(1950, 2005), "%d" % rng.randint(1000, 9999)))

    # Cheap categories have low ids, and low ids are ordered far more often (see fact_orders)
    categories = [("Books", 15.0), ("Beauty", 30.0), ("Home", 80.0), ("Sports", 120.0), ("Electronics", 650.0)]
    products = []
    for pid in range(1, 41):
        category, base = categories[(pid - 1) // 8]
        products.append((pid, "%s item %02d" % (category, pid), category, round(base * (0.8 + rng.random() * 0.4), 2)))

    start = dt.date(2025, 1, 1)
    days = (dt.date(2026, 10, 31) - start).days + 1
    orders = []
    for oid in range(1, int(60000 * scale) + 1):
        orders.append((
            oid,
            start + dt.timedelta(days=rng.randrange(days)),
            rng.randint(1, 500),
            int(rng.random() ** 2.5 * 40) + 1,
            rng.randint(1, 5),
            pick(rng, [(0.10, .30), (0.25, .10), (0.0, .60)]),
            pick(rng, [("TEST", .02), ("CANCELLED", .06), ("OPEN", .04), ("COMPLETED", .88)]),
        ))

    bad = ("order_id,order_date,customer_id,product_id,quantity,discount,status\n"
           "90001,2026-11-01,12,3,five,0.0,COMPLETED\n"
           "90002,not-a-date,44,7,2,0.1,COMPLETED\n"
           "90003,2026-11-02,51,2,1,ten percent,OPEN\n"
           "90004,2026-11-02,77,9,3,0.0,COMPLETED\n")

    return Dataset("retail", SUMMARY, seed, [
        Table("dim_customer", [
            ("customer_id", "BIGINT NOT NULL", "Unique customer identifier"),
            ("customer_name", "STRING", "Customer display name"),
            ("region", "STRING", "Sales region: EMEA, North America, APAC, LATAM"),
            ("segment", "STRING", "Customer segment: Enterprise, SMB, Consumer"),
            ("email", "STRING", "Customer email address (PII, synthetic)"),
            ("birth_year", "INT", "Year of birth (PII, synthetic)"),
            ("postal_code", "STRING", "Postal code (quasi-identifier, synthetic)"),
        ], customers, "Customer dimension", ["customer_id"]),
        Table("dim_product", [
            ("product_id", "BIGINT NOT NULL", "Unique product identifier"),
            ("product_name", "STRING", "Product name"),
            ("category", "STRING", "Product category: Books, Beauty, Home, Sports, Electronics"),
            ("unit_price", "DOUBLE", "List price per unit in USD"),
        ], products, "Product dimension", ["product_id"]),
        Table("fact_orders", [
            ("order_id", "BIGINT NOT NULL", "Unique order identifier"),
            ("order_date", "DATE", "Date the order was placed"),
            ("customer_id", "BIGINT", "FK to dim_customer"),
            ("product_id", "BIGINT", "FK to dim_product"),
            ("quantity", "INT", "Units ordered"),
            ("discount", "DOUBLE", "Discount rate applied to the order (0.0 - 1.0)"),
            ("status", "STRING", "COMPLETED, OPEN, CANCELLED, or TEST (internal test orders - always exclude)"),
        ], orders, "Order fact table (one row per order)", ["order_id"],
            [("customer_id", "dim_customer", "customer_id"), ("product_id", "dim_product", "product_id")]),
    ], extra_files={"fact_orders_bad/fact_orders_bad.csv": bad})
