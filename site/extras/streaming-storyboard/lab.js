/* Streaming storyboard: the stream lab. Configure a window, a watermark and an output mode, add events,
   and step through the micro-batches: rows accepted or dropped, the watermark, the state, what is written, the sink. */
(function () {
  'use strict';
  var E = window.StreamEngine, fmt = E.fmt;
  var SCN = {
    script: { name: '🛒 The board script', note: 'The 11 orders used on every frame: two late rows that still count, one that is too late.', ev: E.SCRIPT },
    ontime: { name: '⏱️ Everything on time', note: 'Each order arrives a minute after it happened. Nothing is late.', ev: [2, 5, 8, 11, 14, 17, 21, 24, 27, 31, 34, 37].map(function (t, i) { return { id: 'o' + i, et: t, at: t + 1, b: Math.min(4, Math.floor((t + 1) / 10)) }; }) },
    offline: { name: '📵 A device comes back online', note: 'Batch 4 brings five old readings at once, from a phone that was offline for half an hour.', ev: [{ id: 'p1', et: 3, at: 4, b: 0 }, { id: 'p2', et: 12, at: 13, b: 1 }, { id: 'p3', et: 22, at: 23, b: 2 }, { id: 'p4', et: 31, at: 32, b: 3 }, { id: 'q1', et: 1, at: 35, b: 3 }, { id: 'q2', et: 6, at: 35, b: 3 }, { id: 'q3', et: 14, at: 35, b: 3 }, { id: 'q4', et: 19, at: 35, b: 3 }, { id: 'q5', et: 26, at: 35, b: 3 }, { id: 'p5', et: 36, at: 41, b: 4 }] }
  };
  var st;
  function reset() { st = { scn: 'script', win: 'tumbling', delay: 10, mode: 'append', b: 0, mine: [], et: 5, arr: 4 }; }
  reset();
  function events() { return SCN[st.scn].ev.concat(st.mine); }
  function winCfg() { return st.win === 'sliding' ? { type: 'sliding', size: 10, slide: 5 } : st.win === 'session' ? { type: 'session', gap: 4 } : { type: 'tumbling', size: 10 }; }

  function render(el) {
    if (window.StreamLabPreset) { var p = window.StreamLabPreset; window.StreamLabPreset = null; Object.keys(p).forEach(function (k) { st[k] = p[k]; }); st.b = 0; }
    var SSB = window.SSB, seg = SSB.seg, onSeg = SSB.onSeg, wtbl = SSB.wtbl;
    el.innerHTML = '<h2 class="stitle">The <em>stream lab</em></h2><p class="lead">Choose how the query is written on the left. Step through the batches on the right. Add your own late order and predict what happens before you press next.</p>' +
      '<div class="stl"><div class="slside">' +
      '<div class="box2"><h4>📜 events</h4><div class="scn" id="lscn">' + Object.keys(SCN).map(function (k) { return '<button data-s="' + k + '" class="' + (k === st.scn ? 'on' : '') + '">' + SCN[k].name + '</button>'; }).join('') + '</div><div class="small" id="lnote"></div></div>' +
      '<div class="box2"><h4>✍️ the query</h4><div class="small" style="margin-top:0">window</div>' + seg('lw', [['tumbling', 'tumbling 10'], ['sliding', 'sliding 10/5'], ['session', 'session gap 4']], st.win) +
      '<div class="small" style="margin-top:2px">withWatermark delay</div>' + seg('ld', [['none', 'none'], [5, '5 min'], [10, '10'], [20, '20']], st.delay === null ? 'none' : st.delay) +
      '<div class="small" style="margin-top:2px">outputMode</div>' + seg('lm', [['append', 'append'], ['update', 'update'], ['complete', 'complete']], st.mode) + '<div id="lcode"></div></div>' +
      '<div class="box2"><h4>➕ add an order</h4><div class="addev">event time <select id="let">' + Array.from({ length: 41 }, function (_, i) { return '<option value="' + i + '"' + (i === st.et ? ' selected' : '') + '>' + fmt(i) + '</option>'; }).join('') + '</select>' +
      'arrives in <select id="lar">' + [0, 1, 2, 3, 4].map(function (i) { return '<option value="' + i + '"' + (i === st.arr ? ' selected' : '') + '>batch ' + (i + 1) + '</option>'; }).join('') + '</select><button class="btn" id="ladd" style="font-size:14px;padding:4px 10px">add</button><button class="btn" id="lclr" style="font-size:14px;padding:4px 10px">clear mine</button></div><div class="small" id="lmine"></div></div>' +
      '</div><div class="slmain"><div class="ctl"><span class="bsel" id="lbs"></span><button class="btn acc" id="lnext">Next batch →</button></div><div class="row" id="lkv"></div><div id="lsvg"></div><div class="row" id="lrows"></div>' +
      '<div class="grid3 mt"><div class="mcol"><div class="lbl" style="margin-top:0">🧠 state after the batch</div><div id="lstate"></div></div><div class="mcol"><div class="lbl" style="margin-top:0">📤 written in this batch</div><div id="lemit"></div></div><div class="mcol"><div class="lbl" style="margin-top:0">🔺 the sink table</div><div id="lsink"></div></div></div>' +
      '<div class="verdict" id="lv"></div></div></div>';

    function draw() {
      el.querySelector('#lnote').textContent = SCN[st.scn].note;
      var delayTxt = st.delay === null ? '' : '\n   .withWatermark("event_time", "' + st.delay + ' minutes")';
      var w = { tumbling: 'F.window("event_time", "10 minutes")', sliding: 'F.window("event_time", "10 minutes", "5 minutes")', session: 'F.session_window("event_time", "4 minutes")' }[st.win];
      el.querySelector('#lcode').innerHTML = SSB.code('(orders' + delayTxt + '\n   .groupBy(' + w + ')\n   .count()\n .writeStream\n   .outputMode("' + st.mode + '"))', 'py');
      el.querySelector('#lmine').innerHTML = st.mine.length ? 'your orders: ' + st.mine.map(function (e) { return '<span class="evc late">' + fmt(e.et) + ' <small>batch ' + (e.b + 1) + '</small></span>'; }).join('') : '';
      var r = E.simulate({ events: events(), batches: 5, win: winCfg(), delay: st.delay, mode: st.mode }), rec = r[st.b];
      el.querySelector('#lbs').innerHTML = r.map(function (x, i) { return '<button data-b="' + i + '" class="' + (i === st.b ? 'on' : i < st.b ? 'past' : '') + '">batch ' + (i + 1) + '</button>'; }).join('');
      el.querySelectorAll('#lbs button').forEach(function (n) { n.onclick = function () { st.b = +n.dataset.b; draw(); }; });
      el.querySelector('#lnext').disabled = st.b >= 4;
      var lv = el.querySelector('#lv');
      if (rec.err) {
        ['#lkv', '#lsvg', '#lrows', '#lstate', '#lemit', '#lsink'].forEach(function (s) { el.querySelector(s).innerHTML = ''; });
        lv.className = 'verdict bad';
        lv.innerHTML = rec.err === 'append' ? '<div class="errx">AnalysisException: Append output mode not supported when there are streaming aggregations on streaming DataFrames/DataSets without watermark</div>Add a watermark, or use update or complete mode.' :
          '<div class="errx">AnalysisException: Update output mode is not supported for session windows</div>Use append (with a watermark) or complete.';
        return;
      }
      var useWm = st.delay !== null && st.mode !== 'complete';
      el.querySelector('#lkv').innerHTML = (st.delay === null ? '<span class="kv">no watermark: every window stays in state forever</span>' : st.mode === 'complete' ? '<span class="kv">complete mode: the watermark is ignored</span>' :
        '<span class="kv wm">watermark in this batch <b>' + fmt(rec.wmBefore) + '</b></span><span class="kv wm">after it <b>' + fmt(rec.wmAfter) + '</b></span>') + '<span class="kv">windows in state <b>' + rec.state.length + '</b></span>';
      // the axis
      var W = 900, x0 = 20, x1 = W - 20, T0 = -10, T1 = 50, X = function (t) { return x0 + (t - T0) / (T1 - T0) * (x1 - x0); }, g = '';
      for (var t = -10; t <= 50; t += 10) g += '<line class="tick" x1="' + X(t) + '" y1="26" x2="' + X(t) + '" y2="200"/><text class="tk" x="' + X(t) + '" y="18" text-anchor="middle">' + fmt(t) + '</text>';
      var wm = rec.wmBefore;
      if (useWm && wm > E.NEG / 2) g += '<rect class="wmz" x="' + x0 + '" y="26" width="' + Math.max(0, X(wm) - x0) + '" height="174"/><line class="wm" x1="' + X(wm) + '" y1="22" x2="' + X(wm) + '" y2="204"/><text class="wmt" x="' + (X(wm) + 6) + '" y="198">watermark ' + fmt(wm) + '</text>';
      var shown = rec.state.map(function (s) { return { s: s, cls: '' }; }).concat(rec.evicted.map(function (s) { return { s: s, cls: 'final' }; }));
      shown.sort(function (a, b) { return a.s.start - b.s.start; });
      var lanes = [];
      shown.forEach(function (o) {
        var ln = 0; while (lanes[ln] !== undefined && lanes[ln] > o.s.start) ln++;
        lanes[ln] = o.s.end; var y = 86 + ln * 48;
        g += '<rect class="wb ' + o.cls + '" x="' + (X(o.s.start) + 2) + '" y="' + y + '" width="' + Math.max(8, X(o.s.end) - X(o.s.start) - 4) + '" height="40"/><text class="wc" x="' + (X(o.s.start) + X(o.s.end)) / 2 + '" y="' + (y + 23) + '" text-anchor="middle">' + o.s.count + '</text><text class="wt" x="' + (X(o.s.start) + X(o.s.end)) / 2 + '" y="' + (y + 36) + '" text-anchor="middle">' + (o.cls ? '✅ final' : E.wlabel(o.s)) + '</text>';
      });
      g += '<line class="ax" x1="' + x0 + '" y1="60" x2="' + x1 + '" y2="60"/>';
      events().filter(function (e) { return e.b < st.b; }).forEach(function (e) { g += '<circle class="ev ghost" cx="' + X(e.et) + '" cy="60" r="6"/>'; });
      rec.rows.forEach(function (v) { g += '<circle class="ev ' + (!v.ok ? 'dr' : v.e.at - v.e.et >= 10 || st.mine.indexOf(v.e) >= 0 ? 'late' : '') + '" cx="' + X(v.e.et) + '" cy="60" r="9"/><text class="evl" x="' + X(v.e.et) + '" y="44" text-anchor="middle">' + fmt(v.e.et) + '</text>'; });
      var H = Math.max(210, 96 + lanes.length * 48);
      el.querySelector('#lsvg').innerHTML = '<svg class="tl" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
      el.querySelector('#lrows').innerHTML = '<span class="note" style="font-size:20px">batch ' + (st.b + 1) + ' brings:</span> ' + (rec.rows.length ? rec.rows.map(function (v) {
        return '<span class="evc ' + (!v.ok ? 'dr' : v.e.at - v.e.et >= 10 ? 'late' : '') + ' new">' + fmt(v.e.et) + ' <small>' + (!v.ok ? 'dropped' : v.wins.map(function (w) { return E.wlabel(w); }).join(' + ')) + '</small></span>';
      }).join('') : '<span class="empty">no rows</span>');
      var key = function (w) { return w.start + '|' + w.end; }, em = {}; rec.emitted.forEach(function (w) { em[key(w)] = w.count; });
      el.querySelector('#lstate').innerHTML = wtbl(rec.state, { empty: 'empty' });
      el.querySelector('#lemit').innerHTML = wtbl(rec.emitted, { empty: 'nothing written', hl: function () { return true; } });
      el.querySelector('#lsink').innerHTML = wtbl(rec.sink, { empty: 'empty table', hl: function (w) { return em[key(w)] === w.count; } });
      var drops = rec.rows.filter(function (v) { return !v.ok; }).length, tot = r.slice(0, st.b + 1).reduce(function (a, x) { return a + x.emitted.length; }, 0);
      lv.className = 'verdict ' + (drops ? 'bad' : rec.emitted.length ? 'good' : '');
      lv.innerHTML = (drops ? '<b>' + drops + '</b> row' + (drops > 1 ? 's' : '') + ' dropped: ' + (drops > 1 ? 'their windows were' : 'its window was') + ' already closed. ' : '') +
        (st.mode === 'append' ? (rec.emitted.length ? 'Final window' + (rec.emitted.length > 1 ? 's' : '') + ' written once, state removed. ' : 'Append writes nothing until a window is final. ') :
          st.mode === 'update' ? 'Update writes the ' + rec.emitted.length + ' window' + (rec.emitted.length === 1 ? '' : 's') + ' changed in this batch. ' : 'Complete rewrites all ' + rec.emitted.length + ' windows. ') +
        'Rows written to the sink so far: <b>' + tot + '</b>.';
    }
    el.querySelectorAll('#lscn button').forEach(function (b) { b.onclick = function () { st.scn = b.dataset.s; st.b = 0; el.querySelectorAll('#lscn button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
    onSeg(el, 'lw', function (v) { st.win = v; draw(); });
    onSeg(el, 'ld', function (v) { st.delay = v === 'none' ? null : +v; draw(); });
    onSeg(el, 'lm', function (v) { st.mode = v; draw(); });
    el.querySelector('#let').onchange = function () { st.et = +this.value; };
    el.querySelector('#lar').onchange = function () { st.arr = +this.value; };
    el.querySelector('#ladd').onclick = function () { st.mine.push({ id: 'm' + st.mine.length, et: st.et, at: (st.arr + 1) * 10 - 1, b: st.arr, mine: true }); draw(); };
    el.querySelector('#lclr').onclick = function () { st.mine = []; draw(); };
    el.querySelector('#lnext').onclick = function () { if (st.b < 4) { st.b++; draw(); } };
    draw();
  }
  function summary() { var r = E.simulate({ events: events(), batches: 5, win: winCfg(), delay: st.delay, mode: st.mode }); return { st: st, last: r[4] }; }
  window.StreamLab = { render: render, reset: reset, summary: summary };
})();
