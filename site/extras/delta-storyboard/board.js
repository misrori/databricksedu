/* Delta Lake storyboard: the board, the windows, the quizzes and the story scenes.
   The Delta table simulator lives in sim.js and registers itself as scene "sim". */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  // ------------------------------------------------------------------ progress (per viewer, optional)
  var store = { visited: {}, answers: {} };
  try { var saved = JSON.parse(localStorage.getItem('dlsb') || 'null'); if (saved) store = saved; } catch (e) { }
  function persist() { try { localStorage.setItem('dlsb', JSON.stringify(store)); } catch (e) { } }
  function updateScore() {
    var ids = Object.keys(store.answers), ok = ids.filter(function (k) { return store.answers[k]; }).length;
    $('#score').textContent = '🎯 ' + ok + ' / ' + ids.length;
  }

  // ------------------------------------------------------------------ quiz
  // q = {id, q, options: [...], correct: index, why: html}
  function quiz(q, onDone) {
    var el = document.createElement('div');
    el.className = 'quiz sk alt';
    el.innerHTML = '<div class="qh">' + q.q + '</div><div class="opts">' +
      q.options.map(function (o, i) { return '<button data-i="' + i + '">' + String.fromCharCode(65 + i) + ') ' + o + '</button>'; }).join('') +
      '</div><div class="why">' + q.why + '</div>';
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
  // a quiz on top of the current window; resolves when the learner presses "Continue"
  function ask(q) {
    return new Promise(function (resolve) {
      var m = $('#qmodal');
      m.innerHTML = '';
      var qz = quiz(q, function () {
        var go = document.createElement('button');
        go.className = 'btn acc'; go.style.marginTop = '12px'; go.textContent = 'Continue → run it';
        go.onclick = function () { m.classList.remove('on'); resolve(); };
        qz.appendChild(go); go.focus();
      });
      m.appendChild(qz);
      m.classList.add('on');
    });
  }

  // ------------------------------------------------------------------ helpers for scenes
  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d; }
  function title(t, lead) { return '<h2 class="stitle">' + t + '</h2>' + (lead ? '<p class="lead">' + lead + '</p>' : ''); }
  function list(items) {
    return '<ul class="hand">' + items.map(function (x) {
      var cls = x[0] === '+' ? 'good' : x[0] === '-' ? 'bad' : '';
      return '<li class="' + cls + '">' + (cls ? x.slice(1) : x) + '</li>';
    }).join('') + '</ul>';
  }
  function openScene(id) { var i = SCENES.findIndex(function (s) { return s.id === id; }); if (i >= 0) open(i, 0); }

  // ------------------------------------------------------------------ scenes
  var SCENES = [];

  // 1 ── beach and pool
  SCENES.push({
    id: 'beach', icon: '🏖️', title: 'The beach and the pool', sub: 'Data lake vs data warehouse, and the lakehouse that joins them.',
    thumb: '<span style="font-size:54px">🏖️</span><span style="font-family:var(--hand);font-size:28px;margin:0 6px">vs</span><span style="font-size:54px">🏊</span>',
    steps: [
      function (el) {
        var drops = [['orders.csv', ''], ['clicks.json', ''], ['photo_0042.jpg', 'img'], ['orders_final_v2.csv', ''], ['orders_FINAL_really.csv', 'bad'],
          ['dump.parquet', ''], ['call.mp3', 'img'], ['~tmp_8812', 'bad'], ['broken.json', 'bad'], ['scan.pdf', 'img'], ['events_2019.avro', ''], ['copy of orders.csv', 'bad']];
        var html = '<div class="scape beach"><div class="wave"></div><div class="sun">☀️</div>' +
          '<div class="who" style="top:58%;animation-duration:9s">🚶</div><div class="who" style="top:72%;animation-duration:12s;animation-delay:-5s">🧑‍💻</div>';
        drops.forEach(function (d, i) {
          var col = i % 3, row = Math.floor(i / 3);
          html += '<div class="drop ' + d[1] + '" style="left:' + (3 + col * 33 + (row % 2) * 6) + '%;top:' + (50 + row * 11.5) + '%;transform:rotate(' + ((i % 5) - 2) * 2 + 'deg);animation-delay:' + (0.25 * i) + 's">' + esc(d[0]) + '</div>';
        });
        html += '<div class="speech" style="left:3%;top:8%">anyone can drop anything here!</div></div>';
        el.appendChild(h(title('The data lake is a <em>public beach</em>', 'Picture a huge public beach. Entry is free, there is endless space, and anyone can leave anything on the sand.') +
          '<div class="cols"><div>' + html + '</div><div>' + list([
            'Cheap and practically endless: it is cloud object storage, an <b>S3 bucket</b> or its Azure / Google twin.',
            'Any format: tables, JSON, images, audio, PDFs. Great for data science and ML.',
            '-No rules at the gate: no schema check, no transactions.',
            '-Duplicates, half-written files, “orders_FINAL_really.csv”… which one is the truth?',
            '-After a few years the beach turns into a <b>data swamp</b> nobody trusts.']) + '</div></div>'));
      },
      function (el) {
        var html = '<div class="scape pool"><div class="gate">🎟️ entry: $$$</div><div class="guard">🧑‍🚒</div>' +
          '<div class="speech" style="right:9%;top:2%">schema check! no CSV in the water!</div><div class="basin"></div>';
        [24, 42, 60, 78].forEach(function (x) { html += '<div class="lane" style="left:' + x + '%"></div>'; });
        [15, 33, 51, 69, 86].forEach(function (x, i) { html += '<div class="swimmer" style="left:' + (x - 3) + '%;top:24%;animation-delay:-' + i + 's">🏊</div>'; });
        html += '</div>';
        el.appendChild(h(title('The data warehouse is a <em>swimming pool</em>', 'Across the road there is a pool: clean water, lanes, a lifeguard, opening hours, and a ticket at the gate.') +
          '<div class="cols"><div>' + html + '</div><div>' + list([
            '+Clean, structured tables with a schema that is enforced.',
            '+Transactions (ACID): nobody sees a half-finished load.',
            '+Fast SQL for BI dashboards and reports.',
            '-Expensive, and storage is tied to one vendor’s engine and format.',
            '-Only tables: no images, no raw JSON, little room for ML.',
            '-Data has to be copied in (ETL) from the lake first.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Two worlds, <em>two copies</em>', 'For years most companies ran both: raw data on the beach, a cleaned copy in the pool, and pipelines carrying buckets of water across the road.') +
          '<table class="tbl"><tr><th></th><th>🏖️ Data lake</th><th>🏊 Data warehouse</th></tr>' +
          '<tr><td><b>Storage</b></td><td>cheap object storage, open files</td><td>managed by the warehouse, proprietary format</td></tr>' +
          '<tr><td><b>Data</b></td><td>anything: structured, semi-structured, unstructured</td><td>structured tables only</td></tr>' +
          '<tr><td><b>Rules</b></td><td>none: schema on read</td><td>schema on write, ACID transactions</td></tr>' +
          '<tr><td><b>Users</b></td><td>data engineers, data scientists</td><td>analysts, BI</td></tr>' +
          '<tr><td><b>Technologies</b></td><td>Amazon S3, Azure Data Lake Storage Gen2, Google Cloud Storage, HDFS</td><td>Teradata, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Azure Synapse</td></tr></table>' +
          '<div class="callout sk thin acc">💸 Two copies means two bills, pipelines that break, and two numbers for “revenue” in two meetings.</div>'));
      },
      function (el) {
        var html = '<div class="scape beach"><div class="wave"></div><div class="sun">☀️</div>';
        [30, 46, 62].forEach(function (x, i) { html += '<div class="rope" style="left:' + x + '%;animation-delay:' + (0.3 + i * 0.3) + 's"></div>'; });
        [22, 38, 54, 70].forEach(function (x, i) { html += '<div class="swimmer" style="position:absolute;left:' + x + '%;top:' + (55 + (i % 2) * 14) + '%;font-size:28px;animation:bob 3s ' + i * 0.4 + 's infinite">🏊</div>'; });
        html += '<div class="tower"><b>🧑‍🚒</b>_delta_log</div><div class="speech" style="left:3%;top:8%">same beach, but now with lanes and a lifeguard</div></div>';
        el.appendChild(h(title('The lakehouse: <em>pool rules on the open beach</em>', 'Keep the cheap, open beach. Add the rules of the pool on top: lanes, a lifeguard and a logbook of who did what.') +
          '<div class="cols"><div>' + html + '</div><div>' + list([
            'The water stays where it is: open <b>Parquet</b> files in <b>your</b> bucket.',
            'A <b>transaction log</b> next to the files is the lifeguard: it decides which files make up the table.',
            '+ACID transactions, schema enforcement, time travel: on cheap storage.',
            '+One copy serves BI, SQL, data science and AI.',
            'Open table formats that do this: <b>Delta Lake</b>, Apache Iceberg, Apache Hudi.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'beach', q: 'A data scientist wants raw JSON and images, an analyst wants a fast revenue dashboard. With a lakehouse, how many copies of the orders data do you keep?',
          options: ['One: both read the same Delta tables in the same storage', 'Two: one in the lake, one in the warehouse', 'Three: raw, clean and BI copies are always required', 'It depends on the number of users'],
          correct: 0, why: 'That is the whole point: one copy in open files on cheap storage, made reliable by the transaction log. Bronze, silver and gold are layers of refinement, not copies of the same data for different tools.' }));
      }
    ]
  });

  // 2 ── bucket
  var URLS = {
    aws: { label: 'AWS · Amazon S3', parts: [
      ['s3://', 'c1', '<b>Scheme.</b> Tells Spark which storage driver to use. Databricks uses <code>s3://</code>; open-source Hadoop often writes <code>s3a://</code>.'],
      ['acme-lakehouse-prod', 'c2', '<b>Bucket.</b> The top-level container. The name is globally unique across all of AWS, and a bucket lives in one region, e.g. eu-central-1.'],
      ['/sales/orders/', 'c3', '<b>Prefix.</b> Looks like folders, but S3 is flat: “sales/orders/” is just the start of the object key. The console draws folders for you.'],
      ['part-00000-3f2a.snappy.parquet', 'c4', '<b>Object name.</b> The full key is <code>sales/orders/part-00000-3f2a.snappy.parquet</code>. The object is the bytes plus a little metadata.']] },
    azure: { label: 'Azure · ADLS Gen2', parts: [
      ['abfss://', 'c1', '<b>Scheme.</b> ABFS = Azure Blob File System driver, the extra “s” means TLS.'],
      ['lake', 'c2', '<b>Container.</b> Plays the role of the bucket.'],
      ['@acmestorage', 'c5', '<b>Storage account.</b> The account that owns the containers. With the hierarchical namespace on (that is what makes it “Data Lake Storage Gen2”), directories are real.'],
      ['.dfs.core.windows.net', 'c3', '<b>Endpoint.</b> The Data Lake Storage endpoint of the account.'],
      ['/sales/orders/part-00000-3f2a.snappy.parquet', 'c4', '<b>Path.</b> Directory and file inside the container.']] },
    gcp: { label: 'Google Cloud Storage', parts: [
      ['gs://', 'c1', '<b>Scheme.</b> Google Cloud Storage.'],
      ['acme-lakehouse-prod', 'c2', '<b>Bucket.</b> Globally unique name, lives in a region or multi-region.'],
      ['/sales/orders/', 'c3', '<b>Prefix.</b> Like S3: a flat namespace, folders are just name prefixes.'],
      ['part-00000-3f2a.snappy.parquet', 'c4', '<b>Object name.</b>']] },
    uc: { label: 'Unity Catalog volume', parts: [
      ['/Volumes/', 'c1', '<b>Volumes.</b> A governed path inside Unity Catalog: you use names, Unity Catalog maps them to the cloud URL and checks permissions.'],
      ['main', 'c2', '<b>Catalog.</b>'], ['/sales', 'c3', '<b>Schema.</b>'], ['/raw', 'c5', '<b>Volume.</b> Points at a location in a bucket.'],
      ['/orders.csv', 'c4', '<b>File.</b> No keys, no cloud URLs in your code.']] }
  };
  function urlWidget(el) {
    var cur = 'aws';
    var w = h('<div class="tabs"></div><div class="url"></div><div class="explain card sk thin">👆 Click a part of the path.</div>');
    function draw() {
      w.querySelector('.tabs').innerHTML = Object.keys(URLS).map(function (k) { return '<button data-k="' + k + '" class="' + (k === cur ? 'on' : '') + '">' + URLS[k].label + '</button>'; }).join('');
      w.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { cur = b.dataset.k; draw(); }; });
      var u = w.querySelector('.url');
      u.innerHTML = URLS[cur].parts.map(function (p, i) { return '<span class="' + p[1] + '" data-i="' + i + '">' + esc(p[0]) + '</span>'; }).join('');
      u.querySelectorAll('span').forEach(function (s) {
        s.onclick = function () {
          u.querySelectorAll('span').forEach(function (x) { x.classList.remove('on'); }); s.classList.add('on');
          w.querySelector('.explain').innerHTML = URLS[cur].parts[+s.dataset.i][2];
        };
      });
      w.querySelector('.explain').innerHTML = '👆 Click a part of the path.';
    }
    draw();
    el.appendChild(w);
  }
  SCENES.push({
    id: 'bucket', icon: '🪣', title: 'What is a bucket?', sub: 'Object storage on AWS, Azure and Google, and how a path is built.',
    thumb: '<span style="font-size:58px">🪣</span><span class="tag" style="position:absolute;bottom:6px">s3://bucket/key</span>',
    steps: [
      function (el) {
        var keys = ['sales/orders/part-00000.parquet', 'sales/orders/part-00001.parquet', 'sales/orders/_delta_log/000…000.json', 'hr/employees.csv',
          'images/cats/0001.jpg', 'images/cats/0002.jpg', 'logs/2026/11/20/app.log', 'raw/clicks/2026-11-20.json'];
        el.appendChild(h(title('A bucket is a giant <em>coat check</em>', 'You hand over a coat (the bytes) and get a ticket (the key). Later the ticket gets you the coat back. That is object storage.') +
          '<div class="cols"><div><div class="objstore">' + keys.map(function (k, i) {
            var p = k.lastIndexOf('/'); return '<div class="obj" style="animation-delay:' + i * 0.12 + 's"><b>' + esc(k.slice(0, p + 1)) + '</b>' + esc(k.slice(p + 1)) + '</div>';
          }).join('') + '</div></div><div>' + list([
            'A <b>bucket</b> is a named container in one cloud region.',
            'Inside: <b>objects</b>, each with a <b>key</b> (its full name) and the bytes.',
            'Flat: there are no real folders; “sales/orders/” is just the start of many keys.',
            '+Cheap, extremely durable, practically unlimited.',
            'This is the beach: where the files of every lakehouse table actually live.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Same idea, <em>three clouds</em>') +
          '<div class="cmp" style="--n:3"><div class="card sk"><h4>☁️ AWS</h4><b>Amazon S3</b><br>container: <b>bucket</b><br><span class="tag">s3://bucket/key</span></div>' +
          '<div class="card sk alt"><h4>☁️ Azure</h4><b>Azure Data Lake Storage Gen2</b><br><b>storage account</b> → <b>container</b><br><span class="tag">abfss://container@account.dfs.core.windows.net/path</span></div>' +
          '<div class="card sk"><h4>☁️ Google Cloud</h4><b>Google Cloud Storage</b><br>container: <b>bucket</b><br><span class="tag">gs://bucket/key</span></div></div>' +
          '<div class="callout sk thin">Databricks reads and writes all three. With Unity Catalog you rarely type these URLs: tables and volumes have names, and Unity Catalog knows where they live.</div>'));
      },
      function (el) {
        el.appendChild(h(title('Anatomy of a path', 'The same Parquet file, written on three clouds, and once through a Unity Catalog volume.')));
        urlWidget(el);
      },
      function (el) {
        var box = h(title('You cannot <em>edit</em> an object', 'Try to change one row of a Parquet file that sits in a bucket.') +
          '<div class="cols"><div class="card sk" id="objdemo"><div class="mono" style="font-size:14px">s3://acme-lakehouse-prod/sales/orders/<b>part-00000.parquet</b></div>' +
          '<table class="tbl" style="margin-top:8px"><tr><th>id</th><th>customer</th><th>amount</th></tr><tr><td>1</td><td>Ann</td><td>30</td></tr><tr id="edrow"><td>2</td><td>Bob</td><td id="edcell">12</td></tr><tr><td>3</td><td>Cy</td><td>55</td></tr></table>' +
          '<button class="btn" id="tryedit" style="margin-top:10px">✏️ Change Bob’s amount to 20</button><div id="edres" style="margin-top:8px;font-size:17px"></div></div><div>' + list([
            'Objects are <b>immutable</b>: you can write a whole new object, or delete one. There is no “change byte 1,024”.',
            'Parquet is compressed and encoded in columns, so one row is spread over the whole file anyway.',
            'So every change to a lakehouse table means <b>writing new files</b>.',
            'Keeping track of which files are the current table is the job of the <b>Delta transaction log</b>.']) + '</div></div>');
        el.appendChild(box);
        box.querySelector('#tryedit').onclick = function () {
          var d = box.querySelector('#objdemo'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
          box.querySelector('#edres').innerHTML = '❌ <b>No such operation.</b> The only way: read the file, write <span class="mono">part-00001.parquet</span> with the new value, and stop using the old one.';
        };
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'bucket', q: 'You need to change one value in <span class="mono">part-00000.parquet</span> in an S3 bucket. What has to happen?',
          options: ['S3 patches the bytes of that one row in place', 'A complete new object is written; the old one is dropped or ignored', 'Unity Catalog edits the file for you', 'You rename the file and the value changes'],
          correct: 1, why: 'Objects are immutable. That is why Delta never edits files: it writes new ones and records in the log which files are current.' }));
      }
    ]
  });

  // 3 ── unity catalog
  SCENES.push({
    id: 'uc', icon: '🗺️', title: 'Unity Catalog: one metastore per region', sub: 'Metastore, catalogs, schemas, and where the data really lives.',
    thumb: '<span style="font-size:54px">🗺️</span><span class="tag" style="position:absolute;bottom:6px">main.sales.orders</span>',
    steps: [
      function (el) {
        var rows = [['', '🏛️ <b>metastore</b> <span class="k">top level, one per region</span>'], ['l1', '📚 <b>catalog</b> <span class="k">main, dev, finance…</span>'],
          ['l2', '🗂️ <b>schema</b> <span class="k">sales</span>'], ['l3', '🧊 <b>table</b> <span class="k">orders</span> · 👀 view · 📁 volume · ƒ function · 🤖 model']];
        el.appendChild(h(title('The <em>three-level</em> name', 'Unity Catalog is the lifeguard for the whole company: one place for names, permissions, audit and lineage.') +
          '<div class="cols"><div class="tree card sk">' + rows.map(function (r, i) { return '<div class="' + r[0] + '" style="animation-delay:' + i * 0.25 + 's">' + r[1] + '</div>'; }).join('') +
          '<div style="animation-delay:1.1s;margin-top:12px"><span class="note">SELECT * FROM main.sales.orders</span></div></div><div>' + list([
            '<b>catalog.schema.table</b>: the same name works in SQL, Python and every workspace that can see it.',
            'Permissions are granted on these objects: <span class="mono">GRANT SELECT ON TABLE main.sales.orders TO analysts</span>.',
            'Unity Catalog stores <b>metadata</b>: names, schemas, permissions, lineage.',
            'The <b>data</b> stays in your cloud buckets.']) + '</div></div>'));
      },
      function (el) {
        function region(name, cloud, ms, wss, delay) {
          return '<div class="region sk"><h4>📍 ' + name + '</h4><div class="cloud">' + cloud + '</div>' +
            '<div class="ms" style="animation-delay:' + delay + 's">🏛️ <b>' + ms + '</b></div>' +
            wss.map(function (w, i) { return '<span class="ws" style="animation-delay:' + (delay + 0.4 + i * 0.25) + 's">🖥️ ' + w + '</span>'; }).join('') + '</div>';
        }
        el.appendChild(h(title('One metastore <em>per region</em>', 'Every region where you run Databricks gets its own metastore. Workspaces in that region attach to it.') +
          '<div class="regions">' + region('Frankfurt', 'AWS eu-central-1', 'metastore EU', ['prod', 'dev', 'data-science'], 0.2) +
          region('N. Virginia', 'AWS us-east-1', 'metastore US', ['us-analytics'], 0.9) +
          region('West Europe', 'Azure westeurope', 'metastore WEU', ['finance'], 1.6) + '</div>' +
          '<div class="cols" style="margin-top:14px"><div>' + list(['A workspace attaches to exactly <b>one</b> metastore, in its own region.',
            'All workspaces on the same metastore see the same catalogs (unless you bind a catalog to some workspaces).']) + '</div><div>' +
          list(['One metastore per region per account: Frankfurt has one, however many workspaces you add.', 'Different regions = different metastores.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Where the <em>data</em> lives', 'The names are in Unity Catalog. The files are in buckets that you own, in the same region.') +
          '<div class="regions" style="grid-template-columns:1fr 1fr"><div class="region sk"><h4>🏛️ metastore EU · Frankfurt</h4>' +
          '<div class="tree" style="font-size:16px;margin-top:6px"><div>📚 main <span class="k">managed location →</span></div>' +
          '<div class="l1" style="animation-delay:.3s">🗂️ sales</div><div class="l2" style="animation-delay:.6s">🧊 orders <span class="k">(managed)</span></div>' +
          '<div class="l2" style="animation-delay:.9s">🧊 clicks_raw <span class="k">(external)</span></div></div>' +
          '<div class="store" style="animation-delay:1.2s">🪣 s3://acme-uc-eu/managed/… ← managed tables: Unity Catalog chooses the path</div>' +
          '<div class="store" style="animation-delay:1.5s">🪣 s3://acme-raw-eu/clicks/ ← external location + storage credential</div></div>' +
          '<div>' + list([
            '<b>Managed tables</b>: Unity Catalog picks the folder inside a managed storage location (set on the metastore, catalog or schema) and deletes the files when you DROP the table.',
            '<b>External tables and volumes</b>: data you already have; access goes through an <b>external location</b> and a <b>storage credential</b>.',
            'Users never get bucket keys: Unity Catalog hands the engine short-lived credentials after a permission check.',
            'Another region needs the data? Share it with <b>Delta Sharing</b> instead of copying files by hand.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'uc', q: 'Your company runs two workspaces in Frankfurt and one in North Virginia, all on AWS. How many Unity Catalog metastores do you need?',
          options: ['One for the whole company', 'Two: one per region', 'Three: one per workspace', 'None: each workspace has its own Hive metastore'],
          correct: 1, why: 'One metastore per region. Both Frankfurt workspaces attach to the EU metastore and share its catalogs; Virginia gets its own.' }));
      }
    ]
  });

  // 3b ── storage path decoder (filled in by paths.js)
  SCENES.push({ id: 'paths', icon: '🧭', title: 'Storage path decoder', big: true,
    sub: 'Paste a table or volume storage location from Databricks: every layer of the path explained, and a simulated bucket to walk through.',
    thumb: '<span class="tag" style="font-size:12.5px">s3://…/&lt;metastore-id&gt;/tables/&lt;table-id&gt;</span><span style="font-size:46px;margin-left:8px">🧭</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Decode a <em>real</em> storage path', 'Copy the storage location of a table or volume from Catalog Explorer (or <span class="mono">DESCRIBE DETAIL</span>), paste it, press Explain.')));
        var box = document.createElement('div'); el.appendChild(box);
        if (window.PathSim) window.PathSim.mount(box, { open: openScene }); else box.textContent = 'Path decoder not loaded.';
      },
      function (el) {
        el.appendChild(h(title('Five patterns <em>to recognise</em>', 'Unity Catalog uses the closest managed location: schema, then catalog, then metastore. IDs, never names.')));
        var box = document.createElement('div'); el.appendChild(box);
        if (window.PathSim) window.PathSim.cheat(box);
        el.appendChild(h('<div class="callout sk thin">Why IDs and not names? Renaming a table, a schema or a catalog is then only a change in Unity Catalog: not a single file has to move.</div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'paths', q: 'A path ends in <span class="mono">…/__unitystorage/schemas/0f3a…/tables/4b8f…</span>. What does that tell you?',
          options: ['It is an external table in a folder someone chose', 'A managed table whose schema has its own managed location', 'A managed table stored at the metastore root', 'A file inside a volume'],
          correct: 1, why: '__unitystorage/schemas/&lt;schema-id&gt; is the schema-level managed location. Without it the table would sit under the catalog’s location, or the metastore root (&lt;metastore-id&gt;/tables/…).' }));
      }
    ] });

  // 4 ── what is a delta table
  function deltaFolder(files, logs) {
    return '<div class="folder"><div class="fh">s3://acme-lakehouse-prod/sales/orders/</div>' +
      '<div class="file" style="color:var(--soft)"><span class="ic">📁</span>_delta_log/</div>' +
      logs.map(function (l) { return '<div class="file ' + (l[2] || '') + '" style="padding-left:26px"><span class="ic">🧾</span>' + l[0] + '<span class="tg">' + l[1] + '</span></div>'; }).join('') +
      files.map(function (f) { return '<div class="file ' + (f[2] || '') + '"><span class="ic">📦</span>' + f[0] + '<span class="tg">' + f[1] + '</span></div>'; }).join('') + '</div>';
  }
  SCENES.push({
    id: 'delta', icon: '🔺', title: 'What is a Delta table?', sub: 'Parquet files plus a transaction log: the lifeguard of the beach.',
    thumb: '<span style="font-size:52px">📦📦</span><span style="font-size:44px">+🧾</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('A folder of Parquet files is <em>not yet a table</em>', 'Imagine the orders folder after a few loads and a failed job. Which files are the table?') +
          '<div class="cols"><div>' + deltaFolder([['part-00000.parquet', '3 rows'], ['part-00001.parquet', '2 rows'], ['part-00002.parquet', '2 rows · from a crashed job?'],
            ['part-00003.parquet', '2 rows · replaces 00000?']], []) + '</div><div>' + list([
            'A reader lists the folder and reads <b>everything</b>, including half-written files.',
            '-A writer crashes halfway: readers see a broken table.',
            '-Two writers at the same time: who wins?',
            '-Nothing remembers what the table looked like yesterday.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Add a <em>transaction log</em>', 'Delta Lake keeps a folder called <span class="mono">_delta_log</span> next to the data. Each commit is one numbered JSON file.') +
          '<div class="cols"><div>' + deltaFolder([['part-00000.parquet', 'v1'], ['part-00001.parquet', 'v2'], ['part-00003.parquet', 'v3']],
            [['00000000000000000000.json', 'v0 · CREATE', 'new'], ['00000000000000000001.json', 'v1 · WRITE', 'new'], ['00000000000000000002.json', 'v2 · WRITE', 'new'], ['00000000000000000003.json', 'v3 · DELETE', 'new']]) +
          '</div><div class="logstack">' +
          ['<b>v0</b> protocol + metaData (schema, properties)', '<b>v1</b> add part-00000.parquet', '<b>v2</b> add part-00001.parquet', '<b>v3</b> remove part-00000 · add part-00003']
            .map(function (c, i) { return '<div class="commit" style="animation-delay:' + (0.3 + i * 0.35) + 's">' + c + '</div>'; }).join('') +
          '<div class="callout sk thin" style="opacity:0;animation:rise .5s 1.8s forwards">The log is the single source of truth: a file that is not <b>added</b> in the log is not part of the table, even if it is in the folder.</div></div></div>'));
      },
      function (el) {
        var box = h(title('Reading = <em>replaying</em> the log', 'To read the table, the engine replays the commits in order and keeps the files that are still added.') +
          '<div class="cols"><div class="logstack" id="replay"></div><div><div class="card sk"><b>Files in the table:</b><div id="liveset" style="margin-top:8px;min-height:90px"></div></div>' +
          '<button class="btn" id="replayBtn" style="margin-top:12px">▶ Replay again</button></div></div>');
        el.appendChild(box);
        var commits = [['v0', 'metaData: id INT, customer STRING, amount DOUBLE', [], []], ['v1', 'add part-00000.parquet', ['part-00000'], []],
          ['v2', 'add part-00001.parquet', ['part-00001'], []], ['v3', 'remove part-00000 · add part-00003', ['part-00003'], ['part-00000']]];
        var timers = [];
        function run() {
          timers.forEach(clearTimeout); timers = [];
          var rp = box.querySelector('#replay'), ls = box.querySelector('#liveset'), live = [];
          rp.innerHTML = ''; ls.innerHTML = '<span style="color:var(--soft)">(empty)</span>';
          commits.forEach(function (c, i) {
            timers.push(setTimeout(function () {
              rp.querySelectorAll('.commit').forEach(function (x) { x.classList.remove('hl'); });
              var d = document.createElement('div'); d.className = 'commit hl'; d.innerHTML = '<b>' + c[0] + '</b> ' + c[1]; rp.appendChild(d);
              live = live.filter(function (f) { return c[3].indexOf(f) < 0; }).concat(c[2]);
              ls.innerHTML = live.length ? live.map(function (f) { return '<div class="file live new"><span class="ic">📦</span>' + f + '.parquet</div>'; }).join('') : '<span style="color:var(--soft)">(no data yet, only a schema)</span>';
            }, 700 * i + 200));
          });
          timers.push(setTimeout(function () {
            var n = document.createElement('div'); n.className = 'note'; n.style.marginTop = '8px';
            n.textContent = 'version 3 = part-00001 + part-00003'; ls.appendChild(n);
          }, 700 * commits.length + 300));
        }
        box.querySelector('#replayBtn').onclick = run;
        run();
      },
      function (el) {
        el.appendChild(h(title('Two writers, <em>one</em> next version', 'Both jobs finish at the same moment and both try to create <span class="mono">00000000000000000004.json</span>.') +
          '<div class="race"><div class="writer card sk"><div class="face">🧑‍💻</div>job A: append<div class="res" style="color:var(--green)">✓ wrote 004.json first</div></div>' +
          '<div style="font-family:var(--hand);font-size:34px">⚔️</div>' +
          '<div class="writer card sk alt"><div class="face">🤖</div>job B: append<div class="res" style="color:var(--accent)">↻ 004 exists → checks for conflicts, retries as 005</div></div></div>' +
          '<div class="cols" style="margin-top:16px"><div>' + list(['Creating the next log file is <b>atomic</b>: only one writer can create version 4.',
            '+Atomicity: a commit is all or nothing; data files without a commit are invisible.', '+Isolation: readers always see a complete version (a snapshot).']) + '</div><div>' +
          list(['+Durability: the log and files live on durable object storage.', '+Consistency: the schema in the log is enforced on every write.',
            'Bonus: old versions stay readable. That is <b>time travel</b>.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'delta', q: 'Where does Spark find out which Parquet files make up version 3 of a Delta table?',
          options: ['By listing every file in the table folder', 'In the JSON commits (and checkpoints) of <span class="mono">_delta_log</span>', 'In the footer of each Parquet file', 'In the Unity Catalog permissions'],
          correct: 1, why: 'The transaction log is the source of truth. Replaying the commits up to version 3 gives the exact set of files; files in the folder that are not added (or were removed) are ignored.' }));
        var go = h('<div style="margin-top:16px"><button class="btn acc">🧪 Now build one yourself in the simulator →</button></div>');
        go.querySelector('button').onclick = function () { openScene('sim'); };
        el.appendChild(go);
      }
    ]
  });

  // 5 ── simulator (filled in by sim.js)
  SCENES.push({ id: 'sim', icon: '🧪', title: 'Delta table simulator', big: true,
    sub: 'Run SQL or Python, watch Parquet files and log commits appear, and open every file. A safe sandbox: nothing really runs.',
    thumb: '<span class="tag" style="font-size:15px">CREATE · INSERT · DELETE · OPTIMIZE · VACUUM</span><span style="font-size:48px;margin-left:10px">🧪</span>',
    steps: [function (el) { if (window.DeltaSim) window.DeltaSim.mount(el, { quiz: quiz, ask: ask, open: openScene }); else el.textContent = 'Simulator not loaded.'; }] });

  // 6 ── parquet vs csv
  var ROWS = [[1, 'Ann', 'EMEA', 30], [2, 'Bob', 'APAC', 12], [3, 'Cy', 'EMEA', 55], [4, 'Dee', 'AMER', 8], [5, 'Eve', 'APAC', 41], [6, 'Finn', 'EMEA', 23]];
  function csvText(read) {
    return '<div class="csvtxt' + (read ? ' readall' : '') + '"><span class="r">id,customer,region,amount</span>' + ROWS.map(function (r) { return '<span class="r">' + r.join(',') + '</span>'; }).join('') + '</div>';
  }
  function cols(readCol) {
    var names = ['id', 'customer', 'region', 'amount'];
    return '<div class="colwrap">' + names.map(function (n, ci) {
      var cls = readCol == null ? '' : (ci === readCol ? 'read' : 'skip');
      return '<div class="col ' + cls + '"><h6>' + n + '</h6>' + ROWS.map(function (r) { return '<div>' + r[ci] + '</div>'; }).join('') + '</div>';
    }).join('') + '</div>';
  }
  SCENES.push({
    id: 'parquet', icon: '📦', title: 'Parquet vs CSV', sub: 'Why lakehouse tables store data in columns.',
    thumb: '<span class="tag">a,b,c</span><span style="font-size:30px;margin:0 8px">→</span><span style="font-size:52px">📦</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('Same six orders, <em>two files</em>') + '<div class="layout"><div><div class="note">orders.csv · text, row by row</div>' + csvText() +
          list(['Human readable, every tool opens it.', '-Everything is text: “55” could be a number or a string.', '-No schema, no statistics, no compression by itself.']) +
          '</div><div><div class="note">orders.parquet · binary, column by column</div>' + cols(null) +
          list(['+Typed columns with a schema in the file.', '+Each column is encoded and compressed on its own.', '+Min/max statistics for every column chunk.']) + '</div></div>'));
      },
      function (el) {
        var box = h(title('<span class="mono" style="font-size:30px">SELECT avg(amount)</span> <em>reads what?</em>', 'Press the button and watch which bytes each format has to read.') +
          '<div class="layout"><div><div class="note">CSV</div><div id="csvA">' + csvText() + '</div></div><div><div class="note">Parquet</div><div id="pqA">' + cols(null) + '</div></div></div>' +
          '<button class="btn acc" id="runAvg" style="margin-top:14px">▶ Run the query</button>' +
          '<div style="margin-top:12px;display:grid;gap:8px;max-width:640px"><div>CSV bytes read<div class="bar" id="b1"></div></div><div>Parquet bytes read<div class="bar" id="b2" style="background:var(--green)"></div></div></div>');
        el.appendChild(box);
        box.querySelector('#runAvg').onclick = function () {
          box.querySelector('#csvA').innerHTML = csvText(true);
          box.querySelector('#pqA').innerHTML = cols(3);
          box.querySelector('#b1').style.width = '100%'; box.querySelector('#b1').textContent = 'every row, every column';
          box.querySelector('#b2').style.width = '22%'; box.querySelector('#b2').textContent = 'amount only';
        };
      },
      function (el) {
        var rgs = [['row group 1', 'amount min 8 · max 30', 30], ['row group 2', 'amount min 12 · max 55', 55], ['row group 3', 'amount min 61 · max 98', 98], ['row group 4', 'amount min 2 · max 19', 19]];
        var box = h(title('Statistics let Spark <em>skip</em> whole chunks', 'A big Parquet file is split into row groups. The footer stores min and max per column for each group.') +
          '<div class="rgs">' + rgs.map(function (r, i) { return '<div class="rgbox" data-max="' + r[2] + '"><b>' + r[0] + '</b><br>' + r[1] + '</div>'; }).join('') + '</div>' +
          '<div style="margin-top:14px"><button class="btn acc" id="filt">▶ WHERE amount &gt; 60</button></div><div class="explain card sk thin" id="filtx">The footer is read first, then only the row groups that can contain a match.</div>');
        el.appendChild(box);
        box.querySelector('#filt').onclick = function () {
          box.querySelectorAll('.rgbox').forEach(function (r) { r.classList.add(+r.dataset.max > 60 ? 'read' : 'skip'); });
          box.querySelector('#filtx').innerHTML = '3 of 4 row groups are skipped without reading them: their max amount is ≤ 60. Delta keeps the same kind of statistics per <b>file</b> in the log, so whole files are skipped too (data skipping).';
        };
      },
      function (el) {
        el.appendChild(h(title('Side by side') + '<table class="tbl"><tr><th></th><th>CSV</th><th>Parquet</th></tr>' +
          '<tr><td>Layout</td><td>rows, as text</td><td>columns, binary</td></tr><tr><td>Schema and types</td><td>✗ guessed when read</td><td>✓ stored in the footer</td></tr>' +
          '<tr><td>Size</td><td>big</td><td>usually several times smaller (encoding + compression)</td></tr>' +
          '<tr><td>Read one column</td><td>✗ reads everything</td><td>✓ reads that column only</td></tr><tr><td>Skip data with statistics</td><td>✗</td><td>✓ min/max per row group</td></tr>' +
          '<tr><td>Change a row in place</td><td>✗</td><td>✗ (files are immutable; Delta writes new files)</td></tr></table>' +
          '<div class="callout sk thin">A Delta table = Parquet files (the data) + the transaction log (which files, plus their statistics).</div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'parquet', q: 'A table has 40 columns and a billion rows. Roughly how much of the Parquet data does <span class="mono">SELECT avg(amount)</span> read?',
          options: ['All of it, like a CSV', 'About one column’s worth: the amount chunks (plus the small footers)', 'Only the footer, the average is stored there', 'Half of it'],
          correct: 1, why: 'Columnar layout: Spark reads only the column chunks it needs. The footer has min, max and counts, but not averages.' }));
      }
    ]
  });

  // 7 ── deletion vectors
  function gridHtml(n, marked, cls) {
    var s = '<div class="rowsgrid ' + (cls || '') + '">';
    for (var i = 0; i < n; i++) s += '<i class="' + (marked.indexOf(i) >= 0 ? 'x' : '') + '"></i>';
    return s + '</div>';
  }
  SCENES.push({
    id: 'dv', icon: '🧷', title: 'Deletion vectors', sub: 'Delete one row without rewriting a 1 GB file.',
    thumb: '<span style="font-size:52px">📦</span><span class="dvchip" style="margin-left:8px">🧷 row 3 ✗</span>',
    steps: [
      function (el) {
        var box = h(title('Deleting one row, <em>the old way</em>', 'A 1 GB file with millions of rows. You delete <b>one</b> customer. Without deletion vectors Delta must rewrite the whole file: copy-on-write.') +
          '<div class="cols"><div class="bigfile"><b class="mono">part-00007.parquet · 1 GB</b>' + gridHtml(160, [57]) +
          '<div class="prog"><i id="cpy"></i></div><div id="cpyt" style="font-size:15px;margin-top:6px;color:var(--soft)">waiting…</div></div><div>' + list([
            'Read the whole file, keep every row except one, write a new 1 GB file.',
            'Log: <span class="mono">remove part-00007</span> + <span class="mono">add part-00008</span>.',
            '-Slow and expensive for small, frequent deletes (GDPR requests, CDC updates).',
            '-The bigger the files, the worse it gets.']) + '<button class="btn acc" id="cow">▶ DELETE … WHERE id = 57</button></div></div>');
        el.appendChild(box);
        box.querySelector('#cow').onclick = function () {
          box.querySelector('.rowsgrid').classList.add('copying');
          box.querySelector('#cpy').style.width = '100%';
          box.querySelector('#cpyt').textContent = 'rewriting 1 GB to drop 1 row…';
          setTimeout(function () { box.querySelector('#cpyt').innerHTML = '✓ done: <b>part-00008.parquet</b> (1 GB, one row fewer). 1 GB written for one row.'; }, 2500);
        };
      },
      function (el) {
        var box = h(title('A deletion vector is a <em>sticky note</em>', 'With deletion vectors on, Delta leaves the Parquet file alone and writes a tiny file that lists the deleted row positions.') +
          '<div class="cols"><div class="bigfile"><b class="mono">part-00007.parquet · 1 GB · untouched</b>' + gridHtml(160, []) +
          '<div id="dvout" style="margin-top:10px;min-height:40px"></div></div><div>' + list([
            '+Writes a few bytes instead of 1 GB: deletes and updates get much faster.',
            'It lands in a small <b>new folder</b> in the table root (a short random name like <span class="mono">fJ/</span>), next to <span class="mono">_delta_log/</span>.',
            'The new commit in the log points to it.',
            'Row positions are stored as a compressed bitmap (RoaringBitmap).',
            'Small vectors can even live inline in the log.']) + '<button class="btn acc" id="dvb">▶ DELETE … WHERE id = 57</button></div></div>');
        el.appendChild(box);
        box.querySelector('#dvb').onclick = function () {
          box.querySelectorAll('.rowsgrid i')[57].classList.add('x');
          box.querySelector('#dvout').innerHTML = '<div class="folder" style="max-width:520px"><div class="fh">s3://acme-lakehouse-prod/sales/orders/</div>' +
            '<div class="file"><span class="ic">📁</span>_delta_log/<span class="tg">+1 commit</span></div>' +
            '<div class="file new"><span class="ic">📂</span>fJ/<span class="tg">new folder</span></div>' +
            '<div class="file new" style="padding-left:30px"><span class="ic">🧷</span>deletion_vector_4f1c….bin<span class="tg">34 B · row 57 deleted</span></div>' +
            '<div class="file"><span class="ic">📦</span>part-00007.parquet<span class="tg">1 GB · unchanged</span></div></div>';
        };
      },
      function (el) {
        var box = h(title('Reading it with <em>SQL</em>', 'Nothing changes in your query. You write a normal SELECT; Delta does the extra step for you.') +
          '<div class="cols"><div><div class="cell"><div class="ch">notebook cell · SQL</div><pre><span class="kw">SELECT</span> * <span class="kw">FROM</span> main.sales.orders</pre></div>' +
          '<button class="btn acc" id="rdgo" style="margin-top:12px">▶ Watch the read</button></div><div class="logstack" id="rdsteps"></div></div>');
        el.appendChild(box);
        var st = [['🧾', '<b>Read _delta_log</b>: the current version is part-00007.parquet, and its add action has a <span class="mono">deletionVector</span> pointer.'],
          ['📦', '<b>Read part-00007.parquet</b>: all rows, including the deleted ones. They are still in the file.'],
          ['🧷', '<b>Read the .bin file</b> the pointer names: rows 57, 91 and 133 are deleted.'],
          ['✂️', '<b>Skip those rows</b> and return the rest. You never see them.'],
          ['🧹', 'Later, <span class="mono">OPTIMIZE</span> or <span class="mono">REORG TABLE main.sales.orders APPLY (PURGE)</span> rewrites the file without them, and the vectors are no longer needed.']];
        box.querySelector('#rdgo').onclick = function () {
          var out = box.querySelector('#rdsteps'); out.innerHTML = '';
          st.forEach(function (x, i) { var d = document.createElement('div'); d.className = 'commit'; d.style.animationDelay = (i * 0.6) + 's'; d.innerHTML = x[0] + ' ' + x[1]; out.appendChild(d); });
        };
        box.querySelector('#rdgo').click();
      },
      function (el) {
        el.appendChild(h(title('Reading with a deletion vector', 'Merge-on-read: the reader loads the file and its vector, and skips the marked rows.') +
          '<div class="cols"><div class="card sk"><div class="mono" style="font-size:14px">📦 part-00007.parquet  +  🧷 deletion vector</div>' + gridHtml(160, [57, 91, 133]) +
          '<div class="note" style="margin-top:8px">3 rows hidden, 0 bytes rewritten</div></div><div>' + list([
            'Every read pays a small cost to apply the vectors.',
            'Many deletes on the same file add up, so the vectors are folded in later:',
            '<span class="mono">OPTIMIZE</span> rewrites files and drops their vectors, <span class="mono">REORG TABLE … APPLY (PURGE)</span> does it for every file with deleted rows.',
            'Then <span class="mono">VACUUM</span> removes the old files from storage.',
            'Table property: <span class="mono">delta.enableDeletionVectors</span>. Databricks turns it on for new tables in recent runtimes.']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'dv', q: 'Which workload benefits most from deletion vectors?',
          options: ['Appending new daily files', 'Frequent deletes and updates that touch a few rows in big files', 'Reading the whole table once a day', 'CREATE TABLE statements'],
          correct: 1, why: 'Deletion vectors avoid rewriting big files for a few changed rows. Appends never rewrite files anyway.' }));
        var go = h('<div style="margin-top:16px"><button class="btn acc">🧪 Try DELETE with deletion vectors on and off in the simulator →</button></div>');
        go.querySelector('button').onclick = function () { openScene('sim'); };
        el.appendChild(go);
      }
    ]
  });

  // 7b ── change data feed
  function cdfTable(stepped) {
    return '<table class="tbl" style="max-width:720px"><tr><th>id</th><th>customer</th><th>amount</th><th>_change_type</th><th>_commit_version</th></tr>' +
      [[4, 'Dee', '8.0', 'insert', 2, '#1a56c4'], [2, 'Bob', '12.0', 'delete', 3, '#c5221f'], [5, 'Eve', '41.0', 'update_preimage', 4, '#b06000'], [5, 'Eve', '99.0', 'update_postimage', 4, '#137333']]
        .map(function (r, i) { return '<tr style="opacity:0;animation:rise .45s ' + (stepped ? i * 0.5 : 0) + 's forwards"><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td><b style="color:' + r[5] + '">' + r[3] + '</b></td><td>' + r[4] + '</td></tr>'; }).join('') + '</table>';
  }
  SCENES.push({
    id: 'cdf', icon: '🔁', title: 'Change data feed: before and after', sub: 'What changed in the table, row by row: pre-image and post-image.',
    thumb: '<span class="tag" style="color:#b06000">update_preimage</span><span style="font-size:26px;margin:0 6px">→</span><span class="tag" style="color:#137333">update_postimage</span>',
    steps: [
      function (el) {
        el.appendChild(h(title('“What changed since yesterday?”', 'The table shows how things are <b>now</b>. Downstream jobs often need the <b>changes</b>: which rows were added, deleted or updated, and what they looked like before.') +
          '<div class="cols"><div>' + list(['Turn it on per table: <span class="mono">delta.enableChangeDataFeed = true</span>.',
            'From then on every DELETE, UPDATE and MERGE also writes the changed rows to a new folder: <span class="mono">_change_data/</span>.',
            'Each changed row gets an extra column, <b>_change_type</b>.',
            'You read it with <span class="mono">table_changes(…)</span>, not by opening the files.']) + '</div><div class="folder"><div class="fh">s3://acme-lakehouse-prod/sales/orders/</div>' +
          '<div class="file"><span class="ic">📁</span>_delta_log/<span class="tg">commits</span></div><div class="file new"><span class="ic">📂</span>_change_data/<span class="tg">change data feed</span></div>' +
          '<div class="file new" style="padding-left:30px"><span class="ic">🔁</span>cdc-00000-….c000.snappy.parquet<span class="tg">v3 · DELETE</span></div>' +
          '<div class="file new" style="padding-left:30px"><span class="ic">🔁</span>cdc-00001-….c000.snappy.parquet<span class="tg">v4 · UPDATE</span></div>' +
          '<div class="file"><span class="ic">📦</span>part-00000-….snappy.parquet<span class="tg">data</span></div></div></div>'));
      },
      function (el) {
        el.appendChild(h(title('An UPDATE leaves <em>two</em> rows', 'Eve’s amount goes from 41 to 99. The change data file keeps both versions of her row.') +
          '<div class="cols"><div><div class="cell"><div class="ch">notebook cell · SQL</div><pre><span class="kw">UPDATE</span> main.sales.orders\n<span class="kw">SET</span> amount = <span class="nu">99</span> <span class="kw">WHERE</span> id = <span class="nu">5</span></pre></div>' +
          '<table class="tbl" style="margin-top:14px"><tr><th>id</th><th>customer</th><th>amount</th><th>_change_type</th></tr>' +
          '<tr style="opacity:0;animation:rise .5s .4s forwards"><td>5</td><td>Eve</td><td>41.0</td><td><b style="color:#b06000">update_preimage</b></td></tr>' +
          '<tr style="opacity:0;animation:rise .5s 1.1s forwards"><td>5</td><td>Eve</td><td>99.0</td><td><b style="color:#137333">update_postimage</b></td></tr></table></div><div>' +
          list(['<b>pre-image</b>: the row as it was <b>before</b> the update.', '<b>post-image</b>: the row <b>after</b> the update.',
            'A DELETE leaves one row with <b>delete</b>.', 'An INSERT is simply <b>insert</b>, read from the normal data files (no extra file needed).']) + '</div></div>'));
      },
      function (el) {
        el.appendChild(h(title('Reading the changes with <em>SQL</em>', 'Ask for everything that changed since a version. Delta adds three columns.') +
          '<div class="cell" style="max-width:720px"><div class="ch">notebook cell · SQL</div><pre><span class="kw">SELECT</span> * <span class="kw">FROM</span> table_changes(<span class="st">\'main.sales.orders\'</span>, <span class="nu">2</span>)</pre></div>' +
          '<div style="margin-top:14px">' + cdfTable(true) + '</div><div class="callout sk thin" style="max-width:720px">Columns added: <b>_change_type</b>, <b>_commit_version</b>, <b>_commit_timestamp</b>. ' +
          'Python: <span class="mono">spark.read.option("readChangeFeed", "true").option("startingVersion", 2).table("main.sales.orders")</span>. ' +
          'Old change files are removed by VACUUM like other old files.</div>'));
      },
      function (el) {
        el.appendChild(h(title('Quick check')));
        el.appendChild(quiz({ id: 'cdf', q: 'Change data feed is on. You run <span class="mono">UPDATE … SET amount = 99 WHERE id = 5</span>. How many rows for id 5 does <span class="mono">table_changes</span> return for that version?',
          options: ['One: the new row', 'Two: update_preimage (before) and update_postimage (after)', 'None: updates are not tracked', 'Three: delete, insert and update'],
          correct: 1, why: 'An update is recorded as a pair: the pre-image with the old values and the post-image with the new values, both with the same commit version.' }));
        var go = h('<div style="margin-top:16px"><button class="btn acc">🧪 Try it: switch on “change data feed” in the simulator, run an UPDATE, then table_changes →</button></div>');
        go.querySelector('button').onclick = function () { openScene('sim'); };
        el.appendChild(go);
      }
    ]
  });

  // 8 ── recap
  SCENES.push({
    id: 'recap', icon: '🏁', title: 'The whole story', sub: 'From the beach to a deletion vector, on one page.',
    thumb: '<span style="font-size:46px">🏖️→🪣→🗺️→🔺→🧷</span>',
    steps: [function (el) {
      var parts = [['🏖️', 'beach = lake', 'cheap, open, but no rules'], ['🏊', 'pool = warehouse', 'rules, but costly and closed'], ['🪣', 'bucket', 'immutable objects in your cloud'],
        ['🗺️', 'Unity Catalog', 'names, permissions, one metastore per region'], ['🔺', 'Delta table', 'Parquet files + _delta_log'], ['🧷', 'deletion vector', 'a sticky note instead of a rewrite']];
      el.appendChild(h(title('The whole story <em>on one page</em>') + '<div class="journey">' + parts.map(function (p, i) {
        return '<div class="card sk' + (i % 2 ? ' alt' : '') + '" style="animation-delay:' + i * 0.2 + 's"><b>' + p[0] + '</b><span>' + p[1] + '</span><div style="font-size:15px;color:#5b564c">' + p[2] + '</div></div>';
      }).join('') + '</div>' + '<div class="cols" style="margin-top:18px"><div>' + list([
        'The lakehouse keeps the open beach and adds the rules of the pool.', 'Files never change: every write adds new files and a new commit.',
        'The log decides what the table is, at every version.', 'OPTIMIZE compacts, VACUUM cleans up, deletion vectors make small changes cheap.']) +
        '</div><div class="card sk" id="final"></div></div>'));
      var ids = Object.keys(store.answers), ok = ids.filter(function (k) { return store.answers[k]; }).length;
      $('#final', el).innerHTML = '<div class="note">Your score: ' + ok + ' / ' + ids.length + '</div><p>Go deeper in the lessons: <b>Lakehouse architecture</b>, <b>Anatomy of a Delta table</b>, ' +
        '<b>The Delta transaction log</b>, <b>Deletion vectors</b>, <b>The small-file problem</b>.</p><a class="btn" href="../../" style="text-decoration:none;display:inline-block">📚 Open the lessons</a>';
    }]
  });

  // ------------------------------------------------------------------ board: a pannable, zoomable canvas
  // x, y, w: position on the canvas. Frames can be dragged; positions are remembered per viewer.
  var LAYOUT = {
    beach: [60, 90, 320], bucket: [470, 90, 320], explorer: [880, 40, 600], uc: [470, 600, 320], paths: [470, 1060, 320],
    delta: [1580, 90, 330], sim: [1580, 600, 560], parquet: [2240, 90, 320], dv: [2240, 600, 320], cdf: [1580, 1060, 340], recap: [2240, 1060, 320]
  };
  var EDGES = [
    ['beach', 'bucket', 'the beach is object storage'], ['bucket', 'explorer', 'look inside a bucket'],
    ['explorer', 'delta', 'sales/orders/ is a Delta table'], ['bucket', 'uc', 'Unity Catalog governs the buckets'],
    ['uc', 'explorer', 'main.sales.orders → this folder'], ['uc', 'paths', 'decode a real storage path'], ['delta', 'sim', 'build one yourself'],
    ['delta', 'parquet', 'the data files are Parquet'], ['sim', 'dv', 'DELETE with deletion vectors'], ['parquet', 'dv', ''], ['sim', 'cdf', 'what changed? pre- and post-image'], ['dv', 'cdf', ''], ['cdf', 'recap', '']
  ];
  var pos = {};
  try { pos = JSON.parse(localStorage.getItem('dlsb-pos') || '{}') || {}; } catch (e) { pos = {}; }
  function P(id) { return pos[id] || LAYOUT[id]; }
  var view = { x: 0, y: 0, z: 1 };
  function applyView() { $('#canvas').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')'; $('#zoomv').textContent = Math.round(view.z * 100) + '%'; }
  function fit() {
    var vp = $('#board').getBoundingClientRect(), maxX = 0, maxY = 0;
    document.querySelectorAll('#canvas .frame').forEach(function (f) { maxX = Math.max(maxX, f.offsetLeft + f.offsetWidth); maxY = Math.max(maxY, f.offsetTop + f.offsetHeight); });
    view.z = Math.max(0.3, Math.min(1, Math.min((vp.width - 40) / (maxX + 40), (vp.height - 40) / (maxY + 40))));
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
    var e = P('explorer');
    html += '<div class="frame widget" data-id="explorer" style="left:' + e[0] + 'px;top:' + e[1] + 'px;width:' + e[2] + 'px"><div class="whead">🔎 Inside a real bucket <small>· drag me by this bar</small></div><div class="wbx" id="bx"></div></div>';
    cv.innerHTML = '<svg id="arrows"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8f897c"/></marker></defs></svg>' + html + '<div id="elabels"></div>';
    if (window.DeltaSim) window.DeltaSim.boardExplorer($('#bx'), { open: openScene });
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
  // drag a frame (only after a small movement, so a click still opens it)
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
          try { localStorage.setItem('dlsb-pos', JSON.stringify(pos)); } catch (e2) { }
        }
      }
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
    if (!f.classList.contains('widget')) {
      f.addEventListener('click', function () { if (!dragged) open(+f.dataset.i, 0); });
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(+f.dataset.i, 0); });
    }
  }
  // pan the board by dragging the background, zoom with the wheel (or pinch on a trackpad)
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
      if (e.target.closest('.wbx') && !e.ctrlKey) return;      // let the bucket explorer scroll
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.deltaX && e.deltaMode === 0 && !e.shiftKey && false) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      } else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
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
  $('#zlayout').onclick = function () { pos = {}; try { localStorage.removeItem('dlsb-pos'); } catch (e) { } drawBoard(); fit(); };
  window.addEventListener('resize', function () { drawArrows(); });

  // ------------------------------------------------------------------ window
  var cur = -1, step = 0, seen = {};
  var win = $('#win'), body = $('#wBody');
  (function () {
    var w = $('.window'); w.style.position = 'relative';
    var m = document.createElement('div'); m.id = 'qmodal'; w.appendChild(m);
  })();
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
    s.steps[step](body);
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
  function close() { win.classList.remove('on'); document.body.style.overflow = ''; document.body.classList.remove('winopen'); cur = -1; document.querySelectorAll('#canvas .frame').forEach(function (f) { var s = SCENES[+f.dataset.i]; if (s && store.visited[s.id]) f.classList.add('visited'); }); }
  $('#sNext').onclick = next; $('#sPrev').onclick = prev;
  $('#wX').onclick = close; $('#wClose').onclick = close;
  $('#wPrevScene').onclick = function () { if (cur > 0) open(cur - 1, 0); };
  $('#wNextScene').onclick = function () { if (cur < SCENES.length - 1) open(cur + 1, 0); };
  win.addEventListener('click', function (e) { if (e.target === win) close(); });
  document.addEventListener('keydown', function (e) {
    var t = (e.target.tagName || '').toUpperCase();
    if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA') return;
    if (cur < 0) { if (e.key === 'ArrowRight' && e.target === document.body) { e.preventDefault(); open(0, 0); } return; }
    if (e.key === 'Escape') { if ($('#qmodal').classList.contains('on')) return; close(); }
    else if ((e.key === 'ArrowRight' || e.key === 'PageDown') && !$('#qmodal').classList.contains('on')) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  });
  $('#bPresent').onclick = function () { open(0, 0); };
  $('#bReset').onclick = function () {
    store = { visited: {}, answers: {} }; persist(); updateScore(); seen = {};
    if (window.DeltaSim) window.DeltaSim.reset(); if (window.PathSim) window.PathSim.reset();
    document.querySelectorAll('#canvas .frame').forEach(function (f) { f.classList.remove('visited'); });
  };

  window.SB = { open: open, openScene: openScene, quiz: quiz, ask: ask };
  function init() { drawBoard(); fit(); updateScore(); var m = /#(\w+)/.exec(location.hash); if (m) openScene(m[1]); }
  if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
})();
