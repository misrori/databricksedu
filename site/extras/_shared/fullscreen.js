/* databricksedu storyboards: full screen.
   Adds a ⛶ button to the frame window (the window fills the screen) and to the board header (browser full screen).
   Press F to toggle. Works with any page that has #win .wbar and header.top. */
(function () {
  'use strict';
  var css = '#win.full { padding: 0; }' +
    '#win.full .window { width: 100vw; height: 100vh; max-width: none; border-radius: 0; border: 0; box-shadow: none; animation: none; }' +
    '#win.full .wbody { padding: 22px 34px; }' +
    '.fsbtn { font-size: 17px; }' +
    '#wFull.on { background: #2c2a26; color: #fff; }';
  function inFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFs() { var d = document.documentElement, f = d.requestFullscreen || d.webkitRequestFullscreen; try { if (f && !inFs()) { var p = f.call(d); if (p && p.catch) p.catch(function () { }); } } catch (e) { } }
  function exitFs() { var f = document.exitFullscreen || document.webkitExitFullscreen; try { if (f && inFs()) { var p = f.call(document); if (p && p.catch) p.catch(function () { }); } } catch (e) { } }
  function winOpen() { var w = document.getElementById('win'); return w && w.classList.contains('on'); }
  function setWinFull(on) {
    var w = document.getElementById('win'), b = document.getElementById('wFull');
    if (!w) return;
    w.classList.toggle('full', on);
    if (b) { b.classList.toggle('on', on); b.title = on ? 'Leave full screen (F)' : 'Full screen (F)'; }
    if (on) enterFs(); else exitFs();
    window.dispatchEvent(new Event('resize'));
  }
  function toggleWin() { var w = document.getElementById('win'); setWinFull(!(w && w.classList.contains('full'))); }
  function toggleBoard() { if (inFs()) exitFs(); else enterFs(); }
  function add() {
    if (document.getElementById('fs-style')) return;
    var st = document.createElement('style'); st.id = 'fs-style'; st.textContent = css; document.head.appendChild(st);
    var bar = document.querySelector('#win .wbar'), x = document.getElementById('wX');
    if (bar) {
      var b = document.createElement('button'); b.id = 'wFull'; b.type = 'button'; b.textContent = '⛶'; b.title = 'Full screen (F)';
      b.onclick = toggleWin;
      bar.insertBefore(b, x || null);
    }
    var pres = document.getElementById('bPresent');
    if (pres) {
      var hb = document.createElement('button'); hb.className = 'pill sk thin fsbtn'; hb.type = 'button'; hb.textContent = '⛶ Full screen'; hb.title = 'Full screen (F)';
      hb.onclick = toggleBoard;
      pres.parentNode.insertBefore(hb, pres);
    }
    document.addEventListener('keydown', function (e) {
      var t = (e.target.tagName || '').toUpperCase();
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); if (winOpen()) toggleWin(); else toggleBoard(); }
    });
    // leaving browser full screen (Esc) also shrinks the window back
    function onFs() { if (!inFs()) { var w = document.getElementById('win'); if (w && w.classList.contains('full')) setWinFull(false); } }
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
