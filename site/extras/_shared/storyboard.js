/* databricksedu storyboards: the shared engine.
   A pannable, zoomable board of frames; each frame opens a window with stepped scenes and quizzes.
   Usage: Storyboard({ key, scenes, layout, edges, widgets, onReset }) after the page skeleton
   (#board, #canvas, #win, #wTitle, #wBody, #sDots, #sPrev, #sNext, #score, #bPresent, #bReset, zoom buttons). */
(function () {
  'use strict';
  function Storyboard(cfg) {
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var SCENES = cfg.scenes, KEY = cfg.key || 'sb';

    // ---------------------------------------------------------------- progress (per viewer, optional)
    var store = { visited: {}, answers: {} };
    try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) store = saved; } catch (e) { }
    function persist() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { } }
    function updateScore() {
      var ids = Object.keys(store.answers), ok = ids.filter(function (k) { return store.answers[k]; }).length;
      $('#score').textContent = '🎯 ' + ok + ' / ' + ids.length;
    }

    // ---------------------------------------------------------------- quiz
    function quiz(q, onDone) {
      var el = document.createElement('div');
      el.className = 'quiz sk alt';
      el.innerHTML = '<div class="qh">' + q.q + '</div><div class="opts">' +
        q.options.map(function (o, i) { return '<button data-i="' + i + '">' + String.fromCharCode(65 + i) + ') ' + o + '</button>'; }).join('') +
        '</div><div class="why"></div>';
      var answered = false;
      el.querySelectorAll('.opts button').forEach(function (b) {
        b.onclick = function () {
          if (answered) return;
          answered = true;
          var i = +b.dataset.i, right = i === q.correct;
          el.querySelectorAll('.opts button').forEach(function (x) { x.disabled = true; });
          el.querySelectorAll('.opts button')[q.correct].classList.add('right');
          if (!right) b.classList.add('wrong');
          var why = el.querySelector('.why');
          why.innerHTML = (right ? '<b style="color:var(--green)">✓ Right.</b> ' : '<b style="color:var(--red)">✗ Not quite.</b> ') + q.why;
          why.classList.add('on');
          if (q.id && !(q.id in store.answers)) { store.answers[q.id] = right; persist(); updateScore(); }
          if (onDone) onDone(right);
        };
      });
      return el;
    }
    function ask(q) {
      return new Promise(function (resolve) {
        var m = $('#qmodal');
        m.innerHTML = '';
        var qz = quiz(q, function () {
          var go = document.createElement('button');
          go.className = 'btn acc'; go.style.marginTop = '12px'; go.textContent = 'Continue →';
          go.onclick = function () { m.classList.remove('on'); resolve(); };
          qz.appendChild(go); go.focus();
        });
        m.appendChild(qz);
        m.classList.add('on');
      });
    }
    function openScene(id) { var i = SCENES.findIndex(function (s) { return s.id === id; }); if (i >= 0) open(i, 0); }

    // ---------------------------------------------------------------- board
    var LAYOUT = cfg.layout, EDGES = cfg.edges || [], WIDGETS = cfg.widgets || [];
    var pos = {};
    try { pos = JSON.parse(localStorage.getItem(KEY + '-pos') || '{}') || {}; } catch (e) { pos = {}; }
    function P(id) { return pos[id] || LAYOUT[id] || [40, 40, 320]; }
    var view = { x: 0, y: 0, z: 1 };
    function applyView() { $('#canvas').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')'; $('#zoomv').textContent = Math.round(view.z * 100) + '%'; }
    function fit() {
      var vp = $('#board').getBoundingClientRect(), maxX = 0, maxY = 0;
      document.querySelectorAll('#canvas .frame').forEach(function (f) { maxX = Math.max(maxX, f.offsetLeft + f.offsetWidth); maxY = Math.max(maxY, f.offsetTop + f.offsetHeight); });
      view.z = Math.max(0.25, Math.min(1, Math.min((vp.width - 40) / (maxX + 40), (vp.height - 40) / (maxY + 40))));
      view.x = (vp.width - (maxX + 40) * view.z) / 2; view.y = 16;
      applyView();
    }
    function drawBoard() {
      var cv = $('#canvas'), html = '';
      SCENES.forEach(function (s, i) {
        var p = P(s.id);
        html += '<div class="frame sk' + (i % 2 ? ' alt' : '') + (store.visited[s.id] ? ' visited' : '') + '" data-id="' + s.id + '" data-i="' + i + '" tabindex="0" style="left:' + p[0] + 'px;top:' + p[1] + 'px;width:' + p[2] + 'px">' +
          '<div class="num">' + (i + 1) + '</div><div class="done">✓ seen</div><div class="thumb">' + s.thumb + '</div><h3>' + s.icon + ' ' + s.title + '</h3><p>' + s.sub + '</p>' +
          '<div class="openhint">click to open ↗</div></div>';
      });
      WIDGETS.forEach(function (w) {
        var e = P(w.id);
        html += '<div class="frame widget" data-id="' + w.id + '" style="left:' + e[0] + 'px;top:' + e[1] + 'px;width:' + e[2] + 'px"><div class="whead">' + w.title + ' <small>· drag me by this bar</small></div><div class="wbx" id="wx-' + w.id + '"></div></div>';
      });
      cv.innerHTML = '<svg id="arrows"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8f897c"/></marker></defs></svg>' + html + '<div id="elabels"></div>';
      WIDGETS.forEach(function (w) { w.render($('#wx-' + w.id), api); });
      cv.querySelectorAll('.frame').forEach(function (f) { dragFrame(f); });
      drawArrows();
    }
    function rectOf(id) { var f = $('#canvas .frame[data-id="' + id + '"]'); return f ? { x: f.offsetLeft, y: f.offsetTop, w: f.offsetWidth, h: f.offsetHeight } : null; }
    function anchor(r, tx, ty) {
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
      if (Math.abs(dx) * r.h > Math.abs(dy) * r.w) return [dx > 0 ? r.x + r.w : r.x, cy];
      return [cx, dy > 0 ? r.y + r.h : r.y];
    }
    function drawArrows() {
      var svg = $('#arrows'), labels = $('#elabels'), d = '', lh = '';
      if (!svg) return;
      EDGES.forEach(function (ed) {
        var a = rectOf(ed[0]), b = rectOf(ed[1]); if (!a || !b) return;
        var p1 = anchor(a, b.x + b.w / 2, b.y + b.h / 2), p2 = anchor(b, a.x + a.w / 2, a.y + a.h / 2);
        var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, nx = -(p2[1] - p1[1]) * 0.12, ny = (p2[0] - p1[0]) * 0.12;
        d += '<path d="M' + p1[0] + ' ' + p1[1] + ' Q' + (mx + nx) + ' ' + (my + ny) + ' ' + p2[0] + ' ' + p2[1] + '" marker-end="url(#ah)"/>';
        if (ed[2]) lh += '<div class="elabel" style="left:' + (mx + nx / 2) + 'px;top:' + (my + ny / 2) + 'px">' + ed[2] + '</div>';
      });
      svg.innerHTML = svg.querySelector('defs').outerHTML + d;
      labels.innerHTML = lh;
    }
    var dragged = false;
    function dragFrame(f) {
      var handle = f.classList.contains('widget') ? f.querySelector('.whead') : f;
      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        var sx = e.clientX, sy = e.clientY, ox = f.offsetLeft, oy = f.offsetTop, moved = false;
        function mv(ev) {
          var dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
          moved = true; f.classList.add('dragging');
          f.style.left = (ox + dx) + 'px'; f.style.top = (oy + dy) + 'px'; drawArrows();
        }
        function up() {
          document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
          f.classList.remove('dragging');
          if (moved) {
            dragged = true; setTimeout(function () { dragged = false; }, 50);
            pos[f.dataset.id] = [f.offsetLeft, f.offsetTop, f.offsetWidth];
            try { localStorage.setItem(KEY + '-pos', JSON.stringify(pos)); } catch (e2) { }
          }
        }
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      if (!f.classList.contains('widget')) {
        f.addEventListener('click', function () { if (!dragged) open(+f.dataset.i, 0); });
        f.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(+f.dataset.i, 0); });
      }
    }
    (function () {
      var bd = $('#board');
      bd.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || e.target.closest('.frame')) return;
        var sx = e.clientX - view.x, sy = e.clientY - view.y;
        bd.classList.add('panning');
        function mv(ev) { view.x = ev.clientX - sx; view.y = ev.clientY - sy; applyView(); }
        function up() { bd.classList.remove('panning'); document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      bd.addEventListener('wheel', function (e) {
        if (e.target.closest('.wbx') && !e.ctrlKey) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
        else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
      }, { passive: false });
    })();
    function zoomAt(cx, cy, k) {
      var r = $('#board').getBoundingClientRect(), z2 = Math.max(0.25, Math.min(2.2, view.z * k));
      var px = cx - r.left, py = cy - r.top;
      view.x = px - (px - view.x) * (z2 / view.z); view.y = py - (py - view.y) * (z2 / view.z); view.z = z2;
      applyView();
    }
    $('#zin').onclick = function () { var r = $('#board').getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); };
    $('#zout').onclick = function () { var r = $('#board').getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); };
    $('#zfit').onclick = fit;
    $('#zlayout').onclick = function () { pos = {}; try { localStorage.removeItem(KEY + '-pos'); } catch (e) { } drawBoard(); fit(); };
    window.addEventListener('resize', function () { drawArrows(); });

    // ---------------------------------------------------------------- window
    var cur = -1, step = 0, seen = {};
    var win = $('#win'), body = $('#wBody');
    (function () { var w = $('.window'); w.style.position = 'relative'; var m = document.createElement('div'); m.id = 'qmodal'; w.appendChild(m); })();
    function open(i, st) {
      cur = i; step = st || 0;
      var s = SCENES[i];
      store.visited[s.id] = true; persist();
      $('#wTitle').innerHTML = (i + 1) + '. ' + s.icon + ' ' + s.title + '<small>' + s.sub + '</small>';
      win.classList.add('on');
      document.body.style.overflow = 'hidden'; document.body.classList.add('winopen');
      render();
    }
    function render() {
      var s = SCENES[cur];
      $('#qmodal').classList.remove('on');
      body.innerHTML = ''; body.scrollTop = 0;
      seen[s.id + step] = true;
      s.steps[step](body, api);
      var dots = $('#sDots');
      dots.innerHTML = s.steps.map(function (_, k) { return '<span class="' + (k === step ? 'on' : seen[s.id + k] ? 'seen' : '') + '" data-k="' + k + '"></span>'; }).join('');
      dots.querySelectorAll('span').forEach(function (d) { d.onclick = function () { step = +d.dataset.k; render(); }; });
      $('#sPrev').disabled = step === 0 && cur === 0;
      $('#sNext').textContent = step < s.steps.length - 1 ? 'Next →' : (cur < SCENES.length - 1 ? 'Next frame: ' + SCENES[cur + 1].icon + ' →' : 'Back to the board');
      $('#wPrevScene').disabled = cur === 0; $('#wNextScene').disabled = cur === SCENES.length - 1;
    }
    function next() {
      var s = SCENES[cur];
      if (step < s.steps.length - 1) { step++; render(); }
      else if (cur < SCENES.length - 1) open(cur + 1, 0);
      else close();
    }
    function prev() {
      if (step > 0) { step--; render(); }
      else if (cur > 0) open(cur - 1, SCENES[cur - 1].steps.length - 1);
    }
    function close() {
      win.classList.remove('on'); document.body.style.overflow = ''; document.body.classList.remove('winopen'); cur = -1;
      document.querySelectorAll('#canvas .frame').forEach(function (f) { var s = SCENES[+f.dataset.i]; if (s && store.visited[s.id]) f.classList.add('visited'); });
    }
    $('#sNext').onclick = next; $('#sPrev').onclick = prev;
    $('#wX').onclick = close; $('#wClose').onclick = close;
    $('#wPrevScene').onclick = function () { if (cur > 0) open(cur - 1, 0); };
    $('#wNextScene').onclick = function () { if (cur < SCENES.length - 1) open(cur + 1, 0); };
    win.addEventListener('click', function (e) { if (e.target === win) close(); });
    document.addEventListener('keydown', function (e) {
      var t = (e.target.tagName || '').toUpperCase();
      if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA') return;
      var fv = document.getElementById('fview');
      if (fv && fv.classList.contains('on')) return;
      if (cur < 0) { if (e.key === 'ArrowRight' && e.target === document.body) { e.preventDefault(); open(0, 0); } return; }
      if (e.key === 'Escape') { if ($('#qmodal').classList.contains('on')) return; close(); }
      else if ((e.key === 'ArrowRight' || e.key === 'PageDown') && !$('#qmodal').classList.contains('on')) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    });
    $('#bPresent').onclick = function () { open(0, 0); };
    $('#bReset').onclick = function () {
      store = { visited: {}, answers: {} }; persist(); updateScore(); seen = {};
      if (cfg.onReset) cfg.onReset();
      document.querySelectorAll('#canvas .frame').forEach(function (f) { f.classList.remove('visited'); });
    };

    var api = { open: open, openScene: openScene, quiz: quiz, ask: ask, score: function () { var ids = Object.keys(store.answers); return [ids.filter(function (k) { return store.answers[k]; }).length, ids.length]; } };
    window.SB = api;
    function init() { drawBoard(); fit(); updateScore(); var m = /#(\w+)/.exec(location.hash); if (m) openScene(m[1]); }
    if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
    return api;
  }

  // small helpers for scene authors
  Storyboard.h = function (html) { var d = document.createElement('div'); d.innerHTML = html; return d; };
  Storyboard.title = function (t, lead) { return '<h2 class="stitle">' + t + '</h2>' + (lead ? '<p class="lead">' + lead + '</p>' : ''); };
  Storyboard.list = function (items) {
    return '<ul class="hand">' + items.map(function (x) {
      var cls = x[0] === '+' ? 'good' : x[0] === '-' ? 'bad' : '';
      return '<li class="' + cls + '">' + (cls ? x.slice(1) : x) + '</li>';
    }).join('') + '</ul>';
  };
  Storyboard.esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  window.Storyboard = Storyboard;
})();
