---
title: Identities, groups and service principals
summary: Know who Databricks thinks you are. Learn users, groups and service principals, why they live at the account level, how they arrive from your identity provider, and which admin roles and entitlements control them.
icon: 🪪
level: Beginner
minutes: 10
group: Identity and administration
tags: [Identity, Groups, Service principals, SCIM, Administration]
---
# Identities, groups and service principals

> Every grant, every job run and every audit log line names an **identity**. Before you can control access, you need to know which identities exist, where they live and how they get there.

**The one idea to remember:** identities live in the **account**, are synced from your identity provider, and are **assigned** to workspaces. Grant to **account groups**, and run automation as **service principals**.

## 💡 Three kinds of identity

Databricks knows three kinds of principal. Any of them can receive grants and permissions.

```viz compare
{"title": "Who can be granted access",
 "items": [
  {"icon": "🧑", "title": "User", "sub": "a person, identified by email", "color": "blue",
   "points": ["Logs in through SSO", "Owns their own notebooks and queries", "❌ leaves the company one day"],
   "foot": "For interactive work"},
  {"icon": "🤖", "title": "Service principal", "sub": "an identity for software", "color": "teal",
   "points": ["API-only, no UI login", "Authenticates with OAuth secrets", "✅ outlives any one person"],
   "foot": "For jobs, pipelines, CI/CD"},
  {"icon": "👥", "title": "Group", "sub": "a set of users, service principals or groups", "color": "purple",
   "points": ["Groups can contain groups", "Members get the group's grants", "✅ change access by changing membership"],
   "foot": "What you grant to"}
 ]}
```

## 🏢 The account comes first

Users, service principals and groups are created once, in the **account**. An admin then **assigns** them to the workspaces they need. This is **identity federation**, and it is on by default for new workspaces.

```viz tree
{"title": "One account, many workspaces",
 "root": {"icon": "🏢", "label": "Databricks account", "sub": "identities live here", "color": "navy", "children": [
   {"icon": "🧑", "label": "ana@corp.com", "sub": "user", "color": "blue"},
   {"icon": "🤖", "label": "sp-etl-prod", "sub": "service principal", "color": "teal"},
   {"icon": "👥", "label": "data-engineers", "sub": "account group", "color": "purple"},
   {"icon": "🏭", "label": "workspace: prod", "sub": "assigned: data-engineers, sp-etl-prod", "color": "green"},
   {"icon": "🧪", "label": "workspace: dev", "sub": "assigned: data-engineers", "color": "amber"},
   {"icon": "🗄️", "label": "Unity Catalog metastore", "sub": "grants name account identities", "color": "gray"}
 ]}}
```

- The same identity in two workspaces is **one** principal, with one set of Unity Catalog grants.
- On assignment, a principal gets the **User** or **Admin** permission on that workspace.

## 👥 Account groups, legacy groups and built-in groups

| Group type | Where it lives | Can it get Unity Catalog grants? |
|---|---|---|
| **Account group** | Account, assigned to workspaces | ✅ Yes |
| **Workspace-local group** (legacy) | One workspace only | ❌ No, and no account roles |
| `account users` (built-in) | Account: every user and service principal | ✅ Yes |
| `users`, `admins` (built-in) | Each workspace: its members, its admins | ❌ Workspace use only |

Unity Catalog is shared by many workspaces, so it can only know groups that exist above them. Convert old workspace-local groups to account groups. Groups can be **nested**: `data-engineers` can be a member of `all-data-staff`, and its members inherit both groups' grants.

## 🔄 From the identity provider to the data

Nobody should type users into Databricks by hand. Your identity provider (Microsoft Entra ID, Okta, …) is the source of truth. Follow one new joiner.

```viz flow
{"title": "Ana joins the data engineering team",
 "nodes": [{"icon": "🏛️", "title": "Identity provider", "sub": "Entra ID, Okta", "color": "navy"},
           {"icon": "🔄", "title": "Sync", "sub": "automatic identity mgmt or SCIM", "color": "blue"},
           {"icon": "🏢", "title": "Account", "sub": "user + group membership", "color": "purple"},
           {"icon": "🏭", "title": "Workspace", "sub": "group is assigned", "color": "green"},
           {"icon": "🗄️", "title": "Unity Catalog", "sub": "group has grants", "color": "teal"}],
 "edges": ["", "", "", ""],
 "steps": [
  {"label": "HR adds Ana", "focus": [0], "note": "IT adds Ana to the `data-engineers` group in the identity provider. Nothing is done in Databricks."},
  {"label": "Sync", "focus": [1], "note": "**Automatic identity management** (recommended, Entra ID and Okta) or a **SCIM** connector pushes users and groups to the account. SCIM does not support nested groups; automatic identity management does."},
  {"label": "Account", "focus": [2], "note": "Ana now exists in the account and is a member of the account group `data-engineers`."},
  {"label": "Workspace", "focus": [3], "note": "`data-engineers` was assigned to the `prod` workspace long ago, so Ana can log in at once. No per-person assignment."},
  {"label": "Data", "focus": [4], "note": "The group already holds `USE CATALOG`, `USE SCHEMA` and `SELECT` grants. Ana can query on day one. When she leaves, the IdP removes her and all access goes with it."}
 ]}
```

## 🤖 Service principals for automation

A production job should not run as a person. If it does, it breaks when that person leaves, and it can read everything that person can read.

- A **service principal** authenticates with **OAuth machine-to-machine** (M2M): a client ID plus a secret. Each secret lives at most 2 years; each access token lives one hour.
- Prefer OAuth over personal access tokens: tokens are short-lived and no person's credentials are involved.
- A job's **Run as** setting can name a service principal. You need the **Service Principal User** role on it to choose it.
- The **Service Principal Manager** role lets someone manage the principal's roles. The creator gets it automatically.

```bash
# Display-only: an account admin creates a service principal and an OAuth secret
databricks account service-principals create --display-name "sp-etl-prod"
databricks account service-principal-secrets create <SERVICE_PRINCIPAL_ID> --lifetime "7776000"
```

## 👑 Who administers what

Admin roles are scoped. A workspace admin is not automatically a metastore admin, and the other way around.

```viz layers
{"title": "Admin roles, from widest to narrowest",
 "layers": [
  {"icon": "🏢", "title": "Account admin", "sub": "the whole account", "color": "navy", "items": ["Creates workspaces", "Manages all identities", "Assigns admin roles"]},
  {"icon": "🗄️", "title": "Metastore admin", "sub": "one Unity Catalog metastore", "color": "purple", "items": ["Privileges and ownership of all securables", "Often a group, not a person"]},
  {"icon": "🏭", "title": "Workspace admin", "sub": "one workspace", "color": "green", "items": ["Workspace settings and compute rules", "Entitlements and object permissions", "Member of the workspace `admins` group"]},
  {"icon": "🧩", "title": "Delegated roles", "sub": "one group or service principal", "color": "teal", "items": ["Group manager: membership of one group", "Service Principal Manager / User"]}
 ]}
```

Smaller roles exist too: **billing admin** (budgets, serverless usage policies) and **marketplace admin** (provider profile).

## 🎟️ Workspace entitlements

Being assigned to a workspace lets you in. **Entitlements** decide which parts of it you may use.

| Entitlement | What it unlocks |
|---|---|
| **Workspace access** | Notebooks, jobs, pipelines, models |
| **Databricks SQL access** | SQL editor, queries, dashboards, SQL warehouses |
| **Consumer access** | A simple view-only experience: dashboards, Genie, apps |
| **Allow unrestricted cluster creation** | Create compute without a policy |
| **Allow pool creation** | Create instance pools |

Since the September 2026 change, the workspace `users` group carries **no** entitlements. Admins grant them explicitly when they add a principal or a group. Older grants on `users` were moved to a workspace-local clone group.

## 🧪 Try it: who am I?

These cells only read your own identity, so they work for any user.

```sql run
-- The identity this session runs as
SELECT current_user() AS current_user, session_user() AS session_user;
```

```sql run
-- Are you a member of these account groups? (direct or nested)
SELECT
  is_account_group_member('account users') AS in_account_users,
  is_account_group_member('admins')        AS in_admins,
  is_account_group_member('data-engineers') AS in_data_engineers;
```

```python run
# What the workspace knows about you: groups and directly assigned entitlements
from databricks.sdk import WorkspaceClient

me = WorkspaceClient().current_user.me()
print("User:        ", me.user_name)
print("Groups:      ", sorted(g.display for g in (me.groups or [])))
print("Entitlements:", sorted(e.value for e in (me.entitlements or [])))
```

> `is_account_group_member` only knows **account** groups. `admins` is a workspace group, so expect `false` there even for a workspace admin. `session_user()` needs Databricks Runtime 14.1 or later; serverless has it. Creating users, groups and service principals needs an admin, so those commands in this module are display-only.

## Exercise 1: which of your groups are account groups?

`me.groups` lists the groups the workspace shows for you. Check each one with `is_account_group_member`. Predict first: which ones will be `false`, and why?

```python todo
# TODO 1: get your groups with WorkspaceClient().current_user.me()
# TODO 2: for each group name, run SELECT is_account_group_member('<name>')
# TODO 3: print the name and the result
```

```python solution
from databricks.sdk import WorkspaceClient

me = WorkspaceClient().current_user.me()
for g in sorted(x.display for x in (me.groups or [])):
    safe = g.replace("'", "''")
    is_account = spark.sql(f"SELECT is_account_group_member('{safe}')").first()[0]
    print(f"{g:<40} account group: {is_account}")
# false = a workspace system group (users, admins) or a legacy workspace-local group.
# Those groups cannot receive Unity Catalog grants.
```

## Exercise 2: pick the right identity

For each need, decide which principal should get access: a **user**, an **account group**, a **service principal**, or a **workspace-local group**. Store your answers in a temporary view `idn_decisions` with the columns `need`, `principal_type`, `why`.

```sql todo
-- TODO: CREATE OR REPLACE TEMP VIEW idn_decisions AS SELECT * FROM VALUES (...) AS t(need, principal_type, why)
-- 1. A nightly Lakeflow Job that loads sales data into prod
-- 2. 40 analysts who must read the gold schema
-- 3. A GitHub Actions workflow that deploys a bundle
-- 4. A new UC grant for "the finance team" in a workspace that still has a local finance group
```

```sql solution
CREATE OR REPLACE TEMP VIEW idn_decisions AS
SELECT * FROM VALUES
  ('Nightly prod load job',      'service principal', 'Run as the SP: the job survives people leaving, access is minimal'),
  ('40 analysts read gold',      'account group',     'One grant; joiners and leavers change membership, not grants'),
  ('GitHub Actions deployment',  'service principal', 'OAuth M2M secret in the CI secret store, no personal token'),
  ('Finance team UC grant',      'account group',     'Workspace-local groups cannot get UC grants: create or convert to an account group')
AS t(need, principal_type, why);

SELECT * FROM idn_decisions;
-- A workspace-local group is never the right answer for new work.
```

## ⚠️ Common mistakes

- ❌ Adding users one by one in each workspace. Sync from the identity provider and assign **groups** to workspaces.
- ❌ Granting Unity Catalog privileges to a person. Next year you will not know why they had it.
- ❌ Running production jobs as a person, or with a personal access token in CI. Use a service principal with OAuth.
- ❌ Expecting the workspace `users` group to hand out entitlements. Grant them explicitly to groups.
- ✅ Account groups for grants, service principals for automation, the identity provider as the source of truth.

## 🧭 Cheat sheet

| I want to… | Use |
|---|---|
| See who I am | `SELECT current_user(), session_user()` |
| Check account group membership in SQL | `is_account_group_member('group')` |
| Sync people and groups | Automatic identity management, or SCIM |
| Let a job run without a person | Service principal + **Run as** + OAuth M2M |
| Let someone pick an SP as Run as | **Service Principal User** role on it |
| Let someone use SQL or notebooks | **Databricks SQL access** / **Workspace access** entitlement |
