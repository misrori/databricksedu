/* Data preparation storyboard: the prep lab.
   One small churn table (11 train rows, 3 test rows, 1 new row at inference time) goes through
   four Spark ML stages you run one by one: 1 impute, 2 encode, 3 scale, 4 assemble.
     left:  numbered cards with options, the generated PySpark code and a ▶ Run button (↺ undo once it ran)
     right: what the stage learned on the training rows, and the table before → after
   Every statistic is computed here in the page, the same way Spark ML computes it.
   Registers window.PrepLab = { mount(el, view), reset(), summary(), onChange(fn) }. */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // ------------------------------------------------------------------ the data
  // id, split, contract, payment, tenure, monthly_fee, total_charges, churn
  var RAW = [
    [1, 'train', 'Month-to-month', 'E-check', 2, 70.2, 140.4, 1],
    [2, 'train', 'Two year', 'Bank transfer', 60, 25.0, 1500.0, 0],
    [3, 'train', 'One year', 'Card', 24, 55.5, 1332.0, 0],
    [4, 'train', 'Month-to-month', 'E-check', null, 80.1, null, 1],
    [5, 'train', 'Month-to-month', null, 5, 45.0, 225.0, 1],
    [6, 'train', 'Two year', 'Card', 72, 110.0, 7920.0, 0],
    [7, 'train', 'Two year', 'Bank transfer', 30, null, 1650.0, 0],
    [8, 'train', 'Month-to-month', 'Card', 12, 65.0, 780.0, 0],
    [9, 'train', 'Month-to-month', 'E-check', 1, 95.0, 95.0, 1],
    [10, 'train', 'One year', null, 40, 20.5, 820.0, 0],
    [11, 'train', 'Two year', 'Card', 48, 410.0, 1968.0, 0],
    [12, 'test', 'Month-to-month', 'Card', 8, 75.0, null, 1],
    [13, 'test', 'Two year', 'Bank transfer', null, 120.0, 8640.0, 0],
    [14, 'test', 'One year', 'E-check', 20, 60.0, 1200.0, 0],
    [15, 'new', 'Month-to-month', 'Crypto wallet', 3, null, 210.0, null]
  ];
  var NUM = ['tenure', 'monthly_fee', 'total_charges'];
  var ORD = { 'Month-to-month': 1, 'One year': 2, 'Two year': 3 };
  var SPLIT = { train: '🏋️ train', test: '🧪 test', 'new': '🆕 new' };

  function fresh() {
    return { leak: false, strategy: 'median', flags: true, payFill: 'none', handleInvalid: 'keep', contractEnc: 'onehot', payEnc: 'onehot',
      dropLast: true, smoothing: 1, scaler: 'standard', withMean: true, withCentering: true,
      done: { impute: false, encode: false, scale: false, assemble: false }, view: 'raw', show: 'all', col: 'monthly_fee', flash: null };
  }
  var S = fresh(), listeners = [];

  // ------------------------------------------------------------------ math, the Spark ML way
  function mean(v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; }
  function sd(v) { var m = mean(v); return Math.sqrt(v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (v.length - 1)); } // sample std, like StandardScaler
  function quant(v, q) { var s = v.slice().sort(function (a, b) { return a - b; }); return s[Math.max(0, Math.ceil(q * s.length) - 1)]; } // an observed value, like approxQuantile
  function nn(x) { return x !== null && x !== undefined; }
  function n2(x) { return Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : (Math.round(x * 100) / 100).toString(); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  function labelsOf(rows, col) {
    var cnt = {};
    rows.forEach(function (r) { if (nn(r[col])) cnt[r[col]] = (cnt[r[col]] || 0) + 1; });
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || (a < b ? -1 : 1); }).map(function (k) { return { v: k, n: cnt[k] }; });
  }

  function compute() {
    var rows = RAW.map(function (a) { return { id: a[0], split: a[1], contract: a[2], payment: a[3], tenure: a[4], monthly_fee: a[5], total_charges: a[6], churn: a[7], f: {} }; });
    var isFit = function (r) { return r.split === 'train' || (S.leak && r.split === 'test'); };
    var fit = rows.filter(isFit), o = { rows: rows, fit: fit, L: {}, err: {}, warn: {} };

    // 1 ── impute
    if (S.done.impute) {
      if (S.strategy === 'mode') o.err.impute = '[UC_COMMAND_NOT_SUPPORTED] Imputer(strategy="mode") is not supported on Serverless compute. Use "median" (for a 0/1 column the median is its most common value) or classic compute.';
      else {
        o.L.impute = {};
        NUM.forEach(function (c) {
          var v = fit.map(function (r) { return r[c]; }).filter(nn), st = S.strategy === 'mean' ? mean(v) : quant(v, 0.5);
          o.L.impute[c] = { v: st, n: v.length, mean: mean(v), median: quant(v, 0.5) };
          rows.forEach(function (r) {
            if (S.flags) r[c + '_was_missing'] = nn(r[c]) ? 0 : 1;
            r[c + '_imp'] = nn(r[c]) ? r[c] : st;
            if (!nn(r[c])) r.f[c + '_imp'] = 'filled with the ' + S.strategy + ' learned on ' + (S.leak ? 'train + test' : 'train') + ': ' + n2(st);
          });
        });
        rows.forEach(function (r) {
          r.payment_f = S.payFill === 'unknown' && !nn(r.payment) ? 'Unknown' : r.payment;
          if (S.payFill === 'unknown' && !nn(r.payment)) r.f.payment_f = 'fillna("Unknown"): missing is its own category';
        });
      }
    }
    var payIn = S.done.impute && !o.err.impute && S.payFill === 'unknown' ? 'payment_f' : 'payment';

    // 2 ── encode
    if (S.done.encode) {
      var keep = S.handleInvalid === 'keep', idxCols = [];
      if (S.contractEnc !== 'ordinal') idxCols.push(['contract', 'contract']);
      idxCols.push(['payment', payIn]);
      o.L.encode = { labels: {} };
      idxCols.forEach(function (p) {
        var lab = labelsOf(fit, p[1]), names = lab.map(function (x) { return x.v; });
        o.L.encode.labels[p[0]] = lab;
        rows.forEach(function (r) {
          var v = r[p[1]], i = nn(v) ? names.indexOf(v) : -1;
          if (i < 0) {
            if (keep) { i = names.length; r.f[p[0] + '_idx'] = (nn(v) ? '"' + v + '" was never seen in training' : 'null') + ': gets the extra index ' + i; }
            else if (S.handleInvalid === 'skip') { r.skip = true; i = null; }
            else if (!o.err.encode) {
              o.err.encode = 'pipeline_model.transform(' + (r.split === 'new' ? 'new_df' : r.split === 'test' ? 'test_df' : 'train_df') + ')' + ' → SparkException: ' +
                (nn(v) ? 'Unseen label: ' + v + '. To handle unseen labels, set Param handleInvalid to keep.' : 'StringIndexer encountered NULL value. To handle or skip NULLS, try setting StringIndexer.handleInvalid.') + ' (row id ' + r.id + ')';
            }
          }
          r[p[0] + '_idx'] = i;
        });
      });
      if (!o.err.encode) {
        var ohe = function (col) {
          var nl = o.L.encode.labels[col].length, size = nl + (keep ? 1 : 0) - (S.dropLast ? 1 : 0);
          var names = o.L.encode.labels[col].map(function (x) { return x.v; }).concat(keep ? ['__unknown'] : []).slice(0, size);
          rows.forEach(function (r) { if (r.skip) return; var v = []; for (var k = 0; k < size; k++) v.push(r[col + '_idx'] === k ? 1 : 0); r[col + '_enc'] = v; });
          return { kind: 'ohe', names: names, size: size, dropped: (o.L.encode.labels[col].map(function (x) { return x.v; }).concat(keep ? ['__unknown'] : []))[size] };
        };
        o.L.encode.contract = S.contractEnc === 'onehot' ? ohe('contract') : S.contractEnc === 'label' ? { kind: 'idx', names: ['contract_idx'] } : { kind: 'ord', names: ['contract_ord'] };
        if (S.contractEnc === 'label') rows.forEach(function (r) { if (!r.skip) r.contract_enc = [r.contract_idx]; });
        if (S.contractEnc === 'ordinal') rows.forEach(function (r) { if (!r.skip) r.contract_enc = [nn(ORD[r.contract]) ? ORD[r.contract] : null]; });
        if (S.payEnc === 'onehot') o.L.encode.payment = ohe('payment');
        else {
          var g = mean(fit.map(function (r) { return r.churn; })), st = {};
          fit.forEach(function (r) { var i = r.payment_idx; if (!nn(i)) return; st[i] = st[i] || { n: 0, s: 0 }; st[i].n++; st[i].s += r.churn; });
          var m = S.smoothing;
          o.L.encode.payment = { kind: 'te', names: ['payment_te'], global: g, stats: st };
          rows.forEach(function (r) {
            if (r.skip) return;
            var t = st[r.payment_idx];
            r.payment_enc = [t ? (t.s + m * g) / (t.n + m) : g];
            if (!t) r.f.payment_enc = 'index ' + r.payment_idx + ' was not in training: the overall churn rate ' + f2(g);
          });
        }
      }
    }

    // 3 ── scale
    if (S.done.scale) {
      if (!S.done.impute || o.err.impute) o.err.scale = 'VectorAssembler → SparkException: Encountered null while assembling a row with handleInvalid = "error". Consider removing nulls from dataset or using handleInvalid = "keep" or "skip". (A scaler cannot learn from nulls: run 1 · Impute first.)';
      else if (S.scaler !== 'none') {
        o.L.scale = {};
        NUM.forEach(function (c) {
          var v = fit.map(function (r) { return r[c + '_imp']; }), p;
          if (S.scaler === 'standard') { p = { mean: mean(v), std: sd(v) }; p.fn = function (x) { return (x - (S.withMean ? p.mean : 0)) / p.std; }; }
          else if (S.scaler === 'minmax') { p = { min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; p.fn = function (x) { return (x - p.min) / (p.max - p.min); }; }
          else { p = { median: quant(v, 0.5), q1: quant(v, 0.25), q3: quant(v, 0.75) }; p.iqr = p.q3 - p.q1; p.fn = function (x) { return (x - (S.withCentering ? p.median : 0)) / p.iqr; }; }
          o.L.scale[c] = p;
          rows.forEach(function (r) {
            r[c + '_sc'] = p.fn(r[c + '_imp']);
            if (S.scaler === 'minmax' && (r[c + '_sc'] < 0 || r[c + '_sc'] > 1)) r.f[c + '_sc'] = 'outside [0, 1]: this value is beyond the training min / max';
          });
        });
      }
    }

    // 4 ── assemble
    if (S.done.assemble) {
      if (!S.done.impute || o.err.impute) o.err.assemble = 'VectorAssembler → SparkException: Encountered null while assembling a row with handleInvalid = "error". (Run 1 · Impute first.)';
      else if (!S.done.encode) o.err.assemble = 'VectorAssembler → IllegalArgumentException: Data type string of column contract is not supported. (Strings must be encoded: run 2 · Encode first.)';
      else if (o.err.encode) o.err.assemble = 'Nothing to assemble: stage 2 · Encode failed.';
      else {
        var scaled = S.done.scale && !o.err.scale && S.scaler !== 'none';
        var groups = [{ k: 'num', title: scaled ? 'num_scaled' : 'num_vec (not scaled)', names: NUM.slice(), col: function (r) { return NUM.map(function (c) { return scaled ? r[c + '_sc'] : r[c + '_imp']; }); } },
          { k: 'con', title: 'contract_' + { onehot: 'ohe', label: 'idx', ordinal: 'ord' }[S.contractEnc], names: o.L.encode.contract.names, col: function (r) { return r.contract_enc; } },
          { k: 'pay', title: 'payment_' + (S.payEnc === 'onehot' ? 'ohe' : 'te'), names: o.L.encode.payment.names, col: function (r) { return r.payment_enc; } }];
        if (S.flags) groups.push({ k: 'flg', title: 'missing flags', names: NUM.map(function (c) { return c + '_was_missing'; }), col: function (r) { return NUM.map(function (c) { return r[c + '_was_missing']; }); } });
        o.L.features = groups;
        rows.forEach(function (r) { if (!r.skip) r.features = groups.map(function (g) { return g.col(r); }); });
        o.size = groups.reduce(function (a, g) { return a + g.names.length; }, 0);
        if (S.contractEnc === 'ordinal') o.warn.assemble = 'contract_ord says One year is "1 more" than Month-to-month and Two year "2 more". Fine when the order is real, as here.';
        if (S.contractEnc === 'label') o.warn.assemble = 'contract_idx comes from frequency: Month-to-month 0, Two year 1, One year 2. A linear model reads that as an order, and it is the wrong one.';
      }
    }
    return o;
  }

  // ------------------------------------------------------------------ code for the cards
  var KW = /\b(from|import|for|in|if|else|True|False|None)\b/g;
  function hl(code) {
    return code.split('\n').map(function (line) {
      var i = line.indexOf('#'), c = i >= 0 ? line.slice(i) : '', s = i >= 0 ? line.slice(0, i) : line;
      s = s.split(/("[^"]*")/).map(function (p, k) { return k % 2 ? '<span class="st">' + esc(p) + '</span>' : esc(p).replace(KW, '<span class="kw">$1</span>'); }).join('');
      return s + (c ? '<span class="cm">' + esc(c) + '</span>' : '');
    }).join('\n');
  }
  var FIT = function () { return S.leak ? 'train_df.union(test_df)  # ⚠ leak' : 'train_df'; };
  function codeOf(k) {
    if (k === 'impute') return (S.flags ? '# flags first: remember which values were missing\nfor c in num_cols:\n    df = df.withColumn(f"{c}_was_missing", F.col(c).isNull().cast("int"))\n' : '') +
      (S.payFill === 'unknown' ? 'df = df.fillna("Unknown", subset=["payment"])\n' : '') +
      'imputer = Imputer(inputCols=num_cols,\n                  outputCols=[f"{c}_imp" for c in num_cols],\n                  strategy="' + S.strategy + '")\nimputer_model = imputer.fit(' + FIT() + ')\ndisplay(imputer_model.surrogateDF)   # the learned fill values';
    if (k === 'encode') {
      var idx = S.contractEnc === 'ordinal' ? ['payment'] : ['contract', 'payment'];
      var s = (S.contractEnc === 'ordinal' ? '# a real order: map it yourself\ndf = df.withColumn("contract_ord",\n    F.when(F.col("contract") == "Month-to-month", 1)\n     .when(F.col("contract") == "One year", 2)\n     .when(F.col("contract") == "Two year", 3))\n' : '') +
        'indexer = StringIndexer(inputCols=' + JSON.stringify(idx).replace(/,/g, ', ') + ',\n    outputCols=' + JSON.stringify(idx.map(function (c) { return c + '_idx'; })).replace(/,/g, ', ') + ',\n    handleInvalid="' + S.handleInvalid + '")\n';
      var oh = [];
      if (S.contractEnc === 'onehot') oh.push('contract');
      if (S.payEnc === 'onehot') oh.push('payment');
      if (oh.length) s += 'encoder = OneHotEncoder(inputCols=' + JSON.stringify(oh.map(function (c) { return c + '_idx'; })).replace(/,/g, ', ') + ',\n    outputCols=' + JSON.stringify(oh.map(function (c) { return c + '_ohe'; })).replace(/,/g, ', ') + ', dropLast=' + (S.dropLast ? 'True' : 'False') + ')\n';
      if (S.payEnc === 'target') s += 'te = TargetEncoder(inputCol="payment_idx", outputCol="payment_te", labelCol="churn",\n    targetType="binary", smoothing=' + S.smoothing.toFixed(1) + ', handleInvalid="keep")\n';
      return s + '# all of them learn from ' + FIT();
    }
    if (k === 'scale') {
      var sc = S.scaler === 'standard' ? 'StandardScaler(inputCol="num_vec", outputCol="num_scaled",\n    withMean=' + (S.withMean ? 'True' : 'False') + ', withStd=True)' :
        S.scaler === 'minmax' ? 'MinMaxScaler(inputCol="num_vec", outputCol="num_scaled")' :
        S.scaler === 'robust' ? 'RobustScaler(inputCol="num_vec", outputCol="num_scaled",\n    withCentering=' + (S.withCentering ? 'True' : 'False') + ', withScaling=True)' : '# no scaler: trees do not need one';
      return 'assembler = VectorAssembler(inputCols=[f"{c}_imp" for c in num_cols],\n    outputCol="num_vec")\nscaler = ' + sc + '\n# fit on ' + FIT();
    }
    var cols = ['"' + (S.done.scale && S.scaler !== 'none' ? 'num_scaled' : 'num_vec') + '"', '"contract_' + { onehot: 'ohe', label: 'idx', ordinal: 'ord' }[S.contractEnc] + '"', '"payment_' + (S.payEnc === 'onehot' ? 'ohe' : 'te') + '"'];
    if (S.flags) cols.push('*[f"{c}_was_missing" for c in num_cols]');
    return 'final = VectorAssembler(\n    inputCols=[' + cols.join(', ') + '],\n    outputCol="features")';
  }
  function pipelineCode() {
    var st = ['imputer'];
    st.push('indexer');
    if (S.contractEnc === 'onehot' || S.payEnc === 'onehot') st.push('encoder');
    if (S.payEnc === 'target') st.push('te');
    st.push('assembler');
    if (S.scaler !== 'none') st.push('scaler');
    st.push('final');
    return 'from pyspark.ml import Pipeline\nfrom pyspark.ml.feature import (Imputer, StringIndexer, OneHotEncoder,\n    VectorAssembler, ' + { standard: 'StandardScaler', minmax: 'MinMaxScaler', robust: 'RobustScaler', none: '' }[S.scaler] + (S.payEnc === 'target' ? ', TargetEncoder' : '') + ')\n\n' +
      'train_df, test_df = df.randomSplit([0.8, 0.2], seed=42)   # split FIRST\n' +
      'pipeline = Pipeline(stages=[' + st.join(', ') + '])\n' +
      'pipeline_model = pipeline.fit(' + FIT() + ')   # learns everything once\n\n' +
      'train_out = pipeline_model.transform(train_df)\ntest_out  = pipeline_model.transform(test_df)    # re-learns nothing\nnew_out   = pipeline_model.transform(new_df)\n\n' +
      'pipeline_model.write().overwrite().save("/Volumes/main/ml/prep/churn_prep_v1")';
  }

  // ------------------------------------------------------------------ cards
  var CARDS = [
    { k: 'impute', n: 1, t: '🩹 Impute missing values', note: 'Imputer is an <b>estimator</b>: <code>fit</code> learns one fill value per column from the training rows, <code>transform</code> uses it everywhere.',
      opts: function () {
        return sel('strategy', 'strategy', [['median', 'median'], ['mean', 'mean'], ['mode', 'mode']]) +
          tog('flags', 'add <code>_was_missing</code> flags first') +
          sel('payFill', 'payment nulls', [['none', 'leave null (StringIndexer handles it)'], ['unknown', 'fillna("Unknown")']]);
      } },
    { k: 'encode', n: 2, t: '🔤 Encode categories', note: 'StringIndexer learns the category list from training data, most frequent first. OneHotEncoder turns each index into a 0/1 vector.',
      opts: function () {
        return sel('contractEnc', 'contract', [['onehot', 'one-hot'], ['label', 'label (StringIndexer only)'], ['ordinal', 'ordinal mapping 1 · 2 · 3']]) +
          sel('payEnc', 'payment', [['onehot', 'one-hot'], ['target', 'target encoding']]) +
          sel('handleInvalid', 'handleInvalid', [['keep', 'keep'], ['error', 'error (default)'], ['skip', 'skip']]) +
          (S.contractEnc === 'onehot' || S.payEnc === 'onehot' ? tog('dropLast', 'dropLast') : '') +
          (S.payEnc === 'target' ? '<label class="plo">smoothing <input type="range" min="0" max="10" step="0.5" data-k="smoothing" value="' + S.smoothing + '"> <b>' + S.smoothing.toFixed(1) + '</b></label>' : '');
      } },
    { k: 'scale', n: 3, t: '📏 Scale the numbers', note: 'Assemble the imputed numbers into one vector, then scale only that vector. One-hot columns and flags stay 0 / 1.',
      opts: function () {
        return sel('scaler', 'scaler', [['standard', 'StandardScaler'], ['minmax', 'MinMaxScaler'], ['robust', 'RobustScaler'], ['none', 'none']]) +
          (S.scaler === 'standard' ? tog('withMean', 'withMean <small>(Spark default: False)</small>') : '') +
          (S.scaler === 'robust' ? tog('withCentering', 'withCentering <small>(default: False)</small>') : '');
      } },
    { k: 'assemble', n: 4, t: '🧩 Assemble the features', note: 'The last VectorAssembler joins the two branches into one <code>features</code> vector: what the model reads.', opts: function () { return ''; } }
  ];
  function sel(k, label, opts) {
    return '<label class="plo">' + label + ' <select data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (S[k] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
  }
  function tog(k, label) { return '<label class="toggle plo"><input type="checkbox" data-k="' + k + '"' + (S[k] ? ' checked' : '') + '><span class="sw"></span> ' + label + '</label>'; }

  // ------------------------------------------------------------------ views
  var VIEWS = [['raw', '📋 Raw'], ['impute', '1 · Impute'], ['encode', '2 · Encode'], ['scale', '3 · Scale'], ['assemble', '4 · Features'], ['pipeline', '🧱 As one Pipeline']];
  function cell(v, title, cls) {
    var t = title ? ' title="' + esc(title) + '"' : '';
    if (!nn(v)) return '<td class="' + (cls || '') + '"' + t + '><i class="nul">null</i></td>';
    return '<td class="' + (cls || '') + (title ? ' fill' : '') + '"' + t + '>' + (typeof v === 'number' ? n2(v) : esc(v)) + '</td>';
  }
  function vec(v, names, cls, isOhe) {
    if (!v) return '<td><i class="nul">–</i></td>';
    if (isOhe)
      return '<td class="' + (cls || '') + '"><span class="ohe">' + v.map(function (x, i) { return '<i class="' + (x ? 'on' : '') + '" title="' + esc(names[i]) + ' = ' + x + '"></i>'; }).join('') + '</span>' +
        (v.indexOf(1) < 0 ? ' <small class="zero">all 0</small>' : '') + '</td>';
    return '<td class="' + (cls || '') + '">' + v.map(function (x) { return nn(x) ? n2(x) : 'null'; }).join(', ') + '</td>';
  }
  function rowsShown(o) { return o.rows.filter(function (r) { return S.show === 'all' || (S.show === 'train' ? r.split === 'train' : r.split !== 'train'); }); }
  function rowHead(r) { return '<td class="sp ' + r.split + '">' + SPLIT[r.split] + (r.split === 'test' && S.leak ? ' <span class="leak">in fit!</span>' : '') + '</td><td>' + r.id + '</td>'; }
  function table(o, head, body) {
    var rs = rowsShown(o);
    return '<div class="slwrap pltbl"><table class="dt2"><tr><th>split</th><th>id</th>' + head + '</tr>' +
      rs.map(function (r) { return '<tr class="' + (r.skip ? 'ghost' : '') + (r.split === 'new' ? ' newr' : '') + '">' + rowHead(r) + body(r) + '</tr>'; }).join('') + '</table></div>';
  }
  function arrowTh(a, b, cls) { return '<th>' + a + '</th><th class="to ' + (cls || '') + '">→ ' + b + '</th>'; }
  function fl(k) { return S.flash === k ? ' fresh' : ''; }

  function viewRaw(o) {
    return explain('This is the table as it lands in Unity Catalog. Eleven rows are for training, three are held back for testing, and one arrives later, at inference time. Hover the yellow cells.',
      ['<b>5 nulls</b> in numbers, <b>2 nulls</b> in <code>payment</code>', '<code>monthly_fee = 410</code>: a typo for 41', 'units: months vs dollars vs thousands of dollars', 'row 15 pays with <b>"Crypto wallet"</b>, which training never saw']) +
      table(o, '<th>contract</th><th>payment</th><th>tenure</th><th>monthly_fee</th><th>total_charges</th><th>churn</th>', function (r) {
        return cell(r.contract) + cell(r.payment, r.payment === 'Crypto wallet' ? 'never seen in training' : null) + cell(r.tenure) +
          cell(r.monthly_fee, r.monthly_fee === 410 ? 'an outlier: probably a typo for 41.0' : null) + cell(r.total_charges) + cell(r.churn);
      });
  }
  function learnedBox(html) { return '<div class="pllearn"><h5>🎓 learned by <code>fit</code> on ' + (S.leak ? '<span class="leak">train + test (' + 14 + ' rows) ⚠</span>' : 'the 11 training rows') + '</h5>' + html + '</div>'; }
  function explain(text, bullets) { return '<div class="plx">' + text + (bullets ? '<ul>' + bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>' : '') + '</div>'; }
  function notRun(k) { return '<div class="plwait">▶ Press <b>Run</b> on card ' + CARDS.filter(function (c) { return c.k === k; })[0].n + ' to fit and apply this stage.</div>'; }
  function errBox(m) { return '<div class="slerr">' + esc(m) + '</div>'; }

  function viewImpute(o) {
    if (!S.done.impute) return explain('Missing numbers break most models: VectorAssembler raises an error on nulls. Imputation fills each gap with a value learned from the training rows.') + notRun('impute');
    if (o.err.impute) return errBox(o.err.impute);
    var L = o.L.impute;
    var lb = '<table class="dt2 mini"><tr><th>column</th><th>mean</th><th>median</th><th>fill value</th></tr>' + NUM.map(function (c) {
      return '<tr><td>' + c + '</td><td>' + n2(L[c].mean) + '</td><td>' + n2(L[c].median) + '</td><td class="mk"><b>' + n2(L[c].v) + '</b></td></tr>';
    }).join('') + '</table>' + (L.monthly_fee.mean > L.monthly_fee.median * 1.3 ? '<div class="hint big">💡 <code>monthly_fee</code>: the mean is <b>' + n2(L.monthly_fee.mean) + '</b> because of the 410 typo; the median stays at <b>' + n2(L.monthly_fee.median) + '</b>. Prefer the median for skewed columns or columns with outliers.</div>' : '');
    var head = NUM.map(function (c) { return arrowTh(c, c + '_imp', 'n'); }).join('') + (S.payFill === 'unknown' ? arrowTh('payment', 'payment') : '') + (S.flags ? NUM.map(function (c) { return '<th class="to flg">' + c + '_was_missing</th>'; }).join('') : '');
    return learnedBox(lb) + table(o, head, function (r) {
      return NUM.map(function (c) { return cell(r[c]) + cell(r[c + '_imp'], r.f[c + '_imp'], 'out' + (r.f[c + '_imp'] ? fl('impute') : '')); }).join('') +
        (S.payFill === 'unknown' ? cell(r.payment) + cell(r.payment_f, r.f.payment_f, 'out') : '') +
        (S.flags ? NUM.map(function (c) { return '<td class="flg' + (r[c + '_was_missing'] ? ' one' : '') + '">' + r[c + '_was_missing'] + '</td>'; }).join('') : '');
    }) + (S.flags ? '<div class="hint">The flags are made <b>before</b> imputing. Afterwards nobody could tell that 24 was a guess.</div>' : '');
  }
  function labelList(lab, keep) {
    return lab.map(function (x, i) { return '<span class="slchip"><b>' + i + '</b> ' + esc(x.v) + ' <small>×' + x.n + '</small></span>'; }).join('') + (keep ? '<span class="slchip unk"><b>' + lab.length + '</b> null / unseen</span>' : '');
  }
  function viewEncode(o) {
    if (!S.done.encode) return explain('Models read numbers, not strings. Spark ML encodes categories in two steps: StringIndexer (string → index), then OneHotEncoder (index → 0/1 vector).') + notRun('encode');
    if (o.err.encode) return errBox(o.err.encode) + '<div class="hint big">With <code>handleInvalid="error"</code> one null or one new category stops the whole job. In production that new category always arrives one day. Try <b>keep</b>.</div>';
    var E = o.L.encode, keep = S.handleInvalid === 'keep', lb = '';
    Object.keys(E.labels).forEach(function (c) { lb += '<div class="pll"><code>' + c + '</code> labels: ' + labelList(E.labels[c], keep) + '</div>'; });
    if (S.contractEnc === 'ordinal') lb += '<div class="pll"><code>contract_ord</code>: your own mapping, Month-to-month 1 · One year 2 · Two year 3 (learns nothing)</div>';
    ['contract', 'payment'].forEach(function (c) {
      var e = E[c];
      if (e.kind === 'ohe') lb += '<div class="pll"><code>' + c + '_ohe</code> size <b>' + e.size + '</b>' + (e.dropped ? ' · dropLast leaves out <b>' + esc(e.dropped) + '</b>, so it is the all-zero vector' : ' · no position dropped') + '</div>';
      if (e.kind === 'te') lb += '<div class="pll"><code>payment_te</code> = (churners + ' + S.smoothing.toFixed(1) + ' × ' + f2(e.global) + ') / (rows + ' + S.smoothing.toFixed(1) + ') · overall churn rate ' + f2(e.global) + ' · ' +
        Object.keys(e.stats).map(function (i) { var t = e.stats[i]; return '<span class="slchip">idx ' + i + ': ' + t.s + '/' + t.n + ' → <b>' + f2((t.s + S.smoothing * e.global) / (t.n + S.smoothing)) + '</b></span>'; }).join('') + '</div>';
    });
    var head = '<th>contract</th>' + (S.contractEnc !== 'ordinal' ? '<th class="to">→ idx</th>' : '') + '<th class="to">→ ' + E.contract.names.length + ' col' + (E.contract.names.length > 1 ? 's' : '') + '</th><th>payment</th><th class="to">→ idx</th><th class="to">→ ' + (S.payEnc === 'target' ? 'payment_te' : 'payment_ohe') + '</th>' + (S.payEnc === 'target' ? '<th>churn</th>' : '');
    var tips = E.contract.names;
    return learnedBox(lb) + table(o, head, function (r) {
      return cell(r.contract) + (S.contractEnc !== 'ordinal' ? cell(r.contract_idx, r.f.contract_idx, 'out') : '') + vec(r.contract_enc, tips, 'out' + fl('encode'), E.contract.kind === 'ohe') +
        cell(r[S.payFill === 'unknown' && S.done.impute ? 'payment_f' : 'payment']) + cell(r.payment_idx, r.f.payment_idx, 'out') + vec(r.payment_enc, E.payment.names, 'out' + fl('encode'), E.payment.kind === 'ohe') + (S.payEnc === 'target' ? cell(r.churn) : '');
    }) + encodeHint(o);
  }
  function encodeHint(o) {
    var h = [];
    if (S.handleInvalid === 'skip') h.push('<b>skip</b> drops the rows it cannot encode. In training that loses data; at inference the customer with "Crypto wallet" gets <b>no prediction at all</b>.');
    if (S.handleInvalid === 'keep' && S.dropLast && S.payEnc === 'onehot') h.push('Null and unseen values share the extra index, and dropLast removes that position: they become <b>all zeros</b>. Hover the squares.');
    if (S.handleInvalid !== 'keep' && S.dropLast) h.push('Without <b>keep</b> there is no extra index, so dropLast removes a real category: it becomes the all-zero vector.');
    if (S.contractEnc === 'label') h.push('StringIndexer orders by <b>frequency</b>: Two year (4 rows) got 1, One year (2 rows) got 2. For an ordered feature, map the order yourself.');
    if (S.payEnc === 'target') h.push('Target encoding reads <code>churn</code>. Fitting it on test rows would leak the answers. Move the smoothing slider: small categories are pulled toward the overall rate.');
    return h.length ? '<div class="hint big">💡 ' + h.join('<br>💡 ') + '</div>' : '';
  }
  function viewScale(o) {
    if (!S.done.scale) return explain('Tenure is 1 to 72, total charges up to 7,920. KNN, K-Means, SVMs, neural networks and regularized linear models let the big numbers win. A scaler puts every numeric column on a comparable scale. Trees do not care.') + notRun('scale');
    if (o.err.scale) return errBox(o.err.scale);
    if (S.scaler === 'none') return explain('No scaler: the numbers go to the model in their own units. That is fine for decision trees, random forests and gradient-boosted trees, because a split threshold does not care about units.');
    var L = o.L.scale, par = function (c) {
      var p = L[c];
      if (S.scaler === 'standard') return 'mean ' + n2(p.mean) + ' · std ' + n2(p.std) + ' → (x' + (S.withMean ? ' − ' + n2(p.mean) : '') + ') / ' + n2(p.std);
      if (S.scaler === 'minmax') return 'min ' + n2(p.min) + ' · max ' + n2(p.max) + ' → (x − ' + n2(p.min) + ') / ' + n2(p.max - p.min);
      return 'median ' + n2(p.median) + ' · Q1 ' + n2(p.q1) + ' · Q3 ' + n2(p.q3) + ' → (x' + (S.withCentering ? ' − ' + n2(p.median) : '') + ') / ' + n2(p.iqr);
    };
    var lb = NUM.map(function (c) { return '<div class="pll"><code>' + c + '</code> ' + par(c) + '</div>'; }).join('');
    var head = NUM.map(function (c) { return arrowTh(c + '_imp', 'scaled', 'n'); }).join('');
    var tr = o.rows.filter(function (r) { return r.split === 'train'; });
    var chk = NUM.map(function (c) { var v = tr.map(function (r) { return r[c + '_sc']; }); return c + ': mean ' + f2(mean(v)) + ', std ' + f2(sd(v)); }).join(' · ');
    return learnedBox(lb) + strip(o) + table(o, head, function (r) {
      return NUM.map(function (c) { return cell(r[c + '_imp']) + '<td class="out' + (r.f[c + '_sc'] ? ' warnc' : '') + fl('scale') + '"' + (r.f[c + '_sc'] ? ' title="' + esc(r.f[c + '_sc']) + '"' : '') + '>' + f2(r[c + '_sc']) + '</td>'; }).join('');
    }) + '<div class="hint">Check on the training rows: ' + chk + '.' + (S.scaler === 'standard' && !S.withMean ? ' Without <code>withMean</code> Spark only divides by the std, so the mean is not 0.' : '') + (S.scaler === 'standard' && S.withMean && !S.leak ? ' The test rows reuse the training numbers, so they do not average to exactly 0: that is what keeps the test honest.' : '') + '</div>';
  }
  // before / after on one axis each: dots joined by a line
  function strip(o) {
    var c = S.col, W = 560, x0 = 20, x1 = W - 20;
    var a = o.rows.map(function (r) { return r[c + '_imp']; }), b = o.rows.map(function (r) { return r[c + '_sc']; });
    var sx = function (v, lo, hi) { return hi === lo ? (x0 + x1) / 2 : x0 + (v - lo) / (hi - lo) * (x1 - x0); };
    var alo = Math.min.apply(null, a), ahi = Math.max.apply(null, a), blo = Math.min.apply(null, b), bhi = Math.max.apply(null, b);
    var g = '<line x1="' + x0 + '" y1="30" x2="' + x1 + '" y2="30" class="ax"/><line x1="' + x0 + '" y1="104" x2="' + x1 + '" y2="104" class="ax"/>';
    g += '<text x="' + x0 + '" y="16" class="lb">' + c + '_imp · ' + n2(alo) + '</text><text x="' + x1 + '" y="16" class="lb" text-anchor="end">' + n2(ahi) + '</text>';
    g += '<text x="' + x0 + '" y="126" class="lb">scaled · ' + f2(blo) + '</text><text x="' + x1 + '" y="126" class="lb" text-anchor="end">' + f2(bhi) + '</text>';
    if (S.scaler === 'minmax') [0, 1].forEach(function (t) { var X = sx(t, blo, bhi); g += '<line x1="' + X + '" y1="96" x2="' + X + '" y2="112" class="tk"/><text x="' + X + '" y="92" class="lb" text-anchor="middle">' + t + '</text>'; });
    if (S.scaler !== 'minmax' && blo < 0 && bhi > 0) { var Z = sx(0, blo, bhi); g += '<line x1="' + Z + '" y1="96" x2="' + Z + '" y2="112" class="tk"/><text x="' + Z + '" y="92" class="lb" text-anchor="middle">0</text>'; }
    o.rows.forEach(function (r, i) {
      var X1 = sx(a[i], alo, ahi), X2 = sx(b[i], blo, bhi), cl = r.split;
      g += '<line x1="' + X1 + '" y1="30" x2="' + X2 + '" y2="104" class="ln ' + cl + '"/><circle cx="' + X1 + '" cy="30" r="5" class="pt ' + cl + '"><title>id ' + r.id + ': ' + n2(a[i]) + '</title></circle>' +
        '<circle cx="' + X2 + '" cy="104" r="5" class="pt ' + cl + '"><title>id ' + r.id + ': ' + f2(b[i]) + '</title></circle>';
    });
    return '<div class="plstrip"><div class="row" style="gap:6px">' + NUM.map(function (k) { return '<button data-col="' + k + '" class="' + (k === c ? 'on' : '') + '">' + k + '</button>'; }).join('') +
      '<span class="small">● train ○ test ◆ new · each line joins a value to its scaled value</span></div><svg viewBox="0 0 ' + W + ' 134">' + g + '</svg></div>';
  }
  function viewAssemble(o) {
    if (!S.done.assemble) return explain('Spark ML models read one vector column, <code>features</code>. The final VectorAssembler concatenates the numeric branch and the categorical branch.') + notRun('assemble');
    if (o.err.assemble) return errBox(o.err.assemble);
    var G = o.L.features;
    var legend = '<div class="plleg">' + G.map(function (g) { return '<span class="g ' + g.k + '">' + g.title + ' <small>(' + g.names.length + ')</small></span>'; }).join('') + '<span>= <b>' + o.size + '</b> numbers per row</span></div>';
    var nr = o.rows.filter(function (r) { return r.split === 'new'; })[0];
    var sparse = '';
    if (nr && nr.features) {
      var flat = [].concat.apply([], nr.features), ix = [], vs = [];
      flat.forEach(function (v, i) { if (v) { ix.push(i); vs.push(Math.round(v * 1000) / 1000); } });
      sparse = '<div class="hint big">🆕 Row 15 as Spark prints it (a sparse vector): <code>(' + flat.length + ', [' + ix.join(', ') + '], [' + vs.join(', ') + '])</code>. Only the non-zero positions are stored.</div>';
    }
    return legend + table(o, '<th>features</th>', function (r) {
      if (!r.features) return '<td><i class="nul">row skipped</i></td>';
      return '<td class="fv' + fl('assemble') + '">[' + r.features.map(function (v, gi) {
        var g = G[gi];
        return '<span class="g ' + g.k + '">' + v.map(function (x, k) { return '<b title="' + esc(g.names[k]) + '">' + (nn(x) ? (g.k === 'num' || g.k === 'pay' && S.payEnc === 'target' ? f2(x) : n2(x)) : 'null') + '</b>'; }).join(' ') + '</span>';
      }).join('') + ']</td>';
    }) + sparse + (o.warn.assemble ? '<div class="slwarn">' + o.warn.assemble + '</div>' : '');
  }
  function viewPipeline() {
    return explain('In a notebook you write the four cards as <b>one Pipeline</b>. <code>fit</code> runs every stage on the training data once and returns a PipelineModel. That one object prepares test data, new data and production data, so they can never be prepared differently.') +
      '<pre class="slsql">' + hl(pipelineCode()) + '</pre>' +
      '<div class="hint big">Save it to a Unity Catalog volume, and the serving job loads exactly the medians, category lists and scaling numbers you trained with: <code>PipelineModel.load(path)</code>.</div>';
  }

  // ------------------------------------------------------------------ mount
  var root = null;
  function render() {
    if (!root || !root.isConnected) return;
    var o = compute();
    var cards = CARDS.map(function (c) {
      var d = S.done[c.k], e = o.err[c.k];
      return '<div class="slc' + (d ? (e ? ' err' : ' done') : '') + (S.view === c.k ? ' cur' : '') + '" data-card="' + c.k + '"><div class="slh"><span class="n">' + c.n + '</span><span class="t">' + c.t + '</span>' +
        (d ? '<span class="okd">' + (e ? '✗ failed' : '✓ ran') + '</span><button data-undo="' + c.k + '" title="Undo this stage">↺</button>' : '<button class="run" data-run="' + c.k + '">▶ Run</button>') + '</div>' +
        (c.opts() ? '<div class="plopts">' + c.opts() + '</div>' : '') +
        '<pre class="slsql">' + hl(codeOf(c.k)) + '</pre><div class="slnote">' + c.note + '</div></div>';
    }).join('');
    var v = { raw: viewRaw, impute: viewImpute, encode: viewEncode, scale: viewScale, assemble: viewAssemble, pipeline: viewPipeline }[S.view](o);
    root.innerHTML = '<div class="sl pl">' +
      '<div class="slgoal"><div>🎯 <b>Goal:</b> turn this table into one numeric <code>features</code> vector per row. Run the four cards in order, change the options and watch the table. Everything a stage learns comes from the <b>training rows</b> only.</div><button data-reset>↺ reset lab</button></div>' +
      '<div class="plbar"><span>fit on</span><button data-leak="0" class="' + (S.leak ? '' : 'on') + '">🏋️ train only</button><button data-leak="1" class="' + (S.leak ? 'on bad' : '') + '">⚠ train + test</button>' +
      '<span class="sep">rows</span>' + [['all', 'all 15'], ['train', 'train'], ['test', 'test + new']].map(function (x) { return '<button data-show="' + x[0] + '" class="' + (S.show === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') +
      (S.leak ? '<span class="leak big">leakage: the test rows help choose the fill values, categories and scaling, so the test score will look better than it is</span>' : '') + '</div>' +
      '<div class="slgrid"><div class="plcards">' + cards + '</div><div class="slp plview"><div class="pltabs">' +
      VIEWS.map(function (x) { return '<button data-view="' + x[0] + '" class="' + (S.view === x[0] ? 'on' : '') + (S.done[x[0]] ? ' ran' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' + v + '</div></div></div>';
    S.flash = null;
    listeners.forEach(function (f) { try { f(); } catch (e2) { } });
  }
  function onClick(e) {
    var b = e.target.closest('button, .slc');
    if (!b || !root.contains(b)) return;
    var d = b.dataset;
    if (d.run) { S.done[d.run] = true; S.view = d.run; S.flash = d.run; }
    else if (d.undo) { S.done[d.undo] = false; S.view = d.undo; }
    else if (d.view) S.view = d.view;
    else if (d.leak) S.leak = d.leak === '1';
    else if (d.show) S.show = d.show;
    else if (d.col) S.col = d.col;
    else if ('reset' in d) S = fresh();
    else if (d.card && !e.target.closest('select, input, label')) { if (S.view === d.card) return; S.view = d.card; }
    else return;
    render();
  }
  function onInput(e) {
    var k = e.target.dataset.k;
    if (!k) return;
    if (e.target.type === 'checkbox') S[k] = e.target.checked;
    else if (e.target.type === 'range') S[k] = +e.target.value;
    else S[k] = e.target.value;
    var card = e.target.closest('[data-card]');
    if (card) { S.view = card.dataset.card; if (S.done[S.view]) S.flash = S.view; }
    if (k === 'scaler' || k === 'withMean' || k === 'withCentering') { S.view = 'scale'; }
    render();
  }
  window.PrepLab = {
    mount: function (el, view) {
      root = el;
      if (view) S.view = view;
      el.addEventListener('click', onClick);
      el.addEventListener('change', onInput);
      render();
    },
    reset: function () { S = fresh(); render(); listeners.forEach(function (f) { f(); }); },
    onChange: function (f) { listeners.push(f); },
    summary: function () {
      var o = compute(), nr = o.rows.filter(function (r) { return r.split === 'new'; })[0];
      return { done: S.done, err: o.err, size: o.size, opts: S, newRow: nr && nr.features ? [].concat.apply([], nr.features) : null, skipped: nr && nr.skip };
    },
    data: function () { return RAW; },
    compute: function () { return compute(); }
  };
})();
