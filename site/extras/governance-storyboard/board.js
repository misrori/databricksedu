/* Governance storyboard: board layout, arrows, and a live "who sees what" widget. */
(function () {
  'use strict';
  // a small live widget on the board: the same query, run as every principal of the lab
  function whoWidget(el) {
    var modes = [['none', 'no protection'], ['rfcm', 'row filter + masks']];
    var people = [['anna@corp.com', '👩‍💼 Anna'], ['bence@corp.com', '🧑‍💻 Bence'], ['carla@corp.com', '👩‍💻 Carla'], ['dan@corp.com', '🧑 Dan'], ['sp-hr-pipeline', '🤖 sp-hr-pipeline']];
    function draw() {
      var r = people.map(function (p) {
        var q = window.GovLab.run(p[0], 'ws-prod', 'prod.hr.employees');
        return '<tr><td>' + p[1] + '</td><td>' + (q.ok ? '<b>' + q.visible + '</b> / ' + q.rows.length + ' rows' : '<span style="color:#c5221f">✗ ' + q.trace[q.trace.length - 1].label.replace(/<[^>]+>/g, '') + '</span>') + '</td></tr>';
      }).join('');
      el.innerHTML = '<div style="padding:8px 12px;font-size:13px"><b>SELECT * FROM prod.hr.employees</b> in ws-prod, with the lab\'s current setup.</div><table class="ltbl" style="font-size:13px">' + r +
        '</table><div class="xfoot">Change anything in 🧪 the lab, then <button id="wwr" style="margin-left:auto">↻ refresh</button></div>';
      el.querySelector('#wwr').onclick = draw;
    }
    draw();
    el.addEventListener('mouseenter', draw);
  }

  window.Storyboard({
    key: 'govsb',
    scenes: window.GOV_SCENES,
    layout: {
      account: [60, 90, 320], identities: [460, 90, 320], namespace: [860, 90, 320], privileges: [1260, 90, 320],
      views: [60, 560, 310], rowfilter: [450, 560, 310], masks: [840, 560, 310], abac: [1230, 560, 330],
      lab: [1680, 360, 360], decide: [1680, 820, 320], who: [1680, 40, 360]
    },
    edges: [
      ['account', 'identities', 'who logs in'], ['identities', 'namespace', ''], ['namespace', 'privileges', 'grants on names'],
      ['privileges', 'views', 'which rows and values?'], ['views', 'rowfilter', 'move the rule onto the table'], ['rowfilter', 'masks', ''], ['masks', 'abac', 'scale with tags'],
      ['abac', 'lab', 'try it all'], ['privileges', 'lab', ''], ['lab', 'decide', '']
    ],
    widgets: [{ id: 'who', title: '👀 Who sees what, right now', render: whoWidget }],
    onReset: function () { window.GovLab.reset(); }
  });
})();
