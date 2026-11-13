---
title: "IoT sensor readings"
summary: Sites, devices and 50,000 time-stamped sensor readings with realistic problems (duplicates, late arrivals, impossible values). Made for streaming, Auto Loader and data quality demos.
icon: 📡
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, Streaming, Data quality, Time series]
---
# IoT sensor readings

> 200 devices in 12 European plants send temperature, humidity and battery readings for 30 days (October 2026). The data is generated from a seed and is dirty on purpose.

**The one idea to remember:** every reading has two timestamps. `event_ts` is when the sensor measured, `ingest_ts` is when it arrived. The gap between them is what watermarks are about.

## 🗺️ The tables and how they join

A small hierarchy: a site has devices, a device has readings. Both links are foreign keys.

```viz flow
{"nodes": [
  {"icon": "🏭", "title": "sites", "sub": "12 rows · PK site_id", "color": "navy", "items": ["site_name, country", "latitude, longitude"]},
  {"icon": "🌡️", "title": "devices", "sub": "200 rows · PK device_id", "color": "teal", "items": ["device_type, model", "installed_on"]},
  {"icon": "📈", "title": "readings", "sub": "50,500 rows · PK reading_id", "color": "amber", "items": ["event_ts, ingest_ts", "temperature, humidity, battery, status"]}],
 "edges": ["site_id", "device_id"],
 "steps": [
  {"label": "Sites", "focus": [0], "note": "One plant per city: Budapest, Vienna, Berlin, Paris and eight more."},
  {"label": "Devices", "focus": [0, 1], "note": "Three kinds: `thermostat` (about 21 °C), `freezer` (about -18 °C) and `air_quality`. `devices.site_id` references `sites`."},
  {"label": "Readings", "focus": [1, 2], "note": "The large table. `readings.device_id` references `devices`. Temperature follows a daily cycle, warmest in the afternoon."}]}
```

## 🧪 Try it: create the tables

```dataset iot
```

```sql run
-- Average temperature per device type and hour of day: the daily cycle
SELECT d.device_type,
       hour(r.event_ts) AS hour_of_day,
       round(avg(r.temperature), 2) AS avg_temp
FROM readings r
JOIN devices d ON r.device_id = d.device_id
WHERE r.temperature BETWEEN -60 AND 60
GROUP BY d.device_type, hour(r.event_ts)
ORDER BY d.device_type, hour_of_day;
```

## 🪤 Built-in data quality problems

Each problem is there so a lesson has something real to fix.

```viz table
{"title": "readings: what is wrong", "columns": ["problem", "about", "how to spot it", "fix with"],
 "rows": [["impossible value", "545 rows", "temperature = 999 or -999", "expectation / filter"],
          ["missing value", "393 rows", "temperature IS NULL", "expectation / default"],
          ["late arrival", "about 1,100 rows", "ingest_ts more than 2 h after event_ts", "watermark"],
          ["retried duplicate", "about 500 rows", "same device_id and event_ts, new reading_id", "dropDuplicates"]],
 "steps": [
  {"label": "Impossible", "note": "A sensor that reports 999 °C is broken. Drop or quarantine the row.", "hl": [0]},
  {"label": "Missing", "note": "No measurement at all. Decide: drop, keep as NULL, or flag.", "hl": [1]},
  {"label": "Late", "note": "Some rows arrive hours after they happened. A streaming aggregation needs a watermark to decide how long to wait.", "hl": [2]},
  {"label": "Duplicate", "note": "The gateway retried and sent the same event twice. The primary key differs, so dedupe on the business key.", "hl": [3]}]}
```

```sql run
-- Count each problem
SELECT
  count_if(temperature IN (999, -999))                                   AS impossible,
  count_if(temperature IS NULL)                                          AS missing,
  count_if(ingest_ts > event_ts + INTERVAL 2 HOURS)                      AS late,
  count(*) - count(DISTINCT device_id, event_ts)                         AS duplicates
FROM readings;
```

## 🐍 Use it from Python and as files

```python
from databricksedu import data

ds = data.generate("iot", seed=42)
landing = data.volume(CATALOG, SCHEMA) + "/iot_landing"
ds.land_files(landing, parts=5, upto=1, fmt="json")   # first file of readings arrives
ds.land_files(landing, parts=5, upto=3, fmt="json")   # two more files arrive later
# point Auto Loader or a streaming read at landing + "/readings"
```

`land_files` never rewrites a file that exists, so an incremental reader only sees the new ones.

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| Event time vs arrival | `event_ts` vs `ingest_ts` |
| Valid temperatures | `temperature BETWEEN -60 AND 60` |
| Deduplicate | key `(device_id, event_ts)` |
| Streaming files | `ds.land_files(path, parts=5, upto=n, fmt="json")` |
| Smaller data | `data.generate("iot", scale=0.1)` |
