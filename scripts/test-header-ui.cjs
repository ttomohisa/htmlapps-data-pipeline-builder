// Source/release contracts; native geometry is checked separately in browser QA.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const targets = process.argv.includes('--source-only') ? ['src/index.template.html'] :
  ['src/index.template.html', 'dist/index.html', 'dist/index.self-extract.html', 'data-pipeline-builder.html'];
for (const target of targets) {
  let html = fs.readFileSync(path.join(root, target), 'utf8');
  if (target.includes('self-extract') && !html.includes('class="brand-name"')) {
    const payload = html.match(/<script\b[^>]*id="self-extract-payload"[^>]*>([\s\S]*?)<\/script>/)?.[1]
      || html.match(/['"](H4sI[A-Za-z0-9+/=]+)['"]/)?.[1];
    assert.ok(payload, target + ': gzip payload exists');
    html = zlib.gunzipSync(Buffer.from(payload.trim(), 'base64')).toString('utf8');
  }
  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(css, /\.version\s*\{[^}]*display\s*:\s*none/, target + ': version is not hidden on narrow screens');
  assert.match(css, /\.version\s*\{[^}]*flex\s*:\s*0 0 auto/, target + ': version does not shrink behind the title');
  console.log('PASS header UI: ' + target);
}
