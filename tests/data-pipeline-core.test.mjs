import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Core from '../src/core/node-editor-core.mjs';

function registry() {
  const r = new Core.NodeRegistry();
  r.register({
    type: 'csv-input', titleKey: 'csvInput', category: 'input',
    createDefaultData: () => ({ delimiter: 'auto', header: true, encoding: 'utf-8' }),
    getPorts: () => [{ id: 'table', direction: 'output', dataType: 'table', required: true, maxConnections: 1 }]
  });
  r.register({
    type: 'select-columns', titleKey: 'selectColumns', category: 'transform',
    createDefaultData: () => ({ columns: null }),
    getPorts: () => [
      { id: 'in', direction: 'input', dataType: 'table', required: true, maxConnections: 1 },
      { id: 'out', direction: 'output', dataType: 'table', required: true, maxConnections: 1 }
    ],
    validate: node => Array.isArray(node.data.columns) && node.data.columns.length === 0
      ? [{ code: 'NO_COLUMNS', message: 'Select at least one column.' }]
      : []
  });
  r.register({
    type: 'csv-output', titleKey: 'csvOutput', category: 'output',
    createDefaultData: () => ({ filename: 'output', delimiter: 'comma', header: true }),
    getPorts: () => [{ id: 'in', direction: 'input', dataType: 'table', required: true, maxConnections: 1 }],
    validate: node => String(node.data.filename || '').trim()
      ? []
      : [{ code: 'OUTPUT_FILENAME', message: 'Output filename is required.' }]
  });
  return r;
}

function verticalSlice() {
  return Core.createGraph({
    appId: 'data-pipeline-builder', appSchemaVersion: 1,
    nodes: [
      Core.createNode({ id: 'input', type: 'csv-input', position: { x: 40, y: 100 }, data: { delimiter: 'auto', header: true, encoding: 'utf-8' } }),
      Core.createNode({ id: 'select', type: 'select-columns', position: { x: 320, y: 100 }, data: { columns: ['id', 'price'] } }),
      Core.createNode({ id: 'output', type: 'csv-output', position: { x: 600, y: 100 }, data: { filename: 'result', delimiter: 'comma', header: true } })
    ],
    edges: [
      Core.createEdge({ id: 'e1', source: { nodeId: 'input', portId: 'table' }, target: { nodeId: 'select', portId: 'in' } }),
      Core.createEdge({ id: 'e2', source: { nodeId: 'select', portId: 'out' }, target: { nodeId: 'output', portId: 'in' } })
    ]
  });
}

test('v0.1 vertical slice validates with generic Node Editor Core APIs', () => {
  assert.deepEqual(Core.validateGraph(verticalSlice(), { registry: registry() }), []);
});

test('table Port type is owned by the Consumer without Core changes', () => {
  const r = registry();
  const node = r.create('select-columns');
  assert.deepEqual(r.resolvePorts(node).map(p => p.dataType), ['table', 'table']);
});

test('disconnected transform is rejected by generic required Port validation', () => {
  const graph = verticalSlice();
  const broken = { ...graph, edges: graph.edges.filter(edge => edge.id !== 'e1') };
  const codes = Core.validateGraph(broken, { registry: registry() }).map(issue => issue.code);
  assert.ok(codes.includes('REQUIRED_TARGET_PORT'));
});

test('empty Select Columns is rejected by Consumer validation', () => {
  const graph = verticalSlice();
  const broken = Core.applyChange(graph, { type: 'node.data', nodeId: 'select', data: { columns: [] } });
  const issues = Core.validateGraph(broken, { registry: registry() });
  assert.ok(issues.some(issue => issue.code === 'NO_COLUMNS'));
});

test('empty output filename is rejected by Consumer validation', () => {
  const graph = Core.applyChange(verticalSlice(), { type: 'node.data', nodeId: 'output', data: { filename: '' } });
  assert.ok(Core.validateGraph(graph, { registry: registry() }).some(issue => issue.code === 'OUTPUT_FILENAME'));
});

test('graph JSON persists settings but never runtime File objects', () => {
  const graph = verticalSlice();
  const runtime = new Map([['input', { file: { name: 'sales.csv', byteLength: 1234 } }]]);
  const serialized = Core.serializeGraph(graph);
  assert.match(serialized, /"select-columns"/);
  assert.match(serialized, /"result"/);
  assert.doesNotMatch(serialized, /sales\.csv/);
  assert.equal(runtime.get('input').file.name, 'sales.csv');
});

test('graph round-trips through the Core schema', () => {
  const graph = verticalSlice();
  const restored = Core.deserializeGraph(Core.serializeGraph(graph), { registry: registry() });
  assert.deepEqual(restored, graph);
});

test('Core source remains free of Data Pipeline Builder domain branches', () => {
  const corePath = fileURLToPath(new URL('../src/core/node-editor-core.mjs', import.meta.url));
  const source = fs.readFileSync(corePath, 'utf8');
  for (const token of ['csv-input', 'select-columns', 'csv-output', 'read_csv_auto', 'Data Pipeline Builder']) {
    assert.equal(source.includes(token), false, `Core unexpectedly contains Consumer token: ${token}`);
  }
});

test('source template blocks runtime connections and embeds Core at build time', () => {
  const htmlPath = fileURLToPath(new URL('../src/index.template.html', import.meta.url));
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /__NODE_EDITOR_CORE_JS__/);
  assert.match(html, /function parseDelimited/);
  assert.match(html, /function stringifyDelimited/);
  assert.match(html, /let canvas=null/);
  assert.doesNotMatch(html, /ensureDuckDB|read_csv_auto|AsyncDuckDB|arrowRows/);
  assert.match(html, /new NodeEditorCore\.NodeCanvas/);
});


test('language storage access is non-fatal', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /function loadStoredLanguage\(\)\{try\{return localStorage\.getItem/);
  assert.match(html, /function storeLanguage\(value\)\{try\{localStorage\.setItem/);
});

test('NodeCanvas initialization callbacks are guarded before canvas assignment', () => {
  const htmlPath = fileURLToPath(new URL('../src/index.template.html', import.meta.url));
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /let canvas=null;\s*canvas=new NodeEditorCore\.NodeCanvas/);
  assert.match(html, /onSelectionChange:\(\)=>\{if\(!canvas\)return;/);
  assert.match(html, /onChange:\(next,change\)=>\{if\(!canvas\)return;/);
});

test('canvas fills the editor height even after Node Editor Core injects its styles', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /\.canvas-wrap\s*>\s*\.node-canvas\.nec-canvas\{[^}]*position:absolute[^}]*height:100%[^}]*min-height:0/);
});

test('floating expanded workspace is present and preserves all three editor columns', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /id="expandBtn"/);
  assert.match(html, /id="canvasBackdrop"/);
  assert.match(html, /\.workspace\.is-expanded[^}]*position:fixed[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /\.workspace\.is-expanded\s+\.editor-grid\{[^}]*grid-template-columns:230px minmax\(0,1fr\) 300px/);
  assert.match(html, /function setExpanded\(expanded\)/);
  assert.match(html, /viewportBeforeExpand/);
});

test('Japanese UI localizes node names and canvas toolbar labels', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /csvInput:'CSV入力'/);
  assert.match(html, /selectColumns:'列を選択'/);
  assert.match(html, /csvOutput:'CSV出力'/);
  for (const key of ['undo','redo','zoomOut','zoomIn','fitView','fitSelection','expand','restore','gridOn','gridOff','helperOn','helperOff','miniMapOn','miniMapOff']) {
    assert.match(html, new RegExp(`${key}:'`));
  }
  assert.match(html, /function syncToolbarLabels\(\)/);
});

test('expanded workspace updates its accessible toolbar state immediately', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /classList\.toggle\('is-expanded',expanded\);syncToolbar\(\);refreshExpandedCanvas\(expanded\)/);
});

test('English UI keeps English node names after Japanese localization changes', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /en:\{[^\n]*csvInput:'CSV Input'[^\n]*selectColumns:'Select Columns'[^\n]*csvOutput:'CSV Output'/);
});

test('v0.2 preview/schema UI is wired to the shared table utilities', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /__DATA_TABLE_UTILS_JS__/);
  assert.match(html, /DataTableUtils\.inferSchema/);
  assert.match(html, /schema-grid/);
  assert.match(html, /schemaTypeString/);
  assert.match(html, /rowsPreviewed/);
});

test('v0.2 exposes a JSONL Input node without adding domain logic to Node Editor Core', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /data-node-type="jsonl-input"/);
  assert.match(html, /registry\.register\(\{type:'jsonl-input'/);
  assert.match(html, /DataTableUtils\.parseJsonl/);
  const core = fs.readFileSync(new URL('../src/core/node-editor-core.mjs', import.meta.url), 'utf8');
  assert.equal(core.includes('jsonl-input'), false);
});

test('v0.2 icon and favicon use the supplied Data Pipeline Builder artwork', () => {
  const svg = fs.readFileSync(new URL('../assets/favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /viewBox="0 0 1095 1095"/);
  assert.match(svg, /fill="#0c664e"/i);
  assert.match(svg, /id="gear"/);
});

test('standalone build inlines the shared data-table utilities with no runtime import', () => {
  const build = fs.readFileSync(new URL('../build-standalone.ps1', import.meta.url), 'utf8');
  assert.match(build, /DataTableUtilsPath/);
  assert.match(build, /__DATA_TABLE_UTILS_JS__/);
  assert.match(build, /export default DataTableUtils;/);
});

test('v0.2 exposes a Parquet Input node and routes it through the local reader', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /data-node-type="parquet-input"/);
  assert.match(html, /registry\.register\(\{type:'parquet-input'/);
  assert.match(html, /ParquetLite\.readParquetTable/);
  assert.match(html, /accept="\.parquet"/);
  assert.doesNotMatch(html, /duckdb|AsyncDuckDB|read_parquet\(/i);
});

test('standalone build inlines the Parquet reader with no runtime network dependency', () => {
  const build = fs.readFileSync(new URL('../build-standalone.ps1', import.meta.url), 'utf8');
  assert.match(build, /ParquetLitePath/);
  assert.match(build, /__PARQUET_LITE_JS__/);
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /__PARQUET_LITE_JS__/);
  assert.doesNotMatch(html, /cdn\.jsdelivr|unpkg|esm\.sh/);
});

test('release metadata and docs keep Parquet shipped, not pending', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  const notices = fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(pkg.version, /^0\.[4-9]\.\d+$|^[1-9]\d*\./);
  assert.match(app.description, /Parquet/);
  assert.match(app.descriptionJa, /Parquet/);
  assert.match(readme, /CSV \/ TSV \/ JSONL \/ Parquet Input/);
  assert.doesNotMatch(readme, /Parquet.*pending|not enabled/i);
  assert.match(readmeJa, /CSV \/ TSV \/ JSONL \/ Parquet Input/);
  assert.doesNotMatch(readmeJa, /Parquet.*未完了|有効化していません/);
  assert.match(notices, /hyparquet/i);
  assert.match(notices, /snappyjs/i);
});

test('source badge shows a release version without a development suffix', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  assert.match(html, new RegExp(`<span class=\"version\">v${app.version.replaceAll('.', '\\.')}<\\/span>`));
  assert.doesNotMatch(html, /-dev/);
});

test('Select Columns async inspector ignores stale detached hosts', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /catch\(error\)\{if\(token!==columnsGeneration\|\|getSelectedNode\(\)\?\.id!==node\.id\|\|!host\.isConnected\)return;const columnsHost=host\.querySelector\('\[data-columns-host\]'\);if\(!columnsHost\)return;/);
});

test('palette click placement staggers nodes instead of stacking every node at canvas center', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /function paletteClickPosition\(\)/);
  assert.match(html, /else options\.clientPosition=paletteClickPosition\(\)/);
});

test('v0.3 exposes all Basic Transform nodes in the palette and Consumer registry', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const type of ['rename-columns', 'sort', 'limit', 'cast', 'deduplicate']) {
    assert.match(html, new RegExp(`data-node-type="${type}"`));
    assert.match(html, new RegExp(`registry\\.register\\(\\{type:'${type}'`));
  }
  const core = fs.readFileSync(new URL('../src/core/node-editor-core.mjs', import.meta.url), 'utf8');
  for (const type of ['rename-columns', 'sort', 'limit', 'cast', 'deduplicate']) assert.equal(core.includes(`type:'${type}'`) || core.includes(`type: '${type}'`), false);
});

test('v0.3 Basic Transform evaluation delegates to the shared Table Runtime utilities', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const method of ['renameColumns', 'sortRows', 'limitRows', 'castColumns', 'deduplicateRows']) {
    assert.match(html, new RegExp(`DataTableUtils\\.${method}`));
  }
});

test('v0.3 Japanese and English UI contain transform names and settings labels', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const key of ['renameColumns', 'sort', 'limit', 'cast', 'deduplicate']) assert.match(html, new RegExp(`${key}:'`));
  assert.match(html, /renameColumns:'列名を変更'/);
  assert.match(html, /renameColumns:'Rename Columns'/);
});

test('release metadata, help, and docs continue to describe Basic Transform as shipped', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(pkg.version, /^0\.[4-9]\.\d+$|^[1-9]\d*\./);
  assert.match(html, new RegExp(`<span class=\"version\">v${app.version.replaceAll('.', '\\.')}<\\/span>`));
  assert.match(html, /v0\.7\.\d+ supports|v0\.7\.\d+では/);
  assert.match(readme, /Rename Columns/);
  assert.match(readme, /Deduplicate/);
  assert.match(readmeJa, /列名/);
  assert.match(readmeJa, /重複/);
});

test('v0.3 transform rule editors clone graph data before editing so undo snapshots stay intact', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /node\.data\.mappings\)&&node\.data\.mappings\.length\?node\.data\.mappings\.map\(rule=>\(\{\.\.\.rule\}\)\)/);
  assert.match(html, /node\.data\.keys\)&&node\.data\.keys\.length\?node\.data\.keys\.map\(rule=>\(\{\.\.\.rule\}\)\)/);
  assert.match(html, /node\.data\.casts\)&&node\.data\.casts\.length\?node\.data\.casts\.map\(rule=>\(\{\.\.\.rule\}\)\)/);
});

test('preview input reads do not overwrite run status messages', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function readInputNode');
  const end = html.indexOf('async function evaluateData', start);
  assert.ok(start >= 0 && end > start);
  const body = html.slice(start, end);
  assert.doesNotMatch(body, /setStatus\(/);
});

test('v0.4 exposes Filter Rows and Null Handling nodes in palette and registry', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const type of ['filter-rows', 'null-handling']) {
    assert.match(html, new RegExp(`data-node-type="${type}"`));
    assert.match(html, new RegExp(`registry\\.register\\(\\{type:'${type}'`));
  }
});

test('v0.4 evaluation delegates Filter Rows and Null Handling to shared Table Runtime utilities', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /DataTableUtils\.filterRows/);
  assert.match(html, /DataTableUtils\.handleNulls/);
});

test('v0.4 UI contains AND OR filter builder, all documented operators, and Null handling settings in Japanese and English', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const key of ['filterRows','nullHandling','filterAnd','filterOr','filterContains','filterStartsWith','filterEndsWith','filterIsNull','filterIsNotNull','nullRemove','nullReplace']) {
    assert.match(html, new RegExp(`${key}:'`));
  }
  assert.match(html, /filterRows:'行を絞り込む'/);
  assert.match(html, /filterRows:'Filter Rows'/);
  assert.match(html, /nullHandling:'欠損値を処理'/);
  assert.match(html, /nullHandling:'Null Handling'/);
});

test('Filter and Null Handling remain shipped in later releases', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(html, new RegExp(`<span class=\"version\">v${pkg.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(readme, /Filter Rows/);
  assert.match(readme, /Null Handling/);
  assert.match(readmeJa, /行を絞り込/);
  assert.match(readmeJa, /欠損値/);
});

test('v0.5 exposes Join and Union nodes with dedicated multi-input ports', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /type:'join'/);
  assert.match(html, /id:'left'.*direction:'input'/s);
  assert.match(html, /id:'right'.*direction:'input'/s);
  assert.match(html, /type:'union'/);
  assert.match(html, /unionInputPorts/);
  assert.match(html, /inputCount/);
});

test('v0.5 Join and Union evaluation use port-specific upstream inputs', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /incomingSourceByPort/);
  assert.match(html, /DataTableUtils\.joinTables/);
  assert.match(html, /DataTableUtils\.unionTables/);
  assert.match(html, /node\.type==='join'/);
  assert.match(html, /node\.type==='union'/);
});

test('v0.5 Union supports 2 to 6 inputs and confirms before removing connected ports', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /Math\.max\(2,Math\.min\(6/);
  assert.match(html, /unionRemoveConnectionsConfirm/);
  assert.match(html, /edge\.target\.portId/);
  assert.match(html, /await askConfirm/);
});

test('v0.5 Japanese and English UI expose Join, Union, join types, and schema mismatch guidance', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const token of ['joinType','joinInner','joinLeft','joinRight','joinFull','joinKeys','unionMode','unionByName','unionByPosition','schemaMismatch']) {
    assert.match(html, new RegExp(`${token}:`));
  }
  assert.match(html, /結合/);
  assert.match(html, /スキーマ/);
  assert.match(html, /Schema mismatch/);
});

test('Join and Union remain shipped in later releases', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const config = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(packageJson.version, config.version);
  assert.match(html, new RegExp(`<span class=\"version\">v${packageJson.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(readme, /Join/);
  assert.match(readme, /Union/);
  assert.match(readmeJa, /結合/);
  assert.match(readmeJa, /縦に連結/);
});

test('v0.6 exposes Group By in the palette and Consumer registry', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /data-node-type="group-by"/);
  assert.match(html, /registry\.register\(\{type:'group-by'/);
  const core = fs.readFileSync(new URL('../src/core/node-editor-core.mjs', import.meta.url), 'utf8');
  assert.equal(core.includes("type:'group-by'") || core.includes("type: 'group-by'"), false);
});

test('v0.6 Group By evaluation uses the full upstream table and shared aggregate runtime', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /DataTableUtils\.groupByAggregate/);
  assert.match(html, /node\.type==='group-by'/);
  assert.match(html, /node\.type==='group-by'[^?]*\?Infinity:limit|group-by[^\n]{0,220}Infinity/s);
});

test('v0.6 Group By inspector supports multiple group columns and aggregate rules in Japanese and English', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const key of ['groupBy','groupByHint','groupColumns','aggregates','aggregateCount','aggregateSum','aggregateAverage','aggregateMin','aggregateMax','aggregateOutput','addAggregate']) {
    assert.match(html, new RegExp(`${key}:'`));
  }
  assert.match(html, /groupBy:'グループ集計'/);
  assert.match(html, /groupBy:'Group By'/);
  assert.match(html, /function renderGroupByInspector/);
  assert.match(html, /data-add-aggregate/);
});

test('Group By and Aggregate remain shipped in later releases', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(html, new RegExp(`<span class=\"version\">v${pkg.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(readme, /Group By/);
  assert.match(readme, /Average/);
  assert.match(readmeJa, /グループ/);
  assert.match(readmeJa, /平均/);
});

test('v0.7 exposes CSV, JSONL, and Parquet output nodes plus Run All Outputs result list UI', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const type of ['csv-output', 'jsonl-output', 'parquet-output']) {
    assert.match(html, new RegExp(`data-node-type="${type}"`));
    assert.match(html, new RegExp(`type:'${type}'`));
  }
  assert.match(html, /data-i18n="runAllOutputs"/);
  assert.match(html, /id="resultsBtn"/);
  assert.match(html, /id="resultsDialog"/);
  assert.match(html, /function renderResultsList\(/);
});

test('v0.7 runtime validates and runs all output node types without auto-downloading', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /const OUTPUT_TYPES=new Set\(\['csv-output','jsonl-output','parquet-output'\]\)/);
  assert.match(html, /graph\.nodes\.filter\(n=>OUTPUT_TYPES\.has\(n\.type\)\)/);
  assert.match(html, /async function createOutputResult\(output,data\)/);
  assert.match(html, /DataTableUtils\.stringifyJsonl\(data\)/);
  assert.match(html, /ParquetWriteLite\.writeParquetTable\(data\)/);
  const runBody = html.slice(html.indexOf('async function runPipeline()'), html.indexOf('function markUpstreamStatus'));
  assert.doesNotMatch(runBody, /a\.click\(/);
});

test('v0.7 table-producing nodes allow fan-out so one result can feed multiple outputs', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const type of ['csv-input','jsonl-input','parquet-input','select-columns','rename-columns','sort','limit','cast','deduplicate','filter-rows','null-handling','group-by','join']) {
    const line = html.split('\n').find(value => value.includes(`type:'${type}'`));
    assert.ok(line, `missing registry line for ${type}`);
    assert.doesNotMatch(line, /direction:'output'[^}]*maxConnections:1/, `${type} output must support fan-out`);
  }
  const unionLine = html.split('\n').find(value => value.includes('function unionInputPorts'));
  assert.ok(unionLine);
  assert.doesNotMatch(unionLine, /id:'out'[^}]*maxConnections:1/, 'Union output must support fan-out');
});

test('v0.7 standalone build inlines the lightweight Parquet writer', () => {
  const ps1 = fs.readFileSync(new URL('../build-standalone.ps1', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(ps1, /ParquetWriteLitePath/);
  assert.match(ps1, /__PARQUET_WRITE_LITE_JS__/);
  assert.match(html, /__PARQUET_WRITE_LITE_JS__/);
});

test('multi-format outputs remain shipped in later releases', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  const first = fs.readFileSync(new URL('../README-FIRST.txt', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(html, new RegExp(`<span class=\"version\">v${pkg.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(readme, /JSONL Output/);
  assert.match(readme, /Parquet Output/);
  assert.match(readme, /Run all outputs/i);
  assert.match(readmeJa, /JSONL出力/);
  assert.match(readmeJa, /Parquet出力/);
  assert.match(readmeJa, /すべての出力/);
  assert.match(first, new RegExp(`v${pkg.version.replace(/\./g,'\\.')}`));
});


test('v0.7.1 enlarged preview closes when the dialog backdrop itself is clicked', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /\$\('previewDialog'\)\.addEventListener\('click',\s*e=>\{if\(e\.target===\$\('previewDialog'\)\)\$\('previewDialog'\)\.close\(\)\}\)/);
});

test('v0.7.1 UI and docs describe Snappy-compressed Parquet output', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.match(html, /Snappy/);
  assert.doesNotMatch(html, /Parquet出力は互換性を優先した非圧縮/);
  assert.doesNotMatch(html, /uncompressed (?:Parquet|format) for compatibility/i);
  assert.match(readme, /Snappy/i);
  assert.match(readmeJa, /Snappy/);
});

test('v0.8 exposes Pipeline JSON and Recipe / Quick Recipe controls', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  for (const id of ['recipeShelf','saveRecipeBtn','savePipelineBtn','openPipelineBtn','pipelineFileInput','recipeNameDialog','recipeResultsDialog']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  for (const key of ['quickRecipes','saveRecipe','savePipeline','openPipeline','applyRecipeToCanvas','useRecipe','deleteRecipe']) {
    assert.match(html, new RegExp(`${key}:`), `missing i18n key ${key}`);
  }
});

test('v0.8 persists recipes locally without persisting selected input files', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /RECIPE_STORAGE_KEY/);
  assert.match(html, /localStorage\.getItem\(RECIPE_STORAGE_KEY\)/);
  assert.match(html, /localStorage\.setItem\(RECIPE_STORAGE_KEY/);
  assert.match(html, /RecipeUtils\.sanitizeGraph/);
  assert.match(html, /quickRecipeFiles/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*quickRecipeFiles/);
});

test('v0.8 Quick Recipe can apply to Canvas or execute against an isolated graph', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /async function applyRecipeToCanvas\(/);
  assert.match(html, /await askConfirm\(t\('applyRecipeConfirm'\)\)/);
  assert.match(html, /async function runQuickRecipe\(/);
  assert.match(html, /evaluateDataInGraph\(/);
  assert.match(html, /validateGraphRuntime\(/);
  assert.match(html, /renderRecipeResults/);
});

test('v0.8 pipeline JSON open replaces the Canvas only after confirmation and clears runtime files', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /async function openPipelineFile\(/);
  assert.match(html, /await askConfirm\(t\('openPipelineConfirm'\)\)/);
  assert.match(html, /canvas\.setGraph\(/);
  assert.match(html, /fileRuntime\.clear\(\)/);
  assert.match(html, /invalidateOutputs\(\)/);
});

test('v0.8 standalone build inlines Recipe utilities with no runtime import', () => {
  const ps1 = fs.readFileSync(new URL('../build-standalone.ps1', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(ps1, /RecipeUtilsPath/);
  assert.match(ps1, /__RECIPE_UTILS_JS__/);
  assert.match(html, /__RECIPE_UTILS_JS__/);
});

test('v0.8 release metadata and docs describe Recipe reuse as shipped', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(html, new RegExp(`<span class="version">v${pkg.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(readme, /Recipe/i);
  assert.match(readme, /Pipeline JSON/i);
  assert.match(readmeJa, /Recipe/);
  assert.match(readmeJa, /Pipeline JSON/);
});

test('v0.8.1 canvas toolbar delete uses the Node Editor Core action-id callback contract and destructive confirmation', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /onNodeToolbarAction:async\(actionId[\s\S]*actionId==='delete'/);
  assert.match(html, /askConfirm\(t\('deleteNodeConfirm'\),\{confirmLabel:t\('delete'\),danger:true\}\)/);
});

test('v0.8.1 Delete key uses a visible destructive Delete action', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /keydown'[\s\S]*askConfirm\(t\('deleteNodeConfirm'\),\{confirmLabel:t\('delete'\),danger:true\}\)/);
  assert.match(html, /#confirmDialog \.dialog-confirm\{[^}]*background:var\(--accent\)[^}]*color:#fff/);
  assert.match(html, /#confirmDialog\.is-danger \.dialog-confirm\{[^}]*background:var\(--danger\)/);
});

test('v0.8.1 confirmation dialog has a compact dedicated layout and backdrop cancel', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /class="confirm-content"/);
  assert.match(html, /class="confirm-icon"/);
  assert.match(html, /#confirmDialog\{[^}]*max-width:min\(440px/);
  assert.match(html, /\$\('confirmDialog'\)\.addEventListener\('click',[\s\S]*e\.target===\$\('confirmDialog'\)/);
});

test('v0.8.1 Quick Recipe input accepts files by drag and drop as well as file picker', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /recipeDropFile:/);
  assert.match(html, /function assignRecipeInputFile\(/);
  assert.match(html, /row\.addEventListener\('dragover'/);
  assert.match(html, /row\.addEventListener\('drop'/);
  assert.match(html, /e\.dataTransfer\?\.files\?\.\[0\]/);
  assert.match(html, /className='recipe-input-drop'/);
});

test('v0.8.1 release metadata and docs describe the UX patch', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  assert.equal(pkg.version, app.version);
  assert.match(html, new RegExp(`<span class="version">v${pkg.version.replace(/\./g,'\\.')}<\/span>`));
  assert.match(changelog, /## 0\.8\.1/);
  assert.match(readmeJa, /ドラッグ|ドロップ/);
});

test('v1.0.0 stable release metadata and release documentation are synchronized', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeJa = fs.readFileSync(new URL('../README.ja.md', import.meta.url), 'utf8');
  const first = fs.readFileSync(new URL('../README-FIRST.txt', import.meta.url), 'utf8');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(app.version, '1.0.0');
  assert.match(html, /<span class="version">v1\.0\.0<\/span>/);
  assert.match(html, /helpFormatsBody:'v1\.0\.0/);
  assert.match(changelog, /## 1\.0\.0 - 2026-09-17/);
  assert.match(readme, /## 🚀 Live demo/);
  assert.match(readme, /assets\/screenshot-en\.png/);
  assert.match(readmeJa, /## 🚀 デモ/);
  assert.match(readmeJa, /assets\/screenshot\.png/);
  assert.match(first, /v1\.0\.0/);
  assert.ok(fs.existsSync(new URL('../assets/screenshot.png', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../assets/screenshot-en.png', import.meta.url)));
});

test('v0.9.0 localizes help and dialog close accessible names with the active language', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /help:'使い方'/);
  assert.match(html, /help:'Help'/);
  assert.match(html, /setButtonLabel\('helpBtn',t\('help'\)\)/);
  assert.match(html, /document\.querySelector\('\[data-recipe-name-cancel\]'\)\?\.setAttribute\('aria-label',t\('close'\)\)/);
});

test('v0.9.0 help dialog closes on backdrop click and UI honors reduced-motion preference', () => {
  const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /\$\('helpDialog'\)\.addEventListener\('click',e=>\{if\(e\.target===\$\('helpDialog'\)\)\$\('helpDialog'\)\.close\(\)\}\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /animation-duration:\.01ms!important/);
  assert.match(html, /transition-duration:\.01ms!important/);
});

test('v0.9.0 self-extract loader also honors reduced-motion preference', () => {
  const ps1 = fs.readFileSync(new URL('../scripts/build-self-extract.ps1', import.meta.url), 'utf8');
  assert.match(ps1, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(ps1, /\.spinner \{ animation: none; \}/);
});
