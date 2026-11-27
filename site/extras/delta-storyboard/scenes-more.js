/* Delta Lake storyboard: ACID letter by letter, Iceberg compatibility (UniForm), and open data sharing.
   Loaded before board.js. Board.js calls window.DLSB_MORE(api) and pushes the returned scenes. */
(function () {
  'use strict';
  window.DLSB_MORE = function (api) {
    var h = api.h, title = api.title, list = api.list, quiz = api.quiz, esc = api.esc;
    var S = {};

    // ---------------------------------------------------------------- small helpers
    function seg(name, opts, cur) {
      return '<div class="tabs seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button data-v="' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>';
    }
    function rowsTable(cols, rows) {
      return '<table class="tbl xt"><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' + rows.map(function (r) {
        return '<tr class="' + (r.cls || '') + '">' + r.c.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table>';
    }
    function verdict(ok, html) { return '<div class="verdict ' + (ok ? 'good' : 'bad') + '">' + (ok ? '✅ ' : '❌ ') + html + '</div>'; }
    function wire(box, draw) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.seg button');
        if (b) { var name = b.parentNode.dataset.seg; draw({ seg: name, v: b.dataset.v }); return; }
        var a = e.target.closest('[data-act]');
        if (a) draw({ act: a.dataset.act });
      });
    }

    // ================================================================ ACID
    var LETTERS = [
      ['A', 'Atomicity', 'all or nothing', 'A write is applied completely or not at all. A crash halfway leaves the table as it was.'],
      ['C', 'Consistency', 'only valid versions', 'Every version follows the schema and the constraints. A bad write is rejected, not stored.'],
      ['I', 'Isolation', 'one version per query', 'A query sees one complete version, never a mix of before and after.'],
      ['D', 'Durability', 'committed means kept', 'Once a write returns success, it survives any crash of the compute.']
    ];

    // A ── a nightly INSERT crashes after 2 of 3 files
    function atomicity(el) {
      var st = { mode: 'parquet', phase: 0 };
      var box = h(title('🅰️ Atomicity: <em>all or nothing</em>', LETTERS[0][3] + ' Run the job, then rerun it. Switch between a plain Parquet folder and a Delta table.') + '<div id="ab"></div>');
      el.appendChild(box);
      function draw(ev) {
        if (ev && ev.seg) { st.mode = ev.v; }
        if (ev && ev.act === 'run') st.phase = 1;
        if (ev && ev.act === 'rerun') st.phase = 2;
        if (ev && ev.act === 'reset') st.phase = 0;
        var pq = st.mode === 'parquet', ph = st.phase;
        var files = [['part-00000.parquet', 'orders 1, 2', 'live']];
        if (ph >= 1) files.push(['part-00001.parquet', 'order 3 · job 1', pq ? 'live' : 'dead'], ['part-00002.parquet', 'order 4 · job 1', pq ? 'live' : 'dead']);
        if (ph >= 2) files.push(['part-00003.parquet', 'order 3 · rerun', 'live new'], ['part-00004.parquet', 'order 4 · rerun', 'live new'], ['part-00005.parquet', 'order 5 · rerun', 'live new']);
        var logs = pq ? [] : [['…000.json', 'v0 · CREATE + orders 1, 2']].concat(ph >= 2 ? [['…001.json', 'v1 · add 3 files', 'new']] : []);
        var folder = '<div class="folder"><div class="fh">orders/ ' + (pq ? '(plain Parquet)' : '(Delta table)') + '</div>' +
          (pq ? '' : '<div class="file" style="color:var(--soft)"><span class="ic">📁</span>_delta_log/</div>' + logs.map(function (l) { return '<div class="file ' + (l[2] || '') + '" style="padding-left:26px"><span class="ic">🧾</span>' + l[0] + '<span class="tg">' + l[1] + '</span></div>'; }).join('')) +
          files.map(function (f) { var orphan = !pq && f[2] === 'dead'; return '<div class="file ' + (orphan ? 'dead' : f[2]) + '"><span class="ic">📦</span>' + f[0] + '<span class="tg">' + f[1] + (orphan ? ' · in no commit' : '') + '</span></div>'; }).join('') + '</div>';
        var rows = [[1, 120], [2, 45]];
        if (pq && ph >= 1) rows.push([3, 80], [4, 15]);
        if (ph >= 2) { rows.push([3, 80], [4, 15], [5, 60]); }
        var seen = rows.map(function (r, i) { var dup = pq && ph >= 2 && (i === 2 || i === 3 || i === 4 || i === 5) && r[0] !== 5; return { c: [r[0], r[1]], cls: dup ? 'dupr' : '' }; });
        var msg = ph === 0 ? '<div class="verdict">The nightly job will append orders 3, 4 and 5 in three files. It crashes after two of them.</div>'
          : ph === 1 ? (pq ? verdict(false, 'Readers already see orders 3 and 4: <b>two thirds of a batch</b>. Nobody can tell the job failed.') : verdict(true, 'The two files are in the folder, but <b>no commit lists them</b>. Readers still see 2 orders.'))
            : (pq ? verdict(false, 'The rerun wrote orders 3 and 4 <b>again</b>: duplicates. You need manual cleanup.') : verdict(true, 'The rerun committed v1 with all three orders. The orphan files are ignored and VACUUM removes them later.'));
        box.querySelector('#ab').innerHTML = seg('mode', [['parquet', '📂 plain Parquet folder'], ['delta', '🔺 Delta table']], st.mode) +
          '<div class="cols"><div>' + folder + '</div><div><div class="note">what a reader sees</div>' + rowsTable(['order_id', 'amount'], seen) + msg +
          '<div class="btnrow"><button class="btn acc" data-act="run"' + (ph ? ' disabled' : '') + '>▶ Run the job (crashes)</button><button class="btn" data-act="rerun"' + (ph !== 1 ? ' disabled' : '') + '>↻ Rerun it</button><button class="btn" data-act="reset">↺</button></div></div></div>';
      }
      wire(box, draw); draw();
    }

    // C ── a bad batch with a CHECK constraint
    function consistency(el) {
      var st = { mode: 'parquet', done: false };
      var box = h(title('🅲 Consistency: <em>only valid versions</em>', LETTERS[1][3] + ' The table has a rule: <span class="mono">CHECK (quantity &gt; 0)</span>, and <span class="mono">amount</span> is a number.') + '<div id="cb"></div>');
      el.appendChild(box);
      function draw(ev) {
        if (ev && ev.seg) st.mode = ev.v;
        if (ev && ev.act === 'run') st.done = true;
        if (ev && ev.act === 'reset') st.done = false;
        var pq = st.mode === 'parquet';
        var rows = [{ c: [1, 2, '120.0'] }, { c: [2, 1, '45.0'] }];
        if (st.done && pq) rows.push({ c: [3, '<b>-5</b>', '80.0'], cls: 'badr' }, { c: [4, 1, '<b>"n/a"</b>'], cls: 'badr' });
        var sql = '<div class="cell"><div class="ch">notebook cell · SQL</div><pre><span class="kw">INSERT INTO</span> orders <span class="kw">VALUES</span>\n  (<span class="nu">3</span>, <span class="nu">-5</span>, <span class="nu">80.0</span>),\n  (<span class="nu">4</span>, <span class="nu">1</span>, <span class="st">\'n/a\'</span>)</pre></div>';
        var res = !st.done ? '' : pq
          ? verdict(false, 'The files were written, nothing checked them. The dashboard now shows a negative quantity, and some readers fail on <span class="mono">"n/a"</span> <b>later, far from the cause</b>.')
          : '<div class="errbox">[DELTA_VIOLATE_CONSTRAINT_WITH_VALUES] CHECK constraint qty_positive (quantity &gt; 0) violated by row with values: quantity : -5</div>' + verdict(true, 'The whole INSERT is rejected before the commit. The table stays at its last valid version. (The text amount would fail schema enforcement too.)');
        box.querySelector('#cb').innerHTML = seg('mode', [['parquet', '📂 plain Parquet folder'], ['delta', '🔺 Delta table']], st.mode) +
          '<div class="cols"><div>' + sql + '<div class="btnrow"><button class="btn acc" data-act="run"' + (st.done ? ' disabled' : '') + '>▶ Run the bad batch</button><button class="btn" data-act="reset">↺</button></div></div>' +
          '<div><div class="note">orders</div>' + rowsTable(['order_id', 'quantity', 'amount'], rows) + res + '</div></div>';
      }
      wire(box, draw); draw();
    }

    // I ── a report sums balances while an UPDATE moves money
    function isolation(el) {
      var st = { mode: 'none', k: 0 };
      var STEPS = ['Report reads A', 'UPDATE commits v6', 'Report reads B'];
      var box = h(title('🅸 Isolation: <em>one version per query</em>', LETTERS[2][3] + ' A report sums two balances while an UPDATE moves 100 from A to B. Step through it.') + '<div id="ib"></div>');
      el.appendChild(box);
      function draw(ev) {
        if (ev && ev.seg) { st.mode = ev.v; }
        if (ev && ev.act === 'next' && st.k < 3) st.k++;
        if (ev && ev.act === 'reset') st.k = 0;
        var k = st.k, snap = st.mode === 'delta';
        var a = k >= 2 ? 400 : 500, b = k >= 2 ? 400 : 300;
        var readA = k >= 1 ? 500 : null, readB = k >= 3 ? (snap ? 300 : 400) : null;
        var tbl = rowsTable(['account', 'balance', 'version'], [{ c: ['A', a, k >= 2 ? 'v6' : 'v5'], cls: k === 1 ? 'hlr' : '' }, { c: ['B', b, k >= 2 ? 'v6' : 'v5'], cls: k === 3 ? 'hlr' : '' }]);
        var rep = '<div class="card sk thin report"><b>📊 report:</b> SELECT sum(balance)<br>reads A = ' + (readA == null ? '…' : readA) + (snap && k >= 1 ? ' <small>(from v5)</small>' : '') +
          '<br>reads B = ' + (readB == null ? '…' : readB) + (snap && k >= 3 ? ' <small>(still from v5)</small>' : '') +
          (k >= 3 ? '<br><b>total = ' + (readA + readB) + '</b>' : '') + '</div>';
        var res = k < 3 ? '<div class="verdict">' + (k === 0 ? 'The true total is <b>800</b>, before and after the transfer.' : 'Step ' + k + ': ' + STEPS[k - 1] + '.') + '</div>'
          : snap ? verdict(true, 'The report was pinned to <b>v5</b> when it started: 500 + 300 = 800. The next query sees v6: 400 + 400 = 800.') : verdict(false, 'The report mixed <b>before</b> (A = 500) and <b>after</b> (B = 400): a total of 900 that never existed.');
        box.querySelector('#ib').innerHTML = seg('mode', [['none', '📂 no isolation'], ['delta', '🔺 Delta snapshot']], st.mode) +
          '<div class="stages">' + STEPS.map(function (s, i) { return '<button class="' + (k === i + 1 ? 'on' : k > i ? 'done' : '') + '"><span class="n">' + (i + 1) + '</span>' + s + '</button>'; }).join('') + '</div>' +
          '<div class="cols"><div>' + tbl + '<div class="btnrow"><button class="btn acc" data-act="next"' + (k >= 3 ? ' disabled' : '') + '>Next step →</button><button class="btn" data-act="reset">↺</button></div></div><div>' + rep + res + '</div></div>' +
          '<div class="callout sk thin">Writers are isolated too: Delta uses optimistic concurrency, no locks, and a conflict check when a writer commits.</div>';
      }
      wire(box, draw); draw();
    }

    // D ── the cluster dies right after "success"
    function durability(el) {
      var st = { mode: 'memory', k: 0 };
      var T = [['10:00', '✅ INSERT returns success'], ['10:01', '💥 the cluster dies'], ['10:05', '🖥️ a new cluster reads the table']];
      var box = h(title('🅳 Durability: <em>committed means kept</em>', LETTERS[3][3] + ' What happens to data that was acknowledged a second before a crash?') + '<div id="db"></div>');
      el.appendChild(box);
      function draw(ev) {
        if (ev && ev.seg) st.mode = ev.v;
        if (ev && ev.act === 'next' && st.k < 3) st.k++;
        if (ev && ev.act === 'reset') st.k = 0;
        var k = st.k, mem = st.mode === 'memory';
        var where = mem ? '<div class="store"><b>🧠 cluster memory / local disk</b><div class="file ' + (k >= 2 ? 'dead' : 'live') + '"><span class="ic">📦</span>orders 101–150<span class="tg">' + (k >= 2 ? 'lost' : 'buffered') + '</span></div></div>'
          : '<div class="store"><b>🪣 object storage (replicated)</b><div class="file live"><span class="ic">📦</span>part-00007.parquet<span class="tg">orders 101–150</span></div><div class="file live"><span class="ic">🧾</span>_delta_log/…07.json<span class="tg">v7</span></div></div>';
        var res = k < 3 ? '' : mem ? verdict(false, 'The job said <b>success</b>, but the rows were only in the cluster. They are gone.') : verdict(true, 'Version 7 is in storage, with every row. It is even readable next week with <span class="mono">VERSION AS OF 7</span>, until VACUUM.');
        box.querySelector('#db').innerHTML = seg('mode', [['memory', '🧠 acknowledged from memory'], ['delta', '🔺 Delta commit']], st.mode) +
          '<div class="cols"><div><div class="tline">' + T.map(function (t, i) { return '<div class="' + (k > i ? 'on' : '') + '"><b>' + t[0] + '</b> ' + t[1] + '</div>'; }).join('') + '</div>' +
          '<div class="btnrow"><button class="btn acc" data-act="next"' + (k >= 3 ? ' disabled' : '') + '>Next →</button><button class="btn" data-act="reset">↺</button></div></div><div>' + where + res + '</div></div>';
      }
      wire(box, draw); draw();
    }

    var acid = {
      id: 'acid', icon: '⚛️', title: 'ACID, letter by letter', sub: 'Atomicity, consistency, isolation, durability: what each means, and what goes wrong without it.',
      thumb: '<span style="font-size:40px;letter-spacing:6px;font-family:var(--hand)">A·C·I·D</span>',
      steps: [
        function (el) {
          el.appendChild(h(title('Four <em>promises</em> of a table', 'A lake is a folder of files. Jobs crash, and many people read while others write. ACID is what makes such a folder trustworthy.') +
            '<div class="acid4">' + LETTERS.map(function (l, i) { return '<div class="card sk' + (i % 2 ? ' alt' : '') + '" style="animation-delay:' + i * 0.15 + 's"><div class="big">' + l[0] + '</div><b>' + l[1] + '</b><div class="note" style="font-size:20px">' + l[2] + '</div><div>' + l[3] + '</div></div>'; }).join('') + '</div>' +
            '<div class="callout sk thin">One mechanism gives all four: a write becomes visible only when <b>one new commit file</b> <span class="mono">_delta_log/&lt;N&gt;.json</span> is created in durable storage. Click Next to try each letter, with and without Delta.</div>'));
        },
        atomicity, consistency, isolation, durability,
        function (el) {
          el.appendChild(h(title('Quick check')));
          el.appendChild(quiz({ id: 'acid', q: 'A 1,000-row INSERT into a Delta table with <span class="mono">CHECK (quantity &gt; 0)</span> contains one row with quantity 0. What is in the table afterwards?',
            options: ['999 new rows', 'All 1,000 rows, with a warning', 'None of the 1,000 rows: the write fails and no version is created', 'The 999 rows, and the bad one as NULL'],
            correct: 2, why: 'Consistency checks the rule before the commit, and atomicity makes the write all or nothing.' }));
        }
      ]
    };

    // ================================================================ Iceberg / UniForm
    function ufState(on, k) {
      // k: 0 = CREATE, 1 = INSERT, 2 = RENAME COLUMN amount → net_amount
      var folder = [['_delta_log/…000.json', 'v0 · protocol + metaData', 'log']];
      if (k >= 1) folder.push(['_delta_log/…001.json', 'v1 · add', 'log'], ['part-00000-a1.snappy.parquet', '3 rows', 'data']);
      if (k >= 2 && on) folder.push(['_delta_log/…002.json', 'v2 · RENAME COLUMN (metadata only)', 'log']);
      if (on) {
        folder.push(['metadata/00000-6f1c.metadata.json', 'Iceberg snapshot of v0', 'ice']);
        if (k >= 1) folder.push(['metadata/snap-81…avro', 'manifest list', 'ice'], ['metadata/c2…-m0.avro', 'manifest → part-00000', 'ice'], ['metadata/00001-9d0e.metadata.json', 'Iceberg snapshot of v1', 'ice']);
        if (k >= 2) folder.push(['metadata/00002-b7a4.metadata.json', 'Iceberg snapshot of v2', 'ice']);
      }
      return folder;
    }
    function ufLog(on) {
      var L = on ? [
        ['{"protocol": {"minReaderVersion": 3, "minWriterVersion": 7,', 1],
        ['   "readerFeatures": ["columnMapping"],', 1],
        ['   "writerFeatures": ["columnMapping", "icebergCompatV2"]}}', 1],
        ['{"metaData": {"schemaString": … "amount" … "metadata": {', 0],
        ['    "delta.columnMapping.id": 2,', 1],
        ['    "delta.columnMapping.physicalName": "col-5e2a…"} …,', 1],
        ['  "configuration": {', 0],
        ['    "delta.enableIcebergCompatV2": "true",', 1],
        ['    "delta.universalFormat.enabledFormats": "iceberg",', 1],
        ['    "delta.columnMapping.mode": "name",', 1],
        ['    "delta.columnMapping.maxColumnId": "3"}}}', 1]
      ] : [
        ['{"protocol": {"minReaderVersion": 1, "minWriterVersion": 2}}', 0],
        ['{"metaData": {"schemaString": … "amount" … "metadata": {} …,', 0],
        ['  "configuration": {}}}', 0]
      ];
      return '<pre class="jsonv">' + L.map(function (l) { return '<span class="' + (l[1] ? 'chg' : '') + '">' + esc(l[0]) + '</span>'; }).join('\n') + '</pre>';
    }
    function ufSchema(on, k) {
      if (!on) return rowsTable(['column', 'name inside the Parquet files'], [['order_id', 'order_id'], ['amount', 'amount'], ['status', 'status']].map(function (x) { return { c: x }; }));
      var r = [['order_id', 1, 'col-a81c…'], [k >= 2 ? '<b>net_amount</b>' : 'amount', 2, 'col-5e2a…'], ['status', 3, 'col-0f9b…']];
      return rowsTable(['logical name', 'id = Iceberg field id', 'physical name in Parquet'], r.map(function (x) { return { c: x, cls: k >= 2 && x[1] === 2 ? 'hlr' : '' }; }));
    }
    function uniformLab(el) {
      var st = { on: 'on', k: 0, view: 'folder' };
      var ACT = ['CREATE TABLE', 'INSERT 3 rows', 'RENAME COLUMN'];
      var box = h(title('Turn it <em>on</em>: what changes?', 'Switch UniForm off and on, run the three statements, and look at the folder, the first log file and the schema.') + '<div id="ub"></div>');
      el.appendChild(box);
      function sql(on) {
        return '<div class="cell"><div class="ch">notebook cell · SQL</div><pre><span class="kw">CREATE TABLE</span> main.sales.orders_uf\n  (order_id <span class="kw">BIGINT</span>, amount <span class="kw">DOUBLE</span>, status <span class="kw">STRING</span>)' +
          (on ? '\n<span class="kw">TBLPROPERTIES</span> (\n  <span class="st">\'delta.enableIcebergCompatV2\'</span> = <span class="st">\'true\'</span>,\n  <span class="st">\'delta.universalFormat.enabledFormats\'</span> = <span class="st">\'iceberg\'</span>)' : '') + ';' +
          (st.k >= 1 ? '\n<span class="kw">INSERT INTO</span> main.sales.orders_uf <span class="kw">VALUES</span> …;' : '') +
          (st.k >= 2 ? '\n<span class="kw">ALTER TABLE</span> main.sales.orders_uf\n  <span class="kw">RENAME COLUMN</span> amount <span class="kw">TO</span> net_amount;' : '') + '</pre></div>';
      }
      function draw(ev) {
        if (ev && ev.seg === 'uf') st.on = ev.v;
        if (ev && ev.seg === 'view') st.view = ev.v;
        if (ev && ev.act === 'next' && st.k < 2) st.k++;
        if (ev && ev.act === 'reset') st.k = 0;
        var on = st.on === 'on', k = st.k, panel;
        if (st.view === 'folder') panel = '<div class="folder"><div class="fh">orders_uf/</div>' + ufState(on, k).map(function (f) { return '<div class="file ' + (f[2] === 'ice' ? 'ice' : f[2] === 'data' ? 'live' : '') + '"><span class="ic">' + (f[2] === 'ice' ? '🧊' : f[2] === 'data' ? '📦' : '🧾') + '</span>' + f[0] + '<span class="tg">' + f[1] + '</span></div>'; }).join('') + '</div>' +
          (on ? '<div class="small">🧊 files are Iceberg metadata, written <b>after</b> each commit (asynchronously). They point to the <b>same</b> Parquet file: nothing is copied.</div>' : '');
        else if (st.view === 'log') panel = '<div class="note">_delta_log/…000.json (shortened)</div>' + ufLog(on) + (on ? '<div class="small">Highlighted: what UniForm adds. The protocol now requires <b>table features</b>; old clients without column mapping support cannot read the table.</div>' : '');
        else panel = ufSchema(on, k) + '<div class="small">' + (on ? 'Iceberg finds columns by <b>id</b>. Column mapping gives each column an id and a physical name, so the rename changes only the log: no file is rewritten.' : 'Without column mapping, Parquet files store the real column names. <span class="mono">RENAME COLUMN</span> is not allowed (it would need a full rewrite).') + '</div>';
        if (!on && k >= 2) panel = '<div class="errbox">Error: RENAME COLUMN needs column mapping on this table (delta.columnMapping.mode = \'name\').</div>' + panel;
        box.querySelector('#ub').innerHTML = '<div class="btnrow" style="margin:0 0 10px">' + seg('uf', [['off', '🔺 plain Delta'], ['on', '🔺+🧊 UniForm on']], st.on) + '</div>' +
          '<div class="cols"><div>' + sql(on) + '<div class="stages">' + ACT.map(function (a, i) { return '<button class="' + (i === k ? 'on' : i < k ? 'done' : '') + '"><span class="n">' + (i + 1) + '</span>' + a + '</button>'; }).join('') + '</div>' +
          '<div class="btnrow"><button class="btn acc" data-act="next"' + (k >= 2 ? ' disabled' : '') + '>Run the next statement →</button><button class="btn" data-act="reset">↺</button></div></div>' +
          '<div>' + seg('view', [['folder', '📂 folder'], ['log', '📜 log v0'], ['schema', '🧬 schema']], st.view) + panel + '</div></div>';
      }
      wire(box, draw); draw();
    }
    var SPARK = {
      dbx: ['On Databricks', 'Nothing to add to Spark. Set the two table properties (or run <span class="mono">REORG … UPGRADE UNIFORM</span> on an existing table). Databricks writes the Iceberg metadata, and Unity Catalog serves it.',
        '<span class="cm">-- existing table with deletion vectors: REORG also purges them</span>\n<span class="kw">REORG TABLE</span> main.sales.orders\n  <span class="kw">APPLY</span> (UPGRADE UNIFORM(ICEBERG_COMPAT_VERSION = <span class="nu">2</span>));'],
      ext: ['External Spark reads it', 'An open-source Spark reads the table <b>as Iceberg</b> through the Unity Catalog Iceberg REST catalog. It needs the Iceberg runtime, a cloud bundle, and one catalog definition per Unity Catalog catalog.',
        '<span class="cm"># packages</span>\norg.apache.iceberg:iceberg-spark-runtime-3.5_2.12:&lt;version&gt;\norg.apache.iceberg:iceberg-aws-bundle:&lt;version&gt;   <span class="cm"># or azure / gcp</span>\n\n<span class="cm"># catalog</span>\nspark.sql.catalog.uc            = org.apache.iceberg.spark.SparkCatalog\nspark.sql.catalog.uc.type       = rest\nspark.sql.catalog.uc.uri        = https://&lt;workspace&gt;/api/2.1/unity-catalog/iceberg-rest\nspark.sql.catalog.uc.warehouse  = main\nspark.sql.catalog.uc.token      = &lt;token&gt;\n\n<span class="kw">SELECT</span> * <span class="kw">FROM</span> uc.sales.orders_uf'],
      oss: ['Open-source Delta writes it', 'Outside Databricks, open-source Delta Lake can write UniForm tables too. Spark then needs the Delta packages <b>and</b> the delta-iceberg module that generates the Iceberg metadata.',
        '<span class="cm"># packages</span>\nio.delta:delta-spark_2.12:&lt;delta-version&gt;\nio.delta:delta-iceberg_2.12:&lt;delta-version&gt;\n\n<span class="cm"># session</span>\nspark.sql.extensions            = io.delta.sql.DeltaSparkSessionExtension\nspark.sql.catalog.spark_catalog = org.apache.spark.sql.delta.catalog.DeltaCatalog']
    };
    var iceberg = {
      id: 'iceberg', icon: '🧊', title: 'Iceberg compatibility (UniForm)', sub: 'One Delta table, also readable as Apache Iceberg. What to enable, and how the log, the schema and the folder change.',
      thumb: '<span style="font-size:46px">🔺📦🧊</span>',
      steps: [
        function (el) {
          el.appendChild(h(title('Two table formats, <em>one copy</em> of data', 'Delta Lake and Apache Iceberg both store Parquet files plus metadata. Only the metadata differs. UniForm writes <b>both</b>.') +
            '<div class="cols"><div class="folder"><div class="fh">orders_uf/</div>' +
            '<div class="file"><span class="ic">📁</span>_delta_log/<span class="tg">Delta: JSON commits</span></div>' +
            '<div class="file ice new"><span class="ic">📁</span>metadata/<span class="tg">Iceberg: metadata.json → manifest list → manifests</span></div>' +
            '<div class="file live"><span class="ic">📦</span>part-00000.parquet<span class="tg">shared by both</span></div>' +
            '<div class="file live"><span class="ic">📦</span>part-00001.parquet<span class="tg">shared by both</span></div></div><div>' +
            list(['Writes go through <b>Delta</b> (Databricks, Delta clients).', '+After each commit, Iceberg metadata is generated for the new version.', '+Iceberg engines (Spark, Trino, Snowflake, …) read the same files through Unity Catalog.',
              'Iceberg needs a stable <b>id</b> per column, so UniForm turns on <b>column mapping</b>.', '-Iceberg v2 readers cannot apply deletion vectors, so they must be off (Iceberg v3 supports them).']) + '</div></div>'));
        },
        uniformLab,
        function (el) {
          var st = { v: 'dbx' };
          var box = h(title('What to add to <em>Spark</em>', 'Three situations. Pick one.') + '<div id="sp"></div>');
          el.appendChild(box);
          function draw(ev) {
            if (ev && ev.seg) st.v = ev.v;
            var s = SPARK[st.v];
            box.querySelector('#sp').innerHTML = seg('sp', [['dbx', '🧱 On Databricks'], ['ext', '🔌 External Spark reads'], ['oss', '🛠️ OSS Delta writes']], st.v) +
              '<div class="cols"><div class="cell"><div class="ch">' + s[0] + '</div><pre>' + s[2] + '</pre></div><div><p class="lead">' + s[1] + '</p>' +
              (st.v === 'ext' ? '<div class="callout sk thin">The principal needs USE CATALOG, USE SCHEMA and SELECT, and an admin must allow external data access on the metastore. Check the docs for matching versions.</div>' : '') + '</div></div>';
          }
          wire(box, draw); draw();
        },
        function (el) {
          el.appendChild(h(title('Quick check')));
          el.appendChild(quiz({ id: 'iceberg', q: 'You enable UniForm on a 2 TB Delta table. What is added to storage?',
            options: ['A full Iceberg copy of the 2 TB', 'Small Iceberg metadata files that point to the same Parquet files', 'Nothing: Iceberg reads the Delta log directly', 'A CSV export for each Iceberg client'],
            correct: 1, why: 'UniForm generates Iceberg metadata (JSON and Avro) next to the Delta log. The Parquet data files are shared, not copied.' }));
        }
      ]
    };

    // ================================================================ open data sharing
    var RECIP = {
      d2d: ['Databricks-to-Databricks', 'The recipient is another Unity Catalog metastore, identified by its sharing identifier. It mounts the share as a catalog and queries it like any table, with its own permissions.',
        '<span class="kw">CREATE RECIPIENT</span> partner_eu\n  <span class="kw">USING ID</span> <span class="st">\'aws:eu-central-1:6f1c…\'</span>;\n<span class="kw">GRANT SELECT ON SHARE</span> sales_share <span class="kw">TO RECIPIENT</span> partner_eu;'],
      token: ['Open sharing: bearer token', 'Any client, not only Databricks: pandas, Spark, Power BI, Tableau. The recipient downloads a credential file once from an activation link.',
        '<span class="cm"># recipient side, any Python</span>\n<span class="kw">import</span> delta_sharing\nprofile = <span class="st">"config.share"</span>   <span class="cm"># from the activation link</span>\ndf = delta_sharing.load_as_pandas(\n  profile + <span class="st">"#sales_share.sales.orders"</span>)'],
      oidc: ['Open sharing: OIDC federation', 'Open sharing without long-lived tokens: the recipient signs in with its own identity provider (for example Microsoft Entra ID), and Databricks trusts those tokens.',
        '<span class="cm">-- provider side</span>\n<span class="kw">CREATE RECIPIENT</span> partner_oidc;   <span class="cm">-- then add an OIDC federation policy</span>\n<span class="kw">GRANT SELECT ON SHARE</span> sales_share <span class="kw">TO RECIPIENT</span> partner_oidc;']
    };
    var sharing = {
      id: 'sharing', icon: '🤝', title: 'Open data sharing', sub: 'Delta Sharing: share live tables with anyone, without copying them.',
      thumb: '<span style="font-size:42px">🏢→🤝→🧑‍💼</span>',
      steps: [
        function (el) {
          var box = h(title('Share, do <em>not copy</em>', 'Delta Sharing is an open protocol. The provider shares live tables; the recipient reads them directly from the provider\'s storage, with short-lived signed URLs. Press play.') +
            '<div class="shflow"><div class="card sk">🏢 <b>Provider</b><br>Unity Catalog<br><span class="mono">sales_share</span></div><div class="arrow" id="a1">→</div><div class="card sk alt">🤝 <b>Sharing server</b><br>checks the recipient,<br>picks the version</div><div class="arrow" id="a2">→</div><div class="card sk">🧑‍💼 <b>Recipient</b><br>Databricks, pandas,<br>Spark, Power BI…</div></div>' +
            '<div class="stages" id="shs"></div><div class="callout sk thin" id="shn"></div><div class="btnrow"><button class="btn acc" id="shp">▶ Next</button></div>');
          el.appendChild(box);
          var S2 = [['Request', 'The client asks for <span class="mono">sales_share.sales.orders</span> with its credential: a recipient metastore, a bearer token or an OIDC token.'],
            ['Check', 'The server checks that the share is granted to this recipient and finds the current table version (or the version asked for).'],
            ['Sign', 'It returns the list of Parquet files of that version as <b>short-lived pre-signed URLs</b>.'],
            ['Read', 'The client downloads the files straight from the provider\'s cloud storage. No copy, no export job, always the live data.']], k = 0;
          function draw() {
            box.querySelector('#shs').innerHTML = S2.map(function (s, i) { return '<button class="' + (i === k ? 'on' : i < k ? 'done' : '') + '"><span class="n">' + (i + 1) + '</span>' + s[0] + '</button>'; }).join('');
            box.querySelector('#shn').innerHTML = S2[k][1];
            box.querySelector('#a1').classList.toggle('go', k <= 1); box.querySelector('#a2').classList.toggle('go', k >= 2);
          }
          box.querySelector('#shp').onclick = function () { k = (k + 1) % S2.length; draw(); };
          draw();
        },
        function (el) {
          var st = { v: 'token' };
          var box = h(title('Three kinds of <em>recipient</em>', 'The provider side is always the same: a share, tables in it, a recipient, a grant. Pick the recipient.') +
            '<div class="cell" style="margin-bottom:12px"><div class="ch">provider · SQL (needs CREATE SHARE and CREATE RECIPIENT on the metastore)</div><pre><span class="kw">CREATE SHARE</span> sales_share;\n<span class="kw">ALTER SHARE</span> sales_share <span class="kw">ADD TABLE</span> main.sales.orders;</pre></div><div id="rc"></div>');
          el.appendChild(box);
          function draw(ev) {
            if (ev && ev.seg) st.v = ev.v;
            var r = RECIP[st.v];
            box.querySelector('#rc').innerHTML = seg('r', [['d2d', '🧱 Databricks-to-Databricks'], ['token', '🔑 open: bearer token'], ['oidc', '🪪 open: OIDC']], st.v) +
              '<div class="cols"><div class="cell"><div class="ch">' + r[0] + '</div><pre>' + r[2] + '</pre></div><div><p class="lead">' + r[1] + '</p>' +
              list(['+Live data: recipients see new versions without a new export.', '+The provider can revoke access at any time and audit every read.', 'Share views to filter or mask: tables with row filters or masks cannot be shared directly.']) + '</div></div>';
          }
          wire(box, draw); draw();
        },
        function (el) {
          el.appendChild(h(title('Quick check')));
          el.appendChild(quiz({ id: 'sharing', q: 'A partner without Databricks must read your daily orders table in pandas. What do you set up?',
            options: ['A nightly CSV export to an FTP server', 'An open sharing recipient: they get a credential and read the live table with the delta-sharing client', 'A Databricks account for the partner, it is required', 'A copy of the table in their cloud account'],
            correct: 1, why: 'Open sharing works with any client. The recipient reads the provider\'s current Parquet files through short-lived signed URLs; nothing is copied or exported.' }));
        }
      ]
    };

    return [acid, iceberg, sharing];
  };
})();
