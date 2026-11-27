/* Pipelines storyboard: the story scenes.
   Flow = query + target → multi-flow vs UNION → the flow name is the checkpoint → streaming table vs materialized view
   → multiplex → sinks and Iceberg reads → expectations on a multi-flow target → NULL-tolerant rules and schema drift
   → quarantine → AUTO CDC SCD 1 vs 2 → which pattern when. One small simulator per frame. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var SC = window.PIPE_SCENES = [];

  var SQLKW = /\b(CREATE|OR|REFRESH|STREAMING|TABLE|MATERIALIZED|VIEW|FLOW|AS|INSERT|INTO|BY|NAME|SELECT|FROM|STREAM|WHERE|CONSTRAINT|EXPECT|ON|VIOLATION|DROP|ROW|FAIL|UPDATE|AND|NOT|CASE|WHEN|THEN|ELSE|END|IS|NULL|BETWEEN|AUTO|CDC|KEYS|APPLY|DELETE|SEQUENCE|COLUMNS|EXCEPT|STORED|SCD|TYPE|CLUSTER|PARTITIONED|TRUE|FALSE|UNION|ALL|GROUP|SUM|TBLPROPERTIES|COALESCE)\b(?![^<]*<\/span>)/g;
  var PYKW = /\b(from|import|def|return|True|False|None)\b(?![^<]*<\/span>)/g;
  function sqlHL(code) { return esc(code).replace(/(--[^\n]*)/g, '<span class="cm">$1</span>').replace(/('[^'\n]*')/g, '<span class="st">$1</span>').replace(SQLKW, '<span class="kw">$1</span>'); }
  function pyHL(code) { return esc(code).replace(/("[^"\n]*")/g, '<span class="st">$1</span>').replace(/(#[^\n]*)/g, '<span class="cm">$1</span>').replace(PYKW, '<span class="kw">$1</span>'); }
  function sql(code) { return '<pre class="code">' + sqlHL(code) + '</pre>'; }
  function py(code) { return '<pre class="code">' + pyHL(code) + '</pre>'; }
  // code with tagged lines: [['t', 'CREATE ...'], ['f', '...']]
  function tagged(lines, lang) { return '<pre class="code">' + lines.map(function (l) { return '<span class="ln ' + l[0] + '">' + (lang === 'py' ? pyHL(l[1]) : sqlHL(l[1])) + (l[1] ? '' : ' ') + '</span>'; }).join('') + '</pre>'; }
  function ctr(n, label, cls) { return '<span class="ctr ' + (cls || '') + '"><b>' + n + '</b><small>' + label + '</small></span>'; }
  function nul(v) { return v === null || v === undefined ? '<i class="nul">NULL</i>' : esc(v); }
  function ask(api, q) { return function (el) { el.appendChild(h(title('Quick check'))); el.appendChild(api.quiz(q)); }; }

  // ════════════════════════════════════════════════════════════════ 1 ── flow = query + target
  var FLOWCODE = {
    def: { lang: 'sql', name: 'orders_bronze', lines: [
      ['t', '-- default flow: table and flow in one statement'],
      ['t', 'CREATE OR REFRESH STREAMING TABLE orders_bronze'],
      ['q', 'AS SELECT *'],
      ['q', "FROM STREAM read_files('/Volumes/shop/raw/store_a', format => 'csv');"]] },
    exp: { lang: 'sql', name: 'store_a_flow', lines: [
      ['t', '-- 1. the target, on its own'],
      ['t', 'CREATE OR REFRESH STREAMING TABLE orders_bronze;'],
      ['t', ''],
      ['f', '-- 2. an explicit flow that writes into it'],
      ['f', 'CREATE FLOW store_a_flow'],
      ['f', 'AS INSERT INTO orders_bronze BY NAME'],
      ['q', 'SELECT *'],
      ['q', "FROM STREAM read_files('/Volumes/shop/raw/store_a', format => 'csv');"]] },
    py: { lang: 'py', name: 'store_a_flow', lines: [
      ['t', 'from pyspark import pipelines as dp'],
      ['t', 'dp.create_streaming_table("orders_bronze")'],
      ['t', ''],
      ['f', '@dp.append_flow(target="orders_bronze", name="store_a_flow")'],
      ['f', 'def store_a_flow():'],
      ['q', '    return (spark.readStream.format("cloudFiles")'],
      ['q', '            .option("cloudFiles.format", "csv")'],
      ['q', '            .load("/Volumes/shop/raw/store_a"))']] }
  };
  SC.push({
    id: 'flow', icon: '🔁', title: 'Flow = query + target', sub: 'The unit of work in a pipeline: what to read, and where it lands.',
    thumb: '<div class="th-row"><span class="a">query</span><i>→</i><span class="d">flow</span><i>→</i><span class="c">table</span></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('Every table is filled by a <em>flow</em>', 'A flow reads something, transforms it, and writes the result into one target. Each flow keeps its own checkpoint.') +
          '<div class="graph" style="justify-content:center"><div class="gn q"><b>🔎 Query</b>what to read and how<br><span class="mono">SELECT … FROM STREAM …</span></div><span class="ga">→</span>' +
          '<div class="gn f"><b>🔁 Flow</b>runs the query<br>🔖 own checkpoint</div><span class="ga">→</span><div class="gn t"><b>🌊 Target</b>streaming table<br>or materialized view</div></div>' +
          '<div class="cmp mt" style="--n:2"><div class="card sk"><h4>⚡ Incremental update</h4>' + list(['Reads only what is new since the last update.', 'The checkpoint is the bookmark.', '+The normal way a pipeline runs.']) + '</div>' +
          '<div class="card sk alt"><h4>🔄 Full refresh</h4>' + list(['Discards the checkpoint and empties the target.', 'Reads the whole source again.', '-Expensive. Use it after a logic change that must reach old rows.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('Default flow or <em>explicit</em> flow?', 'Switch the code. Click a box in the graph to see which lines create it. The graph is the same: only the flow name changes.') +
          '<div class="tabs" id="ft"><button data-k="def" class="on">default flow (SQL)</button><button data-k="exp">explicit flow (SQL)</button><button data-k="py">explicit flow (Python)</button></div>' +
          '<div class="cols fl1" id="fl" data-hl="f"><div id="fc"></div><div><div class="graph" id="fg"></div><div class="card sk thin mt" id="fn"></div></div></div>');
        el.appendChild(box);
        var k = 'def', hl = 'f';
        function draw() {
          var c = FLOWCODE[k];
          box.querySelector('#fc').innerHTML = tagged(c.lines, c.lang);
          box.querySelector('#fl').dataset.hl = hl;
          box.querySelector('#fg').innerHTML = '<div class="gn q' + (hl === 'q' ? ' on' : '') + '" data-k="q"><b>🔎 query</b><span class="mono">store_a files</span></div><span class="ga">→</span>' +
            '<div class="gn f' + (hl === 'f' ? ' on' : '') + '" data-k="f"><b>🔁 flow</b><span class="mono">' + c.name + '</span></div><span class="ga">→</span>' +
            '<div class="gn t' + (hl === 't' ? ' on' : '') + '" data-k="t"><b>🌊 target</b><span class="mono">orders_bronze</span></div>';
          box.querySelector('#fn').innerHTML = k === 'def' ?
            '<span class="note">default flow</span><p class="small" style="margin:4px 0 0">One statement creates the table <b>and</b> its flow. The flow is invisible and takes the table name: <span class="mono">orders_bronze</span>. A table defined this way has exactly one source.</p>' :
            '<span class="note">explicit flow</span><p class="small" style="margin:4px 0 0">The table is created empty. A separate, <b>named</b> flow (<span class="mono">store_a_flow</span>) writes into it. Now more flows can target the same table, and a new source can be added later without touching the others.</p>';
          box.querySelectorAll('#fg .gn').forEach(function (g) { g.onclick = function () { hl = g.dataset.k; draw(); }; });
        }
        box.querySelectorAll('#ft button').forEach(function (b) { b.onclick = function () { k = b.dataset.k; box.querySelectorAll('#ft button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
      },
      function (el, api) {
        ask(api, { id: 'flow', q: 'You write <span class="mono">CREATE OR REFRESH STREAMING TABLE orders_bronze AS SELECT * FROM STREAM raw_orders</span>. What is the name of the flow that fills it?',
          options: ['There is no flow', '<span class="mono">orders_bronze</span>: the default flow takes the table name', '<span class="mono">raw_orders</span>', 'A random id generated per update'],
          correct: 1, why: 'Defining a streaming table with a query creates its default flow implicitly, with the same name as the table. Explicit flows are created with CREATE FLOW or @dp.append_flow.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 2 ── multi-flow vs UNION
  SC.push({
    id: 'multiflow', icon: '🧩', title: 'Multi-flow vs UNION', sub: 'Three stores, one bronze table. Add a store, break a store: who pays?',
    thumb: '<div class="th-col"><div class="th-row"><span class="a">A</span><span class="b">B</span><span class="d">C</span></div><i style="font-family:var(--hand);font-size:24px;color:var(--soft)">↓ ↓ ↓</i><div class="th-row"><span class="c">orders_bronze</span></div></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('Two ways to load many sources into <em>one</em> table') + '<div class="cols"><div><span class="note">❌ one query with UNION</span>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_bronze AS\nSELECT * FROM STREAM read_files('/Volumes/shop/raw/store_a')\nUNION ALL\nSELECT * FROM STREAM read_files('/Volumes/shop/raw/store_b');") +
          '</div><div><span class="note">✅ one flow per source</span>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_bronze;\n\nCREATE FLOW store_a_flow AS INSERT INTO orders_bronze BY NAME\nSELECT * FROM STREAM read_files('/Volumes/shop/raw/store_a');\n\nCREATE FLOW store_b_flow AS INSERT INTO orders_bronze BY NAME\nSELECT * FROM STREAM read_files('/Volumes/shop/raw/store_b');") +
          '</div></div><div class="callout sk thin"><span class="mono">BY NAME</span> matches columns by name, so each source may list its columns in a different order. Next: run both versions and see what happens when a store is added or breaks.</div>'));
      },
      function (el) {
        var box = h(title('Simulate it: <em>add a store, break a store</em>', 'Each file holds 100 rows. Press ▶ run update after every change and watch “rows read”.') +
          '<div class="tabs" id="mm"><button data-m="union">❌ UNION: one query</button><button data-m="multi" class="on">✅ multi-flow</button></div>' +
          '<div class="ctrls"><button class="btn" id="m_new">📥 new file per store</button><button class="btn" id="m_c">➕ add store C (3 old files)</button><button class="btn" id="m_b">💥 store B breaks</button><button class="btn acc" id="m_run">▶ run update</button><button class="btn" id="m_rs">↺ reset</button></div>' +
          '<div class="lanes2"><div id="m_lanes"></div><div class="tgt" id="m_tgt"></div></div><div class="ctrs mt" id="m_ctr"></div><div class="verdict" id="m_log"></div>');
        el.appendChild(box);
        var st;
        function reset() { st = { files: { A: 2, B: 2, C: 0 }, done: { A: 2, B: 2, C: 0 }, hasC: false, failB: false, needFull: false, target: 400, lastRead: 0, totalRead: 400, status: {}, log: 'The first update already ran: stores A and B, two files each, 400 rows in <span class="mono">orders_bronze</span>.', cls: '' }; }
        function chips(s) { var o = ''; for (var i = 1; i <= st.files[s]; i++) o += '<span class="fchip ' + (i <= st.done[s] ? 'done' : 'wait') + '">' + s.toLowerCase() + '_' + i + (s === 'B' ? '.json' : '.csv') + '</span>'; return o || '<span class="small">no files yet</span>'; }
        function draw() {
          var mode = box.dataset.m, L = '';
          ['A', 'B', 'C'].forEach(function (s) {
            var on = s !== 'C' || st.hasC, fail = s === 'B' && st.failB;
            L += '<div class="lane2' + (on ? '' : ' off') + (fail ? ' fail' : '') + '"><h6>🏪 store ' + s + '<small>' + (s === 'B' ? 'JSON' : 'CSV') + (fail ? ' · 💥 broken' : '') + '</small></h6><div class="fchips">' + (on ? chips(s) : '<span class="small">not connected yet</span>') + '</div>' +
              (mode === 'multi' ? '<div class="cp">🔖 checkpoints/<b>store_' + s.toLowerCase() + '_flow</b><br>' + (on ? 'read up to file ' + st.done[s] : '–') + (st.status[s] ? '<br>' + st.status[s] : '') + '</div>' : '<div class="small" style="text-align:center">↘ part of the one query</div>') + '</div>';
          });
          if (mode === 'union') L += '<div class="cp shared">🔖 ONE checkpoint: checkpoints/<b>orders_bronze</b> · A up to ' + st.done.A + ', B up to ' + st.done.B + (st.hasC ? ', C up to ' + st.done.C : '') + (st.needFull ? '<br>⚠️ the query changed: this checkpoint no longer fits' : '') + '</div>';
          box.querySelector('#m_lanes').innerHTML = L;
          box.querySelector('#m_tgt').innerHTML = '<b>🌊 orders_bronze</b><div class="big">' + st.target + '</div><small>rows</small>';
          box.querySelector('#m_ctr').innerHTML = ctr(st.lastRead, 'rows read by the last update', st.lastRead > 300 ? 'warn' : '') + ctr(st.totalRead, 'rows read in total') + ctr(mode === 'union' ? 1 : (st.hasC ? 3 : 2), 'checkpoints');
          var lg = box.querySelector('#m_log'); lg.className = 'verdict ' + st.cls; lg.innerHTML = st.log;
          box.querySelector('#m_c').disabled = st.hasC;
          box.querySelector('#m_b').textContent = st.failB ? '🔧 fix store B' : '💥 store B breaks';
        }
        function run() {
          var mode = box.dataset.m, read = 0, srcs = st.hasC ? ['A', 'B', 'C'] : ['A', 'B'];
          st.status = {};
          if (mode === 'union') {
            if (st.failB) { st.lastRead = 0; st.log = '💥 Store B fails, and it is part of the one query: <b>the whole update fails</b>. New files of A' + (st.hasC ? ' and C' : '') + ' wait too.'; st.cls = 'bad'; draw(); return; }
            if (st.needFull) {
              srcs.forEach(function (s) { read += st.files[s] * 100; st.done[s] = st.files[s]; });
              st.target = read; st.needFull = false; st.lastRead = read; st.totalRead += read;
              st.log = '🔄 Adding C changed the query, so the shared checkpoint is reset: a <b>full refresh</b>. Every file of every store is read again: <b>' + read + ' rows</b>, though only ' + (3 * 100) + ' rows from C were new to the table.'; st.cls = 'warn'; draw(); return;
            }
          }
          srcs.forEach(function (s) {
            if (mode === 'multi' && s === 'B' && st.failB) { st.status.B = '❌ flow failed'; return; }
            var n = (st.files[s] - st.done[s]) * 100; read += n; st.done[s] = st.files[s];
            if (mode === 'multi') st.status[s] = n ? '✅ +' + n + ' rows' : '✅ nothing new';
          });
          st.target += read; st.lastRead = read; st.totalRead += read;
          st.log = mode === 'multi' && st.failB ? '💥 Only <b>store_b_flow</b> failed. The other flows committed their new rows (' + read + '). B resumes from its own checkpoint once it is fixed.' :
            read ? 'Each flow read only its new files: <b>' + read + ' rows</b>.' + (mode === 'multi' && st.status.C && st.status.C.indexOf('300') >= 0 ? ' Store C backfilled its 3 old files; A and B did not re-read anything.' : '') : 'Nothing new to read.';
          st.cls = mode === 'multi' && st.failB ? 'warn' : 'good';
          draw();
        }
        box.querySelector('#m_new').onclick = function () { st.files.A++; st.files.B++; if (st.hasC) st.files.C++; st.log = 'New files landed. Nothing is read until the next update.'; st.cls = ''; draw(); };
        box.querySelector('#m_c').onclick = function () { st.hasC = true; st.files.C = 3; if (box.dataset.m === 'union') { st.needFull = true; st.log = 'You edited the UNION query to add <span class="mono">store_c</span>. Run the update.'; } else st.log = 'You added one new flow, <span class="mono">store_c_flow</span>, with its own empty checkpoint. Run the update.'; st.cls = ''; draw(); };
        box.querySelector('#m_b').onclick = function () { st.failB = !st.failB; st.log = st.failB ? 'Store B now sends a broken file. Run the update.' : 'Store B is fixed.'; st.cls = ''; draw(); };
        box.querySelector('#m_run').onclick = run;
        box.querySelector('#m_rs').onclick = function () { reset(); draw(); };
        box.querySelectorAll('#mm button').forEach(function (b) { b.onclick = function () { box.dataset.m = b.dataset.m; box.querySelectorAll('#mm button').forEach(function (x) { x.classList.toggle('on', x === b); }); reset(); draw(); }; });
        box.dataset.m = 'multi'; reset(); draw();
      },
      function (el) {
        el.appendChild(h(title('Why the course prefers <em>multi-flow</em>') + '<table class="tbl"><tr><th></th><th>❌ UNION in one query</th><th>✅ one flow per source</th></tr>' +
          '<tr><td>Checkpoints</td><td>one, shared</td><td>one per flow</td></tr><tr><td>Add a source</td><td>query changes → full refresh</td><td>add a flow; only it backfills</td></tr>' +
          '<tr><td>One source fails</td><td>the whole update fails</td><td>only that flow stops</td></tr><tr><td>Monitoring</td><td>one set of numbers</td><td>rows and errors per source</td></tr></table>' +
          '<div class="callout sk thin">Expectations are written on the <b>target table</b>, not on a flow. Every flow that writes into <span class="mono">orders_bronze</span> is checked by the same rules (frame 7).</div>'));
      },
      function (el, api) {
        ask(api, { id: 'multiflow', q: 'A fourth subsidiary joins next month. Your bronze table is loaded with one flow per subsidiary. What do you do?',
          options: ['Full refresh the table, then add the source', 'Add a fourth CREATE FLOW … INSERT INTO the same table: only the new flow reads its history', 'Rewrite the table as a UNION of four sources', 'Create a second bronze table and join them'],
          correct: 1, why: 'Every flow has its own checkpoint. A new flow starts empty and backfills its own source; the three existing flows continue from where they were.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 3 ── flow name = checkpoint
  SC.push({
    id: 'rename', icon: '🔖', title: 'The flow name is the checkpoint', sub: 'Rename a flow and it forgets everything it has read.',
    thumb: '<div class="th-row"><span class="d">store_a_flow</span><i>✏️</i><span class="r">store_a_orders</span></div>',
    steps: [
      function (el) {
        var box = h(title('Rename a flow, <em>count the rows</em>', 'The pipeline finds a flow\'s progress by the flow\'s name. Try: run, rename, run.') +
          '<div class="ctrls"><button class="btn" id="r_new">📥 new file</button><button class="btn" id="r_ren">✏️ rename the flow</button><button class="btn acc" id="r_run">▶ run update</button><button class="btn" id="r_rs">↺ reset</button></div>' +
          '<div class="cols"><div><div id="r_code"></div><div class="cpdir mt" id="r_dir"></div></div><div><div class="tgt" id="r_tgt" style="text-align:left"></div><div class="ctrs mt" id="r_ctr"></div></div></div><div class="verdict" id="r_log"></div>');
        el.appendChild(box);
        var st;
        function reset() { st = { files: 3, name: 'store_a_flow', cps: { store_a_flow: 3 }, rows: [1, 2, 3], log: 'The flow has run once: 3 files, 300 rows.', cls: '' }; }
        function draw() {
          box.querySelector('#r_code').innerHTML = sql('CREATE FLOW ' + st.name + '\nAS INSERT INTO orders_bronze BY NAME\nSELECT * FROM STREAM read_files(\'/Volumes/shop/raw/store_a\');');
          var d = '<span class="d">checkpoints/</span><br>';
          Object.keys(st.cps).forEach(function (n) { d += '&nbsp;&nbsp;' + (n === st.name ? '<span class="cur">📁 ' + n + '/  → read up to file ' + st.cps[n] + '</span>' : '<span class="old">📁 ' + n + '/  → file ' + st.cps[n] + '</span> <span class="small">orphaned</span>') + '<br>'; });
          if (!(st.name in st.cps)) d += '&nbsp;&nbsp;<span class="cur">📁 ' + st.name + '/  → (empty: never ran)</span><br>';
          box.querySelector('#r_dir').innerHTML = d;
          var cnt = {}; st.rows.forEach(function (f) { cnt[f] = (cnt[f] || 0) + 1; });
          var dup = st.rows.filter(function (f, i) { return st.rows.indexOf(f) !== i; }).length;
          box.querySelector('#r_tgt').innerHTML = '<b>🌊 orders_bronze</b> <span class="small">(append only, 100 rows per block)</span><div class="blocks mt">' + st.rows.map(function (f, i) { return '<span class="fchip ' + (st.rows.indexOf(f) !== i ? 'dup' : 'done') + '">file ' + f + '</span>'; }).join('') + '</div>';
          box.querySelector('#r_ctr').innerHTML = ctr(st.rows.length * 100, 'rows in the table') + ctr(dup * 100, 'duplicate rows', dup ? 'bad' : 'good') + ctr(st.files, 'files in the source');
          var lg = box.querySelector('#r_log'); lg.className = 'verdict ' + st.cls; lg.innerHTML = st.log;
        }
        box.querySelector('#r_new').onclick = function () { st.files++; st.log = 'File ' + st.files + ' landed.'; st.cls = ''; draw(); };
        box.querySelector('#r_ren').onclick = function () { st.name = st.name === 'store_a_flow' ? 'store_a_orders' : (st.name === 'store_a_orders' ? 'store_a_orders_v2' : 'store_a_flow'); st.log = 'You renamed the flow to <span class="mono">' + st.name + '</span>. Same query, same target. Now run the update.'; st.cls = ''; draw(); };
        box.querySelector('#r_run').onclick = function () {
          var from = st.cps[st.name] || 0, n = st.files - from;
          for (var f = from + 1; f <= st.files; f++) st.rows.push(f);
          st.cps[st.name] = st.files;
          st.log = from === 0 && n > 0 && st.rows.length > n ? '⚠️ <span class="mono">' + st.name + '</span> has no checkpoint, so it started from the beginning and read <b>all ' + n + ' files again</b>. The target is append only: those rows are now there twice.' :
            n ? 'Read ' + n + ' new file(s) from the checkpoint onwards.' : 'Nothing new: the checkpoint says every file was read.';
          st.cls = from === 0 && st.rows.length > n ? 'bad' : 'good'; draw();
        };
        box.querySelector('#r_rs').onclick = function () { reset(); draw(); };
        reset(); draw();
      },
      function (el) {
        el.appendChild(h(title('Keep flow names <em>stable</em>') + '<div class="cols"><div>' + list(['The flow name maps to its checkpoint location.', 'A new name = a new, empty checkpoint = the source is read from the start.', '-In an append-only target that means duplicates.',
          '+Flows progress and fail independently: one slow or broken flow does not hold back the others.', '+If you really need a clean restart, do it on purpose: a full refresh of the table resets its flows and empties it.']) + '</div>' +
          '<div class="callout sk">A checkpoint is a bookmark. Renaming the book does not move the bookmark: the pipeline looks for a bookmark with the new name, finds none, and starts on page one.</div></div>'));
      },
      function (el, api) {
        ask(api, { id: 'rename', q: 'You rename <span class="mono">store_a_flow</span> to <span class="mono">store_a_orders</span> in an incremental pipeline and run an update. The target is an append-only streaming table. What happens?',
          options: ['Nothing: the pipeline knows it is the same query', 'The new flow starts with an empty checkpoint and re-reads the whole source, so the rows are appended a second time', 'The update fails until you full refresh', 'The old rows are replaced'],
          correct: 1, why: 'A flow is identified by its name, and so is its checkpoint. A renamed flow is a new flow: it processes all source data again.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 4 ── streaming table vs materialized view
  var STMV = [
    { lab: 'Start', note: 'The source table <span class="mono">orders_raw</span> has three rows. Nothing has run yet.', src: [[1, 'EU', 40], [2, 'US', 50], [3, 'EU', 10]] },
    { lab: 'Update 1', note: 'The streaming table reads all three rows (its checkpoint was empty). The materialized view computes the totals.', run: true, read: [1, 2, 3] },
    { lab: 'New rows', note: 'Two new orders arrive in the source.', add: [[4, 'US', 20], [5, 'EU', 30]] },
    { lab: 'Update 2', note: 'The streaming table reads <b>only rows 4 and 5</b>: rows 1–3 are behind the checkpoint. The view now shows the new totals, as if computed from scratch (it may refresh incrementally when it can).', run: true, read: [4, 5] },
    { lab: 'Correction', note: 'Someone fixes row 2 in the source: 50 → 500.', fix: [2, 500] },
    { lab: 'Update 3', note: 'The streaming table <b>keeps 50</b>: a stream reads appended rows, it does not revisit rows it already wrote (a changed source even fails the stream unless it uses <span class="mono">skipChangeCommits</span>). The view is <b>correct</b>: US = 520.', run: true, read: [] }
  ];
  SC.push({
    id: 'stmv', icon: '⚡', title: 'Streaming table vs materialized view', sub: 'What each one reads in an update, and what a correction does.',
    thumb: '<div class="th-row"><span class="a">ST: new rows</span><span class="b">MV: the answer</span></div>',
    steps: [
      function (el) {
        var box = h(title('Two targets, <em>one source</em>', 'Press next. The left table is a streaming table, the right one a materialized view.') +
          '<div class="cols"><div>' + sql('CREATE OR REFRESH STREAMING TABLE orders_st AS\nSELECT * FROM STREAM orders_raw;') + '</div><div>' + sql('CREATE OR REFRESH MATERIALIZED VIEW region_totals AS\nSELECT region, SUM(amount) AS total\nFROM orders_raw GROUP BY region;') + '</div></div>' +
          '<div class="row mt"><button class="btn acc" id="sm_n">Next →</button><span class="note" id="sm_l"></span></div><div class="verdict" id="sm_v"></div>' +
          '<div class="cmp mt" style="--n:3"><div><h4 class="h4">📥 orders_raw</h4><div id="sm_src"></div></div><div><h4 class="h4">🌊 orders_st</h4><div id="sm_st"></div></div><div><h4 class="h4">📊 region_totals</h4><div id="sm_mv"></div></div></div>');
        el.appendChild(box);
        var k, src, stRows, mv, last;
        function reset() { k = 0; src = STMV[0].src.map(function (r) { return r.slice(); }); stRows = []; mv = null; last = []; }
        function tb(cols, rows, hl) { return '<table class="dt2 mini"><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' + (rows.length ? rows.map(function (r) { return '<tr class="' + (hl(r) ? 'chg' : '') + '">' + r.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + cols.length + '" class="nul">empty</td></tr>') + '</table>'; }
        function draw() {
          var s = STMV[k];
          box.querySelector('#sm_l').textContent = (k + 1) + '. ' + s.lab;
          box.querySelector('#sm_v').innerHTML = s.note;
          box.querySelector('#sm_src').innerHTML = tb(['id', 'region', 'amount'], src, function (r) { return (s.add && r[0] >= 4) || (s.fix && r[0] === s.fix[0]); });
          box.querySelector('#sm_st').innerHTML = tb(['id', 'region', 'amount'], stRows, function (r) { return last.indexOf(r[0]) >= 0 || src.some(function (x) { return x[0] === r[0] && x[2] !== r[2]; }); }) + (s.run ? '<div class="small">read in this update: <b>' + last.length + '</b> row(s)</div>' : '');
          box.querySelector('#sm_mv').innerHTML = mv ? tb(['region', 'total'], mv, function () { return s.run; }) : tb(['region', 'total'], [], function () { });
          box.querySelector('#sm_n').textContent = k < STMV.length - 1 ? 'Next →' : '↺ Again';
        }
        box.querySelector('#sm_n').onclick = function () {
          if (k === STMV.length - 1) { reset(); draw(); return; }
          k++; var s = STMV[k]; last = [];
          if (s.add) s.add.forEach(function (r) { src.push(r.slice()); });
          if (s.fix) src.forEach(function (r) { if (r[0] === s.fix[0]) r[2] = s.fix[1]; });
          if (s.run) {
            s.read.forEach(function (id) { src.forEach(function (r) { if (r[0] === id) stRows.push(r.slice()); }); });
            last = s.read.slice();
            var t = {}; src.forEach(function (r) { t[r[1]] = (t[r[1]] || 0) + r[2]; });
            mv = Object.keys(t).sort().map(function (g) { return [g, t[g]]; });
          }
          draw();
        };
        reset(); draw();
      },
      function (el) {
        el.appendChild(h(title('Which target for which <em>job</em>?') + '<div class="cmp" style="--n:2"><div class="card sk"><h4>🌊 Streaming table</h4>' + list(['Each row is processed once; old rows are not revisited.', 'Fits append-only sources: files, Kafka, bronze → silver.', 'Has flows and checkpoints, so it can take several flows (multi-flow) and AUTO CDC.', '-A fix upstream does not reach rows already written (full refresh does).']) + '</div>' +
          '<div class="card sk alt"><h4>📊 Materialized view</h4>' + list(['Always equals its query over the current source.', 'Joins, aggregates, gold tables, sources that get updates and deletes.', 'Refreshed incrementally when possible, otherwise recomputed.', '+A correction upstream shows up after the next update.']) + '</div></div>'));
      },
      function (el, api) {
        ask(api, { id: 'stmv', q: 'A price in the silver table is corrected. Which gold dataset shows the corrected revenue after the next pipeline update, without a full refresh?',
          options: ['A streaming table that reads silver as a stream', 'A materialized view that aggregates silver', 'Both', 'Neither'],
          correct: 1, why: 'A materialized view always reflects its query over the current data. A streaming table only processes new rows; rows it already wrote stay as they were.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 5 ── multiplex
  var EVENTS = [
    ['order', { order_id: 101, amount: 42.5 }], ['click', { page: '/home', user_id: 7 }], ['payment', { order_id: 101, method: 'card' }],
    ['order', { order_id: 102, amount: 18.0 }], ['refund_v2', { order_id: 101, reason: 'late' }], ['click', { page: '/cart', user_id: 7 }],
    ['payment', { order_id: 102, method: 'paypal' }], ['refund_v2', { order_id: 102, reason: 'broken' }]
  ];
  var SILVER = {
    order: { t: 'orders_silver', cols: [['order_id', 'INT'], ['amount', 'DOUBLE']] },
    payment: { t: 'payments_silver', cols: [['order_id', 'INT'], ['method', 'STRING']] },
    click: { t: 'clicks_silver', cols: [['page', 'STRING'], ['user_id', 'INT']] },
    refund_v2: { t: 'refunds_silver', cols: [['order_id', 'INT'], ['reason', 'STRING']] }
  };
  SC.push({
    id: 'multiplex', icon: '🔀', title: 'Multiplex: ingest once, fan out', sub: 'One topic carries many event types. One bronze table, one silver table per type.',
    thumb: '<div class="th-col"><div class="th-row"><span class="a">o</span><span class="c">c</span><span class="b">p</span><span class="r">?</span></div><div class="th-row"><span class="d">bronze · VARIANT</span></div><div class="th-row"><span class="a">orders</span><span class="b">payments</span><span class="c">clicks</span></div></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('One stream, <em>many schemas</em>', 'Orders, payments and clicks share one Kafka topic (or one storage path). Each message has a type field.') +
          '<div class="cmp" style="--n:2"><div class="card sk"><h4>❌ one pipeline per type</h4>' + list(['N types → N pipelines reading the same topic.', 'N source scans, N checkpoints on the source.', '-A change in the source must be made N times.']) + '</div>' +
          '<div class="card sk alt"><h4>✅ multiplex</h4>' + list(['Ingest everything once into one bronze table.', 'Keep the payload as <span class="mono">VARIANT</span>: every schema fits.', '+Fan out: one silver table per type, filtered by the type field.']) + '</div></div>' +
          '<div class="cols mt"><div>' + sql("CREATE OR REFRESH STREAMING TABLE events_bronze AS\nSELECT\n  parse_json(CAST(value AS STRING)) AS payload,\n  payload:event_type::STRING      AS event_type\nFROM STREAM read_files('/Volumes/shop/raw/events');") + '</div><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_silver AS\nSELECT\n  payload:order_id::INT   AS order_id,\n  payload:amount::DOUBLE  AS amount\nFROM STREAM events_bronze\nWHERE event_type = 'order';") + '</div></div>'));
      },
      function (el) {
        var box = h(title('Watch the <em>fan-out</em>', 'Ingest the events one by one. Each silver table is a streaming table that reads bronze with its own WHERE.') +
          '<div class="ctrls"><button class="btn acc" id="x_n">▶ ingest next event</button><button class="btn" id="x_a">⏩ ingest all</button><button class="btn" id="x_add">➕ add refunds_silver</button><button class="btn" id="x_rs">↺ reset</button></div>' +
          '<div class="small">waiting in the topic:</div><div class="evq" id="x_q"></div>' +
          '<div class="cols mt"><div><h4 class="h4">🥉 events_bronze</h4><div id="x_b"></div></div><div><div class="ctrs" id="x_ctr"></div><div class="verdict" id="x_log"></div></div></div>' +
          '<h4 class="h4 mt">🥈 silver, one table per type</h4><div class="silvers" id="x_s"></div>');
        el.appendChild(box);
        var i, types, fresh, log;
        function reset() { i = 0; types = ['order', 'payment', 'click']; fresh = ''; log = 'Three silver tables exist: orders, payments, clicks. <span class="mono">refund_v2</span> is a new type nobody planned for.'; }
        function pj(o) { return '{' + Object.keys(o).map(function (k) { return '"' + k + '":' + (typeof o[k] === 'string' ? '"' + o[k] + '"' : o[k]); }).join(',') + '}'; }
        function draw() {
          box.querySelector('#x_q').innerHTML = EVENTS.slice(i).map(function (e) { return '<span class="ev ' + e[0] + '">' + e[0] + '</span>'; }).join('') || '<span class="small">empty: all ingested</span>';
          var got = EVENTS.slice(0, i);
          box.querySelector('#x_b').innerHTML = '<table class="dt2 mini"><tr><th>event_type</th><th>payload (VARIANT)</th></tr>' + (got.length ? got.map(function (e) { return '<tr class="' + (types.indexOf(e[0]) < 0 ? 'unk' : '') + '"><td>' + e[0] + '</td><td class="var">' + esc(pj(e[1])) + '</td></tr>'; }).join('') : '<tr><td colspan="2" class="nul">empty</td></tr>') + '</table>';
          box.querySelector('#x_s').innerHTML = types.map(function (t) {
            var m = SILVER[t], rows = got.filter(function (e) { return e[0] === t; });
            return '<div class="stbl' + (fresh === t ? ' new' : '') + '"><h6>' + m.t + '<small>WHERE event_type = \'' + t + '\'</small></h6><table class="dt2 mini"><tr>' + m.cols.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr>' +
              (rows.length ? rows.map(function (e) { return '<tr>' + m.cols.map(function (c) { return '<td>' + esc(e[1][c[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="2" class="nul">empty</td></tr>') + '</table><div class="hint">' + m.cols.map(function (c) { return 'payload:' + c[0] + '::' + c[1]; }).join(', ') + '</div></div>';
          }).join('');
          var unk = got.filter(function (e) { return types.indexOf(e[0]) < 0; }).length;
          box.querySelector('#x_ctr').innerHTML = ctr(1, 'scan of the topic per update (vs ' + types.length + ' with one pipeline per type)', 'good') + ctr(got.length, 'rows in bronze') + ctr(unk, 'rows only in bronze', unk ? 'warn' : '');
          box.querySelector('#x_log').innerHTML = log;
          box.querySelector('#x_add').disabled = types.indexOf('refund_v2') >= 0;
          fresh = '';
        }
        function one() {
          if (i >= EVENTS.length) return;
          var e = EVENTS[i++];
          log = types.indexOf(e[0]) >= 0 ? 'A <b>' + e[0] + '</b> event: kept in bronze and picked up by <span class="mono">' + SILVER[e[0]].t + '</span>.' :
            'A <b>' + e[0] + '</b> event: no silver table asks for it. It is <b>not lost</b>: it stays in bronze, with its full payload.';
        }
        box.querySelector('#x_n').onclick = function () { one(); draw(); };
        box.querySelector('#x_a').onclick = function () { while (i < EVENTS.length) one(); log = 'All events ingested with one read of the topic.'; draw(); };
        box.querySelector('#x_add').onclick = function () {
          types.push('refund_v2'); fresh = 'refund_v2';
          log = 'Adding a type = adding one streaming table. Its new flow starts with an empty checkpoint, so it <b>backfills every refund already in bronze</b>. Nothing else changes.'; draw();
        };
        box.querySelector('#x_rs').onclick = function () { reset(); draw(); };
        reset(); draw();
      },
      function (el, api) {
        ask(api, { id: 'multiplex', q: 'Your multiplex bronze table has been running for a month. A new event type, <span class="mono">refund_v2</span>, has been arriving for a week. What does a new <span class="mono">refunds_silver</span> streaming table contain after its first update?',
          options: ['Only refunds that arrive from now on', 'Every refund already in bronze, because its flow starts with an empty checkpoint', 'Nothing until the bronze table is fully refreshed', 'Refunds from the last 24 hours'],
          correct: 1, why: 'Bronze kept the unknown events with their VARIANT payload. A new streaming table reading bronze starts from the beginning of bronze, so it backfills the week of refunds.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 6 ── sinks
  var SINKS = {
    st: ['🌊 Streaming table', 'Owned by the pipeline: created, refreshed and dropped with it. Lineage, expectations, AUTO CDC. Readers query it in Unity Catalog.'],
    mv: ['📊 Materialized view', 'Owned by the pipeline. Always equals its query over the current data.'],
    delta: ['🔺 Delta table (sink)', 'A plain Delta table, by table name or path. The pipeline only appends to it. You own its table properties, for example UniForm for Iceberg readers.'],
    kafka: ['📨 Kafka (sink)', 'Write events back to a Kafka topic: reverse ETL and low-latency operational use.'],
    eh: ['☁️ Azure Event Hubs (sink)', 'Uses the Kafka interface. Real-time events for other systems.'],
    custom: ['🐍 Custom Python sink', 'Any store you can write to with a PySpark custom data source.']
  };
  var PROPS = [['dv', "'delta.enableDeletionVectors' = 'false'", 'Iceberg v2 cannot read deletion vectors.'], ['cm', "'delta.columnMapping.mode' = 'name'", 'stable column ids for both formats'],
    ['ic', "'delta.enableIcebergCompatV2' = 'true'", 'write Iceberg-compatible files'], ['uf', "'delta.universalFormat.enabledFormats' = 'iceberg'", 'generate Iceberg metadata after each commit']];
  SC.push({
    id: 'sinks', icon: '🚪', title: 'Sinks: writing outside the pipeline', sub: 'A plain Delta table the pipeline appends to, and Iceberg readers on top.',
    thumb: '<div class="th-row"><span class="c">pipeline</span><i>→</i><span class="a">sink</span><i>→</i><span class="d">❄️ Iceberg</span></div>',
    steps: [
      function (el) {
        var box = h(title('Inside the pipeline, or <em>outside</em> it?', 'Click a target.') +
          '<div class="scope"><div class="scopebox"><h5>🏠 Managed by the pipeline</h5><button class="sbtn" data-k="st">' + SINKS.st[0] + '</button><button class="sbtn" data-k="mv">' + SINKS.mv[0] + '</button><div class="small">created, updated and dropped by the pipeline</div></div>' +
          '<div class="scopebox out"><h5>🚪 Sinks: outside its scope</h5><button class="sbtn on" data-k="delta">' + SINKS.delta[0] + '</button><button class="sbtn" data-k="kafka">' + SINKS.kafka[0] + '</button><button class="sbtn" data-k="eh">' + SINKS.eh[0] + '</button><button class="sbtn" data-k="custom">' + SINKS.custom[0] + '</button><div class="small">only append flows write here</div></div></div>' +
          '<div class="verdict" id="sk_n"></div>');
        el.appendChild(box);
        function show(k) { box.querySelectorAll('.sbtn').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); }); box.querySelector('#sk_n').innerHTML = '<b>' + SINKS[k][0] + '</b>: ' + SINKS[k][1]; }
        box.querySelectorAll('.sbtn').forEach(function (b) { b.onclick = function () { show(b.dataset.k); }; });
        show('delta');
      },
      function (el) {
        el.appendChild(h(title('A sink is <em>two</em> definitions', 'Register the destination, then point an append flow at it. Python only: there is no SQL syntax for sinks.') +
          '<div class="cols"><div>' + py('from pyspark import pipelines as dp\n\n# 1. register the destination\ndp.create_sink(\n    name="logistics_sink",\n    format="delta",\n    options={"tableName": "shop.gold.logistics_sink"}\n)\n\n# 2. an append flow writes into it\n@dp.append_flow(name="logistics_sink_flow", target="logistics_sink")\ndef logistics_sink_flow():\n    return spark.readStream.table("logistics_silver")') + '</div>' +
          '<div><table class="tbl"><tr><th></th><th>Managed table</th><th>Sink</th></tr><tr><td>Defined in</td><td>SQL or Python</td><td>Python only</td></tr><tr><td>Written by</td><td>any flow</td><td>append flows only</td></tr><tr><td>Expectations</td><td>yes</td><td>no</td></tr><tr><td>Table properties</td><td>set by the pipeline</td><td>yours</td></tr></table>' +
          '<div class="callout sk thin">The flow keeps a checkpoint, so each update appends only the new silver rows.</div></div></div>'));
      },
      function (el) {
        var box = h(title('Make the sink readable as <em>Iceberg</em>', 'Snowflake and Trino read Iceberg, not Delta. UniForm writes Iceberg metadata next to the Delta log, for the same Parquet files. Pick the table, switch on the properties.') +
          '<div class="tabs" id="u_t"><button data-t="sink" class="on">🔺 the sink table (plain Delta)</button><button data-t="st">🌊 a pipeline streaming table</button></div>' +
          '<div class="cols"><div><div class="props" id="u_p"></div><div id="u_sql" class="mt"></div></div><div><div class="cpdir" id="u_f"></div><div class="verdict" id="u_v"></div></div></div>');
        el.appendChild(box);
        var on = {}, t = 'sink';
        function draw() {
          box.querySelector('#u_p').innerHTML = PROPS.map(function (p) { return '<label class="toggle sw2' + (on[p[0]] ? ' on' : '') + '"><input type="checkbox" data-p="' + p[0] + '"' + (on[p[0]] ? ' checked' : '') + '><span class="sw"></span><code>' + p[1] + '</code> <small>' + p[2] + '</small></label>'; }).join('');
          box.querySelectorAll('#u_p input').forEach(function (c) { c.onchange = function () { on[c.dataset.p] = c.checked; draw(); }; });
          var set = PROPS.filter(function (p) { return on[p[0]]; });
          box.querySelector('#u_sql').innerHTML = sql('CREATE TABLE shop.gold.logistics_sink (...)\nTBLPROPERTIES (' + (set.length ? '\n  ' + set.map(function (p) { return p[1]; }).join(',\n  ') + '\n' : '') + ');\n-- set before the first write');
          var all = set.length === 4, ok = all && t === 'sink';
          box.querySelector('#u_f').innerHTML = '<span class="d">logistics_' + (t === 'sink' ? 'sink' : 'st') + '/</span><br>&nbsp;&nbsp;📄 part-0000…parquet ×12<br>&nbsp;&nbsp;📁 _delta_log/ <span class="small">← Databricks reads this</span><br>' + (ok ? '&nbsp;&nbsp;<span class="cur">📁 metadata/ v1.metadata.json …</span> <span class="small">← Iceberg readers</span><br>' : '');
          var v = box.querySelector('#u_v');
          if (t === 'st') { v.className = 'verdict bad'; v.innerHTML = '❌ Not on a pipeline-managed streaming table: its properties belong to the pipeline, so Iceberg v2 reads cannot be switched on this way. That is why the course writes to a <b>Delta sink</b>. (Newer runtimes can expose pipeline datasets to Iceberg v3 clients directly.)'; }
          else if (ok) { v.className = 'verdict good'; v.innerHTML = '✅ Snowflake, Trino and Athena read <span class="mono">shop.gold.logistics_sink</span> through the Unity Catalog Iceberg REST catalog. One copy of the data, two kinds of metadata. Iceberg clients read; all writes still go through Delta.'; }
          else { v.className = 'verdict warn'; v.innerHTML = 'Still missing: ' + PROPS.filter(function (p) { return !on[p[0]]; }).map(function (p) { return '<span class="mono">' + p[1].split("'")[1] + '</span>'; }).join(', '); }
        }
        box.querySelectorAll('#u_t button').forEach(function (b) { b.onclick = function () { t = b.dataset.t; box.querySelectorAll('#u_t button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
      },
      function (el, api) {
        ask(api, { id: 'sinks', q: 'Which statement about a Delta sink in a declarative pipeline is true?',
          options: ['It is defined with CREATE SINK in SQL', 'It can enforce expectations like a streaming table', 'It is defined in Python with dp.create_sink and written by an append flow', 'The pipeline drops it when the pipeline is deleted'],
          correct: 2, why: 'Sinks are Python only: dp.create_sink registers the destination and @dp.append_flow writes to it. Sinks take no expectations, and the table lives outside the pipeline\'s managed scope.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 7 ── expectations on a multi-flow target
  var RULES = [['valid_qty', 'qty >= 0', 'DROP ROW', function (r) { return r.qty >= 0; }], ['reasonable_qty', 'qty <= 1000', 'WARN', function (r) { return r.qty <= 1000; }], ['not_null_ts', 'order_timestamp IS NOT NULL', 'FAIL UPDATE', function (r) { return r.ts !== null; }]];
  function qrows() { return { A: [{ id: 'A1', qty: 2, ts: '10:01' }, { id: 'A2', qty: -1, ts: '10:02' }, { id: 'A3', qty: 1500, ts: '10:03' }, { id: 'A4', qty: 5, ts: '10:05' }], B: [{ id: 'B1', qty: 3, ts: '10:01' }, { id: 'B2', qty: 4, ts: null }, { id: 'B3', qty: 1, ts: '10:04' }] }; }
  SC.push({
    id: 'expect', icon: '🚦', title: 'Expectations on a multi-flow target', sub: 'Rules live on the table. Every flow that writes into it is checked.',
    thumb: '<div class="th-row"><span class="c">WARN</span><span class="d">DROP</span><span class="r">FAIL</span></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('Rules belong to the <em>target table</em>', 'Not to a flow. You cannot put a CONSTRAINT on CREATE FLOW or @dp.append_flow.') + '<div class="cols"><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_bronze (\n  CONSTRAINT valid_qty   EXPECT (qty >= 0) ON VIOLATION DROP ROW,\n  CONSTRAINT reasonable_qty EXPECT (qty <= 1000),           -- WARN\n  CONSTRAINT not_null_ts EXPECT (order_timestamp IS NOT NULL)\n    ON VIOLATION FAIL UPDATE\n);") +
          '</div><div class="cmp" style="--n:1"><div class="card sk"><h4>🟢 WARN (no ON VIOLATION)</h4>keep the row, count it</div><div class="card sk alt"><h4>🟡 DROP ROW</h4>remove the row, count it</div><div class="card sk"><h4>🔴 FAIL UPDATE</h4>stop the flow; the batch is not written</div></div></div>'));
      },
      function (el) {
        var box = h(title('Send rows from <em>two flows</em>', 'Store A and store B write into the same table. Send rows one at a time.') +
          '<div class="ctrls"><button class="btn acc" id="e_a">▶ next row from store_a_flow</button><button class="btn acc" id="e_b">▶ next row from store_b_flow</button><button class="btn" id="e_fix" style="display:none">🔧 fix the source, retry B</button><button class="btn" id="e_rs">↺ reset</button></div>' +
          '<div class="cols"><div><div class="ctrs" id="e_ctr"></div><div class="verdict" id="e_log"></div><table class="dt2 mini mt" id="e_m"></table></div><div><h4 class="h4">🌊 orders_bronze</h4><div id="e_t"></div></div></div>');
        el.appendChild(box);
        var st;
        function reset() { st = { q: qrows(), rows: [], fail: { A: false, B: false }, m: [0, 0, 0], drop: 0, warn: 0, log: 'Both flows are running.', cls: '' }; }
        function draw() {
          box.querySelector('#e_ctr').innerHTML = ctr(st.rows.length, 'rows written', 'good') + ctr(st.warn, 'kept with a warning', st.warn ? 'warn' : '') + ctr(st.drop, 'dropped', st.drop ? 'bad' : '') + ctr(st.fail.B ? '❌' : '✅', 'store_b_flow', st.fail.B ? 'bad' : '');
          var lg = box.querySelector('#e_log'); lg.className = 'verdict ' + st.cls; lg.innerHTML = st.log;
          box.querySelector('#e_m').innerHTML = '<tr><th>expectation</th><th>action</th><th>failed rows</th></tr>' + RULES.map(function (r, i) { return '<tr><td>' + r[0] + '</td><td>' + r[2] + '</td><td>' + st.m[i] + '</td></tr>'; }).join('');
          box.querySelector('#e_t').innerHTML = '<table class="dt2 mini"><tr><th>id</th><th>qty</th><th>order_timestamp</th><th>flow</th></tr>' + (st.rows.length ? st.rows.map(function (r) { return '<tr class="' + (r.w ? 'warnr' : '') + '"><td>' + r.id + '</td><td>' + r.qty + '</td><td>' + nul(r.ts) + '</td><td>' + (r.id[0] === 'A' ? 'store_a' : 'store_b') + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="nul">empty</td></tr>') + '</table>';
          box.querySelector('#e_a').disabled = !st.q.A.length; box.querySelector('#e_b').disabled = !st.q.B.length || st.fail.B;
          box.querySelector('#e_fix').style.display = st.fail.B ? '' : 'none';
        }
        function send(f) {
          var r = st.q[f][0], res = RULES.map(function (x) { return x[3](r); }), chips = RULES.map(function (x, i) { return '<span class="rc ' + (res[i] ? 'ok' : 'no') + '">' + x[0] + '</span>'; }).join(' ');
          res.forEach(function (ok, i) { if (!ok) st.m[i]++; });
          if (!res[2]) { st.fail[f] = true; st.log = chips + '<br>🔴 <b>' + r.id + '</b> has no timestamp: <b>FAIL UPDATE</b>. store_' + f.toLowerCase() + '_flow stops and its batch is not written. store_a_flow keeps running.'; st.cls = 'bad'; draw(); return; }
          st.q[f].shift();
          if (!res[0]) { st.drop++; st.log = chips + '<br>🟡 <b>' + r.id + '</b> has qty ' + r.qty + ': <b>dropped</b>, and counted.'; st.cls = 'warn'; }
          else { var w = !res[1]; if (w) st.warn++; st.rows.push({ id: r.id, qty: r.qty, ts: r.ts, w: w }); st.log = chips + '<br>' + (w ? '🟢 <b>' + r.id + '</b> breaks a WARN rule (qty ' + r.qty + '): <b>written anyway</b>, and counted.' : '✅ <b>' + r.id + '</b> passes every rule.'); st.cls = w ? 'warn' : 'good'; }
          draw();
        }
        box.querySelector('#e_a').onclick = function () { send('A'); };
        box.querySelector('#e_b').onclick = function () { send('B'); };
        box.querySelector('#e_fix').onclick = function () { st.q.B[0].ts = '10:02'; st.fail.B = false; st.log = 'The source file was fixed. store_b_flow retries from its checkpoint.'; st.cls = ''; draw(); };
        box.querySelector('#e_rs').onclick = function () { reset(); draw(); };
        reset(); draw();
      },
      function (el) {
        el.appendChild(h(title('Where the numbers go', 'Every expectation reports per update: rows that passed and failed. The Pipelines UI shows them; the event log stores them.') +
          sql("SELECT timestamp, details:flow_progress.data_quality.expectations\nFROM event_log(TABLE(orders_bronze))\nWHERE event_type = 'flow_progress'\nORDER BY timestamp DESC;") +
          '<div class="callout sk thin">The event log has one row per flow update, so you see which <b>flow</b> (which store) brought the bad rows, even though the rules are defined once on the table.</div>'));
      },
      function (el, api) {
        ask(api, { id: 'expect', q: 'A row from store B violates an expectation with <span class="mono">ON VIOLATION FAIL UPDATE</span>. In a triggered pipeline, what happens to store A\'s flow into the same table?',
          options: ['It fails too, because the rule is on the shared table', 'It keeps running: the failure stops store B\'s flow', 'It is rolled back to the previous update', 'It switches to WARN'],
          correct: 1, why: 'Flows progress and fail independently. The rule is evaluated on the target, but the update that fails is the flow that brought the bad row.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 8 ── NULL-tolerant rules and schema drift
  var DFILES = [
    [{ id: 'o1', qty: 2 }, { id: 'o2', qty: 1 }],
    [{ id: 'o3', qty: 4 }],
    [{ id: 'o4', qty: 1, d: 10 }, { id: 'o5', qty: 3, d: 120 }, { id: 'o6', qty: 2 }, { id: 'o7', qty: 5, d: 25 }]
  ];
  SC.push({
    id: 'nulls', icon: '🕳️', title: 'NULL-tolerant rules and schema drift', sub: 'A new column appears mid-stream. Old rows are NULL in it. Does your rule flag them all?',
    thumb: '<div class="th-row"><span>NULL</span><span>NULL</span><span class="c">10</span><span class="r">120</span></div>',
    steps: [
      function (el) {
        var box = h(title('<em>discount_rate</em> arrives in file 3', 'Read the files one by one. Then switch the schema hint and the rule.') +
          '<div class="ctrls"><button class="btn acc" id="n_n">📥 read next file</button><button class="btn" id="n_rs">↺ reset</button>' +
          '<label class="toggle"><input type="checkbox" id="n_h"><span class="sw"></span> <span class="mono">schemaHints =&gt; \'discount_rate DOUBLE\'</span></label></div>' +
          '<div class="tabs" id="n_r"><button data-r="naive" class="on">naive rule</button><button data-r="tol">NULL-tolerant rule</button></div>' +
          '<div class="cols"><div id="n_t"></div><div><div id="n_sql"></div><div class="ctrs mt" id="n_ctr"></div><div class="verdict" id="n_v"></div></div></div>');
        el.appendChild(box);
        var k, hint = false, rule = 'naive';
        function rows() { var o = []; DFILES.slice(0, k).forEach(function (f, i) { f.forEach(function (r) { o.push({ r: r, file: i + 1 }); }); }); return o; }
        function draw() {
          var R = rows(), viol = 0, nulv = 0;
          var body = R.map(function (x) {
            var r = x.r, d = r.d === undefined ? null : r.d, res;
            if (hint) {
              if (rule === 'naive') res = d === null ? 'nul' : (d >= 0 && d <= 100 ? 'ok' : 'no');
              else res = d === null ? 'ok' : (d >= 0 && d <= 100 ? 'ok' : 'no');
              if (res !== 'ok') viol++; if (res === 'nul') nulv++;
            }
            var resc = !hint && d !== null ? '{"discount_rate":"' + d + '"}' : null;
            return '<tr><td>' + x.file + '</td><td>' + r.id + '</td><td>' + r.qty + '</td>' + (hint ? '<td>' + nul(d) + '</td>' : '') + '<td class="var">' + nul(resc) + '</td>' +
              (hint ? '<td><span class="rc ' + res + '">' + (res === 'ok' ? 'pass' : res === 'nul' ? 'NULL → violation' : 'violation') + '</span></td>' : '') + '</tr>';
          }).join('');
          box.querySelector('#n_t').innerHTML = '<table class="dt2 mini"><tr><th>file</th><th>order_id</th><th>qty</th>' + (hint ? '<th>discount_rate</th>' : '') + '<th>_rescued_data</th>' + (hint ? '<th>valid_discount</th>' : '') + '</tr>' + (body || '<tr><td colspan="6" class="nul">no files read yet</td></tr>') + '</table>';
          box.querySelector('#n_sql').innerHTML = sql(rule === 'naive' ? 'CONSTRAINT valid_discount EXPECT (\n  discount_rate >= 0 AND discount_rate <= 100\n)' : 'CONSTRAINT valid_discount EXPECT (\n  CASE WHEN discount_rate IS NOT NULL\n       THEN discount_rate >= 0 AND discount_rate <= 100\n       ELSE TRUE\n  END\n)');
          box.querySelector('#n_ctr').innerHTML = hint ? ctr(viol, 'violations reported', viol > 1 ? 'bad' : viol ? 'warn' : 'good') + ctr(nulv, 'of them only NULL', nulv ? 'bad' : '') : ctr('–', 'no discount_rate column');
          var v = box.querySelector('#n_v');
          if (!hint) { v.className = 'verdict warn'; v.innerHTML = k < 3 ? 'Files 1 and 2 have no discount field. Read file 3.' : 'Bronze reads with <span class="mono">schemaEvolutionMode =&gt; \'rescue\'</span>: the unexpected field is not lost, it lands as JSON in <span class="mono">_rescued_data</span>. No column exists to check yet. Switch on the schema hint.'; }
          else if (rule === 'naive') { v.className = 'verdict bad'; v.innerHTML = 'With the hint, <span class="mono">discount_rate</span> is a real column from the start: <b>NULL</b> for every row that predates it. <span class="mono">NULL &gt;= 0</span> is NULL, not TRUE, so the naive rule reports those rows as violations. Only o5 (120) is really wrong.'; }
          else { v.className = 'verdict good'; v.innerHTML = 'The CASE WHEN rule checks the value only when it is there. NULL passes; only <b>o5 = 120</b> is reported. Clean metrics again.'; }
          box.querySelector('#n_n').disabled = k >= DFILES.length;
        }
        box.querySelector('#n_n').onclick = function () { k++; draw(); };
        box.querySelector('#n_rs').onclick = function () { k = 0; draw(); };
        box.querySelector('#n_h').onchange = function (e) { hint = e.target.checked; draw(); };
        box.querySelectorAll('#n_r button').forEach(function (b) { b.onclick = function () { rule = b.dataset.r; box.querySelectorAll('#n_r button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        k = 0; draw();
      },
      function (el) {
        el.appendChild(h(title('A bronze layer that never <em>rejects</em>', 'Accept everything in bronze, enforce types in silver.') + '<div class="cols"><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_bronze AS\nSELECT * FROM STREAM read_files(\n  '/Volumes/shop/raw/orders',\n  format => 'json',\n  schemaHints => 'discount_rate DOUBLE'\n);") + '</div><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE orders_silver (\n  CONSTRAINT valid_amount EXPECT (\n    CASE WHEN amount IS NOT NULL THEN amount >= 0\n         ELSE TRUE END\n  ) ON VIOLATION DROP ROW\n) AS\nSELECT *, TRY_CAST(amount_str AS DOUBLE) AS amount\nFROM STREAM orders_bronze;") + '</div></div>' +
          list(['<span class="mono">schemaHints</span>: declare a column you know is coming; old rows get NULL.', '<span class="mono">_rescued_data</span>: anything outside the schema, kept as JSON, queryable later.', '<span class="mono">TRY_CAST</span>: a bad value becomes NULL instead of failing the update, and the NULL-tolerant rule decides what to do.'])));
      },
      function (el, api) {
        ask(api, { id: 'nulls', q: 'After a new optional column <span class="mono">loyalty_tier</span> appears, the Pipelines UI reports thousands of violations of <span class="mono">EXPECT (loyalty_tier IN (\'gold\',\'silver\'))</span>, all on old rows. Best fix?',
          options: ['Change the action to DROP ROW', 'Make the rule NULL-tolerant: CASE WHEN loyalty_tier IS NOT NULL THEN loyalty_tier IN (…) ELSE TRUE END', 'Full refresh the table', 'Remove the rule'],
          correct: 1, why: 'Old rows have NULL in the new column. A NULL result is not TRUE, so it counts as a violation. Check the value only when it is present.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 9 ── quarantine
  var TRIPS = [
    { id: 't1', d: 2.5, f: 12, p: 1 }, { id: 't2', d: 0, f: 8, p: 1 }, { id: 't3', d: 4, f: -3, p: 2 }, { id: 't4', d: 1.2, f: 6, p: 12 },
    { id: 't5', d: 3, f: 15, p: null }, { id: 't6', d: 5, f: 20, p: 3 }, { id: 't7', d: null, f: 0, p: 0 }, { id: 't8', d: 7, f: 30, p: 2 }
  ];
  // SQL three-valued logic: true / false / null
  function cmp3(v, fn) { return v === null ? null : fn(v); }
  function and3(a) { if (a.indexOf(false) >= 0) return false; if (a.indexOf(null) >= 0) return null; return true; }
  function not3(v) { return v === null ? null : !v; }
  SC.push({
    id: 'quarantine', icon: '🗃️', title: 'Quarantine with inverse logic', sub: 'Keep every row. Flag the bad ones. Split them with two views.',
    thumb: '<div class="th-row"><span class="c">clean</span><span class="d">quarantine</span></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('DROP ROW forgets. <em>Quarantine</em> remembers.') + '<div class="cols"><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE trips_quarantine (\n  CONSTRAINT valid_distance EXPECT (trip_distance > 0),\n  CONSTRAINT valid_fare     EXPECT (fare_amount >= 0),\n  CONSTRAINT valid_pax      EXPECT (passenger_count BETWEEN 1 AND 9)\n  -- WARN only: metrics, no row is removed\n)\nPARTITIONED BY (is_quarantined)\nAS SELECT *,\n  NOT (trip_distance > 0\n       AND fare_amount >= 0\n       AND passenger_count BETWEEN 1 AND 9) AS is_quarantined\nFROM STREAM trips_bronze;") + '</div><div>' +
          sql("CREATE OR REFRESH MATERIALIZED VIEW valid_trips AS\nSELECT * FROM trips_quarantine WHERE is_quarantined = FALSE;\n\nCREATE OR REFRESH MATERIALIZED VIEW invalid_trips AS\nSELECT * FROM trips_quarantine WHERE is_quarantined = TRUE;") +
          '<div class="callout sk thin">The rules must stay <b>WARN</b>. With DROP ROW or FAIL UPDATE, bad rows would be gone before the flag is computed. WARN is there only for the per-rule numbers in the UI; the flag does the routing.</div></div></div>'));
      },
      function (el) {
        var box = h(title('Route the trips, <em>check the sum</em>', 'Promise of the pattern: rows in = clean + quarantined. Route all eight, then look at t5.') +
          '<div class="ctrls"><button class="btn acc" id="q_n">▶ route next trip</button><button class="btn" id="q_a">⏩ route all</button><button class="btn" id="q_rs">↺ reset</button>' +
          '<label class="toggle"><input type="checkbox" id="q_s"><span class="sw"></span> NULL-safe flag: <span class="mono">NOT COALESCE(rules, FALSE)</span></label></div>' +
          '<div class="cols"><div id="q_t"></div><div><div class="ctrs" id="q_ctr"></div><div class="verdict" id="q_v"></div></div></div><div class="bins3 mt" id="q_b"></div>');
        el.appendChild(box);
        var k = 0, safe = false;
        function ev(t) {
          var r = [cmp3(t.d, function (v) { return v > 0; }), cmp3(t.f, function (v) { return v >= 0; }), cmp3(t.p, function (v) { return v >= 1 && v <= 9; })];
          var all = and3(r), flag = safe ? !(all === true) : not3(all);
          return { r: r, flag: flag };
        }
        function c3(v) { return v === true ? '<span class="rc ok">✓</span>' : v === false ? '<span class="rc no">✗</span>' : '<span class="rc nul">NULL</span>'; }
        function fl(v) { return v === true ? '<b style="color:var(--accent)">TRUE</b>' : v === false ? '<b style="color:var(--green)">FALSE</b>' : '<b style="color:var(--red)">NULL</b>'; }
        function draw() {
          var done = TRIPS.slice(0, k), E = done.map(ev), clean = [], quar = [], lost = [], m = [0, 0, 0];
          done.forEach(function (t, i) { var e = E[i]; e.r.forEach(function (x, j) { if (x !== true) m[j]++; }); (e.flag === true ? quar : e.flag === false ? clean : lost).push(t.id); });
          box.querySelector('#q_t').innerHTML = '<table class="dt2 mini"><tr><th>trip</th><th>distance</th><th>fare</th><th>pax</th><th>rules</th><th>is_quarantined</th></tr>' + TRIPS.map(function (t, i) {
            var e = i < k ? E[i] : null;
            return '<tr class="' + (i === k - 1 ? 'cur' : '') + '"' + (i >= k ? ' style="opacity:.4"' : '') + '><td>' + t.id + '</td><td>' + nul(t.d) + '</td><td>' + nul(t.f) + '</td><td>' + nul(t.p) + '</td><td>' + (e ? e.r.map(c3).join('') : '') + '</td><td>' + (e ? fl(e.flag) : '') + '</td></tr>';
          }).join('') + '</table><div class="hint">WARN metrics: valid_distance ' + m[0] + ' · valid_fare ' + m[1] + ' · valid_pax ' + m[2] + ' failing (a NULL result counts as failing)</div>';
          var tot = clean.length + quar.length;
          box.querySelector('#q_ctr').innerHTML = ctr(k, 'rows in') + ctr(clean.length, 'valid_trips', 'good') + ctr(quar.length, 'invalid_trips', 'warn') + ctr(tot === k ? '✓' : '✗', k + ' = ' + clean.length + ' + ' + quar.length + (tot === k ? '' : ' ?'), tot === k ? 'good' : 'bad');
          var v = box.querySelector('#q_v');
          if (lost.length) { v.className = 'verdict bad'; v.innerHTML = '🕳️ <b>' + lost.join(', ') + '</b>: passenger_count is NULL, so <span class="mono">BETWEEN</span> is NULL, the AND is NULL, and <span class="mono">NOT(NULL)</span> is NULL. <span class="mono">= TRUE</span> and <span class="mono">= FALSE</span> both miss it: the row is in <b>neither</b> view. Switch on the NULL-safe flag.'; }
          else if (k && safe) { v.className = 'verdict good'; v.innerHTML = '<span class="mono">COALESCE(rules, FALSE)</span> turns "unknown" into "not valid", so every row lands in exactly one view. Zero data loss.'; }
          else { v.className = 'verdict'; v.innerHTML = k ? 'So far every row has a TRUE or FALSE flag.' : 'Route the first trip.'; }
          box.querySelector('#q_b').innerHTML = '<div class="bin3 clean"><h6>✅ valid_trips<small>WHERE is_quarantined = FALSE</small></h6>' + clean.map(function (x) { return '<span class="ev click">' + x + '</span>'; }).join('') + '</div>' +
            '<div class="bin3 quar"><h6>🗃️ invalid_trips<small>WHERE is_quarantined = TRUE</small></h6>' + quar.map(function (x) { return '<span class="ev order">' + x + '</span>'; }).join('') + '</div>' +
            '<div class="bin3 lost"><h6>🕳️ in neither view<small>is_quarantined IS NULL</small></h6>' + lost.map(function (x) { return '<span class="ev refund_v2">' + x + '</span>'; }).join('') + '</div>';
          box.querySelector('#q_n').disabled = k >= TRIPS.length;
        }
        box.querySelector('#q_n').onclick = function () { k++; draw(); };
        box.querySelector('#q_a').onclick = function () { k = TRIPS.length; draw(); };
        box.querySelector('#q_rs').onclick = function () { k = 0; draw(); };
        box.querySelector('#q_s').onchange = function (e) { safe = e.target.checked; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('DROP ROW or <em>quarantine</em>?') + '<table class="tbl"><tr><th></th><th>🟡 DROP ROW</th><th>🗃️ Quarantine</th></tr>' +
          '<tr><td>Invalid rows</td><td>gone</td><td>kept in the quarantine table</td></tr><tr><td>Audit trail</td><td>only counts</td><td>every row, queryable</td></tr>' +
          '<tr><td>Recovery</td><td>not possible</td><td>fix the rule, re-route</td></tr><tr><td>Cost</td><td>one table</td><td>one table + two views</td></tr>' +
          '<tr><td>Best for</td><td>non-critical streams, settled rules</td><td>compliance, audit, remediation</td></tr></table>' +
          '<div class="callout sk thin">Partitioning by <span class="mono">is_quarantined</span> lets each view read only its own partition.</div>'));
      },
      function (el, api) {
        ask(api, { id: 'quarantine', q: 'In the quarantine table the rules use <span class="mono">ON VIOLATION DROP ROW</span> instead of WARN. What breaks?',
          options: ['Nothing, the flag still routes the rows', 'Invalid rows are removed before the flag is computed, so invalid_trips stays empty and the data is lost', 'The pipeline fails to start', 'The metrics disappear from the UI'],
          correct: 1, why: 'Expectations run on the rows the table writes. DROP ROW removes them first, so the inverse-logic flag never sees them. The pattern needs WARN.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 10 ── AUTO CDC: SCD 1 vs SCD 2
  var CDC0 = [[1, 'Peter', '1 Blue Rd.', 501], [2, 'Samarth', '22 Front St', 501]];
  var CDCEV = [
    { op: 'UPDATE', id: 1, name: 'Peter', addr: '123 Main St.', seq: 520 },
    { op: 'INSERT', id: 3, name: 'Kostas', addr: '7 Lake Dr.', seq: 518 },
    { op: 'UPDATE', id: 1, name: 'Peter', addr: '45 Oak Ave.', seq: 515 },
    { op: 'DELETE', id: 2, name: 'Samarth', addr: null, seq: 522 }
  ];
  function dt(s) { return s === null ? null : Math.floor(s / 100) + '/' + (s % 100); }
  SC.push({
    id: 'cdc', icon: '🕰️', title: 'AUTO CDC: SCD 1 vs SCD 2', sub: 'The same change feed, out of order, into two tables.',
    thumb: '<div class="th-col"><div class="th-row"><span class="a">SCD 1</span><span>now</span></div><div class="th-row"><span class="b">SCD 2</span><span>history</span></div></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('One flow turns a <em>change feed</em> into a table') + '<div class="cols"><div>' +
          sql("CREATE OR REFRESH STREAMING TABLE customers;\n\nCREATE FLOW customers_cdc_flow AS\nAUTO CDC INTO customers\nFROM STREAM customers_changes\nKEYS (customer_id)\nAPPLY AS DELETE WHEN operation = 'DELETE'\nSEQUENCE BY process_date\nCOLUMNS * EXCEPT (operation)\nSTORED AS SCD TYPE 2;   -- default: SCD TYPE 1") + '</div><div>' +
          list(['<span class="mono">KEYS</span>: which row a change belongs to.', '<span class="mono">SEQUENCE BY</span>: the order of changes, whatever order they arrive in.', '<span class="mono">APPLY AS DELETE WHEN</span>: which events delete.', '<b>SCD 1</b>: keep only the latest version.', '<b>SCD 2</b>: keep every version with <span class="mono">__START_AT</span> / <span class="mono">__END_AT</span>.', '+Formerly APPLY CHANGES INTO; same idea.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('Apply the feed, <em>one event at a time</em>', 'The events arrive in this order. Peter\'s 5/15 change comes after his 5/20 change.') +
          '<div class="ctrls"><button class="btn acc" id="c_n">▶ apply next event</button><button class="btn" id="c_rs">↺ reset</button></div><div class="cdcq" id="c_q"></div><div class="verdict" id="c_v"></div>' +
          '<div class="cols mt"><div><h4 class="h4">SCD TYPE 1 · current state</h4><div id="c_1"></div></div><div><h4 class="h4">SCD TYPE 2 · history</h4><div id="c_2"></div></div></div>');
        el.appendChild(box);
        var k, s1, s2, chg1, chg2;
        function reset() { k = 0; s1 = CDC0.map(function (r) { return { id: r[0], name: r[1], addr: r[2], seq: r[3] }; }); s2 = CDC0.map(function (r) { return { id: r[0], name: r[1], addr: r[2], st: r[3], en: null }; }); chg1 = []; chg2 = []; }
        function apply(e) {
          var msg1, msg2, cur = s1.filter(function (r) { return r.id === e.id; })[0];
          chg1 = []; chg2 = [];
          if (cur && cur.seq > e.seq) msg1 = 'SCD 1 ignores it: the row already holds a newer change (' + dt(cur.seq) + ').';
          else if (e.op === 'DELETE') { s1 = s1.filter(function (r) { return r.id !== e.id; }); msg1 = 'SCD 1 removes the row.'; }
          else if (cur) { cur.addr = e.addr; cur.seq = e.seq; chg1 = [e.id]; msg1 = 'SCD 1 overwrites the row.'; }
          else { s1.push({ id: e.id, name: e.name, addr: e.addr, seq: e.seq }); chg1 = [e.id]; msg1 = 'SCD 1 inserts the row.'; }
          var vs = s2.filter(function (r) { return r.id === e.id && r.st <= e.seq && (r.en === null || r.en > e.seq); })[0];
          if (e.op === 'DELETE') { if (vs) { vs.en = e.seq; chg2 = [vs]; } msg2 = 'SCD 2 closes the active version: <span class="mono">__END_AT</span> = ' + dt(e.seq) + '. Nothing is deleted.'; }
          else {
            var nv = { id: e.id, name: e.name, addr: e.addr, st: e.seq, en: vs ? vs.en : null };
            if (vs) vs.en = e.seq;
            s2.push(nv); chg2 = vs ? [vs, nv] : [nv];
            msg2 = !vs ? 'SCD 2 adds a first version.' : nv.en !== null ? 'SCD 2 slots the late change <b>between</b> two versions: 1 Blue Rd. now ends at 5/15, 45 Oak Ave. runs 5/15 → 5/20.' : 'SCD 2 closes the old version and opens a new one.';
          }
          s2.sort(function (a, b) { return a.id - b.id || a.st - b.st; });
          return msg1 + '<br>' + msg2;
        }
        function draw(msg) {
          box.querySelector('#c_q').innerHTML = CDCEV.map(function (e, i) { return '<span class="ev ' + e.op + (i < k - 1 ? ' done' : i === k - 1 ? ' now' : '') + '">' + (i + 1) + '. ' + e.op + ' id ' + e.id + (e.addr ? ' · ' + e.addr : '') + ' · seq ' + dt(e.seq) + '</span>'; }).join('');
          box.querySelector('#c_v').innerHTML = msg || 'The target starts with Peter and Samarth, both from 5/1.';
          box.querySelector('#c_1').innerHTML = '<table class="dt2 mini"><tr><th>id</th><th>name</th><th>address</th></tr>' + s1.slice().sort(function (a, b) { return a.id - b.id; }).map(function (r) { return '<tr class="' + (chg1.indexOf(r.id) >= 0 ? 'chg' : '') + '"><td>' + r.id + '</td><td>' + r.name + '</td><td>' + r.addr + '</td></tr>'; }).join('') + '</table>';
          box.querySelector('#c_2').innerHTML = '<table class="dt2 mini"><tr><th>id</th><th>name</th><th>address</th><th>__START_AT</th><th>__END_AT</th></tr>' + s2.map(function (r) { return '<tr class="' + (chg2.indexOf(r) >= 0 ? 'chg' : r.en !== null ? 'hist' : '') + '"><td>' + r.id + '</td><td>' + r.name + '</td><td>' + r.addr + '</td><td>' + dt(r.st) + '</td><td>' + nul(dt(r.en)) + '</td></tr>'; }).join('') + '</table>';
          box.querySelector('#c_n').disabled = k >= CDCEV.length;
        }
        box.querySelector('#c_n').onclick = function () { var e = CDCEV[k++]; draw('<b>' + e.op + ' id ' + e.id + '</b> (seq ' + dt(e.seq) + '): ' + apply(e) + (k === CDCEV.length ? '<br>💡 A naive MERGE in arrival order would have left Peter at <b>45 Oak Ave.</b>, the older address.' : '')); };
        box.querySelector('#c_rs').onclick = function () { reset(); draw(); };
        reset(); draw();
      },
      function (el) {
        el.appendChild(h(title('Reading an SCD 2 table') + '<div class="cols"><div>' + sql("-- who is a customer now?\nSELECT * FROM customers WHERE __END_AT IS NULL;\n\n-- where did Peter live on 5/17?\nSELECT address FROM customers\nWHERE customer_id = 1\n  AND __START_AT <= '2025-05-17'\n  AND (__END_AT > '2025-05-17' OR __END_AT IS NULL);") + '</div>' +
          '<div class="cmp" style="--n:1"><div class="card sk"><h4>SCD 1 when…</h4>only the current value matters: the latest price, today\'s email.</div><div class="card sk alt"><h4>SCD 2 when…</h4>you need history: audits, point-in-time reports, "as of" joins.</div></div></div>'));
      },
      function (el, api) {
        ask(api, { id: 'cdc', q: 'Peter\'s change from 5/15 arrives after his change from 5/20. With <span class="mono">SEQUENCE BY process_date</span> and SCD TYPE 1, what is Peter\'s address afterwards?',
          options: ['The 5/15 address, because it arrived last', 'The 5/20 address: the older change is ignored', 'Both rows are kept', 'The update fails because of out-of-order data'],
          correct: 1, why: 'SEQUENCE BY defines the order of changes. A change older than what the row already holds does not overwrite it in SCD 1; in SCD 2 it is inserted as a historical version.' })(el);
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 11 ── which pattern when
  var PATS = ['🧩 multi-flow', '🔀 multiplex', '🚪 sink + UniForm', '🗃️ quarantine', '🕰️ AUTO CDC SCD 2', '🕳️ NULL-tolerant rule'];
  var CASES = [
    ['Three subsidiaries send orders as CSV and JSON into one bronze table. A fourth joins next quarter.', 0, 'One flow per source into the same table: the new source is one more flow, no full refresh.'],
    ['One Kafka topic carries orders, payments and clicks.', 1, 'Ingest once into bronze with a VARIANT payload, then one silver table per event type.'],
    ['The analytics team on Trino must read the gold logistics table.', 2, 'Write it through a Delta sink to a plain Delta table and turn on UniForm for Iceberg reads.'],
    ['Auditors want every rejected trip kept, explained, and fixable.', 3, 'WARN rules plus an is_quarantined flag and two views: nothing is lost.'],
    ['Analysts ask where each customer lived on any past date.', 4, 'SCD Type 2 keeps every version with __START_AT and __END_AT.'],
    ['After an upstream release, half a million old rows "violate" a rule on a column that did not exist before.', 5, 'Old rows are NULL in the new column. Check the value only when it is present.']
  ];
  SC.push({
    id: 'decide', icon: '🧭', title: 'Which pattern when?', sub: 'Six situations from the course. Pick the pattern.',
    thumb: '<span style="font-size:46px">🧭</span>',
    steps: [
      function (el) {
        var box = h(title('Pick the <em>pattern</em>') + '<div id="dq"></div>');
        el.appendChild(box);
        var i = 0, ok = 0;
        function draw() {
          var q = box.querySelector('#dq');
          if (i >= CASES.length) { q.innerHTML = '<div class="verdict good">Done: <b>' + ok + ' / ' + CASES.length + '</b> right.</div><div class="row mt"><button class="btn" id="dqa">↺ again</button></div>'; q.querySelector('#dqa').onclick = function () { i = 0; ok = 0; draw(); }; return; }
          q.innerHTML = '<div class="small">situation ' + (i + 1) + ' of ' + CASES.length + '</div><div class="sortq2">' + CASES[i][0] + '</div><div class="opts6">' + PATS.map(function (p, j) { return '<button class="btn" data-j="' + j + '">' + p + '</button>'; }).join('') + '</div><div id="dqv"></div>';
          q.querySelectorAll('[data-j]').forEach(function (b) {
            b.onclick = function () {
              var right = +b.dataset.j === CASES[i][1]; if (right) ok++;
              q.querySelectorAll('[data-j]').forEach(function (x) { x.disabled = true; });
              q.querySelector('#dqv').innerHTML = '<div class="verdict ' + (right ? 'good' : 'bad') + '">' + (right ? '✓ ' : '✗ ' + PATS[CASES[i][1]] + '. ') + CASES[i][2] + '</div><div class="row mt"><button class="btn acc" id="dqn">next →</button></div>';
              q.querySelector('#dqn').onclick = function () { i++; draw(); };
            };
          });
        }
        draw();
      },
      function (el) {
        el.appendChild(h(title('The whole pipeline, <em>end to end</em>') +
          '<div class="pipe"><div class="pbox"><b>🏪 sources</b>one flow each → bronze</div><span class="arr">→</span><div class="pbox"><b>🔀 bronze</b>VARIANT, rescued data, schema hints</div><span class="arr">→</span><div class="pbox cur"><b>🥈 silver</b>fan-out, TRY_CAST, NULL-tolerant rules, quarantine</div><span class="arr">→</span><div class="pbox"><b>🕰️ AUTO CDC</b>SCD 1 / 2</div><span class="arr">→</span><div class="pbox"><b>🥇 gold</b>materialized views, sinks + UniForm</div></div>' +
          '<div class="callout sk">Every arrow is a flow with its own checkpoint. Keep the names stable, put the rules on the tables, and let the materialized views do the recomputing.</div>'));
      }
    ]
  });
})();
