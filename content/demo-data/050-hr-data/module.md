---
title: "HR with sensitive columns"
summary: 8 departments and 300 employees with synthetic PII (email, national id, salary) and a manager hierarchy. Made for privileges, row filters, column masks and pseudonymization.
icon: 🧑‍💼
level: Beginner
minutes: 5
group: Datasets
tags: [Demo data, Governance, PII, Self join]
---
# HR with sensitive columns

> A company with 8 departments in four countries and 300 employees. Every name, email, national id and salary is fake, but it looks like the data you must protect.

**The one idea to remember:** the sensitive columns are `email`, `national_id` and `salary`. The `country` column gives row filters something natural to filter on.

## 🗺️ The tables and how they join

```viz tree
{"root": {"icon": "🏢", "label": "departments", "sub": "8 rows · PK department_id", "color": "navy",
  "children": [
   {"icon": "🇭🇺", "label": "Engineering, Data", "sub": "HU", "color": "blue"},
   {"icon": "🇩🇪", "label": "Sales, Marketing", "sub": "DE", "color": "teal"},
   {"icon": "🇬🇧", "label": "Finance, People", "sub": "GB", "color": "purple"},
   {"icon": "🇪🇸", "label": "Support, Operations", "sub": "ES", "color": "amber"},
   {"icon": "🧑‍💼", "label": "employees", "sub": "300 rows · FK department_id · FK manager_id → employees", "color": "red"}]}}
```

`employees.manager_id` references `employees.employee_id`: a **self-referencing** foreign key. Employees 1 to 8 are the managers and have no manager themselves.

## 🔒 Which columns need protection

```viz table
{"title": "employees (first rows)", "columns": ["employee_id", "full_name", "national_id", "salary"],
 "rows": [[1, "Anna Novak", "242-23-9935", 33600.0], [2, "Anna Schmidt", "617-87-1434", 40800.0]],
 "steps": [
  {"label": "Raw", "note": "What an HR admin may see."},
  {"label": "Masked", "note": "What an analyst should see: the id is masked, the salary hidden.", "upd": {"0": {"national_id": "***-**-9935", "salary": null}, "1": {"national_id": "***-**-1434", "salary": null}}}]}
```

## 🧪 Try it: create the tables

```dataset hr
```

```sql run
-- Self join: each employee with their manager
SELECT e.employee_id, e.full_name, e.level, m.full_name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.employee_id
ORDER BY e.employee_id
LIMIT 15;
```

```sql run
-- A safe aggregate: no PII leaves this query
SELECT d.department_name, d.country, count(*) AS headcount, round(avg(e.salary)) AS avg_salary
FROM employees e
JOIN departments d ON e.department_id = d.department_id
GROUP BY d.department_name, d.country
ORDER BY d.department_name;
```

## 🧭 Cheat sheet

| Need | Use |
|---|---|
| PII columns | `email`, `national_id`, `salary` |
| Row filter key | `employees.country` (HU, DE, GB, ES) |
| Hierarchy | `manager_id → employee_id` |
| Salary bands | `level`: Junior, Mid, Senior, Lead |
| Clean up | `ds.drop_tables()` |
