"""cdc: a customer snapshot and a change feed (inserts, updates, deletes) on top of it."""
import datetime as dt
import random

from ._core import Dataset, Table, pick

TITLE = "Change data capture feed"
ICON = "🔁"
SUMMARY = ("A 200-row customer snapshot and 600 change events (INSERT, UPDATE, DELETE) with a sequence number. "
           "Some events arrive out of order, so the sequence column matters.")
USE_FOR = "MERGE INTO, AUTO CDC (APPLY CHANGES), SCD Type 1 and Type 2, Change Data Feed, deduplication"

CITIES = ["Budapest", "Vienna", "Berlin", "Paris", "Madrid", "Milan", "London", "Dublin", "Warsaw", "Prague"]
TIERS = [("Bronze", .5), ("Silver", .3), ("Gold", .2)]


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)
    state = {}
    snapshot = []
    for cid in range(1, 201):
        row = [cid, "Customer %04d" % cid, "customer%04d@example.com" % cid,
               CITIES[rng.randrange(len(CITIES))], pick(rng, TIERS)]
        state[cid] = row
        snapshot.append(tuple(row) + (dt.datetime(2026, 9, 30, 23, 59, 59),))

    events = []
    ts = dt.datetime(2026, 10, 1, 0, 0, 0)
    next_id = 201
    for seq in range(1, int(600 * scale) + 1):
        ts += dt.timedelta(minutes=rng.randrange(5, 120))
        roll = rng.random()
        if roll < 0.20 or not state:
            cid = next_id
            next_id += 1
            state[cid] = [cid, "Customer %04d" % cid, "customer%04d@example.com" % cid,
                          CITIES[rng.randrange(len(CITIES))], pick(rng, TIERS)]
            op = "INSERT"
        else:
            cid = sorted(state)[rng.randrange(len(state))]
            if roll < 0.90:
                if rng.random() < 0.5:
                    state[cid][3] = CITIES[rng.randrange(len(CITIES))]
                else:
                    state[cid][4] = pick(rng, TIERS)
                op = "UPDATE"
            else:
                op = "DELETE"
        row = state[cid]
        events.append((seq, op, row[0], row[1], row[2], row[3], row[4], ts))
        if op == "DELETE":
            del state[cid]
    # deliver about 8% of the events late: swap them a few positions down the feed
    for i in range(len(events) - 6):
        if rng.random() < 0.08:
            j = i + rng.randrange(1, 6)
            events[i], events[j] = events[j], events[i]
    events = [(pos + 1,) + e for pos, e in enumerate(events)]

    cols = [("customer_id", "BIGINT NOT NULL", "Unique customer identifier"),
            ("customer_name", "STRING", "Customer name"),
            ("email", "STRING", "Email address (synthetic)"),
            ("city", "STRING", "City (changes over time)"),
            ("tier", "STRING", "Loyalty tier: Bronze, Silver, Gold (changes over time)")]
    return Dataset("cdc", SUMMARY, seed, [
        Table("customers_snapshot", cols + [("updated_at", "TIMESTAMP", "When the snapshot was taken")],
              snapshot, "Customers as of 2026-09-30 (the starting point)", ["customer_id"]),
        Table("customers_changes", [
            ("arrival_order", "BIGINT NOT NULL", "Order in which the event arrived (not always the true order)"),
            ("sequence_num", "BIGINT", "True order of the change in the source system: use this to sequence"),
            ("operation", "STRING", "INSERT, UPDATE or DELETE"),
        ] + [(c, t.replace(" NOT NULL", ""), m) for c, t, m in cols] + [
            ("changed_at", "TIMESTAMP", "When the change happened in the source system"),
        ], events, "Change feed for customers; about 8% of the events arrive out of order", ["arrival_order"]),
    ])
