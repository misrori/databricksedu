/* Governance storyboard: six small labs, one idea each.
   Every lab has the same shape:
     left:  numbered SQL (or admin console) cards, each with a ▶ Run button (and ↺ undo once it ran)
     right: the original data as stored, and "what does this person see?" after the cards you ran
   Labs: ident (users, groups, workspaces), grants (USE CATALOG / USE SCHEMA / SELECT / READ VOLUME / BROWSE),
         view (dynamic view and its bypass), rowfilter, mask, abac (governed tags + policies).
   Registers window.GovLabs = { <key>: { mount(el), reset(), result(pid, target) } }. */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  // ------------------------------------------------------------------ people and data
  var PEOPLE = {
    anna: { id: 'anna@corp.com', n: 'Anna', i: '👩‍💼' },
    bence: { id: 'bence@corp.com', n: 'Bence', i: '🧑‍💻' },
    carla: { id: 'carla@corp.com', n: 'Carla', i: '👩‍💻' },
    dan: { id: 'dan@corp.com', n: 'Dan', i: '🧑' },
    sp: { id: 'sp-hr-pipeline', n: 'sp-hr-pipeline', i: '🤖' }
  };
  var BASE_GROUPS = { hr_admins: ['anna'], analysts: ['analysts_hu', 'analysts_de'], analysts_hu: ['bence'], analysts_de: ['carla'] };
  var EMP_COLS = ['employee_id', 'full_name', 'country', 'department', 'salary', 'national_id', 'email'];
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
  var NEW_EMP = [
    [109, 'Zoltan Szabo', 'HU', 'Sales', 66900, '318-44-2290', 'zoltan.szabo@corp.com'],
    [110, 'Mia Hoffmann', 'DE', 'HR', 71800, '426-09-7731', 'mia.hoffmann@corp.com'],
    [111, 'Pedro Alves', 'ES', 'IT', 80200, '537-62-1048', 'pedro.alves@corp.com'],
    [112, 'Kata Molnar', 'HU', 'Finance', 58300, '649-27-5512', 'kata.molnar@corp.com']
  ];

  function groupsOf(groups, pid) {
    var out = ['account users'], changed = true;
    while (changed) {
      changed = false;
      Object.keys(groups).forEach(function (g) {
        if (out.indexOf(g) < 0 && groups[g].some(function (m) { return m === pid || out.indexOf(m) >= 0; })) { out.push(g); changed = true; }
      });
    }
    return out;
  }
  function member(S, pid, g) { return groupsOf(S.groups, pid).indexOf(g) >= 0; }
  function pick(row, idx) { return idx.map(function (i) { return row[i]; }); }
  function idxOf(cols) { return cols.map(function (c) { return EMP_COLS.indexOf(c); }); }

  // INSERT card shared by several labs
  function insertCard() {
    return {
      title: 'A new employee arrives', repeat: true,
      can: function (S) { return S.emp.length < EMP_ROWS.length + NEW_EMP.length; },
      sql: function (S) {
        var r = NEW_EMP[S.emp.length - EMP_ROWS.length];
        if (!r) return '-- no more sample rows: press ↺ reset lab';
        return 'INSERT INTO prod.hr.employees VALUES\n  (' + r.map(function (v) { return typeof v === 'number' ? v : "'" + v + "'"; }).join(', ') + ');';
      },
      note: 'Run it more than once. The rules are on the data, so new rows follow them without any change.',
      run: function (S) { var r = NEW_EMP[S.emp.length - EMP_ROWS.length]; if (!r) return { err: 'No more sample rows.' }; S.emp.push(r.slice()); return '1 row inserted: ' + r[1] + ' (' + r[2] + ').'; }
    };
  }

  // ------------------------------------------------------------------ SQL highlighting
  var KW = /\b(CREATE|REPLACE|FUNCTION|RETURNS|RETURN|CASE|WHEN|THEN|ELSE|END|ALTER|TABLE|SET|UNSET|ROW|FILTER|ON|COLUMN|MASK|DROP|GRANT|REVOKE|TO|FROM|SELECT|USE|CATALOG|SCHEMA|VOLUME|READ|VIEW|AS|WHERE|AND|OR|INSERT|INTO|VALUES|POLICY|FOR|TABLES|MATCH|COLUMNS|EXCEPT|TAGS|BROWSE|LIST|STRING|INT|NULL|BOOLEAN)\b/g;
  function hlCode(s) {
    return s.split(/('[^']*'|`[^`]*`)/).map(function (p, i) {
      return i % 2 ? '<span class="st">' + esc(p) + '</span>' : esc(p).replace(KW, '<span class="kw">$1</span>');
    }).join('');
  }
  function hl(sql) {
    return sql.split('\n').map(function (line) {
      if (/^\s*(#|--)/.test(line)) return '<span class="cm">' + esc(line) + '</span>';
      if (/^\s*databricks /.test(line)) return '<span class="cli">' + esc(line) + '</span>';
      return hlCode(line);
    }).join('\n');
  }

  // ------------------------------------------------------------------ rendering helpers
  function cell(v) {
    var mk = v !== null && typeof v === 'object', x = mk ? v.v : v;
    var s = x === null ? '<i class="nul">NULL</i>' : esc(x);
    return '<td class="' + (mk ? 'mk' : '') + '">' + s + '</td>';
  }
  function tbl(cols, rows, ghost) {
    return '<div class="slwrap"><table class="dt2 sltbl"><tr>' + cols.map(function (c) {
      return '<th class="' + (c.mk ? 'mk' : '') + '">' + esc(c.n) + (c.tag ? '<span class="sltag">🏷️ ' + esc(c.tag) + '</span>' : '') + (c.mk ? ' 🎭' : '') + '</th>';
    }).join('') + '</tr>' + rows.filter(function (r) { return !r.hidden || ghost; }).map(function (r) {
      return '<tr class="' + (r.hidden ? 'ghost' : '') + (r.fresh ? ' fresh' : '') + '">' + r.c.map(cell).join('') + '</tr>';
    }).join('') + '</table></div>';
  }
  function plainCols(names) { return names.map(function (n) { return { n: n }; }); }
  function fail(msg, trace) { return { err: msg, trace: trace || [] }; }

  // ------------------------------------------------------------------ the lab engine
  function Lab(cfg) {
    var S, root = null, msgs = {}, view = { pid: cfg.people[0], target: null, ghost: false };
    function targets() { return cfg.targets ? cfg.targets(S) : [[null, cfg.query || '']]; }
    function reset() {
      S = cfg.init(); S.ran = {}; msgs = {};
      view = { pid: cfg.people[0], target: targets()[0][0], ghost: false };
      if (root) draw();
    }
    function sqlOf(c) { return typeof c.sql === 'function' ? c.sql(S) : c.sql; }
    function isDone(c, i) { return c.repeat ? false : c.done ? c.done(S) : !!S.ran[i]; }
    function cardHtml(c, i) {
      var done = isDone(c, i), m = msgs[i], b;
      if (done) b = '<span class="okd">✓ done</span>' + (c.undo ? '<button data-undo="' + i + '" title="Runs: ' + esc(c.undo.sql) + '">↺ ' + (c.undo.label || 'undo') + '</button>' : '');
      else b = '<button class="run" data-run="' + i + '"' + (c.can && !c.can(S) ? ' disabled' : '') + '>▶ Run</button>';
      return '<div class="slc' + (done ? ' done' : '') + (m && m.bad ? ' err' : '') + (c.warn ? ' warn' : '') + '"><div class="slh"><span class="n">' + (i + 1) + '</span><span class="t">' + c.title + '</span>' + b + '</div>' +
        '<pre class="slsql">' + hl(sqlOf(c)) + '</pre>' +
        (c.note ? '<div class="slnote">' + c.note + '</div>' : '') +
        (m ? '<div class="slmsg ' + (m.bad ? 'bad' : 'ok') + '">' + m.t + '</div>' : '') + '</div>';
    }
    function resultHtml(r) {
      var h = r.pre || '';
      if (r.trace && r.trace.length) h += '<div class="sltrace">' + r.trace.map(function (t) { return '<div class="' + (t[0] ? 'ok' : 'no') + '">' + (t[0] ? '✓' : '✗') + ' ' + t[1] + '</div>'; }).join('') + '</div>';
      if (r.err) return h + '<div class="slerr">🚫 ' + r.err + '</div>';
      if (r.html) h += r.html;
      if (r.cols) {
        var vis = r.rows.filter(function (x) { return !x.hidden; }).length, hid = r.rows.length - vis, mk = r.cols.filter(function (c) { return c.mk; }).length;
        h += '<div class="slcount"><span><b>' + vis + '</b> of ' + r.rows.length + ' ' + (r.unit || 'rows') + (hid ? ' · ' + hid + ' filtered out, they never leave the engine' : '') + (mk ? ' · 🎭 ' + mk + ' masked column' + (mk > 1 ? 's' : '') : '') + '</span>' +
          (hid ? '<label class="slghost"><input type="checkbox" data-ghost ' + (view.ghost ? 'checked' : '') + '> show what was filtered</label>' : '') + '</div>';
        h += tbl(r.cols, r.rows, view.ghost);
      }
      if (r.note) h += '<div class="slwarn">' + r.note + '</div>';
      return h;
    }
    function summary(pid) {
      var r = cfg.see(S, pid, view.target);
      if (r.sum) return r.sum;
      if (r.err) return '✗ denied';
      if (r.cols) {
        var vis = r.rows.filter(function (x) { return !x.hidden; }).length, mk = r.cols.filter(function (c) { return c.mk; }).length;
        return vis + ' ' + (r.unit || 'rows') + (mk ? ' · 🎭 ' + mk : '');
      }
      return '✓';
    }
    function draw(flash) {
      var ts = targets();
      if (!ts.some(function (t) { return t[0] === view.target; })) view.target = ts[0][0];
      var q = ts.length > 1 ? '<select data-target>' + ts.map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === view.target ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select>' : '<span>' + esc(ts[0][1]) + '</span>';
      var groups = function (pid) { return groupsOf(S.groups, pid).filter(function (g) { return g !== 'account users'; }).join(', ') || (cfg.pnote && cfg.pnote[pid]) || 'no groups'; };
      root.innerHTML = '<div class="sl">' +
        '<div class="slgoal"><div>' + cfg.goal + '</div><button data-reset title="Start this lab again">↺ reset lab</button></div>' +
        '<div class="slgrid"><div class="slcards"><h5>' + (cfg.cardsTitle || '① Run these, top to bottom') + '</h5>' + cfg.cards.map(cardHtml).join('') + '</div>' +
        '<div class="slright">' +
        '<div class="slp"><h5>' + cfg.leftTitle(S, view.target) + '</h5>' + cfg.left(S, view.target) + '</div>' +
        '<div class="slp slsee' + (flash ? ' flash' : '') + '"><h5>② What does this person see?</h5>' +
        '<div class="slpeople">' + cfg.people.map(function (p) { var P = PEOPLE[p]; return '<button data-pid="' + p + '" class="' + (p === view.pid ? 'on' : '') + '">' + P.i + ' ' + P.n + ' <small>' + esc(groups(p)) + '</small></button>'; }).join('') + '</div>' +
        '<div class="slq"><span class="as">as ' + PEOPLE[view.pid].n + ' ▶</span>' + q + '</div>' +
        '<div class="slres">' + resultHtml(cfg.see(S, view.pid, view.target)) + '</div>' +
        '<div class="slcmp"><b>Everyone:</b>' + cfg.people.map(function (p) { return '<span class="' + (p === view.pid ? 'me' : '') + '" data-pid="' + p + '">' + PEOPLE[p].i + ' ' + PEOPLE[p].n + ': ' + summary(p) + '</span>'; }).join('') + '</div>' +
        '</div></div></div></div>';
    }
    function run(i) {
      var c = cfg.cards[i], r = c.run(S);
      if (r && r.err) msgs[i] = { bad: 1, t: '✗ ' + r.err };
      else {
        S.ran[i] = true;
        var t = typeof r === 'string' ? r : r && r.msg;
        msgs[i] = { t: '✓ ' + (t || 'OK') };
        if (r && r.target) view.target = r.target;
      }
      draw(true);
    }
    function undo(i) {
      var c = cfg.cards[i];
      c.undo.run(S); S.ran[i] = false;
      msgs[i] = { t: '↺ Ran: <code>' + esc(c.undo.sql) + '</code>' };
      draw(true);
    }
    function mount(el) {
      root = el;
      el.onclick = function (e) {
        var b = e.target.closest('[data-run],[data-undo],[data-pid],[data-reset]');
        if (!b || b.disabled) return;
        if (b.dataset.run) run(+b.dataset.run);
        else if (b.dataset.undo) undo(+b.dataset.undo);
        else if (b.dataset.pid) { view.pid = b.dataset.pid; draw(true); }
        else if (b.hasAttribute('data-reset')) reset();
      };
      el.onchange = function (e) {
        if (e.target.hasAttribute('data-target')) { view.target = e.target.value; draw(true); }
        if (e.target.hasAttribute('data-ghost')) { view.ghost = e.target.checked; draw(); }
      };
      draw();
    }
    reset();
    return { mount: mount, reset: reset, result: function (pid, t) { return cfg.see(S, pid, t === undefined ? view.target : t); } };
  }

  // generic "grant" card
  function grantCard(title, priv, type, on, who, note, warn) {
    var g = { p: who, priv: priv, on: on };
    var same = function (x) { return x.p === g.p && x.priv === g.priv && x.on === g.on; };
    return {
      title: title, note: note, warn: warn,
      sql: 'GRANT ' + priv + ' ON ' + type + ' ' + on + ' TO `' + who + '`;',
      done: function (S) { return S.grants.some(same); },
      run: function (S) { if (S.needs && S.needs[on] && !S.needs[on](S)) return { err: '[TABLE_OR_VIEW_NOT_FOUND] ' + on + ' does not exist yet.' }; S.grants.push(clone(g)); return 'Granted.'; },
      undo: { label: 'REVOKE', sql: 'REVOKE ' + priv + ' ON ' + type + ' ' + on + ' FROM `' + who + '`;', run: function (S) { S.grants = S.grants.filter(function (x) { return !same(x); }); } }
    };
  }
  function has(S, pid, priv, path) {
    var gs = groupsOf(S.groups, pid).concat([pid]);
    return S.grants.some(function (g) { return gs.indexOf(g.p) >= 0 && g.priv === priv && (path === g.on || path.indexOf(g.on + '.') === 0); });
  }
  function groupCard(title, group, pid, note) {
    return {
      title: title, note: note,
      sql: '# Account console › User management › Groups › ' + group + ' › Add members\n' + PEOPLE[pid].id,
      done: function (S) { return (S.groups[group] || []).indexOf(pid) >= 0; },
      run: function (S) {
        if (S.users && S.users.indexOf(pid) < 0) return { err: PEOPLE[pid].id + ' is not in the account yet. Run the step that adds the user first.' };
        (S.groups[group] = S.groups[group] || []).push(pid); return PEOPLE[pid].n + ' is now a member of ' + group + '.';
      },
      undo: { label: 'remove', sql: '# Groups › ' + group + ' › remove ' + PEOPLE[pid].id, run: function (S) { S.groups[group] = S.groups[group].filter(function (m) { return m !== pid; }); } }
    };
  }

  var LABS = {};

  // ================================================================== 1. users, groups, workspaces
  LABS.ident = Lab({
    goal: '🏢 <b>Who may log in?</b> Identities live at the <b>account</b>. A workspace only lets in the users, groups and service principals that are <b>assigned</b> to it. Add Dan, put him in a group, open the workspace for the group, then do the same for a job.',
    cardsTitle: '① Admin steps (account console or CLI), top to bottom',
    people: ['dan', 'bence', 'sp', 'anna'],
    pnote: { dan: 'new joiner', sp: 'nightly HR job' },
    query: 'Open https://ws-prod.cloud.databricks.com',
    init: function () { return { users: ['anna', 'bence', 'carla'], sps: [], groups: { hr_admins: ['anna'], analysts: ['bence', 'carla'] }, assign: { hr_admins: 'User' } }; },
    cards: [
      {
        title: 'Add Dan to the account',
        sql: '# Account console › User management › Users › Add user\ndatabricks account users create \\\n  --user-name dan@corp.com --display-name "Dan"',
        note: 'In real life the identity provider usually does this (SCIM sync).',
        done: function (S) { return S.users.indexOf('dan') >= 0; },
        run: function (S) { S.users.push('dan'); return 'Dan exists in the account. He still cannot log in anywhere.'; },
        undo: { label: 'delete', sql: 'databricks account users delete <dan-id>', run: function (S) { S.users = S.users.filter(function (u) { return u !== 'dan'; }); Object.keys(S.groups).forEach(function (g) { S.groups[g] = S.groups[g].filter(function (m) { return m !== 'dan'; }); }); delete S.assign.dan; } }
      },
      groupCard('Put Dan into the analysts group', 'analysts', 'dan', 'Access is given to groups, so joining a group is all a new person needs.'),
      {
        title: 'Open ws-prod for the analysts group',
        sql: '# Account console › Workspaces › ws-prod › Permissions › Add permissions\nanalysts  →  User',
        note: 'Assign groups, not single people.',
        done: function (S) { return !!S.assign.analysts; },
        run: function (S) { S.assign.analysts = 'User'; return 'Every member of analysts can log in to ws-prod.'; },
        undo: { label: 'remove', sql: '# ws-prod › Permissions › remove analysts', run: function (S) { delete S.assign.analysts; } }
      },
      {
        title: 'Create a service principal for the nightly job',
        sql: '# Account console › User management › Service principals › Add\ndatabricks account service-principals create \\\n  --display-name sp-hr-pipeline',
        note: 'Jobs run as a service principal, not as a person who may leave the company.',
        done: function (S) { return S.sps.indexOf('sp') >= 0; },
        run: function (S) { S.sps.push('sp'); return 'sp-hr-pipeline exists. Like Dan, it is not in any workspace yet.'; },
        undo: { label: 'delete', sql: 'databricks account service-principals delete <sp-id>', run: function (S) { S.sps = []; delete S.assign.sp; } }
      },
      {
        title: 'Let the job into ws-prod',
        sql: '# Account console › Workspaces › ws-prod › Permissions › Add permissions\nsp-hr-pipeline  →  User',
        done: function (S) { return !!S.assign.sp; },
        run: function (S) { if (S.sps.indexOf('sp') < 0) return { err: 'sp-hr-pipeline does not exist yet. Run step 4 first.' }; S.assign.sp = 'User'; return 'The job can run in ws-prod.'; },
        undo: { label: 'remove', sql: '# ws-prod › Permissions › remove sp-hr-pipeline', run: function (S) { delete S.assign.sp; } }
      },
      {
        title: 'Make the HR admins workspace admins',
        sql: '# Account console › Workspaces › ws-prod › Permissions\nhr_admins  →  Admin',
        note: 'Workspace admin manages the workspace (clusters, jobs, settings). It does <b>not</b> grant data in Unity Catalog.',
        done: function (S) { return S.assign.hr_admins === 'Admin'; },
        run: function (S) { S.assign.hr_admins = 'Admin'; return 'Anna is a workspace admin in ws-prod.'; },
        undo: { label: 'back to User', sql: '# ws-prod › Permissions › hr_admins → User', run: function (S) { S.assign.hr_admins = 'User'; } }
      }
    ],
    leftTitle: function () { return '🏢 The account right now'; },
    left: function (S) {
      var chip = function (p) { return '<span class="slchip">' + PEOPLE[p].i + ' ' + PEOPLE[p].id + '</span>'; };
      return '<div class="slacct"><div><b>Users</b> ' + S.users.map(chip).join('') + '</div>' +
        '<div><b>Service principals</b> ' + (S.sps.length ? S.sps.map(chip).join('') : '<i>none</i>') + '</div>' +
        '<div><b>Groups</b>' + Object.keys(S.groups).map(function (g) { return '<div class="slgrp">👥 ' + g + ': ' + (S.groups[g].length ? S.groups[g].map(function (m) { return PEOPLE[m] ? PEOPLE[m].n : m; }).join(', ') : '<i>empty</i>') + '</div>'; }).join('') + '</div>' +
        '<div><b>ws-prod permissions</b>' + Object.keys(S.assign).map(function (k) { return '<div class="slgrp">🚪 ' + (PEOPLE[k] ? PEOPLE[k].n : k) + ' → ' + S.assign[k] + '</div>'; }).join('') + '</div></div>';
    },
    see: function (S, pid) {
      var exists = S.users.indexOf(pid) >= 0 || S.sps.indexOf(pid) >= 0;
      var gs = exists ? groupsOf(S.groups, pid) : [];
      var via = null, role = null;
      [pid].concat(gs).forEach(function (k) { if (S.assign[k] && (!role || S.assign[k] === 'Admin')) { role = S.assign[k]; via = k; } });
      var f = function (ok, t) { return '<div class="slf ' + (ok ? 'ok' : 'no') + '">' + t + '</div>'; };
      var html = f(exists, '👤 In the account: <b>' + (exists ? 'yes' : 'no') + '</b>') +
        f(gs.length > 1, '👥 Groups: <b>' + (gs.filter(function (g) { return g !== 'account users'; }).join(', ') || 'none') + '</b>') +
        f(!!role, '🚪 Log in to ws-prod: ' + (role ? '<b>yes</b>, as ' + role + ' through <b>' + (PEOPLE[via] ? PEOPLE[via].n : via) + '</b>' : '<b>no</b>, not assigned (neither directly nor through a group)')) +
        f(role === 'Admin', '🛠️ Workspace admin: <b>' + (role === 'Admin' ? 'yes' : 'no') + '</b>') +
        '<div class="slf info">📚 Which tables they read is decided by Unity Catalog grants, not by the workspace. That is the next lab.</div>';
      return { html: '<div class="slfacts">' + html + '</div>', sum: !exists ? 'not in account' : role ? '✓ logs in' + (role === 'Admin' ? ' (admin)' : '') : '✗ no login' };
    }
  });

  // ================================================================== 2. grants
  var PAYROLL = [[101, '2026-10', 5100], [102, '2026-10', 7040], [104, '2026-10', 9360], [107, '2026-10', 5870]];
  var DOCS = [['handbook/employee_handbook.pdf', '1.4 MB'], ['handbook/travel_policy.pdf', '320 KB'], ['templates/offer_letter.docx', '45 KB']];
  var OBJ = {
    'prod.hr.employees': { type: 'Table', priv: 'SELECT' },
    'prod.hr.payroll': { type: 'Table', priv: 'SELECT' },
    'prod.hr.docs': { type: 'Volume', priv: 'READ VOLUME' },
    'prod.crm.customers': { type: 'Table', priv: 'SELECT' }
  };
  function access(S, pid, path) {
    var parts = path.split('.'), cat = parts[0], sch = parts[0] + '.' + parts[1];
    var o = OBJ[path], tr = [];
    var c1 = has(S, pid, 'USE CATALOG', cat); tr.push([c1, '<code>USE CATALOG</code> on <code>' + cat + '</code>']);
    if (!c1) return { ok: false, tr: tr, err: "[INSUFFICIENT_PERMISSIONS] User does not have USE CATALOG on Catalog '" + cat + "'." };
    var c2 = has(S, pid, 'USE SCHEMA', sch); tr.push([c2, '<code>USE SCHEMA</code> on <code>' + sch + '</code>']);
    if (!c2) return { ok: false, tr: tr, err: "[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on Schema '" + sch + "'." };
    var c3 = has(S, pid, o.priv, path); tr.push([c3, '<code>' + o.priv + '</code> on <code>' + path + '</code>' + (c3 && !S.grants.some(function (g) { return g.on === path && g.priv === o.priv; }) ? ' <small>(inherited from above)</small>' : '')]);
    if (!c3) return { ok: false, tr: tr, err: '[INSUFFICIENT_PERMISSIONS] User does not have ' + o.priv + ' on ' + o.type + " '" + path + "'." };
    return { ok: true, tr: tr };
  }
  function explorer(S, pid) {
    var st = function (path, kind) {
      var parts = path.split('.'), browse = has(S, pid, 'BROWSE', path);
      var cat = has(S, pid, 'USE CATALOG', parts[0]);
      var ok = kind === 'cat' ? cat : kind === 'sch' ? cat && has(S, pid, 'USE SCHEMA', path) : access(S, pid, path).ok;
      return ok ? ['read', kind ? '✓ open' : '✓ can read'] : browse ? ['browse', '👁 name only'] : ['none', '✗ hidden'];
    };
    var line = function (lvl, icon, name, s) { return '<div class="slx l' + lvl + ' ' + s[0] + '"><span>' + icon + ' ' + name + '</span><em>' + s[1] + '</em></div>'; };
    return '<div class="slxpl"><div class="slxh">🧭 Catalog Explorer, as ' + PEOPLE[pid].n + '</div>' + line(0, '📚', 'prod', st('prod', 'cat')) +
      line(1, '🗂️', 'hr', st('prod.hr', 'sch')) + line(2, '📋', 'employees', st('prod.hr.employees')) + line(2, '📋', 'payroll', st('prod.hr.payroll')) + line(2, '📁', 'docs <small>volume</small>', st('prod.hr.docs')) +
      line(1, '🗂️', 'crm', st('prod.crm', 'sch')) + line(2, '📋', 'customers', st('prod.crm.customers')) + '</div>';
  }
  var EMP4 = ['employee_id', 'full_name', 'country', 'department'];
  function dataOf(path) {
    if (path === 'prod.hr.employees') return { cols: plainCols(EMP4), rows: EMP_ROWS.map(function (r) { return { c: pick(r, idxOf(EMP4)) }; }) };
    if (path === 'prod.hr.payroll') return { cols: plainCols(['employee_id', 'month', 'gross']), rows: PAYROLL.map(function (r) { return { c: r }; }) };
    if (path === 'prod.hr.docs') return { cols: plainCols(['path', 'size']), rows: DOCS.map(function (r) { return { c: ['/Volumes/prod/hr/docs/' + r[0], r[1]] }; }), unit: 'files' };
    return { cols: plainCols(['customer_id', 'name', 'country']), rows: [[1, 'Duna Kft', 'HU'], [2, 'Rhein AG', 'DE'], [3, 'Sol SL', 'ES']].map(function (r) { return { c: r }; }) };
  }
  LABS.grants = Lab({
    goal: '🔑 <b>Three doors, all needed.</b> To read a table you need <code>USE CATALOG</code>, <code>USE SCHEMA</code> and <code>SELECT</code>. Files in a volume need <code>READ VOLUME</code> instead of SELECT. Run the grants one by one and watch Bence\'s Catalog Explorer and query change. Then press ↺ REVOKE.',
    people: ['bence', 'dan', 'anna'],
    pnote: { dan: 'new joiner, no groups' },
    init: function () {
      return {
        groups: clone(BASE_GROUPS),
        grants: [{ p: 'hr_admins', priv: 'USE CATALOG', on: 'prod' }, { p: 'hr_admins', priv: 'USE SCHEMA', on: 'prod.hr' }, { p: 'hr_admins', priv: 'SELECT', on: 'prod.hr' }, { p: 'hr_admins', priv: 'READ VOLUME', on: 'prod.hr' }]
      };
    },
    cards: [
      grantCard('Open the catalog', 'USE CATALOG', 'CATALOG', 'prod', 'analysts', 'Alone it shows nothing: it only opens the first door.'),
      grantCard('Open the schema', 'USE SCHEMA', 'SCHEMA', 'prod.hr', 'analysts'),
      grantCard('Read one table', 'SELECT', 'TABLE', 'prod.hr.employees', 'analysts', 'Now <code>employees</code> works, but <code>payroll</code> does not.'),
      grantCard('Read the files in a volume', 'READ VOLUME', 'VOLUME', 'prod.hr.docs', 'analysts', 'Pick <code>LIST \'/Volumes/prod/hr/docs\'</code> on the right.'),
      grantCard('Read every table in the schema', 'SELECT', 'SCHEMA', 'prod.hr', 'analysts', 'Inherited by <code>payroll</code> too, and by tables created tomorrow. Is that what you want?', true),
      grantCard('Let everyone find the names', 'BROWSE', 'CATALOG', 'prod', 'account users', 'Metadata only: people see the names and can request access, but read no data. Look at Dan.'),
      groupCard('Dan joins the analysts group', 'analysts', 'dan', 'No GRANT for Dan himself: he gets what the group has.')
    ],
    targets: function () { return [['prod.hr.employees', 'SELECT * FROM prod.hr.employees'], ['prod.hr.payroll', 'SELECT * FROM prod.hr.payroll'], ['prod.hr.docs', "LIST '/Volumes/prod/hr/docs'"], ['prod.crm.customers', 'SELECT * FROM prod.crm.customers']]; },
    leftTitle: function (S, t) { return '📋 <code>' + t + '</code> as stored · 🔑 grants'; },
    left: function (S, t) {
      var d = dataOf(t);
      return tbl(d.cols, d.rows) + '<div class="slgrants">' + S.grants.map(function (g) { return '<div><code>' + g.priv + '</code> on <code>' + g.on + '</code> → <b>' + g.p + '</b></div>'; }).join('') + '</div>';
    },
    see: function (S, pid, t) {
      var a = access(S, pid, t), pre = explorer(S, pid);
      if (!a.ok) return { pre: pre, trace: a.tr, err: a.err };
      var d = dataOf(t);
      return { pre: pre, trace: a.tr, cols: d.cols, rows: d.rows, unit: d.unit };
    }
  });

  // ================================================================== 3. dynamic view
  var VIEW_COLS = ['employee_id', 'full_name', 'country', 'department', 'salary'];
  function empRows(S, cols, fn) {
    var ix = idxOf(cols);
    return S.emp.map(function (r, k) { var o = fn ? fn(r) : {}; return { c: o.c || pick(r, ix), hidden: o.hidden, fresh: k >= EMP_ROWS.length }; });
  }
  function rowAllowed(S, pid, country) {
    return member(S, pid, 'hr_admins') || (country === 'HU' && member(S, pid, 'analysts_hu')) || (country === 'DE' && member(S, pid, 'analysts_de'));
  }
  LABS.view = Lab({
    goal: '🪞 <b>A dynamic view</b> returns different rows and values depending on who runs it. Readers get SELECT on the <b>view</b>, never on the table. Create it, grant it, add rows, then make the classic mistake in step 4.',
    people: ['bence', 'carla', 'anna'],
    init: function () { return { groups: clone(BASE_GROUPS), emp: clone(EMP_ROWS), view: false, grants: [], needs: { 'prod.hr.employees_v': function (S) { return S.view; } } }; },
    cards: [
      {
        title: 'Create the view',
        sql: "CREATE VIEW prod.hr.employees_v AS\nSELECT employee_id, full_name, country, department,\n  CASE WHEN is_account_group_member('hr_admins')\n       THEN salary ELSE NULL END AS salary\nFROM prod.hr.employees\nWHERE is_account_group_member('hr_admins')\n   OR (country = 'HU' AND is_account_group_member('analysts_hu'))\n   OR (country = 'DE' AND is_account_group_member('analysts_de'));",
        done: function (S) { return S.view; },
        run: function (S) { S.view = true; return { msg: 'View created. Analysts cannot read it yet.', target: 'prod.hr.employees_v' }; },
        undo: { label: 'DROP', sql: 'DROP VIEW prod.hr.employees_v;', run: function (S) { S.view = false; S.grants = S.grants.filter(function (g) { return g.on !== 'prod.hr.employees_v'; }); } }
      },
      grantCard('Grant the view to analysts', 'SELECT', 'VIEW', 'prod.hr.employees_v', 'analysts', 'Readers need SELECT on the view only. The view reads the table with its owner\'s rights.'),
      insertCard(),
      grantCard('⚠️ The mistake: grant the table too', 'SELECT', 'TABLE', 'prod.hr.employees', 'analysts', 'Now switch the query to <code>prod.hr.employees</code> as Bence.', true)
    ],
    targets: function () { return [['prod.hr.employees_v', 'SELECT * FROM prod.hr.employees_v'], ['prod.hr.employees', 'SELECT * FROM prod.hr.employees']]; },
    leftTitle: function () { return '📋 <code>prod.hr.employees</code> as stored'; },
    left: function (S) { return tbl(plainCols(VIEW_COLS), empRows(S, VIEW_COLS)) + '<div class="slnote">Analysts already have <code>USE CATALOG prod</code> and <code>USE SCHEMA prod.hr</code>. HR admins own the schema.</div>'; },
    see: function (S, pid, t) {
      var admin = member(S, pid, 'hr_admins');
      if (t === 'prod.hr.employees_v') {
        if (!S.view) return fail('[TABLE_OR_VIEW_NOT_FOUND] The view prod.hr.employees_v does not exist. Run step 1.');
        if (!admin && !has(S, pid, 'SELECT', t)) return fail("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on View 'prod.hr.employees_v'.");
        return {
          cols: VIEW_COLS.map(function (n) { return { n: n, mk: n === 'salary' && !admin }; }),
          rows: empRows(S, VIEW_COLS, function (r) { var c = pick(r, idxOf(VIEW_COLS)); if (!admin) c[4] = { v: null }; return { c: c, hidden: !rowAllowed(S, pid, r[2]) }; })
        };
      }
      if (!admin && !has(S, pid, 'SELECT', t)) return fail("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'prod.hr.employees'. Good: analysts should use the view.");
      return { cols: plainCols(VIEW_COLS), rows: empRows(S, VIEW_COLS), note: admin ? '' : '⚠️ Every row and every salary. The rules live in the view, so anyone who can read the table goes around them. Press ↺ REVOKE on step 4.' };
    }
  });

  // ================================================================== 4. row filter
  LABS.rowfilter = Lab({
    goal: '🚦 <b>A row filter</b> is a function that returns TRUE or FALSE for each row. Attached to the table, it runs on every query, from every tool. There is no second object to go around. Analysts already have SELECT on the table.',
    people: ['bence', 'carla', 'anna'],
    query: 'SELECT * FROM prod.hr.employees',
    init: function () { return { groups: clone(BASE_GROUPS), emp: clone(EMP_ROWS), fn: false, filter: false }; },
    cards: [
      {
        title: 'Write the rule as a function',
        sql: "CREATE FUNCTION prod.sec.country_filter(country STRING)\nRETURN is_account_group_member('hr_admins')\n    OR (country = 'HU' AND is_account_group_member('analysts_hu'))\n    OR (country = 'DE' AND is_account_group_member('analysts_de'));",
        note: 'Nothing changes yet: a function alone protects nothing.',
        done: function (S) { return S.fn; },
        run: function (S) { S.fn = true; return 'Function created.'; },
        undo: { label: 'DROP', sql: 'DROP FUNCTION prod.sec.country_filter;', run: function (S) { S.fn = false; S.filter = false; } }
      },
      {
        title: 'Attach it to the table',
        sql: 'ALTER TABLE prod.hr.employees\n  SET ROW FILTER prod.sec.country_filter ON (country);',
        done: function (S) { return S.filter; },
        run: function (S) { if (!S.fn) return { err: '[ROUTINE_NOT_FOUND] prod.sec.country_filter does not exist. Run step 1 first.' }; S.filter = true; return 'Every query on the table now goes through the filter.'; },
        undo: { label: 'DROP ROW FILTER', sql: 'ALTER TABLE prod.hr.employees DROP ROW FILTER;', run: function (S) { S.filter = false; } }
      },
      insertCard(),
      groupCard('Bence also joins analysts_de', 'analysts_de', 'bence', 'No SQL change: the function asks about group membership on every query.')
    ],
    leftTitle: function () { return '📋 <code>prod.hr.employees</code> as stored'; },
    left: function (S) { return tbl(plainCols(VIEW_COLS), empRows(S, VIEW_COLS)); },
    see: function (S, pid) {
      return { cols: plainCols(VIEW_COLS), rows: empRows(S, VIEW_COLS, function (r) { return { hidden: S.filter && !rowAllowed(S, pid, r[2]) }; }) };
    }
  });

  // ================================================================== 5. column masks
  var MASK_COLS = ['employee_id', 'full_name', 'salary', 'national_id', 'email'];
  var MASKERS = {
    salary: function () { return null; },
    national_id: function (v) { return '***-**-' + String(v).slice(-4); },
    email: function (v) { return String(v).replace(/^[^@]+/, '***'); }
  };
  function maskCards(col, sig, body, title1, note) {
    var fn = sig.split('(')[0];
    return [
      {
        title: title1, note: note,
        sql: 'CREATE FUNCTION prod.sec.' + sig + '\nRETURN CASE WHEN is_account_group_member(\'hr_admins\')\n  THEN ' + body,
        done: function (S) { return !!S.fns[col]; },
        run: function (S) { S.fns[col] = true; return 'Function created. Nothing is masked yet.'; },
        undo: { label: 'DROP', sql: 'DROP FUNCTION prod.sec.' + fn + ';', run: function (S) { S.fns[col] = false; S.masks[col] = false; } }
      },
      {
        title: 'Attach it to <code>' + col + '</code>',
        sql: 'ALTER TABLE prod.hr.employees\n  ALTER COLUMN ' + col + ' SET MASK prod.sec.' + fn + ';',
        done: function (S) { return !!S.masks[col]; },
        run: function (S) { if (!S.fns[col]) return { err: '[ROUTINE_NOT_FOUND] prod.sec.' + fn + ' does not exist. Create the function first.' }; S.masks[col] = true; return col + ' is masked for everyone outside hr_admins.'; },
        undo: { label: 'DROP MASK', sql: 'ALTER TABLE prod.hr.employees ALTER COLUMN ' + col + ' DROP MASK;', run: function (S) { S.masks[col] = false; } }
      }
    ];
  }
  LABS.mask = Lab({
    goal: '🎭 <b>A column mask</b> is a function that gets the real value and returns what this user may see, with the same type. Every row still comes back; only the values change. Analysts already have SELECT on the table.',
    people: ['bence', 'anna'],
    query: 'SELECT * FROM prod.hr.employees',
    init: function () { return { groups: clone(BASE_GROUPS), fns: {}, masks: {} }; },
    cards: [].concat(
      maskCards('salary', 'mask_salary(salary INT)', 'salary ELSE NULL END;', 'Mask the salary: NULL for others'),
      maskCards('national_id', 'mask_id(id STRING)', "id ELSE concat('***-**-', right(id, 4)) END;", 'Mask the ID: keep the last 4', 'Partial masks keep the column useful (matching on the last 4 digits).'),
      maskCards('email', 'mask_email(email STRING)', "email ELSE regexp_replace(email, '^[^@]+', '***') END;", 'Mask the email: keep the domain')
    ),
    leftTitle: function () { return '📋 <code>prod.hr.employees</code> as stored'; },
    left: function () { return tbl(plainCols(MASK_COLS), EMP_ROWS.map(function (r) { return { c: pick(r, idxOf(MASK_COLS)) }; })); },
    see: function (S, pid) {
      var admin = member(S, pid, 'hr_admins');
      var on = function (n) { return !admin && S.masks[n]; };
      return {
        cols: MASK_COLS.map(function (n) { return { n: n, mk: on(n) }; }),
        rows: EMP_ROWS.map(function (r) { return { c: MASK_COLS.map(function (n) { var v = r[EMP_COLS.indexOf(n)]; return on(n) ? { v: MASKERS[n](v) } : v; }) }; })
      };
    }
  });

  // ================================================================== 6. ABAC
  var ABAC_T = {
    'prod.hr.employees': { cols: ['employee_id', 'full_name', 'country', 'email'], rows: EMP_ROWS.map(function (r) { return [r[0], r[1], r[2], r[6]]; }) },
    'prod.crm.customers': { cols: ['customer_id', 'name', 'country', 'email'], rows: [[1, 'Duna Kft', 'HU', 'info@dunakft.hu'], [2, 'Rhein AG', 'DE', 'kontakt@rhein.de'], [3, 'Sol SL', 'ES', 'hola@sol.es'], [4, 'Tisza Zrt', 'HU', 'office@tisza.hu']] },
    'prod.crm.leads': { cols: ['lead_id', 'contact', 'email'], rows: [[9001, 'Petra Varga', 'petra.varga@mail.hu'], [9002, 'Max Klein', 'max.klein@mail.de']] }
  };
  function tagCard(table, title, note, needsLeads) {
    var key = table + '.email';
    return {
      title: title, note: note,
      sql: 'ALTER TABLE ' + table + '\n  ALTER COLUMN email SET TAGS (\'pii\' = \'email\');',
      done: function (S) { return !!S.tags[key]; },
      run: function (S) { if (needsLeads && !S.leads) return { err: '[TABLE_OR_VIEW_NOT_FOUND] ' + table + ' does not exist yet. Run step 6 first.' }; S.tags[key] = 'pii=email'; return { msg: 'Column tagged pii=email.', target: table }; },
      undo: { label: 'UNSET', sql: 'ALTER TABLE ' + table + ' ALTER COLUMN email UNSET TAGS (\'pii\');', run: function (S) { delete S.tags[key]; } }
    };
  }
  LABS.abac = Lab({
    goal: '🏷️ <b>ABAC: tag once, protect everywhere.</b> Instead of attaching a mask to each table, you tag the sensitive columns and write <b>one policy on the catalog</b>. Every column with the tag is masked, on every table, including tables created tomorrow. Analysts already have SELECT on catalog prod.',
    people: ['bence', 'anna'],
    init: function () { return { groups: clone(BASE_GROUPS), governed: false, tags: {}, fn: false, policy: false, leads: false }; },
    cards: [
      {
        title: 'Define the governed tag',
        sql: '# Catalog Explorer › Govern › Governed tags › Create governed tag\nkey:            pii\nallowed values: email, national_id, salary\nwho may assign: data_stewards',
        note: 'A governed tag has fixed values and controlled assignment, so a policy can trust it.',
        done: function (S) { return S.governed; },
        run: function (S) { S.governed = true; return 'Governed tag pii defined at the account.'; },
        undo: { label: 'delete', sql: '# Governed tags › pii › Delete', run: function (S) { S.governed = false; S.policy = false; } }
      },
      tagCard('prod.hr.employees', 'Tag the email column of employees', 'A tag alone masks nothing. Look at the table on the right: only the header changes.'),
      tagCard('prod.crm.customers', 'Tag the email column of customers'),
      {
        title: 'Write the mask once',
        sql: "CREATE FUNCTION prod.sec.mask_email(email STRING)\nRETURN regexp_replace(email, '^[^@]+', '***');",
        note: 'No group check inside: the policy decides who is masked (TO … EXCEPT).',
        done: function (S) { return S.fn; },
        run: function (S) { S.fn = true; return 'Function created.'; },
        undo: { label: 'DROP', sql: 'DROP FUNCTION prod.sec.mask_email;', run: function (S) { S.fn = false; S.policy = false; } }
      },
      {
        title: 'One policy on the whole catalog',
        sql: "CREATE POLICY mask_emails ON CATALOG prod\nCOLUMN MASK prod.sec.mask_email\nTO `account users` EXCEPT `hr_admins`\nFOR TABLES\nMATCH COLUMNS has_tag_value('pii', 'email') AS c\nON COLUMN c;",
        done: function (S) { return S.policy; },
        run: function (S) {
          if (!S.fn) return { err: '[ROUTINE_NOT_FOUND] prod.sec.mask_email does not exist. Run step 4 first.' };
          if (!S.governed) return { err: 'pii is not a governed tag yet. ABAC policies match governed tags: run step 1 first.' };
          S.policy = true;
          return 'Policy created. Every column tagged pii=email in prod is masked for everyone except hr_admins.';
        },
        undo: { label: 'DROP POLICY', sql: 'DROP POLICY mask_emails ON CATALOG prod;', run: function (S) { S.policy = false; } }
      },
      {
        title: 'Tomorrow: a new table appears',
        sql: "CREATE TABLE prod.crm.leads (lead_id INT, contact STRING, email STRING);\nINSERT INTO prod.crm.leads VALUES\n  (9001, 'Petra Varga', 'petra.varga@mail.hu'),\n  (9002, 'Max Klein', 'max.klein@mail.de');",
        note: 'Nobody tagged its email column yet. Is it masked?',
        done: function (S) { return S.leads; },
        run: function (S) { S.leads = true; return { msg: 'Table created. Look at it as Bence.', target: 'prod.crm.leads' }; },
        undo: { label: 'DROP', sql: 'DROP TABLE prod.crm.leads;', run: function (S) { S.leads = false; delete S.tags['prod.crm.leads.email']; } }
      },
      tagCard('prod.crm.leads', 'Tag the new column', 'No new policy, no ALTER on the mask: the tag is enough.', true)
    ],
    targets: function (S) { return [['prod.hr.employees', 'SELECT * FROM prod.hr.employees'], ['prod.crm.customers', 'SELECT * FROM prod.crm.customers']].concat(S.leads ? [['prod.crm.leads', 'SELECT * FROM prod.crm.leads']] : []); },
    leftTitle: function (S, t) { return '📋 <code>' + t + '</code> as stored · 📜 ' + (S.policy ? 'policy <b>mask_emails</b> on prod' : 'no policy yet'); },
    left: function (S, t) {
      var d = ABAC_T[t];
      return tbl(d.cols.map(function (n) { return { n: n, tag: S.tags[t + '.' + n] }; }), d.rows.map(function (r) { return { c: r }; }));
    },
    see: function (S, pid, t) {
      var d = ABAC_T[t], admin = member(S, pid, 'hr_admins');
      var on = function (n) { return S.policy && !admin && S.tags[t + '.' + n] === 'pii=email'; };
      var r = {
        cols: d.cols.map(function (n) { return { n: n, tag: S.tags[t + '.' + n], mk: on(n) }; }),
        rows: d.rows.map(function (row) { return { c: row.map(function (v, k) { return on(d.cols[k]) ? { v: MASKERS.email(v) } : v; }) }; })
      };
      if (S.policy && !admin && t === 'prod.crm.leads' && !S.tags['prod.crm.leads.email']) r.note = '⚠️ Not masked: the policy matches <b>tags</b>, not column names. Run step 7.';
      return r;
    }
  });

  window.GovLabs = LABS;
})();
