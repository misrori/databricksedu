/* Spark optimization storyboard, part 2: broadcast hash join, sort-merge join, query profile and Spark UI, Photon, recap. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var SC = window.OPT_SCENES = window.OPT_SCENES || [];
  function pre(txt, hl) {
    var out = esc(txt);
    (hl || []).forEach(function (w) { out = out.split(esc(w)).join('<span class="hl">' + esc(w) + '</span>'); });
    return '<pre class="code">' + out.replace(/(--[^\n]*|#[^\n]*)/g, '<span class="cm">$1</span>') + '</pre>';
  }

  // ------------------------------------------------------------------ 6 ── broadcast hash join
  var PRODUCTS = [[101, 'Shoe'], [102, 'Shirt'], [205, 'Coat'], [118, 'Hat'], [342, 'Sock'], [77, 'Belt'], [160, 'Scarf'], [409, 'Bag']];
  var ORDERS = [[1001, 101], [1002, 205], [1003, 999], [1004, 118], [1005, 77], [1006, 500], [1007, 205]];
  var NB = 8;
  function bucketOf(k) { return k % NB; }
  function htHtml(items, mark) {
    var b = []; for (var i = 0; i < NB; i++) b.push([]);
    items.forEach(function (p) { b[bucketOf(p[0])].push(p); });
    return '<div class="ht">' + b.map(function (xs, i) {
      return '<div class="bucket ' + (mark && mark[0] === i ? mark[1] : '') + '"><span class="bi">bucket ' + i + '</span>' + xs.map(function (p) { return '<span class="it">' + p[0] + ' → ' + p[1] + '</span>'; }).join('') + '</div>';
    }).join('') + '</div>';
  }
  function clusterHtml(st) {
    // st: {driver: html, ex: [html x4], mem: [state x4]}
    var html = '<div class="cluster"><div class="node driver"><h5>🧠 Driver</h5>' + (st.driver || '<span class="small">plans, schedules</span>') + '</div>';
    for (var i = 0; i < 4; i++) {
      html += '<div class="node"><h5>⚙️ Executor ' + (i + 1) + '</h5>' + (st.ex ? st.ex[i] : '') +
        '<div class="mem ' + (st.mem ? st.mem[i] || '' : '') + '">' + (st.memtxt ? st.memtxt[i] || '' : 'memory') + '</div></div>';
    }
    return html + '</div>';
  }
  function ordersChunks(i) { return '<span class="chunk2">orders p' + (i * 4) + '</span><span class="chunk2">p' + (i * 4 + 1) + '</span><span class="chunk2">p' + (i * 4 + 2) + '</span><span class="chunk2">p' + (i * 4 + 3) + '</span>'; }
  SC.push({
    id: 'bhj', icon: '📡', title: 'Broadcast hash join, step by step', sub: 'Collect the small table, build a hash table, send a copy everywhere, probe locally. No shuffle of the big table.',
    thumb: '<span style="font-size:44px">📦</span><span style="font-size:26px;margin:0 6px">⇉</span><span style="font-size:30px">⚙️⚙️⚙️⚙️</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('One huge table, one <em>tiny</em> one', 'Orders has 2 billion rows spread over 4 executors. Products has 40 rows. Shuffling 2 billion rows to meet 40 would be a waste.') +
          '<div class="cols"><div>' + pre("SELECT o.order_id, p.name\nFROM orders o\nJOIN products p ON o.product_id = p.id") +
          '<div class="mt">' + pre("BroadcastHashJoin [product_id], [id], Inner, BuildRight\n:- Scan parquet orders\n+- BroadcastExchange HashedRelationBroadcastMode(...)\n   +- Scan parquet products", ['BroadcastHashJoin', 'BuildRight', 'BroadcastExchange']) + '</div></div><div>' +
          list(['<b>Build side</b>: the small table (here products, “BuildRight”). It becomes an in-memory hash table.', '<b>Probe side</b> (stream side): the big table. Its rows never move.',
            '<b>BroadcastExchange</b> is the step that ships the hash table to every executor.', 'Result: the join runs inside the scan stage of orders. No Exchange for orders, no sort.']) + '</div></div>'));
        el.appendChild(h('<div class="mt">' + clusterHtml({ ex: [0, 1, 2, 3].map(function (i) { return ordersChunks(i) + '<span class="chunk2 small">products ' + (i * 10 + 1) + '-' + (i * 10 + 10) + '</span>'; }) }) + '</div>'));
      },
      function (el) {
        var box = h(title('Step 1: <em>collect</em> the small side', 'The executors read their pieces of products. The pieces are sent to the driver, which puts the whole table together.') +
          '<div id="cl"></div><div class="row mt"><button class="btn acc" id="cgo">▶ Collect products</button><span class="small">40 rows · a few KB</span></div>');
        el.appendChild(box);
        var got = 0;
        function draw() {
          box.querySelector('#cl').innerHTML = clusterHtml({
            driver: got ? '<span class="chunk2 small">products: ' + (got * 10) + ' / 40 rows</span>' : '',
            ex: [0, 1, 2, 3].map(function (i) { return ordersChunks(i) + (i >= got ? '<span class="chunk2 small">products ' + (i * 10 + 1) + '-' + (i * 10 + 10) + '</span>' : '<span class="small"> ✓ sent</span>'); })
          });
        }
        draw();
        box.querySelector('#cgo').onclick = function () { got = 0; draw(); for (var k = 1; k <= 4; k++) (function (k) { setTimeout(function () { got = k; draw(); }, k * 450); })(k); };
      },
      function (el) {
        var box = h(title('Step 2: build the <em>hash table</em>', 'Each product goes into a bucket: <span class="mono">bucket = hash(id) mod 8</span>. Finding a key later means computing one hash and looking in one bucket, not scanning the table.') +
          '<div class="cols"><div><div class="hashcalc" id="hc">press “Insert next row”</div><div class="rowsq mt" id="rq"></div></div><div id="ht"></div></div>' +
          '<div class="row mt"><button class="btn acc" id="hn">Insert next row</button><button class="btn" id="ha">Insert all</button><span class="small">(Spark uses a real hash function such as Murmur3; here “id mod 8” keeps the numbers readable)</span></div>');
        el.appendChild(box);
        var n = 0;
        function draw(mark) {
          box.querySelector('#rq').innerHTML = PRODUCTS.map(function (p, i) { return '<span class="' + (i < n ? 'done' : i === n ? 'cur' : '') + '">id ' + p[0] + ' · ' + p[1] + '</span>'; }).join('');
          box.querySelector('#ht').innerHTML = htHtml(PRODUCTS.slice(0, n), mark);
        }
        function next() {
          if (n >= PRODUCTS.length) return;
          var p = PRODUCTS[n], b = bucketOf(p[0]); n++;
          box.querySelector('#hc').innerHTML = 'hash(' + p[0] + ') mod 8 = <b>' + b + '</b> → bucket ' + b + (PRODUCTS.slice(0, n - 1).some(function (q) { return bucketOf(q[0]) === b; }) ? ' <span style="color:var(--accent)">(already used: the bucket keeps a small list)</span>' : '');
          draw([b, 'look']);
        }
        box.querySelector('#hn').onclick = next;
        box.querySelector('#ha').onclick = function () { while (n < PRODUCTS.length) next(); box.querySelector('#hc').innerHTML = 'All 8 products are in the hash table. This object is what gets broadcast.'; };
        draw();
      },
      function (el) {
        var box = h(title('Step 3: <em>broadcast</em> a copy to every executor', 'The driver hands the hash table out. Executors also pass blocks to each other (Spark’s torrent-style broadcast), so the driver is not the only sender.') +
          '<div id="bc"></div><div class="row mt"><button class="btn acc" id="bgo">▶ Broadcast</button><span class="small" id="binfo">copies in memory: driver only</span></div>' +
          '<div class="callout sk thin">Every executor keeps a <b>full copy</b> in memory for the whole join. Memory used = size of the hash table × (executors + driver). That is why only small tables can be broadcast.</div>');
        el.appendChild(box);
        var k = 0;
        function draw() {
          box.querySelector('#bc').innerHTML = clusterHtml({ driver: '<span class="chunk2 small">🧮 hash table (40 rows)</span>', ex: [0, 1, 2, 3].map(ordersChunks),
            mem: [0, 1, 2, 3].map(function (i) { return i < k ? 'full' : ''; }), memtxt: [0, 1, 2, 3].map(function (i) { return i < k ? '🧮 hash table copy' : 'memory'; }) });
          box.querySelector('#binfo').textContent = 'copies in memory: driver' + (k ? ' + ' + k + ' executor(s)' : ' only');
        }
        draw();
        box.querySelector('#bgo').onclick = function () { k = 0; draw(); for (var i = 1; i <= 4; i++) (function (i) { setTimeout(function () { k = i; draw(); }, i * 400); })(i); };
      },
      function (el) {
        var box = h(title('Step 4: <em>probe</em> locally', 'Each task streams its own partition of orders. For every row: hash the product_id, look in one bucket, output the joined row if the key is there.') +
          '<div class="cols"><div><div class="note">orders partition p0 (stays on executor 1)</div><div class="rowsq" id="pq"></div><div class="hashcalc mt" id="pc">press “Probe next row”</div></div>' +
          '<div><div id="pht"></div><div class="note mt">output</div><div class="outrows card sk thin" id="po"></div></div></div>' +
          '<div class="row mt"><button class="btn acc" id="pn">Probe next row</button><button class="btn" id="pa">Probe all</button></div>');
        el.appendChild(box);
        var n = 0, out = [];
        function draw(mark) {
          box.querySelector('#pq').innerHTML = ORDERS.map(function (o, i) { return '<span class="' + (i < n ? 'done' : i === n ? 'cur' : '') + '">order #' + o[0] + ' · product_id ' + o[1] + '</span>'; }).join('');
          box.querySelector('#pht').innerHTML = htHtml(PRODUCTS, mark);
          box.querySelector('#po').innerHTML = out.length ? out.join('') : '<span class="small">(nothing yet)</span>';
        }
        function next() {
          if (n >= ORDERS.length) return;
          var o = ORDERS[n], b = bucketOf(o[1]), p = PRODUCTS.find(function (x) { return x[0] === o[1]; }); n++;
          if (p) { out.push('<div>✓ #' + o[0] + ' · ' + p[1] + '</div>'); box.querySelector('#pc').innerHTML = 'hash(' + o[1] + ') mod 8 = ' + b + ' → bucket ' + b + ' → <b style="color:var(--green)">HIT</b>: ' + p[1]; draw([b, 'hit']); }
          else { box.querySelector('#pc').innerHTML = 'hash(' + o[1] + ') mod 8 = ' + b + ' → bucket ' + b + ' → <b style="color:var(--red)">MISS</b>: inner join drops the row'; draw([b, 'miss']); }
        }
        box.querySelector('#pn').onclick = next;
        box.querySelector('#pa').onclick = function () { while (n < ORDERS.length) next(); };
        draw();
      },
      function (el) {
        var box = h(title('When does Spark <em>choose</em> it?', 'Move the slider: the estimated size of the smaller side. Each executor has 16 GB of memory here.') +
          '<div class="slider">Smaller side: <input type="range" id="bs" min="0" max="100" value="20"><b id="bsl"></b></div><div id="bcl" class="mt"></div><div class="verdict" id="bv"></div>' +
          '<div class="mt">' + pre("-- force it (only when you know the table is small)\nSELECT /*+ BROADCAST(p) */ o.order_id, p.name\nFROM orders o JOIN products p ON o.product_id = p.id;\n\n# Python\norders.join(F.broadcast(products), \"product_id\")\n\n-- the planning threshold (Apache Spark default 10 MB; classic compute only)\n-- spark.conf.set(\"spark.sql.autoBroadcastJoinThreshold\", 10 * 1024 * 1024)") + '</div>');
        el.appendChild(box);
        function mb() { var v = +box.querySelector('#bs').value; return Math.pow(10, v / 100 * 5 - 1); }
        function fmt(x) { return x < 1 ? (x * 1024).toFixed(0) + ' KB' : x < 1024 ? x.toFixed(x < 10 ? 1 : 0) + ' MB' : (x / 1024).toFixed(1) + ' GB'; }
        function draw() {
          var m = mb(), mem = m * 3, frac = mem / (16 * 1024);
          box.querySelector('#bsl').textContent = fmt(m) + ' on disk';
          var state = frac > 0.6 ? 'oom' : frac > 0.02 ? 'full' : 'full';
          box.querySelector('#bcl').innerHTML = clusterHtml({ driver: '<span class="small">holds a copy too</span>', ex: ['', '', '', ''], mem: [state, state, state, state],
            memtxt: [0, 1, 2, 3].map(function () { return '≈ ' + fmt(mem) + ' in memory'; }) });
          var v = box.querySelector('#bv');
          if (m <= 10) { v.className = 'verdict good'; v.innerHTML = '<b>Broadcast hash join</b> already at planning time: the estimate is under <span class="mono">spark.sql.autoBroadcastJoinThreshold</span> (10 MB by default in Apache Spark).'; }
          else if (m <= 1024) { v.className = 'verdict warn'; v.innerHTML = 'Planned as a <b>sort-merge join</b>. It can still become a broadcast join: <b>AQE</b> may switch at runtime if the measured size after filters is small, or you can add a <b>BROADCAST hint</b>. Note: in memory the hash table is often several times bigger than the compressed Parquet files.'; }
          else if (m <= 8192) { v.className = 'verdict bad'; v.innerHTML = 'Sort-merge join. A BROADCAST hint here risks <b>out-of-memory</b> errors on the driver and the executors, and broadcast timeouts. Shuffle both sides instead.'; }
          else { v.className = 'verdict bad'; v.innerHTML = 'Impossible: Spark refuses to broadcast more than <b>8 GB</b>. Sort-merge (or shuffled hash) join.'; }
        }
        box.querySelector('#bs').oninput = draw; draw();
      },
      function (el) {
        el.appendChild(h(title('Which side can be <em>built</em>?', 'The build side must be complete in every task. For outer joins, the side whose unmatched rows must be kept cannot be the build side.') +
          '<table class="tbl" style="max-width:820px"><tr><th>Join type</th><th>Can broadcast</th><th>Why</th></tr>' +
          '<tr><td>INNER</td><td>either side (the smaller)</td><td>only matches are returned</td></tr>' +
          '<tr><td>LEFT OUTER</td><td>right side only</td><td>every left row streams through and is kept even without a match</td></tr>' +
          '<tr><td>RIGHT OUTER</td><td>left side only</td><td>mirror image of LEFT OUTER</td></tr>' +
          '<tr><td>LEFT SEMI / LEFT ANTI</td><td>right side only</td><td>the right side is just a lookup set</td></tr>' +
          '<tr><td>FULL OUTER</td><td>no</td><td>unmatched rows from both sides are needed: Spark uses a shuffle join</td></tr></table>' +
          '<div class="callout sk thin">So a small table on the <b>left</b> of a LEFT JOIN cannot be broadcast. Swapping to a RIGHT JOIN (same meaning) can unlock it.</div>'));
      },
      function (el) {
        el.appendChild(h(title('When “tiny” is <em>not tiny</em>') + '<div class="cols"><div>' + list([
          '-<b>Stale or missing statistics</b>: the table grew, the estimate did not. Fix: <span class="mono">ANALYZE TABLE … COMPUTE STATISTICS</span>.',
          '-<b>A filter Spark cannot estimate</b> (a UDF, a complex expression) makes a big side look small, or the other way round.',
          '-<b>Driver or executor out of memory</b>: every copy lives in memory for the whole join.',
          '-<b>Broadcast timeout</b> (<span class="mono">spark.sql.broadcastTimeout</span>, 300 s by default) when building the table takes too long.']) + '</div><div>' + list([
          '+Prefer letting AQE decide with real sizes over hard-coded hints.', '+Use the hint only for tables you know stay small (dimensions, lookup tables).',
          '+To stop a broadcast for one query: hint <span class="mono">/*+ MERGE(p) */</span> or <span class="mono">/*+ SHUFFLE_HASH(p) */</span>.',
          '+Check the query profile: a huge BroadcastExchange is a red flag.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'bhj', q: 'Orders (2 TB) LEFT JOIN products (3 MB). Which side can be broadcast?',
          options: ['Orders, because it is on the left', 'Products, the right side: every order row streams through and is kept even without a match', 'Neither: outer joins never use broadcast', 'Both, Spark broadcasts both sides'],
          correct: 1, why: 'For a LEFT OUTER join the right side is the build side. Products is small and on the right, so this is a textbook broadcast hash join.' }));
      }
    ]
  });

  // ------------------------------------------------------------------ 7 ── sort-merge join
  var LKEYS = [3, 7, 1, 4, 7, 2, 6, 1, 5, 3], RKEYS = [1, 2, 3, 4, 5, 6, 7, 8];
  function keyHtml(k, side) { return '<span class="key ' + side + ' k' + (k % 4) + '">' + k + '</span>'; }
  SC.push({
    id: 'smj', icon: '🔀', title: 'Sort-merge join (and shuffled hash join)', sub: 'Shuffle both sides by the key, sort each partition, walk the two sorted lists together.',
    thumb: '<span class="tag">Exchange</span>→<span class="tag">Sort</span>→<span class="tag">SortMergeJoin</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Two <em>big</em> tables', 'Orders (2 billion rows) joins customers (50 million rows). Neither fits in memory on every executor, so nothing can be broadcast. The default for big equi-joins is the sort-merge join.') +
          '<div class="cols"><div>' + pre("SortMergeJoin [customer_id], [id], Inner\n:- Sort [customer_id ASC]\n:  +- Exchange hashpartitioning(customer_id, 200)\n:     +- Scan parquet orders\n+- Sort [id ASC]\n   +- Exchange hashpartitioning(id, 200)\n      +- Scan parquet customers",
            ['SortMergeJoin', 'Sort [customer_id ASC]', 'Sort [id ASC]', 'Exchange hashpartitioning(customer_id, 200)', 'Exchange hashpartitioning(id, 200)']) + '</div><div>' +
          list(['<b>1. Shuffle</b> (Exchange): rows of both tables go to partition <span class="mono">hash(key) mod N</span>, so equal keys meet in the same task.', '<b>2. Sort</b> each partition by the key.',
            '<b>3. Merge</b>: walk both sorted lists at once, like merging two sorted decks of cards.', 'It works for any size: sorted data can spill to disk.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('Step 1: <em>shuffle</em> both sides', 'Colour = <span class="mono">key mod 4</span> = the partition the row is sent to. Both sides use the same rule, so matching keys land together.') +
          '<div class="cols"><div><div class="note">orders · customer_id</div><div id="ls"></div><div class="note mt">customers · id</div><div id="rs"></div></div><div class="lanes" id="ln"></div></div>' +
          '<div class="row mt"><button class="btn acc" id="sh">▶ Shuffle</button><button class="btn" id="so" disabled>▶ Sort each partition</button></div><div class="verdict" id="sv">Before the shuffle: rows sit wherever they were read.</div>');
        el.appendChild(box);
        var stage = 0;
        function draw() {
          box.querySelector('#ls').innerHTML = stage ? '<span class="small">(sent)</span>' : LKEYS.map(function (k) { return keyHtml(k, 'L'); }).join('');
          box.querySelector('#rs').innerHTML = stage ? '<span class="small">(sent)</span>' : RKEYS.map(function (k) { return keyHtml(k, 'R'); }).join('');
          box.querySelector('#ln').innerHTML = [0, 1, 2, 3].map(function (p) {
            var l = LKEYS.filter(function (k) { return k % 4 === p; }), r = RKEYS.filter(function (k) { return k % 4 === p; });
            if (stage === 2) { l = l.slice().sort(function (a, b) { return a - b; }); r = r.slice().sort(function (a, b) { return a - b; }); }
            return '<div class="lane"><h6>partition ' + p + '</h6>' + (stage ? l.map(function (k) { return keyHtml(k, 'L'); }).join('') + '<br>' + r.map(function (k) { return keyHtml(k, 'R'); }).join('') : '') + '</div>';
          }).join('');
        }
        draw();
        box.querySelector('#sh').onclick = function () { stage = 1; draw(); box.querySelector('#so').disabled = false; var v = box.querySelector('#sv'); v.className = 'verdict warn'; v.innerHTML = 'Every row crossed the network and was written to shuffle files: this is the expensive part. All keys 3 and 7 are now in partition 3.'; };
        box.querySelector('#so').onclick = function () { stage = 2; draw(); var v = box.querySelector('#sv'); v.className = 'verdict good'; v.innerHTML = 'Each task sorts only its own partition. Now both sides of every partition are in key order, ready to merge.'; };
      },
      function (el) {
        var L = [1, 1, 3, 4, 4, 7], R = [1, 2, 3, 4, 6, 7];
        var box = h(title('Step 2: <em>merge</em> with two pointers', 'One partition, both sides sorted. Compare the two current keys: equal → output, smaller → move that pointer.') +
          '<div class="merge"><b>orders</b><div class="seq" id="ml"></div><b>customers</b><div class="seq" id="mr"></div></div>' +
          '<div class="hashcalc mt" id="mc">press “Next comparison”</div><div class="row mt"><button class="btn acc" id="mn">Next comparison</button><button class="btn" id="mreset">↺</button></div>' +
          '<div class="outrows card sk thin mt" id="mo"></div>');
        el.appendChild(box);
        var i, j, out, matched;
        function reset() { i = 0; j = 0; out = []; matched = {}; draw(); box.querySelector('#mc').innerHTML = 'press “Next comparison”'; }
        function draw() {
          box.querySelector('#ml').innerHTML = L.map(function (k, x) { return '<span class="' + (x === i ? 'p' : '') + (matched['L' + x] ? ' m' : '') + '">' + k + '</span>'; }).join('');
          box.querySelector('#mr').innerHTML = R.map(function (k, x) { return '<span class="' + (x === j ? 'p' : '') + (matched['R' + x] ? ' m' : '') + '">' + k + '</span>'; }).join('');
          box.querySelector('#mo').innerHTML = out.length ? out.join('') : '<span class="small">matches appear here</span>';
        }
        box.querySelector('#mn').onclick = function () {
          if (i >= L.length || j >= R.length) { box.querySelector('#mc').innerHTML = 'One side is finished: nothing more can match. Done, each row was read only once.'; return; }
          var a = L[i], b = R[j], c = box.querySelector('#mc');
          if (a === b) { out.push('<div>✓ order key ' + a + ' ↔ customer ' + b + '</div>'); matched['L' + i] = matched['R' + j] = 1; c.innerHTML = a + ' = ' + b + ' → <b style="color:var(--green)">match</b>, move the orders pointer (the next order may have the same key)'; i++; if (i < L.length && L[i] !== b) j++; }
          else if (a < b) { c.innerHTML = a + ' &lt; ' + b + ' → no customer ' + a + ' can come later: move the <b>orders</b> pointer'; i++; }
          else { c.innerHTML = a + ' &gt; ' + b + ' → move the <b>customers</b> pointer'; j++; }
          draw();
        };
        box.querySelector('#mreset').onclick = reset;
        reset();
      },
      function (el) {
        el.appendChild(h(title('Cost, and its cousin: <em>shuffled hash join</em>') + '<div class="cmp" style="--n:2">' +
          '<div class="card sk"><h4>🔀 Sort-merge join</h4>' + list(['+Scales to any size: sorting spills to disk instead of failing.', '-Two shuffles (both sides) and two sorts.', '-Skew: one hot key makes one huge partition (AQE can split it).']) + '</div>' +
          '<div class="card sk alt"><h4>🧮 Shuffled hash join</h4>' + list(['Same shuffle of both sides.', '+No sort: builds a hash table from the smaller side <b>of each partition</b>.', '-Each partition’s build side must fit in memory.', 'Photon and AQE often pick it when partitions are small enough.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('How Spark <em>picks</em> a join strategy', 'Change the inputs and follow the decision.') +
          '<div class="row"><label class="toggle"><input type="checkbox" id="eq" checked><span class="sw"></span>equi-join (a = b)</label>' +
          '<span>hint: <select id="hint"><option value="">none</option><option>BROADCAST</option><option>MERGE</option><option>SHUFFLE_HASH</option></select></span></div>' +
          '<div class="slider mt">Smaller side: <input type="range" id="ss" min="0" max="100" value="60"><b id="ssl"></b></div><div class="plan mt" id="path"></div><div class="verdict" id="pv"></div>' +
          '<div class="mt">' + pre("SELECT /*+ BROADCAST(c) */    …   -- broadcast hash join\nSELECT /*+ MERGE(c) */        …   -- sort-merge join\nSELECT /*+ SHUFFLE_HASH(c) */ …   -- shuffled hash join\nSELECT /*+ SHUFFLE_REPLICATE_NL(c) */ … -- nested loop (rarely a good idea)") + '</div>');
        el.appendChild(box);
        function mb() { var v = +box.querySelector('#ss').value; return Math.pow(10, v / 100 * 5 - 1); }
        function draw() {
          var m = mb(), eq = box.querySelector('#eq').checked, hint = box.querySelector('#hint').value, steps = [], res;
          box.querySelector('#ssl').textContent = m < 1024 ? m.toFixed(m < 10 ? 1 : 0) + ' MB' : (m / 1024).toFixed(1) + ' GB';
          if (!eq) { steps.push(['Equi-join?', 'no → hash and sort-merge joins need equality keys']); res = m <= 10 ? 'BroadcastNestedLoopJoin' : 'BroadcastNestedLoopJoin or CartesianProduct (slow!)'; }
          else if (hint) { steps.push(['Equi-join?', 'yes']); steps.push(['Hint?', hint + ' → Spark follows it if it can']); res = hint === 'BROADCAST' ? (m > 8192 ? 'fails: cannot broadcast more than 8 GB' : 'BroadcastHashJoin') : hint === 'MERGE' ? 'SortMergeJoin' : 'ShuffledHashJoin'; }
          else {
            steps.push(['Equi-join?', 'yes']); steps.push(['Hint?', 'none']);
            if (m <= 10) { steps.push(['Smaller side below the broadcast threshold?', 'yes (estimate ≤ 10 MB)']); res = 'BroadcastHashJoin'; }
            else { steps.push(['Smaller side below the broadcast threshold?', 'no']); steps.push(['Prefer sort-merge (default)?', 'yes → SortMergeJoin; AQE may still switch to broadcast or shuffled hash at runtime']); res = 'SortMergeJoin'; }
          }
          box.querySelector('#path').innerHTML = steps.map(function (s, i) { return '<div class="pn' + (i ? '' : ' root') + '" style="margin-left:' + i * 22 + 'px"><span class="op">' + s[0] + '</span><span class="arg">' + s[1] + '</span></div>'; }).join('');
          var v = box.querySelector('#pv'); v.className = 'verdict ' + (/fails|Cartesian/.test(res) ? 'bad' : 'good'); v.innerHTML = '→ <b>' + res + '</b>';
        }
        ['#eq', '#hint', '#ss'].forEach(function (s) { box.querySelector(s).oninput = draw; box.querySelector(s).onchange = draw; }); draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'smj', q: 'Why does a sort-merge join shuffle <b>both</b> tables?',
          options: ['To sort the data globally', 'So that rows with the same key end up in the same partition, on the same task', 'Because Parquet files must be rewritten', 'It does not: only the bigger table is shuffled'],
          correct: 1, why: 'Both sides are hash-partitioned on the join key with the same number of partitions. Equal keys meet in the same task, which then sorts and merges its partition locally.' }));
      }
    ]
  });

  // ------------------------------------------------------------------ 8 ── query profile and Spark UI
  var OPS = [
    { t: 'Scan orders', m: 'rows 41.2 M · files read 120 / pruned 9,880', ph: 1, heat: 38, d: [['Time spent', '38 %'], ['Rows output', '41.2 M'], ['Files read', '120'], ['Files pruned', '9,880'], ['Bytes read', '9.1 GB'], ['Size of files pruned', '1.9 TB']],
      tip: 'Look at <b>files pruned vs read</b> and <b>bytes read</b>. Little pruning on a selective filter → cluster the table on that column.' },
    { t: 'Filter', m: 'rows 41.2 M → 6.3 M', ph: 1, heat: 4, d: [['Time spent', '4 %'], ['Rows in', '41.2 M'], ['Rows out', '6.3 M']], tip: 'A filter that removes most rows <b>after</b> the scan means the filter could not be pushed into the scan or used for skipping.' },
    { t: 'Shuffle (Exchange)', m: 'hashpartitioning(customer_id) · 2.4 GB written', ph: 1, heat: 21, d: [['Time spent', '21 %'], ['Bytes written', '2.4 GB'], ['Partitions', '200 → 37 (AQE coalesced)'], ['Spill to disk', '0 B']],
      tip: 'Shuffles are the network + disk step. Big shuffle bytes → filter or aggregate earlier, or broadcast the other side. Watch <b>spill</b>.' },
    { t: 'Hash join', m: 'BroadcastHashJoin (AQE switched)', ph: 1, heat: 14, d: [['Time spent', '14 %'], ['Rows output', '6.3 M'], ['Build side size', '4 MB'], ['Peak memory', '310 MB']],
      tip: 'Check the strategy and the row count. Rows exploding after a join = a many-to-many key you did not expect.' },
    { t: 'Aggregate', m: 'keys=[region] · 6 rows', ph: 1, heat: 9, d: [['Time spent', '9 %'], ['Rows output', '6']], tip: 'Partial and final aggregation around a shuffle is normal.' },
    { t: 'Python UDF', m: 'not supported by Photon', ph: 0, heat: 14, d: [['Time spent', '14 %'], ['Rows', '6.3 M']], tip: 'Non-Photon operators show up without the Photon tag. A Python UDF in the middle of a plan breaks vectorization: try built-in functions.' }
  ];
  SC.push({
    id: 'profile', icon: '🔍', title: 'Where do I see it? Query profile and Spark UI', sub: 'Serverless and SQL warehouses: Query History. Classic compute: the Spark UI.',
    thumb: '<span class="tag">Query History</span><span class="tag">Query profile</span><span class="tag">Spark UI</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Where is my query?', 'It depends on the compute that ran it.') + '<div class="cmp" style="--n:2">' +
          '<div class="card sk"><h4>☁️ Serverless and SQL warehouses</h4>' + list(['<b>Query History</b> (left sidebar): every query, its duration, status, compute and user.', 'Click a query → <b>query profile</b>: the operator graph with time, rows and bytes.',
            'From a notebook on serverless: the cell result has a <b>See performance</b> link to the same profile.', 'There is no Spark UI on serverless: the query profile replaces it.']) + '</div>' +
          '<div class="card sk alt"><h4>🖥️ Classic compute (clusters)</h4>' + list(['<b>Compute</b> → your cluster → <b>Spark UI</b>.', 'From a notebook cell: expand <b>Spark Jobs</b> under the cell and open the job.',
            'Tabs: Jobs, Stages, Storage, Environment, Executors, <b>SQL / DataFrame</b> (the plan with metrics).', 'The Spark UI of a recently terminated cluster can still be opened from the compute page.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('A query profile, <em>operator by operator</em>', 'Click an operator. The orange line under each one is its share of the total time.') +
          '<div class="qp"><div class="qpwin"><div class="qphead"><span><b>12.8 s</b>total wall-clock</span><span><b>9.1 GB</b>bytes read</span><span><b>120 / 10,000</b>files read</span><span><b>86 %</b>Photon</span><span><b>0 B</b>spilled</span></div><div class="qpgraph" id="qg"></div></div>' +
          '<div class="qpside" id="qs"><h4>👈 pick an operator</h4><p>Read the profile from the bottom (the scans) to the top (the result).</p></div></div>');
        el.appendChild(box);
        var order = [4, 3, 5, 2, 1, 0];
        box.querySelector('#qg').innerHTML = '<div class="qpop" style="cursor:default"><div class="t">Result</div><div class="m">6 rows</div></div>' + order.map(function (i) {
          var o = OPS[i]; return '<div class="qpline"></div><div class="qpop" data-i="' + i + '"><div class="t">' + o.t + '</div><div class="m">' + o.m + '</div>' + (o.ph ? '<span class="ph">PHOTON</span>' : '') + '<span class="heat" style="width:' + o.heat * 2 + '%"></span></div>';
        }).join('');
        box.querySelectorAll('.qpop[data-i]').forEach(function (n) {
          n.onclick = function () {
            box.querySelectorAll('.qpop').forEach(function (x) { x.classList.remove('sel'); }); n.classList.add('sel');
            var o = OPS[+n.dataset.i];
            box.querySelector('#qs').innerHTML = '<h4>' + o.t + (o.ph ? ' · Photon' : ' · not Photon') + '</h4><table>' + o.d.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table><div class="tip">💡 ' + o.tip + '</div>';
          };
        });
      },
      function (el) {
        var tabs = {
          Jobs: '<p>One <b>job</b> per action (a write, a display, a count). Duration and number of stages per job.</p><table><tr><th>Job</th><th>Description</th><th>Stages</th><th>Duration</th></tr><tr><td>14</td><td>save at orders_silver</td><td>3/3</td><td>48 s</td></tr><tr><td>13</td><td>display at cell 7</td><td>2/2</td><td>6 s</td></tr></table>',
          Stages: '<p>A <b>stage</b> is cut at every shuffle. Open one and compare task durations: <b>min / median / max</b>.</p><table><tr><th>Metric</th><th>Min</th><th>Median</th><th>Max</th></tr><tr><td>Duration</td><td>0.4 s</td><td>1.1 s</td><td style="color:#c5221f"><b>38 s</b></td></tr><tr><td>Shuffle read</td><td>12 MB</td><td>31 MB</td><td style="color:#c5221f"><b>1.9 GB</b></td></tr><tr><td>Spill (disk)</td><td>0</td><td>0</td><td style="color:#c5221f"><b>1.2 GB</b></td></tr></table><p>Max ≫ median = <b>skew</b>: one key holds most of the data.</p>',
          Storage: '<p>Cached DataFrames and tables (classic compute). Empty on most modern workloads: Delta + disk cache does the job.</p>',
          Environment: '<p>All Spark settings of the cluster, e.g. <span class="mono">spark.sql.shuffle.partitions</span>, <span class="mono">spark.sql.adaptive.enabled = true</span>.</p>',
          Executors: '<p>Per executor: cores, memory, tasks, <b>GC time</b>, shuffle read/write. High GC time = memory pressure.</p>',
          'SQL / DataFrame': '<p>The executed plan as a graph, with rows and time on every operator: the same information as the query profile. Look for <b>AdaptiveSparkPlan isFinalPlan=true</b>, Exchanges, the join type and <b>number of files read</b> in the scans.</p>'
        };
        var box = h(title('The Spark UI on <em>classic compute</em>', 'Click the tabs. The most useful two: <b>Stages</b> for skew and spill, <b>SQL / DataFrame</b> for the plan.') +
          '<div class="sparkui"><div class="nav" id="sn"></div><div class="pane" id="sp"></div></div>');
        el.appendChild(box);
        var cur = 'Stages';
        function draw() {
          box.querySelector('#sn').innerHTML = Object.keys(tabs).map(function (k) { return '<span class="' + (k === cur ? 'on' : '') + '" data-k="' + k + '">' + k + '</span>'; }).join('');
          box.querySelectorAll('#sn span').forEach(function (s) { s.onclick = function () { cur = s.dataset.k; draw(); }; });
          box.querySelector('#sp').innerHTML = tabs[cur];
        }
        draw();
      },
      function (el) {
        el.appendChild(h(title('What to look for') + '<table class="tbl"><tr><th>Symptom</th><th>Where you see it</th><th>Usual fix</th></tr>' +
          '<tr><td>Reads almost all files</td><td>Scan: files pruned ≈ 0</td><td>Cluster by the filter column (liquid clustering), OPTIMIZE</td></tr>' +
          '<tr><td>Huge shuffle</td><td>Exchange: GBs written</td><td>Filter/aggregate earlier, broadcast the small side</td></tr>' +
          '<tr><td>One slow task</td><td>Stage: max ≫ median</td><td>Skew: AQE skew join, salting, fix the hot key</td></tr>' +
          '<tr><td>Spill to disk</td><td>Stage / operator: spill bytes</td><td>Fewer rows per task, more partitions, less data per shuffle</td></tr>' +
          '<tr><td>Many tiny files or tasks</td><td>Scan: thousands of files, tiny tasks</td><td>OPTIMIZE, auto compaction</td></tr>' +
          '<tr><td>Not Photon</td><td>Operators without the Photon tag</td><td>Replace Python UDFs with built-in functions</td></tr></table>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'profile', q: 'A colleague ran a slow query from a notebook on <b>serverless</b> compute. Where do you look first?',
          options: ['The Spark UI of the cluster', 'Query History → the query profile (or “See performance” under the cell)', 'The driver logs', 'DESCRIBE HISTORY of the table'],
          correct: 1, why: 'Serverless has no Spark UI. The query profile in Query History shows the operators with time, rows, files read and pruned, spill and Photon coverage.' }));
      }
    ]
  });

  // ------------------------------------------------------------------ 9 ── Photon
  SC.push({
    id: 'photon', icon: '⚡', title: 'Photon', sub: 'A vectorized engine written in C++: whole batches of a column at once.',
    thumb: '<span style="font-size:48px">⚡</span><span class="tag" style="margin-left:6px">PhotonScan · PhotonGroupingAgg</span>',
    steps: [
      function (el) {
        var box = h(title('Row by row vs a <em>batch at a time</em>', 'Same job: add 64 values. The classic engine handles one row per step; Photon takes a batch of values from one column and processes it in a tight loop that the CPU can vectorize.') +
          '<div class="race2"><span>JVM, row at a time</span><div class="vec" id="v1"></div><b id="t1">0</b></div><div class="race2"><span>Photon, vectorized</span><div class="vec ph" id="v2"></div><b id="t2">0</b></div>' +
          '<div class="row"><button class="btn acc" id="rgo">▶ Race</button><span class="small">numbers on the right: steps taken (illustration, not a benchmark)</span></div>');
        el.appendChild(box);
        function cells(id) { box.querySelector(id).innerHTML = Array.from({ length: 64 }, function (_, i) { return '<span>' + i + '</span>'; }).join(''); }
        cells('#v1'); cells('#v2');
        box.querySelector('#rgo').onclick = function () {
          cells('#v1'); cells('#v2');
          var a = 0, b = 0, s1 = 0, s2 = 0, c1 = box.querySelectorAll('#v1 span'), c2 = box.querySelectorAll('#v2 span');
          var t = setInterval(function () {
            if (a < 64) { c1[a].classList.add('on'); a++; s1++; box.querySelector('#t1').textContent = s1; }
            if (b < 64) { for (var k = 0; k < 8 && b < 64; k++, b++) c2[b].classList.add('on'); s2++; box.querySelector('#t2').textContent = s2; }
            if (a >= 64) clearInterval(t);
          }, 60);
        };
      },
      function (el) {
        el.appendChild(h(title('Where Photon runs, and where it <em>does not</em>') + '<div class="cols"><div>' + list([
          'On by default on <b>SQL warehouses</b> and <b>serverless</b> compute; on classic clusters you choose a Photon-enabled setup.',
          'In plans and profiles its operators are named <span class="mono">Photon…</span> (PhotonScan, PhotonGroupingAgg, PhotonShuffleExchangeSink…).',
          'Best for: scans, filters, joins, aggregations on big data, Delta writes and MERGE.',
          'Same SQL and DataFrame code: nothing to change in your queries.']) + '</div><div>' + list([
          '-Not everything is supported: Python UDFs and some functions run in the classic engine.',
          '-A non-Photon operator in the middle of a plan means data is converted back and forth between the engines.',
          '+The query profile shows the share of time spent in Photon; aim for close to 100 %.',
          '+Fix: built-in functions or SQL instead of Python UDFs.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'photon', q: 'The query profile shows most operators as Photon, but one Python UDF operator in the middle. What does that mean?',
          options: ['Nothing, it is just a label', 'That part runs outside Photon; data is handed between engines, which costs time', 'The whole query ran without Photon', 'Photon is switched off for the workspace'],
          correct: 1, why: 'Photon runs the operators it supports. Unsupported ones (like Python UDFs) fall back to the classic engine, with a conversion around them. Replacing the UDF with built-ins usually keeps the whole plan in Photon.' }));
      }
    ]
  });

  // ------------------------------------------------------------------ 10 ── recap
  SC.push({
    id: 'recap', icon: '🏁', title: 'The checklist', sub: 'Everything on this board, as a list you can tick off for your next slow query.',
    thumb: '<span style="font-size:46px">✅</span>',
    steps: [function (el, api) {
      var items = ['Find the query: Query History (serverless, warehouses) or the Spark UI (classic).', 'Scan: how many files were pruned? If few, cluster by the filter column and OPTIMIZE.',
        'Are there many small files? OPTIMIZE / auto compaction / predictive optimization.', 'Shuffles: can you filter or aggregate before the join?',
        'Join strategy: is a small side broadcast? Are table statistics fresh (ANALYZE TABLE)?', 'Skew: max task time ≫ median? Let AQE split it or fix the hot key.',
        'Spill: too much data per task?', 'Photon: is every operator Photon? Replace Python UDFs.', 'Only then: bigger or different compute.'];
      var sc = api.score();
      el.appendChild(h(title('Your <em>slow query</em> checklist') + '<div class="check">' + items.map(function (t) { return '<label><input type="checkbox"> ' + t + '</label>'; }).join('') + '</div>' +
        '<div class="row mt"><span class="note">Your score: ' + sc[0] + ' / ' + sc[1] + '</span><a class="btn" href="../../" style="text-decoration:none">📚 Lessons</a><a class="btn" href="../delta-storyboard/" style="text-decoration:none">🗺️ Delta Lake storyboard</a></div>'));
    }]
  });
})();
