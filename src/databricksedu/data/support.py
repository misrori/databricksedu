"""support: knowledge-base articles and support tickets (text for GenAI demos)."""
import datetime as dt
import random

from ._core import Dataset, Table, pick

TITLE = "Support knowledge base (generative AI)"
ICON = "💬"
SUMMARY = ("48 knowledge-base articles and 2,000 support tickets for a fictional smart-home company. Every "
           "ticket is about a product and an issue that one article answers, so retrieval can be checked.")
USE_FOR = "Chunking, embeddings, Vector Search, RAG, AI Functions (ai_query, ai_classify), agent tools, evaluation sets"

PRODUCTS = [
    ("HomeHub", "the central smart-home hub"),
    ("ThermoSense", "the smart thermostat"),
    ("LumaBulb", "the colour smart bulb"),
    ("DoorGuard", "the video doorbell"),
    ("AquaLeak", "the water leak sensor"),
    ("PlugMate", "the smart plug"),
]

ISSUES = [
    ("setup", "First-time setup",
     "Plug in {p} and wait until the status light blinks blue. Open the Casa app, tap Add device and scan the QR "
     "code on the back of the unit. Keep your phone within two metres during pairing. Setup needs a 2.4 GHz Wi-Fi "
     "network; 5 GHz-only networks are not supported. If pairing fails three times, hold the reset button for "
     "10 seconds and start again.",
     ["I just unboxed my {p} and the app cannot find it.", "How do I pair {p} with the Casa app?",
      "Setup of my new {p} keeps failing at the QR code step."]),
    ("offline", "Device shows as offline",
     "{p} goes offline when it loses Wi-Fi for more than five minutes. Check that the router is on and that the "
     "device is within range (the signal indicator in the app should show at least two bars). Power-cycle {p} by "
     "unplugging it for 30 seconds. If the router password changed, open Settings > Network > Update Wi-Fi. "
     "Devices reconnect automatically after an outage; no re-pairing is needed.",
     ["My {p} has been offline since yesterday.", "The app says {p} is unreachable, what should I do?",
      "{p} disconnects from Wi-Fi every night."]),
    ("firmware", "Updating the firmware",
     "Firmware updates for {p} install automatically between 02:00 and 04:00 local time when the device is idle. "
     "To update manually, open the device page in the Casa app and tap Settings > Firmware > Check for updates. "
     "Do not unplug {p} while the light is pulsing orange: an interrupted update can take up to 15 minutes to "
     "recover. The current stable version is 4.2.1.",
     ["How can I update the firmware of {p}?", "My {p} is stuck with an orange pulsing light.",
      "Which firmware version should {p} be on?"]),
    ("battery", "Battery and power",
     "Battery-powered {p} units last about 12 months on two AA lithium cells. The app warns you at 15 percent. "
     "Alkaline batteries work but last roughly half as long, and rechargeable NiMH cells are not recommended "
     "because their lower voltage triggers false low-battery alerts. Mains-powered units draw less than 1 watt "
     "in standby.",
     ["The battery of my {p} drains in a few weeks.", "What kind of batteries does {p} need?",
      "I keep getting low battery alerts from {p}."]),
    ("warranty", "Warranty and returns",
     "{p} comes with a 24-month limited warranty that covers manufacturing defects. Water damage and damage from "
     "unofficial power adapters are not covered. You can return an unused device within 30 days for a full "
     "refund. To start a claim, open Help > Warranty in the Casa app and attach a photo of the serial number. "
     "Replacements ship within 5 business days.",
     ["Is my {p} still under warranty?", "I want to return {p}, how does it work?",
      "My {p} stopped working after 14 months, can I get a replacement?"]),
    ("automation", "Schedules and automations",
     "Create a schedule for {p} in the Casa app under Automations > New routine. A routine has a trigger (time, "
     "sunrise or sunset, or another device) and one or more actions. Routines run locally on the hub, so they "
     "keep working without internet. Each account can hold up to 50 routines, and a routine can control at most "
     "20 devices.",
     ["How do I schedule {p} to turn on at sunset?", "My automation for {p} did not run this morning.",
      "Can {p} trigger another device?"]),
    ("voice", "Voice assistant integration",
     "{p} works with Alexa and Google Home. Enable the Casa skill in the assistant's app and sign in with your "
     "Casa account, then run device discovery. Device names with special characters are not recognised: rename "
     "them to plain words first. Voice control needs the cloud connection, so it does not work during an "
     "internet outage.",
     ["Alexa cannot find my {p}.", "How do I connect {p} to Google Home?",
      "Voice commands for {p} stopped working."]),
    ("privacy", "Privacy and data",
     "{p} stores event history for 30 days on the free plan and 180 days on Casa Plus. You can export or delete "
     "your data at any time under Account > Privacy. Video and audio are encrypted in transit and at rest. "
     "Casa never sells personal data, and diagnostics are shared only if you opt in.",
     ["How long does {p} keep my data?", "I want to delete everything {p} recorded.",
      "Is the data from {p} encrypted?"]),
]


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)
    articles, lookup = [], {}
    aid = 0
    for product, tagline in PRODUCTS:
        for key, title, body, _ in ISSUES:
            aid += 1
            text = ("%s for %s, %s. " % (title, product, tagline)) + body.format(p=product)
            articles.append((aid, "%s: %s" % (product, title), product, key, text,
                             dt.date(2026, 1, 1) + dt.timedelta(days=rng.randrange(300))))
            lookup[(product, key)] = aid

    closers = ["Thanks!", "Please help.", "This is urgent.", "Any advice is welcome.", "I already restarted it once.",
               "Order number is in my account."]
    tickets = []
    start = dt.datetime(2026, 7, 1, 8, 0, 0)
    for tid in range(1, int(2000 * scale) + 1):
        product, _ = PRODUCTS[rng.randrange(len(PRODUCTS))]
        key, title, _, questions = ISSUES[int(rng.random() ** 1.5 * len(ISSUES))]
        question = questions[rng.randrange(len(questions))].format(p=product)
        body = "%s %s" % (question, closers[rng.randrange(len(closers))])
        created = start + dt.timedelta(minutes=rng.randrange(120 * 24 * 60))
        priority = pick(rng, [("low", .5), ("medium", .35), ("high", .15)])
        resolved = rng.random() < 0.82
        tickets.append((tid, rng.randint(1, 500), product, question, body, priority, created,
                        resolved, lookup[(product, key)] if resolved else None))

    return Dataset("support", SUMMARY, seed, [
        Table("kb_articles", [
            ("article_id", "BIGINT NOT NULL", "Unique article identifier"),
            ("title", "STRING", "Article title"),
            ("product", "STRING", "Product the article is about"),
            ("topic", "STRING", "Issue type: setup, offline, firmware, battery, warranty, automation, voice, privacy"),
            ("body", "STRING", "Full article text"),
            ("updated_on", "DATE", "Last update"),
        ], articles, "Knowledge-base articles", ["article_id"]),
        Table("tickets", [
            ("ticket_id", "BIGINT NOT NULL", "Unique ticket identifier"),
            ("customer_id", "BIGINT", "Customer who opened the ticket"),
            ("product", "STRING", "Product the ticket is about"),
            ("subject", "STRING", "Short question"),
            ("body", "STRING", "Full ticket text"),
            ("priority", "STRING", "low, medium or high"),
            ("created_at", "TIMESTAMP", "When the ticket was opened"),
            ("resolved", "BOOLEAN", "Whether the ticket is resolved"),
            ("article_id", "BIGINT", "FK to the article that answered it (NULL while unresolved)"),
        ], tickets, "Customer support tickets", ["ticket_id"], [("article_id", "kb_articles", "article_id")]),
    ])
