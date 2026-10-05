import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/index.template.html');
const normalizeBuild = text => text.replace(/"generatedAtUtc":"[^"]*"/g, '"generatedAtUtc":"BUILD_TIME"');

test('tracked standalone includes the current result filename UI and behavior', () => {
  const standalone = read('data-pipeline-builder.html');
  for (const prefix of ['    function finalizeOutputFilename(', '    function createResultFilenameField(', '    function syncResultFilename(', '    function saveGeneratedResult(', '    function renderOutputInspector(', '    function renderResultsList(', '    function renderRecipeResults(', '    function saveOutput(', '    function saveRecipeOutput(', '    function applyLanguage(', '    .result-info,']) {
    const expected = source.split('\n').find(line => line.startsWith(prefix));
    assert.ok(expected, prefix);
    assert.equal(standalone.split('\n').find(line => line.startsWith(prefix)), expected, `stale standalone: ${prefix}`);
  }
  assert.match(standalone, /data-i18n="helpResultFilename"/);
});

test('Node Editor Core stays byte-identical to the approved baseline', () => {
  const bytes = fs.readFileSync(new URL('../src/core/node-editor-core.mjs', import.meta.url));
  assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), '932fe76db7c31c9659435f602e08958b0ec0f352');
});

test('canonical readable, tracked and self-extracted releases have matching bytes and pass filename behavior', { skip: process.env.VERIFY_OUTPUT_ARTIFACTS !== '1' }, () => {
  const readable = read('dist/index.html');
  assert.equal(normalizeBuild(read('data-pipeline-builder.html')), normalizeBuild(readable));
  const loader = read('dist/index.self-extract.html');
  const payload = loader.match(/<script id="self-extract-payload" type="application\/octet-stream">([A-Za-z0-9+/=\r\n]+)<\/script>/);
  assert.ok(payload);
  const restored = gunzipSync(Buffer.from(payload[1].replace(/\s/g, ''), 'base64')).toString('utf8');
  assert.equal(restored, readable, 'self-extract must restore exact readable bytes');
  const moduleSource = source.slice(source.indexOf('    const I18N='));
  assert.equal(readable.slice(readable.indexOf('    const I18N=')), moduleSource);
  for (const path of ['data-pipeline-builder.html', 'dist/index.html']) {
    const run = spawnSync(process.execPath, ['--test', 'tests/output-filenames.test.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, OUTPUT_FILENAME_HTML: path } });
    assert.equal(run.status, 0, `${path}\n${run.stdout}\n${run.stderr}`);
  }
});
