/* Streaming storyboard: a tiny, deterministic model of a windowed streaming aggregation.
   Times are minutes after 10:00 (10:07 = 7). One event = one row: { id, et (event time), b (batch it arrives in), at (arrival time), key }.
   Rules (as in Spark Structured Streaming):
   - the watermark is computed at the END of a batch (max event time seen - delay) and used in the NEXT batch;
   - in append/update mode a row is dropped for a window whose end <= the watermark of its batch (the window is closed);
   - append: a window is written once, when its end <= watermark, then its state is removed;
   - update: every window changed in this batch is written; closed windows leave the state silently;
   - complete: the whole result is written every batch; the watermark never removes state or drops rows. */
(function (root) {
  'use strict';
  var NEG = -1e9;

  function fmt(m) {
    if (m === null || m === undefined || m <= NEG / 2) return '—';
    var t = 600 + m, h = Math.floor(t / 60), mm = t % 60;
    return h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function wlabel(w) { return fmt(w.start) + '–' + fmt(w.end); }

  // the windows one event time falls into
  function windowsFor(et, win) {
    if (win.type === 'sliding') {
      var out = [], s = Math.floor(et / win.slide) * win.slide;
      for (var st = s; st > et - win.size; st -= win.slide) out.unshift({ start: st, end: st + win.size });
      return out;
    }
    var t = Math.floor(et / win.size) * win.size;
    return [{ start: t, end: t + win.size }];
  }

  // the script used across the storyboard (orders arriving in five micro-batches, processed every 10 minutes)
  var SCRIPT = [
    { id: 'a', et: 2, at: 3, b: 0, key: 'Budapest', amount: 40 }, { id: 'b', et: 7, at: 8, b: 0, key: 'Vienna', amount: 25 },
    { id: 'c', et: 12, at: 13, b: 1, key: 'Budapest', amount: 30 }, { id: 'd', et: 4, at: 16, b: 1, key: 'Vienna', amount: 15 }, { id: 'e', et: 15, at: 17, b: 1, key: 'Budapest', amount: 50 },
    { id: 'f', et: 23, at: 24, b: 2, key: 'Vienna', amount: 20 }, { id: 'g', et: 9, at: 27, b: 2, key: 'Budapest', amount: 35 },
    { id: 'h', et: 26, at: 31, b: 3, key: 'Budapest', amount: 10 }, { id: 'i', et: 6, at: 35, b: 3, key: 'Vienna', amount: 60 }, { id: 'j', et: 31, at: 33, b: 3, key: 'Vienna', amount: 45 },
    { id: 'k', et: 34, at: 44, b: 4, key: 'Budapest', amount: 25 }
  ];
  var BATCH_AT = [10, 20, 30, 40, 50];   // processing time of each batch

  /* simulate({ events, batches, win: {type, size, slide, gap}, delay: minutes|null, mode, byKey })
     returns one record per batch. */
  function simulate(o) {
    var win = o.win || { type: 'tumbling', size: 10 }, delay = o.delay, mode = o.mode || 'update';
    var useWm = delay !== null && delay !== undefined && mode !== 'complete';
    var nb = o.batches || (Math.max.apply(null, o.events.map(function (e) { return e.b; }).concat([0])) + 1);
    var state = [];          // { start, end, key, count, ids }
    var sink = [];           // what the sink table holds
    var maxEt = NEG, wm = NEG, out = [];
    var err = null;
    if (mode === 'append' && (delay === null || delay === undefined)) err = 'append';
    if (mode === 'update' && win.type === 'session') err = 'session-update';

    function find(start, end, key) { for (var i = 0; i < state.length; i++) { var s = state[i]; if (s.start === start && s.end === end && s.key === key) return s; } return null; }

    for (var b = 0; b < nb; b++) {
      var rows = o.events.filter(function (e) { return e.b === b; });
      var wmBefore = wm, verdicts = [], changed = {};
      rows.forEach(function (e) {
        var key = o.byKey ? (e.key || '') : '';
        if (win.type === 'session') {
          // a session window starts at the event and lasts gap minutes; overlapping sessions of a key merge
          var ns = { start: e.et, end: e.et + win.gap };
          if (useWm && ns.end <= wmBefore) { verdicts.push({ e: e, ok: false, wins: [] }); return; }
          var merged = { start: ns.start, end: ns.end, key: key, count: 1, sum: e.amount || 0, ids: [e.id] };
          state = state.filter(function (s) {
            if (s.key === key && s.start < merged.end && merged.start < s.end) {
              merged.start = Math.min(merged.start, s.start); merged.end = Math.max(merged.end, s.end);
              merged.count += s.count; merged.sum += s.sum; merged.ids = s.ids.concat(merged.ids); return false;
            }
            return true;
          });
          state.push(merged);
          changed[merged.start + '|' + merged.key] = merged;
          verdicts.push({ e: e, ok: true, wins: [{ start: merged.start, end: merged.end }] });
          return;
        }
        var ws = windowsFor(e.et, win), took = [], lost = [];
        ws.forEach(function (w) {
          if (useWm && w.end <= wmBefore) { lost.push(w); return; }
          var s = find(w.start, w.end, key);
          if (!s) { s = { start: w.start, end: w.end, key: key, count: 0, sum: 0, ids: [] }; state.push(s); }
          s.count++; s.sum += e.amount || 0; s.ids.push(e.id); took.push(w);
          changed[w.start + '|' + w.end + '|' + key] = s;
        });
        verdicts.push({ e: e, ok: took.length > 0, wins: took, lost: lost });
      });
      // session windows: drop "changed" entries that were merged away
      var changedList = Object.keys(changed).map(function (k) { return changed[k]; }).filter(function (s) { return state.indexOf(s) >= 0; });
      state.sort(function (x, y) { return x.start - y.start || x.end - y.end || (x.key < y.key ? -1 : 1); });

      var emitted = [], evicted = [];
      function snap(s) { return { start: s.start, end: s.end, key: s.key, count: s.count, sum: s.sum }; }
      if (!err) {
        if (mode === 'complete') {
          emitted = state.map(snap);
          sink = emitted.map(function (r) { return Object.assign({}, r); });
        } else {
          if (mode === 'update') emitted = changedList.map(snap).sort(function (x, y) { return x.start - y.start; });
          if (useWm) {
            state = state.filter(function (s) {
              if (s.end <= wmBefore) { evicted.push(snap(s)); return false; }
              return true;
            });
          }
          if (mode === 'append') emitted = evicted.slice();
          emitted.forEach(function (r) {
            if (mode === 'update') {
              var hit = sink.filter(function (x) { return x.start === r.start && x.end === r.end && x.key === r.key; })[0];
              if (hit) { hit.count = r.count; hit.sum = r.sum; } else sink.push(Object.assign({}, r));
            } else sink.push(Object.assign({}, r));
          });
          sink.sort(function (x, y) { return x.start - y.start || (x.key < y.key ? -1 : 1); });
        }
      }
      rows.forEach(function (e) { if (e.et > maxEt) maxEt = e.et; });
      if (delay !== null && delay !== undefined && maxEt > NEG) wm = Math.max(wm, maxEt - delay);
      out.push({
        b: b, rows: verdicts, wmBefore: wmBefore, wmAfter: wm, maxEt: maxEt,
        state: state.map(function (s) { return { start: s.start, end: s.end, key: s.key, count: s.count, sum: s.sum, ids: s.ids.slice() }; }),
        emitted: emitted, evicted: evicted, sink: sink.map(function (r) { return Object.assign({}, r); }), err: err
      });
    }
    return out;
  }

  root.StreamEngine = { fmt: fmt, wlabel: wlabel, windowsFor: windowsFor, simulate: simulate, SCRIPT: SCRIPT, BATCH_AT: BATCH_AT, NEG: NEG };
})(typeof window !== 'undefined' ? window : globalThis);
