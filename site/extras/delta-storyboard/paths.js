/* Storage path decoder: paste a cloud storage path from Databricks (a table location, a volume
   storage location, a file inside them), get every layer explained, and walk a simulated bucket
   built around it. Registers itself as window.PathSim; board.js mounts it as scene "paths". */
(function () {
  'use strict';
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var REGIONS = {
    'us-east-1': 'N. Virginia', 'us-east-2': 'Ohio', 'us-west-1': 'N. California', 'us-west-2': 'Oregon', 'ca-central-1': 'Canada (Central)', 'sa-east-1': 'São Paulo',
    'eu-central-1': 'Frankfurt', 'eu-central-2': 'Zurich', 'eu-west-1': 'Ireland', 'eu-west-2': 'London', 'eu-west-3': 'Paris', 'eu-north-1': 'Stockholm', 'eu-south-1': 'Milan',
    'ap-southeast-1': 'Singapore', 'ap-southeast-2': 'Sydney', 'ap-southeast-3': 'Jakarta', 'ap-northeast-1': 'Tokyo', 'ap-northeast-2': 'Seoul', 'ap-northeast-3': 'Osaka', 'ap-south-1': 'Mumbai',
    'me-central-1': 'UAE', 'af-south-1': 'Cape Town'
  };
  var MS = '3358cbba-2a87-4435-9abc-efd3d0abcce7', ROOT = 's3://unity-catalogs-us-west-2/metastore/4552326-root/' + MS;
  var EXAMPLES = [
    ['🧊+📁 table and volume together', ROOT + '/tables/c250bf08-041d-4675-bfe9-2afe5a9c7793\n' + ROOT + '/volumes/c209b69f-8ec7-4acb-bc91-825cce9110b0'],
    ['🧊 managed table', ROOT + '/tables/c250bf08-041d-4675-bfe9-2afe5a9c7793'],
    ['📁 managed volume', ROOT + '/volumes/c209b69f-8ec7-4acb-bc91-825cce9110b0'],
    ['🧾 a commit in _delta_log', ROOT + '/tables/c250bf08-041d-4675-bfe9-2afe5a9c7793/_delta_log/00000000000000000001.json'],
    ['🧷 a deletion vector', ROOT + '/tables/c250bf08-041d-4675-bfe9-2afe5a9c7793/Qx/deletion_vector_7f1c2a9e-0b3d-4c55-9e61-2d8a4f0c1b77.bin'],
    ['📄 a file in the volume', ROOT + '/volumes/c209b69f-8ec7-4acb-bc91-825cce9110b0/raw/orders_2026-11-20.csv'],
    ['📚 catalog with its own location', 's3://acme-uc-us-west-2/finance/__unitystorage/catalogs/9d1e7c42-5b0a-4f3e-8c21-6a7b9e0d4f15/tables/4b8f2e61-7c3d-4a90-b5e2-1f6d8c9a0e73'],
    ['🗂️ schema with its own location', 's3://acme-uc-us-west-2/finance/__unitystorage/schemas/0f3a9b7c-2e41-4d68-a5c9-8e1b6f2d7a04/volumes/6e2d1a9f-3b7c-4e58-9d0a-c4f1b8e3a726'],
    ['🔗 external table', 's3://acme-raw-eu-central-1/clicks/year=2026/month=11/'],
    ['☁️ Azure (ADLS Gen2)', 'abfss://uc-root@acmelakehouse.dfs.core.windows.net/__unitystorage/catalogs/2c7e9a41-8b3d-4f0e-a6d5-91c2e7b4f058/tables/e5a1c9d7-4f2b-4e86-b3a0-7d9c1f6e2b48'],
    ['🗺️ /Volumes path', '/Volumes/main/raw/landing/orders_2026-11-20.csv']
  ];

  // ------------------------------------------------------------------ deterministic ids
  var seed = 7;
  function hex(n) { var s = ''; for (var i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; s += '0123456789abcdef'[(seed >>> 16) % 16]; } return s; }
  function uuid() { return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-' + '89ab'[parseInt(hex(1), 16) % 4] + hex(3) + '-' + hex(12); }
  function pad(n) { n = String(n); while (n.length < 20) n = '0' + n; return n; }
  function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function code(t) { return '<pre class="pcode">' + esc(t) + '</pre>'; }

  // ------------------------------------------------------------------ parsing
  function parse(raw) {
    var s = String(raw || '').trim().replace(/^['"`]+|['"`]+$/g, '');
    if (!s) return { err: 'Paste a path first, or pick one of the examples.' };
    var m, out = { raw: s, parts: [], ctx: {} };
    function add(text, cls, kind, t, what, see) { out.parts.push({ text: text, cls: cls, kind: kind, title: t, what: what, see: see || '' }); }

    if ((m = /^(s3a?n?:\/\/)([^\/]+)(.*)$/i.exec(s))) {
      out.cloud = 'aws'; out.store = m[1] + m[2];
      var region = (/(us|eu|ap|ca|sa|me|af|il|mx)-(north|south|east|west|central|northeast|southeast|northwest|southwest)-\d/.exec(m[2]) || [])[0];
      out.region = region;
      add(m[1], 'c1', 'scheme', 'Scheme: Amazon S3', 'Tells Databricks which storage driver to use. In Databricks you see <code>s3://</code>; open-source Hadoop tools often write <code>s3a://</code>. Same bucket, same objects.', 'Nothing yet: this is the protocol, not a place.');
      add(m[2], 'c2', 'bucket', 'Bucket: ' + m[2],
        'The top-level container in S3. Its name is unique across all of AWS and it lives in exactly one region.' +
        (region ? ' The name contains <b>' + region + '</b>' + (REGIONS[region] ? ' (' + REGIONS[region] + ')' : '') + ': keep Unity Catalog storage in the same region as the metastore and the workspaces, cross-region reads are slow and cost egress.' : '') +
        'In the S3 console: the top-level “folders” (prefixes) of the bucket.');
      rest(m[3]);
    } else if ((m = /^(abfss?:\/\/)([^@\/]+)@([^.\/]+)(\.dfs\.core\.windows\.net)(.*)$/i.exec(s))) {
      out.cloud = 'azure'; out.store = m[1] + m[2] + '@' + m[3] + m[4];
      add(m[1], 'c1', 'scheme', 'Scheme: Azure Data Lake Storage Gen2', 'ABFS = Azure Blob File System driver; the extra “s” means TLS.', 'Nothing yet: this is the protocol.');
      add(m[2], 'c2', 'bucket', 'Container: ' + m[2], 'Plays the role of the S3 bucket: the top-level container inside a storage account.', 'In the Azure portal: the directories of this container.');
      add('@' + m[3], 'c2', 'account', 'Storage account: ' + m[3], 'The Azure storage account that owns the container. Its region is a property of the account (not in the name); keep it in the region of the metastore.', '');
      add(m[4], 'c1', 'endpoint', 'Endpoint', 'The Data Lake Storage (dfs) endpoint of the account. Directories are real here, thanks to the hierarchical namespace.', '');
      rest(m[5]);
    } else if ((m = /^(gs:\/\/)([^\/]+)(.*)$/i.exec(s))) {
      out.cloud = 'gcp'; out.store = m[1] + m[2];
      add(m[1], 'c1', 'scheme', 'Scheme: Google Cloud Storage', 'Tells Databricks to use the GCS driver.', '');
      add(m[2], 'c2', 'bucket', 'Bucket: ' + m[2], 'Top-level container, globally unique name, lives in one region or multi-region.', 'In the GCS console: the top-level folders of the bucket.');
      rest(m[3]);
    } else if ((m = /^(\/Volumes)\/([^\/]+)\/([^\/]+)\/([^\/]+)(.*)$/.exec(s))) {
      out.cloud = 'uc'; out.logical = true;
      add(m[1], 'c1', 'volroot', '/Volumes', 'Not a cloud URL: a <b>Unity Catalog path</b>. Every volume you may read shows up under <code>/Volumes</code>. Unity Catalog checks your permission and maps it to the real bucket path.', '');
      add('/' + m[2], 'c5', 'lcatalog', 'Catalog: ' + m[2], 'The first level of the three-level name.', '');
      add('/' + m[3], 'c5', 'lschema', 'Schema: ' + m[3], 'The second level.', '');
      add('/' + m[4], 'c4', 'lvolume', 'Volume: ' + m[4], 'The volume <code>' + esc(m[2] + '.' + m[3] + '.' + m[4]) + '</code>. Managed volume: its files live in a folder like <code>…/volumes/&lt;volume-id&gt;/</code>. External volume: in the folder you gave at CREATE EXTERNAL VOLUME.', '');
      out.ctx.volName = m[2] + '.' + m[3] + '.' + m[4];
      if (m[5] && m[5] !== '/') add(m[5], 'c6', 'vpath', 'Path inside the volume', 'Exactly the same sub-folders and file names exist in the cloud folder of the volume. Volumes do not rename or convert anything.', '');
    } else if ((m = /^(dbfs:)(\/.*)?$/i.exec(s))) {
      out.cloud = 'dbfs'; out.legacy = true;
      add(m[1], 'c1', 'scheme', 'dbfs: (legacy)', 'The Databricks File System: a workspace-wide virtual file system from before Unity Catalog. No fine-grained permissions. For new work use Unity Catalog tables and <code>/Volumes</code>.', '');
      if (m[2]) add(m[2], 'c3', 'prefix', 'DBFS path', 'A path in DBFS, e.g. the DBFS root or a mount under /mnt.', '');
    } else {
      return { err: 'I did not recognise this path. Try <code>s3://…</code>, <code>abfss://…@….dfs.core.windows.net/…</code>, <code>gs://…</code>, <code>/Volumes/…</code> or <code>dbfs:/…</code>.' };
    }
    out.keys = [];
    return out;

    function rest(p) {
      var segs = (p || '').split('/').filter(Boolean), c = out.ctx;
      c.segs = segs; c.rootEnd = -1;
      segs.forEach(function (sg, i) {
        var prev = segs[i - 1], next = segs[i + 1], last = i === segs.length - 1, t = '/' + sg;
        if (c.obj === 'table') return tablePart(sg, i, prev, next, last, t);
        if (c.obj === 'volume') {
          var ext = /\.([A-Za-z0-9]+)$/.exec(sg);
          if (last && ext) add(t, 'c6', 'vfile', 'File in the volume: ' + sg, fileKind(ext[1]) + ' Unity Catalog does not look inside: a volume stores files as they are. You read it as <code>/Volumes/…/' + esc(segs.slice(c.objAt + 1).join('/')) + '</code>.', 'The bytes of the file, nothing else.');
          else add(t, 'c6', 'vdir', 'Folder in the volume: ' + sg, 'A sub-folder someone created inside the volume (with <code>dbutils.fs.mkdirs</code>, an upload, or a job writing files). Same name here and under <code>/Volumes/…</code>.', 'Files and sub-folders of the volume.');
          return;
        }
        if (sg === '__unitystorage') {
          c.unity = true; c.rootEnd = i - 1;
          return add(t, 'c5', 'unitystorage', '__unitystorage: Unity Catalog’s own folder',
            'Everything before this is a <b>managed location</b> that an admin gave to a catalog or a schema (<code>CREATE CATALOG … MANAGED LOCATION \'…\'</code>). Inside it, Unity Catalog creates <code>__unitystorage/</code> and only Unity Catalog writes here.',
            'catalogs/ and/or schemas/, one folder per catalog or schema ID.');
        }
        if (c.unity && (sg === 'catalogs' || sg === 'schemas') && UUID.test(next || '')) {
          return add(t, 'c5', 'leveldir', sg + '/', sg === 'catalogs' ? 'The managed location belongs to a <b>catalog</b>. Tables and volumes of that catalog (in schemas without their own location) land below the catalog ID.' : 'The managed location belongs to a <b>schema</b>: it overrides the catalog’s and the metastore’s location for this schema only.', 'One folder per ' + sg.slice(0, -1) + ' ID.');
        }
        if (UUID.test(sg) && (prev === 'catalogs' || prev === 'schemas') && c.unity) {
          c[prev === 'catalogs' ? 'catalogId' : 'schemaId'] = sg; c.level = prev === 'catalogs' ? 'catalog' : 'schema';
          return add(t, 'c5', prev === 'catalogs' ? 'catalogid' : 'schemaid', (prev === 'catalogs' ? 'Catalog ID: ' : 'Schema ID: ') + sg.slice(0, 8) + '…',
            'The ID Unity Catalog gave the ' + c.level + ' when it was created. Not the name: renaming the ' + c.level + ' does not move a single file.' +
            '<br>Look it up: ' + (c.level === 'catalog' ? code('DESCRIBE CATALOG EXTENDED <catalog_name>  -- shows the storage location') : code('DESCRIBE SCHEMA EXTENDED <catalog>.<schema>  -- shows the location')),
            'tables/ and volumes/.');
        }
        if ((sg === 'tables' || sg === 'volumes') && UUID.test(next || '')) {
          return add(t, 'c7', sg + 'dir', sg + '/', sg === 'tables'
            ? 'All <b>managed tables</b> stored at this level, each in its own folder named by its table ID. No catalog, schema or table <i>names</i> in the path: rename a table and nothing moves.'
            : 'All <b>managed volumes</b> stored at this level, each in a folder named by its volume ID.', 'One folder per ' + sg.slice(0, -1) + ' ID.');
        }
        if (UUID.test(sg) && prev === 'tables') {
          c.obj = 'table'; c.objId = sg; c.objAt = i;
          return add(t, 'c4', 'table', 'Table ID: ' + sg.slice(0, 8) + '…',
            'The folder of exactly <b>one managed Delta table</b>. Unity Catalog generated this ID at <code>CREATE TABLE</code> and picked the folder; you never choose it. ' +
            'DROP TABLE removes the table (UNDROP works for 7 days), then Unity Catalog deletes these files too.',
            '<code>_delta_log/</code> (the commits) and Parquet data files, maybe deletion vector folders and <code>_change_data/</code>.');
        }
        if (UUID.test(sg) && prev === 'volumes') {
          c.obj = 'volume'; c.objId = sg; c.objAt = i;
          return add(t, 'c4', 'volume', 'Volume ID: ' + sg.slice(0, 8) + '…',
            'The folder of exactly <b>one managed volume</b>. Whatever you write to <code>/Volumes/&lt;catalog&gt;/&lt;schema&gt;/&lt;volume&gt;/…</code> lands here, byte for byte, with the same sub-folders. No Delta log, no Parquet: just your files.',
            'Your files: CSV, JSON, images, PDFs, ZIPs… whatever was uploaded.');
        }
        if (UUID.test(sg) && (next === 'tables' || next === 'volumes' || (last && /-root$|^metastore$/.test(prev || ''))) && !c.unity) {
          c.metastoreId = sg; c.rootEnd = i - 1; c.level = 'metastore';
          return add(t, 'c5', 'metastoreid', 'Metastore ID: ' + sg.slice(0, 8) + '…',
            'Under the metastore’s storage root Unity Catalog makes one folder named after the <b>metastore ID</b> (one metastore per region). Tables and volumes whose catalog and schema have no managed location of their own end up below it.' +
            '<br>Check which metastore you are on:' + code('SELECT current_metastore()\n-- ' + (out.cloud || 'aws') + ':' + (out.region || '<region>') + ':' + sg),
            'tables/ and volumes/.');
        }
        if (sg === 'metastore' && !c.unity && !c.obj) {
          return add(t, 'c3', 'prefix', 'Prefix: metastore/', 'A plain prefix (S3 has no real folders: this is just the start of the object keys). Whoever set up the metastore storage (an admin, or Databricks itself for default storage) chose this name.', 'One folder per storage root.');
        }
        if (/-root$/.test(sg) && !c.obj) {
          return add(t, 'c3', 'rootdir', 'Storage root folder: ' + sg,
            'Part of the metastore root path, given when the metastore was created. The meaning of the number is not described in the documentation.',
            'Unity Catalog’s folders: one per metastore ID.');
        }
        var looksFile = last && /\.[A-Za-z0-9]{2,8}$/.test(sg);
        if (/^[^=]+=.+$/.test(sg)) return add(t, 'c6', 'partition', 'Partition folder: ' + sg, 'Hive-style partition: column <b>' + esc(sg.split('=')[0]) + '</b> = <b>' + esc(sg.split('=').slice(1).join('=')) + '</b>. Engines skip whole folders when you filter on that column.', 'Files that all have this value.');
        add(t, looksFile ? 'c6' : 'c3', looksFile ? 'object' : 'prefix', (looksFile ? 'Object: ' : 'Prefix: ') + sg,
          looksFile ? fileKind(sg.split('.').pop()) : 'A folder name someone chose. No Unity Catalog pattern here, so this is probably an <b>external location</b>: tables or volumes created with <code>LOCATION \'…\'</code> point at folders like this.', '');
      });
    }
    function tablePart(sg, i, prev, next, last, t) {
      var c = out.ctx, m2;
      if (sg === '_delta_log') { c.inLog = true; return add(t, 'c6', 'log', '_delta_log/: the transaction log', 'The source of truth of the Delta table. Each commit is one numbered JSON file; checkpoints summarise many commits in Parquet. Readers start here, never by listing the folder.', 'Commits <code>00000000000000000000.json</code>, <code>….crc</code> checksums, checkpoints, <code>_last_checkpoint</code>.'); }
      if (c.inLog && (m2 = /^(\d{20})\.json$/.exec(sg))) return add(t, 'c6', 'commit', 'Commit: version ' + (+m2[1]), 'One commit = one JSON file = one table version (here <b>' + (+m2[1]) + '</b>). Each line is an action: commitInfo, protocol, metaData, add, remove…', 'Newline-delimited JSON.');
      if (c.inLog && /^\d{20}\.crc$/.test(sg)) return add(t, 'c6', 'crc', 'Checksum file', 'Written next to each commit: table size, number of files, metadata. Lets readers validate the state quickly.', '');
      if (c.inLog && /\.checkpoint/.test(sg)) return add(t, 'c6', 'checkpoint', 'Checkpoint', 'The full table state at this version in Parquet, so a reader does not have to replay every JSON commit since version 0.', '');
      if (c.inLog && sg === '_last_checkpoint') return add(t, 'c6', 'lastcp', '_last_checkpoint', 'A tiny pointer to the newest checkpoint.', '');
      if (c.inLog && sg === '_staged_commits') return add(t, 'c6', 'log', '_staged_commits/', 'Used by catalog-managed commits: Unity Catalog coordinates the commit, the JSON is staged here first.', '');
      if (sg === '_change_data') { c.inCdc = true; return add(t, 'c6', 'cdcdir', '_change_data/', 'Written when change data feed is on: the before and after images of UPDATE, DELETE and MERGE.', 'Parquet files with _change_type.'); }
      if (/^deletion_vector_.*\.bin$/.test(sg)) return add(t, 'c6', 'dv', 'Deletion vector', 'A small bitmap of row positions that are deleted in one Parquet file. The Parquet file itself is untouched; readers skip the marked rows.', '');
      if (/^[A-Za-z0-9]{2}$/.test(sg) && /^deletion_vector_/.test(next || '')) return add(t, 'c6', 'dvdir', 'Deletion vector folder: ' + sg, 'A random two-character prefix that spreads deletion vector files over folders (it is part of the path stored in the log).', 'deletion_vector_<uuid>.bin files.');
      if (/^part-.*\.parquet$/.test(sg)) return add(t, 'c6', 'parquet', c.inCdc ? 'Change data file' : 'Data file (Parquet)', c.inCdc ? 'Rows that changed, with _change_type = update_preimage / update_postimage / delete.' : 'Rows of the table, stored by column. Whether it is part of the current version is decided by the log (add / remove actions), not by the file being here.', '');
      if (/^[^=]+=.+$/.test(sg)) return add(t, 'c6', 'partition', 'Partition folder: ' + sg, 'The table is partitioned by <b>' + esc(sg.split('=')[0]) + '</b>.', '');
      if (/^[A-Za-z0-9]{2}$/.test(sg)) return add(t, 'c6', 'dvdir', 'Random prefix folder: ' + sg, 'A two-character prefix Delta uses to spread files (deletion vectors, or data files with random prefixes on).', '');
      add(t, 'c6', 'object', sg, last && /\.[a-z]+$/i.test(sg) ? fileKind(sg.split('.').pop()) : 'A folder inside the table.', '');
    }
  }
  function fileKind(ext) {
    ext = String(ext).toLowerCase();
    var k = { csv: 'A CSV file: text, one row per line.', json: 'A JSON file.', parquet: 'A Parquet file: columnar, compressed.', jpg: 'An image (JPEG).', jpeg: 'An image (JPEG).', png: 'An image (PNG).', pdf: 'A PDF document.',
      zip: 'A ZIP archive.', txt: 'A plain text file.', md: 'A Markdown text file.', bin: 'A binary file.', xml: 'An XML file.', avro: 'An Avro file.', gz: 'A gzip-compressed file.', whl: 'A Python wheel (library).', jar: 'A Java library.', log: 'A log file.' };
    return k[ext] || 'A file (.' + esc(ext) + ').';
  }

  // ------------------------------------------------------------------ the simulated bucket
  // node: { name, dir, kids[], mine (on a pasted path), sim (made up), kind, file:{text|html,size}, chip }
  var stores = {}, NAMES = {}, log = [], counters = { t: 1, v: 1, up: 1 };
  function node(name, dir, extra) { var n = { name: name, dir: dir, kids: [] }; for (var k in extra || {}) n[k] = extra[k]; return n; }
  function child(n, name, dir, extra) {
    var k = n.kids.find(function (x) { return x.name === name; });
    if (!k) { k = node(name, dir, extra); n.kids.push(k); n.kids.sort(function (a, b) { return (b.dir - a.dir) || (a.name < b.name ? -1 : 1); }); }
    return k;
  }
  function storeFor(r) { return stores[r.store] || (stores[r.store] = node(r.store, true, { kind: 'bucket' })); }
  function at(store, segs) { var n = store; for (var i = 0; i < segs.length; i++) { n = (n.kids || []).find(function (x) { return x.name === segs[i]; }); if (!n) return null; } return n; }
  function commitJson(v, op, tblId, files, extra) {
    var ts = Date.UTC(2026, 10, 20, 9, 0, 0) + v * 7 * 60000, lines = [];
    lines.push({ commitInfo: { timestamp: ts, operation: op, operationParameters: extra || {}, isolationLevel: 'WriteSerializable', isBlindAppend: op !== 'DELETE', engineInfo: 'Databricks-Runtime/17.3.x', txnId: uuid() } });
    if (v === 0) {
      lines.push({ protocol: { minReaderVersion: 3, minWriterVersion: 7, readerFeatures: ['deletionVectors'], writerFeatures: ['deletionVectors', 'invariants', 'appendOnly'] } });
      lines.push({ metaData: { id: uuid(), format: { provider: 'parquet', options: {} }, schemaString: '{"type":"struct","fields":[{"name":"id","type":"integer"},{"name":"customer","type":"string"},{"name":"amount","type":"double"}]}', partitionColumns: [], configuration: { 'delta.enableDeletionVectors': 'true' }, createdTime: ts } });
    }
    (files || []).forEach(function (f) { lines.push(f); });
    return lines.map(function (l) { return JSON.stringify(l); }).join('\n');
  }
  function addFile(tbl, name, text, size, extra) { return child(tbl, name, false, Object.assign({ file: { text: text, size: size } }, extra || {})); }
  function populateTable(t) {
    if (t.populated) return; t.populated = true; t.v = -1; t.parts = 0;
    child(t, '_delta_log', true, { kind: 'log', chip: ['log', 'transaction log'] });
    tableCommit(t, 'CREATE TABLE', []);
    tableInsert(t, true);
  }
  function tableCommit(t, op, actions, params) {
    t.v++;
    var lg = child(t, '_delta_log', true);
    addFile(lg, pad(t.v) + '.json', commitJson(t.v, op, t.name, actions, params), 900 + actions.length * 420, { chip: ['log', 'v' + t.v] });
    addFile(lg, pad(t.v) + '.crc', JSON.stringify({ txnId: uuid(), tableSizeBytes: 1840 * t.parts, numFiles: t.parts, numMetadata: 1, numProtocol: 1 }, null, 1), 410);
  }
  function tableInsert(t, quiet) {
    var name = 'part-' + String(t.parts).padStart(5, '0') + '-' + uuid() + '-c000.snappy.parquet', rows = 3 + (t.parts % 3);
    t.parts++;
    var f = addFile(t, name, null, 1600 + rows * 64, { chip: ['live', 'data'], fresh: !quiet });
    f.file.html = '<div class="banner info">A Parquet data file of this table: ' + rows + ' rows, stored column by column (id, customer, amount). Added in version ' + (t.v + 1) + '.</div>' +
      '<table class="dt"><tr><th>id</th><th>customer</th><th>amount</th></tr>' + Array.apply(null, Array(rows)).map(function (_, i) { var id = t.parts * 10 + i; return '<tr><td>' + id + '</td><td>Customer ' + id + '</td><td>' + (17 + id * 7 % 80) + '.0</td></tr>'; }).join('') + '</table>';
    tableCommit(t, 'WRITE', [{ add: { path: name, size: f.file.size, modificationTime: Date.UTC(2026, 10, 20), dataChange: true, stats: '{"numRecords":' + rows + '}' } }], { mode: 'Append' });
    return f;
  }
  function tableDelete(t) {
    var target = t.kids.find(function (k) { return /^part-/.test(k.name) && !k.dv; });
    if (!target) return null;
    var pre = 'Qx', dvName = 'deletion_vector_' + uuid() + '.bin', d = child(t, pre, true, { chip: ['dvc', 'deletion vectors'] });
    var f = addFile(d, dvName, null, 42, { chip: ['dvc', 'DV'], fresh: true });
    f.file.html = '<div class="banner info">🧷 A deletion vector: a tiny bitmap saying “row 1 of <b>' + esc(target.name.slice(0, 20)) + '…</b> is deleted”. The Parquet file is untouched.</div><div style="font-family:monospace;font-size:22px;letter-spacing:6px">0 <b style="color:#c5221f">1</b> 0 0</div>';
    target.dv = true; target.chip = ['dvc', 'has DV'];
    tableCommit(t, 'DELETE', [{ remove: { path: target.name, dataChange: true } }, { add: { path: target.name, dataChange: true, deletionVector: { storageType: 'u', pathOrInlineDv: pre + '…', sizeInBytes: 42, cardinality: 1 } } }], { predicate: '["(id = 11)"]' });
    return f;
  }
  function populateVolume(v) {
    if (v.populated) return; v.populated = true;
    var raw = child(v, 'raw', true), img = child(v, 'images', true);
    addFile(raw, 'orders_2026-11-20.csv', 'order_id,customer,amount,ts\n1001,Ann,30.0,2026-11-20T08:01:00Z\n1002,Bob,12.5,2026-11-20T08:03:10Z\n1003,Cy,55.0,2026-11-20T08:07:42Z\n…', 48211);
    addFile(raw, 'orders_2026-11-21.csv', 'order_id,customer,amount,ts\n1101,Dee,8.0,2026-11-21T07:55:12Z\n1102,Eve,41.0,2026-11-21T08:00:31Z\n…', 51907);
    var j = addFile(img, 'receipt_0001.jpg', null, 183422); j.file.html = '<div style="font-size:110px;text-align:center">🧾</div><p style="text-align:center">An image: just bytes. A volume stores any file type.</p>';
    addFile(v, 'README.md', '# Landing zone\nRaw order exports land here every morning.\nRead them with /Volumes/<catalog>/<schema>/<volume>/raw/', 112);
  }
  // build or extend the tree for a parsed path; returns the segment list of the deepest node
  function grow(r) {
    if (r.logical || r.legacy || !r.store) return null;
    var c = r.ctx, segs = c.segs, n = storeFor(r), here = [];
    segs.forEach(function (sg, i) {
      var isLast = i === segs.length - 1, p = r.parts.find(function (x) { return x.text === '/' + sg && !x.used; }) || {};
      p.used = true;
      var dir = !(isLast && /\.[A-Za-z0-9]{2,8}$/.test(sg) && sg !== '__unitystorage') && sg !== '_last_checkpoint';
      n = child(n, sg, dir, { kind: p.kind });
      n.mine = true; here.push(sg);
      if (p.kind === 'table') populateTable(n);
      if (p.kind === 'volume') populateVolume(n);
      if (!dir && !n.file) n.file = { text: '(simulated contents of ' + sg + ')', size: 2048 };
    });
    r.parts.forEach(function (p) { delete p.used; });
    // a few neighbours, so the folders do not look empty
    var level = c.metastoreId ? at(storeFor(r), segs.slice(0, segs.indexOf(c.metastoreId) + 1)) : (c.catalogId || c.schemaId) ? at(storeFor(r), segs.slice(0, segs.indexOf(c.catalogId || c.schemaId) + 1)) : null;
    if (level && !level.neighbours) {
      level.neighbours = true;
      var tdir = child(level, 'tables', true, { kind: 'tablesdir' }), vdir = child(level, 'volumes', true, { kind: 'volumesdir' });
      var t = child(tdir, uuid(), true, { kind: 'table', sim: true }); populateTable(t); NAMES[t.name] = 'main.sales.customers';
      var v = child(vdir, uuid(), true, { kind: 'volume', sim: true }); populateVolume(v); NAMES[v.name] = 'main.raw.landing';
    }
    return here;
  }
  function kindChip(n) {
    if (n.chip) return n.chip;
    if (n.kind === 'table') return ['live', '🔺 Delta table' + (NAMES[n.name] ? ' · ' + NAMES[n.name] : '')];
    if (n.kind === 'volume') return ['cdc', '📁 volume' + (NAMES[n.name] ? ' · ' + NAMES[n.name] : '')];
    if (n.kind === 'metastoreid') return ['log', '🏛️ metastore'];
    if (n.kind === 'catalogid') return ['log', '📚 catalog' + (NAMES[n.name] ? ' · ' + NAMES[n.name] : '')];
    if (n.kind === 'schemaid') return ['log', '🗂️ schema' + (NAMES[n.name] ? ' · ' + NAMES[n.name] : '')];
    if (n.kind === 'unitystorage') return ['rm', 'Unity Catalog only'];
    if (n.kind === 'rootdir') return ['rm', 'storage root'];
    return null;
  }

  // ------------------------------------------------------------------ UI
  var ui = { input: null, store: null, cwd: [], sel: null };
  try { ui.input = localStorage.getItem('dlsb-path'); } catch (e) { }

  function mount(el, api) {
    el.innerHTML =
      '<div class="pd">' +
      '<div class="pdin"><label>Paste a storage path from Databricks <small>(Catalog Explorer → table or volume → Details → Storage location, or <span class="mono">DESCRIBE DETAIL</span>)</small></label>' +
      '<div class="pdrow"><textarea id="pdTxt" rows="3" spellcheck="false" placeholder="s3://…/tables/…   (one path per line: paste several to compare them)"></textarea><button class="btn acc" id="pdGo">🔍 Explain it</button></div>' +
      '<div class="pdex"><span>Examples:</span>' + EXAMPLES.map(function (x, i) { return '<button data-i="' + i + '">' + x[0] + '</button>'; }).join('') + '</div></div>' +
      '<div class="pdmain"><div class="pdl"><div id="pdOut"><div class="ptip">👆 Paste a path and press <b>Explain it</b>. Every layer gets its own colour, and the bucket on the right is built around your path.</div></div></div>' +
      '<div class="pdr"><div class="xp pdxp" id="pdXp"></div><div class="pdacts" id="pdActs"></div><div class="pdlog" id="pdLog"></div></div></div></div>';
    var ta = el.querySelector('#pdTxt');
    ta.value = ui.input || EXAMPLES[0][1];
    function go() { explain(el, ta.value, true); }
    el.querySelector('#pdGo').onclick = go;
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } e.stopPropagation(); });
    el.querySelectorAll('.pdex button').forEach(function (b) { b.onclick = function () { ta.value = EXAMPLES[+b.dataset.i][1]; go(); }; });
    ui.api = api;
    go();
  }

  // ------------------------------------------------------------------ the explanation
  var DOC_BP = 'https://docs.databricks.com/aws/en/data-governance/unity-catalog/best-practices/', DOC_VOL = 'https://docs.databricks.com/aws/en/volumes/paths/';
  function doc(url, t) { return ' <a class="pdoc" href="' + url + '" target="_blank" rel="noopener">' + t + ' ↗</a>'; }
  function shortId(s) { return s.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f]{12})/gi, '$1-…-$2'); }
  // group the parts of one parsed path into layers: scheme, bucket, root, metastore, level, type, object, then whatever is inside
  function rolesOf(r) {
    var c = r.ctx, out = [], seg = -1, inside = 0;
    r.parts.forEach(function (p, i) {
      if (/^\//.test(p.text) && !r.logical) seg++;
      var role;
      if (p.kind === 'scheme' || p.kind === 'volroot') role = 'scheme';
      else if (p.kind === 'bucket' || p.kind === 'account' || p.kind === 'endpoint') role = 'bucket';
      else if (c.level && seg >= 0 && seg <= c.rootEnd) role = 'root';
      else if (p.kind === 'metastoreid') role = 'metastore';
      else if (p.kind === 'unitystorage') role = 'unitystorage';
      else if (p.kind === 'leveldir' || p.kind === 'catalogid' || p.kind === 'schemaid') role = 'level';
      else if (p.kind === 'tablesdir' || p.kind === 'volumesdir') role = 'type';
      else if (p.kind === 'table' || p.kind === 'volume') role = 'object';
      else role = c.obj ? 'in' + (inside++) : 'seg' + i;
      var last = out[out.length - 1];
      if (last && last.role === role) { last.text += p.text; last.parts.push(p); last.k = seg + 1; }
      else out.push({ role: role, text: p.text, parts: [p], cls: role === 'root' ? 'c3' : p.cls, k: seg + 1 });
    });
    out.forEach(function (x) { x.bare = x.role === 'scheme' ? x.text : x.text.replace(/^\//, '').replace(/^@/, '@'); });
    return out;
  }
  function rowText(role, list, rs) {
    var r = rs[0], c = r.ctx, n = rs.length, all = n > 1 ? (n === 2 ? 'both paths' : 'all ' + n + ' paths') : '';
    var same = list.every(function (x) { return x && x.bare === list[0].bare; });
    var levels = rs.map(function (x) { return x.ctx.level; });
    switch (role) {
      case 'scheme':
        if (r.logical) return ['A Unity Catalog path', r.parts[0].what];
        return ['The protocol', { aws: 'Marks Amazon S3 object storage, so you are on <b>AWS</b>.', azure: 'Marks Azure Data Lake Storage Gen2, so you are on <b>Azure</b>.', gcp: 'Marks Google Cloud Storage, so you are on <b>Google Cloud</b>.', dbfs: r.parts[0].what }[r.cloud]];
      case 'bucket':
        if (r.cloud === 'azure') return ['The container and storage account', 'The storage set up for Unity Catalog. The region is a property of the storage account, it is not in the name.'];
        return ['The ' + (r.cloud === 'gcp' ? 'GCS' : 'S3') + ' bucket', (c.level ? 'The bucket set up as Unity Catalog storage.' : 'The bucket that holds this data.') +
          (r.region ? ' Going by the name, it is in the <b>' + r.region + '</b> region' + (REGIONS[r.region] ? ' (' + REGIONS[r.region] + ')' : '') + '.' : ' The region is not in the name; check the bucket in the cloud console.')];
      case 'root':
        if (levels.every(function (l) { return l === 'metastore'; })) {
          var nums = list.map(function (x) { return (/(\d{4,})/.exec(x.bare) || [])[1]; }).filter(Boolean);
          return ['The metastore root folder inside the bucket', 'This path was given when the metastore was created.' +
            (nums.length ? ' What the number <code>' + esc(nums[0]) + '</code> means is not described in the documentation, so we do not guess.' : '')];
        }
        return ['The managed location of a catalog or schema', 'The folder an admin gave with <code>MANAGED LOCATION \'…\'</code> when creating the catalog or the schema.'];
      case 'metastore':
        return ['The metastore ID (UUID)', 'Unity Catalog’s folder for this metastore.' + (n > 1 ? (same ? ' The same in ' + all + ', so they belong to the <b>same metastore</b>.' : ' <b>Different</b> in the paths, so they belong to different metastores (and likely different regions).') : '')];
      case 'unitystorage':
        return ['Unity Catalog’s own folder', 'Created by Unity Catalog inside a catalog or schema managed location. Only Unity Catalog writes here.'];
      case 'level':
        var lv = list.filter(Boolean)[0].parts[0].text.indexOf('schemas') >= 0 ? 'schema' : 'catalog';
        return ['The ' + lv + ' ID (UUID)', 'The ' + lv + ' has its own managed location; this folder belongs to that ' + lv + '.' + (n > 1 && same ? ' The same in ' + all + '.' : '')];
      case 'type':
        return ['The object type', 'Separates <b>managed tables</b> from <b>managed volumes</b>.'];
      case 'object':
        var kinds = rs.map(function (x) { return x.ctx.obj; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
        return ['The ' + kinds.map(function (k) { return k + '’s'; }).join(' or ') + ' own directory', 'At creation Unity Catalog generates a <b>random</b> directory name, so it cannot collide with other folders. ' +
          'This differs from the Hive metastore, where the folder name is the table name.' + doc(DOC_VOL, 'Path rules and access in Unity Catalog volumes')];
      default:
        var p = list.filter(Boolean)[0].parts[0];
        return [p.title, p.what + (p.see ? '<br><span class="psee">👀 Inside: ' + p.see + '</span>' : '')];
    }
  }

  function explain(el, text, navigate) {
    var out = el.querySelector('#pdOut');
    ui.input = text; try { localStorage.setItem('dlsb-path', text); } catch (e) { }
    var texts = String(text || '').split(/\s+/).filter(Boolean);
    if (!texts.length) { out.innerHTML = '<div class="ptip warn">Paste a path first, or pick one of the examples.</div>'; return; }
    var rs = texts.map(parse), bad = rs.filter(function (r) { return r.err; });
    if (bad.length) { out.innerHTML = '<div class="ptip warn">' + bad[0].err + '</div>'; return; }
    var grown = rs.map(grow);
    if (grown[0] && navigate !== false) {
      ui.store = rs[0].store;
      var deep = at(stores[rs[0].store], grown[0]);
      ui.cwd = deep && !deep.dir ? grown[0].slice(0, -1) : grown[0].slice();
      ui.sel = grown[0].join('/');
    }
    var R = rs.map(rolesOf), order = [];
    R.forEach(function (ls) { ls.forEach(function (x) { if (order.indexOf(x.role) < 0) order.push(x.role); }); });
    // column widths for the aligned split view
    var col = order.map(function (role, j) {
      var w = 0; R.forEach(function (ls) { var x = ls.find(function (y) { return y.role === role; }); if (x) w = Math.max(w, shortId(x.bare).length); }); return w;
    });
    var n = rs.length, many = n > 1, c0 = rs[0].ctx;
    var managed = rs.every(function (r) { return r.ctx.level; }), anyTable = rs.some(function (r) { return r.ctx.obj === 'table'; }), anyVol = rs.some(function (r) { return r.ctx.obj === 'volume'; });
    var html = '<h3 class="ph">How the path is built</h3>';
    if (managed) html += '<p class="pint">' + (many ? (n === 2 ? 'Both paths are' : 'All ' + n + ' paths are') : 'This path is') + ' <b>Unity Catalog managed storage</b>. Managed tables and managed volumes are stored in places like this. ' +
      'The storage can be set at metastore, catalog or schema level, and the data always goes to the lowest level that is set.' + doc(DOC_BP, 'Unity Catalog best practices') + '</p>';
    else if (rs.every(function (r) { return r.logical; })) html += '<p class="pint">' + (many ? 'These are' : 'This is') + ' a <b>Unity Catalog volume path</b>: names, not a cloud URL. Unity Catalog checks your permissions and maps it to the storage behind the volume.' + doc(DOC_VOL, 'Path rules and access in Unity Catalog volumes') + '</p>';
    else if (rs.some(function (r) { return r.legacy; })) html += '<p class="pint">A legacy <b>DBFS</b> path, from before Unity Catalog. For new work use Unity Catalog tables and volumes.</p>';
    else html += '<p class="pint">' + (managed ? '' : 'This path does <b>not</b> follow the Unity Catalog managed storage pattern (no <code>tables/&lt;id&gt;</code> or <code>volumes/&lt;id&gt;</code>). It is probably an <b>external location</b>: the folders were chosen by whoever wrote the data, and external tables or volumes point here with <code>LOCATION</code>.') + '</p>';
    // split view
    html += '<div class="psplit">' + R.map(function (ls, pi) {
      return '<div>' + order.map(function (role, j) {
        var x = ls.find(function (y) { return y.role === role; });
        var txt = x ? shortId(x.bare) : '', sep = j === 0 || role === 'bucket' && order[j - 1] === 'scheme' || !x ? '' : ' / ';
        var padn = Math.max(0, col[j] - txt.length);
        return (x ? sep + '<span class="' + x.cls + '" data-p="' + pi + '" data-r="' + role + '">' + esc(txt) + '</span>' : '') + (many ? '<span class="padw">' + ' '.repeat(padn + (x || j === 0 ? 0 : 3)) + '</span>' : '');
      }).join('') + '</div>';
    }).join('') + '</div>';
    // the table
    var metaRow = 0;
    html += '<table class="ptab"><tr><th>#</th><th>Part</th><th>What it is</th><th>How it works</th></tr>' + order.map(function (role, j) {
      var list = R.map(function (ls) { return ls.find(function (y) { return y.role === role; }); });
      var vals = list.filter(Boolean).map(function (x) { return x.bare; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var t = rowText(role, list, rs), x0 = list.filter(Boolean)[0];
      if (role === 'metastore') metaRow = j + 1;
      var part = vals.map(function (v) { return '<code class="' + x0.cls + '">' + esc(vals.length > 1 || role === 'object' && many ? shortId(v).replace(/-…-[0-9a-f]{12}$/i, '-…') : v) + '</code>'; }).join(' or ');
      return '<tr data-r="' + role + '" class="' + x0.cls + '"><td class="pn">' + (j + 1) + '</td><td class="pp">' + part + '</td><td class="pw"><b>' + t[0] + '</b></td><td>' + t[1] + '</td></tr>';
    }).join('') + '</table>';
    // what the level means
    var lv = rs.map(function (r) { return r.ctx.level; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var INF = ' <i class="pinf">This is our inference from the rule, not an example from the documentation.</i>';
    lv.forEach(function (l) {
      if (l === 'metastore') html += '<div class="pq"><b>What does it mean that the path sits directly under the metastore UUID?</b> The catalog and the schema of ' + (many ? 'these objects' : 'this object') + ' have no managed location of their own, so the data went to the metastore-level root storage. If the catalog had its own storage, the path would be in a subfolder of that.' + INF + '</div>';
      if (l === 'catalog') html += '<div class="pq"><b>What does <code>__unitystorage/catalogs/&lt;id&gt;</code> mean?</b> The catalog has its own managed location and the schema does not, so the data went to the catalog’s storage instead of the metastore root.' + INF + '</div>';
      if (l === 'schema') html += '<div class="pq"><b>What does <code>__unitystorage/schemas/&lt;id&gt;</code> mean?</b> The schema has its own managed location, and that is the lowest level that is set, so the data went there, not to the catalog’s or the metastore’s storage.' + INF + '</div>';
    });
    // important
    var imp = [];
    if (anyTable || anyVol) imp.push('<b>Do not read or write a managed ' + (anyTable ? 'table' : 'volume') + ' through its path.</b> It is not supported. Use ' + (anyTable ? 'the table by its three-part name (<code>catalog.schema.table</code>)' : '') + (anyTable && anyVol ? ', and ' : '') + (anyVol ? 'the volume through <code>/Volumes/&lt;catalog&gt;/&lt;schema&gt;/&lt;volume&gt;/…</code>' : '') + '.' + doc(DOC_VOL, 'Path rules and access in Unity Catalog volumes'));
    if (managed) imp.push('The UUID does not tell you the name of the table or the volume. You have to look it up in the catalog (below).');
    if (rs.some(function (r) { return r.logical; })) imp.push('To see which cloud folder is behind a volume, run <code>DESCRIBE VOLUME ' + esc(rs.find(function (r) { return r.logical; }).ctx.volName) + '</code> (the <code>storage_location</code> column).');
    if (!managed && !rs.some(function (r) { return r.logical || r.legacy; })) imp.push('List the external locations you can use with <code>SHOW EXTERNAL LOCATIONS</code>.');
    if (imp.length) html += '<h3 class="ph">Good to know</h3><ul class="pimp">' + imp.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    // lookup
    var tIds = [], vIds = [];
    rs.forEach(function (r) { if (r.ctx.obj === 'table' && tIds.indexOf(r.ctx.objId) < 0) tIds.push(r.ctx.objId); if (r.ctx.obj === 'volume' && vIds.indexOf(r.ctx.objId) < 0) vIds.push(r.ctx.objId); });
    if (tIds.length || vIds.length) {
      var q = [];
      if (tIds.length) q.push("SELECT 'table' AS kind, table_catalog, table_schema, table_name, storage_path AS path\nFROM system.information_schema.tables\nWHERE " + tIds.map(function (id) { return "storage_path LIKE '%" + id + "%'"; }).join('\n   OR '));
      if (vIds.length) q.push("SELECT " + (tIds.length ? "'volume'" : "'volume' AS kind") + ", volume_catalog, volume_schema, volume_name, storage_location" + (tIds.length ? '' : ' AS path') + "\nFROM system.information_schema.volumes\nWHERE " + vIds.map(function (id) { return "storage_location LIKE '%" + id + "%'"; }).join('\n   OR '));
      html += '<h3 class="ph">Which ' + (tIds.length && vIds.length ? 'table or volume' : tIds.length ? 'table' : 'volume') + ' is behind it?</h3><p class="pint">Run this on a running SQL warehouse:</p>' + code(q.join('\nUNION ALL\n') + ';') +
        (metaRow ? '<p class="pint">And <code>SELECT current_metastore();</code> checks that part ' + metaRow + ' really is your metastore’s ID.</p>' : '');
    }
    out.innerHTML = html;
    // clicks: a part of the split view or a table row opens that folder in the bucket on the right
    function goTo(pi, role) {
      var r = rs[pi] || rs[0], x = R[pi] ? R[pi].find(function (y) { return y.role === role; }) : null;
      out.querySelectorAll('.ptab tr.on, .psplit span.on').forEach(function (e) { e.classList.remove('on'); });
      var tr = out.querySelector('.ptab tr[data-r="' + role + '"]'); if (tr) tr.classList.add('on');
      out.querySelectorAll('.psplit span[data-r="' + role + '"][data-p="' + pi + '"]').forEach(function (e) { e.classList.add('on'); });
      if (!x || !r.ctx.segs || !stores[r.store]) return;
      var segs = r.ctx.segs.slice(0, x.k), nd = at(stores[r.store], segs);
      ui.store = r.store; ui.cwd = nd && !nd.dir ? segs.slice(0, -1) : segs; ui.sel = segs.join('/');
      drawExplorer(el);
    }
    out.querySelectorAll('.psplit span[data-r]').forEach(function (s) { s.onclick = function () { goTo(+s.dataset.p, s.dataset.r); }; });
    out.querySelectorAll('.ptab tr[data-r]').forEach(function (tr) { tr.onclick = function () { goTo(0, tr.dataset.r); }; });
    ui.note = rs[0].logical ? '/Volumes paths are names, not bucket URLs: run DESCRIBE VOLUME to see the folder behind it.' : rs[0].legacy ? 'DBFS is not simulated here.' : null;
    drawExplorer(el);
  }

  function pathOf(segs) { return ui.store + (segs.length ? '/' + segs.join('/') : ''); }
  function drawExplorer(el) {
    var xp = el.querySelector('#pdXp'), acts = el.querySelector('#pdActs');
    var keys = Object.keys(stores);
    if (!ui.store || !stores[ui.store]) {
      xp.innerHTML = '<div class="xbar"><span class="xcrumb">🪣 <b>simulated bucket</b></span></div><div class="xempty">' + (ui.note || 'Explain a cloud path and its bucket appears here.') + '</div>';
      acts.innerHTML = ''; drawLog(el); return;
    }
    var root = stores[ui.store], cwd = at(root, ui.cwd) || root;
    if (cwd === root) ui.cwd = ui.cwd.length && !at(root, ui.cwd) ? [] : ui.cwd;
    var crumbs = ['<a data-k="-1">🪣 ' + esc(ui.store.replace(/^[a-z0-9]+:\/\//i, '')) + '</a>'].concat(ui.cwd.map(function (s, i) { return '<a data-k="' + i + '">' + esc(s.length > 14 && UUID.test(s) ? s.slice(0, 8) + '…' : s) + '</a>'; }));
    var html = '<div class="xbar">' + (keys.length > 1 ? '<select id="pdStore">' + keys.map(function (k) { return '<option' + (k === ui.store ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' : '') +
      '<span class="xcrumb">' + crumbs.join(' <i>›</i> ') + '</span>' + (ui.cwd.length ? '<button class="xup" title="Up one folder">⬆ up</button>' : '') + '</div>' +
      '<div class="xhead"><span></span><span>Name</span><span></span><span>Size</span><span>Type</span></div><div class="xbody">';
    if (!cwd.kids.length) html += '<div class="xempty">(empty folder)</div>';
    cwd.kids.forEach(function (k) {
      var full = ui.cwd.concat(k.name).join('/'), ch = kindChip(k), nm = k.name + (k.dir ? '/' : '');
      html += '<div class="xr' + (k.dir ? ' dir' : '') + (k.kind === 'table' ? ' delta' : '') + (ui.sel === full ? ' hl' : '') + (k.fresh ? ' fresh' : '') + (k.dropped ? ' old' : '') + '" data-n="' + esc(k.name) + '">' +
        '<span class="xi">' + (k.dir ? (k.kind === 'table' ? '🧊' : k.kind === 'volume' ? '🗃️' : '📁') : /\.json$/.test(k.name) ? '🧾' : /\.parquet$/.test(k.name) ? '📦' : /\.bin$/.test(k.name) ? '🧷' : /\.(jpg|png)$/.test(k.name) ? '🖼️' : '📄') + '</span>' +
        '<span class="xn" title="' + esc(nm) + '">' + esc(nm) + (k.mine ? ' <span class="chip mine">your path</span>' : k.sim ? ' <span class="chip simc">simulated</span>' : '') + '</span>' +
        (k.dropped ? '<span class="chip del">dropped · UNDROP for 7 days</span>' : ch ? '<span class="chip ' + ch[0] + '">' + esc(ch[1]) + '</span>' : '<span></span>') +
        '<span class="xs">' + (k.file ? fmtSize(k.file.size) : '') + '</span><span class="xt">' + (k.dir ? 'folder' : (k.name.split('.').pop() || '').toUpperCase().slice(0, 7)) + '</span></div>';
      k.fresh = false;
    });
    html += '</div><div class="xfoot">👆 A folder opens, a file opens in a viewer. Each click explains that path on the left.</div>';
    xp.innerHTML = html;
    var sel = xp.querySelector('#pdStore'); if (sel) sel.onchange = function () { ui.store = sel.value; ui.cwd = []; drawExplorer(el); };
    xp.querySelectorAll('.xcrumb a').forEach(function (a) { a.onclick = function () { ui.cwd = ui.cwd.slice(0, +a.dataset.k + 1); syncInput(el, ui.cwd); }; });
    var up = xp.querySelector('.xup'); if (up) up.onclick = function () { ui.cwd = ui.cwd.slice(0, -1); syncInput(el, ui.cwd); };
    xp.querySelectorAll('.xr').forEach(function (row) {
      row.onclick = function () {
        var k = cwd.kids.find(function (x) { return x.name === row.dataset.n; }), segs = ui.cwd.concat(k.name);
        if (k.dir) { ui.cwd = segs; syncInput(el, segs); }
        else {
          ui.sel = segs.join('/'); syncInput(el, segs, true);
          if (window.DeltaSim && window.DeltaSim.openFile) window.DeltaSim.openFile(null, { path: k.name, dir: '', type: 'static', text: k.file.text, html: k.file.html }, pathOf(ui.cwd));
        }
      };
    });
    drawActions(el, cwd);
    drawLog(el);
  }
  function syncInput(el, segs, keepCwd) {
    var p = pathOf(segs), ta = el.querySelector('#pdTxt');
    ta.value = p; ui.sel = segs.join('/');
    var cwd = ui.cwd.slice();
    explain(el, p, false);
    if (keepCwd) ui.cwd = cwd;
    drawExplorer(el);
  }

  // context-dependent simulation buttons
  function drawActions(el, cwd) {
    var acts = el.querySelector('#pdActs'), root = stores[ui.store], b = [];
    var r = parse(pathOf(ui.cwd)), c = r.ctx || {};
    var levelSegs = null;
    if (!r.err && c.segs) {
      var id = c.schemaId || c.catalogId || c.metastoreId;
      if (id) levelSegs = c.segs.slice(0, c.segs.indexOf(id) + 1);
    }
    if (c.obj === 'table' && c.objAt === c.segs.length - 1 || cwd.kind === 'table') {
      if (!cwd.dropped) b.push(['ins', '➕ INSERT INTO (new Parquet file + commit)'], ['del', '🧷 DELETE one row (deletion vector)'], ['drop', '🗑️ DROP TABLE']);
      else b.push(['undrop', '↩️ UNDROP TABLE']);
    } else if (c.obj === 'volume') {
      b.push(['up', '⬆️ Upload a file here'], ['mk', '📁 New folder here']);
    }
    if (levelSegs) b.push(['ct', '🧊 CREATE TABLE (managed, at this level)'], ['cv', '🗃️ CREATE VOLUME (managed, at this level)']);
    if (r.cloud === 'aws' || r.cloud === 'azure' || r.cloud === 'gcp') b.push(['cat', '📚 CREATE CATALOG with its own MANAGED LOCATION']);
    acts.innerHTML = '<div class="pdah">🧪 Simulate <small>· nothing runs on a real workspace</small></div>' + b.map(function (x) { return '<button class="pill sk thin" data-a="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    acts.querySelectorAll('button').forEach(function (btn) { btn.onclick = function () { act(el, btn.dataset.a, cwd, levelSegs, r); }; });
  }
  function note(sql, text) { log.unshift({ sql: sql, text: text }); if (log.length > 6) log.pop(); }
  function drawLog(el) {
    el.querySelector('#pdLog').innerHTML = log.map(function (l) { return '<div class="pdle"><pre class="pcode">' + esc(l.sql) + '</pre><div>' + l.text + '</div></div>'; }).join('');
  }
  function act(el, a, cwd, levelSegs, r) {
    var root = stores[ui.store], n;
    if (a === 'ins') { n = tableInsert(cwd); note('INSERT INTO ' + (NAMES[cwd.name] || '<this table>') + ' VALUES (…)', 'Delta wrote <b>' + esc(n.name.slice(0, 24)) + '…</b> and commit <b>' + pad(cwd.v) + '.json</b> in _delta_log. Old files are never edited.'); }
    else if (a === 'del') { n = tableDelete(cwd); note('DELETE FROM ' + (NAMES[cwd.name] || '<this table>') + ' WHERE id = 11', n ? 'No Parquet file rewritten: a deletion vector appeared in folder <b>Qx/</b>, and commit ' + cwd.v + ' says which file it belongs to.' : 'Nothing to delete.'); }
    else if (a === 'drop') { cwd.dropped = true; note('DROP TABLE ' + (NAMES[cwd.name] || '<this table>'), 'The table is gone from the catalog. The files stay for <b>7 days</b> so <span class="mono">UNDROP TABLE</span> can bring it back; then Unity Catalog deletes this folder, because it is a <b>managed</b> table.'); }
    else if (a === 'undrop') { cwd.dropped = false; note('UNDROP TABLE ' + (NAMES[cwd.name] || '<this table>'), 'Back, with the same ID and the same folder.'); }
    else if (a === 'up') { var fname = 'upload_' + (counters.up++) + '.csv'; n = addFile(cwd, fname, 'id,value\n1,42\n2,17\n…', 1200 + counters.up * 37, { fresh: true, sim: true }); note("-- Catalog Explorer → Upload to volume, or:\ndbutils.fs.cp('file:/tmp/" + fname + "', '/Volumes/<catalog>/<schema>/<volume>/" + (ui.cwd.slice((r.ctx.objAt || 0) + 1).concat(fname).join('/')) + "')", 'The file landed in this folder byte for byte. Same name under /Volumes and in the bucket.'); }
    else if (a === 'mk') { var d = 'folder_' + (counters.up++); child(cwd, d, true, { sim: true, fresh: true }); note("dbutils.fs.mkdirs('/Volumes/<catalog>/<schema>/<volume>/" + ui.cwd.slice((r.ctx.objAt || 0) + 1).concat(d).join('/') + "')", 'A new folder inside the volume.'); }
    else if (a === 'ct' || a === 'cv') {
      var lvl = at(root, levelSegs);
      if (!lvl) return;
      var dirName = a === 'ct' ? 'tables' : 'volumes', dirN = child(lvl, dirName, true, { kind: dirName + 'dir' });
      var id = uuid(), nm = a === 'ct' ? 'main.sales.table_' + (counters.t++) : 'main.raw.volume_' + (counters.v++);
      if (lvl.kind === 'catalogid' && NAMES[lvl.name]) nm = NAMES[lvl.name] + (a === 'ct' ? '.ledger.table_' : '.files.volume_') + (a === 'ct' ? counters.t - 1 : counters.v - 1);
      n = child(dirN, id, true, { kind: a === 'ct' ? 'table' : 'volume', sim: true, fresh: true }); NAMES[id] = nm;
      if (a === 'ct') populateTable(n); else populateVolume(n);
      ui.cwd = levelSegs.concat(dirName); ui.sel = ui.cwd.concat(id).join('/');
      note(a === 'ct' ? 'CREATE TABLE ' + nm + ' (id INT, customer STRING, amount DOUBLE)' : 'CREATE VOLUME ' + nm,
        'No LOCATION given, so it is <b>managed</b>: Unity Catalog generated the ID <b>' + id.slice(0, 8) + '…</b> and made the folder <b>' + dirName + '/' + id.slice(0, 8) + '…/</b>. The name ' + nm + ' appears nowhere in the path.');
    } else if (a === 'cat') {
      // a catalog's managed location is usually in a bucket you own, not in the metastore's (default) storage
      var own = r.cloud === 'aws' ? 's3://acme-uc-' + (r.region || 'us-west-2') : ui.store;
      root = stores[own] || (stores[own] = node(own, true, { kind: 'bucket', sim: true })); ui.store = own;
      var cat = 'finance', base = child(root, cat, true, { sim: true }), us = child(base, '__unitystorage', true, { kind: 'unitystorage' }), cs = child(us, 'catalogs', true, { kind: 'leveldir' });
      var cid = uuid(), cn = child(cs, cid, true, { kind: 'catalogid', sim: true, fresh: true }); NAMES[cid] = cat + '_' + counters.t;
      var tid = uuid(), td = child(child(cn, 'tables', true, { kind: 'tablesdir' }), tid, true, { kind: 'table', sim: true }); populateTable(td); NAMES[tid] = NAMES[cid] + '.ledger.entries'; counters.t++;
      ui.cwd = [cat, '__unitystorage', 'catalogs', cid]; ui.sel = ui.cwd.join('/');
      note("CREATE CATALOG " + NAMES[cid] + "\n  MANAGED LOCATION '" + ui.store + "/" + cat + "';\nCREATE TABLE " + NAMES[tid] + " (…);",
        'Now the catalog has its own managed location. Its tables go to <b>' + cat + '/__unitystorage/catalogs/&lt;catalog-id&gt;/tables/</b>, not to the metastore root.');
    }
    if (n && (a === 'ins' || a === 'up')) ui.sel = ui.cwd.concat(n.name).join('/');
    if (a === 'mk' || a === 'drop' || a === 'undrop') ui.sel = ui.cwd.join('/');
    var ta = el.querySelector('#pdTxt'), cw = ui.cwd.slice(), sl = ui.sel; ta.value = pathOf(ui.sel ? ui.sel.split('/') : cw);
    explain(el, ta.value, false); ui.cwd = cw; ui.sel = sl; drawExplorer(el);
  }

  // a cheat sheet of the patterns, for step 2 of the scene
  function cheat(el) {
    var rows = [
      ['metastore level', '<span class="c2">&lt;metastore storage root&gt;</span>/<span class="c5">&lt;metastore-id&gt;</span>/<span class="c7">tables</span>/<span class="c4">&lt;table-id&gt;</span>', 'The catalog and the schema have no managed location of their own.'],
      ['catalog level', '<span class="c2">&lt;catalog managed location&gt;</span>/<span class="c5">__unitystorage/catalogs/&lt;catalog-id&gt;</span>/<span class="c7">tables</span>/<span class="c4">&lt;table-id&gt;</span>', 'CREATE CATALOG … MANAGED LOCATION \'…\''],
      ['schema level', '<span class="c2">&lt;schema managed location&gt;</span>/<span class="c5">__unitystorage/schemas/&lt;schema-id&gt;</span>/<span class="c7">tables</span>/<span class="c4">&lt;table-id&gt;</span>', 'CREATE SCHEMA … MANAGED LOCATION \'…\'. The closest level wins.'],
      ['managed volume', '…/<span class="c7">volumes</span>/<span class="c4">&lt;volume-id&gt;</span>/<span class="c6">your/files.csv</span>', 'Same three levels, “volumes” instead of “tables”.'],
      ['external table / volume', '<span class="c2">s3://your-bucket</span>/<span class="c3">any/folders/you/chose</span>', 'CREATE TABLE … LOCATION \'…\' through an external location. DROP keeps the files.']
    ];
    el.innerHTML = '<table class="pcheat">' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td><div class="url" style="font-size:14px;padding:8px 10px;line-height:1.5">' + r[1] + '</div><small>' + r[2] + '</small></td></tr>'; }).join('') + '</table>';
  }

  window.PathSim = { mount: mount, parse: parse, cheat: cheat, reset: function () { stores = {}; NAMES = {}; log = []; ui.store = null; ui.cwd = []; ui.input = null; try { localStorage.removeItem('dlsb-path'); } catch (e) { } } };
})();
