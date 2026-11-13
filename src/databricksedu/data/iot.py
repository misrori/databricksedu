"""iot: sites, devices and time-stamped sensor readings."""
import datetime as dt
import math
import random

from ._core import Dataset, Table, pick

TITLE = "IoT sensor readings"
ICON = "📡"
SUMMARY = ("12 sites, 200 devices and 50,000 sensor readings over 30 days. Readings follow a daily temperature "
           "cycle and include a few duplicates, late arrivals and impossible values for data quality work.")
FILES_TABLE = "readings"   # data.files() adds new files of this table on every call
USE_FOR = "Structured Streaming, Auto Loader, watermarks, deduplication, expectations, time-series aggregation"

SITES = [("Budapest", "HU", 47.50, 19.04), ("Vienna", "AT", 48.21, 16.37), ("Berlin", "DE", 52.52, 13.40),
         ("Paris", "FR", 48.86, 2.35), ("Madrid", "ES", 40.42, -3.70), ("Milan", "IT", 45.46, 9.19),
         ("London", "GB", 51.51, -0.13), ("Dublin", "IE", 53.35, -6.26), ("Warsaw", "PL", 52.23, 21.01),
         ("Prague", "CZ", 50.08, 14.44), ("Lisbon", "PT", 38.72, -9.14), ("Stockholm", "SE", 59.33, 18.07)]


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)
    sites = [(i + 1, "%s plant" % city, country, lat, lon) for i, (city, country, lat, lon) in enumerate(SITES)]

    devices = []
    for did in range(1, 201):
        kind = pick(rng, [("thermostat", .5), ("freezer", .3), ("air_quality", .2)])
        devices.append((did, "DEV-%04d" % did, rng.randint(1, len(sites)), kind,
                        pick(rng, [("TX-100", .5), ("TX-200", .35), ("TX-300", .15)]),
                        dt.date(2023, 1, 1) + dt.timedelta(days=rng.randrange(900))))

    start = dt.datetime(2026, 10, 1, 0, 0, 0)
    span = 30 * 24 * 3600
    readings = []
    n = int(50000 * scale)
    for rid in range(1, n + 1):
        dev = devices[rng.randrange(len(devices))]
        event_ts = start + dt.timedelta(seconds=rng.randrange(span))
        base = {"thermostat": 21.0, "freezer": -18.0, "air_quality": 23.0}[dev[3]]
        daily = 3.0 * math.sin((event_ts.hour - 9) / 24.0 * 2 * math.pi)
        temperature = round(base + daily + rng.gauss(0, 0.8), 2)
        humidity = round(min(100.0, max(5.0, 45 + rng.gauss(0, 9))), 1)
        battery = round(max(1.0, 100 - (event_ts - start).total_seconds() / span * rng.uniform(20, 70)), 1)
        status = pick(rng, [("OK", .95), ("WARN", .04), ("ERROR", .01)])
        delay = rng.randrange(5, 90)
        roll = rng.random()
        if roll < 0.010:                       # impossible sensor value
            temperature = pick(rng, [(999.0, .5), (-999.0, .5)])
        elif roll < 0.018:                     # missing measurement
            temperature = None
        elif roll < 0.040:                     # late arrival: hours after the event
            delay = rng.randrange(2 * 3600, 30 * 3600)
        readings.append((rid, dev[0], event_ts, event_ts + dt.timedelta(seconds=delay),
                         temperature, humidity, battery, status))
    # exact duplicates of earlier events with a new reading_id (retries from the gateway)
    for k in range(int(n * 0.01)):
        src = readings[rng.randrange(n)]
        readings.append((n + k + 1,) + src[1:])

    return Dataset("iot", SUMMARY, seed, [
        Table("sites", [
            ("site_id", "BIGINT NOT NULL", "Unique site identifier"),
            ("site_name", "STRING", "Site name"),
            ("country", "STRING", "ISO country code"),
            ("latitude", "DOUBLE", "Latitude"),
            ("longitude", "DOUBLE", "Longitude"),
        ], sites, "Sites where devices are installed", ["site_id"]),
        Table("devices", [
            ("device_id", "BIGINT NOT NULL", "Unique device identifier"),
            ("serial_number", "STRING", "Device serial number"),
            ("site_id", "BIGINT", "FK to sites"),
            ("device_type", "STRING", "thermostat, freezer or air_quality"),
            ("model", "STRING", "Hardware model"),
            ("installed_on", "DATE", "Installation date"),
        ], devices, "Device registry", ["device_id"], [("site_id", "sites", "site_id")]),
        Table("readings", [
            ("reading_id", "BIGINT NOT NULL", "Unique reading identifier"),
            ("device_id", "BIGINT", "FK to devices"),
            ("event_ts", "TIMESTAMP", "When the sensor measured the value (event time)"),
            ("ingest_ts", "TIMESTAMP", "When the gateway received it (a few rows arrive hours late)"),
            ("temperature", "DOUBLE", "Temperature in Celsius (NULL and +-999 are bad readings)"),
            ("humidity", "DOUBLE", "Relative humidity in percent"),
            ("battery", "DOUBLE", "Battery level in percent"),
            ("status", "STRING", "OK, WARN or ERROR"),
        ], readings, "Raw sensor readings (about 1% are retried duplicates)", ["reading_id"],
            [("device_id", "devices", "device_id")]),
    ])
