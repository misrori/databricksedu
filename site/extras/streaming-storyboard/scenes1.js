/* Streaming storyboard, part 1: the unbounded table, micro-batches and the checkpoint, triggers,
   stateless vs stateful, event time vs processing time, window types. One small simulator per frame. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var E = window.StreamEngine, fmt = E.fmt;
  var SC = window.STREAM_SCENES = [];

  // ---------------------------------------------------------------- shared helpers (also used by part 2 and the lab)
  function code(src, lang) {
    var s = esc(src).replace(/(#[^\n]*|--[^\n]*)/g, '<span class="cm">$1</span>');
    if (lang !== 'sql') s = s.replace(/("[^"\n]*")(?![^<]*<\/span>)/g, '<span class="st">$1</span>');
    s = s.replace(/\b(from|import|def|return|True|False|None|lambda|for|in|if|else|SELECT|FROM|GROUP BY|WHERE|STREAM|CREATE|OR|REFRESH|TABLE|AS)\b(?![^<]*<\/span>)/g, '<span class="kw">$1</span>');
    return '<pre class="code">' + s + '</pre>';
  }
  function seg(name, opts, cur) {
    return '<span class="segb" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button data-v="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' class="on"' : '') + (o[2] ? ' disabled' : '') + '>' + o[1] + '</button>';
    }).join('') + '</span>';
  }
  function onSeg(box, name, fn) {
    box.querySelectorAll('[data-seg="' + name + '"] button').forEach(function (b) {
      b.onclick = function () {
        box.querySelectorAll('[data-seg="' + name + '"] button').forEach(function (x) { x.classList.toggle('on', x === b); });
        fn(b.dataset.v);
      };
    });
  }
  function wtbl(rows, opt) {
    opt = opt || {};
    if (!rows.length) return '<div class="empty">' + (opt.empty || 'nothing') + '</div>';
    return '<table class="dt2 mini"><tr><th>window</th>' + (opt.key ? '<th>key</th>' : '') + '<th>count</th></tr>' + rows.map(function (r) {
      return '<tr class="' + (opt.hl && opt.hl(r) ? 'hl fresh' : '') + '"><td>' + E.wlabel(r) + '</td>' + (opt.key ? '<td>' + esc(r.key) + '</td>' : '') + '<td class="num"><b>' + r.count + '</b></td></tr>';
    }).join('') + '</table>';
  }
  function evc(e, cls, extra) { return '<span class="evc ' + (cls || '') + '">' + fmt(e.et) + (extra ? ' <small>' + extra + '</small>' : '') + '</span>'; }
  function tryLab(label, cfg) {
    return '<div class="row mt"><button class="btn acc" data-lab="' + esc(JSON.stringify(cfg || {})) + '">🧪 ' + (label || 'Try it in the stream lab') + ' →</button></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lab]');
    if (!b || !window.SB) return;
    try { window.StreamLabPreset = JSON.parse(b.dataset.lab || '{}'); } catch (x) { window.StreamLabPreset = {}; }
    window.SB.openScene('lab');
  });
  window.SSB = { code: code, seg: seg, onSeg: onSeg, wtbl: wtbl, evc: evc, tryLab: tryLab };

  // ════════════════════════════════════════════════════════════════ 1 ── the unbounded table
  var STORES = ['Budapest', 'Vienna', 'Prague'];
  function order(i) { var r = (i * 7919 + 13) % 97; return { id: 1000 + i, store: STORES[(i * 5 + (i >> 1)) % 3], amount: 10 + (r % 9) * 10 }; }
  SC.push({
    id: 'table', icon: '♾️', title: 'A stream is a table that keeps growing', sub: 'New events are new rows. You write the query once, as if the table were complete.',
    thumb: '<div class="th-rows"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i class="n"></i><i class="n"></i><i class="n"></i><i class="n"></i></div>',
    steps: [
      function (el) {
        var box = h(title('New event = <em>one more row</em>', 'Press the button. Every order is appended to the input table. The same GROUP BY gives a new answer, but Spark only reads the new rows: the old counts are remembered.') +
          '<div class="row"><button class="btn acc" id="t1">🛒 one new order</button><button class="btn" id="t5">+ 5 orders</button><button class="btn" id="t0">↺ empty</button><span class="kv">rows so far <b id="tn">0</b></span><span class="kv">rows read in the last batch <b id="tr">0</b></span></div>' +
          '<div class="grid2 mt"><div><div class="note">input table: orders (unbounded)</div><div class="slwrap" style="max-height:300px;overflow:auto"><table class="dt2 mini" id="tin"></table></div></div>' +
          '<div><div class="note">result: SELECT store, count(*), sum(amount)</div><table class="dt2 mini" id="tout"></table>' +
          code('# the same query, batch or streaming\n(spark.readStream.table("orders")      # read → readStream\n   .groupBy("store")\n   .agg(count("*"), sum("amount")))', 'py') + '</div></div>');
        el.appendChild(box);
        var n = 0, last = 0, fresh = [];
        function draw() {
          var rows = []; for (var i = 0; i < n; i++) rows.push(order(i));
          box.querySelector('#tn').textContent = n; box.querySelector('#tr').textContent = last;
          box.querySelector('#tin').innerHTML = '<tr><th>order_id</th><th>store</th><th>amount</th></tr>' + (rows.length ? rows.slice().reverse().map(function (r, k) {
            return '<tr class="' + (k < last ? 'fresh hl' : '') + '"><td>' + r.id + '</td><td>' + r.store + '</td><td class="num">' + r.amount + '</td></tr>';
          }).join('') : '<tr><td colspan="3" class="empty">no rows yet: the stream is waiting</td></tr>');
          var agg = {}; rows.forEach(function (r) { agg[r.store] = agg[r.store] || [0, 0]; agg[r.store][0]++; agg[r.store][1] += r.amount; });
          var touched = {}; rows.slice(n - last).forEach(function (r) { touched[r.store] = 1; });
          box.querySelector('#tout').innerHTML = '<tr><th>store</th><th>count</th><th>sum(amount)</th></tr>' + STORES.filter(function (s) { return agg[s]; }).map(function (s) {
            return '<tr class="' + (touched[s] ? 'fresh hl' : '') + '"><td>' + s + '</td><td class="num">' + agg[s][0] + '</td><td class="num">' + agg[s][1] + '</td></tr>';
          }).join('');
        }
        box.querySelector('#t1').onclick = function () { n++; last = 1; draw(); };
        box.querySelector('#t5').onclick = function () { n += 5; last = 5; draw(); };
        box.querySelector('#t0').onclick = function () { n = 0; last = 0; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Batch or stream: <em>the same DataFrame code</em>') + '<div class="cmp" style="--n:2">' +
          '<div class="card sk"><h4>📦 Batch</h4>' + list(['The input is <b>bounded</b>: what is in the table now.', 'The job reads everything, writes, and <b>ends</b>.', 'Run it again: it reads everything again.']) +
          code('df = spark.read.table("orders")\n(df.groupBy("store").count()\n   .write.mode("overwrite")\n   .saveAsTable("store_counts"))', 'py') + '</div>' +
          '<div class="card sk alt"><h4>♾️ Streaming</h4>' + list(['The input is <b>unbounded</b>: rows keep arriving.', 'The query <b>keeps running</b> (or stops when there is nothing left, with availableNow).', '+Each run reads only rows it has not read yet. The checkpoint remembers where it stopped.']) +
          code('df = spark.readStream.table("orders")\n(df.groupBy("store").count()\n   .writeStream.outputMode("complete")\n   .option("checkpointLocation", chk)\n   .toTable("store_counts"))', 'py') + '</div></div>' +
          '<div class="callout sk thin">Three new decisions come with streaming, and the rest of this board is about them: <b>when</b> to run (trigger), <b>what to remember</b> (state, windows, watermark) and <b>what to write</b> (output mode).</div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'table', q: 'A streaming query counts orders per store. 1,000,000 orders are already processed and 5 new ones arrive. What does the next micro-batch read from the source?',
          options: ['All 1,000,005 rows, then it recounts', 'Only the 5 new rows; the counts so far come from the state store', 'Nothing until the next full refresh', 'The last 1,000 rows'],
          correct: 1, why: 'A streaming query is incremental: the checkpoint records which input was read, and the running counts live in the state store. Each batch reads only the new rows and updates the stored counts.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 2 ── micro-batch and checkpoint
  var PH = [['plan', '📝 write offsets/N', 'Decide what this batch reads (source positions) and write it to offsets/N first.'],
    ['read', '📥 read', 'Read exactly that range from the source.'],
    ['proc', '⚙️ process', 'Run the transformations, update the state store.'],
    ['sink', '💾 write sink', 'Write the result. The Delta sink commits with this query id and batch number N.'],
    ['commit', '✅ write commits/N', 'Batch N is done. The next batch starts from here.']];
  SC.push({
    id: 'micro', icon: '🔁', title: 'Micro-batches and the checkpoint', sub: 'Five steps per batch. Crash anywhere and restart: nothing is lost, nothing is written twice.',
    thumb: '<div class="th-flow" style="font-size:30px">📝→📥→⚙️→💾→✅</div>',
    steps: [
      function (el) {
        var box = h(title('Crash it, <em>then restart it</em>', 'Step through a batch. Press 💥 at any step, then ▶ restart. Watch the two checkpoint folders and the sink.') +
          '<div class="row"><button class="btn acc" id="mn">Next step →</button><button class="btn" id="mc">💥 crash now</button><button class="btn" id="mr" disabled>▶ restart</button>' +
          '<label class="toggle"><input type="checkbox" id="mi" checked><span class="sw"></span> idempotent sink (Delta)</label><button class="btn" id="m0">↺</button></div>' +
          '<div class="stepper" id="mst"></div><div class="ckpt"><div class="fold"><h5>📁 checkpoint/offsets/</h5><div id="mo"></div></div><div class="fold"><h5>📁 checkpoint/commits/</h5><div id="mco"></div></div>' +
          '<div class="fold"><h5>🔺 sink table</h5><div id="msk"></div></div></div><div class="verdict" id="mv">Batch 0 is about to start. Each batch reads 3 new files.</div>');
        el.appendChild(box);
        var st;
        function reset() { st = { b: 0, p: -1, offs: [], comm: [], sink: [], written: {}, down: false, msg: 'Batch 0 is about to start. Each batch reads 3 new files.', cls: '' }; }
        reset();
        function draw() {
          box.querySelector('#mst').innerHTML = PH.map(function (p, i) { return '<span class="' + (st.down && i === st.p ? 'boom' : i < st.p || (i === st.p && !st.down) ? 'done' : i === st.p + 1 && !st.down ? 'cur' : '') + '">' + p[1].replace('N', st.b) + '</span>'; }).join('');
          box.querySelector('#mo').innerHTML = st.offs.map(function (b) { return '<div class="f' + (b === st.b ? ' new' : '') + '">' + b + ' <small>→ files ' + (b * 3 + 1) + '–' + (b * 3 + 3) + '</small></div>'; }).join('') || '<div class="empty">empty</div>';
          box.querySelector('#mco').innerHTML = st.comm.map(function (b) { return '<div class="f">' + b + '</div>'; }).join('') + (st.offs.length > st.comm.length ? '<div class="f miss">' + st.offs[st.offs.length - 1] + ' <small>missing: batch not finished</small></div>' : '') || '<div class="empty">empty</div>';
          var dup = st.sink.length - new Set(st.sink).size;
          box.querySelector('#msk').innerHTML = '<div class="small" style="margin-top:0">' + st.sink.length + ' rows' + (dup ? ' · <b style="color:var(--drop)">' + dup + ' duplicates</b>' : '') + '</div>' +
            st.sink.slice(-9).map(function (r) { return '<span class="tag">' + r + '</span>'; }).join('');
          var v = box.querySelector('#mv'); v.className = 'verdict ' + st.cls; v.innerHTML = st.msg;
          box.querySelector('#mn').disabled = st.down; box.querySelector('#mc').disabled = st.down; box.querySelector('#mr').disabled = !st.down;
        }
        box.querySelector('#mn').onclick = function () {
          st.p++;
          var ph = PH[st.p][0];
          if (ph === 'plan') st.offs.push(st.b);
          if (ph === 'sink') {
            var idem = box.querySelector('#mi').checked;
            if (idem && st.written[st.b]) { st.msg = 'The Delta sink sees that batch ' + st.b + ' of this query is <b>already in its log</b>, so it skips the write.'; st.cls = 'good'; }
            else { for (var k = 1; k <= 3; k++) st.sink.push('f' + (st.b * 3 + k)); st.written[st.b] = true; st.msg = PH[st.p][2].replace('N', st.b); st.cls = ''; }
          } else { st.msg = PH[st.p][2].replace('N', st.b); st.cls = ''; }
          if (ph === 'commit') { st.comm.push(st.b); st.b++; st.p = -1; st.msg = 'Batch ' + (st.b - 1) + ' committed. Next: batch ' + st.b + '.'; st.cls = 'good'; }
          draw();
        };
        box.querySelector('#mc').onclick = function () {
          if (st.p < 0) { st.msg = 'Nothing is running between batches. Start the batch first (Next step), then crash it.'; st.cls = 'warn'; draw(); return; }
          st.down = true; st.msg = '💥 The driver died during <b>' + PH[st.p][1].replace('N', st.b) + '</b>. Press ▶ restart.'; st.cls = 'bad'; draw();
        };
        box.querySelector('#mr').onclick = function () {
          var hasOff = st.offs.indexOf(st.b) >= 0;
          st.down = false; st.p = hasOff ? 0 : -1;
          st.msg = hasOff ? '▶ Restart reads the checkpoint: offsets/' + st.b + ' exists but commits/' + st.b + ' does not. Batch ' + st.b + ' is <b>replayed with exactly the same files</b> (' + (st.b * 3 + 1) + '–' + (st.b * 3 + 3) + ').' : '▶ Restart: the last batch is committed, so a new batch starts.';
          st.cls = 'warn'; draw();
        };
        box.querySelector('#m0').onclick = function () { reset(); draw(); };
        box.querySelector('#mi').onchange = function () { reset(); draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('What lives in the <em>checkpoint</em>') + '<div class="cols"><div>' +
          '<table class="dt2 mini"><tr><th>folder / file</th><th>what it holds</th></tr>' +
          '<tr><td>metadata</td><td>the query id, the same across restarts</td></tr><tr><td>offsets/N</td><td>what batch N reads; written <b>before</b> it runs</td></tr>' +
          '<tr><td>commits/N</td><td>batch N finished; written <b>after</b> the sink</td></tr><tr><td>sources/</td><td>for file sources: files already seen</td></tr>' +
          '<tr><td>state/</td><td>the state store (counts, windows, keys) of stateful queries</td></tr></table>' +
          list(['+Same checkpoint after a restart or an upgrade: the query continues.', '-One checkpoint per query. Two queries sharing one corrupt each other.', '-Delete it or point to a new folder: it is a <b>new</b> query that reads the source from the start.']) + '</div>' +
          '<div>' + code('(df.writeStream\n   .option("checkpointLocation",\n           "/Volumes/main/shop/chk/orders_silver")\n   .trigger(availableNow=True)\n   .toTable("orders_silver"))', 'py') +
          '<div class="callout sk thin"><b>Exactly-once</b> = replayable source (files, Kafka, Delta) + offsets in the checkpoint + an idempotent sink (Delta). Turn the toggle off in the simulator to see why the third part matters.</div></div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'micro', q: 'A query crashes after the Delta sink wrote batch 12 but before commits/12 was written. What happens on restart with the same checkpoint?',
          options: ['Batch 12 is lost', 'Batch 12 is replayed from offsets/12 and the Delta sink skips it, because it already recorded batch 12 of this query', 'Batch 12 is written twice', 'The query starts from batch 0'],
          correct: 1, why: 'offsets/12 says exactly what batch 12 read, so it is replayed with the same input. The Delta sink stores the query id and batch number in its transaction log and ignores a batch it already committed.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 3 ── triggers on a time axis
  var ARR = [2, 3, 7, 12, 13, 14, 21, 29, 33, 34, 41, 47, 52, 58];
  var TRIG = [['default', 'default (no trigger)'], ['pt10', 'processingTime 10 s'], ['pt30', 'processingTime 30 s'], ['avail', 'availableNow (job every 30 s)'], ['rt', 'realTime']];
  var TEND = 70;
  function runTrigger(kind, slow, maxFiles) {
    var dur = function (n) { return slow ? 8 + 0.8 * n : 1.2 + 0.35 * n; };
    var batches = [], read = 0, on = [];
    function take(t, cap) { var rows = []; while (read < ARR.length && ARR[read] <= t && (!cap || rows.length < cap)) rows.push(ARR[read++]); return rows; }
    if (kind === 'rt') {
      batches.push({ s: 0, e: TEND, rows: ARR.slice(), rt: true, out: ARR.map(function (a) { return a + 0.05; }) });
      on.push([0, TEND]);
      return { batches: batches, on: on };
    }
    if (kind === 'avail') {
      [30, 62].forEach(function (start) {
        var t = start;
        for (;;) {
          var rows = take(start, maxFiles);
          if (!rows.length) break;
          var d = dur(rows.length); batches.push({ s: t, e: t + d, rows: rows }); t += d;
        }
        on.push([start, Math.max(start + 0.8, t)]);
      });
      return { batches: batches, on: on };
    }
    on.push([0, TEND]);
    var I = kind === 'pt10' ? 10 : kind === 'pt30' ? 30 : 0, t = 0;
    while (t < TEND) {
      var rows = take(t);
      if (rows.length) {
        var d = dur(rows.length); batches.push({ s: t, e: t + d, rows: rows });
        if (I) { var nextTick = (Math.floor(t / I) + 1) * I; t = Math.max(t + d, nextTick); if (t + 0 > nextTick && t === batches[batches.length - 1].e) batches[batches.length - 1].over = true; }
        else t = t + d;
      } else {
        if (I) t = (Math.floor(t / I) + 1) * I;
        else { if (read >= ARR.length) break; t = ARR[read]; }
      }
    }
    return { batches: batches, on: on };
  }
  SC.push({
    id: 'triggers', icon: '⏱️', title: 'Triggers: when does a batch run?', sub: 'The same 14 events, five triggers. Compare latency, the number of batches and how long compute must run.',
    thumb: '<div class="th-axis"><b style="left:20px;width:40px"></b><b style="left:100px;width:40px"></b><b style="left:180px;width:40px"></b><i style="left:10px"></i><i style="left:60px"></i><i style="left:120px"></i><i style="left:150px"></i></div>',
    steps: [
      function (el) {
        var box = h(title('Same events, <em>different triggers</em>', 'Each dot is a new file arriving. Orange boxes are micro-batches. The grey line goes from an event to the moment its result is written: that is its latency.') +
          '<div class="ctl"><label class="l">trigger</label>' + seg('trg', TRIG, 'pt10') + '</div>' +
          '<div class="ctl"><label class="toggle"><input type="checkbox" id="tslow"><span class="sw"></span> heavy batches (8 s + 0.8 s per file)</label>' +
          '<span id="tmf"><label class="l">maxFilesPerTrigger</label>' + seg('mf', [[0, 'not set'], [3, '3'], [1, '1']], 3) + '</span></div>' +
          '<div id="tsvg"></div><div class="row" id="tstat"></div><div class="verdict" id="tv"></div>');
        el.appendChild(box);
        var kind = 'pt10', mf = 3;
        var NOTES = {
          'default': 'No trigger set: the next batch starts <b>as soon as the previous one ends</b> and new data is there. Low latency, but compute runs all the time and you get many small batches.',
          pt10: 'A batch every 10 seconds. Events wait for the next tick, so latency is up to 10 s + batch time. Fewer, bigger batches. If a batch takes longer than 10 s, the next one starts <b>right after it</b> (turn on heavy batches).',
          pt30: 'A batch every 30 seconds: even fewer batches, higher latency. Cheaper per row, but the cluster still runs between ticks.',
          avail: 'A <b>scheduled job</b> (here every 30 s, in real life every hour or every night) starts the query. It processes everything that arrived, in several batches if maxFilesPerTrigger limits them, and then <b>stops</b>. Compute runs only during the job. The only trigger on serverless compute.',
          rt: '<b>Real-time mode</b>: one long-running batch, every event goes through as soon as it arrives. Latency in milliseconds, but the cluster runs all the time and needs enough task slots for every stage. Dedicated compute only.'
        };
        function draw() {
          var slow = box.querySelector('#tslow').checked, r = runTrigger(kind, slow, mf), W = 900, x0 = 90, x1 = W - 16, X = function (t) { return x0 + t / TEND * (x1 - x0); };
          var g = '';
          for (var t = 0; t <= TEND; t += 10) g += '<line class="tick" x1="' + X(t) + '" y1="18" x2="' + X(t) + '" y2="196"/><text class="tk" x="' + X(t) + '" y="214" text-anchor="middle">' + t + ' s</text>';
          g += '<text class="lane" x="4" y="44">events</text><text class="lane" x="4" y="104">batches</text><text class="lane" x="4" y="150">written</text><text class="lane" x="4" y="186">compute</text>';
          g += '<line class="ax" x1="' + x0 + '" y1="40" x2="' + x1 + '" y2="40"/><line class="ax" x1="' + x0 + '" y1="146" x2="' + x1 + '" y2="146"/>';
          r.on.forEach(function (o) { g += '<rect class="on" x="' + X(o[0]) + '" y="176" width="' + Math.max(3, X(o[1]) - X(o[0])) + '" height="14" rx="4"/>'; });
          var lat = [], out = {};
          r.batches.forEach(function (b, i) {
            if (b.rt) { g += '<rect class="bb rt" x="' + X(b.s) + '" y="84" width="' + (X(b.e) - X(b.s)) + '" height="34"/><text class="bbt" x="' + (X(b.s) + 8) + '" y="105">one long-running batch · each event is processed on arrival</text>'; b.rows.forEach(function (a, k) { out[a] = b.out[k]; }); return; }
            g += '<rect class="bb' + (b.over || (slow && kind.indexOf('pt') === 0 && b.e - b.s > (kind === 'pt10' ? 10 : 30)) ? ' slow' : '') + '" x="' + X(b.s) + '" y="84" width="' + Math.max(4, X(b.e) - X(b.s)) + '" height="34"/>';
            if (X(b.e) - X(b.s) > 26) g += '<text class="bbt" x="' + (X(b.s) + 4) + '" y="105">#' + i + '·' + b.rows.length + '</text>';
            b.rows.forEach(function (a) { out[a] = b.e; });
          });
          ARR.forEach(function (a) {
            var o = out[a];
            if (o !== undefined) { lat.push(o - a); g += '<path class="lk" d="M' + X(a) + ' 40 C ' + X(a) + ' 100, ' + X(o) + ' 90, ' + X(o) + ' 146"/><circle class="ev" cx="' + X(o) + '" cy="146" r="4" style="fill:#2f8a57"/>'; }
            g += '<circle class="ev' + (o === undefined ? ' ghost' : '') + '" cx="' + X(a) + '" cy="40" r="7"/>';
          });
          box.querySelector('#tsvg').innerHTML = '<svg class="tl" viewBox="0 0 ' + W + ' 222">' + g + '</svg>';
          var avg = lat.length ? lat.reduce(function (a, b) { return a + b; }, 0) / lat.length : 0, mx = lat.length ? Math.max.apply(null, lat) : 0;
          var onT = r.on.reduce(function (a, o) { return a + o[1] - o[0]; }, 0), nb = r.batches.length;
          var lf = function (v) { return kind === 'rt' ? '~50 ms' : v.toFixed(1) + ' s'; };
          box.querySelector('#tstat').innerHTML = '<span class="kv">batches <b>' + (kind === 'rt' ? '1 (long-running)' : nb) + '</b></span><span class="kv">avg latency <b>' + lf(avg) + '</b></span><span class="kv">worst latency <b>' + lf(mx) + '</b></span>' +
            '<span class="kv">compute running <b>' + Math.round(onT) + ' s of ' + TEND + ' s</b></span>' + (lat.length < ARR.length ? '<span class="kv">not written yet <b>' + (ARR.length - lat.length) + ' events</b></span>' : '');
          box.querySelector('#tv').innerHTML = NOTES[kind];
          box.querySelector('#tmf').style.display = kind === 'avail' ? '' : 'none';
        }
        onSeg(box, 'trg', function (v) { kind = v; draw(); });
        onSeg(box, 'mf', function (v) { mf = +v; draw(); });
        box.querySelector('#tslow').onchange = draw;
        draw();
      },
      function (el) {
        el.appendChild(h(title('The four triggers <em>in code</em>') + '<div class="cols"><div>' +
          code('# 1. default: next batch as soon as the previous one ends\nq = df.writeStream.toTable("t")\n\n# 2. fixed interval\nq = df.writeStream.trigger(processingTime="1 minute").toTable("t")\n\n# 3. everything available now, in several batches, then stop\nq = (df.writeStream\n       .trigger(availableNow=True)\n       .toTable("t"))\nq.awaitTermination()\n\n# 4. real-time mode (dedicated compute, supported sources and sinks)\nq = df.writeStream.trigger(realTime="5 minutes").start()', 'py') + '</div><div>' +
          '<table class="dt2 mini"><tr><th>trigger</th><th>latency</th><th>cost</th><th>use it for</th></tr>' +
          '<tr><td>default</td><td>seconds</td><td>always on</td><td>continuous pipelines</td></tr>' +
          '<tr><td>processingTime</td><td>≈ interval</td><td>always on</td><td>steady, fewer batches</td></tr>' +
          '<tr><td>availableNow</td><td>schedule</td><td>only while running</td><td>incremental batch jobs, serverless</td></tr>' +
          '<tr><td>realTime</td><td>milliseconds</td><td>always on, more slots</td><td>fraud, alerts, operational</td></tr></table>' +
          list(['<span class="mono">once=True</span> is the old single-batch version of availableNow: deprecated.', 'availableNow respects <span class="mono">maxFilesPerTrigger</span> / <span class="mono">maxBytesPerTrigger</span>: big backlogs are split into batches.', '-The trigger does not change the result of a query, only <b>when</b> and <b>in how many pieces</b> it is computed.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'triggers', q: 'A pipeline must land new files every hour, and the compute should not run between runs. Which trigger?',
          options: ['processingTime="1 hour"', 'availableNow=True, started by an hourly Lakeflow job', 'The default trigger', 'realTime="1 hour"'],
          correct: 1, why: 'processingTime keeps the query and its compute running between ticks. availableNow processes the backlog and stops, so a scheduled job gives hourly incremental runs and the compute is off in between.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 4 ── stateless vs stateful
  var SBATCH = [
    [[1001, 'Budapest', 80], [1002, 'Vienna', 20], [1003, 'Budapest', 60]],
    [[1004, 'Prague', 90], [1005, 'Vienna', 40], [1006, 'Vienna', 70]],
    [[1007, 'Budapest', 30], [1008, 'Prague', 55], [1009, 'Vienna', 95]],
    [[1010, 'Budapest', 65], [1011, 'Prague', 15], [1012, 'Budapest', 75]],
    [[1013, 'Vienna', 85], [1014, 'Prague', 60], [1015, 'Budapest', 25]]
  ];
  SC.push({
    id: 'stateful', icon: '🧠', title: 'Stateless or stateful?', sub: 'Does the query need to remember earlier batches? Then it keeps a state store, and its size matters.',
    thumb: '<div style="display:flex;gap:10px;align-items:center;font-size:40px">🧹<span style="font-family:var(--hand);font-size:26px">vs</span>🧠</div>',
    steps: [
      function (el) {
        var box = h(title('Three queries, <em>one stream</em>', 'Press next batch. Each batch brings three orders. Watch what each query must keep.') +
          '<div class="row"><button class="btn acc" id="sn">Next batch →</button><button class="btn" id="s0">↺</button><span class="kv">batch <b id="sb">–</b></span><span id="sin"></span></div>' +
          '<div class="grid3 mt"><div class="box2"><h4>🧹 filter</h4><div class="mono small" style="margin-top:0">filter(amount &gt; 50)</div><div class="lbl note" style="font-size:18px">written this batch</div><div id="o1"></div><div class="store2 mt"><h5>state store</h5><div class="empty">nothing: each row is handled on its own</div></div></div>' +
          '<div class="box2"><h4>🧮 count per store</h4><div class="mono small" style="margin-top:0">groupBy("store").count()</div><div class="lbl note" style="font-size:18px">result</div><div id="o2"></div><div class="store2 mt"><h5>state store</h5><div id="st2"></div><div class="small">keys: <b id="k2">0</b> · at most 3 stores, ever</div></div></div>' +
          '<div class="box2"><h4>🔁 dropDuplicates</h4><div class="mono small" style="margin-top:0">dropDuplicates(["order_id"])</div><div class="lbl note" style="font-size:18px">written this batch</div><div id="o3"></div><div class="store2 mt"><h5>state store</h5><div id="st3"></div><div class="small">keys: <b id="k3">0</b> · one more for <b>every</b> order, forever</div><div class="bar2 red"><i id="b3" style="width:0"></i></div></div></div></div>');
        el.appendChild(box);
        var b = -1;
        function draw() {
          var seen = SBATCH.slice(0, b + 1), cur = b >= 0 ? SBATCH[b] : [];
          box.querySelector('#sb').textContent = b < 0 ? '–' : b;
          box.querySelector('#sin').innerHTML = cur.map(function (o) { return '<span class="evc new">' + o[0] + ' · ' + o[1] + ' · ' + o[2] + '</span>'; }).join('');
          var f = cur.filter(function (o) { return o[2] > 50; });
          box.querySelector('#o1').innerHTML = f.length ? f.map(function (o) { return '<span class="tag">' + o[0] + ' ' + o[2] + '</span>'; }).join('') : '<div class="empty">–</div>';
          var cnt = {}, touched = {}; seen.forEach(function (bt, i) { bt.forEach(function (o) { cnt[o[1]] = (cnt[o[1]] || 0) + 1; if (i === b) touched[o[1]] = 1; }); });
          var ks = Object.keys(cnt).sort();
          box.querySelector('#o2').innerHTML = ks.length ? '<table class="dt2 mini"><tr><th>store</th><th>count</th></tr>' + ks.map(function (k) { return '<tr class="' + (touched[k] ? 'hl fresh' : '') + '"><td>' + k + '</td><td class="num">' + cnt[k] + '</td></tr>'; }).join('') + '</table>' : '<div class="empty">–</div>';
          box.querySelector('#st2').innerHTML = ks.map(function (k) { return '<span class="skey' + (touched[k] ? ' bump' : '') + '">' + k + ' → ' + cnt[k] + '</span>'; }).join('') || '<div class="empty">empty</div>';
          box.querySelector('#k2').textContent = ks.length;
          box.querySelector('#o3').innerHTML = cur.length ? cur.map(function (o) { return '<span class="tag">' + o[0] + '</span>'; }).join('') : '<div class="empty">–</div>';
          var ids = []; seen.forEach(function (bt) { bt.forEach(function (o) { ids.push(o[0]); }); });
          box.querySelector('#st3').innerHTML = ids.map(function (k) { return '<span class="skey">' + k + '</span>'; }).join('') || '<div class="empty">empty</div>';
          box.querySelector('#k3').textContent = ids.length; box.querySelector('#b3').style.width = (ids.length / 15 * 100) + '%';
          box.querySelector('#sn').disabled = b >= SBATCH.length - 1;
        }
        box.querySelector('#sn').onclick = function () { b++; draw(); };
        box.querySelector('#s0').onclick = function () { b = -1; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Where state lives, and <em>how it stays small</em>') + '<div class="cols"><div>' +
          '<table class="dt2 mini"><tr><th>stateless</th><th>stateful</th></tr><tr><td>select, filter, withColumn</td><td>groupBy … agg</td></tr><tr><td>explode, from_json</td><td>window aggregations</td></tr>' +
          '<tr><td>stream-static join</td><td>dropDuplicates, stream-stream join</td></tr><tr><td>nothing kept between batches</td><td>a <b>state store</b> per shuffle partition, saved in checkpoint/state/</td></tr></table>' +
          '<div class="callout sk thin">On Databricks the state store is <b>RocksDB</b>: state is kept on local disk, not in the JVM heap, and snapshots go to the checkpoint.</div></div><div>' +
          list(['+Few keys (3 stores): state stays tiny forever.', '-A key per event (order id, a window per minute, forever): state grows every batch, batches slow down, memory runs out.', '+The cure: put <b>event time</b> in the key (windows) and set a <b>watermark</b>, so old keys can be deleted. That is the next three frames.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'stateful', q: 'Which query keeps state that grows without limit on a never-ending stream?',
          options: ['filter(col("amount") > 50)', 'groupBy("country").count() with 30 countries', 'dropDuplicates(["order_id"]) without a watermark', 'withColumn("vat", col("amount") * 0.27)'],
          correct: 2, why: 'dropDuplicates must remember every order id it has seen, so its state grows with every new order. A watermark with event time in the keys (or dropDuplicatesWithinWatermark) lets Spark forget old ids.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 5 ── event time vs processing time
  SC.push({
    id: 'eventtime', icon: '🕰️', title: 'Event time vs processing time', sub: 'When it happened is not when it arrived. Counting by the wrong clock gives the wrong numbers.',
    thumb: '<svg viewBox="0 0 220 90" width="220"><line x1="10" y1="20" x2="210" y2="20" stroke="#2c2a26" stroke-width="2.5"/><line x1="10" y1="72" x2="210" y2="72" stroke="#2c2a26" stroke-width="2.5"/><path d="M40 20 L60 72 M80 20 L95 72 M60 20 L170 72" stroke="#8f897c" stroke-width="2" fill="none"/><path d="M60 20 L170 72" stroke="#c99a1b" stroke-width="3"/><circle cx="40" cy="20" r="6" fill="#2a6fb0"/><circle cx="80" cy="20" r="6" fill="#2a6fb0"/><circle cx="60" cy="20" r="6" fill="#c99a1b"/></svg>',
    steps: [
      function (el) {
        var box = h(title('Two clocks for <em>every row</em>', 'Top axis: when the order happened (event_time). Bottom axis: when it reached Spark. A crossing line is a late row. Click a dot.') +
          '<div class="ctl"><label class="l">count per 10 minutes of</label>' + seg('clk', [['et', 'event time'], ['at', 'processing time']], 'et') + '</div>' +
          '<div id="esvg"></div><div class="grid2"><div class="verdict" id="ev">Click a dot or a line.</div><div id="etb"></div></div>');
        el.appendChild(box);
        var RANK = {}; E.SCRIPT.slice().sort(function (a, b) { return a.et - b.et; }).forEach(function (e, i) { RANK[e.id] = i; });
        var clk = 'et', sel = null, W = 900, x0 = 110, x1 = W - 16, T1 = 50, X = function (t) { return x0 + t / T1 * (x1 - x0); };
        function draw() {
          var g = '';
          for (var t = 0; t <= T1; t += 10) g += '<line class="tick" x1="' + X(t) + '" y1="22" x2="' + X(t) + '" y2="190"/><text class="tk" x="' + X(t) + '" y="210" text-anchor="middle">' + fmt(t) + '</text>';
          g += '<text class="lane" x="4" y="50">event time</text><text class="lane" x="4" y="168">processing</text><text class="lane" x="4" y="186">time</text>';
          g += '<rect x="' + x0 + '" y="' + (clk === 'et' ? 30 : 152) + '" width="' + (x1 - x0) + '" height="28" fill="rgba(209,104,46,.07)" rx="6"/>';
          g += '<line class="ax" x1="' + x0 + '" y1="44" x2="' + x1 + '" y2="44"/><line class="ax" x1="' + x0 + '" y1="166" x2="' + x1 + '" y2="166"/>';
          E.BATCH_AT.forEach(function (bt, i) { g += '<text class="bbt" x="' + (X(bt) - 3) + '" y="186" text-anchor="end">batch ' + (i + 1) + ' ▲</text>'; });
          E.SCRIPT.forEach(function (e) {
            var late = e.at - e.et >= 10;
            g += '<path class="lk' + (late ? ' late' : '') + '" d="M' + X(e.et) + ' 44 L' + X(e.at) + ' 166"' + (sel === e.id ? ' style="stroke:#2c2a26;stroke-width:3"' : '') + '/>';
          });
          E.SCRIPT.forEach(function (e) {
            var late = e.at - e.et >= 10, c = 'ev' + (late ? ' late' : '') + (sel === e.id ? ' sel' : '');
            g += '<g data-e="' + e.id + '" style="cursor:pointer"><circle class="' + c + '" cx="' + X(e.et) + '" cy="44" r="8"/><circle class="' + c + '" cx="' + X(e.at) + '" cy="166" r="8"/><text class="evl" x="' + X(e.et) + '" y="' + (RANK[e.id] % 2 ? 14 : 29) + '" text-anchor="middle">' + fmt(e.et) + '</text></g>';
          });
          box.querySelector('#esvg').innerHTML = '<svg class="tl" viewBox="0 0 ' + W + ' 218">' + g + '</svg>';
          box.querySelectorAll('#esvg [data-e]').forEach(function (n) { n.onclick = function () { sel = n.dataset.e; draw(); }; });
          if (sel) {
            var e = E.SCRIPT.filter(function (x) { return x.id === sel; })[0], d = e.at - e.et;
            box.querySelector('#ev').className = 'verdict ' + (d >= 10 ? 'warn' : 'good');
            box.querySelector('#ev').innerHTML = 'Happened at <b>' + fmt(e.et) + '</b>, reached Spark at <b>' + fmt(e.at) + '</b>: ' + d + ' minutes later, processed in <b>batch ' + (e.b + 1) + '</b>. ' +
              (d >= 10 ? 'By processing time it would be counted in ' + fmt(Math.floor(e.at / 10) * 10) + '–' + fmt(Math.floor(e.at / 10) * 10 + 10) + ', but it belongs to <b>' + fmt(Math.floor(e.et / 10) * 10) + '–' + fmt(Math.floor(e.et / 10) * 10 + 10) + '</b>.' : 'Almost no delay.');
          }
          var bins = {}; E.SCRIPT.forEach(function (e) { var k = Math.floor(e[clk] / 10) * 10; bins[k] = (bins[k] || 0) + 1; });
          var bins2 = {}; E.SCRIPT.forEach(function (e) { var k = Math.floor(e[clk === 'et' ? 'at' : 'et'] / 10) * 10; bins2[k] = (bins2[k] || 0) + 1; });
          box.querySelector('#etb').innerHTML = '<table class="dt2 mini"><tr><th>10 minutes</th><th>by ' + (clk === 'et' ? 'event' : 'processing') + ' time</th><th style="color:#a59e8f">by ' + (clk === 'et' ? 'processing' : 'event') + ' time</th></tr>' +
            [0, 10, 20, 30, 40].map(function (k) { return '<tr><td>' + fmt(k) + '–' + fmt(k + 10) + '</td><td class="num"><b>' + (bins[k] || 0) + '</b></td><td class="num" style="color:#a59e8f">' + (bins2[k] || 0) + '</td></tr>'; }).join('') + '</table>';
        }
        onSeg(box, 'clk', function (v) { clk = v; draw(); });
        draw();
      },
      function (el) {
        el.appendChild(h(title('Why rows <em>arrive late</em>') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>📵 Offline devices</h4>' + list(['A phone or a truck buffers events while it has no signal and sends them hours later.']) + '</div>' +
          '<div class="card sk alt"><h4>🔁 Retries</h4>' + list(['A producer times out and sends again. The copy is late and a duplicate.']) + '</div>' +
          '<div class="card sk"><h4>🧵 Partitions</h4>' + list(['Kafka partitions and files are read in parallel, so order between them is not kept.']) + '</div></div>' +
          '<div class="cols mt"><div>' + code('from pyspark.sql import functions as F\n\n# by event time: the column inside the data\norders.groupBy(F.window("event_time", "10 minutes")).count()\n\n# by processing time: when Spark saw it\norders.withColumn("seen", F.current_timestamp())\n      .groupBy(F.window("seen", "10 minutes")).count()', 'py') + '</div>' +
          '<div>' + list(['+Business questions ("orders between 10:00 and 10:10") need <b>event time</b>.', '-Event time means a window can still change when a late row arrives. Spark must keep it open, in state.', 'How long to keep it open is the <b>watermark</b>.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'eventtime', q: 'An order placed at 10:04 reaches Spark at 10:16. In a 10-minute tumbling window on event_time, where is it counted (if the window is still open)?',
          options: ['10:10–10:20, when it arrived', '10:00–10:10, when it happened', 'Both windows', 'Nowhere: late rows are always dropped'],
          correct: 1, why: 'Windows on event_time use the time inside the row. The arrival time only decides which micro-batch processes it, and the watermark decides whether its window is still open.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 6 ── window types
  function sessions(times, gap) {
    var s = times.slice().sort(function (a, b) { return a - b; }), out = [];
    s.forEach(function (t) { var last = out[out.length - 1]; if (last && t < last.end) { last.end = Math.max(last.end, t + gap); last.count++; last.ts.push(t); } else out.push({ start: t, end: t + gap, count: 1, ts: [t] }); });
    return out;
  }
  SC.push({
    id: 'windows', icon: '🪟', title: 'Tumbling, sliding, session', sub: 'Click on the time axis to add an event and see which window it lands in. One event can be in one window, two windows, or stretch a session.',
    thumb: '<div class="th-axis"><b style="left:10px;width:60px"></b><b style="left:76px;width:60px"></b><b style="left:142px;width:60px"></b><i style="left:30px"></i><i style="left:50px"></i><i style="left:120px"></i></div>',
    steps: [
      function (el) {
        var box = h(title('Where does <em>this event</em> go?', 'The blue dots are the orders by event time. Click anywhere on the axis to add your own order (yellow).') +
          '<div class="ctl"><label class="l">window</label>' + seg('wt', [['tumbling', 'tumbling 10 min'], ['sliding', 'sliding 10 min, every 5'], ['session', 'session, gap 4 min']], 'tumbling') +
          '<button class="btn" id="wclr">↺ remove my events</button></div><div id="wsvg"></div><div class="grid2"><div class="verdict" id="wv"></div><div id="wcode"></div></div>');
        el.appendChild(box);
        var wt = 'tumbling', mine = [], last = null, W = 900, x0 = 20, x1 = W - 20, T0 = -5, T1 = 45, X = function (t) { return x0 + (t - T0) / (T1 - T0) * (x1 - x0); };
        var CODE = {
          tumbling: 'F.window("event_time", "10 minutes")',
          sliding: 'F.window("event_time", "10 minutes", "5 minutes")',
          session: 'F.session_window("event_time", "4 minutes")'
        };
        function draw() {
          var ts = E.SCRIPT.map(function (e) { return e.et; }).concat(mine), g = '', wins = [];
          for (var t = 0; t <= 40; t += 5) g += '<line class="tick" x1="' + X(t) + '" y1="30" x2="' + X(t) + '" y2="' + (wt === 'sliding' ? 210 : 160) + '"/><text class="tk" x="' + X(t) + '" y="20" text-anchor="middle">' + fmt(t) + '</text>';
          if (wt === 'session') {
            wins = sessions(ts, 4).map(function (s) { s.row = 0; return s; });
          } else {
            var map = {};
            ts.forEach(function (t) { E.windowsFor(t, wt === 'sliding' ? { type: 'sliding', size: 10, slide: 5 } : { type: 'tumbling', size: 10 }).forEach(function (w) { var k = w.start; map[k] = map[k] || { start: w.start, end: w.end, count: 0, ts: [] }; map[k].count++; map[k].ts.push(t); }); });
            wins = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.start - b.start; });
            wins.forEach(function (w) { w.row = wt === 'sliding' ? ((w.start / 5) % 2 + 2) % 2 : 0; });
          }
          wins.forEach(function (w) {
            var y = 90 + w.row * 56, hit = last !== null && w.ts.indexOf(last) >= 0;
            var a = Math.max(X(w.start), x0 - 10), b = Math.min(X(w.end), x1 + 10);
            g += '<rect class="wb' + (hit ? ' hit' : '') + '" x="' + (a + 2) + '" y="' + y + '" width="' + Math.max(6, b - a - 4) + '" height="44"/>';
            g += '<text class="wc" x="' + ((a + b) / 2) + '" y="' + (y + 25) + '" text-anchor="middle">' + w.count + '</text><text class="wt" x="' + ((a + b) / 2) + '" y="' + (y + 39) + '" text-anchor="middle">' + fmt(w.start) + '–' + fmt(w.end) + '</text>';
          });
          g += '<line class="ax" x1="' + x0 + '" y1="60" x2="' + x1 + '" y2="60"/>';
          ts.forEach(function (t, i) { var m = i >= E.SCRIPT.length; g += '<circle class="ev' + (m ? ' late' : '') + (m && t === last ? ' sel' : '') + '" cx="' + X(t) + '" cy="60" r="' + (m ? 9 : 7) + '"/>'; });
          g += '<rect class="hit-area" x="' + x0 + '" y="26" width="' + (x1 - x0) + '" height="48"/>';
          var H = wt === 'sliding' ? 220 : 160;
          box.querySelector('#wsvg').innerHTML = '<svg class="tl" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
          box.querySelector('#wsvg .hit-area').onclick = function (ev) {
            var svg = box.querySelector('#wsvg svg'), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
            var p = pt.matrixTransform(svg.getScreenCTM().inverse()), t = Math.round(T0 + (p.x - x0) / (x1 - x0) * (T1 - T0));
            t = Math.max(0, Math.min(40, t)); if (ts.indexOf(t) >= 0 && mine.indexOf(t) < 0) t = Math.min(40, t + 1);
            mine.push(t); last = t; draw();
          };
          var v = box.querySelector('#wv');
          if (last === null) v.innerHTML = { tumbling: 'Fixed 10-minute blocks, no overlap: <b>every event is in exactly one window</b>. Window starts are aligned to the clock (10:00, 10:10, …), not to the first event.', sliding: 'A new 10-minute window starts every 5 minutes, so they overlap: <b>every event is in two windows</b> (size ÷ slide). The counts add up to twice the number of events.', session: 'A session starts at an event and stays open 4 minutes. Another event inside the gap <b>extends</b> it; a longer silence closes it. The size depends on the data.' }[wt];
          else {
            var inW = wins.filter(function (w) { return w.ts.indexOf(last) >= 0; });
            v.innerHTML = 'Your event at <b>' + fmt(last) + '</b> is in ' + (inW.length === 1 ? '<b>one</b> window' : '<b>' + inW.length + '</b> windows') + ': ' + inW.map(function (w) { return '<span class="tag">' + fmt(w.start) + '–' + fmt(w.end) + '</span>'; }).join(' ') +
              (wt === 'session' ? (inW[0] && inW[0].count > 1 ? ' It joined or extended an existing session.' : ' No other event within 4 minutes: a session of its own.') : '');
          }
          v.className = 'verdict' + (last !== null ? ' good' : '');
          box.querySelector('#wcode').innerHTML = code('(orders\n  .groupBy(' + CODE[wt] + ')\n  .count())\n# → columns: window {start, end}, count', 'py');
        }
        onSeg(box, 'wt', function (v) { wt = v; draw(); });
        box.querySelector('#wclr').onclick = function () { mine = []; last = null; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Choosing a window') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>🧱 Tumbling</h4>' + list(['<span class="mono">window(ts, "1 hour")</span>', 'Hourly or daily totals, one row per period.', '+Each event counted once.']) + '</div>' +
          '<div class="card sk alt"><h4>🪜 Sliding</h4>' + list(['<span class="mono">window(ts, "1 hour", "15 minutes")</span>', 'Moving averages, "the last hour, every 15 minutes".', '-Each event is counted size ÷ slide times (here 4): more state.']) + '</div>' +
          '<div class="card sk"><h4>💬 Session</h4>' + list(['<span class="mono">session_window(ts, "30 minutes")</span>', 'User visits, device activity bursts, per key.', '-No update output mode; the gap can also be a column expression.']) + '</div></div>' +
          '<div class="callout sk thin">The result has a <span class="mono">window</span> struct column with <span class="mono">start</span> and <span class="mono">end</span>. Select <span class="mono">window.start</span> and <span class="mono">window.end</span> before writing to a table. Window starts are aligned to 1970-01-01 00:00 UTC; the optional <span class="mono">startTime</span> argument shifts them (for example 10:05, 10:15, …).</div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'windows', q: '1,000 events are counted in 1-hour windows that slide every 30 minutes. Roughly what is the sum of all window counts?',
          options: ['500', '1,000', '2,000', 'It depends on the watermark only'], correct: 2,
          why: 'With size 1 hour and slide 30 minutes, every event falls into 1 h ÷ 30 min = 2 overlapping windows, so the counts add up to about twice the number of events.' }));
      }
    ]
  });
})();
