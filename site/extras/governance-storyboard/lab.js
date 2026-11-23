/* Governance storyboard: the access lab.
   A small, honest model of Unity Catalog access: account identities and groups, workspace assignment,
   catalog-workspace binding, grants with inheritance, ownership, and four ways to protect data
   (nothing, dynamic view, row filter + column masks, ABAC policies). Every change is also written as SQL.
   Registers window.GovLab = { render(el), reset() }. */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  // ------------------------------------------------------------------ the starting world
  var EMP_COLS = [
    { n: 'employee_id' }, { n: 'full_name' }, { n: 'country', tag: 'geo=country' }, { n: 'department' },
    { n: 'salary', num: true, tag: 'pii=salary' }, { n: 'national_id', tag: 'pii=national_id' }, { n: 'email', tag: 'pii=email' }
  ];
  var EMP_ROWS = [
    [101, 'Anna Kovacs', 'HU', 'HR', 61200, '412-55-7310', 'anna.kovacs@corp.com'],
    [102, 'Felix Weber', 'DE', 'Sales', 84500, '233-18-4402', 'felix.weber@corp.com'],
    [103, 'Ines Garcia', 'ES', 'Finance', 47900, '671-90-1185', 'ines.garcia@corp.com'],
    [104, 'Bence Nagy', 'HU', 'IT', 112300, '508-23-9967', 'bence.nagy@corp.com'],
    [105, 'Tessa Smith', 'GB', 'Sales', 58800, '145-66-2051', 'tessa.smith@corp.com'],
    [106, 'Jonas Becker', 'DE', 'IT', 93100, '377-41-6620', 'jonas.becker@corp.com'],
    [107, 'Reka Toth', 'HU', 'Finance', 70400, '590-12-3348', 'reka.toth@corp.com'],
    [108, 'Lucia Ortiz', 'ES', 'HR', 52600, '264-73-8819', 'lucia.ortiz@corp.com']
  ];
  var CUS_COLS = [{ n: 'customer_id' }, { n: 'name' }, { n: 'country', tag: 'geo=country' }, { n: 'email', tag: 'pii=email' }, { n: 'phone', tag: 'pii=phone' }, { n: 'segment' }];
  var CUS_ROWS = [
    [1, 'Duna Kft', 'HU', 'info@dunakft.hu', '+36 1 555 0101', 'SMB'],
    [2, 'Rhein AG', 'DE', 'kontakt@rhein.de', '+49 30 555 0199', 'Enterprise'],
    [3, 'Sol SL', 'ES', 'hola@sol.es', '+34 91 555 0142', 'SMB'],
    [4, 'Tisza Zrt', 'HU', 'office@tisza.hu', '+36 1 555 0177', 'Enterprise'],
    [5, 'Thames Ltd', 'GB', 'hello@thames.co.uk', '+44 20 5550 0112', 'Mid-market'],
    [6, 'Spree GmbH', 'DE', 'mail@spree.de', '+49 30 555 0123', 'SMB']
  ];
  var NEW_TABLES = {
    'prod.crm.leads': { owner: 'crm_owners', cols: [{ n: 'lead_id' }, { n: 'contact' }, { n: 'country', tag: 'geo=country' }, { n: 'email', tag: 'pii=email' }, { n: 'source' }],
      rows: [[9001, 'Petra Varga', 'HU', 'petra.varga@mail.hu', 'webinar'], [9002, 'Max Klein', 'DE', 'max.klein@mail.de', 'website'], [9003, 'Ana Ruiz', 'ES', 'ana.ruiz@mail.es', 'event'], [9004, 'Zsofi Kiss', 'HU', 'zsofi.kiss@mail.hu', 'website']] },
    'prod.hr.contractors': { owner: 'hr_admins', cols: [{ n: 'contractor_id' }, { n: 'full_name' }, { n: 'country', tag: 'geo=country' }, { n: 'day_rate', num: true, tag: 'pii=salary' }, { n: 'national_id', tag: 'pii=national_id' }],
      rows: [[501, 'Mark Fodor', 'HU', 640, '733-20-1184'], [502, 'Lena Wolf', 'DE', 810, '842-11-5590'], [503, 'Pablo Diaz', 'ES', 560, '915-37-2206']] }
  };
  var TAGS = ['', 'pii=email', 'pii=salary', 'pii=national_id', 'pii=phone', 'geo=country'];
  var MASKS = {
    none: { label: 'no mask', fn: '' },
    null: { label: 'NULL', fn: 'mask_null' },
    last4: { label: 'last 4 characters', fn: 'mask_last4' },
    hash: { label: 'hash (sha2)', fn: 'mask_hash' },
    email: { label: 'hide the user part of an email', fn: 'mask_email' },
    band: { label: 'round down to 10,000', fn: 'mask_band' },
    redact: { label: "'[REDACTED]'", fn: 'mask_redact' }
  };

  function fresh() {
    return {
      users: [
        { id: 'anna@corp.com', label: 'Anna', role: 'HR admin', icon: '👩‍💼' },
        { id: 'bence@corp.com', label: 'Bence', role: 'analyst, Hungary', icon: '🧑‍💻' },
        { id: 'carla@corp.com', label: 'Carla', role: 'analyst, Germany', icon: '👩‍💻' },
        { id: 'dan@corp.com', label: 'Dan', role: 'joined today', icon: '🧑' }
      ],
      sps: [{ id: 'sp-hr-pipeline', label: 'sp-hr-pipeline', role: 'nightly HR job', icon: '🤖' }],
      groups: {
        hr_admins: ['anna@corp.com'], analysts: ['analysts_hu', 'analysts_de'], analysts_hu: ['bence@corp.com'], analysts_de: ['carla@corp.com'],
        hr_pipelines: ['sp-hr-pipeline'], crm_owners: [], platform_admins: []
      },
      ws: { 'ws-prod': ['hr_admins', 'analysts', 'hr_pipelines'], 'ws-dev': ['analysts', 'dan@corp.com'] },
      bind: { prod: ['ws-prod'] },
      tables: {
        'prod.hr.employees': { owner: 'hr_admins', cols: clone(EMP_COLS), rows: clone(EMP_ROWS) },
        'prod.crm.customers': { owner: 'crm_owners', cols: clone(CUS_COLS), rows: clone(CUS_ROWS) }
      },
      owners: { prod: 'platform_admins', 'prod.hr': 'hr_admins', 'prod.crm': 'crm_owners' },
      grants: [
        { p: 'analysts', priv: 'USE CATALOG', on: 'prod' },
        { p: 'analysts', priv: 'USE SCHEMA', on: 'prod.hr' },
        { p: 'analysts', priv: 'SELECT', on: 'prod.hr' },
        { p: 'analysts', priv: 'USE SCHEMA', on: 'prod.crm' },
        { p: 'analysts', priv: 'SELECT', on: 'prod.crm.customers' },
        { p: 'hr_admins', priv: 'USE CATALOG', on: 'prod' },
        { p: 'hr_pipelines', priv: 'USE CATALOG', on: 'prod' },
        { p: 'hr_pipelines', priv: 'USE SCHEMA', on: 'prod.hr' },
        { p: 'hr_pipelines', priv: 'SELECT', on: 'prod.hr.employees' },
        { p: 'hr_pipelines', priv: 'MODIFY', on: 'prod.hr.employees' }
      ],
      mapping: [{ g: 'analysts_hu', c: 'HU' }, { g: 'analysts_de', c: 'DE' }],
      mode: 'none',
      rules: { filter: true, exempt: ['hr_admins'], masks: { salary: 'null', national_id: 'last4', email: 'none' } },
      viewFixed: false,
      policies: [
        { id: 'mask_national_ids', kind: 'mask', tag: 'pii=national_id', fn: 'last4', except: 'hr_admins', on: true },
        { id: 'mask_salaries', kind: 'mask', tag: 'pii=salary', fn: 'null', except: 'hr_admins', on: true },
        { id: 'mask_emails', kind: 'mask', tag: 'pii=email', fn: 'email', except: 'hr_admins', on: true },
        { id: 'rows_by_country', kind: 'filter', tag: 'geo=country', fn: 'mapping', except: 'hr_admins', on: true }
      ],
      run: { as: 'bence@corp.com', ws: 'ws-prod', target: 'prod.hr.employees' },
      showHidden: true, tab: 'who', dataTable: 'prod.hr.employees', log: [], mission: null, note: null
    };
  }
  var S = fresh();

  // ------------------------------------------------------------------ model
  function isGroup(id) { return id === 'account users' || Object.prototype.hasOwnProperty.call(S.groups, id); }
  function principal(id) { return S.users.concat(S.sps).find(function (u) { return u.id === id; }); }
  function pIcon(id) { if (isGroup(id)) return '👥'; var p = principal(id); return p ? p.icon : '❔'; }
  function pName(id) { var p = principal(id); return p ? p.label : id; }
  // every group the principal is in, directly or through nested groups, plus `account users`
  function groupsOf(pid) {
    var out = { 'account users': true }, changed = true;
    while (changed) {
      changed = false;
      Object.keys(S.groups).forEach(function (g) {
        if (out[g]) return;
        if (S.groups[g].some(function (m) { return m === pid || out[m]; })) { out[g] = true; changed = true; }
      });
    }
    return out;
  }
  function selfAndGroups(pid) { var s = groupsOf(pid); s[pid] = true; return s; }
  function chain(sec) { var p = sec.split('.'), out = []; for (var i = 1; i <= p.length; i++) out.push(p.slice(0, i).join('.')); return out; }
  function ownerOf(sec) { return S.tables[sec] ? S.tables[sec].owner : sec === 'prod.hr.employees_v' ? 'hr_admins' : S.owners[sec]; }
  function check(pid, priv, sec) {
    var P = selfAndGroups(pid), ch = chain(sec), i, g;
    for (i = 0; i < ch.length; i++) { var o = ownerOf(ch[i]); if (o && P[o]) return { ok: true, why: 'owner of <code>' + ch[i] + '</code>' + (o !== pid ? ' (through <b>' + o + '</b>)' : '') }; }
    for (i = 0; i < S.grants.length; i++) {
      g = S.grants[i];
      if (P[g.p] && ch.indexOf(g.on) >= 0 && (g.priv === priv || g.priv === 'ALL PRIVILEGES'))
        return { ok: true, why: '<code>' + g.priv + '</code> on <code>' + g.on + '</code>' + (g.p !== pid ? ' through <b>' + g.p + '</b>' : '') + (g.on !== sec ? ' <i>(inherited)</i>' : '') };
    }
    return { ok: false };
  }
  function securables() {
    var out = ['prod', 'prod.hr', 'prod.crm'];
    Object.keys(S.tables).forEach(function (t) { out.push(t); });
    if (S.mode === 'view') out.push('prod.hr.employees_v');
    return out;
  }
  function targets() { var t = Object.keys(S.tables); if (S.mode === 'view') t.splice(1, 0, 'prod.hr.employees_v'); return t; }
  function allPrincipals() { return S.users.map(function (u) { return u.id; }).concat(S.sps.map(function (s) { return s.id; })); }

  function maskValue(v, fn) {
    if (v === null || v === undefined) return null;
    var s = String(v);
    switch (fn) {
      case 'null': return null;
      case 'last4': return typeof v === 'number' ? null : '***-**-' + s.slice(-4);
      case 'hash': var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'sha2:' + ('0000000' + h.toString(16)).slice(-8) + '…';
      case 'email': return s.indexOf('@') > 0 ? '***' + s.slice(s.indexOf('@')) : '***';
      case 'band': return typeof v === 'number' ? Math.floor(v / 10000) * 10000 : null;
      case 'redact': return '[REDACTED]';
      default: return v;
    }
  }
  function rowAllowed(P, country) { return S.mapping.some(function (m) { return m.c === country && P[m.g]; }); }

  // the protections that apply when `pid` reads table `t` (via `viaView` or directly)
  function protections(pid, t, viaView) {
    var P = selfAndGroups(pid), tb = S.tables[t], out = { filter: null, masks: {}, fns: {}, notes: [], error: null };
    var exempt = S.rules.exempt.some(function (g) { return P[g]; });
    if ((S.mode === 'rfcm' && t === 'prod.hr.employees') || viaView) {
      if (S.rules.filter && !exempt) out.filter = { col: 'country', why: viaView ? 'WHERE clause of the view' : 'row filter <code>country_filter</code>' };
      Object.keys(S.rules.masks).forEach(function (c) { var m = S.rules.masks[c]; if (m !== 'none' && !exempt) { out.masks[c] = m; out.fns[c] = viaView ? 'CASE in the view' : MASKS[m].fn; } });
      if (exempt) out.notes.push('🟢 <b>' + S.rules.exempt.filter(function (g) { return P[g]; }).join(', ') + '</b> is on the exemption list, so the functions return the real data.');
    }
    if (S.mode === 'abac') {
      var colMasks = {}, filters = [];
      S.policies.forEach(function (pol) {
        if (!pol.on) return;
        if (pol.except && P[pol.except]) return;
        tb.cols.forEach(function (c) {
          if (c.tag !== pol.tag) return;
          if (pol.kind === 'mask') (colMasks[c.n] = colMasks[c.n] || []).push(pol);
          else filters.push({ pol: pol, col: c.n });
        });
      });
      Object.keys(colMasks).forEach(function (c) {
        if (colMasks[c].length > 1) out.error = 'Column <code>' + c + '</code> is matched by two mask policies (' + colMasks[c].map(function (p) { return p.id; }).join(', ') + '). A column can only have one effective mask, so the query fails. Change one policy.';
        out.masks[c] = colMasks[c][0].fn; out.fns[c] = 'policy ' + colMasks[c][0].id;
      });
      if (filters.length > 1) out.error = 'Two row filter policies match this table. Only one row filter can apply to a table.';
      if (filters.length) out.filter = { col: filters[0].col, why: 'policy <code>' + filters[0].pol.id + '</code>' };
      var skipped = S.policies.filter(function (pol) { return pol.on && pol.except && P[pol.except] && tb.cols.some(function (c) { return c.tag === pol.tag; }); });
      if (skipped.length) out.notes.push('🟢 Member of <b>' + skipped[0].except + '</b>, the EXCEPT group, so ' + skipped.map(function (p) { return '<code>' + p.id + '</code>'; }).join(', ') + ' do not apply.');
    }
    return out;
  }

  function runQuery(pid, ws, target) {
    var r = { trace: [], ok: true, notes: [] }, P = selfAndGroups(pid);
    function step(label, ok, why) { r.trace.push({ label: label, ok: ok, why: why }); if (!ok) r.ok = false; return ok; }
    var cat = target.split('.')[0], sch = target.split('.').slice(0, 2).join('.');
    var assigned = (S.ws[ws] || []).filter(function (x) { return P[x]; });
    if (!step('Assigned to workspace <code>' + ws + '</code>', assigned.length > 0, assigned.length ? 'through <b>' + assigned[0] + '</b>' : 'not assigned, so the login itself fails')) return r;
    var b = S.bind[cat];
    if (!step('Catalog <code>' + cat + '</code> reachable from <code>' + ws + '</code>', !b || b.indexOf(ws) >= 0, !b ? 'not bound: open to every workspace' : b.indexOf(ws) >= 0 ? 'bound to ' + b.join(', ') : 'bound only to ' + (b.join(', ') || 'no workspace'))) return r;
    var c1 = check(pid, 'USE CATALOG', cat); if (!step('<code>USE CATALOG</code> on <code>' + cat + '</code>', c1.ok, c1.why || 'missing')) return r;
    var c2 = check(pid, 'USE SCHEMA', sch); if (!step('<code>USE SCHEMA</code> on <code>' + sch + '</code>', c2.ok, c2.why || 'missing')) return r;
    var c3 = check(pid, 'SELECT', target); if (!step('<code>SELECT</code> on <code>' + target + '</code>', c3.ok, c3.why || 'missing: grant it on the table, or on the schema for this and future tables')) return r;
    var viaView = target === 'prod.hr.employees_v', base = viaView ? 'prod.hr.employees' : target, tb = S.tables[base];
    if (viaView) step('View owner can read <code>prod.hr.employees</code>', true, 'the view runs with the rights of its owner, <b>hr_admins</b>');
    var pr = protections(pid, base, viaView);
    if (pr.error) { r.ok = false; r.trace.push({ label: 'Policies', ok: false, why: pr.error }); return r; }
    r.notes = pr.notes;
    if (S.mode === 'view' && !viaView && base === 'prod.hr.employees' && !S.rules.exempt.some(function (g) { return P[g]; }))
      r.notes.push('⚠️ <b>Bypass.</b> The protection lives in the view, but this principal can read the base table directly and sees everything. Readers should get <code>SELECT</code> on the view only.');
    if (S.mode === 'rfcm' && base !== 'prod.hr.employees' && tb.cols.some(function (c) { return c.tag && c.tag.indexOf('pii') === 0; }))
      r.notes.push('⚠️ Row filters and masks are attached <b>table by table</b>. Nobody attached any to <code>' + base + '</code>, so its PII is visible.');
    var ci = {}; tb.cols.forEach(function (c, i) { ci[c.n] = i; });
    r.cols = tb.cols.map(function (c) { return { n: c.n, masked: !!pr.masks[c.n], fn: pr.fns[c.n], tag: c.tag }; });
    r.rows = tb.rows.map(function (row) {
      var hidden = pr.filter ? !rowAllowed(P, row[ci[pr.filter.col]]) : false;
      return { hidden: hidden, cells: row.map(function (v, i) { var c = tb.cols[i].n; return pr.masks[c] ? { v: maskValue(v, pr.masks[c]), m: true } : { v: v }; }) };
    });
    r.visible = r.rows.filter(function (x) { return !x.hidden; }).length;
    r.filter = pr.filter;
    r.sql = rewritten(target, base, tb, pr, viaView);
    return r;
  }
  function rewritten(target, base, tb, pr, viaView) {
    var cols = tb.cols.map(function (c) {
      if (!pr.masks[c.n]) return c.n;
      return (viaView ? 'CASE WHEN … ELSE ' + MASKS[pr.masks[c.n]].fn + '(' + c.n + ') END' : MASKS[pr.masks[c.n]].fn + '(' + c.n + ')') + ' AS ' + c.n;
    });
    var s = '-- you wrote\nSELECT * FROM ' + target + ';\n\n-- the engine runs, in effect\nSELECT ' + cols.join(',\n       ') + '\nFROM ' + base;
    if (pr.filter) s += '\nWHERE ' + (S.mode === 'abac' ? 'filter_by_mapping' : viaView ? 'is_account_group_member(…) OR EXISTS (… country_access …)' : 'country_filter') + (viaView ? '' : '(' + pr.filter.col + ')');
    return s + ';';
  }

  // ------------------------------------------------------------------ SQL log
  function log(sql, note) { S.log.unshift({ sql: sql, note: note || '' }); if (S.log.length > 40) S.log.pop(); }
  function q(id) { return '`' + id + '`'; }
  function lit(v) { return typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"; }

  function modeSql() {
    var r = S.rules, ex = r.exempt.map(function (g) { return "is_account_group_member('" + g + "')"; }).join(' OR ') || 'FALSE';
    var maskCols = Object.keys(r.masks).filter(function (c) { return r.masks[c] !== 'none'; });
    if (S.mode === 'none') return '-- No protection: grants decide whether a principal can read the whole table.\nSELECT * FROM prod.hr.employees;';
    if (S.mode === 'view') {
      var cols = EMP_COLS.map(function (c) {
        return r.masks[c.n] && r.masks[c.n] !== 'none' ? '  CASE WHEN ' + ex + '\n       THEN ' + c.n + ' ELSE ' + MASKS[r.masks[c.n]].fn + '(' + c.n + ') END AS ' + c.n : '  ' + c.n;
      });
      return 'CREATE OR REPLACE VIEW prod.hr.employees_v AS\nSELECT\n' + cols.join(',\n') + '\nFROM prod.hr.employees e' +
        (r.filter ? '\nWHERE ' + ex + '\n   OR EXISTS (SELECT 1 FROM prod.sec.country_access m\n              WHERE m.country = e.country\n                AND is_account_group_member(m.group_name));' : ';') +
        '\n\n-- readers get the view, never the table\nGRANT SELECT ON TABLE prod.hr.employees_v TO `analysts`;' + (S.viewFixed ? '\nREVOKE SELECT ON SCHEMA prod.hr FROM `analysts`;' : '\n-- ⚠️ analysts still have SELECT ON SCHEMA prod.hr → they can skip the view');
    }
    if (S.mode === 'rfcm') {
      var s = '';
      if (r.filter) s += 'CREATE OR REPLACE FUNCTION prod.sec.country_filter(c STRING)\nRETURNS BOOLEAN\nRETURN ' + ex + '\n    OR EXISTS (SELECT 1 FROM prod.sec.country_access m\n               WHERE m.country = c AND is_account_group_member(m.group_name));\n\nALTER TABLE prod.hr.employees SET ROW FILTER prod.sec.country_filter ON (country);\n';
      maskCols.forEach(function (c) {
        var col = EMP_COLS.find(function (x) { return x.n === c; }), t = col.num ? 'DOUBLE' : 'STRING';
        s += '\nCREATE OR REPLACE FUNCTION prod.sec.' + MASKS[r.masks[c]].fn + '_' + c + '(v ' + t + ')\nRETURNS ' + t + '\nRETURN CASE WHEN ' + ex + ' THEN v ELSE ' + maskExpr(r.masks[c], 'v', col.num) + ' END;\n' +
          'ALTER TABLE prod.hr.employees ALTER COLUMN ' + c + ' SET MASK prod.sec.' + MASKS[r.masks[c]].fn + '_' + c + ';\n';
      });
      return s || '-- nothing attached yet';
    }
    return S.policies.filter(function (p) { return p.on; }).map(function (p) {
      var kv = p.tag.split('=');
      return 'CREATE POLICY ' + p.id + '\nON CATALOG prod\n' + (p.kind === 'mask' ? 'COLUMN MASK prod.sec.' + MASKS[p.fn].fn : 'ROW FILTER prod.sec.filter_by_mapping') +
        '\nTO `account users`' + (p.except ? ' EXCEPT ' + q(p.except) : '') + '\nFOR TABLES\nMATCH COLUMNS has_tag_value(\'' + kv[0] + "', '" + kv[1] + "') AS c\n" + (p.kind === 'mask' ? 'ON COLUMN c;' : 'USING COLUMNS (c);');
    }).join('\n\n') || '-- no policy is switched on';
  }
  function maskExpr(m, v, num) {
    switch (m) {
      case 'null': return 'NULL';
      case 'last4': return num ? 'NULL' : "concat('***-**-', right(" + v + ', 4))';
      case 'hash': return num ? 'NULL' : 'sha2(' + v + ', 256)';
      case 'email': return "concat('***', substring(" + v + ", instr(" + v + ", '@')))";
      case 'band': return num ? 'floor(' + v + ' / 10000) * 10000' : 'NULL';
      case 'redact': return num ? 'NULL' : "'[REDACTED]'";
    }
    return v;
  }

  // ------------------------------------------------------------------ missions
  var MISSIONS = [
    { id: 'joiner', icon: '🚪', title: 'The new joiner', setup: function () { S.mode = 'none'; S.run = { as: 'dan@corp.com', ws: 'ws-prod', target: 'prod.hr.employees' }; S.tab = 'who'; },
      text: 'Dan joined today and cannot read anything. Read the access check on the right: where does it stop? Fix it in <b>👥 Identities</b> without touching any grant: put Dan in the right <b>group</b>, and the group already has the workspace and the grants.' },
    { id: 'wsdev', icon: '🌍', title: 'Wrong workspace', setup: function () { S.mode = 'none'; S.run = { as: 'bence@corp.com', ws: 'ws-dev', target: 'prod.hr.employees' }; S.tab = 'who'; },
      text: 'Bence has every grant, but he is working in <code>ws-dev</code>. The <code>prod</code> catalog is <b>bound</b> to <code>ws-prod</code> only. Grants do not help here. Try the binding switch under <b>🏢 Workspaces</b>, then put it back: production data should not be reachable from dev.' },
    { id: 'bypass', icon: '🪞', title: 'Bypass the view', setup: function () { S.mode = 'view'; S.viewFixed = false; restoreSchemaSelect(); S.run = { as: 'bence@corp.com', ws: 'ws-prod', target: 'prod.hr.employees' }; S.tab = 'protect'; },
      text: 'A dynamic view <code>employees_v</code> hides salaries and other countries. Bence queries the <b>table</b> instead and sees everything. Why? Look at the grants: <code>SELECT ON SCHEMA prod.hr</code> covers the base table. Press <b>Fix the grants</b> in 🛡️ Protection, then try both targets again.' },
    { id: 'rfcm', icon: '🎭', title: 'Filters and masks', setup: function () { S.mode = 'rfcm'; S.run = { as: 'carla@corp.com', ws: 'ws-prod', target: 'prod.hr.employees' }; S.tab = 'protect'; },
      text: 'The same rules now live <b>on the table</b>. There is no second object to bypass. Open <b>Compare everyone</b>, then query <code>prod.crm.customers</code> as Carla: its e-mails are visible, because nobody attached a mask to that table.' },
    { id: 'pipeline', icon: '🤖', title: 'The job sees nothing', setup: function () { S.mode = 'rfcm'; S.run = { as: 'sp-hr-pipeline', ws: 'ws-prod', target: 'prod.hr.employees' }; S.tab = 'protect'; },
      text: 'The nightly job runs as the service principal <code>sp-hr-pipeline</code>. It has SELECT and MODIFY, yet it reads 0 rows: the row filter applies to it too. A MERGE would then work on an empty table. Add <b>hr_pipelines</b> to the exemption list.' },
    { id: 'abac', icon: '🏷️', title: 'Policies follow tags', setup: function () { S.mode = 'abac'; S.run = { as: 'carla@corp.com', ws: 'ws-prod', target: 'prod.crm.customers' }; S.tab = 'protect'; },
      text: 'Four ABAC policies sit on the <code>prod</code> catalog. They mask any column tagged <code>pii</code> and filter on any column tagged <code>geo=country</code>, in every table. Create <code>prod.crm.leads</code> and query it as Carla. If she gets a SELECT error, it is a grant problem, not a policy problem. Fix it at the right level.' },
    { id: 'rows', icon: '➕', title: 'New rows, same rules', setup: function () { S.mode = 'rfcm'; S.run = { as: 'bence@corp.com', ws: 'ws-prod', target: 'prod.hr.employees' }; S.tab = 'data'; S.dataTable = 'prod.hr.employees'; },
      text: 'Add a new employee in <b>📋 Data</b>: first one in <code>HU</code>, then one in <code>FR</code>. Who sees them? Then give <code>analysts_de</code> access to <code>FR</code> in the <code>country_access</code> mapping table. The function stays the same.' }
  ];
  function restoreSchemaSelect() {
    if (!S.grants.some(function (g) { return g.p === 'analysts' && g.priv === 'SELECT' && g.on === 'prod.hr'; })) S.grants.push({ p: 'analysts', priv: 'SELECT', on: 'prod.hr' });
    S.grants = S.grants.filter(function (g) { return !(g.on === 'prod.hr.employees_v'); });
  }

  // ------------------------------------------------------------------ rendering
  var root = null;
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function pchip(id, x) { return '<span class="pc ' + (isGroup(id) ? 'grp' : principal(id) && principal(id).id.indexOf('sp-') === 0 ? 'sp' : 'usr') + '">' + pIcon(id) + ' ' + esc(isGroup(id) ? id : pName(id)) + (x ? '<i data-act="' + x + '" title="remove">✕</i>' : '') + '</span>'; }

  function render(el) {
    if (el) root = el;
    if (!root) return;
    if (!S.tables[S.run.target] && S.run.target !== 'prod.hr.employees_v') S.run.target = 'prod.hr.employees';
    if (S.run.target === 'prod.hr.employees_v' && S.mode !== 'view') S.run.target = 'prod.hr.employees';
    var mis = S.mission ? MISSIONS.find(function (m) { return m.id === S.mission; }) : null;
    root.innerHTML =
      '<div class="lab">' +
      '<div class="missions"><span class="mh">Missions:</span>' + MISSIONS.map(function (m, i) { return '<button data-act="mission" data-id="' + m.id + '" class="' + (S.mission === m.id ? 'on' : '') + '">' + (i + 1) + ' · ' + m.icon + ' ' + m.title + '</button>'; }).join('') +
      '<button data-act="reset" class="rst" title="Start the lab again">↺ reset lab</button></div>' +
      (mis ? '<div class="mtext">' + mis.icon + ' ' + mis.text + '</div>' : '<div class="mtext soft">Pick a mission above, or just play: change identities, grants, data and protection on the left. The query on the right runs again after every change.</div>') +
      '<div class="labgrid"><div class="lpane">' + setupHtml() + '</div><div class="rpane">' + runHtml() + '</div></div></div>';
  }

  function setupHtml() {
    var tabs = [['who', '👥 Identities'], ['ws', '🏢 Workspaces'], ['grants', '🔑 Grants'], ['data', '📋 Data'], ['protect', '🛡️ Protection']];
    var h = '<div class="ltabs">' + tabs.map(function (t) { return '<button data-act="tab" data-id="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="lbody">';
    if (S.tab === 'who') h += whoHtml();
    else if (S.tab === 'ws') h += wsHtml();
    else if (S.tab === 'grants') h += grantsHtml();
    else if (S.tab === 'data') h += dataHtml();
    else h += protectHtml();
    return h + '</div>';
  }

  function whoHtml() {
    var h = '<div class="lsec"><h5>Users and service principals <small>account level, synced from the identity provider (SCIM)</small></h5><div class="plist">';
    S.users.concat(S.sps).forEach(function (u) {
      var g = Object.keys(groupsOf(u.id)).filter(function (x) { return x !== 'account users'; });
      h += '<div class="prow"><span class="pi">' + u.icon + '</span><div><b>' + esc(u.label) + '</b> <small>' + esc(u.id) + ' · ' + esc(u.role) + '</small><div class="pg">' +
        (g.length ? g.map(function (x) { return '<span class="pc grp">👥 ' + esc(x) + '</span>'; }).join('') : '<span class="pc none">only account users</span>') + '</div></div></div>';
    });
    h += '</div><div class="frm"><input id="nu" placeholder="new user, e.g. eva@corp.com"><button data-act="adduser">+ user</button><input id="nsp" placeholder="sp-…"><button data-act="addsp">+ service principal</button></div></div>';
    h += '<div class="lsec"><h5>Account groups <small>grant to groups, not people · groups can contain groups</small></h5><div class="glist">';
    Object.keys(S.groups).forEach(function (g) {
      h += '<div class="grow"><b>👥 ' + esc(g) + '</b><div class="pg">' + (S.groups[g].length ? S.groups[g].map(function (m, i) { return pchip(m, 'rmmem" data-g="' + esc(g) + '" data-i="' + i); }).join('') : '<small class="soft">empty</small>') + '</div></div>';
    });
    var members = allPrincipals().concat(Object.keys(S.groups));
    h += '</div><div class="frm">Add <select id="mm">' + members.map(function (m) { return opt(m, (isGroup(m) ? '👥 ' + m : pIcon(m) + ' ' + pName(m))); }).join('') + '</select> to <select id="mg">' +
      Object.keys(S.groups).map(function (g) { return opt(g, g); }).join('') + '</select><button data-act="addmem">add</button></div>' +
      '<div class="frm"><input id="ng" placeholder="new group, e.g. data_scientists"><button data-act="addgroup">+ group</button></div></div>';
    return h;
  }

  function wsHtml() {
    var h = '<div class="lsec"><h5>Workspace assignment <small>an identity must be assigned to a workspace to log in</small></h5>';
    Object.keys(S.ws).forEach(function (w) {
      h += '<div class="grow"><b>🏢 ' + w + '</b><div class="pg">' + S.ws[w].map(function (m, i) { return pchip(m, 'rmws" data-w="' + w + '" data-i="' + i); }).join('') + '</div></div>';
    });
    h += '<div class="frm">Assign <select id="wm">' + allPrincipals().concat(Object.keys(S.groups)).map(function (m) { return opt(m, isGroup(m) ? '👥 ' + m : pIcon(m) + ' ' + pName(m)); }).join('') +
      '</select> to <select id="ww">' + Object.keys(S.ws).map(function (w) { return opt(w, w); }).join('') + '</select><button data-act="addws">assign</button></div></div>';
    h += '<div class="lsec"><h5>Catalog binding <small>which workspaces may reach a catalog at all</small></h5><table class="ltbl"><tr><th>catalog</th>' + Object.keys(S.ws).map(function (w) { return '<th>' + w + '</th>'; }).join('') + '</tr>';
    Object.keys(S.bind).forEach(function (c) {
      h += '<tr><td><code>' + c + '</code></td>' + Object.keys(S.ws).map(function (w) { var on = S.bind[c].indexOf(w) >= 0; return '<td><label class="toggle"><input type="checkbox" data-act="bind" data-c="' + c + '" data-w="' + w + '"' + (on ? ' checked' : '') + '><span class="sw"></span></label></td>'; }).join('') + '</tr>';
    });
    h += '</table><p class="hint">A bound catalog is invisible in other workspaces, whatever the grants say. Typical use: <code>prod</code> only in the production workspace.</p></div>';
    h += '<div class="lsec"><h5>One metastore, many workspaces</h5><div class="mini-ms"><div class="msbox">🗄️ metastore <small>eu-central</small><div>📚 prod → 🗂️ hr, crm</div></div><div class="wsrow">' + Object.keys(S.ws).map(function (w) { return '<span class="wsb">🏢 ' + w + '</span>'; }).join('') + '</div></div></div>';
    return h;
  }

  var PRIVS = ['USE CATALOG', 'USE SCHEMA', 'SELECT', 'MODIFY', 'BROWSE', 'ALL PRIVILEGES'];
  function grantsHtml() {
    var h = '<div class="lsec"><h5>Grants <small>allow-only, no DENY · a grant on a container covers everything inside, now and later</small></h5><table class="ltbl gt"><tr><th>principal</th><th>privilege</th><th>on</th><th></th></tr>';
    S.grants.forEach(function (g, i) { h += '<tr><td>' + pchip(g.p) + '</td><td><code>' + g.priv + '</code></td><td><code>' + g.on + '</code></td><td><button class="x" data-act="revoke" data-i="' + i + '" title="REVOKE">✕</button></td></tr>'; });
    h += '</table><div class="frm">GRANT <select id="gpriv">' + PRIVS.map(function (p) { return opt(p, p); }).join('') + '</select> ON <select id="gon">' + securables().map(function (s) { return opt(s, s); }).join('') +
      '</select> TO <select id="gp">' + Object.keys(S.groups).concat(['account users']).concat(allPrincipals()).map(function (m) { return opt(m, isGroup(m) ? '👥 ' + m : pIcon(m) + ' ' + pName(m)); }).join('') + '</select><button data-act="grant">grant</button></div></div>';
    h += '<div class="lsec"><h5>Owners <small>the owner has every privilege on the object and everything inside it</small></h5><table class="ltbl">';
    ['prod', 'prod.hr', 'prod.crm'].concat(Object.keys(S.tables)).forEach(function (s) { h += '<tr><td><code>' + s + '</code></td><td>' + pchip(ownerOf(s)) + '</td></tr>'; });
    return h + '</table></div>';
  }

  function dataHtml() {
    var t = S.tables[S.dataTable] ? S.dataTable : 'prod.hr.employees', tb = S.tables[t];
    var h = '<div class="lsec"><div class="frm" style="margin:0 0 8px">Table <select data-act="datatable">' + Object.keys(S.tables).map(function (x) { return opt(x, x); }).join('') + '</select><small class="soft">owner: ' + esc(tb.owner) + '</small></div>' +
      '<div class="dwrap"><table class="dt2"><tr>' + tb.cols.map(function (c, i) {
        return '<th>' + c.n + '<select class="tagsel" data-act="tag" data-i="' + i + '" title="governed tag on this column">' + TAGS.map(function (x) { return opt(x, x ? '🏷️ ' + x : '＋ tag'); }).join('').replace('value="' + esc(c.tag || '') + '"', 'value="' + esc(c.tag || '') + '" selected') + '</select></th>';
      }).join('') + '<th></th></tr>';
    tb.rows.forEach(function (r, ri) { h += '<tr>' + r.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '<td><button class="x" data-act="delrow" data-i="' + ri + '" title="DELETE">✕</button></td></tr>'; });
    h += '<tr class="newrow">' + tb.cols.map(function (c, i) { return '<td><input data-nc="' + i + '" placeholder="' + c.n + '"' + (c.n === 'country' ? ' value="HU"' : '') + '></td>'; }).join('') + '<td><button data-act="addrow" title="INSERT">＋</button></td></tr></table></div>' +
      '<p class="hint">Tags matter only for ABAC policies. Rows you add are INSERTs into the real table: every protection applies to them at once.</p></div>';
    h += '<div class="lsec"><h5>prod.sec.country_access <small>the mapping table that row filters look up</small></h5><table class="ltbl"><tr><th>group_name</th><th>country</th><th></th></tr>' +
      S.mapping.map(function (m, i) { return '<tr><td>' + pchip(m.g) + '</td><td><code>' + esc(m.c) + '</code></td><td><button class="x" data-act="delmap" data-i="' + i + '">✕</button></td></tr>'; }).join('') +
      '</table><div class="frm"><select id="mapg">' + Object.keys(S.groups).map(function (g) { return opt(g, g); }).join('') + '</select><input id="mapc" placeholder="country, e.g. FR" style="width:150px"><button data-act="addmap">+ row</button></div></div>';
    return h;
  }

  function rulesHtml() {
    var r = S.rules;
    return '<div class="rules"><label class="toggle"><input type="checkbox" data-act="rfilter"' + (r.filter ? ' checked' : '') + '><span class="sw"></span> row filter: only countries in <code>country_access</code> for your groups</label>' +
      '<div class="mrow">' + Object.keys(r.masks).map(function (c) {
        var num = c === 'salary';
        return '<label>mask <code>' + c + '</code> <select data-act="rmask" data-c="' + c + '">' + Object.keys(MASKS).filter(function (k) { return num ? ['none', 'null', 'band'].indexOf(k) >= 0 : k !== 'band'; }).map(function (k) { return opt(k, MASKS[k].label, r.masks[c]); }).join('') + '</select></label>';
      }).join('') + '</div>' +
      '<div class="mrow">exempt groups (see real data): ' + Object.keys(S.groups).map(function (g) { return '<label class="chk"><input type="checkbox" data-act="rexempt" data-g="' + g + '"' + (r.exempt.indexOf(g) >= 0 ? ' checked' : '') + '> ' + g + '</label>'; }).join('') + '</div></div>';
  }
  function protectHtml() {
    var modes = [['none', '∅ Nothing'], ['view', '🪞 Dynamic view'], ['rfcm', '🎭 Row filter + masks'], ['abac', '🏷️ ABAC policies']];
    var h = '<div class="modes">' + modes.map(function (m) { return '<button data-act="mode" data-id="' + m[0] + '" class="' + (S.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>';
    if (S.mode === 'none') h += '<p class="hint big">No fine-grained protection. Whoever passes the grant check reads every row and every value. Pick a mode above.</p>';
    if (S.mode === 'view') h += '<p class="hint big">A <b>second object</b>, <code>prod.hr.employees_v</code>, applies the rules. The table itself is untouched. Query the view <i>and</i> the table on the right.</p>' + rulesHtml() +
      '<div class="frm"><button data-act="fixview"' + (S.viewFixed ? ' disabled' : '') + '>🔧 Fix the grants: SELECT on the view only</button>' + (S.viewFixed ? '<span class="ok">✓ analysts now read only through the view</span>' : '') + '</div>';
    if (S.mode === 'rfcm') h += '<p class="hint big">The rules are <b>functions attached to the table</b> <code>prod.hr.employees</code>. Every query on it is rewritten, whoever runs it and from whatever tool.</p>' + rulesHtml();
    if (S.mode === 'abac') {
      h += '<p class="hint big">Policies sit on the <b>catalog</b> and pick their columns by <b>tag</b>. They cover every current and future table in <code>prod</code>. Retag columns in 📋 Data.</p><table class="ltbl pol"><tr><th></th><th>policy</th><th>matches tag</th><th>function</th><th>except</th></tr>';
      S.policies.forEach(function (p, i) {
        h += '<tr><td><label class="toggle"><input type="checkbox" data-act="pon" data-i="' + i + '"' + (p.on ? ' checked' : '') + '><span class="sw"></span></label></td><td><code>' + p.id + '</code><br><small>' + (p.kind === 'mask' ? 'COLUMN MASK' : 'ROW FILTER') + '</small></td>' +
          '<td><select data-act="ptag" data-i="' + i + '">' + TAGS.filter(Boolean).map(function (t) { return opt(t, t, p.tag); }).join('') + '</select></td><td>' +
          (p.kind === 'mask' ? '<select data-act="pfn" data-i="' + i + '">' + Object.keys(MASKS).filter(function (k) { return k !== 'none'; }).map(function (k) { return opt(k, MASKS[k].label, p.fn); }).join('') + '</select>' : 'mapping table') +
          '</td><td><select data-act="pex" data-i="' + i + '">' + opt('', '(nobody)', p.except) + Object.keys(S.groups).map(function (g) { return opt(g, g, p.except); }).join('') + '</select></td></tr>';
      });
      h += '</table><div class="frm">' + Object.keys(NEW_TABLES).map(function (t) { return '<button data-act="newtable" data-t="' + t + '"' + (S.tables[t] ? ' disabled' : '') + '>' + (S.tables[t] ? '✓ ' : '＋ CREATE TABLE ') + t + '</button>'; }).join('') + '</div>';
    }
    h += '<div class="sqlbox"><div class="sh">SQL behind this setup</div><pre>' + hl(modeSql()) + '</pre></div>';
    return h;
  }
  function hl(s) {
    return esc(s).replace(/(--[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(CREATE|OR|REPLACE|VIEW|FUNCTION|RETURNS|RETURN|CASE|WHEN|THEN|ELSE|END|SELECT|FROM|WHERE|EXISTS|AND|AS|ALTER|TABLE|SET|ROW|FILTER|ON|COLUMN|MASK|GRANT|REVOKE|TO|POLICY|CATALOG|SCHEMA|EXCEPT|FOR|TABLES|MATCH|COLUMNS|USING|INSERT|INTO|VALUES|DELETE|TAGS|USE|MODIFY|NULL|STRING|DOUBLE|BOOLEAN)\b/g, '<span class="kw">$1</span>');
  }

  function runHtml() {
    var r = runQuery(S.run.as, S.run.ws, S.run.target);
    var h = '<div class="runbar"><label>run as <select data-act="as">' + allPrincipals().map(function (p) { return opt(p, pIcon(p) + ' ' + pName(p), S.run.as); }).join('') + '</select></label>' +
      '<label>in <select data-act="ws">' + Object.keys(S.ws).map(function (w) { return opt(w, w, S.run.ws); }).join('') + '</select></label></div>' +
      '<div class="qline"><span class="kw">SELECT</span> * <span class="kw">FROM</span> <select data-act="target">' + targets().map(function (t) { return opt(t, t, S.run.target); }).join('') + '</select></div>';
    h += '<div class="trace">' + r.trace.map(function (t, i) { return '<div class="tr ' + (t.ok ? 'ok' : 'no') + '" style="animation-delay:' + i * 0.06 + 's"><span class="ti">' + (t.ok ? '✓' : '✗') + '</span><span class="tl">' + t.label + '</span><span class="tw">' + t.why + '</span></div>'; }).join('') + '</div>';
    if (!r.ok) {
      h += '<div class="qerr">' + (r.trace.length && r.trace[r.trace.length - 1].label.indexOf('Assigned') === 0 ? '🚫 ' + esc(pName(S.run.as)) + ' cannot even open the workspace.' : '🚫 PERMISSION_DENIED. No file was read.') + '</div>';
    } else {
      h += (r.notes.length ? '<div class="qnotes">' + r.notes.map(function (n) { return '<div>' + n + '</div>'; }).join('') + '</div>' : '') +
        '<div class="rhead"><b>' + r.visible + ' of ' + r.rows.length + ' rows</b> ' + (r.filter ? '<span class="chip2 f">🚦 ' + r.filter.why + '</span>' : '') +
        r.cols.filter(function (c) { return c.masked; }).map(function (c) { return '<span class="chip2 m">🎭 ' + c.n + '</span>'; }).join('') +
        '<label class="chk" style="margin-left:auto"><input type="checkbox" data-act="showhidden"' + (S.showHidden ? ' checked' : '') + '> show filtered rows</label></div>' +
        '<div class="dwrap res"><table class="dt2"><tr>' + r.cols.map(function (c) { return '<th class="' + (c.masked ? 'mk' : '') + '"' + (c.fn ? ' title="' + esc(c.fn.replace(/<[^>]+>/g, '')) + '"' : '') + '>' + c.n + (c.masked ? ' 🎭' : '') + '</th>'; }).join('') + '</tr>' +
        r.rows.filter(function (x) { return S.showHidden || !x.hidden; }).map(function (x) {
          return '<tr class="' + (x.hidden ? 'gone' : '') + '">' + x.cells.map(function (c) { return '<td class="' + (c.m ? 'mk' : '') + '">' + (c.v === null ? '<i class="nul">NULL</i>' : esc(c.v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table></div>' +
        '<details class="rsql"><summary>What the engine really runs</summary><pre>' + hl(r.sql) + '</pre></details>';
    }
    h += '<details class="cmpall"' + (S.cmpOpen ? ' open' : '') + '><summary data-act="cmp">👀 Compare everyone on <code>' + S.run.target + '</code> in <code>' + S.run.ws + '</code></summary>' + compareHtml() + '</details>';
    h += '<details class="slog"' + (S.logOpen ? ' open' : '') + '><summary data-act="logt">📜 What you changed, as SQL (' + S.log.length + ')</summary>' + (S.log.length ? S.log.map(function (l) { return '<pre>' + hl(l.sql) + '</pre>'; }).join('') : '<p class="hint">Nothing yet.</p>') + '</details>';
    return h;
  }
  function compareHtml() {
    return '<table class="ltbl cmp2"><tr><th>who</th><th>result</th><th>masked columns</th></tr>' + allPrincipals().map(function (p) {
      var r = runQuery(p, S.run.ws, S.run.target);
      var res = r.ok ? '<b>' + r.visible + '</b> / ' + r.rows.length + ' rows' : '<span class="no">✗ ' + r.trace[r.trace.length - 1].label.replace(/<[^>]+>/g, '') + '</span>';
      var masked = r.ok ? r.cols.filter(function (c) { return c.masked; }).map(function (c) { return c.n; }).join(', ') || '—' : '';
      return '<tr' + (p === S.run.as ? ' class="me"' : '') + '><td>' + pIcon(p) + ' ' + esc(pName(p)) + '</td><td>' + res + '</td><td>' + masked + '</td></tr>';
    }).join('') + '</table>';
  }

  // ------------------------------------------------------------------ events
  function val(id) { var e = root.querySelector('#' + id); return e ? e.value.trim() : ''; }
  function act(e) {
    var t = e.target.closest('[data-act]'); if (!t || !root.contains(t)) return;
    var a = t.dataset.act, d = t.dataset, changed = true;
    var isChange = e.type === 'change';
    if (isChange !== (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return;
    switch (a) {
      case 'mission': var m = MISSIONS.find(function (x) { return x.id === d.id; }); S.mission = m.id; m.setup(); break;
      case 'reset': var keep = S.tab; S = fresh(); S.tab = keep; break;
      case 'tab': S.tab = d.id; break;
      case 'adduser': var u = val('nu'); if (!u || principal(u)) return; if (u.indexOf('@') < 0) u += '@corp.com'; S.users.push({ id: u, label: u.split('@')[0].replace(/^./, function (c) { return c.toUpperCase(); }), role: 'new user', icon: '🙂' }); log('-- Account console → User management → Add user (or SCIM from your IdP)\n-- ' + u); break;
      case 'addsp': var s = val('nsp'); if (!s || principal(s)) return; if (s.indexOf('sp-') !== 0) s = 'sp-' + s; S.sps.push({ id: s, label: s, role: 'new service principal', icon: '🤖' }); log('-- Account console → Service principals → Add: ' + s + '\n-- jobs run as it, with an OAuth secret instead of a personal token'); break;
      case 'addgroup': var g = val('ng').replace(/\s+/g, '_'); if (!g || isGroup(g)) return; S.groups[g] = []; log('-- Account console → Groups → Add group: ' + g); break;
      case 'addmem': var mm = val('mm'), mg = val('mg'); if (mm === mg || S.groups[mg].indexOf(mm) >= 0) return; if (isGroup(mm) && groupsOf(mg)[mm] === undefined && Object.keys(groupsOf(mm)).indexOf(mg) >= 0) return; S.groups[mg].push(mm); log('-- Account console → Groups → ' + mg + ' → Add member: ' + mm); break;
      case 'rmmem': var rm = S.groups[d.g].splice(+d.i, 1)[0]; log('-- Account console → Groups → ' + d.g + ' → Remove member: ' + rm); break;
      case 'addws': var wm = val('wm'), ww = val('ww'); if (S.ws[ww].indexOf(wm) >= 0) return; S.ws[ww].push(wm); log('-- Account console → Workspaces → ' + ww + ' → Permissions → Add: ' + wm); break;
      case 'rmws': var rw = S.ws[d.w].splice(+d.i, 1)[0]; log('-- Account console → Workspaces → ' + d.w + ' → remove: ' + rw); break;
      case 'bind': var bl = S.bind[d.c]; if (t.checked) bl.push(d.w); else bl.splice(bl.indexOf(d.w), 1); log('-- Catalog Explorer → ' + d.c + ' → Workspaces: ' + (t.checked ? 'assign ' : 'unassign ') + d.w + '\n-- the catalog is bound to: ' + (bl.join(', ') || 'no workspace')); break;
      case 'grant': var gr = { p: val('gp'), priv: val('gpriv'), on: val('gon') };
        if (S.grants.some(function (x) { return x.p === gr.p && x.priv === gr.priv && x.on === gr.on; })) return;
        if (gr.priv === 'USE CATALOG' && gr.on.indexOf('.') >= 0) { flash('USE CATALOG is granted on a catalog.'); return; }
        if (gr.priv === 'USE SCHEMA' && gr.on.split('.').length > 2) { flash('USE SCHEMA is granted on a schema or a catalog.'); return; }
        S.grants.push(gr); log('GRANT ' + gr.priv + ' ON ' + kind(gr.on) + ' ' + gr.on + ' TO ' + q(gr.p) + ';'); break;
      case 'revoke': var rv = S.grants.splice(+d.i, 1)[0]; log('REVOKE ' + rv.priv + ' ON ' + kind(rv.on) + ' ' + rv.on + ' FROM ' + q(rv.p) + ';'); break;
      case 'datatable': S.dataTable = t.value; break;
      case 'tag': var tb = S.tables[S.dataTable], col = tb.cols[+d.i]; col.tag = t.value || undefined;
        log(t.value ? 'ALTER TABLE ' + S.dataTable + ' ALTER COLUMN ' + col.n + " SET TAGS ('" + t.value.split('=')[0] + "' = '" + t.value.split('=')[1] + "');" : 'ALTER TABLE ' + S.dataTable + ' ALTER COLUMN ' + col.n + ' UNSET TAGS (…);'); break;
      case 'delrow': var tb2 = S.tables[S.dataTable], dr = tb2.rows.splice(+d.i, 1)[0]; log('DELETE FROM ' + S.dataTable + ' WHERE ' + tb2.cols[0].n + ' = ' + lit(dr[0]) + ';'); break;
      case 'addrow': var tb3 = S.tables[S.dataTable], row = tb3.cols.map(function (c, i) { var v = (root.querySelector('[data-nc="' + i + '"]') || {}).value || ''; v = v.trim(); return c.num || i === 0 ? (v === '' ? (i === 0 ? nextId(tb3) : 0) : +v) : (c.n === 'country' ? v.toUpperCase() : v) || '—'; });
        tb3.rows.push(row); log('INSERT INTO ' + S.dataTable + ' VALUES (' + row.map(lit).join(', ') + ');'); break;
      case 'delmap': var dm = S.mapping.splice(+d.i, 1)[0]; log("DELETE FROM prod.sec.country_access WHERE group_name = '" + dm.g + "' AND country = '" + dm.c + "';"); break;
      case 'addmap': var mc = val('mapc').toUpperCase(), mgp = val('mapg'); if (!mc) return; S.mapping.push({ g: mgp, c: mc }); log("INSERT INTO prod.sec.country_access VALUES ('" + mgp + "', '" + mc + "');\n-- no function and no table changed: the next query already sees it"); break;
      case 'mode': S.mode = d.id; if (d.id === 'view' && !S.viewFixed) restoreSchemaSelect(); log(modeSql()); break;
      case 'rfilter': S.rules.filter = t.checked; log(modeSql()); break;
      case 'rmask': S.rules.masks[d.c] = t.value; log(modeSql()); break;
      case 'rexempt': var ex = S.rules.exempt; if (t.checked) ex.push(d.g); else ex.splice(ex.indexOf(d.g), 1); log(modeSql()); break;
      case 'fixview': S.viewFixed = true; S.grants = S.grants.filter(function (g) { return !(g.p === 'analysts' && g.priv === 'SELECT' && g.on === 'prod.hr'); });
        S.grants.push({ p: 'analysts', priv: 'SELECT', on: 'prod.hr.employees_v' }); S.run.target = 'prod.hr.employees';
        log('REVOKE SELECT ON SCHEMA prod.hr FROM `analysts`;\nGRANT SELECT ON TABLE prod.hr.employees_v TO `analysts`;\n-- ⚠️ the schema grant also covered departments and future tables: grant those again one by one if needed'); break;
      case 'pon': S.policies[+d.i].on = t.checked; log(t.checked ? modeSql() : 'DROP POLICY ' + S.policies[+d.i].id + ' ON CATALOG prod;'); break;
      case 'ptag': S.policies[+d.i].tag = t.value; log(modeSql()); break;
      case 'pfn': S.policies[+d.i].fn = t.value; log(modeSql()); break;
      case 'pex': S.policies[+d.i].except = t.value; log(modeSql()); break;
      case 'newtable': var nt = d.t, def = clone(NEW_TABLES[nt]); S.tables[nt] = def; S.run.target = nt; S.dataTable = nt;
        log('CREATE TABLE ' + nt + ' (' + def.cols.map(function (c) { return c.n + (c.num ? ' DOUBLE' : c.n.indexOf('_id') > 0 ? ' BIGINT' : ' STRING'); }).join(', ') + ');\n' +
          def.cols.filter(function (c) { return c.tag; }).map(function (c) { return 'ALTER TABLE ' + nt + ' ALTER COLUMN ' + c.n + " SET TAGS ('" + c.tag.split('=')[0] + "' = '" + c.tag.split('=')[1] + "');"; }).join('\n') +
          '\n-- no ALTER ... SET MASK: the catalog policies match the tags'); break;
      case 'as': S.run.as = t.value; break;
      case 'ws': S.run.ws = t.value; break;
      case 'target': S.run.target = t.value; break;
      case 'showhidden': S.showHidden = t.checked; break;
      case 'cmp': e.preventDefault(); S.cmpOpen = !S.cmpOpen; break;
      case 'logt': e.preventDefault(); S.logOpen = !S.logOpen; break;
      default: changed = false;
    }
    if (changed) { var sc = root.closest('.wbody'), top = sc ? sc.scrollTop : 0, lb = root.querySelector('.lbody'), lt = lb ? lb.scrollTop : 0; render(); if (sc) sc.scrollTop = top; var lb2 = root.querySelector('.lbody'); if (lb2) lb2.scrollTop = lt; }
  }
  function kind(sec) { var n = sec.split('.').length; return n === 1 ? 'CATALOG' : n === 2 ? 'SCHEMA' : 'TABLE'; }
  function nextId(tb) { return tb.rows.reduce(function (m, r) { return Math.max(m, +r[0] || 0); }, 0) + 1; }
  function flash(msg) { var m = root.querySelector('.mtext'); if (m) { m.innerHTML = '⚠️ ' + msg; m.classList.add('shake'); } }

  function mount(el) {
    root = el;
    el.addEventListener('click', act);
    el.addEventListener('change', act);
    render();
  }
  window.GovLab = {
    mount: mount, render: render,
    reset: function () { S = fresh(); render(); },
    mission: function (id) { var m = MISSIONS.find(function (x) { return x.id === id; }); if (m) { S.mission = id; m.setup(); render(); } },
    // read-only helpers for the story scenes
    run: function (pid, ws, target) { return runQuery(pid, ws, target); }
  };
})();
