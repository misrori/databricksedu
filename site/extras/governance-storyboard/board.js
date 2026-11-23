/* Governance storyboard: board layout, arrows, and a live "who sees what" widget. */
(function () {
  'use strict';
  // a small live widget on the board: the same query, run as each person, using the row filter lab and the mask lab
  function whoWidget(el) {
    var people = [['anna', '👩‍💼 Anna'], ['bence', '🧑‍💻 Bence'], ['carla', '👩‍💻 Carla']];
    function draw() {
      var r = people.map(function (p) {
        var rf = window.GovLabs.rowfilter.result(p[0]), mk = window.GovLabs.mask.result(p[0]);
        var vis = rf.rows.filter(function (x) { return !x.hidden; }).length;
        var masked = mk.cols.filter(function (c) { return c.mk; }).map(function (c) { return c.n; });
        return '<tr><td>' + p[1] + '</td><td><b>' + vis + '</b> / ' + rf.rows.length + ' rows</td><td>' + (masked.length ? '🎭 ' + masked.join(', ') : 'no masks') + '</td></tr>';
      }).join('');
      el.innerHTML = '<div style="padding:8px 12px;font-size:13px"><b>SELECT * FROM prod.hr.employees</b>, with what you ran in the 🚦 row filter lab and the 🎭 mask lab.</div><table class="ltbl" style="font-size:13px">' + r +
        '</table><div class="xfoot">Run SQL in the labs, then <button id="wwr" style="margin-left:auto">↻ refresh</button></div>';
      el.querySelector('#wwr').onclick = draw;
    }
    draw();
    el.addEventListener('mouseenter', draw);
  }

  window.Storyboard({
    key: 'govsb',
    scenes: window.GOV_SCENES,
    layout: {
      account: [60, 90, 320], identities: [440, 90, 320], labident: [820, 90, 330], namespace: [1210, 90, 320], privileges: [1590, 90, 320], labgrants: [1970, 90, 330],
      views: [60, 600, 310], labview: [440, 600, 320], rowfilter: [820, 600, 310], labrow: [1200, 600, 320], masks: [1580, 600, 310], labmask: [1960, 600, 320],
      abac: [60, 1080, 330], lababac: [460, 1080, 330], decide: [860, 1080, 320], who: [1260, 1080, 400]
    },
    edges: [
      ['account', 'identities', 'who logs in'], ['identities', 'labident', 'try it'], ['labident', 'namespace', ''], ['namespace', 'privileges', 'grants on names'], ['privileges', 'labgrants', 'try it'],
      ['labgrants', 'views', 'which rows and values?'], ['views', 'labview', 'try it'], ['labview', 'rowfilter', 'move the rule onto the table'], ['rowfilter', 'labrow', 'try it'], ['labrow', 'masks', ''], ['masks', 'labmask', 'try it'],
      ['labmask', 'abac', 'scale with tags'], ['abac', 'lababac', 'try it'], ['lababac', 'decide', '']
    ],
    widgets: [{ id: 'who', title: '👀 Who sees what, right now', render: whoWidget }],
    onReset: function () { Object.keys(window.GovLabs).forEach(function (k) { window.GovLabs[k].reset(); }); }
  });
})();
