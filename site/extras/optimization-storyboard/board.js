/* Spark optimization storyboard: layout, arrows and the live table widget. */
(function () {
  'use strict';
  // a small Delta table built by the Delta simulator: many appends = many small files, each with statistics
  function filesWidget(el) {
    var Sim = window.DeltaSim;
    if (!Sim) { el.textContent = 'Simulator not loaded.'; return; }
    var eng = new Sim.Engine(); eng.dvOn = false;
    Sim.run(eng, 'create');
    for (var i = 0; i < 6; i++) Sim.run(eng, 'insert');
    var logOpen = false;
    function draw() {
      el.innerHTML = Sim.explorerHtml(eng, { logOpen: logOpen }) +
        '<div class="xfoot">👆 Open a Parquet file → “Inside the file” shows the min/max per column; the log JSON holds the same <b>stats</b> per file. ' +
        '<button id="wopt" style="margin-left:auto">▶ OPTIMIZE</button><button id="wvac">▶ VACUUM</button><button id="wrst">↺</button></div>';
      Sim.wireExplorer(el, eng, function () { logOpen = !logOpen; draw(); });
      el.querySelector('#wopt').onclick = function () { Sim.run(eng, 'optimize'); draw(); };
      el.querySelector('#wvac').onclick = function () { Sim.run(eng, 'vacuum'); draw(); };
      el.querySelector('#wrst').onclick = function () { eng.reset(); eng.dvOn = false; Sim.run(eng, 'create'); for (var k = 0; k < 6; k++) Sim.run(eng, 'insert'); draw(); };
    }
    draw();
  }

  window.Storyboard({
    key: 'optsb',
    scenes: window.OPT_SCENES,
    layout: {
      rules: [60, 90, 320], plan: [470, 90, 340], aqe: [890, 90, 330], stats: [60, 620, 320], smallfiles: [470, 620, 320],
      files: [470, 1060, 620], bhj: [1300, 90, 340], smj: [1300, 620, 340], profile: [1720, 90, 340], photon: [1720, 620, 320], recap: [2130, 360, 320]
    },
    edges: [
      ['rules', 'plan', 'how Spark plans it'], ['plan', 'aqe', 're-planned at runtime'], ['plan', 'bhj', 'the physical plan picks a join'], ['aqe', 'bhj', 'switch to broadcast'],
      ['bhj', 'smj', 'too big to broadcast?'], ['aqe', 'smj', 'split skew'], ['stats', 'plan', 'size estimates'], ['rules', 'stats', 'read less: skip files'],
      ['stats', 'smallfiles', ''], ['smallfiles', 'files', 'try it on a table'], ['stats', 'files', 'open the files'], ['bhj', 'profile', 'see it in the profile'],
      ['smj', 'profile', ''], ['profile', 'photon', 'Photon operators'], ['photon', 'recap', ''], ['profile', 'recap', '']
    ],
    widgets: [{ id: 'files', title: '📦 A Delta table: files and their statistics', render: filesWidget }]
  });
})();
