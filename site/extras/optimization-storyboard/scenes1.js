/* Spark optimization storyboard, part 1: fast queries, the query plan, AQE, statistics, small files. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var SC = window.OPT_SCENES = window.OPT_SCENES || [];
  function code(txt, hl) {
    var out = esc(txt);
    (hl || []).forEach(function (w) { out = out.split(esc(w)).join('<span class="hl">' + esc(w) + '</span>'); });
    return '<pre class="code">' + out + '</pre>';
  }
  function sqlCode(txt) {
    return '<pre class="code">' + esc(txt).replace(/\b(SELECT|FROM|JOIN|ON|WHERE|GROUP BY|ORDER BY|AND|AS|OPTIMIZE|VACUUM|RETAIN|HOURS|ANALYZE|TABLE|COMPUTE|STATISTICS|FOR|ALL|COLUMNS|DESCRIBE|DETAIL|EXTENDED|EXPLAIN|FORMATTED|CLUSTER BY|ALTER|SET|TBLPROPERTIES|ZORDER BY)\b/g, '<span class="kw">$1</span>')
      .replace(/(--[^\n]*)/g, '<span class="cm">$1</span>') + '</pre>';
  }
  var QUERY = "SELECT c.region, sum(o.amount) AS revenue\nFROM orders o\nJOIN customers c ON o.customer_id = c.id\nWHERE o.order_date >= '2026-01-01'\nGROUP BY c.region";

  // 1 ── what makes a query fast
  SC.push({
    id: 'rules', icon: '🚀', title: 'What makes a query fast', sub: 'Read less, move less, compute faster. Almost every trick is one of these three.',
    thumb: '<span style="font-size:50px">📉</span><span class="tag" style="margin-left:6px">10,000 files → 120</span>',
    steps: [
      function (el) {
        var box = h(title('The fastest byte is the one you <em>never read</em>', 'One query over a 2 TB table. Watch how much work disappears before any row is touched.') +
          '<div class="funnel">' +
          ['Table on storage|10,000 files · 2 TB · 40 columns|100', 'Skip files by min/max|data skipping on order_date: 120 files|12', 'Read only 3 columns|column pruning in Parquet: 9 GB|5', 'Filter before the join|fewer rows to shuffle|3', 'Broadcast the small side|no shuffle of the big table|2']
            .map(function (s, i) { var p = s.split('|'); return '<div class="fstep"><span>' + p[0] + '</span><div class="fbar" data-w="' + p[2] + '" style="width:100%">' + p[1] + '</div></div>'; }).join('') +
          '</div><div class="row mt"><button class="btn acc" id="fgo">▶ Run the funnel</button><span class="small">bars = how much data each step still has to deal with</span></div>');
        el.appendChild(box);
        box.querySelector('#fgo').onclick = function () {
          box.querySelectorAll('.fbar').forEach(function (b, i) { setTimeout(function () { b.style.width = Math.max(+b.dataset.w, 18) + '%'; if (i) b.style.background = 'var(--green)'; }, i * 500); });
        };
      },
      function (el) {
        el.appendChild(h(title('Three rules') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>📖 Read less</h4>' + list(['Skip files: data skipping, liquid clustering, partition pruning.', 'Read only the columns you need (no <span class="mono">SELECT *</span>).', 'Fewer, bigger files: OPTIMIZE.']) + '</div>' +
          '<div class="card sk alt"><h4>🚚 Move less</h4>' + list(['A shuffle sends rows over the network and writes them to disk.', 'Filter and aggregate before joins.', 'Broadcast small tables; avoid skew.']) + '</div>' +
          '<div class="card sk"><h4>⚡ Compute faster</h4>' + list(['Photon: vectorized C++ engine.', 'Built-in functions instead of Python UDFs.', 'Let AQE fix the plan at runtime.']) + '</div></div>' +
          '<div class="callout sk thin acc">Bigger compute is the last resort. It makes a bad plan run faster, but the plan stays bad.</div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'rules', q: 'A query reads a 2 TB table but only needs one week of data and 3 of 40 columns. What helps the most?',
          options: ['A bigger cluster', 'Skipping files (clustering on the date) and reading only the 3 columns', 'Caching the whole table first', 'More shuffle partitions'],
          correct: 1, why: 'Reading less beats processing faster. Data skipping removes most files, and the columnar format removes most of the bytes inside the files that are left.' }));
      }
    ]
  });

  // 2 ── query plan journey
  var PLANS = [
    { key: 'parsed', label: 'Parsed (unresolved) logical plan', who: 'Parser', note: 'The parser only checks the <b>syntax</b>. It does not know yet whether <span class="mono">orders</span> exists or what type <span class="mono">amount</span> has: names are still <b>unresolved</b> (Spark prints them with a quote: <span class="mono">\'amount</span>).',
      nodes: [[0, "'Aggregate", "['c.region], ['sum('o.amount) AS revenue]", 'unres'], [1, "'Filter", "('o.order_date >= 2026-01-01)", 'unres'], [2, "'Join Inner", "('o.customer_id = 'c.id)", 'unres'],
        [3, "'UnresolvedRelation", '[orders]', 'unres'], [3, "'UnresolvedRelation", '[customers]', 'unres']] },
    { key: 'analyzed', label: 'Analyzed logical plan', who: 'Analyzer + catalog', note: 'The analyzer looks every name up in the <b>catalog</b> (Unity Catalog): tables become relations, columns get an id and a type (<span class="mono">amount#12: double</span>). A typo in a column name fails <b>here</b>, before any data is read.',
      nodes: [[0, 'Aggregate', '[region#31], [sum(amount#12) AS revenue#40]', 'chg'], [1, 'Filter', '(order_date#11 >= 2026-01-01)', 'chg'], [2, 'Join Inner', '(customer_id#10 = id#30)', 'chg'],
        [3, 'Relation main.sales.orders', '[order_id#9, customer_id#10, order_date#11, amount#12, … 36 more]', 'chg'], [3, 'Relation main.sales.customers', '[id#30, region#31, … 12 more]', 'chg']] },
    { key: 'optimized', label: 'Optimized logical plan', who: 'Optimizer (Catalyst rules)', note: 'Rules rewrite the plan without changing the result: the <b>filter is pushed below the join</b> (predicate pushdown), only the needed <b>columns</b> are kept (column pruning), and <span class="mono">isnotnull</span> filters are added for the join keys.',
      nodes: [[0, 'Aggregate', '[region#31], [sum(amount#12) AS revenue#40]', ''], [1, 'Join Inner', '(customer_id#10 = id#30)', ''], [2, 'Project', '[customer_id#10, amount#12]', 'chg'],
        [3, 'Filter', '(isnotnull(order_date#11) AND (order_date#11 >= 2026-01-01) AND isnotnull(customer_id#10))', 'chg'], [4, 'Relation orders', '[customer_id#10, order_date#11, amount#12]', 'chg'],
        [2, 'Project', '[id#30, region#31]', 'chg'], [3, 'Filter', 'isnotnull(id#30)', 'chg'], [4, 'Relation customers', '[id#30, region#31]', 'chg']] },
    { key: 'physical', label: 'Physical plan', who: 'Planner (strategies + statistics)', note: 'Now Spark chooses <b>how</b>: which join algorithm (here broadcast, because customers is small), where data must be shuffled (<b>Exchange</b>), and a two-step aggregation (partial before the shuffle, final after it). The scan gets <b>PushedFilters</b> and data skipping.',
      nodes: [[0, 'HashAggregate', '(keys=[region], functions=[finalmerge_sum(amount)])', ''], [1, 'Exchange', 'hashpartitioning(region, 200)', 'ex'], [2, 'HashAggregate', '(keys=[region], functions=[partial_sum(amount)])', 'chg'],
        [3, 'BroadcastHashJoin', '[customer_id], [id], Inner, BuildRight', 'bh'], [4, 'Scan parquet orders', 'PushedFilters: [GreaterThanOrEqual(order_date,2026-01-01)], ReadSchema: customer_id, order_date, amount', 'chg'],
        [4, 'BroadcastExchange', 'HashedRelationBroadcastMode', 'ex'], [5, 'Scan parquet customers', 'ReadSchema: id, region', '']] },
    { key: 'exec', label: 'Execution: code and AQE', who: 'Photon / code generation + AQE', note: 'The physical plan is turned into tasks. On Databricks, <b>Photon</b> runs the operators as vectorized native code (without Photon, Spark generates Java code for whole stages). The plan is wrapped in <b>AdaptiveSparkPlan</b>: after each stage AQE may change the rest of the plan using real sizes.',
      nodes: [[0, 'AdaptiveSparkPlan', 'isFinalPlan=true', 'chg'], [1, 'PhotonResultStage', '', 'ph'], [2, 'PhotonGroupingAgg', 'keys=[region]', 'ph'], [3, 'PhotonShuffleExchangeSource', '', 'ph'],
        [4, 'PhotonBroadcastHashJoin', 'BuildRight', 'ph'], [5, 'PhotonScan parquet orders', 'files read 120 of 10,000', 'ph'], [5, 'PhotonBroadcastExchange', '', 'ph']] }
  ];
  function planHtml(p) {
    return '<div class="plan">' + p.nodes.map(function (n, i) {
      return '<div class="pn ' + (n[3] || '') + (n[0] === 0 ? ' root' : '') + '" style="margin-left:' + n[0] * 26 + 'px;animation-delay:' + i * 0.07 + 's"><span class="op">' + esc(n[1]) + '</span><span class="arg">' + esc(n[2]) + '</span></div>';
    }).join('') + '</div>';
  }
  SC.push({
    id: 'plan', icon: '🧭', title: 'From SQL to tasks: the query plan', sub: 'Unresolved → analyzed → optimized logical plan → physical plan → execution.',
    thumb: '<span class="tag">parsed</span>→<span class="tag">analyzed</span>→<span class="tag">optimized</span>→<span class="tag">physical</span>',
    steps: [
      function (el) {
        var boxes = [['📝', 'Your query', 'SQL or DataFrame'], ['🔤', 'Parser', 'unresolved logical plan'], ['📚', 'Analyzer', 'names checked in the catalog'], ['🧠', 'Optimizer', 'rules rewrite the plan'],
          ['🛠️', 'Planner', 'picks joins, adds shuffles'], ['⚡', 'Execution', 'Photon / code gen, AQE']];
        el.appendChild(h(title('Every query takes the <em>same road</em>', 'SQL and DataFrame code end up in the same engine, Catalyst. The plan changes shape four times before a single row is read.') +
          '<div class="pipe">' + boxes.map(function (b, i) { return (i ? '<span class="arr">→</span>' : '') + '<div class="pbox" style="animation-delay:' + i * 0.25 + 's"><b>' + b[0] + ' ' + b[1] + '</b>' + b[2] + '</div>'; }).join('') + '</div>' +
          '<div class="cols mt"><div>' + sqlCode(QUERY) + '</div><div>' + list(['<b>Logical plans</b> say <i>what</i> to compute.', '<b>The physical plan</b> says <i>how</i>: algorithms, shuffles, scans.',
            'Statistics feed the planner: size estimates decide the join strategy.', 'With <b>AQE</b> the plan is not final until the query runs.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('Watch the plan <em>change shape</em>', 'Click through the stages. Yellow = changed in this stage, dashed red = unresolved, red = shuffle (Exchange), green = join strategy, purple = Photon.') +
          '<div class="stages" id="stg"></div><div class="cols"><div id="tree"></div><div><div class="card sk" id="pnote"></div><div class="row mt"><button class="btn acc" id="pnext">Next stage →</button></div></div></div>');
        el.appendChild(box);
        var cur = 0;
        function draw() {
          box.querySelector('#stg').innerHTML = PLANS.map(function (p, i) { return '<button data-i="' + i + '" class="' + (i === cur ? 'on' : '') + '"><span class="n">' + (i + 1) + '</span>' + p.label + '</button>'; }).join('');
          box.querySelectorAll('#stg button').forEach(function (b) { b.onclick = function () { cur = +b.dataset.i; draw(); }; });
          box.querySelector('#tree').innerHTML = planHtml(PLANS[cur]);
          box.querySelector('#pnote').innerHTML = '<div class="note">' + PLANS[cur].who + '</div><p style="font-size:17px;margin:6px 0 0">' + PLANS[cur].note + '</p>';
          box.querySelector('#pnext').textContent = cur < PLANS.length - 1 ? 'Next stage →' : '↺ Start again';
        }
        box.querySelector('#pnext').onclick = function () { cur = (cur + 1) % PLANS.length; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('See it yourself', 'Every stage is printed by EXPLAIN. Nothing runs: EXPLAIN only plans.') +
          '<div class="cols"><div>' + sqlCode('-- all four plans: parsed, analyzed, optimized, physical\nEXPLAIN EXTENDED\nSELECT c.region, sum(o.amount) FROM orders o JOIN customers c ON o.customer_id = c.id\nWHERE o.order_date >= \'2026-01-01\' GROUP BY c.region;\n\n-- the physical plan, readable, with details per node\nEXPLAIN FORMATTED SELECT …;') +
          '<div class="mt">' + code('df.explain(mode="extended")   # Python: parsed, analyzed, optimized, physical\ndf.explain(mode="formatted")  # physical plan with details') + '</div></div><div>' +
          list(['<span class="mono">== Parsed Logical Plan ==</span> is the unresolved plan.', '<span class="mono">== Analyzed Logical Plan ==</span> has types and ids.', '<span class="mono">== Optimized Logical Plan ==</span> shows the rewrites.',
            '<span class="mono">== Physical Plan ==</span> shows joins, Exchanges and pushed filters.', 'Before the query ran, AQE prints <span class="mono">isFinalPlan=false</span>: the real plan is in the query profile or the Spark UI afterwards.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'plan', q: 'You misspell a column name (<span class="mono">amout</span>). In which stage does the query fail?',
          options: ['Parsing', 'Analysis: the name cannot be resolved against the catalog', 'Physical planning', 'Only when a task reads the Parquet file'],
          correct: 1, why: 'The parser only checks syntax, and <span class="mono">amout</span> is a valid identifier. The analyzer resolves names against the catalog and fails with an unresolved column error, before any data is read.' }));
      }
    ]
  });

  // 3 ── AQE
  function bars(el, heights, cls) { el.innerHTML = heights.map(function (v, i) { return '<i style="height:' + v + '%" class="' + (cls ? cls(i, v) : '') + '"></i>'; }).join(''); }
  SC.push({
    id: 'aqe', icon: '🔄', title: 'Adaptive Query Execution', sub: 'The plan is fixed again at runtime, with real sizes instead of estimates.',
    thumb: '<span class="tag">SortMergeJoin</span><span style="font-size:24px;margin:0 6px">⇒</span><span class="tag" style="color:var(--green)">BroadcastHashJoin</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Estimates can be <em>wrong</em>', 'Before the query runs, the planner only has estimates: statistics, file sizes, guesses about how selective a filter is. AQE looks again when real numbers exist.') +
          '<div class="pipe">' + [['🛠️', 'Initial plan', 'from estimates'], ['▶️', 'Stage 1 runs', 'e.g. scan + shuffle write'], ['📏', 'Real sizes', 'bytes and rows per partition'], ['🔄', 'Re-plan the rest', 'join, partitions, skew'], ['▶️', 'Next stage', '…until isFinalPlan=true']]
            .map(function (b, i) { return (i ? '<span class="arr">→</span>' : '') + '<div class="pbox' + (i === 3 ? ' cur' : '') + '" style="animation-delay:' + i * 0.25 + 's"><b>' + b[0] + ' ' + b[1] + '</b>' + b[2] + '</div>'; }).join('') + '</div>' +
          '<div class="cmp mt" style="--n:3"><div class="card sk"><h4>🔀 → 📡 Switch joins</h4>A side turned out small → sort-merge join becomes a broadcast hash join.</div>' +
          '<div class="card sk alt"><h4>🧩 Coalesce partitions</h4>Hundreds of tiny shuffle partitions are merged into fewer, right-sized ones.</div>' +
          '<div class="card sk"><h4>🐘 Split skew</h4>One huge partition of a join is split into smaller pieces.</div></div>' +
          '<div class="callout sk thin">AQE is on by default in Databricks and in Apache Spark 3.2+. Re-planning happens at <b>stage boundaries</b>, where a shuffle or broadcast has finished and its size is known.</div>'));
      },
      function (el) {
        var box = h(title('Switch the join <em>at runtime</em>', 'The planner thought the filtered customers table was 1.2 GB. Run the first stage and see what AQE does with the real size.') +
          '<div class="cols"><div><div id="aplan"></div></div><div><div class="slider">Rows left in customers after the filter: <input type="range" id="rsel" min="0" max="100" value="3"><b id="rlab"></b></div>' +
          '<div class="row mt"><button class="btn acc" id="arun">▶ Run stage 1 (shuffle customers)</button><button class="btn" id="areset">↺</button></div><div class="verdict" id="aver">Estimated size: 1.2 GB → planned as <b>SortMergeJoin</b>.</div></div></div>');
        el.appendChild(box);
        function sizeMB() { var v = +box.querySelector('#rsel').value; return Math.round(Math.pow(v / 100, 2) * 2000 + 1); }
        function plan(final, bhj) {
          var n = bhj ? [[0, 'AdaptiveSparkPlan', 'isFinalPlan=' + final, 'chg'], [1, 'BroadcastHashJoin', 'customer_id = id, BuildRight', 'bh'], [2, 'ShuffleQueryStage 0', '(orders, already shuffled)', ''], [2, 'BroadcastQueryStage 2', 'customers ' + sizeMB() + ' MB', 'bh']]
            : [[0, 'AdaptiveSparkPlan', 'isFinalPlan=' + final, 'chg'], [1, 'SortMergeJoin', 'customer_id = id', ''], [2, 'Sort', '', ''], [3, 'Exchange', 'hashpartitioning(customer_id, 200)', 'ex'], [2, 'Sort', '', ''], [3, 'Exchange', 'hashpartitioning(id, 200)', 'ex']];
          box.querySelector('#aplan').innerHTML = planHtml({ nodes: n });
        }
        function lab() { box.querySelector('#rlab').textContent = sizeMB() + ' MB'; }
        box.querySelector('#rsel').oninput = lab; lab(); plan(false, false);
        box.querySelector('#arun').onclick = function () {
          var mb = sizeMB(), v = box.querySelector('#aver');
          if (mb <= 30) { plan(true, true); v.className = 'verdict good'; v.innerHTML = 'Measured: <b>' + mb + ' MB</b>. Small enough to broadcast → AQE replaced the sort-merge join with a <b>BroadcastHashJoin</b>. The sort and the second shuffle never run.'; }
          else { plan(true, false); v.className = 'verdict warn'; v.innerHTML = 'Measured: <b>' + mb + ' MB</b>. Too big to broadcast → the plan stays a <b>SortMergeJoin</b>. (AQE may still coalesce partitions or split skew.)'; }
        };
        box.querySelector('#areset').onclick = function () { plan(false, false); var v = box.querySelector('#aver'); v.className = 'verdict'; v.innerHTML = 'Estimated size: 1.2 GB → planned as <b>SortMergeJoin</b>.'; };
      },
      function (el) {
        var box = h(title('Coalesce <em>tiny partitions</em>', 'A shuffle starts with a fixed number of partitions (200 by default). After a selective filter most of them are almost empty: 200 tasks for very little data.') +
          '<div class="parts" id="cp"></div><div class="row mt"><button class="btn acc" id="cgo">▶ Let AQE coalesce</button><span class="small" id="cinfo">200 partitions · most of them a few KB</span></div>' +
          '<div class="callout sk thin">AQE merges neighbouring small partitions until each is close to a target size (<span class="mono">spark.sql.adaptive.advisoryPartitionSizeInBytes</span>, 64 MB by default in Apache Spark). Fewer tasks, less overhead, fewer small output files.</div>');
        el.appendChild(box);
        var hs = []; for (var i = 0; i < 200; i++) hs.push(3 + ((i * 37) % 11));
        bars(box.querySelector('#cp'), hs);
        box.querySelector('#cgo').onclick = function () {
          var m = []; for (var j = 0; j < 12; j++) m.push(60 + ((j * 13) % 30));
          bars(box.querySelector('#cp'), m, function () { return 'merged'; });
          box.querySelector('#cinfo').textContent = '12 partitions · each close to the target size';
        };
      },
      function (el) {
        var box = h(title('Split a <em>skewed</em> partition', 'Orders joined on product_id: product 1 is in a third of all orders. One task gets a giant partition and every other task waits for it.') +
          '<div class="parts" id="sp"></div><div class="row mt"><button class="btn acc" id="sgo">▶ Let AQE split the skew</button><span class="small" id="sinfo">one task: 40× the median</span></div>' +
          '<div class="callout sk thin">A partition counts as skewed when it is much bigger than the median (5× and above 256 MB by default in Apache Spark). AQE splits it into several tasks and copies the matching part of the other side to each of them.</div>');
        el.appendChild(box);
        var hs = [96, 8, 9, 7, 10, 8, 6, 9, 8, 7, 9, 8];
        bars(box.querySelector('#sp'), hs, function (i) { return i === 0 ? 'big' : ''; });
        box.querySelector('#sgo').onclick = function () {
          bars(box.querySelector('#sp'), [16, 16, 16, 16, 16, 16, 8, 9, 7, 10, 8, 6, 9, 8, 7, 9, 8], function (i) { return i < 6 ? 'split' : ''; });
          box.querySelector('#sinfo').textContent = 'the big partition became 6 tasks: no single straggler';
        };
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'aqe', q: 'When can AQE change a join from sort-merge to broadcast hash join?',
          options: ['Only before the query starts', 'After a stage has run and the real size of one side is known to be small', 'Never: the join strategy is fixed by the SQL text', 'Only when you add a BROADCAST hint'],
          correct: 1, why: 'AQE re-optimizes at stage boundaries using runtime statistics. If a shuffled side turns out small, the remaining plan switches to a broadcast hash join.' }));
      }
    ]
  });

  // 4 ── statistics
  var FILES = [
    ['part-00000', '2026-01-02', '2026-03-30', 3, 980, 41210], ['part-00001', '2026-01-05', '2026-04-11', 1, 1200, 39877], ['part-00002', '2026-02-14', '2026-05-28', 5, 870, 40502],
    ['part-00003', '2026-03-01', '2026-06-30', 2, 1500, 38190], ['part-00004', '2026-01-20', '2026-06-02', 1, 640, 42011], ['part-00005', '2026-04-03', '2026-06-29', 8, 2100, 39554]];
  var CLUSTERED = [['part-00010', '2026-01-01', '2026-01-31', 1, 1500], ['part-00011', '2026-02-01', '2026-02-28', 2, 1800], ['part-00012', '2026-03-01', '2026-03-31', 1, 2100],
    ['part-00013', '2026-04-01', '2026-04-30', 3, 1400], ['part-00014', '2026-05-01', '2026-05-31', 1, 1900], ['part-00015', '2026-06-01', '2026-06-30', 2, 1600]];
  function day(d) { return (Date.parse(d) - Date.parse('2026-01-01')) / 864e5; }
  SC.push({
    id: 'stats', icon: '📊', title: 'Statistics: what is computed, and for what', sub: 'Parquet footers, Delta log stats and ANALYZE TABLE. Open a file and skip files yourself.',
    thumb: '<span class="tag">min 2026-01-02</span><span class="tag">max 2026-03-30</span><span style="font-size:40px;margin-left:6px">📊</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Three places where <em>statistics</em> live') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>📦 Parquet footer</h4>Per <b>row group</b> and column: min, max, null count. Written with the file. Lets a reader skip row groups inside a file.</div>' +
          '<div class="card sk alt"><h4>🧾 Delta log</h4>Per <b>file</b>, in the <span class="mono">add</span> action: <span class="mono">numRecords</span>, <span class="mono">minValues</span>, <span class="mono">maxValues</span>, <span class="mono">nullCount</span>. Collected at write time for the first 32 columns (<span class="mono">delta.dataSkippingNumIndexedCols</span>). Lets Spark skip whole files <b>before</b> opening them.</div>' +
          '<div class="card sk"><h4>📚 Table statistics</h4>Row count, size, distinct values per column, from <span class="mono">ANALYZE TABLE … COMPUTE STATISTICS</span>. The <b>optimizer</b> uses them to estimate sizes: join order, broadcast or not.</div></div>' +
          '<div class="callout sk thin">Delta file statistics are free: they are written with every file. Table statistics must be computed (or kept fresh by predictive optimization on Unity Catalog managed tables).</div>'));
      },
      function (el) {
        var box = h(title('Open a file: <em>what was computed?</em>', 'The orders table has six files. Click one to see the statistics stored for it in the Delta log.') +
          '<div class="cols"><div class="folder" id="sfiles"><div class="fh">s3://acme-lakehouse-prod/sales/orders/</div></div><div id="sjson"><div class="card sk thin small">👈 click a file</div></div></div>');
        el.appendChild(box);
        var fl = box.querySelector('#sfiles');
        FILES.forEach(function (f, i) {
          var d = document.createElement('div'); d.className = 'file'; d.style.cursor = 'pointer';
          d.innerHTML = '<span class="ic">📦</span>' + f[0] + '-….snappy.parquet<span class="tg">' + f[5].toLocaleString('en') + ' rows</span>';
          d.onclick = function () {
            fl.querySelectorAll('.file').forEach(function (x) { x.classList.remove('live'); }); d.classList.add('live');
            var st = { numRecords: f[5], minValues: { order_id: i * 50000 + 1, customer_id: f[3], order_date: f[1], amount: 1.5 }, maxValues: { order_id: i * 50000 + f[5], customer_id: f[4], order_date: f[2], amount: 2480.0 }, nullCount: { order_id: 0, customer_id: 0, order_date: 0, amount: 12 } };
            box.querySelector('#sjson').innerHTML = '<div class="note">the add action of this file, in _delta_log</div>' + code(JSON.stringify({ add: { path: f[0] + '-3f2a….snappy.parquet', size: 52428800 + i * 1048576, dataChange: true, stats: '…' } }, null, 2)) +
              '<div class="note mt">and its stats string, parsed</div>' + code(JSON.stringify(st, null, 2), ['"order_date": "' + f[1] + '"', '"order_date": "' + f[2] + '"']) +
              '<p class="small">A query with <span class="mono">WHERE order_date = …</span> compares only these two dates. If the value is outside [min, max], the file is never opened.</p>';
          };
          fl.appendChild(d);
        });
      },
      function (el) {
        var box = h(title('Skip files <em>yourself</em>', 'Each bar is one file: the range of order_date inside it. Pick a filter, then compare the file layout before and after clustering.') +
          '<div class="row"><div class="tabs" id="qsel"></div><div class="tabs" id="lsel"></div></div><div class="fileaxis" id="fax"></div><div class="verdict" id="sver"></div>');
        el.appendChild(box);
        var qs = [['order_date = 2026-03-14', '2026-03-14'], ['order_date = 2026-06-20', '2026-06-20'], ['order_date = 2026-01-10', '2026-01-10']], q = 0, lay = 0;
        function draw() {
          box.querySelector('#qsel').innerHTML = qs.map(function (x, i) { return '<button class="' + (i === q ? 'on' : '') + '" data-i="' + i + '">WHERE ' + x[0] + '</button>'; }).join('');
          box.querySelector('#lsel').innerHTML = ['as written', 'after CLUSTER BY order_date + OPTIMIZE'].map(function (x, i) { return '<button class="' + (i === lay ? 'on' : '') + '" data-l="' + i + '">' + x + '</button>'; }).join('');
          box.querySelectorAll('#qsel button').forEach(function (b) { b.onclick = function () { q = +b.dataset.i; draw(); }; });
          box.querySelectorAll('#lsel button').forEach(function (b) { b.onclick = function () { lay = +b.dataset.l; draw(); }; });
          var files = lay ? CLUSTERED : FILES, v = day(qs[q][1]), total = 181, read = 0, html = '';
          files.forEach(function (f) {
            var a = day(f[1]), b = day(f[2]), hit = v >= a && v <= b; if (hit) read++;
            html += '<div class="frow ' + (hit ? 'read' : 'skip') + '"><span>' + f[0] + '</span><div class="rng"><i style="left:' + (a / total * 100) + '%;width:' + ((b - a) / total * 100) + '%"></i></div><span class="st">' + (hit ? 'READ' : 'skip') + '</span></div>';
          });
          ['2026-01-01', '2026-03-01', '2026-05-01', '2026-06-30'].forEach(function (d) { html += '<span class="axislab" style="left:calc(168px + (100% - 246px) * ' + (day(d) / total) + ')">' + d.slice(5) + '</span>'; });
          html += '<div class="axisq" style="left:calc(168px + (100% - 246px) * ' + (v / total) + ')"></div>';
          box.querySelector('#fax').innerHTML = html;
          var ver = box.querySelector('#sver');
          ver.className = 'verdict ' + (read <= 1 ? 'good' : 'warn');
          ver.innerHTML = 'Spark opens <b>' + read + ' of ' + files.length + '</b> files. ' + (lay ? 'Clustering put similar dates into the same files, so the ranges are narrow and do not overlap.' : 'The files were written as data arrived: wide, overlapping ranges, so many files might contain the date.');
        }
        draw();
      },
      function (el) {
        el.appendChild(h(title('Commands that show and compute <em>statistics</em>') + '<div class="cols"><div>' +
          sqlCode('-- table and column statistics for the optimizer\nANALYZE TABLE main.sales.orders COMPUTE STATISTICS FOR ALL COLUMNS;\n\n-- look at them\nDESCRIBE EXTENDED main.sales.orders;            -- "Statistics" row: size, rows\nDESCRIBE EXTENDED main.sales.orders amount;     -- min, max, distinct count, nulls\n\n-- file count and size of the Delta table\nDESCRIBE DETAIL main.sales.orders;\n\n-- make file statistics useful: cluster by the columns you filter on\nALTER TABLE main.sales.orders CLUSTER BY (order_date);\nOPTIMIZE main.sales.orders;') +
          '</div><div>' + list(['Delta file stats are collected for the <b>first 32 columns</b>: put the columns you filter on early, or set <span class="mono">delta.dataSkippingStatsColumns</span>.',
            'Stats on a long free-text column cost time at write and rarely help.', '<b>Stale table statistics</b> mislead the optimizer: a table that grew from 5 MB to 5 GB may still be broadcast. Re-run ANALYZE after big loads.',
            'Predictive optimization can run OPTIMIZE, VACUUM and statistics collection for Unity Catalog managed tables automatically.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'stats', q: 'A query filters on <span class="mono">order_date</span>, but Spark still reads almost every file. The Delta stats are there. What is the most likely reason?',
          options: ['Delta does not collect min/max statistics', 'The files have wide, overlapping order_date ranges: the data is not clustered by date', 'ANALYZE TABLE was never run', 'The table has too few columns'],
          correct: 1, why: 'Data skipping compares the filter with each file’s min and max. If every file contains dates from the whole year, every file might match. Clustering (liquid clustering or Z-order) narrows the ranges.' }));
      }
    ]
  });

  // 5 ── small files: OPTIMIZE and VACUUM
  SC.push({
    id: 'smallfiles', icon: '🧹', title: 'Small files: OPTIMIZE and VACUUM', sub: 'Stream tiny files in, compact them, and clean up after the retention window.',
    thumb: '<span style="font-size:20px;letter-spacing:-2px">▮▮▮▮▮▮▮▮▮▮</span><span style="font-size:26px;margin:0 6px">→</span><span style="font-size:30px">▮▮</span>',
    steps: [
      function (el) {
        var box = h(title('A stream writes <em>tiny files</em>', 'Every micro-batch commits at least one file. Add batches and watch the cost of reading the table.') +
          '<div class="fgrid" id="sg"></div><div class="stats3"><div><small>files</small><b id="nf">0</b></div><div><small>average size</small><b id="av">–</b></div><div><small>est. read time</small><b id="rt">–</b></div></div>' +
          '<div class="row"><button class="btn acc" id="b1">+ 1 micro-batch</button><button class="btn" id="b20">+ 20 micro-batches</button></div>' +
          '<div class="callout sk thin">Each file costs a list call, an open, a footer read and usually one task, whatever its size. 500 files of 8 MB are much slower to read than 4 files of 1 GB with the same data.</div>');
        el.appendChild(box);
        var n = 0, mb = 0;
        function add(k) {
          for (var i = 0; i < k; i++) { var s = 4 + ((n * 7) % 9); n++; mb += s; var f = document.createElement('i'); f.style.height = (8 + s * 3) + 'px'; box.querySelector('#sg').appendChild(f); }
          box.querySelector('#nf').textContent = n; box.querySelector('#av').textContent = (mb / n).toFixed(1) + ' MB';
          box.querySelector('#rt').textContent = (n * 0.08 + mb / 400).toFixed(1) + ' s';
        }
        box.querySelector('#b1').onclick = function () { add(1); }; box.querySelector('#b20').onclick = function () { add(20); };
        add(12);
      },
      function (el) {
        var box = h(title('OPTIMIZE: <em>bin-packing</em>', 'OPTIMIZE rewrites small files into bigger ones (around 1 GB by default). The old files are only marked as removed in the log, so time travel still works.') +
          '<div class="fgrid" id="og"></div><div class="stats3"><div><small>files in the table</small><b id="ot">60</b></div><div><small>files on storage</small><b id="os">60</b></div><div><small>storage used</small><b id="ou">480 MB</b></div></div>' +
          '<div class="row"><button class="btn acc" id="ogo">▶ OPTIMIZE orders</button></div><div class="mt">' + sqlCode('OPTIMIZE main.sales.orders;\n-- result: numFilesRemoved = 60, numFilesAdded = 1 (here the whole table fits in one file)') + '</div>');
        el.appendChild(box);
        var g = box.querySelector('#og');
        for (var i = 0; i < 60; i++) { var f = document.createElement('i'); f.style.height = (14 + (i * 7) % 26) + 'px'; g.appendChild(f); }
        box.querySelector('#ogo').onclick = function () {
          g.querySelectorAll('i').forEach(function (f, k) { setTimeout(function () { f.classList.add('tomb'); }, k * 15); });
          setTimeout(function () { var b = document.createElement('i'); b.className = 'big'; b.style.height = '110px'; g.appendChild(b);
            box.querySelector('#ot').textContent = '1'; box.querySelector('#os').textContent = '61'; box.querySelector('#ou').textContent = '960 MB'; }, 1000);
        };
      },
      function (el) {
        var box = h(title('VACUUM and the <em>retention window</em>', 'VACUUM deletes files that the current version no longer uses, but only if they were removed longer ago than the retention period (7 days by default).') +
          '<div class="slider">Days since OPTIMIZE: <input type="range" id="vd" min="0" max="10" value="2"><b id="vdl"></b></div><div class="timeline7 mt" id="vt"></div>' +
          '<div class="row mt"><button class="btn acc" id="vgo">▶ VACUUM orders</button></div><div class="verdict" id="vv">60 old files on storage · time travel to the version before OPTIMIZE works.</div>' +
          '<div class="mt">' + sqlCode("VACUUM main.sales.orders;                    -- default: keep 7 days\nVACUUM main.sales.orders RETAIN 240 HOURS;   -- keep 10 days\nVACUUM main.sales.orders DRY RUN;            -- list what would be deleted") + '</div>');
        el.appendChild(box);
        var gone = false;
        function draw() {
          var d = +box.querySelector('#vd').value; box.querySelector('#vdl').textContent = d + ' day(s)';
          box.querySelector('#vt').innerHTML = Array.from({ length: 11 }, function (_, i) { return '<span class="' + (i < 7 ? 'prot' : 'ok') + (i === d ? ' now' : '') + '">day ' + i + '</span>'; }).join('');
        }
        box.querySelector('#vd').oninput = draw; draw();
        box.querySelector('#vgo').onclick = function () {
          var d = +box.querySelector('#vd').value, v = box.querySelector('#vv');
          if (gone) { v.className = 'verdict'; v.innerHTML = 'Nothing left to delete.'; return; }
          if (d < 7) { v.className = 'verdict warn'; v.innerHTML = 'Deleted <b>0</b> files: they were removed only ' + d + ' day(s) ago, inside the 7-day window. Readers and time travel are protected.'; }
          else { gone = true; v.className = 'verdict good'; v.innerHTML = 'Deleted <b>60</b> files, storage back to 480 MB. Time travel to versions before OPTIMIZE now fails: their files are gone.'; }
        };
      },
      function (el) {
        el.appendChild(h(title('Let the platform <em>do the chores</em>') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>✍️ Optimized writes</h4>Fewer, larger files at write time: data is shuffled to a few writers before it is written.</div>' +
          '<div class="card sk alt"><h4>🧩 Auto compaction</h4>After a write, small files in the touched data are compacted automatically.</div>' +
          '<div class="card sk"><h4>🤖 Predictive optimization</h4>For Unity Catalog managed tables Databricks decides when to run OPTIMIZE and VACUUM (and collect statistics).</div></div>' +
          '<div class="callout sk thin">Liquid clustering (<span class="mono">CLUSTER BY</span>) replaces partitioning and Z-order for most tables: OPTIMIZE then also keeps the data clustered, so the min/max statistics stay narrow.</div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'small', q: 'Right after OPTIMIZE, storage use went <b>up</b>. Why?',
          options: ['OPTIMIZE duplicates the data on purpose', 'The new big files are written, but the old small files stay on storage until VACUUM deletes them after the retention period', 'Statistics take a lot of space', 'It did not: it always goes down'],
          correct: 1, why: 'OPTIMIZE only marks the old files as removed in the log, for time travel and for readers that are still running. VACUUM deletes them once they are older than the retention window.' }));
      }
    ]
  });
})();
