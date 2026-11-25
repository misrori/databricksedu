/* Data preparation storyboard: the story scenes.
   Workflow → meet the data → clean → split and sample → impute → encode → scale → one pipeline → the lab → which method when. */
(function () {
  'use strict';
  var S = window.Storyboard, h = S.h, title = S.title, list = S.list, esc = S.esc;
  var SC = window.PREP_SCENES = [];
  function rnd(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function n2(x) { return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : (Math.round(x * 100) / 100).toString(); }
  function mean(v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; }
  function sd(v) { var m = mean(v); return Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (v.length - 1)); }
  function quant(v, q) { var s = v.slice().sort(function (a, b) { return a - b; }); return s[Math.max(0, Math.ceil(q * s.length) - 1)]; }
  function py(code) {
    return '<pre class="code">' + esc(code).replace(/(#[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(from|import|for|in|if|else|True|False|None|def|return)\b(?![^<]*<\/span>)/g, '<span class="kw">$1</span>') + '</pre>';
  }
  function tryLab(view, label) {
    return '<div class="row mt"><button class="btn acc" data-lab="' + view + '">🧪 ' + (label || 'Try it in the prep lab') + ' →</button></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lab]');
    if (!b || !window.SB) return;
    window.PrepLabView = b.dataset.lab;
    window.SB.openScene('lab');
  });
  // a number line: values as dots, optional markers
  function line(vals, opt) {
    opt = opt || {};
    var W = opt.w || 620, x0 = 24, x1 = W - 24, lo = opt.lo !== undefined ? opt.lo : Math.min.apply(null, vals), hi = opt.hi !== undefined ? opt.hi : Math.max.apply(null, vals);
    var sx = function (v) { return hi === lo ? (x0 + x1) / 2 : x0 + (v - lo) / (hi - lo) * (x1 - x0); };
    var g = '<line x1="' + x0 + '" y1="44" x2="' + x1 + '" y2="44" class="ax"/>';
    (opt.bands || []).forEach(function (b) { g += '<rect x="' + sx(b[0]) + '" y="26" width="' + Math.max(0, sx(b[1]) - sx(b[0])) + '" height="36" class="band"/>'; });
    vals.forEach(function (v, i) { g += '<circle cx="' + sx(v) + '" cy="44" r="7" class="pt' + (opt.cls && opt.cls[i] ? ' ' + opt.cls[i] : '') + '"><title>' + n2(v) + '</title></circle>'; });
    (opt.marks || []).forEach(function (m) { var X = sx(m[0]); g += '<line x1="' + X + '" y1="14" x2="' + X + '" y2="74" class="mk ' + (m[2] || '') + '"/><text x="' + X + '" y="' + (m[3] || 10) + '" text-anchor="middle" class="ml ' + (m[2] || '') + '">' + m[1] + '</text>'; });
    g += '<text x="' + x0 + '" y="92" class="lb">' + n2(lo) + '</text><text x="' + x1 + '" y="92" class="lb" text-anchor="end">' + n2(hi) + '</text>';
    return '<svg class="nline" viewBox="0 0 ' + W + ' 100">' + g + '</svg>';
  }

  // ════════════════════════════════════════════════════════════════ 1 ── workflow
  var LIFE = [
    ['🎯', 'Business problem', 'Frame the question as an ML problem: "which subscribers will cancel next month?"'],
    ['📐', 'Success criteria', 'Decide what good means: recall on churners, a cost per false alarm, a latency budget.'],
    ['🧹', 'Data collection & prep', 'Load the data into Delta tables in Unity Catalog, clean it, split it, engineer features. <b>This storyboard.</b>'],
    ['🏋️', 'Model training', 'Fit candidate models on the prepared training data, tune hyperparameters.'],
    ['📊', 'Evaluation', 'Score held-out data the model and the prep never learned from.'],
    ['🚀', 'Deployment', 'Serve the model. New rows must be prepared <b>exactly</b> like the training rows.'],
    ['📡', 'Monitoring', 'Watch for drift: a column suddenly full of nulls, a new category. Often it sends you back to data prep.']
  ];
  var SORT = [
    ['Cast "Yes" / "No" strings to boolean', 'rule', 'A fixed rule: it gives the same result whatever the other rows contain.'],
    ['Fill missing tenure with the median', 'fit', 'The median is computed from rows. If test rows are in that computation, they leak.'],
    ['Delete rows with a negative total charge', 'rule', 'Impossible values are errors. A fixed range check can run before the split.'],
    ['The list of payment methods for one-hot', 'fit', 'StringIndexer learns the categories and their frequency order from data.'],
    ['Mean and std for StandardScaler', 'fit', 'Learned from data: fit on training rows only.'],
    ['Cap monthly fee at Q3 + 1.5 × IQR', 'fit', 'The quartiles come from the data, so the bounds are learned on train and reused.'],
    ['Remove exact duplicate rows', 'rule', 'A row-level rule that learns nothing about the distribution.']
  ];
  SC.push({
    id: 'workflow', icon: '🧭', title: 'Where data prep fits', sub: 'The ML lifecycle, cleaning vs feature engineering, and the one order that never leaks.',
    thumb: '<div class="th-flow"><span>🧹</span>→<span>✂️</span>→<span>🎓</span>→<span>🔁</span></div>',
    steps: [
      function (el) {
        var box = h(title('Data prep is a <em>loop</em>, not a phase', 'Click a stage. What you learn in production often sends you back to preparing data.') +
          '<div class="life" id="life"></div><div class="card sk thin mt" id="lifen"></div>');
        el.appendChild(box);
        var k = 2;
        function draw() {
          box.querySelector('#life').innerHTML = LIFE.map(function (s, i) { return (i ? '<span class="arr">→</span>' : '') + '<button class="lst' + (i === k ? ' on' : '') + (i === 2 ? ' me' : '') + '" data-i="' + i + '"><b>' + s[0] + '</b>' + s[1] + '</button>'; }).join('') + '<span class="arr back">↩ back to prep</span>';
          box.querySelector('#lifen').innerHTML = '<span class="note">' + LIFE[k][1] + '</span><p class="lead" style="margin:6px 0 0">' + LIFE[k][2] + '</p>';
          box.querySelectorAll('.lst').forEach(function (b) { b.onclick = function () { k = +b.dataset.i; draw(); }; });
        }
        draw();
      },
      function (el) {
        var box = h(title('Does this step <em>learn from the data?</em>', 'Cleaning makes data correct. Feature engineering makes it informative. The real question for each step: does it compute something from the rows?') +
          '<div class="cols"><div id="sq"></div><div class="cmp" style="--n:1"><div class="card sk"><h4>📏 Fixed rule</h4>' + list(['Fix types, remove impossible values, deduplicate.', '+Can run <b>before</b> the split, on all data.']) + '</div>' +
          '<div class="card sk alt"><h4>🎓 Learned from rows</h4>' + list(['Fill values, category lists, scaling numbers, outlier bounds.', '-Must be <b>fit on the training set only</b>, then applied to the rest.']) + '</div></div></div>');
        el.appendChild(box);
        var i = 0, ok = 0;
        function draw() {
          var q = box.querySelector('#sq');
          if (i >= SORT.length) { q.innerHTML = '<div class="verdict good">Done: <b>' + ok + ' / ' + SORT.length + '</b> right. Rule of thumb: if a step computes a number or a list from the rows, it belongs in the pipeline that is fit on train.</div><div class="row mt"><button class="btn" id="sqa">↺ again</button></div>'; q.querySelector('#sqa').onclick = function () { i = 0; ok = 0; draw(); }; return; }
          q.innerHTML = '<div class="small">step ' + (i + 1) + ' of ' + SORT.length + '</div><div class="sortq">' + SORT[i][0] + '</div><div class="row"><button class="btn" data-a="rule">📏 fixed rule</button><button class="btn" data-a="fit">🎓 learned: fit on train</button></div><div id="sqv"></div>';
          q.querySelectorAll('[data-a]').forEach(function (b) {
            b.onclick = function () {
              var right = b.dataset.a === SORT[i][1]; if (right) ok++;
              q.querySelectorAll('[data-a]').forEach(function (x) { x.disabled = true; });
              q.querySelector('#sqv').innerHTML = '<div class="verdict ' + (right ? 'good' : 'bad') + '">' + (right ? '✓ ' : '✗ ') + SORT[i][2] + '</div><div class="row mt"><button class="btn acc" id="sqn">next →</button></div>';
              q.querySelector('#sqn').onclick = function () { i++; draw(); };
            };
          });
        }
        draw();
      },
      function (el) {
        var ST = [
          ['🧹', 'Validate & clean', 'Rules that learn nothing: types, impossible values, duplicates. Safe on all rows.'],
          ['✂️', 'Split', 'Train / test (and validation) <b>before</b> anything learns from the data.'],
          ['🎓', 'Fit on train', '<span class="mono">pipeline.fit(train_df)</span> learns medians, category lists, scaling numbers, outlier bounds.'],
          ['🔁', 'Apply everywhere', '<span class="mono">pipeline_model.transform(...)</span> on train, test, and every new row in production. Nothing is re-learned.']
        ];
        var box = h(title('The order that <em>never leaks</em>', 'Press next. The test set must stay a stranger until the very end.') + '<div class="pipe" id="ord"></div><div class="card sk thin mt" id="ordn"></div><div class="row mt"><button class="btn acc" id="ordb">Next →</button></div>' +
          '<div class="callout sk thin">If the test rows help choose a fill value or a scaling number, the model has already "seen" the test set a little. The score looks better than the model really is.</div>');
        el.appendChild(box);
        var k = 0;
        function draw() {
          box.querySelector('#ord').innerHTML = ST.map(function (s, i) { return (i ? '<span class="arr">→</span>' : '') + '<div class="pbox' + (i === k ? ' cur' : '') + '" style="opacity:' + (i <= k ? 1 : .35) + ';animation:none"><b>' + s[0] + ' ' + s[1] + '</b></div>'; }).join('');
          box.querySelector('#ordn').innerHTML = '<span class="note">' + (k + 1) + '. ' + ST[k][1] + '</span><p class="lead" style="margin:6px 0 0">' + ST[k][2] + '</p>';
          box.querySelector('#ordb').textContent = k < ST.length - 1 ? 'Next →' : '↺ Again';
        }
        box.querySelector('#ordb').onclick = function () { k = (k + 1) % ST.length; draw(); };
        draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'workflow', q: 'You compute the median of <span class="mono">tenure</span> on the full table, fill the gaps, and only then split into train and test. What is wrong?',
          options: ['Nothing, the median is robust', 'The test rows influenced the fill value: a small leak that makes the test score optimistic', 'Medians cannot be computed before a split', 'Spark will raise an error'],
          correct: 1, why: 'Anything learned from rows (medians, category lists, scaling numbers, outlier bounds) must be learned on the training rows only, then applied to the test rows.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 2 ── meet the data
  SC.push({
    id: 'explore', icon: '🔍', title: 'Meet the data', sub: 'Fifteen churn rows with every classic problem. Find them before you fix them.',
    thumb: '<div class="th-tbl"><i></i><i class="n"></i><i></i><i class="o"></i><i></i></div>',
    steps: [
      function (el) {
        var R = window.PrepLab.data();
        var P = [['nul', '🕳️ missing values', 'Spark ML VectorAssembler raises an error on nulls by default, and dropping every incomplete row would throw away a third of this table.'],
          ['out', '📈 an outlier', '410 next to 20 to 110. A typo for 41? Investigate before you treat it. It will pull every mean-based statistic.'],
          ['cat', '🔤 strings', 'Models read numbers. <span class="mono">contract</span> has an order (month → 1 year → 2 years); <span class="mono">payment</span> does not.'],
          ['unk', '🆕 an unseen category', 'Row 15 arrives in production with "Crypto wallet". Your encoder never saw it. Will the job crash?'],
          ['big', '📏 different scales', 'tenure 1–72 months, total charges up to 7,920 dollars. Distance-based models would only see total charges.']];
        var box = h(title('Fifteen rows, <em>five problems</em>', 'Click a problem to light it up. The same rows go through the prep lab at the end.') +
          '<div class="probs">' + P.map(function (p, i) { return '<button data-p="' + i + '">' + p[1] + '</button>'; }).join('') + '</div><div class="card sk thin" id="pn"><span class="note">pick a problem ↑</span></div>' +
          '<div class="slwrap mt" style="max-height:none"><table class="dt2 rawt"><tr><th>split</th><th>id</th><th>contract</th><th>payment</th><th>tenure</th><th>monthly_fee</th><th>total_charges</th><th>churn</th></tr>' +
          R.map(function (r) {
            var c = function (v, k) { return '<td class="' + k + '">' + (v === null ? '<i class="nul">null</i>' : esc(v)) + '</td>'; };
            return '<tr><td>' + { train: '🏋️ train', test: '🧪 test', 'new': '🆕 new' }[r[1]] + '</td><td>' + r[0] + '</td>' + c(r[2], 'cat') + c(r[3], (r[3] === null ? 'nul ' : '') + (r[3] === 'Crypto wallet' ? 'unk ' : '') + 'cat') +
              c(r[4], (r[4] === null ? 'nul ' : '') + 'big') + c(r[5], (r[5] === null ? 'nul ' : '') + (r[5] === 410 ? 'out ' : '')) + c(r[6], (r[6] === null ? 'nul ' : '') + 'big') + c(r[7], '') + '</tr>';
          }).join('') + '</table></div>');
        el.appendChild(box);
        box.querySelectorAll('[data-p]').forEach(function (b) {
          b.onclick = function () {
            var p = P[+b.dataset.p];
            box.querySelectorAll('[data-p]').forEach(function (x) { x.classList.toggle('on', x === b); });
            box.querySelectorAll('.rawt td').forEach(function (td) { td.classList.toggle('lit', td.classList.contains(p[0])); });
            box.querySelector('#pn').innerHTML = '<b>' + p[1] + '</b>: ' + p[2];
          };
        });
      },
      function (el) {
        var R = window.PrepLab.data().filter(function (r) { return r[1] === 'train'; });
        var cols = [['contract', 2, 's'], ['payment', 3, 's'], ['tenure', 4, 'n'], ['monthly_fee', 5, 'n'], ['total_charges', 6, 'n'], ['churn', 7, 'n']];
        var prof = cols.map(function (c) {
          var v = R.map(function (r) { return r[c[1]]; }), nn = v.filter(function (x) { return x !== null; }), miss = v.length - nn.length, dist = {};
          nn.forEach(function (x) { dist[x] = 1; });
          var bars = '';
          if (c[2] === 'n') {
            var lo = Math.min.apply(null, nn), hi = Math.max.apply(null, nn), b = [0, 0, 0, 0, 0, 0, 0, 0];
            nn.forEach(function (x) { b[Math.min(7, Math.floor((x - lo) / ((hi - lo) || 1) * 8))]++; });
            bars = '<span class="hist">' + b.map(function (k) { return '<i style="height:' + (4 + k * 7) + 'px"></i>'; }).join('') + '</span><small>' + n2(lo) + ' – ' + n2(hi) + '</small>';
          } else bars = '<small>' + Object.keys(dist).length + ' distinct</small>';
          return '<tr><td><b>' + c[0] + '</b><br><small>' + (c[2] === 'n' ? 'double' : 'string') + '</small></td><td><span class="mbar"><i style="width:' + (miss / v.length * 100) + '%"></i></span> ' + Math.round(miss / v.length * 100) + ' %</td><td>' + bars + '</td></tr>';
        }).join('');
        el.appendChild(h(title('The <em>Data Profile</em>, before any code', '<span class="mono">display(df)</span>, then <b>+ › Data Profile</b>: count, missing %, distinct values, min / max and a histogram per column. Here: the 11 training rows.') +
          '<div class="cols"><div><table class="dt2 mini prof"><tr><th>column</th><th>missing</th><th>distribution</th></tr>' + prof + '</table><div class="hint big">Look at <span class="mono">monthly_fee</span> and <span class="mono">total_charges</span>: almost every row sits in the first bar. One far value stretches the axis.</div></div>' +
          '<div>' + py('from pyspark.sql import functions as F\n\n# exact null counts per column, usable in code\ndisplay(df.select([F.count(F.when(F.col(c).isNull(), c)).alias(c)\n                   for c in df.columns]))\n\n# the "count" row = non-null values per column\ndisplay(df.summary("count"))\n\n# class balance of the label\ndisplay(df.groupBy("churn").count())') +
          '<div class="callout sk thin"><b>Genie Code</b> can write the EDA for you: "plot the percentage of missing values per column of <span class="mono">df</span>". Read the code before you run it.</div></div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Pin the <em>exact</em> data you trained on', 'A model is data + code. Delta keeps every version of the table, so a training run can name the version it read.') +
          '<div class="cols"><div>' + list(['Save the data as a Delta table in Unity Catalog: governed, discoverable, with lineage.', 'Every write is a new <b>version</b>. <span class="mono">DESCRIBE HISTORY</span> lists them.',
            'Read the exact version back: <span class="mono">versionAsOf</span> or <span class="mono">timestampAsOf</span>.', '-Time travel is not a backup: VACUUM removes old files after 7 days by default. Record the version, or keep a snapshot.',
            '+<b>Data profiling</b> in Unity Catalog (formerly Lakehouse Monitoring) recomputes the profile on a schedule and tracks drift.']) + '</div>' +
          '<div>' + py('df.write.mode("overwrite").saveAsTable("churn_bronze")\n\nspark.sql("DESCRIBE HISTORY churn_bronze").display()\n\n# the training run logs: churn_bronze @ version 3\ntrain_src = (spark.read\n    .option("versionAsOf", 3)\n    .table("churn_bronze"))') + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'explore', q: 'Six months after training, an auditor asks you to reproduce the training data exactly. What should you have done at training time?',
          options: ['Nothing: Delta time travel keeps every version forever', 'Recorded the table version (or kept a snapshot), because VACUUM removes old data files after the retention period', 'Saved the notebook only', 'Turned on the Data Profile'],
          correct: 1, why: 'Time travel works only while the old data files exist. Log the version you trained on with the run, and keep a snapshot when you need it longer than the retention period.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 3 ── clean
  var FEES = [70.2, 25.0, 55.5, 80.1, 45.0, 110.0, 65.0, 95.0, 20.5, 410.0];
  SC.push({
    id: 'clean', icon: '🧹', title: 'Clean: types, errors, outliers', sub: 'Fix what is wrong with fixed rules. Treat what is extreme with care.',
    thumb: '<span style="font-size:44px">🧹</span><span class="tag">IQR</span><span class="tag">z &gt; 3</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('An error is not the same as an <em>outlier</em>') + '<div class="cmp" style="--n:3">' +
          '<div class="card sk"><h4>🔧 Wrong type</h4>' + list(['"Yes" / "No" stored as text: <span class="mono">cast("boolean")</span>.', 'Numbers read as strings: cast to double; text that is not a number becomes null.', '+A fixed rule: run it before the split.']) + '</div>' +
          '<div class="card sk alt"><h4>⛔ Invalid value</h4>' + list(['Impossible: a negative charge, an age of 212.', 'Fix it or remove the row.', '+Domain rules catch these. Check them first.']) + '</div>' +
          '<div class="card sk"><h4>📈 Outlier</h4>' + list(['Possible but far from the rest: a 410 dollar fee.', 'Maybe a typo, maybe your best customer.', '-Investigate before you delete. Bounds learned from data are fit on train.']) + '</div></div>' +
          py('df = (df.withColumn("paperless", F.col("paperless").cast("boolean"))   # "Yes" → true\n        .filter((F.col("total_charges") >= 0) | F.col("total_charges").isNull()))  # keep nulls for imputation')));
      },
      function (el) {
        var box = h(title('Find the outlier: <em>IQR</em> or <em>z-score</em>', 'The 10 training values of monthly_fee. Move the slider and pick a treatment. Bounds come from the training rows.') +
          '<div class="row"><div class="tabs" id="om"><button data-m="iqr" class="on">IQR rule</button><button data-m="z">z-score</button></div><div class="slider"><span id="okl">k</span><input type="range" id="ok" min="0.5" max="3" step="0.1" value="1.5"><b id="okv">1.5</b></div></div>' +
          '<div id="ol"></div><div class="tabs" id="ot"><span class="small" style="align-self:center">treatment:</span><button data-t="none" class="on">only look</button><button data-t="remove">remove</button><button data-t="cap">cap (winsorize)</button><button data-t="log">log transform</button><button data-t="flag">flag column</button></div><div id="oo"></div>');
        el.appendChild(box);
        var m = 'iqr', t = 'none';
        function draw() {
          var k = +box.querySelector('#ok').value, lo, hi, txt;
          box.querySelector('#okv').textContent = k.toFixed(1);
          if (m === 'iqr') { var q1 = quant(FEES, .25), q3 = quant(FEES, .75), iqr = q3 - q1; lo = q1 - k * iqr; hi = q3 + k * iqr; txt = 'Q1 = ' + n2(q1) + ', Q3 = ' + n2(q3) + ', IQR = ' + n2(iqr) + ' → bounds [' + n2(lo) + ', ' + n2(hi) + ']'; }
          else { var mu = mean(FEES), s = sd(FEES); lo = mu - k * s; hi = mu + k * s; txt = 'mean = ' + n2(mu) + ', std = ' + n2(s) + ' → bounds [' + n2(lo) + ', ' + n2(hi) + ']. The outlier itself inflates the mean and std it is measured against.'; }
          var out = FEES.map(function (v) { return v < lo || v > hi; });
          box.querySelector('#ol').innerHTML = line(FEES, { lo: 0, hi: 420, cls: out.map(function (x) { return x ? 'bad' : ''; }), bands: [[Math.max(0, lo), Math.min(420, hi)]], marks: [[Math.max(0, lo), 'lower', 'lo'], [Math.min(420, hi), 'upper', 'hi']] }) + '<div class="small">' + txt + ' · <b>' + out.filter(Boolean).length + '</b> flagged</div>';
          var res = FEES.slice(), note = '';
          if (t === 'remove') { res = FEES.filter(function (v, i) { return !out[i]; }); note = 'Simple, but the row is gone. Good for clear errors, risky for real extremes.'; }
          if (t === 'cap') { res = FEES.map(function (v) { return Math.min(hi, Math.max(lo, v)); }); note = 'Every row stays; extremes are pulled to the bound: <span class="mono">F.least(F.greatest(col, lo), hi)</span>.'; }
          if (t === 'log') { res = FEES.map(function (v) { return Math.log1p(v); }); note = 'log1p compresses the long tail. The feature now means "log dollars".'; }
          if (t === 'flag') note = 'Values stay; a new <span class="mono">is_outlier</span> column (' + out.map(function (x) { return x ? 1 : 0; }).join(' ') + ') lets the model decide whether extremes matter.';
          if (t === 'none') note = 'Look first. Is 410 possible for this plan? Ask the data owner.';
          box.querySelector('#oo').innerHTML = (t === 'none' || t === 'flag' ? '' : line(res, {})) + '<div class="stats3"><div>mean <b>' + n2(mean(res)) + '</b></div><div>median <b>' + n2(quant(res, .5)) + '</b></div><div>std <b>' + n2(sd(res)) + '</b></div><div>rows <b>' + res.length + '</b></div></div><div class="verdict">' + note + '</div>';
        }
        box.querySelector('#ok').oninput = draw;
        box.querySelectorAll('#om button').forEach(function (b) { b.onclick = function () { m = b.dataset.m; box.querySelectorAll('#om button').forEach(function (x) { x.classList.toggle('on', x === b); }); box.querySelector('#ok').value = m === 'iqr' ? 1.5 : 2; box.querySelector('#okl').textContent = m === 'iqr' ? 'k' : 'z'; draw(); }; });
        box.querySelectorAll('#ot button').forEach(function (b) { b.onclick = function () { t = b.dataset.t; box.querySelectorAll('#ot button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
      },
      function (el) {
        el.appendChild(h(title('Bounds are <em>learned</em>: fit them on train', 'approxQuantile computes the quartiles at scale. Compute them once on the training rows and apply the same numbers to every split.') +
          '<div class="cols"><div>' + py('q1, q3 = train_df.approxQuantile("monthly_fee", [0.25, 0.75], 0.01)\niqr = q3 - q1\nlo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr\n\ndef cap(df):\n    return df.withColumn("monthly_fee",\n        F.least(F.greatest(F.col("monthly_fee"), F.lit(lo)), F.lit(hi)))\n\ntrain_df, test_df = cap(train_df), cap(test_df)   # same lo / hi') + '</div>' +
          '<div><table class="tbl"><tr><th>Method</th><th>Use when</th></tr><tr><td>Domain rules</td><td>always first: tenure &lt; 0, age &gt; 120</td></tr><tr><td>IQR</td><td>skewed data; robust to the extremes</td></tr><tr><td>z-score &gt; 3</td><td>roughly normal data</td></tr><tr><td>box plot, histogram</td><td>before you pick a rule</td></tr></table>' +
          '<div class="callout sk thin">Robust tools reduce the damage without touching the data: the <b>median</b> for imputation, <b>RobustScaler</b> for scaling.</div></div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'clean', q: 'Which of these can safely run <b>before</b> the train / test split?',
          options: ['Capping at Q3 + 1.5 × IQR', 'Removing rows where <span class="mono">total_charges &lt; 0</span>', 'Filling nulls with the mean', 'Building the list of payment methods'],
          correct: 1, why: 'A negative charge is impossible: a fixed domain rule that learns nothing from the other rows. The other three compute something from the rows, so they are fit on train.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 4 ── split and sample
  SC.push({
    id: 'split', icon: '✂️', title: 'Split and sample', sub: 'Random, by time, by customer. And samples, which are not splits.',
    thumb: '<div class="th-split"><span class="a"></span><span class="b"></span></div>',
    steps: [
      function (el) {
        var box = h(title('<em>randomSplit</em>: about 80 / 20', 'Each row draws a random number. The proportions are approximate; the seed makes them repeatable.') +
          '<div class="row"><span class="mono">train_df, test_df = df.randomSplit([0.8, 0.2], seed=</span><input id="sd" type="number" value="42" style="width:70px" class="mono"><span class="mono">)</span><button class="btn acc" id="sgo">▶ split</button></div>' +
          '<div class="bins"><div class="bin"><h6>🏋️ train <b id="ctr"></b></h6><div id="btr"></div></div><div class="bin te"><h6>🧪 test <b id="cte"></b></h6><div id="bte"></div></div></div><div class="hint big" id="sh"></div>');
        el.appendChild(box);
        function go() {
          var r = rnd(+box.querySelector('#sd').value || 0), tr = [], te = [];
          for (var i = 1; i <= 40; i++) (r() < 0.8 ? tr : te).push(i);
          var dot = function (i, k) { return '<i style="animation-delay:' + (k * 0.02) + 's">' + i + '</i>'; };
          box.querySelector('#btr').innerHTML = tr.map(dot).join(''); box.querySelector('#bte').innerHTML = te.map(dot).join('');
          box.querySelector('#ctr').textContent = tr.length; box.querySelector('#cte').textContent = te.length;
          box.querySelector('#sh').innerHTML = '40 rows → ' + tr.length + ' / ' + te.length + ', not exactly 32 / 8. Same seed, same split. Change the seed and split again.';
        }
        box.querySelector('#sgo').onclick = go; go();
      },
      function (el) {
        var box = h(title('Time-ordered data: split by <em>date</em>', 'Monthly snapshots, Jan to Dec. A random split trains on December and tests on March: the model learns from the future.') +
          '<div class="tabs" id="tm"><button data-m="rand">randomSplit</button><button data-m="time" class="on">cutoff date</button></div><div class="slider" id="tsl"><span>cutoff</span><input type="range" id="tc" min="3" max="11" value="9"><b id="tcv"></b></div><div class="months" id="mo"></div><div class="verdict" id="tv"></div>');
        el.appendChild(box);
        var MN = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '), m = 'time';
        function draw() {
          var c = +box.querySelector('#tc').value, r = rnd(7), html = '', late = 0, test = [], train = [];
          box.querySelector('#tcv').textContent = MN[c] + ' 1';
          box.querySelector('#tsl').style.visibility = m === 'time' ? 'visible' : 'hidden';
          MN.forEach(function (mn, i) {
            var cells = '';
            for (var k = 0; k < 4; k++) { var isTest = m === 'time' ? i >= c : r() < 0.25; (isTest ? test : train).push(i); cells += '<i class="' + (isTest ? 'te' : 'tr') + '"></i>'; }
            html += '<div class="mcol' + (m === 'time' && i === c ? ' cut' : '') + '"><span>' + mn + '</span>' + cells + '</div>';
          });
          var maxTrain = Math.max.apply(null, train);
          late = test.filter(function (i) { return i < maxTrain; }).length;
          box.querySelector('#mo').innerHTML = html;
          var v = box.querySelector('#tv');
          v.className = 'verdict ' + (late ? 'bad' : 'good');
          v.innerHTML = late ? '✗ <b>' + late + '</b> test rows are older than the newest training row. The model is graded on the past using knowledge of the future.' :
            '✓ Train on everything before ' + MN[c] + ' 1, test on what comes after: the same way the model is used in production. <span class="mono">F.col("month") &lt; cutoff</span>';
        }
        box.querySelector('#tc').oninput = draw;
        box.querySelectorAll('#tm button').forEach(function (b) { b.onclick = function () { m = b.dataset.m; box.querySelectorAll('#tm button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
        el.appendChild(h('<div class="callout sk thin">Cross-validation for time data does <b>forward chaining</b>: train on months 1–3, validate on 4; train on 1–4, validate on 5… Spark ML\'s <span class="mono">CrossValidator</span> assigns folds at random, so build these windows yourself with date filters.</div>'));
      },
      function (el) {
        var box = h(title('Many rows per customer: split the <em>customers</em>', 'Eight customers, three monthly rows each. Which split keeps a customer on one side?') +
          '<div class="tabs" id="gm"><button data-m="rows" class="on">split the rows</button><button data-m="ids">split the customer ids</button></div><div class="custs" id="gc"></div><div class="verdict" id="gv"></div>' +
          py('train_ids, test_ids = (df.select("customer_id").distinct()\n                         .randomSplit([0.8, 0.2], seed=42))\ntrain_df = df.join(train_ids, "customer_id")\ntest_df  = df.join(test_ids,  "customer_id")'));
        el.appendChild(box);
        var m = 'rows', who = '🧑 👩 🧔 👵 🧒 👨 👱 🧕'.split(' ');
        function draw() {
          var r = rnd(11), both = 0, html = '';
          who.forEach(function (w, i) {
            var cust = r() < 0.25, cells = '', sides = {};
            for (var k = 0; k < 3; k++) { var t = m === 'ids' ? cust : r() < 0.25; sides[t] = 1; cells += '<i class="' + (t ? 'te' : 'tr') + '"></i>'; }
            var mixed = Object.keys(sides).length > 1; if (mixed) both++;
            html += '<div class="cust' + (mixed ? ' mixed' : '') + '"><b>' + w + '</b>' + cells + '</div>';
          });
          box.querySelector('#gc').innerHTML = html;
          var v = box.querySelector('#gv');
          v.className = 'verdict ' + (both ? 'bad' : 'good');
          v.innerHTML = both ? '✗ <b>' + both + '</b> customers are in train <b>and</b> test. The model partly recognises them instead of generalising, and the test score is too optimistic.' : '✓ Every customer is entirely in train or entirely in test. The row split is only roughly 80 / 20, because whole groups move together.';
        }
        box.querySelectorAll('#gm button').forEach(function (b) { b.onclick = function () { m = b.dataset.m; box.querySelectorAll('#gm button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
      },
      function (el) {
        var box = h(title('Sampling: a smaller copy, <em>not</em> a split', '60 subscribers in 6 stores; 12 churners (● red). Draw a 25 % sample three ways and compare the churn rate.') +
          '<div class="tabs" id="smm"><button data-m="random" class="on">random · sample()</button><button data-m="strat">stratified · sampleBy()</button><button data-m="cluster">cluster · sample the stores</button></div><div class="stores" id="sst"></div><div class="row"><button class="btn acc" id="sgo2">▶ draw again</button><span id="sres" class="small"></span></div><div id="scode"></div>');
        el.appendChild(box);
        var m = 'random', seed = 3, POP = [];
        var r0 = rnd(5);
        for (var i = 0; i < 60; i++) POP.push({ store: Math.floor(i / 10), churn: r0() < 0.2 });
        var CODE = { random: 'df.sample(withReplacement=False, fraction=0.25, seed=42)', strat: 'df.sampleBy("churn", fractions={0: 0.25, 1: 0.25}, seed=42)', cluster: 'stores = df.select("store_id").distinct().sample(fraction=0.34, seed=42)\nsample = df.join(stores, "store_id")    # every row of the chosen stores' };
        function draw() {
          var r = rnd(seed), pick = POP.map(function () { return false; });
          if (m === 'random') POP.forEach(function (p, i) { pick[i] = r() < 0.25; });
          if (m === 'strat') POP.forEach(function (p, i) { pick[i] = r() < 0.25; });
          if (m === 'strat') { // keep the class ratio: pick exactly 25 % of each class
            [true, false].forEach(function (c) { var idx = POP.map(function (p, i) { return p.churn === c ? i : -1; }).filter(function (i) { return i >= 0; }); idx.forEach(function (i) { pick[i] = false; }); idx.sort(function () { return r() - 0.5; }).slice(0, Math.round(idx.length * 0.25)).forEach(function (i) { pick[i] = true; }); });
          }
          if (m === 'cluster') { var st = [0, 1, 2, 3, 4, 5].sort(function () { return r() - 0.5; }).slice(0, 2); POP.forEach(function (p, i) { pick[i] = st.indexOf(p.store) >= 0; }); }
          var html = '';
          for (var s = 0; s < 6; s++) html += '<div class="shop"><h6>🏪 ' + (s + 1) + '</h6>' + POP.map(function (p, i) { return p.store === s ? '<i class="' + (p.churn ? 'c ' : '') + (pick[i] ? 'on' : '') + '"></i>' : ''; }).join('') + '</div>';
          box.querySelector('#sst').innerHTML = html;
          var sel = POP.filter(function (p, i) { return pick[i]; }), ch = sel.filter(function (p) { return p.churn; }).length;
          box.querySelector('#sres').innerHTML = 'sample: <b>' + sel.length + '</b> rows, churn rate <b>' + (sel.length ? Math.round(ch / sel.length * 100) : 0) + ' %</b> (population ' + Math.round(POP.filter(function (p) { return p.churn; }).length / 60 * 100) + ' %)';
          box.querySelector('#scode').innerHTML = py(CODE[m]);
        }
        box.querySelector('#sgo2').onclick = function () { seed++; draw(); };
        box.querySelectorAll('#smm button').forEach(function (b) { b.onclick = function () { m = b.dataset.m; box.querySelectorAll('#smm button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        draw();
        el.appendChild(h('<div class="hint big">In Spark, <span class="mono">sample</span> and <span class="mono">sampleBy</span> keep each row with the given probability, so sizes are approximate. This page picks exact counts for stratified to make the idea visible.</div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'split', q: 'You predict next month\'s churn from monthly snapshots of each subscriber. Which split gives an honest test score?',
          options: ['<span class="mono">randomSplit([0.8, 0.2])</span> on the rows', 'Stratified sampling on churn', 'Train on months before a cutoff date, test on the months after it, and keep each subscriber\'s history before the cutoff only in training', 'Use the same rows for train and test, with a different seed'],
          correct: 2, why: 'Time-ordered data must be split by time, so the model never learns from rows that come after the ones it is graded on.' }));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 5 ── impute
  SC.push({
    id: 'impute', icon: '🩹', title: 'Imputation', sub: 'Drop, label as "Unknown", use a domain default, or fill a learned value.',
    thumb: '<div class="th-imp"><span>24</span><span class="x">null</span><span>60</span><span>→</span><span class="f">24</span></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('Four ways to handle a <em>gap</em>', 'Choose column by column. Most projects use a mix.') + '<div class="cmp" style="--n:4">' +
          '<div class="card sk"><h4>🗑️ Drop</h4>' + list(['A mostly empty column: <span class="mono">df.drop(c)</span>.', 'Rows with too few values: <span class="mono">na.drop(thresh=k)</span> keeps rows with at least k non-nulls.', '-Bias, if values are not missing at random.']) + '</div>' +
          '<div class="card sk alt"><h4>🏷️ Own category</h4>' + list(['Categorical: <span class="mono">fillna("Unknown")</span>.', 'Or keep the null: <span class="mono">StringIndexer(handleInvalid="keep")</span>.', '+"Did not answer" can carry signal.']) + '</div>' +
          '<div class="card sk"><h4>📖 Domain default</h4>' + list(['Missing <span class="mono">online_security</span> means "No".', '-Only when the data definition says so.']) + '</div>' +
          '<div class="card sk alt"><h4>🎓 Impute</h4>' + list(['Numbers: Spark ML <span class="mono">Imputer</span>, mean or median.', '+Learned on train, applied to all.', 'Model-based (KNN, regression): optional, costly.']) + '</div></div>' +
          '<div class="callout sk thin">Never fill the <b>label</b>. A row without a known churn value is investigated or removed, not guessed.</div>'));
      },
      function (el) {
        var box = h(title('Mean or median? <em>Ask the outlier</em>', 'The 10 known monthly fees from training. Row 7 is missing. Toggle the 410 typo and watch both candidates.') +
          '<label class="toggle big"><input type="checkbox" id="io" checked><span class="sw"></span> include the 410 typo</label><div id="il"></div><div class="stats3" id="is"></div><div class="verdict" id="iv"></div>' +
          py('imputer = Imputer(inputCols=["monthly_fee"], outputCols=["monthly_fee_imp"],\n                  strategy="median")       # "mean", "median" or "mode"\nimputer_model = imputer.fit(train_df)     # learns 65.0 from train only\ndisplay(imputer_model.surrogateDF)'));
        el.appendChild(box);
        function draw() {
          var v = box.querySelector('#io').checked ? FEES : FEES.slice(0, 9), mu = mean(v), md = quant(v, .5);
          box.querySelector('#il').innerHTML = line(v, { lo: 0, hi: 420, marks: [[mu, 'mean ' + n2(mu), 'mean', 10], [md, 'median ' + n2(md), 'med', 86]] });
          box.querySelector('#is').innerHTML = '<div>mean <b>' + n2(mu) + '</b></div><div>median <b>' + n2(md) + '</b></div><div>row 7 gets <b>' + n2(md) + '</b> (median)</div>';
          var vv = box.querySelector('#iv');
          vv.className = 'verdict ' + (Math.abs(mu - md) > 20 ? 'warn' : 'good');
          vv.innerHTML = Math.abs(mu - md) > 20 ? 'One typo moved the mean to <b>' + n2(mu) + '</b>, above 8 of the 10 real fees. The median did not care. For skewed columns and amounts, start with the median.' : 'Without the outlier, mean and median are close. Mean is fine for roughly symmetric columns.';
        }
        box.querySelector('#io').onchange = draw; draw();
        el.appendChild(h('<div class="hint big">On Serverless, <span class="mono">strategy="mode"</span> fails with <span class="mono">UC_COMMAND_NOT_SUPPORTED</span>. For a 0 / 1 column, the median is its most common value. For strings use <span class="mono">fillna</span> or StringIndexer.</div>'));
      },
      function (el) {
        var box = h(title('One value in every gap <em>squeezes</em> the column', 'Slide how much is missing. All gaps get the median, so values pile up at one point and the spread shrinks.') +
          '<div class="slider"><span>missing</span><input type="range" id="pm" min="0" max="60" step="5" value="30"><b id="pmv"></b></div><div class="histo" id="ph"></div><div class="stats3" id="ps"></div>' +
          '<div class="cols mt"><div>' + list(['Compare the distribution before and after imputation.', '+Add a <span class="mono">_was_missing</span> flag <b>before</b> you impute, so the model still knows which values were guesses.', 'Use flags selectively, and check whether they help.']) + '</div>' +
          '<div>' + py('df = df.withColumn("tenure_was_missing",\n        F.col("tenure").isNull().cast("int"))   # BEFORE the Imputer') + '</div></div>');
        el.appendChild(box);
        var r = rnd(9), BASE = [];
        for (var i = 0; i < 80; i++) BASE.push(Math.round(Math.max(1, Math.min(72, 30 + (r() + r() + r() - 1.5) * 34))));
        function draw() {
          var p = +box.querySelector('#pm').value, rr = rnd(4), vals = BASE.map(function (v) { return rr() * 100 < p ? null : v; });
          var known = vals.filter(function (v) { return v !== null; }), md = quant(known, .5), filled = vals.map(function (v) { return v === null ? md : v; });
          box.querySelector('#pmv').textContent = p + ' %';
          var b = new Array(12).fill(0), bf = new Array(12).fill(0);
          known.forEach(function (v) { b[Math.min(11, Math.floor((v - 1) / 6))]++; });
          filled.forEach(function (v) { bf[Math.min(11, Math.floor((v - 1) / 6))]++; });
          var mx = Math.max.apply(null, bf);
          box.querySelector('#ph').innerHTML = bf.map(function (k, i) { return '<div class="hb"><i class="f" style="height:' + (k / mx * 120) + 'px"></i><i class="o" style="height:' + (b[i] / mx * 120) + 'px"></i><small>' + (i * 6 + 1) + '</small></div>'; }).join('');
          box.querySelector('#ps').innerHTML = '<div>known std <b>' + n2(sd(known)) + '</b></div><div>after fill std <b>' + n2(sd(filled)) + '</b></div><div>median <b>' + md + '</b></div><div><span class="lg o"></span> observed <span class="lg f"></span> filled</div>';
        }
        box.querySelector('#pm').oninput = draw; draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'impute', q: 'Why is the <span class="mono">tenure_was_missing</span> flag created <b>before</b> the Imputer runs?',
          options: ['Imputer deletes the original column', 'After imputing, the filled values look like real ones, so the information "this was missing" would be lost', 'Spark requires flags to come first in a Pipeline', 'It makes the median more accurate'],
          correct: 1, why: 'Once 24 is in the cell, nobody can tell it was a guess. The flag keeps that fact, and the model can learn whether missingness itself predicts churn.' }));
        el.appendChild(h(tryLab('impute', 'Run the Imputer on the 15 rows')));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 6 ── encode
  var CON = [['Month-to-month', 5], ['Two year', 4], ['One year', 2]];
  SC.push({
    id: 'encode', icon: '🔤', title: 'Encoding categories', sub: 'StringIndexer → OneHotEncoder, unseen values, order, rare values and target encoding.',
    thumb: '<div class="th-ohe"><span class="mono">"Two year"</span>→<span class="mono">1</span>→<span class="sq"><i></i><i class="on"></i></span></div>',
    steps: [
      function (el) {
        el.appendChild(h(title('What kind of <em>category</em> is it?', 'The type decides the starting point.') +
          '<table class="tbl"><tr><th>Type</th><th>Example</th><th>Start with</th></tr>' +
          '<tr><td>Nominal: no order</td><td>payment, city</td><td>StringIndexer → OneHotEncoder</td></tr>' +
          '<tr><td>Ordinal: a real order</td><td>contract: month · 1 year · 2 years</td><td>your own mapping 1 · 2 · 3</td></tr>' +
          '<tr><td>Binary</td><td>Yes / No</td><td>a 0 / 1 column</td></tr>' +
          '<tr><td>High cardinality</td><td>product id, ZIP code</td><td>group rare values into "Other"; target encoding; embeddings</td></tr></table>' +
          py('cat_cols = [f.name for f in df.schema.fields\n            if f.dataType.simpleString() == "string" and f.name not in ("id", "churn")]\ndisplay(df.select([F.approx_count_distinct(c).alias(c) for c in cat_cols]))')));
      },
      function (el) {
        var box = h(title('Follow one value through the <em>encoder</em>', 'StringIndexer learned the contract labels from training, most frequent first. Pick an incoming value.') +
          '<div class="tabs" id="ev"><button data-v="Month-to-month" class="on">Month-to-month</button><button data-v="Two year">Two year</button><button data-v="One year">One year</button><button data-v="null">null</button><button data-v="Three year">"Three year" (unseen)</button></div>' +
          '<div class="row"><label>handleInvalid <select id="eh"><option value="keep">keep</option><option value="error">error (default)</option><option value="skip">skip</option></select></label><label class="toggle"><input type="checkbox" id="ed" checked><span class="sw"></span> dropLast</label></div>' +
          '<div class="encflow" id="ef"></div><div class="verdict" id="evd"></div>');
        el.appendChild(box);
        var v = 'Month-to-month';
        function draw() {
          var keep = box.querySelector('#eh').value, dl = box.querySelector('#ed').checked, names = CON.map(function (c) { return c[0]; });
          var i = v === 'null' ? -1 : names.indexOf(v), err = null, skip = false;
          if (i < 0) { if (keep === 'keep') i = names.length; else if (keep === 'skip') skip = true; else err = v === 'null' ? 'StringIndexer encountered NULL value. To handle or skip NULLS, try setting StringIndexer.handleInvalid.' : 'Unseen label: Three year. To handle unseen labels, set Param handleInvalid to keep.'; }
          var slots = names.concat(keep === 'keep' ? ['__unknown'] : []), size = slots.length - (dl ? 1 : 0);
          var labs = '<div class="elab">' + slots.map(function (s, k) { return '<span class="' + (k === i ? 'on' : '') + (k >= size ? ' dropd' : '') + '"><b>' + k + '</b> ' + s + (CON[k] ? ' <small>×' + CON[k][1] + '</small>' : '') + '</span>'; }).join('') + '</div>';
          var vecH = err || skip ? '<span class="nul">–</span>' : '<span class="ohe big">' + slots.slice(0, size).map(function (s, k) { return '<i class="' + (k === i ? 'on' : '') + '" title="' + s + '"></i>'; }).join('') + '</span><small>' + slots.slice(0, size).join(' · ') + '</small>';
          box.querySelector('#ef').innerHTML = '<div class="ebox"><h6>input</h6><b class="mono">' + (v === 'null' ? 'null' : '"' + v + '"') + '</b></div><span class="arr">→</span><div class="ebox"><h6>StringIndexer</h6>' + labs + '<b class="mono">' + (err ? '💥' : skip ? 'row dropped' : i + '.0') + '</b></div><span class="arr">→</span><div class="ebox"><h6>OneHotEncoder · size ' + size + '</h6>' + vecH + '</div>';
          var d = box.querySelector('#evd');
          if (err) { d.className = 'verdict bad'; d.innerHTML = '<span class="mono">' + err + '</span>'; }
          else if (skip) { d.className = 'verdict warn'; d.innerHTML = 'The row disappears. In training you lose data; in production the customer gets <b>no prediction</b>.'; }
          else if (i >= size) { d.className = 'verdict good'; d.innerHTML = 'The value got index ' + i + ', and dropLast removed that position: an <b>all-zero vector</b>. The job keeps running, and every unknown value is treated the same way.'; }
          else { d.className = 'verdict'; d.innerHTML = 'Exactly one 1. ' + (dl ? 'dropLast leaves out the last position (' + slots[size] + '); it is implied when all others are 0, which avoids a redundant column for linear models.' : 'Every category has its own position.'); }
        }
        box.querySelectorAll('#ev button').forEach(function (b) { b.onclick = function () { v = b.dataset.v; box.querySelectorAll('#ev button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
        box.querySelector('#eh').onchange = draw; box.querySelector('#ed').onchange = draw; draw();
      },
      function (el) {
        el.appendChild(h(title('An index is <em>not</em> an order', 'StringIndexer orders by frequency. For contract that gives Month-to-month 0, Two year 1, One year 2.') +
          '<div class="cols"><div><table class="dt2 mini"><tr><th>contract</th><th>StringIndexer</th><th>your mapping</th></tr><tr><td>Month-to-month</td><td>0</td><td>1</td></tr><tr><td>One year</td><td class="mk">2</td><td>2</td></tr><tr><td>Two year</td><td class="mk">1</td><td>3</td></tr></table>' +
          list(['A linear model reads 0 &lt; 1 &lt; 2 as a real scale, here in the wrong order.', 'Spark ML trees can treat indices as categories, through the column metadata; set <span class="mono">maxBins</span> ≥ the number of categories.', '+For a real order, write the mapping yourself.']) + '</div>' +
          '<div>' + py('df = df.withColumn("contract_ord",\n    F.when(F.col("contract") == "Month-to-month", 1)\n     .when(F.col("contract") == "One year", 2)\n     .when(F.col("contract") == "Two year", 3))') +
          '<div class="callout sk thin">1 · 2 · 3 still implies equal steps. Use an ordinal mapping only when the order means something for the model.</div></div></div>'));
      },
      function (el) {
        var CATS = [['Card', 1200], ['Bank transfer', 980], ['E-check', 870], ['Voucher', 12], ['Crypto wallet', 8], ['Cash', 5], ['Cheque', 3]];
        var box = h(title('Too many categories? <em>Group the rare ones</em>', 'Payment counts from the training data. Rare values become one explicit "Other"; unknown values in production land there too.') +
          '<div class="slider"><span>min_count</span><input type="range" id="rc" min="1" max="100" value="20"><b id="rcv"></b></div><div id="rb"></div>' +
          py('frequent = [r["payment"] for r in train_df.groupBy("payment").count()\n            .filter(F.col("count") >= min_count).collect() if r["payment"] is not None]\ndf = df.withColumn("payment_grouped",\n    F.when(F.col("payment").isNull(), "Unknown")\n     .when(F.col("payment").isin(frequent), F.col("payment"))\n     .otherwise("Other"))'));
        el.appendChild(box);
        function draw() {
          var k = +box.querySelector('#rc').value, mx = 1200, kept = CATS.filter(function (c) { return c[1] >= k; }).length;
          box.querySelector('#rcv').textContent = k;
          box.querySelector('#rb').innerHTML = '<div class="rare">' + CATS.map(function (c) { var o = c[1] < k; return '<div class="' + (o ? 'oth' : '') + '"><span>' + c[0] + '</span><i style="width:' + Math.max(3, Math.sqrt(c[1] / mx) * 100) + '%"></i><small>' + c[1] + (o ? ' → Other' : '') + '</small></div>'; }).join('') + '</div>' +
            '<div class="small">one-hot size: <b>' + (kept + (kept < CATS.length ? 1 : 0)) + '</b> instead of <b>' + CATS.length + '</b> (before dropLast)</div>';
        }
        box.querySelector('#rc').oninput = draw; draw();
      },
      function (el) {
        var T = [['Card', 40, 6], ['E-check', 30, 15], ['Bank transfer', 25, 4], ['Voucher', 2, 2]];
        var box = h(title('Target encoding: the category\'s <em>churn rate</em>', 'One number per category instead of many columns. Spark ML has a <span class="mono">TargetEncoder</span> (Spark 4.0+). Smoothing pulls small categories toward the overall rate.') +
          '<div class="slider"><span>smoothing</span><input type="range" id="ts" min="0" max="40" value="0"><b id="tsv"></b></div><div id="tt"></div>' +
          '<div class="callout sk thin red">It reads the <b>label</b>. Fit it on the training rows only, or the test answers leak straight into a feature. Unseen categories get the overall rate.</div>');
        el.appendChild(box);
        function draw() {
          var m = +box.querySelector('#ts').value, N = 0, C = 0;
          T.forEach(function (t) { N += t[1]; C += t[2]; });
          var g = C / N;
          box.querySelector('#tsv').textContent = m;
          box.querySelector('#tt').innerHTML = '<table class="dt2 mini"><tr><th>payment</th><th>rows</th><th>churners</th><th>raw rate</th><th>encoded</th></tr>' + T.map(function (t) {
            var e = (t[2] + m * g) / (t[1] + m);
            return '<tr><td>' + t[0] + '</td><td>' + t[1] + '</td><td>' + t[2] + '</td><td>' + n2(t[2] / t[1]) + '</td><td class="mk"><b>' + e.toFixed(2) + '</b> <span class="tebar"><i style="width:' + e * 100 + '%"></i></span></td></tr>';
          }).join('') + '<tr><td><i>never seen</i></td><td>0</td><td>–</td><td>–</td><td class="mk"><b>' + g.toFixed(2) + '</b> overall</td></tr></table><div class="hint big">Voucher has 2 rows and 2 churners: a raw rate of 1.00 is over-confident. Raise the smoothing and it moves toward ' + g.toFixed(2) + '.</div>';
        }
        box.querySelector('#ts').oninput = draw; draw();
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'encode', q: 'With <span class="mono">StringIndexer(handleInvalid="keep")</span> and <span class="mono">OneHotEncoder()</span> (default dropLast), what does a payment method never seen in training become?',
          options: ['An error at inference time', 'The vector of the most frequent category', 'An all-zero vector', 'A new column added on the fly'],
          correct: 2, why: '"keep" gives unknown values one extra index, and dropLast removes the last position, which is exactly that index. Nulls and unseen values become all zeros.' }));
        el.appendChild(h(tryLab('encode', 'Encode the 15 rows')));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 7 ── scale
  SC.push({
    id: 'scale', icon: '📏', title: 'Standardization', sub: 'Why units matter, three Spark ML scalers, and which models care.',
    thumb: '<div class="th-sc"><span>7,920 $</span><span>72 mo</span><span>→</span><span>2.9 · 1.8</span></div>',
    steps: [
      function (el) {
        var Q = [2, 150], A = [60, 160], B = [5, 400];
        var box = h(title('Who is the <em>nearest</em> customer?', 'KNN measures distance. A new subscriber: tenure 2 months, total charges 150 $. Two candidates.') +
          '<label class="toggle big"><input type="checkbox" id="ks"><span class="sw"></span> standardize first (z-scores)</label><div class="knn" id="kn"></div><div class="verdict" id="kv"></div>');
        el.appendChild(box);
        function draw() {
          var s = box.querySelector('#ks').checked, st = s ? [22.5, 2280] : [1, 1];
          var d = function (p) { return Math.sqrt(Math.pow((p[0] - Q[0]) / st[0], 2) + Math.pow((p[1] - Q[1]) / st[1], 2)); };
          var dA = d(A), dB = d(B), part = function (p) { return '|Δtenure| ' + n2(Math.abs(p[0] - Q[0]) / st[0]) + ', |Δtotal| ' + n2(Math.abs(p[1] - Q[1]) / st[1]); };
          box.querySelector('#kn').innerHTML = '<div class="kc q"><b>🆕 new</b>tenure 2 · total 150 $</div>' +
            '<div class="kc' + (dA < dB ? ' win' : '') + '"><b>🅰️ long-time customer</b>tenure 60 · total 160 $<small>' + part(A) + '</small><span>distance <b>' + n2(dA) + '</b></span></div>' +
            '<div class="kc' + (dB < dA ? ' win' : '') + '"><b>🅱️ new customer</b>tenure 5 · total 400 $<small>' + part(B) + '</small><span>distance <b>' + n2(dB) + '</b></span></div>';
          var v = box.querySelector('#kv');
          v.className = 'verdict ' + (s ? 'good' : 'bad');
          v.innerHTML = s ? 'After scaling (tenure std ≈ 22.5, total std ≈ 2,280), both columns count. B, also a brand new customer, is the nearest.' : 'Raw units: a 250 $ difference beats a 58-month difference. A, a 5-year customer, is "nearest" only because dollars are bigger numbers than months.';
        }
        box.querySelector('#ks').onchange = draw; draw();
      },
      function (el) {
        var box = h(title('Three scalers, <em>one outlier</em>', 'The monthly fees from training, scaled three ways. Toggle the 410 typo.') +
          '<label class="toggle big"><input type="checkbox" id="so" checked><span class="sw"></span> include the 410 typo</label><div id="sl3"></div>');
        el.appendChild(box);
        function draw() {
          var v = box.querySelector('#so').checked ? FEES : FEES.slice(0, 9), mu = mean(v), s = sd(v), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), md = quant(v, .5), iqr = quant(v, .75) - quant(v, .25);
          var rows = [
            ['StandardScaler', '(x − mean) / std · withMean=True', v.map(function (x) { return (x - mu) / s; }), 'mean ' + n2(mu) + ', std ' + n2(s), 'The outlier inflates the std, so the normal values huddle together.'],
            ['MinMaxScaler', '(x − min) / (max − min) → [0, 1]', v.map(function (x) { return (x - mn) / (mx - mn); }), 'min ' + n2(mn) + ', max ' + n2(mx), 'One extreme value squeezes everything else into a narrow band near 0.'],
            ['RobustScaler', '(x − median) / IQR · withCentering=True', v.map(function (x) { return (x - md) / iqr; }), 'median ' + n2(md) + ', IQR ' + n2(iqr), 'Median and IQR ignore the extreme: the normal values keep their spread.']];
          box.querySelector('#sl3').innerHTML = rows.map(function (r) {
            return '<div class="sc3"><div><b>' + r[0] + '</b><small class="mono">' + r[1] + '</small><small>learned: ' + r[3] + '</small></div><div>' + line(r[2], { w: 560, cls: v.map(function (x) { return x === 410 ? 'bad' : ''; }) }) + '<div class="small">' + r[4] + '</div></div></div>';
          }).join('');
        }
        box.querySelector('#so').onchange = draw; draw();
      },
      function (el) {
        el.appendChild(h(title('Who <em>needs</em> it, and the Spark defaults') + '<div class="cols"><div><table class="tbl"><tr><th>Model</th><th>Scale?</th></tr>' +
          '<tr><td>KNN, K-Means, SVM</td><td>yes: distances</td></tr><tr><td>Regularized linear / logistic</td><td>yes: fair penalty</td></tr><tr><td>Neural networks</td><td>yes: stable training</td></tr><tr><td>PCA</td><td>yes, with mixed units</td></tr><tr><td>Trees, random forest, GBT</td><td>no: splits ignore units</td></tr></table></div>' +
          '<div>' + list(['-Spark\'s <span class="mono">StandardScaler</span> defaults to <span class="mono">withMean=False</span>: it only divides by the std (centering would make sparse vectors dense). scikit-learn centers by default.',
            'Scalers read one vector column: VectorAssembler first. Scale only the numeric vector, not one-hot columns or flags.',
            'MinMaxScaler uses the training min / max: new values can land outside [0, 1].',
            '+Fit on train. On test the mean is close to 0, not exactly 0: that is the honest part.']) + '</div></div>' +
          py('assembler = VectorAssembler(inputCols=num_cols, outputCol="num_vec")\nscaler = StandardScaler(inputCol="num_vec", outputCol="num_scaled",\n                        withMean=True, withStd=True)')));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'scale', q: 'You fit <span class="mono">StandardScaler(inputCol="num_vec", outputCol="num_scaled")</span> with no other options. The scaled training values have a mean of 3.1. Why?',
          options: ['The scaler was fit on the test set', 'Spark\'s default is withMean=False: it divides by the std but does not subtract the mean', 'StandardScaler only works on normally distributed data', 'The vector was not assembled'],
          correct: 1, why: 'Set withMean=True for classic z-scores on dense tabular features.' }));
        el.appendChild(h(tryLab('scale', 'Scale the 15 rows')));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 8 ── pipeline
  var STG = [
    ['num', 'Imputer', 'fills nulls in tenure, monthly_fee, total_charges with the train medians'],
    ['num', 'VectorAssembler', 'packs the three imputed numbers into num_vec'],
    ['num', 'StandardScaler', 'learns mean and std on train: num_vec → num_scaled'],
    ['cat', 'StringIndexer', 'learns the category lists; handleInvalid="keep" for null and unseen'],
    ['cat', 'OneHotEncoder', 'index → 0/1 vector; learns the vector sizes'],
    ['all', 'VectorAssembler', 'num_scaled + one-hot vectors + flags → features']
  ];
  SC.push({
    id: 'pipeline', icon: '🧱', title: 'One pipeline, fit once', sub: 'Two branches, the right order, fit on train, save to a volume.',
    thumb: '<div class="th-pipe"><span>Imputer</span><span>Indexer</span><span>Scaler</span><span>OHE</span></div>',
    steps: [
      function (el) {
        var box = h(title('Two branches, <em>one</em> Pipeline', 'Numbers and categories take different paths and meet at the end. Press next to walk the stages.') +
          '<div class="br"><div class="brl"><h6>🔢 numeric branch</h6><div id="bn"></div></div><div class="brl"><h6>🔤 categorical branch</h6><div id="bc"></div></div><div class="brl all"><h6>🧩 join</h6><div id="ba"></div></div></div>' +
          '<div class="card sk thin mt" id="bnote"></div><div class="row mt"><button class="btn acc" id="bgo">Next →</button></div>');
        el.appendChild(box);
        var k = 0;
        function draw() {
          ['num', 'cat', 'all'].forEach(function (g) {
            box.querySelector(g === 'num' ? '#bn' : g === 'cat' ? '#bc' : '#ba').innerHTML = STG.map(function (s, i) { return s[0] !== g ? '' : '<span class="stg' + (i === k ? ' cur' : i < k ? ' done' : '') + '">' + (i + 1) + '. ' + s[1] + '</span>'; }).filter(Boolean).join('<span class="arr2"></span>');
          });
          box.querySelector('#bnote').innerHTML = '<span class="note">' + (k + 1) + '. ' + STG[k][1] + '</span><p class="lead" style="margin:6px 0 0">' + STG[k][2] + '</p>' +
            (k === 2 ? '<p class="small">Impute <b>before</b> scaling: the scaler cannot learn from nulls.</p>' : k === 5 ? '<p class="small">Scale only the numeric vector, then join. One-hot columns stay 0 / 1.</p>' : '');
          box.querySelector('#bgo').textContent = k < STG.length - 1 ? 'Next →' : '↺ Again';
        }
        box.querySelector('#bgo').onclick = function () { k = (k + 1) % STG.length; draw(); };
        draw();
      },
      function (el) {
        el.appendChild(h(title('<em>fit</em> learns, <em>transform</em> applies') + '<div class="cols"><div><table class="tbl"><tr><th>Call</th><th>What happens</th></tr>' +
          '<tr><td class="mono">pipeline.fit(train_df)</td><td>every estimator learns its numbers on train, in order; returns a <b>PipelineModel</b></td></tr>' +
          '<tr><td class="mono">model.transform(test_df)</td><td>applies the learned numbers; nothing is re-learned</td></tr>' +
          '<tr><td class="mono">model.transform(new_df)</td><td>the same, for every row in production</td></tr></table>' +
          '<div class="callout sk thin red">❌ <span class="mono">pipeline.fit(df)</span> on the full table, then split: every stage has seen the test set.</div></div>' +
          '<div>' + list(['<b>Estimators</b> learn: Imputer, StringIndexer, OneHotEncoder, StandardScaler, TargetEncoder.', '<b>Transformers</b> only apply: VectorAssembler, and every fitted model.',
            'Inspect what was learned: <span class="mono">model.stages[0].surrogateDF</span>, <span class="mono">.labelsArray</span>, <span class="mono">.mean</span>, <span class="mono">.std</span>.', '+One object holds every number, so train, test and production can never drift apart.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Save the <em>fitted</em> pipeline', 'Store it next to the data in a Unity Catalog volume: the same permissions, the same governance. Reload it for batch scoring or serving.') +
          '<div class="cols"><div>' + py('path = "/Volumes/main/ml/prep/churn_prep_v1"\npipeline_model.write().overwrite().save(path)\n\n# later, in the scoring job\nfrom pyspark.ml import PipelineModel\nprep = PipelineModel.load(path)\nready = prep.transform(new_df)') + '</div>' +
          '<div>' + list(['Version the path (<span class="mono">_v1</span>, <span class="mono">_v2</span>) like a model.', 'Keep the unscaled columns next to the vector, so you can still read and debug values.',
            'Prepared features that several models reuse belong in a <b>feature table</b>: Feature Engineering in Unity Catalog.', '-On Serverless, Spark ML has a size limit for fitted models. Keep the prep stages small.']) + '</div></div>'));
      },
      function (el, api) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(api.quiz({ id: 'pipeline', q: 'In which order do the numeric stages have to run?',
          options: ['StandardScaler → Imputer → VectorAssembler', 'VectorAssembler → StandardScaler → Imputer', 'Imputer → VectorAssembler → StandardScaler', 'Any order: Pipeline sorts the stages'],
          correct: 2, why: 'Fill the nulls first (an assembler fails on nulls), pack the numbers into one vector, then scale that vector. A Pipeline runs the stages exactly in the order you list them.' }));
        el.appendChild(h(tryLab('pipeline', 'See your pipeline as code')));
      }
    ]
  });

  // ════════════════════════════════════════════════════════════════ 9 ── the lab
  SC.push({
    id: 'lab', icon: '🧪', title: 'The prep lab', sub: 'Fifteen rows, four stages: impute, encode, scale, assemble. Run them and watch the table change.',
    thumb: '<span style="font-size:40px">🧪</span><span class="tag">Imputer</span><span class="tag">OneHot</span><span class="tag">Scaler</span>',
    steps: [function (el) { var d = document.createElement('div'); el.appendChild(d); window.PrepLab.mount(d, window.PrepLabView); window.PrepLabView = null; }]
  });

  // ════════════════════════════════════════════════════════════════ 10 ── which method when
  SC.push({
    id: 'decide', icon: '🧭', title: 'Which method when?', sub: 'Answer three questions about a column, get a starting recipe.',
    thumb: '<span style="font-size:44px">🧭</span>',
    steps: [
      function (el) {
        var box = h(title('A starting recipe <em>per column</em>', 'Starting points, not laws: check them with validation results.') +
          '<div class="dform"><label>column type <select id="dt"><option value="num">numeric</option><option value="cat">categorical</option></select></label><span id="dq"></span></div><div class="dres" id="dr"></div>');
        el.appendChild(box);
        var Q = {
          num: [['dist', 'distribution', [['sym', 'roughly symmetric'], ['skew', 'skewed or with outliers']]], ['model', 'model', [['tree', 'trees / forests / GBT'], ['lin', 'linear / logistic (regularized)'], ['dist', 'KNN / K-Means / SVM'], ['nn', 'neural network']]], ['miss', 'missing values', [['no', 'none'], ['few', 'some'], ['meaning', 'missing may mean something']]]],
          cat: [['order', 'order', [['no', 'no order (nominal)'], ['yes', 'a real order (ordinal)'], ['bin', 'two values']]], ['card', 'distinct values', [['low', 'a handful'], ['high', 'hundreds or more']]], ['miss', 'missing or new values', [['no', 'never'], ['yes', 'yes, nulls or new values at inference']]]]
        };
        var A = {};
        function draw() {
          var t = box.querySelector('#dt').value;
          box.querySelector('#dq').innerHTML = Q[t].map(function (q) { if (!A[q[0] + t]) A[q[0] + t] = q[2][0][0]; return '<label>' + q[1] + ' <select data-q="' + q[0] + t + '">' + q[2].map(function (o) { return '<option value="' + o[0] + '"' + (A[q[0] + t] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>'; }).join('');
          box.querySelectorAll('[data-q]').forEach(function (s) { s.onchange = function () { A[s.dataset.q] = s.value; draw(); }; });
          var r = [], code = [];
          if (t === 'num') {
            var skew = A.distnum === 'skew', m = A.modelnum;
            if (A.missnum !== 'no') { r.push('🩹 <b>Imputer, strategy="' + (skew ? 'median' : 'mean') + '"</b>' + (skew ? ': the median ignores the outliers.' : ': fine for symmetric data; median is a safe default too.')); code.push('Imputer(inputCols=[c], outputCols=[c + "_imp"], strategy="' + (skew ? 'median' : 'mean') + '")'); }
            if (A.missnum === 'meaning') { r.push('🚩 add <b>' + 'c_was_missing</b> before imputing, and check whether it helps.'); code.unshift('df = df.withColumn(c + "_was_missing", F.col(c).isNull().cast("int"))'); }
            if (skew) r.push('🔍 look at the extremes first: an error is fixed or removed; a real extreme may be capped (IQR from train) or log-transformed.');
            if (m === 'tree') r.push('🌳 <b>no scaler needed</b>: trees split on thresholds, units do not matter. A shared pipeline may still include one.');
            else { var sc = skew ? 'RobustScaler(withCentering=True)' : m === 'nn' ? 'StandardScaler(withMean=True) or MinMaxScaler' : 'StandardScaler(withMean=True)'; r.push('📏 <b>' + sc + '</b>' + (m === 'dist' ? ': distances must not be dominated by big units.' : m === 'lin' ? ': the penalty treats every coefficient fairly.' : ': stable, fast training.')); code.push('VectorAssembler(inputCols=num_cols, outputCol="num_vec")'); code.push(skew ? 'RobustScaler(inputCol="num_vec", outputCol="num_scaled", withCentering=True)' : 'StandardScaler(inputCol="num_vec", outputCol="num_scaled", withMean=True)'); }
          } else {
            var o = A.ordercat, hi = A.cardcat === 'high', inv = A.misscat === 'yes' ? 'keep' : 'error';
            if (o === 'yes') { r.push('🔢 <b>your own mapping</b> with when().otherwise(): StringIndexer orders by frequency, not by meaning.'); code.push('F.when(F.col(c) == "low", 1).when(F.col(c) == "mid", 2).when(F.col(c) == "high", 3)'); }
            else if (o === 'bin') { r.push('⚪ <b>a 0 / 1 column</b>: cast Yes / No to boolean, then to int.'); code.push('F.col(c).cast("boolean").cast("int")'); }
            else {
              if (hi) { r.push('🗂️ <b>group rare values into "Other"</b> with counts from the training data, or try <b>TargetEncoder</b> (fit on train only), or embeddings for very large vocabularies.'); code.push('F.when(F.col(c).isin(frequent), F.col(c)).otherwise("Other")'); }
              r.push('🔤 <b>StringIndexer → OneHotEncoder</b>: the default for nominal columns.'); code.push('StringIndexer(inputCols=[c], outputCols=[c + "_idx"], handleInvalid="' + inv + '")'); code.push('OneHotEncoder(inputCols=[c + "_idx"], outputCols=[c + "_ohe"])');
            }
            if (A.misscat === 'yes') r.push('🛟 <b>handleInvalid="keep"</b> (or fillna("Unknown")): a new value in production must not crash the job.');
          }
          r.push('🎓 put the learned steps in <b>one Pipeline</b>, fit on the training rows, reuse the PipelineModel everywhere.');
          box.querySelector('#dr').innerHTML = '<div class="card sk alt">' + list(r) + '</div>' + (code.length ? py(code.join('\n')) : '');
        }
        box.querySelector('#dt').onchange = draw; draw();
      }
    ]
  });
})();
