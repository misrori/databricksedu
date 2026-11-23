/* Governance storyboard: the story scenes. Account → identities → namespace → privileges → fine-grained access → lab. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var SC = window.GOV_SCENES = [];
  function sql(txt) {
    return '<pre class="code">' + esc(txt).replace(/(--[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(SELECT|FROM|WHERE|GRANT|REVOKE|ON|TO|USE|CATALOG|SCHEMA|TABLE|CREATE|OR|REPLACE|VIEW|FUNCTION|RETURNS|RETURN|CASE|WHEN|THEN|ELSE|END|ALTER|SET|ROW|FILTER|COLUMN|MASK|POLICY|EXCEPT|FOR|TABLES|MATCH|COLUMNS|AS|USING|TAGS|EXISTS|AND|SHOW|GRANTS|OWNER|MODIFY|SELECT)\b(?![^<]*<\/span>)/g, '<span class="kw">$1</span>') + '</pre>';
  }

  // 1 ── account, metastore, workspaces
  SC.push({
    id: 'account', icon: '🏢', title: 'Account, metastore, workspaces', sub: 'One account, one metastore per region, many workspaces. Where does an admin click what?',
    thumb: '<div class="th-acc"><span>🏛️</span><span>🗄️</span><span>🏢🏢🏢</span></div>',
    steps: [
      function (el) {
        var box = h(title('Three levels of <em>"admin"</em>', 'Click a box to see what lives there and who manages it.') +
          '<div class="acc"><div class="lvl a" data-k="0"><b>🏛️ Databricks account</b><small>accounts.cloud.databricks.com</small></div>' +
          '<div class="lvl m" data-k="1"><b>🗄️ Metastore</b><small>one per cloud region · Unity Catalog</small></div>' +
          '<div class="wsrow2"><div class="lvl w" data-k="2"><b>🏢 ws-prod</b><small>workspace</small></div><div class="lvl w" data-k="2"><b>🏢 ws-dev</b><small>workspace</small></div><div class="lvl w" data-k="2"><b>🏢 ws-analytics</b><small>workspace</small></div></div></div>' +
          '<div class="card sk thin mt" id="accnote"><span class="note">click a box ↑</span></div>');
        el.appendChild(box);
        var notes = [
          '<b>Account level</b>, managed by <b>account admins</b>: users, groups and service principals (synced from your identity provider with SCIM), workspaces, metastores, billing, network settings. Identities live <b>here</b>, not in a workspace.',
          '<b>Metastore</b>, managed by the <b>metastore admin</b> (best: a group): the top of the Unity Catalog hierarchy. Catalogs, storage credentials, external locations, shares. Every workspace in the region attaches to the same one, so a table has the same name everywhere.',
          '<b>Workspace</b>, managed by <b>workspace admins</b>: where people work. Notebooks, jobs, compute, SQL warehouses, dashboards. An identity must be <b>assigned</b> to a workspace to log in. Workspace objects have their own permission lists (CAN VIEW, CAN RUN…), separate from data grants.'
        ];
        box.querySelectorAll('.lvl').forEach(function (b) { b.onclick = function () { box.querySelectorAll('.lvl').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); box.querySelector('#accnote').innerHTML = notes[+b.dataset.k]; }; });
      },
      function (el) {
        el.appendChild(h(title('Same data, <em>different doors</em>', 'Workspaces share the metastore, but not necessarily every catalog.') +
          '<div class="cols"><div>' + list(['A catalog can be <b>bound</b> to chosen workspaces. <span class="mono">prod</span> bound to <span class="mono">ws-prod</span> is invisible from <span class="mono">ws-dev</span>, whatever the grants say.',
            'Each workspace has a <b>default catalog</b>: what <span class="mono">SELECT * FROM orders</span> uses when no catalog is given.',
            'Admin roles do not give data access by themselves. A workspace admin cannot read <span class="mono">prod.hr</span> without a grant.',
            '+Grant data to <b>account groups</b>; manage who is in them at the account (or in the IdP).']) +
          '</div><div class="card sk alt"><h4 class="h4">🔒 Two independent checks</h4><table class="tbl"><tr><th>Question</th><th>Answered by</th></tr>' +
          '<tr><td>Can I log in here?</td><td>workspace assignment</td></tr><tr><td>Is the catalog reachable here?</td><td>catalog binding</td></tr><tr><td>May I read the table?</td><td>UC grants</td></tr><tr><td>Which rows and values?</td><td>filters, masks, policies</td></tr></table></div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'account', q: 'A user has <span class="mono">SELECT</span> on <span class="mono">prod.hr.employees</span> but gets "catalog not found" in the dev workspace. The most likely reason?',
          options: ['The grant was made in the wrong workspace', 'The <span class="mono">prod</span> catalog is bound to other workspaces only', 'The user is not a workspace admin', 'The metastore is in another region'],
          correct: 1, why: 'Grants are made once, in the metastore, and are valid in every attached workspace. A catalog binding limits where the catalog is visible at all.' }));
      }
    ]
  });

  // 2 ── identities
  var JOIN = [
    ['🪪', 'Identity provider', 'Entra ID / Okta: HR adds Eva to the group <b>DE-Analysts</b>.'],
    ['🔄', 'SCIM sync', 'The account syncs users and groups (or automatic identity management pulls them on first use). No manual user creation.'],
    ['🏛️', 'Account', 'Eva and the account group <b>analysts_de</b> now exist at account level, with a stable id.'],
    ['🏢', 'Workspace', 'The group is assigned to <b>ws-prod</b>, so Eva can log in. Entitlements say what she may do there (SQL access, create compute…).'],
    ['🔑', 'Grants', 'Grants were made to <b>analysts_de</b> months ago. Eva has the same access as her colleagues the minute she logs in. Nobody wrote a GRANT for her.']
  ];
  SC.push({
    id: 'identities', icon: '👥', title: 'Users, groups, service principals', sub: 'Who is asking? Identities live at the account; access is given to groups.',
    thumb: '<span style="font-size:44px">🧑‍💻 👥 🤖</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Three kinds of <em>principal</em>') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>🧑‍💻 User</h4>' + list(['A person, identified by e-mail.', 'Comes from the IdP via SCIM.', '-Do not grant to users one by one.']) + '</div>' +
          '<div class="card sk alt"><h4>👥 Group</h4>' + list(['Account groups: one per role or team.', 'Groups can contain groups (nested).', '+Every grant goes here.', 'Built-in: <span class="mono">account users</span> (everyone).']) + '</div>' +
          '<div class="card sk"><h4>🤖 Service principal</h4>' + list(['An identity for jobs, pipelines, CI/CD.', 'Authenticates with OAuth (client id + secret).', '+Production runs as an SP, not as a person.', 'Does not leave the company when someone does.']) + '</div></div>' +
          '<div class="callout sk thin acc">Use <b>account groups</b>. Old workspace-local groups cannot receive Unity Catalog grants and only exist in one workspace.</div>'));
      },
      function (el) {
        var box = h(title('A new joiner, <em>step by step</em>', 'Press next and follow Eva from HR\'s system to her first query.') + '<div class="joinrow" id="jr"></div><div class="card sk thin mt" id="jn"></div><div class="row mt"><button class="btn acc" id="jgo">Next →</button></div>');
        el.appendChild(box);
        var k = 0;
        function draw() {
          box.querySelector('#jr').innerHTML = JOIN.map(function (j, i) { return (i ? '<span class="arr">→</span>' : '') + '<div class="jbox' + (i < k + 1 ? ' on' : '') + (i === k ? ' cur' : '') + '"><b>' + j[0] + '</b>' + j[1] + '</div>'; }).join('');
          box.querySelector('#jn').innerHTML = '<span class="note">' + (k + 1) + '. ' + JOIN[k][1] + '</span><p class="lead" style="margin:6px 0 0">' + JOIN[k][2] + '</p>';
          box.querySelector('#jgo').textContent = k < JOIN.length - 1 ? 'Next →' : '↺ Again';
        }
        box.querySelector('#jgo').onclick = function () { k = (k + 1) % JOIN.length; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Membership is <em>transitive</em>', 'A grant to a parent group reaches every member of every child group.') +
          '<div class="cols"><div class="gtree"><div class="gn">👥 analysts <small>GRANT SELECT ON SCHEMA prod.hr</small></div><div class="gk"><div class="gn">👥 analysts_hu<div class="gk"><div class="gn u">🧑‍💻 bence@corp.com</div></div></div>' +
          '<div class="gn">👥 analysts_de<div class="gk"><div class="gn u">👩‍💻 carla@corp.com</div><div class="gn u">🙂 eva@corp.com</div></div></div></div></div>' +
          '<div>' + list(['Bence, Carla and Eva can all read <span class="mono">prod.hr</span>.', 'The functions see the whole chain: <span class="mono">is_account_group_member(\'analysts\')</span> is TRUE for Eva.', 'Privileges only <b>add up</b>: there is no group that takes access away.', '+Small role groups inside bigger ones keep the grant list short.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'ident', q: 'A nightly job writes to <span class="mono">prod.hr.employees</span>. Under which identity should it run?',
          options: ['The data engineer who built it', 'A shared admin user with a personal access token', 'A service principal in a group that has <span class="mono">MODIFY</span> on the table', 'The <span class="mono">account users</span> group'],
          correct: 2, why: 'A service principal is a non-human identity that survives people leaving. Put it in a group, grant the group only what the job needs, and let the job "run as" the SP.' }));
      }
    ]
  });

  // 3 ── namespace
  SC.push({
    id: 'namespace', icon: '🔤', title: 'The three-level namespace', sub: 'catalog.schema.object, and how a short name is completed.',
    thumb: '<span class="tag" style="font-size:18px">prod</span>.<span class="tag" style="font-size:18px">hr</span>.<span class="tag" style="font-size:18px">employees</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('<em>catalog</em> . schema . object') + '<div class="ns3"><div class="nsp c1"><b>prod</b><small>catalog</small><p>Top level. Often one per environment (dev / test / prod) or business unit. Can be bound to workspaces.</p></div><span class="dot">.</span>' +
          '<div class="nsp c2"><b>hr</b><small>schema</small><p>A database: groups the objects of one domain or team. The usual level for team grants.</p></div><span class="dot">.</span>' +
          '<div class="nsp c3"><b>employees</b><small>object</small><p>Table, view, materialized view, volume, function or model. Grants can go down to here.</p></div></div>' +
          '<div class="callout sk thin">The same three levels everywhere: <span class="mono">/Volumes/prod/hr/docs/contract.pdf</span>, <span class="mono">prod.sec.mask_salary()</span>, <span class="mono">prod.ml.churn_model</span>. Legacy tables appear as <span class="mono">hive_metastore.db.table</span>.</div>'));
      },
      function (el) {
        var box = h(title('Resolve a name <em>yourself</em>', 'Set the session, type a name, see what Unity Catalog looks up.') +
          '<div class="resolver"><label>USE CATALOG <select id="rc"><option>main</option><option selected>prod</option><option>dev</option></select></label><label>USE SCHEMA <select id="rs"><option>default</option><option selected>hr</option><option>crm</option></select></label>' +
          '<label class="wide">SELECT * FROM <input id="rn" value="employees"></label></div><div class="ex">try: <button>employees</button><button>crm.customers</button><button>dev.hr.employees</button><button>`prod`.`hr`.`employees`</button><button>a.b.c.d</button></div><div class="rout" id="ro"></div>');
        el.appendChild(box);
        function go() {
          var c = box.querySelector('#rc').value, s = box.querySelector('#rs').value, raw = box.querySelector('#rn').value.trim();
          var parts = raw.split('.').map(function (p) { return p.replace(/`/g, '').trim(); }).filter(Boolean), out;
          if (!parts.length) out = '<span class="no">Type a name.</span>';
          else if (parts.length > 3) out = '<span class="no">✗ Too many parts. A Unity Catalog name has at most three: catalog.schema.object.</span>';
          else {
            var full = parts.length === 3 ? parts : parts.length === 2 ? [c].concat(parts) : [c, s].concat(parts);
            var from = parts.length === 3 ? 'nothing filled in' : parts.length === 2 ? 'catalog from the session' : 'catalog and schema from the session';
            out = '<div class="rfull"><span class="c1">' + esc(full[0]) + '</span>.<span class="c2">' + esc(full[1]) + '</span>.<span class="c3">' + esc(full[2]) + '</span></div><div>' + parts.length + '-part name → ' + from + '.</div>' +
              '<div class="small">Then the check: <b>USE CATALOG</b> on ' + esc(full[0]) + ' → <b>USE SCHEMA</b> on ' + esc(full[0] + '.' + full[1]) + ' → <b>SELECT</b> on the object.</div>';
          }
          box.querySelector('#ro').innerHTML = out;
        }
        box.querySelectorAll('select,input').forEach(function (x) { x.oninput = go; x.onchange = go; });
        box.querySelectorAll('.ex button').forEach(function (b) { b.onclick = function () { box.querySelector('#rn').value = b.textContent; go(); }; });
        go();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'ns', q: 'The session ran <span class="mono">USE CATALOG dev</span> and <span class="mono">USE SCHEMA hr</span>. Which table does <span class="mono">SELECT * FROM crm.customers</span> read?',
          options: ['<span class="mono">dev.hr.customers</span>', '<span class="mono">dev.crm.customers</span>', '<span class="mono">prod.crm.customers</span>', 'It fails: two-part names are not allowed'],
          correct: 1, why: 'A two-part name is <span class="mono">schema.object</span>. Only the catalog is taken from the session. In jobs, write full names so the result does not depend on the session.' }));
      }
    ]
  });

  // 4 ── privileges
  var PNODES = [['prod', 'catalog', 0], ['prod.hr', 'schema', 1], ['prod.hr.employees', 'table', 2], ['prod.hr.departments', 'table', 2], ['prod.crm', 'schema', 1], ['prod.crm.customers', 'table', 2]];
  SC.push({
    id: 'privileges', icon: '🔑', title: 'Privileges flow down', sub: 'USE CATALOG + USE SCHEMA + SELECT. Inheritance, ownership, no DENY.',
    thumb: '<div class="th-priv"><span>📚 USE CATALOG</span><span>🗂️ USE SCHEMA</span><span>📋 SELECT</span></div>',
    steps: [
      function (el) {
        var box = h(title('Click where you <em>grant</em> SELECT', 'Everything green is readable for the group. Inheritance also covers tables created later.') +
          '<div class="cols"><div class="ptree" id="pt"></div><div><div class="card sk thin" id="pn"><span class="note">click a node ←</span></div><div class="row mt"><button class="btn" id="pnew">+ CREATE TABLE prod.hr.payroll</button></div></div></div>');
        el.appendChild(box);
        var nodes = PNODES.slice(), at = null;
        function draw() {
          box.querySelector('#pt').innerHTML = nodes.map(function (n) {
            var cov = at && (n[0] === at || n[0].indexOf(at + '.') === 0);
            return '<div class="pnode ' + (cov ? 'cov' : '') + (n[0] === at ? ' at' : '') + '" data-s="' + n[0] + '" style="margin-left:' + n[2] * 28 + 'px">' + ['📚', '🗂️', '📋'][n[2]] + ' <span class="mono">' + n[0] + '</span> <small>' + n[1] + '</small>' + (n[3] ? ' <span class="chip2 new">new</span>' : '') + '</div>';
          }).join('');
          box.querySelectorAll('.pnode').forEach(function (p) { p.onclick = function () { at = p.dataset.s; draw(); }; });
          if (at) {
            var lvl = at.split('.').length, cov = nodes.filter(function (n) { return n[2] === 2 && (n[0] === at || n[0].indexOf(at + '.') === 0); }).length;
            box.querySelector('#pn').innerHTML = '<div class="mono" style="font-size:14px">GRANT SELECT ON ' + ['CATALOG', 'SCHEMA', 'TABLE'][lvl - 1] + ' ' + at + ' TO `analysts`;</div><p style="margin:8px 0 0;font-size:17px">Covers <b>' + cov + '</b> table(s)' +
              (lvl < 3 ? ', and every table created there later.' : ', and nothing else.') + ' Readers still need <b>USE CATALOG</b> on prod' + (lvl > 1 ? ' and <b>USE SCHEMA</b> on ' + at.split('.').slice(0, 2).join('.') : '') + '.' + (lvl === 1 ? ' ⚠️ Easy to over-share: every schema of the catalog.' : '') + '</p>';
          }
        }
        box.querySelector('#pnew').onclick = function () { if (!nodes.some(function (n) { return n[0] === 'prod.hr.payroll'; })) { nodes.splice(4, 0, ['prod.hr.payroll', 'table', 2, true]); draw(); } };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Three doors, <em>all</em> needed') + '<div class="doors"><div class="door"><b>🚪 USE CATALOG</b><small>on prod</small></div><span class="arr">→</span><div class="door"><b>🚪 USE SCHEMA</b><small>on prod.hr (or the catalog)</small></div><span class="arr">→</span><div class="door"><b>📖 SELECT</b><small>on the table, schema or catalog</small></div><span class="arr">→</span><div class="door ok"><b>✅ rows</b><small>after filters and masks</small></div></div>' +
          '<div class="cols mt"><div>' + sql('GRANT USE CATALOG ON CATALOG prod TO `analysts`;\nGRANT USE SCHEMA, SELECT ON SCHEMA prod.hr TO `analysts`;\nGRANT MODIFY ON TABLE prod.hr.employees TO `hr_pipelines`;\nALTER TABLE prod.hr.employees OWNER TO `hr_admins`;\nSHOW GRANTS ON SCHEMA prod.hr;') + '</div><div>' +
          list(['The <b>owner</b> has every privilege on the object and can grant it. Make groups owners, not people.', '<b>MANAGE</b> lets someone grant and drop without owning.', '-There is <b>no DENY</b>. You cannot take back at table level what a schema grant gives.', '+Need an exception? Put the table in another schema, or use a filter or mask.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'priv', q: 'Analysts have <span class="mono">SELECT ON SCHEMA prod.hr</span>. You must hide <span class="mono">prod.hr.payroll</span> from them. What works?',
          options: ['<span class="mono">DENY SELECT ON TABLE prod.hr.payroll</span>', '<span class="mono">REVOKE SELECT ON TABLE prod.hr.payroll FROM analysts</span>', 'Move payroll to a schema they have no grant on (or grant table by table instead of the schema)', 'Remove <span class="mono">USE CATALOG</span>'],
          correct: 2, why: 'Unity Catalog has no DENY, and a table-level REVOKE removes nothing because the grant was made on the schema. Restructure: separate schema, or narrower grants.' }));
      }
    ]
  });

  // shared demo table for scenes 5-7
  var ROWS = [['Anna Kovacs', 'HU', 61200, '412-55-7310'], ['Felix Weber', 'DE', 84500, '233-18-4402'], ['Bence Nagy', 'HU', 112300, '508-23-9967'], ['Tessa Smith', 'GB', 58800, '145-66-2051'], ['Reka Toth', 'HU', 70400, '590-12-3348']];
  function miniTable(who, opts) {
    var admin = who === 'admin';
    return '<table class="dt2 mini"><tr><th>full_name</th><th>country</th><th class="' + (!admin && opts.mask ? 'mk' : '') + '">salary</th><th class="' + (!admin && opts.mask ? 'mk' : '') + '">national_id</th></tr>' + ROWS.map(function (r) {
      var hide = !admin && opts.filter && r[1] !== 'HU';
      if (hide && !opts.ghost) return '';
      var m = !admin && opts.mask;
      return '<tr class="' + (hide ? 'gone' : '') + '"><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="' + (m ? 'mk' : '') + '">' + (m ? '<i class="nul">NULL</i>' : r[2]) + '</td><td class="' + (m ? 'mk' : '') + '">' + (m ? '***-**-' + r[3].slice(-4) : r[3]) + '</td></tr>';
    }).join('') + '</table>';
  }
  function twoUsers(opts) {
    return '<div class="cols two"><div><div class="whois">👩‍💼 Anna <small>hr_admins</small></div>' + miniTable('admin', opts) + '</div><div><div class="whois">🧑‍💻 Bence <small>analysts_hu</small></div>' + miniTable('analyst', opts) + '</div></div>';
  }

  // 5 ── dynamic views
  SC.push({
    id: 'views', icon: '🪞', title: 'Dynamic views', sub: 'A view whose result depends on who runs it. Readers get the view, never the table.',
    thumb: '<span style="font-size:50px">🪞</span><span class="tag">CASE WHEN is_account_group_member</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('One view, <em>two answers</em>', 'The same <span class="mono">SELECT * FROM prod.hr.employees_v</span>, run by two people.') + twoUsers({ filter: true, mask: true, ghost: true }) +
          '<div class="mt">' + sql("CREATE OR REPLACE VIEW prod.hr.employees_v AS\nSELECT full_name, country,\n  CASE WHEN is_account_group_member('hr_admins') THEN salary END AS salary,\n  CASE WHEN is_account_group_member('hr_admins') THEN national_id\n       ELSE concat('***-**-', right(national_id, 4)) END AS national_id\nFROM prod.hr.employees\nWHERE is_account_group_member('hr_admins') OR country = 'HU';") + '</div>'));
      },
      function (el) {
        var box = h(title('The <em>bypass</em> problem', 'The view only protects if readers cannot reach the table. Toggle the grant.') +
          '<label class="toggle big"><input type="checkbox" id="bp" checked><span class="sw"></span> analysts have <span class="mono">SELECT ON SCHEMA prod.hr</span> (covers the base table too)</label><div id="bpo" class="mt"></div>');
        el.appendChild(box);
        function draw() {
          var on = box.querySelector('#bp').checked;
          box.querySelector('#bpo').innerHTML = '<div class="cols two"><div><div class="whois">🧑‍💻 Bence: <span class="mono">FROM employees_v</span></div>' + miniTable('analyst', { filter: true, mask: true }) + '</div><div><div class="whois">🧑‍💻 Bence: <span class="mono">FROM employees</span></div>' +
            (on ? miniTable('admin', {}) + '<div class="banner warn mt">⚠️ Everything is visible. The view protected nothing.</div>' : '<div class="banner ok">🚫 PERMISSION_DENIED: no SELECT on the table. Only the view is granted.</div>') + '</div></div>';
        }
        box.querySelector('#bp').onchange = draw; draw();
      },
      function (el) {
        el.appendChild(h(title('When a dynamic view is <em>still right</em>') + '<div class="cols"><div>' + list(['+Sharing filtered data with Delta Sharing (tables with filters or masks cannot be shared directly).', '+Combining or aggregating several tables into one curated object.', '+Exposing a smaller column set to a wide audience.', '-Protecting a table everyone queries directly: use a row filter or mask instead.', '-Hundreds of tables: use ABAC policies.']) + '</div>' +
          '<div class="card sk alt">' + list(['The view reads the base table with the rights of the <b>view owner</b>.', 'Readers need <span class="mono">SELECT</span> on the view + the two USE privileges. Not on the table.', 'Use <span class="mono">is_account_group_member()</span>, not the legacy workspace <span class="mono">is_member()</span>.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'views', q: 'Which grants does a reader of a dynamic view need?',
          options: ['SELECT on the view and on the base table', 'SELECT on the view, plus USE CATALOG and USE SCHEMA', 'Only EXECUTE on <span class="mono">is_account_group_member</span>', 'MODIFY on the view'],
          correct: 1, why: 'The view owner\'s rights are used to read the base table. Giving readers SELECT on the base table would let them skip the view.' }));
      }
    ]
  });

  // 6 ── row filters
  SC.push({
    id: 'rowfilter', icon: '🚦', title: 'Row filters', sub: 'A boolean function attached to the table. FALSE rows never leave the engine.',
    thumb: '<div class="th-rows"><i></i><i class="x"></i><i></i><i class="x"></i><i></i></div>',
    steps: [
      function (el) {
        var box = h(title('Rows that <em>disappear</em>', 'Attach the filter and watch the analyst\'s result.') + '<div class="row"><button class="btn acc" id="rfgo">ALTER TABLE … SET ROW FILTER</button><button class="btn" id="rfoff">DROP ROW FILTER</button></div><div id="rfo" class="mt"></div>' +
          sql("CREATE OR REPLACE FUNCTION prod.sec.country_filter(c STRING)\nRETURNS BOOLEAN\nRETURN is_account_group_member('hr_admins')\n    OR EXISTS (SELECT 1 FROM prod.sec.country_access m\n               WHERE m.country = c AND is_account_group_member(m.group_name));\n\nALTER TABLE prod.hr.employees SET ROW FILTER prod.sec.country_filter ON (country);"));
        el.appendChild(box);
        var on = false;
        function draw() { box.querySelector('#rfo').innerHTML = twoUsers({ filter: on, ghost: true }); }
        box.querySelector('#rfgo').onclick = function () { on = true; draw(); };
        box.querySelector('#rfoff').onclick = function () { on = false; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Rules to <em>remember</em>') + '<div class="cmp" style="--n:2"><div class="card sk">' + list(['Must return <b>BOOLEAN</b>. Columns come in through <span class="mono">ON (…)</span>.', '<b>One</b> row filter per table: combine rules inside the function.', 'Applies to <b>everyone</b>, including the owner and service principals.', 'Grants nothing: the user still needs SELECT.']) + '</div>' +
          '<div class="card sk alt">' + list(['+Keep rules in a <b>mapping table</b>: new access = one INSERT.', '+Simple SQL, no Python UDFs: the filter runs on every scan.', '-A job running as an SP may silently read 0 rows. Exempt its group.', '-Filtered tables cannot be shared directly with Delta Sharing.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'rf', q: 'You own <span class="mono">employees</span> and attached a row filter that lets only <span class="mono">hr_admins</span> see all rows. You are not in hr_admins. What do you see?',
          options: ['Every row: owners are never filtered', 'Only the rows the function returns TRUE for', 'An error: owners cannot query filtered tables', 'Every row, but with masked columns'],
          correct: 1, why: 'The filter is part of every query plan, the owner\'s too. Only the logic inside the function decides who sees what.' }));
      }
    ]
  });

  // 7 ── column masks
  var TECH = [['NULL', 'CASE WHEN … THEN v END', function (v) { return null; }, 'Hides everything. Aggregates ignore NULLs.'],
    ['Partial', "concat('***-**-', right(v, 4))", function (v) { return '***-**-' + v.slice(-4); }, 'Lets people match the last digits on a phone call.'],
    ['Hash', 'sha2(v, 256)', function (v) { var x = 0; for (var i = 0; i < v.length; i++) x = (x * 31 + v.charCodeAt(i)) >>> 0; return x.toString(16).slice(0, 8) + '…'; }, 'Same input, same output: joins and COUNT DISTINCT still work. Not anonymous.'],
    ['Constant', "'[REDACTED]'", function () { return '[REDACTED]'; }, 'Clear for humans. Types must still match the column.']];
  SC.push({
    id: 'masks', icon: '🎭', title: 'Column masks', sub: 'A function that returns the value this user may see, with the same type.',
    thumb: '<span class="tag" style="font-size:17px">***-**-7310</span>',
    steps: [
      function (el) {
        var box = h(title('Pick a <em>masking technique</em>', 'Same column, same query. The mask runs per value, for everyone not exempt.') + '<div class="tabs" id="mt">' + TECH.map(function (t, i) { return '<button data-i="' + i + '" class="' + (i ? '' : 'on') + '">' + t[0] + '</button>'; }).join('') + '</div><div id="mo"></div>');
        el.appendChild(box);
        function draw(i) {
          var t = TECH[i];
          box.querySelectorAll('#mt button').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === i); });
          box.querySelector('#mo').innerHTML = '<div class="cols"><table class="dt2 mini"><tr><th>full_name</th><th>national_id (real)</th><th class="mk">what an analyst sees</th></tr>' + ROWS.map(function (r) { var v = t[2](r[3]); return '<tr><td>' + r[0] + '</td><td>' + r[3] + '</td><td class="mk">' + (v === null ? '<i class="nul">NULL</i>' : esc(v)) + '</td></tr>'; }).join('') + '</table><div>' +
            sql("CREATE OR REPLACE FUNCTION prod.sec.mask_nid(v STRING)\nRETURNS STRING\nRETURN CASE WHEN is_account_group_member('hr_admins') THEN v\n            ELSE " + t[1].replace('CASE WHEN … THEN v END', 'NULL') + " END;\n\nALTER TABLE prod.hr.employees\n  ALTER COLUMN national_id SET MASK prod.sec.mask_nid;") + '<p class="lead mt">' + t[3] + '</p></div></div>';
        }
        box.querySelectorAll('#mt button').forEach(function (b) { b.onclick = function () { draw(+b.dataset.i); }; });
        draw(0);
      },
      function (el) {
        el.appendChild(h(title('Masks run <em>before</em> your query logic') + '<div class="cols"><div>' + sql("-- as an analyst, with salary masked to NULL\nSELECT count(*) FROM prod.hr.employees\nWHERE salary > 100000;      -- 0: the WHERE sees NULL\n\nSELECT avg(salary) FROM prod.hr.employees;   -- NULL") + '</div><div>' +
          list(['The engine replaces the column with <span class="mono">mask(salary)</span>, then runs your query.', 'So filters, joins and aggregates use the <b>masked</b> value: you cannot "filter around" a mask.', 'One mask per column. It must return the column\'s type.', '+<span class="mono">USING COLUMNS (country)</span> passes other columns of the row to the mask.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'cm', q: 'Analysts must count distinct customers per region but never see e-mails. Which mask keeps that query correct?',
          options: ['NULL', "'[REDACTED]'", 'A deterministic hash such as <span class="mono">sha2(email, 256)</span>', 'Keep only the domain'],
          correct: 2, why: 'A hash maps each e-mail to the same unique value, so COUNT DISTINCT and joins still work. NULL and a constant collapse all values; domains merge many people.' }));
      }
    ]
  });

  // 8 ── ABAC
  var ABAC = [
    { l: 'Governed tags', n: 'An account admin defines the tag <b>pii</b> with allowed values (email, salary, national_id…) and who may assign it. Data stewards tag columns.', tables: [['employees', ['national_id', 'email']], ['customers', ['email']]], policy: false },
    { l: 'One policy on the catalog', n: '<span class="mono">CREATE POLICY mask_emails ON CATALOG prod COLUMN MASK … MATCH COLUMNS has_tag_value(\'pii\',\'email\')</span>. Every tagged column is masked at once.', tables: [['employees', ['national_id', 'email']], ['customers', ['email']]], policy: true },
    { l: 'A new table appears', n: 'Someone creates <span class="mono">prod.crm.leads</span> with an <b>email</b> column and tags it. Nobody attached a mask, nobody wrote a GRANT for the policy.', tables: [['employees', ['national_id', 'email']], ['customers', ['email']], ['leads', ['email'], true]], policy: true },
    { l: 'Already protected', n: 'The policy matches the tag, so <span class="mono">leads.email</span> is masked from the first query. Classification drives protection.', tables: [['employees', ['national_id', 'email']], ['customers', ['email']], ['leads', ['email'], true, true]], policy: true }
  ];
  SC.push({
    id: 'abac', icon: '🏷️', title: 'Tags and ABAC policies', sub: 'One policy high in the hierarchy, applied wherever a tag matches. Today and tomorrow.',
    thumb: '<span class="tag">🏷️ pii=email</span><span style="font-size:40px">→</span><span class="tag">🎭</span>',
    steps: [
      function (el) {
        var box = h(title('Classification <em>drives</em> protection', 'Step through. Masked columns are amber.') + '<div class="stages" id="as"></div><div class="abacb" id="ab"></div><div class="card sk thin mt" id="an"></div>');
        el.appendChild(box);
        var k = 0;
        function draw() {
          box.querySelector('#as').innerHTML = ABAC.map(function (a, i) { return '<button data-i="' + i + '" class="' + (i === k ? 'on' : '') + '"><span class="n">' + (i + 1) + '</span>' + a.l + '</button>'; }).join('');
          box.querySelectorAll('#as button').forEach(function (b) { b.onclick = function () { k = +b.dataset.i; draw(); }; });
          var a = ABAC[k];
          box.querySelector('#ab').innerHTML = '<div class="polbox' + (a.policy ? ' on' : '') + '">📚 catalog <b>prod</b>' + (a.policy ? '<span class="chip2 m">POLICY mask_emails → pii=email</span>' : '') + '</div><div class="tcards">' + a.tables.map(function (t) {
            return '<div class="tcard' + (t[2] ? ' fresh' : '') + '"><b>📋 ' + t[0] + '</b>' + t[1].map(function (c) { var masked = a.policy && c === 'email' && (!t[2] || t[3]); return '<div class="tc ' + (masked ? 'mk' : '') + '">' + c + ' <span class="tg3">🏷️ pii=' + c + '</span>' + (masked ? ' 🎭' : '') + '</div>'; }).join('') + '</div>';
          }).join('') + '</div>';
          box.querySelector('#an').innerHTML = '<span class="note">' + (k + 1) + '. ' + a.l + '</span><p class="lead" style="margin:6px 0 0">' + a.n + '</p>';
        }
        draw();
      },
      function (el) {
        el.appendChild(h(title('The <em>policy</em>, line by line') + '<div class="cols"><div>' + sql("ALTER TABLE prod.crm.leads\n  ALTER COLUMN email SET TAGS ('pii' = 'email');\n\nCREATE POLICY mask_emails\nON CATALOG prod\nCOLUMN MASK prod.sec.mask_email\nTO `account users` EXCEPT `hr_admins`\nFOR TABLES\nMATCH COLUMNS has_tag_value('pii', 'email') AS c\nON COLUMN c;") + '</div><div>' +
          list(['<b>ON</b>: catalog, schema or table. Covers everything inside, including future tables.', '<b>TO … EXCEPT</b>: who is masked and who is not.', '<b>MATCH COLUMNS</b>: which columns, by tag. <b>ON COLUMN</b> passes them to the mask.', 'Row filters: <span class="mono">ROW FILTER fn … USING COLUMNS (c)</span>.', 'Needs MANAGE on the securable and EXECUTE on the function. Check the docs for current compute requirements.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'abac', q: 'A policy masks <span class="mono">pii=email</span> columns in catalog <span class="mono">prod</span>. A new table has an <span class="mono">email</span> column, but nobody tagged it. Is it masked?',
          options: ['Yes: the policy masks every column named email', 'No: policies match tags, so an untagged column is not covered', 'Yes, after the next OPTIMIZE', 'Only for users outside the EXCEPT group, after a restart'],
          correct: 1, why: 'ABAC follows classification, not names. Untagged sensitive columns are a gap: data classification (automatic tagging) and tag hygiene are part of the job.' }));
      }
    ]
  });

  // 9 ── the lab
  SC.push({
    id: 'lab', icon: '🧪', title: 'The access lab', sub: 'Create groups and service principals, grant, add rows, switch between view, filter + mask and ABAC, and see who gets what.',
    thumb: '<span style="font-size:46px">🧪</span><span class="tag">run as Bence</span><span class="tag">✓ 3 / 8 rows</span>',
    wide: true,
    steps: [function (el) { var d = document.createElement('div'); el.appendChild(d); window.GovLab.mount(d); }]
  });

  // 10 ── which tool when
  var DEC = [
    { q: 'Do you share the data outside the account (Delta Sharing)?', y: ['🪞 Dynamic view', 'Filtered or masked tables cannot be shared directly. Share a view that applies the rules.'], n: 1 },
    { q: 'Is the same rule needed on many tables, now and in the future?', y: ['🏷️ ABAC policy + governed tags', 'One policy on the catalog or schema. New tagged columns are covered automatically.'], n: 2 },
    { q: 'Do people query this table directly (BI, notebooks, Genie)?', y: ['🎭 Row filter / column mask', 'Attached to the table: there is no second object to bypass.'], n: 3 },
    { q: 'Is it a curated subset or a join of several tables?', y: ['🪞 Dynamic view', 'Build the curated object as a view; grant only the view.'], n: ['🔑 Grants are enough', 'If everyone who may read the table may see all of it, plain grants on the schema are the simplest answer.'] }
  ];
  SC.push({
    id: 'decide', icon: '🧭', title: 'Which tool when?', sub: 'Grants, dynamic views, row filters and masks, or ABAC. A four-question guide.',
    thumb: '<span style="font-size:52px">🧭</span>',
    steps: [
      function (el) {
        var box = h(title('Answer <em>four questions</em>') + '<div id="dq"></div>');
        el.appendChild(box);
        function ask(i, trail) {
          var d = DEC[i];
          box.querySelector('#dq').innerHTML = trail + '<div class="card sk dq"><div class="h4">' + d.q + '</div><div class="row mt"><button class="btn acc" data-a="y">Yes</button><button class="btn" data-a="n">No</button></div></div>';
          box.querySelectorAll('[data-a]').forEach(function (b) {
            b.onclick = function () {
              var yes = b.dataset.a === 'y', t = trail + '<div class="dtrail">' + d.q + ' <b>' + (yes ? 'Yes' : 'No') + '</b></div>', res = yes ? d.y : (typeof d.n === 'number' ? null : d.n);
              if (res) box.querySelector('#dq').innerHTML = t + '<div class="card sk alt dres"><div class="h4">' + res[0] + '</div><p class="lead">' + res[1] + '</p><button class="btn" id="dag">↺ Start again</button></div>', box.querySelector('#dag').onclick = function () { ask(0, ''); };
              else ask(d.n, t);
            };
          });
        }
        ask(0, '');
      },
      function (el) {
        el.appendChild(h(title('The whole picture') + '<div class="journey">' + [['🏛️', 'Account', 'identities, SCIM'], ['🏢', 'Workspace', 'assignment, binding'], ['🔑', 'Grants', 'USE + SELECT, groups'], ['🎭', 'Filters & masks', 'per table'], ['🏷️', 'ABAC', 'per tag'], ['📜', 'Audit', 'system.access.audit']].map(function (c, i) { return '<div class="card sk' + (i % 2 ? ' alt' : '') + '" style="animation-delay:' + i * 0.12 + 's"><b>' + c[0] + '</b><span>' + c[1] + '</span><div class="small">' + c[2] + '</div></div>'; }).join('') + '</div>' +
          '<div class="callout sk thin acc">Every query passes the same gates in the same order: can I log in → is the catalog reachable → do I have the privileges → which rows and values do I get. Debug in that order too.</div>'));
      }
    ]
  });
})();
