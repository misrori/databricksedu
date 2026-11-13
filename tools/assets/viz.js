/* Step-through visualizations. Elements carry data-st="0:state,2:state"; a step sets data-state. */
(function () {
  if (window.DBXViz) return;
  function parse(el) {
    if (!el._st) {
      el._st = el.getAttribute('data-st').split(',').map(function (p) {
        var i = p.indexOf(':');
        return [+p.slice(0, i), p.slice(i + 1)];
      });
    }
    return el._st;
  }
  function apply(vz, k) {
    vz._k = k;
    vz.querySelectorAll('[data-st]').forEach(function (el) {
      var m = parse(el), s = m[0][1];
      for (var i = 0; i < m.length; i++) if (m[i][0] <= k) s = m[i][1];
      if (el.getAttribute('data-state') !== s) el.setAttribute('data-state', s);
    });
    vz.querySelectorAll('.vz-note').forEach(function (n) {
      n.classList.toggle('on', +n.getAttribute('data-step') === k);
    });
    if (vz._cnt) vz._cnt.textContent = (k + 1) + ' / ' + vz._n;
    if (vz._play) vz._play.textContent = k >= vz._n - 1 ? '↻ Replay' : (vz._timer ? '⏸ Pause' : '▶ Play');
  }
  function stop(vz) {
    if (vz._timer) { clearInterval(vz._timer); vz._timer = null; }
  }
  function step(vz, dir) {
    var k = vz._k + dir;
    if (k < 0 || k >= vz._n) return false;
    apply(vz, k);
    return true;
  }
  function play(vz, ms) {
    stop(vz);
    if (vz._k >= vz._n - 1) apply(vz, 0);
    vz._timer = setInterval(function () {
      if (!step(vz, 1) || vz._k >= vz._n - 1) { stop(vz); apply(vz, vz._k); }
    }, ms || 2200);
    apply(vz, vz._k);
  }
  function setup(vz, opts) {
    if (vz._n) return;
    vz._n = +vz.getAttribute('data-steps');
    vz.classList.add('js');
    var ctl = vz.querySelector('.vz-ctl');
    function btn(label, title, cls, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; if (cls) b.className = cls;
      b.onclick = function (e) { e.stopPropagation(); fn(); };
      ctl.appendChild(b);
      return b;
    }
    btn('◀', 'Previous step', '', function () { stop(vz); step(vz, -1); apply(vz, vz._k); });
    vz._cnt = document.createElement('span'); vz._cnt.className = 'cnt'; ctl.appendChild(vz._cnt);
    btn('▶', 'Next step', '', function () { stop(vz); step(vz, 1); apply(vz, vz._k); });
    vz._play = btn('▶ Play', 'Play all steps', 'play', function () {
      if (vz._timer) { stop(vz); apply(vz, vz._k); } else play(vz);
    });
    apply(vz, 0);
    if (opts && opts.autoplay && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { io.disconnect(); setTimeout(function () { if (vz._k === 0) play(vz); }, 700); }
      }, { threshold: 0.6 });
      io.observe(vz);
    }
  }
  window.DBXViz = {
    init: function (root, opts) {
      (root || document).querySelectorAll('.vz[data-steps]').forEach(function (vz) { setup(vz, opts); });
    },
    step: function (vz, dir) { stop(vz); var ok = step(vz, dir); apply(vz, vz._k); return ok; },
    pending: function (root, dir) {
      var list = Array.prototype.slice.call(root.querySelectorAll('.vz[data-steps]'));
      if (dir < 0) list.reverse();
      for (var i = 0; i < list.length; i++) {
        var vz = list[i];
        if (vz._n && (dir > 0 ? vz._k < vz._n - 1 : vz._k > 0)) return vz;
      }
      return null;
    }
  };
})();
