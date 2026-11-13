/* databricksedu: the in-notebook app (home, slides, document view). */
(function () {
  var D = window.DBE, cfg = D.cfg || {}, root = document.getElementById('dbe');
  // the page as it was served (before rendering), so it can be reopened in a full browser tab
  var SRC = '<!DOCTYPE html>' + document.documentElement.outerHTML;
  var START = window.DBE_START || {};
  if (START.route) cfg.route = START.route;
  if (START.page) { cfg.bar = false; root.classList.add('page'); }
  var CTA_URL = 'https://goldhandacademy.com';
  var mods = {}, cats = {};
  D.categories.forEach(function (c) {
    cats[c.id] = c;
    c.modules.forEach(function (m, n) { m.cat = c; m.pos = n; mods[m.id] = m; });
  });
  var S = { cat: D.categories[0].id, q: '', mod: null, mode: 'slides', idx: 0, slides: [], data: null };
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function showErr(msg) { var e = $('err'); e.style.display = 'block'; e.textContent = 'databricksedu: ' + msg; }
  window.onerror = function (m, src, line) { showErr(m + ' (line ' + line + ')'); };

  root.innerHTML =
    '<div class="top">' +
      '<button class="brand" id="bHome" title="All modules"><span class="lg">🎓</span><span>databricks<em>edu</em></span></button>' +
      '<div class="crumb" id="crumb"></div>' +
      '<div class="seg" id="seg" style="display:none"><button id="bSlides" class="on">🎞️ Slides</button><button id="bDoc">📄 Document</button></div>' +
      '<button class="hbtn" id="bOver" title="Slide overview (O)" style="display:none">▦</button>' +
      '<button class="hbtn pri" id="bSave" style="display:none">💾 Save to workspace</button>' +
      '<button class="hbtn" id="bSize" title="Window height">↕</button>' +
      '<button class="hbtn" id="bFull" title="Full screen (F)">⛶</button>' +
    '</div><div id="bar"></div>' +
    '<div id="main">' +
      '<div id="home"></div>' +
      '<div id="player">' +
        '<section id="slides"><div class="stage" id="stage"></div>' +
          '<div class="controls"><button class="nav" id="prev" title="Previous (←)">←</button><div class="dots" id="dots"></div>' +
          '<span class="hint">← → to move · O overview · D document</span><span class="count" id="count"></span>' +
          '<button class="nav next" id="next" title="Next (→)">Next →</button></div>' +
          '<div id="overview"><div class="ogrid" id="ogrid"></div></div></section>' +
        '<section id="doc"><nav id="toc"></nav><div id="docScroll"></div></section>' +
      '</div>' +
      '<div id="modal"></div><div id="err"></div>' +
    '</div>';

  // ---------------------------------------------------------------- content loading
  function inflate(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('this browser cannot unpack the content. Run databricksedu.start(compress=False) instead.'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text().then(JSON.parse);
  }
  function load(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    var c = D.content[id];
    if (!c) return Promise.reject(new Error('no content for ' + id));
    return (c.j ? Promise.resolve(c.j) : inflate(c.z)).then(function (data) { cache[id] = data; return data; });
  }

  // ---------------------------------------------------------------- helpers
  function copyText(text, btn) {
    function done() { if (btn) { var t = btn.textContent; btn.textContent = 'copied ✓'; setTimeout(function () { btn.textContent = t; }, 1400); } }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  function wire(el) {
    el.querySelectorAll('.code').forEach(function (c) {
      var b = c.querySelector('.copy');
      if (b) b.onclick = function () { copyText(c.querySelector('pre').innerText, b); };
    });
    el.querySelectorAll('.dbx>*').forEach(function (n, i) { n.style.setProperty('--i', i); });
  }
  function confetti() {
    var e = ['🎉', '✨', '🎊', '⭐', '🧡', '💜'];
    for (var i = 0; i < 36; i++) {
      var s = document.createElement('div');
      s.className = 'confetti'; s.textContent = e[i % e.length];
      s.style.left = Math.random() * 100 + '%'; s.style.animationDelay = Math.random() * .8 + 's';
      root.appendChild(s);
      setTimeout(function (n) { return function () { n.remove(); }; }(s), 3600);
    }
  }
  function ctaHtml(strong) {
    return '<div class="cta"><span class="big">🎯</span><div><b>' + (strong ? 'Ready to test yourself?' : 'Preparing for a certification?') +
      '</b><br><span>Practice exams are available at GoldHandAcademy.com</span></div>' +
      '<a href="' + CTA_URL + '" target="_blank" rel="noopener">Practice exams →</a></div>';
  }

  // ---------------------------------------------------------------- home
  function chips(m) {
    var c = [];
    if (m.level) c.push(esc(m.level));
    if (m.minutes) c.push('⏱ ' + m.minutes + ' min');
    c.push('🎞️ ' + m.slides + ' slides');
    if (m.demo) c.push('🧪 demo');
    if (m.exercises) c.push('✍️ ' + m.exercises + ' exercise' + (m.exercises > 1 ? 's' : ''));
    if (m.quiz) c.push('🎯 quiz');
    return c.map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }
  function card(m, i) {
    return '<div class="mcard" data-id="' + m.id + '" style="--i:' + i + '"><div class="mh"><div class="mi">' + m.icon + '</div>' +
      '<div class="mt">' + esc(m.title) + '</div></div><div class="ms">' + esc(m.summary) + '</div>' +
      '<div class="mchips">' + chips(m) + '</div><div class="mact">' +
      '<button class="go" data-a="slides">▶ Start</button><button data-a="doc">📖 Read</button><button data-a="save">💾 Save</button></div></div>';
  }
  function renderHome() {
    var total = Object.keys(mods).length, h = '';
    h += '<div class="dbx" style="max-width:none"><div class="hhero"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div>' +
      '<h1>databricks<em>edu</em></h1><p>Bite-sized Databricks lessons that run inside your notebook: animated slides, readable notes, ' +
      'hands-on notebooks with exercises, and seeded demo data. Pick a module and press <b>Start</b>.</p>' +
      '<div class="hstats"><span>📚 ' + total + ' modules</span><span>🗂️ ' + D.categories.length + ' tracks</span>' +
      '<span>🧪 seeded demo data</span><span>v' + esc(D.version) + '</span></div></div></div>';
    h += '<div class="hrow"><div class="cats">' + D.categories.map(function (c) {
      return '<button class="cat' + (c.id === S.cat && !S.q ? ' on' : '') + '" data-cat="' + c.id + '">' + c.icon + ' ' + esc(c.title) + ' <i>' + c.modules.length + '</i></button>';
    }).join('') + '</div><input id="q" placeholder="🔎 Search all modules" value="' + esc(S.q) + '"></div>';
    var list, cat = cats[S.cat];
    if (S.q) {
      var needle = S.q.toLowerCase();
      list = Object.keys(mods).map(function (k) { return mods[k]; }).filter(function (m) {
        return (m.title + ' ' + m.summary + ' ' + (m.tags || []).join(' ') + ' ' + m.group).toLowerCase().indexOf(needle) >= 0;
      });
      h += '<div class="cdesc">' + list.length + ' module(s) match “' + esc(S.q) + '”</div>';
    } else {
      list = cat.modules;
      h += '<div class="cdesc"><span>' + esc(cat.desc) + '</span><button data-savecat="' + cat.id + '">💾 Save this whole track</button></div>';
    }
    if (!list.length) h += '<div class="empty">Nothing found. Try another word.</div>';
    var group = null, i = 0;
    list.forEach(function (m) {
      var g = S.q ? m.cat.title : (m.group || '');
      if (g !== group) { if (group !== null) h += '</div>'; group = g; if (g) h += '<div class="gtitle">' + esc(g) + '</div>'; h += '<div class="grid">'; }
      h += card(m, i++);
    });
    if (group !== null) h += '</div>';
    h += '<div class="hfoot">' + ctaHtml(!S.q && cat.cta) + '<div class="pip"><b>Take it with you</b><br>Every module saves to your workspace as notebooks.' +
      '<code>databricksedu.save("all")</code></div></div></div>';
    var home = $('home');
    home.innerHTML = h;
    home.querySelectorAll('.cat').forEach(function (b) { b.onclick = function () { S.cat = b.getAttribute('data-cat'); S.q = ''; renderHome(); }; });
    home.querySelectorAll('.mcard').forEach(function (c) {
      var id = c.getAttribute('data-id');
      c.onclick = function (e) {
        var a = e.target.getAttribute && e.target.getAttribute('data-a');
        if (a === 'save') return saveDialog(id);
        openModule(id, a === 'doc' ? 'doc' : 'slides');
      };
    });
    var sc = home.querySelector('[data-savecat]');
    if (sc) sc.onclick = function () { saveDialog(sc.getAttribute('data-savecat')); };
    var qi = $('q'), t = null;
    qi.oninput = function () {
      clearTimeout(t);
      t = setTimeout(function () { S.q = qi.value.trim(); renderHome(); var n = $('q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 220);
    };
  }
  function showHome() {
    S.mod = null;
    $('player').style.display = 'none'; $('home').style.display = 'block';
    ['seg', 'bOver', 'bSave'].forEach(function (id) { $(id).style.display = 'none'; });
    $('crumb').innerHTML = ''; $('bar').style.width = '0';
    renderHome();
  }

  // ---------------------------------------------------------------- save dialog
  function saveDialog(id) {
    var m = mods[id], c = cats[id], title, items = '', what;
    if (m) {
      title = m.title; what = 'this module';
      items = '<ul>' + m.notebooks.map(function (n) { return '<li>📓 ' + esc(n) + '</li>'; }).join('') + '<li>📝 notes as Markdown</li></ul>';
    } else if (c) { title = c.title; what = 'all ' + c.modules.length + ' modules of this track'; }
    else { id = 'all'; title = 'everything'; what = 'every module'; }
    var cmd = 'import databricksedu\ndatabricksedu.save("' + id + '")';
    var h = '<div class="mbox"><h3>💾 Save “' + esc(title) + '” to your workspace</h3>' +
      '<p>Copies ' + what + ' into <b>/Workspace/Users/&lt;you&gt;/databricksedu/</b> as notebooks you can run and edit.</p>' + items;
    if (cfg.bar) h += '<div class="tip">👆 Fastest: in the <b>Save to workspace</b> bar above this window choose <b>' + esc(title) + '</b> and press the button.</div>';
    h += '<p>' + (cfg.bar ? 'Or run' : 'Run') + ' this in a notebook cell:</p><div class="cmd"><code>' + esc(cmd) + '</code><button id="mcopy">copy</button></div>' +
      '<button class="mclose" id="mclose">Close</button></div>';
    var modal = $('modal');
    modal.innerHTML = h; modal.classList.add('on');
    $('mcopy').onclick = function () { copyText(cmd, $('mcopy')); };
    $('mclose').onclick = function () { modal.classList.remove('on'); };
    modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('on'); };
  }

  // ---------------------------------------------------------------- player
  function openModule(id, mode, at, vstep) {
    var m = mods[id];
    if (!m) return showErr('unknown module ' + id);
    S.mod = m; S.mode = mode || 'slides'; S.idx = 0;
    $('home').style.display = 'none'; $('player').style.display = 'flex';
    ['seg', 'bSave'].forEach(function (x) { $(x).style.display = ''; });
    $('crumb').innerHTML = esc(m.cat.title) + ' › <b>' + esc(m.title) + '</b>';
    $('stage').innerHTML = '<div class="loading">Loading…</div>';
    load(id).then(function (data) {
      if (S.mod !== m) return;
      S.data = data;
      S.slides = data.slides.map(function (s) { return { t: s.t, i: s.i, h: s.h, title: !!s.hero }; });
      if (data.quiz && data.quiz.length) S.slides.push({ t: 'Check yourself', i: '🎯', quiz: true,
        h: '<div class="sec-head"><span class="sec-num">' + String(S.slides.length).padStart(2, '0') + '</span><span class="sec-icon">🎯</span><h2>Check yourself</h2></div><div class="quiz"></div>' });
      S.slides.push({ t: 'Where next?', i: '🎉', fin: true, h: finHtml(m) });
      buildDots(); buildOverview(); buildDoc();
      S.idx = Math.max(0, Math.min(at || 0, S.slides.length - 1));
      setMode(S.mode);
      for (var k = 0; k < (vstep || 0); k++) { var vz = DBXViz.pending($('stage'), 1); if (vz) DBXViz.step(vz, 1); }
    }, function (e) { showErr(e.message); });
  }
  function nextModule(m) { return m.cat.modules[m.pos + 1] || null; }
  function finHtml(m) {
    var nx = nextModule(m), h = '<div class="fin"><div class="big">🎉</div><h2>You finished “' + esc(m.title) + '”</h2><p>Nice work. Here is what you can do next.</p><div class="fcards">';
    if (nx) h += '<div class="fcard" data-go="' + nx.id + '"><b>▶ Next: ' + nx.icon + ' ' + esc(nx.title) + '</b><span>' + esc(nx.summary) + '</span></div>';
    h += '<div class="fcard" data-save="1"><b>💾 Save the notebooks</b><span>' + m.notebooks.map(esc).join(' · ') + '</span></div>';
    h += '<div class="fcard" data-home="1"><b>🗂️ Back to all modules</b><span>' + esc(m.cat.title) + ' has ' + m.cat.modules.length + ' modules.</span></div></div>';
    return h + ctaHtml(!!m.cat.cta) + '</div>';
  }
  function wireFin(el) {
    el.querySelectorAll('[data-go]').forEach(function (c) { c.onclick = function () { openModule(c.getAttribute('data-go'), 'slides'); }; });
    el.querySelectorAll('[data-save]').forEach(function (c) { c.onclick = function () { saveDialog(S.mod.id); }; });
    el.querySelectorAll('[data-home]').forEach(function (c) { c.onclick = showHome; });
  }
  function mountQuiz(el) { dbxQuiz(el, S.data.quiz, function (score, total) { if (score === total) confetti(); }); }
  function buildDots() {
    var dots = $('dots'); dots.innerHTML = '';
    S.slides.forEach(function (s, i) {
      var b = document.createElement('button'); b.title = s.t;
      b.onclick = function () { go(i); }; dots.appendChild(b);
    });
  }
  function buildOverview() {
    var g = $('ogrid'); g.innerHTML = '';
    S.slides.forEach(function (s, i) {
      var c = document.createElement('div'); c.className = 'ocard';
      c.innerHTML = '<div class="n">' + (i + 1) + '</div><div class="i">' + s.i + '</div><div class="t">' + s.t + '</div>';
      c.onclick = function () { $('overview').classList.remove('on'); go(i); };
      g.appendChild(c);
    });
  }
  function renderSlide(dir) {
    var s = S.slides[S.idx], stage = $('stage');
    var el = document.createElement('div');
    el.className = 'slide ' + (dir < 0 ? 'enter-l' : 'enter-r') + (s.title ? ' title' : '');
    el.innerHTML = '<div class="dbx">' + s.h + '</div>';
    stage.innerHTML = ''; stage.appendChild(el);
    wire(el);
    DBXViz.init(el);
    if (s.quiz) mountQuiz(el.querySelector('.quiz'));
    if (s.fin) wireFin(el);
    $('dots').querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', i === S.idx); });
    $('count').textContent = (S.idx + 1) + ' / ' + S.slides.length;
    $('bar').style.width = ((S.idx + 1) / S.slides.length * 100) + '%';
    $('next').textContent = S.idx === S.slides.length - 1 ? '✓ Done' : 'Next →';
  }
  function go(i, dir) {
    if (i < 0 || i >= S.slides.length) return;
    var d = dir || (i < S.idx ? -1 : 1);
    S.idx = i; renderSlide(d);
  }
  function advance(dir) {
    var cur = $('stage').querySelector('.slide');
    var vz = cur && DBXViz.pending(cur, dir);
    if (vz) { DBXViz.step(vz, dir); vz.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (dir > 0 && S.idx === S.slides.length - 1) return showHome();
    go(S.idx + dir, dir);
  }
  function buildDoc() {
    var toc = $('toc'), sc = $('docScroll'), m = S.mod;
    toc.innerHTML = ''; sc.innerHTML = '';
    S.slides.forEach(function (s, i) {
      if (s.fin) return;
      var sec = document.createElement('div');
      sec.className = 'dsec' + (s.title ? ' herosec' : ''); sec.id = 'dsec' + i;
      sec.innerHTML = '<div class="dbx">' + s.h + '</div>';
      sc.appendChild(sec); wire(sec);
      if (s.quiz) mountQuiz(sec.querySelector('.quiz'));
      var a = document.createElement('a');
      a.innerHTML = '<span>' + s.i + '</span><span>' + s.t + '</span>';
      a.onclick = function () { $('raw') && $('raw').remove(); sc.querySelectorAll('.dsec').forEach(function (d) { d.style.display = ''; }); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      toc.appendChild(a);
    });
    var end = document.createElement('div');
    end.className = 'dsec'; end.innerHTML = '<div class="dbx">' + ctaHtml(!!m.cat.cta) + '</div>';
    sc.appendChild(end);
    var rb = document.createElement('button');
    rb.className = 'rawbtn'; rb.textContent = '⧉ Raw Markdown';
    rb.onclick = function () {
      if ($('raw')) { $('raw').remove(); sc.querySelectorAll('.dsec').forEach(function (d) { d.style.display = ''; }); return; }
      sc.querySelectorAll('.dsec').forEach(function (d) { d.style.display = 'none'; });
      var w = document.createElement('div'); w.id = 'raw';
      w.innerHTML = '<div style="max-width:1000px;margin:0 auto 10px;text-align:right"><button class="rawbtn" style="width:auto;padding:8px 16px" id="rawcopy">copy Markdown</button></div><pre class="rawmd"></pre>';
      w.querySelector('pre').textContent = S.data.md;
      sc.insertBefore(w, sc.firstChild); sc.scrollTop = 0;
      $('rawcopy').onclick = function () { copyText(S.data.md, $('rawcopy')); };
    };
    toc.appendChild(rb);
    sc.onscroll = function () {
      var best = 0, top = sc.getBoundingClientRect().top;
      sc.querySelectorAll('.dsec').forEach(function (d, i) { if (d.getBoundingClientRect().top - top < 120) best = i; });
      toc.querySelectorAll('a').forEach(function (a, i) { a.classList.toggle('on', i === best); });
    };
  }
  function setMode(mode) {
    S.mode = mode;
    $('player').classList.toggle('docmode', mode === 'doc');
    $('bSlides').classList.toggle('on', mode !== 'doc'); $('bDoc').classList.toggle('on', mode === 'doc');
    $('bOver').style.display = mode === 'doc' ? 'none' : '';
    $('overview').classList.remove('on');
    if (mode === 'doc') { $('bar').style.width = '100%'; DBXViz.init($('docScroll'), { autoplay: true }); $('docScroll').onscroll(); }
    else renderSlide(1);
  }

  // ---------------------------------------------------------------- chrome
  $('bHome').onclick = showHome;
  $('bSlides').onclick = function () { setMode('slides'); };
  $('bDoc').onclick = function () { setMode('doc'); };
  $('bOver').onclick = function () { $('overview').classList.toggle('on'); };
  $('bSave').onclick = function () { saveDialog(S.mod.id); };
  $('prev').onclick = function () { advance(-1); };
  $('next').onclick = function () { advance(1); };
  var sizes = [680, 820, 980], H = cfg.height || 820;
  function setH(h) {
    H = h; root.style.height = h + 'px';
    try { if (window.frameElement && window.frameElement.hasAttribute('data-dbe')) window.frameElement.style.height = (h + 4) + 'px'; } catch (e) { }
  }
  if (START.page) $('bSize').style.display = 'none'; else setH(H);
  $('bSize').onclick = function () {
    var next = sizes.filter(function (s) { return s > H; })[0] || sizes[0];
    setH(next);
  };
  var fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  $('bFull').onclick = toggleFs;
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () { root.classList.toggle('fs', !!(document.fullscreenElement || document.webkitFullscreenElement)); });
  });
  function route() {
    if (!S.mod) return 'cat/' + S.cat;
    return S.mode === 'doc' ? 'doc/' + S.mod.id : 'slides/' + S.mod.id + '/' + S.idx;
  }
  // Notebook outputs (Databricks displayHTML) live in an iframe that may not allow fullscreen:
  // then the app is reopened in its own browser tab, where F / ⛶ gives real full screen.
  function openTab() {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { }
    if (!w) { setH(Math.max(H, (window.screen && screen.availHeight || 900) - 160)); root.scrollIntoView(); return; }
    var start = '<script>window.DBE_START=' + JSON.stringify({ route: route(), page: true }) + ';<\/script>';
    w.document.open();
    w.document.write(SRC.replace('<script>window.DBE=', start + '<script>window.DBE='));
    w.document.close();
  }
  function toggleFs() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (!fsOk) return openTab();
    var req = root.requestFullscreen || root.webkitRequestFullscreen, p = null;
    try { p = req.call(root); } catch (e) { return openTab(); }
    if (p && p.catch) p.catch(openTab);
  }
  document.addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA/.test((e.target.tagName || ''))) return;
    if (e.key === 'Escape') { $('modal').classList.remove('on'); $('overview').classList.remove('on'); return; }
    if (!S.mod) return;
    if (e.key === 'd' || e.key === 'D') return setMode(S.mode === 'doc' ? 'slides' : 'doc');
    if (e.key === 'f' || e.key === 'F') return toggleFs();
    if (S.mode === 'doc') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); advance(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); advance(-1); }
    else if (e.key === 'o' || e.key === 'O') $('overview').classList.toggle('on');
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(S.slides.length - 1);
  });

  // ---------------------------------------------------------------- start
  var r = String(cfg.route || 'home').split('/');
  if ((r[0] === 'slides' || r[0] === 'doc') && mods[r[1]]) { S.cat = mods[r[1]].cat.id; openModule(r[1], r[0], +r[2] || 0, +r[3] || 0); }
  else { if (r[0] === 'cat' && cats[r[1]]) S.cat = r[1]; showHome(); }
})();
