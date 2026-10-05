import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import DataTableUtils from '../src/data-table-utils.mjs';
import ParquetWriteLite from '../src/parquet-write-lite.mjs';

const html = fs.readFileSync(process.env.OUTPUT_FILENAME_HTML || new URL('../src/index.template.html', import.meta.url), 'utf8');
const functionSource = names => names.map(name => html.split('\n').find(line => new RegExp(`^    (?:async )?function ${name}\\(`).test(line)) || '').join('\n');
function outputFactory() {
  const blobUrls = new Set();
  const source = functionSource(['safeFilename', 'finalizeOutputFilename', 'delimiterValue', 'csvEscape', 'stringifyDelimited', 'schemaForPreview', 'createOutputResult']);
  const factory = new Function('DataTableUtils', 'ParquetWriteLite', 'blobUrls', `${source}; return createOutputResult;`)(DataTableUtils, ParquetWriteLite, blobUrls);
  return { create: factory, cleanup() { for (const url of blobUrls) URL.revokeObjectURL(url); } };
}
const formats = ['csv', 'jsonl', 'parquet'];
// Golden bytes generated from main 38fee3c, including distinct empty-string and Null rows.
const baselineHashes = { csv: '063826d785dcaeccbb5fc650515d22c0ff54a338470a4588562e5ac4686b5c1f', jsonl: '113b331853e6430f54de5d6da95203541456fed8926067dd0d3cc9a0befbaac4', parquet: 'c12b7fbeee067e8e1d5f5f56878e3d5f169b195bc7722fda298f0ef44ea29036' };
const data = { columns: ['id', 'label'], rows: [{ id: 1, label: '日本語' }, { id: 2, label: '' }, { id: 3, label: null }] };

for (const format of formats) {
  test(`${format} generation normalizes only a terminal supported extension and preserves data`, async () => {
    const factory = outputFactory();
    try {
      const before = JSON.stringify(data);
      const baseline = await factory.create({ type: `${format}-output`, data: { filename: 'report' } }, data);
      assert.equal(crypto.createHash('sha256').update(baseline.bytes).digest('hex'), baselineHashes[format]);
      for (const [name, expected] of [
        ['report', `report.${format}`], ['report.CsV', `report.${format}`], ['report.JsOnL', `report.${format}`], ['report.PARQUET', `report.${format}`],
        ['quarter.csv.backup', `quarter.csv.backup.${format}`], ['日本語.2026', `日本語.2026.${format}`],
        ['', `output.${format}`], ['   ... ', `output.${format}`], [`.${format}`, `output.${format}`],
        [' sales<>:"/\\|?*\u0000. ', `sales----------.${format}`], ['x'.repeat(140) + '.JSONL', `${'x'.repeat(120)}.${format}`]
      ]) {
        const output = await factory.create({ type: `${format}-output`, data: { filename: name } }, data);
        assert.equal(output.filename, expected, name);
        assert.deepEqual(output.bytes, baseline.bytes, 'renaming must not change exported bytes');
        assert.deepEqual(output.preview, baseline.preview);
        assert.equal(output.rows, data.rows.length);
        assert.equal(output.columns, data.columns.length);
        assert.equal(output.format, format.toUpperCase());
      }
      assert.equal(JSON.stringify(data), before);
    } finally { factory.cleanup(); }
  });
}

test('the existing Output setting sanitizer retains its seed semantics', () => {
  const safe = new Function(`${functionSource(['safeFilename'])};return safeFilename;`)();
  assert.equal(safe('report.JSONL'), 'report.JSONL');
  assert.equal(safe('report.CSV'), 'report');
  assert.equal(safe(''), 'output');
  assert.equal(safe('a'.repeat(121)), 'a'.repeat(120));
});

// Minimal DOM boundary for production renderers and their actual input/click handlers.
class Element {
  constructor(tag, downloads) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.downloads = downloads; this.value = ''; this.textContent = ''; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {} }); }
  click() { if (this.tagName === 'a') this.downloads.push({ filename: this.download, url: this.href }); this.fire('click'); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? (node.className || '').split(' ').includes(selector.slice(1)) : selector.startsWith('[') ? (() => { const [, key, value] = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector); const actual = key.startsWith('data-') ? node.dataset[key.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] : node.attributes[key]; return actual !== undefined && (value === undefined || actual === value); })() : node.tagName === selector;
    return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(value) {
    this.replaceChildren();
    // The inspector is existing template HTML; controls can be flattened for event testing.
    for (const [, tag, attrs] of value.matchAll(/<(input|select|button|div)\b([^>]*)>/g)) {
      const node = new Element(tag, this.downloads);
      for (const [, key, val] of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) { node.setAttribute(key, val ?? ''); if (['value', 'type', 'class'].includes(key)) node[key === 'class' ? 'className' : key] = val; }
      this.append(node);
    }
  }
}
function uiHarness() {
  const downloads = [];
  const document = { createElement: tag => new Element(tag, downloads) };
  document.body = document.createElement('body');
  document.documentElement = {};
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  const hosts = Object.fromEntries(['resultsList', 'recipeResultsList', 'recipeResultsTitle', 'inspector', 'langBtn'].map(id => [id, document.createElement('div')]));
  document.body.append(...Object.values(hosts));
  const outputResults = new Map(), activeRecipeResults = new Map();
  const nodes = formats.map(format => Object.freeze({ id: format, type: `${format}-output`, data: Object.freeze({ filename: `${format}-seed`, delimiter: 'comma', header: true }) }));
  const graph = Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze([]) });
  const canvas = { getGraph: () => graph, setGraph() {} };
  const translations = html.slice(html.indexOf('const I18N='), html.indexOf('function loadStoredLanguage'));
  const source = functionSource(['safeFilename', 'finalizeOutputFilename', 'formatBytes', 'escapeHtml', 'outputSaveLabel', 'syncResultFilename', 'createResultFilenameField', 'saveGeneratedResult', 'renderResultsList', 'renderRecipeResults', 'renderOutputInspector', 'saveOutput', 'saveRecipeOutput', 'applyLanguage']);
  const forbidden = () => { throw new Error('Filename editing must not change persistent state or rerun the pipeline'); };
  const make = new Function('document', '$', 'canvas', 'outputResults', 'activeRecipeResults', 'patchNodeData', 'persistRecipes', 'evaluateData', 'createOutputResult', `${translations}
    let lang='en'; const t=key=>I18N[lang][key]??key; ${html.split('\n').find(line => line.includes('const resultFilenameInputs='))}
    const OUTPUT_TYPES=new Set(['csv-output','jsonl-output','parquet-output']); const activeRecipeName='Recipe';
    const renderInspector=()=>renderOutputInspector(canvas.getGraph().nodes[0],$('inspector')); const renderRecipeShelf=()=>{};const updateSelectionLabel=()=>{};const syncStatus=()=>{};const syncToolbarLabels=()=>{};
    const toast=()=>{}; const settingsHeader=()=>''; const previewSkeleton=()=>''; const wirePreview=()=>{};
    ${source}
    return {renderResultsList,renderRecipeResults,renderOutputInspector,saveOutput,saveRecipeOutput,applyLanguage,setLanguage(value){lang=value}};`);
  const api = make(document, id => hosts[id], canvas, outputResults, activeRecipeResults, forbidden, forbidden, forbidden, forbidden);
  return { ...api, document, downloads, hosts, nodes, graph, outputResults, activeRecipeResults };
}
const field = host => { const input = host.querySelector('[data-result-filename]'); assert.ok(input, 'generated result must have an editable save filename'); return input; };
const saveButton = host => { const button = host.querySelector('.save-btn'); assert.ok(button); return button; };

for (const surface of ['list', 'inspector', 'recipe']) {
  test(`${surface} saves the latest draft without blur, reuses the Blob, and does not change settings`, async () => {
    const factory = outputFactory();
    try {
      const ui = uiHarness();
      const node = ui.nodes[1];
      const result = await factory.create(node, data);
      const original = { ...result };
      const map = surface === 'recipe' ? ui.activeRecipeResults : ui.outputResults;
      map.set(node.id, result);
      const render = () => surface === 'list' ? ui.renderResultsList() : surface === 'recipe' ? ui.renderRecipeResults({ name: 'Saved recipe' }) : ui.renderOutputInspector(node, ui.hosts.inspector);
      const host = surface === 'list' ? ui.hosts.resultsList : surface === 'recipe' ? ui.hosts.recipeResultsList : ui.hosts.inspector;
      render();
      const input = field(host);
      assert.equal(input.type, 'text');
      assert.equal(input.value, 'jsonl-seed.jsonl');
      input.value = '  変更<>.PARQUET  ';
      input.fire('input');
      saveButton(host).click();
      assert.deepEqual(ui.downloads, [{ filename: '変更--.jsonl', url: original.url }]);
      assert.equal(input.value, '変更--.jsonl');
      for (const key of ['filename', 'bytes', 'url', 'rows', 'columns', 'preview', 'format', 'mime']) assert.equal(result[key], original[key], key);
      assert.equal(node.data.filename, 'jsonl-seed');
      assert.equal(ui.graph.nodes, ui.nodes);
      render();
      assert.equal(field(host).value, '変更--.jsonl', 'reopening keeps this run’s name');
      ui.setLanguage('ja'); render();
      assert.equal(field(host).value, '変更--.jsonl');
      assert.match(host.querySelector('.result-filename').textContent || host.querySelector('.result-filename').querySelector('span')?.textContent || '', /保存/);
    } finally { factory.cleanup(); }
  });

  test(`${surface} rejects stale input and save callbacks after same-node result replacement`, async () => {
    const factory = outputFactory();
    try {
      const ui = uiHarness(), node = ui.nodes[0];
      const map = surface === 'recipe' ? ui.activeRecipeResults : ui.outputResults;
      const old = await factory.create(node, data); map.set(node.id, old);
      const render = () => surface === 'list' ? ui.renderResultsList() : surface === 'recipe' ? ui.renderRecipeResults({ name: 'Recipe' }) : ui.renderOutputInspector(node, ui.hosts.inspector);
      const host = surface === 'list' ? ui.hosts.resultsList : surface === 'recipe' ? ui.hosts.recipeResultsList : ui.hosts.inspector;
      render(); const input = field(host), save = saveButton(host);
      input.value = 'first-run'; input.fire('input');
      map.clear(); input.value = 'cleared'; input.fire('input'); save.click();
      assert.equal(old.filenameDraft, 'first-run'); assert.equal(ui.downloads.length, 0);
      const fresh = await factory.create(node, data); map.set(node.id, fresh); render();
      input.value = 'stale'; input.fire('input'); input.fire('change'); save.click();
      assert.equal(ui.downloads.length, 0);
      assert.equal(field(host).value, 'csv-seed.csv', 'fresh run resets to the original setting');
      saveButton(host).click();
      assert.deepEqual(ui.downloads, [{ filename: 'csv-seed.csv', url: fresh.url }]);
    } finally { factory.cleanup(); }
  });
}

test('Canvas list and inspector share the draft while other outputs and Quick Recipe stay independent', async () => {
  const factory = outputFactory();
  try {
    const ui = uiHarness();
    for (const node of ui.nodes) ui.outputResults.set(node.id, await factory.create(node, data));
    ui.activeRecipeResults.set('csv', await factory.create(ui.nodes[0], data));
    ui.renderResultsList(); ui.renderOutputInspector(ui.nodes[0], ui.hosts.inspector); ui.renderRecipeResults({ name: 'Recipe' });
    const list = ui.hosts.resultsList.querySelectorAll('[data-result-filename]');
    field(ui.hosts.inspector).value = 'Shared'; field(ui.hosts.inspector).fire('input');
    assert.equal(list[0].value, 'Shared');
    assert.equal(list[1].value, 'jsonl-seed.jsonl');
    assert.equal(field(ui.hosts.recipeResultsList).value, 'csv-seed.csv');
    list[0].value = ''; list[0].fire('input'); ui.saveOutput('csv');
    assert.equal(ui.downloads[0].filename, 'output.csv');
    assert.equal(field(ui.hosts.inspector).value, 'output.csv');
    assert.equal(ui.outputResults.size, 3);
  } finally { factory.cleanup(); }
});


test('the actual language switch refreshes both result surfaces and preserves drafts', async () => {
  const factory = outputFactory();
  try {
    const ui = uiHarness();
    const result = await factory.create(ui.nodes[0], data);
    ui.outputResults.set('csv', result);
    const quick = await factory.create(ui.nodes[0], data);
    ui.activeRecipeResults.set('csv', quick);
    ui.renderResultsList(); ui.renderRecipeResults({ name: 'Recipe' });
    field(ui.hosts.resultsList).value = 'Canvas draft'; field(ui.hosts.resultsList).fire('input');
    field(ui.hosts.recipeResultsList).value = 'Quick draft'; field(ui.hosts.recipeResultsList).fire('input');
    ui.setLanguage('ja'); ui.applyLanguage();
    assert.equal(field(ui.hosts.resultsList).value, 'Canvas draft');
    assert.equal(field(ui.hosts.recipeResultsList).value, 'Quick draft');
    assert.equal(ui.hosts.recipeResultsList.querySelector('.result-filename').querySelector('span').textContent, '保存ファイル名');
  } finally { factory.cleanup(); }
});


test('each generated format saves an edited uppercase suffix and a blank draft using its fixed format', async () => {
  const factory = outputFactory();
  try {
    const ui = uiHarness();
    for (const node of ui.nodes) ui.outputResults.set(node.id, await factory.create(node, data));
    ui.renderResultsList();
    const inputs = ui.hosts.resultsList.querySelectorAll('[data-result-filename]');
    const saves = ui.hosts.resultsList.querySelectorAll('.save-btn');
    for (const [index, format] of formats.entries()) {
      inputs[index].value = `custom.${format.toUpperCase()}`; inputs[index].fire('input'); saves[index].click();
      assert.equal(ui.downloads.at(-1).filename, `custom.${format}`);
      inputs[index].value = ''; inputs[index].fire('input'); saves[index].click();
      assert.equal(ui.downloads.at(-1).filename, `output.${format}`);
    }
  } finally { factory.cleanup(); }
});

test('filename finalization stays stable when the 120-character boundary lands on dots or spaces', async () => {
  const factory = outputFactory();
  try {
    const ui = uiHarness();
    for (const boundary of ['.', ' ']) {
      const node = { ...ui.nodes[0], data: { filename: 'a'.repeat(119) + boundary + 'beyond-limit.JSONL' } };
      const result = await factory.create(node, data);
      ui.outputResults.set('csv', result);
      ui.saveOutput('csv');
      assert.equal(result.filename, `${'a'.repeat(119)}.csv`);
      assert.equal(ui.downloads.at(-1).filename, result.filename);
    }
  } finally { factory.cleanup(); }
});

test('clipping does not introduce a doubled supported suffix, while intentional stem suffixes remain intact', () => {
  const finalize = new Function(`${functionSource(['finalizeOutputFilename'])};return finalizeOutputFilename;`)();
  for (const extension of formats) {
    const prefix = 'a'.repeat(120 - extension.length - 1);
    for (const format of formats) {
      const name = finalize(`${prefix}.${extension.toUpperCase()}-beyond-limit`, format);
      assert.equal(name, `${prefix}.${format}`);
      assert.equal(finalize(name, format), name);
    }
    assert.equal(finalize(`archive.${extension}.${extension}`, extension), `archive.${extension}.${extension}`, 'only the terminal suffix is normalized when no clipping is needed');
  }
});
