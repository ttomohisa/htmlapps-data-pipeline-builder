import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import DataTableUtils from '../src/data-table-utils.mjs';
import Core from '../src/core/node-editor-core.mjs';
import RecipeUtils from '../src/recipe-utils.mjs';

const table = values => ({ columns: ['key', 'untouched'], rows: values.map((key, i) => ({ key, untouched: ` Row ${i} ` })) });

test('Clean Text defaults to trimming selected strings and preserves row/column order and metadata', () => {
  const input = { ...table([' A ', '\tB\r\n', '', '   ', '\u00a0\u3000C\uFEFF']), totalRows: 5 };
  const output = DataTableUtils.cleanText(input, { columns: ['key'] });
  assert.deepEqual(output.rows.map(row => row.key), ['A', 'B', '', '', 'C']);
  assert.deepEqual(output.rows.map(row => row.untouched), input.rows.map(row => row.untouched));
  assert.deepEqual(output.columns, input.columns);
  assert.equal(output.totalRows, 5);
});

test('Clean Text applies standard Unicode case conversion after trim without locale or compatibility normalization', () => {
  const input = table([' İSTANBUL ', ' Straße ', ' ＡＢＣ ', ' ÉCOLE ', ' 日本語 ', '\u200B A \u200B']);
  assert.deepEqual(DataTableUtils.cleanText(input, { columns: ['key'], caseMode: 'lowercase' }).rows.map(row => row.key),
    ['i\u0307stanbul', 'straße', 'ａｂｃ', 'école', '日本語', '\u200B a \u200B']);
  assert.deepEqual(DataTableUtils.cleanText(table([' straße ', ' é ', ' e\u0301 ']), { columns: ['key'], caseMode: 'uppercase', trim: false }).rows.map(row => row.key),
    [' STRASSE ', ' É ', ' E\u0301 ']);
});

test('Clean Text changes only strings, never mutates upstream rows, and supports multiple selected columns', () => {
  const input = table([null, 0, 3.5, false, true, undefined, { nested: ' x ' }, [' x '], ' abc ']);
  Object.freeze(input.columns);
  input.rows.forEach(Object.freeze);
  Object.freeze(input.rows);
  Object.freeze(input);
  const output = DataTableUtils.cleanText(input, { columns: ['key', 'untouched'], caseMode: 'uppercase' });
  assert.notEqual(output, input);
  assert.notEqual(output.columns, input.columns);
  assert.notEqual(output.rows, input.rows);
  output.rows.forEach((row, i) => {
    assert.notEqual(row, input.rows[i]);
    assert.equal(row.key, i === 8 ? 'ABC' : input.rows[i].key);
    assert.equal(row.untouched, `ROW ${i}`);
  });
  assert.equal(input.rows[8].key, ' abc ');
});

test('Clean Text rejects empty selection, missing columns and malformed case settings even for empty data', () => {
  for (const columns of [[], null, undefined, 'key']) {
    assert.throws(() => DataTableUtils.cleanText(table([]), { columns }), error => error.code === 'INVALID_CLEAN_TEXT');
  }
  assert.throws(() => DataTableUtils.cleanText(table([]), { columns: ['missing'] }), error => error.code === 'COLUMN_NOT_FOUND' && error.column === 'missing');
  assert.throws(() => DataTableUtils.cleanText(table([]), { columns: ['key'], caseMode: 'titlecase' }), error => error.code === 'INVALID_CLEAN_TEXT');
  assert.deepEqual(DataTableUtils.cleanText(table([]), { columns: ['key'] }), table([]));
});

test('Clean Text with both operations disabled is a nonmutating no-op', () => {
  const input = table([' A ', 'Ｂ']);
  assert.deepEqual(DataTableUtils.cleanText(input, { columns: ['key'], trim: false, caseMode: 'unchanged' }), input);
});

test('Clean Text prepares matching keys for deduplication and joins without changing the original table', () => {
  const input = table([' Alice ', 'ALICE', ' Bob ']);
  const clean = DataTableUtils.cleanText(input, { columns: ['key'], caseMode: 'lowercase' });
  const deduped = DataTableUtils.deduplicateRows(clean, ['key']);
  assert.deepEqual(deduped.rows.map(row => row.key), ['alice', 'bob']);
  const joined = DataTableUtils.joinTables(deduped, { columns: ['id', 'region'], rows: [{ id: 'alice', region: 'East' }, { id: 'bob', region: 'West' }] }, { type: 'inner', keys: [{ left: 'key', right: 'id' }] });
  assert.deepEqual(joined.rows.map(row => row.region), ['East', 'West']);
  assert.deepEqual(input.rows.map(row => row.key), [' Alice ', 'ALICE', ' Bob ']);
});

const html = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
function appRegistry() {
  const start = html.indexOf('const registry=new NodeEditorCore.NodeRegistry();');
  const end = html.indexOf('const graph=NodeEditorCore.createGraph', start);
  return new Function('NodeEditorCore', 't', `${html.slice(start, end)};return registry;`)(Core, key => key);
}
function appEvaluator() {
  const functions = ['incomingSourceByPortInGraph', 'incomingSourceInGraph', 'evaluateDataInGraph'].map(name => html.split('\n').find(line => new RegExp(`(?:async )?function ${name}\\(`).test(line))).join('\n');
  return new Function('NodeEditorCore', 'DataTableUtils', 'readInputNodeFromRuntime', 't', `${functions};return evaluateDataInGraph;`)(Core, DataTableUtils, async (node, runtime, limit) => ({ ...runtime.get(node.id), rows: runtime.get(node.id).rows.slice(0, limit) }), key => key);
}
function cleanGraph() {
  return Core.createGraph({ nodes: [
    Core.createNode({ id: 'input', type: 'csv-input' }),
    Core.createNode({ id: 'clean', type: 'clean-text', data: { columns: ['key'], trim: true, caseMode: 'lowercase' } }),
    Core.createNode({ id: 'dedup', type: 'deduplicate', data: { mode: 'selected', columns: ['key'] } }),
    Core.createNode({ id: 'output', type: 'csv-output', data: { filename: 'cleaned' } })
  ], edges: [
    Core.createEdge({ id: 'e1', source: { nodeId: 'input', portId: 'table' }, target: { nodeId: 'clean', portId: 'in' } }),
    Core.createEdge({ id: 'e2', source: { nodeId: 'clean', portId: 'out' }, target: { nodeId: 'dedup', portId: 'in' } }),
    Core.createEdge({ id: 'e3', source: { nodeId: 'dedup', portId: 'out' }, target: { nodeId: 'output', portId: 'in' } })
  ] });
}

test('Clean Text production registry exposes defaults, one table input/output and empty-column validation', () => {
  const registry = appRegistry();
  const node = registry.create('clean-text');
  assert.deepEqual(node.data, { columns: [], trim: true, caseMode: 'unchanged' });
  assert.deepEqual(registry.resolvePorts(node).map(port => [port.direction, port.dataType]), [['input', 'table'], ['output', 'table']]);
  assert.ok(Core.validateGraph(Core.createGraph({ nodes: [node] }), { registry }).some(issue => issue.code === 'CLEAN_TEXT_COLUMNS'));
  assert.equal(Core.validateGraph(cleanGraph(), { registry }).length, 0);
});

test('Clean Text production evaluator transforms before full-data deduplication and reports missing-column node', async () => {
  const input = table([' Alice ', 'ALICE', ' Bob ']);
  const runtime = new Map([['input', input]]);
  const evaluate = appEvaluator();
  assert.deepEqual((await evaluate(cleanGraph(), 'dedup', runtime, 1)).rows.map(row => row.key), ['alice', 'bob']);
  const broken = Core.applyChange(cleanGraph(), { type: 'node.data', nodeId: 'clean', data: { columns: ['missing'] } });
  await assert.rejects(evaluate(broken, 'clean', runtime), error => error.code === 'COLUMN_NOT_FOUND' && error.nodeId === 'clean');
  assert.equal(input.rows[0].key, ' Alice ');
});

test('Clean Text settings survive Pipeline JSON and Recipe roundtrip and still execute', async () => {
  const graph = cleanGraph();
  const pipeline = RecipeUtils.parsePipeline(RecipeUtils.stringifyPipeline(graph));
  const recipe = RecipeUtils.makeRecipe({ name: 'Clean keys', graph: pipeline });
  const restored = RecipeUtils.normalizeRecipes(JSON.parse(JSON.stringify([recipe])))[0];
  assert.deepEqual(restored.graph.nodes.find(node => node.id === 'clean').data, { columns: ['key'], trim: true, caseMode: 'lowercase' });
  assert.deepEqual((await appEvaluator()(restored.graph, 'clean', new Map([['input', table([' Alice '])]]))).rows.map(row => row.key), ['alice']);
});

test('Clean Text settings use consumer history dispatch and support undo/redo without mutating old settings', () => {
  assert.match(html, /data-setting="trim"/);
  assert.match(html, /data-setting="caseMode"/);
  assert.match(html, /data-clean-text-column/);
  const original = cleanGraph();
  const history = new Core.GraphHistory();
  history.capture(original);
  const changed = Core.applyChange(original, { type: 'node.data', nodeId: 'clean', data: { trim: false, caseMode: 'uppercase', columns: ['untouched'] } });
  const undone = history.undo(changed).graph;
  assert.deepEqual(Core.getNode(undone, 'clean').data, Core.getNode(original, 'clean').data);
  assert.deepEqual(Core.getNode(history.redo(undone).graph, 'clean').data, Core.getNode(changed, 'clean').data);
});

test('Clean Text palette, inspector and labels are present in both supported languages', () => {
  assert.match(html, /data-node-type="clean-text"/);
  assert.match(html, /renderCleanTextInspector\(node,host\)/);
  assert.match(html, /cleanText:'文字列を整える'/);
  assert.match(html, /cleanText:'Clean Text'/);
});

test('Clean Text validation points to the node with its localized error instead of generic connection advice', () => {
  const registry = appRegistry();
  const source = html.split('\n').find(line => line.includes('function validateGraphRuntime('));
  const validate = new Function('NodeEditorCore', 'registry', 'OUTPUT_TYPES', 't', `${source};return validateGraphRuntime;`)(Core, registry, new Set(['csv-output']), key => key);
  const invalid = Core.applyChange(cleanGraph(), { type: 'node.data', nodeId: 'clean', data: { columns: [] } });
  assert.deepEqual(validate(invalid, new Map()), { ok: false, message: 'cleanTextNeedsColumn', nodeId: 'clean' });
});

test('Clean Text column editor retains missing selections until explicitly unchecked and dispatches copied settings', () => {
  const start = html.indexOf('function renderCleanTextColumns(');
  const end = html.indexOf('async function renderDeduplicateInspector', start);
  const patches = [];
  const render = new Function('escapeHtml', 't', 'patchNodeData', `${html.slice(start, end)};return renderCleanTextColumns;`)(value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), key => key, (nodeId, data) => patches.push({ nodeId, data }));
  const checks = ['key', 'missing'].map(column => ({ dataset: { cleanTextColumn: column }, checked: column === 'missing', addEventListener(type, callback) { this.change = callback; } }));
  const host = { innerHTML: '', querySelectorAll() { return checks; } };
  const columns = Object.freeze(['missing']);
  const node = { id: 'clean', data: Object.freeze({ columns }) };
  render(node, host, ['key', 'x<"']);
  assert.match(host.innerHTML, /missing \(cleanTextMissing\)/);
  assert.match(host.innerHTML, /x&lt;&quot;/);
  checks[0].checked = true;
  checks[0].change();
  assert.deepEqual(patches[0], { nodeId: 'clean', data: { columns: ['missing', 'key'] } });
  checks[1].checked = false;
  checks[1].change();
  assert.deepEqual(patches[1].data.columns, ['key']);
  assert.deepEqual(columns, ['missing']);
});

test('Run validation surfaces Clean Text selection and case errors through the actual canvas validation entry point', () => {
  const registry = appRegistry();
  const source = ['validateGraphRuntime', 'validateRuntime'].map(name => html.split('\n').find(line => line.includes(`function ${name}(`))).join('\n');
  for (const [data, message] of [[{ columns: [] }, 'cleanTextNeedsColumn'], [{ caseMode: 'titlecase' }, 'cleanTextInvalid']]) {
    const graph = Core.applyChange(cleanGraph(), { type: 'node.data', nodeId: 'clean', data });
    const canvas = { getGraph: () => graph, validateGraph: () => Core.createValidationResult(graph, { registry }) };
    const validate = new Function('NodeEditorCore', 'registry', 'OUTPUT_TYPES', 't', 'canvas', 'fileRuntime', `${source};return validateRuntime;`)(Core, registry, new Set(['csv-output']), key => key, canvas, new Map());
    assert.deepEqual(validate(), { ok: false, message, nodeId: 'clean' });
  }
});
