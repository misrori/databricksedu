/* Delta table simulator: a small in-browser model of a Delta table (Parquet files + _delta_log),
   a realistic file explorer, and a file viewer. Nothing runs on a real cluster. */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var BUCKET = 's3://acme-lakehouse-prod', TABLE_DIR = 'sales/orders', TABLE = 'main.sales.orders';
  var NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Finn', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lea', 'Max', 'Noa', 'Oli', 'Pia', 'Quin', 'Rex', 'Sam', 'Tia'];
  var AMOUNTS = [30, 12, 55, 8, 41, 23, 67, 5, 90, 17, 34, 72, 11, 48, 26, 63, 9, 38, 81, 14];

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function fmtSize(b) { return b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB'; }

  // ------------------------------------------------------------------ the engine
  function Engine() { this.reset(); }
  Engine.prototype.reset = function () {
    this.v = -1; this.files = []; this.snaps = {}; this.live = []; this.dvOn = true; this.created = false; this.dvDir = null; this.cdfOn = false; this.cdfFrom = null; this.cdcNo = 0; this.commits = {};
    this.nextId = 1; this.seq = 0; this.clock = Date.UTC(2026, 10, 20, 9, 0, 0); this.fileNo = 0; this.history = [];
  };
  Engine.prototype.uid = function (n) {
    // mulberry32: deterministic, so a replay gives the same names
    var s = '', t = (this.seq = (this.seq + 0x6D2B79F5) >>> 0);
    for (var i = 0; i < (n || 8); i++) {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      s += '0123456789abcdef'[((r ^ (r >>> 14)) >>> 0) % 16];
    }
    return s;
  };
  Engine.prototype.uuid = function () { return this.uid(8) + '-' + this.uid(4) + '-' + this.uid(4) + '-' + this.uid(4) + '-' + this.uid(12); };
  Engine.prototype.code = function (n, abc) {
    var h = this.uid(n * 2), out = '';
    for (var i = 0; i < n; i++) out += abc[parseInt(h.substr(i * 2, 2), 16) % abc.length];
    return out;
  };
  Engine.prototype.tick = function () { this.clock += 3 * 60 * 1000 + (this.seq % 47) * 1000; return this.clock; };
  Engine.prototype.file = function (p) { return this.files.find(function (f) { return f.path === p; }); };
  Engine.prototype.liveRows = function (snap) {
    var self = this, out = [];
    (snap || this.live).forEach(function (e) {
      var f = self.file(e.path), del = e.dv ? self.file(e.dv).positions : [];
      f.rows.forEach(function (r, i) { if (del.indexOf(i) < 0) out.push(r); });
    });
    return out.sort(function (a, b) { return a[0] - b[0]; });
  };
  Engine.prototype.stats = function (rows) {
    var ids = rows.map(function (r) { return r[0]; }), am = rows.map(function (r) { return r[2]; }), cu = rows.map(function (r) { return r[1]; }).sort();
    return { numRecords: rows.length, minValues: { id: Math.min.apply(0, ids), customer: cu[0], amount: Math.min.apply(0, am) },
      maxValues: { id: Math.max.apply(0, ids), customer: cu[cu.length - 1], amount: Math.max.apply(0, am) }, nullCount: { id: 0, customer: 0, amount: 0 } };
  };
  Engine.prototype.writeParquet = function (rows) {
    var name = 'part-' + pad(this.fileNo++, 5) + '-' + this.uid(8) + '-' + this.uid(4) + '-c000.snappy.parquet';
    var f = { path: name, dir: '', type: 'parquet', rows: rows.map(function (r) { return r.slice(); }), size: 620 + rows.length * 31, version: this.v + 1, at: this.clock };
    this.files.push(f);
    return f;
  };
  Engine.prototype.writeDv = function (target, positions) {
    var letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    this.dvDir = this.dvDir || this.code(2, letters);
    var name = 'deletion_vector_' + this.uuid() + '.bin';
    var f = { path: name, dir: this.dvDir, type: 'dv', z85: this.dvDir + this.code(20, letters + '0123456789.-:+=^!/*?&<>()[]{}@%$#'), target: target, positions: positions.slice().sort(function (a, b) { return a - b; }), size: 34 + positions.length * 2, version: this.v + 1, at: this.clock };
    this.files.push(f);
    return f;
  };
  // change data feed: the changed rows with a _change_type, in _change_data/ (only when delta.enableChangeDataFeed = true)
  Engine.prototype.writeCdc = function (rows) {
    var name = 'cdc-' + pad(this.cdcNo++, 5) + '-' + this.uuid() + '.c000.snappy.parquet';
    var f = { path: name, dir: '_change_data', type: 'cdc', rows: rows.map(function (r) { return r.slice(); }), size: 840 + rows.length * 40, version: this.v + 1, at: this.clock };
    this.files.push(f);
    return { cdc: { path: '_change_data/' + name, partitionValues: {}, size: f.size, dataChange: false } };
  };
  Engine.prototype.addAction = function (f, dataChange, dv) {
    var a = { add: { path: f.path, partitionValues: {}, size: f.size, modificationTime: this.clock, dataChange: dataChange, stats: JSON.stringify(this.stats(f.rows)) } };
    if (dv) a.add.deletionVector = { storageType: 'u', pathOrInlineDv: dv.z85, offset: 1, sizeInBytes: dv.size, cardinality: dv.positions.length };
    return a;
  };
  Engine.prototype.removeAction = function (e, dataChange) {
    var f = this.file(e.path), a = { remove: { path: e.path, deletionTimestamp: this.clock, dataChange: dataChange, extendedFileMetadata: true, partitionValues: {}, size: f.size } };
    if (e.dv) { var d = this.file(e.dv); a.remove.deletionVector = { storageType: 'u', pathOrInlineDv: d.z85, offset: 1, sizeInBytes: d.size, cardinality: d.positions.length }; }
    return a;
  };
  Engine.prototype.commit = function (op, params, actions, metrics) {
    var self = this;
    this.v++;
    var info = { commitInfo: { timestamp: this.clock, userName: 'you@example.com', operation: op, operationParameters: params || {},
      readVersion: this.v > 0 ? this.v - 1 : undefined, isolationLevel: 'WriteSerializable', isBlindAppend: op === 'WRITE', operationMetrics: metrics || {},
      engineInfo: 'Databricks-Runtime/16.4.x', txnId: this.uid(8) + '-' + this.uid(4) + '-' + this.uid(4) } };
    if (info.commitInfo.readVersion === undefined) delete info.commitInfo.readVersion;
    this.commits[this.v] = actions;
    var lines = [info].concat(actions);
    var text = lines.map(function (l) { return JSON.stringify(l); }).join('\n');
    this.files.push({ path: pad(this.v, 20) + '.json', dir: '_delta_log', type: 'json', lines: lines, size: text.length, version: this.v, at: this.clock });
    // data files and deletion vectors that left the table in this commit
    this.files.forEach(function (f) {
      if ((f.type === 'parquet' || f.type === 'dv') && f.removedIn == null && !self.live.some(function (e) { return e.path === f.path || e.dv === f.path; })) f.removedIn = self.v;
    });
    this.snaps[this.v] = this.live.map(function (e) { return { path: e.path, dv: e.dv }; });
    this.history.push({ version: this.v, timestamp: this.clock, operation: op, params: params || {}, metrics: metrics || {} });
    if (this.v > 0 && this.v % 10 === 0) {
      this.files.push({ path: pad(this.v, 20) + '.checkpoint.parquet', dir: '_delta_log', type: 'checkpoint', size: 4200 + this.live.length * 300, version: this.v, at: this.clock,
        summary: { version: this.v, liveFiles: this.live.map(function (e) { return e.path; }) } });
      var lc = { version: this.v, size: this.live.length + 3, sizeInBytes: 4200 + this.live.length * 300, numOfAddFiles: this.live.length };
      var old = this.file('_last_checkpoint');
      if (old) { old.lines = [lc]; old.version = this.v; old.at = this.clock; }
      else this.files.push({ path: '_last_checkpoint', dir: '_delta_log', type: 'json', lines: [lc], size: 120, version: this.v, at: this.clock });
    }
    return this.v;
  };
  // file status relative to the current version
  Engine.prototype.status = function (f) {
    if (f.deleted) return 'deleted';
    if (f.type === 'json' || f.type === 'checkpoint') return 'log';
    if (f.type === 'cdc') return 'cdc';
    var inLive = this.live.some(function (e) { return e.path === f.path || e.dv === f.path; });
    return inLive ? 'live' : 'removed';
  };

  // ------------------------------------------------------------------ commands
  var POOL_START = [[1, 'Ann', 30], [2, 'Bob', 12], [3, 'Cy', 55]];
  function nextBatch(eng) {
    if (eng.nextId === 1) return POOL_START.map(function (r) { return r.slice(); });
    var out = [];
    for (var i = 0; i < 2; i++) { var id = eng.nextId + i, k = (id - 1) % NAMES.length; out.push([id, NAMES[k] + (id > NAMES.length ? id : ''), AMOUNTS[k]]); }
    return out;
  }
  function liveIds(eng) { return eng.liveRows().map(function (r) { return r[0]; }); }
  function rowsTable(cols, rows, cap) {
    return { cols: cols, rows: rows, cap: cap };
  }

  var CMDS = [
    { id: 'create', label: 'CREATE TABLE', ok: function (e) { return !e.created; },
      sql: function (p, e) { return 'CREATE TABLE ' + TABLE + ' (\n  id       INT,\n  customer STRING,\n  amount   DOUBLE\n)\nTBLPROPERTIES (\n  \'delta.enableDeletionVectors\' = ' + (e.dvOn ? 'true' : 'false') + ',\n  \'delta.enableChangeDataFeed\'  = ' + (e.cdfOn ? 'true' : 'false') + ')'; },
      py: function (p, e) { return 'from delta.tables import DeltaTable\n\n(DeltaTable.create(spark)\n   .tableName("' + TABLE + '")\n   .addColumn("id", "INT")\n   .addColumn("customer", "STRING")\n   .addColumn("amount", "DOUBLE")\n   .property("delta.enableDeletionVectors", "' + (e.dvOn ? 'true' : 'false') + '")\n   .property("delta.enableChangeDataFeed", "' + (e.cdfOn ? 'true' : 'false') + '")\n   .execute())'; },
      run: function (e) {
        e.tick(); e.created = true;
        var schema = { type: 'struct', fields: [{ name: 'id', type: 'integer', nullable: true, metadata: {} }, { name: 'customer', type: 'string', nullable: true, metadata: {} }, { name: 'amount', type: 'double', nullable: true, metadata: {} }] };
        var proto = e.dvOn ? { protocol: { minReaderVersion: 3, minWriterVersion: 7, readerFeatures: ['deletionVectors'], writerFeatures: ['deletionVectors'].concat(e.cdfOn ? ['changeDataFeed'] : []) } }
          : { protocol: { minReaderVersion: 1, minWriterVersion: e.cdfOn ? 4 : 2 } };
        var conf = { 'delta.enableDeletionVectors': String(e.dvOn), 'delta.enableChangeDataFeed': String(e.cdfOn) };
        if (e.cdfOn) e.cdfFrom = 0;
        e.commit('CREATE TABLE', { isManaged: 'true', description: null, partitionBy: '[]', properties: JSON.stringify(conf) }, [proto,
          { metaData: { id: e.uid(8) + '-' + e.uid(4) + '-' + e.uid(4) + '-' + e.uid(4) + '-' + e.uid(12), format: { provider: 'parquet', options: {} }, schemaString: JSON.stringify(schema),
            partitionColumns: [], configuration: conf, createdTime: e.clock } }]);
        return { title: 'An empty table: one folder, one JSON file', html: 'The table exists, but there is <b>no data file yet</b>. Version 0 is a single commit in <span class="mono">_delta_log</span> with the <b>protocol</b> (which features readers need) and the <b>metaData</b> (schema, properties). 👉 Click <span class="mono">00000000000000000000.json</span> in the explorer.', open: pad(0, 20) + '.json' };
      } },
    { id: 'insert', label: 'INSERT', ok: function (e) { return e.created; },
      sql: function (p, e) { return 'INSERT INTO ' + TABLE + ' VALUES\n' + nextBatch(e).map(function (r) { return '  (' + r[0] + ', \'' + r[1] + '\', ' + r[2].toFixed(1) + ')'; }).join(',\n'); },
      py: function (p, e) { return 'rows = [' + nextBatch(e).map(function (r) { return '(' + r[0] + ', "' + r[1] + '", ' + r[2].toFixed(1) + ')'; }).join(', ') + ']\n\n(spark.createDataFrame(rows, "id INT, customer STRING, amount DOUBLE")\n   .write.mode("append")\n   .saveAsTable("' + TABLE + '"))'; },
      run: function (e) {
        var rows = nextBatch(e); e.tick();
        e.nextId = rows[rows.length - 1][0] + 1;
        var f = e.writeParquet(rows);
        e.live.push({ path: f.path, dv: null });
        e.commit('WRITE', { mode: 'Append', partitionBy: '[]' }, [e.addAction(f, true)], { numFiles: '1', numOutputRows: String(rows.length), numOutputBytes: String(f.size) });
        var first = e.files.filter(function (x) { return x.type === 'parquet'; }).length === 1;
        return { title: 'A new Parquet file and a new commit', html: (first ? 'The rows were written to a brand new <b>Parquet</b> file, then version ' + e.v + ' was committed with an <b>add</b> action pointing at it. Only after the commit can readers see the rows.'
          : 'An append never touches the old files: one more Parquet file, one more commit (version ' + e.v + '). Look at the <span class="mono">stats</span> in the add action: min and max per column, used to skip files.'),
          open: f.path, links: first ? [['parquet', '📦 What is a Parquet file?']] : [] };
      } },
    { id: 'select', label: 'SELECT', ok: function (e) { return e.created; },
      sql: function () { return 'SELECT * FROM ' + TABLE + ' ORDER BY id'; },
      py: function () { return 'display(spark.table("' + TABLE + '").orderBy("id"))'; },
      run: function (e) {
        var rows = e.liveRows(), withDv = e.live.filter(function (x) { return x.dv; }), hidden = 0;
        withDv.forEach(function (x) { hidden += e.file(x.dv).positions.length; });
        var steps = '<ol class="readsteps"><li>Read <span class="mono">_delta_log</span> up to <b>version ' + e.v + '</b>: the table is ' + e.live.length + ' Parquet file(s)' +
          (withDv.length ? ', ' + withDv.length + ' of them with a deletion vector' : '') + '.</li><li>Read those Parquet files (removed files in the folder are ignored).</li>' +
          (withDv.length ? '<li>Read the <span class="mono">.bin</span> file(s) in <span class="mono">' + e.dvDir + '/</span> and <b>skip ' + hidden + ' marked row(s)</b>. The bytes are still in the Parquet file, the reader just leaves them out.</li>' : '') +
          '<li>Return ' + rows.length + ' row(s).</li></ol>';
        return { title: 'How the SELECT read the table', html: steps + (withDv.length ? 'This is <b>merge-on-read</b>: cheap deletes, a little extra work on every read, until OPTIMIZE or <span class="mono">REORG TABLE … APPLY (PURGE)</span> rewrites the files.' : ''),
          result: rowsTable(['id', 'customer', 'amount'], rows, rows.length + ' row(s) · version ' + e.v + (hidden ? ' · ' + hidden + ' row(s) hidden by deletion vectors' : '')),
          hl: e.live.map(function (x) { return x.path; }).concat(withDv.map(function (x) { return x.dv; })) };
      } },
    { id: 'delete', label: 'DELETE', ok: function (e) { return e.created && liveIds(e).length > 0; }, params: { id: function (e) { return liveIds(e); } },
      sql: function (p) { return 'DELETE FROM ' + TABLE + '\nWHERE id = {{id}}'; },
      py: function (p) { return 'from delta.tables import DeltaTable\n\nDeltaTable.forName(spark, "' + TABLE + '").delete("id = {{id}}")'; },
      quiz: function (e) {
        return { id: 'sim-delete', q: 'You delete one row. Deletion vectors are <b>' + (e.dvOn ? 'ON' : 'OFF') + '</b>. What happens to the Parquet file that holds the row?',
          options: ['Spark opens the file and removes the row in place', 'A new Parquet file without the row is written; the old file is marked removed in the log but stays on disk',
            'A tiny deletion vector file marks the row as deleted; the Parquet file is not touched', 'Only the log changes, no file is written at all'],
          correct: e.dvOn ? 2 : 1, why: e.dvOn ? 'With deletion vectors on, Delta writes a small .bin file listing the deleted row positions, and re-adds the same Parquet file with a pointer to it. Readers skip those rows.'
            : 'Files are immutable. Without deletion vectors Delta rewrites the file (copy-on-write): a new file with the remaining rows, and a <b>remove</b> for the old one, which stays on disk for time travel until VACUUM.' };
      },
      run: function (e, p) {
        var id = +p.id; e.tick();
        var actions = [], target = null, newFile = null, dvFile = null;
        e.live.forEach(function (en) {
          var f = e.file(en.path), del = en.dv ? e.file(en.dv).positions : [];
          f.rows.forEach(function (r, i) { if (r[0] === id && del.indexOf(i) < 0) target = { en: en, pos: i, f: f }; });
        });
        if (!target) return { error: 'No row with id = ' + id };
        var en = target.en, f = target.f, old = en.dv ? e.file(en.dv).positions : [];
        if (e.dvOn) {
          dvFile = e.writeDv(f.path, old.concat([target.pos]));
          actions.push(e.removeAction(en, true));
          en.dv = dvFile.path;
          actions.push(e.addAction(f, true, dvFile));
          if (e.cdfOn) actions.push(e.writeCdc([f.rows[target.pos].concat(['delete'])]));
          e.commit('DELETE', { predicate: '["(id = ' + id + ')"]' }, actions, { numDeletedRows: '1', numDeletionVectorsAdded: '1', numRemovedFiles: '0', numAddedFiles: '0' });
          return { title: 'A new folder: ' + dvFile.dir + '/', html: 'The Parquet file was <b>not touched</b>. Instead a new folder <span class="mono">' + dvFile.dir + '/</span> appeared in the table root with a small <b>deletion vector</b> file: it says “row ' + target.pos + ' of ' + f.path.slice(0, 10) + '… is deleted”. ' +
            'The new commit in <span class="mono">_delta_log</span> points to it. Open both.' + (e.cdfOn ? '<br>🔁 Change data feed is on, so the deleted row was also written to <span class="mono">_change_data/</span> with <b>_change_type = delete</b>.' : ''),
            open: dvFile.path, links: [['dv', '🧷 Deletion vectors explained']] };
        }
        var keep = f.rows.filter(function (r, i) { return i !== target.pos && old.indexOf(i) < 0; });
        actions.push(e.removeAction(en, true));
        e.live = e.live.filter(function (x) { return x !== en; });
        if (keep.length) { newFile = e.writeParquet(keep); e.live.push({ path: newFile.path, dv: null }); actions.push(e.addAction(newFile, true)); }
        if (e.cdfOn) actions.push(e.writeCdc([f.rows[target.pos].concat(['delete'])]));
        e.commit('DELETE', { predicate: '["(id = ' + id + ')"]' }, actions, { numDeletedRows: '1', numRemovedFiles: '1', numAddedFiles: newFile ? '1' : '0', numCopiedRows: String(keep.length) });
        return { title: 'Copy-on-write: a new file, the old one stays on disk', html: 'Delta copied the ' + keep.length + ' remaining row(s) into a new file and committed version ' + e.v + ' with a <b>remove</b> for the old file and an <b>add</b> for the new one. The old file is still in the folder: older versions need it.' + (e.cdfOn ? '<br>🔁 Change data feed is on, so the deleted row was also written to <span class="mono">_change_data/</span> with <b>_change_type = delete</b>.' : ''),
          open: newFile ? newFile.path : pad(e.v, 20) + '.json', links: [['dv', '🧷 How deletion vectors avoid the rewrite']] };
      } },
    { id: 'update', label: 'UPDATE', ok: function (e) { return e.created && liveIds(e).length > 0; }, params: { id: function (e) { return liveIds(e); } },
      sql: function () { return 'UPDATE ' + TABLE + '\nSET amount = 99.0\nWHERE id = {{id}}'; },
      py: function () { return 'from delta.tables import DeltaTable\n\nDeltaTable.forName(spark, "' + TABLE + '").update(\n    condition = "id = {{id}}",\n    set = {"amount": "99.0"})'; },
      run: function (e, p) {
        var id = +p.id, target = null; e.tick();
        e.live.forEach(function (en) {
          var f = e.file(en.path), del = en.dv ? e.file(en.dv).positions : [];
          f.rows.forEach(function (r, i) { if (r[0] === id && del.indexOf(i) < 0) target = { en: en, pos: i, f: f }; });
        });
        if (!target) return { error: 'No row with id = ' + id };
        var en = target.en, f = target.f, old = en.dv ? e.file(en.dv).positions : [], actions = [];
        var changed = f.rows[target.pos].slice(); changed[2] = 99;
        if (e.dvOn) {
          var dv = e.writeDv(f.path, old.concat([target.pos])), nf = e.writeParquet([changed]);
          actions.push(e.removeAction(en, true)); en.dv = dv.path; actions.push(e.addAction(f, true, dv));
          e.live.push({ path: nf.path, dv: null }); actions.push(e.addAction(nf, true));
          var cdcU = e.cdfOn ? e.writeCdc([f.rows[target.pos].concat(['update_preimage']), changed.concat(['update_postimage'])]) : null;
          if (cdcU) actions.push(cdcU);
          e.commit('UPDATE', { predicate: '["(id = ' + id + ')"]' }, actions, { numUpdatedRows: '1', numDeletionVectorsAdded: '1', numAddedFiles: '1', numRemovedFiles: '0' });
          return { title: 'UPDATE = mark the old row + write the new one', html: 'With deletion vectors an update is a delete plus an insert: the old row is marked in a deletion vector, and the new version of the row goes into a <b>new small Parquet file</b>.' + (e.cdfOn ? '<br>🔁 Change data feed is on: a new file in <span class="mono">_change_data/</span> holds the row twice: <b>update_preimage</b> (before) and <b>update_postimage</b> (after).' : ''), open: cdcU ? cdcU.cdc.path.replace('_change_data/', '') : nf.path };
        }
        var rows = f.rows.filter(function (r, i) { return old.indexOf(i) < 0; }).map(function (r) { return r[0] === id ? changed : r; });
        actions.push(e.removeAction(en, true)); e.live = e.live.filter(function (x) { return x !== en; });
        var nf2 = e.writeParquet(rows); e.live.push({ path: nf2.path, dv: null }); actions.push(e.addAction(nf2, true));
        var cdcU2 = e.cdfOn ? e.writeCdc([f.rows[target.pos].concat(['update_preimage']), changed.concat(['update_postimage'])]) : null;
        if (cdcU2) actions.push(cdcU2);
        e.commit('UPDATE', { predicate: '["(id = ' + id + ')"]' }, actions, { numUpdatedRows: '1', numCopiedRows: String(rows.length - 1), numAddedFiles: '1', numRemovedFiles: '1' });
        return { title: 'UPDATE rewrote the whole file', html: 'Without deletion vectors, changing one value means copying every row of that file into a new file (copy-on-write).' + (e.cdfOn ? '<br>🔁 Change data feed is on: a new file in <span class="mono">_change_data/</span> holds the row twice: <b>update_preimage</b> (before) and <b>update_postimage</b> (after).' : ''), open: cdcU2 ? cdcU2.cdc.path.replace('_change_data/', '') : nf2.path };
      } },
    { id: 'history', label: 'DESCRIBE HISTORY', ok: function (e) { return e.created; },
      sql: function () { return 'DESCRIBE HISTORY ' + TABLE; },
      py: function () { return 'from delta.tables import DeltaTable\n\ndisplay(DeltaTable.forName(spark, "' + TABLE + '").history())'; },
      run: function (e) {
        var rows = e.history.slice().reverse().map(function (h) {
          var m = Object.keys(h.metrics).slice(0, 2).map(function (k) { return k + '=' + h.metrics[k]; }).join(', ');
          return [h.version, new Date(h.timestamp).toISOString().slice(0, 19).replace('T', ' '), h.operation, m];
        });
        return { title: 'The history is the log', html: 'Every row here is one JSON file in <span class="mono">_delta_log</span>. Nothing else is stored to make history work.', result: rowsTable(['version', 'timestamp', 'operation', 'operationMetrics'], rows) };
      } },
    { id: 'travel', label: 'VERSION AS OF', ok: function (e) { return e.v >= 0; }, params: { v: function (e) { var a = []; for (var i = e.v; i >= 0; i--) a.push(i); return a; } },
      sql: function () { return 'SELECT * FROM ' + TABLE + ' VERSION AS OF {{v}}\nORDER BY id'; },
      py: function () { return 'display(spark.read\n   .option("versionAsOf", {{v}})\n   .table("' + TABLE + '")\n   .orderBy("id"))'; },
      run: function (e, p) {
        var v = +p.v, snap = e.snaps[v];
        var missing = snap.filter(function (x) { return e.file(x.path).deleted || (x.dv && e.file(x.dv).deleted); });
        if (missing.length) return { error: 'DELTA_FILE_NOT_FOUND: ' + BUCKET + '/' + TABLE_DIR + '/' + missing[0].path + ' was not found. It is referenced by version ' + v + ' but was removed by VACUUM.',
          title: 'Time travel broke after VACUUM', html: 'The log still describes version ' + v + ', but the data files it needs are gone. VACUUM decides how far back you can travel.' };
        var rows = e.liveRows(snap);
        return { title: 'Time travel', html: 'Spark replayed the log only up to <b>version ' + v + '</b> and read the ' + snap.length + ' file(s) that made up the table then. Files that were removed later are still on disk, so this works.',
          result: rowsTable(['id', 'customer', 'amount'], rows, rows.length + ' row(s) · version ' + v), hl: snap.map(function (x) { return x.path; }) };
      } },
    { id: 'optimize', label: 'OPTIMIZE', ok: function (e) { return e.created; },
      sql: function () { return 'OPTIMIZE ' + TABLE; },
      py: function () { return 'from delta.tables import DeltaTable\n\nDeltaTable.forName(spark, "' + TABLE + '").optimize().executeCompaction()'; },
      quiz: function (e) {
        var n = e.live.length;
        return { id: 'sim-optimize', q: 'The current version has <b>' + n + '</b> data file(s)' + (e.live.some(function (x) { return x.dv; }) ? ' (some with deletion vectors)' : '') + '. After OPTIMIZE, how many data files will the <b>current version</b> use?',
          options: ['The same number, OPTIMIZE only sorts them', 'One bigger file', 'Zero: OPTIMIZE deletes the data and keeps only the log', 'Twice as many'],
          correct: n > 1 || e.live.some(function (x) { return x.dv; }) ? 1 : 0, why: 'OPTIMIZE bin-packs small files into bigger ones (here: one) and applies the deletion vectors. The old files are only <b>removed</b> in the log, they stay on disk until VACUUM.' };
      },
      run: function (e) {
        var needs = e.live.length > 1 || e.live.some(function (x) { return x.dv; });
        if (!needs) return { title: 'Nothing to compact', html: 'There is at most one file and no deletion vector, so OPTIMIZE has nothing to do and <b>does not create a new version</b>.', result: rowsTable(['path', 'metrics'], [[BUCKET + '/' + TABLE_DIR, 'numFilesAdded: 0, numFilesRemoved: 0']]) };
        e.tick();
        var rows = e.liveRows(), actions = [], removed = e.live.length;
        e.live.forEach(function (en) { actions.push(e.removeAction(en, false)); e.file(en.path).removedIn = e.v + 1; });
        e.live = [];
        var f = rows.length ? e.writeParquet(rows) : null;
        if (f) { e.live.push({ path: f.path, dv: null }); actions.push(e.addAction(f, false)); }
        e.commit('OPTIMIZE', { predicate: '[]', auto: false, zOrderBy: '[]' }, actions, { numRemovedFiles: String(removed), numAddedFiles: f ? '1' : '0', numDeletionVectorsRemoved: String(actions.filter(function (a) { return a.remove && a.remove.deletionVector; }).length) });
        return { title: 'Compacted: ' + removed + ' file(s) → ' + (f ? 1 : 0), html: 'All live rows (deletion vectors applied) were rewritten into one file. The commit has <span class="mono">dataChange: false</span>: the data is the same, only the layout changed, so streaming readers ignore it. The old files are <b>removed</b>, not deleted.', open: f ? f.path : null };
      } },
    { id: 'vacuum', label: 'VACUUM', ok: function (e) { return e.created; },
      sql: function () { return '-- simulator only: a real table keeps removed files for 7 days by default\nVACUUM ' + TABLE + ' RETAIN 0 HOURS'; },
      py: function () { return 'from delta.tables import DeltaTable\n\n# simulator only: real tables keep removed files for 7 days by default\nDeltaTable.forName(spark, "' + TABLE + '").vacuum(0)'; },
      quiz: function (e) {
        return { id: 'sim-vacuum', q: 'After <span class="mono">VACUUM … RETAIN 0 HOURS</span>, can you still read <span class="mono">VERSION AS OF 1</span>?',
          options: ['Yes, the log still has version 1', 'No: the data files only version 1 used are physically deleted', 'Yes, VACUUM never deletes Parquet files', 'Only from Python, not from SQL'],
          correct: e.files.some(function (f) { return f.type !== 'json' && f.type !== 'checkpoint' && !f.deleted && e.status(f) === 'removed'; }) ? 1 : 0,
          why: 'VACUUM deletes data files that the current version does not use and that are older than the retention period. The log keeps the history, but the files are gone, so those versions cannot be read any more.' };
      },
      run: function (e) {
        var gone = e.files.filter(function (f) { return !f.deleted && (((f.type === 'parquet' || f.type === 'dv') && e.status(f) === 'removed') || f.type === 'cdc'); });
        e.tick();
        e.commit('VACUUM START', { retentionCheckEnabled: false, defaultRetentionMillis: 604800000, specifiedRetentionMillis: 0 }, [], { numFilesToDelete: String(gone.length) });
        gone.forEach(function (f) { f.deleted = true; f.deletedIn = e.v; });
        e.commit('VACUUM END', { status: 'COMPLETED' }, [], { numDeletedFiles: String(gone.length), numVacuumedDirectories: '1' });
        return { title: gone.length ? gone.length + ' file(s) physically deleted' : 'Nothing to delete', html: gone.length ? 'Only files that the current version does not use were deleted. The JSON log is untouched, but older versions that needed those files can no longer be read. Try <b>VERSION AS OF</b> an old version.'
          : 'Every file in the folder is still used by the current version.', links: gone.length ? [] : [] };
      } },
    { id: 'changes', label: 'table_changes', ok: function (e) { return e.created; },
      params: { v: function (e) { var a = []; if (e.cdfFrom == null) return [0]; for (var i = e.cdfFrom; i <= e.v; i++) a.push(i); return a; } },
      sql: function () { return 'SELECT * FROM table_changes(\'' + TABLE + '\', {{v}})\nORDER BY _commit_version'; },
      py: function () { return 'display(spark.read\n   .option("readChangeFeed", "true")\n   .option("startingVersion", {{v}})\n   .table("' + TABLE + '"))'; },
      run: function (e, p) {
        if (e.cdfFrom == null) return { error: 'Change data feed is not enabled on ' + TABLE + '.',
          title: 'No change data feed yet', html: 'Turn it on first: run <b>CDF on / off</b> (or switch it on before CREATE TABLE). Then change some rows and come back.' };
        var start = +p.v, rows = [], err = null;
        for (var v = start; v <= e.v; v++) {
          var acts = e.commits[v] || [], cdcs = acts.filter(function (a) { return a.cdc; });
          var h = e.history.find(function (x) { return x.version === v; }), ts = h ? new Date(h.timestamp).toISOString().slice(0, 16).replace('T', ' ') : '';
          if (cdcs.length) cdcs.forEach(function (a) {
            var f = e.file(a.cdc.path.replace('_change_data/', ''));
            if (f.deleted) err = a.cdc.path + ' (version ' + v + ') was deleted by VACUUM.';
            else f.rows.forEach(function (r) { rows.push([r[0], r[1], r[2], r[3], v, ts]); });
          });
          else acts.forEach(function (a) {   // inserts need no change file: they come straight from the add actions
            if (a.add && a.add.dataChange && !a.add.deletionVector) e.file(a.add.path).rows.forEach(function (r) { rows.push([r[0], r[1], r[2], 'insert', v, ts]); });
          });
        }
        if (err) return { error: err, title: 'That change data is gone', html: 'VACUUM also cleans up old files in <span class="mono">_change_data/</span>, so the feed only goes back as far as the retention period.' };
        return { title: 'What changed, row by row', html: 'Every row has a <b>_change_type</b>: <b>insert</b>, <b>delete</b>, <b>update_preimage</b> (the row before the UPDATE) or <b>update_postimage</b> (the row after it). ' +
          'Inserts are read from the normal data files; deletes and updates come from <span class="mono">_change_data/</span>. OPTIMIZE never shows up: it moves data, it does not change it.',
          result: rowsTable(['id', 'customer', 'amount', '_change_type', '_commit_version', '_commit_timestamp'], rows, rows.length + ' change(s) since version ' + start) };
      } },
    { id: 'cdf', label: 'CDF on / off', ok: function (e) { return e.created; },
      sql: function (p, e) { return 'ALTER TABLE ' + TABLE + '\nSET TBLPROPERTIES (\'delta.enableChangeDataFeed\' = ' + (!e.cdfOn) + ')'; },
      py: function (p, e) { return 'spark.sql(\n  "ALTER TABLE ' + TABLE + ' "\n  "SET TBLPROPERTIES (\'delta.enableChangeDataFeed\' = ' + (!e.cdfOn) + ')")'; },
      run: function (e) {
        e.tick(); e.cdfOn = !e.cdfOn;
        var meta = e.files.filter(function (f) { return f.type === 'json' && f.lines && f.lines.some(function (l) { return l.metaData; }); }).pop().lines.filter(function (l) { return l.metaData; })[0];
        var m2 = JSON.parse(JSON.stringify(meta)); m2.metaData.configuration['delta.enableChangeDataFeed'] = String(e.cdfOn);
        e.commit('SET TBLPROPERTIES', { properties: JSON.stringify({ 'delta.enableChangeDataFeed': String(e.cdfOn) }) }, [m2]);
        if (e.cdfOn && e.cdfFrom == null) e.cdfFrom = e.v;
        return { title: 'Change data feed is ' + (e.cdfOn ? 'ON' : 'OFF'), html: e.cdfOn ? 'From now on DELETE, UPDATE and MERGE also write the changed rows into a new folder, <span class="mono">_change_data/</span>. Try an <b>UPDATE</b>, open the new file, then run <b>table_changes</b>.'
          : 'New changes are no longer written to <span class="mono">_change_data/</span>.' };
      } },
    { id: 'alter', label: 'DV on / off', ok: function (e) { return e.created; },
      sql: function (p, e) { return 'ALTER TABLE ' + TABLE + '\nSET TBLPROPERTIES (\'delta.enableDeletionVectors\' = ' + (!e.dvOn) + ')'; },
      py: function (p, e) { return 'spark.sql("""\n  ALTER TABLE ' + TABLE + '\n  SET TBLPROPERTIES (\'delta.enableDeletionVectors\' = ' + (!e.dvOn) + ')\n""")'; },
      run: function (e) {
        e.tick(); e.dvOn = !e.dvOn;
        var meta = e.files.filter(function (f) { return f.type === 'json' && f.lines && f.lines.some(function (l) { return l.metaData; }); }).pop().lines.filter(function (l) { return l.metaData; })[0];
        var m2 = JSON.parse(JSON.stringify(meta)); m2.metaData.configuration['delta.enableDeletionVectors'] = String(e.dvOn);
        var acts = [m2];
        if (e.dvOn) acts.unshift({ protocol: { minReaderVersion: 3, minWriterVersion: 7, readerFeatures: ['deletionVectors'], writerFeatures: ['deletionVectors'] } });
        e.commit('SET TBLPROPERTIES', { properties: JSON.stringify({ 'delta.enableDeletionVectors': String(e.dvOn) }) }, acts);
        return { title: 'Deletion vectors are now ' + (e.dvOn ? 'ON' : 'OFF'), html: 'Changing a table property is a commit too: a new <b>metaData</b> action with the new configuration. Run a DELETE and compare what gets written.' };
      } }
  ];

  // ------------------------------------------------------------------ syntax highlighting with param selects
  function highlight(code, lang, params, eng, values) {
    var out = esc(code);
    out = out.replace(/(&quot;|"|')((?:\\.|(?!\1).)*?)\1/g, function (m) { return '<span class="st">' + m + '</span>'; });
    if (lang === 'sql') {
      out = out.replace(/(^|\n)(--[^\n]*)/g, '$1<span class="cm">$2</span>');
      out = out.replace(/\b(CREATE|TABLE|INSERT|INTO|VALUES|SELECT|FROM|WHERE|DELETE|UPDATE|SET|ORDER|BY|DESCRIBE|HISTORY|VERSION|AS|OF|OPTIMIZE|VACUUM|RETAIN|HOURS|ALTER|TBLPROPERTIES|INT|STRING|DOUBLE|true|false)\b/g, '<span class="kw">$1</span>');
    } else {
      out = out.replace(/(^|\n)(#[^\n]*)/g, '$1<span class="cm">$2</span>');
      out = out.replace(/\b(from|import|display|spark|def|return)\b/g, '<span class="kw">$1</span>');
    }
    out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="nu">$1</span>');
    out = out.replace(/\{\{(\w+)\}\}/g, function (m, k) {
      var opts = params && params[k] ? params[k](eng) : [];
      if (!(k in values) || opts.indexOf(+values[k]) < 0) values[k] = opts[0];
      return '<select data-p="' + k + '">' + opts.map(function (o) { return '<option' + (+values[k] === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
    });
    return out;
  }

  // ------------------------------------------------------------------ file viewer (global modal)
  var viewer = null;
  function ensureViewer() {
    if (viewer) return viewer;
    viewer = document.createElement('div');
    viewer.id = 'fview';
    viewer.innerHTML = '<div class="fv"><div class="fvh"><span class="fvp"></span><button class="fvx" title="Close (Esc)">✕</button></div><div class="fvt"></div><div class="fvb"></div></div>';
    document.body.appendChild(viewer);
    viewer.querySelector('.fvx').onclick = closeViewer;
    viewer.addEventListener('click', function (e) { if (e.target === viewer) closeViewer(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && viewer.classList.contains('on')) { e.stopImmediatePropagation(); closeViewer(); } }, true);
    return viewer;
  }
  function closeViewer() { if (viewer) viewer.classList.remove('on'); }
  function jsonPretty(obj) {
    var s = esc(JSON.stringify(obj, null, 2));
    return s.replace(/&quot;(\w+)&quot;:/g, '<span class="k">"$1"</span>:').replace(/: &quot;([^\n]*?)&quot;/g, ': <span class="s">"$1"</span>');
  }
  function openFile(eng, f, base) {
    var v = ensureViewer(), st = eng ? eng.status(f) : 'static';
    v.querySelector('.fvp').innerHTML = '<span class="crumb">' + esc(base || (BUCKET + '/' + TABLE_DIR)) + '/' + (f.dir ? f.dir + '/' : '') + '</span><b>' + esc(f.path) + '</b>';
    var tabs = [], banner = '';
    if (st === 'deleted') banner = '<div class="banner warn">🗑️ This file was physically deleted by VACUUM (version ' + f.deletedIn + '). Opening it in the bucket would give <b>404 Not Found</b>. You see its last contents here only because this is a simulation.</div>';
    else if (st === 'removed') banner = '<div class="banner warn">🪦 Not part of the current version: removed in version ' + (f.removedIn != null ? f.removedIn : '?') + '. It is still on disk, so time travel to older versions works, until VACUUM deletes it.</div>';
    else if (st === 'live') banner = '<div class="banner ok">✅ Part of the current version (' + eng.v + ').</div>';
    if (f.type === 'json') {
      tabs.push(['Actions', function () {
        return banner + '<div class="banner info">One commit = one JSON file. Each line is one <b>action</b>. Version ' + f.version + '.</div>' +
          f.lines.map(function (l) { var k = Object.keys(l)[0]; return '<div class="act"><div class="an act-' + k + '">' + k + '</div><pre class="json">' + jsonPretty(l[k]) + '</pre></div>'; }).join('');
      }]);
      tabs.push(['Raw file', function () { return '<div class="banner info">This is exactly what is in the object: newline-delimited JSON, one action per line.</div><pre class="json raw">' + esc(f.lines.map(function (l) { return JSON.stringify(l); }).join('\n')) + '</pre>'; }]);
    } else if (f.type === 'parquet') {
      var en = eng ? eng.live.find(function (x) { return x.path === f.path; }) : null, del = en && en.dv ? eng.file(en.dv).positions : [];
      tabs.push(['Rows', function () {
        return banner + (del.length ? '<div class="banner info">🧷 A deletion vector hides row position(s) ' + del.join(', ') + ' of this file. The bytes are still in the file.</div>' : '') +
          '<table class="dt"><tr><th>#</th><th>id <small>INT</small></th><th>customer <small>STRING</small></th><th>amount <small>DOUBLE</small></th></tr>' +
          f.rows.map(function (r, i) { return '<tr class="' + (del.indexOf(i) >= 0 ? 'strike' : '') + '"><td class="pos">' + i + '</td><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[2].toFixed(1) + '</td></tr>'; }).join('') + '</table>';
      }]);
      tabs.push(['Inside the file', function () {
        var s = eng ? eng.stats(f.rows) : { minValues: {}, maxValues: {} };
        function chunk(c) { return '<div class="chunk"><b>' + c + '</b><span>encoded + compressed values · min <b>' + esc(s.minValues[c]) + '</b> · max <b>' + esc(s.maxValues[c]) + '</b></span></div>'; }
        return '<div class="banner info">A Parquet file stores the rows <b>column by column</b>. Small files have one row group; big ones have many (often ~128 MB each).</div><div class="pq">' +
          '<div class="blk magic">PAR1 <small>(4-byte magic number)</small></div><div class="blk rg"><b>Row group 0</b> · ' + f.rows.length + ' rows' + chunk('id') + chunk('customer') + chunk('amount') + '</div>' +
          '<div class="blk footer"><b>Footer</b>: schema (id INT, customer STRING, amount DOUBLE), row group offsets, min/max statistics per column chunk, codec = SNAPPY</div>' +
          '<div class="blk magic">PAR1</div></div><p style="font-size:14px;color:#666">' + fmtSize(f.size) + ' · the file name ends with <span class="mono">.snappy.parquet</span> because the pages are Snappy-compressed.</p>';
      }]);
    } else if (f.type === 'dv') {
      var target = eng.file(f.target);
      tabs.push(['Deletion vector', function () {
        var bits = '';
        for (var i = 0; i < target.rows.length; i++) bits += '<span class="' + (f.positions.indexOf(i) >= 0 ? 'x' : '') + '" title="row ' + i + '">' + i + '</span>';
        return banner + '<div class="banner info">📂 <b>' + f.dir + '/</b> appeared in the table folder when the first row was deleted. It holds the <b>deletion vectors</b>: small files that say which rows of a Parquet file are deleted. ' +
          'The Parquet file itself is not changed. The folder name is just a short random name; the log points to the file.</div>' +
          '<p>It belongs to: <span class="mono">' + esc(f.target) + '</span> · ' + fmtSize(f.size) + '</p><div class="bits">' + bits + '</div><p>Red = deleted rows (by position in that file): <b>' + f.positions.join(', ') + '</b></p>' +
          '<table class="dt"><tr><th>#</th><th>id</th><th>customer</th><th>amount</th></tr>' + target.rows.map(function (r, i) { return '<tr class="' + (f.positions.indexOf(i) >= 0 ? 'strike' : '') + '"><td class="pos">' + i + '</td><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[2].toFixed(1) + '</td></tr>'; }).join('') + '</table>';
      }]);
    } else if (f.type === 'cdc') {
      tabs.push(['Changed rows', function () {
        var colr = { 'delete': '#c5221f', 'update_preimage': '#b06000', 'update_postimage': '#137333', 'insert': '#1a56c4' };
        return (st === 'deleted' ? banner : '') + '<div class="banner info">🔁 <b>_change_data/</b> appears when change data feed is on. Each file holds the rows that one DELETE, UPDATE or MERGE changed, ' +
          'with an extra column <b>_change_type</b>. An UPDATE gives two rows: the <b>pre-image</b> (before) and the <b>post-image</b> (after). Version ' + f.version + '.</div>' +
          '<table class="dt"><tr><th>id</th><th>customer</th><th>amount</th><th>_change_type</th></tr>' +
          f.rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[2].toFixed(1) + '</td><td><b style="color:' + (colr[r[3]] || '#333') + '">' + r[3] + '</b></td></tr>'; }).join('') + '</table>' +
          '<p style="font-size:13.5px;color:#555">Read it with <span class="mono">SELECT * FROM table_changes(\'' + TABLE + '\', ' + f.version + ')</span>, not by opening these files: inserts are not in here, they come from the normal data files.</p>';
      }]);
    } else if (f.type === 'checkpoint') {
      tabs.push(['Checkpoint', function () {
        return '<div class="banner info">Every 10 commits Delta writes a <b>checkpoint</b>: the whole table state up to that version in one Parquet file. Readers start from the latest checkpoint instead of replaying every JSON file. <span class="mono">_last_checkpoint</span> points at it.</div>' +
          '<p>Version ' + f.summary.version + ' · live files:</p><ul class="mono" style="font-size:13px">' + f.summary.liveFiles.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>';
      }]);
    } else {
      tabs.push(['Preview', function () { return f.html || '<pre class="json raw">' + esc(f.text || '') + '</pre>'; }]);
    }
    var t = v.querySelector('.fvt'), b = v.querySelector('.fvb');
    t.innerHTML = tabs.length > 1 ? tabs.map(function (x, i) { return '<button data-i="' + i + '" class="' + (i ? '' : 'on') + '">' + x[0] + '</button>'; }).join('') : '';
    t.querySelectorAll('button').forEach(function (bt) { bt.onclick = function () { t.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); bt.classList.add('on'); b.innerHTML = tabs[+bt.dataset.i][1](); }; });
    b.innerHTML = tabs[0][1]();
    v.classList.add('on');
  }

  // ------------------------------------------------------------------ explorer (realistic file browser)
  function explorerRows(eng, opts) {
    opts = opts || {};
    var logs = eng.files.filter(function (f) { return f.dir === '_delta_log'; }).sort(function (a, b) { return a.path < b.path ? -1 : 1; });
    var data = eng.files.filter(function (f) { return f.dir === '' && !(opts.hideDeleted && f.deleted); });
    var dvs = eng.files.filter(function (f) { return f.type === 'dv'; }), cdcs = eng.files.filter(function (f) { return f.type === 'cdc'; });
    function row(f, indent) {
      var st = eng.status(f), icon = f.type === 'json' ? '📄' : f.type === 'dv' ? '🧷' : f.type === 'checkpoint' ? '🗜️' : f.type === 'cdc' ? '🔁' : '📦';
      var chip = st === 'cdc' ? '<span class="chip cdc">v' + f.version + '</span>' : st === 'live' ? '<span class="chip live">v' + eng.v + '</span>' : st === 'removed' ? '<span class="chip rm">removed v' + f.removedIn + '</span>' : st === 'deleted' ? '<span class="chip del">deleted</span>' : '<span class="chip log">v' + f.version + '</span>';
      var cls = (st === 'deleted' ? 'gone ' : '') + (st === 'removed' ? 'old ' : '') + (opts.fresh && opts.fresh.indexOf(f.path) >= 0 ? 'fresh ' : '') + (opts.hl && opts.hl.indexOf(f.path) >= 0 ? 'hl ' : '');
      return '<div class="xr ' + cls + '" data-p="' + esc(f.path) + '" style="padding-left:' + (10 + indent * 20) + 'px"><span class="xi">' + icon + '</span><span class="xn">' + esc(f.path) + '</span>' +
        chip + '<span class="xs">' + (st === 'deleted' ? '—' : fmtSize(f.size)) + '</span><span class="xt">' + new Date(f.at).toISOString().slice(11, 16) + '</span></div>';
    }
    var open = opts.logOpen !== false;
    return '<div class="xr dir" data-dir="_delta_log" style="padding-left:10px"><span class="xi">' + (open ? '📂' : '📁') + '</span><span class="xn">_delta_log/</span><span class="chip log">' + logs.length + ' objects</span><span class="xs"></span><span class="xt"></span></div>' +
      (open ? logs.map(function (f) { return row(f, 1); }).join('') : '') +
      (dvs.length ? '<div class="xr dir" style="padding-left:10px;cursor:default"><span class="xi">📂</span><span class="xn">' + eng.dvDir + '/</span><span class="chip dvc">deletion vectors</span><span class="xs"></span><span class="xt"></span></div>' +
        dvs.map(function (f) { return row(f, 1); }).join('') : '') +
      (cdcs.length ? '<div class="xr dir" style="padding-left:10px;cursor:default"><span class="xi">📂</span><span class="xn">_change_data/</span><span class="chip cdc">change data feed</span><span class="xs"></span><span class="xt"></span></div>' +
        cdcs.map(function (f) { return row(f, 1); }).join('') : '') +
      data.filter(function (f) { return f.type !== 'dv'; }).map(function (f) { return row(f, 0); }).join('') +
      (!eng.files.length ? '<div class="xempty">(empty: run CREATE TABLE)</div>' : '');
  }
  function explorerHtml(eng, opts) {
    return '<div class="xp"><div class="xbar"><span class="xcrumb">🪣 ' + BUCKET.replace('s3://', '') + ' <i>›</i> sales <i>›</i> <b>orders</b></span>' +
      '<span class="xtbl">🔺 Delta table <span class="mono">' + TABLE + '</span></span></div>' +
      '<div class="xhead"><span></span><span>Name</span><span></span><span>Size</span><span>Modified</span></div><div class="xbody">' + explorerRows(eng, opts) + '</div>' +
      '<div class="xleg"><span><i style="background:#16a34a"></i>in the current version</span><span><i style="background:#9ca3af"></i>removed (kept for time travel)</span><span><i style="background:#dc2626"></i>deleted by VACUUM</span></div></div>';
  }
  function wireExplorer(root, eng, rerender) {
    root.querySelectorAll('.xr[data-p]').forEach(function (r) { r.onclick = function () { openFile(eng, eng.file(r.dataset.p)); }; });
    root.querySelectorAll('.xr.dir').forEach(function (r) { r.onclick = function () { rerender && rerender('toggle'); }; });
  }

  // ------------------------------------------------------------------ simulator UI
  var mainEng = new Engine(), ui = { lang: 'sql', cmd: 'create', values: {}, asked: {}, logOpen: true, fresh: [], hl: [], last: null };
  function mount(el, api) {
    el.innerHTML = '<div class="sim">' +
      '<div class="left"><div class="cmds" id="cmds"></div>' +
      '<div class="cell"><div class="ch">notebook cell<span class="lang"><button data-l="sql">SQL</button><button data-l="py">Python</button></span></div><pre id="code"></pre>' +
      '<div class="run"><button class="btn acc" id="run">▶ Run</button><label class="toggle" title="delta.enableDeletionVectors"><input type="checkbox" id="dvT"><span class="sw"></span>deletion vectors</label><label class="toggle" title="delta.enableChangeDataFeed"><input type="checkbox" id="cdfT"><span class="sw"></span>change data feed</label><span class="stat" id="stat">simulated · nothing really runs</span></div></div>' +
      '<div class="narr sk thin" id="narr"><h5>Start here</h5>Pick <b>CREATE TABLE</b> and press <b>Run</b>. Then insert rows, delete one, optimize, vacuum, and travel in time. Click any file on the right to open it.</div>' +
      '<div class="result" id="result" style="display:none"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="simReset">↺ Start over</button><label class="toggle"><input type="checkbox" id="askT" checked><span class="sw"></span>ask me before key steps</label></div></div>' +
      '<div class="right"><div id="xplore"></div><div class="tblnow"><div class="tbh">Table <span class="mono">' + TABLE + '</span> · <b id="verb">no version yet</b></div><div id="tnow"></div></div></div></div>';
    var $ = function (s) { return el.querySelector(s); };
    function draw() {
      $('#cmds').innerHTML = CMDS.map(function (c) { return '<button data-c="' + c.id + '" class="' + (c.id === ui.cmd ? 'on' : '') + '"' + (c.ok(mainEng) ? '' : ' disabled') + '>' + c.label + '</button>'; }).join('');
      el.querySelectorAll('#cmds button').forEach(function (b) { b.onclick = function () { ui.cmd = b.dataset.c; draw(); }; });
      var c = CMDS.find(function (x) { return x.id === ui.cmd; });
      if (!c.ok(mainEng)) { c = CMDS.find(function (x) { return x.ok(mainEng); }) || CMDS[0]; ui.cmd = c.id; el.querySelectorAll('#cmds button').forEach(function (b) { b.classList.toggle('on', b.dataset.c === c.id); }); }
      $('#code').innerHTML = highlight(c[ui.lang](ui.values, mainEng), ui.lang, c.params, mainEng, ui.values);
      el.querySelectorAll('#code select').forEach(function (s) { s.onchange = function () { ui.values[s.dataset.p] = s.value; }; });
      el.querySelectorAll('.lang button').forEach(function (b) { b.classList.toggle('on', b.dataset.l === ui.lang); b.onclick = function () { ui.lang = b.dataset.l; draw(); }; });
      $('#dvT').checked = mainEng.dvOn; $('#dvT').disabled = mainEng.created;
      $('#cdfT').checked = mainEng.cdfOn; $('#cdfT').disabled = mainEng.created;
      $('#cdfT').parentNode.title = mainEng.created ? 'Use the “CDF on / off” command (ALTER TABLE) once the table exists' : 'delta.enableChangeDataFeed for the new table';
      $('#dvT').parentNode.title = mainEng.created ? 'Use the “DV on / off” command (ALTER TABLE) once the table exists' : 'delta.enableDeletionVectors for the new table';
      $('#run').disabled = !c.ok(mainEng);
      $('#xplore').innerHTML = explorerHtml(mainEng, { logOpen: ui.logOpen, fresh: ui.fresh, hl: ui.hl });
      wireExplorer($('#xplore'), mainEng, function () { ui.logOpen = !ui.logOpen; ui.fresh = []; draw(); });
      $('#verb').textContent = mainEng.v >= 0 ? 'version ' + mainEng.v : 'no version yet';
      var rows = mainEng.v >= 0 ? mainEng.liveRows() : [];
      $('#tnow').innerHTML = mainEng.v < 0 ? '<div class="xempty">The table does not exist yet.</div>' : rows.length ?
        '<table class="dt"><tr><th>id</th><th>customer</th><th>amount</th></tr>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[2].toFixed(1) + '</td></tr>'; }).join('') + '</table>' : '<div class="xempty">0 rows</div>';
    }
    $('#dvT').onchange = function () { if (!mainEng.created) { mainEng.dvOn = $('#dvT').checked; draw(); } };
    $('#cdfT').onchange = function () { if (!mainEng.created) { mainEng.cdfOn = $('#cdfT').checked; draw(); } };
    $('#simReset').onclick = function () { mainEng.reset(); ui.cmd = 'create'; ui.values = {}; ui.fresh = []; ui.hl = []; $('#result').style.display = 'none';
      $('#narr').innerHTML = '<h5>Start here</h5>Pick <b>CREATE TABLE</b> and press <b>Run</b>.'; draw(); };
    $('#run').onclick = function () {
      var c = CMDS.find(function (x) { return x.id === ui.cmd; });
      var params = {}; el.querySelectorAll('#code select').forEach(function (s) { params[s.dataset.p] = s.value; });
      var go = function () {
        var before = mainEng.files.map(function (f) { return f.path; });
        var res = c.run(mainEng, params) || {};
        ui.fresh = mainEng.files.map(function (f) { return f.path; }).filter(function (p) { return before.indexOf(p) < 0; });
        ui.hl = res.hl || [];
        $('#stat').textContent = res.error ? 'error' : 'ran in 0.' + (3 + mainEng.seq % 6) + ' s (simulated)';
        $('#narr').innerHTML = '<h5>' + (res.error && !res.title ? 'Error' : (res.title || 'Done')) + '</h5>' + (res.html || '') +
          (res.links && res.links.length ? '<div class="links">' + res.links.map(function (l) { return '<button data-s="' + l[0] + '">' + l[1] + '</button>'; }).join('') + '</div>' : '');
        el.querySelectorAll('#narr .links button').forEach(function (b) { b.onclick = function () { api.open(b.dataset.s); }; });
        var r = $('#result');
        if (res.error) { r.style.display = ''; r.innerHTML = '<div class="err">❌ ' + esc(res.error) + '</div>'; }
        else if (res.result) {
          r.style.display = '';
          r.innerHTML = '<table><tr>' + res.result.cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' +
            res.result.rows.map(function (row) { return '<tr>' + row.map(function (x) { return '<td>' + esc(typeof x === 'number' && x % 1 ? x.toFixed(1) : x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' +
            (res.result.cap ? '<div class="cap">' + res.result.cap + '</div>' : '');
        } else r.style.display = 'none';
        // move on to a sensible next command
        var order = ['create', 'insert', 'insert', 'select', 'delete', 'select', 'history', 'optimize', 'travel', 'vacuum', 'travel'];
        if (ui.cmd === 'create') ui.cmd = 'insert';
        draw();
      };
      var askOn = $('#askT').checked;
      if (c.quiz && askOn && !ui.asked[c.id]) { ui.asked[c.id] = true; api.ask(c.quiz(mainEng)).then(go); }
      else go();
    };
    draw();
  }

  // ------------------------------------------------------------------ the bucket explorer that sits on the board
  var demo = null;
  function demoEngine() {
    if (demo) return demo;
    demo = new Engine();
    var byId = function (id) { return CMDS.find(function (c) { return c.id === id; }); };
    demo.cdfOn = true;
    byId('create').run(demo); byId('insert').run(demo); byId('insert').run(demo); byId('delete').run(demo, { id: 2 }); byId('update').run(demo, { id: 4 });
    return demo;
  }
  var BUCKET_TREE = [
    { name: 'hr/', kids: [{ name: 'employees.csv', size: 18234, text: 'employee_id,full_name,department_id,level\n1,Employee 0001,3,Senior\n2,Employee 0002,1,Mid\n3,Employee 0003,5,Junior\n…' }] },
    { name: 'images/', kids: [{ name: 'cats/', kids: [{ name: '0001.jpg', size: 81233, html: '<div style="font-size:120px;text-align:center">🐈</div><p style="text-align:center">An image object: just bytes. Object storage does not care what is inside.</p>' }, { name: '0002.jpg', size: 64110, html: '<div style="font-size:120px;text-align:center">🐈‍⬛</div>' }] }] },
    { name: 'raw/', kids: [{ name: 'clicks/', kids: [{ name: '2026-11-19.json', size: 120443, text: '{"user":17,"page":"/pricing","ts":"2026-11-19T08:01:22Z"}\n{"user":4,"page":"/","ts":"2026-11-19T08:01:25Z"}\n…' },
      { name: '2026-11-20.json', size: 98322, text: '{"user":9,"page":"/docs","ts":"2026-11-20T07:59:02Z"}\n…' }] }] },
    { name: 'sales/', kids: [{ name: 'orders/', delta: true }, { name: 'customers/', note: '🔺 another Delta table (main.sales.customers)', kids: [{ name: '_delta_log/', kids: [] }] }] }
  ];
  function boardExplorer(el, api) {
    var eng = demoEngine(), openDirs = { 'sales/': true, 'sales/orders/': true }, sel = null;
    function render() {
      var html = '<div class="xp board"><div class="xbar"><span class="xcrumb">🪣 <b>acme-lakehouse-prod</b> <small>· Amazon S3 · eu-central-1</small></span></div>' +
        '<div class="xhead"><span></span><span>Name</span><span></span><span>Size</span><span>Type</span></div><div class="xbody">';
      function walk(nodes, depth, prefix) {
        nodes.forEach(function (n) {
          var key = prefix + n.name, pl = 10 + depth * 18;
          if (n.delta) {
            var op = openDirs[key];
            html += '<div class="xr dir delta" data-d="' + key + '" style="padding-left:' + pl + 'px"><span class="xi">' + (op ? '📂' : '📁') + '</span><span class="xn">' + n.name + '</span><span class="chip live">🔺 Delta table</span><span class="xs"></span><span class="xt">folder</span></div>';
            if (op) {
              var logs = eng.files.filter(function (f) { return f.dir === '_delta_log'; }), data = eng.files.filter(function (f) { return f.dir === ''; }), dvs = eng.files.filter(function (f) { return f.type === 'dv'; });
              var lk = key + '_delta_log/', lo = openDirs[lk] !== false;
              html += '<div class="xr dir" data-d="' + lk + '" data-def="1" style="padding-left:' + (pl + 18) + 'px"><span class="xi">' + (lo ? '📂' : '📁') + '</span><span class="xn">_delta_log/</span><span class="chip log">transaction log</span><span class="xs"></span><span class="xt">folder</span></div>';
              if (lo) logs.forEach(function (f) { html += '<div class="xr" data-p="' + f.path + '" style="padding-left:' + (pl + 36) + 'px"><span class="xi">📄</span><span class="xn">' + f.path + '</span><span class="chip log">v' + f.version + '</span><span class="xs">' + fmtSize(f.size) + '</span><span class="xt">JSON</span></div>'; });
              var cds = eng.files.filter(function (f) { return f.type === 'cdc'; });
              if (cds.length) {
                html += '<div class="xr dir" style="padding-left:' + (pl + 18) + 'px;cursor:default"><span class="xi">📂</span><span class="xn">_change_data/</span><span class="chip cdc">change data feed</span><span class="xs"></span><span class="xt">folder</span></div>';
                cds.forEach(function (f) { html += '<div class="xr" data-p="' + f.path + '" style="padding-left:' + (pl + 36) + 'px"><span class="xi">🔁</span><span class="xn">' + f.path + '</span><span class="chip cdc">v' + f.version + '</span><span class="xs">' + fmtSize(f.size) + '</span><span class="xt">Parquet</span></div>'; });
              }
              if (dvs.length) {
                html += '<div class="xr dir" style="padding-left:' + (pl + 18) + 'px;cursor:default"><span class="xi">📂</span><span class="xn">' + eng.dvDir + '/</span><span class="chip dvc">deletion vectors</span><span class="xs"></span><span class="xt">folder</span></div>';
                dvs.forEach(function (f) { html += '<div class="xr" data-p="' + f.path + '" style="padding-left:' + (pl + 36) + 'px"><span class="xi">🧷</span><span class="xn">' + f.path + '</span><span class="chip live">current</span><span class="xs">' + fmtSize(f.size) + '</span><span class="xt">DV</span></div>'; });
              }
              data.forEach(function (f) {
                var st = eng.status(f);
                html += '<div class="xr ' + (st === 'removed' ? 'old' : '') + '" data-p="' + f.path + '" style="padding-left:' + (pl + 18) + 'px"><span class="xi">' + (f.type === 'dv' ? '🧷' : '📦') + '</span><span class="xn">' + f.path + '</span>' +
                  (st === 'removed' ? '<span class="chip rm">removed</span>' : '<span class="chip live">current</span>') + '<span class="xs">' + fmtSize(f.size) + '</span><span class="xt">' + (f.type === 'dv' ? 'DV' : 'Parquet') + '</span></div>';
              });
            }
            return;
          }
          if (n.kids) {
            var o = !!openDirs[key];
            html += '<div class="xr dir" data-d="' + key + '" style="padding-left:' + pl + 'px"><span class="xi">' + (o ? '📂' : '📁') + '</span><span class="xn">' + n.name + '</span>' + (n.note ? '<span class="chip log">' + n.note + '</span>' : '<span></span>') + '<span class="xs"></span><span class="xt">folder</span></div>';
            if (o) walk(n.kids, depth + 1, key);
          } else {
            html += '<div class="xr" data-s="' + key + '" style="padding-left:' + pl + 'px"><span class="xi">' + (/\.jpg$/.test(n.name) ? '🖼️' : '📄') + '</span><span class="xn">' + n.name + '</span><span></span><span class="xs">' + fmtSize(n.size) + '</span><span class="xt">' + n.name.split('.').pop().toUpperCase() + '</span></div>';
          }
        });
      }
      walk(BUCKET_TREE, 0, '');
      html += '</div><div class="xfoot">👆 Folders open, files open in a viewer. <b>sales/orders/</b> is a Delta table: Parquet files + <b>_delta_log</b>.</div></div>';
      el.innerHTML = html;
      el.querySelectorAll('.xr.dir').forEach(function (r) {
        r.onclick = function (e) { e.stopPropagation(); var k = r.dataset.d; openDirs[k] = r.dataset.def ? openDirs[k] === false : !openDirs[k]; render(); };
      });
      el.querySelectorAll('.xr[data-p]').forEach(function (r) { r.onclick = function (e) { e.stopPropagation(); openFile(eng, eng.file(r.dataset.p)); }; });
      el.querySelectorAll('.xr[data-s]').forEach(function (r) {
        r.onclick = function (e) {
          e.stopPropagation();
          var path = r.dataset.s, parts = path.split('/'), node = { kids: BUCKET_TREE };
          parts.forEach(function (p, i) { var name = i < parts.length - 1 ? p + '/' : p; node = (node.kids || []).find(function (k) { return k.name === name; }) || node; });
          openFile(null, { path: parts[parts.length - 1], dir: '', type: 'static', text: node.text, html: node.html }, BUCKET + '/' + parts.slice(0, -1).join('/'));
        };
      });
    }
    render();
  }

  function runCmd(eng, id, params) { return CMDS.find(function (c) { return c.id === id; }).run(eng, params || {}); }
  window.DeltaSim = { mount: mount, reset: function () { mainEng.reset(); ui.asked = {}; ui.cmd = 'create'; }, boardExplorer: boardExplorer, Engine: Engine, openFile: openFile,
    explorerHtml: explorerHtml, wireExplorer: wireExplorer, run: runCmd };
})();
