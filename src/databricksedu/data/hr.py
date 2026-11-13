"""hr: departments and employees with sensitive columns (for governance demos)."""
import datetime as dt
import random

from ._core import Dataset, Table, pick

TITLE = "HR with sensitive columns (governance)"
ICON = "🧑‍💼"
SUMMARY = ("8 departments and 300 employees with synthetic PII (email, national id, salary) and a manager "
           "hierarchy. Made for row filters, column masks, dynamic views and privilege exercises.")
FILES_TABLE = "employees"   # data.files() adds new files of this table on every call
USE_FOR = "Unity Catalog privileges, row filters, column masks, dynamic views, pseudonymization, self joins"

DEPARTMENTS = [("Engineering", "HU"), ("Data", "HU"), ("Sales", "DE"), ("Marketing", "DE"),
               ("Finance", "GB"), ("People", "GB"), ("Support", "ES"), ("Operations", "ES")]
FIRST = ["Anna", "Bence", "Clara", "David", "Emma", "Felix", "Greta", "Hugo", "Ines", "Jonas", "Kata", "Leo",
         "Maria", "Noel", "Olga", "Peter", "Rosa", "Samu", "Tessa", "Viktor"]
LAST = ["Kovacs", "Nagy", "Schmidt", "Muller", "Garcia", "Lopez", "Smith", "Taylor", "Novak", "Horvath",
        "Fischer", "Weber", "Martin", "Brown", "Toth", "Szabo"]


def generate(seed=42, scale=1.0):
    rng = random.Random(seed)
    departments = [(i + 1, name, country) for i, (name, country) in enumerate(DEPARTMENTS)]
    employees = []
    n = int(300 * scale)
    for eid in range(1, n + 1):
        dep = departments[rng.randrange(len(departments))]
        first, last = FIRST[rng.randrange(len(FIRST))], LAST[rng.randrange(len(LAST))]
        level = pick(rng, [("Junior", .35), ("Mid", .40), ("Senior", .20), ("Lead", .05)])
        base = {"Junior": 38000, "Mid": 56000, "Senior": 82000, "Lead": 110000}[level]
        # the first employee of each department block is a manager; nobody manages employee 1
        manager_id = None if eid <= len(departments) else rng.randint(1, len(departments))
        employees.append((eid, "%s %s" % (first, last),
                          "%s.%s%d@example.com" % (first.lower(), last.lower(), eid),
                          "%03d-%02d-%04d" % (rng.randint(100, 899), rng.randint(10, 99), rng.randint(1000, 9999)),
                          dep[0], level, float(int(base * rng.uniform(0.85, 1.25) / 100) * 100), dep[2],
                          dt.date(2015, 1, 1) + dt.timedelta(days=rng.randrange(4200)), manager_id))

    return Dataset("hr", SUMMARY, seed, [
        Table("departments", [
            ("department_id", "BIGINT NOT NULL", "Unique department identifier"),
            ("department_name", "STRING", "Department name"),
            ("country", "STRING", "Country where the department is based"),
        ], departments, "Departments", ["department_id"]),
        Table("employees", [
            ("employee_id", "BIGINT NOT NULL", "Unique employee identifier"),
            ("full_name", "STRING", "Full name (PII, synthetic)"),
            ("email", "STRING", "Work email (PII, synthetic)"),
            ("national_id", "STRING", "National identifier (sensitive PII, synthetic)"),
            ("department_id", "BIGINT", "FK to departments"),
            ("level", "STRING", "Junior, Mid, Senior or Lead"),
            ("salary", "DOUBLE", "Yearly salary in EUR (confidential)"),
            ("country", "STRING", "Country of employment"),
            ("hired_on", "DATE", "Hire date"),
            ("manager_id", "BIGINT", "FK to employees (the manager); NULL for department heads"),
        ], employees, "Employees with sensitive columns", ["employee_id"],
            [("department_id", "departments", "department_id"), ("manager_id", "employees", "employee_id")]),
    ])
