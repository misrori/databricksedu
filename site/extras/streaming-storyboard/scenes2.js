/* Streaming storyboard, part 2: the watermark, output modes batch by batch, which mode for which query,
   streaming joins, monitoring, and the stream lab frame. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var E = window.StreamEngine, fmt = E.fmt, X0 = window.SSB, code = X0.code, seg = X0.seg, onSeg = X0.onSeg, wtbl = X0.wtbl, tryLab = X0.tryLab;
  var SC = window.STREAM_SCENES;
  var TUMB = { type: 'tumbling', size: 10 };

  // an event-time axis with the windows of one batch, the watermark, and the rows of this batch
  function wmSvg(rec, o) {
    o = o || {};
    var W = 900, x0 = 20, x1 = W - 20, T0 = -10, T1 = 45, X = function (t) { return x0 + (t - T0) / (T1 - T0) * (x1 - x0); };
    var g = '';
    for (var t = -10; t <= 40; t += 10) g += '<line class="tick" x1="' + X(t) + '" y1="26" x2="' + X(t) + '" y2="160"/><text class="tk" x="' + X(t) + '" y="18" text-anchor="middle">' + fmt(t) + '</text>';
    var wm = o.which === 'after' ? rec.wmAfter : rec.wmBefore;
    if (wm > E.NEG / 2) {
      g += '<rect class="wmz" x="' + x0 + '" y="26" width="' + Math.max(0, X(wm) - x0) + '" height="134"/>';
      g += '<line class="wm" x1="' + X(wm) + '" y1="22" x2="' + X(wm) + '" y2="166"/><text class="wmt" x="' + (X(wm) + 6) + '" y="158">watermark ' + fmt(wm) + '</text>';
    }
    (o.allWins || []).forEach(function (w) {
      var st = rec.state.filter(function (s) { return s.start === w.start; })[0], gone = !st && rec.evicted.filter(function (s) { return s.start === w.start; }).length;
      var cls = st ? (w.end <= wm ? 'final' : '') : gone ? 'final' : 'gone';
      var cnt = st ? st.count : gone ? rec.evicted.filter(function (s) { return s.start === w.start; })[0].count : (w.count || '');
      g += '<rect class="wb ' + cls + '" x="' + (X(w.start) + 2) + '" y="86" width="' + (X(w.end) - X(w.start) - 4) + '" height="44"/>';
      g += '<text class="wc" x="' + X(w.start + 5) + '" y="111" text-anchor="middle">' + (cnt === '' ? '' : cnt) + '</text><text class="wt" x="' + X(w.start + 5) + '" y="125" text-anchor="middle">' + (st ? 'open, in state' : gone ? '✅ final, state removed' : w.end <= wm ? "✅ final (earlier)" : "no rows yet") + '</text>';
    });
    g += '<line class="ax" x1="' + x0 + '" y1="60" x2="' + x1 + '" y2="60"/>';
    (o.past || []).forEach(function (e) { g += '<circle class="ev ghost" cx="' + X(e.et) + '" cy="60" r="6"/>'; });
    rec.rows.forEach(function (v) { g += '<circle class="ev ' + (!v.ok ? 'drop' : v.e.at - v.e.et >= 10 ? 'late' : '') + '" cx="' + X(v.e.et) + '" cy="60" r="9"/><text class="evl" x="' + X(v.e.et) + '" y="44" text-anchor="middle">' + fmt(v.e.et) + '</text>'; });
    if (rec.maxEt > E.NEG / 2) g += '<text class="tk" x="' + X(rec.maxEt) + '" y="78" text-anchor="middle">▲ max</text>';
    return '<svg class="tl" viewBox="0 0 ' + W + ' 172">' + g + '</svg>';
  }
  function rowChips(rec) {
    return rec.rows.map(function (v) {
      var late = v.e.at - v.e.et >= 10;
      return '<span class="evc ' + (!v.ok ? 'drop' : late ? 'late' : '') + ' new">' + fmt(v.e.et) + ' <small>' + (!v.ok ? 'dropped: window closed' : late ? (v.e.at - v.e.et) + ' min late, still counted' : 'on time') + '</small></span>';
    }).join('');
  }
  var ALLW = [0, 10, 20, 30].map(function (s) { return { start: s, end: s + 10 }; });

  // ════════════════════════════════════════════════════════════════ 7 ── the watermark
  SC.push({
    id: 'watermark', icon: '💧', title: 'The watermark closes windows', sub: 'Watermark = the latest event time seen minus the delay you allow. Step through five batches and watch windows close.',
    thumb: '<div class="th-axis"><b style="left:10px;width:60px;background:#e7f6ec"></b><b style="left:76px;width:60px"></b><b style="left:142px;width:60px"></b><s style="left:95px"></s><i style="left:40px" class="d"></i><i style="left:110px"></i><i style="left:160px" class="l"></i></div>',
    steps: [
      function (el) {
        var box = h(title('Five batches, <em>one moving line</em>', '10-minute tumbling windows on event_time. Blue: on time. Yellow: late but counted. Red: too late, dropped.') +
          '<div class="ctl"><label class="l">withWatermark delay</label>' + seg('dl', [[5, '5 min'], [10, '10 min'], [20, '20 min']], 10) +
          '<span class="bsel" id="wbs"></span></div><div class="row" id="wkv"></div><div id="wsvg"></div><div class="row" id="wrows"></div><div class="verdict" id="wv"></div>');
        el.appendChild(box);
        var dl = 10, b = 0;
        function draw() {
          var r = E.simulate({ events: E.SCRIPT, win: TUMB, delay: dl, mode: 'append' }), rec = r[b];
          box.querySelector('#wbs').innerHTML = r.map(function (x, i) { return '<button data-b="' + i + '" class="' + (i === b ? 'on' : i < b ? 'past' : '') + '">batch ' + (i + 1) + '</button>'; }).join('');
          box.querySelectorAll('#wbs button').forEach(function (n) { n.onclick = function () { b = +n.dataset.b; draw(); }; });
          box.querySelector('#wkv').innerHTML = '<span class="kv wm">watermark used in this batch <b>' + fmt(rec.wmBefore) + '</b></span><span class="kv">max event time after the batch <b>' + fmt(rec.maxEt) + '</b></span><span class="kv wm">new watermark = ' + fmt(rec.maxEt) + ' − ' + dl + ' min <b>' + fmt(rec.wmAfter) + '</b></span>';
          var past = E.SCRIPT.filter(function (e) { return e.b < b; });
          box.querySelector('#wsvg').innerHTML = wmSvg(rec, { allWins: ALLW, past: past });
          box.querySelector('#wrows').innerHTML = '<span class="note" style="font-size:20px">arriving now:</span> ' + rowChips(rec);
          var msg = [];
          rec.rows.forEach(function (v) { if (!v.ok) msg.push('<b>' + fmt(v.e.et) + '</b> belongs to ' + E.wlabel(v.lost[0]) + ', which ended before the watermark ' + fmt(rec.wmBefore) + ': it is <b>dropped</b>.'); });
          rec.evicted.forEach(function (w) { msg.push('Window <b>' + E.wlabel(w) + '</b> ends at or before the watermark ' + fmt(rec.wmBefore) + ': it is <b>final</b>. Its state is deleted (and in append mode it is written now).'); });
          if (!msg.length) msg.push(b === 0 ? 'First batch: no watermark yet, every row is accepted. After the batch the watermark becomes ' + fmt(rec.wmAfter) + '.' : 'No window ends before the watermark ' + fmt(rec.wmBefore) + ' yet, so all windows stay open in state and late rows for them are still counted.');
          msg.push('<span class="small">The watermark is computed at the <b>end</b> of a batch and used from the next one.</span>');
          var v = box.querySelector('#wv'); v.className = 'verdict ' + (rec.rows.some(function (x) { return !x.ok; }) ? 'bad' : rec.evicted.length ? 'good' : ''); v.innerHTML = msg.join('<br>');
        }
        onSeg(box, 'dl', function (v) { dl = +v; draw(); });
        draw();
      },
      function (el) {
        el.appendChild(h(title('The delay is a <em>trade-off</em>') + '<div class="cols"><div>' +
          code('from pyspark.sql import functions as F\n\n(orders\n   .withWatermark("event_time", "10 minutes")\n   .groupBy(F.window("event_time", "10 minutes"))\n   .count())', 'py') +
          '<table class="dt2 mini mt"><tr><th>delay</th><th>late rows kept</th><th>state</th><th>final result after</th></tr><tr><td>5 min</td><td>fewer</td><td>small</td><td>sooner</td></tr><tr><td>20 min</td><td>more</td><td>bigger</td><td>later</td></tr></table></div><div>' +
          list(['The watermark only moves <b>forward</b>. A late row never pulls it back.', 'It is driven by event times in the data, not by the wall clock. No new data: the watermark does not move and windows stay open.', '-A row is dropped when its window has already closed. With a 10-minute delay, rows up to 10 minutes late are guaranteed to count; later ones may or may not.', '+Pick the delay from how late your data really is (a percentile of arrival − event time).']) + '</div></div>' + tryLab('Change the delay in the stream lab', { delay: 20 })));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'watermark', q: 'Delay 10 minutes. The latest event time seen so far is 10:31. In the next batch, a row with event time 10:06 arrives (10-minute tumbling windows). What happens?',
          options: ['It is counted in 10:00–10:10', 'It is dropped: the watermark is 10:21, so window 10:00–10:10 is already closed', 'It is counted in the window of its arrival', 'The query fails'], correct: 1,
          why: 'Watermark = 10:31 − 10 min = 10:21. Window 10:00–10:10 ended before 10:21, so it was finalized and its state deleted. The late row has nowhere to go and is dropped.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 8 ── output modes
  var MODES = [['append', '➕ append', 'Write a window <b>once</b>, when it is final. Needs a watermark.'],
    ['update', '✏️ update', 'Write only the windows that <b>changed</b> in this batch.'],
    ['complete', '📋 complete', 'Write the <b>whole result</b> every batch. Keeps all state forever.']];
  SC.push({
    id: 'modes', icon: '📤', title: 'Output modes, batch by batch', sub: 'One windowed count, three sinks. What does each mode write after every micro-batch, and what is in the table?',
    thumb: '<div class="th-modes"><span><b>append</b>once</span><span><b>update</b>changes</span><span><b>complete</b>all</span></div>',
    steps: [
      function (el) {
        var box = h(title('Same query, <em>three output modes</em>', 'count(*) per 10-minute window, watermark 10 minutes. Step through the batches. Yellow rows = written in this batch.') +
          '<div class="ctl"><span class="bsel" id="obs"></span><label class="toggle"><input type="checkbox" id="owm" checked><span class="sw"></span> withWatermark("event_time", "10 minutes")</label></div>' +
          '<div class="row" id="orow"></div><div class="grid3 mt" id="ocols"></div><div class="verdict" id="ov"></div>');
        el.appendChild(box);
        var b = 0;
        var NOTE = [
          'Batch 1: window 10:00–10:10 opens with 2 orders. <b>update</b> and <b>complete</b> write it at once. <b>append</b> writes nothing: the window could still change.',
          'Batch 2: a late 10:04 row updates 10:00–10:10, and 10:10–10:20 opens. <b>update</b> writes exactly those two rows. <b>complete</b> rewrites everything.',
          'Batch 3: another late row (10:09) arrives while 10:00–10:10 is still open, so it is still counted. Still nothing final, still nothing in <b>append</b>.',
          'Batch 4: the watermark (10:13) has passed 10:10. <b>append</b> finally writes 10:00–10:10 = 4, once. The 10:06 row is too late and dropped… except in <b>complete</b> mode, which ignores the watermark and counts it (5).',
          'Batch 5: 10:10–10:20 becomes final and is appended. <b>update</b> writes only the changed 10:30–10:40. <b>complete</b> rewrites all four windows, as in every batch.'
        ];
        function draw() {
          var wm = box.querySelector('#owm').checked, delay = wm ? 10 : null;
          var res = {}; MODES.forEach(function (m) { res[m[0]] = E.simulate({ events: E.SCRIPT, win: TUMB, delay: delay, mode: m[0] }); });
          box.querySelector('#obs').innerHTML = res.update.map(function (x, i) { return '<button data-b="' + i + '" class="' + (i === b ? 'on' : i < b ? 'past' : '') + '">batch ' + (i + 1) + '</button>'; }).join('');
          box.querySelectorAll('#obs button').forEach(function (n) { n.onclick = function () { b = +n.dataset.b; draw(); }; });
          var u = res.update[b];
          box.querySelector('#orow').innerHTML = '<span class="note" style="font-size:20px">arriving:</span> ' + rowChips(u) + (wm ? ' <span class="kv wm">watermark in this batch <b>' + fmt(u.wmBefore) + '</b></span>' : ' <span class="kv">no watermark: no window is ever final</span>');
          box.querySelector('#ocols').innerHTML = MODES.map(function (m) {
            var r = res[m[0]][b], isNew = function (w) { return r.emitted.some(function (x) { return x.start === w.start && x.count === w.count; }); };
            if (r.err) return '<div class="mcol bad ' + m[0] + '"><h4>' + m[1] + '</h4><div class="sub2">' + m[2] + '</div><div class="errx">AnalysisException: Append output mode not supported when there are streaming aggregations on streaming DataFrames/DataSets without watermark</div><div class="small">The query does not even start: without a watermark no window is ever final, so append would never write anything.</div></div>';
            return '<div class="mcol ' + m[0] + '"><h4>' + m[1] + '</h4><div class="sub2">' + m[2] + '</div>' +
              '<div class="lbl">written in batch ' + (b + 1) + '</div>' + wtbl(r.emitted, { empty: 'nothing written', hl: function () { return true; } }) +
              '<div class="lbl">the sink table now' + (m[0] === 'update' ? ' <small style="font-family:var(--body);font-size:12px;color:var(--soft)">(foreachBatch + MERGE)</small>' : m[0] === 'complete' ? ' <small style="font-family:var(--body);font-size:12px;color:var(--soft)">(overwritten)</small>' : '') + '</div>' + wtbl(r.sink, { empty: 'empty table', hl: isNew }) +
              '<div class="small">rows written so far: <b>' + res[m[0]].slice(0, b + 1).reduce(function (a, x) { return a + x.emitted.length; }, 0) + '</b> · windows in state: <b>' + r.state.length + '</b></div></div>';
          }).join('');
          box.querySelector('#ov').innerHTML = wm ? NOTE[b] : 'Without a watermark: <b>append</b> is not allowed, and <b>update</b> and <b>complete</b> never drop state, so every window stays in memory forever, and the 10:06 row is counted (5).';
        }
        box.querySelector('#owm').onchange = draw;
        draw();
      },
      function (el) {
        el.appendChild(h(title('Which mode <em>for which sink?</em>') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>➕ append</h4>' + list(['Default mode.', 'Delta table, files, Kafka.', '+Each row written once: perfect for a silver or gold table that others read incrementally.', '-Aggregations: a result only after the watermark passes the window end. Latency = window + delay.']) + '</div>' +
          '<div class="card sk alt"><h4>✏️ update</h4>' + list(['Dashboards, alerts, key-value stores.', '+Lowest latency for aggregations: a number as soon as it changes.', '-The Delta sink cannot do it directly: use <span class="mono">foreachBatch</span> with MERGE on the window key.']) + '</div>' +
          '<div class="card sk"><h4>📋 complete</h4>' + list(['Small result tables: a leaderboard, totals per country.', '+Simple: the table is always the full answer (the Delta sink overwrites it).', '-All state kept forever, late rows always counted, the whole table rewritten each batch.']) + '</div></div>' +
          code('def upsert(batch_df, batch_id):           # update mode into Delta\n    (DeltaTable.forName(spark, "window_counts").alias("t")\n       .merge(batch_df.alias("s"), "t.window_start = s.window_start")\n       .whenMatchedUpdateAll().whenNotMatchedInsertAll().execute())\n\n(counts.writeStream.outputMode("update")\n   .foreachBatch(upsert)\n   .option("checkpointLocation", chk).start())', 'py')));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'modes', q: 'A windowed count with a 10-minute watermark runs in update mode. A late row changes a window that is still open. What is written in that batch?',
          options: ['Nothing until the window is final', 'Only the changed window, with its new count', 'The whole result table', 'A second, separate row for the late event'], correct: 1,
          why: 'Update mode writes the rows of the result that changed in this batch. Append would wait until the window is final; complete would rewrite every window.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 9 ── which mode for which query
  var QM = [
    ['select / filter / withColumn (no state)', ['ok', 'Each input row gives one output row, written once.'], ['ok', 'Allowed, and behaves exactly like append: rows never change.'], ['no', 'Not allowed: there is no result table to rewrite, only an endless list of rows.']],
    ['groupBy("store").count(), no watermark', ['no', 'A count can always change, so no row is ever final. Spark rejects the query when it starts.'], ['ok', 'Writes the stores whose count changed. State keeps every store.'], ['ok', 'Rewrites all stores each batch. Fine for a small number of keys.']],
    ['groupBy(window(ts, "10 minutes")) + withWatermark', ['ok', 'Each window written once, after the watermark passes its end. State is cleaned.'], ['ok', 'Changed windows written each batch; the watermark still deletes old state.'], ['ok', 'Allowed, but the watermark is ignored: all windows stay in state forever.']],
    ['session_window(ts, "30 minutes") + withWatermark', ['ok', 'A session is written when it is closed by the watermark.'], ['no', 'Not supported for session windows.'], ['ok', 'Allowed: every session rewritten each batch.']],
    ['stream-stream join', ['ok', 'The only mode for stream-stream joins: matched rows are written once.'], ['no', 'Not supported for stream-stream joins.'], ['no', 'Not supported for stream-stream joins.']],
    ['dropDuplicates(["id", "ts"]) + withWatermark', ['ok', 'The first copy of each key is written once.'], ['ok', 'Allowed: same rows as append.'], ['no', 'Not allowed: there is no aggregation to rewrite.']]
  ];
  SC.push({
    id: 'matrix', icon: '✅', title: 'Which mode is allowed?', sub: 'Guess before you click: the query shape decides which output modes Spark accepts.',
    thumb: '<div style="display:grid;grid-template-columns:repeat(3,36px);gap:5px;font-size:22px;text-align:center"><span>✓</span><span>✓</span><span>✗</span><span>✗</span><span>✓</span><span>✓</span><span>✓</span><span>✓</span><span>✓</span></div>',
    steps: [
      function (el) {
        var box = h(title('Guess, then <em>click the cell</em>', 'Each cell hides whether Spark starts the query. Click to reveal it and the reason.') +
          '<div class="row"><button class="btn" id="mxa">👁 reveal all</button><button class="btn" id="mx0">↺ hide all</button><span class="kv">revealed <b id="mxn">0</b> / ' + QM.length * 3 + '</span></div>' +
          '<table class="matrix mt" id="mx"></table><div class="verdict" id="mxv">Pick a cell.</div>');
        el.appendChild(box);
        var shown = {}, sel = null;
        function draw() {
          box.querySelector('#mx').innerHTML = '<tr><th></th><th>append</th><th>update</th><th>complete</th></tr>' + QM.map(function (q, i) {
            return '<tr><th class="q">' + esc(q[0]) + '</th>' + [1, 2, 3].map(function (k) { var id = i + '-' + k, s = shown[id]; return '<td><button data-c="' + id + '" class="' + (s ? q[k][0] : 'hidden') + (sel === id ? ' sel' : '') + '">' + (s ? (q[k][0] === 'ok' ? '✓' : '✗') : '?') + '</button></td>'; }).join('') + '</tr>';
          }).join('');
          box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { shown[b.dataset.c] = true; sel = b.dataset.c; draw(); }; });
          box.querySelector('#mxn').textContent = Object.keys(shown).length;
          if (sel) { var p = sel.split('-'), c = QM[+p[0]][+p[1]]; var v = box.querySelector('#mxv'); v.className = 'verdict ' + (c[0] === 'ok' ? 'good' : 'bad'); v.innerHTML = '<b>' + ['', 'append', 'update', 'complete'][+p[1]] + '</b> · <span class="mono">' + esc(QM[+p[0]][0]) + '</span>: ' + c[1]; }
        }
        box.querySelector('#mxa').onclick = function () { QM.forEach(function (q, i) { [1, 2, 3].forEach(function (k) { shown[i + '-' + k] = true; }); }); draw(); };
        box.querySelector('#mx0').onclick = function () { shown = {}; sel = null; box.querySelector('#mxv').className = 'verdict'; box.querySelector('#mxv').textContent = 'Pick a cell.'; draw(); };
        draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'matrix', q: 'Which query does Spark refuse to start?',
          options: ['A filter in append mode', 'groupBy("country").count() in complete mode', 'groupBy("country").count() without a watermark in append mode', 'A windowed count with a watermark in update mode'], correct: 2,
          why: 'Append writes a row only when it is final. A plain aggregation without a watermark never finalizes anything, so Spark rejects append mode at start-up. Use update or complete, or add event-time windows and a watermark.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 10 ── streaming joins
  // orders and payments, minutes after 10:00; payment must come within 15 minutes of its order; watermark 10 minutes on both sides
  var JB = [
    { o: [['o1', 0], ['o2', 2]], p: [['o1', 4]] },
    { o: [['o3', 10]], p: [['o3', 12]] },
    { o: [['o4', 30]], p: [['o2', 25]] },
    { o: [], p: [['o4', 33]] },
    { o: [['o5', 40]], p: [] }
  ];
  function joinSim(outer) {
    var os = [], ps = [], maxO = E.NEG, maxP = E.NEG, wm = E.NEG, recs = [];
    JB.forEach(function (bt, i) {
      var wmB = wm, out = [], no = bt.o.map(function (x) { return { id: x[0], t: x[1], m: false, b: i }; }), np = bt.p.map(function (x) { return { id: x[0], t: x[1], b: i }; });
      var match = function (o, p) { return o.id === p.id && p.t >= o.t && p.t <= o.t + 15; };
      no.forEach(function (o) { ps.concat(np).forEach(function (p) { if (match(o, p)) { out.push([o, p]); o.m = true; } }); });
      np.forEach(function (p) { os.forEach(function (o) { if (match(o, p)) { out.push([o, p]); o.m = true; } }); });
      os = os.concat(no); ps = ps.concat(np);
      var evO = os.filter(function (o) { return o.t + 15 <= wmB; }), evP = ps.filter(function (p) { return p.t <= wmB; });
      os = os.filter(function (o) { return evO.indexOf(o) < 0; }); ps = ps.filter(function (p) { return evP.indexOf(p) < 0; });
      if (outer) evO.filter(function (o) { return !o.m; }).forEach(function (o) { out.push([o, null]); });
      no.forEach(function (o) { maxO = Math.max(maxO, o.t); }); np.forEach(function (p) { maxP = Math.max(maxP, p.t); });
      if (maxO > E.NEG && maxP > E.NEG) wm = Math.max(wm, Math.min(maxO, maxP) - 10);
      recs.push({ wmB: wmB, wmA: wm, out: out, os: os.slice(), ps: ps.slice(), evO: evO, evP: evP, no: no, np: np });
    });
    return recs;
  }
  SC.push({
    id: 'joins', icon: '🔗', title: 'Streaming joins', sub: 'Stream-static joins keep nothing. Stream-stream joins buffer both sides until the watermark says a match is impossible.',
    thumb: '<div style="display:flex;gap:8px;align-items:center;font-size:36px">🛒<span style="font-family:var(--hand);font-size:30px">⋈</span>💳</div>',
    steps: [
      function (el) {
        var box = h(title('Stream-static: <em>the latest version</em>, every batch', 'Orders stream in; customers is a Delta table. Change a customer\'s tier between batches and see which rows get the new value.') +
          '<div class="row"><button class="btn acc" id="ssn">Next batch →</button><button class="btn" id="ssu">✏️ UPDATE customers SET tier = \'gold\' WHERE id = 7</button><button class="btn" id="ss0">↺</button><span class="kv">customers version <b id="ssv">0</b></span></div>' +
          '<div class="grid2 mt"><div class="box2"><h4>📋 customers (static Delta table)</h4><table class="dt2 mini" id="sst"></table></div><div class="box2"><h4>🔺 enriched orders (sink)</h4><table class="dt2 mini" id="sso"></table></div></div><div class="verdict" id="ssm">Every micro-batch reads the current version of the static table. Nothing is kept in state.</div>');
        el.appendChild(box);
        var b = 0, ver = 0, tier7 = 'silver', out = [];
        var OB = [[['A1', 7], ['A2', 3]], [['A3', 7]], [['A4', 3], ['A5', 7]], [['A6', 7]]];
        function draw() {
          box.querySelector('#ssv').textContent = ver;
          box.querySelector('#sst').innerHTML = '<tr><th>id</th><th>name</th><th>tier</th></tr><tr><td>3</td><td>Anna</td><td>bronze</td></tr><tr class="' + (tier7 === 'gold' ? 'hl' : '') + '"><td>7</td><td>Bence</td><td>' + tier7 + '</td></tr>';
          box.querySelector('#sso').innerHTML = '<tr><th>order</th><th>batch</th><th>customer</th><th>tier</th></tr>' + (out.map(function (r) { return '<tr class="' + (r[3] ? 'hl' : '') + '"><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[4] + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="empty">empty</td></tr>');
          box.querySelector('#ssn').disabled = b >= OB.length;
        }
        box.querySelector('#ssn').onclick = function () {
          OB[b].forEach(function (o) { out.forEach(function (r) { r[3] = false; }); });
          var fresh = OB[b].map(function (o) { return [o[0], b, o[1], true, o[1] === 7 ? tier7 : 'bronze']; });
          out.forEach(function (r) { r[3] = false; }); out = out.concat(fresh); b++;
          box.querySelector('#ssm').innerHTML = 'Batch ' + (b - 1) + ' joined with customers version ' + ver + '.' + (ver ? ' Orders written <b>before</b> the update still say silver: a stream-static join does not go back and fix old output.' : '');
          draw();
        };
        box.querySelector('#ssu').onclick = function () { if (tier7 === 'gold') return; tier7 = 'gold'; ver++; box.querySelector('#ssm').innerHTML = 'The customers table is now at version 1. The <b>next</b> batch will see gold. Rows already written are not changed.'; draw(); };
        box.querySelector('#ss0').onclick = function () { b = 0; ver = 0; tier7 = 'silver'; out = []; box.querySelector('#ssm').textContent = 'Every micro-batch reads the current version of the static table. Nothing is kept in state.'; draw(); };
        draw();
      },
      function (el) {
        var box = h(title('Stream-stream: <em>both sides wait in state</em>', 'A payment matches its order if it comes within 15 minutes. Watermark 10 minutes on both sides. Step through the batches.') +
          '<div class="ctl"><span class="bsel" id="jbs"></span><label class="toggle"><input type="checkbox" id="jout"><span class="sw"></span> left outer join</label></div>' +
          '<div class="row" id="jkv"></div><div class="jgrid mt"><div class="jbuf"><h5>🛒 orders in state</h5><div id="jo"></div></div><div class="jbuf"><h5>💳 payments in state</h5><div id="jp"></div></div><div class="jbuf"><h5>🔺 written in this batch</h5><div id="jw"></div></div></div><div class="verdict" id="jv"></div>' +
          code('orders.withWatermark("order_time", "10 minutes").join(\n    payments.withWatermark("payment_time", "10 minutes"),\n    F.expr("""o_id = p_id AND\n              payment_time BETWEEN order_time AND order_time + INTERVAL 15 MINUTES"""),\n    "inner")        # or "left_outer"', 'py'));
        el.appendChild(box);
        var b = 0;
        var NOTE = ['o1 and its payment arrive in the same batch: matched at once. o2 has no payment yet, so it <b>waits in state</b>.',
          'o3 matches its payment. o1 stays in state too: another payment for o1 could still come within 15 minutes.',
          'A payment for o2 arrives at 10:25, but o2 was at 10:02: more than 15 minutes later, so <b>no match</b>. The time condition decides.',
          'The watermark (10:15) is now past 10:00 + 15 min, so o1 can never match again: it leaves the state, and so do old payments.',
          'The watermark (10:20) passes 10:02 + 15 min: o2 can never match. Inner join: it is silently removed. Left outer join: <b>now</b> it is written with an empty payment.'];
        function draw() {
          var outer = box.querySelector('#jout').checked, r = joinSim(outer), rec = r[b];
          box.querySelector('#jbs').innerHTML = r.map(function (x, i) { return '<button data-b="' + i + '" class="' + (i === b ? 'on' : i < b ? 'past' : '') + '">batch ' + (i + 1) + '</button>'; }).join('');
          box.querySelectorAll('#jbs button').forEach(function (n) { n.onclick = function () { b = +n.dataset.b; draw(); }; });
          box.querySelector('#jkv').innerHTML = '<span class="note" style="font-size:20px">arriving:</span> ' + rec.no.map(function (o) { return '<span class="evc new">🛒 ' + o.id + ' ' + fmt(o.t) + '</span>'; }).join('') + rec.np.map(function (p) { return '<span class="evc late new">💳 ' + p.id + ' ' + fmt(p.t) + '</span>'; }).join('') + ' <span class="kv wm">watermark in this batch (min of both sides) <b>' + fmt(rec.wmB) + '</b></span>';
          box.querySelector('#jo').innerHTML = rec.os.map(function (o) { return '<div class="jrow' + (o.m ? ' m' : '') + (o.b === b ? ' n' : '') + '"><span>' + o.id + ' ' + fmt(o.t) + '</span><small>' + (o.m ? 'matched' : 'waiting') + ' · until ' + fmt(o.t + 15) + '</small></div>'; }).join('') + rec.evO.map(function (o) { return '<div class="jrow x"><span>' + o.id + ' ' + fmt(o.t) + '</span><small>removed</small></div>'; }).join('') || '<div class="empty">empty</div>';
          box.querySelector('#jp').innerHTML = rec.ps.map(function (p) { return '<div class="jrow' + (p.b === b ? ' n' : '') + '"><span>' + p.id + ' ' + fmt(p.t) + '</span></div>'; }).join('') + rec.evP.map(function (p) { return '<div class="jrow x"><span>' + p.id + ' ' + fmt(p.t) + '</span><small>removed</small></div>'; }).join('') || '<div class="empty">empty</div>';
          box.querySelector('#jw').innerHTML = rec.out.map(function (m) { return '<div class="jrow ' + (m[1] ? 'm' : 'o') + ' n"><span>' + m[0].id + ' ' + fmt(m[0].t) + '</span><span>' + (m[1] ? '💳 ' + fmt(m[1].t) : '💳 NULL') + '</span></div>'; }).join('') || '<div class="empty">nothing</div>';
          box.querySelector('#jv').innerHTML = NOTE[b];
        }
        box.querySelector('#jout').onchange = draw;
        draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'joins', q: 'In a left outer stream-stream join, an order never gets a payment. When is the order written with a NULL payment?',
          options: ['Immediately, in the batch it arrives', 'Never: outer joins drop unmatched rows', 'When the watermark passes the end of its match interval, so no payment can match it any more', 'Only after the query is stopped'], correct: 2,
          why: 'Spark can only be sure there will be no match once the watermark has passed order_time + 15 minutes. Then it writes the NULL row and removes the order from state. That is why outer stream-stream joins require watermarks and a time bound.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 11 ── monitoring
  SC.push({
    id: 'monitor', icon: '📈', title: 'Is the stream keeping up?', sub: 'Compare inputRowsPerSecond with processedRowsPerSecond in the progress report. If input wins, the backlog and the latency grow.',
    thumb: '<svg viewBox="0 0 220 90" width="220"><path d="M5 70 L60 50 L110 52 L160 30 L215 28" stroke="#2a6fb0" stroke-width="3" fill="none"/><path d="M5 72 L60 56 L110 60 L160 62 L215 64" stroke="#2f8a57" stroke-width="3" fill="none"/><path d="M160 30 L215 28 L215 64 L160 62 Z" fill="rgba(191,59,47,.18)"/></svg>',
    steps: [
      function (el) {
        var box = h(title('Read the <em>progress report</em>', 'processingTime 10 s. The cluster can process about 1,000 rows per second. Change the input rate and run batches.') +
          '<div class="ctl"><label class="l">input rate</label>' + seg('rate', [[300, '300 rows/s'], [800, '800 rows/s'], [1300, '1,300 rows/s']], 800) +
          '<button class="btn acc" id="mn">Run 1 batch</button><button class="btn" id="m5">Run 5</button><button class="btn" id="m0">↺</button></div>' +
          '<div class="grid2"><div><svg class="spark2" id="msp" viewBox="0 0 420 130"></svg><div class="lg2"><span><i style="background:var(--blue)"></i>inputRowsPerSecond</span><span><i style="background:var(--green)"></i>processedRowsPerSecond</span><span><i style="background:rgba(191,59,47,.4)"></i>batch duration over 10 s</span></div><div class="verdict" id="mv"></div></div>' +
          '<div><div class="note" style="font-size:20px">query.lastProgress</div><div class="json" id="mj"></div></div></div>');
        el.appendChild(box);
        var rate = 800, C = 1000, hist = [], t = 0, last = 0;
        function step() {
          var start = Math.max(t, hist.length ? hist[hist.length - 1].end : 0), rows = Math.round(rate * (start - last));
          if (!hist.length) rows = rate * 10;
          var d = 0.5 + rows / C, prevStart = hist.length ? hist[hist.length - 1].start : start - 10;
          hist.push({ id: hist.length, start: start, end: start + d, rows: rows, d: d, inRate: rows / Math.max(0.001, start - prevStart), prRate: rows / d });
          last = start; t = Math.max(start + 10, start + d);
          if (start + d > start + 10) t = start + d;
        }
        function draw() {
          var W = 420, H = 130, n = Math.max(6, hist.length), mx = 1600, Xs = function (i) { return 10 + i / (n - 1) * (W - 20); }, Ys = function (v) { return H - 10 - Math.min(v, mx) / mx * (H - 20); };
          var g = '<line x1="10" y1="' + Ys(C) + '" x2="' + (W - 10) + '" y2="' + Ys(C) + '" stroke="#c9c2b2" stroke-dasharray="4 4"/><text x="' + (W - 12) + '" y="' + (Ys(C) - 4) + '" text-anchor="end" font-size="11" fill="#8f897c">capacity ≈ 1,000 rows/s</text>';
          hist.forEach(function (x, i) { if (x.d > 10) g += '<rect class="bk" x="' + (Xs(i) - 6) + '" y="10" width="12" height="' + (H - 20) + '"/>'; });
          if (hist.length > 1) {
            g += '<path class="in" d="' + hist.map(function (x, i) { return (i ? 'L' : 'M') + Xs(i) + ' ' + Ys(x.inRate); }).join(' ') + '"/>';
            g += '<path class="pr" d="' + hist.map(function (x, i) { return (i ? 'L' : 'M') + Xs(i) + ' ' + Ys(x.prRate); }).join(' ') + '"/>';
          }
          box.querySelector('#msp').innerHTML = g;
          var x = hist[hist.length - 1];
          box.querySelector('#mj').innerHTML = x ? '{\n  <span class="k">"batchId"</span>: ' + x.id + ',\n  <span class="k">"numInputRows"</span>: ' + x.rows + ',\n  <span class="k">"inputRowsPerSecond"</span>: <span class="a">' + x.inRate.toFixed(1) + '</span>,\n  <span class="k">"processedRowsPerSecond"</span>: <span class="a">' + x.prRate.toFixed(1) + '</span>,\n  <span class="k">"durationMs"</span>: { <span class="k">"triggerExecution"</span>: ' + Math.round(x.d * 1000) + ', … },\n  <span class="k">"eventTime"</span>: { <span class="k">"watermark"</span>: <span class="s">"…"</span> },\n  <span class="k">"stateOperators"</span>: [ { <span class="k">"numRowsTotal"</span>: … } ],\n  <span class="k">"sources"</span>: [ { <span class="k">"startOffset"</span>: …, <span class="k">"endOffset"</span>: … } ]\n}' : 'run a batch';
          var v = box.querySelector('#mv');
          if (!x) { v.className = 'verdict'; v.innerHTML = 'Run a few batches.'; return; }
          var behind = x.d > 10;
          v.className = 'verdict ' + (behind ? 'bad' : x.inRate > x.prRate * 0.9 ? 'warn' : 'good');
          v.innerHTML = behind ? 'Batch ' + x.id + ' took <b>' + x.d.toFixed(1) + ' s</b>, longer than the 10 s trigger. Each batch is bigger than the last: input rate (' + Math.round(x.inRate) + '/s) &gt; processed rate (' + Math.round(x.prRate) + '/s). The backlog and the latency keep growing. Scale up, add partitions, or make the work cheaper.' :
            'Batches finish in ' + x.d.toFixed(1) + ' s, within the 10 s interval. processedRowsPerSecond (' + Math.round(x.prRate) + ') is above inputRowsPerSecond (' + Math.round(x.inRate) + '): the stream keeps up.';
        }
        onSeg(box, 'rate', function (v) { rate = +v; });
        box.querySelector('#mn').onclick = function () { step(); draw(); };
        box.querySelector('#m5').onclick = function () { for (var i = 0; i < 5; i++) step(); draw(); };
        box.querySelector('#m0').onclick = function () { hist = []; t = 0; last = 0; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('Where to look') + '<div class="cols"><div>' +
          code('q = df.writeStream.trigger(availableNow=True).toTable("t")\n\nq.status          # {message, isDataAvailable, isTriggerActive}\nq.lastProgress    # the JSON on the previous step\nq.recentProgress  # the last reports, a list\nspark.streams.active   # every running query\nq.exception()     # why it failed\nq.awaitTermination()', 'py') + '</div><div>' +
          '<table class="dt2 mini"><tr><th>signal</th><th>means</th></tr><tr><td>input &gt; processed rows/s, batch after batch</td><td>falling behind</td></tr><tr><td>triggerExecution &gt; trigger interval</td><td>batches run back to back</td></tr>' +
          '<tr><td>stateOperators.numRowsTotal keeps rising</td><td>state is not cleaned: missing watermark?</td></tr><tr><td>eventTime.watermark stuck</td><td>no new event times arrive</td></tr></table>' +
          list(['The Spark UI has a <b>Structured Streaming</b> tab with the same numbers as charts.', 'A <span class="mono">StreamingQueryListener</span> receives every progress report: send it to your monitoring tool.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'monitor', q: 'For an hour, every progress report shows inputRowsPerSecond ≈ 1,300 and processedRowsPerSecond ≈ 1,000. What is happening?',
          options: ['Nothing, the numbers are normal', 'The query receives more than it can process: batches grow and latency rises', 'Rows are being dropped as late', 'The watermark is too long'], correct: 1,
          why: 'Processed below input means each batch leaves work for the next one. The backlog grows and so does the end-to-end latency. Add compute, more partitions, or cheaper transformations.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 12 ── the lab
  SC.push({
    id: 'lab', icon: '🧪', title: 'The stream lab', sub: 'Pick a window, a watermark and an output mode, add your own late events, and run the batches.',
    thumb: '<span style="font-size:50px">🧪</span><span class="tag">window</span><span class="tag">watermark</span><span class="tag">mode</span>',
    steps: [function (el) { window.StreamLab.render(el); }]
  });
})();
