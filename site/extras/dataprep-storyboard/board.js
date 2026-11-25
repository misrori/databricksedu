/* Data preparation storyboard: board layout, arrows, and a live "your pipeline" widget. */
(function () {
  'use strict';
  // a small live widget on the board: what the prep lab produces for the new row right now
  function pipeWidget(el) {
    function draw() {
      var s = window.PrepLab.summary(), st = [['impute', '🩹 impute'], ['encode', '🔤 encode'], ['scale', '📏 scale'], ['assemble', '🧩 assemble']];
      var chips = st.map(function (x) { var d = s.done[x[0]], e = s.err[x[0]]; return '<span class="wchip ' + (d ? (e ? 'bad' : 'ok') : '') + '">' + x[1] + (d ? (e ? ' ✗' : ' ✓') : '') + '</span>'; }).join('');
      var row = s.newRow ? '<div class="mono" style="font-size:12.5px;word-break:break-all">[' + s.newRow.map(function (v) { return v === null ? 'null' : Math.round(v * 100) / 100; }).join(', ') + ']</div><div class="small">' + s.size + ' numbers per row</div>' :
        s.skipped ? '<div class="small">row 15 was <b>skipped</b>: no prediction for this customer</div>' :
        '<div class="small">run the four stages in the 🧪 lab to see the features of row 15 (🆕 "Crypto wallet", no monthly fee)</div>';
      el.innerHTML = '<div style="padding:8px 12px;font-size:14px">' + chips + '<div style="margin-top:8px"><b>🆕 row 15 → features</b></div>' + row + '</div>' +
        '<div class="xfoot" style="padding:4px 12px 10px"><button data-lab="raw" class="btn" style="font-size:14px;padding:4px 10px">🧪 open the lab</button></div>';
    }
    draw();
    window.PrepLab.onChange(draw);
    el.addEventListener('mouseenter', draw);
  }

  window.Storyboard({
    key: 'prepsb',
    scenes: window.PREP_SCENES,
    layout: {
      workflow: [60, 90, 320], explore: [440, 90, 320], clean: [820, 90, 320], split: [1200, 90, 320],
      impute: [60, 590, 320], encode: [440, 590, 320], scale: [820, 590, 320], pipeline: [1200, 590, 320],
      lab: [60, 1090, 420], decide: [560, 1090, 320], pipe: [960, 1090, 400]
    },
    edges: [
      ['workflow', 'explore', 'look first'], ['explore', 'clean', 'fix what is wrong'], ['clean', 'split', 'then split'],
      ['split', 'impute', 'fit on train only'], ['impute', 'encode', ''], ['encode', 'scale', ''], ['scale', 'pipeline', 'put it together'],
      ['pipeline', 'lab', 'try it'], ['lab', 'decide', '']
    ],
    widgets: [{ id: 'pipe', title: '🧩 Your pipeline, right now', render: pipeWidget }],
    onReset: function () { window.PrepLab.reset(); }
  });
})();
